# DECISIONS.md — decisiones de implementación de Fase 1

Registro vivo, una entrada por decisión, en orden de aparición. Referencia el diseño
consolidado (`T_diseno_consolidado.md`, fuera del repo) y el brief congelado
(`BRIEF.md`) por número de sección, nunca los transcribe.

**Phase 1.1 (hallazgo externo E4-01, MAYOR):** "fuera del repo" arriba refería, en el
momento en que se escribió, al scratchpad efímero de la sesión de Fase 1 — una
ubicación que desaparece al cerrarse la sesión, dejando cada cita `§N` embebida en el
código huérfana e inverificable. El original está ahora archivado de forma durable,
byte a byte, en `~/tecnia-bot-docs/phase1/evidencia_original_sesion/T_diseno_consolidado.md`
(sha256 `3ac6d546649725d2356db6dd4e0d0a7774e59174732367fc9cd90ff44e63193e`, verificado
— ver `PROVENANCE.txt` en esa misma carpeta para la cadena de custodia completa,
incluida la de `X_adversarial_g8.md`/`ARQ_revision_g8.md`/`LISTA_ADVERSARIAL_30.md`/
`x_trabajo/mutation_results.txt`, citados como evidencia primaria en
`PHASE_1_TRACEABILITY.md`/`PHASE_1_AUDIT_REPORT.md`, hallazgo externo E4-02, mismo
patrón).

---

## OD-01 — Schema mínimo de placa (contrato de placa)

**Decisión:** el schema mínimo de placa de Fase 1 separa tres capas que hoy conviven
en `circuito.ts.Placa` (`circuito.ts:213-764`): identidad física/eléctrica (pools de
pines por banco, capacidades, restricciones, `adcMax`, voltaje), referencia a backends
(`platformio.board/platform/framework`, `wokwi.elemento`) como **datos**, y aliases
humanos/LLM. La prosa de rechazo en español (`motivoRechazo`/`notaDePin`) queda fuera
del contrato: es responsabilidad de una capa de presentación que traduce `motivos[]`
estructurados, no del catálogo.

Set mínimo de Fase 1: `esp32-devkit-v1` y `arduino-uno`. Justificación de incluir UNO:
prueba que el contrato generaliza sobre el caso banco-D≠banco-A (`circuito.ts:168-190`,
bug histórico ya corregido en `circuito.ts` para el asignador automático), que ESP32
solo no obliga a resolver.

Un backend id (`board=` de PlatformIO, elemento de Wokwi) NUNCA resuelve
implícitamente al id semántico: sólo si está declarado explícitamente en `alias[]`.
Razón: hoy `PlacaId:"uno"` y `board:"uno"` coinciden por casualidad de nomenclatura
entre autores, no por diseño; tratarlo como regla general perpetuaría esa coincidencia.

`pinouts.json` no se modifica ni se reemplaza (§8.2, §18.6, §25 del brief); se agrega
un test de adaptador que verifica acuerdo puntual donde se solapan (semáforo ESP32,
GPIO16/17/18).

Formato de datos: módulo TypeScript declarativo (objeto `Record<string, Placa>`), no
JSON — mismo patrón que `circuito.ts` ya usa para `PLACAS`/`SHIELDS`, sin dependencias
nuevas.

**Evidencia:** `circuito.ts:213-764`, `skills/placas/SKILL.md`,
`ejemplos/blink-esp32/platformio.ini`, `ejemplos/blink-uno/platformio.ini`,
`opencode/tecniabot-web/pinouts.json`, `tests/circuito.test.mjs`,
`tests/pinouts.test.mjs`, `tests/catalogo-placas.test.mjs`.

**Consecuencias:** `opencode/nucleo/placas.ts` puede evolucionarse (Fase 2+: ESP8266
real, más placas) sin tocar `circuito.ts`; el día que un consumidor de Fase 2 quiera
generar el HTML desde el registro nuevo, tiene que agregar la capa de render que hoy
se dejó fuera a propósito.

---

## Ubicación y estructura del código (`opencode/nucleo/`)

**Decisión:** todo el núcleo de "Programación por Intención" vive en
`opencode/nucleo/`, nunca en `opencode/tool/`. Razón: OpenCode escanea
`{tool,tools}/*.{js,ts}` (`packages/opencode/src/tool/registry.ts`, citado en
`CURRENT-ARCHITECTURE.md` §3) e importa cada archivo encontrado ahí como una TOOL
del agente — un módulo de núcleo sin `execute()`/schema de tool rompería ese
contrato o, peor, se registraría como una tool inválida en silencio.

`tsconfig.json` agrega `"opencode/nucleo/**/*.ts"` a `include` — es el único cambio
autorizado a ese archivo en Fase 1.

## Nomenclatura en español rioplatense

**Decisión:** todos los identificadores de `opencode/nucleo/` (tipos, campos,
funciones, códigos de motivo) van en español, mismo criterio que ya usa
`circuito.ts` (`Placa`, `Pedido`, `motivoRechazo`). Los diseños fuente (B/C/D)
convergieron en inglés sin coordinarse entre ellos — es una desviación real del
estilo del repo y de su propio `CLAUDE.md` ("todo lo que escribas ... va en
español"), corregida en el diseño consolidado (`T_diseno_consolidado.md` §0) y
aplicada acá.

## Set de placas de Fase 1: 2, no más

**Decisión:** sólo `esp32-devkit-v1` y `arduino-uno`. ESP8266 (NodeMCU/D1 mini) queda
DEFER explícito — está en `skills/placas/SKILL.md` con mapa de GPIO en prosa, pero sin
pools de pines estructurados: agregarlo ahora sería inventar datos de hardware. Se
shipea únicamente como entrada de "conocida pero no soportada"
(`PLACAS_NO_SOPORTADAS`), para no reinventar esa distinción cuando se porte de verdad
en una fase posterior.

## `restricciones` de pin: enum cerrado de 4 valores

**Decisión:** `"soloEntrada" | "strapping" | "flashReservado" | "uartUsb"`, cerrado
para Fase 1 (no abierto por catálogo). Son las únicas 4 restricciones con evidencia
real hoy (`circuito.ts:334-348`). Si Fase 2+ agrega ESP8266/Bhoot y aparece una
restricción nueva, se reabre esta decisión con evidencia, no antes.

## `touch` diferido

**Decisión:** el campo `capacidades.touch` existe en el tipo (para no romper la forma
más adelante) pero siempre es `false` en Fase 1 — ningún proyecto INET auditado lo usa
hoy.

## Undo-readiness (OD-21) — anotado para gates futuros

**Decisión del orquestador, aplicada cuando se implemente el Project Engine (Gate 6):**
buffer en memoria, acotado a 50 transacciones aceptadas, nunca persistido. No aplica
a Gate 1 (placas.ts no tiene estado ni transacciones); se deja registrado acá para que
la decisión no se pierda entre gates.

**Phase 1.1 (hallazgo externo E3-06, MENOR):** el diseño original de este buffer
(§31 de la auditoría externa) confirmó que la complejidad es mínima y justificada,
que sólo entran transacciones ACEPTADAS (nunca dry-run/reject/fallo de persistencia,
verificado por test), y que la API pública no depende de él hoy — pero encontró que
`obtenerBufferUndo()` sólo clona el ARRAY contenedor (`slice()`), nunca cada entrada:
el mismo objeto `ResultadoTransaccion` que se devuelve a quien commiteó queda
también guardado dentro del buffer, sin copia defensiva. Un consumidor que mutara el
resultado devuelto corrompía en el lugar la entrada histórica. Clasificado A (fix
barato, mismo patrón ya usado para `Proyecto`): `motor.ts` ahora pasa CADA
`ResultadoTransaccion` (los 8 posibles caminos de `ejecutarLote`, no sólo el que
entra al buffer) por `congelarProfundo` antes de devolverlo. El buffer SIGUE
compartiendo la misma referencia por diseño (eso es intencional, barato, y es lo que
permite comparar `===` en los tests) — lo que cambió es que esa referencia compartida
ya no es mutable. No se removió el buffer: Phase 1 no exige undo/redo, pero eliminarlo
retrocedería respecto de la preparación que el brief pide para Fase 2 (§9.2), y el
propio auditor lo calificó de diseño ya JUSTIFICADO. Test:
`tests/nucleo-motor.test.mjs`, sección "hallazgo externo E3-06".

## `Almacen.list()` y detección de modificación externa — fuera de Fase 1

**Decisión del orquestador:** ambos quedan fuera del alcance mínimo de Fase 1
(`almacen.ts`, Gate 7). Documentado acá como límite conocido, no como olvido.

**Phase 1.1 (hallazgo externo E3-07, MAJOR):** la colisión de ESCRITURA entre dos
motores que comparten almacén y mismo id de proyecto ahora SÍ se detecta — resolución
humana explícita de Phase 1.1 (brief §21, nivel de autoridad superior a esta entrada:
"si puede resolverse con identidad explícita de proyecto/revisión ya existente: fix
mínimo"). Esto NO reabre `Almacen.list()` ni una detección GENERAL de modificación
externa (nada de listar/escanear el directorio, nada de observar el disco fuera de una
escritura en curso) — el alcance es estrictamente la colisión de escritura, resuelta
con un compare-and-swap sobre la revisión YA existente (`guardar()`, ver la entrada de
Gate 7 más abajo para el detalle y el límite conocido que sí queda). Ver
`docs/programacion-intencion/OPERATIONS.md` §10.

## `Connect` — invariantes estructurales cerradas

**Decisión del orquestador (aplica a Gate 4/5, `validar-estructural.ts`/
`operaciones.ts`):** conectar un terminal consigo mismo → `RECHAZO` (dos extremos
distintos es invariante estructural). Conectar un par de terminales ya conectado
exactamente igual → `RECHAZO` (un par de terminales está conectado a lo sumo una vez).
`SetProperty` con valor de tipo correcto pero fuera de rango queda fuera de Fase 1
(sin clasificar A/B por nadie todavía — necesita entrada en `OPERATIONS.md` antes de
escribir el validador de rango).

## Invariante de vista — test explícito pendiente (Gate 5)

**Decisión del orquestador:** el invariante "una operación cambia sólo su entidad
destino y los efectos derivados que las reglas exigen" se testea a nivel de IR en
Gate 5, con un fixture de 2 componentes no relacionados y assert de igualdad profunda
del componente no tocado. No se resuelve en Gate 1 (no hay operaciones todavía); se
deja anotado para no perder la decisión.

**Phase 1.1 (hallazgo externo E4-03, MENOR):** el test explícito de este invariante,
al cerrarse Gate 5 originalmente, sólo se escribió para 2 de las 8 operaciones
(`AsignarPin`, `CambiarComponente`) — con `===` (identidad de referencia), no sólo
`deepEqual`, corrigiendo lo que esta entrada decía arriba ("igualdad profunda"). Las
6 operaciones restantes (`SetPlaca`/`AgregarComponente`/`QuitarComponente`/`Conectar`/
`Desconectar`/`SetComportamiento`) ya cumplían el contrato en el código (todas usan
`.map`/`.filter`/spread que reusan por referencia lo no tocado), pero sin regresión
propia — confirmado por mutación externa (`m4`: `.map((cx)=>({...cx}))` en
`aplicarDesconectar` sobrevivía). Phase 1.1 cierra el gap de cobertura sin tocar
código de producción: un test por operación en `tests/nucleo-operaciones.test.mjs`,
sección "invariante-de-vista".

## Corrección: el comentario de `canonico.ts` mentía sobre el orden de array

**Hallazgo (revisión externa del orquestador, Gate 2):** el comentario original de
`canonico.ts` decía "el motor/loader nunca reordena los arrays de entrada" — falso:
`cargarProyecto()` (cargador.ts) SÍ los reordena, por id local, antes de congelar.
Corregido en el propio archivo y documentado en detalle en `IR-SPEC.md` §3 (qué hace
`canonicalizar()` vs. qué hace `cargarProyecto()`, y por qué el orden de array no
importa de todas formas: coincide con el orden de creación porque los ids salen de un
contador monotónico). Regla del repo aplicada literalmente: "un OK falso es peor que
un error" — un comentario incorrecto sobre el propio código es la misma clase de
falla que un test que no prueba nada.

**Phase 1.1 (hallazgo externo M23, MENOR):** todos los tests que ejercitan
`canonicalizar()` comparaban `canonicalizar(X)` contra `canonicalizar(Y)`, usando la
MISMA función de los dos lados — un mutante que invirtiera el criterio de orden
(ascendente → descendente) sobrevivía sin que ningún test lo notara. Se agregó
`tests/nucleo-canonico-golden.test.mjs`: un `Proyecto` de ejemplo fijo, con su string
canónico y su sha256 fijados como LITERAL (no generados llamando a `canonicalizar()`
dentro del test) — oráculo de oro clásico, independiente del código bajo prueba. Sin
cambio de código de producción: `canonicalizar()` ya cumplía el contrato de
`IR-SPEC.md` §3 por lectura: se confirma con este test, no se corrige nada.

## Prioridad/conflicto entre reglas de comportamiento — DIFERIDA a Fase 3

**Decisión del orquestador:** cuando dos `ComportamientoRegla` apuntan al mismo
`entonces.actuador` con condiciones que podrían dispararse a la vez (ej. una dice
"encender", otra "apagar", ambas verdaderas), Fase 1 **no define** cómo se resuelve
— y en particular, el orden del array `Proyecto.comportamientos` NO decide (§3 de
`IR-SPEC.md`: el orden no lleva semántica en Fase 1, es un derivado del id de
creación). La composición/ejecución de reglas en vivo es del motor de reglas de Fase
3 (brief §27), posterior a Blockly/codegen — `nucleo/` en Fase 1 sólo modela y valida
la IR, nunca la ejecuta. Documentado en `IR-SPEC.md` §3.1.

## Gate 7 (`almacen.ts`) — límites de durabilidad documentados

**Sin `fsync`/`fdatasync`:** igual que el patrón ya existente en `memoria.ts`/
`perfil.ts`/`clave.ts` (`CURRENT-ARCHITECTURE.md` §9) — la durabilidad ante un corte
de luz depende del filesystem/SO, no está mitigada por la app. No es una omisión de
Gate 7: es el mismo criterio que el repo ya usa en los tres precedentes reales.

**`renameSync` en Windows:** no probado en este gate — CI corre `tests/*.test.mjs`
sólo en el job Linux (igual que el resto de la suite, `CURRENT-ARCHITECTURE.md` §11).
Un `renameSync` sobre un destino que YA EXISTE puede comportarse distinto entre
POSIX y Windows según el filesystem/permisos (en NTFS, con el archivo destino abierto
por otro proceso, puede fallar donde en Linux no); queda como límite conocido, a
confirmar si Fase 2+ corre este núcleo bajo Windows de verdad.

**Sin locks, un solo escritor:** mismo modelo implícito que `memoria.ts` (no
declarado como asunción explícita ahí tampoco). `Almacen.list()` y la detección de
modificación externa quedan fuera de Fase 1 (decisión ya registrada arriba, Gate 1).

**Phase 1.1: la colisión de escritura ahora se detecta por revisión** (hallazgo
externo E3-07, MAJOR — resolución humana explícita, ver la entrada de arriba). Sigue
"sin locks": `guardar()` no bloquea ni serializa nada, sólo COMPARA la revisión que ya
está en disco contra la que el llamador cree reemplazar (`proyecto.revision - 1`)
justo antes de escribir, y rechaza si no coincide (nuevo código
`CONFLICTO_REVISION_EN_ALMACEN`, categoría `almacen`) — sin base de datos, sin locks
distribuidos, sin fusión automática de escrituras concurrentes, sin servidor. Límite
conocido que SÍ queda (documentado, no un descuido): la detección es por REVISIÓN, no
por contenido — si dos documentos DISTINTOS con el mismo id coincidieran en la MISMA
revisión de forma exacta (mismo `canonicalizar()`), no habría nada que detectar (son
indistinguibles de un simple re-guardado idempotente, y no hay pérdida real posible en
ese caso). Ver `almacen.ts` (`guardar()`) y `OPERATIONS.md` §10.

## Hallazgo adversarial Gate 8 (Agente X) — motor.ts no filtraba rechazo post-lote

**Qué encontró:** una revisión adversarial independiente (Agente X, sobre una copia
aislada del worktree, nunca sobre el original) reportó que `motor.ts` cortaba el
lote ANTES de commitear sólo mirando los motivos `clasificacion:"rechazo"` que
produce `aplicarOperacion` por operación (`operaciones.ts`) — nunca revisaba si
`validarProyecto(borrador, catalogo)`, corrida DESPUÉS de aplicar todo el lote,
también traía un motivo `clasificacion:"rechazo"`. `validar-estructural.ts` sí puede
emitir uno (`REFERENCIA_INEXISTENTE`); `validar-tecnico.ts` nunca usa esa
clasificación. Repro: construir el motor con un `proyectoInicial` ya roto (una
conexión colgando, bypaseando `cargarProyecto`) + una operación trivial no
relacionada → `motor.aplicar()` devolvía `ok:true`, persistía, y subía la revisión.

**Severidad real:** no explotable hoy por las 8 operaciones públicas de Fase 1
(todas re-chequean referencias antes de mutar) — era una violación LATENTE del
contrato representable-vs-rechazo, alcanzable sólo si alguien bypasea el loader para
construir el motor, o si una regla de validación futura gana esa clasificación de
forma alcanzable vía las operaciones normales.

**Decisión y arreglo (dos capas, ambas necesarias):**
1. `crearMotorDeProyecto` corre `validarProyecto(proyectoInicial, catalogo)` una vez
   al construirse y **lanza** `ErrorEstadoInicialInvalido` (con `.motivos`
   estructurado) si encuentra un rechazo — el motor directamente no se deja
   construir sobre un estado ya roto.
2. Defensa en profundidad: el pipeline de commit ahora también corta el lote si
   `validarProyecto()` post-aplicación trae un rechazo — aunque (1) ya cierre el
   único camino conocido para llegar a ese estado, la segunda capa protege contra
   una regla de validación futura que lo vuelva alcanzable sin que alguien se
   acuerde de revisar el pipeline de commit.

Ver `OPERATIONS.md` §8 (contrato de construcción del motor) e `IR-SPEC.md` §6 (el
loader sólo cubre documentos que pasan por `cargarProyecto()`, no un `Proyecto`
armado a mano). Tests y mutación: `tests/nucleo-motor.test.mjs` (2 tests nuevos) +
`tests/nucleo-adversarial.test.mjs` (suite completa de Agente X incorporada).

**Otro hallazgo, menor (mismo informe):** `asignarPin` (catalogo.ts) tenía una rama
(`terminal.requierePwm && !pin.capacidades.pwm`) implementada correctamente desde
Gate 3 pero sin NINGÚN test que la ejercitara — sobrevivió a la campaña de mutación
de Agente X (mutante M16) sin que ninguna de las 143 pruebas existentes lo notara.
Se agregó el test faltante (`tests/nucleo-catalogo.test.mjs` + incorporado también
en `tests/nucleo-adversarial.test.mjs`), sin tocar la lógica de producción (ya era
correcta, sólo le faltaba cobertura).

## Revisión de arquitectura independiente Gate 8 (§77) — 2 trampas latentes cerradas

**Qué encontró:** una segunda revisión independiente (arquitectura, no adversarial —
12/12 ítems del checklist PASS, 0 FAIL/CONTRADICTION) marcó 2 hallazgos
`PASS_WITH_NOTE`: riesgos arquitectónicos latentes, no explotables hoy, pero que
convenía cerrar ANTES de que exista un consumidor de Fase 2.

1. **`DependenciasMotor.validarProyecto` (motor.ts) era un backdoor potencial.** El
   campo era público, opcional, y REEMPLAZABA la validación real — nada en runtime
   impedía que un consumidor futuro construyera el motor con
   `validarProyecto: () => []` y obtuviera un motor que "aprueba todo", anulando
   exactamente la garantía representable-vs-rechazo que Gate 8 protege. Única
   barrera: un comentario ("nunca se inyecta en producción") — honor system, sin
   assert en runtime.
   - **Arreglo:** el campo se renombra `validacionAdicionalSoloTests` (el nombre
     grita su propósito) y cambia de semántica: la validación REAL (`validar.ts`)
     SIEMPRE corre, tanto al construirse como en cada commit; lo inyectado sólo
     puede AGREGAR motivos al resultado real (unión), nunca reemplazarlo ni
     vaciarlo. Un `() => []` inyectado ahora no tiene ningún efecto sobre la
     validación real — se probó explícitamente que un estado roto se sigue
     rechazando y que un motivo representable real (`PIN_OCUPADO`) sigue
     apareciendo, aunque se inyecte esa función vacía.
   - Mismo razonamiento aplicado a `clonar` (menor severidad: romper el clonado no
     anula representable-vs-rechazo, sólo el aislamiento de referencias) — se
     agregó un centinela en la construcción: si `clonar(x) === x` para un objeto de
     prueba descartable (o sea, no aísla — una función identidad, por ejemplo), el
     motor tira `ErrorClonadoInvalido` en vez de aceptar un "clon" que en realidad
     comparte referencia. No se sacó el seam porque un test real lo necesita
     (espiar cuántas veces se llama `clonar` para probar "baseRevision obsoleta
     corta ANTES de clonar").

     **Phase 1.1 (hallazgo externo E3-02, MENOR):** el centinela de arriba era
     PLANO (`{ __centinelaClonar: true }`) — sólo detectaba identidad de nivel
     SUPERIOR. Un `clonar` que hace copia SUPERFICIAL (`(v) => ({...v})`) devuelve
     una referencia NUEVA en el nivel superior y pasaba el centinela sin lanzar,
     aunque compartiera por referencia cualquier objeto anidado (`pines`,
     `propiedades`, etc.) con el canónico — exactamente el aislamiento que el
     centinela existe para garantizar (evidencia/e3/scripts/e1_motor_flujo.mjs
     TEST 3). Clasificado A (fix barato, mismo lugar): el centinela ahora es
     anidado (`{ __centinelaClonar: true, anidado: { __centinelaClonar: true } }`)
     y chequea DOS niveles — identidad de nivel superior (como antes) Y que el
     objeto anidado no siga siendo la misma referencia. Test:
     `tests/nucleo-motor.test.mjs`, "clonar inyectado que hace copia SUPERFICIAL...
     (hallazgo externo E3-02)".
2. **`operaciones.ts::ejecutarOperacion` tenía la MISMA clase de gap que motor.ts
   antes de su fix** (ver la entrada de arriba, "hallazgo adversarial Gate 8"):
   devolvía `ok:true` sin revisar `clasificacion:"rechazo"` en
   `validarProyecto(proyectoAplicado, catalogo)`. Mitigante real: `ejecutarOperacion`
   NO se usa en producción (sólo en tests; `motor.ts` implementa su propio
   pipeline y no la reusa) — pero es una trampa latente para un futuro consumidor
   que la llame directo creyendo que replica el contrato completo del motor.
   - **Arreglo:** alineado con el mismo contrato — un motivo `clasificacion:"rechazo"`
     en la validación post-aplicación tumba el resultado (`ok:false`, se devuelve el
     `proyecto` ORIGINAL, nunca el aplicado a medias), igual que un rechazo de la
     operación misma. Documentado en `OPERATIONS.md` §7.

Ver `motor.ts` (docstring actualizado), `OPERATIONS.md` §7-8, y
`tests/nucleo-motor.test.mjs`/`tests/nucleo-operaciones.test.mjs` (tests + mutación).

## Almacen es un puerto interno del composition root (Phase 1.1, hallazgo externo E3-04b, MAJOR)

**Qué encontró la auditoría externa:** `Almacen`/`crearAlmacen()` (Gate 7) es una
interfaz PÚBLICA e independiente del motor. Cualquier código que retenga la MISMA
instancia de `Almacen` (algo estructuralmente posible hoy: el consumidor la crea con
`crearAlmacen()` y se la INYECTA a `crearMotorDeProyecto({ almacen })`) puede llamar
`guardar()` DIRECTO — sin pasar por `validarProyecto`, sin respetar `baseRevision`,
sin generar un `ResultadoTransaccion` — y el motor en memoria queda desincronizado de
lo persistido, sin ningún aviso (evidencia/e3/scripts/e1_motor_flujo.mjs TEST 5). Esto
rompe "el Project Engine es la única autoridad de mutación" (brief §9.4/§10) a nivel
de PERSISTENCIA, aunque el `canonico` del motor en memoria siga intacto.

**Decisión del orquestador (Phase 1.1):** la opción MÁS PEQUEÑA que hace no-contractual
usar `Almacen` como segunda autoridad — documentarlo como PUERTO INTERNO del
composition root, nunca encapsularlo con un subsistema nuevo (proxy, permisos,
wrapper). No hay hoy, en este repo, ningún código de producción que construya
`crearAlmacen()` y lo inyecte al motor (Fase 2, fuera de alcance) — encapsular ahora
sería inventar una superficie de API sin un consumidor real que la ejercite. En su
lugar: `Almacen`/`crearAlmacen()` llevan JSDoc explícito (`motor.ts`/`almacen.ts`)
que dice, en el mismo lugar donde un futuro consumidor los lee, que se construyen UNA
vez, se inyectan al motor, y DEJAN de tocarse — retener la referencia para llamar
`guardar()`/`cargar()` por fuera del motor es un uso NO CONTRACTUAL, aunque el
type-checker no lo impida. Sin test nuevo: esta decisión no cambia ningún
comportamiento observable (el bypass sigue siendo posible en runtime, como cualquier
violación de un contrato de USO en TypeScript/JavaScript — mismo límite que, por
ejemplo, mutar un objeto `readonly` con un cast) — un test no protegería nada real,
sólo simularía haber "cerrado" algo que la documentación, no el código, es lo que
cierra acá.

**Revisitar en Fase 2** cuando exista un composition root real: ahí sí evaluar si
encapsular (ej. que el motor exponga su propio `guardar`/`cargar` internamente y
`crearAlmacen()` deje de exportarse desde el punto de entrada público) vale la pena
contra el costo de la superficie de API nueva.

## Phase 1.1 — clasificación de hallazgos no bloqueantes (T7)

Cuatro hallazgos MENORES/NOTA de `PHASE_1_EXTERNAL_FINDINGS.md`, clasificados A
(barato/bajo riesgo/contractual: se corrige acá) / B (documentado, diferido) / C
(requiere decisión humana):

| Hallazgo | Clasificación | Motivo |
|---|---|---|
| E3-06 | **A** | `congelarProfundo` sobre `ResultadoTransaccion` es el MISMO patrón ya usado para `Proyecto`; cero cambio de semántica aceptación/rechazo. Ver entrada "Undo-readiness (OD-21)" arriba. |
| E3-02 | **A** | Reforzar el centinela con un objeto anidado es exactamente el fix sugerido por el propio auditor; mismo lugar, mismo patrón, cero cambio de semántica. Ver entrada "Revisión de arquitectura independiente Gate 8" arriba. |
| E2-04 | **B/documentación** | Separar físicamente categoría-de-dato y módulo-emisor en dos taxonomías sería inventar una segunda clasificación sin consumidor real (nada en Fase 1 filtra motivos por módulo emisor). Se documenta explícitamente en `motivos.ts` (JSDoc de `CategoriaMotivo`) que son ejes independientes por diseño — sin reescribir ninguna categoría existente, sin tocar código de producción. |
| E1-04 | **B** (T7) → **RECLASIFICADO A CRÍTICO** (Phase 1.1 RX4, ver nota abajo) | `esEnteroNoNegativo` sin cota superior es una NOTA, no un defecto — el propio auditor confirma "no explotable en la práctica (requeriría ~9×10^15 commits)". Agregar un tope (aunque fuera `Number.MAX_SAFE_INTEGER`, la constante técnica más defendible) cambiaría el comportamiento de DOS puertas de entrada (`cargador.ts`: `revision`/`siguienteIdLocal`; `motor.ts`: `baseRevision`) para cerrar un riesgo que ningún documento de contrato (`IR-SPEC.md`/`OPERATIONS.md`) menciona ni acota hoy — sería inventar una regla de producto nueva (¿cuál es el tope "correcto"?) sin autoridad contractual que la pida. Se deja documentado como límite conocido, sin código nuevo; revisitar si Fase 2 introduce un escenario real donde la magnitud de `revision` importe (hoy no existe ninguno). **Phase 1.1 (RX4): reclasificado — RX4-02 (cuarta revisión adversarial independiente, `RX4_REPORT.md`) demostró que "no explotable en la práctica" era una premisa incorrecta: NO hace falta ~9×10^15 commits reales — UN SOLO documento manipulado/importado con `"revision": 1e21` (JSON válido, `Number.isInteger(1e21) === true`) alcanza. `1e21 + 1 === 1e21` por colapso de precisión IEEE-754 más allá de `Number.MAX_SAFE_INTEGER`, así que la revisión queda congelada para siempre en ese documento — y como `baseRevision !== canonico.revision` es la ÚNICA defensa contra escritura concurrente/perdida (E3-01 en memoria, E3-07 contra disco), el compare-and-swap optimista queda neutralizado en silencio, exactamente el "lost update silencioso" que brief §33 prohíbe. La cota SÍ tiene ahora autoridad contractual: no es una regla de producto arbitraria, se DERIVA del invariante ya existente ("el incremento de `revision` tiene que ser exacto", E3-01/E3-07) — `Number.isSafeInteger` es la cota mínima que ese invariante exige, ni más ni menos. Fix aplicado: `esEnteroNoNegativo` (`cargador.ts`) usa `Number.isSafeInteger`; `motor.ts` además rechaza un commit cuyo `revision + 1` ya no sería exacto (guarda adicional, cubre el caso límite `revision === MAX_SAFE_INTEGER` incluso con una carga válida); `operaciones.ts` aplica la misma guarda al contador de ids (`siguienteIdLocal`). Ver `IR-SPEC.md`/`OPERATIONS.md`/`motivos.ts` para el detalle completo.** |

## Phase 1.1 (RX4) — `-0` normalizado a `0` en `materializarDatosPlanos` (NOTE)

| Hallazgo | Clasificación | Motivo |
|---|---|---|
| RX4 (round-trip-menos-cero) | **A** | `JSON.parse("-0")` produce `-0` en memoria, pero `JSON.stringify(-0)` da el string `"0"` — divergencia real memoria↔disco para un valor numérico (el gate exige que no la haya). A diferencia de NaN/±Infinity (decisiones de negocio reales, `UMBRAL_NO_FINITO`), `-0`/`0` son el MISMO valor con `===`/cualquier comparación aritmética — normalizar es una corrección de REPRESENTACIÓN, no de significado, así que no hace falta ninguna autoridad contractual nueva (no hay dos significados que confundir). Fix barato, un solo lugar (`materializarDatosPlanos`, la única frontera por la que pasa todo dato numérico del núcleo): `Object.is(v, -0) ? 0 : v`, en el mismo punto que procesa cualquier `number`. No cambia ningún veredicto ni código de rechazo existente — ver `IR-SPEC.md` §6.10. |

## Phase 1.1 (RX) — `SetComportamiento`: reemplazo intra-lote con id explícito duplicado (hallazgo externo RX-04, MENOR, residual)

**Qué encontró RX:** si dos operaciones `SetComportamiento` del MISMO lote usan
explícitamente el MISMO `id` (adivinando el valor que el contador va a asignar), la
primera crea un comportamiento nuevo con ese id, y la segunda — viéndolo YA
existente en el borrador intermedio dentro del mismo lote — lo trata como reemplazo
y sobreescribe la primera intención por completo. Con el fix de este mismo hallazgo
(`COMPORTAMIENTO_REEMPLAZADO`, `OPERATIONS.md` §9.6), la SEGUNDA operación SÍ queda
documentada como reemplazo — pero no hay ningún rastro adicional de que la intención
de la PRIMERA operación (dentro del MISMO lote, nunca persistida por sí sola) fue la
descartada.

**Decisión del orquestador (Phase 1.1):** DIFERIDO, no corregido acá. Detectar
específicamente "un id que otra operación del MISMO lote acaba de crear" requeriría
que `aplicarSetComportamiento` (Gate 5, función pura sobre una única operación) supiera
distinguir "existía ANTES del lote" de "lo creó una operación anterior del MISMO
lote" — información que hoy no lleva el `Proyecto`/`borrador` que recibe (ambos casos
son indistinguibles: el id ya está en `proyecto.comportamientos`). Inventar esa
distinción sin un caso de uso real que la necesite (el llamador tendría que estar
adivinando ids explícitos activamente, un patrón que ninguna de las 8 operaciones
públicas fomenta) sería una regla de producto nueva sin autoridad contractual. No
corrompe la IR canónica, no rompe atomicidad ni bypassea `baseRevision` — es un caso
límite de UX/auditoría, no un bypass de autoridad. Revisitar si Fase 2 introduce un
consumidor real (agente/UI) que arme lotes con ids explícitos adivinados.

Ver `evidencia/T7/` (Phase 1.1) para la evidencia RED/GREEN/mutante de E3-06 y E3-02.

## Phase 1.1 (RX3) — el fix ataca el CONTENEDOR (causa raíz), no el nombre de la clave; "__proto__"/"constructor"/"prototype" NUNCA se rechazan por nombre (hallazgo externo RX3-01, CRÍTICO)

**Qué encontró RX3:** `materializarDatosPlanos` (`datos-planos.ts`) construía su
copia con `copia[clave] = valor` sobre un objeto plano `{}` — que hereda el setter
mágico `Object.prototype.__proto__`. Una clave literal `"__proto__"` en un documento
JSON válido (vía `JSON.parse`, nunca un literal de objeto JS — ver `IR-SPEC.md`
§6.7) disparaba ese setter y corrompía el prototipo de la copia, en vez de crear una
propiedad propia. Ver `RX3_REPORT.md` para el detalle completo y el impacto.

**Primer intento (revisado, ver más abajo):** una primera ronda de este mismo fix
combinó dos capas: (a) rechazo explícito de la clave `"__proto__"` por nombre, (b)
`Object.defineProperty` como defensa en profundidad. Una revisión posterior (con
evidencia — ver `evidencia/RX3fix/verif_theory.mjs`/`causa.md`) encontró que la capa
(a) era, además de redundante, **incorrecta**: rechazaba por nombre una clave que,
una vez arreglado el contenedor, es tan inofensiva como cualquier otra — violando
sin necesidad el contrato de `propiedades` ("bolsa abierta: acepta CUALQUIER clave
como dato"). Esta entrada documenta la decisión FINAL.

**Decisión final: el fix ataca la CAUSA (el contenedor), nunca el síntoma (el
nombre de la clave).** El defecto real no es "`__proto__` es peligrosa" — es que
CUALQUIER objeto plano fresco (`{}`) construido con asignación por corchetes
(`obj[k] = v`, semántica `[[Set]]`) es vulnerable a un accessor heredado, sea cual
sea su nombre. La corrección: **todo punto del núcleo que copia una clave de
USUARIO a un objeto fresco usa `Object.defineProperty` (semántica
`[[DefineOwnProperty]]`), nunca asignación por corchetes.** Se auditó
exhaustivamente con `rg` (`\[[a-zA-Z_]+\]\s*=`, `Object\.assign`) y se encontraron
y corrigieron TRES sitios, los tres con la MISMA causa raíz:

1. `datos-planos.ts::materializarDatosPlanos` (rama objeto) — el hallazgo original.
2. `canonico.ts::ordenarClavesProfundo` (RX3-04) — usado por `canonicalizar()`
   (`almacen.ts`, persistencia real; `catalogo.ts`, hash). Con el fix de (1) YA NO
   protege contra un ataque "no explotable hoy": con el contenedor de (1) seguro,
   `propiedades.__proto__` sobrevive como dato legítimo y SÍ llega a
   `canonicalizar()` en cada `guardar()` real — este sitio es, con la decisión
   final, tan alcanzable como (1), y el mutante que lo revierte lo confirma (ver
   evidencia, `mutante_canonico_resultado.txt`: 1/19 tests muere, el round-trip
   formal contra almacén real).
3. `cargador.ts::validarComponente` (`pinesCopiados[clave] = valorPin`) —
   encontrado en esta misma auditoría, no reportado por RX3: si `pines.__proto__`
   trae un valor STRING (pasa el chequeo de tipo `string|null` de esa misma
   función), este bucle propio de `cargador.ts` corrompía el prototipo de
   `pinesCopiados` de forma INDEPENDIENTE del fix de (1) — porque construye SU
   PROPIA copia nueva, después de que el dato ya llegó plano y seguro desde (1).
   Confirmado explotable y corregido con el mismo patrón (mutante lethal, ver
   evidencia, `mutante_cargador_pines_resultado.txt`).

Se verificó (y se dejó registrado, `evidencia/RX3fix/verif_theory.mjs`) que el
spread (`{...x}`) y las claves COMPUTADAS dentro de un OBJECT LITERAL fresco
(`{ ...c.pines, [payload.terminal]: payload.pin }`, `operaciones.ts`) usan semántica
`CreateDataProperty` — NUNCA `[[Set]]` — así que son seguros por construcción sin
ningún cambio, incluso cuando la clave computada evalúa a `"__proto__"` en tiempo de
ejecución. No se encontró ningún `Object.assign` en `opencode/nucleo/*.ts`.

**Con el contenedor seguro en los TRES sitios, NINGÚN nombre de clave tiene efecto
especial** — confirmado empíricamente (`verif_theory.mjs`): `Object.defineProperty`
crea una propiedad OWN real, nunca dispara el setter heredado; `Object.keys`/
`Object.entries`/`JSON.stringify`/`assert.deepStrictEqual`/`Object.freeze` tratan esa
propiedad exactamente igual que cualquier otra. Por eso:

- **Se retira el rechazo explícito por nombre.** `"__proto__"`, igual que
  `"constructor"`/`"prototype"`/`"toString"`/`"hasOwnProperty"` (ninguno de estos
  es un accessor de `Object.prototype` — son propiedades de DATOS comunes,
  confirmado por la batería de ataque de la auditoría,
  `RX3/scripts/05_bateria_controles.mjs`), sobrevive como propiedad propia normal.
- En una entidad de forma **CERRADA** (raíz del `Proyecto`, `Componente`/
  `Conexion`/`ComportamientoRegla`, el SOBRE de una operación) esa clave cae en
  `CLAVE_DESCONOCIDA` — el MISMO mecanismo fail-closed que ya existía para
  cualquier otra clave no declarada, sin necesitar un segundo código especial.
- En una bolsa **ABIERTA** (`propiedades` de un `Componente`; `pines`, que
  tampoco valida NOMBRES de terminal, sólo tipos de valor — Gate 4 simplemente
  nunca lee un terminal que el catálogo no declara, lo deja como dato huérfano
  inerte, igual que cualquier otra clave de pin desconocida) esa clave se ACEPTA
  como dato ordinario, preservada exacta — exactamente lo que el contrato de
  "bolsa abierta" ya prometía, sin la excepción injustificada que la primera
  ronda de este fix había introducido.

**Evidencia que sostiene esta decisión** (`evidencia/RX3fix/`): `causa.md`
(análisis de causa raíz completo, escrito ANTES del fix de raíz), tests explícitos
para `"__proto__"`/`"constructor"`/`"prototype"` en raíz/anidada/`propiedades` por
las 4 puertas (`nucleo-datos-planos.test.mjs`, `nucleo-ir-cargador.test.mjs`,
`nucleo-motor.test.mjs`, `nucleo-operaciones.test.mjs`), un round-trip formal contra
un almacén REAL con `fs` falso (`nucleo-almacen.test.mjs`, guardar → cargar →
`canonicalizar` idéntica), y tres mutantes letales: **W9-M1** (revertir el
contenedor a `copia[clave]=valor`, semántica vulnerable — 23/233 tests mueren),
**W9-M3** (permitir un accessor/getter en un campo declarado sin rechazarlo — 6/233
tests mueren, ya cubierto por la suite RX2 existente), y un mutante ad-hoc sobre
`cargador.ts::pinesCopiados` (revertir a asignación por corchetes — 3/80 tests
mueren). El golden byte-a-byte de M23 (`nucleo-canonico-golden.test.mjs`) se
verificó intacto tras el cambio en `canonico.ts`.

**Materialización redundante (RX3-03, MINOR) — aceptada, no refactorizada:** para
una operación, el dato se materializa 2-3 veces (`ejecutarLote`, `aplicarOperacion`,
`ejecutarOperacion`). `materializarDatosPlanos` es IDEMPOTENTE sobre datos ya
planos — materializar una copia ya plana produce una copia estructuralmente
idéntica — así que la redundancia es inocua en términos de corrección, sólo un
costo de CPU evitable. Se documenta y se ACEPTA sin refactor (ver `IR-SPEC.md`
§6.7.1 para el razonamiento completo de por qué NO se elimina la redundancia).

Ver `evidencia/RX3fix/` (Phase 1.1) para la evidencia RED/GREEN/mutante completa de
RX3-01/RX3-02, incluida la conversión a test de regresión del repro original de la
auditoría externa (`phase1_auditoria_externa/evidencia/e1/exp_proto_pollution.mjs`).

## Phase 1.2 — "umbral fuera de rango" es WARNING derivado del ESTADO, no del camino (hallazgo externo REA-02, MAYOR)

**Qué encontró la re-auditoría externa (AUD-C-02):** `reemplazarSensor`
(`catalogo.ts`, rama C de §8.1 del brief) era el ÚNICO lugar del núcleo que
comparaba un umbral contra `Capacidad.rango`, y sólo corría durante la
operación `CambiarComponente`. El MISMO estado (mismo sensor, mismo umbral,
mismo rango) llegado por cualquier otra puerta — `SetComportamiento` directo,
`proyectoInicial`, una recarga desde disco — validaba SIN ningún aviso, hasta
`listo:true`: un DHT22 (rango declarado `[0,60]°C`) con un umbral de `200°C`
quedaba marcado como proyecto completo y listo, sin ningún diagnóstico
(`reaudit/AUD-C/scripts/10_rango_sensor_deuda2.mjs`). Esto ya estaba
documentado como deuda conocida en `PHASE_1_1_REMEDIATION_REPORT.md` §8
("Umbral fuera del rango declarado del sensor en `SetComportamiento` directo:
no se valida" / "`RANGO_INCOMPATIBLE_AL_REEMPLAZAR` sólo cubierto en la rama
`CambiarComponente`") — la re-auditoría la confirmó con evidencia
reproducible y la elevó a hallazgo MAYOR.

**Decisión del orquestador, con fuente (Phase 1.2, registrada en
`odd/tasks/programacion-intencion-fase1-2.md`, "Decisiones del orquestador"):**
el umbral fuera de rango es un **WARNING DERIVADO DEL ESTADO** — nunca del
camino por el que ese estado se alcanzó — y **NO afecta la readiness**, con
esta fuente contractual:

- Brief §8.1, rama C de "al cambiar un sensor por otro": "misma cantidad
  física pero rango incompatible: se conserva el umbral/intención y se
  advierte, según el contrato de validación aplicable (§12.1)".
- Brief §12.1: `warning` = "proyecto utilizable pero requiere atención";
  sólo `blocking` "impide marcarlo `ready` o ejecutar la operación
  afectada... el Project Engine puede haberla aceptado y persistido con el
  proyecto marcado inválido para ejecutar".
- Brief l.1856: "No convertir todos los warnings en bloqueos. Un proyecto
  incompleto es un estado normal de aprendizaje" — mismo espíritu aplicado
  acá.
- Prompt humano de la tarea (§15/§18): "según contrato vigente... not-ready
  cuando corresponda" + "no cambiar este contrato durante 1.2" — se leyó el
  Brief/IR-SPEC/OPERATIONS antes de implementar, sin encontrar ninguna
  contradicción real con esta lectura (si hubiera aparecido una, el writer
  tenía instrucción de parar y devolver `HUMAN_DECISION_REQUIRED`, evidencia
  que nunca hizo falta usar).

**Por qué NO se decidió `blocking`:** convertir esto en `blocking` habría
significado que un estudiante con un umbral fuera de rango (una elección
pedagógicamente válida de explorar, corregible después) no podría marcar su
proyecto como `ready` — exactamente el "convertir warnings en bloqueos" que
el Brief prohíbe explícitamente. `blocking` queda reservado para lo que ya
lo usa en este mismo archivo de reglas (`PIN_OCUPADO`,
`CAPACIDAD_PIN_INCOMPATIBLE`, `CAPACIDAD_INEXISTENTE_EN_CATALOGO`,
`MAGNITUD_INCOMPATIBLE`) — todos casos donde el circuito, TAL COMO está
descrito, no puede funcionar en absoluto; un umbral fuera de rango sigue
siendo un circuito perfectamente funcional, sólo con una condición que
nunca (o siempre) se cumple en la práctica real del sensor.

**Fix, mismo criterio de clase que E1-03/REA-01 (nunca parche puntual):**
`estaFueraDeRango` se extrajo de la closure local de `reemplazarSensor`
(`catalogo.ts`) a una función compartida, y `validar-tecnico.ts` la reusa en
el mismo bucle continuo que ya diagnostica `CAPACIDAD_INEXISTENTE_EN_CATALOGO`/
`MAGNITUD_INCOMPATIBLE` sobre `proyecto.comportamientos` — la remediación
mínima exacta que sugería la ficha del hallazgo
(`PHASE_1_1_EXTERNAL_FINDINGS.md`, REA-02). Nuevo reason code
`UMBRAL_FUERA_DE_RANGO` (categoría `tecnica`, `severidad: "warning"`,
`clasificacion: "representable"`) — nunca hardcodea ids de componente, nunca
clampa ni reinterpreta el umbral, nunca toca `SetComportamiento` en sí. El
motivo transitorio `RANGO_INCOMPATIBLE_AL_REEMPLAZAR` que `reemplazarSensor`
ya emitía durante `CambiarComponente` se conserva sin cambios — es
informativo del EVENTO puntual de esa operación, nunca se fusiona con el
diagnóstico continuo. Ver `IR-SPEC.md` §6.12 para el detalle técnico
completo.

**Equivalencia por caminos, probada explícitamente (`tests/nucleo-rango-umbral-caminos.test.mjs`):**
el mismo estado final alcanzado por operación directa, `proyectoInicial`,
save→load con el Almacén real, y reemplazo de sensor (`CambiarComponente`,
rama C) da la MISMA clasificación de rango y la MISMA readiness en los 4
casos — cierra exactamente la dependencia-del-camino que motivó el
hallazgo MAYOR.

## Phase 1.2 — invariante PERSISTIBLE ⇒ RECARGABLE es ESTRUCTURAL, no de readiness (hallazgo externo REA-01, CRÍTICO)

**Qué encontró la re-auditoría externa (AUD-C-01):** `comparador`/`accion` de
`SetComportamiento` sólo se validaban contra su dominio cerrado al CARGAR un
documento (`cargador.ts`, Gate 2) — `operaciones.ts` (Gate 5) nunca los
comprobaba. Un valor sintácticamente válido pero inventado (`"mayorQue"`,
`"prender"`) commiteaba `ok:true`, se persistía, y al recargar ese mismo
documento el loader lo rechazaba con `CAMPO_REQUERIDO_FALTANTE` — un
documento PERSISTIBLE que dejaba de ser RECARGABLE. Como el compare-and-swap
de `almacen.ts::guardar()` (E3-07) SIEMPRE relee el documento existente antes
de escribir cualquier commit siguiente, el proyecto entero quedaba bloqueado
(`PERSIST_FAILED` en cascada), no sólo el comportamiento roto. Detalle
completo: `PHASE_1_1_EXTERNAL_FINDINGS.md` (REA-01) y
`PHASE_1_1_EXTERNAL_MERGE_GATE.md`, ambos en
`~/tecnia-bot-docs/phase1_1_reaudit_externa/`.

**Decisión del orquestador, nombrando el invariante explícitamente:** todo
`Proyecto` que una puerta pública del núcleo acepta persistir tiene que
pertenecer al MISMO dominio estructural que el loader acepta al recargarlo —
**PERSISTIBLE ⇒ RECARGABLE**. Es, a propósito, un invariante puramente
ESTRUCTURAL (forma, dominio de enums cerrados, referencias sin colgar — el
mismo nivel que `validarFormaProyecto`, Gate 2), **NO es una pregunta de
readiness**: nunca responde ni participa en `derivarReadiness` (`validar.ts`,
que sigue siendo el único dueño de esa pregunta), nunca convierte un motivo
`clasificacion:"representable"` (warning o `blocking` representable, ej.
`PIN_OCUPADO`) en rechazo, y nunca exige completitud — un proyecto incompleto
sigue siendo persistible exactamente igual que antes. Path A (`PIN_OCUPADO` →
commit + blocking + not-ready + editable) y los proyectos incompletos
demostraron seguir persistibles sin cambios (regresión focal F4/F5/F18,
re-auditoría focal ATK-3).

**Fix, dos capas independientes:** (1) dominio normativo único
(`ir.ts::COMPARADORES`/`ACCIONES`), importado por `cargador.ts` y
`operaciones.ts` — `aplicarSetComportamiento` rechaza `VALOR_ENUM_DESCONOCIDO`
ANTES de tocar estado; (2) barrera general en profundidad
(`motor.ts::ejecutarLote`, ANTES de la bifurcación dry-run/commit) que corre
`validarFormaProyecto` directo sobre el borrador — rechaza
`ESTADO_NO_RECARGABLE` si el borrador dejó de ser recargable, aunque las 8
operaciones públicas de Fase 1 ya no puedan alcanzar ese código (defensa
PROSPECTIVA para un aplicador futuro de Fase 2+). **Decisión sobre el
dry-run:** `motor.proponer()` corre la MISMA barrera, en el MISMO punto del
pipeline que `motor.aplicar()`/`aplicarTransaccion()` — un `proponer()` nunca
puede "aprobar" un lote que un commit real rechazaría.

Una auditoría exhaustiva "loader-only" (cada invariante estructural del
loader contra las 8 operaciones públicas + `id.ts` + `datos-planos.ts`,
`evidencia/T-A2/auditoria_loader_only.md`, fuera de este repositorio)
confirmó que `comparador`/`accion` era el ÚNICO gap real de esta clase — el
resto de los campos o coincide exactamente entre loader y operación, o el
dominio que la operación puede producir es un subconjunto estricto del que
el loader acepta, o es una bolsa abierta sin dominio cerrado por diseño.

Ver `IR-SPEC.md` §6.11, `OPERATIONS.md` §11 y
`INVARIANTES-ENTRYPOINTS.md` (fila 18) para el contrato técnico completo;
`tests/nucleo-operaciones.test.mjs`, `tests/nucleo-motor.test.mjs` y
`tests/nucleo-persistible-recargable.test.mjs` (round-trip contra Almacén
real) para tests y regresión; tres mutantes (M-A1/M-A2/M-A3, evidencia fuera
de este repositorio) MUERTOS, incluido uno que demuestra que sin la capa 2
la capa 1 sola no alcanza a detectar una divergencia de listas.

## Phase 1.2 — E3-04b/REA-04 (encapsular Almacen): pasa a CONDICIÓN del gate de entrada de Phase 2, no una evaluación opcional

**Qué encontró la re-auditoría externa (REA-04, carry-forward de E3-04b):**
la entrada "Almacen es un puerto interno del composition root" de arriba
registraba la decisión de Phase 1.1 como si fuera "decisión humana ya
tomada" — la re-auditoría externa (`AUD-A-01`, `AUD-C-03`, `AUD-C-07`)
verificó que eso es **FALSO**: la decisión de no encapsular la tomó un writer
de Phase 1.1 y la aceptó el orquestador, nunca un humano. Se pondera como
deuda técnica sin aval humano, no cerrada. `PHASE_1_1_EXTERNAL_MERGE_GATE.md`
la reclasifica de "recomendado, revisitar" a **"Bloquea Phase 2: SÍ,
condicionalmente — debe resolverse dentro de la tarea del primer composition
root de Phase 2"**.

**Decisión del orquestador (Phase 1.2, registrada en
`odd/tasks/programacion-intencion-fase1-2.md`):** E3-04b/REA-04 **NO se
implementa en Phase 1.2** (fuera del alcance autorizado: sólo REA-01/02/03) —
la entrada de arriba ("Almacen es un puerto interno del composition root")
sigue vigente sin cambios de código, pero su redacción "revisitar en Fase 2...
ahí sí EVALUAR si encapsular... vale la pena" queda **actualizada de
evaluación opcional a CONDICIÓN DEL GATE DE ENTRADA DE PHASE 2**, con la
severidad y la fuente que fija REA-04: **"Encapsular Almacen cuando se
introduzca el primer composition root real de Phase 2"** no es una mejora
discrecional — es una condición que Phase 2 tiene que resolver en la MISMA
tarea que escriba ese composition root, no después, antes de que cualquier
consumidor retenga la instancia de `Almacen` de forma no contractual. No
bloquea el merge de Phase 1.2 (confirmado por la re-auditoría focal, ATK-7 —
el CAS de E3-07 sigue intacto).

## Phase 1.2 — deuda del doble reemplazo intra-lote (REA-05, NONBLOCKING_DEBT) — sin cambios, carry-forward de RX-04

La re-auditoría externa (AUD-C-05, `reaudit/AUD-C/scripts/09_doble_reemplazo.mjs`)
confirmó con evidencia reproducible el MISMO hallazgo ya registrado arriba
como "Phase 1.1 (RX) — `SetComportamiento`: reemplazo intra-lote con id
explícito duplicado (hallazgo externo RX-04, MENOR, residual)": dos
`SetComportamiento` del mismo lote con el mismo id explícito adivinado hacen
que la segunda operación descarte silenciosamente la intención de la
primera (`COMPORTAMIENTO_REEMPLAZADO` sólo documenta la segunda, ninguna
marca queda en la primera). La re-auditoría lo re-etiqueta **REA-05, MINOR
(NONBLOCKING_DEBT)** — misma severidad, mismo diagnóstico, ninguna evidencia
nueva que cambie la decisión ya tomada. **Decisión del orquestador (Phase
1.2): SIN CAMBIOS respecto de la entrada RX-04 original** — sigue DIFERIDA,
no corregida; no corrompe la IR canónica, no rompe atomicidad, no bypassea
`baseRevision`; requiere un llamador que adivine activamente un id que el
contador va a asignar, sin flujo normal de Fase 1 que lo fomente. No bloquea
merge ni Phase 2. Revisitar si Fase 2 introduce un consumidor real (agente/UI)
que arme lotes con ids explícitos adivinados.

## Phase 1.2 — E3-07 (compare-and-swap contra disco): sin rediseño, garantía y límites SIN CAMBIOS

**Decisión del orquestador:** Phase 1.2 NO rediseña `almacen.ts::guardar()`
ni su compare-and-swap — fuera del alcance autorizado (sólo REA-01/02/03).
La garantía sigue siendo exactamente la misma que fijó Phase 1.1 (ver
"`Almacen.list()` y detección de modificación externa — fuera de Fase 1"
arriba): compara la revisión que YA está en disco contra la que el llamador
cree reemplazar, sin locks, sin base de datos, sin fusión automática, un solo
proceso. Los límites conocidos siguen siendo los mismos, sin cambios: la
detección es por REVISIÓN, no por contenido (dos documentos distintos con la
misma revisión exacta son indistinguibles de un re-guardado idempotente); sin
locking real, con TOCTOU teórico entre la lectura y la escritura si un
segundo escritor real escribe en esa ventana (REA-N5, aceptable para un solo
proceso/un solo motor por proyecto, **bloquea si Phase 2 usa múltiples
motores sobre el mismo proyecto**). La re-auditoría focal de Phase 1.2
(ATK-7/ATK-8, `FR/PHASE_1_2_FOCUSED_REAUDIT.md`) confirmó que el CAS sigue
funcionando igual después de los 5 commits de esta fase: A gana, B choca con
`CONFLICTO_REVISION_EN_ALMACEN`, el disco queda con exactamente el commit de
A, 0 escrituras/renames durante un rechazo (Path B). Ver `OPERATIONS.md` §10.

## Phase 1.2 — hallazgos abiertos (MINOR/NOTE), sin corregir en esta fase

Clasificación sin cambios respecto de la fuente (`PHASE_1_1_EXTERNAL_FINDINGS.md`
y `FR/PHASE_1_2_FOCUSED_REAUDIT.md`, ambos fuera de este repositorio) — Phase
1.2 tenía alcance cerrado a REA-01/02/03, así que ninguno de estos se
implementa ni se reabre sin evidencia nueva:

| Hallazgo | Severidad | Descripción breve | Bloquea merge | Bloquea Phase 2 |
|---|---|---|---|---|
| REA-05 | MINOR (NONBLOCKING_DEBT) | Doble reemplazo intra-lote con id adivinado (carry-forward RX-04, ver entrada dedicada arriba) | NO | NO |
| REA-06 | MINOR | `PIN_OCUPADO` excluye al propio componente del chequeo — hoy irrepresentable (catálogo actual: ≤1 terminal no-riel-fijo por componente) | NO | NO (documentar antes de un catálogo con componente multi-pin) |
| REA-07 | MINOR | `propagarMagnitud` filtra por magnitud sin test de contrato explícito — hoy no alcanzable por JSON (catálogo construido in-process, una sola conversión shippeada) | NO | NO |
| REA-N1 | NOTE | `reemplazarSensor` no chequea por sí mismo overflow a `Infinity` en la conversión — la revalidación post-lote (Gate 8) lo atrapa igual | NO | NO |
| REA-N2 | NOTE | La identidad referencial del invariante de vista no sobrevive el `structuredClone` por transacción de `ejecutarLote` — no es violación de contrato (el contrato es sobre Gate 5) | NO | NO |
| REA-N3 | NOTE | `construirCatalogo` crashea con `DOMException` crudo si se le pasa un Proxy — frontera de composition root de confianza, fuera del contrato de `datos-planos.ts` | NO | NO |
| REA-N4 | NOTE (CONCERN) | Crecimiento de `motor.ts`/`operaciones.ts`/`cargador.ts` (+71-157%), mucho conocimiento tácito en comentarios que remiten a documentos externos | NO | NO (riesgo de mantenibilidad a mediano plazo) |
| REA-N5 | NOTE | Sin locking real en E3-07, TOCTOU teórico (ver entrada dedicada arriba) | NO | Bloquea si Phase 2 usa múltiples motores sobre el mismo proyecto |
| REA-N6 | NOTE | `crearAlmacen` sin `deps.catalogo` tira `TypeError` crudo — error de configuración del programador, no entrada de usuario | NO | NO |
| REA-N7 | NOTE | `NODE24_CI_NOT_REPRODUCED` / `WINDOWS_UNVERIFIED` — entorno de auditoría sin Node 24 ni acceso a Windows | NO | NO |
| REA-N8 | NOTE | Conflicto de interés declarado del orquestador de la re-auditoría (mismo orquestador que la remediación) | NO | NO |
| REA-N9 | NOTE | 2 TRACE_PARTIAL de trazabilidad (conversión de unidades por magnitud — REA-07; compatibilidad legacy sin test nombrado explícitamente en el alcance de lectura del auditor) | NO | NO |
| FR-01 | MINOR | Límite de rango NO siempre inclusivo: deriva de punto flotante en conversión de unidad hace que un umbral físicamente en el límite exacto dispare `UMBRAL_FUERA_DE_RANGO` (falso warning, nunca falso OK). Ver `IR-SPEC.md` §6.12 | NO | Recomendado resolver antes de exponer la UI de diagnósticos a usuarios reales (mismo criterio que REA-02) |

## Phase 1.2 — E3-07 y E3-04b no reabren decisiones ya cerradas sin evidencia nueva

Regla aplicada explícitamente en esta fase: ninguna de las entradas de arriba
reabre un tema ya cerrado por la re-auditoría de Phase 1.1/1.2 sin evidencia
nueva — cada clasificación (severidad, bloquea/no bloquea) es la que ya fijó
la fuente externa (`reaudit/CONSOLIDACION.md`, autoridad de la re-auditoría),
nunca una reinterpretación de este writer.

## Phase 2 Slice 1 — E3-04b: CERRADO por raíz de composición única

**Decisión:** E3-04b (`Almacen` como puerto interno, no una segunda vía de
escritura — entrada "Almacen es un puerto interno del composition root" más
arriba, y REA-N5) queda **CERRADO** en Phase 2 Slice 1 por
`opencode/nucleo/composicion-raiz.ts` — la raíz de composición única del
Project Engine (ver `docs/programacion-intencion/PHASE_2_SLICE_1_DESIGN.md`
§2.1/§2.2 y el informe ARCH-A, "composition root, in-process, singleton por
proyecto").

**Mecanismo (sin DI, sin proxies, sin frameworks de inyección — mismo
criterio que Phase 1.1 ya había fijado, entrada arriba "nunca encapsularlo
con un subsistema nuevo: proxy, permisos, wrapper"):**

1. `composicion-raiz.ts` es el ÚNICO módulo de producción, además de
   `nucleo/almacen.ts` mismo, autorizado a importar `crearAlmacen`. Construye
   el `Almacen` internamente y NUNCA lo devuelve — expone
   `obtenerServicioDeProyecto({ directorio, idProyecto, crearSiNoExiste?,
   calcularVista? })`, una factory idempotente (singleton por
   `(directorio, idProyecto)` en un `Map` de módulo — memoización simple,
   mismo patrón que el precedente ya real `opencode/tool/platformio.ts:20`,
   `pioPathCache`) que devuelve un `ServicioDeProyecto` angosto:
   `snapshot()`, `aplicar()`/`aplicarTransaccion()`/`proponer()` (delegan
   íntegro en `MotorDeProyecto`, la única autoridad de mutación),
   `suscribir()` (cambios de revisión) y `cerrar()`. NUNCA `guardar`/
   `cargar`/`existe` ni una referencia al `Almacen` o al motor crudo.
2. El catálogo es el REAL de producción
   (`adaptadores/hash-catalogo.node.ts::construirCatalogoMinimoReal()`),
   calculado una única vez por proceso — la raíz no agrega reglas de
   dominio propias, todo pasa por el motor.
3. Un único `MotorDeProyecto` vivo por proyecto en el proceso (singleton por
   `(directorio, idProyecto)`) cierra REA-N5 (bloqueo documentado arriba,
   "bloquea si Phase 2 usa múltiples motores sobre el mismo proyecto") sin
   relajar el CAS de `almacen.ts` (E3-07): el CAS sigue siendo la defensa de
   último recurso, nunca el diseño deseado — con la raíz única, nunca hay dos
   motores compitiendo por el mismo `Almacen` en un mismo proceso.

**Tests guardia (`tests/phase2-composicion-raiz.test.mjs`):**

- (a) la superficie exportada del MÓDULO es exactamente
  `["obtenerServicioDeProyecto"]` (los `export interface`/`export type` se
  borran en runtime — límite honesto documentado en el propio test: un
  re-export de SOLO TIPO no es detectable así, pero tampoco es una vía de
  escritura ejecutable).
- (b) el SERVICIO devuelto por cada llamada no expone `guardar`/`cargar`/
  `existe`/`almacen`/`Almacen`/`crearAlmacen`/el motor crudo — recorriendo
  claves propias Y de todo el prototipo.
- (c) guardia estructural en JS puro (`scripts/guardia-composicion-raiz.mjs`,
  mismo estilo que `scripts/seguridad-proyectos.mjs`: `fs` + regex, sin
  `rg`/`grep` como dependencia externa): escanea `opencode/**/*.{ts,js,mjs}` y
  `scripts/**` (excluyendo `node_modules`, `tests/**` y el propio guardia) y
  falla si algún archivo, fuera de `nucleo/almacen.ts` y
  `nucleo/composicion-raiz.ts`, importa `almacen.ts` o referencia
  `crearAlmacen`. HOY pasa vacío (nadie más lo hace); un test dedicado prueba
  que el guardia SÍ puede fallar, con un archivo trampa descartable en un
  directorio temporal (nunca contra el repo real).
- (d) singleton: dos llamadas con el mismo `(directorio, idProyecto)`
  devuelven el MISMO servicio (misma referencia); ids distintos dan servicios
  distintos; una operación aplicada por un handle es visible por el otro con
  la misma revisión (comparten el mismo motor en memoria).

**Verificación de mutación (evidencia, no parte de la suite permanente):**
un mutante que agrega `almacen` al objeto que `construirServicio` devuelve
(exponiendo el `Almacen` desde el SERVICIO, no desde el módulo — una clase de
bug que el guardia (a) no vería) mata el guardia (b): `Object.getOwnPropertyNames`
del servicio mutante incluye `"almacen"`, y la aserción de superficie exacta
falla. Confirma que el guardia (b) no es un test vacío.

**Resto del slice (snapshot, motor/GPIO, conflicto stale, Path A/Path B,
reload, invariante visual) probado en `tests/phase2-snapshot.test.mjs`,
`tests/phase2-motor-gpio.test.mjs`, `tests/phase2-conflicto.test.mjs`,
`tests/phase2-paths.test.mjs`, `tests/phase2-reload.test.mjs` — todos sobre
un `Almacen` REAL (`os.tmpdir()`), nunca un almacén falso, mismo criterio que
`tests/nucleo-persistible-recargable.test.mjs`/`nucleo-demo-contractual.test.mjs`.
Los 983 tests de Phase 1 (`tests/nucleo-*.test.mjs`) NO se tocaron y siguen
en verde; `tests/nucleo-adversarial.test.mjs` ("29b. grep: node:fs/node:crypto
SOLO en almacen.ts y adaptadores/hash-catalogo.node.ts") obligó a que
`composicion-raiz.ts` NUNCA importe `node:path` (ni ningún otro `node:`*):
la normalización de `directorio` para la clave del singleton es un recorte de
string simple (`normalizarDirectorio`), sin resolver contra `process.cwd()`.

El campo `vista` del snapshot (diseño §2.6, modelo de vista física) TODAVÍA NO
EXISTE — la raíz deja un hook interno opcional (`calcularVista`, en las
opciones de `obtenerServicioDeProyecto`, nunca una clave nueva del módulo) sin
inventar su forma: si nadie lo inyecta, `snapshot()` simplemente omite la
clave. Lo agrega el writer siguiente (servidor HTTP + vista física).

## Revisión post red-team (P2-RED-A/P2-RED-B, ronda única de fixes, W5)

Los informes completos, con sus ataques y salidas, quedan fuera del repo en
`.../scratchpad/phase2/RED-A/INFORME.md` y `.../RED-B/INFORME.md` (evidencia
de W5 en `.../scratchpad/phase2/evidencia/W5/`). Acá sólo el resumen de cada
decisión y su fix.

### H2 (CRITICAL) — `cerrar()` no invalidaba el handle (motor zombi)

**Hallazgo**: `cerrar()` sólo hacía `registro.delete(clave)` + `listeners.clear()` —
nunca invalidaba los closures del `ServicioDeProyecto` ya entregado. Un handle
"cerrado" seguía `aplicar()`/`suscribir()` con éxito (escribía en disco y
notificaba), y un `obtenerServicioDeProyecto()` posterior para la MISMA clave
construía una raíz nueva: dos motores vivos simultáneos sobre el mismo
proyecto, en el mismo proceso — segunda autoridad de mutación real, sin
ningún truco de claves (ataque 2, P2-RED-A).

**Fix** (`opencode/nucleo/composicion-raiz.ts`): un flag `cerrado` por
servicio (closure, nunca expuesto). `cerrar()` lo pone en `true` ADEMÁS de
sacar la entrada del registro — sigue siendo idempotente (llamarlo dos veces
no lanza). `snapshot`/`aplicar`/`aplicarTransaccion`/`proponer`/`suscribir`
chequean el flag ANTES de tocar el motor/disco/listeners y lanzan un `Error`
con `.code === "SERVICIO_CERRADO"` si ya está cerrado — nunca una clase nueva
exportada del módulo (rompería el guardia (a) de superficie exacta,
`tests/phase2-composicion-raiz.test.mjs`).

**Tests** (`tests/phase2-cerrar-invalida.test.mjs`): handle cerrado no
escribe en disco (bytes idénticos antes/después del intento) ni notifica; las
cinco operaciones de la superficie lanzan `SERVICIO_CERRADO`; `cerrar()`
sigue siendo idempotente; tras `cerrar()`, un servicio nuevo para la misma
clave es el ÚNICO que sigue mutando. Mutante (quitar `cerrado = true` de
`cerrar()`) mata 3 de los 5 tests — confirmado, evidencia en
`.../evidencia/W5/H2/mutante-resultado.txt`.

### H1 (CRITICAL) — clave del singleton frágil (dir//, relativa, symlink → motores distintos)

**Hallazgo**: `normalizarDirectorio()` sólo recortaba UNA barra final — no
resolvía relativo/absoluto, symlinks ni mayúsculas/minúsculas. `"dir"` vs
`"dir//"`, una ruta relativa vs absoluta a la MISMA carpeta real, y un
symlink vs su destino real, daban CUATRO servicios/motores DISTINTOS sobre el
mismo `<id>.json` — el módulo cuya única razón de ser es garantizar un motor
por proyecto no lo garantizaba frente a variaciones triviales (ataque 1,
P2-RED-A). El caso de ruta relativa era además más grave: se resolvía contra
`process.cwd()` en el MOMENTO de cada operación de disco, no en el momento de
construcción — un cambio de cwd entre medio podía apuntar el handle a un
directorio distinto.

**Fix, en dos mitades** (decisión registrada: la mitad (a) vive en el
SERVIDOR, no en el núcleo, porque la guardia 29b de
`tests/nucleo-adversarial.test.mjs` prohíbe `node:fs`/`node:path` fuera de
`almacen.ts`/`hash-catalogo.node.ts` dentro de `opencode/nucleo/**`):
- (a) `opencode/servidor/servicio-con-vista.ts::directorioCanonico` —
  `fs.mkdirSync(dir, {recursive:true})` + `fs.realpathSync(path.resolve(dir))`
  ANTES de llamar a la raíz. Único call site de producción, así que la tool
  de OpenCode, el servidor HTTP y el launcher de demo quedan cubiertos por
  construcción.
- (b) `opencode/nucleo/composicion-raiz.ts::asegurarRutaAbsoluta` — la raíz
  RECHAZA con un error explícito (`"tiene que ser una ruta absoluta
  canónica"`) cualquier `directorio` que no empiece con `/` (POSIX) o
  `X:\`/`X:/`/`\\` (Windows) — documentado como contrato para CUALQUIER
  llamador, no sólo (a). La raíz sigue sin resolver symlinks/`.`/`..` por su
  cuenta (eso es responsabilidad del llamador) y sigue sin normalizar
  mayúsculas/minúsculas (`WINDOWS_UNVERIFIED`, igual que el resto del slice).

**Alcance deliberado**: los tests de Phase 1 y los tests de Phase 2 que
llaman `obtenerServicioDeProyecto` DIRECTO (`phase2-helpers.mjs`,
`tests/nucleo-*.test.mjs`) siguen sin canonicalizar — pasan rutas absolutas
reales (`os.tmpdir()`) y no se ven afectados por (a); el test
`dos-motores-mismo-almacen-real` (E3-07, Phase 1) sigue intocado. El fix
protege el CAMINO DE PRODUCCIÓN (servicio-con-vista.ts), no cierra la
permisividad de la raíz cruda — eso es a propósito, no un descuido: la raíz
cruda sigue siendo la herramienta correcta para un test que necesita
fabricar dos motores en aislamiento.

**Tests**: `tests/phase2-directorio-absoluto.test.mjs` (mitad b: ruta
relativa/vacía → error explícito, sin tocar el filesystem; ruta absoluta
real pasa la guardia de forma) y `tests/phase2-directorio-canonico.test.mjs`
(mitad a, vía `servicio-con-vista.ts`: las cuatro variantes dan el MISMO
servicio, comparten motor en memoria, y el directorio se crea solo si hace
falta). Mutante (saltear `directorioCanonico()`) mata 3 de los 5 tests de
equivalencia — evidencia en `.../evidencia/W5/H1/mutante-resultado.txt`.
Reproducción del ataque 1 original: contra `composicion-raiz.ts` DIRECTO
(como lo escribió el red team) sigue mostrando la colisión en el caso A (por
diseño — esa raíz sigue siendo permisiva) y ahora lanza un error explícito en
el caso B (antes fallaba silenciosamente distinto); adaptado al camino de
producción real (`servicio-con-vista.ts`), los tres casos dan
`mismo objeto JS? true` — evidencia en `.../evidencia/W5/H1/`.

### H5 (CRITICAL) — carrera del CAS de disco entre DOS PROCESOS de sistema operativo

**Hallazgo**: el CAS de `Almacen.guardar()` (E3-07, `almacen.ts`) es un patrón
leer-decidir-escribir SIN lock de archivo (limitación ya documentada
explícitamente en Phase 1: "Sin locks/mutex", modelo single-writer). Entre
DOS PROCESOS de sistema operativo reales (dos sesiones de OpenCode sobre la
misma carpeta), el singleton de `composicion-raiz.ts` no puede coordinar
nada (vive sólo en memoria de un proceso) — esa era la ÚNICA defensa. En 3 de
4 corridas del red team (y 3 de 3 en la reproducción de este writer contra
`composicion-raiz.ts` directo), AMBOS procesos recibían
`ResultadoTransaccion.ok:true`, con pérdida SILENCIOSA de uno de los dos
commits — el proceso "perdedor" nunca se enteraba (ataque 6, P2-RED-A).

**Fix** (`opencode/servidor/servicio-con-vista.ts` — NUNCA `almacen.ts` ni
`composicion-raiz.ts`: los tests de Phase 1 fabrican varios `Almacen` sobre
el mismo directorio a propósito, y el test `dos-motores-mismo-almacen-real`
de E3-07 no se puede romper): un candado de propiedad por proyecto, A NIVEL
PROCESO. Archivo `<directorio>/<idProyecto>.lock`, creado con
`fs.openSync(ruta, "wx")` — `O_CREAT | O_EXCL`, atómico a nivel de sistema
operativo (a diferencia del CAS de `almacen.ts`, acá no hay ventana
leer-luego-escribir). Contenido `{pid, hostname, creado}`.
- Si el candado ya existe y el dueño sigue vivo (mismo hostname,
  `process.kill(pid, 0)` no lanza o lanza `EPERM`): la obtención del
  servicio FALLA con un error claro (`"...ya está abierto en otro proceso
  (pid N)..."`).
- Si el dueño está muerto (`ESRCH`, o el candado es ilegible/corrupto): se
  recupera — se toma de nuevo, y el reemplazo queda registrado en el propio
  archivo (nuevo pid/hostname/creado).
- Se libera en `cerrar()` (verificando que el contenido siga siendo el
  propio ANTES de borrar — nunca pisa el candado de otro dueño que ya lo
  haya recuperado) y también al salir del proceso (`process.on("exit")`).
- Dentro del MISMO proceso, una llamada repetida para la misma clave reusa
  el wrapper ya construido — nunca vuelve a disputar el candado consigo
  mismo.
- La tool (`opencode/tool/vista-fisica.ts`) y el launcher de demo
  (`scripts/vista-fisica-demo.mjs`) atrapan el error y devuelven/imprimen un
  mensaje claro con código de salida de error — nunca un stack trace crudo
  ni un proceso colgado.

**Límites documentados, NO cerrados en esta ronda**: reuso de PID (ventana
angosta: el sistema operativo tendría que reasignar el mismo PID a otro
proceso completamente distinto entre la muerte del dueño original y el
chequeo de este código) y filesystems de red (`O_EXCL` es atómico
garantizado en filesystems locales; NFS viejo históricamente no lo
garantizaba entre hosts distintos).

**Alcance deliberado**: igual que H1, el candado protege el CAMINO DE
PRODUCCIÓN (`servicio-con-vista.ts`) — llamar `composicion-raiz.ts` directo
(como hacen los tests de Phase 1 y los tests de Phase 2 que fabrican varios
motores a propósito) sigue sin candado, así que el CAS de disco sigue siendo
la única defensa ahí (documentado como límite conocido, no cerrado).

**Tests** (`tests/phase2-candado-proceso.test.mjs` + su hijo real,
`tests/phase2-candado-proceso-hijo.mjs`): dos procesos de SO reales sobre el
mismo directorio+idProyecto (protocolo determinista LISTO/ABRIR/CERRAR por
stdin/stdout — nunca `sleep`: la carrera real se dispara recién cuando AMBOS
terminaron de importar el módulo y avisan estar listos) — el SEGUNDO tiene
que fallar al abrir, nunca hay dos `abrio:true`; candado con pid muerto se
recupera; `cerrar()` libera y otro proceso puede abrir después; dentro del
mismo proceso no hay autobloqueo; el launcher de demo y la tool, con otro
proceso dueño, fallan con un mensaje claro y no cuelgan. Mutante (saltear el
chequeo de "está vivo") mata 4 de los 6 tests — evidencia en
`.../evidencia/W5/H5/mutante-resultado.txt`. Reproducción del ataque 6
original: contra `composicion-raiz.ts` DIRECTO sigue mostrando la carrera (3
de 3 corridas, por diseño — esa raíz sigue siendo permisiva); adaptado al
camino de producción real (`servicio-con-vista.ts`, mismo protocolo
LISTO/ABRIR/CERRAR), 3 de 3 corridas dan EXACTAMENTE un `abrio:true` —
evidencia en `.../evidencia/W5/H5/`.

### H3 (MAJOR) — sin validación de Origin ni Content-Type, CSRF local

**Hallazgo**: el chequeo de `Host` (`manejarRequest`) sólo protege contra
DNS-rebinding — nunca contra una request cross-origin DIRECTA hacia
`127.0.0.1:<puerto>`, porque el navegador manda el `Host` real del destino
sin importar el origen de la página que dispara el `fetch`. Sin validar
`Content-Type`, cualquier pestaña de OTRO origen podía mandar un POST
"simple" (`Content-Type: text/plain`, sin preflight) hacia
`/api/operaciones` y ejecutar CUALQUIERA de las operaciones del motor — no
sólo `AsignarPin` — si conocía/adivinaba el puerto efímero (ataque 3, casos
3.9/3.10/3.11/3.12, P2-RED-A).

**Fix** (`opencode/servidor/servidor-proyecto.ts::validarOrigenYContentType`,
llamado al INICIO de `manejarOperaciones`, antes de leer el cuerpo): exige,
en orden, (1) `Content-Type: application/json` (con o sin `;charset=...`
detrás) — si no, **415**; (2) header `Origin` presente e IGUAL al origen
propio (`http://127.0.0.1:<puerto>` o `http://localhost:<puerto>`, misma
lógica que `hostsPermitidos`) — si no, **403**. `app.js` ya mandaba
`Content-Type: application/json` de entrada; `Origin` lo agrega el
NAVEGADOR solo en cualquier POST same-origin (header que JS no puede omitir
ni falsificar) — la demo real no necesitó ningún cambio.

**Los tests existentes que hacían POST sin esos headers se actualizaron**
(`tests/phase2-transporte-http.test.mjs`, `tests/phase2-e2e.test.mjs`) —
agregar un `Origin`/`Content-Type` VÁLIDO a un cliente que ya se comportaba
bien no es debilitar ningún invariante: es lo que el cliente real (`app.js`,
o el navegador por su cuenta) ya hacía. `tests/phase2-e2e.test.mjs` usa
`fetch()` de Node (sin contexto de página, nunca agrega `Origin` solo) —
ahí se pasa explícito.

**Tests** (`tests/phase2-transporte-http.test.mjs`, sección H3): Origin de
otro sitio → 403 (reproduce 3.12); sin Origin → 403; Origin de otro PUERTO en
`127.0.0.1` → 403; `Content-Type: text/plain` → 415 (reproduce 3.9);
`application/json;charset=utf-8` (parámetros detrás) sí se acepta; el POST
válido de la página real sigue funcionando exactamente igual. Mutante
(saltear `validarOrigenYContentType`) mata 4 de los 26 tests del archivo.
Reproducción del ataque 3 original (que nunca mandaba estos headers en
NINGÚN caso): todos sus POST caen ahora en 403/415 — confirmado además
contra el demo launcher REAL por `curl` (favicon 204, sin Origin → 403,
Origin cross-site + text/plain → 415, POST válido con headers correctos →
200 `ok:true`) — evidencia en `.../evidencia/W5/H3/`.

### Favicon

`GET /favicon.ico` → **204 sin cuerpo** (reusa `responderBuffer` con
`soloCabeceras:true`) — sin esto, el navegador lo pedía solo y cada carga de
la página dejaba un 404 de ruido en la consola (observado por el
orquestador en la demo real, P2-T12). Test:
`tests/phase2-transporte-http.test.mjs`, "GET /favicon.ico da 204 sin
cuerpo".

### B1 (MAJOR) — nombre de pin Wokwi inventado/erróneo para GPIO reservados/inexistentes

**Hallazgo**: `nombreWokwiDePin()` tenía un fallback `` `D${numero}` `` para
cualquier GPIO fuera de la tabla `ESP32_WOKWI_PIN` — un nombre NUNCA
verificado contra el bundle Wokwi real. Contra el `<wokwi-esp32-devkit-v1>`
REAL (Chromium headless instanciando el bundle real del repo, `el.pinInfo`),
la pieza tiene EXACTAMENTE 30 pines. Comparado contra lo que el selector
ofrecía: 9 GPIO (0, 6-11, 37, 38) NO EXISTEN como pin físico en absoluto —
se mostraban como `D0`/`D6`.../`D37`/`D38`, nombres inventados sin ningún
cable real detrás. Y 2 GPIO (1, 3) SÍ existen físicamente pero con OTRO
nombre — `TX0`/`RX0`, no `D1`/`D3` — un dato incorrecto, no sólo un hueco
(ataque A1, P2-RED-B).

**Fix**:
- `opencode/vista-fisica/wokwi-render-datos.ts::ESP32_WOKWI_PIN` — se agregan
  `1→"TX0"` y `3→"RX0"`, confirmados contra el dump real (NUNCA una copia de
  `circuito.ts`, que no los tenía — la fuente acá es el bundle real,
  documentado explícitamente en el archivo).
- `nombreWokwiDePin()` — el fallback `` `D${numero}` `` se ELIMINA. Un GPIO
  fuera de la tabla ahora devuelve `null` ("sin pin físico en esta placa"),
  nunca un nombre inventado.
- `snapshot-a-vista.ts::gpiosCandidatosPara()` — los GPIO OFRECIDOS en el
  selector son ahora la INTERSECCIÓN de "el Engine/catálogo los acepta"
  (`asignarPin()`, sin cambios) Y "el renderer tiene un pin físico real para
  ellos" (`nombreWokwiDePin() !== null`). Es una restricción de
  PRESENTACIÓN (no se puede dibujar un cable a un pin que no existe en la
  pieza), NUNCA una regla eléctrica nueva — el gap de `asignarPin()` no
  filtrando `RegistroPin.restricciones` sigue siendo el mismo, sin cerrar.
- Si el Engine YA tiene un pin asignado sin representación física (un actor
  "agente" lo asignó directo, sin pasar por el selector — sigue siendo
  posible, ese gap es de Fase 1 y no se cierra acá): la vista lo muestra
  HONESTAMENTE. `TerminalVista.asignado.nombreWokwiPlaca` y
  `ExtremoCableVista.pinPlaca.nombreWokwi` pasan a ser `string | null` — el
  `pinSemantico` real NUNCA se oculta, y `plan-de-pintado.js::etiquetaDeExtremo`
  convierte el `null` en un texto honesto (`"GPIO6 (sin pin físico en esta
  placa)"`), nunca la palabra literal `"null"` ni un nombre inventado.

**Backlog explícito, NO tocado en esta ronda** (`nucleo/placas.ts`): GPIO37/38
están en `ESP32_GPIO_VALIDOS` sin ninguna restricción asociada (ni
`ESP32_GPIO_SOLO_ENTRADA`/`STRAPPING`/`FLASH`/`UART_USB`), y `asignarPin()`
nunca mira `RegistroPin.restricciones` — ambos son gaps de DATOS Y REGLAS de
Fase 1, no de este adaptador de vista. Esta ronda sólo cierra que la VISTA no
invente ni oculte nada; no valida eléctricamente nada nuevo.

**Tests** (`tests/phase2-wokwi-pinout.test.mjs`, contra una lista fija de los
30 nombres reales citada del dump): todos los GPIO ofrecidos existen en el
pinout real; GPIO1/GPIO3 se muestran como TX0/RX0; una asignación a un GPIO
sin pin físico se proyecta honestamente (pin semántico visible,
`nombreWokwi: null`, texto pintado sin la palabra "null" ni un nombre
inventado). Se actualizó `tests/phase2-vista-fisica.test.mjs` (el assert que
documentaba "GPIO6 SE OFRECE, gap heredado" pasa a "GPIO6 YA NO SE OFRECE" —
GPIO2 sigue ofrecido, porque SÍ tiene pin físico real, así que el gap de
`asignarPin()` para strapping sigue siendo visible ahí). Mutante (volver al
fallback `D${numero}`) mata 3 de los 4 tests nuevos. Verificado además contra
el demo launcher REAL (antes: 30 GPIO ofrecidos con 9 inventados; después: 21
GPIO, todos reales) — evidencia en `.../evidencia/W5/B1/`.

### B2 (MAJOR) — la vista queda muda si el servidor se reinicia/cambia de puerto

**Hallazgo**: el servidor usa `listen(0)` (puerto efímero) — reiniciar el
proceso (crash, actualización, el propio agente relanzándolo) da CASI SEGURO
un puerto NUEVO. `app.js` sólo escuchaba el evento `"revision"` del
`EventSource` — sin ningún listener `"error"`, sin ningún indicador de
conexión en `index.html`. Contra un servidor viejo muerto, el `EventSource`
reintenta EN SILENCIO para siempre (consola vacía, sin excepción visible) y
la pestaña vieja queda EXACTAMENTE IGUAL — revisión, readiness y selector
sin ningún cambio, como si la conexión siguiera vigente. Contradice
literalmente `PHASE_2_SLICE_1_DESIGN.md:87` ("vuelve a pedir el snapshot al
reconectar" — falso acá: nunca puede reconectar, es un origin distinto)
(ataque A6, P2-RED-B).

**Fix**:
- `opencode/vista-fisica/web/estado-conexion.js` (NUEVO, PURO, testeable sin
  navegador): `reducirEstadoConexion(estado, evento)` — `{tipo:"error"}` →
  `"desconectado"`, `{tipo:"open"}` → `"conectado"`, cualquier otro evento
  deja el estado sin cambios. `ESTADO_INICIAL = "conectado"` (optimista: la
  primera carga ya usa `fetch()`, no SSE).
- `app.js` — agrega `eventos.addEventListener("error"/"open", ...)`, pasa
  cada evento nativo por el reductor, y SÓLO en una transición real
  actualiza el indicador (`#conexion`, siempre presente en el DOM, nunca
  aparece/desaparece — sólo cambia `data-estado-conexion`/texto) y, si
  volvió a `"conectado"`, pide el snapshot de nuevo (reconexión al MISMO
  puerto) — nunca inventa datos de proyecto, sólo comunica la pérdida de
  conexión de TRANSPORTE. El mensaje de desconectado sugiere explícitamente
  "volvé a abrir la vista física desde Tecnia Bot" (para el caso de puerto
  nuevo, donde nunca va a reconectar sola).
- `plan-de-pintado.js`/`pintar.js` — `planDePintado(modeloDeVista,
  {conexionActiva})` (default `true`, compatibilidad hacia atrás) agrega
  `deshabilitado` a la instrucción `selectorGpio`; `pintar()` lo aplica como
  `selector.disabled` real — el selector de GPIO queda inutilizable mientras
  no hay conexión viva.
- `servidor-proyecto.ts` — `estado-conexion.js` se suma a la lista blanca de
  `/assets/` (lo importa `app.js`).

**Tests** (`tests/phase2-conexion-estado.test.mjs`): el reductor puro cubre
las tres transiciones (sin DOM); `planDePintado` con/sin `conexionActiva`
produce/no produce `deshabilitado`; `pintar()` aplica `.disabled` real sobre
un `<select>` fake. Verificado ADEMÁS en un navegador REAL (Chromium
headless vía CDP, reproduciendo el ataque A6 contra el código YA CON EL
FIX): servidor viejo muerto → `#conexion` pasa a "desconectado: la vista
puede no estar actualizada. Si el servidor se reinició en otro puerto, volvé
a abrir la vista física desde Tecnia Bot." y el `<select>` queda
`disabled:true` — evidencia en `.../evidencia/W5/B2/despues-cdp.txt`.

### H4 (MAJOR según el auditor; decisión del orquestador: limitación documentada, NO arreglada con más regex)

**Hallazgo**: `scripts/guardia-composicion-raiz.mjs` y
`scripts/guardia-servicio-con-vista.mjs` son heurísticas LÉXICAS sobre texto
(`\bcrearAlmacen\b`, `\bobtenerServicioDeProyecto\b`, un patrón
`from|require\(` para el import). Un `import()` DINÁMICO (nunca matchea
`from`/`require(`) combinado con acceso a la propiedad por CONCATENACIÓN DE
STRINGS (`modulo["crear" + "Almacen"]`, nunca aparece la palabra completa
contigua) evade AMBOS patrones — verificado por el red team EJECUTABLEMENTE:
el bypass obtiene `crearAlmacen`/`obtenerServicioDeProyecto` como funciones
invocables, sin que ninguna guardia lo detecte (exit 0, "OK"), mientras que
el MISMO patrón escrito de forma naive (`import {crearAlmacen} from
"...")`) SÍ es detectado (exit 1) — control positivo que prueba que el
bypass no es un simple "la guardia está rota", sino un hueco puntual de
cualquier regex sobre texto plano (ataque 5, P2-RED-A).

**Decisión del orquestador**: NO se "arregla" agregando más regex (un patrón
más específico sólo movería el punto exacto de evasión, nunca lo cerraría
de verdad — el problema es de CLASE, no de un patrón puntual faltante).
Se documenta la limitación explícitamente, en el propio encabezado de cada
guardia (`scripts/guardia-composicion-raiz.mjs`,
`scripts/guardia-servicio-con-vista.mjs`) y acá: **estas guardias protegen
contra ACCIDENTES (la forma natural de escribir un import), no contra
ofuscación DELIBERADA de alguien que ya sepa que existen y quiera evadirlas
a propósito**. La severidad del auditor (MAJOR) queda registrada tal cual,
sin relajarla ni disputarla — el orquestador elige NO cerrarla en esta
ronda porque cerrarla de verdad requeriría un parser real (AST, la propia
API de TypeScript/`tsgo`) para detectar `import()` dinámico + acceso
computado, un cambio de mecanismo mayor que excede el alcance de "ronda
única de fixes puntuales" y que este proyecto había decidido explícitamente
NO sumar (`DECISIONS.md`, Phase 1.1: "sin DI, sin proxies, sin frameworks",
mismo criterio de mínima infraestructura nueva).

**Verificado sin cambios tras el resto de los fixes de esta ronda** (H1/H2/H5
tocaron `composicion-raiz.ts`/`servicio-con-vista.ts`): las dos guardias
siguen dando exit 0 ("OK") contra el mismo repo trampa del red team
(`RED-A/ataques/fake-repo/`), y exit 1 contra el control naive — evidencia
en `.../evidencia/W5/H4/`. No hay test nuevo (una limitación documentada, no
un contrato que deba probarse en verde).

**Aclaración de autoría de la decisión (P2-T13)**: quien decidió NO cerrar H4
con más regex fue el **ORQUESTADOR** de la sesión de Phase 2 Slice 1, no un
humano — esta decisión queda **pendiente de confirmación del usuario
humano**. El informe de regresión (`REG/INFORME.md`, veredicto final) la
atribuyó por error a "decisión humana explícita"; esa atribución es
incorrecta y se corrige acá y en `PHASE_2_SLICE_1_REPORT.md` §D.6/§E. La
severidad MAJOR del auditor no cambia por esta aclaración: sigue registrada
tal cual, sin relajarla.

**Resolución humana posterior (gate final de hardening, 2026-09-29)**: el HUMAN
PRODUCT OWNER confirmó formalmente la decisión. Registro normativo:
`original_severity = MAJOR`, `state = ACCEPTED_KNOWN_LIMITATION`,
`accepted_by = HUMAN_PRODUCT_OWNER`, `blocks_phase2_slice1 = NO`. Las guardias
léxicas E3-04b son controles contra bypass arquitectónico ACCIDENTAL. NO son una
frontera de seguridad frente a código deliberadamente ofuscado escrito por alguien
con acceso al repo. Se conservan los tests que prueban que el bypass accidental se
detecta y la evidencia (W5/H4) de que el bypass ofuscado evade la guardia. No se
agregan AST, regex nuevas, sandbox ni loader. **Reabrir H4 si**: corre en el proceso
código, plugin o extensión no confiable; cambia el modelo de confianza; el almacén
pasa a formar parte de una API pública o extensible; aparece un bypass accidental
no detectado; o hay evidencia de que el bypass puede originarse desde input externo.
El texto anterior (autoría del orquestador, "pendiente de confirmación") se deja
tal cual como historia; esta resolución lo completa, no lo reemplaza. Ver
`PHASE_2_SLICE_1_HARDENING_DESIGN.md` D15.

**Gate de pines del hardening final (W-PINS, D1-D11, `PHASE_2_SLICE_1_HARDENING_DESIGN.md`
§1-3, resolución humana del gate final de hardening, 2026-09-29)**: el HUMAN PRODUCT
OWNER resolvió el gap que `COMPONENT-CATALOG.md` §1 ya señalaba (`RegistroPin.
restricciones` existía desde Gate 1 pero ningún validador lo leía, ARCH-PINS §1) con
una función pura nueva, `evaluarRestriccionesPin` (`catalogo.ts`), llamada desde el
mismo bucle de `validar-tecnico.ts` que ya llama `asignarPin` — sin tocar `asignarPin`:
la operación `AsignarPin` sigue sin rechazarse por una restricción de pin (D1/D11).
Decisiones normativas:
- D1 (H-1=B): `PIN_FLASH_RESERVADO` (GPIO6-11) — blocking, representable.
- D2 (H-2=B): `PIN_STRAPPING` con severidad POR PIN — GPIO12 `warning` (excepción),
  el resto de la clase `info`.
- D3 (H-2b=A): GPIO2 se queda en `info`, sigue en el pool automático y ofrecido.
- D4 (H-3=A): GPIO5 sin restricción nueva — el repo no tiene fuente interna que lo
  clasifique como strapping; no se inventa el dato.
- D5 (H-4=A): dato declarativo `requierePullUpInterno: true` en `pulsador.senal`
  (`catalogo-datos.ts`) + `PIN_SIN_PULLUP_INTERNO` (blocking, representable) cuando el
  terminal lo requiere Y el pin tiene `soloEntrada` — nunca `if GPIO<n>`. El `ntc`
  (analógica) no declara el dato, así que GPIO34 sigue sin motivo para él (fixture de
  Phase 1, `nucleo-ir-cargador.test.mjs:706`); el DHT22 queda en BACKLOG.
- D6 (H-5=A): GPIO0 y la flash se quedan en el registro, sin una restricción
  `sinPinFisico` nueva (no se reabre el enum cerrado, `DECISIONS.md` OD-01) y sin
  tocar Phase 1 (`nucleo-placas.test.mjs`, intocable).
- D7 (H-6=B): `PIN_UART_USB` (GPIO1/3) — warning, representable, `datos` limitado a
  la evidencia de `circuito.ts:348-351` (carga del programa + Monitor Serie).
- D8 (H-7=A): se mantiene el filtro de capacidad de `gpiosCandidatosPara` — el
  browser JS sigue sin ninguna tabla eléctrica, los candidatos salen SOLO del núcleo,
  y GPIO2/12/15/1/3 se siguen ofreciendo.
- D9: se quitan GPIO37/38 de `ESP32_GPIO_VALIDOS` (`placas.ts`) — no salen a ningún
  pin del módulo WROOM (`SKILL.md:82-85`, `circuito.test.mjs:2524-2527`). `circuito.ts`
  NO se toca: la divergencia queda documentada en el propio comentario de `placas.ts`.
- D10: `PIN_INEXISTENTE_EN_DOCUMENTO` (blocking, representable) — mismo patrón que
  `PLACA_DESCONOCIDA_EN_DOCUMENTO` — para una asignación que ya no existe en el
  registro de la placa vigente, por cualquier camino.
- D11: ninguna regla nueva del validador emite `rechazo` — todas `representable`
  (`motor.ts:358-360`), así que los proyectos persistidos con GPIO6/1/12/37 siguen
  abriendo (PERSISTIBLE ⇒ RECARGABLE).

Verificado por `tests/phase2-hardening-pines.test.mjs` (matriz de severidad, D5
terminal-aware, D9/D10, reasignar limpia el motivo, D11, y la convergencia de
diagnóstico entre Engine directo, POST `/api/operaciones`, el snapshot con vista y la
recarga desde disco para el mismo estado) + `tests/phase2-wokwi-pinout.test.mjs:84-86`
actualizado (D9). `git diff 8b43c59 -- 'tests/nucleo-*'` queda vacío: ningún test de
Phase 1 se tocó.

## Phase 2 Slice 2 — ESP32 + LED + pulsador, tool de transporte del agente (2026-09-30)

Diseño normativo: `PHASE_2_SLICE_2_DESIGN.md` (aprobado por el HUMAN PRODUCT OWNER,
2026-09-30, base `main` local `74e0674`). Discovery: `PHASE_2_SLICE_2_DISCOVERY.md`
(HD-S2-0..10). El HUMAN PRODUCT OWNER resolvió las diez decisiones de discovery más
las seis de revisión del diseño (§10):

- **HD-S2-0 = A**: scope ESP32 + LED + pulsador (contraste entrada/salida mínimo).
- **HD-S2-1 = a+b**: una tool controlada emite operaciones EXISTENTES para el
  agente (whitelist), más el sembrado determinista de la demo — el Project Engine
  sigue siendo la única autoridad, el agente nunca escribe la IR.
- **HD-S2-2 = dibujar** el pulsador con Wokwi Elements (no una fila de texto).
- **HD-S2-3**: `1.l` = señal, `2.l` = GND, sólo en la proyección física — sin
  verdad eléctrica paralela (los cuatro terminales del `wokwi-pushbutton` real
  están puenteados de a pares, la elección es cosmética).
- **HD-S2-4**: `wokwi-pushbutton` estándar (no la variante `-6mm`).
- **HD-S2-5 = B**: CSS mínimo (`flex-wrap`/`gap`), sin motor de layout.
- **HD-S2-6**: se descarta el cable geométrico.
- **HD-S2-7 = A**: Entrada/Salida derivadas de la autoridad catalogal
  (`ComponenteCatalogo.clase`) — el browser no mantiene tablas propias.
- **HD-S2-8 = A+C acotado**: texto determinista para los reason codes del
  recorrido, más resaltar la entidad afectada. Sin LLM; un código desconocido se
  muestra tal cual.
- **HD-S2-9 = A**: se mantiene `INPUT_PULLUP` interno (no se agrega
  `pulsador-pulldown`: scope creep para este slice).
- **HD-S2-10 = NO**: ninguna `ComportamientoRegla` pulsador → LED, ni siquiera
  representable sin ejecutar — territorio de Phase 3.
- **R-1 = TOOL SEPARADA**: `vista-fisica` (existente) presenta/abre; la tool nueva
  `proyecto-fisico` (`opencode/tool/proyecto-fisico.ts`) emite operaciones — no se
  mezclan en un mismo archivo.
- **R-2 = ALLOW**: sin confirmación `ask` para la tool nueva (`opencode/agent/
  tecnia-bot.md:25`); no reduce ninguna protección semántica (baseRevision
  obligatorio, whitelist, Engine como autoridad única, transacción atómica,
  candado/singleton, persistencia autoritativa siguen todas intactas).
- **R-3 = GREEN**: color del pulsador, presentación pura para distinguirlo del LED
  rojo (`wokwi-render-datos.ts:144-147`), nunca un dato semántico.
- **R-4**: los ocho textos de `explicaciones-motivos.ts` quedan APROBADOS tal
  cual, sin parafrasear.
- **R-5 = WINDOWS SHORT RUN**: al final del slice, sin repetir la matriz completa
  (proporcionalidad — el slice no toca el candado, el servidor ni los
  instaladores).
- **R-6 = WHITELIST exacta + límite 20**: ver el detalle completo (con los seis
  códigos de rechazo de transporte) en `OPERATIONS.md` §12.

**Decisiones de implementación** (no elevadas al humano — dentro del margen que el
diseño delega en el writer):

- **Rol Entrada/Salida derivado de `clase`, del lado del SERVIDOR**
  (`rolDeClase`, `opencode/vista-fisica/snapshot-a-vista.ts:86-90`): función pura
  que despacha ÚNICAMENTE por `ComponenteCatalogo.clase` (nunca por `tipo`/id de
  componente) — `"entrada"`/`"sensor"` → `"entrada"`, `"actuador"` → `"salida"`,
  cualquier otra clase (incluida una futura que el mapeo no conozca) → `null`. El
  browser (`plan-de-pintado.js`/`pintar.js`) sólo capitaliza el texto YA resuelto;
  nunca repite este despacho ni mantiene su propia tabla de clases/tipos
  (verificado por escaneo estático en `phase2-s2-rol.test.mjs`, mismo criterio que
  D8 del gate de pines).
- **Explicaciones de motivos deterministas, del lado del SERVIDOR**
  (`opencode/vista-fisica/explicaciones-motivos.ts`): tabla pura `código →
  (datos, nombres) → string`, sin LLM y sin inferir causas — sólo interpola
  `motivo.datos` y el `nombreVisible` de catálogo. `snapshot-a-vista.ts` agrega
  `explicacion: string | null` a cada motivo de la vista; un código que la tabla
  no conoce da `null` y el browser muestra el código crudo (fail-closed, mismo
  criterio que el resto del adaptador).
- **`figure`/`figcaption` por pieza — fix del gate visual** (commit `0267797`,
  `opencode/vista-fisica/web/pintar.js:100-116`): el gate con Chromium real
  (`.../s2impl/gate-vista/v2-gpio34-blocking.png`) mostró el rótulo "Entrada" del
  pulsador separado de su pieza — como hermano suelto de `#circuito` en
  `flex-wrap`, podía terminar en otra línea del wrap. Fix: cada pieza CON rol se
  envuelve en un `<figure data-entidad-tipo/id/data-pieza-de>` propio, junto con
  su `<figcaption data-rol-de-componente>`, DEBAJO de la pieza — `flex-wrap` opera
  sobre el contenedor entero, nunca separa la pieza de su texto. Una pieza sin rol
  (la placa, un componente sin rol pedagógico) sigue siendo hija directa de
  `#circuito`, sin envoltorio innecesario. Test-first: `phase2-s2-rol.test.mjs`
  reproduce el escenario exacto del gate (RED confirmado contra el código
  anterior, GREEN después del fix).
- **Ajuste aditivo de `tests/phase2-hardening-pines.test.mjs`** (mismo commit que
  agrega `explicacion`, `feat(vista-fisica): explicación de motivos en texto
  llano + resaltado`): el helper `sinExplicacion`
  (`tests/phase2-hardening-pines.test.mjs:36-44`) le quita el campo `explicacion`
  (aditivo, `MotivoVista`) a los motivos de la vista ANTES de comparar contra
  `validacion.motivos`/el snapshot HTTP (`tests/phase2-hardening-pines.test.mjs:
  377,398`) — sin este ajuste, la comparación literal (`assert.deepEqual`) rompía
  porque un lado del `deepEqual` tiene `explicacion` y el otro no, aunque el
  motivo estructurado en sí (código/severidad/clasificación/entidad/datos) sea
  idéntico. Es el único ajuste retroactivo que el diseño (§5) autorizaba, y era
  el previsto: el análisis previo del diseño decía que los `deepEqual` comparan
  proyecciones de vista entre sí (donde `explicacion` está en ambos lados, no
  rompe nada) — este caso puntual compara vista contra `validacion.motivos`/HTTP
  crudo, donde sí hacía falta el ajuste.

## Contexto de desarrollo V2.1 — decisiones humanas HD-01..HD-07 (2026-10-02)

Adopción del contexto de desarrollo auditado: paquete V2.1 FINAL (sha256
`2c1012ce31068b920f9192a9ae5d21a17c263777571f5bce574735f19ff3ccc7`), árbol adoptable de
13 archivos (agregado `4d027f1f4fffc34000a31c2151644869cd7e5cef4e05da5c0eb4f923bf8d315b`)
copiado byte a byte. Los IDs HD-01..HD-07 son propios de este registro (distintos de
HD-S2-*, HD-P3-* y HD-W0-*). El HUMAN PRODUCT OWNER resolvió:

- **HD-01 DECIDED** — punto de lanzamiento canónico = `tecnia-bot/`. Una sola doctrina:
  los worktrees son checkouts operativos de ramas del mismo proyecto, no doctrinas
  independientes.
- **HD-02 DECIDED** — Gentle AI global conservative hasta el MVP. Una evaluación
  workspace-scoped requerirá su propio dry-run.
- **HD-03 DECIDED** — memoria forward-only: sin migrar, borrar ni mover la memoria
  histórica.
- **HD-04 DECIDED** — `nucleo-ir.md` no se adopta ahora; se reconsidera cuando el modelo
  semántico de Phase 3 esté estable. No revoca los invariantes congelados: la IR es la
  fuente canónica, la vista física es proyección y el Project Engine es la única
  autoridad de mutación.
- **HD-05 DECIDED** — la optimización estructural del prompt runtime
  (`opencode/agent/tecnia-bot.md`) va en un ciclo separado; los cambios funcionales del
  MVP pueden modificarlo dentro de su vertical, con RED/tests/evidencia.
- **HD-06 DEFERRED** — para el MVP la IR sigue siendo el estado semántico/deseado
  canónico; no se agrega estado observed/runtime/physical. No es un rechazo permanente
  de un dominio separado futuro.
- **HD-07 DEFERRED** — Modo Vivo: transporte, ownership del puerto serie, lifecycle del
  Live Service y contrato del Live Runtime sin decidir; sigue PROPOSED / NOT IMPLEMENTED.

## Phase 3 — Vertical semántico #1 ("mientras"): valores de HD-P3D y reapertura acotada (2026-10-02)

Confirmación del HUMAN PRODUCT OWNER antes de empezar el vertical #1. Nada de lo
histórico se borra ni se reescribe: cada decisión reemplazada conserva su texto original
donde estaba.

### Valores de HD-P3D-1..10 (elimina una ambigüedad histórica)

`PHASE_3_WAVE_0_DESIGN.md:3` declaraba "HD-P3D-1..10 congeladas", pero ningún documento
registraba qué opción había quedado en cada una. La tabla de opciones vive en
`PHASE_3_MINIMUM_VERTICAL_DESIGN.md` §23 (la confirmación humana la citó como "§23 de
`PHASE_3_WAVE_0_DESIGN.md`": es una anomalía de referencia, y el contenido corresponde al
documento del mínimo vertical). Quedan congeladas con la recomendación de §23:

- **HD-P3D-1 = A** — estado de reposo de un actuador digital = apagado. Se deriva y se
  documenta; no se guarda en el IR.
- **HD-P3D-2 = A** — la frase editable no ofrece `apagar`.
- **HD-P3D-3 = B** — `schemaVersion` sube sólo si el documento contiene una regla
  incompleta, y sólo si el contrato de representación realmente lo exige.
- **HD-P3D-4 = A** — quitar un componente referenciado por una regla se rechaza, con un
  texto nuevo. Sin cascada silenciosa.
- **HD-P3D-5 = A** — no se renombra `cuando` en el IR; se documenta como "condición de
  nivel".
- **HD-P3D-6** — §23 no tiene opción para esta fila: dice "**Resuelto por diseño** (R-1)".
  La regla vacía `{}` se sigue rechazando (`tests/nucleo-operaciones.test.mjs:778`), la
  regla nace con un slot y ningún test de Phase 1 se toca. Si un writer encuentra otra
  contradicción → STOP. Se registra tal cual, sin agregarle un valor.
- **HD-P3D-7 = A** — Wave 0 de correcciones antes de Phase 3. Ya cumplida (merge `ff8342c`).
- **HD-P3D-8 = A** — F-01/F-02 al backlog de producto. Ya cumplida.
- **HD-P3D-9 = A** — el reposo aparece sólo en el trazado pedagógico, no en la frase editable.
- **HD-P3D-10** — ver la reapertura de abajo.

### Reapertura acotada: el agente emite `SetComportamiento` y `QuitarComportamiento`

| OLD DECISION | SUPERSEDED BY | NEW DECISION | EVIDENCE |
|---|---|---|---|
| **HD-S2-10 = NO** (este archivo, Phase 2 Slice 2): ninguna `ComportamientoRegla` pulsador → LED; materializada en la whitelist R-6 de `opencode/tool/proyecto-fisico.ts`, que excluye `SetComportamiento` | PHASE 3 SEMANTIC VERTICAL #1 | El agente puede emitir **`SetComportamiento`** hacia el Project Engine a través de `proyecto-fisico` | REAL HUMAN TEST #1 (`PHASE_3_REAL_HUMAN_TEST_REPORT.md` §E2): el agente comprendió "mientras aprieto el pulsador se prenda el LED", pero no podía materializarlo en el proyecto |
| **HD-P3-7 = A** (`PHASE_3_DISCOVERY.md`; `PHASE_3_MINIMUM_VERTICAL_DESIGN.md` §0): edición sólo por el navegador; `proyecto-fisico` no recibe `SetComportamiento` | PHASE 3 SEMANTIC VERTICAL #1 | Opción **C** de la tabla original de HD-P3-7 ("las dos"): el navegador (frase editable, whitelist espejo en el servidor) **y** el agente | Ídem |
| **HD-P3D-10 = A** (`PHASE_3_MINIMUM_VERTICAL_DESIGN.md` §23): `QuitarComportamiento` excluido del agente | PHASE 3 SEMANTIC VERTICAL #1 | El agente puede emitir **`QuitarComportamiento`**, con la misma autoridad del Engine | Simetría operativa: corregir o deshacer una intención semántica sin mutación directa |

**Contrato que NO cambia:**
- La cadena de autoridad es lenguaje natural → el agente interpreta → operación tipada →
  Project Engine → validación → commit/reject → IR canónica.
- El agente no escribe JSON ni el IR, no saltea `baseRevision`, el dry-run, las
  transacciones ni la validación.
- La whitelist de la tool sigue **explícita y cerrada**: agrega exactamente esos dos tipos.
- Hay dos productores legítimos de intención (el agente y la frase del navegador) sobre
  el MISMO Engine y la MISMA IR. No es una segunda verdad.
- El cambio en `opencode/agent/tecnia-bot.md` se limita a lo funcional que exige el
  vertical (HD-05), con RED, tests y evidencia. No es una optimización estructural.
- Las demás HD-P3 / HD-P3D siguen congeladas.

### Excepción declarada a HD-P3D-6: fixture de REA-02 (2026-10-02)

- **Hallazgo (T2):** `tests/nucleo-rango-umbral-caminos.test.mjs` (REA-02, Phase 1, `c4cb0fa`)
  arma su regla con una **resistencia** (`clase: "pasivo"`) como actuador y exige
  `listo: true`. Sólo pasa mientras exista el bug que HD-P3-5 = A manda corregir: un
  componente que no es salida aceptado en silencio como actuador. Con `ACTUADOR_INVALIDO`
  queda `listo: false`.
- **Conflicto:** HD-P3-5 = A (validar el actuador) contra HD-P3D-6 (ningún test de Phase 1 se
  toca; si aparece una contradicción → STOP). El writer frenó; el orquestador verificó el
  diagnóstico.
- **Decisión humana (opción A):** MOD mínimo y declarado **sólo del fixture** de REA-02. El
  actuador pasa a ser un LED con su resistencia en serie. La intención del test no cambia:
  el warning de rango no afecta la readiness, `listo: true`, y los 4 caminos dan lo mismo.
  Ninguna aserción se debilita.
- **Alcance:** es el único archivo `tests/nucleo-*` modificado en este vertical. El freeze
  verifica que `git diff 8b43c59 HEAD -- 'tests/nucleo-*'` contenga exactamente este
  archivo.

## Phase 3 — Vertical semántico #2: Blockly semántico mínimo (2026-10-03)

Decisiones del HUMAN PRODUCT OWNER después del discovery del vertical #2. Nada histórico se
borra.

### Genealogía de HD-P3-10

| OLD DECISION | SUPERSEDED BY | NEW DECISION | EVIDENCE / RATIONALE |
|---|---|---|---|
| **HD-P3-10 = A** (`PHASE_3_DISCOVERY.md`; `PHASE_3_MINIMUM_VERTICAL_DESIGN.md` §0): "Blockly sólo después de validar la frase con estudiantes" | PHASE 3 SEMANTIC VERTICAL #2 (**D1 = A**) | La frase editable y el Blockly semántico mínimo se validan **juntos** en el REAL HUMAN TEST #2, después del freeze de este vertical. El test **no** se ejecuta en este ciclo | La frase nació después del REAL HUMAN TEST #1, así que ningún alumno la usó todavía. Las dos vistas comparten proyección y vocabulario, y una sola ronda humana puede observar ambas y separar qué entendió el alumno de cada una |

### Decisiones del vertical #2

- **D1 = A:** la de arriba.
- **D2 = A:** **Blockly 13.3.0**, vendorizado localmente en `opencode/tecniabot-web/`, con el mismo
  patrón que el bundle de Wokwi.
  - Origen: tarball oficial del registro npm, `blockly-13.3.0.tgz`
    (`sha512-qAHFGMGTSF67Lupr3pjZz9LQu4JCFdN76CMZxegBKiveZreK08yXhaCz0g9q9/xe5GEdoeFT3POAlQavPIRPEw==`,
    shasum `18947fe0f4992bbf1ee5051e2d18dabee7ee9581`, verificados).
  - Se incluye sólo el núcleo (`blockly_compressed.js`), los mensajes en español (`msg/es.js`)
    y los medios estrictamente necesarios.
  - Licencia Apache-2.0, documentada junto a los archivos.
  - Footprint aproximado: ~0,7 MB sin comprimir. El instalador copia carpetas de `opencode/`,
    así que **no** depende de `node_modules`.
  - pnpm sigue siendo la única política de paquetes. Blockly es **infraestructura de
    presentación**: no es modelo de dominio, ni persistencia, ni backend de código.
- **D3:**
  - sonidos de Blockly desactivados;
  - el servidor sirve localmente sólo los medios estrictamente necesarios;
  - **la CSP no se relaja**: sin `unsafe-eval`, sin orígenes externos, sin CDN;
  - `servidor-proyecto.ts` cambia sólo para servir esos assets de forma local y segura;
  - si Blockly exigiera relajar la CSP, es un blocker, no un ajuste.
- **D4:** sección **"Vista lógica"** junto a la frase editable, que se mantiene.
  - El workspace es fijo y semántico, sin toolbox general, para una sola regla, orientado al
    caso de nivel ("mientras").
  - Se edita con campos y opciones semánticas, y se reconstruye entero desde la IR.
  - No es un editor libre ni una biblioteca genérica de bloques; el drag-and-drop no es objetivo.
- **HD-P3-4 = A (confirmada):** la IR **no cambia**. La recomendación histórica "B cuando llegue
  Blockly" (`PHASE_3_DISCOVERY.md`) **no se activa**. "presionado" sigue siendo la proyección
  determinista de `estadoBooleano >= 1`. No entran a la IR block IDs, workspace JSON/XML,
  posiciones, conexiones visuales, layout, estado de toolbox ni metadata de Blockly.
- Las demás HD-P3 / HD-P3D y las decisiones del vertical #1 siguen vigentes.

## Semantic Vertical #3 — expresividad binaria mínima (2026-10-04)

Design Gate: `~/tecnia-bot-docs/semantic-vertical-3/SEMANTIC_VERTICAL_3_DESIGN_GATE.md` (fuera del
repo). Modelo **M1 aprobado** por el HUMAN PRODUCT OWNER, con decisiones OPEN-1..5 ratificadas
(OPEN-5 con enmienda). Nada histórico se borra: las decisiones reemplazadas conservan su texto donde
estaban.

| OLD DECISION | SUPERSEDED BY | NEW DECISION | REASON / EVIDENCE |
|---|---|---|---|
| **HD-P3D-1 = A**: estado de reposo de un actuador digital = apagado (derivado, no se guarda) | SEMANTIC VERTICAL #3 (OPEN-1) | Para un actuador **binario** con complemento **declarado**, reposo = **complemento del estado objetivo**. Sigue siendo derivado, no se guarda, no es un "si no" almacenado | Human Test #2 y #3: límite de expresividad repetido; en HT3 el participante esperó "encendido y apagado" y propuso "que el LED estaría todo el tiempo prendido salvo cuando apriete el botón" (`physical-view-human-test-3/DECISION_INPUT.md`, E-20/E-21) |
| **HD-P3D-2 = A**: la frase editable no ofrece `apagar` | SEMANTIC VERTICAL #3 (OPEN-1) | `apagar` se ofrece si el tipo del actuador lo declara (opciones derivadas de ComponentKnowledge) | Con reposo complementario, "mientras presionado → apagado" deja de ser degenerado: es exactamente la intención de HT3 |

Decisiones ratificadas:

- **OPEN-2:** la relación complementaria vive en `DEFINICIONES_ACCION.complementaria` (catálogo, entra
  al hash semántico). Catálogo **2.0.0 → 2.1.0**. Proyectos viejos no se migran, `createdWith` no se
  reescribe, el desfase se ve con `CATALOGO_CAMBIO_DETECTADO`. Un documento viejo con `apagar` cambia
  de significado (de "no cambia nada visible" a "apagado mientras…, encendido fuera") y lo muestra.
- **OPEN-3:** HD-P3D-9 sigue vigente: la frase no dice "si no". La traza explica el reposo derivado
  ("…→ la condición es falsa → el LED está encendido (reposo)."). El texto de la traza no se persiste.
- **OPEN-4:** "presionado" = `estadoBooleano >= 1`, "suelto" = `estadoBooleano < 1` (complementos
  exactos), fuente única `nucleo/estado-booleano.ts`. Se elimina la duplicación que había en
  `snapshot-a-vista.ts` (`CONDICION_PRESIONADO`) y en el vocabulario del agente. Otras tríadas
  equivalentes siguen como "condición avanzada".
- **OPEN-5 (con enmienda):** "salvo/excepto cuando C, X" se normaliza a `{C, complemento de X}` **sólo**
  si ComponentKnowledge declara el complemento de X. El agente nunca lo calcula ni lo inventa; sin
  complemento declarado pide aclaración o informa que no es representable. "Que quede prendido" sin
  condición sigue fuera del modelo de nivel (no se reinterpreta como latch).
- **D-11 (Component System Decision Freeze):** se implementa `ACCION_NO_SOPORTADA` — estado objetivo
  que el tipo del actuador no declara. Blocking, representable, persistible; nunca un rechazo.
- `entonces.accion` **no se renombra**; se documenta como estado objetivo sostenido (`ir.ts`,
  `IR-SPEC.md`). El esquema y `schemaVersion` no cambian.

## Multi-Rule Safety — un único dueño semántico por actuador (2026-10-04)

Design Gate: `~/tecnia-bot-docs/multi-rule-safety/MULTI_RULE_SAFETY_DESIGN_GATE.md` (fuera del repo).
**Modelo B aprobado** por el HUMAN PRODUCT OWNER, decisiones OPEN-1..7 congeladas.

| OLD | SUPERSEDED BY | NEW | REASON / EVIDENCE |
|---|---|---|---|
| Las reglas (comportamientos) no tenían ninguna invariante semántica entre sí; varias reglas sólo producían el aviso genérico "Hay varias reglas: la herramienta todavía no analiza si se contradicen." (`plan-de-pintado.js`) | MULTI-RULE SAFETY IMPLEMENTATION #1 | **Un único propietario semántico del estado sostenido por actuador** (modelo LEVEL). Varias reglas sobre el mismo actuador → `MULTIPLES_AUTORIDADES_ACTUADOR`; el aviso genérico se retira | COMPLEX INTEGRATION TEST #1 (`~/tecnia-bot-docs/complex-integration-test-1/`): "presionado→encendido" + "presionado→apagado" sobre el mismo LED quedaban `listo`; también "suelto→LED 2" + "DHT22>30→LED 2". Con reposo complementario (Vertical #3), dos reglas completas sobre un actuador binario son redundantes o contradictorias en algún estado |

Declaración normativa: **"En el modelo LEVEL, cada actuador tiene como máximo un propietario semántico
de su estado sostenido. La composición futura de condiciones/casos ocurre dentro de ese propietario, no
mediante reglas independientes que compiten por el mismo actuador."** No autoriza todavía OR, AND, AST de
condiciones, casos, prioridades ni eventos.

Decisiones congeladas:

- **OPEN-1:** propiedad **por referencia** — una regla reclama un actuador desde que existe
  `entonces.actuador = X`, aunque esté incompleta (un borrador puede producir conflicto: representable,
  visible y corregible).
- **OPEN-2:** reglas **equivalentes** sobre el mismo actuador también son autoridad múltiple (blocking).
  No se razona equivalencia de condiciones.
- **OPEN-3:** código `MULTIPLES_AUTORIDADES_ACTUADOR`, **un motivo por regla involucrada**, `datos
  { actuador, comportamiento, otras }`; severidad blocking, clasificación representable. Ni el motivo ni
  la propiedad se persisten: se derivan del IR.
- **OPEN-4:** la frase de una regla en conflicto sigue visible; la traza **no** afirma el reposo derivado
  ni elige ganador: explica que la regla sola no puede determinar cómo queda el actuador.
- **OPEN-5:** representable + blocking; la operación no se rechaza ni se hace rollback por este motivo.
  Documentos históricos con varios dueños siguen recargables y editables, sin migración ni reescritura.
- **OPEN-6:** el agente distingue intención: REEMPLAZAR/MODIFICAR → editar la regla dueña por su `id`;
  AGREGAR/COMBINAR → no crear en silencio un segundo dueño, explicar el límite y preguntar si reemplaza.
- **OPEN-7:** se retira el aviso genérico; varias reglas sobre actuadores distintos son válidas sin aviso.
- Sin prioridades, sin semántica de orden, sin "la última gana". Sin cambio de IR, `schemaVersion` ni
  catálogo.
