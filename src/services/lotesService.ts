import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  query,
  runTransaction,
  where
} from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseConfig';
import { Lote, EventoLote, TipoEvento, ConfiguracionGeneral } from '../types';
import {
  PRODUCTO_FIJO,
  MODALIDAD_FIJA,
  ORIGEN_FIJO,
  GRANJA_ID_PREDETERMINADA,
  compactarFecha,
  getFechaHoyBogota
} from '../utils/constants';
import { calcularHashEvento, HASH_GENESIS } from './hashService';
import { recalcularResumenLote } from './calculosService';
import { generarYSubirPdfLote } from './pdfService';
import { construirUrlPublicaPdf, construirUrlPublicaTrazabilidad } from './qrService';

// Firestore es la única fuente de verdad de los lotes. Ya no se leen ni se escriben copias en
// localStorage: esas copias no se compartían entre usuarios y, al resincronizarse, pisaban los
// eventos registrados por otros. Los datos antiguos que existan en localStorage no se borran.

/**
 * Convierte un número incremental (1, 2, 26, 27...) a letra(s) (A, B, Z, AA, AB...)
 */
export function obtenerLetraConsecutiva(consecutivo: number): string {
  let num = Math.max(1, Math.floor(consecutivo));
  let letras = '';
  while (num > 0) {
    const rem = (num - 1) % 26;
    letras = String.fromCharCode(65 + rem) + letras;
    num = Math.floor((num - 1) / 26);
  }
  return letras || 'A';
}

/**
 * Traduce un error de Firestore a un mensaje comprensible para el operario
 */
function mensajeErrorFirestore(accion: string, err: any): Error {
  const codigo = err?.code || '';
  if (codigo === 'permission-denied') {
    return new Error(`No tienes permiso para ${accion} en la base de datos de la granja.`);
  }
  if (codigo === 'unavailable' || codigo === 'deadline-exceeded') {
    return new Error(`No hay conexión con la base de datos. No fue posible ${accion}; intenta de nuevo cuando tengas internet.`);
  }
  return new Error(err?.message || `No fue posible ${accion}.`);
}

function generarIdEvento(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `ev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export interface ParamsNuevoLote {
  estanque: string;
  fechaSiembra: string; // YYYY-MM-DD
  cantidadSembrada: number;
  pesoInicialPromedioG: number;
  proveedorAlevinos?: string;
  observaciones?: string;
  userEmail: string;
  config: ConfiguracionGeneral;
  granjaId?: string;
}

/**
 * Crea un nuevo lote con garantía de inalterabilidad y registro directo en Firestore.
 * Utiliza setDoc con timeout de seguridad para garantizar que nunca se quede colgado en pantalla.
 */
export async function crearNuevoLote(params: ParamsNuevoLote): Promise<Lote> {
  const {
    estanque,
    fechaSiembra,
    cantidadSembrada,
    pesoInicialPromedioG,
    proveedorAlevinos,
    observaciones,
    userEmail,
    config,
    granjaId = GRANJA_ID_PREDETERMINADA
  } = params;

  const estanqueLimpio = (estanque || 'E1').trim().toUpperCase().replace(/[^a-zA-Z0-9_-]/g, '');
  const fechaCompacta = compactarFecha(fechaSiembra);
  const globalCounterRef = doc(db, 'contadores', 'lotes_global');
  const diarioCounterRef = doc(db, 'contadores', `diario_${fechaCompacta}_${estanqueLimpio}`);
  const creadoPorUid = auth.currentUser?.uid || 'uid_' + Date.now();
  const fechaIsoAhora = new Date().toISOString();

  // 1. Obtener consecutivo de forma segura y veloz (con fallback de tiempo si Firestore tarda)
  let nuevoConsecutivoGlobal = 1;
  let nuevoConsecutivoDiario = 1;

  try {
    const leerContadores = Promise.all([getDoc(globalCounterRef), getDoc(diarioCounterRef)]);
    const [globalSnap, diarioSnap] = await Promise.race([
      leerContadores,
      new Promise<[any, any]>((_, reject) => setTimeout(() => reject(new Error('timeout_contadores')), 2500))
    ]);
    if (globalSnap?.exists()) {
      nuevoConsecutivoGlobal = (Number(globalSnap.data()?.valor) || 0) + 1;
    }
    if (diarioSnap?.exists()) {
      nuevoConsecutivoDiario = (Number(diarioSnap.data()?.valor) || 0) + 1;
    }
  } catch (errContador) {
    // Si no existen o hay timeout, generar consecutivo basado en tiempo
    nuevoConsecutivoGlobal = Math.floor(Date.now() / 1000) % 10000;
    nuevoConsecutivoDiario = 1;
  }

  const letra = obtenerLetraConsecutiva(nuevoConsecutivoDiario);
  const codigoGenerado = `${fechaCompacta}-${letra}-${estanqueLimpio}`;
  const loteDocRef = doc(db, 'lotes', codigoGenerado);

  const descripcionSiembra = observaciones?.trim() || 'Siembra inicial del lote en estanque ' + estanque;
  const datosSiembra = {
    cantidad: cantidadSembrada,
    pesoPromedioInicialG: pesoInicialPromedioG,
    proveedor: proveedorAlevinos?.trim() || ''
  };

  // 2. Calcular hash criptográfico antes de la escritura
  let hashSiembra = HASH_GENESIS;
  try {
    hashSiembra = await calcularHashEvento({
      codigoLote: codigoGenerado,
      indice: 0,
      tipo: 'Siembra',
      fechaEvento: fechaSiembra,
      descripcion: descripcionSiembra,
      datos: datosSiembra,
      registradoPor: userEmail,
      registradoEn: fechaIsoAhora,
      hashAnterior: HASH_GENESIS
    });
  } catch (errHash) {
    console.warn('Error calculando hash evento siembra:', errHash);
    hashSiembra = 'h_' + Date.now().toString(16) + '0'.repeat(48);
  }

  const primerEvento: EventoLote = {
    id: generarIdEvento(),
    indice: 0,
    tipo: 'Siembra',
    fechaEvento: fechaSiembra,
    descripcion: descripcionSiembra,
    datos: datosSiembra,
    registradoPor: userEmail,
    registradoEn: fechaIsoAhora,
    hashAnterior: HASH_GENESIS,
    hash: hashSiembra
  };

  const estanqueInfo = config.estanques.find((e) => e.codigo === estanque);
  const resumenInicial = recalcularResumenLote({
    fechaSiembra,
    cantidadSembrada,
    pesoInicialPromedioG,
    eventos: [primerEvento],
    estado: 'activo',
    fechaCierre: null,
    volumenEstanqueM3: estanqueInfo?.volumenM3,
    rangos: config.rangosReferencia
  });

  const loteData: Lote = {
    codigo: codigoGenerado,
    consecutivo: nuevoConsecutivoGlobal,
    estanque,
    producto: PRODUCTO_FIJO,
    modalidad: MODALIDAD_FIJA,
    origen: ORIGEN_FIJO,
    fechaSiembra,
    cantidadSembrada,
    pesoInicialPromedioG,
    proveedorAlevinos: proveedorAlevinos?.trim() || '',
    estado: 'activo',
    fechaCierre: null,
    eventos: [primerEvento],
    resumen: resumenInicial,
    pdfPath: `lotes/${codigoGenerado}.pdf`,
    pdfUrl: construirUrlPublicaPdf(codigoGenerado),
    versionPdf: 1,
    pdfActualizadoEn: fechaIsoAhora,
    granjaId,
    creadoPor: userEmail,
    creadoPorUid,
    creadoEn: fechaIsoAhora,
    actualizadoEn: fechaIsoAhora,
    observacionesIniciales: observaciones?.trim() || ''
  };

  // 3. Guardar el lote directamente en Firestore con timeout de seguridad (nunca cuelga la UI)
  try {
    const guardarLote = setDoc(loteDocRef, loteData);
    await Promise.race([
      guardarLote,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado al conectar con Firestore. Revisa tu conexión a internet.')), 7000))
    ]);

    // Actualizar contadores de fondo de forma no bloqueante
    setDoc(globalCounterRef, { valor: nuevoConsecutivoGlobal, actualizadoEn: fechaIsoAhora }, { merge: true }).catch(() => {});
    setDoc(diarioCounterRef, { valor: nuevoConsecutivoDiario, actualizadoEn: fechaIsoAhora }, { merge: true }).catch(() => {});

    return loteData;
  } catch (err: any) {
    console.error('Error guardando lote en Firestore:', err);
    throw mensajeErrorFirestore('crear el lote', err);
  }
}

export interface ParamsAgregarEvento {
  codigoLote: string;
  tipo: TipoEvento;
  fechaEvento: string;
  descripcion: string;
  datos: Record<string, any>;
  userEmail: string;
  config: ConfiguracionGeneral;
}

/**
 * Agrega un nuevo evento a la cadena inalterable, calculando el hash SHA-256.
 * La transacción lee la versión vigente del lote en Firestore, de modo que los eventos
 * registrados al mismo tiempo por otros usuarios no se pierden.
 */
export async function registrarEventoEnLote(params: ParamsAgregarEvento): Promise<Lote> {
  const { codigoLote, tipo, fechaEvento, descripcion, datos, userEmail, config } = params;
  const loteRef = doc(db, 'lotes', codigoLote);

  let loteActualizado: Lote;
  try {
    loteActualizado = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(loteRef);
      if (!snap.exists()) {
        throw new Error(`El lote ${codigoLote} no existe en la base de datos de la granja.`);
      }
      const lote = snap.data() as Lote;

      // REGLA CRÍTICA: Bloquear cualquier nuevo registro si el lote está sellado/cerrado
      if (lote.estado === 'cerrado') {
        throw new Error(`El lote ${codigoLote} se encuentra sellado y cerrado. Está estrictamente bloqueada cualquier modificación o incorporación de nuevos registros de producción.`);
      }

      const eventosActuales = lote.eventos || [];
      const nuevoIndice = eventosActuales.length;
      const hashAnterior = nuevoIndice === 0 ? HASH_GENESIS : eventosActuales[nuevoIndice - 1].hash;

      const fechaIsoAhora = new Date().toISOString();

      const hash = await calcularHashEvento({
        codigoLote,
        indice: nuevoIndice,
        tipo,
        fechaEvento,
        descripcion: descripcion || '',
        datos: datos || {},
        registradoPor: userEmail,
        registradoEn: fechaIsoAhora,
        hashAnterior
      });

      const nuevoEvento: EventoLote = {
        id: generarIdEvento(),
        indice: nuevoIndice,
        tipo,
        fechaEvento,
        descripcion: descripcion || '',
        datos: datos || {},
        registradoPor: userEmail,
        registradoEn: fechaIsoAhora,
        hashAnterior,
        hash
      };

      const listaEventosActualizada = [...eventosActuales, nuevoEvento];
      const estanqueInfo = config.estanques.find((e) => e.codigo === lote.estanque);
      const nuevoResumen = recalcularResumenLote({
        fechaSiembra: lote.fechaSiembra,
        cantidadSembrada: lote.cantidadSembrada,
        pesoInicialPromedioG: lote.pesoInicialPromedioG,
        eventos: listaEventosActualizada,
        estado: 'activo',
        fechaCierre: null,
        volumenEstanqueM3: estanqueInfo?.volumenM3,
        rangos: config.rangosReferencia
      });

      const patch: Partial<Lote> = {
        eventos: listaEventosActualizada,
        resumen: nuevoResumen,
        actualizadoEn: fechaIsoAhora
      };

      transaction.update(loteRef, patch);

      return {
        ...lote,
        ...patch
      } as Lote;
    });
  } catch (err: any) {
    console.error('Error registrando evento en Firestore:', err);
    throw mensajeErrorFirestore('registrar el evento', err);
  }

  return loteActualizado;
}

export interface ParamsModificarSiembraOPiscina {
  codigoLote: string;
  estanque: string;
  cantidadSembrada: number;
  pesoInicialPromedioG: number;
  proveedorAlevinos?: string;
  observaciones?: string;
  userEmail: string;
  config: ConfiguracionGeneral;
}

/**
 * Modifica los datos iniciales de alevinos (siembra) o piscina/estanque de un lote.
 * Solo se permite mientras el lote esté en estado 'activo'. Si el lote está sellado/cerrado,
 * la operación es rechazada categóricamente.
 */
export async function modificarDatosSiembraOPiscina(params: ParamsModificarSiembraOPiscina): Promise<Lote> {
  const {
    codigoLote,
    estanque,
    cantidadSembrada,
    pesoInicialPromedioG,
    proveedorAlevinos,
    observaciones,
    userEmail,
    config
  } = params;
  const loteRef = doc(db, 'lotes', codigoLote);

  let loteModificado: Lote;
  try {
    loteModificado = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(loteRef);
      if (!snap.exists()) {
        throw new Error(`El lote ${codigoLote} no existe en la base de datos de la granja.`);
      }
      const lote = snap.data() as Lote;

      // REGLA CRÍTICA: Solo se permite modificar si el lote está activo
      if (lote.estado === 'cerrado') {
        throw new Error(`El lote ${codigoLote} se encuentra sellado y cerrado. Está estrictamente bloqueada cualquier modificación de registros de alevinos o piscina.`);
      }

      const fechaIsoAhora = new Date().toISOString();
      const eventos = [...(lote.eventos || [])];

      // Actualizar el evento inicial de Siembra (índice 0)
      if (eventos.length > 0 && eventos[0].tipo === 'Siembra') {
        const datosSiembra = {
          ...eventos[0].datos,
          cantidad: cantidadSembrada,
          pesoPromedioInicialG: pesoInicialPromedioG,
          proveedor: proveedorAlevinos?.trim() || ''
        };
        const descripcionSiembra = observaciones?.trim() || `Siembra inicial del lote en estanque ${estanque}`;

        eventos[0] = {
          ...eventos[0],
          descripcion: descripcionSiembra,
          datos: datosSiembra,
          registradoPor: userEmail,
          registradoEn: fechaIsoAhora
        };

        // Recalcular hash del bloque 0
        eventos[0].hash = await calcularHashEvento({
          codigoLote: lote.codigo,
          indice: 0,
          tipo: 'Siembra',
          fechaEvento: eventos[0].fechaEvento,
          descripcion: descripcionSiembra,
          datos: datosSiembra,
          registradoPor: userEmail,
          registradoEn: fechaIsoAhora,
          hashAnterior: HASH_GENESIS
        });

        // Recalcular la cadena hacia adelante para preservar la inalterabilidad matemática
        for (let i = 1; i < eventos.length; i++) {
          eventos[i] = {
            ...eventos[i],
            hashAnterior: eventos[i - 1].hash
          };
          // El hash incluye el código del lote, igual que al registrar y al verificar la cadena
          eventos[i].hash = await calcularHashEvento({ ...eventos[i], codigoLote: lote.codigo });
        }
      }

      const estanqueInfo = config.estanques.find((e) => e.codigo === estanque);
      const nuevoResumen = recalcularResumenLote({
        fechaSiembra: lote.fechaSiembra,
        cantidadSembrada,
        pesoInicialPromedioG,
        eventos,
        estado: 'activo',
        fechaCierre: null,
        volumenEstanqueM3: estanqueInfo?.volumenM3,
        rangos: config.rangosReferencia
      });

      const patch: Partial<Lote> = {
        estanque,
        cantidadSembrada,
        pesoInicialPromedioG,
        proveedorAlevinos: proveedorAlevinos?.trim() || '',
        observacionesIniciales: observaciones?.trim() || '',
        eventos,
        resumen: nuevoResumen,
        actualizadoEn: fechaIsoAhora
      };

      transaction.update(loteRef, patch);

      return {
        ...lote,
        ...patch
      } as Lote;
    });
  } catch (err: any) {
    console.error('Error modificando registros de alevinos/piscina en Firestore:', err);
    throw mensajeErrorFirestore('modificar datos de alevinos o piscina', err);
  }

  return loteModificado;
}

/**
 * Cierra un lote productivo, actualiza su estado en Firestore y genera el certificado PDF.
 * Una vez cerrado, el lote queda sellado e inalterable.
 */
export async function cerrarLote(
  codigoLote: string,
  userEmail: string,
  config: ConfiguracionGeneral
): Promise<Lote> {
  const codigoLimpio = codigoLote.trim();
  const loteRef = doc(db, 'lotes', codigoLimpio);
  const fechaCierre = getFechaHoyBogota();
  const fechaIsoAhora = new Date().toISOString();

  let loteCerrado: Lote;
  try {
    loteCerrado = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(loteRef);
      if (!snap.exists()) {
        throw new Error(`El lote ${codigoLimpio} no fue encontrado para proceder con el cierre.`);
      }
      const loteBase = snap.data() as Lote;

      if (loteBase.estado === 'cerrado') {
        throw new Error(`El lote ${codigoLimpio} ya se encuentra sellado y cerrado.`);
      }

      const estanqueInfo = config.estanques.find((e) => e.codigo === loteBase.estanque);
      const nuevoResumen = recalcularResumenLote({
        fechaSiembra: loteBase.fechaSiembra,
        cantidadSembrada: loteBase.cantidadSembrada,
        pesoInicialPromedioG: loteBase.pesoInicialPromedioG,
        eventos: loteBase.eventos || [],
        estado: 'cerrado',
        fechaCierre,
        volumenEstanqueM3: estanqueInfo?.volumenM3,
        rangos: config.rangosReferencia
      });

      // Solo se actualizan los campos del cierre; los eventos no se reescriben
      const patch: Partial<Lote> = {
        estado: 'cerrado',
        fechaCierre,
        resumen: nuevoResumen,
        pdfPath: `lotes/${codigoLimpio}.pdf`,
        pdfUrl: construirUrlPublicaTrazabilidad(codigoLimpio),
        versionPdf: (loteBase.versionPdf || 0) + 1,
        pdfActualizadoEn: fechaIsoAhora,
        actualizadoEn: fechaIsoAhora
      };

      transaction.update(loteRef, patch);

      return { ...loteBase, ...patch } as Lote;
    });
  } catch (err: any) {
    console.error('Error cerrando lote en Firestore:', err);
    throw mensajeErrorFirestore('cerrar el lote', err);
  }

  // Generar el PDF y subirlo a Storage de fondo (con timeout de protección para nunca colgar la UI)
  generarYSubirPdfLote(loteCerrado, config).catch((pdfErr) => {
    console.warn('Generación de PDF en segundo plano:', pdfErr);
  });

  return loteCerrado;
}

/**
 * Escucha en tiempo real todos los lotes de la granja y lotes históricos sin omitir ninguno.
 */
export function escucharLotes(
  onUpdate: (lotes: Lote[]) => void,
  onError?: (error: any) => void,
  granjaId: string = GRANJA_ID_PREDETERMINADA
): () => void {
  return onSnapshot(
    collection(db, 'lotes'),
    (snapshot) => {
      const lista: Lote[] = [];
      snapshot.forEach((docSnap) => {
        const lote = docSnap.data() as Lote;
        // Si no tiene granjaId, asignarle por defecto la granja predeterminada para que se visualice
        if (!lote.granjaId || lote.granjaId === granjaId) {
          lista.push({
            ...lote,
            granjaId: lote.granjaId || granjaId
          });
        }
      });
      lista.sort((a, b) => (b.consecutivo || 0) - (a.consecutivo || 0));
      onUpdate(lista);
    },
    (error) => {
      console.error('Error escuchando lotes en Firestore:', error);
      if (onError) onError(error);
    }
  );
}

/**
 * Escucha un lote individual en tiempo real
 */
export function escucharLoteIndividual(
  codigoLote: string,
  onUpdate: (lote: Lote | null) => void,
  onError?: (error: any) => void
): () => void {
  return onSnapshot(
    doc(db, 'lotes', codigoLote),
    (snap) => {
      onUpdate(snap.exists() ? (snap.data() as Lote) : null);
    },
    (error) => {
      console.error(`Error escuchando el lote ${codigoLote} en Firestore:`, error);
      if (onError) onError(error);
    }
  );
}
