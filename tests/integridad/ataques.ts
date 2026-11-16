// SOLO EMULADOR (Firestore 8185, Auth 9199). Pruebas de alteración de la auditoría (agente 2).
// 1) Crea datos de prueba de forma válida, con los servicios reales de la app y pasando por las
//    reglas (lote PRUEBA-..., fases, cierre, orden con entrega y foto, comprobante, anotación).
// 2) Simula ataques con el token "Bearer owner" (equivale a la consola de Firebase, sin reglas).
// 3) Después de cada ataque evalúa con el código real de verificación lo que mostraría cada pantalla
//    y restaura el estado original.
// 4) Repite alteraciones como usuarios normales (con reglas) y prueba ?lote= y ?entrega= raros.
// Resultado: tests/integridad/resultados.json y resultados.md
import './shim';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, auth, PROYECTO, BASE, PUERTO_FIRESTORE, PUERTO_AUTH } from './firebase-emulador';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, query, setDoc, updateDoc, where } from 'firebase/firestore';
import {
  HASH_GENESIS,
  analizarCadenaLote,
  calcularHashEvento,
  calcularSha256,
  huellasFase,
  revisarLote,
  verificarIntegridadLote
} from '../../src/services/hashService';
import { recalcularResumenLote } from '../../src/services/calculosService';
import { cerrarLote, crearNuevoLote, registrarEventoEnLote } from '../../src/services/lotesService';
import { crearCliente, crearOrden, establecerFuncionActiva, hashEventoOrden, anclaHistorial, verificarHistorialOrden } from '../../src/services/pedidosService';
import { leerBandeja, registrarAccion } from '../../src/services/repartoService';
import {
  anularComprobante,
  calcularHashComprobante,
  emitirComprobanteDefinitivo,
  leerConsultaEntrega,
  revisarConsultaEntrega,
  revisarSellosLotes,
  separarBloques,
  verificarCadena,
  verificarComprobante
} from '../../src/services/comprobantesService';
import { anotacionesDe, hashRegistroAnotacion, proponerAnotacion, resolverAnotacion, verificarAnotaciones } from '../../src/services/anotacionesService';
import { revisarFoto, verificarFoto } from '../../src/services/fotosService';
import { CONFIG_DEFAULT, ORIGEN_FIJO, PRODUCTO_FIJO } from '../../src/utils/constants';
import { fragmentoSello } from '../../src/lib/integridad';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const RAIZ = `http://127.0.0.1:${PUERTO_FIRESTORE}/v1/projects/${PROYECTO}/databases/${BASE}/documents`;
const AUTH = `http://127.0.0.1:${PUERTO_AUTH}`;
const CLAVE = 'prueba123';
const GRANJA = 'cultivos-lore';
const sello = Date.now().toString(36).toUpperCase();
// Los lotes se crean con crearNuevoLote (código real AAAAMMDD-LETRA-ESTANQUE, contadores y reglas)
let COD = '';
let COD2 = '';

// ---------- Conversión Firestore REST <-> JS ----------
const aFs = (v: any): any =>
  v === null || v === undefined
    ? { nullValue: null }
    : typeof v === 'boolean'
      ? { booleanValue: v }
      : typeof v === 'number'
        ? Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
        : typeof v === 'string'
          ? { stringValue: v }
          : Array.isArray(v)
            ? { arrayValue: { values: v.map(aFs) } }
            : v.__ts
              ? { timestampValue: v.__ts }
              : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, aFs(x)])) } };
const deFs = (v: any): any => {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return { __ts: v.timestampValue };
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(deFs);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, deFs(x)]));
  throw new Error('tipo no soportado ' + JSON.stringify(v));
};

async function leerCrudo(ruta: string): Promise<any | null> {
  const r = await fetch(`${RAIZ}/${ruta}`, { headers: OWNER });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${ruta}: ${r.status} ${await r.text()}`);
  return (await r.json()).fields || {};
}
async function escribirCrudo(ruta: string, fields: any): Promise<void> {
  const r = await fetch(`${RAIZ}/${ruta}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(`${ruta}: ${r.status} ${await r.text()}`);
}
async function borrarCrudo(ruta: string): Promise<void> {
  const r = await fetch(`${RAIZ}/${ruta}`, { method: 'DELETE', headers: OWNER });
  if (!r.ok) throw new Error(`${ruta}: ${r.status} ${await r.text()}`);
}
const leerJs = async (ruta: string) => {
  const c = await leerCrudo(ruta);
  return c ? deFs({ mapValue: { fields: c } }) : null;
};
const escribirJs = (ruta: string, obj: any) => escribirCrudo(ruta, aFs(obj).mapValue.fields);
async function restaurar(ruta: string, crudo: any | null) {
  if (crudo) await escribirCrudo(ruta, crudo);
  else if (await leerCrudo(ruta)) await borrarCrudo(ruta);
}

// ---------- Cuentas ----------
const SIN = { crearLotes: false, registrarEventos: false, cerrarLotes: false, gestionarEstanques: false, gestionarConfiguracion: false, administrarUsuarios: false, gestionarPedidos: false };
const CUENTAS: Record<string, { roles: string[]; permisos: Record<string, boolean>; nombre: string }> = {
  'operador-prueba@prueba.co': { roles: ['operator'], permisos: { ...SIN, crearLotes: true, registrarEventos: true, cerrarLotes: true }, nombre: 'Operador PRUEBA' },
  'vendedor-prueba@prueba.co': { roles: ['operator'], permisos: { ...SIN, gestionarPedidos: true, gestionarComprobantes: true }, nombre: 'Vendedor PRUEBA' },
  'repartidor-prueba@prueba.co': { roles: ['courier'], permisos: SIN, nombre: 'Repartidor PRUEBA' },
  'anota-a@prueba.co': { roles: ['operator'], permisos: { ...SIN, proponerAnotaciones: true, aprobarAnotaciones: true }, nombre: 'Anota A' },
  'anota-b@prueba.co': { roles: ['operator'], permisos: { ...SIN, aprobarAnotaciones: true }, nombre: 'Anota B' },
  'intruso@prueba.co': { roles: ['operator'], permisos: SIN, nombre: 'Intruso PRUEBA' }
};
const UID: Record<string, string> = {};

async function crearCuentas() {
  for (const [email, c] of Object.entries(CUENTAS)) {
    let j = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: CLAVE, returnSecureToken: true })
    })).json();
    if (!j.localId) {
      j = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: CLAVE, returnSecureToken: true })
      })).json();
    }
    if (!j.localId) throw new Error(`${email}: ${JSON.stringify(j)}`);
    UID[email] = j.localId;
    await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROYECTO}/accounts:update`, {
      method: 'POST', headers: OWNER, body: JSON.stringify({ localId: j.localId, emailVerified: true })
    });
    await escribirJs(`usuarios/${j.localId}`, {
      uid: j.localId, email, displayName: c.nombre, granjaId: GRANJA, estado: 'activo', rol: 'operario', roles: c.roles,
      cargos: Object.fromEntries(c.roles.map((r) => [r, 'PRUEBA'])), cargo: 'PRUEBA', permisos: c.permisos,
      creadoEn: '2026-11-15T00:00:00.000Z', actualizadoEn: '2026-11-15T00:00:00.000Z', esPrueba: true
    });
  }
}
async function entrar(email: string, funcion: 'operator' | 'courier' | null = 'operator') {
  await signInWithEmailAndPassword(auth, email, CLAVE);
  establecerFuncionActiva(funcion);
}

// ---------- Creación válida de los datos de prueba ----------
const OPER = 'operador-prueba@prueba.co', VEND = 'vendedor-prueba@prueba.co', REP = 'repartidor-prueba@prueba.co';
// Dos "fotos" JPEG distintas en base64 (el contenido real de la imagen no afecta al hash del texto)
const JPEG_A = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////8AAAsIAAEAAQEBEQD/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKp//9k=';
const JPEG_B = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function crearLoteActivo(estanque: 'E1' | 'E2', email: string): Promise<string> {
  // Servicio real de la app: transacción con contadores, evento de Siembra y resumen (reglas activas)
  const lote = await crearNuevoLote({
    estanque, fechaSiembra: '2026-08-01', cantidadSembrada: 1000, pesoInicialPromedioG: 5, proveedorAlevinos: 'Proveedor PRUEBA',
    observaciones: '', userEmail: email, config: CONFIG_DEFAULT
  });
  return lote.codigo;
}

const FASES: [string, Record<string, any>][] = [
  ['Calidad del agua', { temperatura: 28, oxigenoDisuelto: 5.5, ph: 7.2, amonioTotal: 0.2, nitritos: 0.05, transparenciaSecchi: 35 }],
  ['Alimentación', { cantidadKg: 120, tipoAlimento: 'Engorde 32%', pctProteina: 32, numeroRaciones: 3 }],
  ['Muestreo de crecimiento (biometría)', { pesoPromedioG: 350, pecesMuestreados: 30 }],
  ['Mortalidad', { cantidad: 20, causa: 'Manejo' }],
  ['Cosecha', { pecesCosechados: 900, biomasaCosechadaKg: 432, pesoPromedioG: 480 }]
];

async function esperarAccion(uid: string, id: string) {
  for (let i = 0; i < 150; i++) {
    const a = leerBandeja(uid).find((x) => x.id === id);
    if (a && (a.estado === 'recibida' || a.estado === 'confirmada')) return;
    if (a && a.estado === 'conflicto') throw new Error(`Acción ${a.tipo} rechazada: ${a.mensaje}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('La acción no se envió a tiempo');
}

// selloQr: el sello que se imprimió en la etiqueta QR al cerrar el lote (?s=); es el ancla externa
const ctx: { ordenId: string; fotoId: string; comprobanteId: string; token: string; selloQr: string } = { ordenId: '', fotoId: '', comprobanteId: '', token: '', selloQr: '' };

async function sembrarDatos() {
  await crearCuentas();
  // Lote: creación, cinco fases y cierre, como operador (reglas activas)
  await entrar(OPER);
  COD = await crearLoteActivo('E1', OPER);
  for (const [i, [tipo, datos]] of FASES.entries()) {
    await registrarEventoEnLote({ codigoLote: COD, tipo: tipo as any, fechaEvento: `2026-0${8 + Math.floor(i / 3)}-1${i}`, descripcion: `PRUEBA ${tipo}`, datos, userEmail: OPER, config: CONFIG_DEFAULT });
  }
  await cerrarLote(COD, OPER, CONFIG_DEFAULT);
  ctx.selloQr = fragmentoSello(((await getDocFromServer(doc(db, 'lotes', COD))).data() as any).resumen.hashFinal);

  // Anotación propuesta por A y aprobada por B, antes de la orden: así el comprobante registra el
  // sello del lote y la cantidad y el último hash de sus anotaciones (H18, ancla parcial de A2)
  await entrar('anota-a@prueba.co');
  let lote = (await getDocFromServer(doc(db, 'lotes', COD))).data() as any;
  await proponerAnotacion(lote, { fase: 2, dato: 'cantidadKg', valorRegistrado: '120', valorCorrecto: '125', motivo: 'PRUEBA: error de digitación en el alimento' });
  await entrar('anota-b@prueba.co');
  lote = (await getDocFromServer(doc(db, 'lotes', COD))).data() as any;
  await resolverAnotacion(lote, 0, true, 'Aprobada PRUEBA');

  // Orden confirmada con reserva, como vendedor
  await entrar(VEND);
  const cli = await crearCliente('PRUEBA-Restaurante Integridad', '3000000000', 'Calle PRUEBA 1');
  const orden = await crearOrden({
    clienteId: cli.id, clienteNombre: cli.nombre, clienteDireccion: cli.direccion || '', clienteContacto: cli.contacto || '', unidad: 'kg',
    cantidadSolicitada: 50, fechaProgramada: '2026-11-16', cantidades: { [COD]: 50 },
    repartidor: { uid: UID[REP], nombre: 'Repartidor PRUEBA', cargo: 'PRUEBA' }, observaciones: 'PRUEBA'
  }, true);
  ctx.ordenId = orden.id;

  // Reparto con foto, como repartidor (bandeja local + transacción real)
  await entrar(REP, 'courier');
  const uidRep = UID[REP];
  let a = registrarAccion(uidRep, { ordenId: orden.id, tipo: 'Inicio de ruta' });
  await esperarAccion(uidRep, a.id);
  a = registrarAccion(uidRep, { ordenId: orden.id, tipo: 'Llegada' });
  await esperarAccion(uidRep, a.id);
  const foto = { id: 'foto-' + crypto.randomUUID(), hash: await calcularSha256(JPEG_A), datos: JPEG_A, ancho: 1, alto: 1, bytes: 120, tomadaEn: new Date().toISOString() };
  a = registrarAccion(uidRep, { ordenId: orden.id, tipo: 'Entrega', descripcion: 'PRUEBA entrega', datos: { entregas: { [COD]: 50 } }, foto });
  await esperarAccion(uidRep, a.id);
  ctx.fotoId = foto.id;

  // Comprobante definitivo, como vendedor
  await entrar(VEND);
  const comp = await emitirComprobanteDefinitivo(orden.id);
  ctx.comprobanteId = comp.id;
  ctx.token = comp.tokenConsulta;
  if (!comp.sellosLotes?.[COD] || !comp.anotacionesLotes?.[COD]) throw new Error('El comprobante no registró el sello del lote o sus anotaciones');

  // Marca esPrueba donde no altera ningún hash (los comprobantes no: su hash cubre todos los campos,
  // y las reglas de ordenes/fotos/consultas usan hasOnly, por eso se marca con el token de consola)
  // No se marcan ordenes ni consultasEntrega: la app las reescribe completas (anulación) y las reglas
  // usan hasOnly, de modo que un campo extra bloquearía operaciones legítimas
  for (const ruta of [`lotes/${COD}`, `fotosEntrega/${ctx.fotoId}`, `anotacionesLote/${COD}`, `clientes/${cli.id}`]) {
    const r = await fetch(`${RAIZ}/${ruta}?updateMask.fieldPaths=esPrueba`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: { esPrueba: { booleanValue: true } } }) });
    if (!r.ok) throw new Error(ruta + (await r.text()));
  }
}

// ---------- Evaluación con el código real de verificación ----------
interface Senales {
  automaticas: string[]; // avisos que la pantalla muestra sola al abrirse
  manuales: string[]; // fallas que solo aparecen al pulsar un botón de verificar
  datos: Record<string, any>; // lo que verá el público
}

async function evaluar(): Promise<Senales> {
  const s: Senales = { automaticas: [], manuales: [], datos: {} };
  await entrar(VEND);
  // Lote: PublicTraceabilityView (público), LoteDetailModal / IntegrityCheckModal (interno)
  const loteSnap = await getDocFromServer(doc(db, 'lotes', COD));
  const lote = loteSnap.exists() ? (loteSnap.data() as any) : null;
  if (lote) {
    const anotSnap = await getDocFromServer(doc(db, 'anotacionesLote', COD));
    const anot = anotSnap.exists() ? (anotSnap.data() as any) : null;
    const va = await verificarAnotaciones(lote, anot);
    // Revisión automática de PublicTraceabilityView y LoteDetailModal (misma función): sin sello en el
    // QR (etiquetas antiguas) y con el sello impreso al cerrar (?s=)
    const sinSello = await revisarLote(lote, { config: CONFIG_DEFAULT, anotacionesSelloCambiado: va.selloCambiado });
    const conSello = await revisarLote(lote, { config: CONFIG_DEFAULT, selloQr: ctx.selloQr, anotacionesSelloCambiado: va.selloCambiado });
    if (sinSello.estado !== 'integro') s.automaticas.push(`QR lote y detalle: ${sinSello.avisos.join(' | ')}`);
    else if (conSello.estado !== 'integro') s.automaticas.push(`Solo QR con sello impreso: ${conSello.avisos.join(' | ')}`);
    s.datos.qrAntiguoSinSello = sinSello.estado === 'integro' ? 'sin aviso' : 'avisado';
    const ver = await verificarIntegridadLote(lote);
    if (!ver.valido) s.manuales.push(`Botón "Verificar integridad" / IntegrityCheckModal: ${ver.mensaje}`);
    const aprobadas = anotacionesDe(anot).filter((a) => a.estado === 'aprobada' && !va.alteradas.includes(a.numero));
    const sinValidez = anotacionesDe(anot).filter((a) => va.alteradas.includes(a.numero));
    if (!va.integra && (aprobadas.length || sinValidez.length)) s.automaticas.push(`QR lote, sección anotaciones: ${va.mensaje}`);
    // Lo que ve el público: cabecera y resumen derivados de la cadena (no los campos guardados)
    s.datos.lote = {
      estanque: conSello.cabecera.estanque, fechaSiembra: conSello.cabecera.fechaSiembra, fechaCierre: lote.fechaCierre, producto: conSello.cabecera.producto.slice(0, 26),
      cantidadSembrada: conSello.cabecera.cantidadSembrada, supervivencia: conSello.resumen.supervivencia, pesoPromedioActualG: conSello.resumen.pesoPromedioActualG,
      biomasaEstimadaKg: conSello.resumen.biomasaEstimadaKg, fases: (lote.eventos || []).length,
      alimentoFase2: lote.eventos?.[2]?.datos?.cantidadKg, anotacionesValidas: aprobadas.length, qrAntiguoSinSello: s.datos.qrAntiguoSinSello
    };
  } else s.automaticas.push('QR lote: "Lote no disponible"');

  // Orden y foto: FotosEntregaOrden (interno; verificar es un botón)
  const orden = (await getDocFromServer(doc(db, 'ordenes', ctx.ordenId))).data() as any;
  const evEntrega = orden.historial.find((e: any) => e.tipo === 'Entrega' && e.datos?.foto?.id);
  const ref = evEntrega?.datos.foto;
  const fotoSnap = await getDocFromServer(doc(db, 'fotosEntrega', ref.id)).catch(() => null);
  const bloquesOrden = (await getDocsFromServer(query(collection(db, 'comprobantes'), where('granjaId', '==', GRANJA), where('ordenId', '==', ctx.ordenId)))).docs.map((d) => d.data() as any);
  const fotoHashComp = bloquesOrden.filter((b) => b.tipoBloque !== 'anulacion').flatMap((b) => b.entregas || []).find((e: any) => e.eventoId === evEntrega.eventoId)?.fotoHash;
  const f = fotoSnap?.exists() ? (fotoSnap.data() as any) : undefined;
  // FotosEntregaOrden verifica cada foto sola al mostrarse
  const rf = await revisarFoto(f, ref, { fecha: evEntrega.fecha, eventoId: evEntrega.eventoId, ordenId: ctx.ordenId }, fotoHashComp);
  if (rf.estado === 'alterada' || rf.estado === 'borrada') s.automaticas.push(`Fotos de la orden: ${rf.mensaje}`);
  if (f && !(await verificarFoto(f, ref.hash))) s.manuales.push('Botón "Verificar foto" (anterior): "La foto no coincide con el hash registrado."');
  s.datos.foto = f
    ? { mostrada: f.datos.slice(0, 40) + '…', hashDoc: f.hash.slice(0, 12), hashEvento: ref.hash.slice(0, 12), estado: rf.estado }
    : { mostrada: rf.mensaje, estado: rf.estado };

  // Comprobante: ConsultaEntregaPublica (verificación automática) y DocumentacionEntrega (interno)
  const r = await leerConsultaEntrega(ctx.token).catch(() => null);
  if (!r) s.automaticas.push('QR entrega: "No se encontró ninguna entrega con este código."');
  else {
    // ConsultaEntregaPublica: revisión automática de la cadena pública completa
    const rev = await revisarConsultaEntrega(r.consulta, r.bloques, r.faltantes);
    if (!r.bloques.length) s.automaticas.push(`QR entrega: "Falta el comprobante registrado" (${rev.avisos.join(' | ')})`);
    else if (rev.avisos.length) s.automaticas.push(`QR entrega: ${rev.avisos.join(' | ')}`);
    const { comprobantes } = separarBloques(r.bloques);
    const vigente = comprobantes.find((c) => c.id === rev.vigenteId);
    const actual = vigente || comprobantes.find((c) => !rev.anulados.has(c.id)) || comprobantes[0];
    s.datos.entregaPublica = actual
      ? { cantidadEntregada: actual.cantidadEntregada, cliente: actual.cliente.nombre, vigente: vigente ? `N.º ${vigente.version}` : rev.avisos.length ? 'ninguno (la cadena tiene problemas)' : 'ninguno (todos anulados)', versionesIndice: Object.keys(r.consulta.versiones).length, bloquesLeidos: r.bloques.length }
      : null;
  }
  const bloques = bloquesOrden;
  const esperados = orden.historial.filter((e: any) => e.tipo === 'Comprobante emitido' || e.tipo === 'Comprobante anulado').length;
  if (bloques.length < esperados) s.automaticas.push(`Panel interno de la orden: "Cadena incompleta: el historial registra ${esperados}, existen ${bloques.length}"`);
  else if (!verificarCadena(bloques).integra) s.automaticas.push(`Panel interno de la orden: ${verificarCadena(bloques).mensaje}`);
  // DocumentacionEntrega verifica cada comprobante solo al abrir la orden (con la orden completa) y
  // compara el sello de los lotes y sus anotaciones registrados al emitir con los actuales
  for (const c of separarBloques(bloques).comprobantes) {
    const v = await verificarComprobante(c, { orden });
    if (!v.ok) s.automaticas.push(`Panel interno de la orden, comprobante N.º ${c.version}: ${v.mensaje}`);
    const rs = await revisarSellosLotes(c);
    if (rs.avisos.length) s.automaticas.push(`Panel interno de la orden, comprobante N.º ${c.version}: ${rs.avisos.join(' ')}`);
  }
  // DetalleOrdenOperador verifica la cadena del historial al abrir la orden (H14)
  const vh = await verificarHistorialOrden(orden.historial, orden.registradoEnServidor);
  if (vh.estado === 'alterado') s.automaticas.push(`Panel interno de la orden, historial: ${vh.mensaje}`);
  s.datos.historialOrden = vh.estado;
  return s;
}

function clasificar(s: Senales): string {
  if (s.automaticas.length) return 'detectado y avisado';
  if (s.manuales.length) return 'detectado sin aviso';
  return 'NO DETECTADO';
}

// ---------- Ataques (consola de Firebase: token owner, sin reglas) ----------
async function recalcularCadenaLote(codigo: string, eventos: any[]) {
  let prev = HASH_GENESIS;
  for (const ev of eventos) {
    ev.hashAnterior = prev;
    ev.hash = await calcularHashEvento({ codigoLote: codigo, ...ev });
    if (ev.huellas) ev.huellas = await huellasFase(ev);
    prev = ev.hash;
  }
  return prev;
}
// Recalcula también el resumen guardado (como haría quien conoce la app y tiene la consola)
function recalcularResumenGuardado(l: any) {
  l.resumen = recalcularResumenLote({
    fechaSiembra: l.fechaSiembra, cantidadSembrada: l.cantidadSembrada, pesoInicialPromedioG: l.pesoInicialPromedioG, eventos: l.eventos,
    estado: 'cerrado', fechaCierre: l.fechaCierre, volumenEstanqueM3: 250, rangos: CONFIG_DEFAULT.rangosReferencia
  } as any);
}
async function recalcularAnotaciones(codigo: string, d: any, ancla: string) {
  d.hashAnclaje = ancla;
  let prev = ancla;
  for (const r of d.registros) {
    r.hashAnterior = prev;
    const { hash, ...resto } = r;
    r.hash = await hashRegistroAnotacion(codigo, resto);
    prev = r.hash;
  }
}
async function alterarJs(ruta: string, f: (o: any) => any | Promise<any>) {
  const o = await leerJs(ruta);
  await f(o);
  await escribirJs(ruta, o);
}

interface Ataque { id: string; nombre: string; rutas: () => string[]; ejecutar: () => Promise<void> }
const rFoto = () => `fotosEntrega/${ctx.fotoId}`;
const rLote = () => `lotes/${COD}`;
const rAnot = () => `anotacionesLote/${COD}`;
const rComp = () => `comprobantes/${ctx.comprobanteId}`;
const rCons = () => `consultasEntrega/${ctx.token}`;
const rOrden = () => `ordenes/${ctx.ordenId}`;

const ATAQUES: Ataque[] = [
  { id: '1', nombre: 'Reemplazar la foto de entrega (campo datos) por otra imagen', rutas: () => [rFoto()],
    ejecutar: () => alterarJs(rFoto(), (f) => { f.datos = JPEG_B; }) },
  { id: '2', nombre: 'Cambiar un carácter del base64 de la foto', rutas: () => [rFoto()],
    ejecutar: () => alterarJs(rFoto(), (f) => { const i = f.datos.length - 10; f.datos = f.datos.slice(0, i) + (f.datos[i] === 'A' ? 'B' : 'A') + f.datos.slice(i + 1); }) },
  { id: '3', nombre: 'Cambiar datos y hash de la foto a la vez (sin tocar el evento de la orden)', rutas: () => [rFoto()],
    ejecutar: () => alterarJs(rFoto(), async (f) => { f.datos = JPEG_B; f.hash = await calcularSha256(JPEG_B); }) },
  { id: '3b', nombre: 'Cambiar datos y hash de la foto y también el hash en el evento "Entrega" de la orden', rutas: () => [rFoto(), rOrden()],
    ejecutar: async () => {
      const h = await calcularSha256(JPEG_B);
      await alterarJs(rFoto(), (f) => { f.datos = JPEG_B; f.hash = h; });
      await alterarJs(rOrden(), (o) => { o.historial.find((e: any) => e.tipo === 'Entrega').datos.foto.hash = h; });
    } },
  { id: '4', nombre: 'Alterar un dato de una fase intermedia (Alimentación: 120 kg -> 80 kg)', rutas: () => [rLote()],
    ejecutar: () => alterarJs(rLote(), (l) => { l.eventos[2].datos.cantidadKg = 80; }) },
  { id: '5', nombre: 'Alterar el hash guardado de un evento intermedio (fase #2)', rutas: () => [rLote()],
    ejecutar: () => alterarJs(rLote(), (l) => { l.eventos[2].hash = 'f'.repeat(64); }) },
  { id: '6', nombre: 'Alterar la fase #2 y recalcular toda la cadena, huellas y resumen.hashFinal', rutas: () => [rLote()],
    ejecutar: () => alterarJs(rLote(), async (l) => { l.eventos[2].datos.cantidadKg = 80; l.resumen.hashFinal = await recalcularCadenaLote(COD, l.eventos); }) },
  { id: '6b', nombre: 'Igual que 6 y además recalcular la cadena de anotaciones (nueva ancla)', rutas: () => [rLote(), rAnot()],
    ejecutar: async () => {
      let ancla = '';
      await alterarJs(rLote(), async (l) => { l.eventos[2].datos.cantidadKg = 80; ancla = l.resumen.hashFinal = await recalcularCadenaLote(COD, l.eventos); });
      await alterarJs(rAnot(), (d) => recalcularAnotaciones(COD, d, ancla));
    } },
  { id: '6c', nombre: 'Igual que 6 y borrar el documento de anotaciones', rutas: () => [rLote(), rAnot()],
    ejecutar: async () => {
      await alterarJs(rLote(), async (l) => { l.eventos[2].datos.cantidadKg = 80; l.resumen.hashFinal = await recalcularCadenaLote(COD, l.eventos); });
      await borrarCrudo(rAnot());
    } },
  { id: '6d', nombre: 'Igual que 6b y además recalcular el resumen guardado (reescritura completa)', rutas: () => [rLote(), rAnot()],
    ejecutar: async () => {
      let ancla = '';
      await alterarJs(rLote(), async (l) => { l.eventos[2].datos.cantidadKg = 80; ancla = await recalcularCadenaLote(COD, l.eventos); recalcularResumenGuardado(l); });
      await alterarJs(rAnot(), (d) => recalcularAnotaciones(COD, d, ancla));
    } },
  { id: '7', nombre: 'Editar la cabecera del lote mostrada al público (estanque, siembra, producto, peces, supervivencia, peso, biomasa)', rutas: () => [rLote()],
    ejecutar: () => alterarJs(rLote(), (l) => {
      l.estanque = 'E9'; l.cantidadSembrada = 5000; l.fechaSiembra = '2026-01-01'; l.producto = 'Tilapia roja orgánica certificada';
      l.resumen.supervivencia = 99.9; l.resumen.pecesVivos = 4995; l.resumen.pesoPromedioActualG = 900; l.resumen.biomasaEstimadaKg = 4500;
    }) },
  { id: '8', nombre: 'Borrar el último evento (Cosecha) sin tocar el sello', rutas: () => [rLote()],
    ejecutar: () => alterarJs(rLote(), (l) => { l.eventos.pop(); }) },
  { id: '8b', nombre: 'Borrar el último evento y actualizar resumen.hashFinal', rutas: () => [rLote()],
    ejecutar: () => alterarJs(rLote(), (l) => { l.eventos.pop(); l.resumen.hashFinal = l.eventos[l.eventos.length - 1].hash; }) },
  { id: '8c', nombre: 'Borrar el último evento, actualizar hashFinal y recalcular las anotaciones', rutas: () => [rLote(), rAnot()],
    ejecutar: async () => {
      let ancla = '';
      await alterarJs(rLote(), (l) => { l.eventos.pop(); ancla = l.resumen.hashFinal = l.eventos[l.eventos.length - 1].hash; });
      await alterarJs(rAnot(), (d) => recalcularAnotaciones(COD, d, ancla));
    } },
  { id: '8d', nombre: 'Igual que 8c y además recalcular el resumen guardado (reescritura completa)', rutas: () => [rLote(), rAnot()],
    ejecutar: async () => {
      let ancla = '';
      await alterarJs(rLote(), (l) => { l.eventos.pop(); recalcularResumenGuardado(l); ancla = l.resumen.hashFinal; });
      await alterarJs(rAnot(), (d) => recalcularAnotaciones(COD, d, ancla));
    } },
  { id: '9a', nombre: 'Alterar la cantidad entregada del comprobante (sin recalcular)', rutas: () => [rComp()],
    ejecutar: () => alterarJs(rComp(), (c) => { c.cantidadEntregada = 80; }) },
  { id: '9b', nombre: 'Alterar el comprobante y recalcular su hashComprobante', rutas: () => [rComp()],
    ejecutar: () => alterarJs(rComp(), async (c) => { c.cantidadEntregada = 80; c.hashComprobante = await calcularHashComprobante(c); }) },
  { id: '9c', nombre: 'Alterar el comprobante, recalcular su hash y actualizar consultasEntrega', rutas: () => [rComp(), rCons()],
    ejecutar: async () => {
      let h = '';
      await alterarJs(rComp(), async (c) => { c.cantidadEntregada = 80; c.cliente.nombre = 'PRUEBA-Otro cliente'; h = c.hashComprobante = await calcularHashComprobante(c); });
      await alterarJs(rCons(), (k) => { for (const v of Object.values<any>(k.versiones)) v.hashComprobante = h; });
    } },
  { id: '9d', nombre: 'Alterar solo el hash del índice consultasEntrega', rutas: () => [rCons()],
    ejecutar: () => alterarJs(rCons(), (k) => { for (const v of Object.values<any>(k.versiones)) v.hashComprobante = 'a'.repeat(64); }) },
  { id: '9e', nombre: 'Borrar el comprobante (el índice sigue apuntándolo)', rutas: () => [rComp()],
    ejecutar: () => borrarCrudo(rComp()) },
  { id: '10', nombre: 'Borrar la foto de entrega antes de su vencimiento', rutas: () => [rFoto()],
    ejecutar: () => borrarCrudo(rFoto()) },
  { id: 'A1-b', nombre: 'Vaciar los eventos del lote cerrado y dejar resumen.hashFinal vacío', rutas: () => [rLote()],
    ejecutar: () => alterarJs(rLote(), (l) => { l.eventos = []; l.resumen.hashFinal = ''; }) },
  { id: 'A1-b2', nombre: 'Dejar vacío solo resumen.hashFinal del lote cerrado', rutas: () => [rLote()],
    ejecutar: () => alterarJs(rLote(), (l) => { l.resumen.hashFinal = ''; }) },
  { id: 'A1-c', nombre: 'Cambiar estanque y peces sembrados en la cabecera sin evento de corrección', rutas: () => [rLote()],
    ejecutar: () => alterarJs(rLote(), (l) => { l.estanque = 'E7'; l.cantidadSembrada = 1200; }) },
  { id: 'A1-h', nombre: 'Quitar la última resolución de una anotación (el índice "resueltas" la sigue declarando)', rutas: () => [rAnot()],
    ejecutar: () => alterarJs(rAnot(), (d) => { d.registros.pop(); }) },
  { id: 'A1-i', nombre: 'Quitar hashAnterior del comprobante y recalcular su hash y el índice', rutas: () => [rComp(), rCons()],
    ejecutar: async () => {
      let h = '';
      await alterarJs(rComp(), async (c) => { delete c.hashAnterior; h = c.hashComprobante = await calcularHashComprobante(c); });
      await alterarJs(rCons(), (k) => { for (const v of Object.values<any>(k.versiones)) v.hashComprobante = h; });
    } },
  { id: 'A1', nombre: 'Alterar el valor correcto de la anotación aprobada', rutas: () => [rAnot()],
    ejecutar: () => alterarJs(rAnot(), (d) => { d.registros[0].datos.valorCorrecto = '999'; }) },
  { id: 'A2', nombre: 'Alterar la anotación y recalcular la cadena de anotaciones (después de emitir el comprobante)', rutas: () => [rAnot()],
    ejecutar: () => alterarJs(rAnot(), (d) => { d.registros[0].datos.valorCorrecto = '999'; return recalcularAnotaciones(COD, d, d.hashAnclaje); }) },
  { id: 'A2-d', nombre: 'Borrar el documento de anotaciones del lote (después de emitir el comprobante)', rutas: () => [rAnot()],
    ejecutar: () => borrarCrudo(rAnot()) },
  // ----- Segunda ronda: cadena del historial de la orden (H14) -----
  { id: 'H14-a', nombre: 'Orden encadenada: cambiar un evento del historial (cambio de repartidor en la creación) sin tocar hashes', rutas: () => [rOrden()],
    ejecutar: () => alterarJs(rOrden(), (o) => { o.historial[0].datos.repartidor = 'Otro repartidor'; }) },
  { id: 'H14-b', nombre: 'Orden encadenada: cambiar el evento "Llegada" y recalcular su hash (no los siguientes)', rutas: () => [rOrden()],
    ejecutar: () => alterarJs(rOrden(), async (o) => {
      const e = o.historial.find((x: any) => x.tipo === 'Llegada');
      e.fecha = '2026-01-01T00:00:00.000Z';
      e.hash = await hashEventoOrden(e);
    }) },
  { id: 'H14-c', nombre: 'Orden encadenada: quitar la huella (hash y hashAnterior) de todos los eventos', rutas: () => [rOrden()],
    ejecutar: () => alterarJs(rOrden(), (o) => { for (const e of o.historial) { delete e.hash; delete e.hashAnterior; } }) },
  { id: 'H14-d', nombre: 'Orden encadenada: cambiar la creación y recalcular toda la cadena (sin tocar los eventos que documenta el comprobante)', rutas: () => [rOrden()],
    ejecutar: () => alterarJs(rOrden(), async (o) => {
      o.historial[0].datos.repartidor = 'Otro repartidor';
      for (let i = 0; i < o.historial.length; i++) {
        const e = o.historial[i];
        e.hashAnterior = i === 0 ? await anclaHistorial([]) : o.historial[i - 1].hash;
        delete e.hash;
        e.hash = await hashEventoOrden(e);
      }
    }) },
  // ----- Segunda ronda: comprobante anclado al sello del lote (H18) -----
  { id: 'H18-a', nombre: 'Reescribir el lote (fase, cadena, resumen y sello) dejando el comprobante con el sello viejo', rutas: () => [rLote(), rAnot()],
    ejecutar: async () => {
      let ancla = '';
      await alterarJs(rLote(), async (l) => { l.eventos[2].datos.cantidadKg = 80; ancla = await recalcularCadenaLote(COD, l.eventos); recalcularResumenGuardado(l); });
      await alterarJs(rAnot(), (d) => recalcularAnotaciones(COD, d, ancla));
    } },
  { id: 'H18-b', nombre: 'Igual que H18-a y además recalcular el comprobante con el sello nuevo (hash, índice y evento de la orden)', rutas: () => [rLote(), rAnot(), rComp(), rCons(), rOrden()],
    ejecutar: async () => {
      let ancla = '';
      let ultimo = '';
      await alterarJs(rLote(), async (l) => { l.eventos[2].datos.cantidadKg = 80; ancla = await recalcularCadenaLote(COD, l.eventos); recalcularResumenGuardado(l); });
      await alterarJs(rAnot(), async (d) => { await recalcularAnotaciones(COD, d, ancla); ultimo = d.registros[d.registros.length - 1].hash; });
      let h = '';
      await alterarJs(rComp(), async (c) => {
        c.sellosLotes[COD] = ancla;
        c.anotacionesLotes[COD].ultimoHash = ultimo;
        const { registradoEnServidor, ...resto } = c;
        h = c.hashComprobante = await calcularHashComprobante(resto);
      });
      await alterarJs(rCons(), (k) => { for (const v of Object.values<any>(k.versiones)) v.hashComprobante = h; });
      await alterarJs(rOrden(), (o) => { o.historial.find((e: any) => e.tipo === 'Comprobante emitido').datos.hashComprobante = h; });
    } }
];

// ---------- Ataque 9f: borrar el bloque de anulación (necesita una anulación real) ----------
async function ataqueAnulacion(resultados: any[]) {
  await entrar(VEND);
  const anul = await anularComprobante(ctx.comprobanteId, 'PRUEBA: anulación para probar el borrado del bloque');
  const base = await evaluar();
  const crudo = await leerCrudo(`comprobantes/${anul.id}`);
  await borrarCrudo(`comprobantes/${anul.id}`);
  const s = await evaluar();
  resultados.push({ id: '9f', nombre: 'Borrar el bloque de anulación de un comprobante anulado', resultado: clasificar(s), senales: s, antes: base.datos.entregaPublica });
  await restaurar(`comprobantes/${anul.id}`, crudo);
}

// ---------- 11: parámetros ?lote= y ?entrega= ----------
async function simularLote(param: string) {
  // Copia de PublicTraceabilityView (codigoSeguro + validación del código + cargarLote), sin sesión
  const codigoLote = new URLSearchParams('?lote=' + param).get('lote') || '';
  if (!codigoLote) return 'sin parámetro: App muestra el panel normal';
  let codigoLimpio = codigoLote;
  if (/%[0-9A-Fa-f]{2}/.test(codigoLimpio)) {
    try {
      codigoLimpio = decodeURIComponent(codigoLimpio);
    } catch {
      /* se usa tal cual */
    }
  }
  codigoLimpio = codigoLimpio.trim();
  if (!/^(?!__.*__$)[A-Za-z0-9_-]{1,64}$/.test(codigoLimpio)) return '"Lote no disponible": El código del lote no es válido (sin consultar el servidor)';
  try {
    let snap = await getDocFromServer(doc(db, 'lotes', codigoLimpio));
    if (!snap.exists() && codigoLimpio !== codigoLimpio.toUpperCase()) snap = await getDocFromServer(doc(db, 'lotes', codigoLimpio.toUpperCase()));
    if (snap.exists()) return `muestra el lote ${(snap.data() as any).codigo}`;
    return `"Lote no disponible": El lote "${codigoLimpio.slice(0, 60)}${codigoLimpio.length > 60 ? '…' : ''}" no se encuentra registrado (texto escapado por React)`;
  } catch (err: any) {
    return err?.code === 'permission-denied' ? `permission-denied: "El servidor de trazabilidad no permitió la lectura pública"` : `error (${(err?.message || '').slice(0, 80)}): "No fue posible consultar el servidor en este momento"`;
  }
}
async function simularEntrega(param: string) {
  const token = new URLSearchParams('?entrega=' + param).get('entrega') || '';
  if (!token) return 'sin parámetro: App muestra el panel normal';
  try {
    const r = await leerConsultaEntrega(token);
    if (!r || !r.bloques.length) return '"No se encontró ninguna entrega con este código."';
    return `muestra la entrega ${r.consulta.ordenId}`;
  } catch (e: any) {
    return `"No se pudo consultar la entrega. Intente de nuevo." (${(e?.code || e?.message || '').slice(0, 60)})`;
  }
}

// ---------- 12: las mismas alteraciones como usuarios normales (con reglas) ----------
async function intento(quien: string | null, desc: string, f: () => Promise<any>) {
  if (quien) await entrar(quien, quien === REP ? 'courier' : 'operator');
  else await signOut(auth);
  try {
    await f();
    return { quien: quien || 'anónimo', intento: desc, resultado: 'PERMITIDO' };
  } catch (e: any) {
    return { quien: quien || 'anónimo', intento: desc, resultado: e?.code === 'permission-denied' ? 'bloqueado (permission-denied)' : `error: ${e?.code || e?.message}` };
  }
}

async function pruebasReglas() {
  const out: any[] = [];
  const lote = await leerJs(rLote());
  const anot = await leerJs(rAnot());
  const cons = await leerJs(rCons());
  const orden = await leerJs(rOrden());
  const evs = JSON.parse(JSON.stringify(lote.eventos));
  evs[2].datos.cantidadKg = 80;
  out.push(await intento(OPER, 'Lote cerrado: alterar dato de la fase #2', () => updateDoc(doc(db, 'lotes', COD), { eventos: evs })));
  out.push(await intento(OPER, 'Lote cerrado: cambiar estanque y peces sembrados', () => updateDoc(doc(db, 'lotes', COD), { estanque: 'E9', cantidadSembrada: 5000 })));
  out.push(await intento(OPER, 'Lote cerrado: cambiar resumen.supervivencia', () => updateDoc(doc(db, 'lotes', COD), { 'resumen.supervivencia': 99.9 })));
  out.push(await intento(OPER, 'Lote cerrado: borrarlo', () => deleteDoc(doc(db, 'lotes', COD))));
  out.push(await intento(REP, 'Foto: reemplazar datos', () => updateDoc(doc(db, 'fotosEntrega', ctx.fotoId), { datos: JPEG_B })));
  out.push(await intento(REP, 'Foto: borrarla', () => deleteDoc(doc(db, 'fotosEntrega', ctx.fotoId))));
  out.push(await intento(VEND, 'Foto: reemplazar datos (operador de pedidos)', () => updateDoc(doc(db, 'fotosEntrega', ctx.fotoId), { datos: JPEG_B })));
  out.push(await intento(VEND, 'Comprobante: alterar cantidad', () => updateDoc(doc(db, 'comprobantes', ctx.comprobanteId), { cantidadEntregada: 80 })));
  out.push(await intento(VEND, 'Comprobante: borrarlo', () => deleteDoc(doc(db, 'comprobantes', ctx.comprobanteId))));
  const cons2 = JSON.parse(JSON.stringify(cons)); delete cons2.esPrueba;
  for (const v of Object.values<any>(cons2.versiones)) v.hashComprobante = 'a'.repeat(64);
  out.push(await intento(VEND, 'consultasEntrega: cambiar el hash registrado', () => setDoc(doc(db, 'consultasEntrega', ctx.token), cons2)));
  out.push(await intento(VEND, 'consultasEntrega: borrarla', () => deleteDoc(doc(db, 'consultasEntrega', ctx.token))));
  const hist = JSON.parse(JSON.stringify(orden.historial));
  hist.find((e: any) => e.tipo === 'Entrega').datos.foto.hash = 'b'.repeat(64);
  out.push(await intento(VEND, 'Orden: cambiar el hash de la foto en el historial', () => updateDoc(doc(db, 'ordenes', ctx.ordenId), { historial: hist })));
  out.push(await intento(REP, 'Orden: cambiar el hash de la foto en el historial (repartidor)', () => updateDoc(doc(db, 'ordenes', ctx.ordenId), { historial: hist })));
  const regs = JSON.parse(JSON.stringify(anot.registros)); regs[0].datos.valorCorrecto = '999';
  out.push(await intento('anota-a@prueba.co', 'Anotación: alterar el valor correcto', () => updateDoc(doc(db, 'anotacionesLote', COD), { registros: regs })));
  out.push(await intento('anota-a@prueba.co', 'Anotación: borrar el documento', () => deleteDoc(doc(db, 'anotacionesLote', COD))));
  out.push(await intento(null, 'Anónimo: alterar el lote', () => updateDoc(doc(db, 'lotes', COD), { estanque: 'E9' })));
  out.push(await intento(null, 'Anónimo: crear un lote falso', () => setDoc(doc(db, 'lotes', 'PRUEBA-FALSO'), { codigo: 'PRUEBA-FALSO', estado: 'cerrado', eventos: [] })));
  out.push(await intento('intruso@prueba.co', 'Operador sin permisos: crear un lote', () => crearLoteActivo('E1', 'intruso@prueba.co')));
  out.push(await intento('intruso@prueba.co', 'Operador sin permisos: leer la foto', () => getDocFromServer(doc(db, 'fotosEntrega', ctx.fotoId))));
  out.push(await intento(null, 'Anónimo: leer la foto', () => getDocFromServer(doc(db, 'fotosEntrega', ctx.fotoId))));

  // Huecos con permisos legítimos: lote activo nuevo de un operador con permisos de producción
  await entrar(OPER);
  COD2 = await crearLoteActivo('E2', OPER);
  out.push(await intento(OPER, 'Lote ACTIVO: cambiar resumen (supervivencia 99.9, peso 900 g, biomasa 4500 kg) sin registrar ningún evento', () =>
    updateDoc(doc(db, 'lotes', COD2), { 'resumen.supervivencia': 99.9, 'resumen.pesoPromedioActualG': 900, 'resumen.biomasaEstimadaKg': 4500, 'resumen.pecesVivos': 999 })));
  out.push(await intento(OPER, 'Lote ACTIVO: cambiar producto y origen sin evento', () => updateDoc(doc(db, 'lotes', COD2), { producto: 'Tilapia orgánica certificada' })));
  out.push(await intento(OPER, 'CIERRE: sellar el lote cambiando a la vez estanque, peces sembrados, producto, origen y fecha de cierre', () =>
    updateDoc(doc(db, 'lotes', COD2), { estado: 'cerrado', fechaCierre: '2026-01-01', estanque: 'E9', cantidadSembrada: 99999, producto: 'Tilapia orgánica certificada', origen: 'Otra granja' })));
  const l2 = await leerJs(`lotes/${COD2}`);
  const v2 = await verificarIntegridadLote(l2);
  const a2 = await analizarCadenaLote(l2);
  const r2 = await revisarLote(l2, { config: CONFIG_DEFAULT });
  out.push({ quien: '(verificación)', intento: `Lote ${COD2} tras el cierre manipulado: estado=${l2.estado}, estanque=${l2.estanque}, cantidadSembrada=${l2.cantidadSembrada}, producto="${l2.producto}", supervivencia=${l2.resumen?.supervivencia}`, resultado: `verificarIntegridadLote: ${v2.valido ? 'ÍNTEGRO' : 'alterado'} · analizarCadenaLote: ${a2.valido ? 'ÍNTEGRO' : 'alterado'} · revisión automática al abrir: ${r2.estado === 'integro' ? 'sin aviso' : 'AVISO: ' + r2.avisos.length + ' dato(s) no corresponden a las fases'}` });
  return out;
}

// ---------- Programa ----------
async function principal() {
  if (!/127\.0\.0\.1:8185/.test(RAIZ) && !process.env.PERMITIR_OTRO_PUERTO) throw new Error('Solo emulador en 8185');
  console.log('Sembrando datos válidos…');
  await sembrarDatos();
  console.log('Lote de prueba:', COD);
  const base = await evaluar();
  console.log('Línea base:', clasificar(base), JSON.stringify(base.automaticas.concat(base.manuales)));
  if (base.automaticas.length || base.manuales.length) throw new Error('La línea base no está íntegra: ' + JSON.stringify(base));

  const resultados: any[] = [];
  for (const a of ATAQUES) {
    const originales = await Promise.all(a.rutas().map(async (r) => [r, await leerCrudo(r)] as const));
    await a.ejecutar();
    const s = await evaluar();
    resultados.push({ id: a.id, nombre: a.nombre, resultado: clasificar(s), senales: s });
    console.log(`[${a.id}] ${clasificar(s)} · ${a.nombre}`);
    for (const [r, c] of originales) await restaurar(r, c);
    const ok = await evaluar();
    if (ok.automaticas.length || ok.manuales.length) throw new Error(`No se restauró bien tras ${a.id}: ${JSON.stringify(ok)}`);
  }

  const reglas = await pruebasReglas();
  for (const r of reglas) console.log(`[12] ${r.resultado} · ${r.quien} · ${r.intento}`);

  await signOut(auth);
  const parametros: any[] = [];
  const loteMin = COD.toLowerCase();
  for (const p of ['NOEXISTE-20991231-Z-E9', encodeURIComponent(loteMin), '%3Cscript%3Ealert(1)%3C%2Fscript%3E', "PRUEBA'%20OR%20'1'%3D'1", '..%2Fusuarios%2Fx', 'a%2Fb%2Fc', 'a%2Fb', '__nombre__', '%25', '%25E0%25A4%25A', 'A'.repeat(1600)]) {
    parametros.push({ param: `?lote=${p.length > 60 ? p.slice(0, 20) + '…(' + p.length + ' caracteres)' : p}`, resultado: await simularLote(p) });
  }
  for (const p of ['c' + '0'.repeat(40), 'cFALSO', 'a%2Fb', '__x__', '%3Cimg%20src%3Dx%3E', ctx.token]) {
    parametros.push({ param: `?entrega=${p === ctx.token ? '(token real)' : p}`, resultado: await simularEntrega(p) });
  }
  for (const r of parametros) console.log(`[11] ${r.param} -> ${r.resultado}`);

  await ataqueAnulacion(resultados);
  console.log(`[9f] ${resultados[resultados.length - 1].resultado}`);

  const salida = { fecha: new Date().toISOString(), lote: COD, lote2: COD2, contexto: ctx, ataques: resultados, reglas, parametros };
  writeFileSync(path.join(aqui, '..', 'resultados.json'), JSON.stringify(salida, null, 2));
  const md = [
    '# Resultados de las pruebas de alteración (generado)', '', `Fecha: ${salida.fecha} · Lote: ${COD}`, '',
    'Columna "QR antiguo": si el aviso del lote también sale con una etiqueta QR impresa antes de esta versión (sin el sello `s=`).', '',
    '| Ataque | Resultado | QR antiguo | Avisos automáticos | Fallas al pulsar verificar | Lo que ve el público |', '| --- | --- | --- | --- | --- | --- |',
    ...resultados.map((r) => `| ${r.id}. ${r.nombre} | ${r.resultado} | ${/^(4|5|6|6b|6c|6d|7|8|8b|8c|8d|A1-b|A1-b2|A1-c)$/.test(r.id) ? r.senales.datos.qrAntiguoSinSello : '-'} | ${r.senales.automaticas.join('<br>').replace(/\|/g, '/').replace(/ \/ /g, '<br>') || 'ninguno'} | ${r.senales.manuales.join('<br>') || 'ninguna'} | ${(JSON.stringify(r.id.startsWith('9') || r.id === 'A1-i' ? r.senales.datos.entregaPublica : r.id.match(/^(1|2|3|3b|10)$/) ? r.senales.datos.foto : r.senales.datos.lote) ?? "sin datos").replace(/\|/g, '/')} |`),
    '', '## 11. Parámetros de la URL', '', '| Parámetro | Resultado |', '| --- | --- |', ...parametros.map((p) => `| \`${p.param}\` | ${p.resultado} |`),
    '', '## 12. Alteraciones como usuario autenticado (con reglas)', '', '| Usuario | Intento | Resultado |', '| --- | --- | --- |', ...reglas.map((r) => `| ${r.quien} | ${r.intento} | ${r.resultado} |`), ''
  ].join('\n');
  writeFileSync(path.join(aqui, '..', 'resultados.md'), md);
  console.log('Listo: tests/integridad/resultados.md');
}

principal().then(() => process.exit(0), (e) => { console.error('FALLÓ:', e); process.exit(1); });
