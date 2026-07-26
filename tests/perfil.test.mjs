// Smoke tests del tool `perfil` (opencode/tool/perfil.ts).
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).
//
// El foco es la PRIVACIDAD DE MENORES: en modo "aula" (compu compartida) el
// nombre NUNCA debe quedar persistido en disco. En "personal" si.

import { test, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-perfil-test")
const cfg = join(OUT, "cfg")
const perfilFile = join(cfg, "opencode", "tecnia-perfil.md")

let mod

// Bun.write real: escribe al disco con fs, asi leerPerfil (fs.readFileSync) lo ve.
globalThis.Bun = { write: async (ruta, contenido) => writeFileSync(ruta, contenido) }

before(async () => {
  mkdirSync(join(cfg, "opencode"), { recursive: true })
  process.env.XDG_CONFIG_HOME = cfg

  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/perfil.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "perfil.ts"), src)
  mod = (await import(join(OUT, "perfil.ts"))).default
})

beforeEach(() => {
  if (existsSync(perfilFile)) rmSync(perfilFile)
})

test("personal: el nombre SI se persiste", async () => {
  await mod.execute({ accion: "guardar", modo: "personal", nombre: "Marta", rol: "alumno" }, {})
  const guardado = readFileSync(perfilFile, "utf8")
  assert.match(guardado, /^-\s*Nombre:\s*Marta\s*$/m, "en personal el nombre debe quedar guardado")
})

test("aula: el nombre NO se persiste (privacidad de menores)", async () => {
  await mod.execute({ accion: "guardar", modo: "aula", nombre: "Juan", rol: "alumno", placa: "ESP32" }, {})
  const guardado = readFileSync(perfilFile, "utf8")
  assert.doesNotMatch(guardado, /Juan/, "en aula el nombre NUNCA debe quedar en disco")
  assert.match(guardado, /^-\s*Nombre:\s*\(sin definir\)\s*$/m, "el nombre queda (sin definir)")
  // Pero rol y placa (no identifican a nadie) si se conservan.
  assert.match(guardado, /^-\s*Rol:\s*alumno\s*$/m, "el rol si se conserva")
  assert.match(guardado, /^-\s*Placa preferida:\s*ESP32\s*$/m, "la placa si se conserva")
})

test("cambiar a aula BORRA un nombre viejo ya persistido", async () => {
  // Primero personal con nombre...
  await mod.execute({ accion: "guardar", modo: "personal", nombre: "Sofia" }, {})
  assert.match(readFileSync(perfilFile, "utf8"), /Sofia/, "quedo guardado en personal")
  // ...y despues la compu pasa a ser del aula: el nombre viejo se limpia.
  await mod.execute({ accion: "guardar", modo: "aula" }, {})
  assert.doesNotMatch(readFileSync(perfilFile, "utf8"), /Sofia/, "al pasar a aula, el nombre viejo se borra")
})

test("leer: perfil vacio guia a preguntar aula/personal", async () => {
  const r = await mod.execute({ accion: "leer" }, {})
  assert.match(r, /aula.*personal|personal.*aula/is, "deberia sugerir preguntar el modo")
})
