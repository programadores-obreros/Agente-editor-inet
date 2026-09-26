// Identidad semántica de placa — Gate 1 (OD-01) de "Programación por Intención".
//
// QUÉ RESUELVE. `circuito.ts.Placa` (circuito.ts:213-764) mezcla en un solo objeto tres
// capas: identidad física/eléctrica (pools de pines, constraints, rieles, adcMax),
// identidad de render Wokwi (tag, escala, anchoColumna, métodos pinWokwi/rielWokwi) y
// prosa de rechazo en español (motivoRechazo/notaDePin). Este módulo separa SÓLO la
// capa 1 + una referencia opaca (como DATO, nunca como método) a la capa 2, y deja la
// capa 3 fuera: los motivos estructurados son responsabilidad de este y otros
// validadores del núcleo, la prosa es una proyección de UI que los traduce.
//
// Detalle completo, evidencia file:line y las secciones obligatorias del contrato en
// `docs/programacion-intencion/BOARD-CONTRACT.md`. Decisión registrada como OD-01 en
// `docs/programacion-intencion/DECISIONS.md`.
//
// NO se toca `circuito.ts` (prohibido en Fase 1): este archivo es dato declarativo
// nuevo, comparado contra `circuito.ts.PLACAS` por un test de caracterización
// (`tests/nucleo-placas.test.mjs`), nunca una copia que lo reemplace.

import type { Motivo } from "./motivos.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// Tipos
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * El banco al que pertenece un pin. Igual que `circuito.ts:183`: en el ESP32 hay un solo
 * banco ("GPIO"); en el UNO, D4 y A4 son pines DISTINTOS que sólo comparten el número 4.
 */
export type Banco = "GPIO" | "D" | "A"

/**
 * Las únicas cuatro restricciones con evidencia real hoy (`circuito.ts:336-348`): enum
 * CERRADO para Fase 1 (decisión R5/orquestador — si Fase 2+ agrega ESP8266/Bhoot y
 * aparece una restricción nueva, se reabre esta decisión con evidencia, no antes).
 */
export type Restriccion = "soloEntrada" | "strapping" | "flashReservado" | "uartUsb"

/** Capacidades eléctricas del pin. `touch` se DIFIERE (ningún proyecto lo usa hoy). */
export interface Capacidades {
  readonly entradaDigital: boolean
  readonly salidaDigital: boolean
  readonly pwm: boolean
  readonly adc: boolean
  readonly touch: boolean
}

/** En qué pool(es) automático(s) entra el pin — distinto de "existe" (ver BOARD-CONTRACT §5/§9). */
export interface PoolAutomatico {
  readonly digital: boolean
  readonly analogico: boolean
}

export interface RegistroPin {
  /** Clave estable: "GPIO23" (ESP32) · "D4"/"A4" (UNO). Nunca un número pelado. */
  readonly id: string
  readonly banco: Banco
  readonly numero: number
  /** Nombres alternativos impresos en la placa o usados por hardware ("RX2", "VP"). */
  readonly etiquetas: readonly string[]
  readonly capacidades: Capacidades
  readonly restricciones: readonly Restriccion[]
  readonly enPoolAutomatico: PoolAutomatico
}

export interface BackendsPlaca {
  readonly platformio: { readonly board: string; readonly platform: string; readonly framework: string }
  /** El custom element de Wokwi, como DATO (nunca como método: eso es capa de render). */
  readonly wokwi: { readonly elemento: string }
}

export interface Placa {
  /** Identidad semántica estable, kebab-case ASCII. Nunca se reutiliza. */
  readonly id: string
  readonly schemaVersion: string
  /** Lo que ve la docente: "ESP32 DevKit", "Arduino UNO". */
  readonly nombreVisible: string
  /** Alias humanos/LLM. Normalizados en la resolución, nunca en el dato. */
  readonly alias: readonly string[]
  readonly backends: BackendsPlaca
  readonly voltaje: "3V3" | "5V"
  /** Tope de `analogRead`: 4095 en el ESP32, 1023 en el UNO (`circuito.ts:254,649,707`). */
  readonly adcMax: number
  readonly pines: readonly RegistroPin[]
  /** Referencian `RegistroPin.id`, nunca repiten el valor (evita una segunda fuente). */
  readonly i2c: { readonly sda: string; readonly scl: string }
}

/**
 * Placa documentada (skill `placas`) pero fuera del set mínimo de Fase 1 — DEFER, no
 * UNKNOWN (B_board_design.md §4 punto 7). Sin pools de pines: agregarlos ahora sería
 * inventar datos de hardware que hoy sólo existen como prosa Markdown.
 */
export interface PlacaNoSoportada {
  readonly nombreVisible: string
  readonly alias: readonly string[]
}

export type ResultadoResolucionPlaca = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly motivo: Motivo }

// ════════════════════════════════════════════════════════════════════════════════════
// Datos — ESP32 DevKit
//
// Todo con evidencia directa de circuito.ts (import dinámico, comparado en
// tests/nucleo-placas.test.mjs — el test COMPARA, no copia; ver B_board_design.md §6).
// ════════════════════════════════════════════════════════════════════════════════════

// circuito.ts:329 — pool digital automático, en orden de riesgo creciente.
const ESP32_POOL_DIGITAL: readonly number[] = [4, 5, 18, 19, 23, 25, 26, 27, 33, 13, 14, 15, 2]
// circuito.ts:330 — pool analógico automático.
const ESP32_POOL_ANALOGICO: readonly number[] = [34, 35, 36, 39, 32, 33]
// circuito.ts:334 — GPIOs que existen físicamente y NO son flash (unión con el set de abajo).
const ESP32_GPIO_VALIDOS: readonly number[] = [
  0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 37, 38, 39,
]
// circuito.ts:336 — flash SPI: existen físicamente, `motivoRechazo` los frena ANTES que
// el chequeo de "no existe" (por eso van acá, no en GPIO_VALIDOS: circuito.ts los trata
// como un caso más específico que "no existe", nunca como "no existen").
const ESP32_GPIO_FLASH: readonly number[] = [6, 7, 8, 9, 10, 11]
// circuito.ts:338
const ESP32_GPIO_STRAPPING: readonly number[] = [0, 2, 12, 15]
// circuito.ts:344
const ESP32_GPIO_SOLO_ENTRADA: readonly number[] = [34, 35, 36, 39]
// circuito.ts:348
const ESP32_GPIO_UART_USB: readonly number[] = [1, 3]
// circuito.ts:627-630 — los únicos 4 GPIO que la placa NO serigrafía como "GPIO<n>".
const ESP32_ETIQUETAS_ALTERNATIVAS: Readonly<Record<number, string>> = { 16: "RX2", 17: "TX2", 36: "VP", 39: "VN" }

function crearPinEsp32(n: number): RegistroPin {
  const flash = ESP32_GPIO_FLASH.includes(n)
  const soloEntrada = ESP32_GPIO_SOLO_ENTRADA.includes(n)
  const strapping = ESP32_GPIO_STRAPPING.includes(n)
  const uartUsb = ESP32_GPIO_UART_USB.includes(n)
  const adc = ESP32_POOL_ANALOGICO.includes(n)
  const restricciones: Restriccion[] = []
  if (flash) restricciones.push("flashReservado")
  if (soloEntrada) restricciones.push("soloEntrada")
  if (strapping) restricciones.push("strapping")
  if (uartUsb) restricciones.push("uartUsb")

  const salidaDigital = !soloEntrada
  const etiquetaAlternativa = ESP32_ETIQUETAS_ALTERNATIVAS[n]
  return {
    id: `GPIO${n}`,
    banco: "GPIO",
    numero: n,
    etiquetas: etiquetaAlternativa ? [`GPIO${n}`, etiquetaAlternativa] : [`GPIO${n}`],
    capacidades: {
      entradaDigital: true,
      salidaDigital,
      // circuito.ts no tiene poolPwm para el ESP32: "cualquier salida hace PWM" (ledc).
      pwm: salidaDigital,
      adc,
      touch: false,
    },
    restricciones,
    enPoolAutomatico: {
      digital: ESP32_POOL_DIGITAL.includes(n),
      analogico: ESP32_POOL_ANALOGICO.includes(n),
    },
  }
}

const ESP32_PINES: readonly RegistroPin[] = [...ESP32_GPIO_VALIDOS, ...ESP32_GPIO_FLASH]
  .sort((a, b) => a - b)
  .map(crearPinEsp32)

const PLACA_ESP32_DEVKIT_V1: Placa = {
  id: "esp32-devkit-v1",
  schemaVersion: "1.0.0",
  nombreVisible: "ESP32 DevKit",
  // B_board_design.md §3: alias humanos/LLM. Deliberadamente SIN "esp32dev" ni el
  // elemento Wokwi — ver la regla "backend id != alias implícito" (§4 punto 6) y los
  // tests platformio-id-no-es-semantico / wokwi-id-no-es-semantico.
  alias: ["esp32", "esp32 devkit", "devkit", "esp-32", "esp32 dev kit"],
  backends: {
    platformio: { board: "esp32dev", platform: "espressif32@6.12.0", framework: "arduino" }, // ejemplos/blink-esp32/platformio.ini:4-6
    wokwi: { elemento: "wokwi-esp32-devkit-v1" }, // circuito.ts:640
  },
  voltaje: "3V3",
  adcMax: 4095, // circuito.ts:648
  pines: ESP32_PINES,
  i2c: { sda: "GPIO21", scl: "GPIO22" }, // circuito.ts:646
}

// ════════════════════════════════════════════════════════════════════════════════════
// Datos — Arduino UNO
// ════════════════════════════════════════════════════════════════════════════════════

// circuito.ts:358
const UNO_POOL_DIGITAL: readonly number[] = [2, 4, 7, 8, 12, 3, 5, 6, 9, 10, 11, 13, 0, 1]
// circuito.ts:362
const UNO_POOL_PWM: readonly number[] = [3, 5, 6, 9, 10, 11]
// circuito.ts:365
const UNO_POOL_ANALOGICO: readonly number[] = [0, 1, 2, 3, 4, 5]

function crearPinUnoDigital(n: number): RegistroPin {
  const pwm = UNO_POOL_PWM.includes(n)
  return {
    id: `D${n}`,
    banco: "D",
    numero: n,
    etiquetas: [`D${n}`],
    capacidades: { entradaDigital: true, salidaDigital: true, pwm, adc: false, touch: false },
    // B_board_design.md §3: el UNO no tiene NINGUNA restricción real hoy (sin flash, sin
    // strapping, sin solo-entrada — skills/placas/SKILL.md:133) — enum vacío, no
    // inventado: sirve para probar que `restricciones` es "vacío por dato", no un campo
    // con default fantasma.
    restricciones: [],
    enPoolAutomatico: { digital: UNO_POOL_DIGITAL.includes(n), analogico: false },
  }
}

function crearPinUnoAnalogico(n: number): RegistroPin {
  return {
    id: `A${n}`,
    banco: "A",
    numero: n,
    etiquetas: [`A${n}`],
    // circuito.ts nunca trata un pin de poolAnalogico como digital (Sets separados por
    // banco): A0-A5 son entradas analógicas, no digitales, en este modelo.
    capacidades: { entradaDigital: false, salidaDigital: false, pwm: false, adc: true, touch: false },
    restricciones: [],
    enPoolAutomatico: { digital: false, analogico: UNO_POOL_ANALOGICO.includes(n) },
  }
}

const UNO_PINES: readonly RegistroPin[] = [
  ...Array.from({ length: 14 }, (_, n) => crearPinUnoDigital(n)), // D0-D13
  ...Array.from({ length: 6 }, (_, n) => crearPinUnoAnalogico(n)), // A0-A5
]

const PLACA_ARDUINO_UNO: Placa = {
  id: "arduino-uno",
  schemaVersion: "1.0.0",
  nombreVisible: "Arduino UNO",
  alias: ["uno", "arduino uno", "arduino", "arduino uno original", "arduino uno clon"],
  backends: {
    platformio: { board: "uno", platform: "atmelavr@5.2.0", framework: "arduino" }, // ejemplos/blink-uno/platformio.ini:4-6
    wokwi: { elemento: "wokwi-arduino-uno" }, // circuito.ts:696
  },
  voltaje: "5V",
  adcMax: 1023, // circuito.ts:707
  pines: UNO_PINES,
  i2c: { sda: "A4", scl: "A5" }, // circuito.ts:703, skills/educabot/SKILL.md:52,102
}

// ════════════════════════════════════════════════════════════════════════════════════
// Registro público
// ════════════════════════════════════════════════════════════════════════════════════

export const REGISTRO_PLACAS: Readonly<Record<string, Placa>> = {
  "esp32-devkit-v1": PLACA_ESP32_DEVKIT_V1,
  "arduino-uno": PLACA_ARDUINO_UNO,
}

/**
 * Placas conocidas pero fuera del set mínimo de Fase 1 (decisión del orquestador:
 * ESP8266 diferido explícito). Sin pools de pines: sólo lo mínimo para distinguir
 * "no soportada" de "desconocida" (B_board_design.md §4 punto 7).
 */
export const PLACAS_NO_SOPORTADAS: readonly PlacaNoSoportada[] = [
  {
    nombreVisible: "ESP8266 (NodeMCU / Wemos D1 mini)",
    // skills/placas/SKILL.md:248-274
    alias: ["esp8266", "nodemcu", "nodemcu v2", "d1 mini", "wemos d1 mini"],
  },
]

// ════════════════════════════════════════════════════════════════════════════════════
// Resolución alias → id (B_board_design.md §4)
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Normalización de texto para comparar aliases: trim + colapsar espacios + lowercase +
 * quitar tildes (NFD, strip combining marks). NUNCA fuzzy: dos aliases que se "parecen"
 * pero no coinciden tras esta normalización son entradas DISTINTAS.
 */
export function normalizarAlias(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
}

/**
 * Resuelve un alias humano/LLM al id semántico de placa, o da un motivo estructurado.
 *
 * `registro` es inyectable (default: `REGISTRO_PLACAS`) para poder ejercitar el caso
 * ambiguo con un fixture sintético sin tocar los datos reales (ninguna de las 2 placas
 * del set mínimo comparte alias hoy).
 *
 * Nunca fuzzy, nunca substring, nunca "el primero que matchea", nunca un backend id
 * (`board=`/`tag` de Wokwi) resuelto implícitamente salvo que esté declarado en
 * `alias[]` del registro.
 */
export function resolverAliasPlaca(
  entrada: string,
  registro: Readonly<Record<string, Placa>> = REGISTRO_PLACAS,
): ResultadoResolucionPlaca {
  const normalizada = normalizarAlias(entrada)

  const candidatos: string[] = []
  for (const p of Object.values(registro)) {
    if (p.alias.some((a) => normalizarAlias(a) === normalizada)) candidatos.push(p.id)
  }

  if (candidatos.length === 1) {
    const id = candidatos[0]
    if (id !== undefined) return { ok: true, id }
  }

  if (candidatos.length > 1) {
    return {
      ok: false,
      motivo: {
        codigo: "PLACA_ALIAS_AMBIGUA",
        categoria: "operacion",
        severidad: "blocking",
        clasificacion: "rechazo",
        datos: { entrada, candidatos: [...candidatos].sort() },
      },
    }
  }

  const noSoportada = PLACAS_NO_SOPORTADAS.find((p) => p.alias.some((a) => normalizarAlias(a) === normalizada))
  if (noSoportada) {
    return {
      ok: false,
      motivo: {
        codigo: "PLACA_CONOCIDA_NO_SOPORTADA",
        categoria: "operacion",
        severidad: "blocking",
        clasificacion: "rechazo",
        datos: { entrada, nombreVisible: noSoportada.nombreVisible },
      },
    }
  }

  return {
    ok: false,
    motivo: {
      codigo: "PLACA_DESCONOCIDA",
      categoria: "operacion",
      severidad: "blocking",
      clasificacion: "rechazo",
      datos: { entrada },
    },
  }
}
