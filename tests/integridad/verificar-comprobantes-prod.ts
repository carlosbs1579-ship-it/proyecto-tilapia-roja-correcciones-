// SOLO LECTURA en producción: verifica los comprobantes reales con la misma función del panel
// interno (verificarComprobante con la orden). No escribe nada.
// Uso (desde la raíz): npx tsx tests/integridad/verificar-comprobantes-prod.ts
import './shim';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { verificarComprobante } from '../../src/services/comprobantesService';

const cfg = JSON.parse(readFileSync(join(homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
const tok = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.tokens.refresh_token,
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com', client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi' })
})).json();
const H = { authorization: `Bearer ${tok.access_token}` };
const B = 'https://firestore.googleapis.com/v1/projects/iron-outpost-cw2pc/databases/ai-studio-33039dd2-b725-497c-80b6-eb6761337ba9/documents/';
const dec = (v: any): any => v == null ? undefined : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null
  : 'timestampValue' in v ? { toDate: () => new Date(v.timestampValue), toMillis: () => Date.parse(v.timestampValue) }
  : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec)
  : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)])) : v;
const leer = async (c: string) => ((await (await fetch(B + c + '?pageSize=300', { headers: H })).json()).documents || [])
  .map((d: any) => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, dec(v)])));

const ordenes = new Map((await leer('ordenes')).map((o: any) => [o.id, o]));
for (const c of await leer('comprobantes')) {
  const r = await verificarComprobante(c, { orden: ordenes.get(c.ordenId) });
  console.log(`${c.id} | orden ${c.ordenId} | ${c.tipoBloque || 'comprobante'} | ok=${r.ok} | ${r.mensaje}`);
}
process.exit(0);
