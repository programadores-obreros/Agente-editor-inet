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
  interruptor: "Interruptor",
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
  // D0: lo que lo distingue del pulsador es pedagógico: queda en la posición en que lo dejan.
  interruptor: ["entrada digital", "INPUT_PULLUP", "estado mantenido"],
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
  interruptor: { senal: "señal", gnd: "GND" },
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
 * Zonas del esquema físico (Physical View UX #1): el rol pedagógico de cada parte del
 * circuito, con una frase corta para el estudiante. La ASIGNACIÓN de una pieza a una
 * zona no sale de acá: sale de la `clase` del catálogo (`snapshot-a-vista.ts::rolDeClase`)
 * y del requisito que agrupa a la resistencia con su LED.
 */
export const ZONAS_DEL_CIRCUITO: Readonly<Record<"entrada" | "controlador" | "salida" | "otras", { readonly titulo: string; readonly descripcion: string }>> = {
  entrada: { titulo: "Entrada", descripcion: "Lo que el ESP32 lee." },
  controlador: { titulo: "Controlador", descripcion: "Lee la entrada y decide la salida." },
  salida: { titulo: "Salida", descripcion: "Lo que el ESP32 maneja." },
  otras: { titulo: "Otras piezas", descripcion: "Todavía no forman parte de una entrada o una salida." },
}

/**
 * Para qué está una pieza que existe por un REQUISITO de otra (Physical View UX #1).
 * Clave: el tipo de requisito del núcleo; `{componente}` es el nombre de la pieza que
 * lo pide. Texto pedagógico: nunca entra al núcleo ni al hash.
 */
export const EXPLICACION_DE_REQUISITO: Readonly<Record<string, string>> = {
  "resistencia-serie": "Protege al {componente} limitando la corriente.",
}

export function explicacionDeRequisito(tipoRequisito: string, nombreComponente: string): string | undefined {
  return EXPLICACION_DE_REQUISITO[tipoRequisito]?.replace("{componente}", nombreComponente)
}

/**
 * Semantic Vertical #3: cómo se le nombra al alumno cada VALOR de una capacidad booleana,
 * por (tipo de componente, capacidad). La semántica (la tríada canónica) vive en
 * `nucleo/estado-booleano.ts`; esto es sólo el rótulo. Sin rótulo, el estado no se ofrece
 * en la frase ni en Blockly (no se inventa un texto).
 */
export const ETIQUETA_DE_ESTADO_BOOLEANO: Readonly<Record<string, Readonly<Record<string, { readonly verdadero: string; readonly falso: string }>>>> = {
  pulsador: { estadoBooleano: { verdadero: "presionado", falso: "suelto" } },
  // D0: mismo significado que el pulsador (verdadero = contacto cerrado), otro rótulo.
  interruptor: { estadoBooleano: { verdadero: "cerrado", falso: "abierto" } },
}

/**
 * Semantic Vertical #3: cómo se nombra cada ESTADO OBJETIVO de un actuador (el id de
 * `DEFINICIONES_ACCION`), en la forma "el LED está ___". Por id de acción: el rótulo es
 * el mismo para cualquier actuador que la declare.
 */
export const ETIQUETA_DE_ESTADO_OBJETIVO: Readonly<Record<string, string>> = {
  encender: "encendido",
  apagar: "apagado",
}

/**
 * CK-REQ-N1: cómo se nombra al alumno cada CAPACIDAD cuantitativa, por id de capacidad (los
 * ids de capacidad son globales: la `temperatura` de un DHT22 y la de un NTC son la misma
 * capacidad). En minúscula, como sustantivo ("la temperatura del DHT22"); la frase la arma
 * quien la consuma. Presentación: no entra al hash ni a la disponibilidad semántica.
 */
export const ETIQUETA_DE_CAPACIDAD: Readonly<Record<string, string>> = {
  temperatura: "temperatura",
  humedad: "humedad relativa",
}

export function etiquetaDeCapacidad(capacidad: string): string | undefined {
  return Object.hasOwn(ETIQUETA_DE_CAPACIDAD, capacidad) ? ETIQUETA_DE_CAPACIDAD[capacidad] : undefined
}

export function etiquetaDeEstadoBooleano(tipo: string, capacidad: string, valor: "verdadero" | "falso"): string | undefined {
  return ETIQUETA_DE_ESTADO_BOOLEANO[tipo]?.[capacidad]?.[valor]
}

export function etiquetaDeEstadoObjetivo(accion: string): string | undefined {
  return ETIQUETA_DE_ESTADO_OBJETIVO[accion]
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
