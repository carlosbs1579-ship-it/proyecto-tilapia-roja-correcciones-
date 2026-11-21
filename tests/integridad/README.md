# Pruebas de alteración (integridad) · SOLO EMULADOR

Estas pruebas no tocan producción. Usan emuladores propios: Firestore en 8185 y Auth en 9199
(hub 4485, logging 4585). El script se niega a correr si Firestore no es `127.0.0.1:8185`.

## Qué hace `ataques.ts`

1. **Crea datos válidos** con los servicios reales de `src/services` y con las reglas activas
   (`firestore.rules` copiado tal cual):
   - lote `20260801-<letra>-E1` creado con `crearNuevoLote` (contadores y reglas reales), cinco fases y
     cierre (`registrarEventoEnLote`, `cerrarLote`); se guarda el inicio del sello como lo imprime la
     etiqueta QR (`?s=`);
   - cliente `PRUEBA-Restaurante Integridad` y orden confirmada (`crearCliente`, `crearOrden`);
   - inicio de ruta, llegada y entrega con foto como repartidor (`registrarAccion`, la bandeja real);
   - comprobante definitivo (`emitirComprobanteDefinitivo`);
   - anotación propuesta por una persona y aprobada por otra (`proponerAnotacion`, `resolverAnotacion`).

   `esPrueba: true` se agrega con el token de consola solo al lote, la foto, las anotaciones y el
   cliente: en esos documentos no entra en ningún hash. No se agrega a comprobantes (su hash cubre
   todos los campos) ni a órdenes o consultasEntrega (las reglas usan `hasOnly` y la app los
   reescribe completos: un campo extra bloquea la anulación).
2. **Simula ataques** con el token `Bearer owner`, que equivale a editar desde la consola de Firebase.
3. **Evalúa** después de cada ataque, con las mismas funciones que llaman las pantallas
   (`revisarLote` en la vista pública y el detalle, `verificarAnotaciones`, `revisarFoto` en las fotos
   de la orden, `revisarConsultaEntrega` en el QR del comprobante y `verificarComprobante` con la orden
   en el panel interno), lo que mostraría cada pantalla:
   - avisos automáticos: lo que aparece en rojo al abrir el QR del lote, el QR de la entrega o el panel
     interno de la orden;
   - fallas manuales: lo que solo aparece al pulsar "Verificar integridad", "Verificar foto" o
     "Verificar" del comprobante.

   La columna "QR antiguo" dice si el aviso del lote sale también con una etiqueta impresa antes del
   sello en el QR (sin `s=`). Los ataques 6d y 8d reescriben todo (cadena, resumen y anotaciones): solo
   los detecta el sello impreso.

   Clasificación: "detectado y avisado" (hay aviso automático), "detectado sin aviso" (solo al pulsar
   un botón) y "NO DETECTADO". Luego restaura el documento original y comprueba que todo vuelva a ser
   íntegro.
4. **Prueba los parámetros** `?lote=` y `?entrega=` con valores raros (copia literal de
   `PublicTraceabilityView.cargarLote` y el `leerConsultaEntrega` real, sin sesión).
5. **Repite alteraciones como usuarios normales** (con reglas) y prueba dos huecos de las reglas.

### Testigo externo, ficha congelada y fecha de cámara (tercera ronda)

`calendarios-simulados.ts` reemplaza `fetch` solo para los calendarios de OpenTimestamps y para
`blockstream.info`: responden con el mismo formato binario que los reales (comprobado a mano contra
los calendarios públicos) y la prueba no depende de la red. El cierre y la emisión envían el sello con
el código real; el repartidor guarda la confirmación (reglas activas). `construir.mjs` fija
`VITE_SELLO_TIEMPO_DESDE=2026-01-01` para que los registros de la prueba deban tener sello.

Ataques nuevos: TS-a (reescribir toda la cadena), TS-b (cambiar el digest del sello), TS-c (fabricar
la prueba .ots con el sello nuevo), TS-d (volver a sellar el lote reescrito, confirmado 10 días después),
TS-e y TS-h (borrar el sello del lote o del comprobante), TS-f (poner el sello de otro registro), TS-g
(recalcular el comprobante), F41-a y F41-b (cambiar o borrar la ficha congelada) y EX-a (foto con fecha
de cámara 10 días antes de la entrega).

Cuarta ronda: la raíz de Merkle se comprueba en blockstream.info y mempool.space a la vez
(`CALENDARIO.exploradores` simula cada uno caído, con otra raíz o con otra hora). Ataques BX-a a BX-d;
la sección 14 cubre los casos sin alteración (ambos coinciden, uno caído con nota "1 de 2", ambos
caídos sin alarma). La sección 13 comprueba el documento sellado y el expediente de la cadena.

## Cómo correrlo

Desde esta carpeta (`tests/integridad`):

```bash
node construir.mjs          # empaqueta ataques.ts con esbuild y copia firestore.rules
npx firebase emulators:exec --only firestore,auth --project iron-outpost-cw2pc "node .salida/ataques.mjs"
```

O con los emuladores ya levantados (`npx firebase emulators:start --only firestore,auth --project iron-outpost-cw2pc`):

```bash
node .salida/ataques.mjs
```

`construir.mjs` sustituye `src/firebase/firebaseConfig.ts` por `firebase-emulador.ts` al empaquetar.
También fija `VITE_ORIGEN_PUBLICO=http://localhost:3000` (en Node no hay `window.location` y las reglas
exigen un enlace válido en `pdfUrl`).
El resto del código de la app se usa sin cambios. `shim.ts` agrega `localStorage` y `navigator.onLine`
para que la bandeja del repartidor funcione en Node.

## Salidas

- `resultados.md`: tabla de ataques, parámetros de la URL y pruebas de reglas.
- `resultados.json`: lo mismo con todas las señales.
- `ultima-salida.log`: consola de la última corrida (incluye los PERMISSION_DENIED esperados).

Se puede correr varias veces sobre el mismo emulador: cada corrida usa un código de lote nuevo.

## Verificación de solo lectura en producción

`verificar-lotes-prod.ts` lee `lotes`, `anotacionesLote` y `configuracion/general` de producción con
GET (token de firebase-tools) y los revisa con `revisarLote` y `verificarAnotaciones`. No escribe nada.
Desde la raíz:

```bash
npx esbuild tests/integridad/verificar-lotes-prod.ts --bundle --platform=node --format=esm --packages=external --target=node20 "--define:import.meta.env={\"DEV\":false,\"PROD\":false,\"VITE_EMULADORES\":\"false\"}" --outfile=tests/integridad/.salida/verificar-lotes-prod.mjs
node tests/integridad/.salida/verificar-lotes-prod.mjs
```

Los dos scripts de producción también revisan el sello de tiempo (sin escribir la confirmación), la
ficha y la fecha de cámara de las fotos.
