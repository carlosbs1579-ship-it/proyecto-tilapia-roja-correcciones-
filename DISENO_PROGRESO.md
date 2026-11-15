# Progreso: diseño visual, microinteracciones y animaciones

Rama de trabajo: `correciones-claude` (no se pasa a main hasta que el usuario lo pida).
Sistema visual vigente: `DESIGN.md` (paleta tinta, verde solo íntegro, oro viejo para acta, rojo solo alteración). No se agregan colores.

## Estado de fases

- [x] Fase 0. Lectura y sistema de movimiento
- [x] Fase 1. Revisión con agentes en paralelo (A apertura, B pestañas, C referencias, D móvil/accesibilidad) y plan priorizado
- [x] Fase 2. Limpieza visual (emojis, "(2)", comparativo de estanques, rayas largas)
- [x] Fase 3. Animaciones de apertura y esqueletos
- [x] Fase 4. Pestañas
- [x] Fase 5. Personal y permisos
- [ ] Fase 6. Pantalla de inicio de sesión
- [ ] Fase 7. Pulido general
- [ ] Verificación final

## Hallazgos de la fase 0

- Stack: React 19 + Vite 8 + Tailwind 4 (tokens en `src/index.css` con `@theme`), íconos `lucide-react`, animación: `motion` 12 ya instalado (no se usaba).
- Animaciones previas: CSS `@starting-style` en `src/index.css` (velo, ventana, pestaña, aviso, trazo de acta). Se pasan a los tokens nuevos.
- Emojis encontrados: ConfiguracionTab (➕), UsuariosTab (🟢🟡🔴, ✓ ✗), LoteDetailModal y PublicTraceabilityView (✓ ⚠), flechas → en seguimientoService.
- Rayas largas (—) en texto visible: 47 apariciones; se reemplazan.

## Fase 0 hecha

- `src/styles/motion.css` (variables CSS) y `src/lib/motion.ts` (mismos valores para `motion`: DURACION, CURVA, RESORTE 400/35, DISTANCIA, ESCALON 40 ms máx 8, variantes de pantalla, fila y menú).
- `src/index.css` importa los tokens; velo 200 ms, ventana escala 0,96 a 1 en 320 ms, pantallas 12 px en 320 ms, hoja inferior en celular, fundido en movimiento reducido.

## Resumen de la fase 1

- A (apertura): no hay salidas en ventanas (desaparecen de golpe); `lotesCargando` no llega a Inicio/Lotes/Analítica (se ve el vacío y luego salta); "Cargando..." de texto en Suspense, Pedidos, Repartidor, Entregas, Usuarios y consulta pública (spinner de 48 px); listas sin escalonado; avisos que empujan el contenido.
- B (pestañas): el subrayado salta (border-b por botón); en el celular la activa no se lleva a la vista y no hay respuesta al toque; solo 2 de 7 pestañas tienen ícono; "Personal & Permisos" en móvil; subpestañas de Entregas con contadores que cambian el ancho y se parten en varias líneas; filtros del repartidor con "(n)"; filtros de la línea de tiempo del lote sin desplazamiento horizontal; `<main key>` remonta y pierde el scroll. Propone un componente común `Pestanas` con layoutId.
- C (referencias, enlaces verificados): Vercel Geist Tabs https://vercel.com/geist/tabs ; Radix Tabs https://www.radix-ui.com/primitives/docs/components/tabs ; Vercel roles y permisos https://vercel.com/docs/rbac/access-roles ; GitHub roles de organización https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization ; Linear miembros https://linear.app/docs/invite-members ; Stripe Apps diseño https://docs.stripe.com/stripe-apps/design . Mobbin dio 403; las medidas en px son convención, no medición.
- D (móvil y accesibilidad): texto slate-400 sobre blanco no cumple AA; áreas táctiles de 22 a 28 px (selector de función, salir, íconos de Configuración, anotaciones, PDF); spinners sin reducción de movimiento; `transition-all`; filas de tabla con onClick sin teclado; Lotes sin paginar; ventanas sin role="dialog"; visor de foto sin botón de cerrar.

## Plan priorizado

1. Fase 2 limpieza: "+" con ícono en Añadir estanque; pestañas sin números ni emojis (Entregas); título "Estanques y piscinas" sin "(2)" con subtítulo de conteo; comparativo con selector de estanques y nombres reales; quitar emojis (Usuarios, avisos con ✓ ⚠, flechas →); rayas largas fuera del texto visible.
2. Fase 3: componente de esqueleto (pulso de opacidad) en Inicio, Lotes, Analítica, Entregas, Repartidor, Usuarios, consulta pública y Suspense; pasar `lotesCargando`; listas escalonadas solo al montar; salidas de ventanas en 180 ms (hook de presencia) donde las props se conservan.
3. Fase 4: indicador deslizante (layoutId + resorte) en la barra principal, móvil con desvanecido de borde y la activa llevada a la vista; subpestañas de Entregas y filtros con el mismo indicador; contenido con fundido y 8 px según la dirección; altura mínima para que no salte.
4. Fase 5: Personal y permisos rediseñado (avatar de iniciales, menú de tres puntos, interruptores agrupados, filas que entran y se colapsan, toast de 3 s, guardar con carga interna).
5. Fase 6: pantalla de inicio de sesión propia (dos columnas, control segmentado Operador/Repartidor con la lógica de funciones existente, campos con etiqueta, temblor de error, mostrar contraseña, pantalla breve con logo mientras se verifica la sesión).
6. Fase 7: contraste (slate-400 a slate-500 sobre fondo claro), áreas táctiles de 44 px en controles clave, spinners y pulsos en reducido, `transition-all` a propiedades concretas, filas de tabla accesibles con teclado, escala tipográfica (11 px pasa a 12 px), estados vacíos con acción.

## Conflictos con cambios previos

(ninguno por ahora)

## Fase 2 hecha

- Configuración: "Añadir estanque o piscina" con ícono "+" de línea (lucide Plus, 16 px); título "Estanques y piscinas de cultivo" sin "(2)" y debajo "N estanques registrados".
- Entregas: subpestañas sin contadores; todas con ícono de línea de 16 px y trazo 1,75; "Disponibilidad por lote" pasa a "Disponibilidad".
- Repartidor: filtros sin "(n)" (el número queda solo para lectores de pantalla).
- Barra: sin los dos íconos sueltos; "Personal" igual en móvil y escritorio.
- Analítica: nuevo `ComparativoEstanques.tsx` con nombres reales, selector de estanques (mínimo 1), tabla en escritorio y bloques apilados en el celular.
- Emojis y glifos quitados (Usuarios, avisos del lote, consulta pública, flechas del historial pasan a "a").
- Rayas largas: vacíos dicen "Sin dato" y separadores pasan a "·".

## Conflictos con cambios previos

- El nombre de empresa "Cultivos Loré — Tilapia Pro" está guardado dentro de los comprobantes encadenados (forma parte del contenido con hash). No se cambia el dato; solo se muestra con "·" en la consulta pública y en el pie del PDF.
- Las correcciones de siembra ya registradas guardan su texto con "—" y "→" (lotesService). Es dato encadenado: no se modifica.

## Fases 3 y 4 hechas

- `src/components/Esqueleto.tsx`: esqueletos (tabla, indicadores, tarjetas, pantalla) con reflejo de 1,5 s (solo transform). Usados en Suspense, Inicio, Lotes, Analítica (mientras `lotesCargando`), Entregas, panel de entregas, Repartidor, Personal y las consultas públicas del lote y de la entrega.
- `src/lib/presencia.ts`: `usePresencia` (salida de 180 ms con `data-saliendo`) en AuthModal, QrModal, IntegrityCheckModal, NuevoLoteModal, NuevoEventoModal, NuevaOrdenModal y LoteDetailModal; `useConservar` mantiene el lote mientras se cierra su ventana. Ventanas con role="dialog" y aria-modal.
- Celular: las ventanas son hojas que suben desde abajo.
- `src/lib/montaje.ts`: filas y tarjetas escalonadas (40 ms, 8 px, máximo 8) solo la primera vez que llegan los datos (Inicio, Lotes, Entregas, Repartidor). Filas de lotes accesibles con teclado.
- `src/components/Pestanas.tsx`: indicador compartido con layoutId y resorte 400/35; respuesta al toque 0,97; color en 150 ms; desvanecido de borde y la activa se lleva a la vista. Usado en la barra (escritorio y móvil), subpestañas de Entregas, filtros del repartidor y filtros de la línea de tiempo del lote. Selector de función con el mismo indicador.
- `App.tsx`: el contenido de pestaña sale con fundido de 150 ms y entra con fundido y 8 px según la dirección (AnimatePresence popLayout); scroll guardado por pestaña; altura mínima de 60vh para que no salte.
- `vite.config.ts`: motion en su propio archivo (evita el aviso nuevo de paquete mayor a 500 kB).

## Fase 5 hecha

- `src/components/PersonaUi.tsx`: `Interruptor` (role="switch", círculo en 200 ms), `AvatarIniciales` (iniciales con tonos claros de la paleta, estables por persona) y `MenuTresPuntos` (escala y opacidad desde la esquina, cierra al tocar fuera o con Escape).
- Personal y permisos: encabezado con el conteo en una frase y aviso de cuentas pendientes; búsqueda y filtro por estado con el indicador común; lista de filas (avatar, nombre en peso medio, función como etiqueta discreta, correo secundario, estado en texto de color); acciones en el menú (editar, aprobar, desactivar, eliminar); detalle desplegable con nombre visible, funciones con interruptor y cargo, permisos agrupados por pestaña con interruptores y rótulos en versalitas, plantillas y botón de guardar con carga interna sin cambiar de tamaño.
- Filas que entran desde arriba con fundido y salen encogiéndose (layout de motion); aviso inferior de 3 s; estado vacío con texto útil y acción "Ver a todos".
- Toda la lógica (guardar, estados, roles, permisos, plantillas, eliminar, reglas de quién edita a quién) se conserva.
- No hecho: la matriz rol por permiso en escritorio (alternativa opcional); se mantuvieron los interruptores por persona.
