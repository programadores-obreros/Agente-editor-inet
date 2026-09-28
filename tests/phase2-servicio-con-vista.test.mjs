// Phase 2, Slice 1 — `opencode/servidor/servicio-con-vista.ts` (writer W3, tarea 1):
// el ÚNICO punto de producción para obtener un `ServicioDeProyecto` — SIEMPRE con
// `calcularVista: vistaDeProyectoConCatalogoReal` inyectado, para que el snapshot
// resultante traiga la clave `vista` desde la primera construcción del singleton,
// sin importar quién llame primero (docs/programacion-intencion/
// PHASE_2_SLICE_1_PROTOCOL.md, "Integración con la raíz de composición").
//
// Tres guardias:
//   (a) superficie exportada del MÓDULO, exactamente la esperada;
//   (b) el snapshot que devuelve trae `vista`, IGUAL a proyectarla por fuera con
//       vistaDeProyectoConCatalogoReal (mismo criterio que
//       tests/phase2-vista-fisica.test.mjs, sección 7 — pero llamando a ESTE módulo,
//       nunca a composicion-raiz.ts con el hook a mano);
//   (c) guardia estructural: ningún archivo de producción fuera de este módulo (y
//       composicion-raiz.ts, que lo define) llama `obtenerServicioDeProyecto` directo.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, op, GPIO_X } from "./phase2-helpers.mjs"
import { verificar } from "../scripts/guardia-servicio-con-vista.mjs"

const RUTA_SERVICIO_CON_VISTA = join(REPO, "opencode/servidor/servicio-con-vista.ts")

const { obtenerServicioDeProyectoConVista } = await import(RUTA_SERVICIO_CON_VISTA)
const { vistaDeProyectoConCatalogoReal } = await import(join(REPO, "opencode/vista-fisica/vista-real.ts"))

// ════════════════════════════════════════════════════════════════════════════════════
// (a) — superficie exportada del MÓDULO
// ════════════════════════════════════════════════════════════════════════════════════

test("(a) servicio-con-vista.ts exporta EXACTAMENTE obtenerServicioDeProyectoConVista (los `export type` se borran en runtime)", async () => {
  const modulo = await import(RUTA_SERVICIO_CON_VISTA)
  assert.deepEqual(Object.keys(modulo).sort(), ["obtenerServicioDeProyectoConVista"])
  assert.equal(typeof modulo.obtenerServicioDeProyectoConVista, "function")
})

// ════════════════════════════════════════════════════════════════════════════════════
// (b) — el snapshot trae `vista`, siempre, desde la primera construcción
// ════════════════════════════════════════════════════════════════════════════════════

test("(b) snapshot().vista existe desde la PRIMERA llamada, sin que el consumidor pase calcularVista a mano", () => {
  const dir = nuevoDir("servicio-con-vista-b1")
  const id = nuevoIdProyecto()
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })
  const s = servicio.snapshot()
  assert.equal("vista" in s, true)
  assert.notEqual(s.vista, undefined)
  servicio.cerrar()
})

test("(b) snapshot().vista es igual a proyectarla por fuera con vistaDeProyectoConCatalogoReal, con datos reales (ESP32+LED+pin asignado)", () => {
  const dir = nuevoDir("servicio-con-vista-b2")
  const id = nuevoIdProyecto()
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })

  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idComponente = servicio.snapshot().proyecto.componentes[0].id
  r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_X }, servicio.snapshot().revision))
  assert.equal(r.ok, true)

  const snapshot = servicio.snapshot()
  const vistaPorFuera = vistaDeProyectoConCatalogoReal(snapshot.proyecto)
  assert.deepEqual(snapshot.vista, vistaPorFuera)
  servicio.cerrar()
})

test("(b) dos llamadas con el MISMO (directorio, idProyecto) — la SEGUNDA sin pasar nada raro — devuelven el MISMO singleton, y ambas ven `vista` (no depende de quién llegó primero)", () => {
  const dir = nuevoDir("servicio-con-vista-b3")
  const id = nuevoIdProyecto()
  const a = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })
  const b = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto: id })
  assert.equal(a, b)
  assert.equal("vista" in a.snapshot(), true)
  assert.equal("vista" in b.snapshot(), true)
  a.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// (c) — guardia estructural (fs + regex, scripts/guardia-servicio-con-vista.mjs)
// ════════════════════════════════════════════════════════════════════════════════════

test("(c) HOY, en el repo real: 0 archivos de produccion fuera de composicion-raiz.ts y servicio-con-vista.ts llaman obtenerServicioDeProyecto directo", () => {
  const resultado = verificar({ raiz: REPO })
  assert.deepEqual(resultado.violaciones, [], `violaciones encontradas: ${JSON.stringify(resultado.violaciones, null, 2)}`)
})

test("(c) el guardia SI detecta la trampa: un archivo fuera de la lista autorizada que llama obtenerServicioDeProyecto directo", () => {
  const raizTrampa = nuevoDir("guardia-servicio-c-trampa")
  const dirServidor = join(raizTrampa, "opencode", "servidor")
  mkdirSync(dirServidor, { recursive: true })
  writeFileSync(
    join(dirServidor, "bypass-trampa.ts"),
    'import { obtenerServicioDeProyecto } from "../nucleo/composicion-raiz.ts"\nexport const bypass = () => obtenerServicioDeProyecto({ directorio: ".", idProyecto: "x" })\n',
  )

  const resultado = verificar({ raiz: raizTrampa })
  assert.equal(resultado.violaciones.length, 1)
  assert.equal(resultado.violaciones[0].archivo, "opencode/servidor/bypass-trampa.ts")
  assert.deepEqual(resultado.violaciones[0].motivos, ["referencia obtenerServicioDeProyecto"])
})

test("(c) el guardia NO marca falsamente a composicion-raiz.ts (quien lo DEFINE) ni a servicio-con-vista.ts (quien lo LLAMA a proposito) en el repo real", () => {
  const resultado = verificar({ raiz: REPO })
  const archivos = resultado.violaciones.map((v) => v.archivo)
  assert.equal(archivos.includes("opencode/nucleo/composicion-raiz.ts"), false)
  assert.equal(archivos.includes("opencode/servidor/servicio-con-vista.ts"), false)
})
