import React, { useEffect, useMemo, useState } from 'react';
import { X, ClipboardList, AlertCircle, Save, Send, UserPlus } from 'lucide-react';
import { Cliente, InventarioLote, Lote, OrdenEntrega, UnidadMedida } from '../types';
import {
  MAX_LOTES_POR_ORDEN,
  Repartidor,
  actualizarBorrador,
  calcularDisponibilidad,
  crearCliente,
  crearOrden,
  redondear
} from '../services/pedidosService';
import { getFechaHoyBogota } from '../utils/constants';

interface NuevaOrdenModalProps {
  isOpen: boolean;
  onClose: () => void;
  granjaId: string;
  lotes: Lote[];
  inventario: Record<string, InventarioLote>;
  clientes: Cliente[];
  repartidores: Repartidor[];
  ordenEditar?: OrdenEntrega | null; // borrador a modificar
  onGuardada?: (mensaje: string) => void;
}

/**
 * Formulario para crear una orden de entrega (o modificar un borrador). La disponibilidad que muestra
 * es orientativa: al guardar, la transacción y las reglas de Firestore la vuelven a verificar.
 */
export const NuevaOrdenModal: React.FC<NuevaOrdenModalProps> = ({
  isOpen,
  onClose,
  granjaId,
  lotes,
  inventario,
  clientes,
  repartidores,
  ordenEditar,
  onGuardada
}) => {
  const [clienteId, setClienteId] = useState('');
  const [nuevoCliente, setNuevoCliente] = useState(false);
  const [nombreCliente, setNombreCliente] = useState('');
  const [contactoCliente, setContactoCliente] = useState('');
  const [unidad, setUnidad] = useState<UnidadMedida>('peces');
  const [cantidadSolicitada, setCantidadSolicitada] = useState<number | ''>('');
  const [fechaProgramada, setFechaProgramada] = useState('');
  const [cantidades, setCantidades] = useState<Record<string, number | ''>>({});
  const [repartidorUid, setRepartidorUid] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setNuevoCliente(false);
    setNombreCliente('');
    setContactoCliente('');
    if (ordenEditar) {
      setClienteId(ordenEditar.clienteId);
      setUnidad(ordenEditar.unidad);
      setCantidadSolicitada(ordenEditar.cantidadSolicitada);
      setFechaProgramada(ordenEditar.fechaProgramada || '');
      setCantidades(Object.fromEntries(Object.entries(ordenEditar.procedencias).map(([c, p]) => [c, p.cantidad])));
      setRepartidorUid(ordenEditar.repartidorUid || '');
      setObservaciones(ordenEditar.observaciones || '');
    } else {
      setClienteId('');
      setUnidad('peces');
      setCantidadSolicitada('');
      setFechaProgramada('');
      setCantidades({});
      setRepartidorUid('');
      setObservaciones('');
    }
  }, [isOpen, ordenEditar]);

  // Lotes con cosecha registrada en la unidad elegida (la única producción verificable)
  const lotesConCosecha = useMemo(
    () =>
      lotes
        .map((lote) => ({ lote, disp: calcularDisponibilidad(lote, inventario[lote.codigo], unidad) }))
        .filter(({ disp }) => disp.cosechado > 0),
    [lotes, inventario, unidad]
  );
  const lotesSinCosecha = lotes.length - lotesConCosecha.length;

  const lotesUsados = Object.entries(cantidades).filter(([, v]) => Number(v) > 0);
  const totalDistribuido = redondear(lotesUsados.reduce((s, [, v]) => s + Number(v), 0), unidad);
  const solicitada = Number(cantidadSolicitada) || 0;

  if (!isOpen) return null;

  const datosOrden = async () => {
    let cliente = clientes.find((c) => c.id === clienteId) || null;
    if (nuevoCliente) {
      cliente = await crearCliente(nombreCliente, contactoCliente, granjaId);
    }
    if (!cliente) throw new Error('Selecciona o registra el cliente.');
    const repartidor = repartidores.find((r) => r.uid === repartidorUid) || null;
    return {
      clienteId: cliente.id,
      clienteNombre: cliente.nombre,
      unidad,
      cantidadSolicitada: solicitada,
      fechaProgramada: fechaProgramada || null,
      cantidades: Object.fromEntries(lotesUsados.map(([c, v]) => [c, Number(v)])),
      repartidor,
      observaciones
    };
  };

  const guardar = async (confirmar: boolean) => {
    setErrorMsg(null);
    if (!(solicitada > 0)) {
      setErrorMsg('Indica la cantidad solicitada.');
      return;
    }
    if (totalDistribuido > solicitada) {
      setErrorMsg('La distribución por lotes supera la cantidad solicitada.');
      return;
    }
    if (lotesUsados.length > MAX_LOTES_POR_ORDEN) {
      setErrorMsg(`Una orden puede tomar cantidades de hasta ${MAX_LOTES_POR_ORDEN} lotes.`);
      return;
    }
    if (confirmar && !repartidorUid) {
      setErrorMsg('Asigna un repartidor para confirmar la orden.');
      return;
    }
    if (confirmar && lotesUsados.length === 0) {
      setErrorMsg('Distribuye la cantidad en al menos un lote.');
      return;
    }
    setGuardando(true);
    try {
      const datos = await datosOrden();
      if (ordenEditar) {
        await actualizarBorrador(ordenEditar.id, datos);
        onGuardada?.(`Borrador ${ordenEditar.id} actualizado.`);
      } else {
        const orden = await crearOrden(datos, confirmar, granjaId);
        onGuardada?.(
          confirmar
            ? `Orden ${orden.id} creada y asignada: ${orden.cantidadAutorizada} ${orden.unidad} reservados.`
            : `Borrador ${orden.id} guardado (sin reservas).`
        );
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'No fue posible guardar la orden.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[92vh] overflow-y-auto">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center space-x-2">
            <ClipboardList className="w-5 h-5 text-sky-400" />
            <h3 className="font-semibold text-base">
              {ordenEditar ? `Modificar borrador ${ordenEditar.id}` : 'Nueva orden de entrega'}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2 text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 1. Cliente */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold text-slate-700">1. Cliente *</label>
              <button
                type="button"
                onClick={() => setNuevoCliente(!nuevoCliente)}
                className="inline-flex items-center space-x-1 text-sky-600 hover:text-sky-800 font-medium"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{nuevoCliente ? 'Elegir un cliente existente' : 'Registrar cliente nuevo'}</span>
              </button>
            </div>
            {nuevoCliente ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  maxLength={120}
                  placeholder="Nombre del cliente o restaurante"
                  value={nombreCliente}
                  onChange={(e) => setNombreCliente(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <input
                  type="text"
                  maxLength={200}
                  placeholder="Contacto (teléfono, dirección) — opcional"
                  value={contactoCliente}
                  onChange={(e) => setContactoCliente(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            ) : (
              <select
                value={clienteId}
                onChange={(e) => setClienteId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="">{clientes.length ? 'Selecciona un cliente...' : 'Aún no hay clientes: registra uno nuevo'}</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                    {c.contacto ? ` — ${c.contacto}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 2. Cantidad y unidad */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">2. Unidad de medida *</label>
              <div className="flex rounded-lg border border-slate-300 p-0.5 bg-slate-50">
                {(['peces', 'kg'] as UnidadMedida[]).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => {
                      setUnidad(u);
                      setCantidades({});
                    }}
                    className={`flex-1 px-3 py-1.5 rounded-md font-semibold transition-colors ${
                      unidad === u ? 'bg-white shadow-xs text-sky-700' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {u === 'peces' ? 'Peces (unidades)' : 'Kilogramos'}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 mt-1">No se convierte entre peces y kg.</p>
            </div>
            <div>
              <label className="font-bold text-slate-700 block mb-1">Cantidad solicitada ({unidad}) *</label>
              <input
                type="number"
                min={0}
                step={unidad === 'peces' ? 1 : 0.01}
                value={cantidadSolicitada}
                onChange={(e) => setCantidadSolicitada(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="font-bold text-slate-700 block mb-1">Fecha programada de entrega</label>
              <input
                type="date"
                min={getFechaHoyBogota()}
                value={fechaProgramada}
                onChange={(e) => setFechaProgramada(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* 3. Distribución por lote y piscina */}
          <div>
            <label className="font-bold text-slate-700 block mb-1">
              3. Distribución por lote y piscina (hasta {MAX_LOTES_POR_ORDEN} lotes)
            </label>
            <p className="text-[10px] text-slate-400 mb-2">
              Disponible = cosecha registrada − reservado − entregado. Cada lote pertenece a una piscina; la procedencia se conserva por lote.
            </p>
            {lotesConCosecha.length === 0 ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900">
                Ningún lote tiene cosecha registrada en {unidad}. Registra un evento de Cosecha en el lote para poder reservar.
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Lote</th>
                      <th className="px-3 py-2">Piscina</th>
                      <th className="px-3 py-2 text-right">Cosechado</th>
                      <th className="px-3 py-2 text-right">Reservado</th>
                      <th className="px-3 py-2 text-right">Disponible</th>
                      <th className="px-3 py-2 text-right">Tomar ({unidad})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lotesConCosecha.map(({ lote, disp }) => {
                      const valor = cantidades[lote.codigo] ?? '';
                      const excede = Number(valor) > disp.disponible;
                      const bloqueado = !disp.compatible || disp.disponible <= 0;
                      return (
                        <tr key={lote.codigo} className={bloqueado ? 'bg-slate-50 text-slate-400' : ''}>
                          <td className="px-3 py-2 font-mono font-bold">
                            {lote.codigo}
                            <span className="ml-1 text-[10px] font-sans font-normal text-slate-400">
                              {lote.estado === 'cerrado' ? 'sellado' : 'activo'}
                            </span>
                          </td>
                          <td className="px-3 py-2">{lote.estanque}</td>
                          <td className="px-3 py-2 text-right">{disp.cosechado.toLocaleString('es-CO')}</td>
                          <td className="px-3 py-2 text-right">{disp.reservado.toLocaleString('es-CO')}</td>
                          <td className="px-3 py-2 text-right font-bold text-emerald-700">
                            {disp.compatible ? disp.disponible.toLocaleString('es-CO') : `Reservado en ${disp.unidadInventario}`}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              min={0}
                              max={disp.disponible}
                              step={unidad === 'peces' ? 1 : 0.01}
                              disabled={bloqueado && !valor}
                              value={valor}
                              onChange={(e) =>
                                setCantidades((prev) => ({
                                  ...prev,
                                  [lote.codigo]: e.target.value === '' ? '' : Number(e.target.value)
                                }))
                              }
                              className={`w-24 px-2 py-1 border rounded text-right focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                                excede ? 'border-red-400 bg-red-50' : 'border-slate-300'
                              }`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className={totalDistribuido > solicitada ? 'text-red-600 font-bold' : 'text-slate-600'}>
                Distribuido: <strong>{totalDistribuido.toLocaleString('es-CO')}</strong> de{' '}
                {solicitada.toLocaleString('es-CO')} {unidad} solicitados
                {solicitada > 0 && totalDistribuido < solicitada && ' (lo autorizado será menor que lo solicitado)'}
              </span>
              {lotesSinCosecha > 0 && (
                <span className="text-[10px] text-slate-400">
                  {lotesSinCosecha} lote(s) sin cosecha registrada en {unidad} no se muestran.
                </span>
              )}
            </div>
          </div>

          {/* 4. Repartidor */}
          <div>
            <label className="font-bold text-slate-700 block mb-1">4. Repartidor asignado</label>
            <select
              value={repartidorUid}
              onChange={(e) => setRepartidorUid(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="">
                {repartidores.length ? 'Sin asignar (solo para borrador)' : 'No hay repartidores activos en la granja'}
              </option>
              {repartidores.map((r) => (
                <option key={r.uid} value={r.uid}>
                  {r.nombre} — {r.cargo}
                </option>
              ))}
            </select>
          </div>

          {/* 5. Observaciones */}
          <div>
            <label className="font-bold text-slate-700 block mb-1">5. Observaciones</label>
            <textarea
              rows={2}
              maxLength={1000}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => guardar(false)}
              disabled={guardando}
              className="inline-flex items-center justify-center space-x-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-lg font-semibold disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{ordenEditar ? 'Guardar cambios del borrador' : 'Guardar como borrador'}</span>
            </button>
            {!ordenEditar && (
              <button
                type="button"
                onClick={() => guardar(true)}
                disabled={guardando}
                className="inline-flex items-center justify-center space-x-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-bold shadow-xs disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>{guardando ? 'Reservando...' : 'Guardar, reservar y asignar'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
