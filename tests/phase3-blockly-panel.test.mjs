// Phase 3 — Vertical #2, T9: integración en la página. Sección "Vista lógica" junto a "Reglas", con su
// contenedor de Blockly creado UNA vez y excluido del `replaceChildren` general de `repintar()`; botón
// "Quitar regla" y textos llanos (motivos / aviso / estado del servidor) al lado, sin depender del color.
// Se prueba con documento y Blockly FALSOS, y el controlador real de la frase.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, op, catalogo, prepararProyectoConLed, GPIO_Y } from "./phase2-helpers.mjs"
import { fabricarBlockly } from "./phase3-blockly-fake.mjs"

const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { crearControladorReglas } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))
const cargarPanel = async () => (await import(join(REPO, "opencode/vista-fisica/web/vista-logica-ui.js"))).crearPanelVistaLogica

const CONDICION = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }

function elemento() {
  return { atributos: {}, textContent: "", disabled: false, hidden: false, _l: {}, addEventListener(t, f) { (this._l[t] ??= []).push(f) }, disparar(t) { for (const f of this._l[t] ?? []) f() }, setAttribute(n, v) { this.atributos[n] = String(v) } }
}
function preparar() {
  const { servicio, idComponente: led } = prepararProyectoConLed(nuevoDir("p3-bl-panel"), nuevoIdProyecto("p3-bl-panel"))
  let r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const pulsador = servicio.snapshot().proyecto.componentes.find((c) => c.tipo === "pulsador").id
  r = servicio.aplicar(op("AsignarPin", { componente: pulsador, terminal: "senal", pin: GPIO_Y }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  return { servicio, led, pulsador }
}
const set = (c, comportamiento) => assert.equal(c.servicio.aplicar(op("SetComportamiento", { comportamiento }, c.servicio.snapshot().revision)).ok, true)
const snapshotDe = (c) => ({ revision: c.servicio.snapshot().revision, vista: proyectarVista(c.servicio.snapshot().proyecto, catalogo) })
const settle = () => new Promise((r) => setImmediate(r))

async function montar(c, { conBlockly = true } = {}) {
  const crearPanel = await cargarPanel()
  const { Blockly, reg } = fabricarBlockly()
  const el = { lienzo: elemento(), texto: elemento(), estado: elemento(), quitar: elemento() }
  const enviadas = []
  const estado = { snapshot: snapshotDe(c) }
  let panel
  const controlador = crearControladorReglas({
    obtenerSnapshot: () => estado.snapshot,
    enviar: (o) => { enviadas.push(o); return new Promise(() => {}) },
    alCambiar: () => panel.repintar(estado.snapshot, { deshabilitado: controlador.opciones().operacionPendiente }),
  })
  panel = crearPanel({ Blockly: conBlockly ? Blockly : undefined, lienzo: el.lienzo, elementoTexto: el.texto, elementoEstado: el.estado, botonQuitar: el.quitar, controlador })
  const campo = (slot) => reg.ws?.bloques.map((b) => b.campos[slot]).find(Boolean)
  return { panel, el, reg, enviadas, estado, controlador, campo }
}

test("T9 sin Blockly (asset ausente): mensaje llano, botón deshabilitado, repintar no rompe y la frase sigue funcionando", async () => {
  const c = preparar()
  const m = await montar(c, { conBlockly: false })
  m.panel.repintar(m.estado.snapshot, { deshabilitado: false })
  assert.match(m.el.texto.textContent, /vista lógica no está disponible/i)
  assert.match(m.el.texto.textContent, /frase/i)
  assert.equal(m.el.quitar.disabled, true)
  assert.equal(m.reg.inyecciones.length, 0)
  c.servicio.cerrar()
})

test("T9 el contenedor de Blockly se inyecta UNA sola vez (el mismo elemento) aunque haya muchos repintados", async () => {
  const c = preparar()
  const m = await montar(c)
  assert.equal(m.reg.inyecciones.length, 0, "perezoso: nada hasta el primer snapshot")
  for (let i = 0; i < 4; i++) m.panel.repintar(m.estado.snapshot, { deshabilitado: false })
  assert.equal(m.reg.inyecciones.length, 1)
  assert.equal(m.reg.inyecciones[0].contenedor, m.el.lienzo)
  assert.equal(m.reg.inyecciones[0].opciones.sounds, false)
  c.servicio.cerrar()
})

test("T9 un snapshot externo (otro actor) actualiza los campos; los campos reflejan SIEMPRE el snapshot", async () => {
  const c = preparar()
  const m = await montar(c)
  m.panel.repintar(m.estado.snapshot, { deshabilitado: false })
  assert.equal(m.campo("sensor").getValue(), m.campo("sensor").opciones[0][1])
  set(c, { cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.led, accion: "encender" } })
  m.estado.snapshot = snapshotDe(c)
  m.panel.repintar(m.estado.snapshot, { deshabilitado: false })
  assert.deepEqual(["sensor", "estado", "actuador", "salida"].map((s) => m.campo(s).getValue()), [c.pulsador, "presionado", c.led, "encendido"])
  assert.equal(m.enviadas.length, 0)
  c.servicio.cerrar()
})

test("T9 operación pendiente (o sin conexión): campos y botón deshabilitados", async () => {
  const c = preparar()
  set(c, { cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.led, accion: "encender" } })
  const m = await montar(c)
  m.panel.repintar(m.estado.snapshot, { deshabilitado: false })
  assert.equal(m.el.quitar.disabled, false)
  m.el.quitar.disparar("click")
  await settle()
  assert.equal(m.enviadas.length, 1, "Quitar regla = UNA operación")
  assert.equal(m.enviadas[0].tipo, "QuitarComportamiento")
  assert.equal(m.el.quitar.disabled, true, "pendiente: botón deshabilitado")
  assert.equal(m.campo("sensor").habilitado, false)
  m.panel.repintar(m.estado.snapshot, { deshabilitado: true })
  assert.equal(m.campo("estado").habilitado, false)
  c.servicio.cerrar()
})

test("T9 sin regla en la IR: 'Quitar regla' deshabilitado", async () => {
  const c = preparar()
  const m = await montar(c)
  m.panel.repintar(m.estado.snapshot, { deshabilitado: false })
  assert.equal(m.el.quitar.disabled, true)
  c.servicio.cerrar()
})

const SIN_IR = /estadoBooleano|>=|umbral|cmp-|beh-|baseRevision|schemaVersion|[{}]/

test("T9 regla inválida: el motivo llano del servidor aparece junto al bloque, sin IR cruda", async () => {
  const c = preparar()
  set(c, { cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.pulsador, accion: "encender" } })
  const m = await montar(c)
  m.panel.repintar(m.estado.snapshot, { deshabilitado: false })
  const motivo = m.estado.snapshot.vista.reglas[0].motivos.map((x) => x.explicacion).find((t) => typeof t === "string" && t)
  assert.ok(motivo)
  assert.ok(m.el.texto.textContent.includes(motivo))
  assert.ok(!SIN_IR.test(m.el.texto.textContent))
  c.servicio.cerrar()
})

test("T9 condición avanzada: el aviso del servidor se muestra como texto (no sólo color)", async () => {
  const c = preparar()
  set(c, { cuando: { sensor: c.pulsador, ...CONDICION, comparador: ">" }, entonces: { actuador: c.led, accion: "encender" } })
  const m = await montar(c)
  m.panel.repintar(m.estado.snapshot, { deshabilitado: false })
  assert.ok(m.el.texto.textContent.includes(m.estado.snapshot.vista.reglas[0].aviso))
  assert.ok(!SIN_IR.test(m.el.texto.textContent))
  c.servicio.cerrar()
})

test("T9 varias reglas: se avisa que se muestra sólo la primera (Multi-Rule Safety: sin el aviso genérico de contradicciones)", async () => {
  const c = preparar()
  set(c, { cuando: { sensor: c.pulsador } })
  set(c, { entonces: { actuador: c.led, accion: "encender" } })
  const m = await montar(c)
  m.panel.repintar(m.estado.snapshot, { deshabilitado: false })
  assert.match(m.el.texto.textContent, /Se muestra la primera regla/)
  assert.doesNotMatch(m.el.texto.textContent, /no analiza si se contradicen/, "OPEN-7: el aviso genérico se retiró")
  c.servicio.cerrar()
})

test("T9 el texto de estado del servidor (rechazo / conflicto) se muestra tal cual y se limpia con null", async () => {
  const c = preparar()
  const m = await montar(c)
  m.panel.repintar(m.estado.snapshot, { deshabilitado: false })
  m.panel.mostrarEstado("otro cambio llegó primero — se actualizó a la revisión vigente")
  assert.equal(m.el.estado.textContent, "otro cambio llegó primero — se actualizó a la revisión vigente")
  m.panel.mostrarEstado(null)
  assert.equal(m.el.estado.textContent, "")
  c.servicio.cerrar()
})

test("T9 index.html: sección 'Vista lógica' con encabezado y etiqueta visibles, lienzo con alto propio y botón; sin CSS externo", () => {
  const html = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8")
  assert.match(html, /<h2>Vista lógica<\/h2>/)
  for (const id of ["vista-logica-lienzo", "vista-logica-texto", "vista-logica-estado", "vista-logica-quitar"]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(html, /Quitar regla/)
  assert.match(html, /min-height:\s*\d+px/)
  assert.ok(!/<link[^>]+stylesheet/i.test(html))
  // la sección es hermana de "Reglas" dentro de <main>
  assert.ok(html.indexOf("<h2>Reglas</h2>") < html.indexOf("<h2>Vista lógica</h2>"))
})

test("T9 app.js: el lienzo NO está entre los contenedores que repintar() reemplaza, y repintar() repinta el panel desde el snapshot", () => {
  const app = readFileSync(join(REPO, "opencode/vista-fisica/web/app.js"), "utf8")
  const bloque = /contenedores = \{[\s\S]*?\n  \}/.exec(app)[0]
  assert.ok(!/vista-logica/.test(bloque))
  assert.match(app, /crearPanelVistaLogica/)
  assert.match(app, /panelVistaLogica\??\.repintar\(/)
})

test("T9c index.html: el lienzo declara un alto DEFINITIVO en px (no sólo min-height), si no Blockly mide 0 y queda recortado", () => {
  const html = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8")
  const regla = /#vista-logica-lienzo\s*\{([^}]*)\}/.exec(html)[1]
  assert.match(regla, /(^|[;\s])height:\s*\d+px/)
})
