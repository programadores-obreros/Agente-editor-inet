// Phase 3 — Vertical #2, T9e (hallazgo MINOR del verificador independiente; contrato §5 "gana el snapshot"):
// si el envío FALLA (fetch lanza, respuesta que no es JSON), la vista no puede quedar mostrando un valor
// que no se guardó. El controlador (compartido con la frase) repinta desde el último snapshot autoritativo
// y la vista lógica avisa en lenguaje llano.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, op, catalogo, prepararProyectoConLed, GPIO_Y } from "./phase2-helpers.mjs"
import { fabricarBlockly } from "./phase3-blockly-fake.mjs"

const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { crearControladorReglas } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))
const MENSAJE = "No se pudo guardar el cambio. Volvé a intentar."

function preparar() {
  const { servicio, idComponente: led } = prepararProyectoConLed(nuevoDir("p3-bl-err"), nuevoIdProyecto("p3-bl-err"))
  let r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const pulsador = servicio.snapshot().proyecto.componentes.find((c) => c.tipo === "pulsador").id
  r = servicio.aplicar(op("AsignarPin", { componente: pulsador, terminal: "senal", pin: GPIO_Y }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  return { servicio, led, pulsador }
}
const snapshotDe = (c) => ({ revision: c.servicio.snapshot().revision, vista: proyectarVista(c.servicio.snapshot().proyecto, catalogo) })
const settle = () => new Promise((r) => setImmediate(r))
const elemento = () => ({ textContent: "", disabled: false, addEventListener() {} })

async function montar(c, enviar) {
  const { crearPanelVistaLogica } = await import(join(REPO, "opencode/vista-fisica/web/vista-logica-ui.js"))
  const { Blockly, reg } = fabricarBlockly()
  const el = { texto: elemento(), estado: elemento(), quitar: elemento() }
  const estado = { snapshot: snapshotDe(c), cambios: 0 }
  let panel
  const controlador = crearControladorReglas({
    obtenerSnapshot: () => estado.snapshot,
    enviar,
    alCambiar: () => { estado.cambios++; panel?.repintar(estado.snapshot, { deshabilitado: controlador.opciones().operacionPendiente }) },
  })
  panel = crearPanelVistaLogica({ Blockly, lienzo: {}, elementoTexto: el.texto, elementoEstado: el.estado, botonQuitar: el.quitar, controlador })
  panel.repintar(estado.snapshot, { deshabilitado: false })
  const campo = (slot) => reg.ws.bloques.map((b) => b.campos[slot]).find(Boolean)
  return { panel, controlador, el, estado, campo }
}

test("T9e controlador: si enviar RECHAZA, limpia 'pendiente', repinta desde el snapshot (alCambiar) y el error llega a quien llamó", async () => {
  const c = preparar()
  let repintados = 0
  const controlador = crearControladorReglas({ obtenerSnapshot: () => snapshotDe(c), enviar: async () => { throw new Error("red caída") }, alCambiar: () => { repintados++ } })
  await assert.rejects(controlador.cambiar({ reglaId: null, slot: "sensor", valor: c.pulsador }), /red caída/)
  assert.equal(controlador.opciones().operacionPendiente, false)
  assert.equal(repintados, 2, "una al empezar (pendiente) y otra al fallar (snapshot autoritativo)")
  await assert.rejects(controlador.quitar({ reglaId: "beh-0" }), /red caída/)
  assert.equal(repintados, 4)
  c.servicio.cerrar()
})

test("T9e vista lógica: tras un envío fallido el campo vuelve al valor del snapshot y el panel avisa en lenguaje llano", async () => {
  const c = preparar()
  const m = await montar(c, async () => { throw new TypeError("Failed to fetch") })
  const sentinela = m.campo("sensor").opciones[0][1]
  m.campo("sensor").setValue(c.pulsador)
  await settle()
  assert.equal(m.campo("sensor").getValue(), sentinela, "no queda el valor que no se guardó")
  assert.equal(m.el.estado.textContent, MENSAJE)
  assert.ok(!/TypeError|Failed to fetch/.test(m.el.estado.textContent), "sin texto crudo del error")
  assert.equal(m.campo("sensor").habilitado, true)
  c.servicio.cerrar()
})

test("T9e vista lógica: un cambio ignorado por el controlador (ocupado) tampoco deja el valor intentado pintado", async () => {
  const c = preparar()
  const m = await montar(c, async () => ({ resultado: { ok: true } }))
  m.controlador.marcarOperacionExterna(true)
  const sentinela = m.campo("sensor").opciones[0][1]
  m.campo("sensor").setValue(c.pulsador) // (en el Blockly real el campo está deshabilitado; acá se fuerza)
  await settle()
  assert.equal(m.campo("sensor").getValue(), sentinela)
  c.servicio.cerrar()
})

test("T9e la frase: app.js avisa con el mismo mensaje cuando falla un cambio o un quitar de la frase", () => {
  const app = readFileSync(join(REPO, "opencode/vista-fisica/web/app.js"), "utf8")
  assert.match(app, /MENSAJE_NO_SE_PUDO_GUARDAR/)
  assert.match(app, /\.catch\(/)
  assert.ok(readFileSync(join(REPO, "opencode/vista-fisica/web/vista-logica-ui.js"), "utf8").includes(MENSAJE), "el texto vive en un solo lugar")
})
