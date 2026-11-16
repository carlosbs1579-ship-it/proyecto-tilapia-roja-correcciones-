/**
 * Cálculo central de huellas SHA-256 de la plataforma. Todos los servicios (fases del lote,
 * anotaciones, comprobantes y fotos) calculan sus huellas aquí, de modo que el resultado es el mismo
 * en todas partes y los documentos ya guardados siguen verificando igual.
 *
 * Sin `crypto.subtle` (por ejemplo, la app abierta por http desde una IP local) no se calcula
 * ninguna huella nueva: antes se usaba un hash de respaldo no criptográfico que quedaba guardado
 * para siempre. Ahora se lanza un error claro. Para verificar se aceptan aún las huellas de respaldo
 * antiguas, que se reconocen por su forma y se marcan como "huella de respaldo, no criptográfica".
 */

export const MENSAJE_SIN_HUELLA_SEGURA =
  'Este navegador no puede calcular la huella segura; abre la app por https.';
export const MENSAJE_NO_VERIFICABLE =
  'No se puede verificar en este navegador: abre la app por https para comprobar la integridad.';

/** Error que indica que el navegador no ofrece SHA-256 (contexto no seguro) */
export class ErrorSinHuellaSegura extends Error {
  constructor() {
    super(MENSAJE_SIN_HUELLA_SEGURA);
    this.name = 'ErrorSinHuellaSegura';
  }
}

export const esErrorSinHuellaSegura = (e: unknown): e is ErrorSinHuellaSegura =>
  e instanceof ErrorSinHuellaSegura || (e as any)?.name === 'ErrorSinHuellaSegura';

export function huellaSeguraDisponible(): boolean {
  return typeof crypto !== 'undefined' && Boolean(crypto.subtle) && typeof crypto.subtle.digest === 'function';
}

const aHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 en hexadecimal de un arreglo de bytes */
export async function sha256Bytes(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  if (!huellaSeguraDisponible()) throw new ErrorSinHuellaSegura();
  return aHex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/** SHA-256 en hexadecimal del texto codificado en UTF-8 */
export async function sha256Texto(texto: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(texto));
}

// ---------- Huellas de respaldo antiguas (solo para verificar) ----------

/** Forma exacta del hash de respaldo antiguo: dos bloques de 18 ceros y 14 cifras hexadecimales */
const FORMA_RESPALDO = /^0{18}[0-9a-f]{14}0{18}[0-9a-f]{14}$/;

export const esHuellaRespaldo = (hash: unknown): boolean => typeof hash === 'string' && FORMA_RESPALDO.test(hash);

/** Algoritmo de respaldo que usaba la app sin crypto.subtle. Se conserva solo para verificar. */
export function hashRespaldoAntiguo(cadena: string): string {
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
 * Huella para comparar con una guardada. Si la guardada tiene la forma del respaldo antiguo se
 * recalcula con ese algoritmo (y se informa); si no, con SHA-256. Sin crypto.subtle y con una
 * huella SHA-256 guardada lanza ErrorSinHuellaSegura: la verificación no es posible y no se debe
 * mostrar un resultado falso.
 */
export async function huellaParaComparar(texto: string, guardada?: string): Promise<{ hash: string; respaldo: boolean }> {
  if (guardada && esHuellaRespaldo(guardada)) {
    const respaldo = hashRespaldoAntiguo(texto);
    if (respaldo === guardada) return { hash: respaldo, respaldo: true };
  }
  return { hash: await sha256Texto(texto), respaldo: false };
}

/** Fragmento del sello que se imprime en el QR de un lote cerrado (16 cifras hexadecimales) */
export const LARGO_SELLO_QR = 16;
export const fragmentoSello = (hash: string | undefined | null): string =>
  (hash || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, LARGO_SELLO_QR);
