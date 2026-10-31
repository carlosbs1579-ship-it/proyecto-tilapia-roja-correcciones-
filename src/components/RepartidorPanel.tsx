import React from 'react';
import { Truck, Info } from 'lucide-react';
import { UsuarioPerfil } from '../types';
import { nombreFuncion } from '../services/usuariosService';

interface RepartidorPanelProps {
  perfil: UsuarioPerfil;
}

/**
 * Panel de la función de repartidor. Las órdenes de entrega se incorporarán en la siguiente fase;
 * por ahora el repartidor no tiene acceso a la información productiva de la granja.
 */
export const RepartidorPanel: React.FC<RepartidorPanelProps> = ({ perfil }) => (
  <div className="max-w-2xl mx-auto bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-4">
    <div className="flex items-center space-x-3 pb-3 border-b border-slate-100">
      <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
        <Truck className="w-6 h-6" />
      </div>
      <div>
        <h1 className="text-base font-bold text-slate-900">Panel de reparto</h1>
        <p className="text-xs text-slate-500">
          {perfil.displayName || perfil.email} • {nombreFuncion(perfil, 'courier')}
        </p>
      </div>
    </div>

    <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg flex items-start space-x-2 text-sky-900 text-xs">
      <Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-600" />
      <span>
        Aún no hay órdenes de entrega asignadas. El registro de órdenes y su seguimiento estarán disponibles en
        este panel próximamente.
      </span>
    </div>
  </div>
);
