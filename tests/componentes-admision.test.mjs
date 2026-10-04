// Component System Foundation #1 — F7: suite de admisión (Decision Freeze, D-13/D-17,
// 05-COMPONENT-ADMISSION-CONTRACT.md). Determinista, sin UI, sin IA.
//
// 1. La LISTA de oficialmente soportados está fijada: entrar o salir es un cambio
//    explícito y revisado.
// 2. Cada oficialmente soportado tiene todos sus flags (y ningún problema).
// 3. dht22/ntc siguen en el catálogo pero NO están oficialmente soportados, y la razón
//    queda a la vista.
// 4. Casos dorados de validación sin IA por tipo (check 12): requisito insatisfecho,
//    pin incompatible, terminal no asignable, terminal de potencia.
// 5. Los datos fuente no declaran `asignable` (sólo derivado, D-04).
// 6. Sensibilidad: romper un dato de un anexo apaga el flag que corresponde.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { admitirCatalogo, admitirComponente, admitirPlaca, oficialmenteSoportados, REVISION_ELECTRICA } = await import(join(REPO, "opencode/conocimiento/admision.ts"))
const { CONOCIMIENTO_ACTIVO } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearConocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento.ts"))
const { construirCatalogo, asignarPin, evaluarRequisito, evaluarRestriccionesPin } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))

const conocimiento = CONOCIMIENTO_ACTIVO
const catalogo = conocimiento.catalogo

const OFICIALES = ["esp32-devkit-v1", "led", "pulsador", "resistencia"]

// ════════════════════════════════════════════════════════════════════════════════════
// 1-3. Lista fijada y flags
// ════════════════════════════════════════════════════════════════════════════════════

test("F7: la lista de oficialmente soportados es EXACTAMENTE ESP32 + LED + resistencia + pulsador (D-17)", () => {
  assert.deepEqual(oficialmenteSoportados(conocimiento), OFICIALES)
})

test("F7: la suite recorre TODO el catálogo (cada placa y cada tipo tiene informe)", () => {
  const ids = admitirCatalogo(conocimiento).map((i) => i.id)
  assert.deepEqual(ids, [...catalogo.placas.map((p) => p.id), ...catalogo.componentes.map((c) => c.id)])
})

for (const id of OFICIALES) {
  test(`F7: ${id} pasa todos los flags de admisión, sin problemas`, () => {
    const informe = id === "esp32-devkit-v1" ? admitirPlaca(conocimiento, id) : admitirComponente(conocimiento, id)
    assert.deepEqual(informe.problemas, [])
    assert.equal(informe.flags.semantico, true)
    assert.equal(informe.flags.electrico, true)
    assert.equal(informe.flags.representacion.wokwi, true)
    assert.equal(informe.flags.pedagogia, true)
    assert.equal(informe.flags.procedencia, true)
    assert.notEqual(informe.flags.acciones, false)
    assert.equal(informe.officiallySupported, true)
  })
}

test("F7: el LED es actuador y su flag de acciones es true (no 'no aplica')", () => {
  assert.equal(admitirComponente(conocimiento, "led").flags.acciones, true)
  assert.equal(admitirComponente(conocimiento, "pulsador").flags.acciones, null)
})

for (const id of ["dht22", "ntc"]) {
  test(`F7: ${id} sigue en el catálogo pero NO está oficialmente soportado, con la razón a la vista`, () => {
    assert.ok(catalogo.obtenerComponente(id), "no se borra del catálogo (proyectos y tests lo usan)")
    const informe = admitirComponente(conocimiento, id)
    assert.equal(informe.officiallySupported, false)
    assert.equal(informe.flags.semantico, true, "el significado sí está completo")
    assert.equal(informe.flags.representacion.wokwi, false)
    assert.equal(informe.flags.electrico, false, "sin revisión eléctrica humana")
    assert.ok(informe.problemas.some((p) => p.startsWith("representacion.wokwi")))
  })
}

test("F7: el Arduino UNO tiene representación pero no revisión eléctrica: no es oficial en Foundation #1", () => {
  const informe = admitirPlaca(conocimiento, "arduino-uno")
  assert.equal(informe.flags.representacion.wokwi, true)
  assert.equal(informe.flags.electrico, false)
  assert.equal(informe.officiallySupported, false)
})

test("F7: la revisión eléctrica humana sólo existe para el conjunto inicial", () => {
  assert.deepEqual(Object.keys(REVISION_ELECTRICA).sort(), OFICIALES)
})

test("F7: un tipo inexistente no se admite (y no tira)", () => {
  const informe = admitirComponente(conocimiento, "servo")
  assert.equal(informe.officiallySupported, false)
  assert.equal(informe.flags.semantico, false)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 4. Casos dorados de validación sin IA (check 12)
// ════════════════════════════════════════════════════════════════════════════════════

let contadorOp = 0
const op = (tipo, payload, baseRevision) => ({ idOperacion: `adm-op-${contadorOp++}`, actor: "agente", baseRevision, tipo, payload })

function proyectoCon(tipo) {
  let p = crearProyecto({ generadorId: () => "adm-proy", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  p = { ...p, placa: "esp32-devkit-v1" }
  const r = ejecutarOperacion(p, op("AgregarComponente", { tipo }, p.revision), catalogo)
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  return r.proyecto
}

const pin = (id) => catalogo.pinesDePlaca("esp32-devkit-v1").find((p) => p.id === id)
const terminal = (tipo, id) => catalogo.obtenerComponente(tipo).terminales.find((t) => t.id === id)

test("F7 dorado LED: sin resistencia en serie → REQUISITO_INSATISFECHO; con resistencia → nada", () => {
  const led = catalogo.obtenerComponente("led")
  assert.deepEqual(evaluarRequisito(led, {}).map((m) => m.codigo), ["REQUISITO_INSATISFECHO"])
  assert.deepEqual(evaluarRequisito(led, { anodo: ["resistencia"] }), [])
})

test("F7 dorado LED: el ánodo (salida) no va a GPIO34 (sólo entrada) → CAPACIDAD_PIN_INCOMPATIBLE", () => {
  assert.equal(asignarPin(terminal("led", "anodo"), pin("GPIO34"))?.codigo, "CAPACIDAD_PIN_INCOMPATIBLE")
  assert.equal(asignarPin(terminal("led", "anodo"), pin("GPIO23")), null)
})

test("F7 dorado LED: el cátodo no es asignable → TERMINAL_NO_ASIGNABLE", () => {
  const p = proyectoCon("led")
  const r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: "catodo", pin: "GPIO23" }, p.revision), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE")
})

test("F7 dorado pulsador: en GPIO34 (sin pull-up interno) → PIN_SIN_PULLUP_INTERNO bloqueante", () => {
  const motivos = evaluarRestriccionesPin(terminal("pulsador", "senal"), pin("GPIO34"))
  assert.ok(motivos.some((m) => m.codigo === "PIN_SIN_PULLUP_INTERNO" && m.severidad === "blocking"))
})

test("F7 dorado pulsador: su gnd no es asignable → TERMINAL_NO_ASIGNABLE", () => {
  const p = proyectoCon("pulsador")
  const r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: "gnd", pin: "GPIO23" }, p.revision), catalogo)
  assert.equal(r.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE")
})

test("F7 dorado resistencia: ninguna pata es asignable (es un puente) → TERMINAL_NO_ASIGNABLE", () => {
  const p = proyectoCon("resistencia")
  for (const t of ["a", "b"]) {
    const r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: t, pin: "GPIO23" }, p.revision), catalogo)
    assert.equal(r.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE", t)
  }
  assert.equal(conocimiento.resolverDestino("esp32-devkit-v1", terminal("resistencia", "a")).kind, "puente")
})

test("F7 dorado ESP32: GND es conectable pero no asignable → TERMINAL_NO_ASIGNABLE {terminalDePotencia}", () => {
  const p = proyectoCon("led")
  const r = ejecutarOperacion(p, op("AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GND" }, p.revision), catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.motivos[0].codigo, "TERMINAL_NO_ASIGNABLE")
  assert.equal(r.motivos[0].datos.terminalDePotencia, true)
})

test("F7 dorado ESP32: un pin de flash es bloqueante (PIN_FLASH_RESERVADO) y no se ofrece", () => {
  const motivos = evaluarRestriccionesPin(terminal("led", "anodo"), pin("GPIO6"))
  assert.ok(motivos.some((m) => m.codigo === "PIN_FLASH_RESERVADO" && m.severidad === "blocking"))
  assert.ok(!conocimiento.pinesPermitidos("esp32-devkit-v1", "led", "anodo").some((p) => p.id === "GPIO6"))
})

// ════════════════════════════════════════════════════════════════════════════════════
// 5. `asignable` nunca es dato fuente
// ════════════════════════════════════════════════════════════════════════════════════

test("F7/D-04: ningún terminal de los datos fuente declara `asignable`; el catálogo construido sí lo trae", () => {
  for (const c of COMPONENTES_CATALOGO_MINIMO) for (const t of c.terminales) assert.equal(Object.hasOwn(t, "asignable"), false, `${c.id}.${t.id}`)
  for (const c of catalogo.componentes) for (const t of c.terminales) assert.equal(typeof t.asignable, "boolean", `${c.id}.${t.id}`)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 6. Sensibilidad de los flags
// ════════════════════════════════════════════════════════════════════════════════════

function catalogoCon(componentes) {
  return construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }, sha256Hex)
}

test("F7 sensibilidad: un requisito sin evaluador apaga `electrico` (no se finge validación)", () => {
  const led = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "led")
  const ledConPull = { ...led, requisitos: [...led.requisitos, { tipo: "resistencia-pull", enTerminal: "anodo", spec: {} }] }
  const otro = crearConocimiento(catalogoCon(COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === "led" ? ledConPull : c))))
  const informe = admitirComponente(otro, "led")
  assert.equal(informe.flags.electrico, false)
  assert.equal(informe.officiallySupported, false)
  assert.ok(informe.problemas.some((p) => p.includes("no tiene evaluador")))
})

test("F7 sensibilidad: un actuador con una acción no registrada apaga `acciones`", () => {
  const led = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "led")
  const otro = crearConocimiento(catalogoCon(COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === "led" ? { ...led, acciones: ["encender", "parpadear"] } : c))))
  const informe = admitirComponente(otro, "led")
  assert.equal(informe.flags.acciones, false)
  assert.equal(informe.officiallySupported, false)
})

test("F7 sensibilidad: un terminal nuevo sin ancla ni etiqueta apaga representación y pedagogía", () => {
  const pulsador = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "pulsador")
  const conVcc = { ...pulsador, terminales: [...pulsador.terminales, { id: "vcc", rol: "alimentacion", electrica: "riel-fijo", destinoFijo: "VLOGICA" }] }
  const otro = crearConocimiento(catalogoCon(COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === "pulsador" ? conVcc : c))))
  const informe = admitirComponente(otro, "pulsador")
  assert.equal(informe.flags.representacion.wokwi, false)
  assert.equal(informe.flags.pedagogia, false)
  assert.equal(informe.flags.electrico, true, "VLOGICA sí resuelve a un terminal de potencia")
})

test("F7 sensibilidad: un riel-fijo sin destino en un componente NO pasivo apaga `electrico`", () => {
  const pulsador = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "pulsador")
  const sinDestino = { ...pulsador, terminales: pulsador.terminales.map((t) => (t.id === "gnd" ? { id: "gnd", rol: "tierra", electrica: "riel-fijo" } : t)) }
  const otro = crearConocimiento(catalogoCon(COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === "pulsador" ? sinDestino : c))))
  assert.equal(admitirComponente(otro, "pulsador").flags.electrico, false)
})
