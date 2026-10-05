// Multi-Rule Safety — Implementation #1 (Design Gate #1 aprobado, modelo B).
//
// En el modelo LEVEL, cada actuador tiene como máximo UN propietario semántico de su
// estado sostenido. La propiedad se DERIVA del IR por referencia (`entonces.actuador`),
// aunque la regla esté incompleta. Dos o más reglas sobre el mismo actuador → cada una
// recibe MULTIPLES_AUTORIDADES_ACTUADOR (blocking, representable): se persiste, recarga
// y edita; el proyecto queda no-listo. Sin prioridades, sin orden, sin last-wins, sin
// razonar equivalencia de condiciones.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { CONOCIMIENTO_ACTIVO } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { validarProyecto } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default

const K = CONOCIMIENTO_ACTIVO
const CODIGO = "MULTIPLES_AUTORIDADES_ACTUADOR"
const PRESIONADO = K.estadosDeEntrada("pulsador").find((e) => e.etiqueta === "presionado").condicion
const SUELTO = K.estadosDeEntrada("pulsador").find((e) => e.etiqueta === "suelto").condicion
const CALOR = { capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }

// ── fixtures ────────────────────────────────────────────────────────────────────────

let n = 0
function aplicar(servicio, tipo, payload, baseRevision) {
  return servicio.aplicar({ idOperacion: `mr-${n++}`, actor: "agente", baseRevision: baseRevision ?? servicio.snapshot().revision, tipo, payload })
}
function ok(servicio, tipo, payload) {
  const r = aplicar(servicio, tipo, payload)
  assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos ?? r)}`)
  return r
}

/** ESP32 + pulsador (cmp-0) + LED (cmp-1) + LED 2 (cmp-2) + 2 resistencias + DHT22 (cmp-5). Listo, sin reglas. */
function proyecto() {
  const directorio = nuevoDir("multi-regla")
  const idProyecto = nuevoIdProyecto("mr")
  const servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  ok(servicio, "SetPlaca", { placa: "esp32-devkit-v1" })
  for (const tipo of ["pulsador", "led", "led", "resistencia", "resistencia", "dht22"]) ok(servicio, "AgregarComponente", { tipo })
  ok(servicio, "AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO4" })
  ok(servicio, "AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" })
  ok(servicio, "AsignarPin", { componente: "cmp-2", terminal: "anodo", pin: "GPIO19" })
  ok(servicio, "AsignarPin", { componente: "cmp-5", terminal: "senal", pin: "GPIO27" })
  ok(servicio, "Conectar", { desde: { componente: "cmp-3", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } })
  ok(servicio, "Conectar", { desde: { componente: "cmp-4", terminal: "a" }, hasta: { componente: "cmp-2", terminal: "anodo" } })
  assert.equal(servicio.snapshot().validacion.readiness.listo, true, "fixture listo")
  return { servicio, directorio, idProyecto }
}
const regla = (sensor, cuando, actuador, accion) => ({ comportamiento: { ...(cuando ? { cuando: { sensor, ...cuando } } : sensor ? { cuando: { sensor } } : {}), entonces: { actuador, ...(accion ? { accion } : {}) } } })
const deAutoridad = (s) => s.validacion.motivos.filter((m) => m.codigo === CODIGO)
const reglasEnConflicto = (s) => deAutoridad(s).map((m) => m.entidad.id).sort()

function conflicto(reglas, verificar) {
  const { servicio, directorio, idProyecto } = proyecto()
  const resultados = reglas.map((r) => aplicar(servicio, "SetComportamiento", r))
  for (const r of resultados) assert.equal(r.ok, true, `la operación NO se rechaza por autoridad: ${JSON.stringify(r.motivos)}`)
  const s = servicio.snapshot()
  try {
    verificar?.(s, servicio)
  } finally {
    servicio.cerrar()
  }
  return { s, directorio, idProyecto }
}

function exigirConflicto(s, ids, actuador) {
  const motivos = deAutoridad(s)
  assert.deepEqual(reglasEnConflicto(s), [...ids].sort(), JSON.stringify(s.validacion.motivos))
  for (const m of motivos) {
    assert.equal(m.severidad, "blocking")
    assert.equal(m.clasificacion, "representable")
    assert.equal(m.entidad.tipo, "comportamiento")
    assert.equal(m.datos.actuador, actuador)
    assert.equal(m.datos.comportamiento, m.entidad.id)
    assert.deepEqual(m.datos.otras, ids.filter((x) => x !== m.entidad.id).sort())
  }
  assert.equal(s.validacion.readiness.invalido, true)
  assert.equal(s.validacion.readiness.listo, false)
}

// ════════════════════════════════════════════════════════════════════════════════════
// Casos 1–12 del Design Gate
// ════════════════════════════════════════════════════════════════════════════════════

test("1: presionado→LED encendido + presionado→LED apagado → ambas persisten, autoridad múltiple, no listo", () => {
  const { directorio, idProyecto } = conflicto([regla("cmp-0", PRESIONADO, "cmp-1", "encender"), regla("cmp-0", PRESIONADO, "cmp-1", "apagar")], (s) => {
    assert.equal(s.proyecto.comportamientos.length, 2)
    exigirConflicto(s, s.proyecto.comportamientos.map((b) => b.id), "cmp-1")
  })
  const guardado = JSON.parse(readFileSync(join(directorio, `${idProyecto}.json`), "utf8"))
  assert.equal(guardado.comportamientos.length, 2, "las dos reglas están en disco")
})

test("2: presionado→encendido + suelto→apagado (equivalentes) → igual es autoridad múltiple (sin razonar equivalencia)", () => {
  conflicto([regla("cmp-0", PRESIONADO, "cmp-1", "encender"), regla("cmp-0", SUELTO, "cmp-1", "apagar")], (s) => exigirConflicto(s, s.proyecto.comportamientos.map((b) => b.id), "cmp-1"))
})

test("3: presionado→encendido + temperatura>30→encendido → autoridad múltiple", () => {
  conflicto([regla("cmp-0", PRESIONADO, "cmp-1", "encender"), regla("cmp-5", CALOR, "cmp-1", "encender")], (s) => exigirConflicto(s, s.proyecto.comportamientos.map((b) => b.id), "cmp-1"))
})

test("4: presionado→encendido + temperatura>30→apagado → autoridad múltiple", () => {
  conflicto([regla("cmp-0", PRESIONADO, "cmp-1", "encender"), regla("cmp-5", CALOR, "cmp-1", "apagar")], (s) => exigirConflicto(s, s.proyecto.comportamientos.map((b) => b.id), "cmp-1"))
})

test("5/12: reglas sobre LED y LED 2 → válido, sin motivo de autoridad y SIN aviso genérico", () => {
  conflicto([regla("cmp-0", PRESIONADO, "cmp-1", "encender"), regla("cmp-0", SUELTO, "cmp-2", "encender")], (s) => {
    assert.deepEqual(deAutoridad(s), [])
    assert.equal(s.validacion.readiness.listo, true)
    const plan = planDePintado(s.vista)
    assert.equal(plan.filter((i) => i.tipo === "reglaAviso").length, 0, "varias reglas sobre actuadores distintos no llevan aviso")
    assert.ok(!JSON.stringify(plan).includes("no analiza si se contradicen"))
  })
})

test("6: regla incompleta con actuador=LED + regla completa sobre LED → conflicto + incompleta", () => {
  conflicto([regla(null, null, "cmp-1"), regla("cmp-0", PRESIONADO, "cmp-1", "encender")], (s) => {
    exigirConflicto(s, s.proyecto.comportamientos.map((b) => b.id), "cmp-1")
    assert.ok(s.validacion.motivos.some((m) => m.codigo === "COMPORTAMIENTO_INCOMPLETO"))
  })
})

test("7: dos reglas incompletas que referencian el LED → conflicto (la propiedad es por referencia)", () => {
  conflicto([regla(null, null, "cmp-1"), regla(null, null, "cmp-1", "apagar")], (s) => exigirConflicto(s, s.proyecto.comportamientos.map((b) => b.id), "cmp-1"))
})

test("8: editar el actuador de una regla hacia un LED que ya tiene dueño → commitea y aparece el conflicto", () => {
  const { servicio } = proyecto()
  try {
    ok(servicio, "SetComportamiento", regla("cmp-0", PRESIONADO, "cmp-1", "encender"))
    ok(servicio, "SetComportamiento", regla("cmp-0", SUELTO, "cmp-2", "encender"))
    assert.deepEqual(deAutoridad(servicio.snapshot()), [])
    const [, segunda] = servicio.snapshot().proyecto.comportamientos
    const r = aplicar(servicio, "SetComportamiento", { comportamiento: { ...segunda, entonces: { ...segunda.entonces, actuador: "cmp-1" } } })
    assert.equal(r.ok, true, "edición representable, sin rollback")
    exigirConflicto(servicio.snapshot(), servicio.snapshot().proyecto.comportamientos.map((b) => b.id), "cmp-1")
  } finally {
    servicio.cerrar()
  }
})

test("9/22: quitar un dueño hace desaparecer el conflicto; después se puede crear un dueño nuevo", () => {
  const { servicio } = proyecto()
  try {
    ok(servicio, "SetComportamiento", regla("cmp-0", PRESIONADO, "cmp-1", "encender"))
    ok(servicio, "SetComportamiento", regla("cmp-0", PRESIONADO, "cmp-1", "apagar"))
    const [primera, segunda] = servicio.snapshot().proyecto.comportamientos
    assert.equal(deAutoridad(servicio.snapshot()).length, 2)
    ok(servicio, "QuitarComportamiento", { comportamiento: segunda.id })
    assert.deepEqual(deAutoridad(servicio.snapshot()), [])
    assert.equal(servicio.snapshot().validacion.readiness.listo, true)
    ok(servicio, "QuitarComportamiento", { comportamiento: primera.id })
    ok(servicio, "SetComportamiento", regla("cmp-0", SUELTO, "cmp-1", "apagar"))
    assert.deepEqual(deAutoridad(servicio.snapshot()), [])
    assert.equal(servicio.snapshot().validacion.readiness.listo, true)
  } finally {
    servicio.cerrar()
  }
})

test("10/14: documento persistido con dos dueños → recarga, mismo diagnóstico, no listo, sin reescritura", () => {
  const { s, directorio, idProyecto } = conflicto([regla("cmp-0", PRESIONADO, "cmp-1", "encender"), regla("cmp-5", CALOR, "cmp-1", "apagar")])
  const ruta = join(directorio, `${idProyecto}.json`)
  const antes = readFileSync(ruta, "utf8")
  const reabierto = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  try {
    const r = reabierto.snapshot()
    assert.deepEqual(r.proyecto.comportamientos, s.proyecto.comportamientos, "no se reescribe ninguna regla")
    assert.deepEqual(deAutoridad(r), deAutoridad(s), "diagnóstico idéntico tras recargar")
    assert.equal(r.validacion.readiness.listo, false)
    // editable: corregir el actuador de una de las dos resuelve el conflicto
    const [, segunda] = r.proyecto.comportamientos
    ok(reabierto, "SetComportamiento", { comportamiento: { ...segunda, entonces: { ...segunda.entonces, actuador: "cmp-2" } } })
    assert.deepEqual(deAutoridad(reabierto.snapshot()), [])
  } finally {
    reabierto.cerrar()
  }
  assert.ok(antes.includes('"cmp-1"'), "el documento original tenía los dos dueños")
})

// Numeric Conditions S1 + CK-REQ-N1: la regla del DHT22 ya no se proyecta como «avanzada» sino
// como condición numérica; el conflicto de autoridad es el mismo.
test("11: condición numérica (DHT22) + condición común sobre el mismo actuador → conflicto", () => {
  conflicto([regla("cmp-5", CALOR, "cmp-1", "encender"), regla("cmp-0", PRESIONADO, "cmp-1", "encender")], (s) => {
    exigirConflicto(s, s.proyecto.comportamientos.map((b) => b.id), "cmp-1")
    const numerica = s.vista.reglas.find((r) => r.frase.estado?.clave === "numerica")
    assert.ok(numerica.motivos.some((m) => m.codigo === CODIGO), "la regla numérica también lo muestra")
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
// 13–17: determinismo, catálogo y concurrencia
// ════════════════════════════════════════════════════════════════════════════════════

test("13: permutar el orden de las reglas da EXACTAMENTE los mismos motivos", () => {
  conflicto([regla("cmp-0", PRESIONADO, "cmp-1", "encender"), regla("cmp-5", CALOR, "cmp-1", "apagar"), regla("cmp-0", SUELTO, "cmp-2", "encender")], (s) => {
    const invertido = { ...s.proyecto, comportamientos: [...s.proyecto.comportamientos].reverse() }
    assert.deepEqual(validarProyecto(invertido, K.catalogo), validarProyecto(s.proyecto, K.catalogo))
  })
})

test("15: con desfase de catálogo (createdWith viejo) el diagnóstico de autoridad es el mismo", () => {
  const { s, directorio, idProyecto } = conflicto([regla("cmp-0", PRESIONADO, "cmp-1", "encender"), regla("cmp-0", PRESIONADO, "cmp-1", "apagar")])
  const ruta = join(directorio, `${idProyecto}.json`)
  writeFileSync(ruta, JSON.stringify({ ...JSON.parse(readFileSync(ruta, "utf8")), catalogoHash: "0".repeat(64) }))
  const reabierto = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  try {
    const r = reabierto.snapshot()
    assert.ok(r.validacion.motivos.some((m) => m.codigo === "CATALOGO_CAMBIO_DETECTADO"))
    assert.deepEqual(deAutoridad(r), deAutoridad(s))
  } finally {
    reabierto.cerrar()
  }
})

test("16: con un actuador SIN complemento declarado, la autoridad múltiple se detecta igual", () => {
  const soloEncender = construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes: COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === "led" ? { ...c, acciones: ["encender"] } : c)), placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }, sha256Hex)
  conflicto([regla("cmp-0", PRESIONADO, "cmp-1", "encender"), regla("cmp-0", SUELTO, "cmp-1", "encender")], (s) => {
    const motivos = validarProyecto(s.proyecto, soloEncender).filter((m) => m.codigo === CODIGO)
    assert.deepEqual(motivos.map((m) => m.entidad.id).sort(), s.proyecto.comportamientos.map((b) => b.id).sort())
    // la traza tampoco afirma un reposo (no hay complemento y además hay conflicto)
    const vista = proyectarVista(s.proyecto, soloEncender)
    for (const r of vista.reglas) assert.ok(!r.traza || !/\(reposo\)/.test(r.traza.ramas.join(" ")))
  })
})

test("17: baseRevision obsoleta se sigue rechazando igual (sin cambios por este contrato)", () => {
  const { servicio } = proyecto()
  try {
    ok(servicio, "SetComportamiento", regla("cmp-0", PRESIONADO, "cmp-1", "encender"))
    const revision = servicio.snapshot().revision
    const r = aplicar(servicio, "SetComportamiento", regla("cmp-0", PRESIONADO, "cmp-1", "apagar"), revision - 1)
    assert.equal(r.ok, false)
    assert.ok(r.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA"))
    assert.equal(servicio.snapshot().revision, revision)
    assert.equal(servicio.snapshot().proyecto.comportamientos.length, 1)
  } finally {
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 18–19: proyección
// ════════════════════════════════════════════════════════════════════════════════════

test("18/19: en conflicto la frase sigue visible, pero la traza NO afirma el reposo ni elige ganador", () => {
  conflicto([regla("cmp-0", PRESIONADO, "cmp-1", "encender"), regla("cmp-0", SUELTO, "cmp-1", "apagar")], (s) => {
    const [r1, r2] = s.vista.reglas
    assert.equal(r1.texto, "Mientras el Pulsador esté presionado, el LED está encendido.")
    assert.equal(r2.texto, "Mientras el Pulsador esté suelto, el LED está apagado.")
    for (const r of [r1, r2]) {
      const texto = r.traza.ramas.join(" ")
      assert.doesNotMatch(texto, /\(reposo\)/, "no se afirma el reposo derivado")
      assert.match(texto, /otra regla también intenta gobernarlo/)
      assert.doesNotMatch(texto, /gana|prioridad|última/i)
      assert.ok(r.motivos.some((m) => m.codigo === CODIGO), "la regla muestra su motivo")
    }
    const explicacion = s.vista.motivos.find((m) => m.codigo === CODIGO).explicacion
    assert.equal(explicacion, "Hay más de una regla que intenta decidir cómo queda el LED. Por ahora, cada salida puede tener una sola regla. Revisá esas reglas y dejá una sola para el LED.")
    assert.doesNotMatch(explicacion, /gana|prioridad/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
// 20–21: agente
// ════════════════════════════════════════════════════════════════════════════════════

async function herramienta(directorio, args) {
  return JSON.parse(await proyectoFisico.execute(args, { directory: directorio }))
}

test("20: intención de REEMPLAZO → el agente edita la regla dueña por su id (sigue habiendo un solo dueño)", async () => {
  const directorio = nuevoDir("mr-agente")
  let l = await herramienta(directorio, { accion: "leer" })
  const pasos = [
    { tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } },
    { tipo: "AgregarComponente", payload: { tipo: "pulsador" } },
    { tipo: "AgregarComponente", payload: { tipo: "led" } },
  ]
  let r = await herramienta(directorio, { accion: "aplicar", baseRevision: l.revision, operaciones: pasos })
  assert.equal(r.ok, true)
  l = await herramienta(directorio, { accion: "leer" })
  r = await herramienta(directorio, { accion: "aplicar", baseRevision: l.revision, operaciones: [{ tipo: "SetComportamiento", payload: regla("cmp-0", PRESIONADO, "cmp-1", "encender") }] })
  assert.equal(r.ok, true)
  // "cambiá: que se apague mientras lo aprieto" → `leer` da el id de la regla dueña del LED
  l = await herramienta(directorio, { accion: "leer" })
  const duena = l.reglas.find((x) => x.frase.actuador?.id === "cmp-1")
  assert.ok(duena?.id, "leer expone la regla dueña del actuador con su id")
  r = await herramienta(directorio, { accion: "aplicar", baseRevision: l.revision, operaciones: [{ tipo: "SetComportamiento", payload: { comportamiento: { id: duena.id, ...regla("cmp-0", PRESIONADO, "cmp-1", "apagar").comportamiento } } }] })
  assert.equal(r.ok, true)
  assert.ok(!r.motivos.some((m) => m.codigo === CODIGO), "reemplazar no crea un segundo dueño")
  l = await herramienta(directorio, { accion: "leer" })
  assert.equal(l.reglas.length, 1)
  assert.equal(l.reglas[0].texto, "Mientras el Pulsador esté presionado, el LED está apagado.")
  // guía del agente: reemplazo → editar por id
  const guia = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
  assert.match(guia, /REEMPLAZAR[\s\S]{0,400}id/)
})

test("21: intención ADITIVA → nunca un segundo dueño en silencio: la guía lo prohíbe y, si ocurre, la tool lo devuelve como motivo", async () => {
  const guia = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
  assert.match(guia, /un solo comportamiento[\s\S]{0,80}por (actuador|salida)/i, "explica el límite actual")
  assert.match(guia, /no (crees|agregues)\s+una\s+segunda\s+regla/i, "prohíbe crear un segundo dueño sin decirlo")
  // Control determinista: si una segunda regla sobre el mismo LED llega igual, el resultado
  // de `aplicar` trae MULTIPLES_AUTORIDADES_ACTUADOR (no puede quedar en silencio).
  const directorio = nuevoDir("mr-agente-aditivo")
  let l = await herramienta(directorio, { accion: "leer" })
  let r = await herramienta(directorio, { accion: "aplicar", baseRevision: l.revision, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }, { tipo: "AgregarComponente", payload: { tipo: "pulsador" } }, { tipo: "AgregarComponente", payload: { tipo: "led" } }, { tipo: "SetComportamiento", payload: regla("cmp-0", PRESIONADO, "cmp-1", "encender") }] })
  assert.equal(r.ok, true)
  l = await herramienta(directorio, { accion: "leer" })
  r = await herramienta(directorio, { accion: "aplicar", baseRevision: l.revision, operaciones: [{ tipo: "SetComportamiento", payload: regla("cmp-0", SUELTO, "cmp-1", "encender") }] })
  assert.equal(r.ok, true, "representable: no se rechaza")
  assert.ok(r.motivos.some((m) => m.codigo === CODIGO), `el agente lo ve en la respuesta: ${JSON.stringify(r.motivos)}`)
})
