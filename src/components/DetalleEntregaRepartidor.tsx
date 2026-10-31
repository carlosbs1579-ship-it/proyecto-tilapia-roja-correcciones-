import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  MapPin,
  Phone,
  Navigation,
  Flag,
  PackageCheck,
  AlertTriangle,
  Repeat,
  History,
  CheckCircle,
  Clock,
  XCircle,
  Smartphone
} from 'lucide-react';
import { CategoriaNovedad, EstadoAjuste, OrdenEntrega } from '../types';
import {
  ESTADOS_CON_RESERVA,
  cantidadPendiente,
  redondear,
  saldoLote
} from '../services/pedidosService';
import {
  AccionReparto,
  ETIQUETA_ESTADO_ACCION,
  TipoAccionReparto,
  datosSolicitudAjuste,
  descartarAccion,
  registrarAccion
} from '../services/repartoService';
import { formatearFechaColombia } from '../utils/constants';

interface DetalleEntregaRepartidorProps {
  uid: string;
  orden: OrdenEntrega;
  acciones: AccionReparto[]; // acciones de esta orden en la bandeja del teléfono
  etiquetaEstado: string;
  onVolver: () => void;
}

const CATEGORIAS_NOVEDAD: CategoriaNovedad[] = [
  'Cliente no disponible',
  'Problemas de acceso',
  'Retraso en el recorrido',
  'Diferencia en cantidades',
  'Problemas con el transporte',
  'Otra situación'
];

const ETIQUETA_AJUSTE: Record<EstadoAjuste, string> = {
  pendiente_aprobacion: 'Pendiente de aprobación del operador',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
  aplicada: 'Aprobada y aplicada'
};

const num = (n: number) => (Number(n) || 0).toLocaleString('es-CO');

const ESTILO_ACCION: Record<string, string> = {
  guardada: 'bg-amber-50 text-amber-800 border-amber-200',
  enviando: 'bg-sky-50 text-sky-800 border-sky-200',
  recibida: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  confirmada: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  conflicto: 'bg-red-50 text-red-800 border-red-200'
};

/**
 * Detalle de una entrega para el repartidor: datos del cliente, cantidades, distribución autorizada
 * (solo consulta) y los pasos de la entrega con botones grandes.
 */
export const DetalleEntregaRepartidor: React.FC<DetalleEntregaRepartidorProps> = ({
  uid,
  orden,
  acciones,
  etiquetaEstado,
  onVolver
}) => {
  const [panel, setPanel] = useState<'entrega' | 'novedad' | 'ajuste' | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Formulario de entrega
  const [entregas, setEntregas] = useState<Record<string, number | ''>>({});
  const [obsEntrega, setObsEntrega] = useState('');
  // Novedad
  const [categoria, setCategoria] = useState<CategoriaNovedad>('Cliente no disponible');
  const [descripcionNovedad, setDescripcionNovedad] = useState('');
  // Solicitud de ajuste
  const [propuesta, setPropuesta] = useState<Record<string, number | ''>>({});
  const [loteExtra, setLoteExtra] = useState('');
  const [cantidadExtra, setCantidadExtra] = useState<number | ''>('');
  const [motivoAjuste, setMotivoAjuste] = useState('');

  const lotes = Object.entries(orden.procedencias || {});
  const pendientes = acciones.filter((a) => a.estado === 'guardada' || a.estado === 'enviando');
  const pendiente = (tipo: TipoAccionReparto) => pendientes.some((a) => a.tipo === tipo);

  // Paso actual, teniendo en cuenta las acciones guardadas en el teléfono que aún no se envían
  const rutaIniciada = orden.estado === 'en_ruta' || pendiente('Inicio de ruta');
  const llegadaRegistrada = Boolean(orden.llegadaEn) || pendiente('Llegada');
  const entregaEnviada = pendiente('Entrega');
  const puedeIniciar = ['asignado', 'en_preparacion'].includes(orden.estado) && !pendiente('Inicio de ruta');
  const puedeLlegar = rutaIniciada && !llegadaRegistrada;
  const puedeEntregar = rutaIniciada && llegadaRegistrada && !entregaEnviada && orden.estado !== 'entregado';
  const puedeNovedad = ['asignado', 'en_preparacion', 'en_ruta', 'entrega_parcial', 'requiere_revision'].includes(orden.estado);
  const puedeAjuste = ESTADOS_CON_RESERVA.includes(orden.estado) && orden.cantidadEntregada === 0;

  const totalEntrega = redondear(
    Object.values(entregas).reduce<number>((s, v) => s + (Number(v) || 0), 0),
    orden.unidad
  );
  const faltante = Math.max(0, redondear(cantidadPendiente(orden) - totalEntrega, orden.unidad));

  const ajustes = useMemo(
    () => Object.values(orden.ajustes || {}).sort((a, b) => b.solicitadoEn.localeCompare(a.solicitadoEn)),
    [orden.ajustes]
  );

  const avisar = (texto: string) => {
    setErrorMsg(null);
    // Sin conexión la acción solo queda guardada en el teléfono: el aviso lo dice
    setMensaje(navigator.onLine ? texto : `${texto} Quedó guardado en el teléfono y se enviará al recuperar la señal.`);
    setPanel(null);
  };

  const abrirEntrega = () => {
    setEntregas(Object.fromEntries(lotes.map(([codigo]) => [codigo, saldoLote(orden, codigo)])));
    setObsEntrega('');
    setErrorMsg(null);
    setPanel('entrega');
  };

  const confirmarEntrega = () => {
    for (const [codigo, valor] of Object.entries(entregas)) {
      if (Number(valor) > saldoLote(orden, codigo)) {
        setErrorMsg(`Del lote ${codigo} solo puedes entregar hasta ${num(saldoLote(orden, codigo))} ${orden.unidad}.`);
        return;
      }
      if (Number(valor) < 0) {
        setErrorMsg('Las cantidades no pueden ser negativas.');
        return;
      }
    }
    if (totalEntrega <= 0) {
      setErrorMsg('Indica cuánto entregaste.');
      return;
    }
    registrarAccion(uid, {
      ordenId: orden.id,
      tipo: 'Entrega',
      descripcion: obsEntrega,
      datos: { entregas: Object.fromEntries(Object.entries(entregas).map(([c, v]) => [c, Number(v) || 0])) }
    });
    avisar(
      faltante > 0
        ? `Entrega parcial registrada: faltan ${num(faltante)} ${orden.unidad}. El operador decidirá cómo continuar.`
        : 'Entrega completa registrada.'
    );
  };

  const registrarNovedad = () => {
    if (!descripcionNovedad.trim()) {
      setErrorMsg('Describe la novedad.');
      return;
    }
    registrarAccion(uid, {
      ordenId: orden.id,
      tipo: 'Novedad',
      descripcion: `${categoria}: ${descripcionNovedad.trim()}`,
      datos: { categoria }
    });
    setDescripcionNovedad('');
    avisar('Novedad registrada.');
  };

  const abrirAjuste = () => {
    setPropuesta(Object.fromEntries(lotes.map(([codigo, p]) => [codigo, p.cantidad])));
    setLoteExtra('');
    setCantidadExtra('');
    setMotivoAjuste('');
    setErrorMsg(null);
    setPanel('ajuste');
  };

  const enviarAjuste = () => {
    const nueva: Record<string, number> = {};
    for (const [codigo, valor] of Object.entries(propuesta)) {
      const n = redondear(Number(valor) || 0, orden.unidad);
      if (n > 0) nueva[codigo] = n;
    }
    const extra = loteExtra.trim().toUpperCase();
    if (extra) {
      if (!/^[A-Z0-9_-]+$/.test(extra)) {
        setErrorMsg('El código del lote adicional no es válido.');
        return;
      }
      const n = redondear(Number(cantidadExtra) || 0, orden.unidad);
      if (n <= 0) {
        setErrorMsg('Indica la cantidad del lote adicional.');
        return;
      }
      nueva[extra] = n;
    }
    const total = redondear(Object.values(nueva).reduce((s, n) => s + n, 0), orden.unidad);
    if (Object.keys(nueva).length === 0) {
      setErrorMsg('La propuesta debe tener al menos un lote con cantidad.');
      return;
    }
    if (Object.keys(nueva).length > 3) {
      setErrorMsg('La propuesta puede tener hasta 3 lotes.');
      return;
    }
    if (total > orden.cantidadSolicitada) {
      setErrorMsg(`La propuesta (${num(total)} ${orden.unidad}) supera lo solicitado por el cliente (${num(orden.cantidadSolicitada)}).`);
      return;
    }
    const sinCambios = lotes.length === Object.keys(nueva).length && lotes.every(([c, p]) => nueva[c] === p.cantidad);
    if (sinCambios) {
      setErrorMsg('La propuesta es igual a la distribución actual.');
      return;
    }
    if (!motivoAjuste.trim()) {
      setErrorMsg('Explica el motivo de la solicitud.');
      return;
    }
    registrarAccion(uid, {
      ordenId: orden.id,
      tipo: 'Solicitud de ajuste',
      descripcion: motivoAjuste,
      datos: datosSolicitudAjuste(orden, nueva)
    });
    avisar('Solicitud enviada al operador. Mientras responde, entrega solo lo autorizado.');
  };

  const cancelarSolicitud = (ajusteId: string) => {
    registrarAccion(uid, { ordenId: orden.id, tipo: 'Cancelación de solicitud', datos: { ajusteId } });
    avisar('Cancelación de la solicitud registrada.');
  };

  const botonPaso = (
    numero: number,
    texto: string,
    icono: React.ReactNode,
    hecho: boolean,
    habilitado: boolean,
    onClick: () => void,
    detalle?: string
  ) => (
    <button
      type="button"
      disabled={!habilitado}
      onClick={onClick}
      className={`w-full flex items-center space-x-3 p-4 rounded-xl border-2 text-left transition-colors ${
        hecho
          ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
          : habilitado
          ? 'bg-sky-600 border-sky-600 text-white hover:bg-sky-500'
          : 'bg-slate-50 border-slate-200 text-slate-400'
      }`}
    >
      <span
        className={`w-9 h-9 rounded-full flex items-center justify-center font-bold shrink-0 ${
          hecho ? 'bg-emerald-600 text-white' : habilitado ? 'bg-white text-sky-700' : 'bg-slate-200 text-slate-500'
        }`}
      >
        {hecho ? <CheckCircle className="w-5 h-5" /> : numero}
      </span>
      <span className="flex-1">
        <span className="flex items-center space-x-2 text-base font-bold">
          {icono}
          <span>{texto}</span>
        </span>
        {detalle && <span className="block text-xs font-normal mt-0.5 opacity-90">{detalle}</span>}
      </span>
    </button>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={onVolver} className="inline-flex items-center space-x-1.5 text-sm text-sky-700 font-semibold">
        <ArrowLeft className="w-4 h-4" />
        <span>Volver a mis entregas</span>
      </button>

      {mensaje && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-sm flex items-start space-x-2">
          <CheckCircle className="w-5 h-5 shrink-0 text-emerald-600" />
          <span>{mensaje}</span>
        </div>
      )}

      {/* Cliente */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-slate-900">{orden.clienteNombre}</h1>
          <span className="px-3 py-1 rounded-full bg-sky-100 text-sky-800 border border-sky-300 text-xs font-bold">{etiquetaEstado}</span>
        </div>
        <p className="text-xs text-slate-500 font-mono">{orden.id}</p>
        <p className="flex items-start space-x-2 text-sm text-slate-800">
          <MapPin className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
          <span>{orden.clienteDireccion || 'Sin dirección registrada (consulta con el operador)'}</span>
        </p>
        {orden.clienteContacto && (
          <p className="flex items-center space-x-2 text-sm text-slate-800">
            <Phone className="w-4 h-4 text-slate-400 shrink-0" />
            <span>{orden.clienteContacto}</span>
          </p>
        )}
        <p className="text-sm text-slate-700">
          <strong>Fecha programada:</strong> {orden.fechaProgramada || 'sin fecha'}
        </p>
        {orden.observaciones && (
          <p className="text-sm text-slate-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
            <strong>Indicaciones de entrega:</strong> {orden.observaciones}
          </p>
        )}
      </div>

      {/* Cantidades */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-3">
        <h2 className="text-sm font-bold text-slate-900">Qué debes entregar</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {[
            ['Solicitado', orden.cantidadSolicitada],
            ['Autorizado', orden.cantidadAutorizada],
            ['Entregado', orden.cantidadEntregada],
            ['Por entregar', cantidadPendiente(orden)]
          ].map(([t, v]) => (
            <div key={t as string} className="bg-slate-50 border border-slate-200 rounded-lg p-2">
              <span className="block text-[11px] text-slate-500">{t}</span>
              <strong className="text-base text-slate-900">{num(v as number)}</strong>
              <span className="block text-[11px] text-slate-500">{orden.unidad}</span>
            </div>
          ))}
        </div>
        <div>
          <span className="block text-xs font-bold text-slate-700 mb-1">Distribución autorizada (no se puede modificar aquí)</span>
          <div className="space-y-1.5">
            {lotes.map(([codigo, p]) => (
              <div key={codigo} className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <span>
                  <strong className="font-mono">{codigo}</strong>
                  <span className="text-slate-500"> · piscina {p.estanque}</span>
                </span>
                <span className="text-slate-800">
                  {num(p.cantidad)} {p.unidad}
                  {(orden.entregadoPorLote?.[codigo] || 0) > 0 && (
                    <span className="text-xs text-slate-500"> · entregado {num(orden.entregadoPorLote![codigo])}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pasos de la entrega */}
      {!['entregado', 'cancelado'].includes(orden.estado) && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Pasos de la entrega</h2>
          {orden.estado === 'entrega_parcial' ? (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Entregaste una parte. Faltan <strong>{num(cantidadPendiente(orden))} {orden.unidad}</strong>: el operador decidirá si
              programa otra entrega o cierra el pedido.
            </p>
          ) : orden.estado === 'requiere_revision' ? (
            <p className="text-sm text-orange-900 bg-orange-50 border border-orange-200 rounded-lg p-3">
              El operador está revisando este pedido. Espera sus indicaciones antes de continuar.
            </p>
          ) : (
            <>
              {botonPaso(
                1,
                'Iniciar ruta',
                <Navigation className="w-5 h-5" />,
                rutaIniciada,
                puedeIniciar,
                () => {
                  registrarAccion(uid, { ordenId: orden.id, tipo: 'Inicio de ruta' });
                  avisar('Ruta iniciada.');
                },
                orden.rutaIniciadaEn ? `Iniciada: ${formatearFechaColombia(orden.rutaIniciadaEn)}` : pendiente('Inicio de ruta') ? 'Guardada en el teléfono' : 'Cuando salgas con el pedido'
              )}
              {botonPaso(
                2,
                'Registrar llegada',
                <Flag className="w-5 h-5" />,
                llegadaRegistrada,
                puedeLlegar,
                () => {
                  registrarAccion(uid, { ordenId: orden.id, tipo: 'Llegada' });
                  avisar('Llegada registrada.');
                },
                orden.llegadaEn ? `Llegada: ${formatearFechaColombia(orden.llegadaEn)}` : pendiente('Llegada') ? 'Guardada en el teléfono' : 'Cuando llegues al cliente'
              )}
              {botonPaso(
                3,
                'Confirmar entrega',
                <PackageCheck className="w-5 h-5" />,
                entregaEnviada,
                puedeEntregar,
                abrirEntrega,
                entregaEnviada ? 'Guardada en el teléfono' : 'Indica cuánto recibió el cliente'
              )}
            </>
          )}

          {panel === 'entrega' && (
            <div className="border-2 border-sky-200 rounded-xl p-4 space-y-3 bg-sky-50/40">
              <p className="text-sm font-bold text-slate-900">¿Cuánto entregaste de cada lote?</p>
              {lotes.map(([codigo, p]) => (
                <label key={codigo} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <strong className="font-mono">{codigo}</strong>
                    <span className="text-slate-500"> · piscina {p.estanque} · máximo {num(saldoLote(orden, codigo))} {orden.unidad}</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={saldoLote(orden, codigo)}
                    step={orden.unidad === 'peces' ? 1 : 0.01}
                    value={entregas[codigo] ?? ''}
                    onChange={(e) => setEntregas((prev) => ({ ...prev, [codigo]: e.target.value === '' ? '' : Number(e.target.value) }))}
                    className="w-32 px-3 py-2 text-base border border-slate-300 rounded-lg text-right"
                  />
                </label>
              ))}
              <p className={`text-sm ${faltante > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
                Total: <strong>{num(totalEntrega)} {orden.unidad}</strong>
                {faltante > 0 ? ` · faltan ${num(faltante)} (quedará como entrega parcial)` : ' · entrega completa'}
              </p>
              <textarea
                rows={2}
                maxLength={1000}
                placeholder="Observaciones (opcional): quién recibió, estado del producto..."
                value={obsEntrega}
                onChange={(e) => setObsEntrega(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              {errorMsg && <p className="text-sm text-red-700">{errorMsg}</p>}
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={confirmarEntrega} className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold">
                  Confirmar entrega
                </button>
                <button onClick={() => setPanel(null)} className="px-4 py-3 bg-slate-100 text-slate-700 rounded-xl font-semibold">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Novedades y solicitud de ajuste */}
      {(puedeNovedad || puedeAjuste) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {puedeNovedad && (
            <button
              onClick={() => {
                setErrorMsg(null);
                setPanel(panel === 'novedad' ? null : 'novedad');
              }}
              className="flex items-center justify-center space-x-2 p-4 rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-900 font-bold"
            >
              <AlertTriangle className="w-5 h-5" />
              <span>Registrar novedad</span>
            </button>
          )}
          {puedeAjuste && (
            <button
              onClick={() => (panel === 'ajuste' ? setPanel(null) : abrirAjuste())}
              className="flex items-center justify-center space-x-2 p-4 rounded-xl border-2 border-indigo-300 bg-indigo-50 text-indigo-900 font-bold"
            >
              <Repeat className="w-5 h-5" />
              <span>Solicitar ajuste de cantidades</span>
            </button>
          )}
        </div>
      )}

      {panel === 'novedad' && (
        <div className="bg-white rounded-xl border-2 border-amber-200 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-900">Novedades</p>
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value as CategoriaNovedad)}
            className="w-full px-3 py-2 text-base border border-slate-300 rounded-lg bg-white"
          >
            {CATEGORIAS_NOVEDAD.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <textarea
            rows={3}
            maxLength={900}
            placeholder="¿Qué pasó?"
            value={descripcionNovedad}
            onChange={(e) => setDescripcionNovedad(e.target.value)}
            className="w-full px-3 py-2 text-base border border-slate-300 rounded-lg"
          />
          <p className="text-[11px] text-slate-500">Por ahora las novedades se registran solo con texto (sin fotos).</p>
          {errorMsg && <p className="text-sm text-red-700">{errorMsg}</p>}
          <button onClick={registrarNovedad} className="w-full px-4 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold">
            Guardar novedad
          </button>
        </div>
      )}

      {panel === 'ajuste' && (
        <div className="bg-white rounded-xl border-2 border-indigo-200 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-900">Solicitud de ajuste</p>
          <p className="text-xs text-slate-600">
            Propón las nuevas cantidades. El operador debe aprobarlas: mientras tanto sigue vigente la distribución autorizada.
          </p>
          {lotes.map(([codigo, p]) => (
            <label key={codigo} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <strong className="font-mono">{codigo}</strong>
                <span className="text-slate-500"> · autorizado {num(p.cantidad)} {orden.unidad}</span>
              </span>
              <input
                type="number"
                min={0}
                step={orden.unidad === 'peces' ? 1 : 0.01}
                value={propuesta[codigo] ?? ''}
                onChange={(e) => setPropuesta((prev) => ({ ...prev, [codigo]: e.target.value === '' ? '' : Number(e.target.value) }))}
                className="w-32 px-3 py-2 text-base border border-slate-300 rounded-lg text-right"
              />
            </label>
          ))}
          {lotes.length < 3 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="text"
                placeholder="Otro lote (código)"
                value={loteExtra}
                onChange={(e) => setLoteExtra(e.target.value)}
                className="flex-1 min-w-[140px] px-3 py-2 border border-slate-300 rounded-lg font-mono"
              />
              <input
                type="number"
                min={0}
                placeholder="Cantidad"
                value={cantidadExtra}
                onChange={(e) => setCantidadExtra(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-32 px-3 py-2 border border-slate-300 rounded-lg text-right"
              />
            </div>
          )}
          <textarea
            rows={2}
            maxLength={1000}
            placeholder="Motivo de la solicitud"
            value={motivoAjuste}
            onChange={(e) => setMotivoAjuste(e.target.value)}
            className="w-full px-3 py-2 text-base border border-slate-300 rounded-lg"
          />
          {errorMsg && <p className="text-sm text-red-700">{errorMsg}</p>}
          <button onClick={enviarAjuste} className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold">
            Enviar solicitud al operador
          </button>
        </div>
      )}

      {/* Solicitudes de ajuste */}
      {ajustes.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-2">
          <h2 className="text-sm font-bold text-slate-900">Mis solicitudes de ajuste</h2>
          {ajustes.map((a) => (
            <div key={a.id} className="border border-slate-200 rounded-lg p-3 text-sm space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">{ETIQUETA_AJUSTE[a.estado]}</span>
                <span className="text-xs text-slate-500">{formatearFechaColombia(a.solicitadoEn)}</span>
              </div>
              <p className="text-slate-700">
                Propuesta:{' '}
                {Object.entries(a.propuesta).map(([c, n]) => `${c}: ${num(n)}`).join(' · ')} {orden.unidad}
              </p>
              <p className="text-slate-600">Motivo: {a.motivo}</p>
              {a.respuesta && <p className="text-slate-600">Respuesta del operador: {a.respuesta}</p>}
              {a.estado === 'pendiente_aprobacion' && a.solicitadoPorUid === uid && !pendiente('Cancelación de solicitud') && (
                <button onClick={() => cancelarSolicitud(a.id)} className="text-xs text-red-700 font-semibold">
                  Cancelar solicitud
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Acciones guardadas en el teléfono */}
      {acciones.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-2">
          <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-1.5">
            <Smartphone className="w-4 h-4" />
            <span>Mis acciones en este teléfono</span>
          </h2>
          {acciones
            .slice()
            .reverse()
            .map((a) => (
              <div key={a.id} className={`border rounded-lg px-3 py-2 text-xs ${ESTILO_ACCION[a.estado]}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">{a.tipo}</span>
                  <span className="flex items-center space-x-1">
                    {a.estado === 'conflicto' ? <XCircle className="w-3.5 h-3.5" /> : a.estado === 'guardada' ? <Clock className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    <span>{ETIQUETA_ESTADO_ACCION[a.estado]}</span>
                  </span>
                </div>
                <span className="block opacity-80">{formatearFechaColombia(a.registradaEn)}</span>
                {a.mensaje && <span className="block mt-0.5">{a.mensaje}</span>}
                {a.estado === 'conflicto' && (
                  <button onClick={() => descartarAccion(uid, a.id)} className="mt-1 font-semibold underline">
                    Entendido, quitar de la lista
                  </button>
                )}
              </div>
            ))}
        </div>
      )}

      {/* Historial */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-2">
        <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-1.5">
          <History className="w-4 h-4" />
          <span>Historial del pedido</span>
        </h2>
        <ol className="space-y-1.5">
          {orden.historial.map((ev) => (
            <li key={ev.indice} className="text-xs border-l-2 border-slate-200 pl-3">
              <span className="font-semibold text-slate-800">{ev.tipo}</span>
              <span className="text-slate-500"> · {formatearFechaColombia(ev.fecha)}</span>
              {ev.descripcion && <span className="block text-slate-600">{ev.descripcion}</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};
