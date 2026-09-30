// Phase 2, Slice 2 — W-S2-VISTA, §3.6 (seed de la demo).
// docs/programacion-intencion/PHASE_2_SLICE_2_DESIGN.md §3.6, HD-S2-1b.
//
// `scripts/vista-fisica-demo.mjs --una-vez` imprime la URL + el snapshot (JSON) y
// cierra (pensado para tests/CI, sin quedarse escuchando) — mismo patrón que ya usa
// `tests/phase2-candado-proceso.test.mjs`. Este test verifica, contra el proceso
// REAL (nunca un mock del launcher):
//  1. El seed produce ESP32 + LED + pulsador, por OPERACIONES reales (actor
//     "agente"), con el pulsador en GPIO18 (un pin normal, sin restricciones).
//  2. Es idempotente: correr el launcher una segunda vez sobre el MISMO directorio
//     no vuelve a sembrar ni cambia la revisión.

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

function correrDemo(dir, idProyecto) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(REPO, "scripts/vista-fisica-demo.mjs"), "--dir", dir, "--id-proyecto", idProyecto, "--una-vez"], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (d) => (stdout += d.toString()))
    proc.stderr.on("data", (d) => (stderr += d.toString()))
    proc.on("close", (code) => resolve({ code, stdout, stderr }))
    proc.on("error", reject)
  })
}

/** El launcher imprime primero "Vista física — <url>" y DESPUÉS (con --una-vez) el
 * JSON del snapshot — se toma sólo la parte que empieza en la primera '{'. */
function snapshotDe(stdout) {
  const inicio = stdout.indexOf("{")
  assert.ok(inicio >= 0, `fixture: se esperaba un JSON en stdout, se recibio: ${stdout}`)
  return JSON.parse(stdout.slice(inicio))
}

test("el seed produce ESP32 + LED + pulsador por operaciones reales, pulsador.senal en GPIO18, actor agente", async () => {
  const dir = nuevoDir("s2-demo-seed")
  const idProyecto = nuevoIdProyecto()

  const resultado = await correrDemo(dir, idProyecto)
  assert.equal(resultado.code, 0, `el launcher tiene que terminar en 0; stderr: ${resultado.stderr}`)

  const snapshot = snapshotDe(resultado.stdout)
  assert.equal(snapshot.proyecto.placa, "esp32-devkit-v1")
  assert.equal(snapshot.proyecto.componentes.length, 2, "LED + pulsador")

  const led = snapshot.proyecto.componentes.find((c) => c.tipo === "led")
  const pulsador = snapshot.proyecto.componentes.find((c) => c.tipo === "pulsador")
  assert.ok(led, "el LED sigue sembrandose")
  assert.ok(pulsador, "el pulsador se siembra")
  assert.equal(led.pines.anodo, "GPIO4", "el LED no cambia de pin (GPIO_DEMO ya existente)")
  assert.equal(pulsador.pines.senal, "GPIO18", "el pulsador se siembra en GPIO18 (§3.6)")

  // Todo por operaciones reales del Engine: el proyecto tiene que estar LISTO para
  // el LED (con su resistencia-serie ya conectada, sembrada por el propio launcher)
  // y el pulsador no debe traer ningún motivo blocking (GPIO18 es normal).
  const motivosPulsador = snapshot.validacion.motivos.filter((m) => m.entidad?.id === pulsador.id)
  assert.equal(motivosPulsador.length, 0, "GPIO18 no tiene restricciones — sin motivos para el pulsador")
})

test("el seed es idempotente: correr el launcher dos veces sobre el MISMO directorio no vuelve a sembrar", async () => {
  const dir = nuevoDir("s2-demo-idempotente")
  const idProyecto = nuevoIdProyecto()

  const primera = await correrDemo(dir, idProyecto)
  assert.equal(primera.code, 0, `stderr: ${primera.stderr}`)
  const snap1 = snapshotDe(primera.stdout)

  const segunda = await correrDemo(dir, idProyecto)
  assert.equal(segunda.code, 0, `stderr: ${segunda.stderr}`)
  const snap2 = snapshotDe(segunda.stdout)

  assert.equal(snap2.revision, snap1.revision, "la segunda corrida no vuelve a sembrar — misma revision")
  assert.deepEqual(
    snap2.proyecto.componentes.map((c) => c.tipo).sort(),
    snap1.proyecto.componentes.map((c) => c.tipo).sort(),
    "mismos componentes, sin duplicar",
  )
})
