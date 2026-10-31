// Pruebas de firestore.rules para las acciones del repartidor (ruta, llegada, entrega, novedades,
// solicitudes de ajuste) y las decisiones del operador (ajustes, saldo de entregas parciales).
// Las escrituras imitan las de src/services/repartoService.ts y pedidosService.ts.
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';

const MAESTRO = 'carlosbs1579@gmail.com';
const GRANJA = 'cultivos-lore';
const SIN = {
  crearLotes: false, registrarEventos: false, cerrarLotes: false, gestionarEstanques: false,
  gestionarConfiguracion: false, administrarUsuarios: false, gestionarPedidos: false
};
const perfil = (uid, extra) => ({
  uid, email: `${uid}@prueba.co`, displayName: uid, rol: 'operario', granjaId: GRANJA, cargo: '',
  estado: 'activo', permisos: SIN, creadoEn: 'x', actualizadoEn: 'x', ...extra
});
const PERFILES = {
  maestro: perfil('maestro', { email: MAESTRO, rol: 'admin', roles: ['admin'] }),
  vendedor: perfil('vendedor', { roles: ['operator'], permisos: { ...SIN, gestionarPedidos: true } }),
  operario: perfil('operario', { roles: ['operator'], permisos: { ...SIN, registrarEventos: true } }),
  repartidor: perfil('repartidor', { roles: ['courier'] }),
  repartidor2: perfil('repartidor2', { roles: ['courier'] }),
  // Operador con permiso de pedidos y también repartidor
  mixto: perfil('mixto', { roles: ['operator', 'courier'], permisos: { ...SIN, gestionarPedidos: true } })
};
const lote = (codigo, estanque, peces) => ({
  codigo, estanque, estado: 'cerrado', granjaId: GRANJA, fechaSiembra: '2026-10-01', creadoPor: MAESTRO,
  creadoPorUid: 'maestro', creadoEn: 'x', consecutivo: 1,
  eventos: [{ indice: 0, tipo: 'Siembra', hash: 'h0' }, { indice: 1, tipo: 'Cosecha', hash: 'h1' }],
  resumen: { pecesCosechados: peces, biomasaCosechadaKg: peces / 2, pecesVivos: 0 }
});
const LOTES = {
  'LT-001': lote('LT-001', 'E1', 3000), 'LT-002': lote('LT-002', 'E2', 1000), 'LT-003': lote('LT-003', 'E1', 200),
  'LT-004': lote('LT-004', 'E2', 500)
};

let env;
const como = (uid) =>
  env.authenticatedContext(uid, { email: PERFILES[uid].email, email_verified: true }).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-tilapia-entregas',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 }
  });
});
after(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, d] of Object.entries(PERFILES)) await setDoc(doc(db, 'usuarios', uid), d);
    for (const [c, d] of Object.entries(LOTES)) await setDoc(doc(db, 'lotes', c), d);
    await setDoc(doc(db, 'clientes', 'CLI1'), {
      granjaId: GRANJA, nombre: 'Restaurante', contacto: '300', direccion: 'Calle 1', creadoPor: MAESTRO,
      creadoPorUid: 'maestro', creadoEn: 'x', actualizadoEn: 'x'
    });
  });
});

let contador = 0;
const evento = (uid, indice, tipo, extra = {}) => ({
  indice, tipo, fecha: new Date().toISOString(), registradoPor: PERFILES[uid].email, registradoPorUid: uid,
  descripcion: '', datos: {}, ...extra
});
const eventoRep = (uid, indice, tipo, extra = {}) =>
  evento(uid, indice, tipo, { eventoId: `ev-${++contador}`, funcion: 'courier', ...extra });

async function leer(ruta) {
  let d = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const s = await getDoc(doc(ctx.firestore(), ...ruta.split('/')));
    d = s.exists() ? s.data() : null;
  });
  return d;
}

// Crea una orden asignada con sus reservas (como el operador) y la devuelve
async function crearAsignada(id, cantidades, repartidor = 'repartidor') {
  const db = como('vendedor');
  const procedencias = Object.fromEntries(Object.entries(cantidades).map(([c, n]) => [c, { estanque: LOTES[c].estanque, cantidad: n, unidad: 'peces' }]));
  const total = Object.values(cantidades).reduce((s, n) => s + n, 0);
  const o = {
    id, granjaId: GRANJA, clienteId: 'CLI1', clienteNombre: 'Restaurante', clienteDireccion: 'Calle 1', clienteContacto: '300',
    creadoPor: PERFILES.vendedor.email, creadoPorUid: 'vendedor', repartidorUid: repartidor, repartidorNombre: repartidor,
    creadoEn: 'x', actualizadoEn: 'x', fechaProgramada: null, unidad: 'peces', cantidadSolicitada: total,
    procedencias, cantidadAutorizada: total, cantidadEntregada: 0, estado: 'asignado', observaciones: '',
    historial: [evento('vendedor', 0, 'Creación')]
  };
  const batch = writeBatch(db);
  for (const [c, n] of Object.entries(cantidades)) {
    const inv = await leer(`inventarioLotes/${c}`);
    batch.set(doc(db, 'inventarioLotes', c), {
      codigoLote: c, granjaId: GRANJA, unidad: 'peces', reservado: (inv?.reservado || 0) + n, entregado: inv?.entregado || 0,
      ultimaOrden: id, movidoEn: serverTimestamp(), tipoMovimiento: 'reserva'
    });
  }
  batch.set(doc(db, 'ordenes', id), o);
  await batch.commit();
  return o;
}

// Aplica una acción a la orden con el historial vigente
async function accion(uid, id, cambios, tipo, extraEvento = {}, esRepartidor = true) {
  const o = await leer(`ordenes/${id}`);
  const ev = esRepartidor ? eventoRep(uid, o.historial.length, tipo, extraEvento) : evento(uid, o.historial.length, tipo, extraEvento);
  return updateDoc(doc(como(uid), 'ordenes', id), { ...cambios, actualizadoEn: 'y', historial: [...o.historial, ev] });
}

const iniciarRuta = (uid, id) => accion(uid, id, { estado: 'en_ruta', rutaIniciadaEn: new Date().toISOString(), llegadaEn: null }, 'Inicio de ruta');
const llegar = (uid, id) => accion(uid, id, { llegadaEn: new Date().toISOString() }, 'Llegada');

// Confirma una entrega: mueve el inventario de cada lote (reservado -> entregado) y actualiza la orden
async function entregar(uid, id, entregas, { estado, moverInventario = true, delta } = {}) {
  const o = await leer(`ordenes/${id}`);
  const previo = o.entregadoPorLote || {};
  const nuevo = { ...previo };
  for (const [c, n] of Object.entries(entregas)) nuevo[c] = (previo[c] || 0) + n;
  const total = Object.values(nuevo).reduce((s, n) => s + n, 0);
  const db = como(uid);
  const batch = writeBatch(db);
  if (moverInventario) {
    for (const [c, n] of Object.entries(entregas)) {
      const d = delta ?? n;
      batch.update(doc(db, 'inventarioLotes', c), {
        entregado: increment(d), reservado: increment(-d), ultimaOrden: id, movidoEn: serverTimestamp(), tipoMovimiento: 'entrega'
      });
    }
  }
  batch.update(doc(db, 'ordenes', id), {
    estado: estado ?? (total === o.cantidadAutorizada ? 'entregado' : 'entrega_parcial'),
    entregadoPorLote: nuevo, cantidadEntregada: total, actualizadoEn: 'y',
    historial: [...o.historial, eventoRep(uid, o.historial.length, 'Entrega', { datos: { entregas } })]
  });
  return batch.commit();
}

function solicitud(uid, o, id, propuesta, extra = {}) {
  return {
    id, estado: 'pendiente_aprobacion', original: o.procedencias, propuesta, motivo: 'Cambio de lote en planta',
    solicitadoPor: PERFILES[uid].email, solicitadoPorUid: uid, solicitadoEn: new Date().toISOString(), ...extra
  };
}

async function solicitar(uid, idOrden, idAjuste, propuesta, extra) {
  const o = await leer(`ordenes/${idOrden}`);
  return accion(uid, idOrden, { [`ajustes.${idAjuste}`]: solicitud(uid, o, idAjuste, propuesta, extra) }, 'Solicitud de ajuste', { datos: { ajusteId: idAjuste } });
}

// El operador aprueba y aplica un ajuste: nueva distribución + movimientos del inventario
async function aprobar(uid, idOrden, idAjuste, { mover = true, alterar } = {}) {
  const o = await leer(`ordenes/${idOrden}`);
  const a = o.ajustes[idAjuste];
  const nuevas = Object.fromEntries(Object.entries(a.propuesta).map(([c, n]) => [c, { estanque: LOTES[c].estanque, cantidad: n, unidad: 'peces' }]));
  const db = como(uid);
  const batch = writeBatch(db);
  if (mover) {
    for (const c of new Set([...Object.keys(o.procedencias), ...Object.keys(nuevas)])) {
      const d = (nuevas[c]?.cantidad || 0) - (o.procedencias[c]?.cantidad || 0);
      if (d === 0) continue;
      const inv = await leer(`inventarioLotes/${c}`);
      if (inv) batch.update(doc(db, 'inventarioLotes', c), { reservado: inv.reservado + (alterar ?? d), ultimaOrden: idOrden, movidoEn: serverTimestamp(), tipoMovimiento: 'ajuste' });
      else batch.set(doc(db, 'inventarioLotes', c), { codigoLote: c, granjaId: GRANJA, unidad: 'peces', reservado: d, entregado: 0, ultimaOrden: idOrden, movidoEn: serverTimestamp(), tipoMovimiento: 'ajuste' });
    }
  }
  batch.update(doc(db, 'ordenes', idOrden), {
    procedencias: nuevas,
    cantidadAutorizada: Object.values(a.propuesta).reduce((s, n) => s + n, 0),
    [`ajustes.${idAjuste}`]: { ...a, estado: 'aplicada', resueltoPor: PERFILES[uid].email, resueltoPorUid: uid, resueltoEn: 'z', respuesta: 'ok' },
    actualizadoEn: 'y',
    historial: [...o.historial, evento(uid, o.historial.length, 'Ajuste aplicado', { datos: { ajusteId: idAjuste } })]
  });
  return batch.commit();
}

async function rechazar(uid, idOrden, idAjuste) {
  const o = await leer(`ordenes/${idOrden}`);
  const a = o.ajustes[idAjuste];
  return accion(uid, idOrden, {
    [`ajustes.${idAjuste}`]: { ...a, estado: 'rechazada', resueltoPor: PERFILES[uid].email, resueltoPorUid: uid, resueltoEn: 'z', respuesta: 'no' }
  }, 'Ajuste rechazado', { datos: { ajusteId: idAjuste } }, false);
}

// El operador libera el saldo de una entrega parcial (o cancela) moviendo el inventario
async function liberarSaldo(uid, idOrden, { estado, tipo, cantidadLiberada }) {
  const o = await leer(`ordenes/${idOrden}`);
  const db = como(uid);
  const batch = writeBatch(db);
  for (const [c, p] of Object.entries(o.procedencias)) {
    const saldo = p.cantidad - ((o.entregadoPorLote || {})[c] || 0);
    if (saldo <= 0) continue;
    const inv = await leer(`inventarioLotes/${c}`);
    batch.update(doc(db, 'inventarioLotes', c), { reservado: inv.reservado - saldo, ultimaOrden: idOrden, movidoEn: serverTimestamp(), tipoMovimiento: 'liberacion' });
  }
  batch.update(doc(db, 'ordenes', idOrden), {
    estado, ...(cantidadLiberada !== undefined ? { cantidadLiberada } : {}), actualizadoEn: 'y',
    historial: [...o.historial, evento(uid, o.historial.length, tipo)]
  });
  return batch.commit();
}

describe('Consulta de pedidos', () => {
  test('1 y 2. el repartidor consulta solo sus pedidos', async () => {
    await crearAsignada('PED-1', { 'LT-001': 100 }, 'repartidor');
    await crearAsignada('PED-2', { 'LT-001': 100 }, 'repartidor2');
    const res = await assertSucceeds(getDocs(query(collection(como('repartidor'), 'ordenes'), where('repartidorUid', '==', 'repartidor'))));
    assert.deepEqual(res.docs.map((d) => d.id), ['PED-1']);
    await assertFails(getDoc(doc(como('repartidor'), 'ordenes', 'PED-2')));
    await assertFails(getDocs(query(collection(como('repartidor'), 'ordenes'), where('repartidorUid', '==', 'repartidor2'))));
  });
});

describe('Ruta, llegada y entrega', () => {
  test('3 y 4. iniciar ruta y registrar llegada en orden', async () => {
    await crearAsignada('PED-R', { 'LT-001': 100 });
    await assertFails(llegar('repartidor', 'PED-R')); // sin ruta iniciada
    await assertFails(iniciarRuta('repartidor2', 'PED-R')); // repartidor ajeno
    await assertSucceeds(iniciarRuta('repartidor', 'PED-R'));
    await assertFails(iniciarRuta('repartidor', 'PED-R')); // ya en ruta
    await assertSucceeds(llegar('repartidor', 'PED-R'));
    await assertFails(llegar('repartidor', 'PED-R')); // una sola llegada
    const o = await leer('ordenes/PED-R');
    assert.equal(o.estado, 'en_ruta');
    assert.ok(o.rutaIniciadaEn && o.llegadaEn);
    assert.deepEqual(o.historial.map((e) => e.tipo), ['Creación', 'Inicio de ruta', 'Llegada']);
  });

  test('las acciones del repartidor exigen identificador de evento y función de repartidor', async () => {
    await crearAsignada('PED-ID', { 'LT-001': 100 });
    const o = await leer('ordenes/PED-ID');
    await assertFails(updateDoc(doc(como('repartidor'), 'ordenes', 'PED-ID'), {
      estado: 'en_ruta', rutaIniciadaEn: 'x', llegadaEn: null,
      historial: [...o.historial, evento('repartidor', 1, 'Inicio de ruta', { funcion: 'operator', eventoId: 'a' })]
    }));
    await assertFails(updateDoc(doc(como('repartidor'), 'ordenes', 'PED-ID'), {
      estado: 'en_ruta', rutaIniciadaEn: 'x', llegadaEn: null, historial: [...o.historial, evento('repartidor', 1, 'Inicio de ruta', { funcion: 'courier' })]
    }));
  });

  test('no se inicia la ruta de un borrador ni de una orden cancelada', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'ordenes', 'PED-B'), {
        id: 'PED-B', granjaId: GRANJA, clienteId: 'CLI1', clienteNombre: 'R', creadoPor: 'v', creadoPorUid: 'vendedor',
        repartidorUid: 'repartidor', repartidorNombre: 'r', creadoEn: 'x', actualizadoEn: 'x', fechaProgramada: null,
        unidad: 'peces', cantidadSolicitada: 10, procedencias: {}, cantidadAutorizada: 0, cantidadEntregada: 0,
        estado: 'borrador', observaciones: '', historial: [evento('vendedor', 0, 'Creación')]
      })
    );
    await assertFails(iniciarRuta('repartidor', 'PED-B'));
  });

  test('5. entrega completa: pasa a entregado y el inventario mueve reservado a entregado', async () => {
    await crearAsignada('PED-C', { 'LT-001': 1500, 'LT-002': 500 });
    await assertSucceeds(iniciarRuta('repartidor', 'PED-C'));
    await assertFails(entregar('repartidor', 'PED-C', { 'LT-001': 1500, 'LT-002': 500 })); // sin llegada
    await assertSucceeds(llegar('repartidor', 'PED-C'));
    await assertSucceeds(entregar('repartidor', 'PED-C', { 'LT-001': 1500, 'LT-002': 500 }));
    const o = await leer('ordenes/PED-C');
    assert.equal(o.estado, 'entregado');
    assert.equal(o.cantidadEntregada, 2000);
    assert.deepEqual(await leer('inventarioLotes/LT-001').then((i) => [i.reservado, i.entregado]), [0, 1500]);
    assert.deepEqual(await leer('inventarioLotes/LT-002').then((i) => [i.reservado, i.entregado]), [0, 500]);
  });

  test('6 y 7. entrega parcial: 1.950 de 2.000 queda como entrega parcial con 50 pendientes', async () => {
    await crearAsignada('PED-P', { 'LT-001': 1500, 'LT-002': 500 });
    await iniciarRuta('repartidor', 'PED-P');
    await llegar('repartidor', 'PED-P');
    // No puede marcarse entregada con saldo pendiente
    await assertFails(entregar('repartidor', 'PED-P', { 'LT-001': 1450, 'LT-002': 500 }, { estado: 'entregado' }));
    await assertSucceeds(entregar('repartidor', 'PED-P', { 'LT-001': 1450, 'LT-002': 500 }));
    const o = await leer('ordenes/PED-P');
    assert.equal(o.estado, 'entrega_parcial');
    assert.equal(o.cantidadAutorizada - o.cantidadEntregada, 50);
    assert.deepEqual(await leer('inventarioLotes/LT-001').then((i) => [i.reservado, i.entregado]), [50, 1450]);
  });

  test('8. no se entrega más de lo autorizado ni sin mover el inventario exacto', async () => {
    await crearAsignada('PED-X', { 'LT-001': 100, 'LT-002': 100 });
    await iniciarRuta('repartidor', 'PED-X');
    await llegar('repartidor', 'PED-X');
    await assertFails(entregar('repartidor', 'PED-X', { 'LT-001': 101 })); // más que lo autorizado del lote
    await assertFails(entregar('repartidor', 'PED-X', { 'LT-001': 150, 'LT-002': 60 })); // total mayor
    await assertFails(entregar('repartidor', 'PED-X', { 'LT-001': 50 }, { moverInventario: false }));
    await assertFails(entregar('repartidor', 'PED-X', { 'LT-001': 50 }, { delta: 40 }));
    await assertFails(entregar('repartidor2', 'PED-X', { 'LT-001': 50 })); // repartidor ajeno
    await assertFails(entregar('vendedor', 'PED-X', { 'LT-001': 50 })); // el operador no confirma entregas
  });

  test('reprogramar el saldo y completar en una segunda ruta', async () => {
    await crearAsignada('PED-RP', { 'LT-001': 200 });
    await iniciarRuta('repartidor', 'PED-RP');
    await llegar('repartidor', 'PED-RP');
    await assertSucceeds(entregar('repartidor', 'PED-RP', { 'LT-001': 150 }));
    await assertFails(iniciarRuta('repartidor', 'PED-RP')); // el saldo lo decide el operador
    await assertSucceeds(accion('vendedor', 'PED-RP', { estado: 'asignado', rutaIniciadaEn: null, llegadaEn: null }, 'Reprogramación de saldo', {}, false));
    await assertSucceeds(iniciarRuta('repartidor', 'PED-RP'));
    await assertSucceeds(llegar('repartidor', 'PED-RP'));
    await assertSucceeds(entregar('repartidor', 'PED-RP', { 'LT-001': 50 }));
    const o = await leer('ordenes/PED-RP');
    assert.equal(o.estado, 'entregado');
    assert.equal(o.entregadoPorLote['LT-001'], 200);
    assert.deepEqual(await leer('inventarioLotes/LT-001').then((i) => [i.reservado, i.entregado]), [0, 200]);
  });

  test('liberar el saldo de una entrega parcial y cerrar', async () => {
    await crearAsignada('PED-LS', { 'LT-001': 300, 'LT-002': 100 });
    await iniciarRuta('repartidor', 'PED-LS');
    await llegar('repartidor', 'PED-LS');
    await entregar('repartidor', 'PED-LS', { 'LT-001': 250, 'LT-002': 100 });
    // Liberando una cantidad distinta del saldo: rechazado
    await assertFails(liberarSaldo('vendedor', 'PED-LS', { estado: 'entregado', tipo: 'Cierre con saldo liberado', cantidadLiberada: 40 }));
    await assertSucceeds(liberarSaldo('vendedor', 'PED-LS', { estado: 'entregado', tipo: 'Cierre con saldo liberado', cantidadLiberada: 50 }));
    assert.deepEqual(await leer('inventarioLotes/LT-001').then((i) => [i.reservado, i.entregado]), [0, 250]);
    assert.equal((await leer('ordenes/PED-LS')).cantidadLiberada, 50);
  });

  test('cancelar una orden reprogramada libera solo el saldo no entregado', async () => {
    await crearAsignada('PED-CS', { 'LT-001': 300 });
    await iniciarRuta('repartidor', 'PED-CS');
    await llegar('repartidor', 'PED-CS');
    await entregar('repartidor', 'PED-CS', { 'LT-001': 100 });
    await accion('vendedor', 'PED-CS', { estado: 'asignado', rutaIniciadaEn: null, llegadaEn: null }, 'Reprogramación de saldo', {}, false);
    await assertSucceeds(liberarSaldo('vendedor', 'PED-CS', { estado: 'cancelado', tipo: 'Cancelación' }));
    assert.deepEqual(await leer('inventarioLotes/LT-001').then((i) => [i.reservado, i.entregado]), [0, 100]);
  });
});

describe('Novedades', () => {
  test('9. el repartidor registra novedades en sus pedidos activos', async () => {
    await crearAsignada('PED-N', { 'LT-001': 100 });
    await assertSucceeds(accion('repartidor', 'PED-N', {}, 'Novedad', { descripcion: 'Cliente no disponible', datos: { categoria: 'Cliente no disponible' } }));
    await assertFails(accion('repartidor', 'PED-N', {}, 'Novedad', { descripcion: '' }));
    await assertFails(accion('repartidor2', 'PED-N', {}, 'Novedad', { descripcion: 'x' }));
    // Una novedad no puede colar otros cambios
    await assertFails(accion('repartidor', 'PED-N', { cantidadAutorizada: 1 }, 'Novedad', { descripcion: 'x' }));
  });
});

describe('Solicitudes de ajuste', () => {
  test('10 y 11. la solicitud queda pendiente y no cambia distribución ni reservas', async () => {
    await crearAsignada('PED-A', { 'LT-001': 1000, 'LT-002': 500 });
    const invAntes = await leer('inventarioLotes/LT-001');
    await assertSucceeds(solicitar('repartidor', 'PED-A', 'AJ1', { 'LT-001': 700, 'LT-002': 800 }));
    const o = await leer('ordenes/PED-A');
    assert.equal(o.ajustes.AJ1.estado, 'pendiente_aprobacion');
    assert.deepEqual(o.procedencias['LT-001'].cantidad, 1000);
    assert.deepEqual(await leer('inventarioLotes/LT-001'), invAntes);
  });

  test('el repartidor no cambia la distribución directamente ni pide a nombre de otro', async () => {
    await crearAsignada('PED-AD', { 'LT-001': 100 });
    const o = await leer('ordenes/PED-AD');
    await assertFails(accion('repartidor', 'PED-AD', { 'procedencias.LT-001.cantidad': 50 }, 'Novedad', { descripcion: 'x' }));
    await assertFails(accion('repartidor', 'PED-AD', { cantidadAutorizada: 50 }, 'Novedad', { descripcion: 'x' }));
    await assertFails(accion('repartidor', 'PED-AD', { repartidorUid: 'repartidor2' }, 'Novedad', { descripcion: 'x' }));
    await assertFails(solicitar('repartidor', 'PED-AD', 'AJX', { 'LT-001': 50 }, { solicitadoPorUid: 'repartidor2' }));
    await assertFails(solicitar('repartidor', 'PED-AD', 'AJY', { 'LT-001': 50 }, { estado: 'aplicada' }));
    await assertFails(solicitar('repartidor', 'PED-AD', 'AJZ', { 'LT-001': 50000 })); // supera lo solicitado
    assert.equal(o.procedencias['LT-001'].cantidad, 100);
  });

  test('12. el operador rechaza; nadie aprueba su propia solicitud', async () => {
    await crearAsignada('PED-RJ', { 'LT-001': 100 }, 'mixto');
    await assertSucceeds(solicitar('mixto', 'PED-RJ', 'AJ1', { 'LT-001': 80 }));
    await assertFails(aprobar('mixto', 'PED-RJ', 'AJ1')); // operador y repartidor a la vez: no aprueba lo suyo
    await assertFails(rechazar('mixto', 'PED-RJ', 'AJ1'));
    await assertFails(aprobar('repartidor', 'PED-RJ', 'AJ1'));
    await assertSucceeds(rechazar('vendedor', 'PED-RJ', 'AJ1'));
    const o = await leer('ordenes/PED-RJ');
    assert.equal(o.ajustes.AJ1.estado, 'rechazada');
    assert.equal(o.procedencias['LT-001'].cantidad, 100);
    await assertFails(rechazar('vendedor', 'PED-RJ', 'AJ1')); // ya resuelta
  });

  test('13. aprobar aplica la nueva distribución moviendo el inventario', async () => {
    await crearAsignada('PED-AP', { 'LT-001': 1000, 'LT-002': 500 });
    await solicitar('repartidor', 'PED-AP', 'AJ1', { 'LT-002': 800, 'LT-003': 150, 'LT-001': 550 });
    await assertFails(aprobar('vendedor', 'PED-AP', 'AJ1', { mover: false })); // sin mover el inventario
    await assertFails(aprobar('vendedor', 'PED-AP', 'AJ1', { alterar: 10 })); // movimientos que no cuadran
    await assertSucceeds(aprobar('vendedor', 'PED-AP', 'AJ1'));
    const o = await leer('ordenes/PED-AP');
    assert.equal(o.ajustes.AJ1.estado, 'aplicada');
    assert.equal(o.cantidadAutorizada, 1500);
    assert.deepEqual(o.ajustes.AJ1.original['LT-001'].cantidad, 1000); // se conserva la distribución original
    assert.equal((await leer('inventarioLotes/LT-001')).reservado, 550);
    assert.equal((await leer('inventarioLotes/LT-002')).reservado, 800);
    assert.equal((await leer('inventarioLotes/LT-003')).reservado, 150);
  });

  test('un ajuste que supera la disponibilidad no se puede aplicar', async () => {
    await crearAsignada('PED-OTRO', { 'LT-003': 150 });
    await crearAsignada('PED-AX', { 'LT-001': 100 });
    await solicitar('repartidor', 'PED-AX', 'AJ1', { 'LT-001': 40, 'LT-003': 60 }); // LT-003 solo tiene 50 libres
    await assertFails(aprobar('vendedor', 'PED-AX', 'AJ1'));
    assert.equal((await leer('ordenes/PED-AX')).ajustes.AJ1.estado, 'pendiente_aprobacion');
  });

  test('el repartidor cancela su solicitud pendiente; tras una entrega ya no se pide ajuste', async () => {
    await crearAsignada('PED-CA', { 'LT-001': 100 });
    await solicitar('repartidor', 'PED-CA', 'AJ1', { 'LT-001': 90 });
    const o = await leer('ordenes/PED-CA');
    await assertSucceeds(accion('repartidor', 'PED-CA', { 'ajustes.AJ1': { ...o.ajustes.AJ1, estado: 'cancelada' } }, 'Cancelación de solicitud', { datos: { ajusteId: 'AJ1' } }));
    await iniciarRuta('repartidor', 'PED-CA');
    await llegar('repartidor', 'PED-CA');
    await entregar('repartidor', 'PED-CA', { 'LT-001': 40 });
    await assertFails(solicitar('repartidor', 'PED-CA', 'AJ2', { 'LT-001': 60 }));
  });
});

describe('Auditoría y accesos no autorizados', () => {
  test('15. el historial no se puede reescribir', async () => {
    await crearAsignada('PED-H', { 'LT-001': 100 });
    await iniciarRuta('repartidor', 'PED-H');
    const o = await leer('ordenes/PED-H');
    await assertFails(updateDoc(doc(como('repartidor'), 'ordenes', 'PED-H'), {
      actualizadoEn: 'z', historial: [o.historial[0], { ...o.historial[1], descripcion: 'cambiado' }, eventoRep('repartidor', 2, 'Novedad', { descripcion: 'x' })]
    }));
    await assertFails(updateDoc(doc(como('repartidor'), 'ordenes', 'PED-H'), { actualizadoEn: 'z', historial: [o.historial[0]] }));
  });

  test('16. sin el rol o la asignación no hay acciones por solicitudes directas', async () => {
    await crearAsignada('PED-U', { 'LT-001': 100 });
    await assertFails(iniciarRuta('operario', 'PED-U'));
    await assertFails(iniciarRuta('repartidor2', 'PED-U'));
    // Un repartidor no toca el inventario por fuera de una entrega propia
    await assertFails(updateDoc(doc(como('repartidor'), 'inventarioLotes', 'LT-001'), { reservado: 0, ultimaOrden: 'PED-U', movidoEn: serverTimestamp() }));
    await assertFails(getDoc(doc(como('repartidor'), 'inventarioLotes', 'LT-001')));
    // Ni se asigna pedidos ni cambia su rol
    await assertFails(updateDoc(doc(como('repartidor2'), 'ordenes', 'PED-U'), { repartidorUid: 'repartidor2' }));
    await assertFails(updateDoc(doc(como('repartidor'), 'usuarios', 'repartidor'), { roles: ['courier', 'operator'] }));
  });

  test('17. los lotes no cambian con todo el ciclo de entrega', async () => {
    const antes = await leer('lotes/LT-001');
    await crearAsignada('PED-I', { 'LT-001': 100 });
    await iniciarRuta('repartidor', 'PED-I');
    await llegar('repartidor', 'PED-I');
    await entregar('repartidor', 'PED-I', { 'LT-001': 100 });
    assert.deepEqual(await leer('lotes/LT-001'), antes);
    await assertFails(updateDoc(doc(como('repartidor'), 'lotes', 'LT-001'), { estado: 'activo' }));
  });
});

describe('Casos más pesados (límite de expresiones de las reglas)', () => {
  test('ajuste que cambia 3 lotes y reemplaza uno por un lote nuevo', async () => {
    await crearAsignada('PED-W1', { 'LT-001': 300, 'LT-002': 300, 'LT-003': 100 });
    await solicitar('repartidor', 'PED-W1', 'AJ1', { 'LT-001': 200, 'LT-002': 350, 'LT-004': 150 });
    await assertSucceeds(aprobar('vendedor', 'PED-W1', 'AJ1'));
    assert.equal((await leer('inventarioLotes/LT-003')).reservado, 0);
    assert.equal((await leer('inventarioLotes/LT-004')).reservado, 150);
  });

  test('entrega de 3 lotes y liberación del saldo de 3 lotes', async () => {
    await crearAsignada('PED-W2', { 'LT-001': 300, 'LT-002': 300, 'LT-003': 100 });
    await iniciarRuta('repartidor', 'PED-W2');
    await llegar('repartidor', 'PED-W2');
    await assertSucceeds(entregar('repartidor', 'PED-W2', { 'LT-001': 250, 'LT-002': 250, 'LT-003': 50 }));
    await assertSucceeds(liberarSaldo('vendedor', 'PED-W2', { estado: 'entregado', tipo: 'Cierre con saldo liberado', cantidadLiberada: 150 }));
  });

  test('cancelar una orden de 3 lotes', async () => {
    await crearAsignada('PED-W3', { 'LT-001': 300, 'LT-002': 300, 'LT-003': 100 });
    await assertSucceeds(liberarSaldo('vendedor', 'PED-W3', { estado: 'cancelado', tipo: 'Cancelación' }));
  });
});

describe('Atención de novedades (fase 4)', () => {
  async function conNovedad(id) {
    await crearAsignada(id, { 'LT-001': 100 });
    await accion('repartidor', id, {}, 'Novedad', { descripcion: 'Cliente no disponible', datos: { categoria: 'Cliente no disponible' } });
    const o = await leer(`ordenes/${id}`);
    const indice = o.historial.length - 1;
    return { o, indice, nid: o.historial[indice].eventoId };
  }
  const atender = (uid, id, { nid, indice }, estado, extra = {}) =>
    accion(uid, id, {
      [`atencionNovedades.${nid}`]: { estado, actualizadoPor: PERFILES[uid].email, actualizadoPorUid: uid, actualizadoEn: 'z', ...extra }
    }, 'Atención de novedad', { descripcion: 'Se llamó al cliente', datos: { novedadId: nid, novedadIndice: indice, estado } }, false);

  test('11. el operador cambia el estado de atención sin tocar la novedad original', async () => {
    const n = await conNovedad('PED-AN');
    await assertSucceeds(atender('vendedor', 'PED-AN', n, 'en_revision'));
    await assertSucceeds(atender('vendedor', 'PED-AN', n, 'atendida'));
    const o = await leer('ordenes/PED-AN');
    assert.equal(o.atencionNovedades[n.nid].estado, 'atendida');
    assert.deepEqual(o.historial[n.indice], n.o.historial[n.indice]); // la novedad sigue igual
    assert.equal(o.estado, 'asignado'); // el estado de la orden no cambia
  });

  test('la atención se rechaza si no apunta a una novedad real, con estado inválido o hecha por el repartidor', async () => {
    const n = await conNovedad('PED-AX2');
    await assertFails(atender('vendedor', 'PED-AX2', { nid: n.nid, indice: 0 }, 'en_revision')); // índice de otro evento
    await assertFails(atender('vendedor', 'PED-AX2', { nid: 'inventado', indice: n.indice }, 'en_revision'));
    await assertFails(atender('vendedor', 'PED-AX2', n, 'resuelta_sola'));
    await assertFails(atender('vendedor', 'PED-AX2', n, 'atendida', { actualizadoPorUid: 'otro' }));
    await assertFails(atender('repartidor', 'PED-AX2', n, 'cerrada'));
    // Ni se puede aprovechar para cambiar otra cosa de la orden
    const o = await leer('ordenes/PED-AX2');
    await assertFails(updateDoc(doc(como('vendedor'), 'ordenes', 'PED-AX2'), {
      [`atencionNovedades.${n.nid}`]: { estado: 'cerrada', actualizadoPor: PERFILES.vendedor.email, actualizadoPorUid: 'vendedor', actualizadoEn: 'z' },
      cantidadAutorizada: 1, actualizadoEn: 'y',
      historial: [...o.historial, evento('vendedor', o.historial.length, 'Atención de novedad', { datos: { novedadId: n.nid, novedadIndice: n.indice, estado: 'cerrada' } })]
    }));
  });

  test('las novedades de una orden ya entregada se pueden seguir atendiendo', async () => {
    await crearAsignada('PED-AE', { 'LT-001': 100 });
    await iniciarRuta('repartidor', 'PED-AE');
    await llegar('repartidor', 'PED-AE');
    await accion('repartidor', 'PED-AE', {}, 'Novedad', { descripcion: 'Diferencia en cantidades', datos: {} });
    await entregar('repartidor', 'PED-AE', { 'LT-001': 100 });
    const o = await leer('ordenes/PED-AE');
    const indice = o.historial.findIndex((e) => e.tipo === 'Novedad');
    await assertSucceeds(atender('vendedor', 'PED-AE', { nid: o.historial[indice].eventoId, indice }, 'cerrada'));
  });
});

describe('Comprobantes de entrega (fase 5)', () => {
  const TOKEN = 'tok_' + 'a'.repeat(28);
  const H64 = 'f'.repeat(64);
  let n = 0;
  const idNuevo = () => 'cmp_' + String(++n).padStart(4, '0') + 'b'.repeat(24);

  async function entregaParcial(id) {
    await crearAsignada(id, { 'LT-001': 300, 'LT-002': 200 });
    await iniciarRuta('repartidor', id);
    await llegar('repartidor', id);
    await entregar('repartidor', id, { 'LT-001': 250, 'LT-002': 200 });
  }

  // Emite un comprobante como lo hace el servicio: comprobante + índice público + orden, en una sola operación
  async function emitir(uid, ordenId, { token = TOKEN, alterar = {}, alterarProc, indice, idComp, versionForzada } = {}) {
    const o = await leer(`ordenes/${ordenId}`);
    const consulta = await leer(`consultasEntrega/${token}`);
    const idx = indice ?? o.historial.map((e) => e.tipo).lastIndexOf('Entrega');
    const entrega = { ...o.historial[idx], eventoId: o.historial[idx].eventoId || 'evento-sin-id' };
    const id = idComp || idNuevo();
    const previas = consulta?.versiones || {};
    const versiones = {
      ...previas,
      [entrega.eventoId]: { comprobanteId: id, version: Object.keys(previas).length + 1, emitidoEn: 'x', estadoEntrega: o.estado, hashComprobante: H64 }
    };
    const procedencias = Object.fromEntries(
      Object.entries(o.procedencias).map(([c, p]) => [c, { estanque: p.estanque, autorizada: p.cantidad, entregada: (o.entregadoPorLote || {})[c] || 0 }])
    );
    if (alterarProc) Object.assign(procedencias[alterarProc.lote], alterarProc.cambios);
    const comprobante = {
      id, version: versionForzada ?? Object.keys(versiones).length, ordenId, granjaId: GRANJA, tokenConsulta: token, emitidoEn: 'x',
      emitidoPorUid: uid, empresa: 'Cultivos Loré', estadoEntrega: o.estado, cliente: { nombre: 'Restaurante', direccion: 'Calle 1' },
      repartidor: 'r', fechas: { creacion: 'x', programada: null, salida: 'x', llegada: 'x', confirmacion: 'x' }, unidad: o.unidad,
      cantidadSolicitada: o.cantidadSolicitada, cantidadAutorizada: o.cantidadAutorizada, cantidadEntregada: o.cantidadEntregada,
      cantidadLiberada: o.cantidadLiberada || 0,
      cantidadPendiente: o.cantidadAutorizada - o.cantidadEntregada - (o.cantidadLiberada || 0),
      procedencias, entregas: [], novedades: [], ajustes: [], eventoEntregaId: entrega.eventoId, eventoEntregaIndice: idx,
      eventosUsados: [entrega.eventoId], hashEventos: H64, hashComprobante: H64, ...alterar
    };
    const db = como(uid);
    const batch = writeBatch(db);
    batch.set(doc(db, 'comprobantes', id), comprobante);
    batch.set(doc(db, 'consultasEntrega', token), { token, ordenId, granjaId: GRANJA, versiones, ultimaVersion: id, actualizadoEn: 'x' });
    batch.update(doc(db, 'ordenes', ordenId), {
      tokenConsulta: token,
      actualizadoEn: 'y',
      historial: [
        ...o.historial,
        evento(uid, o.historial.length, 'Comprobante emitido', { datos: { comprobanteId: id, eventoEntregaId: entrega.eventoId, version: comprobante.version } })
      ]
    });
    await batch.commit();
    return id;
  }

  const reprogramar = (id) =>
    accion('vendedor', id, { estado: 'asignado', rutaIniciadaEn: null, llegadaEn: null }, 'Reprogramación de saldo', {}, false);

  test('1, 2 y 3. comprobante de una entrega parcial igual a la orden; consulta pública solo por código', async () => {
    await entregaParcial('PED-C1');
    const id = await emitir('vendedor', 'PED-C1');
    const c = await leer(`comprobantes/${id}`);
    assert.equal(c.estadoEntrega, 'entrega_parcial');
    assert.equal(c.cantidadPendiente, 50);
    const anonimo = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(anonimo, 'comprobantes', id)));
    await assertSucceeds(getDoc(doc(anonimo, 'consultasEntrega', TOKEN)));
    await assertFails(getDocs(collection(anonimo, 'consultasEntrega')));
    await assertFails(getDocs(query(collection(anonimo, 'comprobantes'), where('granjaId', '==', GRANJA))));
    await assertFails(getDoc(doc(anonimo, 'ordenes', 'PED-C1')));
  });

  test('12. no se emite un comprobante cuyas cantidades no coinciden con lo confirmado', async () => {
    await entregaParcial('PED-C2');
    await assertFails(emitir('vendedor', 'PED-C2', { alterar: { cantidadEntregada: 500 } }));
    await assertFails(emitir('vendedor', 'PED-C2', { alterar: { cantidadPendiente: 0 } }));
    await assertFails(emitir('vendedor', 'PED-C2', { alterar: { estadoEntrega: 'entregado' } }));
    await assertFails(emitir('vendedor', 'PED-C2', { alterarProc: { lote: 'LT-001', cambios: { entregada: 300 } } }));
    await assertFails(emitir('vendedor', 'PED-C2', { indice: 0 }));
  });

  test('15. sin entrega confirmada en el servidor no hay comprobante definitivo', async () => {
    await crearAsignada('PED-C3', { 'LT-001': 100 });
    await iniciarRuta('repartidor', 'PED-C3');
    await assertFails(emitir('vendedor', 'PED-C3', { indice: 1 }));
  });

  test('10 y 11. la segunda entrega genera la versión 2 sin tocar la 1; no se duplica la versión de una entrega', async () => {
    await entregaParcial('PED-C4');
    const v1 = await emitir('vendedor', 'PED-C4');
    const antes = await leer(`comprobantes/${v1}`);
    await assertFails(emitir('vendedor', 'PED-C4'));
    await reprogramar('PED-C4');
    await iniciarRuta('repartidor', 'PED-C4');
    await llegar('repartidor', 'PED-C4');
    await entregar('repartidor', 'PED-C4', { 'LT-001': 50 });
    const v2 = await emitir('vendedor', 'PED-C4');
    const c2 = await leer(`comprobantes/${v2}`);
    assert.equal(c2.version, 2);
    assert.equal(c2.estadoEntrega, 'entregado');
    assert.deepEqual(await leer(`comprobantes/${v1}`), antes);
    const consulta = await leer(`consultasEntrega/${TOKEN}`);
    assert.equal(Object.keys(consulta.versiones).length, 2);
    assert.equal(consulta.ultimaVersion, v2);
    await assertFails(updateDoc(doc(como('vendedor'), 'comprobantes', v1), { cantidadEntregada: 1 }));
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(como('vendedor'), 'comprobantes', v1)));
  });

  test('9. el repartidor y quien no gestiona pedidos no emiten; el código de consulta no se cambia', async () => {
    await entregaParcial('PED-C5');
    await assertFails(emitir('repartidor', 'PED-C5'));
    await assertFails(emitir('operario', 'PED-C5'));
    await emitir('vendedor', 'PED-C5');
    await reprogramar('PED-C5');
    await iniciarRuta('repartidor', 'PED-C5');
    await llegar('repartidor', 'PED-C5');
    await entregar('repartidor', 'PED-C5', { 'LT-001': 50 });
    await assertFails(emitir('vendedor', 'PED-C5', { token: 'tok_' + 'z'.repeat(28) }));
  });

  test('14. los lotes no cambian al emitir comprobantes', async () => {
    const antes = await leer('lotes/LT-001');
    await entregaParcial('PED-C6');
    await emitir('vendedor', 'PED-C6');
    assert.deepEqual(await leer('lotes/LT-001'), antes);
  });
});
