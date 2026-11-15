import React from 'react';

/**
 * Esqueletos de carga con la forma del contenido real. El brillo es un reflejo que cruza
 * de izquierda a derecha en 1,5 s (solo transform). Con movimiento reducido queda quieto.
 */
export const Bloque: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span aria-hidden="true" className={`esqueleto block rounded bg-slate-100 ${className}`} />
);

/** Tabla: cabecera y filas con barras de distinto ancho y una etiqueta a la derecha */
export const EsqueletoTabla: React.FC<{ filas?: number; columnas?: number }> = ({ filas = 5, columnas = 6 }) => (
  <div role="status" aria-label="Cargando" className="divide-y divide-slate-100">
    {Array.from({ length: filas }).map((_, i) => (
      <div key={i} className="flex items-center gap-6 px-5 h-[52px]">
        <Bloque className="h-3.5 w-28" />
        {Array.from({ length: columnas - 2 }).map((__, j) => (
          <Bloque key={j} className={`h-3 ${j % 2 ? 'w-14' : 'w-20'} hidden sm:block`} />
        ))}
        <Bloque className="h-6 w-20 ml-auto" />
      </div>
    ))}
  </div>
);

/** Tarjetas de indicadores: rótulo y cifra */
export const EsqueletoIndicadores: React.FC<{ cantidad?: number }> = ({ cantidad = 4 }) => (
  <div role="status" aria-label="Cargando" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
    {Array.from({ length: cantidad }).map((_, i) => (
      <div key={i} className="bg-white rounded-xl p-5 border border-slate-200 space-y-3">
        <Bloque className="h-3 w-2/5" />
        <Bloque className="h-7 w-3/5" />
        <Bloque className="h-3 w-1/2" />
      </div>
    ))}
  </div>
);

/** Tarjetas de lista (órdenes, entregas, personas) de alto fijo */
export const EsqueletoTarjetas: React.FC<{ cantidad?: number; alto?: string; avatar?: boolean }> = ({
  cantidad = 3,
  alto = 'h-24',
  avatar = false
}) => (
  <div role="status" aria-label="Cargando" className="space-y-3">
    {Array.from({ length: cantidad }).map((_, i) => (
      <div key={i} className={`bg-white rounded-xl border border-slate-200 px-4 flex items-center gap-4 ${alto}`}>
        {avatar && <Bloque className="h-9 w-9 rounded-full shrink-0" />}
        <div className="flex-1 space-y-3">
          <Bloque className="h-3.5 w-1/2" />
          <Bloque className="h-3 w-3/4" />
        </div>
        <Bloque className="h-6 w-16 shrink-0" />
      </div>
    ))}
  </div>
);

/** Pantalla genérica mientras carga una pestaña */
export const EsqueletoPantalla: React.FC = () => (
  <div className="space-y-6" role="status" aria-label="Cargando">
    <div className="space-y-2">
      <Bloque className="h-7 w-64" />
      <Bloque className="h-3.5 w-80 max-w-full" />
    </div>
    <EsqueletoIndicadores />
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <EsqueletoTabla filas={5} />
    </div>
  </div>
);
