// Numeric Conditions — S2 Implementation #1: crear una condición numérica desde cero.
//
// Design Gate #1 aprobado: OD-1 (sólo el GRUPO atómico es efímero; la regla nace con el primer
// slot persistible, B2/B7 sin cambios), OD-2 (cambiar la unidad en el borrador vacía el número),
// OD-3 (límite de UI = 1 regla), OD-4 (nunca se reintenta solo tras stale).
//
// Todo contra el Engine real (servicio-con-vista), la fachada real de Component Knowledge y el
// controlador real de reglas (el ÚNICO dueño del borrador, compartido por la frase y Blockly).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"
import { fabricarBlockly } from "./phase3-blockly-fake.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearControladorReglas, AVISO_BORRADOR_DESCARTADO } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))
const { planDePintado, TEXTO_SIN_ENVIAR } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { crearVistaLogica } = await import(join(REPO, "opencode/vista-fisica/web/vista-logica-ui.js"))

// ── fixture: ESP32 + DHT22 cmp-0 + LED cmp-1 + NTC cmp-2 + DHT22 2 cmp-3 + pulsador cmp-4 ──

let n = 0
function aplicar(servicio, tipo, payload, baseRevision) {
  return servicio.aplicar({ idOperacion: `s2-${n++}`, actor: "agente", baseRevision: baseRevision ?? servicio.snapshot().revision, tipo, payload })
}
function ok(servicio, tipo, payload) {
  const r = aplicar(servicio, tipo, payload)
  assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos ?? r)}`)
  return r
}
function proyecto(tipos = ["dht22", "led", "ntc", "dht22", "pulsador"]) {
  const directorio = nuevoDir("numericas-s2")
  const idProyecto = nuevoIdProyecto("s2")
  const servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  ok(servicio, "SetPlaca", { placa: "esp32-devkit-v1" })
  for (const tipo of tipos) ok(servicio, "AgregarComponente", { tipo })
  return { servicio, directorio, idProyecto }
}

/** Controlador REAL de la página, con el Engine real detrás. `enviar` se puede sustituir para
 * simular un rechazo; `snapshot` se puede congelar para simular un snapshot viejo (stale). */
function harness(ctx, { enviar } = {}) {
  let congelado = null
  const obtenerSnapshot = () => congelado ?? ctx.servicio.snapshot()
  const enviados = []
  const controlador = crearControladorReglas({
    obtenerSnapshot,
    enviar:
      enviar ??
      (async ({ tipo, payload, baseRevision }) => {
        enviados.push({ tipo, payload, baseRevision })
        return { resultado: aplicar(ctx.servicio, tipo, payload, baseRevision) }
      }),
    alCambiar() {},
  })
  return {
    controlador,
    enviados,
    congelar: () => (congelado = ctx.servicio.snapshot()),
    descongelar: () => (congelado = null),
    plan: () => planDePintado(obtenerSnapshot().vista, controlador.opciones()),
  }
}
const regla0 = (ctx) => ctx.servicio.snapshot().proyecto.comportamientos[0]
const rev = (ctx) => ctx.servicio.snapshot().revision
const fraseDe = (h) => h.plan().find((i) => i.tipo === "reglaFrase")
const selector = (h, slot) => fraseDe(h).selectores.find((s) => s.slot === slot)
const enDisco = (ctx) => JSON.parse(readFileSync(join(ctx.directorio, `${ctx.idProyecto}.json`), "utf8"))
function cerrando(ctx, f) {
  return Promise.resolve()
    .then(() => f(ctx))
    .finally(() => ctx.servicio.cerrar())
}

/** «Agregar regla» + elegir la entrada (el primer slot persistible: B7). */
async function reglaConEntrada(ctx, h, entrada = "cmp-0") {
  h.controlador.agregar()
  assert.equal(await h.controlador.cambiar({ reglaId: null, slot: "sensor", valor: entrada }), true)
  return regla0(ctx).id
}

// ════════════════════════════════════════════════════════════════════════════════════
// 1–7: creación, B2/B7 intactos, el grupo no muta la IR, defaults
// ════════════════════════════════════════════════════════════════════════════════════

test("1: «Agregar regla» solo no crea IR ni sube la revisión", () =>
  cerrando(proyecto(), (ctx) => {
    const h = harness(ctx)
    const antes = rev(ctx)
    h.controlador.agregar()
    assert.equal(h.controlador.opciones().reglaNueva, true)
    assert.equal(rev(ctx), antes)
    assert.deepEqual(ctx.servicio.snapshot().proyecto.comportamientos, [])
    assert.equal(h.enviados.length, 0)
  }))

test("2: elegir el DHT22 persiste SÓLO la regla incompleta representable (B2/B7): {cuando:{sensor}}", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    const antes = rev(ctx)
    await reglaConEntrada(ctx, h)
    assert.equal(h.enviados.length, 1)
    assert.equal(rev(ctx), antes + 1)
    assert.deepEqual(regla0(ctx).cuando, { sensor: "cmp-0" })
    assert.equal(regla0(ctx).entonces, undefined)
    assert.deepEqual(ctx.servicio.snapshot().vista.reglas[0].faltan, ["estado", "actuador", "salida"])
  }))

test("3/4: las partes del grupo NO mutan la IR ni la revisión; en el disco nunca hay una tríada parcial", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    const id = await reglaConEntrada(ctx, h)
    const antes = rev(ctx)
    for (const [slot, valor] of [["capacidad", "temperatura"], ["comparador", ">"]]) {
      assert.equal(await h.controlador.cambiar({ reglaId: id, slot, valor }), true)
      assert.equal(rev(ctx), antes, `${slot}: sin revisión nueva`)
      assert.deepEqual(regla0(ctx).cuando, { sensor: "cmp-0" })
      assert.deepEqual(enDisco(ctx).comportamientos[0].cuando, { sensor: "cmp-0" }, "nada parcial en disco")
    }
    assert.equal(h.enviados.length, 1, "sólo la operación de la entrada")
  }))

test("5/6: el número empieza VACÍO; la unidad es la canónica que proyecta Component Knowledge", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    const id = await reglaConEntrada(ctx, h)
    assert.equal(selector(h, "valor").valorActual, "", "sin número inventado")
    assert.equal(selector(h, "comparador").valorActual, null, "sin comparador inventado")
    assert.equal(selector(h, "unidad").valorActual, null, "sin capacidad todavía no hay unidad")
    await h.controlador.cambiar({ reglaId: id, slot: "capacidad", valor: "temperatura" })
    const canonica = K.capacidadCuantitativa("dht22", "temperatura").valor.unidadCanonica
    assert.equal(selector(h, "unidad").valorActual, canonica)
    assert.deepEqual(selector(h, "unidad").opciones.map((o) => o.valor), K.capacidadCuantitativa("dht22", "temperatura").valor.unidades.map((u) => u.id), "23: las unidades vienen de Component Knowledge")
    assert.equal(selector(h, "valor").valorActual, "")
  }))

test("7: la capacidad se preselecciona SÓLO si hay exactamente una disponible (NTC sí, DHT22 no)", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    await reglaConEntrada(ctx, h, "cmp-2") // NTC
    assert.equal(K.capacidadesCuantitativas("ntc").valor.filter((c) => c.disponibilidadSemantica.disponible).length, 1, "precondición real")
    assert.equal(selector(h, "capacidad").valorActual, "temperatura")
    assert.equal(selector(h, "unidad").valorActual, "celsius")
    // la misma regla, ahora con el DHT22 (dos capacidades): nada preseleccionado
    await h.controlador.cambiar({ reglaId: regla0(ctx).id, slot: "sensor", valor: "cmp-0" })
    assert.equal(selector(h, "capacidad").valorActual, null)
  }))

// ════════════════════════════════════════════════════════════════════════════════════
// 8–13: OD-2, sin conversión en el navegador, materialización, éxito, rechazo, stale
// ════════════════════════════════════════════════════════════════════════════════════

test("8 (OD-2): cambiar la unidad del borrador con un número escrito VACÍA el número (sin convertir, sin enviar)", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    const id = await reglaConEntrada(ctx, h)
    await h.controlador.cambiar({ reglaId: id, slot: "capacidad", valor: "temperatura" })
    await h.controlador.cambiar({ reglaId: id, slot: "valor", valor: "30" })
    assert.equal(selector(h, "valor").valorActual, "30")
    await h.controlador.cambiar({ reglaId: id, slot: "unidad", valor: "fahrenheit" })
    assert.equal(selector(h, "valor").valorActual, "", "el número se vacía")
    assert.equal(selector(h, "unidad").valorActual, "fahrenheit")
    assert.equal(h.enviados.length, 1, "nada se envió")
  }))

test("9: el navegador no tiene fórmulas ni tablas de conversión/unidades", () => {
  for (const f of readdirSync(join(REPO, "opencode/vista-fisica/web")).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(join(REPO, "opencode/vista-fisica/web", f), "utf8")
    for (const p of [/\b1\.8\b/, /5\s*\/\s*9/, /\b32\b\s*[+-]|[+-]\s*\b32\b/, /°/, /\bcelsius\b/i, /\bfahrenheit\b/i, /toPrecision/]) assert.ok(!p.test(src), `${f}: ${p}`)
  }
})

test("10/11: el grupo completo se materializa con EXACTAMENTE UN SetComportamiento (mismo id); éxito → borrador destruido y S1 es dueño", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    const id = await reglaConEntrada(ctx, h)
    const antes = rev(ctx)
    await h.controlador.cambiar({ reglaId: id, slot: "capacidad", valor: "temperatura" })
    await h.controlador.cambiar({ reglaId: id, slot: "comparador", valor: ">" })
    assert.equal(h.enviados.length, 1)
    await h.controlador.cambiar({ reglaId: id, slot: "valor", valor: "30" }) // completa (unidad canónica ya vigente)
    assert.equal(h.enviados.length, 2, "una sola operación más")
    assert.deepEqual(h.enviados[1].payload, { comportamiento: { id, cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } } } })
    assert.equal(rev(ctx), antes + 1)
    assert.equal(regla0(ctx).id, id, "es la misma regla")
    assert.equal(h.controlador.borrador(), null, "borrador destruido")
    assert.equal(h.controlador.opciones().avisoBorrador, null, "el éxito no se confunde con un descarte")
    const r = ctx.servicio.snapshot().vista.reglas[0]
    assert.equal(r.frase.estado.clave, "numerica")
    assert.ok(r.slots.every((s) => s.grupoAtomico === undefined), "ahora edita S1 (sin grupo)")
    // 20: S1 edita directo: cambiar el número manda UNA operación sin borrador
    await h.controlador.cambiar({ reglaId: id, slot: "valor", valor: "25" })
    assert.equal(h.enviados.length, 3)
    assert.equal(regla0(ctx).cuando.umbral.valor, 25)
    assert.equal(h.controlador.borrador(), null)
  }))

test("12: rechazo del Engine → el borrador QUEDA editable, la IR no cambió, sin éxito inventado", () =>
  cerrando(proyecto(), async (ctx) => {
    let rechazar = false
    const enviados = []
    const h = harness(ctx, {
      enviar: async ({ tipo, payload, baseRevision }) => {
        enviados.push(payload)
        if (rechazar) return { resultado: { ok: false, motivos: [{ codigo: "CAPACIDAD_NO_DECLARADA", severidad: "error", clasificacion: "rechazo" }] } }
        return { resultado: aplicar(ctx.servicio, tipo, payload, baseRevision) }
      },
    })
    const id = await reglaConEntrada(ctx, h)
    rechazar = true
    const antes = JSON.stringify(ctx.servicio.snapshot().proyecto)
    await h.controlador.cambiar({ reglaId: id, slot: "capacidad", valor: "temperatura" })
    await h.controlador.cambiar({ reglaId: id, slot: "comparador", valor: "<" })
    await h.controlador.cambiar({ reglaId: id, slot: "valor", valor: "18" })
    assert.equal(enviados.length, 2, "se intentó una vez")
    assert.equal(JSON.stringify(ctx.servicio.snapshot().proyecto), antes, "la IR no cambió")
    // el número queda atado a la unidad vigente cuando se escribió (fix post-auditoría: contexto del número)
    assert.deepEqual(h.controlador.borrador().partes, { capacidad: "temperatura", comparador: "<", valor: "18", unidad: "celsius" }, "el borrador sigue")
    assert.equal(fraseDe(h).borrador.texto, TEXTO_SIN_ENVIAR)
  }))

test("13 (OD-4): stale → NUNCA se reintenta solo; el borrador se revalida y la próxima interacción explícita vuelve a enviar", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    const id = await reglaConEntrada(ctx, h)
    await h.controlador.cambiar({ reglaId: id, slot: "capacidad", valor: "temperatura" })
    await h.controlador.cambiar({ reglaId: id, slot: "comparador", valor: ">" })
    h.congelar() // el navegador se queda con un snapshot viejo…
    ok(ctx.servicio, "AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" }) // …y otro actor commitea
    await h.controlador.cambiar({ reglaId: id, slot: "valor", valor: "30" })
    assert.equal(h.enviados.length, 2)
    assert.equal(regla0(ctx).cuando.capacidad, undefined, "stale: no se aplicó")
    h.descongelar() // llega el snapshot autoritativo
    await new Promise((r) => setTimeout(r, 5))
    assert.equal(h.enviados.length, 2, "nada se reenvió solo")
    assert.deepEqual(h.controlador.borrador().partes, { capacidad: "temperatura", comparador: ">", valor: "30", unidad: "celsius" }, "revalidado: todo sigue ofrecido (el número, con la unidad en que se escribió)")
    await h.controlador.cambiar({ reglaId: id, slot: "valor", valor: "31" }) // interacción explícita
    assert.equal(h.enviados.length, 3)
    assert.equal(regla0(ctx).cuando.umbral.valor, 31)
  }))

// ════════════════════════════════════════════════════════════════════════════════════
// 14–16: revalidación, cancelar, recargar
// ════════════════════════════════════════════════════════════════════════════════════

test("14: revalidación con un snapshot nuevo: se conserva sólo lo que sigue ofrecido", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    const id = await reglaConEntrada(ctx, h)
    await h.controlador.cambiar({ reglaId: id, slot: "capacidad", valor: "humedad" })
    await h.controlador.cambiar({ reglaId: id, slot: "comparador", valor: ">" })
    // otra instancia con la misma capacidad (N-10 conserva): todo sigue
    await h.controlador.cambiar({ reglaId: id, slot: "sensor", valor: "cmp-3" })
    assert.deepEqual(h.controlador.borrador().partes, { capacidad: "humedad", comparador: ">" })
    // otro actor cambia la entrada a un NTC (no tiene humedad): la capacidad cae; el comparador queda
    ok(ctx.servicio, "SetComportamiento", { comportamiento: { id, cuando: { sensor: "cmp-2" } } })
    assert.deepEqual(h.controlador.borrador().partes, { comparador: ">" })
    // otro actor COMPLETA la condición (p. ej. el agente): el borrador se descarta con aviso, nunca se pisa
    ok(ctx.servicio, "SetComportamiento", { comportamiento: { id, cuando: { sensor: "cmp-2", capacidad: "temperatura", comparador: "<", umbral: { valor: 10, unidad: "celsius", magnitud: "temperatura" } } } })
    assert.equal(h.controlador.borrador(), null)
    assert.equal(h.controlador.opciones().avisoBorrador, AVISO_BORRADOR_DESCARTADO)
    assert.equal(regla0(ctx).cuando.umbral.valor, 10, "la condición del otro actor queda intacta")
  }))

// ── Corrección post-auditoría (REJECT localizado en 2dbf802): un número del borrador NUNCA sobrevive a
// la pérdida del contexto semántico (capacidad/unidad) en que se escribió. ──

test("14b (regresión de auditoría): DHT22 → humedad → 70 → la entrada pasa a NTC → la revalidación descarta capacidad, unidad Y número; nada se materializa hasta re-escribir el número", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    const id = await reglaConEntrada(ctx, h) // DHT22
    await h.controlador.cambiar({ reglaId: id, slot: "capacidad", valor: "humedad" })
    await h.controlador.cambiar({ reglaId: id, slot: "valor", valor: "70" })
    assert.deepEqual(h.controlador.borrador().partes, { capacidad: "humedad", valor: "70", unidad: "porcentaje" })
    const opsAntes = h.enviados.length
    // cambio autoritativo externo: la entrada pasa a ser el NTC (no tiene humedad; su única capacidad es otra)
    ok(ctx.servicio, "SetComportamiento", { comportamiento: { id, cuando: { sensor: "cmp-2" } } })
    const revisado = h.controlador.borrador()
    assert.equal(revisado.partes.capacidad, undefined, "humedad no permanece")
    assert.equal(revisado.partes.unidad, undefined, "la unidad dependiente anterior no permanece")
    assert.equal(revisado.partes.valor, undefined, "«70» no permanece")
    assert.deepEqual(revisado.partes, {})
    assert.equal(h.enviados.length, opsAntes, "la revalidación sola no envía nada")
    // lo predeterminado para NTC (capacidad única, unidad canónica) se re-deriva, pero sin heredar el 70
    assert.equal(selector(h, "capacidad").valorActual, "temperatura")
    assert.equal(selector(h, "unidad").valorActual, "celsius")
    assert.equal(selector(h, "valor").valorActual, "", "el número está vacío")
    // una interacción explícita posterior NO materializa 70 °C
    await h.controlador.cambiar({ reglaId: id, slot: "comparador", valor: ">" })
    assert.equal(h.enviados.length, opsAntes, "sin operación: falta el número")
    assert.deepEqual(regla0(ctx).cuando, { sensor: "cmp-2" }, "la IR no recibió ningún umbral")
    // sólo si el estudiante vuelve a escribir 70, explícitamente, bajo el contexto nuevo
    await h.controlador.cambiar({ reglaId: id, slot: "valor", valor: "70" })
    assert.equal(h.enviados.length, opsAntes + 1)
    assert.deepEqual(regla0(ctx).cuando, { sensor: "cmp-2", capacidad: "temperatura", comparador: ">", umbral: { valor: 70, unidad: "celsius", magnitud: "temperatura" } })
  }))

test("14c: si el contexto del número se CONSERVA (otra instancia con la misma capacidad), el número se conserva", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    const id = await reglaConEntrada(ctx, h) // DHT22
    await h.controlador.cambiar({ reglaId: id, slot: "capacidad", valor: "humedad" })
    await h.controlador.cambiar({ reglaId: id, slot: "valor", valor: "70" })
    ok(ctx.servicio, "SetComportamiento", { comportamiento: { id, cuando: { sensor: "cmp-3" } } }) // DHT22 2
    assert.deepEqual(h.controlador.borrador().partes, { capacidad: "humedad", valor: "70", unidad: "porcentaje" })
  }))

test("14d (función pura, datos genéricos): un número escrito sobre un PREDETERMINADO también se descarta si ese predeterminado cambia", async () => {
  const { aplicarEleccionAlGrupo, revalidarGrupo } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
  // Dos reglas sintéticas: la entrada sólo ofrece UNA capacidad (predeterminada), distinta en cada una.
  const regla = (cap, unidad) => ({
    id: "beh-1",
    slots: [
      { slot: "capacidad", grupoAtomico: "g", opciones: [{ valor: cap, etiqueta: cap, parche: {} }], predeterminado: cap },
      { slot: "comparador", grupoAtomico: "g", opciones: [{ valor: ">", etiqueta: "mayor a", parche: {} }] },
      { slot: "valor", grupoAtomico: "g", tipo: "numero", destino: ["cuando", "umbral", "valor"], opciones: [] },
      { slot: "unidad", grupoAtomico: "g", opciones: [], opcionesPor: { depende: "capacidad", listas: { [cap]: { opciones: [{ valor: unidad, etiqueta: unidad, parche: {} }], predeterminado: unidad } } }, vaciaAlCambiar: ["valor"] },
    ],
  })
  const conNumero = aplicarEleccionAlGrupo(regla("cap-a", "u-a"), {}, "valor", "70")
  assert.deepEqual(conNumero, { valor: "70", capacidad: "cap-a", unidad: "u-a" }, "el número fija el contexto vigente (aunque fuera predeterminado)")
  assert.deepEqual(revalidarGrupo(regla("cap-b", "u-b"), conNumero), {}, "otro predeterminado → el número no se hereda")
  assert.deepEqual(revalidarGrupo(regla("cap-a", "u-a"), conNumero), conNumero, "mismo contexto → se conserva")
})

test("15: Descartar borra SÓLO el borrador; la regla incompleta persistida queda igual", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    const id = await reglaConEntrada(ctx, h)
    await h.controlador.cambiar({ reglaId: id, slot: "capacidad", valor: "temperatura" })
    const antes = JSON.stringify(ctx.servicio.snapshot().proyecto)
    const r = rev(ctx)
    assert.ok(fraseDe(h).borrador, "se ofrece «Descartar»")
    h.controlador.descartarBorrador()
    assert.equal(h.controlador.borrador(), null)
    assert.equal(JSON.stringify(ctx.servicio.snapshot().proyecto), antes)
    assert.equal(rev(ctx), r)
    assert.equal(fraseDe(h).borrador, null)
  }))

test("16/22: recargar pierde el borrador (a propósito) y la regla incompleta recarga normal; después de materializar, la recarga es idéntica", async () => {
  const ctx = proyecto()
  const h = harness(ctx)
  const id = await reglaConEntrada(ctx, h)
  await h.controlador.cambiar({ reglaId: id, slot: "capacidad", valor: "temperatura" })
  ctx.servicio.cerrar()
  const reabierto = obtenerServicioDeProyectoConVista({ directorio: ctx.directorio, idProyecto: ctx.idProyecto })
  const ctx2 = { ...ctx, servicio: reabierto }
  try {
    const h2 = harness(ctx2) // página nueva: controlador nuevo
    assert.equal(h2.controlador.borrador(), null)
    assert.deepEqual(regla0(ctx2).cuando, { sensor: "cmp-0" })
    assert.equal(selector(h2, "capacidad").valorActual, null)
    await h2.controlador.cambiar({ reglaId: id, slot: "capacidad", valor: "temperatura" })
    await h2.controlador.cambiar({ reglaId: id, slot: "comparador", valor: "<=" })
    await h2.controlador.cambiar({ reglaId: id, slot: "valor", valor: "12,5" })
    const materializado = reabierto.snapshot()
    reabierto.cerrar()
    const otra = obtenerServicioDeProyectoConVista({ directorio: ctx.directorio, idProyecto: ctx.idProyecto })
    try {
      assert.deepEqual(otra.snapshot().proyecto, materializado.proyecto)
      assert.equal(otra.snapshot().vista.reglas[0].texto, null, "sin salida todavía: incompleta")
      assert.deepEqual(otra.snapshot().vista.reglas[0].faltan, ["actuador", "salida"])
    } finally {
      otra.cerrar()
    }
  } finally {
    try {
      reabierto.cerrar()
    } catch {}
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 17–18: Blockly: proyección del MISMO borrador, sin operaciones accidentales
// ════════════════════════════════════════════════════════════════════════════════════

test("17/18: Blockly y la frase comparten el borrador; repintar no emite operaciones; editar en Blockly sólo toca el borrador", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    const id = await reglaConEntrada(ctx, h)
    const { Blockly, reg } = fabricarBlockly()
    const promesas = []
    const controladorEspia = { cambiar: (e) => { const p = h.controlador.cambiar(e); promesas.push(p); return p }, quitar: (e) => h.controlador.quitar(e), borrador: () => h.controlador.borrador() }
    const vistaLogica = crearVistaLogica({ Blockly, contenedor: {}, controlador: controladorEspia })
    const pintarTodo = () => vistaLogica.repintar(ctx.servicio.snapshot())
    for (let i = 0; i < 3; i++) pintarTodo()
    assert.equal(h.enviados.length, 1, "repintar no es editar")
    // la frase elige la capacidad → Blockly la muestra
    await h.controlador.cambiar({ reglaId: id, slot: "capacidad", valor: "temperatura" })
    let modelo = pintarTodo()
    let mientras = reg.ws.bloques.find((b) => b.type === "tecnia_mientras")
    assert.equal(mientras.getFieldValue("capacidad"), "temperatura")
    assert.equal(mientras.getFieldValue("unidad"), "celsius")
    assert.equal(modelo.regla.sinEnviar, true)
    // Blockly elige el comparador → el borrador (y la frase) lo tienen; sin operación
    mientras.campos.comparador.setValue(">=")
    await Promise.all(promesas)
    assert.equal(h.enviados.length, 1)
    assert.equal(h.controlador.borrador().partes.comparador, ">=")
    assert.equal(selector(h, "comparador").valorActual, ">=")
    // Blockly escribe el número → grupo completo → UNA operación
    modelo = pintarTodo()
    mientras = reg.ws.bloques.find((b) => b.type === "tecnia_mientras")
    mientras.campos.valor.setValue("28")
    await Promise.all(promesas)
    assert.equal(h.enviados.length, 2)
    assert.equal(regla0(ctx).cuando.comparador, ">=")
    assert.equal(regla0(ctx).cuando.umbral.valor, 28)
    pintarTodo()
    assert.equal(h.enviados.length, 2, "repintar tras materializar tampoco emite nada")
    assert.ok(!JSON.stringify(enDisco(ctx)).includes("tecnia_"), "nada de Blockly en disco")
  }))

// ════════════════════════════════════════════════════════════════════════════════════
// 19, 21, 23: booleano sin cambios, límite de 1 regla, Component Knowledge vía la proyección
// ════════════════════════════════════════════════════════════════════════════════════

test("19: crear una regla booleana sigue igual: cada slot UNA operación, sin borrador", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    h.controlador.agregar()
    await h.controlador.cambiar({ reglaId: null, slot: "sensor", valor: "cmp-4" })
    const id = regla0(ctx).id
    await h.controlador.cambiar({ reglaId: id, slot: "estado", valor: "presionado" })
    await h.controlador.cambiar({ reglaId: id, slot: "actuador", valor: "cmp-1" })
    await h.controlador.cambiar({ reglaId: id, slot: "salida", valor: "encendido" })
    assert.equal(h.enviados.length, 4, "una operación por slot, como antes")
    assert.equal(h.controlador.borrador(), null)
    assert.equal(ctx.servicio.snapshot().vista.reglas[0].texto, "Mientras el Pulsador esté presionado, el LED está encendido.")
    assert.ok(!ctx.servicio.snapshot().vista.reglas[0].slots?.some((s) => s.grupoAtomico), "el booleano no usa grupo")
  }))

test("21 (OD-3): el límite de UI de 1 regla sigue: con una regla no se ofrece «Agregar regla»", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    assert.ok(h.plan().some((i) => i.tipo === "reglaAgregar"))
    await reglaConEntrada(ctx, h)
    assert.ok(!h.plan().some((i) => i.tipo === "reglaAgregar"))
  }))

test("23: las opciones del grupo son exactamente las capacidades DISPONIBLES de Component Knowledge, con su rótulo", () =>
  cerrando(proyecto(), async (ctx) => {
    const h = harness(ctx)
    await reglaConEntrada(ctx, h)
    const esperadas = K.capacidadesCuantitativas("dht22").valor.filter((c) => c.disponibilidadSemantica.disponible && c.etiqueta !== null)
    assert.deepEqual(selector(h, "capacidad").opciones.map((o) => [o.valor, o.etiqueta]), esperadas.map((c) => [c.capacidad, c.etiqueta]))
    assert.deepEqual(selector(h, "comparador").opciones.map((o) => o.valor), [">", "<", ">=", "<="])
  }))
