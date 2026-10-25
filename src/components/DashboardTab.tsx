import React, { useState } from 'react';
import {
  Fish,
  Layers,
  AlertTriangle,
  Clock,
  Plus,
  Search,
  ExternalLink,
  QrCode,
  ShieldCheck,
  CheckCircle2,
  Calendar,
  Activity
} from 'lucide-react';
import { Lote, ConfiguracionGeneral } from '../types';

interface DashboardTabProps {
  lotes: Lote[];
  config: ConfiguracionGeneral;
  onNuevoLote: () => void;
  onSeleccionarLote: (lote: Lote) => void;
  onAbrirQr: (lote: Lote) => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  lotes,
  config,
  onNuevoLote,
  onSeleccionarLote,
  onAbrirQr
}) => {
  const [busquedaRapida, setBusquedaRapida] = useState('');

  // Métricas globales calculadas
  const lotesActivos = lotes.filter((l) => l.estado === 'activo');
  const lotesCerrados = lotes.filter((l) => l.estado === 'cerrado');

  const biomasaTotalCultivoKg = lotesActivos.reduce(
    (acc, l) => acc + (l.resumen?.biomasaEstimadaKg || 0),
    0
  );

  const totalPecesVivos = lotesActivos.reduce(
    (acc, l) => acc + (l.resumen?.pecesVivos || 0),
    0
  );

  const totalAlertasAgua = lotes.reduce(
    (acc, l) => acc + (l.resumen?.alertasAgua || 0),
    0
  );

  // Conteo por estanque
  const conteoEstanques: Record<string, number> = {};
  for (const est of config.estanques) {
    conteoEstanques[est.codigo] = lotesActivos.filter((l) => l.estanque === est.codigo).length;
  }

  // Filtrado de últimos lotes modificados
  const lotesFiltrados = lotes.filter((l) => {
    if (!busquedaRapida.trim()) return true;
    return l.codigo.toLowerCase().includes(busquedaRapida.trim().toLowerCase());
  });

  return (
    <div className="space-y-6">
      {/* Banner de Bienvenida y Acción Principal */}
      <div className="bg-gradient-to-r from-slate-900 via-sky-950 to-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-md border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-sky-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Fish className="w-4 h-4" />
            <span>Sistema Oficial de Trazabilidad</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Cultivos Loré — Tilapia Pro
          </h1>
          <p className="text-sm text-slate-300 mt-1 max-w-xl">
            Monitoreo en tiempo real, registro inalterable blockchain SHA-256 y certificados QR para Turbaco, Bolívar.
          </p>
        </div>

        <button
          onClick={onNuevoLote}
          className="inline-flex items-center space-x-2 px-5 py-3 bg-sky-500 hover:bg-sky-400 text-white rounded-xl text-sm font-bold shadow-lg shadow-sky-500/20 transition-all shrink-0"
        >
          <Plus className="w-5 h-5" />
          <span>Registrar Nuevo Lote</span>
        </button>
      </div>

      {/* TARJETAS DE INDICADORES GENERALES */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Lotes Activos */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase">Lotes en Cultivo</span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-slate-900">{lotesActivos.length}</span>
            <span className="text-xs text-slate-500 font-medium">activos</span>
          </div>
          <div className="mt-2 text-xs text-slate-500 flex items-center space-x-2">
            <span>{lotesCerrados.length} lotes cerrados</span>
          </div>
        </div>

        {/* Biomasa Total en Cultivo */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase">Biomasa Viva Total</span>
            <div className="p-2 rounded-lg bg-sky-50 text-sky-600">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-slate-900">
              {biomasaTotalCultivoKg.toLocaleString()}
            </span>
            <span className="text-xs text-slate-500 font-medium">kg</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {totalPecesVivos.toLocaleString()} peces vivos en estanques
          </p>
        </div>

        {/* Ocupación por Estanque */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase">Ocupación Estanques</span>
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
              <Fish className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center space-x-4 mt-1">
            {config.estanques.map((est) => (
              <div key={est.codigo}>
                <span className="text-xs font-bold text-slate-500">{est.codigo}: </span>
                <span className="text-xl font-bold text-slate-900">{conteoEstanques[est.codigo] || 0}</span>
                <span className="text-[10px] text-slate-400 block">{est.nombre.split(' ')[0]}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Turbaco, Bolívar</p>
        </div>

        {/* Alertas de Calidad de Agua */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase">Alertas Fisicoquímicas</span>
            <div className={`p-2 rounded-lg ${totalAlertasAgua > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-400'}`}>
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className={`text-3xl font-extrabold ${totalAlertasAgua > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
              {totalAlertasAgua}
            </span>
            <span className="text-xs text-slate-500 font-medium">acumuladas</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Parámetros de agua fuera de rango
          </p>
        </div>
      </div>

      {/* BUSCADOR RÁPIDO Y ÚLTIMOS LOTES MODIFICADOS */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Últimos Lotes Modificados</h2>
            <p className="text-xs text-slate-500">
              Accede directamente al historial o continúa registrando eventos
            </p>
          </div>

          <div className="relative max-w-xs w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por código..."
              value={busquedaRapida}
              onChange={(e) => setBusquedaRapida(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 bg-slate-50 focus:bg-white"
            />
          </div>
        </div>

        {lotesFiltrados.length === 0 ? (
          <div className="py-16 text-center">
            <Fish className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-slate-700">No se encontraron lotes</h3>
            <p className="text-xs text-slate-400 mt-1">
              Comienza registrando el primer lote de siembra con el botón "Registrar Nuevo Lote".
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3">Código Lote</th>
                  <th className="px-4 py-3">Estanque</th>
                  <th className="px-4 py-3">Siembra</th>
                  <th className="px-4 py-3 text-right">Supervivencia</th>
                  <th className="px-4 py-3 text-right">Peso Prom</th>
                  <th className="px-4 py-3 text-right">Biomasa Viva</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-5 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lotesFiltrados.slice(0, 8).map((lote) => (
                  <tr
                    key={lote.codigo}
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                    onClick={() => onSeleccionarLote(lote)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-slate-900 text-sm">
                          {lote.codigo}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">
                          v{lote.versionPdf || 1}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-block px-2 py-0.5 rounded font-mono font-bold text-xs bg-sky-50 text-sky-700 border border-sky-200">
                        {lote.estanque}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      <div>{lote.fechaSiembra}</div>
                      <div className="text-[10px] text-slate-400">{lote.resumen.diasDeCultivo} días</div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium">
                      <span className={lote.resumen.supervivencia >= 85 ? 'text-emerald-600 font-bold' : 'text-amber-600'}>
                        {lote.resumen.supervivencia}%
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold text-slate-800">
                      {lote.resumen.pesoPromedioActualG} g
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold text-slate-800">
                      {lote.resumen.biomasaEstimadaKg.toLocaleString()} kg
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          lote.estado === 'activo'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {lote.estado}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onAbrirQr(lote)}
                        title="Ver Código QR"
                        className="p-1.5 text-slate-500 hover:text-sky-600 hover:bg-slate-100 rounded-md transition-colors inline-flex"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onSeleccionarLote(lote)}
                        className="px-2.5 py-1 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-md border border-sky-200 transition-colors inline-flex items-center space-x-1"
                      >
                        <span>Detalle</span>
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
