// Ruteo de cables del esquema físico — Physical View UX #1. PURO: sin DOM, sin I/O.
//
// Recibe la geometría YA MEDIDA de las piezas (lo hace `cableado.js` en el navegador,
// leyendo `pinInfo` de cada pieza Wokwi real) y QUÉ se une con QUÉ (el plan, que sale
// del servidor: IR + ComponentKnowledge). Devuelve POR DÓNDE pasa cada cable. Nunca
// decide una conexión, un pin ni un terminal: sólo geometría.
//
// No es un motor de layout general (ni ELK ni un router de grafos): resuelve la forma
// del esquema de Foundation #1 — piezas a los costados de UNA placa — con rutas
// ortogonales y carriles:
//   - cable placa↔pieza del MISMO lado: pin → carril de ese lado → pieza;
//   - cable placa↔pieza del lado CONTRARIO: rodea la placa por arriba o por abajo;
//   - cable pieza↔pieza: tramo corto en "Z" o en "U" entre las dos patas.
// Busca, de forma determinista, el orden de carriles, el lado del rodeo, el ancla
// equivalente (mismo nodo de la pieza) y si conviene ESPEJAR una pieza (verla "desde
// el otro lado": una pieza 2D sin texto espejada es la misma pieza; la placa nunca se
// espeja). Criterio: menos cruces; a igualdad, menos largo total.

const STUB = 12 // tramo recto que sale de cada pata antes de doblar
// Un cable que va a la PLACA y sale de una pata hacia arriba/abajo baja más que los
// tramos cortos entre piezas (p. ej. resistencia→LED): así nunca corren a la misma altura.
const STUB_HACIA_PLACA = 30
const CARRIL_BASE = 104 // distancia del primer carril al borde de la placa (deja lugar al rótulo del pin)
const CARRIL_PASO = 14 // separación entre carriles vecinos
const RODEO_MARGEN = 42 // distancia del rodeo al borde de arriba/abajo de la placa (pasa por encima del nombre de la placa)
const MAX_ESPEJABLES = 6
const MAX_EVALUACIONES = 60000

/**
 * @param {{
 *   entidades: Record<string, { rect: {x:number,y:number,w:number,h:number}, zoom: number,
 *     pines: Record<string, {x:number,y:number}>, espejable: boolean, esPlaca: boolean }>,
 *   cables: readonly { id: string, camino: string|null,
 *     desde: { clave: string, anclas: readonly string[], etiqueta: string|null, potencia: boolean },
 *     hasta: { clave: string, anclas: readonly string[], etiqueta: string|null, potencia: boolean } }[]
 * }} entrada
 * @returns {{ trazos: { id: string, camino: string|null, potencia: boolean, puntos: [number, number][],
 *   extremos: [number, number][], rotulo: { texto: string, x: number, y: number, alinear: "start"|"end" } | null }[],
 *   espejadas: string[], cruces: number, omitidos: string[] }}
 */
export function rutear(entrada) {
  const { entidades } = entrada
  const omitidos = []
  const cables = []
  for (const cable of entrada.cables) {
    if (!entidades[cable.desde.clave] || !entidades[cable.hasta.clave]) {
      omitidos.push(cable.id)
      continue
    }
    const anclasDesde = cable.desde.anclas.filter((a) => entidades[cable.desde.clave].pines[a])
    const anclasHasta = cable.hasta.anclas.filter((a) => entidades[cable.hasta.clave].pines[a])
    if (anclasDesde.length === 0 || anclasHasta.length === 0) {
      omitidos.push(cable.id)
      continue
    }
    cables.push({ ...cable, desde: { ...cable.desde, anclas: anclasDesde }, hasta: { ...cable.hasta, anclas: anclasHasta } })
  }

  const clavePlaca = Object.keys(entidades).find((k) => entidades[k].esPlaca) ?? null
  const usadas = new Set(cables.flatMap((c) => [c.desde.clave, c.hasta.clave]))
  const espejables = Object.keys(entidades)
    .filter((k) => entidades[k].espejable && usadas.has(k))
    .sort()
    .slice(0, MAX_ESPEJABLES)

  let mejor = null
  let evaluaciones = 0
  for (let mascara = 0; mascara < 1 << espejables.length; mascara++) {
    const espejadas = new Set(espejables.filter((_, i) => mascara & (1 << i)))
    const geometria = (clave, ancla) => puntoDeAncla(entidades[clave], ancla, espejadas.has(clave))
    const preparados = cables.map((c) => prepararCable(c, geometria, clavePlaca, entidades))
    for (const candidato of candidatosDeCarriles(preparados, clavePlaca ? entidades[clavePlaca].rect : null)) {
      evaluaciones++
      const trazos = preparados.map((p) => trazarCable(p, candidato, clavePlaca ? entidades[clavePlaca].rect : null))
      const puntaje = puntuar(trazos)
      if (mejor === null || puntaje.cruces < mejor.puntaje.cruces || (puntaje.cruces === mejor.puntaje.cruces && puntaje.largo < mejor.puntaje.largo - 1e-6)) {
        mejor = { puntaje, trazos, espejadas: [...espejadas] }
      }
      if (evaluaciones >= MAX_EVALUACIONES) break
    }
    if (evaluaciones >= MAX_EVALUACIONES) break
  }

  if (mejor === null) return { trazos: [], espejadas: [], cruces: 0, omitidos }
  return { trazos: mejor.trazos, espejadas: mejor.espejadas, cruces: mejor.puntaje.cruces, omitidos }
}

// ── Geometría de anclas ─────────────────────────────────────────────────────────────

/** Punto absoluto de un pin + hacia dónde sale (el borde más cercano de la pieza). */
export function puntoDeAncla(entidad, ancla, espejada) {
  const pin = entidad.pines[ancla]
  const anchoLocal = entidad.rect.w / entidad.zoom
  const altoLocal = entidad.rect.h / entidad.zoom
  const xl = espejada ? anchoLocal - pin.x : pin.x
  const x = entidad.rect.x + xl * entidad.zoom
  const y = entidad.rect.y + pin.y * entidad.zoom
  const distancias = [
    ["izq", xl],
    ["der", anchoLocal - xl],
    ["arriba", pin.y],
    ["abajo", altoLocal - pin.y],
  ]
  // La placa sólo saca cables a los costados (sus pines están en dos columnas).
  const posibles = entidad.esPlaca ? distancias.slice(0, 2) : distancias
  const [salida] = posibles.reduce((a, b) => (b[1] < a[1] ? b : a))
  return { x, y, salida }
}

function conStub(p, largo = STUB) {
  if (p.salida === "izq") return [p.x - STUB, p.y]
  if (p.salida === "der") return [p.x + STUB, p.y]
  if (p.salida === "arriba") return [p.x, p.y - largo]
  return [p.x, p.y + largo]
}

const manhattan = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])

/** Elige, entre anclas equivalentes, el par más cercano (determinista: el primero gana). */
function prepararCable(cable, geometria, clavePlaca, entidades) {
  let elegido = null
  for (const a of cable.desde.anclas) {
    for (const b of cable.hasta.anclas) {
      const pa = geometria(cable.desde.clave, a)
      const pb = geometria(cable.hasta.clave, b)
      const d = manhattan(conStub(pa), conStub(pb))
      if (elegido === null || d < elegido.d) elegido = { d, pa, pb }
    }
  }
  const desdeEsPlaca = cable.desde.clave === clavePlaca
  const hastaEsPlaca = cable.hasta.clave === clavePlaca
  const base = { id: cable.id, camino: cable.camino, potencia: cable.desde.potencia || cable.hasta.potencia }
  if (desdeEsPlaca === hastaEsPlaca || !clavePlaca) {
    return { ...base, forma: "pieza", a: elegido.pa, b: elegido.pb, rotulo: null }
  }
  const [pin, pieza, extremoPlaca] = desdeEsPlaca ? [elegido.pa, elegido.pb, cable.desde] : [elegido.pb, elegido.pa, cable.hasta]
  const placa = entidades[clavePlaca].rect
  const centro = placa.x + placa.w / 2
  const ladoPin = pin.x < centro ? "izq" : "der"
  const q = conStub(pieza, STUB_HACIA_PLACA)
  const ladoPieza = q[0] < centro ? "izq" : "der"
  return { ...base, forma: ladoPin === ladoPieza ? "mismoLado" : "rodeo", pin, pieza, ladoPin, ladoPieza, etiqueta: extremoPlaca.etiqueta }
}

// ── Carriles ────────────────────────────────────────────────────────────────────────

function* permutaciones(lista) {
  if (lista.length <= 1) {
    yield [...lista]
    return
  }
  for (let i = 0; i < lista.length; i++) {
    const resto = [...lista.slice(0, i), ...lista.slice(i + 1)]
    for (const p of permutaciones(resto)) yield [lista[i], ...p]
  }
}

/** Todas las combinaciones (orden de carriles por lado × lado del rodeo), deterministas. */
function* candidatosDeCarriles(preparados, rectPlaca) {
  if (!rectPlaca) {
    yield { carril: new Map(), rodeo: new Map() }
    return
  }
  const usanLado = (lado) => preparados.filter((p) => (p.forma === "mismoLado" && p.ladoPin === lado) || (p.forma === "rodeo" && (p.ladoPin === lado || p.ladoPieza === lado))).map((p) => p.id)
  const izq = usanLado("izq")
  const der = usanLado("der")
  const rodeos = preparados.filter((p) => p.forma === "rodeo").map((p) => p.id)
  const ordenesIzq = izq.length <= 6 ? [...permutaciones(izq)] : [izq]
  const ordenesDer = der.length <= 6 ? [...permutaciones(der)] : [der]
  for (let m = 0; m < 1 << rodeos.length; m++) {
    const niveles = { arriba: 0, abajo: 0 }
    const rodeo = new Map(
      rodeos.map((id, i) => {
        const lado = m & (1 << i) ? "abajo" : "arriba"
        return [id, { lado, nivel: niveles[lado]++ }]
      }),
    )
    for (const oi of ordenesIzq) {
      for (const od of ordenesDer) {
        const carril = new Map()
        oi.forEach((id, i) => carril.set(`izq:${id}`, rectPlaca.x - CARRIL_BASE - i * CARRIL_PASO))
        od.forEach((id, i) => carril.set(`der:${id}`, rectPlaca.x + rectPlaca.w + CARRIL_BASE + i * CARRIL_PASO))
        yield { carril, rodeo }
      }
    }
  }
}

function trazarCable(p, candidato, rectPlaca) {
  const base = { id: p.id, camino: p.camino, potencia: p.potencia }
  if (p.forma === "pieza") {
    const a = [p.a.x, p.a.y]
    const b = [p.b.x, p.b.y]
    const sa = conStub(p.a)
    const sb = conStub(p.b)
    const horizontal = (s) => s === "izq" || s === "der"
    let medio
    if (horizontal(p.a.salida) && horizontal(p.b.salida)) {
      const xm = (sa[0] + sb[0]) / 2
      medio = [[xm, sa[1]], [xm, sb[1]]]
    } else {
      const yc = p.a.salida === "arriba" && p.b.salida === "arriba" ? Math.min(sa[1], sb[1]) : Math.max(sa[1], sb[1])
      medio = [[sa[0], yc], [sb[0], yc]]
    }
    return { ...base, puntos: limpiar([a, sa, ...medio, sb, b]), extremos: [a, b], rotulo: null }
  }
  const pin = [p.pin.x, p.pin.y]
  const fin = [p.pieza.x, p.pieza.y]
  const q = conStub(p.pieza, STUB_HACIA_PLACA)
  const xPin = candidato.carril.get(`${p.ladoPin}:${p.id}`)
  let puntos
  if (p.forma === "mismoLado") {
    puntos = [pin, [xPin, pin[1]], [xPin, q[1]], q, fin]
  } else {
    const xPieza = candidato.carril.get(`${p.ladoPieza}:${p.id}`)
    const { lado, nivel } = candidato.rodeo.get(p.id)
    const yRodeo = lado === "abajo" ? rectPlaca.y + rectPlaca.h + RODEO_MARGEN + nivel * CARRIL_PASO : rectPlaca.y - RODEO_MARGEN - nivel * CARRIL_PASO
    puntos = [pin, [xPin, pin[1]], [xPin, yRodeo], [xPieza, yRodeo], [xPieza, q[1]], q, fin]
  }
  const haciaIzq = p.ladoPin === "izq"
  const rotulo = p.etiqueta ? { texto: p.etiqueta, x: pin[0] + (haciaIzq ? -6 : 6), y: pin[1] - 4, alinear: haciaIzq ? "end" : "start" } : null
  return { ...base, puntos: limpiar(puntos), extremos: [pin, fin], rotulo }
}

/** Saca puntos repetidos y colineales (no cambia el recorrido). */
function limpiar(puntos) {
  const sinRepetir = puntos.filter((p, i) => i === 0 || p[0] !== puntos[i - 1][0] || p[1] !== puntos[i - 1][1])
  return sinRepetir.filter((p, i, arr) => {
    if (i === 0 || i === arr.length - 1) return true
    const [a, c] = [arr[i - 1], arr[i + 1]]
    return !((a[0] === p[0] && p[0] === c[0]) || (a[1] === p[1] && p[1] === c[1]))
  })
}

// ── Puntaje ─────────────────────────────────────────────────────────────────────────

function segmentos(trazo) {
  const s = []
  for (let i = 1; i < trazo.puntos.length; i++) s.push([trazo.puntos[i - 1], trazo.puntos[i]])
  return s
}

const entre = (v, a, b) => v > Math.min(a, b) + 1e-6 && v < Math.max(a, b) - 1e-6

/** ¿Se cruzan (o se pisan a lo largo) dos segmentos? Tocarse en una punta no cuenta. */
export function seCruzan([a1, a2], [b1, b2]) {
  const aH = a1[1] === a2[1]
  const bH = b1[1] === b2[1]
  const aV = a1[0] === a2[0]
  const bV = b1[0] === b2[0]
  if (aH && bV) return entre(b1[0], a1[0], a2[0]) && entre(a1[1], b1[1], b2[1])
  if (aV && bH) return entre(a1[0], b1[0], b2[0]) && entre(b1[1], a1[1], a2[1])
  if (aH && bH && a1[1] === b1[1]) return Math.min(Math.max(a1[0], a2[0]), Math.max(b1[0], b2[0])) - Math.max(Math.min(a1[0], a2[0]), Math.min(b1[0], b2[0])) > 1e-6
  if (aV && bV && a1[0] === b1[0]) return Math.min(Math.max(a1[1], a2[1]), Math.max(b1[1], b2[1])) - Math.max(Math.min(a1[1], a2[1]), Math.min(b1[1], b2[1])) > 1e-6
  return false
}

export function contarCruces(trazos) {
  let cruces = 0
  const segs = trazos.map(segmentos)
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      for (const a of segs[i]) for (const b of segs[j]) if (seCruzan(a, b)) cruces++
    }
  }
  return cruces
}

function puntuar(trazos) {
  let largo = 0
  for (const t of trazos) for (const [a, b] of segmentos(t)) largo += manhattan(a, b)
  return { cruces: contarCruces(trazos), largo }
}
