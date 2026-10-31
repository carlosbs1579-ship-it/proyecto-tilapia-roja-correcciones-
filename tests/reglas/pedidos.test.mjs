// Pruebas de firestore.rules para órdenes de entrega, clientes e inventario de lotes.
// Las escrituras imitan las de src/services/pedidosService.ts (orden + inventario en una sola operación).
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
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

function perfil(uid, extra) {
  return {
    uid, email: `${uid}@prueba.co`, displayName: uid, rol: 'operario', granjaId: GRANJA, cargo: '',
    estado: 'activo', permisos: SIN, creadoEn: 'x', actualizadoEn: 'x', ...extra
  };
}

const PERFILES = {
  maestro: perfil('maestro', { email: MAESTRO, rol: 'admin', roles: ['admin'] }),
  vendedor: perfil('vendedor', { roles: ['operator'], permisos: { ...SIN, gestionarPedidos: true } }),
  vendedor2: perfil('vendedor2', { roles: ['operator'], permisos: { ...SIN, gestionarPedidos: true } }),
  operario: perfil('operario', { roles: ['operator'], permisos: { ...SIN, registrarEventos: true } }),
  // Repartidor con el permiso marcado: sin rol de operador no vale
  repartidor: perfil('repartidor', { roles: ['courier'], permisos: { ...SIN, gestionarPedidos: true } }),
  repartidor2: perfil('repartidor2', { roles: ['courier'] }),
  repartidorInactivo: perfil('repartidorInactivo', { roles: ['courier'], estado: 'inactivo' }),
  otroRepartidor: perfil('otroRepartidor', { roles: ['courier'], granjaId: 'otra-granja' })
};

function lote(codigo, estanque, peces, kg, extra = {}) {
  return {
    codigo, estanque, estado: 'cerrado', granjaId: GRANJA, fechaSiembra: '2026-10-01', creadoPor: MAESTRO,
    creadoPorUid: 'maestro', creadoEn: 'x', consecutivo: 1,
    eventos: [{ indice: 0, tipo: 'Siembra', hash: 'h0' }, { indice: 1, tipo: 'Cosecha', hash: 'h1' }],
    resumen: { pecesCosechados: peces, biomasaCosechadaKg: kg, pecesVivos: 0 },
    ...extra
  };
}

const LOTES = {
  'LT-001': lote('LT-001', 'E1', 1000, 480),
  'LT-002': lote('LT-002', 'E2', 600, 300, { estado: 'activo' }), // cosecha parcial, lote aún activo
  'LT-003': lote('LT-003', 'E1', 400, 190),
  'LT-SIN': lote('LT-SIN', 'E2', 0, 0), // sin cosecha registrada
  'LT-OTRA': lote('LT-OTRA', 'E9', 500, 250, { granjaId: 'otra-granja' })
};

let env;
const como = (uid) =>
  env.authenticatedContext(uid, { email: PERFILES[uid]?.email || `${uid}@prueba.co`, email_verified: true }).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-tilapia-pedidos',
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
      granjaId: GRANJA, nombre: 'Restaurante El Pescador', contacto: '', creadoPor: MAESTRO,
      creadoPorUid: 'maestro', creadoEn: 'x', actualizadoEn: 'x'
    });
  });
});

const evento = (uid, indice, tipo = 'Creación') => ({
  indice, tipo, fecha: new Date().toISOString(), registradoPor: PERFILES[uid].email, registradoPorUid: uid,
  descripcion: '', datos: {}
});

function orden(id, uid, { estado = 'asignado', unidad = 'peces', solicitada, cantidades, repartidor = 'repartidor2' }) {
  const procedencias = Object.fromEntries(
    Object.entries(cantidades).map(([c, n]) => [c, { estanque: LOTES[c].estanque, cantidad: n, unidad }])
  );
  const total = Object.values(cantidades).reduce((s, n) => s + n, 0);
  return {
    id, granjaId: GRANJA, clienteId: 'CLI1', clienteNombre: 'Restaurante El Pescador',
    creadoPor: PERFILES[uid].email, creadoPorUid: uid, repartidorUid: repartidor, repartidorNombre: repartidor,
    creadoEn: 'x', actualizadoEn: 'x', fechaProgramada: null, unidad, cantidadSolicitada: solicitada ?? total,
    procedencias, cantidadAutorizada: estado === 'asignado' ? total : 0, cantidadEntregada: 0, estado,
    observaciones: '', historial: [evento(uid, 0)]
  };
}

// Inventario actual (sin reglas) para calcular el movimiento como lo hace el servicio
async function inventario(codigo) {
  let datos = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const s = await getDoc(doc(ctx.firestore(), 'inventarioLotes', codigo));
    datos = s.exists() ? s.data() : null;
  });
  return datos;
}

// Crea (o confirma) una orden asignada con sus reservas en una sola operación
async function reservar(db, o, { base } = {}) {
  const batch = writeBatch(db);
  for (const [codigo, p] of Object.entries(o.procedencias)) {
    const inv = base?.[codigo] !== undefined ? base[codigo] : await inventario(codigo);
    batch.set(doc(db, 'inventarioLotes', codigo), {
      codigoLote: codigo, granjaId: GRANJA, unidad: inv?.unidad || o.unidad,
      reservado: (inv?.reservado || 0) + p.cantidad, entregado: inv?.entregado || 0,
      ultimaOrden: o.id, movidoEn: serverTimestamp()
    });
  }
  batch.set(doc(db, 'ordenes', o.id), o);
  return batch.commit();
}

async function leerSinReglas(ruta) {
  let d = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const s = await getDoc(doc(ctx.firestore(), ...ruta.split('/')));
    d = s.exists() ? s.data() : null;
  });
  return d;
}

describe('Crear órdenes y reservar', () => {
  test('1. orden con un solo lote', async () => {
    await assertSucceeds(reservar(como('vendedor'), orden('PED-1', 'vendedor', { cantidades: { 'LT-001': 1000 } })));
    assert.equal((await inventario('LT-001')).reservado, 1000);
  });

  test('2 y 3. orden con dos lotes de dos piscinas distintas conserva cada procedencia', async () => {
    await assertSucceeds(
      reservar(como('vendedor'), orden('PED-4', 'vendedor', { cantidades: { 'LT-001': 800, 'LT-002': 600 } }))
    );
    const o = await leerSinReglas('ordenes/PED-4');
    assert.deepEqual(o.procedencias['LT-001'], { estanque: 'E1', cantidad: 800, unidad: 'peces' });
    assert.deepEqual(o.procedencias['LT-002'], { estanque: 'E2', cantidad: 600, unidad: 'peces' });
  });

  test('orden con tres lotes (máximo por orden)', async () => {
    await assertSucceeds(
      reservar(como('vendedor'), orden('PED-3L', 'vendedor', { cantidades: { 'LT-001': 100, 'LT-002': 100, 'LT-003': 100 } }))
    );
  });

  test('4. varias órdenes del mismo lote hasta agotarlo; la siguiente se rechaza', async () => {
    const db = como('vendedor');
    await assertSucceeds(reservar(db, orden('PED-A', 'vendedor', { cantidades: { 'LT-001': 400 } })));
    await assertSucceeds(reservar(db, orden('PED-B', 'vendedor', { cantidades: { 'LT-001': 500 } })));
    await assertFails(reservar(db, orden('PED-C', 'vendedor', { cantidades: { 'LT-001': 101 } })));
    await assertSucceeds(reservar(db, orden('PED-D', 'vendedor', { cantidades: { 'LT-001': 100 } })));
    assert.equal((await inventario('LT-001')).reservado, 1000);
  });

  test('5. no se reserva más de lo cosechado', async () => {
    await assertFails(reservar(como('vendedor'), orden('PED-X', 'vendedor', { cantidades: { 'LT-001': 1001 } })));
    await assertFails(reservar(como('vendedor'), orden('PED-KG', 'vendedor', { unidad: 'kg', cantidades: { 'LT-001': 480.01 } })));
    await assertSucceeds(reservar(como('vendedor'), orden('PED-KG2', 'vendedor', { unidad: 'kg', cantidades: { 'LT-001': 479.99 } })));
  });

  test('5b. kg con decimales: 0,1 + 0,2 + ... hasta el total exacto', async () => {
    const db = como('vendedor');
    await assertSucceeds(reservar(db, orden('PED-K1', 'vendedor', { unidad: 'kg', cantidades: { 'LT-003': 189.7 } })));
    await assertSucceeds(reservar(db, orden('PED-K2', 'vendedor', { unidad: 'kg', cantidades: { 'LT-003': 0.1 } })));
    await assertSucceeds(reservar(db, orden('PED-K3', 'vendedor', { unidad: 'kg', cantidades: { 'LT-003': 0.2 } })));
    await assertFails(reservar(db, orden('PED-K4', 'vendedor', { unidad: 'kg', cantidades: { 'LT-003': 0.01 } })));
  });

  test('6. no se duplica una reserva', async () => {
    const db = como('vendedor');
    const o = orden('PED-DUP', 'vendedor', { cantidades: { 'LT-001': 300 } });
    await assertSucceeds(reservar(db, o));
    // Volver a escribir la misma orden asignada subiendo otra vez el inventario
    await assertFails(reservar(db, o));
    // Subir el inventario a nombre de la orden sin tocar la orden
    await assertFails(updateDoc(doc(db, 'inventarioLotes', 'LT-001'), { reservado: 600, ultimaOrden: 'PED-DUP', movidoEn: serverTimestamp() }));
    assert.equal((await inventario('LT-001')).reservado, 300);
  });

  test('una orden asignada sin mover el inventario se rechaza', async () => {
    await assertFails(setDoc(doc(como('vendedor'), 'ordenes', 'PED-SIN'), orden('PED-SIN', 'vendedor', { cantidades: { 'LT-001': 10 } })));
  });

  test('el inventario no se mueve por una cantidad distinta a la de la orden', async () => {
    const db = como('vendedor');
    const o = orden('PED-MAL', 'vendedor', { cantidades: { 'LT-001': 100 } });
    const batch = writeBatch(db);
    batch.set(doc(db, 'inventarioLotes', 'LT-001'), {
      codigoLote: 'LT-001', granjaId: GRANJA, unidad: 'peces', reservado: 50, entregado: 0, ultimaOrden: o.id, movidoEn: serverTimestamp()
    });
    batch.set(doc(db, 'ordenes', o.id), o);
    await assertFails(batch.commit());
  });

  test('la unidad del lote queda fijada por su primera reserva', async () => {
    const db = como('vendedor');
    await assertSucceeds(reservar(db, orden('PED-P', 'vendedor', { cantidades: { 'LT-001': 100 } })));
    await assertFails(reservar(db, orden('PED-K', 'vendedor', { unidad: 'kg', cantidades: { 'LT-001': 10 } }), {
      base: { 'LT-001': { unidad: 'kg', reservado: 100, entregado: 0 } }
    }));
  });

  test('lote sin cosecha registrada o de otra granja: sin disponibilidad', async () => {
    await assertFails(reservar(como('vendedor'), orden('PED-S', 'vendedor', { cantidades: { 'LT-SIN': 1 } })));
    await assertFails(reservar(como('vendedor'), orden('PED-O', 'vendedor', { cantidades: { 'LT-OTRA': 1 } })));
  });

  test('la piscina de la procedencia debe ser la del lote', async () => {
    const o = orden('PED-PIS', 'vendedor', { cantidades: { 'LT-001': 10 } });
    o.procedencias['LT-001'].estanque = 'E2';
    await assertFails(reservar(como('vendedor'), o));
  });

  test('máximo 3 lotes y distribución no mayor a lo solicitado', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'lotes', 'LT-004'), lote('LT-004', 'E2', 100, 50)));
    LOTES['LT-004'] = lote('LT-004', 'E2', 100, 50);
    await assertFails(
      reservar(como('vendedor'), orden('PED-4L', 'vendedor', { cantidades: { 'LT-001': 1, 'LT-002': 1, 'LT-003': 1, 'LT-004': 1 } }))
    );
    await assertFails(reservar(como('vendedor'), orden('PED-SOL', 'vendedor', { solicitada: 50, cantidades: { 'LT-001': 60 } })));
    delete LOTES['LT-004'];
  });

  test('repartidor asignado: activo, con rol de repartidor y de la misma granja', async () => {
    for (const r of ['repartidorInactivo', 'otroRepartidor', 'vendedor2']) {
      await assertFails(reservar(como('vendedor'), orden(`PED-${r}`, 'vendedor', { repartidor: r, cantidades: { 'LT-001': 1 } })));
    }
  });

  test('dos personas reservan a la vez la misma disponibilidad: solo una lo logra', async () => {
    const base = { 'LT-001': null };
    const r1 = reservar(como('vendedor'), orden('PED-R1', 'vendedor', { cantidades: { 'LT-001': 700 } }), { base });
    const r2 = reservar(como('vendedor2'), orden('PED-R2', 'vendedor2', { cantidades: { 'LT-001': 700 } }), { base });
    const resultados = await Promise.allSettled([r1, r2]);
    assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await inventario('LT-001')).reservado, 700);
  });

  test('con transacciones, la segunda reserva se recalcula y respeta lo disponible', async () => {
    const reservaTx = (uid, id, cantidad) => {
      const db = como(uid);
      return runTransaction(db, async (tx) => {
        const ref = doc(db, 'inventarioLotes', 'LT-001');
        const s = await tx.get(ref);
        const reservado = s.exists() ? s.data().reservado : 0;
        if (reservado + cantidad > 1000) throw new Error('sin disponibilidad');
        tx.set(ref, { codigoLote: 'LT-001', granjaId: GRANJA, unidad: 'peces', reservado: reservado + cantidad, entregado: 0, ultimaOrden: id, movidoEn: serverTimestamp() });
        tx.set(doc(db, 'ordenes', id), orden(id, uid, { cantidades: { 'LT-001': cantidad } }));
      });
    };
    const resultados = await Promise.allSettled([reservaTx('vendedor', 'PED-T1', 600), reservaTx('vendedor2', 'PED-T2', 600)]);
    assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await inventario('LT-001')).reservado, 600);
  });
});

describe('Borradores, estados y cancelación', () => {
  test('borrador sin reservas y confirmación posterior con reserva', async () => {
    const db = como('vendedor');
    const b = orden('PED-BOR', 'vendedor', { estado: 'borrador', cantidades: { 'LT-002': 200 }, repartidor: null });
    await assertSucceeds(setDoc(doc(db, 'ordenes', 'PED-BOR'), b));
    assert.equal(await inventario('LT-002'), null);
    // Editar el borrador
    const historial1 = [...b.historial, evento('vendedor', 1, 'Modificación')];
    await assertSucceeds(updateDoc(doc(db, 'ordenes', 'PED-BOR'), {
      repartidorUid: 'repartidor2', repartidorNombre: 'r2', historial: historial1
    }));
    // Confirmar sin mover el inventario: rechazado
    const historial2 = [...historial1, evento('vendedor', 2, 'Asignación y reserva')];
    await assertFails(updateDoc(doc(db, 'ordenes', 'PED-BOR'), { estado: 'asignado', cantidadAutorizada: 200, historial: historial2 }));
    // Confirmar con la reserva
    const confirmada = { ...b, repartidorUid: 'repartidor2', repartidorNombre: 'r2', estado: 'asignado', cantidadAutorizada: 200, historial: historial2 };
    await assertSucceeds(reservar(db, confirmada));
    assert.equal((await inventario('LT-002')).reservado, 200);
  });

  test('cambios de estado válidos e inválidos', async () => {
    const db = como('vendedor');
    const o = orden('PED-EST', 'vendedor', { cantidades: { 'LT-001': 10 } });
    await assertSucceeds(reservar(db, o));
    let historial = o.historial;
    const paso = async (estado) => {
      const nuevo = [...historial, evento('vendedor', historial.length, 'Cambio de estado')];
      await updateDoc(doc(db, 'ordenes', 'PED-EST'), { estado, historial: nuevo });
      historial = nuevo;
    };
    await assertFails(paso('en_ruta')); // iniciar la ruta es una acción del repartidor
    await assertFails(paso('entregado')); // la entrega la confirma el repartidor
    await assertSucceeds(paso('en_preparacion'));
    await assertFails(paso('en_ruta'));
    await assertSucceeds(paso('requiere_revision'));
    await assertSucceeds(paso('asignado'));
  });

  test('cancelar libera exactamente lo reservado', async () => {
    const db = como('vendedor');
    const o = orden('PED-CAN', 'vendedor', { cantidades: { 'LT-001': 300, 'LT-002': 100 } });
    await assertSucceeds(reservar(db, o));
    const historial = [...o.historial, evento('vendedor', 1, 'Cancelación')];
    // Sin liberar el inventario: rechazado
    await assertFails(updateDoc(doc(db, 'ordenes', 'PED-CAN'), { estado: 'cancelado', historial }));
    // Liberando de más: rechazado
    let batch = writeBatch(db);
    batch.update(doc(db, 'inventarioLotes', 'LT-001'), { reservado: 0, ultimaOrden: 'PED-CAN', movidoEn: serverTimestamp() });
    batch.update(doc(db, 'inventarioLotes', 'LT-002'), { reservado: 0, ultimaOrden: 'PED-CAN', movidoEn: serverTimestamp() });
    batch.update(doc(db, 'ordenes', 'PED-CAN'), { estado: 'cancelado', historial });
    await assertSucceeds(batch.commit()); // 300 y 100 eran todo lo reservado: liberación exacta
    assert.equal((await inventario('LT-001')).reservado, 0);
    assert.equal((await inventario('LT-002')).reservado, 0);
    // Una orden cancelada no vuelve atrás
    await assertFails(updateDoc(doc(db, 'ordenes', 'PED-CAN'), { estado: 'asignado', historial: [...historial, evento('vendedor', 2, 'Cambio de estado')] }));
  });

  test('liberar una cantidad distinta a la reservada se rechaza', async () => {
    const db = como('vendedor');
    await assertSucceeds(reservar(db, orden('PED-OTRA', 'vendedor', { cantidades: { 'LT-001': 200 } })));
    const o = orden('PED-LIB', 'vendedor', { cantidades: { 'LT-001': 300 } });
    await assertSucceeds(reservar(db, o));
    const batch = writeBatch(db);
    batch.update(doc(db, 'inventarioLotes', 'LT-001'), { reservado: 0, ultimaOrden: 'PED-LIB', movidoEn: serverTimestamp() });
    batch.update(doc(db, 'ordenes', 'PED-LIB'), { estado: 'cancelado', historial: [...o.historial, evento('vendedor', 1, 'Cancelación')] });
    await assertFails(batch.commit());
  });

  test('cambiar de repartidor queda en el historial; en ruta ya no se cambia', async () => {
    const db = como('vendedor');
    const o = orden('PED-REP', 'vendedor', { cantidades: { 'LT-001': 10 } });
    await assertSucceeds(reservar(db, o));
    const h1 = [...o.historial, evento('vendedor', 1, 'Cambio de repartidor')];
    await assertFails(updateDoc(doc(db, 'ordenes', 'PED-REP'), { repartidorUid: 'repartidorInactivo', historial: h1 }));
    await assertSucceeds(updateDoc(doc(db, 'ordenes', 'PED-REP'), { repartidorUid: 'repartidor', repartidorNombre: 'r', historial: h1 }));
  });

  test('el historial solo crece: sin evento nuevo o editando uno anterior se rechaza', async () => {
    const db = como('vendedor');
    const o = orden('PED-HIS', 'vendedor', { cantidades: { 'LT-001': 10 } });
    await assertSucceeds(reservar(db, o));
    await assertFails(updateDoc(doc(db, 'ordenes', 'PED-HIS'), { observaciones: 'x' }));
    await assertFails(updateDoc(doc(db, 'ordenes', 'PED-HIS'), {
      observaciones: 'x', historial: [{ ...o.historial[0], descripcion: 'cambiado' }, evento('vendedor', 1, 'Cambio de estado')]
    }));
    // Firmar el evento con otro correo
    await assertFails(updateDoc(doc(db, 'ordenes', 'PED-HIS'), {
      observaciones: 'x', historial: [...o.historial, { ...evento('vendedor', 1, 'Cambio de estado'), registradoPor: MAESTRO }]
    }));
  });

  test('no se cambian la distribución ni lo autorizado de una orden asignada', async () => {
    const db = como('vendedor');
    const o = orden('PED-FIJA', 'vendedor', { cantidades: { 'LT-001': 10 } });
    await assertSucceeds(reservar(db, o));
    await assertFails(updateDoc(doc(db, 'ordenes', 'PED-FIJA'), {
      cantidadAutorizada: 20, 'procedencias.LT-001.cantidad': 20, historial: [...o.historial, evento('vendedor', 1, 'Modificación')]
    }));
    await assertFails(updateDoc(doc(db, 'ordenes', 'PED-FIJA'), {
      cantidadEntregada: 10, historial: [...o.historial, evento('vendedor', 1, 'Modificación')]
    }));
  });
});

describe('Permisos', () => {
  test('el repartidor no crea órdenes (aunque tenga el permiso marcado) y solo lee las suyas', async () => {
    await assertFails(reservar(como('repartidor'), orden('PED-RX', 'repartidor', { cantidades: { 'LT-001': 1 } })));
    await assertSucceeds(reservar(como('vendedor'), orden('PED-M', 'vendedor', { cantidades: { 'LT-001': 1 }, repartidor: 'repartidor2' })));
    await assertSucceeds(reservar(como('vendedor'), orden('PED-N', 'vendedor', { cantidades: { 'LT-001': 1 }, repartidor: 'repartidor' })));
    await assertSucceeds(getDoc(doc(como('repartidor2'), 'ordenes', 'PED-M')));
    await assertFails(getDoc(doc(como('repartidor2'), 'ordenes', 'PED-N')));
    await assertSucceeds(getDocs(query(collection(como('repartidor2'), 'ordenes'), where('repartidorUid', '==', 'repartidor2'))));
    await assertFails(getDocs(query(collection(como('repartidor2'), 'ordenes'), where('granjaId', '==', GRANJA))));
    // Ni modifica su orden
    await assertFails(updateDoc(doc(como('repartidor2'), 'ordenes', 'PED-M'), {
      estado: 'en_preparacion', historial: [evento('vendedor', 0), evento('repartidor2', 1, 'Cambio de estado')]
    }));
    // Ni toca el inventario ni los clientes
    await assertFails(getDoc(doc(como('repartidor2'), 'inventarioLotes', 'LT-001')));
    await assertFails(getDocs(query(collection(como('repartidor2'), 'clientes'), where('granjaId', '==', GRANJA))));
  });

  test('un operador sin el permiso de pedidos no crea ni consulta órdenes', async () => {
    await assertFails(reservar(como('operario'), orden('PED-OP', 'operario', { cantidades: { 'LT-001': 1 } })));
    await assertFails(getDocs(query(collection(como('operario'), 'ordenes'), where('granjaId', '==', GRANJA))));
  });

  test('el administrador gestiona pedidos', async () => {
    await assertSucceeds(reservar(como('maestro'), orden('PED-ADM', 'maestro', { cantidades: { 'LT-001': 5 } })));
  });

  test('una orden no puede quedar a nombre de otro usuario', async () => {
    const o = orden('PED-AJENA', 'vendedor', { cantidades: { 'LT-001': 5 } });
    await assertFails(reservar(como('vendedor2'), o));
  });

  test('quien gestiona pedidos lista los repartidores activos; los demás no', async () => {
    const q = (db) => query(collection(db, 'usuarios'), where('roles', 'array-contains', 'courier'), where('estado', '==', 'activo'), where('granjaId', '==', GRANJA));
    const res = await assertSucceeds(getDocs(q(como('vendedor'))));
    assert.deepEqual(res.docs.map((d) => d.id).sort(), ['repartidor', 'repartidor2']);
    await assertFails(getDocs(q(como('operario'))));
    await assertFails(getDocs(q(como('repartidor2'))));
  });

  test('clientes: los registra quien gestiona pedidos', async () => {
    const nuevo = { granjaId: GRANJA, nombre: 'Hotel Caribe', contacto: '300 000 0000', creadoPor: 'vendedor@prueba.co', creadoPorUid: 'vendedor', creadoEn: 'x', actualizadoEn: 'x' };
    await assertSucceeds(setDoc(doc(como('vendedor'), 'clientes', 'CLI2'), nuevo));
    await assertFails(setDoc(doc(como('operario'), 'clientes', 'CLI3'), { ...nuevo, creadoPor: 'operario@prueba.co', creadoPorUid: 'operario' }));
    await assertFails(setDoc(doc(como('vendedor'), 'clientes', 'CLI4'), { ...nuevo, granjaId: 'otra-granja' }));
  });

  test('las entregas del sistema anterior quedan de solo lectura', async () => {
    await assertFails(setDoc(doc(como('maestro'), 'entregas', 'LT-001'), { codigoLote: 'LT-001' }));
  });
});

describe('Integridad de la producción', () => {
  test('los lotes no cambian con las órdenes (datos y hash)', async () => {
    const antes = await leerSinReglas('lotes/LT-001');
    const db = como('vendedor');
    const o = orden('PED-INT', 'vendedor', { cantidades: { 'LT-001': 500, 'LT-002': 100 } });
    await assertSucceeds(reservar(db, o));
    const batch = writeBatch(db);
    batch.update(doc(db, 'inventarioLotes', 'LT-001'), { reservado: 0, ultimaOrden: 'PED-INT', movidoEn: serverTimestamp() });
    batch.update(doc(db, 'inventarioLotes', 'LT-002'), { reservado: 0, ultimaOrden: 'PED-INT', movidoEn: serverTimestamp() });
    batch.update(doc(db, 'ordenes', 'PED-INT'), { estado: 'cancelado', historial: [...o.historial, evento('vendedor', 1, 'Cancelación')] });
    await assertSucceeds(batch.commit());
    assert.deepEqual(await leerSinReglas('lotes/LT-001'), antes);
    // Quien gestiona pedidos no puede escribir en un lote sellado
    await assertFails(updateDoc(doc(db, 'lotes', 'LT-001'), { 'resumen.pecesCosechados': 5000 }));
  });
});
