// Phase 2, Slice 1 — fix de ronda única red-team, Hallazgo B1 (MAJOR,
// P2-RED-B/INFORME.md, ataque A1): `nombreWokwiDePin()` tenía un fallback
// `` `D${numero}` `` para cualquier GPIO fuera de la tabla `ESP32_WOKWI_PIN` — un
// nombre INVENTADO, nunca verificado contra el bundle Wokwi real. Contra el bundle
// real (`opencode/tecniabot-web/wokwi-bundle.js`, instanciado con Chromium headless
// real, `el.pinInfo`), el `<wokwi-esp32-devkit-v1>` tiene EXACTAMENTE 30 pines —
// ninguno llamado `D0`/`D1`/`D3`/`D6`.../`D11`/`D37`/`D38`. Dos casos son peores que
// un hueco: GPIO1 y GPIO3 SÍ tienen pin físico real, pero con OTRO nombre (`TX0`/
// `RX0`), no `D1`/`D3`.
//
// Lista fija de los 30 nombres reales, citada del dump — ver
// `docs/wokwi-pinout-dump.md` (parcial, "…") y, completo, el informe
// `.../scratchpad/phase2/RED-B/INFORME.md` (ataque A1) +
// `.../evidencia/W5/B1/out/antes-inspect.txt` (dump propio de este writer,
// reproducido contra el MISMO bundle real del repo).
const PIN_INFO_REAL_ESP32_DEVKIT_V1 = Object.freeze([
  "3V3", "D12", "D13", "D14", "D15", "D18", "D19", "D2", "D21", "D22", "D23", "D25", "D26", "D27",
  "D32", "D33", "D34", "D35", "D4", "D5", "EN", "GND.1", "GND.2", "RX0", "RX2", "TX0", "TX2", "VIN", "VN", "VP",
])

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, prepararProyectoConLed, catalogo, op, GPIO_X } from "./phase2-helpers.mjs"

const { gpiosCandidatosPara, proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { nombreWokwiDePin } = await import(join(REPO, "opencode/vista-fisica/wokwi-render-datos.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))

test("B1: TODOS los GPIO que gpiosCandidatosPara ofrece para el anodo del LED en esp32-devkit-v1 tienen un nombreWokwi que existe REALMENTE en pinInfo (nunca D0/D1/D3/D6-D11/D37/D38 inventados)", () => {
  const dir = nuevoDir("b1-gpios-ofrecidos")
  const { servicio } = prepararProyectoConLed(dir, nuevoIdProyecto())
  const proyecto = servicio.snapshot().proyecto
  const terminalAnodo = catalogo.obtenerComponente("led").terminales.find((t) => t.id === "anodo")

  const opciones = gpiosCandidatosPara(catalogo, proyecto.placa, terminalAnodo)
  assert.ok(opciones.length > 0, "fixture: tiene que haber al menos un candidato")

  for (const opcion of opciones) {
    assert.ok(
      PIN_INFO_REAL_ESP32_DEVKIT_V1.includes(opcion.nombreWokwi),
      `${opcion.pinSemantico} -> "${opcion.nombreWokwi}" no existe en el pinInfo REAL del bundle Wokwi (fuente: RED-B/INFORME.md ataque A1) — nunca se ofrece un pin sin representacion fisica`,
    )
  }

  // Los 9 GPIO sin pin físico real (0, 6-11, 37, 38) NUNCA deben aparecer ofrecidos,
  // aunque asignarPin() los siga aceptando hoy (gap heredado de Phase 1, documentado
  // en DECISIONS.md — backlog, no se cierra acá).
  const semanticos = opciones.map((o) => o.pinSemantico)
  for (const sinPinFisico of ["GPIO0", "GPIO6", "GPIO7", "GPIO8", "GPIO9", "GPIO10", "GPIO11", "GPIO37", "GPIO38"]) {
    assert.ok(!semanticos.includes(sinPinFisico), `${sinPinFisico} no tiene pin fisico real en el renderer -- no se puede ofrecer, aunque el catalogo lo acepte`)
  }

  servicio.cerrar()
})

test("B1: GPIO1 se muestra como TX0 y GPIO3 como RX0 (nombre real, no D1/D3 inventados)", () => {
  const dir = nuevoDir("b1-gpio1-gpio3")
  const { servicio, idComponente } = prepararProyectoConLed(dir, nuevoIdProyecto())

  let n = servicio.snapshot().revision
  let r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: "GPIO1" }, n))
  assert.equal(r.ok, true, "GPIO1 tiene que ser aceptado por asignarPin() (uartUsb no esta filtrado hoy — gap heredado)")
  let vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  let cable = vista.cables.find((c) => c.hasta.terminal === "anodo")
  assert.equal(cable.desde.nombreWokwi, "TX0", "GPIO1 -> TX0, el nombre REAL del pin en el bundle (no D1)")
  assert.equal(vista.componentes[0].terminales.anodo.nombreWokwiPlaca, "TX0")

  n = servicio.snapshot().revision
  r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: "GPIO3" }, n))
  assert.equal(r.ok, true)
  vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  cable = vista.cables.find((c) => c.hasta.terminal === "anodo")
  assert.equal(cable.desde.nombreWokwi, "RX0", "GPIO3 -> RX0, el nombre REAL del pin en el bundle (no D3)")

  servicio.cerrar()
})

test("B1: nombreWokwiDePin devuelve null (nunca un D<n> inventado) para un GPIO sin pin fisico real", () => {
  const gpio6 = catalogo.pinesDePlaca("esp32-devkit-v1").find((p) => p.id === "GPIO6")
  assert.ok(gpio6, "fixture: GPIO6 existe en el catalogo (flash, gap heredado)")
  assert.equal(nombreWokwiDePin(gpio6), null, "sin pin fisico real -> null, nunca 'D6'")

  // D9 (PHASE_2_SLICE_1_HARDENING_DESIGN.md, gate final de hardening): GPIO37 ya NO
  // está en el registro (`nucleo/placas.ts::ESP32_GPIO_VALIDOS`) — no salen a ningún
  // pin del módulo WROOM que traen las escuelas (SKILL.md:82-85,
  // circuito.test.mjs:2524-2527), a diferencia de `circuito.ts`, que sí lo declara
  // válido y no se toca. El caso "sin pin físico real" queda cubierto por GPIO6 (flash,
  // arriba): esto ahora prueba que GPIO37 directamente no existe en el catálogo.
  const gpio37 = catalogo.pinesDePlaca("esp32-devkit-v1").find((p) => p.id === "GPIO37")
  assert.equal(gpio37, undefined, "GPIO37 ya no existe en el registro (D9) -- no sale a ningun pin del modulo WROOM en el DevKit v1")

  const gpio1 = catalogo.pinesDePlaca("esp32-devkit-v1").find((p) => p.id === "GPIO1")
  assert.ok(gpio1)
  assert.equal(nombreWokwiDePin(gpio1), "TX0")
})

test("B1: una asignacion a un GPIO SIN pin fisico (hecha por un agente, no ofrecida por el selector) se proyecta HONESTAMENTE, nunca oculta ni inventa un nombre", () => {
  const dir = nuevoDir("b1-asignacion-sin-pin-fisico")
  const { servicio, idComponente } = prepararProyectoConLed(dir, nuevoIdProyecto())

  // El "agente" (no el navegador/selector) asigna GPIO6 -- el catalogo lo acepta hoy
  // (gap heredado, asignarPin no mira restricciones), pero el renderer no tiene un
  // pin fisico real para el.
  const n = servicio.snapshot().revision
  const r = servicio.aplicar({ idOperacion: "op-agente-gpio6", actor: "agente", baseRevision: n, tipo: "AsignarPin", payload: { componente: idComponente, terminal: "anodo", pin: "GPIO6" } })
  assert.equal(r.ok, true, "fixture: el Engine acepta GPIO6 hoy (gap heredado documentado, no se cierra en este slice)")

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const terminalAnodo = vista.componentes[0].terminales.anodo
  assert.equal(terminalAnodo.estado, "asignado")
  assert.equal(terminalAnodo.pinSemantico, "GPIO6", "el pin semantico real SIGUE siendo visible -- nunca se oculta")
  assert.equal(terminalAnodo.nombreWokwiPlaca, null, "nunca se inventa un nombre Wokwi -- null es la proyeccion honesta de 'sin pin fisico'")

  const cable = vista.cables.find((c) => c.hasta.terminal === "anodo")
  assert.equal(cable.desde.nombreWokwi, null, "el cable tampoco inventa un nombre")

  // planDePintado (JS puro, lo que realmente pinta la fila de cable) tiene que
  // convertir ese `null` en un texto honesto -- nunca la palabra literal "null", y
  // nunca un nombre de pin inventado.
  const plan = planDePintado(vista)
  const filaCableAnodo = plan.find((i) => i.tipo === "filaCable" && (i.desde.includes("GPIO6") || i.hasta.includes("GPIO6")))
  assert.ok(filaCableAnodo, "la fila del cable tiene que mostrar el pin semantico GPIO6, aunque no tenga nombre Wokwi")
  assert.ok(!filaCableAnodo.desde.includes("null") && !filaCableAnodo.hasta.includes("null"), "nunca la palabra literal 'null' en el texto pintado")
  assert.match(filaCableAnodo.desde, /sin pin f[ií]sico/i, "el texto tiene que comunicar HONESTAMENTE que no hay pin fisico, no ocultarlo ni inventar uno")

  servicio.cerrar()
})
