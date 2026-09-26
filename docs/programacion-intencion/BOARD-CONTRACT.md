# BOARD-CONTRACT.md — contrato mínimo de placa (OD-01, Gate 1)

Implementación: `opencode/nucleo/placas.ts`. Tests: `tests/nucleo-placas.test.mjs`.
Diseño fuente: `T_diseno_consolidado.md` §3 (agente B, `B_board_design.md`, reconciliación
R5 del orquestador). Decisión registrada en `DECISIONS.md` (entrada OD-01).

## 1. Propósito y alcance

Este contrato resuelve **una sola cosa**: qué es una placa para el núcleo de
"Programación por Intención" — su identidad semántica estable, sus pines, sus
capacidades eléctricas y sus restricciones — separado de cómo se dibuja y de cómo se
redacta el rechazo en español.

**Lo que NO resuelve:**

- El catálogo de *componentes* (LED, sensores, resistencias) — eso es
  `opencode/nucleo/catalogo.ts` (Gate 3), un archivo distinto.
- No reemplaza `circuito.ts` en Fase 1. `circuito.ts` sigue siendo el único motor real
  de generación de HTML/Wokwi; este contrato no se conecta a él todavía (Fase 2+).
- No reemplaza ni deriva `pinouts.json` — ver §5.

## 2. Identidad semántica

Cada placa tiene un `id` **kebab-case ASCII, estable, nunca reutilizado**:
`esp32-devkit-v1`, `arduino-uno`. No es un concepto traducible (es un nombre de
modelo, no una palabra del dominio) — queda igual en cualquier idioma del contrato.

`schemaVersion` es del **registro de placa**, un concepto distinto del `schemaVersion`
de la IR de proyecto (Gate 2): versiona la FORMA del dato de placa en sí, no un
proyecto guardado.

## 3. Aliases

- Normalización antes de comparar: NFD (descompone tildes) → strip de marcas
  combinantes → trim → colapsar espacios múltiples a uno → lowercase
  (`normalizarAlias()`).
- Un alias resuelve a **exactamente un** `id`, o produce un motivo estructurado
  (`PLACA_DESCONOCIDA` / `PLACA_ALIAS_AMBIGUA` / `PLACA_CONOCIDA_NO_SOPORTADA`). Nunca
  fuzzy, nunca substring, nunca "el primero que matchea".
- Los aliases son **datos** del registro (`Placa.alias: string[]`), no lógica ni un
  índice aparte — para 2 placas sin variantes, un índice separado anticiparía un
  problema que no existe todavía (mismo criterio YAGNI que usa R1 en la dirección
  contraria para `comportamientos`).

## 4. Backend identifiers

- `backends.platformio.{board,platform,framework}` — lo que el binario `pio` necesita
  literalmente en `platformio.ini` (evidencia: `ejemplos/blink-esp32/platformio.ini`,
  `ejemplos/blink-uno/platformio.ini`).
- `backends.wokwi.elemento` — el custom element del bundle Wokwi, como **dato**, nunca
  como método (`circuito.ts:640,696`).
- **Regla explícita:** un backend id (`board=` de PlatformIO, elemento de Wokwi)
  **nunca** resuelve implícitamente al `id` semántico. Sólo resuelve si está declarado
  explícitamente en `alias[]` de ese registro — y hoy, en el registro por defecto, NO
  lo está (ver los tests `platformio-id-no-es-semantico` / `wokwi-id-no-es-semantico`).
  Razón: hoy `PlacaId:"uno"` (circuito.ts) y `board:"uno"` (PlatformIO) coinciden por
  casualidad de nomenclatura entre autores, no por diseño — tratar "todo backend id es
  alias válido" perpetuaría esa coincidencia como regla implícita.

## 5. Relación con pinouts.json

`pinouts.json` sigue siendo la fuente canónica de proyectos INET (1/15 proyectos
poblado, `01-semaforizacion`) y **no se modifica ni se deriva** de él. El registro de
placa nuevo tampoco lo reemplaza.

Se agrega un test de **adaptador** (no de schema): `adapter-pinouts-json-esp32-semaforo`
en `tests/nucleo-placas.test.mjs` verifica que GPIO16/GPIO17/GPIO18 —los pines que
`pinouts.json["01-semaforizacion"].esp32.inicial` pide a mano— existen en el registro
`esp32-devkit-v1` y son asignables como salida digital, **aun cuando NO están en el pool
automático** (`POOL_DIGITAL` los saltea a propósito, `circuito.ts:422-426`). Ese test
COMPARA contra el JSON real, no copia sus valores.

## 6. Compatibilidad con circuito.ts

Se extrae SOLO la capa 1 (hardware puro: pools, capacidades, restricciones, `adcMax`,
i2c) + una referencia opaca a la capa 2 (backend Wokwi, como dato). **NO se extraen**:
`escala`/`anchoColumna` (layout CSS), `resistenciaLed` (dato de componente, no de
placa), ni los métodos `pinWokwi()`/`rielWokwi()`/`motivoRechazo()`/`notaDePin()` (son
capa de render/prosa, fuera del contrato).

El test `compatibilidad-con-placas-actuales` importa `circuito.ts` dinámicamente (mismo
patrón mock que `tests/circuito.test.mjs`) y compara, pin a pin, contra
`PLACAS`/`POOL_DIGITAL`/`GPIO_FLASH`/`GPIO_STRAPPING`/`GPIO_SOLO_ENTRADA`/
`GPIO_UART_USB` reales — si `circuito.ts` cambia sin actualizar el registro nuevo (o
viceversa), el test se pone rojo. `circuito.ts` **no se toca** (prohibido en Fase 1).

## 7. Reglas de resolución

1. Normalizar la entrada (`normalizarAlias`).
2. Buscar match exacto contra los aliases normalizados de cada placa del registro.
3. 0 matches → placas conocidas-no-soportadas (§9) → si tampoco matchea, `PLACA_DESCONOCIDA`.
4. 1 match → `{ ok: true, id }`.
5. 2+ matches → `PLACA_ALIAS_AMBIGUA` con la lista COMPLETA de candidatos, nunca el
   primero.

## 8. Errores (vocabulario de reasons)

| Código | Motivo | Categoría | Clasificación |
|---|---|---|---|
| `PLACA_DESCONOCIDA` | alias no declarado en ningún registro, ni siquiera en el de no-soportadas | `operacion` | `rechazo` |
| `PLACA_ALIAS_AMBIGUA` | alias matchea 2+ ids | `operacion` | `rechazo` |
| `PLACA_CONOCIDA_NO_SOPORTADA` | placa documentada (skill `placas`) pero fuera del set mínimo de Fase 1 | `operacion` | `rechazo` |

Estos tres códigos son el mismo vocabulario que va a reutilizar `operaciones.ts` (Gate
5) al rechazar un `SetPlaca` — placas.ts no conoce "operaciones", pero el código y la
forma del motivo (`Motivo` de `opencode/nucleo/motivos.ts`) ya son los definitivos, para
no reinventar el vocabulario cuando se conecte.

## 9. Placa desconocida vs. placa no soportada

- **Desconocida**: no está en ningún catálogo, ni siquiera en la lista de
  no-soportadas (`PLACAS_NO_SOPORTADAS`). Ejemplo: `"Placa Mágica 3000"`.
- **No soportada**: está documentada (`skills/placas/SKILL.md`) pero fuera del set
  mínimo de Fase 1. Fase 1 shippea un solo caso con evidencia real: ESP8266
  (NodeMCU/Wemos D1 mini, `skills/placas/SKILL.md:248-274`) — deferida explícitamente
  por decisión del orquestador. No lleva pools de pines (agregarlos ahora sería
  inventar datos de hardware que hoy sólo existen como prosa Markdown), sólo el
  nombre y los aliases suficientes para distinguir el caso.

## 10. Cómo se preserva el conocimiento existente

- **De `circuito.ts`** (capa 1, pin a pin): `POOL_DIGITAL`/`POOL_ANALOGICO` (líneas
  329-330), `GPIO_VALIDOS`/`GPIO_FLASH`/`GPIO_STRAPPING`/`GPIO_SOLO_ENTRADA`/
  `GPIO_UART_USB` (líneas 334-348), `UNO_POOL_DIGITAL`/`UNO_POOL_PWM`/
  `UNO_POOL_ANALOGICO` (líneas 358-365), `adcMax`/`i2c`/`riel` de `PLACAS.esp32` y
  `PLACAS.uno` (líneas 636-764), y las etiquetas alternativas RX2/TX2/VP/VN
  (`ESP32_WOKWI_PIN`, líneas 624-631).
- **De `ejemplos/*/platformio.ini`**: `backends.platformio.{board,platform,framework}`
  para las dos placas (`blink-esp32/platformio.ini`, `blink-uno/platformio.ini`).
- **De `skills/placas/SKILL.md`**: el estado "no soportada" de ESP8266 (líneas
  248-274) y los alias humanos usados en prosa para UNO/ESP32.
- **De `pinouts.json`**: sólo como test de adaptador (§5), nunca copiado como dato de
  catálogo.
- **Qué NO se copia y por qué**: `escala`/`anchoColumna` (layout CSS, no identidad de
  placa), `resistenciaLed` (dato de componente LED, ya vive en `pinouts.json` con su
  propio test anti-drift, `resistencia-led.test.mjs` — meterlo acá lo duplicaría una
  tercera vez), y los métodos de prosa (`motivoRechazo`/`notaDePin`/`pinWokwi`/
  `rielWokwi`) — son responsabilidad de una capa de presentación futura que traduzca
  los códigos de motivo, no del catálogo de datos.
