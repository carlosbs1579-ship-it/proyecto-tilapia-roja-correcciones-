import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  ShieldCheck,
  CheckCircle,
  FileText,
  RefreshCw,
  QrCode,
  Calendar,
  AlertTriangle,
  Lock,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Activity,
  Layers,
  Clock,
  Download,
  Edit3,
  Fish,
  Waves
} from 'lucide-react';
import { Lote, ConfiguracionGeneral, TipoEvento, UsuarioPerfil } from '../types';
import { NuevoEventoModal } from './NuevoEventoModal';
import { IntegrityCheckModal } from './IntegrityCheckModal';
import { QrModal } from './QrModal';
import { cerrarLote, escucharLoteIndividual, modificarDatosSiembraOPiscina } from '../services/lotesService';
import { previsualizarPdfLote, generarYSubirPdfLote, descargarPdfLoteLocal } from '../services/pdfService';
import { formatearFechaColombia } from '../utils/constants';
import { evaluarParametroAgua } from '../services/calculosService';
import { esAdminMaestro, esAdministrador, verificarPermiso } from '../services/usuariosService';
import { EntregasPanel } from './EntregasPanel';

interface LoteDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  loteInicial: Lote;
  config: ConfiguracionGeneral;
  userEmail: string;
  perfilActual: UsuarioPerfil | null;
  onLoteActualizado?: (lote: Lote) => void;
  onAbrirVistaPublica?: (codigo: string) => void;
}

export const LoteDetailModal: React.FC<LoteDetailModalProps> = ({
  isOpen,
  onClose,
  loteInicial,
  config,
  userEmail,
  perfilActual,
  onLoteActualizado,
  onAbrirVistaPublica
}) => {
  const esAdmin = esAdminMaestro(userEmail);
  const puedeRegistrar = esAdmin || verificarPermiso(perfilActual, 'registrarEventos');
  const puedeCerrar = esAdmin || verificarPermiso(perfilActual, 'cerrarLotes');
  const puedeModificarSiembra = esAdmin || verificarPermiso(perfilActual, 'crearLotes') || verificarPermiso(perfilActual, 'gestionarEstanques');

  const [lote, setLote] = useState<Lote>(loteInicial);
  const [modalEventoOpen, setModalEventoOpen] = useState(false);
  const [modalIntegridadOpen, setModalIntegridadOpen] = useState(false);
  const [modalQrOpen, setModalQrOpen] = useState(false);
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [procesandoAccion, setProcesandoAccion] = useState(false);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<string>('todos');

  // Estado para modificación de registros de alevinos y piscina (solo lote activo)
  const [modalEditarSiembraOpen, setModalEditarSiembraOpen] = useState(false);
  const [editEstanque, setEditEstanque] = useState(loteInicial?.estanque || 'E1');
  const [editCantidad, setEditCantidad] = useState<number | ''>(loteInicial?.cantidadSembrada || 5000);
  const [editPesoInicial, setEditPesoInicial] = useState<number | ''>(loteInicial?.pesoInicialPromedioG || 2.5);
  const [editProveedor, setEditProveedor] = useState(loteInicial?.proveedorAlevinos || '');
  const [editObservaciones, setEditObservaciones] = useState(loteInicial?.observacionesIniciales || '');
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);

  const handleAbrirEditarSiembra = () => {
    if (lote.estado === 'cerrado') return;
    setEditEstanque(lote.estanque);
    setEditCantidad(lote.cantidadSembrada);
    setEditPesoInicial(lote.pesoInicialPromedioG);
    setEditProveedor(lote.proveedorAlevinos || '');
    setEditObservaciones(lote.observacionesIniciales || '');
    setErrorEdicion(null);
    setModalEditarSiembraOpen(true);
  };

  const handleGuardarEditarSiembra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lote.estado === 'cerrado') {
      setErrorEdicion('Operación bloqueada: El lote se encuentra sellado y cerrado.');
      return;
    }
    const cant = Number(editCantidad);
    const peso = Number(editPesoInicial);
    if (!editEstanque) {
      setErrorEdicion('Selecciona el estanque / piscina.');
      return;
    }
    if (isNaN(cant) || cant <= 0) {
      setErrorEdicion('La cantidad de alevinos sembrados debe ser mayor a 0.');
      return;
    }
    if (isNaN(peso) || peso <= 0) {
      setErrorEdicion('El peso promedio inicial debe ser mayor a 0 gramos.');
      return;
    }

    setGuardandoEdicion(true);
    setErrorEdicion(null);
    try {
      const loteActualizado = await modificarDatosSiembraOPiscina({
        codigoLote: lote.codigo,
        estanque: editEstanque,
        cantidadSembrada: cant,
        pesoInicialPromedioG: peso,
        proveedorAlevinos: editProveedor.trim(),
        observaciones: editObservaciones.trim(),
        userEmail,
        config
      });

      if (loteActualizado) {
        setLote(loteActualizado);
        setModalEditarSiembraOpen(false);
        setMensajeExito('✓ Registros de alevinos y piscina actualizados exitosamente en la cadena.');
        if (onLoteActualizado) {
          onLoteActualizado(loteActualizado);
        }
        setTimeout(() => setMensajeExito(null), 4000);
      }
    } catch (err: any) {
      setErrorEdicion(err.message || 'Error al actualizar datos de alevinos y piscina.');
    } finally {
      setGuardandoEdicion(false);
    }
  };

  // Suscripción en tiempo real al lote individual
  useEffect(() => {
    if (!isOpen || !loteInicial?.codigo) return;
    setLote(loteInicial);
    const unsubscribe = escucharLoteIndividual(loteInicial.codigo, (loteActualizado) => {
      if (loteActualizado) {
        setLote(loteActualizado);
      }
    });
    return () => unsubscribe();
  }, [isOpen, loteInicial?.codigo]);

  if (!isOpen) return null;

  const r = lote.resumen;

  const handleCerrarLote = async () => {
    setProcesandoAccion(true);
    try {
      const loteCerrado = await cerrarLote(lote.codigo, userEmail, config);
      if (loteCerrado) {
        setLote(loteCerrado);
        setConfirmarCierre(false);
        setMensajeExito('✓ Lote cerrado exitosamente. El certificado y el QR de trazabilidad inalterable ya están activos.');
        if (onLoteActualizado) {
          onLoteActualizado(loteCerrado);
        }
        setTimeout(() => setMensajeExito(null), 4000);
      }
    } catch (err: any) {
      alert(`Error al cerrar lote: ${err.message || err}`);
    } finally {
      setProcesandoAccion(false);
    }
  };

  const handleRegenerarPdf = async () => {
    setProcesandoAccion(true);
    try {
      const { urlPublica, versionPdf } = await generarYSubirPdfLote(lote, config);
      setMensajeExito(`PDF v${versionPdf} regenerado y sincronizado con Cloud Storage exitosamente.`);
      setTimeout(() => setMensajeExito(null), 4000);
    } catch (err: any) {
      alert(`Error regenerando PDF: ${err.message || err}`);
    } finally {
      setProcesandoAccion(false);
    }
  };

  const handleVistaPreviaPdf = async () => {
    try {
      await previsualizarPdfLote(lote, config);
    } catch (err: any) {
      alert(`Error al abrir vista previa del PDF: ${err.message || err}`);
    }
  };

  // Filtrado de eventos en la línea de tiempo
  const eventosFiltrados = (lote.eventos || []).filter((ev) => {
    if (filtroTipo === 'todos') return true;
    if (filtroTipo === 'agua') return ev.tipo === 'Calidad del agua';
    if (filtroTipo === 'alimentacion') return ev.tipo === 'Alimentación' || ev.tipo === 'Muestreo de crecimiento (biometría)';
    if (filtroTipo === 'sanitario') return ev.tipo === 'Mortalidad' || ev.tipo === 'Probióticos' || ev.tipo === 'Tratamiento o manejo sanitario';
    if (filtroTipo === 'cosecha') return ['Cosecha', 'Proceso', 'Empaque y conservación', 'Despacho/transporte'].includes(ev.tipo);
    return true;
  });

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 md:p-6 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
          {/* BARRA SUPERIOR DEL LOTE */}
          <div className="bg-slate-900 text-white px-6 py-4 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-sky-600 flex items-center justify-center font-mono font-bold text-lg text-white">
                {lote.estanque}
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-xl font-bold font-mono tracking-wide">{lote.codigo}</h2>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                      lote.estado === 'activo'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'bg-slate-700 text-slate-300 border border-slate-600'
                    }`}
                  >
                    {lote.estado === 'activo' ? 'En cultivo activo' : 'Cerrado / Cosechado'}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Estanque {lote.estanque} • Siembra: {lote.fechaSiembra} • Consecutivo #{lote.consecutivo}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  if (onAbrirVistaPublica) {
                    onAbrirVistaPublica(lote.codigo);
                  } else {
                    window.open(`/?lote=${encodeURIComponent(lote.codigo)}`, '_blank');
                  }
                }}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-700 hover:bg-sky-600 text-white transition-colors"
                title="Abrir la certificación web pública oficial para este lote"
              >
                <ExternalLink className="w-4 h-4 text-sky-200" />
                <span className="hidden sm:inline">Vista Pública</span>
              </button>

              <button
                onClick={() => setModalQrOpen(true)}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              >
                <QrCode className="w-4 h-4 text-sky-400" />
                <span>QR Etiqueta</span>
              </button>

              <button
                onClick={() => descargarPdfLoteLocal(lote, config)}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Descargar PDF</span>
              </button>

              <button
                onClick={handleVistaPreviaPdf}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              >
                <FileText className="w-4 h-4 text-emerald-400" />
                <span>Vista Previa</span>
              </button>

              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* MENSAJES DE ÉXITO O ALERTA */}
          {mensajeExito && (
            <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-2.5 flex items-center space-x-2 text-xs text-emerald-800">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{mensajeExito}</span>
            </div>
          )}

          {/* CUERPO PRINCIPAL CON SCROLL */}
          <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-slate-50">
            {/* AVISO DE LOTE SELLADO / CERRADO */}
            {lote.estado === 'cerrado' && (
              <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 shadow-xs flex items-start space-x-3">
                <div className="p-2 bg-amber-500/20 text-amber-400 rounded-lg shrink-0 mt-0.5 border border-amber-500/30">
                  <Lock className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-sm text-white">Lote Sellado y Cerrado</span>
                    <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider">
                      Trazabilidad Inalterable
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Este lote culminó su ciclo de producción y ha sido sellado de forma permanente. Toda modificación e incorporación de nuevos registros de producción está bloqueada. La consulta de su información, descarga de certificados y la verificación criptográfica mediante hashes SHA-256 continúan plenamente disponibles.
                  </p>
                </div>
              </div>
            )}

            {/* BARRA DE ACCIONES OPERATIVAS */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                {lote.estado === 'activo' ? (
                  <>
                    <button
                      onClick={() => setModalEventoOpen(true)}
                      disabled={procesandoAccion || !puedeRegistrar}
                      title={puedeRegistrar ? 'Registrar nuevo evento' : 'Requiere autorización para registrar eventos'}
                      className={`inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors ${
                        puedeRegistrar
                          ? 'bg-sky-600 hover:bg-sky-500 text-white'
                          : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      <Plus className="w-4 h-4" />
                      <span>Registrar Evento</span>
                    </button>

                    {puedeModificarSiembra && (
                      <button
                        onClick={handleAbrirEditarSiembra}
                        disabled={procesandoAccion}
                        title="Modificar registros de alevinos o piscina del lote activo"
                        className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold transition-colors border border-slate-200"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-sky-600" />
                        <span>Editar Siembra / Piscina</span>
                      </button>
                    )}
                  </>
                ) : (
                  <div className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold border border-slate-200">
                    <Lock className="w-3.5 h-3.5 text-amber-600" />
                    <span>Lote Sellado (Registros de producción bloqueados)</span>
                  </div>
                )}

                <button
                  onClick={() => setModalIntegridadOpen(true)}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold transition-colors border border-slate-200"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Verificar Integridad (Hash)</span>
                </button>
              </div>

              <div className="flex items-center space-x-2">
                {lote.estado === 'activo' ? (
                  !confirmarCierre ? (
                    <button
                      onClick={() => setConfirmarCierre(true)}
                      disabled={procesandoAccion || !puedeCerrar}
                      title={puedeCerrar ? 'Cerrar lote y publicar PDF' : 'Requiere autorización de Carlos para cerrar lotes'}
                      className={`inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors ${
                        puedeCerrar
                          ? 'bg-amber-600 hover:bg-amber-500 text-white'
                          : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      <Lock className="w-4 h-4" />
                      <span>Cerrar Lote</span>
                    </button>
                  ) : (
                    <div className="flex items-center space-x-2 bg-amber-50 p-1.5 rounded-lg border border-amber-300 text-xs">
                      <span className="text-amber-900 font-medium">¿Confirmar cierre y generar PDF final?</span>
                      <button
                        onClick={handleCerrarLote}
                        disabled={procesandoAccion}
                        className="px-2.5 py-1 bg-amber-600 text-white font-bold rounded hover:bg-amber-700"
                      >
                        {procesandoAccion ? 'Cerrando...' : 'Sí, Cerrar'}
                      </button>
                      <button
                        onClick={() => setConfirmarCierre(false)}
                        className="px-2 py-1 text-slate-600 hover:text-slate-800"
                      >
                        Cancelar
                      </button>
                    </div>
                  )
                ) : (
                  <button
                    onClick={handleRegenerarPdf}
                    disabled={procesandoAccion}
                    className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-semibold transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${procesandoAccion ? 'animate-spin' : ''}`} />
                    <span>Regenerar PDF en Storage</span>
                  </button>
                )}
              </div>
            </div>

            {/* TARJETAS DE INDICADORES PRODUCTIVOS */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* Días de Cultivo */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-[11px] font-medium uppercase">Días Cultivo</span>
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <p className="text-lg font-bold text-slate-900">{r.diasDeCultivo} d</p>
                <p className="text-[10px] text-slate-400">Desde {lote.fechaSiembra}</p>
              </div>

              {/* Supervivencia & Peces Vivos */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-[11px] font-medium uppercase">Supervivencia</span>
                  <Activity className="w-3.5 h-3.5 text-emerald-500" />
                </div>
                <p className="text-lg font-bold text-emerald-600">{r.supervivencia}%</p>
                <p className="text-[10px] text-slate-400">{r.pecesVivos.toLocaleString()} vivos / {lote.cantidadSembrada.toLocaleString()}</p>
              </div>

              {/* Peso Promedio Actual */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-[11px] font-medium uppercase">Peso Promedio</span>
                  <TrendingUp className="w-3.5 h-3.5 text-sky-500" />
                </div>
                <p className="text-lg font-bold text-slate-900">{r.pesoPromedioActualG} g</p>
                <p className="text-[10px] text-slate-400">Inicial: {lote.pesoInicialPromedioG} g (+{r.gananciaDiariaG} g/d)</p>
              </div>

              {/* Biomasa Estimada Viva */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-[11px] font-medium uppercase">Biomasa Viva</span>
                  <Layers className="w-3.5 h-3.5 text-indigo-500" />
                </div>
                <p className="text-lg font-bold text-slate-900">{r.biomasaEstimadaKg.toLocaleString()} kg</p>
                <p className="text-[10px] text-slate-400">
                  {r.densidadKgM3 ? `Densidad: ${r.densidadKgM3} kg/m³` : `Inicial: ${r.biomasaInicialKg} kg`}
                </p>
              </div>

              {/* Alimento y FCA */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-[11px] font-medium uppercase">FCA / Alimento</span>
                  <span className="text-[10px] font-bold text-sky-600">{r.FCA ?? 'N/A'}</span>
                </div>
                <p className="text-lg font-bold text-slate-900">{r.alimentoAcumuladoKg} kg</p>
                <p className="text-[10px] text-slate-400">Alimento acumulado</p>
              </div>

              {/* Alertas de Calidad de Agua */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="text-[11px] font-medium uppercase">Alertas Agua</span>
                  <AlertTriangle className={`w-3.5 h-3.5 ${r.alertasAgua > 0 ? 'text-amber-500' : 'text-slate-300'}`} />
                </div>
                <p className={`text-lg font-bold ${r.alertasAgua > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                  {r.alertasAgua}
                </p>
                <p className="text-[10px] text-slate-400">Mediciones fuera de rango</p>
              </div>
            </div>

            {/* ENTREGAS A CLIENTES (solo lotes sellados; cadena aparte de la producción) */}
            {lote.estado === 'cerrado' && (
              <EntregasPanel
                lote={lote}
                userEmail={userEmail}
                puedeGestionar={esAdmin || esAdministrador(perfilActual)}
              />
            )}

            {/* SECCIÓN DE HISTORIAL Y LÍNEA DE TIEMPO */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              {/* Filtros de la línea de tiempo */}
              <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center space-x-2">
                  <h3 className="font-bold text-slate-900 text-sm">Línea de Tiempo Inalterable</h3>
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-semibold">
                    {lote.eventos?.length || 0} eventos
                  </span>
                </div>

                <div className="flex items-center space-x-1 text-xs">
                  <button
                    onClick={() => setFiltroTipo('todos')}
                    className={`px-2.5 py-1 rounded-md font-medium ${
                      filtroTipo === 'todos' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Todos
                  </button>
                  <button
                    onClick={() => setFiltroTipo('agua')}
                    className={`px-2.5 py-1 rounded-md font-medium ${
                      filtroTipo === 'agua' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Agua
                  </button>
                  <button
                    onClick={() => setFiltroTipo('alimentacion')}
                    className={`px-2.5 py-1 rounded-md font-medium ${
                      filtroTipo === 'alimentacion' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Alimentación & Biometría
                  </button>
                  <button
                    onClick={() => setFiltroTipo('sanitario')}
                    className={`px-2.5 py-1 rounded-md font-medium ${
                      filtroTipo === 'sanitario' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Sanitario & Mortalidad
                  </button>
                  <button
                    onClick={() => setFiltroTipo('cosecha')}
                    className={`px-2.5 py-1 rounded-md font-medium ${
                      filtroTipo === 'cosecha' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Cosecha & Despacho
                  </button>
                </div>
              </div>

              {/* Lista de eventos */}
              <div className="divide-y divide-slate-100">
                {eventosFiltrados.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-400">
                    No hay eventos registrados en este filtro.
                  </div>
                ) : (
                  eventosFiltrados.map((ev) => {
                    const esAgua = ev.tipo === 'Calidad del agua';
                    const alertasDelEvento: string[] = [];
                    if (esAgua && ev.datos) {
                      const paramsList: Array<'temperatura' | 'oxigenoDisuelto' | 'ph' | 'amonioTotal' | 'nitritos' | 'transparenciaSecchi'> = [
                        'temperatura', 'oxigenoDisuelto', 'ph', 'amonioTotal', 'nitritos', 'transparenciaSecchi'
                      ];
                      for (const p of paramsList) {
                        const val = Number(ev.datos[p]);
                        if (!isNaN(val)) {
                          const evalRes = evaluarParametroAgua(p, val, config.rangosReferencia);
                          if (evalRes.fueraDeRango) {
                            alertasDelEvento.push(evalRes.mensaje);
                          }
                        }
                      }
                    }

                    return (
                      <div key={ev.id} className="p-4 hover:bg-slate-50/80 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start space-x-3">
                            <span className="font-mono text-xs font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                              #{ev.indice}
                            </span>
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="font-bold text-sm text-slate-900">{ev.tipo}</span>
                                <span className="text-xs text-slate-500 font-medium">
                                  {ev.fechaEvento}
                                </span>
                                {alertasDelEvento.length > 0 && (
                                  <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold flex items-center space-x-1">
                                    <AlertTriangle className="w-3 h-3 mr-0.5" />
                                    <span>{alertasDelEvento.length} alerta(s) de agua</span>
                                  </span>
                                )}
                              </div>

                              {ev.descripcion && (
                                <p className="text-xs text-slate-600 mt-1">{ev.descripcion}</p>
                              )}

                              {/* Datos técnicos específicos formateados */}
                              {ev.datos && Object.keys(ev.datos).length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {Object.entries(ev.datos).map(([k, v]) => (
                                    <span
                                      key={k}
                                      className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200"
                                    >
                                      <strong className="text-slate-900">{k}:</strong> {typeof v === 'boolean' ? (v ? 'SÍ' : 'NO') : String(v)}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Alertas específicas de calidad de agua */}
                              {alertasDelEvento.length > 0 && (
                                <div className="mt-2 text-[11px] text-red-700 bg-red-50 p-2 rounded border border-red-200">
                                  {alertasDelEvento.join(' • ')}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <p className="text-[11px] text-slate-500">{ev.registradoPor}</p>
                            <span
                              title={`SHA-256: ${ev.hash}`}
                              className="font-mono text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded block mt-1 max-w-[120px] truncate"
                            >
                              {ev.hash.substring(0, 10)}...
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-modales */}
      {modalEventoOpen && (
        <NuevoEventoModal
          isOpen={modalEventoOpen}
          onClose={() => setModalEventoOpen(false)}
          lote={lote}
          config={config}
          userEmail={userEmail}
          onEventoRegistrado={(loteActualizado) => {
            setLote(loteActualizado);
            setMensajeExito('Evento agregado y verificado con éxito en la cadena de hashes.');
            setTimeout(() => setMensajeExito(null), 3000);
          }}
        />
      )}

      {modalIntegridadOpen && (
        <IntegrityCheckModal
          isOpen={modalIntegridadOpen}
          onClose={() => setModalIntegridadOpen(false)}
          lote={lote}
        />
      )}

      {modalQrOpen && (
        <QrModal
          isOpen={modalQrOpen}
          onClose={() => setModalQrOpen(false)}
          lote={lote}
          config={config}
        />
      )}

      {modalEditarSiembraOpen && lote.estado === 'activo' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden my-6">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Fish className="w-5 h-5 text-sky-400" />
                <div>
                  <h3 className="font-semibold text-base">Modificar Datos de Alevinos y Piscina</h3>
                  <p className="text-xs text-slate-400">Lote Activo: {lote.codigo}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalEditarSiembraOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardarEditarSiembra} className="p-6 space-y-4">
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 text-xs text-sky-900">
                Esta modificación actualizará los registros de alevinos y asignación de piscina en el bloque génesis de la cadena inalterable, recalculando los hashes criptográficos del lote.
              </div>

              {errorEdicion && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorEdicion}</span>
                </div>
              )}

              {/* Selector Estanque / Piscina */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Piscina / Estanque de Cultivo *
                </label>
                <select
                  value={editEstanque}
                  onChange={(e) => setEditEstanque(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
                >
                  {config.estanques.map((est) => (
                    <option key={est.codigo} value={est.codigo}>
                      {est.codigo} — {est.nombre} {est.volumenM3 ? `(${est.volumenM3} m³)` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Cantidad Alevinos & Peso Inicial */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Cantidad de Alevinos (Siembra) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={editCantidad}
                    onChange={(e) => setEditCantidad(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                    placeholder="ej: 5000"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Peso Promedio Inicial (g) *
                  </label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={editPesoInicial}
                    onChange={(e) => setEditPesoInicial(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                    placeholder="ej: 2.5"
                    required
                  />
                </div>
              </div>

              {/* Proveedor Alevinos */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Proveedor de Alevinos
                </label>
                <input
                  type="text"
                  value={editProveedor}
                  onChange={(e) => setEditProveedor(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                  placeholder="ej: Alevinos del Caribe / Certificado ICA"
                />
              </div>

              {/* Observaciones */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Observaciones de Siembra
                </label>
                <textarea
                  rows={2}
                  value={editObservaciones}
                  onChange={(e) => setEditObservaciones(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                  placeholder="Anotaciones de aclimatación, lote de origen, bioseguridad..."
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setModalEditarSiembraOpen(false)}
                  disabled={guardandoEdicion}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoEdicion}
                  className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors disabled:opacity-50 flex items-center space-x-2"
                >
                  {guardandoEdicion ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Actualizando...</span>
                    </>
                  ) : (
                    <span>Guardar Cambios</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
