// Imprimir la ventana, o guardarla como PDF (rediseño del 2026-11-26).
//
// POR QUÉ HACE FALTA CÓDIGO Y NO ALCANZA CON CSS. Los cables del esquema son un dibujo puesto
// ENCIMA de las piezas, con las coordenadas que tenían las piezas en pantalla cuando se midieron
// (`cableado.js`). En el papel la página es más angosta: si el esquema se reacomodara a ese ancho,
// las piezas cambiarían de lugar y los cables quedarían apuntando a donde ya no hay un pin. Por
// eso, antes de imprimir, al esquema se le FIJA el ancho que tiene en pantalla y se lo achica
// ENTERO (piezas y cables juntos, con `zoom`) hasta que entre en la hoja. Y se abre lo que está
// plegado, que en el papel no se puede desplegar.
//
// `escalaParaLaHoja` es pura. `prepararParaImprimir` recibe el documento y devuelve cómo dejar todo
// como estaba: se prueba en Node con un documento falso (`tests/ventana-impresion.test.mjs`).
// `conectarImpresion` es el cableado de los eventos del navegador y del botón.

/**
 * El ancho útil de la hoja, en píxeles de CSS. Sale de la hoja que declara `index.html`
 * (`@page { size: A4 landscape; margin: 1.2cm }`): 297 mm − 2 × 12 mm = 273 mm ≈ 1031 px, menos
 * el relleno y el borde de la tarjeta que contiene al esquema (34 px) y un resto de holgura. Que
 * este número entre de verdad en esa hoja lo comprueba el test leyendo el CSS.
 */
export const ANCHO_UTIL_DE_LA_HOJA = 990

/** Por cuánto hay que multiplicar el esquema para que entre en la hoja. Nunca lo agranda. */
export function escalaParaLaHoja(anchoDelEsquema, anchoDeLaHoja = ANCHO_UTIL_DE_LA_HOJA) {
  if (!(anchoDelEsquema > 0) || !(anchoDeLaHoja > 0)) return 1
  return Math.min(1, anchoDeLaHoja / anchoDelEsquema)
}

/**
 * Deja el documento listo para el papel y devuelve la función que lo deja como estaba.
 *  - Abre los `<details>` cerrados (y sólo ésos se vuelven a cerrar después).
 *  - Si hay esquema dibujado (`#circuito` con su primer hijo midiendo algo), le fija su ancho de
 *    pantalla, le impide estirarse o encogerse, y achica `#circuito` entero con `zoom`.
 * Un esquema que mide cero (no hay, o no se ve) no se toca: no hay nada que conservar.
 * @returns {() => void} restaurar; llamarla dos veces no rompe nada.
 */
export function prepararParaImprimir(doc) {
  const plegados = [...doc.querySelectorAll("details:not([open])")]
  for (const plegado of plegados) plegado.open = true

  const circuito = doc.getElementById("circuito")
  const esquema = circuito?.firstElementChild ?? null
  let previo = null
  if (esquema && esquema.offsetWidth > 0) {
    const ancho = esquema.offsetWidth
    previo = { width: esquema.style.width, flex: esquema.style.flex, zoom: circuito.style.zoom }
    esquema.style.width = `${ancho}px`
    esquema.style.flex = "none"
    circuito.style.zoom = String(escalaParaLaHoja(ancho))
  }

  let restaurado = false
  return function restaurar() {
    if (restaurado) return
    restaurado = true
    for (const plegado of plegados) plegado.open = false
    if (previo) {
      esquema.style.width = previo.width
      esquema.style.flex = previo.flex
      circuito.style.zoom = previo.zoom
    }
  }
}

/**
 * Cableado en el navegador: prepara al empezar a imprimir (`beforeprint`), restaura al terminar
 * (`afterprint`), y el botón «Imprimir / PDF» abre el diálogo de impresión.
 *
 * `alEmpezar` / `alTerminar` son para quien dibuja los cables: mientras el esquema está achicado
 * para el papel NO hay que volver a medirlo (mediría las piezas achicadas y dibujaría dentro de
 * un contenedor que las achica otra vez). `app.js` los usa para pausar ese redibujo.
 */
export function conectarImpresion(doc, ventana, { alEmpezar = () => {}, alTerminar = () => {} } = {}) {
  let restaurar = null
  ventana.addEventListener("beforeprint", () => {
    // Dos `beforeprint` seguidos sin un `afterprint` en el medio: ya está preparado. Prepararlo de
    // nuevo guardaría como «lo de antes» el estado ya achicado, y no habría cómo volver.
    if (restaurar !== null) return
    alEmpezar()
    restaurar = prepararParaImprimir(doc)
  })
  ventana.addEventListener("afterprint", () => {
    if (restaurar === null) return
    restaurar()
    restaurar = null
    alTerminar()
  })
  const boton = doc.getElementById("boton-imprimir")
  if (boton && typeof boton.addEventListener === "function") boton.addEventListener("click", () => ventana.print())
}
