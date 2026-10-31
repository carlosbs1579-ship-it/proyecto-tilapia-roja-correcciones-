import React, { useEffect, useState } from 'react';
import { Truck, Info, AlertCircle, MapPin } from 'lucide-react';
import { OrdenEntrega, UsuarioPerfil } from '../types';
import { nombreFuncion } from '../services/usuariosService';
import { ETIQUETA_ESTADO_ORDEN, cantidadPendiente, escucharOrdenesRepartidor } from '../services/pedidosService';
import { formatearFechaColombia } from '../utils/constants';

interface RepartidorPanelProps {
  perfil: UsuarioPerfil;
}

const num = (n: number) => (Number(n) || 0).toLocaleString('es-CO');

/**
 * Panel de la función de repartidor. Por ahora muestra, solo para consulta, las órdenes que tiene
 * asignadas; la confirmación de entregas se incorporará en la siguiente fase. El repartidor no
 * tiene acceso a la información productiva de la granja.
 */
export const RepartidorPanel: React.FC<RepartidorPanelProps> = ({ perfil }) => {
  const [ordenes, setOrdenes] = useState<OrdenEntrega[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  useEffect(() => {
    setCargando(true);
    return escucharOrdenesRepartidor(
      perfil.uid,
      (lista) => {
        setOrdenes(lista);
        setCargando(false);
        setErrorCarga(null);
      },
      () => {
        setCargando(false);
        setErrorCarga('No fue posible cargar tus órdenes asignadas.');
      }
    );
  }, [perfil.uid]);

  // Los borradores aún no son una asignación en firme y las canceladas ya no requieren acción
  const activas = ordenes.filter((o) => !['borrador', 'cancelado', 'entregado'].includes(o.estado));

  return (
    <div className="max-w-3xl mx-auto bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-4">
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

      {errorCarga && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-2 text-red-800 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorCarga}</span>
        </div>
      )}

      {cargando ? (
        <p className="text-xs text-slate-500">Cargando tus órdenes...</p>
      ) : activas.length === 0 ? (
        <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg flex items-start space-x-2 text-sky-900 text-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-600" />
          <span>No tienes órdenes de entrega asignadas en este momento.</span>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Órdenes asignadas a ti ({activas.length}). Solo consulta: el registro de entregas estará disponible próximamente.
          </p>
          {activas.map((o) => (
            <div key={o.id} className="border border-slate-200 rounded-lg p-4 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono font-bold text-slate-900">{o.id}</span>
                <span className="px-2 py-0.5 rounded-full border border-sky-300 bg-sky-100 text-sky-800 font-semibold text-[10px]">
                  {ETIQUETA_ESTADO_ORDEN[o.estado]}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <span className="flex items-center space-x-1 text-slate-800">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <strong>{o.clienteNombre}</strong>
                </span>
                <span className="text-slate-700">
                  Por entregar: <strong>{num(cantidadPendiente(o))} {o.unidad}</strong>
                </span>
                <span className="text-slate-700">
                  Entrega: <strong>{o.fechaProgramada || 'sin fecha programada'}</strong>
                </span>
              </div>
              <div className="text-slate-600">
                Procedencia:{' '}
                {Object.entries(o.procedencias || {})
                  .map(([codigo, p]) => `${codigo} (piscina ${p.estanque}): ${num(p.cantidad)} ${p.unidad}`)
                  .join(' • ')}
              </div>
              {o.observaciones && <div className="text-slate-600">Observaciones: {o.observaciones}</div>}
              <div className="text-[10px] text-slate-400">Asignada el {formatearFechaColombia(o.actualizadoEn)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
