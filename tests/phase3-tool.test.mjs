// Phase 3 — Vertical semántico #1, T4b: la tool `proyecto-fisico` (actor "agente")
// acepta SetComportamiento y QuitarComportamiento (whitelist cerrada de 8 tipos),
// `leer` expone `reglas` (la MISMA proyección del servidor) y el vocabulario trae los
// ejemplos canónicos. Contrato B7 + DECISIONS 2531e09.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const { directorioDeDatos } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))
const { cargarProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))

const llamar = async (args, dir) => JSON.parse(await proyectoFisico.execute(args, { directory: dir }))

/** ESP32 + LED + pulsador armados POR LA TOOL; devuelve ids y la revisión vigente. */
async function armar() {
  const dir = nuevoDir("p3-tool")
  const idProyecto = nuevoIdProyecto("p3-tool")
  let r = await llamar({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }, { tipo: "AgregarComponente", payload: { tipo: "led" } }, { tipo: "AgregarComponente", payload: { tipo: "pulsador" } }] }, dir)
  assert.equal(r.ok, true, JSON.stringify(r))
  const lectura = await llamar({ accion: "leer", idProyecto }, dir)
  const led = lectura.componentes.find((c) => c.tipo === "led").id
  const pulsador = lectura.componentes.find((c) => c.tipo === "pulsador").id
  return { dir, idProyecto, led, pulsador, revision: lectura.revision }
}
const dirDatos = (c) => directorioDeDatos(c.dir)
const reglaCanonica = (c) => ({ cuando: { sensor: c.pulsador, capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: c.led, accion: "encender" } })
const leerDisco = (c) => {
  const ruta = join(dirDatos(c), `${c.idProyecto}.json`)
  return existsSync(ruta) ? readFileSync(ruta, "utf8") : null
}

test("T4b la whitelist de la tool son EXACTAMENTE 8 tipos (CambiarComponente sigue afuera)", async () => {
  const c = await armar()
  const lectura = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  assert.deepEqual(Object.keys(lectura.vocabulario.operaciones).sort(), ["AgregarComponente", "AsignarPin", "Conectar", "Desconectar", "QuitarComponente", "QuitarComportamiento", "SetComportamiento", "SetPlaca"])
  const r = await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: c.revision, operaciones: [{ tipo: "CambiarComponente", payload: { componente: c.led, tipoNuevo: "led" } }] }, c.dir)
  assert.equal(r.codigo, "OPERACION_FUERA_DE_WHITELIST")
})

test("T4b vocabulario: ejemplo canónico de SetComportamiento (presionado -> encendido) y de QuitarComportamiento", async () => {
  const c = await armar()
  const { vocabulario } = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  assert.deepEqual(vocabulario.operaciones.SetComportamiento, {
    comportamiento: {
      cuando: { sensor: "<id del pulsador>", capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } },
      entonces: { actuador: "<id del LED>", accion: "encender" },
    },
  })
  assert.deepEqual(vocabulario.operaciones.QuitarComportamiento, { comportamiento: "<id de la regla>" })
})

test("T4b aplicar SetComportamiento (payload canónico): APLICADO X->Y, la regla está en el IR y recarga idéntica; leer muestra el texto", async () => {
  const c = await armar()
  const r = await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: c.revision, operaciones: [{ tipo: "SetComportamiento", payload: { comportamiento: reglaCanonica(c) } }] }, c.dir)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.resultado, `APLICADO — revisión ${c.revision}→${c.revision + 1}`)
  const disco = JSON.parse(leerDisco(c))
  assert.equal(disco.comportamientos.length, 1)
  assert.equal(disco.comportamientos[0].cuando.sensor, c.pulsador)
  assert.equal(disco.comportamientos[0].entonces.accion, "encender")
  const recargado = cargarProyecto(leerDisco(c))
  assert.equal(recargado.ok, true)
  assert.deepEqual(JSON.parse(JSON.stringify(recargado.proyecto.comportamientos)), disco.comportamientos)

  const lectura = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  assert.ok(Array.isArray(lectura.reglas))
  assert.equal(lectura.reglas.length, 1)
  const regla = lectura.reglas[0]
  assert.equal(regla.id, disco.comportamientos[0].id)
  assert.equal(regla.texto, "Mientras el Pulsador esté presionado, el LED está encendido.")
  assert.equal(regla.completa, true)
  assert.deepEqual(regla.faltan, [])
  assert.equal(regla.frase.sensor.id, c.pulsador)
})

test("T4b QuitarComportamiento con el id que devuelve leer: la regla desaparece", async () => {
  const c = await armar()
  await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: c.revision, operaciones: [{ tipo: "SetComportamiento", payload: { comportamiento: reglaCanonica(c) } }] }, c.dir)
  const lectura = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  const r = await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: lectura.revision, operaciones: [{ tipo: "QuitarComportamiento", payload: { comportamiento: lectura.reglas[0].id } }] }, c.dir)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.resultado, `APLICADO — revisión ${lectura.revision}→${lectura.revision + 1}`)
  assert.deepEqual(JSON.parse(leerDisco(c)).comportamientos, [])
  assert.deepEqual((await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)).reglas, [])
})

test("T4b simular SetComportamiento: SIMULACIÓN, sin mutar revisión ni disco", async () => {
  const c = await armar()
  const antes = leerDisco(c)
  const r = await llamar({ accion: "simular", idProyecto: c.idProyecto, baseRevision: c.revision, operaciones: [{ tipo: "SetComportamiento", payload: { comportamiento: reglaCanonica(c) } }] }, c.dir)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.match(r.resultado, /^SIMULACIÓN/)
  assert.equal(leerDisco(c), antes)
  assert.equal((await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)).revision, c.revision)
})

test("T4b baseRevision vieja con SetComportamiento: NO SE APLICÓ NADA, nada cambia", async () => {
  const c = await armar()
  const antes = leerDisco(c)
  const r = await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: c.revision - 1, operaciones: [{ tipo: "SetComportamiento", payload: { comportamiento: reglaCanonica(c) } }] }, c.dir)
  assert.equal(r.ok, false)
  assert.match(r.resultado, /^NO SE APLICÓ NADA/)
  assert.equal(leerDisco(c), antes)
})

test("T4b el actor de una operación de regla por la tool es 'agente' (no se acepta otro por args)", async () => {
  const c = await armar()
  const r = await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: c.revision, operaciones: [{ tipo: "SetComportamiento", payload: { comportamiento: reglaCanonica(c) }, actor: "navegador" }] }, c.dir)
  assert.equal(r.rechazadoPor, "tool")
  assert.equal(r.codigo, "OPERACION_CON_CLAVES_INVALIDAS")
  const src = readFileSync(join(REPO, "opencode/tool/proyecto-fisico.ts"), "utf8")
  assert.match(src, /actor: "agente"/)
})

test("T4b regla parcial por la tool: commitea y los motivos traen COMPORTAMIENTO_INCOMPLETO con su explicación", async () => {
  const c = await armar()
  const r = await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: c.revision, operaciones: [{ tipo: "SetComportamiento", payload: { comportamiento: { cuando: { sensor: c.pulsador } } } }] }, c.dir)
  assert.equal(r.ok, true, JSON.stringify(r))
  const m = r.motivos.find((x) => x.codigo === "COMPORTAMIENTO_INCOMPLETO")
  assert.ok(m, JSON.stringify(r.motivos))
  assert.equal(m.explicacion, "A la regla le falta: qué estado de la entrada, qué salida y qué hace la salida.")
  const lectura = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  assert.equal(lectura.reglas[0].completa, false)
  assert.deepEqual(lectura.reglas[0].faltan, ["estado", "actuador", "salida"])
})

test("T4b las descripciones de la tool ya no dicen que el slice no modela reglas y nombran la whitelist cerrada de 8", () => {
  const src = readFileSync(join(REPO, "opencode/tool/proyecto-fisico.ts"), "utf8")
  assert.equal(/no modela pulsador/.test(src), false)
  assert.equal(/Sólo se aceptan estos 6 tipos/.test(src), false)
  assert.match(proyectoFisico.description, /8 tipos/)
  assert.match(proyectoFisico.description, /SetComportamiento/)
  assert.match(proyectoFisico.description, /QuitarComportamiento/)
})
