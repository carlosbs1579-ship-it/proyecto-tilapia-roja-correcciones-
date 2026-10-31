import React, { useEffect, useMemo, useState } from 'react';
import { Truck, Info, AlertCircle, MapPin, WifiOff, Wifi, RefreshCw, ChevronRight, Repeat } from 'lucide-react';
import { EstadoOrden, OrdenEntrega, UsuarioPerfil } from '../types';
import { nombreFuncion } from '../services/usuariosService';
import { cantidadPendiente } from '../services/pedidosService';
import {
  AccionReparto,
  escucharBandeja,
  escucharMisEntregas,
  iniciarSincronizacion,
  procesarBandeja
} from '../services/repartoService';
import { formatearFechaColombia } from '../utils/constants';
import { DetalleEntregaRepartidor } from './DetalleEntregaRepartidor';

interface RepartidorPanelProps {
  perfil: UsuarioPerfil;
}

// Nombres sencillos de los estados para el repartidor
const ETIQUETA_REPARTIDOR: Record<EstadoOrden, string> = {
  borrador: 'Borrador',
  asignado: 'Pendiente',
  en_preparacion: 'En preparación',
  en_ruta: 'En ruta',
  entrega_parcial: 'Entrega parcial',
  entregado: 'Entregado',
  requiere_revision: 'Requiere revisión',
  cancelado: 'Cancelado'
};

type Filtro = 'activas' | 'asignado' | 'en_preparacion' | 'en_ruta' | 'entrega_parcial' | 'entregado' | 'requiere_revision';

const FILTROS: { id: Filtro; etiqueta: string }[] = [
  { id: 'activas', etiqueta: 'Por hacer' },
  { id: 'asignado', etiqueta: 'Pendientes' },
  { id: 'en_preparacion', etiqueta: 'En preparación' },
  { id: 'en_ruta', etiqueta: 'En ruta' },
  { id: 'entrega_parcial', etiqueta: 'Parciales' },
  { id: 'entregado', etiqueta: 'Finalizadas' },
  { id: 'requiere_revision', etiqueta: 'Requieren revisión' }
];

const num = (n: number) => (Number(n) || 0).toLocaleString('es-CO');

/**
 * "Mis entregas": las órdenes asignadas al repartidor y sus acciones (iniciar ruta, llegada, entrega,
 * novedades y solicitudes de ajuste). Funciona con conexión limitada: muestra la última copia
 * guardada y envía las acciones al recuperar la señal.
 */
export const RepartidorPanel: React.FC<RepartidorPanelProps> = ({ perfil }) => {
  const uid = perfil.uid;
  const [ordenes, setOrdenes] = useState<OrdenEntrega[]>([]);
  const [desdeServidor, setDesdeServidor] = useState(false);
  const [guardadaEn, setGuardadaEn] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [acciones, setAcciones] = useState<AccionReparto[]>([]);
  const [enLinea, setEnLinea] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [filtro, setFiltro] = useState<Filtro>('activas');
  const [seleccionada, setSeleccionada] = useState<string | null>(null);

  useEffect(() => {
    setCargando(true);
    const cancelarOrdenes = escucharMisEntregas(
      uid,
      (lista, origen) => {
        setOrdenes(lista);
        setDesdeServidor(origen.desdeServidor);
        setGuardadaEn(origen.guardadaEn);
        setCargando(false);
        if (origen.desdeServidor) setErrorCarga(null);
      },
      () => {
        setCargando(false);
        setErrorCarga('No fue posible actualizar tus entregas desde el servidor.');
      }
    );
    const cancelarBandeja = escucharBandeja(uid, setAcciones);
    const detenerSincronizacion = iniciarSincronizacion(uid);
    const alCambiar = () => setEnLinea(navigator.onLine);
    window.addEventListener('online', alCambiar);
    window.addEventListener('offline', alCambiar);
    return () => {
      cancelarOrdenes();
      cancelarBandeja();
      detenerSincronizacion();
      window.removeEventListener('online', alCambiar);
      window.removeEventListener('offline', alCambiar);
    };
  }, [uid]);

  // Los borradores aún no son una asignación en firme; las canceladas no requieren acción
  const visibles = ordenes.filter((o) => o.estado !== 'borrador' && o.estado !== 'cancelado');
  const filtradas = useMemo(
    () =>
      visibles.filter((o) =>
        filtro === 'activas' ? !['entregado'].includes(o.estado) : o.estado === filtro
      ),
    [visibles, filtro]
  );
  const porEnviar = acciones.filter((a) => a.estado === 'guardada' || a.estado === 'enviando');
  const conflictos = acciones.filter((a) => a.estado === 'conflicto');
  const orden = seleccionada ? ordenes.find((o) => o.id === seleccionada) : null;

  if (orden) {
    return (
      <div className="space-y-3">
        <EstadoConexion
          enLinea={enLinea}
          desdeServidor={desdeServidor}
          guardadaEn={guardadaEn}
          porEnviar={porEnviar.length}
          onEnviar={() => void procesarBandeja(uid)}
        />
        <DetalleEntregaRepartidor
          uid={uid}
          orden={orden}
          acciones={acciones.filter((a) => a.ordenId === orden.id)}
          etiquetaEstado={ETIQUETA_REPARTIDOR[orden.estado]}
          onVolver={() => setSeleccionada(null)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center space-x-3">
        <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
          <Truck className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-900">Mis entregas</h1>
          <p className="text-xs text-slate-500">
            {perfil.displayName || perfil.email} • {nombreFuncion(perfil, 'courier')}
          </p>
        </div>
      </div>

      <EstadoConexion
        enLinea={enLinea}
        desdeServidor={desdeServidor}
        guardadaEn={guardadaEn}
        porEnviar={porEnviar.length}
        onEnviar={() => void procesarBandeja(uid)}
      />

      {conflictos.length > 0 && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm flex items-start space-x-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>
            {conflictos.length} acción(es) no se aplicaron porque el pedido cambió. Ábrelo para ver el detalle.
          </span>
        </div>
      )}

      {errorCarga && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm flex items-center space-x-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorCarga}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => {
          const cantidad = f.id === 'activas'
            ? visibles.filter((o) => o.estado !== 'entregado').length
            : visibles.filter((o) => o.estado === f.id).length;
          return (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className={`px-3 py-2 rounded-full text-sm font-semibold border ${
                filtro === f.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300'
              }`}
            >
              {f.etiqueta} ({cantidad})
            </button>
          );
        })}
      </div>

      {cargando ? (
        <p className="text-sm text-slate-500">Cargando tus entregas...</p>
      ) : filtradas.length === 0 ? (
        <div className="p-4 bg-sky-50 border border-sky-200 rounded-xl flex items-start space-x-2 text-sky-900 text-sm">
          <Info className="w-5 h-5 shrink-0 text-sky-600" />
          <span>No tienes pedidos en esta lista.</span>
        </div>
      ) : (
        <div className="space-y-3">
          {filtradas.map((o) => {
            const pendientesOrden = porEnviar.filter((a) => a.ordenId === o.id).length;
            const solicitudPendiente = Object.values(o.ajustes || {}).some((a) => a.estado === 'pendiente_aprobacion');
            return (
              <button
                key={o.id}
                onClick={() => setSeleccionada(o.id)}
                className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-sky-400 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-bold text-slate-900">{o.clienteNombre}</span>
                  <span className="flex items-center space-x-1 shrink-0">
                    <span className="px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 border border-sky-300 text-xs font-bold">
                      {ETIQUETA_REPARTIDOR[o.estado]}
                    </span>
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                  </span>
                </div>
                <p className="flex items-start space-x-1.5 text-sm text-slate-600">
                  <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
                  <span>{o.clienteDireccion || 'Sin dirección registrada'}</span>
                </p>
                <p className="text-sm text-slate-800">
                  <strong>{num(o.estado === 'entregado' ? o.cantidadEntregada : cantidadPendiente(o))} {o.unidad}</strong>
                  {o.estado === 'entregado' ? ' entregados' : ` por entregar de ${num(o.cantidadAutorizada)} autorizados`}
                  <span className="text-slate-500"> · {o.fechaProgramada || 'sin fecha'}</span>
                </p>
                <p className="text-[11px] text-slate-400 font-mono">{o.id}</p>
                {(pendientesOrden > 0 || solicitudPendiente) && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {pendientesOrden > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold">
                        {pendientesOrden} acción(es) por enviar
                      </span>
                    )}
                    {solicitudPendiente && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[11px] font-semibold flex items-center space-x-1">
                        <Repeat className="w-3 h-3" />
                        <span>Ajuste pendiente de aprobación</span>
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const EstadoConexion: React.FC<{
  enLinea: boolean;
  desdeServidor: boolean;
  guardadaEn: string | null;
  porEnviar: number;
  onEnviar: () => void;
}> = ({ enLinea, desdeServidor, guardadaEn, porEnviar, onEnviar }) => {
  if (enLinea && porEnviar === 0) {
    return (
      <p className="flex items-center space-x-1.5 text-xs text-emerald-700">
        <Wifi className="w-4 h-4" />
        <span>Conectado · datos al día</span>
      </p>
    );
  }
  return (
    <div className={`p-3 rounded-xl border text-sm flex flex-wrap items-center justify-between gap-2 ${
      enLinea ? 'bg-sky-50 border-sky-200 text-sky-900' : 'bg-amber-50 border-amber-300 text-amber-900'
    }`}>
      <span className="flex items-center space-x-2">
        {enLinea ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
        <span>
          {enLinea ? 'Conectado' : 'Sin conexión'}
          {!enLinea && !desdeServidor && guardadaEn && ` · mostrando lo guardado el ${formatearFechaColombia(guardadaEn)}`}
          {porEnviar > 0 && ` · ${porEnviar} acción(es) guardada(s) en el teléfono por enviar`}
        </span>
      </span>
      {enLinea && porEnviar > 0 && (
        <button onClick={onEnviar} className="inline-flex items-center space-x-1 px-3 py-1.5 bg-sky-600 text-white rounded-lg text-xs font-bold">
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Enviar ahora</span>
        </button>
      )}
    </div>
  );
};
