import React, { useState } from 'react';
import { escalon, usePrimerMontaje } from '../lib/montaje';
import {
  Search,
  Filter,
  Plus,
  QrCode,
  FileText,
  Calendar,
  X,
  ExternalLink,
  Fish
} from 'lucide-react';
import { Lote, ConfiguracionGeneral } from '../types';

interface LotesTabProps {
  lotes: Lote[];
  config: ConfiguracionGeneral;
  onNuevoLote: () => void;
  onSeleccionarLote: (lote: Lote) => void;
  onAbrirQr: (lote: Lote) => void;
  puedeBuscar?: boolean;
  puedeDocumentos?: boolean;
}

export const LotesTab: React.FC<LotesTabProps> = ({
  lotes,
  config,
  onNuevoLote,
  onSeleccionarLote,
  onAbrirQr,
  puedeBuscar = true,
  puedeDocumentos = true
}) => {
  const primerMontaje = usePrimerMontaje();
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstanque, setFiltroEstanque] = useState('todos');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  // Filtrado en memoria en cliente para máxima agilidad sin índices compuestos
  const lotesFiltrados = lotes.filter((lote) => {
    // 1. Búsqueda por código parcial
    if (busqueda.trim()) {
      const match = lote.codigo.toLowerCase().includes(busqueda.trim().toLowerCase());
      if (!match) return false;
    }

    // 2. Filtro estanque
    if (filtroEstanque !== 'todos' && lote.estanque !== filtroEstanque) {
      return false;
    }

    // 3. Filtro estado
    if (filtroEstado !== 'todos' && lote.estado !== filtroEstado) {
      return false;
    }

    // 4. Rango de fechas de siembra
    if (fechaDesde && lote.fechaSiembra < fechaDesde) {
      return false;
    }
    if (fechaHasta && lote.fechaSiembra > fechaHasta) {
      return false;
    }

    return true;
  });

  const limpiarFiltros = () => {
    setBusqueda('');
    setFiltroEstanque('todos');
    setFiltroEstado('todos');
    setFechaDesde('');
    setFechaHasta('');
  };

  return (
    <div className="space-y-5">
      {/* Barra de Título */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl text-slate-900">Gestión de lotes de cultivo</h1>
          <p className="text-xs text-slate-500">
            Modalidad Tilapia Pro • Registro incremental de siembra a despacho
          </p>
        </div>
      </div>

      {/* PANEL DE BÚSQUEDA Y FILTROS (solo con el permiso "Buscar y filtrar") */}
      <div className={`bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3 ${puedeBuscar ? '' : 'hidden'}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Buscador parcial */}
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Buscar por Código
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="ej: 20261023, E1, A-E2..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Filtro Estanque */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Estanque
            </label>
            <select
              value={filtroEstanque}
              onChange={(e) => setFiltroEstanque(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
            >
              <option value="todos">Todos los estanques</option>
              {config.estanques.map((e) => (
                <option key={e.codigo} value={e.codigo}>
                  {e.codigo} · {e.nombre}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Estado */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Estado del Lote
            </label>
            <select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
            >
              <option value="todos">Todos los estados</option>
              <option value="activo">Solo Activos (en cultivo)</option>
              <option value="cerrado">Solo Cerrados (cosechados)</option>
            </select>
          </div>

          {/* Fechas de siembra */}
          <div className="flex space-x-2">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Desde
              </label>
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Hasta
              </label>
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded-lg"
              />
            </div>
          </div>
        </div>

        {/* Resumen de resultados y reset de filtros */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
          <span>
            Mostrando <strong>{lotesFiltrados.length}</strong> de {lotes.length} lotes registrados
          </span>

          {(busqueda || filtroEstanque !== 'todos' || filtroEstado !== 'todos' || fechaDesde || fechaHasta) && (
            <button
              onClick={limpiarFiltros}
              className="text-xs text-sky-600 hover:text-sky-800 font-medium inline-flex items-center space-x-1"
            >
              <X className="w-3.5 h-3.5" />
              <span>Limpiar filtros</span>
            </button>
          )}
        </div>
      </div>

      {/* TABLA DE RESULTADOS */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {lotesFiltrados.length === 0 ? (
          <div className="py-20 text-center">
            <Fish className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-slate-800">Ningún lote coincide con estos filtros.</h3>
            <p className="text-sm text-slate-600 mt-1">Quita algún filtro o la fecha para ver más lotes.</p>
            <button
              type="button"
              onClick={() => {
                setBusqueda('');
                setFiltroEstanque('todos');
                setFiltroEstado('todos');
                setFechaDesde('');
                setFechaHasta('');
              }}
              className="mt-4 inline-flex items-center justify-center min-h-11 px-4 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-semibold transition-colors"
            >
              Limpiar filtros
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-semibold text-xs border-b border-slate-200">
                <tr>
                  <th className="px-5 py-4">Código Lote</th>
                  <th className="px-4 py-4">Estanque</th>
                  <th className="px-4 py-4">Fecha Siembra</th>
                  <th className="px-4 py-4 text-right">Días</th>
                  <th className="px-4 py-4 text-right">Peces Vivos</th>
                  <th className="px-4 py-4 text-right">Supervivencia</th>
                  <th className="px-4 py-4 text-right">Peso Prom</th>
                  <th className="px-4 py-4 text-right">Biomasa Viva</th>
                  <th className="px-4 py-4 text-right">FCA</th>
                  <th className="px-4 py-4 text-center">Estado</th>
                  <th className="px-5 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lotesFiltrados.map((lote, i) => (
                  <tr
                    key={lote.codigo}
                    className={`hover:bg-slate-50/80 transition-colors cursor-pointer ${escalon(i, primerMontaje).className}`}
                    style={escalon(i, primerMontaje).style}
                    onClick={() => onSeleccionarLote(lote)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSeleccionarLote(lote);
                      }
                    }}
                    tabIndex={0}
                    aria-label={`Abrir el lote ${lote.codigo}`}
                  >
                    <td className="px-5 py-4">
                      <div className="font-serif text-base text-slate-900 tabular-nums">
                        {lote.codigo}
                      </div>
                      <div className="text-xs text-slate-500">
                        {lote.eventos?.length || 0} fases
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="font-serif text-sm text-slate-900">
                        {lote.estanque}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-700">
                      {lote.fechaSiembra}
                    </td>
                    <td className="px-4 py-4 text-right font-medium text-slate-600">
                      {lote.resumen.diasDeCultivo != null ? `${lote.resumen.diasDeCultivo} d` : 'Sin dato'}
                    </td>
                    <td className="px-4 py-4 text-right text-slate-800">
                      {lote.resumen.pecesVivos.toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-right font-medium">
                      <span className={lote.resumen.supervivencia >= 85 ? 'text-slate-900 font-semibold' : 'text-amber-700 font-semibold'}>
                        {lote.resumen.supervivencia}%
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right font-semibold text-slate-800">
                      {lote.resumen.pesoPromedioActualG} g
                    </td>
                    <td className="px-4 py-4 text-right font-semibold text-slate-800">
                      {lote.resumen.biomasaEstimadaKg.toLocaleString()} kg
                    </td>
                    <td className="px-4 py-4 text-right font-mono font-semibold text-slate-700">
                      {lote.resumen.FCA ?? '-'}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span
                        className={`rotulo ${lote.estado === 'activo' ? 'text-emerald-700' : 'text-slate-600'}`}
                      >
                        {lote.estado}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right space-x-2" onClick={(e) => e.stopPropagation()}>
                      {puedeDocumentos && (
                        <button
                          onClick={() => onAbrirQr(lote)}
                          title="Ver Código QR"
                          className="p-2 text-slate-500 hover:text-sky-600 hover:bg-slate-100 rounded-md transition-colors inline-flex"
                        >
                          <QrCode className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => onSeleccionarLote(lote)}
                        className="px-3 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-md transition-colors inline-flex items-center space-x-1"
                      >
                        <span>Abrir</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
