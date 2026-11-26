// La hoja de estilos compartida (opencode/tecniabot-web/diseno/sistema.css) cumple sus reglas.
//
// POR QUÉ ESTE ARCHIVO. Hasta acá cada tool que arma una página traía su propio CSS
// (`imprimible.ts`, `circuito.ts`): dos paletas, dos criterios de impresión, y ningún
// control de contraste. Esta hoja es la única fuente de diseño para las páginas nuevas, y
// una hoja compartida se degrada sola si nadie la custodia: alguien pega un `#fff` en un
// componente y el modo oscuro deja de servir; alguien usa un token que no existe y el
// navegador lo ignora sin decir nada.
//
// LO QUE SE MIDE ES EL CSS, NO UNA COPIA. Los valores de los tokens se leen del archivo y
// el contraste se CALCULA con la fórmula de WCAG 2.x; acá no hay ningún ratio escrito a
// mano salvo los tres que prueban que la fórmula está bien copiada.
//
// CADA GUARD SE PRUEBA A SÍ MISMO: las funciones que buscan defectos corren primero contra
// un CSS fabricado que TIENE el defecto, y tienen que marcarlo. Un chequeo que nunca puede
// fallar da falsa tranquilidad.
//
// MUTACIONES que ponen rojo este archivo (quince, probadas una por una con la hoja ya
// commiteada y restaurando sólo ese archivo después de cada una; acá van las principales):
//   - borrar un token de `:root` (p. ej. `--marca-honda`)           → «todo var() usado está definido»
//   - poner `color: #fff` en un componente                          → «ningún color literal fuera de los tokens»
//   - sacar `--cod-f` del bloque oscuro                             → «oscuro e impresión redefinen los mismos tokens»
//   - bajar `--tinta-2` a un gris claro (`#9aa3b4`) en el tema claro → «contraste»
//   - agregar `@import "x.css";`                                    → «sin recursos externos»
//   - renombrar `.tb-aviso__etiqueta`                               → «los avisos llevan etiqueta»
//   - distinguir un aviso con `border-left: 4px solid var(--error)` → «los avisos llevan etiqueta»
//   - agregar una regla `#circuito { }`                             → «sólo clases tb-»
//
// LÍMITE HONESTO: esto lee texto. No prueba cómo se ve la hoja en un navegador; eso se miró
// a mano en Chromium (capturas en claro y en oscuro, y el PDF) y no quedó un test que lo repita.
//
// Corre con: node --test tests/sistema-diseno.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const RUTA = join(REPO, "opencode/tecniabot-web/diseno/sistema.css")
const CSS = readFileSync(RUTA, "utf8")

// ── Un lector de CSS chico: reglas de primer nivel y las que están dentro de un @media ──

const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "")

/** Devuelve [{ medio, selector, cuerpo }]. `medio` es "" o el encabezado del @media. */
function reglasDe(css, medio = "") {
  const texto = sinComentarios(css)
  const reglas = []
  let i = 0
  while (i < texto.length) {
    const abre = texto.indexOf("{", i)
    if (abre === -1) break
    const selector = texto.slice(i, abre).trim()
    let hondo = 1
    let j = abre + 1
    while (j < texto.length && hondo > 0) {
      if (texto[j] === "{") hondo++
      else if (texto[j] === "}") hondo--
      j++
    }
    assert.equal(hondo, 0, `llaves sin cerrar después de «${selector}»`)
    const cuerpo = texto.slice(abre + 1, j - 1)
    if (selector.startsWith("@media")) reglas.push(...reglasDe(cuerpo, selector.replace(/\s+/g, " ")))
    else reglas.push({ medio, selector: selector.replace(/\s+/g, " "), cuerpo })
    i = j
  }
  return reglas
}

const SEL_CLARO = ":root"
const SEL_OSCURO = ':root[data-theme="dark"]'
const SEL_PAPEL = ':root, :root[data-theme="dark"]'
const esDePapel = (r) => r.medio.includes("print")
const esBloqueDeTokens = (r) =>
  (r.medio === "" && (r.selector === SEL_CLARO || r.selector === SEL_OSCURO)) || (esDePapel(r) && r.selector === SEL_PAPEL)

/** Las propiedades personalizadas declaradas en un cuerpo: { "--x": "valor" }. */
function tokensDe(cuerpo) {
  const tokens = {}
  for (const m of cuerpo.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim()
  return tokens
}

function bloque(css, selector, deMedio) {
  const hallados = reglasDe(css).filter((r) => r.selector === selector && deMedio(r))
  assert.equal(hallados.length, 1, `esperaba un solo bloque «${selector}» y hay ${hallados.length}`)
  return tokensDe(hallados[0].cuerpo)
}

const tokensClaro = (css) => bloque(css, SEL_CLARO, (r) => r.medio === "")
const tokensOscuro = (css) => bloque(css, SEL_OSCURO, (r) => r.medio === "")
const tokensPapel = (css) => bloque(css, SEL_PAPEL, esDePapel)

// ── Los buscadores de defectos (cada uno se prueba contra un CSS que tiene el defecto) ──

function varsSinDefinir(css) {
  const definidos = new Set(Object.keys(tokensClaro(css)))
  const usados = new Set([...sinComentarios(css).matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]))
  return [...usados].filter((v) => !definidos.has(v)).sort()
}

const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|:\s*(?:white|black|red|green|blue|yellow|orange|purple|gray|grey|silver|navy|teal)\b/gi

function coloresLiteralesFuera(css) {
  return reglasDe(css)
    .filter((r) => !esBloqueDeTokens(r))
    .flatMap((r) => [...r.cuerpo.matchAll(COLOR_LITERAL)].map((m) => `${r.selector} → ${m[0]}`))
}

function recursosExternos(css) {
  return [...sinComentarios(css).matchAll(/url\(|@import|@font-face|@page/gi)].map((m) => m[0].toLowerCase())
}

/** Clases, ids y atributos data-* que aparecen en los selectores. */
function selectoresDe(css) {
  const selectores = reglasDe(css).map((r) => r.selector).join(" , ")
  return {
    clases: [...new Set([...selectores.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]))],
    ids: [...new Set([...selectores.matchAll(/#([a-zA-Z_][\w-]*)/g)].map((m) => m[1]))],
  }
}

// ── Contraste WCAG 2.x, calculado ──

function rgbDe(hex) {
  const limpio = hex.trim().replace(/^#/, "")
  assert.match(limpio, /^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, `«${hex}» no es un color hexadecimal de 3 o 6 cifras`)
  const largo = limpio.length === 3 ? [...limpio].map((c) => c + c).join("") : limpio
  return [0, 2, 4].map((i) => parseInt(largo.slice(i, i + 2), 16))
}

function luminancia(hex) {
  const [r, g, b] = rgbDe(hex).map((canal) => {
    const c = canal / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a, b) {
  const [clara, oscura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (clara + 0.05) / (oscura + 0.05)
}

const temasDe = (css) => ({
  claro: tokensClaro(css),
  oscuro: { ...tokensClaro(css), ...tokensOscuro(css) },
  impresión: { ...tokensClaro(css), ...tokensPapel(css) },
})

/**
 * Pares texto/fondo que la hoja usa por HERENCIA (el color lo pone una regla y el fondo
 * otra), que el test no puede deducir solo. Los pares que una misma regla declara juntos
 * (`color` y `background` en el mismo bloque) se sacan del CSS, más abajo.
 */
const PARES = [
  ["--tinta", "--fondo"], ["--tinta", "--sup"], ["--tinta", "--hundida"], ["--tinta", "--marca-suave"],
  ["--tinta-2", "--fondo"], ["--tinta-2", "--sup"], ["--tinta-2", "--hundida"],
  ["--marca-honda", "--marca-suave"], ["--marca-honda", "--sup"], ["--sobre-marca", "--marca"],
  ["--sobre-acento", "--acento"],
  ["--tinta", "--info-f"], ["--tinta", "--ok-f"], ["--tinta", "--aviso-f"], ["--tinta", "--error-f"],
  ["--info", "--info-f"], ["--ok", "--ok-f"], ["--aviso", "--aviso-f"], ["--error", "--error-f"],
  ["--info-f", "--info"], ["--ok-f", "--ok"], ["--aviso-f", "--aviso"], ["--error-f", "--error"],
  ["--error", "--sup"], ["--cod-t", "--cod-f"], ["--cod-2", "--cod-f"],
]

/** Los pares que una regla declara completos: `color: var(--a)` y `background: var(--b)`. */
function paresDeclarados(css) {
  const pares = []
  for (const r of reglasDe(css).filter((x) => !esBloqueDeTokens(x))) {
    const texto = /(?:^|[;\s])color\s*:\s*var\((--[a-z0-9-]+)\)/.exec(r.cuerpo)
    const fondo = /(?:^|[;\s])background(?:-color)?\s*:\s*var\((--[a-z0-9-]+)\)/.exec(r.cuerpo)
    if (texto && fondo) pares.push({ texto: texto[1], fondo: fondo[1], donde: r.selector, soloPapel: esDePapel(r) })
  }
  return pares
}

function contrastesBajos(css, pares, minimo = 4.5) {
  const bajos = []
  for (const [tema, tokens] of Object.entries(temasDe(css))) {
    for (const par of pares) {
      if (par.soloPapel && tema !== "impresión") continue
      const [texto, fondo] = [tokens[par.texto], tokens[par.fondo]]
      assert.ok(texto && fondo, `el par ${par.texto} / ${par.fondo} nombra un token que no existe`)
      const ratio = contraste(texto, fondo)
      if (ratio < minimo) bajos.push(`${tema}: ${par.texto} (${texto}) sobre ${par.fondo} (${fondo}) da ${ratio.toFixed(2)}${par.donde ? ` en «${par.donde}»` : ""}`)
    }
  }
  return bajos
}

// ════════════════════════════════════════════════════════════════════════════════════

test("el lector de CSS separa los tres bloques de tokens y entra en los @media", () => {
  const css = `/* c { } */ :root { --a: #111; } :root[data-theme="dark"] { --a: #eee; }
    .x { color: var(--a); } @media print { :root, :root[data-theme="dark"] { --a: #000; } .x { display: none; } }`
  assert.deepEqual(tokensClaro(css), { "--a": "#111" })
  assert.deepEqual(tokensOscuro(css), { "--a": "#eee" })
  assert.deepEqual(tokensPapel(css), { "--a": "#000" })
  assert.equal(reglasDe(css).length, 5, "tres bloques de tokens, la regla suelta y la que está dentro de print")
})

test("todo var(--x) usado está definido en :root", () => {
  assert.deepEqual(varsSinDefinir(":root { --a: #111; } .x { color: var(--a); margin: var(--falta); }"), ["--falta"], "el buscador tiene que marcar un token que no existe")
  assert.deepEqual(varsSinDefinir(CSS), [], "la hoja usa tokens que :root no define (el navegador los ignora sin avisar)")
  assert.ok(Object.keys(tokensClaro(CSS)).length >= 40, "encontré muy pocos tokens en :root: no estoy leyendo la hoja")
})

test("ningún color literal fuera de los bloques de tokens", () => {
  const conDefecto = `:root { --a: #111; } :root[data-theme="dark"] { --a: #eee; }
    .a { color: #fff; } .b { background: rgba(0, 0, 0, .5); } .c { border-color: hsl(0 0% 0%); } .d { color: white; }
    @media print { :root, :root[data-theme="dark"] { --a: #000; } .e { color: #123456; } }`
  assert.equal(coloresLiteralesFuera(conDefecto).length, 5, `el buscador tiene que marcar los cinco: ${coloresLiteralesFuera(conDefecto).join(" | ")}`)
  assert.deepEqual(coloresLiteralesFuera(CSS), [], "hay colores escritos a mano en un componente: van como token")
})

test("el tema oscuro y el de impresión redefinen los mismos tokens, y todos existen en :root", () => {
  const claro = Object.keys(tokensClaro(CSS))
  const oscuro = Object.keys(tokensOscuro(CSS)).sort()
  const papel = Object.keys(tokensPapel(CSS)).sort()
  assert.ok(oscuro.length >= 20, `el tema oscuro sólo redefine ${oscuro.length} tokens: no estoy leyendo el bloque`)
  assert.deepEqual(oscuro, papel, "un token que cambia en oscuro tiene que volver a claro en el papel, y al revés")
  for (const token of oscuro) assert.ok(claro.includes(token), `${token} se redefine pero no está en :root`)
  // Los que se redefinen son los de color (y la sombra, que lleva color). Las medidas no cambian con el tema.
  for (const token of oscuro) {
    assert.match(tokensClaro(CSS)[token], /#[0-9a-f]{3,8}\b|rgba?\(/i, `${token} se redefine por tema y en :root no es un color`)
  }
})

test("sin recursos externos, fuentes bajadas ni tamaño de papel", () => {
  assert.deepEqual(recursosExternos('.a { background: url(x.png); } @import "y.css"; @font-face { } @page { }'), ["url(", "@import", "@font-face", "@page"], "el buscador tiene que marcar los cuatro")
  assert.deepEqual(recursosExternos(CSS), [], "la hoja tiene que funcionar sin red, y el papel lo define cada página")
  const tipografias = tokensClaro(CSS)
  assert.match(tipografias["--sans"], /system-ui/, "la tipografía es la del sistema")
  assert.match(tipografias["--mono"], /monospace/, "la tipografía de código cae en la del sistema")
})

test("la fórmula de contraste es la de WCAG", () => {
  assert.equal(contraste("#000", "#ffffff").toFixed(2), "21.00")
  assert.equal(contraste("#767676", "#fff").toFixed(2), "4.54", "el gris más claro que pasa AA sobre blanco")
  assert.equal(contraste("#777777", "#fff").toFixed(2), "4.48", "el siguiente ya no pasa")
})

test("todo par texto/fondo cumple contraste WCAG ≥ 4.5 en claro, en oscuro y en papel", () => {
  const malo = `:root { --t: #777777; --f: #ffffff; } :root[data-theme="dark"] { --t: #ffffff; --f: #000000; }
    .x { color: var(--t); background: var(--f); } @media print { :root, :root[data-theme="dark"] { --t: #000000; --f: #ffffff; } }`
  assert.deepEqual(paresDeclarados(malo).map((p) => [p.texto, p.fondo]), [["--t", "--f"]], "tiene que sacar del CSS el par que una regla declara completo")
  assert.equal(contrastesBajos(malo, paresDeclarados(malo)).length, 1, "y marcarlo sólo en el tema donde no llega (el claro)")

  const declarados = paresDeclarados(CSS)
  assert.ok(declarados.length >= 15, `sólo encontré ${declarados.length} reglas con color y fondo: no estoy leyendo la hoja`)
  const tabla = PARES.map(([texto, fondo]) => ({ texto, fondo }))
  assert.deepEqual(contrastesBajos(CSS, [...tabla, ...declarados]), [], "pares que no llegan a 4.5")
})

test("los avisos llevan etiqueta de texto por severidad, no sólo un borde de color", () => {
  const reglas = reglasDe(CSS)
  for (const severidad of ["info", "ok", "aviso", "error"]) {
    const etiqueta = reglas.filter((r) => r.selector === `.tb-aviso--${severidad} .tb-aviso__etiqueta`)
    assert.equal(etiqueta.length, 1, `falta el estilo de la etiqueta del aviso «${severidad}»`)
    assert.match(etiqueta[0].cuerpo, /background\s*:/, `la etiqueta de «${severidad}» no se distingue del texto`)
  }
  const conBordeLateral = reglas.filter((r) => /tb-aviso/.test(r.selector) && /border-(?:left|inline-start)/.test(r.cuerpo))
  assert.deepEqual(conBordeLateral.map((r) => r.selector), [], "un aviso no se señala con un borde lateral de color")
})

test("sólo clases con prefijo tb-, sin ids y sin nada de la vista física", () => {
  const ajeno = selectoresDe("#circuito > .zona { } .tb-ok [data-zona] { }")
  assert.deepEqual([ajeno.ids, ajeno.clases], [["circuito"], ["zona", "tb-ok"]], "el lector tiene que ver ids y clases")

  const { clases, ids } = selectoresDe(CSS)
  assert.ok(clases.length >= 40, `sólo encontré ${clases.length} clases: no estoy leyendo la hoja`)
  assert.deepEqual(clases.filter((c) => !/^tb-[a-z0-9]+(?:-[a-z0-9]+)*(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?$/.test(c)), [], "clases sin prefijo tb- o con otro formato")
  assert.deepEqual(ids, [], "la hoja compartida no estila por id")
  assert.doesNotMatch(sinComentarios(CSS), /circuito|cable|blockly|wokwi|data-zona|esquema/i, "esto es de la vista física, no de la hoja compartida")
})

test("están los componentes genéricos que las páginas van a usar", () => {
  const { clases } = selectoresDe(CSS)
  const pedidos = [
    "tb-header", "tb-nav", "tb-tarjeta", "tb-paso", "tb-chip", "tb-aviso", "tb-plegable", "tb-codigo", "tb-boton",
    "tb-tabla", "tb-lista", "tb-resumen", "tb-select", "tb-aviso--info", "tb-aviso--ok", "tb-aviso--aviso", "tb-aviso--error",
  ]
  assert.deepEqual(pedidos.filter((c) => !clases.includes(c)), [], "faltan componentes")
})

test("en papel no salen los controles, y sin animaciones si el sistema lo pide", () => {
  const reglas = reglasDe(CSS)
  const ocultas = reglas.filter((r) => esDePapel(r) && /display\s*:\s*none/.test(r.cuerpo)).map((r) => r.selector).join(", ")
  for (const clase of [".tb-nav", ".tb-boton", ".tb-solo-pantalla"]) {
    assert.ok(ocultas.split(/,\s*/).includes(clase), `${clase} tiene que ocultarse al imprimir (ocultas: ${ocultas})`)
  }
  const calmas = reglas.filter((r) => r.medio.includes("prefers-reduced-motion"))
  assert.ok(calmas.some((r) => /transition\s*:\s*none/.test(r.cuerpo)), "falta apagar las transiciones con prefers-reduced-motion")
  assert.ok(calmas.some((r) => /scroll-behavior\s*:\s*auto/.test(r.cuerpo)), "falta apagar el desplazamiento suave con prefers-reduced-motion")
})
