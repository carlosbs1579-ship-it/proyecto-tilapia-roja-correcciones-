import { ConfiguracionGeneral } from '../types';

export const PRODUCTO_FIJO = 'Tilapia roja entera fresca, limpia (escamada y eviscerada), calibre 450 a 500 g';
export const MODALIDAD_FIJA = 'Tilapia Pro';
export const ORIGEN_FIJO = 'Cultivos Loré, Turbaco, Bolívar';
export const ZONA_HORARIA = 'America/Bogota';

// Granja a la que pertenecen los lotes. Todos los usuarios autorizados de la granja comparten sus lotes.
export const GRANJA_ID_PREDETERMINADA = 'cultivos-lore';

export const CONFIG_DEFAULT: ConfiguracionGeneral = {
  estanques: [
    { codigo: 'E1', nombre: 'Estanque 1 (Tierra)', volumenM3: 250 },
    { codigo: 'E2', nombre: 'Estanque 2 (Geomembrana)', volumenM3: 250 }
  ],
  rangosReferencia: {
    temperaturaMin: 25,
    temperaturaMax: 32,
    oxigenoMin: 4,
    phMin: 6.5,
    phMax: 8.5,
    amonioMax: 1.0,
    nitritosMax: 0.1,
    secchiMin: 30,
    secchiMax: 40
  },
  fichaNutricional: {
    porcionG: 100,
    energiaKcal: 96,
    proteinaG: 20.1,
    grasaTotalG: 1.7,
    carbohidratosG: 0,
    colesterolMg: 50,
    sodioMg: 52,
    fuente: 'USDA FoodData Central (referencial)',
    notas: 'Valores referenciales promedio por 100 g de filete/carne cruda de tilapia.'
  }
};

/**
 * Obtiene la fecha actual en zona horaria America/Bogota en formato YYYY-MM-DD
 */
export function getFechaHoyBogota(): string {
  const ahora = new Date();
  const formateador = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formateador.format(ahora);
}

/**
 * Formatea una fecha YYYY-MM-DD a formato compacto AAAAMMDD
 */
export function compactarFecha(fecha: string): string {
  return fecha.replace(/-/g, '');
}

/**
 * Formato amigable de fecha y hora en Colombia
 */
export function formatearFechaColombia(fechaIsoOString: string | undefined): string {
  if (!fechaIsoOString) return '-';
  try {
    const d = new Date(fechaIsoOString);
    if (isNaN(d.getTime())) return fechaIsoOString;
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: ZONA_HORARIA,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: fechaIsoOString.includes('T') ? '2-digit' : undefined,
      minute: fechaIsoOString.includes('T') ? '2-digit' : undefined,
    }).format(d);
  } catch {
    return fechaIsoOString;
  }
}
