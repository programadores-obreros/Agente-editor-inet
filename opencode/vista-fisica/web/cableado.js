// Cableado del esquema físico — Physical View UX #1. Capa de NAVEGADOR (toca el DOM real).
//
// Recibe la instrucción `cableado` del plan (QUÉ se une con QUÉ: sale del servidor, IR +
// ComponentKnowledge) y la dibuja sobre las piezas Wokwi ya montadas:
//   1. mide cada pieza: su caja en pantalla y sus pines (`pinInfo`, el dato del propio
//      renderer — nunca una tabla de coordenadas copiada acá);
//   2. le pide a `ruteo.js` (puro) por dónde pasa cada cable;
//   3. dibuja un <svg> encima: cables, puntos de conexión y el rótulo del pin de la placa.
// No decide ninguna conexión ni ningún pin: si algo no se puede medir, ese cable no se
// dibuja (sigue en la lista de texto de conexiones).
//
// También conecta el resaltado: al pasar el mouse o enfocar una pieza (`data-camino`),
// se destacan los cables de su camino y se atenúan los demás.

import { rutear } from "./ruteo.js"

const SVG = "http://www.w3.org/2000/svg"

/** Dibuja (o redibuja) el cableado dentro de `contenedor` (el #circuito en modo esquema). */
export function dibujarCableado(doc, contenedor, instruccion) {
  for (const viejo of contenedor.querySelectorAll("svg[data-cableado]")) viejo.remove()
  if (!instruccion || instruccion.cables.length === 0) return null

  const origen = contenedor.getBoundingClientRect()
  const entidades = {}
  const elementos = new Map()
  for (const cable of instruccion.cables) {
    for (const extremo of [cable.desde, cable.hasta]) {
      const clave = `${extremo.entidad.tipo}:${extremo.entidad.id}`
      if (entidades[clave] !== undefined) continue
      const elemento = buscarPieza(contenedor, extremo.entidad)
      if (!elemento) continue
      elemento.style.transform = "" // medir siempre sin espejar
      const rect = elemento.getBoundingClientRect()
      const pines = {}
      for (const pin of elemento.pinInfo ?? []) pines[pin.name] = { x: pin.x, y: pin.y }
      entidades[clave] = {
        rect: { x: rect.left - origen.left, y: rect.top - origen.top, w: rect.width, h: rect.height },
        zoom: elemento.currentCSSZoom ?? 1,
        pines,
        espejable: extremo.entidad.tipo !== "placa",
        esPlaca: extremo.entidad.tipo === "placa",
      }
      elementos.set(clave, elemento)
    }
  }

  const resultado = rutear({
    entidades,
    cables: instruccion.cables.map((c) => ({
      id: c.id,
      camino: c.camino,
      desde: { clave: `${c.desde.entidad.tipo}:${c.desde.entidad.id}`, anclas: c.desde.anclas, etiqueta: c.desde.etiqueta, potencia: c.desde.potencia },
      hasta: { clave: `${c.hasta.entidad.tipo}:${c.hasta.entidad.id}`, anclas: c.hasta.anclas, etiqueta: c.hasta.etiqueta, potencia: c.hasta.potencia },
    })),
  })

  // Espejar es sólo mirar la pieza desde el otro lado (ver `ruteo.js`): la caja no cambia.
  for (const clave of resultado.espejadas) {
    const elemento = elementos.get(clave)
    if (elemento) elemento.style.transform = "scaleX(-1)"
  }

  const svg = doc.createElementNS(SVG, "svg")
  svg.setAttribute("data-cableado", "true")
  svg.setAttribute("aria-hidden", "true") // la versión accesible es la lista de conexiones en texto
  svg.setAttribute("width", String(Math.ceil(contenedor.clientWidth)))
  svg.setAttribute("height", String(Math.ceil(contenedor.clientHeight)))
  const caminos = [...new Set(resultado.trazos.map((t) => t.camino ?? ""))]
  for (const trazo of resultado.trazos) {
    const grupo = doc.createElementNS(SVG, "g")
    grupo.setAttribute("data-cable-id", trazo.id)
    grupo.setAttribute("data-camino", trazo.camino ?? "")
    grupo.setAttribute("class", trazo.potencia ? "cable cable-potencia" : `cable cable-senal color-${caminos.indexOf(trazo.camino ?? "") % 5}`)
    const puntos = trazo.puntos.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
    // Borde del color del fondo DEBAJO de cada cable: si dos cables se cruzan, el de
    // arriba "corta" al de abajo y se lee como un cruce, nunca como una unión.
    const borde = doc.createElementNS(SVG, "polyline")
    borde.setAttribute("class", "borde")
    borde.setAttribute("points", puntos)
    grupo.appendChild(borde)
    const linea = doc.createElementNS(SVG, "polyline")
    linea.setAttribute("class", "linea")
    linea.setAttribute("points", puntos)
    grupo.appendChild(linea)
    for (const [x, y] of trazo.extremos) {
      const punto = doc.createElementNS(SVG, "circle")
      punto.setAttribute("cx", x.toFixed(1))
      punto.setAttribute("cy", y.toFixed(1))
      punto.setAttribute("r", "3.5")
      grupo.appendChild(punto)
    }
    if (trazo.rotulo) {
      const texto = doc.createElementNS(SVG, "text")
      texto.setAttribute("x", trazo.rotulo.x.toFixed(1))
      texto.setAttribute("y", trazo.rotulo.y.toFixed(1))
      texto.setAttribute("text-anchor", trazo.rotulo.alinear)
      texto.textContent = trazo.rotulo.texto
      grupo.appendChild(texto)
    }
    svg.appendChild(grupo)
  }
  contenedor.appendChild(svg)
  conectarResaltado(contenedor)
  // Un redibujo (cambio de tamaño) conserva el resaltado vigente.
  aplicarResaltado(contenedor, contenedor.dataset.resaltado ?? null)
  return resultado
}

function buscarPieza(contenedor, entidad) {
  for (const candidato of contenedor.querySelectorAll(`[data-entidad-tipo="${entidad.tipo}"][data-entidad-id="${CSS.escape(entidad.id)}"]`)) {
    if (Array.isArray(candidato.pinInfo)) return candidato
  }
  return null
}

function aplicarResaltado(contenedor, camino) {
  if (camino === null) delete contenedor.dataset.resaltado
  else contenedor.dataset.resaltado = camino
  for (const g of contenedor.querySelectorAll("svg[data-cableado] g[data-camino]")) {
    const propio = camino === "placa" || g.getAttribute("data-camino") === camino
    g.classList.toggle("resaltado", camino !== null && propio)
    g.classList.toggle("atenuado", camino !== null && !propio)
  }
}

function conectarResaltado(contenedor) {
  const resaltar = (camino) => aplicarResaltado(contenedor, camino)
  for (const figura of contenedor.querySelectorAll("figure[data-camino]")) {
    if (figura.dataset.resaltadoConectado === "true") continue
    figura.dataset.resaltadoConectado = "true"
    const camino = figura.getAttribute("data-camino")
    figura.addEventListener("mouseenter", () => resaltar(camino))
    figura.addEventListener("focus", () => resaltar(camino))
    figura.addEventListener("mouseleave", () => resaltar(null))
    figura.addEventListener("blur", () => resaltar(null))
  }
}
