// Phase 2, Slice 1 — fix de ronda única red-team, Hallazgo B2 (MAJOR,
// P2-RED-B/INFORME.md, ataque A6): si el servidor se reinicia con la página ya
// abierta (puerto efímero nuevo, el caso normal), la pestaña vieja quedaba
// exactamente igual — sin ningún indicio de que la conexión murió — contradiciendo
// `PHASE_2_SLICE_1_DESIGN.md:87` ("vuelve a pedir el snapshot al reconectar").
//
// Fix: `opencode/vista-fisica/web/estado-conexion.js` (reductor PURO, testeable sin
// navegador) + `app.js` (único módulo que toca `EventSource`/`document`, agrega
// listeners `error`/`open`, pinta un indicador visible y deshabilita el selector de
// GPIO mientras está desconectado) + `plan-de-pintado.js`/`pintar.js` (el selector
// sale deshabilitado cuando `conexionActiva` es falso).

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { reducirEstadoConexion, ESTADO_INICIAL } = await import(join(REPO, "opencode/vista-fisica/web/estado-conexion.js"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { pintar } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))

// ════════════════════════════════════════════════════════════════════════════════════
// reducirEstadoConexion — PURO, sin DOM
// ════════════════════════════════════════════════════════════════════════════════════

test("ESTADO_INICIAL es 'conectado' (optimista: la primera carga ya uso fetch, no SSE)", () => {
  assert.equal(ESTADO_INICIAL, "conectado")
})

test("reducirEstadoConexion: 'error' del EventSource -> 'desconectado', sin importar el estado previo", () => {
  assert.equal(reducirEstadoConexion("conectado", { tipo: "error" }), "desconectado")
  assert.equal(reducirEstadoConexion("desconectado", { tipo: "error" }), "desconectado")
})

test("reducirEstadoConexion: 'open' del EventSource -> 'conectado', sin importar el estado previo", () => {
  assert.equal(reducirEstadoConexion("desconectado", { tipo: "open" }), "conectado")
  assert.equal(reducirEstadoConexion("conectado", { tipo: "open" }), "conectado")
})

test("reducirEstadoConexion: un tipo de evento desconocido NUNCA lanza y deja el estado sin cambios", () => {
  assert.equal(reducirEstadoConexion("conectado", { tipo: "algo-raro" }), "conectado")
  assert.equal(reducirEstadoConexion("desconectado", { tipo: "algo-raro" }), "desconectado")
})

// ════════════════════════════════════════════════════════════════════════════════════
// planDePintado: el selector de GPIO sale deshabilitado cuando no hay conexion
// ════════════════════════════════════════════════════════════════════════════════════

const MODELO_MINIMO = Object.freeze({
  placa: { id: "esp32-devkit-v1", elementoWokwi: "wokwi-esp32-devkit-v1", escala: 1.25 },
  componentes: [{ id: "cmp-0", tipo: "led", elementoWokwi: "wokwi-led", atributos: {}, terminales: { anodo: { estado: "sinAsignar", nombreWokwiPieza: "A" } } }],
  cables: [],
  gpiosDisponibles: { "cmp-0": { anodo: [{ pinSemantico: "GPIO4", nombreWokwi: "D4" }] } },
  motivos: [],
  readiness: { incompleto: true, invalido: false, listo: false },
})

test("planDePintado: SIN pasar opciones (default), el selector sale HABILITADO (compatibilidad hacia atras)", () => {
  const plan = planDePintado(MODELO_MINIMO)
  const selector = plan.find((i) => i.tipo === "selectorGpio")
  assert.equal(selector.deshabilitado, false)
})

test("planDePintado: con conexionActiva:false, el selector sale con deshabilitado:true", () => {
  const plan = planDePintado(MODELO_MINIMO, { conexionActiva: false })
  const selector = plan.find((i) => i.tipo === "selectorGpio")
  assert.equal(selector.deshabilitado, true)
})

test("planDePintado: con conexionActiva:true explicito, el selector sale habilitado", () => {
  const plan = planDePintado(MODELO_MINIMO, { conexionActiva: true })
  const selector = plan.find((i) => i.tipo === "selectorGpio")
  assert.equal(selector.deshabilitado, false)
})

// ════════════════════════════════════════════════════════════════════════════════════
// pintar(): aplica instruccion.deshabilitado como selector.disabled real
// ════════════════════════════════════════════════════════════════════════════════════

function elementoFake(tag) {
  return {
    tagName: tag,
    atributos: {},
    hijos: [],
    disabled: false,
    setAttribute(nombre, valor) {
      this.atributos[nombre] = String(valor)
    },
    appendChild(hijo) {
      this.hijos.push(hijo)
      return hijo
    },
    addEventListener() {},
    set value(v) {
      this._value = v
    },
    get value() {
      return this._value ?? ""
    },
  }
}
function documentoFake() {
  return { createElement: (tag) => elementoFake(tag) }
}

test("pintar(): selectorGpio con deshabilitado:true produce un <select> con .disabled === true", () => {
  const doc = documentoFake()
  const instrucciones = [{ tipo: "selectorGpio", componenteId: "cmp-0", terminalId: "anodo", opciones: [{ valor: "GPIO4", etiqueta: "D4" }], valorActual: null, deshabilitado: true }]
  const raiz = pintar(doc, instrucciones)
  const selectorReal = raiz.controles.hijos[0].hijos.find((h) => h.tagName === "select")
  assert.equal(selectorReal.disabled, true)
})

test("pintar(): selectorGpio con deshabilitado:false (o ausente) produce un <select> con .disabled === false", () => {
  const doc = documentoFake()
  const instrucciones = [{ tipo: "selectorGpio", componenteId: "cmp-0", terminalId: "anodo", opciones: [{ valor: "GPIO4", etiqueta: "D4" }], valorActual: null }]
  const raiz = pintar(doc, instrucciones)
  const selectorReal = raiz.controles.hijos[0].hijos.find((h) => h.tagName === "select")
  assert.equal(selectorReal.disabled, false)
})
