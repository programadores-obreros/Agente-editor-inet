// Codegen MVP, Slice 1 — derivaciones eléctricas del backend Arduino (OD-CG-2 = A).
//
// Cómo se LEE una capacidad y cómo se ESCRIBE una acción en un pin, deducido sólo de la FORMA
// eléctrica que ya declara el catálogo (`direccion`, `electrica`, `rol`, `destinoFijo`,
// `requierePullUpInterno`). Nunca de un id de componente: no hay "si es un pulsador" ni tablas
// por tipo. Cada regla describe una topología; un componente que no encaja en ninguna falla
// cerrado con un error estructurado (nunca un HIGH/LOW por defecto).
//
// Puro: sin I/O, sin reloj, sin estado. No conoce PlatformIO ni el agente.

import type { Capacidad, ComponenteCatalogo, Terminal } from "../nucleo/catalogo.ts"
import type { RegistroPin } from "../nucleo/placas.ts"
import { MAGNITUD_BOOLEANA } from "../nucleo/estado-booleano.ts"

export type NivelDigital = "HIGH" | "LOW"

/** Cómo se lee una capacidad: modo del pin, terminal y el nivel que significa "verdadero". */
export interface Lectura {
  readonly terminal: string
  readonly modo: "INPUT_PULLUP"
  readonly nivelVerdadero: NivelDigital
}

/** Cómo se escribe un actuador: terminal y nivel de cada acción que la topología sostiene. */
export interface Escritura {
  readonly terminal: string
  readonly nivelDe: Readonly<Record<string, NivelDigital>>
}

const asignables = (componente: ComponenteCatalogo): readonly Terminal[] => componente.terminales.filter((t) => t.asignable)
const vaAMasa = (componente: ComponenteCatalogo, rol?: Terminal["rol"]): boolean =>
  componente.terminales.some((t) => !t.asignable && t.destinoFijo === "GND" && (rol === undefined || t.rol === rol))

/**
 * Entrada booleana de contacto con pull-up interno: el único terminal asignable es una
 * entrada digital que pide pull-up interno y otro terminal va a masa. Con el pull-up el pin
 * queda en ALTO con el contacto abierto y el contacto cerrado lo lleva a masa: verdadero = LOW.
 */
export function derivarLectura(componente: ComponenteCatalogo, capacidad: Capacidad): Lectura | undefined {
  if (capacidad.magnitud !== MAGNITUD_BOOLEANA) return undefined
  const terminales = asignables(componente)
  const [senal] = terminales
  if (terminales.length !== 1 || !senal) return undefined
  if (senal.electrica !== "digital" || senal.direccion !== "entrada" || senal.requierePullUpInterno !== true) return undefined
  if (!vaAMasa(componente)) return undefined
  return { terminal: senal.id, modo: "INPUT_PULLUP", nivelVerdadero: "LOW" }
}

/**
 * Salida digital por ánodo con cátodo a masa: el único terminal asignable es una salida
 * digital con rol ánodo y el cátodo va a masa. Conduce con el ánodo en ALTO: "encender" =
 * HIGH, "apagar" = LOW (las acciones son el dominio cerrado de la IR, `ir.ts::ACCIONES`).
 */
export function derivarEscritura(componente: ComponenteCatalogo): Escritura | undefined {
  const terminales = asignables(componente)
  const [anodo] = terminales
  if (terminales.length !== 1 || !anodo) return undefined
  if (anodo.electrica !== "digital" || anodo.direccion !== "salida" || anodo.rol !== "anodo") return undefined
  if (!vaAMasa(componente, "catodo")) return undefined
  return { terminal: anodo.id, nivelDe: { encender: "HIGH", apagar: "LOW" } }
}

/**
 * Nombre del pin en el core Arduino, desde el registro de la placa: los bancos `GPIO` (ESP32)
 * y `D` (UNO) se nombran con su número; el banco `A` (UNO) con la constante `A<n>`.
 */
export function nombreDePinArduino(pin: RegistroPin): string | undefined {
  if (!Number.isInteger(pin.numero) || pin.numero < 0) return undefined
  if (pin.banco === "GPIO" || pin.banco === "D") return String(pin.numero)
  if (pin.banco === "A") return `A${pin.numero}`
  return undefined
}
