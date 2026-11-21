import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { ConfiguracionGeneral, FichaNutricional, Lote, SelloTiempo } from '../types';
import { jsonCanonico } from './hashService';
import { sha256Texto } from '../lib/integridad';
import {
  analizarOts,
  bloqueBitcoin,
  compromisoEnBloque,
  completarPruebaOts,
  crearPruebaOts,
  deBase64,
  PREFIJO_EXTRA
} from '../lib/ots';
import { formatearFechaColombia } from '../utils/constants';

/**
 * Testigo externo (H03): el sello de cierre de un lote y el hash de cada comprobante se envían a
 * los calendarios públicos de OpenTimestamps, que los anclan en Bitcoin en pocas horas. La prueba
 * (.ots) se guarda en el registro, fuera del hash, en `selloTiempo`. Quien reescriba toda la cadena
 * en Firestore no puede cambiar lo que quedó en Bitcoin: el sello actual deja de coincidir.
 *
 * El envío nunca bloquea ni hace fallar el cierre o la emisión: si los calendarios no responden,
 * el registro queda sin sello y se reintenta al abrir su detalle con una sesión que pueda crearlo.
 * La confirmación (prueba completa) la guarda quien puede crear el sello (cerrar lotes o gestionar
 * comprobantes) al abrir el registro después de que Bitcoin la confirma; los demás usuarios y la
 * consulta pública, sin sesión, solo la calculan en memoria (las reglas no les dejan guardarla).
 */

/**
 * Fecha (Colombia) desde la que lotes y comprobantes nuevos deben tener sello de tiempo. Los
 * registros anteriores se muestran sin alarma ("anterior al sello de tiempo"). Debe ser el día en
 * que se publica esta versión de la web (se puede fijar con VITE_SELLO_TIEMPO_DESDE).
 */
const DESDE_CONFIGURADO = String(import.meta.env?.VITE_SELLO_TIEMPO_DESDE || '').trim();
export const SELLO_TIEMPO_DESDE = /^\d{4}-\d{2}-\d{2}$/.test(DESDE_CONFIGURADO) ? DESDE_CONFIGURADO : '2026-11-20';

/** Un sello confirmado en Bitcoin más de tres días después del cierre no prueba el registro al cerrarse */
const MAXIMO_RETRASO_SELLO_MS = 3 * 24 * 60 * 60 * 1000;

/** Espera antes de pedir la confirmación a los calendarios (Bitcoin tarda horas en confirmar) */
const ESPERA_CONFIRMACION_MS = 60 * 60 * 1000;

/** Pausa entre dos consultas del mismo sello pendiente a los calendarios en esta pestaña */
const PAUSA_ENTRE_CONSULTAS_MS = 60 * 60 * 1000;

// ---------- Ficha nutricional congelada (H41) ----------

const CLAVES_FICHA: (keyof FichaNutricional)[] = [
  'porcionG',
  'energiaKcal',
  'proteinaG',
  'grasaTotalG',
  'carbohidratosG',
  'colesterolMg',
  'sodioMg',
  'fuente',
  'notas'
];

/** Copia de la ficha con exactamente sus nueve claves y tipos (lo que aceptan las reglas al cerrar) */
export function copiaFicha(f: FichaNutricional): FichaNutricional {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
  return {
    porcionG: num(f.porcionG),
    energiaKcal: num(f.energiaKcal),
    proteinaG: num(f.proteinaG),
    grasaTotalG: num(f.grasaTotalG),
    carbohidratosG: num(f.carbohidratosG),
    colesterolMg: num(f.colesterolMg),
    sodioMg: num(f.sodioMg),
    fuente: String(f.fuente ?? '').slice(0, 500),
    notas: String(f.notas ?? '').slice(0, 1000)
  };
}

/**
 * Ficha que corresponde al lote: la congelada al cerrar o, si el lote se cerró antes de esta
 * función (o sigue abierto), la vigente en la configuración.
 */
export function fichaDelLote(lote: Pick<Lote, 'estado' | 'fichaNutricionalCierre'>, config: ConfiguracionGeneral): {
  ficha: FichaNutricional;
  congelada: boolean;
  nota: string | null;
} {
  if (lote.fichaNutricionalCierre) return { ficha: lote.fichaNutricionalCierre, congelada: true, nota: null };
  return {
    ficha: config.fichaNutricional,
    congelada: false,
    nota: lote.estado === 'cerrado' ? 'Ficha vigente (este lote se cerró antes de congelar la ficha).' : null
  };
}

/**
 * Huella de la ficha congelada que se agrega a la prueba de OpenTimestamps del lote (prefijo 0x46 y
 * SHA-256 del JSON canónico): el sello de Bitcoin cubre el sello de cierre y la ficha a la vez
 */
export async function compromisoFicha(f: FichaNutricional): Promise<string> {
  const copia: Record<string, unknown> = {};
  for (const k of CLAVES_FICHA) copia[k] = (f as any)[k];
  return PREFIJO_EXTRA + (await sha256Texto(jsonCanonico(copia)));
}

// ---------- Qué se sella ----------

const fechaDeCodigo = (codigo: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})-/.exec(codigo || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};

/** Sello actual del lote (lo que la prueba debe cubrir): el hash de su última fase */
export const selloActualLote = (lote: Lote) =>
  (lote.eventos?.length ? lote.eventos[lote.eventos.length - 1].hash : '') || lote.resumen?.hashFinal || '';

/** Un lote cerrado desde la activación (o creado desde entonces) debe tener sello de tiempo */
export function loteDebeTenerSello(lote: Lote): boolean {
  if (lote.estado !== 'cerrado') return false;
  return (lote.fechaCierre || '') >= SELLO_TIEMPO_DESDE || fechaDeCodigo(lote.codigo) >= SELLO_TIEMPO_DESDE;
}

/** Un bloque emitido desde la activación debe tener sello de tiempo */
export function bloqueDebeTenerSello(b: { emitidoEn: string; registradoEnServidor?: { toDate(): Date } }): boolean {
  const servidor = b.registradoEnServidor && typeof b.registradoEnServidor.toDate === 'function' ? b.registradoEnServidor.toDate().toISOString() : '';
  const fecha = (iso: string) => (iso ? formatearDia(iso) : '');
  return fecha(b.emitidoEn) >= SELLO_TIEMPO_DESDE || fecha(servidor) >= SELLO_TIEMPO_DESDE;
}

function formatearDia(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// ---------- Envío y confirmación ----------

async function guardarSello(ruta: [string, string], sello: Record<string, unknown>): Promise<boolean> {
  try {
    await updateDoc(doc(db, ruta[0], ruta[1]), { selloTiempo: sello });
    return true;
  } catch (err) {
    console.warn('No se guardó el sello de tiempo (se reintentará al abrir el registro):', err);
    return false;
  }
}

// Envíos en curso en esta pestaña (el cierre y la ventana de detalle pueden pedirlo a la vez)
const enviosEnCurso = new Set<string>();

/** Envía el sello a los calendarios y lo guarda como pendiente. Nunca lanza. */
async function enviarSello(ruta: [string, string], digest: string, compromisoExtra?: string): Promise<boolean> {
  const clave = ruta.join('/');
  if (enviosEnCurso.has(clave)) return false;
  enviosEnCurso.add(clave);
  try {
    if (!/^[0-9a-f]{64}$/.test(digest)) return false;
    const prueba = await crearPruebaOts(digest, compromisoExtra ? { compromisoExtra } : {});
    if (!prueba) {
      console.warn('Los calendarios de OpenTimestamps no respondieron: el registro queda sin sello de tiempo por ahora.');
      return false;
    }
    return guardarSello(ruta, {
      version: 1,
      digest,
      ots: prueba.ots,
      estado: 'pendiente',
      enviadoEn: serverTimestamp(),
      calendarios: prueba.calendarios
    });
  } catch (err) {
    console.warn('Sello de tiempo no enviado:', err);
    return false;
  } finally {
    enviosEnCurso.delete(clave);
  }
}

/** Sella un lote cerrado (después del cierre, sin bloquearlo) */
export async function sellarLote(lote: Lote): Promise<boolean> {
  // Los lotes cerrados antes de la activación no se sellan después (decisión del usuario, 2026-11-20)
  if (lote.estado !== 'cerrado' || lote.selloTiempo || !loteDebeTenerSello(lote)) return false;
  const extra = lote.fichaNutricionalCierre ? await compromisoFicha(lote.fichaNutricionalCierre) : undefined;
  return enviarSello(['lotes', lote.codigo], lote.resumen?.hashFinal || '', extra);
}

/** Sella un bloque de comprobante (después de emitirlo, sin bloquearlo) */
export async function sellarBloque(b: { id: string; hashComprobante: string; emitidoEn: string; registradoEnServidor?: { toDate(): Date }; selloTiempo?: SelloTiempo }): Promise<boolean> {
  // Igual que los lotes: los comprobantes emitidos antes de la activación no se sellan después
  if (b.selloTiempo || !bloqueDebeTenerSello(b)) return false;
  return enviarSello(['comprobantes', b.id], b.hashComprobante);
}

// ---------- Consultas a los calendarios, con pausa ----------
// Mientras el sello está pendiente, los calendarios responden 404 sin cabecera CORS y el navegador
// anota cada intento como error en la consola (no se puede silenciar desde la página). Para no
// llenarla: no se consulta antes de una hora desde el envío (Bitcoin no puede haberlo confirmado),
// el mismo sello se consulta a lo sumo una vez por hora en la pestaña (memoria y sessionStorage),
// las consultas simultáneas del mismo sello comparten la respuesta y la prueba completa se recuerda.

const enviado = (s: Pick<SelloTiempo, 'enviadoEn'>) =>
  s.enviadoEn && typeof s.enviadoEn.toMillis === 'function' ? s.enviadoEn.toMillis() : 0;

const consultasEnCurso = new Map<string, Promise<string | null>>();
const pruebasCompletas = new Map<string, string>();
const ultimasConsultas = new Map<string, number>();
const CLAVE_SESION = 'tilapia-sello-consulta:';

function ultimaConsulta(clave: string): number {
  let t = ultimasConsultas.get(clave) || 0;
  try {
    t = Math.max(t, Number(window.sessionStorage.getItem(CLAVE_SESION + clave)) || 0);
  } catch {
    /* sin sessionStorage: basta la memoria */
  }
  return t;
}

function anotarConsulta(clave: string, t: number): void {
  ultimasConsultas.set(clave, t);
  try {
    window.sessionStorage.setItem(CLAVE_SESION + clave, String(t));
  } catch {
    /* sin sessionStorage: basta la memoria */
  }
}

/** Prueba completa del sello (base64) si los calendarios ya la tienen; null si sigue pendiente o si toca esperar */
async function completarConPausa(sello: Pick<SelloTiempo, 'digest' | 'ots' | 'enviadoEn'>): Promise<string | null> {
  // La respuesta se recuerda por la prueba exacta; la pausa, por el sello (digest y tamaño de la prueba)
  const completa = pruebasCompletas.get(sello.ots);
  if (completa) return completa;
  const enCurso = consultasEnCurso.get(sello.ots);
  if (enCurso) return enCurso;
  const ahora = Date.now();
  const envio = enviado(sello);
  if (envio && ahora - envio < ESPERA_CONFIRMACION_MS) return null;
  const clave = `${sello.digest}:${sello.ots.length}`;
  if (ahora - ultimaConsulta(clave) < PAUSA_ENTRE_CONSULTAS_MS) return null;
  anotarConsulta(clave, ahora);
  const p = completarPruebaOts(sello.ots)
    .catch(() => null)
    .then((ots) => {
      if (ots) pruebasCompletas.set(sello.ots, ots);
      return ots;
    })
    .finally(() => consultasEnCurso.delete(sello.ots));
  consultasEnCurso.set(sello.ots, p);
  return p;
}

/** Pide la prueba completa a los calendarios; si ya llegó a Bitcoin devuelve el sello confirmado */
export async function confirmarSello(sello: SelloTiempo): Promise<SelloTiempo | null> {
  try {
    if (sello.estado !== 'pendiente') return null;
    const ots = await completarConPausa(sello);
    if (!ots) return null;
    const a = await analizarOts(ots);
    if (a.digest !== sello.digest || !a.bitcoin.length) return null;
    const altura = a.bitcoin[0].altura;
    const bloque = await bloqueBitcoin(altura);
    if (bloque && !compromisoEnBloque(a.bitcoin[0].compromiso, bloque)) return null;
    return { ...sello, ots, estado: 'confirmado', bloque: altura, ...(bloque ? { confirmadoEn: bloque.fecha } : {}) };
  } catch {
    return null;
  }
}

/**
 * Al abrir el registro con sesión: si falta el sello y quien lo abre puede crearlo, lo envía; si
 * está pendiente desde hace más de una hora, pide la confirmación y, solo si quien lo abre puede
 * crear el sello (las reglas exigen el mismo permiso), la guarda. Nunca lanza.
 * Devuelve el sello confirmado (para mostrarlo aunque no se haya guardado) o null.
 */
export async function mantenerSello(opciones: {
  ruta: [string, string];
  sello?: SelloTiempo;
  /** Solo se da a quien puede crear el sello (cerrar lotes o gestionar comprobantes) */
  crear?: () => Promise<boolean>;
  /** Si se guarda la confirmación; por defecto, solo quien puede crear el sello */
  puedeGuardar?: boolean;
}): Promise<SelloTiempo | null> {
  try {
    const { sello } = opciones;
    if (!sello) {
      if (opciones.crear) await opciones.crear();
      return null;
    }
    if (sello.estado !== 'pendiente' || Date.now() - enviado(sello) < ESPERA_CONFIRMACION_MS) return null;
    const confirmado = await confirmarSello(sello);
    const puedeGuardar = opciones.puedeGuardar ?? Boolean(opciones.crear);
    if (confirmado && puedeGuardar) await guardarSello(opciones.ruta, confirmado as unknown as Record<string, unknown>);
    return confirmado;
  } catch {
    return null;
  }
}

// ---------- Verificación ----------

export type EstadoSello = 'confirmado' | 'pendiente' | 'sin_sello' | 'anterior' | 'alterado';

export interface RevisionSello {
  estado: EstadoSello;
  avisos: string[]; // alteración (rojo)
  advertencias: string[]; // sello tardío (oro): no es una alteración probada
  mensaje: string; // línea de estado
  fechaBitcoin?: string; // hora del bloque (ISO)
  bloque?: number;
  comprobadoEnBitcoin: boolean; // se consultó el bloque y la raíz de Merkle coincide
  enviadoEn?: string; // ISO
  digest?: string;
  ots?: string; // prueba vigente (la guardada o la completada en memoria) para descargar
}

/**
 * Revisa el sello de tiempo de un registro: que la prueba cubra el sello guardado, que este sea el
 * sello actual, que el dato extra (ficha congelada) sea el actual y que la atestación de Bitcoin
 * coincida con la raíz de Merkle del bloque (explorador público). Si la prueba sigue pendiente,
 * intenta completarla en memoria (sin escribir).
 */
export async function revisarSello(
  sello: SelloTiempo | undefined | null,
  opciones: { digestActual: string; compromisoExtra?: string | null; esperado: boolean; consultarRed?: boolean; fechaRegistro?: string }
): Promise<RevisionSello> {
  if (!sello) {
    return opciones.esperado
      ? {
          estado: 'sin_sello',
          avisos: [],
          advertencias: [],
          comprobadoEnBitcoin: false,
          mensaje: 'Sin sello de tiempo: este registro debería tener su sello en Bitcoin y no lo tiene. Si el aviso persiste, consulte a Cultivos Loré.'
        }
      : { estado: 'anterior', avisos: [], advertencias: [], comprobadoEnBitcoin: false, mensaje: 'Registro anterior al sello de tiempo en Bitcoin.' };
  }
  const avisos: string[] = [];
  const enviadoEn = enviado(sello) ? new Date(enviado(sello)).toISOString() : undefined;
  let ots = sello.ots;
  let a;
  try {
    deBase64(ots);
    a = await analizarOts(ots);
  } catch {
    return {
      estado: 'alterado',
      avisos: ['La prueba del sello de tiempo está dañada: no se puede leer.'],
      advertencias: [],
      comprobadoEnBitcoin: false,
      mensaje: 'Sello de tiempo dañado.',
      enviadoEn,
      digest: sello.digest,
      ots
    };
  }
  if (!a.bitcoin.length && opciones.consultarRed !== false) {
    const completa = await completarConPausa(sello).catch(() => null);
    if (completa) {
      try {
        const b = await analizarOts(completa);
        if (b.digest === a.digest) {
          ots = completa;
          a = b;
        }
      } catch {
        /* se queda la guardada */
      }
    }
  }
  if (a.digest !== sello.digest) avisos.push('La prueba del sello de tiempo no corresponde al sello registrado: fue reemplazada.');
  const extra = opciones.compromisoExtra || null;
  if (extra !== a.compromisoExtra) {
    avisos.push(
      extra
        ? 'La ficha nutricional congelada al cerrar no coincide con la registrada en el sello de tiempo: fue cambiada.'
        : 'El sello de tiempo registra una ficha nutricional congelada que ya no está en el lote: fue borrada.'
    );
  }

  let fechaBitcoin: string | undefined;
  let bloque: number | undefined;
  let comprobadoEnBitcoin = false;
  if (a.bitcoin.length) {
    const at = a.bitcoin[0];
    bloque = at.altura;
    const b = opciones.consultarRed === false ? null : await bloqueBitcoin(at.altura);
    if (b) {
      if (compromisoEnBloque(at.compromiso, b)) {
        comprobadoEnBitcoin = true;
        fechaBitcoin = b.fecha;
      } else {
        avisos.push(`La prueba del sello de tiempo no coincide con el bloque ${at.altura} de Bitcoin: fue fabricada o alterada.`);
      }
    } else {
      fechaBitcoin = sello.confirmadoEn;
    }
  } else if (sello.estado === 'confirmado') {
    avisos.push('El sello de tiempo figura como confirmado, pero su prueba no llega a Bitcoin: fue alterada.');
  }

  const actual = (opciones.digestActual || '').toLowerCase();
  if (a.digest !== actual) {
    const cuando = fechaBitcoin ? formatearFechaColombia(fechaBitcoin) : enviadoEn ? formatearFechaColombia(enviadoEn) : '';
    avisos.unshift(
      a.bitcoin.length
        ? `Posible alteración detectada: el sello registrado en Bitcoin${cuando ? ` el día ${cuando}` : ''} no coincide con el actual.`
        : `Posible alteración detectada: el sello enviado al testigo externo${cuando ? ` el día ${cuando}` : ''} no coincide con el actual.`
    );
  }

  // Un registro nuevo se sella al cerrarse o emitirse: si Bitcoin lo confirmó días después, el sello
  // solo prueba que existía desde esa fecha (por ejemplo, se reescribió y se volvió a sellar)
  const advertencias: string[] = [];
  const registro = opciones.fechaRegistro ? Date.parse(opciones.fechaRegistro.length === 10 ? `${opciones.fechaRegistro}T23:59:59-05:00` : opciones.fechaRegistro) : NaN;
  if (opciones.esperado && comprobadoEnBitcoin && fechaBitcoin && Number.isFinite(registro) && Date.parse(fechaBitcoin) - registro > MAXIMO_RETRASO_SELLO_MS) {
    const dias = Math.floor((Date.parse(fechaBitcoin) - registro) / (24 * 60 * 60 * 1000));
    advertencias.push(
      `El sello se registró en Bitcoin ${dias} días después del cierre o la emisión: solo prueba que el registro existía desde el ${formatearFechaColombia(fechaBitcoin)}.`
    );
  }

  const base = { avisos, advertencias, fechaBitcoin, bloque, comprobadoEnBitcoin, enviadoEn, digest: a.digest, ots };
  if (avisos.length) return { ...base, estado: 'alterado', mensaje: 'El sello de tiempo no coincide.' };
  if (a.bitcoin.length) {
    return {
      ...base,
      estado: 'confirmado',
      mensaje: comprobadoEnBitcoin
        ? `Sello registrado en Bitcoin el día ${formatearFechaColombia(fechaBitcoin)} (bloque ${bloque}).`
        : `Sello registrado en Bitcoin (bloque ${bloque}${fechaBitcoin ? `, ${formatearFechaColombia(fechaBitcoin)}` : ''}). No se pudo consultar Bitcoin ahora para comprobarlo.`
    };
  }
  return {
    ...base,
    estado: 'pendiente',
    mensaje: `Sello de tiempo enviado${enviadoEn ? ` el ${formatearFechaColombia(enviadoEn)}` : ''}, pendiente de confirmar en Bitcoin (suele tardar unas horas).`
  };
}

/** Revisión del sello de un lote (con la ficha congelada, si la tiene) */
export async function revisarSelloLote(lote: Lote, opciones: { consultarRed?: boolean } = {}): Promise<RevisionSello> {
  const extra = lote.fichaNutricionalCierre ? await compromisoFicha(lote.fichaNutricionalCierre) : null;
  return revisarSello(lote.selloTiempo, {
    digestActual: selloActualLote(lote),
    compromisoExtra: extra,
    esperado: loteDebeTenerSello(lote),
    consultarRed: opciones.consultarRed,
    fechaRegistro: lote.fechaCierre || undefined
  });
}

/** Revisión del sello de un bloque de comprobante */
export function revisarSelloBloque(
  b: { hashComprobante: string; emitidoEn: string; registradoEnServidor?: { toDate(): Date }; selloTiempo?: SelloTiempo },
  opciones: { consultarRed?: boolean } = {}
): Promise<RevisionSello> {
  return revisarSello(b.selloTiempo, {
    digestActual: b.hashComprobante,
    esperado: bloqueDebeTenerSello(b),
    consultarRed: opciones.consultarRed,
    fechaRegistro: b.emitidoEn
  });
}

/** Descarga la prueba .ots (para verificarla en opentimestamps.org con el sello como archivo de hash) */
export function descargarOts(ots: string, nombre: string): void {
  const bytes = deBase64(ots);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombre}.ots`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Texto del sello de tiempo para los PDF (sin consultar la red, o con la revisión ya hecha) */
export function textoSelloPdf(r: RevisionSello): { texto: string; tono: 'verde' | 'rojo' | 'oro' | 'gris' } {
  const digest = r.digest ? ` Sello cubierto: ${r.digest}.` : '';
  switch (r.estado) {
    case 'confirmado':
      return {
        texto:
          `Sello de tiempo: registrado en Bitcoin${r.fechaBitcoin ? ` el día ${formatearFechaColombia(r.fechaBitcoin)}` : ''} (bloque ${r.bloque}), ` +
          `testigo externo OpenTimestamps.${digest} La prueba .ots se descarga en la consulta pública y se verifica en opentimestamps.org.` +
          (r.advertencias.length ? ` ${r.advertencias.join(' ')}` : ''),
        tono: r.advertencias.length ? 'oro' : r.comprobadoEnBitcoin ? 'verde' : 'gris'
      };
    case 'pendiente':
      return {
        texto: `Sello de tiempo: enviado a OpenTimestamps${r.enviadoEn ? ` el ${formatearFechaColombia(r.enviadoEn)}` : ''}, pendiente de confirmar en Bitcoin.${digest}`,
        tono: 'oro'
      };
    case 'sin_sello':
      return { texto: 'Sin sello de tiempo: este registro debería tener su sello en Bitcoin y no lo tiene.', tono: 'oro' };
    case 'anterior':
      return { texto: 'Registro anterior al sello de tiempo en Bitcoin.', tono: 'gris' };
    default:
      return { texto: `Sello de tiempo: ${r.avisos.join(' ')}`, tono: 'rojo' };
  }
}
