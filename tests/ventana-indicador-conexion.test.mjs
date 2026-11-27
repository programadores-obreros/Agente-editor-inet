// El indicador de conexión de la ventana dice «Ventana al día» / «Ventana sin conexión».
//
// POR QUÉ ESTE ARCHIVO (2026-11-26). El chip decía «conectado», y el dueño lo leyó como «la placa
// está conectada». Lo que mide es el enlace de ESTA página con Tecnia Bot (el `EventSource`), nada
// de la placa. Textos aprobados por el dueño: «Ventana al día» y «Ventana sin conexión». Cuando se
// cortaba, el chip mostraba además una explicación larga; el chip queda con lo corto y la
// explicación, con el mismo contenido, va en la franja de estado (`#estado`, que ya existía y es
// `role="status"`). Hasta este archivo ningún test miraba el TEXTO del indicador: sólo el reductor.
//
// Los VALORES `conectado`/`desconectado` de `data-estado-conexion` no cambian: son identificadores
// del CSS y de los tests (`tests/phase2-conexion-estado.test.mjs`), no texto para el alumno.
//
// MUTACIONES que ponen rojo este archivo (probadas con el cambio ya commiteado):
//   - volver a escribir «conectado» como texto del chip (en `estado-conexion.js`)  → «los textos…» y «el indicador, ejecutado…»
//   - el texto inicial de `index.html` otra vez «conectado»                       → «index.html arranca…»
//   - no escribir la explicación en `#estado` al cortarse                         → «el indicador, ejecutado…»
//   - borrar `#estado` al reconectar aunque diga otra cosa                         → «al reconectar…»
//   - escribir el VALOR del atributo con el texto («Ventana al día»)              → «el indicador, ejecutado…»
//
// Corre con: node --test tests/ventana-indicador-conexion.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const conexion = await import(join(REPO, "opencode/vista-fisica/web/estado-conexion.js"))
const { pintarIndicadorConexion } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))

// Escritas a mano: son los textos que aprobó el dueño.
const AL_DIA = "Ventana al día"
const SIN_CONEXION = "Ventana sin conexión"
// La explicación de antes, sin el «desconectado:» del principio (eso ahora lo dice el chip).
const EXPLICACION = "La vista puede no estar actualizada. Si el servidor se reinició en otro puerto, volvé a abrir la vista física desde Tecnia Bot."

test("los textos del indicador son los aprobados, y ninguno dice «conectado» ni «desconectado»", () => {
  assert.deepEqual(conexion.textosDelIndicador("conectado"), { chip: AL_DIA, detalle: null })
  assert.deepEqual(conexion.textosDelIndicador("desconectado"), { chip: SIN_CONEXION, detalle: EXPLICACION })
  for (const texto of [AL_DIA, SIN_CONEXION, EXPLICACION]) assert.doesNotMatch(texto, /conectad/i)
})

function elemento(texto = "") {
  return { textContent: texto, atributos: {}, setAttribute(k, v) { this.atributos[k] = String(v) } }
}

test("el indicador, ejecutado: al cortarse, chip corto y la explicación en la franja; al volver, «al día» y la franja limpia", () => {
  const chip = elemento()
  const franja = elemento()
  pintarIndicadorConexion({ estado: "desconectado", elementoConexion: chip, elementoEstado: franja })
  assert.equal(chip.textContent, SIN_CONEXION)
  assert.equal(chip.atributos["data-estado-conexion"], "desconectado", "el VALOR del atributo sigue siendo el identificador de siempre")
  assert.equal(franja.textContent, EXPLICACION, "la explicación no se pierde: va en #estado")

  pintarIndicadorConexion({ estado: "conectado", elementoConexion: chip, elementoEstado: franja })
  assert.equal(chip.textContent, AL_DIA)
  assert.equal(chip.atributos["data-estado-conexion"], "conectado")
  assert.equal(franja.textContent, "", "reconectada, la explicación de la desconexión se va")
})

test("al reconectar, la franja de estado no se borra si dice otra cosa (p. ej. un pedido que falló)", () => {
  const franja = elemento("No se pudo guardar el cambio.")
  pintarIndicadorConexion({ estado: "conectado", elementoConexion: elemento(), elementoEstado: franja })
  assert.equal(franja.textContent, "No se pudo guardar el cambio.")
})

test("index.html arranca con «Ventana al día» y el atributo en `conectado`; la franja de estado existe y es role=status", () => {
  const html = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "")
  const chip = /<span\b[^>]*id="conexion"[^>]*>([^<]*)<\/span>/.exec(html)
  assert.ok(chip, "la página no tiene el indicador")
  assert.equal(chip[1], AL_DIA)
  assert.match(chip[0], /data-estado-conexion="conectado"/)
  assert.match(html, /<div id="estado" role="status"[^>]*>/)
})

test("app.js: el indicador se pinta con `pintarIndicadorConexion`, con el chip y la franja de la página", () => {
  const app = readFileSync(join(REPO, "opencode/vista-fisica/web/app.js"), "utf8")
  assert.match(app, /pintarIndicadorConexion\(\{ estado: estadoConexion, elementoConexion, elementoEstado \}\)/)
  assert.match(app, /elementoEstado = document\.getElementById\("estado"\)/)
  assert.match(app, /elementoConexion = document\.getElementById\("conexion"\)/)
  assert.doesNotMatch(app, /textContent = [^\n]*"conectado"/, "app.js vuelve a escribir «conectado» como texto")
})

// Los dos avisos del panel de código hablaban de «la vista desconectada» mientras el indicador de
// arriba decía «Ventana sin conexión»: dos nombres para lo mismo. Los demás tests del panel comparan
// contra la constante, así que cambiarle las palabras no ponía nada en rojo. Este mira las palabras.
test("el panel de código habla del corte con las palabras del indicador", async () => {
  const codigo = await import(join(REPO, "opencode/vista-fisica/web/vista-codigo.js"))
  assert.equal(codigo.TEXTO_DESCONECTADA, "La ventana está sin conexión: este programa puede no ser el actual.")
  assert.equal(codigo.TEXTO_NO_SE_PUDO_PEDIR, "No se pudo pedir el programa a Tecnia Bot. Si la ventana quedó sin conexión, volvé a abrirla desde Tecnia Bot.")
  for (const texto of [codigo.TEXTO_DESCONECTADA, codigo.TEXTO_NO_SE_PUDO_PEDIR]) assert.doesNotMatch(texto, /desconectad/)
})
