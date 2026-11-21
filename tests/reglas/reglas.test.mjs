// Pruebas de firestore.rules (roles funcionales y acceso) en el emulador local.
// Uso: npm install && npm test   (desde tests/reglas; requiere Java y firebase-tools)
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
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
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch
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
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: Number((process.env.FIRESTORE_EMULATOR_HOST || '').split(':')[1] || 8085) }
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

const H1 = '1'.repeat(64);
const eventoNuevo = (uid, extra = {}) => ({
  indice: 1, tipo: 'Alimentación', hashAnterior: 'h0', hash: H1, registradoPor: PERFILES[uid]?.email || `${uid}@prueba.co`, ...extra
});
// Lote nuevo como lo crea la app (crearNuevoLote): contador global y lote en la misma operación,
// evento 0 de siembra firmado por quien crea y coherente con la cabecera
const H0V = 'c'.repeat(64);
function loteNuevo(uid, codigo, consecutivo = 2, extra = {}) {
  const correo = PERFILES[uid]?.email || `${uid}@prueba.co`;
  return {
    codigo, consecutivo, estanque: 'E1', producto: 'Tilapia roja', modalidad: 'Estanque', origen: 'Cultivos Loré',
    fechaSiembra: '2026-10-01', cantidadSembrada: 1000, pesoInicialPromedioG: 2, proveedorAlevinos: '', estado: 'activo',
    fechaCierre: null,
    eventos: [{ id: 'e0', indice: 0, tipo: 'Siembra', fechaEvento: '2026-10-01', descripcion: 'Siembra', datos: { cantidad: 1000, pesoPromedioInicialG: 2, proveedor: '' },
                registradoPor: correo, registradoPorNombre: PERFILES[uid]?.displayName || uid, registradoEn: 'x', hashAnterior: '0'.repeat(64), hash: H0V }],
    resumen: { mortalidadAcumulada: 0, pecesCosechados: 0, pecesVivos: 1000, supervivencia: 100, biomasaCosechadaKg: 0, hashFinal: H0V },
    pdfPath: `lotes/${codigo}.pdf`, pdfUrl: `https://proyecto-tilapia-roja-claude.vercel.app/?lote=${codigo}`, versionPdf: 1, pdfActualizadoEn: 'x',
    granjaId: 'cultivos-lore', creadoPor: correo, creadoPorUid: uid, creadoEn: 'x', actualizadoEn: 'x', observacionesIniciales: '',
    ...extra
  };
}
function crearLoteComoApp(db, uid, codigo, extra = {}, consecutivo = 2) {
  const b = writeBatch(db);
  b.set(doc(db, 'contadores', 'lotes_global'), { valor: consecutivo, actualizadoEn: 'x' }, { merge: true });
  b.set(doc(db, 'contadores', 'diario_20261001_E1'), { valor: 1, actualizadoEn: 'x' }, { merge: true });
  b.set(doc(db, 'lotes', codigo), loteNuevo(uid, codigo, consecutivo, extra));
  return b.commit();
}

const agregarEvento = (db, uid) =>
  updateDoc(doc(db, 'lotes', 'L-ACTIVO'), {
    eventos: [...LOTE_ACTIVO.eventos, eventoNuevo(uid)],
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
      await assertSucceeds(agregarEvento(como(uid), uid));
    });
  }

  for (const uid of ['repartidor', 'engano', 'consulta', 'inactivo']) {
    test(`${uid} NO registra eventos aunque tenga permisos marcados`, async () => {
      await assertFails(agregarEvento(como(uid), uid));
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
    await assertSucceeds(agregarEvento(como('operador'), 'operador'));
    await assertFails(getDocs(collection(como('repartidor'), 'lotes')));
    await assertFails(agregarEvento(como('repartidor'), 'repartidor'));
  });

  test('retirar el rol de operador quita el acceso a producción', async () => {
    await assertSucceeds(getDocs(collection(como('mixto'), 'lotes')));
    await assertSucceeds(updateDoc(doc(como('subadmin'), 'usuarios', 'mixto'), { roles: ['courier'], cargos: { courier: 'Repartidor jefe' } }));
    await assertFails(getDocs(collection(como('mixto'), 'lotes')));
    await assertFails(agregarEvento(como('mixto'), 'mixto'));
  });

  test('desactivar una cuenta quita todo acceso', async () => {
    await assertSucceeds(updateDoc(doc(como('subadmin'), 'usuarios', 'operador'), { estado: 'inactivo' }));
    await assertFails(getDocs(collection(como('operador'), 'lotes')));
  });

  test('un administrador de granja borra a un repartidor', async () => {
    await assertSucceeds(deleteDoc(doc(como('subadmin'), 'usuarios', 'repartidor')));
  });
});

describe('Integridad de los lotes (fase 6)', () => {
  const lote = (db) => doc(db, 'lotes', 'L-ACTIVO');
  const sellar = async () =>
    env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'lotes', 'L-ACTIVO'), { estado: 'cerrado' }));

  test('los eventos registrados no se modifican, no se borran ni se reemplazan', async () => {
    const db = como('operador');
    await assertFails(updateDoc(lote(db), { eventos: [{ ...LOTE_ACTIVO.eventos[0], hash: 'otro' }] }));
    await assertFails(updateDoc(lote(db), { eventos: [] }));
    await assertFails(updateDoc(lote(db), { eventos: [{ ...LOTE_ACTIVO.eventos[0], tipo: 'Cosecha' }, eventoNuevo('operador')] }));
  });

  test('el evento nuevo debe continuar la cadena y quedar a nombre de quien registra', async () => {
    const db = como('operador');
    const con = (extra) => updateDoc(lote(db), { eventos: [...LOTE_ACTIVO.eventos, eventoNuevo('operador', extra)] });
    await assertFails(con({ indice: 5 }));
    await assertFails(con({ hashAnterior: 'falso' }));
    await assertFails(con({ registradoPor: 'otra@persona.co' }));
    await assertFails(con({ tipo: 'Siembra' }));
    await assertFails(con({ hash: 'corto' }));
    await assertFails(updateDoc(lote(db), { eventos: [...LOTE_ACTIVO.eventos, eventoNuevo('operador'), { ...eventoNuevo('operador'), indice: 2, hashAnterior: H1 }] }));
    await assertSucceeds(con({ tipo: 'Corrección' }));
  });

  test('corregir datos de siembra sin agregar el evento de corrección queda rechazado', async () => {
    await assertFails(updateDoc(lote(como('operador')), { cantidadSembrada: 999, eventos: [{ ...LOTE_ACTIVO.eventos[0], descripcion: 'cambiada' }] }));
  });

  test('sellar el lote no puede cambiar sus eventos', async () => {
    const db = como('operador');
    await assertFails(updateDoc(lote(db), { estado: 'cerrado', eventos: [...LOTE_ACTIVO.eventos, eventoNuevo('operador')] }));
    await assertSucceeds(updateDoc(lote(db), { estado: 'cerrado', fechaCierre: '2026-10-31' }));
  });

  test('un lote sellado no se modifica ni se borra, ni siquiera por el Administrador Maestro', async () => {
    await sellar();
    await assertFails(agregarEvento(como('maestro'), 'maestro'));
    await assertFails(deleteDoc(lote(como('maestro'))));
  });

  test('el Administrador Maestro puede borrar un lote activo; nadie más', async () => {
    await assertFails(deleteDoc(lote(como('subadmin'))));
    await assertFails(deleteDoc(lote(como('operador'))));
    await assertSucceeds(deleteDoc(lote(como('maestro'))));
  });

  test('no se modifica ni se crea un lote de otra granja', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'lotes', 'L-OTRA'), { ...LOTE_ACTIVO, codigo: 'L-OTRA', granjaId: 'otra-granja' })
    );
    const db = como('operador');
    await assertFails(updateDoc(doc(db, 'lotes', 'L-OTRA'), { eventos: [...LOTE_ACTIVO.eventos, eventoNuevo('operador')] }));
    await assertFails(setDoc(doc(db, 'lotes', 'L-NUEVA'), { ...LOTE_ACTIVO, codigo: 'L-NUEVA', granjaId: 'otra-granja' }));
    await assertSucceeds(crearLoteComoApp(db, 'operador', 'L-PROPIA'));
  });

  test('un lote nuevo empieza solo con su evento de siembra', async () => {
    const db = como('operador');
    await assertFails(setDoc(doc(db, 'lotes', 'L-X'), { ...LOTE_ACTIVO, codigo: 'L-X', eventos: [...LOTE_ACTIVO.eventos, eventoNuevo('operador')] }));
    await assertFails(setDoc(doc(db, 'lotes', 'L-Y'), { ...LOTE_ACTIVO, codigo: 'L-Y', eventos: [{ indice: 0, tipo: 'Cosecha', hash: 'h0' }] }));
  });
});

describe('Privacidad y configuración (fase 6)', () => {
  test('las entregas antiguas de un lote ya no son públicas; el operador sí las lee', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'entregas', 'L-ACTIVO'), { codigoLote: 'L-ACTIVO', registros: [] }));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'entregas', 'L-ACTIVO')));
    await assertFails(getDoc(doc(como('repartidor'), 'entregas', 'L-ACTIVO')));
    await assertSucceeds(getDoc(doc(como('operador'), 'entregas', 'L-ACTIVO')));
  });

  test('quien solo gestiona estanques no cambia el resto de la configuración', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'usuarios', 'estanques'), perfil('estanques', { roles: ['operator'], permisos: { ...SIN_PERMISOS, gestionarEstanques: true } }));
      await setDoc(doc(ctx.firestore(), 'configuracion', 'general'), { estanques: [], rangosReferencia: { ph: 7 }, fichaNutricional: {} });
    });
    const db = env.authenticatedContext('estanques', { email: 'estanques@prueba.co', email_verified: true }).firestore();
    await assertSucceeds(setDoc(doc(db, 'configuracion', 'general'), { estanques: [{ codigo: 'E3' }], actualizadoEn: 'x' }, { merge: true }));
    await assertFails(setDoc(doc(db, 'configuracion', 'general'), { rangosReferencia: { ph: 1 } }, { merge: true }));
    await assertSucceeds(setDoc(doc(como('subadmin'), 'configuracion', 'general'), { rangosReferencia: { ph: 6 } }, { merge: true }));
  });
});

describe('Lote activo: cosecha y siembra coherentes (revisión de hashes)', () => {
  const lote = (db) => doc(db, 'lotes', 'L-ACTIVO');
  const conResumen = async (resumen) =>
    env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'lotes', 'L-ACTIVO'), { resumen, cantidadSembrada: 2000 }));
  const cosecha = (kg, peces, resumenNuevo) =>
    updateDoc(lote(como('operador')), {
      eventos: [...LOTE_ACTIVO.eventos, eventoNuevo('operador', { tipo: 'Cosecha', datos: { biomasaCosechadaKg: kg, pecesCosechados: peces } })],
      resumen: resumenNuevo
    });

  test('inflar la cosecha guardada sin un evento Cosecha se rechaza (evita sobre-reservar)', async () => {
    await conResumen({ biomasaCosechadaKg: 300, pecesCosechados: 600 });
    await assertFails(updateDoc(lote(como('operador')), { 'resumen.biomasaCosechadaKg': 5000 }));
    await assertFails(updateDoc(lote(como('operador')), {
      eventos: [...LOTE_ACTIVO.eventos, eventoNuevo('operador')],
      resumen: { biomasaCosechadaKg: 5000, pecesCosechados: 600 }
    }));
  });

  test('un evento Cosecha sube la cosecha exactamente en lo que registra', async () => {
    await conResumen({ biomasaCosechadaKg: 300, pecesCosechados: 600 });
    await assertFails(cosecha(100, 200, { biomasaCosechadaKg: 900, pecesCosechados: 800 }));
    await assertSucceeds(cosecha(100, 200, { biomasaCosechadaKg: 400, pecesCosechados: 800, pecesVivos: 1200, hashFinal: H1 }));
  });

  test('los datos de siembra solo cambian con una Corrección de siembra que registre el mismo valor', async () => {
    await conResumen({ biomasaCosechadaKg: 0, pecesCosechados: 0 });
    const corr = (datos) => eventoNuevo('operador', { tipo: 'Corrección', datos: { ambito: 'siembra', ...datos } });
    await assertFails(updateDoc(lote(como('operador')), { cantidadSembrada: 2500 }));
    await assertFails(updateDoc(lote(como('operador')), { eventos: [...LOTE_ACTIVO.eventos, eventoNuevo('operador')], cantidadSembrada: 2500 }));
    await assertFails(updateDoc(lote(como('operador')), { eventos: [...LOTE_ACTIVO.eventos, corr({ estanque: 'E1 → E2' })], cantidadSembrada: 2500 }));
    await assertSucceeds(updateDoc(lote(como('operador')), { eventos: [...LOTE_ACTIVO.eventos, corr({ cantidadSembrada: '2000 → 2500' })], cantidadSembrada: 2500 }));
  });

  test('al sellar, la cosecha guardada no cambia', async () => {
    await conResumen({ biomasaCosechadaKg: 300, pecesCosechados: 600 });
    await assertFails(updateDoc(lote(como('operador')), { estado: 'cerrado', fechaCierre: '2026-11-14', resumen: { biomasaCosechadaKg: 999, pecesCosechados: 600 } }));
    // Al sellar, la app recalcula el resumen con los mismos eventos: misma cosecha, sello en la última fase
    await assertSucceeds(updateDoc(lote(como('operador')), {
      estado: 'cerrado', fechaCierre: '2026-11-14',
      resumen: { biomasaCosechadaKg: 300, pecesCosechados: 600, mortalidadAcumulada: 0, pecesVivos: 1400, supervivencia: 100, hashFinal: 'h0' }
    }));
  });

  test('un lote nuevo no puede traer cosecha', async () => {
    await assertFails(setDoc(doc(como('operador'), 'lotes', 'L-COS'), { ...LOTE_ACTIVO, codigo: 'L-COS', resumen: { biomasaCosechadaKg: 50 } }));
  });

  test('sin ningún permiso de "ver", un operador no lista los lotes', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'usuarios', 'operador'), {
        ...PERFILES.operador,
        permisos: { ...SIN_PERMISOS, verInicio: false, verLotes: false, verAnalitica: false, verEntregas: false,
          buscarLotes: false, descargarDocumentosLote: false, exportarAnalitica: false, corregirSiembra: false }
      })
    );
    await assertFails(getDocs(collection(como('operador'), 'lotes')));
  });
});

describe('Permisos por pestaña: la pantalla y las reglas coinciden (QA)', () => {
  const soloPermisos = (permisos) =>
    env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'usuarios', 'operador'), {
        ...PERFILES.operador,
        permisos: { ...SIN_PERMISOS, verInicio: false, verLotes: false, verAnalitica: false, verEntregas: false,
          buscarLotes: false, descargarDocumentosLote: false, exportarAnalitica: false, corregirSiembra: false, ...permisos }
      })
    );

  test('con solo "registrar eventos" (sin permisos de ver) sí lista los lotes', async () => {
    await soloPermisos({ registrarEventos: true });
    await assertSucceeds(getDocs(collection(como('operador'), 'lotes')));
  });

  test('con solo "corregir siembra" agrega una Corrección de siembra, pero no otros eventos', async () => {
    await soloPermisos({ corregirSiembra: true });
    const lote = doc(como('operador'), 'lotes', 'L-ACTIVO');
    await assertFails(updateDoc(lote, { eventos: [...LOTE_ACTIVO.eventos, eventoNuevo('operador')] }));
    await assertSucceeds(updateDoc(lote, {
      eventos: [...LOTE_ACTIVO.eventos, eventoNuevo('operador', { tipo: 'Corrección', datos: { ambito: 'siembra', cantidadSembrada: '2000 → 2050' } })],
      cantidadSembrada: 2050
    }));
  });
});

describe('Anotaciones posteriores al cierre de un lote', () => {
  const SELLADO = { ...LOTE_ACTIVO, codigo: 'L-SELLADO', estado: 'cerrado', eventos: [{ indice: 0, tipo: 'Siembra', hash: 'h0' }, { indice: 1, tipo: 'Cosecha', hash: 'h1', datos: { biomasaCosechadaKg: 912 } }] };
  const H = (c) => c.repeat(64);
  const reg = (uid, indice, tipo, datos, hashAnterior, extra = {}) => ({
    // Hash con forma de SHA-256 (64 hex); nunca 64 ceros, que las reglas rechazan
    id: `r${indice}`, indice, tipo, fecha: 'x', datos, hashAnterior, hash: H(String(indice + 1)).slice(0, 64),
    registradoPor: PERFILES[uid]?.email || `${uid}@prueba.co`, registradoPorUid: uid, ...extra
  });
  const propuesta = { fase: 1, dato: 'biomasaCosechadaKg', valorRegistrado: '912', valorCorrecto: '950', motivo: 'Error al digitar la biomasa en la báscula' };
  const conPermisos = (uid, permisos) =>
    env.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore(), 'usuarios', uid), Object.fromEntries(Object.entries(permisos).map(([k, v]) => [`permisos.${k}`, v])))
    );
  const proponer = (uid, extra = {}, datos = propuesta, codigo = 'L-SELLADO', anclaje = 'h1') =>
    setDoc(doc(como(uid), 'anotacionesLote', codigo), {
      codigoLote: codigo, granjaId: 'cultivos-lore', hashAnclaje: anclaje, resueltas: {},
      registros: [reg(uid, 0, 'Propuesta', datos, anclaje)], ...extra
    });
  const resolver = async (uid, propuestaIndice, aprobar = true) => {
    const d = await leerAnot();
    return updateDoc(doc(como(uid), 'anotacionesLote', 'L-SELLADO'), {
      registros: [...d.registros, reg(uid, d.registros.length, aprobar ? 'Aprobación' : 'Rechazo', { propuestaIndice }, d.registros[d.registros.length - 1].hash)],
      resueltas: { ...d.resueltas, [String(propuestaIndice)]: aprobar ? 'aprobada' : 'rechazada' }
    });
  };
  let leerAnot;

  beforeEach(async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'lotes', 'L-SELLADO'), SELLADO));
    await conPermisos('operador', { proponerAnotaciones: true });
    await conPermisos('mixto', { aprobarAnotaciones: true });
    leerAnot = async () => {
      let d;
      await env.withSecurityRulesDisabled(async (ctx) => { d = (await getDoc(doc(ctx.firestore(), 'anotacionesLote', 'L-SELLADO'))).data(); });
      return d;
    };
  });

  test('se propone sobre un lote sellado, anclada a su sello, con motivo y permiso', async () => {
    await assertFails(proponer('legado'));
    await assertFails(proponer('operador', {}, { ...propuesta, motivo: 'corto' }));
    await assertFails(proponer('operador', {}, { ...propuesta, fase: 9 }));
    await assertFails(proponer('operador', {}, propuesta, 'L-SELLADO', 'falso'));
    await assertFails(proponer('operador', {}, propuesta, 'L-ACTIVO', 'h0'));
    await assertSucceeds(proponer('operador'));
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'anotacionesLote', 'L-SELLADO')));
  });

  test('la aprueba otra persona con permiso; nunca quien la propuso; una sola vez', async () => {
    await proponer('operador');
    await conPermisos('operador', { aprobarAnotaciones: true });
    await assertFails(resolver('operador', 0));
    await assertFails(resolver('legado', 0));
    await assertSucceeds(resolver('mixto', 0));
    await assertFails(resolver('subadmin', 0, false));
    assert.equal((await leerAnot()).resueltas['0'], 'aprobada');
  });

  test('nombre falso, valor registrado distinto de lo sellado o claves extra se rechazan', async () => {
    const conDatos = (datos) => setDoc(doc(como('operador'), 'anotacionesLote', 'L-SELLADO'), {
      codigoLote: 'L-SELLADO', granjaId: 'cultivos-lore', hashAnclaje: 'h1', resueltas: {},
      registros: [reg('operador', 0, 'Propuesta', datos, 'h1')]
    });
    await env.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore(), 'lotes', 'L-SELLADO'), { eventos: [{ indice: 0, tipo: 'Siembra', hash: 'h0' }, { indice: 1, tipo: 'Cosecha', hash: 'h1', datos: { biomasaCosechadaKg: 912 } }] })
    );
    await assertFails(setDoc(doc(como('operador'), 'anotacionesLote', 'L-SELLADO'), {
      codigoLote: 'L-SELLADO', granjaId: 'cultivos-lore', hashAnclaje: 'h1', resueltas: {},
      registros: [reg('operador', 0, 'Propuesta', propuesta, 'h1', { registradoPorNombre: 'Gerente General' })]
    }));
    await assertFails(conDatos({ ...propuesta, valorRegistrado: '100' }));
    await assertFails(conDatos({ ...propuesta, valorRegistrado: '912', extra: 'x' }));
    await assertSucceeds(conDatos({ ...propuesta, valorRegistrado: '912' }));
  });

  test('rechazar exige un motivo', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore(), 'lotes', 'L-SELLADO'), { eventos: [{ indice: 0, tipo: 'Siembra', hash: 'h0' }, { indice: 1, tipo: 'Cosecha', hash: 'h1', datos: { biomasaCosechadaKg: 912 } }] })
    );
    await proponer('operador', {}, { ...propuesta, valorRegistrado: '912' });
    const d = await leerAnot();
    const rechazo = (respuesta) => updateDoc(doc(como('mixto'), 'anotacionesLote', 'L-SELLADO'), {
      registros: [...d.registros, reg('mixto', 1, 'Rechazo', { propuestaIndice: 0, respuesta }, d.registros[0].hash)],
      resueltas: { '0': 'rechazada' }
    });
    await assertFails(rechazo(''));
    await assertSucceeds(rechazo('No corresponde: la báscula estaba bien'));
  });

  test('no se aprueba sobre una cadena alterada (sello cambiado o propuesta desenlazada)', async () => {
    const sellar = (h1) => env.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore(), 'lotes', 'L-SELLADO'), { eventos: [{ indice: 0, tipo: 'Siembra', hash: 'h0' }, { indice: 1, tipo: 'Cosecha', hash: h1, datos: { biomasaCosechadaKg: 912 } }] })
    );
    await sellar('h1');
    await proponer('operador', {}, { ...propuesta, valorRegistrado: '912' });
    const d = await leerAnot();
    const aprobar = () => updateDoc(doc(como('mixto'), 'anotacionesLote', 'L-SELLADO'), {
      registros: [...d.registros, reg('mixto', 1, 'Aprobación', { propuestaIndice: 0, respuesta: '' }, d.registros[0].hash)],
      resueltas: { '0': 'aprobada' }
    });
    // Sello del lote cambiado después de anotar
    await sellar('h1-reescrito');
    await assertFails(aprobar());
    await sellar('h1');
    // Propuesta desenlazada de la cadena
    await env.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore(), 'anotacionesLote', 'L-SELLADO'), { registros: [{ ...d.registros[0], hashAnterior: 'otro' }] })
    );
    await assertFails(aprobar());
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'anotacionesLote', 'L-SELLADO'), { registros: d.registros }));
    await assertSucceeds(aprobar());
  });

  test('una fase nueva no se firma con el nombre de otra persona', async () => {
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'usuarios', 'operador'), { displayName: 'Ana Gómez' }));
    const lote = doc(como('operador'), 'lotes', 'L-ACTIVO');
    await assertFails(updateDoc(lote, { eventos: [...LOTE_ACTIVO.eventos, eventoNuevo('operador', { registradoPorNombre: 'Gerente General' })] }));
    await assertSucceeds(updateDoc(lote, { eventos: [...LOTE_ACTIVO.eventos, eventoNuevo('operador', { registradoPorNombre: 'Ana Gómez' })] }));
  });

  test('el historial de anotaciones no se modifica ni se borra, y el lote sellado sigue igual', async () => {
    await proponer('operador');
    const d = await leerAnot();
    await assertFails(updateDoc(doc(como('operador'), 'anotacionesLote', 'L-SELLADO'), { registros: [{ ...d.registros[0], datos: { ...propuesta, valorCorrecto: '2000' } }] }));
    await assertFails(deleteDoc(doc(como('maestro'), 'anotacionesLote', 'L-SELLADO')));
    const lote = (await (async () => { let x; await env.withSecurityRulesDisabled(async (ctx) => { x = (await getDoc(doc(ctx.firestore(), 'lotes', 'L-SELLADO'))).data(); }); return x; })());
    assert.deepEqual(lote, SELLADO);
  });
});

// ===== Segunda ronda (H20, H19, H45) en lotes y anotaciones: la versión nueva de la app firma los
// registros con el uid (no guarda el correo en lo que se lee sin sesión) y deja la hora del servidor
// de cada registro en registradoEnServidor[indice], fuera del hash. La versión anterior (correo y
// sin hora del servidor) sigue pasando mientras el documento no tenga horas del servidor.
describe('Firma con uid (H20) y hora del servidor (H19) en lotes y anotaciones', () => {
  const lote = (db) => doc(db, 'lotes', 'L-ACTIVO');
  const leer = async (col, id) => {
    let d;
    await env.withSecurityRulesDisabled(async (ctx) => { d = (await getDoc(doc(ctx.firestore(), col, id))).data(); });
    return d;
  };
  const evUid = (uid, indice, hashAnterior, extra = {}) =>
    ({ indice, tipo: 'Alimentación', hashAnterior, hash: String(indice + 1).repeat(64).slice(0, 64), registradoPor: uid, ...extra });

  test('crear un lote con la firma uid y la hora del servidor de la siembra', async () => {
    const db = como('operador');
    const e0 = (extra) => ({ eventos: [{ ...loteNuevo('operador', 'L-UID').eventos[0], registradoPor: 'operador', registradoPorNombre: 'operador', ...extra }] });
    const base = { creadoPor: 'operador', registradoEnServidor: { '0': serverTimestamp() } };
    await assertFails(crearLoteComoApp(db, 'operador', 'L-UID', { ...base, creadoPor: 'subadmin', ...e0() }));
    await assertFails(crearLoteComoApp(db, 'operador', 'L-UID', { ...base, ...e0({ registradoPor: 'subadmin' }) }));
    await assertFails(crearLoteComoApp(db, 'operador', 'L-UID', { ...base, ...e0({ registradoPorNombre: 'Gerente General' }) }));
    await assertFails(crearLoteComoApp(db, 'operador', 'L-UID', { ...base, registradoEnServidor: { '0': Timestamp.fromDate(new Date('2026-01-01')) }, ...e0() }));
    await assertFails(crearLoteComoApp(db, 'operador', 'L-UID', { ...base, registradoEnServidor: { '0': serverTimestamp(), '1': serverTimestamp() }, ...e0() }));
    await assertSucceeds(crearLoteComoApp(db, 'operador', 'L-UID', { ...base, ...e0() }));
    const d = await leer('lotes', 'L-UID');
    assert.equal(d.creadoPor, 'operador');
    assert.ok(!JSON.stringify(d.eventos).includes('@'));
  });

  test('la versión anterior de la app (correo, sin hora del servidor) sigue creando lotes', async () => {
    await assertSucceeds(crearLoteComoApp(como('operador'), 'operador', 'L-ANTERIOR'));
  });

  test('registrar una fase con la firma uid y su hora del servidor', async () => {
    const db = como('operador');
    const con = (ev, horas) => updateDoc(lote(db), { eventos: [...LOTE_ACTIVO.eventos, ev], ...horas });
    const hora = { 'registradoEnServidor.1': serverTimestamp() };
    await assertFails(con(evUid('subadmin', 1, 'h0'), hora));
    await assertFails(con(evUid('operador', 1, 'h0', { registradoPorNombre: 'Gerente General' }), hora));
    await assertFails(con(evUid('operador', 1, 'h0'), { 'registradoEnServidor.1': Timestamp.fromDate(new Date('2026-01-01')) }));
    await assertFails(con(evUid('operador', 1, 'h0'), { 'registradoEnServidor.0': serverTimestamp() }));
    await assertFails(con(evUid('operador', 1, 'h0'), { 'registradoEnServidor.1': serverTimestamp(), 'registradoEnServidor.0': serverTimestamp() }));
    await assertSucceeds(con(evUid('operador', 1, 'h0', { registradoPorNombre: 'operador' }), hora));
    const d = await leer('lotes', 'L-ACTIVO');
    assert.ok(d.registradoEnServidor['1'] instanceof Timestamp);
    // Una vez que el lote tiene horas del servidor, cada fase nueva debe dejar la suya y no se tocan las anteriores
    const ev2 = evUid('operador', 2, d.eventos[1].hash);
    await assertFails(updateDoc(lote(db), { eventos: [...d.eventos, ev2] }));
    await assertFails(updateDoc(lote(db), { eventos: [...d.eventos, ev2], 'registradoEnServidor.1': serverTimestamp(), 'registradoEnServidor.2': serverTimestamp() }));
    await assertFails(updateDoc(lote(db), { 'registradoEnServidor.1': serverTimestamp(), actualizadoEn: 'y' }));
    await assertSucceeds(updateDoc(lote(db), { eventos: [...d.eventos, ev2], 'registradoEnServidor.2': serverTimestamp() }));
  });

  test('la versión anterior de la app (correo, sin hora del servidor) sigue registrando fases en lotes sin horas', async () => {
    await assertSucceeds(updateDoc(lote(como('operador')), { eventos: [...LOTE_ACTIVO.eventos, eventoNuevo('operador')] }));
  });

  test('el cierre no toca las horas del servidor de las fases', async () => {
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'lotes', 'L-ACTIVO'), { registradoEnServidor: { '0': Timestamp.now() } }));
    const cerrar = (extra) => updateDoc(lote(como('operador')), { estado: 'cerrado', fechaCierre: '2026-11-10', ...extra });
    await assertFails(cerrar({ 'registradoEnServidor.0': serverTimestamp() }));
    await assertFails(cerrar({ 'registradoEnServidor.1': serverTimestamp() }));
    await assertSucceeds(cerrar({}));
  });

  describe('anotaciones', () => {
    const SELLADO = { ...LOTE_ACTIVO, codigo: 'L-SELLADO', estado: 'cerrado', eventos: [{ indice: 0, tipo: 'Siembra', hash: 'h0' }, { indice: 1, tipo: 'Cosecha', hash: 'h1', datos: { biomasaCosechadaKg: 912 } }] };
    const propuesta = { fase: 1, dato: 'biomasaCosechadaKg', valorRegistrado: '912', valorCorrecto: '950', motivo: 'Error al digitar la biomasa en la báscula' };
    const reg = (uid, indice, tipo, datos, hashAnterior, extra = {}) => ({
      id: `r${indice}`, indice, tipo, fecha: 'x', datos, hashAnterior, hash: String(indice + 1).repeat(64).slice(0, 64),
      registradoPor: uid, registradoPorUid: uid, ...extra
    });
    const ref = (uid) => doc(como(uid), 'anotacionesLote', 'L-SELLADO');
    const proponer = (uid, extraReg = {}, extraDoc = { registradoEnServidor: { '0': serverTimestamp() } }) =>
      setDoc(ref(uid), { codigoLote: 'L-SELLADO', granjaId: 'cultivos-lore', hashAnclaje: 'h1', resueltas: {}, registros: [reg(uid, 0, 'Propuesta', propuesta, 'h1', extraReg)], ...extraDoc });
    const aprobar = async (uid, extraReg = {}, horas = { 'registradoEnServidor.1': serverTimestamp() }) => {
      const d = await leer('anotacionesLote', 'L-SELLADO');
      return updateDoc(ref(uid), {
        registros: [...d.registros, reg(uid, 1, 'Aprobación', { propuestaIndice: 0, respuesta: '' }, d.registros[0].hash, extraReg)],
        resueltas: { '0': 'aprobada' }, ...horas
      });
    };

    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'lotes', 'L-SELLADO'), SELLADO);
        await updateDoc(doc(db, 'usuarios', 'operador'), { 'permisos.proponerAnotaciones': true });
        await updateDoc(doc(db, 'usuarios', 'mixto'), { 'permisos.aprobarAnotaciones': true });
      });
    });

    test('proponer y aprobar con la firma uid y la hora del servidor de cada registro', async () => {
      await assertFails(proponer('operador', { registradoPor: 'subadmin' }));
      await assertFails(proponer('operador', {}, { registradoEnServidor: { '0': Timestamp.fromDate(new Date('2026-01-01')) } }));
      await assertFails(proponer('operador', {}, { registradoEnServidor: { '1': serverTimestamp() } }));
      await assertSucceeds(proponer('operador'));
      await assertFails(aprobar('mixto', {}, {}));
      await assertFails(aprobar('mixto', {}, { 'registradoEnServidor.1': Timestamp.fromDate(new Date('2026-01-01')) }));
      await assertFails(aprobar('mixto', {}, { 'registradoEnServidor.1': serverTimestamp(), 'registradoEnServidor.0': serverTimestamp() }));
      await assertFails(aprobar('mixto', { registradoPor: 'operador' }));
      await assertSucceeds(aprobar('mixto'));
      const d = await leer('anotacionesLote', 'L-SELLADO');
      assert.ok(!JSON.stringify(d.registros).includes('@'));
      assert.deepEqual(Object.keys(d.registradoEnServidor).sort(), ['0', '1']);
    });

    test('la versión anterior de la app (correo, sin hora del servidor) sigue proponiendo y aprobando', async () => {
      await assertSucceeds(proponer('operador', { registradoPor: 'operador@prueba.co' }, {}));
      await assertSucceeds(aprobar('mixto', { registradoPor: 'mixto@prueba.co' }, {}));
    });

    test('una cadena antigua (correo) admite registros nuevos con uid y hora del servidor', async () => {
      await assertSucceeds(proponer('operador', { registradoPor: 'operador@prueba.co' }, {}));
      await assertSucceeds(aprobar('mixto'));
    });
  });
});

describe('Testigo externo (H03) y ficha congelada (H41)', () => {
  const HF = 'a'.repeat(64);
  const OTS = 'AE9wZW5UaW1lc3RhbXBzAABQcm9vZgC/ieLohOiSlAEI' + 'A'.repeat(60);
  const ENVIO = Timestamp.fromMillis(Date.parse('2026-11-17T15:00:00Z'));
  const CERRADO = {
    ...LOTE_ACTIVO, codigo: 'L-CERRADO', estado: 'cerrado', fechaCierre: '2026-11-17',
    eventos: [{ indice: 0, tipo: 'Siembra', hash: HF }], resumen: { hashFinal: HF }
  };
  const ref = (db, codigo = 'L-CERRADO') => doc(db, 'lotes', codigo);
  const pendiente = (extra = {}) => ({ version: 1, digest: HF, ots: OTS, estado: 'pendiente', enviadoEn: serverTimestamp(), calendarios: 3, ...extra });
  const guardado = { version: 1, digest: HF, ots: OTS, estado: 'pendiente', enviadoEn: ENVIO, calendarios: 3 };
  const confirmado = (extra = {}) => ({ ...guardado, estado: 'confirmado', ots: OTS + 'BBBBBBBB', bloque: 925000, confirmadoEn: '2026-11-17T18:00:00.000Z', ...extra });
  const conSello = (s = guardado, codigo = 'L-CERRADO', extra = {}) =>
    env.withSecurityRulesDisabled((ctx) => setDoc(ref(ctx.firestore(), codigo), { ...CERRADO, codigo, selloTiempo: s, ...extra }));
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(ref(ctx.firestore()), CERRADO);
      await setDoc(doc(ctx.firestore(), 'lotes', 'L-OTRA-GRANJA'), { ...CERRADO, codigo: 'L-OTRA-GRANJA', granjaId: 'otra' });
    });
  });

  test('quien cierra lotes agrega el sello pendiente a un lote cerrado (una sola vez)', async () => {
    await assertSucceeds(updateDoc(ref(como('operador')), { selloTiempo: pendiente() }));
    await assertFails(updateDoc(ref(como('operador')), { selloTiempo: pendiente({ calendarios: 2 }) }));
  });

  test('un administrador de la granja y el maestro también pueden sellarlo', async () => {
    await assertSucceeds(updateDoc(ref(como('subadmin')), { selloTiempo: pendiente() }));
    await env.withSecurityRulesDisabled((ctx) => setDoc(ref(ctx.firestore(), 'L-M'), { ...CERRADO, codigo: 'L-M' }));
    await assertSucceeds(updateDoc(ref(como('maestro'), 'L-M'), { selloTiempo: pendiente() }));
  });

  test('el sello debe cubrir el sello de cierre, con la hora del servidor y estado pendiente', async () => {
    const db = como('operador');
    await assertFails(updateDoc(ref(db), { selloTiempo: pendiente({ digest: 'b'.repeat(64) }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: pendiente({ enviadoEn: ENVIO }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: pendiente({ estado: 'confirmado', bloque: 1 }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: pendiente({ ots: 'corto' }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: pendiente({ ots: OTS + '<script>' }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: pendiente({ extra: 1 }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: pendiente({ calendarios: 0 }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: pendiente({ bloque: 5 }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: pendiente({ version: 2 }) }));
  });

  test('junto con el sello no cambia ningún otro dato del lote cerrado', async () => {
    const db = como('operador');
    await assertFails(updateDoc(ref(db), { selloTiempo: pendiente(), estanque: 'E9' }));
    await assertFails(updateDoc(ref(db), { selloTiempo: pendiente(), 'resumen.hashFinal': 'b'.repeat(64) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: pendiente({ digest: 'b'.repeat(64) }), resumen: { hashFinal: 'b'.repeat(64) } }));
    await assertFails(updateDoc(ref(db), { selloTiempo: pendiente(), estado: 'activo' }));
  });

  test('sin sesión, sin permiso de cierre o de otra granja no se crea el sello', async () => {
    await assertFails(updateDoc(ref(env.unauthenticatedContext().firestore()), { selloTiempo: pendiente() }));
    await assertFails(updateDoc(ref(como('repartidor')), { selloTiempo: pendiente() }));
    await assertFails(updateDoc(ref(como('consulta')), { selloTiempo: pendiente() }));
    await assertFails(updateDoc(ref(como('inactivo')), { selloTiempo: pendiente() }));
    await assertFails(updateDoc(ref(como('operador'), 'L-OTRA-GRANJA'), { selloTiempo: pendiente() }));
  });

  test('un lote activo no recibe sello de tiempo', async () => {
    await assertFails(updateDoc(ref(como('operador'), 'L-ACTIVO'), { selloTiempo: pendiente({ digest: 'h0' }) }));
  });

  test('quien cierra lotes (o el administrador) guarda la confirmación de Bitcoin', async () => {
    await conSello();
    await assertSucceeds(updateDoc(ref(como('operador')), { selloTiempo: confirmado() }));
    await conSello();
    await assertSucceeds(updateDoc(ref(como('subadmin')), { selloTiempo: confirmado() }));
    await conSello();
    await assertSucceeds(updateDoc(ref(como('maestro')), { selloTiempo: confirmado() }));
  });

  test('sin permiso de cierre no se guarda la confirmación (no puede dejar una confirmación falsa fija)', async () => {
    await conSello();
    await assertFails(updateDoc(ref(como('repartidor')), { selloTiempo: confirmado() }));
    await assertFails(updateDoc(ref(como('engano')), { selloTiempo: confirmado() }));
    await assertFails(updateDoc(ref(como('consulta')), { selloTiempo: confirmado() }));
    await assertFails(updateDoc(ref(como('pendiente')), { selloTiempo: confirmado() }));
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'usuarios', 'sincierre'), perfil('sincierre', { roles: ['operator'], permisos: { ...PERMISOS_PRODUCCION, cerrarLotes: false } }))
    );
    await assertFails(updateDoc(ref(como('sincierre')), { selloTiempo: confirmado() }));
    // El sello sigue pendiente: quien sí puede, lo completa después
    await assertSucceeds(updateDoc(ref(como('operador')), { selloTiempo: confirmado() }));
  });

  test('sin sesión, inactivo o de otra granja no guarda la confirmación', async () => {
    await conSello();
    await assertFails(updateDoc(ref(env.unauthenticatedContext().firestore()), { selloTiempo: confirmado() }));
    await assertFails(updateDoc(ref(como('inactivo')), { selloTiempo: confirmado() }));
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(ref(ctx.firestore(), 'L-OTRA-GRANJA'), { ...CERRADO, codigo: 'L-OTRA-GRANJA', granjaId: 'otra', selloTiempo: guardado })
    );
    await assertFails(updateDoc(ref(como('operador'), 'L-OTRA-GRANJA'), { selloTiempo: confirmado() }));
  });

  test('la confirmación mantiene digest, hora de envío y calendarios, y alarga la prueba', async () => {
    await conSello();
    const db = como('operador');
    await assertFails(updateDoc(ref(db), { selloTiempo: confirmado({ digest: 'b'.repeat(64) }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: confirmado({ enviadoEn: Timestamp.fromMillis(Date.parse('2026-11-18T00:00:00Z')) }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: confirmado({ calendarios: 2 }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: confirmado({ ots: OTS }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: confirmado({ bloque: 0 }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: confirmado({ confirmadoEn: 5 }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: { ...guardado, ots: OTS + 'BBBB' } }));
    const { confirmadoEn, ...sinFecha } = confirmado();
    await assertSucceeds(updateDoc(ref(db), { selloTiempo: sinFecha }));
  });

  test('un sello confirmado no se cambia ni se borra', async () => {
    await conSello(confirmado());
    const db = como('maestro');
    await assertFails(updateDoc(ref(db), { selloTiempo: confirmado({ ots: OTS + 'BBBBBBBBCCCC' }) }));
    await assertFails(updateDoc(ref(db), { selloTiempo: { ...guardado } }));
    await assertFails(updateDoc(ref(db), { selloTiempo: null }));
  });

  test('un sello pendiente no se borra ni se reemplaza por otro pendiente', async () => {
    await conSello();
    await assertFails(updateDoc(ref(como('maestro')), { selloTiempo: null }));
    await assertFails(updateDoc(ref(como('maestro')), { selloTiempo: pendiente() }));
  });

  describe('ficha nutricional congelada al cerrar', () => {
    const FICHA = { porcionG: 100, energiaKcal: 96, proteinaG: 20.1, grasaTotalG: 1.7, carbohidratosG: 0, colesterolMg: 50, sodioMg: 52, fuente: 'USDA', notas: 'Referencial' };
    const cerrar = (ficha) => updateDoc(ref(como('operador'), 'L-ACTIVO'), { estado: 'cerrado', fechaCierre: '2026-11-10', fichaNutricionalCierre: ficha });

    test('la app nueva cierra con la copia de la ficha', async () => {
      await assertSucceeds(cerrar(FICHA));
    });

    test('la versión anterior de la app cierra sin la ficha', async () => {
      await assertSucceeds(updateDoc(ref(como('operador'), 'L-ACTIVO'), { estado: 'cerrado', fechaCierre: '2026-11-10' }));
    });

    test('la ficha debe tener exactamente las claves y los tipos de la configuración', async () => {
      await assertFails(cerrar({ ...FICHA, extra: 1 }));
      const { sodioMg, ...sinSodio } = FICHA;
      await assertFails(cerrar(sinSodio));
      await assertFails(cerrar({ ...FICHA, energiaKcal: '96' }));
      await assertFails(cerrar({ ...FICHA, fuente: 5 }));
      await assertFails(cerrar({ ...FICHA, notas: 'x'.repeat(1001) }));
      await assertFails(cerrar('ficha'));
    });

    test('después del cierre la ficha congelada no se cambia ni se borra', async () => {
      await assertSucceeds(cerrar(FICHA));
      await assertFails(updateDoc(ref(como('maestro'), 'L-ACTIVO'), { fichaNutricionalCierre: { ...FICHA, sodioMg: 1 } }));
      await assertFails(updateDoc(ref(como('maestro'), 'L-ACTIVO'), { 'fichaNutricionalCierre.sodioMg': 1 }));
      await assertFails(updateDoc(ref(como('maestro'), 'L-ACTIVO'), { fichaNutricionalCierre: null }));
    });

    test('un lote activo o uno nuevo no traen ficha congelada', async () => {
      await assertFails(updateDoc(ref(como('operador'), 'L-ACTIVO'), { fichaNutricionalCierre: FICHA }));
      await assertFails(crearLoteComoApp(como('operador'), 'operador', 'L-FICHA', { fichaNutricionalCierre: FICHA }));
    });
  });
});
