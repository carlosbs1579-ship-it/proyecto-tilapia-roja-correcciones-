import React, { useEffect, useRef } from 'react';

/**
 * Comportamiento común de las ventanas (role="dialog"): Escape cierra, tocar el velo cierra
 * (si se permite), el foco entra al abrir y vuelve al disparador al cerrar, Tab queda atrapado
 * y la página de fondo no se desplaza mientras haya alguna ventana abierta.
 *
 * Uso: `const ventana = useVentana(isOpen, onClose, { bloqueada: guardando });`
 * y en el velo `<div {...ventana.propsVelo} role="dialog" aria-modal="true" className="velo ...">`.
 * Se llama antes de cualquier `return null`. No anima nada: las entradas y salidas siguen en
 * `.velo` y `data-saliendo`, así que respeta el movimiento reducido igual que hoy.
 */

interface OpcionesVentana {
  /** Mientras es verdadero (por ejemplo, guardando), ni Escape ni el velo cierran la ventana */
  bloqueada?: boolean;
  /** Tocar el velo cierra la ventana (verdadero por defecto; falso en formularios largos) */
  cerrarAlTocarVelo?: boolean;
}

const SELECTOR_ENFOCABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

// Pila de ventanas abiertas: solo la de arriba responde a Escape y atrapa Tab
const pila: symbol[] = [];

// Contador de ventanas que bloquean el scroll del body (permite ventanas anidadas)
let bloqueos = 0;
let estiloPrevio: { overflow: string; paddingRight: string } | null = null;

function bloquearScroll() {
  bloqueos += 1;
  if (bloqueos > 1) return;
  const body = document.body;
  const anchoBarra = window.innerWidth - document.documentElement.clientWidth;
  estiloPrevio = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  body.style.overflow = 'hidden';
  // Compensa la barra de desplazamiento que desaparece para que la página no salte
  if (anchoBarra > 0) body.style.paddingRight = `${anchoBarra}px`;
}

function liberarScroll() {
  bloqueos = Math.max(0, bloqueos - 1);
  if (bloqueos > 0 || !estiloPrevio) return;
  document.body.style.overflow = estiloPrevio.overflow;
  document.body.style.paddingRight = estiloPrevio.paddingRight;
  estiloPrevio = null;
}

function enfocables(raiz: HTMLElement): HTMLElement[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLE)).filter(
    (el) => el.getClientRects().length > 0 && !el.closest('[inert]')
  );
}

export function useVentana(
  abierta: boolean,
  onCerrar: () => void,
  opciones: OpcionesVentana = {}
): {
  propsVelo: {
    ref: React.RefObject<HTMLDivElement | null>;
    tabIndex: number;
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
    onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  };
} {
  const { bloqueada = false, cerrarAlTocarVelo = true } = opciones;
  const ref = useRef<HTMLDivElement | null>(null);
  const cerrarRef = useRef(onCerrar);
  const bloqueadaRef = useRef(bloqueada);
  const pulsoEnVelo = useRef(false);
  cerrarRef.current = onCerrar;
  bloqueadaRef.current = bloqueada;

  useEffect(() => {
    if (!abierta) return;
    const id = Symbol('ventana');
    const disparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pila.push(id);
    bloquearScroll();

    // El foco entra a la ventana: se respeta un autoFocus interno; si no hay, se enfoca el velo
    // (role="dialog") para que el lector de pantalla anuncie la ventana sin abrir el teclado del celular
    const velo = ref.current;
    if (velo && !velo.contains(document.activeElement)) velo.focus({ preventScroll: true });

    const tecla = (e: KeyboardEvent) => {
      if (pila[pila.length - 1] !== id || !ref.current) return;
      if (e.key === 'Escape') {
        if (bloqueadaRef.current) return;
        e.stopPropagation();
        cerrarRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const lista = enfocables(ref.current);
      if (lista.length === 0) {
        e.preventDefault();
        ref.current.focus({ preventScroll: true });
        return;
      }
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const activo = document.activeElement;
      const dentro = activo instanceof Node && ref.current.contains(activo);
      if (e.shiftKey && (activo === primero || activo === ref.current || !dentro)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (activo === ultimo || !dentro)) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', tecla);

    return () => {
      document.removeEventListener('keydown', tecla);
      const i = pila.indexOf(id);
      if (i >= 0) pila.splice(i, 1);
      liberarScroll();
      // Devuelve el foco al botón que abrió la ventana si sigue en la página y el foco quedó perdido
      const activo = document.activeElement;
      const focoPerdido = !activo || activo === document.body || (ref.current?.contains(activo) ?? false);
      if (disparador && disparador.isConnected && focoPerdido) disparador.focus({ preventScroll: true });
    };
  }, [abierta]);

  return {
    propsVelo: {
      ref,
      tabIndex: -1,
      // Solo cierra si el toque empezó y terminó en el velo (no al arrastrar desde un campo)
      onMouseDown: (e) => {
        pulsoEnVelo.current = e.target === e.currentTarget;
      },
      onClick: (e) => {
        const enVelo = pulsoEnVelo.current && e.target === e.currentTarget;
        pulsoEnVelo.current = false;
        if (!enVelo || !abierta || !cerrarAlTocarVelo || bloqueadaRef.current) return;
        cerrarRef.current();
      }
    }
  };
}
