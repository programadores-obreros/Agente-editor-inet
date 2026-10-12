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
  // CK-CG1: para restricciones de uso con tiempo (período mínimo entre lecturas, espera tras el
  // encendido). UCUM `s`.
  segundo: { ucum: "s", simbolo: "s" },
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
  tiempo: { unidades: ["segundo"] },
} as const satisfies Record<string, { readonly unidades: readonly IdUnidad[] }>)

export type IdMagnitud = keyof typeof MAGNITUDES

/** Qué es una pata (dominio), no cómo se comporta eléctricamente. */
export const ROLES_DE_TERMINAL = congelarProfundo(["alimentacion", "tierra", "senal", "anodo", "catodo"] as const)

/** Tipo eléctrico de un terminal. `riel-fijo` = no acepta un GPIO lógico (D-04). */
export const ELECTRICAS = congelarProfundo(["digital", "analogica", "riel-fijo"] as const)

/** Sentido eléctrico real de un terminal asignable. */
export const DIRECCIONES = congelarProfundo(["entrada", "salida", "bidireccional"] as const)

/**
 * CK-CG1: CÓMO obtiene físicamente una pieza una capacidad (`catalogo.ts::LecturaDeCapacidad`).
 * Sólo lo necesario hoy: una capacidad sin `lectura` se lee por el nivel de su terminal (la
 * derivación por topología de Codegen S1); `protocolo` = la pieza habla un protocolo de
 * PROTOCOLOS_DE_LECTURA. Familias futuras (I2C, SPI, UART…) se agregan acá con evidencia.
 */
export const MECANISMOS_DE_LECTURA = congelarProfundo(["protocolo"] as const)

/**
 * CK-CG1: protocolos por los que una pieza ENTREGA una capacidad. Es un hecho de la pieza (qué
 * habla), nunca una implementación: sin librerías, clases, llamadas ni código. Un backend
 * elige su driver por este id, nunca por el id del componente.
 *
 * - `bus-unico-am2302`: formato de datos AM2302/DHT22 sobre un bus de un solo cable; el
 *   microcontrolador inicia cada lectura llevando el bus a bajo (Aosong, Manual AM2302 v1.1,
 *   §7.2 y §7.4). Otro formato (p. ej. el del DHT11) sería OTRO protocolo, no una variante.
 * - `bus-unico-dht11` (CK-CG2): formato de trama del chip DHT11 (ASAIR/Aosong) sobre el mismo
 *   bus de un cable. Difiere del AM2302 en lo que define al protocolo: el host inicia con el bus
 *   al menos 18 ms en bajo (no 0,8 ms) y los 40 bits son cuatro bytes entero/decimal más la
 *   suma de control, no dos enteros de 16 bits ×0,1 (Aosong, DHT11 Product Manual V1.3,
 *   2017-03-31, comunicación serie y tabla 10). Nombra el formato del chip, no la pieza del
 *   catálogo: cualquier pieza que hable este formato declara este id.
 */
export const PROTOCOLOS_DE_LECTURA = congelarProfundo({
  "bus-unico-am2302": { familia: "bus-unico" },
  "bus-unico-dht11": { familia: "bus-unico" },
} as const satisfies Record<string, { readonly familia: string }>)

/** Clase funcional de un componente. */
export const CLASES = congelarProfundo(["sensor", "actuador", "pasivo", "entrada"] as const)

/** Unidades válidas para `magnitud`, o `[]` si la magnitud no está registrada. */
export function unidadesDeMagnitud(magnitud: string): readonly string[] {
  return Object.hasOwn(MAGNITUDES, magnitud) ? MAGNITUDES[magnitud as IdMagnitud].unidades : []
}
