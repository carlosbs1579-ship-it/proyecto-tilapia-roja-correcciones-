import { formatearFechaColombia, ZONA_HORARIA } from '../utils/constants';

/**
 * Hora del servidor de un registro (H19) en una sola pieza para todas las pantallas.
 *
 * El criterio no se decide aquí: `desfase` y `sinConexion` llegan ya calculados por
 * horaServidorRegistro / horaServidorBloque / horaServidorEvento (tolerancia de 10 minutos
 * entre la hora declarada por el equipo y la marca del servidor). Este componente solo decide
 * cómo se ve:
 * - modo "aviso": línea propia en ámbar, solo cuando hay desfase o envío sin conexión.
 * - modo "sufijo": en el caso normal, " · servidor 6:37 p. m." dentro de una línea existente,
 *   con la fecha completa en `title`. No agrega líneas al historial.
 * Cada pantalla coloca ambos; como mucho uno de los dos se dibuja.
 */
export interface HoraServidorDatos {
  servidor: Date | null;
  desfase: boolean;
  sinConexion?: boolean;
}

export function horaServidorRelevante(h: HoraServidorDatos): boolean {
  return Boolean(h.servidor) && (h.desfase || Boolean(h.sinConexion));
}

const formatoHora = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA_HORARIA, hour: 'numeric', minute: '2-digit' });

interface Props {
  hora: HoraServidorDatos;
  modo: 'aviso' | 'sufijo';
  /** Rótulo de la línea completa, p. ej. "Hora del servidor" o "Registrado en el servidor". */
  etiqueta?: string;
  /** Texto del desfase; cambia en el comprobante público ("la hora indicada en el comprobante…"). */
  textoDesfase?: string;
  className?: string;
}

export default function HoraServidor({
  hora,
  modo,
  etiqueta = 'Hora del servidor',
  textoDesfase = 'la hora declarada por el equipo difiere en más de 10 minutos',
  className = '',
}: Props) {
  if (!hora.servidor) return null;
  const completa = formatearFechaColombia(hora.servidor.toISOString());
  const relevante = horaServidorRelevante(hora);

  if (modo === 'aviso') {
    if (!relevante) return null;
    return (
      <span className={`block text-xs text-amber-800 ${className}`}>
        {etiqueta}: {completa}
        {hora.desfase ? ` · ${textoDesfase}` : ' · registrado sin conexión en el teléfono y enviado después'}
      </span>
    );
  }

  if (relevante) return null;
  return (
    <span
      className={`text-xs text-slate-500 tabular-nums whitespace-nowrap ${className}`}
      title={`${etiqueta}: ${completa}. Coincide con la hora declarada (diferencia menor a 10 minutos).`}
    >
      {' · '}servidor {formatoHora.format(hora.servidor)}
    </span>
  );
}
