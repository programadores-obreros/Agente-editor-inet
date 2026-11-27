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
//   5. un nombre de pieza se escribe como texto, nunca como marcado;
//   6. lo que se dice del CÓDIGO (`setup`, `loop`, `cmp_3`, `CMP_0`, `beh_4`) se mira en el código.
//
// HISTORIA DEL PUNTO 6. La primera versión decía «el nombre de una pieza aparece también como
// cmp_3 y CMP_3», con el ejemplo armado a mano con la primera pieza. La revisión independiente
// contó en programas generados: una salida nunca aparece como `cmp_N` (0 veces `cmp_1`, 4 veces
// `CMP_1`); el ejemplo «andaba» porque la primera pieza era siempre un sensor. Y las reglas sí
// aparecen con guion bajo y la clave no lo decía. Los tests de entonces fijaban el texto, no si
// era cierto. Ahora cada ejemplo se busca en el código, y hay un test contra el programa real.
//
// VISTO EN CHROMIUM (ventana real, seis reglas): el plegable cerrado con su título, abierto con
// sus renglones en dos columnas, y que un repintado no lo cierra.
//
// MUTACIONES que ponen rojo este archivo (una por vez, con el cambio ya commiteado):
//   - `programa-para-vista.ts`: `piezas.set(paso.componente, paso.componente)`     → «por el cableado real…»
//   - `programa-para-vista.ts`: `piezas: []`                                        → «por el cableado real…»
//   - `clave-del-programa.js`: sin ordenar las piezas por número                    → «las piezas por número…»
//   - `clave-del-programa.js`: ordenar por texto (`localeCompare`)                  → «las piezas por número…»
//   - `clave-del-programa.js`: sin `.filter((regla) => enElPrograma.has(regla.id))` → «sólo las reglas que el programa tiene…»
//   - `clave-del-programa.js`: `numero: i + 1` siempre                              → «con una sola regla…»
//   - `clave-del-programa.js`: `aparece` devolviendo siempre true                   → «las otras formas…»
//   - `clave-del-programa.js`: `aparece` con `codigo.includes(nombre)`              → «las otras formas…»
//   - `programa-para-vista.ts`: `enElCodigo` sin comparar la línea                  → «el servidor dice «setup» y «loop»…»
//   - `clave-del-programa.js`: `plegable.open = true`                               → «es un plegable…»
//   - `clave-del-programa.js`: `plegable.open = false` (no recordar)                → «es un plegable…»
//   - `clave-del-programa.js`: `pintar` sin `elemento.hidden = true` cuando no hay  → «sin nombres…»
//   - `vista-codigo.js`: aceptar `piezas` con un nombre vacío                       → «unas piezas mal formadas…»
//   - `app.js`: la clave con la estructura del panel SIN comparar la revisión       → «app.js…»
//
// Corre con: node --test tests/clave-del-programa.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const WEB = join(REPO, "opencode/vista-fisica/web")
const { nombresDelPrograma, pintarNombresDelPrograma, TEXTOS_DE_LOS_NOMBRES: T } = await import(join(WEB, "clave-del-programa.js"))
const { TITULOS_DE_LA_ESTRUCTURA } = await import(join(WEB, "adaptador-blockly.js"))
const { estructuraUsable } = await import(join(WEB, "vista-codigo.js"))
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { construirRutasDeAssets } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { cargarProgramaDe } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))

// Un programa chico con la forma del real: una entrada (cmp-3), dos salidas (cmp-0 y cmp-12) y dos reglas.
const CODIGO = [
  "// beh-9: cmp-3.estadoBooleano >= 1 ninguna -> cmp-12 encender", // 1
  "static const uint8_t PIN_CMP_0_ANODO = 4;", // 2
  "static const uint8_t PIN_CMP_3_SENAL = 25;", // 3
  "static const uint8_t PIN_CMP_12_ANODO = 19;", // 4
  "void setup() {", // 5
  "  pinMode(PIN_CMP_3_SENAL, INPUT_PULLUP);", // 6
  "}", // 7
  "void loop() {", // 8
  "  const float cmp_3_estadoBooleano = leer_cmp_3_estadoBooleano();", // 9
  "  const bool beh_9 = cmp_3_estadoBooleano >= 1.0f;", // 10
  "  digitalWrite(PIN_CMP_12_ANODO, beh_9 ? HIGH : LOW);", // 11
  "  const bool beh_4 = cmp_3_estadoBooleano >= 1.0f;", // 12
  "  digitalWrite(PIN_CMP_0_ANODO, beh_4 ? HIGH : LOW);", // 13
  "}", // 14
  "",
].join("\n")
const LINEAS = 14
const tramo = (desde, hasta = desde) => ({ desde, hasta })
const ESTRUCTURA = {
  alIniciar: { lineas: tramo(5, 7), pasos: [{ texto: "Pulsador en GPIO25: entrada, para mirar su estado", lineas: tramo(6) }], enElCodigo: "setup" },
  porSiempre: { lineas: tramo(8, 14), enElCodigo: "loop" },
  reglas: [{ id: "beh-9", lineas: tramo(10, 11) }, { id: "beh-4", lineas: tramo(12, 13) }],
  // En el orden de «al iniciar»: entradas primero, después las salidas. NO es el orden por número.
  piezas: [{ id: "cmp-3", nombre: "Pulsador" }, { id: "cmp-12", nombre: "LED 2" }, { id: "cmp-0", nombre: "LED" }],
}
const REGLAS_DE_LA_VISTA = [{ id: "beh-4", texto: "Mientras el Pulsador esté presionado, el LED está encendido." }, { id: "beh-9", texto: "…" }]
const clave = (estructura = ESTRUCTURA, reglas = REGLAS_DE_LA_VISTA, codigo = CODIGO, titulos = TITULOS_DE_LA_ESTRUCTURA) => nombresDelPrograma(estructura, reglas, codigo, titulos)

// ════════════════════════════════════════════════════════════════════════════════════
// 1. Qué dice la clave
// ════════════════════════════════════════════════════════════════════════════════════

test("las piezas por número (como se buscan viniendo del código), no en el orden de «al iniciar» ni como texto", () => {
  assert.deepEqual(clave().piezas, [{ id: "cmp-0", nombre: "LED" }, { id: "cmp-3", nombre: "Pulsador" }, { id: "cmp-12", nombre: "LED 2" }])
  // Como texto, «cmp-12» iría antes que «cmp-3».
  assert.deepEqual(clave().piezas.map((p) => p.id), ["cmp-0", "cmp-3", "cmp-12"])
  assert.equal(clave().ejemplo, "cmp-0", "el ejemplo del título es la primera de la lista")
  // No cambia la estructura que le pasaron.
  assert.deepEqual(ESTRUCTURA.piezas.map((p) => p.id), ["cmp-3", "cmp-12", "cmp-0"])
})

test("las reglas, en el orden del lienzo y con su número; sin repetir la oración", () => {
  assert.deepEqual(clave().reglas, [{ id: "beh-4", numero: 1 }, { id: "beh-9", numero: 2 }])
})

test("sólo las reglas que el programa tiene, y el número es su lugar entre TODAS las dibujadas", () => {
  // Una regla recién empezada está dibujada (es la 2) pero no está en el programa.
  const dibujadas = [REGLAS_DE_LA_VISTA[0], { id: "beh-20" }, REGLAS_DE_LA_VISTA[1]]
  assert.deepEqual(clave(ESTRUCTURA, dibujadas).reglas, [{ id: "beh-4", numero: 1 }, { id: "beh-9", numero: 3 }], "beh-9 es la regla 3 en los bloques: acá también")
})

test("con una sola regla dibujada no se numera", () => {
  assert.deepEqual(clave({ ...ESTRUCTURA, reglas: [ESTRUCTURA.reglas[1]] }, [{ id: "beh-4" }]).reglas, [{ id: "beh-4", numero: null }])
})

test("setup y loop se nombran sólo si el servidor los mandó comprobados; el navegador no los escribe", () => {
  assert.deepEqual(clave().partes, [{ nombre: "setup", bloque: "al iniciar" }, { nombre: "loop", bloque: "por siempre" }])
  const { enElCodigo, ...alIniciarSinNombre } = ESTRUCTURA.alIniciar
  assert.deepEqual(clave({ ...ESTRUCTURA, alIniciar: alIniciarSinNombre }).partes, [{ nombre: "loop", bloque: "por siempre" }])
  for (const raro of ["", 7, null]) assert.deepEqual(clave({ ...ESTRUCTURA, porSiempre: { ...ESTRUCTURA.porSiempre, enElCodigo: raro } }).partes, [{ nombre: "setup", bloque: "al iniciar" }])
  // Sin los títulos de los bloques no hay con qué decir de qué bloque es.
  assert.deepEqual(nombresDelPrograma(ESTRUCTURA, REGLAS_DE_LA_VISTA, CODIGO).partes, [])
  // Los títulos son los MISMOS que dibuja el lienzo.
  assert.deepEqual({ ...TITULOS_DE_LA_ESTRUCTURA }, { alIniciar: "al iniciar", porSiempre: "por siempre" })
  // El módulo del navegador no trae los nombres escritos: los recibe.
  const fuente = readFileSync(join(WEB, "clave-del-programa.js"), "utf8").replace(/\/\/.*$/gm, "")
  assert.doesNotMatch(fuente, /"setup"|"loop"|void /)
})

// El servidor es el que comprueba, contra el programa, cómo se llama cada parte.
test("el servidor dice «setup» y «loop» sólo si la línea donde el mapa dice que empiezan es ésa", async () => {
  const { estructuraParaVista } = await import(join(REPO, "opencode/vista-fisica/programa-para-vista.ts"))
  const mapa = { alIniciar: { lineas: tramo(5, 7), pasos: [] }, porSiempre: { lineas: tramo(8, 14) }, reglas: [] }
  const nombre = () => "x"
  const e = estructuraParaVista(mapa, nombre, CODIGO)
  assert.deepEqual([e.alIniciar.enElCodigo, e.porSiempre.enElCodigo], ["setup", "loop"])
  // El mapa apunta una línea más abajo, o el generador escribió otra cosa: no se afirma.
  const corrido = estructuraParaVista({ ...mapa, alIniciar: { lineas: tramo(6, 7), pasos: [] } }, nombre, CODIGO)
  assert.equal("enElCodigo" in corrido.alIniciar, false)
  assert.equal(corrido.porSiempre.enElCodigo, "loop")
  const otro = estructuraParaVista(mapa, nombre, CODIGO.replace("void loop() {", "void bucle() {"))
  assert.equal("enElCodigo" in otro.porSiempre, false)
  const sinCodigo = estructuraParaVista(mapa, nombre)
  assert.equal("enElCodigo" in sinCodigo.alIniciar || "enElCodigo" in sinCodigo.porSiempre, false)
})

test("las otras formas de un nombre salen del código: sólo las que están escritas, y cada una de la pieza que la tiene", () => {
  // cmp-0 es una salida: en minúscula con guion bajo NO aparece (sólo `PIN_CMP_0_ANODO`). La
  // forma en minúscula es la de cmp-3, que es la entrada. La primera versión habría dicho `cmp_0`.
  assert.deepEqual(clave().formas, ["cmp_3", "CMP_0", "beh_4"])
  assert.equal(CODIGO.includes("cmp_0"), false, "precondición: `cmp_0` no está en el programa")
  // Sin ninguna de las tres en el código, no se dice nada.
  assert.deepEqual(clave(ESTRUCTURA, REGLAS_DE_LA_VISTA, "#include <Arduino.h>\n").formas, [])
  // `cmp_1` no está en `cmp_12` ni en `xcmp_1`: se mira por tramos, no si el texto «contiene».
  const soloDoce = { ...ESTRUCTURA, piezas: [{ id: "cmp-1", nombre: "Otra" }], reglas: [] }
  assert.deepEqual(nombresDelPrograma(soloDoce, [], "int cmp_12_x; int PIN_CMP_12_ANODO; int xcmp_1;", TITULOS_DE_LA_ESTRUCTURA).formas, [])
  assert.deepEqual(nombresDelPrograma(soloDoce, [], "int cmp_1_x; int PIN_CMP_1;", TITULOS_DE_LA_ESTRUCTURA).formas, ["cmp_1", "CMP_1"])
})

test("sin estructura, sin piezas en ella o con piezas mal formadas no hay clave", () => {
  // Directo, sin el ayudante `clave`: su valor por defecto convertiría un `undefined` en la estructura buena.
  for (const sin of [null, undefined, {}, { ...ESTRUCTURA, piezas: undefined }, { ...ESTRUCTURA, piezas: "x" }, { ...ESTRUCTURA, reglas: undefined }]) assert.equal(nombresDelPrograma(sin, REGLAS_DE_LA_VISTA, CODIGO, TITULOS_DE_LA_ESTRUCTURA), null, String(JSON.stringify(sin)))
  for (const mala of [{ id: "cmp-1" }, { id: "", nombre: "LED" }, { id: "cmp-1", nombre: "" }, null, { id: 3, nombre: "LED" }]) assert.equal(clave({ ...ESTRUCTURA, piezas: [mala] }), null, JSON.stringify(mala))
  assert.equal(clave({ ...ESTRUCTURA, piezas: [], reglas: [] }, []), null, "un programa que no nombra nada")
  assert.deepEqual(clave(ESTRUCTURA, "x").reglas, [])
  assert.deepEqual(clave(ESTRUCTURA, [null, { id: 4 }, {}]).reglas, [])
  assert.doesNotThrow(() => nombresDelPrograma(ESTRUCTURA, REGLAS_DE_LA_VISTA, 7, null))
})

// ════════════════════════════════════════════════════════════════════════════════════
// 2. Cómo se pinta
// ════════════════════════════════════════════════════════════════════════════════════

function documentoFalso() {
  const crear = (tag) => ({
    tag, textContent: "", hijos: [], hidden: false, open: false,
    appendChild(h) { this.hijos.push(h); return h },
    replaceChildren(...n) { this.hijos = n },
    get firstElementChild() { return this.hijos[0] ?? null },
  })
  return { createElement: crear }
}
const textoDe = (e) => (e.hijos.length > 0 ? e.hijos.map(textoDe).join("") : e.textContent)
function pintada(nombres = clave()) {
  const doc = documentoFalso()
  const caja = doc.createElement("div")
  caja.hidden = true
  pintarNombresDelPrograma(doc, caja, nombres)
  return { doc, caja, plegable: caja.hijos[0] }
}

test("es un plegable que arranca CERRADO, con un título que pregunta por la primera pieza", () => {
  const { caja, plegable } = pintada()
  assert.equal(caja.hidden, false)
  assert.equal(caja.hijos.length, 1)
  assert.equal(plegable.tag, "details")
  assert.equal(plegable.open, false, "cerrado: es material de consulta, el código es lo que se viene a ver")
  assert.deepEqual([plegable.hijos[0].tag, plegable.hijos[0].textContent], ["summary", "¿Qué es cmp-0? Los nombres que usa el código"])
})

test("es un plegable: si el alumno lo abrió, un repintado lo deja abierto; si no, sigue cerrado", () => {
  const { doc, caja } = pintada()
  pintarNombresDelPrograma(doc, caja, clave())
  assert.equal(caja.hijos[0].open, false)
  caja.hijos[0].open = true // lo abre el alumno
  pintarNombresDelPrograma(doc, caja, clave())
  assert.equal(caja.hijos[0].open, true)
  // Se va el programa y vuelve otro: arranca cerrado de nuevo (no hay nada abierto que recordar).
  pintarNombresDelPrograma(doc, caja, null)
  pintarNombresDelPrograma(doc, caja, clave())
  assert.equal(caja.hijos[0].open, false)
})

test("adentro: setup y loop, las piezas, las reglas, y al final las otras formas con ejemplos del código", () => {
  const { plegable } = pintada()
  const [, lista, formas] = plegable.hijos
  assert.deepEqual(lista.hijos.map(textoDe), ["setup es «al iniciar»", "loop es «por siempre»", "cmp-0 es «LED»", "cmp-3 es «Pulsador»", "cmp-12 es «LED 2»", "beh-4 es la regla 1", "beh-9 es la regla 2"])
  // El nombre va en su propio elemento `code`: es lo que el alumno busca con los ojos en el programa.
  assert.deepEqual(lista.hijos.map((li) => li.hijos[0].tag), Array(7).fill("code"))
  assert.equal(formas.textContent, "En el código vas a ver estos nombres también con guion bajo o en mayúsculas, pegados a otras palabras: por ejemplo cmp_3, CMP_0 y beh_4. Es lo mismo.")
})

test("una sola regla va sin número; sin ninguna otra forma en el código, ese renglón no está", () => {
  const { plegable } = pintada({ ejemplo: "beh-4", partes: [], piezas: [], reglas: [{ id: "beh-4", numero: null }], formas: [] })
  assert.equal(plegable.hijos.length, 2, "título y lista")
  assert.deepEqual(plegable.hijos[1].hijos.map(textoDe), ["beh-4 es la regla"])
  assert.equal(pintada({ ejemplo: null, partes: [], piezas: [], reglas: [{ id: "beh-4", numero: null }], formas: [] }).plegable.hijos[0].textContent, T.tituloSinEjemplo)
  // Una y dos formas se dicen bien: sin «y» de más.
  assert.match(pintada({ ...clave(), formas: ["cmp_3"] }).plegable.hijos[2].textContent, /por ejemplo cmp_3\. Es lo mismo\.$/)
  assert.match(pintada({ ...clave(), formas: ["cmp_3", "beh_4"] }).plegable.hijos[2].textContent, /por ejemplo cmp_3 y beh_4\. /)
})

test("un nombre de pieza con signos raros se escribe tal cual, como texto", () => {
  const { plegable } = pintada({ ejemplo: "cmp-1", partes: [], piezas: [{ id: "cmp-1", nombre: "<b>LED</b> $& $1" }], reglas: [], formas: [] })
  assert.equal(textoDe(plegable.hijos[1].hijos[0]), "cmp-1 es «<b>LED</b> $& $1»")
  assert.equal("innerHTML" in plegable.hijos[1].hijos[0], false, "nunca se arma marcado con un dato")
})

test("sin nombres la caja queda oculta y VACÍA: no queda a la vista la clave de antes", () => {
  const { doc, caja } = pintada()
  assert.ok(caja.hijos.length > 0, "precondición: había una clave pintada")
  pintarNombresDelPrograma(doc, caja, null)
  assert.equal(caja.hidden, true)
  assert.deepEqual(caja.hijos, [])
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3. De dónde salen las piezas (el servidor) y contra el programa de verdad
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
  ;["GPIO4", "GPIO19", "GPIO18"].forEach((pin, k) => ledConResistencia(servicio, k, pin))
  aplicar(servicio, "AgregarComponente", { tipo: "pulsador" })
  aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "pulsador"), terminal: "senal", pin: "GPIO25" })
  for (const k of [0, 1, 2]) aplicar(servicio, "SetComportamiento", { comportamiento: { cuando: { sensor: idDe(servicio, "pulsador"), capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: idDe(servicio, "led", k), accion: "encender" } } })
  return servicio
}

test("por el cableado real: las piezas de la clave son las que el programa nombra, con el nombre del esquema", async () => {
  const snapshot = proyectoConTresLed().snapshot()
  const programa = (await cargarProgramaDe(K))(snapshot)
  assert.equal(programa.ok, true)
  const piezas = programa.estructura.piezas
  const delEsquema = new Map(snapshot.vista.componentes.map((c) => [c.id, c.nombre]))
  for (const pieza of piezas) assert.equal(pieza.nombre, delEsquema.get(pieza.id), pieza.id)
  assert.deepEqual(piezas.map((p) => p.nombre).sort(), ["LED", "LED 2", "LED 3", "Pulsador"], "el pulsador una sola vez aunque lo usen tres reglas, y los tres LED distinguidos")
  // Sólo lo que el programa nombra: las tres resistencias están en el esquema y no en el programa.
  assert.equal(snapshot.proyecto.componentes.filter((c) => c.tipo === "resistencia").length, 3, "precondición")
  for (const pieza of piezas) assert.ok(programa.codigo.includes(`PIN_${pieza.id.toUpperCase().replace("-", "_")}_`), `${pieza.id} aparece en el programa`)
  for (const c of snapshot.proyecto.componentes.filter((x) => x.tipo === "resistencia")) assert.equal(piezas.some((p) => p.id === c.id), false, "una resistencia no va en la clave")
  assert.doesNotMatch(programa.codigo, /Pulsador|LED 2/, "el programa no cambió por esto: sigue hablando en ids")
})

test("contra el programa de verdad: lo que la clave dice del código está escrito en el código", async () => {
  const snapshot = proyectoConTresLed().snapshot()
  const programa = (await cargarProgramaDe(K))(snapshot)
  const nombres = nombresDelPrograma(programa.estructura, snapshot.vista.reglas, programa.codigo, TITULOS_DE_LA_ESTRUCTURA)
  assert.deepEqual(nombres.partes.map((p) => p.nombre), ["setup", "loop"], "el generador escribe `void setup() {` y `void loop() {` donde dice el mapa")
  assert.equal(nombres.formas.length, 3, "precondición: en este programa están las tres formas")
  for (const forma of nombres.formas) assert.match(programa.codigo, new RegExp(`(^|[^A-Za-z0-9])([A-Za-z0-9]+_)*${forma}(_[A-Za-z0-9]+)*([^A-Za-z0-9_]|$)`, "m"), forma)
  // La forma en minúscula es la del pulsador (la entrada): los LED no aparecen así.
  const pulsador = snapshot.proyecto.componentes.find((c) => c.tipo === "pulsador").id
  assert.equal(nombres.formas[0], pulsador.replace("-", "_"))
  assert.deepEqual(nombres.reglas.map((r) => r.numero), [1, 2, 3])
  const numeros = nombres.piezas.map((p) => Number(p.id.split("-")[1]))
  assert.deepEqual(numeros, [...numeros].sort((a, b) => a - b))
})

test("unas piezas mal formadas invalidan la estructura; sin `piezas` (una instalación anterior) vale y no hay clave", () => {
  assert.equal(estructuraUsable(ESTRUCTURA, LINEAS), ESTRUCTURA)
  const { piezas, ...sinPiezas } = ESTRUCTURA
  assert.equal(estructuraUsable(sinPiezas, LINEAS), sinPiezas)
  assert.equal(clave(sinPiezas), null)
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
  for (const texto of ["Los nombres que usa el código", "es la regla"]) assert.equal(html.includes(texto), false, texto)
})

test("app.js: la clave se pinta con la estructura de la revisión que se muestra, el código a la vista y los títulos del lienzo", () => {
  const app = readFileSync(join(WEB, "app.js"), "utf8")
  assert.ok(construirRutasDeAssets().has("clave-del-programa.js"), "sin esto el navegador recibe un 404 y app.js no carga")
  assert.match(app, /from "\.\/clave-del-programa\.js"/)
  assert.match(app, /elementoNombresDelPrograma = document\.getElementById\("vista-codigo-nombres"\)/)
  // `estructura` es la variable que salió de `estructuraDeLaRevision` unas líneas antes, en la misma función.
  const funcion = /function sincronizarBloquesYCodigo\(\) \{([\s\S]*?)\n\}/.exec(app)
  assert.ok(funcion)
  assert.match(funcion[1], /const estructura = estructuraDeLaRevision\(/)
  assert.match(funcion[1], /pintarNombresDelPrograma\(document, elementoNombresDelPrograma, nombresDelPrograma\(estructura, ultimoSnapshot\.vista\.reglas \?\? \[\], elementoDelPrograma\?\.textContent \?\? "", TITULOS_DE_LA_ESTRUCTURA\)\)/)
  // Dos llamadas: la que pinta, y la que la borra cuando llega un snapshot sin vista (con `null`).
  assert.equal([...app.matchAll(/pintarNombresDelPrograma\(/g)].length, 2)
  assert.equal([...app.matchAll(/pintarNombresDelPrograma\(document, elementoNombresDelPrograma, null\)/g)].length, 1, "la otra sólo borra")
  // El código que mira la clave es el del MISMO cuadro en el que el panel escribe el programa.
  assert.match(app, /elementoDelPrograma = elementoCodigo/)
})
