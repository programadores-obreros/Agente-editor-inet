// MotorDeProyecto — Gate 6. ÚNICA autoridad de mutación del `Proyecto` canónico.
//
// Ningún otro módulo del núcleo sostiene una referencia mutable al proyecto en
// memoria (core = `ir.ts`…`operaciones.ts`, funciones puras `(Proyecto, Operacion,
// Catalogo) → (borrador, motivos[])`, sin I/O). Este archivo coordina esas funciones
// puras con el `Almacen` (interfaz definida ACÁ — Gate 7 la implementa contra disco,
// en ese orden porque motor.ts va antes que almacen.ts en el plan de gates).
//
// Pipeline de `aplicarTransaccion` (T_diseno_consolidado.md §9.3, literal):
// baseRevision stale corta ANTES de clonar → clon del canónico → aplicadores puros
// mutan el borrador y acumulan motivos → si aparece un motivo `clasificacion:"rechazo"`
// se corta el LOTE ENTERO (el canónico nunca se tocó) → si el lote es representable,
// `validarProyecto(borrador, catalogo)` UNA vez → dry-run descarta el borrador;
// commit persiste-primero (orden fijo: `almacen.guardar(borrador)` ANTES de reemplazar
// la referencia canónica en memoria — si falla la escritura, la memoria nunca cambia).
// `revision` sube una vez por transacción, nunca por operación.

import type { Proyecto } from "./ir.ts"
import type { Catalogo } from "./catalogo.ts"
import type { Motivo } from "./motivos.ts"
import { clonarProfundo, congelarProfundo } from "./canonico.ts"
import { validarProyecto } from "./validar.ts"
import { aplicarOperacion, type ResultadoOperacion, type SobreOperacion } from "./operaciones.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// Interfaz de almacén — implementada en Gate 7 (almacen.ts, contra disco)
// ════════════════════════════════════════════════════════════════════════════════════

export type ResultadoGuardar = { readonly ok: true } | { readonly ok: false; readonly motivo: Motivo }
export type ResultadoCargaAlmacen = { readonly ok: true; readonly proyecto: Proyecto } | { readonly ok: false; readonly motivos: readonly Motivo[] }

export interface Almacen {
  guardar(proyecto: Proyecto): ResultadoGuardar
  cargar(id: string): ResultadoCargaAlmacen
  existe(id: string): boolean
}

// ════════════════════════════════════════════════════════════════════════════════════
// Resultado de transacción (envuelve N `ResultadoOperacion`, Gate 5)
// ════════════════════════════════════════════════════════════════════════════════════

export interface ResultadoTransaccion {
  readonly ok: boolean
  readonly baseRevision: number
  readonly revisionActual: number
  readonly motivos: readonly Motivo[]
  readonly resultadosOperaciones: readonly ResultadoOperacion[]
}

const TOPE_BUFFER_UNDO = 50

export interface DependenciasMotor {
  readonly proyectoInicial: Proyecto
  readonly catalogo: Catalogo
  readonly almacen: Almacen
  /** Inyectable para poder espiar en tests que "baseRevision obsoleta corta ANTES de
   * clonar" (T_diseno_consolidado.md §7, G6) — default: `clonarProfundo` real. */
  readonly clonar?: <T>(valor: T) => T
}

export interface MotorDeProyecto {
  getProyecto(): Proyecto
  proponer(operaciones: readonly SobreOperacion[]): ResultadoTransaccion
  aplicar(operacion: SobreOperacion): ResultadoTransaccion
  aplicarTransaccion(operaciones: readonly SobreOperacion[]): ResultadoTransaccion
  /** Buffer en memoria, acotado, NUNCA persistido (OD-21) — sólo transacciones aceptadas. */
  obtenerBufferUndo(): readonly ResultadoTransaccion[]
}

export function crearMotorDeProyecto(deps: DependenciasMotor): MotorDeProyecto {
  const clonar = deps.clonar ?? clonarProfundo
  let canonico: Proyecto = congelarProfundo(clonarProfundo(deps.proyectoInicial))
  const bufferUndo: ResultadoTransaccion[] = []

  function motivoRevisionObsoleta(baseRevision: number): Motivo {
    return {
      codigo: "BASE_REVISION_DESACTUALIZADA",
      categoria: "motor",
      severidad: "blocking",
      clasificacion: "rechazo",
      datos: { baseRevision, revisionActual: canonico.revision },
    }
  }

  function ejecutarLote(operaciones: readonly SobreOperacion[], comprometer: boolean): ResultadoTransaccion {
    const baseRevision = operaciones[0]?.baseRevision ?? canonico.revision

    // 1. baseRevision stale corta ANTES de clonar.
    if (baseRevision !== canonico.revision) {
      return { ok: false, baseRevision, revisionActual: canonico.revision, motivos: [motivoRevisionObsoleta(baseRevision)], resultadosOperaciones: [] }
    }

    // 2. Clon del canónico — el borrador se muta localmente, el canónico nunca se toca.
    let borrador = clonar(canonico)
    const motivosPropios: Motivo[] = []
    const resultadosOperaciones: ResultadoOperacion[] = []
    let rechazada = false

    // 3. Aplicadores puros, uno por uno, acumulando motivos.
    for (const operacion of operaciones) {
      const { proyecto: siguiente, motivos } = aplicarOperacion(borrador, operacion, deps.catalogo)
      motivosPropios.push(...motivos)
      resultadosOperaciones.push({
        ok: !motivos.some((m) => m.clasificacion === "rechazo"),
        idOperacion: operacion.idOperacion,
        idTransaccion: operacion.idTransaccion,
        baseRevision: operacion.baseRevision,
        revisionActual: baseRevision,
        motivos,
        proyecto: siguiente,
      })
      if (motivos.some((m) => m.clasificacion === "rechazo")) {
        rechazada = true
        break // corta el lote entero — el canónico nunca se tocó
      }
      borrador = siguiente
    }

    // 4. Si el lote entero tiene un rechazo, se descarta completo — sin cambios parciales.
    if (rechazada) {
      return { ok: false, baseRevision, revisionActual: canonico.revision, motivos: motivosPropios, resultadosOperaciones }
    }

    // 5. Lote representable: se valida el estado resultante UNA vez (no por operación).
    const motivosValidacion = validarProyecto(borrador, deps.catalogo)
    const motivosFinales = [...motivosPropios, ...motivosValidacion]

    if (!comprometer) {
      // proponer(): dry-run — se descarta el borrador, nunca se persiste, nunca sube revision.
      return { ok: true, baseRevision, revisionActual: canonico.revision, motivos: motivosFinales, resultadosOperaciones }
    }

    // 6. Commit: persistir PRIMERO, recién después reemplazar la referencia canónica.
    const proyectoFinal = congelarProfundo({ ...borrador, revision: canonico.revision + 1 })
    const resultadoGuardar = deps.almacen.guardar(proyectoFinal)
    if (!resultadoGuardar.ok) {
      return { ok: false, baseRevision, revisionActual: canonico.revision, motivos: [...motivosFinales, resultadoGuardar.motivo], resultadosOperaciones }
    }

    canonico = proyectoFinal // swap — recién acá cambia la memoria
    const resultado: ResultadoTransaccion = { ok: true, baseRevision, revisionActual: canonico.revision, motivos: motivosFinales, resultadosOperaciones }
    bufferUndo.push(resultado)
    if (bufferUndo.length > TOPE_BUFFER_UNDO) bufferUndo.shift()
    return resultado
  }

  return {
    getProyecto: () => canonico,
    proponer: (operaciones) => ejecutarLote(operaciones, false),
    aplicar: (operacion) => ejecutarLote([operacion], true),
    aplicarTransaccion: (operaciones) => ejecutarLote(operaciones, true),
    obtenerBufferUndo: () => bufferUndo.slice(),
  }
}
