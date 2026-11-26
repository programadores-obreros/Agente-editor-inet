// Navegación de la ventana (rediseño del 2026-11-26): cuál de las secciones es «la que se está
// leyendo», para marcar su enlace en el header fijo.
//
// Dos partes, separadas a propósito:
//   - `franjaDeLectura` y `seccionActiva` son PURAS: reciben medidas y devuelven una decisión. Se
//     prueban en Node (`tests/ventana-navegacion.test.mjs`) sin navegador ni documento.
//   - `conectarNavegacion` es el cableado: mide las secciones de la página real y le pasa las
//     medidas a las de arriba. El `IntersectionObserver` sólo avisa CUÁNDO volver a medir; no
//     decide nada. Sólo corre en el navegador.
//
// No toca el proyecto ni la red: es presentación.

/**
 * La franja de la ventana donde se considera que algo «se está leyendo»: desde justo debajo del
 * header fijo hasta un poco antes de la mitad de la ventana.
 * @param {{ altoCabecera: number, altoVentana: number }} medidas
 * @returns {{ desde: number, hasta: number }} en píxeles desde el borde de arriba de la ventana.
 */
export function franjaDeLectura({ altoCabecera, altoVentana }) {
  const desde = Math.max(0, altoCabecera) + 8
  // Nunca invertida: con un header muy alto (se parte en varios renglones cuando avisa que se
  // desconectó) y una ventana baja, la franja queda fina pero sigue existiendo.
  return { desde, hasta: Math.max(desde + 1, altoVentana * 0.45) }
}

/**
 * La sección activa, o `null` si ninguna está en la franja (arriba de todo se lee el resumen, que
 * no es un paso).
 *
 * Regla: la PRIMERA sección, en el orden de la página, que cruza la franja de lectura. Una
 * excepción: la última sección suele ser corta y queda al pie de la ventana, sin llegar nunca a la
 * franja por más que se baje. Si ya se bajó algo, está entera a la vista y lo que queda por bajar
 * no alcanza para llevarla a la franja, la activa es ella. Sin esa excepción, tocar «Avisos»
 * dejaba marcado «Mirá el programa».
 *
 * @param {readonly { id: string, arriba: number, abajo: number }[]} secciones - en el orden de la
 *   página; `arriba`/`abajo` medidos desde el borde de arriba de la ventana (como `getBoundingClientRect`).
 * @param {{ desde: number, hasta: number, altoVentana: number, desplazado?: number, resto?: number }} ventana -
 *   la franja, el alto de la ventana, cuánto se bajó ya (`desplazado`) y cuánto queda por bajar (`resto`).
 * @returns {string | null}
 */
export function seccionActiva(secciones, { desde, hasta, altoVentana, desplazado = 0, resto = Infinity }) {
  const ultima = secciones.at(-1)
  if (ultima && desplazado > 0 && ultima.arriba >= hasta && ultima.abajo <= altoVentana && ultima.arriba - hasta > resto) return ultima.id
  const enFranja = secciones.find((seccion) => seccion.arriba < hasta && seccion.abajo > desde)
  return enFranja ? enFranja.id : null
}

/**
 * Cableado en el navegador. Los enlaces son los de `nav[data-pasos]` que apuntan a un `#id`; las
 * secciones, los elementos con esos ids. Marca el enlace activo con `aria-current="true"` (que es
 * además lo que lee un lector de pantalla) y deja el alto real del header en `--alto-cabecera`,
 * para que al saltar a una sección su título no quede tapado.
 *
 * Sin `IntersectionObserver` (o sin navegación en la página) no hace nada: los enlaces siguen
 * funcionando, sólo que ninguno queda marcado.
 */
export function conectarNavegacion(doc, ventana) {
  const nav = doc.querySelector("nav[data-pasos]")
  const cabecera = doc.querySelector("header")
  if (!nav || !cabecera || typeof ventana.IntersectionObserver !== "function") return null
  const enlaces = new Map([...nav.querySelectorAll('a[href^="#"]')].map((enlace) => [enlace.getAttribute("href").slice(1), enlace]))
  const secciones = [...enlaces.keys()].map((id) => doc.getElementById(id)).filter((seccion) => seccion !== null)

  // Con el header fijo, su alto tapa la parte de arriba de la ventana; en pantallas angostas deja
  // de ser fijo y se va con la página: ahí sólo tapa lo que todavía se ve de él.
  const altoQueTapa = () => Math.max(0, cabecera.getBoundingClientRect().bottom)
  const franja = () => franjaDeLectura({ altoCabecera: altoQueTapa(), altoVentana: ventana.innerHeight })

  function marcar() {
    const medidas = secciones.map((seccion) => {
      const caja = seccion.getBoundingClientRect()
      return { id: seccion.id, arriba: caja.top, abajo: caja.bottom }
    })
    const activa = seccionActiva(medidas, {
      ...franja(),
      altoVentana: ventana.innerHeight,
      desplazado: ventana.scrollY,
      resto: doc.documentElement.scrollHeight - (ventana.scrollY + ventana.innerHeight),
    })
    for (const [id, enlace] of enlaces) {
      if (id === activa) enlace.setAttribute("aria-current", "true")
      else enlace.removeAttribute("aria-current")
    }
    return activa
  }

  let observadores = []
  function observar() {
    for (const observador of observadores) observador.disconnect()
    const { desde, hasta } = franja()
    // Uno avisa cuando una sección entra o sale de la franja; el otro, cuando la última queda (o
    // deja de quedar) entera a la vista, que es cuando puede valer la excepción del pie.
    const deFranja = new ventana.IntersectionObserver(marcar, { rootMargin: `-${Math.round(desde)}px 0px -${Math.max(0, Math.round(ventana.innerHeight - hasta))}px 0px`, threshold: 0 })
    const deLaUltima = new ventana.IntersectionObserver(marcar, { threshold: [0, 1] })
    for (const seccion of secciones) deFranja.observe(seccion)
    if (secciones.length > 0) deLaUltima.observe(secciones.at(-1))
    observadores = [deFranja, deLaUltima]
  }

  function medir() {
    doc.documentElement.style.setProperty("--alto-cabecera", `${Math.ceil(cabecera.getBoundingClientRect().height)}px`)
    observar()
    marcar()
  }
  if (typeof ventana.ResizeObserver === "function") new ventana.ResizeObserver(medir).observe(cabecera)
  ventana.addEventListener("resize", medir)
  medir()
  return { marcar }
}
