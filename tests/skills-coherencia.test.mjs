// Coherencia técnica entre skills (electrónica): invariantes que, si se rompen,
// le dan al docente una contradicción o un circuito que no arranca en el aula.
//
//  1. Ningún snippet ESP32 de un skill usa GPIO12 (MTDI: en HIGH al encender la
//     placa no bootea) ni GPIO15 (strapping) como pin de trabajo en arrays de
//     pines, `#define PIN_...` o `const int/byte ...`. Las EXPLICACIONES sobre
//     strapping viven en prosa/comentarios y no cuentan: solo se mira código.
//  2. El skill `sensores` usa UN solo GPIO para el DHT (tabla, #define y resumen).
//  3. Todo `#include <X.h>` de modulos-avanzados / sensores / actuadores tiene
//     su fila en la tabla de lib_deps de `librerias`, o es un header del core.
//  4. La advertencia del PIR en el tool `circuito` no dice que OUT sea de 5V:
//     el HC-SR501 trae regulador y su salida es lógica de 3.3V.
//
// Corre con: node --test tests/   (sin dependencias).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const SKILLS = join(REPO, "opencode/skills")
const leer = (p) => readFileSync(join(REPO, p), "utf8")

// Todos los .md bajo opencode/skills, menos `fichas/` (PDFs/manifest, otra unidad)
// y `arduino/` (skill UNO-only: ahí el pin 12 es un pin más y no es strapping).
function mdsDeSkills() {
  const out = []
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) {
        if (n === "fichas" || n === "arduino") continue
        walk(p)
      } else if (n.endsWith(".md")) out.push(p)
    }
  }
  walk(SKILLS)
  return out
}

// Bloques ```cpp / ```c / ```arduino / ```ino de un markdown.
function fencesDeCodigo(md) {
  const re = /```(?:cpp|c\+\+|c|arduino|ino)\s*\n([\s\S]*?)```/g
  const out = []
  let m
  while ((m = re.exec(md))) out.push(m[1])
  return out
}

// Un snippet es "UNO" si tiene marcas inequívocas de AVR; si no, se asume ESP32
// (todos los skills del ecosistema hablan ESP32 salvo que digan lo contrario).
const esSnippetUno = (code) => /Serial\.begin\(9600\)|#include <Servo\.h>/.test(code)

test("1. ningún snippet ESP32 de los skills usa GPIO12 ni GPIO15 como pin de trabajo", () => {
  const PROHIBIDOS = new Set(["12", "15"])
  const hallazgos = []
  for (const archivo of mdsDeSkills()) {
    const rel = relative(REPO, archivo)
    for (const code of fencesDeCodigo(readFileSync(archivo, "utf8"))) {
      if (esSnippetUno(code)) continue
      // Arrays de pines: { 13, 16, 14, 27 } (solo enteros y comas)
      for (const [, cuerpo] of code.matchAll(/\{\s*(\d+(?:\s*,\s*\d+)*)\s*\}/g)) {
        for (const n of cuerpo.split(",").map((s) => s.trim())) {
          if (PROHIBIDOS.has(n)) hallazgos.push(`${rel}: array de pines {${cuerpo}} usa GPIO${n}`)
        }
      }
      // #define PIN_X 12  |  const int X = 12;  |  const byte X = 15;
      for (const [linea, n] of code.matchAll(/^\s*(?:#define\s+PIN_\w+\s+|const\s+(?:int|byte)\s+\w+\s*=\s*)(\d+)\b.*$/gm)) {
        if (PROHIBIDOS.has(n)) hallazgos.push(`${rel}: ${linea.trim()}`)
      }
    }
  }
  assert.deepEqual(hallazgos, [], "GPIO12 (MTDI) y GPIO15 son strapping pins: no van como pin de trabajo en ESP32")
})

test("2. el skill sensores usa un único GPIO para el DHT (tabla, #define y resumen)", () => {
  const md = leer("opencode/skills/sensores/SKILL.md")
  const gpios = new Set()

  // Sección DHT: desde "## DHT11" hasta el próximo "## "
  const seccion = md.match(/^## DHT11[\s\S]*?(?=^## )/m)
  assert.ok(seccion, "el skill sensores tiene una sección '## DHT11 / DHT22'")
  for (const [, n] of seccion[0].matchAll(/GPIO(\d+)/g)) gpios.add(n)
  for (const [, n] of seccion[0].matchAll(/#define\s+PIN_DHT\s+(\d+)/g)) gpios.add(n)

  // Fila del resumen rápido
  const fila = md.match(/^\| DHT11\/22 \|.*$/m)
  assert.ok(fila, "el resumen rápido tiene la fila DHT11/22")
  for (const [, n] of fila[0].matchAll(/GPIO(\d+)/g)) gpios.add(n)

  assert.equal(gpios.size, 1, `el DHT debe usar UN solo GPIO en todo el skill; encontrados: ${[...gpios].join(", ")}`)
  assert.ok(!["12", "15"].includes([...gpios][0]), "y no puede ser un strapping pin")
})

test("3. todo #include de modulos-avanzados/sensores/actuadores tiene fila en librerias (o es core)", () => {
  // Headers del core / bundled del framework (no llevan lib_deps).
  const CORE = new Set(["Arduino.h", "Wire.h", "SPI.h", "EEPROM.h", "WiFi.h", "SoftwareSerial.h", "HTTPClient.h", "WebServer.h", "Preferences.h", "BluetoothSerial.h", "esp_sleep.h"])

  // Columna "Header" de la tabla de lib_deps: puede traer varios (`A.h` + `B.h`).
  const librerias = leer("opencode/skills/librerias/SKILL.md")
  const conFila = new Set()
  for (const linea of librerias.split("\n")) {
    if (!/^\|.*\|.*`[\w]+\.h`/.test(linea)) continue
    for (const [, h] of linea.matchAll(/`(\w+\.h)`/g)) conFila.add(h)
  }
  assert.ok(conFila.size >= 10, "la tabla de librerias se leyó (≥10 headers)")

  const faltan = []
  for (const skill of ["modulos-avanzados", "sensores", "actuadores"]) {
    const md = leer(`opencode/skills/${skill}/SKILL.md`)
    for (const [, h] of md.matchAll(/#include\s*<(\w+\.h)>/g)) {
      if (!CORE.has(h) && !conFila.has(h)) faltan.push(`${skill}: <${h}>`)
    }
  }
  assert.deepEqual(faltan, [], "cada header incluido en un skill necesita su lib_deps en librerias/SKILL.md")
})

test("4. la advertencia del PIR en circuito.ts no dice que OUT sea de 5V", () => {
  const src = leer("opencode/tool/circuito.ts")
  const bloque = src.match(/^\s*pir:\s*\{[\s\S]*?advertencia:\s*"([^"]*)"/m)
  assert.ok(bloque, "la biblioteca de piezas tiene un componente `pir` con advertencia")
  const adv = bloque[1]
  assert.doesNotMatch(adv, /(dan|da|entrega|salida de)\s+5\s?V\s+en\s+(la\s+salida|OUT)/i, "el HC-SR501 tiene regulador: OUT es de 3.3V, no de 5V")
  assert.doesNotMatch(adv, /divisor de tensión como el HC-SR04/i, "no manda a poner divisor donde no hace falta")
  assert.match(adv, /OUT\s*=\s*3\.3\s?V/i, "dice explícitamente que OUT es 3.3V")
})
