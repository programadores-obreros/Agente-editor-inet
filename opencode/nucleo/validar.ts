// Agregador de validación + readiness. Gate 4 (T_diseno_consolidado.md §6).
//
// `validarProyecto` junta estructural + técnico + semántico (nivel 5, Fase 1 = []
// passthrough — sin reglas propias todavía) y aplica el orden estable de
// `motivos.ts`. `derivarReadiness` deriva `incompleto`/`invalido`/`listo` como
// predicados INDEPENDIENTES: `listo` nunca se guarda, siempre se recalcula.
//
// Nunca muta el `Proyecto`: revalidar el mismo proyecto dos veces da EXACTAMENTE el
// mismo array de motivos (idempotencia) — no hay estado oculto entre corridas.

import type { Proyecto } from "./ir.ts"
import type { Catalogo } from "./catalogo.ts"
import type { Motivo } from "./motivos.ts"
import { compararMotivos } from "./motivos.ts"
import { validarEstructural } from "./validar-estructural.ts"
import { validarTecnico } from "./validar-tecnico.ts"

/** Nivel 5, semántico — Fase 1 no tiene reglas propias (passthrough explícito, no un
 * olvido: T_diseno_consolidado.md §6 lo dice literal). */
export function validarSemantico(_proyecto: Proyecto, _catalogo: Catalogo): readonly Motivo[] {
  return []
}

export function validarProyecto(proyecto: Proyecto, catalogo: Catalogo): readonly Motivo[] {
  const motivos = [...validarEstructural(proyecto), ...validarTecnico(proyecto, catalogo), ...validarSemantico(proyecto, catalogo)]
  return motivos.sort(compararMotivos)
}

export interface Readiness {
  readonly incompleto: boolean
  readonly invalido: boolean
  readonly listo: boolean
}

/** "Incompleto" es de FORMA (falta elegir placa, falta asignar un pin) — no depende
 * de `motivos[]`, es un predicado directo sobre el `Proyecto` (§11 l.775-784: la
 * familia CONEXION_INCOMPLETA/PIN_SIN_ASIGNAR alimenta readiness, no es severity). */
function detectarIncompleto(proyecto: Proyecto): boolean {
  if (proyecto.placa === null) return true
  return proyecto.componentes.some((c) => Object.values(c.pines).some((pin) => pin === null))
}

export function derivarReadiness(proyecto: Proyecto, motivos: readonly Motivo[]): Readiness {
  const incompleto = detectarIncompleto(proyecto)
  const invalido = motivos.some((m) => m.severidad === "blocking")
  return { incompleto, invalido, listo: !incompleto && !invalido }
}
