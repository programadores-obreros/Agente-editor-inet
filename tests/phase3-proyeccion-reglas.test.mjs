// Phase 3 — Vertical semántico #1, T3: proyección DEL SERVIDOR de las reglas
// (`ModeloDeVista.reglas[]` / `opcionesRegla`, contrato B6; explicaciones de motivos).
// Todo determinista, sin LLM; el navegador sólo pinta lo que recibe.

import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, obtenerServicioDeProyecto, nuevoDir, nuevoIdProyecto, op, catalogo, prepararProyectoConLed, GPIO_Y } from "./phase2-helpers.mjs"

const { proyectarVista, explicarMotivos } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))

const TRIADA = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }
const ETIQUETA_TRAZA = "Explicación de la regla — no es una simulación ni lo que pasa en la placa."

function preparar(extra = []) {
  const directorio = nuevoDir("p3-vista")
  const idProyecto = nuevoIdProyecto("p3-vista")
  const { servicio, idComponente: led } = prepararProyectoConLed(directorio, idProyecto)
  const agregar = (tipo) => {
    const r = servicio.aplicar(op("AgregarComponente", { tipo }, servicio.snapshot().revision))
    assert.equal(r.ok, true)
    const comps = servicio.snapshot().proyecto.componentes
    return comps[comps.length - 1].id
  }
  const pulsador = agregar("pulsador")
  const r = servicio.aplicar(op("AsignarPin", { componente: pulsador, terminal: "senal", pin: GPIO_Y }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const ids = { led, pulsador }
  for (const t of extra) ids[t] = agregar(t)
  return { servicio, directorio, idProyecto, ...ids }
}
function set(ctx, comportamiento) {
  const r = ctx.servicio.aplicar(op("SetComportamiento", { comportamiento }, ctx.servicio.snapshot().revision))
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
}
function vista(ctx) {
  const v = proyectarVista(ctx.servicio.snapshot().proyecto, catalogo)
  assert.ok(Array.isArray(v.reglas), "ModeloDeVista expone reglas[]")
  assert.equal(typeof v.opcionesRegla, "object", "ModeloDeVista expone opcionesRegla")
  return v
}
const completa = (ctx, accion = "encender") => ({ cuando: { sensor: ctx.pulsador, ...TRIADA }, entonces: { actuador: ctx.led, accion } })

const PROHIBIDOS = [/estadoBooleano/, />=/, /cmp-/, /beh-/, /\bloop\b/, /\bdelay\b/, /millis/, /digitalRead/, /digitalWrite/, /\bif\b/]
function textosDe(valor, acc = []) {
  if (typeof valor === "string") acc.push(valor)
  else if (Array.isArray(valor)) valor.forEach((v) => textosDe(v, acc))
  else if (valor && typeof valor === "object") Object.values(valor).forEach((v) => textosDe(v, acc))
  return acc
}

test("T3 regla canónica completa: texto exacto, frase, traza con reposo apagado, sin 'si no'", () => {
  const ctx = preparar()
  set(ctx, completa(ctx))
  const [regla] = vista(ctx).reglas
  const id = ctx.servicio.snapshot().proyecto.comportamientos[0].id
  assert.equal(regla.id, id)
  assert.equal(regla.completa, true)
  assert.deepEqual(regla.faltan, [])
  assert.equal(regla.texto, "Mientras el Pulsador esté presionado, el LED está encendido.")
  assert.equal(regla.texto.toLowerCase().includes("si no"), false)
  assert.deepEqual(regla.frase, {
    sensor: { id: ctx.pulsador, etiqueta: "Pulsador" },
    estado: { clave: "presionado", etiqueta: "presionado" },
    actuador: { id: ctx.led, etiqueta: "LED" },
    salida: { clave: "encendido", etiqueta: "encendido" },
  })
  assert.deepEqual(regla.traza, {
    etiqueta: ETIQUETA_TRAZA,
    ramas: ["Si el Pulsador está presionado → la condición es verdadera → el LED está encendido.", "Si el Pulsador no está presionado → la condición es falsa → el LED está apagado (reposo)."],
  })
  ctx.servicio.cerrar()
})

const PARCIALES = [
  ["sólo sensor", (c) => ({ cuando: { sensor: c.pulsador } }), ["estado", "actuador", "salida"]],
  ["sólo actuador", (c) => ({ entonces: { actuador: c.led } }), ["sensor", "estado", "salida"]],
  ["sensor + triada", (c) => ({ cuando: { sensor: c.pulsador, ...TRIADA } }), ["actuador", "salida"]],
  ["actuador + acción", (c) => ({ entonces: { actuador: c.led, accion: "encender" } }), ["sensor", "estado"]],
]
for (const [nombre, forma, faltan] of PARCIALES) {
  test(`T3 regla parcial (${nombre}): completa:false, faltan, texto null, sin traza, motivos adjuntos`, () => {
    const ctx = preparar()
    set(ctx, forma(ctx))
    const [regla] = vista(ctx).reglas
    assert.equal(regla.completa, false)
    assert.deepEqual(regla.faltan, faltan)
    assert.equal(regla.texto, null)
    assert.equal(regla.traza, undefined)
    const inc = regla.motivos.find((m) => m.codigo === "COMPORTAMIENTO_INCOMPLETO")
    assert.ok(inc, "el motivo de la regla viaja adjunto")
    assert.equal(typeof inc.explicacion, "string")
    for (const m of regla.motivos) assert.deepEqual(m.entidad, { tipo: "comportamiento", id: regla.id })
    ctx.servicio.cerrar()
  })
}

test("T3 slots de la frase de una regla parcial: sólo lo presente", () => {
  const ctx = preparar()
  set(ctx, { entonces: { actuador: ctx.led, accion: "encender" } })
  const { frase } = vista(ctx).reglas[0]
  assert.deepEqual(Object.keys(frase).sort(), ["actuador", "salida"])
  ctx.servicio.cerrar()
})

test("T3 condición avanzada: otra comparación sobre el mismo estado, o un sensor de temperatura -> estado 'avanzada', texto null, sin traza", () => {
  const ctx = preparar(["dht22"])
  set(ctx, { cuando: { sensor: ctx.pulsador, capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 0, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: ctx.led, accion: "encender" } })
  set(ctx, { cuando: { sensor: ctx.pulsador, capacidad: "estadoBooleano", comparador: ">", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: ctx.led, accion: "encender" } })
  set(ctx, { cuando: { sensor: ctx.dht22, capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: ctx.led, accion: "encender" } })
  const reglas = vista(ctx).reglas
  assert.equal(reglas.length, 3)
  for (const r of reglas) {
    assert.deepEqual(r.frase.estado, { clave: "avanzada", etiqueta: "condición avanzada" })
    assert.equal(r.texto, null)
    assert.equal(r.traza, undefined)
    assert.equal(r.completa, true)
  }
  ctx.servicio.cerrar()
})

test("T3 etiquetas con ordinal estable: dos LED -> 'LED' y 'LED 2'; nunca ids internos como texto", () => {
  const ctx = preparar(["led"])
  const [led1, led2] = ctx.servicio.snapshot().proyecto.componentes.filter((c) => c.tipo === "led").map((c) => c.id)
  set(ctx, { cuando: { sensor: ctx.pulsador, ...TRIADA }, entonces: { actuador: led1, accion: "encender" } })
  set(ctx, { cuando: { sensor: ctx.pulsador, ...TRIADA }, entonces: { actuador: led2, accion: "encender" } })
  const v = vista(ctx)
  assert.deepEqual(v.reglas.map((r) => r.frase.actuador.etiqueta), ["LED", "LED 2"])
  assert.equal(v.reglas[1].texto, "Mientras el Pulsador esté presionado, el LED 2 está encendido.")
  assert.deepEqual(v.opcionesRegla.actuadores.map((a) => a.etiqueta), ["LED", "LED 2"])
  ctx.servicio.cerrar()
})

test("T3 apagar es el caso degenerado: ramas 'apagado' y nota explícita", () => {
  const ctx = preparar()
  set(ctx, completa(ctx, "apagar"))
  const [regla] = vista(ctx).reglas
  assert.equal(regla.texto, "Mientras el Pulsador esté presionado, el LED está apagado.")
  assert.equal(regla.frase.salida.clave, "apagado")
  assert.deepEqual(regla.traza.ramas, ["Si el Pulsador está presionado → la condición es verdadera → el LED está apagado.", "Si el Pulsador no está presionado → la condición es falsa → el LED está apagado (reposo)."])
  assert.equal(regla.traza.nota, "Esta regla no cambia nada visible.")
  ctx.servicio.cerrar()
})

test("T3 opcionesRegla: sensores por capacidad, actuadores por clase, estados y salidas cerradas; la resistencia no aparece; apagar no se ofrece", () => {
  const ctx = preparar(["resistencia"])
  const o = vista(ctx).opcionesRegla
  assert.deepEqual(o.sensores, [{ id: ctx.pulsador, etiqueta: "Pulsador" }])
  assert.deepEqual(o.actuadores, [{ id: ctx.led, etiqueta: "LED" }])
  // MOD (T5, aditivo): `estados[i]`/`salidas[i]` pueden traer además `condicion`/`accion`
  // (el payload canónico para el navegador, ver phase3-vista-reglas); acá sólo importan clave/etiqueta.
  assert.deepEqual(o.estados.map(({ clave, etiqueta }) => ({ clave, etiqueta })), [{ clave: "presionado", etiqueta: "presionado" }])
  assert.deepEqual(o.salidas.map(({ clave, etiqueta }) => ({ clave, etiqueta })), [{ clave: "encendido", etiqueta: "encendido" }])
  for (const lista of [o.sensores, o.actuadores]) assert.equal(lista.some((x) => x.id === ctx.resistencia), false)
  ctx.servicio.cerrar()
})

test("T3 sin reglas: reglas [] y readiness intacto (misma derivación del núcleo)", () => {
  const ctx = preparar()
  const v = vista(ctx)
  assert.deepEqual(v.reglas, [])
  assert.deepEqual(v.readiness, ctx.servicio.snapshot().validacion.readiness)
  ctx.servicio.cerrar()
})

test("T3 explicaciones de los códigos nuevos: texto llano, sin internos", () => {
  const ctx = preparar()
  set(ctx, { cuando: { sensor: ctx.led }, entonces: { actuador: ctx.pulsador } })
  const motivos = vista(ctx).motivos
  const por = (c) => motivos.find((m) => m.codigo === c)
  assert.equal(por("COMPORTAMIENTO_INCOMPLETO").explicacion, "A la regla le falta: qué estado de la entrada y qué hace la salida.")
  assert.equal(por("ACTUADOR_INVALIDO").explicacion, "Pulsador no es una salida: la regla no puede encenderlo. Elegí una salida.")
  assert.equal(por("SENSOR_INVALIDO").explicacion, "LED no entrega un estado que la regla pueda leer. Elegí una entrada.")
  const rem = explicarMotivos([{ codigo: "REMOCION_CON_DEPENDIENTES", categoria: "operacion", severidad: "blocking", clasificacion: "rechazo", datos: { componente: ctx.led } }], ctx.servicio.snapshot().proyecto, catalogo)
  assert.equal(rem[0].explicacion, "Este componente lo usa una regla. Quitá o cambiá la regla primero.")
  ctx.servicio.cerrar()
})

test("T3 faltan de cada tipo: la explicación nombra todo en lenguaje humano", () => {
  const ctx = preparar()
  set(ctx, { cuando: { sensor: ctx.pulsador } })
  const m = vista(ctx).reglas[0].motivos.find((x) => x.codigo === "COMPORTAMIENTO_INCOMPLETO")
  assert.equal(m.explicacion, "A la regla le falta: qué estado de la entrada, qué salida y qué hace la salida.")
  ctx.servicio.cerrar()
})

test("T3 GUARD: ningún texto proyectado (frases, trazas, etiquetas, explicaciones) filtra internos ni código", () => {
  const ctx = preparar(["dht22"])
  set(ctx, completa(ctx))
  set(ctx, completa(ctx, "apagar"))
  set(ctx, { cuando: { sensor: ctx.pulsador } })
  set(ctx, { entonces: { actuador: ctx.pulsador } })
  set(ctx, { cuando: { sensor: ctx.led }, entonces: { actuador: ctx.pulsador, accion: "encender" } })
  const v = vista(ctx)
  // los `id` son VALORES (nunca texto mostrado): se excluyen a propósito
  const textos = [...textosDe(v.reglas.map((r) => ({ texto: r.texto, traza: r.traza, estado: r.frase.estado, salida: r.frase.salida, sensor: r.frase.sensor?.etiqueta, actuador: r.frase.actuador?.etiqueta, explicaciones: r.motivos.map((m) => m.explicacion) }))), ...textosDe(v.opcionesRegla.estados.map((e) => e.etiqueta)), ...textosDe(v.opcionesRegla.salidas.map((e) => e.etiqueta)), ...v.motivos.filter((m) => ["COMPORTAMIENTO_INCOMPLETO", "ACTUADOR_INVALIDO", "SENSOR_INVALIDO"].includes(m.codigo)).map((m) => m.explicacion ?? "")]
  assert.ok(textos.length > 10)
  for (const t of textos) for (const re of PROHIBIDOS) assert.equal(re.test(t), false, `"${t}" contiene ${re}`)
  ctx.servicio.cerrar()
})

test("T3 recarga: la proyección de reglas es idéntica tras cerrar y reabrir el proyecto", () => {
  const ctx = preparar()
  set(ctx, completa(ctx))
  set(ctx, { cuando: { sensor: ctx.pulsador } })
  const antes = vista(ctx).reglas
  ctx.servicio.cerrar()
  ctx.servicio = obtenerServicioDeProyecto({ directorio: ctx.directorio, idProyecto: ctx.idProyecto })
  assert.deepEqual(vista(ctx).reglas, antes)
  assert.equal(antes.length, 2)
  ctx.servicio.cerrar()
})
