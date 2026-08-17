// Identificar qué hay del otro lado del cable (opencode/tool/platformio.ts).
//
// POR QUÉ EXISTE ESTE ARCHIVO. En el aula el problema casi nunca es la placa:
// es que Windows no trae el driver del CH340 —el chip USB-serial de los clones
// baratos— y sin driver no aparece ningún puerto. "No encuentro tu Arduino" no
// ayuda a nadie; "es un CH340 y le falta el driver, bajalo de acá" sí.
//
// Y hay un falso positivo peor: `pio device list` devuelve TODOS los puertos
// serie. En una máquina virtual aparece un COM1 emulado (ACPI\PNP0501) que no es
// nada, y el diagnóstico lo contaba como dispositivo conectado. Verificado en la
// VM de desarrollo: ese COM1 estaba ahí, sin ninguna placa enchufada.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-placas-test")

let identificar

before(async () => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/platformio.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "platformio.ts"), src)
  identificar = (await import(join(OUT, "platformio.ts"))).identificar
})

test("el COM1 de una máquina virtual NO es una placa", () => {
  // hwid real, copiado de la VM de desarrollo con nada enchufado.
  const r = identificar("ACPI\\PNP0501\\1", "Puerto de comunicaciones (COM1)")
  assert.equal(r.esPlaca, false)
  assert.match(r.motivo, /de la propia máquina/i)
})

test("reconoce el CH340 y sabe qué driver falta", () => {
  const r = identificar("USB VID:PID=1A86:7523 LOCATION=1-1")
  assert.equal(r.esPlaca, true)
  assert.match(r.chip, /CH340/)
  assert.match(r.driverWindows, /wch-ic\.com/)
})

test("reconoce el CP2102 de los ESP32 DevKit", () => {
  const r = identificar("USB VID:PID=10C4:EA60 SER=0001")
  assert.equal(r.esPlaca, true)
  assert.match(r.chip, /CP2102/)
  assert.match(r.driverWindows, /silabs\.com/)
})

test("reconoce un Arduino oficial, que no necesita driver", () => {
  const r = identificar("USB VID:PID=2341:0043 SER=85736323833351F0E1D1")
  assert.equal(r.esPlaca, true)
  assert.match(r.placa, /Arduino oficial/)
  assert.equal(r.driverWindows, undefined)
})

test("acepta el formato de Windows (VID_ con guión bajo)", () => {
  // PlatformIO devuelve "VID:PID=" en Linux y "VID_....&PID_" en Windows.
  const r = identificar("USB\\VID_1A86&PID_7523\\5&1D2A3B4C&0&2")
  assert.equal(r.esPlaca, true)
  assert.match(r.chip, /CH340/)
})

test("un USB desconocido se acepta igual, sin inventar qué placa es", () => {
  const r = identificar("USB VID:PID=DEAD:BEEF", "Algo raro")
  assert.equal(r.esPlaca, true)
  assert.match(r.chip, /DEAD:BEEF/)
  assert.doesNotMatch(r.placa, /Arduino|ESP32/)
})

test("sin hwid no adivina que es una placa", () => {
  assert.equal(identificar(undefined).esPlaca, false)
  assert.equal(identificar("").esPlaca, false)
  assert.equal(identificar("algo sin identificador usb").esPlaca, false)
})

test("el bluetooth serial tampoco es una placa", () => {
  const r = identificar("BTHENUM\\{00001101-0000-1000-8000-00805F9B34FB}")
  assert.equal(r.esPlaca, false)
})
