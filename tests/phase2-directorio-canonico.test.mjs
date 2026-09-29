// Phase 2, Slice 1 — fix de ronda única red-team, Hallazgo H1 (CRITICAL,
// P2-RED-A/INFORME.md, ataque 1), mitad (a): `servicio-con-vista.ts` (servidor, SÍ
// puede usar `node:fs`/`node:path`, no es núcleo) canonicaliza el directorio ANTES de
// llamar a `composicion-raiz.ts`: `fs.mkdirSync(dir, {recursive:true})` +
// `fs.realpathSync(path.resolve(dir))`. Cuatro representaciones del MISMO directorio
// real — `dir`, `dir//`, una ruta relativa, y un symlink al mismo directorio — tienen
// que dar el MISMO servicio (`===`), no cuatro motores distintos compitiendo por el
// mismo `<id>.json` (ataque 1 de P2-RED-A, casos A/B/C).

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, op } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))

test("H1(a): 'dir' y 'dir//' (doble barra final) dan el MISMO servicio", () => {
  const dir = nuevoDir("h1a-doble-barra")
  const id = nuevoIdProyecto()
  const a = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })
  const b = obtenerServicioDeProyectoConVista({ directorio: dir + "//", idProyecto: id })
  assert.equal(a, b, "misma referencia — un solo motor, no dos compitiendo por el mismo <id>.json")
  a.cerrar()
})

test("H1(a): ruta relativa vs absoluta al MISMO directorio real dan el MISMO servicio", () => {
  const base = nuevoDir("h1a-base-relativa")
  const cwdAntes = process.cwd()
  try {
    process.chdir(base)
    const abs = base
    const rel = "."
    const id = nuevoIdProyecto()
    const a = obtenerServicioDeProyectoConVista({ directorio: abs, idProyecto: id })
    const b = obtenerServicioDeProyectoConVista({ directorio: rel, idProyecto: id })
    assert.equal(a, b, "misma referencia — resuelto contra el MISMO cwd en el momento de la llamada")
    a.cerrar()
  } finally {
    process.chdir(cwdAntes)
  }
})

test("H1(a): un symlink al mismo directorio da el MISMO servicio (realpathSync resuelve el symlink)", () => {
  const base = nuevoDir("h1a-symlink-base")
  const real = join(base, "real")
  const link = join(base, "link")
  mkdirSync(real, { recursive: true })
  symlinkSync(real, link, "dir")

  const id = nuevoIdProyecto()
  const a = obtenerServicioDeProyectoConVista({ directorio: real, idProyecto: id })
  const b = obtenerServicioDeProyectoConVista({ directorio: link, idProyecto: id })
  assert.equal(a, b, "misma referencia — el symlink resuelve al mismo directorio real")
  a.cerrar()
})

test("H1(a): las cuatro variantes comparten el mismo motor en memoria — una operacion de una la ve la otra sin releer disco", () => {
  const dir = nuevoDir("h1a-visibilidad")
  const id = nuevoIdProyecto()
  const a = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })
  const b = obtenerServicioDeProyectoConVista({ directorio: dir + "/", idProyecto: id })
  assert.equal(a, b)

  const n = a.snapshot().revision
  const r = a.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, n))
  assert.equal(r.ok, true)
  assert.equal(b.snapshot().revision, n + 1)
  assert.equal(b.snapshot().proyecto.placa, "esp32-devkit-v1")
  a.cerrar()
})

test("H1(a): el directorio se crea solo si hace falta (mkdirSync recursive) — no hace falta que exista de antemano", () => {
  const base = nuevoDir("h1a-crear-solo")
  const subdirInexistente = join(base, "no-existe-todavia", "anidado")
  const servicio = obtenerServicioDeProyectoConVista({ directorio: subdirInexistente, idProyecto: nuevoIdProyecto() })
  assert.equal(typeof servicio.snapshot, "function")
  servicio.cerrar()
})
