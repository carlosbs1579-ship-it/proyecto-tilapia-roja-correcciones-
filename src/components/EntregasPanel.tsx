import React, { useEffect, useState } from 'react';
import {
  Truck,
  Plus,
  X,
  ShieldCheck,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Repeat,
  Ban,
  PackageCheck
} from 'lucide-react';
import { Lote, EntregasLote, TipoRegistroEntrega } from '../types';
import {
  escucharEntregas,
  calcularEstadoEntregas,
  registrarAccionEntrega,
  verificarIntegridadEntregas,
  ResumenEntrega
} from '../services/entregasService';
import { ResultadoVerificacion } from '../services/hashService';
import { formatearFechaColombia, getFechaHoyBogota } from '../utils/constants';

interface EntregasPanelProps {
  lote: Lote;
  userEmail: string;
  puedeGestionar: boolean; // administrador autorizado de la granja
}

const ESTILO_ESTADO: Record<string, string> = {
  asignada: 'bg-sky-100 text-sky-800 border-sky-200',
  entregada: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  anulada: 'bg-slate-200 text-slate-600 border-slate-300'
};

const ETIQUETA_ESTADO: Record<string, string> = {
  asignada: 'Asignada (pendiente)',
  entregada: 'Entregada',
  anulada: 'Anulada'
};

// Formulario según la acción: asignar una entrega nueva o actuar sobre una existente
type Formulario = { tipo: TipoRegistroEntrega; entrega?: ResumenEntrega };

export const EntregasPanel: React.FC<EntregasPanelProps> = ({ lote, userEmail, puedeGestionar }) => {
  const [entregasDoc, setEntregasDoc] = useState<EntregasLote | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const [formulario, setFormulario] = useState<Formulario | null>(null);
  const [verificacion, setVerificacion] = useState<ResultadoVerificacion | null>(null);
  const [verificando, setVerificando] = useState(false);

  // Campos del formulario
  const [cliente, setCliente] = useState('');
  const [fecha, setFecha] = useState(getFechaHoyBogota());
  const [cantidadKg, setCantidadKg] = useState<number | ''>('');
  const [motivo, setMotivo] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);

  useEffect(() => {
    setCargando(true);
    return escucharEntregas(
      lote.codigo,
      (doc) => {
        setEntregasDoc(doc);
        setCargando(false);
        setErrorCarga(null);
        setVerificacion(null);
      },
      () => {
        setCargando(false);
        setErrorCarga('No fue posible cargar las entregas de este lote.');
      }
    );
  }, [lote.codigo]);

  const entregas = calcularEstadoEntregas(entregasDoc?.registros || []);
  const cosechadaKg = Number(lote.resumen?.biomasaCosechadaKg) || 0;
  const comprometidoKg = entregas.filter((e) => e.estado !== 'anulada').reduce((s, e) => s + e.cantidadKg, 0);
  const entregadoKg = entregas.filter((e) => e.estado === 'entregada').reduce((s, e) => s + e.cantidadKg, 0);

  const abrirFormulario = (tipo: TipoRegistroEntrega, entrega?: ResumenEntrega) => {
    setFormulario({ tipo, entrega });
    setCliente('');
    setFecha(getFechaHoyBogota());
    setCantidadKg(tipo === 'Entrega completada' && entrega ? entrega.cantidadKg : '');
    setMotivo('');
    setObservaciones('');
    setErrorForm(null);
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formulario) return;
    setGuardando(true);
    setErrorForm(null);
    try {
      await registrarAccionEntrega({
        codigoLote: lote.codigo,
        tipo: formulario.tipo,
        entregaId: formulario.entrega?.entregaId,
        cliente,
        fecha,
        cantidadKg: cantidadKg === '' ? undefined : Number(cantidadKg),
        motivo,
        observaciones,
        userEmail
      });
      setFormulario(null);
    } catch (err: any) {
      setErrorForm(err.message || 'No fue posible registrar la entrega.');
    } finally {
      setGuardando(false);
    }
  };

  const handleVerificar = async () => {
    if (!entregasDoc) return;
    setVerificando(true);
    try {
      setVerificacion(await verificarIntegridadEntregas(lote, entregasDoc));
    } catch (err: any) {
      setVerificacion({ valido: false, totalEventos: 0, mensaje: `Error al verificar: ${err.message}` });
    } finally {
      setVerificando(false);
    }
  };

  const tipo = formulario?.tipo;
  const pideCliente = tipo === 'Asignación de cliente' || tipo === 'Reasignación de cliente';
  const pideCantidad = tipo === 'Asignación de cliente' || tipo === 'Entrega completada';
  const pideMotivo = tipo === 'Reasignación de cliente' || tipo === 'Anulación de asignación';

  return (
    <div className="bg-white rounded-xl border border-indigo-200 shadow-xs overflow-hidden">
      {/* Cabecera */}
      <div className="px-6 py-4 border-b border-indigo-100 bg-indigo-50/60 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <Truck className="w-4 h-4 text-indigo-600" />
            <h3 className="font-bold text-slate-900 text-sm">Entregas a Clientes</h3>
            <span className="text-[10px] bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider">
              Posterior al sellado
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 max-w-2xl">
            Estos registros forman una cadena propia anclada al hash de cierre del lote. No modifican los registros de producción sellados ni su hash.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {entregasDoc && (
            <button
              onClick={handleVerificar}
              disabled={verificando}
              className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold transition-colors border border-slate-200 disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>{verificando ? 'Verificando...' : 'Verificar Entregas (Hash)'}</span>
            </button>
          )}
          {puedeGestionar && (
            <button
              onClick={() => abrirFormulario('Asignación de cliente')}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-semibold shadow-xs bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Asignar Cliente</span>
            </button>
          )}
        </div>
      </div>

      {/* Totales */}
      <div className="px-6 py-3 border-b border-slate-100 grid grid-cols-3 gap-3 text-center text-xs">
        <div>
          <span className="text-slate-500 block">Biomasa cosechada</span>
          <strong className="text-slate-900">{cosechadaKg ? `${cosechadaKg.toLocaleString()} kg` : 'Sin registrar'}</strong>
        </div>
        <div>
          <span className="text-slate-500 block">Comprometido</span>
          <strong className="text-sky-700">{comprometidoKg.toLocaleString()} kg</strong>
        </div>
        <div>
          <span className="text-slate-500 block">Entregado</span>
          <strong className="text-emerald-700">{entregadoKg.toLocaleString()} kg</strong>
        </div>
      </div>

      {/* Resultado de la verificación */}
      {verificacion && (
        <div
          className={`mx-6 mt-4 p-3 rounded-lg border text-xs flex items-start space-x-2 ${
            verificacion.valido ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-red-50 border-red-300 text-red-900'
          }`}
        >
          {verificacion.valido ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span>{verificacion.mensaje}</span>
        </div>
      )}

      {/* Lista de entregas */}
      <div className="divide-y divide-slate-100">
        {cargando ? (
          <div className="py-8 text-center text-xs text-slate-400">Cargando entregas...</div>
        ) : errorCarga ? (
          <div className="py-8 text-center text-xs text-red-600">{errorCarga}</div>
        ) : entregas.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            Aún no hay clientes asignados a este lote.
          </div>
        ) : (
          entregas.map((e) => (
            <div key={e.entregaId} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-sm text-slate-900">{e.cliente}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${ESTILO_ESTADO[e.estado]}`}>
                      {ETIQUETA_ESTADO[e.estado]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {e.cantidadKg.toLocaleString()} kg •{' '}
                    {e.estado === 'entregada' ? `Entregado el ${e.fechaEntrega}` : `Programado para ${e.fechaProgramada}`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {puedeGestionar && e.estado === 'asignada' && (
                    <>
                      <button
                        onClick={() => abrirFormulario('Entrega completada', e)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-semibold"
                      >
                        <PackageCheck className="w-3.5 h-3.5" />
                        <span>Confirmar entrega</span>
                      </button>
                      <button
                        onClick={() => abrirFormulario('Reasignación de cliente', e)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-[11px] font-semibold border border-slate-200"
                      >
                        <Repeat className="w-3.5 h-3.5 text-sky-600" />
                        <span>Cambiar cliente</span>
                      </button>
                      <button
                        onClick={() => abrirFormulario('Anulación de asignación', e)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-[11px] font-semibold border border-slate-200"
                      >
                        <Ban className="w-3.5 h-3.5 text-red-500" />
                        <span>Anular</span>
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setAbiertas((prev) => ({ ...prev, [e.entregaId]: !prev[e.entregaId] }))}
                    className="inline-flex items-center space-x-1 px-2 py-1.5 text-[11px] text-indigo-700 hover:text-indigo-900 font-semibold"
                  >
                    <span>Historial ({e.registros.length})</span>
                    {abiertas[e.entregaId] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Historial auditado de la entrega */}
              {abiertas[e.entregaId] && (
                <div className="mt-3 space-y-2 border-l-2 border-indigo-200 pl-3">
                  {e.registros.map((r) => (
                    <div key={r.id} className="text-xs bg-slate-50 rounded-lg p-2.5 border border-slate-200">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">
                          #{r.indice} {r.tipo}
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono">{r.fechaEvento}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-600 space-y-0.5">
                        {r.tipo === 'Reasignación de cliente' && (
                          <p>
                            De <strong>{r.datos.clienteAnterior}</strong> a <strong>{r.datos.cliente}</strong>
                          </p>
                        )}
                        {r.tipo !== 'Reasignación de cliente' && (
                          <p>
                            Cliente: <strong>{r.datos.cliente}</strong> • {Number(r.datos.cantidadKg).toLocaleString()} kg
                          </p>
                        )}
                        {r.datos.motivo && <p>Motivo: {r.datos.motivo}</p>}
                        {r.descripcion && <p>Observaciones: {r.descripcion}</p>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                        <span>
                          {r.registradoPor} • {formatearFechaColombia(r.registradoEn)}
                        </span>
                        <span title={`SHA-256: ${r.hash}`} className="font-mono">
                          {r.hash.substring(0, 12)}...
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Formulario de acción */}
      {formulario && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden my-6">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Truck className="w-5 h-5 text-indigo-300" />
                <div>
                  <h3 className="font-semibold text-base">{formulario.tipo}</h3>
                  <p className="text-xs text-slate-400">
                    Lote sellado: {lote.codigo}
                    {formulario.entrega ? ` • Cliente actual: ${formulario.entrega.cliente}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFormulario(null)}
                className="text-slate-400 hover:text-white p-1 rounded transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardar} className="p-6 space-y-4">
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-xs text-indigo-900">
                Esta acción se agrega como un nuevo registro con su propio hash. Los registros anteriores y los datos de producción sellados no se modifican.
              </div>

              {errorForm && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorForm}</span>
                </div>
              )}

              {pideCliente && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {tipo === 'Reasignación de cliente' ? 'Nuevo cliente o restaurante *' : 'Cliente o restaurante destinatario *'}
                  </label>
                  <input
                    type="text"
                    value={cliente}
                    onChange={(e) => setCliente(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="ej: Restaurante El Pescador, Cartagena"
                    required
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {tipo === 'Entrega completada'
                      ? 'Fecha de entrega *'
                      : tipo === 'Asignación de cliente'
                      ? 'Fecha de entrega programada *'
                      : 'Fecha *'}
                  </label>
                  <input
                    type="date"
                    value={fecha}
                    onChange={(e) => setFecha(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>
                {pideCantidad && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {tipo === 'Entrega completada' ? 'Cantidad entregada (kg) *' : 'Cantidad (kg) *'}
                    </label>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={cantidadKg}
                      onChange={(e) => setCantidadKg(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      required
                    />
                  </div>
                )}
              </div>

              {pideMotivo && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {tipo === 'Reasignación de cliente' ? 'Motivo del cambio de cliente *' : 'Motivo de la anulación *'}
                  </label>
                  <textarea
                    rows={2}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Observaciones</label>
                <textarea
                  rows={2}
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Temperatura de entrega, persona que recibe, estado del producto..."
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setFormulario(null)}
                  disabled={guardando}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando}
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50"
                >
                  {guardando ? 'Registrando...' : 'Registrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
