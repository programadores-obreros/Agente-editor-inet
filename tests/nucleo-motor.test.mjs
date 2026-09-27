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
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { clonarProfundo } = await import(join(REPO, "opencode/nucleo/canonico.ts"))
const { construirCatalogoMinimoReal } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))

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
