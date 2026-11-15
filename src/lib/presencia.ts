import { useEffect, useRef, useState } from 'react';

const SALIDA_MS = 180; // = --mov-salida (src/styles/motion.css)

/**
 * Mantiene montada una ventana mientras termina su animación de salida.
 * `montado` indica si se dibuja; `saliendo` activa los estilos de salida (`data-saliendo`).
 */
export function usePresencia(abierto: boolean, ms: number = SALIDA_MS): { montado: boolean; saliendo: boolean } {
  const [montado, setMontado] = useState(abierto);
  const [saliendo, setSaliendo] = useState(false);
  useEffect(() => {
    if (abierto) {
      setMontado(true);
      setSaliendo(false);
      return;
    }
    if (!montado) return;
    setSaliendo(true);
    const t = setTimeout(() => {
      setMontado(false);
      setSaliendo(false);
    }, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);
  return { montado: abierto || montado, saliendo: !abierto && saliendo };
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
