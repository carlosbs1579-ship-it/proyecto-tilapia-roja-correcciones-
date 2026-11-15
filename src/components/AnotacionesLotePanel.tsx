import React, { useEffect, useMemo, useState } from 'react';
import { FilePen, ShieldCheck, ShieldAlert, Check, X } from 'lucide-react';
import { AnotacionesLote, Lote } from '../types';
import { anotacionesDe, proponerAnotacion, resolverAnotacion, verificarAnotaciones, VerificacionAnotaciones } from '../services/anotacionesService';
import { nombreDato } from '../services/hashService';
import { quienRegistro } from '../services/usuariosService';
import { formatearFechaColombia } from '../utils/constants';

/**
 * Anotaciones posteriores al cierre de un lote sellado: proponer (con motivo), aprobar o rechazar
 * (otra persona), e historial con la verificación de su cadena. El lote no se modifica.
 */
export const AnotacionesLotePanel: React.FC<{
  lote: Lote;
  datosAnotaciones: AnotacionesLote | null;
  uidActual?: string;
  puedeProponer: boolean;
  puedeAprobar: boolean;
}> = ({ lote, datosAnotaciones, uidActual, puedeProponer, puedeAprobar }) => {
  const anotaciones = useMemo(() => anotacionesDe(datosAnotaciones), [datosAnotaciones]);
  const [verificacion, setVerificacion] = useState<VerificacionAnotaciones | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [fase, setFase] = useState<number>(-1);
  const [dato, setDato] = useState('');
  const [valorCorrecto, setValorCorrecto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [respuestas, setRespuestas] = useState<Record<number, string>>({});
  const [procesando, setProcesando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    let activo = true;
    verificarAnotaciones(lote, datosAnotaciones).then((v) => activo && setVerificacion(v));
    return () => {
      activo = false;
    };
  }, [lote, datosAnotaciones]);

  const eventos = lote.eventos || [];
  const faseSel = fase >= 0 ? eventos[fase] : null;
  const datosFase = faseSel ? Object.keys(faseSel.datos || {}).filter((k) => k !== 'ambito') : [];
  const valorRegistrado = faseSel && dato && dato !== '_aclaracion' ? String(faseSel.datos?.[dato] ?? '') : '';

  // Qué falta para poder enviar la propuesta (se le dice al usuario en vez de solo desactivar el botón)
  const largoMotivo = motivo.trim().length;
  const faltante =
    fase < 0
      ? 'selecciona la fase'
      : !dato
      ? 'selecciona el dato (o "Aclaración general")'
      : dato !== '_aclaracion' && !valorCorrecto.trim()
      ? 'escribe el valor correcto (el texto gris es solo el valor registrado)'
      : dato !== '_aclaracion' && valorCorrecto.trim() === valorRegistrado
      ? 'el valor correcto es igual al registrado'
      : largoMotivo < 10
      ? `el motivo necesita al menos 10 caracteres (llevas ${largoMotivo})`
      : '';

  const ejecutar = async (accion: () => Promise<void>, exito: string) => {
    setProcesando(true);
    setMensaje(null);
    try {
      await accion();
      setMensaje({ ok: true, texto: exito });
    } catch (err: any) {
      setMensaje({ ok: false, texto: err?.message || 'No se pudo completar la acción.' });
    } finally {
      setProcesando(false);
    }
  };

  const proponer = () =>
    ejecutar(async () => {
      await proponerAnotacion(lote, {
        fase,
        dato: dato === '_aclaracion' ? '' : dato,
        valorRegistrado,
        valorCorrecto: dato === '_aclaracion' ? '' : valorCorrecto,
        motivo
      });
      setAbierto(false);
      setFase(-1);
      setDato('');
      setValorCorrecto('');
      setMotivo('');
    }, 'Anotación propuesta. Queda pendiente hasta que otra persona la apruebe.');

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <FilePen className="w-4 h-4 text-sky-600" />
          <h3 className="font-bold text-slate-900 text-sm">Anotaciones posteriores al cierre</h3>
          <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-sm font-semibold">{anotaciones.length}</span>
        </div>
        {puedeProponer && !abierto && (
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold"
          >
            Proponer anotación
          </button>
        )}
      </div>
      <p className="text-slate-500">
        El lote está sellado y no se modifica. Una anotación deja constancia de un error o una aclaración, con su motivo; otra persona debe
        aprobarla para que aparezca en el certificado. No cambia los cálculos del lote.
      </p>
      {verificacion && datosAnotaciones && (
        <p className={`flex items-center ${verificacion.integra ? 'text-emerald-700' : 'text-red-600 font-semibold'}`}>
          {verificacion.integra ? <ShieldCheck className="w-3.5 h-3.5 mr-1" /> : <ShieldAlert className="w-3.5 h-3.5 mr-1" />}
          {verificacion.mensaje}
        </p>
      )}
      {mensaje && <p className={mensaje.ok ? 'text-emerald-700' : 'text-red-600'}>{mensaje.texto}</p>}

      {abierto && (
        <div className="border border-sky-200 bg-sky-50/50 rounded-lg p-3 space-y-2">
          <label className="block">
            <span className="font-semibold text-slate-700">Fase a la que se refiere</span>
            <select
              value={fase}
              onChange={(e) => {
                setFase(Number(e.target.value));
                setDato('');
              }}
              className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
            >
              <option value={-1}>Selecciona la fase</option>
              {eventos.map((ev) => (
                <option key={ev.indice} value={ev.indice}>
                  #{ev.indice} · {ev.tipo} · {ev.fechaEvento}
                </option>
              ))}
            </select>
          </label>
          {faseSel && (
            <label className="block">
              <span className="font-semibold text-slate-700">Dato</span>
              <select aria-label="Dato" value={dato} onChange={(e) => setDato(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded bg-white">
                <option value="">Selecciona el dato</option>
                {datosFase.map((k) => (
                  <option key={k} value={k}>
                    {nombreDato(k)} (registrado: {String(faseSel.datos?.[k])})
                  </option>
                ))}
                <option value="_aclaracion">Aclaración general de la fase (sin valor)</option>
              </select>
            </label>
          )}
          {dato && dato !== '_aclaracion' && (
            <label className="block">
              <span className="font-semibold text-slate-700">Valor correcto</span>
              <input
                type="text"
                maxLength={120}
                value={valorCorrecto}
                onChange={(e) => setValorCorrecto(e.target.value)}
                placeholder={`Registrado: ${valorRegistrado}`}
                className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded"
              />
            </label>
          )}
          <label className="block">
            <span className="font-semibold text-slate-700">Motivo (obligatorio)</span>
            <textarea
              rows={2}
              maxLength={1000}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se hace esta anotación (mínimo 10 caracteres)"
              className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded"
            />
          </label>
          {faltante && <p className="text-amber-700">Para enviar: {faltante}.</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={procesando || Boolean(faltante)}
              onClick={proponer}
              className="px-3 py-1.5 rounded-lg bg-sky-600 text-white font-semibold disabled:opacity-40"
            >
              Enviar propuesta
            </button>
            <button type="button" onClick={() => setAbierto(false)} className="px-3 py-1.5 rounded-lg border border-slate-300">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {anotaciones.length > 0 && (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
          {anotaciones.map((a) => {
            const d = a.propuesta.datos;
            const ev = eventos[d.fase];
            const propia = a.propuesta.registradoPorUid === uidActual;
            const alterada = Boolean(verificacion?.alteradas.includes(a.numero));
            // Valor registrado tomado de la fase sellada (no del texto guardado en la propuesta)
            const registradoReal = d.dato && ev ? String(ev.datos?.[d.dato] ?? d.valorRegistrado) : d.valorRegistrado;
            return (
              <li key={a.propuesta.id} className={`p-3 space-y-1 ${alterada ? 'bg-red-50 ring-1 ring-inset ring-red-300' : ''}`}>
                {alterada && <p className="font-semibold text-red-700">Anotación alterada después de registrarse: sin validez.</p>}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800">
                    Anotación N.º {a.numero} · Fase #{d.fase}
                    {ev ? ` (${ev.tipo})` : ''}
                  </span>
                  <span
                    className={`rotulo border-b ${
                      a.estado === 'aprobada'
                        ? 'text-emerald-700 border-emerald-600'
                        : a.estado === 'rechazada'
                        ? 'text-slate-600 border-slate-400'
                        : 'text-amber-700 border-amber-600'
                    }`}
                  >
                    {a.estado === 'aprobada' ? 'Aprobada' : a.estado === 'rechazada' ? 'Rechazada' : 'Pendiente de aprobación'}
                  </span>
                </div>
                {d.dato ? (
                  <p className="text-slate-700">
                    {nombreDato(d.dato)}: registrado <strong>{registradoReal}</strong> · correcto <strong>{d.valorCorrecto}</strong>
                  </p>
                ) : (
                  <p className="text-slate-700">Aclaración general de la fase</p>
                )}
                <p className="text-slate-600">Motivo: {d.motivo}</p>
                <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1 pt-1 text-slate-700">
                  <span>
                    <span className="rotulo text-slate-500 mr-2">Propuso</span>
                    <span className="firma">{quienRegistro(a.propuesta)}</span>
                    <span className="text-[11px] text-slate-500 ml-2 tabular-nums">{formatearFechaColombia(a.propuesta.fecha)}</span>
                  </span>
                  {a.resolucion && (
                    <span>
                      <span className="rotulo text-slate-500 mr-2">{a.estado === 'aprobada' ? 'Aprobó' : 'Rechazó'}</span>
                      <span className="firma">{quienRegistro(a.resolucion)}</span>
                      <span className="text-[11px] text-slate-500 ml-2 tabular-nums">{formatearFechaColombia(a.resolucion.fecha)}</span>
                    </span>
                  )}
                </p>
                {a.resolucion?.datos?.respuesta ? <p className="text-slate-600 italic">"{a.resolucion.datos.respuesta}"</p> : null}
                {a.estado === 'pendiente' && puedeAprobar && !propia && !alterada && verificacion?.integra !== false && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <input
                      type="text"
                      maxLength={300}
                      placeholder="Comentario (obligatorio para rechazar)"
                      value={respuestas[a.propuesta.indice] || ''}
                      onChange={(e) => setRespuestas((prev) => ({ ...prev, [a.propuesta.indice]: e.target.value }))}
                      className="flex-1 min-w-[10rem] px-2 py-1 border border-slate-300 rounded"
                    />
                    <button
                      type="button"
                      disabled={procesando}
                      onClick={() =>
                        ejecutar(
                          () => resolverAnotacion(lote, a.propuesta.indice, true, respuestas[a.propuesta.indice] || ''),
                          `Anotación N.º ${a.numero} aprobada.`
                        )
                      }
                      className="flex items-center px-2 py-1 rounded bg-slate-900 text-white font-semibold disabled:opacity-40"
                    >
                      <Check className="w-3.5 h-3.5 mr-0.5" /> Aprobar
                    </button>
                    <button
                      type="button"
                      disabled={procesando}
                      onClick={() =>
                        ejecutar(
                          () => resolverAnotacion(lote, a.propuesta.indice, false, respuestas[a.propuesta.indice] || ''),
                          `Anotación N.º ${a.numero} rechazada.`
                        )
                      }
                      className="flex items-center px-2 py-1 rounded border border-slate-300 font-semibold disabled:opacity-40"
                    >
                      <X className="w-3.5 h-3.5 mr-0.5" /> Rechazar
                    </button>
                  </div>
                )}
                {a.estado === 'pendiente' && propia && (
                  <p className="text-[11px] text-amber-700">La propusiste tú: debe aprobarla otra persona.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
