import type { Transition, Variants } from 'motion/react';

/**
 * Tokens de movimiento para la librería `motion`. Deben coincidir con src/styles/motion.css.
 * Solo se animan transform (x, y, scale) y opacity.
 */
export const DURACION = {
  rapida: 0.15, // hover, toque
  base: 0.22, // pestañas, interruptores, menús
  entrada: 0.32, // pantallas, modales
  salida: 0.18, // siempre más corta que la entrada
  reducido: 0.12
} as const;

export const CURVA = {
  entrada: [0.22, 1, 0.36, 1] as [number, number, number, number],
  salida: [0.4, 0, 1, 1] as [number, number, number, number]
};

/** Resorte de los indicadores (pestañas, control segmentado): suave y sin rebote visible */
export const RESORTE: Transition = { type: 'spring', stiffness: 400, damping: 35 };

export const DISTANCIA = { pequena: 8, tarjeta: 12, pantalla: 16 } as const;

/** Escalonado de listas: 40 ms por elemento, solo los primeros 8 */
export const ESCALON = 0.04;
export const MAX_ESCALONADOS = 8;
export const retrasoEscalonado = (i: number) => (i < MAX_ESCALONADOS ? i * ESCALON : 0);

export const entrada = (duracion: number = DURACION.entrada): Transition => ({ duration: duracion, ease: CURVA.entrada });
export const salida = (duracion: number = DURACION.salida): Transition => ({ duration: duracion, ease: CURVA.salida });

/** Pantalla o bloque que aparece: opacidad 0 a 1 y 12 px hacia arriba */
export const varPantalla: Variants = {
  oculto: { opacity: 0, y: DISTANCIA.tarjeta },
  visible: { opacity: 1, y: 0, transition: entrada() },
  salida: { opacity: 0, transition: salida(DURACION.rapida) }
};

/** Fila o tarjeta escalonada (pasar el índice como `custom`) */
export const varFila: Variants = {
  oculto: { opacity: 0, y: DISTANCIA.pequena },
  visible: (i: number = 0) => ({ opacity: 1, y: 0, transition: { ...entrada(DURACION.entrada), delay: retrasoEscalonado(i) } }),
  salida: { opacity: 0, transition: salida() }
};

/** Menú desplegable: escala y opacidad desde su esquina */
export const varMenu: Variants = {
  oculto: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: entrada(DURACION.base) },
  salida: { opacity: 0, scale: 0.98, transition: salida(DURACION.rapida) }
};

/** Contenido de pestaña: la anterior sale con fundido y la nueva entra 8 px desde el lado de la navegación */
export const VAR_CONTENIDO_TAB: Variants = {
  entra: (dir: number = 1) => ({ opacity: 0, x: DISTANCIA.pequena * dir }),
  visible: { opacity: 1, x: 0, transition: entrada(DURACION.base) },
  sale: { opacity: 0, transition: salida(DURACION.rapida) }
};
