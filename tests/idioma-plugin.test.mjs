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
    parts: [{ id: "prt_u", type: "text", text: "Let's see what the board says, please answer in English." }],
  }
  const asistenteSucio = {
    info: { id: "msg_a1", role: "assistant", sessionID: "s" },
    parts: [
      { id: "prt_r", type: "reasoning", text: "The user wants to know if the board is there. Let's check." },
      { id: "prt_t1", type: "text", text: FUGA },
      { id: "prt_tool", type: "tool", tool: "platformio", state: { status: "completed", output: "Let's not touch this: the tool output stays as it is." } },
      { id: "prt_t2", type: "text", text: PLAN },
    ],
  }
  const asistenteLimpio = {
    info: { id: "msg_a2", role: "assistant", sessionID: "s" },
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

test("transform: con mensajes rotos no tira", async () => {
  const { h } = await hooks()
  await assert.doesNotReject(h["experimental.chat.messages.transform"]({}, { messages: [null, { info: {} }] }))
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
