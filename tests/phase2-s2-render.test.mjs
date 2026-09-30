// Phase 2, Slice 2 — W-S2-VISTA, §3.2 (render del pulsador).
// docs/programacion-intencion/PHASE_2_SLICE_2_DESIGN.md §3.2/§5, HD-S2-2/3/4.
//
// Verifica el ÚNICO cambio real del gap (ARCH-S2-PHYSICAL/INFORME.md §3): una
// entrada nueva en cada una de las TRES tablas declarativas de
// `wokwi-render-datos.ts` para `tipo: "pulsador"` — mismo patrón que ya usa "led",
// nunca una rama nueva de código en `snapshot-a-vista.ts`/`plan-de-pintado.js`.
//
// Pines verificados en vivo contra el bundle real (Chromium headless,
// ARCH-S2-PHYSICAL/INFORME.md §2, `el.pinInfo` de `wokwi-pushbutton`):
// `[{"name":"1.l"},{"name":"2.l"},{"name":"1.r"},{"name":"2.r"}]`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, catalogo, nuevoDir, nuevoIdProyecto, obtenerServicioDeProyecto, op, GPIO_X } from "./phase2-helpers.mjs"

const { ELEMENTO_WOKWI_POR_TIPO, TERMINAL_WOKWI_POR_TIPO, ATRIBUTOS_POR_TIPO } = await import(join(REPO, "opencode/vista-fisica/wokwi-render-datos.ts"))
const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))

// ════════════════════════════════════════════════════════════════════════════════════
// 1. Las tres tablas declarativas
// ════════════════════════════════════════════════════════════════════════════════════

test("ELEMENTO_WOKWI_POR_TIPO.pulsador === 'wokwi-pushbutton' (el LED no cambia)", () => {
  assert.equal(ELEMENTO_WOKWI_POR_TIPO.pulsador, "wokwi-pushbutton")
  assert.equal(ELEMENTO_WOKWI_POR_TIPO.led, "wokwi-led", "el LED no se toca")
})

test("TERMINAL_WOKWI_POR_TIPO.pulsador === {senal:'1.l', gnd:'2.l'} (el LED no cambia)", () => {
  assert.deepEqual(TERMINAL_WOKWI_POR_TIPO.pulsador, { senal: "1.l", gnd: "2.l" })
  assert.deepEqual(TERMINAL_WOKWI_POR_TIPO.led, { anodo: "A", catodo: "C" }, "el LED no se toca")
})

test("ATRIBUTOS_POR_TIPO.pulsador === {color:'green'} (el LED sigue 'red')", () => {
  assert.deepEqual(ATRIBUTOS_POR_TIPO.pulsador, { color: "green" })
  assert.deepEqual(ATRIBUTOS_POR_TIPO.led, { color: "red" }, "el LED no se toca")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 2. proyectarVista: el pulsador se proyecta con el mismo adaptador genérico
// ════════════════════════════════════════════════════════════════════════════════════

function prepararProyectoConLedYPulsador(dir, idProyecto) {
  const servicio = obtenerServicioDeProyecto({ directorio: dir, idProyecto })
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  if (!r.ok) throw new Error(`fixture: SetPlaca rechazado: ${JSON.stringify(r.motivos)}`)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
  if (!r.ok) throw new Error(`fixture: AgregarComponente(led) rechazado: ${JSON.stringify(r.motivos)}`)
  const idLed = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idLed, terminal: "anodo", pin: GPIO_X }, servicio.snapshot().revision))
  if (!r.ok) throw new Error(`fixture: AsignarPin(led) rechazado: ${JSON.stringify(r.motivos)}`)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  if (!r.ok) throw new Error(`fixture: AgregarComponente(pulsador) rechazado: ${JSON.stringify(r.motivos)}`)
  const idPulsador = servicio.snapshot().proyecto.componentes[1].id
  return { servicio, idLed, idPulsador }
}

test("proyectarVista real: pulsador sin pin -> sinAsignar, con pin -> asignado, terminal gnd siempre rielFijo/GND", () => {
  const dir = nuevoDir("s2-render-vista-2")
  const { servicio, idPulsador } = prepararProyectoConLedYPulsador(dir, nuevoIdProyecto())

  let vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const pulsadorVista = vista.componentes.find((c) => c.id === idPulsador)
  assert.ok(pulsadorVista, "el pulsador está en la vista")
  assert.equal(pulsadorVista.tipo, "pulsador")
  assert.equal(pulsadorVista.elementoWokwi, "wokwi-pushbutton")
  assert.deepEqual(pulsadorVista.atributos, { color: "green" })
  assert.equal(pulsadorVista.terminales.senal.estado, "sinAsignar")
  assert.equal(pulsadorVista.terminales.gnd.estado, "rielFijo")
  assert.equal(pulsadorVista.terminales.gnd.destino, "GND")

  const r = servicio.aplicar(op("AsignarPin", { componente: idPulsador, terminal: "senal", pin: GPIO_X === "GPIO4" ? "GPIO16" : "GPIO4" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const pulsadorVista2 = vista.componentes.find((c) => c.id === idPulsador)
  assert.equal(pulsadorVista2.terminales.senal.estado, "asignado")
  assert.equal(pulsadorVista2.terminales.senal.nombreWokwiPlaca, "RX2", "GPIO16 -> RX2 (wokwi-render-datos.ts::ESP32_WOKWI_PIN)")

  const led = vista.componentes.find((c) => c.tipo === "led")
  assert.equal(led.elementoWokwi, "wokwi-led", "el LED no cambia por agregar el pulsador")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3. planDePintado: incluye la instrucción crearElemento del pulsador
// ════════════════════════════════════════════════════════════════════════════════════

test("planDePintado incluye una instruccion crearElemento para el pulsador, tag wokwi-pushbutton, color green", () => {
  const dir = nuevoDir("s2-render-plan")
  const { servicio, idPulsador } = prepararProyectoConLedYPulsador(dir, nuevoIdProyecto())
  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const instrucciones = planDePintado(vista)
  const crearPulsador = instrucciones.find((i) => i.tipo === "crearElemento" && i.entidad.id === idPulsador)
  assert.ok(crearPulsador, "hay una instruccion crearElemento para el pulsador")
  assert.equal(crearPulsador.tag, "wokwi-pushbutton")
  assert.equal(crearPulsador.atributos.color, "green")

  const crearLed = instrucciones.find((i) => i.tipo === "crearElemento" && i.tag === "wokwi-led")
  assert.ok(crearLed, "el LED sigue apareciendo, sin cambios")
})
