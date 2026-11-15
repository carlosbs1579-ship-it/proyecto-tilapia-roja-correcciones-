import React, { useState, useEffect } from 'react';
import { Bloque } from './Esqueleto';
import { quienRegistro } from '../services/usuariosService';
import { LogoLore } from './LogoLore';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { Lote, ConfiguracionGeneral } from '../types';
import { verificarIntegridadLote, analizarCadenaLote, DiagnosticoFase, nombreDato } from '../services/hashService';
import { anotacionesDe, verificarAnotaciones } from '../services/anotacionesService';
import { AnotacionesLote } from '../types';
import { descargarPdfLoteLocal } from '../services/pdfService';
import { CONFIG_DEFAULT, formatearFechaColombia, ocultarCorreo } from '../utils/constants';
import {
  ShieldCheck,
  CheckCircle2,
  Calendar,
  Waves,
  Scale,
  Award,
  Download,
  Share2,
  Check,
  AlertTriangle,
  ArrowLeft,
  Apple,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Clock,
  Info
} from 'lucide-react';

interface PublicTraceabilityViewProps {
  codigoLote: string;
  loteInicial?: Lote | null;
  config?: ConfiguracionGeneral;
  onVolverAlPanel?: () => void;
}

export const PublicTraceabilityView: React.FC<PublicTraceabilityViewProps> = ({
  codigoLote,
  loteInicial,
  config = CONFIG_DEFAULT,
  onVolverAlPanel
}) => {
  const [lote, setLote] = useState<Lote | null>(loteInicial || null);
  const [cargando, setCargando] = useState(!loteInicial);
  const [error, setError] = useState<string | null>(null);
  const [errorPdf, setErrorPdf] = useState<string | null>(null);

  // Estado de verificación criptográfica
  const [verificandoHash, setVerificandoHash] = useState(false);
  const [diagnostico, setDiagnostico] = useState<Record<number, DiagnosticoFase>>({});
  // Anotaciones posteriores al cierre (solo se muestran las aprobadas)
  const [datosAnotaciones, setDatosAnotaciones] = useState<AnotacionesLote | null>(null);
  const [verifAnotaciones, setVerifAnotaciones] = useState<{ integra: boolean; mensaje: string; alteradas: number[] } | null>(null);
  const [resultadoIntegridad, setResultadoIntegridad] = useState<{
    valido: boolean;
    totalEventos: number;
    primerErrorIndex?: number;
    mensaje: string;
  } | null>(null);

  const [copiado, setCopiado] = useState(false);
  const [descargandoPdf, setDescargandoPdf] = useState(false);
  const [verEventosDetalle, setVerEventosDetalle] = useState(true);

  const [reintentos, setReintentos] = useState(0);

  useEffect(() => {
    if (loteInicial) {
      setLote(loteInicial);
      setCargando(false);
    }

    async function cargarLote() {
      if (!loteInicial) {
        setCargando(true);
      }
      setError(null);

      const codigoLimpio = decodeURIComponent(codigoLote || '').trim();

      // Buscar en Cloud Firestore (para móviles y accesos externos por QR)
      try {
        let snap = await getDoc(doc(db, 'lotes', codigoLimpio));

        // Si no se encuentra y difiere en mayúsculas, probar con mayúsculas
        if (!snap.exists() && codigoLimpio !== codigoLimpio.toUpperCase()) {
          snap = await getDoc(doc(db, 'lotes', codigoLimpio.toUpperCase()));
        }

        if (snap.exists()) {
          const loteFs = snap.data() as Lote;
          setLote(loteFs);
          setError(null);
        } else if (!loteInicial) {
          setError(`El lote "${codigoLimpio}" no se encuentra registrado en el sistema oficial de trazabilidad.`);
        }
      } catch (err: any) {
        console.warn('Consulta pública Firestore:', err);
        if (!loteInicial) {
          setError(
            err?.code === 'permission-denied'
              ? 'El servidor de trazabilidad no permitió la lectura pública de este lote. Por favor verifica los permisos.'
              : 'No fue posible consultar el servidor en este momento. Por favor verifica tu conexión.'
          );
        }
      } finally {
        setCargando(false);
      }
    }

    if (codigoLote) {
      cargarLote();
    }
  }, [codigoLote, loteInicial, reintentos]);

  useEffect(() => {
    if (!lote || lote.estado !== 'cerrado') return;
    let activo = true;
    getDoc(doc(db, 'anotacionesLote', lote.codigo))
      .then(async (snap) => {
        const d = snap.exists() ? (snap.data() as AnotacionesLote) : null;
        if (!activo) return;
        setDatosAnotaciones(d);
        setVerifAnotaciones(await verificarAnotaciones(lote, d));
      })
      .catch(() => {});
    return () => {
      activo = false;
    };
  }, [lote]);
  // Solo las aprobadas e íntegras tienen validez; las alteradas se listan aparte como "sin validez"
  const anotacionesAprobadas = anotacionesDe(datosAnotaciones).filter(
    (a) => a.estado === 'aprobada' && !verifAnotaciones?.alteradas.includes(a.numero)
  );
  const anotacionesSinValidez = anotacionesDe(datosAnotaciones).filter((a) => verifAnotaciones?.alteradas.includes(a.numero));

  // El análisis de la cadena corre solo al abrir el QR: cualquier fase alterada se marca en rojo
  useEffect(() => {
    if (!lote) return;
    let activo = true;
    analizarCadenaLote(lote)
      .then((an) => activo && setDiagnostico(Object.fromEntries(an.fases.map((f) => [f.indice, f]))))
      .catch(() => {});
    return () => {
      activo = false;
    };
  }, [lote]);

  const handleVerificarIntegridad = async () => {
    if (!lote) return;
    setVerificandoHash(true);
    try {
      const [res, an] = await Promise.all([verificarIntegridadLote(lote), analizarCadenaLote(lote)]);
      setDiagnostico(Object.fromEntries(an.fases.map((f) => [f.indice, f])));
      setResultadoIntegridad({
        valido: res.valido,
        totalEventos: res.totalEventos,
        primerErrorIndex: res.primerErrorIndex,
        mensaje: res.mensaje
      });
    } catch (err) {
      console.error('Error verificando hash:', err);
    } finally {
      setVerificandoHash(false);
    }
  };

  const handleDescargarPdf = async () => {
    if (!lote) return;
    setDescargandoPdf(true);
    setErrorPdf(null);
    try {
      await descargarPdfLoteLocal(lote, config);
    } catch (err: any) {
      setErrorPdf('No se pudo generar el PDF en este dispositivo. Intente de nuevo o use otro navegador.');
    } finally {
      setDescargandoPdf(false);
    }
  };

  const handleCompartir = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Trazabilidad Lote ${lote?.codigo} • Cultivos Loré`,
          text: `Certificado oficial de trazabilidad inalterable para Tilapia Pro de Cultivos Loré (Turbaco, Bolívar).`,
          url
        });
      } catch {}
    } else {
      navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    }
  };

  if (cargando) {
    return (
      <div className="min-h-dvh bg-white" role="status" aria-label="Cargando el certificado">
        <div className="bg-slate-900 border-b-4 border-double border-amber-600">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
            <LogoLore className="w-10 h-8 text-amber-400" />
            <span className="font-serif text-xl text-white">Cultivos Loré</span>
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-4 pt-6 space-y-6">
          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 p-6 space-y-4">
              <span className="esqueleto block h-9 w-56 rounded bg-slate-800" />
              <span className="esqueleto block h-3 w-72 max-w-full rounded bg-slate-800" />
            </div>
            <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Bloque className="h-3 w-16" />
                  <Bloque className="h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 p-6 space-y-3">
            <Bloque className="h-4 w-48" />
            <Bloque className="h-3 w-full" />
            <Bloque className="h-3 w-2/3" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !lote) {
    return (
      <div className="min-h-dvh bg-slate-100 flex flex-col items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 text-center space-y-4">
          <div className="w-14 h-14 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Lote no disponible</h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            {error || `El código de lote "${codigoLote}" no fue encontrado.`}
          </p>
          <div className="pt-2 space-y-2">
            <button
              onClick={() => setReintentos((n) => n + 1)}
              className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              Reintentar consulta
            </button>
            {onVolverAlPanel ? (
              <button
                onClick={onVolverAlPanel}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                Volver al Panel Principal
              </button>
            ) : (
              <a
                href={window.location.origin}
                className="inline-block w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                Ir al inicio de Cultivos Loré
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  const r = lote.resumen;
  const esCerrado = lote.estado === 'cerrado';

  return (
    <div className="min-h-dvh bg-white text-slate-900 pb-16">
      {/* BARRA SUPERIOR FIJA */}
      <header className="bg-slate-900 text-white sticky top-0 z-30 border-b-4 border-double border-amber-600">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LogoLore className="w-10 h-8 text-amber-400" />
            <div>
            <h1 className="text-xl leading-tight">Cultivos Loré</h1>
            <p className="rotulo text-slate-300">Turbaco, Bolívar · Colombia</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleCompartir}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1 px-2.5"
            >
              {copiado ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copiado ? 'Copiado' : 'Compartir'}</span>
            </button>

            {onVolverAlPanel && (
              <button
                onClick={onVolverAlPanel}
                className="text-xs bg-slate-50 hover:bg-white text-slate-900 font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Panel Operativo</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <main className="max-w-4xl mx-auto px-4 pt-6 space-y-6">
        {/* TARJETA DE CERTIFICADO PRINCIPAL */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {/* Identidad del certificado */}
          <div className="bg-slate-900 p-6 text-white">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-3xl sm:text-4xl tabular-nums">{lote.codigo}</h2>
              <span className={`rotulo flex items-center gap-1.5 ${esCerrado ? 'text-amber-300' : 'text-emerald-300'}`}>
                <Award className="w-3.5 h-3.5" aria-hidden="true" />
                {esCerrado ? 'Certificado · lote sellado' : 'Lote en cultivo'}
              </span>
            </div>

            <p className="text-sm text-slate-200 mt-3 pt-3 border-t-[3px] border-double border-amber-500">
              {lote.producto}
            </p>
          </div>

          {/* Datos Esenciales de Origen */}
          <div className="p-6 bg-slate-50 border-b border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-slate-500 block">Origen:</span>
              <strong className="text-slate-800 text-sm">Turbaco, Bolívar</strong>
            </div>
            <div>
              <span className="text-slate-500 block">Estanque:</span>
              <strong className="text-slate-800 text-sm">{lote.estanque}</strong>
            </div>
            <div>
              <span className="text-slate-500 block">Fecha de siembra:</span>
              <strong className="text-slate-800 text-sm">{lote.fechaSiembra}</strong>
            </div>
            <div>
              <span className="text-slate-500 block">Fecha de cosecha:</span>
              <strong className="text-slate-800 text-sm">{lote.fechaCierre || 'En progreso'}</strong>
            </div>
          </div>

          {/* Botón Principal de Descarga de PDF */}
          <div className="p-4 bg-white flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              Certificado técnico oficial descargable para restaurantes, chefs y distribuidores.
            </div>
            <button
              onClick={handleDescargarPdf}
              disabled={descargandoPdf}
              className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-md text-xs transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>{descargandoPdf ? 'Generando PDF...' : 'Descargar certificado (PDF)'}</span>
            </button>
            {errorPdf && <p className="text-xs text-red-600 mt-2">{errorPdf}</p>}
          </div>
        </div>

        {/* SELLO DE INTEGRIDAD CRIPTOGRÁFICA SHA-256 */}
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Autenticidad verificable
                </h3>
                <p className="text-xs text-slate-500">
                  Cada fase del lote está encadenada mediante hash SHA-256 matemáticamente verificable.
                </p>
              </div>
            </div>

            <button
              onClick={handleVerificarIntegridad}
              disabled={verificandoHash}
              className="inline-flex items-center justify-center space-x-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>{verificandoHash ? 'Verificando hashes...' : 'Verificar integridad'}</span>
            </button>
          </div>

          {/* Resultado de la verificación */}
          {resultadoIntegridad && (
            <div
              className={`p-4 rounded-xl border flex items-start space-x-3 text-xs ${
                resultadoIntegridad.valido
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-red-50 border-red-300 text-red-900'
              }`}
            >
              {resultadoIntegridad.valido ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              )}
              <div>
                <strong className="block text-sm">
                  {resultadoIntegridad.valido
                    ? 'Cadena íntegra: ninguna fase fue alterada'
                    : 'Inconsistencia detectada en la cadena'}
                </strong>
                <p className="mt-1 text-xs">
                  {resultadoIntegridad.valido
                    ? `Se validaron matemáticamente ${resultadoIntegridad.totalEventos} fases registradas desde la siembra. Ningún dato ha sido alterado desde su origen.`
                    : `Se detectó una discrepancia a partir de la fase #${resultadoIntegridad.primerErrorIndex}.`}
                </p>
              </div>
            </div>
          )}

          {/* Visualización del Hash Final */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
            <span className="text-[11px] uppercase font-bold text-slate-400 block mb-1">
              Sello Hash SHA-256 de Cierre del Lote
            </span>
            <code className="text-[11px] font-mono text-slate-700 break-all select-all block">
              {r?.hashFinal || (esCerrado ? 'No registrado' : 'En proceso de cultivo')}
            </code>
          </div>
        </div>

        {/* MÉTRICAS PRODUCTIVAS CLAVE */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-center">
            <span className="text-[11px] text-slate-500 font-medium block">Peces sembrados</span>
            <strong className="text-lg font-bold text-slate-900 mt-1 block">
              {lote.cantidadSembrada.toLocaleString()}
            </strong>
            <span className="text-[11px] text-slate-400">Alevinos iniciales</span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-center">
            <span className="text-[11px] text-slate-500 font-medium block">Supervivencia</span>
            <strong className="text-lg font-bold text-slate-900 mt-1 block">
              {r ? `${r.supervivencia.toFixed(1)}%` : 'Sin dato'}
            </strong>
            <span className="text-[11px] text-slate-400">
              {r ? `${r.pecesVivos.toLocaleString()} vivos` : ''}
            </span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-center">
            <span className="text-[11px] text-slate-500 font-medium block">Peso promedio</span>
            <strong className="text-lg font-bold text-sky-600 mt-1 block">
              {r ? `${Math.round(r.pesoPromedioActualG)} g` : 'Sin dato'}
            </strong>
            <span className="text-[11px] text-slate-400">Calibre 450 - 500 g</span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-center">
            <span className="text-[11px] text-slate-500 font-medium block">Biomasa total</span>
            <strong className="text-lg font-bold text-slate-900 mt-1 block">
              {r ? `${(r.biomasaEstimadaKg || 0).toFixed(0)} kg` : 'Sin dato'}
            </strong>
            <span className="text-[11px] text-slate-400">
              FCA: {r?.FCA ? r.FCA.toFixed(2) : 'sin registro'}
            </span>
          </div>
        </div>

        {/* LÍNEA DE TIEMPO DE EVENTOS CRONOLÓGICOS */}
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Historial del lote, fase por fase
              </h3>
              <p className="text-xs text-slate-500">
                {lote.eventos?.length || 0} fases registradas cronológicamente
              </p>
              {Object.values(diagnostico).some((f) => f.estado !== 'integra') && (
                <p className="mt-1 text-xs font-semibold text-red-700">
                  Se detectaron fases alteradas después de su registro (marcadas en rojo).
                </p>
              )}
            </div>

            <button
              onClick={() => setVerEventosDetalle(!verEventosDetalle)}
              className="text-xs text-sky-600 hover:text-sky-700 font-semibold flex items-center space-x-1"
            >
              <span>{verEventosDetalle ? 'Ocultar detalles' : 'Ver todos'}</span>
              {verEventosDetalle ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {verEventosDetalle && (
            <div className="divide-y divide-slate-200 border-t border-slate-200">
              {(lote.eventos || []).map((ev) => (
                <div key={ev.id} className="flex items-start gap-3 py-1">
                  <span className="font-serif text-slate-500 text-sm tabular-nums w-7 shrink-0 pt-2.5 text-right" aria-label={`Fase ${ev.indice + 1}`}>
                    {String(ev.indice + 1).padStart(2, '0')}
                  </span>
                  <div
                    className={`flex-1 min-w-0 p-3 text-xs ${
                      diagnostico[ev.indice] && diagnostico[ev.indice].estado !== 'integra' ? 'bg-red-50 ring-1 ring-inset ring-red-300' : ''
                    }`}
                  >
                    {diagnostico[ev.indice] && diagnostico[ev.indice].estado !== 'integra' && (
                      <p className="mb-1.5 font-semibold text-red-700">{diagnostico[ev.indice].mensaje}</p>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                      <strong className="text-slate-900 font-bold">
                        {ev.tipo}
                        {anotacionesAprobadas.some((a) => Number(a.propuesta.datos.fase) === ev.indice) && (
                          <span className="ml-2 rotulo text-amber-700 border-b border-amber-600">
                            Ver anotación N.º{' '}
                            {anotacionesAprobadas
                              .filter((a) => Number(a.propuesta.datos.fase) === ev.indice)
                              .map((a) => a.numero)
                              .join(', ')}
                          </span>
                        )}
                      </strong>
                      <span className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">{formatearFechaColombia(ev.fechaEvento)}</span>
                    </div>
                    {ev.descripcion && (
                      <p className="text-slate-600 text-xs mb-2">{ev.descripcion}</p>
                    )}

                    {/* Resumen de datos según tipo */}
                    {ev.datos && Object.keys(ev.datos).length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] border-l-2 border-slate-200 pl-3">
                        {Object.entries(ev.datos).map(([clave, valor]) => (
                          <div key={clave} className="min-w-0 [overflow-wrap:anywhere]">
                            <span className="text-slate-500">{nombreDato(clave)}: </span>
                            <span className="font-semibold text-slate-800">{String(valor)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-2 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="text-slate-700 min-w-0 [overflow-wrap:anywhere]">
                        <span className="rotulo text-slate-500 mr-2">Registró</span>
                        <span className="firma text-sm">{quienRegistro(ev, true)}</span>
                      </span>
                      <span className="font-mono text-[11px] whitespace-nowrap" title={ev.hash}>Huella {ev.hash.substring(0, 12)}…</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ANOTACIONES POSTERIORES AL CIERRE */}
        {(anotacionesAprobadas.length > 0 || anotacionesSinValidez.length > 0) && (
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Anotaciones posteriores al cierre</h3>
            <p className="text-xs text-slate-500">
              El registro sellado no se modificó. Estas aclaraciones fueron propuestas y aprobadas por personas distintas, con su motivo.
            </p>
            {verifAnotaciones && (
              <p className={`text-xs font-semibold ${verifAnotaciones.integra ? 'text-emerald-700' : 'text-red-600'}`}>{verifAnotaciones.mensaje}</p>
            )}
            <ul className="space-y-2">
              {anotacionesAprobadas.map((a) => {
                const d = a.propuesta.datos;
                const ev = (lote.eventos || [])[d.fase];
                return (
                  <li key={a.propuesta.id} className="border border-sky-100 bg-sky-50/40 rounded-xl p-3 text-xs space-y-1">
                    <p className="font-semibold text-slate-800">
                      Anotación N.º {a.numero} · Fase #{d.fase} {ev ? `(${ev.tipo})` : ''}
                    </p>
                    <p className="text-slate-700">
                      {d.dato ? (
                        <>
                          {nombreDato(d.dato)}: registrado <strong>{ev ? String(ev.datos?.[d.dato] ?? d.valorRegistrado) : d.valorRegistrado}</strong> · correcto{' '}
                          <strong>{d.valorCorrecto}</strong>
                        </>
                      ) : (
                        'Aclaración general de la fase'
                      )}
                    </p>
                    <p className="text-slate-600">Motivo: {d.motivo}</p>
                    <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1 pt-1 text-slate-700">
                      <span><span className="rotulo text-slate-500 mr-2">Propuso</span><span className="firma">{quienRegistro(a.propuesta, true)}</span></span>
                      <span><span className="rotulo text-slate-500 mr-2">Aprobó</span><span className="firma">{a.resolucion ? quienRegistro(a.resolucion, true) : 'Sin dato'}</span></span>
                      <span className="text-[11px] text-slate-500 tabular-nums">{formatearFechaColombia(a.resolucion?.fecha || a.propuesta.fecha)}</span>
                    </p>
                  </li>
                );
              })}
              {anotacionesSinValidez.map((a) => (
                <li key={a.propuesta.id} className="border border-red-200 bg-red-50 rounded-xl p-3 text-xs font-semibold text-red-700">
                  Anotación N.º {a.numero}: alterada después de registrarse, sin validez.
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* FICHA NUTRICIONAL */}
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4">
          <div className="flex items-center space-x-2">
            <Apple className="w-5 h-5 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Información nutricional (Porción 100 g de filete crudo)
            </h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-slate-500 block">Energía</span>
              <strong className="text-base text-slate-900">{config.fichaNutricional.energiaKcal} kcal</strong>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-slate-500 block">Proteína</span>
              <strong className="text-base text-slate-900">{config.fichaNutricional.proteinaG} g</strong>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-slate-500 block">Grasa total</span>
              <strong className="text-base text-slate-900">{config.fichaNutricional.grasaTotalG} g</strong>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-slate-500 block">Sodio</span>
              <strong className="text-base text-sky-600">{config.fichaNutricional.sodioMg} mg</strong>
            </div>
          </div>
        </div>

        {/* NOTA OBLIGATORIA DE INOCUIDAD */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start space-x-3 text-xs text-amber-900">
          <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Nota de inocuidad:</strong> Este registro documenta cómo se produjo y manejó el lote; no reemplaza los controles de inocuidad.
          </p>
        </div>
      </main>

      {/* PIE DE PÁGINA */}
      <footer className="max-w-4xl mx-auto px-4 mt-8 pt-6 border-t border-slate-200 text-center text-xs text-slate-500">
        <p className="font-semibold text-slate-700">Cultivos Loré • Turbaco, Bolívar, Colombia</p>
        <p className="mt-1">
          Acuicultura de precisión • Tilapia roja • Cadena criptográfica verificable
        </p>
      </footer>
    </div>
  );
};
