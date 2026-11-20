import React, { useEffect, useState } from 'react';
import { FileText, Download, ShieldCheck, ShieldAlert, Link2, Eye } from 'lucide-react';
import { BloqueAnulacion, ComprobanteEntrega, OrdenEntrega } from '../types';
import {
  anularComprobante,
  esAnulacion,
  separarBloques,
  construirComprobante,
  emitirComprobanteDefinitivo,
  entregasConComprobante,
  escucharComprobantesOrden,
  horaServidorBloque,
  revisarSellosLotes,
  verificarCadena,
  problemasParaEmitir,
  ultimaEntrega,
  verificarComprobante
} from '../services/comprobantesService';
import { descargarComprobantePdf, verComprobantePdf } from '../services/pdfService';
import { construirUrlConsultaEntrega, generarQrDataUrl } from '../services/qrService';
import { formatearFechaColombia } from '../utils/constants';
import { num } from './entregasUi';
import { SelloTiempoBloque } from './SelloTiempo';

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
  puedeEmitir?: boolean; // permiso "Emitir y anular comprobantes"
}> = ({ orden: o, uidActual, procesando, ejecutar, puedeEmitir = true }) => {
  const [bloques, setBloques] = useState<(ComprobanteEntrega | BloqueAnulacion)[]>([]);
  const { comprobantes, anulaciones } = separarBloques(bloques);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [cargado, setCargado] = useState(false);
  // Registros que la orden dice haber emitido o anulado: si existen menos bloques, se borró alguno
  const bloquesEsperados = o.historial.filter((e) => e.tipo === 'Comprobante emitido' || e.tipo === 'Comprobante anulado').length;
  const [motivoAnulacion, setMotivoAnulacion] = useState('');
  const [errorLectura, setErrorLectura] = useState('');
  const [verificacion, setVerificacion] = useState<Record<string, { ok: boolean; mensaje: string; noVerificable?: boolean }>>({});
  // Sello de los lotes y anotaciones registrados en cada comprobante nuevo, comparados con los actuales
  const [sellos, setSellos] = useState<Record<string, { avisos: string[]; notas: string[] }>>({});
  const [qr, setQr] = useState('');
  const [copiado, setCopiado] = useState(false);

  useEffect(
    () =>
      escucharComprobantesOrden(o.granjaId, o.id, (b) => {
        setBloques(b);
        setCargado(true);
      }, () =>
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
    }, `Comprobante N.º ${c.version} anulado. Se conserva en la cadena marcado como anulado.`);

  const verificar = async (c: ComprobanteEntrega) => {
    const r = await verificarComprobante(c, { orden: o });
    setVerificacion((v) => ({ ...v, [c.id]: { ok: r.ok, mensaje: r.mensaje, noVerificable: r.noVerificable } }));
    if (c.sellosLotes) {
      const rs = await revisarSellosLotes(c).catch(() => null);
      if (rs) setSellos((v) => ({ ...v, [c.id]: rs }));
    }
  };

  // Verificación automática de cada comprobante al abrir la orden: hash propio, eventos usados,
  // hash que guardó la orden al emitirlo y contenido reconstruido desde el historial
  useEffect(() => {
    let activo = true;
    (async () => {
      const r: Record<string, { ok: boolean; mensaje: string; noVerificable?: boolean }> = {};
      const rs: Record<string, { avisos: string[]; notas: string[] }> = {};
      for (const b of bloques) {
        const v = await verificarComprobante(b, esAnulacion(b) ? {} : { orden: o });
        r[b.id] = { ok: v.ok, mensaje: v.mensaje, noVerificable: v.noVerificable };
        if (!esAnulacion(b) && b.sellosLotes) rs[b.id] = await revisarSellosLotes(b).catch(() => ({ avisos: [], notas: ['No se pudieron leer los lotes para comparar sus sellos.'] }));
      }
      if (activo) {
        setVerificacion(r);
        setSellos(rs);
      }
    })().catch(() => {});
    return () => {
      activo = false;
    };
  }, [bloques, o]);
  const alteracionDe = (id: string) =>
    [verificacion[id] && !verificacion[id].ok && !verificacion[id].noVerificable ? verificacion[id].mensaje : '', ...(sellos[id]?.avisos || [])]
      .filter(Boolean)
      .join(' ');

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
          className="flex items-center space-x-1 px-3 py-2 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-semibold"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Ver preliminar</span>
        </button>
        <button
          type="button"
          hidden={!puedeEmitir}
          disabled={procesando || problemas.length > 0}
          onClick={() => ejecutar(async () => void (await emitirComprobanteDefinitivo(o.id)), 'Comprobante definitivo emitido.')}
          className="flex items-center space-x-1 px-3 py-2 rounded-md bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-40 font-semibold"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Emitir comprobante definitivo</span>
        </button>
      </div>
      <p className="text-xs text-slate-500">
        El preliminar se genera al momento con los datos actuales, va marcado como PRELIMINAR y no se guarda. El definitivo
        solo usa datos confirmados en el servidor, queda guardado y no se puede modificar.
      </p>
      {hayEntrega && problemas.length > 0 && pendientes.length === 0 && comprobantes.length > 0 ? (
        <p className="text-emerald-700">Todas las entregas confirmadas de esta orden tienen su comprobante definitivo.</p>
      ) : (
        problemas.length > 0 && (
          <ul className="list-disc ml-4 text-amber-700 space-y-1">
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
      {ultimaEntrega(o)?.evento.tipo === 'Corrección de entrega' &&
        comprobantes.some((c) => !anulaciones[c.id] && c.eventoEntregaId !== ultimaEntrega(o)?.evento.eventoId) && (
          <p className="font-semibold text-amber-700">
            La entrega se corrigió después de emitir el comprobante vigente: anúlalo (tiene los datos anteriores) y emite uno nuevo.
          </p>
        )}

      {cargado && !errorLectura && (comprobantes.length > 0 || bloquesEsperados > 0) && (
        <p className={verificarCadena(bloques).integra && bloques.length >= bloquesEsperados ? 'text-emerald-700' : 'text-red-600'}>
          {bloques.length < bloquesEsperados
            ? `Cadena incompleta: el historial de la orden registra ${bloquesEsperados} registro(s), pero solo existen ${bloques.length}. Falta el más reciente o fue borrado.`
            : verificarCadena(bloques).mensaje}
        </p>
      )}
      {comprobantes.length > 0 && (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-md">
          {bloques.map((b) =>
            esAnulacion(b) ? (
              <li key={b.id} className="p-2 text-red-700 bg-red-50/40 space-y-1">
                <span className="block">
                  Registro N.º {b.version} · Anulación del comprobante N.º {b.versionAnulada} · {formatearFechaColombia(b.emitidoEn)}
                </span>
                {verificacion[b.id] && !verificacion[b.id].ok && (
                  <span className="flex items-start font-semibold">
                    <ShieldAlert className="w-3 h-3 mr-1 mt-0.5 shrink-0" aria-hidden="true" />
                    {verificacion[b.id].mensaje}
                  </span>
                )}
                <SelloTiempoBloque bloque={b} mantener={{ puedeCrear: puedeEmitir, verificado: Boolean(verificacion[b.id]?.ok) }} />
              </li>
            ) : ((c: ComprobanteEntrega) => (
            <li key={c.id} className="p-2 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-700">
                  <strong>Comprobante N.º {c.version}</strong>
                  {anulaciones[c.id] && <strong className="ml-1 px-1 rounded-md bg-red-100 text-red-700">ANULADO</strong>} · {formatearFechaColombia(c.emitidoEn)} ·{' '}
                  {c.estadoEntrega === 'entregado' ? 'Entrega completa' : 'Entrega parcial'} · entregado {num(c.cantidadEntregada)} {c.unidad}
                  {c.cantidadPendiente > 0 && ` · pendiente ${num(c.cantidadPendiente)} ${c.unidad}`}
                </span>
                <span className="flex flex-wrap gap-1">
                  <button type="button" onClick={() => verComprobantePdf(c, false, anulaciones[c.id], alteracionDe(c.id)).catch(() => {})} className="px-2 py-1 rounded-md border border-slate-300 hover:bg-slate-100">
                    Ver
                  </button>
                  <button
                    type="button"
                    onClick={() => descargarComprobantePdf(c, false, anulaciones[c.id], alteracionDe(c.id)).catch(() => {})}
                    className="flex items-center px-2 py-1 rounded-md border border-slate-300 hover:bg-slate-100"
                  >
                    <Download className="w-3 h-3 mr-1" />
                    PDF
                  </button>
                  <button type="button" onClick={() => verificar(c)} className="px-2 py-1 rounded-md border border-slate-300 hover:bg-slate-100">
                    Verificar
                  </button>
                  {!anulaciones[c.id] && puedeEmitir && (
                    <button
                      type="button"
                      onClick={() => {
                        setAnulando(anulando === c.id ? null : c.id);
                        setMotivoAnulacion('');
                      }}
                      className="px-2 py-1 rounded-md border border-red-300 text-red-700 hover:bg-red-50"
                    >
                      Anular
                    </button>
                  )}
                </span>
              </div>
              {anulaciones[c.id] && (
                <p className="text-red-700">
                  Anulado el {formatearFechaColombia(anulaciones[c.id].emitidoEn)} (registro N.º {anulaciones[c.id].version} de la cadena). Motivo: {anulaciones[c.id].motivo}
                </p>
              )}
              {anulando === c.id && !anulaciones[c.id] && (
                <div className="border border-red-200 bg-red-50 rounded-md p-2 space-y-1">
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
                    className="w-full px-2 py-1 border border-red-300 rounded-md"
                  />
                  {motivoAnulacion.trim().length < 10 && (
                    <p className="text-xs text-amber-800">Motivo: {motivoAnulacion.trim().length}/10 caracteres. Escribe al menos 10 para poder anular.</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={procesando || motivoAnulacion.trim().length < 10}
                      onClick={() => confirmarAnulacion(c)}
                      className="px-2 py-1 rounded-md bg-red-700 text-white font-semibold disabled:opacity-40"
                    >
                      Confirmar anulación
                    </button>
                    <button type="button" onClick={() => setAnulando(null)} className="px-2 py-1 rounded-md border border-slate-300">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {verificacion[c.id] && (
                <span
                  className={`flex items-start ${
                    verificacion[c.id].ok ? 'text-emerald-700' : verificacion[c.id].noVerificable ? 'text-slate-600' : 'text-red-600 font-semibold'
                  }`}
                >
                  {verificacion[c.id].ok ? <ShieldCheck className="w-3 h-3 mr-1 shrink-0" /> : <ShieldAlert className="w-3 h-3 mr-1 shrink-0" />}
                  {verificacion[c.id].mensaje}
                </span>
              )}
              {(sellos[c.id]?.avisos || []).map((a) => (
                <span key={a} className="flex items-start text-red-600 font-semibold">
                  <ShieldAlert className="w-3 h-3 mr-1 mt-0.5 shrink-0" aria-hidden="true" />
                  {a}
                </span>
              ))}
              {(sellos[c.id]?.notas || []).map((n) => (
                <span key={n} className="block text-slate-600">{n}</span>
              ))}
              {c.sellosLotes && sellos[c.id] && sellos[c.id].avisos.length === 0 && !sellos[c.id].notas.some((n) => n.startsWith('No se')) && (
                <span className="block text-slate-600">Sello de los lotes registrado al emitir: coincide con la cadena actual de cada lote.</span>
              )}
              {c.cliente.direccionHash !== undefined && (
                <span className="block text-slate-600">
                  Dirección del cliente (de la orden, no se publica): <strong>{o.clienteDireccion || 'sin registrar'}</strong>
                  {verificacion[c.id]?.ok && ' · coincide con la huella guardada en el comprobante'}
                </span>
              )}
              {(() => {
                const h = horaServidorBloque(c);
                return h.servidor ? (
                  <span className={`block ${h.desfase ? 'text-amber-800' : 'text-slate-500'}`}>
                    Hora del servidor al emitir: {formatearFechaColombia(h.servidor.toISOString())}
                    {h.desfase && ' · la hora declarada por el equipo difiere en más de 10 minutos'}
                  </span>
                ) : null;
              })()}
              <SelloTiempoBloque bloque={c} mantener={{ puedeCrear: puedeEmitir, verificado: Boolean(verificacion[c.id]?.ok) }} />
            </li>
            ))(b)
          )}
        </ul>
      )}

      {url && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {qr && <img src={qr} alt="QR de consulta de la entrega" className="w-20 h-20 border border-slate-200 rounded-md" />}
          <div className="space-y-1 min-w-0">
            <span className="block font-semibold text-slate-700">Consulta del cliente (sin cuenta)</span>
            <span className="block font-mono text-xs text-slate-500 break-all">{url}</span>
            <button type="button" onClick={copiar} className="flex items-center px-2 py-1 rounded-md border border-slate-300 hover:bg-slate-100">
              <Link2 className="w-3 h-3 mr-1" />
              {copiado ? 'Enlace copiado' : 'Copiar enlace'}
            </button>
            <span className="block text-xs text-slate-500">
              Muestra solo los comprobantes emitidos de esta orden; los datos de otros pedidos o lotes no se exponen.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
