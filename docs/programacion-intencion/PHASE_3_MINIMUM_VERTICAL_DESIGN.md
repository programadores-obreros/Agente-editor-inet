# Phase 3: diseño del mínimo vertical ("Mientras el pulsador esté presionado…")

> **Nota (vertical #1 implementado):** el contrato de implementación `PHASE_3_VERTICAL_1_CONTRACT.md` (§A "Partes del diseño sustituidas") reemplaza partes de este diseño por decisiones humanas posteriores (p. ej. la tool SÍ acepta `SetComportamiento`/`QuitarComponente` de reglas, whitelist de 8). Este documento se conserva sin reescribir.

> **Nota (vertical #2 implementado):** el §14 (adaptador Blockly) quedó implementado como indica `PHASE_3_VERTICAL_2_BLOCKLY_CONTRACT.md`, que prevalece sobre este diseño en ese punto.

**Estado: PROPOSED — HUMAN APPROVAL REQUIRED.** No autoriza writers ni implementación.

**Base:** `main` local `822249e`; producto congelado del Slice 2 `cc6794c`.

**Insumos:**
- `PHASE_3_DISCOVERY.md` (HD-P3-0..10, resueltas por el humano; ver §0);
- `PHASE_2_SIMULATED_ROLE_TRIAL.md` (SIMULATED; hallazgos F-01..F-15);
- el código actual de `opencode/nucleo/**`, `opencode/servidor/**` y `opencode/vista-fisica/**`.

## 0. Decisiones humanas vigentes (input normativo)

| HD | Decisión |
|---|---|
| HD-P3-0 = A | La prueba humana real sigue siendo requerida; la simulada no la satisface |
| HD-P3-1 = B | La lógica incompleta tiene que ser representable en el IR, con estados estructuralmente válidos y sin nulls arbitrarios |
| HD-P3-2 = A | El primer vertical usa semántica de NIVEL; nada de evento ni latch |
| HD-P3-3 = A | Diseñar `QuitarComportamiento` (puede tocar `nucleo/`) |
| HD-P3-4 = A | La proyección oculta de forma determinista `estadoBooleano >= 1` como "presionado"; el schema booleano no cambia |
| HD-P3-5 = A | Diseñar la validación: un pulsador no puede quedar aceptado en silencio como actuador |
| HD-P3-6 = NO | No se crea un sistema general de acciones por actuador |
| HD-P3-7 = A | La edición es por el navegador, con whitelist explícita en el servidor. `proyecto-fisico` **no** recibe `SetComportamiento` |
| HD-P3-8 = B | Trazado textual determinista mínimo, si aporta valor |
| HD-P3-9 | Diferido: sin conflictos entre reglas |
| HD-P3-10 = A | Blockly después de validar la frase |

## North star

El alumno ve el ESP32, el **LED — Salida** y el **Pulsador — Entrada**, y construye o edita:

> "Mientras el **Pulsador** esté **presionado**, el **LED** está **encendido**."

La relación:
- vive en el IR y la muta sólo el Project Engine;
- persiste y recarga;
- puede estar incompleta;
- se corrige y se elimina;
- se ve sin mirar JSON.

No depende de Blockly, C++, `loop`/`delay`/`millis` ni de una simulación de Wokwi.

---

## 1. Capacidad actual (con evidencia)

- **IR:** `ComportamientoRegla { id, cuando: {sensor, capacidad, comparador, umbral{valor,unidad,magnitud}}, entonces: {actuador, accion} }` (`ir.ts:25-57`).
  - `COMPARADORES = [">","<",">=","<="]` (`ir.ts:31`); `ACCIONES = ["encender","apagar"]` (`ir.ts:35`).
  - Es un modelo de NIVEL, sin eventos (`ir.ts:7-10`).
- **`SetComportamiento`:**
  - valida la forma COMPLETA y rechaza lo incompleto (`operaciones.ts:231-241`);
  - hace upsert por id (`COMPORTAMIENTO_REEMPLAZADO`, `operaciones.ts:445-516`).
- **Dependencias:** `QuitarComponente` con dependientes → `REMOCION_CON_DEPENDIENTES` (rechazo, `operaciones.ts:372-374`).
- **Verificado por el Engine real (discovery):**
  - "pulsador → encender LED" hace commit con `>= 1`;
  - dry-run, stale, lote atómico y recarga idéntica funcionan;
  - `QuitarComponente` bloquea;
  - **la clase del actuador NO se valida** (el pulsador se acepta como actuador).
- **Cargador:** exige `comportamientos[]` y valida cada regla (`cargador.ts:180-220`). Una regla incompleta es irrecargable hoy.
- **Transporte:**
  - `POST /api/operaciones` **no tiene whitelist de tipo**; fuerza `actor: "navegador"`;
  - SSE `revision`;
  - proyección del lado del servidor (rol, explicaciones) desde el Slice 2.
- **Nada proyecta hoy los comportamientos:** ni la vista ni `leer`.

## 2. Contrato semántico (NIVEL)

**Definición.** Una regla de nivel `R = (sensor S, estado E, actuador A, estado de salida O)` significa:

> En todo instante en que la condición "S está en E" sea verdadera, A **está** en O.

**Reposo (resuelve F-14; ver HD-P3D-1).** Cuando la condición es falsa, R **no** sostiene a A: A queda en su **estado de reposo**. El contrato propuesto es: *estado de reposo de un actuador digital = apagado*.

Con una sola regla ("mientras presionado → LED encendido") el resultado es:
- LED encendido ⇔ pulsador presionado;
- al soltar, el LED está apagado.

**Qué NO es:**
- **EVENTO:** "cuando ocurre la transición no-presionado → presionado, encender". No hay flancos, latch, memoria de estado ni tiempo.
- Una ejecución: el IR describe intención. No hay motor que corra la regla en este vertical.

**Vocabulario:**
- En la frase, en el código y en los reason codes nuevos: "**mientras**", nunca "cuando".
- `ComportamientoRegla.cuando` es un nombre heredado del IR. Se documenta como "condición de nivel". Renombrarlo sería un cambio de schema sin valor para este vertical (HD-P3D-5).

**Acción en la frase:** el vertical sólo ofrece `encender` como **estado** ("está encendido"). `apagar` existe en el IR, pero **no se ofrece en la frase**: con reposo = apagado, "mientras presionado → apagado" no tiene efecto observable y confunde (HD-P3D-2).

**Un documento con `apagar`** (por ejemplo, de otro canal) se proyecta tal cual: "…el LED está apagado". No se reinterpreta.

## 3. Modelo de lógica incompleta

**Alternativas evaluadas:**

| Alt. | Modelo | Invariantes | Veredicto |
|---|---|---|---|
| A | Borrador sólo en la UI | Viola HD-P3-1 = B | descartada |
| B | `null` en campos | nulls arbitrarios | descartada por mandato |
| C | Unión discriminada `estado: "completo" \| "incompleto"` | string mágico redundante con los datos; permite estados contradictorios ("completo" sin sensor) | descartada |
| D | Colección separada `borradores[]` | segundo modelo, segunda fuente de verdad | descartada |
| **E** | **Slots opcionales en la MISMA `ComportamientoRegla`**: `cuando?` y `entonces?` como sub-objetos opcionales, y dentro de cada uno campos opcionales **por slot semántico**. La completitud es un **diagnóstico derivado** (validador), nunca un campo | ausencia de clave ≠ null; un solo modelo; la completitud no se guarda, se deriva; lo que está presente se valida igual que hoy | **elegida** |

**Forma propuesta.** Es aditiva: toda regla completa de hoy sigue siendo válida sin cambios.

```ts
ComportamientoRegla {
  id: string                         // siempre
  cuando?: {                         // slot "condición de nivel"
    sensor?: string                  //   slot [Pulsador ▾]
    capacidad?: string               // ┐ slot [presionado ▾]: los TRES juntos
    comparador?: Comparador          // │ o ninguno (triada atómica, ver abajo)
    umbral?: UmbralComportamiento    // ┘
  }
  entonces?: {                       // slot "salida"
    actuador?: string                //   slot [LED ▾]
    accion?: Accion                  //   slot [encendido ▾]
  }
}
```

**Reglas de validez estructural** (el cargador y la operación aplican la MISMA función, así PERSISTIBLE ⇒ RECARGABLE). **Todos** los sitios que desreferencian `cuando`/`entonces` tienen que tolerar slots ausentes; si no, se cae el recargable (RED-DESIGN-AUTHORITY RD-1): `cargador.ts` (validación de forma **y** el loop referencial de `cargador.ts:222-228`), `operaciones.ts` (`validarFormaPayload:230-244` **y** `aplicarSetComportamiento:463-490`), `REMOCION_CON_DEPENDIENTES` (`operaciones.ts:372`), `CambiarComponente`/`reemplazarSensor`, el validador técnico y la proyección. El writer los inventaría con `rg "\.cuando\.|\.entonces\."` como primer paso, con un test RED por sitio:
1. Una clave ausente es un slot vacío. **`null` explícito se rechaza** (`PAYLOAD_OPERACION_INVALIDO` / `DOCUMENTO_MALFORMADO`).
2. **Triada atómica de estado:** `capacidad`, `comparador` y `umbral` están los tres o no está ninguno. Si hay una parte suelta, el rechazo es estructural. Así se evita una condición a medias sin significado.
3. Todo campo presente se valida como hoy: tipos, enums, `umbral` completo, referencias existentes (`REFERENCIA_INEXISTENTE`).
4. **Una regla tiene al menos UN slot presente** (sensor, estado, actuador o salida). La regla totalmente vacía (`{comportamiento: {}}`) **se sigue rechazando**, como exige hoy Phase 1 (`tests/nucleo-operaciones.test.mjs:778`; RED-DESIGN-SEMANTICS R-1). La regla se crea con el primer slot elegido (§7).

**Diagnóstico derivado:**
- El validador emite **`COMPORTAMIENTO_INCOMPLETO`**: semántico, **blocking**, representable, `entidad = {tipo:"comportamiento", id}`, `datos = { faltan: ["sensor"|"estado"|"actuador"|"salida"] }`.
- Proyecto `listo:false`, persistible, recargable y editable.

**`schemaVersion`:** los documentos nuevos que contengan reglas incompletas no los puede cargar un producto viejo. Eso es aceptable, pero tiene que quedar explícito: ver §21 y HD-P3D-3.

## 4. Operaciones

| Operación | Estado | Contrato |
|---|---|---|
| `SetComportamiento` | **se amplía** | Acepta la forma de §3 (slots opcionales). Es upsert por id: **reemplazo total** de la regla, porque la UI envía la regla entera en cada edición (sin merges parciales implícitos). Sirve para **crear, editar y completar**. `COMPORTAMIENTO_REEMPLAZADO` (info) se mantiene |
| **`QuitarComportamiento`** | **nueva** | `payload { comportamiento: id }`. Rechazo `REFERENCIA_INEXISTENTE` si no existe (se reusa el código; `datos {comportamiento}`) |
| `QuitarComponente` | sin cambio | Ver §11 |
| `AsignarPin` | sin cambio | — |

Garantías, heredadas del Engine y **no reimplementadas**:
- `baseRevision` obligatoria;
- stale (`BASE_REVISION_DESACTUALIZADA`, antes de clonar);
- dry-run (`proponer`);
- transacción atómica (`aplicarTransaccion`);
- `actor` validado (`agente | navegador`);
- reasons estructurados;
- **Path A:** una regla incompleta o con actuador inválido **hace commit** (representable blocking);
- **Path B:** la forma inválida (`null`, triada suelta, id inexistente, tipo desconocido) se **rechaza** sin mutar.

## 5. Validación semántica (HD-P3-5)

**Regla general, en una sola función del validador y sin `if pulsador`:**
- `entonces.actuador`, si está presente, tiene que referir un componente cuya **`ComponenteCatalogo.clase === "actuador"`**. Esa es la autoridad catalogal existente (`catalogo.ts:88`).
- Si no → **`ACTUADOR_INVALIDO`**: semántico, **blocking**, representable, `entidad` = la regla, `datos {componente, clase}`.
- **Sensor (corregido, R-2):** `cuando.sensor`, si está presente, tiene que tener declarada en su catálogo **la capacidad EXACTA que usa la regla** (`cuando.capacidad`). Si la capacidad todavía no está elegida, que tenga **alguna** capacidad legible por reglas. Si no → **`SENSOR_INVALIDO`** (blocking, representable). Se usa la misma autoridad (capacidad exacta) que ya aplica el núcleo en `validar-tecnico.ts:140` y `operaciones.ts:487`. **No es simétrico** con el actuador: la entrada del pulsador es `clase: "entrada"`, no `"sensor"` (`catalogo-datos.ts:58`); por eso el sensor se valida por capacidad y el actuador por clase.
- La coherencia capacidad ↔ sensor ya la valida hoy el Engine. No se crea el sistema de acciones por actuador (HD-P3-6).

**Documentos viejos** con un actuador inválido cargan con el blocking. No hay rechazo ni migración.

## 6. Autoridad del navegador

El navegador no escribe el IR, no inventa reglas, no decide compatibilidad ni es la fuente de verdad. Envía **operaciones** al mismo Engine por `POST /api/operaciones`.

**Whitelist explícita en el servidor** (`servidor-proyecto.ts`, junto a `forzarActorNavegador`): `AsignarPin`, `SetComportamiento`, `QuitarComportamiento`.

- Cualquier otro `tipo` → rechazo de transporte **`OPERACION_NO_PERMITIDA_EN_NAVEGADOR`**: HTTP 200 con `resultado.ok:false` y `rechazadoPor:"transporte"`. Sin invocar al Engine y sin persistir.
- La whitelist es política de superficie, no semántica. El Engine sigue validando todo.
- **Transacciones de UI:** una edición de la frase = **un** `SetComportamiento` con la regla entera = una revisión. Nunca varias operaciones sueltas por tecla (ver §7 y F-11).

## 7. Vista de frase semántica

**Proyección en el servidor** (`snapshot-a-vista.ts`): `ModeloDeVista.reglas[]` y `opcionesRegla`. **El browser no tiene tablas**; sólo pinta lo que recibe.

```text
reglas[i] = { id, frase: { sensor?: {id, etiqueta}, estado?: {clave:"presionado", etiqueta:"presionado"},
                           actuador?: {id, etiqueta}, salida?: {clave:"encendido", etiqueta:"encendido"} },
              completa: bool, faltan: [...], motivos: [...], traza?: {...} }
opcionesRegla = { sensores: [{id, etiqueta}], estados: [{clave:"presionado", etiqueta:"presionado"}],
                  actuadores: [{id, etiqueta}], salidas: [{clave:"encendido", etiqueta:"encendido"}] }
```

**De dónde sale cada selector:**
- **Sensores:** componentes cuyo catálogo declara la capacidad `estadoBooleano`.
- **Actuadores:** componentes con `clase: "actuador"`.
- **Etiquetas humanas:** `nombreVisible` del catálogo; con duplicados, se agrega un ordinal estable ("LED", "LED 2"), derivado en el servidor.
- **Nunca ids internos como texto primario.** El id es sólo el `value`.

**Render:**
> Mientras el **[Pulsador ▾]** esté **[presionado ▾]**, el **[LED ▾]** está **[encendido ▾]**.

El reposo (HD-P3D-1) **no se escribe como "si no, …"** en la frase: eso es isomorfo al `if/else` de runtime (F-15, F-RDP-03). Se muestra **sólo** en el trazado (§9) como segundo estado ("Pulsador no presionado → el LED está apagado"). HD-P3D-9 decide si la frase lo menciona.

**Estados de la frase:**
- **Incompleta:** los slots vacíos se muestran como "[elegí…]"; motivo `COMPORTAMIENTO_INCOMPLETO` con el texto llano "A la regla le falta: ¿qué entrada?" (según `faltan`).
- **Blocking:** la frase se resalta con `data-afectado` (el mecanismo del Slice 2) y el motivo se explica.
- **Explicación:** tabla determinista (§12).

**Edición:**
- Cada cambio de selector arma la regla completa (los valores actuales más el nuevo) y envía **un** `SetComportamiento` con la `baseRevision` del último snapshot.
- **Mientras una operación está pendiente, los selectores de la FRASE quedan deshabilitados.** Así se evita la ráfaga de stale de F-11 en la frase y se conserva el foco. Es una garantía **de la UI**: la exclusión real entre pestañas la da el stale del Engine (CAS global, `motor.ts:561`). Los selectores **de GPIO** existentes (Slice 2) quedan fuera de este vertical y se tratan en la Wave 0 (HD-P3D-7, F-RDP-01).

**Crear y eliminar:**
- Botón "Agregar regla" → muestra la frase con los selectores vacíos. **No crea nada.** La regla nace con el **primer** selector elegido (un `SetComportamiento` con ese único slot; id asignado por el Engine, `operaciones.ts:507-514`). Antes de esa elección no existe regla ni borrador; la frase vacía es la presentación de una acción disponible, no un estado (R-1).
- Botón "Quitar regla" → `QuitarComportamiento`.
- La creación queda limitada a **una regla** en la UI de este vertical (HD-P3-9 diferido; el Engine no limita).
- **Si el documento trae más de una regla** (otro canal, edición a mano): la vista **las muestra todas** como frases de solo lectura o editables, cada una con su "Quitar", y agrega un aviso de presentación "Hay varias reglas: la herramienta todavía no analiza si se contradicen". Ninguna regla del IR queda invisible (RD-3); el aviso no es un motivo del Engine.

## 8. Proyección determinista del estado

| IR (`cuando` sobre una capacidad `estadoBooleano`) | Frase |
|---|---|
| `capacidad:"estadoBooleano", comparador:">=", umbral:{valor:1, unidad:"ninguna", magnitud:"estadoBooleano"}` | "presionado" |
| cualquier otra combinación sobre `estadoBooleano` | "**condición avanzada**" (se muestra la regla sin frase editable, con código visible) |

- **Inversa** (frase → IR): "presionado" ↦ exactamente la tripleta de arriba. **No es una biyección** (R-4): el mapeo es **uno a uno sólo para "presionado"**, y el resto (muchos → uno) cae en "condición avanzada", no invertible.
- **Volver de "condición avanzada":** la frase muestra el selector de estado con "presionado" y un texto ("esta regla usa una condición que la frase no puede mostrar; si elegís 'presionado', la reemplazás"). Elegirlo envía `SetComportamiento` con la tripleta canónica: una edición explícita del alumno, nunca silenciosa.
- **Límites documentados:** `>= 1` describe un **nivel** ("está presionado"), **no** el evento "se presionó". La proyección no afirma equivalencia con un evento.
- Sin LLM. La tabla vive en el servidor, junto a `explicaciones-motivos.ts`.

## 9. Vista de trazado (HD-P3-8 = B)

- **A pedido:** "¿Qué pasaría si…?", junto a la frase completa.
- **Muestra las dos ramas, derivadas de la regla**, no ejecutadas:
  - "Si el Pulsador **está presionado** → la condición es **verdadera** → el LED **está encendido**."
  - "Si el Pulsador **no está presionado** → la condición es **falsa** → el LED **está apagado** (reposo)."
- **Etiqueta fija:** "Explicación de la regla — no es una simulación ni lo que pasa en la placa."
- No hay tiempo, animación, eventos Wokwi ni valores "actuales".
- Es una función pura de la regla en el servidor (`traza` en `reglas[i]`). Una regla incompleta no tiene traza.
- **Caso degenerado** (R-5): `accion: "apagar"` con reposo apagado (sólo por otro canal; la frase no ofrece `apagar`): los dos estados dan "apagado" y la traza lo dice explícitamente ("esta regla no cambia nada visible").

## 10. Eliminación: `QuitarComportamiento`

| Caso | Resultado |
|---|---|
| Regla existente | se quita; revisión +1; persiste; SSE |
| Id inexistente | rechazo `REFERENCIA_INEXISTENTE` (Path B), sin mutación |
| Stale | `BASE_REVISION_DESACTUALIZADA` |
| Dry-run | `proponer` muestra el resultado sin mutar |
| En transacción | atómica con otras operaciones |
| Referencias | quitar una regla libera a sus componentes (`QuitarComponente` vuelve a estar permitido) |
| Undo/redo futuro | la operación es invertible con `SetComportamiento` de la regla previa. El resultado del Engine debe incluir `datos.reglaQuitada` (la regla completa) para que un undo futuro no requiera leer el historial |

## 11. Relación con la eliminación de componentes

| Opción | Efecto | Veredicto |
|---|---|---|
| **A** Impedir quitar un componente referenciado | rechazo explicado: "Este pulsador lo usa una regla. Quitá o cambiá la regla primero." | **recomendada**: es el comportamiento actual; nunca borra una decisión del alumno |
| B Permitir y dejar la regla incompleta (vaciar ese slot) | una mutación implícita de la regla del alumno, aunque quede representable | viable con §3; necesita un motivo explícito. **HD-P3D-4** |
| C Cascada | borra la regla | **descartada** (destrucción silenciosa) |

## 12. Reason codes

| Código | Categoría | Severidad | Clasificación | Texto llano (§3.4 del Slice 2) |
|---|---|---|---|---|
| `COMPORTAMIENTO_INCOMPLETO` | semántico | blocking | representable | "A la regla le falta: {faltan→humano}." |
| `ACTUADOR_INVALIDO` | semántico | blocking | representable | "{componente} no es una salida: la regla no puede encenderlo. Elegí una salida." (sin interpolar `clase`, F-RDP-05) |
| `SENSOR_INVALIDO` | semántico | blocking | representable | "{componente} no entrega un estado que la regla pueda leer. Elegí una entrada." |
| `REFERENCIA_INEXISTENTE` (reuso) | estructural | blocking | rechazo | sin cambio |
| `REMOCION_CON_DEPENDIENTES` (reuso) | estructural | blocking | rechazo | **texto nuevo**: "Este componente lo usa una regla. Quitá o cambiá la regla primero." |
| `OPERACION_NO_PERMITIDA_EN_NAVEGADOR` | transporte | — | rechazo | (no se muestra al alumno; es un error de integración) |

- Eléctricos: los de Phase 2, sin cambios.
- Pedagógicos: ninguno nuevo (el trazado no es un motivo).
- La explicación es determinista; un LLM puede, más adelante, reformular, pero **nunca** es la fuente de la causa.

## 13. Revisión / SSE

1. Selector → `POST /api/operaciones { tipo: SetComportamiento, baseRevision: N, payload }`.
2. Whitelist (§6) → `forzarActorNavegador` → `servicio.aplicar`.
3. Engine: forma (§3) → validación (§5, §3) → commit **o** rechazo.
4. Revisión N+1 → persistencia (antes del swap) → SSE `revision`.
5. Todas las pestañas: refetch del snapshot → proyección (`reglas`, `opcionesRegla`) → repintado.

No hay segunda autoridad ni estado optimista: la UI re-habilita los selectores sólo con el snapshot nuevo.

## 14. Adaptador Blockly futuro (sin implementar)

- `reglas[i].frase` + `opcionesRegla` = **exactamente** la información de dos bloques: "mientras [sensor] esté [estado]" y "[actuador] está [salida]".
- El adaptador futuro **consume la misma proyección** y **emite las mismas operaciones** (`SetComportamiento` / `QuitarComportamiento`).
- Los slots vacíos (§3) son representables en el IR. **Para Blockly** (F-RDP-04): un `field_dropdown` nativo no tiene "sin elegir". La proyección publica, por slot, `{ slot: "sensor"|"estado"|"actuador"|"salida", valor?: {id|clave, etiqueta}, opciones: [...] }`, con **ids de slot estables y orden fijo**. El adaptador futuro elige entre una opción centinela de presentación ("— elegí —") o inputs con shadow blocks; esa elección no toca el IR ni esta proyección.
- El workspace de Blockly **nunca** es estado canónico: se reconstruye desde el IR. Hace falta un test de ida y vuelta: IR → bloques → operaciones → IR idéntico.
- Nada del IR de este vertical depende de conceptos de Blockly.

## 15. Contrato pedagógico

Al terminar el vertical, el alumno puede:

| Capacidad | Superficie |
|---|---|
| Identificar Entrada y Salida | rótulos del Slice 2 |
| Construir la relación | frase con selectores |
| Predecir el nivel ("¿y al soltar?") | frase + trazado (dos estados) |
| Modificarla | cambiar un selector |
| Romperla | vaciar un slot → `COMPORTAMIENTO_INCOMPLETO`; querer quitar el pulsador usado por la regla → `REMOCION_CON_DEPENDIENTES` explicado. (`ACTUADOR_INVALIDO` **no se alcanza desde la UI**, porque los selectores filtran por clase; se prueba a nivel Engine/HTTP y con documentos viejos, F-RDP-02) |
| Entender el error | texto llano + resaltado |
| Corregirla | elegir otra opción |
| Eliminarla | "Quitar regla" |
| Recargarla | recarga o reinicio |

No se mide "le gustó".

## 16. Prueba humana REAL (protocolo posterior)

- Se distingue de SIMULATED_ROLE_TRIAL en el encabezado, en el registro y en las conclusiones.
- Preguntas no inductivas. "Mientras" **no** se nombra hasta que el alumno lo use o hasta la fase final de indagación (F-RDP-06):
  - "¿Qué pensás que hace esto?"
  - "¿Cómo harías para que el LED dependa del pulsador?"
  - "¿Qué cambiarías para que deje de hacerlo?"
  - "Leé la frase en voz alta: ¿qué entendés?"
  - "¿Qué pasa con el LED cuando soltás?"
  - "¿El LED se fija una vez o está pendiente todo el tiempo?" (distingue un modelo de estado de uno de pasos/if).
  - Sobre el trazado: "¿Esto que muestra, pasó en la placa?" (percepción de simulación, F-RDP-07).
  - "Ese cartel, ¿qué te dice?"
- Registrar el lenguaje espontáneo, textual: cuando / si / mientras / al apretar.
- Con consentimiento, sin datos personales, cualitativo y sin score.
- Además, las preguntas de §6 de `PHASE_2_SIMULATED_ROLE_TRIAL.md`.

## 17. Test de aceptación (E2E futuro)

1. Proyecto ESP32 + LED + pulsador.
2. "Agregar regla" + elegir sólo **[Pulsador]** → la regla nace con un slot → `COMPORTAMIENTO_INCOMPLETO` (faltan estado, actuador y salida), `listo:false`.
3. Persiste.
4. Recarga → la misma regla incompleta (sólo el sensor).
5. Completar slot por slot (4 `SetComportamiento`, revisión +1 cada uno) → la frase completa se muestra, sin códigos.
6. La frase dice "Mientras el Pulsador esté presionado, el LED está encendido.", sin "si no".
7. Documento o POST con el pulsador como actuador (no llega desde los selectores) → `ACTUADOR_INVALIDO` visible y resaltado al recargar; desde la UI, vaciar un slot → `COMPORTAMIENTO_INCOMPLETO`.
8. Corregir → el motivo desaparece.
9. Operación con `baseRevision` vieja → stale, sin cambios en la vista.
10. Dry-run (`proponer`) de `QuitarComportamiento` → nada muta.
11. "Quitar regla" → la regla desaparece.
12. Recargar → sin regla.
13. Segunda pestaña → sigue todo por SSE.
14. `POST` con `AgregarComponente`/`SetPlaca` desde el navegador → `OPERACION_NO_PERMITIDA_EN_NAVEGADOR`, y el IR queda intacto (sin escritura directa).
15. Guardas: ninguna cadena `loop`/`delay`/`millis`/`digitalRead` en la vista ni en los textos; ningún listener `button-press`; el trazado etiquetado como "no es una simulación".

## 18. Non-goals

- Blockly productivo; C++; codegen; PlatformIO nuevo; ejecución en placa.
- Simulación física del pulsador; eventos Wokwi como disparadores; semántica de evento o latch.
- Múltiples reglas simultáneas y resolución de conflictos.
- Catálogo general de acciones por actuador.
- Colaboración multiusuario; CRDT/OT.
- `SetComportamiento` en `proyecto-fisico` (HD-P3-7).

## 19. Mapa de impacto por archivo

**EXPECTED TO CHANGE:**

| Archivo | Por qué (autorización) |
|---|---|
| `opencode/nucleo/ir.ts` | slots opcionales (§3), HD-P3-1; **documentación normativa** en `EntoncesComportamiento.accion`: "estado sostenido mientras la condición de nivel es verdadera", más el reposo (HD-P3D-1), para que la semántica NIVEL no viva sólo en prosa (R-3) |
| `opencode/nucleo/operaciones.ts` | `SetComportamiento` con forma parcial + `QuitarComportamiento` (§4, §10), HD-P3-1/3 |
| `opencode/nucleo/cargador.ts` | carga de reglas parciales con la MISMA validación (§3), HD-P3-1 |
| `opencode/nucleo/validar-tecnico.ts` (o un validador de comportamientos) | `COMPORTAMIENTO_INCOMPLETO`, `ACTUADOR_INVALIDO`, `SENSOR_INVALIDO` (§5), HD-P3-1/5 |
| `opencode/nucleo/motor.ts` | sólo si `QuitarComportamiento` necesita registrarse en el dispatcher (probable: no) |
| `opencode/servidor/servidor-proyecto.ts` | whitelist del navegador (§6), HD-P3-7 |
| `opencode/vista-fisica/{modelo-vista.ts, snapshot-a-vista.ts, explicaciones-motivos.ts}` | proyección de `reglas`, `opcionesRegla`, traza y textos (§7-§9, §12) |
| `opencode/vista-fisica/web/{app.js, plan-de-pintado.js, pintar.js, index.html}` | frase, selectores deshabilitados mientras hay una operación pendiente, trazado |
| `tests/phase3-*.test.mjs` | nuevos (§20) |
| `docs/programacion-intencion/{IR-SPEC, OPERATIONS, DECISIONS, COMPONENT-CATALOG}.md` | contratos nuevos |

**EXPECTED NOT TO CHANGE:**
- `opencode/tool/proyecto-fisico.ts`
- `opencode/tool/circuito.ts`, `platformio.ts`
- `catalogo-datos.ts` (se usa `clase` y `capacidades` existentes)
- instaladores, `package.json`/lock
- `tests/nucleo-*` (Phase 1): **ver §21**; si alguno fija la forma completa obligatoria, eso es HD.

## 20. Plan de tests (test-first obligatorio)

- **RED real ANTES de tocar código**, en commits separados.
- Un writer que escriba tests después de implementar incumple la tarea (lección de W-S2-TOOL). El gate lo verifica comparando el commit RED con el código.

| Nivel | Qué se prueba |
|---|---|
| Unit | función de validez estructural (clave ausente vs `null`, triada atómica); proyección `>= 1` ↔ "presionado"; etiquetas con duplicados; traza |
| Contract | forma de `SetComportamiento` parcial; `QuitarComportamiento`; códigos y `datos` |
| Engine | Path A (incompleta y actuador inválido hacen commit); Path B (`null`, triada suelta, id inexistente); stale; dry-run; atomicidad; `REMOCION_CON_DEPENDIENTES` |
| Persistencia | PERSISTIBLE ⇒ RECARGABLE para cada estado incompleto; documentos viejos sin cambio (golden) |
| HTTP | whitelist (3 tipos permitidos; los demás → `OPERACION_NO_PERMITIDA_EN_NAVEGADOR` sin tocar el Engine) |
| SSE | 2 pestañas |
| Browser (CDP) | recorrido §17; selectores deshabilitados mientras hay una operación pendiente (regresión de F-11: tecleo rápido → **una** revisión, sin stale falso) |
| Guardas | escaneo de `web/*.js` sin tablas de clase/capacidad/estado; sin `loop`/`delay`/`millis`; E3-04b |
| Windows | corrida corta (instalado + frase + recarga) |
| Adversarial | red team: autoridad (whitelist, bypass), semántica (nivel/evento, incompletos), pedagogía |

## 21. Migración y compatibilidad

- **Lectura hacia atrás:** todo documento de Phase 1/2 (reglas completas o sin reglas) carga igual: la forma nueva es un superconjunto.
- **Hacia adelante:** un documento con reglas incompletas no carga en productos anteriores (su cargador exige la forma completa).
  - Propuesta: subir `schemaVersion` sólo cuando el documento **contiene** una regla incompleta, o subirla siempre (HD-P3D-3).
  - Nunca se "completa" ni se descarta en silencio.
- **Sin migración destructiva.** Los documentos con un actuador de clase inválida cargan con `ACTUADOR_INVALIDO` blocking.
- **Tests de Phase 1:** si alguno de `tests/nucleo-*` exige hoy el rechazo de una regla incompleta, ese test **contradice** HD-P3-1 = B. Tocarlo requiere una decisión humana explícita (HD-P3D-6). El writer no puede tocarlo por su cuenta.

## 22. Riesgos

| Riesgo | Mitigación |
|---|---|
| Confundir NIVEL con EVENTO | "mientras" en la frase, el código y los textos; trazado con los dos estados; §8 documenta que `>= 1` no es evento |
| Confundir NIVEL con procedimiento (`if/else` en `loop`) | sin "si no" en la frase; el trazado habla de **estados**, no de pasos; una pregunta del protocolo real que distinga ambos modelos (§16) |
| Frase bonita pero semánticamente falsa | la proyección es una biyección acotada (§8); lo no representable → "condición avanzada" |
| Browser como verdad paralela | proyección en el servidor; whitelist; sin estado optimista |
| Lógica incompleta irrecargable | una sola función de validez para la operación y el cargador; golden tests |
| Cascada destructiva | §11-A |
| Validación del actuador hardcodeada | se deriva de `clase` del catálogo, sin nombres de tipo |
| Ids internos expuestos | etiquetas derivadas; el id sólo como `value` |
| Texto de reason engañoso | tabla determinista revisada por el humano (como R-4) |
| Blockly condicionando el IR | §14: el IR no conoce Blockly |
| (del trial) El agente contradice la vista | fuera de este vertical, ver HD-P3D-7 |

## 23. HUMAN_DECISION_REQUIRED

(Actualizado tras el red review; ver §24.)

| ID | Decisión | Opciones | Recomendación |
|---|---|---|---|
| **HD-P3D-1** | Estado de reposo cuando la condición de nivel es falsa (F-14) | A) reposo = apagado para actuadores digitales, documentado en IR-SPEC · B) reposo indefinido (la frase no dice qué pasa al soltar) | **A** |
| HD-P3D-2 | `apagar` en la frase | A) no se ofrece en este vertical · B) se ofrece | A |
| HD-P3D-3 | `schemaVersion` con reglas incompletas | A) subir siempre · B) subir sólo si el documento contiene una regla incompleta | B (menor impacto) |
| HD-P3D-4 | Quitar un componente referenciado | A) impedir con un texto nuevo (actual) · B) permitir y vaciar el slot con un motivo | A |
| HD-P3D-5 | Renombrar `cuando` en el IR | A) no, se documenta · B) renombrar (schema) | A |
| HD-P3D-6 | Tests de Phase 1 y reglas incompletas | **Resuelto por diseño** (R-1): sólo `tests/nucleo-operaciones.test.mjs:778` fija un rechazo (la regla vacía), y el diseño lo **respeta** (§3 regla 4, §7). Ningún test de Phase 1 se toca. Si un writer encuentra otra contradicción → STOP | — |
| **HD-P3D-7** | Hallazgos del trial ajenos a este vertical, pero que lo condicionan (F-03/04/05/06/07/11/13/15: el agente no llega a la vista, el circuito legado simula el botón, afirmaciones falsas, falta de vocabulario en la tool, el stale falso por tecleo, pines incoherentes, salto a C++) | A) "Wave 0" de correcciones del producto antes de Phase 3 · B) incorporarlas al vertical · C) backlog | **A**: sin eso, el vertical es inalcanzable por el flujo natural |
| HD-P3D-8 | F-01 (clave inválida) y F-02 (perfil de la máquina aplicado al alumno) | A) backlog de producto · B) incluir en la Wave 0 | A |
| **HD-P3D-9** | ¿La frase menciona el reposo? | A) no; el reposo aparece sólo en el trazado · B) "(si no, apagado)" en la frase (riesgo if/else, F-RDP-03) | **A** |
| **HD-P3D-10** | `QuitarComportamiento` para el agente (`proyecto-fisico` R-6) | A) excluido, **decisión registrada** (simétrico a HD-P3-7) · B) incluirlo | A (RD-2: hoy quedaría excluido por omisión, no por decisión) |

## 24. Red review del DESIGN (incorporado)

Revisores nuevos y read-only. Informes en el scratchpad `phase3/RED-DESIGN-*/INFORME.md`.

| ID | Sev. | Hallazgo | Incorporado en |
|---|---|---|---|
| R-1 (SEMANTICS) | CRITICAL | La regla vacía `{}` contradecía `tests/nucleo-operaciones.test.mjs:778` (Phase 1) | §3 regla 4, §7, HD-P3D-6: la regla nace con un slot; Phase 1 intacto |
| RD-1 (AUTHORITY) | CRITICAL | Los sitios que desreferencian `cuando`/`entonces` sin guarda (`cargador.ts:222-228`, `aplicarSetComportamiento`) habrían dejado el proyecto irrecargable | §3 (inventario obligatorio de sitios + RED por sitio) |
| R-2 | MAJOR | `SENSOR_INVALIDO` por `capacidades.length > 0` no era la misma autoridad ni simétrico | §5: capacidad exacta |
| R-3 | MAJOR | La semántica NIVEL no estaba anclada en `ir.ts` | §19 (documentación normativa en `ir.ts`) |
| R-4 | MAJOR | "biyección" falsa; sin camino de vuelta desde "condición avanzada" | §8 |
| RD-2 | MAJOR | `QuitarComportamiento` excluido del agente por omisión | HD-P3D-10 |
| RD-3 | MAJOR | Varias reglas en el documento: el render no estaba definido (regla invisible) | §7 |
| F-RDP-01 | MAJOR | Contradicción §7 vs HD-P3D-7 sobre F-11 | §7 (frase vs selectores GPIO) |
| F-RDP-02 | MAJOR | `ACTUADOR_INVALIDO` inalcanzable desde la UI, aunque §15/§17 lo usaban | §15, §17 |
| F-RDP-03 | MAJOR | "(si no, apagado)" ≅ `if/else` de runtime | §7, §15, §22, HD-P3D-9 |
| F-RDP-04 | MAJOR | Blockly no representa "sin elegir" | §14 |
| F-RDP-05/06/07, R-5 | MINOR/NOTE | `clase` crudo en un texto; pregunta inductiva; sin pregunta sobre simulación; traza degenerada | §12, §16, §9 |
| F-RDP-08 | NOTE | Sensores de otra magnitud → "condición avanzada" | cubierto por §8 (sin cambio) |

Verificado sin hallazgo (AUTHORITY):
- el endpoint del navegador sólo usa `servicio.aplicar` (no hay lotes ni otros endpoints de mutación);
- el stale es un CAS global (`motor.ts:561`);
- el Engine ya asigna id en `SetComportamiento` (`operaciones.ts:507-514`);
- `datos.reglaQuitada` cabe en `Motivo` (precedente `COMPORTAMIENTO_REEMPLAZADO`).
