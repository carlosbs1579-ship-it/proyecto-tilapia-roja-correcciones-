import React, { useState } from 'react';
import { escalon, usePrimerMontaje } from '../lib/montaje';
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
  // Permisos de la pestaña (por defecto, todo visible como antes)
  puedeCrearLote?: boolean;
  puedeBuscar?: boolean;
  puedeDocumentos?: boolean;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  lotes,
  config,
  onNuevoLote,
  onSeleccionarLote,
  onAbrirQr,
  puedeCrearLote = true,
  puedeBuscar = true,
  puedeDocumentos = true
}) => {
  const primerMontaje = usePrimerMontaje();
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
      <div className="bg-slate-900 text-white p-6 sm:p-8 border-b-4 border-double border-amber-600 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl">Cultivos Loré</h1>
          <p className="text-sm text-slate-300 mt-1 max-w-xl">
            Producción de tilapia roja en Turbaco, Bolívar: cada fase queda registrada, firmada y verificable desde su certificado.
          </p>
        </div>

        {puedeCrearLote && (
          <button
            onClick={onNuevoLote}
            className="inline-flex items-center space-x-2 px-5 py-3 bg-slate-50 hover:bg-white text-slate-900 rounded-xl text-sm font-bold transition-colors shrink-0"
          >
            <Plus className="w-5 h-5" />
            <span>Registrar Nuevo Lote</span>
          </button>
        )}
      </div>

      {/* TARJETAS DE INDICADORES GENERALES */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Lotes Activos */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase">Lotes en Cultivo</span>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-slate-900">{lotesActivos.length}</span>
            <span className="text-xs text-slate-500 font-medium">activos</span>
          </div>
          <div className="mt-2 text-xs text-slate-500 flex items-center space-x-2">
            <span>{lotesCerrados.length} {lotesCerrados.length === 1 ? 'lote cerrado' : 'lotes cerrados'}</span>
          </div>
        </div>

        {/* Biomasa Total en Cultivo */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase">Biomasa Viva Total</span>
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
          </div>
          <div className="flex items-center space-x-4 mt-1">
            {config.estanques.map((est) => (
              <div key={est.codigo}>
                <span className="text-xs font-bold text-slate-500">{est.codigo}: </span>
                <span className="text-xl font-bold text-slate-900">{conteoEstanques[est.codigo] || 0}</span>
                <span className="text-[11px] text-slate-400 block">{est.nombre.split(' ')[0]}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Turbaco, Bolívar</p>
        </div>

        {/* Alertas de Calidad de Agua */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase">Alertas Fisicoquímicas</span>
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
            <h2 className="text-base font-bold text-slate-900">Últimos lotes modificados</h2>
            <p className="text-xs text-slate-500">
              Accede directamente al historial o continúa registrando fases
            </p>
          </div>

          <div className={`relative max-w-xs w-full ${puedeBuscar ? '' : 'hidden'}`}>
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
                {lotesFiltrados.slice(0, 8).map((lote, i) => (
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
                    <td className="px-5 py-3.5">
                      <div className="flex items-center space-x-2">
                        <span className="font-serif text-base text-slate-900 tabular-nums">
                          {lote.codigo}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-serif text-sm text-slate-900">
                        {lote.estanque}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      <div>{lote.fechaSiembra}</div>
                      {lote.resumen.diasDeCultivo != null && <div className="text-[11px] text-slate-500">{lote.resumen.diasDeCultivo} días</div>}
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium">
                      <span className={lote.resumen.supervivencia >= 85 ? 'text-slate-900 font-bold' : 'text-amber-700 font-bold'}>
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
                        className={`rotulo ${lote.estado === 'activo' ? 'text-emerald-700' : 'text-slate-600'}`}
                      >
                        {lote.estado}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-2" onClick={(e) => e.stopPropagation()}>
                      {puedeDocumentos && (
                        <button
                          onClick={() => onAbrirQr(lote)}
                          title="Ver Código QR"
                          className="p-1.5 text-slate-500 hover:text-sky-600 hover:bg-slate-100 rounded-md transition-colors inline-flex"
                        >
                          <QrCode className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => onSeleccionarLote(lote)}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-md transition-colors inline-flex items-center space-x-1"
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
