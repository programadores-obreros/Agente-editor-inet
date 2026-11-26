// La página de la ventana «vista física» (web/index.html) después del rediseño del 2026-11-26.
//
// POR QUÉ ESTE ARCHIVO. La página pasó de una grilla de secciones sueltas a un recorrido de tres
// pasos con un resumen arriba, y de un `<style>` con su propia paleta a la hoja compartida de
// Tecnia Bot más lo que es sólo de esta ventana. Lo que se puede romper sin que nadie lo vea:
//   - un enlace de la navegación que no lleva a ningún lado;
//   - el esquema o el lienzo de bloques metidos en algo plegado: los cables se dibujan MIDIENDO
//     las piezas y Blockly se inyecta midiendo su contenedor; si miden cero no se dibuja nada;
//   - una clase `tb-*` que la hoja no tiene (el navegador la ignora sin avisar);
//   - un color escrito a mano en la página, que en el tema oscuro queda como estaba;
//   - un texto para el alumno puesto con `content:` de CSS;
//   - el servidor diciendo «mirá la sección X» con un nombre que la página ya no usa.
//
// LÍMITE HONESTO: esto lee el HTML y el CSS como TEXTO. No sabe cómo se ve la página. Cómo se ve
// se miró en Chromium real (capturas en claro y en oscuro, consola en cero); no quedó un test
// que lo repita.
//
// MUTACIONES que ponen rojo este archivo (probadas con la página ya commiteada):
//   - cambiar `href="#paso-reglas"` por `#reglas-x`                         → «la navegación…»
//   - envolver `#seccion-circuito` o `#vista-logica` en un <details>        → «el esquema y los bloques van siempre a la vista»
//   - `display: none` en `#vista-logica-lienzo`                             → «el esquema y los bloques van siempre a la vista»
//   - usar `class="tb-tarjetita"`                                           → «toda clase tb-…»
//   - `color: #b91c1c` en una regla de la página                            → «ningún color literal…»
//   - `var(--no-existe)`                                                    → «todo var()…»
//   - `content: "Atención"`                                                 → «ningún texto para el alumno va en content:»
//   - volver a «Motivos» sólo en el HTML, o sólo en el texto del servidor   → «el servidor nombra la sección como la página»
//   - bajar el contraste de `--entrada` (p. ej. `#93c5fd`)                  → «los colores propios de la ventana…»
//   - redefinir un token de papel en el tema oscuro                         → «el esquema queda claro en los dos temas»
//   - sacar `[hidden] { display: none !important }`                         → «hidden gana siempre»
//   - anidar un `:has()` dentro de otro                                     → «ningún :has() anidado»
//   - sacar `isolation: isolate` de `#vista-logica-lienzo`                  → «las barras de Blockly no se pintan encima…»
//
// Corre con: node --test tests/ventana-pagina.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"
import { cssEmbebidoDe, textoVisibleDe, reglasCss, tokensDe, COLOR_LITERAL, contraste } from "./ventana-helpers.mjs"

const WEB = join(REPO, "opencode/vista-fisica/web")
const HTML = readFileSync(join(WEB, "index.html"), "utf8")
const CUERPO = HTML.replace(/<!--[\s\S]*?-->/g, "").slice(HTML.replace(/<!--[\s\S]*?-->/g, "").indexOf("<body"))
const CSS_PAGINA = cssEmbebidoDe(HTML)
const CSS_HOJA = readFileSync(join(REPO, "opencode/tecniabot-web/diseno/sistema.css"), "utf8")
const { TODAVIA_NO_ESTA_LISTO, TODAVIA_FALTA_ARMAR } = await import(join(REPO, "opencode/vista-fisica/programa-para-vista.ts"))
const { TEXTO_QUITAR_CON_VARIAS } = await import(join(WEB, "vista-logica-ui.js"))

const posicion = (id, html = CUERPO) => {
  const partes = html.split(`id="${id}"`)
  assert.equal(partes.length, 2, `esperaba #${id} una sola vez en la página y está ${partes.length - 1}`)
  return partes[0].length
}
const idsDe = (html) => [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
/** El trozo de la página que es la <section id="…"> pedida (las secciones de la página no se anidan). */
const seccion = (id, html = CUERPO) => {
  const m = new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?</section>`).exec(html)
  assert.ok(m, `la página no tiene <section id="${id}">`)
  return m[0]
}
const textoDe = (trozo) => trozo.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()

// ════════════════════════════════════════════════════════════════════════════════════
// La estructura
// ════════════════════════════════════════════════════════════════════════════════════

test("la navegación son los tres pasos numerados, en orden, más Avisos, y cada enlace lleva a una sección que existe", () => {
  const nav = /<nav\b[^>]*data-pasos[^>]*>([\s\S]*?)<\/nav>/.exec(CUERPO)
  assert.ok(nav, "la página no tiene la navegación por pasos")
  const enlaces = [...nav[1].matchAll(/<a\b[^>]*href="#([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ destino: m[1], texto: textoDe(m[2]) }))
  assert.deepEqual(enlaces.map((e) => [e.destino, e.texto]), [
    ["paso-circuito", "1 Mirá cómo se conecta"],
    ["paso-reglas", "2 Decidí qué hace"],
    ["paso-programa", "3 Mirá el programa"],
    ["paso-avisos", "Avisos"],
  ])
  // El título de cada sección dice lo mismo que su enlace: se llega a donde se dijo que se iba.
  for (const { destino, texto } of enlaces) {
    const titulo = /<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(seccion(destino))
    assert.ok(titulo, `la sección #${destino} no tiene título`)
    assert.equal(textoDe(titulo[1]), texto.replace(/^\d+ /, ""), `el enlace dice «${texto}» y la sección se llama de otra forma`)
  }
  const posiciones = enlaces.map((e) => posicion(e.destino))
  assert.deepEqual(posiciones, [...posiciones].sort((a, b) => a - b), "las secciones están en la página en el mismo orden que en la navegación")
})

test("todo enlace interno de la página lleva a un id que existe, y ningún id está repetido", () => {
  const ids = idsDe(CUERPO)
  assert.ok(ids.length >= 25, `sólo encontré ${ids.length} ids: no estoy leyendo la página`)
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], "ids repetidos")
  const destinos = [...CUERPO.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
  assert.ok(destinos.length >= 4)
  assert.deepEqual(destinos.filter((d) => !ids.includes(d)), [], "enlaces que no llevan a ningún lado")
  for (const etiquetada of CUERPO.matchAll(/aria-labelledby="([^"]+)"/g)) assert.ok(ids.includes(etiquetada[1]), `aria-labelledby="${etiquetada[1]}" nombra un id que no existe`)
})

test("arriba de todo están las dos tarjetas del resumen, antes del primer paso", () => {
  const resumen = /<div class="resumen">([\s\S]*?)<\/div>\s*<section\b[^>]*id="paso-circuito"/.exec(CUERPO)
  assert.ok(resumen, "el resumen tiene que ser lo primero de la página, justo antes del paso 1")
  const titulos = [...resumen[1].matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => textoDe(m[1]))
  assert.deepEqual(titulos, ["Qué hace tu circuito", "Cómo está"])
  for (const id of ["resumen-reglas", "resumen-estado", "resumen-avisos", "revision"]) assert.ok(resumen[1].includes(`id="${id}"`), `falta #${id} en el resumen`)
  assert.ok(posicion("resumen-estado") < posicion("resumen-avisos") && posicion("resumen-avisos") < posicion("revision"), "en «Cómo está»: el estado, el enlace a los avisos y, al final, la revisión")
})

test("paso 1: el esquema, la leyenda, los pines y, plegada, la lista de conexiones", () => {
  const paso = seccion("paso-circuito")
  const orden = ["circuito", "leyenda-cables", "controles", "cables"].map((id) => posicion(id, paso))
  assert.deepEqual(orden, [...orden].sort((a, b) => a - b))
  const plegados = [...paso.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/g)].map((m) => m[1])
  assert.equal(plegados.length, 1, "en el paso 1 hay un solo plegable")
  assert.deepEqual(idsDe(plegados[0]), ["cables"], "lo único plegado es la lista de conexiones en texto")
  assert.match(plegados[0], /<summary>[^<]+<\/summary>/)
})

test("paso 2: primero las reglas con palabras y debajo los bloques, en la misma sección", () => {
  const paso = seccion("paso-reglas")
  const subtitulos = [...paso.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => textoDe(m[1]))
  assert.deepEqual(subtitulos, ["Con palabras", "Con bloques"])
  assert.ok(posicion("reglas", paso) < posicion("vista-logica-lienzo", paso))
  assert.ok(paso.indexOf("Con palabras") < posicion("reglas", paso) && posicion("reglas", paso) < paso.indexOf("Con bloques"), "cada subtítulo va arriba de lo suyo")
})

test("el esquema y los bloques van siempre a la vista: nunca dentro de algo plegado ni ocultos por CSS", () => {
  // Si miden cero no se dibujan: los cables se trazan midiendo las piezas, y Blockly se inyecta
  // midiendo su contenedor y no se recupera solo.
  const plegado = [...CUERPO.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/g)].flatMap((m) => idsDe(m[1]))
  for (const id of ["seccion-circuito", "circuito", "leyenda-cables", "vista-logica", "vista-logica-lienzo", "reglas", "controles", "motivos", "vista-codigo"]) {
    assert.ok(!plegado.includes(id), `#${id} quedó dentro de un <details>`)
  }
  const ocultas = reglasCss(CSS_PAGINA).filter((r) => /display\s*:\s*none|visibility\s*:\s*hidden|content-visibility/.test(r.cuerpo)).map((r) => r.selector)
  for (const selector of ocultas) {
    for (const parte of selector.split(",")) {
      assert.doesNotMatch(parte.trim(), /#(?:seccion-circuito|circuito|vista-logica|vista-logica-lienzo)(?![\w-])\s*$/, `la página oculta por CSS «${parte.trim()}»`)
    }
  }
  const altos = reglasCss(CSS_PAGINA).filter((r) => r.selector.split(",").some((s) => s.trim() === "#vista-logica-lienzo")).map((r) => r.cuerpo).join(";")
  assert.match(altos, /(?:^|[;\s])height\s*:\s*\d+px/, "el lienzo necesita un alto definitivo en px")
})

test("el orden de lectura se conserva: bloques, después el programa, después los avisos", () => {
  const orden = ["circuito", "reglas", "vista-logica-lienzo", "vista-codigo-texto", "motivos"].map((id) => posicion(id))
  assert.deepEqual(orden, [...orden].sort((a, b) => a - b))
})

// ════════════════════════════════════════════════════════════════════════════════════
// Los textos: lo que dice el servidor coincide con lo que dice la página
// ════════════════════════════════════════════════════════════════════════════════════

test("el servidor nombra la sección de avisos como la página, y «Motivos» ya no aparece en ninguno de los dos", () => {
  const titulo = textoDe(/<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(seccion("paso-avisos"))[1])
  assert.equal(titulo, "Avisos")
  assert.ok(seccion("paso-avisos").includes('id="motivos"'), "la sección que se llama así es la que tiene la lista de avisos")
  const nombrada = /«([^»]+)»/.exec(TODAVIA_NO_ESTA_LISTO)
  assert.ok(nombrada, "el texto del servidor tiene que decir en qué sección mirar")
  assert.equal(nombrada[1], titulo, "el servidor manda a una sección que la página no llama así")
  assert.doesNotMatch(textoVisibleDe(HTML), /\bMotivos\b/, "la página todavía dice «Motivos»")
  assert.doesNotMatch(`${TODAVIA_NO_ESTA_LISTO} ${TODAVIA_FALTA_ARMAR}`, /\bMotivos\b/)
})

test("el aviso de «hay más de una regla» manda a un lugar que la página tiene", () => {
  const nombrado = [...TEXTO_QUITAR_CON_VARIAS.matchAll(/«([^»]+)»/g)].map((m) => m[1])
  assert.deepEqual(nombrado, ["Quitar regla", "Con palabras"])
  const paso = seccion("paso-reglas")
  assert.ok(paso.indexOf(">Con palabras<") !== -1 && paso.indexOf(">Con palabras<") < posicion("vista-logica-lienzo", paso), "«arriba, en Con palabras»: ese subtítulo tiene que estar arriba de los bloques")
  assert.doesNotMatch(TEXTO_QUITAR_CON_VARIAS, /sección Reglas/, "la página ya no tiene una sección que se llame «Reglas»")
})

test("ningún texto para el alumno va en `content:` de CSS (no se lee, no se selecciona, no se busca)", () => {
  const conTexto = (css) => reglasCss(css).flatMap((r) => [...r.cuerpo.matchAll(/content\s*:\s*("[^"]*"|'[^']*')/g)].filter((m) => /[\p{L}\d]/u.test(m[1])).map((m) => `${r.selector} → ${m[1]}`))
  assert.deepEqual(conTexto('.a::before { content: "Atención"; } .b::before { content: ""; } .c::before { content: counter(x); }'), ['.a::before → "Atención"'], "el buscador tiene que marcar el texto y dejar pasar el adorno vacío y el contador")
  assert.deepEqual(conTexto(CSS_PAGINA), [])
  assert.deepEqual(conTexto(CSS_HOJA), [])
})

// ════════════════════════════════════════════════════════════════════════════════════
// El CSS: la hoja compartida más lo propio de la ventana
// ════════════════════════════════════════════════════════════════════════════════════

const selectoresDeLaHoja = reglasCss(CSS_HOJA).map((r) => r.selector).join(" , ")
const clasesDeLaHoja = new Set([...selectoresDeLaHoja.matchAll(/\.(tb-[\w-]+)/g)].map((m) => m[1]))

test("la página carga la hoja compartida y usa sus componentes", () => {
  assert.match(HTML.replace(/<!--[\s\S]*?-->/g, ""), /<link rel="stylesheet" href="\/assets\/sistema\.css">/)
  const usadas = new Set([...CUERPO.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith("tb-")))
  for (const clase of ["tb-header", "tb-header--fijo", "tb-marca", "tb-nav__enlace", "tb-nav__numero", "tb-chip", "tb-pagina", "tb-tarjeta", "tb-paso", "tb-paso__numero", "tb-subtitulo", "tb-rotulo", "tb-plegable", "tb-codigo", "tb-codigo__texto", "tb-boton"]) {
    assert.ok(usadas.has(clase), `la página no usa ${clase}: ¿volvió a traer su propio estilo para eso?`)
  }
})

test("toda clase tb- que usan la página y sus JS existe en la hoja compartida", () => {
  assert.ok(clasesDeLaHoja.size >= 40, "no estoy leyendo la hoja")
  const enHtml = [...CUERPO.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/))
  const enJs = readdirSync(WEB).filter((f) => f.endsWith(".js")).flatMap((f) => [...readFileSync(join(WEB, f), "utf8").matchAll(/["'`]([^"'`\n]*\btb-[^"'`\n]*)["'`]/g)].flatMap((m) => m[1].split(/[\s.]+/)))
  const enCss = [...reglasCss(CSS_PAGINA).map((r) => r.selector).join(" ").matchAll(/\.(tb-[\w-]+)/g)].map((m) => m[1])
  const usadas = [...new Set([...enHtml, ...enJs, ...enCss].filter((c) => /^tb-/.test(c)))]
  assert.ok(usadas.length >= 20, `sólo encontré ${usadas.length} clases tb-: no estoy leyendo la página`)
  assert.ok(enJs.some((c) => c === "tb-aviso__etiqueta"), "no estoy leyendo las clases que pone pintar.js")
  assert.deepEqual(usadas.filter((c) => !clasesDeLaHoja.has(c)).sort(), [], "clases tb- que la hoja no tiene: el navegador las ignora sin avisar")
})

test("los selectores y campos de la ventana no usan tb-select: esa clase no se imprime, y acá el valor elegido se lee en el papel", () => {
  const ocultasEnPapel = reglasCss(CSS_HOJA).filter((r) => r.medio.includes("print") && /display\s*:\s*none/.test(r.cuerpo)).map((r) => r.selector).join(", ")
  assert.match(ocultasEnPapel, /\.tb-select\b/, "precondición: la hoja oculta .tb-select al imprimir")
  for (const f of readdirSync(WEB).filter((x) => x.endsWith(".js"))) assert.doesNotMatch(readFileSync(join(WEB, f), "utf8"), /tb-select/, `${f} le pone tb-select a un control: la frase de la regla saldría impresa con huecos`)
  assert.doesNotMatch(CUERPO, /tb-select/)
})

const tokensDeLaHoja = tokensDe(reglasCss(CSS_HOJA).find((r) => r.medio === "" && r.selector === ":root").cuerpo)
const bloquesDeTokens = reglasCss(CSS_PAGINA).filter((r) => r.medio === "" && r.selector === ":root")
const tokensDeLaPagina = tokensDe(bloquesDeTokens.map((r) => r.cuerpo).join(";"))

test("todo var(--x) que usa la página está definido, en la hoja o en los tokens de la ventana", () => {
  assert.equal(bloquesDeTokens.length, 1, "la página tiene un solo bloque de tokens propios")
  assert.ok(Object.keys(tokensDeLaPagina).length >= 15, "no estoy leyendo los tokens de la ventana")
  const repetidos = Object.keys(tokensDeLaPagina).filter((t) => t in tokensDeLaHoja)
  assert.deepEqual(repetidos, [], "la ventana redefine un token de la hoja compartida: si hace falta otro valor, va con otro nombre")
  const usados = [...new Set([...CSS_PAGINA.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]))]
  assert.ok(usados.length >= 30)
  assert.deepEqual(usados.filter((t) => !(t in tokensDeLaHoja) && !(t in tokensDeLaPagina)).sort(), [], "tokens que nadie define (el navegador los ignora sin avisar)")
})

test("ningún color literal en la página fuera de su bloque de tokens", () => {
  const fuera = (css) => reglasCss(css).filter((r) => !(r.medio === "" && r.selector === ":root")).flatMap((r) => [...r.cuerpo.matchAll(COLOR_LITERAL)].map((m) => `${r.selector} → ${m[0]}`))
  assert.equal(fuera(":root { --a: #111; } .x { color: #fff; } .y { background: rgba(0,0,0,.5); } @media print { .z { color: black; } }").length, 3, "el buscador tiene que marcar los tres")
  assert.deepEqual(fuera(CSS_PAGINA), [], "colores escritos a mano en la página: van como token")
  assert.doesNotMatch(CUERPO, /\bstyle="/, "y tampoco como estilo en línea en una etiqueta")
})

test("el esquema queda claro en los dos temas: sus colores no los redefine nadie, y la zona de papel los usa", () => {
  const redefinidos = reglasCss(CSS_PAGINA).filter((r) => /data-theme/.test(r.selector) || /prefers-color-scheme/.test(r.medio))
  assert.deepEqual(redefinidos.map((r) => r.selector), [], "la página no cambia nada propio según el tema: lo que es papel es papel siempre")
  const papel = reglasCss(CSS_PAGINA).find((r) => r.selector.includes("#circuito > [data-esquema]") && r.selector.includes("#vista-logica-lienzo") && /color-scheme\s*:\s*light/.test(r.cuerpo))
  assert.ok(papel, "falta la regla que deja en claro el esquema y el lienzo de bloques")
  const reasignados = tokensDe(papel.cuerpo)
  for (const token of ["--tinta", "--tinta-2", "--linea", "--sup"]) assert.match(reasignados[token] ?? "", /^var\(--papel-[a-z0-9-]+\)$/, `${token} tiene que tomar su valor de papel dentro del esquema`)
  for (const valor of Object.values(reasignados)) assert.ok(valor.slice(4, -1) in tokensDeLaPagina, `${valor} no está entre los tokens de la ventana`)
})

test("los colores propios de la ventana cumplen contraste: texto ≥ 4.5 y trazos ≥ 3 sobre su fondo", () => {
  const t = tokensDeLaPagina
  const texto = [
    ["--papel-tinta", "--papel"], ["--papel-tinta-2", "--papel"], ["--papel-tinta", "--papel-sup"],
    ["--entrada", "--entrada-f"], ["--salida", "--salida-f"], ["--ctrl", "--papel"],
    ["--papel-tinta-2", "--entrada-f"], ["--papel-tinta-2", "--salida-f"], ["--papel-tinta", "--entrada-f"], ["--papel-tinta", "--salida-f"],
    ["--papel-aviso", "--papel-aviso-f"],
  ]
  const trazos = [..."01234"].map((n) => [`--cable-${n}`, "--papel"]).concat([["--cable-tierra", "--papel"], ["--cable-alimentacion", "--papel"], ["--entrada", "--papel"], ["--salida", "--papel"], ["--papel-linea-control", "--papel"]])
  const bajos = []
  for (const [pares, minimo] of [[texto, 4.5], [trazos, 3]]) {
    for (const [a, b] of pares) {
      assert.ok(t[a] && t[b], `el par ${a} / ${b} nombra un token que la ventana no tiene`)
      const ratio = contraste(t[a], t[b])
      if (ratio < minimo) bajos.push(`${a} (${t[a]}) sobre ${b} (${t[b]}) da ${ratio.toFixed(2)}, mínimo ${minimo}`)
    }
  }
  assert.deepEqual(bajos, [])
  assert.equal(contraste("#767676", "#fff").toFixed(2), "4.54", "la fórmula es la de WCAG")
})

// Pasó escribiendo esta página (2026-11-26): para no mostrar un subtítulo sin nada debajo se
// escribió `.x:has(+ #controles:not(:has(label)))`. Un `:has()` adentro de otro no es CSS válido,
// y el navegador descarta la regla ENTERA sin avisar: en la captura el subtítulo seguía ahí.
test("ningún :has() anidado: el navegador descarta la regla entera sin avisar", () => {
  const anidados = (css) => reglasCss(css).map((r) => r.selector).filter((selector) => {
    let hondo = 0
    const pila = []
    for (let i = 0; i < selector.length; i++) {
      if (selector[i] === "(") {
        const esHas = selector.slice(0, i).endsWith(":has")
        if (esHas && pila.includes(true)) return true
        pila.push(esHas)
        hondo++
      } else if (selector[i] === ")") {
        pila.pop()
        hondo--
      }
    }
    return false
  })
  assert.deepEqual(anidados(".a:has(+ .b:not(:has(i))) { } .c:not(:has(i)) { } .d:has(.e):has(.f) { }"), [".a:has(+ .b:not(:has(i)))"], "el buscador marca el anidado y deja pasar los que van uno al lado del otro")
  assert.deepEqual(anidados(CSS_PAGINA), [])
  assert.deepEqual(anidados(CSS_HOJA), [])
})

test("hidden gana siempre: un chip oculto no se muestra por tener display propio", () => {
  const regla = reglasCss(CSS_PAGINA).find((r) => r.selector === "[hidden]")
  assert.ok(regla, "falta la regla [hidden]")
  assert.match(regla.cuerpo, /display\s*:\s*none\s*!important/, "sin !important, `.tb-chip { display: inline-flex }` deja a la vista el contador de avisos en cero")
})

test("las barras de Blockly no se pintan encima del header fijo: el lienzo es su propio contexto de apilado", () => {
  // Precondiciones: el choque existe. Blockly pone sus barras en z-index 20 y el header fijo también.
  const blockly = readFileSync(join(REPO, "opencode/tecniabot-web/blockly_compressed.js"), "utf8")
  assert.match(blockly, /\.blocklyMainWorkspaceScrollbar \{\s*z-index: 20;/, "precondición: el Blockly vendorizado trae sus barras en z-index 20")
  const header = reglasCss(CSS_HOJA).find((r) => r.selector === ".tb-header--fijo" && r.medio === "")
  assert.match(header?.cuerpo ?? "", /z-index\s*:\s*20\b/, "precondición: el header fijo está en z-index 20")
  // Sin aislar, las barras vienen después en la página y ganan el empate (visto en Chromium).
  const lienzo = reglasCss(CSS_PAGINA).filter((r) => r.selector === "#vista-logica-lienzo" && r.medio === "")
  assert.ok(lienzo.some((r) => /isolation\s*:\s*isolate/.test(r.cuerpo)), "#vista-logica-lienzo tiene que llevar `isolation: isolate`")
})
