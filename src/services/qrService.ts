import QRCode from 'qrcode';
import { firebaseConfig } from '../firebase/firebaseConfig';

/**
 * Construye la URL pública interactiva de trazabilidad para el lote.
 * Al escanear el QR desde cualquier smartphone, el consumidor, chef o auditor
 * accede de inmediato a la certificación oficial inalterable de Cultivos Loré,
 * verificación SHA-256 en vivo y descarga del documento PDF.
 */
export function construirUrlPublicaTrazabilidad(codigoLote: string): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/?lote=${encodeURIComponent(codigoLote)}`;
  }
  return `https://cultivos-lore.web.app/?lote=${encodeURIComponent(codigoLote)}`;
}

/**
 * URL pública de consulta de una entrega. Lleva solo el código aleatorio de consulta de la orden;
 * es distinta del QR del lote, que lleva el código del lote.
 */
export function construirUrlConsultaEntrega(token: string): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/?entrega=${encodeURIComponent(token)}`;
  }
  return `https://cultivos-lore.web.app/?entrega=${encodeURIComponent(token)}`;
}

/**
 * Construye la URL del PDF del lote (o la vista pública directa)
 */
export function construirUrlPublicaPdf(codigoLote: string): string {
  // Para evitar errores 404 en móviles al escanear, el enlace principal es la vista pública
  return construirUrlPublicaTrazabilidad(codigoLote);
}

/**
 * Obtiene la URL cruda en Firebase Cloud Storage si estuviera disponible
 */
export function construirUrlDirectaStoragePdf(codigoLote: string): string {
  const bucket = firebaseConfig.storageBucket || 'iron-outpost-cw2pc.firebasestorage.app';
  const filePath = `lotes/${codigoLote}.pdf`;
  const encodedPath = encodeURIComponent(filePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
}

/**
 * Genera el QR como Data URL PNG a partir de la URL del PDF o texto
 */
export async function generarQrDataUrl(texto: string): Promise<string> {
  try {
    return await QRCode.toDataURL(texto, {
      width: 400,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      },
      errorCorrectionLevel: 'H'
    });
  } catch (err) {
    console.error('Error generando QR:', err);
    throw err;
  }
}

/**
 * Descarga el código QR con el código del lote escrito en la parte inferior para imprimir
 */
export function descargarQrConEtiqueta(qrDataUrl: string, codigoLote: string): void {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = new Image();
  img.onload = () => {
    // Dimensiones con margen y texto inferior
    canvas.width = 460;
    canvas.height = 540;

    // Fondo blanco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Borde elegante
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

    // Cabecera de la etiqueta
    ctx.fillStyle = '#0369a1';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CULTIVOS LORÉ', canvas.width / 2, 45);

    ctx.fillStyle = '#0284c7';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText('TILAPIA PRO • TRAZABILIDAD', canvas.width / 2, 68);

    // Imagen del QR
    ctx.drawImage(img, 30, 85, 400, 400);

    // Texto del código del lote al pie
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(codigoLote, canvas.width / 2, 505);

    ctx.fillStyle = '#64748b';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('Escanee para ver historial inalterable en línea', canvas.width / 2, 525);

    // Disparar descarga
    const a = document.createElement('a');
    a.download = `QR-Etiqueta-${codigoLote}.png`;
    a.href = canvas.toDataURL('image/png');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  img.src = qrDataUrl;
}
