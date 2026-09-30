# Phase 2: prueba simulada de roles (alumno / docente)

> **SIMULATED — NOT A SUBSTITUTE FOR REAL STUDENT/TEACHER TEST.**
> No participaron alumnos ni docentes reales. Los "usuarios" fueron simulados por el orquestador sobre el producto instalado. Esta prueba **no satisface** la precondición del brief §26 (HD-P3-0 = A: la prueba humana real sigue requerida). Las observaciones son hallazgos del producto y **no evidencia de comprensión de usuarios reales**.

## 1. Entorno exacto

| Campo | Valor |
|---|---|
| Fecha | 2026-09-30 |
| Repo | `main` local `822249e` (producto congelado del Slice 2: `cc6794c`) |
| VM | Windows 10 Pro 22H2 (QEMU, local), usuario `win-vm` con sesión de consola |
| Producto | Tecnia Bot 0.4.2 instalado con el `.exe` de `cc6794c` (incluye `proyecto-fisico` y el fix de C-01) |
| Runtime | Node v24.20.0 · OpenCode 1.18.18 · bun 1.3.14 |
| Modelo | `google/gemini-3.5-flash-lite` (configurado por el instalador; ver F-01) |
| Navegador | Brave, navegador por defecto (lo abre `vista-fisica`); Edge headless para la interacción con teclado |
| Perfil y memoria | presentes, del docente dueño de la máquina (ver F-02) |

**Método.**
- Flujo normal: un servidor persistente `opencode serve` (como el TUI) y mensajes al agente `tecnia-bot` por su API (`prompt_async`). Las preguntas con menú y los permisos se contestaron como lo haría el usuario.
- Capturas: pantalla **real** del escritorio de la VM (`virsh screenshot`) y capturas de la página.
- Edición en la vista: **teclado real** (Tab + flechas) vía CDP, sin manipular el DOM.
- Evidencia fuera del repo: scratchpad `trial/ev/` (transcripciones, capturas, JSON).

**Intervenciones que no son del usuario (declaradas):**
1. La clave de Google configurada estaba rechazada por el proveedor. **La cargó el humano** a pedido (F-01).
2. Los permisos de escritura de código C++ se **rechazaron**, para no salir del alcance (C++/PlatformIO son non-goals).
3. **Segmento FACILITADO**: por el flujo normal el alumno nunca llegó a la vista física con piezas (F-03…F-06). El facilitador cargó ESP32 + LED + pulsador por `POST /api/operaciones` (el mismo Engine) para poder evaluar S3–S6 sobre la vista.

## 2. Recorrido del ALUMNO simulado

Objetivo recibido: "Quiero armar algo con un ESP32, un LED y un pulsador."

| Prueba | Resultado | Evidencia y observación |
|---|---|---|
| **S1 Reconocimiento (flujo normal)** | **FAIL** | El bot saludó "¡Hola, profe!" (perfil ajeno, F-02) y usó la **tool legada `circuito`** (HTML estático). La vista física de Phase 2 **no aparece** en el flujo natural (F-03) |
| S1 Reconocimiento (vista, facilitado) | PASS con FRICTION | ESP32, LED y pulsador se distinguen. "Salida" queda bajo el LED y "Entrada" bajo el pulsador, sin ambigüedad. Se ven términos internos: `cmp-0 / anodo`, `cmp-1 / senal`, `revisión: N`, `[blocking] CODIGO (representable)`, `1.l`/`2.l` en CABLES (F-09) |
| **S2 Predicción** | vista: PASS · legado: **PEDAGOGICAL_DEFECT** | En la vista nada sugiere que el botón controle el LED. El circuito legado muestra "interactivo" y "¡Probalo con el mouse!", **simulando la relación botón→LED** que el Slice 2 excluye a propósito (F-04) |
| **S3 Edición** | FRICTION | Hay que adivinar que `cmp-1 / senal` es el pulsador. Con teclado, **cada flecha confirma un cambio** (de D19 a D34 fueron 8 revisiones intermedias) y **el foco se pierde** tras cada cambio (F-10). Al escribir "D19", cada tecla dispara un POST con la misma `baseRevision` → stale → **"otro cambio llegó primero"** sin que haya otro usuario, y un pin no elegido (D12) (F-11) |
| **S4 Error representable** | PASS con FRICTION | GPIO34 → texto claro: "El Pulsador necesita la resistencia interna (pull-up) del pin, y GPIO34 no la tiene: es sólo de entrada. Elegí otro pin." La pieza queda resaltada. **Fricción**: el LED también está resaltado en rojo (otro blocking), así que no se distingue qué motivo corresponde a qué pieza, y warning y blocking sólo se distinguen por el texto crudo (F-12) |
| **S5 Recuperación** | PASS | Al cambiar a D21 el blocking desaparece y el componente y el resto del proyecto siguen. La revisión evoluciona, pero con muchos saltos por el teclado |
| **S6 Persistencia** | PASS | La recarga muestra el mismo proyecto (piezas, rótulos, pines y motivos) y la misma revisión |
| **S7 Intención lógica** | **FAIL** (no hay superficie) | "Quiero que el LED se prenda cuando aprieto el pulsador." → el bot **pasa directo a C++** (`loop()`, `digitalRead`, `if … else`) y pide permiso para escribir `main.cpp`/`platformio.ini`. **Usa los pines del circuito legado (18/5), no los de la vista (D21/D12)**: hay tres "verdades" distintas (F-13). La vista no ofrece ninguna forma de expresar la relación, y tampoco sugiere que ya funcione |

**Formulaciones naturales registradas para S7** (no son equivalentes):

| Formulación | Semántica |
|---|---|
| "cuando aprieto el pulsador…" (la usada) | EVENTO |
| "al apretar…" | EVENTO |
| "si aprieto…" | condicional ambiguo (evoca `if` puntual) |
| "mientras esté apretado…" | NIVEL |

El código que generó el bot (`if LOW → HIGH else LOW` dentro de `loop()`) implementa NIVEL aunque el pedido se formuló como EVENTO.

## 3. Recorrido del DOCENTE simulado

Objetivo: una actividad con ESP32, LED y pulsador, para que los alumnos vean entrada y salida y cambien pines en el navegador.

| Prueba | Resultado | Observación |
|---|---|---|
| **T1 Legibilidad** | FRICTION | Con el pedido explícito, el bot usó `proyecto-fisico` pero necesitó **~16 llamadas de prueba y error**: probó los ids de placa `esp32`, `esp32dev` y `ESP32 DevKit` antes de `esp32-devkit-v1`; los tipos `boton`, `button` y `pushbutton` antes de `pulsador`; e inventó claves de payload (F-07). La vista mostró bien a Entrada y Salida. Términos que el docente eliminaría: `cmp-N`, `anodo`/`senal` sin tilde ni nombre de pieza, `1.l`/`2.l`, `(representable)`, los códigos en mayúsculas y `revisión: N` como dato principal |
| **T2 Error como aprendizaje** | PASS con FRICTION | Los textos explican el porqué (pull-up, arranque, USB) y dejan la decisión al alumno ("Elegí otro pin"). No se distinguen warning y blocking más allá del código crudo. **Contradicción**: el bot agregó una resistencia, pero es **invisible** en la vista y no está conectada, y el motivo dice "al LED le falta… resistencia-serie" mientras el bot afirma "el LED con su resistencia" (F-08) |
| **T3 Relación físico/lógico** | FAIL (no hay superficie) | Con la vista se enseñan "entrada" y "salida". Para "ahora quiero relacionarlos" no hay nada: el bot ofrece C++. Falta la pieza intermedia, la relación semántica visible y editable |
| **T4 Frase semántica** | análisis (abajo) | — |
| **T5 Trazado** | análisis (abajo) | — |

### T4 — Análisis de frases (manda la semántica, no la estética)

| Frase | Semántica real | ¿Nivel o evento? | Riesgo | ¿Mapea al IR actual? |
|---|---|---|---|---|
| **A** "Mientras [Pulsador] esté [presionado] → [encender] [LED]" | condición sostenida | **NIVEL** | Deja abierto qué pasa **al soltar**: el verbo "encender" es una acción puntual y el IR no tiene rama "si no" (ver F-14) | **Sí**, con la proyección de `estadoBooleano >= 1` |
| **B** "Cuando [Pulsador] sea [presionado] → [encender] [LED]" | transición | **EVENTO** | Induce el latch ("se queda prendido") | **No** (el IR es de nivel) |
| **C** "Si [Pulsador] está [presionado] → [encender] [LED]" | condicional sin tiempo explícito | ambiguo | Evoca un `if` puntual dentro de `loop()`, o sea el modelo de runtime | Parcial (engañosa) |
| **D** "Cuando ocurra [pulsador presionado] hacer [encender LED]" | evento explícito | **EVENTO** | Falsa para el IR actual | **No** |

Conclusión del análisis: **sólo A es honesta**, y sólo si se resuelve F-14. Variante sugerida para el diseño: "Mientras el **Pulsador** esté **presionado**, el **LED** está **encendido**", describiendo un estado en lugar de un verbo de acción.

### T5 — Trazado ("Pulsador presionado → condición verdadera → encender LED")

- **Valor:** hace explícita la cadena causal sin ejecutar nada.
- **Riesgo:** confundirse con una simulación ("¿entonces el LED se prendió?").
- **Recomendación:** **contextual y a pedido** ("¿Qué pasaría si…?"), marcado explícitamente como "explicación de la regla", con un valor hipotético que elige el usuario. Mostrar las dos ramas: presionado → encendido y **no presionado → apagado**, que es justamente la parte que F-14 hace visible.

## 4. Hallazgos

| ID | Tipo | Hallazgo | Severidad sugerida |
|---|---|---|---|
| F-01 | Entorno/producto | La clave de Google instalada estaba rechazada ("project denied access", también el 29/09). Con esa config, el bot no responde: un alumno queda bloqueado en el primer mensaje, sin un mensaje de producto que lo explique | ALTA (operativa) |
| F-02 | Producto | El perfil y la memoria son de la máquina: un alumno en la compu del docente recibe "¡Hola, profe!" | MEDIA |
| **F-03** | **Discoverability** | Por el flujo natural, el agente **no usa la vista física de Phase 2**: prefiere la tool legada `circuito` | **ALTA** |
| **F-04** | **PEDAGOGICAL_DEFECT** | El circuito legado se presenta como "interactivo" y "¡Probalo con el mouse!" (simula botón→LED), en contradicción con el non-goal del Slice 2 | **ALTA** |
| **F-05** | Agente | `vista-fisica` abrió un proyecto **vacío** y el bot afirmó que había "ESP32 con selectores"; la tool no le informa al agente que está vacío | **ALTA** |
| **F-06** | Agente | El bot afirmó "Te acabo de rearmar el circuito" habiendo hecho sólo `leer`: **acción inventada** | **ALTA** |
| **F-07** | Tool `proyecto-fisico` | No expone el vocabulario válido (ids de placa, tipos de componente, terminales, forma de los payloads). El agente adivina, filtra razonamiento interno al usuario (en inglés, "Project Engine", `grep`) y termina turnos en frases meta | **ALTA** |
| F-08 | Vista | La resistencia es invisible, no se puede conectar desde la vista, y su motivo contradice lo que dice el bot | MEDIA |
| F-09 | Vista | Términos internos expuestos: `cmp-N`, `anodo`/`senal`, `1.l`/`2.l`, `(representable)`, códigos crudos, `revisión` | MEDIA |
| F-10 | Vista | Con teclado, cada flecha confirma un cambio (revisiones intermedias y pines de paso) y el foco se pierde tras cada repintado | MEDIA |
| **F-11** | **Vista (defecto)** | Al escribir en un `<select>`, cada tecla dispara un POST con la misma `baseRevision` → stale → "**otro cambio llegó primero**" sin que haya otro usuario, y queda aplicado un pin no elegido | **ALTA** (mensaje falso + resultado no pedido) |
| F-12 | Vista | Si varias piezas tienen un blocking, todas se resaltan igual: no se asocia cada motivo a su pieza de un vistazo, y warning y blocking no se distinguen visualmente | MEDIA |
| **F-13** | **Coherencia** | El agente no lee el proyecto de la vista al generar código: el HTML legado, el proyecto de la vista y el C++ tienen pines distintos | **ALTA** |
| **F-14** | **Semántica** | "Mientras presionado → encender" no define el estado del LED al soltar. El IR no tiene "si no" ni un estado por defecto documentado. El C++ del bot sí apaga (`else LOW`) | **ALTA** (bloquea el DESIGN de Phase 3) |
| F-15 | Agente | Ante cualquier pedido de comportamiento, el bot salta a C++/PlatformIO, el modelo `loop`/`digitalRead` que Phase 3 quiere evitar | ALTA (pedagógica) |

## 5. Qué NO puede concluirse (por ser simulado)

- Si un alumno real entiende "Entrada/Salida", "mientras" o los textos de los motivos.
- Qué vocabulario usaría espontáneamente (las formulaciones de S7 son hipótesis, no datos).
- Si el docente real valoraría el trazado o lo consideraría ruido.
- Los tiempos reales de tarea y la frustración.
- El comportamiento con mouse real en Brave (la edición se hizo con teclado vía CDP).
- La generalidad del comportamiento del LLM: un modelo y una corrida, no una muestra.

## 6. Preguntas para la prueba humana REAL

Sin inducir la respuesta:
1. "¿Qué pensás que hace esto?" (sobre la vista con ESP32, LED y pulsador).
2. "¿Cuál de estas piezas recibe información y cuál hace algo?"
3. "¿Cómo harías para que el LED dependa del pulsador?" Registrar literalmente: cuando / si / mientras / al apretar.
4. (Con la frase A visible) "¿Qué significa 'mientras' acá? ¿Qué pasa con el LED cuando soltás el botón?"
5. "¿Qué cambiarías para que deje de hacerlo?"
6. "Ese cartel rojo, ¿qué te dice? ¿Qué harías?"
7. (Docente) "¿Qué palabra de esta pantalla no le mostrarías a un alumno?"
