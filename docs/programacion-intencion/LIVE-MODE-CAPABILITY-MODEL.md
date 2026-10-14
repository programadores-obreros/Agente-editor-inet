```
STATUS: SUPERSEDED (2026-10-13)
IMPLEMENTATION: Modo Vivo V1–V4 implementado en opencode/vivo/, opencode/codegen/runtime*.ts y opencode/tool/vivo.ts (rama feat/modo-vivo-v4-wifi)
```
> Este documento fue la exploración previa. Lo vigente es `tecnia-bot-docs/esp32-completo/MODO-VIVO-PLAN.md`
> (decisiones HD-08) y `PROTOCOLO-VIVO-V1.md` (contrato; §9 decisiones V4-x), resumidos en `DECISIONS.md`
> («Modo Vivo — HD-08 y V4»). Sigue sin haber daemon: la sesión viva corre dentro del proceso de OpenCode
> (puente Python con pyserial) y el runtime, en la placa.

# Modo Vivo — Capability Model (propuesta)

## Tres fuentes de capacidad, nunca colapsadas en una (ver `LIVE-MODE-ARCHITECTURE.md`)

| Fuente | Pregunta | Ejemplo | De dónde sale |
|---|---|---|---|
| **A. BOARD CAPABILITY** | ¿Qué puede hacer esta placa, en teoría? | "GPIO6 soporta PWM" | `BOARD-CONTRACT.md`/`COMPONENT-CATALOG.md` (metadata, catálogo — conocido por el HOST) |
| **B. RUNTIME CAPABILITY** | ¿Qué implementa el runtime que está cargado ahora mismo? | "runtime v0.2 implementa `setPWM`" | Handshake/negociación con el runtime conectado |
| **C. PHYSICAL STATE / PRESENCE** | ¿Qué hay conectado físicamente ahora mismo? | "hay un servo en GPIO6" | **No se deduce de A ni de B** — necesita evidencia técnica específica (ver vocabulario de evidencia abajo) |

Una versión anterior de este documento (y de `LIVE-MODE-PROTOCOL.md`/
`LIVE-MODE-ARCHITECTURE.md`) colapsaba B dentro de A, haciendo que `capabilities` del
runtime pareciera salir directamente del catálogo de placas — corregido.

## Vocabulario de evidencia: KNOWN / OBSERVED / INFERRED / UNKNOWN

Cada valor, definido con un ejemplo concreto:

| Valor | Definición | Ejemplo |
|---|---|---|
| `KNOWN` | Viene de una fuente de verdad ya existente (catálogo, contrato de placa — fuente A) | "GPIO6 soporta PWM" = `KNOWN` (lo dice `BOARD-CONTRACT.md`) |
| `OBSERVED` | Se leyó en vivo del runtime/la placa real en esta sesión | "el runtime aceptó `setPWM(GPIO6, 50%)`" = `OBSERVED` |
| `INFERRED` | Se dedujo indirectamente, no se observó directamente | ej. inferir un componente por el patrón de consumo eléctrico, sin confirmación directa |
| `UNKNOWN` | No hay evidencia de ningún tipo | "hay un servo en GPIO6" = `UNKNOWN`, salvo que exista evidencia técnica específica (ej. el runtime lo reportó como `OBSERVED`) |

Este vocabulario de evidencia es el que se usa en la práctica; un vocabulario anterior de
"capacidad declarada" (`SUPPORTED`/`UNSUPPORTED`/`OBSERVABLE`/`INFERABLE`/`UNKNOWN`, 5
valores) mezclaba "capacidad de catálogo" (fuente A) con "capacidad observable en vivo"
(fuentes B/C) en una sola escala — se retira de este documento; las fuentes A/B/C de
arriba ya cubren esa distinción de forma separada, sin mezclar catálogo con evidencia.

## Por qué tres fuentes y no una escala sola

Confundir "la placa soporta PWM" (A, puede ser cierto sin haber conectado nunca nada),
"el runtime v0.2 implementa `setPWM`" (B, depende de qué runtime esté cargado) y
"detecté un servo en GPIO 6 ahora mismo" (C, evidencia física puntual) es exactamente el
tipo de confusión que la invariante pedagógica de abajo existe para evitar.

## INVARIANTE PEDAGÓGICA (PROPOSED)

Una afirmación sobre el **código/catálogo** ("este firmware configura GPIO 6 como PWM",
fuente A/`KNOWN`) y una afirmación sobre el **mundo físico** ("detecté un servo en GPIO
6", fuente C/`OBSERVED`) son dos clases de oración distintas, con dos niveles de
evidencia requeridos distintos. **Nunca se vende inferencia como observación**: una
lectura `INFERRED` o `UNKNOWN` no se frasea nunca como si fuera `OBSERVED`.

Esto es una extensión directa de la doctrina ya vigente en el repo
("Un OK falso es peor que un error", `tecnia-bot/CLAUDE.md`) al dominio físico: un bot
que le dice al alumno "tu servo está conectado" sin haberlo comprobado está cometiendo
exactamente el mismo error que `uninstall.ps1` NO comete (relee antes de afirmar).

**Dónde viviría esta invariante, si se adopta** (no se resuelve acá, sólo se ubica):

- El prompt del producto (`opencode/agent/tecnia-bot.md`) necesitaría una regla nueva
  que la aplique a cada afirmación sobre estado físico — sujeto al mismo acoplamiento a
  tests que ya tiene ese prompt.
- El Capability Model de este documento sería la fuente de vocabulario.
- Una rule de producto (`.claude/rules/`) podría fijar la regla operativa corta, con el
  detalle completo quedando en este documento.

## Cuestión arquitectónica abierta: la IR no distingue estos niveles

`opencode/nucleo/ir.ts` tiene un único estado canónico (ver el encabezado de
`opencode/nucleo/ir.ts:1-10`). Si Modo Vivo se construye, "desired state"
seguiría siendo la IR tal cual existe hoy; "observed/runtime/physical" (las fuentes B/C
de arriba) sería **otro dominio**, que esta propuesta explícitamente NO resuelve ni dice
que deba escribirse dentro de la IR — Modo Vivo no puede escribir observaciones en la IR
sin una decisión de diseño explícita. Es una pregunta para quien diseñe Modo Vivo en
serio, no una respuesta de este documento.
