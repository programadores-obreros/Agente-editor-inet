// Una condición sobre un pulsador que se cumple SIEMPRE o NUNCA: el núcleo avisa.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El estado de un pulsador o de un interruptor vale 0 o 1.
// La IR lo compara con la misma tríada que una temperatura (capacidad + comparador +
// umbral), así que se puede escribir «estado < 5» (cierto con 0 y con 1: siempre) o
// «estado >= 2» (nunca). La auditoría de código del 2026-11-22 (NUC-01, reproducido por
// QA) mostró que esas reglas quedaban «listo» sin ningún motivo y generaban un programa
// que compila y hace otra cosa que lo que el alumno pidió: el LED siempre prendido, o
// nunca. La vista las muestra como «condición avanzada», pero la validación callaba.
//
// Decisión del owner (2026-11-23): AVISAR SIN BLOQUEAR. El proyecto sigue «listo»; el
// aviso dice que la condición se cumple siempre, o nunca.
//
// QUÉ NO ES UN ERROR, y por eso no avisa: una forma rara pero que DECIDE. «> 0», «<= 0»,
// «> 0.5» o «<= 0.5» separan el 0 del 1: son equivalentes a presionado o suelto.
//
// QUÉ NO PRUEBA: el C++ que sale de una regla así, ni una placa. Tampoco condiciones
// sin sentido sobre magnitudes que no son booleanas (eso es UMBRAL_FUERA_DE_RANGO).
//
// MUTACIONES que ponen rojo este archivo (ver el commit):
//   - sacar el chequeo de validarTecnico                         → rojos «avisa» y «el texto»
//   - `severidad: "blocking"`                                    → rojo «avisa y NO bloquea»
//   - avisar ante cualquier forma no canónica                    → rojo «las formas raras que deciden»
//   - mirar sólo el caso «siempre» (olvidar «nunca»)             → rojos la tabla y «avisa»
//   - evaluar con un solo valor (0 o 1) en vez de los dos        → rojo la tabla
//   - aplicar el chequeo a magnitudes no booleanas               → rojo «una temperatura»
//   - `>=` evaluado como `>`                                     → rojo la tabla
//
// Corre con: node --test tests/condicion-booleana-que-no-decide.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const { crearMotorDeProyecto } = await import(join(REPO, "opencode/nucleo/motor.ts"))
const { crearAlmacen } = await import(join(REPO, "opencode/nucleo/almacen.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { construirCatalogoMinimoReal } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { desenlaceDeCondicionBooleana } = await import(join(REPO, "opencode/nucleo/estado-booleano.ts"))
const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))

const catalogo = construirCatalogoMinimoReal()
const CODIGO = "CONDICION_SIN_EFECTO"
let n = 0

test("la tabla: con 0 y con 1, qué pasa con cada comparación", () => {
  const casos = [
    // las dos canónicas y sus equivalentes: DECIDEN
    [">=", 1, "decide"], ["<", 1, "decide"], [">", 0, "decide"], ["<=", 0, "decide"], [">", 0.5, "decide"], ["<=", 0.5, "decide"], [">=", 0.001, "decide"], ["<", 0.999, "decide"],
    // siempre ciertas
    ["<", 5, "siempre"], [">", -3, "siempre"], [">=", 0, "siempre"], ["<=", 1, "siempre"], ["<", 1.0001, "siempre"], [">=", -0, "siempre"],
    // nunca ciertas
    [">=", 2, "nunca"], [">", 1, "nunca"], ["<", 0, "nunca"], ["<=", -1, "nunca"], [">", 1.5, "nunca"],
  ]
  for (const [comparador, umbral, esperado] of casos) {
    assert.equal(desenlaceDeCondicionBooleana(comparador, umbral), esperado, `estado ${comparador} ${umbral}`)
  }
  // Lo que no se puede evaluar no se adivina: no es «siempre» ni «nunca».
  for (const [comparador, umbral] of [["==", 1], [undefined, 1], [">", Number.NaN], [">", undefined], [">", "1"]]) {
    assert.equal(desenlaceDeCondicionBooleana(comparador, umbral), "decide", `${comparador} ${umbral}`)
  }
})

/** ESP32 + sensor booleano en GPIO23 + LED con su resistencia, y una regla sobre el sensor. */
function proyectoConRegla(tipoSensor, cuando) {
  const directorio = mkdtempSync(join(os.tmpdir(), "tecniabot-condicion-booleana-"))
  const proyectoInicial = crearProyecto({ generadorId: () => `condicion-${n++}`, ahora: () => "2026-11-23T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen: crearAlmacen({ directorio, catalogo }) })
  const aplicar = (tipo, payload) => {
    const r = motor.aplicar({ idOperacion: `op-${n++}`, actor: "agente", baseRevision: motor.getProyecto().revision, tipo, payload })
    assert.equal(r.ok, true, `${tipo} ${JSON.stringify(payload)} fue rechazada: ${JSON.stringify(r.motivos ?? r)}`)
  }
  aplicar("SetPlaca", { placa: "esp32-devkit-v1" })
  aplicar("AgregarComponente", { tipo: tipoSensor }) // cmp-0
  const [sensor] = motor.getProyecto().componentes
  const terminalDeSenal = Object.keys(sensor.pines)[0]
  aplicar("AsignarPin", { componente: sensor.id, terminal: terminalDeSenal, pin: "GPIO23" })
  aplicar("AgregarComponente", { tipo: "led" })
  const led = motor.getProyecto().componentes[1]
  aplicar("AsignarPin", { componente: led.id, terminal: "anodo", pin: "GPIO4" })
  aplicar("AgregarComponente", { tipo: "resistencia" })
  aplicar("Conectar", { desde: { componente: motor.getProyecto().componentes[2].id, terminal: "a" }, hasta: { componente: led.id, terminal: "anodo" } })
  aplicar("SetComportamiento", { comportamiento: { cuando: { sensor: sensor.id, ...cuando }, entonces: { actuador: led.id, accion: "encender" } } })
  const proyecto = motor.getProyecto()
  const motivos = validarProyecto(proyecto, catalogo)
  return { proyecto, motivos, avisos: motivos.filter((m) => m.codigo === CODIGO), listo: derivarReadiness(proyecto, motivos).listo, sensor: sensor.id }
}

const booleana = (comparador, valor) => ({ capacidad: "estadoBooleano", comparador, umbral: { valor, unidad: "ninguna", magnitud: "estadoBooleano" } })

for (const tipo of ["pulsador", "interruptor"]) {
  test(`${tipo}: una condición que se cumple siempre o nunca avisa y NO bloquea`, () => {
    for (const [comparador, valor, desenlace] of [["<", 5, "siempre"], [">", -3, "siempre"], [">=", 2, "nunca"], [">", 1, "nunca"], ["<", 0, "nunca"]]) {
      const p = proyectoConRegla(tipo, booleana(comparador, valor))
      assert.equal(p.avisos.length, 1, `${tipo} ${comparador} ${valor}: esperaba un aviso y hay ${JSON.stringify(p.motivos.map((m) => m.codigo))}`)
      const [aviso] = p.avisos
      assert.equal(aviso.severidad, "warning")
      assert.equal(aviso.clasificacion, "representable")
      assert.equal(aviso.entidad.tipo, "comportamiento")
      assert.equal(aviso.datos.desenlace, desenlace)
      assert.equal(aviso.datos.sensor, p.sensor)
      assert.equal(p.listo, true, `${tipo} ${comparador} ${valor}: el aviso no puede sacar el «listo» (decisión del owner)`)
    }
  })

  test(`${tipo}: las formas canónicas y las raras que DECIDEN no avisan`, () => {
    for (const [comparador, valor] of [[">=", 1], ["<", 1], [">", 0], ["<=", 0], [">", 0.5], ["<=", 0.5]]) {
      const p = proyectoConRegla(tipo, booleana(comparador, valor))
      assert.deepEqual(p.avisos, [], `${tipo} ${comparador} ${valor} separa el 0 del 1: no es una condición sin efecto`)
      assert.equal(p.listo, true)
    }
  })
}

test("una temperatura no es un estado de 0 o 1: este aviso no le toca", () => {
  // «temperatura < 5» y «temperatura >= 2» son reglas normales. Si el chequeo mirara
  // cualquier magnitud, las marcaría como «siempre» o «nunca».
  for (const [comparador, valor] of [["<", 5], [">=", 2], [">", 1], ["<", 0]]) {
    const p = proyectoConRegla("dht22", { capacidad: "temperatura", comparador, umbral: { valor, unidad: "celsius", magnitud: "temperatura" } })
    assert.deepEqual(p.avisos, [], `temperatura ${comparador} ${valor}`)
  }
})

test("lo que lee el alumno dice si es siempre o nunca, y nombra la pieza sin ids crudos", () => {
  for (const [comparador, valor, palabra] of [["<", 5, /siempre/i], [">=", 2, /nunca/i]]) {
    const p = proyectoConRegla("pulsador", booleana(comparador, valor))
    const explicado = proyectarVista(p.proyecto, catalogo).motivos.find((m) => m.codigo === CODIGO)
    assert.ok(explicado, "el aviso no llegó a la vista")
    assert.equal(typeof explicado.explicacion, "string", "el aviso llegó sin explicación: el alumno vería el código crudo")
    assert.match(explicado.explicacion, palabra, explicado.explicacion)
    assert.match(explicado.explicacion, /pulsador/i, explicado.explicacion)
    assert.doesNotMatch(explicado.explicacion, /cmp-\d|beh-\d|estadoBooleano|desenlace|CONDICION/, `el texto muestra un dato interno: ${explicado.explicacion}`)
  }
})
