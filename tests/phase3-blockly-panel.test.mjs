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
import { hojasNoPermitidas } from "./ventana-helpers.mjs"

const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { crearControladorReglas } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))
const { construirRutasDeAssets } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
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

// HISTORIA (2026-11-24). Este test exigía el renglón "Se muestra la primera regla": fijaba el límite
// de una regla en los bloques. Con el límite levantado, lo que hay que ver es que estén los dos
// pares, que ya no se diga que falta alguna, y que el botón único no quite una regla al azar.
test("T9 varias reglas: un par de bloques por regla, sin aviso de 'se muestra la primera', y el botón único no quita ninguna", async () => {
  const c = preparar()
  set(c, { cuando: { sensor: c.pulsador } })
  set(c, { entonces: { actuador: c.led, accion: "encender" } })
  const m = await montar(c)
  m.panel.repintar(m.estado.snapshot, { deshabilitado: false })
  assert.equal(m.reg.mientras().length, 2, "dos reglas: dos pares")
  assert.doesNotMatch(m.el.texto.textContent, /Se muestra la primera regla/)
  assert.doesNotMatch(m.el.texto.textContent, /no analiza si se contradicen/, "OPEN-7: el aviso genérico se retiró")
  // 2026-11-26: decía «en la sección Reglas». Con el rediseño las frases quedaron bajo el subtítulo
  // «Con palabras», así que el texto cambió; que ese lugar exista en la página lo mide
  // tests/ventana-pagina.test.mjs. Acá sigue midiéndose lo de siempre: que el aviso aparezca.
  assert.match(m.el.texto.textContent, /para quitar una, usá su botón «Quitar regla», arriba, en «Con palabras»/)
  assert.equal(m.el.quitar.disabled, true, "con dos reglas no hay 'la' regla que quitar")
  m.el.quitar.disparar("click")
  assert.deepEqual(m.enviadas, [], "y aunque le lleguen un click, no manda nada")
  c.servicio.cerrar()
})

test("T9 varias reglas: el motivo de una regla dice de cuál es (por su lugar en el lienzo)", async () => {
  const c = preparar()
  set(c, { cuando: { sensor: c.pulsador } })
  set(c, { cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.pulsador, accion: "encender" } })
  const m = await montar(c)
  m.panel.repintar(m.estado.snapshot, { deshabilitado: false })
  const motivo = m.estado.snapshot.vista.reglas[1].motivos.map((x) => x.explicacion).find((t) => typeof t === "string" && t)
  assert.ok(motivo, "el caso necesita un motivo en la SEGUNDA regla")
  assert.ok(m.el.texto.textContent.split("\n").includes(`Regla 2: ${motivo}`), m.el.texto.textContent)
  assert.ok(!SIN_IR.test(m.el.texto.textContent))
  c.servicio.cerrar()
})

test("T9 una sola regla: los textos van sin 'Regla N:' y el botón la quita", async () => {
  const c = preparar()
  set(c, { cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.pulsador, accion: "encender" } })
  const m = await montar(c)
  m.panel.repintar(m.estado.snapshot, { deshabilitado: false })
  assert.doesNotMatch(m.el.texto.textContent, /Regla \d+:/)
  assert.doesNotMatch(m.el.texto.textContent, /Hay más de una regla/)
  assert.equal(m.el.quitar.disabled, false)
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

// REESCRITO EL 2026-11-26 (rediseño de la ventana). Buscaba el título literal `<h2>Vista lógica</h2>`
// y la frase «Son las mismas reglas de arriba». En el diseño nuevo los bloques dejaron de ser una
// sección aparte: son la segunda mitad del paso «Decidí qué hace», bajo el subtítulo «Con bloques»,
// y el texto fijo dice «Un par … por cada regla». Lo que la prueba custodiaba se conserva, punto por
// punto: encabezado y etiqueta visibles; los cuatro elementos que usa el panel; el botón; que el
// texto fijo no prometa UNA sola regla (puede haber varias); un alto propio para el lienzo; nada de
// CSS de afuera; y que los bloques vengan después de las frases.
test("T9 index.html: los bloques tienen encabezado y etiqueta visibles, lienzo con alto propio y botón; sin CSS externo", () => {
  const html = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "")
  const bloques = /<div id="vista-logica">([\s\S]*?)<\/div>\s*<\/section>/.exec(html)
  assert.ok(bloques, "la página no tiene el contenedor de los bloques")
  assert.match(bloques[1], /<h3\b[^>]*>Con bloques<\/h3>/)
  for (const id of ["vista-logica-lienzo", "vista-logica-texto", "vista-logica-estado", "vista-logica-quitar"]) assert.match(bloques[1], new RegExp(`id="${id}"`))
  assert.match(bloques[1], /<button\b[^>]*id="vista-logica-quitar"[^>]*>Quitar regla<\/button>/)
  const etiqueta = /<p id="vista-logica-etiqueta">([^<]*)<\/p>/.exec(bloques[1])
  assert.ok(etiqueta, "falta el texto fijo de los bloques")
  assert.match(etiqueta[1], /por cada regla/, "el texto fijo ya no promete 'la misma regla': puede haber varias")
  assert.doesNotMatch(html, /Es la misma regla de arriba/)
  assert.match(html, /min-height:\s*\d+px/)
  // CAMBIADO A PROPÓSITO EL 2026-11-26. Acá decía `assert.ok(!/<link[^>]+stylesheet/i.test(html))`:
  // «sin CSS externo» se había escrito como «ningún <link>». Lo que esa línea cuidaba era que la
  // página no dependa de nada de AFUERA (un CDN, otra máquina): tiene que andar sin internet y con
  // la política de seguridad cerrada. Eso sigue en pie. Lo que cambió es que la ventana ahora usa
  // la hoja compartida de Tecnia Bot, servida por ESTE MISMO servidor: un <link> de mismo origen y
  // dentro de la lista blanca no es CSS externo. Se permite sólo eso; cualquier otra hoja (otra
  // máquina, una ruta fuera de /assets/, un nombre que el servidor no sirve, un @import) se marca.
  // El buscador se prueba contra páginas con el defecto en tests/ventana-hoja.test.mjs.
  assert.deepEqual(hojasNoPermitidas(html, [...construirRutasDeAssets().keys()]), [], "la página carga una hoja de estilos que no es de este servidor")
  // los bloques van después de las frases («Con palabras»), en el mismo paso
  assert.ok(html.indexOf('id="reglas"') !== -1 && html.indexOf('id="reglas"') < html.indexOf('id="vista-logica-lienzo"'))
  assert.ok(html.indexOf(">Con palabras<") < html.indexOf(">Con bloques<"))
})

test("T9 app.js: el lienzo NO está entre los contenedores que repintar() reemplaza, y repintar() repinta el panel desde el snapshot", () => {
  const app = readFileSync(join(REPO, "opencode/vista-fisica/web/app.js"), "utf8")
  const bloque = /contenedores = \{[\s\S]*?\n  \}/.exec(app)[0]
  assert.ok(!/vista-logica/.test(bloque))
  assert.match(app, /crearPanelVistaLogica/)
  assert.match(app, /panelVistaLogica\??\.repintar\(/)
})

test("T9c index.html: el lienzo declara un alto DEFINITIVO en px (no sólo min-height), si no Blockly mide 0 y queda recortado", () => {
  // 2026-11-26: tomaba la PRIMERA regla de CSS cuyo texto terminara en `#vista-logica-lienzo {`.
  // En la página nueva la primera es la que deja el lienzo en claro en los dos temas (comparte
  // selector con el esquema) y no habla del alto. Ahora se juntan TODAS las reglas que tienen al
  // lienzo como selector: la intención es la misma, que en alguna haya un `height` en px.
  const html = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  const reglas = [...html.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").some((s) => s.trim() === "#vista-logica-lienzo")).map((m) => m[2])
  assert.ok(reglas.length >= 1, "ninguna regla de CSS tiene al lienzo como selector")
  assert.match(reglas.join(";"), /(^|[;\s])height:\s*\d+px/)
})
