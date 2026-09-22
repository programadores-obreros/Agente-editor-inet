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
  mkdirSync(join(cfg, "opencode", "tecniabot-web", "sitio"), { recursive: true })
  process.env.XDG_CONFIG_HOME = cfg
  // Simulamos el micro-sitio "instalado" con la capa.
  writeFileSync(join(cfg, "opencode", "tecniabot-web", "sitio", "index.html"), "<html>sitio</html>")

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

test("ayuda: si ABRIÓ el manual lo dice, y si no pudo da la ruta para el doble clic", async () => {
  // EL TEST QUE ESTABA ACÁ NO PROBABA NADA, y falló como fallan los peores: en verde.
  // Buscaba /manual completo/i, pero LAS DOS ramas del ternario de ayuda.ts lo dicen
  // ("Te abrí el manual completo en el navegador" y "El manual completo está en ..."),
  // así que el assert se cumplía pasara lo que pasara. Verificado por mutación antes
  // de reescribirlo: con abrirEnNavegador() devolviendo siempre false, el test viejo
  // seguía pasando 2/2. Un assert que no puede distinguir las dos ramas que existen
  // no es una red, es un adorno.
  //
  // Ahora se prueban LAS DOS ramas, y cada una con lo que la otra NO puede decir.

  // (a) el navegador abre: el mensaje tiene que AFIRMAR que lo abrió...
  globalThis.Bun.spawn = () => ({ unref() {} })
  const abrio = await mod.execute({}, {})
  assert.match(abrio, /Te abrí el manual completo en el navegador/, "no avisa que lo abrió")
  // ...y NO ofrecer el doble clic, que sería mandar a la docente a hacer a mano algo ya hecho.
  assert.doesNotMatch(abrio, /doble clic/, "ofrece abrir a mano algo que ya abrió")

  // (b) el navegador NO abre (el caso real: PC de escuela sin navegador por defecto).
  globalThis.Bun.spawn = () => {
    throw new Error("no hay navegador")
  }
  const fallo = await mod.execute({}, {})
  assert.doesNotMatch(fallo, /Te abrí/, "afirma haber abierto el manual sin haberlo abierto")
  assert.match(fallo, /doble clic/, "no ofrece el camino manual")
  // Y si ofrece una ruta, la ruta TIENE que estar: es la misma regla que urls.test.mjs.
  assert.match(fallo, /file:\/\//, "manda a abrir un archivo sin decir cuál")
  assert.match(fallo, /index\.html/, "la URL no apunta al micro-sitio")

  globalThis.Bun.spawn = () => ({ unref() {} }) // lo dejo como estaba para los demás tests
})
