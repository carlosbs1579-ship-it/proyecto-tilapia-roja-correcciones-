import { EventoLote, ResumenLote, RangosReferenciaAgua } from '../types';
import { getFechaHoyBogota } from '../utils/constants';

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
