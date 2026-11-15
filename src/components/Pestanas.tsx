import React, { useEffect, useRef, useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { RESORTE } from '../lib/motion';

export interface ItemPestana<T extends string> {
  id: T;
  etiqueta: string;
  icono?: React.ReactNode;
}

/**
 * Pestañas con un indicador compartido que se desliza de una a otra (resorte de los tokens).
 * - variante "subrayado": línea bajo la pestaña activa (barra principal).
 * - variante "pildora": fondo tinta detrás de la activa (subpestañas y filtros).
 * Si no caben, se deslizan en horizontal con un desvanecido en el borde y la activa se lleva a la vista.
 */
export function Pestanas<T extends string>({
  items,
  activo,
  onCambio,
  idIndicador,
  variante = 'pildora',
  tono = 'claro',
  etiqueta,
  className = ''
}: {
  items: ItemPestana<T>[];
  activo: T;
  onCambio: (id: T) => void;
  idIndicador: string;
  variante?: 'subrayado' | 'pildora';
  tono?: 'claro' | 'oscuro';
  etiqueta?: string;
  className?: string;
}) {
  const reducido = useReducedMotion();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const franja = useRef<HTMLDivElement>(null);
  // El desvanecido solo aparece en el borde donde hay pestañas ocultas
  const [bordes, setBordes] = useState({ izq: false, der: false });
  const medir = () => {
    const el = franja.current;
    if (!el) return;
    setBordes({ izq: el.scrollLeft > 2, der: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(() => {
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [items.length]);

  // La pestaña activa se desplaza sola a la vista cuando la franja se desliza
  useEffect(() => {
    refs.current[activo]?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reducido ? 'auto' : 'smooth' });
  }, [activo, reducido]);

  const colorTexto = (sel: boolean) =>
    tono === 'oscuro'
      ? sel
        ? 'text-white'
        : 'text-slate-300 hover:text-white'
      : variante === 'pildora'
      ? sel
        ? 'text-white'
        : 'text-slate-600 hover:text-slate-900'
      : sel
      ? 'text-slate-900'
      : 'text-slate-600 hover:text-slate-900';

  return (
    <LayoutGroup id={idIndicador}>
      <div
        ref={franja}
        onScroll={medir}
        data-borde-izq={bordes.izq || undefined}
        data-borde-der={bordes.der || undefined}
        role="tablist"
        aria-label={etiqueta}
        className={`flex overflow-x-auto sin-barra borde-desvanecido ${variante === 'pildora' ? 'gap-1' : ''} ${className}`}
      >
        {items.map((it) => {
          const sel = it.id === activo;
          return (
            <button
              key={it.id}
              ref={(el) => {
                refs.current[it.id] = el;
              }}
              type="button"
              role="tab"
              aria-selected={sel}
              onClick={() => onCambio(it.id)}
              className={`pestana relative shrink-0 whitespace-nowrap inline-flex items-center gap-2 ${
                variante === 'subrayado' ? 'rotulo h-full min-h-11 px-2 lg:px-3' : 'min-h-10 px-3 text-sm rounded-md'
              } ${colorTexto(sel)} ${sel && variante === 'pildora' ? 'font-semibold' : ''}`}
            >
              {sel && (
                <motion.span
                  layoutId={`${idIndicador}-indicador`}
                  transition={reducido ? { duration: 0 } : RESORTE}
                  aria-hidden="true"
                  className={
                    variante === 'subrayado'
                      ? 'absolute inset-x-0 bottom-0 h-0.5 bg-amber-400'
                      : `absolute inset-0 rounded-md ${tono === 'oscuro' ? 'bg-slate-700' : 'bg-slate-900'}`
                  }
                />
              )}
              <span className="relative inline-flex items-center gap-2">
                {it.icono}
                {it.etiqueta}
              </span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
