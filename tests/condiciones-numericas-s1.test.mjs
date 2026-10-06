// Numeric Conditions — S1 + CK-REQ-N1 Integration #1 (Design Gate #1 consolidado, N-1..N-11).
//
// Las condiciones numéricas de NIVEL ya existen en la IR. S1 las RECONOCE, las proyecta en la
// frase y en Blockly y permite editar su capacidad, comparador, número y unidad con el mismo
// `SetComportamiento` de siempre; el Engine sigue siendo la única autoridad.
//
// Todo lo que se sabe del mundo físico sale de la fachada REAL de Component Knowledge
// (CK-REQ-N1, congelado en 2581abc): `CONOCIMIENTO_ACTIVO` en producción. No hay dobles de
// conocimiento. Los únicos catálogos de prueba (construidos con el `construirCatalogo` real y
// leídos con el `crearConocimiento` real) existen para estados que el catálogo real no puede
// expresar hoy: una capacidad no disponible, una capacidad sin rótulo, una magnitud sin
// conversión declarada y una capacidad que desaparece. Cada uno dice por qué.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"
import { fabricarBlockly } from "./phase3-blockly-fake.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { crearConocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento.ts"))
const { CONOCIMIENTO_ACTIVO } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { oficialmenteSoportados } = await import(join(REPO, "opencode/conocimiento/admision.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { ROTULO_COMPARADOR, COMPLEMENTO_COMPARADOR, formatearNumero } = await import(join(REPO, "opencode/vista-fisica/condicion-numerica.ts"))
const { construirOperacionRegla, crearControladorReglas, interpretarNumero } = await import(join(REPO, "opencode/vista-fisica/web/app.js"))
const { proyectarModeloLogico } = await import(join(REPO, "opencode/vista-fisica/web/vista-logica.js"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { crearAdaptadorBlockly } = await import(join(REPO, "opencode/vista-fisica/web/adaptador-blockly.js"))
const { pintar } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))

const K = CONOCIMIENTO_ACTIVO

// ── fixture: ESP32 + pulsador cmp-0 + LED cmp-1 + LED 2 cmp-2 + resistencias + DHT22 cmp-5 + DHT22 2 cmp-6 + interruptor cmp-7 ──

let n = 0
function aplicar(servicio, tipo, payload, baseRevision) {
  return servicio.aplicar({ idOperacion: `nc-${n++}`, actor: "agente", baseRevision: baseRevision ?? servicio.snapshot().revision, tipo, payload })
}
function ok(servicio, tipo, payload) {
  const r = aplicar(servicio, tipo, payload)
  assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos ?? r)}`)
  return r
}
function proyecto() {
  const directorio = nuevoDir("numericas-s1")
  const idProyecto = nuevoIdProyecto("nc")
  const servicio = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  ok(servicio, "SetPlaca", { placa: "esp32-devkit-v1" })
  for (const tipo of ["pulsador", "led", "led", "resistencia", "resistencia", "dht22", "dht22", "interruptor"]) ok(servicio, "AgregarComponente", { tipo })
  ok(servicio, "AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO4" })
  ok(servicio, "AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" })
  ok(servicio, "AsignarPin", { componente: "cmp-2", terminal: "anodo", pin: "GPIO19" })
  ok(servicio, "AsignarPin", { componente: "cmp-5", terminal: "senal", pin: "GPIO27" })
  ok(servicio, "AsignarPin", { componente: "cmp-6", terminal: "senal", pin: "GPIO26" })
  ok(servicio, "AsignarPin", { componente: "cmp-7", terminal: "senal", pin: "GPIO13" })
  ok(servicio, "Conectar", { desde: { componente: "cmp-3", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } })
  ok(servicio, "Conectar", { desde: { componente: "cmp-4", terminal: "a" }, hasta: { componente: "cmp-2", terminal: "anodo" } })
  assert.equal(servicio.snapshot().validacion.readiness.listo, true, "fixture listo")
  return { servicio, directorio, idProyecto }
}
const umbral = (valor, unidad = "celsius", magnitud = "temperatura") => ({ valor, unidad, magnitud })
const numerica = (sensor, comparador, u, capacidad = "temperatura") => ({ sensor, capacidad, comparador, umbral: u })
const estado = (tipo, etiqueta) => K.estadosDeEntrada(tipo).find((e) => e.etiqueta === etiqueta).condicion

function conRegla(cuando, entonces = { actuador: "cmp-1", accion: "encender" }) {
  const ctx = proyecto()
  ok(ctx.servicio, "SetComportamiento", { comportamiento: { cuando, entonces } })
  return ctx
}
/** La vista de PRODUCCIÓN: la que arma el servicio con el catálogo y la fachada reales. */
const vista = (servicio) => servicio.snapshot().vista
const reglaDe = (servicio) => vista(servicio).reglas[0]
function cerrando(ctx, f) {
  try {
    return f(ctx)
  } finally {
    ctx.servicio.cerrar()
  }
}

/** Catálogo de prueba = catálogo real con UN cambio, leído con la fachada real. */
function catalogoCon(cambiar, conversiones = CONVERSIONES_UNIDAD_MINIMAS) {
  const cat = construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes: COMPONENTES_CATALOGO_MINIMO.map(cambiar), placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones } }, sha256Hex)
  return { cat, conocimiento: crearConocimiento(cat) }
}
const dht22Con = (cambiarCapacidades) => (c) => (c.id === "dht22" ? { ...c, capacidades: cambiarCapacidades(c.capacidades) } : c)

// ════════════════════════════════════════════════════════════════════════════════════
// 1–5, 32: los cuatro comparadores con conocimiento REAL; nunca más «condición avanzada»
// ════════════════════════════════════════════════════════════════════════════════════

const CASOS_COMPARADOR = [
  [">", 30, "encender", "Mientras la lectura de temperatura del DHT22 sea mayor a 30 °C, el LED está encendido.", "es menor o igual a 30 °C", "apagado"],
  ["<", 18, "apagar", "Mientras la lectura de temperatura del DHT22 sea menor a 18 °C, el LED está apagado.", "es mayor o igual a 18 °C", "encendido"],
  [">=", 25, "encender", "Mientras la lectura de temperatura del DHT22 sea mayor o igual a 25 °C, el LED está encendido.", "es menor a 25 °C", "apagado"],
  ["<=", 10, "encender", "Mientras la lectura de temperatura del DHT22 sea menor o igual a 10 °C, el LED está encendido.", "es mayor a 10 °C", "apagado"],
]
for (const [comparador, valor, accion, texto, falsa, reposo] of CASOS_COMPARADOR) {
  test(`1-5/32: '${comparador}' con Component Knowledge real → frase numérica, traza con complemento exacto, reposo; no «avanzada»`, () =>
    cerrando(conRegla(numerica("cmp-5", comparador, umbral(valor)), { actuador: "cmp-1", accion }), ({ servicio }) => {
      const r = reglaDe(servicio)
      assert.equal(r.texto, texto)
      assert.equal(r.aviso, null, "nunca «condición avanzada»")
      assert.notEqual(r.frase.estado.clave, "avanzada")
      assert.deepEqual(r.frase.capacidad, { clave: "temperatura", etiqueta: "temperatura" }, "rótulo de Component Knowledge, tal cual")
      assert.deepEqual(r.frase.comparador, { clave: comparador, etiqueta: ROTULO_COMPARADOR[comparador] })
      assert.deepEqual(r.frase.valor, { clave: String(valor), etiqueta: String(valor) })
      assert.deepEqual(r.frase.unidad, { clave: "celsius", etiqueta: "°C" }, "símbolo de Component Knowledge")
      assert.equal(r.traza.ramas[1], `Si la lectura de temperatura del DHT22 ${falsa} → la condición es falsa → el LED está ${reposo} (reposo).`)
      assert.equal(servicio.snapshot().validacion.readiness.listo, true)
    }))
}

test("2: complementos: tabla total y exacta (>↔<=, <↔>=); sin igualdad", () => {
  assert.deepEqual(Object.keys(ROTULO_COMPARADOR).sort(), [">", ">=", "<", "<="].sort())
  for (const [c, k] of Object.entries(COMPLEMENTO_COMPARADOR)) assert.equal(COMPLEMENTO_COMPARADOR[k], c)
  assert.equal(ROTULO_COMPARADOR["="], undefined)
})

test("5/29/30: rango REAL del catálogo sólo como ayuda (dicho como declarado), fuera de la frase; resolución null → nada", () =>
  cerrando(conRegla(numerica("cmp-5", ">", umbral(30.5))), ({ servicio }) => {
    assert.equal(K.capacidadCuantitativa("dht22", "temperatura").valor.resolucion, null, "precondición: el catálogo real no declara resolución")
    const r = reglaDe(servicio)
    assert.equal(r.ayuda, "Rango declarado en el catálogo: de 0 a 60 °C.")
    assert.equal(r.texto, "Mientras la lectura de temperatura del DHT22 sea mayor a 30,5 °C, el LED está encendido.")
    assert.ok(!r.texto.includes("Rango") && !r.traza.ramas.join(" ").includes("Rango"), "el rango no entra a la frase ni a la traza")
    assert.ok(!JSON.stringify(r).includes("resoluci"), "nada inventado sobre la resolución")
    assert.equal(formatearNumero(-2.25), "-2,25")
  }))

test("humedad (rótulo y unidad reales): «lectura de humedad relativa … %»", () =>
  cerrando(conRegla(numerica("cmp-5", "<", umbral(40, "porcentaje", "humedad"), "humedad")), ({ servicio }) => {
    const r = reglaDe(servicio)
    assert.equal(r.texto, "Mientras la lectura de humedad relativa del DHT22 sea menor a 40 %, el LED está encendido.")
    assert.equal(r.ayuda, "Rango declarado en el catálogo: de 0 a 100 %.")
  }))

// ════════════════════════════════════════════════════════════════════════════════════
// 6–9, 24–27, 31: Blockly, edición tipada, unidades con la conversión REAL
// ════════════════════════════════════════════════════════════════════════════════════

test("6: Blockly: «Mientras la lectura de [capacidad] del [entrada] sea [comparador] [número] [unidad]» + «hacer» [salida][estado]", () =>
  cerrando(conRegla(numerica("cmp-5", ">", umbral(30))), ({ servicio }) => {
    const modelo = proyectarModeloLogico(vista(servicio))
    assert.deepEqual(modelo.regla.campos.map((c) => [c.slot, c.prefijo, c.grupo, c.tipo ?? "opciones"]), [
      ["capacidad", "Mientras la lectura de", "cuando", "opciones"],
      ["sensor", "del", "cuando", "opciones"],
      ["comparador", "sea", "cuando", "opciones"],
      ["valor", "", "cuando", "numero"],
      ["unidad", "", "cuando", "opciones"],
      ["actuador", ", el", "entonces", "opciones"],
      ["salida", "está", "entonces", "opciones"],
    ])
    const { Blockly, reg } = fabricarBlockly()
    crearAdaptadorBlockly({ Blockly, contenedor: {}, alEditar() {}, alQuitar() {} }).pintar(modelo)
    const [mientras, hacer] = reg.ws.bloques
    assert.deepEqual(Object.keys(mientras.campos), ["capacidad", "sensor", "comparador", "valor", "unidad"])
    assert.deepEqual(mientras.etiquetas, ["Mientras la lectura de", "del", "sea"])
    assert.deepEqual(Object.keys(hacer.campos), ["actuador", "salida"])
    assert.ok(mientras.campos.valor instanceof Blockly.FieldTextInput)
    assert.equal(mientras.getFieldValue("valor"), "30")
    assert.deepEqual(mientras.campos.comparador.opciones.slice(1).map((o) => o[0]), ["mayor a", "menor a", "mayor o igual a", "menor o igual a"])
    assert.deepEqual(mientras.campos.unidad.opciones.slice(1), [["°C", "celsius"], ["°F", "fahrenheit"]], "sólo las unidades que la capacidad ofrece")
    assert.deepEqual(mientras.campos.capacidad.opciones.slice(1), [["temperatura", "temperatura"], ["humedad relativa", "humedad"]])
  }))

/** Snapshot autoritativo de producción + controlador real + Engine real. */
function conControlador(ctx) {
  const obtenerSnapshot = () => ({ revision: ctx.servicio.snapshot().revision, vista: vista(ctx.servicio) })
  const enviados = []
  const controlador = crearControladorReglas({
    obtenerSnapshot,
    enviar: async ({ tipo, payload, baseRevision }) => {
      enviados.push({ tipo, payload, baseRevision })
      return { resultado: aplicar(ctx.servicio, tipo, payload, baseRevision) }
    },
    alCambiar() {},
  })
  return { controlador, enviados, obtenerSnapshot }
}
const idDe = (ctx) => ctx.servicio.snapshot().proyecto.comportamientos[0].id
const cuandoDe = (ctx) => ctx.servicio.snapshot().proyecto.comportamientos[0].cuando

test("7: editar el número desde Blockly → UN SetComportamiento (mismo id) → Engine → IR → repintado", async () => {
  const ctx = conRegla(numerica("cmp-5", ">", umbral(30)))
  try {
    const { controlador, enviados, obtenerSnapshot } = conControlador(ctx)
    const antes = ctx.servicio.snapshot()
    const { Blockly, reg } = fabricarBlockly()
    const promesas = []
    const adaptador = crearAdaptadorBlockly({ Blockly, contenedor: {}, alEditar: (e) => promesas.push(controlador.cambiar(e)), alQuitar() {} })
    adaptador.pintar(proyectarModeloLogico(obtenerSnapshot().vista))
    reg.ws.bloques[0].campos.valor.setValue("25,5")
    await Promise.all(promesas)
    assert.equal(enviados.length, 1)
    const despues = ctx.servicio.snapshot()
    assert.equal(despues.revision, antes.revision + 1)
    assert.equal(despues.proyecto.comportamientos[0].id, antes.proyecto.comportamientos[0].id, "se edita la regla dueña")
    assert.deepEqual(cuandoDe(ctx), numerica("cmp-5", ">", umbral(25.5)), "sólo cambió el número")
    adaptador.pintar(proyectarModeloLogico(obtenerSnapshot().vista))
    assert.equal(reg.ws.bloques[0].getFieldValue("valor"), "25,5")
    assert.equal(reglaDe(ctx.servicio).texto, "Mientras la lectura de temperatura del DHT22 sea mayor a 25,5 °C, el LED está encendido.")
  } finally {
    ctx.servicio.cerrar()
  }
})

test("7b: un número inválido, vacío o igual al guardado NO se envía (gana el snapshot)", async () => {
  const ctx = conRegla(numerica("cmp-5", ">", umbral(30)))
  try {
    const { controlador, enviados } = conControlador(ctx)
    for (const valor of ["abc", "", "1e999", "Infinity", "0x1E", "30", " 30 "]) assert.equal(await controlador.cambiar({ reglaId: idDe(ctx), slot: "valor", valor }), false, valor)
    assert.equal(enviados.length, 0)
    assert.equal(interpretarNumero("30,5"), 30.5)
    assert.equal(interpretarNumero(" -2.25 "), -2.25)
    assert.equal(interpretarNumero("1e3"), null)
  } finally {
    ctx.servicio.cerrar()
  }
})

test("8: editar el comparador (los cuatro, N-2) → sólo cambia `comparador`; la traza usa el complemento", async () => {
  const ctx = conRegla(numerica("cmp-5", ">", umbral(30)))
  try {
    const { controlador } = conControlador(ctx)
    for (const comparador of ["<", ">=", "<=", ">"]) {
      const antes = cuandoDe(ctx)
      assert.equal(await controlador.cambiar({ reglaId: idDe(ctx), slot: "comparador", valor: comparador }), true)
      assert.deepEqual(cuandoDe(ctx), { ...antes, comparador })
      assert.ok(reglaDe(ctx.servicio).traza.ramas[1].includes(`es ${ROTULO_COMPARADOR[COMPLEMENTO_COMPARADOR[comparador]]} 30 °C`))
    }
  } finally {
    ctx.servicio.cerrar()
  }
})

test("24/25/26: cambiar SÓLO la unidad conserva la cantidad (conversión REAL de Component Knowledge): 30 °C → 86 °F → 30 °C; 18 → 64,4 → 18", async () => {
  for (const [c, f] of [[30, 86], [18, 64.4], [37.7, 99.86]]) {
    const ctx = conRegla(numerica("cmp-5", ">", umbral(c)))
    try {
      const { controlador } = conControlador(ctx)
      assert.equal(await controlador.cambiar({ reglaId: idDe(ctx), slot: "unidad", valor: "fahrenheit" }), true)
      assert.deepEqual(cuandoDe(ctx).umbral, umbral(f, "fahrenheit"), `${c} °C → ${f} °F`)
      assert.deepEqual(cuandoDe(ctx).umbral, { ...K.convertirParaCapacidad("dht22", "temperatura", umbral(c), "fahrenheit").valor }, "exactamente lo que devolvió Component Knowledge (sin redondeo de A)")
      assert.ok(reglaDe(ctx.servicio).texto.includes(`${formatearNumero(f)} °F`))
      assert.equal(await controlador.cambiar({ reglaId: idDe(ctx), slot: "unidad", valor: "celsius" }), true)
      assert.deepEqual(cuandoDe(ctx).umbral, umbral(c), `${f} °F → ${c} °C (ida y vuelta exacta, normalizada por B)`)
    } finally {
      ctx.servicio.cerrar()
    }
  }
})

test("27: una unidad sin conversión DECLARADA no se ofrece (catálogo de prueba: el real declara °C↔°F)", () =>
  cerrando(conRegla(numerica("cmp-5", ">", umbral(30))), ({ servicio }) => {
    // Por qué un catálogo de prueba: el catálogo real SÍ declara la conversión °C↔°F; acá se la quita.
    const { cat, conocimiento } = catalogoCon((c) => c, [])
    assert.deepEqual(conocimiento.capacidadCuantitativa("dht22", "temperatura").valor.unidades.map((u) => u.id), ["celsius"])
    const r = proyectarVista(servicio.snapshot().proyecto, cat, conocimiento).reglas[0]
    assert.deepEqual(r.slots.find((s) => s.slot === "unidad").opciones.map((o) => o.valor), ["celsius"], "sin conversión, ninguna otra unidad")
  }))

test("31: forma {ok, error} real: una unidad guardada ajena a la capacidad → las conversiones fallan → no se ofrece otra unidad; nada lanza", () =>
  cerrando(conRegla(numerica("cmp-5", ">", umbral(30, "cm", "distancia"))), ({ servicio }) => {
    const intento = K.convertirParaCapacidad("dht22", "temperatura", umbral(30, "cm", "distancia"), "fahrenheit")
    assert.equal(intento.ok, false)
    assert.equal(typeof intento.error.codigo, "string")
    const r = reglaDe(servicio)
    assert.deepEqual(r.slots.find((s) => s.slot === "unidad").opciones.map((o) => o.valor), [], "ninguna conversión válida desde «cm»")
    assert.deepEqual(r.frase.unidad, { clave: "cm", etiqueta: "cm" }, "pero la unidad guardada se ve, con el símbolo de Component Knowledge")
  }))

test("9: las capacidades ofrecidas dependen de la entrada ELEGIDA (Component Knowledge real, por tipo)", () =>
  cerrando(conRegla(numerica("cmp-5", ">", umbral(30))), ({ servicio }) => {
    const r = reglaDe(servicio)
    const capacidades = r.slots.find((s) => s.slot === "capacidad").opciones
    assert.deepEqual(capacidades.map((o) => [o.valor, o.etiqueta]), [["temperatura", "temperatura"], ["humedad", "humedad relativa"]])
    assert.deepEqual(capacidades[1].parche, { cuando: { capacidad: "humedad", umbral: { magnitud: "humedad", unidad: "porcentaje" } } })
    const sensores = r.slots.find((s) => s.slot === "sensor").opciones
    assert.deepEqual(sensores.map((o) => [o.etiqueta, o.reemplazaCuando ?? false]), [["Pulsador", true], ["DHT22", false], ["DHT22 2", false], ["Interruptor", true]], "N-10: las entradas sin esa capacidad reemplazan el cuando")
  }))

test("9b: cambiar de capacidad conserva el número y toma la unidad canónica de la nueva (dato de Component Knowledge)", async () => {
  const ctx = conRegla(numerica("cmp-5", ">", umbral(30)))
  try {
    const { controlador } = conControlador(ctx)
    assert.equal(await controlador.cambiar({ reglaId: idDe(ctx), slot: "capacidad", valor: "humedad" }), true)
    assert.deepEqual(cuandoDe(ctx), numerica("cmp-5", ">", umbral(30, "porcentaje", "humedad"), "humedad"))
    assert.equal(reglaDe(ctx.servicio).texto, "Mientras la lectura de humedad relativa del DHT22 sea mayor a 30 %, el LED está encendido.")
  } finally {
    ctx.servicio.cerrar()
  }
})

test("9c (N-10): otra instancia con la misma capacidad conserva la tríada; una entrada sin ella deja sólo `{sensor}` (sin rechazo evitable)", async () => {
  const ctx = conRegla(numerica("cmp-5", "<", umbral(18)))
  try {
    const { controlador } = conControlador(ctx)
    assert.equal(await controlador.cambiar({ reglaId: idDe(ctx), slot: "sensor", valor: "cmp-6" }), true)
    assert.deepEqual(cuandoDe(ctx), numerica("cmp-6", "<", umbral(18)))
    assert.equal(reglaDe(ctx.servicio).texto, "Mientras la lectura de temperatura del DHT22 2 sea menor a 18 °C, el LED está encendido.")
    const rev = ctx.servicio.snapshot().revision
    assert.equal(await controlador.cambiar({ reglaId: idDe(ctx), slot: "sensor", valor: "cmp-0" }), true)
    assert.equal(ctx.servicio.snapshot().revision, rev + 1, "el Engine aceptó (no hubo CAPACIDAD_NO_DECLARADA)")
    assert.deepEqual(cuandoDe(ctx), { sensor: "cmp-0" })
    assert.deepEqual(reglaDe(ctx.servicio).faltan, ["estado"], "queda incompleta pero representable")
  } finally {
    ctx.servicio.cerrar()
  }
})

test("evidencia N-10/L-3: con los slots GLOBALES (comportamiento previo) esas mismas ediciones eran un rechazo evitable del Engine", () =>
  cerrando(conRegla(numerica("cmp-5", ">", umbral(30))), ({ servicio }) => {
    const v = vista(servicio)
    const regla = { ...v.reglas[0], slots: undefined } // como antes: sin slots propios
    for (const [slot, valor] of [["sensor", "cmp-0"], ["estado", "presionado"]]) {
      const operacion = construirOperacionRegla({ regla, slot, valor, opcionesRegla: v.opcionesRegla })
      const r = aplicar(servicio, operacion.tipo, operacion.payload)
      assert.equal(r.ok, false, slot)
      assert.ok(r.motivos.some((m) => m.codigo === "CAPACIDAD_NO_DECLARADA"), `${slot}: ${JSON.stringify(r.motivos)}`)
    }
  }))

// ════════════════════════════════════════════════════════════════════════════════════
// 10–14: persistencia, recarga, repintado determinista, baseRevision vieja, incompleta
// ════════════════════════════════════════════════════════════════════════════════════

test("10/11/12: persiste, recarga idéntica y repinta igual (proyección y workspace deterministas)", () => {
  const { servicio, directorio, idProyecto } = conRegla(numerica("cmp-5", ">=", umbral(86, "fahrenheit")))
  const antes = servicio.snapshot()
  servicio.cerrar()
  const reabierto = obtenerServicioDeProyectoConVista({ directorio, idProyecto })
  try {
    const r = reabierto.snapshot()
    assert.deepEqual(r.proyecto, antes.proyecto, "la IR guardada no cambia (86 °F sigue siendo 86 °F)")
    assert.deepEqual(r.vista, antes.vista)
    assert.equal(antes.vista.reglas[0].texto, "Mientras la lectura de temperatura del DHT22 sea mayor o igual a 86 °F, el LED está encendido.", "N-9: sin «equivale a»")
    const { Blockly, reg } = fabricarBlockly()
    const eventos = []
    const adaptador = crearAdaptadorBlockly({ Blockly, contenedor: {}, alEditar: (e) => eventos.push(e), alQuitar() {} })
    adaptador.pintar(proyectarModeloLogico(r.vista))
    const creados = reg.bloquesCreados
    adaptador.pintar(proyectarModeloLogico(reabierto.snapshot().vista))
    assert.equal(reg.bloquesCreados, creados, "misma firma: no reconstruye")
    assert.deepEqual(eventos, [], "repintar no es editar")
  } finally {
    reabierto.cerrar()
  }
})

test("13: baseRevision vieja → BASE_REVISION_DESACTUALIZADA, la IR no cambia", () =>
  cerrando(conRegla(numerica("cmp-5", ">", umbral(30))), ({ servicio }) => {
    const s = servicio.snapshot()
    const operacion = construirOperacionRegla({ regla: s.vista.reglas[0], slot: "valor", valor: "40", opcionesRegla: s.vista.opcionesRegla })
    ok(servicio, "SetComportamiento", { comportamiento: { ...s.proyecto.comportamientos[0], cuando: { ...s.proyecto.comportamientos[0].cuando, comparador: "<" } } })
    const r = aplicar(servicio, operacion.tipo, operacion.payload, s.revision)
    assert.equal(r.ok, false)
    assert.ok(r.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA"))
    assert.equal(servicio.snapshot().proyecto.comportamientos[0].cuando.umbral.valor, 30)
  }))

test("14: condición numérica incompleta (`{sensor}`) sigue representable: persiste, faltan=estado", () =>
  cerrando(conRegla({ sensor: "cmp-5" }), ({ servicio }) => {
    const r = reglaDe(servicio)
    assert.equal(r.completa, false)
    assert.deepEqual(r.faltan, ["estado"])
    assert.equal(r.texto, null)
    assert.deepEqual(servicio.snapshot().proyecto.comportamientos[0].cuando, { sensor: "cmp-5" })
  }))

// ════════════════════════════════════════════════════════════════════════════════════
// 15–18, 28: unidad incompatible, fuera de rango, no disponible, catálogo distinto
// ════════════════════════════════════════════════════════════════════════════════════

test("15: unidad/magnitud incompatible persistida → se MUESTRA (valor y unidad guardados) + motivo blocking explicado; sin oración", () =>
  cerrando(conRegla(numerica("cmp-5", ">", umbral(30, "cm", "distancia"))), ({ servicio }) => {
    const s = servicio.snapshot()
    assert.ok(s.validacion.motivos.some((m) => m.codigo === "MAGNITUD_INCOMPATIBLE" && m.severidad === "blocking"))
    assert.equal(s.validacion.readiness.listo, false)
    const r = reglaDe(servicio)
    assert.equal(r.texto, null)
    assert.equal(r.aviso, null, "no es «condición avanzada»")
    assert.equal(r.frase.estado.clave, "numerica")
    assert.equal(r.motivos.find((x) => x.codigo === "MAGNITUD_INCOMPATIBLE").explicacion, "La regla compara la lectura de temperatura del DHT22 con 30 cm, que no es una unidad de temperatura. Elegí una unidad que corresponda.")
  }))

test("16: umbral fuera del rango declarado → warning visible, la frase sigue, el número no se toca", () =>
  cerrando(conRegla(numerica("cmp-5", ">", umbral(200))), ({ servicio }) => {
    const s = servicio.snapshot()
    const w = s.validacion.motivos.find((m) => m.codigo === "UMBRAL_FUERA_DE_RANGO")
    assert.equal(w.severidad, "warning")
    assert.equal(s.validacion.readiness.listo, true, "warning no bloquea")
    const r = reglaDe(servicio)
    assert.equal(r.texto, "Mientras la lectura de temperatura del DHT22 sea mayor a 200 °C, el LED está encendido.")
    assert.equal(r.motivos.find((x) => x.codigo === "UMBRAL_FUERA_DE_RANGO").explicacion, "El rango declarado en el catálogo para la lectura de temperatura del DHT22 es de 0 a 60 °C. 200 °C queda fuera de ese rango: revisá el número de la regla.")
    assert.equal(s.proyecto.comportamientos[0].cuando.umbral.valor, 200)
  }))

test("17 (N-4): capacidad guardada que hoy NO está disponible → sigue numérica y visible, con nota; no se ofrece para crear", () =>
  cerrando(conRegla(numerica("cmp-5", ">", umbral(70, "porcentaje", "humedad"), "humedad")), ({ servicio }) => {
    // Por qué un catálogo de prueba: en el catálogo real todas las capacidades cuantitativas
    // están disponibles. Un rango inválido (min > max) la vuelve NO disponible según B.
    const { cat, conocimiento } = catalogoCon(dht22Con((caps) => caps.map((k) => (k.id === "humedad" ? { ...k, rango: { min: k.rango.max, max: k.rango.min } } : k))))
    assert.deepEqual(conocimiento.capacidadCuantitativa("dht22", "humedad").valor.disponibilidadSemantica, { disponible: false, motivos: ["RANGO_INVALIDO"] })
    const v = proyectarVista(servicio.snapshot().proyecto, cat, conocimiento)
    const [r] = v.reglas
    assert.equal(r.texto, "Mientras la lectura de humedad relativa del DHT22 sea mayor a 70 %, el LED está encendido.")
    assert.equal(r.aviso, "Esta condición está guardada en el proyecto, pero todavía no se puede elegir para armar reglas nuevas.")
    assert.deepEqual(r.slots.find((s) => s.slot === "capacidad").opciones.map((o) => o.valor), ["temperatura"], "no se ofrece para crear")
    assert.equal(proyectarModeloLogico(v).regla.campos.find((c) => c.slot === "capacidad").valor, "humedad", "pero el valor guardado se ve")
  }))

test("28 (N-4): la disponibilidad semántica NO sale de officiallySupported", () => {
  const ctx = proyecto()
  try {
    // CK-CG1: el DHT22 pasó a ser oficial (revisión eléctrica humana); el ejemplo NO oficial es el NTC.
    assert.ok(oficialmenteSoportados(K).includes("dht22") && !oficialmenteSoportados(K).includes("ntc"), "precondición real: DHT22 oficial, NTC no")
    ok(ctx.servicio, "AgregarComponente", { tipo: "ntc" })
    assert.equal(K.capacidadCuantitativa("ntc", "temperatura").valor.disponibilidadSemantica.disponible, true)
    assert.deepEqual(vista(ctx.servicio).opcionesRegla.sensores.map((s) => s.etiqueta), ["Pulsador", "DHT22", "DHT22 2", "Interruptor", "Sensor de temperatura NTC"], "el NTC se ofrece aunque NO sea oficial: está semánticamente disponible")
    // Y al revés: sin disponibilidad, aunque el tipo sea OFICIAL y tenga la capacidad, no se ofrece.
    const { cat, conocimiento } = catalogoCon(dht22Con((caps) => caps.map((k) => ({ ...k, rango: { min: k.rango.max, max: k.rango.min } }))))
    assert.deepEqual(proyectarVista(ctx.servicio.snapshot().proyecto, cat, conocimiento).opcionesRegla.sensores.map((s) => s.etiqueta), ["Pulsador", "Interruptor", "Sensor de temperatura NTC"])
  } finally {
    ctx.servicio.cerrar()
  }
})

test("etiqueta null (B no la rotula) → no se inventa un nombre desde el id: «avanzada», nada se borra", () =>
  cerrando(conRegla(numerica("cmp-5", ">", umbral(30))), ({ servicio }) => {
    // Por qué un catálogo de prueba: todas las capacidades reales tienen rótulo. Se renombra la
    // capacidad a un id sin rótulo en el anexo (y la regla guardada usa ese id).
    const { cat, conocimiento } = catalogoCon(dht22Con((caps) => caps.map((k) => (k.id === "temperatura" ? { ...k, id: "temperatura-sin-rotulo" } : k))))
    assert.equal(conocimiento.capacidadCuantitativa("dht22", "temperatura-sin-rotulo").valor.etiqueta, null)
    const p = servicio.snapshot().proyecto
    const proyectoSinRotulo = { ...p, comportamientos: p.comportamientos.map((b) => ({ ...b, cuando: { ...b.cuando, capacidad: "temperatura-sin-rotulo" } })) }
    const [r] = proyectarVista(proyectoSinRotulo, cat, conocimiento).reglas
    assert.equal(r.frase.estado.clave, "avanzada")
    assert.equal(r.texto, null)
    assert.ok(!JSON.stringify(r.frase).includes("temperatura-sin-rotulo"), "el id nunca se muestra como rótulo")
  }))

test("18: catálogo distinto (la capacidad ya no existe) → motivo blocking visible y explicado; nada se reescribe", () =>
  cerrando(conRegla(numerica("cmp-5", ">", umbral(30))), ({ servicio }) => {
    // Por qué un catálogo de prueba: simula un catálogo futuro que ya no declara la capacidad.
    const { cat, conocimiento } = catalogoCon(dht22Con((caps) => caps.filter((k) => k.id !== "temperatura")))
    const antes = JSON.stringify(servicio.snapshot().proyecto)
    const [r] = proyectarVista(servicio.snapshot().proyecto, cat, conocimiento).reglas
    const m = r.motivos.find((x) => x.codigo === "CAPACIDAD_INEXISTENTE_EN_CATALOGO")
    assert.equal(m.severidad, "blocking")
    assert.equal(m.explicacion, "El DHT22 ya no ofrece la medición que usa esta regla. Elegí otra condición.")
    assert.equal(r.texto, null)
    assert.equal(JSON.stringify(servicio.snapshot().proyecto), antes)
  }))

// ════════════════════════════════════════════════════════════════════════════════════
// 19–21: regresiones booleanas (pulsador, interruptor, L-3) y Multi-Rule Safety
// ════════════════════════════════════════════════════════════════════════════════════

test("19: pulsador (booleano canónico) sin cambios: texto y traza byte a byte", () =>
  cerrando(conRegla({ sensor: "cmp-0", ...estado("pulsador", "presionado") }), ({ servicio }) => {
    const r = reglaDe(servicio)
    assert.equal(r.texto, "Mientras el Pulsador esté presionado, el LED está encendido.")
    assert.deepEqual(r.traza.ramas, ["Si el Pulsador está presionado → la condición es verdadera → el LED está encendido.", "Si el Pulsador no está presionado → la condición es falsa → el LED está apagado (reposo)."])
    assert.equal(r.frase.capacidad, undefined, "lo booleano no pasa por la API cuantitativa")
  }))

test("20: interruptor (booleano, D0) sin cambios; y L-3: cada regla ofrece los estados de SU entrada", () =>
  cerrando(conRegla({ sensor: "cmp-7", ...estado("interruptor", "cerrado") }), ({ servicio }) => {
    const v = vista(servicio)
    const [r] = v.reglas
    assert.equal(r.texto, "Mientras el Interruptor esté cerrado, el LED está encendido.")
    assert.equal(r.traza.ramas[1], "Si el Interruptor no está cerrado → la condición es falsa → el LED está apagado (reposo).")
    assert.deepEqual(v.opcionesRegla.estados.map((e) => e.etiqueta), ["presionado", "suelto", "cerrado", "abierto"], "la lista global mezcla entradas")
    assert.deepEqual(r.slots.find((s) => s.slot === "estado").opciones.map((o) => o.etiqueta), ["cerrado", "abierto"], "la regla ve sólo los de SU entrada")
  }))

test("21: Multi-Rule Safety sin cambios: numérica + booleana sobre el mismo LED → conflicto; traza numérica sin reposo ni ganador", () => {
  const ctx = conRegla(numerica("cmp-5", ">", umbral(30)), { actuador: "cmp-1", accion: "encender" })
  try {
    ok(ctx.servicio, "SetComportamiento", { comportamiento: { cuando: { sensor: "cmp-0", ...estado("pulsador", "presionado") }, entonces: { actuador: "cmp-1", accion: "apagar" } } })
    const s = ctx.servicio.snapshot()
    assert.equal(s.validacion.motivos.filter((m) => m.codigo === "MULTIPLES_AUTORIDADES_ACTUADOR").length, 2)
    assert.equal(s.validacion.readiness.listo, false)
    assert.deepEqual(s.vista.reglas.find((r) => r.frase.comparador).traza.ramas, [
      "Si la lectura de temperatura del DHT22 es mayor a 30 °C → la condición es verdadera → esta regla pide que el LED esté encendido.",
      "Esta regla no puede determinar por sí sola cómo queda el LED, porque otra regla también intenta gobernarlo.",
    ])
    ok(ctx.servicio, "SetComportamiento", { comportamiento: { ...s.proyecto.comportamientos[1], entonces: { actuador: "cmp-2", accion: "apagar" } } })
    assert.deepEqual(ctx.servicio.snapshot().validacion.motivos.filter((m) => m.codigo === "MULTIPLES_AUTORIDADES_ACTUADOR"), [], "en LED distintos, sin conflicto")
  } finally {
    ctx.servicio.cerrar()
  }
})

/** Lo que se lee en la frase pintada (pintar.js real con un DOM mínimo): controles entre corchetes. */
function textoDeFrasePintada(instruccion) {
  const nodo = (tag) => ({ tag, hijos: [], atributos: {}, textContent: "", value: "", setAttribute(k, v) { this.atributos[k] = String(v) }, appendChild(h) { this.hijos.push(h); return h }, addEventListener() {} })
  const raiz = pintar({ createElement: nodo }, [instruccion])
  const p = raiz.reglas.hijos[0].hijos[0]
  return p.hijos
    .map((h) => {
      if (h.tag === "select") return `[${(h.hijos.find((o) => o.atributos.value === h.value) ?? {}).textContent}]`
      if (h.tag === "input") return `[${h.value}]`
      return h.textContent
    })
    .join("")
}

test("frase editable: puntuación correcta y campo de número (sin coma suelta ni espacio antes de la coma)", () =>
  cerrando(conRegla(numerica("cmp-5", "<=", umbral(12.5))), ({ servicio }) => {
    const plan = planDePintado(vista(servicio), { reglaNueva: false, operacionPendiente: false, trazasAbiertas: [] })
    const frase = plan.find((i) => i.tipo === "reglaFrase")
    assert.deepEqual(frase.selectores.find((s) => s.slot === "valor"), { slot: "valor", prefijo: "", tipo: "numero", valorActual: "12,5", deshabilitado: false })
    assert.equal(frase.ayuda, "Rango declarado en el catálogo: de 0 a 60 °C.")
    assert.equal(textoDeFrasePintada(frase), "Mientras la lectura de [temperatura] del [DHT22] sea [menor o igual a] [12,5] [°C], el [LED] está [encendido].")
  }))

// ════════════════════════════════════════════════════════════════════════════════════
// 22–23: guardias de genericidad y de propiedad (sin conocimiento físico en A)
// ════════════════════════════════════════════════════════════════════════════════════

const PROHIBIDOS_FISICOS = [/\btemperatura\b/i, /\bhumedad\b/i, /\bdistancia\b/i, /\bluz\b/i, /\bcelsius\b/i, /\bfahrenheit\b/i, /°/, /\bcm\b/, /\bdht22\b/i, /\bntc\b/i, /hc-sr04/i, /\bldr\b/i, /\b1\.8\b/, /5\s*\/\s*9/, /toPrecision/, /\bucum\b/i]
const sinComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")

test("22: el módulo de condiciones numéricas no nombra nada del mundo físico ni normaliza números (ni en comentarios)", () => {
  const src = readFileSync(join(REPO, "opencode/vista-fisica/condicion-numerica.ts"), "utf8")
  for (const p of PROHIBIDOS_FISICOS) assert.ok(!p.test(src), `condicion-numerica.ts no puede contener ${p}`)
  assert.ok(!/from "\.\.\/nucleo\/registros|from "\.\.\/nucleo\/catalogo-datos|anexos\//.test(src), "no importa registros, datos de catálogo ni anexos de B: sólo la fachada")
})

test("22b/23: proyección, explicaciones y navegador: sin ramas por componente/capacidad/unidad ni tablas físicas en el CÓDIGO", () => {
  const archivos = ["opencode/vista-fisica/snapshot-a-vista.ts", "opencode/vista-fisica/explicaciones-motivos.ts", "opencode/vista-fisica/modelo-vista.ts", ...readdirSync(join(REPO, "opencode/vista-fisica/web")).filter((f) => f.endsWith(".js")).map((f) => `opencode/vista-fisica/web/${f}`)]
  for (const archivo of archivos) {
    const codigo = sinComentarios(readFileSync(join(REPO, archivo), "utf8"))
    for (const p of PROHIBIDOS_FISICOS) assert.ok(!p.test(codigo), `${archivo} no puede contener ${p} en código`)
  }
})
