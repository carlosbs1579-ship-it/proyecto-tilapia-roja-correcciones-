import React from 'react';
import { Crown, Fish, Truck, ChevronRight, LogOut } from 'lucide-react';
import { RolFuncional, UsuarioPerfil } from '../types';
import { ETIQUETA_ROL, nombreFuncion } from '../services/usuariosService';

interface SelectorFuncionProps {
  perfil: UsuarioPerfil;
  funciones: RolFuncional[];
  onSeleccionar: (funcion: RolFuncional) => void;
  onCerrarSesion: () => void;
}

const ICONO_FUNCION: Record<RolFuncional, React.ReactNode> = {
  admin: <Crown className="w-5 h-5" />,
  operator: <Fish className="w-5 h-5" />,
  courier: <Truck className="w-5 h-5" />
};

const DESCRIPCION_FUNCION: Record<RolFuncional, string> = {
  admin: 'Personal, permisos, configuración y producción',
  operator: 'Lotes, eventos de producción y analítica',
  courier: 'Panel de reparto'
};

/**
 * Pantalla para elegir con qué función trabajar cuando la cuenta tiene varias. Elegir una función
 * solo cambia lo que se muestra; los permisos reales siguen siendo los roles asignados.
 */
export const SelectorFuncion: React.FC<SelectorFuncionProps> = ({
  perfil,
  funciones,
  onSeleccionar,
  onCerrarSesion
}) => (
  <div className="max-w-md mx-auto bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-4">
    <div>
      <h1 className="text-base font-bold text-slate-900">¿Con qué función deseas trabajar?</h1>
      <p className="text-xs text-slate-500 mt-0.5">
        {perfil.displayName || perfil.email} • Puedes cambiar de función en cualquier momento desde la barra superior.
      </p>
    </div>

    <div className="space-y-2">
      {funciones.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onSeleccionar(f)}
          className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-sky-400 hover:bg-sky-50 text-left transition-colors"
        >
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0">
              {ICONO_FUNCION[f]}
            </div>
            <div>
              <span className="block text-sm font-bold text-slate-900">{nombreFuncion(perfil, f)}</span>
              <span className="block text-[11px] text-slate-500">
                {ETIQUETA_ROL[f]} • {DESCRIPCION_FUNCION[f]}
              </span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>
      ))}
    </div>

    <button
      type="button"
      onClick={onCerrarSesion}
      className="inline-flex items-center space-x-1.5 text-xs text-slate-500 hover:text-red-600"
    >
      <LogOut className="w-3.5 h-3.5" />
      <span>Cerrar sesión</span>
    </button>
  </div>
);
