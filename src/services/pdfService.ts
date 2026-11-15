import { Lote, ConfiguracionGeneral, ComprobanteEntrega, BloqueAnulacion } from '../types';
import { construirUrlConsultaEntrega, construirUrlPublicaPdf, generarQrDataUrl } from './qrService';
import { verificarIntegridadLote } from './hashService';
import { quienRegistro } from './usuariosService';
import { doc as docFirestore, getDoc } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { AnotacionesLote } from '../types';
import { anotacionesDe, verificarAnotaciones } from './anotacionesService';
import { nombreDato } from './hashService';
import { formatearFechaColombia, getFechaHoyBogota, ocultarCorreo } from '../utils/constants';
import { evaluarParametroAgua } from './calculosService';
import { logoPngDataUrl } from '../components/LogoLore';


// Las fuentes estándar del PDF solo tienen los caracteres latinos (WinAnsi). Uno fuera de ese
// juego (p. ej. "→" o un emoji en una observación) hace que la línea se escriba con letras
// espaciadas y se salga del recuadro. Todo texto se depura antes de escribirse.
const EXTRA_WINANSI = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function textoPdf(valor: unknown): string {
  return String(valor ?? '')
    .replace(/[→⇒➝➔]/g, '->')
    .replace(/←/g, '<-')
    .replace(/[✓✔]/g, 'OK')
    .split('')
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || EXTRA_WINANSI.includes(ch);
    })
    .join('')
    // Lo que se quita (p. ej. un emoji) no deja dobles espacios
    .replace(/ {2,}/g, ' ');
}

// Nombres legibles de los datos de los eventos en el certificado del lote (los desconocidos quedan igual)
const ETIQUETA_DATO: Record<string, string> = {
  temperatura: 'Temperatura (°C)',
  oxigenoDisuelto: 'Oxígeno disuelto (mg/L)',
  ph: 'pH',
  amonioTotal: 'Amonio total (mg/L)',
  nitritos: 'Nitritos (mg/L)',
  transparenciaSecchi: 'Transparencia Secchi (cm)',
  cantidad: 'Cantidad',
  cantidadKg: 'Alimento (kg)',
  tipoAlimento: 'Tipo de alimento',
  pesoPromedioG: 'Peso promedio (g)',
  pesoPromedioInicialG: 'Peso inicial promedio (g)',
  pecesMuestreados: 'Peces muestreados',
  pecesCosechados: 'Peces cosechados',
  biomasaCosechadaKg: 'Biomasa cosechada (kg)',
  proveedor: 'Proveedor',
  causa: 'Causa',
  cantidadSembrada: 'Cantidad sembrada',
  estanque: 'Estanque',
  pesoInicialPromedioG: 'Peso inicial promedio (g)',
  proveedorAlevinos: 'Proveedor de alevinos',
  observacionesIniciales: 'Observaciones iniciales',
  pctProteina: 'Proteína (%)',
  numeroRaciones: 'Número de raciones',
  pesoInicialG: 'Peso inicial (g)'
};
const OMITIR_DATO = new Set(['ambito']);

// ---------- Diseño común de los PDF (mundo "acta": tinta, filetes finos, oro viejo) ----------
type RGB = [number, number, number];
const C: Record<'tinta' | 'pizarra' | 'gris' | 'filete' | 'fondo' | 'oro' | 'verde' | 'rojo', RGB> = {
  tinta: [22, 33, 58],
  pizarra: [74, 81, 96],
  gris: [93, 100, 112],
  filete: [223, 226, 231],
  fondo: [246, 247, 249],
  oro: [138, 102, 36],
  verde: [34, 95, 70],
  rojo: [179, 38, 30]
};
const MARGEN = 14;

// Rótulo pequeño en versalitas espaciadas
function rotuloPdf(doc: any, texto: string, x: number, y: number) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...C.gris);
  doc.text(textoPdf(texto).toUpperCase(), x, y, { charSpace: 0.35 });
}

// Membrete: logo, nombre en serif, subtítulo espaciado, lugar y fecha a la derecha y doble filete dorado
function membrete(doc: any, logo: string | null, subtitulo: string, derecha?: string[]): number {
  const ancho = doc.internal.pageSize.getWidth();
  const y = 12;
  if (logo) doc.addImage(logo, 'PNG', MARGEN, y, 17, 13);
  const xTexto = logo ? MARGEN + 21 : MARGEN;
  doc.setTextColor(...C.tinta);
  doc.setFont('times', 'normal');
  doc.setFontSize(22);
  doc.text('Cultivos Loré', xTexto, y + 7.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...C.gris);
  doc.text(textoPdf(subtitulo).toUpperCase(), xTexto, y + 12.5, { charSpace: 0.45 });
  doc.setFontSize(7.5);
  const lineas = derecha || ['Turbaco, Bolívar · Colombia', `Generado el ${getFechaHoyBogota()}`];
  lineas.forEach((l, i) => doc.text(textoPdf(l), ancho - MARGEN, y + 6 + i * 4, { align: 'right' }));
  dobleFilete(doc, MARGEN, ancho - MARGEN, y + 17);
  return y + 24;
}

// Título de sección en serif con un filete fino debajo (y una línea opcional de contexto)
function tituloSeccion(doc: any, texto: string, y: number, nota?: string): number {
  const ancho = doc.internal.pageSize.getWidth();
  if (y > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage();
    y = 20;
  }
  doc.setFont('times', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...C.tinta);
  doc.text(textoPdf(texto), MARGEN, y);
  if (nota) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.gris);
    doc.text(textoPdf(nota), ancho - MARGEN, y, { align: 'right' });
  }
  doc.setDrawColor(...C.oro);
  doc.setLineWidth(0.25);
  doc.line(MARGEN, y + 1.8, ancho - MARGEN, y + 1.8);
  return y + 4.5;
}

// Estilo de tabla: encabezado tinta en versalitas, filas con filete fino y fondo alterno muy claro
function estiloTabla(): Record<string, any> {
  return {
    theme: 'plain',
    margin: { left: MARGEN, right: MARGEN, top: 20, bottom: 18 },
    styles: { font: 'helvetica', fontSize: 7.5, textColor: C.tinta, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, lineColor: C.filete, lineWidth: { bottom: 0.15 } },
    headStyles: { fillColor: C.tinta, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7, lineWidth: 0 },
    alternateRowStyles: { fillColor: C.fondo },
    // Un dato que no se registró se muestra como raya, nunca como "undefined"
    willDrawCell: (d: any) => {
      if (d.section === 'body' && /undefined|NaN|null/.test(d.cell.text.join(' '))) d.cell.text = ['Sin dato'];
    }
  };
}

/**
 * Marca de agua diagonal: palabra en serif con letras espaciadas, semitransparente y centrada en la
 * página (jsPDF no centra el texto girado, así que el punto de inicio se calcula a mano).
 */
function marcaDeAgua(doc: any, texto: string, color: RGB) {
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const angulo = 30;
  const rad = (angulo * Math.PI) / 180;
  const tamano = 72;
  const espacio = 4; // mm entre letras
  const palabra = texto.toUpperCase();
  doc.setFont('times', 'normal');
  doc.setFontSize(tamano);
  const largo = doc.getTextWidth(palabra) + espacio * (palabra.length - 1);
  const altoLetra = tamano * 0.3528 * 0.7; // altura de las mayúsculas en mm
  const cx = ancho / 2;
  const cy = alto / 2;
  const x = cx - (largo / 2) * Math.cos(rad) + (altoLetra / 2) * Math.sin(rad);
  const y = cy + (largo / 2) * Math.sin(rad) + (altoLetra / 2) * Math.cos(rad);
  if (doc.GState) doc.setGState(new doc.GState({ opacity: 0.16 }));
  doc.setTextColor(...color);
  doc.text(palabra, x, y, { angle: angulo, charSpace: espacio });
  if (doc.GState) doc.setGState(new doc.GState({ opacity: 1 }));
}

// Pie de todas las páginas: filete dorado, referencia del documento y número de página
function piePaginas(doc: any, referencia: string) {
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...C.oro);
    doc.setLineWidth(0.25);
    doc.line(MARGEN, alto - 12, ancho - MARGEN, alto - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C.gris);
    doc.text(textoPdf(referencia), MARGEN, alto - 8);
    doc.text(`Página ${p} de ${total}`, ancho - MARGEN, alto - 8, { align: 'right' });
  }
}

// Doble filete dorado bajo los encabezados (rasgo de acta del diseño)
function dobleFilete(doc: any, x1: number, x2: number, y: number) {
  doc.setDrawColor(138, 102, 36);
  doc.setLineWidth(0.3);
  doc.line(x1, y, x2, y);
  doc.line(x1, y + 0.9, x2, y + 0.9);
  doc.setLineWidth(0.2);
}

function depurar(valor: any): any {
  if (typeof valor === 'string') return textoPdf(valor);
  if (Array.isArray(valor)) return valor.map(depurar);
  if (valor && typeof valor === 'object' && 'content' in valor) return { ...valor, content: depurar(valor.content) };
  return valor;
}

// jsPDF y autotable (~500 KB) se cargan solo al generar un PDF, no al abrir la aplicación
async function cargarPdf() {
  const [{ default: JsPdfOriginal }, { default: autoTableOriginal }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  // Documento cuyo método text depura el texto (las tablas también escriben con él)
  const jsPDF = function (...args: any[]) {
    const doc = new (JsPdfOriginal as any)(...args);
    const textoOriginal = doc.text.bind(doc);
    doc.text = (texto: any, ...resto: any[]) => textoOriginal(depurar(texto), ...resto);
    return doc;
  } as unknown as typeof JsPdfOriginal;
  const autoTable = ((doc: any, opciones: any) =>
    autoTableOriginal(doc, { ...opciones, head: depurar(opciones.head), body: depurar(opciones.body) })) as typeof autoTableOriginal;
  return { jsPDF, autoTable };
}

/**
 * Genera el documento PDF con jsPDF y jspdf-autotable
 */
export async function generarLotePdfBlob(
  lote: Lote,
  config: ConfiguracionGeneral
): Promise<{ blob: Blob; urlPublica: string }> {
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const urlPublica = construirUrlPublicaPdf(lote.codigo);
  const qrDataUrl = await generarQrDataUrl(urlPublica);
  const resultadoIntegridad = await verificarIntegridadLote(lote);

  // Anotaciones posteriores al cierre (solo las aprobadas aparecen en el certificado)
  let datosAnotaciones: AnotacionesLote | null = null;
  if (lote.estado === 'cerrado') {
    try {
      const snap = await getDoc(docFirestore(db, 'anotacionesLote', lote.codigo));
      datosAnotaciones = snap.exists() ? (snap.data() as AnotacionesLote) : null;
    } catch {
      datosAnotaciones = null;
    }
  }
  const verifAnotaciones = await verificarAnotaciones(lote, datosAnotaciones);
  // Solo las aprobadas e íntegras tienen validez; las alteradas se listan como "sin validez"
  const anotacionesAprobadas = anotacionesDe(datosAnotaciones).filter(
    (a) => a.estado === 'aprobada' && !verifAnotaciones.alteradas.includes(a.numero)
  );
  const anotacionesSinValidez = anotacionesDe(datosAnotaciones).filter((a) => verifAnotaciones.alteradas.includes(a.numero));

  const pageWidth = doc.internal.pageSize.getWidth();
  const M = 14; // margen lateral
  const logo = await logoPngDataUrl('#16213a').catch(() => null);

  // --- 1. MEMBRETE ---
  let currentY = membrete(doc, logo, 'Certificado de trazabilidad del lote · Tilapia roja');

  // --- 2. IDENTIDAD DEL LOTE Y CÓDIGO QR ---
  const anchoQr = 32;
  const xQr = pageWidth - M - anchoQr;
  try {
    doc.addImage(qrDataUrl, 'PNG', xQr, currentY, anchoQr, anchoQr);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...C.gris);
    doc.text('ESCANEE PARA VERIFICAR', xQr + anchoQr / 2, currentY + anchoQr + 3.5, { align: 'center', charSpace: 0.1 });
  } catch (err) {
    console.warn('No se pudo incrustar QR en el PDF:', err);
  }

  doc.setTextColor(...C.tinta);
  doc.setFont('times', 'normal');
  doc.setFontSize(22);
  doc.text(`Lote ${lote.codigo}`, M, currentY + 7);

  // Franja de estado: sellado (tinta) o en cultivo (verde)
  const anchoFranja = xQr - M - 6;
  doc.setFillColor(...(lote.estado === 'cerrado' ? C.tinta : C.verde));
  doc.rect(M, currentY + 10.5, anchoFranja, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(
    lote.estado === 'cerrado' ? `LOTE SELLADO${lote.fechaCierre ? ` · ${lote.fechaCierre}` : ''} · REGISTROS CERRADOS` : 'LOTE EN CULTIVO',
    M + 3,
    currentY + 15.1,
    { charSpace: 0.5 }
  );

  // Ficha de identidad en tres columnas: rótulo pequeño y valor
  const campos: [string, string][] = [
    ['Producto', lote.producto],
    ['Origen', lote.origen],
    ['Estanque', `${lote.estanque}`],
    ['Siembra', lote.fechaSiembra],
    ['Alevinos sembrados', lote.cantidadSembrada.toLocaleString()],
    ['Proveedor de alevinos', lote.proveedorAlevinos || 'No especificado']
  ];
  const anchoCol = anchoFranja / 3;
  campos.forEach(([rotulo, valor], i) => {
    const x = M + (i % 3) * anchoCol;
    const y = currentY + 24 + Math.floor(i / 3) * 10;
    rotuloPdf(doc, rotulo, x, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.tinta);
    doc.text(doc.splitTextToSize(textoPdf(valor), anchoCol - 3)[0], x, y + 4.2);
  });
  currentY += 51;

  // --- 3. INDICADORES PRODUCTIVOS ---
  const r = lote.resumen;
  currentY = tituloSeccion(doc, 'Indicadores productivos', currentY);
  autoTable(doc, {
    ...estiloTabla(),
    startY: currentY,
    head: [['Indicador', 'Valor', 'Indicador', 'Valor']],
    columnStyles: { 1: { fontStyle: 'bold' }, 3: { fontStyle: 'bold' } },
    body: [
      ['Días de cultivo', `${r.diasDeCultivo} días`, 'Supervivencia estimada', `${r.supervivencia}%`],
      ['Peces sembrados', `${lote.cantidadSembrada.toLocaleString()} peces`, 'Mortalidad acumulada', `${r.mortalidadAcumulada.toLocaleString()} peces`],
      ['Peces cosechados', `${r.pecesCosechados.toLocaleString()} peces`, 'Peces vivos actuales', `${r.pecesVivos.toLocaleString()} peces`],
      ['Peso inicial promedio', `${lote.pesoInicialPromedioG} g`, 'Peso promedio actual/final', `${r.pesoPromedioActualG} g`],
      ['Biomasa inicial', `${r.biomasaInicialKg} kg`, 'Biomasa estimada viva', `${r.biomasaEstimadaKg} kg`],
      ['Biomasa cosechada', `${r.biomasaCosechadaKg} kg`, 'Alimento acumulado', `${r.alimentoAcumuladoKg} kg`],
      ['FCA (factor de conversión)', r.FCA !== null ? `${r.FCA}` : 'N/A', 'Ganancia diaria', `${r.gananciaDiariaG} g/día`],
      ['Densidad actual', r.densidadKgM3 !== null ? `${r.densidadKgM3} kg/m³` : 'N/A', 'Alertas de calidad de agua', `${r.alertasAgua} fuera de rango`]
    ]
  });
  currentY = (doc as any).lastAutoTable.finalY + 8;

  // --- 4. CALIDAD DEL AGUA ---
  const eventosAgua = (lote.eventos || []).filter((e) => e.tipo === 'Calidad del agua');
  if (eventosAgua.length > 0) {
    const filasAgua = eventosAgua.map((ev) => {
      const d = ev.datos || {};
      const v = (x: unknown, u = '') => (x !== undefined ? `${x}${u}` : '-');
      const paramsList: Array<'temperatura' | 'oxigenoDisuelto' | 'ph' | 'amonioTotal' | 'nitritos' | 'transparenciaSecchi'> = [
        'temperatura',
        'oxigenoDisuelto',
        'ph',
        'amonioTotal',
        'nitritos',
        'transparenciaSecchi'
      ];
      const fuera = paramsList.filter((p) => {
        const val = Number(d[p]);
        return !isNaN(val) && evaluarParametroAgua(p, val, config.rangosReferencia).fueraDeRango;
      });
      return [
        ev.fechaEvento,
        v(d.temperatura, ' °C'),
        v(d.oxigenoDisuelto, ' mg/L'),
        v(d.ph),
        v(d.amonioTotal, ' mg/L'),
        v(d.nitritos, ' mg/L'),
        v(d.transparenciaSecchi, ' cm'),
        fuera.length ? `Alerta (${fuera.length})` : 'Óptimo',
        quienRegistro(ev, true)
      ];
    });
    currentY = tituloSeccion(doc, 'Calidad del agua', currentY);
    autoTable(doc, {
      ...estiloTabla(),
      startY: currentY,
      head: [['Fecha', 'Temp.', 'O2 dis.', 'pH', 'Amonio', 'Nitritos', 'Secchi', 'Estado', 'Registró']],
      body: filasAgua,
      didParseCell: (d: any) => {
        if (d.section === 'body' && d.column.index === 7 && String(d.cell.raw).startsWith('Alerta')) {
          d.cell.styles.textColor = C.rojo;
          d.cell.styles.fontStyle = 'bold';
        }
      }
    });
    currentY = (doc as any).lastAutoTable.finalY + 8;
  }

  // --- 5. COSECHA, PROCESO, CONSERVACIÓN Y DESPACHO ---
  const eventosPost = (lote.eventos || []).filter((e) =>
    ['Cosecha', 'Proceso', 'Empaque y conservación', 'Despacho/transporte'].includes(e.tipo)
  );
  if (eventosPost.length > 0) {
    const filasPost = eventosPost.map((ev) => {
      let detalle = ev.descripcion || '';
      const d = ev.datos || {};
      if (ev.tipo === 'Cosecha') {
        detalle = `Peces: ${d.pecesCosechados} · Biomasa: ${d.biomasaCosechadaKg} kg · Peso promedio: ${d.pesoPromedioG} g`;
      } else if (ev.tipo === 'Proceso') {
        detalle = `Escamado/eviscerado: ${d.escamadoEviscerado ? 'sí' : 'no'} · Cantidad: ${d.cantidadProcesada} · Peso final: ${d.pesoPromedioFinalG} g · Responsable: ${d.responsable || '-'}`;
      } else if (ev.tipo === 'Empaque y conservación') {
        detalle = `Empaque: ${d.tipoEmpaque || '-'} · Temperatura: ${d.temperaturaConservacionC ?? '-'} °C · Hielo: ${d.usoHielo ? 'sí' : 'no'}`;
      } else if (ev.tipo === 'Despacho/transporte') {
        detalle = `Destino: ${d.destino || '-'} · Salida: ${d.fechaHoraSalida || '-'} · Temperatura: ${d.temperaturaDespachoC ?? '-'} °C · Contenedor con hielo: ${d.contenedorIsotermico ? 'sí' : 'no'} · Responsable: ${d.responsable || '-'}`;
      }
      return [ev.fechaEvento, ev.tipo, detalle, quienRegistro(ev, true)];
    });
    currentY = tituloSeccion(doc, 'Cosecha, proceso y despacho', currentY);
    autoTable(doc, { ...estiloTabla(), startY: currentY, head: [['Fecha', 'Etapa', 'Detalle técnico', 'Registró']], body: filasPost });
    currentY = (doc as any).lastAutoTable.finalY + 8;
  }

  // --- 6. PROBIÓTICOS Y TRATAMIENTOS ---
  const eventosSanitarios = (lote.eventos || []).filter((e) => ['Probióticos', 'Tratamiento o manejo sanitario'].includes(e.tipo));
  if (eventosSanitarios.length > 0) {
    const filasSan = eventosSanitarios.map((ev) => {
      const d = ev.datos || {};
      const det =
        ev.tipo === 'Probióticos'
          ? `Producto: ${d.producto || '-'} · Dosis: ${d.dosis || '-'} ${d.unidad || ''} · Vía: ${d.viaAplicacion || '-'} · Objetivo: ${d.objetivo || '-'}`
          : `Descripción: ${d.descripcion || ev.descripcion || '-'} · Producto: ${d.producto || '-'} · Dosis: ${d.dosis || '-'}`;
      return [ev.fechaEvento, ev.tipo, det, quienRegistro(ev, true)];
    });
    currentY = tituloSeccion(doc, 'Manejo sanitario', currentY);
    autoTable(doc, {
      ...estiloTabla(),
      startY: currentY,
      head: [['Fecha', 'Tipo de manejo', 'Producto, dosis y aplicación', 'Registró']],
      body: filasSan
    });
    currentY = (doc as any).lastAutoTable.finalY + 8;
  }

  // --- 7. HISTORIAL DE FASES ---
  const filasEventos = (lote.eventos || []).map((ev) => {
    let detalleDatos = '';
    if (ev.datos && Object.keys(ev.datos).length > 0) {
      detalleDatos = Object.entries(ev.datos)
        .filter(([k]) => !OMITIR_DATO.has(k))
        .map(([k, v]) => `${ETIQUETA_DATO[k] || k}: ${v}`)
        .join(', ');
    }
    // Anotaciones aprobadas (e íntegras) que se refieren a esta fase
    const notas = anotacionesAprobadas.filter((a) => a.propuesta.datos.fase === ev.indice).map((a) => a.numero);
    const refNotas = notas.length ? `(ver anotación N.º ${notas.join(', ')})` : '';
    const contenido = [ev.descripcion, detalleDatos, refNotas].filter(Boolean).join(' · ');
    return [`#${ev.indice}`, ev.fechaEvento, ev.tipo, contenido || '-', quienRegistro(ev, true), ev.hash.substring(0, 10)];
  });
  currentY = tituloSeccion(doc, 'Historial de fases', currentY);
  autoTable(doc, {
    ...estiloTabla(),
    startY: currentY,
    columnStyles: {
      0: { cellWidth: 9, textColor: C.gris },
      1: { cellWidth: 19 },
      2: { cellWidth: 28, fontStyle: 'bold' },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 32 },
      5: { cellWidth: 22, font: 'courier', fontSize: 6.5, textColor: C.gris }
    },
    head: [['#', 'Fecha', 'Fase', 'Detalle y mediciones', 'Registró', 'Huella SHA-256']],
    body: filasEventos
  });
  currentY = (doc as any).lastAutoTable.finalY + 8;

  // --- 7b. ANOTACIONES POSTERIORES AL CIERRE (no modifican el lote sellado) ---
  if (anotacionesAprobadas.length || anotacionesSinValidez.length) {
    currentY = tituloSeccion(
      doc,
      'Anotaciones posteriores al cierre',
      currentY,
      'Aprobadas por una segunda persona; el registro sellado no se modificó.'
    );
    autoTable(doc, {
      ...estiloTabla(),
      startY: currentY,
      columnStyles: {
        0: { cellWidth: 11 },
        1: { cellWidth: 22 },
        2: { cellWidth: 44 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 34 },
        5: { cellWidth: 22, font: 'courier', fontSize: 6.5, textColor: C.gris }
      },
      head: [['N.º', 'Fase', 'Dato: registrado / correcto', 'Motivo', 'Propuso / aprobó', 'Huella']],
      body: [
        ...anotacionesAprobadas.map((a) => {
          const d = a.propuesta.datos;
          const ev = (lote.eventos || [])[d.fase];
          const registrado = d.dato && ev ? String(ev.datos?.[d.dato] ?? d.valorRegistrado) : d.valorRegistrado;
          return [
            String(a.numero),
            `#${d.fase} ${ev ? ev.tipo : ''}`,
            d.dato ? `${nombreDato(d.dato)}: ${registrado} / ${d.valorCorrecto}` : 'Aclaración general',
            d.motivo,
            `${quienRegistro(a.propuesta, true)} / ${a.resolucion ? quienRegistro(a.resolucion, true) : '-'}\n${formatearFechaColombia(a.resolucion?.fecha || a.propuesta.fecha)}`,
            (a.resolucion?.hash || a.propuesta.hash).slice(0, 10)
          ];
        }),
        ...anotacionesSinValidez.map((a) => [String(a.numero), '', 'ALTERADA después de registrarse: SIN VALIDEZ', '', '', ''])
      ],
      didParseCell: (d: any) => {
        if (d.section === 'body' && String(d.row.raw?.[2] || '').startsWith('ALTERADA')) {
          d.cell.styles.textColor = C.rojo;
          d.cell.styles.fontStyle = 'bold';
        }
      }
    });
    currentY = (doc as any).lastAutoTable.finalY + 8;
  }

  // --- 8. FICHA NUTRICIONAL REFERENCIAL ---
  const fn = config.fichaNutricional;
  if (currentY > doc.internal.pageSize.getHeight() - 70) {
    doc.addPage();
    currentY = 20;
  }
  currentY = tituloSeccion(doc, 'Ficha nutricional referencial', currentY, `Por cada ${fn.porcionG} g de tilapia cruda.`);
  autoTable(doc, {
    ...estiloTabla(),
    startY: currentY,
    head: [['Energía', 'Proteína', 'Grasa total', 'Carbohidratos', 'Colesterol', 'Sodio']],
    body: [[`${fn.energiaKcal} kcal`, `${fn.proteinaG} g`, `${fn.grasaTotalG} g`, `${fn.carbohidratosG} g`, `${fn.colesterolMg} mg`, `${fn.sodioMg} mg`]],
    bodyStyles: { fontStyle: 'bold' }
  });
  currentY = (doc as any).lastAutoTable.finalY + 3;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(...C.gris);
  doc.text(doc.splitTextToSize(textoPdf(`Fuente: ${fn.fuente}. ${fn.notas}`), pageWidth - 2 * M), M, currentY + 2);
  currentY += 9;

  // --- 9. VERIFICACIÓN DE INTEGRIDAD ---
  if (currentY > doc.internal.pageSize.getHeight() - 48) {
    doc.addPage();
    currentY = 20;
  }
  currentY = tituloSeccion(doc, 'Verificación de integridad', currentY);
  const altoCaja = datosAnotaciones?.registros?.length ? 27 : 22;
  doc.setDrawColor(...C.filete);
  doc.setLineWidth(0.2);
  doc.rect(M, currentY, pageWidth - 2 * M, altoCaja);
  doc.setFillColor(...(resultadoIntegridad.valido ? C.verde : C.rojo));
  doc.rect(M, currentY, 1.4, altoCaja, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...(resultadoIntegridad.valido ? C.verde : C.rojo));
  doc.text(
    resultadoIntegridad.valido
      ? `Cadena íntegra: ${lote.eventos?.length || 0} fases encadenadas con SHA-256, sin alteraciones.`
      : `Cadena alterada: falla en la fase #${resultadoIntegridad.primerErrorIndex}.`,
    M + 5,
    currentY + 6
  );
  rotuloPdf(doc, 'Huella final de la cadena', M + 5, currentY + 11.5);
  doc.setFont('courier', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.tinta);
  doc.text(lote.resumen.hashFinal || 'N/A', M + 5, currentY + 15.5);
  let yNota = currentY + 20;
  if (datosAnotaciones?.registros?.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...(verifAnotaciones.integra ? C.verde : C.rojo));
    doc.text(doc.splitTextToSize(textoPdf(`Anotaciones: ${verifAnotaciones.mensaje}`), pageWidth - 2 * M - 10)[0], M + 5, yNota);
    yNota += 4.5;
  }
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(...C.gris);
  doc.text('Este registro documenta cómo se produjo y manejó el lote; no reemplaza los controles de inocuidad.', M + 5, yNota);

  piePaginas(doc, `Cultivos Loré · Certificado del lote ${lote.codigo}`);

  const pdfBlob = doc.output('blob');
  return { blob: pdfBlob, urlPublica };
}

/**
 * Genera el PDF del lote (certificado). No se sube a Firebase Storage: el QR abre la vista pública
 * del lote, que siempre muestra los datos vigentes, y el PDF se genera en el navegador al pedirlo.
 */
export async function generarYSubirPdfLote(
  lote: Lote,
  config: ConfiguracionGeneral
): Promise<{ urlPublica: string; versionPdf: number }> {
  void config;
  return { urlPublica: construirUrlPublicaPdf(lote.codigo), versionPdf: (lote.versionPdf || 0) + 1 };
}

/**
 * Dispara la descarga local directa del PDF para inspección o impresión
 */
export async function descargarPdfLoteLocal(lote: Lote, config: ConfiguracionGeneral): Promise<void> {
  const { blob } = await generarLotePdfBlob(lote, config);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `CultivosLore_Lote_${lote.codigo}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Abre la vista previa del PDF en una nueva pestaña (blob URL)
 */
export async function previsualizarPdfLote(lote: Lote, config: ConfiguracionGeneral): Promise<void> {
  const { blob } = await generarLotePdfBlob(lote, config);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

// ---------- Comprobante de entrega (fase 5) ----------
// Se genera a partir del registro inmutable del comprobante (o del contenido preliminar, que no se
// guarda). Es independiente del certificado del lote: no lo modifica ni toca su hash.

type ContenidoComprobante = Omit<ComprobanteEntrega, 'hashEventos' | 'hashComprobante'> &
  Partial<Pick<ComprobanteEntrega, 'hashEventos' | 'hashComprobante'>>;

const cantidadTexto = (n: number, unidad: string) => `${(Number(n) || 0).toLocaleString('es-CO')} ${unidad}`;

export async function generarComprobantePdfBlob(
  c: ContenidoComprobante,
  opciones: { preliminar: boolean; anulacion?: BloqueAnulacion }
): Promise<Blob> {
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const parcial = c.estadoEntrega === 'entrega_parcial' || c.cantidadPendiente > 0;
  const M = 14;
  const logo = await logoPngDataUrl('#16213a').catch(() => null);
  let y = membrete(
    doc,
    logo,
    opciones.preliminar ? 'Comprobante de entrega · preliminar' : 'Comprobante de entrega',
    ['Turbaco, Bolívar · Colombia', `${opciones.preliminar ? 'Generado' : 'Emitido'} el ${formatearFechaColombia(c.emitidoEn)}`]
  );

  // Identificación del comprobante y QR de consulta
  const anchoQr = 28;
  const conQr = !opciones.preliminar && Boolean(c.tokenConsulta);
  if (conQr) {
    const qr = await generarQrDataUrl(construirUrlConsultaEntrega(c.tokenConsulta!));
    doc.addImage(qr, 'PNG', pageWidth - M - anchoQr, y - 3, anchoQr, anchoQr);
  }
  doc.setFont('times', 'normal');
  doc.setFontSize(21);
  doc.setTextColor(...C.tinta);
  doc.text(opciones.preliminar ? 'Documento preliminar' : `Comprobante N.º ${c.version}`, M, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...C.gris);
  doc.text(
    textoPdf(opciones.preliminar ? `Orden ${c.ordenId} · sin validez como comprobante definitivo` : `Orden ${c.ordenId} · código ${c.id.slice(0, 15)}`),
    M,
    y + 11.5
  );
  y += conQr ? 29 : 17;

  // Estado de la entrega (una parcial nunca se presenta como completa)
  doc.setFillColor(...(opciones.anulacion ? C.rojo : opciones.preliminar ? C.gris : parcial ? C.oro : C.verde));
  doc.rect(M, y, pageWidth - 2 * M, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(
    textoPdf(
      (opciones.anulacion
        ? `Comprobante anulado el ${formatearFechaColombia(opciones.anulacion.emitidoEn)} · sin validez`
        : opciones.preliminar
        ? 'Documento preliminar · la entrega aún no está confirmada'
        : parcial
        ? `Entrega parcial · pendientes ${cantidadTexto(c.cantidadPendiente, c.unidad)}`
        : 'Entrega completa'
      ).toUpperCase()
    ),
    M + 3,
    y + 5.4,
    { charSpace: 0.4 }
  );
  y += 15;

  y = tituloSeccion(doc, 'Cliente y logística', y);
  autoTable(doc, {
    ...estiloTabla(),
    startY: y,
    // Columnas de igual ancho: un nombre de cliente largo no estrecha la de logística
    columnStyles: { 0: { cellWidth: (pageWidth - 2 * M) / 2 }, 1: { cellWidth: (pageWidth - 2 * M) / 2 } },
    bodyStyles: { fontSize: 8.5, cellPadding: 2.5 },
    head: [['Cliente', 'Logística']],
    body: [[
      `${c.cliente.nombre}\n${c.cliente.direccion || 'Dirección no registrada'}`,
      [
        `Repartidor: ${c.repartidor || 'Sin dato'}`,
        `Programada: ${c.fechas.programada || 'sin fecha'}`,
        `Salida: ${c.fechas.salida ? formatearFechaColombia(c.fechas.salida) : 'Sin dato'}`,
        `Llegada: ${c.fechas.llegada ? formatearFechaColombia(c.fechas.llegada) : 'Sin dato'}`,
        `Confirmación de entrega: ${c.fechas.confirmacion ? formatearFechaColombia(c.fechas.confirmacion) : 'sin confirmar'}`,
        ...(c.fechas.correccion ? [`Entrega corregida: ${formatearFechaColombia(c.fechas.correccion)}`] : [])
      ].join('\n')
    ]]
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  y = tituloSeccion(doc, 'Cantidades', y);
  autoTable(doc, {
    ...estiloTabla(),
    startY: y,
    headStyles: { ...estiloTabla().headStyles, halign: 'right' },
    bodyStyles: { fontSize: 9, fontStyle: 'bold', halign: 'right' },
    head: [['Solicitada', 'Autorizada', 'Entregada', 'Liberada al cerrar', 'Pendiente']],
    body: [[
      cantidadTexto(c.cantidadSolicitada, c.unidad),
      cantidadTexto(c.cantidadAutorizada, c.unidad),
      cantidadTexto(c.cantidadEntregada, c.unidad),
      cantidadTexto(c.cantidadLiberada, c.unidad),
      cantidadTexto(c.cantidadPendiente, c.unidad)
    ]]
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  y = tituloSeccion(doc, 'Procedencia del producto', y, 'Por lote y estanque');
  autoTable(doc, {
    ...estiloTabla(),
    startY: y,
    columnStyles: { 0: { fontStyle: 'bold' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    head: [['Lote', 'Estanque', 'Cantidad autorizada', 'Cantidad entregada']],
    didParseCell: (d: any) => {
      if (d.section === 'head' && d.column.index >= 2) d.cell.styles.halign = 'right';
    },
    body: Object.entries(c.procedencias).map(([lote, p]) => [
      lote,
      p.estanque,
      cantidadTexto(p.autorizada, c.unidad),
      cantidadTexto(p.entregada, c.unidad)
    ])
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  const observaciones: string[][] = [
    ...c.entregas.map((e) => [
      `Entrega ${formatearFechaColombia(e.fecha)}`,
      `${Object.entries(e.cantidades).map(([l, n]) => `${l}: ${cantidadTexto(n, c.unidad)}`).join(', ')}` +
        (e.faltante > 0 ? ` · faltaron ${cantidadTexto(e.faltante, c.unidad)}` : '') +
        (e.observacion ? ` · ${e.observacion}` : '') +
        (e.fotoHash ? ` · foto registrada (SHA-256 ${e.fotoHash.slice(0, 16)}…)` : '')
    ]),
    // Ajustes y correcciones: cada lote con su cambio ("de 300 kg a 250 kg")
    ...c.ajustes.map((a) => {
      const esCorreccion = a.motivo.startsWith('Corrección de la cantidad entregada');
      const lotes = Array.from(new Set([...Object.keys(a.anterior), ...Object.keys(a.nueva)]));
      const cambios = lotes
        .filter((l) => (a.anterior[l] || 0) !== (a.nueva[l] || 0))
        .map((l) => `${l}: de ${cantidadTexto(a.anterior[l] || 0, c.unidad)} a ${cantidadTexto(a.nueva[l] || 0, c.unidad)}`);
      const motivo = a.motivo.replace(/^Corrección de la cantidad entregada: ?/, '');
      return [
        `${esCorreccion ? 'Corrección de entrega' : 'Ajuste aprobado'} ${formatearFechaColombia(a.fecha)}`,
        (cambios.length ? cambios.join('; ') : 'Sin cambios de cantidad') + (motivo ? `. Motivo: ${motivo}` : '')
      ];
    }),
    ...c.novedades.map((n) => [`Novedad ${formatearFechaColombia(n.fecha)}`, n.descripcion])
  ];
  if (observaciones.length) {
    y = tituloSeccion(doc, 'Observaciones', y);
    autoTable(doc, {
      ...estiloTabla(),
      startY: y,
      columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold' } },
      head: [['Registro', 'Detalle']],
      body: observaciones
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Verificación: si no cabe completa en la página actual, pasa a una página nueva (nunca se corta)
  const pageHeight = doc.internal.pageSize.getHeight();
  const ALTO_LINEA = 3.4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(74, 81, 96);
  if (opciones.preliminar) {
    if (y + 6 > pageHeight - 18) {
      doc.addPage();
      y = 20;
    }
    doc.text('Documento preliminar: no tiene hash de verificación ni código de consulta.', M, y);
  } else {
    const lineas = doc.splitTextToSize(
      textoPdf(
        `Hash del bloque: ${c.hashComprobante} · Hash del bloque anterior: ${c.hashAnterior || 'no registrado (emitido antes del encadenamiento)'} · ` +
          `Hash de los eventos de entrega: ${c.hashEventos}. ` +
          'Cada comprobante es un bloque sellado con SHA-256 que contiene el hash del bloque anterior de la misma orden; ' +
          'alterar cualquier dato cambia su hash y rompe la cadena. Cadena de bloques privada de la plataforma. ' +
          'Escanee el código QR para consultar la entrega y verificar la cadena. La trazabilidad de cada lote se consulta con el QR del lote.'
      ),
      pageWidth - 2 * M
    );
    const a = opciones.anulacion;
    const lineasAnulacion = a
      ? doc.splitTextToSize(
          textoPdf(
            `ANULADO por el bloque N.º ${a.version} (hash ${a.hashComprobante}). Motivo: ${a.motivo}. ` +
              'El comprobante original se conserva sin cambios en la cadena; solo queda sin validez.'
          ),
          pageWidth - 2 * M
        )
      : [];
    const alto = 4 + lineas.length * ALTO_LINEA + (lineasAnulacion.length ? 2 + lineasAnulacion.length * ALTO_LINEA : 0);
    if (y + alto + 8 > pageHeight - 18) {
      doc.addPage();
      y = 20;
    }
    y = tituloSeccion(doc, `Registro encadenado · bloque N.º ${c.version}`, y + 2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.pizarra);
    doc.text(lineas, M, y + 2);
    if (lineasAnulacion.length) {
      doc.setTextColor(...C.rojo);
      doc.text(lineasAnulacion, M, y + 2 + lineas.length * ALTO_LINEA + 2);
    }
  }

  piePaginas(doc, `${c.empresa.replace(/\s—\s/g, ' · ')} · Comprobante de entrega · orden ${c.ordenId}`);

  if (opciones.preliminar || opciones.anulacion) {
    // Marca de agua en TODAS las páginas, para que ninguna se confunda con un comprobante vigente.
    // Semitransparente para que no tape el texto de las tablas
    const paginas = doc.getNumberOfPages();
    for (let p = 1; p <= paginas; p++) {
      doc.setPage(p);
      marcaDeAgua(doc, opciones.anulacion ? 'Anulado' : 'Preliminar', opciones.anulacion ? C.rojo : C.gris);
    }
  }
  return doc.output('blob');
}

export async function verComprobantePdf(c: ContenidoComprobante, preliminar: boolean, anulacion?: BloqueAnulacion): Promise<void> {
  const blob = await generarComprobantePdfBlob(c, { preliminar, anulacion });
  window.open(URL.createObjectURL(blob), '_blank');
}

export async function descargarComprobantePdf(c: ContenidoComprobante, preliminar: boolean, anulacion?: BloqueAnulacion): Promise<void> {
  const blob = await generarComprobantePdfBlob(c, { preliminar, anulacion });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = preliminar
    ? `Preliminar_${c.ordenId}.pdf`
    : `Comprobante_${c.ordenId}_N${c.version}${anulacion ? '_ANULADO' : ''}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
