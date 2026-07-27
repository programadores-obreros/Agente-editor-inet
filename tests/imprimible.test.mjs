// Smoke tests del tool `imprimible` (opencode/tool/imprimible.ts).
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).
// Mockeamos el plugin, Bun.write (escribe con fs) y Bun.spawn (no abre nada).

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-imprimible-test")

let mod

globalThis.Bun = {
  write: async (ruta, contenido) => writeFileSync(ruta, contenido),
  spawn: () => ({ unref() {} }),
}

before(async () => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/imprimible.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "imprimible.ts"), src)
  mod = (await import(join(OUT, "imprimible.ts"))).default
})

test("genera la hoja con materiales, conexiones y código", async () => {
  const r = await mod.execute(
    {
      titulo: "Semáforo — ESP32",
      placa: "ESP32",
      materiales: ["3x LED", "3x resistencia 330Ω"],
      conexiones: ["LED rojo → GPIO12", "Cátodos → GND"],
      codigo: "void setup() {}",
      notas: "El ESP32 va a 3.3V.",
    },
    { directory: OUT },
  )
  assert.match(r, /Ctrl \+ P|Ctrl\+P/i, "avisa cómo imprimir/guardar PDF")

  const html = readFileSync(join(OUT, "hoja-semaforo-esp32.html"), "utf8")
  assert.match(html, /Semáforo — ESP32/, "el título está")
  assert.match(html, /<li>3x LED<\/li>/, "los materiales van como lista")
  assert.match(html, /<td>LED rojo<\/td><td>GPIO12<\/td>/, "las conexiones van a tabla (partidas por la flecha)")
  assert.match(html, /void setup\(\)/, "el código está")
  assert.match(html, /El ESP32 va a 3\.3V/, "las notas de seguridad están")
  assert.match(html, /@media print/, "tiene CSS de impresión")
})

test("escapa el HTML del código (no rompe ni inyecta)", async () => {
  await mod.execute(
    {
      titulo: "Test escape",
      materiales: ["1x placa"],
      conexiones: ["A → B"],
      codigo: 'if (a < b && c > d) { Serial.println("<hola>"); }',
    },
    { directory: OUT },
  )
  const html = readFileSync(join(OUT, "hoja-test-escape.html"), "utf8")
  assert.match(html, /a &lt; b &amp;&amp; c &gt; d/, "los < > & del código quedan escapados")
  assert.doesNotMatch(html, /<hola>/, "no debe aparecer el tag crudo del string del código")
})
