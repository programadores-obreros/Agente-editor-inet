// Component System Foundation #1 — RT-9/D8 (human review: CONDITIONALLY ACCEPTED).
//
// PRINCIPIO: ComponentKnowledge es la autoridad de hechos electrónicos. La vista decide
// CÓMO presentar opciones, nunca QUÉ GPIO son válidos para un uso. Tres conceptos
// distintos, no equivalentes:
//   electricallyValid + logicalAssignable  → `ComponentKnowledge.pinesPermitidos`
//   representableByCurrentRenderer         → `nombreWokwiDePin(pin) !== null` (anexo)
// Opciones de la vista = pinesPermitidos ∩ representables. Nada más.
//
// 1. La vista no mantiene una lista electrónica propia (estático + equivalencia exacta).
// 2. Un GPIO no asignable para el uso no se ofrece (GPIO34–39 para el pulsador).
// 3. Un GPIO válido no se redefine como inválido porque el renderer no lo dibuje (GPIO0).
// 4. El Engine conserva su validación final.
// 5. No hay segunda fuente de verdad: la vista sigue a CUALQUIER conocimiento inyectado.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { gpiosCandidatosPara, proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { nombreWokwiDePin } = await import(join(REPO, "opencode/conocimiento/anexos/representacion.ts"))
const { CONOCIMIENTO_ACTIVO } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { crearConocimiento } = await import(join(REPO, "opencode/conocimiento/conocimiento.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))

const K = CONOCIMIENTO_ACTIVO
const catalogo = K.catalogo
const ids = (opciones) => opciones.map((o) => o.pinSemantico)

let n = 0
function proyectoCon(tipo, placa = "esp32-devkit-v1", cat = catalogo) {
  let p = { ...crearProyecto({ generadorId: () => "rt9", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: cat.version, catalogoHash: cat.hash }), placa }
  const r = ejecutarOperacion(p, { idOperacion: `rt9-${n++}`, actor: "agente", baseRevision: p.revision, tipo: "AgregarComponente", payload: { tipo } }, cat)
  assert.equal(r.ok, true, JSON.stringify(r.motivos))
  return r.proyecto
}
function asignar(p, terminal, pin, cat = catalogo) {
  return ejecutarOperacion(p, { idOperacion: `rt9-${n++}`, actor: "agente", baseRevision: p.revision, tipo: "AsignarPin", payload: { componente: "cmp-0", terminal, pin } }, cat)
}

// ── 1. sin lista electrónica propia ─────────────────────────────────────────────────

test("RT-9.1 (estático): snapshot-a-vista.ts no evalúa reglas eléctricas de pines por su cuenta", () => {
  const codigo = readFileSync(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
  for (const prohibido of [/\basignarPin\s*\(/, /\bevaluarRestriccionesPin\s*\(/, /\.restricciones\b/, /\.capacidades\.(entradaDigital|salidaDigital|pwm|adc|touch)\b/, /\benPoolAutomatico\b/, /soloEntrada|flashReservado|strapping|uartUsb/]) {
    assert.doesNotMatch(codigo, prohibido, `la vista no puede decidir validez eléctrica (${prohibido})`)
  }
  assert.match(codigo, /pinesPermitidos\(/, "las opciones tienen que salir de ComponentKnowledge")
})

test("RT-9.1: para TODA placa × tipo × terminal asignable, opciones de la vista = pinesPermitidos ∩ representables (ni más ni menos)", () => {
  let casos = 0
  for (const placa of catalogo.placas) {
    for (const componente of catalogo.componentes) {
      for (const terminal of componente.terminales.filter((t) => t.asignable)) {
        const esperado = placa.pines.filter((pin) => K.pinesPermitidos(placa.id, componente.id, terminal.id).some((p) => p.id === pin.id) && nombreWokwiDePin(pin) !== null).map((pin) => pin.id)
        assert.deepEqual(ids(gpiosCandidatosPara(K, placa.id, componente.id, terminal.id)), esperado, `${placa.id} ${componente.id}.${terminal.id}`)
        casos++
      }
    }
  }
  assert.ok(casos >= 8, `fixture: se recorrieron ${casos} casos`)
})

// ── 2. no asignable para el uso → no se ofrece ──────────────────────────────────────

test("RT-9.2: el pulsador en ESP32 NO ofrece GPIO34/35/36/39 (sin pull-up interno, bloqueante para el conocimiento)", () => {
  const vista = proyectarVista(proyectoCon("pulsador"), catalogo)
  const ofrecidos = ids(vista.gpiosDisponibles["cmp-0"].senal)
  assert.ok(ofrecidos.length > 0)
  for (const pin of ["GPIO34", "GPIO35", "GPIO36", "GPIO39"]) {
    assert.ok(!ofrecidos.includes(pin), `${pin} no se ofrece al pulsador`)
    assert.ok(!K.pinesPermitidos("esp32-devkit-v1", "pulsador", "senal").some((p) => p.id === pin), `${pin} tampoco está permitido en el conocimiento`)
  }
})

test("RT-9.2: los pines con aviso NO bloqueante (strapping, UART) se siguen ofreciendo: son válidos", () => {
  const ofrecidos = ids(gpiosCandidatosPara(K, "esp32-devkit-v1", "led", "anodo"))
  for (const pin of ["GPIO2", "GPIO12", "GPIO15", "GPIO1", "GPIO3"]) assert.ok(ofrecidos.includes(pin), pin)
})

// ── 3. válido pero no representable: límite de representación, no eléctrico ───────────

test("RT-9.3: GPIO0 sigue siendo válido/asignable para el conocimiento y el Engine, aunque la vista no lo ofrezca", () => {
  const gpio0 = catalogo.pinesDePlaca("esp32-devkit-v1").find((p) => p.id === "GPIO0")
  assert.equal(nombreWokwiDePin(gpio0), null, "fixture: el renderer actual no tiene pin físico para GPIO0")
  for (const [tipo, terminal] of [["led", "anodo"], ["pulsador", "senal"]]) {
    const permitido = K.pinesPermitidos("esp32-devkit-v1", tipo, terminal).find((p) => p.id === "GPIO0")
    assert.ok(permitido, `${tipo}.${terminal}: GPIO0 sigue permitido en el conocimiento (nunca se redefine como inválido)`)
    assert.deepEqual(permitido.avisos, ["PIN_STRAPPING"], "sólo un aviso no bloqueante")
    assert.ok(!ids(gpiosCandidatosPara(K, "esp32-devkit-v1", tipo, terminal)).includes("GPIO0"), `${tipo}.${terminal}: la vista lo excluye por representación`)
    const r = asignar(proyectoCon(tipo), terminal, "GPIO0")
    assert.equal(r.ok, true, "el Engine lo acepta")
    assert.ok(!validarProyecto(r.proyecto, catalogo).some((m) => m.codigo.startsWith("PIN_") && m.severidad === "blocking"), "y la validación no lo bloquea")
  }
})

// ── 4. el Engine conserva su validación final ───────────────────────────────────────

test("RT-9.4: si alguien asigna GPIO34 al pulsador por fuera de la vista, el Engine lo diagnostica como bloqueante", () => {
  const r = asignar(proyectoCon("pulsador"), "senal", "GPIO34")
  assert.equal(r.ok, true, "contrato existente: estado representable, se diagnostica (no se rechaza la operación)")
  const motivos = validarProyecto(r.proyecto, catalogo)
  assert.ok(motivos.some((m) => m.codigo === "PIN_SIN_PULLUP_INTERNO" && m.severidad === "blocking"), JSON.stringify(motivos))
  assert.equal(derivarReadiness(r.proyecto, motivos).listo, false)
})

test("RT-9.4: un pin que no existe o un terminal de potencia se siguen rechazando en la operación", () => {
  assert.equal(asignar(proyectoCon("led"), "anodo", "GPIO99").motivos[0].codigo, "PIN_INEXISTENTE_EN_PLACA")
  assert.equal(asignar(proyectoCon("led"), "anodo", "GND").motivos[0].codigo, "TERMINAL_NO_ASIGNABLE")
})

// ── 5. sin segunda fuente de verdad ─────────────────────────────────────────────────

test("RT-9.5: la vista sigue a un conocimiento inyectado arbitrario (no tiene criterio propio)", () => {
  const falso = { ...K, pinesPermitidos: () => [{ id: "GPIO4", etiquetas: [], recomendado: true, avisos: [] }] }
  assert.deepEqual(ids(gpiosCandidatosPara(falso, "esp32-devkit-v1", "led", "anodo")), ["GPIO4"])
  const vacio = { ...K, pinesPermitidos: () => [] }
  assert.deepEqual(gpiosCandidatosPara(vacio, "esp32-devkit-v1", "pulsador", "senal"), [])
})

test("RT-9.5: si cambia el DATO del catálogo (pulsador sin requierePullUpInterno), la vista cambia sola con el conocimiento", () => {
  const pulsador = COMPONENTES_CATALOGO_MINIMO.find((c) => c.id === "pulsador")
  const sinPullUp = { ...pulsador, terminales: pulsador.terminales.map((t) => (t.id === "senal" ? { ...t, requierePullUpInterno: false } : t)) }
  const otroCatalogo = construirCatalogo({ version: VERSION_CATALOGO_MINIMO, componentes: COMPONENTES_CATALOGO_MINIMO.map((c) => (c.id === "pulsador" ? sinPullUp : c)), placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }, sha256Hex)
  const vista = proyectarVista(proyectoCon("pulsador", "esp32-devkit-v1", otroCatalogo), otroCatalogo)
  const ofrecidos = ids(vista.gpiosDisponibles["cmp-0"].senal)
  assert.ok(ofrecidos.includes("GPIO34"), "sin la restricción en el dato, el conocimiento lo permite y la vista lo ofrece")
  assert.deepEqual(ofrecidos, ids(gpiosCandidatosPara(crearConocimiento(otroCatalogo), "esp32-devkit-v1", "pulsador", "senal")))
})
