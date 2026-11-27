// El programa, renglón por renglón (2026-11-26).
//
// `vista-codigo.js` pone el programa en la página como UN texto. Para marcar «estas líneas son de
// esta regla» y para saber qué línea se tocó, hace falta un elemento por línea. Este módulo toma
// el texto que ya está puesto y lo reparte en renglones, sin cambiarle una letra: lo que se lee
// (y lo que se copia) sigue siendo, byte a byte, el programa que mandó el servidor.
//
// No sabe qué línea es de qué: recibe un tramo y lo marca. No pide nada por la red. El documento
// y el elemento se inyectan, así que se prueba en Node.
//
// La marca no depende sólo del color: el renglón marcado lleva `data-marcada` (la hoja le pone
// fondo Y una barra al costado) y `aria-current`, que es lo que anuncia un lector de pantalla.

/** Las líneas de un texto, cada una con su salto si lo tenía. Unidas dan el texto EXACTO. */
export function renglonesDe(codigo) {
  if (typeof codigo !== "string" || codigo === "") return []
  const partes = codigo.split("\n")
  const ultimo = partes.pop()
  const renglones = partes.map((parte) => `${parte}\n`)
  // Lo que queda después del último salto: si el texto termina en salto, no es una línea más.
  if (ultimo !== "") renglones.push(ultimo)
  return renglones
}

/**
 * @param {{ doc: { createElement: Function }, elementoCodigo: object }} dependencias
 *   `elementoCodigo` es el mismo elemento en el que `vista-codigo.js` escribe el programa.
 */
export function crearCodigoPorLineas({ doc, elementoCodigo }) {
  /** Los renglones que están puestos, en orden (el de la línea 1 es el `[0]`). */
  let renglones = []
  /** El texto del que salieron: si el panel escribió otro (o lo borró), ya no valen. */
  let textoRepartido = null
  let marcado = null
  /** La línea en la que está el cursor del teclado (la última tocada o recorrida), o `null`. */
  let cursor = null

  function ponerCursor(numero) {
    if (cursor !== null) renglones[cursor - 1]?.removeAttribute("data-cursor")
    cursor = numero
    if (cursor !== null) renglones[cursor - 1]?.setAttribute("data-cursor", "")
  }

  const vigentes = () => textoRepartido !== null && elementoCodigo.textContent === textoRepartido

  function desmarcarTodo() {
    for (const renglon of renglones) {
      renglon.removeAttribute("data-marcada")
      renglon.removeAttribute("aria-current")
    }
    marcado = null
  }

  return {
    /**
     * Reparte en renglones el programa que el panel ya puso. Si es el mismo texto de la vez
     * anterior, no toca nada (se conserva lo marcado). Devuelve cuántas líneas quedaron.
     */
    repartir() {
      if (vigentes()) return renglones.length
      const codigo = elementoCodigo.textContent
      const textos = renglonesDe(codigo)
      renglones = []
      textoRepartido = null
      marcado = null
      cursor = null
      if (textos.length === 0) return 0
      const nuevos = textos.map((texto, i) => {
        const renglon = doc.createElement("span")
        // Clase de ESTA ventana (se estila en `index.html`), no de la hoja compartida: por eso no lleva su prefijo.
        renglon.className = "linea-de-codigo"
        renglon.setAttribute("data-linea", String(i + 1))
        renglon.textContent = texto
        return renglon
      })
      elementoCodigo.replaceChildren(...nuevos)
      // Lo que quedó escrito tiene que ser lo que había. Si no lo es, se vuelve al texto entero:
      // un programa con una línea de menos, a la vista, es peor que un programa sin renglones.
      if (elementoCodigo.textContent !== codigo) {
        elementoCodigo.textContent = codigo
        return 0
      }
      renglones = nuevos
      textoRepartido = codigo
      return renglones.length
    },

    /**
     * Marca las líneas de un tramo (`{ desde, hasta }`, desde 1, los dos incluidos) y desmarca
     * las demás; con `null` no queda ninguna. Un tramo que no entra entero en el programa que
     * está a la vista no se marca: devuelve `false` y deja todo sin marcar.
     */
    marcar(rango) {
      if (!vigentes()) {
        renglones = []
        textoRepartido = null
        marcado = null
        return false
      }
      desmarcarTodo()
      if (!rango) return false
      const { desde, hasta } = rango
      if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde < 1 || hasta < desde || hasta > renglones.length) return false
      for (let numero = desde; numero <= hasta; numero++) {
        const renglon = renglones[numero - 1]
        renglon.setAttribute("data-marcada", "")
        // Para quien no ve el color ni la barra: el primer renglón del tramo queda anunciado.
        if (numero === desde) renglon.setAttribute("aria-current", "true")
      }
      marcado = { desde, hasta }
      return true
    },

    /** El tramo marcado ahora, o `null`. */
    marcado: () => (vigentes() && marcado ? { ...marcado } : null),

    /** El primer renglón del tramo marcado (para llevarlo a la vista), o `null`. */
    primerRenglonMarcado: () => (vigentes() && marcado ? renglones[marcado.desde - 1] : null),

    /**
     * El número de la línea a la que pertenece lo que se tocó (el elemento del evento), o `null`
     * si se tocó otra cosa (el margen, la barra) o si los renglones ya no son los del programa.
     */
    lineaDe(elemento) {
      if (!vigentes()) return null
      for (let actual = elemento; actual && actual !== elementoCodigo; actual = actual.parentNode ?? null) {
        const indice = renglones.indexOf(actual)
        if (indice >= 0) {
          ponerCursor(indice + 1)
          return indice + 1
        }
      }
      return null
    },

    /**
     * La línea vecina a la del cursor, para recorrer el código con las flechas (`paso`: +1 abajo,
     * -1 arriba), o `null` si no hay renglones. Sin cursor todavía, arranca por la primera (o la
     * última, yendo hacia arriba). No pasa de los extremos. Sin esto, sin mouse no había forma de
     * tocar una línea: las líneas no reciben foco.
     */
    vecina(paso) {
      if (!vigentes() || renglones.length === 0 || (paso !== 1 && paso !== -1)) return null
      // Sin cursor pero con algo marcado (se llegó desde un bloque), se sigue desde lo marcado: si no,
      // la primera flecha saltaba a la línea 1 y se perdía de vista lo que se había venido a mirar.
      const base = cursor ?? (marcado ? (paso > 0 ? marcado.hasta : marcado.desde) : paso > 0 ? 0 : renglones.length + 1)
      const numero = Math.min(renglones.length, Math.max(1, base + paso))
      ponerCursor(numero)
      return numero
    },

    /** La línea del cursor, o `null`. */
    cursor: () => (vigentes() ? cursor : null),
  }
}
