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
