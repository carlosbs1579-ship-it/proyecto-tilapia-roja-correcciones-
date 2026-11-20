// Empaqueta tests/integridad/ataques.ts con los servicios REALES de src/services, sustituyendo solo
// src/firebase/firebaseConfig.ts por firebase-emulador.ts (emuladores 8185/9199). SOLO EMULADOR.
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const sustituirConfig = {
  name: 'firebase-emulador',
  setup(b) {
    b.onResolve({ filter: /firebase\/firebaseConfig$/ }, () => ({ path: path.join(aqui, 'firebase-emulador.ts') }));
  }
};

await build({
  entryPoints: [path.join(aqui, 'ataques.ts')],
  outfile: path.join(aqui, '.salida', 'ataques.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node20',
  // Origen fijo de los QR (en Node no hay window.location): el mismo que usa la app con VITE_ORIGEN_PUBLICO.
  // VITE_SELLO_TIEMPO_DESDE en el pasado: los lotes y comprobantes de la prueba deben tener sello de tiempo
  define: { 'import.meta.env': JSON.stringify({ DEV: false, PROD: false, VITE_EMULADORES: 'false', VITE_ORIGEN_PUBLICO: 'http://localhost:3000', VITE_SELLO_TIEMPO_DESDE: '2026-01-01' }) },
  plugins: [sustituirConfig],
  logLevel: 'warning'
});
console.log('empaquetado listo');

// El emulador no acepta reglas fuera de su carpeta: se copia firestore.rules tal cual
import { copyFileSync } from 'fs';
copyFileSync(path.join(aqui, '..', '..', 'firestore.rules'), path.join(aqui, 'reglas-copia.rules'));
console.log('reglas copiadas desde firestore.rules');
