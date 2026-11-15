---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

# Plataforma completa (pantallas de trabajo y consulta pública)

Modo: operate (la consulta pública del QR es read). Usuarios: administrador, operadores de producción y comerciales, repartidores en celular, clientes por QR. Restricción del usuario: conservar la distribución actual de la información (misma navegación superior, mismas pestañas, mismos bloques y orden); solo se reemplaza la identidad visual para quitarle el aire "hecho con IA". El usuario rechazó el sello circular en relieve del boceto.

## Direction contract

THESIS: La plataforma se lee como un acta formal: cada registro firmado y fechado, lo sellado declarado en una línea de acta, no en insignias. Rechaza el panel SaaS de tarjetas redondeadas, degradados y pastillas de color.

OWN-WORLD: Fondo blanco (#FFFFFF), tinta azul (#14213D) para la barra y los títulos, pizarra (#3A4A6B) para lo secundario, verde formal (#225F46) solo para íntegro, oro viejo (#8A6624) solo para detalles de acta, rojo (#B3261E) solo para alteración. Libre Caslon Text para títulos y códigos; Public Sans para todo lo operativo; versalitas espaciadas para rótulos. Esquinas pequeñas, filetes finos, sombras mínimas, sin vidrio ni degradados.

STORY: El operador encuentra todo donde siempre estuvo, pero ahora cada fase muestra quién la firmó; el cliente lee el QR como un certificado serio; la alteración se nota por tipografía y filete rojo, no por alarma.

FIRST VIEWPORT: Barra superior tinta con el nombre en serif y pestañas en versalitas con subrayado oro en la activa; debajo, el contenido de la pestaña con la misma distribución actual; títulos en serif, tablas con cifras tabulares y filetes finos.

FORM: Diploma con sello seco (posición 6 de la lista propia de la cuarta tirada, dirección asignada), sin el sello circular por decisión del usuario: la firma y la línea de acta son el gesto propio. seed:837ba8577e06a064

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Gesto propio (signature): la línea de acta (doble filete fino + versalitas: "SELLADO · fecha · CADENA ÍNTEGRA") y las líneas de firma (nombre visible en sans seminegrita sobre un filete, cargo en versalitas) en cada fase y anotación. Movimiento: transiciones de color cortas; ninguna animación decorativa.

PDF: certificado y comprobante con membrete (logo + nombre en serif), doble filete dorado, secciones con título y filete, tablas de encabezado tinta y pie paginado. Usan las fuentes estándar del PDF (Times/Helvetica) como equivalentes de Libre Caslon y Public Sans.

Sin resolver: incrustar Libre Caslon y Public Sans en los PDF (pesa ~300 KB por documento).
