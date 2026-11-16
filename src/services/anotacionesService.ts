import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseConfig';
import { AnotacionesLote, Lote, RegistroAnotacion, TipoRegistroAnotacion } from '../types';
import { calcularSha256, jsonCanonico } from './hashService';
import { esErrorSinHuellaSegura, huellaParaComparar, MENSAJE_NO_VERIFICABLE } from '../lib/integridad';
import { nombreRegistro } from './usuariosService';

// Anotaciones posteriores al cierre de un lote. El lote sellado NO se modifica: las anotaciones
// viven en anotacionesLote/{codigo}, una cadena propia que parte del sello de cierre del lote
// (hash de su última fase). Una persona propone (fase, dato, valor registrado, valor correcto y
// motivo) y otra distinta la aprueba o la rechaza. Solo las aprobadas aparecen en el certificado.
// No cambian ningún cálculo: el dato sellado sigue siendo el oficial y la anotación lo aclara.

export interface Anotacion {
  numero: number; // N.º de anotación (orden de las propuestas)
  propuesta: RegistroAnotacion;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  resolucion?: RegistroAnotacion;
}

function generarId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `an_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function textoRegistroAnotacion(codigoLote: string, r: Omit<RegistroAnotacion, 'hash'>): string {
  return jsonCanonico({
      codigoLote,
      indice: r.indice,
      tipo: r.tipo,
      fecha: r.fecha,
      datos: r.datos,
      registradoPor: r.registradoPor,
      ...(r.registradoPorNombre ? { registradoPorNombre: r.registradoPorNombre } : {}),
      hashAnterior: r.hashAnterior
    });
}

export async function hashRegistroAnotacion(codigoLote: string, r: Omit<RegistroAnotacion, 'hash'>): Promise<string> {
  return calcularSha256(textoRegistroAnotacion(codigoLote, r));
}

/** Valor numérico válido (acepta coma decimal) o null */
export function numeroValido(valor: string): number | null {
  const t = String(valor ?? '').trim().replace(',', '.');
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Anotaciones de un lote con su estado (pendiente, aprobada o rechazada)
 */
export function anotacionesDe(doc: AnotacionesLote | null): Anotacion[] {
  if (!doc) return [];
  const resoluciones = new Map<number, RegistroAnotacion>();
  for (const r of doc.registros) if (r.tipo !== 'Propuesta') resoluciones.set(Number(r.datos?.propuestaIndice), r);
  let numero = 0;
  return doc.registros
    .filter((r) => r.tipo === 'Propuesta')
    .map((p) => {
      const res = resoluciones.get(p.indice);
      return {
        numero: ++numero,
        propuesta: p,
        estado: res ? (res.tipo === 'Aprobación' ? 'aprobada' : 'rechazada') : 'pendiente',
        resolucion: res
      };
    });
}

export function escucharAnotaciones(codigoLote: string, onUpdate: (d: AnotacionesLote | null) => void): () => void {
  return onSnapshot(
    doc(db, 'anotacionesLote', codigoLote),
    (snap) => onUpdate(snap.exists() ? (snap.data() as AnotacionesLote) : null),
    (err) => {
      console.error('Error leyendo anotaciones:', err);
      onUpdate(null);
    }
  );
}

function sesion(): { email: string; uid: string } {
  const u = auth.currentUser;
  if (!u?.email) throw new Error('Debes iniciar sesión.');
  return { email: u.email.toLowerCase(), uid: u.uid };
}

function mensaje(accion: string, err: any, resolviendo = false): Error {
  if (err?.code === 'permission-denied') {
    return new Error(
      resolviendo
        ? `No fue posible ${accion}: no tienes el permiso o la anotación ya fue resuelta.`
        : `No fue posible ${accion}: no tienes el permiso para proponer anotaciones.`
    );
  }
  if (err?.code === 'unavailable' || err?.code === 'deadline-exceeded') return new Error(`No hay conexión. No fue posible ${accion}.`);
  return new Error(err?.message || `No fue posible ${accion}.`);
}

async function agregarRegistro(
  lote: Lote,
  tipo: TipoRegistroAnotacion,
  datos: Record<string, any>,
  resolver?: { propuestaIndice: number; estado: 'aprobada' | 'rechazada' }
): Promise<void> {
  const { uid } = sesion();
  const ref = doc(db, 'anotacionesLote', lote.codigo);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const actual = snap.exists() ? (snap.data() as AnotacionesLote) : null;
    const eventos = lote.eventos || [];
    if (lote.estado !== 'cerrado' || !eventos.length) throw new Error('Solo se anotan lotes sellados.');
    const hashAnclaje = actual?.hashAnclaje || eventos[eventos.length - 1].hash;
    if (actual && !(await verificarAnotaciones(lote, actual)).integra) {
      throw new Error('La cadena de anotaciones está alterada; no se pueden agregar registros nuevos.');
    }
    const registros = actual?.registros || [];
    if (resolver) {
      if (actual?.resueltas?.[String(resolver.propuestaIndice)]) throw new Error('Esta anotación ya fue resuelta.');
      const p = registros[resolver.propuestaIndice];
      if (!p || p.tipo !== 'Propuesta') throw new Error('La anotación no existe.');
      if (p.registradoPorUid === uid) throw new Error('No puedes aprobar o rechazar una anotación que propusiste tú.');
    }
    const base: Omit<RegistroAnotacion, 'hash'> = {
      id: generarId(),
      indice: registros.length,
      tipo,
      fecha: new Date().toISOString(),
      datos,
      // H20: el uid y no el correo (las anotaciones se leen sin sesión); los registros anteriores
      // conservan el correo con el que se sellaron
      registradoPor: uid,
      registradoPorUid: uid,
      ...nombreRegistro(),
      hashAnterior: registros.length ? registros[registros.length - 1].hash : hashAnclaje
    };
    const registro: RegistroAnotacion = { ...base, hash: await hashRegistroAnotacion(lote.codigo, base) };
    const resueltas = { ...(actual?.resueltas || {}), ...(resolver ? { [String(resolver.propuestaIndice)]: resolver.estado } : {}) };
    // Hora del servidor de cada registro (H19), fuera del hash: registradoEnServidor[indice]
    if (actual) {
      tx.update(ref, { registros: [...registros, registro], resueltas, [`registradoEnServidor.${registro.indice}`]: serverTimestamp() });
    } else {
      tx.set(ref, {
        codigoLote: lote.codigo,
        granjaId: lote.granjaId || 'cultivos-lore',
        hashAnclaje,
        registros: [registro],
        resueltas: {},
        registradoEnServidor: { '0': serverTimestamp() }
      });
    }
  });
}

/**
 * Propone una anotación sobre una fase de un lote sellado (queda pendiente de aprobación)
 */
export async function proponerAnotacion(
  lote: Lote,
  datos: { fase: number; dato: string; valorRegistrado: string; valorCorrecto: string; motivo: string }
): Promise<void> {
  const motivo = datos.motivo.trim();
  if (motivo.length < 10) throw new Error('Explica el motivo de la anotación (mínimo 10 caracteres).');
  // Si el dato sellado es un número, el valor correcto también debe serlo
  const original = (lote.eventos || [])[datos.fase]?.datos?.[datos.dato];
  if (datos.dato && typeof original === 'number' && numeroValido(datos.valorCorrecto) === null) {
    throw new Error('El dato registrado es un número: escribe el valor correcto como número (por ejemplo 125 o 12.5).');
  }
  try {
    await agregarRegistro(lote, 'Propuesta', {
      fase: datos.fase,
      dato: datos.dato,
      valorRegistrado: datos.valorRegistrado.trim(),
      valorCorrecto:
        datos.dato && typeof original === 'number' ? String(numeroValido(datos.valorCorrecto)) : datos.valorCorrecto.trim(),
      motivo
    });
  } catch (err) {
    console.error('Error proponiendo anotación:', err);
    throw mensaje('proponer la anotación', err);
  }
}

/**
 * Aprueba o rechaza una anotación propuesta por otra persona
 */
export async function resolverAnotacion(lote: Lote, propuestaIndice: number, aprobar: boolean, respuesta: string): Promise<void> {
  if (!aprobar && respuesta.trim().length < 5) throw new Error('Para rechazar, escribe el motivo (mínimo 5 caracteres).');
  try {
    await agregarRegistro(
      lote,
      aprobar ? 'Aprobación' : 'Rechazo',
      { propuestaIndice, respuesta: respuesta.trim() },
      { propuestaIndice, estado: aprobar ? 'aprobada' : 'rechazada' }
    );
  } catch (err) {
    console.error('Error resolviendo anotación:', err);
    throw mensaje(aprobar ? 'aprobar la anotación' : 'rechazar la anotación', err, true);
  }
}

export interface VerificacionAnotaciones {
  integra: boolean;
  mensaje: string;
  alteradas: number[]; // N.º de las anotaciones afectadas (propuesta o su resolución alterada)
  selloCambiado: boolean;
  noVerificable?: boolean; // el navegador no puede calcular SHA-256: no hay resultado
}

/**
 * Verifica la cadena de anotaciones: que parta del sello del lote y que cada registro conserve su
 * hash. Dice qué anotación (N.º) quedó afectada para marcarla sin validez.
 */
export async function verificarAnotaciones(lote: Lote, d: AnotacionesLote | null): Promise<VerificacionAnotaciones> {
  if (!d || !d.registros.length) return { integra: true, mensaje: 'Sin anotaciones.', alteradas: [], selloCambiado: false };
  const eventos = lote.eventos || [];
  const sello = eventos.length ? eventos[eventos.length - 1].hash : '';
  if (d.hashAnclaje !== sello) {
    return {
      integra: false,
      mensaje: 'El sello del lote cambió después de anotar: las anotaciones ya no corresponden a este registro sellado.',
      alteradas: anotacionesDe(d).map((a) => a.numero),
      selloCambiado: true
    };
  }
  // N.º de anotación de cada registro (la propuesta o la resolución que la acompaña)
  const numeroDe = new Map<number, number>();
  for (const a of anotacionesDe(d)) {
    numeroDe.set(a.propuesta.indice, a.numero);
    if (a.resolucion) numeroDe.set(a.resolucion.indice, a.numero);
  }
  const alteradas = new Set<number>();
  const detalles: string[] = [];
  let previo = d.hashAnclaje;
  try {
    for (const [pos, r] of d.registros.entries()) {
      const { hash, ...resto } = r;
      const n = numeroDe.get(r.indice);
      const quien = n ? `La anotación N.º ${n} (${r.tipo.toLowerCase()})` : `Un registro de anotación (${r.tipo.toLowerCase()})`;
      if (r.indice !== pos) {
        if (n) alteradas.add(n);
        detalles.push(`${quien} no está en su posición: falta un registro o se reordenaron.`);
      } else if (r.hashAnterior !== previo) {
        if (n) alteradas.add(n);
        detalles.push(`${quien} no enlaza con el registro anterior: la cadena se rompió.`);
      } else if ((await huellaParaComparar(textoRegistroAnotacion(lote.codigo, resto), hash)).hash !== hash) {
        if (n) alteradas.add(n);
        detalles.push(`${quien} fue alterada después de guardarse.`);
      }
      previo = hash;
    }
  } catch (e) {
    if (esErrorSinHuellaSegura(e)) {
      return { integra: false, mensaje: MENSAJE_NO_VERIFICABLE, alteradas: [], selloCambiado: false, noVerificable: true };
    }
    throw e;
  }
  // Las resoluciones registradas y el índice "resueltas" deben coincidir: si falta una resolución
  // que el índice declara (o al revés), se borró un registro
  const resueltas = d.resueltas || {};
  for (const a of anotacionesDe(d)) {
    const declarada = resueltas[String(a.propuesta.indice)];
    const real = a.estado === 'pendiente' ? undefined : a.estado;
    if ((declarada || undefined) !== real) {
      alteradas.add(a.numero);
      detalles.push(
        declarada && !real
          ? `La anotación N.º ${a.numero} figura como ${declarada}, pero falta el registro de esa decisión: se borró.`
          : `La anotación N.º ${a.numero} no coincide con el índice de decisiones.`
      );
    }
  }
  return detalles.length
    ? { integra: false, mensaje: detalles.join(' '), alteradas: [...alteradas], selloCambiado: false }
    : {
        integra: true,
        mensaje: `Cadena de anotaciones íntegra (${d.registros.length} registro(s)), anclada al sello del lote.`,
        alteradas: [],
        selloCambiado: false
      };
}
