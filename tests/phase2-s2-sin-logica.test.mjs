// Phase 2, Slice 2 — W-S2-VISTA, recorrido §1 paso 13 / NON-GOAL duro del briefing:
// "Ninguna relación lógica pulsador → LED". Nunca hay `ComportamientoRegla`, nunca
// hay lógica, nunca hay simulación (§0 del diseño). Este test demuestra, en el
// código que este writer toca, que:
//  1. `web/*.js` no contiene ningún literal `button-press`/`button-release`
//     (los eventos custom que SÍ dispara el custom element real, ARCH-S2-PHYSICAL/
//     INFORME.md §8 — el riesgo NON-GOAL explícito de ese informe).
//  2. Ningún archivo tocado por este slice (`web/*.js`, `scripts/vista-fisica-demo.mjs`)
//     menciona `SetComportamiento`.
//  3. Funcionalmente: `pintar()` JAMÁS registra un `addEventListener` sobre la pieza
//     Wokwi creada — sólo sobre el `<select>` del GPIO (el único caso legítimo,
//     Phase 2 Slice 1).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { pintar } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))

// ════════════════════════════════════════════════════════════════════════════════════
// 1 + 2. Escaneo estático
// ════════════════════════════════════════════════════════════════════════════════════

test("web/*.js no contiene button-press/button-release/SetComportamiento", () => {
  const dirWeb = join(REPO, "opencode/vista-fisica/web")
  const PATRONES_PROHIBIDOS = [/button-press/i, /button-release/i, /SetComportamiento/]
  const archivos = readdirSync(dirWeb).filter((f) => f.endsWith(".js"))
  assert.ok(archivos.length > 0, "fixture: tiene que haber al menos un .js en vista-fisica/web")
  for (const archivo of archivos) {
    const contenido = readFileSync(join(dirWeb, archivo), "utf8")
    for (const patron of PATRONES_PROHIBIDOS) {
      assert.ok(!patron.test(contenido), `${archivo} no puede contener ${patron} — ninguna lógica pulsador->LED (NON-GOAL duro)`)
    }
  }
})

test("scripts/vista-fisica-demo.mjs no contiene button-press/button-release/SetComportamiento", () => {
  const contenido = readFileSync(join(REPO, "scripts/vista-fisica-demo.mjs"), "utf8")
  for (const patron of [/button-press/i, /button-release/i, /SetComportamiento/]) {
    assert.ok(!patron.test(contenido), `vista-fisica-demo.mjs no puede contener ${patron}`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3. Funcional: pintar() nunca escucha eventos sobre la pieza Wokwi
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
  return { createElement: (tag) => elementoFake(tag) }
}

/** Busca, recursivamente, un descendiente por `tagName` — necesario desde el fix
 * post-gate (v2-gpio34-blocking.png, `phase2-s2-rol.test.mjs`): una pieza CON rol ya
 * no es hija directa de `raiz.circuito`, está envuelta en su propio contenedor
 * (`<figure>`) junto con su rótulo. */
function buscarPieza(nodo, tag) {
  for (const hijo of nodo.hijos ?? []) {
    if (hijo.tagName === tag) return hijo
    const enHijo = buscarPieza(hijo, tag)
    if (enHijo) return enHijo
  }
  return undefined
}

/** Todos los descendientes, en cualquier profundidad (incluye los contenedores
 * `<figure>` del fix de rol Y las piezas/rótulos adentro) — para verificar que
 * NINGUNO, a ninguna profundidad, tiene un listener. */
function todosLosNodos(nodo, acc = []) {
  for (const hijo of nodo.hijos ?? []) {
    acc.push(hijo)
    todosLosNodos(hijo, acc)
  }
  return acc
}

test("pintar(): la pieza wokwi-pushbutton creada NUNCA recibe ningún addEventListener; sólo el <select> del GPIO lo recibe", () => {
  const doc = documentoFake()
  const instrucciones = [
    { tipo: "crearElemento", entidad: { tipo: "componente", id: "cmp-1" }, tag: "wokwi-pushbutton", atributos: { color: "green" }, etiquetaRol: "Entrada" },
    { tipo: "selectorGpio", componenteId: "cmp-1", terminalId: "senal", opciones: [{ valor: "GPIO4", etiqueta: "D4" }], valorActual: null },
  ]
  const eventos = []
  const raiz = pintar(doc, instrucciones, { onCambioGpio: (e) => eventos.push(e) })

  const pulsador = buscarPieza(raiz.circuito, "wokwi-pushbutton")
  assert.deepEqual(pulsador._listeners, {}, "la pieza Wokwi no tiene NINGÚN listener propio")

  const selector = raiz.controles.hijos[0].hijos[0]
  assert.ok(selector._listeners.change, "el <select> sí escucha 'change' (Phase 2 Slice 1, legítimo)")

  // Un click simulado sobre la pieza (mismo criterio que el riesgo prospectivo de
  // ARCH-S2-PHYSICAL/INFORME.md §8) nunca podría disparar nada de todos modos: no
  // hay ningún manejador registrado para escuchar.
  assert.equal(Object.keys(pulsador._listeners).length, 0)
})

test("pintar(): con dos wokwi-pushbutton + un LED (cada uno con su rótulo de rol), ninguno de los descendientes de #circuito recibe listeners", () => {
  const doc = documentoFake()
  const instrucciones = [
    { tipo: "crearElemento", entidad: { tipo: "placa", id: "placa-0" }, tag: "wokwi-esp32-devkit-v1", atributos: {}, etiquetaRol: null },
    { tipo: "crearElemento", entidad: { tipo: "componente", id: "cmp-1" }, tag: "wokwi-led", atributos: { color: "red" }, etiquetaRol: "Salida" },
    { tipo: "crearElemento", entidad: { tipo: "componente", id: "cmp-2" }, tag: "wokwi-pushbutton", atributos: { color: "green" }, etiquetaRol: "Entrada" },
  ]
  const raiz = pintar(doc, instrucciones)
  const piezas = todosLosNodos(raiz.circuito)
  assert.ok(
    piezas.some((p) => p.tagName === "wokwi-pushbutton") && piezas.some((p) => p.tagName === "wokwi-led"),
    "fixture: el recorrido recursivo tiene que encontrar las piezas envueltas en sus contenedores",
  )
  for (const pieza of piezas) {
    assert.deepEqual(pieza._listeners ?? {}, {}, `${pieza.tagName} no puede tener ningún listener`)
  }
})
