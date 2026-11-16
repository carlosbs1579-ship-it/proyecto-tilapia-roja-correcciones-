| Despliegue 2: web a producción (PR #24, merge bb792c4; Vercel 5f3h9ikqe; versión anterior para revertir: hpc7j252w) | 2026-11-16 | Bien. Las cabeceras de seguridad están presentes. La consulta pública del lote real dice "Cadena verificada al abrir", sin falsas alarmas. El panel de operador, el detalle del lote (carga diferida), el desplazamiento con rueda y el cierre con Escape funcionan sin errores en consola. |
| Despliegue 3: reglas de Firestore (commit fd6c220): vencimiento de foto con margen para relojes desfasados, nombre visible hasta 120 | 2026-11-16 14:52 UTC | Bien. Publicadas iguales al repo; 146/146 y 71/71 antes; consulta pública sin errores después. |
| Despliegue 4: web (PR #25, merge 8df82f4; Vercel f7k78vu2a; anterior 5f3h9ikqe): estanque con guion, guardar solo estanques, CSV | 2026-11-16 | Bien. Lote real "Cadena verificada"; lote de prueba con sello del QR "verificada"; panel de operador sin errores. |
| Despliegue 5: CSP completa en vercel.json (PR #26, merge d6cf67d; Vercel jp99odnvo; anterior f7k78vu2a) | 2026-11-16 | Bien. Probada antes en la vista previa: consulta pública, PDF, ingreso y ventana de Google sin violaciones. En producción, con sesión: panel, detalle del lote (carga diferida) y QR sin violaciones de CSP. |
| Despliegue 6: reglas de órdenes y comprobantes (commit 9e55330) | 2026-11-16 21:12 UTC | Bien. Publicadas iguales al repo; antes 162/162 y 71/71; 4 comprobantes, 4 órdenes y 4 consultas reales verificadas sin alarmas (solo lectura). Un primer intento falló por corte de internet sin publicar nada. |
| Despliegue 7: web de órdenes y comprobantes (PR #27, merge d328d52; Vercel 4f7a9z6fu; anterior jp99odnvo) | 2026-11-16 | Bien. Consulta pública ?entrega= de un comprobante real: sin dirección del cliente, "Cadena verificada al abrir" y "Bloque íntegro". |
| Despliegue 8: reglas de lotes y anotaciones (commit 39b6996) | 2026-11-16 21:43 UTC | Bien. Publicadas iguales al repo; antes 170/170 y 73/73; lote real, sus anotaciones, 4 comprobantes y 4 consultas reales verificados sin alarmas (solo lectura). |
| Despliegue 9: web de lotes (PR #28, merge 3815528; Vercel 3glwrrqkr; anterior 4f7a9z6fu) | 2026-11-16 | Bien. Lote real "Cadena verificada al abrir" y anotaciones íntegras; detalle del lote con sesión sin errores. |
# Reporte de auditoría: integridad, seguridad y regresiones

Fecha: 2026-11-16. Rama `correciones-claude`. Une los reportes de `auditoria/agente1-integridad.md`, `agente2-alteraciones.md`, `agente3-seguridad.md`, `agente4-funcional.md`, `agente5-regresiones.md` y `tests/integridad/resultados.md`. Ningún archivo de la app se modificó durante la auditoría.

Nota de corrección: el historial de las órdenes (`ordenes/{id}.historial`) NO tiene cadena de hashes, aunque una versión anterior de `AUDITORIA_PROGRESO.md` lo decía (ver H14).

## 1. Resumen ejecutivo

Tras deduplicar quedan 69 hallazgos:

| Severidad | Cantidad |
| --- | --- |
| Crítica | 2 |
| Alta | 9 |
| Media | 22 |
| Baja | 30 |
| Informativa | 6 |

Sin sesión no se puede escribir nada, nadie puede cambiar su propio rol y los registros sellados no se pueden reescribir desde la app. Los problemas están en lo que el hash no cubre y en cómo se muestran las verificaciones.

Los 5 riesgos principales:

1. **Los datos que el cliente lee primero no están protegidos por el hash** (H01, H02). Piscina, fecha de siembra, producto, origen, peces sembrados, supervivencia, peso y biomasa salen de campos sueltos del lote. Un operador con permiso de cerrar lotes puede cambiarlos al sellar, y el QR y el PDF siguen diciendo "Cadena íntegra".
2. **Quien administre el proyecto Firebase puede reescribir todo sin dejar rastro** (H03). Si se recalculan los hashes, el sello y las anotaciones, ninguna verificación lo detecta, porque no existe ninguna copia del sello fuera de Firestore.
3. **El comprobante de entrega puede mostrar cliente, fechas o cantidades falsas como "íntegro"** (H04, H05). Las reglas no comparan el contenido con la orden y la verificación no usa el hash que la orden ya guarda.
4. **Las alteraciones se detectan pero no siempre se avisan** (H06, H07, H16). Borrar la última fase de un lote, cambiar o borrar la foto de entrega o borrar una anulación solo se nota si alguien pulsa "Verificar", o no se nota en público.
5. **Datos imposibles quedan sellados para siempre** (H08, H09). La app acepta 999 999 muertes en un lote de 5 000 peces y fases con fecha anterior a la siembra. Como la cadena es inmutable, un error de tipeo arruina el certificado del lote.

## 2. Pruebas de alteración

"Detectado y avisado": una pantalla lo muestra sola al abrirse. "Detectado sin aviso": solo aparece si alguien pulsa un botón de verificar. Filas 1 a 12 y A1, A2: Agente 2 (emulador, `tests/integridad/resultados.md`). Filas marcadas A1-x y A3-x: escenarios de los agentes 1 y 3.

| # | Ataque | Resultado actual | Arreglo (ID) | Estado tras arreglos |
| --- | --- | --- | --- | --- |
| 1 | Reemplazar `datos` de la foto por otra imagen | Detectado sin aviso | H07 | Detectado y avisado |
| 2 | Cambiar un carácter del base64 de la foto | Detectado sin aviso | H07 | Detectado y avisado |
| 3 | Cambiar `datos` y `hash` de la foto (evento intacto) | Detectado sin aviso | H07 | Detectado y avisado |
| 3b | 3 y además cambiar el hash en el evento "Entrega" de la orden | Detectado sin aviso (solo el botón "Verificar" del comprobante interno) | H07, H14 | Detectado y avisado |
| 4 | Alterar un dato de una fase intermedia | Detectado y avisado | Ninguno | Detectado y avisado (probado en producción) |
| 5 | Alterar el hash guardado de un evento | Detectado y avisado | Ninguno | Detectado y avisado |
| 6 | Alterar fase #2 y recalcular cadena, huellas y `hashFinal` | Detectado y avisado, solo porque había anotación | H03, H06 | Detectado y avisado |
| 6b | 6 y recalcular la cadena de anotaciones | No detectado | H03 | Detectado y avisado (resumen derivado) |
| 6c | 6 y borrar el documento de anotaciones | No detectado | H03 | Detectado y avisado (resumen derivado) |
| 7 | Editar la cabecera del lote (estanque, siembra, producto, peces, supervivencia, peso, biomasa) | No detectado | H01, H02 | Detectado y avisado (probado en producción) |
| 8 | Borrar el último evento sin tocar el sello | Detectado sin aviso (el aviso automático sale solo si hay anotación) | H06 | Detectado y avisado (probado en producción) |
| 8b | Borrar el último evento y ajustar `hashFinal` | Detectado y avisado, solo por la anotación | H03, H06 | Detectado y avisado |
| 8c | 8b y recalcular las anotaciones | No detectado | H03 | Detectado y avisado |
| 9a | Alterar `cantidadEntregada` del comprobante | Detectado y avisado | Ninguno | Detectado y avisado |
| 9b | 9a y recalcular `hashComprobante` | Detectado y avisado | Ninguno | Detectado y avisado |
| 9c | 9b y actualizar `consultasEntrega` | No detectado (público e interno dicen "íntegro") | H04, H03 | Detectado y avisado (panel interno, contra la orden) |
| 9d | Alterar solo el hash en `consultasEntrega` | Detectado y avisado | Ninguno | Detectado y avisado |
| 9e | Borrar el comprobante | Detectado y avisado en interno; el público ve "No se encontró ninguna entrega" (engañoso) | H16 | Detectado y avisado ("Falta el comprobante registrado") |
| 9f | Borrar el bloque de anulación de un comprobante anulado | Detectado sin aviso en público (ve "vigente" sin marca ANULADO); avisado solo en interno | H16 | Detectado y avisado en público |
| 10 | Borrar la foto antes de su vencimiento | No detectado (se ve como vencida) | H07 | Detectado y avisado (borrada antes de vencer) |
| A1 | Alterar la anotación aprobada | Detectado y avisado | Ninguno | Detectado y avisado |
| A2 | A1 y recalcular la cadena de anotaciones | No detectado | H03 | No detectado (pendiente, H03) |
| 11 | `?lote=` y `?entrega=` con valores raros (inyección, `<script>`, `../`, muy largo, token falso) | Correcto salvo `?lote=%25`: carga infinita | H34 | Correcto; ?lote=%25 muestra "código no válido" (probado en producción) |
| 12 | Las mismas alteraciones como usuario con sesión (pasando reglas) | Bloqueado en 20 de 22; permitidos: resumen de lote activo sin evento y cabecera al sellar (no detectado) | H01 | Bloqueado en todos los casos (reglas H01) |
| A1-a | Emisor de comprobantes escribe cliente, fechas, entregas o `fotoHash` inventados con hashes honestos | No detectado | H05, H04 | Bloqueado por reglas (H05) y detectado (H04) |
| A1-b | Vaciar `eventos` o dejar `resumen.hashFinal` vacío | No detectado ("Cadena íntegra: 0 fases") | H06 | Detectado y avisado |
| A1-c | Corrección de siembra que declara E1 → E2 pero escribe E7 en la cabecera | No detectado | H15, H02 | Bloqueado por reglas (H15) |
| A1-d | Cambiar `historial[k]` de una orden sin comprobante (consola) | No detectado | H14 | No detectado (pendiente, H14) |
| A1-e | Registrar desde HTTP por IP local (hash de respaldo no criptográfico) | No detectado al guardar; luego falso "alterado" en HTTPS | H12, H13 | Ya no se guarda sin https (H12) |
| A1-f | Antedatar `registradoEn` de un evento | No detectado | H19 | En la rama: los registros nuevos guardan la hora del servidor y se avisa si la declarada difiere más de 10 minutos (H19) |
| A1-g | Reescribir `huellas` para señalar otro dato | Detectado y avisado, con diagnóstico equivocado | H35 | Detectado y avisado |
| A1-h | Quitar la última resolución de una anotación (consola) | No detectado | H36 | Detectado y avisado |
| A1-i | Quitar `hashAnterior` de un bloque de comprobante | No detectado | H16 | Detectado y avisado |
| A1-j | Cambiar la ficha nutricional o los rangos tras el cierre | No detectado (cambia certificados antiguos) | H22, H41 | Configuración protegida (H22); la ficha no queda sellada (H41 pendiente) |
| A3-a | Crear un lote atribuido a otra persona, con código distinto del id y hash inválido en evento 0 | No detectado | H21 | Bloqueado por reglas (H21) |
| A3-b | Poner el nombre visible de otra persona y firmar eventos | No detectado | H45 | Parcial (H45) |
| A3-c | Guardar como "foto" una URL externa con su hash coherente | No detectado | H13 | Bloqueado por reglas (H13) |
| A3-d | Recrear la foto vencida (TTL) con otro contenido | Detectado sin aviso | H13, H07 | Bloqueado por reglas (H13) |
| A3-e | Avanzar `contadores/lotes_global` sin crear lote | No detectado | H48 | Parcial (H48) |
| A3-f | Escribir `pdfUrl: 'javascript:...'` y campos inventados al sellar | No detectado | H01 | Bloqueado por reglas (H01) |

## 3. Hallazgos

Área asignada pensando también en quién es dueño del archivo (ver sección 4). Marcas: **(requiere datos reales / consultar)** si el arreglo implica migrar o recalcular documentos de producción o puede dar avisos sobre ellos; **(decisión del usuario)** si cambia comportamiento visible de forma discutible.

### Crítica

#### H01. Las reglas dejan cambiar cabecera y resumen del lote al sellar, y el resumen del lote activo sin evento
- Severidad: crítica · Área: REGLAS · Origen: Agente1 C1, Agente2 F1, Agente3 S1, S2
- Archivos: `firestore.rules:226-230` (caso B, cierre), `firestore.rules:166-175` (`loteActivoCoherente`).
- Reproducción: operador con solo `cerrarLotes` hace `updateDoc` con `estado:'cerrado'`, `estanque:'E9'`, `cantidadSembrada`, `producto`, `origen`, `resumen.supervivencia`, `pdfUrl:'javascript:alert(1)'` y un campo inventado: pasa. Con lote activo, quien registra eventos cambia `resumen` sin agregar evento: pasa. Pruebas "HUECO" en `tests/seguridad/seguridad.test.mjs`.
- Impacto: certificado público y PDF con datos falsos marcados "íntegros"; tras el sello ya no se puede corregir. Cambiar `estanque` altera además la regla de reservas (`firestore.rules:469`).
- Arreglo: caso B con `diff(resource.data).affectedKeys().hasOnly(['estado','fechaCierre','resumen','pdfPath','pdfUrl','versionPdf','pdfActualizadoEn','actualizadoEn'])`, `resumen.hashFinal == eventos[size-1].hash`, `fechaCierre` con formato de fecha y `pdfUrl` fijo o no editable. Caso A: `resumen` solo cambia si `eventos` crece. Pasar las pruebas HUECO a `assertFails`.
- Estado: Corregido y desplegado

#### H02. La vista pública, el PDF y el detalle muestran cabecera y resumen guardados, no derivados de la cadena
- Severidad: crítica · Área: INTEGRIDAD-APP · Origen: Agente1 C1 (puntos 3 y 4), Agente2 F1 (c), Agente3 S1, S2 (arreglo)
- Archivos: `src/components/PublicTraceabilityView.tsx:326-347, 432-468`; `src/services/pdfService.ts:301-339`; `src/components/LoteDetailModal.tsx`; `src/components/IntegrityCheckModal.tsx`; `src/services/hashService.ts:218-237`; `src/services/lotesService.ts` (`cerrarLote`).
- Reproducción: ataque 7 (consola) o H01 (usuario): todo se ve "íntegro" con E9, 5000 peces, 99,9 %, 900 g.
- Impacto: aunque se cierre H01, cualquier edición por consola de esos campos pasa sin aviso.
- Arreglo: calcular la cabecera desde el evento 0 más las correcciones de siembra y el resumen con `recalcularResumenLote(eventos)`; si difiere de lo guardado, aviso rojo "Los indicadores no corresponden a las fases registradas" (excluir o tolerar lo que depende de la configuración). Para lotes nuevos, agregar un evento final "Cierre" cuyo `datos` lleve cabecera, `fechaCierre` y resumen, y cuyo hash sea el `hashFinal`. **(requiere datos reales / consultar)**: antes de activar el aviso, comprobar con los lotes reales que el recálculo coincide con lo guardado, para no marcar en rojo lotes legítimos.
- Estado: Corregido y desplegado

### Alta

#### H03. No hay ancla fuera de Firestore: una reescritura completa no se detecta
- Severidad: alta · Área: INTEGRIDAD-APP · Origen: Agente1 A3, Agente2 F2
- Archivos: `src/services/hashService.ts:69-104, 218-237, 359-362`; `src/services/anotacionesService.ts:24-37, 949-960`; `src/services/qrService.ts:11-16`; `src/components/PublicTraceabilityView.tsx`.
- Reproducción: ataques 6b, 6c, 8c, A2 (`recalcularCadenaLote`, `recalcularAnotaciones` en `tests/integridad/ataques.ts`).
- Impacto: SHA-256 sin clave es público; quien tenga la consola, una cuenta de servicio o el Admin SDK reescribe historial y anotaciones sin rastro. Borrar el documento de anotaciones tampoco se nota.
- Arreglo: (1) incluir el sello en el QR del certificado y de la etiqueta, `?lote=CODIGO&s=<16 hex de hashFinal>`, y comparar en la vista pública **(decisión del usuario)**, cambia el contenido del QR y las etiquetas ya impresas no lo traerían; (2) llevar en el lote un contador de anotaciones aprobadas para detectar el borrado; (3) a futuro, firmar `hashFinal` con una Cloud Function y Secret Manager, o sellar en el tiempo (OpenTimestamps) **(requiere datos reales / consultar)** para firmar los lotes ya cerrados; (4) documentar en la tesis el alcance real de la cadena.
- Estado: Parcial, desplegado: el QR de los lotes cerrados lleva el sello (&s=) y la vista pública lo compara; las etiquetas impresas antes no lo traen. Falta un ancla fuera de Firestore para las anotaciones (A2): pendiente de tu aprobación

#### H04. `verificarComprobante` no usa el hash que guarda la orden ni reconstruye el comprobante
- Severidad: alta · Área: INTEGRIDAD-APP · Origen: Agente1 A1 (parte app), Agente2 F5
- Archivos: `src/services/comprobantesService.ts:467-495` (y `:369-375`, donde se escribe el evento "Comprobante emitido"); `src/components/DocumentacionEntrega.tsx:82-85`.
- Reproducción: ataque 9c (cantidad 80 y otro cliente): público e interno "íntegro". También A1-a.
- Impacto: el cliente que escanea el QR ve cantidades o destinatario falsos validados.
- Arreglo: exigir `c.hashComprobante == datos.hashComprobante` del evento "Comprobante emitido"; reconstruir con `construirComprobante` sobre el historial truncado en `eventoEntregaIndice` y comparar campo a campo (salvo `id`, `version`, `token`, `uid`, `emitidoEn`). En lo público, depende de H03 para un ancla externa.
- Estado: Corregido y desplegado

#### H05. Las reglas del comprobante no validan cliente, fechas, entregas ni `fotoHash`
- Severidad: alta · Área: REGLAS · Origen: Agente1 A1 (parte reglas)
- Archivos: `firestore.rules:1031-1068` (`comprobanteValido`).
- Reproducción: A1-a. Una cuenta con `gestionarComprobantes` escribe un comprobante con cantidades correctas y `cliente.nombre`, `fechas` o `entregas[].fotoHash` inventados; las reglas lo aceptan.
- Impacto: documento al cliente con datos falsos que verifica como auténtico.
- Arreglo: comparar `c.cliente.nombre == o.clienteNombre`, `c.cliente.direccion == o.get('clienteDireccion','')`, `c.repartidor == o.get('repartidorNombre','')`, las fechas con los campos de la orden y `c.eventosUsados.size()` con los eventos documentados.
- Estado: Corregido y desplegado

#### H06. Borrar la última fase o vaciar el sello no se avisa automáticamente
- Severidad: alta · Área: INTEGRIDAD-APP · Origen: Agente1 A2, Agente2 F3
- Archivos: `src/components/LoteDetailModal.tsx:350-351`; `src/components/PublicTraceabilityView.tsx:141-150, 481`; `src/services/hashService.ts:133-139, 225-229, 360`.
- Reproducción: ataque 8 en un lote sin anotaciones: todo se ve normal y solo el botón dice que el sello no coincide. A1-b: `eventos` vacío da "Cadena íntegra: 0 fases".
- Impacto: se puede quitar una Cosecha, Mortalidad o Despacho sin aviso al abrir el QR.
- Arreglo: usar `an.valido` y `an.selloCoincide` en la etiqueta de `LoteDetailModal` y en un aviso rojo automático de la vista pública; en `verificarIntegridadLote` y `analizarCadenaLote`, si el lote está cerrado exigir eventos, primero "Siembra" y `hashFinal` no vacío; llevar `selloCambiado` de anotaciones al aviso global.
- Estado: Corregido y desplegado

#### H07. Fotos de entrega: verificación solo manual, borrado igual a vencimiento, sin cruce con el comprobante
- Severidad: alta · Área: INTEGRIDAD-APP · Origen: Agente1 A4, M8, Agente2 F4
- Archivos: `src/components/FotosEntregaOrden.tsx:40-74` (`:57-60` texto de no disponible); `src/services/fotosService.ts:113-116`.
- Reproducción: ataques 1, 2, 3, 3b y 10.
- Impacto: la evidencia de entrega se puede sustituir o borrar sin que nadie lo note.
- Arreglo: verificar cada foto al cargar (sello verde o rojo; si falla, imagen en gris con "La foto no coincide con la registrada"); si falta y no han pasado 15 días desde el evento, "La foto se borró antes de su vencimiento" en rojo; distinguir error de permisos de documento ausente; comparar con `fotoHash` del comprobante vigente; comprobar `foto.eventoId` y `foto.ordenId`.
- Estado: Corregido y desplegado

#### H08. Mortalidad y cosecha sin tope: datos imposibles quedan sellados
- Severidad: alta · Área: FUNCIONAL · Origen: Agente4 1
- Archivos: `src/components/NuevoEventoModal.tsx:173-178, 190-198`; `src/services/lotesService.ts` (`registrarEventoEnLote`).
- Reproducción: lote de 5 000 peces, Mortalidad 999 999, Cosecha 1 000 con 0 vivos, cerrar: se sella con supervivencia 0 % y "Cadena íntegra".
- Impacto: un error de tipeo arruina el lote para siempre; la orden ofrece kilos que no existen.
- Arreglo: `max={r.pecesVivos}` en el modal y comprobar mortalidad + cosecha <= vivos; repetir la comprobación dentro de la transacción de `registrarEventoEnLote`. Opcional, coordinado con REGLAS: invariante en reglas sobre el resumen. **(requiere datos reales / consultar)** si se añade invariante en reglas: revisar antes que ningún lote real activo la incumpla.
- Estado: Corregido y desplegado en la app (tope dentro de la transacción y en el formulario; probado en producción). Las reglas no ponen tope: desde la consola se podría saltar

#### H09. Se aceptan fases con fecha anterior a la siembra o a la fase previa
- Severidad: alta · Área: FUNCIONAL · Origen: Agente4 2
- Archivos: `src/components/NuevoEventoModal.tsx:140, 331`.
- Reproducción: lote sembrado el 2026-11-10, "Calidad del agua" con fecha 2026-11-01: se guarda.
- Impacto: línea de tiempo pública incoherente y sellada.
- Arreglo: `min={lote.fechaSiembra}` en el input; en `handleSubmit`, error si `fechaEvento < lote.fechaSiembra`; opcional, exigir motivo si es anterior a la última fase.
- Estado: Corregido y desplegado

#### H10. Doble toque en "Iniciar ruta" o "Registrar llegada" deja una acción en conflicto
- Severidad: alta · Área: FUNCIONAL · Origen: Agente4 3
- Archivos: `src/components/DetalleEntregaRepartidor.tsx:410-421`; `src/services/repartoService.ts:181-205`.
- Reproducción: doble toque en "Iniciar ruta": dos acciones en la bandeja; a los 30 s la segunda falla con "No se aplicó".
- Impacto: el repartidor ve un error sin haber hecho nada mal; con mala señal es lo normal.
- Arreglo: en `registrarAccion`, si ya hay una acción del mismo `tipo` y `ordenId` en "guardada" o "enviando", devolver esa; deshabilitar el botón al primer toque con estado local.
- Estado: Corregido y desplegado

#### H11. Hojas inferiores del celular recortadas: botones finales inalcanzables
- Severidad: alta · Área: DISENO-REGRESION · Origen: Agente5 1, Agente4 7 (parte de recorte)
- Archivos: `src/index.css:319-331`; `src/components/NuevoLoteModal.tsx:110`; `src/components/QrModal.tsx:65-66`; `src/components/IntegrityCheckModal.tsx:53`; `src/components/AuthModal.tsx:139`.
- Reproducción: a 360 x 640, "Crear lote", "Descargar Certificado PDF" y "Cerrar" de Integridad quedan bajo el borde sin desplazamiento posible. A 639 px de alto en escritorio el QR también se corta.
- Impacto: un operador con teléfono pequeño no puede crear lotes ni descargar el certificado.
- Arreglo: añadir `overflow-y: auto; overscroll-behavior: contain;` a `.velo > *` en el bloque móvil, o `overflow-y-auto` en vez de `overflow-hidden` en los cuatro contenedores; `max-h-[calc(100dvh-2rem)]` en la caja del QR; quitar `my-6` de NuevoLoteModal en móvil.
- Estado: Corregido y desplegado

### Media

#### H12. `calcularSha256` cae a un hash no criptográfico en contextos no seguros, y el modo desarrollo usa la base de producción
- Severidad: media · Área: INTEGRIDAD-APP · Origen: Agente1 M1 (parte app)
- Archivos: `src/services/hashService.ts:69-96`; `package.json:7` (`--host=0.0.0.0`); `src/firebase/firebaseConfig.ts:45`.
- Reproducción: modo desarrollo abierto desde el teléfono por `http://192.168.x.x:3000`: el evento se guarda en producción con hash de respaldo.
- Impacto: eventos marcados "alterados" para siempre en HTTPS; falso válido en contexto inseguro; respaldo débil a colisiones; solo deja `console.warn`.
- Arreglo: quitar el respaldo y bloquear el registro con "Abre la app por HTTPS"; usar emuladores por defecto en desarrollo. **(requiere datos reales / consultar)**: revisar si producción ya tiene hashes con la forma `0{18}hex{14}0{18}hex{14}`.
- Estado: Parcial, desplegado: sin https la app ya no guarda ni da falsos resultados. Que `npm run dev` use la base de producción por defecto queda pendiente de tu decisión

#### H13. Las reglas no validan la forma de los hashes ni el contenido de las fotos
- Severidad: media · Área: REGLAS · Origen: Agente1 M1 (parte reglas), B4 (parte reglas), Agente3 S10
- Archivos: `firestore.rules:127, 251, 1065-1067, 1218-1239`.
- Reproducción: A1-e, A3-c (URL externa como foto) y A3-d (recrear la foto tras el TTL).
- Impacto: hashes de respaldo aceptados; una URL externa en `<img src>` filtra IP y hora de quien abre la orden (`FotosEntregaOrden.tsx:42,93`, `DetalleEntregaRepartidor.tsx:496`); foto sustituible tras vencer.
- Arreglo: hashes con `matches('^[0-9a-f]{64}$')` y `!matches('^0{18}[0-9a-f]{14}0{18}[0-9a-f]{14}$')`; `f.datos.matches('^data:image/jpeg;base64,[A-Za-z0-9+/=]+$')`; exigir que la orden gane un evento en la misma operación (`getAfter(...).historial.size() == get(...).historial.size() + 1`).
- Estado: Corregido y desplegado

#### H14. El historial de las órdenes no tiene cadena de hashes
- Severidad: media · Área: INTEGRIDAD-APP · Origen: Agente1 M2
- Archivos: `src/services/pedidosService.ts:179-198` (`nuevoEvento`); `src/services/repartoService.ts:430`; parte de reglas en `firestore.rules:933, 1266` (la hace REGLAS).
- Reproducción: A1-d; también 3b.
- Impacto: eventos sin comprobante (asignación, cambio de repartidor, novedades, `datos.foto`) se pueden cambiar por consola sin aviso.
- Arreglo: encadenar `EventoOrden` como los eventos del lote (hash de JSON canónico más `hashAnterior`), regla `hashAnterior == historial[n-1].hash` para eventos nuevos y verificar al abrir la orden. **(requiere datos reales / consultar)**: decidir cómo tratar las órdenes existentes (marcar su historial previo como "sin cadena" en lugar de recalcularlo).
- Estado: Corregido y desplegado: cadena de hashes en los eventos nuevos de las órdenes; los anteriores se muestran como registros previos a la cadena

#### H15. La corrección de siembra solo comprueba qué campos cambian, no sus valores
- Severidad: media · Área: REGLAS · Origen: Agente1 M3
- Archivos: `firestore.rules:145-152` (`siembraCoherente`); `src/services/lotesService.ts:395-397`.
- Reproducción: A1-c.
- Impacto: cabecera distinta de lo que dice el evento, con cadena íntegra.
- Arreglo: guardar en `datos` los valores nuevos con tipo (`nuevo: {estanque: 'E2', ...}`) y exigir `request.resource.data[k] == ev.datos.nuevo[k]` (el cambio en `lotesService` lo hace INTEGRIDAD-APP). H02 lo detecta además en pantalla.
- Estado: Corregido y desplegado

#### H16. La consulta pública de entrega ignora bloques faltantes y no muestra la verificación de anulaciones
- Severidad: media · Área: INTEGRIDAD-APP · Origen: Agente1 M4, B7, Agente2 F6
- Archivos: `src/services/comprobantesService.ts:407-425, 431-452`; `src/components/ConsultaEntregaPublica.tsx:29-44, 51, 152, 160-164`.
- Reproducción: ataques 9e y 9f; A1-i.
- Impacto: un comprobante anulado aparece vigente ante el cliente; un bloque rebajado a "sin enlace" se acepta.
- Arreglo: si `bloques.length < Object.keys(consulta.versiones).length`, aviso rojo "Falta un registro de la cadena" y ningún comprobante como vigente; exigir versiones 1..N sin huecos y `ultimaVersion` como la mayor; bloque sin `hashAnterior` con versión mayor que uno enlazado es inválido; mostrar sello verde o rojo en las anulaciones; en 9e, decir "Falta el comprobante registrado" en vez de "No se encontró".
- Estado: Corregido y desplegado

#### H17. El PDF del comprobante no verifica nada antes de generarse
- Severidad: media · Área: INTEGRIDAD-APP · Origen: Agente1 M5
- Archivos: `src/services/pdfService.ts:624-826, 840-856`.
- Reproducción: comprobante alterado (en rojo en la consulta), pulsar "PDF": sale limpio.
- Arreglo: llamar a `verificarComprobante` y `verificarCadena` al generar; si falla, recuadro rojo y marca de agua "Comprobante alterado: no válido".
- Estado: Corregido y desplegado

#### H18. Comprobantes no anclados al sello del lote
- Severidad: media · Área: INTEGRIDAD-APP · Origen: Agente1 M6
- Archivos: `src/services/comprobantesService.ts:237-306`; `src/components/ConsultaEntregaPublica.tsx:132-142`; parte de reglas (la hace REGLAS).
- Impacto: si el lote cambia tras la entrega, la consulta no lo sabe.
- Arreglo: guardar `selloLote = hashFinal` en cada procedencia de comprobantes nuevos (regla `== get(lote).data.resumen.hashFinal`, lote cerrado) y comparar al abrir "Ver lote".
- Estado: Corregido y desplegado: los comprobantes nuevos guardan el sello de cada lote y el estado de sus anotaciones; la consulta pública y el panel avisan si cambiaron

#### H19. Las fechas de registro vienen del reloj del cliente y las reglas no las validan
- Severidad: media · Área: INTEGRIDAD-APP · Origen: Agente1 M7
- Archivos: `src/services/lotesService.ts:259`; `pedidosService.ts:189`; `comprobantesService.ts:337`; `fotosService.ts:87`; anotaciones; reglas `firestore.rules:123-133` (`eventoNuevoValido`), `registroAnotacionValido`, `comprobanteValido` (las hace REGLAS).
- Reproducción: A1-f.
- Impacto: se puede antedatar un registro y el sello lo "certifica".
- Arreglo: campo de nivel superior `selladoEnServidor` con `serverTimestamp()` y regla `== request.time`; comparar con `registradoEn` del último evento con tolerancia; o validar en reglas que `registradoEn` empiece con la fecha de `request.time`.
- Estado: Corregido y desplegado (despliegues 6 a 9) para órdenes, comprobantes, lotes y anotaciones nuevos. Lotes y anotaciones: mapa `registradoEnServidor["<índice>"]` fuera del hash, con regla `== request.time` y sin tocar las horas anteriores; si el documento ya tiene horas, cada registro nuevo debe dejar la suya. El detalle, el panel de anotaciones y la vista pública muestran la hora del servidor y avisan si la declarada difiere más de 10 minutos. Los registros anteriores no tienen hora del servidor y no se tocan.

#### H20. La lectura pública de lotes y anotaciones expone correos y uid del personal; los códigos se adivinan
- Severidad: media · Área: REGLAS · Origen: Agente3 S3
- Archivos: `firestore.rules:202, 307`; `src/services/lotesService.ts:108` (formato `AAAAMMDD-LETRA-ESTANQUE`).
- Reproducción: `GET` REST con la API key pública sobre `lotes/20261023-A-E1`; un script recorre todos los códigos, incluidos lotes activos.
- Impacto: lista de correos del personal y de toda la producción.
- Arreglo: permitir `get` público solo si `estado == 'cerrado'`; para lo nuevo, no guardar correos en lo público (uid o nombre) o publicar `lotesPublicos/{codigo}` saneado al cerrar. **(decisión del usuario)** (ocultar lotes activos y correos del público) **(requiere datos reales / consultar)**: en los lotes sellados el correo está dentro del hash y no se puede quitar sin romper la cadena.
- Estado: Parcial, desplegado (despliegues 8 y 9): los lotes, fases y anotaciones nuevos se firman con el uid (`registradoPor`, `creadoPor`) y el nombre visible; el correo ya no se guarda en lo público y las pantallas internas lo leen en `usuarios/{uid}`. La vista pública y el PDF muestran el nombre (o "Personal de la granja" si no hay nombre). Las reglas aceptan el uid o el correo de la sesión (compatibilidad con la versión publicada). Los registros anteriores conservan el correo dentro del hash (no se modifican; se siguen mostrando enmascarados). La lectura pública de lotes activos y la enumeración de códigos siguen igual (decisión pendiente).

#### H21. Al crear un lote se puede atribuir a otra persona y el evento 0 no se valida
- Severidad: media · Área: REGLAS · Origen: Agente3 S4
- Archivos: `firestore.rules:206-213`.
- Reproducción: A3-a.
- Impacto: repudio; código mostrado distinto del id que abre el QR.
- Arreglo: exigir `creadoPorUid == request.auth.uid`, `creadoPor == correoSesion()`, `eventos[0].registradoPor == correoSesion()`, `nombrePropio(eventos[0])`, `hashAnterior` génesis `0`×64, hash hex de 64, `codigo == {codigo}` y `keys().hasOnly(...)`.
- Estado: Corregido y desplegado

#### H22. La configuración no tiene forma validada, se puede borrar o listar y no está separada por granja
- Severidad: media · Área: REGLAS · Origen: Agente3 S7
- Archivos: `firestore.rules:1334-1342`.
- Reproducción: pruebas HUECO de configuración (borrar, escribir cualquier forma, admin de otra granja, anónimo lista). A1-j.
- Impacto: cambiar la ficha nutricional cambia de forma retroactiva los certificados; borrar el documento deja la app con valores por defecto o fallando.
- Arreglo: `docId == 'general'`, `delete` solo maestro, `list` cerrado, validar tipos (`estanques is list`, números en la ficha) y comparar la granja. Congelar la ficha en el cierre está en H41.
- Estado: Corregido y desplegado

#### H23. Vercel no envía cabeceras de seguridad
- Severidad: media · Área: CONFIG-EXTERNA · Origen: Agente3 S13
- Archivos: `vercel.json` (no existe).
- Reproducción: `curl -I` a la vista previa: solo `Strict-Transport-Security`.
- Impacto: clickjacking de la sesión de administrador; sin segunda barrera ante una inyección.
- Arreglo: `vercel.json` con `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), geolocation=()` y la CSP propuesta por el Agente 3 (con `frame-ancestors 'none'`), primero como `Content-Security-Policy-Report-Only` en la vista previa.
- Estado: Corregido y desplegado: CSP completa (scripts propios y de Google, conexiones a Firebase y Google, sin objetos ni marcos ajenos) más X-Frame-Options, nosniff, Referrer-Policy y Permissions-Policy

#### H24. Sin App Check y configuración de Auth por revisar
- Severidad: media · Área: CONFIG-EXTERNA · Origen: Agente3 S14
- Archivos: `src/firebase/firebaseConfig.ts` (sin `initializeAppCheck`); `firebase-applet-config.json` (`recaptchaSiteKey` vacío).
- Impacto: con la API key pública se usa la REST desde fuera: recorrer lotes (H20), crear cuentas en masa, llenar perfiles pendientes (H46).
- Arreglo: App Check con reCAPTCHA Enterprise (primero métricas, luego obligatorio en Firestore); protección contra enumeración de correos en Auth; evaluar si el registro libre hace falta **(decisión del usuario)**. Ver sección 5.
- Estado: Pendiente de tu revisión en la consola (App Check, enumeración de correos, registro libre)

#### H25. La anotación acepta texto en un dato numérico
- Severidad: media · Área: INTEGRIDAD-APP · Origen: Agente4 4
- Archivos: `src/components/AnotacionesLotePanel.tsx:51-53, 154-162`; `src/services/anotacionesService.ts:148`.
- Reproducción: anotación sobre Mortalidad, Cantidad, valor "abc": se crea.
- Impacto: una vez aprobada, el certificado mostraría "abc" como valor correcto, de forma inmutable.
- Arreglo: si el dato original es número, `type="number"` y `Number.isFinite(Number(valor))`, también en el servicio.
- Estado: Corregido y desplegado

#### H26. El administrador ve "Tu cuenta no tiene una función de producción" mientras se sincroniza su perfil
- Severidad: media · Área: FUNCIONAL · Origen: Agente4 5
- Archivos: `src/App.tsx:271-273, 578`; `src/services/usuariosService.ts:355-363`.
- Reproducción: ingresar o recargar como administrador maestro: de 1 a 30 s de aviso falso.
- Impacto: mensaje falso de falta de permisos con señal débil; si la conexión cae entre `getDoc` y `setDoc`, queda pendiente sin fin.
- Arreglo: `setPerfilUsuario(perfil)` antes de escribir y `setDoc` sin `await` (o solo si cambió algo); mostrar "Cargando tu perfil..." mientras `usuario && !perfilUsuario`.
- Estado: Corregido y desplegado

#### H27. La vista pública de un lote activo dice "Sello hash SHA-256 de cierre del lote"
- Severidad: media · Área: INTEGRIDAD-APP · Origen: Agente4 6
- Archivos: `src/components/PublicTraceabilityView.tsx:421-424`.
- Impacto: el cliente cree que el lote está cerrado y sellado.
- Arreglo: si `lote.estado !== 'cerrado'`, rótulo "Huella de la última fase registrada (el lote sigue abierto)".
- Estado: Corregido y desplegado

#### H28. Se puede eliminar un estanque con lotes sin ningún aviso
- Severidad: media · Área: FUNCIONAL · Origen: Agente4 8
- Archivos: `src/components/ConfiguracionTab.tsx:169-184`.
- Impacto: lotes con estanque inexistente; densidad, Analítica, Comparativo y Ocupación dejan de mostrarlo.
- Arreglo: pasar `lotes` a la pestaña; bloquear (o confirmación explícita con el número de lotes) si hay lotes activos en ese estanque.
- Estado: Corregido y desplegado

#### H29. Las vistas previas de PDF usan `window.open` después de un `await`
- Severidad: media · Área: INTEGRIDAD-APP · Origen: Agente4 9
- Archivos: `src/services/pdfService.ts:609-613, 840-843`.
- Impacto: en Safari iOS o con bloqueadores "Ver preliminar" puede no hacer nada; los `objectURL` no se liberan.
- Arreglo: abrir la ventana antes del `await` y luego asignar `location`; si es null, descargar; `URL.revokeObjectURL` tras unos segundos.
- Estado: Corregido y desplegado

#### H30. Al iniciar sesión la app se monta, se desmonta y se vuelve a montar
- Severidad: media · Área: DISENO-REGRESION · Origen: Agente5 2
- Archivos: `src/lib/presencia.ts:28`; `src/App.tsx:399, 442-449`.
- Reproducción: MutationObserver al pulsar "Ingresar": app, ingreso, app en 220 ms.
- Impacto: parpadeo en blanco, montajes y suscripciones duplicadas; la salida animada no se ve.
- Arreglo: `return { montado: abierto || montado, saliendo: !abierto && montado }`.
- Estado: Corregido y desplegado

#### H31. La posición de scroll por pestaña no se restaura
- Severidad: media · Área: DISENO-REGRESION · Origen: Agente5 3
- Archivos: `src/App.tsx:82-90`.
- Impacto: el usuario vuelve a otro punto de la lista.
- Arreglo: guardar `window.scrollY` en una función `cambiarTab` antes de `setTabActiva`; restaurar reintentando mientras la altura no alcance (ResizeObserver hasta 1 s), o renunciar y llevar siempre arriba.
- Estado: Corregido y desplegado

#### H32. Ventanas sin Escape, sin cierre al tocar fuera, sin foco atrapado ni bloqueo del scroll de fondo
- Severidad: media · Área: DISENO-REGRESION · Origen: Agente5 4, Agente4 7 (parte Escape), Agente4 15
- Archivos: `AuthModal.tsx:138`, `QrModal.tsx:65`, `IntegrityCheckModal.tsx:52`, `NuevoLoteModal.tsx:109`, `NuevoEventoModal.tsx:252`, `NuevaOrdenModal.tsx:168`, `LoteDetailModal.tsx:250, 716`, `EntregasPanel.tsx:323` (todos en `src/components/`).
- Impacto: accesibilidad de teclado y lector de pantalla; en el teléfono se mueve la página de atrás.
- Arreglo: hook `useVentana(abierta, onCerrar, { bloqueada })` junto a `usePresencia`: Escape, clic en el velo (salvo guardando), foco al abrir y devolución al cerrar, Tab atrapado, `overflow: hidden` en `body`.
- Estado: Corregido y desplegado

#### H33. Carga diferida sin ErrorBoundary: pantalla en blanco si falla un paquete
- Severidad: media · Área: DISENO-REGRESION · Origen: Agente5 5
- Archivos: `src/App.tsx:5, 30-37, 445, 559`.
- Impacto: tras un despliegue nuevo o con red intermitente, página en blanco, incluida la pantalla de ingreso.
- Arreglo: ErrorBoundary alrededor de cada `Suspense` con botón "Recargar"; `vite:preloadError` con recarga única marcada en `sessionStorage`.
- Estado: Corregido y desplegado

### Baja

#### H34. `?lote=%25` deja la vista pública cargando para siempre
- Severidad: baja · Área: INTEGRIDAD-APP · Origen: Agente2 F7, Agente3 S20
- Archivos: `src/components/PublicTraceabilityView.tsx:82`.
- Reproducción: `/?lote=%25`: `URIError` fuera del `try`, `setCargando(false)` nunca corre. `?lote=a/b` y `__x__` dicen "verifica tu conexión" (engañoso).
- Arreglo: quitar el doble `decodeURIComponent` o meterlo en el `try`; validar `^[A-Za-z0-9_-]{1,64}$` antes de consultar.
- Estado: Corregido y desplegado

#### H35. El rastro por dato (`huellas`) está fuera del hash
- Severidad: baja · Área: INTEGRIDAD-APP · Origen: Agente1 B1
- Archivos: `src/services/hashService.ts:245-251, 336-342`; `src/services/lotesService.ts:151`.
- Impacto: el diagnóstico puede señalar el dato equivocado (la alteración sí se detecta).
- Arreglo: incluir `huellas` en el payload de eventos nuevos o presentarlo como "pista".
- Estado: Pendiente (baja): no se abordó

#### H36. Anotaciones: borrar la última resolución no se detecta y `resueltas` no se cruza
- Severidad: baja · Área: INTEGRIDAD-APP · Origen: Agente1 B2
- Archivos: `src/services/anotacionesService.ts:40-58, 186-228`.
- Reproducción: A1-h.
- Arreglo: cruzar `resueltas` con los registros de resolución, exigir `indice` igual a la posición e incluir `registradoPorUid` en el hash de registros nuevos.
- Estado: Parcial, desplegado: se detecta la resolución borrada y la posición alterada

#### H37. La vista pública muestra anotaciones antes de verificarlas o si la verificación falla
- Severidad: baja · Área: INTEGRIDAD-APP · Origen: Agente1 B3
- Archivos: `src/components/PublicTraceabilityView.tsx:122-138`.
- Arreglo: mostrarlas solo cuando exista `verifAnotaciones`; si falla, "No se pudo verificar".
- Estado: Corregido y desplegado

#### H38. El hash de la foto prueba la copia comprimida, no la captura (sin EXIF)
- Severidad: baja · Área: INTEGRIDAD-APP · Origen: Agente1 B4 (parte app)
- Archivos: `src/services/fotosService.ts:62-89`; `src/components/DetalleEntregaRepartidor.tsx:484-486`.
- Arreglo: rotular como "integridad de la copia guardada"; opcional, guardar la fecha EXIF antes de comprimir.
- Estado: Pendiente de tu aprobación: fecha EXIF de la foto (campo nuevo)

#### H39. El PDF del lote no marca la fase alterada e imprime el sello guardado
- Severidad: baja · Área: INTEGRIDAD-APP · Origen: Agente1 B5
- Archivos: `src/services/pdfService.ts:433-462, 542-559`.
- Arreglo: usar `analizarCadenaLote` para marcar filas en rojo; imprimir el último hash recalculado y el guardado si difiere.
- Estado: Corregido y desplegado

#### H40. El QR toma el origen del navegador
- Severidad: baja · Área: INTEGRIDAD-APP · Origen: Agente1 B6
- Archivos: `src/services/qrService.ts:11-26`.
- Impacto: QR generados desde `localhost`, IP local o vista previa apuntan a orígenes que pueden desaparecer; respaldo `cultivos-lore.web.app` sin uso.
- Arreglo: origen oficial por variable de entorno y quitar el respaldo `web.app`. **(decisión del usuario)**: fija el dominio que llevan los QR.
- Estado: Parcial, desplegado: el código usa VITE_ORIGEN_PUBLICO si existe; falta definirla en Vercel con el dominio oficial

#### H41. Ficha nutricional, rangos de agua y volumen del estanque usados por el certificado no están sellados
- Severidad: baja · Área: INTEGRIDAD-APP · Origen: Agente1 B8, Agente3 S7 (parte impacto)
- Archivos: `src/components/PublicTraceabilityView.tsx:604-630`; `src/services/pdfService.ts:342-369, 511-530`.
- Reproducción: A1-j.
- Arreglo: congelar ficha y rangos en el evento de cierre de lotes nuevos (ver H02).
- Estado: Pendiente de tu aprobación: congelar la ficha nutricional en el cierre (campo nuevo)

#### H42. El comprobante público incluye dirección del cliente, novedades internas y uid
- Severidad: baja · Área: INTEGRIDAD-APP · Origen: Agente3 S12
- Archivos: `src/services/comprobantesService.ts:279-303`; `firestore.rules:1094`.
- Impacto: quien fotografíe el comprobante impreso ve dirección y novedades (el token no se puede adivinar).
- Arreglo: no incluir dirección completa, novedades internas ni `emitidoPorUid` en comprobantes nuevos. **(decisión del usuario)**
- Estado: Corregido y desplegado: la consulta pública y el PDF ya no muestran dirección ni novedades; los comprobantes nuevos guardan solo su hash

#### H43. Etiquetas de datos sin traducir en la vista pública, el PDF y las anotaciones
- Severidad: baja · Área: INTEGRIDAD-APP · Origen: Agente4 10
- Archivos: `src/services/hashService.ts:270-297`; `src/services/pdfService.ts:~40-60` (`NOMBRE_DATO`).
- Reproducción: Mortalidad muestra "causaProbable: ...".
- Arreglo: un único `NOMBRE_DATO` compartido y completo (`causaProbable`, `producto`, `dosis`, `tallaPromedioCm`, `tipoEmpaque`, `destino`, `motivoCorreccion`, etc.).
- Estado: Corregido y desplegado

#### H44. Reglas al borde del límite de 1000 expresiones
- Severidad: baja · Área: REGLAS · Origen: Agente2 F8
- Archivos: `firestore.rules:217, 1313`.
- Impacto: hoy niega (seguro), pero un cambio pequeño puede romper operaciones legítimas con historiales largos. Relevante al aplicar H01, H05, H13.
- Arreglo: cortar antes con condiciones baratas en reglas separadas y probar historiales largos.
- Estado: Corregido y desplegado

#### H45. Se pueden firmar eventos con el nombre de otra persona
- Severidad: baja · Área: REGLAS · Origen: Agente3 S5
- Archivos: `firestore.rules:255-257, 420-422`.
- Reproducción: A3-b.
- Arreglo: `displayName is string && size() <= 80` y que lo fije el administrador, o mostrar en público algo no elegible.
- Estado: Parcial, desplegado: tope de 120 caracteres y, en los registros nuevos, `registradoPorNombre` debe ser igual al `displayName` del perfil (las reglas ya lo exigían; se mantiene con la firma uid). Como cada persona puede cambiar su propio nombre visible, que solo el administrador lo fije queda a tu decisión.

#### H46. El alta propia no limita campos ni tamaños
- Severidad: baja · Área: REGLAS · Origen: Agente3 S6
- Archivos: `firestore.rules:1405-1414`.
- Reproducción: alta con campo de 200 KB y `autorizadoPor` falso: pasa.
- Arreglo: `keys().hasOnly([...])` y límites de tamaño.
- Estado: Corregido y desplegado

#### H47. Un administrador lee perfiles de cualquier granja
- Severidad: baja · Área: REGLAS · Origen: Agente3 S8
- Archivos: `firestore.rules:1395`.
- Arreglo: añadir `isMasterAdmin() || resource.data.get('granjaId','cultivos-lore') == granjaUsuario()`.
- Estado: Parcial, desplegado: lectura por código limitada a la granja; la lista sigue abierta a administradores porque la app la usa sin filtro

#### H48. Los contadores se pueden avanzar sin crear lotes
- Severidad: baja · Área: REGLAS · Origen: Agente3 S9
- Archivos: `firestore.rules:1320-1331`.
- Reproducción: A3-e.
- Arreglo: ids solo `lotes_global` y `diario_\d{8}`; exigir con `getAfter` que el lote nuevo se cree en la misma operación.
- Estado: Parcial, desplegado: solo los ids de contador válidos; el global aún se puede avanzar sin crear lote

#### H49. Clientes: sin límites al editar
- Severidad: baja · Área: REGLAS · Origen: Agente3 S11
- Archivos: `firestore.rules:608-613`.
- Arreglo: repetir en `update` las validaciones de `create` (`contacto` y `direccion` como texto con tamaño máximo).
- Estado: Corregido y desplegado

#### H50. Copias locales de otra sesión quedan en el navegador
- Severidad: baja · Área: FUNCIONAL · Origen: Agente4 11, Agente3 S16
- Archivos: `src/App.tsx:119, 252-261, 320, 343-356`; `src/services/usuariosService.ts:306`; `src/services/repartoService.ts:85, 150`.
- Impacto: en un teléfono compartido quedan nombres, direcciones y teléfonos de clientes.
- Arreglo: limpiar las copias cuando el token es inválido o cambia el uid; aviso de cerrar sesión en equipos compartidos.
- Estado: Corregido y desplegado

#### H51. La exportación CSV no escapa valores
- Severidad: baja · Área: FUNCIONAL · Origen: Agente3 S17
- Archivos: `src/components/AnaliticaTab.tsx:169-191`.
- Arreglo: duplicar comillas, anteponer `'` a valores que empiezan con `= + - @`, usar `Blob` en vez de `encodeURI`.
- Estado: Corregido y desplegado

#### H52. "Guardar Configuración General" activo sin permiso
- Severidad: baja · Área: FUNCIONAL · Origen: Agente4 12
- Archivos: `src/components/ConfiguracionTab.tsx:208-211`.
- Arreglo: `disabled={guardando || !puedeConfig}`.
- Estado: Corregido y desplegado

#### H53. Agregar o editar un estanque guarda también rangos sin confirmar
- Severidad: baja · Área: FUNCIONAL · Origen: Agente4 13
- Archivos: `src/components/ConfiguracionTab.tsx:84-89, 132-139`.
- Arreglo: enviar los rangos del servidor al guardar estanques y revertir `setEstanques` si falla.
- Estado: Corregido y desplegado

#### H54. Listener redundante del lote abierto y copia local que crece sin límite
- Severidad: baja · Área: FUNCIONAL · Origen: Agente4 14
- Archivos: `src/App.tsx:314-343`; `src/components/LoteDetailModal.tsx:181-191`.
- Arreglo: quitar el bloque obsoleto de App (o derivar el lote abierto de `lotes`); guardar en local solo un resumen o los N más recientes.
- Estado: Corregido y desplegado

#### H55. Mensajes de éxito con temporizadores sin limpiar
- Severidad: baja · Área: FUNCIONAL · Origen: Agente5 12
- Archivos: `src/components/ConfiguracionTab.tsx:97, 182`; `src/components/LoteDetailModal.tsx:171, 208, 222, 693`.
- Arreglo: temporizador en `useRef` limpiado antes de crear otro, como `UsuariosTab.tsx:127-130`.
- Estado: Corregido y desplegado

#### H56. Botones de cerrar solo con ícono y sin nombre accesible
- Severidad: baja · Área: DISENO-REGRESION · Origen: Agente5 6
- Archivos: `LoteDetailModal.tsx:313`, `QrModal.tsx:74`, `IntegrityCheckModal.tsx:61`, `NuevaOrdenModal.tsx:177`.
- Arreglo: `aria-label="Cerrar"`.
- Estado: Corregido y desplegado

#### H57. Menú de tres puntos clicable durante su salida y abierto fuera de pantalla
- Severidad: baja · Área: DISENO-REGRESION · Origen: Agente5 7
- Archivos: `src/components/PersonaUi.tsx:110-136`.
- Impacto: un segundo toque rápido repite "Desactivar cuenta" (lo revierte) o "Eliminar persona".
- Arreglo: `pointerEvents: 'none'` en la variante de salida; abrir hacia arriba cuando no haya espacio.
- Estado: Corregido y desplegado

#### H58. Cambio rápido de pestañas monta hasta 6 `<main>` a la vez
- Severidad: baja · Área: DISENO-REGRESION · Origen: Agente5 8
- Archivos: `src/App.tsx:549-556`.
- Arreglo: aceptable; documentar o acortar la salida.
- Estado: Corregido y desplegado

#### H59. El esqueleto oculta los lotes guardados en el navegador
- Severidad: baja · Área: DISENO-REGRESION · Origen: Agente5 9
- Archivos: `src/App.tsx:117-124, 584, 603, 621`.
- Arreglo: `lotesCargando && lotes.length === 0 ? <EsqueletoPantalla /> : ...`.
- Estado: Corregido y desplegado

#### H60. Movimiento reducido: interruptor sigue animado y spinners quietos
- Severidad: baja · Área: DISENO-REGRESION · Origen: Agente5 10
- Archivos: `src/styles/motion.css:35-45`; `src/index.css:427-432`.
- Arreglo: `--mov-interruptor: var(--mov-reducido);` en el bloque reducido; opcional, pulso de opacidad en vez de spinner quieto.
- Estado: Corregido y desplegado

#### H61. El aviso de función tapa la esquina inferior y se va de golpe
- Severidad: baja · Área: DISENO-REGRESION · Origen: Agente5 11
- Archivos: `src/App.tsx:485-493`.
- Arreglo: `pointer-events-none` y salida con `AnimatePresence` como el aviso de Personal.
- Estado: Corregido y desplegado

#### H62. Nuevo lote: cerrar durante el guardado permite enviar otra vez
- Severidad: baja · Área: DISENO-REGRESION · Origen: Agente5 13
- Archivos: `src/components/NuevoLoteModal.tsx:118-123, 276-281`.
- Arreglo: no reiniciar `cargando` al cerrar y deshabilitar Cerrar y Cancelar mientras se guarda.
- Estado: Corregido y desplegado

#### H63. Dependencias: avisos de `@grpc/grpc-js` y paquetes de servidor sin uso
- Severidad: baja · Área: CONFIG-EXTERNA · Origen: Agente3 S15
- Archivos: `package.json`; `bun.lock`.
- Impacto: grpc-js solo corre en Node (riesgo bajo en la web); `express`, `dotenv`, `@google/genai` sobran.
- Arreglo: quitar los paquetes sin uso; no bajar firebase a 9.14.
- Estado: Sin cambio: las 4 alertas son de @grpc/grpc-js, que solo corre en Node y no llega al navegador

### Informativa

#### H64. Storage: reglas del repo no publicadas y `read` incluye listar
- Severidad: informativa · Área: CONFIG-EXTERNA · Origen: Agente3 S18
- Archivos: `storage.rules`.
- Arreglo: confirmar las reglas vigentes del bucket (sección 5); publicar `storage.rules` con `get` en vez de `read`, o negar todo si los PDF antiguos no se usan.
- Estado: Pendiente de tu revisión en la consola: Storage no tiene reglas publicadas desde el repo

#### H65. Secretos: no hay llaves privadas en repo ni historial; cambio de `.gitignore` sin confirmar
- Severidad: informativa · Área: CONFIG-EXTERNA · Origen: Agente3 S19
- Arreglo: confirmar en git el cambio de `.gitignore` (`respaldos_despliegue/`, `.env*`).
- Estado: Corregido: .gitignore confirmado en git

#### H66. Sin XSS encontrado; `handleFirestoreError` sin uso
- Severidad: informativa · Área: INTEGRIDAD-APP · Origen: Agente3 S20
- Archivos: `src/firebase/firebaseConfig.ts:71`.
- Arreglo: borrar `handleFirestoreError` (metería correo y uid en mensajes de error).
- Estado: Corregido y desplegado

#### H67. `entregas/{codigo}` es código muerto
- Severidad: informativa · Área: INTEGRIDAD-APP · Origen: Agente2 nota
- Archivos: `src/services/entregasService.ts` (`registrarAccionEntrega`); `firestore.rules:345` la cierra.
- Arreglo: dejar solo la verificación de datos antiguos o retirar la escritura.
- Estado: Corregido y desplegado: EntregasPanel quedó de solo lectura; la función antigua sigue exportada sin uso

#### H68. Datos semilla de prueba con UID fijos
- Severidad: informativa · Área: FUNCIONAL · Origen: Agente4 16
- Archivos: `scratchpad/orden-seed.mjs` (fuera del repo).
- Arreglo: buscar UID por correo como en `orden-seed-a4.mjs`.
- Estado: Corregido: el script de datos semilla usa los UID reales del emulador

#### H69. Paquete `index.esm` a 4 kB del aviso de 500 kB y `__dirname` en `vite.config.ts`
- Severidad: informativa · Área: DISENO-REGRESION · Origen: Agente5 (compilación)
- Archivos: `vite.config.ts:11`.
- Arreglo: vigilar el tamaño al añadir código (H02, H03, H32).
- Estado: Corregido y desplegado: el paquete principal bajó a 428 kB (detalle del lote en carga diferida); el de Firestore (495 kB) queda vigilado

## 4. Archivos que toca cada área

Regla general: cada archivo tiene un dueño. Si un archivo es compartido, el dueño hace sus cambios primero y el otro área trabaja después sobre esa versión (nunca a la vez).

**REGLAS** (H01, H05, H13, H15, H20, H21, H22, H44 a H49, y la parte de reglas de H14, H18, H19)
- `firestore.rules` (exclusivo: solo REGLAS lo edita)
- `storage.rules` (exclusivo; la publicación en consola es de CONFIG-EXTERNA, H64)
- `tests/reglas/*`, `tests/seguridad/*` (pasar pruebas HUECO a `assertFails`; correr las 143 + 53)

**INTEGRIDAD-APP** (H02, H03, H04, H06, H07, H12, H14, H16 a H19, H25, H27, H29, H34 a H43, H66, H67)
- `src/services/hashService.ts`, `comprobantesService.ts`, `fotosService.ts`, `anotacionesService.ts`, `entregasService.ts`, `pedidosService.ts`, `pdfService.ts`, `qrService.ts`, y donde viva `recalcularResumenLote`
- `src/components/PublicTraceabilityView.tsx`, `ConsultaEntregaPublica.tsx`, `FotosEntregaOrden.tsx`, `DocumentacionEntrega.tsx`, `AnotacionesLotePanel.tsx`
- Compartidos: `src/services/lotesService.ts` (dueño; FUNCIONAL después para H08), `src/services/repartoService.ts` (dueño por H14; FUNCIONAL después para H10 y H50), `src/components/LoteDetailModal.tsx` (dueño por H02 y H06; luego DISENO por H32, H56 y FUNCIONAL por H54, H55), `src/components/IntegrityCheckModal.tsx` (dueño por H02; luego DISENO por H11, H32, H56), `src/firebase/firebaseConfig.ts` (dueño por H12 y H66; luego CONFIG-EXTERNA por H24)
- `package.json` línea del script `dev` (H12): coordinar con CONFIG-EXTERNA

**FUNCIONAL** (H08, H09, H10, H26, H28, H50 a H55, H68)
- `src/components/DetalleEntregaRepartidor.tsx`, `ConfiguracionTab.tsx`, `AnaliticaTab.tsx`, `src/services/usuariosService.ts`
- Compartidos: `src/components/NuevoEventoModal.tsx` (dueño por H08 y H09; luego DISENO por H32), `src/App.tsx` (ver DISENO), `lotesService.ts`, `repartoService.ts`, `LoteDetailModal.tsx` (después de INTEGRIDAD-APP)

**DISENO-REGRESION** (H11, H30 a H33, H56 a H62, H69)
- `src/index.css`, `src/styles/motion.css`, `src/lib/presencia.ts`, hook nuevo `useVentana`, `vite.config.ts`
- `src/components/NuevoLoteModal.tsx`, `QrModal.tsx`, `AuthModal.tsx`, `NuevaOrdenModal.tsx`, `EntregasPanel.tsx`, `PersonaUi.tsx`
- Compartidos: `src/App.tsx` (dueño por H30, H31, H33, H58, H59, H61; FUNCIONAL después para H26, H50, H54), `LoteDetailModal.tsx`, `IntegrityCheckModal.tsx`, `NuevoEventoModal.tsx` (después del dueño indicado)

**CONFIG-EXTERNA** (H23, H24, H63, H64, H65)
- `vercel.json` (nuevo), `package.json` y `bun.lock` (dependencias), `firebase-applet-config.json`, `.gitignore`
- `src/firebase/firebaseConfig.ts` (App Check, después de INTEGRIDAD-APP)
- Consolas de Firebase, Google Cloud y Vercel (sección 5)

## 5. Verificaciones pendientes del usuario en consola

| Qué | Dónde | Qué comprobar |
| --- | --- | --- |
| API key web (`AIzaSyCpMF-...`) | Google Cloud Console, APIs y servicios, Credenciales | Restringida por referente HTTP (dominios de Vercel y `localhost`) y solo a Identity Toolkit, Token Service y Cloud Firestore |
| Dominios autorizados de Auth | Firebase, Authentication, Configuración | Solo los de Vercel y `localhost` (quitar `web.app` u otros sin uso) |
| Protección contra enumeración de correos | Firebase, Authentication, Configuración | Activada |
| Registro libre | Firebase, Authentication, Proveedores | Decidir si se mantiene (H24) |
| App Check | Firebase, App Check | Registrar la app web con reCAPTCHA Enterprise; primero métricas, luego obligatorio en Firestore |
| Reglas de Storage | Firebase, Storage, Reglas del bucket `iron-outpost-cw2pc.firebasestorage.app` | Que no estén las del "modo de prueba" con fecha (bucket abierto); no hay release publicada desde el repo (H64) |
| Política TTL de fotos | Firestore, TTL | Activa sobre `fotosEntrega.expiraEn` en la base `ai-studio-33039dd2-...` |
| Hashes de respaldo en producción | Firestore (consulta) | Si hay eventos con hash de forma `0{18}hex{14}0{18}hex{14}` (H12, H13) |
| Lotes reales con datos imposibles | Firestore (consulta) | Mortalidad + cosecha > sembrados o fases antes de la siembra (H08, H09); comprobar que el recálculo de H02 coincide con lo guardado |

## 6. Despliegues

| Qué | Cuándo | Resultado |
| --- | --- | --- |
| Despliegue 1: reglas de Firestore (commit 3d35745; respaldo en respaldos_despliegue/2026-11-15_2310) | 2026-11-16 14:13 UTC | Bien. Publicadas iguales al repo. Antes: 146/146 y 71/71 pruebas. Después, en producción: consulta pública ?lote=20261031-A-E1 abre sin errores; ingreso, elección de función y lista de lotes como operador cargan sin errores de permisos. |

## 7. Verificación final en producción (2026-11-16)

Las pruebas se hicieron sobre un lote de prueba, `20261116-A-E1` (proveedor `PRUEBA-auditoria`, `esPrueba: true`), creado, registrado y cerrado con la app real. Las alteraciones se hicieron con `tests/integridad/produccion-prueba.mjs`, que se niega a tocar lotes que no sean de prueba.

| Prueba en producción | Resultado |
| --- | --- |
| Crear lote, registrar fase y cerrar con las reglas nuevas | Funciona |
| Mortalidad mayor que los peces vivos | Bloqueado con mensaje claro |
| 7: cabecera alterada (estanque, supervivencia) | Detectado y avisado |
| 4: dato de una fase alterado | Detectado y avisado |
| 8: última fase borrada | Detectado y avisado, también con QR sin sello |
| QR con un sello que no coincide | Detectado y avisado |
| Restaurado | Vuelve a "Cadena verificada" |
| `?lote=%25` | "El código del lote no es válido" |
| 4 comprobantes reales verificados contra su orden (solo lectura) | Íntegros, sin falsas alarmas |
| Lote real 20261031-A-E1 | "Cadena verificada al abrir", sin falsas alarmas |
| Paneles de operador y repartidor | Cargan sin errores de consola |

Revisor independiente (sin cambios propios):
- Hallazgos críticos y altos resueltos, salvo H03, que es parcial.
- tsc y build sin errores. Pruebas: 146/146 de reglas y 71/71 de seguridad.
- Encontró 6 problemas nuevos menores:
  - 4 corregidos y desplegados (despliegues 3 y 4).
  - El rechazo de fechas anteriores a la última fase es intencional (H09).
  - La posible falsa alarma en comprobantes antiguos se descartó: los 4 reales verifican bien.

Otras comprobaciones:
- `npm audit --omit=dev`: 4 altas de `@grpc/grpc-js`, solo de Node (H63).

Limpieza:
- Se borraron el lote de prueba y su contador diario `diario_20261116_E1`.
- No quedó ningún documento con PRUEBA ni `esPrueba` en lotes, anotaciones, inventario, clientes, órdenes, comprobantes, consultas, fotos, usuarios ni entregas.
- El contador global `lotes_global` quedó en 5 (avanzó 1 por la prueba). No se tocó porque es un dato real: el próximo lote real tendrá el consecutivo 6.

Para volver atrás:
- Reglas originales: `respaldos_despliegue/2026-11-15_2310/`.
- Web: `vercel rollback` a hpc7j252w (antes de la auditoría) o a 5f3h9ikqe (antes del despliegue 4).
