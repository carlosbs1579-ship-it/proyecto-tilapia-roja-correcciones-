# Agente 4: bugs funcionales (navegador contra emuladores)

Fecha: 2026-11-15, noche. Solo revisión: no se cambió ningún archivo de la app.

## Montaje

- Emuladores Auth 9099 y Firestore 8085 con `scratchpad/emu-app/firebase.json`. Las reglas del emulador son idénticas a `firestore.rules` del repo (mismo SHA-256).
- Datos: `sembrar-cuentas.mjs`, `anot-seed.mjs` y una copia de `orden-seed.mjs` (`orden-seed-a4.mjs`) con los UID reales de esta corrida. El original trae UID fijos de otra sesión y la orden quedaba asignada a un repartidor inexistente.
- App: `VITE_EMULADORES=true npx vite --port 3000`.
- Navegador: Chrome con una pestaña propia. La ventana no aceptó `resize_window` (se quedó en 1536x639), así que 360 y 390 px se probaron con iframes del mismo origen.
- Datos creados durante la prueba:
  - lote `20261110-A-E1`, con proveedor `PRUEBA-agente4`;
  - orden `PED-20261115-CW23G`, con observación `PRUEBA-agente4 orden`;
  - entrega parcial con foto;
  - comprobante N.º 1;
  - una novedad en `PED-20261114-TEST1`;
  - anotación N.º 1, pendiente, sobre el lote `20261110-A-E1`.

## Resumen

| Severidad | Cantidad |
| --- | --- |
| Crítica | 0 |
| Alta | 3 |
| Media | 6 |
| Baja | 7 |

El más grave es el 1: la fase Mortalidad acepta cualquier cantidad (999 999 peces en un lote de 5 000) y la Cosecha acepta peces que no existen. Esos datos quedan sellados para siempre en la cadena y en el certificado público.

## Lo que funcionó bien

- **Ingreso:**
  - contraseña errada: "Correo o contraseña incorrectos.";
  - función que la cuenta no tiene: aviso claro y entra con la función real;
  - la sesión persiste al recargar;
  - cerrar sesión limpia la copia de lotes y la de "mis entregas".
- **Lote:**
  - no acepta cantidad negativa ni fecha de siembra futura (validación nativa);
  - el código lo genera el sistema, así que no se puede usar el prefijo PRUEBA- en el código; se puso en el proveedor.
- **Lote, PDF, QR e integridad:**
  - cierre, PDF del lote, etiqueta QR en PNG y verificación de integridad funcionan;
  - en la vista pública, `?lote=NOEXISTE` y `?entrega=tokenfalso` dan mensajes correctos.
- **Orden:**
  - creación con reparto mayor que el disponible: se marca en rojo y no se guarda;
  - el comprobante definitivo no se duplica: el botón queda deshabilitado aunque se pulse dos veces;
  - la consulta pública del comprobante verifica bien la cadena.
- **Foto de entrega:**
  - .txt rechazado ("El archivo no es una imagen.");
  - HEIC falso rechazado ("No se pudo leer la imagen");
  - JPEG de 27,4 MB (6000x4500) comprimido a 108 KB en unos 3 s;
  - SVG aceptado y convertido a JPEG (sin riesgo).
- **Entrega parcial y novedad:** funcionan; la novedad vacía se bloquea.
- **Permisos:** el operador sin permiso no puede guardar la configuración; las reglas lo frenan y aparece el mensaje.
- **Listeners:** al cerrar sesión se terminan los canales Listen y Write. Solo se reabre el de `configuracion/general`, que es de lectura pública y lo usa la vista pública. Todos los `onSnapshot` de los componentes devuelven su función de limpieza. No hubo errores en consola durante la prueba.

## Hallazgos

### 1. Alta. Mortalidad y cosecha sin tope: datos imposibles quedan sellados para siempre

- **Archivo:** `src/components/NuevoEventoModal.tsx:173-178` (mortalidad) y `:190-198` (cosecha). Solo exigen un valor de 1 o más; no hay `max`. `lotesService.registrarEventoEnLote` tampoco lo comprueba y las reglas aceptan el evento.
- **Pasos:**
  1. Como operador, crea un lote con 5 000 alevinos.
  2. Registrar fase, Mortalidad, cantidad 999 999: se guarda.
  3. Registrar fase, Cosecha, 1 000 peces con 0 vivos: se guarda.
  4. Cerrar lote: queda "Sellado · Cosechado".
- **Resultado en Firestore:** `mortalidadAcumulada: 999999`, `pecesCosechados: 1000`, `cantidadSembrada: 5000`.
- **Impacto:**
  - el certificado público y el PDF muestran "Cantidad: 999999", supervivencia de 0 % y "Cadena íntegra";
  - la orden de entrega ofrece 480 kg "disponibles" de ese lote;
  - por diseño no se puede borrar; solo cabe una anotación;
  - un error de tipeo (999 en lugar de 99) arruina el lote para siempre.
- **Arreglo:**
  - en el modal, `max={r.pecesVivos}` y comprobar que mortalidad + cosecha no superen los vivos;
  - repetir la comprobación en `registrarEventoEnLote`, dentro de la transacción;
  - si se puede, en las reglas: `resumen.pecesVivos >= 0` y `mortalidadAcumulada + pecesCosechados <= cantidadSembrada`.
- **Capturas:** `auditoria/capturas-agente4/02-mortalidad-mayor-que-vivos.jpg`, `03-cosecha-con-cero-vivos.jpg`.

### 2. Alta. Se aceptan fases con fecha anterior a la siembra

- **Archivo:** `src/components/NuevoEventoModal.tsx:140` (solo compara con `hoy`) y `:331` (`max={hoy}` sin `min`).
- **Pasos:** en un lote sembrado el 2026-11-10, registra "Calidad del agua" con fecha 2026-11-01. Se guarda como fase #1.
- **Impacto:**
  - la línea de tiempo pública dice "fases registradas cronológicamente", pero muestra una medición 9 días antes de la siembra;
  - queda sellada en la cadena;
  - también se puede registrar una fase con fecha anterior a la fase previa.
- **Arreglo:**
  - `min={lote.fechaSiembra}` en el input;
  - en `handleSubmit`, `if (fechaEvento < lote.fechaSiembra) error`;
  - opcional: no aceptar una fecha anterior a la última fase sin un motivo.
- **Captura:** `01-fase-antes-de-siembra.jpg`.

### 3. Alta. Doble toque en "Iniciar ruta" deja una acción en conflicto

El mismo patrón aplica a "Registrar llegada".

- **Archivo:** `src/components/DetalleEntregaRepartidor.tsx:410-421` (el botón no se deshabilita tras el primer toque) y `src/services/repartoService.ts:181-205` (`registrarAccion` no evita duplicados del mismo tipo pendiente).
- **Pasos:**
  1. Como repartidor, abre la orden.
  2. Toca dos veces "Iniciar ruta" (con `click()` doble, igual que un doble toque en el teléfono).
- **Resultado:**
  - la bandeja guarda dos "Inicio de ruta";
  - la segunda queda en "guardada" porque `procesando` estaba activo;
  - a los 30 s se envía y queda en "No se aplicó: La orden está "En ruta"; ya no se puede iniciar la ruta.";
  - el repartidor ve un error rojo sin haber hecho nada mal.
- **Impacto:**
  - confunde al repartidor, que es el usuario menos técnico;
  - con mala señal, los toques repetidos son lo normal;
  - "Confirmar entrega" sí está protegida por `entregaEnviada`, pero también conviene revisarla.
- **Arreglo:**
  - en `registrarAccion`, si ya hay una acción del mismo `tipo` y `ordenId` en "guardada" o "enviando" (para Inicio de ruta, Llegada o Entrega), devolver esa y no crear otra;
  - en el botón, deshabilitarlo de inmediato con un estado local.
- **Captura:** `09-doble-toque-iniciar-ruta-conflicto.jpg`.

### 4. Media. La anotación acepta texto en un dato numérico

- **Archivo:** `src/components/AnotacionesLotePanel.tsx:154-162` (`type="text"` para todos los datos) y `:51-53` (solo valida que no esté vacío ni sea igual al registrado). `anotacionesService.ts:148` guarda `valorCorrecto` sin validar el tipo.
- **Pasos:** en un lote sellado, Proponer anotación, fase Mortalidad, dato Cantidad, valor "abc". Se crea la anotación N.º 1: "registrado 999999 · correcto abc".
- **Impacto:**
  - una vez aprobada por otra persona, el certificado mostraría "abc" como valor correcto;
  - la cadena de anotaciones es inmutable.
- **Arreglo:** si `typeof faseSel.datos[dato] === 'number'`, usar `type="number"` y exigir `Number.isFinite(Number(valor))`, también en el servicio.
- **Captura:** `10-anotacion-valor-abc-en-cantidad.jpg`.

### 5. Media. El administrador ve "Tu cuenta no tiene una función de producción" mientras se sincroniza su perfil

- **Archivo:**
  - `src/App.tsx:271-273`: `setPerfilUsuario` solo después de `sincronizarPerfilUsuario`;
  - `src/services/usuariosService.ts:355-363`: para el administrador maestro se espera el `setDoc` de confirmación en el servidor en cada ingreso;
  - `src/App.tsx:578`: muestra `accesoRestringido` cuando `funcionActiva` es null.
- **Pasos:** ingresa o recarga como `carlosbs1579@gmail.com`. Durante 3 a 30 s aparece "Información productiva restringida. Tu cuenta no tiene una función de producción autorizada..." y luego la vista normal.
- **Duración:**
  - 1 s sin otras pestañas;
  - más de 20 s con varias pestañas abiertas contra el emulador, por el límite de conexiones HTTP/1.1 del canal del emulador; los REST del emulador responden en 10 ms;
  - en producción dependerá de la red.
- **Impacto:**
  - en la granja, con señal débil, el dueño ve un mensaje falso de que no tiene permisos;
  - si la conexión cae entre el `getDoc` y el `setDoc`, el `setDoc` queda pendiente sin fin y no se usa la copia local.
- **Arreglo:**
  - mostrar el perfil leído (`setPerfilUsuario(perfil)`) antes de escribir y hacer el `setDoc` sin `await` (o solo si cambió algo);
  - mientras `usuario && !perfilUsuario`, mostrar "Cargando tu perfil..." en vez del aviso de acceso restringido.
- **Capturas:** `08-admin-restringido-mientras-sincroniza-360-390.jpg` y `07-admin-vista-correcta-tras-espera.jpg` (la misma cuenta después de esperar).

### 6. Media. La vista pública de un lote activo dice "Sello hash SHA-256 de cierre del lote"

- **Archivo:** `src/components/PublicTraceabilityView.tsx:421-424` (rótulo fijo).
- **Pasos:** abre `?lote=20261110-A-E1` mientras el lote está "EN CULTIVO". Muestra "SELLO HASH SHA-256 DE CIERRE DEL LOTE" con el hash del último evento.
- **Impacto:** un cliente puede creer que el lote está cerrado y sellado cuando aún se le pueden agregar fases.
- **Arreglo:** si `lote.estado !== 'cerrado'`, usar el rótulo "Huella de la última fase registrada (el lote sigue abierto)".
- **Captura:** `04-publica-sello-cierre-lote-activo.jpg`.

### 7. Media. El modal QR se corta en pantallas bajas, no cierra con Escape ni tocando fuera

- **Archivo:** `src/components/QrModal.tsx:65-66`. El velo es `flex items-center` sin `overflow-y-auto` y la caja es `overflow-hidden` sin `max-h`. No hay manejador de Escape: el único lugar con Escape es `PersonaUi.tsx:89`.
- **Pasos:** con una ventana de 639 px de alto, abre QR Etiqueta.
- **Resultado:**
  - la cabecera con la X queda casi fuera de la pantalla (y=0 a 3 px) y el botón "Descargar Certificado PDF" queda cortado abajo;
  - Escape y clic fuera no cierran.
- **Impacto:** en un teléfono en horizontal o en un portátil pequeño el usuario queda atrapado en el modal. Revisar los demás modales hechos a mano, que tampoco atienden Escape.
- **Arreglo:** `overflow-y-auto` en el velo y `max-h-[calc(100dvh-2rem)] overflow-y-auto` en la caja; cerrar con Escape y con clic en el velo.
- **Captura:** `06-qr-modal-cortado-sin-escape.jpg`.

### 8. Media. Se puede eliminar un estanque con lotes sin ningún aviso

- **Archivo:** `src/components/ConfiguracionTab.tsx:169-184`. Solo pide "¿Eliminar estanque E1? Se retirará de la lista." y no revisa `lotes`.
- **Pasos:** Configuración, papelera de E1, que tiene dos lotes. La confirmación no menciona los lotes. No se confirmó, para no romper los datos que usa el agente 5.
- **Impacto:** los lotes de E1 quedan con un estanque inexistente:
  - la densidad usa el volumen de config;
  - Analítica y Comparativo pierden la piscina;
  - "Ocupación estanques" deja de mostrarla.
- **Arreglo:** recibir `lotes` en la pestaña y bloquear la eliminación (o exigir una confirmación explícita) si hay lotes activos con ese estanque; listar cuántos hay.
- **Captura:** `11-eliminar-estanque-sin-aviso-lotes.jpg`.

### 9. Media. Las vistas previas de PDF usan `window.open` después de un `await`

- **Archivo:** `src/services/pdfService.ts:609-613` (`previsualizarPdfLote`) y `:840-843` (`verComprobantePdf`).
- **Pasos:** Entregas, orden, "Ver preliminar" (y "Vista Previa" del lote). El PDF se genera con jsPDF y luego se llama a `window.open(blob)`.
- **Resultado:**
  - en Chrome de escritorio abrió;
  - en Safari de iOS y con bloqueadores, la apertura tras un `await` largo suele bloquearse como emergente y el código no lo detecta (no revisa si el resultado es null);
  - el `objectURL` no se libera nunca.
- **Impacto:**
  - en el iPhone del administrador "Ver preliminar" puede no hacer nada;
  - cada vista previa deja un blob en memoria.
- **Arreglo:**
  - abrir la ventana antes del `await` (`const w = window.open('', '_blank')`) y luego `w.location = url`;
  - si `w` es null, descargar el archivo;
  - `URL.revokeObjectURL` tras unos segundos.
- **Captura:** sin captura: es un riesgo deducido del código y no se reprodujo en Chrome de escritorio.

### 10. Baja. Etiquetas de datos sin traducir en la vista pública, el PDF y las anotaciones

- **Archivo:** `src/services/hashService.ts:270-297` y `src/services/pdfService.ts:~40-60` (`NOMBRE_DATO`). Tienen `causa`, pero el formulario guarda `causaProbable`. También faltan claves de otros tipos de fase:
  - `producto`, `dosis`, `viaAplicacion`, `objetivo`;
  - `tallaPromedioCm`, `etapa`;
  - `escamadoEviscerado`, `cantidadProcesada`, `pesoPromedioFinalG`;
  - `tipoEmpaque`, `temperaturaConservacionC`, `usoHielo`;
  - `destino`, `contenedorIsotermico`, `temperaturaDespachoC`, `responsable`, `fechaHoraSalida`;
  - `motivoCorreccion`, `eventoCorregidoId`.
- **Pasos:** registra una Mortalidad y abre `?lote=...`: aparece "causaProbable: Mortalidad natural / adaptación". Lo mismo en el selector de la anotación.
- **Impacto:** el texto técnico en camelCase queda a la vista del cliente final.
- **Arreglo:** completar `NOMBRE_DATO` (uno solo, compartido por hash y PDF).
- **Captura:** `05-publica-causaProbable-sin-traducir.jpg`.

### 11. Baja. Copias locales de otra sesión quedan en el navegador si la sesión termina sin "Cerrar sesión"

- **Archivo:** `src/App.tsx:252-261`. Cuando el token es inválido se hace `signOut`, pero no se borran `cultivos_lore_perfil_*`, `cultivos_lore_mis_entregas_*` ni `cultivos_lore_lotes_backup`. Solo `handleCerrarSesion` (`:345-356`) las limpia.
- **Evidencia:** en el localStorage de `localhost:3000` quedaban `cultivos_lore_perfil_5sDgysTl...` y `cultivos_lore_mis_entregas_5sDgysTl...` de una sesión anterior (otra corrida de emuladores), con nombres, direcciones y teléfonos de clientes.
- **Impacto:** en un teléfono compartido por repartidores quedan datos de clientes de la sesión anterior.
- **Arreglo:** limpiar las copias en el camino de `!fbUser` cuando el uid anterior es distinto, o al detectar un token inválido.

### 12. Baja. El botón "Guardar Configuración General" está activo sin permiso

- **Archivo:** `src/components/ConfiguracionTab.tsx:208-211`. Solo usa `disabled={guardando}`; los inputs sí se deshabilitan con `!puedeConfig`.
- **Pasos:** operador sin `gestionarConfiguracion`, Configuración, Guardar. Aparece "No tienes permiso..." y un `console.error`.
- **Impacto:** un clic inútil con mensaje de error; las reglas sí protegen.
- **Arreglo:** `disabled={guardando || !puedeConfig}` u ocultar el botón.

### 13. Baja. Agregar o editar un estanque guarda también los rangos editados sin guardar

- **Archivo:** `src/components/ConfiguracionTab.tsx:84-89`. `guardarEnFirestore` siempre envía `rangos` y `ficha` del estado local.
- **Detalles:**
  - si el administrador cambia un rango y, sin pulsar Guardar, agrega un estanque, el rango se guarda sin que lo haya confirmado;
  - quien solo tiene `gestionarEstanques` recibe "sin permiso" si el estado local de los rangos difiere del servidor;
  - si el guardado falla, el estanque agregado queda en la lista local (`:132-139`) aunque no se guardó.
- **Arreglo:**
  - al guardar estanques, enviar los rangos de `config` (los del servidor), no los editados;
  - revertir `setEstanques` si falla.

### 14. Baja. Listener redundante del lote abierto y cierre obsoleto en App

- **Archivo:** `src/App.tsx:314-343`. El callback de `escucharLotes` usa `loteDetalle` capturado al suscribirse (deps `[puedeVerProduccion]`), así que la actualización de `loteDetalle` nunca ocurre.
- **Detalles:**
  - funciona solo porque `LoteDetailModal.tsx:181-191` abre su propio `onSnapshot` del lote, el cual ya está en la consulta de la colección: dos targets del mismo documento, lo que duplica las lecturas;
  - además, cada snapshot de lotes guarda todos los lotes con sus eventos completos en localStorage (`:319-321`), que crece sin límite (5 MB).
- **Arreglo:**
  - quitar el bloque obsoleto de App o derivar el lote abierto de `lotes` por código y eliminar el listener individual;
  - guardar en la copia local solo un resumen o los N más recientes.

### 15. Baja. El modal de lote no bloquea el scroll del fondo

- **Pasos:** con el detalle del lote abierto, gira la rueda sobre el área del modal cerca del borde: se desplaza la página de fondo (lo hizo en la prueba a 1536 px).
- **Arreglo:** `overflow: hidden` en el body mientras haya un modal abierto, u `overscroll-behavior: contain` en el contenedor del modal. Le corresponde también al agente 5 (diseño).

### 16. Baja. Datos semilla: `orden-seed.mjs` usa UID fijos

No es un fallo de la app, sino del montaje de pruebas.

- **Archivo:** `scratchpad/orden-seed.mjs`, línea `const VEND=..., REP=...`.
- **Impacto:** en un emulador nuevo la orden semilla queda asignada a UID que no existen; el repartidor no la ve.
- **Arreglo:** buscar los UID por correo con `accounts:query` antes de escribir (como se hizo en `orden-seed-a4.mjs`).

## Notas de consola y red

- No hubo errores ni advertencias de la app durante el recorrido, salvo:
  - el aviso esperado "Sesión previa inválida" (un token de una corrida anterior de emuladores);
  - el `console.error` del hallazgo 12.
- Al cerrar sesión se cierran los canales Listen y Write; vuelve a abrirse solo el de configuración (pública).
- El repartidor deja de sincronizar al salir: `iniciarSincronizacion` limpia su intervalo.
- Las peticiones repetidas que se vieron son el long polling normal del SDK.
- Lecturas innecesarias: las del hallazgo 14. Además, el administrador escribe `usuarios/{uid}` en cada ingreso (hallazgo 5).

## Capturas

Todas en `C:\Users\LENOVO\OneDrive\tesis\codigo claude\proyecto-tilapia-roja-correcciones\auditoria\capturas-agente4\`:

- 01-fase-antes-de-siembra.jpg
- 02-mortalidad-mayor-que-vivos.jpg
- 03-cosecha-con-cero-vivos.jpg
- 04-publica-sello-cierre-lote-activo.jpg
- 05-publica-causaProbable-sin-traducir.jpg
- 06-qr-modal-cortado-sin-escape.jpg
- 07-admin-vista-correcta-tras-espera.jpg
- 08-admin-restringido-mientras-sincroniza-360-390.jpg
- 09-doble-toque-iniciar-ruta-conflicto.jpg
- 10-anotacion-valor-abc-en-cantidad.jpg
- 11-eliminar-estanque-sin-aviso-lotes.jpg

## Lo que no se cubrió

- **Anchos 360 y 390:** se revisó solo como administrador y con iframes, porque la ventana no cambiaba de tamaño. No hubo desborde horizontal en ninguna pestaña. El repartidor y el operador se probaron a 1536 px.
- **Aprobar anotaciones con una segunda persona:** no se probó (`anot-b`).
- **Personal y permisos:** no se cambiaron roles.
