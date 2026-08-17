// Ningún tool puede meter una ruta cruda dentro de un `file://`.
//
// POR QUÉ EXISTE ESTE ARCHIVO. En Windows la ruta no es una URL:
// `C:\Users\Maria Jose\hoja.html` interpolado da
// `file://C:\Users\Maria Jose\hoja.html` — barras invertidas, falta la tercera
// barra, y el espacio sin escapar. Pegado en el navegador no abre nada.
//
// Y aparece en el peor momento: es el texto de respaldo que se muestra JUSTO
// cuando el auto-open ya falló. Estaba en ocho lugares de tres tools, mientras
// la función correcta ya existía escrita y probada en ficha.ts sin que nadie
// más la usara.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), "..", "opencode", "tool")
const archivos = readdirSync(TOOLS).filter((f) => f.endsWith(".ts"))

test("ningún tool interpola una ruta cruda en un file://", () => {
  const culpables = []
  for (const f of archivos) {
    const src = readFileSync(join(TOOLS, f), "utf8")
    // Ignoramos los comentarios: el porqué de esta regla se explica citando el caso malo.
    const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    for (const m of codigo.matchAll(/file:\/\/\$\{/g)) {
      culpables.push(`${f}: ${codigo.slice(m.index, m.index + 40)}`)
    }
  }
  assert.deepEqual(
    culpables,
    [],
    `usá comoUrl(ruta) en vez de interpolar directo:\n${culpables.join("\n")}`,
  )
})

test("los tools que muestran rutas tienen comoUrl", () => {
  // Si un tool le muestra una ruta al docente, tiene que poder armarla bien.
  for (const f of ["ficha.ts", "imprimible.ts", "ayuda.ts", "circuito.ts"]) {
    const src = readFileSync(join(TOOLS, f), "utf8")
    assert.match(src, /function comoUrl/, `${f} muestra rutas y no tiene comoUrl`)
  }
})

test("comoUrl arma bien la URL de Windows", async () => {
  // Se prueba la de ficha.ts, que es la que está exportada; las otras tres son
  // copia literal y el test anterior verifica que existan.
  const { comoUrl } = await import(join(TOOLS, "..", "..", "tests", "_ficha-para-url.mjs"))
  assert.equal(comoUrl("C:\\Users\\Maria Jose\\hoja.html"), "file:///C:/Users/Maria%20Jose/hoja.html")
  assert.equal(comoUrl("/home/x/hoja.html"), "file:///home/x/hoja.html")
})
