# Phase 3 — Pre-Human-Test Hardening: diseño

**Estado: APPROVED_FROM_HUMAN_DECISIONS** (HD-W0-A = SÍ, HD-W0-B = SERIE VISIBLE, HD-W0-C = MINOR/BACKLOG).
Esto NO es implementación de Phase 3: no cambia la semántica de comportamiento, no hay Blockly, no hay lógica pulsador→LED y no hay codegen nuevo.

- Base: main `ff8342c` (producto Wave 0 `c092bce`, árbol `2598481`, más el MERGE_REPORT docs-only).
- Discovery READ-ONLY: EXP-A, EXP-B y EXP-C. El orquestador verificó en el código cada conclusión que usa este documento (sección 5).

## 1. HD-W0-A: un terminal no asignable rechaza `AsignarPin`

| | |
|---|---|
| **Causa** | `aplicarAsignarPin` (`nucleo/operaciones.ts:381-400`) valida que el terminal esté declarado y que el pin exista en la placa, pero no si el catálogo lo declara asignable. El validador salta `riel-fijo` a propósito (`validar-tecnico.ts:77`), así que la asignación se persiste sin motivo y la vista la ignora (W0-T5-1, F-TRUTH-1). |
| **Invariancia** | `AsignarPin` sobre un terminal cuyo catálogo lo declara no asignable → **rechazo (Camino B)**: IR canónica sin cambios, `revision` sin cambios, motivo estructurado y explicación pedagógica separada. |
| **Fuente de "asignable"** | El catálogo: `Terminal.electrica !== "riel-fijo"`. Es la misma derivación que ya usan `terminalesNoRielFijo` (`operaciones.ts:101`) y `vista-fisica/vocabulario.ts` (campo `asignable`). **Nunca** se mira el tipo ni el id del componente (nada de `"resistencia"`). |
| **Dónde vive** | En la **operación**, `aplicarAsignarPin`, justo después de `TERMINAL_NO_DECLARADO` y antes de `PIN_INEXISTENTE_EN_PLACA`. NO va en el validador (que es Camino A) ni en el loader. |
| **Reason code** | `TERMINAL_NO_ASIGNABLE`, hermano de `TERMINAL_NO_DECLARADO` (misma función, misma forma). `categoria: "operacion"`, `severidad: "blocking"`, `clasificacion: "rechazo"`, `datos: { componente, terminal, electrica }`. Se documenta en `nucleo/motivos.ts` según la convención existente. |
| **Explicación pedagógica** | Una entrada en `vista-fisica/explicaciones-motivos.ts`, separada del código. Por ejemplo: "La {pieza} no se conecta directo a un pin de la placa: va en el medio del cable. Conectala a la pieza que la necesita." Usa `nombreDe` y nunca los ids crudos. |
| **pin `null`** | La decisión rechaza `AsignarPin` sobre un terminal no asignable **sin excepción**, incluido `pin: null`. **NOTE:** un documento histórico con un pin ya asignado ahí se corrige con `QuitarComponente` (y volviendo a agregar la pieza), no desasignando. Si el humano prefiere permitir `null` como limpieza, es un cambio de una línea, pero NO se decide acá. |
| **Carga (historia)** | El loader NO cambia. Un documento que ya tenga ese pin sigue cargando igual (PERSISTIBLE ⇒ RECARGABLE). La invariancia gobierna sólo la operación NUEVA. No hay migración silenciosa. FX-6(b) (`descripcionPines` dice la verdad sobre el pin) sigue valiendo para esos documentos. |
| **Tool y navegador** | Sin cambios: los dos llaman al Engine en forma genérica y heredan el rechazo. |
| **Archivos esperados** | `nucleo/operaciones.ts`, `nucleo/motivos.ts`, `vista-fisica/explicaciones-motivos.ts`, el **nuevo** `tests/pht-engine.test.mjs`. Los tests de Wave 0 que hoy fijan la aceptación (`tests/wave0-tool.test.mjs` ~L498, el caso FX-6(b) que asigna un pin a la resistencia) cambian por contrato HD-W0-A: el caso pasa a construirse cargando un documento histórico. **`tests/nucleo-*` NO se tocan.** |
| **RED** | A1 asignable intacto · A2 no asignable → `ok:false` + `TERMINAL_NO_ASIGNABLE` · A3 IR igual (deep-equal) · A4 revision igual · A5 motivo con `categoria`/`clasificacion`/`datos` · A6 `proponer` (dry-run) y `aplicar` coinciden · A7 una transacción con [op válida, op inválida] → rollback atómico (ni la válida se aplica) · A8 persistir y recargar un proyecto válido sigue igual · A9 un documento histórico con pin en terminal riel-fijo carga y queda como está (documentado) · A10 la regla sale del catálogo: se prueba con un catálogo de test que tiene otro componente con un terminal riel-fijo sin destino (no "resistencia"). |
| **Aceptación** | A1–A10 en verde; la suite completa en verde; `tests/nucleo-*` sin diff; los únicos cambios en `nucleo/` son los de esta invariancia. |

## 2. HD-W0-B: la resistencia se ve en serie

| | |
|---|---|
| **Causa** | `proyectarVista` (`vista-fisica/snapshot-a-vista.ts:207-236`) arma los cables como aristas independientes: una por asignación (pin → terminal) y otra por `Conexion` (terminal ↔ terminal). Nunca mira el requisito `resistencia-serie`. Resultado: "GPIO18 → LED (ánodo)" y "LED (ánodo) → Resistencia (pata A)", con la pata B colgando. Además `wokwi-resistor` no está registrado (`wokwi-render-datos.ts:110-111`), así que la pieza no se dibuja. |
| **Modelo canónico (NO cambia)** | IR: `LED.pines.anodo = "GPIO18"`, más una `Conexion` `LED.anodo ↔ Resistencia.a`. La resistencia es el puente "en el medio del cable" (`catalogo-datos.ts:31-35`). |
| **Contrato visual** | Si (1) un terminal T de un componente C está asignado a un pin P, (2) el catálogo de C declara `resistencia-serie` con `enTerminal = T`, (3) existe **exactamente una** `Conexion` entre C.T y un componente R del tipo `spec.tipoComponente`, y (4) R no tiene otras conexiones, entonces la proyección muestra la cadena **P → R (pata libre) → R (pata conectada) → C (T)**. |
| **Texto esperado** | `GPIO18 (D18) → Resistencia (pata B)` · `Resistencia (pata A) → LED (ánodo (+))` · `LED (cátodo (−)) → GND`. La pata del lado del GPIO es la que en la IR está **libre**; la pata del lado del LED es la que la `Conexion` real une al ánodo. No se inventa ninguna conexión: el orden en serie es el significado del requisito `resistencia-serie`, y los datos (qué pata, qué terminal) salen de la IR. |
| **Fail-closed** | Si no hay coincidencia, o la coincidencia es ambigua (la resistencia está conectada a dos cosas, hay varias resistencias en el mismo terminal, o el terminal está sin asignar), la proyección queda como hoy. No se adivina. |
| **Pieza** | Se registra `resistencia → wokwi-resistor` en `wokwi-render-datos.ts`. El valor sale de `spec.ohmios` del requisito (220), no de JS. Verificado por EXP-B en Chromium: el elemento existe en el bundle, pinta `shadowRoot` y tiene pines `1`/`2`. |
| **Fuente de verdad** | Sólo IR + catálogo, en el servidor (`snapshot-a-vista.ts`, función pura). El JS del navegador sólo pinta lo que recibe: no tiene lógica física nueva ni duplica el catálogo. |
| **Múltiples componentes** | Cada LED se empareja con SU resistencia por la `Conexion` real; nunca se mezclan. |
| **Archivos esperados** | `vista-fisica/snapshot-a-vista.ts` (+ `modelo-vista.ts` si hace falta un campo), `vista-fisica/wokwi-render-datos.ts`, ajustes mínimos de render en `web/plan-de-pintado.js` y `web/pintar.js` sólo si la pieza nueva lo requiere, y el **nuevo** `tests/pht-view.test.mjs`. Los tests previos que fijen el cable "LED (ánodo) → Resistencia (pata A)" cambian por contrato HD-W0-B. |
| **RED (topológico, no geométrico)** | B1 en el proyecto canónico existe la pieza resistencia en la vista · B2 la cadena de cables es P → R(libre) y R(conectada) → C(T), sin arista directa P → C(T) · B3 ninguna arista nueva hacia una pata que la IR no conecta, salvo la pata libre del lado del pin; la cantidad de aristas es la misma · B4 los terminales usan etiquetas humanas · B5 dos LEDs con sus dos resistencias no se mezclan · B6 una resistencia conectada a dos LEDs → sin fusión (fail-closed) · B7 un LED sin resistencia → como hoy (con REQUISITO_INSATISFECHO) · B8 la proyección es determinista y no modifica la IR (la IR es deep-equal antes y después). |
| **Navegador** | Chromium real: se ven la pieza resistencia dibujada y los cables en serie; captura de pantalla. |
| **Criterio pedagógico** | Una persona que no conoce el modelo interno, mirando sólo la pantalla, entiende que "la corriente hacia el LED pasa por la resistencia". Si visualmente sigue pareciendo colgante → **FAIL**, aunque los tests estén en verde. |

## 3. HD-W0-C: ACCEPTED_MINOR_BACKLOG (NO implementar)
- "LED 2" → "LED" al borrar el primer LED se acepta como MINOR.
- **Condición a verificar:** el id interno (`cmp-N`) del LED que queda NO cambia al borrar el otro. Si cambiara, deja de ser MINOR → STOP.
- Backlog: nombres visibles estables y editables.

## 4. Riesgos conocidos (EXP-C) y su tratamiento
| Riesgo | Clase | Tratamiento |
|---|---|---|
| Fuga de razonamiento / system prompt al pedir código explícitamente | B | Modelo (Gemini Flash Lite), visible como texto (`a6`), con una frase copiada de `tecnia-bot.md:66`. R4: investigación READ-ONLY. Mitigación local propuesta (instrucción "no narres tu proceso ni cites tus reglas"), **sólo con checkpoint**. El protocolo humano la observa (H11) y no la oculta. |
| F-13 una sola pestaña | B | R1: prueba dirigida en Windows. |
| Desplegable abierto al repintar | C (nota B) | R2: reproducción dirigida. Si pierde un cambio en silencio y compromete la autoridad → STOP antes de la prueba humana. |
| Type-ahead "D19" | C | R3: confirmar. MINOR conocido. |
| F-02 perfil/memoria de la máquina | B | `perfil.ts:20` y `memoria.ts:16` leen `XDG_CONFIG_HOME`. Para la prueba humana hace falta un entorno aislado SIN borrar datos (un usuario de Windows separado, o `XDG_CONFIG_HOME` propio con su instalación). Si no se puede de forma segura → confound documentado + decisión humana antes de la prueba. |
| REQUISITO_INSATISFECHO con ids crudos | C | Backlog. HD-W0-B no lo cambia. |

## 5. Verificación del orquestador sobre el discovery
- EXP-A: lugar, helper, el salto del validador y los dos tests de Wave 0 que fijan la aceptación, **confirmados**. Corrección: los tests nuevos van en un archivo nuevo, NO dentro de `tests/nucleo-*`.
- EXP-B: la causa (`snapshot-a-vista.ts:207-236`) y la ausencia de `wokwi-resistor`, **confirmadas**. Corrección: el texto propuesto ("pata A" en los dos extremos) describía una resistencia por la que no pasa corriente; se reemplaza por pata libre → GPIO y pata conectada → LED.
- EXP-C: fuente de la fuga (parte `text`, frase de `tecnia-bot.md:66`), `XDG_CONFIG_HOME` e ids crudos en `explicaciones-motivos.ts:54-55`, **confirmados**.

## 6. Orden
W-PHT-ENGINE (HD-W0-A) → verificación independiente → W-PHT-VIEW (HD-W0-B) → verificación + navegador → gate integrado → Windows → smoke → R1–R4 → red team ×3 → como máximo 1 ronda de fixes → freeze pre-humano → protocolo de prueba humana → **STOP**.
