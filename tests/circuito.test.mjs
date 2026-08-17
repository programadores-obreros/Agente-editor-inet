// El catálogo de componentes tiene que aceptar lo que el modelo realmente escribe.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El prompt del agente enumera los componentes con
// tilde —`botón`, `potenciómetro`, `ultrasónico`— y el ALIAS del tool sólo tenía
// las formas sin tilde. El modelo copiaba la lista del prompt, el tool contestaba
// "No conozco: botón", y el bot improvisaba.
//
// Lo delator: el ALIAS ya traía `lámpara`, `válvula`, `higrómetro` y `presión`
// acentuados. Cubrir tildes era la intención desde el principio; el problema era
// que dependía de acordarse de cada variante a mano.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-circuito-test")

let normalizarTipo

before(async () => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/circuito.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "circuito.ts"), src)
  normalizarTipo = (await import(join(OUT, "circuito.ts"))).normalizarTipo
})

test("acepta los tres que el prompt escribe con tilde", () => {
  assert.equal(normalizarTipo("botón"), "boton")
  assert.equal(normalizarTipo("potenciómetro"), "potenciometro")
  assert.equal(normalizarTipo("ultrasónico"), "ultrasonico")
})

test("sigue aceptando las formas sin tilde", () => {
  assert.equal(normalizarTipo("boton"), "boton")
  assert.equal(normalizarTipo("potenciometro"), "potenciometro")
  assert.equal(normalizarTipo("ultrasonico"), "ultrasonico")
})

test("no rompe los alias acentuados que ya estaban", () => {
  // Éstos se resolvían por entrada explícita en ALIAS; tienen que seguir igual.
  assert.equal(normalizarTipo("lámpara"), "lampara")
  assert.equal(normalizarTipo("calefacción"), "calefactor")
  assert.equal(normalizarTipo("higrómetro"), "higrometro")
})

test("no le importan mayúsculas ni espacios de más", () => {
  assert.equal(normalizarTipo("  BOTÓN  "), "boton")
  assert.equal(normalizarTipo("Ultrasónico"), "ultrasonico")
})

test("los alias por sinónimo siguen funcionando", () => {
  assert.equal(normalizarTipo("pulsador"), "boton")
  assert.equal(normalizarTipo("ir"), "ir-receptor")
})

test("lo desconocido pasa como está, sin inventar", () => {
  assert.equal(normalizarTipo("transistor"), "transistor")
})

test("el prompt puede seguir escribiendo con tilde sin romper nada", () => {
  // La lista del prompt es la que el modelo copia. Cada nombre que enumera
  // tiene que resolver a una clave que el catálogo conozca.
  const prompt = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
  const linea = prompt.split("\n").find((l) => l.includes("MÁS DE 30 componentes"))
  assert.ok(linea, "el prompt tiene que enumerar los componentes")
  const citados = (linea.match(/\(([^)]+)\)/)?.[1] ?? "").split(",").map((s) => s.trim())
  const src = readFileSync(join(REPO, "opencode/tool/circuito.ts"), "utf8")
  for (const c of citados) {
    if (!c || c.includes(" ")) continue
    const clave = normalizarTipo(c)
    assert.ok(
      src.includes(`"${clave}"`) || src.includes(`${clave}:`),
      `el prompt cita "${c}" → normaliza a "${clave}", que no está en el catálogo`,
    )
  }
})
