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

import type { RegistroPin } from "../nucleo/placas.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// GPIO (placa) → nombre real del pin en el custom element Wokwi
// ════════════════════════════════════════════════════════════════════════════════════

// circuito.ts:624-631 (`ESP32_WOKWI_PIN`) — copiado LITERAL, con su propia cita de
// origen para los 4 casos especiales conservada tal cual el archivo original.
const ESP32_WOKWI_PIN: ReadonlyMap<number, string> = new Map<number, string>([
  ...([2, 4, 5, 12, 13, 14, 15, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35] as const).map((n): [number, string] => [n, `D${n}`]),
  // Los cuatro que la placa NO rotula "GPIO". Cada uno con su fuente (circuito.ts:626-630):
  [16, "RX2"], // skills/proyectos-inet/proyectos/06-estacionamiento.md:42
  [17, "TX2"], // idem
  [36, "VP"], // SENSOR_VP — ESP32 Series Datasheet, Pin Definitions, pin físico 5
  [39, "VN"], // SENSOR_VN — idem, pin físico 8
])

/**
 * Nombre del pin de la PLACA, en el vocabulario del custom element Wokwi (`pinInfo`/
 * atributo), a partir de un `RegistroPin` (`nucleo/placas.ts`).
 *
 * Regla de resolución (PURA, sin I/O, sin regla eléctrica nueva — sólo PRESENTACIÓN):
 * 1. ESP32 (`pin.banco === "GPIO"`): tabla `ESP32_WOKWI_PIN` si el número está ahí.
 * 2. Si no está en la tabla (gap real: `ESP32_GPIO_VALIDOS`/`ESP32_GPIO_FLASH` de
 *    `nucleo/placas.ts` listan MÁS números que los 23 que `circuito.ts` portaba —
 *    ej. GPIO0/1/3/6-11/37/38 nunca tuvieron entrada en `ESP32_WOKWI_PIN` porque
 *    `circuito.ts.motivoRechazo` los frenaba ANTES de necesitar dibujarlos):
 *    fallback derivable de la MISMA convención que el resto de la placa usa
 *    (`docs/wokwi-pinout-dump.md`: "Los GPIO se llaman D<n>") — `RegistroPin.etiquetas`
 *    primero (por si el catálogo declaró un alias no-"GPIO" que la tabla todavía no
 *    cubre), si no `` `D${numero}` ``. Nunca una regla eléctrica nueva: sólo el mismo
 *    patrón de nombre que ya certifica el volcado real.
 * 3. Arduino UNO digital (`banco === "D"`): Wokwi usa el número PELADO (dump:60).
 * 4. Arduino UNO analógico (`banco === "A"`): Wokwi usa `A<n>` (dump:53-58) — mismo
 *    `id` que ya usa `RegistroPin.id` en `nucleo/placas.ts`, sin traducción.
 */
export function nombreWokwiDePin(pin: RegistroPin): string {
  if (pin.banco === "GPIO") {
    const directo = ESP32_WOKWI_PIN.get(pin.numero)
    if (directo) return directo
    const alternativa = pin.etiquetas.find((e) => !e.startsWith("GPIO"))
    if (alternativa) return alternativa
    return `D${pin.numero}`
  }
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
export const ELEMENTO_WOKWI_POR_TIPO: Readonly<Record<string, string>> = {
  led: "wokwi-led",
}

// docs/wokwi-pinout-dump.md:79 (`wokwi-led | A C`, confirmado contra el bundle real)
// + la convención estándar ánodo=+/cátodo=- que ya usa `catalogo-datos.ts:22-23`
// (`rol: "anodo"`/`"catodo"`). Presentación pura: no es una regla eléctrica, es el
// nombre del PIN dentro del custom element de la PIEZA.
export const TERMINAL_WOKWI_POR_TIPO: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  led: { anodo: "A", catodo: "C" },
}

// circuito.ts:949-975 (`COMPONENTES.led`, color por índice `[red,yellow,green][i%3]`
// en el legacy) — Fase 1 no modela `color` como dato semántico
// (`catalogo-datos.ts::LED` no tiene esa propiedad). Se fija un default estable acá:
// decoración pura, nunca proyección de IR. Si en el futuro se agrega
// `componente.propiedades.color`, el adaptador (`snapshot-a-vista.ts`) lo proyecta
// 1:1 y ESTE default deja de aplicarse para ese componente.
export const ATRIBUTOS_POR_TIPO: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  led: { color: "red" },
}

// ════════════════════════════════════════════════════════════════════════════════════
// Escala visual — cosmético, circuito.ts:641/650 (placa 1.25, LED 1.3 vía ESCALA.led)
// ════════════════════════════════════════════════════════════════════════════════════

export const ESCALA_WOKWI_POR_PLACA: Readonly<Record<string, number>> = {
  "esp32-devkit-v1": 1.25, // circuito.ts:641
  "arduino-uno": 1.0, // circuito.ts:697
}
