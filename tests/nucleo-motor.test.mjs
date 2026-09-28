// Gate 6 — Project Engine (`motor.ts`): ÚNICA autoridad de mutación del proyecto.
//
// El `Almacen` real (fs) es Gate 7 — acá se inyecta un almacén FALSO en memoria (el
// motor sólo conoce la interfaz `Almacen`, definida en motor.ts porque este gate va
// antes que Gate 7 en el orden pedido).

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { crearMotorDeProyecto } = await import(join(REPO, "opencode/nucleo/motor.ts"))
const { crearProyecto, cargarProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { clonarProfundo, canonicalizar } = await import(join(REPO, "opencode/nucleo/canonico.ts"))
const { construirCatalogoMinimoReal } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
// Phase 1.1 (hallazgo externo E3-07): estos tests, a diferencia del resto del
// archivo, necesitan el `Almacen` REAL de Gate 7 (no el falso en memoria de más
// abajo) porque el fix de E3-07 vive DENTRO de `crearAlmacen()` — el punto es
// justamente verificar que DOS motores reales, compartiendo la MISMA instancia de
// almacén real (con un `fs` inyectado falso, nunca disco de verdad), detectan la
// colisión de escritura.
const { crearAlmacen } = await import(join(REPO, "opencode/nucleo/almacen.ts"))

const catalogo = construirCatalogoMinimoReal()

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

let contadorId = 0
function nuevaOperacion(tipo, payload, baseRevision) {
  return { idOperacion: `op-${contadorId++}`, actor: "agente", baseRevision, tipo, payload }
}

function crearMotorDePrueba() {
  const proyectoInicial = crearProyecto({ generadorId: () => "proy-test", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const almacen = crearAlmacenFalso()
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen })
  return { motor, almacen, proyectoInicial }
}

// ─────────────────────────── 1. snapshot inmutable ────────────────────────────────────

test("getProyecto-devuelve-snapshot-inmutable", () => {
  const { motor } = crearMotorDePrueba()
  const p = motor.getProyecto()
  assert.ok(Object.isFrozen(p))
  assert.throws(() => {
    "use strict"
    p.revision = 999
  })
})

// ─────────────────────── 2. proponer: dry-run puro ────────────────────────────────────

test("proponer-dry-run-no-muta-no-persiste-no-sube-revision", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const antes = motor.getProyecto()
  const r = motor.proponer([nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0)])
  assert.equal(r.ok, true)
  assert.equal(r.revisionActual, 0, "dry-run nunca sube la revision")
  assert.equal(motor.getProyecto(), antes, "el canonico no cambio")
  assert.equal(almacen.llamadasGuardar.length, 0, "un dry-run nunca llama a guardar")
})

// ────────────────────── 3. Camino A: representable commitea (§43) ────────────────────

test("aplicar-representable-blocking-commitea-camino-a", () => {
  const { motor, almacen } = crearMotorDePrueba()
  motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "led" }, 1))
  const r3 = motor.aplicar(nuevaOperacion("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO23" }, 2))
  assert.equal(r3.ok, true)
  const revisionTrasPrimerLed = motor.getProyecto().revision

  motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "led" }, revisionTrasPrimerLed))
  const rSegundoPin = motor.aplicar(nuevaOperacion("AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO23" }, revisionTrasPrimerLed + 1))
  assert.equal(rSegundoPin.ok, true, "PIN_OCUPADO es representable: la transaccion COMMITEA")
  assert.ok(rSegundoPin.motivos.some((m) => m.codigo === "PIN_OCUPADO"))
  assert.equal(motor.getProyecto().revision, revisionTrasPrimerLed + 2, "la revision SUBE aunque el resultado quede invalido")
  assert.equal(almacen.llamadasGuardar.length, motor.getProyecto().revision, "cada commit exitoso persiste")
})

// ─────────────────────── 4. Camino B: rechazo NO representable (§44) ──────────────────

test("aplicar-rechazo-no-representable-no-commitea-camino-b", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const antes = motor.getProyecto()
  const llamadasAntes = almacen.llamadasGuardar.length
  const r = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "placa-fantasma" }, 0))
  assert.equal(r.ok, false)
  assert.equal(motor.getProyecto(), antes, "el canonico es la MISMA referencia: nada cambio")
  assert.equal(almacen.llamadasGuardar.length, llamadasAntes, "un rechazo nunca llama a guardar")
  assert.equal(r.revisionActual, 0)
  assert.ok(r.motivos.some((m) => m.codigo === "PLACA_DESCONOCIDA" && m.clasificacion === "rechazo"))
})

// ─────────────────── 5. revision sube exactamente 1 por transaccion ──────────────────

test("revision-sube-exactamente-1-sin-importar-tamano-del-lote", () => {
  const { motor } = crearMotorDePrueba()
  const r = motor.aplicarTransaccion([nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0), nuevaOperacion("AgregarComponente", { tipo: "led" }, 0), nuevaOperacion("AgregarComponente", { tipo: "resistencia" }, 0)])
  assert.equal(r.ok, true)
  assert.equal(motor.getProyecto().revision, 1, "3 operaciones en 1 transaccion => revision sube 1 sola vez")
})

// Phase 1.1 (GAP de la matriz INVARIANTES-ENTRYPOINTS.md, fila "unique IDs", puerta
// Batch): varias operaciones que generan id local DENTRO del mismo lote deben producir
// ids distintos y consecutivos — cada aplicador ve el contador ya avanzado por el
// anterior, nunca el `siguienteIdLocal` del canónico previo al lote.
test("lote-con-varias-altas-genera-ids-distintos-y-consecutivos (Phase 1.1, GAP matriz)", () => {
  const { motor } = crearMotorDePrueba()
  const r = motor.aplicarTransaccion([
    nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0),
    nuevaOperacion("AgregarComponente", { tipo: "led" }, 0),
    nuevaOperacion("AgregarComponente", { tipo: "resistencia" }, 0),
    nuevaOperacion("AgregarComponente", { tipo: "led" }, 0),
  ])
  assert.equal(r.ok, true)
  const p = motor.getProyecto()
  assert.deepEqual(
    p.componentes.map((c) => c.id),
    ["cmp-0", "cmp-1", "cmp-2"],
    "tres altas en un lote => tres ids distintos, en orden",
  )
  assert.equal(p.siguienteIdLocal, 3, "el contador avanza una vez por alta, no una vez por lote")
})

// ──────────────────── 6. baseRevision obsoleta rechaza SIN clonar ────────────────────

test("baseRevision-obsoleta-rechaza-sin-clonar", () => {
  const proyectoInicial = crearProyecto({ generadorId: () => "proy-test", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const almacen = crearAlmacenFalso()
  let llamadasClonar = 0
  const clonarEspiado = (v) => {
    llamadasClonar++
    return clonarProfundo(v)
  }
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen, clonar: clonarEspiado })
  // La construcción llama a `clonar` UNA vez, para el centinela que valida que
  // aísla referencias (revisión de arquitectura Gate 8, §77) — es una llamada
  // nueva y deliberada, distinta de la que hace `ejecutarLote`. Lo que este test
  // prueba sigue intacto: que una baseRevision obsoleta NO agrega una llamada más.
  const llamadasTrasConstruir = llamadasClonar
  const r = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 99)) // 99 != revision real (0)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "BASE_REVISION_DESACTUALIZADA")
  assert.equal(llamadasClonar, llamadasTrasConstruir, "una baseRevision obsoleta corta ANTES de clonar: ninguna llamada NUEVA respecto de la construcción")
})

// ──────────── 7. stale por §47: cliente A commitea, cliente B (base vieja) rechaza ───

test("stale-cliente-a-commitea-cliente-b-con-base-vieja-rechaza-canonico-intacto", () => {
  const { motor } = crearMotorDePrueba()
  const rA = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0)) // cliente A: N -> N+1
  assert.equal(rA.ok, true)
  const canonicoTrasA = motor.getProyecto()
  assert.equal(canonicoTrasA.revision, 1)

  const rB = motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "led" }, 0)) // cliente B: todavia cree que la base es 0
  assert.equal(rB.ok, false)
  assert.equal(rB.motivos[0].codigo, "BASE_REVISION_DESACTUALIZADA")
  assert.equal(motor.getProyecto(), canonicoTrasA, "el canonico se queda en N+1 (el commit de A), sin tocar por el intento de B")
})

// ────────────────── 8. fallo dentro del lote → rollback total, sin cambios parciales ─

test("fallo-dentro-del-lote-rollback-total-ir-previa-intacta", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const antes = motor.getProyecto()
  const llamadasAntes = almacen.llamadasGuardar.length
  const r = motor.aplicarTransaccion([
    nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0),
    nuevaOperacion("QuitarComponente", { componente: "cmp-no-existe" }, 0), // 2da operacion: rechazo
    nuevaOperacion("AgregarComponente", { tipo: "led" }, 0),
  ])
  assert.equal(r.ok, false)
  assert.equal(motor.getProyecto(), antes, "el lote entero se descarta: ni siquiera el SetPlaca (1er op valida) queda aplicado")
  assert.equal(almacen.llamadasGuardar.length, llamadasAntes)
})

// ──────── 9. orden persistir→swap: si guardar falla, memoria queda en estado previo ──

test("orden-persistir-swap-fallo-de-guardar-preserva-estado-previo", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const antes = motor.getProyecto()
  almacen._forzarFalloProximo()
  const r = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  assert.equal(r.ok, false)
  assert.ok(r.motivos.some((m) => m.codigo === "PERSIST_FAILED"))
  assert.equal(motor.getProyecto(), antes, "la memoria NO cambio porque el guardado fallo")
  assert.equal(almacen._store.has(antes.id), false, "el disco (almacen falso) tampoco quedo con el nuevo estado")
})

// ───────────────── 10/11. buffer de undo-readiness ───────────────────────────────────

test("buffer-undo-solo-registra-transacciones-aceptadas", () => {
  const { motor } = crearMotorDePrueba()
  motor.aplicar(nuevaOperacion("SetPlaca", { placa: "placa-fantasma" }, 0)) // rechazada
  motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0)) // aceptada
  motor.proponer([nuevaOperacion("AgregarComponente", { tipo: "led" }, 1)]) // dry-run
  const buffer = motor.obtenerBufferUndo()
  assert.equal(buffer.length, 1, "solo la transaccion ACEPTADA entra al buffer")
})

test("buffer-undo-acotado-a-50", () => {
  const { motor } = crearMotorDePrueba()
  motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  for (let i = 0; i < 55; i++) {
    motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "resistencia" }, motor.getProyecto().revision))
  }
  assert.equal(motor.obtenerBufferUndo().length, 50)
})

// Phase 1.1 (hallazgo externo E3-06, MENOR): `bufferUndo.push(resultado)` guarda el
// MISMO objeto `ResultadoTransaccion` que se devuelve al llamador (no una copia
// defensiva) — `obtenerBufferUndo()` sólo hace `slice()` del array CONTENEDOR, nunca
// clona cada entrada (evidencia/e3/scripts/e2_revision_dryrun_tx_inmut.mjs, §30). Un
// consumidor que mute el resultado devuelto corrompe en el lugar la entrada histórica
// del buffer, sin ningún aviso — mismo criterio de congelado que ya protege al
// `Proyecto` canónico (`canonico.ts`, `congelarProfundo`), acá aplicado al
// `ResultadoTransaccion`.

test("ResultadoTransaccion (commit aceptado) esta profundamente congelado, y el buffer de undo es inmune a que el llamador lo mute (hallazgo externo E3-06)", () => {
  const { motor } = crearMotorDePrueba()
  const r = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  assert.equal(r.ok, true)
  assert.ok(Object.isFrozen(r), "el ResultadoTransaccion debe estar congelado")
  assert.ok(Object.isFrozen(r.motivos), "motivos debe estar congelado")
  assert.ok(Object.isFrozen(r.resultadosOperaciones), "resultadosOperaciones debe estar congelado")

  assert.throws(() => {
    "use strict"
    r.ok = false
  }, "mutar r.ok debe lanzar TypeError en modo estricto")
  assert.throws(() => {
    "use strict"
    r.motivos.push({ codigo: "FALSO" })
  }, "empujar a r.motivos debe lanzar TypeError en modo estricto")

  const entradaBuffer = motor.obtenerBufferUndo().at(-1)
  assert.equal(entradaBuffer, r, "el buffer sigue guardando el MISMO objeto (aliasing intencional, ahora inofensivo porque esta congelado)")
  assert.equal(entradaBuffer.ok, true, "la entrada del buffer nunca pudo corromperse, porque la mutacion de arriba nunca aplico")
  assert.equal(entradaBuffer.motivos.length, r.motivos.length, "idem para motivos")
})

test("ResultadoTransaccion tambien esta congelado en rechazo/dry-run/fallo de persistencia (E3-06, mismo patron para todo resultado, no solo el que entra al buffer)", () => {
  const { motor, almacen } = crearMotorDePrueba()

  const rRechazo = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "placa-fantasma" }, 0))
  assert.equal(rRechazo.ok, false)
  assert.ok(Object.isFrozen(rRechazo), "un rechazo tambien debe devolver un ResultadoTransaccion congelado")

  const rDryRun = motor.proponer([nuevaOperacion("AgregarComponente", { tipo: "led" }, 0)])
  assert.equal(rDryRun.ok, true)
  assert.ok(Object.isFrozen(rDryRun), "un dry-run tambien debe devolver un ResultadoTransaccion congelado")

  almacen._forzarFalloProximo()
  const rFalloPersistencia = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  assert.equal(rFalloPersistencia.ok, false)
  assert.ok(Object.isFrozen(rFalloPersistencia), "un fallo de persistencia tambien debe devolver un ResultadoTransaccion congelado")

  const rVacio = motor.proponer([])
  assert.equal(rVacio.ok, true)
  assert.ok(Object.isFrozen(rVacio), "el no-op de lote vacio (E3-05) tambien debe devolver un ResultadoTransaccion congelado")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Hallazgo adversarial Gate 8 (item 4, Agente X): motor.ts sólo cortaba el lote por
// `motivosPropios` (los que emite `aplicarOperacion` por operación) — nunca revisaba
// si `validarProyecto(borrador, catalogo)`, corrida DESPUÉS de aplicar todo el lote,
// traía un motivo `clasificacion:"rechazo"` (que `validar-estructural.ts` SÍ puede
// emitir, `REFERENCIA_INEXISTENTE`, a diferencia de `validar-tecnico.ts`, que nunca
// usa esa clasificación). No explotable hoy vía las 8 operaciones públicas (todas
// re-chequean referencias antes de mutar), pero SÍ si `proyectoInicial` ya llega roto
// (bypaseando `cargarProyecto`) o si una regla nueva de validación gana esa
// clasificación en el futuro. Dos arreglos, ambos probados acá:
//
//   (a) el motor se NIEGA a construirse sobre un `proyectoInicial` que ya trae un
//       motivo `clasificacion:"rechazo"` — lanza `ErrorEstadoInicialInvalido`.
//   (b) defensa en profundidad: en el pipeline de commit, CUALQUIER motivo
//       `clasificacion:"rechazo"` que aparezca en `validarProyecto()` post-lote
//       corta la transacción entera, igual que un rechazo por operación.
// ════════════════════════════════════════════════════════════════════════════════════

test("constructor-rechaza-proyectoInicial-con-motivo-clasificacion-rechazo (hallazgo adversarial Gate 8, item 4)", () => {
  const base = crearProyecto({ generadorId: () => "proy-roto", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const roto = {
    ...base,
    placa: "esp32-devkit-v1",
    componentes: [{ id: "cmp-0", tipo: "led", pines: { anodo: "GPIO23" }, propiedades: {} }],
    conexiones: [{ id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-NO-EXISTE", terminal: "a" } }],
    siguienteIdLocal: 1,
  }
  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial: roto, catalogo, almacen: crearAlmacenFalso() }),
    (err) => {
      assert.ok(err.motivos?.some((m) => m.codigo === "REFERENCIA_INEXISTENTE" && m.clasificacion === "rechazo"), `el error debe traer el motivo estructurado: ${JSON.stringify(err.motivos)}`)
      return true
    },
    "un proyectoInicial con una referencia colgada NUNCA debe llegar a construir un motor operable",
  )
})

test("defensa-en-profundidad: motivo clasificacion=rechazo desde la validacion post-lote descarta el commit entero", () => {
  // Estado inicial LIMPIO (pasa el chequeo del constructor) — se inyecta una
  // validación ADICIONAL (nunca se toca validar-estructural.ts/validar-tecnico.ts
  // reales) para simular, sin inventar un escenario explotable de verdad hoy, que
  // una validación futura o distinta encuentre un motivo "rechazo" DESPUÉS de
  // aplicar el lote. La real SIEMPRE corre en paralelo (unión, no reemplazo, ver
  // revisión de arquitectura Gate 8) — acá la real da `[]` porque el estado es
  // válido, así que el único motivo que aparece es el que agrega el fixture.
  const proyectoInicial = crearProyecto({ generadorId: () => "proy-defensa", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  let llamadas = 0
  const validacionAdicionalFalsa = () => {
    llamadas++
    if (llamadas === 1) return [] // la llamada de construcción ve un estado limpio
    return [{ codigo: "MOTIVO_FIXTURE_RECHAZO", categoria: "referencial", severidad: "blocking", clasificacion: "rechazo" }]
  }
  const almacen = crearAlmacenFalso()
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen, validacionAdicionalSoloTests: validacionAdicionalFalsa })
  const antes = motor.getProyecto()

  const r = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  assert.equal(r.ok, false, "un rechazo post-lote debe tumbar la transaccion entera, aunque la operacion en si misma fuera valida")
  assert.ok(r.motivos.some((m) => m.codigo === "MOTIVO_FIXTURE_RECHAZO"))
  assert.equal(motor.getProyecto(), antes, "el canonico no cambia")
  assert.equal(almacen.llamadasGuardar.length, 0, "nunca se llega a persistir")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Revisión de arquitectura Gate 8 (§77, PASS_WITH_NOTE): `validarProyecto`/`clonar`
// inyectables en `DependenciasMotor` eran un backdoor potencial — nada en runtime
// impedía que un consumidor futuro inyectara `() => []` (aprueba todo) o un `clonar`
// identidad (rompe el aislamiento borrador/canónico). Cerrado acá:
//   - la validación REAL siempre corre; lo inyectable (renombrado
//     `validacionAdicionalSoloTests` para que grite su propósito) sólo puede AGREGAR
//     motivos (unión), nunca reemplazar ni vaciar el resultado real.
//   - `clonar` inyectado se valida con un centinela al construir: si
//     `clonar(x) === x` para un objeto de prueba, el motor tira `ErrorClonadoInvalido`
//     en vez de aceptar un "clon" que en realidad comparte referencia.
// ════════════════════════════════════════════════════════════════════════════════════

test("validacionAdicionalSoloTests que devuelve [] NO abre una puerta trasera en la construcción", () => {
  const base = crearProyecto({ generadorId: () => "proy-backdoor-1", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const roto = {
    ...base,
    placa: "esp32-devkit-v1",
    componentes: [{ id: "cmp-0", tipo: "led", pines: { anodo: "GPIO23" }, propiedades: {} }],
    conexiones: [{ id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-NO-EXISTE", terminal: "a" } }],
    siguienteIdLocal: 1,
  }
  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial: roto, catalogo, almacen: crearAlmacenFalso(), validacionAdicionalSoloTests: () => [] }),
    (err) => {
      assert.ok(err.motivos?.some((m) => m.codigo === "REFERENCIA_INEXISTENTE" && m.clasificacion === "rechazo"))
      return true
    },
    "inyectar una validacion adicional vacia NO debe anular la validacion REAL — el estado roto se rechaza igual",
  )
})

test("validacionAdicionalSoloTests que devuelve [] NO abre una puerta trasera en el commit (motivos representables reales siguen apareciendo)", () => {
  const { motor } = crearMotorDePrueba()
  const motorConAdicionalVacia = crearMotorDeProyecto({ proyectoInicial: motor.getProyecto(), catalogo, almacen: crearAlmacenFalso(), validacionAdicionalSoloTests: () => [] })
  motorConAdicionalVacia.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  motorConAdicionalVacia.aplicar(nuevaOperacion("AgregarComponente", { tipo: "led" }, 1))
  motorConAdicionalVacia.aplicar(nuevaOperacion("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO23" }, 2))
  motorConAdicionalVacia.aplicar(nuevaOperacion("AgregarComponente", { tipo: "led" }, 3))
  const r = motorConAdicionalVacia.aplicar(nuevaOperacion("AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO23" }, 4)) // PIN_OCUPADO real
  assert.equal(r.ok, true, "PIN_OCUPADO es representable: sigue commiteando")
  assert.ok(
    r.motivos.some((m) => m.codigo === "PIN_OCUPADO"),
    "la validacion tecnica REAL corrio igual: una validacion adicional que devuelve [] no la reemplaza ni la esconde",
  )
})

test("clonar inyectado que devuelve la MISMA referencia (identidad) hace que el motor se niegue a construirse", () => {
  const clonarIdentidad = (valor) => valor
  const proyectoInicial = crearProyecto({ generadorId: () => "proy-clonar-identidad", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: crearAlmacenFalso(), clonar: clonarIdentidad }),
    /ErrorClonadoInvalido|no aísla|mismo objeto/i,
    "un clonar que no aisla referencias debe rechazarse en la construcción, antes de que rompa el aislamiento borrador/canónico",
  )
})

// Phase 1.1 (hallazgo externo E3-02, MENOR): el centinela de arriba sólo prueba
// identidad de nivel SUPERIOR (`clonar(x) === x`) — un `clonar` que hace una copia
// SUPERFICIAL (`(v) => ({...v})`) devuelve una referencia NUEVA en el nivel superior
// y pasa el centinela sin lanzar, aunque comparta por referencia cualquier objeto
// anidado (arrays/objetos dentro de `Componente.pines`, `Componente.propiedades`,
// etc.) con el canónico — exactamente el aislamiento que este centinela existe para
// garantizar (evidencia/e3/scripts/e1_motor_flujo.mjs TEST 3).
test("clonar inyectado que hace copia SUPERFICIAL (nivel superior nuevo, anidado compartido) tambien hace que el motor se niegue a construirse (hallazgo externo E3-02)", () => {
  const clonarSuperficial = (valor) => ({ ...valor })
  const proyectoInicial = crearProyecto({ generadorId: () => "proy-clonar-superficial", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: crearAlmacenFalso(), clonar: clonarSuperficial }),
    /ErrorClonadoInvalido|no aísla|anidado/i,
    "un clonar que sólo copia el nivel superior, compartiendo objetos anidados por referencia, debe rechazarse igual que la identidad pura",
  )
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgos externos E1-01/E1-02: `cargarProyecto()` (Gate 2) no es la
// ÚNICA puerta de entrada de un `Proyecto` — un `proyectoInicial` armado a mano
// (bypaseando el loader, IR-SPEC.md §6) también tiene que rechazar un contador de ids
// locales inconsistente o ids duplicados entre conexiones/comportamientos, exactamente
// igual que el hallazgo adversarial Gate 8 (item 4, arriba) ya hace para referencias
// colgadas. Misma regla que `cargarProyecto.ts` (`validarIdsYContador`, id.ts), un solo
// lugar reusado — no una copia paralela acá.
// ════════════════════════════════════════════════════════════════════════════════════

test("constructor-rechaza-proyectoInicial-con-contador-id-inconsistente (hallazgo externo E1-01)", () => {
  const base = crearProyecto({ generadorId: () => "proy-e1-01", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const roto = {
    ...base,
    componentes: [{ id: "cmp-0", tipo: "led", pines: { anodo: null }, propiedades: {} }],
    siguienteIdLocal: 0, // desincronizado: cmp-0 YA existe — bypasea cargarProyecto directo
  }
  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial: roto, catalogo, almacen: crearAlmacenFalso() }),
    (err) => {
      assert.ok(err.motivos?.some((m) => m.codigo === "CONTADOR_ID_INCONSISTENTE" && m.clasificacion === "rechazo"), `el error debe traer el motivo estructurado: ${JSON.stringify(err.motivos)}`)
      return true
    },
    "un proyectoInicial con el contador de ids desincronizado NUNCA debe llegar a construir un motor operable",
  )
})

test("constructor-rechaza-proyectoInicial-con-ids-duplicados-entre-conexiones (hallazgo externo E1-02)", () => {
  const base = crearProyecto({ generadorId: () => "proy-e1-02", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const roto = {
    ...base,
    componentes: [
      { id: "cmp-0", tipo: "led", pines: { anodo: null }, propiedades: {} },
      { id: "cmp-1", tipo: "resistencia", pines: {}, propiedades: {} },
    ],
    conexiones: [
      { id: "conn-0", desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-1", terminal: "a" } },
      { id: "conn-0", desde: { componente: "cmp-1", terminal: "a" }, hasta: { componente: "cmp-0", terminal: "anodo" } },
    ],
    siguienteIdLocal: 2, // consistente con los ids (max=1) — el ÚNICO problema es el id duplicado
  }
  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial: roto, catalogo, almacen: crearAlmacenFalso() }),
    (err) => {
      assert.ok(err.motivos?.some((m) => m.codigo === "ID_DUPLICADO" && m.clasificacion === "rechazo"), `el error debe traer el motivo estructurado: ${JSON.stringify(err.motivos)}`)
      return true
    },
    "un proyectoInicial con dos conexiones con el MISMO id NUNCA debe llegar a construir un motor operable",
  )
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgo externo E1-03 (CRÍTICO): un `proyectoInicial` armado a mano
// bypasea TANTO `cargarProyecto()` (Gate 2) COMO `aplicarSetComportamiento`
// (Gate 5) — las dos puertas donde este fix también rechaza un `umbral.valor` no
// finito. `validar-estructural.ts` (Gate 4, SIN catálogo, corrida por
// `validarProyecto` dentro de la construcción del motor) es la TERCERA puerta,
// la que cierra este caso — mismo criterio que ya usan los tests E1-01/E1-02 de
// arriba para el contador de ids/ids duplicados.
// ════════════════════════════════════════════════════════════════════════════════════

test("constructor-rechaza-proyectoInicial-con-umbral-no-finito (hallazgo externo E1-03)", () => {
  const base = crearProyecto({ generadorId: () => "proy-e1-03", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const roto = {
    ...base,
    placa: "esp32-devkit-v1",
    componentes: [
      { id: "cmp-0", tipo: "led", pines: { anodo: "GPIO23" }, propiedades: {} },
      { id: "cmp-1", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} },
    ],
    comportamientos: [
      { id: "beh-0", cuando: { sensor: "cmp-1", capacidad: "temperatura", comparador: ">", umbral: { valor: Infinity, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-0", accion: "encender" } },
    ],
    siguienteIdLocal: 2,
  }
  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial: roto, catalogo, almacen: crearAlmacenFalso() }),
    (err) => {
      assert.ok(err.motivos?.some((m) => m.codigo === "UMBRAL_NO_FINITO" && m.clasificacion === "rechazo"), `el error debe traer el motivo estructurado: ${JSON.stringify(err.motivos)}`)
      return true
    },
    "un proyectoInicial con un umbral no finito (bypaseando cargarProyecto Y la operación SetComportamiento) NUNCA debe llegar a construir un motor operable",
  )
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgo externo E2-01 (CRÍTICO): "sin auto-conexión (self-loop) / sin
// conexión duplicada" antes SÓLO existía como chequeo ad-hoc dentro de `aplicarConectar`
// (`operaciones.ts`, Gate 5) — nunca llegaba a la construcción del motor sobre un
// `proyectoInicial` armado a mano que bypasea tanto el loader como la operación
// (evidencia/e2/exp5_motor_acepta_selfloop_inicial.mjs: el motor se construía
// exitosamente, SIN lanzar `ErrorEstadoInicialInvalido`, falsificando IR-SPEC.md §6).
// Se cierra vía `validar-estructural.ts` (Gate 4, corrida por `validarProyecto` dentro
// de la construcción del motor) — mismo criterio que el test E1-03 de arriba.
// ════════════════════════════════════════════════════════════════════════════════════

test("constructor-rechaza-proyectoInicial-con-selfloop (hallazgo externo E2-01)", () => {
  const base = crearProyecto({ generadorId: () => "proy-e2-01-selfloop", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const roto = {
    ...base,
    componentes: [{ id: "cmp-0", tipo: "resistencia", pines: {}, propiedades: {} }],
    conexiones: [{ id: "conn-0", desde: { componente: "cmp-0", terminal: "a" }, hasta: { componente: "cmp-0", terminal: "a" } }],
    siguienteIdLocal: 1,
  }
  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial: roto, catalogo, almacen: crearAlmacenFalso() }),
    (err) => {
      assert.ok(err.motivos?.some((m) => m.codigo === "AUTOCONEXION_INVALIDA" && m.clasificacion === "rechazo"), `el error debe traer el motivo estructurado: ${JSON.stringify(err.motivos)}`)
      return true
    },
    "un proyectoInicial con self-loop (bypaseando cargarProyecto Y la operación Conectar) NUNCA debe llegar a construir un motor operable",
  )
})

test("constructor-rechaza-proyectoInicial-con-conexion-duplicada (hallazgo externo E2-01)", () => {
  const base = crearProyecto({ generadorId: () => "proy-e2-01-duplicada", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const roto = {
    ...base,
    componentes: [{ id: "cmp-0", tipo: "resistencia", pines: {}, propiedades: {} }],
    conexiones: [
      { id: "conn-0", desde: { componente: "cmp-0", terminal: "a" }, hasta: { componente: "cmp-0", terminal: "b" } },
      // MISMO par que conn-0, extremos invertidos — "misma conexión" no depende del orden.
      { id: "conn-1", desde: { componente: "cmp-0", terminal: "b" }, hasta: { componente: "cmp-0", terminal: "a" } },
    ],
    siguienteIdLocal: 2,
  }
  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial: roto, catalogo, almacen: crearAlmacenFalso() }),
    (err) => {
      assert.ok(err.motivos?.some((m) => m.codigo === "CONEXION_DUPLICADA" && m.clasificacion === "rechazo"), `el error debe traer el motivo estructurado: ${JSON.stringify(err.motivos)}`)
      return true
    },
    "un proyectoInicial con dos conexiones que conectan el MISMO par (orden invertido) NUNCA debe llegar a construir un motor operable",
  )
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgo externo CP-01 (checkpoint de T5, tratado como CRÍTICO,
// evidencia/T5/CP01_proyectoInicial_forma.txt): `crearMotorDeProyecto({ proyectoInicial })`
// NO aplicaba la validación de FORMA/SCHEMA que `cargarProyecto()` sí aplica — un
// `proyectoInicial` con una clave desconocida en la raíz, `revision`/`siguienteIdLocal`
// con tipo o valor incorrecto, un `schemaVersion` no soportado, o un componente con
// `tipo`/`pines` de tipo basura construía un motor "operable" SIN ningún diagnóstico; y
// con `undefined`/`null`/`{}`/`[]` el constructor explotaba con un `TypeError` crudo en
// vez de `ErrorEstadoInicialInvalido`. `validarFormaProyecto` (`cargador.ts`) — la MISMA
// función que usa `cargarProyecto()` tras `JSON.parse`, nunca una copia — corre ahora
// también en la construcción del motor (`motor.ts`).
// ════════════════════════════════════════════════════════════════════════════════════

test("constructor-rechaza-proyectoInicial-con-forma-invalida (hallazgo externo CP-01) — table-driven", () => {
  const base = crearProyecto({ generadorId: () => "proy-cp01", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })

  const casos = [
    { nombre: "clave desconocida en la raiz", proyectoInicial: { ...base, claveInventada: "x" }, codigoEsperado: "CLAVE_DESCONOCIDA" },
    { nombre: "revision negativa", proyectoInicial: { ...base, revision: -5 }, codigoEsperado: "CAMPO_REQUERIDO_FALTANTE" },
    { nombre: "revision string", proyectoInicial: { ...base, revision: "7" }, codigoEsperado: "CAMPO_REQUERIDO_FALTANTE" },
    {
      // Nota (hallazgo externo RX-01): este caso ya NO lleva una clave extra
      // (`extra: true`) — desde RX-01, cargador.ts rechaza TAMBIÉN claves anidadas
      // desconocidas con CLAVE_DESCONOCIDA, y esa clave hubiera cambiado el código
      // esperado de este caso (que quiere ejercitar específicamente tipo/pines con
      // tipo incorrecto, no la detección de claves extra — eso ya tiene su propio
      // test dedicado, ver más abajo "constructor-rechaza-proyectoInicial-con-clave-
      // anidada-desconocida-en-componente").
      nombre: "componente basura (tipo/pines con tipo incorrecto)",
      proyectoInicial: { ...base, componentes: [{ id: "cmp-0", tipo: 123, pines: "x" }], siguienteIdLocal: 1 },
      codigoEsperado: "CAMPO_REQUERIDO_FALTANTE",
    },
    { nombre: "schemaVersion desconocida", proyectoInicial: { ...base, schemaVersion: "99.0.0" }, codigoEsperado: "VERSION_SCHEMA_DESCONOCIDA" },
  ]

  for (const { nombre, proyectoInicial, codigoEsperado } of casos) {
    assert.throws(
      () => crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: crearAlmacenFalso() }),
      (err) => {
        assert.ok(err instanceof Error && err.name === "ErrorEstadoInicialInvalido", `caso "${nombre}": debe lanzar ErrorEstadoInicialInvalido, no otra cosa: ${err}`)
        assert.ok(
          err.motivos?.some((m) => m.codigo === codigoEsperado && m.clasificacion === "rechazo"),
          `caso "${nombre}": el error debe traer el motivo ${codigoEsperado}: ${JSON.stringify(err.motivos)}`,
        )
        return true
      },
      `caso "${nombre}": un proyectoInicial con forma invalida NUNCA debe construir un motor operable`,
    )
  }
})

test("constructor-rechaza-proyectoInicial-undefined-null-vacio-o-array-sin-TypeError-crudo (hallazgo externo CP-01)", () => {
  const casos = [
    { nombre: "undefined", proyectoInicial: undefined },
    { nombre: "null", proyectoInicial: null },
    { nombre: "objeto vacio", proyectoInicial: {} },
    { nombre: "array vacio", proyectoInicial: [] },
  ]
  for (const { nombre, proyectoInicial } of casos) {
    assert.throws(
      () => crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: crearAlmacenFalso() }),
      (err) => {
        assert.ok(
          err instanceof Error && err.name === "ErrorEstadoInicialInvalido",
          `caso "${nombre}": debe lanzar ErrorEstadoInicialInvalido — NUNCA un TypeError crudo: ${err?.stack ?? err}`,
        )
        assert.ok(
          Array.isArray(err.motivos) && err.motivos.length > 0 && err.motivos.every((m) => m.clasificacion === "rechazo"),
          `caso "${nombre}": el error debe traer motivos estructurados: ${JSON.stringify(err.motivos)}`,
        )
        return true
      },
      `caso "${nombre}": un proyectoInicial asi NUNCA debe propagar un TypeError crudo`,
    )
  }
})

test("constructor-sigue-construyendo-con-un-proyectoInicial-de-crearProyecto (control, hallazgo externo CP-01)", () => {
  const proyectoInicial = crearProyecto({ generadorId: () => "proy-cp01-control", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: crearAlmacenFalso() })
  assert.equal(motor.getProyecto().id, "proy-cp01-control")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgo externo E2-02 (CRÍTICO): confirma, en la FRONTERA PÚBLICA del
// motor (`aplicar`/`aplicarTransaccion`/`proponer`, no sólo `aplicarOperacion` en
// aislamiento — ver tests/nucleo-operaciones.test.mjs), que una operación malformada
// NUNCA propaga una excepción cruda. Reproducción original:
// evidencia/e2/exp2b_motor_crash_propagation.mjs.
// ════════════════════════════════════════════════════════════════════════════════════

test("motor.aplicar/aplicarTransaccion/proponer NUNCA propagan una excepcion cruda ante una operacion malformada (hallazgo externo E2-02)", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const revisionAntes = motor.getProyecto().revision
  const llamadasAntes = almacen.llamadasGuardar.length
  const operacionMalformada = { idOperacion: "op-crash", actor: "agente", baseRevision: 0, tipo: "Conectar", payload: {} }

  let r1
  assert.doesNotThrow(() => {
    r1 = motor.aplicar(operacionMalformada)
  }, "motor.aplicar NUNCA debe lanzar una excepcion cruda")
  assert.equal(r1.ok, false)
  assert.equal(r1.motivos[0].codigo, "PAYLOAD_OPERACION_INVALIDO")

  let r2
  assert.doesNotThrow(() => {
    r2 = motor.aplicarTransaccion([operacionMalformada])
  }, "motor.aplicarTransaccion NUNCA debe lanzar una excepcion cruda")
  assert.equal(r2.ok, false)
  assert.equal(r2.motivos[0].codigo, "PAYLOAD_OPERACION_INVALIDO")

  let r3
  assert.doesNotThrow(() => {
    r3 = motor.proponer([operacionMalformada])
  }, "motor.proponer NUNCA debe lanzar una excepcion cruda")
  assert.equal(r3.ok, false)
  assert.equal(r3.motivos[0].codigo, "PAYLOAD_OPERACION_INVALIDO")

  assert.equal(motor.getProyecto().revision, revisionAntes, "el canonico no cambio con ninguno de los 3 intentos")
  assert.equal(almacen.llamadasGuardar.length, llamadasAntes, "ninguno de los 3 intentos llamo a guardar")
  assert.equal(motor.obtenerBufferUndo().length, 0, "el buffer de undo no se toco")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (hallazgo externo RX-02, CRÍTICO — reabre E2-02; REABIERTO por RX2-01,
// revisión adversarial independiente #2): la MISMA función que cierra E2-02
// (`analizarSobreOperacion`/`validarFormaPayload`, `operaciones.ts`) lanzaba una
// excepcion cruda cuando cualquier campo que lee es un getter que explota — algo
// que ningún JSON real produce, pero que un llamador en proceso sí puede construir
// (brief §37: "cualquier futura UI son clientes/adaptadores del Project Engine").
// RX2-01 encontró que el fix de RX-02 (un `try/catch` puntual) protegía la
// PRIMERA lectura de `operacion.payload` pero no la SEGUNDA (el switch de
// despacho, sin proteger) — esta ronda (RX2) cierra la clase completa
// materializando el sobre en datos planos UNA sola vez, antes de leer nada
// (`opencode/nucleo/datos-planos.ts`): el código de rechazo pasa a ser
// `ENTRADA_NO_ES_DATO_PLANO`, único y estable para toda esta clase de defecto.
// Reproducido a través de las 3 puertas públicas del motor (T9/scripts/
// 03_e2_getter_via_motor.mjs de la revisión adversarial RX): `motor.aplicar` (SetPlaca,
// getter en `payload.placa`), `motor.aplicarTransaccion` (lote de 2, la SEGUNDA
// operación con el getter), `motor.proponer` (dry-run, mismo getter), SetComportamiento
// con getter en `umbral.valor` (más anidado), y un getter en el propio `actor` del
// sobre.
// ════════════════════════════════════════════════════════════════════════════════════

test("motor.aplicar/aplicarTransaccion/proponer NUNCA propagan un getter-que-explota del sobre/payload (hallazgo externo RX-02/RX2-01)", () => {
  function payloadConGetterQueExplota(campo, mensaje) {
    const payload = {}
    Object.defineProperty(payload, campo, {
      enumerable: true,
      get() {
        throw new Error(mensaje)
      },
    })
    return payload
  }

  // Caso 1: motor.aplicar con getter en payload.placa.
  {
    const { motor, almacen } = crearMotorDePrueba()
    let r
    assert.doesNotThrow(() => {
      r = motor.aplicar({ idOperacion: "op1", actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: payloadConGetterQueExplota("placa", "getter boom en placa") })
    }, "motor.aplicar NUNCA debe propagar el getter (caso 1)")
    assert.equal(r.ok, false)
    assert.equal(r.motivos[0].codigo, "ENTRADA_NO_ES_DATO_PLANO")
    assert.equal(almacen.llamadasGuardar.length, 0, "el intento con getter nunca persiste")
  }

  // Caso 2: motor.aplicarTransaccion — lote de 2, la SEGUNDA operacion trae el getter.
  {
    const { motor, almacen } = crearMotorDePrueba()
    let r
    assert.doesNotThrow(() => {
      r = motor.aplicarTransaccion([
        { idOperacion: "op1", actor: "agente", baseRevision: 0, tipo: "AgregarComponente", payload: { tipo: "led" } },
        { idOperacion: "op2", actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: payloadConGetterQueExplota("placa", "getter boom en placa") },
      ])
    }, "motor.aplicarTransaccion NUNCA debe propagar el getter (caso 2)")
    assert.equal(r.ok, false, "el lote entero rechaza — el getter en la operacion 2 no deja pasar la 1")
    assert.equal(r.motivos[0].codigo, "ENTRADA_NO_ES_DATO_PLANO")
    assert.equal(almacen.llamadasGuardar.length, 0, "ningun lote con un getter que explota persiste")
  }

  // Caso 3: motor.proponer (dry-run) con el mismo getter.
  {
    const { motor } = crearMotorDePrueba()
    let r
    assert.doesNotThrow(() => {
      r = motor.proponer([{ idOperacion: "op1", actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: payloadConGetterQueExplota("placa", "getter boom en placa") }])
    }, "motor.proponer NUNCA debe propagar el getter (caso 3)")
    assert.equal(r.ok, false)
    assert.equal(r.motivos[0].codigo, "ENTRADA_NO_ES_DATO_PLANO")
  }

  // Caso 4: SetComportamiento con getter en un campo MAS anidado (umbral.valor).
  {
    const { motor } = crearMotorDePrueba()
    motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
    motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "dht22" }, 1))
    motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "led" }, 2))
    const umbral = { unidad: "celsius", magnitud: "temperatura" }
    Object.defineProperty(umbral, "valor", {
      enumerable: true,
      get() {
        throw new Error("getter boom en umbral.valor")
      },
    })
    const comportamiento = { cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral }, entonces: { actuador: "cmp-1", accion: "encender" } }
    let r
    assert.doesNotThrow(() => {
      r = motor.aplicar(nuevaOperacion("SetComportamiento", { comportamiento }, 3))
    }, "motor.aplicar NUNCA debe propagar el getter anidado (caso 4)")
    assert.equal(r.ok, false)
    assert.equal(r.motivos[0].codigo, "ENTRADA_NO_ES_DATO_PLANO")
  }

  // Caso 5: getter en el propio `actor` del sobre.
  {
    const { motor } = crearMotorDePrueba()
    const operacion = { idOperacion: "op1", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }
    Object.defineProperty(operacion, "actor", {
      enumerable: true,
      get() {
        throw new Error("getter boom en actor")
      },
    })
    let r
    assert.doesNotThrow(() => {
      r = motor.aplicar(operacion)
    }, "motor.aplicar NUNCA debe propagar el getter del sobre (caso 5)")
    assert.equal(r.ok, false)
    assert.equal(r.motivos[0].codigo, "ENTRADA_NO_ES_DATO_PLANO")
  }

  // Caso 6: getter en el propio `baseRevision` del sobre — específico de
  // `ejecutarLote` (`motor.ts`), que lee `operaciones[0].baseRevision` ANTES de
  // llamar a `aplicarOperacion` (que también materializa, pero puertas adentro:
  // esta lectura ocurre ANTES de eso). Sin la materialización del LOTE COMPLETO
  // en `ejecutarLote`, este caso específico crashea crudo aunque
  // `aplicarOperacion` ya esté protegido — es la superficie que la
  // materialización a nivel de `motor.ts` cierra y que ningún otro mecanismo
  // cubre (ver `motor.ts`, comentario de `ejecutarLote`).
  {
    const { motor } = crearMotorDePrueba()
    const operacion = { idOperacion: "op1", actor: "agente", tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }
    Object.defineProperty(operacion, "baseRevision", {
      enumerable: true,
      get() {
        throw new Error("getter boom en baseRevision")
      },
    })
    let r
    assert.doesNotThrow(() => {
      r = motor.aplicar(operacion)
    }, "motor.aplicar NUNCA debe propagar el getter de baseRevision (caso 6)")
    assert.equal(r.ok, false)
    assert.equal(r.motivos[0].codigo, "ENTRADA_NO_ES_DATO_PLANO")

    let r2
    assert.doesNotThrow(() => {
      r2 = motor.aplicarTransaccion([operacion])
    }, "motor.aplicarTransaccion NUNCA debe propagar el getter de baseRevision (caso 6)")
    assert.equal(r2.ok, false)

    let r3
    assert.doesNotThrow(() => {
      r3 = motor.proponer([operacion])
    }, "motor.proponer NUNCA debe propagar el getter de baseRevision (caso 6)")
    assert.equal(r3.ok, false)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgo M3 (campaña de mutación final, MUTATION_RESULTS_FINAL.md),
// sobreviviente W9-M2b: `ejecutarLote` (motor.ts) lee `baseRevisionRecibida` de
// `operaciones[0]!.baseRevision` — la copia YA materializada por
// `materializarDatosPlanos` (comentario de `ejecutarLote`: "Lectura ya segura, dato
// plano materializado arriba"; cabecera de `datos-planos.ts`: "no puede existir una
// 'segunda lectura' que diverja de la primera") — el mutante W9-M2b
// (`M3/diffs/W9-M2b.diff`) la reemplaza por `operacionesCrudas[0]!.baseRevision` (el
// LOTE CRUDO, tal cual llegó, ANTES de materializar). Ningún test existente lo
// detectaba (pass=952 fail=2, idéntico al baseline): el gate de `baseRevision` —
// diseñado para cortar el lote ANTES de tocar cualquier operación (E3-01) — queda
// neutralizado por la relectura cruda.
//
// Este test expresa el INVARIANTE observable (IR-SPEC.md §6.6/§6.7,
// INVARIANTES-ENTRYPOINTS.md fila 15), no el mecanismo interno — nunca inspecciona
// `ejecutarLote`: construye un `SobreOperacion` completo como Proxy sobre un objeto
// plano configurable cuyo trap `getOwnPropertyDescriptor` (lo que la materialización
// usa) reporta `baseRevision: -1` (dato plano, PASA la materialización; INVÁLIDO
// como regla de negocio — `esEnteroNoNegativo` lo rechaza), pero cuyo trap `get`
// (una relectura cruda posterior) devuelve, para `baseRevision`, `0` — un valor
// DISTINTO, "válido" en el sentido de que coincide con la revisión canónica vigente
// del motor recién construido — válido ECMAScript, sin violar ningún invariante de
// Proxy porque el target es un objeto plano configurable (mismo criterio que
// `M3/m/probe-w9-m2b.mjs`). El veredicto observable (rechazo/no-rechazo, el código
// de motivo, y si el canónico/almacén se tocan) tiene que corresponder SIEMPRE al
// valor MATERIALIZADO (-1, rechazo `BASE_REVISION_INVALIDA`, ANTES de tocar
// cualquier operación) — nunca al valor sólo visible vía el trap `get` vivo (0, que
// dejaría procesar la operación y fallar más tarde, si acaso, por una razón
// distinta) — a través de las 3 puertas públicas que llegan a `ejecutarLote`:
// `motor.aplicar`, `motor.aplicarTransaccion`, `motor.proponer`.
// ════════════════════════════════════════════════════════════════════════════════════

test("motor.aplicar/aplicarTransaccion/proponer usan SIEMPRE el baseRevision MATERIALIZADO de la primera operacion, nunca vuelven a leer el lote crudo (Proxy con getOwnPropertyDescriptor/get inconsistentes, hallazgo M3 W9-M2b)", () => {
  // Envuelve el SOBRE completo (`target`, el valor MATERIALIZADO, A) en un Proxy
  // cuyo `getOwnPropertyDescriptor` reporta fielmente los descriptores de `target`
  // (pasa la materialización del LOTE sin problema, produce exactamente A), pero
  // cuyo `get` devuelve, para las claves presentes en `divergentes`, el valor B —
  // una relectura cruda que SÓLO se observaría si `ejecutarLote` volviera a leer
  // este objeto directamente en vez de usar la copia ya materializada.
  function sobreConRelecturaCrudaDivergente(target, divergentes) {
    return new Proxy(target, {
      getOwnPropertyDescriptor: (t, p) => Reflect.getOwnPropertyDescriptor(t, p),
      get: (t, p, r) => (Object.prototype.hasOwnProperty.call(divergentes, p) ? divergentes[p] : Reflect.get(t, p, r)),
      ownKeys: (t) => Reflect.ownKeys(t),
    })
  }

  function nuevoSobreDivergente() {
    // baseRevision MATERIALIZADO (A) = -1: dato plano válido para la
    // materialización, pero INVÁLIDO segun `esEnteroNoNegativo` — debe rechazar
    // ANTES de tocar la operación. Si algo relee crudo, ve 0 (B) — coincide con
    // `canonico.revision` de un motor recién construido, dejaría pasar el gate. El
    // `tipo`/`payload` (`Desconectar` sobre una conexión inexistente) es deliberado:
    // si el gate se salta de largo, la operación SÍ se procesa y falla con un
    // código DISTINTO (`REFERENCIA_INEXISTENTE`), lo que hace la divergencia
    // observable sin ambigüedad.
    return sobreConRelecturaCrudaDivergente({ idOperacion: "op-w9-m2b", actor: "agente", baseRevision: -1, tipo: "Desconectar", payload: { conexion: "no-existe" } }, { baseRevision: 0 })
  }

  function verificarRechazoPorBaseRevisionInvalida(r, almacen, motor, revisionAntes, nombrePuerta) {
    assert.equal(r.ok, false, `${nombrePuerta}: debe rechazar (baseRevision MATERIALIZADO -1 es invalido)`)
    assert.equal(r.motivos[0]?.codigo, "BASE_REVISION_INVALIDA", `${nombrePuerta}: debe rechazar con BASE_REVISION_INVALIDA usando el valor MATERIALIZADO (-1) — nunca REFERENCIA_INEXISTENTE (lo que pasaria si se relee el crudo, 0, y la operacion llega a procesarse). motivos: ${JSON.stringify(r.motivos)}`)
    assert.equal(r.resultadosOperaciones.length, 0, `${nombrePuerta}: el gate de baseRevision corta ANTES de procesar ninguna operacion — resultadosOperaciones debe quedar vacio`)
    assert.equal(motor.getProyecto().revision, revisionAntes, `${nombrePuerta}: el canonico no debe cambiar`)
    assert.equal(almacen.llamadasGuardar.length, 0, `${nombrePuerta}: nunca debe llamarse a almacen.guardar`)
  }

  // Puerta 1: motor.aplicar (ejecutarLote([operacion], true)).
  {
    const { motor, almacen } = crearMotorDePrueba()
    const revisionAntes = motor.getProyecto().revision
    let r
    assert.doesNotThrow(() => {
      r = motor.aplicar(nuevoSobreDivergente())
    }, "motor.aplicar NUNCA debe lanzar")
    verificarRechazoPorBaseRevisionInvalida(r, almacen, motor, revisionAntes, "motor.aplicar")
  }

  // Puerta 2: motor.aplicarTransaccion (ejecutarLote(operaciones, true)).
  {
    const { motor, almacen } = crearMotorDePrueba()
    const revisionAntes = motor.getProyecto().revision
    let r
    assert.doesNotThrow(() => {
      r = motor.aplicarTransaccion([nuevoSobreDivergente()])
    }, "motor.aplicarTransaccion NUNCA debe lanzar")
    verificarRechazoPorBaseRevisionInvalida(r, almacen, motor, revisionAntes, "motor.aplicarTransaccion")
  }

  // Puerta 3: motor.proponer (ejecutarLote(operaciones, false) — dry-run).
  {
    const { motor, almacen } = crearMotorDePrueba()
    const revisionAntes = motor.getProyecto().revision
    let r
    assert.doesNotThrow(() => {
      r = motor.proponer([nuevoSobreDivergente()])
    }, "motor.proponer NUNCA debe lanzar")
    verificarRechazoPorBaseRevisionInvalida(r, almacen, motor, revisionAntes, "motor.proponer")
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgo externo E3-01 (CRÍTICO, PHASE_1_EXTERNAL_FINDINGS.md):
// `motor.ts` — `operaciones[0]?.baseRevision ?? canonico.revision` trataba
// `baseRevision:null`/campo ausente/de OTRO TIPO en la PRIMERA operación de un lote NO
// VACÍO exactamente igual que "lote vacío": el `??` lo sustituía por la revisión
// ACTUAL, y el chequeo de stale write se auto-satisfacía siempre — un cliente con una
// vista vieja que mandara `baseRevision:null` (campo perdido en un serializador, o un
// cliente que "siempre gana") pasaba como si hubiera confirmado conocer la revisión
// vigente. Reproducción original: evidencia/e3/scripts/e3_null_baserevision_repro.mjs.
// ════════════════════════════════════════════════════════════════════════════════════

test("baseRevision invalido en la PRIMERA operacion rechaza con BASE_REVISION_INVALIDA — NUNCA se sustituye por la revision actual (hallazgo externo E3-01)", () => {
  const casos = [
    { nombre: "null", valor: null },
    { nombre: "string numerico", valor: "1" },
    { nombre: "NaN", valor: Number.NaN },
    { nombre: "Infinity", valor: Number.POSITIVE_INFINITY },
    { nombre: "-Infinity", valor: Number.NEGATIVE_INFINITY },
    { nombre: "negativo", valor: -1 },
    { nombre: "no entero (1.5)", valor: 1.5 },
  ]
  for (const { nombre, valor } of casos) {
    const { motor, almacen } = crearMotorDePrueba()
    // Cliente A legítimo commitea primero: revision pasa a 1 — así "usar la revision
    // actual en vez del dato inválido" (el bug original) sería DETECTABLE: si el fix
    // fallara y cayera de nuevo en `?? canonico.revision`, esto commitearía con
    // ok:true en vez de rechazar.
    const rA = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
    assert.equal(rA.ok, true)
    const revisionTrasA = motor.getProyecto().revision
    assert.equal(revisionTrasA, 1)

    const operacion = { idOperacion: "op-invalida", actor: "agente", baseRevision: valor, tipo: "AgregarComponente", payload: { tipo: "led" } }
    const r = motor.aplicarTransaccion([operacion])
    assert.equal(r.ok, false, `caso baseRevision=${nombre}: debe rechazar`)
    assert.equal(r.motivos[0].codigo, "BASE_REVISION_INVALIDA", `caso baseRevision=${nombre}: codigo esperado BASE_REVISION_INVALIDA, recibido ${r.motivos[0]?.codigo}`)
    assert.notEqual(r.motivos[0].codigo, "BASE_REVISION_DESACTUALIZADA", `caso baseRevision=${nombre}: NUNCA debe confundirse con "desactualizado" — el dato en si nunca fue valido`)
    assert.equal(motor.getProyecto().revision, revisionTrasA, `caso baseRevision=${nombre}: el canonico se queda en la revision de A, sin tocar`)
    assert.equal(almacen.llamadasGuardar.length, 1, `caso baseRevision=${nombre}: sólo el commit de A llamó a guardar — el intento invalido NUNCA persiste`)
  }
})

test("baseRevision AUSENTE (campo omitido del todo) en la primera operacion rechaza con BASE_REVISION_INVALIDA (hallazgo externo E3-01)", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const operacionSinBaseRevision = { idOperacion: "op-sin-base", actor: "agente", tipo: "AgregarComponente", payload: { tipo: "led" } }
  const r = motor.aplicarTransaccion([operacionSinBaseRevision])
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "BASE_REVISION_INVALIDA")
  assert.equal(motor.getProyecto().revision, 0, "el canonico no cambio")
  assert.equal(almacen.llamadasGuardar.length, 0, "nunca llamo a guardar")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgo externo CP-02 (checkpoint, MENOR): con `baseRevision` invalido
// (ej. `null`), el `ResultadoTransaccion` ecoaba `baseRevision: Number.NaN` —un valor
// FABRICADO, que ningún cliente pidió y que no describe nada real. El dato crudo
// recibido ya viaja en `motivos[0].datos.baseRevisionRecibida` (E3-01): el campo
// `baseRevision` del resultado es sólo un ECO de correlación, y el criterio de Phase
// 1.1 para "no hay un baseRevision real que ecoar" YA está establecido en este mismo
// archivo para el lote vacío (E3-05, más abajo): ecoar la revisión CANÓNICA vigente
// (mismo valor que `revisionActual`), nunca un valor fabricado. `ResultadoTransaccion.
// baseRevision` sigue siendo `number` (OPERATIONS.md §2, `SobreOperacion.baseRevision:
// number`) — no se amplía a `number | null` para no propagar `null` a un campo que el
// resto del contrato trata como un número real.
// ════════════════════════════════════════════════════════════════════════════════════

test("ResultadoTransaccion con baseRevision invalido ecoa la revision canonica vigente — NUNCA fabrica NaN (hallazgo externo CP-02)", () => {
  const { motor } = crearMotorDePrueba()
  motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  const revisionVigente = motor.getProyecto().revision
  assert.equal(revisionVigente, 1)

  const operacion = { idOperacion: "op-cp02", actor: "agente", baseRevision: null, tipo: "AgregarComponente", payload: { tipo: "led" } }
  const r = motor.aplicarTransaccion([operacion])
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "BASE_REVISION_INVALIDA")
  assert.ok(!Number.isNaN(r.baseRevision), `baseRevision del resultado NUNCA debe ser NaN: recibido ${r.baseRevision}`)
  assert.equal(r.baseRevision, revisionVigente, "el eco debe ser la revision CANONICA vigente, no un valor fabricado")
  assert.equal(r.revisionActual, revisionVigente, "revisionActual y el eco de baseRevision coinciden, igual que en el no-op de lote vacio (E3-05)")
})

// No-regresión explícita (E3-01): `baseRevision:0` es la revisión inicial REAL, nunca
// "falsy"/"ausente" — tiene que seguir commiteando igual que antes del fix.
test("baseRevision-cero-es-valido-commitea-igual-que-antes-del-fix (no regresion, E3-01)", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const r = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  assert.equal(r.ok, true, "baseRevision:0 sobre una revision inicial real=0 tiene que commitear")
  assert.equal(motor.getProyecto().revision, 1)
  assert.equal(almacen.llamadasGuardar.length, 1)
})

// No-regresión explícita (E3-01): revision N -> op(base N) commit -> N+1; una SEGUNDA
// op con base N (ahora stale de verdad, valor VÁLIDO pero desactualizado) sigue
// rechazando BASE_REVISION_DESACTUALIZADA (nunca BASE_REVISION_INVALIDA) — el
// canónico se queda en N+1, nunca last-write-wins.
test("segunda-operacion-con-baseRevision-valido-pero-stale-sigue-siendo-BASE_REVISION_DESACTUALIZADA (no regresion, E3-01)", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const rA = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  assert.equal(rA.ok, true)
  assert.equal(motor.getProyecto().revision, 1)
  const rB = motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "led" }, 0)) // baseRevision VALIDO (entero >= 0), pero stale
  assert.equal(rB.ok, false)
  assert.equal(rB.motivos[0].codigo, "BASE_REVISION_DESACTUALIZADA")
  assert.equal(motor.getProyecto().revision, 1, "el canonico se queda en N+1 — nunca last-write-wins")
  assert.equal(almacen.llamadasGuardar.length, 1, "sólo el commit de A persistio")
})

// Contrato (OPERATIONS.md §2/§9): en un lote con VARIAS operaciones, sólo la
// baseRevision de la PRIMERA se contrasta contra el canónico — las siguientes viajan
// en el sobre pero el motor nunca las compara (E3-01, "verificá cómo se trata
// baseRevision de las operaciones 2..n").
test("lote-con-varias-operaciones-solo-la-baseRevision-de-la-PRIMERA-se-valida-y-se-contrasta (contrato OPERATIONS.md §2/§9, E3-01)", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const r = motor.aplicarTransaccion([
    nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0), // primera: coincide con el canonico real (0)
    { idOperacion: "op-segunda", actor: "agente", baseRevision: 999, tipo: "AgregarComponente", payload: { tipo: "led" } }, // segunda: baseRevision disparatado — NUNCA se compara
  ])
  assert.equal(r.ok, true, "sólo la baseRevision de la PRIMERA operación del lote se contrasta contra el canónico; la de la segunda viaja pero nunca se chequea")
  assert.equal(motor.getProyecto().revision, 1)
  assert.equal(almacen.llamadasGuardar.length, 1)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgo externo E3-05 (MENOR, misma raíz que E3-01): un lote vacío
// commiteaba igual (`ok:true`, revisión sube, persiste una copia idéntica). Decisión
// Phase 1.1 (el contrato no lo determina, ambas opciones son defendibles): no-op
// explícito que NUNCA compromete nada — ni revisión, ni persistencia, ni buffer de
// undo. Reproducción original: evidencia/e3/scripts/e3_null_baserevision_repro.mjs.
// ════════════════════════════════════════════════════════════════════════════════════

test("aplicarTransaccion-con-lote-vacio-es-un-no-op-explicito-nunca-sube-revision-ni-persiste (hallazgo externo E3-05)", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const antes = motor.getProyecto()
  const r = motor.aplicarTransaccion([])
  assert.equal(r.ok, true, "lote vacio es un no-op EXITOSO (decision Phase 1.1), no un rechazo")
  assert.equal(r.motivos.length, 0)
  assert.equal(motor.getProyecto(), antes, "el canonico es la MISMA referencia: nada cambio")
  assert.equal(motor.getProyecto().revision, 0, "la revision NUNCA sube por un lote vacio")
  assert.equal(almacen.llamadasGuardar.length, 0, "un lote vacio NUNCA llama a guardar")
  assert.equal(motor.obtenerBufferUndo().length, 0, "un lote vacio NUNCA se agrega al buffer de undo")
})

test("proponer-con-lote-vacio-tambien-es-no-op (hallazgo externo E3-05)", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const r = motor.proponer([])
  assert.equal(r.ok, true)
  assert.equal(r.motivos.length, 0)
  assert.equal(motor.getProyecto().revision, 0)
  assert.equal(almacen.llamadasGuardar.length, 0)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgo externo E3-07 (MAJOR, evidencia/e3/scripts/e1_motor_flujo.mjs
// TEST 4, resolución humana de Phase 1.1 brief §21): dos motores con el MISMO almacén
// y MISMO id de proyecto partían de revisión 0 cada uno (ninguno vio el commit del
// otro) y el segundo commit pisaba SILENCIOSAMENTE al primero en disco. `guardar()`
// (`almacen.ts`, Gate 7) ahora detecta esa colisión con un compare-and-swap sobre la
// revisión — estos tests integran el `Almacen` REAL (no el falso en memoria de más
// arriba) con motores REALES, porque el fix vive dentro de `crearAlmacen()`.
// ════════════════════════════════════════════════════════════════════════════════════

function crearFsFalsoParaAlmacenReal(inicial = {}) {
  const archivos = new Map(Object.entries(inicial))
  return {
    _archivos: archivos,
    existsSync: (p) => archivos.has(p),
    mkdirSync: () => {},
    writeFileSync: (p, data) => archivos.set(p, data),
    renameSync: (from, to) => {
      const contenido = archivos.get(from)
      archivos.delete(from)
      archivos.set(to, contenido)
    },
    unlinkSync: (p) => archivos.delete(p),
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

test("dos-motores-mismo-almacen-real-y-mismo-id-el-segundo-commit-recibe-conflicto-en-vez-de-pisar-al-primero (hallazgo externo E3-07)", () => {
  const fs = crearFsFalsoParaAlmacenReal()
  const almacenReal = crearAlmacen({ directorio: "/proyectos", fs, catalogo })

  const proyectoA = crearProyecto({ generadorId: () => "MISMO-ID", ahora: () => "t", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const motorA = crearMotorDeProyecto({ proyectoInicial: proyectoA, catalogo, almacen: almacenReal })
  const rA = motorA.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  assert.equal(rA.ok, true, "el primer commit de A funciona normalmente")
  assert.equal(motorA.getProyecto().revision, 1)

  // motor B parte del MISMO id, pero de SU PROPIA revision 0 en memoria — nunca vio
  // el commit de A (mismo escenario que TEST 4 de la auditoria externa).
  const proyectoB = crearProyecto({ generadorId: () => "MISMO-ID", ahora: () => "t2", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const motorB = crearMotorDeProyecto({ proyectoInicial: proyectoB, catalogo, almacen: almacenReal })
  const antesDeB = motorB.getProyecto()
  const rB = motorB.aplicar(nuevaOperacion("AgregarComponente", { tipo: "led" }, 0))

  assert.equal(rB.ok, false, "el segundo commit debe rechazar — NUNCA pisar en silencio al de A")
  assert.ok(rB.motivos.some((m) => m.codigo === "CONFLICTO_REVISION_EN_ALMACEN" && m.clasificacion === "rechazo"), `motivo esperado CONFLICTO_REVISION_EN_ALMACEN: ${JSON.stringify(rB.motivos)}`)
  // Path de persistence failure ya existente (mismo que "orden-persistir-swap-fallo-
  // de-guardar-preserva-estado-previo"): canonico, revision, y buffer de undo de B
  // quedan INTACTOS — el fallo de guardar nunca llega a tocar la memoria de B.
  assert.equal(motorB.getProyecto(), antesDeB, "el canonico de B es la MISMA referencia: nada cambio")
  assert.equal(motorB.getProyecto().revision, 0, "la revision de B NUNCA sube")
  assert.equal(motorB.obtenerBufferUndo().length, 0, "B nunca agrega esta transaccion rechazada al buffer de undo")

  // El disco conserva el commit de A, intacto — el de B NUNCA llego a pisarlo.
  const rCargar = almacenReal.cargar("MISMO-ID")
  assert.equal(rCargar.ok, true)
  assert.equal(rCargar.proyecto.placa, "esp32-devkit-v1", "disco conserva el commit de A")
  assert.equal(rCargar.proyecto.componentes.length, 0, "el commit de B nunca se persistio")
})

test("flujo-normal-un-motor-recarga-desde-disco-y-sigue-commiteando-sin-regresion (hallazgo externo E3-07)", () => {
  const fs = crearFsFalsoParaAlmacenReal()
  const almacenReal = crearAlmacen({ directorio: "/proyectos", fs, catalogo })

  const proyectoInicial = crearProyecto({ generadorId: () => "proy-normal-e307", ahora: () => "t", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const motor1 = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: almacenReal })
  assert.equal(motor1.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0)).ok, true)
  assert.equal(motor1.aplicar(nuevaOperacion("AgregarComponente", { tipo: "led" }, 1)).ok, true)
  assert.equal(motor1.getProyecto().revision, 2)

  // Un motor NUEVO recarga el mismo proyecto desde disco (misma secuencia que un
  // reinicio de sesion real) y sigue commiteando — no debe haber ningun conflicto
  // fantasma: el compare-and-swap de E3-07 tiene que reconocer un flujo NORMAL.
  const rCarga = almacenReal.cargar("proy-normal-e307")
  assert.equal(rCarga.ok, true)
  const motor2 = crearMotorDeProyecto({ proyectoInicial: rCarga.proyecto, catalogo, almacen: almacenReal })
  const rSiguiente = motor2.aplicar(nuevaOperacion("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO23" }, 2))
  assert.equal(rSiguiente.ok, true, "recargar desde disco y seguir commiteando NO debe regresionar por el fix de E3-07")
  assert.equal(motor2.getProyecto().revision, 3)
})

test("primer-guardado-de-un-proyecto-nuevo-funciona-con-el-almacen-real (control, hallazgo externo E3-07)", () => {
  const fs = crearFsFalsoParaAlmacenReal()
  const almacenReal = crearAlmacen({ directorio: "/proyectos", fs, catalogo })
  const proyectoInicial = crearProyecto({ generadorId: () => "proy-primer-guardado-e307", ahora: () => "t", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: almacenReal })
  const r = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0))
  assert.equal(r.ok, true, "el primer guardado de un proyecto nuevo (sin archivo previo) sigue funcionando")
})

test("dry-run-nunca-toca-el-disco-ni-siquiera-para-el-chequeo-de-conflicto-de-E3-07", () => {
  const fs = crearFsFalsoParaAlmacenReal()
  let llamadasExists = 0
  let llamadasWrite = 0
  const fsEspiado = {
    ...fs,
    existsSync: (p) => (llamadasExists++, fs.existsSync(p)),
    writeFileSync: (p, d) => (llamadasWrite++, fs.writeFileSync(p, d)),
  }
  const almacenReal = crearAlmacen({ directorio: "/proyectos", fs: fsEspiado, catalogo })
  llamadasExists = 0 // descarta la llamada de mkdirSync-adyacente al construir el almacen, si la hubiera
  const proyectoInicial = crearProyecto({ generadorId: () => "proy-dryrun-e307", ahora: () => "t", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: almacenReal })

  const r = motor.proponer([nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0)])
  assert.equal(r.ok, true)
  assert.equal(llamadasWrite, 0, "un dry-run NUNCA debe escribir en disco")
  assert.equal(llamadasExists, 0, "un dry-run NUNCA debe siquiera consultar el disco para el chequeo de conflicto de E3-07 (proponer no llega a llamar guardar())")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (hallazgo externo RX-01, CRÍTICO — revisión adversarial independiente,
// reabre CP-01): `crearMotorDeProyecto` corría `validarFormaProyecto` para DECIDIR si
// rechazar, pero cuando el resultado era `ok:true` usaba el objeto CRUDO
// (`deps.proyectoInicial`) — no la copia YA SANEADA que la misma función devuelve
// (`resultadoForma.proyecto`) — tanto para `validarProyecto`/`validarIdsYContador` como
// para construir el `canonico` (`clonarProfundo`). Una propiedad NO declarada en un
// `Componente`/`Conexion`/`ComportamientoRegla` anidado (a) sobrevivía intacta al
// canónico en memoria/persistido, aunque el LOADER (`cargarProyecto`) la descartara al
// recargar el MISMO documento — memoria != disco entre puertas — y (b) si esa
// propiedad era un getter que lanza, hacía tronar `clonarProfundo` con un `Error`
// crudo, en vez de `ErrorEstadoInicialInvalido` (falsificando el mismo contrato que
// CP-01 ya había cerrado: "el motor corre su PROPIA validación... nunca una excepción
// cruda"). Cerrado extendiendo `validarFormaProyecto`/`validarComponente`/
// `validarConexion`/`validarComportamiento` (`cargador.ts`) para rechazar TAMBIÉN
// claves anidadas desconocidas (§6 de IR-SPEC.md no decía nada sobre el caso anidado —
// se aplica el mismo criterio fail-closed que ya rige a nivel raíz) y haciendo que el
// motor construya SIEMPRE desde `resultadoForma.proyecto` (la copia validada), nunca
// desde el objeto crudo del llamador — igual que ya hace `cargarProyecto()`.
// ════════════════════════════════════════════════════════════════════════════════════

test("constructor-rechaza-proyectoInicial-con-clave-anidada-desconocida-en-componente (hallazgo externo RX-01, parte a)", () => {
  const base = crearProyecto({ generadorId: () => "proy-rx01-a", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const roto = {
    ...base,
    componentes: [{ id: "cmp-0", tipo: "led", pines: { anodo: null }, propiedades: {}, campoSorpresa: "dato no declarado" }],
    siguienteIdLocal: 1,
  }
  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial: roto, catalogo, almacen: crearAlmacenFalso() }),
    (err) => {
      assert.ok(err instanceof Error && err.name === "ErrorEstadoInicialInvalido", `debe lanzar ErrorEstadoInicialInvalido: ${err}`)
      assert.ok(err.motivos?.some((m) => m.codigo === "CLAVE_DESCONOCIDA" && m.clasificacion === "rechazo"), `el error debe traer CLAVE_DESCONOCIDA: ${JSON.stringify(err.motivos)}`)
      return true
    },
    "un proyectoInicial con un campo anidado NO declarado NUNCA debe construir un motor operable que lo persista en silencio",
  )
})

test("constructor-nunca-usa-el-objeto-crudo-para-el-canonico-un-campo-plano-extra-no-sobrevive (hallazgo externo RX-01, parte a, control)", () => {
  // Control: un proyectoInicial con FORMA válida (sin campos anidados extra) sigue
  // construyendo igual que antes — el fix no cambia el caso sano.
  const proyectoInicial = crearProyecto({ generadorId: () => "proy-rx01-control", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: crearAlmacenFalso() })
  assert.equal(motor.getProyecto().id, "proy-rx01-control")
})

test("constructor-convierte-cualquier-excepcion-al-leer-proyectoInicial-en-ErrorEstadoInicialInvalido-nunca-un-Error-crudo (hallazgo externo RX-01, parte b)", () => {
  const base = crearProyecto({ generadorId: () => "proy-rx01-b", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const componente = { id: "cmp-0", tipo: "led", pines: { anodo: null }, propiedades: {} }
  Object.defineProperty(componente, "campoTrampa", {
    enumerable: true,
    get() {
      throw new Error("getter boom en campo no declarado de Componente")
    },
  })
  const roto = { ...base, componentes: [componente], siguienteIdLocal: 1 }
  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial: roto, catalogo, almacen: crearAlmacenFalso() }),
    (err) => {
      assert.ok(err instanceof Error && err.name === "ErrorEstadoInicialInvalido", `debe lanzar ErrorEstadoInicialInvalido, NUNCA un Error crudo: ${err?.stack ?? err}`)
      assert.ok(Array.isArray(err.motivos) && err.motivos.length > 0 && err.motivos.every((m) => m.clasificacion === "rechazo"), `el error debe traer motivos estructurados: ${JSON.stringify(err.motivos)}`)
      return true
    },
    "un getter que explota leyendo un campo anidado (declarado o no) del proyectoInicial NUNCA debe propagar un Error crudo",
  )
})

test("equivalencia-cargarProyecto-vs-proyectoInicial: el mismo documento da el MISMO Proyecto por las dos puertas (hallazgo externo RX-01)", () => {
  // Componentes/conexiones/comportamientos a propósito FUERA de orden ascendente de
  // id local — `cargarProyecto()` los reordena (compararIdsLocales, IR-SPEC.md §3);
  // si `crearMotorDeProyecto({ proyectoInicial })` construyera desde el objeto CRUDO
  // en vez de la copia YA SANEADA (y por lo tanto YA ORDENADA) que devuelve
  // `validarFormaProyecto`, el orden de array divergiría entre las dos puertas —
  // observable en `canonicalizar()` (IR-SPEC.md §3: preserva orden de array).
  const documento = {
    id: "proy-rx01-equiv",
    schemaVersion: "1.0.0",
    catalogoVersion: catalogo.version,
    catalogoHash: catalogo.hash,
    revision: 0,
    siguienteIdLocal: 3,
    placa: "esp32-devkit-v1",
    componentes: [
      { id: "cmp-2", tipo: "resistencia", pines: {}, propiedades: {} },
      { id: "cmp-0", tipo: "led", pines: { anodo: "GPIO23" }, propiedades: {} },
      { id: "cmp-1", tipo: "dht22", pines: { senal: "GPIO16" }, propiedades: {} },
    ],
    conexiones: [],
    comportamientos: [],
    metadata: { creadoEn: "2026-01-01T00:00:00.000Z" },
  }

  const viaLoader = cargarProyecto(structuredClone(documento))
  assert.equal(viaLoader.ok, true)

  const motor = crearMotorDeProyecto({ proyectoInicial: structuredClone(documento), catalogo, almacen: crearAlmacenFalso() })
  const viaProyectoInicial = motor.getProyecto()

  assert.equal(canonicalizar(viaLoader.proyecto), canonicalizar(viaProyectoInicial), "cargarProyecto(JSON) y crearMotorDeProyecto({proyectoInicial}) deben producir el MISMO Proyecto canonico para el mismo documento")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (RX2, mutación ronda 2 — M2/MUTATION_RESULTS_R2.md, hallazgo R06):
// el `try/catch` EXTERIOR de `crearMotorDeProyecto` (RX-01 parte b) sólo se había
// probado con un getter en un campo NO DECLARADO de un `Componente` anidado —
// `CLAVE_DESCONOCIDA` lo interceptaba ANTES de necesitar ese catch para nada. Si se
// quitaba el catch, ningún test lo notaba. Este test ataca un campo RAÍZ DECLARADO
// de `Proyecto` (`componentes`) directamente en `proyectoInicial` — el gap real que
// R06 encontró. Con la materialización de datos planos (RX2), este caso se cierra
// por construcción DENTRO de `validarFormaProyecto` (nunca necesita el catch
// exterior, que esta ronda eliminó por quedar muerto — ver `motor.ts`): el mutante
// "desactivar la materialización de `proyectoInicial`" tiene que matar ESTE test.
// ════════════════════════════════════════════════════════════════════════════════════

test("constructor-rechaza-proyectoInicial-con-accessor-en-un-campo-RAIZ-DECLARADO (hallazgo R06, mutacion ronda 2)", () => {
  const base = crearProyecto({ generadorId: () => "proy-r06", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const roto = { ...base }
  Object.defineProperty(roto, "componentes", {
    enumerable: true,
    get() {
      throw new Error("getter boom en campo raiz declarado (componentes) de proyectoInicial")
    },
  })
  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial: roto, catalogo, almacen: crearAlmacenFalso() }),
    (err) => {
      assert.ok(err instanceof Error && err.name === "ErrorEstadoInicialInvalido", `debe lanzar ErrorEstadoInicialInvalido, NUNCA un Error crudo: ${err?.stack ?? err}`)
      assert.ok(Array.isArray(err.motivos) && err.motivos.length > 0 && err.motivos.every((m) => m.clasificacion === "rechazo"), `el error debe traer motivos estructurados: ${JSON.stringify(err.motivos)}`)
      return true
    },
    "un accessor en un campo RAIZ DECLARADO de proyectoInicial (no anidado, no desconocido) NUNCA debe propagar un Error crudo",
  )
})

test("constructor-rechaza-proyectoInicial-con-accessor-en-revision-o-placa (hallazgo R06, variantes adicionales de campo raiz)", () => {
  for (const campo of ["revision", "placa"]) {
    const base = crearProyecto({ generadorId: () => `proy-r06-${campo}`, ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
    const roto = { ...base }
    Object.defineProperty(roto, campo, {
      enumerable: true,
      get() {
        throw new Error(`getter boom en campo raiz declarado (${campo})`)
      },
    })
    assert.throws(
      () => crearMotorDeProyecto({ proyectoInicial: roto, catalogo, almacen: crearAlmacenFalso() }),
      (err) => {
        assert.ok(err instanceof Error && err.name === "ErrorEstadoInicialInvalido", `campo "${campo}": debe lanzar ErrorEstadoInicialInvalido, NUNCA un Error crudo: ${err?.stack ?? err}`)
        assert.ok(Array.isArray(err.motivos) && err.motivos.length > 0 && err.motivos.every((m) => m.clasificacion === "rechazo"), `campo "${campo}": motivos estructurados: ${JSON.stringify(err.motivos)}`)
        return true
      },
      `campo "${campo}": un accessor en un campo raiz declarado NUNCA debe propagar un Error crudo`,
    )
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (RX2, hallazgo externo RX2-02, CRÍTICO — revisión adversarial
// independiente #2): `payload.propiedades` (la bolsa abierta de
// `AgregarComponente`, NUNCA validada en forma) se incrustaba SIN copiar en el
// borrador — `congelarProfundo` (canonico.ts, en el commit/dry-run de
// `ejecutarLote`) recorre `Object.values()` de cualquier objeto anidado, lo que SÍ
// dispara el trap `get` de un Proxy. Un Proxy que miente/lanza en los traps que la
// materialización invoca (`ownKeys`/`getOwnPropertyDescriptor`) crasheaba
// `motor.proponer`/`aplicar`/`aplicarTransaccion` — una superficie que ningún fix
// anterior (RX-01/RX-02) tocaba. Cerrado por construcción: `aplicarOperacion`
// (`operaciones.ts`) materializa el SOBRE completo (incluido `payload.propiedades`)
// ANTES de construir el `Componente` — `congelarProfundo` en `motor.ts` ya nunca ve
// un objeto vivo.
// ════════════════════════════════════════════════════════════════════════════════════

test("motor.proponer/aplicar/aplicarTransaccion NUNCA crashean con un Proxy que lanza en propiedades de AgregarComponente (hallazgo externo RX2-02)", () => {
  function payloadConPropiedadesProxyMaligno() {
    return {
      tipo: "led",
      propiedades: new Proxy(
        { color: "rojo" },
        {
          ownKeys() {
            throw new Error("proxy-ownKeys-boom en propiedades")
          },
        },
      ),
    }
  }

  // Caso A: dry-run.
  {
    const { motor } = (() => {
      const proyectoInicial = crearProyecto({ generadorId: () => "proy-rx2-02-a", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
      return { motor: crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: crearAlmacenFalso() }) }
    })()
    let r
    assert.doesNotThrow(() => {
      r = motor.proponer([nuevaOperacion("AgregarComponente", payloadConPropiedadesProxyMaligno(), 0)])
    }, "motor.proponer NUNCA debe crashear con un Proxy malicioso en propiedades")
    assert.equal(r.ok, false)
    assert.equal(r.motivos[0].codigo, "ENTRADA_NO_ES_DATO_PLANO")
  }

  // Caso B: commit real — el canonico/almacen no deben tocarse.
  {
    const proyectoInicial = crearProyecto({ generadorId: () => "proy-rx2-02-b", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
    const almacen = crearAlmacenFalso()
    const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen })
    let r
    assert.doesNotThrow(() => {
      r = motor.aplicar(nuevaOperacion("AgregarComponente", payloadConPropiedadesProxyMaligno(), 0))
    }, "motor.aplicar NUNCA debe crashear con un Proxy malicioso en propiedades")
    assert.equal(r.ok, false)
    assert.equal(almacen.llamadasGuardar.length, 0, "un intento rechazado nunca persiste")
    assert.equal(motor.getProyecto().componentes.length, 0, "el canonico no cambio")
  }

  // Caso C: lote de 2 — una operacion inocua ANTES, la maliciosa despues; el lote
  // entero rechaza, la inocua tampoco queda aplicada.
  {
    const proyectoInicial = crearProyecto({ generadorId: () => "proy-rx2-02-c", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
    const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: crearAlmacenFalso() })
    let r
    assert.doesNotThrow(() => {
      r = motor.aplicarTransaccion([nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0), nuevaOperacion("AgregarComponente", payloadConPropiedadesProxyMaligno(), 0)])
    }, "motor.aplicarTransaccion NUNCA debe crashear")
    assert.equal(r.ok, false)
    assert.equal(motor.getProyecto().placa, null, "el lote entero rechaza — ni siquiera la operacion inocua anterior queda aplicada")
  }
})

// No-regresión: `propiedades` sigue siendo una bolsa abierta de forma libre — un
// objeto PLANO común (no un Proxy/getter) con cualquier forma sigue aceptándose y
// commiteando sin problema, y queda AISLADO del objeto original que el llamador
// retiene (nunca comparte referencia con el borrador congelado).
test("AgregarComponente con propiedades como objeto plano comun sigue commiteando y queda aislado del original (no regresion, RX2-02)", () => {
  const proyectoInicial = crearProyecto({ generadorId: () => "proy-rx2-02-control", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: crearAlmacenFalso() })
  const propiedadesOriginales = { color: "rojo", brillo: 3 }
  const r = motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "led", propiedades: propiedadesOriginales }, 0))
  assert.equal(r.ok, true)
  assert.deepEqual(motor.getProyecto().componentes[0].propiedades, { color: "rojo", brillo: 3 })
  propiedadesOriginales.color = "azul"
  assert.equal(motor.getProyecto().componentes[0].propiedades.color, "rojo", "el canonico nunca comparte referencia con el objeto que el llamador retuvo")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (RX3, hallazgo externo RX3-01, CRÍTICO — revisión adversarial independiente
// #3, RX3_REPORT.md): "__proto__" como clave literal (alcanzable con JSON PURO, vía
// JSON.parse — nunca un literal de objeto JS) reabría, en forma PEOR, la clase que RX2
// cerró: la copia de `materializarDatosPlanos` se construía con asignación por
// corchetes sobre un objeto `{}`, que dispara el setter heredado
// `Object.prototype.__proto__` y corrompe el PROTOTIPO de la copia en vez de crear una
// propiedad propia — bypaseando `CLAVE_DESCONOCIDA` en la raíz.
//
// FIX DE RAÍZ (ver DECISIONS.md/causa.md): el contenedor se construye con
// `Object.defineProperty`, nunca asignación por corchetes — con eso, NINGÚN nombre de
// clave (ni "__proto__"/"constructor"/"prototype") tiene efecto especial. Una entidad
// de forma CERRADA (raíz del `Proyecto`, el SOBRE de una operación — ambos con su
// propio chequeo de claves conocidas) rechaza esas claves con `CLAVE_DESCONOCIDA`,
// igual que cualquier otra clave no declarada. Una bolsa ABIERTA (`propiedades` de
// `AgregarComponente`) las ACEPTA como dato ordinario, preservado exacto. Confirmado
// consistente entre `crearMotorDeProyecto({proyectoInicial})` (Gate 6) y
// `cargarProyecto()` (Gate 2) — ambas comparten `validarFormaProyecto`.
// ════════════════════════════════════════════════════════════════════════════════════

test("constructor-rechaza-proyectoInicial-con-clave-'__proto__'-en-la-raiz-con-CLAVE_DESCONOCIDA — MISMO veredicto que cargarProyecto del mismo texto (hallazgo externo RX3-01)", () => {
  const jsonTexto = JSON.stringify({
    id: "proy-rx3-01",
    schemaVersion: "1.0.0",
    catalogoVersion: catalogo.version,
    catalogoHash: catalogo.hash,
    revision: 0,
    siguienteIdLocal: 0,
    placa: null,
    componentes: [],
    conexiones: [],
    comportamientos: [],
    metadata: { creadoEn: "2026-01-01T00:00:00.000Z" },
  }).replace('"placa":null', '"placa":null,"__proto__":{"pwned":true}')

  const proyectoInicial = JSON.parse(jsonTexto)
  assert.ok(Object.prototype.hasOwnProperty.call(proyectoInicial, "__proto__"), "control: JSON.parse produce '__proto__' como OWN key")

  assert.throws(
    () => {
      crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: crearAlmacenFalso() })
    },
    (err) => {
      assert.ok(err instanceof Error && err.name === "ErrorEstadoInicialInvalido", `debe lanzar ErrorEstadoInicialInvalido, NUNCA construirse: ${err?.stack ?? err}`)
      assert.ok(err.motivos.some((m) => m.codigo === "CLAVE_DESCONOCIDA"), `motivos: ${JSON.stringify(err.motivos)}`)
      return true
    },
    "un proyectoInicial con '__proto__' en la raiz NUNCA debe construir un motor operable",
  )

  const rCarga = cargarProyecto(jsonTexto)
  assert.equal(rCarga.ok, false, "misma puerta compartida (validarFormaProyecto) -> mismo veredicto que cargarProyecto, nunca uno acepta y el otro rechaza")
  assert.equal(rCarga.motivos[0].codigo, "CLAVE_DESCONOCIDA")
})

test("motor.proponer/aplicar/aplicarTransaccion rechazan '__proto__'/'constructor'/'prototype' en el SOBRE de la operacion con CLAVE_DESCONOCIDA — mismo mecanismo que cualquier clave no declarada, mismo veredicto en las 3 puertas (hallazgo externo RX3-01)", () => {
  function sobreConClaveEnEnvoltorio(clave, baseRevision) {
    const jsonTexto = JSON.stringify({ idOperacion: "op-x", actor: "agente", baseRevision, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }).replace(
      '"actor":"agente"',
      `"actor":"agente",${JSON.stringify(clave)}:{"pwned":true}`,
    )
    return JSON.parse(jsonTexto)
  }

  for (const clave of ["__proto__", "constructor", "prototype"]) {
    {
      const { motor } = crearMotorDePrueba()
      const r = motor.proponer([sobreConClaveEnEnvoltorio(clave, 0)])
      assert.equal(r.ok, false, `clave "${clave}": se esperaba rechazo`)
      assert.equal(r.motivos[0].codigo, "CLAVE_DESCONOCIDA", `clave "${clave}": codigo real ${r.motivos[0].codigo}`)
    }
    {
      const { motor, almacen } = crearMotorDePrueba()
      const r = motor.aplicar(sobreConClaveEnEnvoltorio(clave, 0))
      assert.equal(r.ok, false, `clave "${clave}": se esperaba rechazo`)
      assert.equal(almacen.llamadasGuardar.length, 0)
    }
    {
      const { motor } = crearMotorDePrueba()
      const r = motor.aplicarTransaccion([sobreConClaveEnEnvoltorio(clave, 0)])
      assert.equal(r.ok, false, `clave "${clave}": se esperaba rechazo`)
      assert.equal(r.motivos[0].codigo, "CLAVE_DESCONOCIDA")
    }
  }
})

test("motor.proponer/aplicar/aplicarTransaccion ACEPTAN '__proto__'/'constructor'/'prototype' en propiedades de AgregarComponente (bolsa abierta) como dato ORDINARIO — MISMO veredicto en las 3 puertas, nunca pierde el dato en silencio ni corrompe el prototipo (hallazgo externo RX3-01, fix de raiz)", () => {
  function payloadConClaveEnPropiedades(clave) {
    return JSON.parse(`{"tipo":"led","propiedades":{"color":"rojo",${JSON.stringify(clave)}:{"pwned":true,"secreto":"dato-normal"}}}`)
  }

  for (const clave of ["__proto__", "constructor", "prototype"]) {
    {
      const { motor } = crearMotorDePrueba()
      const r = motor.proponer([nuevaOperacion("AgregarComponente", payloadConClaveEnPropiedades(clave), 0)])
      assert.equal(r.ok, true, `clave "${clave}": se esperaba aceptacion: ${r.ok ? "" : JSON.stringify(r.motivos)}`)
    }
    {
      const { motor, almacen } = crearMotorDePrueba()
      const r = motor.aplicar(nuevaOperacion("AgregarComponente", payloadConClaveEnPropiedades(clave), 0))
      assert.equal(r.ok, true, `clave "${clave}": se esperaba aceptacion: ${r.ok ? "" : JSON.stringify(r.motivos)}`)
      assert.equal(almacen.llamadasGuardar.length, 1, "un intento aceptado SI persiste")
      const propiedades = motor.getProyecto().componentes[0].propiedades
      assert.equal(Object.getPrototypeOf(propiedades), Object.prototype, `clave "${clave}": el prototipo de propiedades nunca cambia`)
      assert.deepEqual(propiedades[clave], { pwned: true, secreto: "dato-normal" }, `clave "${clave}": el dato debe preservarse EXACTO, nunca perderse en silencio`)
    }
    {
      const { motor } = crearMotorDePrueba()
      const r = motor.aplicarTransaccion([nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 0), nuevaOperacion("AgregarComponente", payloadConClaveEnPropiedades(clave), 0)])
      assert.equal(r.ok, true, `clave "${clave}": se esperaba aceptacion del lote completo`)
      assert.equal(motor.getProyecto().placa, "esp32-devkit-v1", "el lote completo se aplica, incluida la operacion anterior")
    }
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (RX3, hallazgo externo RX3-02, MAJOR — revisión adversarial independiente
// #3): en la rama `else` de `crearMotorDeProyecto` (cuando `validarFormaProyecto`
// rechaza), el código corría IGUAL `validarProyecto`/`validarIdsYContador` sobre
// `deps.proyectoInicial` CRUDO — invocando un getter/Proxy que la materialización YA
// había detectado y rechazado, hasta 3 VECES (`validarEstructural`, `validarTecnico`,
// `validarIdsYContador`). El resultado final seguía siendo correcto (el motivo de
// forma ya alcanza para rechazar), pero el getter SÍ se ejecutaba — reintroduciendo
// exactamente el patrón de superficie que `datos-planos.ts` existe para eliminar. Fix:
// después de intentar la materialización, NUNCA se vuelve a tocar el objeto CRUDO. Si
// la materialización falla, sólo se devuelven sus motivos (0 invocaciones adicionales).
// Si tuvo éxito pero la FORMA es inválida, los chequeos adicionales de Gate 4 corren
// sobre la COPIA YA MATERIALIZADA (nunca el crudo).
// ════════════════════════════════════════════════════════════════════════════════════

test("constructor NUNCA vuelve a invocar un getter del proyectoInicial una vez que la materializacion ya lo rechazo — 0 invocaciones, no 3 (hallazgo externo RX3-02)", () => {
  let lecturas = 0
  const proyectoInicialMalicioso = {
    id: "proy-rx3-02",
    schemaVersion: "1.0.0",
    catalogoVersion: catalogo.version,
    catalogoHash: catalogo.hash,
    revision: 0,
    siguienteIdLocal: 0,
    placa: null,
    get componentes() {
      lecturas++
      return lecturas === 1 ? [] : [{ id: "cmp-inyectado", tipo: "led", pines: {}, propiedades: {} }]
    },
    conexiones: [],
    comportamientos: [],
    metadata: { creadoEn: "2026-01-01T00:00:00.000Z" },
  }

  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial: proyectoInicialMalicioso, catalogo, almacen: crearAlmacenFalso() }),
    (err) => {
      assert.ok(err instanceof Error && err.name === "ErrorEstadoInicialInvalido", `debe lanzar ErrorEstadoInicialInvalido: ${err?.stack ?? err}`)
      return true
    },
  )
  assert.equal(lecturas, 0, "un getter en un proyectoInicial que ya rechaza por forma NUNCA debe invocarse — ni una sola vez, y mucho menos 3")
})

// Phase 1.1 (hallazgo externo RX-03, MAYOR — revisión adversarial independiente):
// `validarIdsYContador` (id.ts, hallazgos E1-01/E1-02) corre en el Loader y en la
// construcción del motor (`proyectoInicial`) — pero NUNCA dentro del pipeline continuo
// de commit (`ejecutarLote`). Hoy esto no es explotable vía las 8 operaciones públicas
// (los 3 aplicadores que generan un id local sólo INCREMENTAN el contador, nunca lo
// decrementan — M22), pero es un hueco de PROFUNDIDAD DE DEFENSA: un aplicador futuro
// (Fase 2+) que rompiera esa disciplina dejaría ids duplicados/contador inconsistente
// sin ningún diagnóstico hasta la próxima reconstrucción completa del motor. Mismo
// patrón de causa raíz que E1-01/E1-02, pero corregido con MENOS rigor que su hallazgo
// gemelo E2-01 (que sí se agregó a `validar-estructural.ts`/`validarProyecto`, así que
// corre en TODA puerta incluido el pipeline continuo).
//
// Test: se fuerza el caso con el mecanismo de test YA EXISTENTE (`clonar` inyectable
// en `DependenciasMotor`, pensado para simular exactamente este tipo de escenario sin
// tocar producción) — un `clonar` que, al clonar un `Proyecto`, deja `siguienteIdLocal`
// desincronizado (simula un aplicador futuro que rompe la disciplina "sólo
// incrementa"). Deliberadamente NO se agrega este chequeo a `validarProyecto`/
// `validar-estructural.ts` (IR-SPEC.md §6.1: ahí rompería fixtures manuales de
// `nucleo-validacion.test.mjs` que usan ids no numerados/fuera de secuencia a
// propósito) — sólo al camino de commit exclusivo del motor (`ejecutarLote`).
// ════════════════════════════════════════════════════════════════════════════════════

test("defensa-en-profundidad-post-lote: contador de ids inconsistente en el commit se rechaza (hallazgo externo RX-03)", () => {
  // `clonar` inyectado: clona de verdad (aisla referencias, pasa el centinela de
  // construcción) pero, para un valor con forma de `Proyecto`, fuerza
  // `siguienteIdLocal` de vuelta a 0 — simulando que un aplicador futuro rompió la
  // disciplina "el contador nunca retrocede" DESPUÉS de que el motor ya se construyó
  // sobre un estado sano.
  const clonarQueRompeElContador = (valor) => {
    const clon = clonarProfundo(valor)
    if (clon !== null && typeof clon === "object" && "siguienteIdLocal" in clon && Array.isArray(clon.componentes)) {
      return { ...clon, siguienteIdLocal: 0 }
    }
    return clon
  }

  const proyectoInicial = crearProyecto({ generadorId: () => "proy-rx03", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const almacen = crearAlmacenFalso()
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen, clonar: clonarQueRompeElContador })

  // Primer commit: agrega cmp-0 — el canonico real termina con siguienteIdLocal:1,
  // consistente (esto usa el `clonar` roto para clonar el canonico VACÍO, que no
  // tiene componentes, así que el chequeo de forma de arriba no dispara — no cambia
  // nada acá, el contador arranca en 0 legítimamente).
  const r1 = motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "led" }, 0))
  assert.equal(r1.ok, true, "el primer commit sigue sano")
  assert.equal(motor.getProyecto().siguienteIdLocal, 1)

  // Segundo commit: una operación que NO toca ids (SetPlaca) — pero el `clonar`
  // inyectado, al clonar el canonico (que YA tiene cmp-0 y siguienteIdLocal:1) para
  // construir el borrador, lo deja con siguienteIdLocal:0 — inconsistente (cmp-0 ya
  // existe, 0 no es > 0). Nada en el pipeline de operación lo toca ni lo repara.
  const r2 = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, motor.getProyecto().revision))
  assert.equal(r2.ok, false, "el commit con contador de ids inconsistente debe rechazarse (defensa en profundidad, RX-03)")
  assert.ok(r2.motivos.some((m) => m.codigo === "CONTADOR_ID_INCONSISTENTE" && m.clasificacion === "rechazo"), `debe traer CONTADOR_ID_INCONSISTENTE: ${JSON.stringify(r2.motivos)}`)
  assert.equal(motor.getProyecto().siguienteIdLocal, 1, "el canonico NO cambia — el commit inconsistente se descarta completo")
  assert.equal(almacen.llamadasGuardar.length, 1, "sólo el primer commit (sano) llegó a persistir")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Gap de la campaña de mutación T8 (mutantes M10-adaptado/M11-adaptado, sobrevivientes):
// desactivar la defensa TEMPRANA de `aplicarConectar` (self-loop/duplicado, dentro de
// la operación misma) no lo detectaba ningún test existente cuando esa operación es la
// PRIMERA de un lote MULTI-operación — porque la defensa en profundidad de
// `validar-estructural.ts` (post-lote, RX-02/E2-01) "salva" el resultado FINAL del
// lote entero (`r.ok:false` igual), pero ningún test verificaba `resultadosOperaciones[]`
// granularmente para confirmar que el lote corta en la operación 1 y la operación 2
// NUNCA llega a correr. Contrato (comentario propio de `motor.ts`, "Pipeline de
// aplicarTransaccion"): "si aparece un motivo `clasificacion:'rechazo'` (el de una
// operación individual)... se corta el LOTE ENTERO" — el test de acá fija ese
// comportamiento explícitamente (mismo criterio que ya usa
// `tests/nucleo-adversarial.test.mjs`, test "7.", para el caso simétrico "rechazo al
// FINAL del lote"). Verificado con los mutantes M10-adaptado/M11-adaptado
// (`T8/diffs/M10-adaptado.diff`, `M11-adaptado.diff`): desactivar el chequeo temprano
// de `aplicarConectar` hace que la operación 1 "pase" a nivel de operación (así que el
// lote NO corta ahí) y la operación 2 SÍ llega a correr — `resultadosOperaciones.length`
// pasa de 1 a 2.
// ════════════════════════════════════════════════════════════════════════════════════

test("lote multi-operacion con Conectar self-loop en la operacion 1 corta el lote ahi — la operacion 2 NUNCA corre (gap T8, mutante M11-adaptado)", () => {
  const { motor } = crearMotorDePrueba()
  motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "resistencia" }, 0)) // cmp-0
  const revisionVigente = motor.getProyecto().revision

  const r = motor.aplicarTransaccion([
    nuevaOperacion("Conectar", { desde: { componente: "cmp-0", terminal: "a" }, hasta: { componente: "cmp-0", terminal: "a" } }, revisionVigente), // op 1: self-loop, RECHAZO
    nuevaOperacion("AgregarComponente", { tipo: "led" }, revisionVigente), // op 2: NUNCA debe correr
  ])

  assert.equal(r.ok, false, "el lote entero rechaza")
  assert.equal(r.resultadosOperaciones.length, 1, "el lote corta en la operacion 1 — la operacion 2 nunca se intenta")
  assert.equal(r.resultadosOperaciones[0].ok, false)
  assert.equal(r.resultadosOperaciones[0].motivos.length, 1)
  assert.equal(r.resultadosOperaciones[0].motivos[0].codigo, "AUTOCONEXION_INVALIDA")
  assert.equal(r.resultadosOperaciones[0].motivos[0].categoria, "operacion", "el rechazo temprano de la OPERACION (no la defensa en profundidad post-lote, que seria categoria estructural)")
  assert.equal(motor.getProyecto().componentes.length, 1, "ningun componente de la operacion 2 se agrego — el canonico no cambio")
})

test("lote multi-operacion con Conectar duplicada en la operacion 1 corta el lote ahi — la operacion 2 NUNCA corre (gap T8, mutante M10-adaptado)", () => {
  const { motor } = crearMotorDePrueba()
  motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "resistencia" }, 0)) // cmp-0
  motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "resistencia" }, 1)) // cmp-1
  motor.aplicar(nuevaOperacion("Conectar", { desde: { componente: "cmp-0", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "b" } }, 2)) // conn-0
  const revisionVigente = motor.getProyecto().revision

  const r = motor.aplicarTransaccion([
    // MISMO par que conn-0, extremos invertidos — "misma conexión" no depende del orden.
    nuevaOperacion("Conectar", { desde: { componente: "cmp-1", terminal: "b" }, hasta: { componente: "cmp-0", terminal: "a" } }, revisionVigente), // op 1: duplicada, RECHAZO
    nuevaOperacion("AgregarComponente", { tipo: "led" }, revisionVigente), // op 2: NUNCA debe correr
  ])

  assert.equal(r.ok, false, "el lote entero rechaza")
  assert.equal(r.resultadosOperaciones.length, 1, "el lote corta en la operacion 1 — la operacion 2 nunca se intenta")
  assert.equal(r.resultadosOperaciones[0].ok, false)
  assert.equal(r.resultadosOperaciones[0].motivos.length, 1)
  assert.equal(r.resultadosOperaciones[0].motivos[0].codigo, "CONEXION_DUPLICADA")
  assert.equal(r.resultadosOperaciones[0].motivos[0].categoria, "operacion", "el rechazo temprano de la OPERACION (no la defensa en profundidad post-lote, que seria categoria estructural)")
  assert.equal(motor.getProyecto().componentes.length, 2, "ningun componente de la operacion 2 se agrego — el canonico no cambio")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (RX4, hallazgo externo RX4-01, CRITICO — cuarta revision adversarial
// independiente, RX4_REPORT.md): `materializarDatosPlanos` acepta legitimamente
// `null` (dato JSON valido) tanto en la RAIZ como en cualquier ELEMENTO de un array
// — este modulo nunca decide si esa es la FORMA correcta para el consumidor, solo
// si es un dato plano. `ejecutarLote` (mas abajo, motor.ts) asumia sin verificar
// que el lote materializado es un array DENSO DE OBJETOS: `operaciones[0]!.
// baseRevision` (la PRIMERA lectura del lote, antes de clonar) y
// `operacion.idOperacion`/`.idTransaccion`/`.baseRevision` (el eco dentro del loop
// de aplicadores) leian el elemento CRUDO, sin proteccion — un elemento `null` (o
// cualquier otro no-objeto) hacia explotar un `TypeError` crudo, exactamente lo que
// el propio comentario de cabecera de este archivo ("el motor TAMBIEN se niega a...
// nunca una excepcion cruda sin estructura") prohibe. Tambien alcanza un LOTE que
// en si mismo no es un array (`null`/objeto/string) mas alla de lo que el tipo
// `SobreOperacion[]` promete en compilacion (TypeScript es sintaxis borrable, sin
// proteccion en runtime) — ninguna de las 3 puertas publicas del motor puede
// asumir que su llamador (un futuro transporte HTTP, brief §37) respeta el tipo.
// ════════════════════════════════════════════════════════════════════════════════════

test("motor.aplicar/aplicarTransaccion/proponer NUNCA propagan una excepcion cruda ante un elemento null (u otro no-objeto) en el lote — siempre un rechazo estructurado, canonico/disco/undo intactos (hallazgo externo RX4-01)", () => {
  const casosElementoUnico = [
    { nombre: "null", valor: null },
    { nombre: "undefined", valor: undefined },
    { nombre: "numero", valor: 42 },
    { nombre: "string", valor: "no-soy-un-sobre" },
    { nombre: "array", valor: [] },
  ]
  for (const { nombre, valor } of casosElementoUnico) {
    // motor.aplicar(x) — envuelve x en un lote de 1 puertas adentro.
    {
      const { motor, almacen } = crearMotorDePrueba()
      const revisionAntes = motor.getProyecto().revision
      let r
      assert.doesNotThrow(() => {
        r = motor.aplicar(valor)
      }, `motor.aplicar NUNCA debe lanzar una excepcion cruda — elemento "${nombre}"`)
      assert.equal(r.ok, false, `elemento "${nombre}" via aplicar: debe rechazar`)
      assert.equal(r.resultadosOperaciones.length, 0, `elemento "${nombre}" via aplicar: el corte ocurre ANTES del loop — 0 resultadosOperaciones`)
      assert.equal(motor.getProyecto().revision, revisionAntes, `elemento "${nombre}" via aplicar: el canonico no cambio`)
      assert.equal(almacen.llamadasGuardar.length, 0, `elemento "${nombre}" via aplicar: nunca llamo a guardar`)
      assert.equal(motor.obtenerBufferUndo().length, 0, `elemento "${nombre}" via aplicar: el buffer de undo no se toco`)
    }
    // motor.aplicarTransaccion([x]).
    {
      const { motor, almacen } = crearMotorDePrueba()
      let r
      assert.doesNotThrow(() => {
        r = motor.aplicarTransaccion([valor])
      }, `motor.aplicarTransaccion NUNCA debe lanzar una excepcion cruda — elemento "${nombre}"`)
      assert.equal(r.ok, false, `elemento "${nombre}" via aplicarTransaccion: debe rechazar`)
      assert.equal(r.resultadosOperaciones.length, 0, `elemento "${nombre}" via aplicarTransaccion: 0 resultadosOperaciones`)
      assert.equal(almacen.llamadasGuardar.length, 0, `elemento "${nombre}" via aplicarTransaccion: nunca llamo a guardar`)
    }
    // motor.proponer([x]) — dry-run, mismo contrato.
    {
      const { motor, almacen } = crearMotorDePrueba()
      let r
      assert.doesNotThrow(() => {
        r = motor.proponer([valor])
      }, `motor.proponer NUNCA debe lanzar una excepcion cruda — elemento "${nombre}"`)
      assert.equal(r.ok, false, `elemento "${nombre}" via proponer: debe rechazar`)
      assert.equal(r.resultadosOperaciones.length, 0, `elemento "${nombre}" via proponer: 0 resultadosOperaciones`)
      assert.equal(almacen.llamadasGuardar.length, 0, `elemento "${nombre}" via proponer: dry-run nunca persiste`)
    }
  }

  // Lote de 2: el elemento invalido puede ir primero o segundo — el lote ENTERO se
  // rechaza en los dos casos, nunca "la operacion valida si, la invalida no".
  const operacionValida = { idOperacion: "op-valida", actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }
  for (const { nombre, lote } of [
    { nombre: "[opValida, null]", lote: [operacionValida, null] },
    { nombre: "[null, opValida]", lote: [null, operacionValida] },
  ]) {
    const { motor, almacen } = crearMotorDePrueba()
    let r
    assert.doesNotThrow(() => {
      r = motor.aplicarTransaccion(lote)
    }, `motor.aplicarTransaccion NUNCA debe lanzar una excepcion cruda — lote ${nombre}`)
    assert.equal(r.ok, false, `lote ${nombre}: debe rechazar completo`)
    assert.equal(r.resultadosOperaciones.length, 0, `lote ${nombre}: 0 resultadosOperaciones — el corte es ANTES del loop, ni siquiera la operacion valida se ejecuta`)
    assert.equal(almacen.llamadasGuardar.length, 0, `lote ${nombre}: nunca llamo a guardar — ni la operacion valida se persistio sola`)
    assert.equal(motor.getProyecto().placa, null, `lote ${nombre}: la placa NUNCA se seteo — el canonico no cambio`)
  }
})

test("motor.aplicarTransaccion/proponer NUNCA propagan una excepcion cruda cuando el LOTE MISMO no es un array (hallazgo externo RX4-01)", () => {
  const casosLote = [
    { nombre: "null", valor: null },
    { nombre: "objeto", valor: {} },
    { nombre: "string", valor: "no-soy-un-lote" },
  ]
  for (const { nombre, valor } of casosLote) {
    {
      const { motor, almacen } = crearMotorDePrueba()
      let r
      assert.doesNotThrow(() => {
        r = motor.aplicarTransaccion(valor)
      }, `motor.aplicarTransaccion NUNCA debe lanzar una excepcion cruda — lote "${nombre}"`)
      assert.equal(r.ok, false, `lote "${nombre}": debe rechazar`)
      assert.equal(r.resultadosOperaciones.length, 0, `lote "${nombre}": 0 resultadosOperaciones`)
      assert.equal(r.motivos[0].codigo, "LOTE_OPERACIONES_INVALIDO", `lote "${nombre}": codigo especifico de lote malformado`)
      assert.equal(r.motivos[0].categoria, "motor")
      assert.equal(almacen.llamadasGuardar.length, 0, `lote "${nombre}": nunca llamo a guardar`)
    }
    {
      const { motor, almacen } = crearMotorDePrueba()
      let r
      assert.doesNotThrow(() => {
        r = motor.proponer(valor)
      }, `motor.proponer NUNCA debe lanzar una excepcion cruda — lote "${nombre}"`)
      assert.equal(r.ok, false, `lote "${nombre}" via proponer: debe rechazar`)
      assert.equal(almacen.llamadasGuardar.length, 0)
    }
  }
})

test("elemento null en el lote rechaza con SOBRE_OPERACION_INVALIDO, categoria motor, e incluye el indice (hallazgo externo RX4-01)", () => {
  const { motor } = crearMotorDePrueba()
  const operacionValida = { idOperacion: "op-valida", actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }
  const r = motor.aplicarTransaccion([operacionValida, null])
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "SOBRE_OPERACION_INVALIDO")
  assert.equal(r.motivos[0].categoria, "motor", "mismo codigo que operaciones.ts, distinta categoria — mismo criterio que ENTRADA_NO_ES_DATO_PLANO/BASE_REVISION_INVALIDA")
  assert.equal(r.motivos[0].datos.indice, 1, "el indice del elemento invalido dentro del lote")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (RX4, hallazgo externo RX4-02, CRÍTICO — cuarta revisión adversarial
// independiente, RX4_REPORT.md; RECLASIFICA E1-04, ver DECISIONS.md): más allá de
// `Number.MAX_SAFE_INTEGER`, `revision + 1 === revision` (colapso IEEE-754) — el
// motor se NIEGA a producir un commit cuyo incremento de revisión no sea exacto,
// nunca "silenciosamente se congela". `baseRevision` (que reusa la MISMA
// `esEnteroNoNegativo`, ahora acotada) también queda cubierto: un `baseRevision`
// más allá de `MAX_SAFE_INTEGER` rechaza con `BASE_REVISION_INVALIDA`, igual que
// cualquier otro entero fuera de rango (E3-01).
// ════════════════════════════════════════════════════════════════════════════════════

function crearMotorConRevisionInicial(revisionInicial) {
  const documento = {
    id: "proy-rx4-02",
    schemaVersion: "1.0.0",
    catalogoVersion: catalogo.version,
    catalogoHash: catalogo.hash,
    revision: revisionInicial,
    siguienteIdLocal: 0,
    placa: null,
    componentes: [],
    conexiones: [],
    comportamientos: [],
    metadata: { creadoEn: "2026-01-01T00:00:00.000Z" },
  }
  const almacen = crearAlmacenFalso()
  const motor = crearMotorDeProyecto({ proyectoInicial: documento, catalogo, almacen })
  return { motor, almacen }
}

test("baseRevision === 1e21 en una operacion rechaza con BASE_REVISION_INVALIDA — nunca 'ok:true' silencioso (hallazgo externo RX4-02)", () => {
  const { motor, almacen } = crearMotorDePrueba()
  const r = motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "led" }, 1e21))
  assert.equal(r.ok, false, "un baseRevision de 1e21 (fuera de Number.isSafeInteger) tiene que rechazar, NUNCA aceptar en silencio")
  assert.equal(r.motivos[0].codigo, "BASE_REVISION_INVALIDA")
  assert.equal(almacen.llamadasGuardar.length, 0, "nunca llamo a guardar")
})

// El reproductor original de RX4-02 ("cargarProyecto(doc con revision:1e21) -> ok:true,
// luego DOS commits con el mismo baseRevision:1e21, los DOS ok:true") ya deja de
// reproducir en la PRIMERA puerta: ningun documento con revision:1e21 vuelve a
// producir un `Proyecto` cargado ni un motor operable — `esEnteroNoNegativo`
// (reusada acá vía `validarFormaProyecto`) lo rechaza ANTES de que exista ningun
// canonico con esa revision para commitear encima.
test("un proyectoInicial con revision:1e21 NUNCA construye un motor operable — el reproductor de 'dos commits con la misma baseRevision, ambos ok' deja de reproducir (hallazgo externo RX4-02)", () => {
  const documento = {
    id: "proy-rx4-02-repro",
    schemaVersion: "1.0.0",
    catalogoVersion: catalogo.version,
    catalogoHash: catalogo.hash,
    revision: 1e21,
    siguienteIdLocal: 0,
    placa: null,
    componentes: [],
    conexiones: [],
    comportamientos: [],
    metadata: { creadoEn: "2026-01-01T00:00:00.000Z" },
  }
  assert.equal(cargarProyecto(structuredClone(documento)).ok, false, "control: cargarProyecto tambien rechaza el mismo documento — misma regla, misma puerta compartida")
  assert.throws(
    () => crearMotorDeProyecto({ proyectoInicial: documento, catalogo, almacen: crearAlmacenFalso() }),
    (err) => {
      assert.ok(err instanceof Error && err.name === "ErrorEstadoInicialInvalido", `debe lanzar ErrorEstadoInicialInvalido: ${err}`)
      assert.ok(
        err.motivos?.some((m) => m.codigo === "CAMPO_REQUERIDO_FALTANTE" && m.clasificacion === "rechazo"),
        `el error debe traer el motivo de forma invalida para 'revision': ${JSON.stringify(err.motivos)}`,
      )
      return true
    },
    "un proyectoInicial con revision:1e21 NUNCA debe construir un motor operable",
  )
})

test("revision === Number.MAX_SAFE_INTEGER - 1 commitea exacto a Number.MAX_SAFE_INTEGER (limite, no regresion RX4-02)", () => {
  const { motor, almacen } = crearMotorConRevisionInicial(Number.MAX_SAFE_INTEGER - 1)
  const r = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, Number.MAX_SAFE_INTEGER - 1))
  assert.equal(r.ok, true, "el incremento hasta MAX_SAFE_INTEGER es exacto — tiene que commitear igual que antes del fix")
  assert.equal(motor.getProyecto().revision, Number.MAX_SAFE_INTEGER)
  assert.equal(almacen.llamadasGuardar.length, 1)
})

test("en revision === Number.MAX_SAFE_INTEGER el siguiente commit rechaza SIN cambiar nada — nunca un incremento inexacto (hallazgo externo RX4-02)", () => {
  const { motor, almacen } = crearMotorConRevisionInicial(Number.MAX_SAFE_INTEGER)
  const revisionAntes = motor.getProyecto().revision
  assert.equal(revisionAntes, Number.MAX_SAFE_INTEGER)
  const r = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, Number.MAX_SAFE_INTEGER))
  assert.equal(r.ok, false, "el motor se niega a producir revision+1 cuando ya no seria exacto")
  assert.equal(motor.getProyecto().revision, revisionAntes, "el canonico NO cambio")
  assert.equal(motor.getProyecto().placa, null, "la placa NUNCA se seteo")
  assert.equal(almacen.llamadasGuardar.length, 0, "nunca llamo a guardar — nunca un incremento inexacto persistido")
  assert.equal(motor.obtenerBufferUndo().length, 0)
})

test("el contador de ids (siguienteIdLocal) tambien se niega a producir un incremento inexacto — AgregarComponente rechaza en vez de generar un id con precision perdida (hallazgo externo RX4-02, 'lo mismo para el contador de ids')", () => {
  const documento = {
    id: "proy-rx4-02-contador",
    schemaVersion: "1.0.0",
    catalogoVersion: catalogo.version,
    catalogoHash: catalogo.hash,
    revision: 0,
    siguienteIdLocal: Number.MAX_SAFE_INTEGER,
    placa: null,
    componentes: [],
    conexiones: [],
    comportamientos: [],
    metadata: { creadoEn: "2026-01-01T00:00:00.000Z" },
  }
  const almacen = crearAlmacenFalso()
  const motor = crearMotorDeProyecto({ proyectoInicial: documento, catalogo, almacen })
  const r = motor.aplicar(nuevaOperacion("AgregarComponente", { tipo: "led" }, 0))
  assert.equal(r.ok, false, "siguienteIdLocal+1 ya no seria exacto — el motor rechaza en vez de generar un id con precision perdida")
  assert.equal(motor.getProyecto().componentes.length, 0, "ningun componente se agrego")
  assert.equal(almacen.llamadasGuardar.length, 0)
})
