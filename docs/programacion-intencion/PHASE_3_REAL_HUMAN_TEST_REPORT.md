# Phase 3: reporte de la PRUEBA HUMANA REAL #1 (§26)

> **Tipo de evidencia: REAL HUMAN TEST #1.** Interacción de una persona real en la VM Windows preparada para la prueba. No es simulación, ni subagente, ni role-play de un modelo, ni test automatizado.
> Protocolo: `PHASE_3_REAL_HUMAN_TEST_PROTOCOL.md` (sin modificar). Este documento registra la ejecución; las desviaciones respecto del protocolo se declaran en §D.
> Regla de evidencia: lo que no quedó registrado de la persona es `NOT_OBSERVED`. **Nunca** se convierte `NOT_OBSERVED` en `PASS`. Cada sección separa OBSERVACIÓN de INTERPRETACIÓN.

Trazabilidad: PROTOCOL (`PHASE_3_REAL_HUMAN_TEST_PROTOCOL.md`) → EXECUTION (§B–§D) → OBSERVATION (§E) → RESULT (§G) → PHASE 3 GATE (§K).

## A. Build

- **PREVIOUSLY VERIFIED** (no re-verificado durante la prueba): el manifest del freeze pre-humano (`PHASE_3_PRE_HUMAN_TEST_MANIFEST.txt`, SHA-256 `b433b310…4e56dd`; zip `3bb59dc0…3a62a7`) registra `WINDOWS_STATUS: PASS — 82be617 instalado en el lugar, 17/17 iguales (instalado y C:\tb-human)`.
- Producto en el repo: `82be617` (árbol de producto idéntico en `main` tras el merge `1ee0dc8`: subárboles `opencode/`, `tests/`, `scripts/` y `package.json` iguales).
- **OBSERVED DURING THIS HUMAN TEST:** no se registró una comprobación de identidad de la instalación durante la sesión.

## B. Entorno

- OBSERVADO: VM Windows de la prueba pre-humana, ya prendida al empezar.
- OBSERVADO: workspace/perfil visible `C:\tb-human\proyecto-alumno`.
- OBSERVADO: la vista física se abrió sola en el navegador.
- No se registró más información del entorno (navegador, pestañas previas, lanzador exacto).

## C. Participantes

- Una persona real. No se registraron el rol (alumno o docente) ni la experiencia previa.
- La prueba del docente (protocolo §5) no se ejecutó.

## D. Protocolo ejecutado y desviaciones

| # | Protocolo versionado | Ejecución real | Tipo |
|---|---|---|---|
| D1 | Consigna 1: "Quiero armar algo con un ESP32, un LED y un pulsador." | "Quiero hacer un circuito con un ESP32, un LED y un pulsador." | Desviación de redacción. El contenido es el mismo; además nombra "circuito". |
| D2 | Consigna 2: "Quiero que el LED se prenda cuando aprieto el pulsador." | "Ahora quiero que mientras aprieto el pulsador se prenda el LED." | **Desviación deliberada:** "mientras" en lugar de "cuando" (ver nota). |
| D3 | Preguntas finales al participante, respuesta casi literal (§4) | La pregunta "Cuando viste el dibujo del circuito, ¿qué entendiste que mostraba? Contame con tus palabras." se envió por error al chat de Tecnia Bot. **Respondió el modelo, no la persona.** | Falla de ejecución del facilitador. |
| D4 | Checkpoints H1–H19 y preguntas finales 1–6 | Sólo se registró lo descrito en §E | Cobertura parcial |

Nota sobre D2. Es una decisión posterior al protocolo y no se editó el protocolo hacia atrás. La razón es que el próximo vertical investigado usa semántica de NIVEL ("MIENTRAS la condición sea verdadera → mantener la acción"; HD-P3-2 = A). Esa razón es una **interpretación arquitectónica posterior**, no una observación de la prueba. `PHASE_3_MINIMUM_VERTICAL_DESIGN.md` §16 (protocolo de la prueba humana *posterior* al vertical) pide no nombrar "mientras" antes de que lo use el alumno. Esa regla no gobernaba esta prueba, pero conviene tenerla en cuenta: la consigna de esta prueba ya fue inductiva respecto de "mientras".

## E. Observaciones (textuales o en sustancia)

### E1. Consigna 1 → proyecto físico
- Tecnia Bot preguntó: "Antes de arrancar, ¿cómo se usa esta computadora?", con opciones equivalentes a 1. Del aula, 2. Grupo chico, 3. Personal. Se eligió **modo aula**.
- El flujo usó la tool `proyecto-fisico` (operaciones `leer` y `aplicar`) y abrió `vista-fisica`.
- Tecnia Bot afirmó: "¡Listo! Ya armé el circuito con el ESP32 DevKit, el LED (con su resistencia de protección en serie) y el pulsador." Informó, aproximadamente, LED → GPIO 18 y Pulsador → GPIO 4.
- Vista física, OBSERVADO:
  - piezas: ESP32, resistencia, LED y pulsador;
  - grupos visuales "Salida" y "Entrada";
  - controles de pin;
  - revisión 2;
  - estados "listo" y "conectado".
- Cables visibles, OBSERVADO:
  - `GPIO18 (D18) → Resistencia (pata B)`
  - `Resistencia (pata A) → LED (ánodo +)`
  - `LED (cátodo -) → GND`
  - `GPIO4 (D4) → Pulsador (señal)`
  - `Pulsador (GND) → GND`

### E2. Consigna 2 → comportamiento ("mientras")
En sustancia, Tecnia Bot:
- identificó el pulsador como Entrada y el LED como Salida;
- conservó los pines (pulsador GPIO 4, LED GPIO 18);
- interpretó la intención temporal/condicional como "mantener el pulsador apretado → LED encendido";
- reconoció que eso es una relación automática de comportamiento;
- explicó que esta versión todavía **no** puede construir esa relación: hoy arma piezas, cables y pines, y no maneja lógica condicional.

### E3. Ausencias observadas durante la prueba
Cada ítem es OBSERVED ABSENT DURING TEST. No es una afirmación universal sobre el producto.
- generación de C++ prematura;
- salto a PlatformIO;
- implementación ficticia del comportamiento;
- afirmación falsa de que el comportamiento estaba construido;
- uso visible de la tool `circuito` (legado) como segunda verdad;
- una segunda representación física contradictoria.

### E4. Razonamiento visible
- Aparecieron repetidamente líneas de proceso en inglés: "Thought: Analyzing the Circuit Request", "Thought: Confirming Aula Mode", "Thought: Analyzing the Blockage", "Thought: Analyzing Component Placement", "Thought: Analyzing the Request".

### E5. Respuesta del modelo a la pregunta de comprensión (D3)
- La respuesta empezó con "Entendí que el circuito muestra una placa ESP32 DevKit…". Describió ESP32, LED, GPIO18, resistencia, pulsador y GPIO4.
- Es evidencia de que **el modelo** describe verbalmente su propia proyección física. **No** es evidencia de comprensión humana.

## F. Intervenciones del facilitador

- D3: la pregunta de comprensión se escribió en el chat de Tecnia Bot en lugar de hacérsela a la persona.
- No se registraron otras intervenciones (minuto y contenido). Ese dato queda `NOT_OBSERVED`.

## G. Clasificación

### G1. Matriz A–J

| ID | Dimensión | Resultado | Base |
|---|---|---|---|
| A | Intención | OBSERVED | §D1, §D2: las dos consignas literales |
| B | Interpretación | OBSERVED | §E1 (componentes), §E2 (relación pulsador/LED) |
| C | Proyecto | OBSERVED | ESP32 + LED + resistencia + pulsador (§E1) |
| D | Vista física / comprensión humana | Vista: OBSERVED · Comprensión humana: **NOT_OBSERVED** | §E1; §D3 / §E5 |
| E | Edición por la persona | NOT_OBSERVED | no se registró ningún cambio de pin hecho por la persona |
| F | Validación / comprensión de errores | NOT_OBSERVED | no se provocó ni registró ningún error |
| G | Comportamiento | PASS (OBSERVED) | reconoció "mientras" como comportamiento y no fingió implementarlo (§E2) |
| H | Fuga de legado (`circuito`) | PASS DURING THIS TEST | §E3 |
| I | Código prematuro | PASS DURING THIS TEST | §E3 |
| J | Confusión humana | NOT_OBSERVED / INCOMPLETE | sin registro textual de confusión ni de su ausencia |

### G2. Checkpoints del protocolo (H1–H19)

| ID | Resultado | Nota |
|---|---|---|
| H1–H8 | NOT_OBSERVED | No hay registro de la conducta de la persona sobre la vista, los pines, la serie, la edición, los errores ni la persistencia |
| H9 | NOT_OBSERVED | No se registró si aparecieron ids internos |
| H10 | PASS DURING THIS TEST | No apareció código sin pedirlo (§E3) |
| H11 | **FRICTION** | Razonamiento visible en inglés ("Thought: …", §E4) |
| H12 | NOT_OBSERVED | Pestañas no registradas |
| H13, H14 | NOT_OBSERVED (persona) | Quien identificó Entrada/Salida fue el **bot**, no la persona (§E2) |
| H15, H16 | NOT_OBSERVED | Sin respuesta textual de la persona |
| H17 | PASS | El bot no inventó comportamiento (§E2) |
| H18 | PASS DURING THIS TEST (generación) | No generó C++. No se registró si lo ofreció |
| H19 | NOT_OBSERVED | — |
| Preguntas finales 1–6 | NOT_OBSERVED | La única que se intentó la respondió el modelo (§D3) |

## H. Hallazgos nuevos

- **HT1-01 (FRICTION / UX):** razonamiento del modelo visible en inglés ("Thought: …"), repetido a lo largo de la sesión. Coincide con la limitación conocida del freeze, "fuga de razonamiento no determinista" (`KNOWN_LIMITATIONS`). Esta vez la frecuencia observada fue alta. No se corrige en esta tarea.
- **HT1-02 (PROCESO):** la comprensión humana de la vista no quedó medida porque la pregunta se envió al bot (D3). Lección para el facilitador: las preguntas de indagación se hacen **fuera** del chat, en voz alta o por escrito, y se anota la respuesta de la persona.

## I. Contradicciones con las simulaciones

- Ninguna contradicción observada.
- La ruta natural intención → `proyecto-fisico` → vista física, que en la prueba simulada previa a Wave 0 no se alcanzaba (F-03), **sí** se recorrió en esta ejecución real. Es consistente con el fix de Wave 0 (W0-ROUTING).
- El razonamiento visible es consistente con la limitación ya registrada (§H).

## J. Impacto sobre `PHASE_3_MINIMUM_VERTICAL_DESIGN.md`

- OBSERVACIÓN: ante "mientras aprieto el pulsador se prenda el LED", el sistema reconoce la relación entrada/salida y su carácter de comportamiento, pero no tiene cómo representarla como comportamiento construido del proyecto (§E2).
- INTERPRETACIÓN: ese hueco es exactamente el primer vertical semántico propuesto (semántica de NIVEL, HD-P3-2 = A). La prueba no aporta evidencia que contradiga el diseño. Tampoco aporta evidencia humana sobre las preguntas de comprensión que el diseño reserva para su prueba posterior (§16).

## K. Recomendación y gate

- **PHASE_3_SEMANTIC_VERTICAL_GATE = OPEN.**
- Fundamento:
  - HD-P3-0 = A exigía ejecutar y registrar una prueba humana real antes de avanzar. Ya se ejecutó (REAL HUMAN TEST #1) y queda registrada acá.
  - La prueba no expuso ningún blocker: el recorrido físico se completó, y el bot no fingió el comportamiento, no generó código prematuro ni abrió una segunda verdad.
  - El hueco que expuso es el vertical propuesto.
  - El protocolo versionado no condiciona Phase 3 a la cobertura completa de H1–H19.
- Deuda humana explícita (para una prueba posterior):
  - `PHYSICAL_VIEW_HUMAN_COMPREHENSION = NOT_OBSERVED`;
  - edición, comprensión de errores y persistencia por la persona: `NOT_OBSERVED`;
  - prueba del docente: no ejecutada.
- Esto **no** declara validada por humanos la UX física. Abrir el gate no autoriza a declarar resueltas esas deudas.

```
REAL_HUMAN_TEST_01 = EXECUTED (cobertura parcial)
PHYSICAL_VIEW_MODEL_EXPLANATION = OBSERVED
PHYSICAL_VIEW_HUMAN_COMPREHENSION = NOT_OBSERVED
PHASE_3_SEMANTIC_VERTICAL_GATE = OPEN
```
