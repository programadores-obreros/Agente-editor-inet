// Las zonas del esquema nombran la placa DEL PROYECTO, no una fija.
//
// POR QUÉ ESTE ARCHIVO (2026-11-26). Probando en la notebook real, con el proyecto pasado a
// Arduino UNO, la ventana mostraba «Entrada — Lo que el ESP32 lee.» y «Salida — Lo que el ESP32
// maneja.»: el texto estaba fijo en `ZONAS_DEL_CIRCUITO` del anexo de pedagogía. Ningún test lo
// marcaba porque todos los escenarios de zonas usaban un ESP32.
//
// QUÉ SE MIDE. Proyectos armados con operaciones REALES del motor (incluido `SetPlaca` para pasar
// a la UNO), proyectados con el catálogo real. Las frases esperadas se escriben a mano, no se
// recalculan con la misma cuenta que el código.
//
// MUTACIONES que ponen rojo este archivo (probadas con el cambio ya commiteado):
//   - volver a dejar «ESP32» fijo en la descripción del anexo               → «Arduino UNO…» y «sin placa…»
//   - `textoDeZona(rol, "ESP32 DevKit")` fijo en `zonasDelEsquema`           → «Arduino UNO…» y «sin placa…»
//   - sin placa, usar `conNombre` con un nombre vacío («la placa .»)         → «sin placa…»
//
// Corre con: node --test tests/ventana-zonas-placa.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { CONOCIMIENTO_ACTIVO } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))

const catalogo = CONOCIMIENTO_ACTIVO.catalogo

let n = 0
function proyecto(pasos) {
  let p = crearProyecto({ generadorId: () => "zonas", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  for (const [tipo, payload] of pasos) {
    const r = ejecutarOperacion(p, { idOperacion: `zonas-${n++}`, actor: "agente", baseRevision: p.revision, tipo, payload }, catalogo)
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
    p = r.proyecto
  }
  return p
}
const descripciones = (vista) => Object.fromEntries(vista.zonas.map((z) => [z.rol, z.descripcion]))
const PIEZAS = [
  ["AgregarComponente", { tipo: "pulsador" }],
  ["AgregarComponente", { tipo: "led" }],
]

test("con un ESP32, la entrada y la salida nombran al ESP32 DevKit", () => {
  const vista = proyectarVista(proyecto([["SetPlaca", { placa: "esp32-devkit-v1" }], ...PIEZAS]), catalogo)
  assert.equal(vista.placa?.nombre, "ESP32 DevKit")
  assert.deepEqual(descripciones(vista), {
    entrada: "Lo que lee la placa ESP32 DevKit.",
    controlador: "Lee la entrada y decide la salida.",
    salida: "Lo que maneja la placa ESP32 DevKit.",
  })
})

test("con un Arduino UNO (pasado por SetPlaca desde un ESP32), las zonas nombran la UNO y ninguna dice ESP32", () => {
  const vista = proyectarVista(proyecto([["SetPlaca", { placa: "esp32-devkit-v1" }], ...PIEZAS, ["SetPlaca", { placa: "arduino-uno" }]]), catalogo)
  assert.equal(vista.placa?.nombre, "Arduino UNO", "el escenario tiene que haber quedado de verdad en la UNO")
  assert.deepEqual(descripciones(vista), {
    entrada: "Lo que lee la placa Arduino UNO.",
    controlador: "Lee la entrada y decide la salida.",
    salida: "Lo que maneja la placa Arduino UNO.",
  })
  for (const zona of vista.zonas) assert.doesNotMatch(`${zona.titulo} ${zona.descripcion}`, /ESP32/, `la zona ${zona.rol} sigue nombrando al ESP32`)
})

test("sin placa elegida, las zonas dicen «la placa» sin inventar un nombre", () => {
  const vista = proyectarVista(proyecto(PIEZAS), catalogo)
  assert.equal(vista.placa, null, "el escenario no tiene que tener placa")
  assert.deepEqual(descripciones(vista), {
    entrada: "Lo que lee la placa.",
    controlador: "Lee la entrada y decide la salida.",
    salida: "Lo que maneja la placa.",
  })
})
