// Phase 3 — Vertical semántico #1, T5: la FRASE editable del navegador (contrato B7;
// diseño §7/§9). El navegador NO tiene tablas de clase/capacidad/estado: pinta lo que
// `reglas`/`opcionesRegla` le dan. Aquí: la proyección aditiva (forma/condicion/accion),
// el plan, el pintor (con un document fake), y el controlador de la frase (puro, con
// dependencias inyectadas) — incluido un recorrido contra el Engine REAL.

import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, op, obtenerServicioDeProyecto, catalogo, prepararProyectoConLed, GPIO_Y } from "./phase2-helpers.mjs"

const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { pintar } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))
const app = await import(join(REPO, "opencode/vista-fisica/web/app.js"))

const CONDICION = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }

function preparar() {
  const directorio = nuevoDir("p3-web")
  const idProyecto = nuevoIdProyecto("p3-web")
  const { servicio, idComponente: led } = prepararProyectoConLed(directorio, idProyecto)
  let r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const pulsador = servicio.snapshot().proyecto.componentes.find((c) => c.tipo === "pulsador").id
  r = servicio.aplicar(op("AsignarPin", { componente: pulsador, terminal: "senal", pin: GPIO_Y }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  return { servicio, led, pulsador }
}
const vistaDe = (servicio) => proyectarVista(servicio.snapshot().proyecto, catalogo)
const setRegla = (ctx, comportamiento) => {
  const r = ctx.servicio.aplicar(op("SetComportamiento", { comportamiento }, ctx.servicio.snapshot().revision))
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
}

// ── document fake (mismo estilo que phase2-pintar) ──────────────────────────────────
function elementoFake(tag) {
  return {
    tagName: tag, atributos: {}, hijos: [], _textContent: "", _listeners: {}, disabled: false,
    setAttribute(n, v) { this.atributos[n] = String(v) },
    appendChild(h) { this.hijos.push(h); return h },
    addEventListener(t, m) { (this._listeners[t] ??= []).push(m) },
    disparar(t) { for (const m of this._listeners[t] ?? []) m() },
    get textContent() { return this._textContent },
    set textContent(v) { this._textContent = v },
    get value() { return this._value ?? "" },
    set value(v) { this._value = v },
  }
}
const documentoFake = () => ({ createElement: (t) => elementoFake(t) })
function descendientes(nodo, acc = []) {
  for (const h of nodo.hijos ?? []) { acc.push(h); descendientes(h, acc) }
  return acc
}
const buscar = (nodo, pred) => descendientes(nodo).filter(pred)
const textoDe = (nodo) => [nodo.textContent, ...(nodo.hijos ?? []).map(textoDe)].join("")

// ═════════ proyección aditiva del servidor ═════════════════════════════════════════

test("T5 servidor: opcionesRegla.estados[0].condicion y salidas[0].accion vienen del servidor (el navegador no los inventa)", () => {
  const ctx = preparar()
  const o = vistaDe(ctx.servicio).opcionesRegla
  assert.deepEqual(o.estados[0].condicion, CONDICION)
  assert.equal(o.salidas[0].accion, "encender")
  ctx.servicio.cerrar()
})

test("T5 servidor: reglas[i].forma es la regla guardada (sin id) para reenviarla entera", () => {
  const ctx = preparar()
  setRegla(ctx, { cuando: { sensor: ctx.pulsador, ...CONDICION }, entonces: { actuador: ctx.led, accion: "encender" } })
  setRegla(ctx, { cuando: { sensor: ctx.pulsador } })
  const [a, b] = vistaDe(ctx.servicio).reglas
  assert.deepEqual(a.forma, { cuando: { sensor: ctx.pulsador, ...CONDICION }, entonces: { actuador: ctx.led, accion: "encender" } })
  assert.deepEqual(b.forma, { cuando: { sensor: ctx.pulsador } })
  ctx.servicio.cerrar()
})

// ═════════ plan ════════════════════════════════════════════════════════════════════

const reglasDe = (plan) => plan.filter((i) => i.tipo === "reglaFrase")

test("T5 plan: regla canónica -> una frase con los cuatro selectores y valores actuales", () => {
  const ctx = preparar()
  setRegla(ctx, { cuando: { sensor: ctx.pulsador, ...CONDICION }, entonces: { actuador: ctx.led, accion: "encender" } })
  const v = vistaDe(ctx.servicio)
  const [f] = reglasDe(planDePintado(v))
  assert.equal(f.reglaId, v.reglas[0].id)
  assert.deepEqual(f.selectores.map((s) => s.slot), ["sensor", "estado", "actuador", "salida"])
  assert.deepEqual(f.selectores.map((s) => s.prefijo), ["Mientras el", "esté", ", el", "está"])
  assert.equal(f.cierre, ".")
  assert.deepEqual(f.selectores.map((s) => s.valorActual), [ctx.pulsador, "presionado", ctx.led, "encendido"])
  assert.deepEqual(f.selectores[0].opciones, [{ valor: ctx.pulsador, etiqueta: "Pulsador" }])
  // Semantic Vertical #3: las opciones de estado/salida salen de ComponentKnowledge.
  assert.deepEqual(f.selectores[1].opciones, [{ valor: "presionado", etiqueta: "presionado" }, { valor: "suelto", etiqueta: "suelto" }])
  assert.deepEqual(f.selectores[2].opciones, [{ valor: ctx.led, etiqueta: "LED" }])
  assert.deepEqual(f.selectores[3].opciones, [{ valor: "encendido", etiqueta: "encendido" }, { valor: "apagado", etiqueta: "apagado" }])
  for (const s of f.selectores) assert.equal(s.placeholder, null)
  assert.equal(f.conTraza, true)
  assert.equal(f.traza, null, "la traza NO viaja salvo que se pida")
  assert.equal(f.aviso, null)
  assert.deepEqual(f.explicaciones, [])
  ctx.servicio.cerrar()
})

test("T5 plan: la traza sólo viaja cuando la regla está en trazasAbiertas", () => {
  const ctx = preparar()
  setRegla(ctx, { cuando: { sensor: ctx.pulsador, ...CONDICION }, entonces: { actuador: ctx.led, accion: "encender" } })
  const v = vistaDe(ctx.servicio)
  const [f] = reglasDe(planDePintado(v, { trazasAbiertas: [v.reglas[0].id] }))
  assert.equal(f.traza.etiqueta, "Explicación de la regla — no es una simulación ni lo que pasa en la placa.")
  assert.equal(f.traza.ramas.length, 2)
  ctx.servicio.cerrar()
})

test("T5 plan: slots vacíos muestran '[elegí…]' y las explicaciones de los motivos de la regla", () => {
  const ctx = preparar()
  setRegla(ctx, { cuando: { sensor: ctx.pulsador } })
  const [f] = reglasDe(planDePintado(vistaDe(ctx.servicio)))
  assert.deepEqual(f.selectores.map((s) => s.valorActual), [ctx.pulsador, null, null, null])
  assert.deepEqual(f.selectores.map((s) => s.placeholder), [null, "[elegí…]", "[elegí…]", "[elegí…]"])
  assert.deepEqual(f.explicaciones, ["A la regla le falta: qué estado de la entrada, qué salida y qué hace la salida."])
  assert.equal(f.conTraza, false)
  ctx.servicio.cerrar()
})

test("T5 plan: 0 reglas -> botón Agregar regla; con reglaNueva -> una frase vacía (id null) y sin botón", () => {
  const ctx = preparar()
  const v = vistaDe(ctx.servicio)
  const plan = planDePintado(v)
  assert.equal(plan.filter((i) => i.tipo === "reglaAgregar").length, 1)
  assert.equal(reglasDe(plan).length, 0)
  const conNueva = planDePintado(v, { reglaNueva: true })
  assert.equal(conNueva.filter((i) => i.tipo === "reglaAgregar").length, 0)
  const [f] = reglasDe(conNueva)
  assert.equal(f.reglaId, null)
  assert.deepEqual(f.selectores.map((s) => s.valorActual), [null, null, null, null])
  ctx.servicio.cerrar()
})

test("T5 plan: con una regla NO hay 'Agregar regla' (límite de UI = 1); con varias, se muestran todas más el aviso", () => {
  const ctx = preparar()
  setRegla(ctx, { cuando: { sensor: ctx.pulsador } })
  assert.equal(planDePintado(vistaDe(ctx.servicio)).filter((i) => i.tipo === "reglaAgregar").length, 0)
  assert.equal(planDePintado(vistaDe(ctx.servicio)).filter((i) => i.tipo === "reglaAviso").length, 0)
  setRegla(ctx, { entonces: { actuador: ctx.led } })
  const plan = planDePintado(vistaDe(ctx.servicio))
  assert.equal(reglasDe(plan).length, 2)
  assert.deepEqual(plan.filter((i) => i.tipo === "reglaAviso").map((i) => i.texto), ["Hay varias reglas: la herramienta todavía no analiza si se contradicen."])
  ctx.servicio.cerrar()
})

test("T5 plan: condición avanzada -> el selector de estado muestra 'condición avanzada' y la nota; no ofrece la traza", () => {
  const ctx = preparar()
  setRegla(ctx, { cuando: { sensor: ctx.pulsador, capacidad: "estadoBooleano", comparador: ">", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: ctx.led, accion: "encender" } })
  const [f] = reglasDe(planDePintado(vistaDe(ctx.servicio)))
  const estado = f.selectores[1]
  assert.equal(estado.valorActual, "avanzada")
  assert.deepEqual(estado.opciones, [{ valor: "presionado", etiqueta: "presionado" }, { valor: "suelto", etiqueta: "suelto" }, { valor: "avanzada", etiqueta: "condición avanzada" }])
  assert.equal(typeof f.aviso, "string")
  assert.equal(f.conTraza, false)
  ctx.servicio.cerrar()
})

test("T5 plan: operacionPendiente o sin conexión deshabilitan TODOS los controles de la frase y los botones", () => {
  const ctx = preparar()
  setRegla(ctx, { cuando: { sensor: ctx.pulsador, ...CONDICION }, entonces: { actuador: ctx.led, accion: "encender" } })
  const v = vistaDe(ctx.servicio)
  for (const opciones of [{ operacionPendiente: true }, { conexionActiva: false }]) {
    const [f] = reglasDe(planDePintado(v, opciones))
    assert.equal(f.deshabilitado, true)
    assert.ok(f.selectores.every((s) => s.deshabilitado === true))
  }
  const [habil] = reglasDe(planDePintado(v))
  assert.equal(habil.deshabilitado, false)
  assert.equal(planDePintado(vistaDe({ snapshot: () => ({ proyecto: { ...ctx.servicio.snapshot().proyecto, comportamientos: [] } }) }), { operacionPendiente: true }).find((i) => i.tipo === "reglaAgregar").deshabilitado, true)
  ctx.servicio.cerrar()
})

// ═════════ pintar ══════════════════════════════════════════════════════════════════

test("T5 pintar: la frase se arma con textos fijos + selects; un cambio avisa onCambioRegla; Quitar y la traza avisan sus manejadores", () => {
  const ctx = preparar()
  setRegla(ctx, { cuando: { sensor: ctx.pulsador, ...CONDICION }, entonces: { actuador: ctx.led, accion: "encender" } })
  const v = vistaDe(ctx.servicio)
  const eventos = []
  const raiz = pintar(documentoFake(), planDePintado(v, { trazasAbiertas: [v.reglas[0].id] }), {
    onCambioRegla: (e) => eventos.push(["cambio", e]),
    onQuitarRegla: (e) => eventos.push(["quitar", e]),
    onAlternarTraza: (e) => eventos.push(["traza", e]),
  })
  assert.ok(raiz.reglas, "pintar devuelve la sección reglas")
  const selects = buscar(raiz.reglas, (n) => n.tagName === "select")
  assert.equal(selects.length, 4)
  assert.deepEqual(selects.map((s) => s.atributos["data-slot"]), ["sensor", "estado", "actuador", "salida"])
  assert.deepEqual(selects.map((s) => s.value), [ctx.pulsador, "presionado", ctx.led, "encendido"])
  const frase = buscar(raiz.reglas, (n) => n.atributos?.["data-frase"] !== undefined)[0]
  assert.equal(textoDe(frase).replace(/\s+/g, " ").includes("Mientras el"), true)

  selects[3].value = "encendido"
  selects[3].disparar("change")
  assert.deepEqual(eventos[0], ["cambio", { reglaId: v.reglas[0].id, slot: "salida", valor: "encendido" }])

  buscar(raiz.reglas, (n) => n.atributos?.["data-accion"] === "quitar-regla")[0].disparar("click")
  assert.deepEqual(eventos[1], ["quitar", { reglaId: v.reglas[0].id }])
  buscar(raiz.reglas, (n) => n.atributos?.["data-accion"] === "alternar-traza")[0].disparar("click")
  assert.deepEqual(eventos[2], ["traza", { reglaId: v.reglas[0].id }])

  const traza = buscar(raiz.reglas, (n) => n.atributos?.["data-traza"] !== undefined)[0]
  assert.match(textoDe(traza), /Si el Pulsador está presionado → la condición es verdadera → el LED está encendido\./)
  ctx.servicio.cerrar()
})

test("T5 pintar: la traza NO está en el DOM mientras no se pidió", () => {
  const ctx = preparar()
  setRegla(ctx, { cuando: { sensor: ctx.pulsador, ...CONDICION }, entonces: { actuador: ctx.led, accion: "encender" } })
  const raiz = pintar(documentoFake(), planDePintado(vistaDe(ctx.servicio)), {})
  assert.equal(buscar(raiz.reglas, (n) => n.atributos?.["data-traza"] !== undefined).length, 0)
  ctx.servicio.cerrar()
})

test("T5 pintar: slot vacío -> opción '[elegí…]' (value '') seleccionada; disabled se aplica a selects y botones", () => {
  const ctx = preparar()
  setRegla(ctx, { cuando: { sensor: ctx.pulsador } })
  const raiz = pintar(documentoFake(), planDePintado(vistaDe(ctx.servicio), { operacionPendiente: true }), {})
  const selects = buscar(raiz.reglas, (n) => n.tagName === "select")
  assert.equal(selects[1].value, "")
  assert.ok(buscar(selects[1], (n) => n.tagName === "option" && n.textContent === "[elegí…]").length === 1)
  assert.ok(selects.every((s) => s.disabled === true))
  for (const b of buscar(raiz.reglas, (n) => n.tagName === "button")) assert.equal(b.disabled, true)
  ctx.servicio.cerrar()
})

test("T5 pintar: 'Agregar regla' avisa onAgregarRegla; los motivos de la regla se muestran bajo la frase y la remarcan (data-afectado)", () => {
  const ctx = preparar()
  const eventos = []
  let raiz = pintar(documentoFake(), planDePintado(vistaDe(ctx.servicio)), { onAgregarRegla: () => eventos.push("agregar") })
  buscar(raiz.reglas, (n) => n.atributos?.["data-accion"] === "agregar-regla")[0].disparar("click")
  assert.deepEqual(eventos, ["agregar"])

  setRegla(ctx, { cuando: { sensor: ctx.pulsador } })
  raiz = pintar(documentoFake(), planDePintado(vistaDe(ctx.servicio)), {})
  const caja = buscar(raiz.reglas, (n) => n.atributos?.["data-regla-id"] !== undefined && n.tagName === "div")[0]
  assert.equal(caja.atributos["data-afectado"], "blocking")
  assert.match(textoDe(caja), /A la regla le falta: qué estado de la entrada, qué salida y qué hace la salida\./)
  ctx.servicio.cerrar()
})

// ═════════ app.js: operación de la frase + controlador ═════════════════════════════

test("T5 construirOperacionRegla: la regla entera sale de lo guardado + el valor nuevo; 'presionado' usa la condición DEL SERVIDOR", () => {
  const ctx = preparar()
  setRegla(ctx, { cuando: { sensor: ctx.pulsador } })
  const v = vistaDe(ctx.servicio)
  const regla = v.reglas[0]
  const o1 = app.construirOperacionRegla({ regla, slot: "estado", valor: "presionado", opcionesRegla: v.opcionesRegla })
  assert.deepEqual(o1, { tipo: "SetComportamiento", payload: { comportamiento: { id: regla.id, cuando: { sensor: ctx.pulsador, ...CONDICION } } } })
  const o2 = app.construirOperacionRegla({ regla, slot: "actuador", valor: ctx.led, opcionesRegla: v.opcionesRegla })
  assert.deepEqual(o2.payload.comportamiento, { id: regla.id, cuando: { sensor: ctx.pulsador }, entonces: { actuador: ctx.led } })
  const o3 = app.construirOperacionRegla({ regla, slot: "salida", valor: "encendido", opcionesRegla: v.opcionesRegla })
  assert.deepEqual(o3.payload.comportamiento.entonces, { accion: "encender" })
  ctx.servicio.cerrar()
})

test("T5 construirOperacionRegla: una regla NUEVA nace con el primer slot y SIN id", () => {
  const ctx = preparar()
  const v = vistaDe(ctx.servicio)
  const o = app.construirOperacionRegla({ regla: null, slot: "sensor", valor: ctx.pulsador, opcionesRegla: v.opcionesRegla })
  assert.deepEqual(o, { tipo: "SetComportamiento", payload: { comportamiento: { cuando: { sensor: ctx.pulsador } } } })
  ctx.servicio.cerrar()
})

test("T5 construirOperacionRegla: cambiar un slot de una regla con condición avanzada conserva la condición guardada", () => {
  const ctx = preparar()
  const avanzada = { sensor: ctx.pulsador, capacidad: "estadoBooleano", comparador: ">", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }
  setRegla(ctx, { cuando: avanzada, entonces: { actuador: ctx.led, accion: "encender" } })
  const v = vistaDe(ctx.servicio)
  const o = app.construirOperacionRegla({ regla: v.reglas[0], slot: "salida", valor: "encendido", opcionesRegla: v.opcionesRegla })
  assert.deepEqual(o.payload.comportamiento.cuando, avanzada)
  ctx.servicio.cerrar()
})

test("T5 elegirControlReglaParaFoco: el mismo (reglaId, slot) o null — nunca 'cualquiera'", () => {
  const disponibles = [{ reglaId: "beh-1", slot: "sensor" }, { reglaId: "beh-1", slot: "estado" }]
  assert.deepEqual(app.elegirControlReglaParaFoco(disponibles, { reglaId: "beh-1", slot: "estado" }), { reglaId: "beh-1", slot: "estado" })
  assert.equal(app.elegirControlReglaParaFoco(disponibles, { reglaId: "beh-9", slot: "estado" }), null)
  assert.equal(app.elegirControlReglaParaFoco(disponibles, null), null)
})

function armarControlador(ctx, { demora = false } = {}) {
  const enviados = []
  const notificaciones = []
  let liberar
  const controlador = app.crearControladorReglas({
    obtenerSnapshot: () => ({ revision: ctx.servicio.snapshot().revision, vista: vistaDe(ctx.servicio) }),
    enviar: async (sobre) => {
      enviados.push(sobre)
      if (demora) await new Promise((r) => { liberar = r })
      const r = ctx.servicio.aplicar({ idOperacion: `web-${enviados.length}`, actor: "navegador", ...sobre })
      return { resultado: r }
    },
    alCambiar: () => notificaciones.push({ pendiente: controlador.opciones().operacionPendiente }),
  })
  return { controlador, enviados, notificaciones, liberar: () => liberar() }
}

test("T5 controlador: 'Agregar regla' no crea nada; la regla nace con el primer selector; luego completa y queda con el texto canónico (Engine real)", async () => {
  const ctx = preparar()
  const { controlador, enviados } = armarControlador(ctx)
  controlador.agregar()
  assert.equal(enviados.length, 0)
  assert.equal(controlador.opciones().reglaNueva, true)
  assert.equal(ctx.servicio.snapshot().proyecto.comportamientos.length, 0)

  await controlador.cambiar({ reglaId: null, slot: "sensor", valor: ctx.pulsador })
  assert.equal(controlador.opciones().reglaNueva, false)
  assert.equal(enviados.length, 1)
  assert.equal(enviados[0].tipo, "SetComportamiento")
  assert.equal(enviados[0].payload.comportamiento.id, undefined)
  const id = ctx.servicio.snapshot().proyecto.comportamientos[0].id

  await controlador.cambiar({ reglaId: id, slot: "estado", valor: "presionado" })
  await controlador.cambiar({ reglaId: id, slot: "actuador", valor: ctx.led })
  await controlador.cambiar({ reglaId: id, slot: "salida", valor: "encendido" })
  assert.equal(enviados.length, 4)
  for (const s of enviados) assert.equal(typeof s.baseRevision, "number")
  assert.equal(vistaDe(ctx.servicio).reglas[0].texto, "Mientras el Pulsador esté presionado, el LED está encendido.")
  assert.equal(ctx.servicio.snapshot().proyecto.comportamientos.length, 1, "una sola regla: siempre la regla entera, nunca duplicada")
  ctx.servicio.cerrar()
})

test("T5 controlador: mientras hay una operación pendiente se deshabilita todo y un segundo cambio NO envía; al terminar se rehabilita", async () => {
  const ctx = preparar()
  const { controlador, enviados, notificaciones, liberar } = armarControlador(ctx, { demora: true })
  const primera = controlador.cambiar({ reglaId: null, slot: "sensor", valor: ctx.pulsador })
  assert.equal(controlador.opciones().operacionPendiente, true)
  assert.equal(await controlador.cambiar({ reglaId: null, slot: "actuador", valor: ctx.led }), false, "ignorado mientras hay una operación en vuelo")
  assert.equal(enviados.length, 1)
  liberar()
  await primera
  assert.equal(controlador.opciones().operacionPendiente, false)
  assert.deepEqual(notificaciones.map((n) => n.pendiente), [true, false], "se repinta deshabilitado y luego habilitado")
  assert.equal(enviados.length, 1, "una sola revisión nueva, sin stale falso")
  assert.equal(ctx.servicio.snapshot().revision, enviados[0].baseRevision + 1)
  ctx.servicio.cerrar()
})

test("T5 controlador: una operación externa (GPIO) en vuelo también bloquea la frase", async () => {
  const ctx = preparar()
  const { controlador, enviados } = armarControlador(ctx)
  controlador.marcarOperacionExterna(true)
  assert.equal(controlador.opciones().operacionPendiente, true)
  assert.equal(await controlador.cambiar({ reglaId: null, slot: "sensor", valor: ctx.pulsador }), false)
  assert.equal(enviados.length, 0)
  controlador.marcarOperacionExterna(false)
  assert.equal(controlador.opciones().operacionPendiente, false)
  ctx.servicio.cerrar()
})

test("T5 controlador: ignora 'avanzada' (no es editable) y un vaciado de slot; Quitar regla -> QuitarComportamiento {comportamiento:id}", async () => {
  const ctx = preparar()
  setRegla(ctx, { cuando: { sensor: ctx.pulsador, ...CONDICION }, entonces: { actuador: ctx.led, accion: "encender" } })
  const { controlador, enviados } = armarControlador(ctx)
  const id = vistaDe(ctx.servicio).reglas[0].id
  assert.equal(await controlador.cambiar({ reglaId: id, slot: "estado", valor: "avanzada" }), false)
  assert.equal(await controlador.cambiar({ reglaId: id, slot: "salida", valor: null }), false)
  assert.equal(enviados.length, 0)
  await controlador.quitar({ reglaId: id })
  assert.deepEqual({ tipo: enviados[0].tipo, payload: enviados[0].payload }, { tipo: "QuitarComportamiento", payload: { comportamiento: id } })
  assert.deepEqual(ctx.servicio.snapshot().proyecto.comportamientos, [])
  ctx.servicio.cerrar()
})

test("T5 controlador: quitar la frase vacía (aún no creada) sólo la cierra, sin enviar nada; la traza se abre y se cierra a pedido", async () => {
  const ctx = preparar()
  const { controlador, enviados } = armarControlador(ctx)
  controlador.agregar()
  await controlador.quitar({ reglaId: null })
  assert.equal(controlador.opciones().reglaNueva, false)
  assert.equal(enviados.length, 0)
  controlador.alternarTraza({ reglaId: "beh-1" })
  assert.deepEqual(controlador.opciones().trazasAbiertas, ["beh-1"])
  controlador.alternarTraza({ reglaId: "beh-1" })
  assert.deepEqual(controlador.opciones().trazasAbiertas, [])
  ctx.servicio.cerrar()
})
