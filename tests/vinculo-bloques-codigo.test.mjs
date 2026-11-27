// El vínculo entre los bloques y el código: tocar un bloque marca sus líneas, y al revés.
//
// POR QUÉ EXISTE (2026-11-26, auditoría de la Vista Lógica pedida por el dueño). «Con bloques» y
// «Mirá el código» eran dos secciones sin nada que las uniera: los bloques decían «Pulsador» y el
// código hablaba de otra cosa. El alumno no tenía cómo ver que el bloque y el programa dicen lo
// mismo.
//
// Lo que se cuida, en orden de gravedad:
//   1. el programa repartido en renglones sigue siendo, byte a byte, el programa del servidor;
//   2. nunca se marca con la estructura de OTRA revisión que la que se está mostrando;
//   3. una estructura con un tramo que no entra en el programa no se usa (ni una parte);
//   4. una línea marca el bloque MÁS CHICO que la contiene (la regla, no «por siempre»);
//   5. los textos que invitan a tocar sólo aparecen cuando tocar hace algo.
//
// El punto 5 lo encontró una guarda que ya existía (`vista-codigo.test.mjs`: «el texto fijo se ve
// también sin programa: no puede prometer lo que la página no muestra»). La primera versión ponía
// «Tocá una línea para ver de qué bloque sale» en el texto fijo de la sección.
//
// VISTO EN CHROMIUM y no acá (recorrido de 25 comprobaciones contra la ventana real, 2026-11-26):
// que el clic de verdad sobre un bloque y sobre una línea hace todo esto, que la página no salta,
// que la línea marcada queda a la vista dentro del cuadro y que no hay violaciones de CSP. Una
// lección de ese recorrido: la página tiene desplazamiento suave, y medir `scrollY` antes de que
// se asiente dio un «la página saltó» que era del propio script.
//
// MUTACIONES que ponen rojo este archivo (una por vez, con el cambio ya commiteado):
//   codigo-por-lineas.js
//   - `renglonesDe` sin sacar el último tramo vacío                    → «repartir no cambia…»
//   - no volver al texto entero si lo repartido no coincide            → «si repartir no da…»
//   - `marcar` sin el tope `hasta > renglones.length`                  → «un tramo que no entra…»
//   - `marcar` sin `desmarcarTodo()`                                   → «marcar un tramo…»
//   - `vigentes()` devolviendo siempre true                            → «cuando el panel cambia…»
//   vinculo-bloques-codigo.js
//   - `claveDeLaLinea` mirando «por siempre» antes que las reglas      → «una línea marca el bloque más chico…»
//   - `actualizar` sin `borrar()` al cambiar la estructura             → «cuando cambia el programa…»
//   - `borrar` con la pista aunque no haya estructura                  → «sin estructura no se invita…»
//   - el fondo del lienzo borrando también lo marcado desde el código  → «tocar el fondo…»
//   - `textoDeLaLinea` numerando por el orden del programa             → «la regla 2 es la segunda del lienzo…»
//   vista-codigo.js
//   - `estructuraUsable` sin el tope `r.hasta <= lineas`               → «una estructura con un tramo…»
//   - guardar la estructura DESPUÉS de avisar que cambió el programa   → «el panel guarda la estructura…»
//   SOBREVIVE, y está bien que sobreviva: `sinCodigo` sin `estructuraMostrada = null`. La estructura
//   igual no sale, porque `estructuraDelPrograma` además exige que haya un programa a la vista
//   (`revisionMostrada`). Son dos cierres para lo mismo; sacar los DOS sí pone rojo «la estructura
//   se va con el código…». Lo anoto porque la primera versión de esta lista decía que ése solo
//   alcanzaba, y lo probé y no.
//   app.js
//   - `estructuraDeLaRevision` sin comparar la revisión                → «la estructura de otra revisión…»
//
// Corre con: node --test tests/vinculo-bloques-codigo.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const WEB = join(REPO, "opencode/vista-fisica/web")
const { renglonesDe, crearCodigoPorLineas } = await import(join(WEB, "codigo-por-lineas.js"))
const { rangoDeLaClave, claveDeLaLinea, textoDelBloque, textoDeLaLinea, crearVinculoBloquesCodigo, TEXTOS_DEL_VINCULO: T } = await import(join(WEB, "vinculo-bloques-codigo.js"))
const { crearPanelCodigo, estructuraUsable } = await import(join(WEB, "vista-codigo.js"))
const { estructuraDeLaRevision, pintarVinculo, desplazamientoHasta } = await import(join(WEB, "app.js"))
const { construirRutasDeAssets } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))

// ── un programa chico y su estructura (los números son los de ESTE texto) ─────────────────────
const CODIGO = ["// encabezado", "#include <Arduino.h>", "", "void setup() {", "  entrada", "  salida a", "  salida b", "}", "", "void loop() {", "  leer", "  // regla A", "  decidir A", "  // regla B", "  decidir B", "}", ""].join("\n")
const LINEAS = 16
const ESTRUCTURA = Object.freeze({
  alIniciar: { lineas: { desde: 4, hasta: 8 }, pasos: [{ texto: "Pulsador (GPIO25): entrada", lineas: { desde: 5, hasta: 5 } }, { texto: "LED (GPIO4): salida, arranca apagado", lineas: { desde: 6, hasta: 7 } }] },
  porSiempre: { lineas: { desde: 10, hasta: 16 } },
  // El programa las escribe en SU orden (por salida); en el lienzo van en el orden del proyecto.
  reglas: [{ id: "beh-9", lineas: { desde: 12, hasta: 13 } }, { id: "beh-4", lineas: { desde: 14, hasta: 15 } }],
})
const EN_EL_LIENZO = ["beh-4", "beh-9"]

// ── un documento mínimo: lo justo que usa `codigo-por-lineas.js` ──────────────────────────────
function documentoFalso() {
  const crear = (tag) => {
    const e = {
      tagName: tag, hijos: [], atributos: {}, parentNode: null, className: "", _texto: "",
      setAttribute(n, v) { this.atributos[n] = String(v) },
      getAttribute(n) { return Object.hasOwn(this.atributos, n) ? this.atributos[n] : null },
      removeAttribute(n) { delete this.atributos[n] },
      replaceChildren(...nuevos) { this.hijos = nuevos; this._texto = ""; for (const h of nuevos) h.parentNode = this },
    }
    Object.defineProperty(e, "textContent", {
      get() { return this.hijos.length > 0 ? this.hijos.map((h) => h.textContent).join("") : this._texto },
      set(v) { this.hijos = []; this._texto = String(v) },
    })
    return e
  }
  return { createElement: crear }
}
function montarLineas(codigo = CODIGO) {
  const doc = documentoFalso()
  const pre = doc.createElement("pre")
  pre.textContent = codigo
  const lineas = crearCodigoPorLineas({ doc, elementoCodigo: pre })
  const marcadas = () => pre.hijos.filter((h) => h.getAttribute("data-marcada") !== null).map((h) => Number(h.getAttribute("data-linea")))
  return { doc, pre, lineas, marcadas }
}

// ════════════════════════════════════════════════════════════════════════════════════
// 1. El programa, renglón por renglón
// ════════════════════════════════════════════════════════════════════════════════════

test("renglonesDe: unidos dan el texto exacto, con o sin salto final, y con líneas vacías", () => {
  for (const texto of [CODIGO, "a\nb", "a\nb\n", "\n", "\n\n", "a", "a\n\nb\n", "  con espacios  \n\tcon tab\n"]) {
    assert.equal(renglonesDe(texto).join(""), texto, JSON.stringify(texto))
  }
  assert.deepEqual(renglonesDe("a\nb\n"), ["a\n", "b\n"], "el salto final no agrega una línea vacía")
  assert.deepEqual(renglonesDe("a\n\nb"), ["a\n", "\n", "b"], "una línea vacía en el medio sí es una línea")
  for (const nada of ["", null, undefined, 7]) assert.deepEqual(renglonesDe(nada), [])
})

test("repartir no cambia una letra del programa y deja un renglón por línea, numerado desde 1", () => {
  const m = montarLineas()
  assert.equal(m.lineas.repartir(), LINEAS)
  assert.equal(m.pre.textContent, CODIGO, "lo que se lee (y se copia) es el programa tal cual")
  assert.equal(m.pre.hijos.length, LINEAS)
  assert.deepEqual(m.pre.hijos.map((h) => h.getAttribute("data-linea")), Array.from({ length: LINEAS }, (_, i) => String(i + 1)))
  assert.equal(m.pre.hijos[3].textContent, "void setup() {\n")
  assert.equal(m.pre.hijos[9].textContent, "void loop() {\n")
  // Un texto raro tampoco se toca: marcado como texto, nunca como HTML.
  const raro = montarLineas("<b>uno</b> & dos\n</pre>\n")
  raro.lineas.repartir()
  assert.equal(raro.pre.textContent, "<b>uno</b> & dos\n</pre>\n")
})

test("si repartir no da exactamente el mismo texto, se vuelve al texto entero y no hay renglones", () => {
  const doc = documentoFalso()
  const pre = doc.createElement("pre")
  // Un elemento que pierde un renglón al recibirlos: el caso que no puede quedar a la vista.
  const original = pre.replaceChildren
  pre.replaceChildren = function (...nuevos) { original.call(this, ...nuevos.slice(1)) }
  pre.textContent = CODIGO
  const lineas = crearCodigoPorLineas({ doc, elementoCodigo: pre })
  assert.equal(lineas.repartir(), 0)
  assert.equal(pre.textContent, CODIGO, "el programa entero, sin renglones")
  assert.equal(lineas.marcar({ desde: 1, hasta: 1 }), false)
})

test("sin programa no hay renglones, y repartir dos veces el mismo texto no toca nada", () => {
  const vacio = montarLineas("")
  assert.equal(vacio.lineas.repartir(), 0)
  assert.deepEqual(vacio.pre.hijos, [])
  const m = montarLineas()
  m.lineas.repartir()
  const primeros = [...m.pre.hijos]
  m.lineas.marcar({ desde: 5, hasta: 5 })
  assert.equal(m.lineas.repartir(), LINEAS)
  assert.deepEqual(m.pre.hijos, primeros, "los mismos elementos: no se rehicieron")
  assert.deepEqual(m.marcadas(), [5], "y lo marcado sigue marcado")
})

test("marcar un tramo marca esas líneas y desmarca las de antes; null desmarca todo", () => {
  const m = montarLineas()
  m.lineas.repartir()
  assert.equal(m.lineas.marcar({ desde: 12, hasta: 13 }), true)
  assert.deepEqual(m.marcadas(), [12, 13])
  assert.deepEqual(m.lineas.marcado(), { desde: 12, hasta: 13 })
  assert.equal(m.lineas.primerRenglonMarcado(), m.pre.hijos[11])
  assert.equal(m.lineas.marcar({ desde: 6, hasta: 7 }), true)
  assert.deepEqual(m.marcadas(), [6, 7])
  // No sólo color: el primer renglón del tramo queda anunciado para un lector de pantalla, y sólo él.
  assert.deepEqual(m.pre.hijos.filter((h) => h.getAttribute("aria-current") !== null).map((h) => h.getAttribute("data-linea")), ["6"])
  assert.equal(m.lineas.marcar(null), false)
  assert.deepEqual(m.marcadas(), [])
  assert.equal(m.lineas.marcado(), null)
  assert.equal(m.lineas.primerRenglonMarcado(), null)
  assert.equal(m.pre.hijos.some((h) => h.getAttribute("aria-current") !== null), false)
})

test("un tramo que no entra entero en el programa no se marca, ni una parte", () => {
  const m = montarLineas()
  m.lineas.repartir()
  m.lineas.marcar({ desde: 5, hasta: 5 })
  for (const malo of [{ desde: 15, hasta: 17 }, { desde: 0, hasta: 2 }, { desde: 5, hasta: 4 }, { desde: 1.5, hasta: 2 }, { desde: "1", hasta: 2 }, {}, { desde: 17, hasta: 17 }]) {
    assert.equal(m.lineas.marcar(malo), false, JSON.stringify(malo))
    assert.deepEqual(m.marcadas(), [], `${JSON.stringify(malo)}: tampoco queda lo de antes`)
  }
  assert.equal(m.lineas.marcar({ desde: 16, hasta: 16 }), true, "la última línea sí entra")
})

test("cuando el panel cambia el programa (o lo borra), los renglones de antes dejan de valer", () => {
  const m = montarLineas()
  m.lineas.repartir()
  const viejo = m.pre.hijos[4]
  m.lineas.marcar({ desde: 5, hasta: 5 })
  m.pre.textContent = "" // lo que hace el panel apenas cambia la revisión
  assert.equal(m.lineas.marcar({ desde: 5, hasta: 5 }), false)
  assert.equal(m.lineas.marcado(), null)
  assert.equal(m.lineas.lineaDe(viejo), null, "un renglón del programa anterior no es una línea de éste")
  m.pre.textContent = "otro\nprograma\n"
  assert.equal(m.lineas.marcar({ desde: 1, hasta: 1 }), false, "todavía no se repartió el nuevo")
  assert.equal(m.lineas.repartir(), 2)
  assert.equal(m.lineas.marcar({ desde: 2, hasta: 2 }), true)
  assert.equal(m.lineas.marcar({ desde: 5, hasta: 5 }), false, "la línea 5 era del programa anterior")
})

test("lineaDe: la línea de lo que se tocó, también si se tocó algo de adentro; fuera de una línea, null", () => {
  const m = montarLineas()
  m.lineas.repartir()
  assert.equal(m.lineas.lineaDe(m.pre.hijos[9]), 10)
  assert.equal(m.lineas.lineaDe({ parentNode: m.pre.hijos[12] }), 13, "un nodo de texto dentro del renglón")
  assert.equal(m.lineas.lineaDe(m.pre), null, "el margen del cuadro")
  assert.equal(m.lineas.lineaDe({ parentNode: null }), null)
  assert.equal(m.lineas.lineaDe(null), null)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 2. Qué tramo es de qué bloque, y al revés
// ════════════════════════════════════════════════════════════════════════════════════

test("rangoDeLaClave: el tramo de cada bloque, y null si la estructura no lo tiene", () => {
  assert.deepEqual(rangoDeLaClave(ESTRUCTURA, { bloque: "alIniciar" }), { desde: 4, hasta: 8 })
  assert.deepEqual(rangoDeLaClave(ESTRUCTURA, { bloque: "porSiempre" }), { desde: 10, hasta: 16 })
  assert.deepEqual(rangoDeLaClave(ESTRUCTURA, { bloque: "paso", indice: 1 }), { desde: 6, hasta: 7 })
  assert.deepEqual(rangoDeLaClave(ESTRUCTURA, { bloque: "regla", reglaId: "beh-4" }), { desde: 14, hasta: 15 })
  for (const clave of [null, { bloque: "paso", indice: 9 }, { bloque: "regla", reglaId: "beh-1" }, { bloque: "otro" }, {}]) assert.equal(rangoDeLaClave(ESTRUCTURA, clave), null, JSON.stringify(clave))
  assert.equal(rangoDeLaClave(null, { bloque: "alIniciar" }), null)
  assert.equal(rangoDeLaClave({ alIniciar: { lineas: { desde: 3, hasta: 2 } } }, { bloque: "alIniciar" }), null, "un tramo al revés no es un tramo")
  // Devuelve una copia: quien lo recibe no puede cambiar la estructura.
  rangoDeLaClave(ESTRUCTURA, { bloque: "alIniciar" }).desde = 99
  assert.equal(ESTRUCTURA.alIniciar.lineas.desde, 4)
})

test("una línea marca el bloque más chico que la contiene: la regla o el renglón, no el bloque que los envuelve", () => {
  assert.deepEqual(claveDeLaLinea(ESTRUCTURA, 13), { bloque: "regla", reglaId: "beh-9" }, "está en «por siempre», pero es de una regla")
  assert.deepEqual(claveDeLaLinea(ESTRUCTURA, 14), { bloque: "regla", reglaId: "beh-4" })
  assert.deepEqual(claveDeLaLinea(ESTRUCTURA, 7), { bloque: "paso", indice: 1 }, "está en «al iniciar», pero es de un renglón")
  assert.deepEqual(claveDeLaLinea(ESTRUCTURA, 4), { bloque: "alIniciar" }, "`void setup() {`")
  assert.deepEqual(claveDeLaLinea(ESTRUCTURA, 8), { bloque: "alIniciar" }, "su llave de cierre")
  assert.deepEqual(claveDeLaLinea(ESTRUCTURA, 11), { bloque: "porSiempre" }, "una lectura compartida: del loop, de ninguna regla")
  assert.deepEqual(claveDeLaLinea(ESTRUCTURA, 16), { bloque: "porSiempre" })
  for (const suelta of [1, 2, 3, 9, 17, 0, -1, 2.5, "4", null]) assert.equal(claveDeLaLinea(ESTRUCTURA, suelta), null, String(suelta))
  assert.equal(claveDeLaLinea(null, 4), null)
})

test("ida y vuelta: toda línea del tramo de un bloque vuelve a ese bloque o a uno de adentro", () => {
  for (const clave of [{ bloque: "regla", reglaId: "beh-9" }, { bloque: "regla", reglaId: "beh-4" }, { bloque: "paso", indice: 0 }, { bloque: "paso", indice: 1 }]) {
    const { desde, hasta } = rangoDeLaClave(ESTRUCTURA, clave)
    for (let n = desde; n <= hasta; n++) assert.deepEqual(claveDeLaLinea(ESTRUCTURA, n), clave, `línea ${n}`)
  }
})

test("los textos: una línea o varias junto a los bloques; de qué bloque sale, junto al código", () => {
  assert.equal(textoDelBloque({ desde: 5, hasta: 5 }), "Este bloque es lo mismo que la línea 5 del código.")
  assert.equal(textoDelBloque({ desde: 12, hasta: 13 }), "Este bloque es lo mismo que las líneas 12 a 13 del código.")
  // Una regla son DOS bloques y sus líneas incluyen la condición: tocando el «hacer», «este bloque
  // son las líneas 12 a 13» afirmaba de más. De una regla se dice «esta regla».
  assert.equal(textoDelBloque({ desde: 12, hasta: 13 }, { bloque: "regla", reglaId: "beh-9" }), "Esta regla es lo mismo que las líneas 12 a 13 del código.")
  assert.equal(textoDelBloque({ desde: 12, hasta: 12 }, { bloque: "regla", reglaId: "beh-9" }), "Esta regla es lo mismo que la línea 12 del código.")
  assert.equal(textoDelBloque({ desde: 6, hasta: 7 }, { bloque: "paso", indice: 1 }), "Este bloque es lo mismo que las líneas 6 a 7 del código.")
  for (const malo of [null, {}, { desde: 3, hasta: 2 }]) assert.equal(textoDelBloque(malo), "")
  assert.equal(textoDeLaLinea({ bloque: "alIniciar" }), T.lineaDeAlIniciar)
  assert.equal(textoDeLaLinea({ bloque: "paso", indice: 0 }), T.lineaDePaso)
  assert.equal(textoDeLaLinea({ bloque: "porSiempre" }), T.lineaDePorSiempre)
  assert.equal(textoDeLaLinea(null), T.lineaDeNingunBloque)
  // Ningún id interno ni palabra del programa llega a lo que se lee.
  for (const texto of Object.values(T)) assert.doesNotMatch(texto, /beh-|cmp-|setup|loop|void|\bid\b/, texto)
})

test("la regla 2 es la segunda del lienzo, no la segunda del programa; con una sola no se numera", () => {
  // En el programa `beh-9` va primero; en el lienzo es la segunda.
  assert.equal(textoDeLaLinea({ bloque: "regla", reglaId: "beh-9" }, EN_EL_LIENZO), "Esta línea es parte de la regla 2.")
  assert.equal(textoDeLaLinea({ bloque: "regla", reglaId: "beh-4" }, EN_EL_LIENZO), "Esta línea es parte de la regla 1.")
  assert.equal(textoDeLaLinea({ bloque: "regla", reglaId: "beh-4" }, ["beh-4"]), T.lineaDeLaRegla)
  assert.equal(textoDeLaLinea({ bloque: "regla", reglaId: "beh-4" }), T.lineaDeLaRegla)
  assert.equal(textoDeLaLinea({ bloque: "regla", reglaId: "beh-77" }, EN_EL_LIENZO), T.lineaDeLaRegla, "una regla que no está dibujada: no se le inventa un número")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3. El coordinador
// ════════════════════════════════════════════════════════════════════════════════════

/** `seMarcan`: lo que contestan los que marcan (por defecto, que sí quedó marcado lo que se pidió). */
function montarVinculo(seMarcan = { bloques: true, lineas: true }) {
  const visto = { bloques: undefined, lineas: undefined, juntoALosBloques: undefined, juntoAlCodigo: undefined, vecesBloques: 0 }
  const vinculo = crearVinculoBloquesCodigo({
    marcarBloques: (clave) => { visto.bloques = clave; visto.vecesBloques++; return clave !== null && seMarcan.bloques },
    marcarLineas: (rango) => { visto.lineas = rango; return rango !== null && seMarcan.lineas },
    decirJuntoALosBloques: (texto, opciones) => { visto.juntoALosBloques = { texto, ...opciones } },
    decirJuntoAlCodigo: (texto, opciones) => { visto.juntoAlCodigo = { texto, ...opciones } },
  })
  return { vinculo, visto, seMarcan }
}
const NADA = { bloques: null, lineas: null }
const conPrograma = () => {
  const m = montarVinculo()
  m.vinculo.actualizar(ESTRUCTURA, EN_EL_LIENZO)
  return m
}

test("sin estructura no se invita a tocar, y tocar no marca nada", () => {
  const m = montarVinculo()
  m.vinculo.actualizar(null, [])
  m.vinculo.alTocarBloque({ bloque: "porSiempre" })
  assert.deepEqual({ bloques: m.visto.bloques, lineas: m.visto.lineas }, NADA)
  assert.deepEqual(m.visto.juntoALosBloques, { texto: "", hayLineas: false })
  m.vinculo.alTocarLinea(10)
  assert.deepEqual({ bloques: m.visto.bloques, lineas: m.visto.lineas }, NADA)
  assert.deepEqual(m.visto.juntoAlCodigo, { texto: "", hayBloque: false })
})

test("con estructura y nada marcado, quedan las dos pistas, sin enlace", () => {
  const m = conPrograma()
  assert.deepEqual(m.visto.juntoALosBloques, { texto: T.pistaJuntoALosBloques, hayLineas: false })
  assert.deepEqual(m.visto.juntoAlCodigo, { texto: T.pistaJuntoAlCodigo, hayBloque: false })
  assert.equal(m.vinculo.origen(), null)
})

test("tocar un bloque marca ese bloque y sus líneas, y dice cuáles son", () => {
  const m = conPrograma()
  m.vinculo.alTocarBloque({ bloque: "regla", reglaId: "beh-4" })
  assert.deepEqual(m.visto.bloques, { bloque: "regla", reglaId: "beh-4" })
  assert.deepEqual(m.visto.lineas, { desde: 14, hasta: 15 })
  assert.deepEqual(m.visto.juntoALosBloques, { texto: "Esta regla es lo mismo que las líneas 14 a 15 del código.", hayLineas: true })
  assert.equal(m.vinculo.origen(), "bloque")
})

test("tocar un bloque que el programa no tiene (una regla recién armada) no deja marcado lo anterior", () => {
  const m = conPrograma()
  m.vinculo.alTocarBloque({ bloque: "porSiempre" })
  m.vinculo.alTocarBloque({ bloque: "regla", reglaId: "beh-77" })
  assert.deepEqual({ bloques: m.visto.bloques, lineas: m.visto.lineas }, NADA)
  assert.equal(m.vinculo.origen(), null)
  // Y se dice ESO, no la pista general: «tocá un bloque y se marcan sus líneas» sería falso justo
  // después de tocar uno que no tiene (lo marcó la revisión a ciegas).
  assert.deepEqual(m.visto.juntoALosBloques, { texto: T.bloqueSinLineas, hayLineas: false })
  assert.equal(T.bloqueSinLineas, "Este bloque todavía no está en el programa.")
})

test("tocar una línea marca su bloque y el tramo ENTERO de ese bloque, y dice de dónde sale", () => {
  const m = conPrograma()
  m.vinculo.alTocarLinea(13)
  assert.deepEqual(m.visto.bloques, { bloque: "regla", reglaId: "beh-9" })
  assert.deepEqual(m.visto.lineas, { desde: 12, hasta: 13 })
  assert.deepEqual(m.visto.juntoAlCodigo, { texto: "Esta línea es parte de la regla 2.", hayBloque: true })
  assert.deepEqual(m.visto.juntoALosBloques, { texto: "Esta regla es lo mismo que las líneas 12 a 13 del código.", hayLineas: true })
  assert.equal(m.vinculo.origen(), "linea")
})

test("una línea que no es de ningún bloque se marca sola, lo dice y no ofrece ir a un bloque", () => {
  const m = conPrograma()
  m.vinculo.alTocarLinea(14)
  m.vinculo.alTocarLinea(2)
  assert.equal(m.visto.bloques, null, "se desmarca el bloque de antes")
  assert.deepEqual(m.visto.lineas, { desde: 2, hasta: 2 })
  assert.deepEqual(m.visto.juntoAlCodigo, { texto: T.lineaDeNingunBloque, hayBloque: false })
  assert.deepEqual(m.visto.juntoALosBloques, { texto: T.pistaJuntoALosBloques, hayLineas: false })
})

test("tocar el código fuera de una línea desmarca", () => {
  const m = conPrograma()
  m.vinculo.alTocarLinea(14)
  m.vinculo.alTocarLinea(null)
  assert.deepEqual({ bloques: m.visto.bloques, lineas: m.visto.lineas }, NADA)
  assert.equal(m.vinculo.origen(), null)
})

test("tocar el fondo del lienzo deshace lo que se marcó tocando un bloque, no lo que se marcó desde el código", () => {
  const m = conPrograma()
  m.vinculo.alTocarBloque({ bloque: "alIniciar" })
  m.vinculo.alTocarBloque(null)
  assert.deepEqual({ bloques: m.visto.bloques, lineas: m.visto.lineas }, NADA)
  m.vinculo.alTocarLinea(14)
  m.vinculo.alTocarBloque(null)
  assert.deepEqual(m.visto.lineas, { desde: 14, hasta: 15 }, "lo marcado desde el código sigue")
  assert.equal(m.vinculo.origen(), "linea")
})

test("cuando cambia el programa se borra lo marcado; un repintado con el MISMO programa no lo toca", () => {
  const m = conPrograma()
  m.vinculo.alTocarBloque({ bloque: "regla", reglaId: "beh-4" })
  m.vinculo.actualizar(ESTRUCTURA, EN_EL_LIENZO)
  assert.deepEqual(m.visto.lineas, { desde: 14, hasta: 15 }, "mismo programa: queda como estaba")
  m.vinculo.actualizar(null, EN_EL_LIENZO)
  assert.deepEqual({ bloques: m.visto.bloques, lineas: m.visto.lineas }, NADA)
  assert.deepEqual(m.visto.juntoALosBloques, { texto: "", hayLineas: false }, "sin programa, tampoco la pista")
  // Otra estructura (otra revisión), aunque diga lo mismo: lo marcado era de la anterior.
  m.vinculo.actualizar(ESTRUCTURA, EN_EL_LIENZO)
  m.vinculo.alTocarLinea(5)
  m.vinculo.actualizar(structuredClone(ESTRUCTURA), EN_EL_LIENZO)
  assert.deepEqual({ bloques: m.visto.bloques, lineas: m.visto.lineas }, NADA)
})

test("el orden de las reglas del lienzo se toma en cada repintado, aunque el programa sea el mismo", () => {
  const m = conPrograma()
  m.vinculo.actualizar(ESTRUCTURA, ["beh-9", "beh-4"])
  m.vinculo.alTocarLinea(13)
  assert.equal(m.visto.juntoAlCodigo.texto, "Esta línea es parte de la regla 1.")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 4. La estructura que guarda el panel de código
// ════════════════════════════════════════════════════════════════════════════════════

test("estructuraUsable: la misma estructura si entra entera en el programa; si no, null", () => {
  assert.equal(estructuraUsable(ESTRUCTURA, LINEAS), ESTRUCTURA, "el mismo objeto, sin copiar")
  assert.equal(estructuraUsable({ ...ESTRUCTURA, alIniciar: { ...ESTRUCTURA.alIniciar, pasos: [] }, reglas: [] }, LINEAS) !== null, true, "sin pasos ni reglas también vale")
})

test("una estructura con un tramo que no entra en el programa, o con algo que falta, no se usa", () => {
  const con = (cambio) => estructuraUsable({ ...ESTRUCTURA, ...cambio }, LINEAS)
  assert.equal(estructuraUsable(ESTRUCTURA, LINEAS - 1), null, "«por siempre» termina después de la última línea")
  assert.equal(con({ porSiempre: { lineas: { desde: 10, hasta: 17 } } }), null)
  assert.equal(con({ reglas: [{ id: "beh-4", lineas: { desde: 14, hasta: 99 } }] }), null)
  assert.equal(con({ reglas: [{ id: "", lineas: { desde: 14, hasta: 15 } }] }), null)
  assert.equal(con({ reglas: [{ lineas: { desde: 14, hasta: 15 } }] }), null)
  assert.equal(con({ reglas: "x" }), null)
  assert.equal(con({ alIniciar: { lineas: { desde: 4, hasta: 8 }, pasos: [{ texto: "", lineas: { desde: 5, hasta: 5 } }] } }), null)
  assert.equal(con({ alIniciar: { lineas: { desde: 4, hasta: 8 }, pasos: [{ texto: "x", lineas: { desde: 0, hasta: 5 } }] } }), null)
  assert.equal(con({ alIniciar: { lineas: { desde: 8, hasta: 4 }, pasos: [] } }), null)
  assert.equal(con({ alIniciar: { lineas: { desde: 4, hasta: 8 } } }), null)
  assert.equal(con({ alIniciar: null }), null)
  assert.equal(con({ porSiempre: undefined }), null)
  for (const nada of [null, undefined, "x", 7]) assert.equal(estructuraUsable(nada, LINEAS), null)
  for (const lineas of [0, -1, 1.5, "16", undefined]) assert.equal(estructuraUsable(ESTRUCTURA, lineas), null, String(lineas))
})

const elemento = () => ({ textContent: "", hidden: true })
function montarPanel() {
  const pedidos = []
  const fetch = (ruta) => new Promise((resolver) => pedidos.push({ ruta, resolver }))
  const contestar = (i, cuerpo, status = 200) => pedidos[i].resolver({ status, json: async () => cuerpo })
  const avisos = []
  const el = { codigo: elemento(), aviso: elemento() }
  let panel
  // Lo que pregunta la página apenas le avisan que cambió el programa.
  panel = crearPanelCodigo({ fetch, elementoCodigo: el.codigo, elementoAviso: el.aviso, alCambiarElPrograma: () => avisos.push(panel.estructuraDelPrograma()) })
  return { panel, pedidos, contestar, avisos, el }
}
const PROG = (revision, estructura) => ({ revision, programa: { ok: true, archivo: "src/main.cpp", codigo: CODIGO, lineas: LINEAS, ...(estructura === undefined ? {} : { estructura }) } })

test("el panel guarda la estructura que vino con el programa y dice de qué revisión es", async () => {
  const m = montarPanel()
  assert.equal(m.panel.estructuraDelPrograma(), null, "antes de pedir nada")
  const listo = m.panel.actualizar({ revision: 7 })
  assert.equal(m.panel.estructuraDelPrograma(), null, "mientras se pide")
  m.contestar(0, PROG(7, ESTRUCTURA))
  await listo
  const dicho = m.panel.estructuraDelPrograma()
  assert.equal(dicho.revision, 7)
  assert.deepEqual(dicho.estructura, ESTRUCTURA)
  assert.equal(m.panel.estructuraDelPrograma().estructura, dicho.estructura, "para un mismo programa, siempre el mismo objeto")
  // Quien escucha el aviso ya la encuentra: el aviso llega DESPUÉS de guardarla.
  assert.deepEqual(m.avisos.at(-1), dicho)
})

test("la estructura se va con el código: al cambiar la revisión no queda la del programa anterior", async () => {
  const m = montarPanel()
  const a = m.panel.actualizar({ revision: 7 })
  m.contestar(0, PROG(7, ESTRUCTURA))
  await a
  const b = m.panel.actualizar({ revision: 8 })
  assert.equal(m.panel.estructuraDelPrograma(), null, "con la revisión 8 pedida no vale la estructura de la 7")
  assert.equal(m.avisos.at(-1), null, "y quien escucha el aviso se entera en ese momento")
  m.contestar(1, { revision: 8, programa: { ok: false, porQue: "todavía no" } })
  await b
  assert.equal(m.panel.estructuraDelPrograma(), null, "sin programa no hay estructura")
})

test("un programa sin estructura, o con una que no entra en él, se muestra igual y sin estructura", async () => {
  for (const estructura of [undefined, null, { ...ESTRUCTURA, porSiempre: { lineas: { desde: 10, hasta: 400 } } }]) {
    const m = montarPanel()
    const listo = m.panel.actualizar({ revision: 3 })
    m.contestar(0, PROG(3, estructura))
    await listo
    assert.equal(m.el.codigo.textContent, CODIGO)
    assert.equal(m.el.codigo.hidden, false)
    assert.equal(m.panel.estructuraDelPrograma(), null)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 5. El cableado de la página
// ════════════════════════════════════════════════════════════════════════════════════

test("la estructura de otra revisión no se le pasa a los bloques", () => {
  assert.equal(estructuraDeLaRevision({ revision: 7, estructura: ESTRUCTURA }, 7), ESTRUCTURA)
  assert.equal(estructuraDeLaRevision({ revision: 7, estructura: ESTRUCTURA }, 8), null, "el proyecto ya va por la 8")
  assert.equal(estructuraDeLaRevision({ revision: 8, estructura: ESTRUCTURA }, 7), null)
  assert.equal(estructuraDeLaRevision(null, 7), null)
  assert.equal(estructuraDeLaRevision({ revision: undefined, estructura: ESTRUCTURA }, undefined), null, "sin revisión no hay con qué comparar")
})

test("pintarVinculo: sin texto no se ve nada; el enlace sólo cuando hay adónde ir", () => {
  const partes = () => ({ caja: { hidden: true }, texto: { textContent: "viejo" }, enlace: { hidden: true } })
  let p = partes()
  pintarVinculo(p, "Este bloque es lo mismo que la línea 5 del código.")
  assert.deepEqual([p.caja.hidden, p.texto.textContent, p.enlace.hidden], [false, "Este bloque es lo mismo que la línea 5 del código.", false])
  pintarVinculo(p, "Tocá un bloque…", { conEnlace: false })
  assert.deepEqual([p.caja.hidden, p.enlace.hidden], [false, true])
  pintarVinculo(p, "")
  assert.deepEqual([p.caja.hidden, p.texto.textContent, p.enlace.hidden], [true, "", true])
  p = { caja: { hidden: true }, texto: { textContent: "" }, enlace: null }
  assert.doesNotThrow(() => pintarVinculo(p, "algo"))
})

const HTML = readFileSync(join(WEB, "index.html"), "utf8")
const APP = readFileSync(join(WEB, "app.js"), "utf8")
const sinComentarios = HTML.replace(/<!--[\s\S]*?-->/g, "")

test("index.html: cada renglón del vínculo arranca oculto, es un aviso y su enlace lleva al otro lado", () => {
  const renglon = (id) => new RegExp(`<p id="${id}"[^>]*>([\\s\\S]*?)</p>`).exec(sinComentarios)
  const deBloques = renglon("vista-logica-vinculo")
  const deCodigo = renglon("vista-codigo-vinculo")
  assert.ok(deBloques && deCodigo)
  for (const r of [deBloques, deCodigo]) {
    assert.match(r[0], /^<p [^>]*\bhidden\b/, "oculto hasta que haya algo que decir")
    assert.match(r[0], /role="status"/)
  }
  assert.match(deBloques[1], /<span id="vista-logica-vinculo-texto"><\/span>/)
  assert.match(deBloques[1], /<a id="vista-logica-vinculo-enlace" class="tb-boton" href="#paso-programa">Ir a esas líneas ↓<\/a>/)
  assert.match(deCodigo[1], /<span id="vista-codigo-vinculo-texto"><\/span>/)
  assert.match(deCodigo[1], /<a id="vista-codigo-vinculo-enlace" class="tb-boton" href="#vista-logica">Ir a los bloques ↑<\/a>/)
  // 2026-11-27, notebook: «Verlo en el código» no se leyó como algo para tocar. Los dos enlaces son
  // ahora una acción con dirección y tienen forma de botón. Y el de los bloques va ARRIBA del
  // lienzo: debajo quedaba después de todos los bloques y no se veía.
  const lugar = (id) => sinComentarios.indexOf(`id="${id}"`)
  assert.ok(lugar("vista-logica-etiqueta") < lugar("vista-logica-vinculo") && lugar("vista-logica-vinculo") < lugar("vista-logica-lienzo"), "el renglón de los bloques va entre el párrafo y el lienzo")
  // Los destinos existen, y el de los bloques deja lugar para el header fijo.
  for (const id of ["paso-programa", "vista-logica"]) assert.match(sinComentarios, new RegExp(`id="${id}"`))
  assert.match(HTML, /#vista-logica \{ scroll-margin-top:/)
  // El renglón del código va DENTRO del cuadro del código, después del programa.
  assert.match(sinComentarios, /id="vista-codigo-texto"[^>]*><\/pre>\s*<p id="vista-codigo-vinculo"/)
})

test("los textos fijos de la página no invitan a tocar: eso sólo se dice cuando hay programa", () => {
  const visible = sinComentarios.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  assert.doesNotMatch(visible, /Tocá un bloque|Tocá una línea/)
  for (const pista of [T.pistaJuntoALosBloques, T.pistaJuntoAlCodigo]) assert.match(pista, /Tocá (un bloque|una línea)/, "precondición: las pistas son las que se buscan arriba")
  // La IDEA (bloques y código son lo mismo) sí va en el texto fijo de los bloques: no invita a nada.
  assert.match(visible, /Los bloques y el código del paso 3 son el mismo programa, escrito de dos maneras\./)
})

test("el renglón marcado se distingue por algo más que el color, y el número de línea no es texto", () => {
  const regla = (selector) => new RegExp(`${selector.replace(/[.[\]:]/g, "\\$&")} \\{([^}]*)\\}`).exec(HTML)?.[1] ?? ""
  assert.match(regla(".linea-de-codigo[data-marcada]"), /border-left-color:/)
  assert.match(regla(".linea-de-codigo[data-marcada]"), /background:/)
  assert.match(regla(".linea-de-codigo::before"), /content: counter\(linea\)/)
  assert.match(regla(".linea-de-codigo::before"), /user-select: none/)
  assert.match(regla(".linea-de-codigo"), /display: block/)
})

test("app.js: los módulos nuevos se sirven, y la página une el lienzo, el código y el vínculo", () => {
  const rutas = construirRutasDeAssets()
  for (const archivo of ["codigo-por-lineas.js", "vinculo-bloques-codigo.js"]) {
    assert.ok(rutas.has(archivo), `${archivo} no está en la lista blanca: el navegador recibiría un 404 y app.js no cargaría`)
    assert.match(APP, new RegExp(`from "\\./${archivo.replace(".", "\\.")}"`))
  }
  // El MISMO elemento que el panel: si fueran dos, se repartiría un cuadro vacío.
  assert.match(APP, /const elementoCodigo = document\.getElementById\("vista-codigo-texto"\)\n\s+codigoPorLineas = crearCodigoPorLineas\(\{ doc: document, elementoCodigo \}\)/)
  assert.match(APP, /alSeleccionar: \(clave\) => \{[\s\S]{0,360}?vinculoBloquesCodigo\?\.alTocarBloque\(clave\)\n    \},/)
  assert.match(APP, /elementoCodigo\.addEventListener\("click", \(evento\) => \{[\s\S]{0,260}?vinculoBloquesCodigo\.alTocarLinea\(codigoPorLineas\.lineaDe\(evento\.target\)\)\n  \}\)/)
  // Arrastrar para seleccionar texto no es tocar una línea (lo encontró el especialista de calidad).
  assert.match(APP, /if \(window\.getSelection && !window\.getSelection\(\)\.isCollapsed\) return\n\s+vinculoBloquesCodigo\.alTocarLinea/)
  // Sin mouse: las flechas recorren las líneas (sin esto no había cómo tocar una línea).
  assert.match(APP, /elementoCodigo\.addEventListener\("keydown", /)
  assert.match(APP, /const numero = codigoPorLineas\.vecina\(paso\)\n\s+if \(numero === null\) return\n\s+evento\.preventDefault\(\)\n\s+vinculoBloquesCodigo\.alTocarLinea\(numero\)/)
  // El vínculo recibe la MISMA estructura filtrada por revisión que los bloques y la clave. La
  // revisión independiente mostró que pasarle la del panel sin filtrar dejaba todo en verde.
  assert.match(APP, /vinculoBloquesCodigo\?\.actualizar\(estructura, /)
  // Dos llamadas: ésa, y la que lo deja sin estructura cuando llega un snapshot sin vista.
  assert.equal([...APP.matchAll(/vinculoBloquesCodigo\?\.actualizar\(/g)].length, 2)
  assert.equal([...APP.matchAll(/vinculoBloquesCodigo\?\.actualizar\(null, /g)].length, 1)
  // Los enlaces no cambian la dirección de la página: ahí vive la llave de la sesión (`#t=…`).
  for (const enlace of ["vinculoDeLosBloques", "vinculoDelCodigo"]) assert.match(APP, new RegExp(`${enlace}\\.enlace\\?\\.addEventListener\\("click", \\(evento\\) => \\{\\n\\s+evento\\.preventDefault\\(\\)`), enlace)
  assert.doesNotMatch(APP, /location\.hash\s*=/)
  // Los bloques reciben la estructura SÓLO por la función que compara la revisión.
  assert.match(APP, /const estructura = estructuraDeLaRevision\(panelCodigo\?\.estructuraDelPrograma\?\.\(\) \?\? null, ultimoSnapshot\.revision\)/)
  assert.equal([...APP.matchAll(/panelVistaLogica\?\.repintar\(/g)].length, 1, "un solo lugar repinta los bloques")
  assert.match(APP, /panelVistaLogica\?\.repintar\(ultimoSnapshot, \{[^}]*\bestructura \}\)/)
  // Se pone al día en cada repintado y cada vez que cambia el programa.
  assert.match(APP, /restaurarFocoRegla\(secciones\.reglas\)\n  sincronizarBloquesYCodigo\(\)\n\}/)
  assert.match(APP, /alCambiarElPrograma: \(\) => \{\n\s+repintarRenglonDelPrograma\(\)\n\s+sincronizarBloquesYCodigo\(\)\n\s+\}/)
  // Acercar la línea marcada no mueve la página: sólo el cuadro del código.
  assert.doesNotMatch(APP, /scrollIntoView/)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 6. Lo que encontró el especialista de calidad (2026-11-27)
// ════════════════════════════════════════════════════════════════════════════════════

// Sin mouse no se podía marcar una línea: las líneas no reciben foco y el cuadro del código no
// atendía ninguna tecla. Y como «Ir a los bloques» sólo aparece tras tocar una línea, tampoco se
// llegaba a ese enlace.
test("recorrer el código con las flechas: de a una línea, sin pasarse de los extremos, y deja el cursor a la vista", () => {
  const m = montarLineas()
  m.lineas.repartir()
  const conCursor = () => m.pre.hijos.filter((h) => h.getAttribute("data-cursor") !== null).map((h) => Number(h.getAttribute("data-linea")))
  assert.equal(m.lineas.cursor(), null)
  assert.equal(m.lineas.vecina(1), 1, "sin cursor, hacia abajo arranca por la primera")
  assert.equal(m.lineas.vecina(1), 2)
  assert.deepEqual(conCursor(), [2], "una sola línea lleva el cursor")
  assert.equal(m.lineas.vecina(-1), 1)
  assert.equal(m.lineas.vecina(-1), 1, "no pasa del principio")
  // Tocar una línea con el mouse mueve el cursor ahí: las flechas siguen desde donde se tocó.
  assert.equal(m.lineas.lineaDe(m.pre.hijos[14]), 15)
  assert.equal(m.lineas.vecina(1), 16)
  assert.equal(m.lineas.vecina(1), 16, "no pasa del final")
  assert.deepEqual(conCursor(), [16])
  for (const malo of [0, 2, "1", null]) assert.equal(m.lineas.vecina(malo), null, String(malo))
  // Viniendo de un bloque hay un tramo marcado y todavía no hay cursor: se sigue desde el tramo
  // (visto en Chromium: la primera flecha saltaba a la línea 1).
  const desdeBloque = montarLineas()
  desdeBloque.lineas.repartir()
  desdeBloque.lineas.marcar({ desde: 12, hasta: 13 })
  assert.equal(desdeBloque.lineas.vecina(1), 14, "hacia abajo, la que sigue al tramo")
  const haciaArriba = montarLineas()
  haciaArriba.lineas.repartir()
  haciaArriba.lineas.marcar({ desde: 12, hasta: 13 })
  assert.equal(haciaArriba.lineas.vecina(-1), 11, "hacia arriba, la anterior al tramo")
  // Hacia arriba sin cursor arranca por la última.
  const otro = montarLineas()
  otro.lineas.repartir()
  assert.equal(otro.lineas.vecina(-1), LINEAS)
  // Con otro programa el cursor de antes no vale.
  m.pre.textContent = "otro\nprograma\n"
  assert.equal(m.lineas.vecina(1), null, "todavía no se repartió")
  m.lineas.repartir()
  assert.equal(m.lineas.cursor(), null)
  assert.equal(m.lineas.vecina(1), 1)
})

// Con seis reglas, «Ir a esas líneas» dejaba a la vista el título y la clave, con el código marcado
// debajo del borde de la ventana; e «Ir a los bloques» dejaba la regla 6 fuera en una notebook.
test("desplazamientoHasta: lleva lo marcado al medio de lo que se ve, y si ya se ve entero no mueve nada", () => {
  const ventana = { altoVentana: 800, altoCabecera: 100 }
  assert.equal(desplazamientoHasta({ top: 300, bottom: 360 }, ventana), 0, "ya está a la vista")
  assert.equal(desplazamientoHasta({ top: 100, bottom: 800 }, ventana), 0, "justo en los bordes")
  // Debajo del borde: el centro de lo visible está en 100 + 700/2 = 450.
  assert.equal(desplazamientoHasta({ top: 900, bottom: 960 }, ventana), 930 - 450)
  // Tapado por el header fijo: hay que subir.
  assert.equal(desplazamientoHasta({ top: 40, bottom: 100 }, ventana), 70 - 450)
  assert.ok(desplazamientoHasta({ top: 40, bottom: 100 }, ventana) < 0)
  for (const mala of [null, {}, { top: Number.NaN, bottom: 3 }]) assert.equal(desplazamientoHasta(mala, ventana), 0)
})

test("en el papel no salen las pistas, los enlaces ni lo marcado, y la clave no se parte", () => {
  const impresion = /@media print \{([\s\S]*?)\n  \}\n/.exec(HTML)
  assert.ok(impresion)
  assert.match(impresion[1], /#vista-logica-vinculo, #vista-codigo-vinculo \{ display: none !important; \}/)
  assert.match(impresion[1], /\.linea-de-codigo\[data-marcada\] \{ background: none; border-left-color: transparent; \}/)
  assert.match(impresion[1], /\.tecnia-bloque-marcado > \.blocklyPath \{ stroke: none; \}/)
  assert.match(impresion[1], /#vista-codigo-nombres \{ break-inside: avoid; \}/)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 7. Lo que encontró la revisión a ciegas del pulido (2026-11-27)
// ════════════════════════════════════════════════════════════════════════════════════

test("las pistas no dicen «cada bloque» ni «cada línea»: hay bloques sin líneas y líneas sin bloque", () => {
  for (const pista of [T.pistaJuntoALosBloques, T.pistaJuntoAlCodigo]) assert.doesNotMatch(pista, /\b[Cc]ada\b|\b[Tt]od[oa]s?\b/, pista)
})

// El coordinador ofrecía «Ir a los bloques» o «Ir a esas líneas» mirando sólo la estructura, sin
// preguntar si algo había quedado marcado. Sin Blockly, o con una regla del programa que no está
// dibujada, el enlace llevaba a nada.
test("el enlace se ofrece sólo si de verdad quedó marcado adónde ir", () => {
  const sinBloque = montarVinculo({ bloques: false, lineas: true })
  sinBloque.vinculo.actualizar(ESTRUCTURA, EN_EL_LIENZO)
  sinBloque.vinculo.alTocarLinea(13)
  assert.equal(sinBloque.visto.juntoAlCodigo.texto, "Esta línea es parte de la regla 2.", "de dónde sale se dice igual: es cierto")
  assert.equal(sinBloque.visto.juntoAlCodigo.hayBloque, false, "pero no se ofrece ir a un bloque que no se marcó")
  assert.equal(sinBloque.visto.juntoALosBloques.hayLineas, false)
  const sinLineas = montarVinculo({ bloques: true, lineas: false })
  sinLineas.vinculo.actualizar(ESTRUCTURA, EN_EL_LIENZO)
  sinLineas.vinculo.alTocarBloque({ bloque: "regla", reglaId: "beh-4" })
  assert.deepEqual(sinLineas.visto.juntoALosBloques, { texto: "", hayLineas: false }, "sin líneas marcadas no se afirma en qué líneas está")
})

test("sin bloques dibujados (sin Blockly, o sin nada que armar) no se invita a tocarlos ni se promete marcar uno", () => {
  const m = montarVinculo({ bloques: false, lineas: true })
  m.vinculo.actualizar(ESTRUCTURA, EN_EL_LIENZO, { hayBloques: false })
  assert.deepEqual(m.visto.juntoALosBloques, { texto: "", hayLineas: false })
  assert.deepEqual(m.visto.juntoAlCodigo, { texto: "", hayBloque: false })
  // Aparecen los bloques (mismo programa): vuelven las pistas.
  m.seMarcan.bloques = true
  m.vinculo.actualizar(ESTRUCTURA, EN_EL_LIENZO, { hayBloques: true })
  assert.equal(m.visto.juntoALosBloques.texto, T.pistaJuntoALosBloques)
  assert.equal(m.visto.juntoAlCodigo.texto, T.pistaJuntoAlCodigo)
})

// El lienzo se puede rearmar entero sin que cambie el programa (cambian las opciones de un
// casillero al armar una condición). Los bloques nuevos nacen sin marca, y el código seguía
// diciendo «Esta regla es lo mismo que las líneas…».
test("en cada repintado con el mismo programa, el bloque marcado se vuelve a marcar", () => {
  const m = conPrograma()
  m.vinculo.alTocarBloque({ bloque: "regla", reglaId: "beh-4" })
  const veces = m.visto.vecesBloques
  m.visto.bloques = "rearmado: los bloques nuevos no tienen marca"
  m.vinculo.actualizar(ESTRUCTURA, EN_EL_LIENZO)
  assert.deepEqual(m.visto.bloques, { bloque: "regla", reglaId: "beh-4" })
  assert.equal(m.visto.vecesBloques, veces + 1)
  assert.deepEqual(m.visto.lineas, { desde: 14, hasta: 15 }, "las líneas no se tocan")
  // Marcado desde una línea, también.
  m.vinculo.alTocarLinea(13)
  m.visto.bloques = "rearmado"
  m.vinculo.actualizar(ESTRUCTURA, EN_EL_LIENZO)
  assert.deepEqual(m.visto.bloques, { bloque: "regla", reglaId: "beh-9" })
  // Sin nada marcado, un repintado no marca nada.
  m.vinculo.alTocarLinea(null)
  const antes = m.visto.vecesBloques
  m.vinculo.actualizar(ESTRUCTURA, EN_EL_LIENZO)
  assert.equal(m.visto.vecesBloques, antes)
})

test("si el bloque marcado ya no está dibujado tras rearmar, lo que se marcó tocándolo se borra entero", () => {
  const m = conPrograma()
  m.vinculo.alTocarBloque({ bloque: "regla", reglaId: "beh-4" })
  m.seMarcan.bloques = false // la regla ya no está en el lienzo
  m.vinculo.actualizar(ESTRUCTURA, ["beh-9"])
  assert.deepEqual({ bloques: m.visto.bloques, lineas: m.visto.lineas }, NADA)
  assert.equal(m.vinculo.origen(), null)
})

test("hayEstructura dice si tocar una línea puede marcar algo", () => {
  const m = montarVinculo()
  assert.equal(m.vinculo.hayEstructura(), false)
  m.vinculo.actualizar(ESTRUCTURA, EN_EL_LIENZO)
  assert.equal(m.vinculo.hayEstructura(), true)
  m.vinculo.actualizar(null, [])
  assert.equal(m.vinculo.hayEstructura(), false)
})

// Las flechas se tragaban aunque no hubiera estructura: con un programa sin ella, el cuadro del
// código dejaba de desplazarse con el teclado. Y el cursor quedaba en la última línea tocada
// aunque después se hubiera marcado otro tramo desde un bloque.
test("app.js: sin estructura las flechas no se tocan, y al venir de un bloque el cursor se suelta", () => {
  assert.match(APP, /if \(!vinculoBloquesCodigo\.hayEstructura\(\)\) return\n\s+const numero = codigoPorLineas\.vecina\(paso\)/)
  // Mayúsculas + flecha extiende la selección de texto: tampoco se toca.
  assert.match(APP, /evento\.metaKey \|\| evento\.shiftKey\) return/)
  // Un snapshot sin vista no deja la clave ni lo marcado de la revisión anterior.
  assert.match(APP, /if \(!ultimoSnapshot\?\.vista\) \{[\s\S]{0,420}?pintarNombresDelPrograma\(document, elementoNombresDelPrograma, null\)\n\s+vinculoBloquesCodigo\?\.actualizar\(null, \[\], \{ hayBloques: false \}\)/)
  assert.match(APP, /if \(clave\) codigoPorLineas\?\.soltarCursor\(\)\n\s+vinculoBloquesCodigo\?\.alTocarBloque\(clave\)/)
  assert.match(APP, /vinculoBloquesCodigo\?\.actualizar\(estructura, [^\n]*\{ hayBloques \}\)/)
  const m = montarLineas()
  m.lineas.repartir()
  m.lineas.lineaDe(m.pre.hijos[2]) // se tocó la línea 3
  m.lineas.marcar({ desde: 12, hasta: 13 }) // después, un bloque marcó otro tramo
  m.lineas.soltarCursor()
  assert.equal(m.lineas.cursor(), null)
  assert.equal(m.pre.hijos.some((h) => h.getAttribute("data-cursor") !== null), false)
  assert.equal(m.lineas.vecina(1), 14, "sigue desde lo marcado, no desde la línea 3")
})
