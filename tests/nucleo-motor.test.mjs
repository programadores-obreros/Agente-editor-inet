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
  const r = motor.aplicar(nuevaOperacion("SetPlaca", { placa: "esp32-devkit-v1" }, 99)) // 99 != revision real (0)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "BASE_REVISION_DESACTUALIZADA")
  assert.equal(llamadasClonar, 0, "una baseRevision obsoleta corta ANTES de clonar")
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
