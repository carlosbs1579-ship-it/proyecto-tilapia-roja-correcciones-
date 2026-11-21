# Revisión 2 · Diseño tras la auditoría de seguridad

Fecha: 2026-11-20. Rama `correciones-claude`, HEAD `99b993f`. Referencia aprobada: `6e636e8` (equivale a `daafa04`, PR #23).
Solo revisión: no se cambió código del repositorio.

## Cómo se comparó

- Referencia en un worktree temporal de `6e636e8` (puerto 3001) y versión actual (puerto 3002), las dos con `VITE_EMULADORES=true`.
- Emuladores propios: Firestore 8385, Auth 9299 (hub 4685, logging 4785), con `firestore.rules` actual. Los puertos 8085/9099 que trae `firebaseConfig.ts` se redirigieron solo en el servidor de la revisión con un plugin de Vite fuera del repositorio (y `experimentalForceLongPolling`). Nunca se tocó producción.
- Datos: `tests/integridad/ataques.ts` empaquetado en el scratchpad (lote cerrado `20260801-A-E1` con anotación aprobada, lote activo `20260801-A-E2`, orden `PED-20261120-2FLH8` con foto, comprobante anulado y token público). La corrida restaura todo, así que los datos quedan íntegros.
- Navegador: la extensión Claude in Chrome no estaba conectada (`list_connected_browsers` vacío). Se usó un Chrome headless propio (CDP en 9333, perfil en el scratchpad) con un controlador mínimo: capturas, muestreo de animaciones cuadro a cuadro y comparación píxel a píxel.
- Capturas: `auditoria/capturas-revision2/antes-<pantalla>-<ancho>-{ref,actual}.png` (117 archivos) y `csp-*.png` de producción.
- Skills usadas para evaluar (sin rediseñar): impeccable (auditoría contra DESIGN.md y el brief `.impeccable/surfaces/src-app-tsx.md`, detector sobre los componentes nuevos), emil-design-eng (estados y transiciones), improve-animations (solo diagnóstico) y mobile-native (360/390 px).

Nota sobre los avisos rojos del sello de tiempo en las capturas: los calendarios de OpenTimestamps de la prueba son simulados y la verificación contra blockstream.info real los marca como "Posible alteración detectada (sello de tiempo)". En producción, con pruebas reales, no aparecerían. Sirven para ver el estilo del aviso.

## Resultado general

Píxel a píxel **idénticas** entre referencia y actual (0 píxeles distintos) a 360, 390 y 1440 px:
ingreso (operador; el de repartidor usa el mismo componente, `PantallaIngreso.tsx` no cambió), Inicio, Lotes, Entregas (lista), Analítica con el Comparativo de estanques, Configuración (Estanques y piscinas), Personal y permisos, Mis entregas del repartidor y el detalle de su orden.

**Cambian**: detalle de lote, vista pública del QR del lote y de la entrega, detalle de la orden del operador, confirmación de eliminar estanque, cambio de pestaña, primera apertura del detalle del lote y el aviso de función. Paleta, tipografía (Libre Caslon y Public Sans cargan en producción) y tokens de `@theme` / `motion.css` siguen intactos: la única línea nueva en `motion.css` (`--mov-interruptor` reducido) es correcta.

## Diferencias, ordenadas por prioridad

### 1. Cambio de pestaña: ya no es un fundido cruzado (alta, animación)
- Pantalla: todas las pestañas.
- Medido: referencia, la pestaña nueva entra mientras la vieja sale y queda lista en unos 250 ms. Actual, primero sale la vieja (0 a 150 ms), hay un instante vacío y la nueva entra de 170 a 400 ms: la navegación se siente 150 ms más lenta y parpadea.
- Causa: `src/App.tsx:614` `<AnimatePresence mode="wait">` (antes `mode="popLayout"`), cambio de H58.
- Arreglo: volver a `mode="popLayout"`. H58 se cerró como "aceptable; documentar o acortar la salida", y la salida ya dura 150 ms. La restauración de scroll de H31 busca `main[data-tab="${tabActiva}"]`, así que sigue funcionando con dos `main` durante el cruce. Si se quiere limitar H58, se puede añadir `pointer-events: none` al `main` que sale (variante `sale` en `src/lib/motion.ts:66`) sin cambiar los tiempos.
- Seguridad: no.

### 2. Primera apertura del detalle del lote: unos 300 ms sin respuesta (alta, animación y percepción)
- Medido: en la referencia, el velo y la ventana empiezan a animar al instante. En la actual no aparece nada durante unos 300 ms (descarga del paquete) y después anima.
- Causa: `src/App.tsx:44` `lazy(() => import('./components/LoteDetailModal'))` con `<Suspense fallback={null}>` (`App.tsx` cerca de la línea 767).
- Arreglo: conservar la carga diferida (mantiene el paquete inicial bajo 500 kB) y precargarla: `useEffect(() => { if (lotes.length) { const id = requestIdleCallback?.(() => import('./components/LoteDetailModal')) } }, [lotes.length])`, o hacer `import()` en `onPointerEnter`/`onFocus` de las filas y botones "Abrir". Otra opción es un fallback con el velo (`<div className="velo fixed inset-0 bg-slate-950/55" />`) para que el toque responda al instante.
- Seguridad: no.

### 3. Aviso de función abajo a la izquierda: tiempo y recorrido distintos a DESIGN (media, animación)
- DESIGN.md (Movimiento): "el aviso inferior entra desde abajo en 300 ms". La referencia usaba `.aviso-inferior` (`--mov-entrada` 320 ms, `translateY(100%)`). La actual entra en 220 ms desde 16 px.
- Causa: `src/App.tsx:812-813` `initial={{ opacity: 0, y: DISTANCIA.pantalla }}` y `entrada(DURACION.base)`.
- Arreglo: `initial={{ opacity: 0, y: '100%' }}` y `animate={{ opacity: 1, y: 0, transition: entrada() }}` (0,32 s). La salida (`salida()`, 180 ms) y que esté fuera del contenedor animado se mantienen: son correctas. Con movimiento reducido, `MotionConfig reducedMotion="user"` (`src/main.tsx:8`) ya quita el desplazamiento.
- Seguridad: no.

### 4. Avisos nuevos de integridad con "pestaña lateral" en vez del estilo de alerta existente (media, estilo)
- Componentes: `AvisoIntegridad` ("Posible alteración detectada", "No se puede verificar"), también usado por `SelloTiempoInfo` y por la foto alterada.
- Causa: `src/components/AvisoIntegridad.tsx:19-21` (`rounded-md border border-l-2 ... border-l-red-600`) y `src/components/FotosEntregaOrden.tsx:85-86` (`border-l-2 border-l-red-600`). El detector de impeccable lo marca como `side-tab`. La referencia marca la alteración con caja completa: `bg-red-50 border border-red-300 rounded-xl text-red-900` (resultado de integridad en `PublicTraceabilityView` e `IntegrityCheckModal`) o `ring-1 ring-inset ring-red-300` en la fase alterada.
- Arreglo: en `AvisoIntegridad` usar `rounded-xl border p-4 text-xs` con `bg-red-50 border-red-300 text-red-900` si está alterado y `bg-slate-50 border-slate-300 text-slate-800` si no se puede verificar; quitar `border-l-2`/`border-l-*`. En la foto alterada, `ring-1 ring-inset ring-red-300 bg-red-50`. Título, lista, nota, `role="alert"` y `fila-escalonada` se quedan igual.
- Seguridad: solo presentación. No toca la verificación (`revisarLote`, `revisarFoto` ni hashes).

### 5. Firma: el correo se mete entre el nombre y el cargo (media, firma de acta)
- Pantalla: detalle del lote (columna de firma de cada fase) y anotaciones.
- DESIGN: nombre en Public Sans 600 sobre el filete y, debajo, el cargo en versalitas ("Registró"). Ahora queda nombre, correo y después "Registró". En las anotaciones, el bloque del correo rompe la línea "PROPUSO nombre fecha".
- Causa: `src/components/PersonaUi.tsx:186` (`<span className="block text-xs ...">{correo}</span>` dentro de `FirmaRegistro`), usado en `LoteDetailModal.tsx:760` y `AnotacionesLotePanel.tsx:243,249`.
- Arreglo: llevar el correo a `title={correo}` sobre `.firma` (o mostrarlo después del rótulo "Registró" en la columna de la fase) y no mostrarlo como bloque entre nombre y cargo. Si el registro no tiene nombre, conservar el comportamiento actual: el correo hace de nombre.
- Seguridad: está relacionado con H20/H45 (firma por uid y correo resuelto solo con sesión). Se conserva la resolución `correoDeFirma`; solo cambia dónde se pinta. Las pantallas públicas siguen con "Personal de la granja".

### 6. Líneas "Hora del servidor" en cada fase, anotación y evento (media, densidad)
- Pantallas: detalle del lote (`LoteDetailModal.tsx:750`), anotaciones (`AnotacionesLotePanel.tsx:259`), QR público (`PublicTraceabilityView.tsx:660, 718`), seguimiento de la orden (`DetalleOrdenOperador.tsx:381`), documentación (`DocumentacionEntrega.tsx:310`) y QR de entrega (`ConsultaEntregaPublica.tsx:264`).
- Efecto: una o dos líneas grises más por registro. En la vista pública a 390 px la página pasa de 3275 a 3858 px y en la orden del operador de 3625 a 4253 px. El historial ya no se lee como acta.
- Arreglo propuesto: cuando coincide (sin desfase), mostrar la hora del servidor solo como `title` en la fecha, o como sufijo corto en la misma línea de la firma ("· servidor 06:37 p. m."). La línea completa en `text-amber-800` se deja solo cuando hay desfase de más de 10 minutos o un envío sin conexión. Conviene un componente común `HoraServidor` para no repetir seis variantes.
- Seguridad: H19. Hay que conservar el dato y el aviso de desfase, que es lo que aporta seguridad. Solo se compacta el caso normal. Es un arreglo delicado porque toca seis archivos.

### 7. Tarjeta "Sello de tiempo en Bitcoin" sin la sombra de sus vecinas (baja, estilo)
- Causa: `src/components/LoteDetailModal.tsx:442` `bg-white p-4 rounded-xl border border-slate-200 space-y-1`. La barra de acciones y los indicadores llevan `shadow-xs`.
- Arreglo: añadir `shadow-xs`. El bloque nuevo sí respeta el orden: va después de "Lote sellado" y no mueve los bloques existentes.
- Seguridad: no.

### 8. "Fecha de cámara: … p. m.." con doble punto (baja, texto)
- Causa: `src/components/FotosEntregaOrden.tsx:118` `Fecha de cámara: {fecha}.`. La fecha ya termina en "p. m.".
- Arreglo: quitar el punto final (`Fecha de cámara: {fecha}`).
- Seguridad: no (H38 solo en presentación).

### 9. Rojo usado como advertencia al eliminar un estanque con lotes cerrados (baja, color)
- Causa: `src/components/ConfiguracionTab.tsx:391` `text-red-800` en "1 lote cerrado lo registra…". Aquí no hay error ni alteración, y la regla de DESIGN es "un color, un significado".
- Arreglo: `text-amber-800`, como las demás advertencias (supervivencia < 85 %). Se deja el rojo de la línea 386 ("No se puede eliminar", que sí bloquea). La caja de confirmación conserva el estilo de la referencia.
- Seguridad: H28. La lógica de bloqueo no se toca.

## Cambios que mejoran y se deben conservar
- Cabecera del detalle del lote en celular: la referencia se desbordaba a 390 px y la X de cerrar quedaba fuera de pantalla. `LoteDetailModal.tsx:331` `flex flex-wrap gap-2` lo corrige; los botones pasan a dos filas.
- Ventanas: cierre con Escape y fundido de salida de 200 ms (la referencia no cerraba con Escape). `index.css` `.velo > *` con altura máxima y desplazamiento propio, y en celular sin márgenes verticales (hoja inferior correcta).
- QR de entrega: la viñeta suelta de la anulación (un `li` fuera de `ul`) ya no aparece.
- `LimiteError`: sigue el estilo de `accesoRestringido` (`rounded-xl border shadow-xs`, botón azul de acción).
- Reducción de movimiento: el spinner late con opacidad en vez de girar (`index.css`), y `--mov-interruptor` también se reduce.

## Observaciones que no son regresión (iguales en las dos versiones)
- A 360 y 390 px, con una cuenta de tres funciones, la franja "Función: Administrador · Operador · Repartidor" del `Navbar` ensancha la página a 391 px y hay desplazamiento horizontal. A 1440 px, con el selector de función, la pestaña "CONFIGURACIÓN" queda cortada. No lo causó la auditoría, pero conviene revisarlo aparte (`src/components/Navbar.tsx`).
- Imagen rota de la foto de entrega con los datos sintéticos de la prueba, en las dos versiones.

## Guion largo (—) en texto visible
- `src/services/lotesService.ts:500`: en "Corrección de datos de siembra/piscina", un valor vacío se guarda como `'—'` ("— → 5"). Se ve en el detalle, en el QR y en el PDF. Ese texto entra en el hash de la fase, así que **no se debe cambiar en los registros existentes**. Opciones: (a) en registros nuevos, usar `'sin dato'` (cambia solo la carga útil de fases futuras y la verificación sigue recalculando lo guardado); (b) mejor, reemplazar `—` por "sin dato" solo al mostrar (`nombreDato`/presentación en `LoteDetailModal`, `PublicTraceabilityView` y `pdfService`) y dejar intacto el dato hasheado.
- `EMPRESA = 'Cultivos Loré — Tilapia Pro'` (`comprobantesService.ts:32`) va dentro del comprobante hasheado, pero se muestra con " · " (`ConsultaEntregaPublica.tsx:84` y pie del PDF `pdfService.ts:987`). No se ve en pantalla. No hay que cambiarlo.
- No hay otros guiones largos en el texto visible de `src/components`.

## CSP (vercel.json)
- Producción `https://proyecto-tilapia-roja-correcciones.vercel.app` (`curl -sI` y Chrome, sin iniciar sesión): no hay ninguna violación (`securitypolicyviolation` vacío y sin mensajes en la consola). Libre Caslon Text (400/700) y Public Sans (400/500/600) se cargan desde Google Fonts y la hoja de fonts.googleapis.com aparece en `document.styleSheets`.
- `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` permite los `style=` de React y Motion. `font-src` incluye fonts.gstatic.com y data:. `img-src 'self' data: blob: https:` cubre los QR (data:), las fotos (data:) y Firebase. `worker-src blob:` está presente. El PDF se abre navegando a una URL `blob:` en una pestaña nueva, sin iframe, así que no depende de `frame-src`.
- Diferencia esperada: la CSP publicada en producción y en la vista previa todavía no trae los calendarios de OpenTimestamps ni blockstream.info. La de HEAD sí, y coinciden con `src/lib/ots.ts`. Al desplegar HEAD, la CSP llega con el `vercel.json` nuevo.
- Conclusión: la CSP **no causa** ningún daño visual.

## Reparto sugerido (sin dos agentes en el mismo archivo)

| Grupo | Archivos | Puntos | Modelo |
|---|---|---|---|
| A | `src/App.tsx` (+ `src/lib/motion.ts` si se añade `pointer-events` a la salida) | 1, 2, 3 | opus (pestañas, scroll de H31 y carga diferida) |
| B | `src/components/AvisoIntegridad.tsx`, `src/components/FotosEntregaOrden.tsx` | 4, 8 | sonnet |
| C | `src/components/PersonaUi.tsx` | 5 | sonnet (no tocar `correoDeFirma`) |
| D | `LoteDetailModal.tsx`, `AnotacionesLotePanel.tsx`, `PublicTraceabilityView.tsx`, `DetalleOrdenOperador.tsx`, `DocumentacionEntrega.tsx`, `ConsultaEntregaPublica.tsx` (+ componente nuevo `HoraServidor.tsx`) | 6, 7 y guion largo (b) en las vistas | opus (H19, seis archivos) |
| E | `src/components/ConfiguracionTab.tsx` | 9 | sonnet |
| F | `src/services/pdfService.ts` | guion largo (b) en el PDF | sonnet, después de D |
