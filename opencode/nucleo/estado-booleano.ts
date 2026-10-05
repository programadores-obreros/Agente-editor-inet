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
