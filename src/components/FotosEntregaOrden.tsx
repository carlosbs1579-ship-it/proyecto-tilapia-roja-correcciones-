import React, { useEffect, useState } from 'react';
import { Camera, ShieldAlert, ShieldCheck } from 'lucide-react';
import { OrdenEntrega } from '../types';
import { DIAS_RETENCION_FOTOS, FotoEntrega, escucharFotosOrden, verificarFoto } from '../services/fotosService';
import { formatearFechaColombia } from '../utils/constants';

/**
 * Fotos de las entregas de una orden (solo operador). Cada entrega con foto conserva en el
 * historial el hash de la imagen; la imagen se muestra mientras exista (15 días).
 */
export const FotosEntregaOrden: React.FC<{ orden: OrdenEntrega }> = ({ orden: o }) => {
  const [fotos, setFotos] = useState<Record<string, FotoEntrega>>({});
  const [error, setError] = useState('');
  const [verificacion, setVerificacion] = useState<Record<string, boolean>>({});
  const [ampliada, setAmpliada] = useState<FotoEntrega | null>(null);

  const entregasConFoto = o.historial.filter((e) => e.tipo === 'Entrega' && e.datos?.foto?.id);

  useEffect(() => {
    if (!entregasConFoto.length) return;
    return escucharFotosOrden(
      o.granjaId,
      o.id,
      (lista) => setFotos(Object.fromEntries(lista.map((f) => [f.id, f]))),
      () => setError('No se pudieron cargar las fotos de esta orden.')
    );
  }, [o.granjaId, o.id, entregasConFoto.length]);

  if (!entregasConFoto.length) return null;

  return (
    <div className="space-y-2">
      {entregasConFoto.map((e) => {
        const ref = e.datos.foto as { id: string; hash: string };
        const foto = fotos[ref.id];
        const v = verificacion[ref.id];
        return (
          <div key={ref.id} className="flex flex-wrap items-start gap-3 border border-slate-100 rounded p-2">
            {foto ? (
              <button type="button" onClick={() => setAmpliada(foto)} title="Ampliar">
                <img src={foto.datos} alt="Foto de la entrega" className="w-24 h-24 object-cover rounded border border-slate-200" />
              </button>
            ) : (
              <div className="w-24 h-24 rounded border border-dashed border-slate-300 flex items-center justify-center text-slate-400">
                <Camera className="w-6 h-6" />
              </div>
            )}
            <div className="space-y-1 min-w-0 flex-1">
              <span className="block font-semibold text-slate-700">
                Entrega · {formatearFechaColombia(e.fecha)} · {e.registradoPor}
              </span>
              {foto ? (
                <span className="block text-slate-500">
                  Disponible hasta {formatearFechaColombia(foto.expiraEn.toDate().toISOString())} (se borra sola a los {DIAS_RETENCION_FOTOS} días).
                </span>
              ) : (
                <span className="block text-slate-500">
                  La imagen ya no está disponible (se conserva {DIAS_RETENCION_FOTOS} días). Queda el registro de la foto en el historial.
                </span>
              )}
              <span className="block font-mono text-[10px] text-slate-400 break-all">SHA-256: {ref.hash}</span>
              {foto && (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await verificarFoto(foto, ref.hash);
                    setVerificacion((prev) => ({ ...prev, [ref.id]: ok }));
                  }}
                  className="px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100"
                >
                  Verificar foto
                </button>
              )}
              {v !== undefined && (
                <span className={`flex items-center ${v ? 'text-emerald-700' : 'text-red-600'}`}>
                  {v ? <ShieldCheck className="w-3 h-3 mr-1" /> : <ShieldAlert className="w-3 h-3 mr-1" />}
                  {v ? 'La foto coincide con la registrada en la entrega.' : 'La foto no coincide con el hash registrado.'}
                </span>
              )}
            </div>
          </div>
        );
      })}
      {error && <p className="text-red-600">{error}</p>}
      {ampliada && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setAmpliada(null)}
          role="dialog"
          aria-label="Foto de la entrega"
        >
          <img src={ampliada.datos} alt="Foto de la entrega" className="max-w-full max-h-full rounded" />
        </div>
      )}
    </div>
  );
};
