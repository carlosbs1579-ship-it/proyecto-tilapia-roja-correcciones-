import { svgLogo } from '../components/LogoLore';
import QRCode from 'qrcode';
import { firebaseConfig } from '../firebase/firebaseConfig';
import { fragmentoSello } from '../lib/integridad';

/**
 * Origen que llevan los QR. Si está configurado VITE_ORIGEN_PUBLICO (dominio oficial), se usa
 * siempre, aunque el QR se genere desde localhost, una IP local o una vista previa; si no, el
 * origen del navegador.
 */
export function origenPublico(): string {
  const configurado = String(import.meta.env?.VITE_ORIGEN_PUBLICO || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^\s/]+$/i.test(configurado)) return configurado;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return '';
}

/**
 * Construye la URL pública interactiva de trazabilidad para el lote.
 * Al escanear el QR desde cualquier smartphone, el consumidor, chef o auditor
 * accede de inmediato a la certificación oficial inalterable de Cultivos Loré,
 * verificación SHA-256 en vivo y descarga del documento PDF.
 */
export function construirUrlPublicaTrazabilidad(codigoLote: string, sello?: string | null): string {
  // En un lote cerrado el QR lleva además el inicio del sello (ancla fuera de la base de datos):
  // la vista pública lo compara con el sello recalculado y avisa si el registro cambió
  const s = fragmentoSello(sello);
  return `${origenPublico()}/?lote=${encodeURIComponent(codigoLote)}${s ? `&s=${s}` : ''}`;
}

/** URL del QR de un lote: con el sello si está cerrado */
export function urlQrLote(lote: { codigo: string; estado?: string; resumen?: { hashFinal?: string } }): string {
  return construirUrlPublicaTrazabilidad(lote.codigo, lote.estado === 'cerrado' ? lote.resumen?.hashFinal : null);
}

/**
 * URL pública de consulta de una entrega. Lleva solo el código aleatorio de consulta de la orden;
 * es distinta del QR del lote, que lleva el código del lote.
 */
export function construirUrlConsultaEntrega(token: string): string {
  return `${origenPublico()}/?entrega=${encodeURIComponent(token)}`;
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
        dark: '#16213a',
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
 * Descarga el código QR como etiqueta para imprimir, con la identidad de la plataforma:
 * banda tinta con el logo y el nombre en serif, doble filete dorado, QR y código del lote.
 */
export async function descargarQrConEtiqueta(qrDataUrl: string, codigoLote: string, sello?: string | null): Promise<void> {
  const cargar = (src: string) =>
    new Promise<HTMLImageElement>((resolver, rechazar) => {
      const img = new Image();
      img.onload = () => resolver(img);
      img.onerror = rechazar;
      img.src = src;
    });
  try {
    await document.fonts?.load?.('400 40px "Libre Caslon Text"');
  } catch {}
  const [qr, logo] = await Promise.all([
    cargar(qrDataUrl),
    cargar('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgLogo('#d1ac5c'))).catch(() => null)
  ]);

  const canvas = document.createElement('canvas');
  const escala = 2; // nitidez al imprimir
  const ancho = 480;
  const alto = 640;
  canvas.width = ancho * escala;
  canvas.height = alto * escala;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(escala, escala);
  const serif = '"Libre Caslon Text", Georgia, "Times New Roman", serif';
  const sans = '"Public Sans", system-ui, sans-serif';

  // Papel y banda superior
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.fillStyle = '#16213a';
  ctx.fillRect(0, 0, ancho, 104);
  // Logo y nombre centrados como un solo bloque dentro de la banda
  ctx.textAlign = 'left';
  ctx.font = `400 30px ${serif}`;
  const anchoNombre = ctx.measureText('Cultivos Loré').width;
  ctx.font = `600 11px ${sans}`;
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '2px';
  const anchoSubtitulo = ctx.measureText('TRAZABILIDAD TILAPIA PRO').width;
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px';
  const anchoLogo = logo ? 58 : 0;
  const separacion = logo ? 14 : 0;
  const anchoBloque = anchoLogo + separacion + Math.max(anchoNombre, anchoSubtitulo);
  const xBloque = (ancho - anchoBloque) / 2;
  const xTexto = xBloque + anchoLogo + separacion;
  if (logo) ctx.drawImage(logo, xBloque, 30, 58, 45);
  ctx.fillStyle = '#ffffff';
  ctx.font = `400 30px ${serif}`;
  ctx.fillText('Cultivos Loré', xTexto, 58);
  ctx.fillStyle = '#d1ac5c';
  ctx.font = `600 11px ${sans}`;
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '2px';
  ctx.fillText('TRAZABILIDAD TILAPIA PRO', xTexto + 1, 80);
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px';
  // Doble filete dorado bajo la banda
  ctx.fillStyle = '#8a6624';
  ctx.fillRect(0, 104, ancho, 2);
  ctx.fillRect(0, 109, ancho, 1);

  // QR
  ctx.drawImage(qr, 60, 132, 360, 360);

  // Código del lote y ayuda
  ctx.textAlign = 'center';
  ctx.fillStyle = '#16213a';
  ctx.font = `400 30px ${serif}`;
  ctx.fillText(`Lote ${codigoLote}`, ancho / 2, 540);
  ctx.fillStyle = '#d8dbe0';
  ctx.fillRect(140, 560, ancho - 280, 1);
  ctx.fillStyle = '#4a5160';
  ctx.font = `400 13px ${sans}`;
  ctx.fillText('Escanee para ver la historia del lote, fase por fase.', ancho / 2, 590);
  ctx.fillStyle = '#5d6470';
  ctx.font = `400 11px ${sans}`;
  ctx.fillText('Turbaco, Bolívar · Colombia', ancho / 2, 610);
  // Fragmento del sello del lote cerrado, en letra pequeña: permite cotejar la etiqueta impresa
  const s = fragmentoSello(sello);
  if (s) {
    ctx.fillStyle = '#5d6470';
    ctx.font = `400 10px ui-monospace, "Courier New", monospace`;
    ctx.fillText(`Sello ${s}`, ancho / 2, 628);
  }

  const a = document.createElement('a');
  a.download = `QR-Etiqueta-${codigoLote}.png`;
  a.href = canvas.toDataURL('image/png');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
