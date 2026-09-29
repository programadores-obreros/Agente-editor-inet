// Phase 2, Slice 1 — fix de ronda única red-team, Hallazgo H1 (CRITICAL,
// P2-RED-A/INFORME.md, ataque 1), mitad (b): `composicion-raiz.ts` (núcleo, SIN
// `node:` por la guardia 29b, `tests/nucleo-adversarial.test.mjs`) no puede resolver
// rutas por su cuenta — así que en vez de intentarlo, RECHAZA con un error explícito
// cualquier `directorio` que no sea ya una ruta absoluta. El llamador
// (`opencode/servidor/servicio-con-vista.ts`, mitad (a) de este mismo fix,
// tests/phase2-directorio-canonico.test.mjs) es quien canonicaliza (mkdir + realpath)
// ANTES de llamar acá — esta guardia se queda con la forma más simple posible: "no es
// absoluta" se detecta ANTES de tocar el filesystem (nunca llega a `crearAlmacen`).
//
// El chequeo de forma Windows (`X:\`, `X:/`, `\\\\`) se documenta en el propio código
// pero NO se ejercita acá contra el filesystem real: este repo corre sus tests sólo
// en Linux (`tests/nucleo-*.test.mjs`/CI), y forzar una ruta con esa forma completa
// hasta `crearAlmacen`/`mkdirSync` en un runner Linux crearía un directorio real con
// ese nombre literal (backslashes son caracteres válidos de archivo en Linux) — un
// efecto secundario sucio para un test, no una prueba real de Windows. Mismo estado
// que el resto del slice: `WINDOWS_UNVERIFIED` (PHASE_2_SLICE_1_DESIGN.md §2.9).

import { test } from "node:test"
import assert from "node:assert/strict"
import { obtenerServicioDeProyecto, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

function assertRutaNoAbsoluta(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /ruta absoluta/i)
    return true
  })
}

test("H1(b): una ruta relativa directo a la raiz da error explicito ANTES de tocar el filesystem (nunca resuelve contra process.cwd())", () => {
  assertRutaNoAbsoluta(() => obtenerServicioDeProyecto({ directorio: "relativo/subcarpeta", idProyecto: nuevoIdProyecto() }))
  assertRutaNoAbsoluta(() => obtenerServicioDeProyecto({ directorio: ".", idProyecto: nuevoIdProyecto() }))
  assertRutaNoAbsoluta(() => obtenerServicioDeProyecto({ directorio: "./x", idProyecto: nuevoIdProyecto() }))
  assertRutaNoAbsoluta(() => obtenerServicioDeProyecto({ directorio: "", idProyecto: nuevoIdProyecto() }))
})

test("H1(b): una ruta POSIX absoluta real SI pasa la guardia de forma (el error, si lo hay, es otro — nunca 'ruta absoluta')", () => {
  const dir = nuevoDir("h1b-absoluta-ok")
  const servicio = obtenerServicioDeProyecto({ directorio: dir, idProyecto: nuevoIdProyecto() })
  assert.equal(typeof servicio.snapshot, "function")
  servicio.cerrar()
})
