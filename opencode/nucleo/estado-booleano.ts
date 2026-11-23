// Formas canónicas de una condición sobre un estado BOOLEANO — Semantic Vertical #3
// (OPEN-4). Única fuente normativa: la proyección (frase/Blockly), el vocabulario del
// agente y cualquier consumidor futuro leen de acá; nadie vuelve a escribir la tríada.
//
// Una capacidad cuya magnitud es `estadoBooleano` (p. ej. `pulsador.estadoBooleano`)
// tiene exactamente dos valores. Cada uno se expresa con la tríada que la IR ya tiene
// (`capacidad` + `comparador` + `umbral`), sin cambio de esquema:
//   verdadero ⇔ estadoBooleano >= 1
//   falso     ⇔ estadoBooleano <  1   (complemento EXACTO de la anterior)
// Otra tríada equivalente (p. ej. `<= 0`, `> 0`) sigue siendo representable, pero NO es
// canónica: se proyecta como "condición avanzada" (contrato existente).
//
// Genérico por magnitud: ningún nombre de componente acá. Los rótulos para el alumno
// ("presionado"/"suelto") viven en el anexo de pedagogía, nunca en este archivo.

import type { CuandoComportamiento, Comparador } from "./ir.ts"

export const MAGNITUD_BOOLEANA = "estadoBooleano"

export type ValorBooleano = "verdadero" | "falso"

/** Orden canónico de presentación. */
export const VALORES_BOOLEANOS: readonly ValorBooleano[] = Object.freeze(["verdadero", "falso"])

const UMBRAL = Object.freeze({ valor: 1, unidad: "ninguna", magnitud: MAGNITUD_BOOLEANA })

const COMPARADOR_DE: Readonly<Record<ValorBooleano, Comparador>> = Object.freeze({ verdadero: ">=", falso: "<" })

export interface CondicionBooleana {
  readonly capacidad: string
  readonly comparador: Comparador
  readonly umbral: { readonly valor: number; readonly unidad: string; readonly magnitud: string }
}

/** La tríada canónica de `valor` sobre la capacidad booleana `capacidad`. */
export function condicionBooleanaCanonica(capacidad: string, valor: ValorBooleano): CondicionBooleana {
  return Object.freeze({ capacidad, comparador: COMPARADOR_DE[valor], umbral: UMBRAL })
}

/** `verdadero`/`falso` si `cuando` es EXACTAMENTE una forma canónica; si no, `undefined`. */
export function valorBooleanoDeCondicion(cuando: (Pick<CuandoComportamiento, "umbral"> & { readonly comparador?: string }) | undefined): ValorBooleano | undefined {
  const u = cuando?.umbral
  if (!cuando || u === undefined || u.valor !== UMBRAL.valor || u.unidad !== UMBRAL.unidad || u.magnitud !== UMBRAL.magnitud) return undefined
  if (cuando.comparador === COMPARADOR_DE.verdadero) return "verdadero"
  if (cuando.comparador === COMPARADOR_DE.falso) return "falso"
  return undefined
}

export type DesenlaceBooleano = "siempre" | "nunca" | "decide"

/**
 * Qué pasa con «estado <comparador> <umbral>» cuando el estado sólo puede valer 0 o 1
 * (NUC-01, auditoría de código del 2026-11-22; decisión del owner del 2026-11-23).
 *
 * La tríada es la misma que la de una temperatura, así que se puede escribir «< 5»
 * (cierto con 0 y con 1) o «>= 2» (falso con los dos). Esas reglas no dependen del
 * sensor: el actuador queda siempre igual, y el programa generado compila y hace otra
 * cosa que lo que el alumno pidió.
 *
 *   "siempre" — cierta con 0 y con 1
 *   "nunca"   — falsa con 0 y con 1
 *   "decide"  — separa el 0 del 1. Acá caen las dos canónicas y también las formas raras
 *               pero equivalentes («> 0», «<= 0.5»): no son un error.
 *
 * Lo que no se puede evaluar (comparador desconocido, umbral que no es un número) da
 * "decide": esta función no adivina, y esos casos ya tienen su propio motivo.
 */
export function desenlaceDeCondicionBooleana(comparador: unknown, umbral: unknown): DesenlaceBooleano {
  if (typeof umbral !== "number" || Number.isNaN(umbral)) return "decide"
  const cumple = (estado: 0 | 1): boolean | undefined => {
    switch (comparador) {
      case ">":
        return estado > umbral
      case ">=":
        return estado >= umbral
      case "<":
        return estado < umbral
      case "<=":
        return estado <= umbral
      default:
        return undefined
    }
  }
  const conCero = cumple(0)
  const conUno = cumple(1)
  if (conCero === undefined || conUno === undefined) return "decide"
  if (conCero && conUno) return "siempre"
  if (!conCero && !conUno) return "nunca"
  return "decide"
}
