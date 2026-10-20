// Tests del plugin de servidor tecnia-idioma (opencode/plugins/tecnia-idioma.ts).
// Corre con: node --test tests/idioma-plugin.test.mjs   (Node 24+, importa el .ts directo).
//
// Ejercita los DOS hooks con mensajes falsos, con la forma que les pasa
// OpenCode 1.18.18 (packages/plugin/src/index.ts del tag):
// - "experimental.text.complete"(input {sessionID, messageID, partID}, output {text})
// - "experimental.chat.messages.transform"(input {}, output {messages: {info, parts}[]})
// y la forma de carga: OpenCode levanta solo `plugins/*.{ts,js}` del config
// (config/plugin.ts), y a cada uno le exige `export default { id, server }`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const PLUGINS = join(REPO, "opencode/plugins")
const mod = await import(join(PLUGINS, "tecnia-idioma.ts"))

async function hooks() {
  const logs = []
  const client = { app: { log: async (opts) => void logs.push(opts) } }
  const h = await mod.default.server({ client, directory: "/tmp", worktree: "/tmp" })
  return { h, logs }
}

const FUGA =
  "The tool reported that no board is connected.\n\nLet's communicate this clearly and warmly, following our rules:\n- End with a question.\n\n" +
  "Let's write out the response.Che, no veo ninguna placa conectada. ¿Probás con otro cable?"
const LIMPIO = "Che, no veo ninguna placa conectada. ¿Probás con otro cable?"
const PLAN = 'Now let\'s compile the project using `platformio` with `action: "compile"`.'

// ---------------------------------------------------------------------------
// Forma de carga
// ---------------------------------------------------------------------------

test("exporta SÓLO default { id, server }, como pide OpenCode a un plugin de archivo", () => {
  assert.deepEqual(Object.keys(mod), ["default"])
  assert.equal(mod.default.id, "tecnia-idioma")
  assert.equal(typeof mod.default.server, "function")
  assert.equal("tui" in mod.default, false)
})

test("en plugins/ el único .ts/.js de primer nivel es el plugin: el detector va en una subcarpeta", () => {
  // OpenCode carga como plugin todo `plugins/*.{ts,js}`. Un .ts suelto sin `server`
  // rompería la carga; tecnia-logo.tsx es de la TUI y el glob no lo toca.
  const cargables = readdirSync(PLUGINS).filter((f) => /\.(ts|js)$/.test(f))
  assert.deepEqual(cargables, ["tecnia-idioma.ts"])
})

// ---------------------------------------------------------------------------
// experimental.text.complete
// ---------------------------------------------------------------------------

test("text.complete: saca el plan en inglés y deja la respuesta", async () => {
  const { h, logs } = await hooks()
  const output = { text: FUGA }
  await h["experimental.text.complete"]({ sessionID: "ses_1", messageID: "msg_1", partID: "prt_1" }, output)
  assert.equal(output.text, LIMPIO)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].body.service, "tecnia-idioma")
  assert.equal(logs[0].body.extra.partID, "prt_1")
  assert.equal(logs[0].body.extra.quedo_vacio, false)
})

test("text.complete: un plan entero queda vacío (la TUI no dibuja partes vacías)", async () => {
  const { h, logs } = await hooks()
  const output = { text: PLAN }
  await h["experimental.text.complete"]({ sessionID: "s", messageID: "m", partID: "p" }, output)
  assert.equal(output.text, "")
  assert.equal(logs[0].body.extra.quedo_vacio, true)
})

test("text.complete: el español no se toca y no se loguea nada", async () => {
  const { h, logs } = await hooks()
  const texto = "¡Listo! Compiló. El LED del GPIO 2 titila con el web server del Access Point.\n\n¿Lo cargo?"
  const output = { text: texto }
  await h["experimental.text.complete"]({ sessionID: "s", messageID: "m", partID: "p" }, output)
  assert.equal(output.text, texto)
  assert.equal(logs.length, 0)
})

test("text.complete: con un output roto no tira (un filtro no puede cortar la respuesta)", async () => {
  const { h } = await hooks()
  await assert.doesNotReject(h["experimental.text.complete"]({ sessionID: "s", messageID: "m", partID: "p" }, {}))
})

test("text.complete: si el log falla, el texto igual se limpia", async () => {
  const client = { app: { log: () => Promise.reject(new Error("sin servidor")) } }
  const h = await mod.default.server({ client })
  const output = { text: FUGA }
  await h["experimental.text.complete"]({ sessionID: "s", messageID: "m", partID: "p" }, output)
  assert.equal(output.text, LIMPIO)
})

// ---------------------------------------------------------------------------
// experimental.chat.messages.transform
// ---------------------------------------------------------------------------

function historial() {
  const user = {
    info: { id: "msg_u", role: "user", sessionID: "s" },
    parts: [{ id: "prt_u", type: "text", text: "Let's see what the board says, please." }],
  }
  const asistenteSucio = {
    info: { id: "msg_a1", role: "assistant", sessionID: "s", agent: "tecnia-bot", mode: "tecnia-bot" },
    parts: [
      { id: "prt_r", type: "reasoning", text: "The user wants to know if the board is there. Let's check." },
      { id: "prt_t1", type: "text", text: FUGA },
      { id: "prt_tool", type: "tool", tool: "platformio", state: { status: "completed", output: "Let's not touch this: the tool output stays as it is." } },
      { id: "prt_t2", type: "text", text: PLAN },
    ],
  }
  const asistenteLimpio = {
    info: { id: "msg_a2", role: "assistant", sessionID: "s", agent: "tecnia-bot", mode: "tecnia-bot" },
    parts: [{ id: "prt_t3", type: "text", text: "¡Listo, compiló! ¿Lo cargo a la placa?" }],
  }
  return { user, asistenteSucio, asistenteLimpio }
}

test("transform: limpia los textos del asistente y no toca usuario, tools ni reasoning", async () => {
  const { h, logs } = await hooks()
  const { user, asistenteSucio, asistenteLimpio } = historial()
  const messages = [user, asistenteSucio, asistenteLimpio]
  const output = { messages }
  await h["experimental.chat.messages.transform"]({}, output)

  // El MISMO arreglo: prompt.ts sigue usando su variable `msgs`, no lo que devuelve el hook.
  assert.equal(output.messages, messages)
  assert.equal(messages[0], user, "el mensaje del usuario es el mismo objeto")
  assert.equal(messages[2], asistenteLimpio, "un mensaje sin fuga queda como estaba")

  const nuevo = messages[1]
  assert.notEqual(nuevo, asistenteSucio, "el mensaje con fuga se reemplaza")
  assert.equal(nuevo.info, asistenteSucio.info)
  const [r, t1, tool, t2] = nuevo.parts
  assert.equal(r, asistenteSucio.parts[0], "reasoning intacto")
  assert.equal(tool, asistenteSucio.parts[2], "tool intacta")
  assert.equal(t1.text, LIMPIO)
  assert.equal(t1.id, "prt_t1")
  // Vacío, no borrado: misma forma que deja text.complete; @ai-sdk/google descarta los vacíos.
  assert.equal(t2.text, "")
  assert.equal(nuevo.parts.length, 4)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].body.extra.partes, 2)
})

test("transform: no muta las partes originales (nada se persiste por accidente)", async () => {
  const { h } = await hooks()
  const { user, asistenteSucio, asistenteLimpio } = historial()
  const antes = JSON.stringify([user, asistenteSucio, asistenteLimpio])
  await h["experimental.chat.messages.transform"]({}, { messages: [user, asistenteSucio, asistenteLimpio] })
  assert.equal(JSON.stringify([user, asistenteSucio, asistenteLimpio]), antes)
})

test("transform: historial sin fugas, sin cambios ni log", async () => {
  const { h, logs } = await hooks()
  const { user, asistenteLimpio } = historial()
  const messages = [user, asistenteLimpio]
  await h["experimental.chat.messages.transform"]({}, { messages })
  assert.equal(messages[0], user)
  assert.equal(messages[1], asistenteLimpio)
  assert.equal(logs.length, 0)
})

test("transform: con mensajes rotos no tira, y un mensaje roto no frena a los demás", async () => {
  const { h } = await hooks()
  await assert.doesNotReject(h["experimental.chat.messages.transform"]({}, { messages: [null, { info: {} }] }))
  const { asistenteSucio } = historial()
  const roto = { info: { role: "assistant", agent: "tecnia-bot" }, parts: [{ type: "text", get text() { throw new Error("x") } }] }
  const messages = [roto, asistenteSucio]
  await assert.doesNotReject(h["experimental.chat.messages.transform"]({}, { messages }))
  assert.equal(messages[1].parts[1].text, LIMPIO)
})

test("transform: sólo tecnia-bot; nunca el resumen de la compactación ni otros agentes", async () => {
  const { h } = await hooks()
  const resumen = { info: { id: "msg_c", role: "assistant", agent: "compaction", mode: "compaction", summary: true }, parts: [{ id: "c", type: "text", text: "## Goal\n- The user wants the LED to blink. Let's keep the board on COM3." }] }
  const resumenRaro = { info: { id: "msg_c2", role: "assistant", agent: "tecnia-bot", summary: true }, parts: [{ id: "c2", type: "text", text: PLAN }] }
  const otro = { info: { id: "msg_b", role: "assistant", agent: "build", mode: "build" }, parts: [{ id: "b", type: "text", text: PLAN }] }
  const messages = [resumen, resumenRaro, otro]
  await h["experimental.chat.messages.transform"]({}, { messages })
  assert.equal(messages[0], resumen)
  assert.equal(messages[1], resumenRaro)
  assert.equal(messages[2], otro)
})

test("transform: un mensaje que queda sin texto se manda con \"\" (sin relleno: Gemini lo acepta, probado en la VM)", async () => {
  const { h } = await hooks()
  const solo = { info: { id: "m", role: "assistant", agent: "tecnia-bot" }, parts: [{ id: "p", type: "step-start" }, { id: "t", type: "text", text: PLAN }] }
  const messages = [solo]
  await h["experimental.chat.messages.transform"]({}, { messages })
  assert.equal(messages[0].parts[1].text, "")
  assert.equal(messages[0].parts.length, 2)
})

// ---------------------------------------------------------------------------
// text.complete: a quién se le aplica
// ---------------------------------------------------------------------------

const actualizado = (info) => ({ event: { type: "message.updated", properties: { info } } })

test("text.complete: el resumen de la compactación NO se toca (se sabe por message.updated)", async () => {
  const { h } = await hooks()
  await h.event(actualizado({ id: "msg_c", sessionID: "s", role: "assistant", agent: "compaction", mode: "compaction", summary: true }))
  const output = { text: "## Goal\n- The user wants the LED to blink. Let's keep the board on COM3." }
  const antes = output.text
  await h["experimental.text.complete"]({ sessionID: "s", messageID: "msg_c", partID: "p" }, output)
  assert.equal(output.text, antes)
})

test("text.complete: otro agente no se toca; tecnia-bot sí", async () => {
  const { h } = await hooks()
  await h.event(actualizado({ id: "msg_b", sessionID: "s", role: "assistant", agent: "build", mode: "build" }))
  await h.event(actualizado({ id: "msg_t", sessionID: "s", role: "assistant", agent: "tecnia-bot", mode: "tecnia-bot" }))
  const otro = { text: FUGA }
  await h["experimental.text.complete"]({ sessionID: "s", messageID: "msg_b", partID: "p" }, otro)
  assert.equal(otro.text, FUGA)
  const nuestro = { text: FUGA }
  await h["experimental.text.complete"]({ sessionID: "s", messageID: "msg_t", partID: "p" }, nuestro)
  assert.equal(nuestro.text, LIMPIO)
})

test("text.complete: respaldo por session.compacting si el evento del mensaje no llegó", async () => {
  const { h } = await hooks()
  await h["experimental.session.compacting"]({ sessionID: "s" }, { context: [] })
  const durante = { text: FUGA }
  await h["experimental.text.complete"]({ sessionID: "s", messageID: "desconocido", partID: "p" }, durante)
  assert.equal(durante.text, FUGA, "mientras compacta, no se toca")
  // Otra sesión no está compactando.
  const otra = { text: FUGA }
  await h["experimental.text.complete"]({ sessionID: "otra", messageID: "desconocido", partID: "p" }, otra)
  assert.equal(otra.text, LIMPIO)
  // session.compacted limpia la marca.
  await h.event({ event: { type: "session.compacted", properties: { sessionID: "s" } } })
  const despues = { text: FUGA }
  await h["experimental.text.complete"]({ sessionID: "s", messageID: "desconocido", partID: "p" }, despues)
  assert.equal(despues.text, LIMPIO)
})

test("text.complete: si la compactación falla sin session.compacted, el próximo mensaje normal limpia la marca", async () => {
  const { h } = await hooks()
  await h["experimental.session.compacting"]({ sessionID: "s" }, { context: [] })
  await h.event(actualizado({ id: "msg_n", sessionID: "s", role: "assistant", agent: "tecnia-bot" }))
  const output = { text: FUGA }
  await h["experimental.text.complete"]({ sessionID: "s", messageID: "otro-desconocido", partID: "p" }, output)
  assert.equal(output.text, LIMPIO)
})

test("text.complete: si leer el texto tira, no propaga (try/catch)", async () => {
  const { h } = await hooks()
  const output = { get text() { throw new Error("x") }, set text(v) {} }
  await assert.doesNotReject(h["experimental.text.complete"]({ sessionID: "s", messageID: "m", partID: "p" }, output))
})

// ---------------------------------------------------------------------------
// La otra mitad de la defensa: el prompt
// ---------------------------------------------------------------------------

test("el prompt tiene la regla de idioma junto a «Hablás siempre en español rioplatense»", () => {
  const prompt = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
  const i = prompt.indexOf("Hablás siempre en español rioplatense")
  const j = prompt.indexOf("Todo lo que escribís lo lee el docente, en vivo")
  assert.ok(i > 0 && j > i, "la regla tiene que estar después de «Hablás siempre en español rioplatense»")
  assert.ok(j - i < 400, "y pegada a esa línea, no perdida más abajo")
  assert.match(prompt, /no lo repitas/)
})

// ---------------------------------------------------------------------------
// Ronda 3: el último mensaje del docente y el agente leído de `mode`
// ---------------------------------------------------------------------------

const DOCENTE = "che, ¿el ESP32 se banca PWM para bajarle el brillo al LED?"
const RESPUESTA_EN =
  "Yes! The ESP32 supports PWM (Pulse Width Modulation) on any output GPIO using `ledcAttach` and `ledcWrite`, and you can set the frequency and the resolution of each channel as you need."

test("un mensaje con sólo `mode: \"tecnia-bot\"` (sin `agent`) también se filtra", async () => {
  const { h } = await hooks()
  const msg = { info: { id: "m", role: "assistant", mode: "tecnia-bot" }, parts: [{ id: "t", type: "text", text: FUGA }] }
  const messages = [msg]
  await h["experimental.chat.messages.transform"]({}, { messages })
  assert.equal(messages[0].parts[0].text, LIMPIO)
  await h.event(actualizado({ id: "m2", sessionID: "s", role: "assistant", mode: "tecnia-bot" }))
  const output = { text: FUGA }
  await h["experimental.text.complete"]({ sessionID: "s", messageID: "m2", partID: "p" }, output)
  assert.equal(output.text, LIMPIO)
})

test("chat.message: si el docente pidió inglés, text.complete deja el texto como está", async () => {
  const { h } = await hooks()
  await h["chat.message"]({ sessionID: "s" }, { message: {}, parts: [{ type: "text", text: "armame una consigna en inglés para los chicos" }] })
  const output = { text: "Let's build a traffic light! You will need three LEDs and three resistors." }
  const antes = output.text
  await h["experimental.text.complete"]({ sessionID: "s", messageID: "x", partID: "p" }, output)
  assert.equal(output.text, antes)
})

test("chat.message: el eco del mensaje del docente se reconoce y se va con la respuesta en inglés", async () => {
  const { h } = await hooks()
  await h["chat.message"]({ sessionID: "s" }, { message: {}, parts: [{ type: "text", text: DOCENTE }] })
  const output = { text: `"${DOCENTE}"\n\n${RESPUESTA_EN}` }
  await h["experimental.text.complete"]({ sessionID: "s", messageID: "x", partID: "p" }, output)
  assert.equal(output.text, "")
})

test("transform: cada respuesta se juzga con el mensaje del docente que la precede", async () => {
  const { h } = await hooks()
  const usuario = (id, text) => ({ info: { id, role: "user", sessionID: "s" }, parts: [{ id: id + "p", type: "text", text }] })
  const asistente = (id, text) => ({ info: { id, role: "assistant", sessionID: "s", agent: "tecnia-bot" }, parts: [{ id: id + "p", type: "text", text }] })
  const pedido = "Let's build a traffic light! You will need three LEDs and three resistors."
  // "en español, por favor" corta el pedido de inglés en el acto.
  const messages = [usuario("u1", "armame una consigna en inglés"), asistente("a1", pedido), usuario("u2", "ahora en español, por favor"), asistente("a2", FUGA)]
  const a1 = messages[1]
  await h["experimental.chat.messages.transform"]({}, { messages })
  assert.equal(messages[1], a1, "lo pedido en inglés no se toca")
  assert.equal(messages[3].parts[0].text, LIMPIO)
})

// ---------------------------------------------------------------------------
// Ronda 4: cuánto dura un pedido de inglés, partes sintéticas y caché
// ---------------------------------------------------------------------------

const PLAN_EN = "Let's tell the user that the board is ready.\n\nListo, ya está."
const mensajeDocente = (h, sessionID, parts) => h["chat.message"]({ sessionID }, { message: {}, parts })
const textoDocente = (h, sessionID, text) => mensajeDocente(h, sessionID, [{ type: "text", text }])
async function completar(h, sessionID, text) {
  const output = { text }
  await h["experimental.text.complete"]({ sessionID, messageID: "x", partID: "p" }, output)
  return output.text
}

test("pedido de inglés: vale ese turno y los 2 siguientes; al cuarto se filtra", async () => {
  const { h } = await hooks()
  await textoDocente(h, "s", "escribime en inglés un texto corto para la clase")
  assert.equal(await completar(h, "s", PLAN_EN), PLAN_EN, "turno del pedido")
  await textoDocente(h, "s", "hacelo más corto")
  assert.equal(await completar(h, "s", PLAN_EN), PLAN_EN, "turno 2")
  await mensajeDocente(h, "s", [{ type: "file", mime: "image/png", url: "data:," }])
  assert.equal(await completar(h, "s", PLAN_EN), PLAN_EN, "turno 3 (una imagen sola también es un turno)")
  await textoDocente(h, "s", "gracias")
  assert.equal(await completar(h, "s", PLAN_EN), "Listo, ya está.", "turno 4: ya no vale")
})

test("pedido de inglés: 'en español' lo corta en el acto", async () => {
  const { h } = await hooks()
  await textoDocente(h, "s", "en inglés porfa")
  await textoDocente(h, "s", "ahora en español, por favor")
  assert.equal(await completar(h, "s", PLAN_EN), "Listo, ya está.")
})

test("transform: un mensaje del docente con sólo partes sintéticas no cuenta como turno", async () => {
  const { h } = await hooks()
  const u = (id, parts) => ({ info: { id, role: "user", sessionID: "s" }, parts })
  const a = (id, text) => ({ info: { id, role: "assistant", sessionID: "s", agent: "tecnia-bot" }, parts: [{ id: id + "p", type: "text", text }] })
  const messages = [
    u("u1", [{ type: "text", text: "en inglés porfa" }]),
    a("a1", "Done."),
    u("u2", [{ type: "text", text: "continue", synthetic: true }]),
    u("u3", [{ type: "text", text: "otra" }]),
    u("u4", [{ type: "text", text: "y otra" }]),
    a("a4", PLAN_EN),
  ]
  const a4 = messages[5]
  await h["experimental.chat.messages.transform"]({}, { messages })
  assert.equal(messages[5], a4, "todavía vale el pedido: u1 (3), u3 (2), u4 (1); el sintético no cuenta")
})

test("transform: si el plugin arrancó a mitad de charla, el historial manda sobre chat.message", async () => {
  const { h } = await hooks()
  // Proceso nuevo (`opencode run -s`): chat.message sólo ve el último mensaje...
  await textoDocente(h, "s9", "hacelo más corto")
  // ...pero el historial trae el pedido de inglés de un turno antes.
  const u = (id, text) => ({ info: { id, role: "user", sessionID: "s9" }, parts: [{ type: "text", text }] })
  const messages = [u("u1", "en inglés porfa"), { info: { id: "a1", role: "assistant", sessionID: "s9", agent: "tecnia-bot" }, parts: [] }, u("u2", "hacelo más corto")]
  await h["experimental.chat.messages.transform"]({}, { messages })
  assert.equal(await completar(h, "s9", PLAN_EN), PLAN_EN)
})

test("caché: la clave lleva la señal de inglés pedido (mismo texto y mismo mensaje, otra decisión)", async () => {
  const { h } = await hooks()
  const texto = PLAN_EN + " (señal)"
  await textoDocente(h, "A", "en inglés porfa")
  await textoDocente(h, "A", "ok")
  assert.equal(await completar(h, "A", texto), texto, "A: el pedido sigue valiendo")
  await textoDocente(h, "B", "ok")
  assert.equal(await completar(h, "B", texto), "Listo, ya está. (señal)", "B: mismo mensaje 'ok', sin pedido")
})

test("caché: la clave lleva el mensaje del docente (con eco se borra, sin eco no)", async () => {
  const { h } = await hooks()
  const texto = `"${DOCENTE}"\n\n${RESPUESTA_EN}`
  await textoDocente(h, "A", DOCENTE)
  assert.equal(await completar(h, "A", texto), "")
  await textoDocente(h, "B", "otra cosa")
  assert.equal(await completar(h, "B", texto), texto)
})

test("rendimiento: un mensaje del docente de 100 KB y 60 citas no frenan el historial", async () => {
  const { h } = await hooks()
  const log = "Sensor value: 512 temp 26.5 hum 40\n".repeat(3000)
  const resp = "En tu log aparecen líneas como:\n" + Array.from({ length: 60 }, (_, i) => `- "Sensor value: ${500 + i}"`).join("\n") + "\n\nTodo anda bien."
  const messages = [{ info: { id: "u", role: "user", sessionID: "s" }, parts: [{ type: "text", text: log }] }]
  for (let i = 0; i < 40; i++) messages.push({ info: { id: "a" + i, role: "assistant", sessionID: "s", agent: "tecnia-bot" }, parts: [{ type: "text", text: resp + " " + i }] })
  const t0 = performance.now()
  await h["experimental.chat.messages.transform"]({}, { messages })
  assert.ok(performance.now() - t0 < 1500, `tardó ${(performance.now() - t0).toFixed(0)} ms`)
  assert.equal(messages[1].parts[0].text, resp + " 0")
})

// ---------------------------------------------------------------------------
// Ronda 5: pedido mixto, turnos con imagen y compactación
// ---------------------------------------------------------------------------

const CONSIGNA_EN = "Let's build a traffic light! First, connect the red LED to pin 13 and then the green one to pin 11. After that, we will upload the code to the board."

test("pedido mixto (inglés Y español): gana el inglés, no se borra lo pedido", async () => {
  for (const [k, pedido] of [
    "pasame la consigna en inglés y abajo explicámela en español",
    "traducí la consigna al inglés; lo demás dejalo en castellano",
    "pasala al inglés, pero hablame en español",
  ].entries()) {
    const { h } = await hooks()
    await textoDocente(h, "m" + k, pedido)
    const texto = CONSIGNA_EN + "\n\nY en español: armamos un semáforo."
    assert.equal(await completar(h, "m" + k, texto), texto, pedido)
  }
})

test("transform: un turno con sólo una imagen cuenta como turno", async () => {
  const { h } = await hooks()
  const u = (id, parts) => ({ info: { id, role: "user", sessionID: "s" }, parts })
  const img = [{ type: "file", mime: "image/png", url: "data:," }]
  const messages = [
    u("u1", [{ type: "text", text: "en inglés porfa" }]),
    u("u2", img),
    u("u3", img),
    u("u4", [{ type: "text", text: "seguí" }]),
    { info: { id: "a4", role: "assistant", sessionID: "s", agent: "tecnia-bot" }, parts: [{ id: "a4p", type: "text", text: PLAN_EN }] },
  ]
  await h["experimental.chat.messages.transform"]({}, { messages })
  assert.equal(messages[4].parts[0].text, "Listo, ya está.", "u1 (3), imagen (2), imagen (1), u4 (0): ya no vale")
})

test("compactación: mientras compacta, el transform no pisa lo que se sabe del docente", async () => {
  const { h } = await hooks()
  await textoDocente(h, "s", "en inglés porfa")
  await h["experimental.session.compacting"]({ sessionID: "s" }, { context: [] })
  // La copia parcial que resume no trae el pedido.
  await h["experimental.chat.messages.transform"]({}, { messages: [{ info: { id: "u0", role: "user", sessionID: "s" }, parts: [{ type: "text", text: "hola" }] }] })
  await h.event({ event: { type: "session.compacted", properties: { sessionID: "s" } } })
  assert.equal(await completar(h, "s", PLAN_EN), PLAN_EN, "el pedido de inglés sigue valiendo")
})

test("compactación: si el historial empieza en el resumen, vale el mayor 'restan' entre lo guardado y lo rehecho", async () => {
  const { h } = await hooks()
  await textoDocente(h, "s", "en inglés porfa")
  const messages = [
    // El mensaje que crea la compactación: una parte `compaction` y ningún texto. No es un turno.
    { info: { id: "uc", role: "user", sessionID: "s" }, parts: [{ type: "compaction", auto: true }] },
    { info: { id: "ac", role: "assistant", sessionID: "s", agent: "compaction", summary: true }, parts: [{ type: "text", text: "## Goal\n- The user wants an English worksheet." }] },
  ]
  await h["experimental.chat.messages.transform"]({}, { messages })
  assert.equal(await completar(h, "s", PLAN_EN), PLAN_EN)
})

test("transform: el mensaje que crea la compactación (sin texto) no cuenta como turno", async () => {
  const { h } = await hooks()
  const u = (id, parts) => ({ info: { id, role: "user", sessionID: "s" }, parts })
  const messages = [
    u("u1", [{ type: "text", text: "en inglés porfa" }]),
    u("uc", [{ type: "compaction", auto: true }]),
    u("u2", [{ type: "text", text: "seguí" }]),
    u("u3", [{ type: "text", text: "otra" }]),
    { info: { id: "a3", role: "assistant", sessionID: "s", agent: "tecnia-bot" }, parts: [{ id: "a3p", type: "text", text: PLAN_EN }] },
  ]
  const a3 = messages[4]
  await h["experimental.chat.messages.transform"]({}, { messages })
  assert.equal(messages[4], a3, "u1 (3), u2 (2), u3 (1): todavía vale")
})

test("una queja 'me estás contestando en inglés' no apaga el filtro: se limpia ese turno y los siguientes", async () => {
  const { h } = await hooks()
  const fuga = "Let's tell the user that the board is ready and that we will upload now.\n\nListo, la placa está lista. ¿La cargo?"
  for (const m of ["me estás contestando en inglés, hablame en español", "dale, cargala", "¿y ahora qué hago?"]) {
    await textoDocente(h, "q", m)
    assert.equal(await completar(h, "q", fuga), "Listo, la placa está lista. ¿La cargo?", m)
  }
})
