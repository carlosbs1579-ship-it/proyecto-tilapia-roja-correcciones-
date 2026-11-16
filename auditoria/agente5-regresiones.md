# Agente 5. Regresiones por diseño y animaciones

Fase de revisión: no se modificó ningún archivo de la app. Fecha: 2026-11-15.

## Cómo se revisó

- Lectura de código: `src/lib/presencia.ts`, `src/lib/montaje.ts`, `src/lib/motion.ts`, `src/styles/motion.css`, `src/index.css` (velo, aparece, aviso-inferior, `[data-saliendo]`, esqueletos), `src/App.tsx`, `Pestanas.tsx`, `Esqueleto.tsx`, `PersonaUi.tsx`, `PantallaIngreso.tsx`, `PantallaVerificando.tsx`, todas las ventanas con `usePresencia` y las pestañas con esqueleto.
- Navegador: Vite propio en el puerto 3001 con `VITE_EMULADORES=true` contra los emuladores del Agente 4 (8085/9099), cuenta de administrador de prueba del emulador. Medidas con scripts (MutationObserver, `elementFromPoint`, trazas de `scrollY` por cuadro). El ancho de 360 px se probó con un iframe de 360 x 640 (la ventana no se dejó redimensionar). No se borraron ni crearon datos.
- Compilación: `npx tsc --noEmit` sin errores. `npx vite build` (a una carpeta temporal, sin tocar `dist`) correcto, sin aviso de tamaño de paquetes. Los más grandes: `index.esm` 495,63 kB (queda a 4 kB del límite de 500 kB), `index` 481,36 kB, `jspdf` 399,70 kB, `AnaliticaTab` 389,83 kB, `motion` 135,01 kB. Único aviso: `__dirname` en `vite.config.ts:11` (ya existía).
- Consola del navegador limpia durante cambios de pestaña y ventanas.
- Movimiento reducido: Chrome no permite forzar `prefers-reduced-motion` desde la extensión; se razonó desde el CSS y el código (ver hallazgo 10).

## Resumen

| Severidad | Cantidad |
|---|---|
| Crítica | 0 |
| Alta | 1 |
| Media | 4 |
| Baja | 8 |

El más grave: en el celular (360 x 640) las hojas de Nuevo lote, QR e Integridad quedan recortadas y sus botones finales (Crear lote, Descargar certificado, Cerrar) no se pueden alcanzar.

---

## Hallazgos

### 1. ALTA. Hojas inferiores del celular recortadas: botones finales inalcanzables

- Archivos: `src/index.css:319-331` (`.velo > * { max-height: 92dvh }` en `max-width: 639px`) combinado con hijos `overflow-hidden` sin desplazamiento propio: `src/components/NuevoLoteModal.tsx:110`, `src/components/QrModal.tsx:66`, `src/components/IntegrityCheckModal.tsx:53`, `src/components/AuthModal.tsx:139`.
- Reproducción (360 x 640, comprobado en el navegador):
  - Inicio, "Registrar Nuevo Lote": la hoja mide 586 px pero su contenido 758 px; el botón "Crear lote" queda en y = 726 con una ventana de 637 px. El velo no desplaza (scrollHeight = clientHeight) y la hoja tiene `overflow: hidden`, así que ni el dedo ni la rueda llegan al botón.
  - Detalle del lote, "QR Etiqueta": contenido 689 px en 586 px; "Copiar URL" y "Descargar Certificado PDF" quedan bajo el borde (y = 716).
  - Detalle del lote, "Verificar Integridad": contenido 676 px en 586 px; el botón "Cerrar" del pie queda en y = 704.
- Impacto: un operador con teléfono pequeño no puede crear lotes ni descargar el certificado desde la hoja. Es regresión del diseño de hoja inferior (antes la ventana crecía y el velo con `overflow-y-auto` desplazaba).
- Arreglo propuesto: en el bloque móvil de `index.css`, junto a `max-height: 92dvh`, añadir `overflow-y: auto; overscroll-behavior: contain;` a `.velo > *`, o poner `overflow-y-auto` (en lugar de `overflow-hidden`) en los cuatro contenedores citados. En NuevoLoteModal quitar también `my-6` en móvil para que la hoja quede pegada al borde. No cambia la animación (sigue entrando con translateY 100%).

### 2. MEDIA. Al iniciar sesión la app se monta, se desmonta y se vuelve a montar; el fundido de salida del ingreso no ocurre

- Archivos: `src/lib/presencia.ts:28` (devuelve `saliendo: !abierto && saliendo`, que es falso en el primer render tras cerrar), `src/App.tsx:399` y `src/App.tsx:442-449`.
- Reproducción (medido con MutationObserver al pulsar "Ingresar"): a los 11146 ms aparece la barra de la app, a los 11165 ms desaparece y vuelve la pantalla de ingreso, a los 11368 ms aparece de nuevo la app.
- Causa: en el render en que `usuario` pasa a tener valor, `saliendo` todavía es falso (se activa en un efecto), así que App dibuja el panel; el efecto pone `saliendo` y se vuelve a dibujar la pantalla de ingreso, pero como es un elemento nuevo que nace con `opacity-0`, no hay transición de 1 a 0: se ve una pantalla en blanco unos 200 ms.
- Impacto: parpadeo al entrar; todos los hijos (Navbar, Dashboard, sus suscripciones) se montan y desmontan una vez de más; la salida animada que se diseñó no se ve.
- Arreglo propuesto: derivar `saliendo` del estado montado y no de un efecto: `return { montado: abierto || montado, saliendo: !abierto && montado }` (el temporizador ya pone `montado` en falso a los 180 ms). Así el primer render tras el ingreso ya sale con la clase `opacity-0` sobre el mismo elemento y la transición de 180 ms funciona. Beneficia también a las ventanas (hoy pasan un render sin `data-saliendo`).

### 3. MEDIA. La posición de scroll por pestaña no se restaura

- Archivo: `src/App.tsx:82-90`.
- Reproducción (escritorio y 360 px, medido por cuadro):
  - Inicio con scrollY = 183, pasar a Lotes: en el primer cuadro la altura del documento baja de 822 a 714 y el navegador recorta el scroll a 74 antes de que corra la limpieza del efecto, que es la que guarda la posición. Al volver a Inicio queda en 74 o en 0, no en 183.
  - 360 px: Entregas con scrollY = 700, ir a Inicio y volver: queda en 530 aunque al cargar los pedidos la página vuelve a medir 1463 px. La restauración se hace en un solo `requestAnimationFrame` mientras se ve el esqueleto (más bajo) y no se reintenta.
- Impacto: la función "scroll guardado por pestaña" de DISENO_PROGRESO no se cumple; el usuario vuelve a otro punto de la lista.
- Arreglo propuesto: guardar `window.scrollY` en el manejador del cambio de pestaña, antes de `setTabActiva` (una función `cambiarTab` que se pasa a Navbar), no en la limpieza del efecto. Para restaurar, reintentar mientras la altura no alcance (por ejemplo un ResizeObserver sobre `main` durante 1 s o hasta que el usuario haga scroll) o, si se prefiere simplicidad, abandonar la restauración y llevar siempre arriba.

### 4. MEDIA. Ventanas sin Escape, sin cierre al tocar fuera, sin manejo de foco ni bloqueo del scroll de fondo

- Archivos: todas las ventanas con `role="dialog" aria-modal="true"`: `AuthModal.tsx:138`, `QrModal.tsx:65`, `IntegrityCheckModal.tsx:52`, `NuevoLoteModal.tsx:109`, `NuevoEventoModal.tsx:252`, `NuevaOrdenModal.tsx:168`, `LoteDetailModal.tsx:250` y `:716`, `EntregasPanel.tsx:323`.
- Reproducción (comprobado en Detalle del lote): Escape no cierra; clic en el velo no cierra; `document.activeElement` sigue siendo `BODY` al abrir (el foco no entra a la ventana, Tab recorre la página de atrás) y al cerrar no vuelve al botón que la abrió; `body` mantiene `overflow: visible`. En los velos sin `overflow-y-auto` (QR, Integridad, Nueva orden, Auth) la rueda desplaza la página de fondo.
- Impacto: accesibilidad de teclado y lector de pantalla (aria-modal promete un foco atrapado); en el teléfono la página de atrás se mueve al arrastrar. No es regresión directa de la animación, pero el rediseño de ventanas no lo incluyó.
- Arreglo propuesto: un hook `useVentana(abierta, onCerrar, { bloqueada })` junto a `usePresencia` que: escuche Escape; cierre con clic cuando `e.target === e.currentTarget` en el velo (salvo mientras se guarda); enfoque el primer control al abrir y devuelva el foco al cerrar; atrape Tab dentro; ponga `overflow: hidden` en `body` mientras `montado && !saliendo`. Mantiene las mismas clases `.velo` y `data-saliendo`.

### 5. MEDIA. Carga diferida sin ErrorBoundary: pantalla en blanco si falla un paquete

- Archivos: `src/App.tsx:5` (PantallaIngreso ahora es `lazy`), `src/App.tsx:30-37` y `:445`, `:559`. No hay ningún ErrorBoundary ni manejo de `vite:preloadError` en `src/`.
- Reproducción (por código): con la pestaña abierta durante un despliegue nuevo (cambian los nombres con hash) o con red intermitente, el `import()` falla, Suspense propaga el error y React desmonta todo: página en blanco sin mensaje. Ahora afecta también a la pantalla de ingreso, que antes estaba en el paquete principal.
- Impacto: una persona sin sesión puede quedarse sin poder ingresar hasta recargar a mano.
- Arreglo propuesto: un ErrorBoundary alrededor de cada `Suspense` con un mensaje y botón "Recargar" (paleta slate y ámbar actual) y `window.addEventListener('vite:preloadError', () => location.reload())` una sola vez (guardar un indicador en sessionStorage para no entrar en bucle).

### 6. BAJA. Botones de cerrar solo con ícono y sin nombre accesible

- Archivos: `LoteDetailModal.tsx:313`, `QrModal.tsx:74`, `IntegrityCheckModal.tsx:61`, `NuevaOrdenModal.tsx:177` (NuevoLoteModal sí tiene `title`).
- Reproducción: en el navegador, el botón X de Detalle del lote y de QR no tiene texto, `aria-label` ni `title`.
- Arreglo: `aria-label="Cerrar"` en cada uno.

### 7. BAJA. Menú de tres puntos clicable durante su salida y abierto fuera de la pantalla

- Archivo: `src/components/PersonaUi.tsx:110-136`.
- Reproducción (360 px, Personal): 40 ms después de Escape el menú sigue con opacidad 0,96 y `pointer-events: auto`, así que un segundo toque rápido sobre "Desactivar cuenta" o "Eliminar persona" ejecuta la acción de nuevo (en un interruptor de estado eso la revierte). En la última fila el menú se abre de y = 641 a 826 con una ventana de 637 px.
- Arreglo: en el `motion.div` del menú, `style={{ transformOrigin: 'top right', pointerEvents: abierto ? 'auto' : 'none' }}` o añadir `pointerEvents: 'none'` a la variante `salida` de `varMenu`; abrir hacia arriba (`bottom-full mb-1`, origen abajo a la derecha) cuando no haya espacio debajo.

### 8. BAJA. Cambio rápido de pestañas: hasta 6 `<main>` montados a la vez

- Archivo: `src/App.tsx:549-556`.
- Reproducción: nueve cambios de pestaña con 30 ms entre clics llegan a 6 elementos `main` simultáneos; cada uno monta su contenido completo (Pedidos abre 4 suscripciones a Firestore). A los 1,5 s queda uno solo y la pestaña marcada coincide. No se encontró bloqueo de clics: el `main` que sale queda detrás del nuevo (`elementFromPoint` devuelve el nuevo).
- Impacto: lecturas extra de Firestore y trabajo de CPU en teléfonos lentos.
- Arreglo: aceptable; si se quiere reducir, acortar la salida (ya es de 150 ms) o renderizar en el `main` que sale una copia sin suscripciones. Solo documentar.

### 9. BAJA. El esqueleto oculta los lotes guardados en el navegador

- Archivos: `src/App.tsx:117-124` (lotes iniciales desde `cultivos_lore_lotes_backup`) y `:584`, `:603`, `:621` (`lotesCargando ? <EsqueletoPantalla />`).
- Impacto: aunque haya copia local, se ve el esqueleto hasta la primera respuesta de Firestore (sin red puede tardar varios segundos).
- Arreglo: `lotesCargando && lotes.length === 0 ? <EsqueletoPantalla /> : ...`.

### 10. BAJA. Movimiento reducido: dos detalles

- `src/styles/motion.css:35-45`: el bloque `prefers-reduced-motion` no reduce `--mov-interruptor` (200 ms); el círculo del interruptor sigue deslizándose con transform. `--mov-velo` tampoco se reduce, pero es solo opacidad (aceptable).
- `src/index.css:427-432`: con reducido se detiene `.animate-spin`; los indicadores de carga en botones ("Creando lote...", "Calculando SHA-256...") quedan como un círculo quieto. Tienen texto, así que no se pierde la información; se podría cambiar por un pulso de opacidad lento.
- Verificado por código: `MotionConfig reducedMotion="user"` en `src/main.tsx:8` quita los desplazamientos de motion y deja los fundidos; `Pestanas` usa `duration: 0` y `scrollIntoView` sin suavizado; PantallaIngreso omite el temblor y el escalonado; las salidas de ventanas y la presencia se basan en temporizadores (`presencia.ts`), no en `transitionend` ni `onAnimationComplete`, así que un corte de la animación no deja estado colgado. No se encontró ningún `onAnimationComplete`, `onExitComplete` ni `transitionend` en `src/`.
- Arreglo: añadir `--mov-interruptor: var(--mov-reducido);` al bloque reducido.

### 11. BAJA. Aviso de función tapa la esquina inferior y se va de golpe

- Archivo: `src/App.tsx:485-493`.
- Impacto: durante 4 s queda encima de los botones de la esquina inferior izquierda en el celular (recibe los toques) y desaparece sin salida, a diferencia del aviso de Personal.
- Arreglo: `pointer-events-none` en el aviso y envolverlo en `AnimatePresence` con la misma salida del aviso de Personal (opacidad y 8 px hacia abajo, 180 ms).

### 12. BAJA. Mensajes de éxito con temporizadores sin limpiar

- Archivos: `ConfiguracionTab.tsx:97` y `:182`, `LoteDetailModal.tsx:171`, `:208`, `:222`, `:693`.
- Impacto: si se guarda dos veces en menos de 4 s, el temporizador del primer guardado borra antes de tiempo el mensaje del segundo. No se acumulan avisos (Personal y Pedidos sí limpian su temporizador).
- Arreglo: guardar el temporizador en un `useRef` y limpiarlo antes de crear otro, como en `UsuariosTab.tsx:127-130`.

### 13. BAJA. Nuevo lote: cerrar durante el guardado permite enviar otra vez

- Archivo: `src/components/NuevoLoteModal.tsx:118-123` y `:276-281` (Cerrar y Cancelar hacen `setCargando(false)` y no están deshabilitados mientras se guarda).
- Reproducción (por código): pulsar "Crear lote", cerrar la ventana mientras se escribe en Firestore y volver a abrirla: el botón está habilitado y se puede crear un segundo lote igual.
- Arreglo: no reiniciar `cargando` al cerrar y deshabilitar Cerrar y Cancelar mientras `cargando`, como ya hace `NuevoEventoModal.tsx:263-264` y `:936-937`.

---

## Comprobado sin problemas

- Las ventanas en salida no tapan clics: `.velo[data-saliendo]` tiene `pointer-events: none` (medido a los 40 ms de cerrar Detalle del lote) y el botón "Detalle" de atrás recibe el clic.
- Reabrir una ventana durante su salida funciona: queda abierta, opacidad 1, sin `data-saliendo`; `useConservar` mantiene el lote mientras se desvanece.
- Doble envío: los botones de guardar se deshabilitan mientras se envía en Nuevo lote, Nuevo evento, Nueva orden, Editar siembra, Personal y la pantalla de ingreso (excepción en el hallazgo 13).
- Esqueletos: todas las rutas de error y de permiso denegado ponen la carga en falso (App, Pedidos, Repartidor, Entregas, Personal, consultas públicas); Personal sin permiso no muestra la lista; ningún esqueleto quedó fijo en las pruebas.
- 360 px: Inicio, Lotes, Entregas, Analítica, Configuración y Personal sin desborde horizontal (`scrollWidth` igual al ancho); la franja de pestañas desliza.
- El `main` que sale con `popLayout` no captura clics y la transformación final queda en `none` (no rompe elementos `fixed` internos después de la animación).
- `Pestanas`: no se observaron saltos de scroll al montarse (la franja de filtros de Entregas y la del detalle del lote estaban a la vista).
- Consola sin errores ni avisos de motion o React.
