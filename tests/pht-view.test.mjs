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
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { construirCatalogoMinimoReal, sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { planDePintado } = await import(join(REPO, "opencode/vista-fisica/web/plan-de-pintado.js"))
const { pintar } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))
const { ELEMENTO_WOKWI_POR_TIPO, TERMINAL_WOKWI_POR_TIPO } = await import(join(REPO, "opencode/vista-fisica/wokwi-render-datos.ts"))

const catalogo = construirCatalogoMinimoReal()

// Mismo fake de documento que `tests/phase2-s2-rol.test.mjs` — sólo las 3 operaciones
// de DOM que `pintar.js` usa de verdad (createElement/setAttribute/appendChild),
// nunca un DOM real (jsdom/happy-dom no son dependencias de este repo).
function elementoFake(tag) {
  return {
    tagName: tag,
    atributos: {},
    hijos: [],
    _textContent: "",
    setAttribute(nombre, valor) {
      this.atributos[nombre] = String(valor)
    },
    appendChild(hijo) {
      this.hijos.push(hijo)
      return hijo
    },
    get textContent() {
      return this._textContent
    },
    set textContent(valor) {
      this._textContent = valor
    },
  }
}
function documentoFake() {
  return { createElement: (tag) => elementoFake(tag) }
}
/** Busca, recursivamente, todos los elementos cuyo `tagName` empieza con "wokwi-"
 * (piezas reales, nunca <figure>/<span>/<figcaption> de agrupamiento). */
function piezasDentroDe(elemento) {
  const propias = (elemento.tagName ?? "").startsWith("wokwi-") ? [elemento] : []
  const anidadas = (elemento.hijos ?? []).flatMap(piezasDentroDe)
  return [...propias, ...anidadas]
}
/** Busca, recursivamente, el primer `<figcaption>`. */
function figcaptionDentroDe(elemento) {
  if (elemento.tagName === "figcaption") return elemento
  for (const hijo of elemento.hijos ?? []) {
    const encontrado = figcaptionDentroDe(hijo)
    if (encontrado) return encontrado
  }
  return null
}

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

/** Agrega un Pulsador con su pin ya asignado — para los casos de contigüidad que
 * necesitan OTRO componente en el medio del proyecto, sin requisito propio. */
function agregarPulsadorAsignado(p, pinSenal) {
  const idPulsador = `cmp-${p.siguienteIdLocal}`
  p = aplicar(p, "AgregarComponente", { tipo: "pulsador" })
  p = aplicar(p, "AsignarPin", { componente: idPulsador, terminal: "senal", pin: pinSenal })
  return { proyecto: p, idPulsador }
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

// ════════════════════════════════════════════════════════════════════════════════════
// Criterio pedagógico (diseño §2, "si visualmente sigue pareciendo colgante → FAIL,
// aunque los tests estén en verde") — corrección del orquestador sobre la primera
// entrega de HD-W0-B: los tests B1-B8 de arriba eran topológicos (qué cable va a qué
// terminal) pero NO exigían que la cadena se vea JUNTA. Verificado real en Chromium
// (despues-circuito.png, primera entrega): la Resistencia se dibujaba lejos del LED
// (pegada al Pulsador) y su fila de cable quedaba separada en la lista por las filas
// del Pulsador en el medio — cierto en los datos, pero ilegible para un estudiante.
//
// (a) CONTIGÜIDAD: cuando hay fusión, las DOS aristas de la cadena (pin→libre,
//     conectada→terminal) van consecutivas, y el resto de los cables del MISMO
//     componente las sigue ANTES de pasar a otro componente.
// (b) ADYACENCIA: en `vista.componentes` (el orden en que se dibujan las piezas), la
//     resistencia fusionada va INMEDIATAMENTE ANTES del componente al que sirve.
// ════════════════════════════════════════════════════════════════════════════════════

test("HD-W0-B contigüidad: la cadena fusionada va consecutiva y en orden físico — pin, conexión, y recién después el resto del MISMO componente", () => {
  const { proyecto, idLed } = proyectoCanonico()
  const vista = proyectarVista(proyecto, catalogo)
  const ids = vista.cables.map((c) => c.id)
  const iPin = ids.indexOf(`cable-pin-${idLed}-anodo`)
  const iRiel = ids.indexOf(`cable-riel-${idLed}-catodo`)
  assert.notEqual(iPin, -1, `falta el cable del pin: ${JSON.stringify(ids)}`)
  assert.notEqual(iRiel, -1, `falta el cable del riel: ${JSON.stringify(ids)}`)
  const siguienteAlPin = vista.cables[iPin + 1]
  assert.ok(siguienteAlPin?.id.startsWith("cable-conexion-"), `la arista de la Conexion fusionada tiene que ir INMEDIATAMENTE después de la del pin: ${JSON.stringify(ids)}`)
  assert.equal(iRiel, iPin + 2, `el resto de los cables del MISMO componente (cátodo→GND) tiene que seguir a la cadena, antes de cualquier otro componente: ${JSON.stringify(ids)}`)
})

test("HD-W0-B contigüidad: los cables de OTRO componente (Pulsador) nunca se intercalan en medio de la cadena fusionada del LED", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  const par = agregarLedConResistencia(p, "GPIO18")
  const { proyecto, idPulsador } = agregarPulsadorAsignado(par.proyecto, "GPIO19")

  const vista = proyectarVista(proyecto, catalogo)
  const ids = vista.cables.map((c) => c.id)
  const iPin = ids.indexOf(`cable-pin-${par.idLed}-anodo`)
  const iRiel = ids.indexOf(`cable-riel-${par.idLed}-catodo`)
  const iPinPulsador = ids.indexOf(`cable-pin-${idPulsador}-senal`)
  assert.ok(vista.cables[iPin + 1]?.id.startsWith("cable-conexion-"), `cadena partida: ${JSON.stringify(ids)}`)
  assert.equal(iRiel, iPin + 2, `cadena partida: ${JSON.stringify(ids)}`)
  assert.ok(iPinPulsador > iRiel, `los cables del Pulsador tienen que venir DESPUÉS de completar la cadena del LED, nunca intercalados en el medio: ${JSON.stringify(ids)}`)
})

test("HD-W0-B adyacencia: la Resistencia fusionada se dibuja INMEDIATAMENTE ANTES de su LED (entre la placa y el LED), nunca después ni lejos", () => {
  const { proyecto, idLed, idResistencia } = proyectoCanonico()
  const vista = proyectarVista(proyecto, catalogo)
  const ids = vista.componentes.map((c) => c.id)
  const iRes = ids.indexOf(idResistencia)
  const iLed = ids.indexOf(idLed)
  assert.notEqual(iRes, -1)
  assert.equal(iLed, iRes + 1, `la Resistencia fusionada tiene que ir justo antes de SU LED: ${JSON.stringify(ids)}`)
})

test("HD-W0-B adyacencia: con un Pulsador en el medio del proyecto, la Resistencia sigue INMEDIATAMENTE antes de SU LED (nunca pegada a otro componente)", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  const par = agregarLedConResistencia(p, "GPIO18")
  const { proyecto, idPulsador } = agregarPulsadorAsignado(par.proyecto, "GPIO19")

  const vista = proyectarVista(proyecto, catalogo)
  const ids = vista.componentes.map((c) => c.id)
  const iRes = ids.indexOf(par.idResistencia)
  const iLed = ids.indexOf(par.idLed)
  assert.equal(iLed, iRes + 1, `adyacencia rota: ${JSON.stringify(ids)}`)
  assert.notEqual(ids.indexOf(idPulsador), iRes + 1, "el Pulsador nunca puede quedar pegado entre la Resistencia y SU LED")
})

test("HD-W0-B contigüidad + adyacencia, 2 LEDs con 2 Resistencias: cada cadena es contigua y cada Resistencia queda junto a SU LED, nunca cruzadas", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  const par1 = agregarLedConResistencia(p, "GPIO18")
  const par2 = agregarLedConResistencia(par1.proyecto, "GPIO19")
  const vista = proyectarVista(par2.proyecto, catalogo)

  const idsComp = vista.componentes.map((c) => c.id)
  const idsCables = vista.cables.map((c) => c.id)
  for (const { idLed, idResistencia } of [par1, par2]) {
    const iRes = idsComp.indexOf(idResistencia)
    const iLed = idsComp.indexOf(idLed)
    assert.equal(iLed, iRes + 1, `adyacencia rota para ${idLed}: ${JSON.stringify(idsComp)}`)

    const iPin = idsCables.indexOf(`cable-pin-${idLed}-anodo`)
    const siguiente = vista.cables[iPin + 1]
    assert.ok(siguiente?.id.startsWith("cable-conexion-"), `cadena de ${idLed} no contigua: ${JSON.stringify(idsCables)}`)
    assert.equal(siguiente.hasta.componente, idLed, `la conexión contigua tiene que volver a SU led, nunca al otro: ${JSON.stringify(siguiente)}`)
    assert.equal(siguiente.hasta.terminal, "anodo")
  }
})

test("una Resistencia huérfana (sin fusión) conserva su orden de SIEMPRE en vista.componentes — la adyacencia sólo mueve piezas fusionadas", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  p = aplicar(p, "AgregarComponente", { tipo: "pulsador" }) // cmp-0
  p = aplicar(p, "AgregarComponente", { tipo: "resistencia" }) // cmp-1, huérfana
  const vista = proyectarVista(p, catalogo)
  assert.deepEqual(vista.componentes.map((c) => c.id), ["cmp-0", "cmp-1"], "sin fusión, el orden es el de siempre (Proyecto.componentes, nunca reordenado)")
})

// ════════════════════════════════════════════════════════════════════════════════════
// W-PHT-FIX — ronda de red team pre-humano
// ════════════════════════════════════════════════════════════════════════════════════
//
// PFX-1 (MAJOR, RED-PHT-PHYSICAL-TRUTH F1, verificado real en Chromium por el
// orquestador): la Resistencia fusionada se dibujaba lejos de su LED (sin rol, nunca
// envuelta en `<figure>`, `pintar.js:107-124`) — a veces pegada al Pulsador. Contrato:
// la pieza fusionada y su ancla comparten el MISMO contenedor, la fusionada PRIMERO
// (a la izquierda), con el rol del ANCLA como única leyenda del grupo. La agrupación
// la decide el SERVIDOR (`ComponenteVista.agrupadoCon`, derivado de la fusión que ya
// se calcula) — `plan-de-pintado.js`/`pintar.js` sólo la obedecen, cero lógica física
// nueva en JS. Un componente SIN fusión queda exactamente como hoy.
// ════════════════════════════════════════════════════════════════════════════════════

test("PFX-1 (modelo): la Resistencia fusionada trae agrupadoCon = id de SU LED; el resto trae agrupadoCon:null", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  const par = agregarLedConResistencia(p, "GPIO18")
  const { proyecto, idPulsador } = agregarPulsadorAsignado(par.proyecto, "GPIO19")
  const vista = proyectarVista(proyecto, catalogo)

  const resistencia = vista.componentes.find((c) => c.id === par.idResistencia)
  const led = vista.componentes.find((c) => c.id === par.idLed)
  const pulsador = vista.componentes.find((c) => c.id === idPulsador)
  assert.equal(resistencia.agrupadoCon, par.idLed, "la resistencia fusionada apunta a SU LED")
  assert.equal(led.agrupadoCon, null, "un ancla nunca se agrupa con nada, se la agrupan A ella")
  assert.equal(pulsador.agrupadoCon, null, "sin fusión propia, nunca se agrupa")
})

test("PFX-1 (modelo): una Resistencia huérfana (sin fusión) trae agrupadoCon:null — la pieza se dibuja sola, como siempre", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  p = aplicar(p, "AgregarComponente", { tipo: "resistencia" })
  const vista = proyectarVista(p, catalogo)
  assert.equal(vista.componentes[0].agrupadoCon, null)
})

test("PFX-1 (plan): planDePintado forwardea agrupadoCon tal cual en la instrucción crearElemento; la placa nunca se agrupa", () => {
  const { proyecto, idLed, idResistencia } = proyectoCanonico()
  const vista = proyectarVista(proyecto, catalogo)
  const plan = planDePintado(vista)
  const crearRes = plan.find((i) => i.tipo === "crearElemento" && i.entidad.id === idResistencia)
  const crearLed = plan.find((i) => i.tipo === "crearElemento" && i.entidad.id === idLed)
  const crearPlaca = plan.find((i) => i.tipo === "crearElemento" && i.entidad.tipo === "placa")
  assert.equal(crearRes.agrupadoCon, idLed)
  assert.equal(crearLed.agrupadoCon, null)
  assert.equal(crearPlaca.agrupadoCon, null)
})

test("PFX-1 (pintar): la Resistencia fusionada y su LED comparten el MISMO contenedor, la Resistencia PRIMERO, con el rol del LED como leyenda del grupo", () => {
  const instrucciones = [
    { tipo: "crearElemento", entidad: { tipo: "componente", id: "cmp-res" }, tag: "wokwi-resistor", atributos: { value: "220" }, etiquetaRol: null, agrupadoCon: "cmp-led" },
    { tipo: "crearElemento", entidad: { tipo: "componente", id: "cmp-led" }, tag: "wokwi-led", atributos: { color: "red" }, etiquetaRol: "Salida", agrupadoCon: null },
  ]
  const raiz = pintar(documentoFake(), instrucciones)
  assert.equal(raiz.circuito.hijos.length, 1, "un ÚNICO contenedor para el grupo fusionado — nunca dos piezas sueltas")
  const grupo = raiz.circuito.hijos[0]
  const piezas = piezasDentroDe(grupo)
  assert.deepEqual(piezas.map((p) => p.tagName), ["wokwi-resistor", "wokwi-led"], "la resistencia va PRIMERO (a la izquierda) de su LED")
  const rotulo = figcaptionDentroDe(grupo)
  assert.ok(rotulo, "el grupo tiene UNA leyenda")
  assert.equal(rotulo.textContent, "Salida", "la leyenda del grupo es el ROL DEL ANCLA (LED), nunca el de la resistencia (null)")
})

test("PFX-1 (pintar): sin agrupadoCon ni match, un componente queda EXACTAMENTE como hoy (su propio <figure> si tiene rol, hijo directo si no)", () => {
  const instrucciones = [
    { tipo: "crearElemento", entidad: { tipo: "placa", id: "placa-0" }, tag: "wokwi-esp32-devkit-v1", atributos: {}, etiquetaRol: null, agrupadoCon: null },
    { tipo: "crearElemento", entidad: { tipo: "componente", id: "cmp-pul" }, tag: "wokwi-pushbutton", atributos: {}, etiquetaRol: "Entrada", agrupadoCon: null },
  ]
  const raiz = pintar(documentoFake(), instrucciones)
  assert.equal(raiz.circuito.hijos.length, 2)
  assert.equal(raiz.circuito.hijos[0].tagName, "wokwi-esp32-devkit-v1", "sin rol, la placa sigue siendo hija DIRECTA, sin envoltorio")
  const contenedorPulsador = raiz.circuito.hijos[1]
  assert.equal(piezasDentroDe(contenedorPulsador).length, 1, "el pulsador sigue solo en su propio contenedor")
  assert.equal(figcaptionDentroDe(contenedorPulsador).textContent, "Entrada")
})

test("PFX-1 (pintar), integración real: un Pulsador SIN fusión nunca cae dentro del grupo Resistencia+LED — sigue en su PROPIO contenedor, nunca pegado", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  const par = agregarLedConResistencia(p, "GPIO18")
  const { proyecto, idPulsador } = agregarPulsadorAsignado(par.proyecto, "GPIO19")
  const vista = proyectarVista(proyecto, catalogo)
  const plan = planDePintado(vista)
  const raiz = pintar(documentoFake(), plan)

  assert.equal(raiz.circuito.hijos.length, 2, "un contenedor para el grupo fusionado, otro para el pulsador — nunca tres sueltos")
  const grupo = raiz.circuito.hijos.find((c) => piezasDentroDe(c).some((p) => p.tagName === "wokwi-led"))
  const contenedorPulsador = raiz.circuito.hijos.find((c) => piezasDentroDe(c).some((p) => p.tagName === "wokwi-pushbutton"))
  assert.ok(grupo && contenedorPulsador)
  assert.notEqual(grupo, contenedorPulsador, "el pulsador NUNCA comparte contenedor con el grupo Resistencia+LED")
  assert.deepEqual(
    piezasDentroDe(grupo).map((p) => p.tagName),
    ["wokwi-resistor", "wokwi-led"],
    "el grupo trae SÓLO la resistencia y su LED, la resistencia primero",
  )
  assert.equal(piezasDentroDe(contenedorPulsador).length, 1, "el pulsador sigue solo")
})

test("PFX-1 (pintar), integración real: 2 LEDs + 2 Resistencias — dos grupos separados, nunca cruzados", () => {
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  const par1 = agregarLedConResistencia(p, "GPIO18")
  const par2 = agregarLedConResistencia(par1.proyecto, "GPIO19")
  const vista = proyectarVista(par2.proyecto, catalogo)
  const plan = planDePintado(vista)
  const raiz = pintar(documentoFake(), plan)

  assert.equal(raiz.circuito.hijos.length, 2, "dos grupos, uno por cada par LED+Resistencia")
  for (const grupo of raiz.circuito.hijos) {
    const piezas = piezasDentroDe(grupo)
    assert.equal(piezas.length, 2, `cada grupo tiene exactamente 2 piezas: ${JSON.stringify(piezas.map((p) => p.tagName))}`)
    assert.equal(piezas[0].tagName, "wokwi-resistor")
    assert.equal(piezas[1].tagName, "wokwi-led")
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// PFX-2 (MAJOR, RED-PHT-AUDITABILITY F2): `snapshot-a-vista.ts` duplicaba el fallback
// "resistencia" de `nucleo/catalogo.ts:189` (`evaluarRequisito`). Contrato: SIN tocar
// `nucleo/`, la vista deja de asumir "resistencia" — si `spec.tipoComponente` no es un
// string, NO fusiona (fail-closed), aunque haya una instancia "resistencia" real
// conectada que coincidiría por pura casualidad con el fallback viejo.
// ════════════════════════════════════════════════════════════════════════════════════

const REQUISITO_SIN_TIPO_DECLARADO = {
  id: "zumbador-sin-tipo-fixture",
  nombreVisible: "Zumbador sin tipo declarado (fixture, no-producto)",
  clase: "actuador",
  terminales: [
    { id: "senal", rol: "senal", electrica: "digital", direccion: "salida" },
    { id: "gnd", rol: "tierra", electrica: "riel-fijo", destinoFijo: "GND" },
  ],
  capacidades: [],
  // A propósito: "resistencia-serie" SIN `spec.tipoComponente` — el caso que
  // `nucleo/catalogo.ts:189` (`evaluarRequisito`) sigue resolviendo con su PROPIO
  // fallback a "resistencia" (archivo fuera de alcance, no se toca); la vista no
  // puede duplicar esa misma decisión en un segundo lugar.
  requisitos: [{ tipo: "resistencia-serie", enTerminal: "senal", spec: {} }],
}

test("PFX-2: un requisito resistencia-serie SIN spec.tipoComponente (string) NUNCA fusiona en la vista — fail-closed, sin fallback duplicado a 'resistencia'", () => {
  const catalogoFixture = construirCatalogo(
    { version: VERSION_CATALOGO_MINIMO, componentes: [...COMPONENTES_CATALOGO_MINIMO, REQUISITO_SIN_TIPO_DECLARADO], placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } },
    sha256Hex,
  )
  let p = proyectoBase()
  p = { ...p, placa: "esp32-devkit-v1" }
  const aplicarFixture = (proyecto, tipo, payload) => {
    const r = ejecutarOperacion(proyecto, op(tipo, payload, proyecto.revision), catalogoFixture)
    assert.equal(r.ok, true, `fixture: ${tipo}(${JSON.stringify(payload)}) rechazado: ${JSON.stringify(r.motivos)}`)
    return r.proyecto
  }
  p = aplicarFixture(p, "AgregarComponente", { tipo: "zumbador-sin-tipo-fixture" }) // cmp-0
  p = aplicarFixture(p, "AgregarComponente", { tipo: "resistencia" }) // cmp-1 — una instancia REAL del tipo que el fallback viejo asumía
  p = aplicarFixture(p, "Conectar", { desde: { componente: "cmp-0", terminal: "senal" }, hasta: { componente: "cmp-1", terminal: "a" } })
  p = aplicarFixture(p, "AsignarPin", { componente: "cmp-0", terminal: "senal", pin: "GPIO18" })

  const vista = proyectarVista(p, catalogoFixture)
  const cablePin = vista.cables.find((c) => c.id === "cable-pin-cmp-0-senal")
  assert.ok(cablePin, `falta el cable del pin: ${JSON.stringify(vista.cables)}`)
  assert.equal(cablePin.hasta.tipo, "terminal")
  assert.equal(cablePin.hasta.componente, "cmp-0", "sin spec.tipoComponente declarado, el cable del pin sigue yendo DIRECTO al propio terminal — nunca fusiona por asumir 'resistencia'")
  assert.equal(cablePin.hasta.terminal, "senal")
  assert.equal(vista.componentes.find((c) => c.id === "cmp-1").agrupadoCon, null, "la resistencia real conectada tampoco queda marcada como agrupada — no hubo fusión")
})
