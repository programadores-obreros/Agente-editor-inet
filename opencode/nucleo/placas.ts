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
 *
 * CK-CG1 reabrió el enum con evidencia: `strappingVddSdio` = el nivel del pin al reset elige
 * la tensión de la flash (Espressif, ESP32 Series Datasheet v5.3, §3.2). Revisión humana del
 * 2026-10-06 (R4).
 */
export type Restriccion = "soloEntrada" | "strapping" | "flashReservado" | "uartUsb" | "strappingVddSdio"

/**
 * Capacidades eléctricas del pin. Entran al hash semántico (`catalogo.ts`).
 *
 * `adc` significa "sirve para un sensor analógico EN TECNIA BOT", no "el chip tiene un canal
 * ADC ahí": en el ESP32 queda en ADC1 solamente (CK-PLACA-01, H-A2), porque ADC2 lo usa el
 * WiFi y una lectura con WiFi iniciado falla (`RegistroPin.adcBanco` conserva el dato).
 * `dac` y `touch` (CK-PLACA-01, H-A3): datos con fuente, todavía sin consumidor.
 */
export interface Capacidades {
  readonly entradaDigital: boolean
  readonly salidaDigital: boolean
  readonly pwm: boolean
  readonly adc: boolean
  readonly dac: boolean
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
  /**
   * Banco del convertidor analógico al que pertenece el pin, si tiene uno (CK-PLACA-01):
   * dato informativo, FUERA del hash semántico. Qué pines se ofrecen para un terminal
   * analógico lo decide `capacidades.adc`, no esto.
   */
  readonly adcBanco?: "ADC1" | "ADC2"
}

/**
 * Backend de COMPILACIÓN (toolchain). No es significado del proyecto: no entra al
 * hash semántico. El elemento de render Wokwi ya NO vive acá: es dato de
 * representación (`conocimiento/anexos/representacion.ts`, D-09 del Decision Freeze).
 */
export interface BackendsPlaca {
  readonly platformio: { readonly board: string; readonly platform: string; readonly framework: string }
}

/**
 * Terminal de potencia de la placa (D-05 del Decision Freeze): GND, 3V3, 5V, VIN.
 * Es un terminal FÍSICO y CONECTABLE (los terminales `riel-fijo` de los componentes
 * terminan acá) pero NO es un GPIO lógico: no está en `pines`, no se ofrece para
 * `AsignarPin` y una asignación a él se rechaza. physicalConnectable ≠ logicalAssignable.
 */
export interface TerminalPotencia {
  readonly id: "GND" | "3V3" | "5V" | "VIN"
  readonly rol: "tierra" | "alimentacion"
  /** Tensión nominal como `Cantidad` (magnitud `tension`, unidad `volt`). Ausente si
   * no hay un valor único honesto (p. ej. el VIN del UNO, entrada variable). */
  readonly tension?: { readonly valor: number; readonly unidad: "volt"; readonly magnitud: "tension" }
}

/** A qué terminal de potencia (o pin i2c) resuelve cada `destinoFijo` en ESTA placa. */
export interface DestinosDeRiel {
  readonly GND: TerminalPotencia["id"]
  readonly V3: TerminalPotencia["id"]
  readonly V5: TerminalPotencia["id"]
  readonly VLOGICA: TerminalPotencia["id"]
}

export interface Placa {
  /** Identidad semántica estable, kebab-case ASCII. Nunca se reutiliza. */
  readonly id: string
  readonly schemaVersion: string
  /** Alias humanos/LLM: vocabulario de ENTRADA, no significado (fuera del hash
   * semántico). Normalizados en la resolución, nunca en el dato. El nombre que ve la
   * docente vive en el anexo de pedagogía (D-10). */
  readonly alias: readonly string[]
  readonly backends: BackendsPlaca
  readonly voltaje: "3V3" | "5V"
  /** Tope de `analogRead`: 4095 en el ESP32, 1023 en el UNO (`circuito.ts:254,649,707`). */
  readonly adcMax: number
  readonly pines: readonly RegistroPin[]
  /** Referencian `RegistroPin.id`, nunca repiten el valor (evita una segunda fuente). */
  readonly i2c: { readonly sda: string; readonly scl: string }
  readonly terminalesDePotencia: readonly TerminalPotencia[]
  readonly destinosDeRiel: DestinosDeRiel
  /**
   * Si las ENTRADAS toleran 5 V (CK-PLACA-01, H-A5). Entra al hash semántico: va a decidir la
   * validez eléctrica de piezas que entregan 5 V a un pin (eco del HC-SR04, pHmetro V1).
   * Hoy ningún evaluador lo lee: es el hecho de la placa, declarado antes que sus consumidores.
   */
  readonly tolerancia5V: boolean
  /**
   * LED soldado en la placa, conectado a un GPIO (CK-PLACA-01, H-A4). Dato de placa FUERA del
   * hash semántico (no cambia qué proyectos son válidos): un LED del alumno en ese pin también
   * prende este, y la ficha lo explica. `activoEn` AUSENTE = no verificado todavía (no se inventa).
   */
  readonly ledDePlaca?: {
    /** Referencia `RegistroPin.id`, nunca repite el número. */
    readonly pin: string
    readonly color: "azul" | "rojo" | "verde" | "amarillo" | "blanco"
    readonly activoEn?: "alto" | "bajo"
  }
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
//
// D9 (PHASE_2_SLICE_1_HARDENING_DESIGN.md §1, gate final de hardening, 2026-09-29):
// SIN 37 y 38 — DIVERGE a propósito de `circuito.ts:334`, que sí los incluye en su
// `GPIO_VALIDOS` (ese archivo NO se toca, prohibido en Fase 1/2). A nivel chip existen
// como `SENSOR_CAPP`/`SENSOR_CAPN` (solo-entrada), pero NO salen a ningún pin del
// módulo WROOM que traen las escuelas — "un matiz honesto sobre 'son cuatro'"
// (`opencode/skills/esp32/SKILL.md:82-85`) y confirmado contra el bundle Wokwi real
// (`tests/circuito.test.mjs:2524-2527`: "GPIO37 y GPIO38 son SENSOR_CAPP/SENSOR_CAPN
// y el módulo WROOM no los expone... no se pueden 'mapear': no están"). Declararlos
// VALIDOS acá era mentirle al registro: esta placa (`esp32-devkit-v1`, no el chip
// desnudo) no los tiene. Asignarlos por operación da el mismo rechazo que cualquier
// otro pin inexistente (`PIN_INEXISTENTE_EN_PLACA`); un estado histórico con GPIO37/38
// se diagnostica con `PIN_INEXISTENTE_EN_DOCUMENTO` (D10, `validar-tecnico.ts`).
// Ningún test `tests/nucleo-*` (Phase 1, intocable) referencia 37/38 — verificado.
const ESP32_GPIO_VALIDOS: readonly number[] = [
  0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39,
]
// circuito.ts:336 — flash SPI: existen físicamente, `motivoRechazo` los frena ANTES que
// el chequeo de "no existe" (por eso van acá, no en GPIO_VALIDOS: circuito.ts los trata
// como un caso más específico que "no existe", nunca como "no existen").
const ESP32_GPIO_FLASH: readonly number[] = [6, 7, 8, 9, 10, 11]
// circuito.ts:338 (0, 2, 12, 15) + GPIO5.
//
// Deuda ESP-STRAP-05 (abierta en CK-CG1, CERRADA en CK-PLACA-01, revisión humana del 2026-10-12,
// H-A1): Espressif lista cinco strapping pins — GPIO0, GPIO2, MTDI (GPIO12), MTDO (GPIO15) y
// GPIO5 (ESP32 Series Datasheet v5.3, §3 y Tabla 3-1: GPIO5 con pull-up por defecto, bit 1;
// junto con MTDO fija el timing del SDIO slave). DIVERGE a propósito de `circuito.ts:338`, que
// no lo marca (archivo congelado), y reabre D4 (H-3=A, hardening de Phase 2: "sin fuente
// interna") con esa fuente externa de tier 1. Severidad `info`, como GPIO0/2/15
// (`catalogo.ts::severidadStrapping`): el SDIO slave no se usa en el aula; sigue en el pool
// automático, igual que GPIO2 (D3, H-2b=A).
const ESP32_GPIO_STRAPPING: readonly number[] = [0, 2, 5, 12, 15]
// CK-CG1 (R4, revisión humana 2026-10-06): MTDI (GPIO12) elige la tensión de VDD_SDIO al reset;
// en alto, el LDO de 1,8 V (Espressif, ESP32 Series Datasheet v5.3, §3.2), y VDD_SDIO alimenta
// la flash. Un terminal elevado por un pull-up externo no puede ir acá
// (`catalogo.ts::evaluarRestriccionesPin`). Los demás strapping conservan su política.
const ESP32_GPIO_STRAPPING_VDD_SDIO: readonly number[] = [12]
// circuito.ts:344
const ESP32_GPIO_SOLO_ENTRADA: readonly number[] = [34, 35, 36, 39]
// circuito.ts:348
const ESP32_GPIO_UART_USB: readonly number[] = [1, 3]
// circuito.ts:627-630 — los únicos 4 GPIO que la placa NO serigrafía como "GPIO<n>".
const ESP32_ETIQUETAS_ALTERNATIVAS: Readonly<Record<number, string>> = { 16: "RX2", 17: "TX2", 36: "VP", 39: "VN" }

// CK-PLACA-01 (revisión humana del 2026-10-12). Fuente de las cuatro tablas: ESP32 Series
// Datasheet v5.3, Tabla 2-1 (Pin Overview), confirmada contra arduino-esp32
// `variants/doitESP32devkitV1/pins_arduino.h` (A0–A19, T0–T9, DAC1/DAC2). Sólo los GPIO que
// el módulo WROOM-32 de la placa expone (37/38 son ADC1_CH1/CH2 a nivel chip y no están).
//
// ADC1 = canales CH0..CH7 en 36, 37, 38, 39, 32, 33, 34, 35. ADC2 = CH0..CH9 en 4, 0, 2, 15, 13,
// 12, 14, 27, 25, 26. ADC2 lo comparte el WiFi: con el WiFi iniciado la lectura falla
// (ESP-IDF v4.4, `adc2_get_raw`: "If Wi-Fi is started via esp_wifi_start(), this function
// will always fail with ESP_ERR_TIMEOUT"; ESP-IDF actual: "ADC2 is also used by Wi-Fi"). Por
// eso `capacidades.adc` sigue siendo el pool ADC1 de siempre (H-A2) y el banco es sólo dato.
const ESP32_ADC1: readonly number[] = [32, 33, 34, 35, 36, 39]
const ESP32_ADC2: readonly number[] = [0, 2, 4, 12, 13, 14, 15, 25, 26, 27]
// DAC_1 = GPIO25, DAC_2 = GPIO26 (8 bits).
const ESP32_DAC: readonly number[] = [25, 26]
// TOUCH0..TOUCH9 = 4, 0, 2, 15, 13, 12, 14, 27, 33, 32.
const ESP32_TOUCH: readonly number[] = [0, 2, 4, 12, 13, 14, 15, 27, 32, 33]

function crearPinEsp32(n: number): RegistroPin {
  const flash = ESP32_GPIO_FLASH.includes(n)
  const soloEntrada = ESP32_GPIO_SOLO_ENTRADA.includes(n)
  const strapping = ESP32_GPIO_STRAPPING.includes(n)
  const uartUsb = ESP32_GPIO_UART_USB.includes(n)
  const adc = ESP32_POOL_ANALOGICO.includes(n)
  const adcBanco = ESP32_ADC1.includes(n) ? "ADC1" : ESP32_ADC2.includes(n) ? "ADC2" : undefined
  const restricciones: Restriccion[] = []
  if (flash) restricciones.push("flashReservado")
  if (soloEntrada) restricciones.push("soloEntrada")
  if (strapping) restricciones.push("strapping")
  if (uartUsb) restricciones.push("uartUsb")
  if (ESP32_GPIO_STRAPPING_VDD_SDIO.includes(n)) restricciones.push("strappingVddSdio")

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
      dac: ESP32_DAC.includes(n),
      touch: ESP32_TOUCH.includes(n),
    },
    restricciones,
    enPoolAutomatico: {
      digital: ESP32_POOL_DIGITAL.includes(n),
      analogico: ESP32_POOL_ANALOGICO.includes(n),
    },
    ...(adcBanco === undefined ? {} : { adcBanco }),
  }
}

const ESP32_PINES: readonly RegistroPin[] = [...ESP32_GPIO_VALIDOS, ...ESP32_GPIO_FLASH]
  .sort((a, b) => a - b)
  .map(crearPinEsp32)

const PLACA_ESP32_DEVKIT_V1: Placa = {
  id: "esp32-devkit-v1",
  // 1.1.0 — CK-PLACA-01 (aditivo): GPIO5 strapping, `adcBanco`, `dac`, `touch`, `tolerancia5V`,
  // `ledDePlaca`. Catálogo 2.4.0 → 2.5.0 (el hash cambia: pines y schemaVersion entran).
  schemaVersion: "1.1.0",
  // B_board_design.md §3: alias humanos/LLM. Deliberadamente SIN "esp32dev" ni el
  // elemento Wokwi — ver la regla "backend id != alias implícito" (§4 punto 6) y los
  // tests platformio-id-no-es-semantico / wokwi-id-no-es-semantico.
  alias: ["esp32", "esp32 devkit", "devkit", "esp-32", "esp32 dev kit"],
  backends: {
    platformio: { board: "esp32dev", platform: "espressif32@6.12.0", framework: "arduino" }, // ejemplos/blink-esp32/platformio.ini:4-6
  },
  voltaje: "3V3",
  adcMax: 4095, // circuito.ts:648
  pines: ESP32_PINES,
  i2c: { sda: "GPIO21", scl: "GPIO22" }, // circuito.ts:646
  // circuito.ts:656-667 (`rielWokwi` del ESP32): el riel de 5V sale por VIN ("VIN a
  // secas"), 3.3V por 3V3, y hay masa física (dos GND en la pieza: GND.1/GND.2 — eso es
  // representación, no semántica). No hay un pin "5V" separado en esta placa.
  terminalesDePotencia: [
    { id: "GND", rol: "tierra" },
    { id: "3V3", rol: "alimentacion", tension: { valor: 3.3, unidad: "volt", magnitud: "tension" } },
    { id: "VIN", rol: "alimentacion", tension: { valor: 5, unidad: "volt", magnitud: "tension" } },
  ],
  destinosDeRiel: { GND: "GND", V3: "3V3", V5: "VIN", VLOGICA: "3V3" },
  // ESP32 Series Datasheet v5.3, Tabla 5-3: VIH máx = VDD + 0,3 V (3,6 V). No es tolerante a 5 V.
  tolerancia5V: false,
  // LED azul de la DOIT DevKit V1 en GPIO2: arduino-esp32 `variants/doitESP32devkitV1/
  // pins_arduino.h` (`LED_BUILTIN = 2`) y la documentación de placa de Zephyr ("A blue LED is
  // connected to GPIO2"). GPIO2 es además strapping (debe quedar bajo o libre al arrancar): el
  // LED a masa no lo levanta. `activoEn` queda SIN declarar hasta la verificación física
  // (blink de `ejemplos/blink-esp32`), pendiente al 2026-10-12.
  ledDePlaca: { pin: "GPIO2", color: "azul" },
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
    capacidades: { entradaDigital: true, salidaDigital: true, pwm, adc: false, dac: false, touch: false },
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
    capacidades: { entradaDigital: false, salidaDigital: false, pwm: false, adc: true, dac: false, touch: false },
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
  // 1.1.0 — CK-PLACA-01: la forma de `Placa` ganó `tolerancia5V` y `Capacidades.dac` (ambos
  // obligatorios); los datos del UNO no cambian de significado más allá de declararlos.
  schemaVersion: "1.1.0",
  alias: ["uno", "arduino uno", "arduino", "arduino uno original", "arduino uno clon"],
  backends: {
    platformio: { board: "uno", platform: "atmelavr@5.2.0", framework: "arduino" }, // ejemplos/blink-uno/platformio.ini:4-6
  },
  voltaje: "5V",
  adcMax: 1023, // circuito.ts:707
  pines: UNO_PINES,
  i2c: { sda: "A4", scl: "A5" }, // circuito.ts:703, skills/educabot/SKILL.md:52,102
  // circuito.ts:704-727 (riel del UNO: 5V, 3.3V, GND) + docs/wokwi-pinout-dump.md:49-52
  // (la pieza tiene `5V`, `VIN` y tres GND). VIN sin tensión declarada: es una entrada
  // variable, no un valor único (no se inventa).
  terminalesDePotencia: [
    { id: "GND", rol: "tierra" },
    { id: "3V3", rol: "alimentacion", tension: { valor: 3.3, unidad: "volt", magnitud: "tension" } },
    { id: "5V", rol: "alimentacion", tension: { valor: 5, unidad: "volt", magnitud: "tension" } },
    { id: "VIN", rol: "alimentacion" },
  ],
  destinosDeRiel: { GND: "GND", V3: "3V3", V5: "5V", VLOGICA: "5V" },
  // Lógica de 5 V (ATmega328P a 5 V): sus entradas son de 5 V por definición. Sin LED de
  // placa declarado: el UNO tiene uno en D13, pero este slice no lo revisó (no se inventa).
  tolerancia5V: true,
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
