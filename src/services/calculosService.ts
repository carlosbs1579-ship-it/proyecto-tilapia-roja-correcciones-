import { EventoLote, ResumenLote, RangosReferenciaAgua, Lote, ConfiguracionGeneral } from '../types';
import { getFechaHoyBogota, PRODUCTO_FIJO, ORIGEN_FIJO, CONFIG_DEFAULT } from '../utils/constants';

/**
 * Evalúa si una lectura individual de calidad de agua está fuera del rango de referencia
 */
export function evaluarParametroAgua(
  parametro: 'temperatura' | 'oxigenoDisuelto' | 'ph' | 'amonioTotal' | 'nitritos' | 'transparenciaSecchi',
  valor: number | undefined | null,
  rangos: RangosReferenciaAgua
): { fueraDeRango: boolean; mensaje: string } {
  if (valor === undefined || valor === null || isNaN(valor)) {
    return { fueraDeRango: false, mensaje: '' };
  }

  switch (parametro) {
    case 'temperatura':
      if (valor < rangos.temperaturaMin || valor > rangos.temperaturaMax) {
        return {
          fueraDeRango: true,
          mensaje: `Temperatura fuera de rango (${rangos.temperaturaMin}°C - ${rangos.temperaturaMax}°C)`
        };
      }
      break;
    case 'oxigenoDisuelto':
      if (valor < rangos.oxigenoMin) {
        return {
          fueraDeRango: true,
          mensaje: `Oxígeno disuelto crítico: menor a ${rangos.oxigenoMin} mg/L`
        };
      }
      break;
    case 'ph':
      if (valor < rangos.phMin || valor > rangos.phMax) {
        return {
          fueraDeRango: true,
          mensaje: `pH fuera de rango óptimo (${rangos.phMin} - ${rangos.phMax})`
        };
      }
      break;
    case 'amonioTotal':
      if (valor > rangos.amonioMax) {
        return {
          fueraDeRango: true,
          mensaje: `Amonio total elevado: supera ${rangos.amonioMax} mg/L`
        };
      }
      break;
    case 'nitritos':
      if (valor > rangos.nitritosMax) {
        return {
          fueraDeRango: true,
          mensaje: `Nitritos tóxicos: supera ${rangos.nitritosMax} mg/L`
        };
      }
      break;
    case 'transparenciaSecchi':
      if (valor < rangos.secchiMin || valor > rangos.secchiMax) {
        return {
          fueraDeRango: true,
          mensaje: `Transparencia Secchi fuera de rango (${rangos.secchiMin} cm - ${rangos.secchiMax} cm)`
        };
      }
      break;
  }

  return { fueraDeRango: false, mensaje: 'Dentro de rango' };
}

/**
 * Calcula la diferencia en días entre dos fechas YYYY-MM-DD
 */
export function calcularDiasEntreFechas(fechaInicio: string, fechaFin: string): number {
  if (!fechaInicio || !fechaFin) return 0;
  const dInicio = new Date(`${fechaInicio}T00:00:00-05:00`);
  const dFin = new Date(`${fechaFin}T00:00:00-05:00`);
  const diffMs = dFin.getTime() - dInicio.getTime();
  const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return dias >= 0 ? dias : 0;
}

/**
 * Recalcula el objeto desnormalizado 'resumen' a partir de los datos base y el arreglo de eventos
 */
export function recalcularResumenLote(params: {
  fechaSiembra: string;
  cantidadSembrada: number;
  pesoInicialPromedioG: number;
  eventos: EventoLote[];
  estado: 'activo' | 'cerrado';
  fechaCierre: string | null;
  volumenEstanqueM3?: number;
  rangos: RangosReferenciaAgua;
}): ResumenLote {
  const {
    fechaSiembra,
    cantidadSembrada,
    pesoInicialPromedioG,
    eventos,
    estado,
    fechaCierre,
    volumenEstanqueM3,
    rangos
  } = params;

  let mortalidadAcumulada = 0;
  let pecesCosechados = 0;
  let biomasaCosechadaKg = 0;
  let alimentoAcumuladoKg = 0;
  let ultimoPesoMuestreoG = pesoInicialPromedioG;
  let alertasAgua = 0;

  // Ordenar cronológicamente si fuera necesario para recorrer
  const eventosOrdenados = [...eventos].sort((a, b) => a.indice - b.indice);

  for (const ev of eventosOrdenados) {
    if (ev.tipo === 'Mortalidad') {
      const cant = Number(ev.datos?.cantidad) || 0;
      mortalidadAcumulada += cant;
    } else if (ev.tipo === 'Cosecha') {
      const peces = Number(ev.datos?.pecesCosechados) || 0;
      const biomasa = Number(ev.datos?.biomasaCosechadaKg) || 0;
      pecesCosechados += peces;
      biomasaCosechadaKg += biomasa;
      if (ev.datos?.pesoPromedioG) {
        ultimoPesoMuestreoG = Number(ev.datos.pesoPromedioG);
      }
    } else if (ev.tipo === 'Alimentación') {
      const cantKg = Number(ev.datos?.cantidadKg ?? ev.datos?.cantidad) || 0;
      alimentoAcumuladoKg += cantKg;
    } else if (ev.tipo === 'Muestreo de crecimiento (biometría)') {
      const pesoProm = Number(ev.datos?.pesoPromedioG ?? ev.datos?.pesoPromedio) || 0;
      if (pesoProm > 0) {
        ultimoPesoMuestreoG = pesoProm;
      }
    } else if (ev.tipo === 'Calidad del agua') {
      // Revisar si algún parámetro está fuera de rango
      const paramsList: Array<'temperatura' | 'oxigenoDisuelto' | 'ph' | 'amonioTotal' | 'nitritos' | 'transparenciaSecchi'> = [
        'temperatura',
        'oxigenoDisuelto',
        'ph',
        'amonioTotal',
        'nitritos',
        'transparenciaSecchi'
      ];
      let hayAlerta = false;
      for (const p of paramsList) {
        const val = ev.datos ? Number(ev.datos[p]) : NaN;
        if (!isNaN(val)) {
          const evalRes = evaluarParametroAgua(p, val, rangos);
          if (evalRes.fueraDeRango) {
            hayAlerta = true;
          }
        }
      }
      if (hayAlerta) {
        alertasAgua++;
      }
    }
  }

  // Peces vivos y supervivencia
  const pecesVivos = Math.max(0, cantidadSembrada - mortalidadAcumulada - pecesCosechados);
  const supervivencia = cantidadSembrada > 0
    ? Math.max(0, Math.min(100, ((cantidadSembrada - mortalidadAcumulada) / cantidadSembrada) * 100))
    : 0;

  const pesoPromedioActualG = ultimoPesoMuestreoG || pesoInicialPromedioG || 0;
  const biomasaEstimadaKg = (pecesVivos * pesoPromedioActualG) / 1000;
  const biomasaInicialKg = (cantidadSembrada * pesoInicialPromedioG) / 1000;

  // FCA = alimentoAcumuladoKg / (biomasaEstimadaKg + biomasaCosechadaKg - biomasaInicialKg)
  // solo si el denominador es mayor que 0
  const gananciaBiomasaTotalKg = (biomasaEstimadaKg + biomasaCosechadaKg) - biomasaInicialKg;
  let FCA: number | null = null;
  if (gananciaBiomasaTotalKg > 0 && alimentoAcumuladoKg > 0) {
    FCA = Number((alimentoAcumuladoKg / gananciaBiomasaTotalKg).toFixed(2));
  }

  // Días de cultivo
  const fechaFinCalculo = (estado === 'cerrado' && fechaCierre) ? fechaCierre : getFechaHoyBogota();
  const diasDeCultivo = calcularDiasEntreFechas(fechaSiembra, fechaFinCalculo);

  // Ganancia diaria en gramos
  let gananciaDiariaG = 0;
  if (diasDeCultivo > 0 && pesoPromedioActualG >= pesoInicialPromedioG) {
    gananciaDiariaG = Number(((pesoPromedioActualG - pesoInicialPromedioG) / diasDeCultivo).toFixed(2));
  }

  // Densidad kg/m3
  let densidadKgM3: number | null = null;
  if (volumenEstanqueM3 && volumenEstanqueM3 > 0) {
    densidadKgM3 = Number((biomasaEstimadaKg / volumenEstanqueM3).toFixed(2));
  }

  const ultimoEv = eventosOrdenados.length > 0 ? eventosOrdenados[eventosOrdenados.length - 1] : null;
  const hashFinal = ultimoEv ? ultimoEv.hash : '';

  return {
    mortalidadAcumulada,
    pecesCosechados,
    pecesVivos,
    supervivencia: Number(supervivencia.toFixed(1)),
    pesoPromedioActualG: Number(pesoPromedioActualG.toFixed(1)),
    biomasaEstimadaKg: Number(biomasaEstimadaKg.toFixed(2)),
    biomasaInicialKg: Number(biomasaInicialKg.toFixed(2)),
    biomasaCosechadaKg: Number(biomasaCosechadaKg.toFixed(2)),
    alimentoAcumuladoKg: Number(alimentoAcumuladoKg.toFixed(2)),
    FCA,
    diasDeCultivo,
    gananciaDiariaG,
    densidadKgM3,
    ultimoEvento: ultimoEv
      ? {
          tipo: ultimoEv.tipo,
          fecha: ultimoEv.fechaEvento
        }
      : null,
    alertasAgua,
    hashFinal
  };
}

// ---------- Cabecera y resumen derivados de la cadena de fases (H02) ----------
// La cabecera del lote (estanque, siembra, peces, peso inicial, proveedor) y el resumen (mortalidad,
// supervivencia, peso, biomasa, alimento) se guardan también como campos sueltos del documento,
// fuera del hash. Lo que se muestra al público y en el certificado se calcula aquí a partir de las
// fases encadenadas: la Siembra (fase #0) más las correcciones de siembra y las fases productivas.
// Si el valor guardado difiere del derivado se informa como posible alteración.

export interface CabeceraLote {
  estanque: string;
  fechaSiembra: string;
  cantidadSembrada: number;
  pesoInicialPromedioG: number;
  proveedorAlevinos: string;
  observacionesIniciales: string;
  producto: string;
  origen: string;
}

export interface DiferenciaLote {
  campo: string;
  etiqueta: string;
  guardado: string;
  derivado: string;
}

export interface LoteDerivado {
  cabecera: CabeceraLote;
  resumen: ResumenLote;
  diferencias: DiferenciaLote[];
  problemas: string[]; // la cadena no permite derivar la cabecera (sin Siembra, sin fases)
}

const PREFIJO_SIEMBRA = 'Siembra inicial del lote en estanque ';
const RAYA_VACIO = String.fromCharCode(0x2014); // raya que escribe la corrección de siembra cuando un valor está vacío
const FLECHA = ` ${String.fromCharCode(0x2192)} `;
const CAMPOS_CORREGIBLES = ['estanque', 'cantidadSembrada', 'pesoInicialPromedioG', 'proveedorAlevinos', 'observacionesIniciales'] as const;
export const normalizarEstanque = (e: unknown) => String(e ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');

/** Valor nuevo de un dato de corrección ("antes, flecha, después"; la raya sola significa vacío) */
function valorNuevoCorreccion(valor: unknown, anterior: string): string {
  const t = String(valor ?? '');
  const prefijo = `${anterior === '' ? RAYA_VACIO : anterior}${FLECHA}`;
  let nuevo = t.startsWith(prefijo) ? t.slice(prefijo.length) : t.includes(FLECHA) ? t.slice(t.indexOf(FLECHA) + FLECHA.length) : t;
  if (nuevo === RAYA_VACIO) nuevo = '';
  return nuevo;
}

/**
 * Cabecera del lote según la cadena: datos de la fase de Siembra y, encima, cada corrección de
 * siembra o piscina en orden. El estanque no está en los datos de la Siembra: se toma de su
 * descripción automática o, si no la tiene, del sufijo del código del lote (que no cambia).
 */
export function derivarCabeceraLote(
  lote: Pick<Lote, 'codigo'> & Partial<Lote>
): { cabecera: CabeceraLote; problemas: string[] } {
  const eventos = lote.eventos || [];
  const problemas: string[] = [];
  const ev0 = eventos[0];
  const guardadoEstanque = String(lote.estanque ?? '');
  const sufijoCodigo = String(lote.codigo || '').split('-').pop() || '';
  const cab: CabeceraLote = {
    estanque: guardadoEstanque,
    fechaSiembra: String(lote.fechaSiembra ?? ''),
    cantidadSembrada: Number(lote.cantidadSembrada) || 0,
    pesoInicialPromedioG: Number(lote.pesoInicialPromedioG) || 0,
    proveedorAlevinos: String(lote.proveedorAlevinos ?? ''),
    observacionesIniciales: String(lote.observacionesIniciales ?? ''),
    producto: PRODUCTO_FIJO,
    origen: ORIGEN_FIJO
  };
  if (!ev0 || ev0.tipo !== 'Siembra') {
    problemas.push(eventos.length ? 'La primera fase registrada no es la siembra.' : 'El lote no tiene fases registradas.');
    return { cabecera: cab, problemas };
  }
  const d = ev0.datos || {};
  const descripcion = String(ev0.descripcion ?? '');
  const automatica = descripcion.startsWith(PREFIJO_SIEMBRA);
  const estanqueSiembra = automatica ? descripcion.slice(PREFIJO_SIEMBRA.length) : sufijoCodigo;
  // El código guarda el estanque limpio (mayúsculas, sin espacios): si coincide, se muestra el guardado
  cab.estanque = normalizarEstanque(guardadoEstanque) === normalizarEstanque(estanqueSiembra) ? guardadoEstanque : estanqueSiembra;
  cab.fechaSiembra = String(ev0.fechaEvento ?? '');
  cab.cantidadSembrada = Number(d.cantidad) || 0;
  cab.pesoInicialPromedioG = Number(d.pesoPromedioInicialG) || 0;
  cab.proveedorAlevinos = String(d.proveedor ?? '').trim();
  cab.observacionesIniciales = automatica ? '' : descripcion.trim();

  for (const ev of eventos.slice(1)) {
    if (ev.tipo !== 'Corrección' || ev.datos?.ambito !== 'siembra') continue;
    for (const k of CAMPOS_CORREGIBLES) {
      if (!(k in (ev.datos || {}))) continue;
      const nuevo = valorNuevoCorreccion(ev.datos[k], String(cab[k]));
      if (k === 'cantidadSembrada' || k === 'pesoInicialPromedioG') cab[k] = Number(nuevo) || 0;
      else if (k === 'estanque') cab.estanque = normalizarEstanque(guardadoEstanque) === normalizarEstanque(nuevo) ? guardadoEstanque : nuevo;
      else cab[k] = nuevo;
    }
  }
  return { cabecera: cab, problemas };
}

const ETIQUETAS_CABECERA: Record<keyof CabeceraLote, string> = {
  estanque: 'Estanque',
  fechaSiembra: 'Fecha de siembra',
  cantidadSembrada: 'Peces sembrados',
  pesoInicialPromedioG: 'Peso inicial promedio (g)',
  proveedorAlevinos: 'Proveedor de alevinos',
  observacionesIniciales: 'Observaciones iniciales',
  producto: 'Producto',
  origen: 'Origen'
};

// Indicadores que dependen solo de la cabecera y de las fases (no de la configuración ni de la fecha)
const ETIQUETAS_RESUMEN: Partial<Record<keyof ResumenLote, string>> = {
  mortalidadAcumulada: 'Mortalidad acumulada',
  pecesCosechados: 'Peces cosechados',
  pecesVivos: 'Peces vivos',
  supervivencia: 'Supervivencia (%)',
  pesoPromedioActualG: 'Peso promedio (g)',
  biomasaEstimadaKg: 'Biomasa estimada (kg)',
  biomasaInicialKg: 'Biomasa inicial (kg)',
  biomasaCosechadaKg: 'Biomasa cosechada (kg)',
  alimentoAcumuladoKg: 'Alimento acumulado (kg)',
  FCA: 'FCA'
};

const comoTexto = (v: unknown) => (v === null || v === undefined || v === '' ? 'vacío' : String(v));

/**
 * Cabecera y resumen calculados desde la cadena, y sus diferencias con lo guardado. Densidad y
 * alertas de agua dependen de la configuración vigente y no se comparan; los días de cultivo y la
 * ganancia diaria solo se comparan en lotes cerrados (en un lote activo cambian cada día).
 */
export function derivarLote(lote: Lote, config: ConfiguracionGeneral = CONFIG_DEFAULT): LoteDerivado {
  const eventos = lote.eventos || [];
  const { cabecera, problemas } = derivarCabeceraLote(lote);
  const cerrado = lote.estado === 'cerrado';
  const estanqueInfo = (config?.estanques || []).find((e) => normalizarEstanque(e.codigo) === normalizarEstanque(cabecera.estanque));
  const resumen = recalcularResumenLote({
    fechaSiembra: cabecera.fechaSiembra,
    cantidadSembrada: cabecera.cantidadSembrada,
    pesoInicialPromedioG: cabecera.pesoInicialPromedioG,
    eventos,
    estado: cerrado ? 'cerrado' : 'activo',
    fechaCierre: lote.fechaCierre || null,
    volumenEstanqueM3: estanqueInfo?.volumenM3,
    rangos: config?.rangosReferencia || CONFIG_DEFAULT.rangosReferencia
  });

  const diferencias: DiferenciaLote[] = [];
  if (!problemas.length) {
    const guardado: Record<keyof CabeceraLote, unknown> = {
      estanque: lote.estanque,
      fechaSiembra: lote.fechaSiembra,
      cantidadSembrada: lote.cantidadSembrada,
      pesoInicialPromedioG: lote.pesoInicialPromedioG,
      proveedorAlevinos: lote.proveedorAlevinos ?? '',
      observacionesIniciales: lote.observacionesIniciales ?? '',
      producto: lote.producto,
      origen: lote.origen
    };
    for (const k of Object.keys(ETIQUETAS_CABECERA) as (keyof CabeceraLote)[]) {
      const g = guardado[k];
      const v = cabecera[k];
      const iguales =
        typeof v === 'number'
          ? Math.abs(Number(g) - v) < 1e-9
          : k === 'estanque'
            ? normalizarEstanque(g) === normalizarEstanque(v)
            : String(g ?? '').trim() === String(v ?? '').trim();
      if (!iguales) diferencias.push({ campo: k, etiqueta: ETIQUETAS_CABECERA[k], guardado: comoTexto(g), derivado: comoTexto(v) });
    }
    const r = (lote.resumen || {}) as Partial<ResumenLote>;
    const etiquetasResumen: Partial<Record<keyof ResumenLote, string>> = cerrado
      ? { ...ETIQUETAS_RESUMEN, diasDeCultivo: 'Días de cultivo', gananciaDiariaG: 'Ganancia diaria (g)' }
      : ETIQUETAS_RESUMEN;
    for (const k of Object.keys(etiquetasResumen) as (keyof ResumenLote)[]) {
      const g = r[k] as unknown;
      const v = resumen[k] as unknown;
      const iguales =
        v === null || g === null || g === undefined ? (g ?? null) === (v ?? null) : Math.abs(Number(g) - Number(v)) < 1e-6;
      if (!iguales) diferencias.push({ campo: `resumen.${k}`, etiqueta: etiquetasResumen[k]!, guardado: comoTexto(g), derivado: comoTexto(v) });
    }
  }
  return { cabecera, resumen, diferencias, problemas };
}
