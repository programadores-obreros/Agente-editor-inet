// Phase 3 — Vertical semántico #1, T2: validación SEMÁNTICA (contrato B3).
// COMPORTAMIENTO_INCOMPLETO / ACTUADOR_INVALIDO / SENSOR_INVALIDO: Path A (commitean,
// nunca clasificacion "rechazo"), `listo:false`, sin nombres de tipo en el validador.

import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, obtenerServicioDeProyecto, nuevoDir, nuevoIdProyecto, op, readiness, prepararProyectoConLed, GPIO_Y } from "./phase2-helpers.mjs"

const { cargarProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { validarProyecto } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { catalogo } = await import("./phase2-helpers.mjs")

const TRIADA = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }
const NUEVOS = ["COMPORTAMIENTO_INCOMPLETO", "ACTUADOR_INVALIDO", "SENSOR_INVALIDO"]

function preparar() {
  const directorio = nuevoDir("p3-sem")
  const idProyecto = nuevoIdProyecto("p3-sem")
  const { servicio, idComponente: led } = prepararProyectoConLed(directorio, idProyecto)
  let r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const pulsador = servicio.snapshot().proyecto.componentes.find((c) => c.tipo === "pulsador").id
  r = servicio.aplicar(op("AsignarPin", { componente: pulsador, terminal: "senal", pin: GPIO_Y }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  return { servicio, directorio, idProyecto, led, pulsador }
}
const motivosDe = (servicio, codigo) => servicio.snapshot().validacion.motivos.filter((m) => m.codigo === codigo)
function recargar(ctx) {
  ctx.servicio.cerrar()
  ctx.servicio = obtenerServicioDeProyecto({ directorio: ctx.directorio, idProyecto: ctx.idProyecto })
  return ctx.servicio
}
function set(ctx, comportamiento) {
  const r = ctx.servicio.aplicar(op("SetComportamiento", { comportamiento }, ctx.servicio.snapshot().revision))
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  return r
}

test("T2 BUG CONOCIDO: un pulsador como actuador ya no se acepta en silencio (ACTUADOR_INVALIDO, listo:false, Path A)", () => {
  const ctx = preparar()
  const antes = ctx.servicio.snapshot().revision
  set(ctx, { cuando: { sensor: ctx.pulsador, ...TRIADA }, entonces: { actuador: ctx.pulsador, accion: "encender" } })
  const snap = ctx.servicio.snapshot()
  assert.equal(snap.revision, antes + 1, "commitea (Path A)")
  const ms = motivosDe(ctx.servicio, "ACTUADOR_INVALIDO")
  assert.equal(ms.length, 1)
  const m = ms[0]
  assert.equal(m.categoria, "semantica")
  assert.equal(m.severidad, "blocking")
  assert.equal(m.clasificacion, "representable")
  assert.deepEqual(m.entidad, { tipo: "comportamiento", id: snap.proyecto.comportamientos[0].id })
  assert.deepEqual(m.datos, { componente: ctx.pulsador, clase: "entrada" })
  assert.equal(snap.validacion.readiness.listo, false)
  const rec = recargar(ctx).snapshot()
  assert.equal(rec.revision, snap.revision)
  assert.deepEqual(rec.validacion.motivos.filter((x) => x.codigo === "ACTUADOR_INVALIDO"), ms)
  ctx.servicio.cerrar()
})

const PARCIALES = [
  ["sólo sensor", (c) => ({ cuando: { sensor: c.pulsador } }), ["estado", "actuador", "salida"]],
  ["sólo actuador", (c) => ({ entonces: { actuador: c.led } }), ["sensor", "estado", "salida"]],
  ["sensor + triada", (c) => ({ cuando: { sensor: c.pulsador, ...TRIADA } }), ["actuador", "salida"]],
  ["actuador + acción", (c) => ({ entonces: { actuador: c.led, accion: "encender" } }), ["sensor", "estado"]],
]
for (const [nombre, forma, faltan] of PARCIALES) {
  test(`T2 COMPORTAMIENTO_INCOMPLETO (${nombre}): faltan exactos, blocking, representable, listo:false; completar lo hace desaparecer`, () => {
    const ctx = preparar()
    set(ctx, forma(ctx))
    const snap = ctx.servicio.snapshot()
    const id = snap.proyecto.comportamientos[0].id
    const ms = motivosDe(ctx.servicio, "COMPORTAMIENTO_INCOMPLETO")
    assert.equal(ms.length, 1)
    assert.equal(ms[0].categoria, "semantica")
    assert.equal(ms[0].severidad, "blocking")
    assert.equal(ms[0].clasificacion, "representable")
    assert.deepEqual(ms[0].entidad, { tipo: "comportamiento", id })
    assert.deepEqual(ms[0].datos, { faltan })
    assert.equal(snap.validacion.readiness.listo, false)
    assert.deepEqual(motivosDe(recargar(ctx), "COMPORTAMIENTO_INCOMPLETO"), ms, "tras recargar, mismo motivo")
    set(ctx, { id, cuando: { sensor: ctx.pulsador, ...TRIADA }, entonces: { actuador: ctx.led, accion: "encender" } })
    assert.equal(motivosDe(ctx.servicio, "COMPORTAMIENTO_INCOMPLETO").length, 0)
    // (el LED del fixture sigue pidiendo su resistencia: ese bloqueo es del circuito, no de la regla)
    assert.equal(ctx.servicio.snapshot().validacion.motivos.filter((m) => m.categoria === "semantica").length, 0, "la regla completa ya no bloquea")
    ctx.servicio.cerrar()
  })
}

test("T2 SENSOR_INVALIDO: un LED usado como sensor sin triada (sin capacidades) — blocking, representable, datos {componente}", () => {
  const ctx = preparar()
  set(ctx, { cuando: { sensor: ctx.led } })
  const ms = motivosDe(ctx.servicio, "SENSOR_INVALIDO")
  assert.equal(ms.length, 1)
  assert.equal(ms[0].categoria, "semantica")
  assert.equal(ms[0].severidad, "blocking")
  assert.equal(ms[0].clasificacion, "representable")
  assert.deepEqual(ms[0].datos, { componente: ctx.led })
  assert.equal(motivosDe(ctx.servicio, "SENSOR_INVALIDO").length, 1)
  assert.equal(ctx.servicio.snapshot().validacion.readiness.listo, false)
  ctx.servicio.cerrar()
})

test("T2 SENSOR_INVALIDO no se emite con la triada presente, ni para un sensor con capacidades", () => {
  const ctx = preparar()
  set(ctx, { cuando: { sensor: ctx.pulsador } })
  assert.equal(motivosDe(ctx.servicio, "SENSOR_INVALIDO").length, 0)
  ctx.servicio.cerrar()
})

test("T2 la regla de nivel completa pulsador -> LED no produce ninguno de los tres motivos y ningún motivo semántico bloquea", () => {
  const ctx = preparar()
  set(ctx, { cuando: { sensor: ctx.pulsador, ...TRIADA }, entonces: { actuador: ctx.led, accion: "encender" } })
  const snap = ctx.servicio.snapshot()
  for (const c of NUEVOS) assert.equal(motivosDe(ctx.servicio, c).length, 0, c)
  assert.equal(snap.validacion.motivos.filter((m) => m.categoria === "semantica").length, 0)
  ctx.servicio.cerrar()
})

test("T2 los tres motivos nunca llevan clasificacion rechazo y el lote commitea", () => {
  const ctx = preparar()
  const rev = ctx.servicio.snapshot().revision
  const r = ctx.servicio.aplicarTransaccion([
    op("SetComportamiento", { comportamiento: { cuando: { sensor: ctx.led } } }, rev),
    op("SetComportamiento", { comportamiento: { entonces: { actuador: ctx.pulsador, accion: "encender" } } }, rev),
  ])
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  const todos = ctx.servicio.snapshot().validacion.motivos.filter((m) => NUEVOS.includes(m.codigo))
  assert.ok(todos.length >= 3)
  for (const m of todos) assert.notEqual(m.clasificacion, "rechazo")
  ctx.servicio.cerrar()
})

test("T2 orden determinista: semánticos después de estructurales/técnicos; idempotente", () => {
  const ctx = preparar()
  set(ctx, { cuando: { sensor: ctx.led }, entonces: { actuador: ctx.pulsador } })
  const proyecto = ctx.servicio.snapshot().proyecto
  const a = validarProyecto(proyecto, catalogo)
  const b = validarProyecto(proyecto, catalogo)
  assert.deepEqual(a, b)
  const cats = a.map((m) => m.categoria)
  const idxSem = cats.indexOf("semantica")
  assert.ok(idxSem >= 0)
  assert.ok(cats.slice(idxSem).every((c) => c === "semantica" || !["estructural", "tecnica"].includes(c)), JSON.stringify(cats))
  ctx.servicio.cerrar()
})

test("T2 un documento cargado de disco con un actuador inválido CARGA y muestra ACTUADOR_INVALIDO (sin rechazo ni migración)", () => {
  const ctx = preparar()
  set(ctx, { cuando: { sensor: ctx.pulsador, ...TRIADA }, entonces: { actuador: ctx.led, accion: "encender" } })
  const doc = JSON.parse(JSON.stringify(ctx.servicio.snapshot().proyecto))
  doc.comportamientos[0].entonces.actuador = ctx.pulsador
  const r = cargarProyecto(doc)
  assert.equal(r.ok, true)
  assert.equal(r.proyecto.schemaVersion, "1.0.0")
  const ms = validarProyecto(r.proyecto, catalogo).filter((m) => m.codigo === "ACTUADOR_INVALIDO")
  assert.equal(ms.length, 1)
  assert.equal(readiness(r.proyecto).listo, false)
  ctx.servicio.cerrar()
})
