// Las notas del release de GitHub tienen que salir del CHANGELOG, no vacías.
//
// POR QUÉ EXISTE. `gh api .../releases/tags/v0.4.1 --jq '.body'` da 0
// caracteres — en TODOS los releases publicados, verificado contra 0.4.1,
// 0.4.0 y 0.3.79. `scripts/notas-release.mjs` es el guardián que evita que
// vuelva a pasar. Pero un guardián que sólo se prueba con el CHANGELOG bien
// portado no prueba nada: si mañana alguien borra una sección a mano, este
// test tiene que ser el que lo note ANTES que un release salga mudo de nuevo.
// Por eso el primer bloque muta un CHANGELOG sintético y comprueba que el
// script CORTA — no sólo que extrae bien lo que ya está bien.

import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

import { etiquetas, extraer, leerVersionPorDefecto, RUTA_CHANGELOG } from "../scripts/notas-release.mjs"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const SCRIPT = join(REPO, "scripts", "notas-release.mjs")

// Nombre propio: `seguridad-proyectos.test.mjs` ya avisa que "tecniabot-test-work"
// está tomado por `circuito.test.mjs`; acá el nombre es otro para no chocar con
// ninguno de los dos.
const TMP = join(os.tmpdir(), `tecniabot-notas-release-${process.pid}`)

const CHANGELOG_SINTETICO = `# Changelog

## [Unreleased]

- algo que todavía no salió, esto NUNCA tiene que aparecer en una extracción

## [0.4.2] — 2026-09-22

### Agregado
- las notas de release ahora viajan al .exe

## [0.4.1] — 2026-09-15

### Agregado
- el Sensor Shield se dibuja en la hoja

## [0.4.0] — 2026-09-14

### Agregado
- Arduino UNO
`

test("extrae la sección del medio: ni la de Unreleased arriba ni la de abajo", () => {
  const cuerpo = extraer(CHANGELOG_SINTETICO, "0.4.1")
  assert.match(cuerpo, /el Sensor Shield se dibuja en la hoja/)
  assert.doesNotMatch(cuerpo, /todavía no salió/, "se llevó puesto el Unreleased")
  assert.doesNotMatch(cuerpo, /Arduino UNO/, "se llevó puesto la sección de abajo (0.4.0)")
  assert.doesNotMatch(cuerpo, /las notas de release ahora viajan/, "se llevó puesto la sección de arriba (0.4.2)")
})

test("el cuerpo NO incluye el encabezado de su propia sección", () => {
  const cuerpo = extraer(CHANGELOG_SINTETICO, "0.4.1")
  assert.doesNotMatch(cuerpo, /## \[0\.4\.1\]/, "GitHub ya pone el título del release; repetirlo es ruido")
})

test("etiquetas() lista las secciones en orden, Unreleased incluido", () => {
  assert.deepEqual(etiquetas(CHANGELOG_SINTETICO), ["Unreleased", "0.4.2", "0.4.1", "0.4.0"])
})

test("una versión que no tiene sección: tira, y el mensaje nombra QUÉ buscaba y QUÉ encontró", () => {
  assert.throws(
    () => extraer(CHANGELOG_SINTETICO, "9.9.9"),
    (err) => {
      assert.match(err.message, /9\.9\.9/, "el mensaje tiene que nombrar la versión que buscaba")
      assert.match(err.message, /0\.4\.2/, "el mensaje tiene que nombrar lo que sí encontró")
      assert.doesNotMatch(err.message, /Unreleased/, "Unreleased no es una versión publicada, no cuenta como 'encontrada'")
      return true
    },
  )
})

test("un CHANGELOG sin ninguna sección de versión: el mensaje lo dice, no revienta con otra cosa", () => {
  assert.throws(() => extraer("# Changelog\n\n## [Unreleased]\n\nnada todavía\n", "0.1.0"), /\(ninguna\)/)
})

test("extraer() funciona sobre un CHANGELOG leído de disco, no sólo de un string en memoria", () => {
  // El script real siempre lee de disco (RUTA_CHANGELOG); este test cierra el
  // hueco entre "extraer() anda con un string" y "anda con lo que devuelve
  // readFileSync", que no son necesariamente lo mismo (encoding, BOM, etc).
  mkdirSync(TMP, { recursive: true })
  const changelog = join(TMP, "CHANGELOG.md")
  writeFileSync(changelog, CHANGELOG_SINTETICO)
  try {
    const cuerpo = extraer(readFileSync(changelog, "utf8"), "0.4.2")
    assert.match(cuerpo, /las notas de release ahora viajan al \.exe/)
  } finally {
    rmSync(TMP, { recursive: true, force: true })
  }
})

test("la CLI real: --version 9.9.9 sale con exit 1 y un mensaje claro (no silencioso)", () => {
  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT, "--version", "9.9.9"], { encoding: "utf8", stdio: "pipe" }),
    (err) => {
      assert.equal(err.status, 1, "tiene que salir con código de error, no con 0")
      assert.match(err.stderr, /9\.9\.9/, "stderr tiene que decir qué versión buscaba")
      return true
    },
  )
})

test("la CLI real: --salida escribe el archivo en vez de stdout", () => {
  const dir = mkdtempSync(join(os.tmpdir(), "tecniabot-notas-release-salida-"))
  const destino = join(dir, "notas.md")
  try {
    const version = leerVersionPorDefecto()
    const salida = execFileSync(process.execPath, [SCRIPT, "--salida", destino], { encoding: "utf8" })
    assert.match(salida, new RegExp(`notas de ${version.replace(/\./g, "\\.")} escritas en`))
    const escrito = readFileSync(destino, "utf8")
    assert.ok(escrito.trim().length > 0, "el archivo escrito no puede estar vacío")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("contra el CHANGELOG real: la versión de VERSION tiene sección y el cuerpo no está vacío", () => {
  const version = leerVersionPorDefecto()
  const changelogReal = readFileSync(RUTA_CHANGELOG, "utf8")
  const cuerpo = extraer(changelogReal, version)
  assert.ok(cuerpo.length > 0, `la sección de ${version} en el CHANGELOG real no puede extraerse vacía`)
})

test("contra el CHANGELOG real: --version 0.4.1 también tiene sección (mencionado en el pedido)", () => {
  // OJO: en `main` puede que VERSION todavía diga 0.4.1 (la entrada [0.4.2] vive
  // en la PR #34, sin mergear). Este test prueba 0.4.1 explícitamente para que
  // no dependa de en qué estado esté esa PR.
  const changelogReal = readFileSync(RUTA_CHANGELOG, "utf8")
  const cuerpo = extraer(changelogReal, "0.4.1")
  assert.ok(cuerpo.length > 0)
})
