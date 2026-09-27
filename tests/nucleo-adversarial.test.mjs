// Batería adversarial — Gate 8, revisión independiente (Agente X).
//
// ORIGEN: escrita por un agente adversarial independiente sobre una COPIA aislada del
// worktree (nunca sobre el original), sin coordinación con quien implementó los Gates
// 1-7 — el objetivo explícito era encontrar huecos que la suite "de fábrica" no viera.
// Se incorpora acá, adaptada (rutas de import a este repo, ver abajo), como registro
// permanente de esa auditoría — no se reescribe desde cero.
//
// QUÉ ATACA: los 30 ítems de la lista adversarial de T_diseno_consolidado.md §9, cada
// uno con un ÁNGULO NUEVO respecto de lo que ya cubren tests/nucleo-*.test.mjs (mutar
// objetos devueltos en vez de sólo inspeccionar campos, revision ±1 en vez de sólo -1,
// la operación rechazada como ÚLTIMA del lote en vez de la del medio, fallo real en
// "escribir" vs. "renombrar" por separado, mismo `catalogoVersion`/hash distinto,
// reorden de arrays en el documento CRUDO antes de cargar, idempotencia byte a byte,
// determinismo de `motivos[]` bajo reorden de entrada, y varios greps estructurales:
// sin tipo `Draft`/`Borrador`, sin vocabulario CRDT/OT, sin transporte/browser en el
// núcleo, `node:` sólo en los dos archivos autorizados) + una campaña de mutación de
// 20 mutantes sobre `motor.ts`/`catalogo.ts`/`placas.ts`/`cargador.ts`/`validar.ts`/
// `validar-tecnico.ts`/`validar-estructural.ts`/`almacen.ts`/`operaciones.ts`.
//
// QUÉ ENCONTRÓ (ambos ya corregidos/cubiertos, ver DECISIONS.md "hallazgo adversarial
// Gate 8" y OPERATIONS.md §8):
//   - **item 4 / mutante M14** (MAJOR): `motor.ts` sólo cortaba el lote por los
//     motivos `clasificacion:"rechazo"` que emite `aplicarOperacion` por operación —
//     nunca revisaba si `validarProyecto()`, corrida DESPUÉS de aplicar todo el lote,
//     también traía un rechazo (`validar-estructural.ts` sí puede emitir uno,
//     `REFERENCIA_INEXISTENTE`). El test `4.` de acá, adaptado, ahora prueba el
//     comportamiento CORREGIDO (el motor se niega a construirse sobre ese estado) en
//     vez de documentar el bug.
//   - **mutante M16** (MINOR): la rama `requierePwm` de `asignarPin` (catalogo.ts)
//     no tenía ningún test — sin bug de producción, sólo cobertura faltante (agregada
//     también en `tests/nucleo-catalogo.test.mjs`, que es la suite canónica de Gate 3;
//     acá queda además como parte del registro de la auditoría).
//
// ADAPTACIÓN: imports por ruta absoluta a `x_copia/` reemplazados por el mismo patrón
// `REPO`/`join` que usa el resto de `tests/nucleo-*.test.mjs` (import dinámico del
// módulo real). Ningún test se reescribió en su lógica salvo el `4.` (ver arriba) y un
// comentario final en el `14.` que quedó desactualizado por el fix. No se encontraron
// duplicados EXACTOS de tests existentes — cada uno ataca un ángulo distinto del que ya
// cubre la suite de fábrica (ver la tabla completa en el reporte original del agente).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const NUCLEO = join(REPO, "opencode/nucleo")

const { crearMotorDeProyecto } = await import(join(NUCLEO, "motor.ts"))
const { crearProyecto, cargarProyecto } = await import(join(NUCLEO, "cargador.ts"))
const { clonarProfundo, canonicalizar } = await import(join(NUCLEO, "canonico.ts"))
const { construirCatalogoMinimoReal } = await import(join(NUCLEO, "adaptadores/hash-catalogo.node.ts"))
const { construirCatalogo } = await import(join(NUCLEO, "catalogo.ts"))
const { validarEstructural } = await import(join(NUCLEO, "validar-estructural.ts"))
const { validarProyecto, derivarReadiness } = await import(join(NUCLEO, "validar.ts"))
const { lintPedagogico } = await import(join(NUCLEO, "lint-pedagogico.ts"))
const { crearAlmacen } = await import(join(NUCLEO, "almacen.ts"))
const { resolverAliasPlaca } = await import(join(NUCLEO, "placas.ts"))
const { asignarPin } = await import(join(NUCLEO, "catalogo.ts"))

const catalogo = construirCatalogoMinimoReal()

// ════════════════════════════════════════════════════════════════════════════════════
// Helpers (mismo patrón que tests/nucleo-*.test.mjs, no reinventado)
// ════════════════════════════════════════════════════════════════════════════════════

function proyectoBase() {
  return crearProyecto({ generadorId: () => "proy-test", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
}

let contadorOp = 0
function op(tipo, payload, baseRevision) {
  return { idOperacion: `op-${contadorOp++}`, actor: "agente", baseRevision, tipo, payload }
}

function crearAlmacenFalso() {
  const store = new Map()
  let fallarProximo = false
  const llamadasGuardar = []
  return {
    _store: store,
    _forzarFalloProximo: () => {
      fallarProximo = true
    },
    llamadasGuardar,
    guardar(proyecto) {
      llamadasGuardar.push(proyecto.id)
      if (fallarProximo) {
        fallarProximo = false
        return { ok: false, motivo: { codigo: "PERSIST_FAILED", categoria: "almacen", severidad: "blocking", clasificacion: "rechazo" } }
      }
      store.set(proyecto.id, proyecto)
      return { ok: true }
    },
    cargar(id) {
      return store.has(id) ? { ok: true, proyecto: store.get(id) } : { ok: false, motivos: [{ codigo: "PROYECTO_INEXISTENTE", categoria: "almacen", severidad: "blocking", clasificacion: "rechazo" }] }
    },
    existe(id) {
      return store.has(id)
    },
  }
}

function crearMotorDePrueba(proyectoInicial = proyectoBase()) {
  const almacen = crearAlmacenFalso()
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen })
  return { motor, almacen, proyectoInicial }
}

function crearFsFalso(inicial = {}) {
  const archivos = new Map(Object.entries(inicial))
  let fallarEn = null
  return {
    _archivos: archivos,
    _fallarEnProximo: (modo) => {
      fallarEn = modo
    },
    existsSync: (p) => archivos.has(p),
    mkdirSync: () => {},
    writeFileSync: (p, data) => {
      if (fallarEn === "escribir") {
        fallarEn = null
        throw new Error("fallo simulado al escribir")
      }
      archivos.set(p, data)
    },
    renameSync: (from, to) => {
      if (fallarEn === "renombrar") {
        fallarEn = null
        throw new Error("fallo simulado al renombrar")
      }
      const contenido = archivos.get(from)
      archivos.delete(from)
      archivos.set(to, contenido)
    },
    unlinkSync: (p) => {
      archivos.delete(p)
    },
    readFileSync: (p) => {
      if (!archivos.has(p)) {
        const err = new Error("ENOENT")
        err.code = "ENOENT"
        throw err
      }
      return archivos.get(p)
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// 1. incompleto persistible
// Cobertura existente: nucleo-demo-contractual.test.mjs #1, nucleo-ir-cargador
// "proyecto-incompleto-carga". Ángulo nuevo: pasar por motor.aplicar (no sólo
// cargador/validar directo) y verificar que el ALMACÉN FALSO efectivamente recibió el
// proyecto incompleto (no sólo que "no revienta").
// ════════════════════════════════════════════════════════════════════════════════════

test("1. incompleto-persistible-via-motor-commit-real", () => {
  const { motor, almacen } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  const r = motor.aplicar(op("AgregarComponente", { tipo: "led" }, 1)) // pin sin asignar
  assert.equal(r.ok, true)
  const persistido = almacen._store.get(motor.getProyecto().id)
  assert.ok(persistido, "el commit debe haber llegado al almacen")
  const readiness = derivarReadiness(persistido, validarProyecto(persistido, catalogo))
  assert.equal(readiness.incompleto, true)
  assert.equal(persistido.componentes[0].pines.anodo, null)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 2. invalido representable persistible
// Cobertura existente: nucleo-operaciones "asignarpin-sobre-pin-ocupado-commitea".
// Ángulo nuevo: CATALOGO_COMPONENTE_DESCONOCIDO llegando por un catálogo "achicado" en
// runtime (simula que el catálogo activo cambió desde que se guardó), confirmando que
// el motivo llega representable y el componente nunca se borra.
// ════════════════════════════════════════════════════════════════════════════════════

test("2. invalido-representable-persistible-tipo-desconocido-sobrevive-al-commit", () => {
  const { motor, almacen } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  const r = motor.aplicar(op("AgregarComponente", { tipo: "led" }, 1))
  assert.equal(r.ok, true)
  // Catálogo "achicado" en runtime (simula versión vieja del catálogo activo que ya no
  // reconoce "led") pasado a validarProyecto directamente sobre lo persistido.
  const catalogoSinLed = construirCatalogo({ version: "0.0.1-fixture", componentes: [], placas: catalogo.placas, unidades: catalogo.unidades }, () => "hash-fixture")
  const persistido = almacen._store.get(motor.getProyecto().id)
  const motivos = validarProyecto(persistido, catalogoSinLed)
  const desconocido = motivos.find((m) => m.codigo === "CATALOGO_COMPONENTE_DESCONOCIDO")
  assert.ok(desconocido, "debe reportar el tipo como desconocido, representable")
  assert.equal(desconocido.clasificacion, "representable")
  assert.equal(persistido.componentes.length, 1, "el componente JAMAS se borra por esto")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3. incompleto + invalido simultaneos
// Cobertura existente: nucleo-validacion "incompleto-e-invalido-simultaneos" (Proyecto
// armado a mano). Ángulo nuevo: producir el mismo estado a través de TRANSACCIONES
// reales del motor y verificar que lo que terminó en el almacén tiene ambos readiness
// en false simultáneamente.
// ════════════════════════════════════════════════════════════════════════════════════

test("3. incompleto-e-invalido-simultaneos-via-transacciones-reales", () => {
  const { motor, almacen } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, 1)) // cmp-0
  motor.aplicar(op("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO23" }, 2))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, 3)) // cmp-1
  const rInvalido = motor.aplicar(op("AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO23" }, 4)) // PIN_OCUPADO
  assert.equal(rInvalido.ok, true, "representable: commitea igual")
  const r3 = motor.aplicar(op("AgregarComponente", { tipo: "led" }, motor.getProyecto().revision)) // cmp-2 sin pin: incompleto
  assert.equal(r3.ok, true)
  const persistido = almacen._store.get(motor.getProyecto().id)
  const readiness = derivarReadiness(persistido, validarProyecto(persistido, catalogo))
  assert.equal(readiness.incompleto, true)
  assert.equal(readiness.invalido, true)
  assert.equal(readiness.listo, false)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 4. non-representable rejected — HALLAZGO PRINCIPAL, YA CORREGIDO (ver DECISIONS.md
// "hallazgo adversarial Gate 8" y OPERATIONS.md §8).
//
// ANTES del fix: `motor.ts` sólo cortaba el lote por `motivosPropios` (los que emite
// `aplicarOperacion`, operación por operación). Los motivos que produce
// `validarProyecto(borrador, catalogo)` DESPUÉS de aplicar todo el lote nunca se
// revisaban por `clasificacion==="rechazo"` antes de decidir `comprometer`+persistir —
// pero `validar-estructural.ts` SÍ puede emitir esa clasificación
// (`REFERENCIA_INEXISTENTE`). Repro: `proyectoInicial` ya roto (bypaseando
// `cargarProyecto`, que sí lo rechazaría con `REFERENCIA_ROTA_AL_CARGAR`) + una
// operación trivial no relacionada → antes del fix, `motor.aplicar()` devolvía
// `ok:true`, persistía y subía la revisión.
//
// DESPUÉS del fix: el motor NUNCA llega a construirse sobre ese estado —
// `crearMotorDeProyecto` lanza `ErrorEstadoInicialInvalido` con el motivo estructurado.
// Este test prueba el comportamiento CORREGIDO, no el bug (a diferencia de la versión
// original del agente, que documentaba el `ok:true` como `BUG:`).
// ════════════════════════════════════════════════════════════════════════════════════

test("4. CORREGIDO — el motor se niega a construirse sobre un proyectoInicial con un motivo clasificacion=rechazo", () => {
  // Proyecto inicial YA roto: una conexión que referencia un componente inexistente.
  // No pasa por cargarProyecto (que SÍ lo rechazaría con REFERENCIA_ROTA_AL_CARGAR) —
  // este era justo el bypass que explotaba el hallazgo original.
  const base = proyectoBase()
  const roto = {
    ...base,
    placa: "esp32-devkit-v1",
    componentes: [{ id: "cmp-0", tipo: "led", pines: { anodo: "GPIO23" }, propiedades: {} }],
    conexiones: [{ id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-NO-EXISTE", terminal: "a" } }],
    siguienteIdLocal: 1,
  }

  let errorCapturado
  try {
    crearMotorDeProyecto({ proyectoInicial: roto, catalogo, almacen: crearAlmacenFalso() })
  } catch (e) {
    errorCapturado = e
  }
  assert.ok(errorCapturado, "crearMotorDeProyecto DEBE lanzar sobre este estado inicial")
  assert.ok(
    errorCapturado.motivos?.some((m) => m.codigo === "REFERENCIA_INEXISTENTE" && m.clasificacion === "rechazo"),
    `el error debe traer el motivo estructurado que causó el rechazo: ${JSON.stringify(errorCapturado.motivos)}`,
  )
})

// ════════════════════════════════════════════════════════════════════════════════════
// 5. stale revision rejected — simetria current-1 (cubierto ya) y current+1 (NO cubierto)
// ════════════════════════════════════════════════════════════════════════════════════

test("5a. baseRevision = current+1 (adelantada) tambien rechaza, no solo la atrasada", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const antes = motor.getProyecto()
  const llamadasAntes = almacen.llamadasGuardar.length
  const r = motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, antes.revision + 1))
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "BASE_REVISION_DESACTUALIZADA")
  assert.equal(motor.getProyecto(), antes)
  assert.equal(almacen.llamadasGuardar.length, llamadasAntes)
})

test("5b. baseRevision = current-1 (justo detras) rechaza", () => {
  const { motor } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0)) // revision -> 1
  const r = motor.aplicar(op("AgregarComponente", { tipo: "led" }, 0)) // deberia ser 1
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "BASE_REVISION_DESACTUALIZADA")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 6. dry-run no muta — angulo nuevo: mutar el DRAFT devuelto por proponer() y
// verificar que el canonico real sigue intacto (a diferencia de "revisionActual no
// sube", que ya esta cubierto).
// ════════════════════════════════════════════════════════════════════════════════════

test("6. mutar el borrador devuelto por proponer() no afecta al canonico", () => {
  const { motor } = crearMotorDePrueba()
  const r = motor.proponer([op("SetPlaca", { placa: "esp32-devkit-v1" }, 0), op("AgregarComponente", { tipo: "led" }, 0)])
  assert.equal(r.ok, true)
  const draft = r.resultadosOperaciones.at(-1).proyecto
  // El draft de un dry-run NO esta congelado (nunca se llama congelarProfundo antes
  // de descartarlo) — deliberadamente lo mutamos "a fondo" para probar que da igual:
  try {
    draft.componentes.push({ id: "cmp-INTRUSO", tipo: "led", pines: {}, propiedades: {} })
  } catch {}
  try {
    draft.placa = "arduino-uno"
  } catch {}
  try {
    draft.revision = 999
  } catch {}
  const canonicoFinal = motor.getProyecto()
  assert.equal(canonicoFinal.revision, 0, "el canonico jamas cambio, sin importar que se hizo con el draft descartado")
  assert.equal(canonicoFinal.placa, null)
  assert.equal(canonicoFinal.componentes.length, 0)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 7. transaction rollback total — angulo nuevo: la operacion RECHAZADA es la ULTIMA
// del lote (no la del medio, que es lo que ya prueba nucleo-motor.test.mjs).
// ════════════════════════════════════════════════════════════════════════════════════

test("7. rollback total cuando la ULTIMA operacion del lote es la rechazada", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const antes = motor.getProyecto()
  const llamadasAntes = almacen.llamadasGuardar.length
  const r = motor.aplicarTransaccion([
    op("SetPlaca", { placa: "esp32-devkit-v1" }, 0),
    op("AgregarComponente", { tipo: "led" }, 0),
    op("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO23" }, 0),
    op("QuitarComponente", { componente: "cmp-no-existe" }, 0), // ULTIMA op: rechazo
  ])
  assert.equal(r.ok, false)
  assert.equal(motor.getProyecto(), antes, "ni el SetPlaca ni el AgregarComponente (validos) quedan aplicados")
  assert.equal(almacen.llamadasGuardar.length, llamadasAntes)
  assert.equal(r.resultadosOperaciones.length, 4, "las 4 operaciones corrieron (se corta DESPUES de detectar el rechazo)")
  assert.equal(r.resultadosOperaciones.at(-1).ok, false)
  assert.equal(r.resultadosOperaciones[0].ok, true, "la 1ra operacion en si misma fue valida, pero el LOTE entero se descarta")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 8. successful transaction increments exactly once — angulo nuevo: comparar el mismo
// conjunto de operaciones en DOS ordenes de insercion distintos, mismo resultado de
// revision (+1 una sola vez cada vez, sin importar cuantas operaciones ni el orden).
// ════════════════════════════════════════════════════════════════════════════════════

test("8. revision sube exactamente 1 con 5 operaciones y con reordenamiento", () => {
  const { motor: motorA } = crearMotorDePrueba()
  const rA = motorA.aplicarTransaccion([
    op("SetPlaca", { placa: "esp32-devkit-v1" }, 0),
    op("AgregarComponente", { tipo: "led" }, 0),
    op("AgregarComponente", { tipo: "resistencia" }, 0),
    op("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO23" }, 0),
    op("Conectar", { desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "a" } }, 0),
  ])
  assert.equal(rA.ok, true)
  assert.equal(motorA.getProyecto().revision, 1)

  const { motor: motorB } = crearMotorDePrueba()
  const rB = motorB.aplicarTransaccion([
    op("AgregarComponente", { tipo: "resistencia" }, 0), // cmp-0 ahora
    op("AgregarComponente", { tipo: "led" }, 0), // cmp-1 ahora
    op("SetPlaca", { placa: "esp32-devkit-v1" }, 0),
    op("AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO23" }, 0),
    op("Conectar", { desde: { componente: "cmp-1", terminal: "anodo" }, hasta: { componente: "cmp-0", terminal: "a" } }, 0),
  ])
  assert.equal(rB.ok, true)
  assert.equal(motorB.getProyecto().revision, 1, "reordenar las mismas 5 operaciones sigue subiendo la revision UNA sola vez")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 9. persistence failure doesn't corrupt previous state — angulo nuevo: usar el
// ALMACEN REAL (almacen.ts contra un fs falso), inyectando la falla en "escribir" y
// luego en "renombrar" por separado, confirmando en ambos casos que el destino previo
// sigue intacto y que no queda un .tmp huerfano.
// ════════════════════════════════════════════════════════════════════════════════════

test("9a. fallo real inyectado al ESCRIBIR el temporal preserva el archivo destino previo", () => {
  const p1 = crearProyecto({ generadorId: () => "proy-9a", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const contenidoOriginal = canonicalizar(p1)
  const fsFalso = crearFsFalso({ "/dir/proy-9a.json": contenidoOriginal })
  const almacen = crearAlmacen({ directorio: "/dir", catalogo, fs: fsFalso })
  fsFalso._fallarEnProximo("escribir")
  const p2 = { ...p1, revision: 1 }
  const r = almacen.guardar(p2)
  assert.equal(r.ok, false)
  assert.equal(r.motivo.codigo, "PERSIST_FAILED")
  assert.equal(fsFalso._archivos.get("/dir/proy-9a.json"), contenidoOriginal, "el destino sigue con el contenido viejo")
  const huerfanos = [...fsFalso._archivos.keys()].filter((k) => k.includes(".tmp-"))
  assert.equal(huerfanos.length, 0, "si writeFileSync tira, ni siquiera llega a crear el temporal")
})

test("9b. fallo real inyectado al RENOMBRAR preserva destino previo y limpia el temporal", () => {
  const p1 = crearProyecto({ generadorId: () => "proy-9b", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const contenidoOriginal = canonicalizar(p1)
  const fsFalso = crearFsFalso({ "/dir/proy-9b.json": contenidoOriginal })
  const almacen = crearAlmacen({ directorio: "/dir", catalogo, fs: fsFalso })
  fsFalso._fallarEnProximo("renombrar")
  const p2 = { ...p1, revision: 1 }
  const r = almacen.guardar(p2)
  assert.equal(r.ok, false)
  assert.equal(fsFalso._archivos.get("/dir/proy-9b.json"), contenidoOriginal, "el rename nunca llego a tocar el destino")
  const huerfanos = [...fsFalso._archivos.keys()].filter((k) => k.includes(".tmp-"))
  assert.equal(huerfanos.length, 0, "el catch de unlinkSync limpia el temporal tras el fallo de rename")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 10. catalog change doesn't silently mutate project — angulo nuevo: MISMA version de
// catalogo, contenido DISTINTO -> hash distinto -> diagnostico se dispara igual (no
// hace falta bump de version para detectarlo), y el objeto proyecto devuelto es
// exactamente el mismo que el guardado (no re-escribe catalogoHash).
// ════════════════════════════════════════════════════════════════════════════════════

test("10. mismo catalogoVersion, contenido distinto -> hash distinto -> diagnostico, proyecto sin mutar", () => {
  const catalogoV1 = construirCatalogo({ version: "9.9.9", componentes: [], placas: catalogo.placas, unidades: catalogo.unidades }, () => "hash-v1")
  const p = crearProyecto({ generadorId: () => "proy-10", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogoV1.version, catalogoHash: catalogoV1.hash })
  const fsFalso = crearFsFalso({ "/dir/proy-10.json": canonicalizar(p) })
  // Mismo "version" string ("9.9.9"), pero el hasher/contenido activo ahora es otro:
  const catalogoV1ContenidoDistinto = construirCatalogo({ version: "9.9.9", componentes: catalogo.componentes, placas: catalogo.placas, unidades: catalogo.unidades }, () => "hash-v1-pero-distinto")
  const almacen = crearAlmacen({ directorio: "/dir", catalogo: catalogoV1ContenidoDistinto, fs: fsFalso })
  const r = almacen.cargar("proy-10")
  assert.equal(r.ok, true)
  assert.ok(r.diagnostico?.some((m) => m.codigo === "CATALOGO_CAMBIO_DETECTADO"), "mismo version string mas distinto hash SI dispara el diagnostico")
  assert.equal(r.proyecto.catalogoVersion, "9.9.9", "el proyecto cargado NO reescribe su propio catalogoVersion")
  assert.equal(r.proyecto.catalogoHash, "hash-v1", "el proyecto cargado NO reescribe su propio catalogoHash al del catalogo activo")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 11. valid student choice isn't rewritten — angulo nuevo: la eleccion no-default
// (GPIO16, fuera del pool automatico) sobrevive a una TRANSACCION real posterior no
// relacionada (no solo a una revalidacion en frio).
// ════════════════════════════════════════════════════════════════════════════════════

test("11. una asignacion manual fuera del pool automatico sobrevive a operaciones posteriores no relacionadas", () => {
  const { motor } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, 1))
  motor.aplicar(op("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO16" }, 2)) // fuera del pool automatico
  motor.aplicar(op("AgregarComponente", { tipo: "resistencia" }, 3))
  motor.aplicar(op("Conectar", { desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "a" } }, 4))
  const final = motor.getProyecto()
  assert.equal(final.componentes.find((c) => c.id === "cmp-0").pines.anodo, "GPIO16", "nada la reescribio a un pin del pool automatico")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 12. unit conversion explicit — angulo nuevo: pasar por CambiarComponente REAL
// (operaciones.ts, no catalogo.ts en aislamiento) hacia un tipo con magnitud
// compatible pero SIN conversion de unidad declarada -> debe quedar representable
// blocking, jamas convertido en silencio.
// ════════════════════════════════════════════════════════════════════════════════════

test("12. CambiarComponente sin conversion declarada no convierte en silencio (representable, valor preservado)", () => {
  const catalogoConSensorKelvin = construirCatalogo(
    {
      version: "fixture-kelvin",
      componentes: [
        ...catalogo.componentes,
        {
          id: "sensor-temp-kelvin",
          nombreVisible: "Sensor fixture Kelvin",
          clase: "sensor",
          terminales: [{ id: "senal", rol: "senal", electrica: "digital", direccion: "entrada" }],
          capacidades: [{ id: "temperatura", magnitud: "temperatura", unidad: "kelvin", rango: { min: { valor: 0, unidad: "kelvin", magnitud: "temperatura" }, max: { valor: 400, unidad: "kelvin", magnitud: "temperatura" } } }],
          requisitos: [],
        },
      ],
      placas: catalogo.placas,
      unidades: catalogo.unidades, // solo celsius<->fahrenheit declarado, nunca kelvin
    },
    () => "hash-kelvin-fixture",
  )
  const { motor } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  motor.aplicar(op("AgregarComponente", { tipo: "dht22" }, 1)) // cmp-0, capacidad temperatura en celsius
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, 2)) // cmp-1 actuador
  motor.aplicar(op("AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }, 3))
  motor.aplicar(
    op(
      "SetComportamiento",
      { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: { valor: 25, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-1", accion: "encender" } } },
      4,
    ),
  )
  const motorConCatalogoFixture = crearMotorDeProyecto({ proyectoInicial: motor.getProyecto(), catalogo: catalogoConSensorKelvin, almacen: crearAlmacenFalso() })
  const r = motorConCatalogoFixture.aplicar(op("CambiarComponente", { componente: "cmp-0", tipoNuevo: "sensor-temp-kelvin" }, motor.getProyecto().revision))
  assert.equal(r.ok, true, "CambiarComponente en si mismo no rechaza por esto (R1)")
  const beh = r.resultadosOperaciones[0].proyecto.comportamientos[0]
  assert.equal(beh.cuando.umbral.unidad, "celsius", "SIN conversion declarada, el umbral se preserva tal cual — NUNCA se reinterpreta el numero 25 como si fuera kelvin")
  assert.equal(beh.cuando.umbral.valor, 25)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 13. incompatible capability not silently reinterpreted — angulo nuevo: via el motor
// completo (CambiarComponente dht22->ntc, que no declara "humedad"), verificar que el
// comportamiento vieja sigue viajando con su comparador/umbral SIN tocar y el motivo
// blocking esta presente en el resultado de la transaccion (no se pierde camino arriba).
// ════════════════════════════════════════════════════════════════════════════════════

test("13. CambiarComponente a un tipo sin la capacidad usada: motivo blocking sobrevive hasta el resultado de motor.aplicar", () => {
  const { motor } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  motor.aplicar(op("AgregarComponente", { tipo: "dht22" }, 1)) // cmp-0
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, 2)) // cmp-1
  motor.aplicar(op("AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }, 3))
  motor.aplicar(
    op(
      "SetComportamiento",
      { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "humedad", comparador: ">", umbral: { valor: 50, unidad: "porcentaje", magnitud: "humedad" } }, entonces: { actuador: "cmp-1", accion: "encender" } } },
      4,
    ),
  )
  const r = motor.aplicar(op("CambiarComponente", { componente: "cmp-0", tipoNuevo: "ntc" }, motor.getProyecto().revision)) // ntc no tiene "humedad"
  assert.equal(r.ok, true)
  assert.ok(r.motivos.some((m) => m.codigo === "CAPACIDAD_INCOMPATIBLE_AL_REEMPLAZAR" && m.severidad === "blocking"))
  const beh = motor.getProyecto().comportamientos[0]
  assert.equal(beh.cuando.capacidad, "humedad", "la referencia a la capacidad vieja NO se reescribe silenciosamente a otra")
  assert.equal(beh.cuando.umbral.valor, 50)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 14. broken reference behavior matches contract — dos "momentos" documentados en
// cargador.ts/validar-estructural.ts deben dar CODIGOS DISTINTOS para la MISMA forma de
// problema (carga-tiempo vs operacion-tiempo), tal como dice el comentario de
// validar-estructural.ts.
// ════════════════════════════════════════════════════════════════════════════════════

test("14. referencia rota da REFERENCIA_ROTA_AL_CARGAR al cargar y REFERENCIA_INEXISTENTE en validar-estructural, nunca el mismo codigo", () => {
  const docRoto = {
    id: "proy-14",
    schemaVersion: "1.0.0",
    catalogoVersion: catalogo.version,
    catalogoHash: catalogo.hash,
    revision: 0,
    siguienteIdLocal: 1,
    placa: "esp32-devkit-v1",
    componentes: [{ id: "cmp-0", tipo: "led", pines: { anodo: "GPIO23" }, propiedades: {} }],
    conexiones: [{ id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-fantasma", terminal: "a" } }],
    comportamientos: [],
    metadata: { creadoEn: "2026-01-01T00:00:00.000Z" },
  }
  const rCarga = cargarProyecto(docRoto)
  assert.equal(rCarga.ok, false)
  assert.equal(rCarga.motivos[0].codigo, "REFERENCIA_ROTA_AL_CARGAR")

  // La MISMA forma de problema, pero evaluada por validar-estructural (nivel 2, "segunda
  // linea de defensa") sobre un Proyecto ya construido a mano (bypass del loader):
  const proyectoIrConstruidoAMano = { ...docRoto, componentes: docRoto.componentes }
  const motivos = validarEstructural(proyectoIrConstruidoAMano)
  assert.equal(motivos[0].codigo, "REFERENCIA_INEXISTENTE")
  assert.notEqual(motivos[0].codigo, rCarga.motivos[0].codigo, "codigos distintos para carga-tiempo vs operacion-tiempo, tal como documenta el propio archivo")
  // Nota post-fix: este motivo YA se trata como un rechazo real por motor.ts (item 4,
  // arreglado) — antes del fix, los códigos eran distintos como documenta el contrato,
  // pero motor.ts NO trataba el de validar-estructural como un rechazo operable.
})

// ════════════════════════════════════════════════════════════════════════════════════
// 15/16. core cannot mutate canonical state bypassing engine / direct consumer
// mutation isn't exposed — atacar TODOS los puntos de salida: getProyecto() Y los
// `.proyecto` de cada resultadoOperacion de una transaccion COMMITEADA con 3 pasos.
// ════════════════════════════════════════════════════════════════════════════════════

test("15/16. ningun objeto devuelto por una transaccion commiteada permite corromper el canonico", () => {
  const { motor } = crearMotorDePrueba()
  const r = motor.aplicarTransaccion([op("SetPlaca", { placa: "esp32-devkit-v1" }, 0), op("AgregarComponente", { tipo: "led" }, 0), op("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO23" }, 0)])
  assert.equal(r.ok, true)
  const snapshotAntes = canonicalizar(motor.getProyecto())

  // Ataque 1: mutar el snapshot congelado directo
  const snap = motor.getProyecto()
  assert.throws(() => {
    "use strict"
    snap.componentes.push({ id: "intruso" })
  })
  assert.throws(() => {
    "use strict"
    snap.placa = "arduino-uno"
  })

  // Ataque 2: mutar los `.proyecto` de CADA resultadoOperacion (incluidos los que no
  // son el ultimo), intentando arrays anidados y props de primer nivel.
  for (const resOp of r.resultadosOperaciones) {
    try {
      resOp.proyecto.componentes.push({ id: "intruso-op" })
    } catch {}
    try {
      resOp.proyecto.placa = "MUTADO"
    } catch {}
    try {
      if (resOp.proyecto.componentes[0]) resOp.proyecto.componentes[0].pines.anodo = "GPIO99"
    } catch {}
  }

  assert.equal(canonicalizar(motor.getProyecto()), snapshotAntes, "el canonico real es BYTE A BYTE identico despues de todos los intentos de mutacion externa")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 17/18/19. board backend IDs / Wokwi / PlatformIO no son identidad semantica —
// angulo nuevo: pasarlos como PAYLOAD de SetPlaca (operaciones.ts real), no solo a
// resolverAliasPlaca en aislamiento.
// ════════════════════════════════════════════════════════════════════════════════════

test("17. SetPlaca con el id de backend PlatformIO ('esp32dev') rechaza como placa desconocida", () => {
  const { motor } = crearMotorDePrueba()
  const r = motor.aplicar(op("SetPlaca", { placa: "esp32dev" }, 0))
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "PLACA_DESCONOCIDA")
})

test("18. SetPlaca con el elemento Wokwi ('wokwi-esp32-devkit-v1') rechaza como placa desconocida", () => {
  const { motor } = crearMotorDePrueba()
  const r = motor.aplicar(op("SetPlaca", { placa: "wokwi-esp32-devkit-v1" }, 0))
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "PLACA_DESCONOCIDA")
})

test("19. SetPlaca con el platform string de PlatformIO ('atmelavr@5.2.0') rechaza", () => {
  const { motor } = crearMotorDePrueba()
  const r = motor.aplicar(op("SetPlaca", { placa: "atmelavr@5.2.0" }, 0))
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "PLACA_DESCONOCIDA")
})

test("resolverAliasPlaca tampoco resuelve backend ids aunque el texto coincida exacto", () => {
  assert.equal(resolverAliasPlaca("esp32dev").ok, false)
  assert.equal(resolverAliasPlaca("wokwi-arduino-uno").ok, false)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 20/21. revalidacion idempotente + reason codes deterministas — angulo nuevo:
// reordenar el array `componentes`/`conexiones` de ENTRADA (antes de construir el
// Proyecto) y comparar canonicalizar(validarProyecto(...)) entre las dos variantes.
// ════════════════════════════════════════════════════════════════════════════════════

test("20/21. reordenar componentes/conexiones de entrada no cambia el conjunto NI el orden final de motivos", () => {
  const base = proyectoBase()
  const conTipoDesconocido = (comps) => ({ ...base, placa: "esp32-devkit-v1", componentes: comps, conexiones: [{ id: "conn-0", desde: { componente: "cmp-a", terminal: "x" }, hasta: { componente: "cmp-fantasma", terminal: "y" } }] })

  const compsOrdenA = [
    { id: "cmp-a", tipo: "tipo-desconocido-1", pines: {}, propiedades: {} },
    { id: "cmp-b", tipo: "tipo-desconocido-2", pines: {}, propiedades: {} },
  ]
  const compsOrdenB = [compsOrdenA[1], compsOrdenA[0]] // mismo contenido, orden invertido

  const motivosA = validarProyecto(conTipoDesconocido(compsOrdenA), catalogo)
  const motivosB = validarProyecto(conTipoDesconocido(compsOrdenB), catalogo)
  assert.equal(canonicalizar(motivosA), canonicalizar(motivosB), "mismo conjunto de motivos y mismo ORDEN final, sin importar el orden de entrada")

  // Idempotencia estricta: correr 2 veces sobre la MISMA entrada (sin reordenar) da
  // byte a byte el mismo resultado.
  const p = conTipoDesconocido(compsOrdenA)
  assert.equal(canonicalizar(validarProyecto(p, catalogo)), canonicalizar(validarProyecto(p, catalogo)))
})

// ════════════════════════════════════════════════════════════════════════════════════
// 22. success reasons exist — reemplazarSensor rama B (conversion de unidad) via el
// motor completo debe llevar el motivo informativo UNIDAD_CONVERTIDA.
// ════════════════════════════════════════════════════════════════════════════════════

test("22a. CambiarComponente con conversion real de unidad emite UNIDAD_CONVERTIDA (info) via motor.aplicar", () => {
  const catalogoConSensorF = construirCatalogo(
    {
      version: "fixture-fahrenheit",
      componentes: [
        ...catalogo.componentes,
        {
          id: "sensor-temp-f",
          nombreVisible: "Sensor fixture Fahrenheit",
          clase: "sensor",
          terminales: [{ id: "senal", rol: "senal", electrica: "digital", direccion: "entrada" }],
          capacidades: [{ id: "temperatura", magnitud: "temperatura", unidad: "fahrenheit", rango: { min: { valor: 32, unidad: "fahrenheit", magnitud: "temperatura" }, max: { valor: 140, unidad: "fahrenheit", magnitud: "temperatura" } } }],
          requisitos: [],
        },
      ],
      placas: catalogo.placas,
      unidades: catalogo.unidades,
    },
    () => "hash-f-fixture",
  )
  const { motor } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  motor.aplicar(op("AgregarComponente", { tipo: "dht22" }, 1))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, 2))
  motor.aplicar(op("AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }, 3))
  motor.aplicar(op("SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: { valor: 25, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-1", accion: "encender" } } }, 4))
  const motorFixture = crearMotorDeProyecto({ proyectoInicial: motor.getProyecto(), catalogo: catalogoConSensorF, almacen: crearAlmacenFalso() })
  const r = motorFixture.aplicar(op("CambiarComponente", { componente: "cmp-0", tipoNuevo: "sensor-temp-f" }, motor.getProyecto().revision))
  assert.equal(r.ok, true)
  assert.ok(r.motivos.some((m) => m.codigo === "UNIDAD_CONVERTIDA" && m.severidad === "info"), "un cambio SILENCIOSO de valor (25C -> 77F) siempre viaja con un motivo explicito")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 23. pedagogicalLint separated — grep estructural + prueba de comportamiento: llamar
// lint-pedagogico con un proyecto DELIBERADAMENTE invalido/incompleto no debe generar
// NADA blocking, y el modulo nunca aparece invocado desde validar.ts/motor.ts.
// ════════════════════════════════════════════════════════════════════════════════════

test("23a. lintPedagogico sobre proyecto incompleto+invalido sigue sin blocking (Fase 1: passthrough)", () => {
  const p = { ...proyectoBase(), placa: "placa-fantasma" }
  const motivos = lintPedagogico(p, catalogo)
  assert.deepEqual(motivos, [])
})

test("23b. grep: validar.ts y motor.ts nunca importan/llaman lint-pedagogico.ts", () => {
  const validarTs = readFileSync(join(NUCLEO, "validar.ts"), "utf8")
  const motorTs = readFileSync(join(NUCLEO, "motor.ts"), "utf8")
  assert.ok(!validarTs.includes("lint-pedagogico") && !validarTs.includes("lintPedagogico"))
  assert.ok(!motorTs.includes("lint-pedagogico") && !motorTs.includes("lintPedagogico"))
})

// ════════════════════════════════════════════════════════════════════════════════════
// 24. readiness derived — no memoizado: dos llamadas con el MISMO proyecto pero
// distintos `motivos[]` inyectados dan resultados DISTINTOS (prueba que no hay cache
// oculto atado al objeto Proyecto).
// ════════════════════════════════════════════════════════════════════════════════════

test("24. derivarReadiness recalcula siempre — no hay estado escondido atado al Proyecto", () => {
  const p = proyectoBase() // placa null -> incompleto=true siempre, sin importar motivos
  const r1 = derivarReadiness(p, [])
  const r2 = derivarReadiness(p, [{ codigo: "X", categoria: "tecnica", severidad: "blocking" }])
  assert.equal(r1.invalido, false)
  assert.equal(r2.invalido, true, "el MISMO objeto Proyecto da invalido distinto segun los motivos pasados — no hay ready cacheado en el objeto")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 25. no persisted authoritative ready flag — grep sobre el JSON REAL serializado por
// canonicalizar(), no sobre el tipo TS.
// ════════════════════════════════════════════════════════════════════════════════════

test("25. el JSON persistido (canonicalizar) nunca contiene una clave 'listo'/'ready'", () => {
  const { motor, almacen } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, 1))
  const persistido = almacen._store.get(motor.getProyecto().id)
  const json = canonicalizar(persistido)
  assert.ok(!/"listo"/.test(json) && !/"ready"/.test(json), "el proyecto persistido nunca trae un campo listo/ready — siempre se deriva")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 26. no second DraftProject model — grep estructural: ningun archivo de nucleo/
// declara un `interface`/`type` con "Draft"/"Borrador" como nombre de TIPO (distinto
// de usar "borrador" como nombre de variable local, que SI aparece en motor.ts).
// ════════════════════════════════════════════════════════════════════════════════════

test("26. ningun archivo del nucleo declara un segundo tipo de proyecto (Draft/Borrador)", () => {
  const archivos = readdirSync(NUCLEO).filter((f) => f.endsWith(".ts"))
  for (const f of archivos) {
    const contenido = readFileSync(join(NUCLEO, f), "utf8")
    assert.ok(!/\b(interface|type)\s+(Draft|Borrador)\w*/.test(contenido), `${f} no debe declarar un tipo Draft*/Borrador*`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 27. no CRDT/OT/merge logic — grep de vocabulario tipico.
// ════════════════════════════════════════════════════════════════════════════════════

test("27. grep: sin vocabulario de CRDT/OT/vector-clock/lamport/merge-conflict en nucleo", () => {
  const archivos = readdirSync(NUCLEO, { recursive: true }).filter((f) => typeof f === "string" && f.endsWith(".ts"))
  const patron = /crdt|vector.?clock|lamport|operational.transform|three.?way.?merge|merge.?conflict|yjs|automerge/i
  for (const f of archivos) {
    const contenido = readFileSync(join(NUCLEO, f), "utf8")
    assert.ok(!patron.test(contenido), `${f} no debe mencionar vocabulario de CRDT/OT`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 28/29. no transport / no browser-server dependency in core — grep amplio.
// ════════════════════════════════════════════════════════════════════════════════════

test("28/29. grep: sin websocket/http/fetch/server/document/window en nucleo", () => {
  const archivos = readdirSync(NUCLEO, { recursive: true }).filter((f) => typeof f === "string" && f.endsWith(".ts"))
  const patronTransporteYBrowser = /websocket|createserver|express|\bfetch\(|eventsource|\bdocument\.|\bwindow\.|xmlhttprequest/i
  for (const f of archivos) {
    const contenido = readFileSync(join(NUCLEO, f), "utf8")
    assert.ok(!patronTransporteYBrowser.test(contenido), `${f} no debe traer transporte ni dependencia de browser`)
  }
})

test("29b. grep: node:fs/node:crypto SOLO en almacen.ts y adaptadores/hash-catalogo.node.ts", () => {
  const archivos = readdirSync(NUCLEO, { recursive: true }).filter((f) => typeof f === "string" && f.endsWith(".ts"))
  const permitidos = new Set(["almacen.ts", join("adaptadores", "hash-catalogo.node.ts")])
  for (const f of archivos) {
    const contenido = readFileSync(join(NUCLEO, f), "utf8")
    if (/from ["']node:/.test(contenido)) {
      assert.ok(permitidos.has(f), `${f} importa un modulo node: sin estar en la lista permitida`)
    }
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 30. Node testability preserved — este archivo entero corriendo bajo `node --test`
// plano (sin bundler, sin --conditions=browser) YA es la prueba positiva. Ademas: cero
// uso de globals de browser/opentui en cualquier import transitivo de nucleo/.
// ════════════════════════════════════════════════════════════════════════════════════

test("30. import directo de motor.ts bajo Node plano no requiere ninguna condicion especial", () => {
  assert.equal(typeof crearMotorDeProyecto, "function")
  assert.equal(typeof process, "object")
  assert.equal(typeof globalThis.window, "undefined")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Extra: reorden de arrays en el documento PERSISTIDO (no solo de entrada in-memory) —
// dos documentos crudos con componentes/conexiones en distinto orden deben cargar al
// MISMO Proyecto canonico (ya cubierto en nucleo-ir-cargador, pero acá lo repetimos
// pasando por almacen.guardar()+almacen.cargar() reales para cerrar el círculo
// completo disco->loader->canonico).
// ════════════════════════════════════════════════════════════════════════════════════

test("extra. reordenar componentes/conexiones en el documento crudo antes de cargar da EL MISMO proyecto canonico", () => {
  const docCanon = {
    id: "proy-reorden",
    schemaVersion: "1.0.0",
    catalogoVersion: catalogo.version,
    catalogoHash: catalogo.hash,
    revision: 0,
    siguienteIdLocal: 2,
    placa: "esp32-devkit-v1",
    componentes: [
      { id: "cmp-0", tipo: "led", pines: { anodo: "GPIO23" }, propiedades: {} },
      { id: "cmp-1", tipo: "resistencia", pines: {}, propiedades: {} },
    ],
    conexiones: [{ id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "a" } }],
    comportamientos: [],
    metadata: { creadoEn: "2026-01-01T00:00:00.000Z" },
  }
  const docReordenado = { ...docCanon, componentes: [docCanon.componentes[1], docCanon.componentes[0]] }
  const r1 = cargarProyecto(docCanon)
  const r2 = cargarProyecto(docReordenado)
  assert.equal(r1.ok, true)
  assert.equal(r2.ok, true)
  assert.equal(canonicalizar(r1.proyecto), canonicalizar(r2.proyecto), "el orden del array de entrada no afecta la forma canonica final")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Extra: crafted payload — terminal vacio, requierePwm, payload vacio, para forzar
// caminos no cubiertos por los fixtures felices de nucleo-operaciones.test.mjs.
// ════════════════════════════════════════════════════════════════════════════════════

test("extra. AsignarPin con terminal vacio/inexistente da TERMINAL_NO_DECLARADO, nunca excepcion cruda", () => {
  const { motor } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, 1))
  const r = motor.aplicar(op("AsignarPin", { componente: "cmp-0", terminal: "", pin: "GPIO23" }, 2))
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "TERMINAL_NO_DECLARADO")
})

test("extra. asignarPin detecta CAPACIDAD_PIN_INCOMPATIBLE por requierePwm, no solo por solo-entrada (mutante M16, ver tambien tests/nucleo-catalogo.test.mjs)", () => {
  const terminalConPwm = { id: "t-pwm", rol: "senal", electrica: "digital", direccion: "salida", requierePwm: true }
  const pinSinPwm = catalogo.pinesDePlaca("arduino-uno").find((p) => p.id === "D2") // UNO: D2 no esta en UNO_POOL_PWM
  assert.ok(pinSinPwm && pinSinPwm.capacidades.pwm === false, "fixture: D2 no tiene PWM")
  const motivo = asignarPin(terminalConPwm, pinSinPwm)
  assert.ok(motivo, "un terminal que requiere PWM sobre un pin sin PWM debe ser incompatible")
  assert.equal(motivo.codigo, "CAPACIDAD_PIN_INCOMPATIBLE")
})

test("extra. Conectar con payload undefined-ish (componente vacio) rechaza sin excepcion", () => {
  const { motor } = crearMotorDePrueba()
  motor.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  const r = motor.aplicar(op("Conectar", { desde: { componente: "", terminal: "" }, hasta: { componente: "", terminal: "" } }, 1))
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "REFERENCIA_INEXISTENTE")
})
