// Los bloques muestran la estructura del programa: «al iniciar» y «por siempre».
//
// POR QUÉ EXISTE (2026-11-26, auditoría de la Vista Lógica pedida por el dueño). Los bloques eran
// pares «mientras … hacer …» sueltos. Lo que distingue a un programa de microcontrolador (algo
// que se hace UNA vez al arrancar y algo que se repite para siempre) no estaba en los bloques: se
// veía recién en «Mirá el código», como texto. Y un «mientras» suelto se puede leer como una
// espera que frena el programa, cuando en el programa generado es una condición que se vuelve a
// mirar en cada vuelta.
//
// Ahora hay un bloque «al iniciar», con un renglón por cada cosa que el programa prepara, y un
// bloque «por siempre» que tiene adentro los pares. Son de sólo lectura. Tocar un bloque avisa
// cuál es, para que la página marque sus líneas en el código.
//
// Se prueba con la API FALSA de Blockly (`phase3-blockly-fake.mjs`). Lo que el falso supone del
// Blockly real (encastrado, evento al tocar, marcado, medidas) se midió en Chromium antes de
// escribirlo; está anotado en su encabezado. Lo que acá NO se prueba es el dibujo: que los
// bloques se vean anidados es cosa del navegador.
//
// MUTACIONES que ponen rojo este archivo (sobre `web/adaptador-blockly.js`, `web/vista-logica.js`
// y `web/vista-logica-ui.js`, una por vez, con el cambio ya commiteado):
//   - encastrar los pares en «al iniciar» en vez de «por siempre»      → «los pares van adentro…»
//   - `pasos ?? [textos.sinPasos]` sin el `??` (siempre la lista)       → «sin estructura…»
//   - contar el renglón de «no se sabe» como paso                       → «tocar el renglón…»
//   - sacar `pasos` de la firma                                         → «cuando llegan los renglones…»
//   - `claveDelBloque` sin el corte de la regla sin id                  → «una regla que todavía no nació…»
//   - `bloquesDeLaClave` de una regla devolviendo sólo el «mientras»    → «marcar una regla…»
//   - `marcar` sin desmarcar los anteriores                             → «marcar una regla…»
//   - `marcados` sin vaciar al redibujar                                → «después de redibujar…»
//   - `Math.min`/`Math.max` del alto invertidos                         → «el lienzo crece…»
//   - `proyectarAlIniciar` aceptando un renglón sin texto               → «el modelo…»
//   - `reponer` sin pasar `ultimo.estructura`                           → «si un envío falla…»
//
// Corre con: node --test tests/bloques-estructura.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"
import { fabricarBlockly } from "./phase3-blockly-fake.mjs"
import { cssEmbebidoDe, reglasCss, tokensDe, contraste } from "./ventana-helpers.mjs"

const WEB = join(REPO, "opencode/vista-fisica/web")
const { crearAdaptadorBlockly, CLASE_DE_BLOQUE_MARCADO, ESCALA_MINIMA_DEL_LIENZO, ESCALA_MAXIMA_DEL_LIENZO, COLOR_DE_ESTRUCTURA, ALTO_MINIMO_DEL_LIENZO, ALTO_MAXIMO_DEL_LIENZO, LIBRE_BAJO_LOS_BLOQUES } = await import(join(WEB, "adaptador-blockly.js"))
const { proyectarModeloLogico } = await import(join(WEB, "vista-logica.js"))
const { crearVistaLogica, crearPanelVistaLogica } = await import(join(WEB, "vista-logica-ui.js"))

// ── modelos (la forma que arma `vista-logica.js`) ─────────────────────────────────────────────
const OPC = {
  entrada: [{ valor: "cmp-1", etiqueta: "Pulsador" }],
  estado: [{ valor: "presionado", etiqueta: "presionado" }],
  salida: [{ valor: "cmp-0", etiqueta: "LED" }],
  accion: [{ valor: "encendido", etiqueta: "encendido" }],
}
const campos = (valores) => [
  { slot: "s0", prefijo: "Mientras el", valor: valores[0], etiquetaActual: null, opciones: OPC.entrada },
  { slot: "s1", prefijo: "esté", valor: valores[1], etiquetaActual: null, opciones: OPC.estado },
  { slot: "s2", prefijo: ", el", valor: valores[2], etiquetaActual: null, opciones: OPC.salida },
  { slot: "s3", prefijo: "está", valor: valores[3], etiquetaActual: null, opciones: OPC.accion },
]
const COMPLETO = ["cmp-1", "presionado", "cmp-0", "encendido"]
const regla = (id, valores = COMPLETO) => ({ id, campos: campos(valores), completa: true, faltan: [], avanzada: false, aviso: null, motivos: [] })
/** `pasos`: la lista de renglones de «al iniciar», o `null` si no se saben. */
const modelo = (reglas, pasos = null) => ({ reglas, regla: reglas[0] ?? null, hayVarias: reglas.length > 1, alIniciar: pasos === null ? null : { pasos } })
const PASOS = ["Pulsador (GPIO25): entrada", "LED (GPIO4): salida, arranca apagado"]
const SIN_PASOS = "todavía sin programa: mirá el paso 3"

function montar({ contenedor = { nombre: "div" }, caja = null, alto = null, conEscala = false } = {}) {
  const { Blockly, reg } = fabricarBlockly()
  reg.cajaDeBloques = caja
  reg.altoDeBloque = alto
  reg.conEscala = conEscala
  const llamadas = { editar: [], quitar: [], seleccionar: [] }
  const adaptador = crearAdaptadorBlockly({ Blockly, contenedor, alEditar: (x) => llamadas.editar.push(x), alQuitar: (x) => llamadas.quitar.push(x), alSeleccionar: (x) => llamadas.seleccionar.push(x) })
  const uno = (tipo) => {
    const bloques = reg.deTipo(tipo)
    assert.equal(bloques.length, 1, `un solo bloque ${tipo}`)
    return bloques[0]
  }
  return { adaptador, Blockly, reg, llamadas, alIniciar: () => uno("tecnia_al_iniciar"), porSiempre: () => uno("tecnia_por_siempre") }
}
const textosDe = (bloques) => bloques.map((b) => b.etiquetas.join(" "))

// ════════════════════════════════════════════════════════════════════════════════════
// La forma
// ════════════════════════════════════════════════════════════════════════════════════

test("los pares van adentro de «por siempre», en el orden del modelo, y «al iniciar» queda aparte", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1"), regla("beh-2")], PASOS))
  assert.deepEqual(m.porSiempre().pila("REGLAS"), m.reg.mientras())
  assert.equal(m.reg.mientras().length, 2)
  assert.deepEqual(m.alIniciar().pila("PASOS").map((b) => b.type), ["tecnia_paso", "tecnia_paso"])
  // Arriba del todo hay sólo dos bloques: la estructura. Ningún par quedó suelto.
  assert.deepEqual(m.reg.ws.getTopBlocks().map((b) => b.type), ["tecnia_al_iniciar", "tecnia_por_siempre"])
  // Y cada «mientras» conserva su «hacer» encastrado.
  for (const mientras of m.reg.mientras()) assert.equal(mientras.hijo.type, "tecnia_hacer")
})

test("«al iniciar» tiene un renglón por paso, con el texto del servidor tal cual y en su orden", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  assert.deepEqual(textosDe(m.alIniciar().pila("PASOS")), PASOS)
})

test("los bloques de la estructura son de sólo lectura: sin campos, no se mueven ni se borran, y se dibujan", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  const deEstructura = m.reg.ws.bloques.filter((b) => ["tecnia_al_iniciar", "tecnia_paso", "tecnia_por_siempre"].includes(b.type))
  assert.equal(deEstructura.length, 4, "precondición: al iniciar, dos renglones y por siempre")
  for (const b of deEstructura) {
    assert.deepEqual(Object.keys(b.campos), [], `${b.type} no tiene nada para elegir`)
    assert.equal(b.deletable, false)
    assert.equal(b.movable, false)
    assert.ok(b.svg && b.renderizado, `${b.type} se dibuja`)
  }
})

test("los títulos «al iniciar» y «por siempre» están en la definición de sus bloques, con el color del controlador", () => {
  const m = montar()
  const def = (tipo) => m.reg.definiciones.find((d) => d.type === tipo)
  assert.equal(def("tecnia_al_iniciar").message0, "al iniciar")
  assert.equal(def("tecnia_por_siempre").message0, "por siempre")
  for (const tipo of ["tecnia_al_iniciar", "tecnia_paso", "tecnia_por_siempre"]) assert.equal(def(tipo).colour, COLOR_DE_ESTRUCTURA, tipo)
  // Un «mientras» se encastra debajo de otro; antes no tenía con qué.
  assert.equal(def("tecnia_mientras").previousStatement, null)
  assert.equal(def("tecnia_mientras").nextStatement, null)
  assert.ok("previousStatement" in def("tecnia_mientras") && "nextStatement" in def("tecnia_mientras"))
})

test("el color de la estructura es el de la zona del controlador en el esquema, y el texto blanco se lee encima", () => {
  const html = readFileSync(join(WEB, "index.html"), "utf8")
  const raices = reglasCss(cssEmbebidoDe(html)).filter((r) => r.selector === ":root" && r.medio === "")
  assert.equal(raices.length, 1, "precondición: la ventana declara sus tokens en un solo :root")
  const ctrl = tokensDe(raices[0].cuerpo)["--ctrl"]
  assert.ok(ctrl, "precondición: la ventana tiene el token --ctrl")
  assert.equal(COLOR_DE_ESTRUCTURA.toLowerCase(), ctrl.toLowerCase())
  assert.ok(contraste("#5eead4", "#ffffff") < 4.5, "precondición: la fórmula marca un color claro")
  assert.ok(contraste(COLOR_DE_ESTRUCTURA, "#ffffff") >= 4.5)
})

test("«por siempre» va debajo de «al iniciar»: su borde + el alto que informa Blockly + la separación", () => {
  const m = montar({ alto: 120 })
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  assert.deepEqual(m.alIniciar().movimientos, [[16, 16]])
  assert.deepEqual(m.porSiempre().movimientos, [[16, 16 + 120 + 16]])
})

test("sin alto informado, «por siempre» igual queda debajo y no encima (alto estimado)", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  assert.equal(m.alIniciar().movimientos[0][1], 16)
  assert.ok(m.porSiempre().movimientos[0][1] > 16 + 60, `quedó en y=${m.porSiempre().movimientos[0][1]}`)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Cuando no se sabe qué prepara el programa
// ════════════════════════════════════════════════════════════════════════════════════

test("sin estructura del programa, «al iniciar» lo dice en un renglón y no muestra pasos de otro momento", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  m.adaptador.pintar(modelo([regla("beh-1")], null))
  assert.deepEqual(textosDe(m.alIniciar().pila("PASOS")), [SIN_PASOS])
  // No quedó ningún renglón viejo en el lienzo.
  assert.equal(m.reg.ws.bloques.some((b) => PASOS.includes(b.etiquetas.join(" "))), false)
})

test("un programa que no prepara nada deja «al iniciar» vacío: no es lo mismo que no saber", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], []))
  assert.deepEqual(m.alIniciar().pila("PASOS"), [])
  assert.equal(m.reg.deTipo("tecnia_paso").length, 0)
})

test("cuando llegan los renglones (o cambian) se redibuja; si son los mismos, no", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], null))
  const alEmpezar = m.reg.bloquesCreados
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  assert.ok(m.reg.bloquesCreados > alEmpezar, "llegó la estructura: se redibuja")
  assert.deepEqual(textosDe(m.alIniciar().pila("PASOS")), PASOS)
  const conPasos = m.reg.bloquesCreados
  m.adaptador.pintar(modelo([regla("beh-1")], [...PASOS]))
  assert.equal(m.reg.bloquesCreados, conPasos, "mismos renglones: no se toca el lienzo")
  m.adaptador.pintar(modelo([regla("beh-1")], [PASOS[0], "LED (GPIO4): salida, arranca encendido"]))
  assert.ok(m.reg.bloquesCreados > conPasos, "cambió un renglón: se redibuja")
  // Redibujar no manda ninguna edición ni deja valores de más.
  assert.deepEqual(m.llamadas.editar, [])
  assert.deepEqual(["s0", "s1", "s2", "s3"].map((s) => m.reg.ws.bloques.map((b) => b.campos[s]).find(Boolean).getValue()), COMPLETO)
})

test("sin nada que armar (el servidor no mandó campos) no hay ningún bloque, tampoco los de la estructura", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  m.adaptador.pintar({ reglas: [], regla: null, hayVarias: false, alIniciar: { pasos: PASOS } })
  assert.equal(m.reg.ws.bloques.length, 0)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Tocar un bloque
// ════════════════════════════════════════════════════════════════════════════════════

test("tocar un bloque avisa cuál es, sin ids de Blockly: al iniciar, un paso, por siempre o una regla", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1"), regla("beh-2")], PASOS))
  const [primera, segunda] = m.reg.mientras()
  const tocar = (bloque) => {
    m.llamadas.seleccionar.length = 0
    m.reg.ws.tocar(bloque.id)
    assert.equal(m.llamadas.seleccionar.length, 1)
    return m.llamadas.seleccionar[0]
  }
  assert.deepEqual(tocar(m.alIniciar()), { bloque: "alIniciar" })
  assert.deepEqual(tocar(m.porSiempre()), { bloque: "porSiempre" })
  assert.deepEqual(tocar(m.alIniciar().pila("PASOS")[1]), { bloque: "paso", indice: 1 })
  assert.deepEqual(tocar(primera), { bloque: "regla", reglaId: "beh-1" })
  // El «hacer» de una regla es la misma regla (y es la SEGUNDA, no la primera).
  assert.deepEqual(tocar(segunda.hijo), { bloque: "regla", reglaId: "beh-2" })
  assert.deepEqual(m.llamadas.editar, [], "tocar no es editar")
})

test("tocar el fondo avisa que no hay ninguno", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  m.reg.ws.tocar(m.porSiempre().id)
  m.reg.ws.tocar(null)
  assert.deepEqual(m.llamadas.seleccionar, [{ bloque: "porSiempre" }, null])
})

// 2026-11-27, notebook real del dueño. Tocó un bloque, vio «…son las líneas 165 a 167. Verlo en el
// código», tocó el enlace y las líneas ya no estaban marcadas: el clic en el enlace es un clic fuera
// del lienzo, Blockly deselecciona el bloque, y el adaptador avisaba «ninguno» igual que si se
// hubiera tocado el fondo. Con los casilleros pasaba lo mismo (abrir la lista deselecciona): los
// tocó primero y no encontró el vínculo. El test de arriba, «tocar el fondo avisa que no hay
// ninguno», pasaba igual: la API falsa no distinguía el fondo de «afuera».
test("apretar el mouse FUERA del lienzo no avisa nada: lo marcado sigue (el enlace «Verlo en el código» es un clic afuera)", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  m.reg.ws.tocar(m.reg.mientras()[0].id)
  m.reg.ws.tocarAfuera()
  assert.deepEqual(m.llamadas.seleccionar, [{ bloque: "regla", reglaId: "beh-1" }])
})

test("abrir la lista de un casillero avisa la regla de ese bloque y no la desavisa enseguida", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1"), regla("beh-2")], PASOS))
  m.reg.ws.abrirCasillero(m.reg.mientras()[1].hijo.id)
  assert.deepEqual(m.llamadas.seleccionar, [{ bloque: "regla", reglaId: "beh-2" }])
  assert.deepEqual(m.llamadas.editar, [], "abrir la lista no es elegir")
})

test("un clic sobre un bloque no avisa dos veces, y sólo el clic en el fondo avisa «ninguno»", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  m.reg.ws.tocar(m.porSiempre().id)
  assert.equal(m.llamadas.seleccionar.length, 1)
  // Un `click` que no es del fondo (los controles de zoom, si algún día se prenden) tampoco.
  m.reg.ws.disparar({ type: "click", targetType: "zoom_controls", isUiEvent: true })
  assert.equal(m.llamadas.seleccionar.length, 1)
  m.reg.ws.tocar(null)
  assert.deepEqual(m.llamadas.seleccionar, [{ bloque: "porSiempre" }, null])
})

test("tocar el renglón de «todavía no se sabe» no es tocar un paso del programa", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], null))
  const [renglon] = m.alIniciar().pila("PASOS")
  m.reg.ws.tocar(renglon.id)
  assert.deepEqual(m.llamadas.seleccionar, [null])
})

test("una regla que todavía no nació (sin id) no tiene líneas en el programa: tocarla no avisa una regla", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla(null, [null, null, null, null])], []))
  m.reg.ws.tocar(m.reg.mientras()[0].id)
  assert.deepEqual(m.llamadas.seleccionar, [null])
})

test("después de destruir, tocar no avisa nada", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  const oyentes = [...m.reg.ws.oyentes]
  const id = m.porSiempre().id
  m.adaptador.destruir()
  for (const f of oyentes) f({ type: "selected", newElementId: id, isUiEvent: true })
  assert.deepEqual(m.llamadas.seleccionar, [])
})

// ════════════════════════════════════════════════════════════════════════════════════
// Marcar un bloque (el camino del código hacia los bloques)
// ════════════════════════════════════════════════════════════════════════════════════

const marcadosDe = (m) => m.reg.ws.bloques.filter((b) => b.resaltado)

test("marcar una regla marca sus DOS bloques y desmarca lo que estaba marcado", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1"), regla("beh-2")], PASOS))
  const [primera, segunda] = m.reg.mientras()
  assert.equal(m.adaptador.marcar({ bloque: "regla", reglaId: "beh-2" }), true)
  assert.deepEqual(marcadosDe(m), [segunda, segunda.hijo])
  assert.equal(m.adaptador.marcar({ bloque: "regla", reglaId: "beh-1" }), true)
  assert.deepEqual(marcadosDe(m), [primera, primera.hijo])
  assert.equal(m.adaptador.marcar({ bloque: "paso", indice: 0 }), true)
  assert.deepEqual(marcadosDe(m), [m.alIniciar().pila("PASOS")[0]])
  assert.equal(m.adaptador.marcar({ bloque: "alIniciar" }), true)
  assert.deepEqual(marcadosDe(m), [m.alIniciar()])
  assert.equal(m.adaptador.marcar({ bloque: "porSiempre" }), true)
  assert.deepEqual(marcadosDe(m), [m.porSiempre()])
  assert.equal(m.adaptador.marcar(null), false)
  assert.deepEqual(marcadosDe(m), [])
})

test("marcar algo que no está dibujado no marca nada y lo dice", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  m.adaptador.marcar({ bloque: "porSiempre" })
  for (const clave of [{ bloque: "regla", reglaId: "beh-9" }, { bloque: "paso", indice: 7 }, { bloque: "otra" }]) {
    assert.equal(m.adaptador.marcar(clave), false, JSON.stringify(clave))
    assert.deepEqual(marcadosDe(m), [])
  }
})

test("marcar no selecciona ni avisa: no hace eco hacia la página", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  m.adaptador.marcar({ bloque: "regla", reglaId: "beh-1" })
  assert.deepEqual(m.llamadas.seleccionar, [])
})

// 2026-11-27. Este test decía «después de redibujar no queda nada marcado» y marcaba una regla
// antes de que llegaran los renglones de «al iniciar». Describía un defecto: cada vez que cambiaban
// esos renglones (dos veces por edición) se vaciaba el lienzo ENTERO, reglas incluidas. Ahora, si
// sólo cambian los renglones, las reglas no se tocan, y lo que estaba marcado en ellas sigue.
test("cuando sólo cambian los renglones de «al iniciar», las reglas NO se rearman: mismos bloques, misma marca", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1"), regla("beh-2")], null))
  const reglasAntes = [...m.reg.deRegla()]
  const porSiempreAntes = m.porSiempre()
  m.adaptador.marcar({ bloque: "regla", reglaId: "beh-2" })
  // llega el programa: «no se sabe» → renglones
  m.adaptador.pintar(modelo([regla("beh-1"), regla("beh-2")], PASOS))
  assert.deepEqual(m.reg.deRegla(), reglasAntes, "los MISMOS bloques de regla, no otros iguales")
  assert.equal(m.porSiempre(), porSiempreAntes)
  assert.deepEqual(marcadosDe(m), [reglasAntes[2], reglasAntes[3]], "la regla 2 sigue marcada")
  assert.deepEqual(textosDe(m.alIniciar().pila("PASOS")), PASOS)
  // cambia la revisión: renglones → «no se sabe» → renglones nuevos. Tampoco.
  m.adaptador.pintar(modelo([regla("beh-1"), regla("beh-2")], null))
  m.adaptador.pintar(modelo([regla("beh-1"), regla("beh-2")], [PASOS[0]]))
  assert.deepEqual(m.reg.deRegla(), reglasAntes)
  assert.deepEqual(m.reg.ws.getTopBlocks().map((b) => b.type).sort(), ["tecnia_al_iniciar", "tecnia_por_siempre"], "y no quedó ningún «al iniciar» viejo")
  assert.equal(m.reg.deTipo("tecnia_paso").length, 1)
  assert.deepEqual(m.llamadas.editar, [])
  assert.equal(m.reg.usosDeDescartados, 0)
})

test("un renglón de «al iniciar» marcado se va con su renglón, y desmarcar después no toca un bloque descartado", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  m.adaptador.marcar({ bloque: "paso", indice: 1 })
  m.adaptador.pintar(modelo([regla("beh-1")], null))
  assert.deepEqual(marcadosDe(m), [])
  assert.equal(m.adaptador.cajaDeLoMarcado(), null)
  m.adaptador.marcar(null)
  m.adaptador.marcar({ bloque: "alIniciar" })
  assert.deepEqual(marcadosDe(m), [m.alIniciar()], "y se puede marcar el «al iniciar» nuevo")
  assert.equal(m.reg.usosDeDescartados, 0, "nunca se toca un bloque que ya no está en el lienzo")
})

test("«por siempre» acompaña el alto de «al iniciar» cuando cambian sus renglones", () => {
  const m = montar({ alto: 120 })
  m.adaptador.pintar(modelo([regla("beh-1")], null))
  assert.deepEqual(m.porSiempre().movimientos, [[16, 16 + 120 + 16]])
  m.reg.altoDeBloque = 200 // con más renglones, «al iniciar» mide más
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  assert.deepEqual(m.alIniciar().movimientos, [[16, 16]])
  assert.deepEqual(m.porSiempre().movimientos, [[16, 16 + 120 + 16], [0, 80]], "se corre lo que creció, no se reubica de cero")
})

test("si cambia la forma de una regla, ahí sí se rearma todo y no queda nada marcado", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  m.adaptador.marcar({ bloque: "regla", reglaId: "beh-1" })
  const antes = [...m.reg.deRegla()]
  m.adaptador.pintar(modelo([regla("beh-1"), regla("beh-2")], PASOS))
  assert.equal(m.reg.deRegla().some((b) => antes.includes(b)), false, "bloques nuevos")
  assert.deepEqual(marcadosDe(m), [])
  assert.equal(m.adaptador.marcar({ bloque: "regla", reglaId: "beh-1" }), true)
  assert.deepEqual(marcadosDe(m), [m.reg.mientras()[0], m.reg.mientras()[0].hijo])
  m.adaptador.marcar(null)
  assert.deepEqual(marcadosDe(m), [])
  assert.equal(m.reg.usosDeDescartados, 0)
})

// Medido en Chromium: `setHighlighted(true)` aclaraba el bloque y el texto blanco quedaba con 2:1 de
// contraste. La marca es ahora una clase en la raíz del bloque; el borde lo pone la hoja.
test("marcar pone una clase en el bloque (el borde es de la hoja) y no usa el relieve de Blockly", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  const relieves = []
  for (const b of m.reg.ws.bloques) b.setHighlighted = (v) => relieves.push(v)
  m.adaptador.marcar({ bloque: "porSiempre" })
  assert.deepEqual([...m.porSiempre().clases], [CLASE_DE_BLOQUE_MARCADO])
  assert.deepEqual(relieves, [])
  assert.deepEqual(m.adaptador.cajaDeLoMarcado(), m.porSiempre().getSvgRoot().getBoundingClientRect())
  m.adaptador.marcar(null)
  assert.deepEqual([...m.porSiempre().clases], [])
  assert.equal(m.adaptador.cajaDeLoMarcado(), null)
  const html = readFileSync(join(WEB, "index.html"), "utf8")
  assert.match(html, new RegExp(`\\.${CLASE_DE_BLOQUE_MARCADO} > \\.blocklyPath \\{[^}]*stroke:`), "la hoja le pone el borde a esa clase")
})

// 2026-11-27, con mouse real: se cambiaba un casillero de una regla y, al rearmarse el lienzo,
// quedaba marcado un renglón de «al iniciar» que nadie tocó. Blockly reubica el foco en otro bloque
// cuando se le saca el que lo tenía, y avisa `selected` igual que con un toque.
test("después de un rearmado, un `selected` sin gesto del alumno no cuenta como toque", () => {
  const oyentes = {}
  const contenedor = { style: {}, addEventListener: (tipo, f) => { oyentes[tipo] = f }, removeEventListener: (tipo) => { delete oyentes[tipo] } }
  const m = montar({ contenedor })
  m.adaptador.pintar(modelo([regla("beh-1")], null))
  assert.deepEqual(Object.keys(oyentes).sort(), ["keydown", "pointerdown"])
  // Recién pintado: Blockly le da el foco a un bloque por su cuenta.
  m.reg.ws.disparar({ type: "selected", newElementId: m.porSiempre().id, isUiEvent: true })
  assert.deepEqual(m.llamadas.seleccionar, [], "nadie tocó nada todavía")
  oyentes.pointerdown()
  m.reg.ws.tocar(m.porSiempre().id)
  assert.deepEqual(m.llamadas.seleccionar, [{ bloque: "porSiempre" }])
  // Llegan los renglones (se rehace «al iniciar») y Blockly reubica el foco: no es un toque.
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  m.reg.ws.disparar({ type: "selected", newElementId: m.alIniciar().pila("PASOS")[0].id, isUiEvent: true })
  assert.equal(m.llamadas.seleccionar.length, 1)
  // Con el teclado también vale como gesto.
  oyentes.keydown()
  m.reg.ws.disparar({ type: "selected", newElementId: m.alIniciar().id, isUiEvent: true })
  assert.deepEqual(m.llamadas.seleccionar.at(-1), { bloque: "alIniciar" })
  // Un repintado que no rearma nada no vuelve a pedir un gesto.
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  m.reg.ws.tocar(m.porSiempre().id)
  assert.deepEqual(m.llamadas.seleccionar.at(-1), { bloque: "porSiempre" })
  m.adaptador.destruir()
  assert.deepEqual(Object.keys(oyentes), [], "al destruir se sueltan los oyentes del contenedor")
})

// ════════════════════════════════════════════════════════════════════════════════════
// El alto del lienzo
// ════════════════════════════════════════════════════════════════════════════════════

test("el lienzo crece con sus bloques, entre un mínimo y un máximo", () => {
  const alto = (bottom) => {
    const contenedor = { style: {} }
    const m = montar({ contenedor, caja: { top: 16, bottom, left: 16, right: 300 } })
    m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
    return contenedor.style.height
  }
  assert.equal(alto(400), "432px", "lo que ocupan los bloques más lo que se deja libre debajo")
  assert.equal(alto(399.2), "432px", "hacia arriba: nunca un píxel de menos")
  assert.equal(alto(90), `${ALTO_MINIMO_DEL_LIENZO}px`)
  assert.equal(alto(5000), `${ALTO_MAXIMO_DEL_LIENZO}px`)
  assert.ok(ALTO_MINIMO_DEL_LIENZO < 432 && 432 < ALTO_MAXIMO_DEL_LIENZO, "precondición: 432 cae entre los dos")
  assert.ok(LIBRE_BAJO_LOS_BLOQUES >= 24, "debajo entra la barra horizontal de Blockly")
  // Medido en Chromium (2026-11-27): seis reglas con sus ocho renglones de «al iniciar» piden 716 px.
  // Con el tope en 640 la última regla quedaba cortada, que es lo que se vio en la notebook real
  // con cuatro (hallazgo W37, cuando el lienzo medía 260 fijos).
  assert.ok(ALTO_MAXIMO_DEL_LIENZO >= 716 * 2, "el tope deja entrar, con margen, el caso de seis reglas")
})

// Visto en Chromium (2026-11-26): Blockly termina de dibujar un instante después, y la medida
// tomada en el momento era más chica que la final. El lienzo quedaba corto.
test("el alto se vuelve a medir cuando Blockly avisa que terminó de dibujar", async () => {
  const contenedor = { style: {} }
  const m = montar({ contenedor, caja: { top: 16, bottom: 200, left: 16, right: 300 } })
  let avisar
  m.Blockly.renderManagement = { finishQueuedRenders: () => new Promise((r) => { avisar = r }) }
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  assert.equal(contenedor.style.height, `${ALTO_MINIMO_DEL_LIENZO}px`, "la primera medida, la del momento")
  const medidasAntes = m.reg.svgResizes.length
  m.reg.cajaDeBloques.bottom = 400
  avisar()
  await new Promise((r) => setImmediate(r))
  assert.equal(contenedor.style.height, "432px", "la medida final")
  assert.ok(m.reg.svgResizes.length > medidasAntes, "y Blockly se entera del tamaño nuevo")
})

test("si se destruye antes de que Blockly termine de dibujar, el aviso tardío no toca nada", async () => {
  const contenedor = { style: {} }
  const m = montar({ contenedor, caja: { top: 16, bottom: 200, left: 16, right: 300 } })
  let avisar
  m.Blockly.renderManagement = { finishQueuedRenders: () => new Promise((r) => { avisar = r }) }
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  m.adaptador.destruir()
  m.reg.cajaDeBloques.bottom = 400
  const medidas = m.reg.svgResizes.length
  avisar()
  await new Promise((r) => setImmediate(r))
  assert.equal(contenedor.style.height, `${ALTO_MINIMO_DEL_LIENZO}px`)
  assert.equal(m.reg.svgResizes.length, medidas)
})

test("si Blockly no informa medidas, o el contenedor no tiene estilo, el alto no se toca y nada rompe", () => {
  const sinMedidas = { style: {} }
  montar({ contenedor: sinMedidas }).adaptador.pintar(modelo([regla("beh-1")], PASOS))
  assert.equal(sinMedidas.style.height, undefined)
  for (const caja of [{ top: 0, bottom: Number.NaN, left: 0, right: 0 }, {}]) {
    const contenedor = { style: {} }
    montar({ contenedor, caja }).adaptador.pintar(modelo([regla("beh-1")], PASOS))
    assert.equal(contenedor.style.height, undefined)
  }
  assert.doesNotThrow(() => montar({ contenedor: {}, caja: { top: 0, bottom: 400, left: 0, right: 0 } }).adaptador.pintar(modelo([regla("beh-1")], PASOS)))
})

// ════════════════════════════════════════════════════════════════════════════════════
// La escala del lienzo y las barras (2026-11-27)
//
// En la notebook del dueño los bloques ocupaban un tercio del recuadro y él agrandó la página con
// el zoom; con eso la regla más larga se cortó por la derecha y quedaron las dos barras a la vista
// aunque (sin el zoom) entraba todo. Una sola regla decide la escala: que el bloque más ancho entre
// en el lienzo, entre un mínimo y un máximo. Y cada barra se muestra sólo si hace falta.
// Los números de abajo son cuentas; que en el navegador quede así se vio en Chromium (seis reglas,
// 1366 px: escala 1,4, 66 % del ancho, sin barras; 600 px: escala 0,85, 97 %, sin barras).
// ════════════════════════════════════════════════════════════════════════════════════

/** Pinta en un lienzo de `ancho` px con bloques que miden `derecha` × `abajo` (sin escala). */
function conLienzo({ ancho, derecha, abajo = 300 }) {
  const contenedor = { style: {}, clientWidth: ancho }
  const m = montar({ contenedor, caja: { top: 16, bottom: abajo, left: 16, right: derecha }, conEscala: true })
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  return { escala: m.reg.ws.scale, alto: contenedor.style.height, barras: { ...m.reg.barras }, m, contenedor }
}

test("la escala hace entrar el bloque más ancho en el lienzo, entre el mínimo y el máximo", () => {
  // bloques de 584 + 16 de margen = 600
  assert.equal(conLienzo({ ancho: 600, derecha: 584 }).escala, 1, "entra justo: escala 1")
  assert.equal(conLienzo({ ancho: 720, derecha: 584 }).escala, 1.2, "sobra lugar: se agranda")
  assert.equal(conLienzo({ ancho: 2000, derecha: 584 }).escala, ESCALA_MAXIMA_DEL_LIENZO, "con mucho lugar, hasta el máximo")
  assert.equal(conLienzo({ ancho: 510, derecha: 584 }).escala, 0.85, "falta lugar: se achica")
  assert.equal(conLienzo({ ancho: 300, derecha: 584 }).escala, ESCALA_MINIMA_DEL_LIENZO, "muy angosto, hasta el mínimo")
  assert.ok(ESCALA_MINIMA_DEL_LIENZO < 1 && 1 < ESCALA_MAXIMA_DEL_LIENZO)
  // Hacia abajo: una escala redondeada hacia arriba dejaría el bloque un pelo afuera.
  assert.equal(conLienzo({ ancho: 599, derecha: 584 }).escala, 0.99)
})

test("el alto del lienzo es el de los bloques YA ESCALADOS, no el que tienen a escala 1", () => {
  assert.equal(conLienzo({ ancho: 2000, derecha: 584, abajo: 500 }).alto, `${Math.ceil(500 * ESCALA_MAXIMA_DEL_LIENZO + LIBRE_BAJO_LOS_BLOQUES)}px`)
  assert.equal(conLienzo({ ancho: 600, derecha: 584, abajo: 500 }).alto, `${500 + LIBRE_BAJO_LOS_BLOQUES}px`)
})

test("cada barra se muestra sólo si hace falta: ninguna cuando entra todo", () => {
  assert.deepEqual(conLienzo({ ancho: 1250, derecha: 584 }).barras, { h: false, v: false })
  // Ni a la escala mínima entra el bloque más ancho: la horizontal.
  assert.deepEqual(conLienzo({ ancho: 300, derecha: 584 }).barras, { h: true, v: false })
  // Pasado el alto máximo: la vertical (y la horizontal no, si de ancho entra).
  assert.deepEqual(conLienzo({ ancho: 600, derecha: 560, abajo: ALTO_MAXIMO_DEL_LIENZO + 100 }).barras, { h: false, v: true })
})

test("cuando una barra deja de hacer falta, el lienzo vuelve a su borde (sin barra no hay cómo volver)", () => {
  const { m, contenedor } = conLienzo({ ancho: 300, derecha: 584 })
  m.reg.ws.scroll(-120, 0) // el alumno corrió el lienzo de costado
  contenedor.clientWidth = 1250
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  assert.deepEqual(m.reg.barras, { h: false, v: false })
  assert.deepEqual([m.reg.ws.scrollX, m.reg.ws.scrollY], [0, 0])
})

test("sin ancho medible, o sin escala en la API, no se decide escala ni barras y el alto se calcula a escala 1", () => {
  const sinAncho = { style: {} }
  const m = montar({ contenedor: sinAncho, caja: { top: 16, bottom: 400, left: 16, right: 584 }, conEscala: true })
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  assert.equal(m.reg.ws.scale, 1)
  assert.deepEqual(m.reg.barras, { h: null, v: null })
  assert.equal(sinAncho.style.height, "432px")
})

// ════════════════════════════════════════════════════════════════════════════════════
// El modelo y el panel
// ════════════════════════════════════════════════════════════════════════════════════

const VISTA = { reglas: [], opcionesRegla: { slots: [{ slot: "s0", prefijo: "Mientras el", opciones: OPC.entrada }] } }
const ESTRUCTURA = {
  alIniciar: { lineas: { desde: 10, hasta: 14 }, pasos: PASOS.map((texto, i) => ({ texto, lineas: { desde: 11 + i, hasta: 11 + i } })) },
  porSiempre: { lineas: { desde: 16, hasta: 22 } },
  reglas: [],
}

test("el modelo lleva los renglones de «al iniciar» sólo si la estructura los trae enteros", () => {
  assert.deepEqual(proyectarModeloLogico(VISTA, null, ESTRUCTURA).alIniciar, { pasos: PASOS })
  assert.equal(proyectarModeloLogico(VISTA).alIniciar, null, "sin estructura")
  assert.equal(proyectarModeloLogico(VISTA, null, null).alIniciar, null)
  assert.deepEqual(proyectarModeloLogico(VISTA, null, { ...ESTRUCTURA, alIniciar: { ...ESTRUCTURA.alIniciar, pasos: [] } }).alIniciar, { pasos: [] }, "un programa que no prepara nada")
  for (const rota of [{}, { alIniciar: {} }, { alIniciar: { pasos: "x" } }, { alIniciar: { pasos: [{ texto: PASOS[0] }, { texto: "" }] } }, { alIniciar: { pasos: [{ texto: 7 }] } }, { alIniciar: { pasos: [null] } }]) {
    assert.equal(proyectarModeloLogico(VISTA, null, rota).alIniciar, null, JSON.stringify(rota))
  }
  // No cambia lo de siempre: las reglas se proyectan igual con o sin estructura.
  assert.deepEqual(proyectarModeloLogico(VISTA, null, ESTRUCTURA).reglas, proyectarModeloLogico(VISTA).reglas)
})

const SNAPSHOT = { revision: 3, vista: VISTA }
function montarVista(controlador) {
  const { Blockly, reg } = fabricarBlockly()
  const seleccionadas = []
  const vista = crearVistaLogica({ Blockly, contenedor: { nombre: "div" }, controlador, alSeleccionar: (c) => seleccionadas.push(c) })
  const renglones = () => textosDe(reg.deTipo("tecnia_al_iniciar")[0].pila("PASOS"))
  return { vista, reg, seleccionadas, renglones }
}

test("la vista pinta la estructura que le pasan con el snapshot, y sin ella dice que no se sabe", () => {
  const m = montarVista({ cambiar: () => true, quitar: () => true })
  m.vista.repintar(SNAPSHOT, { estructura: ESTRUCTURA })
  assert.deepEqual(m.renglones(), PASOS)
  m.vista.repintar({ ...SNAPSHOT, revision: 4 })
  assert.deepEqual(m.renglones(), [SIN_PASOS], "otro snapshot sin su estructura: no se reutiliza la anterior")
})

test("si un envío falla o se ignora, se repone lo último pintado CON su estructura", async () => {
  for (const respuesta of [() => Promise.reject(new Error("sin red")), () => false]) {
    const m = montarVista({ cambiar: respuesta, quitar: () => true })
    m.vista.repintar(SNAPSHOT, { estructura: ESTRUCTURA })
    m.reg.ws.bloques.map((b) => b.campos.s0).find(Boolean).setValue("cmp-1")
    await new Promise((r) => setImmediate(r))
    assert.deepEqual(m.renglones(), PASOS)
  }
})

test("la vista y el panel pasan hacia arriba qué bloque se tocó y hacia abajo cuál marcar", () => {
  const m = montarVista({ cambiar: () => true, quitar: () => true })
  m.vista.repintar(SNAPSHOT, { estructura: ESTRUCTURA })
  const [porSiempre] = m.reg.deTipo("tecnia_por_siempre")
  m.reg.ws.tocar(porSiempre.id)
  assert.deepEqual(m.seleccionadas, [{ bloque: "porSiempre" }])
  assert.equal(m.vista.marcar({ bloque: "alIniciar" }), true)
  assert.equal(m.reg.deTipo("tecnia_al_iniciar")[0].resaltado, true)

  const { Blockly, reg } = fabricarBlockly()
  const elemento = () => ({ textContent: "", disabled: false, addEventListener() {} })
  const tocadas = []
  const panel = crearPanelVistaLogica({ Blockly, lienzo: { nombre: "div" }, elementoTexto: elemento(), elementoEstado: elemento(), botonQuitar: elemento(), controlador: { cambiar: () => true, quitar: () => true }, alSeleccionar: (c) => tocadas.push(c) })
  assert.equal(panel.marcar({ bloque: "porSiempre" }), false, "antes del primer pintado no hay lienzo: no hay qué marcar")
  panel.repintar(SNAPSHOT, { estructura: ESTRUCTURA })
  assert.deepEqual(textosDe(reg.deTipo("tecnia_al_iniciar")[0].pila("PASOS")), PASOS)
  reg.ws.tocar(reg.deTipo("tecnia_al_iniciar")[0].id)
  assert.deepEqual(tocadas, [{ bloque: "alIniciar" }])
  assert.equal(panel.marcar({ bloque: "porSiempre" }), true)
  assert.equal(reg.deTipo("tecnia_por_siempre")[0].resaltado, true)
})

// 2026-11-27: «Mientras» iba con mayúscula dentro de «por siempre», al lado de «al iniciar», «por
// siempre» y «hacer:» en minúscula. El servidor manda ahora las dos formas: la de la oración
// («Con palabras») y la del bloque. El adaptador no cambia la ortografía de nada: usa la que le dan.
test("el servidor manda el texto de bloque en minúscula y la oración de «Con palabras» no cambia", async () => {
  const { join } = await import("node:path")
  const { REPO, nuevoDir, nuevoIdProyecto, prepararProyectoConLed, op, catalogo, GPIO_Y } = await import("./phase2-helpers.mjs")
  const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
  const { servicio, idComponente: led } = prepararProyectoConLed(nuevoDir("bloque-minuscula"), nuevoIdProyecto("bloque-minuscula"))
  const aplicar = (tipo, payload) => assert.equal(servicio.aplicar(op(tipo, payload, servicio.snapshot().revision)).ok, true, tipo)
  aplicar("AgregarComponente", { tipo: "pulsador" })
  const pulsador = servicio.snapshot().proyecto.componentes.find((c) => c.tipo === "pulsador").id
  aplicar("AsignarPin", { componente: pulsador, terminal: "senal", pin: GPIO_Y })
  aplicar("SetComportamiento", { comportamiento: { cuando: { sensor: pulsador, capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: led, accion: "encender" } } })
  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const [sensor, ...resto] = vista.opcionesRegla.slots
  assert.equal(sensor.prefijo, "Mientras el", "la oración empieza con mayúscula")
  assert.equal(sensor.prefijoEnBloque, "mientras el")
  assert.equal(sensor.prefijoEnBloque, sensor.prefijo.toLowerCase(), "es el mismo texto: sólo cambia la mayúscula")
  for (const slot of resto) assert.equal(slot.prefijoEnBloque, undefined, `${slot.slot}: sólo cambia el que empieza la regla`)
  assert.match(vista.reglas[0].texto, /^Mientras el /, "la oración entera no cambia")
  // Y llega al lienzo: el modelo lo pasa y el bloque lo muestra.
  const modeloReal = proyectarModeloLogico(vista)
  assert.equal(modeloReal.reglas[0].campos[0].prefijoEnBloque, "mientras el")
  const m = montar()
  m.adaptador.pintar(modeloReal)
  assert.deepEqual(m.reg.mientras()[0].etiquetas, ["mientras el", "esté"])
})

test("sin texto de bloque (un servidor anterior) el bloque muestra el de la oración, y cambiarlo redibuja", () => {
  const m = montar()
  m.adaptador.pintar(modelo([regla("beh-1")], PASOS))
  assert.equal(m.reg.mientras()[0].etiquetas[0], "Mientras el")
  const creados = m.reg.bloquesCreados
  const conMinuscula = regla("beh-1")
  conMinuscula.campos[0] = { ...conMinuscula.campos[0], prefijoEnBloque: "mientras el" }
  m.adaptador.pintar(modelo([conMinuscula], PASOS))
  assert.ok(m.reg.bloquesCreados > creados, "el texto del bloque cambió: se redibuja")
  assert.equal(m.reg.mientras()[0].etiquetas[0], "mientras el")
})
