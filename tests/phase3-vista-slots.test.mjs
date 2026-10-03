// Phase 3 — T5b: el navegador NO nombra los slots de la frase ni sabe qué significa cada
// opción (la guardia §3.3 de phase2-s2-rol prohíbe las palabras de clasificación en
// web/*.js). El servidor entrega `opcionesRegla.slots` (orden, texto fijo, opciones con su
// `parche` sobre la regla) y `reglas[i].aviso`; el navegador sólo los mezcla y los pinta.

import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, op, catalogo, prepararProyectoConLed, GPIO_Y } from "./phase2-helpers.mjs"

const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))

const CONDICION = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }

function preparar() {
  const { servicio, idComponente: led } = prepararProyectoConLed(nuevoDir("p3-slots"), nuevoIdProyecto("p3-slots"))
  let r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const pulsador = servicio.snapshot().proyecto.componentes.find((c) => c.tipo === "pulsador").id
  r = servicio.aplicar(op("AsignarPin", { componente: pulsador, terminal: "senal", pin: GPIO_Y }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  return { servicio, led, pulsador }
}
const vistaDe = (c) => proyectarVista(c.servicio.snapshot().proyecto, catalogo)

test("T5b opcionesRegla.slots: cuatro slots ordenados, con el texto fijo de la frase y opciones con su parche", () => {
  const c = preparar()
  const { slots } = vistaDe(c).opcionesRegla
  assert.ok(Array.isArray(slots), "opcionesRegla.slots")
  assert.deepEqual(slots.map((s) => [s.slot, s.prefijo]), [["sensor", "Mientras el"], ["estado", "esté"], ["actuador", ", el"], ["salida", "está"]])
  assert.deepEqual(slots[0].opciones, [{ valor: c.pulsador, etiqueta: "Pulsador", parche: { cuando: { sensor: c.pulsador } } }])
  assert.deepEqual(slots[1].opciones, [{ valor: "presionado", etiqueta: "presionado", parche: { cuando: CONDICION } }])
  assert.deepEqual(slots[2].opciones, [{ valor: c.led, etiqueta: "LED", parche: { entonces: { actuador: c.led } } }])
  assert.deepEqual(slots[3].opciones, [{ valor: "encendido", etiqueta: "encendido", parche: { entonces: { accion: "encender" } } }])
  c.servicio.cerrar()
})

test("T5b reglas[i].aviso: la nota de condición avanzada la pone el servidor; null en cualquier otro caso", () => {
  const c = preparar()
  const set = (comportamiento) => {
    const r = c.servicio.aplicar(op("SetComportamiento", { comportamiento }, c.servicio.snapshot().revision))
    assert.equal(r.ok, true)
  }
  set({ cuando: { sensor: c.pulsador, ...CONDICION }, entonces: { actuador: c.led, accion: "encender" } })
  set({ cuando: { sensor: c.pulsador, ...CONDICION, comparador: ">" }, entonces: { actuador: c.led, accion: "encender" } })
  const [canonica, avanzada] = vistaDe(c).reglas
  assert.equal(canonica.aviso, null)
  assert.equal(avanzada.aviso, "Esta regla usa una condición avanzada: se puede mirar, pero esta frase sólo sabe armar «presionado».")
  c.servicio.cerrar()
})
