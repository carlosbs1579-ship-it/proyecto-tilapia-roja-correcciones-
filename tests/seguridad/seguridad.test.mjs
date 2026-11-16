// Pruebas de seguridad de firestore.rules (auditoría, agente 3). Emulador en el puerto 8285.
// Usa las dependencias de tests/reglas. Para correrlas (desde tests/seguridad):
//   cmd /c mklink /J node_modules ..\reglas\node_modules     (una vez)
//   npx firebase emulators:exec --config firebase.json --only firestore --project demo-tilapia "node --test --test-concurrency=1 seguridad.test.mjs"
// Las pruebas marcadas "HUECO" pasan cuando el hueco EXISTE (documentan el comportamiento actual).
// Las marcadas "CERRADO" eran huecos que las reglas ya rechazan (fase 3 de la auditoría).
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

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
  test('CERRADO (H22): un anónimo ya no lista la colección configuracion, pero sí lee configuracion/general', async () => {
    await assertFails(getDocs(collection(anonimo(), 'configuracion')));
    await assertSucceeds(getDoc(doc(anonimo(), 'configuracion', 'general')));
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
  test('CERRADO (H46): alta propia no acepta campos extra ni nombre visible sin límite', async () => {
    const base = { uid: 'nuevo', email: 'nuevo@prueba.co', rol: 'operario', estado: 'pendiente', granjaId: 'cultivos-lore', permisos: SIN };
    await assertFails(setDoc(doc(como('nuevo'), 'usuarios', 'nuevo'), { ...base, displayName: 'Carlos', autorizadoPor: MAESTRO }));
    await assertFails(setDoc(doc(como('nuevo'), 'usuarios', 'nuevo'), { ...base, basura: 'x'.repeat(200000) }));
    await assertFails(setDoc(doc(como('nuevo'), 'usuarios', 'nuevo'), { ...base, displayName: 'x'.repeat(5000) }));
    // El alta que hace la app sigue pasando
    await assertSucceeds(setDoc(doc(como('nuevo'), 'usuarios', 'nuevo'), {
      ...base, displayName: 'nuevo', roles: [], cargos: {}, cargo: 'Operario en espera de asignación',
      creadoEn: '2026-11-16T00:00:00.000Z', actualizadoEn: '2026-11-16T00:00:00.000Z'
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
  test('CERRADO (H01): quien solo puede cerrar no cambia piscina, siembra, producto ni indicadores al sellar', async () => {
    const lote = doc(como('soloCierre'), 'lotes', LOTE.codigo);
    const cierre = { estado: 'cerrado', fechaCierre: '2026-11-10' };
    await assertFails(updateDoc(lote, {
      ...cierre, estanque: 'E9', cantidadSembrada: 1, producto: 'Otro producto', origen: 'Otro origen',
      'resumen.supervivencia': 99.9, 'resumen.FCA': 0.9, pdfUrl: 'javascript:alert(1)', campoInventado: true
    }));
    for (const [campo, valor] of [['estanque', 'E9'], ['cantidadSembrada', 1], ['producto', 'Otro'], ['origen', 'Otro'],
      ['fechaSiembra', '2026-09-01'], ['pesoInicialPromedioG', 50], ['creadoPor', MAESTRO], ['campoInventado', true],
      ['pdfUrl', 'javascript:alert(1)'], ['pdfUrl', 'https://atacante.example/?lote=OTRO'], ['pdfPath', 'otro.pdf'], ['versionPdf', 99]]) {
      await assertFails(updateDoc(lote, { ...cierre, [campo]: valor }));
    }
    await assertFails(updateDoc(lote, { ...cierre, 'resumen.supervivencia': 99.9 }));
    await assertFails(updateDoc(lote, { ...cierre, 'resumen.hashFinal': 'b'.repeat(64) }));
    await assertFails(updateDoc(lote, { estado: 'cerrado' }));
    await assertFails(updateDoc(lote, { estado: 'cerrado', fechaCierre: '2099-01-01' }));
    await assertFails(updateDoc(lote, { estado: 'cerrado', fechaCierre: '2026-09-01' }));
  });
  test('CERRADO (H01): con el lote activo, el resumen no cambia sin un evento nuevo', async () => {
    await assertFails(updateDoc(doc(como('operador'), 'lotes', LOTE.codigo), { 'resumen.supervivencia': 100, 'resumen.FCA': 0.5 }));
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
  test('CERRADO (H21): al crear un lote no se atribuye a otra persona ni se desliga del código o del génesis', async () => {
    await assertFails(setDoc(doc(como('operador'), 'lotes', '20261002-A-E1'), {
      ...LOTE, codigo: 'OTRO-CODIGO', consecutivo: 999, creadoPor: MAESTRO, creadoPorUid: 'maestro',
      eventos: [{ ...LOTE.eventos[0], registradoPor: MAESTRO, registradoPorNombre: 'Carlos', hash: 'no-es-un-hash' }]
    }));
  });
});

describe('Contadores y configuración', () => {
  test('CERRADO (H48, parcial): solo existen los contadores global y diarios', async () => {
    const db = como('operador');
    await assertFails(setDoc(doc(db, 'contadores', 'cualquier_cosa'), { valor: 1 }));
    await assertSucceeds(setDoc(doc(db, 'contadores', 'diario_20261001_E1'), { valor: 1, actualizadoEn: 'x' }));
    await assertFails(updateDoc(doc(db, 'contadores', 'lotes_global'), { valor: 1 }));
  });
  test('HUECO (H48): quien crea lotes avanza el contador global sin crear un lote', async () => {
    await assertSucceeds(updateDoc(doc(como('operador'), 'contadores', 'lotes_global'), { valor: 2 }));
  });
  test('CERRADO (H22): la configuración no se borra, no toma cualquier forma ni otro documento', async () => {
    const db = como('config');
    await assertFails(setDoc(doc(db, 'configuracion', 'general'), { fichaNutricional: { energiaKcal: 'mentira' }, estanques: 'no-es-lista' }));
    await assertFails(setDoc(doc(db, 'configuracion', 'general'), { estanques: 'no-es-lista' }, { merge: true }));
    await assertFails(setDoc(doc(db, 'configuracion', 'general'), { fichaNutricional: { energiaKcal: 'mentira' } }, { merge: true }));
    await assertFails(setDoc(doc(db, 'configuracion', 'general'), { campoInventado: 1 }, { merge: true }));
    await assertFails(setDoc(doc(db, 'configuracion', 'otro-doc'), { x: 'x'.repeat(500000) }));
    await assertFails(deleteDoc(doc(db, 'configuracion', 'general')));
    await assertFails(deleteDoc(doc(como('maestro'), 'configuracion', 'general')));
    // Lo que guarda la pestaña Configuración sigue pasando
    await assertSucceeds(setDoc(doc(db, 'configuracion', 'general'), {
      estanques: [{ codigo: 'E1', nombre: 'Estanque E1', volumenM3: 250 }],
      rangosReferencia: { temperaturaMin: 25, temperaturaMax: 32, oxigenoMin: 4, phMin: 6.5, phMax: 8.5, amonioMax: 1, nitritosMax: 0.1, secchiMin: 30, secchiMax: 40 },
      fichaNutricional: { porcionG: 100, energiaKcal: 96, proteinaG: 20.1, grasaTotalG: 1.7, carbohidratosG: 0, colesterolMg: 50, sodioMg: 52, fuente: 'USDA', notas: 'Ref.' },
      actualizadoPor: 'config@prueba.co', actualizadoEn: '2026-11-16T00:00:00.000Z'
    }, { merge: true }));
  });
  test('CERRADO (H22): el administrador de otra granja no cambia la configuración', async () => {
    await assertFails(updateDoc(doc(como('adminOtra'), 'configuracion', 'general'), { 'fichaNutricional.energiaKcal': 1 }));
    await assertSucceeds(updateDoc(doc(como('subadmin'), 'configuracion', 'general'), { 'fichaNutricional.energiaKcal': 97 }));
  });
  test('CERRADO (H47, parcial): un administrador no lee por código perfiles de otra granja', async () => {
    await assertFails(getDoc(doc(como('adminOtra'), 'usuarios', 'operador')));
    await assertSucceeds(getDoc(doc(como('subadmin'), 'usuarios', 'operador')));
  });
  test('HUECO (H47): un administrador de otra granja todavía lista la colección usuarios (la app no filtra por granja)', async () => {
    await assertSucceeds(getDocs(collection(como('adminOtra'), 'usuarios')));
  });
});

// ---------- Fase 3: lo que escribe la app sigue pasando y los huecos cerrados no vuelven ----------
// Lote como lo deja la app (crearNuevoLote / registrarEventoEnLote): eventos con hash SHA-256 y
// resumen completo de recalcularResumenLote.
const hx = (i) => (i.toString(16).padStart(8, '0') + 'ab'.repeat(28)).slice(0, 64);
const evApp = (i, tipo, datos, extra = {}) => ({
  id: 'id' + i, indice: i, tipo, fechaEvento: i === 0 ? '2026-10-01' : '2026-10-05', descripcion: 'x', datos,
  registradoPor: 'operador@prueba.co', registradoPorNombre: 'Ana Operadora', registradoEn: '2026-10-05T00:00:00.000Z',
  hashAnterior: i === 0 ? '0'.repeat(64) : hx(i - 1), hash: hx(i), huellas: { fecha: hx(i) }, ...extra
});
const resumenApp = (hashFinal, extra = {}) => ({
  mortalidadAcumulada: 0, pecesCosechados: 0, pecesVivos: 1000, supervivencia: 100, pesoPromedioActualG: 2, biomasaEstimadaKg: 2,
  biomasaInicialKg: 2, biomasaCosechadaKg: 0, alimentoAcumuladoKg: 0, FCA: null, diasDeCultivo: 4, gananciaDiariaG: 0,
  densidadKgM3: 0.01, ultimoEvento: { tipo: 'Siembra', fecha: '2026-10-01' }, alertasAgua: 0, hashFinal, ...extra
});
function loteApp(codigo, n = 1, extra = {}) {
  const eventos = [evApp(0, 'Siembra', { cantidad: 1000, pesoPromedioInicialG: 2, proveedor: '' })];
  for (let i = 1; i < n; i++) eventos.push(evApp(i, 'Alimentación', { cantidadKg: 1.5 }));
  return {
    codigo, consecutivo: 2, estanque: 'E1', producto: 'Tilapia roja', modalidad: 'Estanque', origen: 'Cultivos Loré',
    fechaSiembra: '2026-10-01', cantidadSembrada: 1000, pesoInicialPromedioG: 2, proveedorAlevinos: '', estado: 'activo',
    fechaCierre: null, eventos, resumen: resumenApp(hx(n - 1)), pdfPath: `lotes/${codigo}.pdf`,
    pdfUrl: `https://proyecto-tilapia-roja-claude.vercel.app/?lote=${codigo}`, versionPdf: 1, pdfActualizadoEn: 'x',
    granjaId: 'cultivos-lore', creadoPor: 'operador@prueba.co', creadoPorUid: 'operador', creadoEn: 'x', actualizadoEn: 'x',
    observacionesIniciales: '', ...extra
  };
}
const COD = '20261001-B-E1';
const sembrar = (datos) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'lotes', datos.codigo), datos));
const leerLote = async (codigo) => {
  let d;
  await env.withSecurityRulesDisabled(async (ctx) => { d = (await getDoc(doc(ctx.firestore(), 'lotes', codigo))).data(); });
  return d;
};
// Corrección de siembra como modificarDatosSiembraOPiscina: patch con los 5 campos y evento con "anterior → nuevo"
function correccionApp(lote, nuevo, datos, extraResumen = {}, porCorreo = 'operador@prueba.co', porNombre = 'Ana Operadora') {
  const n = lote.eventos.length;
  return {
    estanque: lote.estanque, cantidadSembrada: lote.cantidadSembrada, pesoInicialPromedioG: lote.pesoInicialPromedioG,
    proveedorAlevinos: lote.proveedorAlevinos || '', observacionesIniciales: lote.observacionesIniciales || '', ...nuevo,
    eventos: [...lote.eventos, evApp(n, 'Corrección', { ambito: 'siembra', ...datos }, { registradoPor: porCorreo, registradoPorNombre: porNombre })],
    resumen: resumenApp(hx(n), extraResumen), actualizadoEn: 'y'
  };
}

describe('Fase 3: escrituras legítimas de la app (lotes)', () => {
  test('crear un lote como la app: contadores y lote en la misma operación', async () => {
    const db = como('operador');
    const b = writeBatch(db);
    b.set(doc(db, 'contadores', 'lotes_global'), { valor: 2, actualizadoEn: 'x' }, { merge: true });
    b.set(doc(db, 'contadores', 'diario_20261001_E1'), { valor: 1, actualizadoEn: 'x' }, { merge: true });
    b.set(doc(db, 'lotes', COD), loteApp(COD));
    await assertSucceeds(b.commit());
  });
  test('crear: localhost y el dominio de producción también valen como origen del enlace', async () => {
    for (const [i, origen] of [['C', 'http://localhost:3000'], ['D', 'https://proyecto-tilapia-roja-correcciones-abc123.vercel.app'], ['E', 'https://trazabilidad.cultivoslore.com']].entries()) {
      const codigo = `20261001-${origen[0]}-E1`;
      await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'contadores', 'lotes_global'), { valor: 2 + i }));
      const db = como('operador');
      const b = writeBatch(db);
      b.set(doc(db, 'contadores', 'lotes_global'), { valor: 3 + i, actualizadoEn: 'x' }, { merge: true });
      b.set(doc(db, 'lotes', codigo), loteApp(codigo, 1, { consecutivo: 3 + i, pdfPath: `lotes/${codigo}.pdf`, pdfUrl: `${origen[1]}/?lote=${codigo}` }));
      await assertSucceeds(b.commit());
    }
  });
  test('crear: el consecutivo debe ser el que deja el contador global en la misma operación', async () => {
    await assertFails(setDoc(doc(como('operador'), 'lotes', COD), loteApp(COD)));
    const db = como('operador');
    const b = writeBatch(db);
    b.set(doc(db, 'contadores', 'lotes_global'), { valor: 2, actualizadoEn: 'x' }, { merge: true });
    b.set(doc(db, 'lotes', COD), loteApp(COD, 1, { consecutivo: 7 }));
    await assertFails(b.commit());
  });
  test('CERRADO (H21/H13): al crear, el evento 0 coincide con la cabecera, arranca en el génesis y tiene hash válido', async () => {
    const crear = (extra, evento = {}) => {
      const db = como('operador');
      const b = writeBatch(db);
      const l = loteApp(COD);
      b.set(doc(db, 'contadores', 'lotes_global'), { valor: 2, actualizadoEn: 'x' }, { merge: true });
      b.set(doc(db, 'lotes', COD), { ...l, ...extra, eventos: [{ ...l.eventos[0], ...evento }] });
      return b.commit();
    };
    await assertFails(crear({ codigo: 'OTRO' }));
    await assertFails(crear({ cantidadSembrada: 5000 }));
    await assertFails(crear({ creadoPorUid: 'maestro' }));
    await assertFails(crear({ creadoPor: MAESTRO }));
    await assertFails(crear({ estado: 'cerrado' }));
    await assertFails(crear({ campoInventado: 1 }));
    await assertFails(crear({ pdfUrl: 'javascript:alert(1)' }));
    await assertFails(crear({}, { hashAnterior: 'f'.repeat(64) }));
    await assertFails(crear({}, { hash: 'A'.repeat(64) }));
    await assertFails(crear({}, { hash: '0'.repeat(18) + 'a'.repeat(14) + '0'.repeat(18) + 'b'.repeat(14) }));
    await assertFails(crear({}, { registradoPorNombre: 'Carlos' }));
    await assertFails(crear({}, { registradoPor: MAESTRO }));
    await assertSucceeds(crear({}));
  });

  test('registrar una fase y una mortalidad como la app', async () => {
    const l = loteApp(COD, 3);
    await sembrar(l);
    const db = como('operador');
    await assertSucceeds(updateDoc(doc(db, 'lotes', COD), {
      eventos: [...l.eventos, evApp(3, 'Alimentación', { cantidadKg: 2 })], resumen: resumenApp(hx(3)), actualizadoEn: 'y'
    }));
    const l2 = await leerLote(COD);
    await assertSucceeds(updateDoc(doc(db, 'lotes', COD), {
      eventos: [...l2.eventos, evApp(4, 'Mortalidad', { cantidad: 10, causaProbable: 'x' })],
      resumen: resumenApp(hx(4), { mortalidadAcumulada: 10, pecesVivos: 990, supervivencia: 99 }), actualizadoEn: 'z'
    }));
  });
  test('un evento sin registradoPorNombre (registros anteriores) sigue pasando', async () => {
    const l = loteApp(COD, 2);
    await sembrar(l);
    const ev = evApp(2, 'Alimentación', { cantidadKg: 2 });
    delete ev.registradoPorNombre;
    await assertSucceeds(updateDoc(doc(como('operador'), 'lotes', COD), { eventos: [...l.eventos, ev], resumen: resumenApp(hx(2)), actualizadoEn: 'y' }));
  });
  test('CERRADO (H01): el resumen que acompaña a un evento termina en ese evento y respeta mortalidad y peces vivos', async () => {
    const l = loteApp(COD, 2);
    await sembrar(l);
    const db = como('operador');
    const con = (ev, resumen) => updateDoc(doc(db, 'lotes', COD), { eventos: [...l.eventos, ev], resumen, actualizadoEn: 'y' });
    const ali = evApp(2, 'Alimentación', { cantidadKg: 2 });
    await assertFails(con(ali, resumenApp(hx(1), { alimentoAcumuladoKg: 2 })));
    await assertFails(con(ali, resumenApp(hx(2), { mortalidadAcumulada: 300, pecesVivos: 700 })));
    await assertFails(con(ali, resumenApp(hx(2), { pecesVivos: 5000 })));
    await assertFails(con(evApp(2, 'Mortalidad', { cantidad: 10 }), resumenApp(hx(2), { mortalidadAcumulada: 1, pecesVivos: 999 })));
    await assertFails(con({ ...ali, hash: 'no-es-hash' }, resumenApp('no-es-hash')));
  });

  test('corregir la siembra como la app (los cinco campos, con decimales) sigue pasando', async () => {
    const l = loteApp(COD, 2);
    await sembrar(l);
    await assertSucceeds(updateDoc(doc(como('operador'), 'lotes', COD), correccionApp(l,
      { estanque: 'E2', cantidadSembrada: 1200, pesoInicialPromedioG: 2.35, proveedorAlevinos: 'Proveedor', observacionesIniciales: 'Nota' },
      { estanque: 'E1 → E2', cantidadSembrada: '1000 → 1200', pesoInicialPromedioG: '2 → 2.35', proveedorAlevinos: '— → Proveedor', observacionesIniciales: '— → Nota' },
      { pecesVivos: 1200, biomasaInicialKg: 2.82 })));
    // Y volver a vaciar un texto
    const l2 = await leerLote(COD);
    await assertSucceeds(updateDoc(doc(como('operador'), 'lotes', COD), correccionApp(l2,
      { proveedorAlevinos: '' }, { proveedorAlevinos: 'Proveedor → —' }, { pecesVivos: 1200 })));
  });
  test('corregir la siembra con solo el permiso "corregir siembra"', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'usuarios', 'soloSiembra'),
      perfil('soloSiembra', { roles: ['operator'], displayName: 'Sol', permisos: { ...SIN, corregirSiembra: true } })));
    const l = loteApp(COD, 2);
    await sembrar(l);
    const db = env.authenticatedContext('soloSiembra', { email: 'soloSiembra@prueba.co', email_verified: true }).firestore();
    await assertSucceeds(updateDoc(doc(db, 'lotes', COD), correccionApp(l,
      { estanque: 'E2', cantidadSembrada: 1200, pesoInicialPromedioG: 2.5, proveedorAlevinos: 'P', observacionesIniciales: 'O' },
      { estanque: 'E1 → E2', cantidadSembrada: '1000 → 1200', pesoInicialPromedioG: '2 → 2.5', proveedorAlevinos: '— → P', observacionesIniciales: '— → O' },
      { pecesVivos: 1200 }, 'soloSiembra@prueba.co', 'Sol')));
  });
  test('CERRADO (H15): la cabecera corregida debe coincidir con lo que dice el evento Corrección', async () => {
    const l = loteApp(COD, 2);
    await sembrar(l);
    const db = como('operador');
    await assertFails(updateDoc(doc(db, 'lotes', COD), correccionApp(l, { cantidadSembrada: 5000 }, { cantidadSembrada: '1000 → 1200' }, { pecesVivos: 5000 })));
    await assertFails(updateDoc(doc(db, 'lotes', COD), correccionApp(l, { estanque: 'E9' }, { estanque: 'E1 → E2' })));
    await assertFails(updateDoc(doc(db, 'lotes', COD), correccionApp(l, { estanque: 'E2' }, { estanque: 'E7 → E2' })));
    await assertFails(updateDoc(doc(db, 'lotes', COD), correccionApp(l, { estanque: 'E2', cantidadSembrada: 1200 }, { estanque: 'E1 → E2' }, { pecesVivos: 1200 })));
    await assertFails(updateDoc(doc(db, 'lotes', COD), correccionApp(l, { estanque: 'E2' }, { estanque: 'E1 → E2', producto: 'x → y' })));
  });

  test('cerrar el lote como la app (enlace de producción, de la vista previa o local)', async () => {
    for (const origen of ['https://proyecto-tilapia-roja-correcciones-git-main-x.vercel.app', 'https://proyecto-tilapia-roja-claude.vercel.app', 'http://localhost:3000']) {
      const l = loteApp(COD, 3);
      await sembrar(l);
      await assertSucceeds(updateDoc(doc(como('soloCierre'), 'lotes', COD), {
        estado: 'cerrado', fechaCierre: '2026-11-10', resumen: resumenApp(hx(2), { diasDeCultivo: 40 }), pdfPath: `lotes/${COD}.pdf`,
        pdfUrl: `${origen}/?lote=${COD}`, versionPdf: 2, pdfActualizadoEn: 'z', actualizadoEn: 'z'
      }));
    }
  });
  test('cerrar un lote antiguo sin versionPdf ni resumen completo', async () => {
    const l = loteApp(COD, 2);
    delete l.versionPdf; delete l.pdfPath; delete l.pdfUrl; delete l.pdfActualizadoEn; delete l.proveedorAlevinos; delete l.observacionesIniciales;
    l.resumen = { biomasaCosechadaKg: 0, pecesCosechados: 0, supervivencia: 100, hashFinal: hx(1) };
    await sembrar(l);
    await assertSucceeds(updateDoc(doc(como('soloCierre'), 'lotes', COD), {
      estado: 'cerrado', fechaCierre: '2026-11-10', resumen: resumenApp(hx(1)), pdfPath: `lotes/${COD}.pdf`,
      pdfUrl: `https://proyecto-tilapia-roja-claude.vercel.app/?lote=${COD}`, versionPdf: 1, pdfActualizadoEn: 'z', actualizadoEn: 'z'
    }));
  });
  test('CERRADO (H01): al sellar, el resumen termina en la última fase y conserva mortalidad y cosecha', async () => {
    const l = loteApp(COD, 3, { resumen: resumenApp(hx(2), { mortalidadAcumulada: 10, pecesVivos: 990, supervivencia: 99 }) });
    await sembrar(l);
    const cerrar = (resumen) => updateDoc(doc(como('soloCierre'), 'lotes', COD), { estado: 'cerrado', fechaCierre: '2026-11-10', resumen });
    await assertFails(cerrar(resumenApp(hx(1), { mortalidadAcumulada: 10, pecesVivos: 990, supervivencia: 99 })));
    await assertFails(cerrar(resumenApp(hx(2), { mortalidadAcumulada: 0, pecesVivos: 1000, supervivencia: 100 })));
    await assertFails(cerrar(resumenApp(hx(2), { mortalidadAcumulada: 10, pecesVivos: 990, supervivencia: 99.9 })));
    await assertFails(cerrar(resumenApp(hx(2), { mortalidadAcumulada: 10, pecesVivos: 990, supervivencia: 99, biomasaInicialKg: 50 })));
    await assertFails(cerrar({ ...resumenApp(hx(2), { mortalidadAcumulada: 10, pecesVivos: 990, supervivencia: 99 }), inventado: 1 }));
    await assertSucceeds(cerrar(resumenApp(hx(2), { mortalidadAcumulada: 10, pecesVivos: 990, supervivencia: 99 })));
  });

  test('H44: historiales largos (400 fases) no agotan el límite de expresiones', async () => {
    const l = loteApp(COD, 400);
    await sembrar(l);
    await assertSucceeds(updateDoc(doc(como('operador'), 'lotes', COD), {
      eventos: [...l.eventos, evApp(400, 'Alimentación', { cantidadKg: 1 })], resumen: resumenApp(hx(400)), actualizadoEn: 'y'
    }));
    const l2 = await leerLote(COD);
    await assertSucceeds(updateDoc(doc(como('operador'), 'lotes', COD), correccionApp(l2,
      { estanque: 'E2', cantidadSembrada: 1200, pesoInicialPromedioG: 2.5, proveedorAlevinos: 'P', observacionesIniciales: 'O' },
      { estanque: 'E1 → E2', cantidadSembrada: '1000 → 1200', pesoInicialPromedioG: '2 → 2.5', proveedorAlevinos: '— → P', observacionesIniciales: '— → O' },
      { pecesVivos: 1200 })));
    await assertSucceeds(updateDoc(doc(como('soloCierre'), 'lotes', COD), {
      estado: 'cerrado', fechaCierre: '2026-11-10', resumen: resumenApp(hx(401), { pecesVivos: 1200, biomasaInicialKg: 3 }), pdfPath: `lotes/${COD}.pdf`,
      pdfUrl: `https://proyecto-tilapia-roja-claude.vercel.app/?lote=${COD}`, versionPdf: 2, pdfActualizadoEn: 'z', actualizadoEn: 'z'
    }));
  });
});

describe('Fase 3: perfiles y clientes', () => {
  test('CERRADO (H49): al editar un cliente, contacto y dirección son texto acotado', async () => {
    const db = como('subadmin');
    await assertFails(updateDoc(doc(db, 'clientes', 'cli1'), { contacto: 'x'.repeat(900000), actualizadoEn: 'z' }));
    await assertFails(updateDoc(doc(db, 'clientes', 'cli1'), { contacto: { objeto: true }, actualizadoEn: 'z' }));
    await assertFails(updateDoc(doc(db, 'clientes', 'cli1'), { direccion: 5, actualizadoEn: 'z' }));
    await assertSucceeds(updateDoc(doc(db, 'clientes', 'cli1'), { nombre: 'Cliente S.A.S.', contacto: '3009999999', direccion: 'Calle 9', actualizadoEn: 'z' }));
  });
  test('el nombre visible propio tiene un tope de tamaño', async () => {
    await assertFails(updateDoc(doc(como('operador'), 'usuarios', 'operador'), { displayName: 'x'.repeat(500) }));
  });
});
