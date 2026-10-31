import React, { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { EstadoOrden, OrdenEntrega } from '../types';
import { ETIQUETA_ESTADO_ORDEN } from '../services/pedidosService';
import { cambiosDeEvento, diaBogota, historialGeneral } from '../services/seguimientoService';
import { formatearFechaColombia } from '../utils/constants';
import { ETIQUETA_FUNCION, EstadoOrdenBadge } from './entregasUi';

/**
 * Historial general de las órdenes de entrega: une los eventos de todas las órdenes (la misma
 * auditoría de cada orden, sin una estructura aparte). Solo lectura.
 */
export const HistorialEntregas: React.FC<{
  ordenes: OrdenEntrega[];
  onAbrirOrden: (id: string) => void;
}> = ({ ordenes, onAbrirOrden }) => {
  const eventos = useMemo(() => historialGeneral(ordenes), [ordenes]);
  const [pedido, setPedido] = useState('');
  const [usuario, setUsuario] = useState('');
  const [repartidor, setRepartidor] = useState('');
  const [tipo, setTipo] = useState('');
  const [estado, setEstado] = useState<'' | EstadoOrden>('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [limite, setLimite] = useState(100);

  const usuarios = Array.from(new Set(eventos.map((x) => x.evento.registradoPor))).sort();
  const repartidores = Array.from(new Set(ordenes.map((o) => o.repartidorNombre).filter(Boolean) as string[])).sort();
  const tipos = Array.from(new Set(eventos.map((x) => x.evento.tipo))).sort();

  const filtrados = eventos.filter(({ orden, evento }) => {
    const dia = diaBogota(evento.fecha);
    return (!pedido || orden.id.toLowerCase().includes(pedido.toLowerCase()))
      && (!usuario || evento.registradoPor === usuario)
      && (!repartidor || orden.repartidorNombre === repartidor)
      && (!tipo || evento.tipo === tipo)
      && (!estado || orden.estado === estado)
      && (!desde || dia >= desde)
      && (!hasta || dia <= hasta);
  });

  const campo = 'px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white';

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3 text-xs">
      <span className="font-bold text-slate-900 flex items-center space-x-1.5">
        <History className="w-4 h-4 text-slate-600" />
        <span>Historial y auditoría de entregas</span>
      </span>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <input className={campo} placeholder="Pedido (PED-...)" value={pedido} onChange={(e) => setPedido(e.target.value)} />
        <select className={campo} value={usuario} onChange={(e) => setUsuario(e.target.value)}>
          <option value="">Todos los usuarios</option>
          {usuarios.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select className={campo} value={repartidor} onChange={(e) => setRepartidor(e.target.value)}>
          <option value="">Todos los repartidores</option>
          {repartidores.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className={campo} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos los eventos</option>
          {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className={campo} value={estado} onChange={(e) => setEstado(e.target.value as any)}>
          <option value="">Estado actual: todos</option>
          {(Object.keys(ETIQUETA_ESTADO_ORDEN) as EstadoOrden[]).map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO_ORDEN[e]}</option>)}
        </select>
        <input type="date" className={campo} value={desde} onChange={(e) => setDesde(e.target.value)} title="Desde" />
        <input type="date" className={campo} value={hasta} onChange={(e) => setHasta(e.target.value)} title="Hasta" />
      </div>
      <p className="text-[11px] text-slate-500">
        {filtrados.length} evento(s). Los eventos no se editan ni se borran; cada cambio agrega uno nuevo.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left min-w-[860px]">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Fecha y hora</th>
              <th className="px-2 py-2">Pedido</th>
              <th className="px-2 py-2">Evento</th>
              <th className="px-2 py-2">Usuario (función)</th>
              <th className="px-2 py-2">Cambio</th>
              <th className="px-2 py-2">Motivo u observación</th>
              <th className="px-2 py-2">Id del evento</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {filtrados.slice(0, limite).map(({ orden, evento }) => (
              <tr key={`${orden.id}-${evento.indice}`}>
                <td className="px-2 py-1.5 whitespace-nowrap">{formatearFechaColombia(evento.fecha)}</td>
                <td className="px-2 py-1.5">
                  <button onClick={() => onAbrirOrden(orden.id)} className="font-mono text-sky-700 hover:underline">{orden.id}</button>
                  <span className="block mt-0.5"><EstadoOrdenBadge estado={orden.estado} /></span>
                </td>
                <td className="px-2 py-1.5 font-semibold text-slate-800">{evento.tipo}</td>
                <td className="px-2 py-1.5">
                  {evento.registradoPor}
                  <span className="block text-slate-500">{evento.funcion ? ETIQUETA_FUNCION[evento.funcion] : 'sin función registrada'}</span>
                </td>
                <td className="px-2 py-1.5 text-slate-700">{cambiosDeEvento(evento) || '—'}</td>
                <td className="px-2 py-1.5 text-slate-700">{evento.descripcion || '—'}</td>
                <td className="px-2 py-1.5 font-mono text-[10px] text-slate-400">{evento.eventoId ? evento.eventoId.slice(0, 8) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtrados.length > limite && (
        <button onClick={() => setLimite(limite + 100)} className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-semibold">
          Ver 100 más
        </button>
      )}
    </div>
  );
};
