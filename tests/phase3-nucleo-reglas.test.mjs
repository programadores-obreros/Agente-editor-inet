// Phase 3 — Vertical semántico #1, T1 (núcleo): regla PARCIAL + `QuitarComportamiento`.
//
// Contrato: docs/programacion-intencion/PHASE_3_VERTICAL_1_CONTRACT.md §B2/§B4/§B5.
// Todo pasa por el Engine REAL (`obtenerServicioDeProyecto`, catálogo real, Almacen real
// sobre un directorio temporal) — nunca un motor armado a mano. Sin LLM, sin sleeps.

import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import {
  REPO,
  obtenerServicioDeProyecto,
  nuevoDir,
  nuevoIdProyecto,
  op,
  catalogo,
  prepararProyectoConLed,
  GPIO_Y,
} from "./phase2-helpers.mjs"

const { cargarProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { aplicarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { reemplazarSensor } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))

const UMBRAL_PRESIONADO = { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" }
const TRIADA_PRESIONADO = { capacidad: "estadoBooleano", comparador: ">=", umbral: UMBRAL_PRESIONADO }

/** ESP32 + LED (cmp-0, ánodo en GPIO4) + pulsador (cmp-1, señal en GPIO16). */
function prepararLedYPulsador() {
  const directorio = nuevoDir("p3-reglas")
  const idProyecto = nuevoIdProyecto("p3-reglas")
  const { servicio, idComponente: led } = prepararProyectoConLed(directorio, idProyecto)
  let r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  const pulsador = servicio.snapshot().proyecto.componentes.find((c) => c.tipo === "pulsador").id
  r = servicio.aplicar(op("AsignarPin", { componente: pulsador, terminal: "senal", pin: GPIO_Y }, servicio.snapshot().revision))
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  return { servicio, directorio, idProyecto, led, pulsador }
}

function recargar(ctx) {
  ctx.servicio.cerrar()
  ctx.servicio = obtenerServicioDeProyecto({ directorio: ctx.directorio, idProyecto: ctx.idProyecto })
  return ctx.servicio
}

function setRegla(servicio, comportamiento, baseRevision) {
  return servicio.aplicar(op("SetComportamiento", { comportamiento }, baseRevision ?? servicio.snapshot().revision))
}

/** Paso de preparación: la regla TIENE que commitear (si no, falla acá con el motivo real). */
function setOk(servicio, comportamiento) {
  const r = setRegla(servicio, comportamiento)
  assert.equal(r.ok, true, `preparación: SetComportamiento rechazado: ${JSON.stringify(r.motivos)}`)
  return r
}

const reglaCompleta = (ctx) => ({
  cuando: { sensor: ctx.pulsador, ...TRIADA_PRESIONADO },
  entonces: { actuador: ctx.led, accion: "encender" },
})

// ── A. reglas parciales: commit + persistencia + recarga idéntica ───────────────────

const PARCIALES = [
  { nombre: "sólo sensor", forma: (c) => ({ cuando: { sensor: c.pulsador } }) },
  { nombre: "sólo actuador", forma: (c) => ({ entonces: { actuador: c.led } }) },
  { nombre: "sensor + triada (sin entonces)", forma: (c) => ({ cuando: { sensor: c.pulsador, ...TRIADA_PRESIONADO } }) },
  { nombre: "actuador + acción (sin cuando)", forma: (c) => ({ entonces: { actuador: c.led, accion: "encender" } }) },
]

for (const caso of PARCIALES) {
  test(`T1 regla parcial (${caso.nombre}): commit por el Engine, revisión +1, persiste y recarga idéntica`, () => {
    const ctx = prepararLedYPulsador()
    const antes = ctx.servicio.snapshot().revision
    const r = setRegla(ctx.servicio, caso.forma(ctx))
    assert.equal(r.ok, true, JSON.stringify(r.motivos))
    const snap = ctx.servicio.snapshot()
    assert.equal(snap.revision, antes + 1)
    assert.equal(snap.proyecto.comportamientos.length, 1)
    const regla = snap.proyecto.comportamientos[0]
    assert.match(regla.id, /^beh-\d+$/)
    assert.deepEqual({ ...regla, id: undefined }, { ...caso.forma(ctx), id: undefined })

    const recargado = recargar(ctx).snapshot()
    assert.equal(recargado.revision, snap.revision)
    assert.deepEqual(recargado.proyecto.comportamientos, snap.proyecto.comportamientos, "PERSISTIBLE => RECARGABLE, misma regla y mismo id")
    ctx.servicio.cerrar()
  })
}

test("T1 regla de nivel completa pulsador -> LED (estadoBooleano >= 1, encender): round-trip", () => {
  const ctx = prepararLedYPulsador()
  const r = setRegla(ctx.servicio, reglaCompleta(ctx))
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  const regla = ctx.servicio.snapshot().proyecto.comportamientos[0]
  assert.deepEqual(regla.cuando, { sensor: ctx.pulsador, capacidad: "estadoBooleano", comparador: ">=", umbral: UMBRAL_PRESIONADO })
  assert.deepEqual(regla.entonces, { actuador: ctx.led, accion: "encender" })
  const recargado = recargar(ctx).snapshot()
  assert.deepEqual(recargado.proyecto.comportamientos, [regla])
  ctx.servicio.cerrar()
})

test("T1 completar una regla parcial con el mismo id es un reemplazo (mismo id, COMPORTAMIENTO_REEMPLAZADO)", () => {
  const ctx = prepararLedYPulsador()
  setOk(ctx.servicio, { cuando: { sensor: ctx.pulsador } })
  const id = ctx.servicio.snapshot().proyecto.comportamientos[0].id
  const r = setRegla(ctx.servicio, { id, ...reglaCompleta(ctx) })
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  const motivos = r.resultadosOperaciones.flatMap((x) => x.motivos)
  assert.ok(motivos.some((m) => m.codigo === "COMPORTAMIENTO_REEMPLAZADO"))
  const reglas = ctx.servicio.snapshot().proyecto.comportamientos
  assert.equal(reglas.length, 1)
  assert.equal(reglas[0].id, id)
  assert.ok(reglas[0].entonces && reglas[0].cuando.umbral)
  ctx.servicio.cerrar()
})

// ── C. id provisto inexistente => id del Engine ─────────────────────────────────────

test("T1 SetComportamiento con un id provisto que NO existe crea una regla nueva con id del Engine (beh-N)", () => {
  const ctx = prepararLedYPulsador()
  const r = setRegla(ctx.servicio, { id: "mi-regla-inventada", ...reglaCompleta(ctx) })
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  const reglas = ctx.servicio.snapshot().proyecto.comportamientos
  assert.equal(reglas.length, 1)
  assert.match(reglas[0].id, /^beh-\d+$/)
  assert.notEqual(reglas[0].id, "mi-regla-inventada")
  ctx.servicio.cerrar()
})

// ── B2. formas inválidas: rechazo en la operación Y en el cargador ──────────────────

const COMPLETA_PARA_DOC = (c) => reglaCompleta(c)

const INVALIDAS = [
  { nombre: "cuando = null", forma: (c) => ({ cuando: null, entonces: { actuador: c.led } }) },
  { nombre: "entonces = null", forma: (c) => ({ cuando: { sensor: c.pulsador }, entonces: null }) },
  { nombre: "campo sensor = null", forma: (c) => ({ cuando: { sensor: null }, entonces: { actuador: c.led } }) },
  { nombre: "campo actuador = null", forma: (c) => ({ cuando: { sensor: c.pulsador }, entonces: { actuador: null } }) },
  { nombre: "umbral = null", forma: (c) => ({ cuando: { sensor: c.pulsador, capacidad: "estadoBooleano", comparador: ">=", umbral: null } }) },
  { nombre: "cuando = {} (sub-objeto vacío)", forma: (c) => ({ cuando: {}, entonces: { actuador: c.led } }) },
  { nombre: "entonces = {} (sub-objeto vacío)", forma: (c) => ({ cuando: { sensor: c.pulsador }, entonces: {} }) },
  { nombre: "triada suelta: sólo capacidad", forma: (c) => ({ cuando: { sensor: c.pulsador, capacidad: "estadoBooleano" } }) },
  { nombre: "triada suelta: sólo comparador", forma: (c) => ({ cuando: { sensor: c.pulsador, comparador: ">=" } }) },
  { nombre: "triada suelta: sólo umbral", forma: (c) => ({ cuando: { sensor: c.pulsador, umbral: UMBRAL_PRESIONADO } }) },
  { nombre: "triada suelta: capacidad + comparador sin umbral", forma: (c) => ({ cuando: { sensor: c.pulsador, capacidad: "estadoBooleano", comparador: ">=" } }) },
  { nombre: "clave desconocida en la regla", forma: (c) => ({ ...COMPLETA_PARA_DOC(c), extra: 1 }) },
  { nombre: "clave desconocida en cuando", forma: (c) => ({ cuando: { sensor: c.pulsador, extra: 1 } }) },
  { nombre: "clave desconocida en entonces", forma: (c) => ({ entonces: { actuador: c.led, extra: 1 } }) },
  { nombre: "clave desconocida en umbral", forma: (c) => ({ cuando: { sensor: c.pulsador, ...TRIADA_PRESIONADO, umbral: { ...UMBRAL_PRESIONADO, extra: 1 } } }) },
]

for (const caso of INVALIDAS) {
  test(`T1 forma inválida (${caso.nombre}): la operación la rechaza sin mutar IR ni revisión`, () => {
    const ctx = prepararLedYPulsador()
    const antes = ctx.servicio.snapshot()
    const r = setRegla(ctx.servicio, caso.forma(ctx))
    assert.equal(r.ok, false, "debe rechazar")
    assert.equal(r.motivos.some((m) => m.codigo === "PAYLOAD_OPERACION_INVALIDO"), true, JSON.stringify(r.motivos))
    const despues = ctx.servicio.snapshot()
    assert.equal(despues.revision, antes.revision)
    assert.deepEqual(despues.proyecto, antes.proyecto)
    ctx.servicio.cerrar()
  })

  test(`T1 forma inválida (${caso.nombre}): la MISMA forma escrita en un documento la rechaza el cargador`, () => {
    const ctx = prepararLedYPulsador()
    const doc = JSON.parse(JSON.stringify(ctx.servicio.snapshot().proyecto))
    doc.comportamientos = [{ id: "beh-9", ...caso.forma(ctx) }]
    doc.siguienteIdLocal = 10
    const r = cargarProyecto(doc)
    assert.equal(r.ok, false, "el cargador debe rechazar")
    ctx.servicio.cerrar()
  })
}

test("T1 una regla totalmente vacía ({} / {comportamiento:{}}) se sigue rechazando; en un documento también", () => {
  const ctx = prepararLedYPulsador()
  const r = setRegla(ctx.servicio, {})
  assert.equal(r.ok, false)
  assert.equal(r.motivos.some((m) => m.codigo === "PAYLOAD_OPERACION_INVALIDO"), true)
  const doc = JSON.parse(JSON.stringify(ctx.servicio.snapshot().proyecto))
  doc.comportamientos = [{ id: "beh-9" }]
  doc.siguienteIdLocal = 10
  assert.equal(cargarProyecto(doc).ok, false)
  ctx.servicio.cerrar()
})

test("T1 documentos con reglas parciales válidas cargan (sensor sólo / actuador sólo / mixtas)", () => {
  const ctx = prepararLedYPulsador()
  const doc = JSON.parse(JSON.stringify(ctx.servicio.snapshot().proyecto))
  doc.comportamientos = [
    { id: "beh-7", cuando: { sensor: ctx.pulsador } },
    { id: "beh-8", entonces: { actuador: ctx.led } },
    { id: "beh-9", cuando: { sensor: ctx.pulsador, ...TRIADA_PRESIONADO }, entonces: { actuador: ctx.led, accion: "encender" } },
  ]
  doc.siguienteIdLocal = 10
  const r = cargarProyecto(doc)
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  assert.equal(r.proyecto.comportamientos.length, 3)
  ctx.servicio.cerrar()
})

test("T1 referencia rota en un slot parcial del documento sigue rechazándose al cargar (REFERENCIA_ROTA_AL_CARGAR)", () => {
  const ctx = prepararLedYPulsador()
  const doc = JSON.parse(JSON.stringify(ctx.servicio.snapshot().proyecto))
  doc.comportamientos = [{ id: "beh-9", entonces: { actuador: "cmp-99" } }]
  doc.siguienteIdLocal = 10
  const r = cargarProyecto(doc)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "REFERENCIA_ROTA_AL_CARGAR")
  ctx.servicio.cerrar()
})

test("T1 campos presentes en una regla parcial se siguen validando: referencia inexistente, enum, capacidad no declarada", () => {
  const ctx = prepararLedYPulsador()
  const base = ctx.servicio.snapshot().revision
  let r = setRegla(ctx.servicio, { cuando: { sensor: "cmp-99" } })
  assert.equal(r.ok, false)
  assert.ok(r.motivos.some((m) => m.codigo === "REFERENCIA_INEXISTENTE"))
  r = setRegla(ctx.servicio, { entonces: { actuador: "cmp-99" } })
  assert.equal(r.ok, false)
  assert.ok(r.motivos.some((m) => m.codigo === "REFERENCIA_INEXISTENTE"))
  r = setRegla(ctx.servicio, { entonces: { actuador: ctx.led, accion: "prender" } })
  assert.equal(r.ok, false)
  assert.ok(r.motivos.some((m) => m.codigo === "VALOR_ENUM_DESCONOCIDO"))
  r = setRegla(ctx.servicio, { cuando: { sensor: ctx.pulsador, capacidad: "temperatura", comparador: ">=", umbral: UMBRAL_PRESIONADO } })
  assert.equal(r.ok, false)
  assert.ok(r.motivos.some((m) => m.codigo === "CAPACIDAD_NO_DECLARADA"))
  assert.equal(ctx.servicio.snapshot().revision, base)
  ctx.servicio.cerrar()
})

// ── stale baseRevision ──────────────────────────────────────────────────────────────

test("T1 baseRevision desactualizada en SetComportamiento y QuitarComportamiento: BASE_REVISION_DESACTUALIZADA, nada cambia", () => {
  const ctx = prepararLedYPulsador()
  setOk(ctx.servicio, reglaCompleta(ctx))
  const snap = ctx.servicio.snapshot()
  const stale = snap.revision - 1
  let r = setRegla(ctx.servicio, { cuando: { sensor: ctx.pulsador } }, stale)
  assert.equal(r.ok, false)
  assert.ok(r.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA"))
  r = ctx.servicio.aplicar(op("QuitarComportamiento", { comportamiento: snap.proyecto.comportamientos[0].id }, stale))
  assert.equal(r.ok, false)
  assert.ok(r.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA"), JSON.stringify(r.motivos))
  assert.deepEqual(ctx.servicio.snapshot().proyecto, snap.proyecto)
  ctx.servicio.cerrar()
})

// ── D. QuitarComportamiento ─────────────────────────────────────────────────────────

test("T1 QuitarComportamiento existente: regla ausente tras recargar, resto intacto, info COMPORTAMIENTO_QUITADO con la regla completa", () => {
  const ctx = prepararLedYPulsador()
  setOk(ctx.servicio, { cuando: { sensor: ctx.pulsador } })
  setOk(ctx.servicio, reglaCompleta(ctx))
  const antes = ctx.servicio.snapshot()
  assert.equal(antes.proyecto.comportamientos.length, 2)
  const [quitar, queda] = antes.proyecto.comportamientos

  const r = ctx.servicio.aplicar(op("QuitarComportamiento", { comportamiento: quitar.id }, antes.revision))
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  const quitado = r.resultadosOperaciones.flatMap((x) => x.motivos).find((m) => m.codigo === "COMPORTAMIENTO_QUITADO")
  assert.ok(quitado, "info COMPORTAMIENTO_QUITADO")
  assert.equal(quitado.severidad, "info")
  assert.equal(quitado.clasificacion, undefined)
  assert.deepEqual(quitado.datos, { comportamiento: quitar.id, reglaQuitada: quitar })

  const despues = ctx.servicio.snapshot()
  assert.equal(despues.revision, antes.revision + 1)
  assert.deepEqual(despues.proyecto.comportamientos, [queda])
  assert.deepEqual(despues.proyecto.componentes, antes.proyecto.componentes)
  assert.deepEqual(despues.proyecto.conexiones, antes.proyecto.conexiones)
  assert.equal(despues.proyecto.placa, antes.proyecto.placa)

  const recargado = recargar(ctx).snapshot()
  assert.deepEqual(recargado.proyecto.comportamientos, [queda])
  assert.deepEqual(recargado.proyecto.componentes, antes.proyecto.componentes)
  ctx.servicio.cerrar()
})

test("T1 QuitarComportamiento de la regla por referencia: las demás reglas conservan su referencia en el IR puro", () => {
  const ctx = prepararLedYPulsador()
  setOk(ctx.servicio, { cuando: { sensor: ctx.pulsador } })
  setOk(ctx.servicio, reglaCompleta(ctx))
  const proyecto = ctx.servicio.snapshot().proyecto
  const [a, b] = proyecto.comportamientos
  const r = aplicarOperacion(proyecto, { idOperacion: "x", actor: "agente", baseRevision: proyecto.revision, tipo: "QuitarComportamiento", payload: { comportamiento: a.id } }, catalogo)
  assert.equal(r.proyecto.comportamientos.length, 1)
  assert.equal(r.proyecto.comportamientos[0], b, "misma referencia")
  assert.equal(r.proyecto.componentes, proyecto.componentes)
  ctx.servicio.cerrar()
})

test("T1 QuitarComportamiento inexistente: REFERENCIA_INEXISTENTE {comportamiento}, nada cambia", () => {
  const ctx = prepararLedYPulsador()
  const antes = ctx.servicio.snapshot()
  const r = ctx.servicio.aplicar(op("QuitarComportamiento", { comportamiento: "beh-99" }, antes.revision))
  assert.equal(r.ok, false)
  const m = r.motivos.find((x) => x.codigo === "REFERENCIA_INEXISTENTE")
  assert.ok(m, JSON.stringify(r.motivos))
  assert.deepEqual(m.datos, { comportamiento: "beh-99" })
  const despues = ctx.servicio.snapshot()
  assert.equal(despues.revision, antes.revision)
  assert.deepEqual(despues.proyecto, antes.proyecto)
  ctx.servicio.cerrar()
})

test("T1 QuitarComportamiento: payload con forma incorrecta o claves extra => PAYLOAD_OPERACION_INVALIDO", () => {
  const ctx = prepararLedYPulsador()
  setOk(ctx.servicio, reglaCompleta(ctx))
  const id = ctx.servicio.snapshot().proyecto.comportamientos[0].id
  const revision = ctx.servicio.snapshot().revision
  for (const payload of [null, {}, { comportamiento: 7 }, { comportamiento: null }, { comportamiento: id, extra: true }, { id }, []]) {
    const r = ctx.servicio.aplicar(op("QuitarComportamiento", payload, revision))
    assert.equal(r.ok, false, JSON.stringify(payload))
    assert.ok(r.motivos.some((m) => m.codigo === "PAYLOAD_OPERACION_INVALIDO"), `${JSON.stringify(payload)} -> ${JSON.stringify(r.motivos)}`)
  }
  assert.equal(ctx.servicio.snapshot().revision, revision)
  ctx.servicio.cerrar()
})

test("T1 lote atómico con un QuitarComportamiento válido y una operación que falla: rollback completo", () => {
  const ctx = prepararLedYPulsador()
  setOk(ctx.servicio, reglaCompleta(ctx))
  const antes = ctx.servicio.snapshot()
  const id = antes.proyecto.comportamientos[0].id
  const r = ctx.servicio.aplicarTransaccion([
    op("QuitarComportamiento", { comportamiento: id }, antes.revision),
    op("QuitarComportamiento", { comportamiento: "beh-99" }, antes.revision),
  ])
  assert.equal(r.ok, false)
  const despues = ctx.servicio.snapshot()
  assert.equal(despues.revision, antes.revision)
  assert.deepEqual(despues.proyecto, antes.proyecto)
  assert.deepEqual(recargar(ctx).snapshot().proyecto, antes.proyecto)
  ctx.servicio.cerrar()
})

test("T1 dry-run (proponer) de QuitarComportamiento no muta ni persiste", () => {
  const ctx = prepararLedYPulsador()
  setOk(ctx.servicio, reglaCompleta(ctx))
  const antes = ctx.servicio.snapshot()
  const id = antes.proyecto.comportamientos[0].id
  const r = ctx.servicio.proponer([op("QuitarComportamiento", { comportamiento: id }, antes.revision)])
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  assert.deepEqual(ctx.servicio.snapshot().proyecto, antes.proyecto)
  assert.deepEqual(recargar(ctx).snapshot().proyecto, antes.proyecto)
  ctx.servicio.cerrar()
})

// ── E. QuitarComponente referenciado por una regla parcial (HD-P3D-4 = A) ───────────

for (const [nombre, slot, campo] of [
  ["sólo sensor", (c) => ({ cuando: { sensor: c.pulsador } }), "pulsador"],
  ["sólo actuador", (c) => ({ entonces: { actuador: c.led } }), "led"],
]) {
  test(`T1 QuitarComponente de un componente referenciado por una regla parcial (${nombre}): REMOCION_CON_DEPENDIENTES; tras QuitarComportamiento se permite`, () => {
    const ctx = prepararLedYPulsador()
    setOk(ctx.servicio, slot(ctx))
    const objetivo = ctx[campo]
    // el pin asignado no es una conexión: se desasigna para aislar la dependencia de la regla
    const terminal = campo === "led" ? "anodo" : "senal"
    let r = ctx.servicio.aplicar(op("AsignarPin", { componente: objetivo, terminal, pin: null }, ctx.servicio.snapshot().revision))
    assert.equal(r.ok, true, JSON.stringify(r.motivos))
    const antes = ctx.servicio.snapshot()
    r = ctx.servicio.aplicar(op("QuitarComponente", { componente: objetivo }, antes.revision))
    assert.equal(r.ok, false)
    assert.ok(r.motivos.some((m) => m.codigo === "REMOCION_CON_DEPENDIENTES"), JSON.stringify(r.motivos))
    assert.deepEqual(ctx.servicio.snapshot().proyecto, antes.proyecto)

    r = ctx.servicio.aplicar(op("QuitarComportamiento", { comportamiento: antes.proyecto.comportamientos[0].id }, antes.revision))
    assert.equal(r.ok, true, JSON.stringify(r.motivos))
    r = ctx.servicio.aplicar(op("QuitarComponente", { componente: objetivo }, ctx.servicio.snapshot().revision))
    assert.equal(r.ok, true, JSON.stringify(r.motivos))
    assert.equal(ctx.servicio.snapshot().proyecto.componentes.some((c) => c.id === objetivo), false)
    ctx.servicio.cerrar()
  })
}

// ── B. dereferencias que no deben lanzar con slots ausentes ─────────────────────────

test("T1 CambiarComponente sobre el sensor de una regla parcial SIN cuando / sólo con sensor no lanza", () => {
  const ctx = prepararLedYPulsador()
  setOk(ctx.servicio, { entonces: { actuador: ctx.led, accion: "encender" } })
  setOk(ctx.servicio, { cuando: { sensor: ctx.pulsador } })
  const proyecto = ctx.servicio.snapshot().proyecto
  let r
  assert.doesNotThrow(() => {
    r = aplicarOperacion(proyecto, { idOperacion: "cc", actor: "agente", baseRevision: proyecto.revision, tipo: "CambiarComponente", payload: { componente: ctx.pulsador, tipoNuevo: "pulsador" } }, catalogo)
  })
  assert.equal(r.motivos.some((m) => m.categoria === "operacion" && m.clasificacion === "rechazo"), false, JSON.stringify(r.motivos))
  // la regla sin cuando no se toca: misma referencia
  const sinCuando = proyecto.comportamientos.find((b) => !b.cuando)
  assert.ok(r.proyecto.comportamientos.includes(sinCuando))
  ctx.servicio.cerrar()
})

test("T1 reemplazarSensor con una regla sin cuando (o sin triada) devuelve la MISMA referencia, sin motivo", () => {
  const compPulsador = catalogo.obtenerComponente("pulsador")
  const sinCuando = { id: "beh-0", entonces: { actuador: "cmp-0", accion: "encender" } }
  const soloSensor = { id: "beh-1", cuando: { sensor: "cmp-1" } }
  for (const regla of [sinCuando, soloSensor]) {
    let r
    assert.doesNotThrow(() => {
      r = reemplazarSensor(regla, compPulsador, catalogo)
    })
    assert.equal(r.comportamiento, regla)
    assert.equal(r.motivo, null)
  }
})

test("T1 las validaciones (estructural + técnica) toleran slots ausentes y el proyecto sigue persistible", () => {
  const ctx = prepararLedYPulsador()
  for (const forma of [{ cuando: { sensor: ctx.pulsador } }, { entonces: { actuador: ctx.led } }, { cuando: { sensor: ctx.pulsador, ...TRIADA_PRESIONADO } }]) {
    const r = setRegla(ctx.servicio, forma)
    assert.equal(r.ok, true, JSON.stringify(r.motivos))
  }
  const snap = ctx.servicio.snapshot()
  assert.equal(snap.proyecto.comportamientos.length, 3)
  assert.ok(Array.isArray(snap.validacion.motivos))
  assert.equal(recargar(ctx).snapshot().proyecto.comportamientos.length, 3)
  ctx.servicio.cerrar()
})
