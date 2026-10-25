import React, { useState, useEffect } from 'react';
import {
  Settings,
  Plus,
  Trash2,
  Save,
  CheckCircle,
  AlertCircle,
  Droplets,
  Apple,
  Waves,
  Edit2,
  Check,
  X
} from 'lucide-react';
import {
  ConfiguracionGeneral,
  EstanqueConfig,
  UsuarioPerfil
} from '../types';
import {
  guardarConfiguracion,
  sanitizarEstanques
} from '../services/configService';
import {
  esAdminMaestro,
  esAdministrador,
  verificarPermiso
} from '../services/usuariosService';

interface ConfiguracionTabProps {
  config: ConfiguracionGeneral;
  userEmail: string;
  perfilActual: UsuarioPerfil | null;
  onConfigActualizada: (nuevaConfig: ConfiguracionGeneral) => void;
}

export const ConfiguracionTab: React.FC<ConfiguracionTabProps> = ({
  config,
  userEmail,
  perfilActual,
  onConfigActualizada
}) => {
  const esAdmin = esAdminMaestro(userEmail) || esAdministrador(perfilActual);
  const puedeEstanques = esAdmin || verificarPermiso(perfilActual, 'gestionarEstanques');
  const puedeConfig = esAdmin || verificarPermiso(perfilActual, 'gestionarConfiguracion');

  // Estado local para edición de estanques
  const [estanques, setEstanques] = useState<EstanqueConfig[]>(() =>
    sanitizarEstanques(config.estanques || [])
  );
  const [rangos, setRangos] = useState(config.rangosReferencia);
  const [ficha, setFicha] = useState(config.fichaNutricional);

  // Formulario nuevo estanque
  const [nuevoCodigo, setNuevoCodigo] = useState('');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoVolumen, setNuevoVolumen] = useState<number | ''>(250);

  // Edición inline de estanque
  const [editandoCodigo, setEditandoCodigo] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editVolumen, setEditVolumen] = useState<number | ''>(250);
  const [estanqueAEliminar, setEstanqueAEliminar] = useState<string | null>(null);

  const [guardando, setGuardando] = useState(false);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Mantener sincronizado si cambia la configuración externa
  useEffect(() => {
    if (config.estanques) {
      setEstanques(sanitizarEstanques(config.estanques));
    }
    if (config.rangosReferencia) {
      setRangos(config.rangosReferencia);
    }
    if (config.fichaNutricional) {
      setFicha(config.fichaNutricional);
    }
  }, [config]);

  // Función interna para persistir la configuración completa en Firestore
  const guardarEnFirestore = async (estanquesActualizados: EstanqueConfig[]) => {
    const nuevaConfig: ConfiguracionGeneral = {
      estanques: sanitizarEstanques(estanquesActualizados),
      rangosReferencia: rangos,
      fichaNutricional: ficha
    };

    setGuardando(true);
    setErrorMsg(null);
    try {
      const guardada = await guardarConfiguracion(nuevaConfig, userEmail);
      onConfigActualizada(guardada);
      setMensajeExito('Configuración sincronizada exitosamente en Firestore.');
      setTimeout(() => setMensajeExito(null), 4000);
      return true;
    } catch (err: any) {
      console.error('Error guardando configuración:', err);
      setErrorMsg(err.message || 'Error al guardar configuración en Firestore.');
      return false;
    } finally {
      setGuardando(false);
    }
  };

  // Agregar nuevo estanque (se guarda de inmediato en Firestore)
  const handleAgregarEstanque = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Sanitizar código (alfanumérico, guiones, mayúsculas)
    const codigoLimpio = nuevoCodigo.trim().toUpperCase().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!codigoLimpio) {
      setErrorMsg('El código del estanque es requerido (ej: E3, T3, PISCINA3).');
      return;
    }

    if (estanques.some((est) => est.codigo === codigoLimpio)) {
      setErrorMsg(`El estanque con código "${codigoLimpio}" ya existe en el sistema.`);
      return;
    }

    const volNum = nuevoVolumen === '' ? 250 : Number(nuevoVolumen);
    const nuevo: EstanqueConfig = {
      codigo: codigoLimpio,
      nombre: nuevoNombre.trim() || `Estanque ${codigoLimpio}`,
      volumenM3: isNaN(volNum) || volNum <= 0 ? 250 : volNum
    };

    const nuevaLista = [...estanques, nuevo];
    setEstanques(nuevaLista);
    setNuevoCodigo('');
    setNuevoNombre('');
    setNuevoVolumen(250);

    // Persistir de inmediato para que esté disponible en creación de lotes al instante
    await guardarEnFirestore(nuevaLista);
  };

  // Iniciar edición inline de un estanque
  const handleIniciarEdicion = (est: EstanqueConfig) => {
    setEditandoCodigo(est.codigo);
    setEditNombre(est.nombre);
    setEditVolumen(est.volumenM3 || 250);
  };

  // Guardar edición inline
  const handleGuardarEdicion = async (codigo: string) => {
    const volNum = editVolumen === '' ? 250 : Number(editVolumen);
    const nuevaLista = estanques.map((e) => {
      if (e.codigo === codigo) {
        return {
          ...e,
          nombre: editNombre.trim() || e.nombre,
          volumenM3: isNaN(volNum) || volNum <= 0 ? 250 : volNum
        };
      }
      return e;
    });

    setEstanques(nuevaLista);
    setEditandoCodigo(null);
    await guardarEnFirestore(nuevaLista);
  };

  // Solicitar eliminación de estanque
  const handleSolicitarEliminar = (codigo: string) => {
    setEstanqueAEliminar(codigo);
  };

  // Confirmar y persistir eliminación en Firestore
  const handleConfirmarEliminar = async (codigo: string) => {
    setEstanqueAEliminar(null);
    setErrorMsg(null);
    const nuevaLista = estanques.filter((e) => e.codigo !== codigo);
    setEstanques(nuevaLista);
    const ok = await guardarEnFirestore(nuevaLista);
    if (ok) {
      setMensajeExito(`Estanque ${codigo} eliminado exitosamente.`);
      setTimeout(() => setMensajeExito(null), 4000);
    }
  };

  // Cancelar eliminación
  const handleCancelarEliminar = () => {
    setEstanqueAEliminar(null);
  };

  // Guardar todo el formulario de rangos y ficha nutricional
  const handleGuardarTodo = async () => {
    await guardarEnFirestore(estanques);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Cabecera Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <Settings className="w-5 h-5 text-sky-600" />
            <span>Configuración de Granja y Estanques</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Administración de piscinas/estanques, umbrales de agua en Turbaco y ficha nutricional
          </p>
        </div>

        <button
          onClick={handleGuardarTodo}
          disabled={guardando}
          className="inline-flex items-center space-x-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold shadow-xs transition-colors disabled:opacity-50 shrink-0"
        >
          {guardando ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Guardando en Firestore...</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              <span>Guardar Configuración General</span>
            </>
          )}
        </button>
      </div>

      {mensajeExito && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center space-x-2 text-emerald-800 text-xs shadow-xs animate-fadeIn">
          <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
          <span className="font-medium">{mensajeExito}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-300 rounded-xl flex items-center space-x-2 text-red-800 text-xs shadow-xs animate-fadeIn">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span className="font-medium">{errorMsg}</span>
        </div>
      )}

      {/* 1. SECCIÓN: ESTANQUES DE CULTIVO */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center space-x-2">
              <Waves className="w-5 h-5 text-sky-600" />
              <h2 className="text-base font-bold text-slate-900">
                1. Estanques y Piscinas de Cultivo ({estanques.length})
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Configura tus estanques (E1, E2, E3...). Cualquier estanque agregado aquí se guarda en Firestore y queda disponible de inmediato para crear nuevos lotes y registrar mediciones.
            </p>
          </div>
        </div>

        {/* LISTA DE ESTANQUES ACTUALES */}
        {estanques.length === 0 ? (
          <div className="p-6 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center space-y-1">
            <Waves className="w-8 h-8 mx-auto text-slate-400" />
            <p className="text-xs font-semibold text-slate-700">No hay estanques configurados actualmente</p>
            <p className="text-[11px] text-slate-500">Agrega uno abajo usando el formulario (ej: E1, E2, E3...)</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {estanques.map((est) => {
              const isEditing = editandoCodigo === est.codigo;
              const isDeleting = estanqueAEliminar === est.codigo;

              return (
                <div
                  key={est.codigo}
                  className={`p-3.5 rounded-xl border transition-all ${
                    isDeleting
                      ? 'bg-red-50/70 border-red-300 ring-2 ring-red-300/40'
                      : isEditing
                      ? 'bg-sky-50/50 border-sky-400 ring-2 ring-sky-300/50'
                      : 'bg-slate-50/80 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {isEditing ? (
                    /* Modo edición inline */
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-xs bg-sky-200 text-sky-900 px-2 py-0.5 rounded">
                          {est.codigo}
                        </span>
                        <div className="flex items-center space-x-1">
                          <button
                            type="button"
                            onClick={() => handleGuardarEdicion(est.codigo)}
                            className="p-1 text-emerald-600 hover:bg-emerald-100 rounded"
                            title="Guardar cambios"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditandoCodigo(null)}
                            className="p-1 text-slate-400 hover:bg-slate-200 rounded"
                            title="Cancelar"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 block">Nombre</label>
                        <input
                          type="text"
                          value={editNombre}
                          onChange={(e) => setEditNombre(e.target.value)}
                          className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 block">Volumen (m³)</label>
                        <input
                          type="number"
                          value={editVolumen}
                          onChange={(e) => setEditVolumen(e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                        />
                      </div>
                    </div>
                  ) : isDeleting ? (
                    /* Confirmación inline de eliminación (sin window.confirm) */
                    <div className="space-y-2">
                      <div className="flex items-center space-x-1.5 text-red-700">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span className="text-xs font-bold">¿Eliminar estanque {est.codigo}?</span>
                      </div>
                      <p className="text-[11px] text-slate-600">
                        Se retirará de la lista y se sincronizará en Firestore.
                      </p>
                      <div className="flex items-center space-x-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleConfirmarEliminar(est.codigo)}
                          disabled={guardando}
                          className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold transition-colors shadow-xs"
                        >
                          Sí, eliminar
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelarEliminar}
                          className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-xs font-medium transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Vista normal */
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-sm bg-sky-100 text-sky-800 px-2.5 py-0.5 rounded-lg border border-sky-200">
                            {est.codigo}
                          </span>
                          <span className="text-xs font-bold text-slate-900">{est.nombre}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5 flex items-center space-x-1">
                          <span className="font-semibold text-slate-700">Volumen:</span>
                          <span>{est.volumenM3 ? `${est.volumenM3} m³` : '250 m³'}</span>
                        </p>
                      </div>

                      {puedeEstanques && (
                        <div className="flex items-center space-x-1">
                          <button
                            type="button"
                            onClick={() => handleIniciarEdicion(est)}
                            className="text-slate-400 hover:text-sky-600 p-1 rounded hover:bg-slate-200/60 transition-colors"
                            title="Editar estanque"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSolicitarEliminar(est.codigo)}
                            className="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-slate-200/60 transition-colors"
                            title="Eliminar estanque"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* FORMULARIO PARA AGREGAR NUEVO ESTANQUE */}
        {puedeEstanques ? (
          <form
            onSubmit={handleAgregarEstanque}
            className="pt-4 border-t border-slate-100 bg-sky-50/40 p-4 rounded-xl border border-sky-100 flex flex-wrap items-end gap-3"
          >
            <div className="w-full sm:w-auto">
              <span className="text-xs font-bold text-sky-950 block mb-2">
                ➕ Añadir Nuevo Estanque / Piscina
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Código Único * (ej: E3)
              </label>
              <input
                type="text"
                required
                placeholder="E3"
                value={nuevoCodigo}
                onChange={(e) => setNuevoCodigo(e.target.value)}
                className="w-24 px-3 py-1.5 text-xs font-mono font-bold border border-slate-300 rounded-lg uppercase bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Nombre Descriptivo
              </label>
              <input
                type="text"
                placeholder="Ej: Estanque 3 (Geomembrana Circular)"
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Volumen (m³)
              </label>
              <input
                type="number"
                min="1"
                placeholder="250"
                value={nuevoVolumen}
                onChange={(e) => setNuevoVolumen(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-24 px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <button
              type="submit"
              disabled={guardando}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold inline-flex items-center space-x-1.5 shadow-xs transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>Agregar y Guardar Estanque</span>
            </button>
          </form>
        ) : (
          <p className="text-xs text-slate-400 italic">
            Para crear o modificar estanques requieres el permiso "Crear piscinas / estanques" otorgado por Carlos.
          </p>
        )}
      </div>

      {/* 2. SECCIÓN: RANGOS DE REFERENCIA DE CALIDAD DEL AGUA */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <Droplets className="w-5 h-5 text-sky-600" />
            <span>2. Rangos de Referencia para Calidad del Agua</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Valores estándar para la cuenca de Turbaco (Bolívar). Mediciones registradas fuera de estos límites disparan alertas técnicas automáticas.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {/* Temperatura */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <span className="text-xs font-bold text-slate-800 block">Temperatura del Agua (°C)</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500">Mínimo</label>
                <input
                  type="number"
                  step="0.5"
                  disabled={!puedeConfig}
                  value={rangos.temperaturaMin}
                  onChange={(e) => setRangos({ ...rangos, temperaturaMin: Number(e.target.value) })}
                  className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500">Máximo</label>
                <input
                  type="number"
                  step="0.5"
                  disabled={!puedeConfig}
                  value={rangos.temperaturaMax}
                  onChange={(e) => setRangos({ ...rangos, temperaturaMax: Number(e.target.value) })}
                  className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>
          </div>

          {/* Oxígeno Disuelto */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <span className="text-xs font-bold text-slate-800 block">Oxígeno Disuelto (mg/L)</span>
            <div>
              <label className="text-[10px] text-slate-500">Mínimo Crítico Recomendado</label>
              <input
                type="number"
                step="0.1"
                disabled={!puedeConfig}
                value={rangos.oxigenoMin}
                onChange={(e) => setRangos({ ...rangos, oxigenoMin: Number(e.target.value) })}
                className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
              />
            </div>
          </div>

          {/* pH */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <span className="text-xs font-bold text-slate-800 block">pH</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500">Mínimo</label>
                <input
                  type="number"
                  step="0.1"
                  disabled={!puedeConfig}
                  value={rangos.phMin}
                  onChange={(e) => setRangos({ ...rangos, phMin: Number(e.target.value) })}
                  className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500">Máximo</label>
                <input
                  type="number"
                  step="0.1"
                  disabled={!puedeConfig}
                  value={rangos.phMax}
                  onChange={(e) => setRangos({ ...rangos, phMax: Number(e.target.value) })}
                  className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>
          </div>

          {/* Amonio total */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <span className="text-xs font-bold text-slate-800 block">Amonio Total (mg/L)</span>
            <div>
              <label className="text-[10px] text-slate-500">Máximo Permitido</label>
              <input
                type="number"
                step="0.1"
                disabled={!puedeConfig}
                value={rangos.amonioMax}
                onChange={(e) => setRangos({ ...rangos, amonioMax: Number(e.target.value) })}
                className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
              />
            </div>
          </div>

          {/* Nitritos */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <span className="text-xs font-bold text-slate-800 block">Nitritos (mg/L)</span>
            <div>
              <label className="text-[10px] text-slate-500">Máximo Permitido (Tóxico)</label>
              <input
                type="number"
                step="0.01"
                disabled={!puedeConfig}
                value={rangos.nitritosMax}
                onChange={(e) => setRangos({ ...rangos, nitritosMax: Number(e.target.value) })}
                className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
              />
            </div>
          </div>

          {/* Transparencia Secchi */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <span className="text-xs font-bold text-slate-800 block">Transparencia Disco Secchi (cm)</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500">Mínimo</label>
                <input
                  type="number"
                  step="1"
                  disabled={!puedeConfig}
                  value={rangos.secchiMin}
                  onChange={(e) => setRangos({ ...rangos, secchiMin: Number(e.target.value) })}
                  className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500">Máximo</label>
                <input
                  type="number"
                  step="1"
                  disabled={!puedeConfig}
                  value={rangos.secchiMax}
                  onChange={(e) => setRangos({ ...rangos, secchiMax: Number(e.target.value) })}
                  className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. SECCIÓN: FICHA NUTRICIONAL REFERENCIAL */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <Apple className="w-5 h-5 text-emerald-600" />
            <span>3. Ficha Nutricional (por 100 g de tilapia cruda)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Aparece impresa en el certificado PDF oficial de cada lote como respaldo para restaurantes y distribuidores.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Energía (kcal)</label>
            <input
              type="number"
              disabled={!puedeConfig}
              value={ficha.energiaKcal}
              onChange={(e) => setFicha({ ...ficha, energiaKcal: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Proteína (g)</label>
            <input
              type="number"
              step="0.1"
              disabled={!puedeConfig}
              value={ficha.proteinaG}
              onChange={(e) => setFicha({ ...ficha, proteinaG: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Grasa total (g)</label>
            <input
              type="number"
              step="0.1"
              disabled={!puedeConfig}
              value={ficha.grasaTotalG}
              onChange={(e) => setFicha({ ...ficha, grasaTotalG: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Carbohidratos (g)</label>
            <input
              type="number"
              step="0.1"
              disabled={!puedeConfig}
              value={ficha.carbohidratosG}
              onChange={(e) => setFicha({ ...ficha, carbohidratosG: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Colesterol (mg)</label>
            <input
              type="number"
              disabled={!puedeConfig}
              value={ficha.colesterolMg}
              onChange={(e) => setFicha({ ...ficha, colesterolMg: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Sodio (mg)</label>
            <input
              type="number"
              disabled={!puedeConfig}
              value={ficha.sodioMg}
              onChange={(e) => setFicha({ ...ficha, sodioMg: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Fuente Referencial</label>
            <input
              type="text"
              disabled={!puedeConfig}
              value={ficha.fuente}
              onChange={(e) => setFicha({ ...ficha, fuente: e.target.value })}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Notas al pie</label>
            <input
              type="text"
              disabled={!puedeConfig}
              value={ficha.notas}
              onChange={(e) => setFicha({ ...ficha, notas: e.target.value })}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
