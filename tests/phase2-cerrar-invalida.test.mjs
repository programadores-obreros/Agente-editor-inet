// Phase 2, Slice 1 — fix de ronda única red-team, Hallazgo H2 (CRITICAL,
// P2-RED-A/INFORME.md, ataque 2): `cerrar()` sólo hacía `registro.delete(clave)` +
// `listeners.clear()` — nunca invalidaba los closures del `servicio` ya entregado.
// Un handle "cerrado" seguía `aplicar()`/`suscribir()` con éxito, escribiendo en
// disco y notificando — y un `obtenerServicioDeProyecto()` posterior para la MISMA
// clave construía una raíz nueva, dejando DOS motores vivos simultáneos sobre el
// mismo proyecto (exactamente la definición de CRITICAL: segunda autoridad de
// mutación).
//
// Fix (`opencode/nucleo/composicion-raiz.ts`): un flag `cerrado` por servicio: tras
// `cerrar()`, `snapshot`/`aplicar`/`aplicarTransaccion`/`proponer`/`suscribir` lanzan
// un error claro (`.code === "SERVICIO_CERRADO"`) ANTES de tocar el motor/disco —
// nunca delegan. `cerrar()` sigue siendo idempotente (llamarlo dos veces no lanza).
//
// Reproducción del ataque 2 del red team, adaptada a un test de contrato: ver
// scratchpad/phase2/evidencia/W5/H2/ (antes/después).

import { test } from "node:test"
import assert from "node:assert/strict"
import { obtenerServicioDeProyecto, nuevoDir, nuevoIdProyecto, op } from "./phase2-helpers.mjs"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function assertServicioCerrado(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error)
    assert.equal(error.code, "SERVICIO_CERRADO")
    return true
  })
}

test("H2: tras cerrar(), aplicar() lanza SERVICIO_CERRADO y NO escribe en disco (bytes identicos)", () => {
  const dir = nuevoDir("h2-aplicar")
  const id = nuevoIdProyecto()
  const a = obtenerServicioDeProyecto({ directorio: dir, idProyecto: id })
  const r0 = a.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, a.snapshot().revision))
  assert.equal(r0.ok, true)

  const rutaDisco = join(dir, `${id}.json`)
  const bytesAntes = readFileSync(rutaDisco)

  a.cerrar()

  assertServicioCerrado(() => a.aplicar(op("SetPlaca", { placa: "arduino-uno" }, 0)))

  const bytesDespues = readFileSync(rutaDisco)
  assert.deepEqual(bytesAntes, bytesDespues, "el handle cerrado NUNCA debe tocar el disco")
})

test("H2: tras cerrar(), snapshot()/aplicarTransaccion()/proponer()/suscribir() lanzan SERVICIO_CERRADO", () => {
  const dir = nuevoDir("h2-superficie")
  const id = nuevoIdProyecto()
  const a = obtenerServicioDeProyecto({ directorio: dir, idProyecto: id })
  a.cerrar()

  assertServicioCerrado(() => a.snapshot())
  assertServicioCerrado(() => a.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0)))
  assertServicioCerrado(() => a.aplicarTransaccion([op("SetPlaca", { placa: "esp32-devkit-v1" }, 0)]))
  assertServicioCerrado(() => a.proponer([op("SetPlaca", { placa: "esp32-devkit-v1" }, 0)]))
  assertServicioCerrado(() => a.suscribir(() => {}))
})

test("H2: un handle cerrado NO notifica (suscribir() previo al cierre no dispara mas eventos, ni el propio cerrar() cuenta como notificacion)", () => {
  const dir = nuevoDir("h2-notifica")
  const id = nuevoIdProyecto()
  const a = obtenerServicioDeProyecto({ directorio: dir, idProyecto: id })

  let eventos = 0
  a.suscribir(() => {
    eventos += 1
  })
  a.cerrar()
  assert.equal(eventos, 0, "cerrar() en si mismo nunca notifica")

  // El propio ataque: intentar seguir usando el handle zombie. Con el fix, esto
  // lanza ANTES de llegar al motor — nunca hay un evento post-cierre.
  assertServicioCerrado(() => a.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, 0)))
  assert.equal(eventos, 0, "el handle cerrado nunca vuelve a notificar")
})

test("H2: cerrar() sigue siendo IDEMPOTENTE — llamarlo dos veces no lanza", () => {
  const dir = nuevoDir("h2-idempotente")
  const id = nuevoIdProyecto()
  const a = obtenerServicioDeProyecto({ directorio: dir, idProyecto: id })
  a.cerrar()
  assert.doesNotThrow(() => a.cerrar())
})

test("H2: despues de cerrar(), un servicio NUEVO para la misma clave es el UNICO que muta — nunca conviven dos motores", () => {
  const dir = nuevoDir("h2-unico-mutador")
  const id = nuevoIdProyecto()
  const a = obtenerServicioDeProyecto({ directorio: dir, idProyecto: id })
  let r = a.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, a.snapshot().revision))
  assert.equal(r.ok, true)
  a.cerrar()

  // El handle viejo, si alguien lo retuvo por error, ya no puede mutar — verificado
  // arriba. El servicio nuevo relee disco y es el UNICO que sigue escribiendo.
  const b = obtenerServicioDeProyecto({ directorio: dir, idProyecto: id })
  assert.notEqual(a, b, "raiz nueva, releyendo disco (mismo contrato que antes del fix)")
  r = b.aplicar(op("AgregarComponente", { tipo: "led" }, b.snapshot().revision))
  assert.equal(r.ok, true, "b es una autoridad de mutacion valida y unica")
  assertServicioCerrado(() => a.aplicar(op("AgregarComponente", { tipo: "led" }, 0)))
  b.cerrar()
})
