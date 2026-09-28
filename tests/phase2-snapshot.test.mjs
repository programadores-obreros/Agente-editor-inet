// Phase 2, Slice 1 — Snapshot del servicio de proyecto (diseño §2.5): JSON plano,
// determinista, aislado del canónico. Acotado a la pieza NUEVA — no duplica lo que
// ya certifica `tests/nucleo-canonico-golden.test.mjs` (determinismo de
// `canonicalizar()`) ni lo que ya garantiza `motor.ts` (`congelarProfundo` sobre
// `Proyecto`/`ResultadoTransaccion`); acá se prueba el efecto observable del
// WRAPPER nuevo (`snapshot()`), no el mecanismo interno.

import { test } from "node:test"
import assert from "node:assert/strict"
import { obtenerServicioDeProyecto, nuevoDir, nuevoIdProyecto, prepararProyectoConLed, GPIO_X } from "./phase2-helpers.mjs"

test("snapshot contiene idProyecto, revision, catalogoVersion, catalogoHash, proyecto y validacion (motivos + readiness)", () => {
  const dir = nuevoDir("snapshot-forma")
  const id = nuevoIdProyecto()
  const { servicio } = prepararProyectoConLed(dir, id)
  const s = servicio.snapshot()

  assert.equal(s.idProyecto, id)
  assert.equal(typeof s.revision, "number")
  assert.equal(typeof s.catalogoVersion, "string")
  assert.equal(typeof s.catalogoHash, "string")
  assert.equal(typeof s.proyecto, "object")
  assert.equal(s.proyecto.id, id)
  assert.ok(Array.isArray(s.validacion.motivos))
  assert.equal(typeof s.validacion.readiness.listo, "boolean")
  assert.equal(typeof s.validacion.readiness.incompleto, "boolean")
  assert.equal(typeof s.validacion.readiness.invalido, "boolean")
  // El campo `vista` (diseño §2.6) todavía NO existe en este slice — lo agrega el
  // writer de la vista física. Este test fija ese límite: si nadie inyecta el hook
  // interno, `snapshot()` no debe inventar la clave.
  assert.equal("vista" in s, false)

  servicio.cerrar()
})

test("snapshot es JSON plano: JSON.parse(JSON.stringify(s)) da deepEqual a s", () => {
  const dir = nuevoDir("snapshot-json-plano")
  const { servicio } = prepararProyectoConLed(dir, nuevoIdProyecto())
  const s = servicio.snapshot()
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s)
  servicio.cerrar()
})

test("snapshot es determinista: dos lecturas consecutivas SIN ninguna operacion en el medio dan el mismo JSON", () => {
  const dir = nuevoDir("snapshot-determinista")
  const { servicio } = prepararProyectoConLed(dir, nuevoIdProyecto())
  const s1 = servicio.snapshot()
  const s2 = servicio.snapshot()
  assert.equal(JSON.stringify(s1), JSON.stringify(s2))
  servicio.cerrar()
})

test("mutar el snapshot devuelto NO cambia el canonico ni el PROXIMO snapshot", () => {
  const dir = nuevoDir("snapshot-aislado")
  const { servicio } = prepararProyectoConLed(dir, nuevoIdProyecto())
  const s1 = servicio.snapshot()
  const pinOriginal = s1.proyecto.componentes[0].pines.anodo
  const revisionOriginal = s1.revision
  assert.equal(pinOriginal, GPIO_X)

  // `s1.proyecto` es una copia PLANA nueva (JSON.parse fresco) — nunca el objeto
  // congelado del motor — así que SI es mutable, a propósito: el punto del test es
  // que mutarla no puede filtrarse hacia atrás, nunca que la mutación en sí misma
  // deba tirar una excepción.
  s1.proyecto.componentes[0].pines.anodo = "GPIO-HACKEADO"
  s1.revision = 999999
  s1.validacion.readiness.listo = !s1.validacion.readiness.listo

  const s2 = servicio.snapshot()
  assert.equal(s2.proyecto.componentes[0].pines.anodo, pinOriginal, "el canonico no se contaminó con la mutación de s1")
  assert.equal(s2.revision, revisionOriginal, "el proximo snapshot no hereda la mutación de revision de s1")

  servicio.cerrar()
})
