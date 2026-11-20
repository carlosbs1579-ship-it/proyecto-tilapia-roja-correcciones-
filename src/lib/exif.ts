/**
 * Lector mínimo de la fecha de cámara de una foto JPEG (EXIF DateTimeOriginal, H38), sin
 * dependencias. Se lee antes de comprimir: la copia comprimida que se guarda ya no trae EXIF.
 *
 * Recorre los marcadores del JPEG hasta el segmento APP1 "Exif", lee la cabecera TIFF (orden de
 * bytes II o MM), el IFD0, el puntero al subIFD Exif (0x8769) y en él DateTimeOriginal (0x9003) y,
 * si existe, OffsetTimeOriginal (0x9011). Las capturas de pantalla y muchas fotos editadas no traen
 * esta fecha: entonces devuelve null.
 */

const TAG_EXIF_IFD = 0x8769;
const TAG_FECHA_ORIGINAL = 0x9003;
const TAG_ZONA_ORIGINAL = 0x9011;

function leerAscii(v: DataView, inicio: number, largo: number): string {
  let s = '';
  for (let i = 0; i < largo && inicio + i < v.byteLength; i++) {
    const c = v.getUint8(inicio + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** Busca una etiqueta ASCII en un IFD; devuelve su texto o, para punteros, el número */
function entradaIfd(v: DataView, tiff: number, ifd: number, le: boolean, tag: number): { texto?: string; valor?: number } | null {
  if (ifd < 0 || tiff + ifd + 2 > v.byteLength) return null;
  const n = v.getUint16(tiff + ifd, le);
  for (let i = 0; i < n && i < 500; i++) {
    const e = tiff + ifd + 2 + i * 12;
    if (e + 12 > v.byteLength) return null;
    if (v.getUint16(e, le) !== tag) continue;
    const tipo = v.getUint16(e + 2, le);
    const cuenta = v.getUint32(e + 4, le);
    if (tipo === 2) {
      const inicio = cuenta <= 4 ? e + 8 : tiff + v.getUint32(e + 8, le);
      return { texto: leerAscii(v, inicio, Math.min(cuenta, 64)) };
    }
    if (tipo === 4 || tipo === 13) return { valor: v.getUint32(e + 8, le) };
    return null;
  }
  return null;
}

/** "AAAA:MM:DD HH:MM:SS" (+ zona "+HH:MM") a "AAAA-MM-DDTHH:MM:SS[+HH:MM]"; null si no es válida */
export function normalizarFechaExif(fecha: string, zona?: string): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec((fecha || '').trim());
  if (!m) return null;
  const [, a, me, d, h, mi, s] = m;
  const n = (x: string) => Number(x);
  if (n(a) < 1990 || n(me) < 1 || n(me) > 12 || n(d) < 1 || n(d) > 31 || n(h) > 23 || n(mi) > 59 || n(s) > 59) return null;
  const z = (zona || '').trim();
  const zonaValida = /^[+-]\d{2}:\d{2}$/.test(z) ? z : z === 'Z' ? 'Z' : '';
  return `${a}-${me}-${d}T${h}:${mi}:${s}${zonaValida}`;
}

/** Fecha de cámara de un JPEG (bytes del archivo original); null si no la trae */
export function fechaExifDeJpeg(buffer: ArrayBuffer): string | null {
  try {
    const v = new DataView(buffer);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let p = 2;
    while (p + 4 <= v.byteLength) {
      if (v.getUint8(p) !== 0xff) return null;
      const marcador = v.getUint8(p + 1);
      if (marcador === 0xd9 || marcador === 0xda) return null; // fin o inicio de la imagen: no hay EXIF
      const largo = v.getUint16(p + 2);
      if (marcador === 0xe1 && largo > 8 && leerAscii(v, p + 4, 4) === 'Exif') {
        const tiff = p + 10;
        const orden = v.getUint16(tiff);
        const le = orden === 0x4949;
        if (!le && orden !== 0x4d4d) return null;
        if (v.getUint16(tiff + 2, le) !== 42) return null;
        const ifd0 = v.getUint32(tiff + 4, le);
        const ptr = entradaIfd(v, tiff, ifd0, le, TAG_EXIF_IFD);
        if (!ptr?.valor) return null;
        const fecha = entradaIfd(v, tiff, ptr.valor, le, TAG_FECHA_ORIGINAL)?.texto;
        if (!fecha) return null;
        const zona = entradaIfd(v, tiff, ptr.valor, le, TAG_ZONA_ORIGINAL)?.texto;
        return normalizarFechaExif(fecha, zona);
      }
      p += 2 + largo;
    }
    return null;
  } catch {
    return null;
  }
}

/** Lee la fecha de cámara de un archivo de imagen (solo JPEG; los primeros 256 kB bastan) */
export async function fechaExifDeArchivo(archivo: Blob): Promise<string | null> {
  try {
    const parte = archivo.slice(0, 256 * 1024);
    return fechaExifDeJpeg(await parte.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Hora en milisegundos de una fecha EXIF normalizada. Sin zona se interpreta como hora de Colombia
 * (UTC-5), donde se toman las fotos de entrega.
 */
export function msFechaExif(fecha: string): number {
  const conZona = /([+-]\d{2}:\d{2}|Z)$/.test(fecha) ? fecha : `${fecha}-05:00`;
  return Date.parse(conZona);
}

export const MS_DIA_EXIF = 24 * 60 * 60 * 1000;

/** Diferencia entre la fecha de cámara y la de la entrega: aviso si supera 24 horas */
export function revisarFechaExif(
  tomadaEnExif: string | undefined | null,
  fechaEntrega: string
): { estado: 'sin_fecha' | 'coincide' | 'difiere'; ms?: number; antes?: boolean } {
  if (!tomadaEnExif) return { estado: 'sin_fecha' };
  const exif = msFechaExif(tomadaEnExif);
  const entrega = Date.parse(fechaEntrega);
  if (!Number.isFinite(exif) || !Number.isFinite(entrega)) return { estado: 'sin_fecha' };
  const dif = entrega - exif;
  return Math.abs(dif) > MS_DIA_EXIF ? { estado: 'difiere', ms: exif, antes: dif > 0 } : { estado: 'coincide', ms: exif };
}
