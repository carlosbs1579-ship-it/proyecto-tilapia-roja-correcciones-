import React from 'react';
import { AlertCircle } from 'lucide-react';

const CLAVE_RECARGA = 'cultivos_lore_recarga_paquete';
// Una recarga automática como máximo por minuto: si el paquete sigue sin llegar, se muestra el aviso
const ESPERA_RECARGA_MS = 60_000;

/** Verdadero si el error es la falla al descargar un paquete de código (típico tras un despliegue nuevo) */
export function esFallaDePaquete(error: unknown): boolean {
  const texto = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Unable to preload CSS/i.test(
    texto
  );
}

/**
 * Recarga la página una sola vez para traer los paquetes del despliegue vigente. Devuelve falso si
 * ya se intentó hace poco (o si el navegador no deja guardar la marca), para no entrar en bucle.
 */
export function recargarUnaVez(): boolean {
  try {
    const previa = Number(sessionStorage.getItem(CLAVE_RECARGA) || 0);
    if (previa && Date.now() - previa < ESPERA_RECARGA_MS) return false;
    sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

interface Props {
  children: React.ReactNode;
  /** Ocupa toda la pantalla (ingreso, consulta pública) en lugar del espacio de una pestaña */
  pantallaCompleta?: boolean;
}

interface Estado {
  error: unknown;
  recargando: boolean;
}

/**
 * Atrapa los errores de las partes que se cargan aparte (pestañas, ingreso, consulta pública):
 * en lugar de una página en blanco muestra un aviso con "Recargar".
 */
export class LimiteError extends React.Component<Props, Estado> {
  state: Estado = { error: null, recargando: false };

  static getDerivedStateFromError(error: unknown): Partial<Estado> {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.warn('No se pudo mostrar esta sección:', error);
    if (esFallaDePaquete(error) && recargarUnaVez()) this.setState({ recargando: true });
  }

  render() {
    if (this.state.error === null) return this.props.children;
    if (this.state.recargando) return null;
    const contenido = (
      <div role="alert" className="max-w-md mx-auto bg-white rounded-xl border border-slate-200 shadow-xs p-6 flex items-start gap-3 text-sm text-slate-700">
        <AlertCircle className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-3">
          <div>
            <p className="font-semibold text-slate-900">No se pudo cargar esta sección</p>
            <p className="mt-1 text-xs text-slate-600">
              Puede deberse a la conexión o a una actualización reciente de la aplicación. Recarga la página para continuar.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-xs transition-colors"
          >
            Recargar
          </button>
        </div>
      </div>
    );
    return this.props.pantallaCompleta ? <div className="min-h-dvh bg-slate-50 grid place-items-center p-4">{contenido}</div> : contenido;
  }
}
