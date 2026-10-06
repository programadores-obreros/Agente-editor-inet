// Physical View UX #1 — aceptación objetiva del esquema físico (A–J) + ruteo de cables.
//
// Escenario de referencia: ESP32 + pulsador + LED + resistencia en serie, con la regla
// "mientras aprieto el pulsador, el LED está encendido". Los pines salen del proyecto
// (fixture), nunca del código de la vista.
//
//  A. zonas: Entrada/Pulsador · Controlador/ESP32 · Salida/Resistencia+LED
//  B. la resistencia queda eléctricamente ENTRE el GPIO y el LED
//  C. los rótulos de GPIO visibles son las asignaciones del proyecto
//  D. GND es físico/conectable y nunca aparece como GPIO elegible
//  E. el agrupamiento derivado no se persiste en la IR
//  F. cambiar el pin en el proyecto cambia rótulo y camino (sin rótulos viejos)
//  G. la identidad de las piezas es estable
//  H. lo no soportado / sin dibujo queda visible, nada se omite
//  I. la vista no crea verdad electrónica propia (sigue a ComponentKnowledge)
//  J. recargar produce la misma proyección
//  + ruteo.js: geometría pura (cruces, extremos, rodeo, determinismo)

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { pintar } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))
const { rutear, contarCruces, puntoDeAncla } = await import(join(REPO, "opencode/vista-fisica/web/ruteo.js"))
const { CONOCIMIENTO_ACTIVO } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))

const catalogo = CONOCIMIENTO_ACTIVO.catalogo

// ════════════════════════════════════════════════════════════════════════════════════
// Fixtures
// ════════════════════════════════════════════════════════════════════════════════════

let n = 0
function aplicarTodo(servicio, pasos) {
  for (const [tipo, payload] of pasos) {
    const r = servicio.aplicar({ idOperacion: `ux1-${n++}`, actor: "agente", baseRevision: servicio.snapshot().revision, tipo, payload })
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos ?? r)}`)
  }
}

const REGLA = { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: "cmp-1", accion: "encender" } } }

/** Escenario de referencia por el camino de producción (servicio con vista). */
function referencia(pinPulsador = "GPIO4", pinLed = "GPIO18") {
  const directorio = nuevoDir("ux1-referencia")
  const idProyecto = nuevoIdProyecto("ux1")
  const servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  aplicarTodo(servicio, [
    ["SetPlaca", { placa: "esp32-devkit-v1" }],
    ["AgregarComponente", { tipo: "pulsador" }], // cmp-0
    ["AgregarComponente", { tipo: "led" }], // cmp-1
    ["AgregarComponente", { tipo: "resistencia" }], // cmp-2
    ["AsignarPin", { componente: "cmp-0", terminal: "senal", pin: pinPulsador }],
    ["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: pinLed }],
    ["Conectar", { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } }],
    ["SetComportamiento", REGLA],
  ])
  return { servicio, directorio, idProyecto }
}

function documentoFake() {
  const crear = (tag) => ({
    tagName: tag,
    atributos: {},
    hijos: [],
    textContent: "",
    setAttribute(k, v) {
      this.atributos[k] = String(v)
    },
    appendChild(h) {
      this.hijos.push(h)
      return h
    },
  })
  return { createElement: crear }
}
const todos = (nodo) => [nodo, ...(nodo.hijos ?? []).flatMap(todos)]
const textoDe = (nodo) => todos(nodo).map((x) => x.textContent ?? "").join(" ")

function proyectoDirecto(pasos, placa = "esp32-devkit-v1") {
  let p = { ...crearProyecto({ generadorId: () => "ux1-directo", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash }), placa }
  for (const [tipo, payload] of pasos) {
    const r = ejecutarOperacion(p, { idOperacion: `ux1d-${n++}`, actor: "agente", baseRevision: p.revision, tipo, payload }, catalogo)
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
    p = r.proyecto
  }
  return p
}

// ════════════════════════════════════════════════════════════════════════════════════
// A — zonas
// ════════════════════════════════════════════════════════════════════════════════════

test("A: el escenario de referencia se proyecta en Entrada/Pulsador · Controlador/ESP32 · Salida/Resistencia+LED", () => {
  const { servicio } = referencia()
  try {
    const vista = servicio.snapshot().vista
    assert.deepEqual(vista.zonas.map((z) => [z.rol, z.titulo]), [["entrada", "Entrada"], ["controlador", "Controlador"], ["salida", "Salida"]])
    const porId = Object.fromEntries(vista.componentes.map((c) => [c.id, c]))
    assert.equal(porId["cmp-0"].zona, "entrada")
    assert.equal(porId["cmp-1"].zona, "salida")
    assert.equal(porId["cmp-2"].zona, "salida", "la resistencia del LED va a la zona del LED (requisito), no a 'otras'")
    assert.equal(porId["cmp-2"].agrupadoCon, "cmp-1")
    assert.equal(porId["cmp-2"].explicacion, "Protege al LED limitando la corriente.")
    assert.equal(vista.placa.nombre, "ESP32 DevKit")

    const raiz = pintar(documentoFake(), planDePintado(vista))
    const zona = (rol) => raiz.circuito.hijos.find((z) => z.atributos["data-zona"] === rol)
    assert.deepEqual(raiz.circuito.hijos.map((z) => z.atributos["data-zona"]), ["entrada", "controlador", "salida"])
    const tags = (rol) => todos(zona(rol)).filter((x) => x.tagName.startsWith("wokwi-")).map((x) => x.tagName)
    assert.deepEqual(tags("entrada"), ["wokwi-pushbutton"])
    assert.deepEqual(tags("controlador"), ["wokwi-esp32-devkit-v1"])
    assert.deepEqual(tags("salida"), ["wokwi-resistor", "wokwi-led"])
    assert.match(textoDe(zona("entrada")), /Entrada.*Pulsador/s)
    assert.match(textoDe(zona("controlador")), /Controlador.*ESP32 DevKit/s)
    assert.match(textoDe(zona("salida")), /Salida.*Resistencia.*LED/s)
    // La resistencia y el LED comparten UN grupo, con la explicación visible.
    const grupo = todos(zona("salida")).find((x) => x.atributos["data-grupo-fusion"] === "true")
    assert.deepEqual(todos(grupo).filter((x) => x.tagName.startsWith("wokwi-")).map((x) => x.tagName), ["wokwi-resistor", "wokwi-led"])
    assert.match(textoDe(grupo), /Resistencia: Protege al LED limitando la corriente\./)
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// B — la resistencia entre el GPIO y el LED
// ════════════════════════════════════════════════════════════════════════════════════

test("B: el camino de salida es GPIO → resistencia → LED → GND, todo con el mismo camino (el LED)", () => {
  const { servicio } = referencia()
  try {
    const vista = servicio.snapshot().vista
    const cableado = planDePintado(vista).find((i) => i.tipo === "cableado")
    const delLed = cableado.cables.filter((c) => c.camino === "cmp-1")
    assert.equal(delLed.length, 3)
    const [gpio, puente, gnd] = delLed
    assert.equal(gpio.desde.entidad.tipo, "placa")
    assert.equal(gpio.desde.etiqueta, "GPIO18 (D18)")
    assert.deepEqual(gpio.hasta.entidad, { tipo: "componente", id: "cmp-2" }, "del GPIO se va a la RESISTENCIA, no al LED")
    assert.deepEqual(puente.desde.entidad, { tipo: "componente", id: "cmp-2" })
    assert.deepEqual(puente.hasta.entidad, { tipo: "componente", id: "cmp-1" })
    assert.deepEqual(puente.hasta.anclas, ["A"], "llega al ánodo del LED")
    assert.deepEqual(gnd.desde.entidad, { tipo: "componente", id: "cmp-1" })
    assert.deepEqual(gnd.desde.anclas, ["C"], "sale del cátodo")
    assert.equal(gnd.hasta.potencia, true)
    // Ningún cable une directo el GPIO con el LED.
    assert.ok(!cableado.cables.some((c) => c.desde.entidad.tipo === "placa" && !c.desde.potencia && c.hasta.entidad.id === "cmp-1"))
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// C — rótulos de GPIO = asignaciones del proyecto
// ════════════════════════════════════════════════════════════════════════════════════

test("C: cada rótulo de GPIO del esquema corresponde a una asignación real del proyecto (y ninguno sobra)", () => {
  const { servicio } = referencia("GPIO5", "GPIO25")
  try {
    const snap = servicio.snapshot()
    const asignados = snap.proyecto.componentes.flatMap((c) => Object.values(c.pines)).sort()
    assert.deepEqual(asignados, ["GPIO25", "GPIO5"])
    const cableado = planDePintado(snap.vista).find((i) => i.tipo === "cableado")
    const rotulos = cableado.cables.flatMap((c) => [c.desde, c.hasta]).filter((e) => e.entidad.tipo === "placa" && !e.potencia).map((e) => e.etiqueta).sort()
    assert.deepEqual(rotulos, ["GPIO25 (D25)", "GPIO5 (D5)"])
    // Los pines usados son los del proyecto: ninguno de los de otros tests se cuela.
    assert.doesNotMatch(JSON.stringify(cableado), /GPIO4\b|GPIO18\b/)
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// D — GND físico, nunca GPIO elegible
// ════════════════════════════════════════════════════════════════════════════════════

test("D: GND se muestra como terminal de potencia (GND (masa), pines GND.1/GND.2) y nunca entre los GPIO elegibles", () => {
  const { servicio } = referencia()
  try {
    const vista = servicio.snapshot().vista
    const rieles = vista.cables.filter((c) => c.hasta.tipo === "rielFijo").map((c) => c.hasta.potencia)
    assert.equal(rieles.length, 2, "cátodo del LED + GND del pulsador")
    for (const p of rieles) assert.deepEqual(p, { id: "GND", etiqueta: "GND (masa)", anclasWokwi: ["GND.1", "GND.2"] })
    const plan = planDePintado(vista)
    for (const selector of plan.filter((i) => i.tipo === "selectorGpio")) {
      assert.ok(!selector.opciones.some((o) => /GND|3V3|VIN|5V/.test(o.valor)), `${selector.componenteId}.${selector.terminalId}`)
    }
    const gnd = plan.find((i) => i.tipo === "cableado").cables.filter((c) => c.hasta.potencia)
    assert.equal(gnd.length, 2)
    for (const c of gnd) assert.equal(c.hasta.etiqueta, "GND (masa)")
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// E — nada derivado se persiste
// ════════════════════════════════════════════════════════════════════════════════════

test("E: zonas, grupos, caminos y explicaciones NO se guardan en el proyecto (D-06: derivado)", () => {
  const { servicio, directorio, idProyecto } = referencia()
  try {
    servicio.snapshot() // proyecta la vista
  } finally {
    servicio.cerrar()
  }
  const documento = readFileSync(join(directorio, `${idProyecto}.json`), "utf8")
  for (const clave of ["zona", "zonas", "agrupadoCon", "camino", "explicacion", "anclasWokwi", "potencia", "elementoWokwi"]) {
    assert.ok(!documento.includes(`"${clave}"`), `"${clave}" apareció en el documento guardado`)
  }
  const proyecto = JSON.parse(documento)
  const camposIR = new Set(["id", "tipo", "pines", "propiedades"])
  for (const componente of proyecto.componentes) {
    for (const clave of Object.keys(componente)) assert.ok(camposIR.has(clave), `campo no-IR "${clave}" guardado en ${componente.id}`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// F — cambiar el pin cambia rótulo y camino
// ════════════════════════════════════════════════════════════════════════════════════

test("F: reasignar el LED de GPIO18 a GPIO26 cambia el rótulo y el cable; no queda ningún GPIO18", () => {
  const { servicio } = referencia()
  try {
    const antes = planDePintado(servicio.snapshot().vista)
    assert.match(JSON.stringify(antes.find((i) => i.tipo === "cableado")), /GPIO18 \(D18\)/)
    aplicarTodo(servicio, [["AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO26" }]])
    const despues = planDePintado(servicio.snapshot().vista)
    const cableado = despues.find((i) => i.tipo === "cableado")
    const gpio = cableado.cables.find((c) => c.camino === "cmp-1" && c.desde.entidad.tipo === "placa" && !c.desde.potencia)
    assert.equal(gpio.desde.etiqueta, "GPIO26 (D26)")
    assert.deepEqual(gpio.desde.anclas, ["D26"])
    assert.doesNotMatch(JSON.stringify(despues.filter((i) => i.tipo === "cableado" || i.tipo === "filaCable")), /GPIO18|D18/, "ningún rótulo viejo")
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// G — identidad estable
// ════════════════════════════════════════════════════════════════════════════════════

test("G: las piezas pintadas llevan el id de la IR; numerar 'LED 2' no cambia ningún id, y un cambio de pin tampoco", () => {
  const p = proyectoDirecto([
    ["AgregarComponente", { tipo: "led" }], // cmp-0
    ["AgregarComponente", { tipo: "led" }], // cmp-1
    ["AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO18" }],
  ])
  const vista = proyectarVista(p, catalogo)
  assert.deepEqual(vista.componentes.map((c) => [c.id, c.nombre]), [["cmp-0", "LED"], ["cmp-1", "LED 2"]])
  const raiz = pintar(documentoFake(), planDePintado(vista))
  const ids = todos(raiz.circuito).filter((x) => x.tagName.startsWith("wokwi-") && x.atributos["data-entidad-tipo"] === "componente").map((x) => x.atributos["data-entidad-id"])
  assert.deepEqual(ids, ["cmp-0", "cmp-1"])
  const p2 = ejecutarOperacion(p, { idOperacion: "g-1", actor: "agente", baseRevision: p.revision, tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "anodo", pin: "GPIO19" } }, catalogo).proyecto
  assert.deepEqual(proyectarVista(p2, catalogo).componentes.map((c) => [c.id, c.nombre]), [["cmp-0", "LED"], ["cmp-1", "LED 2"]])
})

// ════════════════════════════════════════════════════════════════════════════════════
// H — nada se omite en silencio
// ════════════════════════════════════════════════════════════════════════════════════

// CK-CG1: el DHT22 ahora tiene dibujo; la pieza sin representación del catálogo real es el NTC.
test("H: un NTC (sin dibujo) y una resistencia suelta quedan VISIBLES; toda pieza del proyecto aparece", () => {
  const p = proyectoDirecto([
    ["AgregarComponente", { tipo: "pulsador" }], // cmp-0
    ["AgregarComponente", { tipo: "ntc" }], // cmp-1
    ["AgregarComponente", { tipo: "resistencia" }], // cmp-2 (sin conectar)
  ])
  const vista = proyectarVista(p, catalogo)
  assert.deepEqual(vista.zonas.map((z) => z.rol), ["entrada", "controlador", "salida", "otras"], "aparece la zona 'Otras piezas'")
  const raiz = pintar(documentoFake(), planDePintado(vista))
  const zona = (rol) => raiz.circuito.hijos.find((z) => z.atributos["data-zona"] === rol)
  const marca = todos(zona("entrada")).find((x) => x.atributos["data-sin-representacion"] === "true")
  assert.ok(marca, "el NTC se marca en Entrada")
  assert.match(marca.textContent, /NTC.*no tiene dibujo/)
  assert.ok(todos(zona("otras")).some((x) => x.tagName === "wokwi-resistor"), "la resistencia suelta va a 'Otras piezas'")
  for (const componente of p.componentes) {
    assert.ok(todos(raiz.circuito).some((x) => x.atributos?.["data-entidad-id"] === componente.id), `${componente.id} (${componente.tipo}) no aparece`)
  }
})

test("H: un GPIO válido que la pieza de la placa no puede dibujar (GPIO0) deja una nota VISIBLE en la pieza, nunca un cable que desaparece", () => {
  const p = proyectoDirecto([
    ["AgregarComponente", { tipo: "led" }], // cmp-0
    ["AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO0" }],
  ])
  const plan = planDePintado(proyectarVista(p, catalogo))
  assert.ok(!plan.find((i) => i.tipo === "cableado").cables.some((c) => c.id === "cable-pin-cmp-0-anodo"), "no se inventa un pin para dibujarlo")
  const nota = plan.find((i) => i.tipo === "notaConexion")
  assert.deepEqual(nota.entidad, { tipo: "componente", id: "cmp-0" })
  assert.match(nota.texto, /GPIO0/)
  const raiz = pintar(documentoFake(), plan)
  const figura = todos(raiz.circuito).find((x) => x.tagName === "figure" && x.atributos["data-entidad-id"] === "cmp-0")
  assert.ok(figura.hijos.some((h) => h.atributos["data-nota-conexion"] === "cmp-0"), "la nota está dentro del contenedor del LED")
  // Red-team UX #3: el selector muestra el pin que la IR tiene, aunque no se ofrezca como opción nueva.
  const selector = plan.find((i) => i.tipo === "selectorGpio" && i.componenteId === "cmp-0")
  assert.equal(selector.valorActual, "GPIO0")
  assert.ok(selector.opciones.some((o) => o.valor === "GPIO0" && o.etiqueta === "GPIO0 (sin pin físico en esta placa)"), "el valor actual está entre las opciones")
})

test("A (red-team #1): una resistencia conectada al ánodo de un LED SIN pin todavía igual va a Salida con su explicación (nunca a 'Otras piezas')", () => {
  const p = proyectoDirecto([
    ["AgregarComponente", { tipo: "led" }], // cmp-0, sin pin
    ["AgregarComponente", { tipo: "resistencia" }], // cmp-1
    ["Conectar", { desde: { componente: "cmp-1", terminal: "a" }, hasta: { componente: "cmp-0", terminal: "anodo" } }],
  ])
  const vista = proyectarVista(p, catalogo)
  const resistencia = vista.componentes.find((c) => c.id === "cmp-1")
  assert.equal(resistencia.zona, "salida")
  assert.equal(resistencia.explicacion, "Protege al LED limitando la corriente.")
  assert.ok(!vista.zonas.some((z) => z.rol === "otras"))
})

// ════════════════════════════════════════════════════════════════════════════════════
// I — la vista sigue a ComponentKnowledge
// ════════════════════════════════════════════════════════════════════════════════════

test("I: el destino de potencia sale de ComponentKnowledge.resolverDestino (DHT22 VCC: 3V3 en ESP32, 5V en UNO)", () => {
  const vcc = (placa) => {
    const p = proyectoDirecto([["AgregarComponente", { tipo: "dht22" }]], placa)
    return proyectarVista(p, catalogo).cables.find((c) => c.id === "cable-riel-cmp-0-vcc").hasta.potencia
  }
  const terminal = catalogo.obtenerComponente("dht22").terminales.find((t) => t.id === "vcc")
  assert.equal(vcc("esp32-devkit-v1").id, CONOCIMIENTO_ACTIVO.resolverDestino("esp32-devkit-v1", terminal).id)
  assert.equal(vcc("esp32-devkit-v1").id, "3V3")
  assert.equal(vcc("arduino-uno").id, CONOCIMIENTO_ACTIVO.resolverDestino("arduino-uno", terminal).id)
  assert.equal(vcc("arduino-uno").id, "5V")
  assert.deepEqual(vcc("arduino-uno").anclasWokwi, ["5V"])
})

test("I (estático): el código del navegador no tiene tablas de pines, potencias ni roles propias", () => {
  for (const archivo of ["plan-de-pintado.js", "pintar.js", "cableado.js", "ruteo.js"]) {
    const codigo = readFileSync(join(REPO, "opencode/vista-fisica/web", archivo), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
    assert.doesNotMatch(codigo, /["'`](GPIO\d+|D\d+|GND(\.\d)?|3V3|VIN|5V)["'`]/, `${archivo}: literal de pin/potencia`)
    assert.doesNotMatch(codigo, /["'`](pulsador|led|resistencia|dht22|ntc)["'`]/, `${archivo}: despacho por tipo de componente`)
    assert.doesNotMatch(codigo, /["'`](sensor|actuador|pasivo)["'`]/, `${archivo}: clasifica roles por su cuenta`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// J — recargar da la misma proyección
// ════════════════════════════════════════════════════════════════════════════════════

test("J: cerrar y reabrir el proyecto da EXACTAMENTE la misma vista y el mismo plan", () => {
  const { servicio, directorio, idProyecto } = referencia()
  const antes = servicio.snapshot().vista
  servicio.cerrar()
  const reabierto = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  try {
    const despues = reabierto.snapshot().vista
    assert.deepEqual(despues, antes)
    assert.deepEqual(planDePintado(despues), planDePintado(antes))
  } finally {
    reabierto.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// ruteo.js — geometría pura, con las medidas REALES de Chromium (pinInfo)
// ════════════════════════════════════════════════════════════════════════════════════

// pinInfo real de las piezas (Chromium contra wokwi-bundle.js del repo).
const PINES_ESP32 = Object.fromEntries(
  "VIN@5,158.5 GND.2@5,149 D13@5,139.5 D12@5,130.4 D14@5,120 D27@5,110.8 D26@5,101 D25@5,91.3 D33@5,81.7 D32@5,72.2 D35@5,62.9 D34@5,53.1 VN@5,44 VP@5,34 EN@5,24 3V3@101.3,158.5 GND.1@101.3,149 D15@101.3,139.5 D2@101.3,130.4 D4@101.3,120 RX2@101.3,110.8 TX2@101.3,101 D5@101.3,91.3 D18@101.3,81.7 D19@101.3,72.2 D21@101.3,62.9 RX0@101.3,53.1 TX0@101.3,44 D22@101.3,34 D23@101.3,24"
    .split(" ")
    .map((s) => {
      const [nombre, xy] = s.split("@")
      const [x, y] = xy.split(",").map(Number)
      return [nombre, { x, y }]
    }),
)
const ENTIDADES = {
  "placa:esp32-devkit-v1": { rect: { x: 490, y: 85, w: 181.9, h: 355.3 }, zoom: 1.7, pines: PINES_ESP32, espejable: false, esPlaca: true },
  "componente:cmp-0": { rect: { x: 108, y: 324, w: 100.5, h: 75 }, zoom: 1.5, pines: { "1.l": { x: 0, y: 13 }, "2.l": { x: 0, y: 32 }, "1.r": { x: 67, y: 13 }, "2.r": { x: 67, y: 32 } }, espejable: true, esPlaca: false },
  "componente:cmp-2": { rect: { x: 997, y: 344, w: 88.5, h: 33 }, zoom: 1.5, pines: { 1: { x: 0, y: 5.65 }, 2: { x: 58.8, y: 5.65 } }, espejable: true, esPlaca: false },
  "componente:cmp-1": { rect: { x: 1122, y: 302, w: 60, h: 75 }, zoom: 1.5, pines: { A: { x: 25, y: 42 }, C: { x: 15, y: 42 } }, espejable: true, esPlaca: false },
}
const ext = (clave, anclas, etiqueta = null, potencia = false) => ({ clave, anclas, etiqueta, potencia })
const CABLES_REFERENCIA = [
  { id: "cable-pin-cmp-0-senal", camino: "cmp-0", desde: ext("placa:esp32-devkit-v1", ["D4"], "GPIO4 (D4)"), hasta: ext("componente:cmp-0", ["1.l", "1.r"]) },
  { id: "cable-riel-cmp-0-gnd", camino: "cmp-0", desde: ext("componente:cmp-0", ["2.l", "2.r"]), hasta: ext("placa:esp32-devkit-v1", ["GND.1", "GND.2"], "GND (masa)", true) },
  { id: "cable-pin-cmp-1-anodo", camino: "cmp-1", desde: ext("placa:esp32-devkit-v1", ["D18"], "GPIO18 (D18)"), hasta: ext("componente:cmp-2", ["2"]) },
  { id: "cable-conexion-conn-3", camino: "cmp-1", desde: ext("componente:cmp-2", ["1"]), hasta: ext("componente:cmp-1", ["A"]) },
  { id: "cable-riel-cmp-1-catodo", camino: "cmp-1", desde: ext("componente:cmp-1", ["C"]), hasta: ext("placa:esp32-devkit-v1", ["GND.1", "GND.2"], "GND (masa)", true) },
]

test("ruteo: el escenario de referencia se dibuja con a lo sumo 1 cruce (D4 queda entre D18 y GND.1: uno es inevitable)", () => {
  const r = rutear({ entidades: ENTIDADES, cables: CABLES_REFERENCIA })
  assert.equal(r.trazos.length, 5)
  assert.deepEqual(r.omitidos, [])
  assert.ok(r.cruces <= 1, `cruces: ${r.cruces}`)
  assert.equal(contarCruces(r.trazos), r.cruces)
})

test("ruteo: todo tramo es horizontal o vertical y cada cable empieza y termina EXACTAMENTE en un pin real", () => {
  const r = rutear({ entidades: ENTIDADES, cables: CABLES_REFERENCIA })
  for (const t of r.trazos) {
    for (let i = 1; i < t.puntos.length; i++) {
      const [a, b] = [t.puntos[i - 1], t.puntos[i]]
      assert.ok(a[0] === b[0] || a[1] === b[1], `${t.id}: tramo diagonal ${JSON.stringify([a, b])}`)
    }
    assert.deepEqual(t.puntos[0], t.extremos[0])
    assert.deepEqual(t.puntos.at(-1), t.extremos[1])
  }
  const gpio4 = r.trazos.find((t) => t.id === "cable-pin-cmp-0-senal")
  const d4 = puntoDeAncla(ENTIDADES["placa:esp32-devkit-v1"], "D4", false)
  assert.deepEqual(gpio4.extremos[0], [d4.x, d4.y], "el cable del pulsador nace en el pin D4 de la placa")
})

test("ruteo: el rótulo del GPIO va pegado al pin de la placa, del lado de afuera; los cables pieza↔pieza no llevan rótulo", () => {
  const r = rutear({ entidades: ENTIDADES, cables: CABLES_REFERENCIA })
  const d18 = r.trazos.find((t) => t.id === "cable-pin-cmp-1-anodo")
  assert.equal(d18.rotulo.texto, "GPIO18 (D18)")
  assert.equal(d18.rotulo.alinear, "start", "D18 está en la columna derecha: el rótulo crece hacia la derecha")
  assert.ok(Math.abs(d18.rotulo.x - d18.extremos[0][0]) <= 8)
  assert.equal(r.trazos.find((t) => t.id === "cable-conexion-conn-3").rotulo, null)
})

test("ruteo: un pin del lado CONTRARIO a la pieza rodea la placa (nunca la atraviesa)", () => {
  const r = rutear({ entidades: ENTIDADES, cables: CABLES_REFERENCIA })
  const placa = ENTIDADES["placa:esp32-devkit-v1"].rect
  for (const t of r.trazos) {
    for (let i = 1; i < t.puntos.length; i++) {
      const [a, b] = [t.puntos[i - 1], t.puntos[i]]
      if (a[1] === b[1]) {
        // un tramo horizontal que cruza todo el ancho de la placa tiene que ir por arriba o por abajo
        const cruzaAncho = Math.min(a[0], b[0]) < placa.x && Math.max(a[0], b[0]) > placa.x + placa.w
        if (cruzaAncho) assert.ok(a[1] < placa.y || a[1] > placa.y + placa.h, `${t.id} atraviesa la placa`)
      }
    }
  }
})

test("ruteo: la placa nunca se espeja; es determinista (misma entrada → mismo dibujo)", () => {
  const a = rutear({ entidades: ENTIDADES, cables: CABLES_REFERENCIA })
  const b = rutear({ entidades: ENTIDADES, cables: CABLES_REFERENCIA })
  assert.deepEqual(a, b)
  assert.ok(!a.espejadas.includes("placa:esp32-devkit-v1"))
})

test("ruteo: un pulsador en un pin de SU lado (D27, izquierda) se dibuja sin ningún cruce", () => {
  const cables = [
    { ...CABLES_REFERENCIA[0], desde: ext("placa:esp32-devkit-v1", ["D27"], "GPIO27 (D27)") },
    ...CABLES_REFERENCIA.slice(1),
  ]
  assert.equal(rutear({ entidades: ENTIDADES, cables }).cruces, 0)
})

test("ruteo: un extremo sin pin medible no se inventa — el cable queda en `omitidos` (sigue en la lista de texto)", () => {
  const cables = [{ id: "x", camino: null, desde: ext("placa:esp32-devkit-v1", ["NO-EXISTE"]), hasta: ext("componente:cmp-1", ["A"]) }]
  const r = rutear({ entidades: ENTIDADES, cables })
  assert.deepEqual(r.omitidos, ["x"])
  assert.equal(r.trazos.length, 0)
})
