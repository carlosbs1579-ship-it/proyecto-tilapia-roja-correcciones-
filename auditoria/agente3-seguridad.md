# Agente 3: seguridad de Firebase y del código

Fecha: 2026-11-15. Rama `correciones-claude`. Fase de revisión: no se tocó la app ni `firestore.rules`.

## CRÍTICO: escrituras no autorizadas encontradas

No hay ninguna escritura posible **sin sesión**, ni de un repartidor sobre datos de producción, ni de un usuario sobre su propio rol, funciones, permisos, estado o granja. Todo eso está probado (ver pruebas).

Sí hay escrituras que van **más allá del permiso** de una persona con sesión. Ninguna es crítica, porque todas exigen una cuenta interna activa:

1. **Alta (S1)**. Una persona que solo tiene el permiso "cerrar lotes" puede cambiar varios datos al sellar el lote: piscina, cantidad sembrada, producto, origen, los indicadores del resumen y `pdfUrl`, y también agregar campos nuevos. Ninguno de esos datos entra en la cadena de hashes, así que el QR público sigue mostrando "íntegro".
2. **Media (S2)**. Mientras el lote está activo, cualquiera que registre eventos puede reescribir el `resumen` sin registrar ningún evento.
3. **Media (S4)**. Al crear un lote, se puede atribuir a otra persona (`creadoPor`, `registradoPor` del evento 0) y el hash del evento 0 no se valida.
4. **Media (S7)**. Con el permiso de configuración se puede borrar o deformar `configuracion/general`. Además, un administrador de otra granja puede escribir la configuración global.
5. **Baja (S5, S6, S9, S10, S11)**. Firmar eventos con el nombre de otra persona, campos extra en el alta propia, contadores arbitrarios, reemplazar fotos vencidas y `contacto` de clientes sin límite.

## Resumen por severidad

| Severidad | Cantidad | Hallazgos |
| --- | --- | --- |
| Crítica | 0 | |
| Alta | 1 | S1 |
| Media | 6 | S2, S3, S4, S7, S13, S14 |
| Baja | 10 | S5, S6, S8, S9, S10, S11, S12, S15, S16, S17 |
| Informativa | 3 | S18, S19, S20 |

S1 coincide con el hallazgo principal del agente 1 (`auditoria/agente1-integridad.md`). Aquí queda confirmado con una prueba de reglas.

## Cómo se probó

- Pruebas nuevas en `tests/seguridad/`:
  - `seguridad.test.mjs`: 49 pruebas.
  - `fotos.test.mjs`: 4 pruebas.
  - `firebase.json`: Firestore en el puerto 8285, hub en 4485 y logging en 4585.
- Resultado: **53 de 53 pasan**.
- Las pruebas que se llaman "HUECO" pasan **porque el hueco existe**: documentan el comportamiento actual. Cuando se corrija una regla, esa prueba debe cambiar a `assertFails`.
- Cómo correrlas, desde `tests/seguridad`:
  ```
  cmd /c mklink /J node_modules ..\reglas\node_modules
  firebase emulators:exec --config firebase.json --only firestore --project demo-tilapia "node --test --test-concurrency=1 seguridad.test.mjs fotos.test.mjs"
  ```
  El enlace `node_modules` se borró al terminar, para que OneDrive no sincronice dos veces las dependencias.
- El emulador se detuvo al terminar: quedaron solo conexiones en TIME_WAIT y ningún puerto escuchando.
- Lo que se confirmó que está bien:
  - Un anónimo no escribe en ninguna colección: 12 colecciones probadas, más borrados.
  - Un anónimo no lista lotes, clientes, usuarios, consultas, comprobantes ni anotaciones.
  - Una cuenta con el correo del maestro sin `email_verified` no es maestro.
  - Ni un usuario pendiente ni un operador cambian su `rol`, `roles`, `estado`, `granjaId`, `permisos`, `cargos` o `email`.
  - El repartidor no se da el rol de operador.
  - Un subadministrador no se modifica a sí mismo ni nombra administradores.
  - El alta propia no puede venir activa ni con funciones.
  - Un repartidor con permisos de producción marcados no crea lotes, no registra eventos, no cierra, no configura, no mueve contadores, no lista lotes y no lee ni crea clientes.
  - Un lote sellado no se modifica ni se borra, ni siquiera el maestro.
  - Los eventos no se reescriben ni se borran.

---

## Hallazgos

### S1. Alta. El cierre del lote deja escribir datos fuera de la cadena
- **Dónde**: `firestore.rules:226-230` (caso B de `match /lotes`).
- **Qué pasa**: el caso B solo exige tres cosas:
  - `estado == 'cerrado'`;
  - permiso de cierre;
  - eventos iguales y cosecha igual.

  No limita qué otras claves cambian. `camposFijosDelLoteIntactos` protege `codigo`, `consecutivo`, `granjaId`, `fechaSiembra`, `creadoPor*` y `creadoEn`, pero deja abiertos estos:
  - `estanque`, `cantidadSembrada`, `pesoInicialPromedioG`, `proveedorAlevinos`, `producto`, `origen`;
  - todo `resumen` salvo la cosecha (supervivencia, FCA, biomasa, `hashFinal`);
  - `pdfUrl` y campos nuevos.
- **Cómo se reproduce**: prueba `HUECO: quien solo puede cerrar cambia piscina, siembra, producto e indicadores al sellar`. Con un perfil operador que solo tiene `cerrarLotes`, se hace `updateDoc` con `estado:'cerrado'`, `estanque:'E9'`, `cantidadSembrada:1`, `producto`, `resumen.supervivencia:99.9`, `pdfUrl:'javascript:alert(1)'` y `campoInventado`. La escritura pasa.
- **Impacto**:
  - El certificado público (`PublicTraceabilityView.tsx:274-437`, PDF) muestra producto, piscina, siembra e indicadores falsos con la marca de cadena íntegra, porque la verificación solo recalcula los eventos y compara `hashFinal`.
  - Después del sello ya no se puede corregir.
  - El cambio de `estanque` también altera la regla de reservas (`procedencia.estanque == lote.estanque`, línea 469).
- **Arreglo**:
  - En el caso B, exigir `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['estado','fechaCierre','resumen','pdfPath','pdfUrl','versionPdf','pdfActualizadoEn','actualizadoEn'])`.
  - Exigir `resumen.hashFinal == eventos[eventos.size()-1].hash` y que `pdfUrl` tenga el formato `'https://' ... '/?lote=' + codigo`, o mejor que no sea editable.
  - Que la vista pública y el PDF recalculen el resumen desde los eventos con `recalcularResumenLote` en lugar de confiar en el guardado.

### S2. Media. El resumen del lote activo se reescribe sin evento
- **Dónde**: `firestore.rules:166-175`. `loteActivoCoherente` admite `resumen` y solo controla `biomasaCosechadaKg` y `pecesCosechados`.
- **Cómo se reproduce**: prueba `HUECO: con el lote activo, quien registra eventos cambia el resumen sin evento`.
- **Impacto**: indicadores productivos falsos que luego quedan sellados. Requiere el permiso de registrar eventos.
- **Arreglo**: las reglas no pueden recalcular el resumen. La salida es no mostrar `resumen` guardado en lo público ni en el PDF y recalcularlo desde la cadena. Como mínimo, permitir que `resumen` cambie solo cuando se agrega un evento: `cambios.hasAny(['resumen'])` implica que `eventos` creció.

### S3. Media. La lectura pública de lotes y anotaciones expone correos y uid del personal, y los códigos se pueden adivinar
- **Dónde**:
  - `firestore.rules:202` (`lotes` `get: if true`);
  - `firestore.rules:307` (`anotacionesLote` `get: if true`);
  - el formato del código está en `lotesService.ts:108` (`AAAAMMDD-LETRA-ESTANQUE`).
- **Cómo se reproduce**:
  - pruebas `HUECO: un anónimo lee el lote completo, con correos y uid del personal` y `... anotaciones con correo y uid`;
  - en producción, cualquiera puede llamar `GET https://firestore.googleapis.com/v1/projects/iron-outpost-cw2pc/databases/ai-studio-.../documents/lotes/20261023-A-E1?key=<apiKey pública>`.
- **Impacto**:
  - La vista pública no muestra correos, pero el documento crudo sí los trae: `creadoPor`, `creadoPorUid`, `eventos[].registradoPor` (correo), `registradoPorNombre`, y en anotaciones `registradoPor` y `registradoPorUid`.
  - Como `list` está cerrado pero los códigos son predecibles (fecha, letra y piscina, unos cientos de combinaciones al año), un script puede recorrer todos los lotes, incluidos los **activos**, y armar la lista de correos del personal y toda la producción.
- **Arreglo**:
  - Para lo nuevo, no guardar el correo en lo que se lee en público: usar uid o nombre en el evento y dejar el correo en un documento privado.
  - O publicar un documento saneado `lotesPublicos/{codigo}` escrito al cerrar el lote, y cerrar el `get` de `lotes` a internos.
  - Considerar permitir `get` público solo si `resource.data.estado == 'cerrado'`.
  - Los lotes ya sellados tienen el correo dentro del hash. No se puede quitar sin romper la cadena, así que hay que decidirlo de forma explícita.

### S4. Media. Al crear un lote se puede atribuir a otra persona y el evento 0 no se valida
- **Dónde**: `firestore.rules:206-213`.
- **Qué pasa**: no se exige nada de lo siguiente:
  - `creadoPorUid == request.auth.uid`, `creadoPor == correoSesion()`;
  - `eventos[0].registradoPor == correoSesion()`, `nombrePropio(eventos[0])`;
  - `eventos[0].hashAnterior == '0'*64`, `eventos[0].hash` de 64 caracteres;
  - `codigo == {codigo}` (id del documento);
  - `keys().hasOnly(...)`.
- **Cómo se reproduce**: prueba `HUECO: al crear un lote se puede atribuir a otra persona`. Un operador crea `lotes/20261002-A-E1` con `codigo:'OTRO-CODIGO'`, `consecutivo:999`, `creadoPor` y `registradoPor` del maestro, y `hash:'no-es-un-hash'`.
- **Impacto**: repudio, porque el lote aparece creado por otra persona, y un código mostrado distinto del id que abre el QR.
- **Arreglo**: agregar esas condiciones al `create`, igual que se hace en `eventoNuevoValido`.

### S5. Baja. Firmar eventos con el nombre de otra persona
- **Dónde**:
  - `firestore.rules:420-422`: el usuario cambia su `displayName` libremente, sin tipo ni tamaño;
  - `firestore.rules:255-257`: `nombrePropio` lo compara con ese mismo campo.
- **Cómo se reproduce**: prueba `HUECO: operador se pone el nombre de otro y firma eventos con ese nombre`.
- **Impacto**: el QR y el PDF muestran `registradoPorNombre` "Carlos" en un evento hecho por otra persona. El correo real sigue en el evento, pero no se muestra.
- **Arreglo**: que el nombre visible lo fije el administrador, o validar `displayName is string && size() <= 80` y mostrar en lo público algo que no se pueda elegir libremente.

### S6. Baja. El alta propia no limita campos ni tamaños
- **Dónde**: `firestore.rules:1405-1414`. No hay `keys().hasOnly(...)`.
- **Cómo se reproduce**: prueba `HUECO: alta propia acepta campos extra y nombre visible sin límite`. Pasa con un campo `basura` de 200 KB, `displayName:'Carlos'` y `autorizadoPor` con el correo del maestro.
- **Impacto**: el registro es abierto, así que cualquiera puede crear perfiles pendientes grandes (relleno y costo). Un `autorizadoPor` falso puede engañar al administrador en la pestaña Usuarios.
- **Arreglo**: `request.resource.data.keys().hasOnly(['uid','email','displayName','rol','estado','granjaId','permisos','roles','cargos','cargo','creadoEn','actualizadoEn'])`, más límites de tamaño.

### S7. Media. La configuración no tiene forma validada, se puede borrar y no está separada por granja
- **Dónde**: `firestore.rules:1334-1342`.
- **Qué pasa**:
  - `write` cubre crear, cambiar y borrar cualquier `configuracion/{docId}`, sin validar tipos.
  - `esAdminGranja()` no compara la granja.
  - `read: if true` permite además **listar** la colección completa sin sesión.
- **Cómo se reproduce**: pruebas `HUECO: el permiso de configuración borra la configuración y escribe cualquier forma`, `HUECO: el administrador de otra granja cambia la configuración global` y `HUECO: un anónimo lista toda la colección configuracion`.
- **Impacto**:
  - La ficha nutricional que muestran el certificado público y el PDF sale de aquí. No está encadenada, así que cambiarla altera de forma retroactiva lo que muestra cualquier lote sellado.
  - Borrar o deformar el documento hace que la app use los valores por defecto o falle.
- **Arreglo**:
  - Limitar `docId == 'general'`, `allow delete: if isMasterAdmin()` y validar tipos (`estanques is list`, números en la ficha).
  - Guardar en el lote, al sellarlo, la ficha nutricional vigente para que el certificado no dependa de la configuración actual.

### S8. Baja. Un administrador lee perfiles de cualquier granja
- **Dónde**: `firestore.rules:1395`. `esAdminGranja()` sin comparar la granja.
- **Cómo se reproduce**: prueba `HUECO: un administrador lee perfiles de otra granja`.
- **Impacto**: hoy hay una sola granja. Si se agregan más, un administrador vería correos y permisos ajenos.
- **Arreglo**: agregar `&& (isMasterAdmin() || resource.data.get('granjaId','cultivos-lore') == granjaUsuario())`.

### S9. Baja. Los contadores se pueden manipular
- **Dónde**: `firestore.rules:1320-1331`.
- **Qué pasa**: quien tiene `crearLotes` crea contadores con cualquier id válido y avanza `lotes_global` sin crear ningún lote. No los puede bajar.
- **Cómo se reproduce**: prueba `HUECO: quien crea lotes crea contadores arbitrarios y avanza el global sin crear lotes`.
- **Impacto**: saltos en el consecutivo, que en una auditoría puede parecer un lote borrado.
- **Arreglo**:
  - limitar los ids a `lotes_global` o `diario_\d{8}`;
  - exigir que el lote nuevo se escriba en la misma operación con `getAfter(/lotes/...).data.consecutivo == request.resource.data.valor`, pasando el código en un campo `ultimoLote`.

### S10. Baja. Fotos de entrega: el contenido no se valida y se pueden volver a crear después del TTL
- **Dónde**: `firestore.rules:1218-1239`.
- **Qué pasa**:
  - `datos` solo se valida como texto de 100 a 700000 caracteres;
  - nada exige que la orden cambie en la misma operación.
- **Cómo se reproduce**:
  - prueba `HUECO: la "foto" puede ser una URL externa`, con `https://atacante.example/pixel.png?...`;
  - prueba `HUECO: vencida la foto (TTL), el repartidor la vuelve a crear con otro contenido`.
- **Impacto**:
  - `FotosEntregaOrden.tsx:42,93` y `DetalleEntregaRepartidor.tsx:496` ponen `datos` en `<img src>`. Una URL externa le avisa a un tercero la IP y la hora de cada operador que abre la orden. No ejecuta código.
  - Pasados los 15 días, el repartidor puede volver a subir otra imagen con el mismo id. El hash del evento la delataría con `verificarFoto`, pero la regla no lo impide.
- **Arreglo**:
  - `f.datos[0:23] == 'data:image/jpeg;base64,'`;
  - exigir que la orden cambie en esta misma operación: `getAfter(rutaOrden(f.ordenId)).data.historial.size() == get(rutaOrden(f.ordenId)).data.historial.size() + 1`.

### S11. Baja. Clientes: sin límites al editar
- **Dónde**: `firestore.rules:608-613`. No se valida `contacto` (ni tipo ni tamaño) y `direccion` no se valida como texto.
- **Cómo se reproduce**: prueba `HUECO: al editar, contacto no tiene límite de tamaño ni de tipo`. Pasan 900 KB y un mapa.
- **Arreglo**: repetir en `update` las validaciones de `create`.

### S12. Baja. El comprobante público incluye datos del cliente
- **Dónde**: `firestore.rules:1094` (`comprobantes` `get: if true`) y `comprobantesService.ts:279-303`.
- **Qué pasa**: con el token del QR, un anónimo lee el nombre y la **dirección** del cliente, el nombre del repartidor, las `novedades` en texto libre (pueden traer teléfonos o comentarios) y `emitidoPorUid`.
- **Cómo se reproduce**: prueba `Con el token, un anónimo lee nombre y dirección del cliente...`.
- **Mitigación existente**: `consultasEntrega` no se lista y el token es aleatorio (`crypto.getRandomValues`, 20 caracteres o más), así que no se puede adivinar.
- **Impacto**: quien fotografíe el comprobante impreso ve la dirección y las novedades.
- **Arreglo**: decidir qué necesita ver el cliente. Probablemente sobran la dirección completa, las novedades internas y el uid.

### S13. Media. Vercel no envía cabeceras de seguridad
- **Dónde**: no existe `vercel.json`. `curl -I https://proyecto-tilapia-roja-claude.vercel.app/` solo devuelve `Strict-Transport-Security`.
- **Qué falta**: `Content-Security-Policy`, `X-Frame-Options` o `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` y `Permissions-Policy`.
- **Impacto**:
  - Se puede hacer clickjacking: la app con sesión de administrador se puede meter en un iframe de otro sitio.
  - Sin CSP no hay una segunda barrera si algún día aparece una inyección.
- **Arreglo**: crear `vercel.json` con `headers` para `/(.*)`:
  - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), geolocation=()`;
  - una CSP del tipo `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src https://iron-outpost-cw2pc.firebaseapp.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`.

  Conviene probarla primero en la vista previa en modo `Content-Security-Policy-Report-Only`.

### S14. Media. No hay App Check y la configuración de Auth está pendiente de revisar
- **Dónde**: `src/firebase/firebaseConfig.ts`. No hay `initializeAppCheck` y `recaptchaSiteKey` está vacío en `firebase-applet-config.json`.
- **Impacto**:
  - Con la API key web, que es pública por diseño, cualquiera usa la REST de Firestore y de Auth desde fuera de la app: recorrer lotes (S3), crear cuentas en masa (el registro está abierto) y llenar perfiles pendientes (S6).
  - Las reglas siguen mandando, pero App Check corta el abuso automatizado.
- **Arreglo**:
  - activar App Check con reCAPTCHA Enterprise, primero en modo de métricas y luego obligatorio en Firestore;
  - en Authentication, activar la protección contra enumeración de correos;
  - evaluar si el registro libre es necesario o si basta con que el administrador cree las cuentas.
- **Verificación pendiente para el usuario** (no se ve desde aquí):
  - en Google Cloud Console, Credenciales, que la API key `AIzaSyCpMF-...` esté restringida por referente HTTP (dominios de Vercel y `localhost`) y a las API que usa la app: Identity Toolkit, Token Service y Firestore;
  - que los dominios autorizados de Auth sean solo los de Vercel y `localhost`.

### S15. Baja. Dependencias
- `npm audit` no corre en el repo porque no hay `package-lock.json`: el proyecto usa `bun.lock`. Se generó un lock aparte en el scratchpad con `--legacy-peer-deps`, así que las versiones pueden diferir un poco de `bun.lock`.
- Resultado de `npm audit --omit=dev` y del audit completo: **4 altas**, todas por `@grpc/grpc-js <=1.13.5` (GHSA-m9gg-hp2v-232j, GHSA-f596-whhp-79r4), que entra por `firebase` y `@firebase/firestore`. Ese paquete solo se usa en Node. El paquete del navegador usa WebChannel/fetch y no incluye grpc, así que el riesgo práctico en la web es bajo. El "arreglo" que propone npm (bajar a firebase 9.14) no conviene.
- En `dependencies` hay paquetes de servidor que la app no usa: `express`, `dotenv`, `@google/genai` (resto de AI Studio). Conviene quitarlos para reducir superficie.
- `.env.example` solo tiene marcadores.

### S16. Baja. Datos en localStorage
- **Dónde**:
  - `App.tsx:119,320`: copia de todos los lotes;
  - `usuariosService.ts:306`: perfil;
  - `repartoService.ts:85,150`: bandeja del repartidor con foto base64 pendiente, y copia de sus órdenes con nombre, dirección y contacto del cliente.
- **Qué pasa**: al cerrar sesión se borran la copia de lotes, el perfil y las órdenes (`App.tsx:343-355`). Se conserva a propósito la bandeja sin enviar.
- **Impacto**: si se cierra el navegador sin cerrar sesión, en un equipo compartido, los datos quedan. Es aceptable por el trabajo sin conexión.
- **Arreglo**: opcional. Avisar en la pantalla de ingreso que se cierre sesión en equipos compartidos, o borrar las copias al vencer la sesión.

### S17. Baja. La exportación CSV no escapa los valores
- **Dónde**: `AnaliticaTab.tsx:169-191`.
- **Qué pasa**: los valores van entre comillas sin escapar las comillas internas y sin neutralizar `= + - @`. `estanque` viene de la configuración y `pdfUrl` del lote (ver S1).
- **Impacto**: un valor del tipo `=HYPERLINK(...)` se ejecuta como fórmula al abrir el CSV en Excel.
- **Arreglo**: duplicar las comillas, anteponer `'` cuando el valor empieza con `= + - @` y usar `Blob` en lugar de `encodeURI` (un `#` en un dato corta el archivo).

### S18. Informativa. Storage
- `storage.rules` niega toda escritura y permite `read` en `lotes/{archivo}`. En Storage, `read` también incluye **list**, así que cualquiera puede listar los PDF antiguos.
- Según `AUDITORIA_PROGRESO.md`, estas reglas **no están publicadas**: no hay release de `firebase.storage`.
- **Verificación pendiente**: en la consola, confirmar las reglas vigentes del bucket `iron-outpost-cw2pc.firebasestorage.app`. Si quedaron las del "modo de prueba" con fecha, el bucket estaría abierto.
- **Arreglo**: publicar `storage.rules`, cambiando `read` por `get`, o negar todo si esos PDF ya no se usan.

### S19. Informativa. Secretos
- No hay llaves privadas, cuentas de servicio, `.env` reales ni tokens en el repo ni en el historial:
  - `git log --all -S` con "PRIVATE KEY", "private_key" y "service_account" no encontró nada;
  - la búsqueda de patrones `AIza`, `sk-`, `ghp_`, `BEGIN`, `xox` y contraseñas sobre `git log -p --all` solo encontró la apiKey web de `firebase-applet-config.json`, que es pública por diseño (ver S14).
- `respaldos_despliegue/` y `.env*` están en `.gitignore`. El cambio en `.gitignore` todavía no está confirmado en git.
- `scripts/migracion-paso5.mjs` usa el SDK web, sin credenciales de administrador.

### S20. Informativa. XSS, QR y URL
- **XSS**: no hay `innerHTML`, `dangerouslySetInnerHTML`, `document.write`, `eval` ni `insertAdjacentHTML` en `src`. Los datos se muestran con JSX, que escapa el texto.
- **PDF**: el PDF se arma con jsPDF (texto, no HTML) y se abre como `blob:` (`pdfService.ts:612,842`).
- **QR**:
  - `qrService.ts` arma las URL solo con `window.location.origin` más `encodeURIComponent`. No hay redirección abierta y el QR no apunta a dominios externos.
  - `?lote` y `?entrega` solo se usan como id de documento en `getDoc`, y las reglas controlan el acceso.
  - `pdfUrl` del lote (manipulable, ver S1) no se usa como enlace en la interfaz, solo en el CSV.
- **Robustez** (no es XSS): `PublicTraceabilityView.tsx:82` llama `decodeURIComponent` sobre un valor que `URLSearchParams` ya decodificó, y lo hace fuera del `try`. `?lote=%25` lanza `URIError` y la vista se queda cargando para siempre.
- **Código sin uso**: `handleFirestoreError` (`firebaseConfig.ts:71`) metería el correo y el uid en el mensaje del error, pero no se usa. Conviene quitarlo.
- **Rutas protegidas**: las pestañas se ocultan en el cliente según el perfil, pero cada lectura y escritura la controla Firestore (probado arriba). No hay rutas de servidor.

---

## Orden sugerido de arreglo
1. S1 y S2: restringir las claves del cierre y recalcular el resumen público desde la cadena.
2. S4, S5 y S6: atribución y nombre en `create` del lote y en `usuarios`.
3. S7 y S9: configuración y contadores.
4. S13: cabeceras en Vercel, primero en modo report-only en la vista previa.
5. S14: App Check y restricciones de la API key. Las hace el usuario en la consola.
6. S3: decidir qué se publica del lote. Cambia el diseño de los datos públicos.
7. Las bajas restantes.

Cada arreglo de reglas debe cambiar la prueba "HUECO" correspondiente de `assertSucceeds` a `assertFails` y volver a correr `tests/reglas` (143 pruebas) para comprobar que no rompe nada.
