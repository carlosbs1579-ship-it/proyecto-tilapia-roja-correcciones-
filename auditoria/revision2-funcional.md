# Revisión 2: funcionamiento y regresiones (rama correciones-claude, 99b993f)

Solo revisión, sin cambios de código. Fecha 2026-11-20.

## Montaje
- Emuladores Auth 9099 y Firestore 8085 (reglas = firestore.rules del repo), `VITE_EMULADORES=true npx vite --port=3000`.
- La extensión Claude in Chrome NO estaba conectada (`list_connected_browsers` = []). Se usó Chrome headless (playwright-core, Chrome instalado) con scripts en el scratchpad. No hay captura en pestañas del navegador del usuario; no se abrieron pestañas.
- Cuentas sembradas con `sembrar-cuentas.mjs` (admin, vendedor, operador, repartidor). Orden sembrada `PED-PRUEBA-REV2`, cliente `PRUEBA-Restaurante`, lote con proveedor `PRUEBA-proveedor` (el código del lote lo genera el sistema: 20261110-A-E2).
- Procesos iniciados y detenidos por PID (vite, firebase emulators, java). No se tocaron los de otros agentes.

## Recorrido y resultado
| Rol | Paso | Resultado |
| --- | --- | --- |
| Operador | ingreso, inicio | OK |
| Operador | crear lote (E2, 5000, 2,5 g) | OK, aparece en inicio y en Lotes |
| Operador | registrar fase Calidad del agua y Alimentación | OK (3 fases) |
| Operador | Descargar PDF (CultivosLore_Lote_...pdf) y Vista previa (blob) | OK |
| Operador | QR Etiqueta: imagen generada; URL `/?lote=20261110-A-E2` | OK |
| Anónimo | abrir la URL pública del QR, lote activo y luego cerrado | OK ("LOTE EN CULTIVO" y luego "CERTIFICADO · LOTE SELLADO", sello SHA-256 mostrado) |
| Operador | cerrar lote | OK; se ve "SELLO DE TIEMPO EN BITCOIN: pendiente de confirmar (suele tardar unas horas)" en detalle y vista pública |
| Admin | Inicio, Lotes, Entregas (subpestañas Pedidos, Repartidores, Solicitudes, Novedades, Historial, Disponibilidad), Analítica (Comparativo de estanques), Configuración (Estanques y piscinas), Personal (Todos/Activos/Pendientes/Inactivos) | todas cargan sin error |
| Vendedor/operador (permisos) | Inicio, Lotes, Entregas, Analítica, Configuración | OK; no ven Personal (correcto) |
| Repartidor | lista, detalle, Iniciar ruta, Registrar llegada, foto PNG adjunta, Confirmar entrega | foto se acepta y se previsualiza; ver hallazgo 2 |

## Hallazgos funcionales
1. **Sellos de tiempo, CORS (media, probable en producción también).** Al cerrar el lote y al abrir la vista pública, las peticiones GET `.../timestamp/<commitment>` a `finney.calendar.eternitywall.com`, `bob.btc.calendar.opentimestamps.org` y `alice.btc.calendar.opentimestamps.org` fallan: "blocked by CORS policy: No 'Access-Control-Allow-Origin'" (net::ERR_FAILED). Es del servidor del calendario, no de la CSP, así que no depende del origen local. Efecto: la actualización del sello (de pendiente a confirmado) probablemente nunca se completa desde el navegador. Archivo probable: `src/lib/ots.ts` / `src/services/selloTiempoService.ts` (rutina que "mejora" el sello). Los POST iniciales a `a.pool.*` sí se hicieron y el sello quedó "pendiente".
2. **Entrega del repartidor: aviso de éxito optimista (baja, UX).** En `DetalleEntregaRepartidor.tsx` (`confirmarEntrega`) se muestra "Entrega completa registrada." de inmediato; el Commit falló con permission-denied (403) y la pantalla siguió "EN RUTA", Entregado 0. La causa en esta corrida es mi siembra: la orden no tenía el documento `inventarioLotes/20261110-A-E2` que las reglas exigen, así que NO es un fallo de la app. Pero queda el patrón: el mensaje verde sale antes de la confirmación del servidor; el usuario solo se entera por el panel "Mis acciones" y por consola. No pude verificar la entrega completa hasta el final (queda para repetir con inventario real).
3. Ruido de prueba: `Listen/channel ... net::ERR_ABORTED` y `index.css?t=... ERR_ABORTED` son normales (cierre de canales, HMR de Vite).

## Consola y red
- Errores de consola: solo los CORS de OpenTimestamps (hallazgo 1) y el 403 de la entrega sembrada (hallazgo 2). Ninguna advertencia de React, ningún error de página (`pageerror`) en operador, administrador, vendedor ni repartidor.
- No se probó subida de PDF a Storage: la app ya no usa Storage (pdfService y fotosService lo dicen); el PDF se genera en el navegador y la foto se guarda comprimida en Firestore.

## Orígenes contactados frente a la CSP de vercel.json
Origenes vistos: localhost (self), fonts.googleapis.com, fonts.gstatic.com, a.pool.opentimestamps.org, b.pool.opentimestamps.org, a.pool.eternitywall.com, finney.calendar.eternitywall.com, bob.btc.calendar.opentimestamps.org, alice.btc.calendar.opentimestamps.org, y los emuladores 127.0.0.1 (solo local).
- Todos están permitidos: fonts.googleapis.com en style-src, fonts.gstatic.com en font-src, y los seis dominios de calendario en connect-src. **Ningún origen que la CSP bloquee.**
- No apareció blockstream.info (está en connect-src, se usa solo al verificar). No se probó el flujo de verificación contra Bitcoin ni el inicio de sesión con Google (frame-src/script-src de Google), que en emulador no se usa.
- Ojo: en producción Firebase usa `https://firestore.googleapis.com` e `identitytoolkit.googleapis.com`, cubiertos por `https://*.googleapis.com`; el comodín no incluye `*.firebasestorage.app` (no se usa).
- `img-src` incluye `data:` y `blob:` (QR en data URL, foto en data URL, vista previa del PDF en blob): bien. La vista previa del PDF abre un `blob:` en pestaña nueva: la CSP de la página no afecta a esa pestaña, pero si se incrustara en iframe haría falta `frame-src blob:` (hoy no se incrusta).

## Build, lint y tipos (subagente haiku)
- `vite build` OK (2952 módulos, 1,4 s, sin avisos); `npm run lint` (= tsc --noEmit) OK; `npx tsc --noEmit` OK. No hay script de tests unitarios.
- Chunks mayores: index.esm 496 kB (gzip 150), index 457 kB, jspdf 400 kB, AnaliticaTab 390 kB, html2canvas 199 kB.

## No cubierto
- Entrega finalizada de punta a punta, consulta pública de entrega/comprobante, y tamaño móvil.
- Con Chrome in Chrome desconectado no se hicieron capturas visuales revisadas en detalle; hay PNG en `scratchpad/emu-rev2/cap/`.

## Producción (Fase 4)

Fecha: 2026-11-20. URL: https://proyecto-tilapia-roja-correcciones.vercel.app (sesión Operador ya iniciada).

Pasos:
- Crear lote (proveedor PRUEBA-revision2, obs PRUEBA-observaciones): OK. Código 20261120-A-E1 (consecutivo #6, estanque E1).
- Registrar fase "Calidad del agua" (nota PRUEBA-fase agua): OK, "verificada en la cadena de hashes".
- Verificar integridad en detalle: OK, resultado ÍNTEGRO (2 fases).
- QR: OK. URL pública ?lote=20261120-A-E1 abierta en otra pestaña: carga íntegra, sin aviso rojo, "Cadena verificada al abrir".
- Vista Previa PDF: OK, se abre blob PDF en pestaña nueva sin diálogos (cerrada).
- Cierre del lote: usa modal propio de la app ("¿Confirmar cierre y generar PDF final?"), no confirm() nativo. OK. Estado SELLADO · COSECHADO; "Sello de tiempo enviado, pendiente de confirmar en Bitcoin" visible.
- Pestañas del Operador: Inicio y Lotes revisadas, OK (Lotes muestra 2 lotes cerrados).
- Órdenes/entregas del Operador: no hay sección visible; omitido. No se creó cliente PRUEBA-cliente.
- Repartidor: panel "Mis entregas" sin entregas asignadas (todas las pestañas vacías); avance de entrega y adjunto de imagen omitidos. Vuelto a modo Operador.

Consola (patrón CSP/Refused/Error/Failed): sin mensajes en ninguna pestaña.
Red: sin 4xx/5xx de la app ni Firestore. Solo 503 en GET de calendarios OpenTimestamps (finney.calendar.eternitywall.com, alice/bob.btc.calendar.opentimestamps.org) al consultar el sello pendiente; los POST /digest a pool OTS devolvieron 200. Sin errores CORS/CSP.

Creado en producción (a borrar): lote 20261120-A-E1 (con 2 eventos: siembra y calidad del agua, sellado/cerrado, sello OTS pendiente). Sin órdenes ni clientes.
