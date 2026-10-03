// Phase 3 — T6b: ACEPTACIÓN del caso humano (contrato §D), determinista y sin LLM, por la tool
// REAL y el Engine/Almacén REALES: "mientras aprieto el pulsador se prenda el LED".
// Requisito de origen (PHASE_3_REAL_HUMAN_TEST_REPORT.md §E2): el sistema lo comprendía pero no
// podía materializarlo en el proyecto.

import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, catalogo } from "./phase2-helpers.mjs"

const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { directorioDeDatos } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))
const { cargarProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { construirOperacionRegla } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))

const llamar = async (args, dir) => JSON.parse(await proyectoFisico.execute(args, { directory: dir }))
const PROHIBIDOS = [/estadoBooleano/, />=/, /cmp-/, /beh-/]

/** Paso 1: ESP32 + LED (GPIO18, resistencia en serie) + pulsador (GPIO4), TODO por la tool. */
async function armarProyecto() {
  const dir = nuevoDir("p3-acept")
  const idProyecto = nuevoIdProyecto("p3-acept")
  const a = await llamar({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }, { tipo: "AgregarComponente", payload: { tipo: "led" } }, { tipo: "AgregarComponente", payload: { tipo: "resistencia" } }, { tipo: "AgregarComponente", payload: { tipo: "pulsador" } }] }, dir)
  assert.equal(a.ok, true, JSON.stringify(a))
  const l1 = await llamar({ accion: "leer", idProyecto }, dir)
  const id = (tipo) => l1.componentes.find((c) => c.tipo === tipo).id
  const [led, resistencia, pulsador] = [id("led"), id("resistencia"), id("pulsador")]
  const b = await llamar({ accion: "aplicar", idProyecto, baseRevision: l1.revision, operaciones: [{ tipo: "Conectar", payload: { desde: { componente: led, terminal: "anodo" }, hasta: { componente: resistencia, terminal: "a" } } }, { tipo: "AsignarPin", payload: { componente: led, terminal: "anodo", pin: "GPIO18" } }, { tipo: "AsignarPin", payload: { componente: pulsador, terminal: "senal", pin: "GPIO4" } }] }, dir)
  assert.equal(b.ok, true, JSON.stringify(b))
  return { dir, idProyecto, led, resistencia, pulsador }
}
const dirDatos = (c) => directorioDeDatos(c.dir)
const discoDe = (c) => readFileSync(join(dirDatos(c), `${c.idProyecto}.json`), "utf8")
function recargarServicio(c) {
  obtenerServicioDeProyectoConVista({ directorio: dirDatos(c), idProyecto: c.idProyecto }).cerrar()
  return obtenerServicioDeProyectoConVista({ directorio: dirDatos(c), idProyecto: c.idProyecto })
}

/** Paso 2: la operación que el agente interpreta = el ejemplo del vocabulario con los ids reales de `leer`. */
async function opDelAgente(c) {
  const lectura = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  const ejemplo = JSON.parse(JSON.stringify(lectura.vocabulario.operaciones.SetComportamiento).replace("<id del pulsador>", c.pulsador).replace("<id del LED>", c.led))
  return { lectura, op: { tipo: "SetComportamiento", payload: ejemplo } }
}
const REGLA_ESPERADA = (c) => ({ cuando: { sensor: c.pulsador, capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: c.led, accion: "encender" } })

test("T6b pasos 1-5: tool -> Engine -> IR exacto -> recarga idéntica -> proyección en lenguaje del alumno", async () => {
  const c = await armarProyecto()
  const { lectura, op } = await opDelAgente(c)

  // 2. aplicar por la tool
  const r = await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: lectura.revision, operaciones: [op] }, c.dir)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.resultado, `APLICADO — revisión ${lectura.revision}→${lectura.revision + 1}`)

  // 3. IR: exactamente una regla, sin campos de más
  const disco = JSON.parse(discoDe(c))
  assert.equal(disco.comportamientos.length, 1)
  const { id, ...regla } = disco.comportamientos[0]
  assert.match(id, /^beh-\d+$/)
  assert.deepEqual(regla, REGLA_ESPERADA(c))

  // 4. recarga con un servicio fresco: misma regla, mismo id; sin motivo semántico bloqueante
  const fresco = recargarServicio(c)
  const snap = fresco.snapshot()
  assert.deepEqual(snap.proyecto.comportamientos, disco.comportamientos)
  assert.equal(snap.revision, lectura.revision + 1)
  const motivos = validarProyecto(snap.proyecto, catalogo)
  assert.deepEqual(motivos.filter((m) => m.categoria === "semantica"), [], "ningún motivo semántico (incompleto/actuador/sensor inválido)")
  const readiness = derivarReadiness(snap.proyecto, motivos)
  // Circuito válido (LED con su resistencia en serie, ambos pines asignados): el proyecto queda listo.
  assert.equal(readiness.listo, true, JSON.stringify(motivos))
  assert.equal(cargarProyecto(discoDe(c)).ok, true)

  // 5. proyección: texto exacto, traza con reposo apagado, nada interno como texto
  const lecturaFinal = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  const reglaVista = lecturaFinal.reglas[0]
  assert.equal(reglaVista.texto, "Mientras el Pulsador esté presionado, el LED está encendido.")
  const vista = fresco.snapshot().vista
  const trazaVista = vista.reglas[0].traza
  assert.match(trazaVista.ramas[1], /no está presionado.*el LED está apagado \(reposo\)/)
  const textos = [reglaVista.texto, ...trazaVista.ramas, trazaVista.etiqueta, ...vista.motivos.map((m) => m.explicacion ?? "")]
  for (const t of textos) for (const re of PROHIBIDOS) assert.doesNotMatch(t, re, t)
  fresco.cerrar()
})

test("T6b paso 6: DOS PRODUCTORES, UNA VERDAD — la regla armada por el navegador (HTTP + construirOperacionRegla, slot por slot) es igual a la del agente salvo el id", async () => {
  const agente = await armarProyecto()
  const { lectura, op } = await opDelAgente(agente)
  await llamar({ accion: "aplicar", idProyecto: agente.idProyecto, baseRevision: lectura.revision, operaciones: [op] }, agente.dir)
  const reglaAgente = JSON.parse(discoDe(agente)).comportamientos[0]

  const navegador = await armarProyecto()
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos(navegador), idProyecto: navegador.idProyecto })
  const servidor = await iniciarServidor({ servicio })
  const post = (cuerpo) =>
    new Promise((resolve, reject) => {
      const texto = JSON.stringify(cuerpo)
      const req = http.request({ hostname: "127.0.0.1", port: servidor.puerto, path: "/api/operaciones", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(texto), Origin: `http://127.0.0.1:${servidor.puerto}` } }, (res) => {
        const t = []
        res.on("data", (x) => t.push(x))
        res.on("end", () => resolve(JSON.parse(Buffer.concat(t).toString("utf8"))))
      })
      req.on("error", reject)
      req.write(texto)
      req.end()
    })
  try {
    let snapshot = servicio.snapshot()
    let idRegla = null
    let contador = 0
    // slot por slot, con las opciones que el SERVIDOR proyectó; la regla nace con el primero
    for (const [slot, valor] of [["sensor", navegador.pulsador], ["estado", "presionado"], ["actuador", navegador.led], ["salida", "encendido"]]) {
      const vista = snapshot.vista
      const regla = idRegla === null ? null : vista.reglas.find((r) => r.id === idRegla)
      const operacion = construirOperacionRegla({ regla, slot, valor, opcionesRegla: vista.opcionesRegla })
      const cuerpo = await post({ idOperacion: `web-${contador++}`, actor: "navegador", baseRevision: snapshot.revision, ...operacion })
      assert.equal(cuerpo.resultado.ok, true, JSON.stringify(cuerpo.resultado.motivos))
      snapshot = servicio.snapshot()
      idRegla = snapshot.proyecto.comportamientos[0].id
    }
    assert.equal(snapshot.proyecto.comportamientos.length, 1)
    const { id: _a, ...delAgente } = reglaAgente
    const { id: _b, ...delNavegador } = snapshot.proyecto.comportamientos[0]
    assert.deepEqual(delNavegador, delAgente)
    assert.equal(snapshot.vista.reglas[0].texto, "Mientras el Pulsador esté presionado, el LED está encendido.")
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("T6b paso 7: QuitarComportamiento por la tool con el id de leer -> APLICADO; recarga sin reglas; el resto intacto; QuitarComponente protegido mientras hay regla", async () => {
  const c = await armarProyecto()
  const { lectura, op } = await opDelAgente(c)
  await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: lectura.revision, operaciones: [op] }, c.dir)
  const conRegla = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  const antes = JSON.parse(discoDe(c))

  // mientras la regla existe, el pulsador no se puede quitar
  const bloqueo = await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: conRegla.revision, operaciones: [{ tipo: "QuitarComponente", payload: { componente: c.pulsador } }] }, c.dir)
  assert.equal(bloqueo.ok, false)
  assert.ok(bloqueo.motivos.some((m) => m.codigo === "REMOCION_CON_DEPENDIENTES"))
  assert.equal(bloqueo.motivos.find((m) => m.codigo === "REMOCION_CON_DEPENDIENTES").explicacion, "Este componente lo usa una regla. Quitá o cambiá la regla primero.")
  assert.equal(JSON.parse(discoDe(c)).revision, antes.revision)

  // quitar la regla
  const q = await llamar({ accion: "aplicar", idProyecto: c.idProyecto, baseRevision: conRegla.revision, operaciones: [{ tipo: "QuitarComportamiento", payload: { comportamiento: conRegla.reglas[0].id } }] }, c.dir)
  assert.equal(q.ok, true, JSON.stringify(q))
  assert.equal(q.resultado, `APLICADO — revisión ${conRegla.revision}→${conRegla.revision + 1}`)

  const fresco = recargarServicio(c)
  const despues = fresco.snapshot().proyecto
  assert.deepEqual(despues.comportamientos, [])
  assert.deepEqual(despues.componentes, antes.componentes, "componentes y pines intactos")
  assert.deepEqual(despues.conexiones, antes.conexiones)
  assert.equal(despues.placa, antes.placa)
  assert.equal(despues.revision, antes.revision + 1, "la revisión sólo avanzó una por la baja de la regla")
  fresco.cerrar()

  // ahora QuitarComponente del pulsador ya no choca con la regla (se verifica con simular: nada se muta)
  const l = await llamar({ accion: "leer", idProyecto: c.idProyecto }, c.dir)
  const sim = await llamar({ accion: "simular", idProyecto: c.idProyecto, baseRevision: l.revision, operaciones: [{ tipo: "QuitarComponente", payload: { componente: c.pulsador } }] }, c.dir)
  assert.equal(sim.ok, true, JSON.stringify(sim))
  assert.equal(JSON.parse(discoDe(c)).componentes.length, antes.componentes.length)
})
