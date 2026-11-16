# Pruebas de alteración (integridad) · SOLO EMULADOR

Estas pruebas no tocan producción. Usan emuladores propios: Firestore en 8185 y Auth en 9199
(hub 4485, logging 4585). El script se niega a correr si Firestore no es `127.0.0.1:8185`.

## Qué hace `ataques.ts`

1. **Crea datos válidos** con los servicios reales de `src/services` y con las reglas activas
   (`firestore.rules` copiado tal cual):
   - lote `PRUEBA-<sello>-A-E1` con siembra, cinco fases y cierre (`registrarEventoEnLote`, `cerrarLote`);
   - cliente `PRUEBA-Restaurante Integridad` y orden confirmada (`crearCliente`, `crearOrden`);
   - inicio de ruta, llegada y entrega con foto como repartidor (`registrarAccion`, la bandeja real);
   - comprobante definitivo (`emitirComprobanteDefinitivo`);
   - anotación propuesta por una persona y aprobada por otra (`proponerAnotacion`, `resolverAnotacion`).

   `esPrueba: true` se agrega con el token de consola solo al lote, la foto, las anotaciones y el
   cliente: en esos documentos no entra en ningún hash. No se agrega a comprobantes (su hash cubre
   todos los campos) ni a órdenes o consultasEntrega (las reglas usan `hasOnly` y la app los
   reescribe completos: un campo extra bloquea la anulación).
2. **Simula ataques** con el token `Bearer owner`, que equivale a editar desde la consola de Firebase.
3. **Evalúa** después de cada ataque, con las funciones reales (`analizarCadenaLote`,
   `verificarIntegridadLote`, `verificarAnotaciones`, `verificarFoto`, `leerConsultaEntrega`,
   `verificarComprobante`, `verificarCadena`), lo que mostraría cada pantalla:
   - avisos automáticos: lo que aparece en rojo al abrir el QR del lote, el QR de la entrega o el panel
     interno de la orden;
   - fallas manuales: lo que solo aparece al pulsar "Verificar integridad", "Verificar foto" o
     "Verificar" del comprobante.

   Clasificación: "detectado y avisado" (hay aviso automático), "detectado sin aviso" (solo al pulsar
   un botón) y "NO DETECTADO". Luego restaura el documento original y comprueba que todo vuelva a ser
   íntegro.
4. **Prueba los parámetros** `?lote=` y `?entrega=` con valores raros (copia literal de
   `PublicTraceabilityView.cargarLote` y el `leerConsultaEntrega` real, sin sesión).
5. **Repite alteraciones como usuarios normales** (con reglas) y prueba dos huecos de las reglas.

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
El resto del código de la app se usa sin cambios. `shim.ts` agrega `localStorage` y `navigator.onLine`
para que la bandeja del repartidor funcione en Node.

## Salidas

- `resultados.md`: tabla de ataques, parámetros de la URL y pruebas de reglas.
- `resultados.json`: lo mismo con todas las señales.
- `ultima-salida.log`: consola de la última corrida (incluye los PERMISSION_DENIED esperados).

Se puede correr varias veces sobre el mismo emulador: cada corrida usa un código de lote nuevo.
