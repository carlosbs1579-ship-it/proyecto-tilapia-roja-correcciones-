import React, { useEffect, useRef } from 'react';

/**
 * Indica si la vista se está dibujando por primera vez. Las entradas escalonadas solo se aplican
 * en ese momento, no cada vez que cambia un dato o un filtro.
 */
export function usePrimerMontaje(listo: boolean = true): boolean {
  const primero = useRef(true);
  useEffect(() => {
    if (listo) primero.current = false;
  }, [listo]);
  return primero.current;
}

/** Clase y retraso de una fila escalonada (40 ms por fila, solo las 8 primeras) */
export function escalon(i: number, activo: boolean): { className: string; style?: React.CSSProperties } {
  if (!activo || i >= 8) return { className: '' };
  return { className: 'fila-escalonada', style: { ['--i' as string]: i } as React.CSSProperties };
}
