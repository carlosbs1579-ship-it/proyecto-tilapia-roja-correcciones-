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
  numeroRaciones: 'Número de raciones'
};
const OMITIR_DATO = new Set(['ambito']);

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
  let currentY = 14;

  // --- 1. ENCABEZADO Y BRANDING ---
  doc.setFillColor(3, 105, 161); // Tailwind sky-700
  doc.rect(10, currentY, pageWidth - 20, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('CULTIVOS LORÉ — TILAPIA PRO', 16, currentY + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Trazabilidad Integral Inalterable de Lote • Acuicultura Sostenible', 16, currentY + 16);
  doc.text(`Turbaco, Bolívar, Colombia • Generado: ${getFechaHoyBogota()}`, 16, currentY + 21);

  currentY += 28;

  // --- 2. RESUMEN DE IDENTIDAD DEL LOTE & CÓDIGO QR ---
  const boxHeight = 44;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, currentY, pageWidth - 20, boxHeight, 'FD');

  // Insertar QR a la derecha
  try {
    doc.addImage(qrDataUrl, 'PNG', pageWidth - 48, currentY + 3, 34, 34);
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Escanear trazabilidad', pageWidth - 48 + 17, currentY + 40, { align: 'center' });
  } catch (err) {
    console.warn('No se pudo incrustar QR en el PDF:', err);
  }

  // Textos del lote
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`LOTE: ${lote.codigo}`, 14, currentY + 7);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Producto:', 14, currentY + 14);
  doc.setFont('helvetica', 'normal');
  doc.text(lote.producto, 32, currentY + 14, { maxWidth: pageWidth - 85 });

  doc.setFont('helvetica', 'bold');
  doc.text('Origen:', 14, currentY + 21);
  doc.setFont('helvetica', 'normal');
  doc.text(lote.origen, 28, currentY + 21);

  doc.setFont('helvetica', 'bold');
  doc.text('Estanque:', 14, currentY + 27);
  doc.setFont('helvetica', 'normal');
  doc.text(`${lote.estanque}`, 32, currentY + 27);

  doc.setFont('helvetica', 'bold');
  doc.text('Siembra:', 52, currentY + 27);
  doc.setFont('helvetica', 'normal');
  doc.text(`${lote.fechaSiembra} (${lote.cantidadSembrada.toLocaleString()} alevinos)`, 68, currentY + 27);

  doc.setFont('helvetica', 'bold');
  doc.text('Estado:', 14, currentY + 33);
  doc.setFont('helvetica', 'normal');
  doc.text(`${lote.estado.toUpperCase()}${lote.fechaCierre ? ` (Cierre: ${lote.fechaCierre})` : ''}`, 28, currentY + 33);

  doc.setFont('helvetica', 'bold');
  doc.text('Proveedor alevinos:', 14, currentY + 39);
  doc.setFont('helvetica', 'normal');
  doc.text(`${lote.proveedorAlevinos || 'No especificado'}`, 48, currentY + 39);

  currentY += boxHeight + 4;

  // --- 3. TABLA DE RESUMEN PRODUCTIVO ---
  const r = lote.resumen;
  autoTable(doc, {
    startY: currentY,
    margin: { left: 10, right: 10 },
    theme: 'grid',
    headStyles: {
      fillColor: [3, 105, 161],
      fontSize: 8.5,
      halign: 'left',
      fontStyle: 'bold'
    },
    bodyStyles: { fontSize: 8, textColor: [15, 23, 42] },
    head: [['INDICADOR PRODUCTIVO', 'VALOR REGISTRADO', 'INDICADOR PRODUCTIVO', 'VALOR REGISTRADO']],
    body: [
      [
        'Días de cultivo:', `${r.diasDeCultivo} días`,
        'Supervivencia estimada:', `${r.supervivencia}%`
      ],
      [
        'Peces sembrados:', `${lote.cantidadSembrada.toLocaleString()} peces`,
        'Mortalidad acumulada:', `${r.mortalidadAcumulada.toLocaleString()} peces`
      ],
      [
        'Peces cosechados:', `${r.pecesCosechados.toLocaleString()} peces`,
        'Peces vivos actuales:', `${r.pecesVivos.toLocaleString()} peces`
      ],
      [
        'Peso inicial prom:', `${lote.pesoInicialPromedioG} g`,
        'Peso prom. actual/final:', `${r.pesoPromedioActualG} g`
      ],
      [
        'Biomasa inicial:', `${r.biomasaInicialKg} kg`,
        'Biomasa estimada viva:', `${r.biomasaEstimadaKg} kg`
      ],
      [
        'Biomasa cosechada:', `${r.biomasaCosechadaKg} kg`,
        'Alimento acumulado:', `${r.alimentoAcumuladoKg} kg`
      ],
      [
        'FCA (Factor Conversión):', r.FCA !== null ? `${r.FCA}` : 'N/A',
        'Ganancia diaria:', `${r.gananciaDiariaG} g/día`
      ],
      [
        'Densidad actual:', r.densidadKgM3 !== null ? `${r.densidadKgM3} kg/m³` : 'N/A',
        'Alertas calidad de agua:', `${r.alertasAgua} mediciones fuera de rango`
      ]
    ]
  });

  currentY = (doc as any).lastAutoTable.finalY + 5;

  // --- 4. TABLA DE EVENTOS DE CALIDAD DEL AGUA ---
  const eventosAgua = (lote.eventos || []).filter(e => e.tipo === 'Calidad del agua');
  if (eventosAgua.length > 0) {
    const filasAgua = eventosAgua.map(ev => {
      const d = ev.datos || {};
      const t = d.temperatura !== undefined ? `${d.temperatura} °C` : '-';
      const ox = d.oxigenoDisuelto !== undefined ? `${d.oxigenoDisuelto} mg/L` : '-';
      const ph = d.ph !== undefined ? `${d.ph}` : '-';
      const am = d.amonioTotal !== undefined ? `${d.amonioTotal} mg/L` : '-';
      const nit = d.nitritos !== undefined ? `${d.nitritos} mg/L` : '-';
      const sec = d.transparenciaSecchi !== undefined ? `${d.transparenciaSecchi} cm` : '-';

      // Detectar si está fuera de rango
      const paramsList: Array<'temperatura' | 'oxigenoDisuelto' | 'ph' | 'amonioTotal' | 'nitritos' | 'transparenciaSecchi'> = [
        'temperatura', 'oxigenoDisuelto', 'ph', 'amonioTotal', 'nitritos', 'transparenciaSecchi'
      ];
      const fuera: string[] = [];
      for (const p of paramsList) {
        const val = Number(d[p]);
        if (!isNaN(val)) {
          const evalRes = evaluarParametroAgua(p, val, config.rangosReferencia);
          if (evalRes.fueraDeRango) {
            fuera.push(`${p}: ${evalRes.mensaje}`);
          }
        }
      }

      const estadoParam = fuera.length > 0 ? `ALERTA (${fuera.length})` : 'ÓPTIMO';
      return [ev.fechaEvento, t, ox, ph, am, nit, sec, estadoParam, quienRegistro(ev, true)];
    });

    autoTable(doc, {
      startY: currentY,
      margin: { left: 10, right: 10 },
      theme: 'striped',
      headStyles: { fillColor: [8, 145, 178], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.5 },
      head: [['Fecha', 'Temp', 'O2 Dis.', 'pH', 'Amonio', 'Nitritos', 'Secchi', 'Estado', 'Operario']],
      body: filasAgua
    });
    currentY = (doc as any).lastAutoTable.finalY + 5;
  }

  // --- 5. TABLA DE COSECHA, PROCESO, CONSERVACIÓN Y DESPACHO ---
  const eventosPost = (lote.eventos || []).filter(e =>
    ['Cosecha', 'Proceso', 'Empaque y conservación', 'Despacho/transporte'].includes(e.tipo)
  );
  if (eventosPost.length > 0) {
    const filasPost = eventosPost.map(ev => {
      let detalle = ev.descripcion || '';
      const d = ev.datos || {};
      if (ev.tipo === 'Cosecha') {
        detalle = `Peces: ${d.pecesCosechados} | Biomasa: ${d.biomasaCosechadaKg} kg | Peso prom: ${d.pesoPromedioG} g`;
      } else if (ev.tipo === 'Proceso') {
        detalle = `Escamado/Eviscerado: ${d.escamadoEviscerado ? 'SÍ' : 'NO'} | Cant: ${d.cantidadProcesada} | Peso final: ${d.pesoPromedioFinalG} g | Resp: ${d.responsable || '-'}`;
      } else if (ev.tipo === 'Empaque y conservación') {
        detalle = `Empaque: ${d.tipoEmpaque || '-'} | Temp: ${d.temperaturaConservacionC ?? '-'}°C | Hielo: ${d.usoHielo ? 'SÍ' : 'NO'}`;
      } else if (ev.tipo === 'Despacho/transporte') {
        detalle = `Destino: ${d.destino || '-'} | Salida: ${d.fechaHoraSalida || '-'} | Temp despacho: ${d.temperaturaDespachoC ?? '-'}°C | Contenedor c/hielo: ${d.contenedorIsotermico ? 'SÍ' : 'NO'} | Resp: ${d.responsable || '-'}`;
      }
      return [ev.fechaEvento, ev.tipo, detalle, quienRegistro(ev, true)];
    });

    autoTable(doc, {
      startY: currentY,
      margin: { left: 10, right: 10 },
      theme: 'grid',
      headStyles: { fillColor: [15, 118, 110], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.5 },
      head: [['Fecha', 'Etapa', 'Detalle Técnico / Parámetros', 'Registrado Por']],
      body: filasPost
    });
    currentY = (doc as any).lastAutoTable.finalY + 5;
  }

  // --- 6. TABLA DE PROBIÓTICOS Y TRATAMIENTOS ---
  const eventosSanitarios = (lote.eventos || []).filter(e =>
    ['Probióticos', 'Tratamiento o manejo sanitario'].includes(e.tipo)
  );
  if (eventosSanitarios.length > 0) {
    const filasSan = eventosSanitarios.map(ev => {
      const d = ev.datos || {};
      const det = ev.tipo === 'Probióticos'
        ? `Producto: ${d.producto || '-'} | Dosis: ${d.dosis || '-'} ${d.unidad || ''} | Vía: ${d.viaAplicacion || '-'} | Obj: ${d.objetivo || '-'}`
        : `Descripción: ${d.descripcion || ev.descripcion || '-'} | Producto: ${d.producto || '-'} | Dosis: ${d.dosis || '-'}`;
      return [ev.fechaEvento, ev.tipo, det, quienRegistro(ev, true)];
    });

    autoTable(doc, {
      startY: currentY,
      margin: { left: 10, right: 10 },
      theme: 'grid',
      headStyles: { fillColor: [30, 64, 175], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.5 },
      head: [['Fecha', 'Tipo de Manejo', 'Producto / Dosis / Aplicación', 'Registrado Por']],
      body: filasSan
    });
    currentY = (doc as any).lastAutoTable.finalY + 5;
  }

  // --- 7. HISTORIAL CRONOLÓGICO COMPLETO DE EVENTOS ---
  const filasEventos = (lote.eventos || []).map(ev => {
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
    const contenido = [ev.descripcion, detalleDatos, refNotas].filter(Boolean).join(' — ');
    return [
      `#${ev.indice}`,
      ev.fechaEvento,
      ev.tipo,
      contenido || '-',
      quienRegistro(ev, true),
      ev.hash.substring(0, 12) + '...'
    ];
  });

  autoTable(doc, {
    startY: currentY,
    margin: { left: 10, right: 10 },
    theme: 'striped',
    headStyles: { fillColor: [51, 65, 85], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 20 },
      2: { cellWidth: 32 },
      3: { cellWidth: 68 },
      4: { cellWidth: 36 },
      5: { cellWidth: 24 }
    },
    head: [['#', 'Fecha', 'Fase', 'Detalle / Mediciones', 'Operario', 'Hash SHA-256']],
    body: filasEventos
  });
  currentY = (doc as any).lastAutoTable.finalY + 5;

  // --- 7b. ANOTACIONES POSTERIORES AL CIERRE (no modifican el lote sellado) ---
  if (anotacionesAprobadas.length || anotacionesSinValidez.length) {
    autoTable(doc, {
      startY: currentY,
      margin: { left: 10, right: 10 },
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [2, 132, 199], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 12 }, 1: { cellWidth: 22 }, 2: { cellWidth: 46 }, 3: { cellWidth: 52 }, 4: { cellWidth: 36 } },
      head: [
        [{ content: 'ANOTACIONES POSTERIORES AL CIERRE (aprobadas; el registro sellado no se modificó)', colSpan: 6 }],
        ['N.º', 'Fase', 'Dato: registrado / correcto', 'Motivo', 'Propuso / Aprobó', 'Hash']
      ],
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
          (a.resolucion?.hash || a.propuesta.hash).slice(0, 12) + '...'
        ];
        }),
        ...anotacionesSinValidez.map((a) => [String(a.numero), '', 'ALTERADA después de registrarse: SIN VALIDEZ', '', '', ''])
      ]
    });
    currentY = (doc as any).lastAutoTable.finalY + 5;
  }

  // Si estamos muy cerca del pie de página, agregar nueva página
  if (currentY > doc.internal.pageSize.getHeight() - 48) {
    doc.addPage();
    currentY = 15;
  }

  // --- 8. FICHA NUTRICIONAL REFERENCIAL ---
  const fn = config.fichaNutricional;
  autoTable(doc, {
    startY: currentY,
    margin: { left: 10, right: 10 },
    theme: 'plain',
    headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.5 },
    head: [[`FICHA NUTRICIONAL REFERENCIAL (por cada ${fn.porcionG} g de tilapia cruda)`]],
    body: [
      [
        `Energía: ${fn.energiaKcal} kcal  |  Proteína: ${fn.proteinaG} g  |  Grasa total: ${fn.grasaTotalG} g  |  Carbohidratos: ${fn.carbohidratosG} g  |  Colesterol: ${fn.colesterolMg} mg  |  Sodio: ${fn.sodioMg} mg`
      ],
      [
        `Fuente: ${fn.fuente}. ${fn.notas}`
      ]
    ]
  });
  currentY = (doc as any).lastAutoTable.finalY + 4;

  // --- 9. PIE DE PÁGINA: INTEGRIDAD HASH, QR & NOTA DE INOCUIDAD ---
  if (currentY > doc.internal.pageSize.getHeight() - 32) {
    doc.addPage();
    currentY = 15;
  }

  doc.setFillColor(241, 245, 249);
  doc.rect(10, currentY, pageWidth - 20, 24, 'F');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('VERIFICACIÓN CRIPTOGRÁFICA DE INTEGRIDAD (REGISTRO TIPO BLOCKCHAIN · SHA-256):', 13, currentY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(resultadoIntegridad.valido ? 22 : 185, resultadoIntegridad.valido ? 101 : 28, resultadoIntegridad.valido ? 52 : 28);
  doc.text(
    resultadoIntegridad.valido
      ? `ESTADO: ÍNTEGRO (Cadena válida de ${lote.eventos?.length || 0} bloques SHA-256 sin manipulación)`
      : `ESTADO: ALTERADO (Falla en la fase #${resultadoIntegridad.primerErrorIndex})`,
    13,
    currentY + 10
  );

  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.text(`Hash final: ${lote.resumen.hashFinal || 'N/A'}`, 13, currentY + 14);
  if (datosAnotaciones?.registros?.length) {
    doc.setTextColor(verifAnotaciones.integra ? 22 : 185, verifAnotaciones.integra ? 101 : 28, verifAnotaciones.integra ? 52 : 28);
    doc.text(textoPdf(`Anotaciones: ${verifAnotaciones.mensaje}`), 13, currentY + 17);
    doc.setTextColor(71, 85, 105);
  }

  // NOTA OBLIGATORIA
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(
    'Nota de inocuidad: Este registro documenta cómo se produjo y manejó el lote; no reemplaza los controles de inocuidad.',
    13,
    currentY + 20
  );

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
  let y = 14;

  // Encabezado con la misma identidad del certificado del lote
  doc.setFillColor(3, 105, 161);
  doc.rect(10, y, pageWidth - 20, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(c.empresa.toUpperCase(), 16, y + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(opciones.preliminar ? 'COMPROBANTE DE ENTREGA — PRELIMINAR' : 'COMPROBANTE DE ENTREGA', 16, y + 16);
  doc.setFontSize(8);
  // Dos renglones cortos para que el texto no pase por debajo del QR
  const anchoEncabezado = pageWidth - 16 - 50;
  const encabezado = opciones.preliminar
    ? [`Orden ${c.ordenId} · generado el ${formatearFechaColombia(c.emitidoEn)}`, 'Sin validez como comprobante definitivo']
    : [`Comprobante N.º ${c.version} · orden ${c.ordenId}`, `Código ${c.id.slice(0, 15)} · emitido el ${formatearFechaColombia(c.emitidoEn)}`];
  doc.text(encabezado.map((l) => doc.splitTextToSize(textoPdf(l), anchoEncabezado)[0]), 16, y + 20.5);
  if (!opciones.preliminar && c.tokenConsulta) {
    const qr = await generarQrDataUrl(construirUrlConsultaEntrega(c.tokenConsulta));
    doc.addImage(qr, 'PNG', pageWidth - 44, y + 1, 24, 24);
  }
  y += 32;

  // Estado de la entrega (una parcial nunca se presenta como completa)
  doc.setFillColor(
    ...((opciones.anulacion ? [185, 28, 28] : opciones.preliminar ? [100, 116, 139] : parcial ? [217, 119, 6] : [5, 150, 105]) as [number, number, number])
  );
  doc.rect(10, y, pageWidth - 20, 9, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(
    opciones.anulacion
      ? `COMPROBANTE ANULADO el ${formatearFechaColombia(opciones.anulacion.emitidoEn)} · sin validez`
      : opciones.preliminar
      ? 'DOCUMENTO PRELIMINAR · la entrega aún no está confirmada o el comprobante no se ha emitido'
      : parcial
      ? `ENTREGA PARCIAL · pendientes ${cantidadTexto(c.cantidadPendiente, c.unidad)}`
      : 'ENTREGA COMPLETA',
    14,
    y + 6
  );
  y += 14;

  doc.setTextColor(15, 23, 42);
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42] },
    // Columnas de igual ancho: un nombre de cliente largo no estrecha la de logística
    columnStyles: { 0: { cellWidth: (pageWidth - 28) / 2 }, 1: { cellWidth: (pageWidth - 28) / 2 } },
    head: [['Cliente', 'Logística']],
    body: [[
      `${c.cliente.nombre}\n${c.cliente.direccion || 'Dirección no registrada'}`,
      [
        `Repartidor: ${c.repartidor || '—'}`,
        `Programada: ${c.fechas.programada || 'sin fecha'}`,
        `Salida: ${c.fechas.salida ? formatearFechaColombia(c.fechas.salida) : '—'}`,
        `Llegada: ${c.fechas.llegada ? formatearFechaColombia(c.fechas.llegada) : '—'}`,
        `Confirmación de entrega: ${c.fechas.confirmacion ? formatearFechaColombia(c.fechas.confirmacion) : 'sin confirmar'}`,
        ...(c.fechas.correccion ? [`Entrega corregida: ${formatearFechaColombia(c.fechas.correccion)}`] : [])
      ].join('\n')
    ]]
  });
  y = (doc as any).lastAutoTable.finalY + 5;

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2, halign: 'right' },
    headStyles: { fillColor: [3, 105, 161], textColor: [255, 255, 255], halign: 'right' },
    head: [['Solicitada', 'Autorizada', 'Entregada', 'Liberada al cerrar', 'Pendiente']],
    body: [[
      cantidadTexto(c.cantidadSolicitada, c.unidad),
      cantidadTexto(c.cantidadAutorizada, c.unidad),
      cantidadTexto(c.cantidadEntregada, c.unidad),
      cantidadTexto(c.cantidadLiberada, c.unidad),
      cantidadTexto(c.cantidadPendiente, c.unidad)
    ]]
  });
  y = (doc as any).lastAutoTable.finalY + 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Procedencia del producto (por lote y piscina)', 10, y);
  autoTable(doc, {
    startY: y + 2,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
    head: [['Lote', 'Piscina', 'Cantidad autorizada', 'Cantidad entregada']],
    body: Object.entries(c.procedencias).map(([lote, p]) => [
      lote,
      p.estanque,
      cantidadTexto(p.autorizada, c.unidad),
      cantidadTexto(p.entregada, c.unidad)
    ])
  });
  y = (doc as any).lastAutoTable.finalY + 5;

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
    autoTable(doc, {
      startY: y,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 1.8 },
      headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42] },
      columnStyles: { 0: { cellWidth: 48 } },
      head: [['Observaciones', 'Detalle']],
      body: observaciones
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  }

  // Verificación: si no cabe completa en la página actual, pasa a una página nueva (nunca se corta)
  const pageHeight = doc.internal.pageSize.getHeight();
  const ALTO_LINEA = 3.4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  if (opciones.preliminar) {
    if (y + 6 > pageHeight - 10) {
      doc.addPage();
      y = 15;
    }
    doc.text('Documento preliminar: no tiene hash de verificación ni código de consulta.', 10, y);
  } else {
    const lineas = doc.splitTextToSize(
      textoPdf(
        `Hash del bloque: ${c.hashComprobante} · Hash del bloque anterior: ${c.hashAnterior || 'no registrado (emitido antes del encadenamiento)'} · ` +
          `Hash de los eventos de entrega: ${c.hashEventos}. ` +
          'Cada comprobante es un bloque sellado con SHA-256 que contiene el hash del bloque anterior de la misma orden; ' +
          'alterar cualquier dato cambia su hash y rompe la cadena. Cadena de bloques privada de la plataforma. ' +
          'Escanee el código QR para consultar la entrega y verificar la cadena. La trazabilidad de cada lote se consulta con el QR del lote.'
      ),
      pageWidth - 20
    );
    const a = opciones.anulacion;
    const lineasAnulacion = a
      ? doc.splitTextToSize(
          textoPdf(
            `ANULADO por el bloque N.º ${a.version} (hash ${a.hashComprobante}). Motivo: ${a.motivo}. ` +
              'El comprobante original se conserva sin cambios en la cadena; solo queda sin validez.'
          ),
          pageWidth - 20
        )
      : [];
    const alto = 4 + lineas.length * ALTO_LINEA + (lineasAnulacion.length ? 2 + lineasAnulacion.length * ALTO_LINEA : 0);
    if (y + alto > pageHeight - 10) {
      doc.addPage();
      y = 15;
    }
    doc.setFont('helvetica', 'bold');
    doc.text(`REGISTRO TIPO BLOCKCHAIN · BLOQUE N.º ${c.version}`, 10, y);
    doc.setFont('helvetica', 'normal');
    doc.text(lineas, 10, y + 4);
    if (lineasAnulacion.length) {
      doc.setTextColor(185, 28, 28);
      doc.text(lineasAnulacion, 10, y + 4 + lineas.length * ALTO_LINEA + 2);
    }
  }

  if (opciones.preliminar || opciones.anulacion) {
    // Marca de agua en TODAS las páginas, para que ninguna se confunda con un comprobante vigente.
    // Semitransparente para que no tape el texto de las tablas
    const anyDoc = doc as any;
    const paginas = doc.getNumberOfPages();
    for (let p = 1; p <= paginas; p++) {
      doc.setPage(p);
      if (anyDoc.GState) anyDoc.setGState(new anyDoc.GState({ opacity: 0.18 }));
      doc.setTextColor(...((opciones.anulacion ? [220, 38, 38] : [100, 116, 139]) as [number, number, number]));
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(64);
      doc.text(opciones.anulacion ? 'ANULADO' : 'PRELIMINAR', pageWidth / 2, 170, { align: 'center', angle: 35 });
      if (anyDoc.GState) anyDoc.setGState(new anyDoc.GState({ opacity: 1 }));
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
