// Tests del TRAZADOR DE CABLES (opencode/tecniabot-web/cables.js).
// Corre con: node --test tests/*.test.mjs
//
// QUÉ SE PRUEBA ACÁ Y QUÉ NO — leelo antes de agregar nada.
//
// Se prueba la GEOMETRÍA, que es la parte pura y la parte que miente barato:
// un cable mal ruteado sale prolijo y manda al pibe al agujero de al lado.
// NO se prueba "el SVG tiene N paths": ese test pasa con los N paths al ángulo
// equivocado, y en este repo ya aparecieron siete tests que pasaban sin probar
// nada. Lo que no tiene assert está dicho, en el informe y acá abajo.
//
// LO QUE ESTE ARCHIVO NO PUEDE CUBRIR (hay que MIRARLO cada vez):
//   · que el dibujo se entienda;
//   · que los cables no se crucen entre sí de forma ilegible (el ruteo evita
//     cruzar la PLACA, que sí se testea, pero entre cables es una heurística);
//   · que la resistencia caiga sobre el tramo y no encima de una etiqueta;
//   · que nada se salga de la hoja.
// Eso se midió en el navegador con la hoja de 6 componentes (15 cables) a 500,
// 800, 1200 y 1600 px y con zoom 67% y 150%. Está en el informe.
//
// Se carga el archivo REAL con `vm`, como script clásico y sin `document`.
// Dos motivos: (a) prueba los bytes que se instalan, no una copia; (b) prueba
// de paso que la capa DOM está bien guardada — si alguien saca el
// `if (typeof document === "undefined") return`, esto explota acá y no en la
// netbook de la escuela.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const RUTA = join(REPO, "opencode/tecniabot-web/cables.js")

const caja = { setTimeout, clearTimeout }
vm.createContext(caja)
vm.runInContext(readFileSync(RUTA, "utf8"), caja, { filename: "cables.js" })
const C = caja.TecniaCables

// ── medidas REALES, tomadas en Chrome sobre la hoja de 6 componentes ─────────
// No son inventadas: salen de getBoundingClientRect()/offsetWidth de las piezas
// de esa hoja. Si alguna cambia, el test tiene que cambiar con una medición
// nueva al lado, no con un número que "hace pasar".
const UNO = { left: 0, top: 0, right: 274.3, bottom: 206.6 } // wokwi-arduino-uno
const ESP = { left: 0, top: 0, right: 106.6, bottom: 204.3 } // wokwi-esp32-devkit-v1
const PIN_13_UNO = { x: 125, y: 9 } // header de ARRIBA
const PIN_5V_UNO = { x: 160, y: 191.5 } // header de ABAJO
const PIN_D13_ESP = { x: 5, y: 139.5 } // columna IZQUIERDA
const PIN_D23_ESP = { x: 102, y: 24 } // columna DERECHA

// ── chequeos escritos ACÁ a propósito ───────────────────────────────────────
// No se usan `C.cruza` ni `C.esOrtogonal` para verificar: si el módulo se
// equivoca en su propio chequeo, el test se equivocaría igual y en verde.

function segmentos(pts) {
  const s = []
  for (let i = 0; i + 1 < pts.length; i++) s.push([pts[i], pts[i + 1]])
  return s
}

/** ¿Pisa el INTERIOR del rectángulo? (tocar el borde no cuenta) */
function pisa([a, b], r) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
  return x1 > r.left + 1e-6 && x0 < r.right - 1e-6 && y1 > r.top + 1e-6 && y0 < r.bottom - 1e-6
}

function esHorizontal([a, b]) {
  return Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.x - b.x) > 1e-6
}
function esVertical([a, b]) {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) > 1e-6
}
// Los puntos vienen del contexto `vm`, así que su prototipo NO es el mismo
// Object de acá y `deepEqual` los rechaza aunque tengan los mismos números.
// Se comparan las coordenadas, que es lo que importa.
function mismoPunto(a, b) {
  return !!a && !!b && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
}

// ════════════════════════════════════════════════════════════════════════════
// rutear — las puntas y la ortogonalidad
// ════════════════════════════════════════════════════════════════════════════

test("rutear: el camino empieza en el agujero y termina en el pin de la pieza", () => {
  const origen = { x: PIN_13_UNO.x, y: PIN_13_UNO.y }
  const destino = { x: 420, y: 60 }
  const p = C.rutear({ origen, destino, placa: UNO, carril: 300 })
  assert.ok(p, "tendría que haber camino")
  assert.ok(mismoPunto(p[0], origen), "el primer punto ES el agujero, no una aproximación")
  assert.ok(mismoPunto(p[p.length - 1], destino), "el último punto ES el pin de la pieza")
})

// MUTACIÓN QUE MATA ESTE TEST: cualquier diagonal. Si alguien "suaviza" una
// esquina o mete un atajo en diagonal, muere. Es el punto 2 del contrato Wokwi.
test("rutear: TODOS los segmentos son horizontales o verticales", () => {
  const casos = [
    { origen: PIN_13_UNO, destino: { x: 420, y: 60 }, placa: UNO, carril: 300 },
    { origen: PIN_D13_ESP, destino: { x: 380, y: 40 }, placa: ESP, carril: 160 },
    { origen: PIN_5V_UNO, destino: { x: 500, y: 400 }, placa: UNO, carril: 300 },
    { origen: { x: 10, y: 10 }, destino: { x: 200, y: 90 }, placa: null, carril: 100 },
  ]
  for (const g of casos) {
    const p = C.rutear(g)
    assert.ok(p, "sin camino en " + JSON.stringify(g))
    for (const s of segmentos(p)) {
      assert.ok(
        esHorizontal(s) || esVertical(s),
        `segmento en diagonal: ${JSON.stringify(s)} (caso ${JSON.stringify(g.origen)})`,
      )
    }
  }
})

// ════════════════════════════════════════════════════════════════════════════
// rutear — el tramo de salida sale perpendicular al borde MÁS CERCANO
// ════════════════════════════════════════════════════════════════════════════
//
// MUTACIÓN QUE MATA ESTE TEST: cambiar el lado de salida. Si `ladoMasCercano`
// devuelve "der" para un pin de la columna izquierda del ESP32, el primer
// segmento deja de ser horizontal-hacia-la-izquierda y el assert muere. Si se
// devuelve siempre el mismo lado, muere en tres de los cuatro casos.
//
// Y no es cosmético: el cable de verdad sale perpendicular al header. Un cable
// que sale de costado del pin 13 le enseña al pibe que ahí entra de costado.

test("rutear: el cable sale PERPENDICULAR al borde más cercano — header de arriba del UNO", () => {
  const p = C.rutear({ origen: PIN_13_UNO, destino: { x: 420, y: 60 }, placa: UNO, carril: 300 })
  const primero = segmentos(p)[0]
  assert.ok(esVertical(primero), "el pin 13 está a 9 px del borde de ARRIBA: sale vertical")
  assert.ok(primero[1].y < UNO.top, `tiene que salir por arriba de la placa, salió a y=${primero[1].y}`)
})

test("rutear: el cable sale PERPENDICULAR al borde más cercano — header de abajo del UNO", () => {
  const p = C.rutear({ origen: PIN_5V_UNO, destino: { x: 500, y: 400 }, placa: UNO, carril: 300 })
  const primero = segmentos(p)[0]
  assert.ok(esVertical(primero), "el 5V está a 15 px del borde de ABAJO: sale vertical")
  assert.ok(primero[1].y > UNO.bottom, `tiene que salir por abajo, salió a y=${primero[1].y}`)
})

test("rutear: el cable sale PERPENDICULAR al borde más cercano — columna izquierda del ESP32", () => {
  const p = C.rutear({ origen: PIN_D13_ESP, destino: { x: 380, y: 40 }, placa: ESP, carril: 160 })
  const primero = segmentos(p)[0]
  assert.ok(esHorizontal(primero), "el D13 está a 5 px del borde IZQUIERDO: sale horizontal")
  assert.ok(primero[1].x < ESP.left, `tiene que salir por la izquierda, salió a x=${primero[1].x}`)
})

test("rutear: el cable sale PERPENDICULAR al borde más cercano — columna derecha del ESP32", () => {
  const p = C.rutear({ origen: PIN_D23_ESP, destino: { x: 380, y: 40 }, placa: ESP, carril: 160 })
  const primero = segmentos(p)[0]
  assert.ok(esHorizontal(primero), "el D23 está a 4,6 px del borde DERECHO: sale horizontal")
  assert.ok(primero[1].x > ESP.right, `tiene que salir por la derecha, salió a x=${primero[1].x}`)
})

// ════════════════════════════════════════════════════════════════════════════
// rutear — ningún tramo intermedio atraviesa la placa
// ════════════════════════════════════════════════════════════════════════════

// MUTACIÓN QUE MATA ESTE TEST: sacar los candidatos con rodeo (el cable pasaría
// derecho por encima de la placa → `pisa` da true), o dejar de descartar el
// candidato directo (idem). También muere si se cambia el lado de salida: un
// pin de la columna izquierda que "saliera" por la derecha no necesitaría
// rodeo y el camino sería otro.
test("rutear: el cable NO atraviesa la placa aunque salga por el lado contrario al destino", () => {
  // Pin en la columna IZQUIERDA del ESP32 y pieza a la DERECHA: el camino
  // directo cruzaría la placa entera. Tiene que rodearla.
  const p = C.rutear({ origen: PIN_D13_ESP, destino: { x: 380, y: 140 }, placa: ESP, carril: 160 })
  assert.ok(p, "tendría que encontrar un rodeo, no rendirse")
  const segs = segmentos(p)
  assert.ok(segs.length >= 3, "un rodeo no se hace con dos tramos")
  segs.slice(1).forEach((s, i) => {
    assert.ok(!pisa(s, ESP), `el tramo ${i + 1} atraviesa la placa: ${JSON.stringify(s)}`)
  })
})

test("rutear: tampoco la atraviesa cuando el destino está del otro lado en vertical", () => {
  // Sale por el header de ARRIBA del UNO y la fila está por DEBAJO de la placa.
  const p = C.rutear({ origen: PIN_13_UNO, destino: { x: 420, y: 320 }, placa: UNO, carril: 300 })
  assert.ok(p)
  segmentos(p)
    .slice(1)
    .forEach((s, i) => {
      assert.ok(!pisa(s, UNO), `el tramo ${i + 1} atraviesa la placa: ${JSON.stringify(s)}`)
    })
})

// REGRESIÓN, y es el defecto que más cerca estuvo de entrar.
//
// El chequeo de "no atravesar" exime al PRIMER segmento, porque el agujero está
// adentro de la placa y el tramo de salida arranca adentro sí o sí. Cuando el
// carril caía justo en la x del agujero, `compactar` fundía el tramo de salida
// con el siguiente y el resultado era UN SOLO segmento 0 que bajaba desde el
// header de arriba hasta debajo de la placa, atravesándola entera — exento, y
// por lo tanto aceptado. Medido en la hoja de 6 componentes: 5 de 15 cables
// cruzaban la placa por el medio, con el dibujo impecable.
//
// MUTACIÓN QUE MATA ESTE TEST: volver a validar DESPUÉS de compactar.
test("rutear: el tramo de salida es el mínimo para salir, aunque el carril caiga en la x del agujero", () => {
  const origen = { x: 115.5, y: 9 } // GND.1 del UNO, header de arriba
  const destino = { x: 420, y: 320 } // una fila POR DEBAJO de la placa
  let hubo = 0
  // El carril igual a la x del agujero es el caso que disparaba el defecto
  // (ahí el tramo de salida y el siguiente se funden al compactar). Los otros
  // están para que el test no pueda pasar de vacío.
  for (const carril of [origen.x, origen.x + 0.2, 300, 420]) {
    const p = C.rutear({ origen, destino, placa: UNO, carril })
    if (!p) continue // devolver null es una respuesta válida: falla cerrado
    hubo++
    const primero = segmentos(p)[0]
    assert.ok(esVertical(primero), `carril ${carril}: el tramo de salida dejó de ser vertical`)
    assert.ok(
      primero[1].y < UNO.top,
      `carril ${carril}: el tramo de salida terminó en y=${primero[1].y}, o sea que se fue de largo y cruzó la placa entera`,
    )
  }
  assert.ok(hubo > 0, "ningún carril dio camino: el test estaría pasando sin probar nada")
})

// ════════════════════════════════════════════════════════════════════════════
// rutear — falla cerrado
// ════════════════════════════════════════════════════════════════════════════

test("rutear: sin puntas válidas devuelve null, no un camino inventado", () => {
  assert.equal(C.rutear(), null)
  assert.equal(C.rutear({ origen: { x: 1, y: 2 } }), null)
  assert.equal(C.rutear({ origen: { x: NaN, y: 2 }, destino: { x: 3, y: 4 } }), null)
  assert.equal(C.rutear({ origen: { x: 1, y: 2 }, destino: { x: 3, y: undefined } }), null)
})

test("rutear: si no hay lugar para salir de la placa dentro de la escena, no dibuja", () => {
  // La escena termina justo en el borde de arriba de la placa: el cable no
  // tiene ni 1 px para salir por ahí, y por el lado más cercano no hay otra.
  const limites = { left: -50, top: UNO.top, right: 500, bottom: 400 }
  const p = C.rutear({ origen: PIN_13_UNO, destino: { x: 420, y: 60 }, placa: UNO, carril: 300, limites })
  assert.equal(p, null, "sin lugar, mejor el cable CSS de siempre que un cable mal puesto")
})

// ════════════════════════════════════════════════════════════════════════════
// waypoints estilo Wokwi
// ════════════════════════════════════════════════════════════════════════════

test("waypoints: el `*` parte el ruteo — lo de antes sale del origen, lo de después llega al destino", () => {
  const origen = { x: 100, y: 100 }
  const destino = { x: 300, y: 200 }
  const p = C.rutear({ origen, destino, ruta: ["v10", "h5", "*", "v-15"] })
  assert.ok(p)
  assert.ok(mismoPunto(p[0], origen))
  assert.ok(mismoPunto(p[p.length - 1], destino))
  // v10 = 10 px ABAJO (y crece hacia abajo, como en la pantalla)
  assert.ok(
    p.some((q) => Math.abs(q.x - 100) < 1e-6 && Math.abs(q.y - 110) < 1e-6),
    "falta el punto origen+v10",
  )
  // el de después del `*` se cuenta DESDE EL DESTINO: destino + v-15
  assert.ok(
    p.some((q) => Math.abs(q.x - 300) < 1e-6 && Math.abs(q.y - 185) < 1e-6),
    "falta el punto destino+v-15 (el `*` no se está aplicando en reversa)",
  )
  for (const s of segmentos(p)) assert.ok(esHorizontal(s) || esVertical(s), "diagonal en el ruteo a mano")
})

test("waypoints: un waypoint que no se entiende NO se adivina", () => {
  const g = { origen: { x: 0, y: 0 }, destino: { x: 50, y: 50 } }
  assert.equal(C.rutear({ ...g, ruta: ["v10", "diagonal"] }), null)
  assert.equal(C.rutear({ ...g, ruta: ["x10"] }), null)
  assert.equal(C.rutear({ ...g, ruta: [10] }), null)
  assert.equal(C.desplazamiento("v10").y, 10)
  assert.equal(C.desplazamiento("h-5").x, -5)
  assert.equal(C.desplazamiento("V3"), null, "Wokwi los escribe en minúscula; no inventamos alias")
})

// ════════════════════════════════════════════════════════════════════════════
// anchoIntrinsecoPx — mm, px, sin unidad, basura
// ════════════════════════════════════════════════════════════════════════════
//
// MUTACIÓN QUE MATA ESTE TEST: leer el viewBox en vez del atributo width. El
// UNO declara width="72.58mm" y viewBox "-4 0 72.58 53.34": el número es EL
// MISMO y la unidad no. Quien confunda los dos se lleva un factor 3,78.

const MM = 96 / 25.4 // 3,779528 px/mm — el mismo factor de componentes-extra.js:313

test("anchoIntrinsecoPx: milímetros, píxeles y sin unidad", () => {
  // wokwi-arduino-uno
  assert.ok(Math.abs(C.anchoIntrinsecoPx("72.58mm") - 72.58 * MM) < 1e-9)
  assert.ok(Math.abs(C.anchoIntrinsecoPx("72.58mm") - 274.318) < 0.01, "72,58 mm son 274,3 px, no 72,58")
  // wokwi-esp32-devkit-v1
  assert.ok(Math.abs(C.anchoIntrinsecoPx("28.2mm") - 106.58) < 0.01)
  // nuestras piezas pb-*: sin unidad = px
  assert.equal(C.anchoIntrinsecoPx("237.4"), 237.4)
  assert.equal(C.anchoIntrinsecoPx("40"), 40)
  // otras unidades absolutas
  assert.equal(C.anchoIntrinsecoPx("1in"), 96)
  assert.ok(Math.abs(C.anchoIntrinsecoPx("1cm") - 10 * MM) < 1e-9)
})

test("anchoIntrinsecoPx: lo que no se puede resolver devuelve null, no un número", () => {
  for (const basura of ["", "   ", "auto", "100%", "5em", "20vw", "-5", "0", "1e3", "px", null, undefined, {}, NaN]) {
    assert.equal(C.anchoIntrinsecoPx(basura), null, `debería ser null: ${JSON.stringify(basura)}`)
  }
})

test("anchoIntrinsecoPx: también lo lee de un <svg>", () => {
  const svg = { getAttribute: (n) => ({ width: "72.58mm", height: "53.34mm" })[n] ?? null }
  assert.ok(Math.abs(C.anchoIntrinsecoPx(svg) - 274.318) < 0.01)
  assert.ok(Math.abs(C.altoIntrinsecoPx(svg) - 201.6) < 0.01)
  assert.equal(C.anchoIntrinsecoPx({ getAttribute: () => null }), null)
})

// ════════════════════════════════════════════════════════════════════════════
// la guarda del 2%
// ════════════════════════════════════════════════════════════════════════════
//
// MUTACIÓN QUE MATA ESTE TEST: mover la tolerancia. Si se baja a 0,5% muere el
// caso del fotorresistor (que es REAL y tiene que pasar); si se sube a 5% muere
// el caso estirado de al lado. La tolerancia queda clavada entre dos medidas.

test("escalaUniforme: las piezas reales de la hoja de 6 componentes pasan", () => {
  // medidos en Chrome: rect vs offsetWidth/offsetHeight
  const reales = [
    ["wokwi-arduino-uno", 274.3125, 206.59375, 274, 207, 1.0],
    ["wokwi-led", 52, 65, 40, 50, 1.3],
    ["wokwi-servo", 170.1, 124.5, 170, 125, 1.0],
    ["wokwi-pushbutton", 87.5, 62.8, 67, 48, 1.3],
    ["wokwi-photoresistor-sensor", 191, 73.1, 174, 66, 1.1], // el peor caso: 0,91%
    ["wokwi-buzzer", 97.5, 108.7, 75, 84, 1.3],
    ["wokwi-potentiometer", 86.9, 92.7, 76, 81, 1.15],
  ]
  for (const [nombre, rw, rh, ow, oh, esperada] of reales) {
    const k = C.escalaUniforme(rw, rh, ow, oh)
    assert.ok(k !== null, `${nombre} quedó afuera de la guarda y no debería`)
    assert.ok(Math.abs(k - esperada) < 0.03, `${nombre}: escala ${k}, esperada ~${esperada}`)
  }
})

test("escalaUniforme: una caja estirada NO devuelve escala", () => {
  // 3% de diferencia: apenas más que el peor caso real, y ya no pasa.
  assert.equal(C.escalaUniforme(174 * 1.1, 66 * 1.1 * 1.03, 174, 66), null, "3% ya es estirado")
  // el caso feo de verdad: alguien le puso width/height por CSS
  assert.equal(C.escalaUniforme(200, 100, 40, 50), null)
  // la trampa del display:inline — offsetHeight de 17 px de una caja de 65
  assert.equal(C.escalaUniforme(52, 65, 40, 17), null, "la caja de layout miente: mejor no dibujar")
})

test("escalaUniforme: medidas imposibles devuelven null", () => {
  assert.equal(C.escalaUniforme(0, 0, 40, 50), null)
  assert.equal(C.escalaUniforme(52, 65, 0, 50), null)
  assert.equal(C.escalaUniforme(52, 65, null, 50), null)
  assert.equal(C.escalaUniforme(NaN, 65, 40, 50), null)
})

// ════════════════════════════════════════════════════════════════════════════
// el archivo se puede cargar como script clásico, sin navegador
// ════════════════════════════════════════════════════════════════════════════

test("cables.js se carga sin document y expone lo puro", () => {
  // Ya se cargó arriba en un contexto sin `document`: si la capa DOM no
  // estuviera guardada, este archivo habría explotado antes del primer test.
  for (const f of ["rutear", "anchoIntrinsecoPx", "altoIntrinsecoPx", "escalaUniforme", "ladoMasCercano"]) {
    assert.equal(typeof C[f], "function", `falta exportar ${f}`)
  }
  assert.equal(typeof caja.document, "undefined")
})

test("cables.js no tiene ninguna coordenada de circuito adentro", () => {
  // El requisito duro es que las coordenadas de cable NO existan como dato: se
  // miden. Este archivo es el único que las toca, así que acá se controla que
  // no haya aparecido una tabla de posiciones "temporal".
  const src = readFileSync(RUTA, "utf8")
  const sospechosas = src.match(/\b(?:x|y|cx|cy)\s*:\s*-?\d{3,}(?:\.\d+)?/g) || []
  assert.deepEqual(
    sospechosas,
    [],
    "aparecieron coordenadas literales en cables.js: " + sospechosas.join(", "),
  )
})
