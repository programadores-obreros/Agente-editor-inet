// Phase 3 — Vertical #2, T3: el ADAPTADOR de Blockly (contrato §3/§5), probado con una API de
// Blockly FALSA e inyectada (mismos nombres de método que la API real 13.3.0: inject,
// defineBlocksWithJsonArray, Blocks, FieldDropdown, FieldLabel, Events.disable/enable/isEnabled/
// BLOCK_CHANGE; workspace.newBlock/addChangeListener/removeChangeListener/clear/dispose; block.
// getInput().appendField/connection, previousConnection.connect, setFieldValue/getFieldValue,
// setDeletable/setMovable, initSvg/render). El adaptador nunca importa ni lee Blockly global.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"
import { fabricarBlockly } from "./phase3-blockly-fake.mjs"

const RUTA = join(REPO, "opencode/vista-fisica/web/adaptador-blockly.js")
const cargar = async () => (await import(RUTA)).crearAdaptadorBlockly

// ── modelos de entrada (forma del modelo lógico de T1) ────────────────────────────────
const OPC = {
  entrada: [{ valor: "cmp-1", etiqueta: "Pulsador" }],
  estado: [{ valor: "presionado", etiqueta: "presionado" }],
  salida: [{ valor: "cmp-0", etiqueta: "LED" }],
  accion: [{ valor: "encendido", etiqueta: "encendido" }],
}
const campos = (valores, etiquetas = valores.map(() => null)) => [
  { slot: "s0", prefijo: "Mientras el", valor: valores[0], etiquetaActual: etiquetas[0], opciones: OPC.entrada },
  { slot: "s1", prefijo: "esté", valor: valores[1], etiquetaActual: etiquetas[1], opciones: OPC.estado },
  { slot: "s2", prefijo: ", el", valor: valores[2], etiquetaActual: etiquetas[2], opciones: OPC.salida },
  { slot: "s3", prefijo: "está", valor: valores[3], etiquetaActual: etiquetas[3], opciones: OPC.accion },
]
const modelo = (valores, { id = "beh-0", etiquetas, aviso = null, avanzada = false, motivos = [] } = {}) => ({
  regla: { id, campos: campos(valores, etiquetas), completa: valores.every((v) => v !== null), faltan: [], avanzada, aviso, motivos },
  hayVarias: false,
})
const COMPLETO = ["cmp-1", "presionado", "cmp-0", "encendido"]
const VACIO = [null, null, null, null]

async function montar(opciones = {}) {
  const crear = await cargar()
  const { Blockly, reg } = fabricarBlockly()
  const llamadas = { editar: [], quitar: [] }
  const adaptador = crear({ Blockly, contenedor: { nombre: "div" }, alEditar: (x) => llamadas.editar.push(x), alQuitar: (x) => llamadas.quitar.push(x), ...opciones })
  return { adaptador, Blockly, reg, llamadas }
}
const campoDe = (reg, slot) => reg.ws.bloques.map((b) => b.campos[slot]).find(Boolean)
const valoresDe = (reg) => ["s0", "s1", "s2", "s3"].map((s) => campoDe(reg, s)?.getValue() ?? null)
const SENT = (campo) => campo.opciones[0][1]
const usuarioElige = (reg, slot, valor) => campoDe(reg, slot).setValue(valor)

// ── tests ──────────────────────────────────────────────────────────────────────────────

test("T3 el módulo no lee Blockly global: sin inyección explícita no hace nada", async () => {
  const crear = await cargar()
  assert.equal(typeof globalThis.Blockly, "undefined")
  assert.throws(() => crear({ contenedor: {}, alEditar() {}, alQuitar() {} }), /Blockly/)
})

test("T3 inyecta un workspace sin toolbox, sin sonidos, con medios locales, sin papelera ni zoom, editable", async () => {
  const { reg } = await montar()
  assert.equal(reg.inyecciones.length, 1)
  const { contenedor, opciones } = reg.inyecciones[0]
  assert.deepEqual(contenedor, { nombre: "div" })
  assert.equal(opciones.toolbox, undefined)
  assert.equal(opciones.sounds, false)
  assert.equal(opciones.media, "/assets/blockly/media/")
  assert.equal(opciones.readOnly, false)
  assert.equal(opciones.trashcan, false)
  assert.equal(opciones.zoom.controls, false)
  assert.equal(opciones.zoom.wheel, false)
})

test("T3 `media` configurable por quien llama (ruta local)", async () => {
  const { reg } = await montar({ media: "/otra/ruta/" })
  assert.equal(reg.inyecciones[0].opciones.media, "/otra/ruta/")
})

test("T3 define por JSON UN tipo contenedor y UN tipo de acción, una sola vez aunque haya dos adaptadores", async () => {
  const crear = await cargar()
  const { Blockly, reg } = fabricarBlockly()
  crear({ Blockly, contenedor: {}, alEditar() {}, alQuitar() {} })
  crear({ Blockly, contenedor: {}, alEditar() {}, alQuitar() {} })
  assert.deepEqual(reg.definiciones.map((d) => d.type).sort(), ["tecnia_hacer", "tecnia_mientras"])
  assert.equal(typeof reg.definiciones.find((d) => d.type === "tecnia_hacer").previousStatement, "object")
})

test("T3 pintar(modelo completo): contenedor con la acción encastrada y un dropdown por campo con su valor", async () => {
  const { adaptador, reg } = await montar()
  adaptador.pintar(modelo(COMPLETO, { etiquetas: ["Pulsador", "presionado", "LED", "encendido"] }))
  const [mientras] = reg.ws.getTopBlocks()
  assert.equal(mientras.type, "tecnia_mientras")
  assert.equal(mientras.hijo.type, "tecnia_hacer")
  assert.deepEqual(valoresDe(reg), COMPLETO)
  assert.deepEqual(reg.ws.bloques.map((b) => b.etiquetas), [["Mientras el", "esté"], ["el", "está"]])
  const f = campoDe(reg, "s0")
  assert.deepEqual(f.opciones.map((o) => o[1]).slice(1), ["cmp-1"])
  assert.deepEqual(f.opciones.map((o) => o[0]).slice(1), ["Pulsador"])
  assert.equal(reg.ws.bloques.every((b) => b.svg && b.renderizado), true)
})

test("T3 modelo incompleto: centinela '— elegí —' en los campos faltantes, sin crash", async () => {
  const { adaptador, reg } = await montar()
  adaptador.pintar(modelo(["cmp-1", null, null, null], { id: "beh-0" }))
  const f1 = campoDe(reg, "s1")
  assert.equal(f1.getValue(), SENT(f1))
  assert.equal(f1.opciones[0][0], "— elegí —")
  assert.equal(campoDe(reg, "s0").getValue(), "cmp-1")
  adaptador.pintar(modelo(VACIO, { id: null }))
  for (const s of ["s0", "s1", "s2", "s3"]) assert.equal(campoDe(reg, s).getValue(), SENT(campoDe(reg, s)))
})

test("T3 el centinela es el MISMO valor reservado en todos los campos y no coincide con ninguna opción del servidor", async () => {
  const { adaptador, reg } = await montar()
  adaptador.pintar(modelo(VACIO, { id: null }))
  const sentinelas = ["s0", "s1", "s2", "s3"].map((s) => SENT(campoDe(reg, s)))
  assert.equal(new Set(sentinelas).size, 1)
  for (const s of ["s0", "s1", "s2", "s3"]) assert.equal(campoDe(reg, s).opciones.slice(1).some((o) => o[1] === sentinelas[0]), false)
})

test("T3 condición avanzada: el campo muestra la etiqueta del servidor aunque no sea una opción ofrecida", async () => {
  const { adaptador, reg } = await montar()
  const m = modelo(["cmp-1", "avanzada", "cmp-0", "encendido"], { etiquetas: ["Pulsador", "condición avanzada", "LED", "encendido"], avanzada: true, aviso: "aviso del servidor" })
  adaptador.pintar(m)
  const f = campoDe(reg, "s1")
  assert.equal(f.getValue(), "avanzada")
  assert.ok(f.opciones.some((o) => o[0] === "condición avanzada" && o[1] === "avanzada"))
})

test("T3 destruir y recrear desde el mismo modelo da los mismos valores (sin estado oculto)", async () => {
  const m = modelo(COMPLETO, { etiquetas: ["Pulsador", "presionado", "LED", "encendido"] })
  const a = await montar()
  a.adaptador.pintar(m)
  const primero = valoresDe(a.reg)
  a.adaptador.destruir()
  const b = await montar()
  b.adaptador.pintar(m)
  assert.deepEqual(valoresDe(b.reg), primero)
  assert.equal(a.reg.disposes, 1)
})

test("T3 repintar con el workspace ya poblado: cambia valores sin acumular bloques; opciones nuevas reconstruyen", async () => {
  const { adaptador, reg } = await montar()
  adaptador.pintar(modelo(COMPLETO, { etiquetas: ["Pulsador", "presionado", "LED", "encendido"] }))
  const creados = reg.bloquesCreados
  adaptador.pintar(modelo(VACIO, { id: null }))
  assert.equal(reg.ws.bloques.length, 2)
  assert.equal(reg.bloquesCreados, creados, "misma estructura: sólo se actualizan los valores")
  assert.deepEqual(valoresDe(reg).map((v, i) => v === SENT(campoDe(reg, ["s0", "s1", "s2", "s3"][i]))), [true, true, true, true])
  const otro = modelo(COMPLETO, { etiquetas: ["Pulsador", "presionado", "LED", "encendido"] })
  otro.regla.campos[0].opciones = [{ valor: "cmp-9", etiqueta: "Otro" }, ...OPC.entrada]
  adaptador.pintar(otro)
  assert.equal(reg.ws.bloques.length, 2, "reconstruido, no duplicado")
  assert.equal(campoDe(reg, "s0").opciones.length, 3)
})

test("T3 pintar NO emite alEditar (eventos deshabilitados durante el pintado y rehabilitados después)", async () => {
  const { adaptador, reg, llamadas } = await montar()
  adaptador.pintar(modelo(COMPLETO, { etiquetas: ["Pulsador", "presionado", "LED", "encendido"] }))
  adaptador.pintar(modelo(VACIO, { id: null }))
  adaptador.pintar(modelo(["cmp-1", null, null, null]))
  assert.deepEqual(llamadas.editar, [])
  assert.equal(reg.nivelEventos, 0)
})

test("T3 si pintar falla a mitad, los eventos quedan rehabilitados (try/finally)", async () => {
  const { adaptador, reg } = await montar()
  reg.fallarNewBlock = true
  assert.throws(() => adaptador.pintar(modelo(COMPLETO, { etiquetas: ["Pulsador", "presionado", "LED", "encendido"] })), /falla simulada/)
  assert.equal(reg.nivelEventos, 0)
})

test("T3 un cambio del alumno en un campo llama a alEditar UNA vez con {reglaId, slot, valor}", async () => {
  const { adaptador, reg, llamadas } = await montar()
  adaptador.pintar(modelo(["cmp-1", null, null, null], { id: "beh-7" }))
  usuarioElige(reg, "s1", "presionado")
  assert.deepEqual(llamadas.editar, [{ reglaId: "beh-7", slot: "s1", valor: "presionado" }])
})

test("T3 regla aún sin id: el cambio se informa con reglaId null (la regla nace con el primer campo)", async () => {
  const { adaptador, reg, llamadas } = await montar()
  adaptador.pintar(modelo(VACIO, { id: null }))
  usuarioElige(reg, "s0", "cmp-1")
  assert.deepEqual(llamadas.editar, [{ reglaId: null, slot: "s0", valor: "cmp-1" }])
})

test("T3 elegir el centinela NO llama a alEditar", async () => {
  const { adaptador, reg, llamadas } = await montar()
  adaptador.pintar(modelo(COMPLETO, { etiquetas: ["Pulsador", "presionado", "LED", "encendido"] }))
  usuarioElige(reg, "s0", SENT(campoDe(reg, "s0")))
  assert.deepEqual(llamadas.editar, [])
})

test("T3 eventos de UI, de otros elementos y de otros tipos se ignoran", async () => {
  const { adaptador, reg, llamadas } = await montar()
  adaptador.pintar(modelo(["cmp-1", null, null, null]))
  const b = reg.ws.bloques[0]
  for (const e of [
    { type: "change", element: "field", name: "s1", newValue: "presionado", blockId: b.id, isUiEvent: true },
    { type: "change", element: "disabled", name: "s1", newValue: "presionado", blockId: b.id, isUiEvent: false },
    { type: "move", blockId: b.id, isUiEvent: false },
    { type: "ui", element: "selected", isUiEvent: true },
    { type: "change", element: "field", name: "no-existe", newValue: "x", blockId: b.id, isUiEvent: false },
  ]) for (const f of reg.ws.oyentes) f(e)
  assert.deepEqual(llamadas.editar, [])
})

test("T3 un 'cambio' al mismo valor que el modelo no genera operación", async () => {
  const { adaptador, reg, llamadas } = await montar()
  adaptador.pintar(modelo(COMPLETO, { etiquetas: ["Pulsador", "presionado", "LED", "encendido"] }))
  for (const f of reg.ws.oyentes) f({ type: "change", element: "field", name: "s0", newValue: "cmp-1", blockId: "b1", isUiEvent: false })
  assert.deepEqual(llamadas.editar, [])
})

test("T3 los bloques no son borrables ni movibles", async () => {
  const { adaptador, reg } = await montar()
  adaptador.pintar(modelo(COMPLETO, { etiquetas: ["Pulsador", "presionado", "LED", "encendido"] }))
  assert.equal(reg.ws.bloques.length, 2)
  for (const b of reg.ws.bloques) { assert.equal(b.deletable, false); assert.equal(b.movable, false) }
})

test("T3 opción `deshabilitado`: los campos quedan deshabilitados (operación pendiente) y se rehabilitan después", async () => {
  const { adaptador, reg } = await montar()
  adaptador.pintar(modelo(COMPLETO, { etiquetas: ["Pulsador", "presionado", "LED", "encendido"] }), { deshabilitado: true })
  assert.deepEqual(["s0", "s1", "s2", "s3"].map((s) => campoDe(reg, s).habilitado), [false, false, false, false])
  adaptador.pintar(modelo(COMPLETO, { etiquetas: ["Pulsador", "presionado", "LED", "encendido"] }), { deshabilitado: false })
  assert.deepEqual(["s0", "s1", "s2", "s3"].map((s) => campoDe(reg, s).habilitado), [true, true, true, true])
})

test("T3 quitar(): llama a alQuitar con el id de la regla; sin regla en la IR no hace nada", async () => {
  const { adaptador, llamadas } = await montar()
  adaptador.pintar(modelo(VACIO, { id: null }))
  adaptador.quitar()
  assert.deepEqual(llamadas.quitar, [])
  adaptador.pintar(modelo(COMPLETO, { id: "beh-3", etiquetas: ["Pulsador", "presionado", "LED", "encendido"] }))
  adaptador.quitar()
  assert.deepEqual(llamadas.quitar, [{ reglaId: "beh-3" }])
})

test("T3 pintar(modelo con regla null) vacía el workspace", async () => {
  const { adaptador, reg } = await montar()
  adaptador.pintar(modelo(COMPLETO, { etiquetas: ["Pulsador", "presionado", "LED", "encendido"] }))
  adaptador.pintar({ regla: null, hayVarias: false })
  assert.equal(reg.ws.bloques.length, 0)
})

test("T3 destruir(): libera el workspace y el oyente; después ignora eventos y pintados", async () => {
  const { adaptador, reg, llamadas } = await montar()
  adaptador.pintar(modelo(["cmp-1", null, null, null]))
  const oyente = reg.ws.oyentes[0]
  adaptador.destruir()
  assert.equal(reg.disposes, 1)
  assert.equal(reg.ws.oyentes.length, 0)
  oyente({ type: "change", element: "field", name: "s1", newValue: "presionado", blockId: "b1", isUiEvent: false })
  adaptador.pintar(modelo(COMPLETO))
  assert.deepEqual(llamadas.editar, [])
  adaptador.destruir()
  assert.equal(reg.disposes, 1, "idempotente")
})

test("T3 guarda: el módulo no usa serialización, XML, generadores ni lee Blockly global; sólo recibe la API inyectada", () => {
  const src = readFileSync(RUTA, "utf8")
  assert.ok(!/serialization|Xml\.|workspaceToCode|Generator|javascriptGenerator/.test(src))
  assert.ok(!/^\s*import\b[^\n]*[Bb]lockly/m.test(src), "no importa Blockly")
  assert.ok(!/globalThis\.Blockly|window\.Blockly|\bwindow\b|\bdocument\b/.test(src))
  assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(/.test(src), "nada se persiste")
})

test("T9b presentación: el texto fijo del servidor se muestra sin coma inicial y no se repite «mientras» como etiqueta estática", async () => {
  const { reg } = await montar()
  const def = reg.definiciones.find((d) => d.type === "tecnia_mientras")
  assert.ok(!/mientras/i.test(def.message0), "el «Mientras el» ya viene del servidor")
  const { adaptador, reg: reg2 } = await montar()
  adaptador.pintar(modelo(VACIO, { id: null }))
  assert.ok(reg2.ws.bloques.every((b) => b.etiquetas.every((t) => !/^[,\s]/.test(t))))
})

test("T9c Blockly necesita medir su contenedor: svgResize(workspace) tras inyectar y tras cada pintado", async () => {
  const { adaptador, reg } = await montar()
  assert.equal(reg.svgResizes.length, 1, "una vez tras inyectar")
  assert.equal(reg.svgResizes[0], reg.ws)
  adaptador.pintar(modelo(COMPLETO, { etiquetas: ["Pulsador", "presionado", "LED", "encendido"] }))
  assert.equal(reg.svgResizes.length, 2, "y de nuevo al pintar")
  assert.equal(reg.nivelEventos, 0)
})
