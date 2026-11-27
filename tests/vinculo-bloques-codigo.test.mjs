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
const { estructuraDeLaRevision, pintarVinculo } = await import(join(WEB, "app.js"))
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

function montarVinculo() {
  const visto = { bloques: undefined, lineas: undefined, juntoALosBloques: undefined, juntoAlCodigo: undefined }
  const vinculo = crearVinculoBloquesCodigo({
    marcarBloques: (clave) => { visto.bloques = clave },
    marcarLineas: (rango) => { visto.lineas = rango },
    decirJuntoALosBloques: (texto, opciones) => { visto.juntoALosBloques = { texto, ...opciones } },
    decirJuntoAlCodigo: (texto, opciones) => { visto.juntoAlCodigo = { texto, ...opciones } },
  })
  return { vinculo, visto }
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
  assert.match(APP, /alSeleccionar: \(clave\) => vinculoBloquesCodigo\?\.alTocarBloque\(clave\)/)
  assert.match(APP, /elementoCodigo\.addEventListener\("click", \(evento\) => vinculoBloquesCodigo\.alTocarLinea\(codigoPorLineas\.lineaDe\(evento\.target\)\)\)/)
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
