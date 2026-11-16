import React, { useEffect, useState } from 'react';
import { EsqueletoTarjetas } from './Esqueleto';
import {
  Truck,
  ShieldCheck,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Lote, EntregasLote } from '../types';
import {
  escucharEntregas,
  calcularEstadoEntregas,
  verificarIntegridadEntregas
} from '../services/entregasService';
import { ResultadoVerificacion } from '../services/hashService';
import { formatearFechaColombia } from '../utils/constants';

// Historial de entregas del sistema anterior (colección entregas/{codigo}), solo de lectura: las
// reglas ya no permiten escribir en ella y las entregas nuevas van como órdenes en Pedidos (H67).
interface EntregasPanelProps {
  lote: Lote;
  userEmail?: string;
  puedeGestionar?: boolean; // se conserva por compatibilidad; el panel ya no registra nada
}

const ESTILO_ESTADO: Record<string, string> = {
  asignada: 'bg-sky-100 text-sky-800 border-sky-200',
  entregada: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  anulada: 'bg-slate-200 text-slate-600 border-slate-300'
};

const ETIQUETA_ESTADO: Record<string, string> = {
  asignada: 'Asignada (pendiente)',
  entregada: 'Entregada',
  anulada: 'Anulada'
};

export const EntregasPanel: React.FC<EntregasPanelProps> = ({ lote }) => {
  const [entregasDoc, setEntregasDoc] = useState<EntregasLote | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const [verificacion, setVerificacion] = useState<ResultadoVerificacion | null>(null);
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    setCargando(true);
    return escucharEntregas(
      lote.codigo,
      (doc) => {
        setEntregasDoc(doc);
        setCargando(false);
        setErrorCarga(null);
        setVerificacion(null);
      },
      () => {
        setCargando(false);
        setErrorCarga('No fue posible cargar las entregas de este lote.');
      }
    );
  }, [lote.codigo]);

  // Un lote sin registros del sistema anterior no muestra el panel
  if (!cargando && !errorCarga && !entregasDoc) return null;

  const entregas = calcularEstadoEntregas(entregasDoc?.registros || []);
  const cosechadaKg = Number(lote.resumen?.biomasaCosechadaKg) || 0;
  const comprometidoKg = entregas.filter((e) => e.estado !== 'anulada').reduce((s, e) => s + e.cantidadKg, 0);
  const entregadoKg = entregas.filter((e) => e.estado === 'entregada').reduce((s, e) => s + e.cantidadKg, 0);

  const handleVerificar = async () => {
    if (!entregasDoc) return;
    setVerificando(true);
    try {
      setVerificacion(await verificarIntegridadEntregas(lote, entregasDoc));
    } catch (err: any) {
      setVerificacion({ valido: false, totalEventos: 0, mensaje: `Error al verificar: ${err.message}` });
    } finally {
      setVerificando(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-indigo-200 shadow-xs overflow-hidden">
      {/* Cabecera */}
      <div className="px-6 py-4 border-b border-indigo-100 bg-indigo-50/60 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <Truck className="w-4 h-4 text-indigo-600" />
            <h3 className="font-semibold text-slate-900 text-sm">Entregas a Clientes</h3>
            <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded-sm font-semibold uppercase tracking-wider">
              Posterior al sellado
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Estos registros forman una cadena propia anclada al hash de cierre del lote. No modifican los registros de producción sellados ni su hash.
          </p>
          <p className="text-xs text-indigo-800 mt-1 max-w-2xl font-medium">
            Historial del sistema anterior (solo lectura). Las nuevas entregas se gestionan como órdenes en la pestaña "Pedidos".
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {entregasDoc && (
            <button
              onClick={handleVerificar}
              disabled={verificando}
              className="inline-flex items-center space-x-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold transition-colors border border-slate-200 disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>{verificando ? 'Verificando...' : 'Verificar Entregas (Hash)'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Totales */}
      <div className="px-6 py-3 border-b border-slate-100 grid grid-cols-3 gap-3 text-center text-xs">
        <div>
          <span className="text-slate-500 block">Biomasa cosechada</span>
          <strong className="text-slate-900">{cosechadaKg ? `${cosechadaKg.toLocaleString()} kg` : 'Sin registrar'}</strong>
        </div>
        <div>
          <span className="text-slate-500 block">Comprometido</span>
          <strong className="text-sky-700">{comprometidoKg.toLocaleString()} kg</strong>
        </div>
        <div>
          <span className="text-slate-500 block">Entregado</span>
          <strong className="text-emerald-700">{entregadoKg.toLocaleString()} kg</strong>
        </div>
      </div>

      {/* Resultado de la verificación */}
      {verificacion && (
        <div
          className={`mx-6 mt-4 p-3 rounded-lg border text-xs flex items-start space-x-2 ${
            verificacion.valido ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-red-50 border-red-300 text-red-900'
          }`}
        >
          {verificacion.valido ? <CheckCircle className="w-4 h-4 shrink-0 mt-1" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-1" />}
          <span>{verificacion.mensaje}</span>
        </div>
      )}

      {/* Lista de entregas */}
      <div className="divide-y divide-slate-100">
        {cargando ? (
          <EsqueletoTarjetas cantidad={3} alto="h-[72px]" />
        ) : errorCarga ? (
          <div className="py-8 text-center text-xs text-red-600">{errorCarga}</div>
        ) : entregas.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Aún no hay clientes asignados a este lote.
          </div>
        ) : (
          entregas.map((e) => (
            <div key={e.entregaId} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-sm text-slate-900">{e.cliente}</span>
                    <span className={`text-xs px-2 py-1 rounded-sm border font-semibold ${ESTILO_ESTADO[e.estado]}`}>
                      {ETIQUETA_ESTADO[e.estado]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {e.cantidadKg.toLocaleString()} kg ·{' '}
                    {e.estado === 'entregada' ? `Entregado el ${e.fechaEntrega}` : `Programado para ${e.fechaProgramada}`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setAbiertas((prev) => ({ ...prev, [e.entregaId]: !prev[e.entregaId] }))}
                    className="inline-flex items-center space-x-1 px-2 py-2 text-xs text-indigo-700 hover:text-indigo-900 font-semibold"
                  >
                    <span>Historial ({e.registros.length})</span>
                    {abiertas[e.entregaId] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Historial auditado de la entrega */}
              {abiertas[e.entregaId] && (
                <div className="mt-3 space-y-2 border-l-2 border-indigo-200 pl-3">
                  {e.registros.map((r) => (
                    <div key={r.id} className="text-xs bg-slate-50 rounded-lg p-3 border border-slate-200">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">
                          #{r.indice} {r.tipo}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">{r.fechaEvento}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-600 space-y-1">
                        {r.tipo === 'Reasignación de cliente' && (
                          <p>
                            De <strong>{r.datos.clienteAnterior}</strong> a <strong>{r.datos.cliente}</strong>
                          </p>
                        )}
                        {r.tipo !== 'Reasignación de cliente' && (
                          <p>
                            Cliente: <strong>{r.datos.cliente}</strong> · {Number(r.datos.cantidadKg).toLocaleString()} kg
                          </p>
                        )}
                        {r.datos.motivo && <p>Motivo: {r.datos.motivo}</p>}
                        {r.descripcion && <p>Observaciones: {r.descripcion}</p>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <span>
                          {r.registradoPor} · {formatearFechaColombia(r.registradoEn)}
                        </span>
                        <span title={`SHA-256: ${r.hash}`} className="font-mono">
                          {r.hash.substring(0, 12)}...
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

    </div>
  );
};
