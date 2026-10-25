import React, { useState } from 'react';
import { X, Calendar, AlertTriangle, CheckCircle2, ShieldAlert, Lock } from 'lucide-react';
import { Lote, TipoEvento, ConfiguracionGeneral } from '../types';
import { getFechaHoyBogota } from '../utils/constants';
import { registrarEventoEnLote } from '../services/lotesService';
import { evaluarParametroAgua } from '../services/calculosService';

interface NuevoEventoModalProps {
  isOpen: boolean;
  onClose: () => void;
  lote: Lote;
  config: ConfiguracionGeneral;
  userEmail: string;
  onEventoRegistrado: (loteActualizado: Lote) => void;
}

const TIPOS_EVENTO: TipoEvento[] = [
  'Calidad del agua',
  'Alimentación',
  'Muestreo de crecimiento (biometría)',
  'Mortalidad',
  'Probióticos',
  'Tratamiento o manejo sanitario',
  'Cosecha',
  'Proceso',
  'Empaque y conservación',
  'Despacho/transporte',
  'Observación',
  'Corrección'
];

export const NuevoEventoModal: React.FC<NuevoEventoModalProps> = ({
  isOpen,
  onClose,
  lote,
  config,
  userEmail,
  onEventoRegistrado
}) => {
  const hoy = getFechaHoyBogota();
  const [tipo, setTipo] = useState<TipoEvento>('Calidad del agua');
  const [fechaEvento, setFechaEvento] = useState(hoy);
  const [descripcion, setDescripcion] = useState('');
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Estados específicos para formularios dinámicos
  // 1. Calidad del agua
  const [tempAgua, setTempAgua] = useState<number | ''>(28.5);
  const [oxigeno, setOxigeno] = useState<number | ''>(5.5);
  const [phAgua, setPhAgua] = useState<number | ''>(7.4);
  const [amonio, setAmonio] = useState<number | ''>(0.2);
  const [nitritos, setNitritos] = useState<number | ''>(0.02);
  const [secchi, setSecchi] = useState<number | ''>(35);

  // 2. Alimentación
  const [tipoAlimento, setTipoAlimento] = useState('Extruido iniciación 38%');
  const [pctProteina, setPctProteina] = useState<number | ''>(38);
  const [cantAlimentoKg, setCantAlimentoKg] = useState<number | ''>(15);
  const [numRaciones, setNumRaciones] = useState<number | ''>(4);

  // 3. Biometría
  const [pecesMuestreados, setPecesMuestreados] = useState<number | ''>(50);
  const [pesoPromedioG, setPesoPromedioG] = useState<number | ''>(
    lote.resumen.pesoPromedioActualG || lote.pesoInicialPromedioG || 50
  );
  const [tallaPromedioCm, setTallaPromedioCm] = useState<number | ''>(12);
  const [etapaCultivo, setEtapaCultivo] = useState('Levante');

  // 4. Mortalidad
  const [cantMortalidad, setCantMortalidad] = useState<number | ''>(2);
  const [causaMortalidad, setCausaMortalidad] = useState('Mortalidad natural / adaptación');

  // 5. Probióticos
  const [prodProbiotico, setProdProbiotico] = useState('Bacillus subtilis complex');
  const [dosisProbiotico, setDosisProbiotico] = useState<number | ''>(250);
  const [unidadProbiotico, setUnidadProbiotico] = useState('g');
  const [viaProbiotico, setViaProbiotico] = useState<'Agua' | 'Alimento'>('Agua');
  const [objetivoProbiotico, setObjetivoProbiotico] = useState('Biorremediación y equilibrio bacteriano');

  // 6. Tratamiento sanitario
  const [descTratamiento, setDescTratamiento] = useState('');
  const [prodTratamiento, setProdTratamiento] = useState('');
  const [dosisTratamiento, setDosisTratamiento] = useState('');

  // 7. Cosecha
  const [pecesCosechados, setPecesCosechados] = useState<number | ''>(1000);
  const [biomasaCosechadaKg, setBiomasaCosechadaKg] = useState<number | ''>(480);
  const [pesoPromCosechaG, setPesoPromCosechaG] = useState<number | ''>(480);

  // 8. Proceso
  const [escamadoEviscerado, setEscamadoEviscerado] = useState(true);
  const [cantProcesada, setCantProcesada] = useState<number | ''>(1000);
  const [pesoPromFinalG, setPesoPromFinalG] = useState<number | ''>(475);
  const [responsableProceso, setResponsableProceso] = useState('Planta de beneficio Loré');

  // 9. Empaque y conservación
  const [tipoEmpaque, setTipoEmpaque] = useState('Caja térmica sellada con bolsa plástica grado alimentario');
  const [tempConservacionC, setTempConservacionC] = useState<number | ''>(2);
  const [usoHielo, setUsoHielo] = useState(true);

  // 10. Despacho / transporte
  const [fechaHoraSalida, setFechaHoraSalida] = useState(`${hoy}T08:00`);
  const [destinoDespacho, setDestinoDespacho] = useState('Restaurante El Pescador, Cartagena');
  const [contenedorIsotermico, setContenedorIsotermico] = useState(true);
  const [tempDespachoC, setTempDespachoC] = useState<number | ''>(2.5);
  const [responsableDespacho, setResponsableDespacho] = useState('Transporte Refrigerado Loré');

  // 11. Corrección
  const [eventoCorregidoId, setEventoCorregidoId] = useState(
    lote.eventos && lote.eventos.length > 0 ? lote.eventos[lote.eventos.length - 1].id : ''
  );

  if (!isOpen) return null;

  // Evaluaciones en tiempo real de agua
  const rangos = config.rangosReferencia;
  const evalTemp = evaluarParametroAgua('temperatura', tempAgua === '' ? null : Number(tempAgua), rangos);
  const evalOx = evaluarParametroAgua('oxigenoDisuelto', oxigeno === '' ? null : Number(oxigeno), rangos);
  const evalPh = evaluarParametroAgua('ph', phAgua === '' ? null : Number(phAgua), rangos);
  const evalAm = evaluarParametroAgua('amonioTotal', amonio === '' ? null : Number(amonio), rangos);
  const evalNit = evaluarParametroAgua('nitritos', nitritos === '' ? null : Number(nitritos), rangos);
  const evalSec = evaluarParametroAgua('transparenciaSecchi', secchi === '' ? null : Number(secchi), rangos);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (lote.estado === 'cerrado') {
      setErrorMsg('Operación denegada: Este lote se encuentra sellado y cerrado. Está estrictamente bloqueada la incorporación de nuevos registros de producción.');
      return;
    }

    if (!fechaEvento) {
      setErrorMsg('Selecciona la fecha del evento.');
      return;
    }
    if (fechaEvento > hoy) {
      setErrorMsg('La fecha del evento no puede ser posterior a hoy.');
      return;
    }

    // Construir payload según el tipo
    const datos: Record<string, any> = {};

    if (tipo === 'Calidad del agua') {
      datos.temperatura = Number(tempAgua);
      datos.oxigenoDisuelto = Number(oxigeno);
      datos.ph = Number(phAgua);
      datos.amonioTotal = Number(amonio);
      datos.nitritos = Number(nitritos);
      datos.transparenciaSecchi = Number(secchi);
    } else if (tipo === 'Alimentación') {
      if (!cantAlimentoKg || Number(cantAlimentoKg) <= 0) {
        setErrorMsg('La cantidad de alimento debe ser mayor que 0 kg.');
        return;
      }
      datos.tipoAlimento = tipoAlimento.trim();
      datos.pctProteina = Number(pctProteina) || 0;
      datos.cantidadKg = Number(cantAlimentoKg);
      datos.numeroRaciones = Number(numRaciones) || 1;
    } else if (tipo === 'Muestreo de crecimiento (biometría)') {
      if (!pesoPromedioG || Number(pesoPromedioG) <= 0) {
        setErrorMsg('El peso promedio debe ser mayor que 0 gramos.');
        return;
      }
      datos.pecesMuestreados = Number(pecesMuestreados) || 0;
      datos.pesoPromedioG = Number(pesoPromedioG);
      datos.tallaPromedioCm = Number(tallaPromedioCm) || 0;
      datos.etapa = etapaCultivo;
    } else if (tipo === 'Mortalidad') {
      if (!cantMortalidad || Number(cantMortalidad) < 1) {
        setErrorMsg('La cantidad de mortalidad debe ser al menos 1 pez.');
        return;
      }
      datos.cantidad = Number(cantMortalidad);
      datos.causaProbable = causaMortalidad.trim() || 'No especificada';
    } else if (tipo === 'Probióticos') {
      datos.producto = prodProbiotico.trim();
      datos.dosis = Number(dosisProbiotico) || 0;
      datos.unidad = unidadProbiotico.trim();
      datos.viaAplicacion = viaProbiotico;
      datos.objetivo = objetivoProbiotico.trim();
    } else if (tipo === 'Tratamiento o manejo sanitario') {
      datos.descripcion = descTratamiento.trim() || descripcion.trim();
      datos.producto = prodTratamiento.trim();
      datos.dosis = dosisTratamiento.trim();
    } else if (tipo === 'Cosecha') {
      if (!pecesCosechados || Number(pecesCosechados) <= 0) {
        setErrorMsg('Indica la cantidad de peces cosechados.');
        return;
      }
      datos.pecesCosechados = Number(pecesCosechados);
      datos.biomasaCosechadaKg = Number(biomasaCosechadaKg) || 0;
      datos.pesoPromedioG = Number(pesoPromCosechaG) || 0;
    } else if (tipo === 'Proceso') {
      datos.escamadoEviscerado = escamadoEviscerado;
      datos.cantidadProcesada = Number(cantProcesada) || 0;
      datos.pesoPromedioFinalG = Number(pesoPromFinalG) || 0;
      datos.responsable = responsableProceso.trim();
    } else if (tipo === 'Empaque y conservación') {
      datos.tipoEmpaque = tipoEmpaque.trim();
      datos.temperaturaConservacionC = Number(tempConservacionC);
      datos.usoHielo = usoHielo;
    } else if (tipo === 'Despacho/transporte') {
      datos.fechaHoraSalida = fechaHoraSalida;
      datos.destino = destinoDespacho.trim();
      datos.contenedorIsotermico = contenedorIsotermico;
      datos.temperaturaDespachoC = Number(tempDespachoC);
      datos.responsable = responsableDespacho.trim();
    } else if (tipo === 'Corrección') {
      if (!eventoCorregidoId) {
        setErrorMsg('Debes seleccionar el evento previo a corregir.');
        return;
      }
      if (!descripcion.trim()) {
        setErrorMsg('Debes incluir la explicación detallada de la corrección.');
        return;
      }
      datos.eventoCorregidoId = eventoCorregidoId;
      datos.motivoCorreccion = descripcion.trim();
    }

    setCargando(true);
    try {
      const loteActualizado = await registrarEventoEnLote({
        codigoLote: lote.codigo,
        tipo,
        fechaEvento,
        descripcion: descripcion.trim(),
        datos,
        userEmail,
        config
      });

      if (loteActualizado) {
        onEventoRegistrado(loteActualizado);
        onClose();
      }
    } catch (err: any) {
      console.error('Error registrando evento:', err);
      setErrorMsg(err.message || 'Error al guardar el evento en Firestore.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden my-6">
        {/* Cabecera */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-base">Registrar Evento de Trazabilidad</h3>
            <p className="text-xs text-slate-400">
              Lote: <strong className="text-sky-400">{lote.codigo}</strong> • Evento #{lote.eventos?.length || 0}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={cargando}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Si el lote está sellado, mostrar pantalla de bloqueo */ }
        {lote.estado === 'cerrado' ? (
          <div className="p-8 text-center space-y-4">
            <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto text-amber-600">
              <Lock className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-base font-bold text-slate-900">Lote Sellado y Cerrado</h4>
              <p className="text-xs text-slate-600 mt-1.5 max-w-md mx-auto">
                El lote <strong className="font-mono text-slate-900">{lote.codigo}</strong> completó su ciclo de producción y su trazabilidad inalterable SHA-256 está sellada. Queda terminantemente bloqueada la incorporación de nuevos registros de producción o modificaciones.
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Cerrar Ventana
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2 text-red-700 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Selector de Tipo y Fecha */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tipo de Evento *
              </label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoEvento)}
                disabled={cargando}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white font-medium"
              >
                {TIPOS_EVENTO.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Fecha del Evento (Bogotá) *
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="date"
                  required
                  max={hoy}
                  value={fechaEvento}
                  onChange={(e) => setFechaEvento(e.target.value)}
                  disabled={cargando}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>

          {/* FORMULARIOS DINÁMICOS SEGÚN EL TIPO */}

          {/* 1. CALIDAD DEL AGUA */}
          {tipo === 'Calidad del agua' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-slate-700">Parámetros Fisicoquímicos</span>
                <span className="text-[11px] text-slate-500">Comparación automática con rangos de Turbaco</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {/* Temp */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-medium text-slate-700">Temperatura (°C)</label>
                    {evalTemp.fueraDeRango ? (
                      <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.2 rounded font-semibold">Fuera</span>
                    ) : (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.2 rounded font-semibold">Óptimo</span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={tempAgua}
                    onChange={(e) => setTempAgua(e.target.value === '' ? '' : Number(e.target.value))}
                    className={`w-full px-2.5 py-1.5 text-xs border rounded-md ${evalTemp.fueraDeRango ? 'border-red-400 bg-red-50/50' : 'border-slate-300'}`}
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Rango: {rangos.temperaturaMin}-{rangos.temperaturaMax} °C</p>
                </div>

                {/* Oxígeno */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-medium text-slate-700">O₂ Disuelto (mg/L)</label>
                    {evalOx.fueraDeRango ? (
                      <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.2 rounded font-semibold">Crítico</span>
                    ) : (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.2 rounded font-semibold">Óptimo</span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={oxigeno}
                    onChange={(e) => setOxigeno(e.target.value === '' ? '' : Number(e.target.value))}
                    className={`w-full px-2.5 py-1.5 text-xs border rounded-md ${evalOx.fueraDeRango ? 'border-red-400 bg-red-50/50' : 'border-slate-300'}`}
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Mínimo: {rangos.oxigenoMin} mg/L</p>
                </div>

                {/* pH */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-medium text-slate-700">pH</label>
                    {evalPh.fueraDeRango ? (
                      <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.2 rounded font-semibold">Fuera</span>
                    ) : (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.2 rounded font-semibold">Óptimo</span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.05"
                    required
                    value={phAgua}
                    onChange={(e) => setPhAgua(e.target.value === '' ? '' : Number(e.target.value))}
                    className={`w-full px-2.5 py-1.5 text-xs border rounded-md ${evalPh.fueraDeRango ? 'border-red-400 bg-red-50/50' : 'border-slate-300'}`}
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Rango: {rangos.phMin}-{rangos.phMax}</p>
                </div>

                {/* Amonio */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-medium text-slate-700">Amonio total (mg/L)</label>
                    {evalAm.fueraDeRango ? (
                      <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.2 rounded font-semibold">Alto</span>
                    ) : (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.2 rounded font-semibold">Óptimo</span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={amonio}
                    onChange={(e) => setAmonio(e.target.value === '' ? '' : Number(e.target.value))}
                    className={`w-full px-2.5 py-1.5 text-xs border rounded-md ${evalAm.fueraDeRango ? 'border-red-400 bg-red-50/50' : 'border-slate-300'}`}
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Máximo: {rangos.amonioMax} mg/L</p>
                </div>

                {/* Nitritos */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-medium text-slate-700">Nitritos (mg/L)</label>
                    {evalNit.fueraDeRango ? (
                      <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.2 rounded font-semibold">Tóxico</span>
                    ) : (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.2 rounded font-semibold">Óptimo</span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.005"
                    required
                    value={nitritos}
                    onChange={(e) => setNitritos(e.target.value === '' ? '' : Number(e.target.value))}
                    className={`w-full px-2.5 py-1.5 text-xs border rounded-md ${evalNit.fueraDeRango ? 'border-red-400 bg-red-50/50' : 'border-slate-300'}`}
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Máximo: {rangos.nitritosMax} mg/L</p>
                </div>

                {/* Secchi */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-medium text-slate-700">Transp. Secchi (cm)</label>
                    {evalSec.fueraDeRango ? (
                      <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.2 rounded font-semibold">Fuera</span>
                    ) : (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.2 rounded font-semibold">Óptimo</span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="1"
                    required
                    value={secchi}
                    onChange={(e) => setSecchi(e.target.value === '' ? '' : Number(e.target.value))}
                    className={`w-full px-2.5 py-1.5 text-xs border rounded-md ${evalSec.fueraDeRango ? 'border-red-400 bg-red-50/50' : 'border-slate-300'}`}
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Rango: {rangos.secchiMin}-{rangos.secchiMax} cm</p>
                </div>
              </div>
            </div>
          )}

          {/* 2. ALIMENTACIÓN */}
          {tipo === 'Alimentación' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tipo de Alimento</label>
                <input
                  type="text"
                  required
                  value={tipoAlimento}
                  onChange={(e) => setTipoAlimento(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">% de Proteína</label>
                <input
                  type="number"
                  step="0.5"
                  value={pctProteina}
                  onChange={(e) => setPctProteina(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Cantidad Alimento (kg) *</label>
                <input
                  type="number"
                  step="0.1"
                  required
                  min="0.1"
                  value={cantAlimentoKg}
                  onChange={(e) => setCantAlimentoKg(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Número de Raciones</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={numRaciones}
                  onChange={(e) => setNumRaciones(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>
          )}

          {/* 3. BIOMETRÍA */}
          {tipo === 'Muestreo de crecimiento (biometría)' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Peces Muestreados</label>
                <input
                  type="number"
                  min="1"
                  value={pecesMuestreados}
                  onChange={(e) => setPecesMuestreados(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Peso Promedio (g) *</label>
                <input
                  type="number"
                  step="0.1"
                  required
                  min="0.1"
                  value={pesoPromedioG}
                  onChange={(e) => setPesoPromedioG(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Talla Promedio (cm)</label>
                <input
                  type="number"
                  step="0.1"
                  value={tallaPromedioCm}
                  onChange={(e) => setTallaPromedioCm(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Etapa de Cultivo</label>
                <select
                  value={etapaCultivo}
                  onChange={(e) => setEtapaCultivo(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
                >
                  <option value="Alevinaje">Alevinaje</option>
                  <option value="Levante">Levante</option>
                  <option value="Engorde">Engorde</option>
                  <option value="Finalización">Finalización</option>
                </select>
              </div>
            </div>
          )}

          {/* 4. MORTALIDAD */}
          {tipo === 'Mortalidad' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Cantidad de Peces *</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={cantMortalidad}
                  onChange={(e) => setCantMortalidad(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Causa Probable</label>
                <input
                  type="text"
                  placeholder="ej: Adaptación, hipoxia nocturna, manipulación..."
                  value={causaMortalidad}
                  onChange={(e) => setCausaMortalidad(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>
          )}

          {/* 5. PROBIÓTICOS */}
          {tipo === 'Probióticos' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Producto</label>
                <input
                  type="text"
                  required
                  value={prodProbiotico}
                  onChange={(e) => setProdProbiotico(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Dosis</label>
                  <input
                    type="number"
                    step="0.1"
                    value={dosisProbiotico}
                    onChange={(e) => setDosisProbiotico(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Unidad</label>
                  <input
                    type="text"
                    value={unidadProbiotico}
                    onChange={(e) => setUnidadProbiotico(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Vía de Aplicación</label>
                <select
                  value={viaProbiotico}
                  onChange={(e) => setViaProbiotico(e.target.value as any)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
                >
                  <option value="Agua">Agua del estanque</option>
                  <option value="Alimento">Mezclado en alimento</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Objetivo</label>
                <input
                  type="text"
                  value={objetivoProbiotico}
                  onChange={(e) => setObjetivoProbiotico(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>
          )}

          {/* 6. TRATAMIENTO SANITARIO */}
          {tipo === 'Tratamiento o manejo sanitario' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Descripción del Manejo</label>
                <input
                  type="text"
                  required
                  placeholder="ej: Baño profiláctico con sal marina, adición de melaza..."
                  value={descTratamiento}
                  onChange={(e) => setDescTratamiento(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Producto</label>
                  <input
                    type="text"
                    value={prodTratamiento}
                    onChange={(e) => setProdTratamiento(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Dosis</label>
                  <input
                    type="text"
                    value={dosisTratamiento}
                    onChange={(e) => setDosisTratamiento(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 7. COSECHA */}
          {tipo === 'Cosecha' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Peces Cosechados *</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={pecesCosechados}
                  onChange={(e) => setPecesCosechados(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Biomasa Cosechada (kg) *</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  required
                  value={biomasaCosechadaKg}
                  onChange={(e) => setBiomasaCosechadaKg(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Peso Promedio (g)</label>
                <input
                  type="number"
                  step="0.1"
                  value={pesoPromCosechaG}
                  onChange={(e) => setPesoPromCosechaG(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>
          )}

          {/* 8. PROCESO */}
          {tipo === 'Proceso' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="escamado"
                  checked={escamadoEviscerado}
                  onChange={(e) => setEscamadoEviscerado(e.target.checked)}
                  className="rounded text-sky-600 focus:ring-sky-500 h-4 w-4"
                />
                <label htmlFor="escamado" className="text-xs font-medium text-slate-700">
                  Escamado y eviscerado completo verificado (Calibre 450 - 500 g)
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Cantidad Procesada</label>
                  <input
                    type="number"
                    min="1"
                    value={cantProcesada}
                    onChange={(e) => setCantProcesada(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Peso Promedio Final (g)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={pesoPromFinalG}
                    onChange={(e) => setPesoPromFinalG(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Responsable</label>
                  <input
                    type="text"
                    value={responsableProceso}
                    onChange={(e) => setResponsableProceso(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 9. EMPAQUE Y CONSERVACIÓN */}
          {tipo === 'Empaque y conservación' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tipo de Empaque</label>
                <input
                  type="text"
                  value={tipoEmpaque}
                  onChange={(e) => setTipoEmpaque(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Temp. Conservación (°C)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={tempConservacionC}
                    onChange={(e) => setTempConservacionC(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div className="flex items-center pt-5">
                  <input
                    type="checkbox"
                    id="hielo"
                    checked={usoHielo}
                    onChange={(e) => setUsoHielo(e.target.checked)}
                    className="rounded text-sky-600 focus:ring-sky-500 h-4 w-4"
                  />
                  <label htmlFor="hielo" className="ml-2 text-xs font-medium text-slate-700">
                    Uso de hielo en escamas para cadena de frío
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* 10. DESPACHO Y TRANSPORTE */}
          {tipo === 'Despacho/transporte' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Fecha y Hora de Salida</label>
                  <input
                    type="datetime-local"
                    value={fechaHoraSalida}
                    onChange={(e) => setFechaHoraSalida(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Destino (Restaurante / Cliente)</label>
                  <input
                    type="text"
                    required
                    value={destinoDespacho}
                    onChange={(e) => setDestinoDespacho(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Temp. Despacho (°C)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={tempDespachoC}
                    onChange={(e) => setTempDespachoC(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Responsable Despacho</label>
                  <input
                    type="text"
                    value={responsableDespacho}
                    onChange={(e) => setResponsableDespacho(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div className="flex items-center pt-5">
                  <input
                    type="checkbox"
                    id="isotermico"
                    checked={contenedorIsotermico}
                    onChange={(e) => setContenedorIsotermico(e.target.checked)}
                    className="rounded text-sky-600 focus:ring-sky-500 h-4 w-4"
                  />
                  <label htmlFor="isotermico" className="ml-2 text-xs font-medium text-slate-700">
                    Contenedor isotérmico con hielo
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* 11. CORRECCIÓN */}
          {tipo === 'Corrección' && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
              <div className="text-xs text-amber-900 font-medium">
                Los eventos no se editan ni eliminan para proteger la trazabilidad. Una corrección agrega un bloque inalterable que referencia el error detectado.
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Evento previo a corregir *
                </label>
                <select
                  required
                  value={eventoCorregidoId}
                  onChange={(e) => setEventoCorregidoId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white font-mono"
                >
                  {(lote.eventos || []).map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      #{ev.indice} • {ev.fechaEvento} • {ev.tipo} — {ev.descripcion || 'Sin descripción'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Campo común: Descripción / Notas */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Descripción / Notas del Evento {tipo === 'Corrección' || tipo === 'Observación' ? '*' : '(opcional)'}
            </label>
            <textarea
              rows={2}
              required={tipo === 'Corrección' || tipo === 'Observación'}
              placeholder="Detalles adicionales, comportamiento de los peces, observaciones técnicas..."
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              disabled={cargando}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={cargando}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={cargando}
              className="px-5 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-500 rounded-lg shadow-xs transition-colors disabled:opacity-50 flex items-center space-x-2"
            >
              {cargando ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Calculando SHA-256 y guardando...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Guardar evento en la cadena</span>
                </>
              )}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
};
