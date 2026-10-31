import { collection, doc, getDoc, onSnapshot, query, runTransaction, where } from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseConfig';
import { ComprobanteEntrega, ConsultaEntrega, EventoOrden, OrdenEntrega } from '../types';
import { calcularSha256, jsonCanonico } from './hashService';
import { cantidadPendiente, mensajeError, nuevoEvento, redondear } from './pedidosService';

// Comprobantes de entrega. Un comprobante definitivo es un registro inmutable en
// comprobantes/{id} construido SOLO con datos ya confirmados en el servidor (la orden leída dentro
// de una transacción); las acciones que siguen en el teléfono del repartidor no están en el
// servidor y no pueden entrar. El PDF se genera a partir del registro cada vez.
//
// Integridad (no es una blockchain: son hashes SHA-256 guardados en Firebase):
//  - hashEventos: SHA-256 del JSON canónico de los eventos de la orden usados (inicio de ruta,
//    llegada, entregas, novedades, ajustes y decisiones de saldo), tal como están guardados.
//  - hashComprobante: SHA-256 del JSON canónico de todo el comprobante salvo este mismo campo.
// Verificar = recalcular ambos y compararlos. El hash del lote productivo no se toca.

export const EMPRESA = 'Cultivos Loré — Tilapia Pro';

// Eventos de la orden que documenta un comprobante
const TIPOS_DOCUMENTADOS = new Set([
  'Inicio de ruta',
  'Llegada',
  'Entrega',
  'Novedad',
  'Ajuste aplicado',
  'Reprogramación de saldo',
  'Cierre con saldo liberado'
]);

function generarToken(prefijo: string): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return prefijo + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Último evento "Entrega" confirmado de la orden (con su posición en el historial)
 */
export function ultimaEntrega(orden: OrdenEntrega): { evento: EventoOrden; indice: number } | null {
  for (let i = (orden.historial || []).length - 1; i >= 0; i--) {
    if (orden.historial[i].tipo === 'Entrega') return { evento: orden.historial[i], indice: i };
  }
  return null;
}

/**
 * Entregas que ya tienen comprobante definitivo (según los eventos "Comprobante emitido")
 */
export function entregasConComprobante(orden: OrdenEntrega): Set<string> {
  return new Set(
    (orden.historial || []).filter((e) => e.tipo === 'Comprobante emitido').map((e) => e.datos?.eventoEntregaId)
  );
}

/**
 * Problemas que impiden emitir un comprobante definitivo: sin entrega confirmada, o datos de la
 * orden que no cuadran entre sí (lo entregado por lote frente a las entregas registradas)
 */
export function problemasParaEmitir(orden: OrdenEntrega): string[] {
  const problemas: string[] = [];
  if (!['entregado', 'entrega_parcial'].includes(orden.estado)) {
    problemas.push('La orden no tiene una entrega confirmada pendiente de comprobante (debe estar entregada o con entrega parcial).');
  }
  const ultima = ultimaEntrega(orden);
  if (!ultima) {
    problemas.push('No hay ninguna entrega confirmada en el historial.');
    return problemas;
  }
  if (!ultima.evento.eventoId) problemas.push('La última entrega no tiene identificador de evento.');
  if (ultima.evento.eventoId && entregasConComprobante(orden).has(ultima.evento.eventoId)) {
    problemas.push('La última entrega ya tiene su comprobante definitivo.');
  }
  const porLote = orden.entregadoPorLote || {};
  const suma = redondear(Object.values(porLote).reduce((s, n) => s + n, 0), orden.unidad);
  if (suma !== redondear(orden.cantidadEntregada, orden.unidad)) {
    problemas.push(`Lo entregado por lote (${suma}) no coincide con la cantidad entregada de la orden (${orden.cantidadEntregada}).`);
  }
  const segunEventos: Record<string, number> = {};
  for (const e of orden.historial) {
    if (e.tipo !== 'Entrega') continue;
    for (const [lote, cantidad] of Object.entries((e.datos?.entregas || {}) as Record<string, number>)) {
      segunEventos[lote] = redondear((segunEventos[lote] || 0) + (Number(cantidad) || 0), orden.unidad);
    }
  }
  for (const [lote, p] of Object.entries(orden.procedencias || {})) {
    const entregado = porLote[lote] || 0;
    if (entregado > p.cantidad) problemas.push(`El lote ${lote} tiene más entregado (${entregado}) que autorizado (${p.cantidad}).`);
    if (redondear(segunEventos[lote] || 0, orden.unidad) !== redondear(entregado, orden.unidad)) {
      problemas.push(`El lote ${lote}: las entregas registradas suman ${segunEventos[lote] || 0}, pero la orden indica ${entregado}.`);
    }
  }
  if (cantidadPendiente(orden) < 0) problemas.push('La cantidad pendiente es negativa.');
  return problemas;
}

/**
 * Eventos de la orden que documenta el comprobante, tal como están guardados
 */
function eventosDocumentados(orden: OrdenEntrega): EventoOrden[] {
  return (orden.historial || []).filter((e) => TIPOS_DOCUMENTADOS.has(e.tipo));
}

async function hashDeEventos(eventos: EventoOrden[]): Promise<string> {
  return calcularSha256(jsonCanonico(eventos));
}

export async function calcularHashComprobante(c: Omit<ComprobanteEntrega, 'hashComprobante'> | ComprobanteEntrega): Promise<string> {
  const { hashComprobante, ...contenido } = c as ComprobanteEntrega;
  return calcularSha256(jsonCanonico(contenido));
}

/**
 * Arma el contenido del comprobante a partir de la orden (lo que realmente ocurrió: cantidades
 * entregadas, pendientes, novedades y ajustes aplicados). Sirve para el definitivo y para el
 * preliminar, que no se guarda.
 */
export function construirComprobante(
  orden: OrdenEntrega,
  datos: { id: string; version: number; token: string; uid: string; emitidoEn: string }
): Omit<ComprobanteEntrega, 'hashEventos' | 'hashComprobante'> {
  const ultima = ultimaEntrega(orden);
  const entregas = orden.historial
    .filter((e) => e.tipo === 'Entrega')
    .map((e) => ({
      eventoId: e.eventoId || '',
      fecha: e.fecha,
      cantidades: Object.fromEntries(
        Object.entries((e.datos?.entregas || {}) as Record<string, number>).filter(([, n]) => Number(n) > 0).map(([l, n]) => [l, Number(n)])
      ),
      faltante: Number(e.datos?.faltante) || 0,
      observacion: e.descripcion || ''
    }));
  const ajustes = orden.historial
    .filter((e) => e.tipo === 'Ajuste aplicado')
    .map((e) => ({
      fecha: e.fecha,
      anterior: Object.fromEntries(Object.entries((e.datos?.anterior || {}) as Record<string, any>).map(([l, p]) => [l, Number(p?.cantidad) || 0])),
      nueva: Object.fromEntries(Object.entries((e.datos?.nueva || {}) as Record<string, any>).map(([l, p]) => [l, Number(p?.cantidad) || 0])),
      motivo: orden.ajustes?.[e.datos?.ajusteId]?.motivo || e.descripcion || ''
    }));
  return {
    id: datos.id,
    version: datos.version,
    ordenId: orden.id,
    granjaId: orden.granjaId,
    tokenConsulta: datos.token,
    emitidoEn: datos.emitidoEn,
    emitidoPorUid: datos.uid,
    empresa: EMPRESA,
    estadoEntrega: orden.estado === 'entregado' ? 'entregado' : 'entrega_parcial',
    cliente: { nombre: orden.clienteNombre, direccion: orden.clienteDireccion || '' },
    repartidor: orden.repartidorNombre || '',
    fechas: {
      creacion: orden.creadoEn,
      programada: orden.fechaProgramada || null,
      salida: orden.rutaIniciadaEn || orden.historial.filter((e) => e.tipo === 'Inicio de ruta').pop()?.fecha || null,
      llegada: orden.llegadaEn || orden.historial.filter((e) => e.tipo === 'Llegada').pop()?.fecha || null,
      confirmacion: ultima?.evento.fecha || ''
    },
    unidad: orden.unidad,
    cantidadSolicitada: orden.cantidadSolicitada,
    cantidadAutorizada: orden.cantidadAutorizada,
    cantidadEntregada: orden.cantidadEntregada,
    cantidadLiberada: orden.cantidadLiberada || 0,
    cantidadPendiente: cantidadPendiente(orden),
    procedencias: Object.fromEntries(
      Object.entries(orden.procedencias).map(([lote, p]) => [
        lote,
        { estanque: p.estanque, autorizada: p.cantidad, entregada: orden.entregadoPorLote?.[lote] || 0 }
      ])
    ),
    entregas,
    novedades: orden.historial.filter((e) => e.tipo === 'Novedad').map((e) => ({ fecha: e.fecha, descripcion: e.descripcion })),
    ajustes,
    eventoEntregaId: ultima?.evento.eventoId || '',
    eventoEntregaIndice: ultima?.indice ?? -1,
    eventosUsados: eventosDocumentados(orden).map((e) => e.eventoId || `indice-${e.indice}`)
  };
}

/**
 * Emite el comprobante definitivo de la última entrega confirmada. Lee la orden en el servidor
 * dentro de la transacción; si algo no cuadra, no emite y explica por qué. Escribe en una sola
 * operación el comprobante, el índice público de consulta y el evento en el historial de la orden.
 */
export async function emitirComprobanteDefinitivo(ordenId: string): Promise<ComprobanteEntrega> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Debes iniciar sesión.');
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(doc(db, 'ordenes', ordenId));
      if (!snap.exists()) throw new Error('La orden no existe.');
      const orden = snap.data() as OrdenEntrega;
      const problemas = problemasParaEmitir(orden);
      if (problemas.length) throw new Error('No se emitió el comprobante: ' + problemas.join(' '));

      const token = orden.tokenConsulta || generarToken('c');
      const consultaRef = doc(db, 'consultasEntrega', token);
      const consultaSnap = await tx.get(consultaRef);
      const consulta = consultaSnap.exists() ? (consultaSnap.data() as ConsultaEntrega) : null;
      const ultima = ultimaEntrega(orden)!;
      const eventoEntregaId = ultima.evento.eventoId as string;
      if (consulta?.versiones?.[eventoEntregaId]) throw new Error('Esta entrega ya tiene comprobante definitivo.');

      const id = generarToken('cmp');
      const version = Object.keys(consulta?.versiones || {}).length + 1;
      const emitidoEn = new Date().toISOString();
      const base = construirComprobante(orden, { id, version, token, uid, emitidoEn });
      const hashEventos = await hashDeEventos(eventosDocumentados(orden));
      const sinHash = { ...base, hashEventos };
      const comprobante: ComprobanteEntrega = { ...sinHash, hashComprobante: await calcularHashComprobante(sinHash as ComprobanteEntrega) };

      tx.set(doc(db, 'comprobantes', id), comprobante);
      tx.set(consultaRef, {
        token,
        ordenId: orden.id,
        granjaId: orden.granjaId,
        versiones: {
          ...(consulta?.versiones || {}),
          [eventoEntregaId]: {
            comprobanteId: id,
            version,
            emitidoEn,
            estadoEntrega: comprobante.estadoEntrega,
            hashComprobante: comprobante.hashComprobante
          }
        },
        ultimaVersion: id,
        actualizadoEn: emitidoEn
      });
      tx.update(doc(db, 'ordenes', ordenId), {
        tokenConsulta: token,
        actualizadoEn: emitidoEn,
        historial: [
          ...orden.historial,
          nuevoEvento(orden.historial.length, 'Comprobante emitido', `Comprobante definitivo versión ${version}`, {
            comprobanteId: id,
            eventoEntregaId,
            version,
            estadoEntrega: comprobante.estadoEntrega,
            hashComprobante: comprobante.hashComprobante
          })
        ]
      });
      return comprobante;
    });
  } catch (err) {
    console.error('Error emitiendo el comprobante:', err);
    throw mensajeError('emitir el comprobante', err);
  }
}

// ---------- Lectura ----------

export function escucharComprobantesOrden(
  granjaId: string,
  ordenId: string,
  onUpdate: (comprobantes: ComprobanteEntrega[]) => void,
  onError?: (error: any) => void
): () => void {
  return onSnapshot(
    query(collection(db, 'comprobantes'), where('granjaId', '==', granjaId), where('ordenId', '==', ordenId)),
    (snap) => onUpdate(snap.docs.map((d) => d.data() as ComprobanteEntrega).sort((a, b) => b.version - a.version)),
    (err) => {
      console.error('Error escuchando comprobantes:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Consulta pública de una entrega por su código (lectura de un solo documento; no lista nada)
 */
export async function leerConsultaEntrega(token: string): Promise<{ consulta: ConsultaEntrega; comprobantes: ComprobanteEntrega[] } | null> {
  const snap = await getDoc(doc(db, 'consultasEntrega', token));
  if (!snap.exists()) return null;
  const consulta = snap.data() as ConsultaEntrega;
  const comprobantes = await Promise.all(
    Object.values(consulta.versiones).map(async (v) => {
      const c = await getDoc(doc(db, 'comprobantes', v.comprobanteId));
      return c.exists() ? (c.data() as ComprobanteEntrega) : null;
    })
  );
  return {
    consulta,
    comprobantes: comprobantes.filter((c): c is ComprobanteEntrega => Boolean(c)).sort((a, b) => b.version - a.version)
  };
}

// ---------- Verificación ----------

export interface ResultadoVerificacionComprobante {
  contenidoIntegro: boolean; // el hash del comprobante coincide con su contenido
  eventosIntegros: boolean | null; // los eventos de la orden siguen iguales (solo si se tiene la orden)
  indiceCoincide: boolean | null; // el índice público registra el mismo hash (solo si se tiene)
  mensaje: string;
}

/**
 * Verifica un comprobante recalculando sus hashes. Con la orden (operador) también comprueba que
 * los eventos usados sigan idénticos en el historial; con el índice público, que coincida el hash.
 */
export async function verificarComprobante(
  c: ComprobanteEntrega,
  extra: { orden?: OrdenEntrega; consulta?: ConsultaEntrega } = {}
): Promise<ResultadoVerificacionComprobante> {
  const contenidoIntegro = (await calcularHashComprobante(c)) === c.hashComprobante;
  let eventosIntegros: boolean | null = null;
  if (extra.orden) {
    const porId = new Map((extra.orden.historial || []).map((e) => [e.eventoId || `indice-${e.indice}`, e]));
    const usados = c.eventosUsados.map((id) => porId.get(id));
    eventosIntegros = usados.every(Boolean) && (await hashDeEventos(usados as EventoOrden[])) === c.hashEventos;
  }
  let indiceCoincide: boolean | null = null;
  if (extra.consulta) {
    indiceCoincide = extra.consulta.versiones?.[c.eventoEntregaId]?.hashComprobante === c.hashComprobante;
  }
  const fallas = [
    !contenidoIntegro && 'el contenido no corresponde a su hash',
    eventosIntegros === false && 'los eventos de la orden no coinciden con los usados',
    indiceCoincide === false && 'el índice de consulta registra otro hash'
  ].filter(Boolean);
  return {
    contenidoIntegro,
    eventosIntegros,
    indiceCoincide,
    mensaje: fallas.length
      ? `Verificación fallida: ${fallas.join('; ')}.`
      : `Comprobante íntegro: el contenido coincide con su hash SHA-256${eventosIntegros ? ' y con los eventos registrados en la orden' : ''}.`
  };
}
