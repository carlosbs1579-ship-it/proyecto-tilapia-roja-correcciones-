# Agente 1: integridad de archivos y hash

Fase de revisión (solo lectura de código). Fecha: 2026-11-15. Rama `correciones-claude`.

Archivos revisados: `src/services/hashService.ts`, `fotosService.ts`, `comprobantesService.ts`, `anotacionesService.ts`, `entregasService.ts`, `lotesService.ts`, `pedidosService.ts`, `repartoService.ts`, `pdfService.ts`, `qrService.ts`, `calculosService.ts`; componentes `PublicTraceabilityView`, `ConsultaEntregaPublica`, `IntegrityCheckModal`, `FotosEntregaOrden`, `LoteDetailModal`, `AnotacionesLotePanel`, `DocumentacionEntrega`; `firestore.rules`.

## Resumen

| Severidad | Cantidad |
| --- | --- |
| Crítica | 1 |
| Alta | 4 |
| Media | 8 |
| Baja | 8 |
| **Total** | **21** |

Lo más grave: al cerrar un lote, las reglas dejan escribir libremente los datos de cabecera y todo el resumen productivo, que no entran en ningún hash. Esos datos salen en el QR público y en el PDF con el mensaje "Cadena íntegra".

Lo que sí funciona bien (comprobado leyendo el código):
- SHA-256 con `crypto.subtle.digest` sobre un JSON canónico con las claves ordenadas.
- Cada evento incluye `codigoLote`, `indice`, `tipo`, `fechaEvento`, `descripcion`, `datos`, `registradoPor`, `registradoPorNombre` (si existe), `registradoEn` y `hashAnterior`. Por eso se detecta si alguien altera un evento intermedio, lo reordena, borra uno del medio, cambia `hashAnterior` o copia eventos de otro lote.
- Las reglas impiden reescribir o borrar eventos ya registrados en lotes, anotaciones, historial de órdenes, comprobantes, índice de consulta y fotos. Solo dejan agregar al final.
- El hash de la foto se calcula sobre el mismo texto que se guarda (`datos`), así que subida y verificación usan exactamente la misma entrada.
- El PDF del lote recalcula la cadena (`verificarIntegridadLote`) cada vez que se genera. Si falla, imprime "Cadena alterada" en rojo.
- `IntegrityCheckModal` recalcula todo automáticamente al abrirse, incluido el sello.

---

## CRÍTICO

### C1. CRÍTICO: el cierre del lote permite cambiar la cabecera y el resumen sin evento y sin hash; el QR y el PDF los muestran como íntegros

- **Severidad:** crítica
- **Dónde:**
  - `firestore.rules:226-230` (Caso B, cierre): solo exige `estado == 'cerrado'`, el permiso `cerrarLotes`, que `eventos` no cambie y `cosechaCoherente`. **No limita qué otros campos cambian.**
  - `firestore.rules:166-175` (Caso A): permite escribir `resumen` sin ningún evento nuevo (`eventosSoloCrecen` acepta `despues == antes`). Solo se controlan `biomasaCosechadaKg` y `pecesCosechados`.
  - Datos mostrados que no están en ningún hash:
    - `PublicTraceabilityView.tsx:326-347`: producto, estanque, fecha de siembra, "Fecha de cosecha" = `fechaCierre`.
    - `PublicTraceabilityView.tsx:432-468`: peces sembrados = `lote.cantidadSembrada`, supervivencia, peces vivos, peso promedio, biomasa, FCA.
    - `PublicTraceabilityView.tsx:427`: el sello `resumen.hashFinal`.
    - `pdfService.ts:301-339`: producto, origen, estanque, alevinos sembrados, proveedor, peso inicial y la tabla completa de indicadores.
- **Cómo se reproduce:**
  1. Una cuenta con `cerrarLotes` (un operador con permisos válidos, sin consola) escribe directamente con el SDK sobre un lote activo, sin tocar `eventos`: `{estado:'cerrado', fechaCierre:'2026-01-01', cantidadSembrada: 3000, estanque:'E9', proveedorAlevinos:'Otro', producto:'...', origen:'...', resumen:{...supervivencia: 99.9, FCA: 1.1, pesoPromedioActualG: 500, hashFinal: <último hash real>, biomasaCosechadaKg y pecesCosechados sin cambio}}`.
  2. Las reglas lo aceptan.
  3. Al abrir `?lote=CODIGO`, ninguna fase sale en rojo. El botón "Verificar integridad" dice "Cadena íntegra: ninguna fase fue alterada" y el PDF imprime "Cadena íntegra" en verde con los números falsos.
  4. Como el lote queda cerrado, las reglas ya no dejan corregirlo.
  5. Lo mismo vale para cualquier cambio desde la consola de Firebase o el Admin SDK en esos campos, en cualquier momento. La app nunca recalcula el resumen ni compara la cabecera con los eventos.
- **Impacto:** el certificado público, que es la razón de ser de la trazabilidad, puede mostrar cifras productivas y datos de origen falsos mientras afirma que nada fue alterado. El hash solo protege `eventos[]`, no lo que el cliente lee primero.
- **Arreglo propuesto:**
  1. Reglas, Caso B: `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['estado','fechaCierre','resumen','pdfPath','pdfUrl','versionPdf','pdfActualizadoEn','actualizadoEn'])`. Además, `resumen.hashFinal == eventos[eventos.size()-1].hash` y `fechaCierre` con formato de fecha.
  2. Reglas, Caso A: exigir que `resumen` solo cambie cuando entra un evento nuevo, y que `resumen.hashFinal` sea el hash de ese evento.
  3. App: en la vista pública, el PDF, `LoteDetailModal` e `IntegrityCheckModal`, recalcular el resumen con `recalcularResumenLote`. La cabecera efectiva se obtiene de la siembra (evento 0) más las correcciones de siembra (eventos `Corrección` con `ambito: 'siembra'`). Si algo no coincide con lo guardado, mostrar "Los indicadores no corresponden a las fases registradas" en rojo. Los datos que dependen de la configuración (densidad, alertas) se pueden excluir de la comparación o comparar con tolerancia.
  4. Mejor aún, sellar el cierre con un evento final "Cierre" dentro de la cadena. Su `datos` llevaría la cabecera (estanque, cantidad sembrada, peso inicial, proveedor, producto, origen), `fechaCierre` y el resumen, y su hash pasaría a ser el `hashFinal`. Así todo lo que se muestra queda en el hash.

---

## Alta

### A1. El contenido visible del comprobante no se valida contra la orden: un emisor puede inventar cliente, fechas, entregas y hash de foto, y la verificación dice "Bloque íntegro"

- **Severidad:** alta
- **Dónde:**
  - `firestore.rules:1031-1068` (`comprobanteValido`): valida cantidades, estado, procedencias, versión y enlace. **No valida** `cliente`, `repartidor`, `fechas`, `entregas[]` (con `fotoHash` y `cantidades` por entrega), `novedades`, `ajustes`, `eventosUsados`, `emitidoEn`, `empresa` ni que `hashEventos` sea el hash real.
  - `comprobantesService.ts:467-495` (`verificarComprobante`): recalcula el hash del propio bloque y, con la orden, compara `hashEventos` con el hash de los eventos usados. No compara `entregas`, `fechas`, `novedades` ni `ajustes` con esos eventos, ni `cliente` y `repartidor` con la orden.
- **Cómo se reproduce:** una cuenta con `gestionarComprobantes` escribe, en la misma operación que hace la app (comprobante, índice y evento "Comprobante emitido"), un comprobante con las cantidades correctas, `hashEventos` calculado honestamente y `hashComprobante` recalculado. En ese comprobante cambia `cliente.nombre`, `fechas.confirmacion`, `entregas[].fecha` o `entregas[].fotoHash`. Las reglas lo aceptan. `?entrega=TOKEN` muestra "Bloque íntegro" y el operador, al pulsar "Verificar", también obtiene "Bloque íntegro ... y con los eventos registrados en la orden".
- **Impacto:** el documento que recibe el cliente puede tener fechas, destinatario o foto referenciada falsos y verificarse como auténtico.
- **Arreglo propuesto:**
  - En reglas, comparar `c.cliente.nombre == o.clienteNombre`, `c.cliente.direccion == o.get('clienteDireccion','')` y `c.repartidor == o.get('repartidorNombre','')`. Comparar `c.fechas.creacion`, `programada`, `salida` y `llegada` con los campos de la orden. Exigir `c.eventosUsados.size()` igual al número de eventos documentados.
  - En `verificarComprobante` con la orden: reconstruir con `construirComprobante` sobre el historial truncado en `eventoEntregaIndice` y comparar campo a campo, salvo `id`, `version`, `token`, `uid` y `emitidoEn`.
  - Como mínimo, comprobar que `entregas`, `novedades`, `ajustes` y `fechas.confirmacion` se derivan exactamente de los eventos usados.

### A2. Borrar el último evento (o todos), o vaciar el sello, no se avisa automáticamente; el detalle del lote dice "Cadena íntegra"

- **Severidad:** alta
- **Dónde:**
  - `LoteDetailModal.tsx:350-351`: la etiqueta "Cadena íntegra / Cadena alterada" solo mira `diagnostico` por fase. Ignora `selloCoincide`.
  - `PublicTraceabilityView.tsx:141-150`: el análisis automático solo guarda las fases. `an.selloCoincide` y `an.valido` se descartan. El veredicto global aparece solo al pulsar el botón (`152-169`, `393-419`).
  - `hashService.ts:225-229`: `if (!res.valido || !eventos.length) return res;` y `if (sello && ...)`. Una cadena vacía es válida y un sello vacío no se compara.
  - `hashService.ts:133-139` y `360`: con 0 eventos dice "válido" y `selloCoincide = null`.
- **Cómo se reproduce:**
  - Desde la consola, quitar el último elemento de `eventos` de un lote cerrado. Todas las fases salen íntegras, el encabezado dice "Lote sellado · Cadena íntegra" y la vista pública no muestra nada en rojo. Solo el botón o el PDF detectan que el sello no coincide.
  - Si además se cambia `resumen.hashFinal` al nuevo último hash, o se deja vacío, nada lo detecta: ni el botón ni el PDF.
  - Vaciar `eventos` produce "Cadena íntegra: 0 fases" en el PDF.
- **Impacto:** se puede borrar una fase final (por ejemplo, una "Mortalidad", un "Tratamiento" o un "Despacho" con temperatura fuera de rango) sin aviso automático, o sin aviso en absoluto.
- **Arreglo propuesto:**
  - Usar `an.valido` y `an.selloCoincide` en la etiqueta de `LoteDetailModal` y en un aviso automático, visible en la vista pública al cargar.
  - En `verificarIntegridadLote` y `analizarCadenaLote`: si el lote está cerrado, exigir que haya eventos, que el primero sea "Siembra" y que exista `hashFinal`. Si falta, el resultado es inválido.
  - Para lotes cerrados con anotaciones, mostrar también en el aviso global cuando `verificarAnotaciones` dice `selloCambiado`; hoy solo aparece dentro de la sección de anotaciones.
  - Ver A3 para un ancla externa.

### A3. Hash sin clave y guardado junto al dato: una reescritura coherente desde la consola o el Admin SDK no se puede detectar, y no hay ningún ancla fuera de Firestore

- **Severidad:** alta (es de diseño; las reglas no pueden calcular SHA-256)
- **Dónde:** todo el esquema. `hashService.ts:69-104`, `anotacionesService.ts:24-37`, `comprobantesService.ts:123-132`. El QR (`qrService.ts:11-16`) solo lleva el código del lote. Los comprobantes no guardan el sello del lote (`comprobantesService.ts:237-306`).
- **Cómo se reproduce:** con privilegios de consola, cambiar un dato de la fase 3, recalcular con SHA-256 los hashes de las fases 3 a N, actualizar `resumen.hashFinal` y, si existen, `anotacionesLote.hashAnclaje` y los `hashAnterior` de las anotaciones. Todas las verificaciones de la app dan "íntegro".
- **Qué solo detecta la app (y por eso no basta):** la app detecta un cambio en un dato sin recalcular su hash, una reordenación, un borrado intermedio o un cambio en `hashAnterior`. No detecta un recálculo completo, que cualquiera puede hacer porque SHA-256 sin clave es público.
- **Impacto:** la promesa de que los datos son "inalterables" depende por completo de que nadie con acceso de administrador a Firebase la rompa. El único testigo externo son los PDF ya impresos (huella final), y nadie los compara.
- **Arreglo propuesto (de menor a mayor esfuerzo):**
  1. Al cerrar el lote, incluir el sello en el QR del certificado y de la etiqueta: `?lote=CODIGO&s=<primeros 16 hex de hashFinal>`. La vista pública compara `s` con la cadena recalculada y avisa si no coincide. El QR impreso en la etiqueta física se convierte así en el ancla externa.
  2. Guardar `hashFinal` del lote (por procedencia) dentro del comprobante, para que la consulta de entrega compare con el lote actual.
  3. Firmar el sello en el servidor con una clave privada fuera de Firestore (Cloud Function más Secret Manager o KMS) y verificar la firma en el cliente con la clave pública incluida en la app. También se puede sellar en el tiempo (por ejemplo, OpenTimestamps).
  4. Documentar en la tesis que la cadena protege contra cambios hechos por usuarios de la app, no contra quien administra el proyecto, salvo que se adopte 1 o 3.

### A4. Las fotos de entrega no se verifican al mostrarse, y la referencia de su hash vive en un historial sin cadena

- **Severidad:** alta
- **Dónde:**
  - `FotosEntregaOrden.tsx:40-74`: la imagen se muestra con un SHA-256 al lado, pero la verificación es manual (botón "Verificar foto").
  - `fotosService.ts:113-116`: `verificarFoto` compara con `foto.hash` (en el mismo documento) y con `ref.hash` del evento de la orden.
  - `pedidosService.ts:179-198`: los eventos de la orden (`historial`) no tienen hash ni `hashAnterior` (ver M2).
  - El único lugar donde el hash de la foto queda sellado es `comprobante.entregas[].fotoHash` (`comprobantesService.ts:250`), y `FotosEntregaOrden` no lo consulta.
- **Cómo se reproduce:**
  - (a) Desde la consola, cambiar `fotosEntrega/{id}.datos` por otra imagen. El operador la ve sin aviso; solo detecta el cambio si pulsa "Verificar".
  - (b) Cambiar `datos` y `hash` en `fotosEntrega` y `datos.foto.hash` en `ordenes/{id}.historial[k]`. "Verificar foto" responde "La foto coincide con la registrada". Solo se detectaría si existe un comprobante y el operador pulsa "Verificar" en Documentación, que daría `eventosIntegros = false`.
  - (c) Reglas (`firestore.rules:1218-1238`): el repartidor puede guardar un `hash` que no corresponde a `datos`, porque las reglas no pueden calcularlo. La app mostraría la imagen sin aviso.
- **Impacto:** la evidencia fotográfica de la entrega se puede sustituir sin que la plataforma avise.
- **Arreglo propuesto:**
  - Verificar automáticamente cada foto al cargarla y no mostrarla como válida mientras no se haya comprobado: mostrar un sello verde o rojo y, si no coincide, poner la imagen en gris con el aviso "La foto no coincide con la registrada".
  - Comparar también con `fotoHash` del comprobante vigente que documenta esa entrega, si existe.
  - Encadenar el historial de órdenes (M2).

---

## Media

### M1. `calcularSha256` usa un respaldo NO criptográfico en contextos no seguros y esos hashes se guardan en producción

- **Severidad:** media
- **Dónde:**
  - `hashService.ts:69-96`: si `crypto.subtle` no existe (HTTP fuera de localhost) o `digest` falla, el `catch` silencioso cae a un hash de 2×53 bits. El resultado tiene 64 hex con forma fija: 18 ceros, 14 hex, 18 ceros, 14 hex.
  - `package.json:7`: `vite --host=0.0.0.0`. Abrir la app desde el teléfono en `http://192.168.x.x:3000` crea un contexto no seguro.
  - `src/firebase/firebaseConfig.ts:45`: el modo de desarrollo usa la base de PRODUCCIÓN salvo que se defina `VITE_EMULADORES=true`.
  - Las reglas (`firestore.rules:127`, `251`, `1065-1067`, `1233`) solo exigen `size() == 64`.
- **Cómo se reproduce:** en el modo de desarrollo, entrar desde el teléfono por la IP local y registrar una fase. El evento queda con un hash de respaldo.
- **Riesgos:**
  1. **Corrupción permanente:** en HTTPS ese evento aparece como "alterado" para siempre, y como la cadena solo crece no se puede corregir.
  2. **Falso válido:** al verificar en el mismo contexto inseguro, los registros creados con el respaldo salen válidos, y todos los registros genuinos salen "alterados" (falso inválido).
  3. **Debilidad del respaldo:** no es resistente a colisiones. Con unos 2^27 intentos se encuentran colisiones de cada mitad de 53 bits, lo que permitiría alterar un registro creado así sin cambiar su hash.
  4. **Silencio:** el fallo solo deja un `console.warn`.
  - En la vista pública de producción (HTTPS en Vercel) el respaldo no se activa.
- **Arreglo propuesto:**
  - Quitar el respaldo y lanzar un error ("Este navegador no permite calcular SHA-256; abre la app por HTTPS"), y bloquear el registro.
  - En reglas, rechazar hashes con la forma del respaldo, por ejemplo `!e.hash.matches('^0{18}[0-9a-f]{14}0{18}[0-9a-f]{14}$')`, y exigir `matches('^[0-9a-f]{64}$')`.
  - Usar los emuladores por defecto en el modo de desarrollo.

### M2. El historial de las órdenes no tiene cadena de hashes (AUDITORIA_PROGRESO.md dice que sí)

- **Severidad:** media
- **Dónde:** `pedidosService.ts:179-198` (`nuevoEvento`): sin `hash` ni `hashAnterior`. `repartoService.ts:430`. Reglas: `firestore.rules:933` y `1266` impiden reescribir el historial desde la app, pero nada detecta un cambio hecho desde la consola.
- **Qué queda sin protección:** los eventos que no documenta un comprobante y todos los eventos anteriores a la primera emisión. Entre ellos están "Asignación y reserva", "Cambio de repartidor", "Atención de novedad", "Comprobante emitido" y "Ajuste rechazado", además de `datos.foto` mientras no haya comprobante.
- **Cómo se reproduce:** desde la consola, cambiar `historial[k].datos.entregas` o `datos.foto.hash` de una orden sin comprobante. Ninguna pantalla avisa.
- **Arreglo propuesto:** encadenar `EventoOrden` igual que los eventos del lote (hash de `jsonCanonico` sin el campo `hash`, más `hashAnterior`), exigir en reglas `hashAnterior == historial[n-1].hash` y verificarlo al abrir la orden. Corregir AUDITORIA_PROGRESO.md.

### M3. La corrección de siembra solo comprueba qué campos cambian, no sus valores

- **Severidad:** media
- **Dónde:** `firestore.rules:145-152` (`siembraCoherente`): `cambios.hasOnly(d.keys() ...)`, sin comparar el valor nuevo de la cabecera con el "antes → después" del evento (`lotesService.ts:395-397`).
- **Cómo se reproduce:** un usuario con `corregirSiembra` agrega una Corrección con `estanque: 'E1 → E2'` pero escribe `estanque: 'E7'` en la cabecera. Las reglas lo aceptan. La cadena es íntegra y el público ve E7.
- **Arreglo propuesto:** el mismo que en C1 (derivar la cabecera de los eventos y compararla). En reglas, guardar en `datos` los valores nuevos como campos con tipo (por ejemplo `nuevo: {estanque: 'E2', ...}`) y exigir `request.resource.data[k] == ev.datos.nuevo[k]`.

### M4. La consulta pública de la entrega no detecta un comprobante faltante ni el borrado del último bloque, y acepta bloques sin enlace

- **Severidad:** media
- **Dónde:**
  - `comprobantesService.ts:407-425` (`leerConsultaEntrega`): si un `comprobanteId` del índice no existe, se descarta en silencio.
  - `comprobantesService.ts:431-452` (`verificarCadena`): no exige versiones consecutivas (1..N) ni compara con `consulta.versiones`. Un bloque sin `hashAnterior` se cuenta como "anterior al encadenamiento" y se salta, lo que permite rebajar un bloque a "sin enlace".
  - `ConsultaEntregaPublica.tsx:29-44, 152`. `DocumentacionEntrega.tsx:146-149` sí compara con `bloquesEsperados`, pero solo en la vista interna.
- **Cómo se reproduce:** desde la consola, borrar el último `comprobantes/{id}`, o un comprobante cuyo siguiente sea una anulación borrada a la vez. La consulta pública muestra "Cadena de bloques íntegra" con un bloque menos, y la anulación desaparecida hace que un comprobante anulado vuelva a parecer vigente.
- **Arreglo propuesto:**
  - En la consulta pública, comparar `bloques.length` con `Object.keys(consulta.versiones).length` y exigir versiones 1..N sin huecos.
  - Exigir que `ultimaVersion` sea el bloque de mayor versión.
  - Tratar como inválido un bloque sin `hashAnterior` si su versión es mayor que la de un bloque que sí lo tiene.

### M5. El PDF del comprobante no recalcula nada antes de generarse

- **Severidad:** media
- **Dónde:** `pdfService.ts:624-826` (`generarComprobantePdfBlob`) y `840-856`: imprime `hashComprobante`, `hashAnterior` y `hashEventos` tal como están guardados y dice "alterar cualquier dato cambia su hash", sin verificarlo.
- **Cómo se reproduce:** con un comprobante alterado (la consulta pública muestra la línea en rojo), pulsar "PDF". El documento sale limpio, sin advertencia.
- **Arreglo propuesto:** llamar a `verificarComprobante` (y a `verificarCadena` sobre los bloques de la orden) dentro de la generación. Si falla, imprimir un recuadro rojo "Comprobante alterado: no válido" y una marca de agua, como ya se hace con PRELIMINAR y ANULADO.

### M6. Comprobantes y consulta de entrega no están anclados al sello del lote

- **Severidad:** media
- **Dónde:** `comprobantesService.ts:237-306` (procedencias: solo estanque y cantidades). `ConsultaEntregaPublica.tsx:132-142` ("Ver lote" abre el estado actual).
- **Impacto:** si el lote cambia después de la entrega (C1, A2, A3), la consulta de la entrega no lo sabe. El cliente no puede demostrar qué certificado del lote correspondía a lo que recibió.
- **Arreglo propuesto:** guardar en cada procedencia del comprobante `selloLote = hashFinal` (en reglas, `== get(lote).data.resumen.hashFinal`, con el lote cerrado). Al abrir "Ver lote" desde la entrega, comparar y avisar si cambió. La cadena antigua `entregas/{codigo}` ya hace esto (`entregasService.ts:256`).

### M7. Las fechas de registro las pone el reloj del cliente y las reglas no las validan

- **Severidad:** media
- **Dónde:**
  - `registradoEn` (`lotesService.ts:259`), `fecha` de anotaciones y de eventos de orden (`pedidosService.ts:189`), `emitidoEn` (`comprobantesService.ts:337`) y `tomadaEn` de la foto (`fotosService.ts:87`).
  - Reglas: `eventoNuevoValido` (`firestore.rules:123-133`), `registroAnotacionValido` y `comprobanteValido` no comparan con `request.time`.
- **Impacto:** el hash prueba que el registro no cambió después de guardarse, no cuándo se guardó. Un usuario con permisos puede antedatar o posdatar un registro y el sello lo "certifica". `fechaEvento` la escribe el usuario a propósito, pero `registradoEn` se presenta como la hora del sistema.
- **Arreglo propuesto:**
  - En cada escritura, guardar un campo de nivel superior `selladoEnServidor` con `serverTimestamp()` y exigir en reglas `== request.time`. Los valores `serverTimestamp` no se admiten dentro de arreglos, por eso tiene que ir arriba.
  - Que la app compare `registradoEn` del último evento con ese campo, con una tolerancia de minutos.
  - O bien validar en reglas que `registradoEn` empiece con la fecha de `request.time`.

### M8. Una foto que falta antes de vencer se muestra igual que una vencida

- **Severidad:** media
- **Dónde:** `FotosEntregaOrden.tsx:43-60`: si no está el documento, el texto es "La imagen ya no está disponible (se conserva 15 días)", sin importar la fecha del evento.
- **Cómo se reproduce:** borrar `fotosEntrega/{id}` desde la consola el mismo día de la entrega. El operador ve el mensaje normal de vencimiento.
- **Arreglo propuesto:**
  - Si `Date.now() < fecha del evento + 15 días`, mostrar en rojo "Falta la foto registrada (se borró antes de su vencimiento)".
  - Distinguir también el caso de error de lectura (permisos) del de documento ausente.
  - Comprobar que `foto.eventoId` y `foto.ordenId` correspondan al evento.

---

## Baja

### B1. El "rastro por dato" (`huellas`) está fuera del hash y puede señalar un dato equivocado

- **Severidad:** baja
- **Dónde:** `hashService.ts:245-251`, `336-342`; `lotesService.ts:151`.
- **Detalle:** quien altera el dato X puede reescribir `huellas` para que el mensaje diga que cambió el dato Y. La detección de la alteración no se pierde (el hash del evento ya no coincide); solo cambia el diagnóstico.
- **Arreglo propuesto:** incluir `huellas` en el payload canónico de los eventos nuevos, o presentar el resultado como "pista" y no como hecho.

### B2. Anotaciones: el borrado del último registro no se detecta y `resueltas` no se cruza

- **Severidad:** baja (requiere consola)
- **Dónde:** `anotacionesService.ts:186-228`, `40-58`.
- **Detalle:** si se quita la última "Aprobación" o el último "Rechazo", la anotación vuelve a "pendiente" sin aviso, aunque `resueltas` siga marcándola resuelta. `id` y `registradoPorUid` no entran en el hash; este último es el que garantiza que proponente y aprobador sean personas distintas. La fecha viene del reloj del cliente (M7). `verificarAnotaciones` tampoco comprueba que `r.indice` sea igual a la posición.
- **Arreglo propuesto:** verificar que `resueltas` y los registros de resolución coincidan uno a uno, que `indice` sea igual a la posición, e incluir `registradoPorUid` en el hash de los registros nuevos.

### B3. La vista pública muestra anotaciones como válidas antes de verificarlas, o si la verificación falla

- **Severidad:** baja
- **Dónde:** `PublicTraceabilityView.tsx:122-138`.
- **Detalle:** `setDatosAnotaciones(d)` se ejecuta antes de terminar `verificarAnotaciones`. El filtro usa `verifAnotaciones?.alteradas`, que mientras tanto es `undefined`, y el `.catch(() => {})` deja las anotaciones visibles sin verificar.
- **Arreglo propuesto:** mostrar las anotaciones solo cuando `verifAnotaciones` exista y, si falla, mostrar "No se pudo verificar".

### B4. Fotos: el hash prueba solo la copia comprimida; no hay EXIF y no hay garantía de captura

- **Severidad:** baja
- **Dónde:** `fotosService.ts:62-89`; `DetalleEntregaRepartidor.tsx:484-486`; reglas `firestore.rules:1218-1238`.
- **Detalle:**
  - El hash es consistente: se calcula y se verifica sobre el mismo texto `data:image/jpeg;base64,...`.
  - Volver a codificar en canvas elimina el EXIF (fecha de captura, GPS, dispositivo). La orientación la aplican los navegadores actuales al dibujar la imagen, pero no los antiguos (iOS anterior a 13.4).
  - `tomadaEn` es la hora del procesamiento según el reloj del teléfono. `capture="environment"` es solo una sugerencia: algunos Android dejan elegir de la galería.
  - Las reglas no exigen que `datos` empiece por `data:image/jpeg;base64,`.
- **Arreglo propuesto:** presentar el hash como "integridad de la copia guardada" y no como "autenticidad de la captura". En reglas, `f.datos.matches('^data:image/jpeg;base64,[A-Za-z0-9+/=]+$')`. Si se quiere evidencia, guardar la fecha EXIF original antes de comprimir.

### B5. PDF del lote: no marca qué fase falla y la huella final impresa es la guardada

- **Severidad:** baja
- **Dónde:** `pdfService.ts:433-462`, `542-559`.
- **Detalle:** si la cadena falla, la tabla de fases se imprime igual, sin marcar las filas alteradas. "Huella final de la cadena" imprime `resumen.hashFinal` (el valor guardado), no el hash recalculado del último evento. El PDF no tiene huella propia, y su QR lleva a los datos vigentes, no a los de cuando se generó el PDF. La fecha de generación (`membrete`, `pdfService.ts:100`) solo es informativa y no afecta a la verificación.
- **Arreglo propuesto:** usar `analizarCadenaLote` para marcar en rojo las filas alteradas, imprimir el último hash recalculado (y el sello guardado si difiere) e incluir el sello en la URL del QR (A3).

### B6. El QR toma el origen del navegador

- **Severidad:** baja
- **Dónde:** `qrService.ts:11-26`.
- **Detalle:** un QR o una etiqueta generados desde `localhost`, la IP local o la URL de vista previa de Vercel apuntan a un origen que no es el oficial y que puede desaparecer. La URL de respaldo `cultivos-lore.web.app` corresponde a un Firebase Hosting que no se usa.
- **Arreglo propuesto:** fijar el origen oficial de producción por variable de entorno al generar los QR y quitar el respaldo de `web.app`.

### B7. La consulta pública no muestra el resultado de verificar los bloques de anulación

- **Severidad:** baja
- **Dónde:** `ConsultaEntregaPublica.tsx:38-41`, `160-164`.
- **Detalle:** los bloques de anulación se verifican, pero el resultado no se muestra. Una anulación alterada se ve igual que una válida.
- **Arreglo propuesto:** mostrar el sello verde o rojo también en las anulaciones.

### B8. La ficha nutricional y la configuración usadas en el certificado no están selladas

- **Severidad:** baja
- **Dónde:** `PublicTraceabilityView.tsx:604-630`; `pdfService.ts:342-369`, `511-530`.
- **Detalle:** la ficha nutricional, los rangos de calidad del agua (que deciden "Alerta" u "Óptimo") y el volumen del estanque (densidad) se leen de la configuración vigente. Si cambian después del cierre, el certificado de un lote antiguo cambia sin aviso.
- **Arreglo propuesto:** congelar en el evento de cierre (C1, punto 4) los rangos y la ficha aplicados.

---

## Respuestas directas a las preguntas del encargo

- **Respaldo no criptográfico:** sí produce hashes que se guardan y que las reglas aceptan. Una verificación hecha con el respaldo da falso válido para los registros creados con el respaldo y falso inválido para los genuinos (M1).
- **Fotos:** el hash es consistente entre subida y verificación. No se verifica al mostrar la foto (A4). Una foto vencida o faltante se muestra igual (M8). EXIF y rotación: ver B4.
- **PDF del lote:** recalcula la cadena y el sello. Si encuentra un problema, lo imprime en rojo, pero sigue imprimiendo los datos (B5). Un lote con la cabecera o el resumen alterados sale como válido (C1). La fecha de generación no afecta la verificación.
- **PDF del comprobante:** no recalcula nada (M5).
- **Hash, autor y fecha:** se guardan con cada registro y las reglas impiden modificarlos después. El autor se valida contra la sesión. La fecha no se valida (M7). El hash solo se valida en longitud (M1 y A3).
- **Lo que solo detecta la app:** alterar un dato sin recalcular, reordenar, borrar uno intermedio, cambiar `hashAnterior` o reemplazar la imagen de una foto (solo si se pulsa "Verificar"). Nada detecta una reescritura con recálculo (A3), los campos fuera del payload (C1, A1, B1, B8), el borrado del final con el sello actualizado (A2) ni el historial de órdenes (M2).
- **Verificación automática:**
  - Al abrir el lote (interno): se analizan las fases, pero se ignora el sello (A2).
  - Con `?lote=`: se analizan las fases y se marcan en rojo; no hay veredicto global ni comprobación del sello hasta pulsar el botón (A2).
  - Con `?entrega=`: se verifica cada bloque contra su hash y el índice, y se revisa el enlace de la cadena; no se detectan faltantes (M4) ni contenido inventado (A1).
- **Anclas al cierre:** las anotaciones y la cadena antigua `entregas` se anclan al último hash. Si el lote cambia, las anotaciones quedan "sin validez" (bien), pero solo se muestra dentro de su sección. Las órdenes y los comprobantes no se anclan al lote (M6).
