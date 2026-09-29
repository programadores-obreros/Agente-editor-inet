# Phase 2 Slice 1 — plan de tests vs. lo implementado

Este documento cruza el plan de aceptación de ARCH-D (`.../scratchpad/phase2/ARCH-D/INFORME.md`,
12 temas, read-only, escrito ANTES de que existiera el composition root) contra los
tests reales que terminaron implementándose. Los nombres de archivo/función que
propuso ARCH-D eran `SUPUESTO` (placeholders); los writers los resolvieron con
nombres propios durante la implementación — esta tabla documenta la correspondencia
final, no reescribe el plan original.

Convención de estado: **GREEN** = pasa hoy en `pnpm test` (HEAD `4348c30`, 1100/1100).
No hay ningún tema en RED ni pendiente al cierre de P2-T13.

## 1. Los 12 temas de ARCH-D contra la implementación real

| Tema (ARCH-D) | Test real (archivo::nombre) | Estado |
|---|---|---|
| 1. E3-04b: superficie sin `Almacen` | `tests/phase2-composicion-raiz.test.mjs::(a) composicion-raiz.ts exporta EXACTAMENTE obtenerServicioDeProyecto...` | GREEN |
| 1. E3-04b: superficie sin `Almacen` | `tests/phase2-composicion-raiz.test.mjs::(b) el servicio devuelto tiene EXACTAMENTE snapshot/aplicar/aplicarTransaccion/proponer/suscribir/cerrar...` | GREEN |
| 1. E3-04b: guardia estructural (grep) | `tests/phase2-composicion-raiz.test.mjs::(c) HOY, en el repo real: 0 archivos de produccion... importan almacen.ts o referencian crearAlmacen` | GREEN |
| 1. E3-04b: guardia estructural (control positivo) | `tests/phase2-composicion-raiz.test.mjs::(c) el guardia SI detecta la trampa...` | GREEN |
| 2. Engine singleton por proyecto | `tests/phase2-composicion-raiz.test.mjs::(d) dos llamadas con el MISMO (directorio, idProyecto) devuelven el MISMO servicio...` | GREEN |
| 2. Engine singleton por proyecto | `tests/phase2-composicion-raiz.test.mjs::(d) ids de proyecto DISTINTOS, mismo directorio, dan servicios DISTINTOS` | GREEN |
| 2. Engine singleton por proyecto | `tests/phase2-composicion-raiz.test.mjs::(d) operacion aplicada por UN handle es visible por el OTRO con la misma revision...` | GREEN |
| 3. `baseRevision`: N → N+1, canónico/persistido/snapshot en Y | `tests/phase2-motor-gpio.test.mjs::AsignarPin(anodo -> Y) con baseRevision N: ok, revision N+1, canonico en Y, persistido en Y, snapshot en Y` | GREEN |
| 4. Conflicto stale (A/B sobre el mismo handle) | `tests/phase2-conflicto.test.mjs::commit de B en N vence a A con baseRevision stale — sin sobrescribir; A re-fetch ve N+1 y reintenta ok` | GREEN |
| 5. Path A: blocking representable persistido/editable | `tests/phase2-paths.test.mjs::Path A: un segundo LED al MISMO pin queda blocking representable — commitea, persiste, el snapshot muestra el motivo, y sigue siendo editable` | GREEN |
| 5. Path A: en la capa de vista (motivo en la entidad correcta) | `tests/phase2-vista-fisica.test.mjs::Path A (REQUISITO_INSATISFECHO, LED sin resistencia en serie): el motivo blocking aparece en la ENTIDAD correcta y la vista se sigue proyectando completa` | GREEN |
| 6. Path B: rechazo estructural sin tocar nada | `tests/phase2-paths.test.mjs::Path B: AsignarPin sobre un componente INEXISTENTE rechaza — snapshot igual, disco byte-a-byte igual, revision igual` | GREEN |
| 6. Path B: sobre malformado | `tests/phase2-paths.test.mjs::Path B: un sobre malformado (baseRevision con tipo invalido) rechaza — snapshot igual, disco byte-a-byte igual, revision igual` | GREEN |
| 7. Reload: instancia nueva sobre el mismo directorio | `tests/phase2-reload.test.mjs::cerrar() + obtenerServicioDeProyecto de nuevo sobre el mismo directorio: mismo GPIO, misma revision, mismo snapshot` | GREEN |
| 7. Reload: sin cerrar, sigue siendo el singleton existente | `tests/phase2-reload.test.mjs::SIN cerrar() primero, obtenerServicioDeProyecto sobre el mismo (directorio, idProyecto) sigue devolviendo el singleton EXISTENTE (no relee disco)` | GREEN |
| 8. Invariante visual: sólo cambia lo tocado | `tests/phase2-motor-gpio.test.mjs::invariante visual: cambiar el GPIO del LED cambia SOLO la asignacion de ese pin, la revision y los efectos derivados explicitos — diff semantico de la IR` | GREEN |
| 8. Invariante visual: notificación exacta | `tests/phase2-motor-gpio.test.mjs::la notificacion de suscribir se dispara EXACTAMENTE una vez con {revision: N+1}` | GREEN |
| 8. Invariante visual: dry-run/rechazo nunca notifican | `tests/phase2-motor-gpio.test.mjs::un RECHAZO o un DRY-RUN (proponer) NUNCA notifican` | GREEN |
| 9. Assets offline (HTML/JS propio, sin URL remota) | `tests/phase2-assets-offline.test.mjs::index.html/app.js/pintar.js/plan-de-pintado.js no referencian NINGUNA URL remota...` | GREEN |
| 9. Assets offline (bundle Wokwi de terceros, evidencia) | `tests/phase2-assets-offline.test.mjs::wokwi-bundle.js: ninguna URL clasifica como CARGA REAL — evidencia: 72 URLs inertes...` | GREEN |
| 9. Assets offline (componentes-extra.js, evidencia) | `tests/phase2-assets-offline.test.mjs::componentes-extra.js: ninguna URL clasifica como CARGA REAL...` | GREEN |
| 9. Assets offline (control positivo del clasificador) | `tests/phase2-assets-offline.test.mjs::el clasificador SI distingue carga real de inerte — fixtures descartables...` | GREEN |
| 10. Snapshot: forma completa | `tests/phase2-snapshot.test.mjs::snapshot contiene idProyecto, revision, catalogoVersion, catalogoHash, proyecto y validacion (motivos + readiness)` | GREEN |
| 10. Snapshot: JSON plano round-trip | `tests/phase2-snapshot.test.mjs::snapshot es JSON plano: JSON.parse(JSON.stringify(s)) da deepEqual a s` | GREEN |
| 10. Snapshot: determinismo entre lecturas | `tests/phase2-snapshot.test.mjs::snapshot es determinista: dos lecturas consecutivas SIN ninguna operacion en el medio dan el mismo JSON` | GREEN |
| 10. Snapshot: mutar no contamina el canónico | `tests/phase2-snapshot.test.mjs::mutar el snapshot devuelto NO cambia el canonico ni el PROXIMO snapshot` | GREEN |
| 11. Transporte: snapshot GET | `tests/phase2-transporte-http.test.mjs::GET /api/proyecto da 200 y el JSON trae revision y vista` | GREEN |
| 11. Transporte: POST aceptado | `tests/phase2-transporte-http.test.mjs::POST /api/operaciones con base N: ok, revision N+1, y el GET posterior muestra el pin nuevo` | GREEN |
| 11. Transporte: actor forzado | `tests/phase2-transporte-http.test.mjs::POST /api/operaciones fuerza actor:'navegador'...` | GREEN |
| 11. Transporte: stale | `tests/phase2-transporte-http.test.mjs::POST /api/operaciones con base vieja da BASE_REVISION_DESACTUALIZADA, sin cambios` | GREEN |
| 11. Transporte: JSON inválido → 400 | `tests/phase2-transporte-http.test.mjs::POST /api/operaciones con JSON invalido da 400, sin cambios en disco` | GREEN |
| 11. Transporte: forma inválida → 200 con rechazo estructurado | `tests/phase2-transporte-http.test.mjs::POST /api/operaciones con forma invalida (JSON valido, sobre incorrecto) da 200 con rechazo ESTRUCTURADO, sin cambios` | GREEN |
| 11. Transporte: cuerpo > límite → 400 | `tests/phase2-transporte-http.test.mjs::POST /api/operaciones con cuerpo mas grande que el limite da 400, sin cambios` | GREEN |
| 11. Transporte: SSE, un evento por commit | `tests/phase2-transporte-http.test.mjs::SSE: un POST aceptado produce EXACTAMENTE un evento revision N+1; un rechazo intercalado no inserta ninguno` | GREEN |
| 11. Transporte: Host inválido/válido | `tests/phase2-transporte-http.test.mjs::Host invalido (anti DNS-rebinding) da 403` / `...Host 'localhost:<puerto>' SI se acepta...` | GREEN |
| 11. Transporte: página + assets + lista blanca + traversal + 404/405 | `tests/phase2-transporte-http.test.mjs::GET / sirve la pagina...`, `...GET / referencia un asset de la lista blanca que define <wokwi-esp32-devkit-v1>/<wokwi-led>...`, `...GET /assets/<nombre-en-la-lista-blanca> sirve el asset...`, `...GET /assets/../../package.json (path traversal) da 404...`, `...GET /assets/<nombre-fuera-de-la-lista-blanca> da 404`, `...ruta desconocida dentro de /api/ da 404`, `...metodo no permitido en una ruta conocida da 405` | GREEN |
| 11. Transporte: cierre de puerto y de SSE | `tests/phase2-transporte-http.test.mjs::cerrar() libera el puerto...` / `...cerrar() cierra las conexiones SSE abiertas...` | GREEN |
| 12. Vista física pura: no importa `circuito.ts` | `tests/phase2-vista-fisica.test.mjs::vista-fisica/ (snapshot-a-vista, wokwi-render-datos, vista-real) no importa circuito.ts` | GREEN |
| 12. Vista física pura: ESP32+LED+cable con nombre de pin correcto | `tests/phase2-vista-fisica.test.mjs::proyectarVista: placa wokwi-esp32-devkit-v1, LED con cable GPIO_X->anodo (nombre Wokwi correcto) y catodo->GND por riel fijo` | GREEN |
| 12. Vista física pura: JSON plano | `tests/phase2-vista-fisica.test.mjs::proyectarVista es JSON-plano: JSON.parse(JSON.stringify(vista)) da deepEqual a vista` | GREEN |
| 12. Vista física pura: GPIO ofrecidos = catálogo ∩ pin físico | `tests/phase2-vista-fisica.test.mjs::gpiosDisponibles incluye GPIO16/GPIO18... y excluye los soloEntrada que asignarPin() rechaza` | GREEN |
| 12. Vista física pura: sin placa → sin candidatos | `tests/phase2-vista-fisica.test.mjs::gpiosCandidatosPara: sin placa elegida (placaId === null) da SIEMPRE []` | GREEN |
| 12. Vista física pura: determinismo | `tests/phase2-vista-fisica.test.mjs::proyectarVista es determinista: dos llamadas SIN cambios en el medio dan deepEqual` | GREEN |
| 12. Vista física pura: estabilidad de identidad al cambiar GPIO | `tests/phase2-vista-fisica.test.mjs::cambiar el GPIO del LED (reusando el servicio + AsignarPin) cambia SOLO cables/componentes[].terminales.anodo — el resto de la vista queda identico` | GREEN |
| 12. Vista física pura: plan de pintado | `tests/phase2-vista-fisica.test.mjs::planDePintado: crea la placa y el LED, filas de cable con sus etiquetas, selector de GPIO con el valor actual y panel de motivos` | GREEN |
| 12. Vista física pura: plan determinista, sin URLs | `tests/phase2-vista-fisica.test.mjs::planDePintado es determinista...` / `...ninguna instruccion del plan referencia una URL externa...` | GREEN |
| 12. Vista física pura: integración con el hook `calcularVista` | `tests/phase2-vista-fisica.test.mjs::snapshot().vista, con calcularVista=vistaDeProyectoConCatalogoReal inyectado, es igual a proyectarla por fuera con el mismo catalogo real` | GREEN |
| 12. Vista física pura: mutante de cable fijo | `tests/phase2-vista-fisica.test.mjs::MUTANTE: un cable tomado de un pin FIJO en vez de la IR tiene que morir contra la propiedad que la suite real exige` (ver `tests/phase2-vista-fisica-mutante-cable-fijo.ts`) | GREEN (el mutante muere; verificación de mutación, no parte del contrato feliz) |
| 12. Vista física pura: `pintar.js` con `document` fake (DOM) | `tests/phase2-pintar.test.mjs` (12 tests: `crearElemento`, `filaCable`, `selectorGpio` ×5, `panelMotivo` ×2, orden del plan, no-reuso de raíces, tipo desconocido ignorado) | GREEN |

**Nota sobre tema 12 y `dom/pintar-vista.ts`**: ARCH-D asumía (con `happy-dom`, "si el proyecto
ya lo usa en algún paquete") un DOM simulado externo. El writer real (`tests/phase2-pintar.test.mjs`)
NO agregó `happy-dom`/`jsdom` como dependencia — construyó un `document` mínimo a mano dentro del
propio test (`createElement`/`setAttribute`/`appendChild`/`addEventListener`), sin tocar
`package.json`. Es una decisión más conservadora que la sugerida por ARCH-D, no una desviación
del contrato.

## 2. Piezas que ARCH-D no anticipó como tema propio (decisiones de diseño posteriores)

| Pieza | Test real (archivo::nombre) | Estado |
|---|---|---|
| `servicio-con-vista.ts` — único punto de producción con vista inyectada (decisión de W2/W3, `DESIGN.md` §2.1/§2.6, `PROTOCOL.md` "Único punto de producción con vista") | `tests/phase2-servicio-con-vista.test.mjs` (7 tests: superficie exportada, `snapshot().vista` desde la primera llamada, igualdad con `vistaDeProyectoConCatalogoReal` por fuera, singleton con vista sin importar quién llega primero, guardia real + trampa + no-falso-positivo) | GREEN |
| Flujo end-to-end (servidor real + SSE + POST + reload + stale) | `tests/phase2-e2e.test.mjs::flujo end-to-end: servidor real, SSE, POST aceptado, reload (cerrar + raiz nueva) y stale contra el servidor nuevo` | GREEN |
| La tool comparte el mismo Engine que el servidor del navegador | `tests/phase2-e2e.test.mjs::la tool (opencode/tool/vista-fisica.ts) obtiene el servicio por la MISMA via de produccion que el servidor del navegador — comparten el Engine` | GREEN |

## 3. Tests agregados por el red team (P2-RED-A/P2-RED-B) y la ronda de fixes (W5)

Ninguno de estos temas estaba en el plan original de ARCH-D — nacieron de los hallazgos
H1/H2/H3/H4/H5 (`RED-A/INFORME.md`) y B1/B2 (`RED-B/INFORME.md`), confirmados cerrados por
`REG/INFORME.md` (excepto H4, abierto por decisión — ver `PHASE_2_SLICE_1_REPORT.md` §D.6).

| Hallazgo | Test real (archivo::nombre) | Estado |
|---|---|---|
| H1 — colisión de clave del singleton | `tests/phase2-directorio-canonico.test.mjs` (5 tests: `dir` vs `dir//`, relativo vs absoluto, symlink, las 4 variantes comparten el mismo motor, `mkdirSync` recursivo) | GREEN |
| H1 — rutas relativas rechazadas por la raíz | `tests/phase2-directorio-absoluto.test.mjs::H1(b): una ruta relativa directo a la raiz da error explicito ANTES de tocar el filesystem...` / `...H1(b): una ruta POSIX absoluta real SI pasa la guardia de forma...` | GREEN |
| H2 — handle zombi tras `cerrar()` | `tests/phase2-cerrar-invalida.test.mjs` (5 tests: `aplicar()` lanza `SERVICIO_CERRADO` sin escribir disco; `snapshot()`/`aplicarTransaccion()`/`proponer()`/`suscribir()` lanzan igual; un handle cerrado no notifica; `cerrar()` idempotente; el servicio nuevo tras cerrar es el único que muta) | GREEN |
| H3 — sin validación de Origin/Content-Type | `tests/phase2-transporte-http.test.mjs::H3: POST /api/operaciones con Origin de OTRO sitio da 403...`, `...SIN header Origin da 403...`, `...con Content-Type: text/plain da 415...`, `...con Content-Type application/json;charset=utf-8... SI se acepta`, `...el POST valido de la pagina real... sigue funcionando...`, `...Origin de OTRO puerto en 127.0.0.1... tambien da 403` | GREEN |
| H4 — guardias léxicas evadibles | Sin test nuevo — limitación documentada en el encabezado de `scripts/guardia-composicion-raiz.mjs`/`scripts/guardia-servicio-con-vista.mjs` y en `DECISIONS.md` (decisión del orquestador de no perseguirlo con más regex; ver `PHASE_2_SLICE_1_REPORT.md` §D.6) | N/A (decisión documentada, no un contrato en verde) |
| H5 — CAS entre procesos de SO (candado de propiedad) | `tests/phase2-candado-proceso.test.mjs` (6 tests: dos procesos de SO reales, el segundo falla; PID muerto se recupera; `cerrar()` libera el candado; dos llamadas en el mismo proceso no se autobloquean; el launcher de demo y la tool fallan claro contra otro dueño) | GREEN |
| B1 — nombre de pin Wokwi inventado/erróneo | `tests/phase2-wokwi-pinout.test.mjs` (4 tests: todos los GPIO ofrecidos tienen `nombreWokwi` real; GPIO1/GPIO3 → TX0/RX0; sin pin físico da `null`, nunca `D<n>`; una asignación fuera del selector se proyecta honesta) | GREEN |
| B2 — vista muda ante reinicio del servidor | `tests/phase2-conexion-estado.test.mjs` (9 tests: `ESTADO_INICIAL`, el reductor puro en sus 3 transiciones, `planDePintado` con/sin `conexionActiva`, `pintar()` aplicando `.disabled` real) | GREEN |
| Favicon (MINOR, detectado en la demo real) | Cubierto por `tests/phase2-transporte-http.test.mjs::GET /favicon.ico da 204 sin cuerpo` | GREEN |

## 4. Tests de Phase 1 — confirmación de que no se tocaron

`git diff --name-only 8b43c59..HEAD -- 'tests/nucleo-*.test.mjs'` no devuelve ningún
archivo (ver `PHASE_2_SLICE_1_SCOPE_REPORT.md`, fuera del repo, para el name-status
completo). Los 983 tests de Phase 1 corren sin cambios y siguen en verde dentro de los
1100 totales (`pnpm test`, HEAD `4348c30`).
