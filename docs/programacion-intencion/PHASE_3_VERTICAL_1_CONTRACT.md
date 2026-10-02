# Phase 3 — Vertical semántico #1: contrato de implementación

**Estado: APPROVED_FROM_HUMAN_DECISIONS.** Autoriza la implementación del vertical #1.

**Base:**
- rama `feature/programacion-intencion-phase3-vertical1`, desde `0db4426` (REAL HUMAN TEST #1);
- decisiones en `DECISIONS.md` § "Phase 3 — Vertical semántico #1".

**Diseño de referencia:** `PHASE_3_MINIMUM_VERTICAL_DESIGN.md` (§1–§21). Este documento **no lo reemplaza**:
- registra qué partes del diseño quedaron sustituidas por decisiones humanas posteriores (§A);
- cierra los puntos que el diseño dejaba abiertos (§B), siempre con las decisiones ya registradas, sin decisiones nuevas de producto.

Requisito humano de origen (`PHASE_3_REAL_HUMAN_TEST_REPORT.md` §E2):

> "Ahora quiero que mientras aprieto el pulsador se prenda el LED."

El sistema lo comprendía, pero no podía materializarlo en el proyecto.

## A. Partes del diseño sustituidas (errata normativa)

| Diseño | Dice | Ahora | Fuente |
|---|---|---|---|
| §0 HD-P3-7 = A; §18 non-goal "`SetComportamiento` en `proyecto-fisico`"; §19 "EXPECTED NOT TO CHANGE: `opencode/tool/proyecto-fisico.ts`" | el agente no emite reglas | la tool acepta **`SetComportamiento` y `QuitarComportamiento`**, con whitelist cerrada de 8 tipos (`CambiarComponente` sigue afuera) | `DECISIONS.md`, reapertura acotada (HD-S2-10 → HD-P3-7 → HD-P3D-10) |
| §23 HD-P3D-10 = A | `QuitarComportamiento` excluido del agente | incluido | ídem |
| §19 "EXPECTED NOT TO CHANGE" (implícito para `agent/tecnia-bot.md`) | — | cambio funcional acotado del prompt (HD-05) | `DECISIONS.md` HD-05 + reapertura |

Tests existentes que fijan las decisiones sustituidas. Se actualizan **sólo** en lo que la sustitución exige, y el commit lo declara:

- `tests/phase2-s2-tool-agente.test.mjs` T-AG-02 / T-AG-02b (`SetComportamiento` fuera de la whitelist; HD-S2-10).
  - Siguen exigiendo el rechazo de `CambiarComponente`, de los tipos desconocidos y de las mayúsculas mal escritas.
- `tests/phase2-s2-sin-logica.test.mjs` (prohíbe el literal `SetComportamiento` en `web/*.js`; non-goal del Slice 2 = HD-S2-10).
  - `button-press` / `button-release` siguen prohibidos.
- `tests/wave0-routing.test.mjs` F-15 / FX-2 (exigen "todavía no se puede construir" la relación pulsador→LED).
  - Se mantienen las anclas y la regla central de F-15: no hay C++ ni PlatformIO sin un pedido EXPLÍCITO de código.
  - Lo que cambia es qué **sí** se puede construir: la regla de nivel.

`tests/nucleo-*` (Phase 1) **no se tocan** (HD-P3D-6).

## B. Puntos abiertos del diseño, cerrados

### B1. `schemaVersion` (HD-P3D-3 = B: "sólo si el contrato realmente lo exige")
- **No se sube.** `SCHEMA_VERSION_SOPORTADA` sigue en `"1.0.0"` y `crearProyecto` no cambia.
- Razón: la forma nueva es un **superconjunto aditivo**, y no hay ningún caso en que un producto anterior malinterprete en silencio un documento nuevo.
  - Un producto anterior que lea una regla incompleta la **rechaza** al cargar (`CAMPO_REQUERIDO_FALTANTE`): falla cerrado, no la reinterpreta.
  - Subir la versión según los datos haría depender el sello del contenido: el Engine reescribiría `schemaVersion` al completar o quitar reglas. Eso agrega una mutación implícita que el contrato no necesita.
- La condición de HD-P3D-3 = B ("sólo si realmente lo exige") **no se cumple**, y esa conclusión queda registrada (IR-SPEC §4).

### B2. Forma de una regla parcial (diseño §3)
- `cuando?` y `entonces?` son opcionales. Una clave **ausente** = slot vacío. `null` explícito → rechazo estructural.
- **Un sub-objeto presente y vacío (`cuando: {}` o `entonces: {}`) se rechaza.** Así cada estado tiene una sola forma canónica: el slot vacío es la clave ausente.
- Triada atómica: `capacidad`, `comparador` y `umbral` van juntos o no va ninguno.
- La regla tiene al menos UN slot presente (`{}` se sigue rechazando; `tests/nucleo-operaciones.test.mjs:777-778`).
- Claves desconocidas → rechazo, igual que hoy.
- **Una sola función de validez** para `validarFormaPayload` y el cargador (PERSISTIBLE ⇒ RECARGABLE). Todo sitio que desreferencia `.cuando` / `.entonces` tolera los slots ausentes:
  - `operaciones.ts` (forma, `aplicarSetComportamiento`, `REMOCION_CON_DEPENDIENTES`, `CambiarComponente`);
  - `catalogo.ts` (`reemplazarSensor`);
  - `cargador.ts` (forma y el loop referencial);
  - `validar-estructural.ts` y `validar-tecnico.ts`.
- Si llega un `SetComportamiento` con un `id` provisto que no existe, se crea una regla nueva con un id **del Engine** (`beh-N`). Es el comportamiento actual; un test lo fija.

### B3. Validación semántica (diseño §5), en `validar.ts::validarSemantico` (hoy un passthrough)
- **`COMPORTAMIENTO_INCOMPLETO`**:
  - semántico, blocking, representable;
  - `entidad {tipo:"comportamiento", id}`;
  - `datos { faltan: ("sensor"|"estado"|"actuador"|"salida")[] }`, en ese orden.
- **`ACTUADOR_INVALIDO`**:
  - `entonces.actuador` presente cuyo `ComponenteCatalogo.clase !== "actuador"`;
  - blocking, representable;
  - `datos { componente, clase }`.
  - Sin nombres de tipo. Si el tipo no está en el catálogo, no se emite: ya existe `CATALOGO_COMPONENTE_DESCONOCIDO`.
  - **Bug conocido:** hoy un pulsador se acepta como actuador. Se reproduce con RED antes de corregirlo.
- **`SENSOR_INVALIDO`**:
  - `cuando.sensor` presente **sin** triada, cuyo catálogo no declara **ninguna** capacidad legible por reglas (`capacidades` vacío, por ejemplo un LED usado como sensor);
  - blocking, representable;
  - `datos { componente }`.
  - Con triada presente, la capacidad exacta ya la valida el Engine: `CAPACIDAD_NO_DECLARADA` es un rechazo de Path B fijado por Phase 1 y no se duplica.
- Path A: estos tres motivos **hacen commit** (sin `clasificacion: "rechazo"`) y dejan `listo:false`.
- Path B: forma inválida (`null`, triada suelta, sub-objeto vacío, clave desconocida, referencia inexistente, tipo desconocido) → rechazo sin mutar.

### B4. `QuitarComportamiento` (diseño §10)
- `payload { comportamiento: id }`.
- Si no existe → rechazo `REFERENCIA_INEXISTENTE` con `datos { comportamiento }`.
- Si existe:
  - se quita;
  - info `COMPORTAMIENTO_QUITADO` con `datos { comportamiento, reglaQuitada }` (la regla completa, para un undo futuro);
  - revisión +1;
  - después `QuitarComponente` vuelve a estar permitido.
- Se suma a **todos** los enumeradores de tipos: la unión `TipoOperacion`, `TIPOS_OPERACION_VALIDOS`, `validarFormaPayload`, el dispatch y los ejemplos de `vocabulario.ts`. `motor.ts` no despacha por tipo y no cambia.

### B5. Quitar un componente referenciado (HD-P3D-4 = A)
- Sin cambios de comportamiento: `REMOCION_CON_DEPENDIENTES` (rechazo).
- La comprobación tolera los slots ausentes.
- El texto llano es nuevo: "Este componente lo usa una regla. Quitá o cambiá la regla primero."

### B6. Proyección (diseño §7–§9), del lado del servidor
- `ModeloDeVista.reglas[]` y `opcionesRegla` en `snapshot-a-vista.ts`, como define el diseño §7:
  - etiquetas desde `nombreVisible`, con el ordinal ya existente;
  - "presionado" ⇔ exactamente `estadoBooleano >= 1` (`unidad:"ninguna"`, `magnitud:"estadoBooleano"`);
  - cualquier otra condición → "condición avanzada";
  - "encendido" ⇔ `accion:"encender"`; `apagar` se proyecta "apagado", pero no se ofrece (HD-P3D-2).
- `frase` en texto llano y determinista, sin LLM:
  - "Mientras el Pulsador esté presionado, el LED está encendido."
  - **Sin "si no"** (HD-P3D-9).
- `traza`, sólo para una regla completa:
  - las dos ramas;
  - el reposo apagado (HD-P3D-1) en la segunda;
  - etiqueta fija "Explicación de la regla — no es una simulación ni lo que pasa en la placa.";
  - el caso degenerado `apagar` lo declara.
- Plantillas nuevas en `explicaciones-motivos.ts`: `COMPORTAMIENTO_INCOMPLETO` (interpola `faltan` en lenguaje humano), `ACTUADOR_INVALIDO`, `SENSOR_INVALIDO` y el texto nuevo de `REMOCION_CON_DEPENDIENTES`. Nunca `estadoBooleano`, `>=`, `cmp-…` ni `beh-…` como texto.

### B7. Dos productores, una verdad
- **Agente (`proyecto-fisico`):**
  - whitelist de 8 tipos;
  - `leer` expone `reglas` (la MISMA proyección del servidor: `id`, `frase`, `completa`, `faltan`) para poder editar o quitar por id;
  - `vocabulario.operaciones` trae ejemplos de `SetComportamiento` (la forma exacta de "presionado → encendido") y de `QuitarComportamiento`, con marcadores `<id…>`;
  - mismas garantías de hoy: `baseRevision` nunca autocompletada, `simular` = dry-run, lote atómico, actor `agente`.
- **Navegador:**
  - whitelist del servidor: `AsignarPin`, `SetComportamiento`, `QuitarComportamiento`;
  - cualquier otro tipo → HTTP 200, `resultado {ok:false, rechazadoPor:"transporte", motivos:[{codigo:"OPERACION_NO_PERMITIDA_EN_NAVEGADOR", …}]}` y `snapshot`, sin invocar al Engine;
  - se aplica **después** de validar Origin, Content-Type y JSON;
  - un cuerpo que no es un objeto sigue yendo al Engine (`tests/phase2-transporte-http.test.mjs:273`).
- **Frase editable** (diseño §7):
  - un cambio de selector = **un** `SetComportamiento` con la regla entera y la `baseRevision` del último snapshot;
  - mientras hay una operación pendiente, los selectores de la frase quedan deshabilitados;
  - "Agregar regla" no crea nada hasta el primer selector; "Quitar regla" → `QuitarComportamiento`;
  - el trazado se muestra a pedido;
  - el navegador no tiene tablas de clase, capacidad ni estado: pinta lo que recibe.
- **Prompt del agente** (HD-05, acotado):
  - ante un pedido de comportamiento de nivel ("mientras…") con las piezas presentes, el agente llama `leer` y emite `SetComportamiento` con la forma del vocabulario;
  - afirma sólo después de APLICADO;
  - un pedido de evento, latch o toggle ("cuando lo aprieto una vez", "que quede prendido") **no** se convierte en una regla de nivel: se explica el límite;
  - sin C++ ni PlatformIO sin un pedido EXPLÍCITO de código (F-15 sigue vigente).

## C. Fuera de alcance
- Blockly, C++/codegen, PlatformIO, carga al hardware, Modo Vivo.
- Semántica de EVENTO, latch o toggle.
- Varias reglas con análisis de conflictos (HD-P3-9 diferido).
- Catálogo general de acciones (HD-P3-6).
- Motor de reglas genérico, runtime, simulador.
- `CambiarComponente` en la tool.
- Corrida en Windows/VM y red team adversarial completo: no forman parte de este gate (ver el reporte final).

## D. Evidencia exigida
- RED genuino en un commit separado antes de cada GREEN. El orquestador lo reproduce en el árbol exacto del commit RED.
- Test de aceptación del caso humano, sin LLM: el payload que el agente emite para "mientras aprieto el pulsador se prenda el LED" →
  - tool `proyecto-fisico` (aplicar) → Engine → IR (sensor = pulsador, `estadoBooleano >= 1`, actuador = LED, `encender`) →
  - persistencia → recarga idéntica →
  - proyección "Mientras el Pulsador esté presionado, el LED está encendido." más la traza con el reposo apagado →
  - `QuitarComportamiento` → regla ausente tras la recarga, el resto del proyecto intacto.
- Regresión: los 1308 tests anteriores (el número puede subir, nunca bajar en silencio), typecheck, fichas, seguridad y skills.
