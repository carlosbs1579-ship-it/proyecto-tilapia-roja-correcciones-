import React, { useEffect, useState } from 'react';
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
  horaServidorEvento,
  liberarSaldoYCerrar,
  RevisionHistorialOrden,
  verificarHistorialOrden,
  redondear,
  reprogramarSaldo,
  saldoLote
} from '../services/pedidosService';
import { cambiosDeEvento, novedadesDeOrden } from '../services/seguimientoService';
import { formatearFechaColombia } from '../utils/constants';
import { ETIQUETA_FUNCION, EstadoOrdenBadge, num } from './entregasUi';
import { SolicitudAjusteTarjeta } from './SolicitudesPendientes';
import { NovedadTarjeta } from './NovedadesIncidencias';
import { DocumentacionEntrega } from './DocumentacionEntrega';
import { verificarPermiso, quienRegistro } from '../services/usuariosService';
import { FotosEntregaOrden } from './FotosEntregaOrden';
import { CorreccionEntrega } from './CorreccionEntrega';
import { AvisoIntegridad, IndicadorVerificado } from './AvisoIntegridad';

type Ejecutar = (accion: () => Promise<void>, exito: string) => Promise<void>;

const Seccion: React.FC<{ titulo: string; children: React.ReactNode }> = ({ titulo, children }) => (
  <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
    <span className="font-semibold text-slate-800 block">{titulo}</span>
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
  // Permisos de la pestaña Entregas
  const puedeGestionar = verificarPermiso(perfilActual, 'gestionarPedidos');
  const puedeSaldos = verificarPermiso(perfilActual, 'decidirSaldos');
  const puedeComprobantes = verificarPermiso(perfilActual, 'gestionarComprobantes');
  const puedeNovedades = verificarPermiso(perfilActual, 'atenderNovedades');
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

  // Cadena del historial (H14): se verifica sola al abrir la orden y cada vez que cambia
  const [revisionHistorial, setRevisionHistorial] = useState<RevisionHistorialOrden | null>(null);
  useEffect(() => {
    let activo = true;
    verificarHistorialOrden(o.historial, o.registradoEnServidor)
      .then((r) => activo && setRevisionHistorial(r))
      .catch(() => activo && setRevisionHistorial(null));
    return () => {
      activo = false;
    };
  }, [o.historial, o.registradoEnServidor]);

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
          <span>Contacto: <strong>{o.clienteContacto || 'Sin dato'}</strong></span>
          <span>Creada: <strong>{formatearFechaColombia(o.creadoEn)}</strong></span>
          <span>Programada: <strong>{o.fechaProgramada || 'sin fecha'}</strong></span>
          <span>Creada por: <strong>{o.creadoPor}</strong></span>
          <span>Repartidor: <strong>{o.repartidorNombre || 'sin asignar'}</strong></span>
          <span>Unidad: <strong>{o.unidad}</strong></span>
          <span className="flex items-center gap-1">Estado: <EstadoOrdenBadge estado={o.estado} /></span>
          <span>Ruta iniciada: <strong>{o.rutaIniciadaEn ? formatearFechaColombia(o.rutaIniciadaEn) : 'Sin dato'}</strong></span>
          <span>Llegada: <strong>{o.llegadaEn ? formatearFechaColombia(o.llegadaEn) : 'Sin dato'}</strong></span>
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
              <span className="text-xs text-slate-500 block">{t}</span>
              <strong className="text-sm text-slate-900">{num(v as number)} {o.unidad}</strong>
              <span className="block text-xs text-slate-500">{ayuda}</span>
            </div>
          ))}
        </div>
        {(noAutorizado > 0 || faltantesRegistrados.length > 0) && (
          <div className="text-slate-700 space-y-1">
            <span className="font-semibold">Diferencias registradas:</span>
            {noAutorizado > 0 && <p>· Solicitado sin autorizar: {num(noAutorizado)} {o.unidad} (no había disponibilidad o se distribuyó menos).</p>}
            {faltantesRegistrados.map((e) => (
              <p key={e.indice}>· Entrega del {formatearFechaColombia(e.fecha)}: faltaron {num(e.datos.faltante)} {o.unidad}{e.descripcion ? ` · ${e.descripcion}` : ''}.</p>
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
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 text-left">
                <tr>
                  <th className="px-3 py-2">Lote</th>
                  <th className="px-3 py-2">Piscina</th>
                  <th className="px-3 py-2 text-right">Autorizado</th>
                  <th className="px-3 py-2 text-right">Entregado</th>
                  <th className="px-3 py-2 text-right">Pendiente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(o.procedencias).map(([codigo, p]) => (
                  <tr key={codigo}>
                    <td className="px-3 py-2 font-mono font-semibold">{codigo}</td>
                    <td className="px-3 py-2">{p.estanque}</td>
                    <td className="px-3 py-2 text-right">{num(p.cantidad)} {p.unidad}</td>
                    <td className="px-3 py-2 text-right">{num(o.entregadoPorLote?.[codigo] || 0)}</td>
                    <td className="px-3 py-2 text-right">{cerrada ? 'Sin dato' : num(saldoLote(o, codigo))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {o.estado === 'borrador' && <p className="text-xs text-slate-500">Borrador: estas cantidades aún no están reservadas.</p>}
      </Seccion>

      {/* Novedades de la orden */}
      {novedades.length > 0 && puedeNovedades && (
        <Seccion titulo={`Novedades del repartidor (${novedades.length})`}>
          {novedades.map((n) => (
            <NovedadTarjeta key={n.evento.indice} novedad={n} procesando={procesando} ejecutar={ejecutar} />
          ))}
        </Seccion>
      )}

      {/* Solicitudes de ajuste de la orden */}
      {ajustes.length > 0 && puedeNovedades && (
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

      {/* Acciones del operador (las generales requieren "Crear y asignar órdenes") */}
      {(puedeGestionar || puedeSaldos) && (
      <Seccion titulo="Acciones">
        {!cerrada && (puedeGestionar || puedeSaldos) && (
          <input
            type="text"
            placeholder="Motivo (obligatorio para cancelar, enviar a revisión, cambiar el repartidor o liberar el saldo)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        )}
        {!cerrada && (puedeGestionar || puedeSaldos) && !motivo.trim() && (
          <p className="text-xs text-amber-800">
            Escribe el motivo arriba para habilitar: cancelar, enviar a revisión, cambiar el repartidor o liberar el saldo.
          </p>
        )}
        <div className={`flex flex-wrap gap-2 ${puedeGestionar ? "" : "hidden"}`}>
          {o.estado === 'borrador' && (
            <>
              <button
                disabled={procesando}
                onClick={() => onEditarBorrador(o)}
                className="inline-flex items-center space-x-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg font-semibold disabled:opacity-50"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Modificar borrador</span>
              </button>
              <button
                disabled={procesando}
                onClick={() => correr(() => confirmarBorrador(o.id), `Orden ${o.id} confirmada: cantidades reservadas.`)}
                className="inline-flex items-center space-x-1 px-3 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Confirmar, reservar y asignar</span>
              </button>
            </>
          )}
          {transiciones.map((e) => (
            <button
              key={e}
              disabled={procesando || (e === 'requiere_revision' && !motivo.trim())}
              title={e === 'requiere_revision' && !motivo.trim() ? 'Escribe el motivo en el campo Motivo.' : undefined}
              onClick={() => correr(() => cambiarEstadoOrden(o.id, e, motivo), `Orden ${o.id}: ${ETIQUETA_ESTADO_ORDEN[e]}.`)}
              className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold disabled:opacity-50"
            >
              Pasar a "{ETIQUETA_ESTADO_ORDEN[e]}"
            </button>
          ))}
          {puedeCancelar && (
            <button
              disabled={procesando || !motivo.trim()}
              title={!motivo.trim() ? 'Escribe el motivo de la cancelación en el campo Motivo.' : undefined}
              onClick={() =>
                correr(
                  () => cambiarEstadoOrden(o.id, 'cancelado', motivo),
                  o.estado === 'borrador'
                    ? `Borrador ${o.id} cancelado.`
                    : `Orden ${o.id} cancelada: ${num(cantidadPendiente(o))} ${o.unidad} liberados.`
                )
              }
              className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg font-semibold disabled:opacity-50"
            >
              Cancelar orden{o.estado !== 'borrador' ? ' y liberar reserva' : ''}
            </button>
          )}
        </div>

        {puedeCambiarRepartidor && puedeGestionar && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={nuevoRepartidor} onChange={(e) => setNuevoRepartidor(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg bg-white">
              <option value="">Cambiar repartidor...</option>
              {repartidores.filter((r) => r.uid !== o.repartidorUid).map((r) => (
                <option key={r.uid} value={r.uid}>{r.nombre} · {r.cargo}</option>
              ))}
            </select>
            <button
              disabled={procesando || !nuevoRepartidor || (o.estado !== 'borrador' && !motivo.trim())}
              title={o.estado !== 'borrador' && !motivo.trim() ? 'Escribe el motivo del cambio en el campo Motivo.' : undefined}
              onClick={() => {
                const r = repartidores.find((x) => x.uid === nuevoRepartidor);
                if (r) correr(() => cambiarRepartidor(o.id, r, motivo), `Repartidor de ${o.id}: ${r.nombre}.`);
              }}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg font-semibold disabled:opacity-50"
            >
              Asignar
            </button>
          </div>
        )}

        {o.estado === 'entrega_parcial' && puedeSaldos && (
          <div className="space-y-2 border-t border-slate-100 pt-2">
            <p className="text-amber-800">
              Entrega parcial: faltan <strong>{num(cantidadPendiente(o))} {o.unidad}</strong>. Decide cómo continuar:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={nuevoRepartidor} onChange={(e) => setNuevoRepartidor(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg bg-white">
                <option value="">Mismo repartidor ({o.repartidorNombre})</option>
                {repartidores.filter((r) => r.uid !== o.repartidorUid).map((r) => (
                  <option key={r.uid} value={r.uid}>{r.nombre} · {r.cargo}</option>
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
                className="px-3 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                Reprogramar entrega del saldo
              </button>
              <button
                disabled={procesando || !motivo.trim()}
                title={!motivo.trim() ? 'Escribe el motivo en el campo Motivo para liberar el saldo.' : undefined}
                onClick={() =>
                  correr(
                    () => liberarSaldoYCerrar(o.id, motivo),
                    `Orden ${o.id} cerrada: ${num(cantidadPendiente(o))} ${o.unidad} liberados y disponibles otra vez.`
                  )
                }
                className="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg font-semibold disabled:opacity-50"
              >
                Liberar saldo y cerrar
              </button>
            </div>
          </div>
        )}
        {cerrada && (
          <p className="text-slate-500">
            Esta orden está cerrada: no admite cambios de estado ni de repartidor (sus novedades se pueden seguir atendiendo y, si la entrega quedó mal registrada, se puede corregir).
          </p>
        )}
        {puedeSaldos && <CorreccionEntrega orden={o} procesando={procesando} ejecutar={ejecutar} />}
      </Seccion>
      )}

      {/* Fotos de las entregas (solo operador; se borran a los 15 días) */}
      {o.historial.some((e) => e.tipo === 'Entrega' && e.datos?.foto?.id) && (
        <Seccion titulo="Fotos de entrega">
          <FotosEntregaOrden orden={o} />
        </Seccion>
      )}

      {/* Comprobantes de entrega (fase 5) */}
      {o.estado !== 'borrador' && (
        <Seccion titulo="Documentación de entrega">
          <DocumentacionEntrega orden={o} uidActual={perfilActual?.uid} procesando={procesando} ejecutar={ejecutar} puedeEmitir={puedeComprobantes} />
        </Seccion>
      )}

      {/* D. Seguimiento cronológico */}
      <Seccion titulo="Seguimiento cronológico">
        {revisionHistorial?.estado === 'verificado' && <IndicadorVerificado texto={revisionHistorial.mensaje} />}
        {revisionHistorial?.estado === 'alterado' && (
          <AvisoIntegridad
            estado="alterado"
            avisos={[revisionHistorial.mensaje]}
            nota="Los eventos del historial no se pueden modificar desde la plataforma: alguien los cambió directamente en la base de datos."
          />
        )}
        {revisionHistorial?.estado === 'no_verificable' && <AvisoIntegridad estado="no_verificable" avisos={[revisionHistorial.mensaje]} />}
        {revisionHistorial?.estado === 'sin_cadena' && <p className="text-xs text-slate-500">{revisionHistorial.mensaje}</p>}
        <ol className="relative border-l-2 border-sky-200 ml-2 space-y-2">
          {o.historial.map((ev, i) => {
            const hora = horaServidorEvento(o, ev);
            const alterado = revisionHistorial?.alteracion?.indice === i;
            const anterior = Boolean(revisionHistorial && revisionHistorial.anteriores > 0 && i < revisionHistorial.anteriores && revisionHistorial.encadenados > 0);
            return (
              <li key={ev.indice} className="ml-3">
                <span className={`absolute -left-[5px] mt-1 w-2 h-2 rounded-full ${alterado ? 'bg-red-600' : 'bg-sky-500'}`} />
                <span className={`font-semibold ${alterado ? 'text-red-700' : 'text-slate-800'}`}>{ev.tipo}</span>
                <span className="text-slate-500">
                  {' · ' + formatearFechaColombia(ev.fecha) + ' · ' + quienRegistro(ev)}
                  {ev.funcion ? ' (' + (ETIQUETA_FUNCION[ev.funcion] || ev.funcion) + ')' : ''}
                </span>
                {(ev.descripcion || cambiosDeEvento(ev)) && (
                  <span className="block text-slate-600">{[ev.descripcion, cambiosDeEvento(ev)].filter(Boolean).join(' · ')}</span>
                )}
                {hora.servidor && (
                  <span className={`block text-xs ${hora.desfase ? 'text-amber-800' : 'text-slate-500'}`}>
                    Hora del servidor: {formatearFechaColombia(hora.servidor.toISOString())}
                    {hora.desfase && ' · la hora declarada por el equipo difiere en más de 10 minutos'}
                    {!hora.desfase && hora.sinConexion && ' · registrado sin conexión en el teléfono y enviado después'}
                  </span>
                )}
                {anterior && <span className="block text-xs text-slate-500">Registro anterior a la cadena</span>}
              </li>
            );
          })}
        </ol>
        <p className="flex items-center space-x-1 text-xs text-slate-500">
          <History className="w-3 h-3" />
          <span>Construido con el historial real de la orden; los eventos no se modifican.</span>
        </p>
      </Seccion>
    </div>
  );
};
