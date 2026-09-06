// En PowerShell, "$nombre: texto" dentro de una cadena NO es la variable seguida de
// dos puntos: el parser lo lee como un prefijo de ambito ($env:, $script:) y falla
// con "La referencia de variable no es valida" ANTES de ejecutar una sola linea.
// Lo cazo el PowerShell 5.1 real de la VM en update.ps1 (2026-09-05); la CI corre en
// Linux y nunca lo hubiera visto. La forma segura es "${nombre}: texto".
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const dir = new URL("../install/", import.meta.url).pathname
const ps1 = readdirSync(dir).filter((f) => f.endsWith(".ps1"))
// $nombre: seguido de algo que NO puede ser un nombre de variable (espacio, comilla, fin).
const trampa = /\$[A-Za-z_][A-Za-z0-9_]*:(?![A-Za-z_])/

test("hay scripts .ps1 que revisar", () => {
  assert.ok(ps1.length >= 5, `esperaba al menos 5 .ps1 en install/, hay ${ps1.length}`)
})

for (const f of ps1) {
  test(`${f}: ningun "$variable:" suelto dentro de una cadena (usar \${variable}:)`, () => {
    const lineas = readFileSync(join(dir, f), "utf8").split("\n")
    const malas = lineas
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => !l.trim().startsWith("#") && trampa.test(l))
    assert.deepEqual(
      malas.map((m) => `${f}:${m.n}: ${m.l.trim()}`),
      [],
      "PowerShell lee '$x:' como prefijo de ambito y no parsea el archivo",
    )
  })
}
