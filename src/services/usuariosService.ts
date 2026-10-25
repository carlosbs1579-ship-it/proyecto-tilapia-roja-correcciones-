import { doc, getDoc, setDoc, updateDoc, collection, onSnapshot } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '../firebase/firebaseConfig';
import { UsuarioPerfil, PermisosUsuario, RolUsuario, ADMIN_MASTER_EMAIL } from '../types';
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
};

export const PERMISOS_DEFAULT_OPERARIO: PermisosUsuario = {
  crearLotes: false,
  registrarEventos: false,
  cerrarLotes: false,
  gestionarEstanques: false,
  gestionarConfiguracion: false,
  administrarUsuarios: false,
};

/**
 * Indica si un ID de documento corresponde a un perfil creado por las sesiones simuladas de
 * versiones anteriores (sin cuenta real en Firebase Authentication)
 */
function esPerfilSimulado(uid: string): boolean {
  return uid === 'admin_carlos_master' || uid.startsWith('op_');
}

/**
 * Completa en memoria los campos que los perfiles antiguos no tienen (rol, granjaId, permisos)
 */
export function normalizarPerfil(data: Partial<UsuarioPerfil>, uid: string): UsuarioPerfil {
  const email = (data.email || '').trim().toLowerCase();
  const esAdmin = esAdminMaestro(email);
  return {
    ...data,
    uid,
    email,
    displayName: data.displayName || email.split('@')[0] || (esAdmin ? 'Carlos' : 'Operario'),
    rol: data.rol || (esAdmin ? 'admin' : 'operario'),
    granjaId: data.granjaId || GRANJA_ID_PREDETERMINADA,
    cargo: data.cargo || (esAdmin ? 'Administrador Maestro' : 'Operario en espera de asignación'),
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
 * Verifica si un perfil cuenta con un permiso específico
 */
export function verificarPermiso(
  perfil: UsuarioPerfil | null,
  permiso: keyof PermisosUsuario
): boolean {
  if (!perfil) return false;
  if (esAdministrador(perfil)) return true;
  if (perfil.estado !== 'activo' || perfil.rol === 'consulta') return false;
  return Boolean(perfil.permisos && perfil.permisos[permiso]);
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
      if (!esAdmin) return perfil;

      // El Administrador Maestro siempre conserva el rol de administrador y todos los permisos
      const perfilAdmin: UsuarioPerfil = {
        ...perfil,
        rol: 'admin',
        estado: 'activo',
        permisos: PERMISOS_DEFAULT_ADMIN,
        actualizadoEn: fechaIso
      };
      await setDoc(userRef, {
        rol: perfilAdmin.rol,
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
    // Si Carlos ingresó, generar perfil maestro en memoria como contingencia para no bloquear su sesión
    if (esAdmin) {
      return {
        uid: user.uid,
        email: user.email || ADMIN_MASTER_EMAIL,
        displayName: 'Carlos',
        rol: 'admin',
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
 * Permite a un administrador modificar el rol, cargo, estado y permisos de un usuario
 * Usa setDoc con merge: true para garantizar que si el documento no existía o fue parcial, se guarde sin fallar.
 */
export async function actualizarPerfilOperario(
  uid: string,
  datos: {
    rol: RolUsuario;
    cargo: string;
    estado: 'activo' | 'pendiente' | 'inactivo';
    permisos: PermisosUsuario;
  },
  adminEmail: string,
  granjaId: string = GRANJA_ID_PREDETERMINADA
): Promise<void> {
  const permisos =
    datos.rol === 'consulta'
      ? PERMISOS_DEFAULT_OPERARIO
      : datos.rol === 'admin'
      ? PERMISOS_DEFAULT_ADMIN
      : datos.permisos;

  const payload = {
    rol: datos.rol,
    granjaId,
    cargo: datos.cargo.trim(),
    estado: datos.estado,
    permisos,
    autorizadoPor: adminEmail,
    actualizadoEn: new Date().toISOString()
  };

  try {
    await setDoc(doc(db, 'usuarios', uid), payload, { merge: true });
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
