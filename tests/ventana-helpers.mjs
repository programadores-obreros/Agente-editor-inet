// Ayudantes compartidos de las pruebas de la ventana «vista física» (rediseño del 2026-11-26).
//
// NO es `*.test.mjs`: el glob de `pnpm test` no lo corre; lo importan las pruebas que miran qué
// recursos pide la página (`ventana-hoja`, `phase2-transporte-http`, `phase3-blockly-assets`,
// `phase3-blockly-panel`). Está en un solo lugar para que «qué cuenta como hoja de estilos
// permitida» no se defina tres veces de tres formas.
//
// Lee TEXTO, no un DOM: alcanza para una página escrita a mano, de la que conocemos la forma.
// Los comentarios HTML se sacan antes (un `<link>` dentro de un comentario no carga nada).

const sinComentariosHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, "")
const atributo = (etiqueta, nombre) => new RegExp(`\\b${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(etiqueta)?.slice(1).find((v) => v !== undefined) ?? null

/** Lo que la página le pide al servidor al cargar: `<script src>` y `<link rel="stylesheet" href>`. */
export function recursosDe(html) {
  const limpio = sinComentariosHtml(html)
  const scripts = [...limpio.matchAll(/<script\b[^>]*>/gi)].map((m) => atributo(m[0], "src")).filter((src) => src !== null)
  const hojas = [...limpio.matchAll(/<link\b[^>]*>/gi)].filter((m) => /\bstylesheet\b/i.test(atributo(m[0], "rel") ?? "")).map((m) => atributo(m[0], "href"))
  return { scripts, hojas }
}

/**
 * Las hojas de estilos que la página carga y NO debería. La única forma permitida es
 * `href="/assets/<nombre>"` con `<nombre>` en la lista blanca del servidor y terminado en `.css`.
 * Todo lo demás se marca: otra máquina (`https://…`, `//cdn…`), una ruta que no es de `/assets/`,
 * un nombre que el servidor no sirve, un `<link>` sin `href`, y un `@import` dentro de un `<style>`
 * (que es la otra forma de traer una hoja de afuera).
 */
export function hojasNoPermitidas(html, nombresEnListaBlanca) {
  const permitidos = new Set(nombresEnListaBlanca)
  const problemas = []
  for (const href of recursosDe(html).hojas) {
    if (href === null) problemas.push("<link rel=stylesheet> sin href")
    else if (!href.startsWith("/assets/") || href.startsWith("//")) problemas.push(`${href}: no es una hoja de este servidor`)
    else if (!permitidos.has(href.slice("/assets/".length))) problemas.push(`${href}: no está en la lista blanca del servidor`)
    else if (!href.endsWith(".css")) problemas.push(`${href}: no es una hoja de estilos`)
  }
  for (const estilo of sinComentariosHtml(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (/@import\b/i.test(estilo[1].replace(/\/\*[\s\S]*?\*\//g, ""))) problemas.push("@import dentro de un <style>")
  }
  return problemas
}

// ── La página y su CSS, leídos como texto ──────────────────────────────────────────────────────

/** El CSS que la página trae escrito adentro (todos sus `<style>`), sin comentarios. */
export function cssEmbebidoDe(html) {
  return [...sinComentariosHtml(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n").replace(/\/\*[\s\S]*?\*\//g, "")
}

/** Lo que se LEE de la página tal como viene del servidor: sin comentarios, estilos, scripts ni etiquetas. */
export function textoVisibleDe(html) {
  return sinComentariosHtml(html)
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Reglas de un CSS: [{ medio, selector, cuerpo }]. `medio` es "" o el encabezado del `@media` (o
 * `@page`, `@supports`) que la contiene. Mismo lector que usa `tests/sistema-diseno.test.mjs`
 * para la hoja compartida: se repite acá, y no se comparte, para no tocar ese test.
 */
export function reglasCss(css, medio = "") {
  const texto = css.replace(/\/\*[\s\S]*?\*\//g, "")
  const reglas = []
  let i = 0
  while (i < texto.length) {
    const abre = texto.indexOf("{", i)
    if (abre === -1) break
    const selector = texto.slice(i, abre).trim().replace(/\s+/g, " ")
    let hondo = 1
    let j = abre + 1
    while (j < texto.length && hondo > 0) {
      if (texto[j] === "{") hondo++
      else if (texto[j] === "}") hondo--
      j++
    }
    if (hondo !== 0) throw new Error(`llaves sin cerrar después de «${selector}»`)
    const cuerpo = texto.slice(abre + 1, j - 1)
    if (selector.startsWith("@media") || selector.startsWith("@supports")) reglas.push(...reglasCss(cuerpo, selector))
    else reglas.push({ medio, selector, cuerpo })
    i = j
  }
  return reglas
}

/** Las propiedades personalizadas declaradas en un cuerpo: { "--x": "valor" }. */
export function tokensDe(cuerpo) {
  const tokens = {}
  for (const m of cuerpo.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim()
  return tokens
}

export const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|:\s*(?:white|black|red|green|blue|yellow|orange|purple|gray|grey|silver|navy|teal)\b/gi

function luminancia(hex) {
  const limpio = hex.trim().replace(/^#/, "")
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(limpio)) throw new Error(`«${hex}» no es un color hexadecimal de 3 o 6 cifras`)
  const largo = limpio.length === 3 ? [...limpio].map((c) => c + c).join("") : limpio
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(largo.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contraste WCAG 2.x entre dos colores hexadecimales. */
export function contraste(a, b) {
  const [clara, oscura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (clara + 0.05) / (oscura + 0.05)
}
