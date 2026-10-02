```
STATUS: PROPOSED
IMPLEMENTATION: NOT IMPLEMENTED
```
> Nada de este documento existe hoy en el código. `CURRENT-ARCHITECTURE.md:126` dice
> explícitamente que no hay daemon.
>
> **EXPLORATORIO, no es una API final.** Cada nombre de abajo es un placeholder de
> necesidad semántica, no un contrato congelado.

# Modo Vivo — Protocolo (propuesta exploratoria)

Necesidades semánticas primero, forma de wire después — a propósito, para no comprar
una API equivocada sólo porque "hay que elegir algo":

| Necesidad | Para qué serviría | Preguntas abiertas |
|---|---|---|
| `setDigital` | Poner un pin digital en alto/bajo | ¿Valida contra `BOARD-CONTRACT.md` antes de enviar? |
| `setPWM` | Fijar un duty cycle | ¿Rango normalizado 0-1 o crudo del chip? |
| `setServo` | Mover un servo a un ángulo | ¿Es un caso particular de PWM o una necesidad propia? |
| `readDigital` | Leer el estado de un pin digital | ¿Polling o push? |
| `readAnalog` | Leer un valor analógico | ¿Con qué resolución/escala — la del ADC real de cada placa? |
| `subscribe` | Pedir que se empujen cambios de un pin sin pedirlo cada vez | Define si el protocolo es push o sólo pull |
| `capabilities` | Preguntar qué implementa el **runtime** conectado ahora mismo (RUNTIME CAPABILITY, fuente B — ver `LIVE-MODE-ARCHITECTURE.md`) | NO sale de `BOARD-CONTRACT.md`/`COMPONENT-CATALOG.md` (esos son BOARD CAPABILITY, fuente A) — es un handshake propio del runtime, que el Live Service combina con A conservando procedencia, nunca lo sustituye |
| `ping` | Confirmar que el canal sigue vivo | ¿Cada cuánto? ¿Quién lo inicia? |
| `error` | Reportar una falla del canal o del firmware | Necesita el mismo rigor de "no mentir" que ya rige el resto del repo (ver invariante pedagógica) |

## Por qué "necesidades semánticas antes que API"

El patrón de este repo (ver `IR-SPEC.md`) es definir primero qué se necesita expresar y
recién después la forma concreta. Nombrar `setDigital`/`readAnalog` ahora no implica
que el wire format final use esos nombres ni esa forma — es vocabulario de trabajo para
que `LIVE-MODE-RESEARCH-QUESTIONS.md` tenga sobre qué preguntar.

## Relación con el Capability Model

Cada comando de esta tabla sólo tendría sentido ejecutarlo si se confirmaron **las dos
fuentes por separado**: que `BOARD-CONTRACT.md`/`COMPONENT-CATALOG.md` dicen que la
placa lo soporta en teoría (BOARD CAPABILITY, fuente A) **y** que el `capabilities` del
runtime conectado confirma que esta versión de runtime lo implementa (RUNTIME
CAPABILITY, fuente B). Ninguna de las dos, por sí sola, prueba que hay un componente
físico presente respondiendo (PHYSICAL STATE/PRESENCE, fuente C) — ver
`LIVE-MODE-CAPABILITY-MODEL.md` y `LIVE-MODE-ARCHITECTURE.md` para las tres fuentes y el
vocabulario de evidencia KNOWN/OBSERVED/INFERRED/UNKNOWN.
