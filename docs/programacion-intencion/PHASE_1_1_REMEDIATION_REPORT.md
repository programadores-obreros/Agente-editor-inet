# Phase 1.1 — Informe de remediación post auditoría externa

Tecnia Bot — Programación por Intención (núcleo `opencode/nucleo/`)

Rango de commits: `4a0cad5` (base, Phase 1 congelada, mergeada en `main` como `0fa7298`) → `94c2834` (HEAD de `feature/programacion-por-intencion`), 35 commits.

Este documento es el resumen ejecutivo de la remediación. No es un veredicto de merge: el veredicto máximo posible para este freeze es **READY FOR EXTERNAL RE-AUDIT — NOT MERGED**, y esa decisión final la emite el orquestador, no este documento.

---

## 1. Alcance autorizado y respetado

`opencode/nucleo/**`, `tests/nucleo-*.test.mjs`, `docs/programacion-intencion/**`, evidencia fuera del repo en `~/tecnia-bot-docs/phase1.1/`.

Prohibido y confirmado sin tocar (ver `PHASE_1_1_SCOPE_REPORT.md` para el detalle con evidencia de grep): `circuito.ts`, `platformio.ts`, `pinouts.json`, Wokwi/Blockly, transporte de navegador, servidor HTTP/WebSocket/SSE, codegen, integración PlatformIO, `.gestor/`, `package.json`/lockfile. No hay leak de Fase 2 en ningún commit — verificado por `git diff --name-status 4a0cad5..HEAD` (fuente: cuerpo de cada commit del rango, más `T9/RX_REPORT.md` objetivo 6, `RX2_REPORT.md` objetivo 8, `RX3_REPORT.md` verificación de scope, `RX4_REPORT.md` Parte 4).

## 2. Origen y disparador

Auditoría externa de Phase 1 (`~/tecnia-bot-docs/phase1_auditoria_externa/PHASE_1_EXTERNAL_FINDINGS.md`, `PHASE_1_EXTERNAL_MERGE_GATE.md`): veredicto **MERGE: BLOCKED**, **PHASE_2: BLOCKED**. Causa raíz agrupada como **RC1** — invariantes de contrato reforzados en una sola puerta de entrada (típicamente la operación pública), no en todas las puertas (loader, `proyectoInicial`, sobre de operación, `baseRevision`, revalidación). 6 hallazgos CRÍTICOS bloqueantes (E1-01, E1-02, E1-03, E2-01, E2-02, E3-01), 3 fixes recomendados para certificar el merge sin deuda conocida (E3-03, E3-07, E3-04b), 2 hallazgos de trazabilidad (E4-01, E4-02, que hacían FAIL el gate TRACEABILITY), y una lista de hallazgos MENOR/NOTA (M22, M23, E2-03/04, E3-02/05/06/08, E4-03).

## 3. Secuencia de trabajo (T1…T10, RX…RX4, W1…W12)

| Paso | Contenido | Ruta | Commits |
|---|---|---|---|
| T1 | E1-01+E1-02+M22 (unicidad/consistencia de ids) | delegado W1 | `5a7b4f7`, `82c9226` |
| T2 | E1-03 (comportamiento: finito/magnitud/capacidad) | delegado W2 | `58d1152` |
| T3 | E2-01 (self-loop/conexión duplicada, todas las puertas) | delegado W3 | `5aeee32` |
| T4 | E2-02+E2-03 (forma del sobre/payload) + E3-01+E3-05 (baseRevision) | delegado W4 | `0a4f14d`, `938e126` |
| T5 | Checkpoint crítico: reproducción de los 22 scripts de la auditoría | inline orquestador | — (halla CP-01, CP-02) |
| T6 | CP-01, CP-02, E3-03, E3-04b, E3-07, E3-08 | delegado W5 | `b3c25a8`, `7f9acbf`, `00530a3`, `264c327`, `addd465`, `43ed00b` |
| T7 | M23 golden, invariante de vista (8 ops), E2-04/E1-04/E3-02/E3-06 doc, `INVARIANTES-ENTRYPOINTS.md`, E4-01/E4-02 | delegado W6 | `a9b0224`, `be29bc1`, `bba69b0`, `321c09a`, `81079bd`, `aa611ac` |
| T7b | Cierre del GAP de cobertura de la matriz (multi-alta en un lote) | inline orquestador | `79da20a` |
| T8 | Mutación Phase 1.1 (25 externos + N01-N23) sobre `79da20a` | delegado M | ver `PHASE_1_1_MUTATION_REPORT.md` |
| T9 (RX) | Revisión adversarial independiente #1 sobre `79da20a` | delegado RX | ver `PHASE_1_1_ADVERSARIAL_REPORT.md` |
| — | Fixes de RX | delegado W7 | `6822c5a`, `3bad13c`, `c79e485`, `bdb192b`, `bdd946f`, `efbb64e` |
| — | Mutación ronda 2 (M2) sobre `efbb64e`, en paralelo con RX2 | delegado M | ver `PHASE_1_1_MUTATION_REPORT.md` |
| RX2 | Revisión adversarial independiente #2 sobre `efbb64e` | delegado RX2 | ver `PHASE_1_1_ADVERSARIAL_REPORT.md` |
| — | Fixes de RX2 (frontera de datos planos) | delegado W8 | `8a9a593`, `5ab524b`, `01b4c41` |
| RX3 | Revisión adversarial independiente #3 sobre `01b4c41` | delegado RX3 | ver `PHASE_1_1_ADVERSARIAL_REPORT.md` |
| — | Fix de RX3 (causa raíz: contenedor inseguro, no el nombre de clave) | delegado W9 | `4957aea`, `dbd70cc`, `d36f028` |
| RX4 | Revisión adversarial independiente #4 (NUEVA) sobre `d36f028` + matriz acumulativa | delegado RX4 | ver `PHASE_1_1_ADVERSARIAL_REPORT.md` |
| — | Fixes de RX4 | delegado W10 | `357d1b4`, `97f9f86`, `3ae4857` |
| RX4 focal | Verificación focalizada, scripts originales sin editar, sobre `3ae4857` | delegado RX4 | ver `PHASE_1_1_ADVERSARIAL_REPORT.md` |
| M3 | Mutación final (gate de cierre) sobre `3ae4857` | delegado M | ver `PHASE_1_1_MUTATION_REPORT.md` |
| — | Cierre de W9-M2a/W9-M2b (REAL_GAP de M3, sólo tests) | delegado W11 | `94c2834` |
| T10/W12 | Documentación final de cierre (este conjunto de documentos) | inline orquestador (este writer) | — |

## 4. Resultados

- **6 CRITICAL originales de RC1**: CERRADOS y verificados sin reapertura hasta el final del gate (matriz `PHASE_1_1_ADVERSARIAL_REGRESSION_MATRIX.md`, filas E1-01/E1-02/E1-03/E2-01/E2-02/E3-01, todas PASS contra `3ae4857`; fuente primaria: `checkpoint/diff_4a0cad5_vs_d36f028.md`, los 6 scripts originales de la auditoría cambian de "defecto reproducido" a "rechazo estructurado").
- **3 fixes recomendados del merge gate**: E3-03 (clon defensivo + freeze del catálogo, `00530a3`), E3-07 (CAS por revisión en `almacen.guardar`, `addd465`), E3-04b (documentado como puerto interno del composition root, `264c327`) — CERRADOS.
- **E4-01/E4-02** (trazabilidad, causa del FAIL de TRACEABILITY): archivados byte-idénticos en `~/tecnia-bot-docs/phase1/evidencia_original_sesion/` (22 archivos, `PROVENANCE.txt`, todos `ORIGEN_OK`) y referencia durable agregada en `DECISIONS.md` (`aa611ac`).
- **M22/M23**: los 2 mutantes sobrevivientes de la auditoría externa MUEREN desde T1/T7 en adelante, confirmado en las 3 rondas de mutación (T8, M2, M3).
- **Invariante de vista**: cubierto en las 8 operaciones (`be29bc1`), no sólo en las 2 que ya lo tenían.
- **759/759 → 956/956**: la suite original de Phase 1 sigue 100% verde a lo largo de todo el rango (ningún test preexistente borrado — ver `PHASE_1_1_TEST_REPORT.md`), más 197 tests nuevos.
- **4 rondas de revisión adversarial independiente (RX, RX2, RX3, RX4)** encontraron y cerraron, en cascada, hallazgos cada vez más sutiles de la MISMA clase de causa raíz (objeto/valor que atraviesa una frontera pública sin materializarse una única vez) — ver §5. La ronda RX4 focalizada final, sobre los 3 fixes del último tramo, con los scripts ORIGINALES sin editar, confirma: **0 causa raíz nueva CRITICAL/MAJOR** (`RX4/focal/...MATRIX_3ae4857.md`, veredicto final).
- **3 rondas de mutación** (T8: 45/48; M2: 56/58; M3: 69/73 evaluados, excluyendo N/A) — score final sobre mutantes no equivalentes: 71/71 = 100% después del cierre de W9-M2a/W9-M2b en `94c2834` (ver `PHASE_1_1_MUTATION_REPORT.md`).
- **Typecheck**: 0 errores en cada checkpoint verificado. **Fichas**: 0 en cada checkpoint verificado (fuente: entradas de progreso del documento de feature, T5/T6/T7/T9-fix/RX2-fix/W9/W10).

## 5. Arquitectura preservada

Ningún commit de Phase 1.1 rediseña la arquitectura de Phase 1. Confirmado independientemente por RX4 (`RX4_REPORT.md`, Parte 4 "Arquitectura"):

- **IR como fuente de verdad**, **Project Engine como única autoridad de mutación**: sin cambios de diseño; los fixes agregan validación en puertas que ya existían (loader, `proyectoInicial`, sobre de operación, lote, revalidación), nunca una autoridad nueva.
- **`Almacen` ≠ segunda autoridad**: confirmado que sigue siendo, por diseño, un puerto interno del composition root — el bypass documentado en E3-04b (retener la misma instancia y llamar `guardar()` directo) sigue siendo posible en runtime (ningún mecanismo de lenguaje lo impide; ver §7). Lo que Phase 1.1 agregó es **E3-07**: detección de colisión de escritura POR REVISIÓN cuando dos motores distintos usan el mismo almacén y el mismo id — eso no convierte a `Almacen` en una segunda autoridad, sólo cierra el caso de colisión accidental de identidad.
- **Blocking ≠ reject**: preservado exacto. Path A (`PIN_OCUPADO`: commit + `blocking` + `listo:false`, editable después) sigue funcionando byte a byte igual en las 4 rondas adversariales (`RX_REPORT.md` objetivo 3, `RX2_REPORT.md` objetivo 4, matrices RX4 filas Path-A).
- **Readiness derivada**: sin cambios; `derivarReadiness` no fue tocada por ningún commit de Phase 1.1 (no aparece en `git diff --stat 4a0cad5..HEAD`).
- **Catálogo declarativo**: preservado y reforzado — E3-03 congela el catálogo construido pero la extensibilidad declarativa (agregar un componente como dato, sin tocar ningún `.ts` del núcleo) se verificó intacta explícitamente por RX (`RX_REPORT.md`, script 09) y por RX4 (Parte 4).
- **`datos-planos.ts` es una frontera, no un segundo modelo canónico**: confirmado por lectura completa del módulo por RX4 — nunca conoce `Proyecto`/`SobreOperacion`, nunca valida schema (eso sigue 100% en `cargador.ts`/`operaciones.ts`), sólo decide "¿esto es JSON-representable sin ejecutar comportamiento inesperado?" (`RX4_REPORT.md`, Parte 4).

## 6. La frontera de datos planos (`opencode/nucleo/datos-planos.ts`)

Introducida en `8a9a593` para cerrar de raíz la clase de hallazgo "un objeto JS exótico atraviesa una frontera pública del núcleo" (RX2-01/02/03), en vez de parchar lectura por lectura (que es lo que los fixes puntuales de RX-01/RX-02 habían intentado, y que RX2 demostró insuficiente). Endurecida por `d36f028` (RX3-01: el defecto real no era el nombre de la clave `__proto__`, sino el CONTENEDOR — cualquier objeto fresco construido con `obj[clave]=valor` es vulnerable a un accessor heredado). Aplicada en las fronteras públicas: `cargador.ts` (`validarFormaProyecto`, usada por `cargarProyecto` y por `crearMotorDeProyecto({proyectoInicial})`), `motor.ts` (lote completo de `ejecutarLote`), `operaciones.ts` (sobre de cada operación).

**Qué acepta** (SUPPORTED_INPUT, clasificación formal de RX4, 28/28 clases verificadas — `RX4_REPORT.md` Parte 3): objetos planos (`Object.prototype` o `null`) y arrays JSON-representables, incluyendo `null` como valor, `undefined` como valor de propiedad (no como elemento de array), `NaN`/`Infinity`/`-Infinity`/`-0` en campos genéricos (la finitud es responsabilidad de la capa de negocio, no de este módulo — `UMBRAL_NO_FINITO` sigue viviendo en `operaciones.ts`/`cargador.ts`/`validar-estructural.ts`), claves `__proto__`/`constructor`/`prototype`/`toString` como datos ordinarios en una bolsa abierta (`propiedades`), un Proxy cuyo único trap peligroso es `get` (nunca se invoca: la lectura es por descriptor), anidamiento hasta `LIMITE_PROFUNDIDAD` (64) y hasta `LIMITE_NODOS` (50.000).

**Qué rechaza** (REJECTED_INPUT): cualquier accessor (getter/setter) en cualquier campo — nunca se invoca, se rechaza por descriptor (`ENTRADA_NO_ES_DATO_PLANO`); Proxies cuyo trap `ownKeys`/`getOwnPropertyDescriptor` lanza; claves `Symbol`; propiedades no enumerables (fail-closed, RX2-04); prototipos no planos (instancia de clase, `Date`, `Map`, subclase de `Array`, `Uint8Array`); arrays con huecos (sparse) o con propiedades extra fuera de índice; ciclos directos e indirectos; `BigInt` (nunca representable en JSON); profundidad/tamaño que exceden el límite.

**Qué queda `OUTSIDE_CONTRACT`**: ninguna de las 28 clases atacadas por RX4 cayó fuera de SUPPORTED/REJECTED — el propio informe lo señala como la evidencia más fuerte de que el módulo cumple su contrato "con precisión quirúrgica" (`RX4_REPORT.md`, cierre de Parte 3). La única frontera de representación documentada como divergencia conocida y aceptada es `-0`, normalizada a `0` desde `3ae4857` (antes de eso, se preservaba en memoria y se perdía sólo en disco — ver `RX4/focal/...MATRIX_3ae4857.md`, fila `round-trip-menos-cero`).

**Materialización única, sin ejecutar getters, sin TOCTOU**: cada frontera pública materializa el dato UNA sola vez, por descriptor (`Object.getOwnPropertyDescriptor`), antes de cualquier otra lectura del núcleo; nunca invoca un `get`. Esto fue el objetivo explícito de `8a9a593`/`5ab524b` y quedó confirmado formalmente por RX2 post-fix (RX2-01/RX2-03 re-verificados con "0 invocaciones", no "1 invocación protegida") y por la ronda M3 final, que agregó los 2 últimos tests de contrato faltantes (`94c2834`, W9-M2a/W9-M2b: "usa SIEMPRE el payload/lote MATERIALIZADO, nunca vuelve a leer el crudo").

**Invariante de round-trip**: `canonicalizar(memoria) === canonicalizar(cargar(disco))` verificado formal con almacén real desde `d36f028` en adelante (test "round-trip formal"), confirmado PASS en la matriz final RX4 focal. La única divergencia de representación conocida (`-0` en memoria vs. `0` en disco antes de `3ae4857`) fue cerrada explícitamente por ese commit.

## 7. Garantías exactas de los dos hallazgos con alcance más delicado

### E3-07 — colisión de escritura por revisión (`addd465`)

La garantía **exacta**, sin sobre-prometer:

- **Es**: un *optimistic revision check* — antes de escribir la revisión N+1 de un documento, `almacen.guardar()` exige que el documento YA existente en disco (si existe) esté exactamente en revisión N. Si dos motores construidos sobre el mismo almacén y el mismo id de proyecto commitean cada uno su propia revisión 1 (ninguno vio al otro), el segundo `guardar()` detecta el conflicto (`CONFLICTO_REVISION_EN_ALMACEN`) y rechaza — el disco conserva el commit del primero, intacto.
- **NO es locking**: no hay ningún mecanismo de exclusión mutua, cola de espera, ni reserva. Es una comparación leída-antes-de-escribir; existe una ventana teórica de carrera entre la lectura y la escritura que este mecanismo no cierra (no probado ni diseñado para concurrencia multi-proceso real del sistema operativo).
- **NO detecta cualquier cambio de contenido** — la detección es exclusivamente por número de revisión. Dos documentos DISTINTOS que, por la razón que sea, coincidieran en la MISMA revisión exacta no serían detectados como conflicto (caso sin evidencia real de que pueda ocurrir con el flujo actual, y sin pérdida posible porque el único camino real hacia una revisión N+1 es a través de un motor que ya validó N — documentado como límite conocido, no como bug).
- **NO es multi-proceso segura** en el sentido de una base de datos con transacciones ACID reales — es un candado de revisión sobre un almacén de archivos, adecuado al alcance de Fase 1 (sin servidor, sin locks distribuidos, sin fusión automática de escrituras concurrentes — exactamente el límite que la resolución humana explícita del gate de Phase 1.1, brief §21, autorizó como "fix mínimo por identidad existente").
- **Excepción documentada**: un re-guardado canónicamente IDÉNTICO al que ya está en disco se permite igual (preserva la idempotencia `load-save-load` ya existente desde Phase 1) — comparado por el string canónico COMPLETO, incluida la revisión, así que dos documentos distintos no pueden colarse por esta excepción sin ser bit a bit iguales (verificado por lectura, `RX_REPORT.md` objetivo 2).

### E3-04b — `Almacen` como puerto interno del composition root (`264c327`)

- **Qué garantiza el código**: nada. No hay ningún mecanismo en TypeScript/JavaScript (proxy, cierre de visibilidad, permisos) que impida que un consumidor que retenga la MISMA instancia de `Almacen` (inevitable estructuralmente: el consumidor la crea con `crearAlmacen()` y se la inyecta al motor) llame `guardar()` directo, sin pasar por `validarProyecto`, sin respetar `baseRevision`, sin generar un `ResultadoTransaccion`. El bypass sigue siendo posible en runtime hoy, exactamente como lo era antes de este commit.
- **Qué garantiza sólo la documentación**: la advertencia explícita ("no lo hagas, esto es un puerto interno del composition root, no una segunda autoridad") en 3 lugares — el JSDoc de la interfaz `Almacen` en `motor.ts`, el JSDoc de `crearAlmacen` en `almacen.ts`, y la entrada correspondiente en `DECISIONS.md`.
- **Por qué no se encapsuló**: hoy no existe en este repo ningún composition root real que instancie `crearAlmacen()` y lo inyecte al motor (eso es trabajo de Fase 2) — encapsular ahora inventariaría una superficie de API sin ningún consumidor real que la ejercite. Decisión explícita, documentada, revisitable cuando ese composition root exista.

## 8. Deudas reales restantes (declaradas, no corregidas en este freeze)

- **W9-M2a / W9-M2b, cerrados en `94c2834`** (ver `PHASE_1_1_MUTATION_REPORT.md`) — eran gaps de TEST, no de producción; ya cerrados con 2 tests de contrato nuevos, no quedan pendientes.
- **RX-03 → cerrado, pero registrar el patrón**: la defensa en profundidad de `validarIdsYContador` en el pipeline de commit (agregada por `c79e485`) es, por decisión documentada, "gate-only por diseño" en algunos puntos y "post-lote" en otros — cualquier operación nueva de Fase 2 que genere ids sin usar el contador compartido con la misma disciplina que las 3 actuales necesita revisarse contra este invariante a mano.
- **RX-04, residual, diferido** (`DECISIONS.md`): dos `SetComportamiento` del MISMO lote con el mismo id explícito — el segundo pisa al primero sin diagnóstico de que la PRIMERA intención del lote fue descartada. No corrompe la IR, no bypasea `baseRevision`; diferido sin evidencia de un consumidor real que lo necesite.
- **`Almacen` sigue sin encapsular** (E3-04b, ver §7) — deuda documentada, no corregida, con justificación explícita de por qué no corresponde a Phase 1.1.
- **P8 (rango del sensor fuera de límite en `SetComportamiento`) sigue diferida** — no implementada, fuera del alcance de los hallazgos de esta remediación (anotado en T2 del documento de feature).
- **RANGO_INCOMPATIBLE_AL_REEMPLAZAR sólo cubierto en la rama `CambiarComponente`**, no en `SetComportamiento` directo — mismo criterio documentado, sin evidencia de un caso real sin cubrir.

## 9. Node 24 y Windows

- **Node 24**: `NODE24_CI_NOT_REPRODUCED`. El entorno de trabajo dispone de `fnm` v22.22.3 y `nvm` v20/v22, ninguno con Node 24 instalado; toda la remediación y verificación corrió sobre Node v26.8.1 (versión real disponible, más nueva que 24). No se instaló Node 24 (fuera del alcance autorizado: no tocar toolchain/instalación). Este freeze no reproduce ni descarta ningún comportamiento específico de Node 24 CI.
- **Windows**: `WINDOWS_UNVERIFIED`. Sin acceso real a un entorno Windows durante esta remediación. El riesgo documentado en la auditoría externa Phase 1 (`renameSync` sobre destino ya existente en NTFS) no fue re-evaluado ni cambia con esta remediación — sigue siendo un límite conocido, no un hallazgo nuevo.

## 10. Verificación final del freeze

- Suite completa: 759/759 (baseline `4a0cad5`) → 956/956 (`94c2834`), 0 fail/cancelled/skipped en cada checkpoint verificado por el orquestador.
- `pnpm typecheck`: 0 errores en cada checkpoint verificado.
- `pnpm fichas:check`: 0 en cada checkpoint verificado.
- `git status --short` del worktree: limpio, verificado antes de escribir este documento (branch `feature/programacion-por-intencion`, HEAD `94c2834`).
- Mutación final (M3, sobre `3ae4857`, script-mode): 69/73 evaluados muertos (94,5%); tras el cierre de W9-M2a/W9-M2b en `94c2834` con 2 tests de contrato nuevos, el estado final es 71/73 muertos (97,3%), 2 sobrevivientes EQUIVALENT demostrados formalmente (N08, D4), 0 REAL_GAP — score sobre no equivalentes: 71/71 = 100%.
- Revisión adversarial final (RX4 focalizada, sobre `3ae4857`, scripts originales sin editar): 0 causa raíz nueva CRITICAL/MAJOR; convergencia declarada (stop rule §26 del gate de cierre) — sin RX5.

---

*Este documento tiene una copia idéntica en el repositorio (`docs/programacion-intencion/PHASE_1_1_REMEDIATION_REPORT.md`) y en este freeze (`~/tecnia-bot-docs/phase1.1/PHASE_1_1_REMEDIATION_REPORT.md`). Ver el resto de los documentos de este freeze para el detalle completo por hallazgo, por test, por ronda de mutación y por ronda adversarial.*
