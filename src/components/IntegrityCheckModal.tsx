import React, { useState, useEffect } from 'react';
import { Bloque } from './Esqueleto';
import { usePresencia } from '../lib/presencia';
import { useVentana } from '../lib/ventana';
import { X, ShieldCheck, ShieldAlert, CheckCircle, Hash, RefreshCw } from 'lucide-react';
import { Lote } from '../types';
import { verificarIntegridadLote, ResultadoVerificacion, AnalisisCadena, revisarLote, RevisionLote } from '../services/hashService';

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
  const [analisis, setAnalisis] = useState<AnalisisCadena | null>(null);
  const [revision, setRevision] = useState<RevisionLote | null>(null);

  const ejecutarVerificacion = async () => {
    setVerificando(true);
    try {
      // Pequeña pausa para visualización de recálculo criptográfico
      await new Promise(r => setTimeout(r, 300));
      const [res, rev] = await Promise.all([verificarIntegridadLote(lote), revisarLote(lote)]);
      // La cadena puede estar íntegra y aun así la cabecera o el resumen guardados no corresponder a ella
      const otros = rev.avisos.filter((a) => a !== res.mensaje);
      setResultado(
        res.valido && rev.estado === 'alterado'
          ? { ...res, valido: false, mensaje: `Las fases están íntegras, pero hay datos que no corresponden a ellas. ${otros.join(' ')}` }
          : res
      );
      setAnalisis(rev.analisis);
      setRevision(rev);
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

  const presencia = usePresencia(isOpen);
  const ventana = useVentana(isOpen, onClose, { bloqueada: verificando });
  if (!presencia.montado) return null;

  return (
    <div {...ventana.propsVelo} role="dialog" aria-modal="true" aria-labelledby="titulo-integridad" data-saliendo={presencia.saliendo || undefined} className="velo fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden">
        {/* Cabecera */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Hash className="w-5 h-5 text-sky-400" />
            <h3 id="titulo-integridad" className="font-semibold text-base">Verificación Criptográfica de Integridad</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-slate-500 hover:text-white p-1 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <div className="text-xs text-slate-500 mb-4">
            Cada fase en <strong>Cultivos Loré</strong> se encadena con un hash SHA-256 derivado de su predecesor. Esta auditoría recalcula matemáticamente cada eslabón para detectar cualquier manipulación o inserción no autorizada.
          </div>

          {verificando ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <Bloque className="w-10 h-10 rounded-full" />
              <p className="text-sm font-medium text-slate-700">Auditando cadena de bloques SHA-256...</p>
              <p className="text-xs text-slate-500">Verificando {lote.eventos?.length || 0} fases registradas</p>
            </div>
          ) : resultado?.valido ? (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start space-x-3 text-emerald-900">
                <ShieldCheck className="w-8 h-8 text-emerald-600 shrink-0 mt-1" />
                <div>
                  <h4 className="font-semibold text-base text-emerald-800">Resultado: ÍNTEGRO</h4>
                  <p className="text-xs text-emerald-700 mt-1">{resultado.mensaje}</p>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Lote auditado:</span>
                  <span className="font-mono font-semibold text-slate-800">{lote.codigo}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Bloques verificados:</span>
                  <span className="font-semibold text-slate-800">{resultado.totalEventos} fases</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Hash Génesis (#0):</span>
                  <span className="font-mono text-xs text-slate-600">0000...0000 (64 ceros válidos)</span>
                </div>
                <div className="py-1">
                  <span className="text-slate-500 font-medium block mb-1">Hash Final del Lote (resumen.hashFinal):</span>
                  <span className="font-mono text-xs bg-white p-2 rounded-md border border-slate-300 block break-all text-slate-700">
                    {lote.resumen?.hashFinal || 'Sin hash registrado'}
                  </span>
                </div>
              </div>

              <div className="flex items-center text-xs text-emerald-700 space-x-2 bg-emerald-50/50 p-2 rounded-md">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>La evidencia digital concuerda 100% con los estándares de trazabilidad inalterable.</span>
              </div>
            </div>
          ) : resultado?.noVerificable ? (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-start space-x-3 text-slate-800">
              <ShieldAlert className="w-8 h-8 text-slate-500 shrink-0 mt-1" />
              <div>
                <h4 className="font-semibold text-base">No se puede verificar en este navegador</h4>
                <p className="text-xs text-slate-600 mt-1">{resultado.mensaje}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-red-900">
                <ShieldAlert className="w-8 h-8 text-red-600 shrink-0 mt-1" />
                <div>
                  <h4 className="font-semibold text-base text-red-800">Resultado: posible alteración detectada</h4>
                  <p className="text-xs text-red-700 mt-1">{resultado?.mensaje}</p>
                </div>
              </div>

              {revision && revision.diferencias.length > 0 && (
                <div className="border border-red-200 rounded-lg overflow-hidden text-xs">
                  <p className="font-semibold text-red-800 bg-red-50 px-3 py-2">Datos guardados que no corresponden a las fases registradas:</p>
                  <ul className="divide-y divide-red-100">
                    {revision.diferencias.map((d) => (
                      <li key={d.campo} className="px-3 py-2 bg-white text-slate-800">
                        <strong>{d.etiqueta}</strong>: guardado {d.guardado}; según las fases {d.derivado}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analisis && analisis.fases.some((f) => f.estado !== 'integra') && (
                <div className="border border-red-200 rounded-lg overflow-hidden text-xs">
                  <p className="font-semibold text-red-800 bg-red-50 px-3 py-2">Fases con problemas (rastro de la cadena):</p>
                  <ul className="divide-y divide-red-100">
                    {analisis.fases
                      .filter((f) => f.estado !== 'integra')
                      .map((f) => (
                        <li key={f.indice} className="px-3 py-2 bg-white">
                          <span className="text-slate-800">{f.mensaje}</span>
                          {f.estado === 'alterada' && !f.conRastro && (
                            <span className="block text-xs text-slate-500 mt-1">
                              Fase registrada antes del rastro por dato: se sabe que fue alterada, pero no qué dato cambió.
                            </span>
                          )}
                        </li>
                      ))}
                  </ul>
                  {analisis.selloCoincide === false && (
                    <p className="px-3 py-2 bg-white border-t border-red-100 text-red-700">El sello de cierre no coincide con la última fase.</p>
                  )}
                </div>
              )}

              {resultado?.detalles && (
                <div className="bg-slate-50 border border-red-200 rounded-lg p-3 text-xs space-y-2">
                  <p className="font-semibold text-red-800">Detalles de la discrepancia criptográfica:</p>
                  <div>
                    <span className="text-slate-500 block">Índice de la fase alterada:</span>
                    <span className="font-semibold font-mono text-slate-900">#{resultado.detalles.indice}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Hash recalculado según datos actuales:</span>
                    <span className="font-mono text-xs bg-red-50 text-red-800 p-1 rounded-md block break-all border border-red-200">
                      {resultado.detalles.hashEsperado || 'Discrepancia en cadena previa'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Hash guardado en el documento original:</span>
                    <span className="font-mono text-xs bg-slate-100 text-slate-800 p-1 rounded-md block break-all border border-slate-300">
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
              className="inline-flex items-center space-x-2 px-3 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
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
