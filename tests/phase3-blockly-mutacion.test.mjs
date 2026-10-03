// Phase 3 — Vertical #2, T4 (mutación) y T5 (quitar): la vista lógica comparte EL MISMO controlador
// que la frase (`crearControladorReglas`). Un cambio de campo = UN SetComportamiento armado por
// `construirOperacionRegla` con la `baseRevision` del último snapshot; a lo sumo una operación en
// vuelo; mientras hay una pendiente, los campos se pintan deshabilitados. Transporte FALSO aquí
// (puro); el recorrido contra el Engine real está en phase3-blockly-convergencia.test.mjs.

import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, op, catalogo, prepararProyectoConLed, obtenerServicioDeProyecto, GPIO_Y } from "./phase2-helpers.mjs"
import { fabricarBlockly } from "./phase3-blockly-fake.mjs"

const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { crearControladorReglas } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))
const RUTA_UI = join(REPO, "opencode/vista-fisica/web/vista-logica-ui.js")
const cargarUI = async () => (await import(RUTA_UI)).crearVistaLogica

const CONDICION = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }

function preparar() {
  const directorio = nuevoDir("p3-bl-mut")
  const idProyecto = nuevoIdProyecto("p3-bl-mut")
  const { servicio, idComponente: led } = prepararProyectoConLed(directorio, idProyecto)
  let r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const pulsador = servicio.snapshot().proyecto.componentes.find((c) => c.tipo === "pulsador").id
  r = servicio.aplicar(op("AsignarPin", { componente: pulsador, terminal: "senal", pin: GPIO_Y }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  return { servicio, led, pulsador, directorio, idProyecto }
}
const set = (c, comportamiento) => {
  const r = c.servicio.aplicar(op("SetComportamiento", { comportamiento }, c.servicio.snapshot().revision))
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
}
const snapshotDe = (c) => ({ revision: c.servicio.snapshot().revision, vista: proyectarVista(c.servicio.snapshot().proyecto, catalogo) })

/** Cablea controlador + vista lógica como lo hace la página, con transporte falso. */
async function montar(c, { respuesta } = {}) {
  const crearVistaLogica = await cargarUI()
  const { Blockly, reg } = fabricarBlockly()
  const enviadas = []
  const pendientes = []
  const estado = { snapshot: snapshotDe(c) }
  let vista
  const controlador = crearControladorReglas({
    obtenerSnapshot: () => estado.snapshot,
    enviar: (o) => {
      enviadas.push(o)
      return respuesta ? respuesta(o) : new Promise((resolver) => pendientes.push(resolver))
    },
    alCambiar: () => vista?.repintar(estado.snapshot, { deshabilitado: controlador.opciones().operacionPendiente }),
  })
  vista = crearVistaLogica({ Blockly, contenedor: {}, controlador })
  vista.repintar(estado.snapshot, { deshabilitado: false })
  const campo = (slot) => reg.ws.bloques.map((b) => b.campos[slot]).find(Boolean)
  return { vista, controlador, enviadas, pendientes, estado, reg, campo }
}
const settle = () => new Promise((r) => setImmediate(r))

test("T4 un cambio de campo = UNA SetComportamiento con la regla entera, su id y la baseRevision del último snapshot", async () => {
  const c = preparar()
  set(c, { cuando: { sensor: c.pulsador } })
  const m = await montar(c)
  const reglaId = m.estado.snapshot.vista.reglas[0].id
  m.campo("estado").setValue("presionado")
  await settle()
  assert.equal(m.enviadas.length, 1)
  assert.deepEqual(m.enviadas[0], {
    tipo: "SetComportamiento",
    payload: { comportamiento: { id: reglaId, cuando: { sensor: c.pulsador, ...CONDICION } } },
    baseRevision: m.estado.snapshot.revision,
  })
  c.servicio.cerrar()
})

test("T4 la primera selección sobre la regla vacía manda SOLO ese slot y ningún id (la regla nace con el primer campo)", async () => {
  const c = preparar()
  const m = await montar(c)
  m.campo("sensor").setValue(c.pulsador)
  await settle()
  assert.deepEqual(m.enviadas.map((o) => o.payload), [{ comportamiento: { cuando: { sensor: c.pulsador } } }])
  assert.equal(m.enviadas[0].baseRevision, m.estado.snapshot.revision)
  c.servicio.cerrar()
})

test("T4 con una operación pendiente: los campos se pintan DESHABILITADOS y un segundo cambio no manda otra operación", async () => {
  const c = preparar()
  const m = await montar(c)
  m.campo("sensor").setValue(c.pulsador)
  await settle()
  for (const s of ["sensor", "estado", "actuador", "salida"]) assert.equal(m.campo(s).habilitado, false, s)
  m.campo("actuador").setValue(c.led)
  await settle()
  assert.equal(m.enviadas.length, 1, "a lo sumo UNA operación en vuelo")
  // la respuesta llega: se rehabilitan
  m.pendientes[0]({ resultado: { ok: true } })
  await settle()
  for (const s of ["sensor", "estado", "actuador", "salida"]) assert.equal(m.campo(s).habilitado, true, s)
  c.servicio.cerrar()
})

test("T4 una operación EXTERNA en vuelo (ej. un GPIO) también bloquea la vista lógica", async () => {
  const c = preparar()
  const m = await montar(c)
  m.controlador.marcarOperacionExterna(true)
  m.vista.repintar(m.estado.snapshot, { deshabilitado: m.controlador.opciones().operacionPendiente })
  assert.equal(m.campo("sensor").habilitado, false)
  m.campo("sensor").setValue(c.pulsador)
  await settle()
  assert.equal(m.enviadas.length, 0)
  c.servicio.cerrar()
})

test("T4 elegir el centinela no manda nada y el campo vuelve al valor del snapshot (gana el snapshot)", async () => {
  const c = preparar()
  set(c, { cuando: { sensor: c.pulsador } })
  const m = await montar(c)
  const f = m.campo("sensor")
  f.setValue(f.opciones[0][1])
  await settle()
  assert.equal(m.enviadas.length, 0)
  assert.equal(f.getValue(), c.pulsador)
  c.servicio.cerrar()
})

test("T4 pintar desde el snapshot no manda operaciones (sin bucle de realimentación)", async () => {
  const c = preparar()
  const m = await montar(c)
  set(c, { cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.led, accion: "encender" } })
  m.estado.snapshot = snapshotDe(c)
  m.vista.repintar(m.estado.snapshot, { deshabilitado: false })
  await settle()
  assert.equal(m.enviadas.length, 0)
  assert.equal(m.campo("estado").getValue(), "presionado")
  c.servicio.cerrar()
})

test("T5 quitar: QuitarComportamiento {comportamiento: reglaId} con la baseRevision del snapshot; sin regla en la IR no manda nada", async () => {
  const c = preparar()
  const vacio = await montar(c)
  vacio.vista.quitar()
  await settle()
  assert.equal(vacio.enviadas.length, 0)
  set(c, { cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.led, accion: "encender" } })
  const m = await montar(c)
  m.vista.quitar()
  await settle()
  assert.deepEqual(m.enviadas, [{ tipo: "QuitarComportamiento", payload: { comportamiento: m.estado.snapshot.vista.reglas[0].id }, baseRevision: m.estado.snapshot.revision }])
  c.servicio.cerrar()
})

test("T5 contra el Engine real: quitar deja la regla ausente y, tras recargar desde disco, también", async () => {
  const c = preparar()
  set(c, { cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.led, accion: "encender" } })
  const m = await montar(c, {
    respuesta: async (o) => {
      const r = c.servicio.aplicar({ ...op(o.tipo, o.payload, o.baseRevision) })
      m.estado.snapshot = snapshotDe(c)
      return { resultado: r }
    },
  })
  const antes = c.servicio.snapshot().revision
  m.vista.quitar()
  await settle()
  const snap = c.servicio.snapshot()
  assert.equal(snap.revision, antes + 1)
  assert.deepEqual(snap.proyecto.comportamientos, [])
  assert.equal(m.estado.snapshot.vista.reglas.length, 0)
  assert.equal(m.campo("sensor").getValue(), m.campo("sensor").opciones[0][1], "la vista queda con la regla vacía (centinelas)")
  c.servicio.cerrar()
  const recargado = obtenerServicioDeProyecto({ directorio: c.directorio, idProyecto: c.idProyecto })
  assert.deepEqual(recargado.snapshot().proyecto.comportamientos, [], "ausente también tras recargar desde el Almacén")
  recargado.cerrar()
})
