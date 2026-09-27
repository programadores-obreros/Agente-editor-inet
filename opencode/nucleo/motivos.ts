// Vocabulario mínimo de "Motivo" para Gate 1 (identidad de placa).
//
// Esta es la porción MÍNIMA del tipo que describe T_diseno_consolidado.md §5.1: sólo el
// tipo, sin builders, sin el orden estable (categoría → entidad.id → código) y sin la
// tabla de clasificación completa — esas piezas pertenecen a los gates que las ejercitan
// de verdad (validar.ts / operaciones.ts, G4/G5). Ampliar este archivo en un gate
// posterior es válido; lo que no vale es que placas.ts (u otro módulo de Gate 1) invente
// su propio tipo de error en paralelo.
//
// Todos los identificadores en español rioplatense, siguiendo la decisión de nomenclatura
// de §0 del diseño consolidado (`docs/programacion-intencion/DECISIONS.md`, entrada OD-01).
//
// Phase 1.1 (remediación de hallazgos externos, PHASE_1_EXTERNAL_FINDINGS.md) agrega un
// código nuevo al vocabulario ya existente (`ID_DUPLICADO` se reusa, ver `id.ts`):
// `CONTADOR_ID_INCONSISTENTE` — categoria "estructural", clasificacion "rechazo" siempre
// — cuando `Proyecto.siguienteIdLocal` no es estrictamente mayor que el número más alto
// entre los ids locales (`cmp-`/`conn-`/`beh-`) ya presentes. Ver `id.ts`
// (`validarIdsYContador`) y `docs/programacion-intencion/IR-SPEC.md` §6.1.

/** Categorías de motivo del núcleo completo (§5.1). Gate 1 sólo emite "operacion". */
export type CategoriaMotivo =
  | "estructural"
  | "referencial"
  | "tecnica"
  | "componente"
  | "semantica"
  | "readiness"
  | "pedagogica"
  | "operacion"
  | "motor"
  | "almacen"

/** A qué entidad de la IR se refiere el motivo, cuando corresponde. */
export type EntidadMotivo = {
  readonly tipo: "componente" | "conexion" | "comportamiento" | "placa" | "lote"
  readonly id: string
}

/**
 * Un motivo estructurado: nunca una excepción cruda, nunca una cadena de texto suelta.
 *
 * `clasificacion` viaja CON el motivo (nunca en una tabla central del motor — ver §5.1
 * del diseño consolidado): "representable" = Camino A (la operación commitea con el
 * motivo como advertencia/bloqueo post-commit), "rechazo" = Camino B (la operación no
 * se aplica). En Gate 1 sólo se usa "rechazo": una placa desconocida/ambigua/no
 * soportada nunca se "asigna igual".
 */
export type Motivo = {
  readonly codigo: string
  readonly categoria: CategoriaMotivo
  readonly severidad: "info" | "warning" | "blocking"
  readonly clasificacion?: "representable" | "rechazo"
  readonly entidad?: EntidadMotivo
  readonly datos?: Readonly<Record<string, unknown>>
}

// ════════════════════════════════════════════════════════════════════════════════════
// Orden estable — Gate 4 (validar.ts lo usa para agregar sin mezclar el orden entre
// corridas: (prioridad fija de categoría) → entidad.id (lexicográfico) → código).
// ════════════════════════════════════════════════════════════════════════════════════

/** Prioridad fija: el índice en este array ES la prioridad (0 = primero). */
export const ORDEN_CATEGORIAS: readonly CategoriaMotivo[] = [
  "estructural",
  "referencial",
  "tecnica",
  "componente",
  "semantica",
  "readiness",
  "pedagogica",
  "operacion",
  "motor",
  "almacen",
]

/** Comparador estable para `Array.prototype.sort` — nunca cambia entre corridas para
 * el mismo conjunto de motivos (determinista, sin depender de `Date.now()`/random). */
export function compararMotivos(a: Motivo, b: Motivo): number {
  const pa = ORDEN_CATEGORIAS.indexOf(a.categoria)
  const pb = ORDEN_CATEGORIAS.indexOf(b.categoria)
  if (pa !== pb) return pa - pb
  const idA = a.entidad?.id ?? ""
  const idB = b.entidad?.id ?? ""
  if (idA !== idB) return idA < idB ? -1 : 1
  if (a.codigo !== b.codigo) return a.codigo < b.codigo ? -1 : 1
  return 0
}
