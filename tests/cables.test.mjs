// Tests del TRAZADOR DE CABLES (opencode/tecniabot-web/cables.js).
// Corre con: node --test tests/*.test.mjs
//
// QUÉ SE PRUEBA ACÁ Y QUÉ NO — leelo antes de agregar nada.
//
// Se prueba la GEOMETRÍA, que es la parte que miente barato: un cable mal
// ruteado sale prolijo y manda al pibe al agujero de al lado. NO se prueba "el
// SVG tiene N paths": ese test pasa con los N paths al ángulo equivocado, y en
// este repo ya aparecieron SIETE tests que pasaban sin probar nada.
//
// LA REGLA, QUE ACÁ SE PAGÓ CARO: un invariante sin un test que MUERA al
// romperlo no está probado. Cada bloque de abajo dice cuál es la mutación que
// lo mata, y esa mutación se corrió. Tres tests de este mismo archivo eran el
// octavo, el noveno y el décimo test que no probaba nada:
//   · los dos de «el cable NO atraviesa la placa» aplicaban la exención del
//     tramo de salida sobre el camino YA COMPACTADO. Compactar funde el tramo
//     de salida con el que sigue, así que el segmento que atravesaba la placa
//     PASABA A SER el segmento 0 y el `.slice(1)` lo saltaba. Con
//     `libreDeLaPlaca` devolviendo siempre `true` los dos seguían en verde.
//   · el de «no hay coordenadas adentro» pedía 3 dígitos o más, y las piezas
//     chicas tienen coordenadas de 1 y 2: una tabla a mano con `A@25,42` (el
//     LED) y `1@27,84` (el buzzer) entraba entera y la suite daba 598/598.
//
// HAY UNA SEGUNDA MITAD, Y ES NUEVA: la capa DOM.
// La cabecera vieja decía que la capa DOM «no se puede probar sin navegador» y
// por eso no se probaba nada de ella — y ahí estaban los dos defectos que más
// hojas rompían (la barra gris de la escena entera, y el cable que desaparecía
// en vez de caer al fallback). No hace falta un navegador: hace falta un DOM
// FALSO con las medidas REALES, que es lo que se arma más abajo. Las medidas
// salen de Chromium sobre las hojas del catálogo y está anotado de dónde.
//
// LO QUE SIGUE SIN CUBRIRSE (hay que MIRARLO cada vez):
//   · que el dibujo se entienda;
//   · que los cables no se crucen entre sí de forma ilegible (medido: 245 de
//     1022 pares, 24%, en el catálogo a 1920 px — es heurística, no garantía);
//   · que la regla de `break-inside:avoid` la OBEDEZCA el navegador. Acá se
//     prueba que la regla se emite; que Chromium la cumple se midió con
//     `chromium --print-to-pdf` y está en el informe.
//
// Se carga el archivo REAL con `vm`, como script clásico. Dos motivos:
// (a) prueba los bytes que se instalan, no una copia; (b) la primera carga se
// hace SIN `document`, así que prueba de paso que la capa DOM está bien
// guardada — si alguien saca el `if (typeof document === "undefined") return`,
// esto explota acá y no en la netbook de la escuela.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const RUTA = join(REPO, "opencode/tecniabot-web/cables.js")
const FUENTE = readFileSync(RUTA, "utf8")

const caja = { setTimeout, clearTimeout }
vm.createContext(caja)
vm.runInContext(FUENTE, caja, { filename: "cables.js" })
const C = caja.TecniaCables

// ── medidas REALES, tomadas en Chromium sobre las hojas del catálogo ─────────
// No son inventadas: salen de getBoundingClientRect()/offsetWidth/pinInfo de
// las piezas. Si alguna cambia, el test tiene que cambiar con una medición
// nueva al lado, no con un número que "hace pasar".
const UNO = { left: 0, top: 0, right: 274.3, bottom: 206.6 } // wokwi-arduino-uno
const ESP = { left: 0, top: 0, right: 106.6, bottom: 204.3 } // wokwi-esp32-devkit-v1
const PIN_13_UNO = { x: 125, y: 9 } // header de ARRIBA
const PIN_5V_UNO = { x: 160, y: 191.5 } // header de ABAJO
const PIN_D13_ESP = { x: 5, y: 139.5 } // columna IZQUIERDA
const PIN_D23_ESP = { x: 102, y: 24 } // columna DERECHA

// wokwi-led: caja de 52×65 px con offsetWidth 40 → k = 1,3. Sus DOS pines están
// a la MISMA altura, que es el caso que hizo falta para destapar el defecto del
// escalonado.
const LED = { left: 0, top: 0, right: 52, bottom: 65 }
const LED_ANODO = { x: 25 * 1.3, y: 42 * 1.3 } // 32,5 · 54,6
const LED_CATODO = { x: 15 * 1.3, y: 42 * 1.3 } // 19,5 · 54,6

// ── chequeos escritos ACÁ a propósito ───────────────────────────────────────
// No se usan `C.cruza`, `C.esOrtogonal` ni `C.ladoMasCercano` para verificar:
// si el módulo se equivoca en su propio chequeo, el test se equivocaría igual
// y en verde.

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
function adentro(p, r) {
  return p.x > r.left + 1e-6 && p.x < r.right - 1e-6 && p.y > r.top + 1e-6 && p.y < r.bottom - 1e-6
}
function esHorizontal([a, b]) {
  return Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.x - b.x) > 1e-6
}
function esVertical([a, b]) {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) > 1e-6
}
function largo(pts) {
  let t = 0
  for (let i = 0; i + 1 < pts.length; i++) t += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y)
  return t
}
// Los puntos vienen del contexto `vm`, así que su prototipo NO es el mismo
// Object de acá y `deepEqual` los rechaza aunque tengan los mismos números.
// Se comparan las coordenadas, que es lo que importa.
function mismoPunto(a, b) {
  return !!a && !!b && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
}
function ladoMasCercanoLocal(p, r) {
  const d = { izq: p.x - r.left, der: r.right - p.x, arriba: p.y - r.top, abajo: r.bottom - p.y }
  let mejor = "izq"
  for (const k of ["der", "arriba", "abajo"]) if (d[k] < d[mejor]) mejor = k
  return mejor
}

/**
 * EL chequeo de «no atraviesa la placa», escrito para que MUERA.
 *
 * El anterior hacía `segmentos(p).slice(1)` sobre el camino compactado, o sea
 * que exoneraba al segmento 0 — y compactar puede FUNDIR el tramo de salida con
 * el tramo que sí atraviesa, convirtiendo al culpable en el segmento 0. Acá el
 * segmento 0 no se exonera: se ACOTA. El agujero está adentro de la placa, así
 * que el primer tramo arranca adentro sí o sí, pero sale por el borde más
 * cercano y no puede medir más que «lo que falta para ese borde» más el tramo
 * de salida. Un segmento 0 que cruza la placa entera mide muchísimo más.
 */
function revisarQueNoAtraviesa(p, r, salida = C.SALIDA) {
  const segs = segmentos(p)
  const lado = ladoMasCercanoLocal(p[0], r)
  const hastaElBorde = {
    izq: p[0].x - r.left, der: r.right - p[0].x, arriba: p[0].y - r.top, abajo: r.bottom - p[0].y,
  }[lado]
  const largo0 = largo([segs[0][0], segs[0][1]])
  assert.ok(
    largo0 <= hastaElBorde + salida + 1e-6,
    `el tramo de salida mide ${largo0.toFixed(1)} px cuando para salir por «${lado}» alcanzaba ` +
      `con ${(hastaElBorde + salida).toFixed(1)}: se fue de largo y atravesó la placa`,
  )
  for (let i = 1; i < p.length; i++) {
    assert.ok(!adentro(p[i], r), `el punto ${i} (${JSON.stringify(p[i])}) quedó ADENTRO de la placa`)
  }
  segs.slice(1).forEach((s, i) => {
    assert.ok(!pisa(s, r), `el tramo ${i + 1} atraviesa la placa: ${JSON.stringify(s)}`)
  })
}

/**
 * Cuántos px de dos caminos corren sobre la MISMA recta, tapándose.
 * Un cruce se ve como dos cables; un solape BORRA uno. El trazo mide 4 px
 * (`.conex .cable` es `height:4px`), así que dos rectas a menos de eso se
 * tapan.
 */
function solapeColineal(p1, p2, grosor = 4) {
  let total = 0
  for (const [a, b] of segmentos(p1)) {
    for (const [c, d] of segmentos(p2)) {
      const h1 = Math.abs(a.y - b.y) < 1e-6, h2 = Math.abs(c.y - d.y) < 1e-6
      const v1 = Math.abs(a.x - b.x) < 1e-6, v2 = Math.abs(c.x - d.x) < 1e-6
      if (h1 && h2 && Math.abs(a.y - c.y) <= grosor) {
        const x0 = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
        const x1 = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
        if (x1 - x0 > 1e-6) total += x1 - x0
      } else if (v1 && v2 && Math.abs(a.x - c.x) <= grosor) {
        const y0 = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
        const y1 = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
        if (y1 - y0 > 1e-6) total += y1 - y0
      }
    }
  }
  return total
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
// rutear — ningún tramo atraviesa la placa
// ════════════════════════════════════════════════════════════════════════════

// MUTACIÓN QUE MATA ESTE TEST: `libreDeLaPlaca` devolviendo siempre `true`.
// Ahí gana el candidato directo, que sale del D13 hacia la izquierda y vuelve
// cruzando el ESP32 entero: 155 px de primer tramo cuando para salir alcanzaba
// con 19. El chequeo VIEJO no lo atrapaba porque `compactar` fundía el tramo de
// salida con el que cruzaba y el `.slice(1)` exoneraba al resultado.
// También muere si se sacan los candidatos con rodeo (no habría camino) o si se
// cambia el lado de salida.
test("rutear: el cable NO atraviesa la placa aunque salga por el lado contrario al destino", () => {
  // Pin en la columna IZQUIERDA del ESP32 y pieza a la DERECHA: el camino
  // directo cruzaría la placa entera. Tiene que rodearla.
  const p = C.rutear({ origen: PIN_D13_ESP, destino: { x: 380, y: 140 }, placa: ESP, carril: 160 })
  assert.ok(p, "tendría que encontrar un rodeo, no rendirse")
  assert.ok(segmentos(p).length >= 3, "un rodeo no se hace con dos tramos")
  revisarQueNoAtraviesa(p, ESP)
})

test("rutear: tampoco la atraviesa cuando el destino está del otro lado en vertical", () => {
  // Sale por el header de ARRIBA del UNO y la fila está por DEBAJO de la placa.
  const p = C.rutear({ origen: PIN_13_UNO, destino: { x: 420, y: 320 }, placa: UNO, carril: 300 })
  assert.ok(p)
  revisarQueNoAtraviesa(p, UNO)
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
// MUTACIÓN QUE MATA ESTE TEST: validar DESPUÉS de compactar.
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
    revisarQueNoAtraviesa(p, UNO)
  }
  assert.ok(hubo > 0, "ningún carril dio camino: el test estaría pasando sin probar nada")
})

// ════════════════════════════════════════════════════════════════════════════
// rutear — GANA EL MÁS CORTO, Y EL LARGO SE MIDE EN CRUDO
// ════════════════════════════════════════════════════════════════════════════

// No había ningún test de esto: `rutear` se podía cambiar para que ganara el
// último candidato y la suite seguía verde, con el peor camino de la hoja
// pasando de 459 a 807,6 px.
//
// MUTACIÓN QUE MATA ESTE TEST: `L > mejorLargo`, quedarse con el último, o
// sacar uno de los dos pasillos. El de arriba mide 320 px menos que el de
// abajo y los asserts comparan contra los dos números, calculados acá.
test("rutear: entre dos rodeos válidos gana el MÁS CORTO", () => {
  const o = { x: 5, y: 24 } // EN, columna izquierda, arriba del todo
  const d = { x: 380, y: 20 } // pieza a la derecha y ARRIBA: conviene el pasillo de arriba
  const carril = 160
  const stub = { x: ESP.left - C.SALIDA, y: o.y }
  const porArriba = largo([
    o, stub, { x: stub.x, y: ESP.top - C.MARGEN }, { x: carril, y: ESP.top - C.MARGEN }, { x: carril, y: d.y }, d,
  ])
  const porAbajo = largo([
    o, stub, { x: stub.x, y: ESP.bottom + C.MARGEN }, { x: carril, y: ESP.bottom + C.MARGEN }, { x: carril, y: d.y }, d,
  ])
  assert.ok(porArriba < porAbajo - 300, "el caso no discrimina: los dos rodeos miden casi lo mismo")

  const p = C.rutear({ origen: o, destino: d, placa: ESP, carril })
  assert.ok(p, "tendría que haber rodeo")
  revisarQueNoAtraviesa(p, ESP)
  assert.ok(p.some((q) => q.y < ESP.top), "eligió un camino que no pasa por arriba de la placa, que es el corto")
  assert.ok(
    !p.some((q) => q.y > ESP.bottom),
    "se fue por abajo, que mide " + (porAbajo - porArriba).toFixed(0) + " px más",
  )
  assert.ok(
    Math.abs(largo(p) - porArriba) < 0.01,
    `el camino mide ${largo(p).toFixed(1)} px y el rodeo corto mide ${porArriba.toFixed(1)}`,
  )
})

// ESTE ES EL DEFECTO Nº2 DE LA AUDITORÍA, Y ES EL QUE MÁS PÍXELES DE CABLE
// BORRABA. Tres cosas se juntaban:
//   · el tramo de salida se escalona (14, 21, 28… px) para que dos cables que
//     salen del mismo borde no corran sobre la misma recta;
//   · el candidato con rodeo por el MISMO lado RETROCEDE (sale a borde+21 y
//     vuelve a borde+8): tres puntos colineales;
//   · y `rutear` medía el largo DESPUÉS de compactar, que borra justo esos tres
//     puntos y con ellos los 2×6 px de la ida y la vuelta.
// Resultado: el rodeo "medía" 12 px menos, ganaba siempre, y su pasillo está en
// `margen`, que es el MISMO para todos: el escalonado no existía. Medido en
// `uno-simple`: los dos cables del LED corriendo solapados 499 px (se ve uno) y
// el 220Ω —que va en el medio del tramo horizontal más largo— montado sobre el
// cable de GND en vez del del ánodo.
//
// MUTACIÓN QUE MATA ESTE TEST: medir `largoDe(compactar(candidatos[c]))` en vez
// de `largoDe(candidatos[c])`. También muere si el desempate deja de darle la
// prioridad al candidato directo (`L <= mejorLargo`).
test("rutear: dos cables con distinto tramo de salida NO comparten recta", () => {
  // El LED tiene ánodo y cátodo a la MISMA altura. Son dos filas distintas, así
  // que dos etiquetas a distinta altura, pero el mismo borde de salida.
  const a = C.rutear({ origen: LED_ANODO, destino: { x: -500, y: -30 }, placa: LED, carril: -14, salida: C.SALIDA })
  const c = C.rutear({ origen: LED_CATODO, destino: { x: -500, y: 20 }, placa: LED, carril: -23, salida: C.SALIDA + 7 })
  assert.ok(a && c, "los dos tendrían que tener camino")

  assert.ok(
    Math.abs(a[1].y - (LED.bottom + C.SALIDA)) < 1e-6,
    `el tramo de salida del ánodo terminó en y=${a[1].y} y tenía que terminar en ${LED.bottom + C.SALIDA}`,
  )
  assert.ok(
    Math.abs(c[1].y - (LED.bottom + C.SALIDA + 7)) < 1e-6,
    `el tramo de salida del cátodo terminó en y=${c[1].y} y tenía que terminar en ${LED.bottom + C.SALIDA + 7}: ` +
      "el escalonado se perdió y los dos cables salen a la misma altura",
  )
  assert.equal(
    solapeColineal(a, c),
    0,
    "los dos cables corren sobre la misma recta: el que se dibuja segundo BORRA al primero",
  )
})

// El mismo defecto dicho por el otro lado: que quede escrito que el camino
// elegido es MÁS LARGO que el rival medido mal, y que se elige igual.
//
// MUTACIÓN QUE MATA ESTE TEST: comparar caminos compactados.
test("rutear: un rodeo que retrocede no puede ganar por los px que compactar le borra", () => {
  const salida = C.SALIDA + 7
  const p = C.rutear({ origen: LED_ANODO, destino: { x: -500, y: -30 }, placa: LED, carril: -14, salida })
  assert.ok(p)

  // el rival: el rodeo por abajo, que sale a bottom+salida y RETROCEDE a
  // bottom+margen. Compactado mide 2×(salida−margen) menos, porque los tres
  // puntos de la vuelta son colineales.
  const stub = { x: LED_ANODO.x, y: LED.bottom + salida }
  const yb = LED.bottom + C.MARGEN
  const rodeoCrudo = [
    LED_ANODO, stub, { x: LED_ANODO.x, y: yb }, { x: -14, y: yb }, { x: -14, y: -30 }, { x: -500, y: -30 },
  ]
  const rodeoCompactado = C.compactar(rodeoCrudo)
  assert.ok(
    largo(rodeoCompactado) < largo(rodeoCrudo) - 1,
    "el caso no discrimina: compactar tendría que acortar este rodeo",
  )
  assert.ok(
    largo(p) > largo(rodeoCompactado) + 1,
    "el camino elegido no es el que compactar haría ganar: el test no prueba nada",
  )
  assert.ok(
    Math.abs(p[1].y - stub.y) < 1e-6,
    `se eligió el rodeo: el tramo de salida quedó en y=${p[1].y} en vez de ${stub.y}`,
  )
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
// compactar — se exporta y no tenía UN SOLO test directo
// ════════════════════════════════════════════════════════════════════════════
//
// Se le podía sacar la fusión de colineales o la deduplicación y la suite
// seguía verde. Y no es una función decorativa: de que compactar ACORTE los
// retrocesos salió el defecto nº2 entero.
//
// MUTACIÓN QUE MATA ESTOS TESTS: sacar la deduplicación (sobra el punto
// repetido), sacar la fusión de colineales (sobran los codos de 0°), o hacerla
// en una sola pasada (el `while` tiene que volver sobre lo ya fusionado).
test("compactar: saca los puntos repetidos y funde los codos de 0 grados", () => {
  const dado = C.compactar([
    { x: 0, y: 0 },
    { x: 0, y: 0 }, // repetido
    { x: 10, y: 0 }, // colineal con el próximo
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 20, y: 10 }, // repetido
  ])
  assert.deepEqual(Array.from(dado).map((p) => [p.x, p.y]), [[0, 0], [20, 0], [20, 10]])
})

test("compactar: tres colineales seguidos se funden todos, no de a uno", () => {
  const dado = C.compactar([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 9 }])
  assert.deepEqual(Array.from(dado).map((p) => [p.x, p.y]), [[0, 0], [15, 0], [15, 9]])
})

// La deduplicación parece redundante con la fusión de colineales —un punto
// repetido ES colineal con sus vecinos— y casi lo es: la única diferencia está
// en los EXTREMOS, que la fusión no mira. Ahí es donde importa. Un camino que
// es todo el mismo punto tiene que quedar en UN punto, para que `rutear` lo
// descarte por `pts.length < 2`. Sin dedup queda en dos, pasa el filtro, y se
// dibuja un trazo de largo cero: un puntito de color sobre la hoja.
//
// MUTACIÓN QUE MATA ESTE TEST: sacar la deduplicación de `compactar`.
test("compactar: un camino que no va a ningún lado queda en UN punto, no en dos", () => {
  assert.equal(C.compactar([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }]).length, 1)
  assert.equal(
    C.rutear({ origen: { x: 5, y: 5 }, destino: { x: 5, y: 5 } }),
    null,
    "un cable de largo cero no es un cable: tiene que devolver null y quedarse con el CSS",
  )
})

test("compactar: no toca las puntas", () => {
  const o = { x: 3, y: 7 }, d = { x: 100, y: 7 }
  const dado = C.compactar([o, { x: 50, y: 7 }, d])
  assert.ok(mismoPunto(dado[0], o))
  assert.ok(mismoPunto(dado[dado.length - 1], d))
})

// ESTO es lo que hay que tener presente cuando se usa compactar para DECIDIR
// algo: un retroceso son tres puntos colineales, y fundirlos ACORTA el camino.
// El largo de un camino compactado no es el largo de ese camino.
test("compactar: un retroceso se funde, y al fundirse el camino MIDE MENOS", () => {
  const conVuelta = [{ x: 0, y: 20 }, { x: 0, y: 0 }, { x: 0, y: 8 }, { x: 40, y: 8 }]
  const compactado = C.compactar(conVuelta)
  assert.deepEqual(Array.from(compactado).map((p) => [p.x, p.y]), [[0, 20], [0, 8], [40, 8]])
  assert.equal(largo(conVuelta), 20 + 8 + 40)
  assert.equal(largo(compactado), 12 + 40)
  assert.ok(largo(compactado) < largo(conVuelta), "si esto dejara de pasar, el defecto nº2 no existiría")
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
// la guarda de la escala — ES EL REDONDEO, MODELADO, NO UN 2% REDONDO
// ════════════════════════════════════════════════════════════════════════════
//
// `offsetWidth/offsetHeight` son enteros, así que dos escalas medidas sobre
// cajas redondeadas se separan solas hasta 0,5·(1/ancho + 1/alto). El 2% plano
// no distinguía tamaño: le perdonaba a la placa cuatro veces más de lo que el
// redondeo explica y le negaba a las piezas chicas lo que el redondeo les
// impone. Las medidas de abajo clavan la tolerancia entre dos paredes REALES y
// todas se midieron en Chromium sobre el catálogo.
//
// MUTACIÓN QUE MATA ESTOS TESTS:
//   · volver al 2% plano → el neopixel queda afuera (muere el primer test) Y la
//     placa estirada 1,5% pasa (muere el tercero);
//   · sacarle el término del redondeo → muere el neopixel;
//   · subir `TOL_BASE` a 5% → pasan el mpu6050 y el tilt-switch, que están
//     estirados de verdad (muere el segundo).

const PIEZAS_REALES = [
  // [nombre, rect.width, rect.height, offsetWidth, offsetHeight, escala esperada]
  ["wokwi-arduino-uno", 274.3125, 206.5938, 274, 207, 1.0],
  ["wokwi-esp32-devkit-v1", 133.2227, 261.6016, 107, 209, 1.245],
  ["wokwi-led", 52, 65, 40, 50, 1.3],
  ["wokwi-servo", 170.0781, 124.5313, 170, 125, 1.0],
  ["wokwi-pushbutton", 87.4656, 62.8469, 67, 48, 1.305],
  ["wokwi-photoresistor-sensor", 191.0219, 73.1156, 174, 66, 1.098],
  ["wokwi-buzzer", 97.5, 108.6516, 75, 84, 1.3],
  ["wokwi-potentiometer", 86.9148, 92.6649, 76, 81, 1.144],
  ["wokwi-membrane-keypad", 239.2454, 263.0109, 266, 292, 0.899],
  // la que el 2% plano dejaba afuera: caja de 21×24 px, 2,274% de desvío que es
  // TODO redondeo (la cota del redondeo para esa caja es 4,46%).
  ["wokwi-neopixel", 29.9469, 33.4469, 21, 24, 1.426],
]

test("escalaUniforme: las 10 piezas reales medidas en el catálogo pasan", () => {
  for (const [nombre, rw, rh, ow, oh, esperada] of PIEZAS_REALES) {
    const k = C.escalaUniforme(rw, rh, ow, oh)
    assert.ok(k !== null, `${nombre} quedó afuera de la guarda y no debería`)
    assert.ok(Math.abs(k - esperada) < 0.01, `${nombre}: escala ${k}, esperada ~${esperada}`)
  }
})

test("escalaUniforme: las dos piezas que SÍ están estiradas quedan afuera", () => {
  assert.equal(C.escalaUniforme(89.0276, 75.5955, 82, 66), null, "wokwi-mpu6050 desvía 5,50% con una cota de 1,87%")
  assert.equal(C.escalaUniforme(99.0933, 77.611, 88, 61), null, "wokwi-tilt-switch desvía 12,99% con una cota de 1,39%")
})

test("escalaUniforme: una placa apenas estirada YA no pasa — el 2% plano la dejaba entrar", () => {
  // El UNO real desvía 0,31% y la cota del redondeo para su caja es 0,92%.
  const [, rw, rh, ow, oh] = PIEZAS_REALES[0]
  assert.ok(C.escalaUniforme(rw, rh, ow, oh) !== null, "el UNO de verdad tiene que pasar")
  assert.equal(
    C.escalaUniforme(rw, rh * 1.015, ow, oh),
    null,
    "un UNO estirado 1,5% pasaba con el 2% plano: son 4 px de error en el agujero del pin 13, con el dibujo impecable",
  )
})

test("escalaUniforme: una caja estirada NO devuelve escala", () => {
  // 3% de diferencia sobre el fotorresistor, cuya cota total es 1,545%
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
// pinAdentro — que el pin EXISTA no quiere decir que caiga en el dibujo
// ════════════════════════════════════════════════════════════════════════════
//
// MUTACIÓN QUE MATA ESTOS TESTS: sacar la guarda (todo adentro) o subir la
// tolerancia por arriba de 41 px. El corte está en 2 px, que es cuatro veces el
// peor sobrepaso legítimo de las 36 piezas del catálogo y la vigésima parte del
// que no lo es.

test("pinAdentro: el teclado publica sus 8 pines FUERA de su propio dibujo", () => {
  // wokwi-membrane-keypad, medido: caja 239,2454×263,0109 con offsetWidth 266 →
  // k = 0,8994. Sus 8 pines están en y=338 → 304 px, o sea 41 px por debajo de
  // una caja de 263. Es la ÚNICA de las 36 piezas así.
  const k = 239.2454 / 266
  for (const [nombre, x, y] of [["R1", 100, 338], ["C4", 167.5, 338]]) {
    assert.equal(
      C.pinAdentro({ x: x * k, y: y * k }, 239.2454, 263.0109),
      false,
      `${nombre} del teclado cae ${(y * k - 263.0109).toFixed(1)} px por debajo del dibujo y se dibujaba igual`,
    )
  }
})

test("pinAdentro: el peor sobrepaso legítimo del catálogo SÍ entra", () => {
  // wokwi-buzzer: caja 97,5×108,6516, k = 1,3, su pin de abajo cae en y = 109,2.
  // Se pasa 0,55 px del borde. Es el peor de las otras 35 piezas.
  assert.equal(C.pinAdentro({ x: 35.1, y: 109.2 }, 97.5, 108.6516), true)
  // y los pines que apoyan justo sobre el borde, que son legión
  assert.equal(C.pinAdentro({ x: 0, y: 50 }, 170.0781, 124.5313), true, "el GND del servo apoya en x=0")
})

test("pinAdentro: la tolerancia corta donde dice que corta", () => {
  assert.equal(C.TOL_PIN, 2)
  assert.equal(C.pinAdentro({ x: 50, y: 101.9 }, 100, 100), true, "1,9 px afuera entra")
  assert.equal(C.pinAdentro({ x: 50, y: 102.1 }, 100, 100), false, "2,1 px afuera no entra")
  assert.equal(C.pinAdentro({ x: -1.9, y: 50 }, 100, 100), true)
  assert.equal(C.pinAdentro({ x: -2.1, y: 50 }, 100, 100), false)
  assert.equal(C.pinAdentro({ x: NaN, y: 5 }, 100, 100), false)
  assert.equal(C.pinAdentro({ x: 5, y: 5 }, 0, 100), false, "sin caja no hay adentro")
})

// ════════════════════════════════════════════════════════════════════════════
// limitesUtiles — cuando la PLACA no entra en el recuadro
// ════════════════════════════════════════════════════════════════════════════
//
// Medido en `e-servo` (ESP32, 1920 px): la escena va de y=124 a y=351,3 y la
// placa de y=108,8 a y=370,4. La placa SOBRESALE 15,2 px por arriba y 19,1 por
// abajo. Con el recuadro como límite duro, `corredor()` devolvía null en los
// dos sentidos y todo el header izquierdo del ESP32 —el que necesita rodear la
// placa— caía al cable CSS: 14 de 116 filas, 12 de 33 hojas. En silencio, y
// dependiendo de cuántos componentes tuviera la hoja.
//
// MUTACIÓN QUE MATA ESTOS TESTS: volver a usar el recuadro de la escena como
// `limites` (mueren los tres últimos), o aflojar siempre con `Math.min` en vez
// de sólo del lado por el que la placa se sale (muere el primero).

const ESCENA_CHICA = { left: 480, top: 124, right: 1440, bottom: 351.3 }
const PLACA_DESBORDADA = { left: 529.4, top: 108.8, right: 662.6, bottom: 370.4 }
const HOLGURA = C.MARGEN + C.SALIDA + 2

test("limitesUtiles: donde la placa ENTRA, el límite sigue siendo el recuadro exacto", () => {
  const adentroDeTodo = { left: 500, top: 150, right: 700, bottom: 300 }
  const l = C.limitesUtiles(ESCENA_CHICA, adentroDeTodo, 999)
  assert.deepEqual(
    [l.left, l.top, l.right, l.bottom],
    [ESCENA_CHICA.left, ESCENA_CHICA.top, ESCENA_CHICA.right, ESCENA_CHICA.bottom],
    "aflojó un límite que no hacía falta aflojar: por ahí se escapan los cables",
  )
})

test("limitesUtiles: donde la placa SE SALE, el cable puede acompañarla", () => {
  const l = C.limitesUtiles(ESCENA_CHICA, PLACA_DESBORDADA, HOLGURA)
  assert.equal(l.top, PLACA_DESBORDADA.top - HOLGURA)
  assert.equal(l.bottom, PLACA_DESBORDADA.bottom + HOLGURA)
  // y de costado, donde la placa entra holgada, NO se afloja
  assert.equal(l.left, ESCENA_CHICA.left)
  assert.equal(l.right, ESCENA_CHICA.right)
})

test("limitesUtiles: sin ella, el ESP32 de `e-servo` no tiene NINGÚN pasillo", () => {
  assert.equal(
    C.corredor(PLACA_DESBORDADA, "arriba", C.MARGEN, ESCENA_CHICA),
    null,
    "el pasillo de arriba tendría que estar tapado por el recuadro",
  )
  assert.equal(C.corredor(PLACA_DESBORDADA, "abajo", C.MARGEN, ESCENA_CHICA), null)

  const l = C.limitesUtiles(ESCENA_CHICA, PLACA_DESBORDADA, HOLGURA)
  assert.equal(C.corredor(PLACA_DESBORDADA, "arriba", C.MARGEN, l), PLACA_DESBORDADA.top - C.MARGEN)
  assert.equal(C.corredor(PLACA_DESBORDADA, "abajo", C.MARGEN, l), PLACA_DESBORDADA.bottom + C.MARGEN)
})

test("limitesUtiles: y con ella el cable del header izquierdo del ESP32 se rutea", () => {
  // D13 de la columna izquierda (x=5 intrínseco, k=1,2451) y su nodo a la
  // derecha de la placa: el directo cruzaría el ESP32 entero.
  const origen = { x: PLACA_DESBORDADA.left + 5 * 1.2451, y: 250 }
  const destino = { x: 1000, y: 250 }
  const carril = PLACA_DESBORDADA.right + C.MARGEN

  assert.equal(
    C.rutear({ origen, destino, placa: PLACA_DESBORDADA, carril, limites: ESCENA_CHICA }),
    null,
    "con el recuadro como límite duro este cable NO se puede trazar — ése era el defecto",
  )
  const l = C.limitesUtiles(ESCENA_CHICA, PLACA_DESBORDADA, HOLGURA)
  const p = C.rutear({ origen, destino, placa: PLACA_DESBORDADA, carril, limites: l })
  assert.ok(p, "con los límites útiles tiene que haber camino")
  revisarQueNoAtraviesa(p, PLACA_DESBORDADA)
})

// ════════════════════════════════════════════════════════════════════════════
// el archivo se puede cargar como script clásico, sin navegador
// ════════════════════════════════════════════════════════════════════════════

test("cables.js se carga sin document y expone lo puro", () => {
  // Ya se cargó arriba en un contexto sin `document`: si la capa DOM no
  // estuviera guardada, este archivo habría explotado antes del primer test.
  for (const f of [
    "rutear", "anchoIntrinsecoPx", "altoIntrinsecoPx", "escalaUniforme",
    "ladoMasCercano", "compactar", "corredor", "limitesUtiles", "pinAdentro",
  ]) {
    assert.equal(typeof C[f], "function", `falta exportar ${f}`)
  }
  assert.equal(typeof caja.document, "undefined")
})

// ════════════════════════════════════════════════════════════════════════════
// el requisito duro: NINGUNA coordenada de circuito adentro de cables.js
// ════════════════════════════════════════════════════════════════════════════
//
// La guarda vieja pedía TRES dígitos o más (`\d{3,}`), y las piezas chicas
// tienen coordenadas de uno y dos: el auditor metió una tabla a mano con las
// posiciones COMPLETAS del LED y del buzzer y la suite dio 598/598. O sea que
// la guarda no cubría justamente las piezas más chicas, que son donde un píxel
// de error se nota más.
//
// Ahora se buscan las tres formas que puede tener una tabla de posiciones, y se
// buscan SOBRE EL CÓDIGO, no sobre los comentarios: un comentario no manda
// ningún cable a ningún lado, y el precio de contarlos era no poder nombrar un
// pin al explicar por qué el ruteo hace lo que hace. Las reglas se prueban
// contra positivos sintéticos, así que la guarda no puede pasar de vacía.
//
// MUTACIÓN QUE MATA ESTOS TESTS: volver a `\d{3,}` (mueren los tres positivos
// chicos), o sacar cualquiera de las reglas (muere la suya).

/**
 * Saca comentarios de bloque y de línea. Conservador a propósito: el `//` de
 * línea sólo se corta si viene precedido de espacio, principio de línea o
 * apertura, para no comerse el `http://` de un string.
 */
function soloCodigo(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s(;,{[])\/\/[^\n]*/gm, "$1")
}

const REGLAS_DE_COORDENADA = [
  // 1. un objeto literal con x E y numéricos. Con uno solo numérico no alcanza:
  //    `{x: n, y: 0}` es estructura, no posición.
  [/[{,]\s*c?x\s*:\s*-?\d[\d.]*\s*,\s*c?y\s*:\s*-?\d[\d.]*/g, "par {x:n, y:n}"],
  // 2. un par de números en un array
  [/\[\s*-?\d[\d.]*\s*,\s*-?\d[\d.]*\s*[,\]]/g, "par [n, n]"],
  // 3. la forma compacta con la que se nombra un pin y su posición
  [/\w+\s*@\s*-?\d[\d.]*\s*,\s*-?\d[\d.]*/g, "tabla NOMBRE@n,n"],
  // 4. la vieja, que igual sirve para un número suelto y grande
  [/\b(?:x|y|cx|cy)\s*:\s*-?\d{3,}(?:\.\d+)?/g, "coordenada de 3+ dígitos"],
]

function coordenadasEn(src) {
  const out = []
  for (const [re, que] of REGLAS_DE_COORDENADA) {
    for (const m of src.match(re) || []) out.push(que + ": " + m.trim())
  }
  return out
}

test("la guarda de coordenadas atrapa las tablas que el auditor metió a mano", () => {
  // las dos que entraron enteras con la guarda vieja
  assert.ok(coordenadasEn('var TABLA = { led: "A' + "@25,42" + '", buzzer: "1' + "@27,84" + '" }').length >= 2)
  assert.ok(coordenadasEn("var UNO_ANODO = { x: 25, y: 42 }").length >= 1)
  assert.ok(coordenadasEn("var PINES = { A: [25, 42], C: [15, 42] }").length >= 2)
  assert.ok(coordenadasEn("var p = { cx: 27, cy: 84 }").length >= 1)
  // y la que ya atrapaba
  assert.ok(coordenadasEn("var p = { x: 1453, y: 897 }").length >= 1)

  // NO son coordenadas: estructura con un solo literal, y cuentas con símbolos
  assert.deepEqual(coordenadasEn("return h ? { x: n, y: 0 } : { x: 0, y: n }"), [])
  assert.deepEqual(coordenadasEn("var c = { x: carril, y: a.y }"), [])
  assert.deepEqual(coordenadasEn("var banda = [placa.right + MARGEN, minNodoX - 10]"), [])
})

test("el quitador de comentarios saca la prosa y NO saca el código", () => {
  const tabla = "A" + "@25,42"
  assert.equal(coordenadasEn(soloCodigo("// el LED tiene " + tabla)).length, 0)
  assert.equal(coordenadasEn(soloCodigo("/* el LED tiene " + tabla + " */")).length, 0)
  assert.ok(coordenadasEn(soloCodigo('var T = { led: "' + tabla + '" } // el LED')).length >= 1)
  // y no se come un string con `//` adentro
  assert.ok(soloCodigo('var NS = "http://www.w3.org/2000/svg"').includes("w3.org"))
})

test("cables.js no tiene ninguna coordenada de circuito adentro", () => {
  // El requisito duro es que las coordenadas de cable NO existan como dato: se
  // miden. Este archivo es el único que las toca, así que acá se controla que
  // no haya aparecido una tabla de posiciones "temporal".
  const sospechosas = coordenadasEn(soloCodigo(FUENTE))
  assert.deepEqual(sospechosas, [], "aparecieron coordenadas literales en cables.js: " + sospechosas.join(" · "))
})

// ════════════════════════════════════════════════════════════════════════════
// ══════════════ LA CAPA DOM, con un DOM falso y medidas reales ══════════════
// ════════════════════════════════════════════════════════════════════════════
//
// Acá viven los dos defectos que más hojas rompían, y los dos son de la capa
// que "no se podía probar". El DOM falso implementa exactamente lo que
// `trazarEscena` usa: querySelector con clases y atributos, rects, offsetWidth,
// getComputedStyle y `pinInfo`. Las medidas de las piezas y de la escena son
// las de Chromium sobre las hojas del catálogo.

class Elemento {
  constructor(tag, o = {}) {
    this.tagName = tag.toUpperCase()
    this.children = []
    this.parentElement = null
    this.style = {}
    this.shadowRoot = null
    this._attrs = { ...(o.attrs || {}) }
    if (o.clase) this._attrs.class = o.clase
    this._rect = o.rect || null
    this._css = o.css || {}
    this.offsetWidth = o.caja ? o.caja[0] : 0
    this.offsetHeight = o.caja ? o.caja[1] : 0
    this.clientWidth = o.cliente ? o.cliente[0] : 0
    this.clientHeight = o.cliente ? o.cliente[1] : 0
    if (o.pines) this.pinInfo = o.pines.map(([name, x, y]) => ({ name, x, y }))
    for (const h of o.hijos || []) this.appendChild(h)
  }
  get id() { return this._attrs.id }
  set id(v) { this._attrs.id = v }
  appendChild(n) {
    n.parentElement = this
    this.children.push(n)
    return n
  }
  remove() {
    const i = this.parentElement ? this.parentElement.children.indexOf(this) : -1
    if (i >= 0) this.parentElement.children.splice(i, 1)
  }
  getAttribute(n) { return n in this._attrs ? String(this._attrs[n]) : null }
  setAttribute(n, v) { this._attrs[n] = String(v) }
  removeAttribute(n) { delete this._attrs[n] }
  hasAttribute(n) { return n in this._attrs }
  getBoundingClientRect() {
    const r = this._rect || { left: 0, top: 0, right: 0, bottom: 0 }
    return { ...r, width: r.right - r.left, height: r.bottom - r.top }
  }
  get clases() { return (this._attrs.class || "").split(/\s+/).filter(Boolean) }
  descendientes(out = []) {
    for (const h of this.children) {
      out.push(h)
      h.descendientes(out)
    }
    return out
  }
  querySelectorAll(sel) {
    const partes = sel.trim().split(/\s+/).map(tokenizar)
    return this.descendientes().filter((el) => cumpleCadena(el, partes, this))
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
}

function tokenizar(compuesto) {
  return compuesto.match(/\.[-\w]+|\[[^\]]+\]|[-\w]+/g) || []
}
function coincide(el, tokens) {
  for (const t of tokens) {
    if (t[0] === ".") {
      if (!el.clases.includes(t.slice(1))) return false
    } else if (t[0] === "[") {
      if (!el.hasAttribute(t.slice(1, -1))) return false
    } else if (el.tagName.toLowerCase() !== t) return false
  }
  return true
}
function cumpleCadena(el, partes, raiz) {
  let i = partes.length - 1
  if (!coincide(el, partes[i])) return false
  i--
  let n = el.parentElement
  while (i >= 0 && n && n !== raiz.parentElement) {
    if (coincide(n, partes[i])) i--
    n = n.parentElement
  }
  return i < 0
}

/** Carga cables.js en un contexto con el DOM falso puesto. */
function montar(escena) {
  const documental = new Elemento("html")
  const cabeza = new Elemento("head")
  const cuerpo = new Elemento("body")
  documental.appendChild(cabeza)
  documental.appendChild(cuerpo)
  cuerpo.appendChild(escena)

  const ventana = {
    getComputedStyle(el) {
      const d = {
        position: "static", transform: "none", filter: "none", perspective: "none",
        borderLeftWidth: "0px", borderTopWidth: "0px", display: "block",
        ...(el._css || {}),
      }
      d.getPropertyValue = (k) => (el._css && k in el._css ? el._css[k] : "")
      return d
    },
    addEventListener() {},
  }
  const documento = {
    // "loading" a propósito: `arrancar()` no se dispara solo y cada test llama
    // a `trazarTodo()` cuando quiere.
    readyState: "loading",
    documentElement: documental,
    head: cabeza,
    body: cuerpo,
    querySelectorAll: (s) => documental.querySelectorAll(s),
    querySelector: (s) => documental.querySelector(s),
    createElement: (t) => new Elemento(t),
    createElementNS: (_ns, t) => new Elemento(t),
    getElementById: (id) => documental.descendientes().find((e) => e.id === id) || null,
    addEventListener() {},
  }
  const ctx = { document: documento, window: ventana, setTimeout, clearTimeout }
  ctx.globalThis = ctx
  vm.createContext(ctx)
  vm.runInContext(FUENTE, ctx, { filename: "cables.js" })
  return { api: ctx.TecniaCables, documento, escena }
}

// ── las medidas reales de una hoja, y el armador de escenas ──────────────────
// Medido en Chromium a 1920 px sobre `u-led.html`: la escena va de x=480 a
// x=1440, la columna de nodos arranca en x=786 y las etiquetas van de x=806 a
// x=900, con cajas de 40 px de alto.
const HOJA = { izq: 480, der: 1440, nodoX: 786, labelIzq: 806, labelDer: 900, altoLabel: 40 }

function unPin({ nom, placa, pieza, y, res = false }) {
  const h = HOJA.altoLabel
  const hijos = [
    new Elemento("span", {
      clase: "nodo",
      rect: { left: HOJA.nodoX, top: y + h / 2 - 6, right: HOJA.nodoX + 12, bottom: y + h / 2 + 6 },
    }),
    new Elemento("span", {
      clase: "label",
      rect: { left: HOJA.labelIzq, top: y, right: HOJA.labelDer, bottom: y + h },
    }),
    new Elemento("span", {
      clase: "cable",
      rect: { left: HOJA.labelDer, top: y + h / 2 - 2, right: HOJA.labelDer + 30, bottom: y + h / 2 + 2 },
    }),
  ]
  if (res) hijos.push(new Elemento("span", { clase: "res", rect: { left: 0, top: 0, right: 30, bottom: 16 } }))
  return new Elemento("span", {
    clase: "pin",
    attrs: { "data-placa": placa, "data-pieza": pieza, "data-nom": nom },
    css: { "--c": "#f39c12" },
    hijos,
  })
}

function armarEscena(spec) {
  const e = spec.escena
  const placaEl = new Elemento(spec.placa.tag, {
    rect: spec.placa.rect, caja: spec.placa.caja, pines: spec.placa.pines,
  })
  const filas = spec.filas.map(
    (f) =>
      new Elemento("div", {
        clase: "fila",
        hijos: [
          new Elemento("div", {
            clase: "pieza-cell",
            hijos: [new Elemento(f.pieza.tag, { rect: f.pieza.rect, caja: f.pieza.caja, pines: f.pieza.pines })],
          }),
          new Elemento("div", { clase: "conex", hijos: f.pines.map(unPin) }),
        ],
      }),
  )
  return new Elemento("div", {
    clase: "escena",
    rect: e,
    cliente: [e.right - e.left, e.bottom - e.top],
    css: { position: "relative" },
    hijos: [
      new Elemento("div", {
        clase: "circuito-libre",
        hijos: [
          new Elemento("div", { clase: "esp-col", hijos: [placaEl] }),
          new Elemento("div", { clase: "filas-libre", css: { position: "relative" }, hijos: filas }),
        ],
      }),
    ],
  })
}

// Las piezas, con sus medidas y su `pinInfo` REALES (Chromium, 1920 px).
const P_UNO = (left, top) => ({
  tag: "wokwi-arduino-uno",
  rect: { left, top, right: left + 274.3125, bottom: top + 206.5938 },
  caja: [274, 207],
  pines: [["GND.1", 115.5, 9], ["13", 125, 9], ["12", 134.5, 9], ["5V", 160, 191.5], ["A0", 208, 191.5]],
})
const P_ESP = (left, top) => ({
  tag: "wokwi-esp32-devkit-v1",
  rect: { left, top, right: left + 133.2227, bottom: top + 261.6016 },
  caja: [107, 209],
  // columna IZQUIERDA en x=5, columna DERECHA en x=101,3
  pines: [["D13", 5, 139.5], ["GND.2", 5, 149], ["D23", 101.3, 24], ["3V3", 101.3, 158.5]],
})
const P_LED = (left, top) => ({
  tag: "wokwi-led",
  rect: { left, top, right: left + 52, bottom: top + 65 },
  caja: [40, 50],
  pines: [["A", 25, 42], ["C", 15, 42]],
})
const P_TECLADO = (left, top) => ({
  tag: "wokwi-membrane-keypad",
  rect: { left, top, right: left + 239.2454, bottom: top + 263.0109 },
  caja: [266, 292],
  // los 8 pines en y=338 sobre una caja de 263 px de alto: 41 px POR DEBAJO
  pines: [["R1", 100, 338], ["C1", 138.5, 338]],
})
const P_LDR = (left, top) => ({
  tag: "wokwi-photoresistor-sensor",
  rect: { left, top, right: left + 191.0219, bottom: top + 73.1156 },
  caja: [174, 66],
  // los CUATRO pines pegados al borde DERECHO (x=172 de 174)
  pines: [["VCC", 172, 16], ["GND", 172, 26], ["AO", 172, 45.5]],
})
const P_ESTIRADA = (left, top) => ({
  tag: "wokwi-mpu6050",
  rect: { left, top, right: left + 89.0276, bottom: top + 75.5955 },
  caja: [82, 66], // desvía 5,50% con una cota de 1,87%: no se puede medir
  pines: [["SDA", 10, 10], ["GND", 20, 10]],
})

const cablesVisibles = (escena) =>
  escena.querySelectorAll(".conex .cable").filter((c) => c.style.display !== "none")

/** El `d` del path viene relativo a la esquina interior de la escena. */
function puntosDe(d, escena) {
  const r = escena.getBoundingClientRect()
  const n = d.replace(/[ML]/g, " ").trim().split(/\s+/).map(Number)
  const out = []
  for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i] + r.left, y: n[i + 1] + r.top })
  return out
}

// ════════════════════════════════════════════════════════════════════════════
// DEFECTO Nº1: la barra gris se ocultaba para la escena entera
// ════════════════════════════════════════════════════════════════════════════
//
// La regla colgaba de `[data-cables-trazados]`, o sea que alcanzaba con que UN
// cable se trazara para que la barra desapareciera de toda la escena — y los
// cables que habían caído al fallback CSS se quedaban sin nada de dónde nacer.
// Medido sobre el catálogo: 26 de las 79 hojas así, entre ellas `estacion-meteo`
// con los 4 cables del LCD como palitos de colores flotando.
//
// MUTACIÓN QUE MATA ESTOS TESTS: volver a colgar la regla de
// `data-cables-trazados`, o poner `data-cables-barra="oculta"` sin mirar
// cuántos cables CSS quedaron a la vista.

function hojaMixta() {
  // dos filas: el LED se puede medir y trazar; el mpu6050 está estirado y cae
  // al cable CSS. Es exactamente la forma de las 26 hojas rotas.
  return armarEscena({
    escena: { left: HOJA.izq, top: 124, right: HOJA.der, bottom: 460 },
    placa: P_UNO(500, 200),
    filas: [
      { pieza: P_LED(1200, 150), pines: [{ nom: "Ánodo", placa: "13", pieza: "A", y: 150 }] },
      { pieza: P_ESTIRADA(1200, 300), pines: [{ nom: "SDA", placa: "A0", pieza: "SDA", y: 300 }] },
    ],
  })
}

test("DOM · hoja mixta: si quedó un cable CSS a la vista, la barra gris SE QUEDA", () => {
  const escena = hojaMixta()
  const { api } = montar(escena)
  const r = api.trazarTodo()

  assert.ok(r.trazados > 0, "el LED tendría que trazarse: si no, el test no prueba lo mixto")
  assert.equal(cablesVisibles(escena).length, 1, "el cable del mpu6050 tiene que volver al layout")
  assert.equal(
    escena.getAttribute("data-cables-barra"),
    "visible",
    "se ocultó la barra con un cable CSS todavía a la vista: ese cable nace del aire",
  )
})

test("DOM · hoja entera: si no quedó ningún cable CSS, la barra gris sobra", () => {
  const escena = armarEscena({
    escena: { left: HOJA.izq, top: 124, right: HOJA.der, bottom: 460 },
    placa: P_UNO(500, 200),
    filas: [
      { pieza: P_LED(1200, 150), pines: [{ nom: "Ánodo", placa: "13", pieza: "A", y: 150 }] },
      { pieza: P_LED(1200, 300), pines: [{ nom: "Cátodo", placa: "GND.1", pieza: "C", y: 300 }] },
    ],
  })
  const { api } = montar(escena)
  api.trazarTodo()
  assert.equal(cablesVisibles(escena).length, 0)
  assert.equal(escena.getAttribute("data-cables-barra"), "oculta")
})

test("DOM · la regla CSS cuelga del atributo que DECIDE, no del que informa", () => {
  const escena = hojaMixta()
  const { api, documento } = montar(escena)
  api.trazarTodo()
  const hoja = documento.getElementById("cables-trazados-css")
  assert.ok(hoja, "no se inyectó la hoja de estilo")
  assert.ok(
    hoja.textContent.includes('[data-cables-barra="oculta"] .filas-libre::before'),
    "la regla de la barra no cuelga de data-cables-barra: " + hoja.textContent,
  )
  assert.ok(
    !/\[data-cables-trazados\][^@]*filas-libre::before/.test(hoja.textContent),
    "la regla volvió a colgar de data-cables-trazados, que dice cuántos se trazaron y no si sobró la barra",
  )
})

// ════════════════════════════════════════════════════════════════════════════
// DEFECTO HERMANO: el cable que NO caía al fallback, DESAPARECÍA
// ════════════════════════════════════════════════════════════════════════════
//
// Una fila cuya pieza no se puede medir hacía `continue` sin devolver su cable
// CSS al layout: quedaba oculto del paso 2 y sin trazo que lo reemplace. Sólo
// se ve en las hojas donde OTRA fila sí se traza, porque ahí no corre el
// `restaurar()` del final — o sea, justo en la hoja mixta.
//
// MUTACIÓN QUE MATA ESTE TEST: sacar el `devolverALaFila(c.pinEl)` de la rama
// de `medidorDe` fallado.
test("DOM · una pieza que no se puede medir devuelve su cable CSS, no lo borra", () => {
  const escena = hojaMixta()
  const { api } = montar(escena)
  api.trazarTodo()

  const delMpu = escena.querySelectorAll(".fila")[1].querySelectorAll(".cable")
  assert.equal(delMpu.length, 1)
  assert.notEqual(
    delMpu[0].style.display,
    "none",
    "el cable quedó oculto y sin trazo: no cayó al fallback, desapareció",
  )
  assert.equal(delMpu[0].hasAttribute("data-cables-oculto"), false)
})

// ════════════════════════════════════════════════════════════════════════════
// DEFECTO Nº5: el teclado, 8 cables que terminaban en el aire
// ════════════════════════════════════════════════════════════════════════════
//
// MUTACIÓN QUE MATA ESTE TEST: sacar el chequeo de `pinAdentro` de
// `medidorDe().punto`.
test("DOM · el teclado, con sus pines 41 px abajo del dibujo, vuelve al cable CSS", () => {
  const escena = armarEscena({
    escena: { left: HOJA.izq, top: 124, right: HOJA.der, bottom: 460 },
    placa: P_UNO(500, 200),
    filas: [
      { pieza: P_TECLADO(1150, 150), pines: [{ nom: "Filas", placa: "13", pieza: "R1", y: 200 }] },
      { pieza: P_LED(1200, 350), pines: [{ nom: "Ánodo", placa: "12", pieza: "A", y: 350 }] },
    ],
  })
  const { api } = montar(escena)
  const r = api.trazarTodo()

  assert.ok(r.trazados > 0, "el LED tiene que seguir trazándose: el fallback es por fila")
  const delTeclado = escena.querySelectorAll(".fila")[0].querySelectorAll(".cable")[0]
  assert.notEqual(
    delTeclado.style.display,
    "none",
    "el cable del teclado se dibujó igual, terminando en un puntito sobre el fondo",
  )
  assert.equal(escena.getAttribute("data-cables-barra"), "visible", "y con él a la vista, la barra se queda")
})

// ════════════════════════════════════════════════════════════════════════════
// DEFECTO Nº6: el cable que atravesaba el módulo y salía de la hoja
// ════════════════════════════════════════════════════════════════════════════
//
// El `wokwi-photoresistor-sensor` tiene sus cuatro pines pegados al borde
// DERECHO. Salir perpendicular manda el cable a rodear la pieza por afuera, y
// afuera está el borde de la hoja; por eso se entra derecho. Pero se entraba
// derecho HASTA EL PIN, o sea atravesando el módulo entero, y la punta quedaba
// dibujada sobre el borde derecho de la pieza — que en las hojas angostas es el
// borde de la hoja. El cable CSS de siempre frena en el borde IZQUIERDO del
// módulo, y eso es lo que hay que hacer.
//
// MUTACIÓN QUE MATA ESTE TEST: no recortar el destino al borde de la pieza.
test("DOM · un pin del borde lejano se conecta por el borde cercano, sin cruzar la pieza", () => {
  const PIEZA_IZQ = 1150
  const escena = armarEscena({
    escena: { left: HOJA.izq, top: 124, right: HOJA.der, bottom: 460 },
    placa: P_UNO(500, 200),
    filas: [{ pieza: P_LDR(PIEZA_IZQ, 200), pines: [{ nom: "AO", placa: "A0", pieza: "AO", y: 210 }] }],
  })
  const { api } = montar(escena)
  const r = api.trazarTodo()
  assert.ok(r.trazados > 0, "el LDR tiene que trazarse")

  const caja = { left: PIEZA_IZQ, top: 200, right: PIEZA_IZQ + 191.0219, bottom: 200 + 73.1156 }
  const capa = escena.querySelector(".cables-trazados")
  const caminos = capa.querySelectorAll("path").map((p) => puntosDe(p.getAttribute("d"), escena))
  const tramoB = caminos[caminos.length - 1]

  const punta = tramoB[tramoB.length - 1]
  assert.ok(
    Math.abs(punta.x - caja.left) < 0.5,
    `el cable termina en x=${punta.x.toFixed(1)} y la pieza empieza en ${caja.left}: ` +
      "entró atravesando el módulo hasta el pin del borde de enfrente",
  )
  for (const s of segmentos(tramoB)) {
    assert.ok(!pisa(s, caja), "un tramo pasa por adentro del dibujo de la pieza: " + JSON.stringify(s))
  }
})

// ════════════════════════════════════════════════════════════════════════════
// DEFECTO Nº4, de punta a punta: el header izquierdo del ESP32
// ════════════════════════════════════════════════════════════════════════════
//
// MUTACIÓN QUE MATA ESTE TEST: volver a pasarle a `rutear` el recuadro de la
// escena como `limites` en vez de `limitesUtiles`.
test("DOM · con la placa saliéndose del recuadro, el header izquierdo igual se traza", () => {
  // las medidas de `e-servo`: escena 124→351,3 y placa 108,8→370,4
  const escena = armarEscena({
    escena: { left: HOJA.izq, top: 124, right: HOJA.der, bottom: 351.3 },
    placa: { ...P_ESP(529.4, 108.8), rect: { left: 529.4, top: 108.8, right: 662.6, bottom: 370.4 } },
    filas: [
      {
        pieza: P_LED(1200, 180),
        pines: [
          { nom: "Señal", placa: "D13", pieza: "A", y: 180 }, // columna IZQUIERDA
          { nom: "Masa", placa: "D23", pieza: "C", y: 240 }, // columna DERECHA
        ],
      },
    ],
  })
  const { api } = montar(escena)
  const r = api.trazarTodo()

  assert.equal(
    cablesVisibles(escena).length,
    0,
    "quedó un cable CSS: el header izquierdo no encontró pasillo y cayó al fallback",
  )
  assert.equal(r.trazados, 2)
})

// ════════════════════════════════════════════════════════════════════════════
// LA HOJA ANGOSTA: si la punta no cae donde se puede dibujar, no se dibuja
// ════════════════════════════════════════════════════════════════════════════
//
// Con la hoja angosta la columna de etiquetas se desborda del recuadro. Medido
// en `e-7segmentos` a 420 px: el borde derecho de la etiqueta «Segmentos A-G»
// queda en x=794 sobre una escena que termina en x=442. Rutear hasta ahí
// dibujaba siete cables que salían del recuadro, cruzaban la placa por arriba y
// pasaban por encima del título de la hoja. El cable CSS vive ADENTRO de la
// fila: se desborda con la fila y no hace ese desastre.
// A 420 px esto manda 56 cables de vuelta al fallback en todo el catálogo, y
// está bien: a ese ancho la hoja ya está desbordada y el cable trazado no tiene
// dónde dibujarse. Los puntos de cable fuera del recuadro pasan de 95 a 6.
//
// MUTACIÓN QUE MATA ESTE TEST: sacar cualquiera de los dos `dentroDe`.
test("DOM · si la ETIQUETA quedó fuera del recuadro, ese cable vuelve al CSS", () => {
  // el recuadro cortado ANTES de la columna de etiquetas (que llega a x=900),
  // con la pieza bien adentro: la única punta afuera es la de la etiqueta.
  const escena = armarEscena({
    escena: { left: HOJA.izq, top: 124, right: HOJA.labelDer - 20, bottom: 460 },
    placa: P_UNO(500, 200),
    filas: [{ pieza: P_LED(700, 150), pines: [{ nom: "Ánodo", placa: "13", pieza: "A", y: 150 }] }],
  })
  const { api } = montar(escena)
  assert.equal(api.trazarTodo().trazados, 0, "se dibujó un cable hasta una etiqueta que está fuera del recuadro")
  assert.equal(cablesVisibles(escena).length, 1, "y el cable CSS tiene que estar de vuelta")
})

test("DOM · si el PIN DE LA PIEZA quedó fuera del recuadro, ese cable vuelve al CSS", () => {
  // acá la etiqueta entra (termina en x=900) y lo que se sale es la pieza
  const escena = armarEscena({
    escena: { left: HOJA.izq, top: 124, right: 1000, bottom: 460 },
    placa: P_UNO(500, 200),
    filas: [{ pieza: P_LED(1100, 150), pines: [{ nom: "Ánodo", placa: "13", pieza: "A", y: 150 }] }],
  })
  const { api } = montar(escena)
  assert.equal(api.trazarTodo().trazados, 0, "se dibujó un cable hasta un pin que está fuera del recuadro")
  assert.equal(cablesVisibles(escena).length, 1)
})

test("DOM · con el recuadro entero, esa MISMA fila sí se traza", () => {
  // el control: si no fuera por el recuadro cortado, el test de arriba pasaría
  // de vacío.
  const escena = armarEscena({
    escena: { left: HOJA.izq, top: 124, right: HOJA.der, bottom: 460 },
    placa: P_UNO(500, 200),
    filas: [{ pieza: P_LED(1200, 150), pines: [{ nom: "Ánodo", placa: "13", pieza: "A", y: 150 }] }],
  })
  const { api } = montar(escena)
  assert.equal(api.trazarTodo().trazados, 1)
  assert.equal(cablesVisibles(escena).length, 0)
})

// ════════════════════════════════════════════════════════════════════════════
// DEFECTO Nº3: la impresión partía la escena
// ════════════════════════════════════════════════════════════════════════════
//
// Acá se prueba que la regla se EMITE. Que Chromium la obedece se midió con
// `chromium --print-to-pdf` sobre `uno-lleno`: antes «Extremo 1», «Cursor» y
// «Extremo 2» caían en la página 2, los dos últimos sin ningún cable y el
// primero con un muñón huérfano; después la escena entera queda en una sola
// página, completa. Está en el informe.
//
// MUTACIÓN QUE MATA ESTE TEST: sacar la regla de impresión.
test("DOM · se emite la regla que impide que la escena se parta al imprimir", () => {
  const escena = hojaMixta()
  const { api, documento } = montar(escena)
  api.trazarTodo()
  const hoja = documento.getElementById("cables-trazados-css")
  const media = /@media print\{.*\}/.exec(hoja.textContent)
  assert.ok(media, "no hay bloque @media print: el cable es un <svg> absoluto y el salto de página lo corta")
  assert.ok(/\.escena[^{]*\{[^}]*break-inside\s*:\s*avoid/.test(media[0]), "falta break-inside:avoid sobre .escena")
  assert.ok(/page-break-inside\s*:\s*avoid/.test(media[0]), "falta el page-break-inside para los motores viejos")
})

// ════════════════════════════════════════════════════════════════════════════
// y el fallback por fila sigue siendo por fila
// ════════════════════════════════════════════════════════════════════════════

test("DOM · sin ningún cable trazable, la hoja queda exactamente como estaba", () => {
  const escena = armarEscena({
    escena: { left: HOJA.izq, top: 124, right: HOJA.der, bottom: 460 },
    placa: P_UNO(500, 200),
    filas: [{ pieza: P_ESTIRADA(1200, 300), pines: [{ nom: "SDA", placa: "A0", pieza: "SDA", y: 300 }] }],
  })
  const { api } = montar(escena)
  const r = api.trazarTodo()
  assert.equal(r.trazados, 0)
  assert.equal(cablesVisibles(escena).length, 1)
  assert.equal(escena.getAttribute("data-cables-trazados"), null)
  assert.equal(escena.getAttribute("data-cables-barra"), null, "sin trazar nada no se toca la barra")
  assert.equal(escena.querySelector(".cables-trazados"), null, "no queda una capa SVG vacía")
})

test("DOM · trazar dos veces deja exactamente el mismo dibujo (idempotencia)", () => {
  const escena = hojaMixta()
  const { api } = montar(escena)
  api.trazarTodo()
  const capa1 = escena.querySelector(".cables-trazados")
  const primera = capa1.querySelectorAll("path").map((p) => p.getAttribute("d"))
  api.trazarTodo()
  const capa2 = escena.querySelector(".cables-trazados")
  const segunda = capa2.querySelectorAll("path").map((p) => p.getAttribute("d"))
  assert.ok(primera.length > 0)
  assert.deepEqual(segunda, primera)
  assert.equal(escena.querySelectorAll(".cables-trazados").length, 1, "quedó una capa vieja sin borrar")
})
