# Resultados de las pruebas de alteración (generado)

Fecha: 2026-11-16T04:27:57.923Z · Lote: PRUEBA-MWIRIZ59-A-E1

| Ataque | Resultado | Avisos automáticos | Fallas al pulsar verificar | Lo que ve el público |
| --- | --- | --- | --- | --- |
| 1. Reemplazar la foto de entrega (campo datos) por otra imagen | detectado sin aviso | ninguno | Botón "Verificar foto": "La foto no coincide con el hash registrado." | {"mostrada":"data:image/jpeg;base64,/9j/4AAQSkZJRgABA…","hashDoc":"d1da3e6695f6","hashEvento":"d1da3e6695f6"} |
| 2. Cambiar un carácter del base64 de la foto | detectado sin aviso | ninguno | Botón "Verificar foto": "La foto no coincide con el hash registrado." | {"mostrada":"data:image/jpeg;base64,/9j/4AAQSkZJRgABA…","hashDoc":"d1da3e6695f6","hashEvento":"d1da3e6695f6"} |
| 3. Cambiar datos y hash de la foto a la vez (sin tocar el evento de la orden) | detectado sin aviso | ninguno | Botón "Verificar foto": "La foto no coincide con el hash registrado." | {"mostrada":"data:image/jpeg;base64,/9j/4AAQSkZJRgABA…","hashDoc":"a46d5db29343","hashEvento":"d1da3e6695f6"} |
| 3b. Cambiar datos y hash de la foto y también el hash en el evento "Entrega" de la orden | detectado sin aviso | ninguno | Botón "Verificar" del comprobante N.º 1 (interno): Verificación fallida: los eventos de la orden no coinciden con los usados. | {"mostrada":"data:image/jpeg;base64,/9j/4AAQSkZJRgABA…","hashDoc":"a46d5db29343","hashEvento":"a46d5db29343"} |
| 4. Alterar un dato de una fase intermedia (Alimentación: 120 kg -> 80 kg) | detectado y avisado | QR lote: fases en rojo (Fase #2 (Alimentación) alterada. Dato(s) modificado(s): Alimento (kg).) | Botón "Verificar integridad" / IntegrityCheckModal: Alteración detectada en la fase #2 (Alimentación): sus datos fueron modificados después del registro. | {"estanque":"E1","fechaSiembra":"2026-08-01","fechaCierre":"2026-11-15","producto":"Tilapia roja entera fresca","cantidadSembrada":1000,"supervivencia":98,"pesoPromedioActualG":480,"biomasaEstimadaKg":38.4,"hashFinal":"72923ae4d097365653187297a53e15872733aa523f96e97f215eb56a400e6592","fases":6,"alimentoFase2":80,"anotacionesValidas":1} |
| 5. Alterar el hash guardado de un evento intermedio (fase #2) | detectado y avisado | QR lote: fases en rojo (Fase #2 (Alimentación) alterada: sus datos cambiaron después del registro (quien la cambió también modificó el rastro). | Fase #3 (Muestreo de crecimiento (biometría)): no enlaza con la fase anterior (la cadena se rompió aquí).) | Botón "Verificar integridad" / IntegrityCheckModal: Alteración detectada en la fase #2 (Alimentación): sus datos fueron modificados después del registro. | {"estanque":"E1","fechaSiembra":"2026-08-01","fechaCierre":"2026-11-15","producto":"Tilapia roja entera fresca","cantidadSembrada":1000,"supervivencia":98,"pesoPromedioActualG":480,"biomasaEstimadaKg":38.4,"hashFinal":"72923ae4d097365653187297a53e15872733aa523f96e97f215eb56a400e6592","fases":6,"alimentoFase2":120,"anotacionesValidas":1} |
| 6. Alterar la fase #2 y recalcular toda la cadena, huellas y resumen.hashFinal | detectado y avisado | QR lote, sección anotaciones: El sello del lote cambió después de anotar: las anotaciones ya no corresponden a este registro sellado. | ninguna | {"estanque":"E1","fechaSiembra":"2026-08-01","fechaCierre":"2026-11-15","producto":"Tilapia roja entera fresca","cantidadSembrada":1000,"supervivencia":98,"pesoPromedioActualG":480,"biomasaEstimadaKg":38.4,"hashFinal":"361618b10d3bc1d8704cbba043fa5e9a2f96d8c930b9a21b1508342a564ae754","fases":6,"alimentoFase2":80,"anotacionesValidas":0} |
| 6b. Igual que 6 y además recalcular la cadena de anotaciones (nueva ancla) | NO DETECTADO | ninguno | ninguna | {"estanque":"E1","fechaSiembra":"2026-08-01","fechaCierre":"2026-11-15","producto":"Tilapia roja entera fresca","cantidadSembrada":1000,"supervivencia":98,"pesoPromedioActualG":480,"biomasaEstimadaKg":38.4,"hashFinal":"361618b10d3bc1d8704cbba043fa5e9a2f96d8c930b9a21b1508342a564ae754","fases":6,"alimentoFase2":80,"anotacionesValidas":1} |
| 6c. Igual que 6 y borrar el documento de anotaciones | NO DETECTADO | ninguno | ninguna | {"estanque":"E1","fechaSiembra":"2026-08-01","fechaCierre":"2026-11-15","producto":"Tilapia roja entera fresca","cantidadSembrada":1000,"supervivencia":98,"pesoPromedioActualG":480,"biomasaEstimadaKg":38.4,"hashFinal":"361618b10d3bc1d8704cbba043fa5e9a2f96d8c930b9a21b1508342a564ae754","fases":6,"alimentoFase2":80,"anotacionesValidas":0} |
| 7. Editar la cabecera del lote mostrada al público (estanque, siembra, producto, peces, supervivencia, peso, biomasa) | NO DETECTADO | ninguno | ninguna | {"estanque":"E9","fechaSiembra":"2026-01-01","fechaCierre":"2026-11-15","producto":"Tilapia roja orgánica certificada","cantidadSembrada":5000,"supervivencia":99.9,"pesoPromedioActualG":900,"biomasaEstimadaKg":4500,"hashFinal":"72923ae4d097365653187297a53e15872733aa523f96e97f215eb56a400e6592","fases":6,"alimentoFase2":120,"anotacionesValidas":1} |
| 8. Borrar el último evento (Cosecha) sin tocar el sello | detectado y avisado | QR lote, sección anotaciones: El sello del lote cambió después de anotar: las anotaciones ya no corresponden a este registro sellado. | Botón "Verificar integridad" / IntegrityCheckModal: El sello de cierre registrado (72923ae4d097…) no coincide con el último hash de la cadena (9a2a1ac9c1b5…): la cadena fue reescrita. | {"estanque":"E1","fechaSiembra":"2026-08-01","fechaCierre":"2026-11-15","producto":"Tilapia roja entera fresca","cantidadSembrada":1000,"supervivencia":98,"pesoPromedioActualG":480,"biomasaEstimadaKg":38.4,"hashFinal":"72923ae4d097365653187297a53e15872733aa523f96e97f215eb56a400e6592","fases":5,"alimentoFase2":120,"anotacionesValidas":0} |
| 8b. Borrar el último evento y actualizar resumen.hashFinal | detectado y avisado | QR lote, sección anotaciones: El sello del lote cambió después de anotar: las anotaciones ya no corresponden a este registro sellado. | ninguna | {"estanque":"E1","fechaSiembra":"2026-08-01","fechaCierre":"2026-11-15","producto":"Tilapia roja entera fresca","cantidadSembrada":1000,"supervivencia":98,"pesoPromedioActualG":480,"biomasaEstimadaKg":38.4,"hashFinal":"9a2a1ac9c1b54d9cc2eab1c2cceb42f6908b85b1939d6aafa91aaa90d67bc168","fases":5,"alimentoFase2":120,"anotacionesValidas":0} |
| 8c. Borrar el último evento, actualizar hashFinal y recalcular las anotaciones | NO DETECTADO | ninguno | ninguna | {"estanque":"E1","fechaSiembra":"2026-08-01","fechaCierre":"2026-11-15","producto":"Tilapia roja entera fresca","cantidadSembrada":1000,"supervivencia":98,"pesoPromedioActualG":480,"biomasaEstimadaKg":38.4,"hashFinal":"9a2a1ac9c1b54d9cc2eab1c2cceb42f6908b85b1939d6aafa91aaa90d67bc168","fases":5,"alimentoFase2":120,"anotacionesValidas":1} |
| 9a. Alterar la cantidad entregada del comprobante (sin recalcular) | detectado y avisado | QR entrega, comprobante N.º 1: Verificación fallida: el contenido no corresponde a su hash. | Botón "Verificar" del comprobante N.º 1 (interno): Verificación fallida: el contenido no corresponde a su hash. | {"cantidadEntregada":80,"cliente":"PRUEBA-Restaurante Integridad","vigente":"N.º 1","versionesIndice":1,"bloquesLeidos":1} |
| 9b. Alterar el comprobante y recalcular su hashComprobante | detectado y avisado | QR entrega, comprobante N.º 1: Verificación fallida: el índice de consulta registra otro hash. | ninguna | {"cantidadEntregada":80,"cliente":"PRUEBA-Restaurante Integridad","vigente":"N.º 1","versionesIndice":1,"bloquesLeidos":1} |
| 9c. Alterar el comprobante, recalcular su hash y actualizar consultasEntrega | NO DETECTADO | ninguno | ninguna | {"cantidadEntregada":80,"cliente":"PRUEBA-Otro cliente","vigente":"N.º 1","versionesIndice":1,"bloquesLeidos":1} |
| 9d. Alterar solo el hash del índice consultasEntrega | detectado y avisado | QR entrega, comprobante N.º 1: Verificación fallida: el índice de consulta registra otro hash. | ninguna | {"cantidadEntregada":50,"cliente":"PRUEBA-Restaurante Integridad","vigente":"N.º 1","versionesIndice":1,"bloquesLeidos":1} |
| 9e. Borrar el comprobante (el índice sigue apuntándolo) | detectado y avisado | QR entrega: "No se encontró ninguna entrega con este código."<br>Panel interno de la orden: "Cadena incompleta: el historial registra 1, existen 0" | ninguna | sin datos |
| 10. Borrar la foto de entrega antes de su vencimiento | NO DETECTADO | ninguno | ninguna | {"mostrada":"La imagen ya no está disponible (se conserva 15 días). Queda el registro de la foto en el historial."} |
| A1. Alterar el valor correcto de la anotación aprobada | detectado y avisado | QR lote, sección anotaciones: La anotación N.º 1 (propuesta) fue alterada después de guardarse. | ninguna | {"estanque":"E1","fechaSiembra":"2026-08-01","fechaCierre":"2026-11-15","producto":"Tilapia roja entera fresca","cantidadSembrada":1000,"supervivencia":98,"pesoPromedioActualG":480,"biomasaEstimadaKg":38.4,"hashFinal":"72923ae4d097365653187297a53e15872733aa523f96e97f215eb56a400e6592","fases":6,"alimentoFase2":120,"anotacionesValidas":0} |
| A2. Alterar la anotación y recalcular la cadena de anotaciones | NO DETECTADO | ninguno | ninguna | {"estanque":"E1","fechaSiembra":"2026-08-01","fechaCierre":"2026-11-15","producto":"Tilapia roja entera fresca","cantidadSembrada":1000,"supervivencia":98,"pesoPromedioActualG":480,"biomasaEstimadaKg":38.4,"hashFinal":"72923ae4d097365653187297a53e15872733aa523f96e97f215eb56a400e6592","fases":6,"alimentoFase2":120,"anotacionesValidas":1} |
| 9f. Borrar el bloque de anulación de un comprobante anulado | detectado y avisado | Panel interno de la orden: "Cadena incompleta: el historial registra 2, existen 1" | ninguna | {"cantidadEntregada":50,"cliente":"PRUEBA-Restaurante Integridad","vigente":"N.º 1","versionesIndice":2,"bloquesLeidos":1} |

## 11. Parámetros de la URL

| Parámetro | Resultado |
| --- | --- |
| `?lote=NOEXISTE-20991231-Z-E9` | "Lote no disponible": El lote "NOEXISTE-20991231-Z-E9" no se encuentra registrado (texto escapado por React) |
| `?lote=prueba-mwiriz59-a-e1` | muestra el lote PRUEBA-MWIRIZ59-A-E1 |
| `?lote=%3Cscript%3Ealert(1)%3C%2Fscript%3E` | error (Invalid document reference. Document references must have an even number of segm): "No fue posible consultar el servidor en este momento" |
| `?lote=PRUEBA'%20OR%20'1'%3D'1` | "Lote no disponible": El lote "PRUEBA' OR '1'='1" no se encuentra registrado (texto escapado por React) |
| `?lote=..%2Fusuarios%2Fx` | error (Document name "projects/iron-outpost-cw2pc/databases/ai-studio-33039dd2-b725-497): "No fue posible consultar el servidor en este momento" |
| `?lote=a%2Fb%2Fc` | permission-denied: "El servidor de trazabilidad no permitió la lectura pública" |
| `?lote=a%2Fb` | error (Invalid document reference. Document references must have an even number of segm): "No fue posible consultar el servidor en este momento" |
| `?lote=__nombre__` | error (Resource id "__nombre__" is invalid because it is reserved.): "No fue posible consultar el servidor en este momento" |
| `?lote=%25` | EXCEPCIÓN fuera del try (URIError): cargarLote() rechaza, setCargando(false) nunca corre: esqueleto de carga infinito |
| `?lote=%25E0%25A4%25A` | EXCEPCIÓN fuera del try (URIError): cargarLote() rechaza, setCargando(false) nunca corre: esqueleto de carga infinito |
| `?lote=AAAAAAAAAAAAAAAAAAAA…(1600 caracteres)` | "Lote no disponible": El lote "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA…" no se encuentra registrado (texto escapado por React) |
| `?entrega=c0000000000000000000000000000000000000000` | "No se encontró ninguna entrega con este código." |
| `?entrega=cFALSO` | "No se encontró ninguna entrega con este código." |
| `?entrega=a%2Fb` | "No se pudo consultar la entrega. Intente de nuevo." (invalid-argument) |
| `?entrega=__x__` | "No se pudo consultar la entrega. Intente de nuevo." (invalid-argument) |
| `?entrega=%3Cimg%20src%3Dx%3E` | "No se encontró ninguna entrega con este código." |
| `?entrega=(token real)` | muestra la entrega PED-20261115-5QL46 |

## 12. Alteraciones como usuario autenticado (con reglas)

| Usuario | Intento | Resultado |
| --- | --- | --- |
| operador-prueba@prueba.co | Lote cerrado: alterar dato de la fase #2 | bloqueado (permission-denied) |
| operador-prueba@prueba.co | Lote cerrado: cambiar estanque y peces sembrados | bloqueado (permission-denied) |
| operador-prueba@prueba.co | Lote cerrado: cambiar resumen.supervivencia | bloqueado (permission-denied) |
| operador-prueba@prueba.co | Lote cerrado: borrarlo | bloqueado (permission-denied) |
| repartidor-prueba@prueba.co | Foto: reemplazar datos | bloqueado (permission-denied) |
| repartidor-prueba@prueba.co | Foto: borrarla | bloqueado (permission-denied) |
| vendedor-prueba@prueba.co | Foto: reemplazar datos (operador de pedidos) | bloqueado (permission-denied) |
| vendedor-prueba@prueba.co | Comprobante: alterar cantidad | bloqueado (permission-denied) |
| vendedor-prueba@prueba.co | Comprobante: borrarlo | bloqueado (permission-denied) |
| vendedor-prueba@prueba.co | consultasEntrega: cambiar el hash registrado | bloqueado (permission-denied) |
| vendedor-prueba@prueba.co | consultasEntrega: borrarla | bloqueado (permission-denied) |
| vendedor-prueba@prueba.co | Orden: cambiar el hash de la foto en el historial | bloqueado (permission-denied) |
| repartidor-prueba@prueba.co | Orden: cambiar el hash de la foto en el historial (repartidor) | bloqueado (permission-denied) |
| anota-a@prueba.co | Anotación: alterar el valor correcto | bloqueado (permission-denied) |
| anota-a@prueba.co | Anotación: borrar el documento | bloqueado (permission-denied) |
| anónimo | Anónimo: alterar el lote | bloqueado (permission-denied) |
| anónimo | Anónimo: crear un lote falso | bloqueado (permission-denied) |
| intruso@prueba.co | Operador sin permisos: crear un lote | bloqueado (permission-denied) |
| intruso@prueba.co | Operador sin permisos: leer la foto | bloqueado (permission-denied) |
| anónimo | Anónimo: leer la foto | bloqueado (permission-denied) |
| operador-prueba@prueba.co | Lote ACTIVO: cambiar resumen (supervivencia 99.9, peso 900 g, biomasa 4500 kg) sin registrar ningún evento | PERMITIDO |
| operador-prueba@prueba.co | Lote ACTIVO: cambiar producto y origen sin evento | bloqueado (permission-denied) |
| operador-prueba@prueba.co | CIERRE: sellar el lote cambiando a la vez estanque, peces sembrados, producto, origen y fecha de cierre | PERMITIDO |
| (verificación) | Lote PRUEBA-MWIRIZ59-B-E2 tras el cierre manipulado: estado=cerrado, estanque=E9, cantidadSembrada=99999, producto="Tilapia orgánica certificada", supervivencia=99.9 | verificarIntegridadLote: ÍNTEGRO · analizarCadenaLote: ÍNTEGRO |
