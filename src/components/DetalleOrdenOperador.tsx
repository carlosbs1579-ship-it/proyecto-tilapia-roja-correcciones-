import React, { useState } from 'react';
import { Edit3, Send, History } from 'lucide-react';
import { InventarioLote, Lote, OrdenEntrega, UsuarioPerfil } from '../types';
import {
  ETIQUETA_ESTADO_ORDEN,
  Repartidor,
  TRANSICIONES_MANUALES,
  cambiarEstadoOrden,
  cambiarRepartidor,
  cantidadPendiente,
  confirmarBorrador,
  liberarSaldoYCerrar,
  redondear,
  reprogramarSaldo,
  saldoLote
} from '../services/pedidosService';
import { cambiosDeEvento, novedadesDeOrden } from '../services/seguimientoService';
import { formatearFechaColombia } from '../utils/constants';
import { ETIQUETA_FUNCION, EstadoOrdenBadge, num } from './entregasUi';
import { SolicitudAjusteTarjeta } from './SolicitudesPendientes';
import { NovedadTarjeta } from './NovedadesIncidencias';

type Ejecutar = (accion: () => Promise<void>, exito: string) => Promise<void>;

const Seccion: React.FC<{ titulo: string; children: React.ReactNode }> = ({ titulo, children }) => (
  <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
    <span className="font-bold text-slate-800 block">{titulo}</span>
    {children}
  </div>
);

/**
 * Vista completa de seguimiento de una orden para el operador: información general, control de
 * cantidades, distribución por lote y piscina, línea de tiempo, novedades, solicitudes y acciones.
 */
export const DetalleOrdenOperador: React.FC<{
  orden: OrdenEntrega;
  lotes: Lote[];
  inventario: Record<string, InventarioLote>;
  repartidores: Repartidor[];
  perfilActual: UsuarioPerfil | null;
  procesando: boolean;
  ejecutar: Ejecutar;
  onEditarBorrador: (orden: OrdenEntrega) => void;
}> = ({ orden: o, lotes, inventario, repartidores, perfilActual, procesando, ejecutar, onEditarBorrador }) => {
  const [motivo, setMotivo] = useState('');
  const [nuevoRepartidor, setNuevoRepartidor] = useState('');

  const transiciones = (TRANSICIONES_MANUALES[o.estado] || []).filter((e) => e !== 'cancelado');
  const puedeCancelar = (TRANSICIONES_MANUALES[o.estado] || []).includes('cancelado');
  const puedeCambiarRepartidor = ['borrador', 'asignado', 'en_preparacion', 'requiere_revision'].includes(o.estado);
  const cerrada = o.estado === 'entregado' || o.estado === 'cancelado';
  const noAutorizado = redondear(o.cantidadSolicitada - o.cantidadAutorizada, o.unidad);
  const faltantesRegistrados = o.historial.filter((e) => e.tipo === 'Entrega' && Number(e.datos?.faltante) > 0);
  const novedades = novedadesDeOrden(o);
  const ajustes = Object.values(o.ajustes || {}).sort((a, b) => b.solicitadoEn.localeCompare(a.solicitadoEn));

  const correr = (accion: () => Promise<void>, exito: string) =>
    ejecutar(accion, exito).then(() => {
      setMotivo('');
      setNuevoRepartidor('');
    });

  return (
    <div className="px-3 sm:px-5 pb-5 pt-2 space-y-3 bg-slate-50/60 text-xs">
      {/* A. Información general */}
      <Seccion titulo="Información general">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 text-slate-700">
          <span>Pedido: <strong className="font-mono">{o.id}</strong></span>
          <span>Cliente: <strong>{o.clienteNombre}</strong></span>
          <span>Dirección: <strong>{o.clienteDireccion || 'sin registrar'}</strong></span>
          <span>Contacto: <strong>{o.clienteContacto || '—'}</strong></span>
          <span>Creada: <strong>{formatearFechaColombia(o.creadoEn)}</strong></span>
          <span>Programada: <strong>{o.fechaProgramada || 'sin fecha'}</strong></span>
          <span>Creada por: <strong>{o.creadoPor}</strong></span>
          <span>Repartidor: <strong>{o.repartidorNombre || 'sin asignar'}</strong></span>
          <span>Unidad: <strong>{o.unidad}</strong></span>
          <span className="flex items-center gap-1">Estado: <EstadoOrdenBadge estado={o.estado} /></span>
          <span>Ruta iniciada: <strong>{o.rutaIniciadaEn ? formatearFechaColombia(o.rutaIniciadaEn) : '—'}</strong></span>
          <span>Llegada: <strong>{o.llegadaEn ? formatearFechaColombia(o.llegadaEn) : '—'}</strong></span>
        </div>
        {o.observaciones && <p className="text-slate-600">Observaciones: {o.observaciones}</p>}
      </Seccion>

      {/* B. Control de cantidades */}
      <Seccion titulo="Control de cantidades">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            ['Solicitada', o.cantidadSolicitada, 'lo que pidió el cliente'],
            ['Autorizada', o.cantidadAutorizada, o.estado === 'borrador' ? 'aún sin reservar' : 'reservada en los lotes'],
            ['Entregada', o.cantidadEntregada, 'confirmada por el repartidor'],
            ['Liberada', o.cantidadLiberada || 0, 'saldo devuelto al cerrar'],
            ['Pendiente', cantidadPendiente(o), 'por entregar o decidir']
          ].map(([t, v, ayuda]) => (
            <div key={t as string} className="bg-slate-50 border border-slate-200 rounded-lg p-2">
              <span className="text-[10px] text-slate-500 block">{t}</span>
              <strong className="text-sm text-slate-900">{num(v as number)} {o.unidad}</strong>
              <span className="block text-[10px] text-slate-400">{ayuda}</span>
            </div>
          ))}
        </div>
        {(noAutorizado > 0 || faltantesRegistrados.length > 0) && (
          <div className="text-slate-700 space-y-0.5">
            <span className="font-semibold">Diferencias registradas:</span>
            {noAutorizado > 0 && <p>· Solicitado sin autorizar: {num(noAutorizado)} {o.unidad} (no había disponibilidad o se distribuyó menos).</p>}
            {faltantesRegistrados.map((e) => (
              <p key={e.indice}>· Entrega del {formatearFechaColombia(e.fecha)}: faltaron {num(e.datos.faltante)} {o.unidad}{e.descripcion ? ` — ${e.descripcion}` : ''}.</p>
            ))}
          </div>
        )}
      </Seccion>

      {/* C. Distribución del pedido */}
      <Seccion titulo="Distribución del pedido (por lote y piscina)">
        {Object.keys(o.procedencias || {}).length === 0 ? (
          <p className="text-slate-500">Sin distribución por lotes todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px]">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 text-left">
                <tr>
                  <th className="px-3 py-1.5">Lote</th>
                  <th className="px-3 py-1.5">Piscina</th>
                  <th className="px-3 py-1.5 text-right">Autorizado</th>
                  <th className="px-3 py-1.5 text-right">Entregado</th>
                  <th className="px-3 py-1.5 text-right">Pendiente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(o.procedencias).map(([codigo, p]) => (
                  <tr key={codigo}>
                    <td className="px-3 py-1.5 font-mono font-bold">{codigo}</td>
                    <td className="px-3 py-1.5">{p.estanque}</td>
                    <td className="px-3 py-1.5 text-right">{num(p.cantidad)} {p.unidad}</td>
                    <td className="px-3 py-1.5 text-right">{num(o.entregadoPorLote?.[codigo] || 0)}</td>
                    <td className="px-3 py-1.5 text-right">{cerrada ? '—' : num(saldoLote(o, codigo))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {o.estado === 'borrador' && <p className="text-[10px] text-slate-500">Borrador: estas cantidades aún no están reservadas.</p>}
      </Seccion>

      {/* Novedades de la orden */}
      {novedades.length > 0 && (
        <Seccion titulo={`Novedades del repartidor (${novedades.length})`}>
          {novedades.map((n) => (
            <NovedadTarjeta key={n.evento.indice} novedad={n} procesando={procesando} ejecutar={ejecutar} />
          ))}
        </Seccion>
      )}

      {/* Solicitudes de ajuste de la orden */}
      {ajustes.length > 0 && (
        <Seccion titulo={`Solicitudes de ajuste (${ajustes.length})`}>
          {ajustes.map((a) => (
            <SolicitudAjusteTarjeta
              key={a.id}
              orden={o}
              ajuste={a}
              lotes={lotes}
              inventario={inventario}
              uidActual={perfilActual?.uid}
              procesando={procesando}
              ejecutar={ejecutar}
            />
          ))}
        </Seccion>
      )}

      {/* Acciones del operador */}
      <Seccion titulo="Acciones">
        {!cerrada && (
          <input
            type="text"
            placeholder="Motivo (obligatorio para cancelar, enviar a revisión, cambiar el repartidor o liberar el saldo)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        )}
        <div className="flex flex-wrap gap-2">
          {o.estado === 'borrador' && (
            <>
              <button
                disabled={procesando}
                onClick={() => onEditarBorrador(o)}
                className="inline-flex items-center space-x-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg font-semibold disabled:opacity-50"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Modificar borrador</span>
              </button>
              <button
                disabled={procesando}
                onClick={() => correr(() => confirmarBorrador(o.id), `Orden ${o.id} confirmada: cantidades reservadas.`)}
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
              onClick={() => correr(() => cambiarEstadoOrden(o.id, e, motivo), `Orden ${o.id}: ${ETIQUETA_ESTADO_ORDEN[e]}.`)}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold disabled:opacity-50"
            >
              Pasar a "{ETIQUETA_ESTADO_ORDEN[e]}"
            </button>
          ))}
          {puedeCancelar && (
            <button
              disabled={procesando}
              onClick={() =>
                correr(
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
            <select value={nuevoRepartidor} onChange={(e) => setNuevoRepartidor(e.target.value)} className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white">
              <option value="">Cambiar repartidor...</option>
              {repartidores.filter((r) => r.uid !== o.repartidorUid).map((r) => (
                <option key={r.uid} value={r.uid}>{r.nombre} — {r.cargo}</option>
              ))}
            </select>
            <button
              disabled={procesando || !nuevoRepartidor}
              onClick={() => {
                const r = repartidores.find((x) => x.uid === nuevoRepartidor);
                if (r) correr(() => cambiarRepartidor(o.id, r, motivo), `Repartidor de ${o.id}: ${r.nombre}.`);
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
              <select value={nuevoRepartidor} onChange={(e) => setNuevoRepartidor(e.target.value)} className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white">
                <option value="">Mismo repartidor ({o.repartidorNombre})</option>
                {repartidores.filter((r) => r.uid !== o.repartidorUid).map((r) => (
                  <option key={r.uid} value={r.uid}>{r.nombre} — {r.cargo}</option>
                ))}
              </select>
              <button
                disabled={procesando}
                onClick={() =>
                  correr(
                    () => reprogramarSaldo(o.id, motivo, repartidores.find((x) => x.uid === nuevoRepartidor) || null),
                    `Saldo de ${o.id} reprogramado: vuelve a asignado para una nueva ruta.`
                  )
                }
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-bold disabled:opacity-50"
              >
                Reprogramar entrega del saldo
              </button>
              <button
                disabled={procesando}
                onClick={() =>
                  correr(
                    () => liberarSaldoYCerrar(o.id, motivo),
                    `Orden ${o.id} cerrada: ${num(cantidadPendiente(o))} ${o.unidad} liberados y disponibles otra vez.`
                  )
                }
                className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg font-semibold disabled:opacity-50"
              >
                Liberar saldo y cerrar
              </button>
            </div>
          </div>
        )}
        {cerrada && <p className="text-slate-500">Esta orden está cerrada y no admite más cambios (sus novedades se pueden seguir atendiendo).</p>}
      </Seccion>

      {/* D. Seguimiento cronológico */}
      <Seccion titulo="Seguimiento cronológico">
        <ol className="relative border-l-2 border-sky-200 ml-2 space-y-2">
          {o.historial.map((ev) => (
            <li key={ev.indice} className="ml-3">
              <span className="absolute -left-[5px] mt-1 w-2 h-2 rounded-full bg-sky-500" />
              <span className="font-semibold text-slate-800">{ev.tipo}</span>
              <span className="text-slate-500">
                {' · ' + formatearFechaColombia(ev.fecha) + ' · ' + ev.registradoPor}
                {ev.funcion ? ' (' + (ETIQUETA_FUNCION[ev.funcion] || ev.funcion) + ')' : ''}
              </span>
              {(ev.descripcion || cambiosDeEvento(ev)) && (
                <span className="block text-slate-600">{[ev.descripcion, cambiosDeEvento(ev)].filter(Boolean).join(' · ')}</span>
              )}
            </li>
          ))}
        </ol>
        <p className="flex items-center space-x-1 text-[10px] text-slate-400">
          <History className="w-3 h-3" />
          <span>Construido con el historial real de la orden; los eventos no se modifican.</span>
        </p>
      </Seccion>
    </div>
  );
};
