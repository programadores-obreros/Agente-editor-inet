// Test de CONVERGENCIA de pinouts: pinouts.json es la fuente canónica de verdad
// (derivada del .ino). Este test falla si algún consumidor (la plantilla del
// circuito, el skill) usa pines DISTINTOS al canónico → el drift se caza solo.
// Piloto: el semáforo (01-semaforizacion). Al replicar a los 15, se agregan casos.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const pinouts = JSON.parse(readFileSync(join(REPO, "opencode/tecniabot-web/pinouts.json"), "utf8"))

// Números de GPIO de los pines de señal de un proyecto+placa+nivel ("GPIO16" -> "16").
function gpiosSenal(slug, placa, nivel) {
  return pinouts[slug][placa][nivel]
    .filter((p) => p.tipo === "senal")
    .map((p) => p.pin.replace(/[^0-9]/g, ""))
}

test("pinouts.json: el semáforo ESP32 tiene la verdad del .ino (16/17/18)", () => {
  const g = gpiosSenal("01-semaforizacion", "esp32", "inicial").sort()
  assert.deepEqual(g, ["16", "17", "18"], "verde/amarillo/rojo = GPIO16/17/18")
})

test("convergencia: la plantilla del circuito usa los GPIO canónicos (no drift)", () => {
  const html = readFileSync(join(REPO, "opencode/tecniabot-web/plantilla-semaforo-protoboard.html"), "utf8")
  for (const n of gpiosSenal("01-semaforizacion", "esp32", "inicial")) {
    assert.match(html, new RegExp("GPIO\\s*" + n + "\\b"), `la plantilla debe usar GPIO${n} (canónico)`)
  }
  // Y NO debe volver a los pines viejos equivocados (drift al pasado).
  for (const viejo of ["19", "5", "4"]) {
    assert.doesNotMatch(html, new RegExp("GPIO\\s*" + viejo + "\\b"), `la plantilla NO debe tener GPIO${viejo} (pin viejo)`)
  }
})

test("convergencia: el skill proyectos-inet coincide con el canónico (tolera 'GPIO 16')", () => {
  const md = readFileSync(join(REPO, "opencode/skills/proyectos-inet/proyectos/01-semaforizacion.md"), "utf8")
  for (const n of gpiosSenal("01-semaforizacion", "esp32", "inicial")) {
    assert.match(md, new RegExp("GPIO\\s*" + n + "\\b"), `el skill debe mencionar GPIO${n}`)
  }
})
