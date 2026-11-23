// El manifiesto de calidad nombra todo lo que el producto tiene.
//
// docs/manifiesto-de-calidad.md dice, por componente, qué hace, qué se le exige, cómo se
// comprueba y qué falta. Sirve mientras esté completo: una tool nueva que entra sin su
// fila es una parte del producto de la que nadie dijo qué se le exige.
//
// Este test NO juzga el contenido de las filas (eso es de quien las escribe y de quien
// revisa el PR). Sólo impide que el manifiesto se quede atrás del árbol.
//
// MUTACIONES que lo ponen rojo (las siete probadas): sacar del manifiesto la fila de `ficha`
// o la de `tecnia-logo`; agregar un archivo opencode/tool/nueva.ts; renombrar una de las tres
// secciones; dejar una celda vacía; poner un nivel de evidencia que no existe; presentarlo
// como norma.
//
// Corre con: node --test tests/manifiesto-de-calidad.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const manifiesto = readFileSync(join(REPO, "docs/manifiesto-de-calidad.md"), "utf8")
const filas = manifiesto.split("\n").filter((l) => /^\| (?:● )?[^|-]/.test(l) && !l.startsWith("| Componente") && !l.startsWith("| Nivel"))
const componentes = filas.map((l) => l.split("|")[1].trim()).join("\n")

test("cada tool y cada plugin del árbol tiene su fila en el manifiesto", () => {
  const tools = readdirSync(join(REPO, "opencode/tool")).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, ""))
  const plugins = readdirSync(join(REPO, "opencode/plugins")).filter((f) => /\.tsx?$/.test(f)).map((f) => f.replace(/\.tsx?$/, ""))
  assert.ok(tools.length >= 10 && plugins.length >= 2, `sólo encontré ${tools.length} tools y ${plugins.length} plugins: no estoy mirando opencode/`)
  for (const nombre of [...tools, ...plugins]) {
    assert.match(componentes, new RegExp(`\\b${nombre}\\b`), `«${nombre}» está en el árbol y no tiene fila en docs/manifiesto-de-calidad.md`)
  }
})

test("el manifiesto tiene sus tres secciones y cada fila trae las seis columnas con algo adentro", () => {
  for (const titulo of ["## Línea publicada", "## En las dos líneas", "## Rama de intención"]) {
    assert.ok(manifiesto.includes(titulo), `falta la sección «${titulo}»`)
  }
  // Las filas de componentes tienen seis columnas; la tabla de niveles, tres, y no cuenta.
  const deComponentes = filas.filter((l) => l.split("|").length === 8)
  assert.ok(deComponentes.length >= 30, `sólo hay ${deComponentes.length} filas de componentes`)
  for (const fila of deComponentes) {
    const celdas = fila.split("|").slice(1, -1).map((c) => c.trim())
    celdas.forEach((celda, i) => assert.ok(celda.length > 0, `una celda vacía (columna ${i + 1}) en la fila de «${celdas[0]}»`))
    assert.match(celdas[4], /^(Ejecutado en tests|Ejecutado sólo en CI|Probado a mano, sin registro|Sólo se compara su texto|Sin test)$/, `nivel de evidencia desconocido en «${celdas[0]}»: ${celdas[4]}`)
  }
})

test("el manifiesto dice que es referencia y no norma", () => {
  // CLAUDE.md es la única doctrina. Un documento que se presenta como norma sin que
  // CLAUDE.md lo adopte crea una segunda voz.
  assert.match(manifiesto, /referencia, no norma/)
})
