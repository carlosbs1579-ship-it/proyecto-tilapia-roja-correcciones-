import React, { useEffect, useState } from 'react';
import { FileText, Download, ShieldCheck, ShieldAlert, Link2, Eye } from 'lucide-react';
import { BloqueAnulacion, ComprobanteEntrega, OrdenEntrega } from '../types';
import {
  anularComprobante,
  separarBloques,
  construirComprobante,
  emitirComprobanteDefinitivo,
  entregasConComprobante,
  escucharComprobantesOrden,
  verificarCadena,
  problemasParaEmitir,
  ultimaEntrega,
  verificarComprobante
} from '../services/comprobantesService';
import { descargarComprobantePdf, verComprobantePdf } from '../services/pdfService';
import { construirUrlConsultaEntrega, generarQrDataUrl } from '../services/qrService';
import { formatearFechaColombia } from '../utils/constants';
import { num } from './entregasUi';

type Ejecutar = (accion: () => Promise<void>, exito: string) => Promise<void>;

/**
 * Documentación de entrega de una orden: comprobante preliminar (no se guarda), emisión del
 * comprobante definitivo (registro inmutable, una versión por cada entrega confirmada), versiones
 * emitidas con verificación, y el QR / enlace de consulta para el cliente.
 */
export const DocumentacionEntrega: React.FC<{
  orden: OrdenEntrega;
  uidActual?: string;
  procesando: boolean;
  ejecutar: Ejecutar;
}> = ({ orden: o, uidActual, procesando, ejecutar }) => {
  const [bloques, setBloques] = useState<(ComprobanteEntrega | BloqueAnulacion)[]>([]);
  const { comprobantes, anulaciones } = separarBloques(bloques);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivoAnulacion, setMotivoAnulacion] = useState('');
  const [errorLectura, setErrorLectura] = useState('');
  const [verificacion, setVerificacion] = useState<Record<string, { ok: boolean; mensaje: string }>>({});
  const [qr, setQr] = useState('');
  const [copiado, setCopiado] = useState(false);

  useEffect(
    () =>
      escucharComprobantesOrden(o.granjaId, o.id, setBloques, () =>
        setErrorLectura('No se pudieron leer los comprobantes de esta orden.')
      ),
    [o.granjaId, o.id]
  );

  const url = o.tokenConsulta ? construirUrlConsultaEntrega(o.tokenConsulta) : '';
  useEffect(() => {
    if (!url) return setQr('');
    generarQrDataUrl(url).then(setQr).catch(() => setQr(''));
  }, [url]);

  const hayEntrega = Boolean(ultimaEntrega(o));
  const problemas = problemasParaEmitir(o);
  const pendientes = o.historial.filter((e) => e.tipo === 'Entrega' && e.eventoId && !entregasConComprobante(o).has(e.eventoId));

  const preliminar = () =>
    verComprobantePdf(
      construirComprobante(o, { id: 'preliminar', version: 0, token: '', uid: uidActual || '', emitidoEn: new Date().toISOString() }),
      true
    );

  const confirmarAnulacion = (c: ComprobanteEntrega) =>
    ejecutar(async () => {
      await anularComprobante(c.id, motivoAnulacion);
      setAnulando(null);
      setMotivoAnulacion('');
    }, `Comprobante v${c.version} anulado. Se conserva en la cadena marcado como anulado.`);

  const verificar = async (c: ComprobanteEntrega) => {
    const r = await verificarComprobante(c, { orden: o });
    setVerificacion((v) => ({ ...v, [c.id]: { ok: r.contenidoIntegro && r.eventosIntegros !== false, mensaje: r.mensaje } }));
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={preliminar}
          className="flex items-center space-x-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-semibold"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Ver preliminar</span>
        </button>
        <button
          type="button"
          disabled={procesando || problemas.length > 0}
          onClick={() => ejecutar(async () => void (await emitirComprobanteDefinitivo(o.id)), 'Comprobante definitivo emitido.')}
          className="flex items-center space-x-1 px-2.5 py-1.5 rounded bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-40 font-semibold"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Emitir comprobante definitivo</span>
        </button>
      </div>
      <p className="text-[10px] text-slate-500">
        El preliminar se genera al momento con los datos actuales, va marcado como PRELIMINAR y no se guarda. El definitivo
        solo usa datos confirmados en el servidor, queda guardado y no se puede modificar.
      </p>
      {hayEntrega && problemas.length > 0 && pendientes.length === 0 && comprobantes.length > 0 ? (
        <p className="text-emerald-700">Todas las entregas confirmadas de esta orden tienen su comprobante definitivo.</p>
      ) : (
        problemas.length > 0 && (
          <ul className="list-disc ml-4 text-amber-700 space-y-0.5">
            {problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )
      )}
      {pendientes.length > 0 && problemas.length === 0 && (
        <p className="font-semibold text-amber-700">Entrega confirmada sin comprobante definitivo: emítalo para documentarla.</p>
      )}
      {errorLectura && <p className="text-red-600">{errorLectura}</p>}

      {comprobantes.length > 0 && (
        <p className={verificarCadena(bloques).integra ? 'text-emerald-700' : 'text-red-600'}>{verificarCadena(bloques).mensaje}</p>
      )}
      {comprobantes.length > 0 && (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded">
          {comprobantes.map((c) => (
            <li key={c.id} className="p-2 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-700">
                  <strong>v{c.version}</strong>
                  {anulaciones[c.id] && <strong className="ml-1 px-1 rounded bg-red-100 text-red-700">ANULADO</strong>} · {formatearFechaColombia(c.emitidoEn)} ·{' '}
                  {c.estadoEntrega === 'entregado' ? 'Entrega completa' : 'Entrega parcial'} · entregado {num(c.cantidadEntregada)} {c.unidad}
                  {c.cantidadPendiente > 0 && ` · pendiente ${num(c.cantidadPendiente)} ${c.unidad}`}
                </span>
                <span className="flex flex-wrap gap-1">
                  <button type="button" onClick={() => verComprobantePdf(c, false, anulaciones[c.id])} className="px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100">
                    Ver
                  </button>
                  <button
                    type="button"
                    onClick={() => descargarComprobantePdf(c, false, anulaciones[c.id])}
                    className="flex items-center px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100"
                  >
                    <Download className="w-3 h-3 mr-0.5" />
                    PDF
                  </button>
                  <button type="button" onClick={() => verificar(c)} className="px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100">
                    Verificar
                  </button>
                  {!anulaciones[c.id] && (
                    <button
                      type="button"
                      onClick={() => {
                        setAnulando(anulando === c.id ? null : c.id);
                        setMotivoAnulacion('');
                      }}
                      className="px-1.5 py-0.5 rounded border border-red-300 text-red-700 hover:bg-red-50"
                    >
                      Anular
                    </button>
                  )}
                </span>
              </div>
              {anulaciones[c.id] && (
                <p className="text-red-700">
                  Anulado el {formatearFechaColombia(anulaciones[c.id].emitidoEn)} (bloque v{anulaciones[c.id].version}). Motivo: {anulaciones[c.id].motivo}
                </p>
              )}
              {anulando === c.id && !anulaciones[c.id] && (
                <div className="border border-red-200 bg-red-50 rounded p-2 space-y-1">
                  <p className="text-red-800">
                    Anular deja este comprobante sin validez, pero <strong>no lo borra</strong>: queda en la cadena marcado como anulado, con el motivo.
                    No se puede deshacer.
                  </p>
                  <input
                    type="text"
                    maxLength={500}
                    placeholder="Motivo de la anulación (obligatorio, mínimo 10 caracteres)"
                    value={motivoAnulacion}
                    onChange={(e) => setMotivoAnulacion(e.target.value)}
                    className="w-full px-2 py-1 border border-red-300 rounded"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={procesando || motivoAnulacion.trim().length < 10}
                      onClick={() => confirmarAnulacion(c)}
                      className="px-2 py-1 rounded bg-red-700 text-white font-semibold disabled:opacity-40"
                    >
                      Confirmar anulación
                    </button>
                    <button type="button" onClick={() => setAnulando(null)} className="px-2 py-1 rounded border border-slate-300">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {verificacion[c.id] && (
                <span className={`flex items-start ${verificacion[c.id].ok ? 'text-emerald-700' : 'text-red-600'}`}>
                  {verificacion[c.id].ok ? <ShieldCheck className="w-3 h-3 mr-1 shrink-0" /> : <ShieldAlert className="w-3 h-3 mr-1 shrink-0" />}
                  {verificacion[c.id].mensaje}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {url && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {qr && <img src={qr} alt="QR de consulta de la entrega" className="w-20 h-20 border border-slate-200 rounded" />}
          <div className="space-y-1 min-w-0">
            <span className="block font-semibold text-slate-700">Consulta del cliente (sin cuenta)</span>
            <span className="block font-mono text-[10px] text-slate-500 break-all">{url}</span>
            <button type="button" onClick={copiar} className="flex items-center px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100">
              <Link2 className="w-3 h-3 mr-1" />
              {copiado ? 'Enlace copiado' : 'Copiar enlace'}
            </button>
            <span className="block text-[10px] text-slate-400">
              Muestra solo los comprobantes emitidos de esta orden; los datos de otros pedidos o lotes no se exponen.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
