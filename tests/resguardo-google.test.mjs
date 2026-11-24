// Tests del resguardo ante el corte de Google a mitad de respuesta
// (opencode/plugins/resguardo/google.ts y opencode/plugins/tecnia-resguardo.ts).
// Corre con: node --test tests/resguardo-google.test.mjs   (Node 24+, importa el .ts directo).
//
// DE DÓNDE SALEN LOS DATOS. Los trozos de abajo copian la forma de lo que Google
// mandó de verdad el 2026-11-24 a una notebook Windows (capturado con un proxy
// local delante de OpenCode 1.18.18): 200, trozos de pensamiento con
// `"thought": true`, y el corte como `data: {"error": {...503...}}` seguido del
// mismo JSON suelto, sin `data:` y sin `finishReason`.
// Lo que NO se capturó y sale de la documentación de la API (no medido): el
// prompt bloqueado (`promptFeedback.blockReason`) y los errores que no son 503.
//
// TRES TRAMPAS EN LAS QUE YA SE CAYÓ, PARA QUE NO SE REPITAN.
// 1. El primer servidor falso con el que se midió esto aceptaba cualquier
//    pedido. Con él, OpenCode 1.19.6 "se recuperaba sola". Era mentira: no
//    reintenta, sigue el bucle agregando el turno vacío del asistente, y Google
//    real rechaza ese pedido con 400. Por eso acá los reintentos se comprueban
//    mirando QUÉ se pidió (el mismo `input` y el mismo `init`).
// 2. La primera versión de este archivo pasó 32 mutaciones propias y una
//    revisión independiente encontró 17 más que quedaban verdes: no había ni un
//    test de cancelación por el consumidor, ni de UTF-8, ni del `fetch` global,
//    ni de QUÉ errores se reintentan. El código reintentaba un prompt bloqueado
//    y una cuota agotada, y después le decía al docente "Google está saturado".
// 3. El test de eventos partidos partía una respuesta CORTADA: si el lector
//    perdía los pedazos se reintentaba igual por otra regla. Ahora parte una
//    respuesta sana.
//
// Mutaciones corridas sobre una copia fuera del repo: ver el commit.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const PLUGINS = join(REPO, "opencode/plugins")
const {
  conResguardo,
  usaGoogle,
  avisoSaturado,
  avisoSinRespuesta,
  avisoDeError,
  AVISO_CORTADO,
  trozoDeCierre,
  esperaPorDefecto,
  REINTENTOS_POR_DEFECTO,
} = await import(join(PLUGINS, "resguardo/google.ts"))
const plugin = await import(join(PLUGINS, "tecnia-resguardo.ts"))

const URL_STREAM =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse"

// --- trozos con la forma de Google -----------------------------------------
const dato = (o) => `data: ${JSON.stringify(o)}\r\n\r\n`
const USO = { promptTokenCount: 35057, candidatesTokenCount: 12, totalTokenCount: 35290 }
const pensamiento = (t) =>
  dato({ candidates: [{ content: { parts: [{ text: t, thought: true }], role: "model" }, index: 0 }], usageMetadata: USO })
const texto = (t, fin) =>
  dato({ candidates: [{ content: { parts: [{ text: t }], role: "model" }, ...(fin ? { finishReason: "STOP" } : {}), index: 0 }] })
const llamada = (nombre) =>
  dato({ candidates: [{ content: { parts: [{ functionCall: { name: nombre, args: {} } }], role: "model" }, index: 0 }] })
const error = (code, status, message) => {
  const e = { error: { code, message, status } }
  // Tal cual lo manda Google: el trozo con `data:` y después el JSON suelto.
  return dato(e) + JSON.stringify(e, null, 2) + "\n"
}
const CORTE = error(503, "UNAVAILABLE", "This model is currently experiencing high demand.")
const CUOTA = error(429, "RESOURCE_EXHAUSTED", "Quota exceeded for metric: generate_content_free_tier_requests")

const BIEN = [pensamiento("pienso"), texto("Hola, ", false), texto("docente.", true)]
const CORTADA_SIN_NADA = [pensamiento("pienso"), CORTE]

function respuesta(trozos, { estado = 200, alCancelar } = {}) {
  const cod = new TextEncoder()
  const pedazos = trozos.map((t) => (typeof t === "string" ? cod.encode(t) : t))
  let i = 0
  const cuerpo = new ReadableStream({
    pull(c) {
      if (i < pedazos.length) c.enqueue(pedazos[i++])
      else c.close()
    },
    cancel() {
      alCancelar?.()
    },
  })
  return new Response(cuerpo, {
    status: estado,
    headers: { "content-type": "text/event-stream", "content-length": "999", "content-encoding": "gzip" },
  })
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
const partesDe = (evs) => evs.flatMap((e) => e.candidates?.[0]?.content?.parts ?? [])
const textoVisible = (evs) =>
  partesDe(evs)
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

test("una respuesta 200 sin cuerpo pasa sin tocar", async () => {
  const original = new Response(null, { status: 200 })
  const { resguardado } = armar([() => original])
  assert.equal(await resguardado(URL_STREAM, {}), original)
})

test("un pedido que no se puede repetir pasa sin tocar: Request, o cuerpo que no es texto", async () => {
  // Reusar un Request o un cuerpo de un solo uso revienta en el segundo pedido. Mejor no intervenir.
  const cuerpoDeUnUso = new ReadableStream({ start: (c) => c.close() })
  const casos = [
    [new Request(URL_STREAM, { method: "POST", body: "{}" }), undefined],
    [URL_STREAM, { method: "POST", body: cuerpoDeUnUso, duplex: "half" }],
    [URL_STREAM, { method: "POST", body: new TextEncoder().encode("{}") }],
  ]
  for (const [input, init] of casos) {
    const original = respuesta(CORTADA_SIN_NADA)
    const { resguardado, pedidos } = armar([() => original])
    assert.equal(await resguardado(input, init), original)
    assert.equal(pedidos.length, 1)
  }
})

test("con URL como string o como objeto URL, y cuerpo de texto o sin cuerpo, sí interviene", async () => {
  for (const [input, init] of [[URL_STREAM, { body: '{"a":1}' }], [new URL(URL_STREAM), {}], [URL_STREAM, undefined]]) {
    const { resguardado, pedidos } = armar([CORTADA_SIN_NADA, BIEN])
    const evs = await eventos(await resguardado(input, init))
    assert.equal(textoVisible(evs), "Hola, docente.")
    assert.equal(pedidos.length, 2, "el corte se tiene que haber visto y reintentado")
  }
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

test("un prompt bloqueado es una respuesta completa: pasa tal cual, sin reintentar ni hablar de saturación", async () => {
  const bloqueo = dato({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" }, usageMetadata: USO })
  const { resguardado, pedidos, esperas, anotado } = armar([[bloqueo], BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 1, "repetir un prompt bloqueado no lo desbloquea")
  assert.deepEqual(esperas, [])
  assert.deepEqual(anotado, [])
  assert.equal(evs.length, 1)
  assert.equal(evs[0].promptFeedback.blockReason, "PROHIBITED_CONTENT")
})

test("un cierre seguido de un trozo de sólo conteo sigue siendo una respuesta sana", async () => {
  const { resguardado, pedidos } = armar([[texto("listo", true), dato({ usageMetadata: USO })]])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(evs.length, 2)
  assert.equal(pedidos.length, 1)
})

test("un error DESPUÉS del cierre no cambia nada: la respuesta ya estaba completa", async () => {
  const { resguardado, pedidos, anotado } = armar([[pensamiento("pienso"), texto("", true), CORTE], BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 1, "si se reintentara, el SDK recibiría un cierre y después otra respuesta entera")
  assert.equal(evs.length, 2)
  assert.deepEqual(anotado, [])
})

test("finishReason null no es un cierre: es lo que manda Google en los trozos intermedios", async () => {
  const intermedio = dato({ candidates: [{ content: { parts: [{ text: "x", thought: true }], role: "model" }, finishReason: null, index: 0 }] })
  const { resguardado, pedidos } = armar([[intermedio], BIEN])
  await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 2, "el stream se acabó sin cierre: es un corte")
})

// ---------------------------------------------------------------------------
// El parseo de eventos
// ---------------------------------------------------------------------------

test("eventos partidos entre lecturas y con \\n\\n en vez de \\r\\n\\r\\n se entienden igual", async () => {
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

test("una letra con tilde partida entre dos lecturas llega entera", async () => {
  const bytes = new TextEncoder().encode(texto("¿Probás con ñandú?", true))
  const corte = bytes.indexOf(0xc3) + 1 // en el medio del primer carácter de dos bytes
  const { resguardado, pedidos } = armar([[bytes.slice(0, corte), bytes.slice(corte)]])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(textoVisible(evs), "¿Probás con ñandú?")
  assert.equal(pedidos.length, 1)
})

test("el último evento vale aunque el stream termine sin la línea en blanco final", async () => {
  const { resguardado, pedidos } = armar([[texto("Hola", true).trimEnd()]])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(textoVisible(evs), "Hola")
  assert.equal(pedidos.length, 1)
})

test("un evento con `event:`, un comentario delante o `data:` sin espacio no vuelve corte una respuesta sana", async () => {
  // Lo puede agregar un proxy o la baseURL del docente. Tragarse el evento convertía todo en "saturado".
  const json = JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hola" }], role: "model" }, finishReason: "STOP", index: 0 }] })
  for (const evento of [`event: message\ndata: ${json}\n\n`, `: ping\ndata: ${json}\n\n`, `data:${json}\n\n`, `﻿data: ${json}\n\n`]) {
    const { resguardado, pedidos, anotado } = armar([[evento], [texto("OTRA", true)]])
    const crudo = await (await resguardado(URL_STREAM, {})).text()
    assert.equal(pedidos.length, 1, `se tomó por corte: ${JSON.stringify(evento.slice(0, 20))}`)
    assert.deepEqual(anotado, [])
    assert.ok(crudo.includes('"Hola"'))
  }
})

test("un evento que es sólo un comentario (keepalive) no se reenvía como si fuera un dato", async () => {
  const { resguardado, pedidos } = armar([[": keepalive\n\n", texto("Hola", true)]])
  const evs = await eventos(await resguardado(URL_STREAM, {})) // eventos() exige que todo empiece con `data: `
  assert.equal(evs.length, 1)
  assert.equal(pedidos.length, 1)
})

test("un trozo sin candidatos (sólo conteo) NO es un cierre: si el stream termina ahí, es un corte", async () => {
  const { resguardado, pedidos } = armar([[pensamiento("pienso"), dato({ usageMetadata: USO })], BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 2)
  assert.equal(textoVisible(evs), "Hola, docente.")
})

test("lo que no se entiende se reenvía en vez de tragarlo, y un `data: null` no revienta", async () => {
  const { resguardado, pedidos } = armar([["data: null\r\n\r\n", "data: esto-no-es-json\r\n\r\n", texto("Hola", true)]])
  const crudo = await (await resguardado(URL_STREAM, {})).text()
  assert.ok(crudo.includes("data: null"))
  assert.ok(crudo.includes("esto-no-es-json"))
  assert.ok(crudo.includes('"Hola"'))
  assert.equal(pedidos.length, 1)
})

test("el trozo de error y el JSON suelto que lo sigue NO le llegan al SDK", async () => {
  const { resguardado } = armar([CORTADA_SIN_NADA, BIEN])
  const crudo = await (await resguardado(URL_STREAM, {})).text()
  assert.equal(crudo.includes('"error"'), false)
  assert.equal(crudo.includes("UNAVAILABLE"), false)
})

test("el error partido entre dos lecturas se detecta igual", async () => {
  const entero = pensamiento("pienso") + texto("visible", false) + CORTE
  const medio = entero.indexOf('"error"') + 3
  const { resguardado, anotado } = armar([[entero.slice(0, medio), entero.slice(medio)]])
  const crudo = await (await resguardado(URL_STREAM, {})).text()
  assert.equal(crudo.includes("UNAVAILABLE"), false, "el error partido no puede colarse al SDK")
  assert.equal(anotado[0].e.como, "saturado")
  assert.equal(anotado[0].e.visible, "texto")
})

// ---------------------------------------------------------------------------
// Saturación sin nada visible: se reintenta
// ---------------------------------------------------------------------------

test("corte por saturación con sólo pensamiento: repite EL MISMO pedido y entrega la respuesta nueva", async () => {
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
  assert.deepEqual(anotado[0].e, { intentos: 1, visible: "nada", como: "saturado" })
})

test("se reconoce la saturación por el código 503 o por el estado UNAVAILABLE, cualquiera de los dos", async () => {
  for (const corte of [error(503, undefined, "x"), error(undefined, "UNAVAILABLE", "x")]) {
    const { resguardado, pedidos } = armar([[pensamiento("pienso"), corte], BIEN])
    await eventos(await resguardado(URL_STREAM, {}))
    assert.equal(pedidos.length, 2)
  }
})

test("un stream que se acaba sin finishReason y sin error también se reintenta", async () => {
  const { resguardado, pedidos, anotado } = armar([[pensamiento("pienso")], BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(textoVisible(evs), "Hola, docente.")
  assert.equal(pedidos.length, 2)
  assert.equal(anotado[0].e.como, "sin-cierre")
})

test("el pensamiento y el texto vacío NO cuentan como visible: ahí sí se reintenta", async () => {
  const { resguardado, pedidos } = armar([[pensamiento("mucho pensamiento"), texto("", false), CORTE], BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 2)
  assert.equal(textoVisible(evs), "Hola, docente.")
})

test("si el reintento contesta un error HTTP cuenta como otro intento fallido y sigue", async () => {
  let cancelado = false
  const { resguardado, pedidos, esperas, anotado } = armar([
    CORTADA_SIN_NADA,
    () => respuesta(["{}"], { estado: 503, alCancelar: () => void (cancelado = true) }),
    BIEN,
  ])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(textoVisible(evs), "Hola, docente.")
  assert.equal(pedidos.length, 3)
  assert.deepEqual(esperas, [2000, 4000])
  assert.ok(anotado.some((a) => a.e?.estado === 503))
  assert.equal(cancelado, true, "el cuerpo del reintento fallido no puede quedar abierto")
})

// ---------------------------------------------------------------------------
// Se agotan los reintentos: aviso, no silencio
// ---------------------------------------------------------------------------

test("si Google corta siempre por saturación: 1 pedido + 3 reintentos, esperas 2/4/8 s, y avisa «saturado»", async () => {
  const { resguardado, pedidos, esperas } = armar([CORTADA_SIN_NADA])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 4)
  assert.deepEqual(esperas, [2000, 4000, 8000])
  assert.equal(textoVisible(evs), avisoSaturado(4))
  assert.equal(motivoDeFin(evs), "STOP", "sin finishReason OpenCode volvería a leer 'unknown' y quedaría mudo")
})

test("si algún intento NO fue un 503, el aviso no afirma saturación", async () => {
  // Stream que se acaba solo (red, proxy): no se sabe por qué.
  const a = armar([[pensamiento("pienso")]])
  assert.equal(textoVisible(await eventos(await a.resguardado(URL_STREAM, {}))), avisoSinRespuesta(4))
  // Un reintento que vuelve con 500 por HTTP tampoco es saturación.
  const b = armar([CORTADA_SIN_NADA, () => respuesta(["{}"], { estado: 500 })])
  assert.equal(textoVisible(await eventos(await b.resguardado(URL_STREAM, {}))), avisoSinRespuesta(4))
  // Pero un 503 por HTTP sí lo es.
  const c = armar([CORTADA_SIN_NADA, () => respuesta(["{}"], { estado: 503 })])
  assert.equal(textoVisible(await eventos(await c.resguardado(URL_STREAM, {}))), avisoSaturado(4))
})

test("la cantidad de reintentos se respeta: con 1, son 2 pedidos y el aviso dice 2", async () => {
  const { resguardado, pedidos } = armar([CORTADA_SIN_NADA], { reintentos: 1 })
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 2)
  assert.equal(textoVisible(evs), avisoSaturado(2))
})

test("el cierre nuestro repite el último conteo real de tokens en vez de pisarlo con ceros", async () => {
  const { resguardado } = armar([CORTADA_SIN_NADA])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.deepEqual(evs.at(-1).usageMetadata, USO)
})

// ---------------------------------------------------------------------------
// Otros errores de Google: no se reintentan
// ---------------------------------------------------------------------------

test("cuota agotada a mitad de stream: NO reintenta (gastaría más cuota) y avisa con lo que dijo Google", async () => {
  const { resguardado, pedidos, esperas, anotado } = armar([[pensamiento("pienso"), CUOTA], BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 1)
  assert.deepEqual(esperas, [])
  const aviso = textoVisible(evs)
  assert.equal(aviso, avisoDeError(429, "Quota exceeded for metric: generate_content_free_tier_requests"))
  assert.match(aviso, /código 429/)
  assert.match(aviso, /Quota exceeded/)
  assert.doesNotMatch(aviso, /saturad/i, "una cuota agotada no es saturación")
  assert.equal(motivoDeFin(evs), "STOP")
  // Queda en el registro con qué error fue, para poder diagnosticar después.
  assert.deepEqual(anotado[0].e, {
    intentos: 1,
    visible: "nada",
    como: "error",
    codigo: 429,
    mensaje: "Quota exceeded for metric: generate_content_free_tier_requests",
  })
})

test("un error 400 tampoco se reintenta, y un error sin código ni mensaje igual da un aviso legible", async () => {
  const a = armar([[error(400, "INVALID_ARGUMENT", "Requests ending with a model turn are not supported.")], BIEN])
  const evs = await eventos(await a.resguardado(URL_STREAM, {}))
  assert.equal(a.pedidos.length, 1)
  assert.match(textoVisible(evs), /código 400/)
  const b = armar([[dato({ error: {} })], BIEN])
  const aviso = textoVisible(await eventos(await b.resguardado(URL_STREAM, {})))
  assert.equal(b.pedidos.length, 1)
  assert.equal(aviso, avisoDeError(undefined, undefined))
  assert.doesNotMatch(aviso, /undefined|código|: «/)
})

test("el mensaje de Google se copia recortado: un error enorme no inunda la pantalla", () => {
  const aviso = avisoDeError(500, "x".repeat(5000))
  assert.ok(aviso.length < 700)
  assert.ok(aviso.includes("x".repeat(300)) && !aviso.includes("x".repeat(301)))
})

// ---------------------------------------------------------------------------
// Con algo ya visible: nunca se repite
// ---------------------------------------------------------------------------

test("corte después de texto visible: no repite (duplicaría el texto) y avisa que quedó cortado", async () => {
  const { resguardado, pedidos, esperas } = armar([[pensamiento("pienso"), texto("El LED va en ", false), CORTE], BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 1)
  assert.deepEqual(esperas, [])
  assert.equal(textoVisible(evs), "El LED va en " + AVISO_CORTADO)
  assert.equal(motivoDeFin(evs), "STOP")
})

test("con texto visible, el aviso de cortado sale igual sea 503, cuota o stream que se acaba", async () => {
  for (const final of [[CORTE], [CUOTA], []]) {
    const { resguardado, pedidos } = armar([[texto("a medias", false), ...final], BIEN])
    const evs = await eventos(await resguardado(URL_STREAM, {}))
    assert.equal(pedidos.length, 1)
    assert.equal(textoVisible(evs), "a medias" + AVISO_CORTADO)
  }
})

test("corte después de una llamada a herramienta: no repite, cierra, y NO agrega aviso", async () => {
  // OpenCode va a ejecutar la herramienta y el turno sigue solo: decir "mandá de nuevo tu mensaje" sería falso,
  // y repetir el pedido la ejecutaría dos veces.
  const { resguardado, pedidos, anotado } = armar([[pensamiento("pienso"), llamada("proyecto-fisico"), CORTE], BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 1)
  assert.equal(partesDe(evs).filter((p) => p.functionCall).length, 1, "la llamada llega una sola vez")
  assert.equal(textoVisible(evs), "", "sin aviso de texto")
  assert.equal(motivoDeFin(evs), "STOP")
  assert.equal(anotado[0].e.visible, "accion")
})

test("texto y después llamada: manda la llamada (sin aviso); llamada y después texto: también", async () => {
  for (const orden of [[texto("armo esto", false), llamada("circuito")], [llamada("circuito"), texto("armo esto", false)]]) {
    const { resguardado, pedidos } = armar([[...orden, CORTE], BIEN])
    const evs = await eventos(await resguardado(URL_STREAM, {}))
    assert.equal(pedidos.length, 1)
    assert.equal(textoVisible(evs), "armo esto")
  }
})

test("una parte que no es texto ni pensamiento (datos, código) cuenta como visible: no se repite", async () => {
  const datos = dato({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }], role: "model" }, index: 0 }] })
  const { resguardado, pedidos } = armar([[datos, CORTE], BIEN])
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 1)
  assert.equal(partesDe(evs).filter((p) => p.inlineData).length, 1)
})

test("una parte que sólo trae la firma del pensamiento no es visible", async () => {
  const firma = dato({ candidates: [{ content: { parts: [{ text: "", thoughtSignature: "EpYB" }], role: "model" }, index: 0 }] })
  const { resguardado, pedidos } = armar([[firma, CORTE], BIEN])
  await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(pedidos.length, 2)
})

// ---------------------------------------------------------------------------
// Los textos
// ---------------------------------------------------------------------------

test("todo aviso dice de entrada que no lo escribió el modelo", () => {
  for (const aviso of [avisoSaturado(4), avisoSinRespuesta(4), avisoDeError(429, "x"), AVISO_CORTADO]) {
    assert.match(aviso, /Aviso de Tecnia Bot \(esto no lo escribió el modelo\)/)
  }
})

test("los avisos sólo afirman lo que el código vio", () => {
  assert.match(avisoSaturado(4), /saturado/)
  assert.match(avisoSaturado(4), /4 intentos seguidos/)
  // Sólo el aviso de saturación habla de saturación.
  for (const aviso of [avisoSinRespuesta(4), avisoDeError(429, "x"), AVISO_CORTADO]) assert.doesNotMatch(aviso, /saturad/i)
  // Ninguno promete que el proyecto quedó intacto ni que algo ya se arregló.
  for (const aviso of [avisoSaturado(4), avisoSinRespuesta(4), avisoDeError(429, "x"), AVISO_CORTADO]) {
    assert.doesNotMatch(aviso, /no cambió|no se perdió|listo|ya está/i)
  }
  // Los dos que piden reintentar lo dicen; el de error NO manda a reintentar a ciegas.
  assert.match(avisoSaturado(4), /mandá de nuevo tu mensaje/)
  assert.match(avisoSinRespuesta(4), /mandá de nuevo tu mensaje/)
  assert.match(AVISO_CORTADO, /Mandá de nuevo tu mensaje/)
  assert.doesNotMatch(avisoDeError(429, "x"), /[Mm]andá de nuevo tu mensaje/)
  // /clave pasa por el modelo: no se la recomienda cuando el modelo es lo que falla.
  assert.doesNotMatch(avisoDeError(429, "x"), /\/clave/)
})

test("trozoDeCierre arma un evento que el SDK entiende: texto del modelo con finishReason STOP", () => {
  const t = trozoDeCierre("hola")
  assert.ok(t.startsWith("data: ") && t.endsWith("\r\n\r\n"))
  const j = JSON.parse(t.slice(6))
  assert.deepEqual(j.candidates[0].content, { parts: [{ text: "hola" }], role: "model" })
  assert.equal(j.candidates[0].finishReason, "STOP")
  // Sin conteo previo va en cero, pero va: el SDK espera el campo.
  assert.deepEqual(j.usageMetadata, { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 })
})

test("las esperas por defecto son 2, 4 y 8 segundos, y los reintentos 3", () => {
  assert.deepEqual([1, 2, 3].map(esperaPorDefecto), [2000, 4000, 8000])
  assert.equal(REINTENTOS_POR_DEFECTO, 3)
})

// ---------------------------------------------------------------------------
// Cancelar y fallar
// ---------------------------------------------------------------------------

test("si el usuario cancela durante la espera, el stream falla con ese motivo y no se pide más", async () => {
  const control = new AbortController()
  const { buscar, pedidos } = base([CORTADA_SIN_NADA, BIEN])
  // Sin `esperar` inyectado: la de verdad, que tiene que cortarse sola con la señal.
  const resguardado = conResguardo(buscar, { reintentos: 3, esperaMs: () => 60_000 })
  const r = await resguardado(URL_STREAM, { signal: control.signal })
  const leyendo = r.text()
  setTimeout(() => control.abort(new Error("Esc del docente")), 20)
  await assert.rejects(leyendo, /Esc del docente/)
  assert.equal(pedidos.length, 1)
})

test("si la señal YA estaba cancelada al llegar a la espera, no espera ni pide de nuevo", async () => {
  const control = new AbortController()
  control.abort(new Error("ya cancelado"))
  const { buscar, pedidos } = base([CORTADA_SIN_NADA, BIEN])
  const resguardado = conResguardo(buscar, { reintentos: 3, esperaMs: () => 60_000 })
  const antes = Date.now()
  await assert.rejects((await resguardado(URL_STREAM, { signal: control.signal })).text(), /ya cancelado/)
  assert.ok(Date.now() - antes < 5000, "se quedó esperando con la señal ya cancelada")
  assert.equal(pedidos.length, 1)
})

test("la espera de verdad espera lo que se le pide, y al cancelarla suelta el reloj", async () => {
  const { buscar, pedidos } = base([CORTADA_SIN_NADA, BIEN])
  const resguardado = conResguardo(buscar, { reintentos: 3, esperaMs: () => 150 })
  const antes = Date.now()
  const evs = await eventos(await resguardado(URL_STREAM, {}))
  assert.ok(Date.now() - antes >= 140, "no esperó antes de reintentar")
  assert.equal(textoVisible(evs), "Hola, docente.")
  assert.equal(pedidos.length, 2)
})

test("si el consumidor deja de leer, se cancela el cuerpo de Google y no se reintenta", async () => {
  let cancelado = false
  const cod = new TextEncoder()
  const eterno = () =>
    new Response(
      new ReadableStream({
        pull: (c) => c.enqueue(cod.encode(pensamiento("sigo pensando"))),
        cancel: () => void (cancelado = true),
      }),
      { status: 200 },
    )
  const { resguardado, pedidos, esperas } = armar([eterno, BIEN])
  const lector = (await resguardado(URL_STREAM, {})).body.getReader()
  await lector.read()
  await lector.cancel("el docente cerró")
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(cancelado, true, "el stream de Google quedó abierto")
  assert.equal(pedidos.length, 1)
  assert.deepEqual(esperas, [])
})

test("si el consumidor deja de leer con Google callado (no llega ningún trozo), igual se cancela el cuerpo", async () => {
  // Sin esto el cuerpo sólo se cancelaría cuando llegara el próximo trozo, que puede no llegar nunca.
  let cancelado = false
  const callado = () =>
    new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => void (cancelado = true) }), { status: 200 })
  const { resguardado } = armar([callado])
  const lector = (await resguardado(URL_STREAM, {})).body.getReader()
  await lector.cancel("el docente cerró")
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(cancelado, true)
})

test("si el consumidor deja de leer DURANTE la espera, no hay reintento", async () => {
  let soltar
  const { buscar, pedidos } = base([CORTADA_SIN_NADA, BIEN])
  const resguardado = conResguardo(buscar, {
    reintentos: 3,
    esperaMs: () => 1,
    esperar: () => new Promise((r) => void (soltar = r)),
  })
  const lector = (await resguardado(URL_STREAM, {})).body.getReader()
  await lector.read() // el pensamiento del primer intento
  while (!soltar) await new Promise((r) => setTimeout(r, 5))
  await lector.cancel()
  soltar()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(pedidos.length, 1)
})

test("si el consumidor deja de leer mientras el reintento está en viaje, ese cuerpo nuevo se cancela", async () => {
  let cancelado = false
  let llegar
  const { buscar, pedidos } = base([
    CORTADA_SIN_NADA,
    () => new Promise((r) => void (llegar = () => r(respuesta(BIEN, { alCancelar: () => void (cancelado = true) })))),
  ])
  const resguardado = conResguardo(buscar, { reintentos: 3, esperaMs: () => 1, esperar: async () => {} })
  const lector = (await resguardado(URL_STREAM, {})).body.getReader()
  await lector.read()
  while (!llegar) await new Promise((r) => setTimeout(r, 5))
  await lector.cancel()
  llegar()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(pedidos.length, 2)
  assert.equal(cancelado, true, "el cuerpo del reintento quedó abierto sin que nadie lo lea")
})

test("al detectar el corte se cancela el cuerpo de ese intento", async () => {
  let cancelado = false
  const { resguardado } = armar([
    () => respuesta([...CORTADA_SIN_NADA, texto("resto que nadie va a leer", true)], { alCancelar: () => void (cancelado = true) }),
    BIEN,
  ])
  await eventos(await resguardado(URL_STREAM, {}))
  assert.equal(cancelado, true)
})

test("si el reintento revienta (se cayó la red), el error le llega a OpenCode: no se tapa con un aviso", async () => {
  const { resguardado, pedidos } = armar([CORTADA_SIN_NADA, new Error("ECONNRESET")])
  await assert.rejects((await resguardado(URL_STREAM, {})).text(), /ECONNRESET/)
  assert.equal(pedidos.length, 2)
})

test("la respuesta envuelta conserva estado y tipo, y suelta el largo y la compresión viejos", async () => {
  const { resguardado } = armar([BIEN])
  const r = await resguardado(URL_STREAM, {})
  assert.equal(r.status, 200)
  assert.equal(r.headers.get("content-type"), "text/event-stream")
  assert.equal(r.headers.get("content-length"), null, "el cuerpo cambió: el largo original ya no vale")
  assert.equal(r.headers.get("content-encoding"), null, "el cuerpo ya está descomprimido")
  await r.text()
})

test("envolver dos veces no apila resguardos", async () => {
  const { buscar, pedidos } = base([CORTADA_SIN_NADA])
  const op = { reintentos: 1, esperaMs: () => 0, esperar: async () => {} }
  const una = conResguardo(buscar, op)
  assert.equal(conResguardo(una, op), una)
  await eventos(await una(URL_STREAM, {}))
  assert.equal(pedidos.length, 2, "con dos capas serían más pedidos")
})

// ---------------------------------------------------------------------------
// El plugin: forma de carga y enganche
// ---------------------------------------------------------------------------

test("exporta SÓLO default { id, server }, como pide OpenCode a un plugin de archivo", () => {
  // Un export suelto que sea función lo tomaría el cargador viejo por otro plugin.
  assert.deepEqual(Object.keys(plugin), ["default"])
  assert.equal(plugin.default.id, "tecnia-resguardo")
  assert.equal(typeof plugin.default.server, "function")
})

test("la lógica vive en una subcarpeta: en plugins/ de primer nivel sólo hay plugins cargables", () => {
  const cargables = readdirSync(PLUGINS).filter((f) => /\.(ts|js)$/.test(f)).sort()
  assert.deepEqual(cargables, ["tecnia-idioma.ts", "tecnia-resguardo.ts"])
})

async function hookConfig(log) {
  const logs = []
  const client = { app: { log: log ?? (async (o) => void logs.push(o)) } }
  const h = await plugin.default.server({ client, directory: "/tmp", worktree: "/tmp" })
  return { config: h.config, logs }
}

test("usaGoogle: sección provider.google, modelo general de Google o modelo de Google en un agente", () => {
  assert.equal(usaGoogle({ provider: { google: {} } }), true)
  assert.equal(usaGoogle({ model: "google/gemini-3.5-flash-lite" }), true)
  assert.equal(usaGoogle({ model: "opencode/big-pickle", agent: { "tecnia-bot": { model: "google/gemini-3.5-flash-lite" } } }), true)
  assert.equal(usaGoogle({}), false)
  assert.equal(usaGoogle({ model: "opencode/big-pickle" }), false)
  assert.equal(usaGoogle({ model: "opencode/google-no", agent: { x: {}, y: undefined }, provider: { opencode: {} } }), false)
})

test("sin Google en la configuración el hook NO toca nada", async () => {
  // Medido en OpenCode 1.18.18: crear provider.google a quien no tiene key le lista 25 modelos de Google.
  const { config } = await hookConfig()
  for (const cfg of [{}, { model: "opencode/big-pickle" }, { provider: { opencode: { options: { x: 1 } } } }]) {
    const antes = JSON.stringify(cfg)
    await config(cfg)
    assert.equal(JSON.stringify(cfg), antes)
    assert.equal(cfg.provider?.google, undefined)
  }
})

test("con un modelo de Google pone el fetch en provider.google y no toca a los otros proveedores", async () => {
  const { config } = await hookConfig()
  const cfg = { model: "google/gemini-3.5-flash-lite", provider: { opencode: { options: { x: 1 } } } }
  await config(cfg)
  assert.equal(typeof cfg.provider.google.options.fetch, "function")
  assert.deepEqual(cfg.provider.opencode, { options: { x: 1 } })
  // Sin sección provider previa también.
  const sinSeccion = { agent: { "tecnia-bot": { model: "google/gemini-3.5-flash-lite" } } }
  await config(sinSeccion)
  assert.equal(typeof sinSeccion.provider.google.options.fetch, "function")
})

test("conserva las otras opciones de google (la baseURL del docente, por ejemplo)", async () => {
  const { config } = await hookConfig()
  const cfg = { provider: { google: { options: { baseURL: "http://otra", apiKey: "k" } } } }
  await config(cfg)
  assert.equal(cfg.provider.google.options.baseURL, "http://otra")
  assert.equal(cfg.provider.google.options.apiKey, "k")
})

test("sin fetch previo usa el fetch global: es el camino de todo docente", async () => {
  const original = globalThis.fetch
  const pedidos = []
  globalThis.fetch = async (input, init) => {
    pedidos.push({ input, init })
    return respuesta(pedidos.length === 1 ? CORTADA_SIN_NADA : BIEN)
  }
  try {
    const { config } = await hookConfig()
    const cfg = { model: "google/gemini-3.5-flash-lite" }
    await config(cfg)
    const control = new AbortController()
    const r = await cfg.provider.google.options.fetch(URL_STREAM, { signal: control.signal })
    const lector = r.body.getReader()
    const primero = new TextDecoder().decode((await lector.read()).value)
    assert.ok(primero.includes("pienso"), "tiene que haber usado el fetch global")
    await lector.cancel() // no esperamos los 2 s de verdad
    assert.equal(pedidos.length, 1)
  } finally {
    globalThis.fetch = original
  }
})

test("si ya había un fetch puesto lo envuelve en vez de pisarlo, y el corte queda en el registro", async () => {
  const { config, logs } = await hookConfig()
  const { buscar, pedidos } = base([[pensamiento("pienso"), texto("a medias", false), CORTE]])
  const cfg = { provider: { google: { options: { fetch: buscar } } } }
  await config(cfg)
  assert.notEqual(cfg.provider.google.options.fetch, buscar)
  const evs = await eventos(await cfg.provider.google.options.fetch(URL_STREAM, {}))
  assert.equal(pedidos.length, 1, "el fetch que había es el que se usó")
  assert.equal(textoVisible(evs), "a medias" + AVISO_CORTADO)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].body.service, "tecnia-resguardo")
  assert.equal(logs[0].body.level, "warn")
  assert.equal(logs[0].body.extra.como, "saturado")
})

test("si el hook corre dos veces sobre la misma configuración no apila resguardos", async () => {
  const { config } = await hookConfig()
  const cfg = { model: "google/gemini-3.5-flash-lite", provider: { google: { options: { fetch: base([BIEN]).buscar } } } }
  await config(cfg)
  const primero = cfg.provider.google.options.fetch
  await config(cfg)
  assert.equal(cfg.provider.google.options.fetch, primero)
})

test("un registro que falla (rechazo o excepción) no voltea la respuesta", async () => {
  for (const log of [async () => Promise.reject(new Error("log caído")), () => { throw new Error("log roto") }]) {
    const rechazos = []
    const alRechazo = (e) => void rechazos.push(e)
    process.on("unhandledRejection", alRechazo)
    try {
      const { config } = await hookConfig(log)
      const cfg = { provider: { google: { options: { fetch: base([[texto("a medias", false), CORTE]]).buscar } } } }
      await config(cfg)
      const evs = await eventos(await cfg.provider.google.options.fetch(URL_STREAM, {}))
      assert.equal(textoVisible(evs), "a medias" + AVISO_CORTADO)
      await new Promise((r) => setTimeout(r, 20))
      assert.deepEqual(rechazos, [], "quedó un rechazo sin manejar")
    } finally {
      process.off("unhandledRejection", alRechazo)
    }
  }
})
