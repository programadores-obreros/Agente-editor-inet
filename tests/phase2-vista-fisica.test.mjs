// Phase 2, Slice 1 — Vista física (adaptador IR → vista, ARCH-C,
// PHASE_2_SLICE_1_DESIGN.md §2.6) + plan de pintado (§2.6, JS plano). Fixture ESP32 +
// LED en GPIO_X (`tests/phase2-helpers.mjs`, GPIO4/GPIO16/GPIO18 ya verificados
// contra `nucleo/placas.ts` por W1). Test-first: ver evidencia RED/GREEN en
// `.../scratchpad/phase2/evidencia/W2/`.
//
// Cubre, en orden:
//  1. Forma básica de `proyectarVista` (placa, LED, cable GPIO_X->ánodo, cátodo->GND).
//  2. GPIO ofrecidos: consulta `asignarPin()` del catálogo, documenta qué filtra y qué no.
//  3. Determinismo de `proyectarVista`.
//  4. Invariante: cambiar el GPIO cambia SÓLO el cable y el pin (diff semántico).
//  5. Path A: motivo blocking en la entidad correcta, la vista se sigue proyectando.
//  6. `planDePintado` (JS plano): elementos, filas de cable, selector, panel de
//     motivos; determinismo; sin URLs externas.
//  7. Integración con la raíz de composición vía el hook `calcularVista` (sin tocar
//     `composicion-raiz.ts` — decisión registrada en PHASE_2_SLICE_1_PROTOCOL.md).
//  8. MUTANTE: un cable de pin fijo en vez de la IR tiene que morir.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, dirname } from "node:path"
import { obtenerServicioDeProyecto, catalogo, nuevoDir, nuevoIdProyecto, prepararProyectoConLed, op, GPIO_X, GPIO_Y, GPIO_Z } from "./phase2-helpers.mjs"

const TESTS_DIR = dirname(fileURLToPath(import.meta.url))
const REPO = join(TESTS_DIR, "..")

const { proyectarVista, gpiosCandidatosPara } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { vistaDeProyectoConCatalogoReal } = await import(join(REPO, "opencode/vista-fisica/vista-real.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))

// ════════════════════════════════════════════════════════════════════════════════════
// 0. circuito.ts NUNCA se importa desde vista-fisica (prohibido en Fase 1)
// ════════════════════════════════════════════════════════════════════════════════════

test("vista-fisica/ (snapshot-a-vista, wokwi-render-datos, vista-real) no importa circuito.ts", () => {
  for (const archivo of ["snapshot-a-vista.ts", "wokwi-render-datos.ts", "vista-real.ts"]) {
    const contenido = readFileSync(join(REPO, "opencode/vista-fisica", archivo), "utf8")
    assert.ok(!/from\s+["'][^"']*circuito(\.ts)?["']/.test(contenido), `${archivo} no debe importar circuito.ts`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 1. Forma básica
// ════════════════════════════════════════════════════════════════════════════════════

test("proyectarVista: placa wokwi-esp32-devkit-v1, LED con cable GPIO_X->anodo (nombre Wokwi correcto) y catodo->GND por riel fijo", () => {
  const dir = nuevoDir("vista-forma")
  const { servicio, idComponente } = prepararProyectoConLed(dir, nuevoIdProyecto()) // LED en GPIO_X = GPIO4

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)

  assert.equal(vista.placa.id, "esp32-devkit-v1")
  assert.equal(vista.placa.elementoWokwi, "wokwi-esp32-devkit-v1", "dato OPACO de nucleo/placas.ts, circuito.ts:640")

  assert.equal(vista.componentes.length, 1)
  const led = vista.componentes[0]
  assert.equal(led.id, idComponente)
  assert.equal(led.tipo, "led")
  assert.equal(led.elementoWokwi, "wokwi-led")

  assert.equal(led.terminales.anodo.estado, "asignado")
  assert.equal(led.terminales.anodo.pinSemantico, GPIO_X)
  assert.equal(led.terminales.anodo.nombreWokwiPlaca, "D4", "GPIO4 -> D4 (circuito.ts:625, portado en wokwi-render-datos.ts)")
  assert.equal(led.terminales.catodo.estado, "rielFijo")
  assert.equal(led.terminales.catodo.destino, "GND", "catalogo-datos.ts:23 (LED.terminales.catodo.destinoFijo)")

  const cableAnodo = vista.cables.find((c) => c.hasta.tipo === "terminal" && c.hasta.terminal === "anodo")
  assert.ok(cableAnodo, "hay un cable hacia el anodo del LED")
  assert.equal(cableAnodo.desde.tipo, "pinPlaca")
  assert.equal(cableAnodo.desde.pinSemantico, GPIO_X)
  assert.equal(cableAnodo.desde.nombreWokwi, "D4")

  const cableCatodo = vista.cables.find((c) => c.desde.tipo === "terminal" && c.desde.terminal === "catodo")
  assert.ok(cableCatodo, "hay un cable desde el catodo del LED — el catodo va a GND, se muestra siempre")
  assert.equal(cableCatodo.hasta.tipo, "rielFijo")
  assert.equal(cableCatodo.hasta.destino, "GND")

  servicio.cerrar()
})

test("proyectarVista es JSON-plano: JSON.parse(JSON.stringify(vista)) da deepEqual a vista", () => {
  const dir = nuevoDir("vista-json-plano")
  const { servicio } = prepararProyectoConLed(dir, nuevoIdProyecto())
  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  assert.deepEqual(JSON.parse(JSON.stringify(vista)), vista)
  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// 2. GPIO ofrecidos — sólo consulta asignarPin(), documenta qué filtra y qué no
// ════════════════════════════════════════════════════════════════════════════════════

test("gpiosDisponibles incluye GPIO16/GPIO18 (validos, verificados en phase2-helpers.mjs) y excluye los soloEntrada que asignarPin() rechaza", () => {
  const dir = nuevoDir("vista-gpios")
  const { servicio, idComponente } = prepararProyectoConLed(dir, nuevoIdProyecto())
  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)

  const opciones = vista.gpiosDisponibles[idComponente].anodo
  const semanticos = opciones.map((o) => o.pinSemantico)

  assert.ok(semanticos.includes(GPIO_Y), "GPIO16 es candidato valido (salidaDigital, nucleo/placas.ts)")
  assert.ok(semanticos.includes(GPIO_Z), "GPIO18 es candidato valido")

  // Evidencia de qué SÍ filtra asignarPin(): los 4 soloEntrada del ESP32
  // (nucleo/placas.ts::ESP32_GPIO_SOLO_ENTRADA = [34,35,36,39]) tienen
  // capacidades.salidaDigital=false — asignarPin() para un terminal "salida" los
  // rechaza (CAPACIDAD_PIN_INCOMPATIBLE), así que quedan afuera de la lista.
  for (const soloEntrada of ["GPIO34", "GPIO35", "GPIO36", "GPIO39"]) {
    assert.ok(!semanticos.includes(soloEntrada), `${soloEntrada} es soloEntrada: asignarPin() lo rechaza para un terminal de salida`)
  }

  // Límite conocido, heredado y documentado (esta vista NO lo cierra):
  // `asignarPin()` nunca mira `RegistroPin.restricciones` (flashReservado/strapping/
  // uartUsb) — ningún validador de Fase 1 lo consume hoy (`rg restriccion -i` sobre
  // validar-tecnico.ts/catalogo.ts da cero resultados, informe ARCH-C §7.1). GPIO6
  // (flash) y GPIO2 (strapping) SÍ pasan asignarPin() hoy. Si un cambio futuro en
  // `nucleo/catalogo.ts` cerrara este gap, este assert se pondría en rojo — señal de
  // que hay que revisar esta nota, no de que el módulo de vista se rompió.
  assert.ok(semanticos.includes("GPIO6"), "gap heredado: flashReservado no está filtrado por asignarPin() hoy")
  assert.ok(semanticos.includes("GPIO2"), "gap heredado: strapping no está filtrado por asignarPin() hoy")

  servicio.cerrar()
})

test("gpiosCandidatosPara: sin placa elegida (placaId === null) da SIEMPRE []", () => {
  const terminalAnodo = catalogo.obtenerComponente("led").terminales.find((t) => t.id === "anodo")
  assert.deepEqual(gpiosCandidatosPara(catalogo, null, terminalAnodo), [])
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3. Determinismo
// ════════════════════════════════════════════════════════════════════════════════════

test("proyectarVista es determinista: dos llamadas SIN cambios en el medio dan deepEqual", () => {
  const dir = nuevoDir("vista-determinista")
  const { servicio } = prepararProyectoConLed(dir, nuevoIdProyecto())
  const proyecto = servicio.snapshot().proyecto

  const v1 = proyectarVista(proyecto, catalogo)
  const v2 = proyectarVista(proyecto, catalogo)
  assert.deepEqual(v1, v2)
  assert.equal(JSON.stringify(v1), JSON.stringify(v2))

  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// 4. Invariante: cambiar el GPIO cambia SÓLO el cable y el pin
// ════════════════════════════════════════════════════════════════════════════════════

function clavesQueCambiaron(a, b) {
  const claves = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...claves].filter((clave) => JSON.stringify(a[clave]) !== JSON.stringify(b[clave])).sort()
}

test("cambiar el GPIO del LED (reusando el servicio + AsignarPin) cambia SOLO cables/componentes[].terminales.anodo — el resto de la vista queda identico", () => {
  const dir = nuevoDir("vista-invariante")
  const { servicio, idComponente } = prepararProyectoConLed(dir, nuevoIdProyecto()) // GPIO_X

  const antes = proyectarVista(servicio.snapshot().proyecto, catalogo)

  const n = servicio.snapshot().revision
  const r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Y }, n))
  assert.equal(r.ok, true)

  const despues = proyectarVista(servicio.snapshot().proyecto, catalogo)

  assert.deepEqual(
    clavesQueCambiaron(antes, despues),
    ["cables", "componentes"],
    "placa/gpiosDisponibles/motivos/readiness quedan identicos: los candidatos ofrecidos no dependen del pin ACTUALMENTE asignado",
  )
  assert.deepEqual(antes.gpiosDisponibles, despues.gpiosDisponibles)
  assert.deepEqual(antes.motivos, despues.motivos, "mismos motivos: ambos GPIO son compatibles, ninguno ocupado por otro componente")
  assert.deepEqual(antes.readiness, despues.readiness)

  const ledAntes = antes.componentes[0]
  const ledDespues = despues.componentes[0]
  assert.deepEqual(ledDespues.terminales.catodo, ledAntes.terminales.catodo, "el catodo no se toca")
  assert.equal(ledAntes.terminales.anodo.pinSemantico, GPIO_X)
  assert.equal(ledDespues.terminales.anodo.pinSemantico, GPIO_Y)

  const cableAnodoAntes = antes.cables.find((c) => c.hasta.terminal === "anodo")
  const cableAnodoDespues = despues.cables.find((c) => c.hasta.terminal === "anodo")
  assert.equal(cableAnodoAntes.desde.pinSemantico, GPIO_X)
  assert.equal(cableAnodoDespues.desde.pinSemantico, GPIO_Y)
  assert.equal(cableAnodoDespues.desde.nombreWokwi, "RX2", "GPIO16 -> RX2 (circuito.ts:627, portado)")

  const cableCatodoAntes = antes.cables.find((c) => c.desde.terminal === "catodo")
  const cableCatodoDespues = despues.cables.find((c) => c.desde.terminal === "catodo")
  assert.deepEqual(cableCatodoAntes, cableCatodoDespues, "el cable del catodo no se toca")

  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// 5. Path A: motivo blocking en la entidad correcta, la vista se sigue proyectando
// ════════════════════════════════════════════════════════════════════════════════════

test("Path A (REQUISITO_INSATISFECHO, LED sin resistencia en serie): el motivo blocking aparece en la ENTIDAD correcta y la vista se sigue proyectando completa", () => {
  const dir = nuevoDir("vista-path-a")
  const { servicio, idComponente } = prepararProyectoConLed(dir, nuevoIdProyecto())

  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)

  const motivoBlocking = vista.motivos.find((m) => m.codigo === "REQUISITO_INSATISFECHO")
  assert.ok(motivoBlocking, "el catalogo real exige una resistencia en serie para el LED (catalogo-datos.ts:26) — sin ella, REQUISITO_INSATISFECHO")
  assert.equal(motivoBlocking.severidad, "blocking")
  assert.deepEqual(motivoBlocking.entidad, { tipo: "componente", id: idComponente }, "el motivo apunta a la ENTIDAD correcta (el LED)")

  assert.equal(vista.readiness.invalido, true)
  assert.equal(vista.readiness.listo, false)

  // "la vista se sigue proyectando": no hay throw ni una vista vacia/parcial — sigue
  // trayendo placa, componente, cables y candidatos, exactamente igual que sin blocking.
  assert.ok(vista.placa)
  assert.equal(vista.componentes.length, 1)
  assert.ok(vista.cables.length >= 2, "cable del anodo + cable del catodo, aunque el proyecto este blocking")
  assert.ok(vista.gpiosDisponibles[idComponente].anodo.length > 0)

  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// 6. planDePintado — determinista, sin URLs externas
// ════════════════════════════════════════════════════════════════════════════════════

test("planDePintado: crea la placa y el LED, filas de cable con sus etiquetas, selector de GPIO con el valor actual y panel de motivos", () => {
  const dir = nuevoDir("plan-forma")
  const { servicio, idComponente } = prepararProyectoConLed(dir, nuevoIdProyecto())
  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)

  const plan = planDePintado(vista)

  const crearPlaca = plan.find((i) => i.tipo === "crearElemento" && i.entidad.tipo === "placa")
  assert.ok(crearPlaca)
  assert.equal(crearPlaca.tag, "wokwi-esp32-devkit-v1")
  // La pieza Wokwi reserva su propio tamaño de layout (fijo, en su Shadow DOM) sin
  // importar la escala — `transform:scale()` sólo agranda visualmente (mismo
  // comportamiento documentado en circuito.ts:93-99). Sin este estilo la placa SE VE
  // (tamaño nativo, no cero), pero más chica que la escala pensada para este catálogo
  // (`wokwi-render-datos.ts::ESCALA_WOKWI_POR_PLACA`, "esp32-devkit-v1": 1.25, citando
  // circuito.ts:641) — `vista.placa.escala` ya trae ese dato, plan-de-pintado.js lo
  // descartaba (`atributos: {}`) en vez de aplicarlo.
  assert.equal(vista.placa.escala, 1.25)
  assert.match(crearPlaca.atributos.style, /transform:\s*scale\(1\.25\)/)

  const crearLed = plan.find((i) => i.tipo === "crearElemento" && i.entidad.tipo === "componente")
  assert.ok(crearLed)
  assert.equal(crearLed.entidad.id, idComponente)
  assert.equal(crearLed.tag, "wokwi-led")
  assert.deepEqual(crearLed.atributos, { color: "red" })

  const filasCable = plan.filter((i) => i.tipo === "filaCable")
  assert.equal(filasCable.length, 2, "cable del anodo + cable del catodo")
  assert.ok(filasCable.some((f) => f.desde === "D4" || f.hasta === "D4"), "la fila del anodo muestra el nombre Wokwi del pin (D4)")
  assert.ok(filasCable.some((f) => f.desde === "GND" || f.hasta === "GND"), "la fila del catodo muestra GND")

  const selector = plan.find((i) => i.tipo === "selectorGpio" && i.componenteId === idComponente && i.terminalId === "anodo")
  assert.ok(selector)
  assert.equal(selector.valorActual, GPIO_X)
  assert.ok(selector.opciones.some((o) => o.valor === GPIO_Y))
  assert.ok(
    selector.opciones.every((o) => typeof o.etiqueta === "string" && o.etiqueta.length > 0),
    "toda opcion trae una etiqueta Wokwi legible",
  )

  const panel = plan.find((i) => i.tipo === "panelMotivo" && i.codigo === "REQUISITO_INSATISFECHO")
  assert.ok(panel, "el panel de motivos incluye el blocking de Path A")
  assert.equal(panel.severidad, "blocking")
  assert.equal(panel.clasificacion, "representable")
  assert.deepEqual(panel.entidad, { tipo: "componente", id: idComponente })

  servicio.cerrar()
})

test("planDePintado es determinista: dos llamadas sobre la MISMA vista dan deepEqual", () => {
  const dir = nuevoDir("plan-determinista")
  const { servicio } = prepararProyectoConLed(dir, nuevoIdProyecto())
  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)

  assert.deepEqual(planDePintado(vista), planDePintado(vista))
  servicio.cerrar()
})

test("ninguna instruccion del plan referencia una URL externa (http:// o https://)", () => {
  const dir = nuevoDir("plan-offline")
  const { servicio } = prepararProyectoConLed(dir, nuevoIdProyecto())
  const vista = proyectarVista(servicio.snapshot().proyecto, catalogo)
  const plan = planDePintado(vista)

  assert.ok(!/https?:\/\//.test(JSON.stringify(plan)), "cero URLs externas en cualquier instruccion (offline por diseño, PHASE_2_SLICE_1_DESIGN.md §2.9)")

  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// 7. Integración: el hook `calcularVista` de composicion-raiz.ts (sin tocarlo)
// ════════════════════════════════════════════════════════════════════════════════════

test("snapshot().vista, con calcularVista=vistaDeProyectoConCatalogoReal inyectado, es igual a proyectarla por fuera con el mismo catalogo real", () => {
  const dir = nuevoDir("vista-integracion-hook")
  const id = nuevoIdProyecto()

  // Primera llamada para este (directorio, idProyecto): composicion-raiz.ts sólo toma
  // `calcularVista` en la CONSTRUCCIÓN del servicio (docstring de
  // `OpcionesServicioDeProyecto.calcularVista`) — nunca en llamadas posteriores.
  const servicio = obtenerServicioDeProyecto({ directorio: dir, idProyecto: id, calcularVista: vistaDeProyectoConCatalogoReal })

  let n = servicio.snapshot().revision
  assert.equal(servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, n)).ok, true)
  n = servicio.snapshot().revision
  assert.equal(servicio.aplicar(op("AgregarComponente", { tipo: "led" }, n)).ok, true)
  const idComponente = servicio.snapshot().proyecto.componentes[0].id
  n = servicio.snapshot().revision
  assert.equal(servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_X }, n)).ok, true)

  const snap = servicio.snapshot()
  assert.ok("vista" in snap, "con el hook inyectado, el snapshot SI trae `vista` (a diferencia de phase2-snapshot.test.mjs, sin hook)")

  const vistaEsperada = proyectarVista(snap.proyecto, catalogo)
  assert.deepEqual(snap.vista, vistaEsperada, "el hook usa el MISMO catalogo real que `catalogo` (phase2-helpers.mjs) — misma vista, misma forma")

  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// 8. MUTANTE: un cable de pin fijo en vez de la IR tiene que morir
// ════════════════════════════════════════════════════════════════════════════════════

test("MUTANTE: un cable tomado de un pin FIJO en vez de la IR tiene que morir contra la propiedad que la suite real exige", async () => {
  const dir = nuevoDir("vista-mutante")
  const { servicio, idComponente } = prepararProyectoConLed(dir, nuevoIdProyecto()) // GPIO_X

  // Reasignar a un pin DISTINTO del que el mutante hardcodea (GPIO4).
  const n = servicio.snapshot().revision
  const r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "anodo", pin: GPIO_Y }, n))
  assert.equal(r.ok, true)
  const proyecto = servicio.snapshot().proyecto

  // Propiedad real que la suite ya exige (sección 4, "invariante"): el cable del
  // ánodo refleja el pin REALMENTE asignado en la IR.
  const vistaReal = proyectarVista(proyecto, catalogo)
  const cableReal = vistaReal.cables.find((c) => c.hasta.terminal === "anodo")
  assert.equal(cableReal.desde.nombreWokwi, "RX2", "la implementacion real SI sigue la IR (GPIO16 -> RX2)")

  const { nombreWokwiDelCableAnodoMutante } = await import(join(REPO, "tests/phase2-vista-fisica-mutante-cable-fijo.ts"))
  const nombreMutante = nombreWokwiDelCableAnodoMutante(proyecto, catalogo)

  // El mutante ignora la IR: da SIEMPRE el nombre Wokwi de GPIO4, aunque el proyecto
  // real esté en GPIO16 — evidencia de que el defecto existe de verdad.
  assert.equal(nombreMutante, "D4", "evidencia: el mutante hardcodea GPIO4 sin mirar la IR")

  // Y por eso MUERE contra la propiedad que la suite real exige: si alguien
  // reemplazara la implementación real por este mutante, esta aserción (la misma
  // forma que la sección 4 ya prueba sobre la implementación real) FALLA — que es
  // exactamente la señal de que el mutante murió.
  assert.throws(
    () => assert.equal(nombreMutante, cableReal.desde.nombreWokwi),
    /AssertionError/,
    "el mutante tiene que fallar esta aserción — si no falla, la suite no está probando nada real",
  )

  servicio.cerrar()
})
