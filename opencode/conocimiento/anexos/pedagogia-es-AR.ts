// ANEXO DE PEDAGOGÍA (es-AR) — Component System Foundation #1 (D-10 del Decision Freeze).
//
// Todo texto que ve un estudiante o un docente sobre un componente o una placa vive acá,
// NUNCA en el núcleo semántico (`nucleo/`): cambiar un texto no cambia la identidad del
// catálogo (el hash semántico) ni invalida un proyecto. Las claves son los ids estables
// del núcleo; no existe un campo `displayKey` en el núcleo.
//
// Origen de los datos (mudados sin cambiar el texto):
// - nombres: `nombreVisible` de `nucleo/catalogo-datos.ts` y `nucleo/placas.ts`;
// - conceptos: el campo `pedagogico.conceptos` de `nucleo/catalogo-datos.ts`;
// - etiquetas de terminal: `vista-fisica/etiquetas-terminales.ts` (Fase 3, Wave 0, F-09),
//   que ahora sólo reexporta desde acá.

export const NOMBRE_DE_COMPONENTE: Readonly<Record<string, string>> = {
  led: "LED",
  resistencia: "Resistencia",
  pulsador: "Pulsador",
  dht22: "DHT22",
  ntc: "Sensor de temperatura NTC",
}

export const NOMBRE_DE_PLACA: Readonly<Record<string, string>> = {
  "esp32-devkit-v1": "ESP32 DevKit",
  "arduino-uno": "Arduino UNO",
}

export const CONCEPTOS_DE_COMPONENTE: Readonly<Record<string, readonly string[]>> = {
  led: ["salida digital", "resistencia limitadora"],
  pulsador: ["entrada digital", "INPUT_PULLUP"],
  dht22: ["sensor digital", "temperatura", "humedad"],
  ntc: ["sensor analógico", "temperatura", "termistor"],
}

/**
 * Etiqueta por `(tipo, terminal)`. La tabla vieja era por id de terminal solo, y `senal`
 * significaba lo mismo para un pulsador, un DHT22 y un NTC. Primero se busca la clave
 * compuesta; si no está, la genérica por id (comportamiento de la tabla de Wave 0).
 */
export const ETIQUETA_POR_TIPO_Y_TERMINAL: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  led: { anodo: "ánodo (+)", catodo: "cátodo (−)" },
  resistencia: { a: "pata A", b: "pata B" },
  pulsador: { senal: "señal", gnd: "GND" },
}

/** Tabla genérica de Wave 0 (F-09), por id de terminal: se conserva tal cual como
 * respaldo. Claves verificadas contra `nucleo/catalogo-datos.ts`. */
export const ETIQUETA_POR_TERMINAL: Readonly<Record<string, string>> = {
  anodo: "ánodo (+)",
  catodo: "cátodo (−)",
  senal: "señal",
  gnd: "GND",
  a: "pata A",
  b: "pata B",
}

/** Etiqueta de los terminales de potencia de la placa (D-05). */
export const ETIQUETA_DE_TERMINAL_DE_POTENCIA: Readonly<Record<string, string>> = {
  GND: "GND (masa)",
  "3V3": "3,3 V",
  "5V": "5 V",
  VIN: "VIN (entrada de alimentación)",
}

/**
 * Si el terminal no tiene etiqueta todavía, se devuelve su propio id (comportamiento de
 * Wave 0: nunca se inventa un texto). Para los tipos oficialmente soportados, la suite de
 * admisión exige etiqueta para todos sus terminales, así que este respaldo no se usa.
 */
export function etiquetaDeTerminal(terminalId: string, tipo?: string): string {
  return (tipo !== undefined ? ETIQUETA_POR_TIPO_Y_TERMINAL[tipo]?.[terminalId] : undefined) ?? ETIQUETA_POR_TERMINAL[terminalId] ?? terminalId
}

export function nombreDeComponente(tipo: string): string | undefined {
  return NOMBRE_DE_COMPONENTE[tipo]
}

export function nombreDePlaca(id: string): string | undefined {
  return NOMBRE_DE_PLACA[id]
}
