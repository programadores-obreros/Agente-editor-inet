// Phase 3 — Vertical #2, T2: las OPCIONES de cada campo salen sólo del servidor
// (`opcionesRegla.slots`), con un snapshot REAL (Engine + catálogo reales): ESP32 + LED con su
// resistencia en serie (GPIO18) + pulsador (GPIO4). Defensa en profundidad: el Engine rechaza
// igual un pulsador como salida.
//
// Nota de proceso: T1 (proyección) y el vertical #1 ya garantizan este comportamiento, así que
// estos tests son VERDES desde su primer commit (no hay RED genuino para T2: es una prueba de
// regresión/contrato sobre datos reales).

import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, op } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { proyectarModeloLogico } = await import(join(REPO, "opencode/vista-fisica/web/vista-logica.js"))

const CONDICION = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }

function armar() {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("p3-bl-opc"), idProyecto: nuevoIdProyecto("p3-bl-opc") })
  const aplicar = (tipo, payload) => {
    const r = servicio.aplicar(op(tipo, payload, servicio.snapshot().revision))
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
    return r
  }
  aplicar("SetPlaca", { placa: "esp32-devkit-v1" })
  for (const tipo of ["led", "resistencia", "pulsador"]) aplicar("AgregarComponente", { tipo })
  const id = (tipo) => servicio.snapshot().proyecto.componentes.find((c) => c.tipo === tipo).id
  const [led, resistencia, pulsador] = [id("led"), id("resistencia"), id("pulsador")]
  aplicar("Conectar", { desde: { componente: led, terminal: "anodo" }, hasta: { componente: resistencia, terminal: "a" } })
  aplicar("AsignarPin", { componente: led, terminal: "anodo", pin: "GPIO18" })
  aplicar("AsignarPin", { componente: pulsador, terminal: "senal", pin: "GPIO4" })
  return { servicio, aplicar, led, resistencia, pulsador }
}
const campo = (modelo, indice) => modelo.regla.campos[indice]
const valores = (f) => f.opciones.map((o) => o.valor)

test("T2 el campo de entrada ofrece el Pulsador (y sólo él)", () => {
  const c = armar()
  const m = proyectarModeloLogico(c.servicio.snapshot().vista)
  assert.deepEqual(c.servicio.snapshot().vista.opcionesRegla.slots.map((s) => s.slot), m.regla.campos.map((f) => f.slot))
  assert.deepEqual(campo(m, 0).opciones, [{ valor: c.pulsador, etiqueta: "Pulsador" }])
  c.servicio.cerrar()
})

test("T2 el campo de salida ofrece el LED; el Pulsador NO se ofrece como salida", () => {
  const c = armar()
  const m = proyectarModeloLogico(c.servicio.snapshot().vista)
  assert.deepEqual(campo(m, 2).opciones, [{ valor: c.led, etiqueta: "LED" }])
  assert.equal(valores(campo(m, 2)).includes(c.pulsador), false)
  c.servicio.cerrar()
})

test("T2 la resistencia no aparece en ningún campo", () => {
  const c = armar()
  const m = proyectarModeloLogico(c.servicio.snapshot().vista)
  for (const f of m.regla.campos) assert.equal(valores(f).includes(c.resistencia), false, `campo ${f.slot}`)
  c.servicio.cerrar()
})

test("T2 las opciones del modelo son EXACTAMENTE las del servidor (valor+etiqueta, mismo orden), también con una regla armada", () => {
  const c = armar()
  c.aplicar("SetComportamiento", { comportamiento: { cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.led, accion: "encender" } } })
  const vista = c.servicio.snapshot().vista
  const m = proyectarModeloLogico(vista)
  const esperado = vista.opcionesRegla.slots.map((s) => s.opciones.map(({ valor, etiqueta }) => ({ valor, etiqueta })))
  assert.deepEqual(m.regla.campos.map((f) => f.opciones), esperado)
  // Semantic Vertical #3: estados y salidas vienen del conocimiento (presionado/suelto, encendido/apagado).
  assert.deepEqual(m.regla.campos.map((f) => f.opciones.map((o) => o.etiqueta)), [["Pulsador"], ["presionado", "suelto"], ["LED"], ["encendido", "apagado"]])
  c.servicio.cerrar()
})

test("T2 defensa en profundidad: el Engine real sigue rechazando un pulsador como salida (ACTUADOR_INVALIDO)", () => {
  const c = armar()
  c.aplicar("SetComportamiento", { comportamiento: { cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.pulsador, accion: "encender" } } })
  const snap = c.servicio.snapshot()
  assert.ok(snap.validacion.motivos.some((x) => x.codigo === "ACTUADOR_INVALIDO"), "motivo semántico del Engine")
  assert.equal(snap.validacion.readiness.listo, false)
  // …y el modelo lo muestra con texto llano, sin ofrecer el pulsador como salida.
  const m = proyectarModeloLogico(snap.vista)
  assert.ok(m.regla.motivos.length > 0)
  assert.equal(valores(campo(m, 2)).includes(c.pulsador), false)
  c.servicio.cerrar()
})
