```
STATUS: PROPOSED
IMPLEMENTATION: NOT IMPLEMENTED
```
> Nada de este documento existe hoy en el código. `CURRENT-ARCHITECTURE.md:126` dice
> explícitamente que no hay daemon.

# Modo Vivo — Arquitectura (propuesta)

## Cadena conceptual

```
UI / Tecnia Bot
      ↕   transporte host — ABIERTO (ver "Transporte" abajo y LIVE-MODE-RESEARCH-QUESTIONS.md)
Tecnia Live Service
      ↕
Tecnia Live Protocol
      ↕
Tecnia Live Runtime
      ↕
Arduino/ESP32
      ↕
Hardware
```

Dos planos que **no deben mezclarse** si esto se construye alguna vez:

## BUILD/FLASH PLANE — ya existe, determinista, no cambia con esta propuesta

`opencode/tool/platformio.ts` (1.217 líneas). Acciones: `compile` (`pio run`), `flash`
(detecta puerto si falta, `pio run --target upload`), `both`, `monitor` (abre terminal
nueva por SO, lee `monitor_speed` del `.ini` local — sin canal propio), `diagnostico`
(`pio --version` + `pio device list --json-output` + detección de drivers en Windows),
`reparar` (sólo ejecuta algo en Windows, `bootstrap.ps1`). Detección de puerto vía
VID:PID (`CHIPS_USB`), 100% determinista salvo la generación de código (responsabilidad
del LLM). Nada de esto cambia si Modo Vivo se construye — son planos distintos.

## LIVE INTERACTION PLANE — propuesto, no existe

| Componente | Rol propuesto | Estado |
|---|---|---|
| UI | Mostrarle al alumno/docente el estado en vivo de la placa (lecturas, última acción) | PROPUESTO |
| Live Service (Tecnia Live Service) | Un servicio (¿daemon? ¿proceso bajo demanda?) que hable el Tecnia Live Protocol y lo traduzca a eventos | PROPUESTO — ver preguntas abiertas en `LIVE-MODE-RESEARCH-QUESTIONS.md` |
| Protocol (Tecnia Live Protocol) | El vocabulario semántico de comandos/eventos (ver `LIVE-MODE-PROTOCOL.md`) | PROPUESTO, exploratorio |
| Runtime (Tecnia Live Runtime) | Qué corre en la placa para responder al protocolo — ver "Runtime" abajo | PROPUESTO, sin decidir |
| Board | El contrato de pines/capacidades ya existente (`BOARD-CONTRACT.md`, TARGET) como fuente de qué es físicamente posible preguntar/accionar | TARGET existente, reutilización PROPUESTA |
| Hardware | La placa física conectada por USB/serie | Real, sin cambios |

**Separación explícita de responsabilidad**: BUILD/FLASH PLANE sigue siendo el único
camino para subir código a la placa. LIVE INTERACTION PLANE, si existiera, opera dentro
de las capacidades que el Tecnia Live Runtime ya cargado anuncia — nunca generaría ni
modificaría código por su cuenta.

## Transporte — pregunta ABIERTA, no fijada

**Ninguna opción de transporte está decidida.** No se fija WebSocket, ni serie/WebSerial,
ni WebUSB. Las alternativas (proceso Node/Bun con acceso directo al puerto serie vs.
navegador vía WebSerial/WebUSB vs. algún otro canal) se evalúan en
`LIVE-MODE-RESEARCH-QUESTIONS.md` — este documento no elige ninguna de antemano.

## Runtime — qué significa "Tecnia Live Runtime"

Un Tecnia Live Runtime compatible se carga **UNA VEZ** en la placa (vía el BUILD/FLASH
PLANE existente). Una vez cargado, y **dentro de SUS capacidades anunciadas**, se
interactúa con él (`setDigital`, `setPWM`, `setServo`, `readDigital`, `readAnalog`,
`subscribe` — ver `LIVE-MODE-PROTOCOL.md`) **sin editar el source, sin build y sin
flash por cada acción**.

Esto **NO implica**:
- código fuente vivo (el firmware no se edita en caliente);
- soporte universal (sólo lo que ESE runtime, en SU versión, anuncia que implementa);
- "cero reflasheos para siempre" (cambiar de runtime, o de su versión, sigue pasando por
  BUILD/FLASH);
- capacidades mágicas (el runtime no adquiere capacidades que no implementa).

**El runtime define qué es dinámico** — no el firmware compilado "ya definiendo los
pines" como describía una versión anterior de este documento: la unidad de capacidad es
la versión del runtime cargado, anunciada por él mismo (ver "Capacidades" abajo), no una
inspección estática del binario compilado.

## Capacidades — tres fuentes separadas, nunca colapsadas en una

| Fuente | Pregunta que responde | Ejemplo | De dónde sale |
|---|---|---|---|
| **A. BOARD CAPABILITY** | ¿Qué puede hacer esta placa, en teoría, según el catálogo? | "GPIO6 soporta PWM" | `BOARD-CONTRACT.md` / `COMPONENT-CATALOG.md` (metadata, HOST) |
| **B. RUNTIME CAPABILITY** | ¿Qué implementa el runtime que está cargado ahora mismo? | "runtime v0.2 implementa `setPWM`" | Handshake/negociación con el runtime conectado |
| **C. PHYSICAL STATE / PRESENCE** | ¿Qué hay conectado físicamente ahora mismo? | "hay un servo en GPIO6" | **No se deduce de A ni de B** — necesita evidencia propia (ver Capability Model) |

Estas tres fuentes son independientes: que A diga "soportado" no implica B lo implemente
en esta versión de runtime, y ninguna de las dos prueba C.

## Procedencia (quién sabe qué)

- El **HOST** (Tecnia Bot/OpenCode) conoce: board contracts, catálogo de componentes,
  metadata, el proyecto (IR) y su historial.
- El **RUNTIME** (corriendo en la placa) anuncia, al conectarse: versión de runtime,
  versión de protocolo, identidad si es verificable, comandos implementados,
  capacidades runtime propias y estados observables.
- El **LIVE SERVICE** combina ambas fuentes **conservando PROVENANCE** — nunca funde
  "lo que el host ya sabía" con "lo que el runtime acaba de anunciar" en un solo valor
  sin trazar de dónde vino cada parte.

Esto corrige una imprecisión de la versión anterior de este documento, que hacía decir a
la fila "Board" que el contrato de pines/capacidades ya existente era la fuente directa
de `capabilities` del protocolo — ver `LIVE-MODE-PROTOCOL.md`.
`capabilities` del runtime (B) NO sale de `BOARD-CONTRACT.md`/`COMPONENT-CATALOG.md` (A):
son dos fuentes distintas que el Live Service combina, no una que sustituye a la otra.

## Por qué no hay daemon hoy

`CURRENT-ARCHITECTURE.md:124-127`: el único proceso persistente que lanza Tecnia Bot es
el TUI local de OpenCode; `rg -ni "daemon|websocket|ws://"` sobre
`nucleo/tool/vista-fisica/servidor` da 0 resultados. Cualquier Live Service sería un
proceso nuevo, con superficie de ataque y de mantenimiento nueva — por eso este
documento es PROPUESTA y no una tarea con fecha.
