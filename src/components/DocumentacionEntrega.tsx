import React, { useEffect, useState } from 'react';
import { FileText, Download, ShieldCheck, ShieldAlert, Link2, Eye } from 'lucide-react';
import { ComprobanteEntrega, OrdenEntrega } from '../types';
import {
  construirComprobante,
  emitirComprobanteDefinitivo,
  entregasConComprobante,
  escucharComprobantesOrden,
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
  const [comprobantes, setComprobantes] = useState<ComprobanteEntrega[]>([]);
  const [errorLectura, setErrorLectura] = useState('');
  const [verificacion, setVerificacion] = useState<Record<string, { ok: boolean; mensaje: string }>>({});
  const [qr, setQr] = useState('');
  const [copiado, setCopiado] = useState(false);

  useEffect(
    () =>
      escucharComprobantesOrden(o.granjaId, o.id, setComprobantes, () =>
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
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-2">Versión</th>
                <th className="py-1 pr-2">Emitido</th>
                <th className="py-1 pr-2">Estado</th>
                <th className="py-1 pr-2 text-right">Entregado</th>
                <th className="py-1 pr-2 text-right">Pendiente</th>
                <th className="py-1">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {comprobantes.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 align-top">
                  <td className="py-1 pr-2 font-semibold">v{c.version}</td>
                  <td className="py-1 pr-2">{formatearFechaColombia(c.emitidoEn)}</td>
                  <td className="py-1 pr-2">{c.estadoEntrega === 'entregado' ? 'Entrega completa' : 'Entrega parcial'}</td>
                  <td className="py-1 pr-2 text-right">{num(c.cantidadEntregada)} {c.unidad}</td>
                  <td className="py-1 pr-2 text-right">{num(c.cantidadPendiente)} {c.unidad}</td>
                  <td className="py-1">
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={() => verComprobantePdf(c, false)} className="px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100">
                        Ver
                      </button>
                      <button
                        type="button"
                        onClick={() => descargarComprobantePdf(c, false)}
                        className="flex items-center px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100"
                      >
                        <Download className="w-3 h-3 mr-0.5" />
                        PDF
                      </button>
                      <button type="button" onClick={() => verificar(c)} className="px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100">
                        Verificar
                      </button>
                    </div>
                    {verificacion[c.id] && (
                      <span className={`flex items-start mt-1 ${verificacion[c.id].ok ? 'text-emerald-700' : 'text-red-600'}`}>
                        {verificacion[c.id].ok ? <ShieldCheck className="w-3 h-3 mr-1 shrink-0" /> : <ShieldAlert className="w-3 h-3 mr-1 shrink-0" />}
                        {verificacion[c.id].mensaje}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
