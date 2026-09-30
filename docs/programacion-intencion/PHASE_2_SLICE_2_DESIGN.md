# Phase 2 Slice 2: diseño (ESP32 + LED + pulsador)

**Estado: APROBADO por el HUMAN PRODUCT OWNER (2026-09-30), con las decisiones R-1..R-6 de §10 resueltas. Writers autorizados en la rama `feature/programacion-intencion-phase2-slice2`.**

Base: `main` local `d8212fb` (Slice 1 cerrado; producto auditado `06233e3`).

Fuentes:
- `PHASE_2_SLICE_2_DISCOVERY.md`, con las decisiones HD-S2-0..10 ya tomadas (normativas);
- un mapeo read-only de los contratos del código (las citas `archivo:línea` de este documento salen de ahí).

## 0. Contrato de scope

El slice demuestra "coexistencia física y semántica de una entrada y una salida dentro del mismo proyecto, editables, persistentes y validadas por el mismo Project Engine".

NO demuestra "cuando aprieto el botón, prender el LED". No hay `ComportamientoRegla`, ni lógica, ni simulación.

**Hallazgo central del discovery:** el núcleo ya alcanza. Todo el trabajo cae en tres lugares:
- **la proyección física** (`opencode/vista-fisica/**`);
- **una tool de transporte** para el agente;
- **el seed de la demo**.

Si la implementación llegara a necesitar tocar una capa protegida (§6), eso es **STOP → HUMAN_DECISION_REQUIRED**.

## 1. Recorrido de aceptación mínimo (normativo)

| # | Paso | Mecanismo | Verificación |
|---|---|---|---|
| 1 | Abrir el proyecto | tool `vista-fisica` (existente) o launcher de demo | navegador real (CDP) |
| 2 | ESP32 + LED + pulsador visibles | `wokwi-esp32-devkit-v1`, `wokwi-led`, **`wokwi-pushbutton`** con shadowRoot | CDP: las 3 piezas presentes y sin superponerse (bounding boxes disjuntas) |
| 3 | Identificar Entrada/Salida | rótulo proyectado desde `ComponenteCatalogo.clase` (servidor, §3.3) | CDP: el pulsador dice "Entrada" y el LED "Salida"; `web/*.js` sin tabla de clases |
| 4 | Modificar el GPIO del pulsador | `<select>` del terminal `senal` → POST `AsignarPin` (actor forzado "navegador") | la revisión sube en 1 y el `<select>` muestra el valor nuevo |
| 5 | Operación por el Project Engine | `servicio.aplicar`, sin atajos | el disco coincide con la forma canónica del Engine |
| 6 | Revisión +1 | revisión monótona | `#revision` y `snapshot.revision` |
| 7 | Persistir | almacén del Engine (persistencia antes del swap) | el JSON en disco tiene `senal: <GPIO nuevo>` |
| 8 | Recargar | recarga de la página y reinicio del proceso | el estado es idéntico (deepEqual del snapshot sin `vista` volátil) |
| 9 | Conservar exactamente el estado | PERSISTIBLE ⇒ RECARGABLE | ídem |
| 10 | Provocar un blocking representable | pulsador en GPIO34 (lo ofrece D8) → `PIN_SIN_PULLUP_INTERNO`; o en el mismo pin que el LED → `PIN_OCUPADO` | commit ok, `listo:false`, motivo visible |
| 11 | Seguir editando y corregir | `<select>` a un pin normal | el motivo desaparece y la revisión sube en 1 |
| 12 | Explicación determinista | texto proyectado desde el reason code y sus `datos` (§3.4), con la entidad resaltada | CDP: texto llano presente; un código desconocido se muestra crudo |
| 13 | Ninguna relación lógica pulsador → LED | `web/*.js` no escucha `button-press`/`button-release`; no se crea ningún comportamiento | test estático + CDP: un click en el pulsador no cambia la revisión, el LED ni el disco |

## 2. Slice vertical exacto

Un proyecto con ESP32 + LED (+ resistencia si la siembra la demo) + pulsador, donde:
- el alumno ve las tres piezas, identifica entrada y salida, recablea el pulsador desde la vista, provoca y corrige un error, y entiende la explicación;
- el agente puede armar ese mismo proyecto emitiendo operaciones existentes, por whitelist, a través del Engine.

## 3. Contratos y ownership

### 3.1 Tool del agente `proyecto-fisico` (HD-S2-1a)

Es un archivo nuevo: `opencode/tool/proyecto-fisico.ts`. **Es transporte, no autoridad.** Cumple la misma función que el POST del navegador, pero para el actor "agente".

**Args** (con el idioma de `tool.schema` del repo):

| Arg | Tipo | Regla |
|---|---|---|
| `accion` | `"leer" \| "simular" \| "aplicar"` | obligatorio |
| `baseRevision` | entero ≥ 0 | **obligatorio** para `simular` y `aplicar`. La tool **nunca** lo completa con `snapshot().revision`: eso anularía la protección contra stale |
| `operaciones` | lista de `{ tipo, payload }` | obligatorio para `simular`/`aplicar`, entre 1 y N (N = 20). Cada elemento tiene EXACTAMENTE esas dos claves; cualquier otra → rechazo en la tool |
| `idProyecto` | string opcional | default `ID_PROYECTO_DEFAULT` (el mismo de `vista-fisica`) |

**Whitelist explícita** (constante inmutable en la tool): `SetPlaca`, `AgregarComponente`, `QuitarComponente`, `AsignarPin`, `Conectar`, `Desconectar`.

- **Excluidas:** `SetComportamiento` (HD-S2-10: nada de lógica) y `CambiarComponente` (fuera del recorrido). Cualquier otro `tipo`, incluidos los desconocidos y `CrearProyecto`, se rechaza **en la tool**, sin llamar al Engine. El resultado es `{ ok:false, rechazadoPor:"tool", codigo:"OPERACION_FUERA_DE_WHITELIST", tipo }`. Ese código es de transporte: no es un motivo del Engine, no se persiste y no modifica nada.
- El `tipo` de componente en `AgregarComponente` **no** se filtra en la tool: decide el catálogo (Engine). Filtrarlo sería una segunda autoridad del catálogo.

**Armado del sobre:** la tool construye cada `SobreOperacion` sólo con `tipo` + `payload` del arg:
- `actor: "agente"` (forzado);
- `idOperacion` generado;
- un `idTransaccion` compartido;
- `baseRevision` = el del arg, en la primera operación (así lo lee `motor.ts:538-548`).

**Ejecución:**
- `aplicar` → `servicio.aplicarTransaccion(sobres)`: atómico, todo o nada.
- `simular` → `servicio.proponer(sobres)`: dry-run, no persiste ni notifica.
- `leer` → `servicio.snapshot()` resumido: revisión, componentes con tipo, rol y pines, y motivos con explicación.

**Acceso al servicio:**
- Sólo por `obtenerServicioDeProyectoConVista` (`servidor/servicio-con-vista.ts`), con import perezoso (el mismo patrón D13 de `vista-fisica.ts`), sobre el MISMO directorio de datos que `vista-fisica` (`<ctx.directory>/.tecnia-vista-fisica/`).
- Resultado: el mismo singleton y el mismo candado, y el navegador abierto recibe el evento SSE.
- **Prohibido:** importar `nucleo/almacen.ts`, `crearAlmacen`, `obtenerServicioDeProyecto`, `node:fs` para escribir, o construir la IR.

**Resultado para el agente:**
- ok o rechazo;
- `baseRevision`, `revisionActual`;
- los `motivos` del Engine (código, severidad, clasificación, entidad y la **explicación determinista** de §3.4).

El agente explica con ese texto; no infiere causas.

**Candado:** si otro proceso tiene el proyecto, la tool devuelve un mensaje claro, igual criterio que el H5 de `vista-fisica`.

**Permiso:** `proyecto-fisico: "allow"` en `opencode/agent/tecnia-bot.md`, junto a `vista-fisica`. La alternativa es `"ask"`, ver R-2.

**Módulo compartido:** `directorioDeDatos` e `ID_PROYECTO_DEFAULT` salen de `tool/vista-fisica.ts` hacia `opencode/vista-fisica/ubicacion-proyecto.ts`, porque los tools no se importan entre sí. `vista-fisica.ts` los reexporta y el comportamiento no cambia.

### 3.2 Render del pulsador (HD-S2-2/3/4)

`opencode/vista-fisica/wokwi-render-datos.ts`. Sólo datos, con el mismo patrón que el LED:
- `ELEMENTO_WOKWI_POR_TIPO.pulsador = "wokwi-pushbutton"`;
- `TERMINAL_WOKWI_POR_TIPO.pulsador = { senal: "1.l", gnd: "2.l" }`. Es proyección física pura: el GND sigue siendo el riel fijo implícito del catálogo;
- `ATRIBUTOS_POR_TIPO.pulsador = { color: "green" }`, para distinguirlo del LED rojo. Es cosmético y revisable (R-3).

El renderer no agrega ningún listener. Que el elemento Wokwi se "hunda" visualmente al hacer click es comportamiento interno del custom element y no tiene semántica.

### 3.3 Rol Entrada/Salida (HD-S2-7)

- `modelo-vista.ts`: `ComponenteVista` gana `rol: "entrada" | "salida" | null`. Es aditivo.
- `snapshot-a-vista.ts` lo **deriva de `ComponenteCatalogo.clase`** (`catalogo.ts:88`: `"sensor" | "actuador" | "pasivo" | "entrada"`) del catálogo que ya recibe `proyectarVista`. El mapeo es una función pura del lado del servidor, en `vista-fisica/`:
  - `entrada`, `sensor` → `"entrada"` (el pulsador es `entrada`; `catalogo-datos.ts:58`);
  - `actuador` → `"salida"` (el LED);
  - `pasivo` → `null` (la resistencia, sin rótulo);
  - la placa no es un componente de catálogo y no lleva rol.
  - Una `clase` futura que el mapeo no conozca → `null`: nunca se inventa un rol.
- `plan-de-pintado.js`/`pintar.js` sólo muestran el texto recibido ("Entrada"/"Salida") junto al componente. El browser no tiene ninguna tabla de clases ni de tipos.

### 3.4 Explicación de motivos (HD-S2-8, A + C acotado)

- Archivo nuevo `opencode/vista-fisica/explicaciones-motivos.ts`: una tabla pura `codigo → (datos, nombres) → string`.
- Sin LLM. Sin inferir causas. Sólo interpola `datos` del motivo estructurado y el nombre visible del componente (`nombreVisible` del catálogo).
- `snapshot-a-vista.ts` agrega `explicacion: string | null` a cada motivo de la vista, **del lado del servidor**. Así no hace falta ningún asset nuevo, y la whitelist de assets de `servidor/` no se toca.
- Si el código no está en la tabla → `explicacion: null` y el browser muestra el código crudo tal cual.

Textos propuestos (voseo, como la UI existente). Son **revisables por el humano** (R-4):

| Código | Texto propuesto |
|---|---|
| `PIN_SIN_PULLUP_INTERNO` | "El {componente} necesita la resistencia interna (pull-up) del pin, y {pin} no la tiene: es sólo de entrada. Elegí otro pin." |
| `PIN_OCUPADO` | "{pin} ya lo está usando otro componente ({ocupadoPor}). Cada pin puede tener una sola conexión de señal." |
| `REQUISITO_INSATISFECHO` | "Al {componente} le falta algo que necesita para funcionar sin riesgo ({requisito} en {terminal})." |
| `PIN_STRAPPING` | "{pin} participa del arranque de la placa: puede molestar al encenderla." |
| `PIN_UART_USB` | "{pin} lo usa el USB: puede interferir con la carga del programa y con el Monitor Serie." |
| `PIN_FLASH_RESERVADO` | "{pin} está conectado a la memoria interna de la placa: no se puede usar." |
| `CAPACIDAD_PIN_INCOMPATIBLE` | "{pin} no puede hacer lo que necesita el {componente} en {terminal}." |
| `PIN_INEXISTENTE_EN_DOCUMENTO` | "{pin} no existe en esta placa. Elegí otro pin." |

- **Resaltado (C):** `pintarMotivo` agrega `data-entidad-tipo`/`data-entidad-id` a la fila. `pintar.js` marca el elemento del componente afectado con `data-afectado="<severidad>"`, y el CSS lo remarca.
- Es presentación pura, derivada de `motivo.entidad` (que hoy `plan-de-pintado.js` ya calcula y `pintar.js` descarta).

### 3.5 Layout (HD-S2-5)

- Sólo CSS en `web/index.html`: `#circuito` como `display:flex; flex-wrap:wrap; gap; align-items:flex-start`, más un margen que compense el `scale(1.25)` de la placa, que no reserva espacio en el flujo.
- Sin motor de layout y sin tabla de tamaños.

### 3.6 Seed de la demo (HD-S2-1b)

`scripts/vista-fisica-demo.mjs` siembra, además de lo actual:
- `AgregarComponente(pulsador)`;
- `AsignarPin(senal, GPIO18)`: un pin normal, no strapping y fuera del pool de riesgo.

Todo por operaciones reales, con actor "agente", como hoy. Los proyectos existentes no se resiembran (condición actual `sembrarSiHaceFalta`).

## 4. Cómo se prueba que la tool NO es una segunda autoridad ni una vía de escape

| ID | Amenaza | Prueba (RED primero) |
|---|---|---|
| T-AG-01 | Escribir la IR directo | Estático: `proyecto-fisico.ts` no contiene `writeFile`, `rename`, `open(...,"w")`, `almacen`, `crearAlmacen` ni `obtenerServicioDeProyecto`, y las guardias existentes pasan. Dinámico: después de `aplicar`, el disco coincide con el canónico del Engine y la revisión sube exactamente en 1 |
| T-AG-02 | Operación fuera de la whitelist | `SetComportamiento`, `CambiarComponente`, `CrearProyecto`, `"setplaca"` (case), `"Foo"` y `""` → `OPERACION_FUERA_DE_WHITELIST`; el Engine no se invoca (spy); revisión y disco idénticos byte a byte. Un lote con una sola operación fuera de la whitelist se rechaza entero |
| T-AG-03 | Saltear baseRevision | Sin `baseRevision` → rechazo de la tool. `baseRevision` stale → `BASE_REVISION_DESACTUALIZADA` del Engine, sin mutación. No entero o negativo → `BASE_REVISION_INVALIDA`. Test de que la tool no lee `snapshot().revision` para completarlo (mock del servicio que registra las llamadas) |
| T-AG-04 | Saltear la transacción | Un lote [válida, inválida] → nada aplicado, revisión y disco idénticos, motivos estructurados |
| T-AG-05 | Saltear la validación | Pulsador en GPIO34 por la tool → el mismo `PIN_SIN_PULLUP_INTERNO` que por el navegador y por el Engine directo (convergencia de caminos) |
| T-AG-06 | Suplantar actor o sobre | Elementos de `operaciones` con claves extra (`actor`, `idOperacion`, `idTransaccion`, `baseRevision`) → rechazo en la tool. El sobre resultante siempre tiene `actor:"agente"` |
| T-AG-07 | Segunda instancia del Engine | La tool y `vista-fisica` en el mismo proceso usan el MISMO servicio (identidad). Una operación por la tool → el navegador abierto recibe el SSE `revision` y lo muestra |
| T-AG-08 | El dry-run muta | `simular` → revisión y disco iguales, sin notificación SSE |
| T-AG-09 | Candado | Otro proceso es dueño del proyecto → mensaje claro y ninguna escritura |
| T-AG-10 | Datos no planos | `payload` con claves `__proto__`/`constructor` → el Engine lo rechaza (`ENTRADA_NO_ES_DATO_PLANO`/`CLAVE_DESCONOCIDA`); la tool no lo "limpia" en silencio |
| T-AG-11 | Tamaño | Más de 20 operaciones → rechazo de la tool |
| T-AG-12 | Registry | Con `servidor/` ausente, `proyecto-fisico` falla con un error explícito sólo al usarse y el resto de las tools carga (patrón D13, test de packaging) |

## 5. Tests RED/GREEN propuestos

Todos son archivos nuevos `tests/phase2-s2-*.test.mjs`, test-first y con la evidencia RED guardada.

- `phase2-s2-render.test.mjs`: la vista proyecta el pulsador con `elementoWokwi:"wokwi-pushbutton"`, `senal→"1.l"`, `gnd→"2.l"`; el plan de pintado lo incluye; el LED no cambia.
- `phase2-s2-rol.test.mjs`: `rol` derivado del catálogo (pulsador → entrada, LED → salida, resistencia → null, clase desconocida → null); el browser JS sin tablas de clase/tipo (escaneo estático, igual que D8).
- `phase2-s2-explicaciones.test.mjs`: cada código de la tabla, con `datos` reales del Engine → texto esperado; un código desconocido → `null` y fila cruda; el determinismo (dos proyecciones iguales); la fila lleva `data-entidad-*` y el elemento afectado `data-afectado`.
- `phase2-s2-recorrido.test.mjs`: el recorrido §1 pasos 4–11 por el Engine y por POST, más recarga del proceso y persistencia.
- `phase2-s2-sin-logica.test.mjs`: `web/*.js` sin `button-press`/`button-release`/`addEventListener` sobre piezas Wokwi; ningún `SetComportamiento` en los caminos nuevos.
- `phase2-s2-tool-agente.test.mjs`: T-AG-01..11.
- `phase2-s2-demo.test.mjs`: el seed produce ESP32 + LED + pulsador con operaciones reales y es idempotente.
- Ajustes **aditivos** permitidos en tests de Phase 2 Slice 1, sólo si el campo `rol`/`explicacion` rompiera una comparación literal (el análisis previo indica que no: los `deepEqual` comparan proyecciones entre sí). Cada ajuste se lista y se justifica.

## 6. Archivos

**Pueden cambiar:**
- `opencode/tool/proyecto-fisico.ts` (nuevo);
- `opencode/tool/vista-fisica.ts` (sólo mover `directorioDeDatos`/`ID_PROYECTO_DEFAULT` al módulo compartido y reexportar);
- `opencode/agent/tecnia-bot.md` (1 línea de permiso);
- `opencode/vista-fisica/{wokwi-render-datos.ts, modelo-vista.ts, snapshot-a-vista.ts, ubicacion-proyecto.ts (nuevo), explicaciones-motivos.ts (nuevo)}`;
- `opencode/vista-fisica/web/{plan-de-pintado.js, pintar.js, index.html}`;
- `scripts/vista-fisica-demo.mjs`;
- `tests/phase2-s2-*.test.mjs` (nuevos);
- `docs/programacion-intencion/**`.

**Protegidos (tocarlos = STOP + HUMAN_DECISION_REQUIRED):**
- `opencode/nucleo/**`, `opencode/servidor/**`;
- `opencode/tool/circuito.ts`, `platformio.ts`, `pinouts.json`;
- `tests/nucleo-*`, `install/**`, `installer/**`;
- `package.json`, `pnpm-lock.yaml`;
- `.gestor/`.

Los instaladores no hacen falta: D12 ya copia `tool/` y `vista-fisica/` completos. Se verifica en el gate de packaging.

## 7. Gate técnico

1. Baseline: la suite completa en verde (≥1115 + nuevos), typecheck 0, fichas 0; `git diff 8b43c59 -- 'tests/nucleo-*'` vacío; diff sin paths protegidos (script de alcance).
2. Los tests de §5 en verde, con evidencia RED previa.
3. Navegador real (Chromium CDP): el recorrido §1 completo, dos pestañas (una operación de la tool se ve en el navegador), stale, Path A (pulsador en el pin del LED), Path B, consola limpia, offline con proxy muerto (0 requests remotas) y bounding boxes sin superposición.
4. Packaging: instalación aislada real fuera del repo (el gate de Slice 1 más la tool nueva cargando en el loop del registry y el D13 de la tool nueva).
5. Guardias E3-04b: OK contra el repo; la tool nueva no las dispara.
6. Red team focal: **RED-TOOL** (≥10 ataques contra §4, incluidos los de prompt/agente: operaciones encadenadas, lotes enormes, tipos disfrazados, baseRevision manipulada) + **RED-VISTA** (≥6: rol, explicaciones, resaltado, sin lógica, layout). Como máximo una ronda de fixes y una regresión focal.
7. Windows: por proporcionalidad, NO se repite la matriz completa. Ver R-5.
8. Freeze con MANIFEST y ZIP, mismo formato que Slice 1.

## 8. Protocolo de prueba con estudiante (propuesto; no se ejecuta en el gate técnico)

Perfil: 1 estudiante de escuela técnica, nivel inicial, sin datos personales. Se aclara que se evalúa la herramienta. El observador no da respuestas.

1. "Abrí el proyecto; contame qué ves."
2. "¿Cuál recibe información y cuál la produce?" (los rótulos están visibles; se registra si los usa o si razona sin ellos).
3. "Cambiale el pin al pulsador."
4. "Antes de recargar, ¿qué esperás encontrar?" Después se recarga y se compara.
5. "Poné el pulsador en GPIO34." Luego: "¿Qué pasó? ¿Podés seguir? Corregilo." (se usa la explicación en texto llano).
6. "¿Qué le agregarías después?" Se registra si surge sola la condición botón → LED; no se implementa.

Qué se observa, en forma cualitativa y sin score:
- si reconoce entrada/salida (sí / con pista / no);
- si predice la recarga;
- si usa la explicación para corregir (sí / con ayuda / no);
- si explica con sus palabras;
- si verbaliza la condición.

Entregable: tarea, perfil, observaciones, errores de comprensión, intervenciones y cambios de diseño derivados.

## 9. Secuencia de writers propuesta (NO autorizada todavía)

Un writer por vez, sin Agent/fork, test-first, commits chicos, en una rama `feature/programacion-intencion-phase2-slice2` desde `main`.

1. **W-S2-VISTA:** §3.2 render + §3.3 rol + §3.4 explicaciones y resaltado + §3.5 CSS + los tests render/rol/explicaciones/sin-logica. → Gate intermedio: vista con pulsador en navegador real.
2. **W-S2-TOOL:** §3.1 tool + módulo de ubicación + permiso + §3.6 seed + los tests tool-agente/demo/recorrido. → Gate intermedio: T-AG-01..12 y el recorrido completo.
3. **W-S2-DOCS:** actualizar COMPONENT-CATALOG/OPERATIONS/DECISIONS sólo en lo que cambia (la tool de transporte del agente, `rol`, explicaciones), REPORT y TEST_PLAN.
4. Gate §7 → red team → como máximo una ronda de fixes → freeze → STOP.

## 10. Decisiones de revisión (RESUELTAS por el humano)

- **R-1 = TOOL SEPARADA**: `vista-fisica` presenta/abre; `proyecto-fisico` emite operaciones existentes hacia el Engine. No se mezclan.
- **R-2 = ALLOW**: sin confirmación `ask`. No reduce ninguna protección: baseRevision obligatorio, whitelist, Engine como autoridad única, validación, transacción atómica, reasons estructurados, stale, candado/singleton y persistencia autoritativa.
- **R-3 = GREEN**: es proyección visual, no semántica.
- **R-4 = textos de §3.4 APROBADOS**: con voseo, deterministas y derivados sólo del reason estructurado. Un reason desconocido muestra el código original. La entidad se resalta cuando la referencia alcanza.
- **R-5 = WINDOWS SHORT RUN** al final del slice: el instalado abre, ESP32+LED+pulsador y Entrada/Salida visibles, una edición real del GPIO del pulsador por el Engine, revisión +1, persistencia, recarga y consola limpia. Si hay que actualizar, sólo con el procedimiento no destructivo ya validado. Sin snapshot restore, clean install, uninstall ni matriz completa.
- **R-6 = WHITELIST exacta**: SetPlaca, AgregarComponente, QuitarComponente, AsignarPin, Conectar, Desconectar. Máximo 20 operaciones por llamada, en UNA transacción atómica. Con más de 20 se RECHAZA explícitamente con resultado estructurado: nunca se trunca, se aplica parcial ni se divide.

### Propuesta original (histórica)

- **R-1:** la tool como archivo separado `proyecto-fisico` (recomendado: permiso propio y superficie auditable) o como acciones extra dentro de `vista-fisica`.
- **R-2:** permiso `allow` (fluido para el agente) o `ask` (el docente confirma cada mutación).
- **R-3:** color del pulsador (`green` propuesto).
- **R-4:** la redacción exacta de los textos de §3.4.
- **R-5:** Windows. Recomendación: una corrida corta en la VM (el tool nuevo bajo el bun de OpenCode + el recorrido en Edge), sin rehacer la matriz completa, porque el slice no toca el candado, el servidor ni los instaladores.
- **R-6:** whitelist exacta (propuesta: SetPlaca, AgregarComponente, QuitarComponente, AsignarPin, Conectar, Desconectar) y el límite N = 20.
