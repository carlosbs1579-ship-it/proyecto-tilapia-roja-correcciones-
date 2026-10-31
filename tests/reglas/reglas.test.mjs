// Pruebas de firestore.rules (roles funcionales y acceso) en el emulador local.
// Uso: npm install && npm test   (desde tests/reglas; requiere Java y firebase-tools)
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc
} from 'firebase/firestore';

const MAESTRO = 'carlosbs1579@gmail.com';
const SIN_PERMISOS = {
  crearLotes: false,
  registrarEventos: false,
  cerrarLotes: false,
  gestionarEstanques: false,
  gestionarConfiguracion: false,
  administrarUsuarios: false
};
const PERMISOS_PRODUCCION = { ...SIN_PERMISOS, crearLotes: true, registrarEventos: true, cerrarLotes: true };

function perfil(uid, extra) {
  return {
    uid,
    email: `${uid}@prueba.co`,
    displayName: uid,
    rol: 'operario',
    granjaId: 'cultivos-lore',
    cargo: '',
    estado: 'activo',
    permisos: SIN_PERMISOS,
    creadoEn: '2026-10-30T00:00:00.000Z',
    actualizadoEn: '2026-10-30T00:00:00.000Z',
    ...extra
  };
}

const PERFILES = {
  maestro: perfil('maestro', { email: MAESTRO, rol: 'admin', roles: ['admin', 'courier'], permisos: PERMISOS_PRODUCCION }),
  subadmin: perfil('subadmin', { rol: 'admin', roles: ['admin'], cargos: { admin: 'Coordinador' } }),
  operador: perfil('operador', { roles: ['operator'], cargos: { operator: 'Analista de producción A' }, permisos: PERMISOS_PRODUCCION }),
  // Permisos de producción marcados pero sin rol de operador: no deben valer
  repartidor: perfil('repartidor', { roles: ['courier'], cargos: { courier: 'Repartidor jefe' }, permisos: PERMISOS_PRODUCCION }),
  mixto: perfil('mixto', {
    roles: ['operator', 'courier'],
    cargos: { operator: 'Analista de producción', courier: 'Repartidor jefe' },
    permisos: PERMISOS_PRODUCCION
  }),
  // El nombre visible dice "operador" y "administrador", pero el rol es repartidor
  engano: perfil('engano', { roles: ['courier'], cargos: { courier: 'Operador administrador' }, permisos: PERMISOS_PRODUCCION }),
  // Perfiles anteriores a la lista de roles
  legado: perfil('legado', { permisos: PERMISOS_PRODUCCION }),
  consulta: perfil('consulta', { rol: 'consulta' }),
  pendiente: perfil('pendiente', { estado: 'pendiente', roles: [], cargos: {} }),
  inactivo: perfil('inactivo', { estado: 'inactivo', roles: ['operator'], permisos: PERMISOS_PRODUCCION })
};

const LOTE_ACTIVO = {
  codigo: 'L-ACTIVO',
  consecutivo: 1,
  estanque: 'E1',
  estado: 'activo',
  granjaId: 'cultivos-lore',
  fechaSiembra: '2026-10-01',
  creadoPor: MAESTRO,
  creadoPorUid: 'maestro',
  creadoEn: '2026-10-01T00:00:00.000Z',
  eventos: [{ indice: 0, tipo: 'Siembra', hash: 'h0' }]
};

let env;

function como(uid) {
  const email = PERFILES[uid]?.email || `${uid}@prueba.co`;
  return env.authenticatedContext(uid, { email, email_verified: true }).firestore();
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-tilapia',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 }
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, datos] of Object.entries(PERFILES)) {
      await setDoc(doc(db, 'usuarios', uid), datos);
    }
    await setDoc(doc(db, 'lotes', LOTE_ACTIVO.codigo), LOTE_ACTIVO);
    await setDoc(doc(db, 'contadores', 'lotes_global'), { valor: 1 });
  });
});

const agregarEvento = (db) =>
  updateDoc(doc(db, 'lotes', 'L-ACTIVO'), {
    eventos: [...LOTE_ACTIVO.eventos, { indice: 1, tipo: 'Alimentación', hash: 'h1' }],
    actualizadoEn: '2026-10-30T01:00:00.000Z'
  });

describe('Lectura de lotes', () => {
  test('un lote por su código sigue siendo público (QR)', async () => {
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'lotes', 'L-ACTIVO')));
    await assertSucceeds(getDoc(doc(como('repartidor'), 'lotes', 'L-ACTIVO')));
  });

  test('sin sesión no se puede listar la información productiva', async () => {
    await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), 'lotes')));
  });

  for (const uid of ['maestro', 'subadmin', 'operador', 'mixto', 'legado', 'consulta']) {
    test(`${uid} puede listar los lotes`, async () => {
      await assertSucceeds(getDocs(collection(como(uid), 'lotes')));
    });
  }

  for (const uid of ['repartidor', 'engano', 'pendiente', 'inactivo', 'desconocido']) {
    test(`${uid} NO puede listar los lotes`, async () => {
      await assertFails(getDocs(collection(como(uid), 'lotes')));
    });
  }
});

describe('Escritura de producción', () => {
  for (const uid of ['operador', 'mixto', 'legado', 'subadmin']) {
    test(`${uid} registra eventos`, async () => {
      await assertSucceeds(agregarEvento(como(uid)));
    });
  }

  for (const uid of ['repartidor', 'engano', 'consulta', 'inactivo']) {
    test(`${uid} NO registra eventos aunque tenga permisos marcados`, async () => {
      await assertFails(agregarEvento(como(uid)));
    });
  }

  test('un repartidor no lee contadores ni crea lotes', async () => {
    const db = como('repartidor');
    await assertFails(getDoc(doc(db, 'contadores', 'lotes_global')));
    await assertFails(setDoc(doc(db, 'lotes', 'L-NUEVO'), { ...LOTE_ACTIVO, codigo: 'L-NUEVO' }));
  });

  test('un repartidor no escribe entregas (siguen reservadas a administradores)', async () => {
    await assertFails(setDoc(doc(como('repartidor'), 'entregas', 'L-ACTIVO'), { codigoLote: 'L-ACTIVO' }));
  });
});

describe('Perfiles: nadie se asigna privilegios a sí mismo', () => {
  test('cada uno lee su propio perfil, pero no el de otros', async () => {
    await assertSucceeds(getDoc(doc(como('repartidor'), 'usuarios', 'repartidor')));
    await assertFails(getDoc(doc(como('repartidor'), 'usuarios', 'operador')));
    await assertFails(getDocs(collection(como('operador'), 'usuarios')));
  });

  test('cambiar el propio nombre visible está permitido', async () => {
    await assertSucceeds(updateDoc(doc(como('repartidor'), 'usuarios', 'repartidor'), { displayName: 'Pedro' }));
  });

  test('un repartidor no se agrega el rol de operador', async () => {
    await assertFails(updateDoc(doc(como('repartidor'), 'usuarios', 'repartidor'), { roles: ['courier', 'operator'] }));
  });

  test('un usuario no cambia sus propios nombres de función', async () => {
    await assertFails(updateDoc(doc(como('mixto'), 'usuarios', 'mixto'), { cargos: { operator: 'Jefe' } }));
  });

  test('un administrador de granja no modifica su propio perfil', async () => {
    await assertFails(updateDoc(doc(como('subadmin'), 'usuarios', 'subadmin'), { roles: ['admin', 'courier'] }));
  });

  test('el alta propia no puede traer roles', async () => {
    const db = como('nuevo');
    const base = perfil('nuevo', { estado: 'pendiente' });
    await assertFails(setDoc(doc(db, 'usuarios', 'nuevo'), { ...base, roles: ['operator'] }));
    await assertFails(setDoc(doc(db, 'usuarios', 'nuevo'), { ...base, roles: [], cargos: { operator: 'X' } }));
    await assertSucceeds(setDoc(doc(db, 'usuarios', 'nuevo'), { ...base, roles: [], cargos: {} }));
  });

  test('el alta propia sin campos nuevos (versión anterior) sigue funcionando', async () => {
    await assertSucceeds(setDoc(doc(como('nuevo2'), 'usuarios', 'nuevo2'), perfil('nuevo2', { estado: 'pendiente' })));
  });
});

describe('Gestión de roles por administradores', () => {
  test('un administrador de granja asigna operador + repartidor con nombres propios', async () => {
    await assertSucceeds(
      updateDoc(doc(como('subadmin'), 'usuarios', 'pendiente'), {
        estado: 'activo',
        roles: ['operator', 'courier'],
        cargos: { operator: 'Analista de producción B', courier: 'Auxiliar de distribución' }
      })
    );
    await assertSucceeds(getDocs(collection(como('pendiente'), 'lotes')));
  });

  test('un administrador de granja NO otorga el rol de administrador', async () => {
    await assertFails(updateDoc(doc(como('subadmin'), 'usuarios', 'operador'), { rol: 'admin', roles: ['admin', 'operator'] }));
  });

  test('un administrador de granja NO modifica ni borra a otro administrador', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'usuarios', 'subadmin2'), perfil('subadmin2', { rol: 'admin', roles: ['admin'] }))
    );
    await assertFails(updateDoc(doc(como('subadmin'), 'usuarios', 'subadmin2'), { estado: 'inactivo' }));
    await assertFails(deleteDoc(doc(como('subadmin'), 'usuarios', 'subadmin2')));
  });

  test('un administrador de granja NO modifica al Administrador Maestro', async () => {
    await assertFails(updateDoc(doc(como('subadmin'), 'usuarios', 'maestro'), { roles: ['admin'] }));
  });

  test('el Administrador Maestro otorga y retira el rol de administrador', async () => {
    const db = como('maestro');
    await assertSucceeds(updateDoc(doc(db, 'usuarios', 'operador'), { rol: 'admin', roles: ['admin', 'operator'] }));
    await assertSucceeds(updateDoc(doc(db, 'usuarios', 'operador'), { rol: 'operario', roles: ['operator'] }));
  });

  test('el Administrador Maestro se asigna la función de repartidor', async () => {
    await assertSucceeds(
      updateDoc(doc(como('maestro'), 'usuarios', 'maestro'), {
        roles: ['admin', 'operator', 'courier'],
        cargos: { admin: 'Administrador Principal', courier: 'Repartidor jefe' }
      })
    );
  });

  test('roles inválidos o incoherentes se rechazan', async () => {
    const db = como('maestro');
    await assertFails(updateDoc(doc(db, 'usuarios', 'operador'), { roles: ['superadmin'] }));
    await assertFails(updateDoc(doc(db, 'usuarios', 'operador'), { roles: ['admin'] })); // rol sigue en operario
    await assertFails(updateDoc(doc(db, 'usuarios', 'operador'), { roles: 'operator' }));
    await assertFails(updateDoc(doc(db, 'usuarios', 'operador'), { cargos: { jefe: 'X' } }));
    await assertFails(updateDoc(doc(db, 'usuarios', 'operador'), { cargos: { operator: 'x'.repeat(81) } }));
  });

  test('cambiar el nombre visible no cambia los permisos', async () => {
    const admin = como('subadmin');
    await assertSucceeds(updateDoc(doc(admin, 'usuarios', 'operador'), { cargos: { operator: 'Repartidor jefe' } }));
    await assertSucceeds(updateDoc(doc(admin, 'usuarios', 'repartidor'), { cargos: { courier: 'Operador de producción' } }));
    await assertSucceeds(getDocs(collection(como('operador'), 'lotes')));
    await assertSucceeds(agregarEvento(como('operador')));
    await assertFails(getDocs(collection(como('repartidor'), 'lotes')));
    await assertFails(agregarEvento(como('repartidor')));
  });

  test('retirar el rol de operador quita el acceso a producción', async () => {
    await assertSucceeds(getDocs(collection(como('mixto'), 'lotes')));
    await assertSucceeds(updateDoc(doc(como('subadmin'), 'usuarios', 'mixto'), { roles: ['courier'], cargos: { courier: 'Repartidor jefe' } }));
    await assertFails(getDocs(collection(como('mixto'), 'lotes')));
    await assertFails(agregarEvento(como('mixto')));
  });

  test('desactivar una cuenta quita todo acceso', async () => {
    await assertSucceeds(updateDoc(doc(como('subadmin'), 'usuarios', 'operador'), { estado: 'inactivo' }));
    await assertFails(getDocs(collection(como('operador'), 'lotes')));
  });

  test('un administrador de granja borra a un repartidor', async () => {
    await assertSucceeds(deleteDoc(doc(como('subadmin'), 'usuarios', 'repartidor')));
  });
});
