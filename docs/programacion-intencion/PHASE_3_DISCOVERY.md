# Phase 3: discovery (pulsador → LED)

**Estado: DISCOVERY — NO IMPLEMENTATION AUTHORIZED.** No existe DESIGN. Las decisiones de la sección K son del HUMAN PRODUCT OWNER.

Base del análisis: `main` local `f506029` = Phase 1 + Phase 2 Slice 1 + Slice 2 cerrados (producto auditado `cc6794c`).

Fuentes: cuatro análisis read-only independientes, cada uno con su informe en el scratchpad `phase3/ARCH-P3-*/INFORME.md`. IR, ENGINE y PEDAGOGY ejecutaron el Engine real sobre una copia `git archive f506029`.
- ARCH-P3-IR: modelo semántico;
- ARCH-P3-BLOCKLY: proyección;
- ARCH-P3-ENGINE: operaciones;
- ARCH-P3-PEDAGOGY: el alumno.

Autoridad: `BRIEF.md` (el brief maestro v5 FINAL, verificado por hash), TARGET-ARCHITECTURE, IR-SPEC, OPERATIONS y DECISIONS.

Pregunta: ¿cómo pasamos de "Entrada física + Salida física" a "cuando aprieto el pulsador → prender el LED", sin convertir Blockly en C++ pintado de colores (riesgo R3 del brief)?

---

## ⚠ Precondición del brief: prueba pedagógica de fin de Fase 2

El brief (§26, líneas 1634-1638) exige registrar el resultado de una primera prueba con estudiantes o docentes reales al cerrar Fase 2, y establece que **"Fase 3 no debe comenzar como continuación automática sin registrar el resultado"**.

Esa prueba **no se ejecutó**. El protocolo está listo en `PHASE_2_SLICE_2_PROTOCOLO_ESTUDIANTE.md`, pero no hay ningún reporte de resultados en el repo. Ver HD-P3-0.

---

## A. Qué ya existe (verificado ejecutando el Engine real)

- **IR:** `ComportamientoRegla { cuando: {sensor, capacidad, comparador, umbral}, entonces: {actuador, accion} }` (`ir.ts:63-83`).
  - Es un modelo **declarativo de NIVEL** (condición sobre un umbral), explícitamente "sin eventos" (`ir.ts:7-10`).
  - No hay `loop()`, `delay()` ni `millis()`: el modelo ya evita el runtime como concepto.
- **Operación `SetComportamiento`** (`operaciones.ts:445-516`): crea o edita por id (upsert, `COMPORTAMIENTO_REEMPLAZADO`). Se verificó en 9 pasos por el Engine real: crear, dry-run, commit, stale, reemplazo, lote atómico y recarga.
- **"Pulsador presionado → encender LED" es representable HOY**, con `capacidad: estadoBooleano`, `comparador: ">="`, `umbral: {valor: 1, unidad: "ninguna", magnitud: "estadoBooleano"}`. Hace commit, persiste y recarga idéntico (PERSISTIBLE ⇒ RECARGABLE).
- **Catálogo:** el pulsador declara `estadoBooleano`, con el comentario literal "para que un ComportamientoRegla pueda leer presionado/no presionado". `accion` es un enum global `"encender" | "apagar"`.
- **Dependencias:**
  - `QuitarComponente` sobre un componente referenciado por una regla → `REMOCION_CON_DEPENDIENTES` (sensor y actuador).
  - `CambiarComponente` reescribe los comportamientos (`reemplazarSensor`).
- **Incompletitud:** una regla sin acción o sin sensor se rechaza en la forma del payload, tanto en la operación como en el loader. Nunca se persiste nada roto.
- **Infraestructura de Phase 2 reutilizable:**
  - proyección del lado del servidor (rol, explicaciones);
  - tool `proyecto-fisico` (transporte con whitelist);
  - SSE, candado, transacciones y motivos estructurados.

## B. Qué falta

1. **No existe `QuitarComportamiento`.** Una regla no se puede eliminar; ninguna de las 8 operaciones borra una regla aislada.
2. **Nadie proyecta los comportamientos.** Ni el navegador ni `leer` de la tool los muestran: la regla persiste, pero el alumno no la ve.
3. **"Presionado" es un hack numérico.** No hay comparador de igualdad (`"=="` → `VALOR_ENUM_DESCONOCIDO`). Mostrar `estadoBooleano >= 1` sería exactamente el "C++ pintado" que prohíbe R3.
4. **Evento vs. nivel.** "Cuando se presiona" (flanco) y "mientras está presionado" (nivel) colapsan en la misma sintaxis. El modelo sólo da nivel. Un latch ("se queda prendido") exige schema nuevo.
5. **Gap de validación (preexistente):** `entonces.actuador` **nunca se valida contra `clase: "actuador"`**. Se verificó que el Engine acepta el propio pulsador como actuador de "encender", sin ningún motivo.
6. **Conflicto entre reglas:** dos reglas contradictorias sobre el mismo actuador (≥1 → encender; <1 → apagar) se aceptan sin chequeo. Está diferido por decisión (IR-SPEC §3.1).
7. **La tool excluye `SetComportamiento`** (whitelist R-6, decisión HD-S2-10).
8. **Asimetría:** `POST /api/operaciones` **no tiene whitelist de tipo**. Sólo `app.js` se autolimita a `AsignarPin`, mientras que la tool sí tiene whitelist. Un cliente same-origin podría emitir cualquiera de las 8 operaciones (todas pasan por el Engine, así que no es una segunda autoridad; es una asimetría de superficie).
9. **Blockly no está en el repo:** sin dependencia, sin `node_modules` y sin licencia evaluada.

## C. Qué se reutiliza

- La IR, `SetComportamiento`, validación, transacciones, stale, dry-run, persistencia y recarga: todo el núcleo de reglas.
- El patrón de Slice 2 de proyección del lado del servidor (texto determinista derivado de la IR y el catálogo; el browser no tiene tablas propias).
- La tool `proyecto-fisico` (si se decide habilitar `SetComportamiento`).
- El protocolo de estudiante de Slice 2 como molde.

## D. Mínimo vertical recomendado (sujeto a K)

**"La regla visible y editable como frase", antes de Blockly.** Esto coincide con el brief: §26 prescribe una proyección textual de intención en Fase 2, y el adaptador Blockly ↔ IR es una decisión abierta (§37).

1. **Proyección de solo lectura** de cada comportamiento como frase en español, del lado del servidor, con semántica **honesta de nivel**. Por ejemplo: "Mientras el **Pulsador** esté presionado → **encender** el **LED**". La proyección traduce `(estadoBooleano, >=, 1)` a "está presionado" sin exponer el hack.
2. **Edición por frase estructurada:** desplegables derivados del catálogo y de las entidades existentes (sensores con capacidad booleana; actuadores por clase), nunca texto libre. Emite `SetComportamiento` por el Engine: desde el navegador y/o la tool del agente.
3. **Eliminar la regla** → requiere `QuitarComportamiento` (HD-P3-3).
4. **Error representable:** la regla referencia un componente que se quiere quitar → `REMOCION_CON_DEPENDIENTES`, con explicación determinista. Si se aprueba HD-P3-5, también "actuador inválido".
5. **Sin simulación,** o como máximo un **trazado lógico hipotético** textual (brief §14; HD-P3-8).
6. **Blockly:** sólo después de validar la frase con estudiantes.

## E. Cambios potenciales al IR (cada uno es HD)

- Un comparador o forma booleana explícita ("es verdadero", o `==` para booleanos) en lugar de `>= 1` (HD-P3-4).
- Distinguir evento (flanco) de nivel, o latch (HD-P3-2). **Recomendado: NO en el mínimo.**
- `acciones` declaradas por actuador en el catálogo, por simetría con `capacidades` (HD-P3-6).

## F. Cambios potenciales al Engine (cada uno es HD; hoy es capa protegida)

- Nueva operación `QuitarComportamiento`, simétrica a `Desconectar` (HD-P3-3).
- Validación de la clase del actuador en `validar-tecnico` (nuevo motivo, por ejemplo `ACTUADOR_INVALIDO`, blocking y representable) (HD-P3-5).
- Whitelist de tipos espejo en `servidor/` para el POST del navegador (HD-P3-7).
- Conflicto o prioridad entre reglas: **diferido** (HD-P3-9).

## G. Proyección Blockly mínima (para después de la frase)

- Dos bloques semánticos: `cuando [Pulsador ▾] está presionado` y `encender [LED ▾]`.
- Mapeo 1:1 a `cuando`/`entonces`.
- Los desplegables se pueblan desde las entidades y el catálogo. Sin bloques de runtime (loop, delay, digitalWrite, if-else sobre pines).
- El workspace nunca es fuente de verdad: la edición emite operaciones y la IR se reproyecta.
- Hace falta un round-trip test (IR → bloques → operaciones → IR idéntica).
- Pendiente: la dependencia (tamaño, offline, licencia) y la desambiguación de instancias del mismo tipo (hoy sólo existen `nombreVisible` de catálogo e ids posicionales).

## H. Persistencia de lógica incompleta

- Hoy una regla incompleta **no es persistible**: se rechaza en la forma. PERSISTIBLE ⇒ RECARGABLE se cumple trivialmente.
- Opciones (HD-P3-1):
  - **A)** el borrador vive sólo en la UI (la frase se envía cuando está completa), sin tocar la IR;
  - **B)** regla incompleta representable en la IR (cambio de schema; "incompleto" como motivo blocking);
  - **C)** borrador en un canal lateral (riesgo de segunda fuente de verdad).
- Recomendado: **A** para el mínimo.

## I. Riesgos arquitectónicos

- Que Blockly se vuelva una segunda autoridad (un workspace divergente sin round-trip).
- Mostrar el hack `>= 1` (R3).
- Habilitar `SetComportamiento` en la tool adelanta la Fase 4 (intención en lenguaje natural → operaciones) sin sus invariantes.
- Tocar `nucleo/`/`servidor/`: salen de "capa protegida" y requieren un gate propio.
- Asimetría del POST (B-8).
- Reglas contradictorias sin detección.

## J. Riesgos pedagógicos

- "Presionado" leído como **evento** ("se queda prendido") cuando el sistema modela **nivel**. La frase tiene que decir "mientras".
- Enseñar runtime accidentalmente: las fichas actuales del repo enseñan `digitalRead == LOW` dentro de `loop()`. La frase y los bloques no pueden reproducir ese modelo.
- Sin ejecución, el alumno no puede "apretar y ver". La comprensión se valida con predicción y explicación (o con el trazado hipotético de §14).
- Exponer el rebote (debounce) como concepto.

## K. HUMAN_DECISION_REQUIRED

| ID | Decisión | Opciones | Recomendación técnica |
|---|---|---|---|
| **HD-P3-0** | Precondición §26: prueba con estudiantes/docentes de fin de Fase 2 | A) ejecutarla y registrarla ANTES de diseñar Phase 3; B) diseñar en paralelo y no implementar hasta tener el resultado; C) avanzar sin ella (contradice el brief) | **A** (o B) |
| HD-P3-1 | Lógica incompleta | A) borrador sólo en UI; B) IR incompleta representable; C) canal lateral | **A** |
| HD-P3-2 | Semántica del primer caso | A) nivel ("mientras está presionado → encender"), gratis con el modelo actual; B) evento/latch (schema nuevo); C) las dos | **A** |
| HD-P3-3 | Eliminar reglas | A) nueva op `QuitarComportamiento` (nucleo); B) no permitir borrar en el mínimo | **A** (sin borrar, el recorrido crear/editar/corregir queda cojo) |
| HD-P3-4 | Representación de "presionado" | A) la proyección oculta `>= 1`; B) comparador/forma booleana explícita en la IR (schema) | A en el mínimo; B cuando llegue Blockly |
| HD-P3-5 | Validar la clase del actuador (gap preexistente) | A) nuevo motivo blocking representable en el validador (nucleo); B) no ahora | **A** (es un bug silencioso) |
| HD-P3-6 | `acciones` por actuador en el catálogo | A) sí; B) mantener el enum global | B en el mínimo |
| HD-P3-7 | Superficies de edición de reglas | A) navegador (frase) + whitelist espejo en el servidor; B) sólo el agente (habilitar `SetComportamiento` en R-6, revierte HD-S2-10); C) las dos | **A** (+ B opcional) |
| HD-P3-8 | Simulación | A) ninguna; B) trazado lógico hipotético textual (§14); C) click real en el pulsador Wokwi (reabre el non-goal de Slice 2) | **A o B**; C no |
| HD-P3-9 | Conflicto entre reglas | A) seguir diferido; B) detectar como motivo | A (un solo par de reglas en el mínimo) |
| HD-P3-10 | Blockly | A) después de validar la frase; B) en este mismo vertical | **A** |

## L. Test de aceptación propuesto (técnico)

1. ESP32 + LED + pulsador (Slice 2).
2. El alumno arma la frase "Mientras [Pulsador] esté presionado → [encender] [LED]" → `SetComportamiento` por el Engine → revisión +1 → persiste.
3. La vista muestra la regla como frase (sin `>=`, sin códigos) en todas las pestañas (SSE).
4. Recarga y reinicio → la misma regla.
5. Editar la acción (encender → apagar) → reemplazo por id, revisión +1.
6. Intentar quitar el pulsador → `REMOCION_CON_DEPENDIENTES` con explicación determinista, y el proyecto queda intacto.
7. Eliminar la regla (si se aprueba HD-P3-3) → la regla desaparece y el pulsador ya se puede quitar.
8. Stale y dry-run intactos.
9. Guardas: ningún bloque ni texto de runtime (`loop`, `delay`, `millis`, `digitalRead`); ningún listener de `button-press`; la IR sigue siendo la fuente de verdad.
10. Capas tocadas sólo las aprobadas en K.

## M. Test con estudiante propuesto (sin ejecutar)

Cualitativo, sin score, con el mismo molde que el protocolo de Slice 2.

1. "Mirá el proyecto: ¿qué creés que pasa si apretás el botón?" (predicción, sin ejecutar).
2. "Armá la regla para que el LED se prenda con el botón."
3. "Leé la frase en voz alta: ¿qué entendés que hace? ¿Qué pasa cuando soltás el botón?" (evento vs. nivel).
4. "Cambiá la regla para que el botón apague el LED."
5. Error inducido: "Quitá el pulsador." Luego: "¿Por qué no te deja? ¿Qué harías?"
6. "Explicá con tus palabras qué hace el proyecto."

Qué se observa:
- si predice correctamente;
- si distingue "mientras" de "cuando";
- si usa la explicación del error;
- si aparece vocabulario de runtime (loop, delay), para registrarlo sin inducirlo.

## N. Non-goals

- Blockly productivo en el mínimo; codegen; C++; PlatformIO nuevo; flash; ejecución real en hardware.
- Motor de ejecución de reglas en vivo; simulación eléctrica; click real sobre el pulsador Wokwi como disparador.
- Agente de lenguaje natural (Fase 4).
- Variables, repetición, booleanos combinados, temporizadores y conflicto/prioridad entre reglas.
- `loop`, `delay`, `millis` y debounce como conceptos visibles.
