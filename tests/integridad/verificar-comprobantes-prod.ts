// SOLO LECTURA en producción: verifica los comprobantes reales con la misma función del panel
// interno (verificarComprobante con la orden). No escribe nada.
// Uso (desde la raíz): npx tsx tests/integridad/verificar-comprobantes-prod.ts
import './shim';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { revisarConsultaEntrega, verificarComprobante } from '../../src/services/comprobantesService';
import { verificarHistorialOrden } from '../../src/services/pedidosService';
import type { OrdenEntrega } from '../../src/types';
import { revisarSelloBloque } from '../../src/services/selloTiempoService';
import { revisarFechaExif } from '../../src/lib/exif';

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

const ordenes = new Map<string, OrdenEntrega>((await leer('ordenes')).map((o: any) => [o.id, o] as [string, OrdenEntrega]));
const comprobantes = await leer('comprobantes');
console.log('--- Comprobantes (panel interno, con la orden)');
for (const c of comprobantes) {
  const r = await verificarComprobante(c, { orden: ordenes.get(c.ordenId) });
  const rs = await revisarSelloBloque(c);
  console.log(`${c.id} | orden ${c.ordenId} | ${c.tipoBloque || 'comprobante'} | ok=${r.ok} | ${r.mensaje} | sello de tiempo: ${rs.estado}${rs.avisos.length ? ' ' + rs.avisos.join(' / ') : ''}`);
}
console.log('--- Historial de las órdenes (cadena H14)');
for (const o of ordenes.values()) {
  const r = await verificarHistorialOrden(o.historial, o.registradoEnServidor);
  console.log(`${o.id} | ${o.historial.length} eventos | ${r.estado} | ${r.mensaje}`);
}
console.log('--- Consulta pública (?entrega=), con el índice y sus bloques');
for (const q of await leer('consultasEntrega')) {
  const bloques = comprobantes.filter((c: any) => Object.values(q.versiones || {}).some((v: any) => v.comprobanteId === c.id));
  const rev = await revisarConsultaEntrega(q, bloques, []);
  console.log(`${String(q.token).slice(0, 8)}… | orden ${q.ordenId} | ${bloques.length} bloque(s) | avisos=${rev.avisos.length} | vigente=${rev.vigenteId ? 'sí' : 'no'}${rev.avisos.length ? ' | ' + rev.avisos.join(' / ') : ''}${rev.notas.length ? ' | notas: ' + rev.notas.join(' / ') : ''}`);
}
console.log('--- Fotos de entrega (fecha de cámara, H38)');
for (const f of await leer('fotosEntrega')) {
  const o = ordenes.get(f.ordenId);
  const ev = o?.historial.find((e: any) => e.eventoId === f.eventoId);
  const r = revisarFechaExif(f.tomadaEnExif, ev?.fecha || f.tomadaEn);
  console.log(`${String(f.id).slice(0, 14)}… | orden ${f.ordenId} | fecha de cámara: ${r.estado}`);
}
process.exit(0);
