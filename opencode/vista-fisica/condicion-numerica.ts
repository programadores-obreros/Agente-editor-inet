// Condiciones numéricas de NIVEL — Numeric Conditions S1 (Design Gate #1, consolidado).
//
// La IR ya representa una condición numérica: `capacidad + comparador + umbral{valor, unidad,
// magnitud}`. Este módulo sólo la RECONOCE y la nombra para la proyección; nunca muta nada.
//
// Lo que se sabe del mundo físico (qué capacidades cuantitativas tiene un tipo, su rótulo, sus
// unidades y símbolos, su rango y si están disponibles para armar reglas, y cómo se convierte
// una cantidad) es de Component Knowledge: el contrato CK-REQ-N1 de la fachada
// (`conocimiento/conocimiento.ts`, `conocimiento/cuantitativo.ts`). Acá sólo se CONSUME.
//
// Lo que SÍ es de A: los comparadores (dominio `ir.ts::COMPARADORES`), su rótulo, su
// complemento exacto (para la traza del reposo) y cómo se escribe un número en la frase.

import { COMPARADORES, type Comparador, type CuandoComportamiento } from "../nucleo/ir.ts"
import type { ComponentKnowledge } from "../conocimiento/conocimiento.ts"
import type { CapacidadCuantitativa } from "../conocimiento/cuantitativo.ts"

export const ROTULO_COMPARADOR: Readonly<Record<Comparador, string>> = Object.freeze({
  ">": "mayor a",
  "<": "menor a",
  ">=": "mayor o igual a",
  "<=": "menor o igual a",
})

/** Complemento exacto de cada comparador: lo que vale cuando la condición es falsa. */
export const COMPLEMENTO_COMPARADOR: Readonly<Record<Comparador, Comparador>> = Object.freeze({
  ">": "<=",
  "<": ">=",
  ">=": "<",
  "<=": ">",
})

export function esComparador(valor: unknown): valor is Comparador {
  return typeof valor === "string" && (COMPARADORES as readonly string[]).includes(valor)
}

/** El número guardado, tal cual (N-7: sin redondeo, sin clamp, sin normalizar), con coma decimal.
 * Sin `Intl`: el mismo resultado en cualquier entorno. */
export function formatearNumero(valor: number): string {
  return String(valor).replace(".", ",")
}

/** Se puede OFRECER para armar una regla: disponibilidad semántica de Component Knowledge y un
 * rótulo para el alumno. Nunca `officiallySupported` (N-4). */
export function disponibleParaCrear(capacidad: CapacidadCuantitativa): boolean {
  return capacidad.disponibilidadSemantica.disponible && capacidad.etiqueta !== null
}

/** Las capacidades cuantitativas de un tipo que se pueden ofrecer para crear (vacío si el tipo
 * no existe o no tiene ninguna). */
export function cuantitativasParaCrear(conocimiento: ComponentKnowledge, tipo: string): readonly CapacidadCuantitativa[] {
  const r = conocimiento.capacidadesCuantitativas(tipo)
  return r.ok ? r.valor.filter(disponibleParaCrear) : []
}

export interface CondicionNumerica {
  readonly capacidad: CapacidadCuantitativa
  /** Rótulo de Component Knowledge (sustantivo, sin artículo). */
  readonly etiquetaCapacidad: string
  readonly comparador: Comparador
  readonly valor: number
  readonly unidad: string
  readonly simbolo: string
  /** `false`: la regla ya guardada usa una capacidad que hoy no se ofrece para crear (N-4). */
  readonly disponible: boolean
}

/**
 * Reconoce una condición numérica guardada. Exige la tríada completa, un comparador del dominio
 * y que Component Knowledge describa esa capacidad del tipo del sensor CON rótulo (sin rótulo no
 * hay cómo nombrarla sin inventar: sigue «avanzada»). No mira la magnitud, la unidad ni el
 * rango: si no coinciden, eso es un motivo del núcleo que la vista muestra junto a la condición,
 * nunca un motivo para ocultarla. Tampoco exige disponibilidad: una regla ya guardada se ve.
 */
export function reconocerCondicionNumerica(cuando: CuandoComportamiento | undefined, tipoSensor: string | undefined, conocimiento: ComponentKnowledge): CondicionNumerica | undefined {
  if (tipoSensor === undefined || !cuando?.capacidad || !cuando.umbral || !esComparador(cuando.comparador)) return undefined
  const r = conocimiento.capacidadCuantitativa(tipoSensor, cuando.capacidad)
  if (!r.ok || r.valor.etiqueta === null) return undefined
  const capacidad = r.valor
  const unidad = cuando.umbral.unidad
  return {
    capacidad,
    etiquetaCapacidad: capacidad.etiqueta!,
    comparador: cuando.comparador,
    valor: cuando.umbral.valor,
    unidad,
    simbolo: simboloDe(capacidad, unidad, conocimiento),
    disponible: disponibleParaCrear(capacidad),
  }
}

/** Símbolo de una unidad: el que la capacidad ofrece, si no el de Component Knowledge para esa
 * unidad, y si ninguno la conoce, el propio id guardado (respaldo técnico: nunca se inventa). */
export function simboloDe(capacidad: CapacidadCuantitativa | undefined, unidad: string, conocimiento: ComponentKnowledge): string {
  const ofrecida = capacidad?.unidades.find((u) => u.id === unidad)
  if (ofrecida) return ofrecida.simbolo
  const conocida = conocimiento.unidad(unidad)
  return conocida.ok ? conocida.valor.simbolo : unidad
}

/** «<número> <símbolo>», o sólo el número si el símbolo es vacío. */
export function cantidadEnTexto(valor: number, simbolo: string): string {
  return simbolo === "" ? formatearNumero(valor) : `${formatearNumero(valor)} ${simbolo}`
}

/** «de <min> a <max> <símbolo>», o `null` si el catálogo no declara rango (nunca se inventa). */
export function rangoEnTexto(capacidad: CapacidadCuantitativa, conocimiento: ComponentKnowledge): string | null {
  const rango = capacidad.rango
  if (!rango) return null
  // Con la misma unidad en los dos extremos, la unidad se dice una sola vez (al final).
  const min = rango.min.unidad === rango.max.unidad ? formatearNumero(rango.min.valor) : cantidadEnTexto(rango.min.valor, simboloDe(capacidad, rango.min.unidad, conocimiento))
  return `de ${min} a ${cantidadEnTexto(rango.max.valor, simboloDe(capacidad, rango.max.unidad, conocimiento))}`
}

/** Ayuda contextual (N-6): el rango DECLARADO en el catálogo, dicho como tal (no es un dato
 * verificado de la hoja de datos), o `null`. La resolución no se muestra en S1. */
export function ayudaDeRango(capacidad: CapacidadCuantitativa, conocimiento: ComponentKnowledge): string | null {
  const rango = rangoEnTexto(capacidad, conocimiento)
  return rango === null ? null : `Rango declarado en el catálogo: ${rango}.`
}
