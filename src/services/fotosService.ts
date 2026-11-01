import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { calcularSha256 } from './hashService';
import { generarId } from './pedidosService';

// Fotos de entrega. No se usa Firebase Storage: la foto se comprime en el teléfono (JPEG de hasta
// 800 px, ~60-150 KB) y se guarda como texto en fotosEntrega/{id}, en la misma operación que la
// entrega. Firestore la borra sola a los 15 días mediante una política TTL sobre "expiraEn"; el
// evento de la orden conserva siempre el identificador y el hash SHA-256 de la foto, de modo que
// queda constancia de que existió y, mientras exista, se puede verificar que no cambió.
// Solo la ven el operador de la granja y el repartidor que la tomó; nunca la consulta pública.

export const DIAS_RETENCION_FOTOS = 15;
const LADO_MAXIMO = 800;
const TAMANO_MAXIMO = 450_000; // caracteres del texto base64 (límite de las reglas: 700 000)

export interface FotoPreparada {
  id: string;
  hash: string; // SHA-256 del texto de la imagen
  datos: string; // data:image/jpeg;base64,...
  ancho: number;
  alto: number;
  bytes: number; // tamaño aproximado del JPEG
  tomadaEn: string;
}

export interface FotoEntrega {
  id: string;
  ordenId: string;
  granjaId: string;
  eventoId: string;
  subidaPorUid: string;
  tomadaEn: string;
  expiraEn: { toDate: () => Date };
  tipo: 'image/jpeg';
  ancho: number;
  alto: number;
  bytes: number;
  hash: string;
  datos: string;
}

function cargarImagen(archivo: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen. Toma la foto de nuevo.'));
    };
    img.src = url;
  });
}

/**
 * Reduce y comprime la foto en el teléfono. Devuelve el texto de la imagen y su hash.
 */
export async function prepararFoto(archivo: File): Promise<FotoPreparada> {
  if (!archivo.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
  const img = await cargarImagen(archivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(img.naturalWidth, img.naturalHeight));
  const ancho = Math.max(1, Math.round(img.naturalWidth * escala));
  const alto = Math.max(1, Math.round(img.naturalHeight * escala));
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Este navegador no permite procesar la foto.');
  ctx.drawImage(img, 0, 0, ancho, alto);
  let datos = '';
  for (const calidad of [0.7, 0.55, 0.4, 0.3]) {
    datos = canvas.toDataURL('image/jpeg', calidad);
    if (datos.length <= TAMANO_MAXIMO) break;
  }
  if (datos.length > TAMANO_MAXIMO) throw new Error('La foto es demasiado pesada incluso comprimida. Intenta con otra.');
  return {
    id: generarId('foto'),
    hash: await calcularSha256(datos),
    datos,
    ancho,
    alto,
    bytes: Math.round(((datos.length - datos.indexOf(',') - 1) * 3) / 4),
    tomadaEn: new Date().toISOString()
  };
}

/**
 * Fotos vigentes de una orden (operador). Las vencidas ya no aparecen porque Firestore las borró.
 */
export function escucharFotosOrden(
  granjaId: string,
  ordenId: string,
  onUpdate: (fotos: FotoEntrega[]) => void,
  onError?: (err: any) => void
): () => void {
  return onSnapshot(
    query(collection(db, 'fotosEntrega'), where('granjaId', '==', granjaId), where('ordenId', '==', ordenId)),
    (snap) => onUpdate(snap.docs.map((d) => d.data() as FotoEntrega)),
    (err) => {
      console.error('Error escuchando fotos de entrega:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Comprueba que la foto guardada sea la misma que registró el repartidor (hash del evento)
 */
export async function verificarFoto(foto: FotoEntrega, hashEvento?: string): Promise<boolean> {
  const hash = await calcularSha256(foto.datos);
  return hash === foto.hash && (!hashEvento || hashEvento === foto.hash);
}
