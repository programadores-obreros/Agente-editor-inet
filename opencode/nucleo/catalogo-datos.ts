// Contenido mínimo shippeado del catálogo — Gate 3.
//
// Puro, declarativo, sin I/O. Cada componente cita su evidencia de `circuito.ts`
// (mismo criterio que `placas.ts`, Gate 1): un dato de hardware que no está en el
// código real de hoy no se inventa acá. `REGISTRO_PLACAS` se REFERENCIA desde
// `placas.ts` (Gate 1), nunca se redefine.

import type { ComponenteDatos, ConversionUnidad } from "./catalogo.ts"
import { REGISTRO_PLACAS } from "./placas.ts"

export const PLACAS_CATALOGO_MINIMO = Object.values(REGISTRO_PLACAS)

// ── LED ────────────────────────────────────────────────────────────────────────────
// circuito.ts:947-975 (`COMPONENTES.led`): ánodo digital (con resistencia serie),
// cátodo a GND fijo. Requiere 220Ω en serie (circuito.ts:972-973, "sin la resistencia
// el LED se destruye"). Nombre visible y conceptos: anexo de pedagogía (D-10).
export const LED: ComponenteDatos = {
  id: "led",
  clase: "actuador",
  terminales: [
    { id: "anodo", rol: "anodo", electrica: "digital", direccion: "salida" },
    { id: "catodo", rol: "catodo", electrica: "riel-fijo", destinoFijo: "GND" },
  ],
  capacidades: [],
  requisitos: [{ tipo: "resistencia-serie", enTerminal: "anodo", spec: { tipoComponente: "resistencia", valor: { valor: 220, unidad: "ohm", magnitud: "resistencia" } } }],
  // D-11 (Decision Freeze): las acciones que ESTE actuador ofrece, como dato.
  acciones: ["encender", "apagar"],
  compatibilidades: { placas: ["esp32-devkit-v1", "arduino-uno"] },
}

// ── resistencia ────────────────────────────────────────────────────────────────────
// Pasivo auxiliar, generado por el requisito "resistencia-serie" del LED (nunca se
// agrega manualmente por su cuenta en Fase 1 — igual que hoy circuito.ts la dibuja
// "en el medio del cable", circuito.ts:117). Dos terminales sin rol fijo: es un
// puente, no tiene polaridad.
export const RESISTENCIA: ComponenteDatos = {
  id: "resistencia",
  clase: "pasivo",
  terminales: [
    { id: "a", rol: "senal", electrica: "riel-fijo" },
    { id: "b", rol: "senal", electrica: "riel-fijo" },
  ],
  capacidades: [],
  requisitos: [],
  compatibilidades: { placas: ["esp32-devkit-v1", "arduino-uno"] },
}

// ── pulsador ────────────────────────────────────────────────────────────────────────
// circuito.ts:1089-1105 (`COMPONENTES.boton`): INPUT_PULLUP, sin resistencia externa
// ("no hace falta ninguna resistencia externa", circuito.ts:1104) — por eso
// `requisitos: []`. Capacidad "estadoBooleano" para que un `ComportamientoRegla`
// pueda leer "presionado"/"no presionado" (mismo id de tipo que usa `skills/` —
// T_diseno_consolidado.md §0, `pushbutton`→`pulsador`).
export const PULSADOR: ComponenteDatos = {
  id: "pulsador",
  clase: "entrada",
  terminales: [
    // requierePullUpInterno (D5/H-4=A, PHASE_2_SLICE_1_HARDENING_DESIGN.md §1-2):
    // el pulsador se cablea SIN resistencia externa porque usa el pull-up interno
    // del pin (INPUT_PULLUP, circuito.ts:1104) — un pin `soloEntrada` (GPIO34/35/
    // 36/39) NO tiene pull-up/pull-down real (circuito.ts:339-343), así que ahí el
    // pulsador nunca va a leer bien. `evaluarRestriccionesPin` (catalogo.ts) combina
    // este dato con `RegistroPin.restricciones` para emitir `PIN_SIN_PULLUP_INTERNO`.
    { id: "senal", rol: "senal", electrica: "digital", direccion: "entrada", requierePullUpInterno: true },
    { id: "gnd", rol: "tierra", electrica: "riel-fijo", destinoFijo: "GND" },
  ],
  capacidades: [{ id: "estadoBooleano", magnitud: "estadoBooleano", unidad: "ninguna" }],
  requisitos: [],
  compatibilidades: { placas: ["esp32-devkit-v1", "arduino-uno"] },
}

// ── dht22 ───────────────────────────────────────────────────────────────────────────
// circuito.ts:1040-1051 (`COMPONENTES.dht22`): VCC a VLOGICA, DATA digital, GND fijo.
// Rango de temperatura OBSERVED en `SENSOR_SIM.dht22` (circuito.ts:1851): 0-60°C.
// Rango de humedad: el hardware real del DHT22 mide 0-100% RH (INFERRED — circuito.ts
// no simula humedad hoy, `SENSOR_SIM` sólo tiene la rama de temperatura; se documenta
// como inferencia razonable, no como dato leído del código).
export const DHT22: ComponenteDatos = {
  id: "dht22",
  clase: "sensor",
  terminales: [
    { id: "vcc", rol: "alimentacion", electrica: "riel-fijo", destinoFijo: "VLOGICA" },
    { id: "senal", rol: "senal", electrica: "digital", direccion: "entrada" },
    { id: "gnd", rol: "tierra", electrica: "riel-fijo", destinoFijo: "GND" },
  ],
  capacidades: [
    {
      id: "temperatura",
      magnitud: "temperatura",
      unidad: "celsius",
      rango: { min: { valor: 0, unidad: "celsius", magnitud: "temperatura" }, max: { valor: 60, unidad: "celsius", magnitud: "temperatura" } },
    },
    {
      id: "humedad",
      magnitud: "humedad",
      unidad: "porcentaje",
      rango: { min: { valor: 0, unidad: "porcentaje", magnitud: "humedad" }, max: { valor: 100, unidad: "porcentaje", magnitud: "humedad" } },
    },
  ],
  requisitos: [],
  compatibilidades: { placas: ["esp32-devkit-v1", "arduino-uno"] },
}

// ── ntc ─────────────────────────────────────────────────────────────────────────────
// circuito.ts:1312-1320 (`COMPONENTES.ntc`): VCC a VLOGICA, salida ANALÓGICA, GND
// fijo. Rango OBSERVED en `SENSOR_SIM.ntc` (circuito.ts:1852): 0-60°C, mismo valor que
// el DHT22 — sólo mide temperatura (sin humedad): es justo lo que ejercita la rama D
// de `reemplazarSensor` (dht22→ntc pidiendo humedad → incompatible).
export const NTC: ComponenteDatos = {
  id: "ntc",
  clase: "sensor",
  terminales: [
    { id: "vcc", rol: "alimentacion", electrica: "riel-fijo", destinoFijo: "VLOGICA" },
    { id: "senal", rol: "senal", electrica: "analogica", direccion: "entrada" },
    { id: "gnd", rol: "tierra", electrica: "riel-fijo", destinoFijo: "GND" },
  ],
  capacidades: [
    {
      id: "temperatura",
      magnitud: "temperatura",
      unidad: "celsius",
      rango: { min: { valor: 0, unidad: "celsius", magnitud: "temperatura" }, max: { valor: 60, unidad: "celsius", magnitud: "temperatura" } },
    },
  ],
  requisitos: [],
  compatibilidades: { placas: ["esp32-devkit-v1", "arduino-uno"] },
}

export const COMPONENTES_CATALOGO_MINIMO: readonly ComponenteDatos[] = [LED, RESISTENCIA, PULSADOR, DHT22, NTC]

// Sólo °C↔°F (T_diseno_consolidado.md §4.1: "unidades? ... sólo °C↔°F"). Ningún
// componente shippeado usa Fahrenheit hoy — esta conversión existe para que la rama B
// de `reemplazarSensor` sea demostrable con datos reales de conversión, aunque el
// sensor que la ejercita (`sensor-temp-f`) es un fixture de TEST, no de catálogo
// shippeado (T_diseno_consolidado.md §4.3).
export const CONVERSIONES_UNIDAD_MINIMAS: readonly ConversionUnidad[] = [
  { de: "celsius", a: "fahrenheit", magnitud: "temperatura", factor: 1.8, offset: 32 },
  { de: "fahrenheit", a: "celsius", magnitud: "temperatura", factor: 5 / 9, offset: -32 * (5 / 9) },
]

// 2.0.0 — Component System Foundation #1: cambio único y coordinado del dominio de
// identidad (hash semántico sin presentación, terminales de potencia, `asignable`
// derivado, requisito con `Cantidad`, acciones declaradas). Ver `identidad-catalogo.ts`.
export const VERSION_CATALOGO_MINIMO = "2.0.0"
