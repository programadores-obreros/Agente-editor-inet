# Phase 2 Slice 2: discovery (NO implementativo)

Estado: **DISCOVERY**, no diseño. Todavía no hay decisiones humanas tomadas, así que no existe `PHASE_2_SLICE_2_DESIGN.md`.

Base del análisis: `main` local `f5003b4` = Slice 1 cerrado (producto auditado `06233e3`) + `PHASE_2_SLICE_1_MERGE_REPORT.md`.

Fuentes: cuatro análisis read-only independientes (ARCH-S2-IR, ARCH-S2-PHYSICAL, ARCH-S2-VALIDATION, ARCH-S2-PEDAGOGY). IR, VALIDATION y PHYSICAL verificaron ejecutando el Engine real y Chromium headless sobre una copia `git archive f5003b4`. Los informes completos están en el scratchpad del discovery (`slice2/ARCH-S2-*/INFORME.md`). Los cuatro coinciden en lo sustancial; no hubo desacuerdos que adjudicar.

Hipótesis evaluada (no aprobada): *"Agregar un pulsador físico editable al proyecto y demostrar que entrada y salida pueden coexistir como entidades semánticas persistentes y validadas por el mismo Project Engine."*

---

## A. Capacidad actual (verificada)

- **La IR y el Engine ya representan ESP32 + LED + resistencia + pulsador sin cambiar el schema ni las operaciones.** Se ejecutó en vivo: SetPlaca → AgregarComponente (led, resistencia, pulsador) → AsignarPin → Conectar → cierre → recarga con una raíz nueva. El resultado es idéntico: PERSISTIBLE ⇒ RECARGABLE con una segunda entidad semántica.
- **Catálogo:** `pulsador` existe desde el hardening (`nucleo/catalogo-datos.ts`, clase "entrada").
  - Terminal `senal`: digital, entrada, `requierePullUpInterno: true`.
  - Terminal `gnd`: riel-fijo → GND.
  - Capacidad `estadoBooleano`.
- **Validación (D1–D11), por el Engine real.** Todo es `representable`, persiste y recarga:

  | Asignación del pulsador | Resultado |
  |---|---|
  | GPIO4 | sin motivos |
  | GPIO34/35/36/39 | `PIN_SIN_PULLUP_INTERNO` blocking |
  | GPIO12 | `PIN_STRAPPING` warning |
  | GPIO2 | info |
  | GPIO1 | `PIN_UART_USB` warning |
  | GPIO6 | `PIN_FLASH_RESERVADO` blocking |
  | sin pin | incompleto, 0 motivos |
  | mismo pin que el LED | `PIN_OCUPADO` blocking |

- **GND del pulsador:** implícito (riel fijo), igual que el cátodo del LED. No entra a `Componente.pines` ni pasa por el validador. No existe un estado "pin sin GND", y no hace falta.
- **Vista:** el adapter (`modelo-vista.ts`, `snapshot-a-vista.ts`, `vista-real.ts`) es genérico por catálogo.
  - Con un pulsador proyecta terminales, cables, `gpiosDisponibles` y motivos. El selector de GPIO funciona.
  - El filtro de capacidad (D8) le ofrece GPIO34-39, porque son entradas digitales, y el Engine los diagnostica como blocking (H-4).
- **Wokwi:** el bundle ya define `wokwi-pushbutton` (y `-6mm`, MIT).
  - Verificado renderizando en Chromium: 4 patas `1.l/2.l/1.r/2.r`, con los pares puenteados internamente.
  - El elemento emite `button-press`/`button-release`; `app.js` hoy no los escucha.
- **Operaciones:** las 8 existentes alcanzan.

## B. Capacidad faltante

1. **Render del pulsador:** `vista-fisica/wokwi-render-datos.ts` sólo tiene entradas para `led` en `ELEMENTO_WOKWI_POR_TIPO`, `TERMINAL_WOKWI_POR_TIPO` y `ATRIBUTOS_POR_TIPO`. Hoy el pulsador no se dibuja; sólo aparece su selector y su fila de cable. La resistencia tiene el mismo gap desde Slice 1.
2. **Vía operacional real:** NINGÚN camino de producción ejecuta `AgregarComponente` o `Conectar`.
   - El navegador sólo envía `AsignarPin`.
   - La tool `vista-fisica` sólo abre el navegador.
   - El launcher de demo sólo siembra ESP32 + LED.

   Hoy un pulsador no puede aparecer en un proyecto real.
3. **Entrada/salida no visible:** `Terminal.direccion` y `ComponenteCatalogo.clase` existen en el catálogo, pero la vista nunca los proyecta. El alumno no puede ver "entrada" ni "salida".
4. **Motivos crudos:** la UI muestra `[blocking] REQUISITO_INSATISFECHO (representable)` (`pintar.js`). El brief (§12.1/§32) pide que la UI no exponga códigos internos como experiencia principal.
5. **Layout:** `transform: scale(1.25)` del ESP32 no reserva espacio en el flujo, e `index.html` no tiene CSS para `#circuito`. Un tercer elemento agrava el crowding que ya existía con ESP32 + LED.

## C. Piezas reutilizables (sin cambios)

- Todo `opencode/nucleo/` (IR, Engine, catálogo, validador, almacén, raíz de composición).
- `opencode/servidor/` (HTTP + SSE, candado, canonicalización).
- `modelo-vista.ts`, `snapshot-a-vista.ts` (con la posible excepción de proyectar `direccion`/`clase`, según HD-S2-7), `vista-real.ts`, `plan-de-pintado.js`, `pintar.js`, `estado-conexion.js`.
- La lista textual "CABLES" (genérica).
- El selector de GPIO (`gpiosCandidatosPara`).
- Operaciones: SetPlaca, AgregarComponente, AsignarPin, Conectar (y el resto de las 8).
- Instaladores (D12 ya copia `vista-fisica/` completo).

## D. Cambios requeridos (PROPUESTOS; dependen de las decisiones de la sección G)

| Cambio | Archivo(s) probables | Depende de |
|---|---|---|
| Datos de render del pulsador (tag, pin↔terminal, atributos) | `vista-fisica/wokwi-render-datos.ts` | HD-S2-2, HD-S2-3, HD-S2-4 |
| Vía para que el agente emita operaciones existentes sobre el proyecto activo | `opencode/tool/vista-fisica.ts` (o una tool hermana) + el permiso en `agent/tecnia-bot.md` | HD-S2-1 |
| Fixture de demo ESP32 + LED + pulsador | `scripts/vista-fisica-demo.mjs` | HD-S2-1 |
| Rotular entrada/salida (proyectar `clase`/`direccion`) | `modelo-vista.ts`, `snapshot-a-vista.ts`, `plan-de-pintado.js`, `pintar.js` | HD-S2-7 |
| Textos pedagógicos de motivos (tabla de presentación) | `vista-fisica/` (datos) + `plan-de-pintado.js` | HD-S2-8 |
| CSS de layout | `vista-fisica/web/index.html` | HD-S2-5 |
| Tests de vista con pulsador (hoy la vista nunca se testeó con pulsador) | `tests/phase2-*` nuevos | — |

**No deberían cambiar:**
- `opencode/nucleo/**` (nada del núcleo es necesario; si la implementación lo toca, es una señal de alarma);
- `opencode/servidor/**`;
- `opencode/tool/circuito.ts`, `platformio.ts`, `pinouts.json`;
- `tests/nucleo-*`;
- los instaladores;
- `package.json` y el lock.

## E. Non-goals explícitos

- Blockly, workspace lógico, sync Blockly ↔ IR, codegen, C++, PlatformIO, flash.
- **Cualquier relación lógica pulsador → LED**, incluida la simulación con `button-press`/`button-release` en el navegador (sería simulación lógica).
- Crear o ejecutar `ComportamientoRegla` (territorio de Phase 3; ver HD-S2-10).
- Paleta "agregar componente" o drag & drop en el navegador.
- Cable geométrico (ver HD-S2-6), tabla de tamaños físicos por placa y variante `pushbutton-6mm`.
- Operaciones nuevas del Engine, cambios de schema, severidades nuevas, reglas nuevas del validador.
- Plataforma pedagógica general, tutoriales guiados, gamificación, scoring automático.
- Componentes nuevos de catálogo (por ejemplo `pulsador-pulldown`; ver HD-S2-9).

## F. Riesgos

- **Nombre real de las patas de `wokwi-pushbutton`:** ya se verificó en Chromium (1.l/2.l/1.r/2.r). El riesgo que queda es elegir el par (HD-S2-3), que es cosmético.
- **Superficie nueva si la tool acepta operaciones del agente (HD-S2-1):** es la primera API agente → Engine para mutar la topología. Tiene que ser whitelist de operaciones existentes, con actor `agente`, por el mismo Engine y sin nada nuevo. Es un vector de revisión de seguridad para el red team del slice.
- **Motivos crudos:** si no se traducen (HD-S2-8), el test con estudiante probablemente muestre que el alumno no entiende el error. Es un dato legítimo, pero previsible.
- **Layout:** sin CSS mínimo, el tercer componente se superpone. Es un problema visual, no semántico.
- **Tentación de usar los eventos del botón:** violaría el non-goal de simulación lógica. Tiene que quedar prohibido en el diseño y con un test que lo guarde.

## G. HUMAN_DECISION_REQUIRED

Cada decisión trae la evidencia en los informes de `slice2/ARCH-S2-*`. La recomendación es técnica; la decisión es del HUMAN PRODUCT OWNER.

| ID | Decisión | Opciones | Recomendación técnica |
|---|---|---|---|
| HD-S2-0 | ¿El scope es ESP32 + LED + pulsador? | A) sí; B) LED onboard GPIO2 (ruido de strapping); C) sólo pulsador (pierde el contraste entrada/salida) | A: es el contraste entrada/salida mínimo y el patrón del proyecto INET nº06 |
| HD-S2-1 | Cómo entra el pulsador al proyecto | a) la tool (ampliada o hermana) permite al AGENTE emitir operaciones EXISTENTES (whitelist: AgregarComponente/AsignarPin/Conectar/…); b) sólo el seed del demo-launcher (sirve para desarrollo, no para el flujo real); c) agente directo sin tool (no existe un camino hoy) | a) + b): a) es lo único consistente con "el agente produce operaciones hacia el Engine" para el flujo real; b) para la demo y los tests. Superficie nueva → red team |
| HD-S2-2 | ¿Dibujar el pulsador Wokwi o dejar una fila de texto? | dibujar / texto | dibujar: es sólo datos y ya está verificado en el bundle |
| HD-S2-3 | Qué patas mapear a senal/gnd | 1.l/2.l (lado izquierdo) / 1.r/2.r | 1.l = senal, 2.l = gnd (cosmético; los pares están puenteados) |
| HD-S2-4 | Elemento | `wokwi-pushbutton` / `-6mm` | `wokwi-pushbutton` |
| HD-S2-5 | Layout | A) no tocar; B) CSS cosmético (flex-wrap/gap) sin datos nuevos; C) tabla de tamaños por placa | B |
| HD-S2-6 | Cable geométrico | descartar / incluir | descartar: la lista "CABLES" alcanza y ya se había descartado en Slice 1 (`modelo-vista.ts`) |
| HD-S2-7 | Rotular entrada/salida | A) etiqueta textual derivada de `clase`/`direccion` del catálogo; B) no rotular; C) ícono/color/agrupación | A: sin esto no hay evidencia visual del objetivo pedagógico |
| HD-S2-8 | Traducir motivos | A) tabla de presentación código → texto llano (sólo los motivos del slice), sin lógica y sin autoridad; B) dejar crudo (el agente/LLM explica después); C) sólo resaltar la entidad afectada | A + C, acotados; es una decisión de producto |
| HD-S2-9 | Pull-up interno vs pull-down externo | A) mantener INPUT_PULLUP interno (el legado, catálogo actual); B) agregar `pulsador-pulldown` (ejercita `resistencia-pull`, hoy sin implementar) | A; B es scope creep para este slice |
| HD-S2-10 | ¿Modelar (sin ejecutar) una `ComportamientoRegla` pulsador → LED? | no / sí, sólo representable | no: es territorio de Phase 3 |

Ninguna decisión exige reabrir D1–D17, E3-04b ni H4. No hay condición de STOP.

## H. Test de aceptación propuesto (técnico)

1. Proyecto con ESP32 + LED + pulsador, creado por la vía de HD-S2-1 (en los tests: el Engine directo y la tool).
2. La vista muestra las 3 piezas (con HD-S2-2), sin superposición (con HD-S2-5) y con el rol entrada/salida (con HD-S2-7).
3. `<select>` del pulsador a otro GPIO → `AsignarPin` → revisión +1 → persiste → la otra pestaña se actualiza por SSE.
4. Recarga de la página y reinicio del proceso → el mismo estado.
5. Pulsador en GPIO34 → `PIN_SIN_PULLUP_INTERNO` blocking visible (texto según HD-S2-8), el proyecto sigue editable, y reasignar lo limpia.
6. Pulsador en el mismo pin que el LED → `PIN_OCUPADO` blocking (Path A).
7. Operación inválida o stale → la vista no cambia (Path B).
8. Guarda de non-goal: `web/*.js` no escucha `button-press`/`button-release` ni muta nada por click en el pulsador.
9. Guarda de alcance: `git diff` sin `nucleo/`, `servidor/` ni `tests/nucleo-*`.
10. Si se aprueba HD-S2-1(a): la tool sólo acepta operaciones de la whitelist, con actor `agente`, por el mismo Engine; todo lo que no esté en la whitelist se rechaza con un motivo estructurado.
11. Suite completa en verde, typecheck y fichas; navegador real (Chromium) + consola limpia + offline; packaging instalado (el gate de Slice 1 se repite).

## I. Test con estudiante propuesto (sin ejecutar)

- **Perfil:** 1 estudiante de escuela técnica, nivel inicial, sin datos personales. Se aclara antes que se evalúa la herramienta, no a la persona.
- **Tareas:**
  1. "Abrí el proyecto; contame qué ves."
  2. "¿Cuál de estos componentes RECIBE información y cuál la PRODUCE?" (sin dar la respuesta).
  3. "Cambiale el pin al pulsador."
  4. "Antes de recargar, ¿qué esperás encontrar?" Después se recarga y se compara.
  5. Provocar el blocking (por ejemplo, el pulsador en GPIO34): "¿Qué pasó? ¿Podés seguir usando el proyecto? Corregilo."
  6. "¿Qué le agregarías después?" (sin pistas: se registra si surge sola la condición "cuando lo apriete, que prenda el LED").
- **Qué observar (cualitativo, sin score):**
  - si reconoce entrada/salida (sí / con pista / no);
  - si predice el resultado de la recarga;
  - si interpreta el error sin ayuda y usa la explicación para corregir;
  - si explica con sus palabras;
  - si verbaliza espontáneamente una relación condicional.
- **Entregable:** tarea, perfil, observaciones, errores de comprensión, intervenciones y cambios de diseño derivados (brief §26).

---

## Plan de implementación PROPUESTO (sólo si se aprueban las decisiones)

1. DESIGN freeze (`PHASE_2_SLICE_2_DESIGN.md`) con las decisiones tomadas.
2. W-RENDER: datos del pulsador + CSS de layout + tests de vista con pulsador.
3. W-ROL/W-MOTIVOS (según HD-S2-7/8): proyección de `clase`/`direccion` y la tabla de textos.
4. W-OPERACIONES (según HD-S2-1): la vía agente → Engine con whitelist, más el seed de la demo.
5. Gate: el test de aceptación H, navegador real, packaging instalado, red team focal (con foco en la superficie de HD-S2-1), freeze.

Las estimaciones y el orden fino se fijan en el DESIGN, no acá.

---

## Decisiones humanas tomadas (2026-09-30)

El HUMAN PRODUCT OWNER resolvió las HD-S2 (son normativas para el DESIGN):

| ID | Decisión |
|---|---|
| HD-S2-0 | A: ESP32 + LED + pulsador |
| HD-S2-1 | a + b: tool controlada con whitelist explícita de operaciones EXISTENTES para el agente, más el sembrado determinista de la demo. No es una nueva autoridad: el Project Engine sigue siendo la única, y el agente nunca escribe la IR |
| HD-S2-2 | Dibujar el pulsador con Wokwi Elements |
| HD-S2-3 | `1.l` = señal, `2.l` = GND, sólo en la proyección física; sin verdad eléctrica paralela |
| HD-S2-4 | `wokwi-pushbutton` estándar |
| HD-S2-5 | B: CSS mínimo; sin motor de layout |
| HD-S2-6 | Descartar el cable geométrico |
| HD-S2-7 | A: Entrada/Salida derivadas de la autoridad catalogal; el browser no mantiene tablas propias |
| HD-S2-8 | A + C acotado: texto determinista para los reason codes del recorrido, más resaltar la entidad afectada. Sin LLM. Un código desconocido se muestra tal cual |
| HD-S2-9 | A: INPUT_PULLUP interno |
| HD-S2-10 | NO: ninguna regla pulsador → LED |

**Contrato de scope:** el slice demuestra "coexistencia física y semántica de una entrada y una salida dentro del mismo proyecto, editables, persistentes y validadas por el mismo Project Engine". NO demuestra "cuando aprieto el botón, prender el LED".

**Capas protegidas:** `nucleo/**`, `servidor/**`, `circuito.ts`, `tests/nucleo-*`, los instaladores y `package.json`. Cualquier necesidad de tocarlas es HUMAN_DECISION_REQUIRED. También lo es cualquier cambio de schema, semántica nueva del Engine, cambio en la validación central, operación nueva, segunda autoridad de componentes/pines o comportamiento pulsador → LED.

Diseño: `PHASE_2_SLICE_2_DESIGN.md`.
