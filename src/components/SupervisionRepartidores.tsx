import React, { useMemo, useState } from 'react';
import { Truck, Info } from 'lucide-react';
import { OrdenEntrega } from '../types';
import { Repartidor, cantidadPendiente } from '../services/pedidosService';
import { cambiosDeEvento, resumenRepartidores } from '../services/seguimientoService';
import { formatearFechaColombia } from '../utils/constants';
import { EstadoOrdenBadge, num } from './entregasUi';

/**
 * Supervisión de repartidores: carga y avance de cada uno según sus órdenes y las acciones que
 * registró. No hay geolocalización; solo se muestran los eventos registrados por el repartidor.
 */
export const SupervisionRepartidores: React.FC<{
  ordenes: OrdenEntrega[];
  repartidores: Repartidor[];
  onAbrirOrden: (id: string) => void;
}> = ({ ordenes, repartidores, onAbrirOrden }) => {
  const resumen = useMemo(() => resumenRepartidores(ordenes, repartidores), [ordenes, repartidores]);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const sel = resumen.find((r) => r.uid === seleccionado) || null;

  const ordenesSel = sel ? ordenes.filter((o) => o.repartidorUid === sel.uid && o.estado !== 'borrador') : [];
  const actividadSel = sel
    ? ordenes
        .flatMap((o) => (o.historial || []).filter((e) => e.registradoPorUid === sel.uid && e.funcion === 'courier').map((e) => ({ o, e })))
        .sort((a, b) => b.e.fecha.localeCompare(a.e.fecha))
        .slice(0, 50)
    : [];

  return (
    <div className="space-y-3 text-xs">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center space-x-1.5">
          <Truck className="w-4 h-4 text-violet-600" />
          <span className="font-bold text-slate-900">Supervisión de repartidores</span>
        </div>
        <table className="w-full text-left min-w-[720px]">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Repartidor</th>
              <th className="px-3 py-2">Cargo visible</th>
              <th className="px-3 py-2 text-right">Asignados</th>
              <th className="px-3 py-2 text-right">Pendientes</th>
              <th className="px-3 py-2 text-right">En ruta</th>
              <th className="px-3 py-2 text-right">Parciales</th>
              <th className="px-3 py-2 text-right">Completadas</th>
              <th className="px-3 py-2 text-right">Novedades</th>
              <th className="px-3 py-2">Última actividad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {resumen.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">No hay repartidores con actividad.</td></tr>
            )}
            {resumen.map((r) => (
              <tr
                key={r.uid}
                onClick={() => setSeleccionado(seleccionado === r.uid ? null : r.uid)}
                className={`cursor-pointer hover:bg-slate-50 ${seleccionado === r.uid ? 'bg-sky-50' : ''}`}
              >
                <td className="px-3 py-2 font-semibold text-slate-900">
                  {r.nombre}
                  {!r.activo && <span className="block text-[10px] font-normal text-slate-400">ya no figura como repartidor activo</span>}
                </td>
                <td className="px-3 py-2 text-slate-600">{r.cargo || '—'}</td>
                <td className="px-3 py-2 text-right">{r.asignados}</td>
                <td className="px-3 py-2 text-right">{r.pendientes}</td>
                <td className="px-3 py-2 text-right">{r.enRuta}</td>
                <td className="px-3 py-2 text-right">{r.parciales}</td>
                <td className="px-3 py-2 text-right">{r.completadas}</td>
                <td className="px-3 py-2 text-right">{r.novedades}</td>
                <td className="px-3 py-2 text-slate-600">{r.ultimaActividad ? formatearFechaColombia(r.ultimaActividad) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex items-center space-x-1 text-[11px] text-slate-500">
        <Info className="w-3.5 h-3.5" />
        <span>La actividad corresponde solo a las acciones que registra cada repartidor; la plataforma no usa ubicación GPS.</span>
      </p>

      {sel && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-2">
            <span className="font-bold text-slate-900">Pedidos de {sel.nombre} ({ordenesSel.length})</span>
            {ordenesSel.length === 0 && <p className="text-slate-500">Sin pedidos asignados.</p>}
            {ordenesSel.map((o) => (
              <button key={o.id} onClick={() => onAbrirOrden(o.id)} className="w-full text-left border border-slate-200 rounded-lg p-2 hover:border-sky-400">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold">{o.id}</span>
                  <EstadoOrdenBadge estado={o.estado} />
                </span>
                <span className="block text-slate-600">
                  {o.clienteNombre} · entregado {num(o.cantidadEntregada)} de {num(o.cantidadAutorizada)} {o.unidad} · pendiente {num(cantidadPendiente(o))}
                </span>
              </button>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-2">
            <span className="font-bold text-slate-900">Actividad registrada (últimas 50)</span>
            {actividadSel.length === 0 && <p className="text-slate-500">Todavía no ha registrado acciones.</p>}
            <ol className="space-y-1">
              {actividadSel.map(({ o, e }) => (
                <li key={`${o.id}-${e.indice}`} className="border-l-2 border-slate-200 pl-2">
                  <span className="font-semibold text-slate-800">{e.tipo}</span>
                  <span className="text-slate-500"> · {formatearFechaColombia(e.fecha)} · </span>
                  <button onClick={() => onAbrirOrden(o.id)} className="font-mono text-sky-700 hover:underline">{o.id}</button>
                  {(e.descripcion || cambiosDeEvento(e)) && (
                    <span className="block text-slate-600">{[e.descripcion, cambiosDeEvento(e)].filter(Boolean).join(' · ')}</span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
};
