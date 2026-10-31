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
  Search,
  Bell,
  Truck,
  Repeat,
  AlertTriangle,
  History,
  ListChecks
} from 'lucide-react';
import { Cliente, EstadoOrden, InventarioLote, Lote, OrdenEntrega, UsuarioPerfil } from '../types';
import {
  ETIQUETA_ESTADO_ORDEN,
  Repartidor,
  calcularDisponibilidad,
  cantidadPendiente,
  escucharClientes,
  escucharInventario,
  escucharOrdenes,
  escucharRepartidores
} from '../services/pedidosService';
import { verificarPermiso } from '../services/usuariosService';
import {
  DEFINICION_INDICADOR,
  ETIQUETA_ALERTA,
  Indicador,
  TipoAlerta,
  calcularAlertas,
  cumpleIndicador,
  diaBogota,
  todasLasNovedades,
  todasLasSolicitudes
} from '../services/seguimientoService';
import { formatearFechaColombia } from '../utils/constants';
import { NuevaOrdenModal } from './NuevaOrdenModal';
import { DetalleOrdenOperador } from './DetalleOrdenOperador';
import { SupervisionRepartidores } from './SupervisionRepartidores';
import { SolicitudesPendientes } from './SolicitudesPendientes';
import { NovedadesIncidencias } from './NovedadesIncidencias';
import { HistorialEntregas } from './HistorialEntregas';
import { EstadoOrdenBadge, num } from './entregasUi';

interface PedidosTabProps {
  lotes: Lote[];
  perfilActual: UsuarioPerfil | null;
}

type Vista = 'pedidos' | 'repartidores' | 'solicitudes' | 'novedades' | 'historial' | 'lotes';

const INDICADORES: Indicador[] = ['total', 'pendientes', 'asignados', 'en_preparacion', 'en_ruta', 'entrega_parcial', 'entregados', 'atencion'];

const ESTILO_ALERTA: Record<TipoAlerta, string> = {
  sin_iniciar_ruta: 'border-sky-200 bg-sky-50 text-sky-900',
  retraso: 'border-red-200 bg-red-50 text-red-800',
  entrega_parcial: 'border-amber-200 bg-amber-50 text-amber-900',
  requiere_revision: 'border-orange-200 bg-orange-50 text-orange-900',
  ajuste_pendiente: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  novedad_abierta: 'border-orange-200 bg-orange-50 text-orange-900',
  conflicto_disponibilidad: 'border-red-300 bg-red-50 text-red-800'
};

/**
 * Gestión de entregas: vista central del operador para crear y supervisar las órdenes de entrega
 * de su granja, con indicadores, alertas, seguimiento por repartidor, solicitudes de ajuste,
 * novedades e historial. Todo se calcula con los datos de Firebase en tiempo real.
 */
export const PedidosTab: React.FC<PedidosTabProps> = ({ lotes, perfilActual }) => {
  const puedeGestionar = verificarPermiso(perfilActual, 'gestionarPedidos');
  const granjaId = perfilActual?.granjaId || 'cultivos-lore';

  const [vista, setVista] = useState<Vista>('pedidos');
  const [ordenes, setOrdenes] = useState<OrdenEntrega[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [inventario, setInventario] = useState<Record<string, InventarioLote>>({});
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [ordenEditar, setOrdenEditar] = useState<OrdenEntrega | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [verAlertas, setVerAlertas] = useState(false);

  // Filtros del listado
  const [indicador, setIndicador] = useState<Indicador>('total');
  const [filtroEstado, setFiltroEstado] = useState<'' | EstadoOrden>('');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroRepartidor, setFiltroRepartidor] = useState('');
  const [campoFecha, setCampoFecha] = useState<'creacion' | 'programada'>('creacion');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [busqueda, setBusqueda] = useState('');

  // Una sola suscripción por colección mientras la pestaña está abierta; se cancelan al salir
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

  const alertas = useMemo(() => calcularAlertas(ordenes, lotes, inventario), [ordenes, lotes, inventario]);
  const ordenesConAlerta = useMemo(() => new Set(alertas.map((a) => a.ordenId).filter(Boolean) as string[]), [alertas]);
  const solicitudesPendientes = useMemo(() => todasLasSolicitudes(ordenes).filter((s) => s.ajuste.estado === 'pendiente_aprobacion').length, [ordenes]);
  const novedadesAbiertas = useMemo(() => todasLasNovedades(ordenes).filter((n) => n.atencion === 'pendiente' || n.atencion === 'en_revision').length, [ordenes]);

  const clientesEnOrdenes = useMemo(() => Array.from(new Set(ordenes.map((o) => o.clienteNombre))).sort(), [ordenes]);
  const repartidoresEnOrdenes = useMemo(
    () => Array.from(new Map(ordenes.filter((o) => o.repartidorUid).map((o) => [o.repartidorUid as string, o.repartidorNombre || ''])).entries()),
    [ordenes]
  );

  const ordenesFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return ordenes.filter((o) => {
      const fecha = campoFecha === 'creacion' ? diaBogota(o.creadoEn) : o.fechaProgramada || '';
      return cumpleIndicador(o, indicador, ordenesConAlerta)
        && (!filtroEstado || o.estado === filtroEstado)
        && (!filtroCliente || o.clienteNombre === filtroCliente)
        && (!filtroRepartidor || o.repartidorUid === filtroRepartidor)
        && (!desde || (fecha && fecha >= desde))
        && (!hasta || (fecha && fecha <= hasta))
        && (!q || o.id.toLowerCase().includes(q) || o.clienteNombre.toLowerCase().includes(q));
    });
  }, [ordenes, indicador, ordenesConAlerta, filtroEstado, filtroCliente, filtroRepartidor, campoFecha, desde, hasta, busqueda]);

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
          <p className="font-bold text-sm text-slate-900">Gestión de entregas restringida</p>
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
    } catch (err: any) {
      setErrorAccion(err.message || 'No fue posible completar la acción.');
      throw err;
    } finally {
      setProcesando(false);
    }
  };
  // Las secciones esperan una promesa que no rechace: el error ya queda en pantalla
  const ejecutarSeguro = (accion: () => Promise<void>, exito: string) => ejecutar(accion, exito).catch(() => undefined);

  const abrirOrden = (id: string) => {
    setVista('pedidos');
    setIndicador('total');
    setFiltroEstado('');
    setFiltroCliente('');
    setFiltroRepartidor('');
    setDesde('');
    setHasta('');
    setBusqueda('');
    setAbierta(id);
    setErrorAccion(null);
  };

  const pestañas: { id: Vista; etiqueta: string; icono: React.ReactNode; contador?: number }[] = [
    { id: 'pedidos', etiqueta: 'Pedidos', icono: <ListChecks className="w-3.5 h-3.5" />, contador: ordenes.length },
    { id: 'repartidores', etiqueta: 'Repartidores', icono: <Truck className="w-3.5 h-3.5" /> },
    { id: 'solicitudes', etiqueta: 'Solicitudes', icono: <Repeat className="w-3.5 h-3.5" />, contador: solicitudesPendientes },
    { id: 'novedades', etiqueta: 'Novedades', icono: <AlertTriangle className="w-3.5 h-3.5" />, contador: novedadesAbiertas },
    { id: 'historial', etiqueta: 'Historial', icono: <History className="w-3.5 h-3.5" /> },
    { id: 'lotes', etiqueta: 'Disponibilidad por lote', icono: <Layers className="w-3.5 h-3.5" /> }
  ];
  const campo = 'px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white text-xs';

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <ClipboardList className="w-5 h-5 text-sky-600" />
            <span>Gestión de entregas</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Órdenes de entrega de la granja, avance de los repartidores, solicitudes, novedades e historial (en tiempo real)
          </p>
        </div>
        <button
          onClick={() => {
            setOrdenEditar(null);
            setModalAbierto(true);
          }}
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

      {/* Indicadores (registros reales de Firebase) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {INDICADORES.map((id) => {
          const cantidad = ordenes.filter((o) => cumpleIndicador(o, id, ordenesConAlerta)).length;
          const activo = vista === 'pedidos' && indicador === id;
          return (
            <button
              key={id}
              title={DEFINICION_INDICADOR[id].ayuda}
              onClick={() => {
                setVista('pedidos');
                setIndicador(id);
                setFiltroEstado('');
              }}
              className={'bg-white border rounded-xl p-3 text-left ' +
                (activo ? 'border-sky-500 ring-2 ring-sky-200' : id === 'atencion' && cantidad > 0 ? 'border-orange-300' : 'border-slate-200')}
            >
              <span className="block text-slate-500">{DEFINICION_INDICADOR[id].etiqueta}</span>
              <strong className={`text-lg ${id === 'atencion' && cantidad > 0 ? 'text-orange-700' : 'text-slate-900'}`}>{cargando ? '…' : cantidad}</strong>
            </button>
          );
        })}
      </div>

      {/* Alertas operativas */}
      {alertas.length > 0 && (
        <div className="bg-white border border-orange-200 rounded-xl p-3 text-xs space-y-2">
          <button onClick={() => setVerAlertas(!verAlertas)} className="w-full flex items-center justify-between">
            <span className="flex items-center space-x-1.5 font-bold text-orange-900">
              <Bell className="w-4 h-4" />
              <span>{alertas.length} alerta(s) operativa(s)</span>
              <span className="font-normal text-slate-500">
                · {Array.from(new Set(alertas.map((a) => a.tipo))).map((t) => `${ETIQUETA_ALERTA[t]} (${alertas.filter((a) => a.tipo === t).length})`).join(' · ')}
              </span>
            </span>
            {verAlertas ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {verAlertas && (
            <div className="space-y-1">
              {alertas.map((a) => (
                <div key={a.id} className={`border rounded-lg px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 ${ESTILO_ALERTA[a.tipo]}`}>
                  <span>
                    <strong>{ETIQUETA_ALERTA[a.tipo]}</strong>
                    {a.ordenId && <span className="font-mono"> · {a.ordenId}</span>}
                    <span> · {a.detalle}</span>
                  </span>
                  {a.ordenId ? (
                    <button onClick={() => abrirOrden(a.ordenId!)} className="font-semibold underline">Ver pedido</button>
                  ) : (
                    <button onClick={() => setVista('lotes')} className="font-semibold underline">Ver lote</button>
                  )}
                </div>
              ))}
              <p className="text-[10px] text-slate-500">
                Las alertas se calculan con condiciones verificables (sin fecha programada no se marca retraso). Al resolverse
                desaparecen; lo ocurrido queda en el historial de cada pedido.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Secciones */}
      <div className="flex flex-wrap gap-1 text-xs">
        {pestañas.map((p) => (
          <button
            key={p.id}
            onClick={() => setVista(p.id)}
            className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-medium border ${
              vista === p.id ? 'bg-slate-900 text-white border-slate-900 font-bold' : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
            }`}
          >
            {p.icono}
            <span>{p.etiqueta}</span>
            {p.contador !== undefined && p.contador > 0 && (
              <span className={`px-1.5 rounded-full text-[10px] ${vista === p.id ? 'bg-white/20' : 'bg-slate-100'}`}>{p.contador}</span>
            )}
          </button>
        ))}
      </div>

      {vista === 'pedidos' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="px-4 py-3 border-b border-slate-100 space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-slate-800">{DEFINICION_INDICADOR[indicador].etiqueta}</span>
              {indicador !== 'total' && (
                <button onClick={() => setIndicador('total')} className="text-sky-700 underline">ver todos</button>
              )}
              <span className="text-slate-500">· {ordenesFiltradas.length} pedido(s)</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
              <label className="relative col-span-2 md:col-span-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input className={campo + ' w-full pl-8'} placeholder="Pedido o cliente" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
              </label>
              <select className={campo} value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as any)}>
                <option value="">Todos los estados</option>
                {(Object.keys(ETIQUETA_ESTADO_ORDEN) as EstadoOrden[]).map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO_ORDEN[e]}</option>)}
              </select>
              <select className={campo} value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)}>
                <option value="">Todos los clientes</option>
                {clientesEnOrdenes.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className={campo} value={filtroRepartidor} onChange={(e) => setFiltroRepartidor(e.target.value)}>
                <option value="">Todos los repartidores</option>
                {repartidoresEnOrdenes.map(([uid, nombre]) => <option key={uid} value={uid}>{nombre}</option>)}
              </select>
              <select className={campo} value={campoFecha} onChange={(e) => setCampoFecha(e.target.value as any)}>
                <option value="creacion">Fecha de creación</option>
                <option value="programada">Fecha programada</option>
              </select>
              <input type="date" className={campo} value={desde} onChange={(e) => setDesde(e.target.value)} title="Desde" />
              <input type="date" className={campo} value={hasta} onChange={(e) => setHasta(e.target.value)} title="Hasta" />
            </div>
          </div>

          {cargando ? (
            <div className="py-10 text-center text-xs text-slate-500">Cargando órdenes...</div>
          ) : ordenesFiltradas.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">No hay pedidos con estos filtros.</div>
          ) : (
            <div className="text-xs">
              {/* Encabezado (pantallas medianas en adelante) */}
              <div className="hidden xl:grid grid-cols-[1.3fr_1.3fr_0.9fr_0.8fr_1fr_repeat(4,0.7fr)_1fr_0.2fr] gap-2 px-4 py-2 bg-slate-50 text-[10px] uppercase text-slate-500 font-semibold">
                <span>Pedido</span>
                <span>Cliente</span>
                <span>Creación</span>
                <span>Programada</span>
                <span>Repartidor</span>
                <span className="text-right">Solicitada</span>
                <span className="text-right">Autorizada</span>
                <span className="text-right">Entregada</span>
                <span className="text-right">Pendiente</span>
                <span>Estado</span>
                <span />
              </div>
              <div className="divide-y divide-slate-100">
                {ordenesFiltradas.map((o) => {
                  const expandida = abierta === o.id;
                  return (
                    <div key={o.id}>
                      <button
                        onClick={() => {
                          setAbierta(expandida ? null : o.id);
                          setErrorAccion(null);
                        }}
                        className="w-full px-4 py-3 grid grid-cols-2 xl:grid-cols-[1.3fr_1.3fr_0.9fr_0.8fr_1fr_repeat(4,0.7fr)_1fr_0.2fr] gap-x-2 gap-y-1 items-center text-left hover:bg-slate-50"
                      >
                        <span className="font-mono font-bold text-slate-900">
                          {o.id}
                          {ordenesConAlerta.has(o.id) && <Bell className="inline w-3 h-3 ml-1 text-orange-500" />}
                        </span>
                        <span className="text-slate-700 truncate">{o.clienteNombre}</span>
                        <span className="text-slate-500"><span className="xl:hidden">Creada </span>{formatearFechaColombia(o.creadoEn)}</span>
                        <span className="text-slate-500"><span className="xl:hidden">Programada </span>{o.fechaProgramada || '—'}</span>
                        <span className="text-slate-600 truncate">{o.repartidorNombre || 'Sin repartidor'}</span>
                        <span className="xl:text-right"><span className="xl:hidden text-slate-400">Solic. </span>{num(o.cantidadSolicitada)}</span>
                        <span className="xl:text-right"><span className="xl:hidden text-slate-400">Autor. </span>{num(o.cantidadAutorizada)}</span>
                        <span className="xl:text-right"><span className="xl:hidden text-slate-400">Entreg. </span>{num(o.cantidadEntregada)}</span>
                        <span className="xl:text-right font-semibold"><span className="xl:hidden text-slate-400 font-normal">Pend. </span>{num(cantidadPendiente(o))} {o.unidad}</span>
                        <span><EstadoOrdenBadge estado={o.estado} /></span>
                        <span className="hidden xl:flex justify-end text-slate-400">
                          {expandida ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </span>
                      </button>
                      {expandida && (
                        <DetalleOrdenOperador
                          orden={o}
                          lotes={lotes}
                          inventario={inventario}
                          repartidores={repartidores}
                          perfilActual={perfilActual}
                          procesando={procesando}
                          ejecutar={ejecutarSeguro}
                          onEditarBorrador={(orden) => {
                            setOrdenEditar(orden);
                            setModalAbierto(true);
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {vista === 'repartidores' && (
        <SupervisionRepartidores ordenes={ordenes} repartidores={repartidores} onAbrirOrden={abrirOrden} />
      )}

      {vista === 'solicitudes' && (
        <SolicitudesPendientes
          ordenes={ordenes}
          lotes={lotes}
          inventario={inventario}
          uidActual={perfilActual?.uid}
          procesando={procesando}
          ejecutar={ejecutarSeguro}
          onAbrirOrden={abrirOrden}
        />
      )}

      {vista === 'novedades' && (
        <NovedadesIncidencias ordenes={ordenes} procesando={procesando} ejecutar={ejecutarSeguro} onAbrirOrden={abrirOrden} />
      )}

      {vista === 'historial' && <HistorialEntregas ordenes={ordenes} onAbrirOrden={abrirOrden} />}

      {vista === 'lotes' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-x-auto">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center space-x-2 text-xs">
            <Layers className="w-4 h-4 text-sky-600" />
            <span className="font-bold text-slate-800">Producción registrada, reservas y disponibilidad por lote</span>
          </div>
          <table className="w-full text-xs text-left min-w-[760px]">
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
                              <button onClick={() => abrirOrden(orden.id)} className="font-mono text-sky-700 hover:underline">
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
