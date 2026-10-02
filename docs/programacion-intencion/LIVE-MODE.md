```
STATUS: PROPOSED
IMPLEMENTATION: NOT IMPLEMENTED
```
> Nada de este documento existe hoy en el código. `CURRENT-ARCHITECTURE.md:126` dice
> explícitamente que no hay daemon.

# Modo Vivo — README

## Qué es

"Modo Vivo" es el nombre propuesto para una futura capacidad de comunicación en vivo
entre Tecnia Bot y la placa física conectada (leer sensores en tiempo real, accionar
actuadores desde el chat, ver el estado reportado por el firmware). **Hoy no existe.**
Lo único que existe es: compilar (`platformio.ts`, acción `compile`/`flash`/`both`),
abrir un monitor serie en una terminal nueva del sistema operativo (acción `monitor`,
que llama `pio device monitor` y no tiene canal propio), y la vista física estática
(`vista-fisica/*`, proyección HTML/canvas de la IR declarada — no telemetría).

## Cadena conceptual (propuesta, nadie de esto está fijado como protocolo final)

```
UI / Tecnia Bot
      ↕
transporte host (WebSocket u otro — ABIERTO, ver LIVE-MODE-RESEARCH-QUESTIONS.md)
      ↕
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

Cada flecha es una pregunta de diseño propia, no una decisión tomada. Ver
`LIVE-MODE-ARCHITECTURE.md` para el detalle de cada eslabón.

## Por qué este documento existe

Para dejar el espacio de diseño escrito y explorable **sin** que alguien lo confunda
con una funcionalidad construida, y sin bloquear el trabajo real de Fase 1/2/3 del
núcleo declarativo. Es insumo para una decisión futura, no un compromiso de
implementación.

## Cómo leer esta carpeta

| Documento | Para qué sirve |
|---|---|
| `LIVE-MODE-ARCHITECTURE.md` | Separa el plano BUILD/FLASH (lo que ya existe, determinista) del plano de INTERACCIÓN EN VIVO (lo que no existe); define los tres planos de capacidad (board/runtime/presencia física) y la procedencia de cada uno |
| `LIVE-MODE-PROTOCOL.md` | Qué necesidades semánticas tendría un protocolo en vivo (`setDigital`, `readAnalog`, etc.) — exploratorio, no una API final |
| `LIVE-MODE-CAPABILITY-MODEL.md` | Cómo se distinguiría lo soportado de lo observado de lo inferido — y cómo eso conecta con la invariante pedagógica de no mentirle al alumno sobre el estado físico |
| `LIVE-MODE-RESEARCH-QUESTIONS.md` | Las preguntas abiertas que habría que responder antes de construir cualquier cosa de esto (transporte, daemon vs directo, seguridad, etc.) |

## Relación con la IR

La IR hoy (`opencode/nucleo/ir.ts`) no distingue desired/observed/runtime/physical —
es un único estado canónico. Modo Vivo, si alguna vez se construye, **no debería**
escribir estado "observado en vivo" directamente en esa misma IR sin una decisión de
diseño explícita — ver la cuestión arquitectónica abierta en
`LIVE-MODE-CAPABILITY-MODEL.md`.

## Qué NO es este documento

- No es una especificación lista para implementar.
- No es una promesa de roadmap.
- No reemplaza ni modifica `TARGET-ARCHITECTURE.md`, `IR-SPEC.md` ni ninguna decisión ya
  tomada en `DECISIONS.md`.
