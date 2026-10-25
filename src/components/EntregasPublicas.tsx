import React, { useEffect, useState } from 'react';
import { Truck, ShieldCheck, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { Lote, EntregasLote } from '../types';
import { escucharEntregas, calcularEstadoEntregas, verificarIntegridadEntregas } from '../services/entregasService';
import { ResultadoVerificacion } from '../services/hashService';

interface EntregasPublicasProps {
  lote: Lote;
}

/**
 * Vista pública (QR) del destino comercial del lote. Muestra solo las entregas completadas y las
 * presenta separadas de los registros de producción sellados.
 */
export const EntregasPublicas: React.FC<EntregasPublicasProps> = ({ lote }) => {
  const [entregasDoc, setEntregasDoc] = useState<EntregasLote | null>(null);
  const [verificacion, setVerificacion] = useState<ResultadoVerificacion | null>(null);
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    return escucharEntregas(lote.codigo, (doc) => {
      setEntregasDoc(doc);
      setVerificacion(null);
    });
  }, [lote.codigo]);

  const entregadas = calcularEstadoEntregas(entregasDoc?.registros || []).filter((e) => e.estado === 'entregada');
  if (!entregasDoc || entregadas.length === 0) return null;

  const handleVerificar = async () => {
    setVerificando(true);
    try {
      setVerificacion(await verificarIntegridadEntregas(lote, entregasDoc));
    } catch (err: any) {
      setVerificacion({ valido: false, totalEventos: 0, mensaje: `Error al verificar: ${err.message}` });
    } finally {
      setVerificando(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xs border border-indigo-200 p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-indigo-100">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Destino Comercial del Lote</h3>
            <p className="text-xs text-slate-500">Entregas registradas después del sellado de producción</p>
          </div>
        </div>

        <button
          onClick={handleVerificar}
          disabled={verificando}
          className="inline-flex items-center justify-center space-x-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
        >
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>{verificando ? 'Verificando...' : 'Verificar Entregas'}</span>
        </button>
      </div>

      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-900 flex items-start space-x-2">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Esta información no forma parte del registro de producción sellado. Se encadena con su propio hash a partir del sello de cierre del lote, por lo que no altera ni reemplaza los datos de producción.
        </span>
      </div>

      {verificacion && (
        <div
          className={`p-3 rounded-xl border flex items-start space-x-2 text-xs ${
            verificacion.valido ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-red-50 border-red-300 text-red-900'
          }`}
        >
          {verificacion.valido ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          )}
          <span>{verificacion.mensaje}</span>
        </div>
      )}

      <div className="space-y-2">
        {entregadas.map((e) => (
          <div key={e.entregaId} className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2">
            <div>
              <strong className="text-slate-900 block">{e.cliente}</strong>
              <span className="text-slate-500">{e.cantidadKg.toLocaleString()} kg entregados</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono">{e.fechaEntrega}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
