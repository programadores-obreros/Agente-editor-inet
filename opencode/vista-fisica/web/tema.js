// Tema claro / oscuro de la ventana (rediseño del 2026-11-26).
//
// Dos partes, separadas a propósito:
//   - `temaInicial` y `temaSiguiente` son PURAS y se prueban en Node (`tests/ventana-tema.test.mjs`).
//   - `conectarTema` es el cableado del botón; sólo corre en el navegador.
//
// El tema es un atributo de la raíz: `data-theme="dark"` para el oscuro, y SIN atributo para el
// claro (así lo espera la hoja compartida, `sistema.css`). El esquema, la leyenda y el lienzo de
// bloques quedan claros en los dos temas: eso es de `index.html`, no de acá.
//
// QUIÉN LO APLICA PRIMERO. Este módulo se carga diferido (`type="module"`), cuando la página ya
// se pintó una vez: si el tema lo pusiera él, quien eligió oscuro vería un destello en claro en
// cada carga. Por eso hay un script clásico chico, `tema-inicial.js`, en el <head>, que lo aplica
// antes del primer pintado con LA MISMA regla que `temaInicial` (que digan lo mismo lo prueba el
// test, ejecutando los dos). No puede ser un script escrito en la página: la política de seguridad
// (`script-src 'self'`) lo prohíbe, y no se relajó.
//
// LÍMITE CONOCIDO, SIN RESOLVER A PROPÓSITO: la preferencia se guarda en `localStorage`, que es
// por origen, y el servidor de la vista abre en un puerto distinto cada vez que arranca. Un puerto
// distinto es otro origen: lo elegido vale mientras dure esa sesión de Tecnia Bot (aguanta
// recargar la página) y NO se recuerda en la siguiente. Entre sesiones manda la preferencia del
// sistema. Arreglarlo con un puerto fijo es una decisión pendiente del dueño (cambia cómo conviven
// dos proyectos abiertos y qué pasa si el puerto está ocupado): no se toca acá.

/** La clave de `localStorage`. `tema-inicial.js` usa la misma (lo comprueba el test). */
export const CLAVE_DE_TEMA = "tecnia-tema"

/**
 * El tema con el que arranca la página: la preferencia guardada si es válida; si no, la del sistema.
 * @param {{ guardado: string | null | undefined, sistemaOscuro: boolean }} entrada
 * @returns {"dark" | "light"}
 */
export function temaInicial({ guardado, sistemaOscuro }) {
  if (guardado === "dark" || guardado === "light") return guardado
  return sistemaOscuro ? "dark" : "light"
}

/** El tema al que pasa el botón. */
export function temaSiguiente(actual) {
  return actual === "dark" ? "light" : "dark"
}

/**
 * Cableado del botón de tema. Los dos textos del botón están en la página (`data-texto-oscuro`,
 * `data-texto-claro`): acá no se escribe ninguno. Si `localStorage` no está o tira (modo privado,
 * almacenamiento bloqueado), el botón funciona igual; sólo no se recuerda.
 */
export function conectarTema(doc, ventana) {
  const raiz = doc.documentElement
  const boton = doc.getElementById("boton-tema")
  const leerGuardado = () => {
    try {
      return ventana.localStorage.getItem(CLAVE_DE_TEMA)
    } catch {
      return null
    }
  }
  const sistemaOscuro = () => {
    try {
      return typeof ventana.matchMedia === "function" && ventana.matchMedia("(prefers-color-scheme: dark)").matches === true
    } catch {
      return false
    }
  }
  const actual = () => (raiz.getAttribute("data-theme") === "dark" ? "dark" : "light")

  function aplicar(tema) {
    if (tema === "dark") raiz.setAttribute("data-theme", "dark")
    else raiz.removeAttribute("data-theme")
    if (!boton) return
    // El botón dice a qué tema lleva, y `aria-pressed` dice si el oscuro está puesto.
    boton.textContent = boton.getAttribute(tema === "dark" ? "data-texto-claro" : "data-texto-oscuro") ?? boton.textContent
    boton.setAttribute("aria-pressed", String(tema === "dark"))
  }

  // `tema-inicial.js` ya lo aplicó antes del primer pintado; se vuelve a aplicar acá (da lo mismo)
  // para dejar el botón de acuerdo y para que la página tenga tema aunque ese script faltara.
  aplicar(temaInicial({ guardado: leerGuardado(), sistemaOscuro: sistemaOscuro() }))

  if (boton && typeof boton.addEventListener === "function") {
    boton.addEventListener("click", () => {
      const nuevo = temaSiguiente(actual())
      aplicar(nuevo)
      try {
        ventana.localStorage.setItem(CLAVE_DE_TEMA, nuevo)
      } catch {
        /* no se pudo guardar la preferencia: el tema queda puesto igual, por esta carga */
      }
    })
  }
  return { actual }
}
