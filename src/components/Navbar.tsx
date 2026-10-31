import React from 'react';
import {
  Fish,
  Users,
  LogIn,
  LogOut,
  User as UserIcon,
  Crown,
  Truck,
  Repeat
} from 'lucide-react';
import { User } from 'firebase/auth';
import { RolFuncional, UsuarioPerfil } from '../types';
import { esAdminMaestro, nombreFuncion } from '../services/usuariosService';

export type TabTipo = 'inicio' | 'lotes' | 'analitica' | 'configuracion' | 'usuarios' | 'reparto';

interface DefinicionTab {
  id: TabTipo;
  etiqueta: string;
  etiquetaMovil: string;
  icono?: React.ReactNode;
}

const TABS: Record<TabTipo, DefinicionTab> = {
  inicio: { id: 'inicio', etiqueta: 'Inicio', etiquetaMovil: 'Inicio' },
  lotes: { id: 'lotes', etiqueta: 'Lotes', etiquetaMovil: 'Lotes' },
  analitica: { id: 'analitica', etiqueta: 'Analítica', etiquetaMovil: 'Analítica' },
  configuracion: { id: 'configuracion', etiqueta: 'Configuración & Estanques', etiquetaMovil: 'Configuración' },
  usuarios: {
    id: 'usuarios',
    etiqueta: 'Personal & Permisos',
    etiquetaMovil: 'Personal & Permisos',
    icono: <Users className="w-4 h-4 text-sky-400" />
  },
  reparto: {
    id: 'reparto',
    etiqueta: 'Reparto',
    etiquetaMovil: 'Reparto',
    icono: <Truck className="w-4 h-4 text-sky-400" />
  }
};

const TABS_PRODUCCION: TabTipo[] = ['inicio', 'lotes', 'analitica', 'configuracion', 'usuarios'];

/**
 * Pestañas visibles según la función activa. Ocultarlas no da ni quita permisos: los controla
 * Firestore según los roles asignados.
 */
export function tabsDeFuncion(funcion: RolFuncional | null): TabTipo[] {
  return funcion === 'courier' ? ['reparto'] : TABS_PRODUCCION;
}

interface NavbarProps {
  tabActiva: TabTipo;
  setTabActiva: (tab: TabTipo) => void;
  usuario: User | null;
  perfilUsuario: UsuarioPerfil | null;
  funcionActiva: RolFuncional | null;
  puedeCambiarFuncion: boolean;
  eligiendoFuncion?: boolean;
  onCambiarFuncion: () => void;
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
  puedeCambiarFuncion,
  eligiendoFuncion = false,
  onCambiarFuncion,
  onAbrirAuth,
  onCerrarSesion,
  onNuevoLote
}) => {
  const esAdmin = esAdminMaestro(usuario?.email);
  // Mientras se elige la función no se muestran pestañas
  const tabs = eligiendoFuncion ? [] : tabsDeFuncion(funcionActiva).map((id) => TABS[id]);
  const tabInicial = tabsDeFuncion(funcionActiva)[0];

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo y Nombre de la Granja */}
          <div className="flex items-center space-x-3 cursor-pointer shrink-0" onClick={() => setTabActiva(tabInicial)}>
            <div className="w-10 h-10 rounded-lg bg-sky-600 flex items-center justify-center shadow-inner">
              <Fish className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight">Cultivos Loré</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  Tilapia Pro
                </span>
              </div>
              <p className="text-xs text-slate-400">Turbaco, Bolívar • Trazabilidad Inalterable</p>
            </div>
          </div>

          {/* Navegación por pestañas de la función activa (Desktop) */}
          <nav className="hidden md:flex items-center space-x-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTabActiva(t.id)}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${t.icono ? 'flex items-center space-x-1.5' : ''} ${
                  tabActiva === t.id
                    ? 'bg-slate-800 text-sky-400 border-b-2 border-sky-400 font-bold'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
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
                    esAdmin ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-700 text-slate-300'
                  }`}>
                    {esAdmin ? <Crown className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
                  </div>
                  <div className="hidden lg:block text-left text-xs">
                    <p className="font-semibold text-slate-200 truncate max-w-[150px]">{usuario.email}</p>
                    <p className={`text-[10px] flex items-center truncate max-w-[150px] ${
                      funcionActiva === 'admin'
                        ? 'text-amber-400 font-bold'
                        : funcionActiva
                        ? 'text-emerald-400 font-semibold'
                        : 'text-amber-400'
                    }`}>
                      {funcionActiva ? (
                        <>{nombreFuncion(perfilUsuario, funcionActiva)}</>
                      ) : eligiendoFuncion ? (
                        <>Elige una función</>
                      ) : esAdmin ? (
                        <>Administrador Maestro</>
                      ) : perfilUsuario?.estado === 'activo' ? (
                        <>Sin función asignada</>
                      ) : (
                        <>En espera de Carlos</>
                      )}
                    </p>
                  </div>
                  {puedeCambiarFuncion && (
                    <button
                      onClick={onCambiarFuncion}
                      title="Cambiar de función"
                      className="inline-flex items-center space-x-1 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:text-white rounded-md hover:bg-slate-800 transition-colors"
                    >
                      <Repeat className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Cambiar función</span>
                    </button>
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
                className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 text-sm font-medium rounded-md bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors"
              >
                <LogIn className="w-4 h-4" />
                <span>Ingresar</span>
              </button>
            )}
          </div>
        </div>

        {/* Navegación móvil */}
        <div className="md:hidden flex border-t border-slate-800 py-2 space-x-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTabActiva(t.id)}
              className={`px-3 py-1 text-xs rounded font-medium whitespace-nowrap ${tabActiva === t.id ? 'bg-sky-600 text-white font-bold' : 'text-slate-300'}`}
            >
              {t.etiquetaMovil}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
};
