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
