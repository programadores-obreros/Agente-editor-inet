// Los colores de los bloques de las reglas son los colores de los roles del esquema.
//
// POR QUÉ ESTE ARCHIVO (2026-11-26). En el esquema, lo que se lee (entrada) va en azul y lo que se
// maneja (salida) en verde azulado. Los bloques «mientras» y «hacer» tenían cada uno un tono suelto
// de Blockly (210 y 120) que no era ninguno de los dos: el alumno veía un azul y un verde distintos
// para decir lo mismo. Blockly no lee variables de CSS, así que los colores van como literales en
// `COLORES_DE_BLOQUE` (`adaptador-blockly.js`) y este test los ata a `--entrada` y `--salida` de
// `index.html` leyendo el archivo, y comprueba que el texto blanco de Blockly se lea encima.
//
// MUTACIONES que ponen rojo este archivo (probadas con el cambio ya commiteado):
//   - cambiar `--entrada` en `index.html` y no en el módulo                → «son los mismos…»
//   - cambiar `COLORES_DE_BLOQUE.hacer` y no `--salida`                    → «son los mismos…»
//   - volver a `colour: 210` en el bloque «mientras»                       → «los bloques se definen…»
//   - un color claro (`#5eead4`) en los dos lados a la vez                 → «el texto blanco…»
//
// LÍMITE HONESTO: que Blockly pinte el texto en blanco se comprobó en Chromium (relleno calculado
// de `.blocklyText`), no acá: acá se asume `#ffffff`.
//
// Corre con: node --test tests/ventana-colores-bloques.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"
import { cssEmbebidoDe, reglasCss, tokensDe, contraste } from "./ventana-helpers.mjs"
import { fabricarBlockly } from "./phase3-blockly-fake.mjs"

const WEB = join(REPO, "opencode/vista-fisica/web")
const { COLORES_DE_BLOQUE, crearAdaptadorBlockly } = await import(join(WEB, "adaptador-blockly.js"))
const HTML = readFileSync(join(WEB, "index.html"), "utf8")

/** Los tokens del bloque `:root` de la ventana (fuera de toda @media). */
function tokensDeLaVentana() {
  const raices = reglasCss(cssEmbebidoDe(HTML)).filter((r) => r.selector === ":root" && r.medio === "")
  assert.equal(raices.length, 1, "precondición: la ventana declara sus tokens en un solo :root")
  return tokensDe(raices[0].cuerpo)
}

test("son los mismos colores que las zonas del esquema: «mientras» = entrada, «hacer» = salida", () => {
  const tokens = tokensDeLaVentana()
  assert.ok(tokens["--entrada"] && tokens["--salida"], "precondición: la ventana tiene los tokens de rol")
  assert.equal(COLORES_DE_BLOQUE.mientras.toLowerCase(), tokens["--entrada"].toLowerCase())
  assert.equal(COLORES_DE_BLOQUE.hacer.toLowerCase(), tokens["--salida"].toLowerCase())
})

test("el texto blanco de Blockly se lee encima de cada bloque (contraste WCAG ≥ 4.5)", () => {
  // El guard se prueba a sí mismo: un tono claro tiene que dar menos de 4.5.
  assert.ok(contraste("#5eead4", "#ffffff") < 4.5, "precondición: la fórmula marca un color claro")
  for (const [bloque, color] of Object.entries(COLORES_DE_BLOQUE)) {
    const c = contraste(color, "#ffffff")
    assert.ok(c >= 4.5, `el bloque «${bloque}» (${color}) da ${c.toFixed(2)} contra el blanco`)
  }
})

test("los bloques se definen con esos colores, no con un tono suelto", () => {
  const { Blockly, reg } = fabricarBlockly()
  crearAdaptadorBlockly({ Blockly, contenedor: { nombre: "div" }, alEditar: () => {}, alQuitar: () => {} })
  const colorDe = (tipo) => reg.definiciones.find((d) => d.type === tipo)?.colour
  assert.equal(colorDe("tecnia_mientras"), COLORES_DE_BLOQUE.mientras)
  assert.equal(colorDe("tecnia_hacer"), COLORES_DE_BLOQUE.hacer)
})
