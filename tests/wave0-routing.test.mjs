// W-W0-ROUTING (PHASE_3_WAVE_0_DESIGN.md, F-03/F-04/F-06/F-13/F-15) — tests
// ESTÁTICOS sobre el prompt del agente, el skill `circuitos-visuales` y el HTML
// que genera el tool legado `circuito`. El comportamiento real del LLM NO se
// prueba acá (no es determinista): eso lo valida el gate de la VM. Lo que sí se
// puede probar, y se prueba, es que el TEXTO que el modelo va a leer —el prompt,
// el skill, la descripción de la tool, el HTML que la tool genera— dice lo que
// el diseño exige.
//
// Corre con: node --test tests/*.test.mjs

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (rel) => readFileSync(join(REPO, rel), "utf8")

const prompt = leer("opencode/agent/tecnia-bot.md")
const skill = leer("opencode/skills/circuitos-visuales/SKILL.md")
const circuitoSrc = leer("opencode/tool/circuito.ts")

// ════════════════════════════════════════════════════════════════════════════
// F-03 — el flujo natural tiene que llegar a `proyecto-fisico`/`vista-fisica`
// ANTES de la regla de `circuito`, con la frontera explícita.
// ════════════════════════════════════════════════════════════════════════════

test("F-03: existe la REGLA CRÍTICA — proyecto físico, ANTES que la de circuitos visuales", () => {
  const iProyecto = prompt.indexOf("REGLA CRÍTICA — proyecto físico")
  const iCircuitos = prompt.indexOf("REGLA CRÍTICA — circuitos visuales")
  assert.ok(iProyecto >= 0, "no está la sección 'REGLA CRÍTICA — proyecto físico'")
  assert.ok(iCircuitos >= 0, "no está la sección 'REGLA CRÍTICA — circuitos visuales' (¿se renombró?)")
  assert.ok(iProyecto < iCircuitos, "la regla de proyecto físico tiene que ir ANTES que la de circuitos visuales")
})

test("F-03: la regla de proyecto físico manda a proyecto-fisico/vista-fisica, con leer y vocabulario", () => {
  const iProyecto = prompt.indexOf("REGLA CRÍTICA — proyecto físico")
  const iCircuitos = prompt.indexOf("REGLA CRÍTICA — circuitos visuales")
  assert.ok(iProyecto >= 0 && iCircuitos > iProyecto, "no pude acotar el bloque de la regla")
  const bloque = prompt.slice(iProyecto, iCircuitos)

  assert.match(bloque, /`proyecto-fisico`/, "no nombra la tool proyecto-fisico")
  assert.match(bloque, /`vista-fisica`/, "no nombra la tool vista-fisica")
  assert.match(bloque, /`leer`/, "no dice que hay que llamar 'leer'")
  assert.match(bloque, /vocabulario/, "no menciona el vocabulario que trae 'leer'")
})

test("F-03: la frontera de `circuito` queda explícita (piezas no cubiertas, láminas, proyectos de ejemplo)", () => {
  const iProyecto = prompt.indexOf("REGLA CRÍTICA — proyecto físico")
  const iCircuitos = prompt.indexOf("REGLA CRÍTICA — circuitos visuales")
  const bloque = prompt.slice(iProyecto, iCircuitos)

  assert.match(bloque, /[Ff]rontera/, "no está la palabra 'frontera' acotando cuándo sí usar circuito")
  assert.match(bloque, /nunca.{0,40}estado del proyecto|estado del proyecto.{0,40}nunca/is,
    "no dice que circuito NUNCA es el estado del proyecto del alumno")
})

test("F-03: la skill circuitos-visuales remite a la frontera (no es el único camino)", () => {
  assert.match(skill, /proyecto-fisico/, "la skill no remite a proyecto-fisico para lo que el Engine cubre")
  assert.doesNotMatch(skill, /ÚNICO método aprobado/,
    "la skill sigue diciendo que circuito es el ÚNICO método aprobado, sin matiz")
})

// ════════════════════════════════════════════════════════════════════════════
// F-13 — los pines: proyecto-fisico leer es la única fuente de verdad.
// ════════════════════════════════════════════════════════════════════════════

test("F-13: proyecto-fisico leer es la fuente de verdad de los pines, no el circuito legado", () => {
  assert.doesNotMatch(prompt, /El circuito es la fuente de verdad de los pines/,
    "sigue la afirmación vieja de L144: el circuito legado ya no puede ser la fuente de verdad")
  assert.match(prompt, /`proyecto-fisico leer`/, "no nombra 'proyecto-fisico leer' como fuente de pines")
  assert.match(prompt, /fuente de verdad/i, "perdió la idea de 'fuente de verdad' aplicada al proyecto físico")
})

// ════════════════════════════════════════════════════════════════════════════
// F-06 — afirmaciones de estado sólo después de una línea APLICADO.
// ════════════════════════════════════════════════════════════════════════════

test("F-06: la regla de afirmaciones cita APLICADO / NO SE APLICÓ / SÓLO LECTURA / SIMULACIÓN / VACÍO", () => {
  const iProyecto = prompt.indexOf("REGLA CRÍTICA — proyecto físico")
  assert.ok(iProyecto >= 0)
  const iCircuitos = prompt.indexOf("REGLA CRÍTICA — circuitos visuales")
  const bloque = prompt.slice(iProyecto, iCircuitos)

  assert.match(bloque, /APLICADO/, "no cita APLICADO")
  assert.match(bloque, /NO SE APLIC[ÓO]/, "no cita NO SE APLICÓ NADA")
  assert.match(bloque, /S[ÓO]LO LECTURA/, "no cita SÓLO LECTURA")
  assert.match(bloque, /SIMULACI[ÓO]N/, "no cita SIMULACIÓN")
  assert.match(bloque, /VAC[ÍI]O/, "no dice qué hacer cuando vista-fisica dice VACÍO")
})

// ════════════════════════════════════════════════════════════════════════════
// F-04 — el preset interactivo se rotula como lámina de ejemplo (HTML + descripción).
// ════════════════════════════════════════════════════════════════════════════

const OUT = join(os.tmpdir(), "tecniabot-test-wave0-routing")
const OUTDIR = join(OUT, "out")
let mod

before(async () => {
  const web = join(os.tmpdir(), "tecniabot-test-wave0-routing-cfg", "opencode", "tecniabot-web")
  mkdirSync(web, { recursive: true })
  writeFileSync(join(web, "wokwi-bundle.js"), "/*stub*/")
  writeFileSync(join(web, "componentes-extra.js"), "/*stub*/")
  process.env.XDG_CONFIG_HOME = join(os.tmpdir(), "tecniabot-test-wave0-routing-cfg")

  globalThis.Bun = {
    file: (p) => ({ __path: p }),
    write: async (d, x) => {
      if (x && x.__path) writeFileSync(d, readFileSync(x.__path))
      else writeFileSync(d, x)
    },
  }

  rmSync(OUTDIR, { recursive: true, force: true })
  mkdirSync(OUTDIR, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = circuitoSrc
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "circuito.ts"), src)
  mod = (await import(join(OUT, "circuito.ts"))).default
})

test("F-04: el HTML del preset interactivo boton-esp32 dice 'Lámina de ejemplo — no es tu proyecto'", async () => {
  await mod.execute({ circuito: "boton-esp32", nombre_archivo: "wave0-boton-esp32" }, { directory: OUTDIR })
  const file = join(OUTDIR, "wave0-boton-esp32.html")
  assert.ok(existsSync(file), "el preset boton-esp32 no generó el HTML")
  const html = readFileSync(file, "utf8")
  assert.match(html, /Lámina de ejemplo — no es tu proyecto/,
    "el HTML de un preset interactivo no lleva el rótulo de lámina de ejemplo")
})

test("F-04: el preset NO interactivo (led-esp32) no lleva el rótulo de lámina de ejemplo", async () => {
  await mod.execute({ circuito: "led-esp32", nombre_archivo: "wave0-led-esp32" }, { directory: OUTDIR })
  const file = join(OUTDIR, "wave0-led-esp32.html")
  const html = readFileSync(file, "utf8")
  assert.doesNotMatch(html, /Lámina de ejemplo — no es tu proyecto/,
    "un preset NO interactivo no debería llevar el rótulo (no hay nada que confundir con el proyecto del alumno)")
})

test("F-04: la descripción de la tool circuito ya no dice 'ÚNICO método aprobado'", () => {
  assert.doesNotMatch(circuitoSrc, /ÚNICO método aprobado/,
    "la descripción de circuito sigue afirmando que es el ÚNICO método aprobado")
  assert.match(circuitoSrc, /proyecto-fisico/,
    "la descripción de circuito no remite a proyecto-fisico para las piezas que el Engine cubre")
})

// ════════════════════════════════════════════════════════════════════════════
// F-15 — código sólo ante un pedido EXPLÍCITO; comportamiento sin código no salta a C++.
// ════════════════════════════════════════════════════════════════════════════

test("F-15: el código/platformio.ini/compilar quedan acotados a un pedido EXPLÍCITO de código", () => {
  const i = prompt.indexOf("REGLA CRÍTICA — el código se compila ANTES de mostrarlo")
  assert.ok(i >= 0, "no encontré la sección del código/compilación")
  const bloque = prompt.slice(i, i + 3500)

  assert.match(bloque, /pedido EXPLÍCITO de código|EXPLÍCITO de código/,
    "no acota la regla a un pedido explícito de código/programa/subir a la placa")
  assert.match(bloque, /LED/, "el ejemplo de comportamiento no menciona el LED")
  assert.match(bloque, /pulsador/, "el ejemplo de comportamiento no menciona el pulsador")
  assert.match(bloque, /todav[ií]a no se puede construir|TODAV[ÍI]A NO SE PUEDE CONSTRUIR/i,
    "no dice que esa relación todavía no se puede construir en el proyecto físico de esta versión")
})

test("F-15: la excepción de 'un solo paso' (L65-71) sigue intacta y queda acotada a pedido explícito", () => {
  // Pinneado también por tests/tecnia-bot-prompt.test.mjs ("las reglas nuevas no
  // se contradicen entre sí"): la excepción tiene que seguir legible en los
  // primeros 700 caracteres desde "UNA cosa por turno".
  const i1 = prompt.indexOf("UNA cosa por turno")
  assert.ok(i1 >= 0)
  const b1 = prompt.slice(i1, i1 + 700)
  assert.match(b1, /única excepción|UN solo paso/i, "la excepción de un solo paso se perdió o se movió")

  const i2 = prompt.indexOf("única excepción")
  assert.ok(i2 >= 0)
  const bloque = prompt.slice(i2, i2 + 1200)
  assert.match(bloque, /pedido EXPL[ÍI]CITO/i, "la excepción de un solo paso no queda acotada a un pedido explícito")
})
