import React, { useEffect, useState } from 'react';
import { X, Download, Copy, Check, ExternalLink, QrCode } from 'lucide-react';
import { Lote, ConfiguracionGeneral } from '../types';
import { generarQrDataUrl, descargarQrConEtiqueta, construirUrlPublicaTrazabilidad } from '../services/qrService';
import { descargarPdfLoteLocal } from '../services/pdfService';
import { CONFIG_DEFAULT } from '../utils/constants';

interface QrModalProps {
  isOpen: boolean;
  onClose: () => void;
  lote: Lote;
  config?: ConfiguracionGeneral;
  onAbrirVistaPublica?: (codigo: string) => void;
}

export const QrModal: React.FC<QrModalProps> = ({
  isOpen,
  onClose,
  lote,
  config = CONFIG_DEFAULT,
  onAbrirVistaPublica
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiado, setCopiado] = useState(false);
  const [cargando, setCargando] = useState(true);

  // La URL pública a la que apunta el QR para trazabilidad universal en móviles
  const trazabilidadUrl = construirUrlPublicaTrazabilidad(lote.codigo);

  useEffect(() => {
    if (!isOpen) return;
    setCargando(true);
    generarQrDataUrl(trazabilidadUrl)
      .then((url) => {
        setQrDataUrl(url);
        setCargando(false);
      })
      .catch((err) => {
        console.error('Error generando QR:', err);
        setCargando(false);
      });
  }, [isOpen, trazabilidadUrl]);

  if (!isOpen) return null;

  const handleCopiarUrl = () => {
    navigator.clipboard.writeText(trazabilidadUrl);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const handleDescargar = () => {
    if (!qrDataUrl) return;
    descargarQrConEtiqueta(qrDataUrl, lote.codigo);
  };

  const handleDescargarPdf = () => {
    descargarPdfLoteLocal(lote, config);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-sm w-full overflow-hidden text-center">
        {/* Cabecera */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <QrCode className="w-5 h-5 text-sky-400" />
            <span className="font-semibold text-sm">Código QR de Trazabilidad</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-3">
            <span className="text-xs uppercase font-bold text-sky-700 bg-sky-50 px-2.5 py-1 rounded-full border border-sky-200">
              Cultivos Loré • Tilapia Pro
            </span>
          </div>

          <p className="text-xs text-slate-500 mb-4">
            Al escanear este código en el empaque, el cliente o restaurante accede directamente al certificado PDF inalterable de este lote.
          </p>

          {/* Recuadro del QR */}
          <div className="bg-white p-4 rounded-xl border-2 border-slate-200 inline-block shadow-inner mb-3">
            {cargando ? (
              <div className="w-56 h-56 flex items-center justify-center">
                <div className="w-8 h-8 border-3 border-sky-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR Lote ${lote.codigo}`}
                className="w-56 h-56 object-contain"
              />
            ) : (
              <div className="w-56 h-56 flex items-center justify-center text-xs text-slate-400">
                No se pudo cargar el QR
              </div>
            )}
          </div>

          {/* Código del lote en texto visible */}
          <div className="mb-5">
            <p className="text-xs text-slate-500">Identificador del lote:</p>
            <p className="font-mono font-bold text-lg text-slate-900 tracking-wider">
              {lote.codigo}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Estanque {lote.estanque} • Siembra: {lote.fechaSiembra}
            </p>
          </div>

          {/* Botones de acción */}
          <div className="space-y-2">
            <button
              onClick={handleDescargar}
              disabled={!qrDataUrl || cargando}
              className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-semibold shadow-xs transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>Descargar QR (PNG para Etiqueta)</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              {onAbrirVistaPublica ? (
                <button
                  type="button"
                  onClick={() => onAbrirVistaPublica(lote.codigo)}
                  className="flex items-center justify-center space-x-1.5 py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Ver Vista Pública</span>
                </button>
              ) : (
                <a
                  href={trazabilidadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center space-x-1.5 py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Ver Vista Pública</span>
                </a>
              )}

              <button
                onClick={handleCopiarUrl}
                className="flex items-center justify-center space-x-1.5 py-2 px-3 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-colors"
              >
                {copiado ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                <span>{copiado ? '¡Copiado!' : 'Copiar URL'}</span>
              </button>
            </div>

            <button
              onClick={handleDescargarPdf}
              className="w-full flex items-center justify-center space-x-1.5 py-2 px-3 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Descargar Certificado PDF Oficial</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
