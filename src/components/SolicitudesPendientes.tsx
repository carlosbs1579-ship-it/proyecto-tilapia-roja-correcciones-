import React, { useMemo, useState } from 'react';
import { CheckCircle, AlertTriangle, Repeat } from 'lucide-react';
import { AjusteDistribucion, InventarioLote, Lote, OrdenEntrega } from '../types';
import { aprobarAjuste, rechazarAjuste } from '../services/pedidosService';
import { diferenciasAjuste, todasLasSolicitudes } from '../services/seguimientoService';
import { formatearFechaColombia } from '../utils/constants';
import { EstadoOrdenBadge, num } from './entregasUi';

export const ETIQUETA_AJUSTE: Record<string, string> = {
  pendiente_aprobacion: 'Recibida · pendiente de aprobación',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada por el repartidor',
  aplicada: 'Aprobada y aplicada'
};

const ESTILO_AJUSTE: Record<string, string> = {
  pendiente_aprobacion: 'bg-indigo-50 border-indigo-200 text-indigo-800',
  aprobada: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  aplicada: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  rechazada: 'bg-red-50 border-red-200 text-red-700',
  cancelada: 'bg-slate-100 border-slate-300 text-slate-600'
};

type Ejecutar = (accion: () => Promise<void>, exito: string) => Promise<void>;

/**
 * Tarjeta de una solicitud de ajuste: distribución original y propuesta, diferencias por lote,
 * disponibilidad actual y, si está pendiente, aprobar (aplicar) o rechazar.
 */
export const SolicitudAjusteTarjeta: React.FC<{
  orden: OrdenEntrega;
  ajuste: AjusteDistribucion;
  lotes: Lote[];
  inventario: Record<string, InventarioLote>;
  uidActual: string | undefined;
  procesando: boolean;
  ejecutar: Ejecutar;
  mostrarOrden?: boolean;
}> = ({ orden: o, ajuste: a, lotes, inventario, uidActual, procesando, ejecutar, mostrarOrden }) => {
  const [respuesta, setRespuesta] = useState('');
  const pendiente = a.estado === 'pendiente_aprobacion';
  const diferencias = useMemo(() => diferenciasAjuste(o, a, lotes, inventario), [o, a, lotes, inventario]);
  const propia = a.solicitadoPorUid === uidActual;
  const aplicable = o.cantidadEntregada === 0 && ['asignado', 'en_preparacion', 'en_ruta', 'requiere_revision'].includes(o.estado);
  const sinDisponibilidad = diferencias.filter((d) => !d.suficiente);
  const original = Object.entries(a.original);
  const distribucionCambio = JSON.stringify(Object.entries(o.procedencias).map(([c, p]) => [c, p.cantidad]).sort())
    !== JSON.stringify(original.map(([c, p]) => [c, p.cantidad]).sort());

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-white text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-800">
          {mostrarOrden && <span className="font-mono text-slate-900">{o.id} · {o.clienteNombre} · </span>}
          {a.solicitadoPor} · {formatearFechaColombia(a.solicitadoEn)}
        </span>
        <span className={`px-2 py-0.5 rounded-full border font-semibold text-[10px] ${ESTILO_AJUSTE[a.estado]}`}>{ETIQUETA_AJUSTE[a.estado]}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] min-w-[420px]">
          <thead className="text-slate-500 text-left">
            <tr>
              <th className="py-1">Lote</th>
              <th className="py-1 text-right">Original (al solicitar)</th>
              <th className="py-1 text-right">Propuesto</th>
              {pendiente && <th className="py-1 text-right">Cambio</th>}
              {pendiente && <th className="py-1 text-right">Disponible hoy</th>}
            </tr>
          </thead>
          <tbody>
            {diferencias.map((d) => (
              <tr key={d.codigoLote} className={!d.suficiente ? 'text-red-700' : ''}>
                <td className="py-0.5 font-mono">{d.codigoLote}</td>
                <td className="py-0.5 text-right">{num(a.original[d.codigoLote]?.cantidad || 0)}</td>
                <td className="py-0.5 text-right font-semibold">{num(d.propuesta)}</td>
                {pendiente && (
                  <td className="py-0.5 text-right">
                    {d.diferencia === 0 ? '—' : `${d.diferencia > 0 ? '+' : ''}${num(d.diferencia)}`}
                  </td>
                )}
                {pendiente && (
                  <td className="py-0.5 text-right">
                    {d.diferencia > 0 ? (d.disponible === null ? '—' : num(d.disponible)) : 'se libera'}
                    {d.motivo && <span className="block">{d.motivo}</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-slate-600">Motivo: {a.motivo}</p>
      {a.respuesta && (
        <p className="text-slate-600">
          Respuesta de {a.resueltoPor} ({a.resueltoEn ? formatearFechaColombia(a.resueltoEn) : ''}): {a.respuesta}
        </p>
      )}

      {pendiente && (
        propia ? (
          <p className="text-amber-700">No puedes resolver una solicitud que hiciste tú.</p>
        ) : (
          <div className="space-y-1.5">
            {distribucionCambio && (
              <p className="text-amber-700">La distribución vigente cambió desde que se hizo la solicitud; el cambio se calcula sobre la vigente.</p>
            )}
            {!aplicable && (
              <p className="text-slate-500">La orden ya tiene entregas o está cerrada: solo se puede rechazar.</p>
            )}
            {aplicable && sinDisponibilidad.length > 0 && (
              <p className="text-red-700 flex items-center space-x-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>No se puede aprobar: {sinDisponibilidad.map((d) => d.codigoLote).join(', ')} sin disponibilidad suficiente.</span>
              </p>
            )}
            <input
              type="text"
              maxLength={1000}
              placeholder="Respuesta al repartidor (obligatoria para rechazar)"
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
            />
            <div className="flex flex-wrap gap-2">
              {aplicable && (
                <button
                  disabled={procesando || sinDisponibilidad.length > 0}
                  onClick={() => ejecutar(() => aprobarAjuste(o.id, a.id, respuesta), `Ajuste de ${o.id} aprobado y aplicado: reservas actualizadas.`)}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold disabled:opacity-50"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Aprobar y aplicar</span>
                </button>
              )}
              <button
                disabled={procesando}
                onClick={() => ejecutar(() => rechazarAjuste(o.id, a.id, respuesta), `Solicitud de ${o.id} rechazada; la distribución no cambió.`)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg font-semibold disabled:opacity-50"
              >
                Rechazar
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
};

/**
 * Bandeja de solicitudes de ajuste de todas las órdenes de la granja
 */
export const SolicitudesPendientes: React.FC<{
  ordenes: OrdenEntrega[];
  lotes: Lote[];
  inventario: Record<string, InventarioLote>;
  uidActual: string | undefined;
  procesando: boolean;
  ejecutar: Ejecutar;
  onAbrirOrden: (id: string) => void;
}> = ({ ordenes, lotes, inventario, uidActual, procesando, ejecutar, onAbrirOrden }) => {
  const [filtro, setFiltro] = useState<'pendientes' | 'todas'>('pendientes');
  const solicitudes = todasLasSolicitudes(ordenes).filter((s) => filtro === 'todas' || s.ajuste.estado === 'pendiente_aprobacion');

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate-900 flex items-center space-x-1.5">
          <Repeat className="w-4 h-4 text-indigo-600" />
          <span>Solicitudes de ajuste de distribución</span>
        </span>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value as any)} className="px-2.5 py-1 border border-slate-300 rounded-lg bg-white">
          <option value="pendientes">Pendientes de aprobación</option>
          <option value="todas">Todas (con resueltas)</option>
        </select>
      </div>
      {solicitudes.length === 0 ? (
        <p className="text-slate-500 py-6 text-center">No hay solicitudes {filtro === 'pendientes' ? 'pendientes' : 'registradas'}.</p>
      ) : (
        solicitudes.map(({ orden, ajuste }) => (
          <div key={`${orden.id}-${ajuste.id}`} className="space-y-1">
            <div className="flex items-center gap-2">
              <button onClick={() => onAbrirOrden(orden.id)} className="font-mono text-sky-700 hover:underline">{orden.id}</button>
              <EstadoOrdenBadge estado={orden.estado} />
            </div>
            <SolicitudAjusteTarjeta
              orden={orden}
              ajuste={ajuste}
              lotes={lotes}
              inventario={inventario}
              uidActual={uidActual}
              procesando={procesando}
              ejecutar={ejecutar}
            />
          </div>
        ))
      )}
    </div>
  );
};
