// Smoke tests del tool `perfil` (opencode/tool/perfil.ts).
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).
//
// Cubre los TRES modos y la PRIVACIDAD DE MENORES:
// - personal: guarda nombre + genero.
// - aula (compartida por muchos): NUNCA guarda nombre ni genero.
// - grupo (pocas personas conocidas): recuerda a cada una (nombre, rol, genero).

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

test("personal: nombre y género SI se persisten", async () => {
  await mod.execute({ accion: "guardar", modo: "personal", nombre: "Marta", genero: "mujer", rol: "docente" }, {})
  const g = readFileSync(perfilFile, "utf8")
  assert.match(g, /^-\s*Nombre:\s*Marta\s*$/m, "el nombre debe quedar guardado")
  assert.match(g, /^-\s*Género:\s*mujer\s*$/m, "el género debe quedar guardado")
})

test("aula: ni nombre ni género se persisten (privacidad de menores)", async () => {
  await mod.execute({ accion: "guardar", modo: "aula", nombre: "Juan", genero: "varón", rol: "alumno", placa: "ESP32" }, {})
  const g = readFileSync(perfilFile, "utf8")
  assert.doesNotMatch(g, /Juan/, "en aula el nombre NUNCA va a disco")
  assert.match(g, /^-\s*Nombre:\s*\(sin definir\)\s*$/m)
  assert.match(g, /^-\s*Género:\s*\(sin definir\)\s*$/m, "en aula el género tampoco")
  assert.match(g, /^-\s*Rol:\s*alumno\s*$/m, "el rol si se conserva")
})

test("cambiar a aula BORRA un nombre viejo ya persistido", async () => {
  await mod.execute({ accion: "guardar", modo: "personal", nombre: "Sofia", genero: "mujer" }, {})
  assert.match(readFileSync(perfilFile, "utf8"), /Sofia/)
  await mod.execute({ accion: "guardar", modo: "aula" }, {})
  assert.doesNotMatch(readFileSync(perfilFile, "utf8"), /Sofia/, "al pasar a aula, el nombre viejo se borra")
})

test("grupo: recuerda a VARIAS personas, cada una con su género", async () => {
  await mod.execute({ accion: "guardar", modo: "grupo", persona: "Marta", rol: "docente", genero: "mujer" }, {})
  await mod.execute({ accion: "guardar", modo: "grupo", persona: "Juan", rol: "alumno", genero: "varón" }, {})
  const g = readFileSync(perfilFile, "utf8")
  assert.match(g, /##\s*Personas/, "debe existir la sección Personas")
  assert.match(g, /-\s*Marta\s*\|\s*docente\s*\|\s*mujer/, "Marta guardada con su género")
  assert.match(g, /-\s*Juan\s*\|\s*alumno\s*\|\s*varón/, "Juan guardado con su género")
  const r = await mod.execute({ accion: "leer" }, {})
  assert.match(r, /Marta/)
  assert.match(r, /Juan/)
})

test("grupo: actualizar a la misma persona NO la duplica", async () => {
  await mod.execute({ accion: "guardar", modo: "grupo", persona: "Marta", rol: "docente", genero: "mujer" }, {})
  await mod.execute({ accion: "guardar", modo: "grupo", persona: "marta", placa: "ESP32" }, {}) // misma persona, otro caso
  const g = readFileSync(perfilFile, "utf8")
  const cuenta = (g.match(/^-\s*marta\s*\|/gim) || []).length
  assert.equal(cuenta, 1, "Marta debe aparecer una sola vez")
  assert.match(g, /mujer/, "conserva el género del guardado anterior")
  assert.match(g, /ESP32/, "y suma la placa nueva")
})