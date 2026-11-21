# Fase 1: referencia de commits de la auditoria (solo lectura)

Fecha de la verificacion: 2026-11-20. Repositorio en rama `correciones-claude`; `origin/main` es produccion.

## 1. Commits de la auditoria y commit de referencia

Commit de referencia (ultimo de diseño antes de la auditoria):

- `6e636e8` (2026-11-15) "Marcas de agua: vuelven a 30 grados y ya no se cortan al cruzar los encabezados tinta de las tablas"

Merge de main equivalente a ese estado:

- `daafa04` (2026-11-15) "Merge pull request #23 from carlosbs1579-ship-it/correciones-claude". Su segundo padre es `6e636e8`; su primer padre es `75a4007` (PR #22).

Primer commit de auditoria en la rama (despues de la referencia):

- `6572512` (2026-11-15) "Auditoria: reportes de los 5 agentes, reporte unificado y pruebas de integridad y seguridad"

Commits de auditoria en `origin/main` (de mas antiguo a mas reciente):

| Hash | Fecha | Mensaje |
|---|---|---|
| 6572512 | 2026-11-15 | Auditoria: reportes de los 5 agentes, reporte unificado y pruebas de integridad y seguridad |
| 492349c | 2026-11-16 | Auditoria tandas 1 y 2: integridad derivada de la cadena, sello en el QR, verificacion automatica de fotos y comprobantes, ventanas accesibles, topes de mortalidad y cosecha, fechas validas, acciones sin duplicar y cabeceras de seguridad |
| 3d35745 | 2026-11-16 | Reglas: el cierre y el lote activo solo tocan lo que escribe la app, comprobantes validados contra la orden, forma de hashes y fotos, creacion de lote, configuracion, alta propia y clientes |
| bc3bb20 | 2026-11-16 | Auditoria tanda 3: ventanas sin cierres accidentales, scroll por pestana, limite de errores con recarga, una sola pestana saliente, avisos fuera del contenedor animado; detalle del lote en carga diferida |
| fd6c220 | 2026-11-16 | Regresiones de la revision independiente: estanque con guion, foto con reloj desfasado, guardar solo estanques, nombre visible, CSV con negativos; scripts de prueba en produccion |
| eaccf0a | 2026-11-16 | Auditoria: estado final de los 69 hallazgos, despliegues y verificacion en produccion |
| 6d2224f | 2026-11-16 | Cabeceras: politica de seguridad de contenido que limita scripts, conexiones y marcos (H23) |
| 9e55330 | 2026-11-16 | Ordenes y comprobantes: cadena de hashes en el historial (H14), sellos de lotes y anotaciones en el comprobante (H18), hora del servidor (H19), comprobante publico sin direccion ni novedades (H42) |
| 39b6996 | 2026-11-16 | Lotes y anotaciones: registros nuevos sin correo en lo publico (H20), hora del servidor (H19), firma propia por uid (H45) |

Nota: el patron "Reglas:" tambien coincide con `3934296` (2026-11-14, "Reglas: no se resuelven anotaciones si el sello del lote cambio o la propuesta quedo desenlazada"). Es anterior a la auditoria y no forma parte de ella.

Commits de la rama posteriores a `origin/main` (no desplegados en main todavia, solo registro y estados): `30f1989`, `f14af5c`, `9e4e96c`, `54c7db0`, `3f95e18`, `20fd262`.

Merges de PR en `origin/main` posteriores a la referencia: #23 (`daafa04`), #24 (`bb792c4`), #25 (`8df82f4`), #26 (`d6cf67d`), #27 (`d328d52`), #28 (`3815528`).

## 2. Cambios de UI entre la referencia y origin/main

Comando: `git diff --stat 6e636e8 origin/main -- src index.html vercel.json public`

Total del rango (incluye tambien ts y servicios): 43 archivos, 3127 insertados, 941 eliminados.

`index.html`: sin cambios en el rango.

Archivos de UI tocados (lineas = insertadas + eliminadas), ordenados de mayor a menor:

| Archivo | Lineas | (+ / -) |
|---|---|---|
| src/components/EntregasPanel.tsx | 256 | 14 / 242 |
| src/App.tsx | 206 | 153 / 53 |
| src/components/PublicTraceabilityView.tsx | 159 | 134 / 25 |
| src/components/LoteDetailModal.tsx | 144 | 104 / 40 |
| src/components/ConsultaEntregaPublica.tsx | 141 | 111 / 30 |
| src/components/ConfiguracionTab.tsx | 127 | 96 / 31 |
| src/components/FotosEntregaOrden.tsx | 114 | 84 / 30 |
| src/components/DocumentacionEntrega.tsx | 87 | 80 / 7 |
| src/components/LimiteError.tsx (nuevo) | 84 | 84 / 0 |
| src/components/DetalleOrdenOperador.tsx | 67 | 53 / 14 |
| src/components/NuevoEventoModal.tsx | 58 | 53 / 5 |
| src/components/PersonaUi.tsx | 58 | 52 / 6 |
| src/components/IntegrityCheckModal.tsx | 49 | 41 / 8 |
| src/components/AvisoIntegridad.tsx (nuevo) | 48 | 48 / 0 |
| src/components/AnotacionesLotePanel.tsx | 34 | 27 / 7 |
| src/components/DashboardTab.tsx | 32 | 20 / 12 |
| src/components/LotesTab.tsx | 32 | 19 / 13 |
| src/components/DetalleEntregaRepartidor.tsx | 25 | 23 / 2 |
| src/components/NuevoLoteModal.tsx | 24 | 12 / 12 |
| src/index.css | 30 | 29 / 1 |
| src/components/AnaliticaTab.tsx | 20 | 14 / 6 |
| vercel.json | 17 | 17 / 0 |
| src/components/QrModal.tsx | 16 | 10 / 6 |
| src/components/AuthModal.tsx | 8 | 6 / 2 |
| src/components/NuevaOrdenModal.tsx | 8 | 5 / 3 |
| src/styles/motion.css | 1 | 1 / 0 |

Nota sobre el filtro: el pathspec `src/**/*.tsx` de git no coincide con `src/App.tsx` ni con `src/index.css` (el `**` exige un directorio intermedio). Por eso esos dos archivos se contaron aparte.

Archivos de UI no tocados: ninguno de `src/components/*.tsx` queda fuera de la lista anterior salvo los que no cambiaron en el rango.

## 3. Tags y respaldos

- `git tag`: no hay tags en el repositorio.
- `respaldos_despliegue/`: existe, con una unica subcarpeta: `2026-11-15_2310/`.

## 4. Cabeceras de seguridad (CSP)

- `vercel.json`, lineas 7-8: clave `Content-Security-Policy` dentro de `headers`. Es la unica definicion en el repositorio. Tambien se definen aqui `X-Frame-Options: DENY` (linea 10) y otras cabeceras.
- `index.html`: sin `Content-Security-Policy`.
- `firebase.json`: no existe en la raiz. Hay `firebase-applet-config.json` y `firebase-blueprint.json`, que no son cabeceras.
- `src/`: sin coincidencias.
- `.vercel/`: no existe en la raiz.
- `vercel.json` esta en la raiz y lo introduce el rango de auditoria (17 lineas insertadas en el rango 6e636e8..origin/main).
