# INVARIANTES-ENTRYPOINTS.md — matriz de invariantes por puerta de entrada (Phase 1.1)

Este documento **referencia** el Brief congelado, `IR-SPEC.md` y `OPERATIONS.md` — no
es una segunda especificación ni reemplaza a ninguno de los tres. Su único propósito
es dejar visible, para cada invariante de contrato, **qué puerta de entrada del núcleo
lo hace cumplir de verdad hoy**, con qué código de `Motivo`, y con qué test — para que
un GAP real (invariante que una puerta debería reforzar y no lo hace, o que sólo se
sostiene por una cadena de suposiciones no verificadas) quede visible en vez de
asumido.

Cada celda salió de LEER el código real (`opencode/nucleo/*.ts`) y de encontrar o
correr el test que lo prueba — nunca se copió de un reporte de auditoría anterior.

## Puertas de entrada (7 columnas, con su función/archivo real)

| Puerta | Función/archivo |
|---|---|
| **Loader** | `cargarProyecto()` / `validarFormaProyecto()` — `cargador.ts`, Gate 2 |
| **Project initial** | `crearMotorDeProyecto({ proyectoInicial })` — `motor.ts`, Gate 6, momento de construcción |
| **Operation** | `aplicarOperacion()` — `operaciones.ts`, Gate 5, función pura, UNA operación |
| **Batch** | `motor.aplicar()` / `motor.aplicarTransaccion()` — `motor.ts`, `ejecutarLote(..., comprometer:true)`, Gate 6 |
| **Dry-run** | `motor.proponer()` — `motor.ts`, `ejecutarLote(..., comprometer:false)`, Gate 6 |
| **Store load** | `almacen.cargar(id)` — `almacen.ts`, Gate 7 |
| **Catalog revalidation** | `validarProyecto(proyecto, catalogoDistinto)` invocado directo — `validar.ts`, Gate 4 |

Valores de celda: **refuerza** (la puerta corre el chequeo, con la función que se
nombra) · **N/A** (el motivo por el que esa puerta no aplica) · **por construcción**
(el invariante se sostiene porque el código que rodea a esa puerta lo garantiza por
diseño, no porque haya un chequeo explícito ahí — se explica cuál) · **GAP** (hueco
real encontrado, reportado, NO corregido acá).

---

## Matriz

| # | Invariante | Owner canónico | Loader | Project initial | Operation | Batch | Dry-run | Store load | Catalog revalidation | Reason code(s) | Representable/reject | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | IDs únicos (cmp+conn+beh, string exacto) | `analizarIdsLocales`/`validarIdsYContador` (`id.ts`) | refuerza | refuerza | por construcción [a] | por construcción [a] | por construcción [a] | refuerza (vía `cargarProyecto`) | N/A [b] | `ID_DUPLICADO` | reject | `nucleo-ir-cargador.test.mjs::id-duplicado-entre-componentes-rechaza`, `::id-duplicado-entre-conexiones-rechaza`, `::id-duplicado-entre-comportamientos-rechaza`; `nucleo-motor.test.mjs::constructor-rechaza-proyectoInicial-con-ids-duplicados-entre-conexiones` |
| 2 | Contador (`siguienteIdLocal`) monotónico / consistente | `contadorEsConsistente`/`validarIdsYContador` (`id.ts`) | refuerza | refuerza | por construcción [c] | por construcción [c] | por construcción [c] | refuerza (vía `cargarProyecto`) | N/A [b] | `CONTADOR_ID_INCONSISTENTE` | reject | `nucleo-ir-cargador.test.mjs::contador-siguienteIdLocal-inconsistente-con-id-existente-rechaza`, `::contador-siguienteIdLocal-igual-al-maximo-existente-rechaza`; `nucleo-motor.test.mjs::constructor-rechaza-proyectoInicial-con-contador-id-inconsistente`; `nucleo-operaciones.test.mjs::quitar-luego-agregar: el contador nunca retrocede... (M22)` |
| 3 | Referencias válidas (conexión/comportamiento → componente existente) | `cargador.ts` (carga) + `validarEstructural` (post-construcción) — DOS implementaciones a propósito, IR-SPEC §7 | refuerza | refuerza (vía `validarProyecto` al construirse) | refuerza (cada `aplicarXxx` re-chequea antes de mutar) | refuerza (hereda Operation + defensa en profundidad post-lote) [d] | refuerza (mismo pipeline que Batch, sin persistir) | refuerza (vía `cargarProyecto`) | refuerza | `REFERENCIA_ROTA_AL_CARGAR` (carga) / `REFERENCIA_INEXISTENTE` (cualquier `Proyecto`) | reject (ambos) | `nucleo-ir-cargador.test.mjs::referencia-colgada-en-conexion-rechaza`, `::referencia-colgada-en-comportamiento-rechaza`; `nucleo-validacion.test.mjs::referencia-inexistente-en-validar-estructural`; `nucleo-operaciones.test.mjs::quitarcomponente-inexistente-rechaza`, `::desconectar-inexistente-rechaza`, `::setcomportamiento-sensor-inexistente-rechaza`; `nucleo-adversarial.test.mjs::14. referencia rota da REFERENCIA_ROTA_AL_CARGAR al cargar y REFERENCIA_INEXISTENTE en validar-estructural, nunca el mismo codigo` |
| 4 | Sin auto-conexión (self-loop) | `esAutoconexion`/`analizarConexionesInvalidas` (`conexion.ts`) | refuerza | refuerza (vía `validarProyecto`) | refuerza (`aplicarConectar`) | refuerza (hereda + defensa en profundidad) [d] | refuerza | refuerza (vía `cargarProyecto`) | refuerza | `AUTOCONEXION_INVALIDA` (operacion/estructural) / `AUTOCONEXION_INVALIDA_AL_CARGAR` (carga) | reject (siempre) | `nucleo-operaciones.test.mjs::conectar-autoconexion-rechaza`; `nucleo-ir-cargador.test.mjs::loader-rechaza-documento-con-selfloop`; `nucleo-validacion.test.mjs::validarEstructural-detecta-selfloop-en-conexion`, `::validarProyecto-directo-rechaza-selfloop-con-listo-false`; `nucleo-motor.test.mjs::constructor-rechaza-proyectoInicial-con-selfloop` |
| 5 | Sin conexión duplicada (A→B ≡ B→A) | `mismaConexion`/`analizarConexionesInvalidas` (`conexion.ts`) | refuerza | refuerza (vía `validarProyecto`) | refuerza (`aplicarConectar`) | refuerza (hereda + defensa en profundidad) [d] | refuerza | refuerza (vía `cargarProyecto`) | refuerza | `CONEXION_DUPLICADA` (operacion/estructural) / `CONEXION_DUPLICADA_AL_CARGAR` (carga) | reject (siempre) | `nucleo-operaciones.test.mjs::conectar-duplicada-rechaza`; `nucleo-ir-cargador.test.mjs::loader-rechaza-documento-con-conexion-duplicada`; `nucleo-validacion.test.mjs::validarEstructural-detecta-conexion-duplicada-con-extremos-invertidos`, `::validarEstructural-no-rechaza-conexiones-distintas-que-comparten-terminal` (no-regresión); `nucleo-motor.test.mjs::constructor-rechaza-proyectoInicial-con-conexion-duplicada` |
| 6 | Capacidad de comportamiento válida | `aplicarSetComportamiento` (operación) + `validar-tecnico.ts` (continuo) — DOS momentos, IR-SPEC §6.2 | N/A (Gate 2 no conoce catálogo) | refuerza (diagnostica, representable — no bloquea construcción) | refuerza (`CAPACIDAD_NO_DECLARADA`, rechazo) | refuerza (hereda Operation + diagnóstico post-lote) | refuerza | N/A [e] | refuerza | `CAPACIDAD_NO_DECLARADA` (operacion, rechazo) / `CAPACIDAD_INEXISTENTE_EN_CATALOGO` (tecnica, representable) | mixto (reject en Operation, representable en validación continua) | `nucleo-operaciones.test.mjs::setcomportamiento-capacidad-no-declarada-rechaza`; `nucleo-validacion.test.mjs::capacidad-inexistente-en-catalogo-representable`, `::sensor-sin-la-capacidad-requerida-representable`, `::comportamiento-valido-bajo-un-catalogo-deja-de-serlo-bajo-otro...` |
| 7 | Magnitud/unidad de umbral compatible con la capacidad | `propagarMagnitud` (`catalogo.ts`, oráculo) reusado por `validar-tecnico.ts` | N/A (sin catálogo) | refuerza (diagnostica) | N/A (deliberado: IR-SPEC §6.2, se deja pasar, se diagnostica después de commitear — mismo criterio que `PIN_OCUPADO`) | refuerza (diagnostica post-lote, representable) | refuerza (diagnostica) | N/A [e] | refuerza | `MAGNITUD_INCOMPATIBLE` (tecnica, código ya existente de `catalogo.ts`) | representable (nunca rechazo — IR-SPEC §6.2) | `nucleo-validacion.test.mjs::umbral-magnitud-incompatible-representable`, `::umbral-unidad-incompatible-representable`; `nucleo-catalogo.test.mjs::magnitud-dimension-incompatible`; `nucleo-operaciones.test.mjs::setcomportamiento-temperatura-negativa-commitea` (no-regresión: confirma que NO rechaza a nivel operación) |
| 8 | Umbral finito (`Number.isFinite`) | 3 puertas por diseño (`cargador.ts`/`operaciones.ts`/`validar-estructural.ts`), IR-SPEC §6.2 | refuerza | refuerza (vía `validarProyecto`) | refuerza (`aplicarSetComportamiento`, antes de mutar) | refuerza (hereda + defensa en profundidad) | refuerza | refuerza (vía `cargarProyecto`) | refuerza | `UMBRAL_NO_FINITO_AL_CARGAR` (carga) / `UMBRAL_NO_FINITO` (operacion y estructural, según quién emite) | reject (los 3 códigos) | `nucleo-ir-cargador.test.mjs::umbral-nan-al-cargar-rechaza`, `::umbral-infinito-positivo-al-cargar-rechaza`, `::umbral-infinito-negativo-al-cargar-rechaza`; `nucleo-operaciones.test.mjs::setcomportamiento-umbral-nan-rechaza`, `::setcomportamiento-umbral-infinito-positivo-rechaza`, `::setcomportamiento-umbral-infinito-negativo-rechaza`; `nucleo-validacion.test.mjs::umbral-no-finito-rechaza-en-validar-estructural`, `::umbral-nan-rechaza-en-validar-estructural`; `nucleo-motor.test.mjs::constructor-rechaza-proyectoInicial-con-umbral-no-finito` |
| 9 | `baseRevision` válido (entero no negativo, no sustituido nunca por la revisión actual) | `esEnteroNoNegativo` + `ejecutarLote` (`motor.ts`), Gate 6 exclusivo | N/A (no existe en el documento `Proyecto`) | N/A (no existe en `proyectoInicial`) | N/A (`aplicarOperacion`, Gate 5, no conoce `baseRevision` — es puramente Gate 6) | refuerza (`ejecutarLote`, para `aplicar` y `aplicarTransaccion` por igual — sólo la PRIMERA operación del lote se contrasta, OPERATIONS.md §2/§9) | refuerza (mismo `ejecutarLote`, sin persistir) | N/A (`almacen.cargar` no conoce operaciones) | N/A (`validarProyecto` directo no recibe ningún sobre de operación) | `BASE_REVISION_INVALIDA` (dato nunca válido) / `BASE_REVISION_DESACTUALIZADA` (dato válido pero stale) | reject (ambos) | `nucleo-motor.test.mjs::baseRevision invalido en la PRIMERA operacion rechaza...`, `::baseRevision AUSENTE...`, `::ResultadoTransaccion con baseRevision invalido ecoa...`, `::segunda-operacion-con-baseRevision-valido-pero-stale...`; `nucleo-adversarial.test.mjs::5a...`, `::5b...` |
| 10 | Sobre/payload de operación con forma válida (y su LECTURA nunca crashea — Phase 1.1 RX, hallazgo RX-02) | `analizarSobreOperacion`/`validarFormaPayload` (`operaciones.ts`), ANTES del dispatch, dentro de un `try/catch` que nunca deja escapar una excepción de lectura | N/A (concierne al sobre de operación, no al documento `Proyecto`) | N/A (`proyectoInicial` no es un sobre de operación) | refuerza (`aplicarOperacion`, antes del switch) | refuerza (hereda: `ejecutarLote` llama `aplicarOperacion` una vez por operación del lote) | refuerza (mismo pipeline) | N/A | N/A | `SOBRE_OPERACION_INVALIDO` / `TIPO_OPERACION_DESCONOCIDO` / `PAYLOAD_OPERACION_INVALIDO` / `CLAVE_DESCONOCIDA` / `EXCEPCION_INESPERADA_EN_VALIDACION_DE_FORMA` (categoria operacion) | reject (siempre) | `nucleo-operaciones.test.mjs::aplicarOperacion/ejecutarOperacion NUNCA lanzan una excepcion cruda...`, `::el sobre de operacion rechaza una clave extra desconocida...`, `::aplicarOperacion/ejecutarOperacion NUNCA propagan un getter-que-explota... (RX-02)`; `nucleo-motor.test.mjs::motor.aplicar/aplicarTransaccion/proponer NUNCA propagan una excepcion cruda...`, `::motor.aplicar/aplicarTransaccion/proponer NUNCA propagan un getter-que-explota... (RX-02)` |
| 11 | Forma/schema del documento `Proyecto` (claves, tipos, versión) | `validarFormaProyecto` (`cargador.ts`) — MISMA función, reusada, no copiada (fix CP-01) | refuerza | refuerza (extraída para esto, CP-01) | N/A (asume un `Proyecto` ya bien formado — validado en Loader/Project-initial) | N/A (idem) | N/A (idem) | refuerza (vía `cargarProyecto`) | N/A (`validarEstructural`/`validarTecnico` asumen un `Proyecto` "ya bien tipado" — comentario propio del archivo) | `CLAVE_DESCONOCIDA` / `CAMPO_REQUERIDO_FALTANTE` / `VERSION_SCHEMA_DESCONOCIDA` / `DOCUMENTO_MALFORMADO` (categoria estructural) | reject (siempre) | `nucleo-ir-cargador.test.mjs::clave-top-level-desconocida-rechaza`, `::falta-campo-requerido-rechaza`, `::schemaVersion-futura-rechaza-sin-proyecto-parcial`, `::json-corrupto-rechaza`, `::documento-no-es-un-objeto-rechaza`; `nucleo-motor.test.mjs::constructor-rechaza-proyectoInicial-con-forma-invalida (CP-01)`; `nucleo-almacen.test.mjs::cargar-json-corrupto-da-motivos-estructurados` |
| 12 | Inmutabilidad del catálogo construido | `construirCatalogo` (`catalogo.ts`, fix E3-03) | N/A (Gate 2 no toca catálogo) | por construcción [f] | por construcción [f] | por construcción [f] | por construcción [f] | N/A (`almacen.cargar` sólo compara `catalogoHash`, nunca reconstruye ni lee componentes) | por construcción [f] | N/A (esto es un invariante de aislamiento de referencia — se prueba con `Object.isFrozen`, no es un `Motivo`) | N/A | `nucleo-catalogo.test.mjs::obtenerComponente() devuelve un objeto CONGELADO — mutarlo explota, nunca se propaga en silencio (hallazgo externo E3-03)` |
| 13 | Colisión de escritura en almacén (compare-and-swap por revisión) | `almacen.ts::guardar()` (fix E3-07) | N/A (no escribe) | N/A (no escribe) | N/A (`aplicarOperacion` es pura, sin I/O) | refuerza (el commit de `ejecutarLote` es quien llama `almacen.guardar()`) | N/A (`proponer()` nunca llama a `guardar`, verificado por test) | N/A (concierne a escritura, no a lectura — ver fila 14) | N/A (no escribe) | `CONFLICTO_REVISION_EN_ALMACEN` (categoria almacen) | reject | `nucleo-almacen.test.mjs::guardar-detecta-conflicto-cuando-el-disco-ya-avanzo-mas-alla-de-lo-que-este-llamador-vio (E3-07)`; `nucleo-motor.test.mjs::dos-motores-mismo-almacen-real-y-mismo-id-el-segundo-commit-recibe-conflicto-en-vez-de-pisar-al-primero (E3-07)` |
| 14 | El `id` del documento cargado coincide con el `id` pedido | `almacen.ts::cargar()` (fix E3-08) | N/A (`cargarProyecto` no recibe un "id pedido" — sólo el documento) | N/A | N/A | N/A | N/A | refuerza | N/A | `ID_DOCUMENTO_NO_COINCIDE` (categoria almacen) | reject | `nucleo-almacen.test.mjs::cargar-rechaza-si-el-id-del-documento-no-coincide-con-el-id-pedido (E3-08)` |

---

## Notas por fila (detalle que no entra en la celda)

**[a] Fila 1, Operation/Batch/Dry-run — "por construcción":** `aplicarOperacion` nunca
verifica explícitamente que un id nuevo no colisione — genera el id con
`formatearIdLocal(prefijo, proyecto.siguienteIdLocal)` y confía en que
`proyecto.siguienteIdLocal` YA es consistente (garantía que entra por Loader/Project
initial, filas 1-2). `SetComportamiento`, además, IGNORA por completo cualquier `id`
que el payload sugiera para una entidad nueva (sólo lo usa para el camino de
reemplazo, cuando coincide con un `id` YA existente) — así que un cliente no puede
forzar una colisión ni aunque lo intente. Se mantiene consistente por INDUCCIÓN: los 3
aplicadores que generan un id local sólo lo INCREMENTAN, nunca lo decrementan (cerrado
con regresión de cobertura en el hallazgo M22, `tests/nucleo-operaciones.test.mjs`).

**GAP encontrado (fila 1, columna Batch):** ningún test de
`tests/nucleo-motor.test.mjs`/`tests/nucleo-adversarial.test.mjs` afirma EXPLÍCITAMENTE
que 2+ operaciones que generan un id local (ej. dos `AgregarComponente`) DENTRO del
MISMO `aplicarTransaccion([...])` producen ids distintos y consecutivos. El
comportamiento SE VERIFICÓ correcto por lectura + repro manual
(`evidencia/T7/matriz_gap_multiop_ids_repro.mjs`/`_output.txt`: dos `AgregarComponente`
en un solo lote producen `cmp-0`/`cmp-1`, `siguienteIdLocal` termina en 2) — no es un
defecto de código, es un hueco de COBERTURA de test explícita para un invariante que
hoy se sostiene sólo "por construcción". No se agregó el test acá (fuera del alcance
de la Parte 4 de T7, que pide reportar un GAP, no corregirlo en silencio) — reportado
para que Phase 1.1/Fase 2 decida si amerita un test dedicado.

**Phase 1.1 — GAP cerrado:** se agregó el test dedicado
`tests/nucleo-motor.test.mjs::lote-con-varias-altas-genera-ids-distintos-y-consecutivos`
(tres altas en un lote → `cmp-0`/`cmp-1`/`cmp-2`, `siguienteIdLocal` 3). Mutante
verificado: si `aplicarAgregarComponente` no avanza el contador, el test falla con
`['cmp-0','cmp-0','cmp-0']`. Ese mutante muestra además un límite a registrar: dentro
de un lote, la unicidad de ids depende de la monotonía de los aplicadores. La
validación post-lote (`validarProyecto`) no re-chequea ids duplicados
(nota [b]), así que este test es hoy la única red para esa puerta.

**[b] Filas 1-2, columna Catalog revalidation — N/A, por diseño explícito:**
`validarIdsYContador` deliberadamente NO se agregó al pipeline continuo de
`validar-estructural.ts`/`validarProyecto` (IR-SPEC §6.1): esa validación corre sobre
CUALQUIER `Proyecto`, incluidos fixtures de test armados a mano que usan
intencionalmente ids no numerados o fuera de secuencia como estado "sano". Una vez
consistente al construirse (filas Loader/Project initial), el contador se mantiene
consistente por inducción — no por revalidación continua.

**[c] Fila 2, igual razón que [a]** aplicada al contador en sí: ningún aplicador
decrementa `siguienteIdLocal`; el M22 regression test (`tests/nucleo-operaciones.
test.mjs`) es justamente la prueba de esa propiedad "por construcción".

**[d] Filas 3-5, columna Batch — "defensa en profundidad", con matiz:** el commit de
`ejecutarLote` corre `validarProyecto(borrador, catalogo)` una vez DESPUÉS de aplicar
todo el lote — si trae un motivo `clasificacion:"rechazo"` (fila 3:
`REFERENCIA_INEXISTENTE`; filas 4/5: `AUTOCONEXION_INVALIDA`/`CONEXION_DUPLICADA` con
categoría `estructural`), el lote entero se descarta igual que un rechazo por
operación (hallazgo adversarial Gate 8, `DECISIONS.md`). Para las filas 4/5, esta
segunda capa hoy NUNCA encuentra nada distinto vía las 8 operaciones públicas, porque
`aplicarConectar` ya rechaza el self-loop/duplicado ANTES de llegar a ese punto — la
defensa real es contra un `proyectoInicial`/estado bypaseado, no contra las
operaciones normales. Para la fila 3, la auditoría externa (§29,
`PHASE_1_EXTERNAL_FINDINGS.md`) confirma lo mismo: "no reproducible hoy vía API
pública", el mecanismo se prueba forzado (`validacionAdicionalSoloTests` o
`proyectoInicial` roto).

**[e] Filas 6-7, columna Store load — N/A por diseño, no GAP:** `almacen.cargar()`
(Gate 7) sólo compara `catalogoHash` guardado vs. activo y emite un aviso INFORMATIVO
(`CATALOGO_CAMBIO_DETECTADO`, severidad `info`) — nunca re-corre `validar-tecnico.ts`.
Esto es arquitectura deliberada (Gate 7 = persistencia física, Gate 4 = validación
semántica): el diagnóstico técnico completo (capacidad/magnitud/unidad) lo corre quien
construya el motor sobre el `Proyecto` recién cargado (`crearMotorDeProyecto`, fila
Project initial) o quien llame `validarProyecto` directo (columna Catalog
revalidation) — nunca `almacen.cargar()` por sí solo. Documentado en el propio
`almacen.ts` ("Version-skew (R11/R2): ... se AVISA, nunca se muta el proyecto ni se
rechaza la carga").

**[f] Fila 12 — "por construcción" en las puertas del motor/operaciones:** el
`Catalogo` llega YA construido (inmutable) como dependencia inyectada
(`DependenciasMotor.catalogo`) — ninguna puerta del motor/operaciones invoca
`construirCatalogo()` de nuevo ni necesita reverificar el aislamiento: se benefician
de la garantía establecida UNA sola vez, upstream, en el composition root.

---

## Resumen de GAPs encontrados

Un (1) GAP real, de COBERTURA (no de comportamiento — verificado correcto por
lectura + repro manual), documentado en la nota **[a]** de la fila 1: falta un test
explícito de que 2+ operaciones generadoras de id, dentro del MISMO lote
(`aplicarTransaccion`), producen ids distintos y consecutivos. No corregido en esta
tarea (T7, Parte 4 pide reportar, no corregir en silencio).

**Phase 1.1 — cerrado** con el test dedicado citado en la nota [a].

Ningún otro invariante de los 14 relevados carece de refuerzo real en alguna puerta
donde el contrato (Brief/IR-SPEC/OPERATIONS) lo exige — las celdas `N/A` de arriba
corresponden todas a límites de diseño ya documentados (capa Gate 2 vs. Gate 4, Gate 5
vs. Gate 6, alcance de `almacen.cargar()`), no a huecos sin explicación.
