// Smoke tests del prompt del agente (opencode/agent/tecnia-bot.md).
// Verifica, por substrings, que las reglas críticas de "ejecutá la tool, no la
// describas" y de "no usar webfetch con rutas locales" estén presentes en el
// archivo. No ejecuta el LLM: es un test de contenido del prompt.
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

let prompt

before(() => {
  prompt = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
})

test("tecnia-bot.md: tiene la regla crítica de ejecutar, no describir, la tool", () => {
  assert.match(prompt, /REGLA CRÍTICA — EJECUTÁ la tool, nunca la describas/, "título de la regla")
  assert.match(prompt, /NUNCA le expliques al usuario cómo la usarías vos/, "prohibición explícita de narrar")
})

test("tecnia-bot.md: platformio, memoria y perfil quedan reforzados con EJECUTÁ", () => {
  assert.match(prompt, /EJECUTÁ vos el tool `platformio`/, "refuerzo en platformio")
  assert.match(prompt, /Guardalo VOS ejecutando la tool en ese mismo momento/, "refuerzo en memoria")
  assert.match(
    prompt,
    /significa que EJECUTÁS la tool en ese instante/,
    "refuerzo en perfil",
  )
})

test("tecnia-bot.md: Limitaciones quedó en modo imperativo, no descriptivo", () => {
  assert.match(prompt, /esto no es para recitarle al usuario/i, "nota interna anti-narración")
  assert.doesNotMatch(prompt, /Guardás el perfil con el tool `perfil`/, "ya no usa la voz descriptiva vieja")
})

test("tecnia-bot.md: prohíbe explícitamente webfetch con rutas locales/file://", () => {
  assert.match(
    prompt,
    /JAMÁS uses el tool `webfetch` con una ruta local o `file:\/\/`/,
    "prohibición explícita de webfetch local",
  )
  assert.match(prompt, /ruta exacta/, "indica dar la ruta exacta al usuario")
  assert.match(prompt, /doble clic/, "indica pedir doble clic para abrir el archivo")
})
