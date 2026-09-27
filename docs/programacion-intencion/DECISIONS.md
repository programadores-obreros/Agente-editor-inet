# DECISIONS.md — decisiones de implementación de Fase 1

Registro vivo, una entrada por decisión, en orden de aparición. Referencia el diseño
consolidado (`T_diseno_consolidado.md`, fuera del repo) y el brief congelado
(`BRIEF.md`) por número de sección, nunca los transcribe.

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

## `Almacen.list()` y detección de modificación externa — fuera de Fase 1

**Decisión del orquestador:** ambos quedan fuera del alcance mínimo de Fase 1
(`almacen.ts`, Gate 7). Documentado acá como límite conocido, no como olvido.

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
