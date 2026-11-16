import { initializeApp, getApps, getApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { type Firestore, connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import firebaseConfigFile from '../../firebase-applet-config.json';

// Si no existieran credenciales, se pueden configurar aquí
export const fallbackFirebaseConfig = {
  apiKey: "TU_API_KEY_AQUI",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto",
  storageBucket: "tu-proyecto.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456",
  firestoreDatabaseId: "(default)",
};

const activeConfig = firebaseConfigFile && firebaseConfigFile.projectId && firebaseConfigFile.projectId !== 'TU_PROJECT_ID'
  ? firebaseConfigFile
  : fallbackFirebaseConfig;

export const firebaseConfig = activeConfig;

const app = getApps().length === 0 ? initializeApp(activeConfig) : getApp();

// Conectar con la base de datos Firestore especificada.
// Se usa getFirestore directo según la especificación oficial de la integración para evitar bloqueos en iframes.
const databaseId = activeConfig.firestoreDatabaseId && activeConfig.firestoreDatabaseId !== '(default)'
  ? activeConfig.firestoreDatabaseId
  : undefined;

function iniciarFirestore(): Firestore {
  try {
    return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  } catch {
    return getFirestore(app);
  }
}

export const db = iniciarFirestore();

export const auth = getAuth(app);

// Solo en desarrollo local (npm run dev con VITE_EMULADORES=true): usa los emuladores de Auth y
// Firestore para probar sin tocar los datos reales. En la versión publicada nunca se activa.
if (import.meta.env.DEV && import.meta.env.VITE_EMULADORES === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
}
