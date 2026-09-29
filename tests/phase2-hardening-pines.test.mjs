// Gate de pines del hardening final (writer W-PINS, D1-D11,
// docs/programacion-intencion/PHASE_2_SLICE_1_HARDENING_DESIGN.md §1-3). Cruza los
// CUATRO caminos que convergen en `validarProyecto` para el MISMO estado -- Engine
// directo (`servicio.aplicar`), POST /api/operaciones del servidor real en
// 127.0.0.1:0, el snapshot que usa la tool (`vista`, calculada aparte por
// `proyectarVista`) y la recarga desde disco (cerrar + reabrir el servicio) -- y
// verifica que dan EXACTAMENTE el mismo diagnostico.
//
// `evaluarRestriccionesPin` (`nucleo/catalogo.ts`) y `PIN_INEXISTENTE_EN_DOCUMENTO`
// (`nucleo/validar-tecnico.ts`) son SIEMPRE `clasificacion: "representable"`, nunca
// `"rechazo"` (D11, `motor.ts:358-360`): ninguna operacion de esta suite se rechaza
// por una restriccion de pin -- sólo `PIN_INEXISTENTE_EN_PLACA` (ya existente, D9)
// sigue rechazando la OPERACION cuando el pin directamente no está en el registro.
//
// Path A (Engine directo), Path B (POST) y "stale" ya están cubiertos por
// `tests/phase2-*.test.mjs` (Phase 2) -- esta suite no los repite, sólo agrega la
// matriz de restricciones sobre esos mismos caminos.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto, obtenerServicioDeProyecto, op, GPIO_X, GPIO_Y } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))

/** Motivos de UN componente, tal como los deja `validarProyecto` en `validacion.motivos`
 * (orden estable, `motivos.ts::compararMotivos`) -- filtra el ruido de otros
 * componentes/comportamientos del mismo proyecto, nunca cambia el contenido. */
function motivosDe(snapshot, idComponente) {
  return snapshot.validacion.motivos.filter((m) => m.entidad?.id === idComponente)
}

function rutaDocumento(dir, idProyecto) {
  return join(dir, `${idProyecto}.json`)
}

/** ESP32 + UN componente sin resistencia/requisitos (pulsador/ntc), pin ya asignado
 * -- construido por el Engine REAL (`composicion-raiz.ts`), mismo patrón que
 * `phase2-helpers.mjs::prepararProyectoConLed` pero para un tipo/terminal arbitrario. */
function prepararProyectoConComponente(directorio, idProyecto, tipo, terminalId, pin) {
  const servicio = obtenerServicioDeProyecto({ directorio, idProyecto })
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  if (!r.ok) throw new Error(`fixture: SetPlaca rechazado: ${JSON.stringify(r.motivos)}`)
  r = servicio.aplicar(op("AgregarComponente", { tipo }, servicio.snapshot().revision))
  if (!r.ok) throw new Error(`fixture: AgregarComponente rechazado: ${JSON.stringify(r.motivos)}`)
  const idComponente = servicio.snapshot().proyecto.componentes[0].id
  if (pin !== undefined) {
    r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: terminalId, pin }, servicio.snapshot().revision))
    if (!r.ok) throw new Error(`fixture: AsignarPin(${pin}) rechazado: ${JSON.stringify(r.motivos)}`)
  }
  return { servicio, idComponente }
}

// ════════════════════════════════════════════════════════════════════════════════════
// D1/D2/D3/D7 -- matriz de severidad por clase de restriccion (pulsador.senal: sin
// requisitos, `entradaDigital` siempre true en el ESP32 -- ningun ruido de
// CAPACIDAD_PIN_INCOMPATIBLE/REQUISITO_INSATISFECHO que pueda confundir el motivo).
// ════════════════════════════════════════════════════════════════════════════════════

const MATRIZ_RESTRICCIONES = [
  { pin: "GPIO4", esperado: null }, // pin normal (D1/D11): funciona, sin motivos
  { pin: "GPIO5", esperado: null }, // D4 (H-3=A): sin restriccion nueva, sin fuente interna
  { pin: "GPIO6", esperado: { codigo: "PIN_FLASH_RESERVADO", severidad: "blocking" } },
  { pin: "GPIO7", esperado: { codigo: "PIN_FLASH_RESERVADO", severidad: "blocking" } },
  { pin: "GPIO8", esperado: { codigo: "PIN_FLASH_RESERVADO", severidad: "blocking" } },
  { pin: "GPIO9", esperado: { codigo: "PIN_FLASH_RESERVADO", severidad: "blocking" } },
  { pin: "GPIO10", esperado: { codigo: "PIN_FLASH_RESERVADO", severidad: "blocking" } },
  { pin: "GPIO11", esperado: { codigo: "PIN_FLASH_RESERVADO", severidad: "blocking" } },
  { pin: "GPIO12", esperado: { codigo: "PIN_STRAPPING", severidad: "warning" } }, // D2: excepcion por pin
  { pin: "GPIO0", esperado: { codigo: "PIN_STRAPPING", severidad: "info" } },
  { pin: "GPIO15", esperado: { codigo: "PIN_STRAPPING", severidad: "info" } },
  { pin: "GPIO2", esperado: { codigo: "PIN_STRAPPING", severidad: "info" } }, // D3 (H-2b=A)
  { pin: "GPIO1", esperado: { codigo: "PIN_UART_USB", severidad: "warning" } },
  { pin: "GPIO3", esperado: { codigo: "PIN_UART_USB", severidad: "warning" } },
]

test("gate §3: matriz de severidad por pin (D1/D2/D3/D7) -- pulsador.senal en cada GPIO da EXACTAMENTE el motivo esperado, y la operacion nunca se rechaza por esto", () => {
  for (const { pin, esperado } of MATRIZ_RESTRICCIONES) {
    const dir = nuevoDir(`matriz-restricciones-${pin}`)
    const { servicio, idComponente } = prepararProyectoConComponente(dir, nuevoIdProyecto(), "pulsador", "senal", pin)

    const snap = servicio.snapshot()
    const motivos = motivosDe(snap, idComponente)
    if (esperado === null) {
      assert.deepEqual(motivos, [], `${pin}: esperaba sin motivos, obtuve ${JSON.stringify(motivos)}`)
      assert.equal(snap.validacion.readiness.listo, true, `${pin}: sin motivos blocking -> listo`)
    } else {
      assert.equal(motivos.length, 1, `${pin}: esperaba EXACTAMENTE 1 motivo, obtuve ${JSON.stringify(motivos)}`)
      assert.equal(motivos[0].codigo, esperado.codigo, pin)
      assert.equal(motivos[0].severidad, esperado.severidad, pin)
      assert.equal(motivos[0].clasificacion, "representable", `${pin}: D11 -- nunca "rechazo"`)
      assert.equal(snap.validacion.readiness.listo, esperado.severidad !== "blocking", `${pin}: listo depende SOLO de severidad blocking (derivarReadiness, validar.ts)`)
    }
    servicio.cerrar()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// D5 (H-4=A) -- soloEntrada + requierePullUpInterno, terminal-aware por dato
// ════════════════════════════════════════════════════════════════════════════════════

test("D5: pulsador en un pin solo-entrada (GPIO34/35/36/39) da PIN_SIN_PULLUP_INTERNO blocking representable", () => {
  for (const pin of ["GPIO34", "GPIO35", "GPIO36", "GPIO39"]) {
    const dir = nuevoDir(`d5-pulsador-${pin}`)
    const { servicio, idComponente } = prepararProyectoConComponente(dir, nuevoIdProyecto(), "pulsador", "senal", pin)

    const snap = servicio.snapshot()
    const motivos = motivosDe(snap, idComponente)
    assert.equal(motivos.length, 1, `${pin}: ${JSON.stringify(motivos)}`)
    assert.equal(motivos[0].codigo, "PIN_SIN_PULLUP_INTERNO")
    assert.equal(motivos[0].severidad, "blocking")
    assert.equal(motivos[0].clasificacion, "representable")
    assert.equal(snap.validacion.readiness.listo, false, pin)
    servicio.cerrar()
  }
})

test("D5: ntc en GPIO34 sigue SIN motivo -- una terminal analogica nunca dispara una restriccion digital (fixture Phase 1, nucleo-ir-cargador.test.mjs:706)", () => {
  const dir = nuevoDir("d5-ntc-gpio34")
  const { servicio, idComponente } = prepararProyectoConComponente(dir, nuevoIdProyecto(), "ntc", "senal", "GPIO34")

  const motivos = motivosDe(servicio.snapshot(), idComponente)
  assert.deepEqual(motivos, [], `ntc en GPIO34 no deberia tener motivos: ${JSON.stringify(motivos)}`)
  servicio.cerrar()
})

test("D5: pulsador en GPIO4 (pin normal) sigue SIN motivo", () => {
  const dir = nuevoDir("d5-pulsador-gpio4")
  const { servicio, idComponente } = prepararProyectoConComponente(dir, nuevoIdProyecto(), "pulsador", "senal", GPIO_X)

  const motivos = motivosDe(servicio.snapshot(), idComponente)
  assert.deepEqual(motivos, [])
  servicio.cerrar()
})

test("D5: LED en GPIO34 da SOLO CAPACIDAD_PIN_INCOMPATIBLE -- nunca se duplica con PIN_SIN_PULLUP_INTERNO (el terminal del LED no declara requierePullUpInterno)", () => {
  const dir = nuevoDir("d5-led-gpio34")
  const servicio = obtenerServicioDeProyecto({ directorio: dir, idProyecto: nuevoIdProyecto() })
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "resistencia", propiedades: { ohmios: 220 } }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idLed = servicio.snapshot().proyecto.componentes[0].id
  const idResistencia = servicio.snapshot().proyecto.componentes[1].id
  r = servicio.aplicar(op("Conectar", { desde: { componente: idLed, terminal: "anodo" }, hasta: { componente: idResistencia, terminal: "a" } }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AsignarPin", { componente: idLed, terminal: "anodo", pin: "GPIO34" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)

  const motivos = motivosDe(servicio.snapshot(), idLed)
  assert.equal(motivos.length, 1, `LED en GPIO34: ${JSON.stringify(motivos)}`)
  assert.equal(motivos[0].codigo, "CAPACIDAD_PIN_INCOMPATIBLE")
  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// D9 -- GPIO37/38 fuera del registro (`ESP32_GPIO_VALIDOS`, `nucleo/placas.ts`)
// ════════════════════════════════════════════════════════════════════════════════════

test("D9: GPIO37 por OPERACION da PIN_INEXISTENTE_EN_PLACA (rechazo) -- ya no esta en el registro esp32", () => {
  const dir = nuevoDir("d9-gpio37-operacion")
  const servicio = obtenerServicioDeProyecto({ directorio: dir, idProyecto: nuevoIdProyecto() })
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idComponente = servicio.snapshot().proyecto.componentes[0].id

  r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "senal", pin: "GPIO37" }, servicio.snapshot().revision))
  assert.equal(r.ok, false, "GPIO37 ya no existe en el registro esp32 (D9): la operacion se rechaza")
  assert.equal(r.motivos[0].codigo, "PIN_INEXISTENTE_EN_PLACA")
  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// D10 -- PIN_INEXISTENTE_EN_DOCUMENTO: pin ausente del registro de la placa VIGENTE,
// por cualquier camino (SetPlaca a otra placa, o un documento editado en disco).
// ════════════════════════════════════════════════════════════════════════════════════

test("D10: SetPlaca esp32->uno con GPIO4 ya asignado -- PIN_INEXISTENTE_EN_DOCUMENTO, not-ready, conserva el pin, sigue editable, nunca ESTADO_NO_RECARGABLE", () => {
  const dir = nuevoDir("d10-setplaca-uno")
  const idProyecto = nuevoIdProyecto()
  const { servicio, idComponente } = prepararProyectoConComponente(dir, idProyecto, "pulsador", "senal", GPIO_X)

  const r = servicio.aplicar(op("SetPlaca", { placa: "arduino-uno" }, servicio.snapshot().revision))
  assert.equal(r.ok, true, "SetPlaca en si NUNCA se rechaza por esto -- D10/D11 son representable, no rechazo")

  const snap = servicio.snapshot()
  assert.equal(snap.proyecto.componentes[0].pines.senal, GPIO_X, "el pin semantico se conserva tal cual, nunca se borra")
  const motivo = snap.validacion.motivos.find((m) => m.codigo === "PIN_INEXISTENTE_EN_DOCUMENTO")
  assert.ok(motivo, `esperaba PIN_INEXISTENTE_EN_DOCUMENTO: ${JSON.stringify(snap.validacion.motivos)}`)
  assert.equal(motivo.severidad, "blocking")
  assert.equal(motivo.clasificacion, "representable")
  assert.equal(snap.validacion.readiness.listo, false)
  assert.ok(!snap.validacion.motivos.some((m) => m.codigo === "ESTADO_NO_RECARGABLE"), "nunca ESTADO_NO_RECARGABLE")
  servicio.cerrar()

  // recarga desde disco: mismo diagnostico, sin throw, sigue editable.
  const servicio2 = obtenerServicioDeProyecto({ directorio: dir, idProyecto })
  const snapRecargado = servicio2.snapshot()
  assert.ok(
    snapRecargado.validacion.motivos.some((m) => m.codigo === "PIN_INEXISTENTE_EN_DOCUMENTO"),
    "el motivo sobrevive a la recarga",
  )
  const rEditar = servicio2.aplicar(op("AsignarPin", { componente: idComponente, terminal: "senal", pin: "D4" }, servicio2.snapshot().revision))
  assert.equal(rEditar.ok, true, "el proyecto sigue editable pese al motivo representable")
  servicio2.cerrar()
})

for (const pinInexistente of ["GPIO20", "GPIO37"]) {
  test(`D10: un documento en disco con ${pinInexistente} (fuera del registro esp32) carga con PIN_INEXISTENTE_EN_DOCUMENTO, conserva, diagnostica, not-ready, editable`, () => {
    const dir = nuevoDir(`d10-documento-${pinInexistente}`)
    const idProyecto = nuevoIdProyecto()
    const { servicio, idComponente } = prepararProyectoConComponente(dir, idProyecto, "pulsador", "senal", GPIO_X)
    servicio.cerrar()

    const ruta = rutaDocumento(dir, idProyecto)
    const doc = JSON.parse(readFileSync(ruta, "utf8"))
    doc.componentes[0].pines.senal = pinInexistente
    writeFileSync(ruta, JSON.stringify(doc))

    const servicio2 = obtenerServicioDeProyecto({ directorio: dir, idProyecto })
    const snap = servicio2.snapshot()
    assert.equal(snap.proyecto.componentes[0].pines.senal, pinInexistente, "el pin semantico del documento se conserva tal cual")
    const motivo = snap.validacion.motivos.find((m) => m.codigo === "PIN_INEXISTENTE_EN_DOCUMENTO")
    assert.ok(motivo, `esperaba PIN_INEXISTENTE_EN_DOCUMENTO: ${JSON.stringify(snap.validacion.motivos)}`)
    assert.equal(motivo.severidad, "blocking")
    assert.equal(motivo.clasificacion, "representable")
    assert.equal(snap.validacion.readiness.listo, false)
    assert.ok(!snap.validacion.motivos.some((m) => m.codigo === "ESTADO_NO_RECARGABLE"), "nunca ESTADO_NO_RECARGABLE")

    const r = servicio2.aplicar(op("AsignarPin", { componente: idComponente, terminal: "senal", pin: GPIO_Y }, servicio2.snapshot().revision))
    assert.equal(r.ok, true, "el proyecto sigue editable: reasignar a un pin valido commitea")
    assert.equal(
      servicio2.snapshot().validacion.motivos.some((m) => m.codigo === "PIN_INEXISTENTE_EN_DOCUMENTO"),
      false,
      "reasignar a un pin normal limpia el motivo",
    )
    servicio2.cerrar()
  })
}

// ════════════════════════════════════════════════════════════════════════════════════
// D1/D11 -- reasignar a un pin normal limpia el motivo
// ════════════════════════════════════════════════════════════════════════════════════

test("reasignar de un pin restringido (GPIO6, flashReservado) a un pin normal limpia el motivo", () => {
  const dir = nuevoDir("reasignar-limpia-motivo")
  const { servicio, idComponente } = prepararProyectoConComponente(dir, nuevoIdProyecto(), "pulsador", "senal", "GPIO6")

  let motivos = motivosDe(servicio.snapshot(), idComponente)
  assert.equal(motivos[0]?.codigo, "PIN_FLASH_RESERVADO")
  assert.equal(servicio.snapshot().validacion.readiness.listo, false)

  const r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "senal", pin: GPIO_X }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  motivos = motivosDe(servicio.snapshot(), idComponente)
  assert.deepEqual(motivos, [], `reasignar a ${GPIO_X} tiene que limpiar el motivo: ${JSON.stringify(motivos)}`)
  assert.equal(servicio.snapshot().validacion.readiness.listo, true)
  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// D11 -- PERSISTIBLE => RECARGABLE, explícito para un estado blocking/representable
// ════════════════════════════════════════════════════════════════════════════════════

test("D11: PERSISTIBLE => RECARGABLE -- un pulsador en GPIO6 (blocking representable) persiste y recarga SIN throw, con el mismo diagnostico", () => {
  const dir = nuevoDir("d11-persistible-recargable")
  const idProyecto = nuevoIdProyecto()
  const { servicio, idComponente } = prepararProyectoConComponente(dir, idProyecto, "pulsador", "senal", "GPIO6")

  const antes = servicio.snapshot()
  assert.equal(antes.validacion.readiness.listo, false)
  servicio.cerrar()

  let servicio2
  assert.doesNotThrow(() => {
    servicio2 = obtenerServicioDeProyecto({ directorio: dir, idProyecto })
  }, "un proyecto persistido con un motivo representable tiene que RECARGAR sin throw (D11, motor.ts:358-360)")
  const despues = servicio2.snapshot()
  assert.equal(despues.revision, antes.revision)
  assert.deepEqual(
    despues.validacion.motivos.map((m) => m.codigo),
    antes.validacion.motivos.map((m) => m.codigo),
    "mismo diagnostico antes y despues de recargar",
  )
  assert.equal(despues.validacion.readiness.listo, false)

  const r = servicio2.aplicar(op("AsignarPin", { componente: idComponente, terminal: "senal", pin: GPIO_X }, servicio2.snapshot().revision))
  assert.equal(r.ok, true, "sigue editable tras la recarga")
  servicio2.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// D8 (H-7=A) -- la UI NO cambia: el browser JS no tiene ninguna tabla electrica, y los
// candidatos del <select> siguen saliendo SOLO de `gpiosCandidatosPara` (nucleo).
// ════════════════════════════════════════════════════════════════════════════════════

test("D8 (H-7=A): opencode/vista-fisica/web/*.js no contiene ninguna tabla electrica (listas de restricciones ni de GPIO por clase)", () => {
  const dirWeb = join(REPO, "opencode/vista-fisica/web")
  const PATRONES_PROHIBIDOS = [/flashReservado/i, /strapping/i, /uartUsb/i, /soloEntrada/i, /PIN_FLASH_RESERVADO/, /PIN_STRAPPING/, /PIN_UART_USB/, /PIN_SIN_PULLUP_INTERNO/, /PIN_INEXISTENTE_EN_DOCUMENTO/]
  const archivos = readdirSync(dirWeb).filter((f) => f.endsWith(".js"))
  assert.ok(archivos.length > 0, "fixture: tiene que haber al menos un .js en vista-fisica/web")
  for (const archivo of archivos) {
    const contenido = readFileSync(join(dirWeb, archivo), "utf8")
    for (const patron of PATRONES_PROHIBIDOS) {
      assert.ok(!patron.test(contenido), `${archivo} no puede contener ${patron} -- ninguna tabla/codigo electrico en el browser JS (D8, H-7=A)`)
    }
  }
})

test("D8 (H-7=A): los candidatos ofrecidos al LED (gpiosDisponibles, calculado por gpiosCandidatosPara en el nucleo) siguen incluyendo GPIO2, 12, 15, 1 y 3", () => {
  const dir = nuevoDir("d8-select-candidatos")
  const idProyecto = nuevoIdProyecto()
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto })
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "led" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idComponente = servicio.snapshot().proyecto.componentes[0].id

  const vista = servicio.snapshot().vista
  const semanticos = vista.gpiosDisponibles[idComponente].anodo.map((o) => o.pinSemantico)
  for (const pin of ["GPIO2", "GPIO12", "GPIO15", "GPIO1", "GPIO3"]) {
    assert.ok(semanticos.includes(pin), `${pin} tiene que seguir ofrecido al LED (D8, H-7=A): ${JSON.stringify(semanticos)}`)
  }
  servicio.cerrar()
})

// ════════════════════════════════════════════════════════════════════════════════════
// Convergencia entre los 4 caminos, para el MISMO estado (gate §3)
// ════════════════════════════════════════════════════════════════════════════════════

test("Engine directo, POST /api/operaciones (servidor real en 127.0.0.1:0), snapshot (el que usa la tool, vista calculada aparte) y recarga desde disco dan EXACTAMENTE el mismo diagnostico para el MISMO estado", async () => {
  const dir = nuevoDir("crosspath-convergencia")
  const idProyecto = nuevoIdProyecto()

  // Misma raiz que usan el servidor HTTP y la tool de OpenCode (servicio-con-vista.ts)
  // -- nunca `obtenerServicioDeProyecto` a mano para esta parte, mismo criterio que el
  // resto de Phase 2 (guardia estructural, phase2-servicio-con-vista.test.mjs).
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto })
  let r = servicio.aplicar(op("SetPlaca", { placa: "esp32-devkit-v1" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  r = servicio.aplicar(op("AgregarComponente", { tipo: "pulsador" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const idComponente = servicio.snapshot().proyecto.componentes[0].id

  // --- Camino 1: Engine directo (aplicar) -- GPIO12, warning (D2, excepcion por pin) ---
  r = servicio.aplicar(op("AsignarPin", { componente: idComponente, terminal: "senal", pin: "GPIO12" }, servicio.snapshot().revision))
  assert.equal(r.ok, true)
  const snapDirecto = servicio.snapshot()
  const motivosDirecto = motivosDe(snapDirecto, idComponente)
  assert.equal(motivosDirecto.length, 1)
  assert.equal(motivosDirecto[0].codigo, "PIN_STRAPPING")
  assert.equal(motivosDirecto[0].severidad, "warning")

  // --- Camino 2 (mismo estado): snapshot que usa la tool -- `vista.motivos` sale de
  // `proyectarVista` -> su PROPIA llamada a `validarProyecto` (snapshot-a-vista.ts),
  // un call site independiente de `validacion.motivos` (composicion-raiz.ts). ---
  const motivosVista = snapDirecto.vista.motivos.filter((m) => m.entidad?.id === idComponente)
  assert.deepEqual(motivosVista, motivosDirecto, "el snapshot que usa la tool (vista) tiene que dar EXACTAMENTE el mismo motivo que validacion.motivos")

  // --- Camino 3: POST /api/operaciones del servidor real en 127.0.0.1:0 -- misma
  // operacion (no-op semantico: reasigna al pin donde ya esta) para leer el
  // diagnostico servido por HTTP sobre el MISMO estado. ---
  const servidor = await iniciarServidor({ servicio })
  try {
    const revisionAntes = servicio.snapshot().revision
    const respuesta = await fetch(new URL("/api/operaciones", servidor.url), {
      method: "POST",
      // Origin: fix H3 (red-team, servidor-proyecto.ts) -- `fetch()` de Node no lo
      // agrega solo, se pasa explicito con el mismo origen que `servidor.url`.
      headers: { "Content-Type": "application/json", Origin: new URL(servidor.url).origin },
      body: JSON.stringify({ idOperacion: "crosspath-post-1", actor: "navegador", baseRevision: revisionAntes, tipo: "AsignarPin", payload: { componente: idComponente, terminal: "senal", pin: "GPIO12" } }),
    })
    assert.equal(respuesta.status, 200)
    const cuerpo = await respuesta.json()
    assert.equal(cuerpo.resultado.ok, true)
    const motivosPost = cuerpo.snapshot.validacion.motivos.filter((m) => m.entidad?.id === idComponente)
    assert.deepEqual(motivosPost, motivosDirecto, "el POST del servidor real tiene que dar EXACTAMENTE el mismo diagnostico")
    const motivosPostVista = cuerpo.snapshot.vista.motivos.filter((m) => m.entidad?.id === idComponente)
    assert.deepEqual(motivosPostVista, motivosDirecto, "la vista servida por HTTP tambien coincide")
  } finally {
    await servidor.cerrar()
  }

  // --- Camino 4: recarga desde disco (cerrar + reabrir el servicio) ---
  servicio.cerrar()
  const servicioRecargado = obtenerServicioDeProyectoConVista({ directorio: dir, idProyecto })
  try {
    const snapRecargado = servicioRecargado.snapshot()
    const motivosRecarga = motivosDe(snapRecargado, idComponente)
    assert.deepEqual(motivosRecarga, motivosDirecto, "la recarga desde disco tiene que dar EXACTAMENTE el mismo diagnostico")
  } finally {
    servicioRecargado.cerrar()
  }
})
