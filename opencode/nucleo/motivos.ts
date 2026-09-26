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
