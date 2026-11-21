import { FichaNutricional, Lote } from '../types';
import { HASH_GENESIS, textoCanonicoEvento } from './hashService';
import { sha256Texto } from '../lib/integridad';
import { analizarOts, PREFIJO_EXTRA } from '../lib/ots';
import { textoCanonicoFicha } from './selloTiempoService';

/**
 * Verificación fuera de la plataforma (H03): con estos dos archivos y la prueba .ots, cualquier
 * persona comprueba un lote sellado en opentimestamps.org sin confiar en la app.
 *
 * - Documento sellado: los bytes UTF-8 del texto canónico de la última fase. Su SHA-256 es el hash
 *   de esa fase (hashFinal), que es el digest que cubre la prueba .ots.
 * - Expediente de la cadena: el texto canónico y el hash de cada fase, en orden, y la ficha
 *   nutricional congelada con su compromiso, con las instrucciones para comprobarlos.
 *
 * Solo se ofrecen si todo coincide al prepararlos (el SHA-256 del documento es el digest de la
 * prueba, el sello guardado y el hashFinal, y la cadena se recalcula entera) y si ningún texto
 * contiene un correo (los registros anteriores a H20 firmaban con el correo).
 */

export interface FaseExpediente {
  indice: number;
  tipo: string;
  texto: string; // texto canónico exacto que se pasa a SHA-256
  hash: string;
}

export interface ArchivosVerificacion {
  documento: string; // contenido del documento sellado
  expediente: string; // contenido del expediente de la cadena
  nombreDocumento: string;
  nombreExpediente: string;
}

export type PreparacionVerificacion =
  | { disponible: true; archivos: ArchivosVerificacion }
  | { disponible: false; motivo: 'sin_sello' | 'correo' | 'no_coincide' };

export const CORREO = /[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+/;

/** Nombre base de los archivos de verificación de un lote (el mismo que la prueba .ots) */
export const nombreArchivoOtsLote = (codigo: string) => `sello-lote-${codigo}`;

function armarExpediente(
  lote: Lote,
  fases: FaseExpediente[],
  ficha: { texto: string; hash: string; compromiso: string } | null,
  nombres: { documento: string; ots: string }
): string {
  const l: string[] = [];
  const ultima = fases[fases.length - 1];
  l.push(`EXPEDIENTE DE LA CADENA DEL LOTE ${lote.codigo}`);
  l.push('Cultivos Loré, Tilapia Pro. Trazabilidad sellada con SHA-256 y anclada en Bitcoin con OpenTimestamps.');
  l.push('');
  l.push(`Sello de cierre (hash de la última fase): ${ultima.hash}`);
  l.push(`Fases registradas: ${fases.length}`);
  l.push(`Fecha de cierre: ${lote.fechaCierre || 'sin fecha'}`);
  l.push('');
  l.push('CÓMO VERIFICAR SIN CONFIAR EN LA PLATAFORMA');
  l.push('');
  l.push('1. Cada fase tiene un texto canónico y un hash. El SHA-256 de los bytes UTF-8 del texto (la línea');
  l.push('   completa que sigue a "Texto:", sin el salto de línea final) debe dar exactamente su hash.');
  l.push('   Por ejemplo, guarde la línea en un archivo sin salto final y ejecute: sha256sum archivo.txt');
  l.push('2. Cada texto incluye "hashAnterior": debe ser el hash de la fase anterior. La primera fase (#0)');
  l.push(`   parte del génesis, ${HASH_GENESIS}.`);
  l.push(`3. La última fase es el documento sellado (${nombres.documento}). En https://opentimestamps.org,`);
  l.push(`   sección de verificación, cargue la prueba ${nombres.ots} y luego ese documento: el sitio`);
  l.push('   comprueba que el SHA-256 del documento es el que cubre la prueba y muestra si Bitcoin ya lo');
  l.push('   confirmó (o si sigue pendiente, lo normal durante las primeras horas).');
  if (ficha) {
    l.push('4. La ficha nutricional congelada al cerrar también queda cubierta por el mismo sello. Su texto');
    l.push('   canónico (abajo) da un SHA-256; la prueba .ots, antes de enviarse a los calendarios, agrega');
    l.push(`   al sello de cierre el dato ${PREFIJO_EXTRA} (un byte, la letra F) seguido de ese SHA-256, y calcula SHA-256`);
    l.push('   del resultado. En opentimestamps.org esa operación se ve como la primera de la prueba:');
    l.push(`   append ${ficha.compromiso}`);
    l.push('   seguida de sha256. Si la ficha se cambiara, ese dato dejaría de coincidir.');
  }
  l.push('');
  l.push('FASES DE LA CADENA, EN ORDEN');
  for (const f of fases) {
    l.push('');
    l.push(`Fase #${f.indice} (${f.tipo})`);
    l.push(`Hash: ${f.hash}`);
    l.push(`Texto: ${f.texto}`);
  }
  if (ficha) {
    l.push('');
    l.push('FICHA NUTRICIONAL CONGELADA AL CERRAR');
    l.push('');
    l.push(`SHA-256 del texto: ${ficha.hash}`);
    l.push(`Compromiso en la prueba .ots (${PREFIJO_EXTRA} + SHA-256): ${ficha.compromiso}`);
    l.push(`Texto: ${ficha.texto}`);
  }
  l.push('');
  return l.join('\n');
}

/**
 * Prepara el documento sellado y el expediente de un lote con sello de tiempo, comprobando antes
 * que el SHA-256 del documento coincide con el digest de la prueba .ots, con el sello guardado y
 * con el hashFinal, y que la cadena entera se recalcula desde el génesis. Nunca lanza.
 */
export async function prepararVerificacionLote(lote: Lote): Promise<PreparacionVerificacion> {
  try {
    const sello = lote.selloTiempo;
    const eventos = lote.eventos || [];
    if (!sello || lote.estado !== 'cerrado' || !eventos.length) return { disponible: false, motivo: 'sin_sello' };

    const fases: FaseExpediente[] = [];
    let anterior = HASH_GENESIS;
    for (let i = 0; i < eventos.length; i++) {
      const ev = eventos[i];
      const texto = textoCanonicoEvento(lote.codigo, ev);
      const hash = await sha256Texto(texto);
      if (ev.indice !== i || ev.hashAnterior !== anterior || hash !== ev.hash) return { disponible: false, motivo: 'no_coincide' };
      fases.push({ indice: i, tipo: ev.tipo, texto, hash });
      anterior = hash;
    }

    const ficha: FichaNutricional | undefined = lote.fichaNutricionalCierre;
    let datosFicha: { texto: string; hash: string; compromiso: string } | null = null;
    if (ficha) {
      const texto = textoCanonicoFicha(ficha);
      const hash = await sha256Texto(texto);
      datosFicha = { texto, hash, compromiso: PREFIJO_EXTRA + hash };
    }

    const textos = [...fases.map((f) => f.texto), ...(datosFicha ? [datosFicha.texto] : [])];
    if (textos.some((t) => CORREO.test(t))) return { disponible: false, motivo: 'correo' };

    // El documento sellado es el texto de la última fase: su SHA-256 debe ser el digest de la prueba
    const documento = fases[fases.length - 1].texto;
    const huellaDocumento = await sha256Texto(documento);
    const prueba = await analizarOts(sello.ots);
    if (
      huellaDocumento !== prueba.digest ||
      huellaDocumento !== sello.digest ||
      huellaDocumento !== (lote.resumen?.hashFinal || '') ||
      (prueba.compromisoExtra || null) !== (datosFicha?.compromiso || null)
    ) {
      return { disponible: false, motivo: 'no_coincide' };
    }

    const nombreDocumento = `lote-${lote.codigo}-documento-sellado.txt`;
    const nombreExpediente = `lote-${lote.codigo}-expediente.txt`;
    const expediente = armarExpediente(lote, fases, datosFicha, {
      documento: nombreDocumento,
      ots: `${nombreArchivoOtsLote(lote.codigo)}.ots`
    });
    return { disponible: true, archivos: { documento, expediente, nombreDocumento, nombreExpediente } };
  } catch {
    return { disponible: false, motivo: 'no_coincide' };
  }
}

/** Descarga un texto como archivo con sus bytes UTF-8 exactos (sin marca de orden de bytes) */
export function descargarTexto(texto: string, nombre: string): void {
  const bytes = new TextEncoder().encode(texto);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
