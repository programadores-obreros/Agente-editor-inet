// Phase 3 — Pre-Human-Test Hardening, HD-W0-B (docs/programacion-intencion/
// PHASE_3_PRE_HUMAN_TEST_DESIGN.md §2): "la resistencia se ve en serie". Hoy
// `proyectarVista` arma los cables como DOS aristas independientes — pin→LED y
// LED↔Resistencia — y `wokwi-resistor` no está registrado, así que la pieza ni
// siquiera se dibuja (causa confirmada por EXP-B, `snapshot-a-vista.ts:207-236` +
// `wokwi-render-datos.ts:110-111`). El contrato visual (diseño §2): si (1) un
// terminal T de C está asignado a un pin, (2) el catálogo de C declara
// `resistencia-serie` con `enTerminal=T`, (3) existe EXACTAMENTE una `Conexion` real
// entre C.T y una instancia R del `spec.tipoComponente`, y (4) R no tiene otras
// conexiones, la proyección muestra la cadena P → R(pata libre) → R(pata conectada)
// → C(T).
//
// CORRECCIÓN del orquestador sobre EXP-B (no implementar "pata A" en los dos
// extremos — eso dibujaría una resistencia por la que no pasa corriente):
//   - del lado del GPIO: la pata que en la IR está LIBRE (B en el caso canónico);
//   - del lado del LED: la pata que la `Conexion` real une al terminal (A).
// Texto esperado: "GPIO18 (D18) → Resistencia (pata B)" ·
// "Resistencia (pata A) → LED (ánodo (+))" · "LED (cátodo (−)) → GND".
//
// Archivo NUEVO (mismo criterio que `tests/pht-engine.test.mjs`, HD-W0-A: "los tests
// nuevos van en un archivo nuevo", diseño §5). Casos B1-B8, ver diseño §2 fila "RED
// (topológico, no geométrico)". Fixtures construidas con `ejecutarOperacion`
// directo sobre la IR (mismo patrón que `pht-engine.test.mjs`), sin disco ni
// servidor: `proyectarVista`/`planDePintado` son funciones PURAS.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { construirCatalogoMinimoReal } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { ELEMENTO_WOKWI_POR_TIPO, TERMINAL_WOKWI_POR_TIPO } = await import(join(REPO, "opencode/vista-fisica/wokwi-render-datos.ts"))

const catalogo = construirCatalogoMinimoReal()

// ════════════════════════════════════════════════════════════════════════════════════
// Fixtures compartidas
// ════════════════════════════════════════════════════════════════════════════════════

let contadorOp = 0
function op(tipo, payload, baseRevision) {
  return { idOperacion: `pht-view-op-${contadorOp++}`, actor: "agente", baseRevision, tipo, payload }
}

function proyectoBase() {
  return crearProyecto({ generadorId: () => "pht-view-test", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
}

/** Aplica UNA operación sobre `p` y falla el test si la fixture es rechazada — la
 * aserción real de cada caso B nunca depende de esto, es sólo el armado del escenario. */
function aplicar(p, tipo, payload) {
  const r = ejecutarOperacion(p, op(tipo, payload, p.revision), catalogo)
  assert.equal(r.ok, true, `fixture: ${tipo}(${JSON.stringify(payload)}) rechazado: ${JSON.stringify(r.motivos)}`)
  return r.proyecto
}

/** ESP32 + un LED + una Resistencia, conectados (LED.anodo <-> Resistencia.a) ANTES
 * de asignar el pin — mismo orden que usó EXP-B para su demo real. Devuelve también
 * `idLed`/`idResistencia` para no hardcodear "cmp-0"/"cmp-1" en cada test. */
function agregarLedConResistencia(p, pinAnodo) {
  const idLed = `cmp-${p.siguienteIdLocal}`
  p = aplicar(p, "AgregarComponente", { tipo: "led" })
  const idResistencia = `cmp-${p.siguienteIdLocal}`
  p = aplicar(p, "AgregarComponente", { tipo: "resistencia" })
  p = aplicar(p, "Conectar", { desde: { componente: idLed, terminal: "anodo" }, hasta: { componente: idResistencia, terminal: "a" } })
  p = aplicar(p, "AsignarPin", { componente: idLed, terminal: "anodo", pin: pinAnodo })
  return { proyecto: p, idLed, idResistencia }
}

/** Caso canónico del diseño §2: ESP32 + LED (ánodo→GPIO18) + Resistencia, conectados. */
function proyectoCanonico() {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  return agregarLedConResistencia(p, "GPIO18")
}

// ════════════════════════════════════════════════════════════════════════════════════
// B1 — la pieza resistencia existe en la vista
// ════════════════════════════════════════════════════════════════════════════════════

test("B1: el proyecto canónico proyecta la instancia Resistencia con elementoWokwi wokwi-resistor (sin esto, la pieza no se dibuja)", () => {
  const { proyecto, idResistencia } = proyectoCanonico()
  const vista = proyectarVista(proyecto, catalogo)
  const resistencia = vista.componentes.find((c) => c.id === idResistencia)
  assert.ok(resistencia, `falta la instancia de la resistencia en vista.componentes: ${JSON.stringify(vista.componentes)}`)
  assert.equal(resistencia.tipo, "resistencia")
  assert.equal(resistencia.elementoWokwi, "wokwi-resistor", "ELEMENTO_WOKWI_POR_TIPO.resistencia tiene que registrar la pieza (gap confirmado por EXP-B)")
})

test("B1(b): el valor de la pieza sale del catálogo (spec.ohmios=220, catalogo-datos.ts:26), nunca un número hardcodeado en JS", () => {
  const { proyecto, idResistencia } = proyectoCanonico()
  const vista = proyectarVista(proyecto, catalogo)
  const resistencia = vista.componentes.find((c) => c.id === idResistencia)
  assert.equal(resistencia.atributos.value, "220")
})

test("una Resistencia huérfana (sin Conexion a nada) se dibuja pero no recibe un 'value' inventado", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  p = aplicar(p, "AgregarComponente", { tipo: "resistencia" })
  const vista = proyectarVista(p, catalogo)
  const resistencia = vista.componentes.find((c) => c.tipo === "resistencia")
  assert.equal(resistencia.elementoWokwi, "wokwi-resistor", "se dibuja igual, aunque no fusione con nada")
  assert.equal(resistencia.atributos.value, undefined, "sin fusión no hay ohmios conocidos de UNA instancia real — no se inventa")
})

// ════════════════════════════════════════════════════════════════════════════════════
// B2 — la cadena es P → R(libre), R(conectada) → C(T), nunca P → C(T) directo
// ════════════════════════════════════════════════════════════════════════════════════

test("B2: GPIO18 -> Resistencia(pata B, libre) y Resistencia(pata A, conectada) -> LED(ánodo) — nunca una arista directa GPIO->LED", () => {
  const { proyecto, idLed, idResistencia } = proyectoCanonico()
  const vista = proyectarVista(proyecto, catalogo)

  const cablePin = vista.cables.find((c) => c.id === `cable-pin-${idLed}-anodo`)
  assert.ok(cablePin, `falta el cable del pin: ${JSON.stringify(vista.cables)}`)
  assert.equal(cablePin.desde.tipo, "pinPlaca")
  assert.equal(cablePin.desde.pinSemantico, "GPIO18")
  assert.equal(cablePin.hasta.tipo, "terminal")
  assert.equal(cablePin.hasta.componente, idResistencia)
  assert.equal(cablePin.hasta.terminal, "b", "la pata LIBRE del lado del GPIO — nunca 'a' dos veces (corrección del orquestador sobre EXP-B)")

  const cableConexion = vista.cables.find((c) => c.id.startsWith("cable-conexion-"))
  assert.ok(cableConexion, `falta el cable de la conexión: ${JSON.stringify(vista.cables)}`)
  assert.equal(cableConexion.desde.tipo, "terminal")
  assert.equal(cableConexion.desde.componente, idResistencia)
  assert.equal(cableConexion.desde.terminal, "a", "la pata CONECTADA — la que la Conexion real une al ánodo")
  assert.equal(cableConexion.hasta.tipo, "terminal")
  assert.equal(cableConexion.hasta.componente, idLed)
  assert.equal(cableConexion.hasta.terminal, "anodo")

  const hayAristaDirecta = vista.cables.some((c) => c.desde.tipo === "pinPlaca" && c.hasta.tipo === "terminal" && c.hasta.componente === idLed && c.hasta.terminal === "anodo")
  assert.equal(hayAristaDirecta, false, "cuando la serie se proyecta, NUNCA debe quedar una arista pin->LED directa")
})

// ════════════════════════════════════════════════════════════════════════════════════
// B3 — misma cantidad de aristas; la única pata nueva tocada es la libre del pin
// ════════════════════════════════════════════════════════════════════════════════════

test("B3: la fusión no agrega aristas (siguen siendo 3: pin, riel del cátodo, conexión) — sólo reordena los extremos existentes", () => {
  const { proyecto, idResistencia } = proyectoCanonico()
  const vista = proyectarVista(proyecto, catalogo)
  assert.equal(vista.cables.length, 3, `conteo de aristas: ${JSON.stringify(vista.cables, null, 2)}`)

  const aristasQueTocanPataB = vista.cables.filter(
    (c) => (c.desde.tipo === "terminal" && c.desde.componente === idResistencia && c.desde.terminal === "b") || (c.hasta.tipo === "terminal" && c.hasta.componente === idResistencia && c.hasta.terminal === "b"),
  )
  assert.equal(aristasQueTocanPataB.length, 1, `la pata libre ('b') sólo puede aparecer en la arista fusionada del pin, nunca en una arista nueva: ${JSON.stringify(aristasQueTocanPataB)}`)
})

// ════════════════════════════════════════════════════════════════════════════════════
// B4 — etiquetas humanas (texto exacto del diseño §2)
// ════════════════════════════════════════════════════════════════════════════════════

test("B4: planDePintado muestra las 3 filas de cable exactas, con etiquetas humanas (contrato HD-W0-B)", () => {
  const { proyecto } = proyectoCanonico()
  const vista = proyectarVista(proyecto, catalogo)
  const plan = planDePintado(vista)
  const filas = plan
    .filter((i) => i.tipo === "filaCable")
    .map((i) => `${i.desde} → ${i.hasta}`)
    .sort()
  const esperado = ["GPIO18 (D18) → Resistencia (pata B)", "Resistencia (pata A) → LED (ánodo (+))", "LED (cátodo (−)) → GND"].sort()
  assert.deepEqual(filas, esperado)
})

// ════════════════════════════════════════════════════════════════════════════════════
// B5 — dos LEDs, cada uno con SU resistencia, nunca se mezclan
// ════════════════════════════════════════════════════════════════════════════════════

test("B5: dos LEDs con sus dos resistencias — cada pin va a SU resistencia, nunca a la del otro LED", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  const par1 = agregarLedConResistencia(p, "GPIO18")
  const par2 = agregarLedConResistencia(par1.proyecto, "GPIO19")
  const vista = proyectarVista(par2.proyecto, catalogo)

  for (const { idLed, idResistencia } of [par1, par2]) {
    const cablePin = vista.cables.find((c) => c.id === `cable-pin-${idLed}-anodo`)
    assert.ok(cablePin, `falta el cable de pin de ${idLed}`)
    assert.equal(cablePin.hasta.componente, idResistencia, `el pin de ${idLed} tiene que fusionar con SU resistencia (${idResistencia}), nunca con la otra`)
    const cableConexion = vista.cables.find((c) => c.desde.tipo === "terminal" && c.desde.componente === idResistencia)
    assert.ok(cableConexion, `falta el cable de conexión de ${idResistencia}`)
    assert.equal(cableConexion.hasta.componente, idLed, `la resistencia ${idResistencia} tiene que volver a SU led (${idLed})`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// B6 — una resistencia conectada a DOS LEDs → sin fusión en ninguno (fail-closed)
// ════════════════════════════════════════════════════════════════════════════════════

test("B6: una Resistencia conectada a DOS LEDs no fusiona con NINGUNO de los dos (ambiguo, fail-closed)", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  p = aplicar(p, "AgregarComponente", { tipo: "led" }) // cmp-0
  p = aplicar(p, "AgregarComponente", { tipo: "led" }) // cmp-1
  p = aplicar(p, "AgregarComponente", { tipo: "resistencia" }) // cmp-2
  p = aplicar(p, "Conectar", { desde: { componente: "cmp-0", terminal: "anodo" }, hasta: { componente: "cmp-2", terminal: "a" } })
  p = aplicar(p, "Conectar", { desde: { componente: "cmp-1", terminal: "anodo" }, hasta: { componente: "cmp-2", terminal: "a" } })
  p = aplicar(p, "AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO18" })
  p = aplicar(p, "AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: "GPIO19" })

  const vista = proyectarVista(p, catalogo)
  const cablePin0 = vista.cables.find((c) => c.id === "cable-pin-cmp-0-anodo")
  const cablePin1 = vista.cables.find((c) => c.id === "cable-pin-cmp-1-anodo")
  assert.ok(cablePin0 && cablePin1, `faltan cables de pin: ${JSON.stringify(vista.cables)}`)
  assert.equal(cablePin0.hasta.componente, "cmp-0", "sin fusión: el cable de pin de cmp-0 sigue yendo directo a SU propio terminal")
  assert.equal(cablePin0.hasta.terminal, "anodo")
  assert.equal(cablePin1.hasta.componente, "cmp-1", "sin fusión: el cable de pin de cmp-1 sigue yendo directo a SU propio terminal")
  assert.equal(cablePin1.hasta.terminal, "anodo")
})

// ════════════════════════════════════════════════════════════════════════════════════
// B7 — un LED sin resistencia conectada → como hoy (con REQUISITO_INSATISFECHO)
// ════════════════════════════════════════════════════════════════════════════════════

test("B7: LED sin Resistencia conectada — cable directo GPIO->LED, como siempre, y REQUISITO_INSATISFECHO en motivos", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  p = aplicar(p, "AgregarComponente", { tipo: "led" })
  p = aplicar(p, "AsignarPin", { componente: "cmp-0", terminal: "anodo", pin: "GPIO18" })

  const vista = proyectarVista(p, catalogo)
  const cablePin = vista.cables.find((c) => c.id === "cable-pin-cmp-0-anodo")
  assert.ok(cablePin)
  assert.equal(cablePin.hasta.tipo, "terminal")
  assert.equal(cablePin.hasta.componente, "cmp-0")
  assert.equal(cablePin.hasta.terminal, "anodo", "sin resistencia conectada, el cable sigue yendo directo al LED")
  assert.ok(
    vista.motivos.some((m) => m.codigo === "REQUISITO_INSATISFECHO"),
    `el requisito resistencia-serie sigue insatisfecho: ${JSON.stringify(vista.motivos)}`,
  )
})

// ════════════════════════════════════════════════════════════════════════════════════
// B8 — determinismo + la proyección nunca muta la IR
// ════════════════════════════════════════════════════════════════════════════════════

test("B8: proyectarVista es determinista (misma entrada -> misma vista) y nunca muta el Proyecto de entrada", () => {
  const { proyecto } = proyectoCanonico()
  const copia = JSON.parse(JSON.stringify(proyecto))
  const vista1 = proyectarVista(proyecto, catalogo)
  const vista2 = proyectarVista(proyecto, catalogo)
  assert.deepEqual(vista1, vista2, "misma entrada -> misma vista, siempre")
  assert.deepEqual(proyecto, copia, "proyectarVista no puede mutar el Proyecto de entrada (deep-equal antes/después)")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Registro de render (wokwi-render-datos.ts) — pieza + pines reales (EXP-B, Chromium)
// ════════════════════════════════════════════════════════════════════════════════════

test("wokwi-render-datos: la resistencia está registrada con sus pines REALES (1/2, nunca inventados — EXP-B, Chromium headless)", () => {
  assert.equal(ELEMENTO_WOKWI_POR_TIPO.resistencia, "wokwi-resistor")
  assert.deepEqual(TERMINAL_WOKWI_POR_TIPO.resistencia, { a: "1", b: "2" })
})
