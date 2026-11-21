import { EventoLote, Lote, ConfiguracionGeneral } from '../types';
import {
  sha256Texto,
  huellaParaComparar,
  esErrorSinHuellaSegura,
  MENSAJE_NO_VERIFICABLE,
  fragmentoSello
} from '../lib/integridad';
import { derivarLote, CabeceraLote, DiferenciaLote } from './calculosService';
import { ResumenLote } from '../types';

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

// Diferencia máxima entre la hora declarada por el equipo y la del servidor antes de avisar (H19)
const TOLERANCIA_HORA_REGISTRO_MS = 10 * 60 * 1000;

/**
 * Hora del servidor de una fase del lote o de un registro de anotación (H19), guardada fuera del hash
 * en registradoEnServidor[indice], y si la hora declarada por el equipo (registradoEn o fecha)
 * difiere en más de 10 minutos. Los registros anteriores a este cambio no la tienen (servidor null).
 */
export function horaServidorRegistro(
  mapa: Record<string, unknown> | undefined,
  indice: number,
  declarada: string | undefined
): { servidor: Date | null; desfase: boolean } {
  const marca = mapa?.[String(indice)] as { toDate?: () => Date; seconds?: number } | undefined;
  const servidor =
    marca && typeof marca.toDate === 'function' ? marca.toDate() : marca && typeof marca.seconds === 'number' ? new Date(marca.seconds * 1000) : null;
  if (!servidor || Number.isNaN(servidor.getTime())) return { servidor: null, desfase: false };
  const d = declarada ? Date.parse(declarada) : NaN;
  return { servidor, desfase: Number.isFinite(d) && Math.abs(d - servidor.getTime()) > TOLERANCIA_HORA_REGISTRO_MS };
}

/**
 * SHA-256 en hexadecimal (cálculo central en src/lib/integridad.ts). Sin crypto.subtle lanza un
 * error claro en vez de usar un hash no criptográfico: nada se guarda con una huella débil.
 */
export async function calcularSha256(cadena: string): Promise<string> {
  return sha256Texto(cadena);
}

/**
 * Calcula el hash para un evento dado
 */
export async function calcularHashEvento(payload: PayloadHashEvento): Promise<string> {
  return calcularSha256(generarJsonCanonico(payload));
}

/** Hash de un evento para compararlo con el guardado (acepta huellas de respaldo antiguas) */
async function hashEventoComparable(payload: PayloadHashEvento, guardado: string) {
  return huellaParaComparar(generarJsonCanonico(payload), guardado);
}

export interface ResultadoVerificacion {
  valido: boolean;
  totalEventos: number;
  primerErrorIndex?: number;
  mensaje: string;
  noVerificable?: boolean; // el navegador no puede calcular SHA-256: no hay resultado
  respaldo?: number[]; // fases con huella de respaldo antigua (no criptográfica)
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

const payloadDe = (codigoLote: string, ev: RegistroEncadenado): PayloadHashEvento => ({
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

/**
 * Texto canónico exacto de una fase del lote: sus bytes UTF-8 son lo que se pasa a SHA-256 para
 * obtener el hash de la fase (el mismo que usan el registro y la verificación)
 */
export const textoCanonicoEvento = (codigoLote: string, ev: RegistroEncadenado): string =>
  generarJsonCanonico(payloadDe(codigoLote, ev));

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
  const respaldo: number[] = [];

  try {
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
      const calc = await hashEventoComparable(payloadDe(codigoLote, ev), ev.hash);
      if (calc.respaldo) respaldo.push(i);

      if (calc.hash !== ev.hash) {
        return {
          valido: false,
          totalEventos: eventos.length,
          primerErrorIndex: i,
          mensaje: `Alteración detectada en la fase #${i} (${ev.tipo}): sus datos fueron modificados después del registro.`,
          detalles: {
            indice: i,
            hashEsperado: calc.hash,
            hashAlmacenado: ev.hash,
            hashAnteriorEsperado: hashEsperadoAnterior,
            hashAnteriorAlmacenado: ev.hashAnterior
          }
        };
      }

      hashEsperadoAnterior = ev.hash;
    }
  } catch (e) {
    if (esErrorSinHuellaSegura(e)) {
      return { valido: false, noVerificable: true, totalEventos: eventos.length, mensaje: MENSAJE_NO_VERIFICABLE };
    }
    throw e;
  }

  return {
    valido: true,
    totalEventos: eventos.length,
    respaldo,
    mensaje:
      `Cadena de trazabilidad 100% íntegra. Se verificaron ${eventos.length} fases sin alteración.` +
      (respaldo.length ? ` ${respaldo.length} fase(s) con huella de respaldo, no criptográfica.` : '')
  };
}

type LoteVerificable = {
  codigo: string;
  estado?: string;
  eventos?: EventoLote[];
  resumen?: { hashFinal?: string };
};

/**
 * Problemas de forma de un lote que la cadena sola no muestra: un lote sellado sin fases, con el
 * sello vacío o cuya primera fase no es la siembra.
 */
export function problemasDeFormaLote(lote: LoteVerificable): string[] {
  const eventos = lote.eventos || [];
  const p: string[] = [];
  if (lote.estado === 'cerrado') {
    if (!eventos.length) p.push('El lote está sellado pero no tiene fases registradas: su historial fue vaciado.');
    if (!lote.resumen?.hashFinal) p.push('El lote está sellado pero su sello de cierre está vacío.');
  }
  if (eventos.length && eventos[0].tipo !== 'Siembra') p.push('La primera fase registrada no es la siembra.');
  return p;
}

/**
 * Verificación completa de un lote: la cadena de eventos y, además, que el último hash coincida con
 * el sello guardado en el resumen (hashFinal, el "Sello hash de cierre" que se muestra y se imprime).
 * Así una cadena reescrita desde fuera de la app, sin actualizar el sello, se detecta.
 */
export async function verificarIntegridadLote(lote: LoteVerificable): Promise<ResultadoVerificacion> {
  const eventos = lote.eventos || [];
  const res = await verificarIntegridadCadena(lote.codigo, eventos);
  if (!res.valido) return res;
  const forma = problemasDeFormaLote(lote);
  if (forma.length) {
    return { valido: false, totalEventos: eventos.length, primerErrorIndex: Math.max(0, eventos.length - 1), mensaje: forma.join(' ') };
  }
  if (!eventos.length) return res;
  const sello = lote.resumen?.hashFinal;
  const ultimo = eventos[eventos.length - 1].hash;
  if (sello && sello !== ultimo) {
    return {
      valido: false,
      totalEventos: eventos.length,
      primerErrorIndex: eventos.length - 1,
      mensaje: `El sello de cierre registrado (${sello.slice(0, 12)}…) no coincide con el último hash de la cadena (${ultimo.slice(0, 12)}…): se borró o se cambió una fase.`
    };
  }
  return res;
}

// ---------- Rastro por dato y análisis de la cadena completa ----------

/**
 * Huella (SHA-256) de cada dato de una fase, guardada junto a la fase al registrarla. Si después
 * se altera un dato, la huella de ese dato deja de coincidir y se puede decir cuál cambió.
 * Con `guardadas` se recalcula para comparar (acepta huellas de respaldo antiguas).
 */
export async function huellasFase(
  fase: { fechaEvento: string; descripcion: string; datos: Record<string, any> },
  guardadas?: Record<string, string>
): Promise<Record<string, string>> {
  const campos: Record<string, unknown> = { _fecha: fase.fechaEvento, _descripcion: fase.descripcion || '' };
  for (const [k, v] of Object.entries(fase.datos || {})) campos[k] = v;
  const huellas: Record<string, string> = {};
  for (const [k, v] of Object.entries(campos)) {
    huellas[k] = guardadas ? (await huellaParaComparar(jsonCanonico(v), guardadas[k])).hash : await calcularSha256(jsonCanonico(v));
  }
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
  respaldo?: boolean; // la huella guardada es la de respaldo antigua (no criptográfica)
}

export interface AnalisisCadena {
  valido: boolean;
  fases: DiagnosticoFase[];
  selloCoincide: boolean | null; // null si el lote no tiene sello guardado
  problemasLote: string[]; // lote sellado vacío, sin sello o sin siembra
  noVerificable?: boolean; // el navegador no puede calcular SHA-256
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
  tallaPromedioCm: 'Talla promedio (cm)',
  etapa: 'Etapa del cultivo',
  pecesCosechados: 'Peces cosechados',
  biomasaCosechadaKg: 'Biomasa cosechada',
  proveedor: 'Proveedor',
  causa: 'Causa',
  causaProbable: 'Causa probable',
  cantidadSembrada: 'Cantidad sembrada',
  estanque: 'Estanque',
  pctProteina: 'Proteína (%)',
  numeroRaciones: 'Número de raciones',
  pesoInicialPromedioG: 'Peso inicial promedio',
  pesoInicialG: 'Peso inicial',
  proveedorAlevinos: 'Proveedor de alevinos',
  observacionesIniciales: 'Observaciones iniciales',
  producto: 'Producto',
  dosis: 'Dosis',
  unidad: 'Unidad',
  viaAplicacion: 'Vía de aplicación',
  objetivo: 'Objetivo',
  descripcion: 'Descripción',
  escamadoEviscerado: 'Escamado y eviscerado',
  cantidadProcesada: 'Cantidad procesada',
  pesoPromedioFinalG: 'Peso promedio final',
  responsable: 'Responsable',
  tipoEmpaque: 'Tipo de empaque',
  temperaturaConservacionC: 'Temperatura de conservación (°C)',
  usoHielo: 'Uso de hielo',
  fechaHoraSalida: 'Fecha y hora de salida',
  destino: 'Destino',
  contenedorIsotermico: 'Contenedor isotérmico',
  temperaturaDespachoC: 'Temperatura de despacho (°C)',
  eventoCorregidoId: 'Fase corregida',
  motivoCorreccion: 'Motivo de la corrección',
  ambito: 'Ámbito'
};

export const nombreDato = (k: string): string => NOMBRE_DATO[k] || k;

/**
 * Revisa TODAS las fases del lote (no se detiene en el primer error) y dice, para cada una, si está
 * íntegra, si sus datos fueron modificados (y cuáles, cuando la fase guarda rastro por dato), si se
 * rompió el enlace con la fase anterior o si falta o se reordenó una fase. También compara el último
 * hash con el sello guardado del lote y revisa que un lote sellado no esté vacío ni sin sello.
 */
export async function analizarCadenaLote(lote: LoteVerificable): Promise<AnalisisCadena> {
  const eventos = lote.eventos || [];
  const fases: DiagnosticoFase[] = [];
  try {
    for (let i = 0; i < eventos.length; i++) {
      const ev = eventos[i] as EventoLote & { huellas?: Record<string, string>; registradoPorNombre?: string };
      const conRastro = Boolean(ev.huellas && Object.keys(ev.huellas).length);
      const base = { indice: i, tipo: ev.tipo, datosAlterados: [] as string[], conRastro };
      if (ev.indice !== i) {
        fases.push({ ...base, estado: 'secuencia', mensaje: `Falta una fase o se reordenaron: en la posición ${i} aparece la fase #${ev.indice}.` });
        continue;
      }
      const anteriorEsperado = i === 0 ? HASH_GENESIS : eventos[i - 1].hash;
      const calc = await hashEventoComparable(payloadDe(lote.codigo, ev), ev.hash);
      if (calc.hash !== ev.hash) {
        let datosAlterados: string[] = [];
        if (conRastro) {
          const actuales = await huellasFase(ev, ev.huellas);
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
      fases.push({
        ...base,
        estado: 'integra',
        respaldo: calc.respaldo,
        mensaje: calc.respaldo ? 'Íntegra, con huella de respaldo, no criptográfica.' : 'Íntegra'
      });
    }
  } catch (e) {
    if (esErrorSinHuellaSegura(e)) {
      return { valido: false, fases: [], selloCoincide: null, problemasLote: [], noVerificable: true, mensaje: MENSAJE_NO_VERIFICABLE };
    }
    throw e;
  }
  const sello = lote.resumen?.hashFinal;
  const selloCoincide = sello && eventos.length ? sello === eventos[eventos.length - 1].hash : null;
  const problemasLote = problemasDeFormaLote(lote);
  const problemas = fases.filter((f) => f.estado !== 'integra');
  const valido = problemas.length === 0 && selloCoincide !== false && problemasLote.length === 0;
  return {
    valido,
    fases,
    selloCoincide,
    problemasLote,
    mensaje: valido
      ? `Cadena íntegra: ${fases.length} fase(s) verificadas.`
      : [
          problemas.length ? `${problemas.length} fase(s) con problemas: ${problemas.map((f) => '#' + f.indice).join(', ')}.` : '',
          selloCoincide === false ? 'El sello de cierre no coincide con la última fase: se borró o se cambió una fase.' : '',
          ...problemasLote
        ]
          .filter(Boolean)
          .join(' ')
  };
}

// ---------- Revisión completa al abrir un lote (detalle, vista pública y certificado) ----------

export type EstadoRevision = 'integro' | 'alterado' | 'no_verificable';

export interface RevisionLote {
  estado: EstadoRevision;
  analisis: AnalisisCadena;
  cabecera: CabeceraLote; // cabecera derivada de la cadena (lo que se muestra)
  resumen: ResumenLote; // resumen derivado de la cadena (lo que se muestra)
  diferencias: DiferenciaLote[]; // datos guardados que no coinciden con los derivados
  selloQr: 'coincide' | 'no_coincide' | null; // comparación con el sello impreso en el QR (?s=)
  avisos: string[]; // textos claros para el aviso automático
  respaldo: number[]; // fases con huella de respaldo, no criptográfica
}

/**
 * Revisión que corre sola al abrir un lote: cadena de fases, sello, forma del lote, cabecera y
 * resumen derivados frente a los guardados y, si el QR trae el sello impreso, ese sello.
 */
export async function revisarLote(
  lote: Lote,
  opciones: { config?: ConfiguracionGeneral; selloQr?: string | null; anotacionesSelloCambiado?: boolean } = {}
): Promise<RevisionLote> {
  const analisis = await analizarCadenaLote(lote);
  const derivado = derivarLote(lote, opciones.config);
  const eventos = lote.eventos || [];
  const avisos: string[] = [];
  let selloQr: RevisionLote['selloQr'] = null;

  if (analisis.noVerificable) avisos.push(MENSAJE_NO_VERIFICABLE);
  for (const f of analisis.fases) if (f.estado !== 'integra') avisos.push(f.mensaje);
  if (analisis.selloCoincide === false) {
    avisos.push('El sello de cierre guardado no coincide con la última fase registrada: se borró o se cambió una fase.');
  }
  avisos.push(...analisis.problemasLote);
  for (const d of derivado.diferencias) {
    avisos.push(`${d.etiqueta}: el dato guardado (${d.guardado}) no corresponde a las fases registradas (${d.derivado}).`);
  }
  const s = fragmentoSello(opciones.selloQr);
  if (s) {
    const ultimo = eventos.length ? eventos[eventos.length - 1].hash : '';
    const coincide = Boolean(ultimo) && ultimo.toLowerCase().startsWith(s) && (lote.resumen?.hashFinal || '').toLowerCase().startsWith(s);
    selloQr = coincide ? 'coincide' : 'no_coincide';
    if (!coincide) {
      avisos.push(`El sello impreso en el código QR (${s}) no coincide con el sello actual del lote: el registro cambió después de imprimir la etiqueta.`);
    }
  }
  if (opciones.anotacionesSelloCambiado) {
    avisos.push('El sello del lote cambió después de registrar sus anotaciones: el registro sellado fue modificado.');
  }
  // Las diferencias de datos y de forma no necesitan SHA-256: se avisan aunque el navegador no verifique
  const hallazgos = avisos.filter((a) => a !== MENSAJE_NO_VERIFICABLE);
  const estado: EstadoRevision = hallazgos.length ? 'alterado' : analisis.noVerificable ? 'no_verificable' : 'integro';
  return {
    estado,
    analisis,
    cabecera: derivado.cabecera,
    resumen: derivado.resumen,
    diferencias: derivado.diferencias,
    selloQr,
    avisos,
    respaldo: analisis.fases.filter((f) => f.respaldo).map((f) => f.indice)
  };
}
