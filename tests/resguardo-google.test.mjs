// Tests del resguardo ante el corte de Google a mitad de respuesta
// (opencode/plugins/resguardo/google.ts y opencode/plugins/tecnia-resguardo.ts).
// Corre con: node --test tests/resguardo-google.test.mjs   (Node 24+, importa el .ts directo).
//
// DE DÓNDE SALEN LOS DATOS. Los trozos de abajo copian la forma de lo que Google
// mandó de verdad el 2026-11-24 a una notebook Windows (capturado con un proxy
// local delante de OpenCode 1.18.18): 200, trozos de pensamiento con
// `"thought": true`, y el corte como `data: {"error": {...503...}}` seguido del
// mismo JSON suelto, sin `data:` y sin `finishReason`.
//
// UNA TRAMPA EN LA QUE YA CAÍ, PARA QUE NO SE REPITA. La primera versión del
// servidor falso con el que medí esto aceptaba cualquier pedido. Con él,
// OpenCode 1.19.6 "se recuperaba sola" del corte. Era mentira: 1.19.6 no
// reintenta, sigue el bucle agregando el turno vacío del asistente, y Google
// real rechaza ese pedido con 400. El falso no validaba lo que Google valida.
// Por eso acá los reintentos se comprueban mirando QUÉ se pidió (el mismo
// `input` y el mismo `init`, no uno distinto), no sólo que al final haya texto.
//
// Mutaciones corridas sobre una copia fuera del repo: ver el commit.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const PLUGINS = join(REPO, "opencode/plugins")
const { conResguardo, avisoSaturado, AVISO_CORTADO, trozoDeAviso, esperaPorDefecto, REINTENTOS_POR_DEFECTO } =
  await import(join(PLUGINS, "resguardo/google.ts"))
const plugin = await import(join(PLUGINS, "tecnia-resguardo.ts"))

const URL_STREAM =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse"

// --- trozos con la forma de Google -----------------------------------------
const dato = (o) => `data: ${JSON.stringify(o)}\r\n\r\n`
const pensamiento = (t) =>
  dato({ candidates: [{ content: { parts: [{ text: t, thought: true }], role: "model" }, index: 0 }] })
const texto = (t, fin) =>
  dato({ candidates: [{ content: { parts: [{ text: t }], role: "model" }, ...(fin ? { finishReason: "STOP" } : {}), index: 0 }] })
const llamada = (nombre) =>
  dato({ candidates: [{ content: { parts: [{ functionCall: { name: nombre, args: {} } }], role: "model" }, index: 0 }] })
const ERROR = { error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" } }
// Tal cual lo manda Google: el trozo con `data:` y después el JSON suelto.
const CORTE = dato(ERROR) + JSON.stringify(ERROR, null, 2) + "\n"

const BIEN = [pensamiento("pienso"), texto("Hola, ", false), texto("docente.", true)]
const CORTADA_SIN_NADA = [pensamiento("pienso"), CORTE]

function respuesta(trozos, { estado = 200 } = {}) {
  const cod = new TextEncoder()
  const cuerpo = new ReadableStream({
    start(c) {
      for (const t of trozos) c.enqueue(cod.encode(t))
      c.close()
    },
  })
  return new Response(cuerpo, { status: estado, headers: { "content-type": "text/event-stream", "content-length": "999" } })
}

/** Un `fetch` falso que devuelve, en orden, lo que haya en `guion`, y anota cada pedido. */
function base(guion) {
  const pedidos = []
  const buscar = async (input, init) => {
    pedidos.push({ input, init })
    const paso = guion[Math.min(pedidos.length - 1, guion.length - 1)]
    if (paso instanceof Error) throw paso
    return typeof paso === "function" ? paso() : respuesta(paso)
  }
  return { buscar, pedidos }
}

function armar(guion, extra = {}) {
  const { buscar, pedidos } = base(guion)
  const esperas = []
  const anotado = []
  const resguardado = conResguardo(buscar, {
    reintentos: REINTENTOS_POR_DEFECTO,
    esperaMs: esperaPorDefecto,
    esperar: async (ms) => void esperas.push(ms),
    anotar: (m, e) => void anotado.push({ m, e }),
    ...extra,
  })
  return { resguardado, pedidos, esperas, anotado }
}

/** Lo que el SDK leería: cada evento `data:` ya parseado, en orden. */
async function eventos(resp) {
  const crudo = await resp.text()
  return crudo
    .split(/\r?\n\r?\n/)
    .filter((e) => e.length > 0)
    .map((e) => {
      assert.ok(e.startsWith("data: "), `al SDK sólo le pueden llegar eventos data:, llegó: ${e.slice(0, 60)}`)
      return JSON.parse(e.slice(6))
    })
}
const textoVisible = (evs) =>
  evs
    .flatMap((e) => e.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
const motivoDeFin = (evs) => evs.at(-1)?.candidates?.[0]?.finishReason

// ---------------------------------------------------------------------------
// Cuándo NO interviene
// ---------------------------------------------------------------------------

test("un pedido que no es el stream de generación pasa sin tocar: devuelve la MISMA respuesta", async () => {
  const original = respuesta(CORTADA_SIN_NADA)
  const { resguardado, pedidos } = armar([() => original])
  const r = await resguardado("https://generativelanguage.googleapis.com/v1beta/models/x:generateContent", {})
  assert.equal(r, original)
  assert.equal(pedidos.length, 1)
})

test("un error HTTP pasa sin tocar: ése OpenCode ya lo sabe reintentar", async () => {
  const original = respuesta(["{}"], { estado: 503 })
  const { resguardado, pedidos, esperas } = armar([() => original])
  const r = await resguardado(URL_STREAM, {})
  assert.equal(r, original)
  assert.equal(r.status, 503)
  assert.equal(pedidos.length, 1)
  assert.deepEqual(esperas, [])
})

test("una respuesta sana llega entera, con un solo pedido y sin esperas ni anotaciones", async () => {
  const { resguardado, pedidos, esperas, anotado } = armar([BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(evs.length, 3)
  assert.equal(textoVisible(evs), "Hola, docente.")
  assert.equal(motivoDeFin(evs), "STOP")
  assert.equal(pedidos.length, 1)
  assert.deepEqual(esperas, [])
  assert.deepEqual(anotado, [])
})

test("acepta la URL como string, como URL y como Request", async () => {
  for (const input of [URL_STREAM, new URL(URL_STREAM), new Request(URL_STREAM, { method: "POST" })]) {
    const { resguardado, pedidos } = armar([CORTADA_SIN_NADA, BIEN])
    const evs = await eventos(await resguardado(input, {}))
    assert.equal(textoVisible(evs), "Hola, docente.")
    assert.equal(pedidos.length, 2, "el corte se tiene que haber visto y reintentado")
  }
})

// ---------------------------------------------------------------------------
// El corte sin nada visible: se reintenta
// ---------------------------------------------------------------------------

test("corte con sólo pensamiento: repite EL MISMO pedido y entrega la respuesta nueva", async () => {
  const { resguardado, pedidos, esperas, anotado } = armar([CORTADA_SIN_NADA, BIEN])
  const init = { method: "POST", body: '{"contents":[]}' }
  const evs = await eventos(await resguardado(URL_STREAM, init))
  assert.equal(textoVisible(evs), "Hola, docente.")
  assert.equal(motivoDeFin(evs), "STOP")
  // No es un pedido parecido: es el mismo. Un turno vacío agregado al final es lo que Google rechaza con 400.
  assert.equal(pedidos.length, 2)
  assert.equal(pedidos[1].input, pedidos[0].input)
  assert.equal(pedidos[1].init, init)
  assert.deepEqual(esperas, [2000])
  assert.equal(anotado.length, 1)
  assert.deepEqual(anotado[0].e, { cortes: 1, visible: false })
})

test("el trozo de error y el JSON suelto que lo sigue NO le llegan al SDK", async () => {
  const { resguardado } = armar([CORTADA_SIN_NADA, BIEN])
  const crudo = await (await resguardado(URL_STREAM, {})).text()
  assert.equal(crudo.includes('"error"'), false)
  assert.equal(crudo.includes("UNAVAILABLE"), false)
  // eventos() además exige que todo lo que llegue empiece con `data: `.
})

test("un stream que se acaba sin finishReason y sin error también es un corte", async () => {
  const { resguardado, pedidos } = armar([[pensamiento("pienso")], BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(textoVisible(evs), "Hola, docente.")
  assert.equal(pedidos.length, 2)
})

test("eventos partidos entre lecturas y con \\n\\n en vez de \\r\\n\\r\\n se entienden igual", async () => {
  // POR QUÉ ESTE TEST ES ASÍ. La primera versión partía una respuesta CORTADA y pedía que se
  // reintentara. Era hueca: si el lector pierde los pedazos, el stream igual termina sin
  // finishReason y se reintenta por la otra regla (mutación `pendiente = ""`: seguía verde).
  // Una respuesta SANA partida sí distingue: si se pierde un pedazo ya no llega entera.
  const entero = BIEN.join("").replaceAll("\r\n", "\n")
  const pedazos = []
  for (let i = 0; i < entero.length; i += 11) pedazos.push(entero.slice(i, i + 11))
  const { resguardado, pedidos, esperas } = armar([pedazos, [texto("OTRA RESPUESTA", true)]])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(evs.length, 3)
  assert.equal(textoVisible(evs), "Hola, docente.")
  assert.equal(pedidos.length, 1, "una respuesta sana partida en pedazos no es un corte")
  assert.deepEqual(esperas, [])
})

test("el error partido entre dos lecturas se detecta igual, y no se confunde con texto", async () => {
  const entero = pensamiento("pienso") + texto("visible", false) + CORTE
  const medio = entero.indexOf('"error"') + 3
  const { resguardado, anotado } = armar([[entero.slice(0, medio), entero.slice(medio)]])
  const crudo = await (await resguardado(URL_STREAM, {})).text()
  assert.equal(crudo.includes("UNAVAILABLE"), false, "el error partido no puede colarse al SDK")
  assert.deepEqual(anotado[0].e, { cortes: 1, visible: true })
})

test("si el reintento contesta un error HTTP cuenta como otro corte y sigue intentando", async () => {
  const { resguardado, pedidos, esperas, anotado } = armar([
    CORTADA_SIN_NADA,
    () => respuesta(["{}"], { estado: 503 }),
    BIEN,
  ])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(textoVisible(evs), "Hola, docente.")
  assert.equal(pedidos.length, 3)
  assert.deepEqual(esperas, [2000, 4000])
  assert.ok(anotado.some((a) => a.e?.estado === 503))
})

// ---------------------------------------------------------------------------
// Se agotan los reintentos: aviso, no silencio
// ---------------------------------------------------------------------------

test("si Google corta siempre: 1 pedido + 3 reintentos, esperas 2/4/8 s, y cierra con el aviso", async () => {
  const { resguardado, pedidos, esperas } = armar([CORTADA_SIN_NADA])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 4)
  assert.deepEqual(esperas, [2000, 4000, 8000])
  assert.equal(textoVisible(evs), avisoSaturado(4))
  assert.equal(motivoDeFin(evs), "STOP", "sin finishReason OpenCode volvería a leer 'unknown' y quedaría mudo")
})

test("el aviso dice de entrada que no lo escribió el modelo, y dice qué hacer", () => {
  for (const aviso of [avisoSaturado(4), AVISO_CORTADO]) {
    assert.match(aviso, /Aviso de Tecnia Bot \(esto no lo escribió el modelo\)/)
    assert.match(aviso, /[Mm]andá de nuevo tu mensaje/)
  }
  assert.match(avisoSaturado(4), /4 veces seguidas/)
  // No promete lo que no sabe: no dice que el proyecto quedó intacto ni que ya se arregló.
  assert.doesNotMatch(avisoSaturado(4) + AVISO_CORTADO, /no cambió|no se perdió|listo|ya está/i)
})

test("la cantidad de reintentos se respeta: con 1, son 2 pedidos y el aviso dice 2", async () => {
  const { resguardado, pedidos } = armar([CORTADA_SIN_NADA], { reintentos: 1 })
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 2)
  assert.equal(textoVisible(evs), avisoSaturado(2))
})

// ---------------------------------------------------------------------------
// El corte con algo ya visible: NO se reintenta
// ---------------------------------------------------------------------------

test("corte después de texto visible: no repite (duplicaría el texto) y avisa que quedó cortado", async () => {
  const { resguardado, pedidos, esperas, anotado } = armar([[pensamiento("pienso"), texto("El LED va en ", false), CORTE], BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 1)
  assert.deepEqual(esperas, [])
  assert.equal(textoVisible(evs), "El LED va en " + AVISO_CORTADO)
  assert.equal(motivoDeFin(evs), "STOP")
  assert.deepEqual(anotado[0].e, { cortes: 1, visible: true })
})

test("corte después de una llamada a herramienta: no repite (la ejecutaría dos veces)", async () => {
  const { resguardado, pedidos } = armar([[pensamiento("pienso"), llamada("proyecto-fisico"), CORTE], BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 1)
  const partes = evs.flatMap((e) => e.candidates?.[0]?.content?.parts ?? [])
  assert.equal(partes.filter((p) => p.functionCall).length, 1, "la llamada llega una sola vez")
  assert.equal(motivoDeFin(evs), "STOP")
})

test("el pensamiento y el texto vacío NO cuentan como visible: ahí sí se reintenta", async () => {
  const { resguardado, pedidos } = armar([[pensamiento("mucho pensamiento"), texto("", false), CORTE], BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 2)
  assert.equal(textoVisible(evs), "Hola, docente.")
})

// ---------------------------------------------------------------------------
// Cancelar y fallar
// ---------------------------------------------------------------------------

test("si el usuario cancela durante la espera, el stream falla con ese motivo y no se pide más", async () => {
  const control = new AbortController()
  const { buscar, pedidos } = base([CORTADA_SIN_NADA, BIEN])
  const resguardado = conResguardo(buscar, {
    reintentos: 3,
    esperaMs: () => 60_000,
    // esperar por defecto: la de verdad, que tiene que cortarse sola con la señal.
  })
  const r = await resguardado(URL_STREAM, { signal: control.signal })
  const leyendo = r.text()
  setTimeout(() => control.abort(new Error("Esc del docente")), 20)
  await assert.rejects(leyendo, /Esc del docente/)
  assert.equal(pedidos.length, 1)
})

test("si el reintento revienta (se cayó la red), el error le llega a OpenCode: no se tapa con un aviso", async () => {
  const { resguardado, pedidos } = armar([CORTADA_SIN_NADA, new Error("ECONNRESET")])
  await assert.rejects((await resguardado(URL_STREAM, {})).text(), /ECONNRESET/)
  assert.equal(pedidos.length, 2)
})

test("la respuesta envuelta conserva estado y tipo, y suelta el largo viejo", async () => {
  const { resguardado } = armar([BIEN])
  const r = await resguardado(URL_STREAM, {})
  assert.equal(r.status, 200)
  assert.equal(r.headers.get("content-type"), "text/event-stream")
  assert.equal(r.headers.get("content-length"), null, "el cuerpo cambió: el largo original ya no vale")
  await r.text()
})

test("trozoDeAviso arma un evento que el SDK entiende: texto del modelo con finishReason STOP", () => {
  const t = trozoDeAviso("hola")
  assert.ok(t.startsWith("data: ") && t.endsWith("\r\n\r\n"))
  const j = JSON.parse(t.slice(6))
  assert.deepEqual(j.candidates[0].content, { parts: [{ text: "hola" }], role: "model" })
  assert.equal(j.candidates[0].finishReason, "STOP")
})

test("las esperas por defecto son 2, 4 y 8 segundos, y los reintentos 3", () => {
  assert.deepEqual([1, 2, 3].map(esperaPorDefecto), [2000, 4000, 8000])
  assert.equal(REINTENTOS_POR_DEFECTO, 3)
})

// ---------------------------------------------------------------------------
// El plugin: forma de carga y enganche
// ---------------------------------------------------------------------------

test("exporta SÓLO default { id, server }, como pide OpenCode a un plugin de archivo", () => {
  assert.deepEqual(Object.keys(plugin), ["default"])
  assert.equal(plugin.default.id, "tecnia-resguardo")
  assert.equal(typeof plugin.default.server, "function")
})

test("la lógica vive en una subcarpeta: en plugins/ de primer nivel sólo hay plugins cargables", () => {
  const cargables = readdirSync(PLUGINS).filter((f) => /\.(ts|js)$/.test(f)).sort()
  assert.deepEqual(cargables, ["tecnia-idioma.ts", "tecnia-resguardo.ts"])
})

async function hookConfig() {
  const logs = []
  const client = { app: { log: async (o) => void logs.push(o) } }
  const h = await plugin.default.server({ client, directory: "/tmp", worktree: "/tmp" })
  return { config: h.config, logs }
}

test("el hook config pone el fetch en provider.google y no toca a los otros proveedores", async () => {
  const { config } = await hookConfig()
  const cfg = { provider: { opencode: { options: { x: 1 } } } }
  await config(cfg)
  assert.equal(typeof cfg.provider.google.options.fetch, "function")
  assert.deepEqual(cfg.provider.opencode, { options: { x: 1 } })
  // Y sin sección provider previa también anda.
  const vacio = {}
  await config(vacio)
  assert.equal(typeof vacio.provider.google.options.fetch, "function")
})

test("el hook config conserva las otras opciones de google (la baseURL del docente, por ejemplo)", async () => {
  const { config } = await hookConfig()
  const cfg = { provider: { google: { options: { baseURL: "http://otra", apiKey: "k" } } } }
  await config(cfg)
  assert.equal(cfg.provider.google.options.baseURL, "http://otra")
  assert.equal(cfg.provider.google.options.apiKey, "k")
})

test("si ya había un fetch puesto lo envuelve en vez de pisarlo, y el resguardo actúa sobre él", async () => {
  const { config, logs } = await hookConfig()
  const { buscar, pedidos } = base([[pensamiento("pienso"), texto("a medias", false), CORTE]])
  const cfg = { provider: { google: { options: { fetch: buscar } } } }
  await config(cfg)
  assert.notEqual(cfg.provider.google.options.fetch, buscar)
  const evs = await eventos(await cfg.provider.google.options.fetch(URL_STREAM, {}))
  assert.equal(pedidos.length, 1, "el fetch que había es el que se usó")
  assert.equal(textoVisible(evs), "a medias" + AVISO_CORTADO)
  assert.equal(logs.length, 1, "el corte queda en el registro de OpenCode")
  assert.equal(logs[0].body.service, "tecnia-resguardo")
  assert.equal(logs[0].body.level, "warn")
})
