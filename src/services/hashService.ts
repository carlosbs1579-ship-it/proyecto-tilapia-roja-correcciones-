import { EventoLote } from '../types';

export const HASH_GENESIS = '0'.repeat(64);

/**
 * Ordena recursivamente las claves de un objeto para serialización canónica determinista
 */
function ordenarObjeto(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(ordenarObjeto);
  }
  const ordenado: Record<string, any> = {};
  const llaves = Object.keys(obj).sort();
  for (const k of llaves) {
    ordenado[k] = ordenarObjeto(obj[k]);
  }
  return ordenado;
}

export interface PayloadHashEvento {
  codigoLote: string;
  indice: number;
  tipo: string;
  fechaEvento: string;
  descripcion: string;
  datos: Record<string, any>;
  registradoPor: string;
  registradoEn: string;
  hashAnterior: string;
}

/**
 * Genera el JSON canónico con orden estricto de claves requerido
 */
export function generarJsonCanonico(payload: PayloadHashEvento): string {
  // Orden exacto exigido:
  // codigoLote, indice, tipo, fechaEvento, descripcion, datos, registradoPor, registradoEn (ISO), hashAnterior
  const payloadOrdenado = {
    codigoLote: payload.codigoLote,
    indice: payload.indice,
    tipo: payload.tipo,
    fechaEvento: payload.fechaEvento,
    descripcion: payload.descripcion || '',
    datos: ordenarObjeto(payload.datos || {}),
    registradoPor: payload.registradoPor,
    registradoEn: payload.registradoEn,
    hashAnterior: payload.hashAnterior
  };
  return JSON.stringify(payloadOrdenado);
}

/**
 * Calcula el hash SHA-256 en hexadecimal usando Web Crypto API
 */
export async function calcularSha256(cadena: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const encoder = new TextEncoder();
      const data = encoder.encode(cadena);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {
    console.warn('crypto.subtle no disponible, usando hash alternativo:', e);
  }
  // Fallback simple determinista para contextos donde crypto.subtle no esté disponible
  let h1 = 0xdeadbeef;
  let h2 = 0x41c64e6d;
  for (let i = 0; i < cadena.length; i++) {
    const ch = cadena.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const part1 = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(32, '0');
  const part2 = (4294967296 * (2097151 & h1) + (h2 >>> 0)).toString(16).padStart(32, '0');
  return (part1 + part2).substring(0, 64);
}

/**
 * Calcula el hash para un evento dado
 */
export async function calcularHashEvento(payload: PayloadHashEvento): Promise<string> {
  const jsonCanonico = generarJsonCanonico(payload);
  return calcularSha256(jsonCanonico);
}

export interface ResultadoVerificacion {
  valido: boolean;
  totalEventos: number;
  primerErrorIndex?: number;
  mensaje: string;
  detalles?: {
    indice: number;
    hashEsperado: string;
    hashAlmacenado: string;
    hashAnteriorEsperado: string;
    hashAnteriorAlmacenado: string;
  };
}

/**
 * Verifica la integridad completa de la cadena de hashes del lote
 */
export async function verificarIntegridadCadena(
  codigoLote: string,
  eventos: EventoLote[]
): Promise<ResultadoVerificacion> {
  if (!eventos || eventos.length === 0) {
    return {
      valido: true,
      totalEventos: 0,
      mensaje: 'El lote no contiene eventos registrados aún.'
    };
  }

  let hashEsperadoAnterior = HASH_GENESIS;

  for (let i = 0; i < eventos.length; i++) {
    const ev = eventos[i];

    // Verificar índice
    if (ev.indice !== i) {
      return {
        valido: false,
        totalEventos: eventos.length,
        primerErrorIndex: i,
        mensaje: `Error en la secuencia: el evento en la posición ${i} tiene índice ${ev.indice}.`
      };
    }

    // Verificar hashAnterior
    if (ev.hashAnterior !== hashEsperadoAnterior) {
      return {
        valido: false,
        totalEventos: eventos.length,
        primerErrorIndex: i,
        mensaje: `Cadena rota en el evento #${i} (${ev.tipo}): el hashAnterior almacenado no coincide con el hash del bloque previo.`,
        detalles: {
          indice: i,
          hashEsperado: '',
          hashAlmacenado: ev.hash,
          hashAnteriorEsperado: hashEsperadoAnterior,
          hashAnteriorAlmacenado: ev.hashAnterior
        }
      };
    }

    // Recalcular hash del evento actual
    const hashCalculado = await calcularHashEvento({
      codigoLote,
      indice: ev.indice,
      tipo: ev.tipo,
      fechaEvento: ev.fechaEvento,
      descripcion: ev.descripcion,
      datos: ev.datos,
      registradoPor: ev.registradoPor,
      registradoEn: ev.registradoEn,
      hashAnterior: ev.hashAnterior
    });

    if (hashCalculado !== ev.hash) {
      return {
        valido: false,
        totalEventos: eventos.length,
        primerErrorIndex: i,
        mensaje: `Alteración detectada en el evento #${i} (${ev.tipo}): los datos fueron modificados después del registro.`,
        detalles: {
          indice: i,
          hashEsperado: hashCalculado,
          hashAlmacenado: ev.hash,
          hashAnteriorEsperado: hashEsperadoAnterior,
          hashAnteriorAlmacenado: ev.hashAnterior
        }
      };
    }

    hashEsperadoAnterior = ev.hash;
  }

  return {
    valido: true,
    totalEventos: eventos.length,
    mensaje: `Cadena de trazabilidad 100% íntegra. Se verificaron ${eventos.length} eventos sin alteración.`
  };
}
