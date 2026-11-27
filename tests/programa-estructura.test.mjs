// La estructura del programa que recibe la ventana: «al iniciar», «por siempre» y las líneas de
// cada regla, ya con palabras.
//
// POR QUÉ EXISTE (2026-11-26). Los bloques mostraban sólo «mientras … hacer …»: la estructura de
// un programa de microcontrolador (lo que se hace una vez al arrancar y lo que se repite) recién
// aparecía, como texto, en «Mirá el código». La estructura viaja en `/api/programa`, junto al
// código de ESA revisión, y sale del mapa del generador (`tests/codegen-mapa.test.mjs`).
//
// Lo que se cuida acá:
//   1. los números de línea llegan a la ventana SIN TOCAR (son los del generador);
//   2. cada renglón nombra la pieza como la nombra el esquema (mismo nombre, mismo «LED 2»);
//   3. ningún id interno llega al texto;
//   4. si no se puede decir entera, no se dice: nunca media estructura.
//
// Se mira por `cargarProgramaDe`, que es lo que llama la tool `vista-fisica` en producción: con un
// armado propio del test, el punto 2 se probaría contra nombres que el test mismo inventa.
//
// MUTACIONES que ponen rojo este archivo (una por vez, con el cambio ya commiteado):
//   - `tool/vista-fisica.ts`: no pasar `nombreDePieza`                         → «por el cableado real…»
//   - `tool/vista-fisica.ts`: buscar el nombre por `c.tipo === id`             → «por el cableado real…»
//   - `programa-para-vista.ts`: `lineas: { desde: paso.lineas.desde, hasta: paso.lineas.desde }` → «los números…»
//   - `programa-para-vista.ts`: `continue` en vez de `return undefined` sin nombre → «si falta el nombre…»
//   - `programa-para-vista.ts`: `id: r.regla` cambiado por el índice           → «los números…»
//   - `pedagogia-es-AR.ts`: sacar `{pin}` de la plantilla de salida            → «cada renglón…»
//   - `pedagogia-es-AR.ts`: devolver `base` cuando falta la etiqueta del reposo → «un paso que no se puede decir…»
//
// Corre con: node --test tests/programa-estructura.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { programaParaVista, estructuraParaVista } = await import(join(REPO, "opencode/vista-fisica/programa-para-vista.ts"))
const { textoDePasoDeInicio, TEXTOS_DE_AL_INICIAR } = await import(join(REPO, "opencode/conocimiento/anexos/pedagogia-es-AR.ts"))
const { cargarProgramaDe } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))

let n = 0
function aplicar(servicio, tipo, payload) {
  const r = servicio.aplicar({ idOperacion: `est-${n++}`, actor: "agente", baseRevision: servicio.snapshot().revision, tipo, payload })
  assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
}
const idDe = (servicio, tipo, k = 0) => servicio.snapshot().proyecto.componentes.filter((c) => c.tipo === tipo)[k].id
function ledConResistencia(servicio, k, pin) {
  aplicar(servicio, "AgregarComponente", { tipo: "led" })
  aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "led", k), terminal: "anodo", pin })
  aplicar(servicio, "AgregarComponente", { tipo: "resistencia" })
  aplicar(servicio, "Conectar", { desde: { componente: idDe(servicio, "resistencia", k), terminal: "a" }, hasta: { componente: idDe(servicio, "led", k), terminal: "anodo" } })
}
/** El caso de la notebook real: pulsador → LED, y DHT22 > 35 °C → LED 2. */
function proyectoDelCaso() {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("programa-estructura"), idProyecto: nuevoIdProyecto("programa-estructura") })
  aplicar(servicio, "SetPlaca", { placa: "esp32-devkit-v1" })
  ledConResistencia(servicio, 0, "GPIO4")
  aplicar(servicio, "AgregarComponente", { tipo: "pulsador" })
  aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "pulsador"), terminal: "senal", pin: "GPIO25" })
  aplicar(servicio, "SetComportamiento", { comportamiento: { cuando: { sensor: idDe(servicio, "pulsador"), capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: idDe(servicio, "led"), accion: "encender" } } })
  ledConResistencia(servicio, 1, "GPIO19")
  aplicar(servicio, "AgregarComponente", { tipo: "dht22" })
  aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "dht22"), terminal: "senal", pin: "GPIO13" })
  aplicar(servicio, "SetComportamiento", { comportamiento: { cuando: { sensor: idDe(servicio, "dht22"), capacidad: "temperatura", comparador: ">", umbral: { valor: 35, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: idDe(servicio, "led", 1), accion: "encender" } } })
  return servicio
}

const programaDeLaVentana = await cargarProgramaDe(K)
assert.equal(typeof programaDeLaVentana, "function", "precondición: esta instalación trae el generador")

function elCaso() {
  const snapshot = proyectoDelCaso().snapshot()
  const generado = generarPrograma(snapshot.proyecto, K)
  assert.equal(generado.ok, true)
  const programa = programaDeLaVentana(snapshot)
  assert.equal(programa.ok, true)
  /** El nombre con que el esquema muestra una pieza. */
  const nombreEnElEsquema = (id) => snapshot.vista.componentes.find((c) => c.id === id).nombre
  return { snapshot, mapa: generado.mapa, programa, estructura: programa.estructura, nombreEnElEsquema }
}

test("por el cableado real, cada renglón de «al iniciar» nombra la pieza como la nombra el esquema", () => {
  const { mapa, estructura, nombreEnElEsquema } = elCaso()
  assert.ok(estructura, "la ventana recibe la estructura")
  assert.equal(estructura.alIniciar.pasos.length, mapa.alIniciar.pasos.length)
  assert.ok(mapa.alIniciar.pasos.length >= 4, "precondición: un pulsador, un DHT y dos LED")
  mapa.alIniciar.pasos.forEach((paso, i) => {
    const texto = estructura.alIniciar.pasos[i].texto
    assert.ok(texto.startsWith(`${nombreEnElEsquema(paso.componente)} (${paso.pin}): `), texto)
  })
  // El segundo LED es «LED 2» en el esquema: el renglón no puede decir «LED» a secas dos veces.
  const deSalida = estructura.alIniciar.pasos.filter((p) => p.texto.includes("salida")).map((p) => p.texto)
  assert.deepEqual(deSalida, ["LED (GPIO4): salida, arranca apagado", "LED 2 (GPIO19): salida, arranca apagado"])
})

test("cada renglón dice la clase de paso con el texto del anexo, y nada más", () => {
  const { mapa, estructura, nombreEnElEsquema } = elCaso()
  mapa.alIniciar.pasos.forEach((paso, i) => {
    const esperado = TEXTOS_DE_AL_INICIAR[paso.papel].replace("{pieza}", nombreEnElEsquema(paso.componente)).replace("{pin}", paso.pin).replace("{reposo}", "apagado")
    assert.equal(estructura.alIniciar.pasos[i].texto, esperado)
  })
  for (const plantilla of Object.values(TEXTOS_DE_AL_INICIAR)) assert.ok(plantilla.includes("{pieza}") && plantilla.includes("{pin}"), plantilla)
})

test("los números de línea llegan a la ventana sin tocar: son los del mapa del generador", () => {
  const { mapa, estructura } = elCaso()
  assert.deepEqual(estructura.alIniciar.lineas, mapa.alIniciar.lineas)
  assert.deepEqual(estructura.porSiempre.lineas, mapa.porSiempre.lineas)
  assert.deepEqual(estructura.alIniciar.pasos.map((p) => p.lineas), mapa.alIniciar.pasos.map((p) => p.lineas))
  assert.deepEqual(estructura.reglas, mapa.reglas.map((r) => ({ id: r.regla, lineas: r.lineas })))
  assert.equal(estructura.reglas.length, 2, "precondición: dos reglas")
})

test("el código que va con la estructura es el mismo de siempre, byte a byte", () => {
  const { snapshot, programa } = elCaso()
  assert.equal(programa.codigo, generarPrograma(snapshot.proyecto, K).archivos["src/main.cpp"])
  // Y la estructura habla de ESE código: la línea donde dice que empieza «por siempre» es la del loop.
  assert.equal(programa.codigo.split("\n")[programa.estructura.porSiempre.lineas.desde - 1], "void loop() {")
})

test("ningún id interno ni palabra del programa llega a los renglones", () => {
  const { estructura } = elCaso()
  for (const { texto } of estructura.alIniciar.pasos) {
    assert.doesNotMatch(texto, /cmp-|beh-|conn-|pinMode|INPUT|OUTPUT|HIGH|LOW|\{|\}/, texto)
  }
})

test("sin nombres de piezas no hay estructura (y el programa se muestra igual)", () => {
  const { snapshot } = elCaso()
  const sinNombres = programaParaVista(generarPrograma(snapshot.proyecto, K), { proyecto: snapshot.proyecto, conocimiento: K })
  assert.equal(sinNombres.ok, true)
  assert.equal("estructura" in sinNombres, false)
  assert.equal(typeof sinNombres.codigo, "string")
})

test("si falta el nombre de UNA pieza no hay estructura: nunca media estructura", () => {
  const { mapa, nombreEnElEsquema } = elCaso()
  const sinUna = mapa.alIniciar.pasos[1].componente
  for (const faltante of [undefined, "", 7]) {
    assert.equal(estructuraParaVista(mapa, (id) => (id === sinUna ? faltante : nombreEnElEsquema(id))), undefined, `nombre: ${JSON.stringify(faltante)}`)
  }
  assert.ok(estructuraParaVista(mapa, nombreEnElEsquema), "precondición: con todos los nombres sí hay")
  assert.equal(estructuraParaVista(undefined, nombreEnElEsquema), undefined, "sin mapa tampoco")
})

test("un paso que no se puede decir no se inventa: clase desconocida, o una salida sin reposo con etiqueta", () => {
  assert.equal(textoDePasoDeInicio({ papel: "entrada", pieza: "Pulsador", pin: "GPIO25" }), "Pulsador (GPIO25): entrada")
  assert.equal(textoDePasoDeInicio({ papel: "salida", pieza: "LED", pin: "GPIO4", reposo: "encender" }), "LED (GPIO4): salida, arranca encendido")
  assert.equal(textoDePasoDeInicio({ papel: "motor", pieza: "X", pin: "GPIO1" }), undefined)
  assert.equal(textoDePasoDeInicio({ papel: "constructor", pieza: "X", pin: "GPIO1" }), undefined, "una clave heredada no es una clase de paso")
  assert.equal(textoDePasoDeInicio({ papel: "salida", pieza: "LED", pin: "GPIO4" }), undefined)
  assert.equal(textoDePasoDeInicio({ papel: "salida", pieza: "LED", pin: "GPIO4", reposo: "girar" }), undefined)
  // Y con un paso así en el mapa, la estructura entera no sale.
  const { mapa, nombreEnElEsquema } = elCaso()
  const conPasoRaro = { ...mapa, alIniciar: { ...mapa.alIniciar, pasos: [...mapa.alIniciar.pasos, { papel: "salida", componente: mapa.alIniciar.pasos[0].componente, pin: "GPIO2", reposo: "girar", lineas: { desde: 1, hasta: 1 } }] } }
  assert.equal(estructuraParaVista(conPasoRaro, nombreEnElEsquema), undefined)
})

test("un nombre de pieza con signos de reemplazo se escribe tal cual", () => {
  assert.equal(textoDePasoDeInicio({ papel: "entrada", pieza: "Pulsador $& $1", pin: "GPIO25" }), "Pulsador $& $1 (GPIO25): entrada")
})

test("cuando no hay programa tampoco hay estructura", () => {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("programa-estructura"), idProyecto: nuevoIdProyecto("programa-estructura") })
  const programa = programaDeLaVentana(servicio.snapshot())
  assert.equal(programa.ok, false)
  assert.equal("estructura" in programa, false)
})
