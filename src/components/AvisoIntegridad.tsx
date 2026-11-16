import React from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

/**
 * Aviso automático de integridad. La alteración se marca con filete rojo a la izquierda, fondo
 * rojo suave y título en seminegrita (sin alarma); entra con el fundido corto de las filas.
 * "no_verificable" (navegador sin SHA-256) se muestra en gris: no es un resultado.
 */
export const AvisoIntegridad: React.FC<{
  estado: 'alterado' | 'no_verificable';
  avisos: string[];
  titulo?: string;
  nota?: string;
  className?: string;
}> = ({ estado, avisos, titulo, nota, className = '' }) => {
  const alterado = estado === 'alterado';
  return (
    <div
      role={alterado ? 'alert' : 'status'}
      className={`fila-escalonada rounded-md border border-l-2 p-4 text-xs ${
        alterado ? 'bg-red-50 border-red-200 border-l-red-600 text-red-800' : 'bg-slate-50 border-slate-200 border-l-slate-500 text-slate-700'
      } ${className}`}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <ShieldAlert className={`w-4 h-4 shrink-0 ${alterado ? 'text-red-600' : 'text-slate-500'}`} aria-hidden="true" />
        {titulo || (alterado ? 'Posible alteración detectada' : 'No se puede verificar en este navegador')}
      </p>
      {avisos.length > 0 && (
        <ul className={`mt-2 space-y-1 pl-6 list-disc ${alterado ? 'marker:text-red-300' : 'marker:text-slate-400'}`}>
          {avisos.map((a, i) => (
            <li key={i} className="[overflow-wrap:anywhere]">
              {a}
            </li>
          ))}
        </ul>
      )}
      {nota && <p className={`mt-2 ${alterado ? 'text-red-700' : 'text-slate-600'}`}>{nota}</p>}
    </div>
  );
};

/** Indicador sobrio de verificación correcta (verde solo para lo íntegro) */
export const IndicadorVerificado: React.FC<{ texto: string; className?: string }> = ({ texto, className = '' }) => (
  <p className={`flex items-center gap-1 text-xs text-emerald-700 ${className}`}>
    <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
    {texto}
  </p>
);
