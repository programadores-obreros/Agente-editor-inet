// Phase 3 — Vertical semántico #1, T4a: lista blanca de operaciones del NAVEGADOR en el
// servidor HTTP (contrato B7). AsignarPin / SetComportamiento / QuitarComportamiento;
// cualquier otro `tipo` -> HTTP 200 con rechazo de TRANSPORTE, sin invocar al Engine.

import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, GPIO_X, GPIO_Y } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { cargarProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { readFileSync, readdirSync } = await import("node:fs")

const TRIADA = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }

let contador = 0
const sobre = (tipo, payload, baseRevision) => ({ idOperacion: `p3-http-${contador++}`, actor: "navegador", baseRevision, tipo, payload })

function solicitud(urlBase, ruta, { metodo = "GET", cuerpo, cabeceras = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(ruta, urlBase)
    const h = { ...cabeceras }
    let texto
    if (cuerpo !== undefined) {
      texto = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo)
      h["Content-Type"] = h["Content-Type"] ?? "application/json"
      h["Content-Length"] = Buffer.byteLength(texto)
    }
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: metodo, headers: h }, (res) => {
      const trozos = []
      res.on("data", (t) => trozos.push(t))
      res.on("end", () => resolve({ estado: res.statusCode, cuerpo: Buffer.concat(trozos).toString("utf8") }))
    })
    req.on("error", reject)
    if (texto !== undefined) req.write(texto)
    req.end()
  })
}

/** ESP32 + LED + pulsador; el servicio se envuelve con un espía de `aplicar`. */
async function preparar() {
  const directorio = nuevoDir("p3-http")
  const idProyecto = nuevoIdProyecto("p3-http")
  const servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  const paso = (tipo, payload) => {
    const r = servicio.aplicar(sobre(tipo, payload, servicio.snapshot().revision))
    assert.equal(r.ok, true, JSON.stringify(r.motivos))
  }
  paso("SetPlaca", { placa: "esp32-devkit-v1" })
  paso("AgregarComponente", { tipo: "led" })
  paso("AgregarComponente", { tipo: "pulsador" })
  const [led, pulsador] = servicio.snapshot().proyecto.componentes.map((c) => c.id)
  paso("AsignarPin", { componente: led, terminal: "anodo", pin: GPIO_X })
  paso("AsignarPin", { componente: pulsador, terminal: "senal", pin: GPIO_Y })
  let llamadas = 0
  const espiado = { ...servicio, aplicar: (...a) => (llamadas++, servicio.aplicar(...a)) }
  const servidor = await iniciarServidor({ servicio: espiado })
  return { servicio, servidor, led, pulsador, directorio, idProyecto, llamadas: () => llamadas }
}
const post = (ctx, cuerpo) => solicitud(ctx.servidor.url, "/api/operaciones", { metodo: "POST", cuerpo, cabeceras: { Origin: `http://127.0.0.1:${ctx.servidor.puerto}` } })
const reglaCompleta = (ctx) => ({ cuando: { sensor: ctx.pulsador, ...TRIADA }, entonces: { actuador: ctx.led, accion: "encender" } })
async function cerrar(ctx) {
  await ctx.servidor.cerrar()
  ctx.servicio.cerrar()
}

const NO_PERMITIDAS = [
  ["SetPlaca", { placa: "arduino-uno" }],
  ["AgregarComponente", { tipo: "led" }],
  ["QuitarComponente", (c) => ({ componente: c.led })],
  ["Conectar", (c) => ({ desde: { componente: c.led, terminal: "anodo" }, hasta: { componente: c.pulsador, terminal: "senal" } })],
  ["Desconectar", { conexion: "conn-0" }],
  ["CambiarComponente", (c) => ({ componente: c.led, tipoNuevo: "led" })],
  ["TipoQueNoExiste", {}],
]
for (const [tipo, payload] of NO_PERMITIDAS) {
  test(`T4a ${tipo} por HTTP: OPERACION_NO_PERMITIDA_EN_NAVEGADOR, 200, sin Engine, sin cambios en revisión ni disco`, async () => {
    const ctx = await preparar()
    try {
      const antes = ctx.servicio.snapshot()
      const llamadasAntes = ctx.llamadas()
      const r = await post(ctx, sobre(tipo, typeof payload === "function" ? payload(ctx) : payload, antes.revision))
      assert.equal(r.estado, 200)
      const cuerpo = JSON.parse(r.cuerpo)
      assert.equal(cuerpo.resultado.ok, false)
      assert.equal(cuerpo.resultado.rechazadoPor, "transporte")
      assert.equal(cuerpo.resultado.motivos.length, 1)
      const m = cuerpo.resultado.motivos[0]
      assert.equal(m.codigo, "OPERACION_NO_PERMITIDA_EN_NAVEGADOR")
      assert.equal(m.categoria, "operacion")
      assert.equal(m.severidad, "blocking")
      assert.equal(m.clasificacion, "rechazo")
      assert.deepEqual(m.datos, { tipo })
      assert.equal(cuerpo.snapshot.revision, antes.revision)
      assert.equal(ctx.llamadas(), llamadasAntes, "el Engine NO se invoca")
      assert.equal(ctx.servicio.snapshot().revision, antes.revision)
      assert.deepEqual(ctx.servicio.snapshot().proyecto, antes.proyecto)
    } finally {
      await cerrar(ctx)
    }
  })
}

test("T4a SetComportamiento completa por HTTP: commit, revisión +1 y el snapshot del servidor trae reglas[0].texto", async () => {
  const ctx = await preparar()
  try {
    const n = ctx.servicio.snapshot().revision
    const r = await post(ctx, sobre("SetComportamiento", { comportamiento: reglaCompleta(ctx) }, n))
    const cuerpo = JSON.parse(r.cuerpo)
    assert.equal(cuerpo.resultado.ok, true, JSON.stringify(cuerpo.resultado.motivos))
    assert.equal(cuerpo.snapshot.revision, n + 1)
    assert.equal(cuerpo.snapshot.proyecto.comportamientos.length, 1)
    assert.equal(cuerpo.snapshot.vista.reglas[0].texto, "Mientras el Pulsador esté presionado, el LED está encendido.")
  } finally {
    await cerrar(ctx)
  }
})

test("T4a QuitarComportamiento por HTTP: la regla desaparece (y queda así tras recargar el documento)", async () => {
  const ctx = await preparar()
  try {
    let n = ctx.servicio.snapshot().revision
    await post(ctx, sobre("SetComportamiento", { comportamiento: reglaCompleta(ctx) }, n))
    n = ctx.servicio.snapshot().revision
    const id = ctx.servicio.snapshot().proyecto.comportamientos[0].id
    const r = await post(ctx, sobre("QuitarComportamiento", { comportamiento: id }, n))
    const cuerpo = JSON.parse(r.cuerpo)
    assert.equal(cuerpo.resultado.ok, true, JSON.stringify(cuerpo.resultado.motivos))
    assert.equal(cuerpo.snapshot.revision, n + 1)
    assert.deepEqual(cuerpo.snapshot.proyecto.comportamientos, [])
    assert.deepEqual(cuerpo.snapshot.vista.reglas, [])
  } finally {
    await cerrar(ctx)
  }
})

test("T4a baseRevision desactualizada en SetComportamiento por HTTP: BASE_REVISION_DESACTUALIZADA, sin cambios", async () => {
  const ctx = await preparar()
  try {
    const n = ctx.servicio.snapshot().revision
    const r = await post(ctx, sobre("SetComportamiento", { comportamiento: reglaCompleta(ctx) }, n - 1))
    const cuerpo = JSON.parse(r.cuerpo)
    assert.equal(cuerpo.resultado.ok, false)
    assert.ok(cuerpo.resultado.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA"))
    assert.equal(ctx.servicio.snapshot().revision, n)
  } finally {
    await cerrar(ctx)
  }
})

test("T4a el evento de revisión del servicio sale una vez por Set/Quitar aceptado y ninguna por un rechazo de transporte", async () => {
  const ctx = await preparar()
  try {
    const eventos = []
    const desuscribir = ctx.servicio.suscribir((e) => eventos.push(e.revision))
    let n = ctx.servicio.snapshot().revision
    await post(ctx, sobre("SetPlaca", { placa: "arduino-uno" }, n))
    assert.deepEqual(eventos, [])
    await post(ctx, sobre("SetComportamiento", { comportamiento: reglaCompleta(ctx) }, n))
    assert.deepEqual(eventos, [n + 1])
    const id = ctx.servicio.snapshot().proyecto.comportamientos[0].id
    await post(ctx, sobre("QuitarComportamiento", { comportamiento: id }, n + 1))
    assert.deepEqual(eventos, [n + 1, n + 2])
    desuscribir()
  } finally {
    await cerrar(ctx)
  }
})

test("T4a un cuerpo que NO es un objeto plano sigue yendo al Engine (rechazo estructurado del núcleo, no de transporte)", async () => {
  const ctx = await preparar()
  try {
    const antes = ctx.llamadas()
    const r = await post(ctx, [1, 2, 3])
    const cuerpo = JSON.parse(r.cuerpo)
    assert.equal(r.estado, 200)
    assert.equal(ctx.llamadas(), antes + 1)
    assert.notEqual(cuerpo.resultado.rechazadoPor, "transporte")
    assert.equal(cuerpo.resultado.ok, false)
  } finally {
    await cerrar(ctx)
  }
})

test("T4a Origin ajeno y Content-Type no JSON se rechazan ANTES que la lista blanca (403 / 415)", async () => {
  const ctx = await preparar()
  try {
    const s = sobre("SetPlaca", { placa: "arduino-uno" }, ctx.servicio.snapshot().revision)
    let r = await solicitud(ctx.servidor.url, "/api/operaciones", { metodo: "POST", cuerpo: s, cabeceras: { Origin: "http://evil.example" } })
    assert.equal(r.estado, 403)
    r = await solicitud(ctx.servidor.url, "/api/operaciones", { metodo: "POST", cuerpo: JSON.stringify(s), cabeceras: { Origin: `http://127.0.0.1:${ctx.servidor.puerto}`, "Content-Type": "text/plain" } })
    assert.equal(r.estado, 415)
  } finally {
    await cerrar(ctx)
  }
})
