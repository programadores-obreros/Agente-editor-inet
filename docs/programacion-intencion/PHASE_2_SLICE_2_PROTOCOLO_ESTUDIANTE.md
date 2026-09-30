# Phase 2 Slice 2 — protocolo de prueba con estudiante o docente

**ESTADO: NO EJECUTADO — no se afirma validación con estudiantes.** Este documento
traslada el protocolo de `PHASE_2_SLICE_2_DESIGN.md` §8 (propuesto en el diseño
aprobado, "no se ejecuta en el gate técnico") a un formato listo para usar con una
persona real. Nada de lo que sigue reporta una observación efectivamente hecha —
es el instrumento, no el resultado. Cuando se ejecute, la evidencia (tarea, perfil,
observaciones, cambios de diseño derivados) va en un documento aparte
(`PHASE_2_SLICE_2_DESIGN.md` §8 pide ese entregable), nunca reescribiendo este
protocolo.

## 0. Antes de empezar

- **Perfil:** 1 estudiante de escuela técnica, nivel inicial, sin datos
  personales relevados. Se aclara ANTES de empezar que se evalúa la herramienta,
  no a la persona — nada de lo que la persona haga o diga se usa para calificarla.
- **Qué NO es este protocolo:** no mide desempeño, no tiene puntaje, no es una
  evaluación docente. Es una sesión de observación cualitativa para encontrar
  fricciones de la herramienta.
- **Preparación técnica:** un proyecto físico recién sembrado (ESP32 + LED +
  pulsador, `scripts/vista-fisica-demo.mjs`) abierto en el navegador, en un estado
  conocido antes de que la persona se siente. El observador no interviene en la
  pantalla salvo que el guion lo pida explícitamente (paso 5, recargar).
- **El observador no da respuestas.** Si la persona pregunta "¿está bien esto?",
  se repregunta ("¿vos qué pensás?") en vez de confirmar o corregir.

## 1. Guion (verbatim, en el orden del diseño)

1. "Abrí el proyecto; contame qué ves."
2. "¿Cuál recibe información y cuál la produce?" — los rótulos Entrada/Salida
   están visibles en la vista (`snapshot-a-vista.ts::rolDeClase`, §3.3 del
   diseño); se registra si la persona los usa para responder o si razona sin
   ellos (por ejemplo, mirando el cableado o el nombre del componente).
3. "Cambiale el pin al pulsador." (usando el `<select>` del terminal `senal`).
4. "Antes de recargar, ¿qué esperás encontrar?" — se anota la predicción ANTES
   de recargar la página; después se recarga y se compara contra lo que
   realmente aparece (invariante PERSISTIBLE ⇒ RECARGABLE, §1 pasos 7-9 del
   diseño).
5. "Poné el pulsador en GPIO34." Después: "¿Qué pasó? ¿Podés seguir? Corregilo."
   — se observa si la persona usa el texto de la explicación
   (`explicaciones-motivos.ts`, código `PIN_SIN_PULLUP_INTERNO`) para entender
   el bloqueo y corregirlo (reasignar a un pin normal), o si necesita ayuda.
6. "¿Qué le agregarías después?" — sin dar pistas. Se registra si surge sola,
   espontáneamente, la idea de una condición "cuando lo apriete, que prenda el
   LED" — esa relación NO existe en el producto (HD-S2-10, non-goal duro) y no
   se implementa aunque la persona la pida; el interés de la pregunta es
   puramente observacional (¿el diseño entrada/salida hace pensar en el paso
   siguiente, aunque ese paso no esté construido?).

## 2. Planilla de observación (cualitativa, SIN SCORE)

Una fila por sesión. Cada casillero es una anotación en prosa breve, nunca un
número ni una escala — el diseño (§8) pide explícitamente "cualitativo, sin
score".

| Pregunta observacional | Sí | Con pista/ayuda | No | Notas textuales (qué dijo/hizo) |
|---|---|---|---|---|
| ¿Reconoce entrada/salida? | | | | |
| ¿Predice correctamente lo que pasa al recargar? | | | | |
| ¿Usa la explicación en texto llano para corregir el bloqueo? | | | | |
| ¿Explica lo que ve con sus propias palabras (no repite la jerga de la pantalla)? | | | | |
| ¿Verbaliza espontáneamente una condición pulsador→LED en el paso 6? | | | | |

Además, registrar en texto libre:
- **Errores de comprensión** observados (qué esperaba la persona que NO coincide
  con el comportamiento real, y por qué podría estar confundida).
- **Intervenciones del observador** (cualquier momento en que tuvo que ayudar,
  aclarar o repetir la pregunta — con qué palabras).
- **Cambios de diseño derivados** (si algo de la sesión sugiere que un texto, un
  rótulo o un flujo debería cambiar — sin implementarlo en la sesión misma).

## 3. Observación previa conocida (heredada de Slice 1, fuera del alcance de Slice 2)

Los selectores de GPIO muestran **ids internos** en vez de nombres legibles: la
etiqueta de cada `<select>` es literalmente `${componenteId} / ${terminalId}`
(por ejemplo `"cmp-1 / senal"`, `opencode/vista-fisica/web/pintar.js`, función
`pintarSelectorGpio`), nunca el `nombreVisible` del catálogo ("Pulsador") ni un
nombre del terminal en lenguaje llano ("Señal"). Esta limitación:

- **Viene de Slice 1** (el selector de GPIO ya existía antes de este slice; sólo
  el rótulo Entrada/Salida y el pulsador son nuevos de Slice 2).
- **Queda deliberadamente FUERA del alcance de Slice 2** — el diseño aprobado
  (`PHASE_2_SLICE_2_DESIGN.md` §3.3) sólo agrega el rol pedagógico Entrada/Salida
  junto a la pieza; no toca el selector de GPIO ni su etiqueta.
- Es una fricción esperable durante la sesión: es razonable que la persona no
  entienda de entrada qué es `"cmp-1 / senal"` y necesite ayuda para ubicar cuál
  selector corresponde al pulsador. Si eso ocurre, se anota en "errores de
  comprensión" — no es un fallo del protocolo ni de la sesión, es exactamente el
  tipo de hallazgo que este protocolo existe para capturar, para una decisión de
  producto posterior (no de este slice).

## 4. Entregable de una sesión ejecutada (para cuando se ejecute)

Un documento nuevo (no este protocolo) con: la tarea usada (este guion, sin
cambios o con los cambios anotados), el perfil de la persona (sin datos
personales), la planilla completa de §2, los errores de comprensión e
intervenciones en texto libre, y los cambios de diseño derivados propuestos —
cita textual del diseño (§8): "tarea, perfil, observaciones, errores de
comprensión, intervenciones y cambios de diseño derivados".
