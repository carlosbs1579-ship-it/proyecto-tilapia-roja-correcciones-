// Migración del Paso 5.
// Por defecto es una SIMULACIÓN de solo lectura: lista lo que cambiaría sin escribir nada.
// Con --aplicar escribe únicamente:
//   - granjaId en los lotes que no lo tienen (ningún otro campo del lote);
//   - el valor de los contadores que están por debajo de los lotes existentes.
// Nunca borra documentos ni modifica perfiles (el perfil del Administrador Maestro se completa
// solo al iniciar sesión, y los perfiles de sesiones simuladas se dejan como están).
//
// Uso (desde la carpeta del proyecto):
//   node scripts/migracion-paso5.mjs
//   node scripts/migracion-paso5.mjs --aplicar --respaldo <archivo.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, terminate } from 'firebase/firestore';

const GRANJA_ID_PREDETERMINADA = 'cultivos-lore';
const ADMIN_MASTER_EMAIL = 'carlosbs1579@gmail.com';

const aplicar = process.argv.includes('--aplicar');
const indiceRespaldo = process.argv.indexOf('--respaldo');
const rutaRespaldo = indiceRespaldo !== -1 ? process.argv[indiceRespaldo + 1] : null;
if (aplicar && !rutaRespaldo) {
  console.error('Con --aplicar es obligatorio indicar --respaldo <archivo.json>.');
  process.exit(1);
}

const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const app = initializeApp(config);
const db = config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, config.firestoreDatabaseId)
  : getFirestore(app);

function esPerfilSimulado(uid) {
  return uid === 'admin_carlos_master' || uid.startsWith('op_');
}

function esAdminMaestro(email) {
  return (email || '').trim().toLowerCase() === ADMIN_MASTER_EMAIL;
}

function letraANumero(letras) {
  return [...letras].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
}

// Lee un contador sin listar la colección (las reglas no lo permiten)
async function leerContador(id) {
  try {
    const snap = await getDoc(doc(db, 'contadores', id));
    return { existe: snap.exists(), valor: snap.exists() ? snap.data().valor : null, datos: snap.exists() ? snap.data() : null };
  } catch (err) {
    return { error: err.code };
  }
}

const [lotesSnap, usuariosSnap] = await Promise.all([
  getDocs(collection(db, 'lotes')),
  getDocs(collection(db, 'usuarios'))
]);

// ---------- Perfiles (solo informativo) ----------
const perfiles = usuariosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const uidPorEmail = new Map(
  perfiles.filter((p) => !esPerfilSimulado(p.id)).map((p) => [(p.email || '').toLowerCase(), p.id])
);

console.log(`\n=== PERFILES (${perfiles.length} en usuarios/) — no se modifican ===`);
for (const p of perfiles) {
  if (esPerfilSimulado(p.id)) {
    const real = uidPorEmail.get((p.email || '').toLowerCase());
    console.log(`- ${p.id} | ${p.email} | estado=${p.estado} -> SIMULADO (sin cuenta real). Se deja como está.${real ? ` Existe perfil real: ${real}` : ' No existe perfil real con ese correo.'}`);
    continue;
  }
  const faltan = [];
  if (!p.rol) faltan.push(`rol (${esAdminMaestro(p.email) ? 'admin' : 'operario'})`);
  if (!p.granjaId) faltan.push(`granjaId (${GRANJA_ID_PREDETERMINADA})`);
  const nota = !faltan.length
    ? 'completo'
    : esAdminMaestro(p.email)
    ? `faltan ${faltan.join(', ')}; se completan al iniciar sesión`
    : `faltan ${faltan.join(', ')}; se completan cuando un administrador guarde el perfil`;
  console.log(`- ${p.id} | ${p.email} | rol=${p.rol ?? '(falta)'} | estado=${p.estado} | granjaId=${p.granjaId ?? '(falta)'} -> ${nota}`);
}

// ---------- Lotes ----------
const lotes = lotesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const lotesAMigrar = lotes.filter((l) => !l.granjaId);

console.log(`\n=== LOTES (${lotes.length} en lotes/) ===`);
for (const l of lotes) {
  const eventos = Array.isArray(l.eventos) ? l.eventos.length : 0;
  const base = `- ${l.id} | estado=${l.estado} | eventos=${eventos} | consecutivo=${l.consecutivo} | creadoPor=${l.creadoPor} | creadoEn=${l.creadoEn}`;
  console.log(l.granjaId ? `${base} | granjaId=${l.granjaId} -> sin cambios` : `${base} -> AGREGAR granjaId: ${GRANJA_ID_PREDETERMINADA}`);
}

// ---------- Contadores ----------
// Un lote creado sin pasar por la transacción de Firestore deja los contadores atrasados; el
// siguiente lote repetiría su consecutivo o chocaría con su código. Se comparan con los lotes.
const necesarios = new Map([['lotes_global', lotes.reduce((m, l) => Math.max(m, Number(l.consecutivo) || 0), 0)]]);
for (const l of lotes) {
  const partes = /^(\d{8})-([A-Z]+)-(.+)$/.exec(l.id);
  if (!partes) continue;
  const id = `diario_${partes[1]}_${partes[3]}`;
  necesarios.set(id, Math.max(necesarios.get(id) || 0, letraANumero(partes[2])));
}

console.log(`\n=== CONTADORES ===`);
const contadoresAFijar = [];
const contadoresOriginales = {};
for (const [id, necesario] of necesarios) {
  const actual = await leerContador(id);
  if (actual.error) {
    console.log(`- ${id}: no se pudo leer (${actual.error}) -> no se toca`);
    continue;
  }
  contadoresOriginales[id] = actual.datos;
  const valor = typeof actual.valor === 'number' ? actual.valor : 0;
  if (necesario === 0 || valor >= necesario) {
    console.log(`- ${id}: valor=${actual.existe ? actual.valor : '(no existe)'} | mínimo necesario=${necesario} -> sin cambios`);
  } else {
    contadoresAFijar.push({ id, valor: necesario });
    console.log(`- ${id}: valor=${actual.existe ? actual.valor : '(no existe)'} | mínimo necesario=${necesario} -> FIJAR valor: ${necesario}`);
  }
}

console.log(`\nPlan: ${lotesAMigrar.length} lote(s) recibirían granjaId y ${contadoresAFijar.length} contador(es) se fijarían.`);

if (!aplicar) {
  console.log('SIMULACIÓN: NO SE ESCRIBIÓ NADA.');
  await terminate(db);
  process.exit(0);
}

// ---------- Aplicar ----------
// Respaldo de los documentos tal como estaban, antes de cualquier escritura
writeFileSync(
  rutaRespaldo,
  JSON.stringify({ fecha: new Date().toISOString(), lotes: lotesAMigrar, contadores: contadoresOriginales }, null, 2)
);
console.log(`\nRespaldo guardado en ${rutaRespaldo}`);

const ahora = new Date().toISOString();
for (const l of lotesAMigrar) {
  // updateDoc solo agrega granjaId; el resto del lote (eventos, hashes, fechas) queda intacto
  await updateDoc(doc(db, 'lotes', l.id), { granjaId: GRANJA_ID_PREDETERMINADA });
  console.log(`ESCRITO lotes/${l.id}: granjaId=${GRANJA_ID_PREDETERMINADA}`);
}
for (const c of contadoresAFijar) {
  await setDoc(doc(db, 'contadores', c.id), { valor: c.valor, actualizadoEn: ahora }, { merge: true });
  console.log(`ESCRITO contadores/${c.id}: valor=${c.valor}`);
}

// Verificación: volver a leer desde el servidor
console.log('\n=== VERIFICACIÓN ===');
for (const l of lotesAMigrar) {
  const snap = await getDoc(doc(db, 'lotes', l.id));
  const d = snap.data();
  const eventosIntactos = JSON.stringify(d.eventos) === JSON.stringify(l.eventos);
  console.log(`- lotes/${l.id}: granjaId=${d.granjaId} | eventos intactos=${eventosIntactos} | estado=${d.estado}`);
}
for (const c of contadoresAFijar) {
  const actual = await leerContador(c.id);
  console.log(`- contadores/${c.id}: valor=${actual.valor}`);
}

await terminate(db);
process.exit(0);
