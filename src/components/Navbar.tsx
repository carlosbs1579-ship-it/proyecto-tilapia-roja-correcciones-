import React from 'react';
import {
  Fish,
  Users,
  Settings,
  LogIn,
  LogOut,
  User as UserIcon,
  Plus,
  Crown,
  LayoutDashboard,
  Layers,
  BarChart2
} from 'lucide-react';
import { User } from 'firebase/auth';
import { UsuarioPerfil } from '../types';
import { esAdminMaestro } from '../services/usuariosService';

export type TabTipo = 'inicio' | 'lotes' | 'analitica' | 'configuracion' | 'usuarios';

interface NavbarProps {
  tabActiva: TabTipo;
  setTabActiva: (tab: TabTipo) => void;
  usuario: User | null;
  perfilUsuario: UsuarioPerfil | null;
  onAbrirAuth: () => void;
  onCerrarSesion: () => void;
  onNuevoLote: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  tabActiva,
  setTabActiva,
  usuario,
  perfilUsuario,
  onAbrirAuth,
  onCerrarSesion,
  onNuevoLote
}) => {
  const esAdmin = esAdminMaestro(usuario?.email);
  const puedeCrear = esAdmin || Boolean(perfilUsuario?.estado === 'activo' && perfilUsuario?.permisos?.crearLotes);

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo y Nombre de la Granja */}
          <div className="flex items-center space-x-3 cursor-pointer shrink-0" onClick={() => setTabActiva('inicio')}>
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

          {/* Navegación por 5 pestañas principales (Desktop) */}
          <nav className="hidden md:flex items-center space-x-1">
            {/* 1. Inicio */}
            <button
              onClick={() => setTabActiva('inicio')}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                tabActiva === 'inicio'
                  ? 'bg-slate-800 text-sky-400 border-b-2 border-sky-400 font-bold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Inicio
            </button>

            {/* 2. Lotes */}
            <button
              onClick={() => setTabActiva('lotes')}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                tabActiva === 'lotes'
                  ? 'bg-slate-800 text-sky-400 border-b-2 border-sky-400 font-bold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Lotes
            </button>

            {/* 3. Analítica */}
            <button
              onClick={() => setTabActiva('analitica')}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                tabActiva === 'analitica'
                  ? 'bg-slate-800 text-sky-400 border-b-2 border-sky-400 font-bold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Analítica
            </button>

            {/* 4. Configuración de Granja */}
            <button
              onClick={() => setTabActiva('configuracion')}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                tabActiva === 'configuracion'
                  ? 'bg-slate-800 text-sky-400 border-b-2 border-sky-400 font-bold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Configuración & Estanques
            </button>

            {/* 5. Personal y Permisos */}
            <button
              onClick={() => setTabActiva('usuarios')}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-1.5 ${
                tabActiva === 'usuarios'
                  ? 'bg-slate-800 text-sky-400 border-b-2 border-sky-400 font-bold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Users className="w-4 h-4 text-sky-400" />
              <span>Personal & Permisos</span>
            </button>
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
                      esAdmin
                        ? 'text-amber-400 font-bold'
                        : perfilUsuario?.estado === 'activo'
                        ? 'text-emerald-400 font-semibold'
                        : 'text-amber-400'
                    }`}>
                      {esAdmin ? (
                        <>Administrador Maestro</>
                      ) : perfilUsuario?.estado === 'activo' ? (
                        <>{perfilUsuario.cargo || 'Operario Activo'}</>
                      ) : (
                        <>En espera de Carlos</>
                      )}
                    </p>
                  </div>
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

        {/* Navegación móvil con 5 pestañas */}
        <div className="md:hidden flex border-t border-slate-800 py-2 space-x-1 overflow-x-auto">
          <button
            onClick={() => setTabActiva('inicio')}
            className={`px-3 py-1 text-xs rounded font-medium whitespace-nowrap ${tabActiva === 'inicio' ? 'bg-sky-600 text-white font-bold' : 'text-slate-300'}`}
          >
            Inicio
          </button>
          <button
            onClick={() => setTabActiva('lotes')}
            className={`px-3 py-1 text-xs rounded font-medium whitespace-nowrap ${tabActiva === 'lotes' ? 'bg-sky-600 text-white font-bold' : 'text-slate-300'}`}
          >
            Lotes
          </button>
          <button
            onClick={() => setTabActiva('analitica')}
            className={`px-3 py-1 text-xs rounded font-medium whitespace-nowrap ${tabActiva === 'analitica' ? 'bg-sky-600 text-white font-bold' : 'text-slate-300'}`}
          >
            Analítica
          </button>
          <button
            onClick={() => setTabActiva('configuracion')}
            className={`px-3 py-1 text-xs rounded font-medium whitespace-nowrap ${tabActiva === 'configuracion' ? 'bg-sky-600 text-white font-bold' : 'text-slate-300'}`}
          >
            Configuración
          </button>
          <button
            onClick={() => setTabActiva('usuarios')}
            className={`px-3 py-1 text-xs rounded font-medium whitespace-nowrap ${tabActiva === 'usuarios' ? 'bg-sky-600 text-white font-bold' : 'text-slate-300'}`}
          >
            Personal & Permisos
          </button>
        </div>
      </div>
    </header>
  );
};
