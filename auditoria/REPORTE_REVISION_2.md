# Revisión 2: diseño y seguridad (2026-11-20)

Referencia del diseño aprobado: commit 6e636e8 (merge daafa04, PR #23). Detalle en `fase1-commits.md`, `revision2-diseno.md`, `revision2-seguridad.md` y `revision2-funcional.md`. Las capturas de antes están en `capturas-revision2/` (solo locales, no versionadas por tamaño).

Incluye además el testigo externo OpenTimestamps, H41 y H38 (commits e3f58a5, 1b442da y 99b993f). Por decisión del usuario, los lotes y comprobantes anteriores a la activación (2026-11-20) no se sellan después.

## Qué se dañó y por qué

La paleta, las fuentes y los tokens no cambiaron. Las pantallas estáticas son idénticas píxel a píxel a la referencia en 360, 390 y 1440 px. El daño está en el movimiento y en los elementos que agregó la auditoría. La CSP no bloquea nada: en producción no hubo violaciones.

| # | Prioridad | Daño | Causa | Arreglo | Estado |
|---|---|---|---|---|---|
| D1 | Alta | El cambio de pestaña perdió el fundido cruzado y ahora queda un instante vacío (unos 150 ms más) | `App.tsx` `AnimatePresence mode="wait"` (H58) | Volver a `popLayout` y conservar el scroll de H31 | Pendiente |
| D2 | Alta | La primera apertura del detalle del lote no responde durante unos 300 ms | Carga diferida con fallback vacío (`App.tsx:44`) | Precargar el import o usar el velo como fallback | Pendiente |
| D3 | Media | "Hora del servidor" en cada fase, evento y anotación: la vista pública crece un 18 % en celular | H19, en 7 componentes | Mostrar la línea solo cuando hay desfase o envío sin conexión; en el caso normal, `title` | Pendiente |
| D4 | Media | AvisoIntegridad y foto alterada con borde lateral grueso, fuera del estilo de alerta | `AvisoIntegridad.tsx`, `FotosEntregaOrden.tsx` | Caja completa `rounded-xl border-red-300 bg-red-50` | Pendiente |
| D5 | Media | Firma: el correo aparece entre el nombre y "Registró" | `PersonaUi.tsx:186` (H20) | Moverlo a `title`, sin tocar `correoDeFirma` | Pendiente |
| D6 | Baja | Aviso de función: 220 ms desde 16 px (DESIGN pide 300 ms desde abajo) | `App.tsx:812` | `y: '100%'` con `entrada()` | Pendiente |
| D7 | Baja | Tarjeta del sello de tiempo sin `shadow-xs`; doble punto en "Fecha de cámara" | `LoteDetailModal.tsx:442`, `FotosEntregaOrden.tsx:118` | Corregir | Pendiente |
| D8 | Baja | Rojo usado como advertencia en Configuración | `ConfiguracionTab.tsx:391` (H28) | Ámbar | Pendiente |
| D9 | Baja | Guion largo visible en correcciones de siembra (valor vacío dentro del hash) | `lotesService.ts:500` | Mostrar "sin dato" sin cambiar lo guardado | Pendiente |
| D10 | Baja (anterior a la auditoría) | La franja de función desborda a 360/390 px; "CONFIGURACIÓN" se corta a 1440 px | `Navbar.tsx` | Ajuste mínimo | Pendiente |

Se conservan, por ser mejoras de la auditoría: el `flex-wrap` del encabezado del detalle (antes la X quedaba fuera de pantalla), el cierre con Escape, la altura máxima de las ventanas y el QR de entrega sin la viñeta suelta.

## Seguridad: sigue bien (sin hallazgos críticos)

- Suites: reglas 192/192, seguridad 78/78 e integridad 47/47 "detectado y avisado".
- Ningún control se debilitó frente a main. `storage.rules` no cambió y `App.tsx` tampoco.
- Producción, con datos PRUEBA-: un byte del comprobante cambiado, una foto reemplazada y el hash editado. Las tres quedaron como detectado y avisado. Los datos se borraron.
- npm audit: solo H63 (grpc-js, del lado de Node). No hay secretos expuestos.

| # | Prioridad | Hallazgo | Arreglo | Estado |
|---|---|---|---|---|
| S1 | Baja | Cualquier usuario activo de la granja puede confirmar un sello con una prueba falsa, y después el aviso queda fijo | Limitar la confirmación al personal que puede crear el sello | Pendiente |

## Funcionamiento

- El recorrido como operador, administrador y repartidor funciona. Build, linter y tipos pasan.

| # | Prioridad | Hallazgo | Arreglo | Estado |
|---|---|---|---|---|
| F1 | Media | Errores de CORS en la consola al consultar un sello pendiente (los calendarios responden 404 sin la cabecera) | Espaciar los reintentos y no registrarlos como error | Pendiente |
| F2 | Baja | El repartidor ve "Entrega completa registrada" antes de que el servidor confirme | Mostrar el aviso después del commit | Pendiente |
