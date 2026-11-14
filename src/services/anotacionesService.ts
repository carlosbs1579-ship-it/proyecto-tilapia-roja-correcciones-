import { doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseConfig';
import { AnotacionesLote, Lote, RegistroAnotacion, TipoRegistroAnotacion } from '../types';
import { calcularSha256, jsonCanonico } from './hashService';
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

export async function hashRegistroAnotacion(codigoLote: string, r: Omit<RegistroAnotacion, 'hash'>): Promise<string> {
  return calcularSha256(
    jsonCanonico({
      codigoLote,
      indice: r.indice,
      tipo: r.tipo,
      fecha: r.fecha,
      datos: r.datos,
      registradoPor: r.registradoPor,
      ...(r.registradoPorNombre ? { registradoPorNombre: r.registradoPorNombre } : {}),
      hashAnterior: r.hashAnterior
    })
  );
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

function mensaje(accion: string, err: any): Error {
  if (err?.code === 'permission-denied') {
    return new Error(`No fue posible ${accion}: no tienes el permiso o la anotación ya fue resuelta.`);
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
  const { email, uid } = sesion();
  const ref = doc(db, 'anotacionesLote', lote.codigo);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const actual = snap.exists() ? (snap.data() as AnotacionesLote) : null;
    const eventos = lote.eventos || [];
    if (lote.estado !== 'cerrado' || !eventos.length) throw new Error('Solo se anotan lotes sellados.');
    const hashAnclaje = actual?.hashAnclaje || eventos[eventos.length - 1].hash;
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
      registradoPor: email,
      registradoPorUid: uid,
      ...nombreRegistro(),
      hashAnterior: registros.length ? registros[registros.length - 1].hash : hashAnclaje
    };
    const registro: RegistroAnotacion = { ...base, hash: await hashRegistroAnotacion(lote.codigo, base) };
    const resueltas = { ...(actual?.resueltas || {}), ...(resolver ? { [String(resolver.propuestaIndice)]: resolver.estado } : {}) };
    if (actual) {
      tx.update(ref, { registros: [...registros, registro], resueltas });
    } else {
      tx.set(ref, { codigoLote: lote.codigo, granjaId: lote.granjaId || 'cultivos-lore', hashAnclaje, registros: [registro], resueltas: {} });
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
  try {
    await agregarRegistro(lote, 'Propuesta', {
      fase: datos.fase,
      dato: datos.dato,
      valorRegistrado: datos.valorRegistrado.trim(),
      valorCorrecto: datos.valorCorrecto.trim(),
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
  try {
    await agregarRegistro(
      lote,
      aprobar ? 'Aprobación' : 'Rechazo',
      { propuestaIndice, respuesta: respuesta.trim() },
      { propuestaIndice, estado: aprobar ? 'aprobada' : 'rechazada' }
    );
  } catch (err) {
    console.error('Error resolviendo anotación:', err);
    throw mensaje(aprobar ? 'aprobar la anotación' : 'rechazar la anotación', err);
  }
}

/**
 * Verifica la cadena de anotaciones: que parta del sello del lote y que cada registro conserve su hash
 */
export async function verificarAnotaciones(lote: Lote, d: AnotacionesLote | null): Promise<{ integra: boolean; mensaje: string }> {
  if (!d || !d.registros.length) return { integra: true, mensaje: 'Sin anotaciones.' };
  const eventos = lote.eventos || [];
  const sello = eventos.length ? eventos[eventos.length - 1].hash : '';
  if (d.hashAnclaje !== sello) return { integra: false, mensaje: 'Las anotaciones no están ancladas al sello de cierre de este lote.' };
  let previo = d.hashAnclaje;
  for (const r of d.registros) {
    const { hash, ...resto } = r;
    if (r.hashAnterior !== previo) return { integra: false, mensaje: `Cadena de anotaciones rota en el registro #${r.indice}.` };
    if ((await hashRegistroAnotacion(lote.codigo, resto)) !== hash) {
      return { integra: false, mensaje: `El registro #${r.indice} de las anotaciones fue alterado después de guardarse.` };
    }
    previo = hash;
  }
  return { integra: true, mensaje: `Cadena de anotaciones íntegra (${d.registros.length} registro(s)), anclada al sello del lote.` };
}
