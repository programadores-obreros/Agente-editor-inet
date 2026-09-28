// Phase 2, Slice 1 — Path A (blocking representable: commitea, persiste, se sigue
// pintando con el motivo, y sigue siendo editable) y Path B (rechazo estructural: no
// cambia nada, ni en memoria ni en disco) — diseño §2.8.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { crearAlmacen, catalogo, canonicalizar, nuevoDir, nuevoIdProyecto, prepararProyectoConLed, op, GPIO_X, GPIO_Y } from "./phase2-helpers.mjs"

// ════════════════════════════════════════════════════════════════════════════════════
// Path A — PIN_OCUPADO (blocking, representable): commitea, persiste, se sigue
// pintando con el motivo, y sigue siendo editable. Mismo caso real que
// `tests/nucleo-demo-contractual.test.mjs` (Fase 1 no tiene ningún reason code de
// "falta resistencia en serie" en el catálogo hoy — PIN_OCUPADO es el caso real
// disponible, mismo criterio que usó el informe ARCH-D §3 tema 5).
// ════════════════════════════════════════════════════════════════════════════════════

test("Path A: un segundo LED al MISMO pin queda blocking representable — commitea, persiste, el snapshot muestra el motivo, y sigue siendo editable", () => {
  const dir = nuevoDir("path-a-pin-ocupado")
  const id = nuevoIdProyecto()
  const { servicio, idComponente: idLed1 } = prepararProyectoConLed(dir, id) // led en GPIO_X

  let n = servicio.snapshot().revision
  const rAgregar = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, n))
  assert.equal(rAgregar.ok, true)
  const idLed2 = servicio.snapshot().proyecto.componentes.find((c) => c.id !== idLed1).id

  n = servicio.snapshot().revision
  const r = servicio.aplicar(op("AsignarPin", { componente: idLed2, terminal: "anodo", pin: GPIO_X }, n)) // mismo pin que idLed1
  assert.equal(r.ok, true, "PIN_OCUPADO es representable: la operación COMMITEA (Path A)")
  assert.ok(r.motivos.some((m) => m.codigo === "PIN_OCUPADO" && m.severidad === "blocking" && m.clasificacion === "representable"))
  assert.equal(r.revisionActual, n + 1, "la revisión avanzó pese a quedar inválido")

  const snap = servicio.snapshot()
  assert.equal(snap.revision, n + 1)
  assert.ok(snap.validacion.motivos.some((m) => m.codigo === "PIN_OCUPADO"), "el snapshot muestra el motivo, para que la vista lo pinte")
  assert.equal(snap.validacion.readiness.listo, false, "blocking -> nunca listo")
  assert.equal(snap.validacion.readiness.invalido, true)

  // Persistido: el estado blocking SÍ se persiste (mismo invariante que
  // nucleo-demo-contractual.test.mjs caso 3 y nucleo-persistible-recargable.test.mjs
  // round-trip 3 — "un estado con blocking representable SIGUE siendo persistible").
  const almacenFresco = crearAlmacen({ directorio: dir, catalogo })
  const recargado = almacenFresco.cargar(id)
  assert.equal(recargado.ok, true)
  assert.equal(canonicalizar(recargado.proyecto), canonicalizar(snap.proyecto))

  // Editable: reasignar idLed2 a un pin libre resuelve PIN_OCUPADO.
  const revisionParaEditar = servicio.snapshot().revision
  const rEditado = servicio.aplicar(op("AsignarPin", { componente: idLed2, terminal: "anodo", pin: GPIO_Y }, revisionParaEditar))
  assert.equal(rEditado.ok, true, `debe seguir siendo editable: ${JSON.stringify(rEditado.motivos)}`)
  const snapEditado = servicio.snapshot()
  // PIN_OCUPADO desaparece (el conflicto de pin se resolvió) — el catálogo real
  // sigue exigiendo una resistencia en serie para el LED (REQUISITO_INSATISFECHO,
  // sin relación con el pin), así que `listo` no necesariamente pasa a `true` acá:
  // "editable" se prueba por el motivo puntual que se resolvió, no por completitud
  // general del proyecto (eso es otro predicado — `derivarReadiness` — sin relación
  // con este escenario).
  assert.ok(!snapEditado.validacion.motivos.some((m) => m.codigo === "PIN_OCUPADO"), "PIN_OCUPADO desaparece de los motivos activos tras editar")

  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// Path B — operación estructuralmente inválida: rechaza, nada cambia (ni memoria, ni
// disco byte a byte, ni revisión).
// ════════════════════════════════════════════════════════════════════════════════════

test("Path B: AsignarPin sobre un componente INEXISTENTE rechaza — snapshot igual, disco byte-a-byte igual, revision igual", () => {
  const dir = nuevoDir("path-b-referencia-inexistente")
  const id = nuevoIdProyecto()
  const { servicio } = prepararProyectoConLed(dir, id)

  const rutaDocumento = join(dir, `${id}.json`)
  const antes = servicio.snapshot()
  const discoAntesBytes = readFileSync(rutaDocumento, "utf8")

  const r = servicio.aplicar(op("AsignarPin", { componente: "cmp-no-existe", terminal: "anodo", pin: GPIO_Y }, antes.revision))
  assert.equal(r.ok, false)
  assert.ok(r.motivos.some((m) => m.codigo === "REFERENCIA_INEXISTENTE" && m.clasificacion === "rechazo"))

  const despues = servicio.snapshot()
  assert.equal(despues.revision, antes.revision, "la revision NO cambia")
  assert.equal(JSON.stringify(despues.proyecto), JSON.stringify(antes.proyecto), "el snapshot sigue siendo el mismo por valor")

  const discoDespuesBytes = readFileSync(rutaDocumento, "utf8")
  assert.equal(discoDespuesBytes, discoAntesBytes, "el disco no cambió NI UN BYTE")

  servicio.cerrar()
})

test("Path B: un sobre malformado (baseRevision con tipo invalido) rechaza — snapshot igual, disco byte-a-byte igual, revision igual", () => {
  const dir = nuevoDir("path-b-sobre-malformado")
  const id = nuevoIdProyecto()
  const { servicio, idComponente } = prepararProyectoConLed(dir, id)

  const rutaDocumento = join(dir, `${id}.json`)
  const antes = servicio.snapshot()
  const discoAntesBytes = readFileSync(rutaDocumento, "utf8")

  const r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Y }, "no-es-un-numero"))
  assert.equal(r.ok, false)
  assert.ok(r.motivos.some((m) => m.codigo === "BASE_REVISION_INVALIDA" && m.clasificacion === "rechazo"))

  const despues = servicio.snapshot()
  assert.equal(despues.revision, antes.revision)
  assert.equal(JSON.stringify(despues.proyecto), JSON.stringify(antes.proyecto))

  const discoDespuesBytes = readFileSync(rutaDocumento, "utf8")
  assert.equal(discoDespuesBytes, discoAntesBytes, "el disco no cambió NI UN BYTE")

  servicio.cerrar()
})
