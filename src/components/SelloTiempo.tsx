import React, { useEffect, useRef, useState } from 'react';
import { BloqueAnulacion, ComprobanteEntrega, SelloTiempo } from '../types';
import { AlertTriangle, Clock, Download } from 'lucide-react';
import { AvisoIntegridad, IndicadorVerificado } from './AvisoIntegridad';
import { descargarOts, mantenerSello, revisarSelloBloque, RevisionSello, sellarBloque } from '../services/selloTiempoService';

/**
 * Revisión del sello de tiempo de un registro (testigo externo, H03). `revisar` se vuelve a llamar
 * cuando cambia `clave` (por ejemplo, el digest y el estado guardados).
 */
export function useRevisionSello(revisar: (() => Promise<RevisionSello>) | null, clave: string): RevisionSello | null {
  const [revision, setRevision] = useState<RevisionSello | null>(null);
  useEffect(() => {
    if (!revisar) {
      setRevision(null);
      return;
    }
    let activo = true;
    setRevision(null);
    revisar()
      .then((r) => activo && setRevision(r))
      .catch(() => {});
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  return revision;
}

/**
 * Estado del sello de tiempo: verde si Bitcoin lo confirma y coincide, oro si está pendiente o
 * falta, aviso rojo (AvisoIntegridad) si no coincide con el registro. Permite descargar la prueba.
 */
export const SelloTiempoInfo: React.FC<{
  revision: RevisionSello | null;
  nombreArchivo: string;
  compacto?: boolean;
  className?: string;
}> = ({ revision: r, nombreArchivo, compacto = false, className = '' }) => {
  if (!r) return <p className={`text-xs text-slate-500 ${className}`}>Comprobando el sello de tiempo en Bitcoin…</p>;

  const descarga = r.ots ? (
    <button
      type="button"
      onClick={() => descargarOts(r.ots!, nombreArchivo)}
      className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline"
    >
      <Download className="w-3 h-3" aria-hidden="true" />
      Descargar prueba .ots
    </button>
  ) : null;

  const detalle = !compacto && r.digest && (
    <p className="text-xs text-slate-500 [overflow-wrap:anywhere]">
      Testigo externo: OpenTimestamps, anclado en Bitcoin. Sello cubierto: <code className="font-mono">{r.digest}</code>. La prueba se puede
      comprobar en opentimestamps.org o con <code className="font-mono">ots verify -d {r.digest.slice(0, 8)}… archivo.ots</code>.
    </p>
  );

  if (r.estado === 'alterado') {
    return (
      <div className={`space-y-2 ${className}`}>
        <AvisoIntegridad
          estado="alterado"
          titulo="Posible alteración detectada (sello de tiempo)"
          avisos={r.avisos}
          nota="El sello de tiempo es un testigo externo: lo que quedó registrado en Bitcoin no se puede cambiar desde la plataforma."
        />
        {descarga}
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className}`}>
      {r.estado === 'confirmado' &&
        (r.comprobadoEnBitcoin ? (
          <IndicadorVerificado texto={r.mensaje} />
        ) : (
          <p className="text-xs text-slate-600">{r.mensaje}</p>
        ))}
      {r.estado === 'pendiente' && (
        <p className="flex items-start gap-1 text-xs text-amber-800">
          <Clock className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          {r.mensaje}
        </p>
      )}
      {r.estado === 'sin_sello' && (
        <p className="flex items-start gap-1 text-xs font-semibold text-amber-800" role="status">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          {r.mensaje}
        </p>
      )}
      {r.estado === 'anterior' && <p className="text-xs text-slate-500">{r.mensaje}</p>}
      {r.advertencias.map((a) => (
        <p key={a} className="flex items-start gap-1 text-xs font-semibold text-amber-800" role="status">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          {a}
        </p>
      ))}
      {detalle}
      {descarga}
    </div>
  );
};

/**
 * Sello de tiempo de un bloque de comprobante (o de anulación). Con `mantener`, en el panel interno:
 * si falta y quien lo ve puede emitir comprobantes, lo envía (solo si el bloque se verificó íntegro);
 * si está pendiente, pide la confirmación de Bitcoin y la guarda.
 */
export const SelloTiempoBloque: React.FC<{
  bloque: ComprobanteEntrega | BloqueAnulacion;
  mantener?: { puedeCrear: boolean; verificado: boolean };
  className?: string;
}> = ({ bloque, mantener, className }) => {
  const [confirmado, setConfirmado] = useState<SelloTiempo | null>(null);
  const sello = confirmado || bloque.selloTiempo;
  const intento = useRef('');
  useEffect(() => {
    if (!mantener || !mantener.verificado) return;
    const clave = `${bloque.id}|${bloque.selloTiempo?.estado || 'sin'}`;
    if (intento.current === clave) return;
    intento.current = clave;
    mantenerSello({
      ruta: ['comprobantes', bloque.id],
      sello: bloque.selloTiempo,
      crear: mantener.puedeCrear ? () => sellarBloque(bloque) : undefined
    }).then((c) => c && setConfirmado(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bloque.id, bloque.selloTiempo?.estado, mantener?.verificado, mantener?.puedeCrear]);
  const revision = useRevisionSello(
    () => revisarSelloBloque({ ...bloque, selloTiempo: sello || undefined }),
    JSON.stringify([bloque.id, bloque.hashComprobante, sello?.digest, sello?.ots?.length])
  );
  return <SelloTiempoInfo revision={revision} nombreArchivo={`sello-comprobante-${bloque.id}`} compacto className={className} />;
};
