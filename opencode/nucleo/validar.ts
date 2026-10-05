// Agregador de validación + readiness. Gate 4 (T_diseno_consolidado.md §6).
//
// `validarProyecto` junta estructural + técnico + semántico (nivel 5, Phase 3: reglas
// de comportamiento, ver `validarSemantico`) y aplica el orden estable de
// `motivos.ts`. `derivarReadiness` deriva `incompleto`/`invalido`/`listo` como
// predicados INDEPENDIENTES: `listo` nunca se guarda, siempre se recalcula.
//
// Nunca muta el `Proyecto`: revalidar el mismo proyecto dos veces da EXACTAMENTE el
// mismo array de motivos (idempotencia) — no hay estado oculto entre corridas.

import type { Proyecto } from "./ir.ts"
import type { Catalogo } from "./catalogo.ts"
import type { Motivo } from "./motivos.ts"
import { compararMotivos } from "./motivos.ts"
import { compararIdsLocales } from "./id.ts"
import { validarEstructural } from "./validar-estructural.ts"
import { validarTecnico } from "./validar-tecnico.ts"

/**
 * Nivel 5, semántico (Phase 3, vertical #1, contrato B3). UNA función genérica, guiada
 * ÚNICAMENTE por datos del catálogo (`clase`, `capacidades`) — nunca por un id de tipo.
 * Los tres motivos son blocking + representable (Path A: el Engine commitea igual y el
 * proyecto queda `listo:false`); jamás `clasificacion: "rechazo"`.
 * - `COMPORTAMIENTO_INCOMPLETO`: `datos.faltan` ⊆ [sensor, estado (la triada), actuador,
 *   salida (la acción)], en ese orden.
 * - `MULTIPLES_AUTORIDADES_ACTUADOR` (Multi-Rule Safety, modelo B): dos o más reglas con
 *   el mismo `entonces.actuador` (aunque estén incompletas). Uno por regla involucrada;
 *   `datos { actuador, comportamiento, otras }`. Blocking y representable.
 * - `ACCION_NO_SOPORTADA` (Semantic Vertical #3, D-11): `entonces.accion` que el tipo del
 *   actuador no declara (`ComponenteCatalogo.acciones`); `datos { componente, accion,
 *   soportadas }`. Blocking y representable, nunca un rechazo de la operación.
 * - `ACTUADOR_INVALIDO`: `entonces.actuador` cuyo catálogo no es `clase:"actuador"`. Un
 *   tipo desconocido del catálogo no se emite acá (`CATALOGO_COMPONENTE_DESCONOCIDO`).
 * - `SENSOR_INVALIDO`: `cuando.sensor` SIN triada cuyo catálogo no declara NINGUNA
 *   capacidad. Con la triada presente, la capacidad exacta ya la diagnostica otro nivel.
 */
export function validarSemantico(proyecto: Proyecto, catalogo: Catalogo): readonly Motivo[] {
  const motivos: Motivo[] = []
  for (const b of proyecto.comportamientos) {
    const entidad = { tipo: "comportamiento" as const, id: b.id }
    const semantico = (codigo: string, datos: Record<string, unknown>): Motivo => ({ codigo, categoria: "semantica", severidad: "blocking", clasificacion: "representable", entidad, datos })
    const cuando = b.cuando
    const entonces = b.entonces
    const tieneEstado = cuando?.capacidad !== undefined && cuando.comparador !== undefined && cuando.umbral !== undefined

    const faltan: string[] = []
    if (cuando?.sensor === undefined) faltan.push("sensor")
    if (!tieneEstado) faltan.push("estado")
    if (entonces?.actuador === undefined) faltan.push("actuador")
    if (entonces?.accion === undefined) faltan.push("salida")
    if (faltan.length > 0) motivos.push(semantico("COMPORTAMIENTO_INCOMPLETO", { faltan }))

    if (entonces?.actuador !== undefined) {
      const comp = proyecto.componentes.find((c) => c.id === entonces.actuador)
      const cat = comp ? catalogo.obtenerComponente(comp.tipo) : undefined
      if (comp && cat && cat.clase !== "actuador") motivos.push(semantico("ACTUADOR_INVALIDO", { componente: comp.id, clase: cat.clase }))
      // Semantic Vertical #3 (D-11): el estado objetivo tiene que estar entre los que el
      // TIPO del actuador declara. Representable: la regla se guarda, recarga y edita;
      // sólo deja el proyecto no-listo. Cubre también una entrada usada como actuador.
      const accion = entonces.accion
      if (comp && cat && accion !== undefined && !(cat.acciones ?? []).includes(accion)) {
        motivos.push(semantico("ACCION_NO_SOPORTADA", { componente: comp.id, accion, soportadas: [...(cat.acciones ?? [])] }))
      }
    }

    if (cuando?.sensor !== undefined && !tieneEstado) {
      const comp = proyecto.componentes.find((c) => c.id === cuando.sensor)
      const cat = comp ? catalogo.obtenerComponente(comp.tipo) : undefined
      if (comp && cat && cat.capacidades.length === 0) motivos.push(semantico("SENSOR_INVALIDO", { componente: comp.id }))
    }
  }
  motivos.push(...autoridadesMultiples(proyecto))
  return motivos
}

/**
 * Multi-Rule Safety (modelo B): en el modelo LEVEL cada actuador tiene como máximo UN
 * propietario semántico de su estado sostenido. La propiedad se DERIVA del IR por
 * referencia: una regla reclama un actuador desde que existe `entonces.actuador = X`,
 * aunque esté incompleta. Si dos o más reglas reclaman el mismo actuador, CADA una
 * recibe `MULTIPLES_AUTORIDADES_ACTUADOR` (blocking, representable): nunca se rechaza
 * la operación, nunca se elige un ganador. No depende del orden del array, de los ids,
 * de la condición, de la acción, del catálogo ni de la vista. No se persiste nada.
 */
function autoridadesMultiples(proyecto: Proyecto): readonly Motivo[] {
  const reglasPorActuador = new Map<string, string[]>()
  for (const b of proyecto.comportamientos) {
    const actuador = b.entonces?.actuador
    if (actuador === undefined) continue
    reglasPorActuador.set(actuador, [...(reglasPorActuador.get(actuador) ?? []), b.id])
  }
  const motivos: Motivo[] = []
  for (const [actuador, reglas] of reglasPorActuador) {
    if (reglas.length < 2) continue
    const ordenadas = [...reglas].sort(compararIdsLocales)
    for (const id of ordenadas) {
      motivos.push({
        codigo: "MULTIPLES_AUTORIDADES_ACTUADOR",
        categoria: "semantica",
        severidad: "blocking",
        clasificacion: "representable",
        entidad: { tipo: "comportamiento", id },
        datos: { actuador, comportamiento: id, otras: ordenadas.filter((x) => x !== id) },
      })
    }
  }
  return motivos
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
