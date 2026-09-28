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
//
// Phase 1.1 (hallazgo externo E3-01, CRÍTICO, PHASE_1_EXTERNAL_FINDINGS.md):
// `operaciones[0]?.baseRevision ?? canonico.revision` trataba "no hay primera
// operación" (lote vacío) y "la primera operación trae `baseRevision:null`/ausente/de
// otro tipo" exactamente IGUAL — en ambos casos el `??` sustituía por la revisión
// ACTUAL, así que el chequeo de stale write (`baseRevision !== canonico.revision`) se
// auto-satisfacía SIEMPRE. Un cliente con una vista vieja que mandara
// `baseRevision:null` (campo perdido en un serializador, o un cliente malicioso que
// "siempre gana") pasaba como si hubiera confirmado conocer la revisión vigente —
// lost update silencioso, exactamente lo que brief §9.3/§33 prohíben. `ejecutarLote`
// ahora separa los dos casos: lote vacío es un no-op explícito ANTES de mirar
// `baseRevision` (hallazgo E3-01, MENOR, comparte la misma raíz — ver más abajo), y
// recién con al menos una operación se exige que su `baseRevision` sea un ENTERO NO
// NEGATIVO de verdad (`esEnteroNoNegativo`, mismo criterio que ya usa `cargador.ts`
// para `revision`/`siguienteIdLocal`) — `null`/ausente/string/NaN/±Infinity/negativo/
// no entero rechazan con `BASE_REVISION_INVALIDA` (nuevo, categoría `motor`), un
// código DISTINTO de `BASE_REVISION_DESACTUALIZADA`: el primero es "el sobre no trae
// un dato válido", el segundo es "el dato es válido pero ya no coincide con lo
// vigente" — nunca deben confundirse ni fusionarse en el mismo código.
//
// Phase 1.1 (hallazgo externo E3-05, MENOR, misma raíz que E3-01): un lote vacío
// (`aplicarTransaccion([])`) commiteaba igual — `ok:true`, revisión sube, se persiste
// una copia idéntica del proyecto sin cambio semántico alguno (ruido de historial/
// undo/disco). El contrato (OPERATIONS.md/IR-SPEC.md) no determina si "cero
// operaciones" debe ser rechazo o no-op — ambas opciones son defendibles y ninguna
// arriesga datos — así que Phase 1.1 elige la que NUNCA compromete nada: un no-op
// explícito (`ok:true`, sin subir revisión, sin llamar a `almacen.guardar`, sin
// agregar al buffer de undo), documentado y testeado (ver OPERATIONS.md §9 y
// `tests/nucleo-motor.test.mjs`).

import type { Proyecto } from "./ir.ts"
import type { Catalogo } from "./catalogo.ts"
import type { Motivo } from "./motivos.ts"
import { clonarProfundo, congelarProfundo } from "./canonico.ts"
import { validarProyecto as validarProyectoReal } from "./validar.ts"
import { validarIdsYContador } from "./id.ts"
import { validarFormaProyecto } from "./cargador.ts"
import { aplicarOperacion, type ResultadoOperacion, type SobreOperacion } from "./operaciones.ts"

/** Mismo criterio que `cargador.ts` (Gate 2) para `revision`/`siguienteIdLocal`:
 * `0` es un entero no negativo perfectamente válido — nunca "falsy"/"ausente". Phase
 * 1.1, hallazgo externo E3-01. */
function esEnteroNoNegativo(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0
}

// ════════════════════════════════════════════════════════════════════════════════════
// Interfaz de almacén — implementada en Gate 7 (almacen.ts, contra disco)
// ════════════════════════════════════════════════════════════════════════════════════

export type ResultadoGuardar = { readonly ok: true } | { readonly ok: false; readonly motivo: Motivo }
export type ResultadoCargaAlmacen =
  | { readonly ok: true; readonly proyecto: Proyecto; readonly diagnostico?: readonly Motivo[] }
  | { readonly ok: false; readonly motivos: readonly Motivo[] }

/**
 * Puerto de persistencia (Gate 7, `almacen.ts`, contra disco) — es un puerto INTERNO
 * del composition root, NUNCA una segunda autoridad de escritura (Phase 1.1,
 * hallazgo externo E3-04b, MAJOR — `DECISIONS.md`, entrada "Almacen es un puerto
 * interno del composition root"). El `MotorDeProyecto` es "la única autoridad de
 * mutación" (brief §9.4/§10): quien construye un `Almacen` (`crearAlmacen()`) lo
 * inyecta UNA vez en `crearMotorDeProyecto({ almacen })` y DEJA de tocarlo — retener
 * esa misma referencia para llamar `guardar()`/`cargar()` por fuera del motor es un
 * uso NO CONTRACTUAL: nada valida `baseRevision`, nada corre `validarProyecto`, no se
 * genera ningún `ResultadoTransaccion`, y el motor en memoria queda desincronizado de
 * lo persistido sin ningún aviso (evidencia/e3/scripts/e1_motor_flujo.mjs TEST 5).
 * TypeScript no impide este uso (es un contrato de USO, no de tipos) — documentado
 * acá, en el mismo lugar donde un consumidor futuro lee esta interfaz, a propósito.
 */
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
 * El `clonar` inyectado devolvió la MISMA referencia que recibió (nivel superior), o
 * una referencia NUEVA en el nivel superior que igual comparte por referencia un
 * objeto ANIDADO — significa que NO aísla de verdad (una función identidad, o una
 * copia SUPERFICIAL tipo `(v) => ({...v})`, Phase 1.1, hallazgo externo E3-02).
 * Aceptarlo compartiría objetos en memoria entre el borrador y el canónico, rompiendo
 * el invariante central del motor (revisión de arquitectura Gate 8, §77).
 */
export class ErrorClonadoInvalido extends Error {
  constructor(nivel: "superior" | "anidado") {
    super(
      nivel === "superior"
        ? 'El "clonar" inyectado no aísla referencias: clonar(x) === x para un valor de prueba. Compartiría el mismo objeto entre el borrador y el canónico.'
        : 'El "clonar" inyectado hace una copia SUPERFICIAL: el nivel superior es una referencia nueva, pero un objeto anidado dentro sigue siendo la MISMA referencia que en el original. Compartiría ese objeto anidado entre el borrador y el canónico.',
    )
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

  // Centinela: `clonar` inyectado tiene que aislar de verdad, en TODOS los niveles de
  // anidamiento — no sólo el superior. Si `clonar(x) === x` para un objeto de prueba
  // descartable, es una función identidad (u otra que no clona); si el nivel superior
  // sale como una referencia NUEVA pero `x.anidado` sigue siendo la MISMA referencia
  // que en el original, es una copia SUPERFICIAL (`(v) => ({...v})`, Phase 1.1,
  // hallazgo externo E3-02: el centinela original, plano, no detectaba este caso) —
  // ambos se rechazan en la construcción, antes de que compartan referencias entre el
  // borrador y el canónico (revisión de arquitectura Gate 8, §77).
  const centinelaClonado = { __centinelaClonar: true, anidado: { __centinelaClonar: true } }
  const centinelaClonadoResultado = clonar(centinelaClonado)
  if (centinelaClonadoResultado === centinelaClonado) {
    throw new ErrorClonadoInvalido("superior")
  }
  if (centinelaClonadoResultado.anidado === centinelaClonado.anidado) {
    throw new ErrorClonadoInvalido("anidado")
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
  // corre después de cada lote (ver ejecutarLote más abajo), corrida una vez acá. Se
  // le suma `validarIdsYContador` (Phase 1.1, hallazgos externos E1-01/E1-02): la
  // MISMA regla que corre en `cargarProyecto()` (Gate 2), acá para la puerta de un
  // `Proyecto` que bypasea el loader (`proyectoInicial` armado a mano o importado de
  // otra fuente, IR-SPEC.md §6). Deliberadamente NO se agrega al pipeline continuo de
  // `validarProyecto` de abajo (que TAMBIÉN corre después de cada commit): esa
  // validación corre sobre cualquier `Proyecto`, incluidos fixtures de test armados a
  // mano que no pretenden simular el contador real (`tests/nucleo-validacion.test.mjs`)
  // — el contador, una vez consistente al construirse, se mantiene consistente por
  // inducción (los 3 aplicadores que generan un id local sólo lo INCREMENTAN, nunca lo
  // decrementan — ver M22, regresión en `tests/nucleo-operaciones.test.mjs`).
  //
  // Phase 1.1 (hallazgo externo CP-01, checkpoint de T5, tratado como CRÍTICO):
  // ninguna de las dos validaciones de arriba mira la FORMA/SCHEMA del
  // `proyectoInicial` — ambas asumen un `Proyecto` YA bien tipado y sólo leen
  // `componentes`/`conexiones`/`comportamientos`/`siguienteIdLocal`. Una clave
  // desconocida en la raíz, `revision`/`siguienteIdLocal` con tipo o valor
  // incorrecto, un `schemaVersion` no soportado, o un componente con `tipo`/`pines`
  // de tipo basura pasaban SIN diagnóstico; con `undefined`/`null`/`{}`/`[]` ninguna
  // de las dos llegaba siquiera a un `Motivo` — explotaban con un `TypeError` crudo.
  // `validarFormaProyecto` (`cargador.ts`) es la MISMA función que usa
  // `cargarProyecto()` tras `JSON.parse` — nunca una copia — y corre PRIMERO acá.
  // Si la forma ya está rota, sus motivos (todos `clasificacion:"rechazo"`) alcanzan
  // por sí solos para tirar `ErrorEstadoInicialInvalido`, nunca un `TypeError`.
  // `validarProyecto`/`validarIdsYContador` de todos modos se INTENTAN igual en ese
  // caso (protegidos con `try/catch`: si el objeto es tan ajeno a un `Proyecto` que
  // también explotan acá — ej. `{}`, sin `componentes` — la excepción se descarta sin
  // propagar, los motivos de forma ya alcanzan) para no perder, en fixtures que violan
  // un invariante de Gate 4 pero conservan la forma mínima que Gate 4 lee (self-loop,
  // umbral no finito, id duplicado, referencia colgada — los "roto" de los tests de
  // más abajo), el código de Gate 4 (`AUTOCONEXION_INVALIDA`, `UMBRAL_NO_FINITO`,
  // `REFERENCIA_INEXISTENTE`, ...) que esos tests ya prueban: `validarFormaProyecto`
  // detecta ALGUNOS de esos mismos casos también, pero con su propio código
  // "_AL_CARGAR"/de forma (mismo criterio momento-de-carga vs. Gate 4 que ya usa el
  // resto del núcleo) — nunca se pisan entre sí, sólo se UNEN.
  const resultadoForma = validarFormaProyecto(deps.proyectoInicial as unknown)
  let motivosIniciales: Motivo[]
  if (resultadoForma.ok) {
    motivosIniciales = [...validarProyecto(deps.proyectoInicial, deps.catalogo), ...validarIdsYContador(deps.proyectoInicial)]
  } else {
    let motivosGate4: readonly Motivo[] = []
    try {
      motivosGate4 = [...validarProyecto(deps.proyectoInicial, deps.catalogo), ...validarIdsYContador(deps.proyectoInicial)]
    } catch {
      motivosGate4 = []
    }
    motivosIniciales = [...resultadoForma.motivos, ...motivosGate4]
  }
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

  /** Phase 1.1 (hallazgo externo E3-01, CRÍTICO): `baseRevision` inválido (tipo
   * incorrecto, no entero, negativo) es un motivo DISTINTO de "está desactualizado" —
   * nunca se sustituye por la revisión actual (eso era el bug: el `??` original). */
  function motivoBaseRevisionInvalida(baseRevisionRecibida: unknown): Motivo {
    return {
      codigo: "BASE_REVISION_INVALIDA",
      categoria: "motor",
      severidad: "blocking",
      clasificacion: "rechazo",
      datos: { baseRevisionRecibida },
    }
  }

  function ejecutarLote(operaciones: readonly SobreOperacion[], comprometer: boolean): ResultadoTransaccion {
    // Phase 1.1 (hallazgo externo E3-05, MENOR): lote vacío es un no-op explícito,
    // ANTES de mirar `baseRevision` — nunca sube revisión, nunca persiste, nunca
    // agrega al buffer de undo. Separado a propósito del chequeo de abajo: "no hay
    // primera operación" y "la primera operación trae un baseRevision inválido" son
    // dos causas distintas (E3-01 exige no confundirlas — antes, el mismo `??` las
    // trataba igual).
    if (operaciones.length === 0) {
      return congelarProfundo({ ok: true, baseRevision: canonico.revision, revisionActual: canonico.revision, motivos: [], resultadosOperaciones: [] })
    }

    // Phase 1.1 (hallazgo externo E3-01, CRÍTICO): la PRIMERA operación del lote
    // tiene que traer un `baseRevision` ENTERO NO NEGATIVO de verdad — `0` es
    // perfectamente válido (no es "falsy" acá, es la revisión inicial real) y NUNCA
    // se puede confundir con "ausente". `null`/campo ausente/string/NaN/±Infinity/
    // negativo/no entero rechazan ACÁ, antes de clonar, con un motivo DISTINTO de
    // "desactualizado" (`motivoBaseRevisionInvalida`, no `motivoRevisionObsoleta`).
    const baseRevisionRecibida = operaciones[0]!.baseRevision
    if (!esEnteroNoNegativo(baseRevisionRecibida)) {
      // Phase 1.1 (hallazgo externo CP-02, MENOR): el dato crudo e inválido que mandó
      // el cliente ya viaja íntegro en `motivos[0].datos.baseRevisionRecibida` — este
      // campo `baseRevision` del resultado es sólo un ECO de correlación para quien
      // lo lee, y no hay ningún `baseRevision` real que ecoar acá (el que llegó nunca
      // fue válido). Antes se fabricaba `Number.NaN`, un valor que nadie pidió y que
      // no describe nada real. Mismo criterio que el no-op de lote vacío (E3-05,
      // arriba): se ecoa la revisión CANÓNICA vigente — el mismo valor que
      // `revisionActual` — nunca un valor inventado.
      return congelarProfundo({ ok: false, baseRevision: canonico.revision, revisionActual: canonico.revision, motivos: [motivoBaseRevisionInvalida(baseRevisionRecibida)], resultadosOperaciones: [] })
    }
    const baseRevision = baseRevisionRecibida

    // 1. baseRevision stale corta ANTES de clonar.
    if (baseRevision !== canonico.revision) {
      return congelarProfundo({ ok: false, baseRevision, revisionActual: canonico.revision, motivos: [motivoRevisionObsoleta(baseRevision)], resultadosOperaciones: [] })
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
      return congelarProfundo({ ok: false, baseRevision, revisionActual: canonico.revision, motivos: motivosPropios, resultadosOperaciones })
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
      return congelarProfundo({ ok: false, baseRevision, revisionActual: canonico.revision, motivos: motivosFinales, resultadosOperaciones })
    }

    if (!comprometer) {
      // proponer(): dry-run — se descarta el borrador, nunca se persiste, nunca sube revision.
      return congelarProfundo({ ok: true, baseRevision, revisionActual: canonico.revision, motivos: motivosFinales, resultadosOperaciones })
    }

    // 6. Commit: persistir PRIMERO, recién después reemplazar la referencia canónica.
    const proyectoFinal = congelarProfundo({ ...borrador, revision: canonico.revision + 1 })
    const resultadoGuardar = deps.almacen.guardar(proyectoFinal)
    if (!resultadoGuardar.ok) {
      return congelarProfundo({ ok: false, baseRevision, revisionActual: canonico.revision, motivos: [...motivosFinales, resultadoGuardar.motivo], resultadosOperaciones })
    }

    canonico = proyectoFinal // swap — recién acá cambia la memoria
    // Phase 1.1 (hallazgo externo E3-06, MENOR): antes de acá `resultado` viajaba SIN
    // congelar — el mismo objeto que se devuelve al llamador es el que queda guardado
    // en `bufferUndo` (nunca una copia defensiva, ver `obtenerBufferUndo()` más abajo:
    // sólo hace `slice()` del array CONTENEDOR, nunca clona cada entrada). Un
    // consumidor descuidado que mutara el resultado devuelto (`resultado.motivos.push`,
    // por ejemplo) corrompía en el lugar la entrada histórica del buffer, sin que nada
    // lo detectara. `congelarProfundo` (mismo patrón ya usado para `Proyecto`, sobre un
    // objeto que ya nadie más necesita mutar) cierra esto: es barato (un solo
    // recorrido más, sobre un árbol que además YA está mayormente congelado, porque
    // comparte por referencia entidades de `proyectoFinal`) y no cambia ninguna
    // semántica de aceptación/rechazo — sólo lo hace inmutable después de construido.
    const resultado: ResultadoTransaccion = congelarProfundo({ ok: true, baseRevision, revisionActual: canonico.revision, motivos: motivosFinales, resultadosOperaciones })
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
