// Smoke tests del tool `actualizar` (opencode/tool/actualizar.ts), modo "verificar".
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).
//
// Mockeamos: (a) el plugin, (b) Bun.spawn (para simular la respuesta de
// `git ls-remote`), y (c) un XDG_CONFIG_HOME falso con un manifest de versión 0.1.0.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-actualizar-test")

let mod

// Permite a cada test decidir qué "devuelve git ls-remote".
let salidaGit = ""
function setBun(salida) {
  salidaGit = salida
  globalThis.Bun = {
    spawn: () => ({ exited: Promise.resolve(0), stdout: salidaGit, stderr: "" }),
  }
}

before(async () => {
  // Manifest falso: versión instalada 0.1.0
  const cfg = join(OUT, "cfg")
  mkdirSync(join(cfg, "opencode"), { recursive: true })
  writeFileSync(
    join(cfg, "opencode", "tecnia-bot.manifest"),
    "# manifest\nversion=0.1.0\nrepo_dir=/tmp/x\nagent/tecnia-bot.md\n",
  )
  process.env.XDG_CONFIG_HOME = cfg
  setBun("")

  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/actualizar.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "actualizar.ts"), src)
  mod = (await import(join(OUT, "actualizar.ts"))).default
})

test("verificar: cuando la instalada es la última, dice que está al día", async () => {
  setBun("abc\trefs/tags/v0.1.0\n")
  const r = await mod.execute({ verificar: true }, {})
  assert.match(r, /al día/i, "debería decir que está al día")
})

test("verificar: cuando hay una versión más nueva, la detecta", async () => {
  setBun("a\trefs/tags/v0.1.0\nb\trefs/tags/v0.2.0\nc\trefs/tags/v0.1.5\n")
  const r = await mod.execute({ verificar: true }, {})
  assert.match(r, /v0\.2\.0/, "debería nombrar la versión nueva 0.2.0")
  assert.match(r, /actualizar/i, "debería sugerir actualizar")
})

test("verificar: no confunde 0.10.0 con 0.2.0 (compara numérico, no texto)", async () => {
  setBun("a\trefs/tags/v0.2.0\nb\trefs/tags/v0.10.0\n")
  const r = await mod.execute({ verificar: true }, {})
  assert.match(r, /v0\.10\.0/, "0.10.0 es más nueva que 0.2.0 (comparación numérica)")
})
