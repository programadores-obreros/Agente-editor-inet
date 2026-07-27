// Smoke tests del tool `ayuda` (opencode/tool/ayuda.ts).
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-ayuda-test")
const cfg = join(OUT, "cfg")

let mod
globalThis.Bun = { spawn: () => ({ unref() {} }) }

before(async () => {
  mkdirSync(join(cfg, "opencode", "tecniabot-web"), { recursive: true })
  process.env.XDG_CONFIG_HOME = cfg
  // Simulamos el manual "instalado" con la capa.
  writeFileSync(join(cfg, "opencode", "tecniabot-web", "manual.html"), "<html>manual</html>")

  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/ayuda.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "ayuda.ts"), src)
  mod = (await import(join(OUT, "ayuda.ts"))).default
})

test("ayuda: devuelve el resumen con ejemplos de prompts y comandos", async () => {
  const r = await mod.execute({}, {})
  assert.match(r, /cómo usarlo|30 segundos/i, "trae el resumen")
  assert.match(r, /monitor serial/i, "menciona ejemplos de lo que puede hacer")
  assert.match(r, /\/diagnostico/, "menciona los comandos")
})

test("ayuda: avisa que abrió el manual completo si está instalado", async () => {
  const r = await mod.execute({}, {})
  assert.match(r, /manual completo/i, "confirma el manual")
})
