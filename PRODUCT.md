# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Administrador** (oficina, computador): configura estanques, usuarios y permisos por pestaña; supervisa todo.
- **Operadores de producción** (computador en oficina y celular junto a los estanques): crean lotes, registran fases (siembra, calidad de agua, alimentación, muestreos, mortalidad, cosecha), sellan lotes y proponen o aprueban anotaciones posteriores al cierre.
- **Operadores comerciales** (computador): crean y asignan órdenes de entrega a restaurantes, deciden saldos, emiten, anulan y corrigen comprobantes.
- **Repartidores** (celular, en ruta, a veces sin conexión): inician ruta, registran llegada, confirman entrega con foto obligatoria y reportan novedades.
- **Clientes y restaurantes** (celular, sin cuenta): escanean el QR del lote o del comprobante para consultar la trazabilidad.

Una misma persona puede tener varios roles y cambiar entre ellos con un clic.

## Product Purpose

Trazabilidad de la producción de tilapia roja de Cultivos Loré, desde la siembra hasta la entrega al restaurante. Cada fase del lote y cada comprobante de entrega quedan encadenados con hash SHA-256 (al estilo de un bloque de blockchain), de modo que cualquier alteración posterior se detecta y se señala. Éxito: el registro diario es rápido y sin errores, y un cliente puede verificar por sí mismo, desde el QR, que lo que recibe es lo que se produjo.

Es la plataforma de una tesis de pregrado y se usa con datos reales de la granja.

## Positioning

Lo sellado no se modifica: las correcciones se hacen con anotaciones encadenadas que aprueba otra persona, y la consulta pública muestra en rojo qué dato se alteró si alguien manipula el registro. La integridad es verificable por el cliente, no solo declarada.

## Operating Context

- Registro en campo junto a los estanques y entregas en ruta: celular, luz exterior, una mano, conexión intermitente (las acciones del repartidor se guardan en el teléfono y se envían después).
- Administración y comercial en computador de oficina.
- Documentos generados: certificado PDF del lote (historial de fases, anotaciones, verificación de cadena) y comprobante PDF de entrega encadenado; ambos con QR de consulta pública.
- Cantidades comerciales solo en kg; parámetros de agua con rangos (temperatura, oxígeno disuelto, pH, amonio, nitritos, Secchi).

## Capabilities and Constraints

- React 19 + TypeScript + Vite + Tailwind 4; Firebase (Auth, Firestore con base de datos con nombre) con reglas de seguridad estrictas; despliegue en Vercel; PDF con jsPDF.
- Pestañas visibles según permisos del usuario; botones sin permiso se ocultan.
- Mensajes al usuario neutrales: nunca mencionar Firestore/Firebase ni mostrar correos o UID en pantallas públicas o PDF; se muestran nombres visibles.
- Fotos de entrega privadas (nunca públicas) con vencimiento a 15 días.
- Terminología fija: "fases" (no eventos), "Comprobante N.º", "Anotación N.º", "sellado", "Administrador" (no "Maestro").

## Brand Commitments

- Nombre: "Cultivos Loré – Trazabilidad Tilapia Pro". No hay logo ni colores oficiales; no hay otras restricciones de identidad.
- Idioma: español de Colombia; fechas en hora de Colombia.

## Evidence on Hand

- Datos reales de lotes, órdenes y comprobantes en producción (no se inventan clientes, testimonios ni cifras).
- No hay fotografías de la granja ni del producto en el repositorio; no se deben fabricar.

## Product Principles

1. La integridad se ve: toda alteración se señala con claridad, sin alarmismo cuando todo está bien.
2. El registro en campo va primero: pocas pulsaciones, letra legible, funciona con una mano y con mala señal.
3. Nada se borra en silencio: anular, corregir y anotar dejan rastro con motivo y responsable.
4. Cada rol ve solo lo suyo y entiende qué le falta para continuar.

## Accessibility & Inclusion

Uso exterior en celular por personal de campo: contraste alto, objetivos táctiles grandes y textos claros sin jerga técnica.
