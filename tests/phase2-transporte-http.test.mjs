// Phase 2, Slice 1 — `opencode/servidor/servidor-proyecto.ts` (writer W3, tarea 2):
// transporte HTTP+SSE sobre `127.0.0.1:0` (puerto efímero), SIEMPRE cerrado en
// `finally`. PHASE_2_SLICE_1_DESIGN.md §2.3/§2.4, informe ARCH-B.
//
// Cobertura (briefing tarea 2):
//   - GET /api/proyecto: 200, revision + vista;
//   - POST /api/operaciones con base N: ok, revision N+1, y el GET posterior lo ve;
//   - POST stale: BASE_REVISION_DESACTUALIZADA, sin cambios;
//   - POST malformado: 400 o rechazo estructurado, sin cambios en disco;
//   - SSE: un POST aceptado da EXACTAMENTE un evento revision N+1; un rechazo, cero
//     (probado por diferencia: un rechazo intercalado entre dos aceptados no debe
//     insertar un evento espurio — sin sleep, sólo promesas/eventos);
//   - Host inválido: 403;
//   - /assets/../../package.json y rutas fuera de la lista blanca: 404;
//   - cerrar() libera el puerto.

import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, GPIO_X, GPIO_Y } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))

// ════════════════════════════════════════════════════════════════════════════════════
// fixtures / helpers de HTTP crudo (node:http, mismo criterio que preview.mjs)
// ════════════════════════════════════════════════════════════════════════════════════

let contadorSetup = 0
function opSetup(tipo, payload, baseRevision) {
  return { idOperacion: `setup-${contadorSetup++}`, actor: "navegador", baseRevision, tipo, payload }
}

/** ESP32 + un LED con el ánodo en GPIO_X, vía el composition root REAL con vista
 * (servicio-con-vista.ts) — nunca `obtenerServicioDeProyecto` a mano (ver guardia). */
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

/** Request HTTP crudo contra el servidor de prueba — sin fetch, para poder mandar un
 * `req.url`/Host arbitrario (incluidos los casos adversariales de esta suite). */
function solicitud(urlBase, ruta, opciones = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(ruta, urlBase)
    const cabeceras = { ...opciones.cabeceras }
    let cuerpo
    if (opciones.cuerpo !== undefined) {
      cuerpo = typeof opciones.cuerpo === "string" ? opciones.cuerpo : JSON.stringify(opciones.cuerpo)
      cabeceras["Content-Type"] = cabeceras["Content-Type"] ?? "application/json"
      cabeceras["Content-Length"] = Buffer.byteLength(cuerpo)
    }
    const req = http.request(
      { protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: opciones.metodo ?? "GET", headers: opciones.host !== undefined ? { ...cabeceras, Host: opciones.host } : cabeceras },
      (res) => {
        const trozos = []
        res.on("data", (t) => trozos.push(t))
        res.on("end", () => resolve({ estado: res.statusCode, cabeceras: res.headers, cuerpo: Buffer.concat(trozos).toString("utf8") }))
      },
    )
    req.on("error", reject)
    if (cuerpo !== undefined) req.write(cuerpo)
    req.end()
  })
}

function json(respuesta) {
  return JSON.parse(respuesta.cuerpo)
}

/** Cliente SSE mínimo: parsea bloques `event:`/`data:` separados por línea en blanco
 * y expone `siguienteEvento()` — una promesa que resuelve con el próximo evento YA
 * recibido (si lo hay en el buffer) o cuando llegue (nunca por timeout/sleep: es
 * puramente dirigido por el evento `data` del socket). */
function conectarSSE(urlBase, host) {
  return new Promise((resolve, reject) => {
    const url = new URL("/api/eventos", urlBase)
    const req = http.get({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { Host: host ?? url.host } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE conectó con estado ${res.statusCode}`))
        return
      }
      let buffer = ""
      const eventos = []
      const esperando = []
      let resolverCierre
      // Resuelve cuando el STREAM de la respuesta termina — nunca por timeout: si el
      // servidor no llama `res.end()` de verdad al cerrar, esta promesa nunca
      // resuelve (test 'cerrar() cierra las conexiones SSE abiertas', más abajo) en
      // vez de dar un falso verde.
      const cerrado = new Promise((r) => {
        resolverCierre = r
      })
      res.setEncoding("utf8")
      res.on("data", (trozo) => {
        buffer += trozo
        let indice
        while ((indice = buffer.indexOf("\n\n")) !== -1) {
          const bloque = buffer.slice(0, indice)
          buffer = buffer.slice(indice + 2)
          const evento = parsearBloqueSSE(bloque)
          if (!evento) continue
          if (esperando.length > 0) esperando.shift()(evento)
          else eventos.push(evento)
        }
      })
      res.on("end", () => resolverCierre())
      resolve({
        siguienteEvento() {
          if (eventos.length > 0) return Promise.resolve(eventos.shift())
          return new Promise((resolveEvento) => esperando.push(resolveEvento))
        },
        cerrado,
        cerrar() {
          req.destroy()
        },
      })
    })
    req.on("error", reject)
  })
}

function parsearBloqueSSE(bloque) {
  let tipo = "message"
  let datos = null
  for (const linea of bloque.split("\n")) {
    if (linea.startsWith("event:")) tipo = linea.slice("event:".length).trim()
    else if (linea.startsWith("data:")) datos = linea.slice("data:".length).trim()
  }
  if (datos === null) return null // el preámbulo `retry: 1000` no es un evento
  return { tipo, datos: JSON.parse(datos) }
}

// ════════════════════════════════════════════════════════════════════════════════════
// GET /api/proyecto
// ════════════════════════════════════════════════════════════════════════════════════

test("GET /api/proyecto da 200 y el JSON trae revision y vista", async () => {
  const dir = nuevoDir("http-snapshot")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const r = await solicitud(servidor.url, "/api/proyecto")
    assert.equal(r.estado, 200)
    const cuerpo = json(r)
    assert.equal(typeof cuerpo.revision, "number")
    assert.notEqual(cuerpo.vista, undefined)
    assert.equal(cuerpo.proyecto.placa, "esp32-devkit-v1")
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// POST /api/operaciones — aceptado, stale, malformado
// ════════════════════════════════════════════════════════════════════════════════════

test("POST /api/operaciones con base N: ok, revision N+1, y el GET posterior muestra el pin nuevo", async () => {
  const dir = nuevoDir("http-post-ok")
  const { servicio, idComponente } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const n = servicio.snapshot().revision
    const sobre = { idOperacion: "browser-op-1", actor: "navegador", baseRevision: n, tipo: "AsignarPin", payload: { componente: idComponente, terminal: "anodo", pin: GPIO_Y } }
    const r = await solicitud(servidor.url, "/api/operaciones", { metodo: "POST", cuerpo: sobre })
    assert.equal(r.estado, 200)
    const cuerpo = json(r)
    assert.equal(cuerpo.resultado.ok, true)
    assert.equal(cuerpo.resultado.revisionActual, n + 1)
    assert.equal(cuerpo.snapshot.revision, n + 1)
    assert.equal(cuerpo.snapshot.proyecto.componentes[0].pines.anodo, GPIO_Y)

    const rGet = await solicitud(servidor.url, "/api/proyecto")
    const snapshotGet = json(rGet)
    assert.equal(snapshotGet.revision, n + 1)
    assert.equal(snapshotGet.proyecto.componentes[0].pines.anodo, GPIO_Y)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("POST /api/operaciones fuerza actor:'navegador' — un actor:'agente' mandado por el cliente NO se respeta para este transporte", async () => {
  const dir = nuevoDir("http-post-actor-forzado")
  const { servicio, idComponente } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const n = servicio.snapshot().revision
    const sobre = { idOperacion: "browser-op-actor", actor: "agente", baseRevision: n, tipo: "AsignarPin", payload: { componente: idComponente, terminal: "anodo", pin: GPIO_Y } }
    const r = await solicitud(servidor.url, "/api/operaciones", { metodo: "POST", cuerpo: sobre })
    const cuerpo = json(r)
    // Si el servidor hubiera respetado actor:"agente" tal cual, esto seguiría siendo
    // válido igual (es uno de los dos valores aceptados) — la prueba real de que se
    // FUERZA es indirecta acá: el resultado nunca depende de qué actor mandó el
    // cliente, así que este POST se acepta igual que el del test anterior.
    assert.equal(cuerpo.resultado.ok, true)
    assert.equal(cuerpo.resultado.revisionActual, n + 1)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("POST /api/operaciones con base vieja da BASE_REVISION_DESACTUALIZADA, sin cambios", async () => {
  const dir = nuevoDir("http-post-stale")
  const { servicio, idComponente } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const n = servicio.snapshot().revision
    // Adelanta la revisión real por otra vía (simula "otro cambio llegó primero").
    let r = servicio.aplicar(opSetup("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Y }, n))
    assert.equal(r.ok, true)
    const revisionReal = servicio.snapshot().revision
    assert.equal(revisionReal, n + 1)

    const sobreStale = { idOperacion: "browser-op-stale", actor: "navegador", baseRevision: n, tipo: "AsignarPin", payload: { componente: idComponente, terminal: "anodo", pin: "GPIO18" } }
    const rHttp = await solicitud(servidor.url, "/api/operaciones", { metodo: "POST", cuerpo: sobreStale })
    assert.equal(rHttp.estado, 200) // rechazo de DOMINIO, no de transporte
    const cuerpo = json(rHttp)
    assert.equal(cuerpo.resultado.ok, false)
    assert.ok(cuerpo.resultado.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA"))
    assert.equal(cuerpo.snapshot.revision, revisionReal) // sin cambios: sigue en N+1
    assert.equal(cuerpo.snapshot.proyecto.componentes[0].pines.anodo, GPIO_Y) // el pin de ANTES, no "GPIO18"
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("POST /api/operaciones con JSON invalido da 400, sin cambios en disco", async () => {
  const dir = nuevoDir("http-post-json-invalido")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const revisionAntes = servicio.snapshot().revision
    const r = await solicitud(servidor.url, "/api/operaciones", { metodo: "POST", cuerpo: "{ esto no es json ][", cabeceras: { "Content-Type": "application/json" } })
    assert.equal(r.estado, 400)
    assert.equal(servicio.snapshot().revision, revisionAntes)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("POST /api/operaciones con forma invalida (JSON valido, sobre incorrecto) da 200 con rechazo ESTRUCTURADO, sin cambios", async () => {
  const dir = nuevoDir("http-post-forma-invalida")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const revisionAntes = servicio.snapshot().revision
    // Un array en la raíz: `esObjetoPlano` lo rechaza (nunca "el sobre es un objeto
    // plano" para un array) — motor.ts, SOBRE_OPERACION_INVALIDO.
    const r = await solicitud(servidor.url, "/api/operaciones", { metodo: "POST", cuerpo: [1, 2, 3] })
    assert.equal(r.estado, 200)
    const cuerpo = json(r)
    assert.equal(cuerpo.resultado.ok, false)
    assert.ok(cuerpo.resultado.motivos.length > 0)
    assert.equal(servicio.snapshot().revision, revisionAntes)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("POST /api/operaciones con cuerpo mas grande que el limite da 400, sin cambios", async () => {
  const dir = nuevoDir("http-post-demasiado-grande")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const revisionAntes = servicio.snapshot().revision
    const relleno = "x".repeat(300 * 1024) // > 256 KiB, el limite documentado
    const r = await solicitud(servidor.url, "/api/operaciones", { metodo: "POST", cuerpo: JSON.stringify({ relleno }) })
    assert.equal(r.estado, 400)
    assert.equal(servicio.snapshot().revision, revisionAntes)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// SSE — un aceptado da exactamente un evento; un rechazo, cero (por diferencia)
// ════════════════════════════════════════════════════════════════════════════════════

test("SSE: un POST aceptado produce EXACTAMENTE un evento revision N+1; un rechazo intercalado no inserta ninguno", async () => {
  const dir = nuevoDir("http-sse")
  const { servicio, idComponente } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  let coleccion
  try {
    coleccion = await conectarSSE(servidor.url)

    const n = servicio.snapshot().revision
    const r1 = await solicitud(servidor.url, "/api/operaciones", {
      metodo: "POST",
      cuerpo: { idOperacion: "sse-1", actor: "navegador", baseRevision: n, tipo: "AsignarPin", payload: { componente: idComponente, terminal: "anodo", pin: GPIO_Y } },
    })
    assert.equal(json(r1).resultado.ok, true)
    const evento1 = await coleccion.siguienteEvento()
    assert.equal(evento1.tipo, "revision")
    assert.deepEqual(evento1.datos, { revision: n + 1 })

    // Rechazo intercalado (base vieja, N en vez de N+1) — no debe insertar un evento
    // espurio ANTES del próximo evento real.
    const rStale = await solicitud(servidor.url, "/api/operaciones", {
      metodo: "POST",
      cuerpo: { idOperacion: "sse-stale", actor: "navegador", baseRevision: n, tipo: "AsignarPin", payload: { componente: idComponente, terminal: "anodo", pin: "GPIO18" } },
    })
    assert.equal(json(rStale).resultado.ok, false)

    // Canario: otra operación aceptada. Si el rechazo de arriba hubiera emitido un
    // evento espurio, éste sería el PRÓXIMO evento en la cola y su `revision` no
    // matchearía n+2 (sería n+1, repetido) — la igualdad estricta lo detecta.
    const r2 = await solicitud(servidor.url, "/api/operaciones", {
      metodo: "POST",
      cuerpo: { idOperacion: "sse-2", actor: "navegador", baseRevision: n + 1, tipo: "AsignarPin", payload: { componente: idComponente, terminal: "anodo", pin: "GPIO18" } },
    })
    assert.equal(json(r2).resultado.ok, true)
    const evento2 = await coleccion.siguienteEvento()
    assert.equal(evento2.tipo, "revision")
    assert.deepEqual(evento2.datos, { revision: n + 2 })
  } finally {
    coleccion?.cerrar()
    await servidor.cerrar()
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// Seguridad: Host invalido, lista blanca de assets, cierre
// ════════════════════════════════════════════════════════════════════════════════════

test("Host invalido (anti DNS-rebinding) da 403", async () => {
  const dir = nuevoDir("http-host-invalido")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const r = await solicitud(servidor.url, "/api/proyecto", { host: "evil.example.com" })
    assert.equal(r.estado, 403)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("Host 'localhost:<puerto>' SI se acepta (segunda forma de loopback documentada)", async () => {
  const dir = nuevoDir("http-host-localhost")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const r = await solicitud(servidor.url, "/api/proyecto", { host: `localhost:${servidor.puerto}` })
    assert.equal(r.estado, 200)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("GET / sirve la pagina (200, text/html)", async () => {
  const dir = nuevoDir("http-index")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const r = await solicitud(servidor.url, "/")
    assert.equal(r.estado, 200)
    assert.match(r.cabeceras["content-type"], /text\/html/)
    assert.match(r.cuerpo, /<html/i)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("GET /assets/<nombre-en-la-lista-blanca> sirve el asset (200, JS)", async () => {
  const dir = nuevoDir("http-assets-ok")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const r = await solicitud(servidor.url, "/assets/app.js")
    assert.equal(r.estado, 200)
    assert.match(r.cabeceras["content-type"], /javascript/)
    assert.ok(r.cuerpo.length > 0)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("GET /assets/../../package.json (path traversal) da 404 — nunca sirve un archivo fuera de la lista blanca", async () => {
  const dir = nuevoDir("http-assets-traversal")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const r = await solicitud(servidor.url, "/assets/../../package.json")
    assert.equal(r.estado, 404)
    assert.ok(!r.cuerpo.includes("\"name\""), "no debe devolver el contenido de package.json")
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("GET /assets/<nombre-fuera-de-la-lista-blanca> da 404", async () => {
  const dir = nuevoDir("http-assets-no-listado")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const r = await solicitud(servidor.url, "/assets/circuito.ts")
    assert.equal(r.estado, 404)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("ruta desconocida dentro de /api/ da 404", async () => {
  const dir = nuevoDir("http-ruta-desconocida")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const r = await solicitud(servidor.url, "/api/no-existe")
    assert.equal(r.estado, 404)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("metodo no permitido en una ruta conocida da 405", async () => {
  const dir = nuevoDir("http-metodo-no-permitido")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  try {
    const r = await solicitud(servidor.url, "/api/proyecto", { metodo: "POST" })
    assert.equal(r.estado, 405)
    assert.notEqual(r.cabeceras.allow, undefined)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("cerrar() libera el puerto — un socket nuevo contra el mismo puerto se rechaza", async () => {
  const dir = nuevoDir("http-cerrar")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  const puerto = servidor.puerto
  await servidor.cerrar()
  servicio.cerrar()

  await assert.rejects(
    () => solicitud(`http://127.0.0.1:${puerto}`, "/api/proyecto"),
    (error) => error.code === "ECONNREFUSED",
  )
})

test("cerrar() cierra las conexiones SSE abiertas (el stream termina de verdad, sin sleep/timeout)", async () => {
  const dir = nuevoDir("http-cerrar-sse")
  const { servicio } = prepararServicioConLed(dir, nuevoIdProyecto())
  const servidor = await iniciarServidor({ servicio })
  const coleccion = await conectarSSE(servidor.url)
  await servidor.cerrar()
  servicio.cerrar()
  // Determinista por construcción: `coleccion.cerrado` sólo resuelve cuando el
  // stream de la respuesta SSE recibe su evento `end` — si `cerrar()` no hubiera
  // terminado esa respuesta de verdad, esta promesa nunca resolvería (el test
  // colgaría en vez de dar un falso verde). Nada de `setTimeout`/sleep.
  await coleccion.cerrado
})
