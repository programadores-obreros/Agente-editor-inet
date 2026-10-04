// Identidad de catálogo de un proyecto — Component System Foundation #1, F3/F4
// (Decision Freeze, D-03 / 02-CATALOG-IDENTITY-AND-DR03.md I-6..I-11).
//
// `Proyecto.catalogoVersion` + `Proyecto.catalogoHash` son createdWith: el catálogo
// semántico con el que se CREÓ el proyecto. Son INMUTABLES: ni la carga, ni el commit,
// ni una futura revalidación o migración los sobrescriben.
//
// I-11 — compatibilidad sin big-bang. El catálogo 2.0.0 cambió el DOMINIO del hash (de
// "todo el catálogo, presentación incluida" a "sólo el núcleo semántico"). Sin esta
// tabla, todo proyecto guardado antes de 2.0.0 mostraría un desfase falso. La tabla es
// FIJA y explícita: no se recalcula el formato viejo en runtime. Una entrada dice "este
// hash heredado identifica el mismo catálogo semántico que este hash nuevo".
//
// Si mañana el catálogo semántico cambia, ESTA TABLA NO SE TOCA: los proyectos
// heredados siguen apuntando al catálogo semántico de 2.0.0, y el desfase contra el
// catálogo nuevo se ve como corresponde (`CATALOGO_CAMBIO_DETECTADO`).

/** hash heredado (dominio viejo) → hash semántico equivalente. */
export const IDENTIDADES_HEREDADAS: Readonly<Record<string, string>> = Object.freeze({
  // Catálogo 1.0.0, el que escribía `composicion-raiz.ts` hasta el commit 4c22c23
  // (medido sobre ese commit) ≡ catálogo semántico 2.0.0 (mismos hechos eléctricos;
  // sólo cambió qué se hashea).
  "708fe82235f66231afdb5a6040d7b903b4f80bb8473901df66889703e16c9870": "878011f7ec8c586adc632db819e5bcb05fc7731237d21caf01de222574a3a2f6",
})

/** El hash semántico con el que hay que COMPARAR el createdWith de un proyecto. Nunca
 * se escribe en el proyecto: es sólo para comparar. */
export function hashDeCreacionEfectivo(hashGuardado: string, tabla: Readonly<Record<string, string>> = IDENTIDADES_HEREDADAS): string {
  return tabla[hashGuardado] ?? hashGuardado
}

export function catalogoDeCreacionCoincide(hashGuardado: string, hashActivo: string, tabla: Readonly<Record<string, string>> = IDENTIDADES_HEREDADAS): boolean {
  return hashDeCreacionEfectivo(hashGuardado, tabla) === hashActivo
}
