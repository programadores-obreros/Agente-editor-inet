// Los mensajes que un docente pega en el chat tienen que estar traducidos.
//
// POR QUÉ ESTE ARCHIVO. `traducirError()` traducía bien los errores de
// COMPILACIÓN, pero no los tres que el ESP32 escupe por el monitor serial
// DESPUÉS de cargar, cuando el programa ya corre. El del brownout es el más
// importante: aparece la primera vez que alguien conecta un servo.
//
// ── POR QUÉ ESTE ARCHIVO SE REESCRIBIÓ ────────────────────────────────────
//
// La primera versión hacía regex-scraping sobre el TEXTO FUENTE de
// platformio.ts y probaba los literales que extraía. El QA la mató con una
// mutación de una línea: vació el loop de despacho —la función deja de traducir
// absolutamente todo— y los cinco tests pasaron igual.
//
// Un test que pasa con y sin el arreglo no prueba nada. Ahora se llama a
// `traducirError` de verdad y se mira lo que devuelve.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-errores-test")

let traducirError

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
  traducirError = (await import(join(OUT, "platformio.ts"))).traducirError
})

/** Lo que devuelve cuando NO reconoce nada, para poder distinguirlo. */
const SIN_TRADUCIR = () => traducirError("qwerty zxcvb no soy un error conocido", "")

test("el brownout se traduce, y habla de corriente y no de código", () => {
  const r = traducirError("E (204) esp_core_dump_flash: Brownout detector was triggered", "")
  assert.notEqual(r, SIN_TRADUCIR(), "el brownout no se reconoció")
  assert.match(r, /corriente|tension|tensión/i)
  assert.match(r, /no es un problema del codigo|no es.*c[oó]digo/i)
  assert.match(r, /BLOQUEO/i, "tiene que mandar a calcular con el consumo de bloqueo")
})

test("el bootloop se traduce y menciona los pines de arranque", () => {
  const r = traducirError("rst:0x10 (RTCWDT_RTC_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)", "")
  assert.notEqual(r, SIN_TRADUCIR(), "el rst:0x/boot: no se reconoció")
  assert.match(r, /GPIO0|GPIO2|GPIO12|GPIO15/)
})

test("el Guru Meditation se traduce y aclara que no es de compilación", () => {
  const r = traducirError("Guru Meditation Error: Core  1 panic'ed (LoadProhibited)", "")
  assert.notEqual(r, SIN_TRADUCIR(), "el Guru Meditation no se reconoció")
  assert.match(r, /no es un error de compilacion|mientras corr/i)
})

test("los errores de compilación de siempre siguen traduciéndose", () => {
  for (const [entrada, señal] of [
    ["error: 'foo' was not declared in this scope", /declar/i],
    ["fatal error: DHT.h: No such file or directory", /lib_deps|librer/i],
    ["Failed to connect to ESP32: Timed out waiting for packet header", /BOOT/],
    ["Permission denied: '/dev/ttyUSB0'", /grupo|usermod/i],
  ]) {
    const r = traducirError(entrada, "")
    assert.notEqual(r, SIN_TRADUCIR(), `dejó de reconocer: ${entrada}`)
    assert.match(r, señal)
  }
})

test("lo que NO es un error conocido no se inventa una traducción", () => {
  const r = SIN_TRADUCIR()
  assert.doesNotMatch(r, /brownout|corriente/i)
})

test("el brownout le gana al rst cuando aparecen juntos", () => {
  // La placa que se apaga por falta de corriente imprime los dos. El mensaje
  // útil es el del brownout: dice la causa, no el síntoma.
  const juntos = "Brownout detector was triggered\nrst:0x10 (RTCWDT_RTC_RESET),boot:0x13"
  assert.match(traducirError(juntos, ""), /corriente/i)
})

test("el error de «no hay proyecto» se traduce, con el error REAL de PlatformIO", () => {
  // Copiado literal de lo que devolvió `pio run` en una carpeta vacía de la VM
  // de desarrollo. Es el primero que se choca cualquiera: PlatformIO no compila
  // un archivo suelto, y hasta ahora el docente veía este texto en inglés.
  const real =
    "NotPlatformIOProjectError: Not a PlatformIO project. `platformio.ini` file has not been " +
    "found in current working directory (C:\\Users\\win-vm\\AppData\\Local\\Temp\\proyecto-vacio). " +
    "To initialize new project please use `platformio project init` command"
  const r = traducirError(real, "")
  assert.notEqual(r, SIN_TRADUCIR(), "no reconoció el error de proyecto faltante")
  assert.match(r, /platformio\.ini/)
  assert.match(r, /src\/main\.cpp/)
  assert.match(r, /board = uno|board = esp32dev/, "tiene que decir que el ini cambia por placa")
})

test("el prompt le dice al agente que arme el proyecto antes de compilar", () => {
  // Sin esto, la regla de "compilá siempre" manda al bot contra este error en
  // cada pedido de código en una carpeta nueva.
  const prompt = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
  assert.match(prompt, /antes de compilar tiene que HABER un proyecto/i)
  assert.match(prompt, /board = uno/)
  assert.match(prompt, /board = esp32dev/)
  assert.match(prompt, /src\/main\.cpp/)
  // Y que sepa que necesita saber la placa para elegir el board.
  assert.match(prompt, /NECESIT[ÁA]S SABER QU[ÉE] PLACA/i)
})
