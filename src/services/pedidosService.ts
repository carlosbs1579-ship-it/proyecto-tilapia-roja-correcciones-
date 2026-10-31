import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  type DocumentReference,
  type Transaction
} from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseConfig';
import {
  Cliente,
  EstadoOrden,
  EventoOrden,
  InventarioLote,
  Lote,
  OrdenEntrega,
  ProcedenciaOrden,
  TipoEventoOrden,
  UnidadMedida,
  UsuarioPerfil
} from '../types';
import { GRANJA_ID_PREDETERMINADA, compactarFecha, getFechaHoyBogota } from '../utils/constants';
import { nombreFuncion, normalizarPerfil } from './usuariosService';

// Las órdenes de entrega viven en ordenes/{id} y nunca modifican el documento del lote: solo leen
// su cosecha registrada. Lo reservado y entregado de cada lote se acumula en inventarioLotes/{lote}
// dentro de la misma transacción que la orden, y las reglas de Firestore verifican en el servidor
// que no se reserve más de lo cosechado ni dos veces lo mismo.

// Las reglas de Firestore no admiten ciclos: validan cada lote de la orden por separado
export const MAX_LOTES_POR_ORDEN = 3;

export const ETIQUETA_UNIDAD: Record<UnidadMedida, string> = {
  peces: 'peces',
  kg: 'kg'
};

export const ETIQUETA_ESTADO_ORDEN: Record<EstadoOrden, string> = {
  borrador: 'Borrador',
  asignado: 'Asignado',
  en_preparacion: 'En preparación',
  en_ruta: 'En ruta',
  entrega_parcial: 'Entrega parcial',
  entregado: 'Entregado',
  requiere_revision: 'Requiere revisión',
  cancelado: 'Cancelado'
};

// Estados en los que la orden tiene cantidades reservadas en los lotes
export const ESTADOS_CON_RESERVA: EstadoOrden[] = ['asignado', 'en_preparacion', 'en_ruta', 'requiere_revision'];

// Cambios de estado que se hacen a mano (las mismas parejas que permiten las reglas). Borrador pasa a
// asignado al confirmar la orden; entrega parcial y entregado llegarán con la confirmación de entrega.
export const TRANSICIONES_MANUALES: Partial<Record<EstadoOrden, EstadoOrden[]>> = {
  borrador: ['cancelado'],
  asignado: ['en_preparacion', 'requiere_revision', 'cancelado'],
  en_preparacion: ['en_ruta', 'requiere_revision', 'cancelado'],
  en_ruta: ['requiere_revision', 'cancelado'],
  requiere_revision: ['asignado', 'en_preparacion', 'cancelado']
};

export interface Repartidor {
  uid: string;
  nombre: string;
  cargo: string;
}

export interface Disponibilidad {
  cosechado: number;
  reservado: number;
  entregado: number;
  disponible: number;
  unidadInventario: UnidadMedida | null; // unidad fijada por la primera reserva del lote
  compatible: boolean; // false si el lote ya se reservó en la otra unidad
}

/**
 * Redondea a la precisión de la unidad: peces enteros y kg con dos decimales
 */
export function redondear(cantidad: number, unidad: UnidadMedida): number {
  return unidad === 'peces' ? Math.round(cantidad) : Math.round(cantidad * 100) / 100;
}

/**
 * Cantidad cosechada registrada en el lote (eventos de Cosecha), en la unidad pedida. Es la única
 * producción verificable: los peces vivos estimados no cuentan como disponibles.
 */
export function cantidadCosechada(lote: Lote, unidad: UnidadMedida): number {
  const resumen = lote.resumen || ({} as Lote['resumen']);
  return Number(unidad === 'peces' ? resumen.pecesCosechados : resumen.biomasaCosechadaKg) || 0;
}

export function calcularDisponibilidad(
  lote: Lote,
  inventario: InventarioLote | undefined,
  unidad: UnidadMedida
): Disponibilidad {
  const cosechado = cantidadCosechada(lote, unidad);
  if (inventario && inventario.unidad !== unidad) {
    return { cosechado, reservado: 0, entregado: 0, disponible: 0, unidadInventario: inventario.unidad, compatible: false };
  }
  const reservado = Number(inventario?.reservado) || 0;
  const entregado = Number(inventario?.entregado) || 0;
  return {
    cosechado,
    reservado,
    entregado,
    disponible: Math.max(0, redondear(cosechado - reservado - entregado, unidad)),
    unidadInventario: inventario?.unidad || null,
    compatible: true
  };
}

export function sumaProcedencias(procedencias: Record<string, ProcedenciaOrden>, unidad: UnidadMedida): number {
  return redondear(
    Object.values(procedencias || {}).reduce((s, p) => s + (Number(p.cantidad) || 0), 0),
    unidad
  );
}

export function cantidadPendiente(orden: OrdenEntrega): number {
  return Math.max(0, redondear(orden.cantidadAutorizada - orden.cantidadEntregada, orden.unidad));
}

function mensajeError(accion: string, err: any): Error {
  const codigo = err?.code || '';
  if (codigo === 'permission-denied') {
    return new Error(
      `No fue posible ${accion}: la base de datos lo rechazó. Verifica que tengas el permiso de gestionar pedidos y que las cantidades sigan disponibles.`
    );
  }
  if (codigo === 'unavailable' || codigo === 'deadline-exceeded') {
    return new Error(`No hay conexión con la base de datos. No fue posible ${accion}.`);
  }
  if (codigo === 'aborted') {
    return new Error(`Otra persona modificó las mismas cantidades al mismo tiempo. Intenta ${accion} de nuevo.`);
  }
  return new Error(err?.message || `No fue posible ${accion}.`);
}

function generarIdOrden(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const azar = new Uint32Array(5);
  crypto.getRandomValues(azar);
  const sufijo = Array.from(azar, (n) => alfabeto[n % alfabeto.length]).join('');
  return `PED-${compactarFecha(getFechaHoyBogota())}-${sufijo}`;
}

function sesion(): { email: string; uid: string } {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('Debes iniciar sesión.');
  return { email: user.email.toLowerCase(), uid: user.uid };
}

function nuevoEvento(
  indice: number,
  tipo: TipoEventoOrden,
  descripcion: string,
  datos: Record<string, any>
): EventoOrden {
  const { email, uid } = sesion();
  return {
    indice,
    tipo,
    fecha: new Date().toISOString(),
    registradoPor: email,
    registradoPorUid: uid,
    descripcion,
    datos
  };
}

const ordenRef = (id: string) => doc(db, 'ordenes', id);
const loteRef = (codigo: string) => doc(db, 'lotes', codigo);
const inventarioRef = (codigo: string) => doc(db, 'inventarioLotes', codigo);

// ---------- Lectura en tiempo real ----------

export function escucharOrdenes(
  granjaId: string,
  onUpdate: (ordenes: OrdenEntrega[]) => void,
  onError?: (error: any) => void
): () => void {
  return onSnapshot(
    query(collection(db, 'ordenes'), where('granjaId', '==', granjaId)),
    (snap) => {
      const lista = snap.docs.map((d) => d.data() as OrdenEntrega);
      lista.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
      onUpdate(lista);
    },
    (err) => {
      console.error('Error escuchando órdenes:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Órdenes asignadas a un repartidor (las reglas solo le permiten leer las suyas)
 */
export function escucharOrdenesRepartidor(
  repartidorUid: string,
  onUpdate: (ordenes: OrdenEntrega[]) => void,
  onError?: (error: any) => void
): () => void {
  return onSnapshot(
    query(collection(db, 'ordenes'), where('repartidorUid', '==', repartidorUid)),
    (snap) => {
      const lista = snap.docs.map((d) => d.data() as OrdenEntrega);
      lista.sort((a, b) => (a.fechaProgramada || '9999').localeCompare(b.fechaProgramada || '9999') || b.creadoEn.localeCompare(a.creadoEn));
      onUpdate(lista);
    },
    (err) => {
      console.error('Error escuchando las órdenes del repartidor:', err);
      if (onError) onError(err);
    }
  );
}

export function escucharClientes(
  granjaId: string,
  onUpdate: (clientes: Cliente[]) => void,
  onError?: (error: any) => void
): () => void {
  return onSnapshot(
    query(collection(db, 'clientes'), where('granjaId', '==', granjaId)),
    (snap) => {
      const lista = snap.docs.map((d) => ({ ...(d.data() as Cliente), id: d.id }));
      lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
      onUpdate(lista);
    },
    (err) => {
      console.error('Error escuchando clientes:', err);
      if (onError) onError(err);
    }
  );
}

export function escucharInventario(
  granjaId: string,
  onUpdate: (inventario: Record<string, InventarioLote>) => void,
  onError?: (error: any) => void
): () => void {
  return onSnapshot(
    query(collection(db, 'inventarioLotes'), where('granjaId', '==', granjaId)),
    (snap) => {
      const mapa: Record<string, InventarioLote> = {};
      snap.forEach((d) => {
        mapa[d.id] = d.data() as InventarioLote;
      });
      onUpdate(mapa);
    },
    (err) => {
      console.error('Error escuchando inventario de lotes:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Repartidores activos de la granja (cuentas con el rol de repartidor), para asignarlos a una orden
 */
export function escucharRepartidores(
  granjaId: string,
  onUpdate: (repartidores: Repartidor[]) => void,
  onError?: (error: any) => void
): () => void {
  return onSnapshot(
    query(
      collection(db, 'usuarios'),
      where('roles', 'array-contains', 'courier'),
      where('estado', '==', 'activo'),
      where('granjaId', '==', granjaId)
    ),
    (snap) => {
      const lista = snap.docs.map((d) => {
        const perfil: UsuarioPerfil = normalizarPerfil(d.data() as Partial<UsuarioPerfil>, d.id);
        return {
          uid: d.id,
          nombre: perfil.displayName || perfil.email,
          cargo: nombreFuncion(perfil, 'courier')
        };
      });
      lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
      onUpdate(lista);
    },
    (err) => {
      console.error('Error escuchando repartidores:', err);
      if (onError) onError(err);
    }
  );
}

// ---------- Clientes ----------

export async function crearCliente(nombre: string, contacto: string, granjaId: string = GRANJA_ID_PREDETERMINADA): Promise<Cliente> {
  const nombreLimpio = nombre.trim();
  if (!nombreLimpio) throw new Error('Indica el nombre del cliente.');
  const { email, uid } = sesion();
  const ref = doc(collection(db, 'clientes'));
  const ahora = new Date().toISOString();
  const cliente: Cliente = {
    id: ref.id,
    granjaId,
    nombre: nombreLimpio.slice(0, 120),
    contacto: contacto.trim().slice(0, 200),
    creadoPor: email,
    creadoPorUid: uid,
    creadoEn: ahora,
    actualizadoEn: ahora
  };
  const { id, ...datos } = cliente;
  try {
    await setDoc(ref, datos);
  } catch (err) {
    throw mensajeError('registrar el cliente', err);
  }
  return cliente;
}

// ---------- Órdenes ----------

export interface DatosOrden {
  clienteId: string;
  clienteNombre: string;
  unidad: UnidadMedida;
  cantidadSolicitada: number;
  fechaProgramada: string | null;
  cantidades: Record<string, number>; // código de lote -> cantidad a tomar de ese lote
  repartidor: Repartidor | null;
  observaciones: string;
}

function validarDatos(datos: DatosOrden): Record<string, number> {
  if (!datos.clienteId) throw new Error('Selecciona o registra el cliente.');
  if (!(datos.cantidadSolicitada > 0)) throw new Error('La cantidad solicitada debe ser mayor que 0.');
  const cantidades: Record<string, number> = {};
  for (const [codigo, valor] of Object.entries(datos.cantidades || {})) {
    const cantidad = redondear(Number(valor) || 0, datos.unidad);
    if (cantidad > 0) cantidades[codigo] = cantidad;
  }
  const lotes = Object.keys(cantidades);
  if (lotes.length > MAX_LOTES_POR_ORDEN) {
    throw new Error(`Una orden puede tomar cantidades de hasta ${MAX_LOTES_POR_ORDEN} lotes.`);
  }
  const total = redondear(Object.values(cantidades).reduce((s, c) => s + c, 0), datos.unidad);
  if (total > redondear(datos.cantidadSolicitada, datos.unidad)) {
    throw new Error(`La distribución (${total} ${datos.unidad}) supera la cantidad solicitada.`);
  }
  return cantidades;
}

/**
 * Lee los lotes de la distribución dentro de la transacción y arma la procedencia de cada uno
 * (lote + su piscina). Si reservar es true, valida la disponibilidad y prepara el movimiento del
 * inventario. Todas las lecturas se hacen antes de cualquier escritura.
 */
async function prepararProcedencias(
  tx: Transaction,
  ordenId: string,
  granjaId: string,
  unidad: UnidadMedida,
  cantidades: Record<string, number>,
  reservar: boolean
): Promise<{
  procedencias: Record<string, ProcedenciaOrden>;
  movimientos: { ref: DocumentReference; datos: InventarioLote }[];
}> {
  const procedencias: Record<string, ProcedenciaOrden> = {};
  const movimientos: { ref: DocumentReference; datos: InventarioLote }[] = [];

  for (const [codigo, cantidad] of Object.entries(cantidades)) {
    const loteSnap = await tx.get(loteRef(codigo));
    if (!loteSnap.exists()) throw new Error(`El lote ${codigo} no existe.`);
    const lote = loteSnap.data() as Lote;
    if ((lote.granjaId || GRANJA_ID_PREDETERMINADA) !== granjaId) {
      throw new Error(`El lote ${codigo} pertenece a otra granja.`);
    }
    procedencias[codigo] = { estanque: lote.estanque, cantidad, unidad };
    if (!reservar) continue;

    const invSnap = await tx.get(inventarioRef(codigo));
    const inv = invSnap.exists() ? (invSnap.data() as InventarioLote) : undefined;
    const disp = calcularDisponibilidad(lote, inv, unidad);
    if (!disp.compatible) {
      throw new Error(`El lote ${codigo} ya tiene reservas en ${disp.unidadInventario}; esta orden está en ${unidad}.`);
    }
    if (disp.cosechado <= 0) {
      throw new Error(`El lote ${codigo} no tiene cosecha registrada en ${unidad}; no hay disponibilidad verificable.`);
    }
    if (cantidad > disp.disponible) {
      throw new Error(`El lote ${codigo} solo tiene ${disp.disponible} ${unidad} disponibles (se pidieron ${cantidad}).`);
    }
    movimientos.push({
      ref: inventarioRef(codigo),
      datos: {
        codigoLote: codigo,
        granjaId,
        unidad,
        reservado: redondear(disp.reservado + cantidad, unidad),
        entregado: disp.entregado,
        ultimaOrden: ordenId,
        // Hora del servidor: las reglas comprueban con ella que el lote se movió en esta operación
        movidoEn: serverTimestamp()
      }
    });
  }
  return { procedencias, movimientos };
}

/**
 * Crea una orden. Como borrador no reserva nada; confirmada queda "asignada" y reserva en la misma
 * transacción las cantidades de cada lote.
 */
export async function crearOrden(
  datos: DatosOrden,
  confirmar: boolean,
  granjaId: string = GRANJA_ID_PREDETERMINADA
): Promise<OrdenEntrega> {
  const cantidades = validarDatos(datos);
  if (confirmar) {
    if (!datos.repartidor) throw new Error('Asigna un repartidor para confirmar la orden.');
    if (Object.keys(cantidades).length === 0) throw new Error('Distribuye la cantidad en al menos un lote.');
  }
  const { email, uid } = sesion();
  const id = generarIdOrden();

  try {
    return await runTransaction(db, async (tx) => {
      const existente = await tx.get(ordenRef(id));
      if (existente.exists()) throw new Error('Se generó un código de orden repetido. Intenta de nuevo.');

      const { procedencias, movimientos } = await prepararProcedencias(tx, id, granjaId, datos.unidad, cantidades, confirmar);
      const ahora = new Date().toISOString();
      const estado: EstadoOrden = confirmar ? 'asignado' : 'borrador';
      const cantidadAutorizada = confirmar ? sumaProcedencias(procedencias, datos.unidad) : 0;

      const orden: OrdenEntrega = {
        id,
        granjaId,
        clienteId: datos.clienteId,
        clienteNombre: datos.clienteNombre,
        creadoPor: email,
        creadoPorUid: uid,
        repartidorUid: datos.repartidor?.uid || null,
        repartidorNombre: datos.repartidor?.nombre || null,
        creadoEn: ahora,
        actualizadoEn: ahora,
        fechaProgramada: datos.fechaProgramada || null,
        unidad: datos.unidad,
        cantidadSolicitada: redondear(datos.cantidadSolicitada, datos.unidad),
        procedencias,
        cantidadAutorizada,
        cantidadEntregada: 0,
        estado,
        observaciones: datos.observaciones.trim(),
        historial: [
          nuevoEvento(
            0,
            'Creación',
            confirmar ? 'Orden creada, asignada y con cantidades reservadas' : 'Orden creada como borrador (sin reservas)',
            {
              estado,
              cliente: datos.clienteNombre,
              cantidadSolicitada: redondear(datos.cantidadSolicitada, datos.unidad),
              unidad: datos.unidad,
              procedencias,
              repartidor: datos.repartidor?.nombre || null
            }
          )
        ]
      };

      for (const m of movimientos) tx.set(m.ref, m.datos);
      tx.set(ordenRef(id), orden);
      return orden;
    });
  } catch (err) {
    console.error('Error creando la orden:', err);
    throw mensajeError(confirmar ? 'crear y asignar la orden' : 'guardar el borrador', err);
  }
}

/**
 * Modifica un borrador (cliente, cantidades, distribución, repartidor, fecha u observaciones)
 */
export async function actualizarBorrador(ordenId: string, datos: DatosOrden): Promise<void> {
  const cantidades = validarDatos(datos);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ordenRef(ordenId));
      if (!snap.exists()) throw new Error('La orden no existe.');
      const orden = snap.data() as OrdenEntrega;
      if (orden.estado !== 'borrador') throw new Error('Solo se pueden modificar órdenes en borrador.');
      const { procedencias } = await prepararProcedencias(tx, ordenId, orden.granjaId, datos.unidad, cantidades, false);
      const cambios = {
        clienteId: datos.clienteId,
        clienteNombre: datos.clienteNombre,
        unidad: datos.unidad,
        cantidadSolicitada: redondear(datos.cantidadSolicitada, datos.unidad),
        fechaProgramada: datos.fechaProgramada || null,
        procedencias,
        repartidorUid: datos.repartidor?.uid || null,
        repartidorNombre: datos.repartidor?.nombre || null,
        observaciones: datos.observaciones.trim()
      };
      tx.update(ordenRef(ordenId), {
        ...cambios,
        actualizadoEn: new Date().toISOString(),
        historial: [
          ...orden.historial,
          nuevoEvento(orden.historial.length, 'Modificación', 'Datos del borrador modificados', {
            cliente: cambios.clienteNombre,
            cantidadSolicitada: cambios.cantidadSolicitada,
            unidad: cambios.unidad,
            procedencias,
            repartidor: cambios.repartidorNombre
          })
        ]
      });
    });
  } catch (err) {
    console.error('Error modificando el borrador:', err);
    throw mensajeError('modificar el borrador', err);
  }
}

/**
 * Confirma un borrador: reserva su distribución en los lotes y lo deja asignado al repartidor
 */
export async function confirmarBorrador(ordenId: string): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ordenRef(ordenId));
      if (!snap.exists()) throw new Error('La orden no existe.');
      const orden = snap.data() as OrdenEntrega;
      if (orden.estado !== 'borrador') throw new Error('Solo se confirman órdenes en borrador.');
      if (!orden.repartidorUid) throw new Error('Asigna un repartidor antes de confirmar la orden.');
      const cantidades = Object.fromEntries(
        Object.entries(orden.procedencias || {}).map(([codigo, p]) => [codigo, p.cantidad])
      );
      if (Object.keys(cantidades).length === 0) throw new Error('Distribuye la cantidad en al menos un lote.');

      const { procedencias, movimientos } = await prepararProcedencias(
        tx, ordenId, orden.granjaId, orden.unidad, cantidades, true
      );
      const cantidadAutorizada = sumaProcedencias(procedencias, orden.unidad);
      for (const m of movimientos) tx.set(m.ref, m.datos);
      tx.update(ordenRef(ordenId), {
        estado: 'asignado',
        procedencias,
        cantidadAutorizada,
        actualizadoEn: new Date().toISOString(),
        historial: [
          ...orden.historial,
          nuevoEvento(orden.historial.length, 'Asignación y reserva', 'Orden confirmada: cantidades reservadas y repartidor asignado', {
            procedencias,
            cantidadAutorizada,
            unidad: orden.unidad,
            repartidor: orden.repartidorNombre
          })
        ]
      });
    });
  } catch (err) {
    console.error('Error confirmando la orden:', err);
    throw mensajeError('confirmar la orden', err);
  }
}

/**
 * Cambia el repartidor de una orden que aún no está en ruta
 */
export async function cambiarRepartidor(ordenId: string, repartidor: Repartidor, motivo: string): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ordenRef(ordenId));
      if (!snap.exists()) throw new Error('La orden no existe.');
      const orden = snap.data() as OrdenEntrega;
      if (!['borrador', 'asignado', 'en_preparacion', 'requiere_revision'].includes(orden.estado)) {
        throw new Error(`No se puede cambiar el repartidor de una orden ${ETIQUETA_ESTADO_ORDEN[orden.estado].toLowerCase()}.`);
      }
      if (orden.repartidorUid === repartidor.uid) throw new Error('Ese repartidor ya está asignado.');
      if (orden.estado !== 'borrador' && !motivo.trim()) throw new Error('Indica el motivo del cambio de repartidor.');
      tx.update(ordenRef(ordenId), {
        repartidorUid: repartidor.uid,
        repartidorNombre: repartidor.nombre,
        actualizadoEn: new Date().toISOString(),
        historial: [
          ...orden.historial,
          nuevoEvento(orden.historial.length, 'Cambio de repartidor', motivo.trim(), {
            anterior: orden.repartidorNombre,
            nuevo: repartidor.nombre
          })
        ]
      });
    });
  } catch (err) {
    console.error('Error cambiando el repartidor:', err);
    throw mensajeError('cambiar el repartidor', err);
  }
}

/**
 * Cambia el estado según las transiciones permitidas. Cancelar una orden con reservas las libera
 * en los lotes dentro de la misma transacción.
 */
export async function cambiarEstadoOrden(ordenId: string, nuevoEstado: EstadoOrden, motivo: string): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ordenRef(ordenId));
      if (!snap.exists()) throw new Error('La orden no existe.');
      const orden = snap.data() as OrdenEntrega;
      if (!(TRANSICIONES_MANUALES[orden.estado] || []).includes(nuevoEstado)) {
        throw new Error(
          `No se puede pasar de "${ETIQUETA_ESTADO_ORDEN[orden.estado]}" a "${ETIQUETA_ESTADO_ORDEN[nuevoEstado]}".`
        );
      }
      if ((nuevoEstado === 'cancelado' || nuevoEstado === 'requiere_revision') && !motivo.trim()) {
        throw new Error('Indica el motivo.');
      }

      const ahora = new Date().toISOString();
      const liberar = nuevoEstado === 'cancelado' && ESTADOS_CON_RESERVA.includes(orden.estado);
      const movimientos: { ref: DocumentReference; datos: Partial<InventarioLote> }[] = [];
      if (liberar) {
        for (const [codigo, p] of Object.entries(orden.procedencias || {})) {
          const invSnap = await tx.get(inventarioRef(codigo));
          if (!invSnap.exists()) throw new Error(`No se encontró el inventario del lote ${codigo}.`);
          const inv = invSnap.data() as InventarioLote;
          movimientos.push({
            ref: inventarioRef(codigo),
            datos: {
              reservado: Math.max(0, redondear(inv.reservado - p.cantidad, inv.unidad)),
              ultimaOrden: ordenId,
              movidoEn: serverTimestamp()
            }
          });
        }
      }

      for (const m of movimientos) tx.update(m.ref, m.datos);
      tx.update(ordenRef(ordenId), {
        estado: nuevoEstado,
        actualizadoEn: ahora,
        historial: [
          ...orden.historial,
          nuevoEvento(
            orden.historial.length,
            nuevoEstado === 'cancelado' ? 'Cancelación' : 'Cambio de estado',
            motivo.trim(),
            {
              de: orden.estado,
              a: nuevoEstado,
              ...(liberar ? { liberado: orden.procedencias, unidad: orden.unidad } : {})
            }
          )
        ]
      });
    });
  } catch (err) {
    console.error('Error cambiando el estado de la orden:', err);
    throw mensajeError('cambiar el estado de la orden', err);
  }
}
