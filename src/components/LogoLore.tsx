import React from 'react';

/**
 * Marca de Cultivos Loré: una tilapia de perfil dibujada a línea (aleta dorsal larga y suave,
 * cola en abanico) sobre una línea de agua. Trazo fino, pensado para el dorado sobre la tinta azul.
 * El mismo dibujo se usa en la barra, en la consulta pública, en el favicon y en los PDF.
 */
const TRAZOS: { d: string; ancho?: number }[] = [
  // Cuerpo: lomo alto y vientre más plano, como la tilapia roja
  { d: 'M5 22 C 9 13, 20 10, 31 13.5 C 36 15, 39.5 18.5, 41.5 22 C 39.5 25.5, 36 28, 31 29.5 C 20 33, 9 31, 5 22 Z' },
  // Aleta dorsal larga, de borde continuo
  { d: 'M13 13.2 C 16 8.6, 24 7.2, 33 10.6 C 35 11.6, 36 13.2, 35.6 15.3' },
  // Radios de la aleta dorsal
  { d: 'M18.2 11.6 L 18.8 9.4 M22.2 10.9 L 22.6 8.4 M26.2 11.2 L 26.6 8.6 M30.2 12.4 L 30.8 9.8', ancho: 0.9 },
  // Aleta anal
  { d: 'M27 29.8 C 30 32.6, 33 32.6, 35.6 28.6' },
  // Cola en abanico
  { d: 'M41.5 22 C 43.5 18, 45.5 15.5, 47.5 14.5 C 46.5 19, 46.5 25, 47.5 29.5 C 45.5 28.5, 43.5 26, 41.5 22 Z' },
  // Opérculo (tapa de la agalla)
  { d: 'M13.5 16 C 15.5 19.5, 15.5 24.5, 13.5 28' },
  // Línea de agua
  { d: 'M8 37 C 14 35.2, 20 38.8, 26 37 C 32 35.2, 38 38.8, 44 37', ancho: 1 }
];
const OJO = { cx: 9.6, cy: 19.8, r: 1.2 };

export const LogoLore: React.FC<{ className?: string; titulo?: string }> = ({ className = 'w-9 h-9', titulo }) => (
  <svg
    viewBox="0 0 52 40"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    role={titulo ? 'img' : undefined}
    aria-hidden={titulo ? undefined : true}
  >
    {titulo && <title>{titulo}</title>}
    {TRAZOS.map((t, i) => (
      <path key={i} d={t.d} strokeWidth={t.ancho} />
    ))}
    <circle {...OJO} fill="currentColor" stroke="none" />
  </svg>
);

/**
 * SVG completo como texto (para el favicon y para convertirlo en imagen dentro de los PDF)
 */
export function svgLogo(color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 40" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
    TRAZOS.map((t) => `<path d="${t.d}"${t.ancho ? ` stroke-width="${t.ancho}"` : ''}/>`).join('') +
    `<circle cx="${OJO.cx}" cy="${OJO.cy}" r="${OJO.r}" fill="${color}" stroke="none"/>` +
    `</svg>`
  );
}

/**
 * El logo como imagen PNG (data URL) para incrustarlo en los PDF
 */
export async function logoPngDataUrl(color: string, anchoPx = 520): Promise<string> {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgLogo(color));
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = anchoPx;
  canvas.height = Math.round((anchoPx * 40) / 52);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
