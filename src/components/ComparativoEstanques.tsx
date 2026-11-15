import React, { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { EstanqueConfig } from '../types';

export interface DatoComparativo {
  estanque: string;
  lotesActivos: number;
  biomasaKg: number;
  supervivenciaProm: number;
  fcaProm: number;
}

const FILAS: { clave: keyof Omit<DatoComparativo, 'estanque'>; etiqueta: string; formato: (v: number) => string }[] = [
  { clave: 'lotesActivos', etiqueta: 'Lotes activos', formato: (v) => v.toLocaleString('es-CO') },
  { clave: 'biomasaKg', etiqueta: 'Biomasa viva', formato: (v) => `${v.toLocaleString('es-CO')} kg` },
  { clave: 'supervivenciaProm', etiqueta: 'Supervivencia promedio', formato: (v) => `${v}%` },
  { clave: 'fcaProm', etiqueta: 'FCA promedio', formato: (v) => (v ? v.toFixed(2) : 'Sin registro') }
];

/**
 * Comparativo lado a lado de los estanques que el usuario elige. En escritorio es una tabla con
 * una columna por estanque; en el celular cada estanque es un bloque apilado.
 */
export const ComparativoEstanques: React.FC<{ datos: DatoComparativo[]; estanques: EstanqueConfig[] }> = ({ datos, estanques }) => {
  const nombre = (codigo: string) => estanques.find((e) => e.codigo === codigo)?.nombre || `Estanque ${codigo}`;
  const [elegidos, setElegidos] = useState<string[]>(() => datos.slice(0, 2).map((d) => d.estanque));
  const columnas = useMemo(() => datos.filter((d) => elegidos.includes(d.estanque)), [datos, elegidos]);

  const alternar = (codigo: string) =>
    setElegidos((prev) => (prev.includes(codigo) ? (prev.length > 1 ? prev.filter((c) => c !== codigo) : prev) : [...prev, codigo]));

  if (!datos.length) {
    return <p className="text-sm text-slate-600">Aún no hay estanques configurados. Agrégalos en Configuración para compararlos.</p>;
  }

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-xs text-slate-600 mb-2">Elige los estanques a comparar</legend>
        <div className="flex flex-wrap gap-2">
          {datos.map((d) => {
            const activo = elegidos.includes(d.estanque);
            return (
              <button
                key={d.estanque}
                type="button"
                aria-pressed={activo}
                onClick={() => alternar(d.estanque)}
                className={`inline-flex items-center gap-1.5 min-h-10 px-3 rounded-md border text-sm transition-colors duration-150 active:scale-[0.97] ${
                  activo ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'
                }`}
              >
                {activo && <Check className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />}
                {nombre(d.estanque)}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Escritorio: tabla con una columna por estanque */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-900">
              <th scope="col" className="text-left font-normal text-slate-600 py-2 pr-4 w-56">Indicador</th>
              {columnas.map((c) => (
                <th key={c.estanque} scope="col" className="text-right py-2 px-4 font-serif font-normal text-base text-slate-900">
                  {nombre(c.estanque)}
                  <span className="block text-xs font-sans text-slate-500">Código {c.estanque}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FILAS.map((f) => (
              <tr key={f.clave} className="border-b border-slate-200">
                <th scope="row" className="text-left font-normal text-slate-600 py-2.5 pr-4">{f.etiqueta}</th>
                {columnas.map((c) => (
                  <td key={c.estanque} className="text-right py-2.5 px-4 font-semibold text-slate-900 tabular-nums">
                    {f.formato(c[f.clave])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Celular: un bloque apilado por estanque */}
      <div className="md:hidden space-y-3">
        {columnas.map((c) => (
          <section key={c.estanque} className="border border-slate-200 rounded-lg p-4">
            <h3 className="font-serif text-lg text-slate-900">{nombre(c.estanque)}</h3>
            <p className="text-xs text-slate-500 mb-2">Código {c.estanque}</p>
            <dl className="divide-y divide-slate-200 text-sm">
              {FILAS.map((f) => (
                <div key={f.clave} className="flex justify-between gap-4 py-2">
                  <dt className="text-slate-600">{f.etiqueta}</dt>
                  <dd className="font-semibold text-slate-900 tabular-nums">{f.formato(c[f.clave])}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
};
