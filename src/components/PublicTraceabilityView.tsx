import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { Lote, ConfiguracionGeneral } from '../types';
import { verificarIntegridadCadena } from '../services/hashService';
import { descargarPdfLoteLocal } from '../services/pdfService';
import { EntregasPublicas } from './EntregasPublicas';
import { CONFIG_DEFAULT, formatearFechaColombia } from '../utils/constants';
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

  // Estado de verificación criptográfica
  const [verificandoHash, setVerificandoHash] = useState(false);
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

  const handleVerificarIntegridad = async () => {
    if (!lote) return;
    setVerificandoHash(true);
    try {
      const res = await verificarIntegridadCadena(lote.codigo, lote.eventos || []);
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
    try {
      await descargarPdfLoteLocal(lote, config);
    } catch (err: any) {
      alert(`Error generando PDF: ${err.message || err}`);
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
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white">
        <div className="w-12 h-12 border-3 border-sky-400 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-semibold tracking-wide text-sky-200">
          CULTIVOS LORÉ • TILAPIA PRO
        </p>
        <p className="text-xs text-slate-400 mt-1">Cargando certificado de trazabilidad...</p>
      </div>
    );
  }

  if (error || !lote) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
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
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-16">
      {/* BARRA SUPERIOR FIJA */}
      <header className="bg-slate-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500 flex items-center justify-center text-white font-black text-xs">
              CL
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-wide">CULTIVOS LORÉ</h1>
              <p className="text-[10px] text-sky-400 font-medium">Turbaco, Bolívar • Colombia</p>
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
                className="text-xs bg-sky-600 hover:bg-sky-500 text-white font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1"
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
        <div className="bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden">
          {/* Banda de Identidad Tilapia Pro */}
          <div className="bg-linear-to-r from-sky-700 via-sky-600 to-cyan-600 p-6 text-white">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <span className="inline-flex items-center space-x-1.5 bg-white/20 backdrop-blur-xs text-white text-xs font-bold px-3 py-1 rounded-full border border-white/30">
                <Award className="w-3.5 h-3.5 text-amber-300" />
                <span>CERTIFICADO OFICIAL DE TRAZABILIDAD</span>
              </span>

              <span
                className={`text-xs font-bold px-3 py-1 rounded-full ${
                  esCerrado
                    ? 'bg-emerald-500 text-white shadow-xs'
                    : 'bg-amber-400 text-slate-900 font-semibold'
                }`}
              >
                {esCerrado ? '✓ Lote Cosechado y Cerrado' : '● Lote en Cultivo Activo'}
              </span>
            </div>

            <p className="text-xs uppercase tracking-wider text-sky-200 font-bold">Código Único de Lote</p>
            <h2 className="text-2xl sm:text-3xl font-extrabold font-mono tracking-wider text-white mt-0.5">
              {lote.codigo}
            </h2>

            <p className="text-sm text-sky-100 mt-2 font-medium">
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
              <span className="text-slate-500 block">Fecha de Siembra:</span>
              <strong className="text-slate-800 text-sm">{lote.fechaSiembra}</strong>
            </div>
            <div>
              <span className="text-slate-500 block">Fecha Cosecha/Cierre:</span>
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
              className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-md shadow-emerald-700/20 transition-all disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>{descargandoPdf ? 'Generando PDF...' : 'Descargar Certificado Oficial (PDF)'}</span>
            </button>
          </div>
        </div>

        {/* SELLO DE INTEGRIDAD CRIPTOGRÁFICA SHA-256 */}
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Autenticidad Criptográfica Inalterable
                </h3>
                <p className="text-xs text-slate-500">
                  Cada evento del lote está encadenado mediante hash SHA-256 matemáticamente verificable.
                </p>
              </div>
            </div>

            <button
              onClick={handleVerificarIntegridad}
              disabled={verificandoHash}
              className="inline-flex items-center justify-center space-x-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>{verificandoHash ? 'Verificando hashes...' : 'Auditar Integridad Criptográfica'}</span>
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
                    ? '✓ Cadena Criptográfica 100% Auténtica e Íntegra'
                    : '⚠ Inconsistencia detectada en la cadena'}
                </strong>
                <p className="mt-1 text-xs">
                  {resultadoIntegridad.valido
                    ? `Se validaron matemáticamente ${resultadoIntegridad.totalEventos} eventos registrados desde la siembra. Ningún dato ha sido alterado desde su origen.`
                    : `Se detectó una discrepancia a partir del evento #${resultadoIntegridad.primerErrorIndex}.`}
                </p>
              </div>
            </div>
          )}

          {/* Visualización del Hash Final */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
              Sello Hash SHA-256 de Cierre del Lote
            </span>
            <code className="text-[11px] font-mono text-slate-700 break-all select-all block">
              {r?.hashFinal || 'En proceso de cultivo'}
            </code>
          </div>
        </div>

        {/* MÉTRICAS PRODUCTIVAS CLAVE */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-center">
            <span className="text-[11px] text-slate-500 font-medium block">Peces Sembrados</span>
            <strong className="text-lg font-bold text-slate-900 mt-1 block">
              {lote.cantidadSembrada.toLocaleString()}
            </strong>
            <span className="text-[10px] text-slate-400">Alevinos iniciales</span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-center">
            <span className="text-[11px] text-slate-500 font-medium block">Supervivencia</span>
            <strong className="text-lg font-bold text-emerald-600 mt-1 block">
              {r ? `${r.supervivencia.toFixed(1)}%` : '—'}
            </strong>
            <span className="text-[10px] text-slate-400">
              {r ? `${r.pecesVivos.toLocaleString()} vivos` : ''}
            </span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-center">
            <span className="text-[11px] text-slate-500 font-medium block">Peso Promedio</span>
            <strong className="text-lg font-bold text-sky-600 mt-1 block">
              {r ? `${Math.round(r.pesoPromedioActualG)} g` : '—'}
            </strong>
            <span className="text-[10px] text-slate-400">Calibre 450 - 500 g</span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-center">
            <span className="text-[11px] text-slate-500 font-medium block">Biomasa Total</span>
            <strong className="text-lg font-bold text-slate-900 mt-1 block">
              {r ? `${(r.biomasaEstimadaKg || 0).toFixed(0)} kg` : '—'}
            </strong>
            <span className="text-[10px] text-slate-400">
              FCA: {r?.FCA ? r.FCA.toFixed(2) : '1.20'}
            </span>
          </div>
        </div>

        {/* LÍNEA DE TIEMPO DE EVENTOS CRONOLÓGICOS */}
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Historial Cronológico de Vida del Lote
              </h3>
              <p className="text-xs text-slate-500">
                {lote.eventos?.length || 0} eventos registrados cronológicamente
              </p>
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
            <div className="space-y-3 relative before:absolute before:inset-0 before:left-3.5 before:w-0.5 before:bg-slate-200 pt-2">
              {(lote.eventos || []).map((ev) => (
                <div key={ev.id} className="relative flex items-start space-x-3 pl-1">
                  <div className="w-6 h-6 rounded-full bg-sky-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 z-10 shadow-xs">
                    {ev.indice + 1}
                  </div>
                  <div className="flex-1 bg-slate-50 rounded-xl p-3 border border-slate-200/80 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                      <strong className="text-slate-900 font-bold">{ev.tipo}</strong>
                      <span className="text-[11px] text-slate-500 font-mono">{ev.fechaEvento}</span>
                    </div>
                    {ev.descripcion && (
                      <p className="text-slate-600 text-xs mb-2">{ev.descripcion}</p>
                    )}

                    {/* Resumen de datos según tipo */}
                    {ev.datos && Object.keys(ev.datos).length > 0 && (
                      <div className="bg-white p-2 rounded-lg border border-slate-200/60 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                        {Object.entries(ev.datos).map(([clave, valor]) => (
                          <div key={clave}>
                            <span className="text-slate-400 capitalize">{clave}: </span>
                            <span className="font-semibold text-slate-800">{String(valor)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between">
                      <span>Registrado por: {ev.registradoPor}</span>
                      <span className="font-mono text-[9px]">Hash: {ev.hash.substring(0, 12)}...</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* DESTINO COMERCIAL: entregas posteriores al sellado, separadas de la producción */}
        {lote.estado === 'cerrado' && <EntregasPublicas lote={lote} />}

        {/* FICHA NUTRICIONAL */}
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4">
          <div className="flex items-center space-x-2">
            <Apple className="w-5 h-5 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Información Nutricional (Porción 100 g de filete crudo)
            </h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-slate-500 block">Energía</span>
              <strong className="text-base text-slate-900">{config.fichaNutricional.energiaKcal} kcal</strong>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-slate-500 block">Proteína</span>
              <strong className="text-base text-emerald-600">{config.fichaNutricional.proteinaG} g</strong>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-slate-500 block">Grasa Total</span>
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
          Acuicultura de precisión • Tilapia Roja Pro • Cadena Criptográfica Inalterable
        </p>
      </footer>
    </div>
  );
};
