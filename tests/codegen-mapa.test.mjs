// El mapa del programa: en qué líneas de `src/main.cpp` quedó cada parte.
//
// POR QUÉ EXISTE (2026-11-26). La ventana muestra los bloques «al iniciar» y «por siempre» y marca
// en el código las líneas de cada regla. Para eso necesita saber dónde está cada cosa, y la única
// forma de que eso no mienta es que lo diga quien escribió el programa, al escribirlo
// (`renderizarMain` anota `l.length` en cada tramo). Estas pruebas NO le creen al mapa: abren el
// texto generado y miran qué hay en cada número de línea.
//
// El caso es el de la notebook real: pulsador → LED, y DHT22 > 35 °C → LED 2. Tiene las tres
// clases de paso (`entrada`, `bus`, `salida`) y dos reglas.
//
// MUTACIONES que ponen rojo este archivo (hechas sobre `opencode/codegen/programa.ts` con el
// cambio ya commiteado, una por vez):
//   - `setupDesde = l.length + 1`                         → «al iniciar: de `void setup() {`…»
//   - `loopHasta` tomado antes del `}` de cierre           → «por siempre: de `void loop() {`…»
//   - `reglaDesde` tomado después de la línea de decisión  → «cada regla: de su comentario…»
//   - el paso de una salida con `desde: l.length` (una línea) → «los pasos cubren el interior…»
//   - `papel: "entrada"` en el paso del bus                → «cada paso dice qué hace…»
//   - `componente: s.actuador` cambiado por el sensor      → «cada paso dice qué hace…»
//   - no anotar la regla (`reglasEnElLoop.push` borrado)   → «una entrada por regla…»
//
// Corre con: node --test tests/codegen-mapa.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))

let n = 0
function aplicar(servicio, tipo, payload) {
  const r = servicio.aplicar({ idOperacion: `mapa-${n++}`, actor: "agente", baseRevision: servicio.snapshot().revision, tipo, payload })
  assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
}
const idDe = (servicio, tipo, k = 0) => servicio.snapshot().proyecto.componentes.filter((c) => c.tipo === tipo)[k].id
function ledConResistencia(servicio, k, pin) {
  aplicar(servicio, "AgregarComponente", { tipo: "led" })
  aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "led", k), terminal: "anodo", pin })
  aplicar(servicio, "AgregarComponente", { tipo: "resistencia" })
  aplicar(servicio, "Conectar", { desde: { componente: idDe(servicio, "resistencia", k), terminal: "a" }, hasta: { componente: idDe(servicio, "led", k), terminal: "anodo" } })
}
/** Pulsador → LED; con `conDht`, además DHT22 > 35 °C → LED 2. Con `sinResistencia` el proyecto no está listo. */
function proyectoDelCaso({ conDht = true, conRegla = true, sinResistencia = false } = {}) {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("codegen-mapa"), idProyecto: nuevoIdProyecto("codegen-mapa") })
  aplicar(servicio, "SetPlaca", { placa: "esp32-devkit-v1" })
  if (sinResistencia) {
    aplicar(servicio, "AgregarComponente", { tipo: "led" })
    aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "led"), terminal: "anodo", pin: "GPIO4" })
  } else ledConResistencia(servicio, 0, "GPIO4")
  aplicar(servicio, "AgregarComponente", { tipo: "pulsador" })
  aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "pulsador"), terminal: "senal", pin: "GPIO25" })
  if (conRegla) aplicar(servicio, "SetComportamiento", { comportamiento: { cuando: { sensor: idDe(servicio, "pulsador"), capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: idDe(servicio, "led"), accion: "encender" } } })
  if (conDht) {
    ledConResistencia(servicio, 1, "GPIO19")
    aplicar(servicio, "AgregarComponente", { tipo: "dht22" })
    aplicar(servicio, "AsignarPin", { componente: idDe(servicio, "dht22"), terminal: "senal", pin: "GPIO13" })
    aplicar(servicio, "SetComportamiento", { comportamiento: { cuando: { sensor: idDe(servicio, "dht22"), capacidad: "temperatura", comparador: ">", umbral: { valor: 35, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: idDe(servicio, "led", 1), accion: "encender" } } })
  }
  return servicio
}

function generar(servicio) {
  const proyecto = servicio.snapshot().proyecto
  const r = generarPrograma(proyecto, K)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  // Las líneas como las cuenta quien lee: la número 1 es `lineas[0]`.
  const lineas = r.archivos["src/main.cpp"].split("\n")
  const linea = (numero) => lineas[numero - 1]
  return { proyecto, mapa: r.mapa, lineas, linea }
}
const numerosDe = ({ desde, hasta }) => Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i)
/** El id de un componente como aparece en una constante de pin: `cmp-3` → `CMP_3`. */
const enConstante = (id) => id.toUpperCase().replace("-", "_")

test("precondición: el caso tiene las tres clases de paso y dos reglas (si no, lo de abajo no prueba nada)", () => {
  const { mapa } = generar(proyectoDelCaso())
  assert.deepEqual([...new Set(mapa.alIniciar.pasos.map((p) => p.papel))].sort(), ["bus", "entrada", "salida"])
  assert.equal(mapa.reglas.length, 2)
})

test("al iniciar: de `void setup() {` a su `}`, y adentro no hay ninguna otra llave de cierre", () => {
  const { mapa, linea } = generar(proyectoDelCaso())
  const { desde, hasta } = mapa.alIniciar.lineas
  assert.equal(linea(desde), "void setup() {")
  assert.equal(linea(hasta), "}")
  for (const numero of numerosDe({ desde: desde + 1, hasta: hasta - 1 })) assert.notEqual(linea(numero), "}", `línea ${numero}`)
})

test("por siempre: de `void loop() {` a su `}`, que es la última llave del archivo", () => {
  const { mapa, lineas, linea } = generar(proyectoDelCaso())
  const { desde, hasta } = mapa.porSiempre.lineas
  assert.equal(linea(desde), "void loop() {")
  assert.equal(linea(hasta), "}")
  assert.equal(lineas.lastIndexOf("}") + 1, hasta)
  assert.ok(desde > mapa.alIniciar.lineas.hasta, "el loop va después del setup")
})

test("los pasos cubren el interior de setup, en orden, sin huecos ni líneas repetidas", () => {
  const { mapa } = generar(proyectoDelCaso())
  const { desde, hasta } = mapa.alIniciar.lineas
  const cubiertas = mapa.alIniciar.pasos.flatMap((p) => numerosDe(p.lineas))
  assert.deepEqual(cubiertas, numerosDe({ desde: desde + 1, hasta: hasta - 1 }))
})

test("cada paso dice qué hace SU línea: la pieza, el pin, y si prepara una entrada, un bus o una salida", () => {
  const { proyecto, mapa, linea } = generar(proyectoDelCaso())
  const porId = new Map(proyecto.componentes.map((c) => [c.id, c]))
  for (const paso of mapa.alIniciar.pasos) {
    const pieza = porId.get(paso.componente)
    assert.ok(pieza, `el paso nombra una pieza del proyecto: ${paso.componente}`)
    const primera = linea(paso.lineas.desde)
    assert.match(primera, new RegExp(`^  pinMode\\(PIN_${enConstante(paso.componente)}_[A-Z0-9_]+, `), primera)
    assert.ok(Object.values(pieza.pines).includes(paso.pin), `el pin del paso (${paso.pin}) es uno de los de la pieza`)
    if (paso.papel === "salida") {
      assert.equal(pieza.tipo, "led")
      assert.equal(paso.lineas.hasta, paso.lineas.desde + 1, "una salida son dos líneas: prepararla y dejarla en reposo")
      assert.match(primera, /, OUTPUT\);$/)
      assert.match(linea(paso.lineas.hasta), new RegExp(`^  digitalWrite\\(PIN_${enConstante(paso.componente)}_[A-Z0-9_]+, (HIGH|LOW)\\);`))
      assert.equal(paso.reposo, "apagar")
    } else {
      assert.equal(paso.lineas.hasta, paso.lineas.desde, "una entrada o un bus es una sola línea")
      assert.equal(paso.reposo, undefined, "sólo una salida arranca en un reposo")
      assert.equal(pieza.tipo, paso.papel === "bus" ? "dht22" : "pulsador")
      assert.equal(/bus suelto/.test(primera), paso.papel === "bus", primera)
    }
  }
})

test("una entrada por regla del proyecto, en el orden en que el programa las escribe", () => {
  const { proyecto, mapa } = generar(proyectoDelCaso())
  assert.deepEqual([...mapa.reglas.map((r) => r.regla)].sort(), proyecto.comportamientos.map((b) => b.id).sort())
  const inicios = mapa.reglas.map((r) => r.lineas.desde)
  assert.deepEqual(inicios, [...inicios].sort((a, b) => a - b))
})

test("cada regla: de su comentario a la escritura de su salida, adentro del loop y sin pisarse con otra", () => {
  const { proyecto, mapa, linea } = generar(proyectoDelCaso())
  const { desde, hasta } = mapa.porSiempre.lineas
  const vistas = new Set()
  for (const { regla, lineas } of mapa.reglas) {
    const actuador = proyecto.comportamientos.find((b) => b.id === regla).entonces.actuador
    assert.equal(linea(lineas.desde), `  // ${regla} -> ${actuador}`)
    assert.match(linea(lineas.desde + 1), new RegExp(`^  const bool ${regla.replace("-", "_")} = `))
    assert.match(linea(lineas.hasta), new RegExp(`^  digitalWrite\\(PIN_${enConstante(actuador)}_[A-Z0-9_]+, ${regla.replace("-", "_")} \\? `))
    assert.equal(lineas.hasta, lineas.desde + 2, "comentario, decisión y escritura")
    assert.ok(lineas.desde > desde && lineas.hasta < hasta, "adentro del loop")
    for (const numero of numerosDe(lineas)) {
      assert.ok(!vistas.has(numero), `la línea ${numero} es de una sola regla`)
      vistas.add(numero)
    }
  }
})

test("con una sola regla y sin bus el mapa sigue apuntando bien (no depende del caso grande)", () => {
  const { mapa, linea } = generar(proyectoDelCaso({ conDht: false }))
  assert.deepEqual(mapa.alIniciar.pasos.map((p) => p.papel), ["entrada", "salida"])
  assert.equal(linea(mapa.alIniciar.lineas.desde), "void setup() {")
  assert.equal(linea(mapa.porSiempre.lineas.desde), "void loop() {")
  assert.equal(mapa.reglas.length, 1)
  assert.match(linea(mapa.reglas[0].lineas.desde), /^  \/\/ beh-\d+ -> cmp-\d+$/)
})

test("el mapa no se puede tocar desde afuera, y sin programa no hay mapa", () => {
  const { mapa } = generar(proyectoDelCaso())
  for (const cosa of [mapa, mapa.alIniciar, mapa.alIniciar.lineas, mapa.alIniciar.pasos, mapa.alIniciar.pasos[0], mapa.alIniciar.pasos[0].lineas, mapa.porSiempre, mapa.porSiempre.lineas, mapa.reglas, mapa.reglas[0], mapa.reglas[0].lineas]) {
    assert.ok(Object.isFrozen(cosa))
  }
  const noListo = generarPrograma(proyectoDelCaso({ conDht: false, sinResistencia: true }).snapshot().proyecto, K)
  assert.equal(noListo.ok, false, "precondición: un LED sin resistencia no está listo y no hay programa")
  assert.equal("mapa" in noListo, false)
})

// Lo aprendí escribiendo este archivo: creía que un proyecto sin reglas no generaba programa. Sí
// genera (un `setup` y un `loop` vacíos), así que el mapa tiene que valer también ahí.
test("un proyecto listo y sin reglas da un programa con setup y loop vacíos, y el mapa lo dice", () => {
  const { mapa, linea } = generar(proyectoDelCaso({ conDht: false, conRegla: false }))
  assert.deepEqual(mapa.alIniciar.pasos, [])
  assert.deepEqual(mapa.reglas, [])
  for (const { desde, hasta } of [mapa.alIniciar.lineas, mapa.porSiempre.lineas]) assert.equal(hasta, desde + 1, "la llave que abre y, en la línea siguiente, la que cierra")
  assert.equal(linea(mapa.alIniciar.lineas.desde), "void setup() {")
  assert.equal(linea(mapa.porSiempre.lineas.hasta), "}")
})
