import React, { useEffect, useState } from 'react';
import { ArrowLeft, Download, FileText, ShieldAlert, ShieldCheck, Truck } from 'lucide-react';
import { ComprobanteEntrega, ConsultaEntrega } from '../types';
import { EMPRESA, leerConsultaEntrega, verificarComprobante } from '../services/comprobantesService';
import { descargarComprobantePdf, verComprobantePdf } from '../services/pdfService';
import { formatearFechaColombia } from '../utils/constants';

const num = (n: number) => (Number(n) || 0).toLocaleString('es-CO');

/**
 * Consulta pública de una entrega con el código del QR del comprobante (sin cuenta). Muestra solo
 * los comprobantes definitivos emitidos para esa orden; desde cada lote se puede abrir su
 * trazabilidad pública (el QR del lote), que no muestra entregas.
 */
export const ConsultaEntregaPublica: React.FC<{
  token: string;
  onAbrirLote: (codigo: string) => void;
  onVolver: () => void;
}> = ({ token, onAbrirLote, onVolver }) => {
  const [estado, setEstado] = useState<'cargando' | 'no_encontrada' | 'error' | 'ok'>('cargando');
  const [consulta, setConsulta] = useState<ConsultaEntrega | null>(null);
  const [comprobantes, setComprobantes] = useState<ComprobanteEntrega[]>([]);
  const [verificacion, setVerificacion] = useState<Record<string, { ok: boolean; mensaje: string }>>({});

  useEffect(() => {
    let activo = true;
    leerConsultaEntrega(token)
      .then(async (r) => {
        if (!activo) return;
        if (!r || !r.comprobantes.length) return setEstado('no_encontrada');
        setConsulta(r.consulta);
        setComprobantes(r.comprobantes);
        setEstado('ok');
        // Verificación automática de cada versión contra su hash y el índice de consulta
        const resultados: Record<string, { ok: boolean; mensaje: string }> = {};
        for (const c of r.comprobantes) {
          const v = await verificarComprobante(c, { consulta: r.consulta });
          resultados[c.id] = { ok: v.contenidoIntegro && v.indiceCoincide !== false, mensaje: v.mensaje };
        }
        if (activo) setVerificacion(resultados);
      })
      .catch(() => activo && setEstado('error'));
    return () => {
      activo = false;
    };
  }, [token]);

  const actual = comprobantes[0];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="bg-sky-800 text-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center space-x-2 min-w-0">
            <Truck className="w-5 h-5 shrink-0" />
            <div className="min-w-0">
              <span className="block font-bold truncate">{EMPRESA}</span>
              <span className="block text-xs text-sky-100">Consulta de entrega</span>
            </div>
          </div>
          <button type="button" onClick={onVolver} className="flex items-center text-xs text-sky-100 hover:text-white shrink-0">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Ir al inicio
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4 text-sm">
        {estado === 'cargando' && <p className="text-slate-500">Consultando la entrega…</p>}
        {estado === 'no_encontrada' && (
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="font-semibold">No se encontró ninguna entrega con este código.</p>
            <p className="text-slate-500 text-xs mt-1">Revise que el enlace o el código QR estén completos.</p>
          </div>
        )}
        {estado === 'error' && (
          <div className="bg-white rounded-lg border border-red-200 p-4 text-red-700">No se pudo consultar la entrega. Intente de nuevo.</div>
        )}

        {estado === 'ok' && actual && consulta && (
          <>
            <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="block text-xs text-slate-500">Pedido</span>
                  <span className="font-mono font-bold">{actual.ordenId}</span>
                </div>
                <span
                  className={`px-2 py-1 rounded text-xs font-bold ${
                    actual.estadoEntrega === 'entregado' && actual.cantidadPendiente <= 0
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {actual.estadoEntrega === 'entregado' && actual.cantidadPendiente <= 0
                    ? 'Entrega completa'
                    : `Entrega parcial · pendientes ${num(actual.cantidadPendiente)} ${actual.unidad}`}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-700">
                <span>Cliente: <strong>{actual.cliente.nombre}</strong></span>
                <span>Repartidor: <strong>{actual.repartidor || '—'}</strong></span>
                <span>Autorizado: <strong>{num(actual.cantidadAutorizada)} {actual.unidad}</strong></span>
                <span>Entregado: <strong>{num(actual.cantidadEntregada)} {actual.unidad}</strong></span>
                <span>Última confirmación: <strong>{actual.fechas.confirmacion ? formatearFechaColombia(actual.fechas.confirmacion) : '—'}</strong></span>
                <span>Comprobante vigente: <strong>versión {actual.version}</strong></span>
              </div>
            </section>

            <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-2">
              <span className="font-bold block">Procedencia del producto</span>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1 pr-2">Lote</th>
                      <th className="py-1 pr-2">Piscina</th>
                      <th className="py-1 pr-2 text-right">Entregado</th>
                      <th className="py-1">Trazabilidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(actual.procedencias).map(([lote, p]) => (
                      <tr key={lote} className="border-t border-slate-100">
                        <td className="py-1 pr-2 font-mono">{lote}</td>
                        <td className="py-1 pr-2">{p.estanque}</td>
                        <td className="py-1 pr-2 text-right">{num(p.entregada)} {actual.unidad}</td>
                        <td className="py-1">
                          <button type="button" onClick={() => onAbrirLote(lote)} className="text-sky-700 hover:underline font-semibold">
                            Ver lote
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-2">
              <span className="font-bold block">Comprobantes emitidos ({comprobantes.length})</span>
              {comprobantes.map((c) => (
                <div key={c.id} className="border border-slate-100 rounded p-2 space-y-1 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong>Versión {c.version}</strong> · {formatearFechaColombia(c.emitidoEn)} ·{' '}
                      {c.estadoEntrega === 'entregado' ? 'entrega completa' : 'entrega parcial'} · entregado {num(c.cantidadEntregada)} {c.unidad}
                    </span>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => verComprobantePdf(c, false)} className="flex items-center px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100">
                        <FileText className="w-3 h-3 mr-0.5" />
                        Ver
                      </button>
                      <button type="button" onClick={() => descargarComprobantePdf(c, false)} className="flex items-center px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100">
                        <Download className="w-3 h-3 mr-0.5" />
                        PDF
                      </button>
                    </span>
                  </div>
                  {verificacion[c.id] ? (
                    <span className={`flex items-start ${verificacion[c.id].ok ? 'text-emerald-700' : 'text-red-600'}`}>
                      {verificacion[c.id].ok ? <ShieldCheck className="w-3 h-3 mr-1 shrink-0" /> : <ShieldAlert className="w-3 h-3 mr-1 shrink-0" />}
                      {verificacion[c.id].mensaje}
                    </span>
                  ) : (
                    <span className="text-slate-400">Verificando…</span>
                  )}
                </div>
              ))}
              <p className="text-[10px] text-slate-400">
                Cada comprobante se guarda una sola vez y no se modifica; su hash SHA-256 se recalcula aquí para verificarlo (no es una blockchain).
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
};
