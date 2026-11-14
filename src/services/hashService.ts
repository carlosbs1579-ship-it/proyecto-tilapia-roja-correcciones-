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

/**
 * JSON canónico de cualquier valor (claves ordenadas en todos los niveles): el mismo contenido da
 * siempre el mismo texto y, por tanto, el mismo hash
 */
export function jsonCanonico(valor: unknown): string {
  return JSON.stringify(ordenarObjeto(valor));
}

export interface PayloadHashEvento {
  codigoLote: string;
  indice: number;
  tipo: string;
  fechaEvento: string;
  descripcion: string;
  datos: Record<string, any>;
  registradoPor: string;
  registradoPorNombre?: string;
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
    // Solo en los eventos que guardan el nombre: los anteriores conservan exactamente su hash
    ...(payload.registradoPorNombre ? { registradoPorNombre: payload.registradoPorNombre } : {}),
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

// Cualquier registro encadenado con la misma estructura que un evento de producción
type RegistroEncadenado = Omit<EventoLote, 'tipo'> & { tipo: string };

/**
 * Verifica la integridad completa de una cadena de hashes. Por defecto es la cadena de
 * producción del lote, que parte del hash génesis; otras cadenas (como las entregas) parten
 * del hash con el que se anclan, indicado en hashInicial.
 */
export async function verificarIntegridadCadena(
  codigoLote: string,
  eventos: RegistroEncadenado[],
  hashInicial: string = HASH_GENESIS
): Promise<ResultadoVerificacion> {
  if (!eventos || eventos.length === 0) {
    return {
      valido: true,
      totalEventos: 0,
      mensaje: 'El lote no contiene fases registradas aún.'
    };
  }

  let hashEsperadoAnterior = hashInicial;

  for (let i = 0; i < eventos.length; i++) {
    const ev = eventos[i];

    // Verificar índice
    if (ev.indice !== i) {
      return {
        valido: false,
        totalEventos: eventos.length,
        primerErrorIndex: i,
        mensaje: `Error en la secuencia: la fase en la posición ${i} tiene índice ${ev.indice} (una fase fue borrada o reordenada).`
      };
    }

    // Verificar hashAnterior
    if (ev.hashAnterior !== hashEsperadoAnterior) {
      return {
        valido: false,
        totalEventos: eventos.length,
        primerErrorIndex: i,
        mensaje: `Cadena rota en la fase #${i} (${ev.tipo}): no enlaza con el hash de la fase anterior.`,
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
      registradoPorNombre: (ev as any).registradoPorNombre,
      registradoEn: ev.registradoEn,
      hashAnterior: ev.hashAnterior
    });

    if (hashCalculado !== ev.hash) {
      return {
        valido: false,
        totalEventos: eventos.length,
        primerErrorIndex: i,
        mensaje: `Alteración detectada en la fase #${i} (${ev.tipo}): sus datos fueron modificados después del registro.`,
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
    mensaje: `Cadena de trazabilidad 100% íntegra. Se verificaron ${eventos.length} fases sin alteración.`
  };
}

/**
 * Verificación completa de un lote: la cadena de eventos y, además, que el último hash coincida con
 * el sello guardado en el resumen (hashFinal, el "Sello hash de cierre" que se muestra y se imprime).
 * Así una cadena reescrita desde fuera de la app, sin actualizar el sello, se detecta.
 */
export async function verificarIntegridadLote(lote: {
  codigo: string;
  eventos?: EventoLote[];
  resumen?: { hashFinal?: string };
}): Promise<ResultadoVerificacion> {
  const eventos = lote.eventos || [];
  const res = await verificarIntegridadCadena(lote.codigo, eventos);
  if (!res.valido || !eventos.length) return res;
  const sello = lote.resumen?.hashFinal;
  const ultimo = eventos[eventos.length - 1].hash;
  if (sello && sello !== ultimo) {
    return {
      valido: false,
      totalEventos: eventos.length,
      primerErrorIndex: eventos.length - 1,
      mensaje: `El sello de cierre registrado (${sello.slice(0, 12)}…) no coincide con el último hash de la cadena (${ultimo.slice(0, 12)}…): la cadena fue reescrita.`
    };
  }
  return res;
}

// ---------- Rastro por dato y análisis de la cadena completa ----------

/**
 * Huella (SHA-256) de cada dato de una fase, guardada junto a la fase al registrarla. Si después
 * se altera un dato, la huella de ese dato deja de coincidir y se puede decir cuál cambió.
 */
export async function huellasFase(fase: { fechaEvento: string; descripcion: string; datos: Record<string, any> }): Promise<Record<string, string>> {
  const campos: Record<string, unknown> = { _fecha: fase.fechaEvento, _descripcion: fase.descripcion || '' };
  for (const [k, v] of Object.entries(fase.datos || {})) campos[k] = v;
  const huellas: Record<string, string> = {};
  for (const [k, v] of Object.entries(campos)) huellas[k] = await calcularSha256(jsonCanonico(v));
  return huellas;
}

export type EstadoFase = 'integra' | 'alterada' | 'enlace_roto' | 'secuencia';

export interface DiagnosticoFase {
  indice: number;
  tipo: string;
  estado: EstadoFase;
  mensaje: string;
  datosAlterados: string[]; // nombres de los datos cuyo rastro no coincide (solo fases con rastro)
  conRastro: boolean;
}

export interface AnalisisCadena {
  valido: boolean;
  fases: DiagnosticoFase[];
  selloCoincide: boolean | null; // null si el lote no tiene sello guardado
  mensaje: string;
}

const NOMBRE_DATO: Record<string, string> = {
  _fecha: 'Fecha',
  _descripcion: 'Descripción',
  temperatura: 'Temperatura',
  oxigenoDisuelto: 'Oxígeno disuelto',
  ph: 'pH',
  amonioTotal: 'Amonio total',
  nitritos: 'Nitritos',
  transparenciaSecchi: 'Transparencia Secchi',
  cantidad: 'Cantidad',
  cantidadKg: 'Alimento (kg)',
  tipoAlimento: 'Tipo de alimento',
  pesoPromedioG: 'Peso promedio',
  pesoPromedioInicialG: 'Peso inicial promedio',
  pecesMuestreados: 'Peces muestreados',
  pecesCosechados: 'Peces cosechados',
  biomasaCosechadaKg: 'Biomasa cosechada',
  proveedor: 'Proveedor',
  causa: 'Causa',
  cantidadSembrada: 'Cantidad sembrada',
  estanque: 'Estanque'
};

export const nombreDato = (k: string): string => NOMBRE_DATO[k] || k;

/**
 * Revisa TODAS las fases del lote (no se detiene en el primer error) y dice, para cada una, si está
 * íntegra, si sus datos fueron modificados (y cuáles, cuando la fase guarda rastro por dato), si se
 * rompió el enlace con la fase anterior o si falta o se reordenó una fase. También compara el último
 * hash con el sello guardado del lote.
 */
export async function analizarCadenaLote(lote: {
  codigo: string;
  eventos?: EventoLote[];
  resumen?: { hashFinal?: string };
}): Promise<AnalisisCadena> {
  const eventos = lote.eventos || [];
  const fases: DiagnosticoFase[] = [];
  for (let i = 0; i < eventos.length; i++) {
    const ev = eventos[i] as EventoLote & { huellas?: Record<string, string>; registradoPorNombre?: string };
    const conRastro = Boolean(ev.huellas && Object.keys(ev.huellas).length);
    const base = { indice: i, tipo: ev.tipo, datosAlterados: [] as string[], conRastro };
    if (ev.indice !== i) {
      fases.push({ ...base, estado: 'secuencia', mensaje: `Falta una fase o se reordenaron: en la posición ${i} aparece la fase #${ev.indice}.` });
      continue;
    }
    const anteriorEsperado = i === 0 ? HASH_GENESIS : eventos[i - 1].hash;
    const calculado = await calcularHashEvento({
      codigoLote: lote.codigo,
      indice: ev.indice,
      tipo: ev.tipo,
      fechaEvento: ev.fechaEvento,
      descripcion: ev.descripcion,
      datos: ev.datos,
      registradoPor: ev.registradoPor,
      registradoPorNombre: ev.registradoPorNombre,
      registradoEn: ev.registradoEn,
      hashAnterior: ev.hashAnterior
    });
    if (calculado !== ev.hash) {
      let datosAlterados: string[] = [];
      if (conRastro) {
        const actuales = await huellasFase(ev);
        const claves = new Set([...Object.keys(ev.huellas!), ...Object.keys(actuales)]);
        datosAlterados = [...claves].filter((k) => ev.huellas![k] !== actuales[k]).map(nombreDato);
      }
      fases.push({
        ...base,
        estado: 'alterada',
        datosAlterados,
        mensaje: datosAlterados.length
          ? `Fase #${i} (${ev.tipo}) alterada. Dato(s) modificado(s): ${datosAlterados.join(', ')}.`
          : `Fase #${i} (${ev.tipo}) alterada: sus datos cambiaron después del registro${conRastro ? ' (quien la cambió también modificó el rastro)' : ''}.`
      });
      continue;
    }
    if (ev.hashAnterior !== anteriorEsperado) {
      fases.push({ ...base, estado: 'enlace_roto', mensaje: `Fase #${i} (${ev.tipo}): no enlaza con la fase anterior (la cadena se rompió aquí).` });
      continue;
    }
    fases.push({ ...base, estado: 'integra', mensaje: 'Íntegra' });
  }
  const sello = lote.resumen?.hashFinal;
  const selloCoincide = sello && eventos.length ? sello === eventos[eventos.length - 1].hash : null;
  const problemas = fases.filter((f) => f.estado !== 'integra');
  const valido = problemas.length === 0 && selloCoincide !== false;
  return {
    valido,
    fases,
    selloCoincide,
    mensaje: valido
      ? `Cadena íntegra: ${fases.length} fase(s) verificadas.`
      : [
          problemas.length ? `${problemas.length} fase(s) con problemas: ${problemas.map((f) => '#' + f.indice).join(', ')}.` : '',
          selloCoincide === false ? 'El sello de cierre no coincide con la última fase: la cadena fue reescrita.' : ''
        ]
          .filter(Boolean)
          .join(' ')
  };
}
