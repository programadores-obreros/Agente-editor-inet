// Phase 3 — Vertical #2, T6: conflicto de revisión desde la vista lógica, por el servidor HTTP REAL.
// La vista lógica tiene la revisión N; otro productor (el agente, directo sobre el servicio) la lleva a
// N+1; la edición lógica con N recibe BASE_REVISION_DESACTUALIZADA (no muta), el cliente recarga el
// snapshot y repinta — el MISMO camino que la frase y el GPIO (`cliente-http.js`).

import test from "node:test"
import assert from "node:assert/strict"
import { prepararServidor, cerrar, montarApp, op, TRIADA } from "./phase3-blockly-harness.mjs"

test("T6 edición con revisión vieja: rechazada sin mutar, recarga el snapshot y la vista lógica muestra el estado vigente", async () => {
  const ctx = await prepararServidor()
  try {
    ctx.paso("SetComportamiento", { comportamiento: { cuando: { sensor: ctx.pulsador } } })
    const app = await montarApp(ctx)
    await app.cargar()
    app.vista.repintar(app.snapshot, { deshabilitado: false })
    const revisionVista = app.snapshot.revision
    const reglaId = app.snapshot.vista.reglas[0].id
    assert.equal(app.campo("estado").getValue(), app.campo("estado").opciones[0][1], "la vista lógica arranca con el estado sin elegir")

    // otro productor (agente) mueve la IR a N+1: completa la regla
    const r = ctx.servicio.aplicar(op("SetComportamiento", { comportamiento: { id: reglaId, cuando: { sensor: ctx.pulsador, ...TRIADA }, entonces: { actuador: ctx.led, accion: "encender" } } }, revisionVista, { actor: "agente" }))
    assert.equal(r.ok, true)
    const irAgente = JSON.stringify(ctx.servicio.snapshot().proyecto)
    assert.equal(ctx.servicio.snapshot().revision, revisionVista + 1)

    // el alumno edita desde la vista (todavía con N)
    const postsAntes = app.posts
    app.campo("estado").setValue("presionado")
    await app.esperar()

    assert.equal(app.posts - postsAntes, 1, "una sola operación enviada")
    assert.equal(ctx.servicio.snapshot().revision, revisionVista + 1, "la operación vieja NO muta")
    assert.equal(JSON.stringify(ctx.servicio.snapshot().proyecto), irAgente, "IR idéntica a la del agente")
    assert.ok(app.estados.some((t) => /otro cambio llegó primero/.test(t ?? "")), "se avisa en lenguaje llano")
    assert.equal(app.snapshot.revision, revisionVista + 1, "el cliente recargó el snapshot vigente")
    assert.deepEqual(app.valores(), [ctx.pulsador, "presionado", ctx.led, "encendido"], "la vista lógica repintó desde el snapshot vigente")
    assert.equal(app.controlador.opciones().operacionPendiente, false)
  } finally {
    await cerrar(ctx)
  }
})

test("T6 el rechazo de dominio (no stale) repinta desde el snapshot autoritativo y muestra el motivo del servidor", async () => {
  const ctx = await prepararServidor()
  try {
    const app = await montarApp(ctx)
    await app.cargar()
    app.vista.repintar(app.snapshot, { deshabilitado: false })
    const antes = app.snapshot.revision
    // sobre envenenado: baseRevision inválida a propósito -> el servidor rechaza, nada cambia
    const cuerpo = await app.cliente.enviarSobre({ idOperacion: "x-1", actor: "navegador", baseRevision: -5, tipo: "SetComportamiento", payload: { comportamiento: { cuando: { sensor: ctx.pulsador } } } }, { repintarAhora: true })
    assert.equal(cuerpo.resultado.ok, false)
    assert.equal(ctx.servicio.snapshot().revision, antes)
    assert.ok(app.estados.some((t) => typeof t === "string" && t.length > 0))
    assert.equal(app.snapshot.revision, antes)
  } finally {
    await cerrar(ctx)
  }
})
