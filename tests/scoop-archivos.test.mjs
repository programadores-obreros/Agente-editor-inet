// Scoop 0.6.0 (2026-09-30) renombró los archivos que deja en apps\<app>\current\:
// manifest.json -> scoop-manifest.json e install.json -> scoop-install.json.
//
// bootstrap.ps1 sólo buscaba manifest.json para decidir si OpenCode estaba instalado, y en
// toda máquina con Scoop nuevo decía "OPENCODE NO ARRANCA" aunque OpenCode contestara su
// versión (CI Windows del 2026-10-14, issue #42; reproducido en la VM win10: Scoop 0.6.0 deja
// scoop-manifest.json y scoop-install.json, Scoop 0.5.3 deja los nombres viejos).
//
// La regla: ningún script de install/ lee esos archivos de Scoop por su nombre directo; todos
// pasan por Get-ArchivoScoop, que prueba el nombre nuevo y después el viejo.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..")
const sinComentarios = (t) => t.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n")
const scripts = readdirSync(join(REPO, "install")).filter((f) => f.endsWith(".ps1"))

test("ningún .ps1 de install/ lee manifest.json o install.json de Scoop por su nombre directo", () => {
  for (const f of scripts) {
    const codigo = sinComentarios(readFileSync(join(REPO, "install", f), "utf8"))
    // Un Join-Path / Test-Path / Get-Content con "manifest.json" o "install.json" literal es una
    // lectura que con Scoop 0.6 no encuentra nada. (Los mensajes al usuario no cuentan.)
    const malas = codigo.split("\n").filter((l) => /(Join-Path|Test-Path|Get-Content|Exists)\b[^\n]*["\\](manifest|install)\.json/.test(l))
    assert.deepEqual(malas, [], `${f}: usá Get-ArchivoScoop`)
  }
})

test("Get-ArchivoScoop prueba primero el nombre de Scoop 0.6 y después el viejo, en bootstrap.ps1 y diagnostico.ps1", () => {
  for (const f of ["bootstrap.ps1", "diagnostico.ps1"]) {
    const codigo = readFileSync(join(REPO, "install", f), "utf8")
    assert.match(codigo, /function Get-ArchivoScoop\(\[string\]\$dirApp, \[string\]\$nombre\)/, `${f} no define Get-ArchivoScoop`)
    assert.match(codigo, /foreach \(\$n in @\("scoop-\$nombre\.json", "\$nombre\.json"\)\)/, `${f}: el orden tiene que ser scoop-<nombre>.json y después <nombre>.json`)
  }
  const bootstrap = readFileSync(join(REPO, "install", "bootstrap.ps1"), "utf8")
  assert.match(bootstrap, /function Test-OpenCodeScoop \{\s*return \[bool\]\(Get-ArchivoScoop \(Join-Path \$OpenCodeAppDir "current"\) "manifest"\)/)
  assert.match(bootstrap, /\$mf = Get-ArchivoScoop \(Join-Path \$OpenCodeAppDir "current"\) "manifest"/)
})
