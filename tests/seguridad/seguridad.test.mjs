// Pruebas de seguridad de firestore.rules (auditoría, agente 3). Emulador en el puerto 8285.
// Usa las dependencias de tests/reglas. Para correrlas (desde tests/seguridad):
//   cmd /c mklink /J node_modules ..\reglas\node_modules     (una vez)
//   npx firebase emulators:exec --config firebase.json --only firestore --project demo-tilapia "node --test --test-concurrency=1 seguridad.test.mjs"
// Las pruebas marcadas "HUECO" pasan cuando el hueco EXISTE (documentan el comportamiento actual).
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

const MAESTRO = 'carlosbs1579@gmail.com';
const SIN = {
  crearLotes: false, registrarEventos: false, cerrarLotes: false, gestionarEstanques: false,
  gestionarConfiguracion: false, administrarUsuarios: false, gestionarPedidos: false
};
const PROD = { ...SIN, crearLotes: true, registrarEventos: true, cerrarLotes: true };

function perfil(uid, extra) {
  return {
    uid, email: `${uid}@prueba.co`, displayName: uid, rol: 'operario', granjaId: 'cultivos-lore', cargo: '',
    estado: 'activo', permisos: SIN, creadoEn: '2026-10-30T00:00:00.000Z', actualizadoEn: '2026-10-30T00:00:00.000Z',
    ...extra
  };
}

const PERFILES = {
  maestro: perfil('maestro', { email: MAESTRO, rol: 'admin', roles: ['admin'], permisos: PROD, displayName: 'Carlos' }),
  subadmin: perfil('subadmin', { rol: 'admin', roles: ['admin'] }),
  adminOtra: perfil('adminOtra', { rol: 'admin', roles: ['admin'], granjaId: 'otra-granja' }),
  operador: perfil('operador', { roles: ['operator'], permisos: PROD, displayName: 'Ana Operadora' }),
  soloCierre: perfil('soloCierre', { roles: ['operator'], permisos: { ...SIN, cerrarLotes: true } }),
  config: perfil('config', { roles: ['operator'], permisos: { ...SIN, gestionarConfiguracion: true } }),
  repartidor: perfil('repartidor', { roles: ['courier'], permisos: PROD }),
  pendiente: perfil('pendiente', { estado: 'pendiente', roles: [], cargos: {} })
};

const H0 = 'a'.repeat(64);
const LOTE = {
  codigo: '20261001-A-E1', consecutivo: 1, estanque: 'E1', producto: 'Tilapia roja', origen: 'Cultivos Loré',
  estado: 'activo', granjaId: 'cultivos-lore', fechaSiembra: '2026-10-01', cantidadSembrada: 1000,
  pesoInicialPromedioG: 2, creadoPor: 'operador@prueba.co', creadoPorUid: 'operador', creadoEn: '2026-10-01T00:00:00.000Z',
  resumen: { biomasaCosechadaKg: 0, pecesCosechados: 0, supervivencia: 80, FCA: 1.6, hashFinal: H0 },
  eventos: [{ indice: 0, tipo: 'Siembra', hash: H0, hashAnterior: '0'.repeat(64), registradoPor: 'operador@prueba.co',
              registradoPorNombre: 'Ana Operadora', datos: { cantidad: 1000 } }]
};

let env;
const como = (uid, verificado = true) =>
  env.authenticatedContext(uid, { email: PERFILES[uid]?.email || `${uid}@prueba.co`, email_verified: verificado }).firestore();
const anonimo = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-tilapia',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8285 }
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, d] of Object.entries(PERFILES)) await setDoc(doc(db, 'usuarios', uid), d);
    await setDoc(doc(db, 'lotes', LOTE.codigo), LOTE);
    await setDoc(doc(db, 'configuracion', 'general'), { estanques: [{ codigo: 'E1' }], fichaNutricional: { energiaKcal: 96 } });
    await setDoc(doc(db, 'contadores', 'lotes_global'), { valor: 1 });
    await setDoc(doc(db, 'anotacionesLote', LOTE.codigo), { codigoLote: LOTE.codigo, registros: [{ registradoPor: 'operador@prueba.co', registradoPorUid: 'operador' }] });
    await setDoc(doc(db, 'comprobantes', 'c'.repeat(24)), { id: 'c'.repeat(24), granjaId: 'cultivos-lore', cliente: { nombre: 'Cliente SA', direccion: 'Calle 1 # 2-3' }, repartidor: 'Pedro', emitidoPorUid: 'operador', novedades: [{ descripcion: 'Llamar al 3001234567' }] });
    await setDoc(doc(db, 'consultasEntrega', 't'.repeat(24)), { token: 't'.repeat(24), ordenId: 'o1', versiones: {} });
    await setDoc(doc(db, 'clientes', 'cli1'), { granjaId: 'cultivos-lore', nombre: 'Cliente SA', contacto: '3001234567', direccion: 'Calle 1' });
  });
});

describe('Sin sesión no se escribe nada', () => {
  const casos = [
    ['lotes/NUEVO', { ...LOTE, codigo: 'NUEVO' }],
    ['configuracion/general', { estanques: [] }],
    ['usuarios/x', perfil('x', {})],
    ['contadores/lotes_global', { valor: 2 }],
    ['comprobantes/' + 'z'.repeat(24), { id: 'z'.repeat(24) }],
    ['consultasEntrega/' + 'z'.repeat(24), { token: 'z'.repeat(24) }],
    ['fotosEntrega/' + 'f'.repeat(24), { id: 'f'.repeat(24) }],
    ['anotacionesLote/' + LOTE.codigo, { codigoLote: LOTE.codigo }],
    ['ordenes/o1', { id: 'o1' }],
    ['clientes/cli2', { nombre: 'x' }],
    ['inventarioLotes/' + LOTE.codigo, { codigoLote: LOTE.codigo }],
    ['entregas/' + LOTE.codigo, { a: 1 }]
  ];
  for (const [ruta, datos] of casos) {
    test(`anónimo no escribe ${ruta}`, async () => {
      const [c, id] = ruta.split('/');
      await assertFails(setDoc(doc(anonimo(), c, id), datos));
    });
  }
  test('anónimo no borra el lote ni la configuración', async () => {
    await assertFails(deleteDoc(doc(anonimo(), 'lotes', LOTE.codigo)));
    await assertFails(deleteDoc(doc(anonimo(), 'configuracion', 'general')));
  });
  test('anónimo no lista lotes, clientes, usuarios, consultas ni comprobantes', async () => {
    await assertFails(getDocs(collection(anonimo(), 'lotes')));
    await assertFails(getDocs(collection(anonimo(), 'clientes')));
    await assertFails(getDocs(collection(anonimo(), 'usuarios')));
    await assertFails(getDocs(collection(anonimo(), 'consultasEntrega')));
    await assertFails(getDocs(collection(anonimo(), 'comprobantes')));
    await assertFails(getDocs(collection(anonimo(), 'anotacionesLote')));
  });
  test('cuenta con el correo del maestro pero sin verificar no es maestro', async () => {
    const db = env.authenticatedContext('impostor', { email: MAESTRO, email_verified: false }).firestore();
    await assertFails(setDoc(doc(db, 'configuracion', 'general'), { estanques: [] }));
    await assertFails(setDoc(doc(db, 'usuarios', 'impostor'), perfil('impostor', { email: MAESTRO, rol: 'admin', roles: ['admin'] })));
  });
});

describe('Lectura pública: qué expone', () => {
  test('HUECO: un anónimo lee el lote completo, con correos y uid del personal', async () => {
    const s = await assertSucceeds(getDoc(doc(anonimo(), 'lotes', LOTE.codigo)));
    assert.equal(s.data().creadoPor, 'operador@prueba.co');
    assert.equal(s.data().creadoPorUid, 'operador');
    assert.equal(s.data().eventos[0].registradoPor, 'operador@prueba.co');
  });
  test('HUECO: un anónimo lee las anotaciones con correo y uid de quien propone', async () => {
    const s = await assertSucceeds(getDoc(doc(anonimo(), 'anotacionesLote', LOTE.codigo)));
    assert.equal(s.data().registros[0].registradoPor, 'operador@prueba.co');
  });
  test('Con el token, un anónimo lee nombre y dirección del cliente, repartidor y novedades', async () => {
    const s = await assertSucceeds(getDoc(doc(anonimo(), 'comprobantes', 'c'.repeat(24))));
    assert.equal(s.data().cliente.direccion, 'Calle 1 # 2-3');
    assert.equal(s.data().emitidoPorUid, 'operador');
  });
  test('HUECO: un anónimo lista toda la colección configuracion', async () => {
    const s = await assertSucceeds(getDocs(collection(anonimo(), 'configuracion')));
    assert.ok(s.size >= 1);
  });
  test('anónimo no lee clientes, órdenes, fotos, usuarios, inventario ni contadores', async () => {
    await assertFails(getDoc(doc(anonimo(), 'clientes', 'cli1')));
    await assertFails(getDoc(doc(anonimo(), 'usuarios', 'operador')));
    await assertFails(getDoc(doc(anonimo(), 'contadores', 'lotes_global')));
    await assertFails(getDoc(doc(anonimo(), 'entregas', LOTE.codigo)));
  });
});

describe('Perfil propio: nadie se sube de rango', () => {
  for (const [campo, valor] of [
    ['rol', 'admin'], ['roles', ['operator', 'courier']], ['estado', 'activo'], ['granjaId', 'otra-granja'],
    ['permisos', { ...SIN, crearLotes: true }], ['cargos', { operator: 'Jefe' }], ['email', 'otro@prueba.co']
  ]) {
    test(`pendiente no cambia su ${campo}`, async () => {
      await assertFails(updateDoc(doc(como('pendiente'), 'usuarios', 'pendiente'), { [campo]: valor }));
    });
    test(`operador no cambia su ${campo}`, async () => {
      // El operador ya está activo: para el estado se prueba otro valor (un cambio a lo mismo no es cambio)
      const v = campo === 'estado' ? 'inactivo' : valor;
      await assertFails(updateDoc(doc(como('operador'), 'usuarios', 'operador'), { [campo]: v }));
    });
  }
  test('repartidor no se da el rol de operador', async () => {
    await assertFails(updateDoc(doc(como('repartidor'), 'usuarios', 'repartidor'), { roles: ['courier', 'operator'] }));
  });
  test('subadmin no se modifica a sí mismo ni nombra administradores', async () => {
    await assertFails(updateDoc(doc(como('subadmin'), 'usuarios', 'subadmin'), { permisos: PROD }));
    await assertFails(updateDoc(doc(como('subadmin'), 'usuarios', 'operador'), { rol: 'admin', roles: ['admin', 'operator'] }));
  });
  test('alta propia no puede venir activa ni con funciones', async () => {
    const db = como('nuevo');
    await assertFails(setDoc(doc(db, 'usuarios', 'nuevo'), { uid: 'nuevo', email: 'nuevo@prueba.co', rol: 'operario', estado: 'activo', granjaId: 'cultivos-lore', permisos: SIN }));
    await assertFails(setDoc(doc(db, 'usuarios', 'nuevo'), { uid: 'nuevo', email: 'nuevo@prueba.co', rol: 'operario', estado: 'pendiente', granjaId: 'cultivos-lore', permisos: SIN, roles: ['operator'] }));
  });
  test('HUECO: alta propia acepta campos extra y nombre visible sin límite', async () => {
    await assertSucceeds(setDoc(doc(como('nuevo'), 'usuarios', 'nuevo'), {
      uid: 'nuevo', email: 'nuevo@prueba.co', rol: 'operario', estado: 'pendiente', granjaId: 'cultivos-lore',
      permisos: SIN, displayName: 'Carlos', autorizadoPor: MAESTRO, basura: 'x'.repeat(200000)
    }));
  });
  test('HUECO: operador se pone el nombre de otro y firma eventos con ese nombre', async () => {
    const db = como('operador');
    await assertSucceeds(updateDoc(doc(db, 'usuarios', 'operador'), { displayName: 'Carlos' }));
    await assertSucceeds(updateDoc(doc(db, 'lotes', LOTE.codigo), {
      eventos: [...LOTE.eventos, { indice: 1, tipo: 'Alimentación', hashAnterior: H0, hash: '1'.repeat(64),
        registradoPor: 'operador@prueba.co', registradoPorNombre: 'Carlos', datos: {} }],
      actualizadoEn: 'x'
    }));
  });
});

describe('Repartidor no hace lo del operador', () => {
  test('repartidor (con permisos marcados) no crea lotes, eventos, cierres ni configuración', async () => {
    const db = como('repartidor');
    await assertFails(setDoc(doc(db, 'lotes', 'NUEVO'), { ...LOTE, codigo: 'NUEVO' }));
    await assertFails(updateDoc(doc(db, 'lotes', LOTE.codigo), {
      eventos: [...LOTE.eventos, { indice: 1, tipo: 'Alimentación', hashAnterior: H0, hash: '1'.repeat(64), registradoPor: 'repartidor@prueba.co' }]
    }));
    await assertFails(updateDoc(doc(db, 'lotes', LOTE.codigo), { estado: 'cerrado' }));
    await assertFails(setDoc(doc(db, 'configuracion', 'general'), { estanques: [] }));
    await assertFails(updateDoc(doc(db, 'contadores', 'lotes_global'), { valor: 2 }));
    await assertFails(getDocs(collection(db, 'lotes')));
    await assertFails(getDoc(doc(db, 'clientes', 'cli1')));
    await assertFails(setDoc(doc(db, 'clientes', 'cli9'), { granjaId: 'cultivos-lore', nombre: 'x', contacto: '', creadoPorUid: 'repartidor', creadoPor: 'repartidor@prueba.co' }));
  });
});

describe('Cierre del lote (caso B) y datos fuera de la cadena', () => {
  test('HUECO: quien solo puede cerrar cambia piscina, siembra, producto e indicadores al sellar', async () => {
    await assertSucceeds(updateDoc(doc(como('soloCierre'), 'lotes', LOTE.codigo), {
      estado: 'cerrado', estanque: 'E9', cantidadSembrada: 1, producto: 'Otro producto', origen: 'Otro origen',
      'resumen.supervivencia': 99.9, 'resumen.FCA': 0.9, pdfUrl: 'javascript:alert(1)', campoInventado: true
    }));
  });
  test('HUECO: con el lote activo, quien registra eventos cambia el resumen sin evento', async () => {
    await assertSucceeds(updateDoc(doc(como('operador'), 'lotes', LOTE.codigo), { 'resumen.supervivencia': 100, 'resumen.FCA': 0.5 }));
  });
  test('sellado: ya nadie lo modifica ni borra', async () => {
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'lotes', LOTE.codigo), { estado: 'cerrado' }));
    await assertFails(updateDoc(doc(como('maestro'), 'lotes', LOTE.codigo), { 'resumen.FCA': 1 }));
    await assertFails(deleteDoc(doc(como('maestro'), 'lotes', LOTE.codigo)));
  });
  test('los eventos no se reescriben ni se borran', async () => {
    const db = como('operador');
    await assertFails(updateDoc(doc(db, 'lotes', LOTE.codigo), { eventos: [] }));
    await assertFails(updateDoc(doc(db, 'lotes', LOTE.codigo), { eventos: [{ ...LOTE.eventos[0], datos: { cantidad: 5 } }] }));
  });
  test('HUECO: al crear un lote se puede atribuir a otra persona (creadoPor y registradoPor del evento 0)', async () => {
    await assertSucceeds(setDoc(doc(como('operador'), 'lotes', '20261002-A-E1'), {
      ...LOTE, codigo: 'OTRO-CODIGO', consecutivo: 999, creadoPor: MAESTRO, creadoPorUid: 'maestro',
      eventos: [{ ...LOTE.eventos[0], registradoPor: MAESTRO, registradoPorNombre: 'Carlos', hash: 'no-es-un-hash' }]
    }));
  });
});

describe('Contadores y configuración', () => {
  test('HUECO: quien crea lotes crea contadores arbitrarios y avanza el global sin crear lotes', async () => {
    const db = como('operador');
    await assertSucceeds(setDoc(doc(db, 'contadores', 'cualquier_cosa'), { valor: 1 }));
    await assertSucceeds(updateDoc(doc(db, 'contadores', 'lotes_global'), { valor: 2 }));
    await assertFails(updateDoc(doc(db, 'contadores', 'lotes_global'), { valor: 1 }));
  });
  test('HUECO: el permiso de configuración borra la configuración y escribe cualquier forma', async () => {
    const db = como('config');
    await assertSucceeds(setDoc(doc(db, 'configuracion', 'general'), { fichaNutricional: { energiaKcal: 'mentira' }, estanques: 'no-es-lista' }));
    await assertSucceeds(setDoc(doc(db, 'configuracion', 'otro-doc'), { x: 'x'.repeat(500000) }));
    await assertSucceeds(deleteDoc(doc(db, 'configuracion', 'general')));
  });
  test('HUECO: el administrador de otra granja cambia la configuración global', async () => {
    await assertSucceeds(updateDoc(doc(como('adminOtra'), 'configuracion', 'general'), { 'fichaNutricional.energiaKcal': 1 }));
  });
  test('HUECO: un administrador lee perfiles de otra granja', async () => {
    await assertSucceeds(getDoc(doc(como('adminOtra'), 'usuarios', 'operador')));
  });
});
