// Phase 3 — Vertical #2, T1: la PROYECCIÓN PURA IR(snapshot.vista) -> modelo de vista lógica
// (contrato §3). Sin navegador ni Blockly: sólo datos. Las etiquetas y opciones salen del
// servidor (la misma `opcionesRegla.slots` / `reglas[i].frase` que usa la frase editable).

import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, op, catalogo, prepararProyectoConLed, GPIO_Y } from "./phase2-helpers.mjs"

const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const RUTA = join(REPO, "opencode/vista-fisica/web/vista-logica.js")
const cargar = async () => (await import(RUTA)).proyectarModeloLogico

const CONDICION = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }

function preparar() {
  const { servicio, idComponente: led } = prepararProyectoConLed(nuevoDir("p3-bl-modelo"), nuevoIdProyecto("p3-bl-modelo"))
  let r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const pulsador = servicio.snapshot().proyecto.componentes.find((c) => c.tipo === "pulsador").id
  r = servicio.aplicar(op("AsignarPin", { componente: pulsador, terminal: "senal", pin: GPIO_Y }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  return { servicio, led, pulsador }
}
const set = (c, comportamiento) => {
  const r = c.servicio.aplicar(op("SetComportamiento", { comportamiento }, c.servicio.snapshot().revision))
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
}
const vistaDe = (c) => proyectarVista(c.servicio.snapshot().proyecto, catalogo)
const CANONICA = (c) => ({ cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.led, accion: "encender" } })

function congelar(x) {
  if (x && typeof x === "object" && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x)) congelar(v) }
  return x
}
/** Todas las cadenas del modelo, salvo las de las claves `valor`/`id`/`reglaId` (ids internos sólo como dato). */
function cadenas(x, clave = "", acc = []) {
  if (typeof x === "string") { if (!["valor", "id", "reglaId"].includes(clave)) acc.push(x) }
  else if (Array.isArray(x)) for (const v of x) cadenas(v, clave, acc)
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) cadenas(v, k, acc)
  return acc
}

test("T1 sin reglas: una regla vacía (id null) con los cuatro campos del servidor, en orden, sin valor", async () => {
  const proyectar = await cargar()
  const c = preparar()
  const m = proyectar(vistaDe(c))
  assert.equal(m.hayVarias, false)
  assert.equal(m.regla.id, null)
  assert.deepEqual(m.regla.campos.map((f) => f.slot), ["sensor", "estado", "actuador", "salida"])
  assert.deepEqual(m.regla.campos.map((f) => f.prefijo), ["Mientras el", "esté", ", el", "está"])
  assert.deepEqual(m.regla.campos.map((f) => f.valor), [null, null, null, null])
  assert.deepEqual(m.regla.campos.map((f) => f.etiquetaActual), [null, null, null, null])
  assert.equal(m.regla.completa, false)
  assert.equal(m.regla.avanzada, false)
  assert.equal(m.regla.aviso, null)
  assert.deepEqual(m.regla.motivos, [])
  c.servicio.cerrar()
})

test("T1 regla canónica: valores y etiquetas actuales salen de la frase del servidor", async () => {
  const proyectar = await cargar()
  const c = preparar()
  set(c, CANONICA(c))
  const v = vistaDe(c)
  const m = proyectar(v)
  assert.equal(m.regla.id, v.reglas[0].id)
  assert.deepEqual(m.regla.campos.map((f) => f.valor), [c.pulsador, "presionado", c.led, "encendido"])
  assert.deepEqual(m.regla.campos.map((f) => f.etiquetaActual), ["Pulsador", "presionado", "LED", "encendido"])
  assert.equal(m.regla.completa, true)
  assert.deepEqual(m.regla.faltan, [])
  assert.equal(m.regla.avanzada, false)
  assert.equal(m.regla.aviso, null)
  assert.deepEqual(m.regla.motivos, [])
  c.servicio.cerrar()
})

test("T1 regla incompleta: valores nulos para lo que falta (sin autocompletar), faltan y motivos en texto llano", async () => {
  const proyectar = await cargar()
  const c = preparar()
  set(c, { cuando: { sensor: c.pulsador } })
  const m = proyectar(vistaDe(c))
  assert.deepEqual(m.regla.campos.map((f) => f.valor), [c.pulsador, null, null, null])
  assert.deepEqual(m.regla.campos.map((f) => f.etiquetaActual), ["Pulsador", null, null, null])
  assert.equal(m.regla.completa, false)
  assert.deepEqual(m.regla.faltan, ["estado", "actuador", "salida"])
  assert.deepEqual(m.regla.motivos, ["A la regla le falta: qué estado de la entrada, qué salida y qué hace la salida."])
  c.servicio.cerrar()
})

test("T1 condición avanzada: avanzada:true, el campo de estado muestra la etiqueta del servidor y hay aviso", async () => {
  const proyectar = await cargar()
  const c = preparar()
  set(c, { cuando: { sensor: c.pulsador, ...CONDICION, comparador: ">" }, entonces: { actuador: c.led, accion: "encender" } })
  const m = proyectar(vistaDe(c))
  assert.equal(m.regla.avanzada, true)
  const estado = m.regla.campos[1]
  assert.equal(estado.etiquetaActual, "condición avanzada")
  assert.notEqual(estado.valor, null)
  assert.ok(!estado.opciones.some((o) => o.valor === estado.valor), "la opción 'avanzada' no se ofrece: sólo se muestra")
  assert.equal(m.regla.aviso, vistaDe(c).reglas[0].aviso)
  assert.match(m.regla.aviso, /condición avanzada/)
  c.servicio.cerrar()
})

test("T1 regla inválida (pulsador como salida): el motivo llano del servidor viaja; el valor no está entre las opciones", async () => {
  const proyectar = await cargar()
  const c = preparar()
  set(c, { cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.pulsador, accion: "encender" } })
  const v = vistaDe(c)
  const m = proyectar(v)
  const esperados = v.reglas[0].motivos.map((x) => x.explicacion).filter((t) => typeof t === "string" && t !== "")
  assert.ok(esperados.length > 0)
  assert.deepEqual(m.regla.motivos, esperados)
  const actuador = m.regla.campos[2]
  assert.equal(actuador.valor, c.pulsador)
  assert.deepEqual(actuador.opciones.map((o) => o.valor), [c.led])
  c.servicio.cerrar()
})

test("T1 varias reglas: hayVarias y se proyecta la primera (límite de UI = 1)", async () => {
  const proyectar = await cargar()
  const c = preparar()
  set(c, CANONICA(c))
  set(c, { cuando: { sensor: c.pulsador } })
  const v = vistaDe(c)
  const m = proyectar(v)
  assert.equal(m.hayVarias, true)
  assert.equal(m.regla.id, v.reglas[0].id)
  c.servicio.cerrar()
})

test("T1 sin opcionesRegla ni reglas: regla null, nada que pintar, sin crash", async () => {
  const proyectar = await cargar()
  assert.deepEqual(proyectar({}), { regla: null, hayVarias: false })
  assert.deepEqual(proyectar({ reglas: [], opcionesRegla: { slots: [] } }), { regla: null, hayVarias: false })
})

test("T1 pura y estable: misma entrada, misma salida; no muta la entrada; sin parche en las opciones", async () => {
  const proyectar = await cargar()
  const c = preparar()
  set(c, CANONICA(c))
  const v = congelar(JSON.parse(JSON.stringify(vistaDe(c))))
  const a = proyectar(v)
  const b = proyectar(v)
  assert.deepEqual(a, b)
  for (const f of a.regla.campos) for (const o of f.opciones) assert.deepEqual(Object.keys(o).sort(), ["etiqueta", "valor"])
  c.servicio.cerrar()
})

test("T1 guarda: ninguna cadena del modelo expone IR crudo (estadoBooleano, >=, umbral, ids, JSON, baseRevision, schemaVersion)", async () => {
  const proyectar = await cargar()
  const c = preparar()
  const casos = []
  casos.push(vistaDe(c))
  set(c, CANONICA(c)); casos.push(vistaDe(c))
  set(c, { cuando: { sensor: c.pulsador, ...CONDICION, comparador: ">" }, entonces: { actuador: c.led, accion: "encender" } }); casos.push(vistaDe(c))
  set(c, { cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.pulsador, accion: "encender" } }); casos.push(vistaDe(c))
  const PROHIBIDO = /estadoBooleano|>=|umbral|cmp-|beh-|baseRevision|schemaVersion|[{}]/
  for (const v of casos) for (const s of cadenas(proyectar(v))) assert.ok(!PROHIBIDO.test(s), `cadena con IR crudo: ${s}`)
  c.servicio.cerrar()
})

test("T1 guarda estática: el módulo no nombra slots ni clases y es puro (sin DOM, Blockly, red)", async () => {
  const { readFileSync } = await import("node:fs")
  const src = readFileSync(RUTA, "utf8")
  assert.ok(!/\bdocument\b|\bwindow\b|Blockly|fetch\(|XMLHttpRequest/.test(src))
  assert.ok(!/["'](sensor|actuador|estado|salida)["']/.test(src), "no se nombran slots literalmente")
})
