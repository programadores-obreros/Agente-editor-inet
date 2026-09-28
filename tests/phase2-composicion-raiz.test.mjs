// Phase 2, Slice 1 — E3-04b (condición de entrada, ver
// docs/programacion-intencion/PHASE_2_SLICE_1_DESIGN.md §2.2 y el informe ARCH-A
// §5): la raíz de composición (`opencode/nucleo/composicion-raiz.ts`) es el ÚNICO
// módulo de producción, además de `nucleo/almacen.ts` mismo, autorizado a construir
// un `Almacen` — y el servicio que devuelve nunca expone una vía de escritura que
// bypasee el motor. Cuatro guardias:
//   (a) superficie exportada del MÓDULO, exactamente la esperada;
//   (b) el SERVICIO devuelto no expone guardar/cargar/existe ni el Almacen/motor crudo;
//   (c) guardia estructural: ningún archivo de producción fuera de la lista
//       autorizada importa almacen.ts ni referencia crearAlmacen;
//   (d) singleton: un único Engine vivo por (directorio, idProyecto) — REA-N5,
//       DECISIONS.md:706-724, INVARIANTES-ENTRYPOINTS.md:742.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, obtenerServicioDeProyecto, nuevoDir, nuevoIdProyecto, op } from "./phase2-helpers.mjs"
import { verificar } from "../scripts/guardia-composicion-raiz.mjs"

const RUTA_COMPOSICION_RAIZ = join(REPO, "opencode/nucleo/composicion-raiz.ts")

// ════════════════════════════════════════════════════════════════════════════════════
// (a) — superficie exportada del MÓDULO
// ════════════════════════════════════════════════════════════════════════════════════

test("(a) composicion-raiz.ts exporta EXACTAMENTE obtenerServicioDeProyecto (los `export interface`/`export type` se borran en runtime, TypeScript es sintaxis borrable)", async () => {
  const modulo = await import(RUTA_COMPOSICION_RAIZ)
  assert.deepEqual(Object.keys(modulo).sort(), ["obtenerServicioDeProyecto"])
  assert.equal(typeof modulo.obtenerServicioDeProyecto, "function")
})

test("(a) ninguna clave exportada es 'crearAlmacen' ni 'Almacen' (límite honesto: un re-export de SOLO TIPO, `export type { Almacen }`, se borra en runtime y este test no puede detectarlo — un tipo sin el valor `crearAlmacen` no permite construir nada ejecutable, así que no es una segunda vía de escritura real)", async () => {
  const modulo = await import(RUTA_COMPOSICION_RAIZ)
  assert.equal("crearAlmacen" in modulo, false)
  assert.equal("Almacen" in modulo, false)
})

// ════════════════════════════════════════════════════════════════════════════════════
// (b) — el SERVICIO devuelto no expone guardar/cargar/existe ni el Almacen/motor crudo
// ════════════════════════════════════════════════════════════════════════════════════

test("(b) el servicio devuelto tiene EXACTAMENTE snapshot/aplicar/aplicarTransaccion/proponer/suscribir/cerrar — nada de guardar/cargar/existe/almacen/motor crudo", () => {
  const dir = nuevoDir("guardia-b")
  const servicio = obtenerServicioDeProyecto({ directorio: dir, idProyecto: nuevoIdProyecto() })

  // Claves propias + las de TODO el prototipo (hasta Object.prototype exclusive) —
  // un objeto literal como el que devuelve la raíz sólo tiene claves propias, pero
  // el test recorre el prototipo igual: si mañana la raíz pasara a devolver una
  // instancia de clase, este test sigue cerrando el mismo hueco sin que nadie tenga
  // que acordarse de actualizarlo.
  const clavesPropias = Object.getOwnPropertyNames(servicio)
  const clavesPrototipo = []
  for (let proto = Object.getPrototypeOf(servicio); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    clavesPrototipo.push(...Object.getOwnPropertyNames(proto))
  }
  const todasLasClaves = new Set([...clavesPropias, ...clavesPrototipo])

  assert.deepEqual([...clavesPropias].sort(), ["aplicar", "aplicarTransaccion", "cerrar", "proponer", "snapshot", "suscribir"])

  for (const prohibida of ["guardar", "cargar", "existe", "almacen", "Almacen", "crearAlmacen", "motor", "fs", "directorio"]) {
    assert.equal(todasLasClaves.has(prohibida), false, `el servicio no debe exponer "${prohibida}" (propio ni de prototipo)`)
  }
  // Asserts negativos explícitos — documentan en el propio test qué NO debe
  // aparecer nunca (mismo criterio que propuso el informe ARCH-A §5).
  assert.equal(servicio.guardar, undefined)
  assert.equal(servicio.cargar, undefined)
  assert.equal(servicio.existe, undefined)
  assert.equal(servicio.almacen, undefined)

  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// (c) — guardia estructural (fs + regex en JS puro, scripts/guardia-composicion-raiz.mjs)
// ════════════════════════════════════════════════════════════════════════════════════

test("(c) HOY, en el repo real: 0 archivos de produccion fuera de nucleo/almacen.ts y nucleo/composicion-raiz.ts importan almacen.ts o referencian crearAlmacen", () => {
  const resultado = verificar({ raiz: REPO })
  assert.deepEqual(resultado.violaciones, [], `violaciones encontradas: ${JSON.stringify(resultado.violaciones, null, 2)}`)
})

test("(c) el guardia SI detecta la trampa: un archivo fuera de la lista autorizada que importa crearAlmacen — prueba que el guardia no es un test vacío", () => {
  // Directorio temporal descartable (os.tmpdir(), mismo patrón que `nuevoDir()`) —
  // nunca se apunta el escaneo al repo real para esta prueba.
  const raizTrampa = nuevoDir("guardia-c-trampa")
  const dirTool = join(raizTrampa, "opencode", "tool")
  mkdirSync(dirTool, { recursive: true })
  writeFileSync(join(dirTool, "bypass-trampa.ts"), 'import { crearAlmacen } from "../nucleo/almacen.ts"\nexport const bypass = crearAlmacen\n')

  const resultado = verificar({ raiz: raizTrampa })
  assert.equal(resultado.violaciones.length, 1)
  assert.equal(resultado.violaciones[0].archivo, "opencode/tool/bypass-trampa.ts")
  assert.deepEqual(resultado.violaciones[0].motivos.sort(), ["importa almacen.ts", "referencia crearAlmacen"])
})

// ════════════════════════════════════════════════════════════════════════════════════
// (d) — singleton: un único Engine vivo por (directorio, idProyecto)
// ════════════════════════════════════════════════════════════════════════════════════

test("(d) dos llamadas con el MISMO (directorio, idProyecto) devuelven el MISMO servicio (misma referencia)", () => {
  const dir = nuevoDir("singleton-mismo")
  const id = nuevoIdProyecto()
  const a = obtenerServicioDeProyecto({ directorio: dir, idProyecto: id })
  const b = obtenerServicioDeProyecto({ directorio: dir, idProyecto: id })
  assert.equal(a, b, "singleton real: misma referencia, no sólo mismo comportamiento")
  a.cerrar()
})

test("(d) ids de proyecto DISTINTOS, mismo directorio, dan servicios DISTINTOS", () => {
  const dir = nuevoDir("singleton-distinto-id")
  const a = obtenerServicioDeProyecto({ directorio: dir, idProyecto: nuevoIdProyecto("a") })
  const b = obtenerServicioDeProyecto({ directorio: dir, idProyecto: nuevoIdProyecto("b") })
  assert.notEqual(a, b)
  a.cerrar()
  b.cerrar()
})

test("(d) operacion aplicada por UN handle es visible por el OTRO con la misma revision (comparten el mismo motor en memoria, no releen disco para 'simular' que estan de acuerdo)", () => {
  const dir = nuevoDir("singleton-visibilidad")
  const id = nuevoIdProyecto()
  const a = obtenerServicioDeProyecto({ directorio: dir, idProyecto: id }) // simula la tool
  const b = obtenerServicioDeProyecto({ directorio: dir, idProyecto: id }) // simula el navegador

  const n = a.snapshot().revision
  const r = a.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, n))
  assert.equal(r.ok, true)

  const snapshotDesdeB = b.snapshot()
  assert.equal(snapshotDesdeB.revision, n + 1)
  assert.equal(snapshotDesdeB.proyecto.placa, "esp32-devkit-v1")
  a.cerrar()
})
