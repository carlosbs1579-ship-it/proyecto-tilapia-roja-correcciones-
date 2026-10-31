import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { EstadoAtencion, OrdenEntrega } from '../types';
import { atenderNovedad } from '../services/pedidosService';
import { ETIQUETA_ATENCION, NovedadRegistrada, todasLasNovedades } from '../services/seguimientoService';
import { formatearFechaColombia } from '../utils/constants';
import { EstadoAtencionBadge, EstadoOrdenBadge } from './entregasUi';

type Ejecutar = (accion: () => Promise<void>, exito: string) => Promise<void>;

const ESTADOS: EstadoAtencion[] = ['pendiente', 'en_revision', 'atendida', 'cerrada'];

/**
 * Atención de una novedad: el operador cambia su estado interno y deja observaciones o acciones
 * tomadas. Lo que registró el repartidor no se modifica.
 */
export const NovedadTarjeta: React.FC<{
  novedad: NovedadRegistrada;
  procesando: boolean;
  ejecutar: Ejecutar;
  mostrarOrden?: boolean;
  onAbrirOrden?: (id: string) => void;
}> = ({ novedad: n, procesando, ejecutar, mostrarOrden, onAbrirOrden }) => {
  const [estado, setEstado] = useState<EstadoAtencion>(n.atencion);
  const [observacion, setObservacion] = useState('');

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-white text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-800 flex flex-wrap items-center gap-1.5">
          {mostrarOrden && (
            <button onClick={() => onAbrirOrden?.(n.orden.id)} className="font-mono text-sky-700 hover:underline">{n.orden.id}</button>
          )}
          {mostrarOrden && <EstadoOrdenBadge estado={n.orden.estado} />}
          <span>{n.categoria}</span>
        </span>
        <EstadoAtencionBadge estado={n.atencion} />
      </div>
      <p className="text-slate-800 bg-orange-50 border border-orange-100 rounded p-2">{n.evento.descripcion}</p>
      <p className="text-slate-500">
        {n.evento.registradoPor} · {formatearFechaColombia(n.evento.fecha)} · Pedido de {n.orden.clienteNombre}
        {' · '}Evidencias: no adjuntas (las novedades se registran solo con texto)
      </p>
      {n.seguimiento.length > 0 && (
        <ol className="space-y-0.5 border-l-2 border-slate-200 pl-2">
          {n.seguimiento.map((s) => (
            <li key={s.indice} className="text-slate-600">
              <strong>{ETIQUETA_ATENCION[s.datos.estado as EstadoAtencion] || s.datos.estado}</strong> · {s.registradoPor} ·{' '}
              {formatearFechaColombia(s.fecha)}
              {s.descripcion && <span className="block">{s.descripcion}</span>}
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoAtencion)} className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white">
          {ESTADOS.map((e) => (
            <option key={e} value={e}>{ETIQUETA_ATENCION[e]}</option>
          ))}
        </select>
        <input
          type="text"
          maxLength={1000}
          placeholder="Observación o acción tomada"
          value={observacion}
          onChange={(e) => setObservacion(e.target.value)}
          className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg"
        />
        <button
          disabled={procesando || (estado === n.atencion && !observacion.trim()) || !n.evento.eventoId}
          onClick={() =>
            ejecutar(
              () => atenderNovedad(n.orden.id, n.evento.eventoId as string, estado, observacion),
              `Novedad de ${n.orden.id}: ${ETIQUETA_ATENCION[estado]}.`
            ).then(() => setObservacion(''))
          }
          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold disabled:opacity-50"
        >
          Registrar
        </button>
      </div>
    </div>
  );
};

/**
 * Bandeja de novedades e incidencias de todos los repartidores
 */
export const NovedadesIncidencias: React.FC<{
  ordenes: OrdenEntrega[];
  procesando: boolean;
  ejecutar: Ejecutar;
  onAbrirOrden: (id: string) => void;
}> = ({ ordenes, procesando, ejecutar, onAbrirOrden }) => {
  const [filtro, setFiltro] = useState<'abiertas' | EstadoAtencion | 'todas'>('abiertas');
  const novedades = todasLasNovedades(ordenes).filter((n) =>
    filtro === 'todas' ? true : filtro === 'abiertas' ? n.atencion === 'pendiente' || n.atencion === 'en_revision' : n.atencion === filtro
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate-900 flex items-center space-x-1.5">
          <AlertTriangle className="w-4 h-4 text-orange-600" />
          <span>Novedades e incidencias</span>
        </span>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value as any)} className="px-2.5 py-1 border border-slate-300 rounded-lg bg-white">
          <option value="abiertas">Por atender (pendientes y en revisión)</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>{ETIQUETA_ATENCION[e]}</option>
          ))}
          <option value="todas">Todas</option>
        </select>
      </div>
      <p className="text-[11px] text-slate-500">El estado de atención es interno y no cambia el estado de la orden.</p>
      {novedades.length === 0 ? (
        <p className="text-slate-500 py-6 text-center">No hay novedades en esta lista.</p>
      ) : (
        novedades.map((n) => (
          <NovedadTarjeta
            key={`${n.orden.id}-${n.evento.indice}`}
            novedad={n}
            procesando={procesando}
            ejecutar={ejecutar}
            mostrarOrden
            onAbrirOrden={onAbrirOrden}
          />
        ))
      )}
    </div>
  );
};
