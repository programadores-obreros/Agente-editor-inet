// La versión se dice en varios lugares, y todos tienen que decir lo mismo.
//
// POR QUÉ EXISTE ESTE ARCHIVO. En agosto de 2026 había CUATRO fuentes y TRES
// mentían: `VERSION` decía 0.3.39 (la buena, la que usa el workflow), pero
// `package.json` decía 0.2.0 —treinta y siete versiones atrás—, el README
// anunciaba la 0.3.32, y el instalador tenía un valor por defecto de 0.3.32 que
// se usaba si alguien compilaba a mano.
//
// Ninguna de las tres rompía el build: el workflow siempre pasa `/DMyAppVersion`
// leyendo `VERSION`. Por eso nadie se dio cuenta durante siete versiones. Un
// defecto que no rompe nada no se arregla solo — hay que ir a buscarlo.
//
// LA FUENTE DE VERDAD ES EL ARCHIVO `VERSION`, porque es la que lee el workflow
// que produce el .exe que instala el docente. Todo lo demás la copia, y este
// test verifica que la copia no se haya quedado vieja.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (...p) => readFileSync(join(REPO, ...p), "utf8")

const VERSION = leer("VERSION").trim()

test("VERSION tiene forma de versión semántica", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/, `VERSION dice "${VERSION}"`)
})

test("package.json dice la misma versión que VERSION", () => {
  const pkg = JSON.parse(leer("package.json"))
  assert.equal(
    pkg.version,
    VERSION,
    `package.json dice ${pkg.version} y VERSION dice ${VERSION}. ` +
      `Sincronizalos: la fuente es VERSION, que es la que lee build-installer.yml.`,
  )
})

test("el README anuncia la versión que corresponde", () => {
  // El anuncio principal, con el cohete. Otras menciones históricas son válidas.
  const readme = leer("README.md")
  const m = readme.match(/🚀\s*\*\*v(\d+\.\d+\.\d+)/)
  assert.ok(m, "no encontré el anuncio de versión en el README (🚀 **vX.Y.Z**)")
  assert.equal(
    m[1],
    VERSION,
    `el README anuncia v${m[1]} y VERSION dice ${VERSION}`,
  )
})

test("el instalador NO trae una versión por defecto", () => {
  // Un default se queda viejo en silencio y produce un .exe que miente su
  // versión. Preferimos que ISCC falle pidiendo /DMyAppVersion.
  const iss = leer("installer", "tecnia-bot.iss")
  const conDefault = iss.match(/#define\s+MyAppVersion\s+"[^"]+"/)
  assert.equal(
    conDefault,
    null,
    `installer/tecnia-bot.iss define MyAppVersion con un valor fijo (${conDefault?.[0]}). ` +
      `Tiene que venir por /DMyAppVersion desde VERSION.`,
  )
  assert.match(
    iss,
    /#ifndef\s+MyAppVersion\s*\r?\n\s*#error/,
    "el .iss tiene que fallar con #error si no le pasan /DMyAppVersion",
  )
})

test("el workflow lee la versión de VERSION, no de otro lado", () => {
  const wf = leer(".github", "workflows", "build-installer.yml")
  assert.match(
    wf,
    /Get-Content\s+VERSION/,
    "build-installer.yml tiene que leer el archivo VERSION",
  )
  assert.match(
    wf,
    /\/DMyAppVersion=/,
    "build-installer.yml tiene que pasarle la versión al ISCC",
  )
})
