// Pruebas de alteración en PRODUCCIÓN, solo sobre un lote de prueba.
// Simula ediciones desde la consola de Firebase (credenciales de administración de firebase-tools).
// Se niega a tocar un lote cuyo proveedor no sea "PRUEBA-auditoria".
// Uso: node produccion-prueba.mjs <codigoLote> <respaldar|marcar|cabecera|fase|borrar-ultima|restaurar|eliminar|ver>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [codigo, accion] = process.argv.slice(2);
if (!codigo || !accion) throw new Error('Uso: node produccion-prueba.mjs <codigoLote> <accion>');
const AQUI = dirname(fileURLToPath(import.meta.url));
const RESPALDO = join(AQUI, `.respaldo-${codigo}.json`);

const cfg = JSON.parse(readFileSync(join(homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
const { access_token } = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.tokens.refresh_token,
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com', client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi' })
})).json();
const H = { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' };
const DOCS = 'https://firestore.googleapis.com/v1/projects/iron-outpost-cw2pc/databases/ai-studio-33039dd2-b725-497c-80b6-eb6761337ba9/documents';
const URL_LOTE = `${DOCS}/lotes/${encodeURIComponent(codigo)}`;

async function leer() {
  const r = await fetch(URL_LOTE, { headers: H });
  if (!r.ok) throw new Error('No se pudo leer: ' + (await r.text()));
  return r.json();
}
async function escribir(campos, mascara) {
  const q = mascara.map((m) => 'updateMask.fieldPaths=' + encodeURIComponent(m)).join('&');
  const r = await fetch(`${URL_LOTE}?${q}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: campos }) });
  if (!r.ok) throw new Error('No se pudo escribir: ' + (await r.text()));
}

const doc = accion === 'eliminar' && !existsSync(RESPALDO) ? null : await leer();
const f = doc?.fields || JSON.parse(readFileSync(RESPALDO, 'utf8')).fields;
if (f.proveedorAlevinos?.stringValue !== 'PRUEBA-auditoria') {
  throw new Error(`SEGURIDAD: el lote ${codigo} no es de prueba (proveedor: ${f.proveedorAlevinos?.stringValue}). No se toca.`);
}

const eventos = () => JSON.parse(JSON.stringify(f.eventos));
switch (accion) {
  case 'respaldar':
    writeFileSync(RESPALDO, JSON.stringify(doc, null, 2));
    console.log('respaldo guardado en', RESPALDO);
    break;
  case 'marcar':
    await escribir({ esPrueba: { booleanValue: true } }, ['esPrueba']);
    console.log('esPrueba: true');
    break;
  case 'cabecera': {
    // Ataque 7: cambiar piscina y supervivencia mostradas al público
    const resumen = JSON.parse(JSON.stringify(f.resumen));
    resumen.mapValue.fields.supervivencia = { doubleValue: 99.9 };
    await escribir({ estanque: { stringValue: 'E2' }, resumen }, ['estanque', 'resumen']);
    console.log('cabecera alterada: estanque E2, supervivencia 99.9');
    break;
  }
  case 'fase': {
    // Ataque 4: cambiar un dato de la fase 1 (mortalidad 50 a 5)
    const ev = eventos();
    ev.arrayValue.values[1].mapValue.fields.datos.mapValue.fields.cantidad = { integerValue: '5' };
    await escribir({ eventos: ev }, ['eventos']);
    console.log('fase 1 alterada: cantidad 5');
    break;
  }
  case 'borrar-ultima': {
    // Ataque 8: quitar la última fase sin tocar el sello
    const ev = eventos();
    ev.arrayValue.values = ev.arrayValue.values.slice(0, -1);
    await escribir({ eventos: ev }, ['eventos']);
    console.log('última fase borrada');
    break;
  }
  case 'restaurar': {
    const orig = JSON.parse(readFileSync(RESPALDO, 'utf8')).fields;
    const campos = { estanque: orig.estanque, resumen: orig.resumen, eventos: orig.eventos };
    await escribir(campos, Object.keys(campos));
    console.log('restaurado desde el respaldo');
    break;
  }
  case 'eliminar': {
    const r = await fetch(URL_LOTE, { method: 'DELETE', headers: H });
    if (!r.ok) throw new Error('No se pudo eliminar: ' + (await r.text()));
    console.log('lote de prueba eliminado');
    break;
  }
  case 'ver':
    console.log(JSON.stringify({ estanque: f.estanque, esPrueba: f.esPrueba, eventos: f.eventos.arrayValue.values.length, sello: f.resumen?.mapValue?.fields?.hashFinal }, null, 1));
    break;
  default:
    throw new Error('Acción desconocida');
}
