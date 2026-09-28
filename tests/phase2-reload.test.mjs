// Phase 2, Slice 1 — Reload: `cerrar()` + una raíz NUEVA sobre el mismo directorio
// dan el mismo GPIO, la misma revisión y el mismo snapshot (diseño §2.8, ARCH-D
// tema 7). Nunca se reinicia un proceso real: se simula construyendo una SEGUNDA
// instancia del composition root en el mismo proceso de test, después de `cerrar()`
// la primera (mismo criterio que propuso ARCH-D §1, "Sincronización determinista").

import { test } from "node:test"
import assert from "node:assert/strict"
import { obtenerServicioDeProyecto, nuevoDir, nuevoIdProyecto, prepararProyectoConLed, op, GPIO_Y } from "./phase2-helpers.mjs"

test("cerrar() + obtenerServicioDeProyecto de nuevo sobre el mismo directorio: mismo GPIO, misma revision, mismo snapshot", () => {
  const dir = nuevoDir("reload")
  const id = nuevoIdProyecto()
  const { servicio: servicio1, idComponente } = prepararProyectoConLed(dir, id) // led en GPIO_X

  const n = servicio1.snapshot().revision
  const r = servicio1.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Y }, n))
  assert.equal(r.ok, true)

  const snapshot1 = servicio1.snapshot()
  servicio1.cerrar()

  // "Raíz nueva sobre el mismo directorio" — mismo (directorio, idProyecto), pero la
  // entrada anterior ya se sacó del registro con cerrar(): esta llamada construye un
  // Almacen/motor NUEVOS, releyendo disco.
  const servicio2 = obtenerServicioDeProyecto({ directorio: dir, idProyecto: id })
  assert.notEqual(servicio2, servicio1, "es una instancia NUEVA, no el mismo singleton en memoria (eso ya lo prueba el test de reload en sí)")

  const snapshot2 = servicio2.snapshot()
  assert.equal(snapshot2.revision, snapshot1.revision, "misma revision")
  assert.equal(snapshot2.proyecto.componentes.find((c) => c.id === idComponente).pines.anodo, GPIO_Y, "mismo GPIO")
  assert.equal(JSON.stringify(snapshot2.proyecto), JSON.stringify(snapshot1.proyecto), "mismo proyecto, por valor, campo a campo")
  assert.deepEqual(snapshot2.validacion, snapshot1.validacion, "misma validacion (motivos + readiness)")

  servicio2.cerrar()
})

test("SIN cerrar() primero, obtenerServicioDeProyecto sobre el mismo (directorio, idProyecto) sigue devolviendo el singleton EXISTENTE (no relee disco)", () => {
  const dir = nuevoDir("reload-sin-cerrar")
  const id = nuevoIdProyecto()
  const { servicio: servicio1, idComponente } = prepararProyectoConLed(dir, id)

  const n = servicio1.snapshot().revision
  servicio1.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Y }, n))

  const servicioOtraVez = obtenerServicioDeProyecto({ directorio: dir, idProyecto: id })
  assert.equal(servicioOtraVez, servicio1, "sin cerrar(), es el MISMO singleton — el reload real sólo pasa después de cerrar()")

  servicio1.cerrar()
})
