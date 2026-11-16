// Pruebas de seguridad de fotosEntrega y clientes (auditoría, agente 3). Emulador en el puerto 8285.
// Las marcadas "HUECO" pasan cuando el hueco EXISTE; las "CERRADO" son huecos que las reglas ya rechazan.
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, increment, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, deleteDoc } from 'firebase/firestore';

const MAESTRO = 'carlosbs1579@gmail.com';
const GRANJA = 'cultivos-lore';
const SIN = { crearLotes: false, registrarEventos: false, cerrarLotes: false, gestionarPedidos: false };
const perfil = (uid, extra) => ({
  uid, email: `${uid}@prueba.co`, displayName: uid, rol: 'operario', granjaId: GRANJA, cargo: '',
  estado: 'activo', permisos: SIN, creadoEn: 'x', actualizadoEn: 'x', ...extra
});
const PERFILES = {
  vendedor: perfil('vendedor', { roles: ['operator'], permisos: { ...SIN, gestionarPedidos: true } }),
  repartidor: perfil('repartidor', { roles: ['courier'] })
};
const LOTE = {
  codigo: 'LT-001', estanque: 'E1', estado: 'cerrado', granjaId: GRANJA, fechaSiembra: '2026-10-01', creadoPor: MAESTRO,
  creadoPorUid: 'maestro', creadoEn: 'x', consecutivo: 1,
  eventos: [{ indice: 0, tipo: 'Siembra', hash: 'h0' }, { indice: 1, tipo: 'Cosecha', hash: 'h1' }],
  resumen: { pecesCosechados: 3000, biomasaCosechadaKg: 1500, pecesVivos: 0 }
};
const DIA = 86400000;
let env;
let n = 0;
const como = (uid) => env.authenticatedContext(uid, { email: PERFILES[uid].email, email_verified: true }).firestore();
const evento = (uid, indice, tipo, extra = {}) => ({
  indice, tipo, fecha: new Date().toISOString(), registradoPor: PERFILES[uid].email, registradoPorUid: uid, descripcion: '', datos: {}, ...extra
});
const eventoRep = (uid, indice, tipo, extra = {}) => evento(uid, indice, tipo, { eventoId: `ev-${++n}`, funcion: 'courier', ...extra });
async function leer(ruta) {
  let d = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const s = await getDoc(doc(ctx.firestore(), ...ruta.split('/')));
    d = s.exists() ? s.data() : null;
  });
  return d;
}
async function accion(uid, id, cambios, tipo) {
  const o = await leer(`ordenes/${id}`);
  return updateDoc(doc(como(uid), 'ordenes', id), { ...cambios, actualizadoEn: 'y', historial: [...o.historial, eventoRep(uid, o.historial.length, tipo)] });
}
async function enLlegada(id) {
  const db = como('vendedor');
  const o = {
    id, granjaId: GRANJA, clienteId: 'CLI1', clienteNombre: 'Restaurante', clienteDireccion: 'Calle 1', clienteContacto: '300',
    creadoPor: PERFILES.vendedor.email, creadoPorUid: 'vendedor', repartidorUid: 'repartidor', repartidorNombre: 'repartidor',
    creadoEn: 'x', actualizadoEn: 'x', fechaProgramada: null, unidad: 'peces', cantidadSolicitada: 100,
    procedencias: { 'LT-001': { estanque: 'E1', cantidad: 100, unidad: 'peces' } }, cantidadAutorizada: 100, cantidadEntregada: 0,
    estado: 'asignado', observaciones: '', historial: [evento('vendedor', 0, 'Creación')]
  };
  const b = writeBatch(db);
  b.set(doc(db, 'inventarioLotes', 'LT-001'), { codigoLote: 'LT-001', granjaId: GRANJA, unidad: 'peces', reservado: 100, entregado: 0, ultimaOrden: id, movidoEn: serverTimestamp(), tipoMovimiento: 'reserva' });
  b.set(doc(db, 'ordenes', id), o);
  await b.commit();
  await accion('repartidor', id, { estado: 'en_ruta', rutaIniciadaEn: new Date().toISOString(), llegadaEn: null }, 'Inicio de ruta');
  await accion('repartidor', id, { llegadaEn: new Date().toISOString() }, 'Llegada');
}
function registroFoto(fotoId, id, eventoId, datos) {
  return {
    id: fotoId, ordenId: id, granjaId: GRANJA, eventoId, subidaPorUid: 'repartidor', tomadaEn: 'x',
    expiraEn: Timestamp.fromMillis(Date.now() + 15 * DIA), tipo: 'image/jpeg', ancho: 1, alto: 1, bytes: 1, hash: 'a'.repeat(64), datos
  };
}
async function entregarConFoto(id, fotoId, datos) {
  const o = await leer(`ordenes/${id}`);
  const db = como('repartidor');
  const b = writeBatch(db);
  const eventoId = `ev-entrega-${id}`;
  b.set(doc(db, 'fotosEntrega', fotoId), registroFoto(fotoId, id, eventoId, datos));
  b.update(doc(db, 'inventarioLotes', 'LT-001'), { entregado: increment(100), reservado: increment(-100), ultimaOrden: id, movidoEn: serverTimestamp(), tipoMovimiento: 'entrega' });
  b.update(doc(db, 'ordenes', id), {
    estado: 'entregado', entregadoPorLote: { 'LT-001': 100 }, cantidadEntregada: 100, actualizadoEn: 'y',
    historial: [...o.historial, { ...eventoRep('repartidor', o.historial.length, 'Entrega', { datos: { entregas: { 'LT-001': 100 }, foto: { id: fotoId, hash: 'a'.repeat(64), bytes: 1 } } }), eventoId }]
  });
  return b.commit();
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-tilapia-seg-fotos',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8285 }
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, d] of Object.entries(PERFILES)) await setDoc(doc(db, 'usuarios', uid), d);
    await setDoc(doc(db, 'lotes', 'LT-001'), LOTE);
    await setDoc(doc(db, 'clientes', 'CLI1'), { granjaId: GRANJA, nombre: 'Restaurante', contacto: '300', direccion: 'Calle 1', creadoPor: MAESTRO, creadoPorUid: 'maestro', creadoEn: 'x', actualizadoEn: 'x' });
  });
});

describe('fotosEntrega: contenido y reemplazo', () => {
  test('CERRADO (H13): la "foto" solo puede ser data:image/jpeg en base64, nunca una URL externa', async () => {
    await enLlegada('PED-S1');
    const fotoId = 'foto_externa' + 'x'.repeat(20);
    await assertFails(entregarConFoto('PED-S1', fotoId, 'https://atacante.example/pixel.png?' + 'q'.repeat(120)));
    await assertFails(entregarConFoto('PED-S1', fotoId, 'data:image/png;base64,' + 'A'.repeat(200)));
    await assertFails(entregarConFoto('PED-S1', fotoId, 'data:image/jpeg;base64,' + 'A'.repeat(200) + '"><script>'));
    // La entrega con una foto real sigue pasando
    await assertSucceeds(entregarConFoto('PED-S1', fotoId, 'data:image/jpeg;base64,/9j/' + 'A'.repeat(200) + '=='));
  });
  test('CERRADO (H13): vencida la foto (TTL), ya no se puede volver a crear con otro contenido', async () => {
    await enLlegada('PED-S2');
    const fotoId = 'foto_original' + 'x'.repeat(20);
    await assertSucceeds(entregarConFoto('PED-S2', fotoId, 'data:image/jpeg;base64,' + 'A'.repeat(200)));
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'fotosEntrega', fotoId)));
    const o = await leer('ordenes/PED-S2');
    const ev = o.historial[o.historial.length - 1];
    await assertFails(setDoc(doc(como('repartidor'), 'fotosEntrega', fotoId), registroFoto(fotoId, 'PED-S2', ev.eventoId, 'data:image/jpeg;base64,' + 'B'.repeat(200))));
  });
});

describe('clientes: límites en la edición', () => {
  test('CERRADO (H49): al editar, contacto tiene límite de tamaño y debe ser texto', async () => {
    await assertFails(updateDoc(doc(como('vendedor'), 'clientes', 'CLI1'), { contacto: 'x'.repeat(900000), actualizadoEn: 'z' }));
    await assertFails(updateDoc(doc(como('vendedor'), 'clientes', 'CLI1'), { contacto: { objeto: true }, actualizadoEn: 'z2' }));
    await assertSucceeds(updateDoc(doc(como('vendedor'), 'clientes', 'CLI1'), { contacto: '3001112233', actualizadoEn: 'z3' }));
  });
  test('el repartidor no lee ni edita clientes', async () => {
    await assertFails(getDoc(doc(como('repartidor'), 'clientes', 'CLI1')));
    await assertFails(updateDoc(doc(como('repartidor'), 'clientes', 'CLI1'), { nombre: 'x' }));
  });
});
