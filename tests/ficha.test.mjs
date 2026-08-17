// Smoke tests del tool `ficha` (opencode/tool/ficha.ts).
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).
//
// Se prueba `buscarFicha`, que es la parte que puede equivocarse: resolver lo
// que dijo el docente ("el LDR", "09", "potenciómetro") al archivo correcto.
// Abrir el PDF no se prueba acá — es una llamada al sistema operativo, y la
// misma que ya usan `imprimible` y `ayuda`.
//
// Mismo truco que memoria.test.mjs: se reescribe el import del plugin a un mock,
// así el módulo se puede importar sin instalar dependencias.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-ficha-test")

let buscarFicha

/** Los nombres reales de las 17 hojas que instala la capa. */
const HOJAS = [
  "01-arduino-uno.pdf",
  "02-sensor-shield.pdf",
  "03-led.pdf",
  "04-servo.pdf",
  "05-corriente-continua.pdf",
  "06-corriente-alterna.pdf",
  "07-entradas-y-salidas.pdf",
  "08-tester.pdf",
  "09-ldr.pdf",
  "10-potenciometro.pdf",
  "11-ultrasonico.pdf",
  "12-pir.pdf",
  "13-dht11.pdf",
  "14-rele.pdf",
  "15-zumbador.pdf",
  "16-tecnia-bot.pdf",
  "borrador-esp32-devkit.pdf",
]

before(async () => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/ficha.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "ficha.ts"), src)
  buscarFicha = (await import(join(OUT, "ficha.ts"))).buscarFicha
})

test("encuentra por número con cero adelante", () => {
  assert.equal(buscarFicha("09", HOJAS), "09-ldr.pdf")
})

test("encuentra por número sin cero adelante", () => {
  // El docente dice "la 9", no "la 09".
  assert.equal(buscarFicha("9", HOJAS), "09-ldr.pdf")
})

test("encuentra por nombre del componente", () => {
  assert.equal(buscarFicha("ldr", HOJAS), "09-ldr.pdf")
  assert.equal(buscarFicha("servo", HOJAS), "04-servo.pdf")
  assert.equal(buscarFicha("zumbador", HOJAS), "15-zumbador.pdf")
})

test("aguanta las tildes, que el docente sí escribe", () => {
  assert.equal(buscarFicha("potenciómetro", HOJAS), "10-potenciometro.pdf")
  assert.equal(buscarFicha("ultrasónico", HOJAS), "11-ultrasonico.pdf")
})

test("no le importan las mayúsculas ni los espacios de más", () => {
  assert.equal(buscarFicha("  LDR  ", HOJAS), "09-ldr.pdf")
  assert.equal(buscarFicha("PIR", HOJAS), "12-pir.pdf")
})

test("acepta el nombre del archivo entero", () => {
  assert.equal(buscarFicha("09-ldr.pdf", HOJAS), "09-ldr.pdf")
  assert.equal(buscarFicha("09-ldr", HOJAS), "09-ldr.pdf")
})

test("con varios candidatos gana el más corto", () => {
  // "corriente" está en dos. Que devuelva UNA es mejor que devolver nada:
  // el agente ve cuál abrió y puede corregir. Alterna es la más corta.
  assert.equal(buscarFicha("corriente", HOJAS), "06-corriente-alterna.pdf")
  // Y con el nombre completo no hay ambigüedad.
  assert.equal(buscarFicha("corriente-continua", HOJAS), "05-corriente-continua.pdf")
})

test("devuelve null si no existe, en vez de inventar una", () => {
  assert.equal(buscarFicha("transistor", HOJAS), null)
  assert.equal(buscarFicha("99", HOJAS), null)
  assert.equal(buscarFicha("", HOJAS), null)
})

test("encuentra la del ESP32, que no tiene número", () => {
  assert.equal(buscarFicha("esp32", HOJAS), "borrador-esp32-devkit.pdf")
})

test("la descripción del tool le prohíbe pegar la ruta", async () => {
  // El defecto que originó este tool: el agente pegaba la ruta del PDF y le
  // pedía al docente que navegara hasta .config\opencode\skills\fichas\hojas\.
  // Si esta instrucción se cae de la descripción, el defecto vuelve.
  const mod = (await import(join(OUT, "ficha.ts"))).default
  assert.match(mod.description, /no le pegues la ruta/i)
  assert.match(mod.description, /ABRE/)
})
