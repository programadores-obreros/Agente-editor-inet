// Las piezas dibujadas por nosotros (tags pb-*) tienen que decir DÓNDE está cada
// pin, igual que las de Wokwi: `el.pinInfo` -> [{name, x, y, signals}] con x/y en
// píxeles desde el borde del elemento.
//
// Sin eso, el que dibuja el circuito no tiene a qué anclar el cable y lo hace
// nacer de una barra gris al costado de la placa. La docente proyecta el dibujo,
// el pibe pregunta "¿y esto dónde va?" y el dibujo no se lo dice: justo lo único
// que el dibujo tenía que resolver.
//
// Este archivo NO lee una lista de piezas copiada a mano: instancia el módulo real
// con un customElements de mentira y descubre las piezas por los define() que hace
// el propio archivo. Si mañana alguien agrega una pieza y se olvida de los pines,
// este test se entera solo.
//
// Corre con: node --test tests/*.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const ARCHIVO = join(REPO, "opencode/tecniabot-web/componentes-extra.js")

/**
 * Corre componentes-extra.js con un customElements postizo y devuelve lo que el
 * archivo registró. El navegador no hace falta: `pinInfo` son datos, no medición.
 */
function cargarPiezas() {
  const registro = new Map()
  const contexto = {
    customElements: {
      get: (nombre) => registro.get(nombre),
      define: (nombre, clase) => registro.set(nombre, clase),
    },
    HTMLElement: class {},
  }
  vm.createContext(contexto)
  vm.runInContext(readFileSync(ARCHIVO, "utf8"), contexto, { filename: ARCHIVO })
  assert.ok(registro.size > 0, "el archivo no registró ninguna pieza")
  return registro
}

/** Instancia la pieza y la hace dibujar, para poder mirar su SVG. */
function dibujar(Pieza) {
  const el = new Pieza()
  el.style = {}
  el.hasAttribute = () => false // 'encendido' de lámpara/calefactor: da igual acá
  el.connectedCallback()
  return el
}

/** Alto y ancho declarados por el SVG de la pieza. Sale del archivo, no de acá. */
function tamano(svg) {
  const attr = (n) => {
    const m = svg.match(new RegExp(`<svg[^>]*\\s${n}="([^"]+)"`))
    return m ? Number(m[1]) : NaN
  }
  const vb = svg.match(/<svg[^>]*\sviewBox="([^"]+)"/)
  const [vx, vy, vw, vh] = vb ? vb[1].trim().split(/\s+/).map(Number) : []
  return { w: attr("width"), h: attr("height"), vx, vy, vw, vh }
}

/**
 * Figuras dibujadas (círculos, rects, elipses) en coordenadas del viewBox.
 *
 * Descarta a propósito lo que está dentro de un <g transform=...>: esas figuras
 * están en coordenadas locales del grupo y tomarlas como absolutas sería mentir.
 * Descartar de menos no afloja el test (achica el área válida), descartar de más
 * tampoco: sólo lo haría más exigente.
 */
function figuras(svg) {
  const plano = svg.replace(/<g[^>]*transform=[\s\S]*?<\/g>/g, "")
  const num = (etiqueta, n) => {
    const m = etiqueta.match(new RegExp(`\\s${n}="([-\\d.]+)"`))
    return m ? Number(m[1]) : 0
  }
  const salida = []
  for (const c of plano.match(/<circle[^>]*>/g) || []) {
    const cx = num(c, "cx"), cy = num(c, "cy"), r = num(c, "r")
    salida.push({
      tipo: "circle",
      area: Math.PI * r * r,
      dentro: (x, y) => Math.hypot(x - cx, y - cy) <= r + 1e-9,
    })
  }
  for (const e of plano.match(/<ellipse[^>]*>/g) || []) {
    const cx = num(e, "cx"), cy = num(e, "cy"), rx = num(e, "rx"), ry = num(e, "ry")
    salida.push({
      tipo: "ellipse",
      area: Math.PI * rx * ry,
      dentro: (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 + 1e-9,
    })
  }
  for (const r of plano.match(/<rect[^>]*>/g) || []) {
    const x0 = num(r, "x"), y0 = num(r, "y"), w = num(r, "width"), h = num(r, "height")
    salida.push({
      tipo: "rect",
      area: w * h,
      // Bordes incluidos: la punta de una pata ES el borde del rect, y ahí es
      // donde Wokwi pone el pin.
      dentro: (x, y) => x >= x0 - 1e-9 && x <= x0 + w + 1e-9 && y >= y0 - 1e-9 && y <= y0 + h + 1e-9,
    })
  }
  return salida
}

// Un conector es una figura CHICA: el círculo de un borne, la lengüeta de un
// motor. El cuerpo de la placa también es una figura y también "contiene" al
// pin, así que si no se le pone tope, caer sobre la placa cuenta como acertar
// y una coordenada corrida 6 px al costado pasa el test igual.
// Medido en las piezas de este archivo: los conectores dan 0,2 % y 0,4 % del
// área de la pieza; la bornera del relay (que NO es el conector) ya da 11,8 %.
const AREA_MAX_CONECTOR = 0.02

/** Texto rotulado en el dibujo, que es de donde salen los nombres de los pines. */
function rotulos(svg) {
  return (svg.match(/<text[^>]*>([\s\S]*?)<\/text>/g) || [])
    .map((t) => t.replace(/<[^>]*>/g, " "))
    .join(" ")
}

const PIEZAS = cargarPiezas()
const NOMBRES = [...PIEZAS.keys()]

// Las que sí tienen pines conectables, descubiertas (no listadas a mano).
const CON_PINES = NOMBRES.filter((n) => dibujar(PIEZAS.get(n)).pinInfo.length > 0)

test("1a · toda pieza pb-* contesta pinInfo con un array", () => {
  // Se rompía: el que dibuja el cable hacía `el.pinInfo.find(...)` sobre undefined
  // y reventaba la página entera. La docente abría el circuito y veía en blanco,
  // no un cable feo: en blanco.
  for (const nombre of NOMBRES) {
    const el = dibujar(PIEZAS.get(nombre))
    assert.ok(Array.isArray(el.pinInfo), `${nombre}: pinInfo no es un array (es ${typeof el.pinInfo})`)
  }
})

test("1b · pinInfo es getter de INSTANCIA, como en Wokwi", () => {
  // Se rompía: si los pines quedaban como propiedad estática de la clase, el
  // consumidor hace `el.pinInfo` (que es lo que hace con las piezas de Wokwi),
  // le da undefined, y esta pieza es la única que no se puede cablear.
  const Pieza = PIEZAS.get(CON_PINES[0])
  assert.equal(Pieza.pinInfo, undefined, "pinInfo quedó en la clase, no en la instancia")
  assert.ok(dibujar(Pieza).pinInfo.length > 0, "la instancia no expone pinInfo")

  // Y no hace falta adjuntarla al DOM ni esperar a que dibuje: son datos.
  const suelta = new Pieza()
  assert.ok(suelta.pinInfo.length > 0, "pinInfo no contesta antes de dibujar")
})

test("1c · ninguna pieza queda en el limbo: o tiene pines, o dice por qué no", () => {
  // Se rompía: una pieza nueva entraba sin pines y nadie se enteraba hasta que
  // una escuela pedía ese circuito y le salía el cable colgando de la barra gris.
  // Por eso la lista sale de los define() del archivo y no de acá.
  for (const nombre of NOMBRES) {
    const Pieza = PIEZAS.get(nombre)
    const pines = dibujar(Pieza).pinInfo
    const motivo = Pieza.sinPinesDibujados
    if (pines.length > 0) {
      assert.equal(
        motivo,
        null,
        `${nombre}: tiene pines Y motivo de no tenerlos. Decidí uno.`,
      )
      continue
    }
    assert.equal(
      typeof motivo,
      "string",
      `${nombre}: se quedó sin pines y sin explicación.\n` +
        `Si los conectores están dibujados, agregá el pinInfo con la coordenada del\n` +
        `elemento SVG que los dibuja. Si NO están dibujados, pasale a definir() un\n` +
        `string diciéndolo: preferimos una pieza declarada sin resolver antes que una\n` +
        `coordenada inventada, porque esa coordenada le enseña al pibe a pinchar donde no va.`,
    )
    assert.ok(motivo.trim().length > 10, `${nombre}: el motivo no explica nada: ${JSON.stringify(motivo)}`)
  }
})

test("2 · cada pin tiene nombre y coordenadas finitas", () => {
  // Se rompía: un pin con x: undefined (por un typo en la clave) dibujaba el cable
  // hasta la esquina 0,0 de la hoja, o directamente no lo dibujaba. NaN no avisa:
  // sale un <line> sin línea y la hoja queda con un cable menos, en silencio.
  for (const nombre of CON_PINES) {
    for (const [i, pin] of dibujar(PIEZAS.get(nombre)).pinInfo.entries()) {
      const donde = `${nombre} pin #${i} (${JSON.stringify(pin.name)})`
      assert.equal(typeof pin.name, "string", `${donde}: name no es string`)
      assert.ok(pin.name.trim().length > 0, `${donde}: name vacío`)
      for (const eje of ["x", "y"]) {
        assert.equal(typeof pin[eje], "number", `${donde}: ${eje} no es número (${pin[eje]})`)
        assert.ok(Number.isFinite(pin[eje]), `${donde}: ${eje} no es finito (${pin[eje]})`)
      }
      assert.ok(Array.isArray(pin.signals), `${donde}: signals no es array`)
    }
  }
})

test("3 · no hay dos pines con el mismo nombre en una pieza", () => {
  // Se rompía: con dos "GND" en la misma pieza, el que busca el pin por nombre
  // agarra siempre el primero y los dos cables salen del mismo agujero, cruzados.
  // En el dibujo se ve prolijo; en la protoboard el pibe conecta cualquier cosa.
  for (const nombre of CON_PINES) {
    // Array.from y no .map(): lo que devuelve pinInfo es un array del contexto
    // del vm, con OTRO Array.prototype, y deepEqual lo rechaza aunque esté vacío.
    const nombres = Array.from(dibujar(PIEZAS.get(nombre)).pinInfo, (p) => p.name)
    const repetidos = nombres.filter((n, i) => nombres.indexOf(n) !== i)
    assert.deepEqual(repetidos, [], `${nombre}: pines repetidos -> ${repetidos.join(", ")}`)
  }
})

test("4a · las coordenadas caen dentro del SVG de esa pieza", () => {
  // Se rompía: una coordenada copiada de otra pieza (o un y= de más) manda el
  // cable a terminar FUERA del dibujo. La docente ve un cable que sale de la nada,
  // al lado del componente.
  // El tamaño sale del SVG del archivo: si mañana la pieza cambia de tamaño y los
  // pines no, este test lo cuenta.
  for (const nombre of CON_PINES) {
    const el = dibujar(PIEZAS.get(nombre))
    const svg = el.innerHTML
    const t = tamano(svg)

    assert.ok(Number.isFinite(t.w) && Number.isFinite(t.h), `${nombre}: el SVG no declara width/height`)
    // El contrato dice "píxeles desde el borde del elemento". Eso sólo coincide
    // con las unidades del SVG si el viewBox arranca en 0,0 y mide lo mismo que
    // el width/height. Si algún día se escala, hay que rehacer las coordenadas.
    assert.deepEqual(
      [t.vx, t.vy, t.vw, t.vh],
      [0, 0, t.w, t.h],
      `${nombre}: el viewBox ya no es 1:1 con width/height, así que las coordenadas\n` +
        `de pinInfo dejaron de estar en píxeles desde el borde. Recalculalas.`,
    )

    for (const pin of el.pinInfo) {
      assert.ok(
        pin.x >= 0 && pin.x <= t.w && pin.y >= 0 && pin.y <= t.h,
        `${nombre}: el pin ${pin.name} cae en (${pin.x}, ${pin.y}), fuera de ${t.w}x${t.h}`,
      )
    }
  }
})

test("4b · cada coordenada cae sobre el CONECTOR dibujado, no al lado", () => {
  // Se rompía: una coordenada estimada a ojo cae DENTRO de la pieza pero al lado
  // del conector. El dibujo queda lindo y es mentira: el cable nace a seis píxeles
  // del borne y el pibe pincha donde le señala el dibujo.
  for (const nombre of CON_PINES) {
    const el = dibujar(PIEZAS.get(nombre))
    const t = tamano(el.innerHTML)
    const tope = t.w * t.h * AREA_MAX_CONECTOR
    const formas = figuras(el.innerHTML)
    for (const pin of el.pinInfo) {
      const encima = formas.filter((f) => f.dentro(pin.x, pin.y))
      const chica = encima.filter((f) => f.area <= tope)
      assert.ok(
        chica.length > 0,
        `${nombre}: el pin ${pin.name} (${pin.x}, ${pin.y}) no cae sobre ninguna figura\n` +
          `chica del SVG: sólo pisa ${encima.length === 0 ? "nada" : "el cuerpo de la pieza"}.\n` +
          `La coordenada se saca del <circle>/<rect> que dibuja el conector, no a ojo.`,
      )
    }
  }
})

test("5a · si el dibujo rotula VCC o GND, esos pines existen con ese nombre", () => {
  // Se rompía: la pieza dice "IN VCC GND" serigrafiado y pinInfo los llamaba
  // "V+" y "tierra". La docente lee el dibujo, busca VCC en la tabla de
  // conexiones y no está: dos vocabularios para la misma placa.
  for (const nombre of CON_PINES) {
    const el = dibujar(PIEZAS.get(nombre))
    const texto = rotulos(el.innerHTML)
    const nombres = el.pinInfo.map((p) => p.name)
    for (const rotulo of ["VCC", "GND"]) {
      if (!new RegExp(`\\b${rotulo}\\b`).test(texto)) continue
      assert.ok(
        nombres.includes(rotulo),
        `${nombre}: el dibujo rotula ${rotulo} pero pinInfo no tiene un pin así (tiene ${nombres.join(", ")})`,
      )
    }
  }
})

test("5b · la pieza que tiene alimentación tiene masa Y tensión", () => {
  // Se rompía: quedaba el VCC y faltaba el GND. El circuito se ve completo, el
  // pibe lo arma igual que en la pantalla y no prende nada, porque sin masa común
  // no hay circuito. Es el error que más tiempo de clase come.
  for (const nombre of CON_PINES) {
    const pines = dibujar(PIEZAS.get(nombre)).pinInfo
    const tiene = (signal) =>
      pines.some((p) => p.signals.some((s) => s.type === "power" && s.signal === signal))
    if (!tiene("VCC") && !tiene("GND")) continue
    assert.ok(tiene("VCC"), `${nombre}: declara GND pero ningún pin de tensión`)
    assert.ok(tiene("GND"), `${nombre}: declara VCC pero ningún pin de masa`)
  }
})

test("6 · pinInfo no se puede pisar desde afuera", () => {
  // Se rompía: el consumidor ordenaba los pines con .sort() sobre lo que le
  // devolvimos y nos dejaba la pieza reordenada para todos los circuitos
  // siguientes de la misma página. Un cable bien en la primera hoja y mal en la
  // segunda es el defecto más difícil de creer que existe.
  const Pieza = PIEZAS.get(CON_PINES[0])
  const antes = dibujar(Pieza).pinInfo
  antes[0].x = 9999
  antes[0].signals.push({ type: "basura" })
  const despues = dibujar(Pieza).pinInfo
  assert.notEqual(despues[0].x, 9999, "nos pisaron la coordenada desde afuera")
  assert.equal(despues[0].signals.some((s) => s.type === "basura"), false, "nos pisaron los signals")
})
