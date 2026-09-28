// Phase 2, Slice 1 — `opencode/vista-fisica/web/pintar.js` (writer W3, tarea 4).
// Test PURO, sin ningún DOM real (este repo no depende de jsdom/happy-dom): un
// "document" mínimo, hecho a mano acá, que sólo registra `createElement`/
// `setAttribute`/`appendChild` (y una implementación trivial de `addEventListener`
// para que el selector de GPIO no rompa al conectar el handler). Verifica que
// `pintar()` aplica el plan de instrucciones (la misma forma que produce
// `plan-de-pintado.js`, pero construida a mano acá — este test es sobre `pintar.js`
// en aislamiento, nunca depende del resto del pipeline de vista física).
//
// Límite documentado (briefing tarea 4, "si queda demasiado artificial..."): esto
// SÍ se pudo hacer sin un DOM real porque `pintar.js` sólo usa esas tres operaciones
// más `.value`/`.textContent` como propiedades planas — no hay estilo computado,
// eventos reales del navegador, ni layout que verificar. Lo que este test NO cubre
// (el `<select>` disparando `change` de verdad, el resultado visual) queda para la
// demo en un navegador real, que hace el orquestador (fuera de esta tarea).

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { pintar } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))

// ════════════════════════════════════════════════════════════════════════════════════
// "document" fake — registra createElement/setAttribute/appendChild, nada más.
// ════════════════════════════════════════════════════════════════════════════════════

function elementoFake(tag) {
  return {
    tagName: tag,
    atributos: {},
    hijos: [],
    _textContent: "",
    _listeners: {},
    setAttribute(nombre, valor) {
      this.atributos[nombre] = String(valor)
    },
    appendChild(hijo) {
      this.hijos.push(hijo)
      return hijo
    },
    addEventListener(tipo, manejador) {
      this._listeners[tipo] = this._listeners[tipo] ?? []
      this._listeners[tipo].push(manejador)
    },
    disparar(tipo) {
      for (const manejador of this._listeners[tipo] ?? []) manejador()
    },
    get textContent() {
      return this._textContent
    },
    set textContent(valor) {
      this._textContent = valor
    },
    get value() {
      return this._value ?? ""
    },
    set value(valor) {
      this._value = valor
    },
  }
}

function documentoFake() {
  const creados = []
  return {
    creados,
    createElement(tag) {
      const el = elementoFake(tag)
      creados.push(el)
      return el
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// crearElemento
// ════════════════════════════════════════════════════════════════════════════════════

test("crearElemento: crea el tag pedido, con data-entidad-* y los atributos de la instruccion, dentro de raiz.circuito", () => {
  const doc = documentoFake()
  const instrucciones = [
    { tipo: "crearElemento", entidad: { tipo: "placa", id: "placa-0" }, tag: "wokwi-esp32-devkit-v1", atributos: {} },
    { tipo: "crearElemento", entidad: { tipo: "componente", id: "cmp-0" }, tag: "wokwi-led", atributos: { color: "red" } },
  ]
  const raiz = pintar(doc, instrucciones)

  assert.equal(raiz.circuito.hijos.length, 2)
  const [placa, led] = raiz.circuito.hijos
  assert.equal(placa.tagName, "wokwi-esp32-devkit-v1")
  assert.equal(placa.atributos["data-entidad-tipo"], "placa")
  assert.equal(placa.atributos["data-entidad-id"], "placa-0")
  assert.equal(led.tagName, "wokwi-led")
  assert.equal(led.atributos["data-entidad-tipo"], "componente")
  assert.equal(led.atributos["data-entidad-id"], "cmp-0")
  assert.equal(led.atributos.color, "red")
})

// ════════════════════════════════════════════════════════════════════════════════════
// filaCable
// ════════════════════════════════════════════════════════════════════════════════════

test("filaCable: una <li> por cable, con data-cable-id y el texto 'desde -> hasta'", () => {
  const doc = documentoFake()
  const instrucciones = [{ tipo: "filaCable", id: "cable-0", desde: "D5", hasta: "A" }]
  const raiz = pintar(doc, instrucciones)

  assert.equal(raiz.cables.hijos.length, 1)
  const fila = raiz.cables.hijos[0]
  assert.equal(fila.tagName, "li")
  assert.equal(fila.atributos["data-cable-id"], "cable-0")
  assert.equal(fila.textContent, "D5 → A")
})

// ════════════════════════════════════════════════════════════════════════════════════
// selectorGpio
// ════════════════════════════════════════════════════════════════════════════════════

test("selectorGpio: <select> con una opcion vacia + una por candidato, value = valorActual, dentro de raiz.controles", () => {
  const doc = documentoFake()
  const instrucciones = [
    {
      tipo: "selectorGpio",
      componenteId: "cmp-0",
      terminalId: "anodo",
      opciones: [
        { valor: "GPIO4", etiqueta: "D4" },
        { valor: "GPIO16", etiqueta: "RX2" },
      ],
      valorActual: "GPIO4",
    },
  ]
  const raiz = pintar(doc, instrucciones)

  assert.equal(raiz.controles.hijos.length, 1)
  const etiqueta = raiz.controles.hijos[0]
  assert.equal(etiqueta.tagName, "label")
  assert.equal(etiqueta.hijos.length, 1)
  const selector = etiqueta.hijos[0]
  assert.equal(selector.tagName, "select")
  assert.equal(selector.atributos["data-componente-id"], "cmp-0")
  assert.equal(selector.atributos["data-terminal-id"], "anodo")
  // opción vacía + 2 candidatos
  assert.equal(selector.hijos.length, 3)
  assert.equal(selector.hijos[0].atributos.value, "")
  assert.equal(selector.hijos[1].atributos.value, "GPIO4")
  assert.equal(selector.hijos[1].textContent, "D4")
  assert.equal(selector.hijos[2].atributos.value, "GPIO16")
  assert.equal(selector.value, "GPIO4")
})

test("selectorGpio: valorActual null -> value queda en la opcion vacia (sin asignar)", () => {
  const doc = documentoFake()
  const instrucciones = [{ tipo: "selectorGpio", componenteId: "cmp-0", terminalId: "anodo", opciones: [{ valor: "GPIO4", etiqueta: "D4" }], valorActual: null }]
  const raiz = pintar(doc, instrucciones)
  const selector = raiz.controles.hijos[0].hijos[0]
  assert.equal(selector.value, "")
})

test("selectorGpio: cambiar el <select> llama a manejadores.onCambioGpio con {componenteId, terminalId, valor}", () => {
  const doc = documentoFake()
  const instrucciones = [
    { tipo: "selectorGpio", componenteId: "cmp-0", terminalId: "anodo", opciones: [{ valor: "GPIO4", etiqueta: "D4" }, { valor: "GPIO16", etiqueta: "RX2" }], valorActual: "GPIO4" },
  ]
  const eventos = []
  const raiz = pintar(doc, instrucciones, { onCambioGpio: (e) => eventos.push(e) })
  const selector = raiz.controles.hijos[0].hijos[0]

  selector.value = "GPIO16"
  selector.disparar("change")

  assert.equal(eventos.length, 1)
  assert.deepEqual(eventos[0], { componenteId: "cmp-0", terminalId: "anodo", valor: "GPIO16" })
})

test("selectorGpio: elegir la opcion vacia llama a onCambioGpio con valor:null (nunca string vacio)", () => {
  const doc = documentoFake()
  const instrucciones = [{ tipo: "selectorGpio", componenteId: "cmp-0", terminalId: "anodo", opciones: [{ valor: "GPIO4", etiqueta: "D4" }], valorActual: "GPIO4" }]
  const eventos = []
  const raiz = pintar(doc, instrucciones, { onCambioGpio: (e) => eventos.push(e) })
  const selector = raiz.controles.hijos[0].hijos[0]

  selector.value = ""
  selector.disparar("change")

  assert.equal(eventos.length, 1)
  assert.equal(eventos[0].valor, null)
})

test("selectorGpio: sin manejadores (o sin onCambioGpio), pintar() NUNCA rompe y no registra ningun listener", () => {
  const doc = documentoFake()
  const instrucciones = [{ tipo: "selectorGpio", componenteId: "cmp-0", terminalId: "anodo", opciones: [{ valor: "GPIO4", etiqueta: "D4" }], valorActual: null }]
  assert.doesNotThrow(() => pintar(doc, instrucciones))
  const raiz = pintar(doc, instrucciones, {})
  const selector = raiz.controles.hijos[0].hijos[0]
  assert.deepEqual(selector._listeners, {})
})

// ════════════════════════════════════════════════════════════════════════════════════
// panelMotivo
// ════════════════════════════════════════════════════════════════════════════════════

test("panelMotivo: una <li> con data-motivo-codigo/severidad y el texto '[severidad] codigo (clasificacion)'", () => {
  const doc = documentoFake()
  const instrucciones = [{ tipo: "panelMotivo", codigo: "REQUISITO_INSATISFECHO", severidad: "blocking", clasificacion: "advertencia", entidad: { tipo: "componente", id: "cmp-0" } }]
  const raiz = pintar(doc, instrucciones)

  assert.equal(raiz.motivos.hijos.length, 1)
  const fila = raiz.motivos.hijos[0]
  assert.equal(fila.atributos["data-motivo-codigo"], "REQUISITO_INSATISFECHO")
  assert.equal(fila.atributos["data-motivo-severidad"], "blocking")
  assert.equal(fila.textContent, "[blocking] REQUISITO_INSATISFECHO (advertencia)")
})

test("panelMotivo: clasificacion null no agrega el paréntesis vacío", () => {
  const doc = documentoFake()
  const instrucciones = [{ tipo: "panelMotivo", codigo: "X", severidad: "info", clasificacion: null, entidad: null }]
  const raiz = pintar(doc, instrucciones)
  assert.equal(raiz.motivos.hijos[0].textContent, "[info] X")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Plan completo (orden mixto) + no-mutación entre llamadas
// ════════════════════════════════════════════════════════════════════════════════════

test("un plan con las 4 instrucciones puebla las 4 raices en el mismo orden que planDePintado ya certifica", () => {
  const doc = documentoFake()
  const instrucciones = [
    { tipo: "crearElemento", entidad: { tipo: "placa", id: "placa-0" }, tag: "wokwi-esp32-devkit-v1", atributos: {} },
    { tipo: "crearElemento", entidad: { tipo: "componente", id: "cmp-0" }, tag: "wokwi-led", atributos: { color: "red" } },
    { tipo: "filaCable", id: "cable-0", desde: "D5", hasta: "A" },
    { tipo: "selectorGpio", componenteId: "cmp-0", terminalId: "anodo", opciones: [{ valor: "GPIO4", etiqueta: "D4" }], valorActual: "GPIO4" },
    { tipo: "panelMotivo", codigo: "X", severidad: "info", clasificacion: null, entidad: null },
  ]
  const raiz = pintar(doc, instrucciones)
  assert.equal(raiz.circuito.hijos.length, 2)
  assert.equal(raiz.cables.hijos.length, 1)
  assert.equal(raiz.controles.hijos.length, 1)
  assert.equal(raiz.motivos.hijos.length, 1)
})

test("dos llamadas a pintar() con el MISMO doc devuelven raices NUEVAS e independientes (nunca reusa ni muta la anterior)", () => {
  const doc = documentoFake()
  const instrucciones = [{ tipo: "filaCable", id: "cable-0", desde: "D5", hasta: "A" }]
  const raiz1 = pintar(doc, instrucciones)
  const raiz2 = pintar(doc, instrucciones)
  assert.notEqual(raiz1.cables, raiz2.cables)
  assert.equal(raiz1.cables.hijos.length, 1)
  assert.equal(raiz2.cables.hijos.length, 1)
})

test("una instruccion de un tipo desconocido se ignora (fail-closed, nunca inventa un render)", () => {
  const doc = documentoFake()
  const instrucciones = [{ tipo: "algo-que-no-existe-todavia" }]
  const raiz = pintar(doc, instrucciones)
  assert.equal(raiz.circuito.hijos.length, 0)
  assert.equal(raiz.cables.hijos.length, 0)
  assert.equal(raiz.controles.hijos.length, 0)
  assert.equal(raiz.motivos.hijos.length, 0)
})
