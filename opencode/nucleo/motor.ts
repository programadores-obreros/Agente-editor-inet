// MotorDeProyecto — Gate 6. ÚNICA autoridad de mutación del `Proyecto` canónico.
//
// Ningún otro módulo del núcleo sostiene una referencia mutable al proyecto en
// memoria (core = `ir.ts`…`operaciones.ts`, funciones puras `(Proyecto, Operacion,
// Catalogo) → (borrador, motivos[])`, sin I/O). Este archivo coordina esas funciones
// puras con el `Almacen` (interfaz definida ACÁ — Gate 7 la implementa contra disco,
// en ese orden porque motor.ts va antes que almacen.ts en el plan de gates).
//
// Pipeline de `aplicarTransaccion` (T_diseno_consolidado.md §9.3, con la corrección de
// la revisión adversarial de Gate 8 — ver DECISIONS.md "hallazgo adversarial Gate 8"):
// baseRevision stale corta ANTES de clonar → clon del canónico → aplicadores puros
// mutan el borrador y acumulan motivos → si aparece un motivo `clasificacion:"rechazo"`
// (el de una operación individual, `motivosPropios`) se corta el LOTE ENTERO (el
// canónico nunca se tocó) → si el lote es representable a nivel de operación,
// `validarProyecto(borrador, catalogo)` UNA vez → **CUALQUIER motivo
// `clasificacion:"rechazo"` que ESTA validación post-lote produzca TAMBIÉN corta el
// lote entero**, exactamente igual que un rechazo por operación (defensa en
// profundidad: `validar-estructural.ts` puede emitir `REFERENCIA_INEXISTENTE` con
// `clasificacion:"rechazo"`, y antes de este fix el motor lo ignoraba) → recién si
// NINGÚN motivo final es rechazo: dry-run descarta el borrador; commit persiste-primero
// (orden fijo: `almacen.guardar(borrador)` ANTES de reemplazar la referencia canónica
// en memoria — si falla la escritura, la memoria nunca cambia). `revision` sube una vez
// por transacción, nunca por operación.
//
// El motor TAMBIÉN se niega a CONSTRUIRSE sobre un `proyectoInicial` que ya trae un
// motivo `clasificacion:"rechazo"` (misma validación, corrida una vez al armar el
// factory) — lanza `ErrorEstadoInicialInvalido`. Sin este chequeo, un consumidor que
// bypasee `cargarProyecto()` (que sí rechazaría un documento así con
// `REFERENCIA_ROTA_AL_CARGAR`) y empuje un `Proyecto` ya roto directo a
// `crearMotorDeProyecto` obtenía un motor "operable" que terminaba commiteando esa
// rotura en la primera transacción trivial — ver OPERATIONS.md §8.
//
// Revisión de arquitectura Gate 8 (§77) cerró dos backdoors potenciales en
// `DependenciasMotor`: `validacionAdicionalSoloTests` (antes `validarProyecto`) ya
// NO reemplaza la validación real — sólo puede AGREGARLE motivos (unión); y `clonar`
// inyectado se valida con un centinela al construir (`ErrorClonadoInvalido` si no
// aísla referencias). Ninguno de los dos es explotable en producción hoy porque
// nada los inyecta fuera de los tests, pero antes de que exista un consumidor de
// Fase 2 era el momento de cerrarlos.

import type { Proyecto } from "./ir.ts"
import type { Catalogo } from "./catalogo.ts"
import type { Motivo } from "./motivos.ts"
import { clonarProfundo, congelarProfundo } from "./canonico.ts"
import { validarProyecto as validarProyectoReal } from "./validar.ts"
import { aplicarOperacion, type ResultadoOperacion, type SobreOperacion } from "./operaciones.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// Interfaz de almacén — implementada en Gate 7 (almacen.ts, contra disco)
// ════════════════════════════════════════════════════════════════════════════════════

export type ResultadoGuardar = { readonly ok: true } | { readonly ok: false; readonly motivo: Motivo }
export type ResultadoCargaAlmacen =
  | { readonly ok: true; readonly proyecto: Proyecto; readonly diagnostico?: readonly Motivo[] }
  | { readonly ok: false; readonly motivos: readonly Motivo[] }

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

/**
 * El `proyectoInicial` (al construir) o el borrador (al commitear) trae un motivo
 * `clasificacion:"rechazo"` — nunca una excepción cruda sin estructura: `motivos`
 * lleva los mismos objetos `Motivo` que cualquier otro rechazo del núcleo, para que
 * quien la capture pueda tratarla igual que un `ResultadoTransaccion.ok:false`.
 */
export class ErrorEstadoInicialInvalido extends Error {
  readonly motivos: readonly Motivo[]
  constructor(motivos: readonly Motivo[]) {
    super(`No se puede construir el motor: el estado inicial trae ${motivos.length} motivo(s) clasificacion:"rechazo" (${motivos.map((m) => m.codigo).join(", ")})`)
    this.name = "ErrorEstadoInicialInvalido"
    this.motivos = motivos
  }
}

/**
 * El `clonar` inyectado devolvió la MISMA referencia que recibió, para un valor de
 * prueba — significa que NO aísla (una función identidad, por ejemplo). Aceptarlo
 * compartiría el mismo objeto en memoria entre el borrador y el canónico, rompiendo
 * el invariante central del motor (revisión de arquitectura Gate 8, §77).
 */
export class ErrorClonadoInvalido extends Error {
  constructor() {
    super('El "clonar" inyectado no aísla referencias: clonar(x) === x para un valor de prueba. Compartiría el mismo objeto entre el borrador y el canónico.')
    this.name = "ErrorClonadoInvalido"
  }
}

export interface DependenciasMotor {
  readonly proyectoInicial: Proyecto
  readonly catalogo: Catalogo
  readonly almacen: Almacen
  /** Inyectable para poder espiar en tests que "baseRevision obsoleta corta ANTES de
   * clonar" (T_diseno_consolidado.md §7, G6) — default: `clonarProfundo` real. El
   * motor valida, al construirse, que `clonar(x) !== x` para un centinela de prueba
   * (revisión de arquitectura Gate 8, §77): un `clonar` que no aísla referencias
   * (ej. una función identidad) tira `ErrorClonadoInvalido` en vez de aceptarse en
   * silencio — cerraría el aislamiento borrador/canónico que este archivo existe
   * para sostener. */
  readonly clonar?: <T>(valor: T) => T
  /**
   * SOLO para tests (revisión de arquitectura Gate 8, §77 — antes se llamaba
   * `validarProyecto` y RESEMPLAZABA la validación real, lo cual era un backdoor
   * potencial: un consumidor podía inyectar `() => []` y obtener un motor que
   * "aprueba todo"). La validación REAL (`validar.ts`) SIEMPRE corre, tanto al
   * construirse como en cada commit — esta función, si se inyecta, sólo puede
   * AGREGAR motivos al resultado real (unión, nunca reemplazo): sirve para simular,
   * sin fabricar un escenario explotable de verdad con las 8 operaciones públicas,
   * que una validación futura o distinta encuentre un motivo `clasificacion:"rechazo"`
   * post-lote. Nunca se inyecta en producción — el nombre lo dice.
   */
  readonly validacionAdicionalSoloTests?: (proyecto: Proyecto, catalogo: Catalogo) => readonly Motivo[]
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

  // Centinela: `clonar` inyectado tiene que aislar de verdad. Si `clonar(x) === x`
  // para un objeto de prueba descartable, es una función identidad (u otra que no
  // clona) — se rechaza en la construcción, antes de que comparta referencias entre
  // el borrador y el canónico (revisión de arquitectura Gate 8, §77).
  const centinelaClonado = { __centinelaClonar: true }
  if (clonar(centinelaClonado) === centinelaClonado) {
    throw new ErrorClonadoInvalido()
  }

  // La validación REAL siempre corre — `validacionAdicionalSoloTests` (si se
  // inyecta) sólo puede AGREGAR motivos, nunca reemplazar ni esconder el resultado
  // real (revisión de arquitectura Gate 8, §77: la versión anterior reemplazaba en
  // vez de unir, lo cual era un backdoor potencial).
  const validarProyecto = (proyecto: Proyecto, catalogo: Catalogo): readonly Motivo[] => {
    const motivosReales = validarProyectoReal(proyecto, catalogo)
    const motivosAdicionales = deps.validacionAdicionalSoloTests?.(proyecto, catalogo) ?? []
    return [...motivosReales, ...motivosAdicionales]
  }

  // El motor se NIEGA a construirse sobre un estado ya roto — misma validación que
  // corre después de cada lote (ver ejecutarLote más abajo), corrida una vez acá.
  const motivosIniciales = validarProyecto(deps.proyectoInicial, deps.catalogo)
  const rechazosIniciales = motivosIniciales.filter((m) => m.clasificacion === "rechazo")
  if (rechazosIniciales.length > 0) {
    throw new ErrorEstadoInicialInvalido(rechazosIniciales)
  }

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

    // 5. Lote representable a nivel de operación: se valida el estado resultante UNA
    // vez (no por operación).
    const motivosValidacion = validarProyecto(borrador, deps.catalogo)
    const motivosFinales = [...motivosPropios, ...motivosValidacion]

    // 5b. Defensa en profundidad (hallazgo adversarial Gate 8, item 4): si la
    // validación POST-lote encuentra igual un motivo `clasificacion:"rechazo"`
    // (hoy sólo `validar-estructural.ts` puede emitir uno así, `REFERENCIA_INEXISTENTE`
    // — `validar-tecnico.ts` nunca usa esa clasificación), el lote se descarta IGUAL
    // que un rechazo por operación: nada se persiste, el canónico no cambia.
    if (motivosValidacion.some((m) => m.clasificacion === "rechazo")) {
      return { ok: false, baseRevision, revisionActual: canonico.revision, motivos: motivosFinales, resultadosOperaciones }
    }

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
