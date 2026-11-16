// SOLO EMULADOR. Sustituye a src/firebase/firebaseConfig.ts al empaquetar las pruebas de
// alteración: misma base con nombre, pero conectada a los emuladores del agente 2 (8185 y 9199).
// Nunca apunta a producción: si no hay emulador, las llamadas fallan por conexión.
import { initializeApp, getApps, getApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

export const PROYECTO = 'iron-outpost-cw2pc';
export const BASE = 'ai-studio-33039dd2-b725-497c-80b6-eb6761337ba9';
export const PUERTO_FIRESTORE = Number(process.env.PUERTO_FIRESTORE || 8185);
export const PUERTO_AUTH = Number(process.env.PUERTO_AUTH || 9199);

export const firebaseConfig = { apiKey: 'demo-clave', authDomain: 'localhost', projectId: PROYECTO, appId: 'demo', firestoreDatabaseId: BASE };
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app, BASE);
export const auth = getAuth(app);
connectAuthEmulator(auth, `http://127.0.0.1:${PUERTO_AUTH}`, { disableWarnings: true });
connectFirestoreEmulator(db, '127.0.0.1', PUERTO_FIRESTORE);

export enum OperationType { CREATE = 'create', UPDATE = 'update', DELETE = 'delete', LIST = 'list', GET = 'get', WRITE = 'write' }
export function handleFirestoreError(error: unknown): never {
  throw error instanceof Error ? error : new Error(String(error));
}
