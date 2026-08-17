// Los mensajes que un docente pega en el chat tienen que estar reconocidos.
//
// POR QUÉ ESTE ARCHIVO. `traducirError()` traducía bien los errores de
// COMPILACIÓN, pero no los tres que el ESP32 escupe por el monitor serial
// DESPUÉS de cargar, cuando el programa ya corre. Ninguno de los tres estaba:
// el bot recibía el texto crudo y tenía que improvisar.
//
// El del brownout es el más importante: es lo que aparece la primera vez que
// alguien le conecta un servo a la placa — semana dos o tres de cualquier curso.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-errores-test")
const src = readFileSync(join(REPO, "opencode/tool/platformio.ts"), "utf8")

/** Los patrones viven dentro de `traducirError`, que no está exportada. */
function reconoce(texto) {
  // Extraemos los regex literales del array de patrones y los probamos.
  const bloque = src.match(/const patrones[\s\S]*?\n  \]/)
  assert.ok(bloque, "no encontré el array de patrones en platformio.ts")
  const regexes = [...bloque[0].matchAll(/^\s*\/(.+?)\/([gimsu]*),\s*$/gm)].map(
    (m) => new RegExp(m[1], m[2]),
  )
  return regexes.some((r) => r.test(texto))
}

test("reconoce el brownout — el que aparece al conectar un servo", () => {
  assert.ok(reconoce("Brownout detector was triggered"), "el brownout no está reconocido")
})

test("reconoce el bootloop del ESP32", () => {
  assert.ok(
    reconoce("rst:0x10 (RTCWDT_RTC_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)"),
    "el rst:0x/boot: no está reconocido",
  )
})

test("reconoce el Guru Meditation Error", () => {
  assert.ok(
    reconoce("Guru Meditation Error: Core  1 panic'ed (LoadProhibited)"),
    "el Guru Meditation no está reconocido",
  )
})

test("sigue reconociendo los errores de compilación de siempre", () => {
  // Que agregar los nuevos no haya roto los viejos.
  assert.ok(reconoce("error: 'foo' was not declared in this scope"))
  assert.ok(reconoce("fatal error: DHT.h: No such file or directory"))
  assert.ok(reconoce("Failed to connect to ESP32: Timed out waiting for packet header"))
})

test("el mensaje del brownout habla de corriente, no de código", () => {
  // El docente tiene que salir sabiendo que NO es su programa.
  const i = src.indexOf("Brownout detector")
  const mensaje = src.slice(i, i + 700)
  assert.match(mensaje, /corriente|tension|tensión/i)
  assert.match(mensaje, /No es un problema del codigo|no es.*codigo/i)
  assert.match(mensaje, /BLOQUEO/i, "tiene que mandar a calcular con el consumo de bloqueo")
})
