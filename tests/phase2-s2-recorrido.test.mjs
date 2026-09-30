// Phase 2, Slice 2 — W-S2-TOOL, recorrido de aceptación §1 (pasos 4-11) del diseño
// (PHASE_2_SLICE_2_DESIGN.md): el agente arma ESP32 + LED + pulsador POR LA TOOL, el
// navegador (POST) recablea el pulsador, la revisión sube y persiste, un reinicio de
// proceso conserva el estado exacto, un blocking representable (GPIO34,
// PIN_SIN_PULLUP_INTERNO) converge entre la tool/el navegador/el Engine directo, y la
// corrección posterior lo hace desaparecer.
//
// Los pasos 1-3 (navegador real, CDP, piezas visibles/rótulos Entrada-Salida) ya están
// cubiertos por el gate de Chromium de W-S2-VISTA (T2, `.../s2impl/gate-vista/`) — este
// archivo cubre la parte de datos/motor/HTTP de los pasos 4-11, no la parte visual.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, GPIO_X } from "./phase2-helpers.mjs"

const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { directorioDeDatos } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))

function parsearJson(texto) {
  return JSON.parse(texto)
}
async function llamarTool(args, directorioActivo) {
  return proyectoFisico.execute(args, { directory: directorioActivo })
}

/** Cliente SSE mínimo sobre `fetch()` — mismo contrato que
 * `tests/phase2-e2e.test.mjs::conectarSSE` (reimplementado: los tests no se importan
 * entre sí). */
async function conectarSSE(urlEventos) {
  const respuesta = await fetch(urlEventos)
  assert.equal(respuesta.status, 200)
  const lector = respuesta.body.getReader()
  const decodificador = new TextDecoder()
  let buffer = ""
  const eventos = []
  const esperando = []

  function procesarBloque(bloque) {
    let tipo = "message"
    let datos = null
    for (const linea of bloque.split("\n")) {
      if (linea.startsWith("event:")) tipo = linea.slice("event:".length).trim()
      else if (linea.startsWith("data:")) datos = linea.slice("data:".length).trim()
    }
    if (datos === null) return
    const evento = { tipo, datos: JSON.parse(datos) }
    if (esperando.length > 0) esperando.shift()(evento)
    else eventos.push(evento)
  }

  const bombeo = (async () => {
    for (;;) {
      const { done, value } = await lector.read()
      if (done) return
      buffer += decodificador.decode(value, { stream: true })
      let indice
      while ((indice = buffer.indexOf("\n\n")) !== -1) {
        procesarBloque(buffer.slice(0, indice))
        buffer = buffer.slice(indice + 2)
      }
    }
  })()
  bombeo.catch(() => {})

  return {
    siguienteEvento() {
      if (eventos.length > 0) return Promise.resolve(eventos.shift())
      return new Promise((resolve) => esperando.push(resolve))
    },
    async cerrar() {
      await lector.cancel().catch(() => {})
    },
  }
}

test("recorrido §1, pasos 4-11: el agente arma ESP32+LED+pulsador por la tool, el navegador recablea por POST, revisión+1/disco canónico, recarga+persistencia, blocking en GPIO34 (convergencia tool/POST/Engine directo) y corrección", async () => {
  const dirActivo = nuevoDir("recorrido")
  const idProyecto = nuevoIdProyecto()
  const dirDatos = directorioDeDatos(dirActivo)

  // ── El AGENTE arma ESP32 + LED + pulsador, por la tool (transporte, no atajos). ──
  let r = parsearJson(
    await llamarTool(
      {
        accion: "aplicar",
        idProyecto,
        baseRevision: 0,
        operaciones: [
          { tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } },
          { tipo: "AgregarComponente", payload: { tipo: "led" } },
          { tipo: "AgregarComponente", payload: { tipo: "pulsador" } },
        ],
      },
      dirActivo,
    ),
  )
  assert.equal(r.ok, true, `armado inicial rechazado: ${JSON.stringify(r.motivos)}`)
  assert.equal(r.revisionActual, 1)

  let lectura = parsearJson(await llamarTool({ accion: "leer", idProyecto }, dirActivo))
  assert.equal(lectura.componentes.length, 2)
  const idLed = lectura.componentes.find((c) => c.tipo === "led").id
  const idPulsador = lectura.componentes.find((c) => c.tipo === "pulsador").id
  assert.equal(lectura.componentes.find((c) => c.id === idLed).rol, "salida", "el LED se identifica como Salida")
  assert.equal(lectura.componentes.find((c) => c.id === idPulsador).rol, "entrada", "el pulsador se identifica como Entrada")

  r = parsearJson(
    await llamarTool(
      {
        accion: "aplicar",
        idProyecto,
        baseRevision: r.revisionActual,
        operaciones: [
          { tipo: "AsignarPin", payload: { componente: idLed, terminal: "anodo", pin: GPIO_X } },
          { tipo: "AsignarPin", payload: { componente: idPulsador, terminal: "senal", pin: "GPIO18" } },
        ],
      },
      dirActivo,
    ),
  )
  assert.equal(r.ok, true, `cableado inicial rechazado: ${JSON.stringify(r.motivos)}`)
  assert.equal(r.revisionActual, 2)

  // ── El servidor HTTP (navegador) se abre sobre el MISMO servicio/Engine que usó la tool. ──
  let servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
  let servidor = await iniciarServidor({ servicio })
  let coleccionSSE

  try {
    coleccionSSE = await conectarSSE(new URL("/api/eventos", servidor.url))

    // ── Paso 4/5/6: el NAVEGADOR cambia el GPIO del pulsador — POST AsignarPin, actor forzado. ──
    const rGetAntes = await fetch(new URL("/api/proyecto", servidor.url))
    const snapshotAntes = await rGetAntes.json()
    const n = snapshotAntes.revision
    assert.equal(n, 2)

    const rPost = await fetch(new URL("/api/operaciones", servidor.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: new URL(servidor.url).origin },
      body: JSON.stringify({ idOperacion: "nav-1", actor: "navegador", baseRevision: n, tipo: "AsignarPin", payload: { componente: idPulsador, terminal: "senal", pin: "GPIO16" } }),
    })
    assert.equal(rPost.status, 200)
    const cuerpoPost = await rPost.json()
    assert.equal(cuerpoPost.resultado.ok, true, `POST rechazado: ${JSON.stringify(cuerpoPost.resultado.motivos)}`)
    assert.equal(cuerpoPost.resultado.revisionActual, n + 1, "paso 6: revisión monótona, +1")
    assert.equal(cuerpoPost.snapshot.proyecto.componentes.find((c) => c.id === idPulsador).pines.senal, "GPIO16", "el <select> reflejaría el valor nuevo")

    const evento = await coleccionSSE.siguienteEvento()
    assert.equal(evento.tipo, "revision")
    assert.deepEqual(evento.datos, { revision: n + 1 })

    // ── Paso 5/7: sin atajos — el disco (persistencia del Engine) coincide, GPIO16. ──
    const discoTrasPost = JSON.parse(readFileSync(join(dirDatos, `${idProyecto}.json`), "utf8"))
    assert.equal(discoTrasPost.revision, n + 1)
    assert.equal(discoTrasPost.componentes.find((c) => c.id === idPulsador).pines.senal, "GPIO16", "el JSON en disco tiene senal: GPIO16")

    await coleccionSSE.cerrar()
    coleccionSSE = undefined
    await servidor.cerrar()
    servicio.cerrar()

    // ── Paso 8/9: recarga del PROCESO — raíz nueva sobre el MISMO directorio; el
    // estado es EXACTAMENTE el mismo (PERSISTIBLE ⇒ RECARGABLE). ──
    const lecturaTrasRecarga = parsearJson(await llamarTool({ accion: "leer", idProyecto }, dirActivo))
    assert.equal(lecturaTrasRecarga.revision, n + 1, "misma revisión tras la recarga")
    assert.equal(lecturaTrasRecarga.componentes.find((c) => c.id === idPulsador).pines.senal, "GPIO16", "mismo GPIO tras la recarga")
    assert.equal(lecturaTrasRecarga.componentes.find((c) => c.id === idLed).pines.anodo, GPIO_X, "el LED conserva su pin tras la recarga")

    // ── Paso 10: blocking representable — pulsador en GPIO34 (D8), PIN_SIN_PULLUP_INTERNO. ──
    // Por la TOOL:
    const rBlocking = parsearJson(
      await llamarTool({ accion: "aplicar", idProyecto, baseRevision: lecturaTrasRecarga.revision, operaciones: [{ tipo: "AsignarPin", payload: { componente: idPulsador, terminal: "senal", pin: "GPIO34" } }] }, dirActivo),
    )
    assert.equal(rBlocking.ok, true, "el commit entra igual: PIN_SIN_PULLUP_INTERNO es representable, no rechazo")
    const motivoTool = rBlocking.motivos.find((m) => m.codigo === "PIN_SIN_PULLUP_INTERNO")
    assert.ok(motivoTool, `tiene que aparecer el motivo: ${JSON.stringify(rBlocking.motivos)}`)
    assert.equal(typeof motivoTool.explicacion, "string")
    assert.match(motivoTool.explicacion, /GPIO34/, "la explicación en texto llano nombra el pin")

    const lecturaBlocking = parsearJson(await llamarTool({ accion: "leer", idProyecto }, dirActivo))
    const motivoLectura = lecturaBlocking.motivos.find((m) => m.codigo === "PIN_SIN_PULLUP_INTERNO")
    assert.ok(motivoLectura, "'leer' también muestra el motivo vigente")
    assert.equal(motivoLectura.explicacion, motivoTool.explicacion, "misma explicación determinista entre 'aplicar' y 'leer'")

    // Reapertura ("otra pestaña"/navegador) sobre el MISMO directorio — convergencia
    // por el navegador (GET) y por el Engine directo (snapshot), sin pasar por la tool.
    servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
    servidor = await iniciarServidor({ servicio })

    const rGetPost = await fetch(new URL("/api/proyecto", servidor.url))
    const snapshotPost = await rGetPost.json()
    const motivoNavegador = snapshotPost.vista.motivos.find((m) => m.codigo === "PIN_SIN_PULLUP_INTERNO")
    assert.ok(motivoNavegador, "el navegador (GET del servidor) ve el MISMO motivo vigente")
    assert.equal(motivoNavegador.explicacion, motivoTool.explicacion, "convergencia: misma explicación por el navegador que por la tool")

    const motivoDirecto = servicio.snapshot().vista.motivos.find((m) => m.codigo === "PIN_SIN_PULLUP_INTERNO")
    assert.ok(motivoDirecto, "el Engine directo (snapshot, sin pasar por HTTP ni por la tool) también ve el motivo")
    assert.equal(motivoDirecto.explicacion, motivoTool.explicacion, "convergencia: misma explicación por el Engine directo que por la tool")

    // ── Paso 11: seguir editando y corregir — <select> a un pin normal (GPIO16 de nuevo). ──
    const revisionAntesDeCorregir = servicio.snapshot().revision
    const rCorregir = await fetch(new URL("/api/operaciones", servidor.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: new URL(servidor.url).origin },
      body: JSON.stringify({
        idOperacion: "nav-corregir",
        actor: "navegador",
        baseRevision: revisionAntesDeCorregir,
        tipo: "AsignarPin",
        payload: { componente: idPulsador, terminal: "senal", pin: "GPIO16" },
      }),
    })
    const cuerpoCorregir = await rCorregir.json()
    assert.equal(cuerpoCorregir.resultado.ok, true)
    assert.equal(cuerpoCorregir.resultado.revisionActual, revisionAntesDeCorregir + 1, "la revisión sube en 1 al corregir")
    assert.ok(!cuerpoCorregir.snapshot.vista.motivos.some((m) => m.codigo === "PIN_SIN_PULLUP_INTERNO"), "el motivo desaparece tras corregir")

    const lecturaFinal = parsearJson(await llamarTool({ accion: "leer", idProyecto }, dirActivo))
    assert.ok(!lecturaFinal.motivos.some((m) => m.codigo === "PIN_SIN_PULLUP_INTERNO"), "la tool también deja de ver el motivo corregido")
    assert.equal(lecturaFinal.componentes.find((c) => c.id === idPulsador).pines.senal, "GPIO16")
  } finally {
    if (coleccionSSE) await coleccionSSE.cerrar().catch(() => {})
    await servidor.cerrar().catch(() => {})
    servicio.cerrar()
  }
})
