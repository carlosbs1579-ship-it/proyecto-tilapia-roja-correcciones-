import {
  AjusteDistribucion,
  EstadoAtencion,
  EstadoOrden,
  EventoOrden,
  InventarioLote,
  Lote,
  OrdenEntrega
} from '../types';
import { ETIQUETA_ESTADO_ORDEN, Repartidor, calcularDisponibilidad, cantidadCosechada, redondear } from './pedidosService';
import { getFechaHoyBogota } from '../utils/constants';

// Cálculos del panel de gestión de entregas. Todo se deriva de los datos reales que ya escucha la
// pestaña (órdenes, lotes, inventario y repartidores en tiempo real): no hay valores simulados ni
// lecturas adicionales a Firebase. El historial de cada orden es la única fuente de auditoría.

export const ETIQUETA_ATENCION: Record<EstadoAtencion, string> = {
  pendiente: 'Pendiente de revisión',
  en_revision: 'En revisión',
  atendida: 'Atendida',
  cerrada: 'Cerrada'
};

const ESTADOS_ABIERTOS: EstadoOrden[] = ['asignado', 'en_preparacion', 'en_ruta', 'entrega_parcial', 'requiere_revision'];

/**
 * Día (YYYY-MM-DD) en Colombia de una fecha ISO. Recortar el texto ISO daría el día en UTC, que
 * entre las 7 p. m. y la medianoche de Colombia ya es el día siguiente.
 */
export function diaBogota(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// ---------- Novedades ----------

export interface NovedadRegistrada {
  orden: OrdenEntrega;
  evento: EventoOrden;
  categoria: string;
  atencion: EstadoAtencion;
  atendidaPor?: string;
  atendidaEn?: string;
  seguimiento: EventoOrden[]; // eventos "Atención de novedad" sobre esta novedad
}

export function novedadesDeOrden(orden: OrdenEntrega): NovedadRegistrada[] {
  const historial = orden.historial || [];
  return historial
    .filter((e) => e.tipo === 'Novedad')
    .map((evento) => {
      const id = evento.eventoId || '';
      const atencion = id ? orden.atencionNovedades?.[id] : undefined;
      return {
        orden,
        evento,
        categoria: evento.datos?.categoria || (evento.descripcion.split(':')[0] || 'Novedad'),
        atencion: atencion?.estado || 'pendiente',
        atendidaPor: atencion?.actualizadoPor,
        atendidaEn: atencion?.actualizadoEn,
        seguimiento: historial.filter((e) => e.tipo === 'Atención de novedad' && e.datos?.novedadId === id)
      };
    });
}

export function todasLasNovedades(ordenes: OrdenEntrega[]): NovedadRegistrada[] {
  return ordenes
    .flatMap(novedadesDeOrden)
    .sort((a, b) => b.evento.fecha.localeCompare(a.evento.fecha));
}

const novedadAbierta = (n: NovedadRegistrada) => n.atencion === 'pendiente' || n.atencion === 'en_revision';

// ---------- Solicitudes de ajuste ----------

export interface SolicitudRegistrada {
  orden: OrdenEntrega;
  ajuste: AjusteDistribucion;
}

export function todasLasSolicitudes(ordenes: OrdenEntrega[]): SolicitudRegistrada[] {
  return ordenes
    .flatMap((orden) => Object.values(orden.ajustes || {}).map((ajuste) => ({ orden, ajuste })))
    .sort((a, b) => b.ajuste.solicitadoEn.localeCompare(a.ajuste.solicitadoEn));
}

export interface DiferenciaAjuste {
  codigoLote: string;
  original: number;
  propuesta: number;
  diferencia: number; // positiva: hay que reservar más; negativa: se libera
  disponible: number | null; // disponibilidad actual del lote (solo si la diferencia es positiva)
  suficiente: boolean;
  motivo?: string; // por qué no alcanza (lote inexistente, sin cosecha, otra unidad...)
}

/**
 * Vista previa de un ajuste: qué cambia en cada lote y si la disponibilidad actual alcanza. Es
 * orientativa (datos en tiempo real); al aprobar, la transacción y las reglas lo vuelven a validar.
 */
export function diferenciasAjuste(
  orden: OrdenEntrega,
  ajuste: AjusteDistribucion,
  lotes: Lote[],
  inventario: Record<string, InventarioLote>
): DiferenciaAjuste[] {
  const codigos = Array.from(new Set([...Object.keys(orden.procedencias || {}), ...Object.keys(ajuste.propuesta)]));
  return codigos.map((codigoLote) => {
    // Se compara con la distribución vigente (puede diferir de la original si hubo otro ajuste)
    const original = orden.procedencias?.[codigoLote]?.cantidad || 0;
    const propuesta = redondear(Number(ajuste.propuesta[codigoLote]) || 0, orden.unidad);
    const diferencia = redondear(propuesta - original, orden.unidad);
    if (diferencia <= 0) return { codigoLote, original, propuesta, diferencia, disponible: null, suficiente: true };
    const lote = lotes.find((l) => l.codigo === codigoLote);
    if (!lote) return { codigoLote, original, propuesta, diferencia, disponible: null, suficiente: false, motivo: 'El lote no existe o no es visible.' };
    if ((lote.granjaId || 'cultivos-lore') !== orden.granjaId) {
      return { codigoLote, original, propuesta, diferencia, disponible: null, suficiente: false, motivo: 'El lote es de otra granja.' };
    }
    const disp = calcularDisponibilidad(lote, inventario[codigoLote], orden.unidad);
    if (!disp.compatible) {
      return { codigoLote, original, propuesta, diferencia, disponible: 0, suficiente: false, motivo: `Reservado en ${disp.unidadInventario}.` };
    }
    if (disp.cosechado <= 0) {
      return { codigoLote, original, propuesta, diferencia, disponible: 0, suficiente: false, motivo: 'Sin cosecha registrada.' };
    }
    return {
      codigoLote,
      original,
      propuesta,
      diferencia,
      disponible: disp.disponible,
      suficiente: diferencia <= disp.disponible,
      motivo: diferencia <= disp.disponible ? undefined : 'No hay disponibilidad suficiente.'
    };
  });
}

// ---------- Alertas ----------

export type TipoAlerta =
  | 'sin_iniciar_ruta'
  | 'retraso'
  | 'entrega_parcial'
  | 'requiere_revision'
  | 'ajuste_pendiente'
  | 'novedad_abierta'
  | 'conflicto_disponibilidad';

export const ETIQUETA_ALERTA: Record<TipoAlerta, string> = {
  sin_iniciar_ruta: 'Programado para hoy sin iniciar ruta',
  retraso: 'Fecha de entrega vencida',
  entrega_parcial: 'Entrega parcial con saldo pendiente',
  requiere_revision: 'Pedido en revisión',
  ajuste_pendiente: 'Solicitud de ajuste sin resolver',
  novedad_abierta: 'Novedad sin atender',
  conflicto_disponibilidad: 'Conflicto de disponibilidad'
};

export interface Alerta {
  id: string;
  tipo: TipoAlerta;
  ordenId?: string;
  codigoLote?: string;
  detalle: string;
}

/**
 * Alertas basadas solo en condiciones verificables. Sin fecha programada no se calcula retraso ni
 * ruta pendiente (no se inventa una fecha). Cuando la condición deja de cumplirse la alerta
 * desaparece; lo ocurrido queda en el historial de la orden.
 */
export function calcularAlertas(
  ordenes: OrdenEntrega[],
  lotes: Lote[],
  inventario: Record<string, InventarioLote>,
  hoy: string = getFechaHoyBogota()
): Alerta[] {
  const alertas: Alerta[] = [];
  for (const o of ordenes) {
    const fecha = o.fechaProgramada;
    if (fecha && ['asignado', 'en_preparacion'].includes(o.estado) && fecha === hoy) {
      alertas.push({ id: `${o.id}-ruta`, tipo: 'sin_iniciar_ruta', ordenId: o.id, detalle: `Programado para hoy (${fecha}) y la ruta no ha iniciado.` });
    }
    if (fecha && ESTADOS_ABIERTOS.includes(o.estado) && fecha < hoy) {
      alertas.push({ id: `${o.id}-retraso`, tipo: 'retraso', ordenId: o.id, detalle: `Debía entregarse el ${fecha}.` });
    }
    if (o.estado === 'entrega_parcial') {
      const saldo = redondear(o.cantidadAutorizada - o.cantidadEntregada - (o.cantidadLiberada || 0), o.unidad);
      alertas.push({ id: `${o.id}-parcial`, tipo: 'entrega_parcial', ordenId: o.id, detalle: `Faltan ${saldo.toLocaleString('es-CO')} ${o.unidad} por decidir.` });
    }
    if (o.estado === 'requiere_revision') {
      alertas.push({ id: `${o.id}-revision`, tipo: 'requiere_revision', ordenId: o.id, detalle: 'El pedido está marcado para revisión.' });
    }
    for (const a of Object.values(o.ajustes || {})) {
      if (a.estado === 'pendiente_aprobacion') {
        alertas.push({ id: `${o.id}-${a.id}`, tipo: 'ajuste_pendiente', ordenId: o.id, detalle: `Solicitada por ${a.solicitadoPor}.` });
      }
    }
    for (const n of novedadesDeOrden(o)) {
      if (novedadAbierta(n)) {
        alertas.push({ id: `${o.id}-${n.evento.eventoId}`, tipo: 'novedad_abierta', ordenId: o.id, detalle: n.evento.descripcion });
      }
    }
  }
  // Conflictos de disponibilidad: lo comprometido en un lote supera su cosecha registrada (por
  // ejemplo, si la cosecha se corrigió a la baja después de reservar)
  for (const [codigo, inv] of Object.entries(inventario)) {
    const lote = lotes.find((l) => l.codigo === codigo);
    if (!lote) continue;
    const cosechado = cantidadCosechada(lote, inv.unidad);
    const comprometido = redondear((inv.reservado || 0) + (inv.entregado || 0), inv.unidad);
    if (comprometido > cosechado + 0.000001 || inv.reservado < -0.000001) {
      alertas.push({
        id: `lote-${codigo}`,
        tipo: 'conflicto_disponibilidad',
        codigoLote: codigo,
        detalle: `Lote ${codigo}: comprometido ${comprometido.toLocaleString('es-CO')} ${inv.unidad} y cosechado ${cosechado.toLocaleString('es-CO')}.`
      });
    }
  }
  return alertas;
}

// ---------- Indicadores ----------

export type Indicador =
  | 'total'
  | 'pendientes'
  | 'asignados'
  | 'en_preparacion'
  | 'en_ruta'
  | 'entrega_parcial'
  | 'entregados'
  | 'atencion';

export const DEFINICION_INDICADOR: Record<Indicador, { etiqueta: string; ayuda: string }> = {
  total: { etiqueta: 'Total de pedidos', ayuda: 'Todas las órdenes de la granja' },
  pendientes: { etiqueta: 'Pendientes', ayuda: 'Borradores sin confirmar ni reservar' },
  asignados: { etiqueta: 'Asignados', ayuda: 'Confirmados, con repartidor y reservas' },
  en_preparacion: { etiqueta: 'En preparación', ayuda: 'Preparándose en la granja' },
  en_ruta: { etiqueta: 'En ruta', ayuda: 'El repartidor inició la ruta' },
  entrega_parcial: { etiqueta: 'Entregas parciales', ayuda: 'Con saldo pendiente por decidir' },
  entregados: { etiqueta: 'Entregas completadas', ayuda: 'Entregadas (incluye cierres con saldo liberado)' },
  atencion: { etiqueta: 'Requieren atención', ayuda: 'Con alguna alerta activa o en revisión' }
};

export function cumpleIndicador(o: OrdenEntrega, indicador: Indicador, ordenesConAlerta: Set<string>): boolean {
  switch (indicador) {
    case 'total': return true;
    case 'pendientes': return o.estado === 'borrador';
    case 'asignados': return o.estado === 'asignado';
    case 'en_preparacion': return o.estado === 'en_preparacion';
    case 'en_ruta': return o.estado === 'en_ruta';
    case 'entrega_parcial': return o.estado === 'entrega_parcial';
    case 'entregados': return o.estado === 'entregado';
    case 'atencion': return ordenesConAlerta.has(o.id);
  }
}

// ---------- Supervisión de repartidores ----------

export interface ResumenRepartidor {
  uid: string;
  nombre: string;
  cargo: string | null; // nombre visible; null si ya no figura como repartidor activo
  activo: boolean;
  asignados: number; // total de órdenes asignadas (sin borradores)
  pendientes: number; // asignado o en preparación
  enRuta: number;
  parciales: number;
  completadas: number;
  novedades: number;
  ultimaActividad: string | null;
}

/**
 * Resumen por repartidor a partir de las órdenes (y de sus eventos registrados). No hay
 * geolocalización: la actividad son solo las acciones que el repartidor registró.
 */
export function resumenRepartidores(ordenes: OrdenEntrega[], repartidores: Repartidor[]): ResumenRepartidor[] {
  const mapa = new Map<string, ResumenRepartidor>();
  for (const r of repartidores) {
    mapa.set(r.uid, {
      uid: r.uid, nombre: r.nombre, cargo: r.cargo, activo: true, asignados: 0, pendientes: 0, enRuta: 0,
      parciales: 0, completadas: 0, novedades: 0, ultimaActividad: null
    });
  }
  for (const o of ordenes) {
    if (!o.repartidorUid || o.estado === 'borrador') continue;
    if (!mapa.has(o.repartidorUid)) {
      mapa.set(o.repartidorUid, {
        uid: o.repartidorUid, nombre: o.repartidorNombre || o.repartidorUid, cargo: null, activo: false, asignados: 0,
        pendientes: 0, enRuta: 0, parciales: 0, completadas: 0, novedades: 0, ultimaActividad: null
      });
    }
    const r = mapa.get(o.repartidorUid)!;
    r.asignados += 1;
    if (o.estado === 'asignado' || o.estado === 'en_preparacion') r.pendientes += 1;
    if (o.estado === 'en_ruta') r.enRuta += 1;
    if (o.estado === 'entrega_parcial') r.parciales += 1;
    if (o.estado === 'entregado') r.completadas += 1;
  }
  // Novedades y última actividad: eventos registrados por cada repartidor (en cualquier orden)
  for (const o of ordenes) {
    for (const e of o.historial || []) {
      const r = mapa.get(e.registradoPorUid);
      if (!r || e.funcion !== 'courier') continue;
      if (e.tipo === 'Novedad') r.novedades += 1;
      if (!r.ultimaActividad || e.fecha > r.ultimaActividad) r.ultimaActividad = e.fecha;
    }
  }
  return Array.from(mapa.values()).sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre));
}

// ---------- Historial general ----------

export interface EventoConOrden {
  orden: OrdenEntrega;
  evento: EventoOrden;
}

export function historialGeneral(ordenes: OrdenEntrega[]): EventoConOrden[] {
  return ordenes
    .flatMap((orden) => (orden.historial || []).map((evento) => ({ orden, evento })))
    .sort((a, b) => b.evento.fecha.localeCompare(a.evento.fecha));
}

/**
 * Valores anterior y nuevo de un evento, cuando el evento los registra
 */
export function cambiosDeEvento(e: EventoOrden): string | null {
  const d = e.datos || {};
  const estadoOrden = (v: string) => ETIQUETA_ESTADO_ORDEN[v as EstadoOrden] || v;
  const estadoAtencion = (v: string) => ETIQUETA_ATENCION[v as EstadoAtencion] || v;
  if (d.de !== undefined && d.a !== undefined) return `${estadoOrden(d.de)} → ${estadoOrden(d.a)}`;
  if (e.tipo === 'Atención de novedad' && d.estadoAnterior !== undefined) {
    return `${estadoAtencion(d.estadoAnterior)} → ${estadoAtencion(d.estado)}`;
  }
  if (d.anterior !== undefined && d.nuevo !== undefined && typeof d.anterior === 'string') return `${d.anterior || '—'} → ${d.nuevo}`;
  if (d.estadoAnterior !== undefined && d.estado !== undefined) return `${d.estadoAnterior} → ${d.estado}`;
  if (d.cantidadAutorizadaAnterior !== undefined && d.cantidadAutorizada !== undefined) {
    return `autorizado ${d.cantidadAutorizadaAnterior} → ${d.cantidadAutorizada}`;
  }
  if (d.repartidorAnterior !== undefined && d.repartidor !== undefined && d.repartidorAnterior !== d.repartidor) {
    return `${d.repartidorAnterior} → ${d.repartidor}`;
  }
  if (d.entregas) {
    return Object.entries(d.entregas as Record<string, number>).map(([c, n]) => `${c}: ${n}`).join(', ') + (d.faltante ? ` (faltan ${d.faltante})` : '');
  }
  return null;
}
