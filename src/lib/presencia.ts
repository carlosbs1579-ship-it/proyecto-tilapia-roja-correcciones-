import { useEffect, useRef, useState } from 'react';

const SALIDA_MS = 180; // = --mov-salida (src/styles/motion.css)

/**
 * Mantiene montada una ventana mientras termina su animación de salida.
 * `montado` indica si se dibuja; `saliendo` activa los estilos de salida (`data-saliendo`).
 */
export function usePresencia(abierto: boolean, ms: number = SALIDA_MS): { montado: boolean; saliendo: boolean } {
  const [montado, setMontado] = useState(abierto);
  useEffect(() => {
    if (abierto) {
      setMontado(true);
      return;
    }
    if (!montado) return;
    const t = setTimeout(() => setMontado(false), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);
  // `saliendo` se deriva del estado montado y no de un efecto: así el primer render tras cerrar ya
  // lleva los estilos de salida sobre el mismo elemento y no se dibuja un cuadro intermedio
  return { montado: abierto || montado, saliendo: !abierto && montado };
}

/**
 * Conserva el último valor no nulo durante la salida de una ventana, para que su contenido
 * no desaparezca antes de terminar de desvanecerse.
 */
export function useConservar<T>(valor: T | null, ms: number = SALIDA_MS): T | null {
  const ultimo = useRef<T | null>(valor);
  const [, forzar] = useState(0);
  if (valor !== null) ultimo.current = valor;
  useEffect(() => {
    if (valor !== null) return;
    const t = setTimeout(() => {
      ultimo.current = null;
      forzar((n) => n + 1);
    }, ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return valor ?? ultimo.current;
}
