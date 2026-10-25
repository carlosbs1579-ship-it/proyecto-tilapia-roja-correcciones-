import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { ConfiguracionGeneral, EstanqueConfig } from '../types';
import { CONFIG_DEFAULT } from '../utils/constants';

const CONFIG_LOCAL_KEY = 'cultivos_lore_config_local';

function getConfigLocal(): ConfiguracionGeneral {
  try {
    const raw = localStorage.getItem(CONFIG_LOCAL_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return CONFIG_DEFAULT;
}

function guardarConfigLocal(config: ConfiguracionGeneral): void {
  try {
    localStorage.setItem(CONFIG_LOCAL_KEY, JSON.stringify(config));
  } catch {}
}

/**
 * Sanitiza los estanques para asegurar que no tengan valores 'undefined'
 * que harían fallar a Firebase Firestore con 'Unsupported field value: undefined'.
 */
export function sanitizarEstanques(estanques: EstanqueConfig[]): EstanqueConfig[] {
  if (!Array.isArray(estanques)) return [];
  return estanques.map((est) => {
    const codigo = (est.codigo || '').trim().toUpperCase().replace(/[^a-zA-Z0-9_-]/g, '');
    const nombre = (est.nombre || `Estanque ${codigo}`).trim();
    const volumen = typeof est.volumenM3 === 'number' && !isNaN(est.volumenM3) && est.volumenM3 > 0
      ? est.volumenM3
      : 250;
    return {
      codigo: codigo || 'E1',
      nombre,
      volumenM3: volumen
    };
  });
}

/**
 * Obtiene la configuración general con fallback local resiliente
 */
export async function getConfiguracion(): Promise<ConfiguracionGeneral> {
  try {
    const configDocRef = doc(db, 'configuracion', 'general');
    const snap = await getDoc(configDocRef);
    if (snap.exists()) {
      const data = snap.data() as ConfiguracionGeneral;
      const dataSaneada: ConfiguracionGeneral = {
        ...data,
        estanques: sanitizarEstanques(data.estanques !== undefined ? data.estanques : CONFIG_DEFAULT.estanques)
      };
      guardarConfigLocal(dataSaneada);
      return dataSaneada;
    }
  } catch (error) {
    console.warn('Configuración Firestore en modo local:', error);
  }
  return getConfigLocal();
}

/**
 * Suscribe un listener en tiempo real para cambios de configuración
 */
export function escucharConfiguracion(
  onUpdate: (config: ConfiguracionGeneral) => void,
  onError?: (error: any) => void
): () => void {
  // Emitir valor inicial local
  onUpdate(getConfigLocal());

  const configDocRef = doc(db, 'configuracion', 'general');
  return onSnapshot(
    configDocRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data() as ConfiguracionGeneral;
        const saneada: ConfiguracionGeneral = {
          ...data,
          estanques: sanitizarEstanques(data.estanques !== undefined ? data.estanques : CONFIG_DEFAULT.estanques)
        };
        guardarConfigLocal(saneada);
        onUpdate(saneada);
      }
    },
    (error) => {
      console.warn('Firestore onSnapshot configuracion (usando configuración local):', error?.message || error);
      onUpdate(getConfigLocal());
      if (onError) onError(error);
    }
  );
}

/**
 * Actualiza la configuración general en Firestore y almacena localmente
 */
export async function guardarConfiguracion(
  config: ConfiguracionGeneral,
  userEmail: string
): Promise<ConfiguracionGeneral> {
  const estanquesSaneados = sanitizarEstanques(config.estanques !== undefined ? config.estanques : CONFIG_DEFAULT.estanques);
  const payload: ConfiguracionGeneral = {
    estanques: estanquesSaneados,
    rangosReferencia: config.rangosReferencia || CONFIG_DEFAULT.rangosReferencia,
    fichaNutricional: config.fichaNutricional || CONFIG_DEFAULT.fichaNutricional,
    actualizadoPor: userEmail,
    actualizadoEn: new Date().toISOString()
  };

  const configDocRef = doc(db, 'configuracion', 'general');
  await setDoc(configDocRef, payload, { merge: true });
  guardarConfigLocal(payload);
  return payload;
}
