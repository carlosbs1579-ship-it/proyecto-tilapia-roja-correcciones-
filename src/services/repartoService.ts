import {
  collection,
  doc,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where
} from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseConfig';
import { AjusteDistribucion, EventoOrden, OrdenEntrega, TipoEventoOrden } from '../types';
import { ESTADOS_CON_RESERVA, ETIQUETA_ESTADO_ORDEN, generarId, redondear, saldoLote } from './pedidosService';

// Acciones del repartidor sobre sus órdenes. Cada acción se guarda primero en una bandeja local del
// teléfono (localStorage) con un identificador único, y se envía a Firebase en una transacción que:
//  - no la aplica dos veces (si el identificador ya está en el historial, ya se recibió);
//  - comprueba que la orden siga asignada al repartidor y en un estado compatible;
//  - si la orden cambió y la acción ya no corresponde, la marca como conflicto y no la aplica.
// Sin conexión, la acción queda "guardada en el teléfono" y se envía al volver la conexión. Una
// acción guardada localmente nunca se muestra como recibida ni aprobada.

export type TipoAccionReparto = Extract<
  TipoEventoOrden,
  'Inicio de ruta' | 'Llegada' | 'Entrega' | 'Novedad' | 'Solicitud de ajuste' | 'Cancelación de solicitud'
>;

// guardada: en el teléfono, pendiente de enviar · enviando · recibida: Firebase la aceptó ·
// confirmada: ya aparece en la orden leída del servidor · conflicto: no se aplicó (ver mensaje)
export type EstadoAccion = 'guardada' | 'enviando' | 'recibida' | 'confirmada' | 'conflicto';

export interface AccionReparto {
  id: string; // también es el eventoId del historial
  ordenId: string;
  tipo: TipoAccionReparto;
  descripcion: string;
  datos: Record<string, any>;
  registradaEn: string; // hora del teléfono en que el repartidor la hizo
  estado: EstadoAccion;
  mensaje?: string;
  actualizadaEn: string;
}

export const ETIQUETA_ESTADO_ACCION: Record<EstadoAccion, string> = {
  guardada: 'Guardada en el teléfono · pendiente de enviar',
  enviando: 'Enviando...',
  recibida: 'Recibida por Firebase',
  confirmada: 'Confirmada por el servidor',
  conflicto: 'No se aplicó'
};

class ConflictoReparto extends Error {}

// ---------- Bandeja local ----------

const claveBandeja = (uid: string) => `cultivos_lore_bandeja_${uid}`;
const claveCopia = (uid: string) => `cultivos_lore_mis_entregas_${uid}`;
const suscriptores = new Map<string, Set<(acciones: AccionReparto[]) => void>>();

export function leerBandeja(uid: string): AccionReparto[] {
  try {
    const raw = localStorage.getItem(claveBandeja(uid));
    return raw ? (JSON.parse(raw) as AccionReparto[]) : [];
  } catch {
    return [];
  }
}

function guardarBandeja(uid: string, acciones: AccionReparto[]): void {
  // Se conservan todas las pendientes y en conflicto, y solo las 30 confirmadas más recientes
  const confirmadas = acciones.filter((a) => a.estado === 'confirmada').slice(-30);
  const resto = acciones.filter((a) => a.estado !== 'confirmada');
  const lista = [...resto, ...confirmadas].sort((a, b) => a.registradaEn.localeCompare(b.registradaEn));
  try {
    localStorage.setItem(claveBandeja(uid), JSON.stringify(lista));
  } catch {}
  suscriptores.get(uid)?.forEach((cb) => cb(lista));
}

function actualizarAccion(uid: string, id: string, cambios: Partial<AccionReparto>): void {
  guardarBandeja(
    uid,
    leerBandeja(uid).map((a) => (a.id === id ? { ...a, ...cambios, actualizadaEn: new Date().toISOString() } : a))
  );
}

export function escucharBandeja(uid: string, onUpdate: (acciones: AccionReparto[]) => void): () => void {
  if (!suscriptores.has(uid)) suscriptores.set(uid, new Set());
  suscriptores.get(uid)!.add(onUpdate);
  onUpdate(leerBandeja(uid));
  return () => {
    suscriptores.get(uid)?.delete(onUpdate);
  };
}

/**
 * Descarta una acción en conflicto de la bandeja (ya fue revisada por el repartidor)
 */
export function descartarAccion(uid: string, id: string): void {
  guardarBandeja(uid, leerBandeja(uid).filter((a) => !(a.id === id && a.estado === 'conflicto')));
}

// ---------- Copia local de "Mis entregas" (para consultar sin conexión) ----------

export function leerCopiaEntregas(uid: string): { ordenes: OrdenEntrega[]; guardadaEn: string } | null {
  try {
    const raw = localStorage.getItem(claveCopia(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Escucha las órdenes del repartidor. Primero entrega la copia guardada en el teléfono (si existe)
 * y luego los datos del servidor en tiempo real, que también actualizan la copia.
 */
export function escucharMisEntregas(
  uid: string,
  onUpdate: (ordenes: OrdenEntrega[], origen: { desdeServidor: boolean; guardadaEn: string | null }) => void,
  onError?: (error: any) => void
): () => void {
  const copia = leerCopiaEntregas(uid);
  if (copia) onUpdate(copia.ordenes, { desdeServidor: false, guardadaEn: copia.guardadaEn });

  return onSnapshot(
    query(collection(db, 'ordenes'), where('repartidorUid', '==', uid)),
    (snap) => {
      const ordenes = snap.docs.map((d) => d.data() as OrdenEntrega);
      ordenes.sort(
        (a, b) => (a.fechaProgramada || '9999').localeCompare(b.fechaProgramada || '9999') || b.creadoEn.localeCompare(a.creadoEn)
      );
      const desdeServidor = !snap.metadata.fromCache;
      const guardadaEn = new Date().toISOString();
      if (desdeServidor) {
        try {
          localStorage.setItem(claveCopia(uid), JSON.stringify({ ordenes, guardadaEn }));
        } catch {}
        marcarConfirmadas(uid, ordenes);
      }
      onUpdate(ordenes, { desdeServidor, guardadaEn });
    },
    (err) => {
      console.error('Error escuchando las entregas del repartidor:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Las acciones recibidas que ya aparecen en el historial leído del servidor quedan confirmadas
 */
function marcarConfirmadas(uid: string, ordenes: OrdenEntrega[]): void {
  const acciones = leerBandeja(uid);
  const eventos = new Set(ordenes.flatMap((o) => (o.historial || []).map((e) => e.eventoId).filter(Boolean)));
  if (!acciones.some((a) => a.estado === 'recibida' && eventos.has(a.id))) return;
  guardarBandeja(
    uid,
    acciones.map((a) => (a.estado === 'recibida' && eventos.has(a.id) ? { ...a, estado: 'confirmada' } : a))
  );
}

// ---------- Registro y envío de acciones ----------

/**
 * Registra una acción del repartidor: la guarda en el teléfono y la intenta enviar de inmediato
 */
export function registrarAccion(
  uid: string,
  accion: { ordenId: string; tipo: TipoAccionReparto; descripcion?: string; datos?: Record<string, any> }
): AccionReparto {
  const ahora = new Date().toISOString();
  const nueva: AccionReparto = {
    id: generarId('ev'),
    ordenId: accion.ordenId,
    tipo: accion.tipo,
    descripcion: (accion.descripcion || '').trim().slice(0, 1000),
    datos: accion.datos || {},
    registradaEn: ahora,
    estado: 'guardada',
    actualizadaEn: ahora
  };
  guardarBandeja(uid, [...leerBandeja(uid), nueva]);
  void procesarBandeja(uid);
  return nueva;
}

let procesando = false;

function esErrorDeConexion(err: any): boolean {
  const codigo = err?.code || '';
  return (
    codigo === 'unavailable' ||
    codigo === 'deadline-exceeded' ||
    err?.message === 'sin-conexion' ||
    (typeof navigator !== 'undefined' && !navigator.onLine)
  );
}

/**
 * Envía, en orden, las acciones guardadas en el teléfono. Se detiene si no hay conexión.
 */
export async function procesarBandeja(uid: string): Promise<void> {
  if (procesando) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  procesando = true;
  try {
    for (const accion of leerBandeja(uid).filter((a) => a.estado === 'guardada' || a.estado === 'enviando')) {
      actualizarAccion(uid, accion.id, { estado: 'enviando', mensaje: undefined });
      try {
        const resultado = await conTiempoLimite(aplicarAccion(uid, accion), 20000);
        actualizarAccion(uid, accion.id, {
          estado: 'recibida',
          mensaje: resultado === 'duplicada' ? 'Ya estaba registrada (no se duplicó).' : undefined
        });
      } catch (err: any) {
        if (err instanceof ConflictoReparto) {
          actualizarAccion(uid, accion.id, { estado: 'conflicto', mensaje: err.message });
        } else if (esErrorDeConexion(err)) {
          actualizarAccion(uid, accion.id, { estado: 'guardada', mensaje: 'Sin conexión: se enviará al recuperar la señal.' });
          break;
        } else if (err?.code === 'permission-denied') {
          actualizarAccion(uid, accion.id, {
            estado: 'conflicto',
            mensaje: 'El servidor rechazó la acción: la orden cambió o ya no tienes permiso sobre ella.'
          });
        } else {
          actualizarAccion(uid, accion.id, { estado: 'guardada', mensaje: err?.message || 'No se pudo enviar; se reintentará.' });
          break;
        }
      }
    }
  } finally {
    procesando = false;
  }
}

function conTiempoLimite<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promesa,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sin-conexion')), ms))
  ]);
}

/**
 * Reintenta enviar la bandeja al recuperar la conexión y cada 30 segundos
 */
export function iniciarSincronizacion(uid: string): () => void {
  const alConectar = () => void procesarBandeja(uid);
  window.addEventListener('online', alConectar);
  const intervalo = window.setInterval(alConectar, 30000);
  void procesarBandeja(uid);
  return () => {
    window.removeEventListener('online', alConectar);
    window.clearInterval(intervalo);
  };
}

/**
 * Aplica una acción en una transacción, validando contra el estado actual de la orden
 */
async function aplicarAccion(uid: string, accion: AccionReparto): Promise<'aplicada' | 'duplicada'> {
  const email = auth.currentUser?.email?.toLowerCase();
  if (!email || auth.currentUser?.uid !== uid) throw new ConflictoReparto('La sesión cambió; vuelve a ingresar.');
  const ordenRef = doc(db, 'ordenes', accion.ordenId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ordenRef);
    if (!snap.exists()) throw new ConflictoReparto('La orden ya no existe.');
    const orden = snap.data() as OrdenEntrega;
    // Idempotencia: si el evento ya está en el historial, la acción ya se recibió antes
    if ((orden.historial || []).some((e) => e.eventoId === accion.id)) return 'duplicada' as const;
    if (orden.repartidorUid !== uid) throw new ConflictoReparto('La orden ya no está asignada a ti.');

    const ahora = new Date().toISOString();
    const evento: EventoOrden = {
      indice: orden.historial.length,
      tipo: accion.tipo,
      fecha: accion.registradaEn,
      registradoPor: email,
      registradoPorUid: uid,
      descripcion: accion.descripcion,
      datos: { ...accion.datos, registradaEnTelefono: accion.registradaEn, enviadaEn: ahora },
      eventoId: accion.id,
      funcion: 'courier'
    };
    let cambios: Record<string, any> = {};

    switch (accion.tipo) {
      case 'Inicio de ruta': {
        if (!['asignado', 'en_preparacion'].includes(orden.estado)) {
          throw new ConflictoReparto(`La orden está "${ETIQUETA_ESTADO_ORDEN[orden.estado]}"; ya no se puede iniciar la ruta.`);
        }
        cambios = { estado: 'en_ruta', rutaIniciadaEn: accion.registradaEn, llegadaEn: null };
        break;
      }
      case 'Llegada': {
        if (orden.estado !== 'en_ruta' || !orden.rutaIniciadaEn) {
          throw new ConflictoReparto('No hay una ruta iniciada para esta orden.');
        }
        if (orden.llegadaEn) throw new ConflictoReparto('La llegada ya estaba registrada.');
        cambios = { llegadaEn: accion.registradaEn };
        break;
      }
      case 'Novedad': {
        if (!['asignado', 'en_preparacion', 'en_ruta', 'entrega_parcial', 'requiere_revision'].includes(orden.estado)) {
          throw new ConflictoReparto('La orden ya está cerrada; la novedad no se registró.');
        }
        if (!accion.descripcion) throw new ConflictoReparto('La novedad no tiene descripción.');
        break;
      }
      case 'Entrega': {
        if (orden.estado !== 'en_ruta' || !orden.llegadaEn) {
          throw new ConflictoReparto('Registra la llegada antes de confirmar la entrega.');
        }
        const entregas: Record<string, number> = accion.datos.entregas || {};
        const entregadoPorLote: Record<string, number> = { ...(orden.entregadoPorLote || {}) };
        let algo = false;
        for (const [codigo, valor] of Object.entries(entregas)) {
          const cantidad = redondear(Number(valor) || 0, orden.unidad);
          if (cantidad <= 0) continue;
          if (!orden.procedencias[codigo]) {
            throw new ConflictoReparto(`El lote ${codigo} ya no está en la distribución autorizada; revisa la orden.`);
          }
          if (cantidad > saldoLote(orden, codigo)) {
            throw new ConflictoReparto(
              `Del lote ${codigo} quedan ${saldoLote(orden, codigo)} ${orden.unidad} por entregar; la distribución cambió desde que registraste la entrega.`
            );
          }
          entregadoPorLote[codigo] = redondear((entregadoPorLote[codigo] || 0) + cantidad, orden.unidad);
          algo = true;
          tx.update(doc(db, 'inventarioLotes', codigo), {
            entregado: increment(cantidad),
            reservado: increment(-cantidad),
            ultimaOrden: accion.ordenId,
            movidoEn: serverTimestamp(),
            tipoMovimiento: 'entrega'
          });
        }
        if (!algo) throw new ConflictoReparto('La entrega no tiene cantidades.');
        const cantidadEntregada = redondear(
          Object.values(entregadoPorLote).reduce((s, n) => s + n, 0),
          orden.unidad
        );
        const completa = redondear(orden.cantidadAutorizada - cantidadEntregada, orden.unidad) <= 0;
        evento.datos.faltante = Math.max(0, redondear(orden.cantidadAutorizada - cantidadEntregada, orden.unidad));
        evento.datos.unidad = orden.unidad;
        cambios = { estado: completa ? 'entregado' : 'entrega_parcial', entregadoPorLote, cantidadEntregada };
        break;
      }
      case 'Solicitud de ajuste': {
        if (!ESTADOS_CON_RESERVA.includes(orden.estado) || orden.cantidadEntregada > 0) {
          throw new ConflictoReparto('La orden ya no admite solicitudes de ajuste (estado o entregas registradas).');
        }
        const esperada: Record<string, number> = accion.datos.distribucionVista || {};
        const vigente = Object.fromEntries(Object.entries(orden.procedencias).map(([c, p]) => [c, p.cantidad]));
        if (JSON.stringify(ordenarClaves(esperada)) !== JSON.stringify(ordenarClaves(vigente))) {
          throw new ConflictoReparto('La distribución cambió desde que preparaste la solicitud; revísala y vuelve a pedirla.');
        }
        const ajuste: AjusteDistribucion = {
          id: accion.datos.ajusteId,
          estado: 'pendiente_aprobacion',
          original: orden.procedencias,
          propuesta: accion.datos.propuesta,
          motivo: accion.descripcion,
          solicitadoPor: email,
          solicitadoPorUid: uid,
          solicitadoEn: accion.registradaEn
        };
        evento.datos = { ...evento.datos, distribucionVista: undefined };
        delete evento.datos.distribucionVista;
        cambios = { [`ajustes.${ajuste.id}`]: ajuste };
        break;
      }
      case 'Cancelación de solicitud': {
        const ajuste = orden.ajustes?.[accion.datos.ajusteId];
        if (!ajuste || ajuste.estado !== 'pendiente_aprobacion' || ajuste.solicitadoPorUid !== uid) {
          throw new ConflictoReparto('La solicitud ya fue resuelta; no se puede cancelar.');
        }
        cambios = { [`ajustes.${ajuste.id}`]: { ...ajuste, estado: 'cancelada' } };
        break;
      }
    }

    tx.update(ordenRef, { ...cambios, actualizadoEn: ahora, historial: [...orden.historial, evento] });
    return 'aplicada' as const;
  });
}

function ordenarClaves(obj: Record<string, number>): [string, number][] {
  return Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
}

// ---------- Ayudas para preparar las acciones ----------

/**
 * Datos de una solicitud de ajuste: la propuesta y la distribución que el repartidor tenía a la
 * vista (para detectar si cambió antes de enviarse)
 */
export function datosSolicitudAjuste(orden: OrdenEntrega, propuesta: Record<string, number>): Record<string, any> {
  return {
    ajusteId: generarId('aj'),
    propuesta,
    distribucionVista: Object.fromEntries(Object.entries(orden.procedencias).map(([c, p]) => [c, p.cantidad]))
  };
}
