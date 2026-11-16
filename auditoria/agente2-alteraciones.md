# Agente 2: pruebas de alteración (solo emulador)

Fecha: 2026-11-15/16. Emuladores propios: Firestore 8185, Auth 9199. No se tocó producción ni ningún
archivo de `src/` o `firestore.rules`. Scripts repetibles en `tests/integridad/` (ver su README).
Resultados generados: `tests/integridad/resultados.md` y `resultados.json` (corrida con lote
`PRUEBA-MWIRIZ59-A-E1`).

Los datos se crearon con los servicios reales de la app y pasando por las reglas: lote con siembra,
cinco fases y cierre; orden confirmada; inicio de ruta, llegada y entrega con foto por el repartidor;
comprobante definitivo; anotación propuesta por una persona y aprobada por otra. Los ataques usan el
token `Bearer owner` (equivale a editar desde la consola de Firebase). Cada resultado sale de llamar a
las funciones reales de verificación y de reproducir la lógica de la pantalla que las muestra.

## CRÍTICO: alteraciones no detectadas

1. **Cabecera del lote (ataque 7)**: estanque, fecha de siembra, producto, peces sembrados,
   supervivencia, peso promedio y biomasa que ve el público salen de campos del documento que ningún
   hash cubre. Se cambiaron a E9, 2026-01-01, "orgánica certificada", 5000, 99,9 %, 900 g, 4500 kg y
   todo se ve "íntegro". **Además no hace falta la consola**: un operador con permiso de cerrar lotes
   lo hace al sellar (prueba 12), y uno con permiso de registrar eventos cambia el resumen de un lote
   activo sin registrar ningún evento.
2. **Reescritura completa por consola (6b, 6c, 8c, A2)**: si se recalculan la cadena del lote, las
   huellas, `resumen.hashFinal` y la cadena de anotaciones (o se borran las anotaciones), nada lo
   detecta. La única ancla externa a la cadena del lote son las anotaciones, y viven en la misma base.
3. **Comprobante recalculado (9c)**: si se alteran el comprobante, su `hashComprobante` y el hash en
   `consultasEntrega`, la consulta pública y el botón "Verificar" interno dicen "íntegro", aunque el
   evento "Comprobante emitido" de la orden guarda el hash original.
4. **Foto borrada (10)**: borrar la foto antes de los 15 días se muestra igual que su vencimiento
   normal ("La imagen ya no está disponible").

## Tabla de resultados

"Avisado" significa que una pantalla lo muestra sola al abrirse. "Sin aviso" significa que solo
aparece si alguien pulsa un botón de verificar.

| # | Ataque | Resultado | Evidencia (código real) | Arreglo propuesto |
| --- | --- | --- | --- | --- |
| 1 | Reemplazar `datos` de la foto por otra imagen | Detectado sin aviso | `verificarFoto` = false solo al pulsar "Verificar foto". La foto falsa se muestra igual | Verificar sola al cargar (F4) |
| 2 | Cambiar un carácter del base64 | Detectado sin aviso | Igual que 1 | F4 |
| 3 | Cambiar `datos` y `hash` de la foto (evento intacto) | Detectado sin aviso | `hashEvento !== foto.hash`, solo al pulsar el botón | F4 |
| 3b | Igual que 3 y además cambiar el hash en el evento "Entrega" de la orden | Detectado sin aviso | Solo el botón "Verificar" del comprobante (interno) falla por `hashEventos`. La foto pasa | F4 y comparar `fotoHash` del comprobante con la foto |
| 4 | Alterar un dato de una fase intermedia | Detectado y avisado | QR del lote: "Fase #2 (Alimentación) alterada. Dato(s) modificado(s): Alimento (kg)" | Ninguno |
| 5 | Alterar el hash guardado de un evento | Detectado y avisado | Fase #2 alterada y fase #3 "no enlaza" | Ninguno |
| 6 | Alterar la fase #2 y recalcular cadena, huellas y `hashFinal` | Detectado y avisado, **solo porque había anotación** | Únicamente la sección de anotaciones avisa ("El sello del lote cambió..."). La cadena y el botón dicen "íntegra" | F2 |
| 6b | 6 + recalcular la cadena de anotaciones | **NO DETECTADO** | Todo íntegro, con 80 kg en vez de 120 | F2 |
| 6c | 6 + borrar el documento de anotaciones | **NO DETECTADO** | Todo íntegro y la anotación aprobada desaparece | F2 |
| 7 | Editar la cabecera del lote | **NO DETECTADO** | Público ve E9, 5000 peces, 99,9 %, 900 g, 4500 kg y "orgánica certificada" | F1 |
| 8 | Borrar el último evento (sin tocar el sello) | Detectado. El aviso automático sale **solo por la anotación**; la cadena, únicamente con el botón | Botón: "El sello de cierre registrado... no coincide". La lista de fases no se marca en rojo | F3 |
| 8b | Borrar el último evento y ajustar `hashFinal` | Detectado y avisado, solo por la anotación | Botón y cadena dicen "íntegra" | F2 |
| 8c | 8b + recalcular las anotaciones | **NO DETECTADO** | El lote pierde la Cosecha sin aviso | F2 |
| 9a | Alterar `cantidadEntregada` del comprobante | Detectado y avisado | QR entrega: "el contenido no corresponde a su hash" | Ninguno |
| 9b | 9a + recalcular `hashComprobante` | Detectado y avisado | QR entrega: "el índice de consulta registra otro hash" | Ninguno |
| 9c | 9b + actualizar `consultasEntrega` | **NO DETECTADO** | Público ve 80 kg y "PRUEBA-Otro cliente". El botón "Verificar" interno también dice "íntegro" | F5 |
| 9d | Alterar solo el hash en `consultasEntrega` | Detectado y avisado | QR entrega en rojo | Ninguno |
| 9e | Borrar el comprobante | Detectado y avisado | Interno: "Cadena incompleta". Público: "No se encontró ninguna entrega" (engañoso, pero no muestra datos falsos) | F6 |
| 9f | Borrar el bloque de anulación de un comprobante anulado | Avisado **solo internamente** | El público ve "Comprobante vigente: N.º 1" sin marca de ANULADO: el índice tiene 2 versiones y solo se leen 1 | F6 |
| 10 | Borrar la foto | **NO DETECTADO** | Muestra "La imagen ya no está disponible (se conserva 15 días)" | F4 |
| A1 | Alterar la anotación aprobada | Detectado y avisado | "La anotación N.º 1 (propuesta) fue alterada", sin validez | Ninguno |
| A2 | A1 + recalcular la cadena de anotaciones | **NO DETECTADO** | La anotación alterada se muestra como válida | F2 |
| 11 | `?lote=` inexistente, inyección, `<script>`, `../`, muy largo; `?entrega=` falso | Correcto, salvo `%` | React escapa todo; no hay lectura fuera de `lotes`. `?lote=%25` deja la carga infinita | F7 |
| 12 | Las mismas alteraciones como usuario normal (con reglas) | Bloqueado, **con dos excepciones** | 20 de 22 intentos bloqueados. Permitidos: resumen de lote activo sin evento, y cabecera al sellar | F1 |

Detalle del punto 12 (todo en `tests/integridad/resultados.md`). Bloqueados: alterar fase, cabecera,
resumen o borrar un lote cerrado; reemplazar o borrar la foto (repartidor y operador); alterar o borrar
el comprobante; cambiar o borrar `consultasEntrega`; cambiar el hash de la foto en la orden; alterar o
borrar la anotación; escrituras anónimas; crear lote o leer la foto sin permiso.

## Hallazgos

### F1. Alta (CRÍTICO): los datos de cabecera y el resumen del lote no tienen hash, y un usuario legítimo puede cambiarlos

- **Archivos**:
  - `firestore.rules:226-230`: en el caso B del cierre solo se exige que no cambien `eventos` y la cosecha. Cualquier otro campo se puede cambiar.
  - `firestore.rules:171-175` (`loteActivoCoherente`): deja cambiar `resumen` sin evento, salvo la cosecha.
  - `src/components/PublicTraceabilityView.tsx:336-347` y `:434-466`: muestran esos campos.
  - `src/services/hashService.ts:218-237`: solo verifica eventos y `hashFinal`.
- **Reproducción**: ataque 7, y en la prueba 12, `updateDoc(lote, {estado:'cerrado', estanque:'E9', cantidadSembrada:99999, producto:'Tilapia orgánica certificada', origen:'Otra granja', fechaCierre:'2026-01-01'})` como operador con `cerrarLotes`: **PERMITIDO**. Después, `verificarIntegridadLote` y `analizarCadenaLote` dicen "ÍNTEGRO". Antes, `updateDoc(lote activo, {'resumen.supervivencia': 99.9, ...})` sin evento: **PERMITIDO**.
- **Impacto**: el certificado público (pantalla y PDF) puede mostrar estanque, producto, origen, número de peces, supervivencia, peso y biomasa falsos con sello "íntegro", sin dejar rastro en la cadena.
- **Arreglo**:
  - (a) En el caso B, limitar los cambios con `diff().affectedKeys().hasOnly(['estado','fechaCierre','resumen','pdfPath','pdfUrl','versionPdf','pdfActualizadoEn','actualizadoEn'])`.
  - (b) En `loteActivoCoherente`, exigir que `resumen` solo cambie cuando se agrega un evento.
  - (c) Que la vista pública y el PDF muestren los datos derivados del evento de siembra y de `recalcularResumenLote(eventos)` y no los campos guardados, o que comparen ambos y avisen si difieren. Así la cabecera queda cubierta por la cadena.

### F2. Alta (CRÍTICO frente a la consola): no hay ancla fuera de Firestore

- **Archivos**:
  - `src/services/hashService.ts:218-237` y `:359-362`: el sello es `resumen.hashFinal` del mismo documento.
  - `src/services/anotacionesService.ts:949-960`: la única ancla cruzada son las anotaciones, que viven en la misma base.
- **Reproducción**: ataques 6b, 6c, 8c y A2, con `recalcularCadenaLote` y `recalcularAnotaciones` en `ataques.ts`.
- **Impacto**: quien tenga la consola, una cuenta de servicio o una credencial de administrador del proyecto puede reescribir el historial sin que nada lo detecte. La "cadena tipo blockchain" protege contra ediciones parciales, no contra una reescritura completa. Una anotación también se puede borrar sin rastro (6c).
- **Arreglo**: firmar o anclar fuera de Firestore. Opciones:
  - Una Cloud Function que, al cerrar el lote, firme `hashFinal` con una clave guardada en Secret Manager. La vista pública verifica la firma con la clave pública incluida en el código.
  - Publicar `hashFinal` en un registro externo de solo agregar, como OpenTimestamps o un repositorio o bitácora pública.

  Como mínimo:
  - Imprimir el `hashFinal` en el PDF y el QR para comparar a mano.
  - Llevar en el lote, al aprobar una anotación, un contador de anotaciones aprobadas, para detectar el borrado del documento.

### F3. Media: la vista pública no avisa sola cuando el sello no coincide

- **Archivo**: `src/components/PublicTraceabilityView.tsx:141-150` y `:481`. El aviso automático solo mira `diagnostico` por fase y no `selloCoincide`.
- **Reproducción**: ataque 8 en un lote sin anotaciones. El mensaje "el sello de cierre no coincide" aparece solo al pulsar "Verificar integridad".
- **Impacto**: un lote al que le borraron la última fase (por ejemplo, la Cosecha) se ve normal al abrir el QR.
- **Arreglo**: guardar también `an.selloCoincide` y mostrar el aviso rojo cuando sea `false`. Lo mismo en `LoteDetailModal`.

### F4. Media: la verificación de la foto es solo manual y el borrado no se distingue del vencimiento

- **Archivo**: `src/components/FotosEntregaOrden.tsx:40-48` (muestra la foto sin verificar), `:63-74` (botón) y `:57-60` (texto de "no disponible").
- **Reproducción**: ataques 1, 2, 3 y 10.
- **Impacto**: el operador ve una foto reemplazada como si fuera la original, salvo que pulse el botón. Una foto borrada para ocultar evidencia parece vencida.
- **Arreglo**:
  - Verificar al cargar cada foto y marcar en rojo si no coincide.
  - Si falta la foto y aún no pasaron 15 días desde la fecha del evento, mostrar "La foto fue borrada antes de su vencimiento".
  - Comparar también con `fotoHash` del comprobante.

### F5. Alta (CRÍTICO): la verificación de comprobantes no usa el ancla que ya guarda la orden

- **Archivos**:
  - `src/services/comprobantesService.ts:467-495` (`verificarComprobante`): compara el contenido con su propio hash, con `hashEventos` y con el índice, pero no con el evento "Comprobante emitido" de la orden (`datos.hashComprobante`, escrito en `:369-375`).
  - `src/components/DocumentacionEntrega.tsx:82-85`.
- **Reproducción**: ataque 9c (`cantidadEntregada` 80 y otro cliente). Resultado: público e interno "íntegro".
- **Impacto**: el cliente que escanea el QR ve cantidades o nombre falsos validados. Además, los campos resumen del comprobante no se recalculan desde los eventos.
- **Arreglo**:
  - En el panel interno, exigir `c.hashComprobante === evento 'Comprobante emitido'.datos.hashComprobante`.
  - Recalcular `construirComprobante(orden)` y comparar las cantidades.
  - En lo público, que el ancla esté fuera de Firestore (ver F2).

### F6. Media: la consulta pública ignora los bloques que faltan

- **Archivos**:
  - `src/services/comprobantesService.ts:413-422`: descarta en silencio las versiones cuyo documento no existe.
  - `src/components/ConsultaEntregaPublica.tsx:32` y `:51`.
- **Reproducción**: 9f. Se borra el bloque de anulación y el público ve "Comprobante vigente: N.º 1" sin marca de ANULADO. El índice dice 2 versiones y solo se leen 1. En 9e, el público ve "No se encontró ninguna entrega".
- **Impacto**: un comprobante anulado aparece como válido ante el cliente.
- **Arreglo**: si `bloques.length < Object.keys(consulta.versiones).length`, mostrar en rojo "Falta un registro de la cadena" y no presentar ningún comprobante como vigente.

### F7. Baja: `?lote=` con `%` deja la pantalla cargando para siempre

- **Archivo**: `src/components/PublicTraceabilityView.tsx:82`. `decodeURIComponent` está fuera del `try`, y `URLSearchParams` ya decodificó una vez, así que se decodifica dos veces.
- **Reproducción**: `/?lote=%25` o `/?lote=%25E0%25A4%25A`. Se produce un URIError, la promesa se rechaza sin manejo y `setCargando(false)` nunca corre.
- **Arreglo**: quitar `decodeURIComponent` o envolverlo en el `try`.
- **Otros casos de la prueba 11**: `?lote=a/b` y `?lote=__x__` muestran "No fue posible consultar el servidor... verifica tu conexión", que es engañoso; conviene validar el código con `^[A-Za-z0-9_-]{1,64}$` antes de consultar. No hay XSS: React escapa el texto. Tampoco hay lectura fuera de `lotes`, porque `a/b/c` da permission-denied.

### F8. Baja: reglas al borde del límite de 1000 expresiones

- **Archivo**: `firestore.rules:217` (lotes) y `:1313` (órdenes). En el emulador, varias denegaciones de la prueba 12 dicen "Unable to evaluate the expression as the maximum of 1000 expressions to evaluate has been reached".
- **Impacto**: hoy niega, que es lo seguro. Pero un cambio pequeño en las reglas podría hacer fallar operaciones legítimas sobre órdenes o lotes con historiales largos.
- **Arreglo**: cortar antes con condiciones baratas, por ejemplo comprobar `resource.data.estado == 'activo'` en una regla separada, y probar historiales largos.

### Nota: `entregas/{codigo}` está muerto

`entregasService.registrarAccionEntrega` escribe en una colección que las reglas cierran por completo
(`firestore.rules:345`). Su verificación (`verificarIntegridadEntregas`) solo aplica a datos antiguos.

## Resumen por severidad

- Alta: 3 (F1, F2, F5), todas marcadas CRÍTICO
- Media: 3 (F3, F4, F6)
- Baja: 2 (F7, F8)

## Lo que funciona bien

- Alterar una fase, un hash, una anotación o un comprobante sin recalcular se detecta y se avisa solo (4, 5, 9a, 9b, 9d, A1).
- Las reglas bloquean todas las alteraciones de registros sellados por usuarios normales y anónimos.
- La foto no es pública y el repartidor no puede cambiarla ni borrarla.
