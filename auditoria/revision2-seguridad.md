# Revisión 2 · Seguridad (verificación ligera)

Fecha: 2026-11-20. Rama `correciones-claude`, HEAD `99b993f` (testigo externo OpenTimestamps, H41 y H38, sin desplegar).
Comparación con `origin/main` = `3815528`. No se cambió código de la app ni reglas.

## 1. Suites en el emulador

| Suite | Resultado | Notas |
| --- | --- | --- |
| `tests/reglas` (`npm test`, puerto 8085) | **192/192** | 0 fallas |
| `tests/seguridad` (`seguridad.test.mjs` + `fotos.test.mjs`, puerto 8285) | **78/78** | Se creó la unión `tests/seguridad/node_modules` → `tests/reglas/node_modules` (ignorada por git). El CLI `firebase` global, no el de `node_modules/.bin`. |
| `tests/integridad` (`construir.mjs` + `ataques.mjs`, 8185/9199) | **47/47 "detectado y avisado"** | Incluye TS-a a TS-h, F41-a, F41-b y EX-a. |
| `tests/integridad` sin `VITE_SELLO_TIEMPO_DESDE` (fecha por defecto `2026-11-20`) | **47/47 "detectado y avisado"** | Corrida extra con una copia temporal de `construir.mjs` (borrada). Hoy los lotes de la prueba cierran el 2026-11-20 y los comprobantes se emiten hoy, así que siguen exigiendo sello. |

Sobre `SELLO_TIEMPO_DESDE`: `loteDebeTenerSello` usa `fechaCierre >= DESDE || fecha del código >= DESDE`, y `bloqueDebeTenerSello` usa `emitidoEn` u hora del servidor. Con `2026-11-20` nada que se cierre o emita desde hoy queda fuera. Los registros anteriores salen como "anterior al sello de tiempo", sin alarma. La fecha no rompe ningún caso. Si las pruebas se corren con una fecha forzada posterior al día de la corrida, TS-* dejaría de exigir sello; por eso `construir.mjs` fija `2026-01-01`.

`tests/integridad/resultados.md` y `resultados.json` quedan regenerados con la corrida normal (fechas e ids nuevos, mismo resultado).

## 2. Controles revisados por lectura

| Control | Estado |
| --- | --- |
| Reglas sin escritura sin sesión | Se mantiene. No hay `allow write/create/update: if true`. Los cambios frente a main añaden ramas nuevas con `isSignedIn()` (sello de lote y de comprobante). |
| Roles | Se mantiene. Para crear el sello hace falta `cerrarLotes` o `gestionarComprobantes` (o el administrador maestro). Para confirmarlo, un usuario activo de la misma granja. |
| Lote cerrado inmutable | Se mantiene, con una sola excepción: `selloTiempo`. `affectedKeys().hasOnly(['selloTiempo'])`, digest igual a `resumen.hashFinal`, se crea una vez como pendiente con `enviadoEn == request.time` y solo puede pasar a confirmado. |
| Comprobantes no editables | Se mantiene. `delete: false`; `update` solo para `selloTiempo`, con `digest == hashComprobante`. El hash del bloque excluye `selloTiempo`, `registradoEnServidor` y el propio hash, así que los bloques anteriores no cambian. |
| Fotos | Se mantiene. `hasOnly` solo suma `tomadaEnExif` (validada con una expresión regular). El hash va sobre el texto final guardado: `sha256Texto(datos)` del JPEG comprimido. |
| Lotes: H41 | `fichaNutricionalCierre` solo se puede escribir al cerrar, con 9 claves exactas y tipos. Después no cambia. |
| storage.rules | Sin cambios frente a main. `write: false`, solo lectura de `lotes/`. Storage no tiene buckets (H64). |
| SHA-256 | Las fotos se hashean sobre los bytes o el texto finales. Los comprobantes, sobre el JSON canónico. Los PDF no se guardan: se generan en el navegador desde los datos ya verificados (Storage no se usa), así que su integridad depende de la verificación del lote o del comprobante. |
| Verificación al abrir el lote | `LoteDetailModal` llama `revisarLote` + `verificarAnotaciones` + `revisarSelloLote`. |
| Verificación al escanear el QR | `PublicTraceabilityView` llama `revisarLote(lote, { selloQr: selloDeLaUrl(...) })` + `revisarSelloLote`. |
| Alerta de alteración | Sale automáticamente (comprobado en las 47 pruebas y en producción). |
| Protección de rutas | `App.tsx` no cambia frente a main. Sin `usuario` se muestra el ingreso; las pestañas dependen de las funciones del perfil activo. Solo `?lote=` y `?entrega=` son públicas (de solo lectura). |

`git diff origin/main -- firestore.rules storage.rules`: 80 líneas añadidas y 6 quitadas, todo en `firestore.rules`. Las 6 líneas quitadas se reemplazan por versiones que solo amplían los campos (`fichaNutricionalCierre`, `tomadaEnExif`) o que añaden la excepción de `selloTiempo` con sesión. **No se debilitó nada fuera del sello de tiempo.**

**Observación (baja, sin cambios hechos):** cualquier usuario activo de la granja puede pasar un sello pendiente a "confirmado". Las reglas solo exigen una prueba `.ots` más larga y un `bloque` entero; no pueden comprobar la prueba. Una persona interna podría escribir una confirmación falsa: la app la detecta y avisa, pero el aviso queda fijo, porque un sello confirmado ya no se puede cambiar con las reglas. Es una falsa alarma imposible de reparar, no una alteración que pase sin aviso. Hay dos opciones: limitar la confirmación al mismo personal que crea el sello, o documentarlo como riesgo aceptado. La app puede volver a completar la prueba desde los calendarios.

## 3. Alteraciones en producción (datos de prueba)

`produccion-prueba.mjs` solo cubre lotes (`cabecera`, `fase`, `borrar-ultima`) y necesita un lote PRUEBA ya creado con la app. Ninguno de sus casos es exactamente uno de los 3 pedidos. Se usó un script equivalente, `prod-alteraciones.ts`, guardado en el scratchpad y no en el repo, con las mismas credenciales de firebase-tools y la misma base:

- Copia a producción los documentos que generó la corrida de integridad en el emulador con los servicios reales y las reglas: lote `20260801-B-E1` (proveedor "Proveedor PRUEBA", `esPrueba: true`), foto `foto-f18f7d46…` (`esPrueba: true`) y comprobante `cmpaef338a…` (cliente "PRUEBA-Restaurante Integridad"; sin `esPrueba` porque su hash cubre todos los campos). Granja `cultivos-lore`.
- Candado: aborta si cualquiera de esos ids ya existe en producción.
- Evalúa leyendo de producción con las funciones de las pantallas: `revisarLote` (QR con sello), `revisarFoto` (panel de la orden) y `verificarComprobante` con la orden (panel interno; la orden se toma del emulador en memoria y no se copió a producción).
- La web publicada (main) usa las mismas funciones `revisarLote`, `revisarFoto` y `verificarComprobante`: la rama no las cambia, salvo la exclusión de `selloTiempo` en el hash del comprobante.

| Prueba | Alteración | Resultado |
| --- | --- | --- |
| Línea base | (ninguna) | Lote íntegro y el sello del QR coincide; foto verificada; comprobante íntegro |
| 1. Un byte del comprobante (lo que respalda el PDF) | `cliente.nombre` "…Integridad" → "…Integridae" (1 bit) | **Detectado y avisado**: "Verificación fallida: el contenido no corresponde a su hash; el cliente no coincide con la orden." |
| 2. Reemplazar la foto de entrega | `datos` reemplazado por otro JPEG válido (FFD8…FFD9, un byte distinto), sin tocar `hash` | **Detectado y avisado**: "Posible alteración detectada: la imagen no coincide con la registrada en la entrega." |
| 3. Editar el hash guardado | hash de la última fase y `resumen.hashFinal` cambiados, coherentes entre sí | **Detectado y avisado**: "Fase #5 (Cosecha) alterada…" y "El sello impreso en el código QR no coincide…" (sin sello en el QR: 1 aviso, también alterado) |
| Restaurar | Restaurado | Todo vuelve a íntegro |

Nota del primer intento: al cambiar el proveedor a `PRUEBA-auditoria`, la línea base salió como alterada ("Proveedor de alevinos: el dato guardado no corresponde a las fases"). La cabecera está protegida, así que se dejó el proveedor original. La primera versión del ataque 2 usó la otra foto de la prueba, que resultó idéntica (mismo archivo de prueba) y por eso dio "verificada". Se corrigió con una imagen realmente distinta.

**Limpieza:** después de cada corrida se borraron los 3 documentos; el GET siguiente dio 404. Se recorrieron `lotes`, `fotosEntrega`, `comprobantes`, `ordenes`, `clientes`, `consultasEntrega`, `anotacionesLote` y `contadores`: **0 documentos con PRUEBA, `esPrueba: true` o código 20260801-** (producción: 1 lote, 4 fotos, 4 comprobantes, 4 órdenes). No se tocaron datos reales. La red a googleapis funcionó.

## 4. npm audit y secretos

- La raíz no tiene `package-lock.json` (usa `bun.lock`), así que `npm audit` da ENOLOCK. Se generó un lock temporal en el scratchpad (`npm i --package-lock-only --legacy-peer-deps`, que hace falta por un conflicto de peers con `@vitejs/plugin-react`).
- `npm audit --omit=dev`: 4 altas, todas en `@grpc/grpc-js <=1.13.5`. `npm audit` completo: las mismas 4. Es H63, ya conocido: solo Node, no llega al navegador.
- Secretos: no hay claves privadas PEM, `service_account`, ghp_/sk-/xox/AKIA ni archivos .pem, .key o adminsdk versionados. Solo `.env.example` está versionado; `.gitignore` cubre `.env*`. La apiKey web de Firebase es pública por diseño.
- El subagente marcó como "CRÍTICO" el `client_id`/`client_secret` que aparece en `tests/integridad/produccion-prueba.mjs`, `verificar-lotes-prod.ts` y `verificar-comprobantes-prod.ts`. **No es crítico:** es el cliente OAuth público de firebase-tools (aplicación instalada, publicado en el código abierto de firebase-tools). El `refresh_token` se lee de `~/.config/configstore/firebase-tools.json` y no está en el repo. Mejora opcional: leer esos valores de variables de entorno para que los escáneres no los marquen.

## Hallazgos críticos

Ninguno.
