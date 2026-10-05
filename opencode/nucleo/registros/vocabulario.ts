// Registros de vocabulario del catálogo — Component Knowledge F2a (CK-01 / CK-06,
// `component-knowledge/18_F2A_SCOPE.md` §2 F2a-1).
//
// Los vocabularios que el catálogo usa para describir piezas (magnitudes, unidades, roles
// de terminal, tipos eléctricos, direcciones y clases) son DATOS, y los tipos TS de
// `catalogo.ts` se DERIVAN de acá (`keyof typeof`, `(typeof X)[number]`). Antes eran uniones
// cerradas en `catalogo.ts` copiadas a mano en la admisión (`conocimiento/admision.ts`).
// Ahora hay una sola fuente: agregar un valor es agregar un dato acá, y `typecheck` sigue
// atrapando un typo en los datos de las piezas.
//
// Los ids son API PERSISTIDA (la IR guarda `umbral.unidad`, `umbral.magnitud`): nunca se
// renombran ni se reinterpretan (CTR-008). El código UCUM y el símbolo son atributos de la
// unidad, no su id (CK-06).
//
// Fuera del hash semántico en esta etapa: la proyección de identidad
// (`catalogo.ts::proyeccionSemanticaCatalogo`) no lee este archivo, igual que antes no leía
// las uniones de tipos ni la tabla de la admisión. Entran al hash en el cambio coordinado
// de catálogo, no acá.
//
// Puro, sin I/O, sin nombres de componentes ni de renderer.

import { congelarProfundo } from "../canonico.ts"

/** Unidades. id interno (persistido) → código UCUM (unitsofmeasure.org) + símbolo SI. */
export const UNIDADES = congelarProfundo({
  celsius: { ucum: "Cel", simbolo: "°C" },
  fahrenheit: { ucum: "[degF]", simbolo: "°F" },
  cm: { ucum: "cm", simbolo: "cm" },
  porcentaje: { ucum: "%", simbolo: "%" },
  ninguna: { ucum: "1", simbolo: "" },
  ohm: { ucum: "Ohm", simbolo: "Ω" },
  volt: { ucum: "V", simbolo: "V" },
} as const)

export type IdUnidad = keyof typeof UNIDADES

/**
 * Magnitudes y las unidades en que se pueden expresar. La información de la magnitud va en
 * la magnitud, nunca en la unidad (BIPM, SI Brochure §5.4.7): la humedad relativa es
 * magnitud `humedad` en `porcentaje`, no una unidad "%RH".
 */
export const MAGNITUDES = congelarProfundo({
  temperatura: { unidades: ["celsius", "fahrenheit"] },
  distancia: { unidades: ["cm"] },
  humedad: { unidades: ["porcentaje"] },
  estadoBooleano: { unidades: ["ninguna"] },
  porcentaje: { unidades: ["porcentaje"] },
  resistencia: { unidades: ["ohm"] },
  tension: { unidades: ["volt"] },
} as const satisfies Record<string, { readonly unidades: readonly IdUnidad[] }>)

export type IdMagnitud = keyof typeof MAGNITUDES

/** Qué es una pata (dominio), no cómo se comporta eléctricamente. */
export const ROLES_DE_TERMINAL = congelarProfundo(["alimentacion", "tierra", "senal", "anodo", "catodo"] as const)

/** Tipo eléctrico de un terminal. `riel-fijo` = no acepta un GPIO lógico (D-04). */
export const ELECTRICAS = congelarProfundo(["digital", "analogica", "riel-fijo"] as const)

/** Sentido eléctrico real de un terminal asignable. */
export const DIRECCIONES = congelarProfundo(["entrada", "salida", "bidireccional"] as const)

/** Clase funcional de un componente. */
export const CLASES = congelarProfundo(["sensor", "actuador", "pasivo", "entrada"] as const)

/** Unidades válidas para `magnitud`, o `[]` si la magnitud no está registrada. */
export function unidadesDeMagnitud(magnitud: string): readonly string[] {
  return Object.hasOwn(MAGNITUDES, magnitud) ? MAGNITUDES[magnitud as IdMagnitud].unidades : []
}
