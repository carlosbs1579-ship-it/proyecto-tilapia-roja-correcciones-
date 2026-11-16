import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MoreHorizontal } from 'lucide-react';
import { varMenu } from '../lib/motion';
import { correoDeFirma, firmaEsCorreo, quienRegistro } from '../services/usuariosService';

/**
 * Interruptor accesible (role="switch"): el círculo se desliza en 200 ms y el fondo cambia suave.
 */
export const Interruptor: React.FC<{
  activo: boolean;
  onCambio: () => void;
  deshabilitado?: boolean;
  etiqueta: string;
  indeterminado?: boolean;
}> = ({ activo, onCambio, deshabilitado, etiqueta, indeterminado }) => (
  <button
    type="button"
    role="switch"
    aria-checked={indeterminado ? 'mixed' : activo}
    aria-label={etiqueta}
    disabled={deshabilitado}
    onClick={onCambio}
    className={`interruptor relative inline-flex shrink-0 h-6 w-10 rounded-full disabled:opacity-40 disabled:cursor-not-allowed ${
      activo ? 'bg-slate-900' : indeterminado ? 'bg-slate-500' : 'bg-slate-300'
    }`}
  >
    <span
      aria-hidden="true"
      className={`interruptor-circulo absolute top-1 left-1 h-4 w-4 rounded-full bg-white ${
        activo ? 'translate-x-4' : indeterminado ? 'translate-x-2' : 'translate-x-0'
      }`}
    />
  </button>
);

// Tonos de la paleta para los avatares (derivados de las escalas existentes, sin colores nuevos)
const TONOS_AVATAR = [
  'bg-sky-100 text-sky-900',
  'bg-emerald-100 text-emerald-900',
  'bg-amber-100 text-amber-900',
  'bg-indigo-100 text-indigo-900',
  'bg-slate-200 text-slate-800'
];

function iniciales(nombre: string): string {
  const partes = nombre
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter((p) => p && !/^(jr|sr|ii|iii|iv)$/i.test(p));
  const letras = [partes[0], partes.length > 1 ? partes[partes.length - 1] : ''].map((p) => (p ? Array.from(p)[0] : ''));
  return letras.join('').toUpperCase() || '?';
}

/** Avatar circular con iniciales; el tono se deriva del identificador para que sea estable */
export const AvatarIniciales: React.FC<{ nombre: string; semilla: string; tamano?: string }> = ({ nombre, semilla, tamano = 'h-10 w-10 text-sm' }) => {
  let h = 0;
  for (const c of semilla) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span aria-hidden="true" className={`inline-grid place-items-center rounded-full font-semibold shrink-0 ${tamano} ${TONOS_AVATAR[h % TONOS_AVATAR.length]}`}>
      {iniciales(nombre)}
    </span>
  );
};

export interface AccionMenu {
  etiqueta: string;
  onClick: () => void;
  peligro?: boolean;
  deshabilitado?: boolean;
}

/**
 * Menú de tres puntos: se abre con escala y opacidad desde su esquina derecha (hacia arriba si no
 * cabe debajo) y se cierra al elegir, al tocar fuera o con Escape. Durante la salida no recibe toques.
 */
export const MenuTresPuntos: React.FC<{
  abierto: boolean;
  onAbrir: () => void;
  onCerrar: () => void;
  acciones: AccionMenu[];
  etiqueta: string;
}> = ({ abierto, onAbrir, onCerrar, acciones, etiqueta }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [haciaArriba, setHaciaArriba] = useState(false);
  // El menú que sale conserva sus manejadores; este ref permite ignorar un segundo toque durante la salida
  const abiertoRef = useRef(abierto);
  abiertoRef.current = abierto;
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCerrar();
    };
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    document.addEventListener('pointerdown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('pointerdown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto, onCerrar]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={etiqueta}
        onClick={() => {
          if (abierto) return onCerrar();
          // Altura aproximada del menú: 44 px por opción más el relleno; si no cabe debajo, se abre hacia arriba
          const caja = ref.current?.getBoundingClientRect();
          const alto = acciones.length * 44 + 16;
          setHaciaArriba(!!caja && caja.bottom + alto > window.innerHeight && caja.top - alto > 0);
          onAbrir();
        }}
        className="min-h-11 min-w-11 grid place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
      >
        <MoreHorizontal className="w-5 h-5" strokeWidth={1.75} />
      </button>
      {/* El contenedor no recibe toques mientras el menú sale (pointer-events se hereda) */}
      <div className="contents" style={{ pointerEvents: abierto ? undefined : 'none' }}>
      <AnimatePresence>
        {abierto && (
          <motion.div
            role="menu"
            variants={varMenu}
            initial="oculto"
            animate="visible"
            exit="salida"
            style={{ transformOrigin: haciaArriba ? 'bottom right' : 'top right' }}
            className={`absolute right-0 ${haciaArriba ? 'bottom-full mb-1' : 'top-full mt-1'} z-20 w-56 rounded-lg border border-slate-300 bg-white py-1 shadow-sm`}
          >
            {acciones.map((a) => (
              <button
                key={a.etiqueta}
                type="button"
                role="menuitem"
                disabled={a.deshabilitado}
                onClick={() => {
                  if (!abiertoRef.current) return;
                  abiertoRef.current = false;
                  onCerrar();
                  a.onClick();
                }}
                className={`block w-full text-left px-3 min-h-11 text-sm disabled:opacity-40 ${
                  a.peligro ? 'text-red-700 hover:bg-red-50' : 'text-slate-800 hover:bg-slate-50'
                }`}
              >
                {a.etiqueta}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
};

/**
 * Firma de un registro de lote o anotación en las pantallas internas (H20): el nombre visible y,
 * debajo, el correo de la cuenta. En los registros nuevos la firma guardada es el uid y el correo se
 * resuelve en usuarios/{uid} (solo con sesión); si no hay permiso para leerlo, se muestra solo el nombre.
 */
export const FirmaRegistro: React.FC<{ registro: { registradoPor?: string; registradoPorNombre?: string }; className?: string }> = ({
  registro,
  className = ''
}) => {
  const firma = registro.registradoPor;
  const [correo, setCorreo] = useState<string | null>(firmaEsCorreo(firma) ? firma || null : null);
  useEffect(() => {
    let vigente = true;
    correoDeFirma(firma).then((c) => {
      if (vigente) setCorreo(c);
    });
    return () => {
      vigente = false;
    };
  }, [firma]);
  const nombre = registro.registradoPorNombre || correo || quienRegistro(registro);
  return (
    <span className={className}>
      <span className="firma">{nombre}</span>
      {correo && correo !== nombre && <span className="block text-xs text-slate-500 [overflow-wrap:anywhere]">{correo}</span>}
    </span>
  );
};
