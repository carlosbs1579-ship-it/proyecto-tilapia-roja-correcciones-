import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase/firebaseConfig';
import { Lote, ConfiguracionGeneral } from '../types';
import { construirUrlPublicaPdf, generarQrDataUrl } from './qrService';
import { verificarIntegridadCadena } from './hashService';
import { formatearFechaColombia, getFechaHoyBogota } from '../utils/constants';
import { evaluarParametroAgua } from './calculosService';

/**
 * Genera el documento PDF con jsPDF y jspdf-autotable
 */
export async function generarLotePdfBlob(
  lote: Lote,
  config: ConfiguracionGeneral
): Promise<{ blob: Blob; urlPublica: string }> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const urlPublica = construirUrlPublicaPdf(lote.codigo);
  const qrDataUrl = await generarQrDataUrl(urlPublica);
  const resultadoIntegridad = await verificarIntegridadCadena(lote.codigo, lote.eventos || []);

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
  doc.text('Versión PDF:', 72, currentY + 33);
  doc.setFont('helvetica', 'normal');
  doc.text(`v${lote.versionPdf || 1}`, 93, currentY + 33);

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
        'Alertas calidad de agua:', `${r.alertasAgua} eventos fuera de rango`
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
      return [ev.fechaEvento, t, ox, ph, am, nit, sec, estadoParam, ev.registradoPor];
    });

    autoTable(doc, {
      startY: currentY,
      margin: { left: 10, right: 10 },
      theme: 'striped',
      headStyles: { fillColor: [8, 145, 178], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.5 },
      head: [['Fecha', 'Temp', 'O₂ Dis.', 'pH', 'Amonio', 'Nitritos', 'Secchi', 'Estado', 'Operario']],
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
      return [ev.fechaEvento, ev.tipo, detalle, ev.registradoPor];
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
      return [ev.fechaEvento, ev.tipo, det, ev.registradoPor];
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
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
    }
    const contenido = [ev.descripcion, detalleDatos].filter(Boolean).join(' — ');
    return [
      `#${ev.indice}`,
      ev.fechaEvento,
      ev.tipo,
      contenido || '-',
      ev.registradoPor,
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
    head: [['#', 'Fecha', 'Tipo Evento', 'Detalle / Mediciones', 'Operario', 'Hash SHA-256']],
    body: filasEventos
  });
  currentY = (doc as any).lastAutoTable.finalY + 5;

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
  doc.text('VERIFICACIÓN CRIPTOGRÁFICA DE INTEGRIDAD (BLOCKCHAIN LEDGER):', 13, currentY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(resultadoIntegridad.valido ? 22 : 185, resultadoIntegridad.valido ? 101 : 28, resultadoIntegridad.valido ? 52 : 28);
  doc.text(
    resultadoIntegridad.valido
      ? `ESTADO: ÍNTEGRO (Cadena válida de ${lote.eventos?.length || 0} bloques SHA-256 sin manipulación)`
      : `ESTADO: ALTERADO (Falla en bloque #${resultadoIntegridad.primerErrorIndex})`,
    13,
    currentY + 10
  );

  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.text(`Hash final: ${lote.resumen.hashFinal || 'N/A'}`, 13, currentY + 14);

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
 * Genera el PDF del lote y lo sube a Firebase Cloud Storage en lotes/{codigo}.pdf
 * Cuenta con protección de tiempo límite de 2 segundos para no bloquear la aplicación si Storage no responde.
 */
export async function generarYSubirPdfLote(
  lote: Lote,
  config: ConfiguracionGeneral
): Promise<{ urlPublica: string; versionPdf: number }> {
  const { blob, urlPublica } = await generarLotePdfBlob(lote, config);
  const versionPdf = (lote.versionPdf || 0) + 1;

  try {
    const storagePath = `lotes/${lote.codigo}.pdf`;
    const storageRef = ref(storage, storagePath);
    
    // Subida con tiempo de espera máximo de 2 segundos para evitar bloqueos
    const subidaPromise = uploadBytes(storageRef, blob, {
      contentType: 'application/pdf',
      cacheControl: 'no-cache, max-age=0'
    });
    const limiteTiempo = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Tiempo de espera de Firebase Storage excedido')), 2000)
    );

    await Promise.race([subidaPromise, limiteTiempo]);
    console.log(`PDF sincronizado exitosamente con Cloud Storage en ${storagePath}`);
  } catch (err) {
    console.warn('Storage en modo contingencia (el lote y PDF se mantienen disponibles inmediatamente):', err);
  }

  return { urlPublica, versionPdf };
}

/**
 * Dispara la descarga local directa del PDF para inspección o impresión
 */
export async function descargarPdfLoteLocal(lote: Lote, config: ConfiguracionGeneral): Promise<void> {
  const { blob } = await generarLotePdfBlob(lote, config);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `CultivosLore_Lote_${lote.codigo}_v${lote.versionPdf || 1}.pdf`;
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
