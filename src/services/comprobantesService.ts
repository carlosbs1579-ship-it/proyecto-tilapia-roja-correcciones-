import { collection, doc, getDoc, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseConfig';
import { BloqueAnulacion, ComprobanteEntrega, ConsultaEntrega, EventoOrden, Lote, MarcaServidor, OrdenEntrega } from '../types';
import { calcularSha256, jsonCanonico, verificarIntegridadLote } from './hashService';
import { esErrorSinHuellaSegura, huellaParaComparar, MENSAJE_NO_VERIFICABLE, sha256Texto } from '../lib/integridad';
import { agregarEvento, cantidadPendiente, mensajeError, nuevoEvento, redondear, TOLERANCIA_HORA_MS } from './pedidosService';
import { sellarBloque } from './selloTiempoService';

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
//
// Comprobantes nuevos (el documento es público, se abre con el QR):
//  - cliente.direccionHash: SHA-256 de la dirección en vez de la dirección; la dirección completa
//    queda en la orden, que solo leen los operadores.
//  - resumenNovedades: cantidad de novedades y SHA-256 del JSON canónico de su lista; el detalle
//    queda en la orden.
//  - sellosLotes: sello (resumen.hashFinal) de cada lote de procedencia al emitir; anotacionesLotes:
//    cantidad de anotaciones y hash de la última de cada lote que las tenga. Si el lote o sus
//    anotaciones se reescriben después, el comprobante ya emitido deja de coincidir.
//  - registradoEnServidor: hora del servidor al emitir, fuera del hash.

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

// Contenido sellado del bloque: todo salvo su propio hash, la hora del servidor y el sello de tiempo
// (los tres se agregan fuera del hash; los bloques anteriores no los tienen y su hash no cambia)
function contenidoSellado(c: object): object {
  const { hashComprobante, registradoEnServidor, selloTiempo, ...contenido } = c as ComprobanteEntrega;
  return contenido;
}

/**
 * Texto exacto sellado del bloque: sus bytes UTF-8 son lo que se pasa a SHA-256 para obtener
 * hashComprobante (el "documento sellado" para verificar en opentimestamps.org)
 */
export function textoSelladoComprobante(c: ComprobanteEntrega | BloqueAnulacion): string {
  return jsonCanonico(contenidoSellado(c));
}

export async function calcularHashComprobante(
  c: Omit<ComprobanteEntrega, 'hashComprobante'> | ComprobanteEntrega | Omit<BloqueAnulacion, 'hashComprobante'> | BloqueAnulacion
): Promise<string> {
  return calcularSha256(jsonCanonico(contenidoSellado(c)));
}

/** Hash del bloque recalculado para compararlo con el guardado (acepta huellas de respaldo antiguas) */
async function hashComprobanteComparable(c: ComprobanteEntrega | BloqueAnulacion): Promise<string> {
  return (await huellaParaComparar(jsonCanonico(contenidoSellado(c)), c.hashComprobante)).hash;
}

/** Hora del servidor del bloque (si se guardó) y si la hora declarada al emitir difiere más de 10 minutos */
export function horaServidorBloque(b: { emitidoEn: string; registradoEnServidor?: MarcaServidor }): { servidor: Date | null; desfase: boolean } {
  const servidor = b.registradoEnServidor && typeof b.registradoEnServidor.toDate === 'function' ? b.registradoEnServidor.toDate() : null;
  if (!servidor) return { servidor: null, desfase: false };
  const declarada = Date.parse(b.emitidoEn);
  return { servidor, desfase: Number.isFinite(declarada) && Math.abs(declarada - servidor.getTime()) > TOLERANCIA_HORA_MS };
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
    const bloqueNuevo = await runTransaction(db, async (tx) => {
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

      tx.set(doc(db, 'comprobantes', id), { ...bloque, registradoEnServidor: serverTimestamp() });
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
        ...(await agregarEvento(orden.historial, nuevoEvento(orden.historial.length, 'Comprobante anulado', `Comprobante N.º ${anulado.version} anulado: ${motivoLimpio}`, {
            bloqueId: id,
            anulaA: comprobanteId,
            versionAnulada: anulado.version
          })))
      });
      return bloque;
    });
    sellarBloque(bloqueNuevo).catch(() => {});
    return bloqueNuevo;
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

type ContenidoBase = Omit<ComprobanteEntrega, 'hashEventos' | 'hashComprobante'>;

/** SHA-256 de la dirección tal como la guarda la orden (texto vacío si no tiene) */
export const hashDireccion = (direccion: string | undefined | null) => sha256Texto(direccion || '');

/** Cantidad y SHA-256 del JSON canónico de la lista de novedades */
export async function resumirNovedades(novedades: { fecha: string; descripcion: string }[]): Promise<{ cantidad: number; hash: string }> {
  return { cantidad: novedades.length, hash: await sha256Texto(jsonCanonico(novedades)) };
}

/**
 * Forma pública del comprobante nuevo: sin la dirección ni el texto de las novedades (solo sus
 * hashes y la cantidad), que siguen completos en la orden
 */
export async function formaPublica(base: ContenidoBase): Promise<ContenidoBase> {
  const { novedades, cliente, ...resto } = base;
  return {
    ...resto,
    cliente: { nombre: cliente.nombre, direccionHash: await hashDireccion(cliente.direccion) },
    resumenNovedades: await resumirNovedades(novedades || [])
  };
}

/**
 * Anotaciones de cada lote al emitir: cuántos registros tiene y el hash del último. Se leen fuera de
 * la transacción porque las reglas no las comparan; si no se pueden leer, el comprobante no las
 * incluye (sigue anclado al sello del lote).
 */
async function anotacionesDeLotes(codigos: string[]): Promise<Record<string, { registros: number; ultimoHash: string }>> {
  const r: Record<string, { registros: number; ultimoHash: string }> = {};
  for (const codigo of codigos) {
    try {
      const snap = await getDoc(doc(db, 'anotacionesLote', codigo));
      const registros = snap.exists() ? (snap.data().registros as { hash?: string }[]) || [] : [];
      const ultimo = registros[registros.length - 1];
      if (registros.length && ultimo?.hash) r[codigo] = { registros: registros.length, ultimoHash: ultimo.hash };
    } catch {
      // Sin acceso a las anotaciones: el comprobante queda sin ese dato
    }
  }
  return r;
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
    const previa = await getDoc(doc(db, 'ordenes', ordenId));
    const anotaciones = previa.exists() ? await anotacionesDeLotes(Object.keys((previa.data() as OrdenEntrega).procedencias || {})) : {};
    const emitido = await runTransaction(db, async (tx) => {
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

      // Sello de cada lote de procedencia en este momento (las reglas lo comparan con el lote)
      const sellosLotes: Record<string, string> = {};
      for (const codigo of Object.keys(orden.procedencias || {})) {
        const loteSnap = await tx.get(doc(db, 'lotes', codigo));
        sellosLotes[codigo] = loteSnap.exists() ? (loteSnap.data() as Lote).resumen?.hashFinal || '' : '';
      }
      const anotacionesLotes = Object.fromEntries(Object.entries(anotaciones).filter(([codigo]) => codigo in sellosLotes));

      const id = generarToken('cmp');
      const version = Object.keys(consulta?.versiones || {}).length + 1;
      const emitidoEn = new Date().toISOString();
      const base = await formaPublica(construirComprobante(orden, { id, version, token, uid, emitidoEn }));
      const hashEventos = await hashDeEventos(eventosDocumentados(orden));
      // Enlace con el bloque anterior: el hash de la última versión emitida de esta orden
      const anterior = consulta ? Object.values(consulta.versiones).find((v) => v.comprobanteId === consulta.ultimaVersion) : null;
      const hashAnterior = anterior?.hashComprobante || HASH_GENESIS_COMPROBANTES;
      const sinHash = {
        ...base,
        hashEventos,
        hashAnterior,
        sellosLotes,
        ...(Object.keys(anotacionesLotes).length ? { anotacionesLotes } : {})
      };
      const comprobante: ComprobanteEntrega = { ...sinHash, hashComprobante: await calcularHashComprobante(sinHash as ComprobanteEntrega) };

      tx.set(doc(db, 'comprobantes', id), { ...comprobante, registradoEnServidor: serverTimestamp() });
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
        ...(await agregarEvento(orden.historial, nuevoEvento(orden.historial.length, 'Comprobante emitido', `Comprobante definitivo N.º ${version}`, {
            comprobanteId: id,
            eventoEntregaId,
            version,
            estadoEntrega: comprobante.estadoEntrega,
            hashComprobante: comprobante.hashComprobante
          })))
      });
      return comprobante;
    });
    // Testigo externo (H03): el hash del comprobante va a OpenTimestamps sin bloquear la emisión
    sellarBloque(emitido).catch(() => {});
    return emitido;
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
async function diferenciasConOrden(c: ComprobanteEntrega, orden: OrdenEntrega): Promise<string[]> {
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
  if (c.resumenNovedades) {
    // Comprobante nuevo: la cantidad y el hash de las novedades deben salir de la orden
    const r = await resumirNovedades(reconstruido.novedades || []);
    if (r.cantidad !== c.resumenNovedades.cantidad || r.hash !== c.resumenNovedades.hash) fallas.push('las novedades no coinciden con la orden');
  } else if (jsonCanonico(reconstruido.novedades) !== jsonCanonico(c.novedades)) {
    fallas.push('las novedades no coinciden con la orden');
  }
  if (reconstruido.cliente.nombre !== c.cliente?.nombre) fallas.push('el cliente no coincide con la orden');
  if (c.cliente?.direccionHash !== undefined && (await hashDireccion(reconstruido.cliente.direccion)) !== c.cliente.direccionHash) {
    fallas.push('la dirección del cliente no coincide con la de la orden');
  }
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
  let fallasOrden: string[] | null = null;
  try {
    fallasOrden = extra.orden && !esAnulacion(c) ? await diferenciasConOrden(c, extra.orden) : null;
  } catch (e) {
    if (!esErrorSinHuellaSegura(e)) throw e;
  }
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

// ---------- Sellos de los lotes y sus anotaciones (comprobantes nuevos) ----------

export interface RevisionSellosLotes {
  avisos: string[]; // el lote o sus anotaciones cambiaron después de emitir el comprobante
  notas: string[]; // información sin alarma (el lote siguió registrando fases, no se pudo leer)
}

type LectorDocumento = (coleccion: string, id: string) => Promise<Record<string, any> | null>;

const leerPublico: LectorDocumento = async (coleccion, id) => {
  const snap = await getDoc(doc(db, coleccion, id));
  return snap.exists() ? (snap.data() as Record<string, any>) : null;
};

/**
 * Compara el sello de cada lote guardado en el comprobante (sellosLotes) con el lote actual, y las
 * anotaciones registradas al emitir con las actuales. Si el lote siguió registrando fases después, su
 * sello antiguo sigue siendo una fase de su cadena íntegra: se informa sin alarma. Si el sello ya no
 * aparece, o las anotaciones de entonces cambiaron o se borraron, el lote se reescribió. Los
 * comprobantes anteriores (sin sellosLotes) no tienen nada que comparar.
 */
export async function revisarSellosLotes(
  c: ComprobanteEntrega,
  leer: LectorDocumento = leerPublico
): Promise<RevisionSellosLotes> {
  const avisos: string[] = [];
  const notas: string[] = [];
  for (const [codigo, sello] of Object.entries(c.sellosLotes || {})) {
    if (!sello) continue;
    let lote: Record<string, any> | null;
    try {
      lote = await leer('lotes', codigo);
    } catch {
      notas.push(`No se pudo leer el lote ${codigo} para comparar su sello con el del comprobante.`);
      continue;
    }
    if (!lote) {
      avisos.push(`El lote ${codigo} ya no existe: el comprobante registró su sello al emitirse.`);
      continue;
    }
    const actual = lote.resumen?.hashFinal || '';
    if (actual !== sello) {
      const eventos: { hash?: string }[] = lote.eventos || [];
      const posicion = eventos.findIndex((e) => e?.hash === sello);
      let integro = false;
      try {
        integro = posicion >= 0 && (await verificarIntegridadLote({ ...(lote as Lote), codigo })).valido;
      } catch (e) {
        if (!esErrorSinHuellaSegura(e)) throw e;
        notas.push(MENSAJE_NO_VERIFICABLE);
        continue;
      }
      if (integro) {
        notas.push(`El lote ${codigo} registró ${eventos.length - 1 - posicion} fase(s) después de emitir este comprobante; lo registrado hasta entonces sigue igual.`);
      } else {
        avisos.push(`El lote ${codigo} cambió después de emitir este comprobante: su sello actual no continúa el que quedó registrado.`);
      }
    }
  }
  for (const [codigo, a] of Object.entries(c.anotacionesLotes || {})) {
    let anotacion: Record<string, any> | null;
    try {
      anotacion = await leer('anotacionesLote', codigo);
    } catch {
      notas.push(`No se pudieron leer las anotaciones del lote ${codigo} para compararlas con el comprobante.`);
      continue;
    }
    const registros: { hash?: string }[] = anotacion?.registros || [];
    if (registros.length < a.registros || registros[a.registros - 1]?.hash !== a.ultimoHash) {
      avisos.push(`Las anotaciones del lote ${codigo} cambiaron después de emitir este comprobante: se borraron o se recalcularon.`);
    }
  }
  return { avisos, notas };
}

// ---------- Revisión de la consulta pública (QR del comprobante) ----------

export interface RevisionConsultaEntrega {
  avisos: string[]; // problemas de la cadena completa (se muestran solos al abrir)
  notas: string[]; // información sin alarma (por ejemplo, un lote que siguió registrando fases)
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
  // Sellos de los lotes y anotaciones registrados en los comprobantes nuevos
  const notas: string[] = [];
  for (const b of bloques) {
    if (esAnulacion(b) || !b.sellosLotes) continue;
    const r = await revisarSellosLotes(b);
    avisos.push(...r.avisos.map((a) => `Comprobante N.º ${b.version}: ${a}`));
    for (const n of r.notas) if (!notas.includes(n)) notas.push(n);
  }

  const { comprobantes, anulaciones } = separarBloques(bloques);
  const anulados = new Set(Object.keys(anulaciones));
  for (const [clave] of versiones) if (clave.startsWith('anulacion-')) anulados.add(clave.slice('anulacion-'.length));
  const vigente = avisos.length ? null : comprobantes.find((c) => !anulados.has(c.id)) || null;
  return { avisos, notas, verificacion, anulados, vigenteId: vigente?.id || null, noVerificable };
}
