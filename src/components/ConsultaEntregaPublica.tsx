import React, { useEffect, useState } from 'react';
import HoraServidor from './HoraServidor';
import { EsqueletoTarjetas } from './Esqueleto';
import { ArrowLeft, Download, FileText, ShieldAlert, ShieldCheck, Truck } from 'lucide-react';
import { BloqueAnulacion, ComprobanteEntrega, ConsultaEntrega } from '../types';
import {
  EMPRESA,
  esAnulacion,
  horaServidorBloque,
  leerConsultaEntrega,
  revisarConsultaEntrega,
  RevisionConsultaEntrega,
  separarBloques
} from '../services/comprobantesService';
import { AvisoIntegridad, IndicadorVerificado } from './AvisoIntegridad';
import { descargarComprobantePdf, verComprobantePdf } from '../services/pdfService';
import { formatearFechaColombia } from '../utils/constants';
import { SelloTiempoBloque } from './SelloTiempo';

const num = (n: number) => (Number(n) || 0).toLocaleString('es-CO');

/**
 * Consulta pública de una entrega con el código del QR del comprobante (sin cuenta). Muestra solo
 * los comprobantes definitivos emitidos para esa orden; desde cada lote se puede abrir su
 * trazabilidad pública (el QR del lote), que no muestra entregas. No muestra la dirección del
 * cliente ni las novedades de la entrega (son internas), aunque un comprobante anterior las guarde.
 * En los comprobantes nuevos compara el sello de cada lote registrado al emitir con el lote actual.
 */
export const ConsultaEntregaPublica: React.FC<{
  token: string;
  onAbrirLote: (codigo: string) => void;
  onVolver: () => void;
}> = ({ token, onAbrirLote, onVolver }) => {
  const [estado, setEstado] = useState<'cargando' | 'no_encontrada' | 'faltan' | 'error' | 'ok'>('cargando');
  const [consulta, setConsulta] = useState<ConsultaEntrega | null>(null);
  const [bloques, setBloques] = useState<(ComprobanteEntrega | BloqueAnulacion)[]>([]);
  const { comprobantes, anulaciones } = separarBloques(bloques);
  // Revisión automática de toda la cadena pública (bloques faltantes, enlaces, anulaciones, hashes)
  const [revision, setRevision] = useState<RevisionConsultaEntrega | null>(null);
  const [avisosFaltantes, setAvisosFaltantes] = useState<string[]>([]);
  const verificacion = revision?.verificacion || {};

  useEffect(() => {
    let activo = true;
    leerConsultaEntrega(token)
      .then(async (r) => {
        if (!activo) return;
        if (!r) return setEstado('no_encontrada');
        const rev = await revisarConsultaEntrega(r.consulta, r.bloques, r.faltantes);
        if (!activo) return;
        if (!r.bloques.length) {
          // El índice existe pero sus bloques no: no es un código equivocado, se borró el registro
          setAvisosFaltantes(rev.avisos);
          return setEstado('faltan');
        }
        setConsulta(r.consulta);
        setBloques(r.bloques);
        setRevision(rev);
        setEstado('ok');
      })
      .catch(() => activo && setEstado('error'));
    return () => {
      activo = false;
    };
  }, [token]);

  // Comprobante vigente: el más reciente que no esté anulado (ni con su anulación borrada). Si la
  // cadena tiene problemas ninguno se presenta como vigente; se muestran sus datos con el aviso.
  const anulado = (id: string) => Boolean(anulaciones[id] || revision?.anulados.has(id));
  const vigente = revision?.vigenteId ? comprobantes.find((c) => c.id === revision.vigenteId) : undefined;
  const actual = vigente || comprobantes.find((c) => !anulado(c.id)) || comprobantes[0];
  const hayAvisos = Boolean(revision && revision.avisos.length);
  const alteracionDe = (id: string) =>
    [verificacion[id] && !verificacion[id].ok && !verificacion[id].noVerificable ? verificacion[id].mensaje : '', hayAvisos ? 'La cadena de esta entrega tiene registros faltantes o alterados.' : '']
      .filter(Boolean)
      .join(' ');

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-800">
      <header className="bg-sky-800 text-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center space-x-2 min-w-0">
            <Truck className="w-5 h-5 shrink-0" />
            <div className="min-w-0">
              <span className="block font-semibold truncate">{EMPRESA.split(' — ').join(' · ')}</span>
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
        {estado === 'cargando' && <EsqueletoTarjetas cantidad={2} alto="h-28" />}
        {estado === 'no_encontrada' && (
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="font-semibold">No se encontró ninguna entrega con este código.</p>
            <p className="text-slate-500 text-xs mt-1">Revise que el enlace o el código QR estén completos.</p>
          </div>
        )}
        {estado === 'faltan' && (
          <AvisoIntegridad
            estado="alterado"
            titulo="Falta el comprobante registrado"
            avisos={avisosFaltantes}
            nota="El código existe y registra comprobantes emitidos, pero ya no están guardados. Comuníquese con Cultivos Loré."
          />
        )}
        {estado === 'error' && (
          <div className="bg-white rounded-lg border border-red-200 p-4 text-red-700">No se pudo consultar la entrega. Intente de nuevo.</div>
        )}

        {estado === 'ok' && actual && consulta && (
          <>
            {revision && revision.avisos.length > 0 && (
              <AvisoIntegridad
                estado="alterado"
                avisos={revision.avisos}
                nota="Ningún comprobante de esta entrega se puede presentar como vigente hasta aclarar la cadena."
              />
            )}
            {revision && !revision.avisos.length && revision.noVerificable && (
              <AvisoIntegridad estado="no_verificable" avisos={[]} nota="Abra el enlace por https para comprobar la integridad." />
            )}
            {revision && revision.notas.length > 0 && (
              <div className="bg-white rounded-lg border border-slate-200 p-3 text-xs text-slate-600 space-y-1">
                {revision.notas.map((n) => (
                  <p key={n}>{n}</p>
                ))}
              </div>
            )}
            <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="block text-xs text-slate-500">Pedido</span>
                  <span className="font-mono font-semibold">{actual.ordenId}</span>
                </div>
                <span
                  className={`px-2 py-1 rounded-md text-xs font-semibold ${
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
                <span>Repartidor: <strong>{actual.repartidor || 'Sin dato'}</strong></span>
                <span>Autorizado: <strong>{num(actual.cantidadAutorizada)} {actual.unidad}</strong></span>
                <span>Entregado: <strong>{num(actual.cantidadEntregada)} {actual.unidad}</strong></span>
                <span>Entrega confirmada: <strong>{actual.fechas.confirmacion ? formatearFechaColombia(actual.fechas.confirmacion) : 'Sin dato'}</strong></span>
                {actual.fechas.correccion && (
                  <span>Entrega corregida: <strong>{formatearFechaColombia(actual.fechas.correccion)}</strong></span>
                )}
                <span>
                  Comprobante vigente:{' '}
                  <strong>
                    {!revision
                      ? 'verificando…'
                      : hayAvisos
                        ? 'ninguno (la cadena tiene problemas)'
                        : vigente
                          ? `N.º ${vigente.version}`
                          : 'ninguno (todos anulados)'}
                  </strong>
                </span>
              </div>
            </section>

            <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-2">
              <span className="font-semibold block">Procedencia del producto</span>
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
              <span className="font-semibold block">Comprobantes emitidos ({comprobantes.length})</span>
              {revision && !revision.avisos.length && !revision.noVerificable && (
                <IndicadorVerificado texto={`Cadena verificada al abrir: ${bloques.length} registro(s) completos y enlazados.`} />
              )}
              {bloques.map((b) =>
                esAnulacion(b) ? (
                  <div key={b.id} className="border border-red-100 bg-red-50/40 rounded-md p-2 text-xs text-red-700 space-y-1">
                    <span className="block">
                      Registro N.º {b.version} · Anulación del comprobante N.º {b.versionAnulada} · {formatearFechaColombia(b.emitidoEn)}
                    </span>
                    {verificacion[b.id] &&
                      (verificacion[b.id].ok ? (
                        <span className="flex items-center text-emerald-700">
                          <ShieldCheck className="w-3 h-3 mr-1 shrink-0" aria-hidden="true" />
                          Anulación verificada
                        </span>
                      ) : (
                        <span className="flex items-start font-semibold">
                          <ShieldAlert className="w-3 h-3 mr-1 mt-0.5 shrink-0" aria-hidden="true" />
                          {verificacion[b.id].mensaje}
                        </span>
                      ))}
                  </div>
                ) : ((c: ComprobanteEntrega) => (
                <div key={c.id} className="border border-slate-100 rounded-md p-2 space-y-1 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong>Comprobante N.º {c.version}</strong>
                      {anulado(c.id) && <strong className="ml-1 px-1 rounded-md bg-red-100 text-red-700">ANULADO</strong>} · {formatearFechaColombia(c.emitidoEn)}
                      <HoraServidor hora={horaServidorBloque(c)} modo="sufijo" etiqueta="Registrado en el servidor" /> ·{' '}
                      {c.estadoEntrega === 'entregado' ? 'entrega completa' : 'entrega parcial'} · entregado {num(c.cantidadEntregada)} {c.unidad}
                    </span>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => verComprobantePdf(c, false, anulaciones[c.id], alteracionDe(c.id)).catch(() => {})} className="flex items-center px-2 py-1 rounded-md border border-slate-300 hover:bg-slate-100">
                        <FileText className="w-3 h-3 mr-1" />
                        Ver
                      </button>
                      <button type="button" onClick={() => descargarComprobantePdf(c, false, anulaciones[c.id], alteracionDe(c.id)).catch(() => {})} className="flex items-center px-2 py-1 rounded-md border border-slate-300 hover:bg-slate-100">
                        <Download className="w-3 h-3 mr-1" />
                        PDF
                      </button>
                    </span>
                  </div>
                  {!anulaciones[c.id] && revision?.anulados.has(c.id) && (
                    <span className="block text-red-700 font-semibold">
                      Este comprobante fue anulado, pero el registro de la anulación ya no está: no tiene validez.
                    </span>
                  )}
                  {anulaciones[c.id] && (
                    <span className="block text-red-700">
                      Anulado el {formatearFechaColombia(anulaciones[c.id].emitidoEn)} (registro N.º {anulaciones[c.id].version} de la cadena). Motivo:{' '}
                      {anulaciones[c.id].motivo}
                    </span>
                  )}
                  <HoraServidor
                    hora={horaServidorBloque(c)}
                    modo="aviso"
                    etiqueta="Registrado en el servidor"
                    textoDesfase="la hora indicada en el comprobante difiere en más de 10 minutos"
                  />
                  {c.sellosLotes && revision && !hayAvisos && !revision.notas.some((n) => n.startsWith('No se')) && (
                    <span className="block text-slate-500">Incluye el sello de cada lote al emitirse; coincide con la trazabilidad actual del lote.</span>
                  )}
                  {verificacion[c.id] ? (
                    <span className={`flex items-start ${verificacion[c.id].ok ? 'text-emerald-700' : 'text-red-600'}`}>
                      {verificacion[c.id].ok ? <ShieldCheck className="w-3 h-3 mr-1 shrink-0" /> : <ShieldAlert className="w-3 h-3 mr-1 shrink-0" />}
                      {verificacion[c.id].mensaje}
                    </span>
                  ) : (
                    <span className="text-slate-500">Verificando…</span>
                  )}
                  <SelloTiempoBloque bloque={c} />
                </div>
                ))(b)
              )}
              <p className="text-xs text-slate-500">
                Registro tipo blockchain: cada comprobante es un bloque sellado con SHA-256 que contiene el hash del bloque anterior; se guarda una
                sola vez y aquí se recalcula para verificarlo. Cadena de bloques privada de la plataforma.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
};
