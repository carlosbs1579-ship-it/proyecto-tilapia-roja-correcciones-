// SOLO LECTURA en producción: verifica los lotes reales y sus anotaciones con las mismas funciones
// de la vista pública (revisarLote y verificarAnotaciones) y muestra cómo se verán las firmas en lo
// público con la versión nueva (H20). No escribe nada: solo hace GET con la API REST.
// Uso (desde la raíz): empaquetar con esbuild y ejecutar con node (ver tests/integridad/README.md)
import './shim';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { revisarLote, horaServidorRegistro } from '../../src/services/hashService';
import { verificarAnotaciones } from '../../src/services/anotacionesService';
import { quienRegistro } from '../../src/services/usuariosService';
import type { AnotacionesLote, ConfiguracionGeneral, Lote } from '../../src/types';
import { fichaDelLote, revisarSelloLote } from '../../src/services/selloTiempoService';

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
const campos = (d: any) => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, dec(v)]));
const leer = async (c: string) => ((await (await fetch(B + c + '?pageSize=300', { headers: H })).json()).documents || []).map(campos);

const configDoc = await (await fetch(B + 'configuracion/general', { headers: H })).json();
const config = configDoc.fields ? (campos(configDoc) as ConfiguracionGeneral) : undefined;
const anotaciones = new Map<string, AnotacionesLote>((await leer('anotacionesLote')).map((a: any) => [a.codigoLote, a] as [string, AnotacionesLote]));
const lotes = (await leer('lotes')) as Lote[];
console.log(`--- Lotes (${lotes.length})`);
for (const lote of lotes) {
  const anot = anotaciones.get(lote.codigo) || null;
  const va = await verificarAnotaciones(lote, anot);
  const rev = await revisarLote(lote, { config, selloQr: lote.resumen?.hashFinal || null, anotacionesSelloCambiado: va.selloCambiado });
  const firmas = [...new Set((lote.eventos || []).map((e) => quienRegistro(e, true)))].join(', ');
  const horas = (lote.eventos || []).filter((e) => horaServidorRegistro(lote.registradoEnServidor, e.indice, e.registradoEn).servidor).length;
  console.log(
    `${lote.codigo} | ${lote.estado} | ${(lote.eventos || []).length} fases | revisión=${rev.estado} | sello QR=${rev.selloQr} | avisos=${rev.avisos.length}` +
      `${rev.avisos.length ? ' (' + rev.avisos.join(' / ') + ')' : ''} | firmas públicas: ${firmas} | fases con hora del servidor: ${horas}`
  );
  // Testigo externo (H03) y ficha congelada (H41): solo lectura, sin escribir la confirmación
  const rs = await revisarSelloLote(lote);
  const fl = config ? fichaDelLote(lote, config) : null;
  console.log(`   sello de tiempo: ${rs.estado} | ${rs.mensaje}${rs.avisos.length ? ' | ' + rs.avisos.join(' / ') : ''} | ficha: ${fl ? (fl.congelada ? 'congelada al cerrar' : fl.nota || 'vigente') : 'sin configuración'}`);
  if (anot) {
    const firmasAnot = [...new Set(anot.registros.map((r) => quienRegistro(r, true)))].join(', ');
    console.log(`   anotaciones: ${anot.registros.length} registro(s) | íntegra=${va.integra} | ${va.mensaje} | firmas públicas: ${firmasAnot}`);
  }
}
process.exit(0);
