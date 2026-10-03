// Phase 3 — Vertical #2, T7: CONVERGENCIA e IDA Y VUELTA con el Engine, el Almacén y el servidor HTTP
// REALES. El mismo proyecto inicial se completa por tres caminos (agente por la tool, frase, vista
// lógica con Blockly falso) y la IR de la regla tiene que ser la misma salvo el id. Después: IR ->
// modelo lógico -> edición -> operación -> Engine -> IR' -> recarga desde disco -> modelo' == esperado,
// y ningún rastro de Blockly en lo persistido ("no hay una segunda verdad").
//
// Nota de proceso: T4–T6 ya dejan el comportamiento listo, así que estos tests nacen VERDES (prueba de
// contrato/regresión, no hay RED genuino para T7).

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { prepararServidor, cerrar, montarApp, REPO } from "./phase3-blockly-harness.mjs"
import { nuevoDir, nuevoIdProyecto, catalogo } from "./phase2-helpers.mjs"

const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const { directorioDeDatos } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { proyectarModeloLogico } = await import(join(REPO, "opencode/vista-fisica/web/vista-logica.js"))
const { fabricarBlockly } = await import("./phase3-blockly-fake.mjs")
const { crearAdaptadorBlockly } = await import(join(REPO, "opencode/vista-fisica/web/adaptador-blockly.js"))

const SLOTS = ["sensor", "estado", "actuador", "salida"]
const sinId = ({ id, ...resto }) => resto

/** Camino A: el agente, por la tool `proyecto-fisico`, con el ejemplo del vocabulario rellenado desde `leer`. */
async function reglaPorAgente() {
  const dir = nuevoDir("p3-bl-agente")
  const idProyecto = nuevoIdProyecto("p3-bl-agente")
  const llamar = async (args) => JSON.parse(await proyectoFisico.execute(args, { directory: dir }))
  const a = await llamar({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }, ...["led", "resistencia", "pulsador", "led"].map((tipo) => ({ tipo: "AgregarComponente", payload: { tipo } }))] })
  assert.equal(a.ok, true, JSON.stringify(a))
  const l1 = await llamar({ accion: "leer", idProyecto })
  const id = (n) => l1.componentes.filter((c) => c.tipo === n).map((c) => c.id)
  const [led, led2] = id("led")
  const [resistencia] = id("resistencia")
  const [pulsador] = id("pulsador")
  const b = await llamar({ accion: "aplicar", idProyecto, baseRevision: l1.revision, operaciones: [
    { tipo: "Conectar", payload: { desde: { componente: led, terminal: "anodo" }, hasta: { componente: resistencia, terminal: "a" } } },
    { tipo: "AsignarPin", payload: { componente: led, terminal: "anodo", pin: "GPIO18" } },
    { tipo: "AsignarPin", payload: { componente: pulsador, terminal: "senal", pin: "GPIO4" } },
    { tipo: "AsignarPin", payload: { componente: led2, terminal: "anodo", pin: "GPIO17" } },
  ] })
  assert.equal(b.ok, true, JSON.stringify(b))
  const l2 = await llamar({ accion: "leer", idProyecto })
  const ejemplo = JSON.parse(JSON.stringify(l2.vocabulario.operaciones.SetComportamiento).replace("<id del pulsador>", pulsador).replace("<id del LED>", led))
  const r = await llamar({ accion: "aplicar", idProyecto, baseRevision: l2.revision, operaciones: [{ tipo: "SetComportamiento", payload: ejemplo }] })
  assert.equal(r.ok, true, JSON.stringify(r))
  const servicio = obtenerServicioDeProyectoConVista({ directorio: directorioDeDatos(dir), idProyecto })
  try {
    return { regla: servicio.snapshot().proyecto.comportamientos[0], ids: { led, led2, pulsador } }
  } finally {
    servicio.cerrar()
  }
}

test("T7 convergencia: agente (tool), frase y vista lógica producen la MISMA regla en la IR (salvo el id)", async () => {
  const agente = await reglaPorAgente()

  // B — la frase: cada selector del plan de pintado, en orden, por el mismo controlador y el mismo HTTP
  const ctxB = await prepararServidor()
  let reglaB
  try {
    const app = await montarApp(ctxB)
    await app.cargar()
    for (const slot of SLOTS) {
      const frase = planDePintado(app.snapshot.vista, { reglaNueva: true }).find((i) => i.tipo === "reglaFrase")
      const selector = frase.selectores.find((s) => s.slot === slot)
      await app.controlador.cambiar({ reglaId: frase.reglaId, slot, valor: selector.opciones[0].valor })
    }
    reglaB = ctxB.servicio.snapshot().proyecto.comportamientos
  } finally {
    await cerrar(ctxB)
  }

  // C — la vista lógica: el alumno elige campo por campo en el workspace (Blockly falso)
  const ctxC = await prepararServidor()
  let reglaC
  try {
    const app = await montarApp(ctxC)
    await app.cargar()
    app.vista.repintar(app.snapshot, { deshabilitado: false })
    for (const slot of SLOTS) {
      app.campo(slot).setValue(app.campo(slot).opciones[1][1])
      await app.esperar()
    }
    reglaC = ctxC.servicio.snapshot().proyecto.comportamientos
    assert.deepEqual(app.valores(), [ctxC.pulsador, "presionado", ctxC.led, "encendido"])
  } finally {
    await cerrar(ctxC)
  }

  assert.equal(reglaB.length, 1)
  assert.equal(reglaC.length, 1)
  assert.deepEqual(agente.ids, { led: "cmp-0", led2: "cmp-3", pulsador: "cmp-2" }, "mismo proyecto inicial: mismos ids")
  assert.deepEqual(sinId(reglaB[0]), sinId(agente.regla))
  assert.deepEqual(sinId(reglaC[0]), sinId(agente.regla))
})

function archivosDe(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) archivosDe(p, acc)
    else acc.push(p)
  }
  return acc
}

test("T7 ida y vuelta: IR -> modelo -> edición -> op -> Engine -> IR' -> recarga -> modelo'; destruir y recrear da lo mismo; nada de Blockly en disco", async () => {
  const ctx = await prepararServidor()
  const { directorio, idProyecto, led, led2, pulsador } = ctx
  let valoresVivos
  try {
    ctx.paso("SetComportamiento", { comportamiento: { cuando: { sensor: pulsador, capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: led, accion: "encender" } } })
    const app = await montarApp(ctx)
    await app.cargar()
    app.vista.repintar(app.snapshot, { deshabilitado: false })
    assert.deepEqual(app.valores(), [pulsador, "presionado", led, "encendido"])
    const opciones = app.campo("actuador").opciones.map((o) => o[1]).slice(1)
    assert.deepEqual(opciones, [led, led2], "ambos LED se ofrecen; la resistencia no")

    // edición: cambiar la salida al otro LED
    const antes = ctx.servicio.snapshot().revision
    app.campo("actuador").setValue(led2)
    await app.esperar()
    const snap = ctx.servicio.snapshot()
    assert.equal(snap.revision, antes + 1)
    assert.equal(snap.proyecto.comportamientos[0].entonces.actuador, led2)
    assert.equal(snap.proyecto.comportamientos.length, 1)
    valoresVivos = app.valores()
    assert.deepEqual(valoresVivos, [pulsador, "presionado", led2, "encendido"])
  } finally {
    await cerrar(ctx)
  }

  // recarga desde disco con un servicio NUEVO
  const fresco = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  try {
    const snapshot = fresco.snapshot()
    assert.equal(snapshot.proyecto.comportamientos[0].entonces.actuador, led2)
    const modelo = proyectarModeloLogico(snapshot.vista)
    assert.deepEqual(modelo.regla.campos.map((f) => f.valor), [pulsador, "presionado", led2, "encendido"])

    // sin segunda verdad: un adaptador recreado SÓLO desde el snapshot recargado da los mismos campos
    const { Blockly, reg } = fabricarBlockly()
    const nuevo = crearAdaptadorBlockly({ Blockly, contenedor: {}, alEditar() {}, alQuitar() {} })
    nuevo.pintar(modelo)
    const campo = (slot) => reg.ws.bloques.map((b) => b.campos[slot]).find(Boolean)
    assert.deepEqual(SLOTS.map((s) => campo(s).getValue()), valoresVivos)
  } finally {
    fresco.cerrar()
  }

  // nada de Blockly en lo persistido
  for (const archivo of archivosDe(directorio)) {
    assert.ok(!/blockly|workspace|xml/i.test(archivo), `archivo sospechoso: ${archivo}`)
    const texto = readFileSync(archivo, "utf8")
    assert.ok(!/blockly|workspace|<xml|"blocks"/i.test(texto), `${archivo} menciona Blockly/workspace/xml`)
  }
})
