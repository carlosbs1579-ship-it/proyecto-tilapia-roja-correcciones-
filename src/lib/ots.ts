/**
 * Protocolo mínimo de OpenTimestamps (testigo externo, H03), sin dependencias.
 *
 * Se eligió implementar solo lo necesario en vez de usar la librería `opentimestamps` de npm: esa
 * librería trae bitcore, request y polyfills de Node (cientos de kB) y aquí basta con:
 *  - enviar un digest SHA-256 a los calendarios públicos (POST /digest) y unir sus respuestas;
 *  - guardar la prueba en el formato estándar .ots (verificable en opentimestamps.org o con `ots verify`);
 *  - pedir la prueba completa cuando Bitcoin la confirma (GET /timestamp/<compromiso>);
 *  - comprobar la atestación contra la raíz de Merkle del bloque en un explorador público.
 *
 * Los calendarios responden con Access-Control-Allow-Origin: * a peticiones simples (sin cabeceras
 * propias ni Content-Type), así que el navegador los llama directo, sin función intermedia.
 *
 * Formato (python-opentimestamps): cabecera mágica, versión 1, operación del archivo (0x08 SHA-256),
 * el digest de 32 bytes y el árbol de la prueba. Cada nodo del árbol tiene atestaciones (0x00 +
 * etiqueta de 8 bytes + carga) y operaciones (etiqueta + argumento) seguidas de su subárbol; los
 * elementos que no son el último se anteponen con 0xff.
 */

const MAGICA = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66,
  0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94
]);
const ETIQUETA_PENDIENTE = '83dfe30d2ef90c8e';
const ETIQUETA_BITCOIN = '0588960d73d71901';

const OP_SHA256 = 0x08;
const OP_APPEND = 0xf0;
const OP_PREPEND = 0xf1;
const OP_REVERSE = 0xf2;
const OP_HEXLIFY = 0xf3;
const OPS_BINARIAS = new Set([OP_APPEND, OP_PREPEND]);
const OPS_CONOCIDAS = new Set([OP_SHA256, OP_APPEND, OP_PREPEND, OP_REVERSE, OP_HEXLIFY, 0x02, 0x03, 0x67]);

/** Calendarios públicos a los que se envía el sello (responden con CORS abierto) */
export const CALENDARIOS_ENVIO = [
  'https://a.pool.opentimestamps.org',
  'https://b.pool.opentimestamps.org',
  'https://a.pool.eternitywall.com'
];

/**
 * Calendarios a los que se pide la prueba completa: solo estos (la dirección sale de la prueba
 * guardada, que no debe poder dirigir el navegador a cualquier sitio)
 */
export const CALENDARIOS_CONFIANZA = [
  'https://alice.btc.calendar.opentimestamps.org',
  'https://bob.btc.calendar.opentimestamps.org',
  'https://finney.calendar.eternitywall.com'
];

export const EXPLORADOR_BITCOIN = 'https://blockstream.info/api';

export interface Atestacion {
  tipo: 'pendiente' | 'bitcoin' | 'desconocida';
  uri?: string;
  altura?: number;
  etiqueta: string; // hex de 8 bytes
  carga: Uint8Array;
}

export interface OpOts {
  tag: number;
  arg?: Uint8Array;
}

export interface NodoOts {
  atestaciones: Atestacion[];
  ops: { op: OpOts; hijo: NodoOts }[];
}

export interface ArchivoOts {
  digest: Uint8Array;
  raiz: NodoOts;
}

// ---------- Bytes ----------

export const aHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export function deHex(h: string): Uint8Array {
  const limpio = h.trim().toLowerCase();
  if (!/^([0-9a-f]{2})*$/.test(limpio)) throw new Error('Hexadecimal inválido');
  const out = new Uint8Array(limpio.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(limpio.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function aBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
export function deBase64(t: string): Uint8Array {
  const s = atob(t);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const concatenar = (...partes: Uint8Array[]) => {
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const iguales = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));
}

// ---------- Lectura ----------

class Lector {
  pos = 0;
  constructor(private b: Uint8Array) {}
  byte(): number {
    if (this.pos >= this.b.length) throw new Error('Prueba .ots incompleta');
    return this.b[this.pos++];
  }
  bytes(n: number): Uint8Array {
    if (n < 0 || this.pos + n > this.b.length) throw new Error('Prueba .ots incompleta');
    const r = this.b.slice(this.pos, this.pos + n);
    this.pos += n;
    return r;
  }
  varuint(): number {
    let valor = 0;
    let mult = 1;
    for (let i = 0; i < 9; i++) {
      const b = this.byte();
      valor += (b & 0x7f) * mult;
      if (!(b & 0x80)) return valor;
      mult *= 128;
    }
    throw new Error('Número inválido en la prueba .ots');
  }
  varbytes(max = 8192): Uint8Array {
    const n = this.varuint();
    if (n > max) throw new Error('Dato demasiado largo en la prueba .ots');
    return this.bytes(n);
  }
  fin() {
    return this.pos >= this.b.length;
  }
}

function leerAtestacion(l: Lector): Atestacion {
  const etiqueta = aHex(l.bytes(8));
  const carga = l.varbytes();
  const sub = new Lector(carga);
  if (etiqueta === ETIQUETA_PENDIENTE) {
    const uri = new TextDecoder().decode(sub.varbytes(1000));
    return { tipo: 'pendiente', uri, etiqueta, carga };
  }
  if (etiqueta === ETIQUETA_BITCOIN) return { tipo: 'bitcoin', altura: sub.varuint(), etiqueta, carga };
  return { tipo: 'desconocida', etiqueta, carga };
}

function leerNodo(l: Lector, profundidad = 0): NodoOts {
  if (profundidad > 256) throw new Error('Prueba .ots demasiado profunda');
  const nodo: NodoOts = { atestaciones: [], ops: [] };
  const elemento = (tag: number) => {
    if (tag === 0x00) {
      nodo.atestaciones.push(leerAtestacion(l));
      return;
    }
    if (!OPS_CONOCIDAS.has(tag)) throw new Error(`Operación desconocida en la prueba .ots (0x${tag.toString(16)})`);
    const op: OpOts = OPS_BINARIAS.has(tag) ? { tag, arg: l.varbytes(4096) } : { tag };
    nodo.ops.push({ op, hijo: leerNodo(l, profundidad + 1) });
  };
  let tag = l.byte();
  while (tag === 0xff) {
    elemento(l.byte());
    tag = l.byte();
  }
  elemento(tag);
  return nodo;
}

export function leerOts(bytes: Uint8Array): ArchivoOts {
  const l = new Lector(bytes);
  if (!iguales(l.bytes(MAGICA.length), MAGICA)) throw new Error('No es una prueba OpenTimestamps');
  if (l.varuint() !== 1) throw new Error('Versión de prueba .ots no admitida');
  if (l.byte() !== OP_SHA256) throw new Error('La prueba .ots no es de un digest SHA-256');
  const digest = l.bytes(32);
  const raiz = leerNodo(l);
  if (!l.fin()) throw new Error('La prueba .ots tiene datos de más');
  return { digest, raiz };
}

/** Árbol suelto (respuesta de un calendario), relativo al mensaje enviado */
export function leerArbol(bytes: Uint8Array): NodoOts {
  const l = new Lector(bytes);
  const n = leerNodo(l);
  if (!l.fin()) throw new Error('Respuesta del calendario con datos de más');
  return n;
}

// ---------- Escritura ----------

function varuint(n: number): Uint8Array {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return new Uint8Array(out);
}
const varbytes = (b: Uint8Array) => concatenar(varuint(b.length), b);

function escribirAtestacion(a: Atestacion): Uint8Array {
  return concatenar(new Uint8Array([0x00]), deHex(a.etiqueta), varbytes(a.carga));
}
function escribirOp(op: OpOts): Uint8Array {
  return op.arg ? concatenar(new Uint8Array([op.tag]), varbytes(op.arg)) : new Uint8Array([op.tag]);
}

function escribirNodo(n: NodoOts): Uint8Array {
  const elementos: Uint8Array[] = [
    ...n.atestaciones.map(escribirAtestacion),
    ...n.ops.map(({ op, hijo }) => concatenar(escribirOp(op), escribirNodo(hijo)))
  ];
  if (!elementos.length) throw new Error('Nodo vacío en la prueba .ots');
  const partes: Uint8Array[] = [];
  elementos.forEach((e, i) => partes.push(i < elementos.length - 1 ? concatenar(new Uint8Array([0xff]), e) : e));
  return concatenar(...partes);
}

export function escribirOts(a: ArchivoOts): Uint8Array {
  return concatenar(MAGICA, varuint(1), new Uint8Array([OP_SHA256]), a.digest, escribirNodo(a.raiz));
}

// ---------- Operaciones ----------

const claveOp = (op: OpOts) => `${op.tag}:${op.arg ? aHex(op.arg) : ''}`;
const claveAt = (a: Atestacion) => `${a.etiqueta}:${aHex(a.carga)}`;

async function aplicar(op: OpOts, msg: Uint8Array): Promise<Uint8Array | null> {
  switch (op.tag) {
    case OP_SHA256:
      return sha256(msg);
    case OP_APPEND:
      return concatenar(msg, op.arg!);
    case OP_PREPEND:
      return concatenar(op.arg!, msg);
    case OP_REVERSE:
      return msg.slice().reverse();
    case OP_HEXLIFY:
      return new TextEncoder().encode(aHex(msg));
    default:
      return null; // SHA-1, RIPEMD-160 o Keccak: ramas de otras cadenas, no se recorren
  }
}

/** Une el árbol b dentro del árbol a (mismo mensaje de partida) */
export function unir(a: NodoOts, b: NodoOts): void {
  for (const at of b.atestaciones) if (!a.atestaciones.some((x) => claveAt(x) === claveAt(at))) a.atestaciones.push(at);
  for (const { op, hijo } of b.ops) {
    const igual = a.ops.find((x) => claveOp(x.op) === claveOp(op));
    if (igual) unir(igual.hijo, hijo);
    else a.ops.push({ op, hijo });
  }
}

export interface AtestacionEn {
  nodo: NodoOts;
  mensaje: Uint8Array; // compromiso en ese punto del árbol
  atestacion: Atestacion;
}

/** Recorre el árbol calculando el mensaje de cada nodo y devuelve todas las atestaciones */
export async function atestaciones(raiz: NodoOts, mensaje: Uint8Array): Promise<AtestacionEn[]> {
  const out: AtestacionEn[] = [];
  const pila: { nodo: NodoOts; msg: Uint8Array }[] = [{ nodo: raiz, msg: mensaje }];
  while (pila.length) {
    const { nodo, msg } = pila.pop()!;
    for (const a of nodo.atestaciones) out.push({ nodo, mensaje: msg, atestacion: a });
    for (const { op, hijo } of nodo.ops) {
      const siguiente = await aplicar(op, msg);
      if (siguiente) pila.push({ nodo: hijo, msg: siguiente });
    }
  }
  return out;
}

// ---------- Red ----------

async function conLimite(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  try {
    return await fetch(url, { ...init, ...(ctrl ? { signal: ctrl.signal } : {}) });
  } finally {
    if (t) clearTimeout(t);
  }
}

/**
 * Crea una prueba .ots para un digest SHA-256 (hex). Si se da `compromisoExtra` (hex), la prueba
 * agrega ese dato y vuelve a calcular SHA-256 antes de enviarla: el sello de Bitcoin cubre también
 * ese dato (por ejemplo, la ficha nutricional congelada), sin cambiar el digest del registro.
 * Devuelve null si ningún calendario respondió. Nunca lanza por errores de red.
 */
export async function crearPruebaOts(
  digestHex: string,
  opciones: { compromisoExtra?: string; calendarios?: string[]; limiteMs?: number } = {}
): Promise<{ ots: string; calendarios: number } | null> {
  const digest = deHex(digestHex);
  if (digest.length !== 32) throw new Error('El digest debe ser SHA-256');
  const raiz: NodoOts = { atestaciones: [], ops: [] };
  let punto = raiz;
  let enviado = digest;
  if (opciones.compromisoExtra) {
    const extra = deHex(opciones.compromisoExtra);
    const conExtra: NodoOts = { atestaciones: [], ops: [] };
    const hashNodo: NodoOts = { atestaciones: [], ops: [] };
    raiz.ops.push({ op: { tag: OP_APPEND, arg: extra }, hijo: conExtra });
    conExtra.ops.push({ op: { tag: OP_SHA256 }, hijo: hashNodo });
    punto = hashNodo;
    enviado = await sha256(concatenar(digest, extra));
  }
  const respuestas = await Promise.all(
    (opciones.calendarios || CALENDARIOS_ENVIO).map(async (url) => {
      try {
        // Petición simple (sin Content-Type ni cabeceras propias): no hay verificación previa CORS
        const r = await conLimite(`${url}/digest`, { method: 'POST', body: enviado as BodyInit }, opciones.limiteMs ?? 15000);
        if (!r.ok) return null;
        return leerArbol(new Uint8Array(await r.arrayBuffer()));
      } catch {
        return null;
      }
    })
  );
  const validas = respuestas.filter((r): r is NodoOts => Boolean(r));
  if (!validas.length) return null;
  for (const r of validas) unir(punto, r);
  return { ots: aBase64(escribirOts({ digest, raiz })), calendarios: validas.length };
}

const calendarioDeConfianza = (uri: string | undefined) =>
  Boolean(uri) && CALENDARIOS_CONFIANZA.some((c) => uri === c || uri === c + '/');

/**
 * Pide a los calendarios la parte de la prueba que llega hasta Bitcoin. Devuelve la prueba nueva
 * (base64) si ganó alguna atestación de Bitcoin; null si sigue pendiente o no hubo respuesta.
 */
export async function completarPruebaOts(otsB64: string, limiteMs = 15000): Promise<string | null> {
  const archivo = leerOts(deBase64(otsB64));
  const todas = await atestaciones(archivo.raiz, archivo.digest);
  if (todas.some((a) => a.atestacion.tipo === 'bitcoin')) return null;
  let cambio = false;
  for (const p of todas) {
    if (p.atestacion.tipo !== 'pendiente' || !calendarioDeConfianza(p.atestacion.uri)) continue;
    try {
      const base = p.atestacion.uri!.replace(/\/$/, '');
      const r = await conLimite(`${base}/timestamp/${aHex(p.mensaje)}`, { method: 'GET' }, limiteMs);
      if (!r.ok) continue;
      const arbol = leerArbol(new Uint8Array(await r.arrayBuffer()));
      const nuevas = await atestaciones(arbol, p.mensaje);
      if (!nuevas.some((a) => a.atestacion.tipo === 'bitcoin')) continue;
      unir(p.nodo, arbol);
      cambio = true;
    } catch {
      /* sin respuesta o todavía pendiente (los calendarios responden 404 sin CORS) */
    }
  }
  return cambio ? aBase64(escribirOts(archivo)) : null;
}

export interface BloqueBitcoin {
  altura: number;
  raizMerkle: string; // hex en el orden que muestran los exploradores
  fecha: string; // ISO, hora del bloque
}

const cacheBloques = new Map<number, Promise<BloqueBitcoin | null>>();

/** Cabecera de un bloque de Bitcoin desde un explorador público (null si no responde) */
export function bloqueBitcoin(altura: number, limiteMs = 20000): Promise<BloqueBitcoin | null> {
  if (!cacheBloques.has(altura)) {
    const p = (async () => {
      try {
        const rh = await conLimite(`${EXPLORADOR_BITCOIN}/block-height/${altura}`, { method: 'GET' }, limiteMs);
        if (!rh.ok) return null;
        const hash = (await rh.text()).trim();
        if (!/^[0-9a-f]{64}$/.test(hash)) return null;
        const rb = await conLimite(`${EXPLORADOR_BITCOIN}/block/${hash}`, { method: 'GET' }, limiteMs);
        if (!rb.ok) return null;
        const b = await rb.json();
        if (typeof b?.merkle_root !== 'string' || typeof b?.timestamp !== 'number') return null;
        return { altura, raizMerkle: b.merkle_root.toLowerCase(), fecha: new Date(b.timestamp * 1000).toISOString() };
      } catch {
        return null;
      }
    })();
    cacheBloques.set(altura, p);
    p.then((r) => {
      if (!r) cacheBloques.delete(altura);
    });
  }
  return cacheBloques.get(altura)!;
}

/**
 * Dato extra agregado antes del envío: 33 bytes que empiezan con 0x46 ("F", de ficha) seguidos de
 * un SHA-256. Los calendarios agregan solo 8 o 16 bytes al azar, así que no se confunden.
 */
export const PREFIJO_EXTRA = '46';
const esCompromisoExtra = (b: Uint8Array) => b.length === 33 && b[0] === 0x46;

export interface AnalisisOts {
  digest: string; // digest del registro que cubre la prueba
  compromisoExtra: string | null; // dato agregado antes de enviar (hex), si lo hay
  pendientes: string[]; // calendarios que aún no confirman
  bitcoin: { altura: number; compromiso: string }[]; // compromiso en el orden interno (hex)
}

/** Lee la prueba: qué digest cubre, si agrega un dato antes de enviarse y sus atestaciones */
export async function analizarOts(otsB64: string): Promise<AnalisisOts> {
  const archivo = leerOts(deBase64(otsB64));
  const todas = await atestaciones(archivo.raiz, archivo.digest);
  const primera = archivo.raiz.ops.length === 1 && !archivo.raiz.atestaciones.length ? archivo.raiz.ops[0] : null;
  const extra =
    primera && primera.op.tag === OP_APPEND && primera.op.arg && esCompromisoExtra(primera.op.arg) && primera.hijo.ops.length === 1 && primera.hijo.ops[0].op.tag === OP_SHA256
      ? aHex(primera.op.arg)
      : null;
  return {
    digest: aHex(archivo.digest),
    compromisoExtra: extra,
    pendientes: todas.filter((a) => a.atestacion.tipo === 'pendiente').map((a) => a.atestacion.uri || ''),
    bitcoin: todas
      .filter((a) => a.atestacion.tipo === 'bitcoin')
      .map((a) => ({ altura: a.atestacion.altura!, compromiso: aHex(a.mensaje) }))
      .sort((x, y) => x.altura - y.altura)
  };
}

/** El compromiso de la prueba coincide con la raíz de Merkle del bloque (orden de bytes invertido) */
export const compromisoEnBloque = (compromiso: string, bloque: BloqueBitcoin) =>
  aHex(deHex(compromiso).reverse()) === bloque.raizMerkle;
