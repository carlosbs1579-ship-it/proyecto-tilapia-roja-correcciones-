import React from 'react';
import {
  Fish,
  Users,
  LogIn,
  LogOut,
  User as UserIcon,
  Truck,
  Shield,
  Factory
} from 'lucide-react';
import { User } from 'firebase/auth';
import { RolFuncional, UsuarioPerfil } from '../types';
import { ETIQUETA_ROL, esAdminMaestro, nombreFuncion, veePestana } from '../services/usuariosService';

const ICONO_FUNCION: Record<RolFuncional, React.ReactNode> = {
  admin: <Shield className="w-3.5 h-3.5" />,
  operator: <Factory className="w-3.5 h-3.5" />,
  courier: <Truck className="w-3.5 h-3.5" />
};

/**
 * Cambio de función con un solo clic: muestra las funciones de la cuenta y cambia al instante.
 */
const SelectorRapidoFuncion: React.FC<{
  funciones: RolFuncional[];
  activa: RolFuncional | null;
  onElegir: (f: RolFuncional) => void;
  compacto?: boolean;
}> = ({ funciones, activa, onElegir, compacto }) => (
  <div className="flex items-center rounded-lg bg-slate-800 p-0.5" role="group" aria-label="Cambiar de función">
    {funciones.map((f) => (
      <button
        key={f}
        type="button"
        onClick={() => f !== activa && onElegir(f)}
        aria-pressed={f === activa}
        title={f === activa ? `Trabajando como ${ETIQUETA_ROL[f]}` : `Cambiar a ${ETIQUETA_ROL[f]}`}
        className={`flex items-center space-x-1 rounded-md font-semibold transition-colors ${compacto ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-xs'} ${
          f === activa ? 'bg-slate-50 text-slate-900' : 'text-slate-300 hover:text-white hover:bg-slate-700'
        }`}
      >
        {ICONO_FUNCION[f]}
        <span>{ETIQUETA_ROL[f]}</span>
      </button>
    ))}
  </div>
);

export type TabTipo = 'inicio' | 'lotes' | 'pedidos' | 'analitica' | 'configuracion' | 'usuarios' | 'reparto';

interface DefinicionTab {
  id: TabTipo;
  etiqueta: string;
  etiquetaMovil: string;
  icono?: React.ReactNode;
}

const TABS: Record<TabTipo, DefinicionTab> = {
  inicio: { id: 'inicio', etiqueta: 'Inicio', etiquetaMovil: 'Inicio' },
  lotes: { id: 'lotes', etiqueta: 'Lotes', etiquetaMovil: 'Lotes' },
  pedidos: { id: 'pedidos', etiqueta: 'Entregas', etiquetaMovil: 'Entregas' },
  analitica: { id: 'analitica', etiqueta: 'Analítica', etiquetaMovil: 'Analítica' },
  configuracion: { id: 'configuracion', etiqueta: 'Configuración', etiquetaMovil: 'Configuración' },
  usuarios: {
    id: 'usuarios',
    etiqueta: 'Personal',
    etiquetaMovil: 'Personal & Permisos',
    icono: <Users className="w-4 h-4" strokeWidth={1.75} />
  },
  reparto: {
    id: 'reparto',
    etiqueta: 'Mis entregas',
    etiquetaMovil: 'Mis entregas',
    icono: <Truck className="w-4 h-4" strokeWidth={1.75} />
  }
};

const TABS_PRODUCCION: TabTipo[] = ['inicio', 'lotes', 'pedidos', 'analitica', 'configuracion', 'usuarios'];

/**
 * Pestañas visibles según la función activa. Ocultarlas no da ni quita permisos: los controla
 * Firestore según los roles asignados.
 */
export function tabsDeFuncion(funcion: RolFuncional | null, perfil: UsuarioPerfil | null = null): TabTipo[] {
  if (funcion === 'courier') return ['reparto'];
  // Sin función (visitante, cuenta pendiente o sin roles) no se muestran Configuración ni Personal
  if (!funcion) return ['inicio', 'lotes', 'pedidos', 'analitica'];
  if (funcion === 'admin') return TABS_PRODUCCION;
  // Operador: solo las pestañas en las que tiene algún permiso (las demás no aparecen)
  const visibles = (['inicio', 'lotes', 'pedidos', 'analitica', 'configuracion'] as const).filter((t) => veePestana(perfil, t));
  return visibles.length ? [...visibles] : ['inicio'];
}

interface NavbarProps {
  tabActiva: TabTipo;
  setTabActiva: (tab: TabTipo) => void;
  usuario: User | null;
  perfilUsuario: UsuarioPerfil | null;
  funcionActiva: RolFuncional | null;
  funciones: RolFuncional[];
  eligiendoFuncion?: boolean;
  onSeleccionarFuncion: (f: RolFuncional) => void;
  onAbrirAuth: () => void;
  onCerrarSesion: () => void;
  onNuevoLote: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  tabActiva,
  setTabActiva,
  usuario,
  perfilUsuario,
  funcionActiva,
  funciones,
  eligiendoFuncion = false,
  onSeleccionarFuncion,
  onAbrirAuth,
  onCerrarSesion,
  onNuevoLote
}) => {
  const esAdmin = esAdminMaestro(usuario?.email);
  // Mientras se elige la función no se muestran pestañas
  const tabs = eligiendoFuncion ? [] : tabsDeFuncion(funcionActiva, perfilUsuario).map((id) => TABS[id]);
  const tabInicial = tabsDeFuncion(funcionActiva, perfilUsuario)[0];

  return (
    <header className="bg-slate-900 text-white border-b-4 border-double border-amber-600 sticky top-0 z-40 pt-[env(safe-area-inset-top,0px)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Nombre de la granja */}
          <button type="button" className="flex items-center space-x-3 shrink-0 text-left" onClick={() => setTabActiva(tabInicial)}>
            <Fish className="w-6 h-6 text-amber-400" strokeWidth={1.5} aria-hidden="true" />
            <span>
              <span className="block font-serif text-xl leading-tight">Cultivos Loré</span>
              <span className="rotulo hidden sm:block text-slate-300">Trazabilidad Tilapia Pro · Turbaco, Bolívar</span>
            </span>
          </button>

          {/* Navegación por pestañas de la función activa (Desktop) */}
          <nav className="hidden md:flex items-center self-stretch">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTabActiva(t.id)}
                className={`rotulo h-full px-3 border-b-2 transition-colors ${t.icono ? 'flex items-center space-x-1.5' : ''} ${
                  tabActiva === t.id ? 'text-white border-amber-400' : 'text-slate-300 border-transparent hover:text-white'
                }`}
              >
                {t.icono}
                <span>{t.etiqueta}</span>
              </button>
            ))}
          </nav>

          {/* Acciones de usuario */}
          <div className="flex items-center space-x-3">
            {usuario ? (
              <>
                <div className="flex items-center space-x-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    'bg-slate-700 text-slate-300'
                  }`}>
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <div className="hidden lg:block text-left text-xs">
                    <p className="font-semibold text-slate-200 truncate max-w-[150px]" title={usuario.email || undefined}>{perfilUsuario?.displayName || usuario.email}</p>
                    <p className={`text-[11px] flex items-center truncate max-w-[150px] ${
                      funcionActiva ? 'text-amber-400 font-semibold' : 'text-slate-300'
                    }`}>
                      {funcionActiva ? (
                        <>{nombreFuncion(perfilUsuario, funcionActiva)}</>
                      ) : eligiendoFuncion ? (
                        <>Elige una función</>
                      ) : esAdmin ? (
                        <>Administrador</>
                      ) : perfilUsuario?.estado === 'activo' ? (
                        <>Sin función asignada</>
                      ) : (
                        <>En espera de autorización</>
                      )}
                    </p>
                  </div>
                  {funciones.length > 1 && funcionActiva && !eligiendoFuncion && (
                    <div className="hidden md:block">
                      <SelectorRapidoFuncion funciones={funciones} activa={funcionActiva} onElegir={onSeleccionarFuncion} />
                    </div>
                  )}
                  <button
                    onClick={onCerrarSesion}
                    title="Cerrar sesión"
                    className="p-1.5 text-slate-400 hover:text-red-400 rounded-md hover:bg-slate-800 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={onAbrirAuth}
                className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 text-sm font-semibold rounded-md bg-slate-50 hover:bg-white text-slate-900 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                <span>Ingresar</span>
              </button>
            )}
          </div>
        </div>

        {/* Cambio de función en el celular */}
        {usuario && funciones.length > 1 && funcionActiva && !eligiendoFuncion && (
          <div className="md:hidden flex items-center justify-between border-t border-slate-800 py-1.5">
            <span className="text-[11px] text-slate-400">Función:</span>
            <SelectorRapidoFuncion funciones={funciones} activa={funcionActiva} onElegir={onSeleccionarFuncion} compacto />
          </div>
        )}

        {/* Navegación móvil */}
        {tabs.length > 1 && (
        <div className="md:hidden flex border-t border-slate-800 -mx-4 px-2 overflow-x-auto sin-barra">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTabActiva(t.id)}
              className={`rotulo px-3 py-3 whitespace-nowrap border-b-2 ${tabActiva === t.id ? 'text-white border-amber-400' : 'text-slate-300 border-transparent'}`}
            >
              {t.etiquetaMovil}
            </button>
          ))}
        </div>
        )}
      </div>
    </header>
  );
};
