import React, { useEffect, useState } from 'react';
import { quienRegistro } from '../services/usuariosService';
import { Camera, ShieldAlert, ShieldCheck } from 'lucide-react';
import { BloqueAnulacion, ComprobanteEntrega, OrdenEntrega } from '../types';
import { DIAS_RETENCION_FOTOS, FotoEntrega, RevisionFoto, escucharFotosOrden, revisarFoto } from '../services/fotosService';
import { escucharComprobantesOrden, esAnulacion } from '../services/comprobantesService';
import { formatearFechaColombia } from '../utils/constants';

/**
 * Fotos de las entregas de una orden (solo operador). Cada entrega con foto conserva en el
 * historial el hash de la imagen; la imagen se muestra mientras exista (15 días). Cada foto se
 * verifica sola al mostrarse, contra el hash de la entrega y el del comprobante emitido.
 */
export const FotosEntregaOrden: React.FC<{ orden: OrdenEntrega }> = ({ orden: o }) => {
  const [fotos, setFotos] = useState<Record<string, FotoEntrega>>({});
  const [cargadas, setCargadas] = useState(false);
  const [error, setError] = useState('');
  const [bloques, setBloques] = useState<(ComprobanteEntrega | BloqueAnulacion)[]>([]);
  const [revision, setRevision] = useState<Record<string, RevisionFoto>>({});
  const [ampliada, setAmpliada] = useState<FotoEntrega | null>(null);

  const entregasConFoto = o.historial.filter((e) => e.tipo === 'Entrega' && e.datos?.foto?.id);

  useEffect(() => {
    if (!entregasConFoto.length) return;
    setCargadas(false);
    return escucharFotosOrden(
      o.granjaId,
      o.id,
      (lista) => {
        setFotos(Object.fromEntries(lista.map((f) => [f.id, f])));
        setCargadas(true);
      },
      () => setError('No se pudieron cargar las fotos de esta orden (sin permiso o sin conexión): no se puede saber si siguen guardadas.')
    );
  }, [o.granjaId, o.id, entregasConFoto.length]);

  // Comprobantes emitidos: guardan el hash de la foto de cada entrega que documentan
  useEffect(() => {
    if (!entregasConFoto.length) return;
    return escucharComprobantesOrden(o.granjaId, o.id, setBloques, () => setBloques([]));
  }, [o.granjaId, o.id, entregasConFoto.length]);

  const fotoHashComprobante = (eventoId?: string): string | undefined => {
    for (const b of bloques) {
      if (esAnulacion(b)) continue;
      const e = b.entregas.find((x) => x.eventoId === eventoId);
      if (e?.fotoHash) return e.fotoHash;
    }
    return undefined;
  };

  // Verificación automática de cada foto cuando la lista ya se leyó del servidor
  useEffect(() => {
    if (!cargadas || error) return;
    let activo = true;
    (async () => {
      const r: Record<string, RevisionFoto> = {};
      for (const e of entregasConFoto) {
        const ref = e.datos.foto as { id: string; hash: string };
        r[ref.id] = await revisarFoto(fotos[ref.id], ref, { fecha: e.fecha, eventoId: e.eventoId, ordenId: o.id }, fotoHashComprobante(e.eventoId));
      }
      if (activo) setRevision(r);
    })().catch(() => {});
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargadas, error, fotos, bloques, o.historial.length]);

  if (!entregasConFoto.length) return null;

  return (
    <div className="space-y-2">
      {entregasConFoto.map((e) => {
        const ref = e.datos.foto as { id: string; hash: string };
        const foto = fotos[ref.id];
        const v = revision[ref.id];
        const alterada = v?.estado === 'alterada';
        const borrada = v?.estado === 'borrada';
        return (
          <div
            key={ref.id}
            className={`flex flex-wrap items-start gap-3 rounded-md p-2 border ${
              alterada || borrada ? 'border-red-200 border-l-2 border-l-red-600 bg-red-50 fila-escalonada' : 'border-slate-100'
            }`}
          >
            {foto ? (
              <button type="button" onClick={() => setAmpliada(foto)} title="Ampliar">
                <img
                  src={foto.datos}
                  alt="Foto de la entrega"
                  className={`w-24 h-24 object-cover rounded-md border border-slate-200 ${alterada ? 'grayscale opacity-60' : ''}`}
                />
              </button>
            ) : (
              <div className="w-24 h-24 rounded-md border border-dashed border-slate-300 flex items-center justify-center text-slate-500">
                <Camera className="w-6 h-6" />
              </div>
            )}
            <div className="space-y-1 min-w-0 flex-1">
              <span className="block font-semibold text-slate-700">
                Entrega · {formatearFechaColombia(e.fecha)} · {quienRegistro(e)}
              </span>
              {foto && (
                <span className="block text-slate-500">
                  Disponible hasta {formatearFechaColombia(foto.expiraEn.toDate().toISOString())} (se borra sola a los {DIAS_RETENCION_FOTOS} días).
                </span>
              )}
              {!v && !error && <span className="block text-slate-500">Verificando la foto…</span>}
              {v?.estado === 'verificada' && (
                <span className="flex items-center text-emerald-700">
                  <ShieldCheck className="w-3 h-3 mr-1 shrink-0" aria-hidden="true" />
                  Archivo verificado{v.respaldo ? ' (huella de respaldo, no criptográfica)' : ''}
                </span>
              )}
              {v?.estado === 'vencida' && <span className="block text-slate-500">{v.mensaje}</span>}
              {v?.estado === 'no_verificable' && <span className="block text-slate-600">{v.mensaje}</span>}
              {(alterada || borrada) && (
                <div className="text-red-800 space-y-1" role="alert">
                  <span className="flex items-center font-semibold">
                    <ShieldAlert className="w-3.5 h-3.5 mr-1 shrink-0" aria-hidden="true" />
                    Posible alteración detectada
                  </span>
                  <span className="block">{v!.mensaje}</span>
                  <span className="block text-xs">Registrada el {formatearFechaColombia(v!.registradaEn)}.</span>
                </div>
              )}
              <span className="block font-mono text-xs text-slate-500 break-all">
                {alterada ? 'Esperado' : 'SHA-256'}: {ref.hash}
              </span>
              {alterada && v?.hashObtenido && (
                <span className="block font-mono text-xs text-red-700 break-all">Obtenido: {v.hashObtenido}</span>
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
          <img src={ampliada.datos} alt="Foto de la entrega" className="max-w-full max-h-full rounded-md" />
        </div>
      )}
    </div>
  );
};
