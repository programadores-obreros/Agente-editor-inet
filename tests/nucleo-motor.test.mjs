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
      nombre: "componente basura (tipo/pines con tipo incorrecto)",
      proyectoInicial: { ...base, componentes: [{ id: "cmp-0", tipo: 123, pines: "x", extra: true }], siguienteIdLocal: 1 },
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
