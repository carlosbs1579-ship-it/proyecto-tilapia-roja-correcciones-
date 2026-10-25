import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, ShieldAlert, CheckCircle, Hash, RefreshCw } from 'lucide-react';
import { Lote } from '../types';
import { verificarIntegridadCadena, ResultadoVerificacion } from '../services/hashService';

interface IntegrityCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  lote: Lote;
}

export const IntegrityCheckModal: React.FC<IntegrityCheckModalProps> = ({
  isOpen,
  onClose,
  lote
}) => {
  const [verificando, setVerificando] = useState(true);
  const [resultado, setResultado] = useState<ResultadoVerificacion | null>(null);

  const ejecutarVerificacion = async () => {
    setVerificando(true);
    try {
      // Pequeña pausa para visualización de recálculo criptográfico
      await new Promise(r => setTimeout(r, 300));
      const res = await verificarIntegridadCadena(lote.codigo, lote.eventos || []);
      setResultado(res);
    } catch (err: any) {
      setResultado({
        valido: false,
        totalEventos: lote.eventos?.length || 0,
        mensaje: `Error al calcular hashes criptográficos: ${err.message}`
      });
    } finally {
      setVerificando(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      ejecutarVerificacion();
    }
  }, [isOpen, lote]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden">
        {/* Cabecera */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Hash className="w-5 h-5 text-sky-400" />
            <h3 className="font-semibold text-base">Verificación Criptográfica de Integridad</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <div className="text-xs text-slate-500 mb-4">
            Cada evento en <strong>Cultivos Loré</strong> se encadena con un hash SHA-256 derivado de su predecesor. Esta auditoría recalcula matemáticamente cada eslabón para detectar cualquier manipulación o inserción no autorizada.
          </div>

          {verificando ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <div className="w-10 h-10 border-3 border-sky-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-medium text-slate-700">Auditando cadena de bloques SHA-256...</p>
              <p className="text-xs text-slate-400">Verificando {lote.eventos?.length || 0} eventos registrados</p>
            </div>
          ) : resultado?.valido ? (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start space-x-3 text-emerald-900">
                <ShieldCheck className="w-8 h-8 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-base text-emerald-800">Resultado: ÍNTEGRO</h4>
                  <p className="text-xs text-emerald-700 mt-1">{resultado.mensaje}</p>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Lote auditado:</span>
                  <span className="font-mono font-bold text-slate-800">{lote.codigo}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Bloques verificados:</span>
                  <span className="font-semibold text-slate-800">{resultado.totalEventos} eventos</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Hash Génesis (#0):</span>
                  <span className="font-mono text-[10px] text-slate-600">0000...0000 (64 ceros válidos)</span>
                </div>
                <div className="py-1">
                  <span className="text-slate-500 font-medium block mb-1">Hash Final del Lote (resumen.hashFinal):</span>
                  <span className="font-mono text-[10px] bg-white p-1.5 rounded border border-slate-300 block break-all text-slate-700">
                    {lote.resumen.hashFinal || 'Sin hash registrado'}
                  </span>
                </div>
              </div>

              <div className="flex items-center text-xs text-emerald-700 space-x-1.5 bg-emerald-50/50 p-2 rounded">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>La evidencia digital concuerda 100% con los estándares de trazabilidad inalterable.</span>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-red-900">
                <ShieldAlert className="w-8 h-8 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-base text-red-800">Resultado: ¡ALTERACIÓN DETECTADA!</h4>
                  <p className="text-xs text-red-700 mt-1">{resultado?.mensaje}</p>
                </div>
              </div>

              {resultado?.detalles && (
                <div className="bg-slate-50 border border-red-200 rounded-lg p-3 text-xs space-y-2">
                  <p className="font-semibold text-red-800">Detalles de la discrepancia criptográfica:</p>
                  <div>
                    <span className="text-slate-500 block">Índice del evento alterado:</span>
                    <span className="font-bold font-mono text-slate-900">#{resultado.detalles.indice}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Hash recalculado según datos actuales:</span>
                    <span className="font-mono text-[10px] bg-red-50 text-red-800 p-1 rounded block break-all border border-red-200">
                      {resultado.detalles.hashEsperado || 'Discrepancia en cadena previa'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Hash guardado en el documento original:</span>
                    <span className="font-mono text-[10px] bg-slate-100 text-slate-800 p-1 rounded block break-all border border-slate-300">
                      {resultado.detalles.hashAlmacenado}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
            <button
              onClick={ejecutarVerificacion}
              disabled={verificando}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${verificando ? 'animate-spin' : ''}`} />
              <span>Re-auditar ahora</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
