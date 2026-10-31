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
  EstadoAtencion,
  EstadoOrden,
  EventoOrden,
  InventarioLote,
  Lote,
  OrdenEntrega,
  ProcedenciaOrden,
  RolFuncional,
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

// Cambios de estado que el operador hace a mano (las mismas parejas que permiten las reglas). Borrador
// pasa a asignado al confirmar la orden. Iniciar la ruta, llegar y entregar son acciones del
// repartidor; una entrega parcial se resuelve reprogramando o liberando el saldo.
export const TRANSICIONES_MANUALES: Partial<Record<EstadoOrden, EstadoOrden[]>> = {
  borrador: ['cancelado'],
  asignado: ['en_preparacion', 'requiere_revision', 'cancelado'],
  en_preparacion: ['requiere_revision', 'cancelado'],
  en_ruta: ['requiere_revision', 'cancelado'],
  requiere_revision: ['asignado', 'en_preparacion', 'cancelado']
};

// Función con la que se trabaja en esta sesión (la fija App): queda en cada evento del historial
let funcionActiva: RolFuncional | null = null;

export function establecerFuncionActiva(funcion: RolFuncional | null): void {
  funcionActiva = funcion;
}

export function generarId(prefijo: string): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${prefijo}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

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
  return Math.max(
    0,
    redondear(orden.cantidadAutorizada - orden.cantidadEntregada - (orden.cantidadLiberada || 0), orden.unidad)
  );
}

export function mensajeError(accion: string, err: any): Error {
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

export function nuevoEvento(
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
    datos,
    eventoId: generarId('ev'),
    ...(funcionActiva ? { funcion: funcionActiva } : {})
  };
}

/**
 * Lo que falta por entregar de un lote de la orden (lo que sigue reservado a su nombre)
 */
export function saldoLote(orden: OrdenEntrega, codigo: string): number {
  const p = orden.procedencias?.[codigo];
  if (!p) return 0;
  return Math.max(0, redondear(p.cantidad - (orden.entregadoPorLote?.[codigo] || 0), orden.unidad));
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

export async function crearCliente(
  nombre: string,
  contacto: string,
  direccion: string,
  granjaId: string = GRANJA_ID_PREDETERMINADA
): Promise<Cliente> {
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
    direccion: direccion.trim().slice(0, 300),
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
  clienteDireccion: string; // se copia en la orden para el repartidor
  clienteContacto: string;
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
        movidoEn: serverTimestamp(),
        tipoMovimiento: 'reserva'
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
        clienteDireccion: datos.clienteDireccion.slice(0, 300),
        clienteContacto: datos.clienteContacto.slice(0, 200),
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
        clienteDireccion: datos.clienteDireccion.slice(0, 300),
        clienteContacto: datos.clienteContacto.slice(0, 200),
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
        movimientos.push(...(await liberarSaldos(tx, orden, ordenId)));
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
              ...(liberar ? { liberado: saldosPorLote(orden), unidad: orden.unidad } : {})
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

// ---------- Saldos de entregas parciales y ajustes de distribución (operador) ----------

/**
 * Saldo por entregar de cada lote de la orden (solo los lotes que aún tienen saldo)
 */
export function saldosPorLote(orden: OrdenEntrega): Record<string, number> {
  const saldos: Record<string, number> = {};
  for (const codigo of Object.keys(orden.procedencias || {})) {
    const saldo = saldoLote(orden, codigo);
    if (saldo > 0) saldos[codigo] = saldo;
  }
  return saldos;
}

/**
 * Movimientos que devuelven al lote lo que la orden tenía reservado y no se entregó
 */
async function liberarSaldos(
  tx: Transaction,
  orden: OrdenEntrega,
  ordenId: string
): Promise<{ ref: DocumentReference; datos: Partial<InventarioLote> }[]> {
  const movimientos: { ref: DocumentReference; datos: Partial<InventarioLote> }[] = [];
  for (const [codigo, saldo] of Object.entries(saldosPorLote(orden))) {
    const invSnap = await tx.get(inventarioRef(codigo));
    if (!invSnap.exists()) throw new Error(`No se encontró el inventario del lote ${codigo}.`);
    const inv = invSnap.data() as InventarioLote;
    movimientos.push({
      ref: inventarioRef(codigo),
      datos: {
        reservado: Math.max(0, redondear(inv.reservado - saldo, inv.unidad)),
        ultimaOrden: ordenId,
        movidoEn: serverTimestamp(),
        tipoMovimiento: 'liberacion'
      }
    });
  }
  return movimientos;
}

/**
 * Entrega parcial: el saldo vuelve a asignado para que el repartidor (el mismo u otro) lo entregue
 * en una nueva ruta. Las reservas del saldo se mantienen.
 */
export async function reprogramarSaldo(ordenId: string, motivo: string, repartidor?: Repartidor | null): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ordenRef(ordenId));
      if (!snap.exists()) throw new Error('La orden no existe.');
      const orden = snap.data() as OrdenEntrega;
      if (orden.estado !== 'entrega_parcial') throw new Error('Solo se reprograma el saldo de una entrega parcial.');
      const nuevoRepartidor = repartidor && repartidor.uid !== orden.repartidorUid ? repartidor : null;
      tx.update(ordenRef(ordenId), {
        estado: 'asignado',
        rutaIniciadaEn: null,
        llegadaEn: null,
        ...(nuevoRepartidor ? { repartidorUid: nuevoRepartidor.uid, repartidorNombre: nuevoRepartidor.nombre } : {}),
        actualizadoEn: new Date().toISOString(),
        historial: [
          ...orden.historial,
          nuevoEvento(orden.historial.length, 'Reprogramación de saldo', motivo.trim(), {
            saldo: saldosPorLote(orden),
            unidad: orden.unidad,
            repartidorAnterior: orden.repartidorNombre,
            repartidor: nuevoRepartidor?.nombre || orden.repartidorNombre
          })
        ]
      });
    });
  } catch (err) {
    console.error('Error reprogramando el saldo:', err);
    throw mensajeError('reprogramar el saldo', err);
  }
}

/**
 * Entrega parcial: libera el saldo no entregado (vuelve a estar disponible en los lotes) y cierra la
 * orden como entregada, registrando la cantidad liberada
 */
export async function liberarSaldoYCerrar(ordenId: string, motivo: string): Promise<void> {
  if (!motivo.trim()) throw new Error('Indica el motivo para liberar el saldo.');
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ordenRef(ordenId));
      if (!snap.exists()) throw new Error('La orden no existe.');
      const orden = snap.data() as OrdenEntrega;
      if (orden.estado !== 'entrega_parcial') throw new Error('Solo se libera el saldo de una entrega parcial.');
      const movimientos = await liberarSaldos(tx, orden, ordenId);
      const cantidadLiberada = redondear(orden.cantidadAutorizada - orden.cantidadEntregada, orden.unidad);
      for (const m of movimientos) tx.update(m.ref, m.datos);
      tx.update(ordenRef(ordenId), {
        estado: 'entregado',
        cantidadLiberada,
        actualizadoEn: new Date().toISOString(),
        historial: [
          ...orden.historial,
          nuevoEvento(orden.historial.length, 'Cierre con saldo liberado', motivo.trim(), {
            liberado: saldosPorLote(orden),
            cantidadLiberada,
            unidad: orden.unidad
          })
        ]
      });
    });
  } catch (err) {
    console.error('Error liberando el saldo:', err);
    throw mensajeError('liberar el saldo', err);
  }
}

/**
 * Rechaza una solicitud de ajuste: la distribución y las reservas no cambian
 */
export async function rechazarAjuste(ordenId: string, ajusteId: string, respuesta: string): Promise<void> {
  if (!respuesta.trim()) throw new Error('Indica el motivo del rechazo.');
  const { email, uid } = sesion();
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ordenRef(ordenId));
      if (!snap.exists()) throw new Error('La orden no existe.');
      const orden = snap.data() as OrdenEntrega;
      const ajuste = orden.ajustes?.[ajusteId];
      if (!ajuste || ajuste.estado !== 'pendiente_aprobacion') throw new Error('La solicitud ya no está pendiente.');
      if (ajuste.solicitadoPorUid === uid) throw new Error('No puedes resolver una solicitud que hiciste tú.');
      tx.update(ordenRef(ordenId), {
        [`ajustes.${ajusteId}`]: {
          ...ajuste,
          estado: 'rechazada',
          resueltoPor: email,
          resueltoPorUid: uid,
          resueltoEn: new Date().toISOString(),
          respuesta: respuesta.trim().slice(0, 1000)
        },
        actualizadoEn: new Date().toISOString(),
        historial: [
          ...orden.historial,
          nuevoEvento(orden.historial.length, 'Ajuste rechazado', respuesta.trim(), {
            ajusteId,
            propuesta: ajuste.propuesta,
            solicitadoPor: ajuste.solicitadoPor
          })
        ]
      });
    });
  } catch (err) {
    console.error('Error rechazando el ajuste:', err);
    throw mensajeError('rechazar la solicitud', err);
  }
}

/**
 * Aprueba una solicitud de ajuste y la aplica en la misma transacción: vuelve a validar la
 * disponibilidad de cada lote, mueve las reservas por la diferencia y deja la nueva distribución.
 * Si algún lote no tiene disponibilidad, no se aplica nada y la solicitud sigue pendiente.
 */
export async function aprobarAjuste(ordenId: string, ajusteId: string, respuesta: string): Promise<void> {
  const { email, uid } = sesion();
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ordenRef(ordenId));
      if (!snap.exists()) throw new Error('La orden no existe.');
      const orden = snap.data() as OrdenEntrega;
      const ajuste = orden.ajustes?.[ajusteId];
      if (!ajuste || ajuste.estado !== 'pendiente_aprobacion') throw new Error('La solicitud ya no está pendiente.');
      if (ajuste.solicitadoPorUid === uid) throw new Error('No puedes aprobar una solicitud que hiciste tú.');
      if (!ESTADOS_CON_RESERVA.includes(orden.estado)) {
        throw new Error(`No se aplican ajustes a una orden ${ETIQUETA_ESTADO_ORDEN[orden.estado].toLowerCase()}.`);
      }
      if (orden.cantidadEntregada > 0) {
        throw new Error('La orden ya tiene entregas registradas; resuelve el saldo en su lugar.');
      }

      const nuevas: Record<string, ProcedenciaOrden> = {};
      const movimientos: { ref: DocumentReference; datos: Partial<InventarioLote>; crear: boolean }[] = [];
      const codigos = Array.from(new Set([...Object.keys(orden.procedencias), ...Object.keys(ajuste.propuesta)]));

      // Primero todas las lecturas: lotes que entran o aumentan, e inventarios de los lotes que cambian
      for (const codigo of codigos) {
        const antes = orden.procedencias[codigo]?.cantidad || 0;
        const despues = redondear(Number(ajuste.propuesta[codigo]) || 0, orden.unidad);
        let estanque = orden.procedencias[codigo]?.estanque;
        let lote: Lote | null = null;
        if (despues > antes) {
          const loteSnap = await tx.get(loteRef(codigo));
          if (!loteSnap.exists()) throw new Error(`El lote ${codigo} no existe.`);
          lote = loteSnap.data() as Lote;
          if ((lote.granjaId || GRANJA_ID_PREDETERMINADA) !== orden.granjaId) {
            throw new Error(`El lote ${codigo} pertenece a otra granja.`);
          }
          estanque = lote.estanque;
        }
        if (despues > 0) nuevas[codigo] = { estanque: estanque as string, cantidad: despues, unidad: orden.unidad };
        const diferencia = redondear(despues - antes, orden.unidad);
        if (diferencia === 0) continue;

        const invSnap = await tx.get(inventarioRef(codigo));
        const inv = invSnap.exists() ? (invSnap.data() as InventarioLote) : undefined;
        if (diferencia > 0) {
          const disp = calcularDisponibilidad(lote as Lote, inv, orden.unidad);
          if (!disp.compatible) throw new Error(`El lote ${codigo} tiene reservas en ${disp.unidadInventario}.`);
          if (disp.cosechado <= 0) throw new Error(`El lote ${codigo} no tiene cosecha registrada en ${orden.unidad}.`);
          if (diferencia > disp.disponible) {
            throw new Error(
              `El lote ${codigo} solo tiene ${disp.disponible} ${orden.unidad} disponibles (se necesitan ${diferencia} más).`
            );
          }
        } else if (!inv) {
          throw new Error(`No se encontró el inventario del lote ${codigo}.`);
        }
        movimientos.push({
          ref: inventarioRef(codigo),
          crear: !inv,
          datos: inv
            ? {
                reservado: Math.max(0, redondear(inv.reservado + diferencia, orden.unidad)),
                ultimaOrden: ordenId,
                movidoEn: serverTimestamp(),
                tipoMovimiento: 'ajuste'
              }
            : {
                codigoLote: codigo,
                granjaId: orden.granjaId,
                unidad: orden.unidad,
                reservado: diferencia,
                entregado: 0,
                ultimaOrden: ordenId,
                movidoEn: serverTimestamp(),
                tipoMovimiento: 'ajuste'
              }
        });
      }
      if (Object.keys(nuevas).length === 0) throw new Error('La propuesta no deja ningún lote con cantidad.');

      const cantidadAutorizada = sumaProcedencias(nuevas, orden.unidad);
      for (const m of movimientos) {
        if (m.crear) tx.set(m.ref, m.datos);
        else tx.update(m.ref, m.datos);
      }
      tx.update(ordenRef(ordenId), {
        procedencias: nuevas,
        cantidadAutorizada,
        [`ajustes.${ajusteId}`]: {
          ...ajuste,
          estado: 'aplicada',
          resueltoPor: email,
          resueltoPorUid: uid,
          resueltoEn: new Date().toISOString(),
          respuesta: respuesta.trim().slice(0, 1000)
        },
        actualizadoEn: new Date().toISOString(),
        historial: [
          ...orden.historial,
          nuevoEvento(orden.historial.length, 'Ajuste aplicado', respuesta.trim() || 'Solicitud de ajuste aprobada y aplicada', {
            ajusteId,
            anterior: orden.procedencias,
            nueva: nuevas,
            cantidadAutorizadaAnterior: orden.cantidadAutorizada,
            cantidadAutorizada,
            solicitadoPor: ajuste.solicitadoPor
          })
        ]
      });
    });
  } catch (err) {
    console.error('Error aplicando el ajuste:', err);
    throw mensajeError('aprobar y aplicar la solicitud', err);
  }
}

// ---------- Atención de novedades (fase 4) ----------

/**
 * Cambia el estado de atención de una novedad del repartidor y registra la observación del
 * operador en el historial. La novedad original y el estado de la orden no cambian.
 */
export async function atenderNovedad(
  ordenId: string,
  novedadId: string,
  estado: EstadoAtencion,
  observacion: string
): Promise<void> {
  const { email, uid } = sesion();
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ordenRef(ordenId));
      if (!snap.exists()) throw new Error('La orden no existe.');
      const orden = snap.data() as OrdenEntrega;
      const novedadIndice = orden.historial.findIndex((e) => e.tipo === 'Novedad' && e.eventoId === novedadId);
      if (novedadIndice < 0) throw new Error('La novedad no existe en esta orden.');
      const anterior = orden.atencionNovedades?.[novedadId]?.estado || 'pendiente';
      if (anterior === estado && !observacion.trim()) throw new Error('Cambia el estado o escribe una observación.');
      const ahora = new Date().toISOString();
      tx.update(ordenRef(ordenId), {
        [`atencionNovedades.${novedadId}`]: { estado, actualizadoPor: email, actualizadoPorUid: uid, actualizadoEn: ahora },
        actualizadoEn: ahora,
        historial: [
          ...orden.historial,
          nuevoEvento(orden.historial.length, 'Atención de novedad', observacion.trim().slice(0, 1000), {
            novedadId,
            novedadIndice,
            estadoAnterior: anterior,
            estado
          })
        ]
      });
    });
  } catch (err) {
    console.error('Error atendiendo la novedad:', err);
    throw mensajeError('registrar la atención de la novedad', err);
  }
}
