// La sección activa de la navegación de la ventana «vista física».
//
// POR QUÉ ESTE ARCHIVO (2026-11-26). El prototipo marcaba el paso activo dentro del callback de
// un `IntersectionObserver`, con la regla escrita ahí mismo: imposible de probar sin un navegador
// y con un defecto que sólo se veía usándola (tocar «Avisos», la última sección, dejaba marcado
// «Mirá el programa», porque esa sección es corta y nunca llega a la franja de lectura). Ahora la
// decisión es una función pura y el observador sólo avisa cuándo volver a medir.
//
// LAS MEDIDAS de los escenarios son las reales de la página (Chromium, ventana de 1560×757 útiles,
// proyecto con ESP32, cinco piezas y dos reglas), redondeadas.
//
// MUTACIONES que ponen rojo este archivo (probadas con el cambio ya commiteado):
//   - `find` → `findLast` (la última de la franja en vez de la primera)     → «con dos secciones en la franja…»
//   - sacar la excepción del pie                                             → «la última sección, corta…»
//   - sacar `desplazado > 0` de la excepción                                 → «si todo entra en la ventana…»
//   - sacar «lo que queda por bajar no alcanza» de la excepción              → «la última sección a la vista NO es la activa…»
//   - `abajo > desde` → `abajo > 0` (cuenta lo tapado por el header)         → «lo que tapa el header no cuenta»
//   - `Math.max(desde + 1, …)` → sin el máximo                               → «la franja nunca se invierte»
//   - el cableado no saca `aria-current` del enlace anterior                 → «el cableado marca un solo enlace…»
//   - el cableado no deja `--alto-cabecera`                                  → «el cableado marca un solo enlace…»
//
// LÍMITE HONESTO: el cableado se prueba con un documento y un observador falsos. Que el
// `IntersectionObserver` de verdad avise cuando corresponde se miró en Chromium, desplazando.
//
// Corre con: node --test tests/ventana-navegacion.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { franjaDeLectura, seccionActiva, conectarNavegacion } = await import(join(REPO, "opencode/vista-fisica/web/navegacion.js"))

const ALTO = 757
const CABECERA = 69
const FRANJA = franjaDeLectura({ altoCabecera: CABECERA, altoVentana: ALTO })
/** Las cuatro secciones de la página, con el `arriba` de la primera en `desplazamiento` 0. */
const ALTOS = { "paso-circuito": 1330, "paso-reglas": 1010, "paso-programa": 640, "paso-avisos": 170 }
const SEPARACION = 24
const PRIMERA_ARRIBA = 355
const ALTO_DE_PAGINA = PRIMERA_ARRIBA + Object.values(ALTOS).reduce((a, b) => a + b + SEPARACION, 0) + 24
function medir(desplazado) {
  let arriba = PRIMERA_ARRIBA - desplazado
  const secciones = Object.entries(ALTOS).map(([id, alto]) => {
    const seccion = { id, arriba, abajo: arriba + alto }
    arriba += alto + SEPARACION
    return seccion
  })
  return { secciones, ventana: { ...FRANJA, altoVentana: ALTO, desplazado, resto: ALTO_DE_PAGINA - (desplazado + ALTO) } }
}
const activaEn = (desplazado) => {
  const { secciones, ventana } = medir(desplazado)
  return seccionActiva(secciones, ventana)
}
/** A dónde queda la página al tocar el enlace de una sección (su título justo debajo del header). */
const alTocar = (id) => {
  const { secciones } = medir(0)
  return Math.min(secciones.find((s) => s.id === id).arriba - CABECERA - 16, ALTO_DE_PAGINA - ALTO)
}

test("la franja de lectura va de debajo del header a un poco antes de la mitad de la ventana", () => {
  assert.deepEqual(FRANJA, { desde: 77, hasta: ALTO * 0.45 })
  assert.ok(FRANJA.desde > CABECERA && FRANJA.hasta < ALTO / 2)
})

test("la franja nunca se invierte, ni con un header más alto que media ventana", () => {
  const franja = franjaDeLectura({ altoCabecera: 190, altoVentana: 300 })
  assert.ok(franja.hasta > franja.desde, JSON.stringify(franja))
  assert.equal(franjaDeLectura({ altoCabecera: -40, altoVentana: 700 }).desde, 8, "un header que ya se fue de la ventana no tapa nada")
})

test("arriba de todo no hay paso activo: se está leyendo el resumen", () => {
  assert.equal(PRIMERA_ARRIBA > FRANJA.hasta, true, "precondición: el paso 1 arranca por debajo de la franja")
  assert.equal(activaEn(0), null)
})

test("al tocar el enlace de un paso, el activo es ese paso (y no el anterior, que quedó bajo el header)", () => {
  for (const id of ["paso-circuito", "paso-reglas", "paso-programa"]) assert.equal(activaEn(alTocar(id)), id)
})

test("lo que tapa el header no cuenta: una sección que sólo asoma por detrás del header no es la activa", () => {
  // La sección anterior termina 24 px arriba del título de la siguiente: detrás del header.
  const { secciones, ventana } = medir(alTocar("paso-reglas"))
  const anterior = secciones.find((s) => s.id === "paso-circuito")
  assert.ok(anterior.abajo > 0 && anterior.abajo < CABECERA, `precondición: la anterior asoma detrás del header (abajo=${anterior.abajo})`)
  assert.equal(seccionActiva(secciones, ventana), "paso-reglas")
})

test("con dos secciones en la franja, la activa es la primera", () => {
  const secciones = [{ id: "a", arriba: -400, abajo: 200 }, { id: "b", arriba: 224, abajo: 900 }]
  assert.equal(seccionActiva(secciones, { desde: 77, hasta: 340, altoVentana: 757 }), "a")
  assert.equal(seccionActiva([...secciones].reverse(), { desde: 77, hasta: 340, altoVentana: 757 }), "b", "«primera» es en el orden que se le pasa: el de la página")
})

test("mientras se baja por un paso largo, el activo sigue siendo ese paso", () => {
  const desde = alTocar("paso-circuito")
  const hasta = alTocar("paso-reglas")
  for (let y = desde; y < hasta - FRANJA.hasta + CABECERA; y += 90) assert.equal(activaEn(y), "paso-circuito", `desplazado ${y}`)
})

test("la última sección, corta, queda activa al llegar al pie aunque nunca alcance la franja", () => {
  const pie = ALTO_DE_PAGINA - ALTO
  const { secciones, ventana } = medir(pie)
  const avisos = secciones.at(-1)
  assert.ok(avisos.arriba > FRANJA.hasta, `precondición: al pie, «Avisos» queda por debajo de la franja (arriba=${avisos.arriba})`)
  assert.equal(seccionActiva(secciones, ventana), "paso-avisos")
  assert.equal(activaEn(alTocar("paso-avisos")), "paso-avisos", "tocar «Avisos» tiene que dejar marcado «Avisos»")
  // Un poco antes del pie, con «Avisos» todavía cortada por el borde de abajo, sigue el programa.
  const antes = pie - 120
  assert.ok(medir(antes).secciones.at(-1).abajo > ALTO, "precondición: «Avisos» todavía no entró entera")
  assert.equal(activaEn(antes), "paso-programa")
})

// AGREGADO DESPUÉS, POR MUTACIÓN (2026-11-26). La excepción del pie tiene cuatro condiciones y la
// primera tanda de pruebas dejaba una sin cuidar: se podía borrar «lo que queda por bajar no
// alcanza para llevarla a la franja» y seguía todo verde, porque en todos los escenarios la página
// terminaba justo después de «Avisos». Sin esa condición, «Avisos» se marcaba apenas entraba
// entera en la ventana, aunque faltara un buen tramo y se estuviera leyendo el programa.
test("la última sección a la vista NO es la activa si todavía se puede bajar hasta llevarla a la franja", () => {
  const secciones = [{ id: "paso-programa", arriba: -300, abajo: 300 }, { id: "paso-avisos", arriba: 400, abajo: 570 }]
  const ventana = { desde: 77, hasta: 340, altoVentana: 757, desplazado: 500 }
  assert.equal(seccionActiva(secciones, { ...ventana, resto: 400 }), "paso-programa", "quedan 400 px por bajar y «Avisos» está a 60 de la franja: todavía se lee el programa")
  assert.equal(seccionActiva(secciones, { ...ventana, resto: 20 }), "paso-avisos", "con 20 px por bajar ya no va a llegar: es la activa")
})

test("si todo entra en la ventana y no se bajó nada, no se marca la última por estar a la vista", () => {
  // Proyecto vacío en un monitor alto: la página entera se ve sin desplazar.
  const secciones = [{ id: "paso-circuito", arriba: 355, abajo: 560 }, { id: "paso-reglas", arriba: 584, abajo: 900 }, { id: "paso-avisos", arriba: 924, abajo: 1090 }]
  const franja = franjaDeLectura({ altoCabecera: 69, altoVentana: 1300 })
  assert.equal(seccionActiva(secciones, { ...franja, altoVentana: 1300, desplazado: 0, resto: 0 }), "paso-circuito")
})

test("sin secciones no hay activa", () => {
  assert.equal(seccionActiva([], { ...FRANJA, altoVentana: ALTO, desplazado: 100, resto: 0 }), null)
})

// ── El cableado, con un documento y un observador falsos ──

function paginaFalsa(desplazado) {
  const estado = { desplazado }
  const enlace = (id) => ({
    id,
    atributos: { href: `#${id}` },
    getAttribute(k) {
      return this.atributos[k] ?? null
    },
    setAttribute(k, v) {
      this.atributos[k] = String(v)
    },
    removeAttribute(k) {
      delete this.atributos[k]
    },
  })
  const enlaces = Object.keys(ALTOS).map(enlace)
  const seccion = (id) => ({ id, getBoundingClientRect: () => { const s = medir(estado.desplazado).secciones.find((x) => x.id === id); return { top: s.arriba, bottom: s.abajo } } })
  const propiedades = {}
  const observadores = []
  const doc = {
    querySelector: (selector) => (selector === "nav[data-pasos]" ? { querySelectorAll: () => enlaces } : selector === "header" ? { getBoundingClientRect: () => ({ height: CABECERA, bottom: CABECERA }) } : null),
    getElementById: (id) => (id in ALTOS ? seccion(id) : null),
    documentElement: { scrollHeight: ALTO_DE_PAGINA, style: { setProperty: (k, v) => (propiedades[k] = v) } },
  }
  const ventana = {
    innerHeight: ALTO,
    get scrollY() {
      return estado.desplazado
    },
    addEventListener() {},
    IntersectionObserver: class {
      constructor(aviso, opciones) {
        this.aviso = aviso
        this.opciones = opciones
        this.observadas = []
        this.vivo = true
        observadores.push(this)
      }
      observe(elemento) {
        this.observadas.push(elemento.id)
      }
      disconnect() {
        this.vivo = false
      }
    },
  }
  const marcados = () => enlaces.filter((e) => e.atributos["aria-current"] === "true").map((e) => e.id)
  return { doc, ventana, estado, propiedades, observadores, marcados }
}

test("el cableado marca un solo enlace con aria-current, lo cambia al desplazar y deja el alto del header", () => {
  const p = paginaFalsa(0)
  conectarNavegacion(p.doc, p.ventana)
  assert.deepEqual(p.marcados(), [], "arriba de todo no hay paso activo")
  assert.equal(p.propiedades["--alto-cabecera"], `${CABECERA}px`)

  const vivos = p.observadores.filter((o) => o.vivo)
  assert.equal(vivos.length, 2)
  assert.deepEqual(vivos[0].observadas, Object.keys(ALTOS), "el observador de la franja mira las cuatro secciones")
  assert.equal(vivos[0].opciones.rootMargin, `-${FRANJA.desde}px 0px -${Math.round(ALTO - FRANJA.hasta)}px 0px`, "la franja que mira el navegador es la misma que usa la decisión")
  assert.deepEqual(vivos[1].observadas, ["paso-avisos"], "el segundo mira sólo la última sección")

  p.estado.desplazado = alTocar("paso-reglas")
  vivos[0].aviso()
  assert.deepEqual(p.marcados(), ["paso-reglas"])
  p.estado.desplazado = alTocar("paso-avisos")
  vivos[1].aviso()
  assert.deepEqual(p.marcados(), ["paso-avisos"], "al cambiar de paso, el anterior deja de estar marcado")
})

test("sin IntersectionObserver o sin navegación, el cableado no hace nada y no rompe", () => {
  const p = paginaFalsa(0)
  assert.equal(conectarNavegacion(p.doc, { ...p.ventana, IntersectionObserver: undefined }), null)
  assert.equal(conectarNavegacion({ ...p.doc, querySelector: () => null }, p.ventana), null)
  assert.deepEqual(p.marcados(), [])
})
