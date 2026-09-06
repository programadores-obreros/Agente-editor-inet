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

// La última versión publicada la lee actualizar.ts con fetch() a la API de
// releases de GitHub (`releases/latest`, campo tag_name, ver ultimaVersionPublicada).
// Cada test decide qué devuelve; el tag lleva la "v" adelante como en GitHub.
function setPublicada(v, ok = true) {
  globalThis.fetch = async () => ({ ok, json: async () => ({ tag_name: v ? `v${v}` : "" }) })
}
// Stub inofensivo de Bun: actualizar.ts lo usa SOLO en el modo ACTUALIZAR (no en verificar).
globalThis.Bun = { spawn: () => ({ exited: Promise.resolve(0), stdout: "", stderr: "" }) }
// Reescribe el manifest con la versión INSTALADA que el test quiera simular.
let cfgDir
function setInstalada(v) {
  writeFileSync(
    join(cfgDir, "opencode", "tecnia-bot.manifest"),
    `# manifest\nversion=${v}\nrepo_dir=/tmp/x\nagent/tecnia-bot.md\n`,
  )
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
  cfgDir = cfg

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
  setInstalada("0.1.0")
  setPublicada("0.1.0")
  const r = await mod.execute({ verificar: true }, {})
  assert.match(r, /al día/i, "debería decir que está al día")
})

test("verificar: cuando hay una versión más nueva, la detecta", async () => {
  setInstalada("0.1.0")
  setPublicada("0.2.0")
  const r = await mod.execute({ verificar: true }, {})
  assert.match(r, /v0\.2\.0/, "debería nombrar la versión nueva 0.2.0")
  assert.match(r, /actualizar/i, "debería sugerir actualizar")
})

test("verificar: no confunde 0.10.0 con 0.2.0 (compara numérico, no texto)", async () => {
  setInstalada("0.2.0")
  setPublicada("0.10.0")
  const r = await mod.execute({ verificar: true }, {})
  assert.match(r, /v0\.10\.0/, "0.10.0 es más nueva que 0.2.0 (comparación numérica)")
})

test("verificar: si no puede leer la versión publicada, lo dice sin romper", async () => {
  setInstalada("0.1.0")
  setPublicada("", false) // fetch responde !ok → ultimaVersionPublicada devuelve null
  const r = await mod.execute({ verificar: true }, {})
  assert.match(r, /no pude verificar/i, "debería avisar que no pudo verificar, sin romper")
})

// ── Robustez: red bloqueada y actualizador que no arranca ────────────────────
//
// En una escuela GitHub no "falla": se queda colgado. Y PowerShell puede estar
// fuera del PATH o bloqueado por política. Ninguna de las dos cosas puede dejar
// al bot "pensando" para siempre ni tirar una excepción a la cara del docente.

const SPAWN_ORIGINAL = globalThis.Bun.spawn
const enc = new TextEncoder()

// Manifest con un repo_dir que EXISTE, para llegar al modo actualizar.
function setInstaladaConRepo(v) {
  writeFileSync(
    join(cfgDir, "opencode", "tecnia-bot.manifest"),
    `# manifest\nversion=${v}\nrepo_dir=${OUT}\nagent/tecnia-bot.md\n`,
  )
}

test("verificar: un fetch que nunca responde termina en el timeout con el mensaje de red", { timeout: 5000 }, async () => {
  setInstalada("0.1.0")
  // fetch real: se cuelga hasta que el AbortSignal lo corta. Si el tool no pasa
  // signal, esta promesa no se resuelve nunca y el test muere por timeout.
  globalThis.fetch = (_url, opts = {}) =>
    new Promise((_, reject) => {
      const s = opts.signal
      assert.ok(s, "el tool tiene que pasar un AbortSignal al fetch")
      s.addEventListener("abort", () => reject(s.reason ?? new Error("abort")))
    })
  process.env.TECNIA_ACTUALIZAR_TIMEOUT_MS = "150"
  const t0 = Date.now()
  let r
  try {
    r = await mod.execute({ verificar: true }, {})
  } finally {
    delete process.env.TECNIA_ACTUALIZAR_TIMEOUT_MS
  }
  assert.ok(Date.now() - t0 < 3000, "no cortó a tiempo: se quedó esperando a GitHub")
  assert.match(r, /escuela[^.]*bloque/i, "tiene que decir que la escuela puede bloquear GitHub")
  assert.match(r, /v0\.1\.0/, "igual dice qué versión tiene instalada")
  assert.match(r, /SOLO la version de Tecnia Bot/, "conserva el aviso de alcance")
})

test("actualizar: si PowerShell/bash no arranca, avisa claro y no tira excepción", async () => {
  setInstaladaConRepo("0.1.0")
  globalThis.Bun.spawn = () => {
    throw new Error("spawn powershell ENOENT")
  }
  try {
    const r = await mod.execute({ verificar: false }, {})
    assert.match(r, /no pude lanzar/i, "tiene que decir que no pudo lanzar el actualizador")
    assert.match(r, /correr a mano/i, "y dejar el comando para correrlo a mano")
    assert.match(r, /0\.1\.0/, "y decir que la versión quedó como estaba")
  } finally {
    globalThis.Bun.spawn = SPAWN_ORIGINAL
  }
})

test("actualizar: lee la salida ANTES de esperar que termine (si no, se traba con el pipe lleno)", { timeout: 3000 }, async () => {
  setInstaladaConRepo("0.1.0")
  // Simula un pipe: el proceso "termina" recién cuando ALGUIEN lee su salida.
  // Es lo que pasa con un buffer de 64 KB lleno: el hijo se bloquea escribiendo
  // hasta que el padre lea. Con `await exited` primero, esto no termina nunca.
  let terminar
  const exited = new Promise((r) => (terminar = r))
  const pipe = (texto) =>
    new ReadableStream(
      {
        pull(c) {
          c.enqueue(enc.encode(texto))
          c.close()
          terminar(0)
        },
      },
      { highWaterMark: 0 },
    )
  globalThis.Bun.spawn = () => ({ exited, stdout: pipe("[OK] actualizado\n"), stderr: pipe("") })
  try {
    const r = await mod.execute({ verificar: false }, {})
    assert.match(r, /al día|Actualizado/i, "tiene que terminar y contar el resultado")
  } finally {
    globalThis.Bun.spawn = SPAWN_ORIGINAL
  }
})
