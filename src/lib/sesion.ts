import { type Auth, browserLocalPersistence, browserSessionPersistence, setPersistence } from 'firebase/auth';

/**
 * Dónde se guarda la sesión (decisión del usuario, 2026-11-20):
 * - Quien tiene la función de repartidor la conserva al cerrar el navegador: así puede volver a abrir
 *   la app en el teléfono sin señal y seguir registrando entregas.
 * - El resto la pierde al cerrar el navegador (o la pestaña), para que en un computador compartido
 *   no quede abierta la cuenta de otra persona.
 *
 * Todo ingreso nuevo empieza como sesión de navegador; cuando se conoce el perfil se pasa a
 * "conservar" solo si tiene la función de repartidor. setPersistence con una sesión abierta la
 * traslada al nuevo almacenamiento sin cerrarla.
 */
type Modo = 'navegador' | 'conservar';
let modoActual: Modo | null = null;

async function aplicar(auth: Auth, modo: Modo): Promise<void> {
  if (modoActual === modo) return;
  try {
    await setPersistence(auth, modo === 'conservar' ? browserLocalPersistence : browserSessionPersistence);
    modoActual = modo;
  } catch (err) {
    // Sin almacenamiento disponible (p. ej. navegación privada estricta) se queda la que hay
    console.warn('No se pudo ajustar dónde se guarda la sesión:', err);
  }
}

/** Al cargar la app sin nadie conectado: los ingresos nuevos empiezan como sesión de navegador */
export async function prepararIngreso(auth: Auth): Promise<void> {
  await auth.authStateReady();
  if (!auth.currentUser) await aplicar(auth, 'navegador');
}

/** Con el perfil ya cargado: conserva la sesión solo si la persona puede actuar como repartidor */
export function ajustarSesionSegunFunciones(auth: Auth, puedeSerRepartidor: boolean): Promise<void> {
  return aplicar(auth, puedeSerRepartidor ? 'conservar' : 'navegador');
}

/** Al cerrar sesión: el siguiente ingreso vuelve a empezar como sesión de navegador */
export function sesionCerrada(auth: Auth): Promise<void> {
  return aplicar(auth, 'navegador');
}
