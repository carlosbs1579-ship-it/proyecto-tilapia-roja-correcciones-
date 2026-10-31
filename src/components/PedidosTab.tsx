import React, { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  Plus,
  Lock,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Layers,
  Send,
  Edit3,
  History,
  Truck,
  Repeat,
  AlertTriangle
} from 'lucide-react';
import { AjusteDistribucion, Cliente, EstadoOrden, InventarioLote, Lote, OrdenEntrega, UsuarioPerfil } from '../types';
import {
  ETIQUETA_ESTADO_ORDEN,
  Repartidor,
  TRANSICIONES_MANUALES,
  aprobarAjuste,
  calcularDisponibilidad,
  cambiarEstadoOrden,
  cambiarRepartidor,
  cantidadPendiente,
  confirmarBorrador,
  escucharClientes,
  escucharInventario,
  escucharOrdenes,
  escucharRepartidores,
  liberarSaldoYCerrar,
  rechazarAjuste,
  reprogramarSaldo,
  saldoLote
} from '../services/pedidosService';
import { verificarPermiso } from '../services/usuariosService';
import { formatearFechaColombia } from '../utils/constants';
import { NuevaOrdenModal } from './NuevaOrdenModal';

interface PedidosTabProps {
  lotes: Lote[];
  perfilActual: UsuarioPerfil | null;
}

const ESTILO_ESTADO: Record<EstadoOrden, string> = {
  borrador: 'bg-slate-100 text-slate-700 border-slate-300',
  asignado: 'bg-sky-100 text-sky-800 border-sky-300',
  en_preparacion: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  en_ruta: 'bg-violet-100 text-violet-800 border-violet-300',
  entrega_parcial: 'bg-amber-100 text-amber-800 border-amber-300',
  entregado: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  requiere_revision: 'bg-orange-100 text-orange-800 border-orange-300',
  cancelado: 'bg-red-50 text-red-700 border-red-200'
};

const num = (n: number) => (Number(n) || 0).toLocaleString('es-CO');

export const PedidosTab: React.FC<PedidosTabProps> = ({ lotes, perfilActual }) => {
  const puedeGestionar = verificarPermiso(perfilActual, 'gestionarPedidos');
  const granjaId = perfilActual?.granjaId || 'cultivos-lore';

  const [vista, setVista] = useState<'ordenes' | 'lotes'>('ordenes');
  const [ordenes, setOrdenes] = useState<OrdenEntrega[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [inventario, setInventario] = useState<Record<string, InventarioLote>>({});
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<FiltroOrdenes>('activas');
  const [abierta, setAbierta] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [ordenEditar, setOrdenEditar] = useState<OrdenEntrega | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [nuevoRepartidor, setNuevoRepartidor] = useState('');
  const [respuestaAjuste, setRespuestaAjuste] = useState('');

  useEffect(() => {
    if (!puedeGestionar) return;
    setCargando(true);
    const fallo = (err: any) => {
      setErrorCarga(
        err?.code === 'permission-denied'
          ? 'No tienes permiso para consultar los pedidos de la granja.'
          : 'No fue posible cargar los pedidos.'
      );
      setCargando(false);
    };
    const cancelar = [
      escucharOrdenes(granjaId, (l) => {
        setOrdenes(l);
        setCargando(false);
        setErrorCarga(null);
      }, fallo),
      escucharClientes(granjaId, setClientes, fallo),
      escucharInventario(granjaId, setInventario, fallo),
      escucharRepartidores(granjaId, setRepartidores, fallo)
    ];
    return () => cancelar.forEach((c) => c());
  }, [puedeGestionar, granjaId]);

  // El mensaje de éxito se oculta solo; un mensaje nuevo reinicia el tiempo
  useEffect(() => {
    if (!mensaje) return;
    const t = setTimeout(() => setMensaje(null), 5000);
    return () => clearTimeout(t);
  }, [mensaje]);

  const ordenesFiltradas = useMemo(
    () =>
      ordenes.filter((o) =>
        filtroEstado === 'todas'
          ? true
          : filtroEstado === 'solicitudes'
          ? solicitudesPendientes(o).length > 0
          : filtroEstado === 'novedades'
          ? conNovedadesActivas(o)
          : filtroEstado === 'activas'
          ? !['entregado', 'cancelado'].includes(o.estado)
          : o.estado === filtroEstado
      ),
    [ordenes, filtroEstado]
  );

  // Órdenes vinculadas a cada lote (relación lote ↔ pedidos)
  const ordenesPorLote = useMemo(() => {
    const mapa: Record<string, { orden: OrdenEntrega; cantidad: number }[]> = {};
    for (const o of ordenes) {
      for (const [codigo, p] of Object.entries(o.procedencias || {})) {
        (mapa[codigo] ||= []).push({ orden: o, cantidad: p.cantidad });
      }
    }
    return mapa;
  }, [ordenes]);

  if (!puedeGestionar) {
    return (
      <div className="max-w-2xl mx-auto bg-white rounded-xl border border-slate-200 shadow-xs p-6 flex items-start space-x-3 text-xs text-slate-700">
        <Lock className="w-5 h-5 text-slate-400 shrink-0" />
        <div>
          <p className="font-bold text-sm text-slate-900">Pedidos restringidos</p>
          <p className="mt-1">Tu cuenta no tiene el permiso "Gestionar pedidos". Solicítalo al administrador en "Personal & Permisos".</p>
        </div>
      </div>
    );
  }

  const ejecutar = async (accion: () => Promise<void>, exito: string) => {
    setProcesando(true);
    setErrorAccion(null);
    setMensaje(null);
    try {
      await accion();
      setMensaje(exito);
      setMotivo('');
      setNuevoRepartidor('');
    } catch (err: any) {
      setErrorAccion(err.message || 'No fue posible completar la acción.');
    } finally {
      setProcesando(false);
    }
  };

  const abrirNueva = () => {
    setOrdenEditar(null);
    setModalAbierto(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <ClipboardList className="w-5 h-5 text-sky-600" />
            <span>Pedidos y órdenes de entrega</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Órdenes vinculadas a los lotes cosechados, con reserva de cantidades y procedencia por lote y piscina
          </p>
        </div>
        <button
          onClick={abrirNueva}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold shadow-xs transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva orden</span>
        </button>
      </div>

      {mensaje && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center space-x-2 text-emerald-800 text-xs">
          <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
          <span className="font-medium">{mensaje}</span>
        </div>
      )}
      {(errorAccion || errorCarga) && (
        <div className="p-3 bg-red-50 border border-red-300 rounded-xl flex items-center space-x-2 text-red-800 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span className="font-medium">{errorAccion || errorCarga}</span>
        </div>
      )}

      <div className="flex items-center rounded-lg border border-slate-200 p-0.5 text-xs bg-white w-fit">
        <button
          onClick={() => setVista('ordenes')}
          className={`px-3 py-1.5 rounded-md font-medium ${vista === 'ordenes' ? 'bg-slate-900 text-white font-bold' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Órdenes ({ordenes.length})
        </button>
        <button
          onClick={() => setVista('lotes')}
          className={`px-3 py-1.5 rounded-md font-medium ${vista === 'lotes' ? 'bg-slate-900 text-white font-bold' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Disponibilidad por lote
        </button>
      </div>

      {vista === 'ordenes' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {RESUMEN.map(({ id, etiqueta, contar, icono }) => (
            <button
              key={id}
              onClick={() => setFiltroEstado(id)}
              className={'bg-white border rounded-xl p-3 text-left flex items-center justify-between ' +
                (filtroEstado === id ? 'border-sky-500 ring-2 ring-sky-200' : 'border-slate-200')}
            >
              <span>
                <span className="block text-slate-500">{etiqueta}</span>
                <strong className="text-lg text-slate-900">{ordenes.filter(contar).length}</strong>
              </span>
              {icono}
            </button>
          ))}
        </div>
      )}

      {vista === 'ordenes' ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Mostrar:</span>
            <select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value as any)}
              className="px-2.5 py-1 border border-slate-300 rounded-lg bg-white"
            >
              <option value="activas">En curso</option>
              <option value="todas">Todas</option>
              <option value="solicitudes">Con ajustes por aprobar</option>
              <option value="novedades">Con novedades</option>
              {(Object.keys(ETIQUETA_ESTADO_ORDEN) as EstadoOrden[]).map((e) => (
                <option key={e} value={e}>{ETIQUETA_ESTADO_ORDEN[e]}</option>
              ))}
            </select>
          </div>

          {cargando ? (
            <div className="py-10 text-center text-xs text-slate-500">Cargando órdenes...</div>
          ) : ordenesFiltradas.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">No hay órdenes con este filtro.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {ordenesFiltradas.map((o) => {
                const expandida = abierta === o.id;
                const transiciones = (TRANSICIONES_MANUALES[o.estado] || []).filter((e) => e !== 'cancelado');
                const puedeCancelar = (TRANSICIONES_MANUALES[o.estado] || []).includes('cancelado');
                const puedeCambiarRepartidor = ['borrador', 'asignado', 'en_preparacion', 'requiere_revision'].includes(o.estado);
                return (
                  <div key={o.id} className="text-xs">
                    <button
                      onClick={() => {
                        setAbierta(expandida ? null : o.id);
                        setErrorAccion(null);
                        setMotivo('');
                        setNuevoRepartidor('');
                        setRespuestaAjuste('');
                      }}
                      className="w-full px-5 py-3 grid grid-cols-2 sm:grid-cols-6 gap-2 items-center text-left hover:bg-slate-50"
                    >
                      <span className="font-mono font-bold text-slate-900">{o.id}</span>
                      <span className="text-slate-700 truncate">{o.clienteNombre}</span>
                      <span className="text-slate-600">
                        {num(o.cantidadAutorizada)} / {num(o.cantidadSolicitada)} {o.unidad}
                        <span className="block text-[10px] text-slate-400">autorizado / solicitado</span>
                      </span>
                      <span className="text-slate-600 truncate">{o.repartidorNombre || 'Sin repartidor'}</span>
                      <span>
                        <span className={`inline-block px-2 py-0.5 rounded-full border font-semibold text-[10px] ${ESTILO_ESTADO[o.estado]}`}>
                          {ETIQUETA_ESTADO_ORDEN[o.estado]}
                        </span>
                        {solicitudesPendientes(o).length > 0 && (
                          <span className="block mt-0.5 text-[10px] font-semibold text-indigo-700">Ajuste por aprobar</span>
                        )}
                        {o.estado === 'en_ruta' && o.llegadaEn && (
                          <span className="block mt-0.5 text-[10px] text-violet-700">Llegó al cliente</span>
                        )}
                      </span>
                      <span className="flex items-center justify-end text-slate-400">
                        {expandida ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </span>
                    </button>

                    {expandida && (
                      <div className="px-5 pb-5 space-y-4 bg-slate-50/60">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                          {[
                            ['Solicitada', o.cantidadSolicitada],
                            ['Autorizada (reservada)', o.cantidadAutorizada],
                            ['Entregada', o.cantidadEntregada],
                            ['Pendiente', cantidadPendiente(o)]
                          ].map(([etiqueta, valor]) => (
                            <div key={etiqueta as string} className="bg-white border border-slate-200 rounded-lg p-2.5">
                              <span className="text-[10px] text-slate-500 block">{etiqueta}</span>
                              <strong className="text-sm text-slate-900">{num(valor as number)} {o.unidad}</strong>
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-600">
                          <span>Creada por <strong>{o.creadoPor}</strong> el {formatearFechaColombia(o.creadoEn)}</span>
                          <span>Entrega programada: <strong>{o.fechaProgramada || 'sin fecha'}</strong></span>
                          <span>Observaciones: {o.observaciones || '—'}</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-[11px] text-slate-700 bg-white border border-slate-200 rounded-lg p-2.5">
                          <span>Dirección: <strong>{o.clienteDireccion || 'sin registrar'}</strong></span>
                          <span>Ruta iniciada: <strong>{o.rutaIniciadaEn ? formatearFechaColombia(o.rutaIniciadaEn) : '—'}</strong></span>
                          <span>Llegada: <strong>{o.llegadaEn ? formatearFechaColombia(o.llegadaEn) : '—'}</strong></span>
                          <span>
                            Liberado al cerrar: <strong>{o.cantidadLiberada ? num(o.cantidadLiberada) + ' ' + o.unidad : '—'}</strong>
                          </span>
                        </div>

                        <div>
                          <span className="font-bold text-slate-700 block mb-1">Procedencia</span>
                          {Object.keys(o.procedencias || {}).length === 0 ? (
                            <p className="text-slate-500">Sin distribución por lotes todavía.</p>
                          ) : (
                            <table className="w-full bg-white border border-slate-200 rounded-lg overflow-hidden">
                              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 text-left">
                                <tr>
                                  <th className="px-3 py-1.5">Lote</th>
                                  <th className="px-3 py-1.5">Piscina</th>
                                  <th className="px-3 py-1.5 text-right">Autorizado</th>
                                  <th className="px-3 py-1.5 text-right">Entregado</th>
                                  <th className="px-3 py-1.5 text-right">Por entregar</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {Object.entries(o.procedencias).map(([codigo, p]) => (
                                  <tr key={codigo}>
                                    <td className="px-3 py-1.5 font-mono font-bold">{codigo}</td>
                                    <td className="px-3 py-1.5">{p.estanque}</td>
                                    <td className="px-3 py-1.5 text-right">{num(p.cantidad)} {p.unidad}</td>
                                    <td className="px-3 py-1.5 text-right">{num(o.entregadoPorLote?.[codigo] || 0)}</td>
                                    <td className="px-3 py-1.5 text-right">
                                      {o.estado === 'cancelado' || o.estado === 'entregado' ? '—' : num(saldoLote(o, codigo))}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {o.estado === 'borrador' && (
                            <p className="text-[10px] text-slate-500 mt-1">Borrador: estas cantidades aún no están reservadas.</p>
                          )}
                        </div>

                        {/* Novedades del repartidor */}
                        {novedadesDe(o).length > 0 && (
                          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-1">
                            <span className="font-bold text-orange-900 block">Novedades del repartidor</span>
                            {novedadesDe(o).map((ev) => (
                              <p key={ev.indice} className="text-orange-900">
                                <strong>{formatearFechaColombia(ev.fecha)}</strong> · {ev.descripcion}
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Solicitudes de ajuste */}
                        {Object.keys(o.ajustes || {}).length > 0 && (
                          <div className="bg-white border border-indigo-200 rounded-lg p-3 space-y-3">
                            <span className="font-bold text-indigo-900 block">Solicitudes de ajuste de distribución</span>
                            {Object.values(o.ajustes || {})
                              .sort((a, b) => b.solicitadoEn.localeCompare(a.solicitadoEn))
                              .map((a) => (
                                <SolicitudAjuste
                                  key={a.id}
                                  ajuste={a}
                                  orden={o}
                                  propia={a.solicitadoPorUid === perfilActual?.uid}
                                  procesando={procesando}
                                  respuesta={respuestaAjuste}
                                  setRespuesta={setRespuestaAjuste}
                                  onAprobar={() => ejecutar(() => aprobarAjuste(o.id, a.id, respuestaAjuste), 'Ajuste aprobado y aplicado: reservas actualizadas.')}
                                  onRechazar={() => ejecutar(() => rechazarAjuste(o.id, a.id, respuestaAjuste), 'Solicitud rechazada; la distribución no cambió.')}
                                />
                              ))}
                          </div>
                        )}

                        {/* Acciones */}
                        <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
                          <span className="font-bold text-slate-700 block">Acciones</span>
                          <input
                            type="text"
                            placeholder="Motivo (obligatorio para cancelar, enviar a revisión o cambiar el repartidor)"
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                          />
                          <div className="flex flex-wrap gap-2">
                            {o.estado === 'borrador' && (
                              <>
                                <button
                                  disabled={procesando}
                                  onClick={() => {
                                    setOrdenEditar(o);
                                    setModalAbierto(true);
                                  }}
                                  className="inline-flex items-center space-x-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg font-semibold disabled:opacity-50"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>Modificar borrador</span>
                                </button>
                                <button
                                  disabled={procesando}
                                  onClick={() => ejecutar(() => confirmarBorrador(o.id), `Orden ${o.id} confirmada: cantidades reservadas.`)}
                                  className="inline-flex items-center space-x-1 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-bold disabled:opacity-50"
                                >
                                  <Send className="w-3.5 h-3.5" />
                                  <span>Confirmar, reservar y asignar</span>
                                </button>
                              </>
                            )}
                            {transiciones.map((e) => (
                              <button
                                key={e}
                                disabled={procesando}
                                onClick={() =>
                                  ejecutar(() => cambiarEstadoOrden(o.id, e, motivo), `Orden ${o.id}: ${ETIQUETA_ESTADO_ORDEN[e]}.`)
                                }
                                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold disabled:opacity-50"
                              >
                                Pasar a "{ETIQUETA_ESTADO_ORDEN[e]}"
                              </button>
                            ))}
                            {puedeCancelar && (
                              <button
                                disabled={procesando}
                                onClick={() =>
                                  ejecutar(
                                    () => cambiarEstadoOrden(o.id, 'cancelado', motivo),
                                    o.estado === 'borrador'
                                      ? `Borrador ${o.id} cancelado.`
                                      : `Orden ${o.id} cancelada: ${num(cantidadPendiente(o))} ${o.unidad} liberados.`
                                  )
                                }
                                className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg font-semibold disabled:opacity-50"
                              >
                                Cancelar orden{o.estado !== 'borrador' ? ' y liberar reserva' : ''}
                              </button>
                            )}
                          </div>
                          {puedeCambiarRepartidor && (
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                value={nuevoRepartidor}
                                onChange={(e) => setNuevoRepartidor(e.target.value)}
                                className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                              >
                                <option value="">Cambiar repartidor...</option>
                                {repartidores
                                  .filter((r) => r.uid !== o.repartidorUid)
                                  .map((r) => (
                                    <option key={r.uid} value={r.uid}>{r.nombre} — {r.cargo}</option>
                                  ))}
                              </select>
                              <button
                                disabled={procesando || !nuevoRepartidor}
                                onClick={() => {
                                  const r = repartidores.find((x) => x.uid === nuevoRepartidor);
                                  if (r) ejecutar(() => cambiarRepartidor(o.id, r, motivo), `Repartidor de ${o.id}: ${r.nombre}.`);
                                }}
                                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg font-semibold disabled:opacity-50"
                              >
                                Asignar
                              </button>
                            </div>
                          )}
                          {o.estado === 'entrega_parcial' && (
                            <div className="space-y-2 border-t border-slate-100 pt-2">
                              <p className="text-amber-800">
                                Entrega parcial: faltan <strong>{num(cantidadPendiente(o))} {o.unidad}</strong>. Decide cómo continuar:
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  value={nuevoRepartidor}
                                  onChange={(e) => setNuevoRepartidor(e.target.value)}
                                  className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                                >
                                  <option value="">Mismo repartidor ({o.repartidorNombre})</option>
                                  {repartidores
                                    .filter((r) => r.uid !== o.repartidorUid)
                                    .map((r) => (
                                      <option key={r.uid} value={r.uid}>{r.nombre} — {r.cargo}</option>
                                    ))}
                                </select>
                                <button
                                  disabled={procesando}
                                  onClick={() =>
                                    ejecutar(
                                      () => reprogramarSaldo(o.id, motivo, repartidores.find((x) => x.uid === nuevoRepartidor) || null),
                                      'Saldo de ' + o.id + ' reprogramado: vuelve a asignado para una nueva ruta.'
                                    )
                                  }
                                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-bold disabled:opacity-50"
                                >
                                  Reprogramar entrega del saldo
                                </button>
                                <button
                                  disabled={procesando}
                                  onClick={() =>
                                    ejecutar(
                                      () => liberarSaldoYCerrar(o.id, motivo),
                                      'Orden ' + o.id + ' cerrada: ' + num(cantidadPendiente(o)) + ' ' + o.unidad + ' liberados y disponibles otra vez.'
                                    )
                                  }
                                  className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg font-semibold disabled:opacity-50"
                                >
                                  Liberar saldo y cerrar
                                </button>
                              </div>
                              <p className="text-[10px] text-slate-500">Para liberar el saldo escribe el motivo en el campo de arriba.</p>
                            </div>
                          )}
                          {['entregado', 'cancelado'].includes(o.estado) && (
                            <p className="text-slate-500">Esta orden está cerrada y no admite más cambios.</p>
                          )}
                        </div>

                        {/* Historial */}
                        <div>
                          <span className="font-bold text-slate-700 flex items-center space-x-1 mb-1">
                            <History className="w-3.5 h-3.5" />
                            <span>Historial (no se modifica)</span>
                          </span>
                          <ol className="space-y-1">
                            {o.historial.map((ev) => (
                              <li key={ev.indice} className="bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                                <span className="font-semibold text-slate-800">{ev.tipo}</span>
                                <span className="text-slate-500">
                                  {' • ' + formatearFechaColombia(ev.fecha) + ' • ' + ev.registradoPor}
                                  {ev.funcion ? ' (' + (ETIQUETA_FUNCION[ev.funcion] || ev.funcion) + ')' : ''}
                                </span>
                                {ev.descripcion && <span className="block text-slate-600">{ev.descripcion}</span>}
                              </li>
                            ))}
                          </ol>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-x-auto">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center space-x-2 text-xs">
            <Layers className="w-4 h-4 text-sky-600" />
            <span className="font-bold text-slate-800">Producción registrada, reservas y disponibilidad por lote</span>
          </div>
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Lote</th>
                <th className="px-4 py-2">Piscina</th>
                <th className="px-4 py-2 text-right">Cosechado</th>
                <th className="px-4 py-2">Unidad de reservas</th>
                <th className="px-4 py-2 text-right">Reservado</th>
                <th className="px-4 py-2 text-right">Entregado</th>
                <th className="px-4 py-2 text-right">Disponible</th>
                <th className="px-4 py-2">Órdenes vinculadas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lotes.map((lote) => {
                const inv = inventario[lote.codigo];
                const unidad = inv?.unidad || 'peces';
                const disp = calcularDisponibilidad(lote, inv, unidad);
                const vinculadas = ordenesPorLote[lote.codigo] || [];
                return (
                  <tr key={lote.codigo} className="align-top">
                    <td className="px-4 py-2 font-mono font-bold">
                      {lote.codigo}
                      <span className="block text-[10px] font-sans font-normal text-slate-400">
                        {lote.estado === 'cerrado' ? 'sellado' : 'activo'}
                      </span>
                    </td>
                    <td className="px-4 py-2">{lote.estanque}</td>
                    <td className="px-4 py-2 text-right">
                      {lote.resumen?.pecesCosechados ? (
                        <>
                          {num(lote.resumen.pecesCosechados)} peces
                          <span className="block text-slate-500">{num(lote.resumen.biomasaCosechadaKg)} kg</span>
                        </>
                      ) : (
                        <span className="text-slate-400">Sin cosecha registrada</span>
                      )}
                    </td>
                    <td className="px-4 py-2">{inv ? inv.unidad : <span className="text-slate-400">Sin reservas</span>}</td>
                    <td className="px-4 py-2 text-right">{num(disp.reservado)}</td>
                    <td className="px-4 py-2 text-right">{num(disp.entregado)}</td>
                    <td className="px-4 py-2 text-right font-bold text-emerald-700">
                      {disp.cosechado > 0 ? `${num(disp.disponible)} ${unidad}` : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {vinculadas.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {vinculadas.map(({ orden, cantidad }) => (
                            <li key={orden.id}>
                              <button
                                onClick={() => {
                                  setVista('ordenes');
                                  setFiltroEstado('todas');
                                  setAbierta(orden.id);
                                }}
                                className="font-mono text-sky-700 hover:underline"
                              >
                                {orden.id}
                              </button>
                              <span className="text-slate-500">
                                {' '}• {num(cantidad)} {orden.unidad} • {ETIQUETA_ESTADO_ORDEN[orden.estado]}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <NuevaOrdenModal
        isOpen={modalAbierto}
        onClose={() => setModalAbierto(false)}
        granjaId={granjaId}
        lotes={lotes}
        inventario={inventario}
        clientes={clientes}
        repartidores={repartidores}
        ordenEditar={ordenEditar}
        onGuardada={setMensaje}
      />
    </div>
  );
};

type FiltroOrdenes = 'activas' | 'todas' | 'solicitudes' | 'novedades' | EstadoOrden;

const ETIQUETA_AJUSTE: Record<string, string> = {
  pendiente_aprobacion: 'Pendiente de aprobación',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada por el repartidor',
  aplicada: 'Aprobada y aplicada'
};

const ETIQUETA_FUNCION: Record<string, string> = {
  admin: 'administrador',
  operator: 'operador',
  courier: 'repartidor'
};

const ESTADOS_ACTIVOS_AJUSTE: EstadoOrden[] = ['asignado', 'en_preparacion', 'en_ruta', 'requiere_revision'];

function solicitudesPendientes(o: OrdenEntrega) {
  return Object.values(o.ajustes || {}).filter((a) => a.estado === 'pendiente_aprobacion');
}

function novedadesDe(o: OrdenEntrega) {
  return (o.historial || []).filter((ev) => ev.tipo === 'Novedad');
}

function conNovedadesActivas(o: OrdenEntrega) {
  return novedadesDe(o).length > 0 && !['entregado', 'cancelado'].includes(o.estado);
}

// Tarjetas de seguimiento: cada una filtra la lista de órdenes
const RESUMEN: { id: FiltroOrdenes; etiqueta: string; contar: (o: OrdenEntrega) => boolean; icono: React.ReactNode }[] = [
  { id: 'en_ruta', etiqueta: 'Rutas en curso', contar: (o) => o.estado === 'en_ruta', icono: <Truck className="w-4 h-4 text-violet-600" /> },
  { id: 'entrega_parcial', etiqueta: 'Entregas parciales', contar: (o) => o.estado === 'entrega_parcial', icono: <AlertTriangle className="w-4 h-4 text-amber-600" /> },
  { id: 'solicitudes', etiqueta: 'Ajustes por aprobar', contar: (o) => solicitudesPendientes(o).length > 0, icono: <Repeat className="w-4 h-4 text-indigo-600" /> },
  { id: 'novedades', etiqueta: 'Con novedades', contar: conNovedadesActivas, icono: <AlertCircle className="w-4 h-4 text-orange-600" /> }
];

const SolicitudAjuste: React.FC<{
  ajuste: AjusteDistribucion;
  orden: OrdenEntrega;
  propia: boolean;
  procesando: boolean;
  respuesta: string;
  setRespuesta: (v: string) => void;
  onAprobar: () => void;
  onRechazar: () => void;
}> = ({ ajuste: a, orden: o, propia, procesando, respuesta, setRespuesta, onAprobar, onRechazar }) => {
  const codigos = Array.from(new Set([...Object.keys(a.original), ...Object.keys(a.propuesta)]));
  // Solo se aplica antes de cualquier entrega y con la orden activa; si no, solo se puede rechazar
  const aplicable = o.cantidadEntregada === 0 && ESTADOS_ACTIVOS_AJUSTE.includes(o.estado);
  return (
    <div className="border border-slate-200 rounded-lg p-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-800">
          {a.solicitadoPor} · {formatearFechaColombia(a.solicitadoEn)}
        </span>
        <span className="px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 font-semibold text-[10px]">
          {ETIQUETA_AJUSTE[a.estado]}
        </span>
      </div>
      <table className="w-full text-[11px]">
        <thead className="text-slate-500 text-left">
          <tr>
            <th className="py-1">Lote</th>
            <th className="py-1 text-right">Autorizado original</th>
            <th className="py-1 text-right">Propuesto</th>
          </tr>
        </thead>
        <tbody>
          {codigos.map((c) => (
            <tr key={c}>
              <td className="py-0.5 font-mono">{c}</td>
              <td className="py-0.5 text-right">{num(a.original[c]?.cantidad || 0)}</td>
              <td className="py-0.5 text-right font-semibold">{num(a.propuesta[c] || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-slate-600">Motivo: {a.motivo}</p>
      {a.respuesta && <p className="text-slate-600">Respuesta ({a.resueltoPor}): {a.respuesta}</p>}
      {a.estado === 'pendiente_aprobacion' &&
        (propia ? (
          <p className="text-amber-700">No puedes resolver una solicitud que hiciste tú.</p>
        ) : (
          <div className="space-y-1.5">
            {!aplicable && <p className="text-slate-500">La orden ya no admite ajustes (tiene entregas o está cerrada); solo puedes rechazarla.</p>}
            <input
              type="text"
              maxLength={1000}
              placeholder="Respuesta al repartidor (obligatoria para rechazar)"
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
            />
            <div className="flex flex-wrap gap-2">
              {aplicable && (
                <button
                  disabled={procesando}
                  onClick={onAprobar}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold disabled:opacity-50"
                >
                  Aprobar y aplicar
                </button>
              )}
              <button
                disabled={procesando}
                onClick={onRechazar}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg font-semibold disabled:opacity-50"
              >
                Rechazar
              </button>
            </div>
          </div>
        ))}
    </div>
  );
};
