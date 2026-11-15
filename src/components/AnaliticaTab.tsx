import React, { useState, useMemo } from 'react';
import {
  BarChart2,
  TrendingUp,
  Download,
  Layers,
  Calendar,
  Activity,
  Droplets,
  AlertCircle,
  FileSpreadsheet
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
  BarChart,
  Bar
} from 'recharts';
import { Lote, ConfiguracionGeneral } from '../types';
import { ComparativoEstanques } from './ComparativoEstanques';

interface AnaliticaTabProps {
  lotes: Lote[];
  config: ConfiguracionGeneral;
  onSeleccionarLote: (lote: Lote) => void;
  puedeExportar?: boolean;
}

export const AnaliticaTab: React.FC<AnaliticaTabProps> = ({
  lotes,
  config,
  onSeleccionarLote,
  puedeExportar = true
}) => {
  const [loteSeleccionadoCodigo, setLoteSeleccionadoCodigo] = useState<string>(
    lotes[0]?.codigo || ''
  );

  const lotesActivos = useMemo(() => lotes.filter((l) => l.estado === 'activo'), [lotes]);
  const lotesCerrados = useMemo(() => lotes.filter((l) => l.estado === 'cerrado'), [lotes]);

  const loteSeleccionado = useMemo(() => {
    return lotes.find((l) => l.codigo === loteSeleccionadoCodigo) || lotes[0] || null;
  }, [lotes, loteSeleccionadoCodigo]);

  // Comparativo de estanques
  const comparativaEstanques = useMemo(() => {
    const data: Record<string, { totalLotes: number; activos: number; biomasaTotal: number; supervSuma: number; fcaSuma: number; fcaCount: number }> = {};
    for (const est of config.estanques) {
      data[est.codigo] = { totalLotes: 0, activos: 0, biomasaTotal: 0, supervSuma: 0, fcaSuma: 0, fcaCount: 0 };
    }

    for (const l of lotes) {
      if (!data[l.estanque]) {
        data[l.estanque] = { totalLotes: 0, activos: 0, biomasaTotal: 0, supervSuma: 0, fcaSuma: 0, fcaCount: 0 };
      }
      data[l.estanque].totalLotes++;
      if (l.estado === 'activo') {
        data[l.estanque].activos++;
        data[l.estanque].biomasaTotal += (l.resumen?.biomasaEstimadaKg || 0);
      }
      data[l.estanque].supervSuma += (l.resumen?.supervivencia || 0);
      if (l.resumen?.FCA && l.resumen.FCA > 0) {
        data[l.estanque].fcaSuma += l.resumen.FCA;
        data[l.estanque].fcaCount++;
      }
    }

    return Object.entries(data).map(([estanque, v]) => ({
      estanque,
      lotesActivos: v.activos,
      biomasaKg: Number(v.biomasaTotal.toFixed(1)),
      supervivenciaProm: v.totalLotes > 0 ? Number((v.supervSuma / v.totalLotes).toFixed(1)) : 0,
      fcaProm: v.fcaCount > 0 ? Number((v.fcaSuma / v.fcaCount).toFixed(2)) : 0
    }));
  }, [lotes, config.estanques]);

  // Datos temporales para los gráficos del lote seleccionado
  const seriesCrecimiento = useMemo(() => {
    if (!loteSeleccionado) return [];
    const evs = [...(loteSeleccionado.eventos || [])].sort((a, b) => a.indice - b.indice);

    const puntos: any[] = [];
    // Punto inicial
    puntos.push({
      fecha: loteSeleccionado.fechaSiembra,
      pesoPromedioG: loteSeleccionado.pesoInicialPromedioG,
      biomasaKg: loteSeleccionado.resumen?.biomasaInicialKg || 0,
      alimentoAcumKg: 0,
      mortalidadAcum: 0
    });

    let alimentoAcum = 0;
    let mortalidadAcum = 0;
    let ultimoPeso = loteSeleccionado.pesoInicialPromedioG;

    for (const ev of evs) {
      if (ev.tipo === 'Alimentación') {
        alimentoAcum += Number(ev.datos?.cantidadKg ?? ev.datos?.cantidad) || 0;
      } else if (ev.tipo === 'Mortalidad') {
        mortalidadAcum += Number(ev.datos?.cantidad) || 0;
      } else if (ev.tipo === 'Muestreo de crecimiento (biometría)') {
        ultimoPeso = Number(ev.datos?.pesoPromedioG ?? ev.datos?.pesoPromedio) || ultimoPeso;
      }

      const pecesVivosPunto = Math.max(0, loteSeleccionado.cantidadSembrada - mortalidadAcum);
      const biomasaPunto = Number(((pecesVivosPunto * ultimoPeso) / 1000).toFixed(1));

      puntos.push({
        fecha: ev.fechaEvento,
        tipo: ev.tipo,
        pesoPromedioG: Number(ultimoPeso.toFixed(1)),
        biomasaKg: biomasaPunto,
        alimentoAcumKg: Number(alimentoAcum.toFixed(1)),
        mortalidadAcum
      });
    }

    return puntos;
  }, [loteSeleccionado]);

  // Serie de Calidad del Agua del lote seleccionado
  const seriesAgua = useMemo(() => {
    if (!loteSeleccionado) return [];
    return (loteSeleccionado.eventos || [])
      .filter((e) => e.tipo === 'Calidad del agua')
      .map((e) => ({
        fecha: e.fechaEvento,
        temperatura: Number(e.datos?.temperatura),
        oxigenoDisuelto: Number(e.datos?.oxigenoDisuelto),
        ph: Number(e.datos?.ph),
        amonioTotal: Number(e.datos?.amonioTotal),
        nitritos: Number(e.datos?.nitritos),
        transparenciaSecchi: Number(e.datos?.transparenciaSecchi)
      }));
  }, [loteSeleccionado]);

  // Exportar listado a CSV
  const handleExportarCsv = () => {
    if (lotes.length === 0) return;

    const encabezados = [
      'Codigo',
      'Estanque',
      'Estado',
      'FechaSiembra',
      'FechaCierre',
      'CantidadSembrada',
      'SupervivenciaPct',
      'PecesVivos',
      'PesoInicialG',
      'PesoActualG',
      'BiomasaEstimadaKg',
      'BiomasaCosechadaKg',
      'AlimentoAcumuladoKg',
      'FCA',
      'DiasCultivo',
      'AlertasAgua',
      'UrlPdf'
    ];

    const filas = lotes.map((l) => [
      l.codigo,
      l.estanque,
      l.estado,
      l.fechaSiembra,
      l.fechaCierre || '',
      l.cantidadSembrada,
      l.resumen.supervivencia,
      l.resumen.pecesVivos,
      l.pesoInicialPromedioG,
      l.resumen.pesoPromedioActualG,
      l.resumen.biomasaEstimadaKg,
      l.resumen.biomasaCosechadaKg,
      l.resumen.alimentoAcumuladoKg,
      l.resumen.FCA ?? '',
      l.resumen.diasDeCultivo,
      l.resumen.alertasAgua,
      l.pdfUrl || ''
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [encabezados.join(','), ...filas.map((f) => f.map((c) => `"${c}"`).join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `CultivosLore_Lotes_Trazabilidad_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8">
      {/* Barra de cabecera con exportar CSV */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl text-slate-900">Analítica y control productivo</h1>
          <p className="text-xs text-slate-500">
            Comparativa de estanques, gráficos de evolución y exportación de datos
          </p>
        </div>

        <button
          onClick={handleExportarCsv}
          disabled={lotes.length === 0}
          hidden={!puedeExportar}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Exportar Listado (CSV)</span>
        </button>
      </div>

      {/* COMPARATIVO DE ESTANQUES */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <h2 className="text-base text-slate-900 mb-1">Comparativo de estanques</h2>
        <p className="text-sm text-slate-600 mb-4">Biomasa viva, supervivencia y conversión alimenticia de cada estanque.</p>
        <ComparativoEstanques datos={comparativaEstanques} estanques={config.estanques} />
      </div>

      {/* SECCIÓN 1: LOTES EN GESTIÓN (ACTIVOS) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <h2 className="text-sm font-semibold text-slate-900">Lotes en gestión (activos)</h2>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            {lotesActivos.length} lotes
          </span>
        </div>

        {lotesActivos.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Ningún lote está en cultivo ahora. Cuando se registre una siembra, su avance aparece aquí.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold uppercase text-xs border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Código</th>
                  <th className="px-3 py-3">Estanque</th>
                  <th className="px-3 py-3">Siembra</th>
                  <th className="px-3 py-3 text-right">Días</th>
                  <th className="px-3 py-3 text-right">Supervivencia</th>
                  <th className="px-3 py-3 text-right">Peso Prom</th>
                  <th className="px-3 py-3 text-right">Biomasa Est</th>
                  <th className="px-3 py-3 text-right">FCA</th>
                  <th className="px-4 py-3 text-center">PDF</th>
                  <th className="px-4 py-3 text-right">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lotesActivos.map((l) => (
                  <tr key={l.codigo} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">{l.codigo}</td>
                    <td className="px-3 py-3 font-semibold text-sky-700">{l.estanque}</td>
                    <td className="px-3 py-3 text-slate-600">{l.fechaSiembra}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{l.resumen.diasDeCultivo != null ? `${l.resumen.diasDeCultivo} d` : 'Sin dato'}</td>
                    <td className="px-3 py-3 text-right font-semibold text-emerald-600">{l.resumen.supervivencia}%</td>
                    <td className="px-3 py-3 text-right font-semibold">{l.resumen.pesoPromedioActualG} g</td>
                    <td className="px-3 py-3 text-right font-semibold">{l.resumen.biomasaEstimadaKg} kg</td>
                    <td className="px-3 py-3 text-right font-mono">{l.resumen.FCA ?? '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs bg-slate-100 px-2 py-1 rounded-md text-slate-600">En cultivo</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onSeleccionarLote(l)}
                        className="text-sky-600 hover:text-sky-800 font-semibold"
                      >
                        Ver Lote
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECCIÓN 2: LOTES CERRADOS */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Lotes cerrados (cosechados)</h2>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            {lotesCerrados.length} lotes
          </span>
        </div>

        {lotesCerrados.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Todavía no hay lotes sellados. Al cerrar un lote, su resultado final aparece aquí.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold uppercase text-xs border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Código</th>
                  <th className="px-3 py-3">Estanque</th>
                  <th className="px-3 py-3">Siembra</th>
                  <th className="px-3 py-3">Cierre</th>
                  <th className="px-3 py-3 text-right">Días</th>
                  <th className="px-3 py-3 text-right">Supervivencia</th>
                  <th className="px-3 py-3 text-right">Biomasa Cosechada</th>
                  <th className="px-3 py-3 text-right">FCA Final</th>
                  <th className="px-4 py-3 text-center">Certificado PDF</th>
                  <th className="px-4 py-3 text-right">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lotesCerrados.map((l) => (
                  <tr key={l.codigo} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">{l.codigo}</td>
                    <td className="px-3 py-3 font-semibold text-sky-700">{l.estanque}</td>
                    <td className="px-3 py-3 text-slate-600">{l.fechaSiembra}</td>
                    <td className="px-3 py-3 text-slate-600">{l.fechaCierre || '-'}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{l.resumen.diasDeCultivo != null ? `${l.resumen.diasDeCultivo} d` : 'Sin dato'}</td>
                    <td className="px-3 py-3 text-right font-semibold text-emerald-600">{l.resumen.supervivencia}%</td>
                    <td className="px-3 py-3 text-right font-semibold">{l.resumen.biomasaCosechadaKg != null ? `${l.resumen.biomasaCosechadaKg} kg` : 'Sin dato'}</td>
                    <td className="px-3 py-3 text-right font-mono">{l.resumen.FCA ?? '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded-md font-semibold">
                        Disponible
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onSeleccionarLote(l)}
                        className="text-sky-600 hover:text-sky-800 font-semibold"
                      >
                        Ver Lote
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECCIÓN 3: GRÁFICOS INTERACTIVOS RECHARTS POR LOTE SELECCIONADO */}
      {loteSeleccionado && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-semibold text-slate-900 flex items-center space-x-2">
                <TrendingUp className="w-5 h-5 text-sky-600" />
                <span>Gráficos de Trazabilidad: {loteSeleccionado.codigo}</span>
              </h2>
              <p className="text-xs text-slate-500">
                Evolución de biomasa, peso promedio, alimento y parámetros ambientales
              </p>
            </div>

            {/* Selector de lote para gráficos */}
            <div className="flex items-center space-x-2">
              <label className="text-xs font-semibold text-slate-600">Cambiar Lote:</label>
              <select
                value={loteSeleccionadoCodigo}
                onChange={(e) => setLoteSeleccionadoCodigo(e.target.value)}
                className="px-3 py-2 text-xs font-mono font-medium border border-slate-300 rounded-lg bg-white"
              >
                {lotes.map((l) => (
                  <option key={l.codigo} value={l.codigo}>
                    {l.codigo} ({l.estanque})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Gráfico 1: Peso Promedio (g) y Biomasa (kg) */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <h3 className="text-xs font-semibold uppercase text-slate-700 mb-2">
                Evolución de Peso Promedio (g) y Biomasa Estimada (kg)
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={seriesCrecimiento}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dfe2e7" />
                    <XAxis dataKey="fecha" stroke="#5d6470" fontSize={10} />
                    <YAxis yAxisId="left" stroke="#2c426e" fontSize={10} label={{ value: 'Peso (g)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" stroke="#225f46" fontSize={10} label={{ value: 'Biomasa (kg)', angle: 90, position: 'insideRight', fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line yAxisId="left" type="monotone" dataKey="pesoPromedioG" stroke="#2c426e" strokeWidth={2} name="Peso Prom (g)" dot={{ r: 3 }} />
                    <Line yAxisId="right" type="monotone" dataKey="biomasaKg" stroke="#225f46" strokeWidth={2} name="Biomasa (kg)" dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Gráfico 2: Alimento Acumulado y Mortalidad */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <h3 className="text-xs font-semibold uppercase text-slate-700 mb-2">
                Alimento Acumulado (kg) y Mortalidad Acumulada (peces)
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={seriesCrecimiento}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dfe2e7" />
                    <XAxis dataKey="fecha" stroke="#5d6470" fontSize={10} />
                    <YAxis yAxisId="left" stroke="#8a6624" fontSize={10} label={{ value: 'Alimento (kg)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" stroke="#b3261e" fontSize={10} label={{ value: 'Mortalidad', angle: 90, position: 'insideRight', fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line yAxisId="left" type="monotone" dataKey="alimentoAcumKg" stroke="#8a6624" strokeWidth={2} name="Alimento (kg)" dot={{ r: 3 }} />
                    <Line yAxisId="right" type="monotone" dataKey="mortalidadAcum" stroke="#b3261e" strokeWidth={2} name="Mortalidad (peces)" dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Gráfico 3: Parámetros de Agua - Temperatura y Oxígeno */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <h3 className="text-xs font-semibold uppercase text-slate-700 mb-2">
                Temperatura (°C) y Oxígeno Disuelto (mg/L)
              </h3>
              {seriesAgua.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-xs text-slate-500">
                  No hay mediciones de agua registradas en este lote.
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={seriesAgua}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#dfe2e7" />
                      <XAxis dataKey="fecha" stroke="#5d6470" fontSize={10} />
                      <YAxis stroke="#5d6470" fontSize={10} domain={[0, 40]} />
                      <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <ReferenceLine y={config.rangosReferencia.temperaturaMin} stroke="#8c9cc0" strokeDasharray="3 3" label={{ value: 'Temp Min', fontSize: 9 }} />
                      <ReferenceLine y={config.rangosReferencia.temperaturaMax} stroke="#df8a82" strokeDasharray="3 3" label={{ value: 'Temp Max', fontSize: 9 }} />
                      <ReferenceLine y={config.rangosReferencia.oxigenoMin} stroke="#c62828" strokeDasharray="3 3" label={{ value: 'O₂ Min (4mg/L)', fontSize: 9 }} />
                      <Line type="monotone" dataKey="temperatura" stroke="#a07a2c" strokeWidth={2} name="Temp (°C)" dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="oxigenoDisuelto" stroke="#3e5584" strokeWidth={2} name="O₂ (mg/L)" dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Gráfico 4: Parámetros de Agua - pH y Secchi */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <h3 className="text-xs font-semibold uppercase text-slate-700 mb-2">
                pH y Transparencia Secchi (cm)
              </h3>
              {seriesAgua.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-xs text-slate-500">
                  No hay mediciones de agua registradas en este lote.
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={seriesAgua}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#dfe2e7" />
                      <XAxis dataKey="fecha" stroke="#5d6470" fontSize={10} />
                      <YAxis yAxisId="ph" stroke="#3a4a6b" domain={[4, 10]} fontSize={10} />
                      <YAxis yAxisId="secchi" orientation="right" stroke="#2f7758" domain={[0, 60]} fontSize={10} />
                      <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <ReferenceLine yAxisId="ph" y={config.rangosReferencia.phMin} stroke="#96a3bd" strokeDasharray="3 3" />
                      <ReferenceLine yAxisId="ph" y={config.rangosReferencia.phMax} stroke="#96a3bd" strokeDasharray="3 3" />
                      <Line yAxisId="ph" type="monotone" dataKey="ph" stroke="#3a4a6b" strokeWidth={2} name="pH" dot={{ r: 4 }} />
                      <Line yAxisId="secchi" type="monotone" dataKey="transparenciaSecchi" stroke="#2f7758" strokeWidth={2} name="Secchi (cm)" dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
