// Phase 2, Slice 1 — conflicto stale a través de la raíz de composición: el cliente
// A lee N; el cliente B commitea N+1 por el MISMO servicio; A envía con base N y
// recibe BASE_REVISION_DESACTUALIZADA sin sobrescribir; A vuelve a pedir el
// snapshot y ve N+1, reintenta con esa base y esta vez ok.
//
// A y B son dos LLAMADORES lógicos sobre el MISMO servicio (obtenerServicioDeProyecto
// con el mismo (directorio, idProyecto) es singleton — tests/phase2-composicion-raiz.
// test.mjs, guardia (d)) — el escenario real de Slice 1 (tool de OpenCode + navegador
// del docente), NO dos motores separados compitiendo por el mismo Almacen (ese es el
// escenario "deliberadamente peligroso" que ya cubre
// tests/nucleo-motor.test.mjs::dos-motores-mismo-almacen-real, E3-07 — no se toca).

import { test } from "node:test"
import assert from "node:assert/strict"
import { crearAlmacen, catalogo, canonicalizar, nuevoDir, nuevoIdProyecto, prepararProyectoConLed, op, GPIO_Y, GPIO_Z } from "./phase2-helpers.mjs"

test("commit de B en N vence a A con baseRevision stale — sin sobrescribir; A re-fetch ve N+1 y reintenta ok", () => {
  const dir = nuevoDir("conflicto-stale")
  const id = nuevoIdProyecto()
  const { servicio, idComponente } = prepararProyectoConLed(dir, id)

  // A y B son el MISMO servicio (singleton por (directorio, idProyecto)) — dos
  // variables sólo para nombrar la intención de cada llamador.
  const servicioA = servicio
  const servicioB = servicio

  const n = servicioA.snapshot().revision

  // B commitea primero, a un pin libre distinto del actual.
  const rB = servicioB.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Y }, n))
  assert.equal(rB.ok, true, `commit de B debe aceptarse: ${JSON.stringify(rB.motivos)}`)
  assert.equal(rB.revisionActual, n + 1)

  const snapshotDeB = servicioB.snapshot()
  assert.equal(snapshotDeB.revision, n + 1)
  assert.equal(snapshotDeB.proyecto.componentes.find((c) => c.id === idComponente).pines.anodo, GPIO_Y)

  // A todavía cree que la revisión vigente es N (su snapshot es viejo) — intenta
  // commitear con esa base, ya superada por el commit de B.
  const rA = servicioA.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Z }, n))
  assert.equal(rA.ok, false, "A con baseRevision stale debe rechazar")
  assert.ok(
    rA.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA" && m.clasificacion === "rechazo" && m.datos?.revisionActual === n + 1),
    `se espera BASE_REVISION_DESACTUALIZADA con revisionActual=${n + 1}: ${JSON.stringify(rA.motivos)}`,
  )

  // El snapshot tras el intento fallido de A sigue siendo EXACTAMENTE el de B —
  // canónicamente equivalente, no sólo "parecido".
  const snapshotTrasIntentoDeA = servicioA.snapshot()
  assert.equal(canonicalizar(snapshotTrasIntentoDeA.proyecto), canonicalizar(snapshotDeB.proyecto), "el intento de A no pisó nada: el proyecto sigue siendo el de B")

  // En disco (Almacen fresco, independiente) sólo está el commit de B, nunca el de A.
  const almacenFresco = crearAlmacen({ directorio: dir, catalogo })
  const recargado = almacenFresco.cargar(id)
  assert.equal(recargado.ok, true)
  assert.equal(recargado.proyecto.componentes.find((c) => c.id === idComponente).pines.anodo, GPIO_Y, "en disco sólo está el pin de B, nunca el de A")
  assert.equal(recargado.proyecto.revision, n + 1)

  // A vuelve a pedir el snapshot, ve N+1, reintenta CON esa base — esta vez ok.
  const revisionVigente = servicioA.snapshot().revision
  assert.equal(revisionVigente, n + 1)
  const rAReintento = servicioA.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Z }, revisionVigente))
  assert.equal(rAReintento.ok, true, `el reintento de A con la base correcta debe aceptarse: ${JSON.stringify(rAReintento.motivos)}`)
  assert.equal(servicioA.snapshot().proyecto.componentes.find((c) => c.id === idComponente).pines.anodo, GPIO_Z)

  servicio.cerrar()
})
