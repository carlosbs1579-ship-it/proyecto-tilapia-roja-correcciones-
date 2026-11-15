---
name: Cultivos Loré · Trazabilidad Tilapia Pro
description: Plataforma de trazabilidad que se lee como un acta formal, firmada y fechada.
colors:
  tinta: "#16213a"
  tinta-profunda: "#0d1526"
  azul-accion: "#2c426e"
  azul-accion-claro: "#3e5584"
  azul-velado: "#dce2ee"
  pizarra: "#3a4a6b"
  oro-viejo: "#8a6624"
  oro-filete: "#a07a2c"
  oro-sobre-tinta: "#d1ac5c"
  verde-integro: "#225f46"
  verde-integro-claro: "#eef5f1"
  rojo-alteracion: "#b3261e"
  rojo-alteracion-claro: "#fbf0ef"
  papel: "#ffffff"
  gris-fondo: "#f6f7f9"
  filete: "#dfe2e7"
  borde-campo: "#c5cad3"
  texto-secundario: "#5d6470"
typography:
  display:
    fontFamily: "Libre Caslon Text, Georgia, Times New Roman, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.33
    letterSpacing: "-0.005em"
  headline:
    fontFamily: "Libre Caslon Text, Georgia, Times New Roman, serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.25
  title:
    fontFamily: "Libre Caslon Text, Georgia, Times New Roman, serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.43
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
    fontFeature: "\"kern\", \"liga\""
  body-compacto:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
  label:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.14em"
  firma:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
rounded:
  sm: "0.125rem"
  md: "0.25rem"
  lg: "0.3125rem"
  xl: "0.375rem"
  2xl: "0.5rem"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.azul-accion}"
    textColor: "{colors.papel}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "8px 20px"
  button-primary-hover:
    backgroundColor: "{colors.azul-accion-claro}"
  button-compacto:
    backgroundColor: "{colors.azul-accion}"
    textColor: "{colors.papel}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  input-campo:
    backgroundColor: "{colors.papel}"
    textColor: "{colors.tinta}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  card-registro:
    backgroundColor: "{colors.papel}"
    rounded: "{rounded.xl}"
    padding: "20px"
  nav-barra:
    backgroundColor: "{colors.tinta}"
    textColor: "{colors.papel}"
    height: "64px"
  nav-pestana-activa:
    textColor: "{colors.papel}"
    typography: "{typography.label}"
    padding: "0 12px"
  etiqueta-estado:
    rounded: "{rounded.sm}"
    padding: "2px 8px"
    typography: "{typography.label}"
  aviso-sellado:
    backgroundColor: "{colors.tinta}"
    textColor: "{colors.papel}"
    rounded: "{rounded.md}"
    padding: "20px 24px"
---

# Design System: Cultivos Loré · Trazabilidad Tilapia Pro

## Overview

**Creative North Star: "El acta formal"**

La plataforma se lee como un acta: cada registro aparece firmado y fechado, y lo sellado se declara en una línea de acta con doble filete y versalitas, no con insignias. El papel es blanco puro, la tinta es azul muy oscuro, y el color de estado se reserva para dos verdades opuestas: lo íntegro en verde formal y la alteración en rojo. El oro viejo solo aparece en detalles de acta: filetes dobles, subrayado de la pestaña activa, el trazo del logo sobre la tinta.

La densidad es de oficina y de campo a la vez: tablas compactas con cifras tabulares y filetes finos en computador, y la misma información apilada en el celular junto al estanque o en ruta. La identidad se cambió sin mover la distribución: misma barra superior, mismas pestañas, mismos bloques y en el mismo orden. Lo que cambió es la piel: serif de libro para títulos y códigos, sans pública para lo operativo, esquinas pequeñas, sombras apenas perceptibles.

Rechazos confirmados por el usuario: el panel SaaS de tarjetas muy redondeadas, degradados, vidrio y pastillas de color; el fondo hueso o crema; el sello circular en relieve; las firmas en cursiva serif; cualquier corona en el logo.

**Key Characteristics:**
- Papel blanco puro (#ffffff) bajo una barra de tinta con doble filete dorado inferior.
- Libre Caslon Text para títulos, nombres y códigos; Public Sans para todo lo demás.
- Rótulos en versalitas espaciadas (11 px, seminegrita, 0.14em).
- Firma: nombre de quien registra en sans seminegrita sobre un filete de 1 px, cargo debajo en versalitas.
- Verde solo para íntegro, rojo solo para alteración, oro solo para detalles de acta.
- Esquinas de 2 a 8 px, sombras tintadas casi planas.

## Colors

Una paleta de papel y tinta: neutros fríos con tinte azul, un azul tinta para la acción y tres colores con un único significado cada uno.

### Primary
- **Tinta** (#16213a): barra superior, encabezado de la consulta pública, aviso de lote sellado, texto principal del cuerpo y color de cabecera de las tablas del PDF. También es el `theme-color` del navegador.
- **Azul de acción** (#2c426e): botones principales, cursor y `accent-color` de los campos. Su variante clara (#3e5584) es el estado hover del botón y el anillo de foco (`outline` 2 px, separación 2 px). La selección de texto usa azul velado (#dce2ee) con texto tinta.

### Secondary
- **Pizarra** (#3a4a6b): acciones y elementos secundarios (escala `indigo` redefinida). Nunca compite con el azul de acción.

### Tertiary
- **Oro viejo** (#8a6624): filetes de acta en pantalla y en PDF, subrayados de rótulos de anotación. El oro de filete (#a07a2c) dibuja el doble filete animado del lote sellado. Sobre fondo tinta se usa el oro claro (#d1ac5c): logo y subrayado de la pestaña activa. También marca lo pendiente.
- **Verde íntegro** (#225f46): solo "Cadena íntegra", estado activo del lote, verificación correcta. Fondo suave #eef5f1.
- **Rojo de alteración** (#b3261e): solo datos alterados, anotaciones sin validez y errores. Fondo suave #fbf0ef. La alteración se nota por tipografía seminegrita y filete rojo, no por alarma.

### Neutral
- **Papel** (#ffffff): fondo del cuerpo y de toda tarjeta. Blanco puro por decisión del usuario.
- **Gris de fondo** (#f6f7f9): interior de las ventanas de detalle, cabeceras de tabla, filas alternas del PDF.
- **Filete** (#dfe2e7): bordes de tarjeta, divisores de fila.
- **Borde de campo** (#c5cad3): borde de los campos de formulario y de la barra de desplazamiento.
- **Texto secundario** (#5d6470): rótulos, metadatos, pies de PDF.

### Named Rules
**The Un Color, Un Significado Rule.** Verde es íntegro, rojo es alteración, oro es acta. Ningún otro uso. Si un verde aparece en un botón de "guardar" o un rojo en un adorno, el sistema miente.

**The Papel Blanco Rule.** El fondo es #ffffff. No se tiñe a hueso ni a crema; la formalidad viene de la tipografía y los filetes, no de imitar papel viejo.

**The Escalas Redefinidas Rule.** Los colores se aplican a través de las escalas de Tailwind que ya usan los componentes (`slate`, `sky`, `cyan`, `indigo`, `emerald`, `amber`, `red`), redefinidas en `@theme`. Una escala no redefinida (violeta, naranja, púrpura) queda fuera del sistema.

## Typography

**Display Font:** Libre Caslon Text (con Georgia, Times New Roman)
**Body Font:** Public Sans (con ui-sans-serif, system-ui, Segoe UI)

**Character:** Una serif de libro con trazo firme para lo que se nombra y se certifica, junto a una sans institucional, clara y neutra para lo que se opera. La serif da gravedad; la sans no distrae.

### Hierarchy
- **Display** (400, 1.5rem, 1.33): título de cada pestaña (`h1`) y "Lote sellado".
- **Headline** (400, 1.25rem, 1.25): nombre "Cultivos Loré" en la barra.
- **Title** (700, 0.875–1rem): títulos de sección (`h2`); los `h1`/`h2` heredan Caslon y los utilitarios de peso la llevan a negrita. Los códigos de lote y de comprobante usan Caslon 400 a 0.875–1rem con cifras tabulares.
- **Body** (400, 0.875rem, 1.43): texto operativo. El tamaño compacto (0.75rem) es el más usado en tablas y metadatos.
- **Label** (600, 0.6875rem, 0.14em, mayúsculas): rótulos, pestañas, cargo bajo una firma, estado del lote.

En pantallas táctiles todos los campos suben a 16 px para que el teléfono no haga zoom.

### Named Rules
**The Cifras Tabulares Rule.** Tablas, campos numéricos y códigos usan `tabular-nums`. Las columnas de kg, pH y oxígeno se alinean por dígito.

**The Firma Sans Rule.** El nombre de quien firma va en Public Sans seminegrita (600) sobre un filete de 1 px del color del texto. Nunca cursiva, nunca serif.

**The Serif Nombra Rule.** Caslon solo para lo que se nombra o certifica: títulos, la marca, códigos, números de fase. Botones, campos, tablas y avisos van en Public Sans.

## Layout

Contenedor central de hasta 1280 px (`max-w-7xl`) con márgenes laterales de 16, 24 y 32 px según el ancho. La barra mide 64 px de alto, es fija arriba y respeta la zona segura del notch. En escritorio las pestañas van dentro de la barra; bajo 768 px pasan a una franja propia debajo, desplazable en horizontal sin barra visible. Las ventanas de detalle ocupan casi toda la pantalla con márgenes de 12 a 24 px y desplazamiento propio que no arrastra la página.

El ritmo de espaciado es de 4 px: 8 y 12 px dentro de controles y filas, 16 a 24 px dentro de tarjetas, 24 px entre bloques. La distribución de la información es la original y no se reorganiza al cambiar de identidad.

### Named Rules
**The Distribución Intacta Rule.** El orden de navegación, pestañas y bloques es un contrato con los operadores. Las mejoras visuales cambian la piel, no la ubicación de la información.

## Elevation & Depth

Casi plano. La profundidad viene de filetes y del contraste entre papel blanco y gris de fondo; las sombras están tintadas con la tinta azul (rgb 20 33 61) y apenas se notan. Las tarjetas llevan la sombra mínima; las ventanas, la más profunda, sobre un velo tinta al 55 %.

### Shadow Vocabulary
- **Mínima** (`box-shadow: 0 1px 2px 0 rgb(20 33 61 / 0.05)`): tarjetas, botones principales.
- **Suave** (`box-shadow: 0 1px 3px 0 rgb(20 33 61 / 0.07)`): elementos sobre gris de fondo.
- **Ventana** (`box-shadow: 0 24px 48px -16px rgb(20 33 61 / 0.2)`): ventanas modales sobre el velo.

### Named Rules
**The Sin Vidrio Rule.** No hay desenfoque de fondo ni degradados. El velo de las ventanas es un color plano (#0d1526 al 55 %).

## Shapes

Esquinas pequeñas: 2 px en etiquetas de estado, 4 px en botones compactos y en el aviso de sellado, 5 px en botones y campos, 6 px en tarjetas, 8 px como máximo. Los bordes son filetes de 1 px en gris claro. El rasgo propio es el doble filete: 3 px `double` en oro bajo la barra y la cabecera pública, y sobre el texto del lote sellado; en PDF, dos líneas de 0.3 mm separadas 0.9 mm.

La marca es una tilapia de perfil dibujada a línea (trazo 1.5, extremos redondeados, ojo relleno) sobre una línea de agua. Sin corona ni ornamento. En la barra va en oro claro sobre tinta; en el favicon, en tinta.

### Named Rules
**The Doble Filete Rule.** Lo sellado y los encabezados de documento se marcan con doble filete fino en oro, nunca con un sello circular, una insignia o un ícono de medalla.

## Components

### Buttons
- **Shape:** esquina suave (5 px); compactos a 4 px.
- **Primary:** azul de acción con texto blanco, Public Sans 500–700 a 0.75–0.875rem, relleno 8×20 px; sombra mínima.
- **Hover / Focus:** hover al azul claro, transición de color corta; foco con contorno de 2 px en #3e5584 separado 2 px. Al presionar, `brightness(0.93)` igual con dedo o mouse. Deshabilitado al 50 % de opacidad.
- **Secondary:** borde gris y fondo blanco, o pizarra para acciones secundarias.

### Etiquetas de estado
- **Style:** rectángulo de esquina 2 px, borde de 1 px, fondo suave de la escala y texto del tono 700–800, seminegrita a 11 px.
- **State:** el estado de un lote en tablas se escribe como rótulo en versalitas de color (verde si activo, pizarra si cerrado), sin caja.

### Cards / Containers
- **Corner Style:** 6 px.
- **Background:** papel blanco sobre cuerpo blanco o gris de fondo.
- **Shadow Strategy:** mínima (ver Elevation & Depth).
- **Border:** filete de 1 px #dfe2e7.
- **Internal Padding:** 12, 16, 20 o 24 px según densidad.

### Inputs / Fields
- **Style:** borde de 1 px #c5cad3, fondo blanco, esquina de 5 px, relleno 8×12 px.
- **Focus:** anillo de 2 px en azul claro, sin contorno nativo.
- **Error:** texto y borde en la escala roja, fondo #fbf0ef.

### Navigation
- **Style:** barra tinta de 64 px con doble filete dorado de 4 px abajo. Marca a la izquierda: logo en oro claro, "Cultivos Loré" en Caslon 1.25rem y subtítulo en rótulo gris claro.
- **Pestañas:** rótulos en versalitas a toda la altura de la barra; inactiva en gris claro (#c5cad3), activa en blanco con subrayado oro claro de 2 px. Solo transición de color.
- **Mobile:** franja de pestañas bajo la barra, desplazable, mismo subrayado dorado.

### Firma
Nombre de quien registra en sans seminegrita sobre un filete de 1 px, alineado a la derecha de cada fase y de cada anotación; debajo, el cargo ("Registró", "Propuso", "Aprobó") en rótulo gris. A su lado, el hash abreviado en monoespaciada de 11 px sobre gris claro.

### Aviso de lote sellado
Bloque tinta de esquina 4 px con candado en oro claro, "Lote sellado" en Caslon 1.5rem y la línea de acta en rótulo oro ("SELLADO · fecha · CADENA ÍNTEGRA"). El texto de abajo lleva el doble filete dorado, que se traza de izquierda a derecha una sola vez al abrir (520 ms, curva de salida fuerte, 120 ms de retraso).

### Documentos PDF
Membrete con el logo, "Cultivos Loré" en Times 22 pt y subtítulo en Helvetica versalitas espaciadas, cerrado por el doble filete oro. Secciones con título en Times 13 pt sobre filete oro de 0.25 mm. Tablas planas en Helvetica 7.5 pt: cabecera tinta con texto blanco, filas alternas gris de fondo, divisor de 0.15 mm. Pie paginado con filete oro, referencia y "Página n de N". Times y Helvetica sustituyen a Libre Caslon y Public Sans.

### Movimiento
Pocas entradas, cortas y con propósito, con la curva de salida `cubic-bezier(0.23, 1, 0.32, 1)`: el velo de ventana aparece en 200 ms y la ventana sube desde 97 % en 240 ms; el cambio de pestaña es un fundido de 160 ms; el aviso inferior entra desde abajo en 300 ms. Con movimiento reducido se conservan los fundidos y se quitan los desplazamientos.

## Do's and Don'ts

### Do:
- **Do** usar fondo blanco puro (#ffffff) en cuerpo y tarjetas.
- **Do** declarar lo sellado con la línea de acta: doble filete oro y versalitas con fecha y estado de la cadena.
- **Do** firmar cada fase y anotación con el nombre en Public Sans 600 sobre filete de 1 px y el cargo en rótulo.
- **Do** usar Libre Caslon Text para títulos, marca y códigos, y `tabular-nums` en toda cifra de tabla.
- **Do** aplicar color a través de las escalas redefinidas en `src/index.css`, no con hex sueltos.
- **Do** conservar la distribución original de la información al cambiar cualquier estilo.

### Don't:
- **Don't** usar fondo hueso o crema.
- **Don't** dibujar un sello circular en relieve ni medallas o insignias para lo sellado.
- **Don't** poner las firmas en cursiva ni en serif.
- **Don't** añadir corona ni ornamento al logo.
- **Don't** usar verde para algo que no sea íntegro ni rojo para algo que no sea alteración o error.
- **Don't** usar degradados, vidrio esmerilado ni tarjetas con esquinas mayores de 8 px.
- **Don't** usar escalas de color fuera del sistema (violeta, naranja, púrpura).
