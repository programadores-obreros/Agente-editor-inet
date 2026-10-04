// ANEXO DE REPRESENTACIÓN — Component System Foundation #1 (D-09 del Decision Freeze).
// Wokwi es un RENDERER, nunca fuente de verdad semántica: nada de este archivo entra al
// hash semántico del catálogo ni lo lee el núcleo (`nucleo/`). Las claves son ids
// estables del núcleo (`componentType`, `terminalId`, id de placa). Antes vivía en
// `vista-fisica/wokwi-render-datos.ts` (que ahora sólo reexporta) y, para las placas,
// en `Placa.backends.wokwi` (dentro del catálogo hasheado).
//
// Datos presentacionales COPIADOS de `circuito.ts` — NUNCA importado (prohibido en
// Fase 1, reafirmado por PHASE_2_SLICE_1_DESIGN.md §2.6: "circuito.ts NO se
// modifica" / "no se importa en el runtime del adaptador nuevo", informe ARCH-C §0.3).
// Cada tabla cita su línea de origen. Mismo criterio que ya usa `nucleo/placas.ts`
// para `ESP32_POOL_DIGITAL`/`ESP32_GPIO_STRAPPING` (dato declarativo comparado, nunca
// un import en caliente).
//
// Verificado contra el volcado REAL del bundle (`docs/wokwi-pinout-dump.md`,
// extraído en Chrome desde `wokwi-bundle.js`, no una suposición):
// - `wokwi-led` expone los pines `A` (ánodo) y `C` (cátodo) — dump:79.
// - `wokwi-esp32-devkit-v1` nombra sus GPIO como `D<n>` (NO `GPIO<n>`) — dump:66-67,
//   consistente con `ESP32_WOKWI_PIN` de abajo.
// - Arduino UNO nombra sus digitales con el número PELADO (`"2"`, no `D2`) y sus
//   analógicos `A<n>` — dump:60/53-58. Fuera del fixture de este slice (ESP32+LED),
//   pero la tabla lo cubre para no dejar una trampa de "funciona sólo para ESP32".
//
// Revisión post red-team (Hallazgo B1, MAJOR, P2-RED-B/INFORME.md, ataque A1): el
// `<wokwi-esp32-devkit-v1>` REAL (instanciado con Chromium headless contra el bundle
// real del repo, `el.pinInfo`) tiene EXACTAMENTE 30 pines — `3V3, D12, D13, D14, D15,
// D18, D19, D2, D21, D22, D23, D25, D26, D27, D32, D33, D34, D35, D4, D5, EN, GND.1,
// GND.2, RX0, RX2, TX0, TX2, VIN, VN, VP`. Contra ESA lista real (no la documentación
// parcial de `docs/wokwi-pinout-dump.md`, truncada con "…"): GPIO1 es `TX0` (no
// `D1`) y GPIO3 es `RX0` (no `D3`) — el fallback `` `D${numero}` `` que este archivo
// tenía antes los mostraba MAL, no sólo con un hueco. Y GPIO0/6/7/8/9/10/11/37/38 NO
// EXISTEN como pin físico en absoluto en ese custom element — el fallback los
// inventaba como `D0`/`D6`.../`D37`/`D38`, nombres que un estudiante podía intentar
// cablear y que no corresponden a NADA dibujado. Ver
// `.../scratchpad/phase2/RED-B/pinout-check/` y
// `.../scratchpad/phase2/evidencia/W5/B1/` para el dump completo (Chromium real
// contra el bundle real del repo, no una suposición).

import type { RegistroPin } from "../../nucleo/placas.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// GPIO (placa) → nombre real del pin en el custom element Wokwi
// ════════════════════════════════════════════════════════════════════════════════════

// circuito.ts:624-631 (`ESP32_WOKWI_PIN`) — los 23 primeros son copia LITERAL, con su
// propia cita de origen para los 4 casos especiales conservada tal cual el archivo
// original. `1`/`3` son NUEVOS (revisión post red-team, B1): `circuito.ts` NUNCA
// tuvo entrada para ellos (su `motivoRechazo` los frenaba antes de necesitar
// dibujarlos), así que la fuente acá es el dump REAL del bundle, no una copia de
// `circuito.ts` — ver la nota de cabecera del archivo, ataque A1 de P2-RED-B.
const ESP32_WOKWI_PIN: ReadonlyMap<number, string> = new Map<number, string>([
  ...([2, 4, 5, 12, 13, 14, 15, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35] as const).map((n): [number, string] => [n, `D${n}`]),
  // Los cuatro que la placa NO rotula "GPIO". Cada uno con su fuente (circuito.ts:626-630):
  [16, "RX2"], // skills/proyectos-inet/proyectos/06-estacionamiento.md:42
  [17, "TX2"], // idem
  [36, "VP"], // SENSOR_VP — ESP32 Series Datasheet, Pin Definitions, pin físico 5
  [39, "VN"], // SENSOR_VN — idem, pin físico 8
  // NUEVOS (B1): confirmados contra `el.pinInfo` real del bundle, nunca contra
  // circuito.ts (que no los tenía) — ver la nota de cabecera del archivo.
  [1, "TX0"],
  [3, "RX0"],
])

/**
 * Nombre del pin de la PLACA, en el vocabulario del custom element Wokwi (`pinInfo`/
 * atributo), a partir de un `RegistroPin` (`nucleo/placas.ts`) — o `null` si ese
 * número de GPIO NO TIENE representación física en el custom element real (revisión
 * post red-team, B1: antes acá se inventaba `` `D${numero}` ``, un nombre nunca
 * verificado contra el bundle, para cualquier GPIO fuera de la tabla).
 *
 * Regla de resolución (PURA, sin I/O, sin regla eléctrica nueva — sólo PRESENTACIÓN;
 * "no ofrecer/dibujar un pin sin representación física" es una restricción de
 * PRESENTACIÓN — no se puede dibujar un cable a un pin que no existe en la pieza —
 * nunca una regla eléctrica nueva sobre qué GPIO son válidos: esa sigue siendo,
 * únicamente, `asignarPin()`, `nucleo/catalogo.ts`):
 * 1. ESP32 (`pin.banco === "GPIO"`): tabla `ESP32_WOKWI_PIN` si el número está ahí.
 * 2. Si no está en la tabla: `null` — sin fallback inventado. `ESP32_GPIO_VALIDOS`/
 *    `ESP32_GPIO_FLASH` de `nucleo/placas.ts` listan GPIO (0, 6-11, 37, 38) que el
 *    catálogo de Fase 1 acepta pero que la pieza Wokwi real NO representa —
 *    confirmado contra `el.pinInfo` (ver nota de cabecera). Ese es un gap de
 *    datos/reglas de Fase 1 (`asignarPin()` no filtra por `RegistroPin.restricciones`,
 *    y `ESP32_GPIO_VALIDOS` incluye 37/38 sin ninguna restricción asociada) — NO se
 *    cierra acá (`DECISIONS.md`, backlog); esta función sólo se niega a INVENTAR un
 *    nombre para lo que no existe.
 * 3. Arduino UNO digital (`banco === "D"`): Wokwi usa el número PELADO (dump:60).
 * 4. Arduino UNO analógico (`banco === "A"`): Wokwi usa `A<n>` (dump:53-58) — mismo
 *    `id` que ya usa `RegistroPin.id` en `nucleo/placas.ts`, sin traducción.
 */
export function nombreWokwiDePin(pin: RegistroPin): string | null {
  if (pin.banco === "GPIO") return ESP32_WOKWI_PIN.get(pin.numero) ?? null
  if (pin.banco === "D") return String(pin.numero)
  return `A${pin.numero}` // banco === "A"
}

// ════════════════════════════════════════════════════════════════════════════════════
// Componente de catálogo → elemento Wokwi + pines de la PIEZA
//
// `nucleo/catalogo-datos.ts::ComponenteCatalogo` NO declara un backend Wokwi (a
// diferencia de `Placa.backends.wokwi`, Gate 1) — hueco real, ya señalado por el
// informe ARCH-C §7 punto 2. Se resuelve con una tabla LOCAL acá, indexada por
// `ComponenteCatalogo.id`, en vez de tocar `nucleo/` desde este slice (mismo criterio
// que Phase 1 ya usó para no extraer la "capa 2" de render a `placas.ts`).
// ════════════════════════════════════════════════════════════════════════════════════

// circuito.ts:949 (`COMPONENTES.led.tag`). Único tipo con evidencia real hoy — el
// fixture de este slice es ESP32+LED; agregar otro componente con render es sumar
// una entrada acá, nunca tocar `snapshot-a-vista.ts`.
//
// Fase 2, Slice 2 (§3.2, HD-S2-2/3/4): agrega `pulsador` → `wokwi-pushbutton`, el
// custom element ESTÁNDAR (no la variante `-6mm`, sin evidencia de que el catálogo/
// pedagogía la pida — ARCH-S2-PHYSICAL/INFORME.md §8, "scope creep" final). Ya
// definido en `opencode/tecniabot-web/wokwi-bundle.js` (mismo bundle que ya sirve
// `wokwi-led`/`wokwi-esp32-devkit-v1`, licencia MIT ya presente en el repo, sin
// asset nuevo) — confirmado con `shadowRoot` real en Chromium headless
// (ARCH-S2-PHYSICAL/INFORME.md §1).
//
// Fase 3, Wave 0 (HD-W0-B, PHASE_3_PRE_HUMAN_TEST_DESIGN.md §2): agrega
// `resistencia` → `wokwi-resistor` — el custom element YA está en el mismo bundle,
// sin asset nuevo (EXP-B, confirmado en Chromium headless real contra el bundle del
// repo: `tagRegistrado:true`, `shadowRoot` con contenido, `pinInfo` con los pines
// `"1"`/`"2"` reales — ver `TERMINAL_WOKWI_POR_TIPO` más abajo). Antes de esto la
// pieza existía en el bundle pero nunca se registraba acá, así que no se dibujaba
// (causa confirmada de HD-W0-B).
export const ELEMENTO_WOKWI_POR_TIPO: Readonly<Record<string, string>> = {
  led: "wokwi-led",
  pulsador: "wokwi-pushbutton",
  resistencia: "wokwi-resistor",
}

// docs/wokwi-pinout-dump.md:79 (`wokwi-led | A C`, confirmado contra el bundle real)
// + la convención estándar ánodo=+/cátodo=- que ya usa `catalogo-datos.ts:22-23`
// (`rol: "anodo"`/`"catodo"`). Presentación pura: no es una regla eléctrica, es el
// nombre del PIN dentro del custom element de la PIEZA.
//
// Fase 2, Slice 2 (§3.2, HD-S2-2/3/4): `pulsador.senal → "1.l"`, `pulsador.gnd →
// "2.l"`. `el.pinInfo` REAL de `wokwi-pushbutton` (Chromium headless, ARCH-S2-
// PHYSICAL/INFORME.md §2): `[{"name":"1.l"},{"name":"2.l"},{"name":"1.r"},
// {"name":"2.r"}]` — 4 terminales, DOS contactos. Corrección (Physical View UX #1,
// verificado contra https://docs.wokwi.com/parts/wokwi-pushbutton): `1.l`/`1.r` son
// el MISMO contacto ("first contact (left / right)") y `2.l`/`2.r` el otro; los dos
// lados de un mismo contacto están SIEMPRE unidos, y presionar une el contacto 1 con
// el 2. El comentario anterior decía "1.l≡2.l", que es falso; el mapeo de abajo
// (senal→contacto 1, gnd→contacto 2) siempre fue correcto. Elegir el lado izquierdo
// o derecho de un mismo contacto es cosmético: ver `ANCLAS_EQUIVALENTES_WOKWI_POR_TIPO`.
// Fase 3, Wave 0 (HD-W0-B): `resistencia.a/b -> "1"/"2"` — `el.pinInfo` REAL de
// `wokwi-resistor` (Chromium headless, EXP-B): `[{"name":"1"},{"name":"2"}]`, sin
// polaridad (coincide con `catalogo-datos.ts:40-43`, "es un puente, no tiene
// polaridad" — CUALQUIER pata puede mapear a CUALQUIERA de los dos pines, una
// elección cosmética, nunca eléctrica, mismo criterio que ya documenta el pulsador
// acá arriba).
export const TERMINAL_WOKWI_POR_TIPO: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  led: { anodo: "A", catodo: "C" },
  pulsador: { senal: "1.l", gnd: "2.l" },
  resistencia: { a: "1", b: "2" },
}

// circuito.ts:949-975 (`COMPONENTES.led`, color por índice `[red,yellow,green][i%3]`
// en el legacy) — Fase 1 no modela `color` como dato semántico
// (`catalogo-datos.ts::LED` no tiene esa propiedad). Se fija un default estable acá:
// decoración pura, nunca proyección de IR. Si en el futuro se agrega
// `componente.propiedades.color`, el adaptador (`snapshot-a-vista.ts`) lo proyecta
// 1:1 y ESTE default deja de aplicarse para ese componente.
//
// Fase 2, Slice 2 (§3.2, R-3=GREEN): `pulsador.color = "green"`, sólo para
// distinguirlo visualmente del LED rojo — cosmético, revisable, nunca semántico
// (informe ARCH-S2-PHYSICAL confirma que `color` es un atributo puramente visual del
// custom element, sin efecto eléctrico).
/**
 * Pines de la pieza que son el MISMO nodo eléctrico que el ancla de
 * `TERMINAL_WOKWI_POR_TIPO` (Physical View UX #1). El esquema elige, entre ellos, el
 * que queda del lado de su destino para no dar vuelta el cable alrededor de la pieza:
 * es una elección de PRESENTACIÓN entre puntos ya unidos, nunca una conexión nueva.
 * La primera entrada es siempre el ancla de `TERMINAL_WOKWI_POR_TIPO`.
 * Evidencia: https://docs.wokwi.com/parts/wokwi-pushbutton ("Since both belong to the
 * same contact, they are always connected").
 */
export const ANCLAS_EQUIVALENTES_WOKWI_POR_TIPO: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  pulsador: { senal: ["1.l", "1.r"], gnd: ["2.l", "2.r"] },
}

export const ATRIBUTOS_POR_TIPO: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  led: { color: "red" },
  pulsador: { color: "green" },
}

// ════════════════════════════════════════════════════════════════════════════════════
// Escala visual — cosmético, circuito.ts:641/650 (placa 1.25, LED 1.3 vía ESCALA.led)
// ════════════════════════════════════════════════════════════════════════════════════

export const ESCALA_WOKWI_POR_PLACA: Readonly<Record<string, number>> = {
  "esp32-devkit-v1": 1.25, // circuito.ts:641
  "arduino-uno": 1.0, // circuito.ts:697
}

/** Elemento Wokwi de cada PLACA (antes `Placa.backends.wokwi.elemento`, que estaba dentro
 * del catálogo hasheado). circuito.ts:640 (ESP32) y circuito.ts:696 (UNO). */
export const ELEMENTO_WOKWI_POR_PLACA: Readonly<Record<string, string>> = {
  "esp32-devkit-v1": "wokwi-esp32-devkit-v1",
  "arduino-uno": "wokwi-arduino-uno",
}

/** Nombre del pin de la pieza Wokwi para cada TERMINAL DE POTENCIA semántico de la placa
 * (D-05). Una masa semántica puede tener varios pines físicos en la pieza. Evidencia:
 * circuito.ts:656-667/723-727 (`rielWokwi`) y docs/wokwi-pinout-dump.md:26,49-52,69-73. */
export const POTENCIA_WOKWI_POR_PLACA: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  "esp32-devkit-v1": { GND: ["GND.1", "GND.2"], "3V3": ["3V3"], VIN: ["VIN"] },
  "arduino-uno": { GND: ["GND.1", "GND.2", "GND.3"], "3V3": ["3.3V"], "5V": ["5V"], VIN: ["VIN"] },
}
