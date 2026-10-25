import React, { useState } from 'react';
import { X, PlusCircle, AlertCircle, Calendar, Hash, Scale, Building2, FileText } from 'lucide-react';
import { ConfiguracionGeneral, Lote, UsuarioPerfil } from '../types';
import { getFechaHoyBogota } from '../utils/constants';
import { crearNuevoLote } from '../services/lotesService';
import { esAdminMaestro, verificarPermiso } from '../services/usuariosService';

interface NuevoLoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ConfiguracionGeneral;
  userEmail: string;
  perfilActual: UsuarioPerfil | null;
  onLoteCreado: (lote: Lote) => void;
}

export const NuevoLoteModal: React.FC<NuevoLoteModalProps> = ({
  isOpen,
  onClose,
  config,
  userEmail,
  perfilActual,
  onLoteCreado
}) => {
  const hoy = getFechaHoyBogota();
  const esAdmin = esAdminMaestro(userEmail);
  const puedeCrear = esAdmin || verificarPermiso(perfilActual, 'crearLotes');
  const [estanque, setEstanque] = useState(config.estanques[0]?.codigo || 'E1');
  const [fechaSiembra, setFechaSiembra] = useState(hoy);
  const [cantidadSembrada, setCantidadSembrada] = useState<number | ''>(5000);
  const [pesoInicialPromedioG, setPesoInicialPromedioG] = useState<number | ''>(2.5);
  const [proveedorAlevinos, setProveedorAlevinos] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Mantener actualizado el estanque por defecto si se agregan estanques dinámicamente
  React.useEffect(() => {
    if (config.estanques && config.estanques.length > 0) {
      if (!config.estanques.some((e) => e.codigo === estanque)) {
        setEstanque(config.estanques[0].codigo);
      }
    }
  }, [config.estanques, estanque]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!puedeCrear) {
      setErrorMsg('Tu cuenta no tiene autorización para crear nuevos lotes. Solo el administrador maestro Carlos (carlosbs1579@gmail.com) puede concederte este permiso.');
      return;
    }

    const cant = Number(cantidadSembrada);
    const peso = Number(pesoInicialPromedioG);

    if (!estanque) {
      setErrorMsg('Debes seleccionar un estanque.');
      return;
    }
    if (!fechaSiembra) {
      setErrorMsg('La fecha de siembra es requerida.');
      return;
    }
    if (fechaSiembra > hoy) {
      setErrorMsg('La fecha de siembra no puede ser una fecha futura.');
      return;
    }
    if (isNaN(cant) || cant <= 0) {
      setErrorMsg('La cantidad sembrada debe ser un número entero positivo.');
      return;
    }
    if (isNaN(peso) || peso <= 0) {
      setErrorMsg('El peso inicial promedio debe ser un número positivo (ej: 2.5 g).');
      return;
    }

    setCargando(true);
    try {
      const nuevoLote = await crearNuevoLote({
        estanque,
        fechaSiembra,
        cantidadSembrada: cant,
        pesoInicialPromedioG: peso,
        proveedorAlevinos: proveedorAlevinos.trim(),
        observaciones: observaciones.trim(),
        userEmail,
        config
      });

      if (nuevoLote) {
        onLoteCreado(nuevoLote);
        onClose();
      }
    } catch (err: any) {
      console.error('Error creando lote:', err);
      setErrorMsg(err.message || 'Error al crear el lote. Intenta nuevamente.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-xl w-full overflow-hidden my-6">
        {/* Encabezado */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <PlusCircle className="w-5 h-5 text-sky-400" />
            <div>
              <h3 className="font-semibold text-base">Crear nuevo lote productivo</h3>
              <p className="text-xs text-slate-400">Modalidad Tilapia Pro • Cultivos Loré</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setCargando(false);
              onClose();
            }}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
            title="Cerrar ventana"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 text-xs text-sky-900 flex items-start space-x-2">
            <span className="font-bold text-sky-700 shrink-0">Código Único:</span>
            <span>
              Se generará automáticamente con el formato <code>AAAAMMDD-LETRA-ESTANQUE</code> mediante una transacción atómica protegida contra duplicados.
            </span>
          </div>

          {!puedeCrear && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-start space-x-2 text-amber-900 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>
                <strong>Acceso restringido:</strong> Tu usuario ({userEmail}) no tiene autorización para crear lotes. Solicita a <strong>carlosbs1579@gmail.com</strong> habilitar el permiso "Añadir nuevos lotes".
              </span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Estanque */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Estanque de cultivo *
              </label>
              <select
                required
                value={estanque}
                onChange={(e) => setEstanque(e.target.value)}
                disabled={cargando}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
              >
                {config.estanques.map((est) => (
                  <option key={est.codigo} value={est.codigo}>
                    {est.codigo} — {est.nombre} {est.volumenM3 ? `(${est.volumenM3} m³)` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Fecha de Siembra */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Fecha de siembra (Bogotá) *
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="date"
                  required
                  max={hoy}
                  value={fechaSiembra}
                  onChange={(e) => setFechaSiembra(e.target.value)}
                  disabled={cargando}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            {/* Cantidad Sembrada */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Cantidad sembrada (alevinos) *
              </label>
              <div className="relative">
                <Hash className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="number"
                  required
                  min="1"
                  step="1"
                  placeholder="ej: 5000"
                  value={cantidadSembrada}
                  onChange={(e) => setCantidadSembrada(e.target.value === '' ? '' : Number(e.target.value))}
                  disabled={cargando}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            {/* Peso Inicial Promedio */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Peso inicial promedio (gramos) *
              </label>
              <div className="relative">
                <Scale className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  placeholder="ej: 2.5"
                  value={pesoInicialPromedioG}
                  onChange={(e) => setPesoInicialPromedioG(e.target.value === '' ? '' : Number(e.target.value))}
                  disabled={cargando}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>

          {/* Proveedor de Alevinos */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Proveedor de alevinos (opcional)
            </label>
            <div className="relative">
              <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="ej: Estación Piscícola del Caribe SAS"
                value={proveedorAlevinos}
                onChange={(e) => setProveedorAlevinos(e.target.value)}
                disabled={cargando}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Observaciones iniciales */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Observaciones iniciales de siembra (opcional)
            </label>
            <div className="relative">
              <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <textarea
                rows={2}
                placeholder="Condiciones de aclimatación, lote de origen, temperatura al recibir..."
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                disabled={cargando}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setCargando(false);
                onClose();
              }}
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
                  <span>Creando lote en Firestore...</span>
                </>
              ) : (
                <span>Crear lote y abrir</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
