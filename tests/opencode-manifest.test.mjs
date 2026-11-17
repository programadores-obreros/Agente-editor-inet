// El manifest de OpenCode viaja ADENTRO del instalador, y el bootstrap instala desde ahí.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El 2026-11-17, en un aula y con los docentes delante, el
// instalador de la 0.4.9 dejó de poder instalar OpenCode en TODAS las máquinas nuevas:
//
//     https://registry.npmjs.org/@opencode/cli-windows-x64/-/cli-windows-x64-1.18.18.tgz
//     Error en el servidor remoto: (404) No se encontró.
//     Could not install: opencode@1.18.18
//
// No había cambiado una línea del repo. `scoop install opencode@1.18.18` no busca la
// versión vieja en ningún lado: toma el manifest ACTUAL del bucket 'main' y le regenera
// la URL con su plantilla `autoupdate`. El 2026-11-11 el bucket pasó a OpenCode 2.x y
// cambió la plantilla a npm, donde no hay ninguna 1.x.
//
// Y LOS TESTS ESTABAN VERDES. `opencode-version.test.mjs` exigía que el comando tuviera
// la forma `opencode@$OpenCodeVersion`: custodiaba cómo se pedía la versión, no de dónde
// salía. La dependencia que se rompió —la plantilla de un repo ajeno— no estaba en
// ningún archivo de éste, así que ningún test de texto podía verla.
//
// Lo que se custodia acá es que esa dependencia no vuelva: la URL y el hash están
// escritos en `install/scoop/opencode.json`, sin plantilla, y el bootstrap no instala
// OpenCode por ningún otro camino.
//
// LO QUE ESTE ARCHIVO NO PRUEBA, y hay que decirlo: que Scoop instale bien desde una
// ruta local en una máquina real. Eso se ve en la VM win10 con el .exe, no acá.
//
// Corre con: node --test tests/*.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (...p) => readFileSync(join(REPO, ...p), "utf8")

/** Sin comentarios: el bootstrap cita los comandos viejos para explicar por qué se fueron. */
const sinComentarios = (txt) => txt.replace(/^\s*#.*$/gm, "")

const RUTA = ["install", "scoop", "opencode.json"]
const pin = leer("install", "OPENCODE_VERSION").trim()
const crudo = leer(...RUTA)
const manifest = JSON.parse(crudo)
const ps1 = sinComentarios(leer("install", "bootstrap.ps1"))
const iss = leer("installer", "tecnia-bot.iss").replace(/^\s*;.*$/gm, "")

const ARQUITECTURAS = [
  ["64bit", "x64"],
  ["arm64", "arm64"],
]

test("el manifest se llama opencode.json: Scoop saca el nombre de la app del nombre del archivo", () => {
  // lib/core.ps1 de Scoop: appname_from_url = (Split-Path $url -Leaf) -replace '.json$'.
  // Con otro nombre la app se instalaría en scoop\apps\<otro> y ni el lanzador ni el
  // bootstrap (que miran scoop\apps\opencode) la encontrarían.
  assert.ok(existsSync(join(REPO, ...RUTA)), "falta install/scoop/opencode.json")
  assert.equal(manifest.bin, "opencode.exe", "el shim no se llamaría opencode")
})

test("el manifest dice la MISMA versión que install/OPENCODE_VERSION", () => {
  assert.match(pin, /^\d+\.\d+\.\d+$/, `OPENCODE_VERSION dice ${JSON.stringify(pin)}`)
  assert.equal(manifest.version, pin, "subieron OPENCODE_VERSION y no el manifest (o al revés): el bootstrap corta la instalación")
})

test("cada arquitectura baja el zip de ESA versión desde los releases de GitHub, con su sha256", () => {
  const hashes = []
  for (const [arq, sufijo] of ARQUITECTURAS) {
    const a = manifest.architecture?.[arq]
    assert.ok(a, `el manifest no tiene la arquitectura ${arq}`)
    assert.equal(
      a.url,
      `https://github.com/anomalyco/opencode/releases/download/v${pin}/opencode-windows-${sufijo}.zip`,
      `la URL de ${arq} no es la del release v${pin}`,
    )
    assert.match(a.hash, /^[0-9a-f]{64}$/, `el hash de ${arq} no es un sha256 en hexadecimal`)
    hashes.push(a.hash)
  }
  // Dos zips distintos no pueden tener el mismo hash: si coinciden, alguien copió y pegó.
  assert.equal(new Set(hashes).size, ARQUITECTURAS.length, "dos arquitecturas tienen el mismo hash")
  // Y no hay arquitecturas de más que este test no esté mirando.
  assert.deepEqual(Object.keys(manifest.architecture).sort(), ARQUITECTURAS.map(([a]) => a).sort())
})

test("el manifest NO tiene plantillas: ni `autoupdate` ni `checkver`", () => {
  // Una plantilla es justo lo que se rompió: una URL que se calcula en el momento, con
  // reglas que puede cambiar otro. Acá todo está escrito.
  assert.equal(manifest.autoupdate, undefined, "el manifest tiene `autoupdate`")
  assert.equal(manifest.checkver, undefined, "el manifest tiene `checkver`")
  assert.doesNotMatch(crudo, /\$version|\$match|\$base64/, "queda una variable de plantilla de Scoop en el manifest")
})

test("bootstrap.ps1 lee el manifest al lado suyo y CORTA si no coincide con la versión fijada, antes de instalar", () => {
  assert.match(ps1, /\$ManifiestoOpenCode = Join-Path \$PSScriptRoot "scoop\\opencode\.json"/, "no busca install\\scoop\\opencode.json al lado del script")
  const guarda = ps1.indexOf("if ($VersionDelManifiesto -ne $OpenCodeVersion) {")
  assert.ok(guarda > 0, "no compara la versión del manifest contra OPENCODE_VERSION")
  const cierre = ps1.indexOf("\n}", guarda)
  assert.match(ps1.slice(guarda, cierre), /\bexit 1\b/, "la guarda no corta: instalaría una versión con el cartel de otra")
  const primeraInstalacion = ps1.indexOf("scoop install $ManifiestoOpenCode")
  assert.ok(primeraInstalacion > 0, "el bootstrap no instala desde el manifest")
  assert.ok(guarda < primeraInstalacion, "la guarda está DESPUÉS de la primera instalación: llega tarde")
  // Un manifest ilegible no puede tirar una traza cruda de PowerShell: cae a "" y la
  // guarda de arriba lo explica.
  assert.match(ps1, /\} catch \{\s*\$VersionDelManifiesto = ""\s*\}/, "un manifest roto revienta con ErrorActionPreference=Stop en vez de explicarse")
})

test("bootstrap.ps1 no instala OpenCode por ningún camino que dependa del bucket de Scoop", () => {
  const comandos = ps1.split("\n").filter((l) => !/Write-Host/.test(l))
  const instalaciones = comandos.filter((l) => /scoop install\b/.test(l) && /opencode/i.test(l))
  assert.ok(instalaciones.length >= 2, `esperaba al menos 2 instalaciones de OpenCode y encontré ${instalaciones.length}: ¿cambió el estilo?`)
  for (const l of instalaciones) {
    assert.match(l, /scoop install \$ManifiestoOpenCode \*>&1/, `instala OpenCode por otro camino: ${l.trim()}`)
  }
  // `versions/opencode1` es lo que sugiere el bucket para la 1.x. No sirve acá: se
  // instala con otro nombre de app y trae "la última 1.x", no la fijada.
  assert.doesNotMatch(ps1, /opencode1\b/, "el bootstrap usa versions/opencode1")
})

test("el .exe empaqueta install\\scoop\\ (install\\* CON subcarpetas)", () => {
  // Sin `recursesubdirs` el .exe llevaría install\*.ps1 y no la carpeta scoop\: el
  // bootstrap cortaría en la guarda en todas las máquinas.
  const linea = iss.split("\n").find((l) => /Source:\s*"\.\.\\install\\\*"/.test(l))
  assert.ok(linea, "el .iss no empaqueta ..\\install\\*")
  assert.match(linea, /recursesubdirs/, "install\\* se empaqueta sin subcarpetas: falta install\\scoop\\opencode.json en el .exe")
})
