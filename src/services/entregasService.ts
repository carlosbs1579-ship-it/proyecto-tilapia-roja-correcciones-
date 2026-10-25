import { doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { Lote, EntregasLote, RegistroEntrega, TipoRegistroEntrega } from '../types';
import { GRANJA_ID_PREDETERMINADA } from '../utils/constants';
import { calcularHashEvento, verificarIntegridadCadena, ResultadoVerificacion } from './hashService';

// Las entregas de un lote sellado se guardan en entregas/{codigoLote}, nunca en el documento del
// lote. Forman una cadena de hashes propia que parte del hash del último evento de producción, de
// modo que los registros sellados y su hash no cambian, y cada acción queda auditada con quién la
// registró y cuándo, igual que los eventos de producción.

export type EstadoEntrega = 'asignada' | 'entregada' | 'anulada';

export interface ResumenEntrega {
  entregaId: string;
  estado: EstadoEntrega;
  cliente: string;
  cantidadKg: number;
  fechaProgramada: string;
  fechaEntrega: string | null;
  registros: RegistroEntrega[]; // historial completo de esta entrega, en orden
}

/**
 * Hash con el que se ancla la cadena de entregas: el del último evento de producción sellado
 */
export function hashDeCierre(lote: Lote): string {
  const eventos = lote.eventos || [];
  return eventos.length ? eventos[eventos.length - 1].hash : '';
}

/**
 * Reconstruye el estado actual de cada entrega a partir de su historial
 */
export function calcularEstadoEntregas(registros: RegistroEntrega[]): ResumenEntrega[] {
  const entregas = new Map<string, ResumenEntrega>();
  for (const r of registros || []) {
    const id = r.datos?.entregaId;
    if (!id) continue;
    let e = entregas.get(id);
    if (r.tipo === 'Asignación de cliente') {
      e = {
        entregaId: id,
        estado: 'asignada',
        cliente: r.datos.cliente,
        cantidadKg: Number(r.datos.cantidadKg) || 0,
        fechaProgramada: r.fechaEvento,
        fechaEntrega: null,
        registros: []
      };
      entregas.set(id, e);
    }
    if (!e) continue;
    e.registros.push(r);
    if (r.tipo === 'Reasignación de cliente') {
      e.cliente = r.datos.cliente;
    } else if (r.tipo === 'Entrega completada') {
      e.estado = 'entregada';
      e.cantidadKg = Number(r.datos.cantidadKg) || e.cantidadKg;
      e.fechaEntrega = r.fechaEvento;
    } else if (r.tipo === 'Anulación de asignación') {
      e.estado = 'anulada';
    }
  }
  return Array.from(entregas.values());
}

/**
 * Kilos ya comprometidos (asignados o entregados) en las entregas que no están anuladas
 */
function kilosComprometidos(entregas: ResumenEntrega[], excluirId?: string): number {
  return entregas
    .filter((e) => e.estado !== 'anulada' && e.entregaId !== excluirId)
    .reduce((suma, e) => suma + e.cantidadKg, 0);
}

function generarIdEntrega(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `en_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export interface ParamsAccionEntrega {
  codigoLote: string;
  tipo: TipoRegistroEntrega;
  entregaId?: string; // obligatorio salvo en una asignación nueva
  cliente?: string;
  fecha: string; // YYYY-MM-DD: fecha programada o fecha real de entrega
  cantidadKg?: number;
  motivo?: string;
  observaciones?: string;
  userEmail: string;
}

/**
 * Registra una acción de entrega (asignar, reasignar, completar o anular) como un nuevo eslabón
 * de la cadena de entregas. Nunca reescribe registros anteriores.
 */
export async function registrarAccionEntrega(params: ParamsAccionEntrega): Promise<EntregasLote> {
  const { codigoLote, tipo, fecha, userEmail } = params;
  const cliente = params.cliente?.trim() || '';
  const motivo = params.motivo?.trim() || '';
  const observaciones = params.observaciones?.trim() || '';
  const loteRef = doc(db, 'lotes', codigoLote);
  const entregasRef = doc(db, 'entregas', codigoLote);

  if (!fecha) throw new Error('Indica la fecha.');

  try {
    return await runTransaction(db, async (transaction) => {
      const loteSnap = await transaction.get(loteRef);
      if (!loteSnap.exists()) {
        throw new Error(`El lote ${codigoLote} no existe.`);
      }
      const lote = loteSnap.data() as Lote;
      if (lote.estado !== 'cerrado') {
        throw new Error('Solo se pueden registrar entregas de lotes sellados y cerrados.');
      }
      const anclaje = hashDeCierre(lote);
      if (!anclaje) {
        throw new Error('El lote no tiene eventos de producción con los que anclar las entregas.');
      }

      const entregasSnap = await transaction.get(entregasRef);
      const actual = entregasSnap.exists() ? (entregasSnap.data() as EntregasLote) : null;
      if (actual && actual.hashAnclaje !== anclaje) {
        throw new Error('La cadena de entregas no coincide con el sello del lote. Verifica la integridad antes de continuar.');
      }
      const registros = actual?.registros || [];
      const entregas = calcularEstadoEntregas(registros);
      const cosechadaKg = Number(lote.resumen?.biomasaCosechadaKg) || 0;

      let entregaId = params.entregaId || '';
      let datos: Record<string, any>;

      if (tipo === 'Asignación de cliente') {
        const cantidadKg = Number(params.cantidadKg);
        if (!cliente) throw new Error('Indica el cliente o restaurante destinatario.');
        if (!(cantidadKg > 0)) throw new Error('La cantidad debe ser mayor que 0 kg.');
        if (cosechadaKg > 0 && kilosComprometidos(entregas) + cantidadKg > cosechadaKg) {
          throw new Error(
            `La cantidad supera la biomasa cosechada del lote (${cosechadaKg} kg; ya hay ${kilosComprometidos(entregas)} kg comprometidos).`
          );
        }
        entregaId = generarIdEntrega();
        datos = { entregaId, cliente, cantidadKg };
      } else {
        const entrega = entregas.find((e) => e.entregaId === entregaId);
        if (!entrega) throw new Error('La entrega indicada no existe.');
        if (entrega.estado !== 'asignada') {
          throw new Error(`La entrega a ${entrega.cliente} ya está ${entrega.estado}; no admite más cambios.`);
        }

        if (tipo === 'Reasignación de cliente') {
          if (!cliente) throw new Error('Indica el nuevo cliente o restaurante.');
          if (cliente.toLowerCase() === entrega.cliente.toLowerCase()) {
            throw new Error('El nuevo cliente es igual al actual.');
          }
          if (!motivo) throw new Error('Indica el motivo del cambio de cliente.');
          datos = { entregaId, cliente, clienteAnterior: entrega.cliente, cantidadKg: entrega.cantidadKg, motivo };
        } else if (tipo === 'Entrega completada') {
          const cantidadKg = Number(params.cantidadKg ?? entrega.cantidadKg);
          if (!(cantidadKg > 0)) throw new Error('La cantidad entregada debe ser mayor que 0 kg.');
          if (cosechadaKg > 0 && kilosComprometidos(entregas, entregaId) + cantidadKg > cosechadaKg) {
            throw new Error(`La cantidad entregada supera la biomasa cosechada del lote (${cosechadaKg} kg).`);
          }
          datos = { entregaId, cliente: entrega.cliente, cantidadKg };
        } else {
          if (!motivo) throw new Error('Indica el motivo de la anulación.');
          datos = { entregaId, cliente: entrega.cliente, cantidadKg: entrega.cantidadKg, motivo };
        }
      }

      const indice = registros.length;
      const hashAnterior = indice === 0 ? anclaje : registros[indice - 1].hash;
      const registradoEn = new Date().toISOString();
      const hash = await calcularHashEvento({
        codigoLote,
        indice,
        tipo,
        fechaEvento: fecha,
        descripcion: observaciones,
        datos,
        registradoPor: userEmail,
        registradoEn,
        hashAnterior
      });

      const registro: RegistroEntrega = {
        id: generarIdEntrega(),
        indice,
        tipo,
        fechaEvento: fecha,
        descripcion: observaciones,
        datos,
        registradoPor: userEmail,
        registradoEn,
        hashAnterior,
        hash
      };

      const resultado: EntregasLote = actual
        ? { ...actual, registros: [...registros, registro], actualizadoEn: registradoEn }
        : {
            codigoLote,
            granjaId: lote.granjaId || GRANJA_ID_PREDETERMINADA,
            hashAnclaje: anclaje,
            registros: [registro],
            creadoEn: registradoEn,
            actualizadoEn: registradoEn
          };

      if (actual) {
        transaction.update(entregasRef, { registros: resultado.registros, actualizadoEn: registradoEn });
      } else {
        transaction.set(entregasRef, resultado);
      }
      return resultado;
    });
  } catch (err: any) {
    console.error('Error registrando entrega en Firestore:', err);
    if (err?.code === 'permission-denied') {
      throw new Error('No tienes permiso para registrar entregas. Esta acción requiere un administrador de la granja.');
    }
    throw new Error(err?.message || 'No fue posible registrar la entrega.');
  }
}

/**
 * Escucha en tiempo real las entregas de un lote (null si aún no tiene)
 */
export function escucharEntregas(
  codigoLote: string,
  onUpdate: (entregas: EntregasLote | null) => void,
  onError?: (error: any) => void
): () => void {
  return onSnapshot(
    doc(db, 'entregas', codigoLote),
    (snap) => onUpdate(snap.exists() ? (snap.data() as EntregasLote) : null),
    (error) => {
      console.error(`Error escuchando entregas del lote ${codigoLote}:`, error);
      if (onError) onError(error);
    }
  );
}

/**
 * Verifica la cadena de entregas: que siga anclada al sello del lote y que ningún registro haya
 * sido alterado. Reutiliza la misma verificación de la cadena de producción.
 */
export async function verificarIntegridadEntregas(
  lote: Lote,
  entregas: EntregasLote
): Promise<ResultadoVerificacion> {
  const total = entregas.registros?.length || 0;
  if (entregas.hashAnclaje !== hashDeCierre(lote)) {
    return {
      valido: false,
      totalEventos: total,
      primerErrorIndex: 0,
      mensaje: 'La cadena de entregas no está anclada al hash de cierre actual del lote.'
    };
  }
  const res = await verificarIntegridadCadena(lote.codigo, entregas.registros || [], entregas.hashAnclaje);
  return res.valido
    ? { ...res, mensaje: `Cadena de entregas íntegra: ${total} registro(s) verificados y anclados al sello del lote.` }
    : res;
}
