import { doc, getDoc, setDoc, updateDoc, collection, onSnapshot } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '../firebase/firebaseConfig';
import {
  UsuarioPerfil,
  PermisosUsuario,
  RolUsuario,
  RolFuncional,
  ROLES_FUNCIONALES,
  ADMIN_MASTER_EMAIL
} from '../types';
import { GRANJA_ID_PREDETERMINADA } from '../utils/constants';

// Los perfiles operativos viven únicamente en Firestore, en usuarios/{uid}, donde uid es el UID
// real de Firebase Authentication.

export const PERMISOS_DEFAULT_ADMIN: PermisosUsuario = {
  crearLotes: true,
  registrarEventos: true,
  cerrarLotes: true,
  gestionarEstanques: true,
  gestionarConfiguracion: true,
  administrarUsuarios: true,
  gestionarPedidos: true,
};

export const PERMISOS_DEFAULT_OPERARIO: PermisosUsuario = {
  crearLotes: false,
  registrarEventos: false,
  cerrarLotes: false,
  gestionarEstanques: false,
  gestionarConfiguracion: false,
  administrarUsuarios: false,
  gestionarPedidos: false,
};

/**
 * Indica si un ID de documento corresponde a un perfil creado por las sesiones simuladas de
 * versiones anteriores (sin cuenta real en Firebase Authentication)
 */
function esPerfilSimulado(uid: string): boolean {
  return uid === 'admin_carlos_master' || uid.startsWith('op_');
}

export const ETIQUETA_ROL: Record<RolFuncional, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  courier: 'Repartidor'
};

/**
 * Deja solo roles válidos, sin repetir y en el orden admin, operator, courier
 */
export function ordenarRoles(roles: readonly string[]): RolFuncional[] {
  return ROLES_FUNCIONALES.filter((r) => roles.includes(r));
}

/**
 * Roles de un perfil guardado. Los perfiles anteriores a la lista de roles se interpretan desde
 * su campo rol (igual que en las reglas de Firestore): admin conserva la administración y
 * operario o consulta pasan a operador (consulta, sin permisos marcados).
 */
function rolesDesdeDatos(data: Partial<UsuarioPerfil>, esAdmin: boolean): RolFuncional[] {
  const roles = Array.isArray(data.roles)
    ? ordenarRoles(data.roles)
    : data.rol === 'admin' ? ['admin' as RolFuncional] : ['operator' as RolFuncional];
  return esAdmin && !roles.includes('admin') ? ordenarRoles(['admin', ...roles]) : roles;
}

/**
 * Completa en memoria los campos que los perfiles antiguos no tienen (rol, roles, cargos, granjaId, permisos)
 */
export function normalizarPerfil(data: Partial<UsuarioPerfil>, uid: string): UsuarioPerfil {
  const email = (data.email || '').trim().toLowerCase();
  const esAdmin = esAdminMaestro(email);
  const cargo = data.cargo || (esAdmin ? 'Administrador Maestro' : 'Operario en espera de asignación');
  const roles = rolesDesdeDatos(data, esAdmin);
  // Sin nombres por función guardados, el cargo único anterior queda como nombre de su rol principal
  const cargos = data.cargos && typeof data.cargos === 'object'
    ? { ...data.cargos }
    : data.cargo && roles.length ? { [roles[0]]: data.cargo } : {};
  return {
    ...data,
    uid,
    email,
    displayName: data.displayName || email.split('@')[0] || (esAdmin ? 'Carlos' : 'Operario'),
    rol: data.rol || (esAdmin ? 'admin' : 'operario'),
    roles,
    cargos,
    granjaId: data.granjaId || GRANJA_ID_PREDETERMINADA,
    cargo,
    estado: esAdmin ? 'activo' : (data.estado || 'pendiente'),
    permisos: esAdmin ? PERMISOS_DEFAULT_ADMIN : { ...PERMISOS_DEFAULT_OPERARIO, ...(data.permisos || {}) },
    creadoEn: data.creadoEn || new Date().toISOString(),
    actualizadoEn: data.actualizadoEn || new Date().toISOString()
  };
}

/**
 * Determina si el correo pertenece al Administrador Maestro (Carlos)
 */
export function esAdminMaestro(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_MASTER_EMAIL.toLowerCase();
}

/**
 * Indica si el perfil puede administrar usuarios y configuración de la granja
 */
export function esAdministrador(perfil: UsuarioPerfil | null): boolean {
  if (!perfil) return false;
  if (esAdminMaestro(perfil.email)) return true;
  return perfil.rol === 'admin' && perfil.estado === 'activo';
}

/**
 * Indica si el perfil es miembro autorizado de su granja (cualquier rol en estado activo).
 * Solo los miembros autorizados pueden consultar la lista de lotes de la granja.
 */
export function esMiembroActivo(perfil: UsuarioPerfil | null): boolean {
  if (!perfil) return false;
  return esAdministrador(perfil) || perfil.estado === 'activo';
}

/**
 * Indica si el perfil tiene asignado un rol funcional. Depende solo de los roles, nunca del
 * nombre visible de la función.
 */
export function tieneRol(perfil: UsuarioPerfil | null, rol: RolFuncional): boolean {
  if (!perfil) return false;
  if (esAdminMaestro(perfil.email)) return rol === 'admin' || (perfil.roles || []).includes(rol);
  if (perfil.estado !== 'activo') return false;
  if (rol === 'admin') return perfil.rol === 'admin';
  return (perfil.roles || []).includes(rol);
}

/**
 * Funciones con las que el usuario puede trabajar en esta sesión (las de sus roles asignados)
 */
export function funcionesDisponibles(perfil: UsuarioPerfil | null): RolFuncional[] {
  return ROLES_FUNCIONALES.filter((r) => tieneRol(perfil, r));
}

/**
 * Nombre visible de una función del usuario (el personalizado o, si no tiene, el del rol)
 */
export function nombreFuncion(perfil: UsuarioPerfil | null, rol: RolFuncional): string {
  return perfil?.cargos?.[rol]?.trim() || ETIQUETA_ROL[rol];
}

/**
 * Verifica si un perfil cuenta con un permiso específico. Los permisos de producción solo
 * aplican a los administradores y a quienes tienen el rol de operador.
 */
export function verificarPermiso(
  perfil: UsuarioPerfil | null,
  permiso: keyof PermisosUsuario
): boolean {
  if (!perfil) return false;
  if (esAdministrador(perfil)) return true;
  if (perfil.estado !== 'activo' || perfil.rol === 'consulta') return false;
  if (!tieneRol(perfil, 'operator')) return false;
  return Boolean(perfil.permisos && perfil.permisos[permiso]);
}

const clavePerfil = (uid: string) => `cultivos_lore_perfil_${uid}`;

function guardarCopiaPerfil(perfil: UsuarioPerfil): void {
  try {
    localStorage.setItem(clavePerfil(perfil.uid), JSON.stringify(perfil));
  } catch {}
}

/**
 * Última copia del perfil guardada en este navegador. Solo sirve para mostrar la interfaz sin
 * conexión; los permisos reales los sigue aplicando Firestore al sincronizar.
 */
function leerCopiaPerfil(uid: string): UsuarioPerfil | null {
  try {
    const raw = localStorage.getItem(clavePerfil(uid));
    return raw ? normalizarPerfil(JSON.parse(raw), uid) : null;
  } catch {
    return null;
  }
}

export function borrarCopiaPerfil(uid: string): void {
  try {
    localStorage.removeItem(clavePerfil(uid));
  } catch {}
}

/**
 * Obtiene o crea el perfil operativo del usuario autenticado. Un usuario nuevo queda
 * "pendiente" y sin permisos hasta que un administrador lo autorice.
 */
export async function sincronizarPerfilUsuario(user: User): Promise<UsuarioPerfil> {
  const userRef = doc(db, 'usuarios', user.uid);
  const esAdmin = esAdminMaestro(user.email);
  const fechaIso = new Date().toISOString();

  try {
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      const perfil = normalizarPerfil(snap.data() as Partial<UsuarioPerfil>, user.uid);
      guardarCopiaPerfil(perfil);
      if (!esAdmin) return perfil;

      // El Administrador Maestro siempre conserva el rol de administrador y todos los permisos;
      // las demás funciones que se haya asignado se mantienen (normalizarPerfil ya incluye 'admin')
      const perfilAdmin: UsuarioPerfil = {
        ...perfil,
        rol: 'admin',
        estado: 'activo',
        permisos: PERMISOS_DEFAULT_ADMIN,
        actualizadoEn: fechaIso
      };
      await setDoc(userRef, {
        rol: perfilAdmin.rol,
        roles: perfilAdmin.roles,
        granjaId: perfilAdmin.granjaId,
        estado: perfilAdmin.estado,
        permisos: perfilAdmin.permisos,
        actualizadoEn: fechaIso
      }, { merge: true });
      return perfilAdmin;
    }

    const nuevoPerfil: UsuarioPerfil = {
      uid: user.uid,
      email: (user.email || '').trim().toLowerCase(),
      displayName: user.displayName || user.email?.split('@')[0] || (esAdmin ? 'Carlos' : 'Operario'),
      rol: esAdmin ? 'admin' : 'operario',
      // Un usuario nuevo no tiene funciones hasta que un administrador se las asigne
      roles: esAdmin ? ['admin'] : [],
      cargos: esAdmin ? { admin: 'Administrador Principal / Propietario' } : {},
      granjaId: GRANJA_ID_PREDETERMINADA,
      cargo: esAdmin ? 'Administrador Principal / Propietario' : 'Operario en espera de asignación',
      estado: esAdmin ? 'activo' : 'pendiente',
      permisos: esAdmin ? PERMISOS_DEFAULT_ADMIN : PERMISOS_DEFAULT_OPERARIO,
      creadoEn: fechaIso,
      actualizadoEn: fechaIso,
      ...(esAdmin ? { autorizadoPor: ADMIN_MASTER_EMAIL } : {})
    };
    await setDoc(userRef, nuevoPerfil, { merge: true });
    return nuevoPerfil;
  } catch (err: any) {
    console.warn('Sincronización perfil de usuario (contingencia activa):', err?.message || err);
    // Sin conexión: se usa la última copia del perfil guardada en este navegador
    const copia = leerCopiaPerfil(user.uid);
    if (copia) return copia;
    // Si Carlos ingresó, generar perfil maestro en memoria como contingencia para no bloquear su sesión
    if (esAdmin) {
      return {
        uid: user.uid,
        email: user.email || ADMIN_MASTER_EMAIL,
        displayName: 'Carlos',
        rol: 'admin',
        roles: ['admin'],
        cargos: { admin: 'Administrador Maestro' },
        granjaId: GRANJA_ID_PREDETERMINADA,
        cargo: 'Administrador Maestro',
        estado: 'activo',
        permisos: PERMISOS_DEFAULT_ADMIN,
        creadoEn: fechaIso,
        actualizadoEn: fechaIso,
        autorizadoPor: ADMIN_MASTER_EMAIL
      };
    }
    return {
      uid: user.uid,
      email: (user.email || '').trim().toLowerCase(),
      displayName: user.displayName || user.email?.split('@')[0] || 'Operario',
      rol: 'operario',
      // Sin conexión con el perfil real no se habilita ninguna función
      roles: [],
      cargos: {},
      granjaId: GRANJA_ID_PREDETERMINADA,
      cargo: 'Operario en espera de asignación',
      estado: 'activo',
      permisos: PERMISOS_DEFAULT_OPERARIO,
      creadoEn: fechaIso,
      actualizadoEn: fechaIso
    };
  }
}

/**
 * Escucha en tiempo real el perfil del usuario con sesión, para que los cambios de roles, nombres
 * de función o estado que haga un administrador se apliquen sin volver a iniciar sesión
 */
export function escucharPerfilPropio(
  uid: string,
  onUpdate: (perfil: UsuarioPerfil) => void,
  onError?: (error: any) => void
): () => void {
  return onSnapshot(
    doc(db, 'usuarios', uid),
    (snap) => {
      if (!snap.exists()) return;
      const perfil = normalizarPerfil(snap.data() as Partial<UsuarioPerfil>, uid);
      guardarCopiaPerfil(perfil);
      onUpdate(perfil);
    },
    (err) => {
      console.warn('Error escuchando el perfil propio:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Escucha en tiempo real los perfiles de usuario de la granja
 */
export function escucharUsuarios(
  onUpdate: (usuarios: UsuarioPerfil[]) => void,
  onError?: (error: any) => void,
  granjaId: string = GRANJA_ID_PREDETERMINADA
): () => void {
  return onSnapshot(
    collection(db, 'usuarios'),
    (snapshot) => {
      const lista: UsuarioPerfil[] = [];
      snapshot.forEach((d) => {
        if (esPerfilSimulado(d.id)) return;
        const perfil = normalizarPerfil(d.data() as Partial<UsuarioPerfil>, d.id);
        if (perfil.granjaId === granjaId || esAdminMaestro(perfil.email)) {
          lista.push(perfil);
        }
      });
      lista.sort((a, b) => {
        if (esAdminMaestro(a.email)) return -1;
        if (esAdminMaestro(b.email)) return 1;
        return a.email.localeCompare(b.email);
      });
      onUpdate(lista);
    },
    (err) => {
      console.error('Error escuchando perfiles de usuario en Firestore:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Campo rol y cargo único equivalentes a una lista de roles, para que las pantallas y reglas que
 * aún leen esos campos sigan funcionando
 */
export function camposCompatibles(
  roles: RolFuncional[],
  cargos: Partial<Record<RolFuncional, string>>,
  cargoAnterior: string
): { rol: RolUsuario; cargo: string } {
  const principal = ordenarRoles(roles)[0];
  return {
    rol: roles.includes('admin') ? 'admin' : 'operario',
    cargo: (principal && cargos[principal]?.trim()) || cargoAnterior
  };
}

/**
 * Permite a un administrador modificar los roles, nombres de función, estado y permisos de un usuario
 * Usa setDoc con merge: true para garantizar que si el documento no existía o fue parcial, se guarde sin fallar.
 */
export async function actualizarPerfilOperario(
  uid: string,
  datos: {
    roles: RolFuncional[];
    cargos: Partial<Record<RolFuncional, string>>;
    cargo: string;
    estado: 'activo' | 'pendiente' | 'inactivo';
    permisos: PermisosUsuario;
  },
  adminEmail: string,
  granjaId: string = GRANJA_ID_PREDETERMINADA
): Promise<void> {
  const roles = ordenarRoles(datos.roles);
  // Solo se guardan los nombres de las funciones asignadas
  const cargos: Partial<Record<RolFuncional, string>> = {};
  for (const r of roles) {
    const nombre = datos.cargos[r]?.trim();
    if (nombre) cargos[r] = nombre.slice(0, 80);
  }
  const { rol, cargo } = camposCompatibles(roles, cargos, datos.cargo.trim());
  // Los permisos de producción solo valen con el rol de operador; sin él quedan en falso
  const permisos =
    rol === 'admin'
      ? PERMISOS_DEFAULT_ADMIN
      : roles.includes('operator')
      ? datos.permisos
      : PERMISOS_DEFAULT_OPERARIO;

  const payload = {
    rol,
    roles,
    cargos,
    granjaId,
    cargo,
    estado: datos.estado,
    permisos,
    autorizadoPor: adminEmail,
    actualizadoEn: new Date().toISOString()
  };

  try {
    // mergeFields reemplaza completos los campos enviados (con merge: true, el mapa cargos
    // conservaría los nombres de funciones retiradas); los demás campos del perfil no se tocan
    await setDoc(doc(db, 'usuarios', uid), payload, { mergeFields: Object.keys(payload) });
  } catch (err: any) {
    console.error('Error al actualizar operario en Firestore:', err);
    throw new Error(
      err?.code === 'permission-denied'
        ? 'No tienes permisos de administrador para guardar cambios de operarios en Firestore.'
        : `No fue posible guardar el perfil: ${err?.message || err}`
    );
  }
}

/**
 * Cambia el estado de un operario entre los 3 estados fundamentales ('activo', 'pendiente', 'inactivo')
 */
export async function cambiarEstadoOperario(
  uid: string,
  nuevoEstado: 'activo' | 'pendiente' | 'inactivo',
  adminEmail: string,
  datosBase?: Partial<UsuarioPerfil>
): Promise<void> {
  try {
    const payload: Record<string, any> = {
      estado: nuevoEstado,
      autorizadoPor: adminEmail,
      actualizadoEn: new Date().toISOString()
    };
    if (datosBase?.granjaId) payload.granjaId = datosBase.granjaId;
    if (datosBase?.rol) payload.rol = datosBase.rol;
    if (datosBase?.roles) payload.roles = ordenarRoles(datosBase.roles);
    if (datosBase?.cargos) payload.cargos = datosBase.cargos;
    if (datosBase?.cargo) payload.cargo = datosBase.cargo;
    if (datosBase?.permisos) payload.permisos = datosBase.permisos;
    if (datosBase?.email) payload.email = datosBase.email;
    if (datosBase?.displayName) payload.displayName = datosBase.displayName;

    await setDoc(doc(db, 'usuarios', uid), payload, { merge: true });
  } catch (err: any) {
    console.error('Error cambiando estado del operario:', err);
    throw new Error(`Error al actualizar estado: ${err?.message || err}`);
  }
}

/**
 * Elimina un perfil de operario en Firestore
 */
export async function eliminarPerfilUsuario(uid: string): Promise<void> {
  const { deleteDoc } = await import('firebase/firestore');
  try {
    await deleteDoc(doc(db, 'usuarios', uid));
  } catch (err: any) {
    console.error('Error eliminando usuario de Firestore:', err);
    throw new Error(`Error al eliminar usuario: ${err?.message || err}`);
  }
}
