// Calendarios de OpenTimestamps y explorador de Bitcoin simulados (SOLO PRUEBAS): las pruebas no
// dependen de la red. Responden con el mismo formato binario que los calendarios reales (verificado
// a mano contra a.pool.opentimestamps.org, b.pool.opentimestamps.org y a.pool.eternitywall.com):
//   POST /digest           -> append(nonce de 8 bytes), sha256, atestación pendiente con la URL del calendario
//   GET  /timestamp/<hex>  -> sha256, atestación de Bitcoin (altura nueva) o 404 si no se confirma
// y los exploradores (blockstream.info/api y mempool.space/api) devuelven la raíz de Merkle del bloque
// simulado, o fallan o discrepan según CALENDARIO.exploradores.
const ETIQUETA_PENDIENTE = [0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e];
const ETIQUETA_BITCOIN = [0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01];

/** Cómo responde cada explorador simulado: igual que el bloque, caído, con otra raíz o con otra hora */
export type ModoExplorador = 'ok' | 'caido' | 'otra_raiz' | 'otra_hora';

export const CALENDARIO = {
  confirmar: true, // si el calendario entrega la prueba completa
  desfaseBloqueMs: 0, // hora del bloque simulado respecto de ahora
  enviados: 0,
  // Por explorador (blockstream.info, mempool.space); sin entrada responde 'ok'
  exploradores: {} as Record<string, ModoExplorador>
};

// Los dos exploradores usan la misma API: /api/block-height/<altura> y /api/block/<hash>
const EXPLORADORES = ['blockstream.info', 'mempool.space'];

const varuint = (n: number) => {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
};
const varbytes = (b: number[]) => [...varuint(b.length), ...b];
const hex = (b: Uint8Array | number[]) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));

const URI: Record<string, string> = {
  'a.pool.opentimestamps.org': 'https://alice.btc.calendar.opentimestamps.org',
  'b.pool.opentimestamps.org': 'https://bob.btc.calendar.opentimestamps.org',
  'a.pool.eternitywall.com': 'https://finney.calendar.eternitywall.com'
};
const compromisos = new Set<string>();
const bloques = new Map<number, { raiz: string; hora: number }>();
let altura = 900000;

export function instalarCalendariosSimulados() {
  const real = globalThis.fetch;
  globalThis.fetch = (async (entrada: any, init?: any) => {
    const url = new URL(typeof entrada === 'string' ? entrada : entrada.url);
    if (URI[url.host] && url.pathname === '/digest' && init?.method === 'POST') {
      CALENDARIO.enviados++;
      const msg = new Uint8Array(init.body as Uint8Array);
      const nonce = crypto.getRandomValues(new Uint8Array(8));
      const conNonce = new Uint8Array([...msg, ...nonce]);
      compromisos.add(hex(await sha(conNonce)));
      const uri = Array.from(new TextEncoder().encode(URI[url.host]));
      const cuerpo = [0xf0, ...varbytes(Array.from(nonce)), 0x08, 0x00, ...ETIQUETA_PENDIENTE, ...varbytes(varbytes(uri))];
      return new Response(new Uint8Array(cuerpo), { status: 200 });
    }
    if (Object.values(URI).includes(url.origin) && url.pathname.startsWith('/timestamp/')) {
      const c = url.pathname.slice('/timestamp/'.length);
      if (!CALENDARIO.confirmar || !compromisos.has(c)) return new Response('Not found', { status: 404 });
      const raiz = await sha(Uint8Array.from(c.match(/../g)!.map((x) => parseInt(x, 16))));
      const h = altura++;
      bloques.set(h, { raiz: hex(raiz.slice().reverse()), hora: Date.now() + CALENDARIO.desfaseBloqueMs });
      return new Response(new Uint8Array([0x08, 0x00, ...ETIQUETA_BITCOIN, ...varbytes(varuint(h))]), { status: 200 });
    }
    if (EXPLORADORES.includes(url.host)) {
      const modo = CALENDARIO.exploradores[url.host] || 'ok';
      if (modo === 'caido') return new Response('Service Unavailable', { status: 503 });
      let m = /^\/api\/block-height\/(\d+)$/.exec(url.pathname);
      if (m) return bloques.has(+m[1]) ? new Response(Number(m[1]).toString(16).padStart(64, '0')) : new Response('', { status: 404 });
      m = /^\/api\/block\/([0-9a-f]{64})$/.exec(url.pathname);
      if (m) {
        const b = bloques.get(parseInt(m[1], 16));
        if (!b) return new Response('', { status: 404 });
        const raiz = modo === 'otra_raiz' ? 'ff' + b.raiz.slice(2) : b.raiz;
        const hora = Math.floor(b.hora / 1000) + (modo === 'otra_hora' ? 3600 : 0);
        return new Response(JSON.stringify({ merkle_root: raiz, timestamp: hora }), { status: 200 });
      }
      return new Response('', { status: 404 });
    }
    return real(entrada, init);
  }) as typeof fetch;
}
