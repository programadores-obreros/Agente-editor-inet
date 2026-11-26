// Imprimir la ventana «vista física» (o guardarla como PDF).
//
// POR QUÉ ESTE ARCHIVO (2026-11-26). Los cables del esquema son un dibujo puesto encima de las
// piezas, con las coordenadas de pantalla. En el papel la página es más angosta: si el esquema se
// reacomoda, las piezas se mueven y los cables quedan apuntando a donde ya no hay un pin. Un PDF
// con los cables corridos es peor que no tener PDF: es un plano de conexiones equivocado que se
// lleva al aula. La preparación para el papel era un bloque suelto dentro de `app.js` en el
// prototipo; ahora es una función que recibe el documento y se prueba ejecutándola.
//
// MUTACIONES que ponen rojo este archivo (probadas con el cambio ya commiteado):
//   - no fijar el ancho del esquema                                      → «fija el ancho de pantalla…»
//   - no poner `flex: none`                                              → «fija el ancho de pantalla…»
//   - `Math.min(1, …)` → sin el mínimo (agranda un esquema chico)        → «la escala nunca agranda»
//   - no restaurar el `zoom`                                             → «restaurar deja todo…»
//   - al restaurar, cerrar TODOS los <details>                           → «restaurar deja todo…»
//   - preparar dos veces sin restaurar                                   → «dos beforeprint seguidos…»
//   - no avisar `alEmpezar` / `alTerminar`                               → «el cableado prepara…»
//   - subir `ANCHO_UTIL_DE_LA_HOJA` a 1100                               → «el ancho útil entra en la hoja…»
//   - cambiar la hoja a vertical                                         → «el ancho útil entra en la hoja…»
//   - dejar la navegación a la vista en el papel                         → «en el papel no salen…»
//
// LÍMITE HONESTO: esto no imprime nada. Que en el PDF los cables lleguen a sus pines se miró en
// Chromium (`Page.printToPDF`) y a ojo; no quedó un test que lo repita.
//
// Corre con: node --test tests/ventana-impresion.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"
import { cssEmbebidoDe, reglasCss } from "./ventana-helpers.mjs"

const WEB = join(REPO, "opencode/vista-fisica/web")
const { ANCHO_UTIL_DE_LA_HOJA, escalaParaLaHoja, prepararParaImprimir, conectarImpresion } = await import(join(WEB, "impresion.js"))
const HTML = readFileSync(join(WEB, "index.html"), "utf8")
const CSS_PAGINA = cssEmbebidoDe(HTML)
const CSS_HOJA = readFileSync(join(REPO, "opencode/tecniabot-web/diseno/sistema.css"), "utf8")

/** Un documento con dos plegables (uno cerrado y uno ya abierto) y un esquema del ancho pedido. */
function documentoFalso({ anchoDelEsquema = 1300, estiloPrevio = {} } = {}) {
  const cerrado = { open: false }
  const abierto = { open: true }
  const esquema = anchoDelEsquema === null ? null : { offsetWidth: anchoDelEsquema, style: { width: "", flex: "", ...estiloPrevio } }
  const circuito = { firstElementChild: esquema, style: { zoom: "" } }
  const doc = {
    querySelectorAll: (selector) => {
      assert.equal(selector, "details:not([open])")
      return [cerrado, abierto].filter((d) => !d.open)
    },
    getElementById: (id) => (id === "circuito" ? circuito : null),
  }
  return { doc, cerrado, abierto, esquema, circuito }
}

test("la escala nunca agranda, y un esquema más ancho que la hoja se achica lo justo", () => {
  assert.equal(escalaParaLaHoja(1980, 990), 0.5)
  assert.equal(escalaParaLaHoja(990, 990), 1)
  assert.equal(escalaParaLaHoja(600, 990), 1, "un esquema que ya entra no se agranda")
  assert.equal(escalaParaLaHoja(1300), ANCHO_UTIL_DE_LA_HOJA / 1300)
  for (const raro of [0, -5, NaN, undefined]) assert.equal(escalaParaLaHoja(raro), 1, `ancho ${raro}`)
})

test("despliega lo plegado y fija el ancho de pantalla del esquema, achicándolo ENTERO", () => {
  const d = documentoFalso({ anchoDelEsquema: 1300 })
  prepararParaImprimir(d.doc)
  assert.equal(d.cerrado.open, true, "en el papel no se puede desplegar: la lista de conexiones tiene que salir")
  assert.equal(d.esquema.style.width, "1300px", "el esquema conserva su ancho de pantalla: si se reacomoda, los cables quedan corridos")
  assert.equal(d.esquema.style.flex, "none", "y no se estira ni se encoge")
  assert.equal(Number(d.circuito.style.zoom), ANCHO_UTIL_DE_LA_HOJA / 1300, "se achica el contenedor: piezas y cables juntos")
  assert.ok(1300 * Number(d.circuito.style.zoom) <= ANCHO_UTIL_DE_LA_HOJA + 1e-6, "achicado, entra en la hoja")
})

test("restaurar deja todo como estaba: vuelve a plegar SÓLO lo que estaba plegado y repone los estilos previos", () => {
  const d = documentoFalso({ anchoDelEsquema: 1300, estiloPrevio: { width: "80%", flex: "1 1 100%" } })
  d.circuito.style.zoom = "1.1"
  const restaurar = prepararParaImprimir(d.doc)
  restaurar()
  assert.equal(d.cerrado.open, false)
  assert.equal(d.abierto.open, true, "un plegable que la persona había abierto no se le cierra")
  assert.deepEqual({ ...d.esquema.style }, { width: "80%", flex: "1 1 100%" })
  assert.equal(d.circuito.style.zoom, "1.1")
  // Llamarla de nuevo (un afterprint repetido) no rompe ni pisa nada.
  d.cerrado.open = true
  d.circuito.style.zoom = "0.9"
  restaurar()
  assert.equal(d.cerrado.open, true)
  assert.equal(d.circuito.style.zoom, "0.9")
})

test("sin esquema, o con un esquema que mide cero, no se toca ninguna medida (pero lo plegado se abre igual)", () => {
  for (const ancho of [0, null]) {
    const d = documentoFalso({ anchoDelEsquema: ancho })
    const restaurar = prepararParaImprimir(d.doc)
    assert.equal(d.cerrado.open, true)
    assert.equal(d.circuito.style.zoom, "", `ancho ${ancho}: no hay nada que achicar`)
    if (d.esquema) assert.deepEqual({ ...d.esquema.style }, { width: "", flex: "" })
    assert.doesNotThrow(restaurar)
    assert.equal(d.cerrado.open, false)
  }
  assert.doesNotThrow(() => prepararParaImprimir({ querySelectorAll: () => [], getElementById: () => null })(), "una página sin #circuito tampoco rompe")
})

// ── El cableado de los eventos ──

function ventanaFalsa() {
  const manejadores = {}
  let impresiones = 0
  return {
    addEventListener: (tipo, fn) => (manejadores[tipo] = fn),
    disparar: (tipo) => manejadores[tipo]?.(),
    print: () => impresiones++,
    impresiones: () => impresiones,
  }
}

test("el cableado prepara en beforeprint, restaura en afterprint y avisa para pausar el dibujo de los cables", () => {
  const d = documentoFalso({ anchoDelEsquema: 1300 })
  const ventana = ventanaFalsa()
  const avisos = []
  let click = null
  d.doc.getElementById = (id) => (id === "circuito" ? d.circuito : id === "boton-imprimir" ? { addEventListener: (tipo, fn) => (click = tipo === "click" ? fn : click) } : null)
  conectarImpresion(d.doc, ventana, {
    alEmpezar: () => avisos.push(`empieza, zoom="${d.circuito.style.zoom}"`),
    alTerminar: () => avisos.push(`termina, zoom="${d.circuito.style.zoom}"`),
  })
  ventana.disparar("beforeprint")
  assert.notEqual(d.circuito.style.zoom, "")
  ventana.disparar("afterprint")
  assert.equal(d.circuito.style.zoom, "")
  // El aviso de «empieza» llega ANTES de achicar (para que nadie mida a mitad de camino) y el de
  // «termina» DESPUÉS de restaurar (para que el redibujo mida el esquema en su tamaño de pantalla).
  assert.deepEqual(avisos, ['empieza, zoom=""', 'termina, zoom=""'])
  assert.equal(typeof click, "function", "el botón «Imprimir / PDF» tiene que quedar conectado")
  click()
  assert.equal(ventana.impresiones(), 1)
})

test("dos beforeprint seguidos no pierden el estado original; un afterprint suelto no hace nada", () => {
  const d = documentoFalso({ anchoDelEsquema: 1300, estiloPrevio: { width: "80%" } })
  const ventana = ventanaFalsa()
  let terminados = 0
  conectarImpresion(d.doc, ventana, { alTerminar: () => terminados++ })
  ventana.disparar("afterprint")
  assert.equal(terminados, 0, "sin haber empezado, no hay nada que terminar")
  ventana.disparar("beforeprint")
  ventana.disparar("beforeprint")
  ventana.disparar("afterprint")
  assert.equal(d.esquema.style.width, "80%", "el segundo beforeprint guardó como «lo de antes» el estado ya achicado")
  assert.equal(d.circuito.style.zoom, "")
  assert.equal(d.cerrado.open, false)
  assert.equal(terminados, 1)
})

// ── La hoja: tamaño, orientación y qué no sale ──

const aPx = (medida) => {
  const m = /^([\d.]+)(cm|mm|in|px)$/.exec(medida.trim())
  assert.ok(m, `no sé leer la medida «${medida}»`)
  return Number(m[1]) * { cm: 96 / 2.54, mm: 96 / 25.4, in: 96, px: 1 }[m[2]]
}

test("el ancho útil entra en la hoja que declara la página: A4 apaisada, con su margen", () => {
  const paginas = reglasCss(CSS_PAGINA).filter((r) => r.selector === "@page")
  assert.equal(paginas.length, 1, "la ventana declara su hoja una sola vez")
  assert.match(paginas[0].cuerpo, /size\s*:\s*A4\s+landscape\b/, "el esquema es ancho: la hoja va apaisada")
  const margen = /margin\s*:\s*([\d.]+(?:cm|mm|in|px))\s*;/.exec(paginas[0].cuerpo)
  assert.ok(margen, "la hoja tiene que declarar un margen único")
  const anchoDeLaHoja = aPx("297mm") - 2 * aPx(margen[1])
  // Adentro de la hoja, el esquema está en una tarjeta: su relleno (16 px en papel) y su borde (1 px), de cada lado.
  const disponible = anchoDeLaHoja - 2 * (16 + 1)
  assert.ok(ANCHO_UTIL_DE_LA_HOJA <= disponible, `el esquema se achica a ${ANCHO_UTIL_DE_LA_HOJA} px y en la hoja hay ${disponible.toFixed(0)}: se cortaría por el borde derecho`)
  assert.ok(ANCHO_UTIL_DE_LA_HOJA >= disponible - 40, `…y tampoco se desperdicia: hay ${disponible.toFixed(0)} px y se usan ${ANCHO_UTIL_DE_LA_HOJA}`)
  assert.doesNotMatch(CSS_HOJA.replace(/\/\*[\s\S]*?\*\//g, ""), /@page/, "la hoja compartida no fija el papel: lo pone cada página")
})

test("en el papel no salen la navegación, la conexión, el mensaje de estado ni los botones; y siempre en claro", () => {
  const ocultas = (css) => reglasCss(css).filter((r) => r.medio.includes("print") && /display\s*:\s*none/.test(r.cuerpo)).flatMap((r) => r.selector.split(",").map((s) => s.trim()))
  const enPagina = ocultas(CSS_PAGINA)
  for (const selector of ["nav[data-pasos]", "#conexion", "#estado"]) assert.ok(enPagina.includes(selector), `${selector} tiene que ocultarse al imprimir`)
  // Los botones se ocultan por la hoja compartida: los dos del header tienen que llevar su clase.
  assert.ok(ocultas(CSS_HOJA).includes(".tb-boton"), "precondición: la hoja oculta .tb-boton al imprimir")
  for (const id of ["boton-tema", "boton-imprimir", "vista-logica-quitar"]) assert.match(HTML, new RegExp(`<button\\b[^>]*id="${id}"[^>]*class="[^"]*\\btb-boton\\b`), `#${id} saldría impreso`)
  // Siempre en claro: el papel repone los tokens también para el tema oscuro, y la página no tiene colores propios por tema.
  assert.ok(reglasCss(CSS_HOJA).some((r) => r.medio.includes("print") && r.selector === ':root, :root[data-theme="dark"]' && /color-scheme\s*:\s*light/.test(r.cuerpo)))
  // El programa sale entero, sin barra propia.
  const programa = reglasCss(CSS_PAGINA).filter((r) => r.medio.includes("print") && r.selector === "#vista-codigo-texto")
  assert.ok(programa.some((r) => /max-height\s*:\s*none/.test(r.cuerpo)), "en el papel el programa no puede quedar cortado a 420 px")
  const esquema = reglasCss(CSS_PAGINA).filter((r) => r.medio.includes("print") && r.selector === "#circuito")
  assert.ok(esquema.some((r) => /overflow\s*:\s*visible/.test(r.cuerpo)), "ni el esquema recortado con una barra de desplazamiento")
})

test("app.js pausa el dibujo de los cables mientras se imprime y lo retoma al terminar", () => {
  const app = readFileSync(join(WEB, "app.js"), "utf8")
  const programar = /\nfunction programarCableado\(\) \{\n([\s\S]*?)\n\}\n/.exec(app)
  assert.ok(programar, "no encontré programarCableado en app.js")
  assert.match(programar[1].split("\n")[0], /\bimprimiendo\b/, "con el esquema achicado para el papel no hay que volver a medirlo")
  const conexion = /conectarImpresion\(document, window, \{([\s\S]*?)\n  \}\)/.exec(app)
  assert.ok(conexion, "app.js no conecta la impresión")
  assert.match(conexion[1], /alEmpezar: \(\) => \{\s*imprimiendo = true\s*\}/)
  assert.match(conexion[1], /alTerminar: \(\) => \{\s*imprimiendo = false\s*programarCableado\(\)\s*\}/)
})
