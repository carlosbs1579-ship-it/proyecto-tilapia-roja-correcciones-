import React, { useState, useEffect, useRef } from 'react';
import { EsqueletoTarjetas } from './Esqueleto';
import { AnimatePresence, motion } from 'motion/react';
import { AvatarIniciales, Interruptor, MenuTresPuntos } from './PersonaUi';
import { Pestanas } from './Pestanas';
import { DISTANCIA, DURACION, entrada, salida } from '../lib/motion';
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
  ROLES_FUNCIONALES
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
  PERMISOS_DEFAULT_OPERARIO,
  GRUPOS_PERMISOS,
  valorPermiso
} from '../services/usuariosService';

type EdicionUsuario = {
  displayName: string;
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
  // Los perfiles anteriores no tienen los permisos por pestaña: se muestran con su valor heredado
  const permisos = { ...u.permisos } as PermisosUsuario;
  for (const clave of Object.keys(PERMISOS_DEFAULT_ADMIN) as (keyof PermisosUsuario)[]) {
    permisos[clave] = valorPermiso(u.permisos, clave);
  }
  return {
    displayName: u.displayName || '',
    roles: [...u.roles],
    cargos: { ...u.cargos },
    cargo: u.cargo || '',
    estado: u.estado,
    permisos
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
  const temporizadorAviso = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisar = () => {
    if (temporizadorAviso.current) clearTimeout(temporizadorAviso.current);
    temporizadorAviso.current = setTimeout(() => setMensajeExito(null), 3000);
  };
  useEffect(() => () => {
    if (temporizadorAviso.current) clearTimeout(temporizadorAviso.current);
  }, []);

  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'activo' | 'pendiente' | 'inactivo'>('todos');
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [menuAbierto, setMenuAbierto] = useState<string | null>(null);
  const alternarAbierto = (uid: string) => setAbiertos((prev) => ({ ...prev, [uid]: !prev[uid] }));

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
        setErrorMsg('No se pudo cargar la lista de usuarios.');
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
      avisar();
    } catch (err: any) {
      console.error('Error al actualizar estado:', err);
      setErrorMsg(err.message || 'No se pudo actualizar el estado.');
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

  // Casilla general de una pestaña: marca o desmarca todos sus permisos
  const handleGrupoPermisos = (uid: string, claves: (keyof PermisosUsuario)[], valor: boolean) => {
    setEdicionUsuarios((prev) => {
      const actual = prev[uid]?.permisos || PERMISOS_DEFAULT_OPERARIO;
      return {
        ...prev,
        [uid]: { ...prev[uid], permisos: { ...actual, ...Object.fromEntries(claves.map((c) => [c, valor])) } }
      };
    });
  };

  // Las plantillas de producción dejan al usuario como operador (sin tocar su función de repartidor);
  // "Total" lo convierte en administrador y solo la ve el Administrador Maestro
  const aplicarPreset = (uid: string, preset: 'siembra' | 'cosecha' | 'total' | 'lectura') => {
    let nuevosPermisos: PermisosUsuario;
    const rolesActuales = edicionUsuarios[uid]?.roles || [];
    // Las plantillas de producción no tocan los permisos de la pestaña Entregas que ya tenga
    const p0 = edicionUsuarios[uid]?.permisos || PERMISOS_DEFAULT_OPERARIO;
    const entregas = {
      gestionarPedidos: Boolean(p0.gestionarPedidos),
      verEntregas: Boolean(p0.verEntregas),
      decidirSaldos: Boolean(p0.decidirSaldos),
      gestionarComprobantes: Boolean(p0.gestionarComprobantes),
      atenderNovedades: Boolean(p0.atenderNovedades)
    };
    const base = { ...PERMISOS_DEFAULT_OPERARIO, ...entregas };
    let roles: RolFuncional[] = ordenarRoles([...rolesActuales.filter((r) => r !== 'admin'), 'operator']);

    switch (preset) {
      case 'total':
        nuevosPermisos = { ...PERMISOS_DEFAULT_ADMIN };
        roles = ordenarRoles(['admin', ...rolesActuales]);
        break;
      case 'siembra':
        nuevosPermisos = {
          ...base,
          verInicio: true,
          crearLotes: true,
          verLotes: true,
          buscarLotes: true,
          registrarEventos: true,
          corregirSiembra: true,
          descargarDocumentosLote: true
        };
        break;
      case 'cosecha':
        nuevosPermisos = {
          ...base,
          verInicio: true,
          verLotes: true,
          buscarLotes: true,
          registrarEventos: true,
          cerrarLotes: true,
          descargarDocumentosLote: true
        };
        break;
      case 'lectura':
        // Solo lectura: ve las pestañas de producción sin poder modificar nada
        nuevosPermisos = {
          ...PERMISOS_DEFAULT_OPERARIO,
          verInicio: true,
          verLotes: true,
          buscarLotes: true,
          verAnalitica: true,
          verConfiguracion: true
        };
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
      setMensajeExito(`Perfil y permisos de "${u.displayName || u.email}" guardados.`);
      avisar();
    } catch (err: any) {
      console.error('Error guardando usuario:', err);
      setErrorMsg(err.message || 'No se pudo guardar el usuario.');
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
      avisar();
    } catch (err: any) {
      console.error('Error eliminando usuario:', err);
      setErrorMsg(err.message || 'No se pudo eliminar el usuario.');
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
      // Guarda todos los perfiles editables que cambiaron (incluido el propio del administrador
      // principal, igual que con el botón individual)
      let guardados = 0;
      for (const u of usuarios) {
        if (!puedeEditarPerfil(u)) continue;
        const edit = edicionUsuarios[u.uid];
        if (!edit || JSON.stringify(edit) === JSON.stringify(edicionDesdePerfil(u))) continue;
        await actualizarPerfilOperario(u.uid, edit, userEmail);
        guardados++;
      }
      setMensajeExito(guardados ? `Se guardaron ${guardados} perfil(es) con cambios.` : 'No había cambios por guardar.');
      avisar();
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

  const textoConteo = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
  const ESTADO_TEXTO: Record<EdicionUsuario['estado'], { texto: string; clase: string }> = {
    activo: { texto: 'Activo', clase: 'text-emerald-700' },
    pendiente: { texto: 'Pendiente de aprobación', clase: 'text-amber-700' },
    inactivo: { texto: 'Inactivo', clase: 'text-slate-500' }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl text-slate-900">Personal y permisos</h1>
          <p className="text-sm text-slate-600 mt-1">
            {textoConteo(totalUsuarios, 'persona', 'personas')}: {textoConteo(activos, 'activa', 'activas')},{' '}
            {textoConteo(pendientes, 'pendiente', 'pendientes')} y {textoConteo(inactivos, 'inactiva', 'inactivas')}.
          </p>
          {esAdmin && pendientes > 0 && (
            <p className="text-sm text-amber-700 mt-1">
              {pendientes === 1 ? 'Una cuenta espera tu aprobación.' : `${pendientes} cuentas esperan tu aprobación.`}
            </p>
          )}
        </div>

        {esAdmin && (
          <button
            onClick={handleGuardarTodos}
            disabled={guardandoTodos || usuarios.length === 0}
            aria-busy={guardandoTodos}
            className="inline-flex items-center justify-center gap-2 min-h-11 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-sm font-semibold transition-colors disabled:opacity-60 shrink-0"
          >
            <span className="w-4 h-4 grid place-items-center" aria-hidden="true">
              {guardandoTodos ? (
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Save className="w-4 h-4" strokeWidth={1.75} />
              )}
            </span>
            Guardar todos los cambios
          </button>
        )}
      </div>

      {errorMsg && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-md flex items-center gap-2 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.75} />
          <span>{errorMsg}</span>
        </div>
      )}

      {esAdmin ? (
        <section className="bg-white rounded-xl border border-slate-200">
          {/* Búsqueda y filtro por estado */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 border-b border-slate-200">
            <label className="relative flex-1 max-w-sm">
              <span className="sr-only">Buscar personas</span>
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.75} />
              <input
                type="search"
                placeholder="Buscar por nombre, correo o cargo"
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
                className="w-full min-h-11 pl-9 pr-3 text-sm border border-slate-300 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              />
            </label>
            <Pestanas
              items={[
                { id: 'todos', etiqueta: 'Todos' },
                { id: 'activo', etiqueta: 'Activos' },
                { id: 'pendiente', etiqueta: 'Pendientes' },
                { id: 'inactivo', etiqueta: 'Inactivos' }
              ]}
              activo={filtroEstado}
              onCambio={setFiltroEstado}
              idIndicador="filtro-personal"
              etiqueta="Filtrar por estado"
            />
          </div>

          {/* Lista de personas */}
          {usuariosCargando ? (
            <div className="p-4">
              <EsqueletoTarjetas cantidad={4} alto="h-16" avatar />
            </div>
          ) : usuariosFiltrados.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-800">
                {filtroTexto || filtroEstado !== 'todos' ? 'Nadie coincide con la búsqueda o el filtro.' : 'Todavía no hay personas registradas.'}
              </p>
              <p className="text-sm text-slate-600">
                {filtroTexto || filtroEstado !== 'todos'
                  ? 'Prueba con otro nombre o vuelve a "Todos".'
                  : 'Cada persona aparece aquí la primera vez que inicia sesión; luego la apruebas y le asignas su función.'}
              </p>
              {(filtroTexto || filtroEstado !== 'todos') && (
                <button
                  type="button"
                  onClick={() => {
                    setFiltroTexto('');
                    setFiltroEstado('todos');
                  }}
                  className="mt-2 min-h-11 px-4 rounded-md border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Ver a todos
                </button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-slate-200">
              <AnimatePresence initial={false} mode="popLayout">
                {usuariosFiltrados.map((u) => {
                  const esElAdmin = esAdminMaestro(u.email);
                  const ed = edicionUsuarios[u.uid] || edicionDesdePerfil(u);
                  const esGuardando = guardandoId === u.uid;
                  const editable = puedeEditarPerfil(u);
                  const bloqueoPermisos = !editable || esElAdmin || ed.roles.includes('admin') || !ed.roles.includes('operator');
                  const abierto = Boolean(abiertos[u.uid]);
                  const nombre = u.displayName || u.email.split('@')[0];
                  const funciones = ed.roles.map((r) => ETIQUETA_ROL[r]).join(', ') || 'Sin función';
                  const estado = ESTADO_TEXTO[ed.estado];
                  const acciones = [
                    { etiqueta: abierto ? 'Cerrar detalle' : 'Editar funciones y permisos', onClick: () => alternarAbierto(u.uid) },
                    ...(!esElAdmin && editable
                      ? (['activo', 'pendiente', 'inactivo'] as const)
                          .filter((e) => e !== ed.estado)
                          .map((e) => ({
                            etiqueta: e === 'activo' ? 'Aprobar y activar' : e === 'pendiente' ? 'Marcar como pendiente' : 'Desactivar cuenta',
                            onClick: () => handleCambioEstado(u, e),
                            deshabilitado: esGuardando
                          }))
                      : []),
                    ...(!esElAdmin && editable ? [{ etiqueta: 'Eliminar persona', onClick: () => setUsuarioAEliminar(u.uid), peligro: true }] : [])
                  ];
                  return (
                    <motion.li
                      key={u.uid}
                      layout
                      initial={{ opacity: 0, y: -DISTANCIA.pequena }}
                      animate={{ opacity: 1, y: 0, transition: entrada(DURACION.base) }}
                      exit={{ opacity: 0, scale: 0.98, transition: salida(DURACION.base) }}
                      className="relative"
                    >
                      {/* Fila: avatar, nombre, correo, función y estado */}
                      <div className="fila-hover flex items-center gap-3 px-4 py-3">
                        <AvatarIniciales nombre={nombre} semilla={u.uid} />
                        <button
                          type="button"
                          onClick={() => alternarAbierto(u.uid)}
                          aria-expanded={abierto}
                          className="flex-1 min-w-0 text-left"
                        >
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-medium text-slate-900 [overflow-wrap:anywhere]">{nombre}</span>
                            <span className="text-xs border border-slate-300 rounded-sm px-2 text-slate-600 whitespace-nowrap">
                              {esElAdmin ? 'Administrador principal' : funciones}
                            </span>
                          </span>
                          <span className="block text-sm text-slate-600 truncate" title={u.email}>
                            {u.email}
                          </span>
                        </button>
                        <span className={`hidden sm:inline text-sm whitespace-nowrap ${estado.clase}`}>{estado.texto}</span>
                        <MenuTresPuntos
                          abierto={menuAbierto === u.uid}
                          onAbrir={() => setMenuAbierto(u.uid)}
                          onCerrar={() => setMenuAbierto((m) => (m === u.uid ? null : m))}
                          acciones={acciones}
                          etiqueta={`Acciones para ${nombre}`}
                        />
                      </div>
                      <p className={`sm:hidden px-4 -mt-2 pb-3 pl-17 text-sm ${estado.clase}`}>{estado.texto}</p>

                      {/* Confirmación para eliminar */}
                      {usuarioAEliminar === u.uid && (
                        <div role="alert" className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                          <span className="text-red-800 flex-1 min-w-0">
                            ¿Eliminar a {nombre}? Pierde el acceso; sus registros firmados se conservan.
                          </span>
                          <button
                            type="button"
                            onClick={() => setUsuarioAEliminar(null)}
                            className="min-h-11 px-3 rounded-md border border-slate-300 bg-white text-slate-800 font-semibold"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleConfirmarEliminarUsuario(u.uid, u.email)}
                            disabled={esGuardando}
                            className="min-h-11 px-3 rounded-md bg-red-700 text-white font-semibold disabled:opacity-60"
                          >
                            Eliminar
                          </button>
                        </div>
                      )}

                      {/* Detalle: nombre visible, funciones y permisos */}
                      <AnimatePresence initial={false}>
                        {abierto && (
                          <motion.div
                            key="detalle"
                            initial={{ opacity: 0, y: -DISTANCIA.pequena }}
                            animate={{ opacity: 1, y: 0, transition: entrada(DURACION.base) }}
                            exit={{ opacity: 0, transition: salida(DURACION.rapida) }}
                            className="px-4 pb-5 sm:pl-17 space-y-6"
                          >
                            {!editable && (
                              <p className="text-sm text-slate-600 flex items-center gap-2">
                                <Lock className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                                {u.uid === perfilActual?.uid
                                  ? 'No puedes modificar tus propias funciones ni permisos.'
                                  : esElAdmin
                                  ? 'Este perfil de administrador solo lo modifica su titular.'
                                  : 'Solo el administrador principal puede modificar a otros administradores.'}
                              </p>
                            )}

                            {editable && (
                              <label className="block max-w-sm">
                                <span className="text-sm font-medium text-slate-800">Nombre visible</span>
                                <input
                                  type="text"
                                  maxLength={60}
                                  value={ed.displayName}
                                  placeholder="Nombre y apellido"
                                  onChange={(e) => {
                                    const valor = e.target.value;
                                    setEdicionUsuarios((prev) => ({ ...prev, [u.uid]: { ...prev[u.uid], displayName: valor } }));
                                  }}
                                  className="mt-1 w-full min-h-11 px-3 border border-slate-300 rounded-md text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                                />
                                <span className="block text-xs text-slate-600 mt-1">Aparece en los historiales y en los PDF en lugar del correo.</span>
                              </label>
                            )}

                            {/* Funciones */}
                            <section>
                              <h3 className="rotulo text-slate-600 mb-3">Funciones</h3>
                              <div className="space-y-3">
                                {ROLES_FUNCIONALES.map((rol) => {
                                  const asignado = ed.roles.includes(rol);
                                  const rolBloqueado = !editable || esGuardando || (rol === 'admin' && (!soyMaestro || esElAdmin));
                                  return (
                                    <div key={rol} className="space-y-2">
                                      <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                          <p className="text-sm font-medium text-slate-900">{ETIQUETA_ROL[rol]}</p>
                                          <p className="text-sm text-slate-600">{DESCRIPCION_ROL[rol]}</p>
                                        </div>
                                        <Interruptor
                                          activo={asignado}
                                          deshabilitado={rolBloqueado}
                                          onCambio={() => handleToggleRol(u.uid, rol)}
                                          etiqueta={`Función ${ETIQUETA_ROL[rol]}`}
                                        />
                                      </div>
                                      {asignado && (
                                        <div className="space-y-2">
                                          <input
                                            type="text"
                                            disabled={!editable || esGuardando}
                                            maxLength={80}
                                            aria-label={`Cargo visible como ${ETIQUETA_ROL[rol].toLowerCase()}`}
                                            placeholder={`Cargo visible (ej: ${SUGERENCIAS_CARGO[rol]?.[0]?.valor || 'Coordinador de producción'})`}
                                            value={ed.cargos[rol] || ''}
                                            onChange={(e) => handleCambioCargo(u.uid, rol, e.target.value)}
                                            className="w-full max-w-md min-h-11 px-3 text-sm border border-slate-300 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:bg-slate-100"
                                          />
                                          {editable && SUGERENCIAS_CARGO[rol] && (
                                            <div className="flex flex-wrap gap-2">
                                              {SUGERENCIAS_CARGO[rol]!.map((s) => (
                                                <button
                                                  key={s.valor}
                                                  type="button"
                                                  onClick={() => handleCambioCargo(u.uid, rol, s.valor)}
                                                  className="min-h-9 px-3 rounded-md border border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
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
                                <p className="mt-3 text-sm text-amber-700">Sin funciones: aunque la cuenta esté activa, no podrá trabajar en la plataforma.</p>
                              )}
                            </section>

                            {/* Permisos por pestaña */}
                            <section>
                              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                                <h3 className="rotulo text-slate-600">Permisos de operador</h3>
                                {!esElAdmin && editable && (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-slate-600">Plantillas:</span>
                                    {[
                                      { id: 'siembra' as const, etiqueta: 'Siembra' },
                                      { id: 'cosecha' as const, etiqueta: 'Cierre y cosecha' },
                                      ...(soyMaestro ? [{ id: 'total' as const, etiqueta: 'Total' }] : []),
                                      { id: 'lectura' as const, etiqueta: 'Solo lectura' }
                                    ].map((p) => (
                                      <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => aplicarPreset(u.uid, p.id)}
                                        className="min-h-9 px-3 rounded-md border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                      >
                                        {p.etiqueta}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {ed.roles.includes('admin') || esElAdmin ? (
                                <p className="text-sm text-slate-600">Como administrador tiene todos los permisos de producción.</p>
                              ) : !ed.roles.includes('operator') ? (
                                <p className="text-sm text-slate-600">Estos permisos aplican con la función de operador. Actívala para asignarlos.</p>
                              ) : null}
                              <div className={`space-y-6 mt-3 ${bloqueoPermisos && !esElAdmin && !ed.roles.includes('admin') ? 'opacity-50' : ''}`}>
                                {GRUPOS_PERMISOS.map((g) => {
                                  const claves = [...(g.ver ? [g.ver] : []), ...g.acciones.map((a) => a.clave)];
                                  const marcadas = claves.filter((c) => Boolean(ed.permisos[c])).length;
                                  const todas = marcadas === claves.length;
                                  return (
                                    <div key={g.pestana}>
                                      <div className="flex items-center justify-between gap-4 pb-2 border-b border-slate-200">
                                        <p className="text-sm font-semibold text-slate-900">
                                          Pestaña {g.titulo}
                                          <span className="ml-2 font-normal text-slate-600">
                                            {marcadas === 0 ? 'oculta' : `${marcadas} de ${claves.length}`}
                                          </span>
                                        </p>
                                        <Interruptor
                                          activo={todas}
                                          indeterminado={marcadas > 0 && !todas}
                                          deshabilitado={bloqueoPermisos}
                                          onCambio={() => handleGrupoPermisos(u.uid, claves, !todas)}
                                          etiqueta={`Todos los permisos de ${g.titulo}`}
                                        />
                                      </div>
                                      <div className="grid sm:grid-cols-2 gap-x-8">
                                        {[
                                          ...(g.ver ? [{ clave: g.ver, etiqueta: 'Ver la pestaña', detalle: 'Consultar la información, sin modificarla' }] : []),
                                          ...g.acciones
                                        ].map((a) => (
                                          <div key={a.clave} className="flex items-start justify-between gap-4 py-3 border-b border-slate-100">
                                            <div className="min-w-0">
                                              <p className="text-sm text-slate-900">{a.etiqueta}</p>
                                              <p className="text-xs text-slate-600">{a.detalle}</p>
                                            </div>
                                            <Interruptor
                                              activo={Boolean(ed.permisos[a.clave])}
                                              deshabilitado={bloqueoPermisos}
                                              onCambio={() => handleTogglePermiso(u.uid, a.clave)}
                                              etiqueta={a.etiqueta}
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                                <p className="text-xs text-slate-600">
                                  La persona solo ve las pestañas en las que tiene al menos un permiso. Personal y permisos es solo para administradores.
                                </p>
                              </div>
                            </section>

                            {editable && (
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => handleGuardarUsuario(u)}
                                  disabled={esGuardando}
                                  aria-busy={esGuardando}
                                  className="inline-flex items-center justify-center gap-2 min-h-11 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-sm font-semibold transition-colors disabled:opacity-60"
                                >
                                  <span className="w-4 h-4 grid place-items-center" aria-hidden="true">
                                    {esGuardando ? (
                                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                      <Save className="w-4 h-4" strokeWidth={1.75} />
                                    )}
                                  </span>
                                  Guardar cambios
                                </button>
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </section>
      ) : (
        /* VISTA DE CONSULTA PARA OPERARIOS SIN ROL ADMIN */
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Tu estado operativo en Cultivos Loré</h2>
              <p className="text-xs text-slate-500">{userEmail}</p>
            </div>
            <span
              className={`text-xs font-semibold px-3 py-1 rounded-full uppercase ${
                perfilActual?.estado === 'activo'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-amber-100 text-amber-800 border border-amber-300'
              }`}
            >
              {perfilActual?.estado === 'activo' ? 'Cuenta Autorizada' : 'Pendiente de Aprobación'}
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-500 font-medium block">Funciones asignadas por el administrador:</span>
            {funcionesDisponibles(perfilActual).length === 0 ? (
              <p className="text-sm font-semibold text-slate-900 mt-1">Sin funciones asignadas todavía</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {funcionesDisponibles(perfilActual).map((f) => (
                  <li key={f} className="text-sm text-slate-900">
                    <strong>{nombreFuncion(perfilActual, f)}</strong>
                    <span className="text-xs text-slate-500"> · {ETIQUETA_ROL[f]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <span className="text-xs text-slate-700 font-semibold block mb-2">Tus permisos de producción (función de operador):</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
              <div
                className={`p-3 rounded-lg border ${
                  perfilActual?.permisos?.crearLotes
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                    : 'bg-slate-50 text-slate-500 border-slate-200'
                }`}
              >
                {perfilActual?.permisos?.crearLotes ? 'Autorizado' : 'Sin permiso'}: Añadir nuevos lotes
              </div>
              <div
                className={`p-3 rounded-lg border ${
                  perfilActual?.permisos?.registrarEventos
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                    : 'bg-slate-50 text-slate-500 border-slate-200'
                }`}
              >
                {perfilActual?.permisos?.registrarEventos ? 'Autorizado' : 'Sin permiso'}: Registrar eventos
              </div>
              <div
                className={`p-3 rounded-lg border ${
                  perfilActual?.permisos?.cerrarLotes
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                    : 'bg-slate-50 text-slate-500 border-slate-200'
                }`}
              >
                {perfilActual?.permisos?.cerrarLotes ? 'Autorizado' : 'Sin permiso'}: Cerrar lotes y PDF
              </div>
              <div
                className={`p-3 rounded-lg border ${
                  perfilActual?.permisos?.gestionarEstanques
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                    : 'bg-slate-50 text-slate-500 border-slate-200'
                }`}
              >
                {perfilActual?.permisos?.gestionarEstanques ? 'Autorizado' : 'Sin permiso'}: Crear piscinas/estanques
              </div>
              <div
                className={`p-3 rounded-lg border ${
                  perfilActual?.permisos?.gestionarConfiguracion
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                    : 'bg-slate-50 text-slate-500 border-slate-200'
                }`}
              >
                {perfilActual?.permisos?.gestionarConfiguracion ? 'Autorizado' : 'Sin permiso'}: Modificar configuración
              </div>
              <div
                className={`p-3 rounded-lg border ${
                  perfilActual?.permisos?.gestionarPedidos
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                    : 'bg-slate-50 text-slate-500 border-slate-200'
                }`}
              >
                {perfilActual?.permisos?.gestionarPedidos ? 'Autorizado' : 'Sin permiso'}: Gestionar pedidos
              </div>
            </div>
          </div>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start space-x-2 text-amber-900 text-xs">
            <Lock className="w-4 h-4 shrink-0 mt-1 text-amber-600" />
            <span>
              Solo el administrador tiene privilegios para autorizar cuentas, actualizar cargos o conceder permisos en Cultivos Loré.
            </span>
          </div>
        </div>
      )}
      {/* Aviso de guardado: entra desde abajo y se va solo a los 3 s */}
      <AnimatePresence>
        {mensajeExito && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: DISTANCIA.pantalla }}
            animate={{ opacity: 1, y: 0, transition: entrada(DURACION.base) }}
            exit={{ opacity: 0, y: DISTANCIA.pequena, transition: salida() }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] flex items-center gap-2 rounded-md bg-slate-900 text-white px-4 py-3 text-sm shadow-sm"
          >
            <Check className="w-4 h-4 shrink-0 text-emerald-300" strokeWidth={1.75} />
            <span>{mensajeExito}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
