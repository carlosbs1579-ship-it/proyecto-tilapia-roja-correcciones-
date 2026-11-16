import { collection, doc, getDoc, onSnapshot, query, runTransaction, where } from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseConfig';
import { BloqueAnulacion, ComprobanteEntrega, ConsultaEntrega, EventoOrden, OrdenEntrega } from '../types';
import { calcularSha256, jsonCanonico } from './hashService';
import { esErrorSinHuellaSegura, huellaParaComparar, MENSAJE_NO_VERIFICABLE } from '../lib/integridad';
import { cantidadPendiente, mensajeError, nuevoEvento, redondear } from './pedidosService';

// Comprobantes de entrega. Un comprobante definitivo es un registro inmutable en
// comprobantes/{id} construido SOLO con datos ya confirmados en el servidor (la orden leída dentro
// de una transacción); las acciones que siguen en el teléfono del repartidor no están en el
// servidor y no pueden entrar. El PDF se genera a partir del registro cada vez.
//
// Integridad: registro tipo blockchain (cadena de bloques privada sobre Firebase). Cada comprobante
// es un bloque que guarda el hash del bloque anterior de la misma orden (64 ceros en el primero):
//  - hashEventos: SHA-256 del JSON canónico de los eventos de la orden usados (inicio de ruta,
//    llegada, entregas, novedades, ajustes y decisiones de saldo), tal como están guardados.
//  - hashAnterior: hashComprobante de la versión anterior (enlace de la cadena).
//  - hashComprobante: SHA-256 del JSON canónico de todo el comprobante salvo este mismo campo.
// Verificar = recalcular ambos y compararlos. El hash del lote productivo no se toca.

export const EMPRESA = 'Cultivos Loré — Tilapia Pro';
export const HASH_GENESIS_COMPROBANTES = '0'.repeat(64);

// Eventos de la orden que documenta un comprobante
const TIPOS_DOCUMENTADOS = new Set([
  'Inicio de ruta',
  'Llegada',
  'Entrega',
  'Novedad',
  'Ajuste aplicado',
  'Reprogramación de saldo',
  'Cierre con saldo liberado',
  'Corrección de entrega'
]);

// Hechos que se documentan con un comprobante: una entrega o la corrección de una entrega
const TIPOS_COMPROBABLES = new Set(['Entrega', 'Corrección de entrega']);

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
    if (TIPOS_COMPROBABLES.has(orden.historial[i].tipo)) return { evento: orden.historial[i], indice: i };
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
    problemas.push(
      ultima.evento.tipo === 'Corrección de entrega'
        ? 'La corrección de la entrega ya tiene su comprobante definitivo.'
        : 'La última entrega ya tiene su comprobante definitivo.'
    );
  }
  const porLote = orden.entregadoPorLote || {};
  const suma = redondear(Object.values(porLote).reduce((s, n) => s + n, 0), orden.unidad);
  if (suma !== redondear(orden.cantidadEntregada, orden.unidad)) {
    problemas.push(`Lo entregado por lote (${suma}) no coincide con la cantidad entregada de la orden (${orden.cantidadEntregada}).`);
  }
  const segunEventos: Record<string, number> = {};
  for (const e of orden.historial) {
    // Una corrección fija lo entregado por lote; las entregas posteriores suman sobre ese valor
    if (e.tipo === 'Corrección de entrega') {
      for (const lote of Object.keys(segunEventos)) delete segunEventos[lote];
      for (const [lote, cantidad] of Object.entries((e.datos?.nuevo || {}) as Record<string, number>)) {
        segunEventos[lote] = redondear(Number(cantidad) || 0, orden.unidad);
      }
      continue;
    }
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

export async function calcularHashComprobante(
  c: Omit<ComprobanteEntrega, 'hashComprobante'> | ComprobanteEntrega | Omit<BloqueAnulacion, 'hashComprobante'> | BloqueAnulacion
): Promise<string> {
  const { hashComprobante, ...contenido } = c as ComprobanteEntrega;
  return calcularSha256(jsonCanonico(contenido));
}

/** Hash del bloque recalculado para compararlo con el guardado (acepta huellas de respaldo antiguas) */
async function hashComprobanteComparable(c: ComprobanteEntrega | BloqueAnulacion): Promise<string> {
  const { hashComprobante, ...contenido } = c as ComprobanteEntrega;
  return (await huellaParaComparar(jsonCanonico(contenido), hashComprobante)).hash;
}

export const esAnulacion = (b: ComprobanteEntrega | BloqueAnulacion): b is BloqueAnulacion =>
  (b as BloqueAnulacion).tipoBloque === 'anulacion';

/**
 * Separa los bloques de una orden en comprobantes de entrega y anulaciones (por comprobante anulado)
 */
export function separarBloques(bloques: (ComprobanteEntrega | BloqueAnulacion)[]): {
  comprobantes: ComprobanteEntrega[];
  anulaciones: Record<string, BloqueAnulacion>;
} {
  const comprobantes: ComprobanteEntrega[] = [];
  const anulaciones: Record<string, BloqueAnulacion> = {};
  for (const b of bloques) {
    if (esAnulacion(b)) anulaciones[b.anulaA] = b;
    else comprobantes.push(b);
  }
  return { comprobantes: comprobantes.sort((a, b) => b.version - a.version), anulaciones };
}

/**
 * Anula un comprobante de entrega: agrega a la cadena un bloque de anulación con el motivo. El
 * comprobante original no se borra ni se modifica; queda visible y marcado como anulado.
 */
export async function anularComprobante(comprobanteId: string, motivo: string): Promise<BloqueAnulacion> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Debes iniciar sesión.');
  const motivoLimpio = motivo.trim();
  if (motivoLimpio.length < 10) throw new Error('Explica el motivo de la anulación (mínimo 10 caracteres).');
  try {
    return await runTransaction(db, async (tx) => {
      const compSnap = await tx.get(doc(db, 'comprobantes', comprobanteId));
      if (!compSnap.exists()) throw new Error('El comprobante no existe.');
      const anulado = compSnap.data() as ComprobanteEntrega | BloqueAnulacion;
      if (esAnulacion(anulado)) throw new Error('Un bloque de anulación no se puede anular.');
      const ordenRef = doc(db, 'ordenes', anulado.ordenId);
      const ordenSnap = await tx.get(ordenRef);
      if (!ordenSnap.exists()) throw new Error('La orden no existe.');
      const orden = ordenSnap.data() as OrdenEntrega;
      const consultaRef = doc(db, 'consultasEntrega', anulado.tokenConsulta);
      const consultaSnap = await tx.get(consultaRef);
      if (!consultaSnap.exists()) throw new Error('No se encontró el índice de consulta de la orden.');
      const consulta = consultaSnap.data() as ConsultaEntrega;
      const clave = `anulacion-${comprobanteId}`;
      if (consulta.versiones[clave]) throw new Error('Este comprobante ya fue anulado.');

      const id = generarToken('anu');
      const version = Object.keys(consulta.versiones).length + 1;
      const emitidoEn = new Date().toISOString();
      const anterior = Object.values(consulta.versiones).find((v) => v.comprobanteId === consulta.ultimaVersion);
      const sinHash: Omit<BloqueAnulacion, 'hashComprobante'> = {
        id,
        version,
        tipoBloque: 'anulacion',
        ordenId: anulado.ordenId,
        granjaId: anulado.granjaId,
        tokenConsulta: anulado.tokenConsulta,
        emitidoEn,
        emitidoPorUid: uid,
        empresa: EMPRESA,
        anulaA: comprobanteId,
        versionAnulada: anulado.version,
        motivo: motivoLimpio,
        eventoEntregaId: clave,
        hashAnterior: anterior?.hashComprobante || HASH_GENESIS_COMPROBANTES
      };
      const bloque: BloqueAnulacion = { ...sinHash, hashComprobante: await calcularHashComprobante(sinHash) };

      tx.set(doc(db, 'comprobantes', id), bloque);
      tx.set(consultaRef, {
        ...consulta,
        versiones: {
          ...consulta.versiones,
          [clave]: { comprobanteId: id, version, emitidoEn, estadoEntrega: 'anulacion', hashComprobante: bloque.hashComprobante }
        },
        ultimaVersion: id,
        actualizadoEn: emitidoEn
      });
      tx.update(ordenRef, {
        actualizadoEn: emitidoEn,
        historial: [
          ...orden.historial,
          nuevoEvento(orden.historial.length, 'Comprobante anulado', `Comprobante N.º ${anulado.version} anulado: ${motivoLimpio}`, {
            bloqueId: id,
            anulaA: comprobanteId,
            versionAnulada: anulado.version
          })
        ]
      });
      return bloque;
    });
  } catch (err) {
    console.error('Error anulando el comprobante:', err);
    throw mensajeError('anular el comprobante', err);
  }
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
      observacion: e.descripcion || '',
      ...(e.datos?.foto?.hash ? { fotoHash: String(e.datos.foto.hash) } : {})
    }));
  const ajustes = orden.historial
    .filter((e) => e.tipo === 'Ajuste aplicado' || e.tipo === 'Corrección de entrega')
    .map((e) =>
      e.tipo === 'Corrección de entrega'
        ? {
            fecha: e.fecha,
            anterior: Object.fromEntries(Object.entries((e.datos?.anterior || {}) as Record<string, number>).map(([l, n]) => [l, Number(n) || 0])),
            nueva: Object.fromEntries(Object.entries((e.datos?.nuevo || {}) as Record<string, number>).map(([l, n]) => [l, Number(n) || 0])),
            motivo: `Corrección de la cantidad entregada: ${e.descripcion || ''}`
          }
        : {
            fecha: e.fecha,
            anterior: Object.fromEntries(Object.entries((e.datos?.anterior || {}) as Record<string, any>).map(([l, p]) => [l, Number(p?.cantidad) || 0])),
            nueva: Object.fromEntries(Object.entries((e.datos?.nueva || {}) as Record<string, any>).map(([l, p]) => [l, Number(p?.cantidad) || 0])),
            motivo: orden.ajustes?.[e.datos?.ajusteId]?.motivo || e.descripcion || ''
          }
    );
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
      // Confirmación = última entrega real; si después se corrigió, la corrección va aparte
      confirmacion: orden.historial.filter((e) => e.tipo === 'Entrega').pop()?.fecha || '',
      ...(ultima?.evento.tipo === 'Corrección de entrega' ? { correccion: ultima.evento.fecha } : {})
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
      // Enlace con el bloque anterior: el hash de la última versión emitida de esta orden
      const anterior = consulta ? Object.values(consulta.versiones).find((v) => v.comprobanteId === consulta.ultimaVersion) : null;
      const hashAnterior = anterior?.hashComprobante || HASH_GENESIS_COMPROBANTES;
      const sinHash = { ...base, hashEventos, hashAnterior };
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
          nuevoEvento(orden.historial.length, 'Comprobante emitido', `Comprobante definitivo N.º ${version}`, {
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
  onUpdate: (bloques: (ComprobanteEntrega | BloqueAnulacion)[]) => void,
  onError?: (error: any) => void
): () => void {
  return onSnapshot(
    query(collection(db, 'comprobantes'), where('granjaId', '==', granjaId), where('ordenId', '==', ordenId)),
    (snap) => onUpdate(snap.docs.map((d) => d.data() as ComprobanteEntrega | BloqueAnulacion).sort((a, b) => b.version - a.version)),
    (err) => {
      console.error('Error escuchando comprobantes:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Consulta pública de una entrega por su código (lectura de un solo documento; no lista nada)
 */
export interface VersionFaltante {
  clave: string;
  version: number;
  comprobanteId: string;
  anulacion: boolean;
}

export async function leerConsultaEntrega(
  token: string
): Promise<{ consulta: ConsultaEntrega; bloques: (ComprobanteEntrega | BloqueAnulacion)[]; faltantes: VersionFaltante[] } | null> {
  const snap = await getDoc(doc(db, 'consultasEntrega', token));
  if (!snap.exists()) return null;
  const consulta = snap.data() as ConsultaEntrega;
  const faltantes: VersionFaltante[] = [];
  const comprobantes = await Promise.all(
    Object.entries(consulta.versiones || {}).map(async ([clave, v]) => {
      const c = await getDoc(doc(db, 'comprobantes', v.comprobanteId));
      if (!c.exists()) {
        faltantes.push({
          clave,
          version: v.version,
          comprobanteId: v.comprobanteId,
          anulacion: v.estadoEntrega === 'anulacion' || clave.startsWith('anulacion-')
        });
        return null;
      }
      return c.data() as ComprobanteEntrega | BloqueAnulacion;
    })
  );
  return {
    consulta,
    bloques: comprobantes.filter((c): c is ComprobanteEntrega | BloqueAnulacion => Boolean(c)).sort((a, b) => b.version - a.version),
    faltantes: faltantes.sort((a, b) => a.version - b.version)
  };
}

// ---------- Verificación ----------

/**
 * Revisa la cadena de bloques de una orden: cada versión debe enlazar el hash de la anterior.
 * Las versiones emitidas antes del encadenamiento (sin hashAnterior) se informan aparte.
 */
export function verificarCadena(
  comprobantes: { version: number; hashAnterior?: string; hashComprobante: string }[]
): { integra: boolean; sinEnlace: number; mensaje: string } {
  const orden = [...comprobantes].sort((a, b) => a.version - b.version);
  let sinEnlace = 0;
  let huboEnlace = false;
  for (let i = 0; i < orden.length; i++) {
    const c = orden[i];
    if (!c.hashAnterior) {
      // Las versiones sin enlace solo pueden ser anteriores al encadenamiento
      if (huboEnlace) {
        return { integra: false, sinEnlace, mensaje: `Cadena rota: el registro N.º ${c.version} perdió su enlace con el anterior.` };
      }
      sinEnlace++;
      continue;
    }
    huboEnlace = true;
    const esperado = i === 0 ? HASH_GENESIS_COMPROBANTES : orden[i - 1].hashComprobante;
    if (c.hashAnterior !== esperado) {
      return { integra: false, sinEnlace, mensaje: `Cadena rota: el registro N.º ${c.version} no enlaza con el anterior.` };
    }
  }
  return {
    integra: true,
    sinEnlace,
    mensaje: sinEnlace
      ? `Cadena íntegra en los bloques encadenados (${sinEnlace} versión(es) anteriores al encadenamiento).`
      : `Cadena de bloques íntegra: ${orden.length} bloque(s) enlazados desde el bloque génesis.`
  };
}

export interface ResultadoVerificacionComprobante {
  contenidoIntegro: boolean; // el hash del comprobante coincide con su contenido
  eventosIntegros: boolean | null; // los eventos de la orden siguen iguales (solo si se tiene la orden)
  indiceCoincide: boolean | null; // el índice público registra el mismo hash (solo si se tiene)
  ordenCoincide: boolean | null; // la orden registró este hash al emitirlo y su contenido sale de la orden
  noVerificable?: boolean; // el navegador no puede calcular SHA-256
  ok: boolean; // ninguna comprobación disponible falló
  mensaje: string;
}

/**
 * Compara el comprobante con lo que la orden permite reconstruir: el hash que guardó el evento
 * "Comprobante emitido" y las entregas, novedades, cliente y fecha de confirmación calculados con
 * el historial tal como estaba al emitirlo. Devuelve los datos que no coinciden.
 */
function diferenciasConOrden(c: ComprobanteEntrega, orden: OrdenEntrega): string[] {
  const historial = orden.historial || [];
  const pos = historial.findIndex((e) => e.tipo === 'Comprobante emitido' && e.datos?.comprobanteId === c.id);
  if (pos < 0) return ['la orden no registra la emisión de este comprobante'];
  const fallas: string[] = [];
  if (historial[pos].datos?.hashComprobante && historial[pos].datos.hashComprobante !== c.hashComprobante) {
    fallas.push('la orden registró otro hash al emitirlo');
  }
  const alEmitir = { ...orden, historial: historial.slice(0, pos) };
  const reconstruido = construirComprobante(alEmitir, {
    id: c.id,
    version: c.version,
    token: c.tokenConsulta,
    uid: c.emitidoPorUid,
    emitidoEn: c.emitidoEn
  });
  // Versiones anteriores tomaban como confirmación la fecha de la última entrega o de su corrección
  const confirmacionesValidas = [reconstruido.fechas.confirmacion, ultimaEntrega(alEmitir)?.evento.fecha || ''];
  if (jsonCanonico(reconstruido.entregas) !== jsonCanonico(c.entregas)) fallas.push('las entregas o sus fotos no coinciden con la orden');
  if (jsonCanonico(reconstruido.novedades) !== jsonCanonico(c.novedades)) fallas.push('las novedades no coinciden con la orden');
  if (reconstruido.cliente.nombre !== c.cliente?.nombre) fallas.push('el cliente no coincide con la orden');
  if (!confirmacionesValidas.includes(c.fechas?.confirmacion)) fallas.push('la fecha de confirmación no coincide con la orden');
  return fallas;
}

/**
 * Verifica un comprobante recalculando sus hashes. Con la orden (operador) también comprueba que
 * los eventos usados sigan idénticos en el historial; con el índice público, que coincida el hash.
 */
export async function verificarComprobante(
  c: ComprobanteEntrega | BloqueAnulacion,
  extra: { orden?: OrdenEntrega; consulta?: ConsultaEntrega } = {}
): Promise<ResultadoVerificacionComprobante> {
  let contenidoIntegro: boolean;
  let eventosIntegros: boolean | null = null;
  try {
    contenidoIntegro = (await hashComprobanteComparable(c)) === c.hashComprobante;
    if (extra.orden && !esAnulacion(c)) {
      const porId = new Map((extra.orden.historial || []).map((e) => [e.eventoId || `indice-${e.indice}`, e]));
      const usados = c.eventosUsados.map((id) => porId.get(id));
      eventosIntegros =
        usados.every(Boolean) && (await huellaParaComparar(jsonCanonico(usados), c.hashEventos)).hash === c.hashEventos;
    }
  } catch (e) {
    if (!esErrorSinHuellaSegura(e)) throw e;
    return {
      contenidoIntegro: false,
      eventosIntegros: null,
      indiceCoincide: null,
      ordenCoincide: null,
      noVerificable: true,
      ok: false,
      mensaje: MENSAJE_NO_VERIFICABLE
    };
  }
  let indiceCoincide: boolean | null = null;
  if (extra.consulta) {
    indiceCoincide = extra.consulta.versiones?.[c.eventoEntregaId]?.hashComprobante === c.hashComprobante;
  }
  const fallasOrden = extra.orden && !esAnulacion(c) ? diferenciasConOrden(c, extra.orden) : null;
  const ordenCoincide = fallasOrden ? fallasOrden.length === 0 : null;
  const fallas = [
    !contenidoIntegro && 'el contenido no corresponde a su hash',
    eventosIntegros === false && 'los eventos de la orden no coinciden con los usados',
    indiceCoincide === false && 'el índice de consulta registra otro hash',
    ...(fallasOrden || [])
  ].filter(Boolean);
  return {
    contenidoIntegro,
    eventosIntegros,
    indiceCoincide,
    ordenCoincide,
    ok: fallas.length === 0,
    mensaje: fallas.length
      ? `Verificación fallida: ${fallas.join('; ')}.`
      : `Bloque íntegro: el contenido coincide con su hash SHA-256${eventosIntegros ? ' y con los eventos registrados en la orden' : ''}.`
  };
}

// ---------- Revisión de la consulta pública (QR del comprobante) ----------

export interface RevisionConsultaEntrega {
  avisos: string[]; // problemas de la cadena completa (se muestran solos al abrir)
  verificacion: Record<string, { ok: boolean; mensaje: string; noVerificable?: boolean }>; // por bloque
  anulados: Set<string>; // comprobantes anulados (con su bloque presente o con la anulación borrada)
  vigenteId: string | null; // comprobante que se puede presentar como vigente (null si la cadena falla)
  noVerificable: boolean;
}

/**
 * Revisa lo que ve el cliente con el QR del comprobante usando solo datos públicos: el índice de
 * consulta y los bloques. Detecta bloques faltantes (también una anulación borrada), versiones con
 * huecos, un índice que no apunta al último registro, enlaces rotos y bloques alterados.
 */
export async function revisarConsultaEntrega(
  consulta: ConsultaEntrega,
  bloques: (ComprobanteEntrega | BloqueAnulacion)[],
  faltantes: VersionFaltante[] = []
): Promise<RevisionConsultaEntrega> {
  const avisos: string[] = [];
  const verificacion: RevisionConsultaEntrega['verificacion'] = {};
  let noVerificable = false;
  for (const b of bloques) {
    const v = await verificarComprobante(b, { consulta });
    verificacion[b.id] = { ok: v.contenidoIntegro && v.indiceCoincide !== false, mensaje: v.mensaje, noVerificable: v.noVerificable };
    if (v.noVerificable) noVerificable = true;
  }
  const versiones = Object.entries(consulta.versiones || {});
  for (const f of faltantes) {
    avisos.push(
      f.anulacion
        ? `Falta el registro N.º ${f.version} de la cadena: era una anulación y fue borrada. El comprobante que anulaba no tiene validez.`
        : `Falta el registro N.º ${f.version} de la cadena: el comprobante registrado fue borrado.`
    );
  }
  const numeros = versiones.map(([, v]) => Number(v.version)).sort((a, b) => a - b);
  if (numeros.some((n, i) => n !== i + 1)) avisos.push('Las versiones de la cadena tienen huecos o están repetidas: falta un registro.');
  let mayor: { version: number; comprobanteId: string } | null = null;
  for (const [, v] of versiones) if (!mayor || v.version > mayor.version) mayor = v;
  if (mayor && consulta.ultimaVersion !== mayor.comprobanteId) {
    avisos.push('El índice de consulta no apunta al último registro de la cadena.');
  }
  for (const b of bloques) {
    if (!versiones.some(([, v]) => v.comprobanteId === b.id)) avisos.push(`El registro N.º ${b.version} no figura en el índice de consulta.`);
  }
  const cadena = verificarCadena(bloques);
  if (!cadena.integra) avisos.push(cadena.mensaje);
  for (const b of bloques) {
    const v = verificacion[b.id];
    if (v && !v.ok && !v.noVerificable) avisos.push(`Registro N.º ${b.version}: ${v.mensaje}`);
  }

  const { comprobantes, anulaciones } = separarBloques(bloques);
  const anulados = new Set(Object.keys(anulaciones));
  for (const [clave] of versiones) if (clave.startsWith('anulacion-')) anulados.add(clave.slice('anulacion-'.length));
  const vigente = avisos.length ? null : comprobantes.find((c) => !anulados.has(c.id)) || null;
  return { avisos, verificacion, anulados, vigenteId: vigente?.id || null, noVerificable };
}
