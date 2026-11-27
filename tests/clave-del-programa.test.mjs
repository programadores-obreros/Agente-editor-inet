// La clave del programa: qué pieza es `cmp-12` y qué regla es `beh-28`.
//
// POR QUÉ EXISTE (2026-11-27, hallazgo W38 de la notebook real del dueño). El programa generado
// nombra piezas y reglas por su id interno (`PIN_CMP_18_ANODO`, `// beh-28 -> cmp-16`). Con cuatro
// LED, el alumno no sabía cuál era cmp-18. El programa no se toca (es ASCII por diseño y lo que se
// ve es lo que se compila): arriba del código va una clave armada con datos que ya están en la
// página.
//
// Lo que se cuida:
//   1. el nombre de cada pieza es el del esquema («LED 3»), no uno calculado de nuevo;
//   2. la clave sólo nombra lo que el programa nombra (una resistencia no tiene pin: no va);
//   3. «regla 2» es la segunda del lienzo, igual que en los bloques;
//   4. sin estructura no hay clave, y nunca queda la de otra revisión;
//   5. un nombre de pieza se escribe como texto, nunca como marcado.
//
// VISTO EN CHROMIUM (ventana real, cuatro reglas, cuatro LED): los diez renglones, el programa
// byte a byte igual, y al editar una regla la clave se oculta hasta que llega el programa nuevo.
//
// MUTACIONES que ponen rojo este archivo (una por vez, con el cambio ya commiteado):
//   - `programa-para-vista.ts`: `piezas.set(paso.componente, paso.componente)`      → «por el cableado real…»
//   - `programa-para-vista.ts`: `piezas` armado con todos los componentes del proyecto → «por el cableado real…»
//   - `clave-del-programa.js`: sin `.filter((regla) => enElPrograma.has(regla.id))` → «sólo las reglas que el programa tiene…»
//   - `clave-del-programa.js`: numerar después de filtrar                            → «sólo las reglas que el programa tiene…»
//   - `clave-del-programa.js`: `numero: i + 1` siempre                               → «con una sola regla…»
//   - `clave-del-programa.js`: `pintar` sin `elemento.hidden = true` cuando no hay   → «sin nombres…»
//   - `clave-del-programa.js`: `pintar` sin `replaceChildren()` cuando no hay        → «sin nombres…»
//   - `vista-codigo.js`: aceptar `piezas` con un nombre vacío                        → «unas piezas mal formadas…»
//   - `app.js`: pasar `panelCodigo.estructuraDelPrograma()?.estructura` en vez de `estructura` → «app.js…»
//
// Corre con: node --test tests/clave-del-programa.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const WEB = join(REPO, "opencode/vista-fisica/web")
const { nombresDelPrograma, pintarNombresDelPrograma, TEXTOS_DE_LOS_NOMBRES: T } = await import(join(WEB, "clave-del-programa.js"))
const { estructuraUsable } = await import(join(WEB, "vista-codigo.js"))
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { construirRutasDeAssets } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { cargarProgramaDe } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))

const LINEAS = 20
const tramo = (desde, hasta = desde) => ({ desde, hasta })
const ESTRUCTURA = {
  alIniciar: { lineas: tramo(4, 8), pasos: [{ texto: "Pulsador (GPIO25): entrada", lineas: tramo(5) }] },
  porSiempre: { lineas: tramo(10, 20) },
  reglas: [{ id: "beh-9", lineas: tramo(12, 13) }, { id: "beh-4", lineas: tramo(14, 15) }],
  piezas: [{ id: "cmp-3", nombre: "Pulsador" }, { id: "cmp-0", nombre: "LED" }, { id: "cmp-5", nombre: "LED 2" }],
}
const REGLAS_DE_LA_VISTA = [{ id: "beh-4", texto: "Mientras el Pulsador esté presionado, el LED está encendido." }, { id: "beh-9", texto: "Mientras haga calor, el LED 2 está encendido." }]

// ════════════════════════════════════════════════════════════════════════════════════
// 1. Qué dice la clave
// ════════════════════════════════════════════════════════════════════════════════════

test("las piezas en el orden de la estructura, y las reglas en el orden del lienzo con su número", () => {
  assert.deepEqual(nombresDelPrograma(ESTRUCTURA, REGLAS_DE_LA_VISTA), {
    piezas: ESTRUCTURA.piezas,
    reglas: [
      { id: "beh-4", numero: 1, texto: REGLAS_DE_LA_VISTA[0].texto },
      { id: "beh-9", numero: 2, texto: REGLAS_DE_LA_VISTA[1].texto },
    ],
  })
})

test("sólo las reglas que el programa tiene, y el número es su lugar entre TODAS las dibujadas", () => {
  // Una regla recién empezada está dibujada (es la 2) pero no está en el programa.
  const dibujadas = [REGLAS_DE_LA_VISTA[0], { id: "beh-20", texto: null }, REGLAS_DE_LA_VISTA[1]]
  assert.deepEqual(nombresDelPrograma(ESTRUCTURA, dibujadas).reglas.map((r) => [r.id, r.numero]), [["beh-4", 1], ["beh-9", 3]], "beh-9 es la regla 3 en los bloques: acá también")
})

test("con una sola regla dibujada no se numera, y una regla sin oración va sin ella", () => {
  const una = nombresDelPrograma({ ...ESTRUCTURA, reglas: [ESTRUCTURA.reglas[1]] }, [{ id: "beh-4", texto: null }])
  assert.deepEqual(una.reglas, [{ id: "beh-4", numero: null, texto: null }])
  assert.equal(nombresDelPrograma(ESTRUCTURA, [{ id: "beh-4", texto: "" }, { id: "beh-9", texto: 7 }]).reglas.every((r) => r.texto === null), true)
})

test("sin estructura, sin piezas en ella o con piezas mal formadas no hay clave", () => {
  for (const sin of [null, undefined, {}, { ...ESTRUCTURA, piezas: undefined }, { ...ESTRUCTURA, piezas: "x" }, { ...ESTRUCTURA, reglas: undefined }]) assert.equal(nombresDelPrograma(sin, REGLAS_DE_LA_VISTA), null, JSON.stringify(sin))
  for (const mala of [{ id: "cmp-1" }, { id: "", nombre: "LED" }, { id: "cmp-1", nombre: "" }, null, { id: 3, nombre: "LED" }]) assert.equal(nombresDelPrograma({ ...ESTRUCTURA, piezas: [mala] }, REGLAS_DE_LA_VISTA), null, JSON.stringify(mala))
  assert.equal(nombresDelPrograma({ ...ESTRUCTURA, piezas: [], reglas: [] }, []), null, "un programa que no nombra nada")
  // Reglas de la vista que no son una lista, o entradas raras: no rompe y no inventa.
  assert.deepEqual(nombresDelPrograma(ESTRUCTURA, "x").reglas, [])
  assert.deepEqual(nombresDelPrograma(ESTRUCTURA, [null, { id: 4 }, {}]).reglas, [])
})

test("la clave es una copia: no deja cambiar la estructura desde afuera", () => {
  const nombres = nombresDelPrograma(ESTRUCTURA, REGLAS_DE_LA_VISTA)
  nombres.piezas[0].nombre = "otra cosa"
  assert.equal(ESTRUCTURA.piezas[0].nombre, "Pulsador")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 2. Cómo se pinta
// ════════════════════════════════════════════════════════════════════════════════════

function documentoFalso() {
  const crear = (tag) => ({ tag, textContent: "", hijos: [], hidden: false, appendChild(h) { this.hijos.push(h); return h }, replaceChildren(...n) { this.hijos = n } })
  return { createElement: crear }
}
const textoDe = (e) => (e.hijos.length > 0 ? e.hijos.map(textoDe).join("") : e.textContent)

test("pinta el título, un renglón por pieza y por regla, y las otras dos formas de escribir un id", () => {
  const doc = documentoFalso()
  const caja = doc.createElement("div")
  caja.hidden = true
  pintarNombresDelPrograma(doc, caja, nombresDelPrograma(ESTRUCTURA, REGLAS_DE_LA_VISTA))
  assert.equal(caja.hidden, false)
  const [titulo, lista, variantes] = caja.hijos
  assert.equal(titulo.textContent, T.titulo)
  assert.deepEqual(lista.hijos.map(textoDe), [
    "cmp-3 es «Pulsador»",
    "cmp-0 es «LED»",
    "cmp-5 es «LED 2»",
    "beh-4 es la regla 1: Mientras el Pulsador esté presionado, el LED está encendido.",
    "beh-9 es la regla 2: Mientras haga calor, el LED 2 está encendido.",
  ])
  // El id va en su propio elemento `code`: es lo que el alumno busca con los ojos en el programa.
  assert.deepEqual(lista.hijos.map((li) => [li.hijos[0].tag, li.hijos[0].textContent]), [["code", "cmp-3"], ["code", "cmp-0"], ["code", "cmp-5"], ["code", "beh-4"], ["code", "beh-9"]])
  assert.equal(variantes.textContent, "En el programa, el nombre de una pieza aparece también como cmp_3 y CMP_3.")
})

test("una sola regla va sin número; sin piezas no se habla de mayúsculas (una regla nunca va en mayúsculas)", () => {
  const doc = documentoFalso()
  const caja = doc.createElement("div")
  pintarNombresDelPrograma(doc, caja, { piezas: [], reglas: [{ id: "beh-4", numero: null, texto: null }] })
  assert.equal(caja.hijos.length, 2, "título y lista, sin el renglón de las otras formas")
  assert.deepEqual(caja.hijos[1].hijos.map(textoDe), ["beh-4 es la regla"])
})

test("un nombre de pieza con signos raros se escribe tal cual, como texto", () => {
  const doc = documentoFalso()
  const caja = doc.createElement("div")
  pintarNombresDelPrograma(doc, caja, { piezas: [{ id: "cmp-1", nombre: "<b>LED</b> $& $1" }], reglas: [] })
  assert.equal(textoDe(caja.hijos[1].hijos[0]), "cmp-1 es «<b>LED</b> $& $1»")
  assert.equal("innerHTML" in caja.hijos[1].hijos[0], false, "nunca se arma marcado con un dato")
})

test("sin nombres la caja queda oculta y VACÍA: no queda a la vista la clave de antes", () => {
  const doc = documentoFalso()
  const caja = doc.createElement("div")
  pintarNombresDelPrograma(doc, caja, nombresDelPrograma(ESTRUCTURA, REGLAS_DE_LA_VISTA))
  assert.ok(caja.hijos.length > 0, "precondición: había una clave pintada")
  pintarNombresDelPrograma(doc, caja, null)
  assert.equal(caja.hidden, true)
  assert.deepEqual(caja.hijos, [])
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3. De dónde salen las piezas (el servidor)
// ════════════════════════════════════════════════════════════════════════════════════

let n = 0
function aplicar(servicio, tipo, payload) {
  const r = servicio.aplicar({ idOperacion: `clave-${n++}`, actor: "agente", baseRevision: servicio.snapshot().revision, tipo, payload })
  assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
}
const idDe = (servicio, tipo, k = 0) => servicio.snapshot().proyecto.componentes.filter((c) => c.tipo === tipo)[k].id
function ledConResistencia(servicio, k, pin) {
  aplicar(servicio, "AgregarComponente", { tipo: "led" })
  aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "led", k), terminal: "anodo", pin })
  aplicar(servicio, "AgregarComponente", { tipo: "resistencia" })
  aplicar(servicio, "Conectar", { desde: { componente: idDe(servicio, "resistencia", k), terminal: "a" }, hasta: { componente: idDe(servicio, "led", k), terminal: "anodo" } })
}
/** Un pulsador y tres LED con su resistencia; el pulsador prende los tres. */
function proyectoConTresLed() {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("clave-del-programa"), idProyecto: nuevoIdProyecto("clave-del-programa") })
  aplicar(servicio, "SetPlaca", { placa: "esp32-devkit-v1" })
  aplicar(servicio, "AgregarComponente", { tipo: "pulsador" })
  aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "pulsador"), terminal: "senal", pin: "GPIO25" })
  ;["GPIO4", "GPIO19", "GPIO18"].forEach((pin, k) => {
    ledConResistencia(servicio, k, pin)
    aplicar(servicio, "SetComportamiento", { comportamiento: { cuando: { sensor: idDe(servicio, "pulsador"), capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: idDe(servicio, "led", k), accion: "encender" } } })
  })
  return servicio
}

test("por el cableado real: las piezas de la clave son las que el programa nombra, con el nombre del esquema", async () => {
  const snapshot = proyectoConTresLed().snapshot()
  const programa = (await cargarProgramaDe(K))(snapshot)
  assert.equal(programa.ok, true)
  const piezas = programa.estructura.piezas
  const delEsquema = new Map(snapshot.vista.componentes.map((c) => [c.id, c.nombre]))
  for (const pieza of piezas) assert.equal(pieza.nombre, delEsquema.get(pieza.id), pieza.id)
  assert.deepEqual(piezas.map((p) => p.nombre), ["Pulsador", "LED", "LED 2", "LED 3"], "el pulsador una sola vez aunque lo usen tres reglas, y los tres LED distinguidos")
  // Sólo lo que el programa nombra: las tres resistencias están en el esquema y no en el programa.
  assert.equal(snapshot.proyecto.componentes.filter((c) => c.tipo === "resistencia").length, 3, "precondición")
  for (const pieza of piezas) {
    const comoConstante = pieza.id.toUpperCase().replace("-", "_")
    assert.ok(programa.codigo.includes(`PIN_${comoConstante}_`), `${pieza.id} aparece en el programa`)
  }
  for (const c of snapshot.proyecto.componentes.filter((x) => x.tipo === "resistencia")) {
    assert.equal(piezas.some((p) => p.id === c.id), false, "una resistencia no va en la clave")
    assert.equal(programa.codigo.includes(c.id.replace("-", "_")), false, "precondición: el programa no la nombra")
  }
  // Y con esa estructura real, la clave completa.
  const nombres = nombresDelPrograma(programa.estructura, snapshot.vista.reglas)
  assert.deepEqual(nombres.reglas.map((r) => r.numero), [1, 2, 3])
  for (const regla of nombres.reglas) assert.match(regla.texto, /^Mientras el Pulsador esté presionado, el LED( \d)? está encendido\.$/)
  // El programa no cambió por esto: sigue hablando en ids.
  assert.doesNotMatch(programa.codigo, /Pulsador|LED 2/)
})

test("unas piezas mal formadas invalidan la estructura; sin `piezas` (una instalación anterior) vale y no hay clave", () => {
  assert.equal(estructuraUsable(ESTRUCTURA, LINEAS), ESTRUCTURA)
  const { piezas, ...sinPiezas } = ESTRUCTURA
  assert.equal(estructuraUsable(sinPiezas, LINEAS), sinPiezas)
  assert.equal(nombresDelPrograma(sinPiezas, REGLAS_DE_LA_VISTA), null)
  for (const malas of ["x", [null], [{ id: "cmp-1", nombre: "" }], [{ id: "", nombre: "LED" }], [{ nombre: "LED" }], [{ id: "cmp-1", nombre: 4 }], null]) {
    assert.equal(estructuraUsable({ ...ESTRUCTURA, piezas: malas }, LINEAS), null, JSON.stringify(malas))
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 4. La página
// ════════════════════════════════════════════════════════════════════════════════════

test("index.html: la clave va dentro del cuadro del código, arriba del programa, y arranca oculta y vacía", () => {
  const html = readFileSync(join(WEB, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "")
  assert.match(html, /<div class="tb-codigo" id="vista-codigo">\s*<div id="vista-codigo-nombres" hidden><\/div>\s*<pre [^>]*id="vista-codigo-texto"/)
  // Ningún texto de la clave está escrito en la página: sin programa no se lee nada de esto.
  for (const texto of [T.titulo, "es la regla"]) assert.equal(html.includes(texto), false, texto)
})

test("app.js: la clave se pinta con la estructura de la revisión que se muestra, y el módulo se sirve", () => {
  const app = readFileSync(join(WEB, "app.js"), "utf8")
  assert.ok(construirRutasDeAssets().has("clave-del-programa.js"), "sin esto el navegador recibe un 404 y app.js no carga")
  assert.match(app, /from "\.\/clave-del-programa\.js"/)
  assert.match(app, /elementoNombresDelPrograma = document\.getElementById\("vista-codigo-nombres"\)/)
  // `estructura` es la variable que salió de `estructuraDeLaRevision` unas líneas antes, en la misma función.
  const funcion = /function sincronizarBloquesYCodigo\(\) \{([\s\S]*?)\n\}/.exec(app)
  assert.ok(funcion)
  assert.match(funcion[1], /const estructura = estructuraDeLaRevision\(/)
  assert.match(funcion[1], /pintarNombresDelPrograma\(document, elementoNombresDelPrograma, nombresDelPrograma\(estructura, ultimoSnapshot\.vista\.reglas \?\? \[\]\)\)/)
  assert.equal([...app.matchAll(/pintarNombresDelPrograma\(/g)].length, 1, "un solo lugar pinta la clave")
})
