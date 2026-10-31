import React, { useState, useEffect } from 'react';
import {
  Users,
  ShieldCheck,
  Shield,
  UserCheck,
  UserX,
  Clock,
  Save,
  CheckCircle,
  AlertCircle,
  Check,
  User as UserIcon,
  Crown,
  Lock,
  Sparkles,
  RefreshCw,
  Search,
  Filter,
  Trash2,
  X
} from 'lucide-react';
import {
  UsuarioPerfil,
  PermisosUsuario,
  RolFuncional,
  ROLES_FUNCIONALES,
  ADMIN_MASTER_EMAIL
} from '../types';
import {
  esAdminMaestro,
  esAdministrador,
  escucharUsuarios,
  actualizarPerfilOperario,
  cambiarEstadoOperario,
  eliminarPerfilUsuario,
  ordenarRoles,
  nombreFuncion,
  funcionesDisponibles,
  ETIQUETA_ROL,
  PERMISOS_DEFAULT_ADMIN,
  PERMISOS_DEFAULT_OPERARIO
} from '../services/usuariosService';

type EdicionUsuario = {
  roles: RolFuncional[];
  cargos: Partial<Record<RolFuncional, string>>;
  cargo: string;
  estado: 'activo' | 'pendiente' | 'inactivo';
  permisos: PermisosUsuario;
};

// Nombres sugeridos para cada función. Son solo nombres visibles: no cambian los permisos.
const SUGERENCIAS_CARGO: Partial<Record<RolFuncional, { etiqueta: string; valor: string }[]>> = {
  operator: [
    { etiqueta: 'Alimentación & Biometría', valor: 'Técnico de Alimentación y Biometría' },
    { etiqueta: 'Siembra & Cosecha', valor: 'Encargado de Siembra y Cosecha' },
    { etiqueta: 'Calidad de Agua', valor: 'Biólogo de Calidad de Agua' }
  ],
  courier: [
    { etiqueta: 'Repartidor jefe', valor: 'Repartidor jefe' },
    { etiqueta: 'Auxiliar de distribución', valor: 'Auxiliar de distribución' }
  ]
};

const DESCRIPCION_ROL: Record<RolFuncional, string> = {
  admin: 'Gestiona personal y configuración; acceso completo a producción',
  operator: 'Producción según los permisos marcados abajo',
  courier: 'Panel de reparto; sin acceso a la información productiva'
};

function edicionDesdePerfil(u: UsuarioPerfil): EdicionUsuario {
  return {
    roles: [...u.roles],
    cargos: { ...u.cargos },
    cargo: u.cargo || '',
    estado: u.estado,
    permisos: { ...u.permisos }
  };
}

interface UsuariosTabProps {
  userEmail: string;
  perfilActual: UsuarioPerfil | null;
  gestionHabilitada?: boolean; // false si la cuenta trabaja ahora con una función distinta de administrador
}

export const UsuariosTab: React.FC<UsuariosTabProps> = ({
  userEmail,
  perfilActual,
  gestionHabilitada = true
}) => {
  const esAdmin = (esAdminMaestro(userEmail) || esAdministrador(perfilActual)) && gestionHabilitada;
  const soyMaestro = esAdminMaestro(userEmail);

  // Quién puede editar a quién (las reglas de Firestore aplican lo mismo):
  // - el perfil del Administrador Maestro solo lo edita él mismo;
  // - nadie más edita su propio perfil;
  // - a otros administradores los edita solo el Administrador Maestro.
  const puedeEditarPerfil = (u: UsuarioPerfil): boolean => {
    if (esAdminMaestro(u.email)) return soyMaestro;
    if (u.uid === perfilActual?.uid) return false;
    if (u.rol === 'admin') return soyMaestro;
    return true;
  };

  const [usuarios, setUsuarios] = useState<UsuarioPerfil[]>([]);
  const [usuariosCargando, setUsuariosCargando] = useState(true);
  const [edicionUsuarios, setEdicionUsuarios] = useState<Record<string, EdicionUsuario>>({});
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [guardandoTodos, setGuardandoTodos] = useState(false);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [usuarioAEliminar, setUsuarioAEliminar] = useState<string | null>(null);

  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'activo' | 'pendiente' | 'inactivo'>('todos');

  // Escuchar usuarios en tiempo real
  useEffect(() => {
    if (!esAdmin) {
      // Sin gestión habilitada no queda en pantalla la lista de una sesión anterior
      setUsuarios([]);
      setEdicionUsuarios({});
      return;
    }
    setUsuariosCargando(true);
    const unsubscribe = escucharUsuarios(
      (lista) => {
        setUsuarios(lista);
        setUsuariosCargando(false);
        // Sincronizar mapa de edición respetando cambios no guardados
        setEdicionUsuarios((prev) => {
          const mapa: Record<string, EdicionUsuario> = { ...prev };
          for (const u of lista) {
            if (!mapa[u.uid]) {
              mapa[u.uid] = edicionDesdePerfil(u);
            }
          }
          return mapa;
        });
      },
      (err) => {
        console.warn('Error al escuchar perfiles de usuarios:', err);
        setErrorMsg('Error al conectar con la lista de usuarios en Firestore.');
        setUsuariosCargando(false);
      }
    );
    return () => unsubscribe();
  }, [esAdmin]);

  // Cambia el nombre visible de UNA función del usuario; no altera sus roles ni permisos
  const handleCambioCargo = (uid: string, rol: RolFuncional, nuevoCargo: string) => {
    setEdicionUsuarios((prev) => ({
      ...prev,
      [uid]: {
        ...prev[uid],
        cargos: { ...prev[uid]?.cargos, [rol]: nuevoCargo }
      }
    }));
  };

  // Asigna o retira un rol funcional
  const handleToggleRol = (uid: string, rol: RolFuncional) => {
    setEdicionUsuarios((prev) => {
      const editActual = prev[uid];
      const tenia = editActual.roles.includes(rol);
      const roles = ordenarRoles(tenia ? editActual.roles.filter((r) => r !== rol) : [...editActual.roles, rol]);
      let permisos = editActual.permisos;
      if (rol === 'admin') permisos = tenia ? PERMISOS_DEFAULT_OPERARIO : PERMISOS_DEFAULT_ADMIN;
      return {
        ...prev,
        [uid]: { ...editActual, roles, permisos }
      };
    });
  };

  // Cambio directo de estado entre los 3 estados: activo, pendiente, inactivo
  const handleCambioEstado = async (u: UsuarioPerfil, nuevoEstado: 'activo' | 'pendiente' | 'inactivo') => {
    // Actualizar estado local
    setEdicionUsuarios((prev) => ({
      ...prev,
      [u.uid]: {
        ...(prev[u.uid] || edicionDesdePerfil(u)),
        estado: nuevoEstado
      }
    }));

    // Persistir de inmediato en Firestore
    setGuardandoId(u.uid);
    setErrorMsg(null);
    setMensajeExito(null);

    try {
      await cambiarEstadoOperario(u.uid, nuevoEstado, userEmail, u);
      const etiqueta = nuevoEstado === 'activo' ? 'Activo' : nuevoEstado === 'pendiente' ? 'Pendiente' : 'Inactivo';
      setMensajeExito(`Estado de "${u.displayName || u.email}" actualizado a ${etiqueta}.`);
      setTimeout(() => setMensajeExito(null), 3500);
    } catch (err: any) {
      console.error('Error al actualizar estado:', err);
      setErrorMsg(err.message || 'Error al actualizar estado en Firestore.');
    } finally {
      setGuardandoId(null);
    }
  };

  const handleTogglePermiso = (uid: string, permiso: keyof PermisosUsuario) => {
    setEdicionUsuarios((prev) => {
      const actual = prev[uid]?.permisos || PERMISOS_DEFAULT_OPERARIO;
      return {
        ...prev,
        [uid]: {
          ...prev[uid],
          permisos: {
            ...actual,
            [permiso]: !actual[permiso]
          }
        }
      };
    });
  };

  // Las plantillas de producción dejan al usuario como operador (sin tocar su función de repartidor);
  // "Total" lo convierte en administrador y solo la ve el Administrador Maestro
  const aplicarPreset = (uid: string, preset: 'siembra' | 'cosecha' | 'total' | 'lectura') => {
    let nuevosPermisos: PermisosUsuario;
    const rolesActuales = edicionUsuarios[uid]?.roles || [];
    // Las plantillas de producción no tocan el permiso de pedidos que ya tenga
    const gestionarPedidos = Boolean(edicionUsuarios[uid]?.permisos?.gestionarPedidos);
    let roles: RolFuncional[] = ordenarRoles([...rolesActuales.filter((r) => r !== 'admin'), 'operator']);

    switch (preset) {
      case 'total':
        nuevosPermisos = { ...PERMISOS_DEFAULT_ADMIN };
        roles = ordenarRoles(['admin', ...rolesActuales]);
        break;
      case 'siembra':
        nuevosPermisos = {
          crearLotes: true,
          registrarEventos: true,
          cerrarLotes: false,
          gestionarEstanques: false,
          gestionarConfiguracion: false,
          administrarUsuarios: false,
          gestionarPedidos
        };
        break;
      case 'cosecha':
        nuevosPermisos = {
          crearLotes: false,
          registrarEventos: true,
          cerrarLotes: true,
          gestionarEstanques: false,
          gestionarConfiguracion: false,
          administrarUsuarios: false,
          gestionarPedidos
        };
        break;
      case 'lectura':
        nuevosPermisos = { ...PERMISOS_DEFAULT_OPERARIO };
        break;
    }

    setEdicionUsuarios((prev) => ({
      ...prev,
      [uid]: {
        ...prev[uid],
        roles,
        permisos: nuevosPermisos
      }
    }));
  };

  // Guardar un usuario individual
  const handleGuardarUsuario = async (u: UsuarioPerfil) => {
    const edit = edicionUsuarios[u.uid];
    if (!edit) return;

    setGuardandoId(u.uid);
    setErrorMsg(null);
    setMensajeExito(null);

    try {
      await actualizarPerfilOperario(u.uid, edit, userEmail);
      setMensajeExito(`Perfil y permisos de "${u.displayName || u.email}" guardados y sincronizados en Firestore.`);
      setTimeout(() => setMensajeExito(null), 4000);
    } catch (err: any) {
      console.error('Error guardando usuario:', err);
      setErrorMsg(err.message || 'Error al guardar usuario en Firestore.');
    } finally {
      setGuardandoId(null);
    }
  };

  // Eliminar usuario
  const handleConfirmarEliminarUsuario = async (uid: string, email: string) => {
    setUsuarioAEliminar(null);
    setGuardandoId(uid);
    setErrorMsg(null);
    setMensajeExito(null);

    try {
      await eliminarPerfilUsuario(uid);
      setMensajeExito(`Usuario "${email}" retirado exitosamente del sistema.`);
      setTimeout(() => setMensajeExito(null), 4000);
    } catch (err: any) {
      console.error('Error eliminando usuario:', err);
      setErrorMsg(err.message || 'Error al eliminar usuario en Firestore.');
    } finally {
      setGuardandoId(null);
    }
  };

  // Guardar todos los perfiles modificados
  const handleGuardarTodos = async () => {
    setGuardandoTodos(true);
    setErrorMsg(null);
    setMensajeExito(null);

    try {
      let guardados = 0;
      for (const u of usuarios) {
        if (esAdminMaestro(u.email) || !puedeEditarPerfil(u)) continue;
        const edit = edicionUsuarios[u.uid];
        if (edit) {
          await actualizarPerfilOperario(u.uid, edit, userEmail);
          guardados++;
        }
      }
      setMensajeExito(`Se guardaron exitosamente ${guardados} perfiles en Firestore.`);
      setTimeout(() => setMensajeExito(null), 4000);
    } catch (err: any) {
      console.error('Error guardando perfiles:', err);
      setErrorMsg(err.message || 'Error al guardar perfiles.');
    } finally {
      setGuardandoTodos(false);
    }
  };

  // Conteos
  const totalUsuarios = usuarios.length;
  const activos = usuarios.filter((u) => u.estado === 'activo').length;
  const pendientes = usuarios.filter((u) => u.estado === 'pendiente' && !esAdminMaestro(u.email)).length;
  const inactivos = usuarios.filter((u) => u.estado === 'inactivo').length;

  const usuariosFiltrados = usuarios.filter((u) => {
    if (filtroEstado !== 'todos' && u.estado !== filtroEstado) return false;
    if (filtroTexto.trim()) {
      const q = filtroTexto.toLowerCase();
      const matchEmail = u.email.toLowerCase().includes(q);
      const matchName = (u.displayName || '').toLowerCase().includes(q);
      const matchCargo = [u.cargo, ...Object.values(u.cargos || {})].some((c) => (c || '').toLowerCase().includes(q));
      if (!matchEmail && !matchName && !matchCargo) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Encabezado Principal de la Pestaña */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <Users className="w-5 h-5 text-sky-600" />
            <span>Gestión de Personal & Permisos</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Autorización de operarios, asignación de cargos laborales y matriz de permisos por rol
          </p>
        </div>

        {esAdmin && (
          <div className="flex items-center space-x-2">
            <button
              onClick={handleGuardarTodos}
              disabled={guardandoTodos || usuarios.length === 0}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-xs transition-colors disabled:opacity-50 shrink-0"
            >
              {guardandoTodos ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Sincronizando perfiles...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Guardar Todos los Cambios</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {mensajeExito && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center space-x-2 text-emerald-800 text-xs shadow-xs animate-fadeIn">
          <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
          <span className="font-medium">{mensajeExito}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-300 rounded-xl flex items-center space-x-2 text-red-800 text-xs shadow-xs animate-fadeIn">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span className="font-medium">{errorMsg}</span>
        </div>
      )}

      {/* TARJETAS DE ESTADÍSTICAS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-medium text-slate-500 block">Total Usuarios</span>
          <strong className="text-lg font-bold text-slate-900 mt-0.5 block">{totalUsuarios}</strong>
          <span className="text-[10px] text-slate-400">Registrados en la app</span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-emerald-200 shadow-xs bg-emerald-50/20">
          <span className="text-[11px] font-medium text-emerald-700 block">🟢 Cuentas Activas</span>
          <strong className="text-lg font-bold text-emerald-700 mt-0.5 block">{activos}</strong>
          <span className="text-[10px] text-emerald-600/80">Acceso a lotes</span>
        </div>

        <div className={`p-3.5 rounded-xl border shadow-xs transition-all ${
          pendientes > 0
            ? 'bg-amber-50 border-amber-300 text-amber-900 ring-2 ring-amber-400/40'
            : 'bg-white border-slate-200 text-slate-700'
        }`}>
          <span className="text-[11px] font-bold block">
            🟡 Pendientes de Aprobación
          </span>
          <strong className="text-lg font-bold mt-0.5 block">{pendientes}</strong>
          <span className="text-[10px]">
            {pendientes > 0 ? 'Esperando tu autorización' : 'Sin pendientes'}
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-medium text-slate-500 block">🔴 Inactivos</span>
          <strong className="text-lg font-bold text-slate-700 mt-0.5 block">{inactivos}</strong>
          <span className="text-[10px] text-slate-400">Sin acceso</span>
        </div>
      </div>

      {/* CONTENIDO PRINCIPAL */}
      {esAdmin ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-5">
          {/* Barra de Filtros y Búsqueda */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar por correo, nombre o cargo..."
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <div className="flex items-center rounded-lg border border-slate-200 p-0.5 text-xs bg-slate-50">
                <button
                  type="button"
                  onClick={() => setFiltroEstado('todos')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filtroEstado === 'todos' ? 'bg-white shadow-xs text-sky-700 font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Todos ({totalUsuarios})
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroEstado('activo')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filtroEstado === 'activo' ? 'bg-white shadow-xs text-emerald-700 font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Activos ({activos})
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroEstado('pendiente')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filtroEstado === 'pendiente' ? 'bg-white shadow-xs text-amber-700 font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Pendientes ({pendientes})
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroEstado('inactivo')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filtroEstado === 'inactivo' ? 'bg-white shadow-xs text-slate-700 font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Inactivos ({inactivos})
                </button>
              </div>
            </div>
          </div>

          {/* LISTA DE USUARIOS */}
          {usuariosCargando ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-2 text-xs text-slate-500">
              <div className="w-6 h-6 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
              <span>Cargando lista de operarios desde Firestore...</span>
            </div>
          ) : usuariosFiltrados.length === 0 ? (
            <div className="p-8 bg-slate-50 rounded-xl text-center space-y-2 text-xs text-slate-500 border border-slate-200">
              <Users className="w-8 h-8 mx-auto text-slate-400" />
              <p className="font-semibold text-slate-700">No se encontraron operarios con el filtro seleccionado</p>
              <p>Los operarios aparecerán automáticamente aquí una vez inicien sesión en la aplicación.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {usuariosFiltrados.map((u) => {
                const esElAdmin = esAdminMaestro(u.email);
                const ed = edicionUsuarios[u.uid] || edicionDesdePerfil(u);
                const esGuardando = guardandoId === u.uid;
                const editable = puedeEditarPerfil(u);
                // Los permisos de producción solo se marcan para operadores que no son administradores
                const bloqueoPermisos =
                  !editable || esElAdmin || ed.roles.includes('admin') || !ed.roles.includes('operator');

                return (
                  <div
                    key={u.uid}
                    className={`rounded-xl border p-4 transition-all ${
                      esElAdmin
                        ? 'bg-sky-50/70 border-sky-300'
                        : ed.estado === 'pendiente'
                        ? 'bg-amber-50/50 border-amber-300 ring-1 ring-amber-300/60'
                        : ed.estado === 'activo'
                        ? 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                        : 'bg-slate-50 border-slate-200 opacity-80'
                    }`}
                  >
                    {/* CABECERA DEL USUARIO */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                      <div className="flex items-center space-x-3">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                            esElAdmin
                              ? 'bg-amber-500 text-white shadow-xs'
                              : ed.estado === 'activo'
                              ? 'bg-sky-600 text-white'
                              : 'bg-slate-300 text-slate-700'
                          }`}
                        >
                          {esElAdmin ? <Crown className="w-5 h-5 text-amber-200" /> : <UserIcon className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-sm text-slate-900">{u.displayName || u.email.split('@')[0]}</span>
                            <span className="text-xs text-slate-500 font-mono">({u.email})</span>
                            {esElAdmin ? (
                              <span className="text-[10px] bg-amber-100 text-amber-900 font-bold px-2.5 py-0.5 rounded-full border border-amber-300 flex items-center space-x-1">
                                <Crown className="w-3 h-3 text-amber-600" />
                                <span>PROPIETARIO / MASTER ADMIN</span>
                              </span>
                            ) : (
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                  ed.estado === 'activo'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : ed.estado === 'pendiente'
                                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                    : 'bg-slate-200 text-slate-700'
                                }`}
                              >
                                {ed.estado === 'activo' ? '🟢 Activo' : ed.estado === 'pendiente' ? '🟡 Pendiente' : '🔴 Inactivo'}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            UID: <span className="font-mono">{u.uid.substring(0, 16)}...</span> • Registrado:{' '}
                            {u.creadoEn ? u.creadoEn.substring(0, 10) : 'Fecha inicial'}
                          </p>
                        </div>
                      </div>

                      {/* SELECTOR DE ESTADO */}
                      {!esElAdmin && (
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Estado: 3 estados estándar */}
                          <div className="flex items-center space-x-1">
                            <label className="text-[11px] font-semibold text-slate-600">Estado:</label>
                            <select
                              value={ed.estado}
                              disabled={esGuardando || !editable}
                              onChange={(e) => handleCambioEstado(u, e.target.value as any)}
                              className={`px-2.5 py-1 text-xs font-bold rounded-lg border focus:outline-none focus:ring-2 focus:ring-sky-500 transition-colors ${
                                ed.estado === 'activo'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold'
                                  : ed.estado === 'pendiente'
                                  ? 'bg-amber-50 text-amber-800 border-amber-300 font-bold'
                                  : 'bg-slate-100 text-slate-700 border-slate-300 font-bold'
                              }`}
                            >
                              <option value="activo">🟢 Activo</option>
                              <option value="pendiente">🟡 Pendiente</option>
                              <option value="inactivo">🔴 Inactivo</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>

                    {!editable && (
                      <p className="mt-3 text-[11px] text-slate-500 flex items-center space-x-1">
                        <Lock className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {u.uid === perfilActual?.uid
                            ? 'No puedes modificar tus propias funciones ni permisos.'
                            : esElAdmin
                            ? 'El perfil del Administrador Maestro solo lo modifica él mismo.'
                            : 'Solo el Administrador Maestro puede modificar a otros administradores.'}
                        </span>
                      </p>
                    )}

                    {/* FUNCIONES (ROLES) Y NOMBRE VISIBLE DE CADA UNA */}
                    <div className="mt-3">
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        Funciones asignadas y nombre visible de cada una:
                      </label>
                      <p className="text-[10px] text-slate-400 mb-2">
                        La función determina los permisos. El nombre visible es solo cómo se muestra en la plataforma y puede cambiarse sin alterar los permisos.
                      </p>
                      <div className="space-y-2">
                        {ROLES_FUNCIONALES.map((rol) => {
                          const asignado = ed.roles.includes(rol);
                          // El rol de administrador solo lo otorga o retira el Administrador Maestro,
                          // y el suyo propio no se puede quitar
                          const rolBloqueado =
                            !editable || esGuardando || (rol === 'admin' && (!soyMaestro || esElAdmin));
                          return (
                            <div
                              key={rol}
                              className={`p-2 rounded-lg border text-xs ${
                                asignado ? 'bg-sky-50 border-sky-300' : 'bg-slate-50 border-slate-200'
                              }`}
                            >
                              <label className={`flex items-start space-x-2 ${rolBloqueado ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                                <input
                                  type="checkbox"
                                  disabled={rolBloqueado}
                                  checked={asignado}
                                  onChange={() => handleToggleRol(u.uid, rol)}
                                  className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                                />
                                <div>
                                  <span className={asignado ? 'font-semibold text-sky-950' : 'text-slate-600'}>
                                    {ETIQUETA_ROL[rol]}
                                  </span>
                                  <p className="text-[10px] text-slate-400 font-normal">{DESCRIPCION_ROL[rol]}</p>
                                </div>
                              </label>

                              {asignado && (
                                <div className="mt-2 pl-6 space-y-1">
                                  <input
                                    type="text"
                                    disabled={!editable || esGuardando}
                                    maxLength={80}
                                    placeholder={`Nombre visible como ${ETIQUETA_ROL[rol].toLowerCase()} (ej: ${
                                      SUGERENCIAS_CARGO[rol]?.[0]?.valor || 'Coordinador de producción'
                                    })`}
                                    value={ed.cargos[rol] || ''}
                                    onChange={(e) => handleCambioCargo(u.uid, rol, e.target.value)}
                                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white font-medium text-slate-800 disabled:bg-slate-100"
                                  />
                                  {editable && SUGERENCIAS_CARGO[rol] && (
                                    <div className="flex flex-wrap gap-1 text-[10px]">
                                      <span className="text-slate-400 mr-1">Sugerencias:</span>
                                      {SUGERENCIAS_CARGO[rol]!.map((s) => (
                                        <button
                                          key={s.valor}
                                          type="button"
                                          onClick={() => handleCambioCargo(u.uid, rol, s.valor)}
                                          className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
                                        >
                                          {s.etiqueta}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {ed.roles.length === 0 && (
                        <p className="mt-2 text-[11px] text-amber-700">
                          Sin funciones asignadas: aunque la cuenta esté activa, no podrá trabajar en la plataforma.
                        </p>
                      )}
                    </div>

                    {/* MATRIZ DE PERMISOS */}
                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                        <span className="text-xs font-bold text-slate-700">
                          Permisos de producción (función de operador):
                        </span>

                        {!esElAdmin && editable && (
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                            <span className="text-slate-400 mr-1">Plantillas rápidas:</span>
                            <button
                              type="button"
                              onClick={() => aplicarPreset(u.uid, 'siembra')}
                              className="px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded hover:bg-sky-100 font-medium"
                            >
                              Siembra
                            </button>
                            <button
                              type="button"
                              onClick={() => aplicarPreset(u.uid, 'cosecha')}
                              className="px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded hover:bg-sky-100 font-medium"
                            >
                              Cierre & Cosecha
                            </button>
                            {soyMaestro && (
                              <button
                                type="button"
                                onClick={() => aplicarPreset(u.uid, 'total')}
                                className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded hover:bg-purple-100 font-medium"
                              >
                                Total
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => aplicarPreset(u.uid, 'lectura')}
                              className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded hover:bg-slate-200 font-medium"
                            >
                              Solo Lectura
                            </button>
                          </div>
                        )}
                      </div>

                      {(ed.roles.includes('admin') || esElAdmin) ? (
                        <p className="text-[11px] text-slate-500 mb-2">Como administrador tiene todos los permisos de producción.</p>
                      ) : !ed.roles.includes('operator') ? (
                        <p className="text-[11px] text-slate-500 mb-2">
                          Estos permisos solo aplican con la función de operador. Sin ella no tiene acceso a la información productiva.
                        </p>
                      ) : null}

                      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 ${
                        bloqueoPermisos && !esElAdmin && !ed.roles.includes('admin') ? 'opacity-60' : ''
                      }`}>
                        {/* 1. Crear lotes */}
                        <label
                          className={`flex items-start space-x-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                            ed.permisos.crearLotes
                              ? 'bg-sky-50 border-sky-300 text-sky-950 font-semibold'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={bloqueoPermisos}
                            checked={ed.permisos.crearLotes}
                            onChange={() => handleTogglePermiso(u.uid, 'crearLotes')}
                            className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                          />
                          <div>
                            <span>Añadir nuevos lotes</span>
                            <p className="text-[10px] text-slate-400 font-normal">Crear lote y registrar siembra inicial</p>
                          </div>
                        </label>

                        {/* 2. Cargar eventos */}
                        <label
                          className={`flex items-start space-x-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                            ed.permisos.registrarEventos
                              ? 'bg-sky-50 border-sky-300 text-sky-950 font-semibold'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={bloqueoPermisos}
                            checked={ed.permisos.registrarEventos}
                            onChange={() => handleTogglePermiso(u.uid, 'registrarEventos')}
                            className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                          />
                          <div>
                            <span>Cargar / Registrar eventos</span>
                            <p className="text-[10px] text-slate-400 font-normal">Alimentación, calidad de agua, biometría</p>
                          </div>
                        </label>

                        {/* 3. Cerrar lotes */}
                        <label
                          className={`flex items-start space-x-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                            ed.permisos.cerrarLotes
                              ? 'bg-sky-50 border-sky-300 text-sky-950 font-semibold'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={bloqueoPermisos}
                            checked={ed.permisos.cerrarLotes}
                            onChange={() => handleTogglePermiso(u.uid, 'cerrarLotes')}
                            className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                          />
                          <div>
                            <span>Cerrar lotes y PDF oficial</span>
                            <p className="text-[10px] text-slate-400 font-normal">Cosechar, finalizar ciclo y firmar certificado</p>
                          </div>
                        </label>

                        {/* 4. Gestionar estanques */}
                        <label
                          className={`flex items-start space-x-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                            ed.permisos.gestionarEstanques
                              ? 'bg-sky-50 border-sky-300 text-sky-950 font-semibold'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={bloqueoPermisos}
                            checked={ed.permisos.gestionarEstanques}
                            onChange={() => handleTogglePermiso(u.uid, 'gestionarEstanques')}
                            className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                          />
                          <div>
                            <span>Crear piscinas y estanques</span>
                            <p className="text-[10px] text-slate-400 font-normal">Agregar E3, E4 y volúmenes en m³</p>
                          </div>
                        </label>

                        {/* 5. Gestionar configuración */}
                        <label
                          className={`flex items-start space-x-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                            ed.permisos.gestionarConfiguracion
                              ? 'bg-sky-50 border-sky-300 text-sky-950 font-semibold'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={bloqueoPermisos}
                            checked={ed.permisos.gestionarConfiguracion}
                            onChange={() => handleTogglePermiso(u.uid, 'gestionarConfiguracion')}
                            className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                          />
                          <div>
                            <span>Modificar rangos y nutrición</span>
                            <p className="text-[10px] text-slate-400 font-normal">Límites fisicoquímicos y ficha nutricional</p>
                          </div>
                        </label>

                        {/* 6. Administrar usuarios */}
                        <label
                          className={`flex items-start space-x-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                            ed.permisos.administrarUsuarios
                              ? 'bg-sky-50 border-sky-300 text-sky-950 font-semibold'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={bloqueoPermisos}
                            checked={ed.permisos.administrarUsuarios}
                            onChange={() => handleTogglePermiso(u.uid, 'administrarUsuarios')}
                            className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                          />
                          <div>
                            <span>Administrar operarios</span>
                            <p className="text-[10px] text-slate-400 font-normal">Autorizar a otros operarios y otorgar permisos</p>
                          </div>
                        </label>

                        {/* 7. Gestionar pedidos */}
                        <label
                          className={`flex items-start space-x-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                            ed.permisos.gestionarPedidos
                              ? 'bg-sky-50 border-sky-300 text-sky-950 font-semibold'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={bloqueoPermisos}
                            checked={Boolean(ed.permisos.gestionarPedidos)}
                            onChange={() => handleTogglePermiso(u.uid, 'gestionarPedidos')}
                            className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                          />
                          <div>
                            <span>Gestionar pedidos</span>
                            <p className="text-[10px] text-slate-400 font-normal">Crear órdenes de entrega, reservar cantidades y asignar repartidor</p>
                          </div>
                        </label>
                      </div>
                    </div>

                    {/* ACCIONES INDIVIDUALES (GUARDAR / ELIMINAR) */}
                    {editable && (
                      <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                        {/* Confirmación inline para eliminar usuario (el Administrador Maestro no se elimina) */}
                        <div>
                          {esElAdmin ? null : usuarioAEliminar === u.uid ? (
                            <div className="flex items-center space-x-1.5 bg-red-50 p-1.5 rounded-lg border border-red-200 text-xs">
                              <span className="text-[11px] font-bold text-red-700">¿Eliminar a este usuario?</span>
                              <button
                                type="button"
                                onClick={() => handleConfirmarEliminarUsuario(u.uid, u.email)}
                                disabled={esGuardando}
                                className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded text-[11px] transition-colors"
                              >
                                Sí, eliminar
                              </button>
                              <button
                                type="button"
                                onClick={() => setUsuarioAEliminar(null)}
                                className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded text-[11px] transition-colors"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setUsuarioAEliminar(u.uid)}
                              disabled={esGuardando}
                              className="inline-flex items-center space-x-1 px-2.5 py-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-xs font-medium transition-colors"
                              title="Retirar usuario del sistema"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span className="text-[11px]">Eliminar usuario</span>
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleGuardarUsuario(u)}
                          disabled={esGuardando}
                          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold inline-flex items-center space-x-1.5 shadow-xs transition-colors disabled:opacity-50"
                        >
                          {esGuardando ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              <span>Guardando en Firestore...</span>
                            </>
                          ) : (
                            <>
                              <Save className="w-3.5 h-3.5" />
                              <span>Guardar Cambios de {u.displayName || u.email.split('@')[0]}</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* VISTA DE CONSULTA PARA OPERARIOS SIN ROL ADMIN */
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Tu Estado Operativo en Cultivos Loré</h2>
              <p className="text-xs text-slate-500">{userEmail}</p>
            </div>
            <span
              className={`text-xs font-bold px-3 py-1 rounded-full uppercase ${
                perfilActual?.estado === 'activo'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-amber-100 text-amber-800 border border-amber-300'
              }`}
            >
              {perfilActual?.estado === 'activo' ? '🟢 Cuenta Autorizada' : '🟡 Pendiente de Aprobación'}
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-500 font-medium block">Funciones asignadas por el administrador:</span>
            {funcionesDisponibles(perfilActual).length === 0 ? (
              <p className="text-sm font-bold text-slate-900 mt-0.5">Sin funciones asignadas todavía</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {funcionesDisponibles(perfilActual).map((f) => (
                  <li key={f} className="text-sm text-slate-900">
                    <strong>{nombreFuncion(perfilActual, f)}</strong>
                    <span className="text-xs text-slate-500"> • {ETIQUETA_ROL[f]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <span className="text-xs text-slate-700 font-bold block mb-2">Tus permisos de producción (función de operador):</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
              <div
                className={`p-2.5 rounded-lg border ${
                  perfilActual?.permisos?.crearLotes
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                    : 'bg-slate-50 text-slate-400 border-slate-200'
                }`}
              >
                {perfilActual?.permisos?.crearLotes ? '✓ Autorizado' : '✗ Sin permiso'}: Añadir nuevos lotes
              </div>
              <div
                className={`p-2.5 rounded-lg border ${
                  perfilActual?.permisos?.registrarEventos
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                    : 'bg-slate-50 text-slate-400 border-slate-200'
                }`}
              >
                {perfilActual?.permisos?.registrarEventos ? '✓ Autorizado' : '✗ Sin permiso'}: Registrar eventos
              </div>
              <div
                className={`p-2.5 rounded-lg border ${
                  perfilActual?.permisos?.cerrarLotes
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                    : 'bg-slate-50 text-slate-400 border-slate-200'
                }`}
              >
                {perfilActual?.permisos?.cerrarLotes ? '✓ Autorizado' : '✗ Sin permiso'}: Cerrar lotes y PDF
              </div>
              <div
                className={`p-2.5 rounded-lg border ${
                  perfilActual?.permisos?.gestionarEstanques
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                    : 'bg-slate-50 text-slate-400 border-slate-200'
                }`}
              >
                {perfilActual?.permisos?.gestionarEstanques ? '✓ Autorizado' : '✗ Sin permiso'}: Crear piscinas/estanques
              </div>
              <div
                className={`p-2.5 rounded-lg border ${
                  perfilActual?.permisos?.gestionarConfiguracion
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                    : 'bg-slate-50 text-slate-400 border-slate-200'
                }`}
              >
                {perfilActual?.permisos?.gestionarConfiguracion ? '✓ Autorizado' : '✗ Sin permiso'}: Modificar configuración
              </div>
              <div
                className={`p-2.5 rounded-lg border ${
                  perfilActual?.permisos?.gestionarPedidos
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                    : 'bg-slate-50 text-slate-400 border-slate-200'
                }`}
              >
                {perfilActual?.permisos?.gestionarPedidos ? '✓ Autorizado' : '✗ Sin permiso'}: Gestionar pedidos
              </div>
            </div>
          </div>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start space-x-2 text-amber-900 text-xs">
            <Lock className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <span>
              Solo el administrador maestro Carlos (<strong>{ADMIN_MASTER_EMAIL}</strong>) tiene privilegios para autorizar cuentas, actualizar cargos o conceder permisos en Cultivos Loré.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
