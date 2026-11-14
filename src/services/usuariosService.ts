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
  verInicio: true,
  verLotes: true,
  buscarLotes: true,
  corregirSiembra: true,
  descargarDocumentosLote: true,
  verEntregas: true,
  decidirSaldos: true,
  gestionarComprobantes: true,
  atenderNovedades: true,
  verAnalitica: true,
  exportarAnalitica: true,
  verConfiguracion: true,
  proponerAnotaciones: true,
  aprobarAnotaciones: true
};

export const PERMISOS_DEFAULT_OPERARIO: PermisosUsuario = {
  crearLotes: false,
  registrarEventos: false,
  cerrarLotes: false,
  gestionarEstanques: false,
  gestionarConfiguracion: false,
  administrarUsuarios: false,
  gestionarPedidos: false,
  verInicio: false,
  verLotes: false,
  buscarLotes: false,
  corregirSiembra: false,
  descargarDocumentosLote: false,
  verEntregas: false,
  decidirSaldos: false,
  gestionarComprobantes: false,
  atenderNovedades: false,
  verAnalitica: false,
  exportarAnalitica: false,
  verConfiguracion: false,
  proponerAnotaciones: false,
  aprobarAnotaciones: false
};

// Permisos que existían antes de los permisos por pestaña
const PERMISOS_BASE_ANTERIORES: PermisosUsuario = {
  crearLotes: false,
  registrarEventos: false,
  cerrarLotes: false,
  gestionarEstanques: false,
  gestionarConfiguracion: false,
  administrarUsuarios: false,
  gestionarPedidos: false
};

// Si un perfil anterior no tiene un permiso por pestaña, toma este valor (true = visible como hasta
// ahora; un nombre = el permiso del que se desprende). Igual que en las reglas de Firestore.
export const HERENCIA_PERMISOS: Partial<Record<keyof PermisosUsuario, true | keyof PermisosUsuario>> = {
  verInicio: true,
  verLotes: true,
  buscarLotes: true,
  descargarDocumentosLote: true,
  corregirSiembra: 'crearLotes',
  verEntregas: 'gestionarPedidos',
  decidirSaldos: 'gestionarPedidos',
  gestionarComprobantes: 'gestionarPedidos',
  atenderNovedades: 'gestionarPedidos',
  verAnalitica: true,
  exportarAnalitica: true,
  verConfiguracion: true
};

// Permisos agrupados por pestaña (para la pantalla de Personal & Permisos y la visibilidad de pestañas)
export interface GrupoPermisos {
  pestana: 'inicio' | 'lotes' | 'pedidos' | 'analitica' | 'configuracion';
  titulo: string;
  ver: keyof PermisosUsuario | null; // permiso de ver la pestaña (casilla general)
  acciones: { clave: keyof PermisosUsuario; etiqueta: string; detalle: string }[];
}

export const GRUPOS_PERMISOS: GrupoPermisos[] = [
  {
    pestana: 'inicio',
    titulo: 'Inicio',
    ver: 'verInicio',
    acciones: [{ clave: 'crearLotes', etiqueta: 'Registrar nuevo lote', detalle: 'Crear lotes y registrar la siembra' }]
  },
  {
    pestana: 'lotes',
    titulo: 'Lotes',
    ver: 'verLotes',
    acciones: [
      { clave: 'buscarLotes', etiqueta: 'Buscar y filtrar', detalle: 'Buscador y filtros de la lista de lotes' },
      { clave: 'registrarEventos', etiqueta: 'Registrar eventos', detalle: 'Agua, alimentación, biometría, cosecha...' },
      { clave: 'corregirSiembra', etiqueta: 'Corregir siembra / piscina', detalle: 'Queda como evento de corrección' },
      { clave: 'cerrarLotes', etiqueta: 'Cerrar y sellar', detalle: 'Cosecha final y sellado del lote' },
      { clave: 'descargarDocumentosLote', etiqueta: 'Descargar PDF y QR', detalle: 'Certificado, etiqueta QR y vista pública' },
      { clave: 'proponerAnotaciones', etiqueta: 'Proponer anotaciones', detalle: 'Correcciones a un lote sellado, con motivo' },
      { clave: 'aprobarAnotaciones', etiqueta: 'Aprobar anotaciones', detalle: 'Aprueba o rechaza propuestas de otra persona' }
    ]
  },
  {
    pestana: 'pedidos',
    titulo: 'Entregas',
    ver: 'verEntregas',
    acciones: [
      { clave: 'gestionarPedidos', etiqueta: 'Crear y asignar órdenes', detalle: 'Clientes, reservas, repartidor y estados' },
      { clave: 'decidirSaldos', etiqueta: 'Decidir saldos y corregir entregas', detalle: 'Reprogramar, liberar saldo, corregir cantidades' },
      { clave: 'gestionarComprobantes', etiqueta: 'Emitir y anular comprobantes', detalle: 'Documentación de entrega' },
      { clave: 'atenderNovedades', etiqueta: 'Atender novedades y ajustes', detalle: 'Novedades del repartidor y solicitudes de ajuste' }
    ]
  },
  {
    pestana: 'analitica',
    titulo: 'Analítica',
    ver: 'verAnalitica',
    acciones: [{ clave: 'exportarAnalitica', etiqueta: 'Exportar datos', detalle: 'Descargar los datos en CSV' }]
  },
  {
    pestana: 'configuracion',
    titulo: 'Configuración',
    ver: 'verConfiguracion',
    acciones: [
      { clave: 'gestionarEstanques', etiqueta: 'Estanques', detalle: 'Crear y modificar piscinas' },
      { clave: 'gestionarConfiguracion', etiqueta: 'Rangos de agua y ficha nutricional', detalle: 'Límites y ficha del producto' }
    ]
  }
];

/**
 * Valor efectivo de un permiso guardado (con la herencia de los perfiles anteriores)
 */
export function valorPermiso(permisos: Partial<PermisosUsuario> | undefined, clave: keyof PermisosUsuario): boolean {
  const p = permisos || {};
  if (typeof p[clave] === 'boolean') return p[clave] as boolean;
  const h = HERENCIA_PERMISOS[clave];
  if (h === true) return true;
  if (h) return Boolean(p[h]);
  return false;
}

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
  const cargo = data.cargo || (esAdmin ? 'Administrador' : 'Operario en espera de asignación');
  const roles = rolesDesdeDatos(data, esAdmin);
  // Sin nombres por función guardados, el cargo único anterior queda como nombre de su rol principal
  const cargos = data.cargos && typeof data.cargos === 'object'
    ? { ...data.cargos }
    : data.cargo && roles.length ? { [roles[0]]: data.cargo } : {};
  return {
    ...data,
    uid,
    email,
    displayName: data.displayName || email.split('@')[0] || (esAdmin ? 'Administrador' : 'Operario'),
    rol: data.rol || (esAdmin ? 'admin' : 'operario'),
    roles,
    cargos,
    granjaId: data.granjaId || GRANJA_ID_PREDETERMINADA,
    cargo,
    estado: esAdmin ? 'activo' : (data.estado || 'pendiente'),
    // Solo se completan los permisos originales: los permisos por pestaña que falten se resuelven por
    // herencia (valorPermiso), igual que en las reglas
    permisos: esAdmin ? PERMISOS_DEFAULT_ADMIN : { ...PERMISOS_BASE_ANTERIORES, ...(data.permisos || {}) },
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
  return valorPermiso(perfil.permisos, permiso);
}

/**
 * La persona ve la pestaña si tiene su permiso de ver o alguna de sus acciones
 */
export function veePestana(perfil: UsuarioPerfil | null, pestana: GrupoPermisos['pestana']): boolean {
  const g = GRUPOS_PERMISOS.find((x) => x.pestana === pestana);
  if (!g) return false;
  return (g.ver ? verificarPermiso(perfil, g.ver) : false) || g.acciones.some((a) => verificarPermiso(perfil, a.clave));
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
      displayName: user.displayName || user.email?.split('@')[0] || (esAdmin ? 'Administrador' : 'Operario'),
      rol: esAdmin ? 'admin' : 'operario',
      // Un usuario nuevo no tiene funciones hasta que un administrador se las asigne
      roles: esAdmin ? ['admin'] : [],
      cargos: esAdmin ? { admin: 'Administrador' } : {},
      granjaId: GRANJA_ID_PREDETERMINADA,
      cargo: esAdmin ? 'Administrador' : 'Operario en espera de asignación',
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
        displayName: 'Administrador',
        rol: 'admin',
        roles: ['admin'],
        cargos: { admin: 'Administrador' },
        granjaId: GRANJA_ID_PREDETERMINADA,
        cargo: 'Administrador',
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
    displayName?: string;
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
    ...(datos.displayName && datos.displayName.trim() ? { displayName: datos.displayName.trim().slice(0, 60) } : {}),
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
        ? 'No tienes permisos de administrador para guardar cambios de operarios.'
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

// ---------- Nombre visible de quien registra ----------
let nombreSesionActual = '';

/**
 * La app fija el nombre visible de la cuenta con sesión; los registros nuevos lo guardan junto al correo
 */
export function establecerNombreSesion(nombre: string | null | undefined): void {
  nombreSesionActual = (nombre || '').trim().slice(0, 60);
}

/**
 * Campo para agregar a un registro nuevo: el nombre visible de quien lo hace (si lo tiene)
 */
export function nombreRegistro(): { registradoPorNombre?: string } {
  return nombreSesionActual ? { registradoPorNombre: nombreSesionActual } : {};
}

/**
 * Quién registró un evento: el nombre si se guardó; si no (registros anteriores), el correo, oculto
 * en lo público (QR y PDF) y completo en las pantallas internas
 */
export function quienRegistro(ev: { registradoPor?: string; registradoPorNombre?: string }, publico = false): string {
  if (ev.registradoPorNombre) return ev.registradoPorNombre;
  if (!ev.registradoPor) return '—';
  if (!publico) return ev.registradoPor;
  const [usuario, dominio] = ev.registradoPor.split('@');
  return dominio ? `${usuario.slice(0, 2)}•••@${dominio}` : usuario.slice(0, 2) + '•••';
}
