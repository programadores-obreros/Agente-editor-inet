# Phase 3 — Wave 0: alinear el flujo natural del bot con el producto de Phase 2

**Estado: APPROVED_FROM_HUMAN_DECISIONS** (Wave 0 autorizada; HD-P3D-1..10 congeladas).

**Base:** `main` local `9b290a1`. Rama `feature/programacion-intencion-wave0`.

**Insumos:**
- `PHASE_2_SIMULATED_ROLE_TRIAL.md` (F-01..F-15);
- `PHASE_3_MINIMUM_VERTICAL_DESIGN.md`;
- el mapeo de causas raíz (scratchpad `wave0/`), con las citas de abajo.

## Contrato central

**ONE PROJECT · ONE IR · ONE PROJECT ENGINE · ONE PHYSICAL TRUTH.**

Para un proyecto cubierto por el Project Engine (ESP32 + LED + resistencia + pulsador), el único camino es:

```text
intención → proyecto-fisico → Project Engine → IR → vista-fisica
```

- El agente **no** es autoridad.
- El circuito legado **no** puede presentarse como el proyecto del alumno.
- Ninguna superficie mantiene pines alternativos.

## Fuera de alcance (protegido)

- Semántica de `Comportamiento`/`SetComportamiento`, schema incompleto, `QuitarComportamiento`, nivel/evento. Tocarlos = STOP + HUMAN_DECISION_REQUIRED.
- **`opencode/nucleo/**` no cambia** en la Wave 0: todo el vocabulario se deriva del catálogo existente (`catalogo.componentes`, `catalogo.placas`).
- F-14 (estado de reposo) pertenece a Phase 3.
- Blockly, la lógica pulsador→LED y codegen nuevo quedan fuera.
- F-01/F-02 quedan en backlog (HD-P3D-8), salvo que bloqueen el gate.

## Mapa de hallazgos

| F | Causa raíz (evidencia) | Cambio | Test (RED primero) | Criterio de aceptación |
|---|---|---|---|---|
| **F-03** el flujo natural no llega a Phase 2 | `agent/tecnia-bot.md` nunca menciona `proyecto-fisico`/`vista-fisica` (sólo los permisos L24-25). L132-147 manda **siempre** a `circuito` para "visual/esquema/navegador"; la skill `circuitos-visuales` también | **W-W0-ROUTING:** nueva sección "REGLA CRÍTICA — proyecto físico" **antes** de L132. Si el alumno quiere **armar / ver / cambiar** un circuito cuyas piezas están en el catálogo del Project Engine (vocabulario de `proyecto-fisico leer`), el camino es `proyecto-fisico` → `vista-fisica`. **Frontera de `circuito`:** sólo para piezas que el Engine no cubre, láminas o imprimibles pedidos explícitamente, o proyectos integradores de ejemplo; **nunca** como estado del proyecto. Se ajustan L132-147 y la skill `circuitos-visuales` para que remitan a esta regla | estático: el prompt y la skill contienen la regla y la frontera; L134 ya no es incondicional (RED: hoy no existe) | VM: con el pedido natural, el bot usa `proyecto-fisico` y abre `vista-fisica`; 0 llamadas a `circuito` |
| **F-04** el legado simula botón→LED | `circuito.ts` L920-927 + L2758: los componentes `interactivo` (`boton`, `potenciometro`) muestran "✋ interactivo / ¡Probalo con el mouse!" | **W-W0-ROUTING:** (a) el ruteo saca a `circuito` de este flujo; (b) cuando el preset es interactivo, el HTML y la salida de la tool lo **rotulan** como "**Lámina de ejemplo — no es tu proyecto**: muestra cómo podría funcionar"; (c) regla de prompt: nunca presentar una lámina como el proyecto del alumno | estático sobre el HTML generado para `boton-esp32`: aparece "Lámina de ejemplo — no es tu proyecto" (RED). `circuito.test.mjs:1646-1653` sigue pidiendo "Probalo con el mouse": la frase se conserva y se le antepone el rótulo | ninguna lámina interactiva sin el rótulo; en el flujo ESP32+LED+pulsador no se genera ninguna |
| **F-05** vista vacía descrita como armada | `vista-fisica.ts` L178-207 devuelve sólo la URL, sin contenido | **W-W0-TOOL:** `vista-fisica` devuelve un **resumen derivado del snapshot**: "El proyecto está vacío (sin placa ni componentes)" o "Muestra: ESP32 DevKit V1; LED — ánodo (+) en GPIO4; Pulsador — señal en GPIO18; 1 motivo bloqueante". **W-W0-VIEW:** estado vacío visible en la página (W0-8) | la tool sobre un proyecto vacío → contiene "vacío" (RED); sobre un proyecto armado → lista exacta de piezas y pines | el bot no puede describir como armado un proyecto vacío sin contradecir la salida de su propia tool |
| **F-06** afirma acciones no ejecutadas | ninguna regla de prompt; `leer`/`simular` no se distinguen de `aplicar` en la salida | **W-W0-TOOL:** cada salida de `proyecto-fisico` empieza con una línea `resultado` inequívoca. Por ejemplo: "SÓLO LECTURA — no cambió nada"; "SIMULACIÓN — no se aplicó nada"; "APLICADO — revisión 3→4"; "NO SE APLICÓ NADA — motivo: …". **W-W0-ROUTING:** regla "afirmaciones de estado sólo después de una línea APLICADO; con NO SE APLICÓ / LECTURA / SIMULACIÓN decí exactamente eso" | tests de la línea `resultado` para apply ok, rechazo, stale, simular y leer (RED: no existe) | VM: 0 afirmaciones de acciones no ejecutadas (revisión de transcripciones por RED-W0-TRUTH) |
| **F-07** no se descubre el vocabulario | `leer` (`proyecto-fisico.ts:187-198`) no expone placas, componentes, terminales ni payloads. `SetPlaca` exige el id exacto (`operaciones.ts:338-343`). `resolverAliasPlaca` no se usa | **W-W0-TOOL:** `leer` agrega `vocabulario`, **derivado del catálogo real**: `placas [{id, nombre, alias}]`, `componentes [{tipo, nombre, clase, terminales [{id, nombre, asignable}]}]` y `operaciones {tipo: ejemplo de payload}`, con los ids reales. La descripción de la tool dice "llamá `leer` primero: trae el vocabulario". Ante `PLACA_DESCONOCIDA`/`TIPO_CATALOGO_DESCONOCIDO`, la tool agrega "valores válidos: …" (derivado). Sin cambios en el Engine | un cliente "ingenuo" que sólo usa `leer.vocabulario` arma ESP32+LED+resistencia+pulsador con **0** llamadas fallidas (RED: hoy falla); el vocabulario coincide con el catálogo (sin listas hardcodeadas: un test compara contra `catalogo.componentes`/`placas`) | docente simulado en la VM: 0 llamadas fallidas por adivinar ids |
| **F-11** stale falso / foco / valor intermedio | `app.js:111-158`: POST por cada `change`, con `baseRevision` del último snapshot y sin estado pendiente. `repintar()` hace `replaceChildren` → pierde el foco. El tecleo dispara un `change` por carácter | **W-W0-VIEW:** módulo puro `cambios-gpio.js` que **coalesce** los cambios: debounce corto (300 ms); a lo sumo **un** POST en vuelo; si llega otro cambio, sólo se guarda el **último** valor elegido y se envía con la revisión nueva al volver. Además, restaurar el foco del selector (por componente/terminal) después de repintar | unit: una ráfaga D→D1→D19 produce **un** POST con D19; un cambio durante un POST en vuelo se encola sin stale. Navegador real: escribir "D19" → una revisión, sin "otro cambio llegó primero", foco en el mismo selector (RED: hoy se reproduce F-11) | ningún stale artificial; ningún valor intermedio aplicado al escribir |
| **F-13** pines distintos | `tecnia-bot.md` L144: "el circuito es la fuente de verdad de los pines" | **W-W0-ROUTING:** si existe un proyecto físico, **la fuente de verdad es `proyecto-fisico leer`**. Para describir o programar el proyecto, primero `leer`. **W-W0-TOOL:** `leer` agrega la descripción humana de los pines por componente (W0-6) | estático (regla presente, L144 reemplazada) + test de la descripción de pines de `leer` | VM: cambiar el pin por la UI → el bot lo describe con el pin nuevo |
| **F-15** C++ prematuro | `tecnia-bot.md` L366-417 ("creás los dos archivos vos… sin preguntar") y L65-71 | **W-W0-ROUTING:** esa regla aplica **sólo** ante un pedido explícito de código, programa o subir a la placa. Ante un pedido de **comportamiento** sin pedido de código: reconocer la intención, explicar Entrada/Salida, **decir que esa relación todavía no se puede construir en el proyecto físico** y no afirmar que ya funciona. Sin C++, sin `platformio.ini` y sin compilar | estático: la regla está acotada, con el ejemplo "que el LED se prenda cuando aprieto" | VM: ante ese pedido, 0 escrituras de C++/`platformio.ini`, 0 compilaciones y la limitación dicha |
| F-09 ids internos | `pintar.js:132` (`componenteId / terminalId`), `:124` (`desde → hasta` con `1.l`). `ModeloDeVista` no tiene `nombre` | **W-W0-VIEW:** `ComponenteVista.nombre` (`nombreVisible` del catálogo + ordinal si hay duplicados, en el servidor) y `TerminalVista.etiqueta`, de una tabla **de presentación** en `vista-fisica/` (`anodo`→"ánodo (+)", `catodo`→"cátodo (−)", `senal`→"señal", `gnd`→"GND"; un terminal sin etiqueta → su id). Controles: "Pulsador — señal:". Cables: "GPIO18 → Pulsador (señal)". El id queda en `data-*` | unit de la proyección + render (RED); se ajusta `phase2-pintar.test.mjs:112` ("D5 → A"), un test de Phase 2 que cambia por contrato | la vista no muestra `cmp-N`, `senal` ni `1.l` como texto primario |
| W0-8 vista vacía | `plan-de-pintado.js` no tiene instrucción para un proyecto vacío | **W-W0-VIEW:** instrucción `estadoVacio`: "Este proyecto todavía no tiene componentes. Pedile a Tecnia Bot que lo arme." | unit + navegador (RED) | estado vacío explícito |
| varias pestañas | `vista-fisica.ts:203` abre siempre | **W-W0-TOOL:** si el servidor de ese proyecto ya estaba abierto en el proceso, no se abre otra pestaña salvo con `reabrir: true`; la salida lo dice | unit (RED) | una pestaña por proyecto, salvo pedido |

## Writers (en serie, un solo writer mutando)

1. **W-W0-TOOL**: F-07, F-05, F-06 (líneas de resultado), F-13 (pines en `leer`), pestañas. Archivos: `tool/proyecto-fisico.ts`, `tool/vista-fisica.ts`, `vista-fisica/vista-real.ts` y/o un helper nuevo de vocabulario en `vista-fisica/`. Va **primero**, porque ROUTING depende del vocabulario y de las líneas de resultado.
2. **W-W0-ROUTING**: F-03, F-04, F-06/F-13/F-15 (reglas de prompt). Archivos: `agent/tecnia-bot.md`, `skills/circuitos-visuales/SKILL.md`, `tool/circuito.ts` (sólo el rótulo de lámina).
3. **W-W0-VIEW**: F-11, F-09, W0-8. Archivos: `vista-fisica/{modelo-vista.ts, snapshot-a-vista.ts, plan-de-pintado.js, pintar.js, app.js, index.html}` + `vista-fisica/web/cambios-gpio.js` (nuevo).

## Reglas para los writers

- **RED genuino antes de implementar**, como commit separado de tests en rojo (`test(...): RED …`) y con la salida guardada. Está prohibido escribir tests después del código, reconstruir RED revirtiendo o fabricarlo.
- `tests/nucleo-*`, `opencode/nucleo/**` y `opencode/servidor/**` no cambian. Si hace falta, STOP + HUMAN_DECISION_REQUIRED.
- Los tests existentes que cambian por contrato se listan y se justifican en el commit.
- Las reglas de prompt se testean de forma estática. El comportamiento del LLM se valida en el gate de la VM (no es determinista: se registran las transcripciones).

## Gate de integración

1. Suite completa en verde; typecheck 0; fichas 0; guardias OK.
2. Instalación no destructiva en la VM (procedimiento validado).
3. **Alumno simulado desde cero, SIN facilitación**: los 15 puntos del pedido.
4. **Docente abreviado**: se cuentan las llamadas fallidas por vocabulario. Objetivo: 0.
5. Red team RED-W0-TRUTH / RED-W0-AUTHORITY / RED-W0-UX (read-only) → como máximo una ronda de fixes focal → verificación independiente.
6. Freeze, sólo con 0 CRITICAL y 0 MAJOR.

**REAL STUDENT/TEACHER TEST = NOT EXECUTED** (la §26 del brief sigue pendiente).
