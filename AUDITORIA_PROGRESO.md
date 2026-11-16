# Auditoría de integridad, seguridad y regresiones

Inicio: 2026-11-15 (noche). Rama de trabajo: `correciones-claude`.

## Estado

| Fase | Estado |
| --- | --- |
| 0. Reconocimiento | Hecha |
| 1. Revisión con 5 agentes | Hecha |
| 2. Reporte (REPORTE_AUDITORIA.md) | Hecho: 69 hallazgos (2 críticos, 9 altos, 22 medios, 30 bajos, 6 informativos) |
| 3. Correcciones y despliegues | Hecha: 3 tandas, reglas y web desplegadas |
| 4. Verificación final en producción | Hecha: ver REPORTE_AUDITORIA.md sección 7 |

## Estado inicial (fase 0)

- `npx tsc --noEmit`: sin errores.
- `tests/reglas` (`npm test`, emulador): 143 de 143 pasan.
- No hay linter aparte: `npm run lint` es `tsc --noEmit`.
- Respaldos en `respaldos_despliegue/2026-11-15_2310/`:
  - reglas de Firestore publicadas (release 2026-11-15T02:13:57Z), idénticas a `firestore.rules` del repo;
  - Storage no tiene reglas publicadas (no hay release de firebase.storage);
  - `version-web.txt`: commits de main y correciones-claude, más los despliegues de Vercel en producción.

## Diferencias con lo que supone el plan

- **Alojamiento**: la web se publica en Vercel. Producción sale de `main` y la vista previa de `correciones-claude` está en proyecto-tilapia-roja-claude.vercel.app. No hay Firebase Hosting. "Desplegar hosting" significa pasar a main; para volver atrás se hace `vercel rollback` o se revierte el merge.
- **Storage**: la app no sube archivos. `storage.rules` niega toda escritura y solo permite leer `lotes/{archivo}`, que son restos antiguos.
- **PDF**: el certificado del lote y el comprobante de entrega se generan en el navegador al pedirlos y no se guardan. Lo que se protege con hash son los registros de los que salen.
- **Imágenes**: las fotos de entrega se guardan como texto base64 en `fotosEntrega/{id}` en Firestore y se borran solas a los 15 días por la política TTL sobre `expiraEn`. El evento de la orden guarda el id y el SHA-256 del texto `data:image/jpeg;base64,...`, no de los bytes del JPEG.
- **Base de datos**: Firestore con nombre `ai-studio-33039dd2-b725-497c-80b6-eb6761337ba9`, proyecto `iron-outpost-cw2pc`. Las reglas se publican desde la carpeta del scratchpad `deploy-reglas` (firebase.json apuntando a esa base).

## Mapa del flujo de un lote

1. **Creación** (`lotesService.crearNuevoLote`): transacción con los contadores `contadores/lotes_global` y `contadores/diario_*`. Crea `lotes/{codigo}` con el evento 0 encadenado al génesis `0`×64.
2. **Fases** (`registrarEventoEnLote`): cada evento lleva `hash = SHA-256(JSON canónico)` (`hashService.generarJsonCanonico`) y `hashAnterior` (el del evento previo). Las reglas exigen que el arreglo de eventos solo crezca y que no se reescriban los anteriores. Las reglas no pueden calcular SHA-256: solo comprueban el enlace y la forma.
3. **Correcciones de siembra o piscina** (`modificarDatosSiembraOPiscina`): se agregan como eventos nuevos.
4. **Cierre** (`cerrarLote`): sella el lote. `entregasService.hashDeCierre` es el ancla de las cadenas posteriores.
5. **Anotaciones posteriores al cierre** (`anotacionesLote/{codigo}`): cadena propia anclada al sello. Proponer y aprobar lo hacen personas distintas.
6. **Entregas**:
   - `entregas/{codigo}` es la cadena por lote.
   - `ordenes/{id}` son las órdenes, con un historial de eventos encadenado.
   - `comprobantes/{id}` son los bloques del comprobante y la anulación, encadenados.
   - `consultasEntrega/{token}` es el índice público que abre el QR del comprobante.
   - `fotosEntrega/{id}` son las fotos.
7. **PDF**:
   - `pdfService.generarLotePdfBlob` arma el certificado del lote con los hashes de la cadena.
   - `generarComprobantePdfBlob` arma el comprobante.
   - Ninguno se sube. `generarYSubirPdfLote` solo devuelve la URL pública y la versión.
8. **QR**:
   - `qrService.construirUrlPublicaTrazabilidad` produce `origin/?lote=CODIGO`.
   - El QR del comprobante produce `origin/?entrega=TOKEN`.
   - Se generan con `qrcode` y la etiqueta PNG se dibuja en canvas.
9. **Consulta pública** (`App.tsx` lee `?lote` o `?entrega`):
   - `PublicTraceabilityView` lee el lote y verifica la cadena en el navegador (`hashService.verificarIntegridadLote` / `analizarCadenaLote`).
   - `ConsultaEntregaPublica` usa `comprobantesService.leerConsultaEntrega` y `verificarComprobante`.
10. **Verificación manual**: `IntegrityCheckModal` en el detalle del lote, y `verificarFoto` para las fotos.

Roles: `usuarios/{uid}` con funciones admin, operator y courier, más permisos por cargo. El ingreso es por correo y contraseña (Firebase Auth). La función activa se elige al entrar.

## Fase 1: agentes

| Agente | Tema | Estado | Hallazgos |
| --- | --- | --- | --- |
| 1 | Integridad y hash | terminado | 21 (1 crítica C1 cierre sin límite de campos, 4 altas) |
| 2 | Pruebas de alteración (emulador) | terminado | 8 (3 altas marcadas CRÍTICO) |
| 3 | Seguridad Firebase y código | terminado | 20 (0 críticas, 1 alta = C1, 6 medias) |
| 4 | Bugs funcionales | terminado | 16 (3 altas) |
| 5 | Regresiones | terminado | 13 (1 alta) |

Puertos asignados para que no choquen:
- Agente 2: Firestore 8185, Auth 9199.
- Agente 3: Firestore 8285.
- Agente 4: app con emuladores en 8085/9099 y Vite en 3000.
- Agente 5: Vite en 3001 contra los mismos emuladores del agente 4, solo lectura.

## Despliegues

- 2026-11-16 14:13 UTC: reglas de Firestore (commit 3d35745). Bien: lectura pública, ingreso y lista de lotes sin errores.
- 2026-11-16: web a main (PR #24, bb792c4), Vercel 5f3h9ikqe. Bien. Revertir: vercel rollback a hpc7j252w.
- Antes de publicar las reglas se revisó en modo lectura producción: 1 solo lote real (20261031-A-E1, cerrado y coherente).

## Fase 3: plan de tandas

- Tanda 1 (en paralelo):
  - REGLAS: firestore.rules, tests/reglas, tests/seguridad.
  - INTEGRIDAD-APP: servicios de hash, comprobantes, fotos, anotaciones, pdf, qr, lotes y reparto; PublicTraceabilityView, ConsultaEntregaPublica, FotosEntregaOrden, DocumentacionEntrega, AnotacionesLotePanel, LoteDetailModal, IntegrityCheckModal, firebaseConfig.
  - DISENO-A: index.css, motion.css, presencia.ts, NuevoLoteModal, QrModal, AuthModal, NuevaOrdenModal, EntregasPanel, PersonaUi, vite.config.
  - CONFIG (vercel.json): agente principal.
- Tanda 2: FUNCIONAL. NuevoEventoModal, DetalleEntregaRepartidor, ConfiguracionTab, AnaliticaTab, usuariosService; lotesService y repartoService después de INTEGRIDAD; App.tsx (H26, H50, H54).
- Tanda 3: DISENO-B. App.tsx (H30, H31, H33, H58, H59, H61); H32 y H56 en LoteDetailModal, IntegrityCheckModal y NuevoEventoModal.
- Pendientes de consulta al usuario:
  - H20: correos en lotes reales.
  - H42: dirección en el comprobante público.
  - H14: solo si exige migrar órdenes reales.

### Tanda 1: DISENO-A terminado

Cerrados: H11, H30, H32 (hook nuevo `src/lib/ventana.ts`, useVentana), H56, H57, H60, H62. H69 solo a medias: index.esm no se puede partir, queda vigilado.

Para la tanda 3, cada componente importa useVentana y lo llama antes de cualquier `return null`:
- **IntegrityCheckModal:** `useVentana(isOpen, onClose, { bloqueada: verificando })`; spread de propsVelo en el velo, más role="dialog", aria-modal y aria-labelledby; aria-label="Cerrar" en el botón X.
- **NuevoEventoModal:** `useVentana(isOpen, onClose, { bloqueada: guardando, cerrarAlTocarVelo: false })`, más spread y las mismas etiquetas aria.
- **LoteDetailModal:** `useVentana(isOpen, onClose)` en la ventana principal. La subventana (~l.716) lleva `{ bloqueada, cerrarAlTocarVelo: false }`. En las dos, aria-labelledby y aria-label="Cerrar".
- **App.tsx:** no requiere cambios para H30, solo verificarlo con sesión.

### Tanda 1: INTEGRIDAD-APP terminado

Cerrados: H02, H03 (QR con `&s=` sello), H04, H06, H07, H12 (parte de la app), H16, H17, H25, H27, H29, H34, H36, H37, H39, H40, H43, H66. Capturas en auditoria/capturas-fase3/.

No implementados (requieren campos nuevos o decisión): H14, H18, H19, H38, H41, H42. A2 sigue sin detectarse.

Pendientes para las tandas siguientes:
- **QrModal (H03):** usar `urlQrLote(lote)` y llamar a `descargarQrConEtiqueta(qr, lote.codigo, lote.estado === 'cerrado' ? lote.resumen?.hashFinal : null)`.
- **EntregasPanel (H67):** quitar el import de `registrarAccionEntrega`.
- **DashboardTab y LotesTab:** usar `derivarLote(lote, config)` para estanque, supervivencia y peso.
- **Bug de useVentana:** al abrir el detalle, el cuerpo aparece desplazado y la rueda del mouse dentro de la ventana la cierra. Revisarlo en la tanda 3.
- **Reglas:** confirmar que `enlaceLoteValido` acepte el `pdfUrl` con el origen de producción y de preview.
- **Vercel:** `VITE_ORIGEN_PUBLICO`, decisión del usuario.

## Fase 4: verificación en producción (2026-11-16)

Lote de prueba: `20261116-A-E1`, con proveedor `PRUEBA-auditoria` y `esPrueba: true`. Se creó con la app (sesión del usuario ya abierta), con una fase de Mortalidad de 50 y luego el cierre. Los ataques se hicieron con `tests/integridad/produccion-prueba.mjs` (credenciales de administración; se niega a tocar lotes que no sean de prueba). El respaldo está en `tests/integridad/.respaldo-20261116-A-E1.json`.

Resultados en producción:

| Prueba | Resultado |
| --- | --- |
| Tope de mortalidad (5000 en un lote de 1000) | Bloqueado con mensaje claro |
| Crear lote, registrar fase y cerrar con las reglas nuevas | Funciona |
| Línea base con QR con sello | "Cadena verificada al abrir. El sello impreso en el código QR coincide." |
| 7: cabecera (estanque E2, supervivencia 99.9) | Detectado y avisado |
| 4: dato de una fase (cantidad 50 a 5) | Detectado y avisado |
| 8: borrar la última fase (sin sello en el QR) | Detectado y avisado |
| QR con sello distinto (equivale a reescribir todo) | Detectado y avisado |
| Restaurar | Vuelve a "verificada" |
| `?lote=%25` | "El código del lote no es válido" |
| Panel del repartidor | Carga sin errores |

Otras comprobaciones:
- `npm audit --omit=dev`: 4 altas, todas en `@grpc/grpc-js`, que solo se usa en Node y no llega al navegador (H63, ya conocido).
- Capturas: carpeta `claude-chrome-screenshots-f3cVGY` en Temp.

Hecho:
- Revisor independiente: 6 problemas nuevos menores, 4 corregidos y desplegados (despliegues 3 y 4).
- Lote de prueba y contador diario borrados; no queda nada PRUEBA en producción.
- Reporte final actualizado.

## Segunda ronda: lotes y anotaciones (H20, H19, H45), en la rama sin desplegar

- **H20:** los registros nuevos guardan el uid en `registradoPor` (fases, anotaciones) y en `creadoPor` (lote), con el nombre visible aparte. El hash usa esos valores; los registros anteriores conservan el correo y su hash no cambia (la verificación usa lo guardado, sirve para los dos formatos). En lo interno, `FirmaRegistro` (PersonaUi) muestra el nombre y el correo leído de `usuarios/{uid}`; en lo público y el PDF, `quienRegistro` muestra el nombre, "Personal de la granja" si no hay nombre, y el correo enmascarado en los registros anteriores.
- **H19:** mapa `registradoEnServidor` en `lotes/{c}` y `anotacionesLote/{c}` (fuera del hash), una entrada por registro nuevo con `serverTimestamp()`. Reglas: `horaServidorValida` (la entrada nueva `== request.time`, las demás no cambian; si el documento ya tiene horas, el registro nuevo debe dejar la suya). `loteActivoCoherente`, `siembraCoherente` (corrección de siembra) y `camposLote` admiten el campo; `cierreValido` no lo admite (el cierre no lo toca).
- **H45:** sin cambios de regla: `registradoPorNombre` debe ser el `displayName` del perfil.
- **Compatibilidad:** las reglas aceptan lo que escribe la app publicada (correo, sin horas) en documentos sin horas del servidor. Tras publicar la web nueva, una pestaña con la versión anterior no podrá agregar registros a un lote o anotación que ya tenga horas del servidor.
- **Margen de expresiones** (relleno `1 == 1` en árbol balanceado, lote de 400 fases; antes / reglas nuevas con la app publicada / reglas nuevas con la app nueva): fase 90/84/83, corrección de siembra 49/44/42, cierre 73/73/73, creación 68/61/61, proponer anotación 89/84/82, aprobar anotación (100 registros) 83/77/75.
- **Pruebas:** reglas 170/170, seguridad 73/73, integridad 36/36 "detectado y avisado". Producción en solo lectura (`tests/integridad/verificar-lotes-prod.ts`): 20261031-A-E1 íntegro, sello coincide, 0 avisos; anotaciones íntegras (3 registros).
