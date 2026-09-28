// Phase 2, Slice 1 — end-to-end (writer W4, tarea 4, PHASE_2_SLICE_1_DESIGN.md §1/§2.7/§2.8).
// Raíz de composición + servidor HTTP+SSE REALES sobre un directorio temporal, cubriendo
// en una sola corrida todo el ciclo de vida que el diseño describe para "quiero ver el
// LED": snapshot inicial, SSE, POST aceptado, reload (cerrar + raíz nueva sobre el mismo
// directorio) y un conflicto stale contra el servidor NUEVO. Además, la tool de OpenCode
// (`opencode/tool/vista-fisica.ts`) obtiene el servicio por la MISMA vía de producción
// (`servicio-con-vista.ts`) que usaría el servidor del navegador — se verifica que
// comparten el mismo Engine y que la tool nunca cachea la IR.
//
// Sin `sleep`: la sincronización del SSE es por promesa (un lector que resuelve cuando
// llega el próximo bloque `event:`/`data:`), igual que ya hace
// `tests/phase2-transporte-http.test.mjs::conectarSSE` — acá se reimplementa con
// `fetch()` + `ReadableStream` en vez de `node:http` crudo (más corto, mismo contrato;
// Node no expone `EventSource` global, así que ninguno de los dos test files puede usar
// el cliente nativo del navegador).

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, GPIO_X, GPIO_Y } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { obtenerServidorVistaFisica, directorioDeDatos, ID_PROYECTO_DEFAULT } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))

// ════════════════════════════════════════════════════════════════════════════════════
// helpers
// ════════════════════════════════════════════════════════════════════════════════════

let contadorOp = 0
function opSetup(tipo, payload, baseRevision) {
  return { idOperacion: `e2e-setup-${contadorOp++}`, actor: "navegador", baseRevision, tipo, payload }
}

/** ESP32 + un LED con el ánodo en GPIO_X (GPIO4), vía el composition root REAL con
 * vista (servicio-con-vista.ts) — mismo fixture que el resto de Phase 2. */
function prepararServicioConLed(directorio, idProyecto) {
  const servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  let r = servicio.aplicar(opSetup("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true, `fixture: SetPlaca rechazado: ${JSON.stringify(r.motivos)}`)
  r = servicio.aplicar(opSetup("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
  assert.equal(r.ok, true, `fixture: AgregarComponente rechazado: ${JSON.stringify(r.motivos)}`)
  const idComponente = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(opSetup("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_X }, servicio.snapshot().revision))
  assert.equal(r.ok, true, `fixture: AsignarPin rechazado: ${JSON.stringify(r.motivos)}`)
  return { servicio, idComponente }
}

/** Cliente SSE mínimo sobre `fetch()` (Node no expone `EventSource` global) — expone
 * `siguienteEvento()`, una promesa que resuelve con el próximo bloque `event:`/`data:`
 * YA recibido, o cuando llegue (nunca por timeout: puramente dirigido por los chunks
 * del stream). Mismo contrato que `conectarSSE` en phase2-transporte-http.test.mjs,
 * reimplementado sobre `ReadableStream` en vez de `node:http` crudo. */
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
    if (datos === null) return // el preámbulo `retry: 1000` no es un evento
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
  bombeo.catch(() => {}) // se cancela expresamente en cerrar(); no dejar un rechazo suelto

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

// ════════════════════════════════════════════════════════════════════════════════════
// Flujo completo: snapshot, SSE, POST, GET, reload, stale contra el servidor NUEVO
// ════════════════════════════════════════════════════════════════════════════════════

test("flujo end-to-end: servidor real, SSE, POST aceptado, reload (cerrar + raiz nueva) y stale contra el servidor nuevo", async () => {
  const dir = nuevoDir("e2e-flujo")
  const idProyecto = nuevoIdProyecto()

  const { servicio: servicio1, idComponente } = prepararServicioConLed(dir, idProyecto)
  const servidor1 = await iniciarServidor({ servicio: servicio1 })
  let coleccionSSE

  try {
    // --- GET snapshot inicial: ESP32 + LED en GPIO4 ---
    const rGet1 = await fetch(new URL("/api/proyecto", servidor1.url))
    assert.equal(rGet1.status, 200)
    const snapshot1 = await rGet1.json()
    assert.equal(snapshot1.proyecto.placa, "esp32-devkit-v1")
    assert.equal(snapshot1.proyecto.componentes[0].pines.anodo, GPIO_X)
    assert.ok(snapshot1.vista, "el snapshot servido tiene que traer la vista (servicio-con-vista.ts)")

    // --- SSE conectado ---
    coleccionSSE = await conectarSSE(new URL("/api/eventos", servidor1.url))

    // --- POST AsignarPin a GPIO16 con base N ---
    const n = snapshot1.revision
    const rPost = await fetch(new URL("/api/operaciones", servidor1.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idOperacion: "e2e-post-1", actor: "navegador", baseRevision: n, tipo: "AsignarPin", payload: { componente: idComponente, terminal: "anodo", pin: GPIO_Y } }),
    })
    assert.equal(rPost.status, 200)
    const cuerpoPost = await rPost.json()
    assert.equal(cuerpoPost.resultado.ok, true)
    assert.equal(cuerpoPost.resultado.revisionActual, n + 1)

    // --- evento revision N+1 ---
    const evento = await coleccionSSE.siguienteEvento()
    assert.equal(evento.tipo, "revision")
    assert.deepEqual(evento.datos, { revision: n + 1 })

    // --- GET da GPIO16 y el cable de la vista a GPIO16 ---
    const rGet2 = await fetch(new URL("/api/proyecto", servidor1.url))
    const snapshot2 = await rGet2.json()
    assert.equal(snapshot2.revision, n + 1)
    assert.equal(snapshot2.proyecto.componentes[0].pines.anodo, GPIO_Y)
    const cableAGpio16 = snapshot2.vista.cables.some(
      (cable) => (cable.desde.tipo === "pinPlaca" && cable.desde.pinSemantico === GPIO_Y) || (cable.hasta.tipo === "pinPlaca" && cable.hasta.pinSemantico === GPIO_Y),
    )
    assert.ok(cableAGpio16, `la vista tiene que tener un cable hasta el pin de placa ${GPIO_Y}: ${JSON.stringify(snapshot2.vista.cables)}`)

    // --- cerrar() del servidor y del servicio ---
    await coleccionSSE.cerrar()
    await servidor1.cerrar()
    servicio1.cerrar()

    // --- raiz + servidor NUEVOS sobre el MISMO directorio: revision N+1, GPIO16, misma vista (reload) ---
    const servicio2 = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto })
    assert.notEqual(servicio2, servicio1, "tiene que ser una raiz NUEVA (el singleton se sacó con cerrar())")
    const servidor2 = await iniciarServidor({ servicio: servicio2 })

    try {
      const rGetReload = await fetch(new URL("/api/proyecto", servidor2.url))
      const snapshotReload = await rGetReload.json()
      assert.equal(snapshotReload.revision, n + 1, "misma revision tras el reload")
      assert.equal(snapshotReload.proyecto.componentes[0].pines.anodo, GPIO_Y, "mismo GPIO tras el reload")
      assert.deepEqual(snapshotReload.vista, snapshot2.vista, "misma vista, campo a campo, tras el reload")

      // --- un stale con base N (la vieja, ya superada) sobre el servidor NUEVO da BASE_REVISION_DESACTUALIZADA, sin cambios ---
      const rStale = await fetch(new URL("/api/operaciones", servidor2.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idOperacion: "e2e-post-stale", actor: "navegador", baseRevision: n, tipo: "AsignarPin", payload: { componente: idComponente, terminal: "anodo", pin: "GPIO18" } }),
      })
      assert.equal(rStale.status, 200) // rechazo de DOMINIO, no de transporte
      const cuerpoStale = await rStale.json()
      assert.equal(cuerpoStale.resultado.ok, false)
      assert.ok(cuerpoStale.resultado.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA"))
      assert.equal(cuerpoStale.snapshot.revision, n + 1, "sin cambios: sigue en N+1")
      assert.equal(cuerpoStale.snapshot.proyecto.componentes[0].pines.anodo, GPIO_Y, "el pin sigue siendo GPIO16, no GPIO18")
    } finally {
      await servidor2.cerrar()
      servicio2.cerrar()
    }
  } finally {
    await coleccionSSE?.cerrar()
    await servidor1.cerrar().catch(() => {}) // ya pudo haberse cerrado arriba; segunda llamada no debe colgar el test
    servicio1.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// La tool y el navegador comparten el mismo Engine — y la tool no cachea la IR
// ════════════════════════════════════════════════════════════════════════════════════

test("la tool (opencode/tool/vista-fisica.ts) obtiene el servicio por la MISMA via de produccion que el servidor del navegador — comparten el Engine", async () => {
  const dirActivo = nuevoDir("e2e-tool-engine")
  const idProyecto = nuevoIdProyecto()

  // "ctx.directory" simulado: la tool traduce esto a un subdirectorio de datos propio.
  const { servidor, servicio } = await obtenerServidorVistaFisica(dirActivo, idProyecto)
  try {
    assert.equal(servicio.snapshot().idProyecto, idProyecto)

    // El directorio de datos real (donde el motor persiste) es el documentado, y
    // coincide con lo que devuelve el servicio obtenido por la MISMA via de
    // produccion (servicio-con-vista.ts) directamente — es el MISMO servicio, no una
    // copia: la unica autoridad de mutacion para este proyecto.
    const directorioDatos = directorioDeDatos(dirActivo)
    const servicioPorLaVigaDeProduccion = obtenerServicioDeProyectoConVista({ directorio: directorioDatos, idProyecto })
    assert.equal(servicioPorLaVigaDeProduccion, servicio, "el servicio que devuelve la tool tiene que ser EL MISMO objeto (singleton por directorio+idProyecto) que obtendria el servidor del navegador")

    // "La tool aplica una operacion" (via el servicio que ella misma obtuvo) — se
    // tiene que ver en el GET del servidor Y disparar SSE, sin ninguna coordinacion
    // extra: es el MISMO objeto que sirve `servidor`.
    const coleccionSSE = await conectarSSE(new URL("/api/eventos", servidor.url))
    try {
      const n = servicio.snapshot().revision
      let r = servicio.aplicar({ idOperacion: "tool-op-1", actor: "agente", baseRevision: n, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } })
      assert.equal(r.ok, true, `SetPlaca via la tool rechazado: ${JSON.stringify(r.motivos)}`)

      const evento = await coleccionSSE.siguienteEvento()
      assert.equal(evento.tipo, "revision")
      assert.deepEqual(evento.datos, { revision: n + 1 })

      const rGet = await fetch(new URL("/api/proyecto", servidor.url))
      const snapshot = await rGet.json()
      assert.equal(snapshot.proyecto.placa, "esp32-devkit-v1", "la operacion aplicada VIA LA TOOL se ve en el GET del servidor (mismo Engine)")
      assert.equal(snapshot.revision, n + 1)
    } finally {
      await coleccionSSE.cerrar()
    }

    // La tool NO cachea la IR: pedirle el servidor OTRA VEZ (misma clave) devuelve el
    // MISMO handle (nunca levanta un segundo servidor), y consultando ESE handle se ve
    // el estado MAS RECIENTE (nunca un snapshot congelado de la primera llamada).
    const otraVez = await obtenerServidorVistaFisica(dirActivo, idProyecto)
    assert.equal(otraVez.servidor, servidor, "mismo servidor (Map de modulo, sin levantar un segundo listener)")
    assert.equal(otraVez.servicio, servicio, "mismo servicio")

    const revisionAntesDelCambioExterno = otraVez.servicio.snapshot().revision
    const rExterno = servicioPorLaVigaDeProduccion.aplicar({
      idOperacion: "cambio-externo-1",
      actor: "navegador",
      baseRevision: revisionAntesDelCambioExterno,
      tipo: "AgregarComponente",
      payload: { tipo: "led" },
    })
    assert.equal(rExterno.ok, true)
    assert.equal(
      otraVez.servicio.snapshot().revision,
      revisionAntesDelCambioExterno + 1,
      "el handle que devuelve la tool sigue LEYENDO EN VIVO del servicio — nunca una IR/snapshot cacheada dentro de vista-fisica.ts",
    )
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})
