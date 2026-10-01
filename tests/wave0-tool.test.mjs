// Phase 3, Wave 0 — writer W-W0-TOOL (PHASE_3_WAVE_0_DESIGN.md, filas F-05/F-06/F-07/
// F-13 + "varias pestañas"). Insumo: PHASE_2_SIMULATED_ROLE_TRIAL.md (docente
// simulado, T1: ~16 llamadas de prueba y error adivinando ids; bot afirmando acciones
// no ejecutadas; vista vacía descrita como armada).
//
// Cubre, en orden:
//  1. F-07: un cliente "ingenuo" arma ESP32+LED+resistencia+pulsador (+AsignarPin de
//     LED y pulsador) usando SÓLO lo que `leer` expone en `vocabulario` — 0 llamadas
//     con `ok:false`.
//  2. F-07: el vocabulario (placas/componentes/terminales) coincide EXACTAMENTE con
//     `catalogo.componentes`/`catalogo.placas` — nunca una lista hardcodeada aparte.
//  3. F-06: la línea `resultado` para leer / simular ok / aplicar ok / rechazo de
//     transporte / rechazo del Engine / stale (BASE_REVISION_DESACTUALIZADA).
//  4. F-07 (continuación): `valoresValidos` ante PLACA_DESCONOCIDA/
//     TIPO_CATALOGO_DESCONOCIDO/TERMINAL_NO_DECLARADO.
//  5. F-13: `leer` agrega `nombre`/`descripcionPines` por componente.
//  6. F-05 + "varias pestañas": el resumen de `vista-fisica` (vacío/armado) y que una
//     segunda llamada, mismo (directorio, idProyecto) en el MISMO proceso, no abre
//     otra pestaña salvo `reabrir:true`.
//
// `vistaFisica.execute()` en este archivo NUNCA abre un navegador real: bajo
// `node --test` no existe el global `Bun` que usa `abrirEnNavegador` (Bun.spawn) —
// acceder a esa propiedad tira un `ReferenceError` que esa misma función ya captura
// (try/catch) y devuelve `false`, nunca se dispara un proceso real. Confirmado antes de
// escribir este archivo (`node -e "try{Bun.spawn}catch(e){console.log(e)}"` →
// `ReferenceError: Bun is not defined`). Por eso este archivo SÍ llama
// `vistaFisica.execute()` de punta a punta para F-05/pestañas, y ADEMÁS prueba la
// regla de "no reabrir" como función pura exportada (`debeAbrirNuevaPestana`,
// `opencode/tool/vista-fisica.ts`) para un segundo ángulo, más barato y sin HTTP.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const vistaFisica = (await import(join(REPO, "opencode/tool/vista-fisica.ts"))).default
const { debeAbrirNuevaPestana, resumenDelProyecto, obtenerServidorVistaFisica } = await import(join(REPO, "opencode/tool/vista-fisica.ts"))
const { directorioDeDatos } = await import(join(REPO, "opencode/vista-fisica/ubicacion-proyecto.ts"))
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { construirCatalogoMinimoReal } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))

function parsearJson(texto) {
  return JSON.parse(texto)
}

async function llamarProyectoFisico(args, directorioActivo) {
  return proyectoFisico.execute(args, { directory: directorioActivo })
}

/** Todo `vistaFisica.execute()` deja un servidor HTTP+candado vivo EN EL PROCESO
 * (`registroServidores`, `tool/vista-fisica.ts`) — como cualquier otro test que abre
 * ese servidor (`phase2-e2e.test.mjs`/`phase2-s2-recorrido.test.mjs`), hay que
 * cerrarlo explícito o `node --test` nunca termina (handles abiertos). Reusa el MISMO
 * singleton en vez de levantar uno nuevo (`obtenerServidorVistaFisica` devuelve lo ya
 * registrado para ese (directorio, idProyecto)). */
async function cerrarVistaFisica(dirActivo, idProyecto) {
  const { servidor, servicio } = await obtenerServidorVistaFisica(dirActivo, idProyecto)
  await servidor.cerrar()
  servicio.cerrar()
}

// ════════════════════════════════════════════════════════════════════════════════════
// 1. F-07 — cliente ingenuo: SOLO 'leer'.vocabulario, 0 llamadas fallidas
// ════════════════════════════════════════════════════════════════════════════════════

test("F-07: un cliente ingenuo arma ESP32+LED+resistencia+pulsador (+AsignarPin de LED y pulsador) usando SOLO 'leer'.vocabulario, con 0 llamadas con ok:false", async () => {
  const dirActivo = nuevoDir("wave0-ingenuo")
  const idProyecto = nuevoIdProyecto()
  let llamadasFallidas = 0

  async function leer() {
    return parsearJson(await llamarProyectoFisico({ accion: "leer", idProyecto }, dirActivo))
  }
  async function aplicar(baseRevision, operaciones) {
    const r = parsearJson(await llamarProyectoFisico({ accion: "aplicar", idProyecto, baseRevision, operaciones }, dirActivo))
    if (!r.ok) llamadasFallidas += 1
    return r
  }

  let lectura = await leer()
  const vocabulario = lectura.vocabulario
  assert.ok(vocabulario, "'leer' tiene que traer 'vocabulario'")
  assert.ok(vocabulario.placas?.length > 0, "vocabulario.placas no puede estar vacío")
  assert.ok(vocabulario.componentes?.length > 0, "vocabulario.componentes no puede estar vacío")

  // Nunca ids hardcodeados del catálogo acá — todo sale de 'vocabulario'.
  const idPlaca = vocabulario.placas[0].id
  const tipoLed = vocabulario.componentes.find((c) => c.nombre === "LED")?.tipo
  const tipoResistencia = vocabulario.componentes.find((c) => c.nombre === "Resistencia")?.tipo
  const tipoPulsador = vocabulario.componentes.find((c) => c.nombre === "Pulsador")?.tipo
  assert.ok(idPlaca && tipoLed && tipoResistencia && tipoPulsador, `el vocabulario tiene que exponer estos 4 ids reales: ${JSON.stringify(vocabulario)}`)

  const pinDeEjemplo = vocabulario.operaciones?.AsignarPin?.pin
  assert.ok(typeof pinDeEjemplo === "string" && pinDeEjemplo.length > 0, "vocabulario.operaciones.AsignarPin tiene que traer un 'pin' de ejemplo REAL")

  let r = await aplicar(lectura.revision, [
    { tipo: "SetPlaca", payload: { placa: idPlaca } },
    { tipo: "AgregarComponente", payload: { tipo: tipoLed } },
    { tipo: "AgregarComponente", payload: { tipo: tipoResistencia } },
    { tipo: "AgregarComponente", payload: { tipo: tipoPulsador } },
  ])
  assert.equal(r.ok, true, `armado inicial rechazado: ${JSON.stringify(r.motivos)}`)

  lectura = await leer()
  const idLed = lectura.componentes.find((c) => c.tipo === tipoLed)?.id
  const idPulsador = lectura.componentes.find((c) => c.tipo === tipoPulsador)?.id
  assert.ok(idLed && idPulsador, "leer() tiene que devolver los ids reales de los componentes recién creados")

  const terminalLed = vocabulario.componentes.find((c) => c.tipo === tipoLed).terminales.find((t) => t.asignable)?.id
  const terminalPulsador = vocabulario.componentes.find((c) => c.tipo === tipoPulsador).terminales.find((t) => t.asignable)?.id
  assert.ok(terminalLed && terminalPulsador, "el vocabulario tiene que marcar al menos un terminal asignable por componente")

  r = await aplicar(lectura.revision, [
    { tipo: "AsignarPin", payload: { componente: idLed, terminal: terminalLed, pin: pinDeEjemplo } },
    { tipo: "AsignarPin", payload: { componente: idPulsador, terminal: terminalPulsador, pin: pinDeEjemplo } },
  ])
  assert.equal(r.ok, true, `cableado rechazado: ${JSON.stringify(r.motivos)}`)

  assert.equal(llamadasFallidas, 0, "0 llamadas con ok:false por adivinar ids (F-07)")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 2. F-07 — el vocabulario coincide EXACTAMENTE con el catálogo real
// ════════════════════════════════════════════════════════════════════════════════════

test("F-07: vocabulario.placas/componentes coincide EXACTAMENTE con catalogo.placas/componentes (nunca una lista aparte)", async () => {
  const dirActivo = nuevoDir("wave0-vocab-catalogo")
  const idProyecto = nuevoIdProyecto()
  const catalogo = construirCatalogoMinimoReal()

  const lectura = parsearJson(await llamarProyectoFisico({ accion: "leer", idProyecto }, dirActivo))
  const vocabulario = lectura.vocabulario

  assert.deepEqual(
    vocabulario.placas.map((p) => p.id).sort(),
    catalogo.placas.map((p) => p.id).sort(),
  )
  for (const placa of catalogo.placas) {
    const entrada = vocabulario.placas.find((p) => p.id === placa.id)
    assert.ok(entrada, `falta la placa ${placa.id} en el vocabulario`)
    assert.equal(entrada.nombre, placa.nombreVisible)
    assert.deepEqual(entrada.alias, placa.alias)
  }

  assert.deepEqual(
    vocabulario.componentes.map((c) => c.tipo).sort(),
    catalogo.componentes.map((c) => c.id).sort(),
  )
  for (const componente of catalogo.componentes) {
    const entrada = vocabulario.componentes.find((c) => c.tipo === componente.id)
    assert.ok(entrada, `falta el componente ${componente.id} en el vocabulario`)
    assert.equal(entrada.nombre, componente.nombreVisible)
    assert.equal(entrada.clase, componente.clase)
    assert.deepEqual(
      entrada.terminales.map((t) => t.id).sort(),
      componente.terminales.map((t) => t.id).sort(),
    )
    for (const terminal of componente.terminales) {
      const terminalVocab = entrada.terminales.find((t) => t.id === terminal.id)
      assert.equal(terminalVocab.asignable, terminal.electrica !== "riel-fijo", `terminal ${componente.id}.${terminal.id}`)
    }
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// 3. F-06 — línea 'resultado' inequívoca
// ════════════════════════════════════════════════════════════════════════════════════

test("F-06: 'leer' trae resultado 'SÓLO LECTURA — no cambió nada'", async () => {
  const dirActivo = nuevoDir("wave0-resultado-leer")
  const idProyecto = nuevoIdProyecto()
  const r = parsearJson(await llamarProyectoFisico({ accion: "leer", idProyecto }, dirActivo))
  assert.equal(r.resultado, "SÓLO LECTURA — no cambió nada")
})

test("F-06: 'simular' (ok) trae un resultado que arranca con 'SIMULACIÓN — no se aplicó nada' y nombra el resultado hipotético", async () => {
  const dirActivo = nuevoDir("wave0-resultado-simular")
  const idProyecto = nuevoIdProyecto()
  const r = parsearJson(await llamarProyectoFisico({ accion: "simular", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, dirActivo))
  assert.equal(r.ok, true, `simular rechazado: ${JSON.stringify(r.motivos)}`)
  assert.match(r.resultado, /^SIMULACIÓN — no se aplicó nada/)
  assert.match(r.resultado, /\bok\b/i, `tiene que nombrar el resultado hipotético (ok): ${r.resultado}`)
})

test("F-06: 'aplicar' (ok) trae resultado 'APLICADO — revisión X→Y'", async () => {
  const dirActivo = nuevoDir("wave0-resultado-aplicar")
  const idProyecto = nuevoIdProyecto()
  const r = parsearJson(await llamarProyectoFisico({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, dirActivo))
  assert.equal(r.ok, true, `aplicar rechazado: ${JSON.stringify(r.motivos)}`)
  assert.equal(r.resultado, "APLICADO — revisión 0→1")
})

test("F-06: rechazo de TRANSPORTE (whitelist) trae resultado 'NO SE APLICÓ NADA — ...'", async () => {
  const dirActivo = nuevoDir("wave0-resultado-transporte")
  const idProyecto = nuevoIdProyecto()
  const r = parsearJson(await llamarProyectoFisico({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "Foo", payload: {} }] }, dirActivo))
  assert.equal(r.ok, false)
  assert.equal(r.rechazadoPor, "tool")
  assert.match(r.resultado, /^NO SE APLICÓ NADA —/, `respuesta: ${JSON.stringify(r)}`)
})

test("F-06: rechazo del ENGINE (PLACA_DESCONOCIDA, no stale) trae resultado 'NO SE APLICÓ NADA — ...'", async () => {
  const dirActivo = nuevoDir("wave0-resultado-engine")
  const idProyecto = nuevoIdProyecto()
  const r = parsearJson(await llamarProyectoFisico({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "placa-inventada" } }] }, dirActivo))
  assert.equal(r.ok, false)
  assert.notEqual(r.rechazadoPor, "tool", "esto es un rechazo de DOMINIO (Engine)")
  assert.match(r.resultado, /^NO SE APLICÓ NADA —/, `respuesta: ${JSON.stringify(r)}`)
  assert.doesNotMatch(r.resultado, /el proyecto cambió/, "esto NO es stale")
})

test("F-06: STALE (BASE_REVISION_DESACTUALIZADA) trae resultado EXACTO 'NO SE APLICÓ NADA — el proyecto cambió; volvé a leer'", async () => {
  const dirActivo = nuevoDir("wave0-resultado-stale")
  const idProyecto = nuevoIdProyecto()
  const r0 = parsearJson(await llamarProyectoFisico({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, dirActivo))
  assert.equal(r0.ok, true)
  const r1 = parsearJson(await llamarProyectoFisico({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "AgregarComponente", payload: { tipo: "led" } }] }, dirActivo))
  assert.equal(r1.ok, false)
  assert.ok(r1.motivos.some((m) => m.codigo === "BASE_REVISION_DESACTUALIZADA"))
  assert.equal(r1.resultado, "NO SE APLICÓ NADA — el proyecto cambió; volvé a leer")
})

// ════════════════════════════════════════════════════════════════════════════════════
// 4. F-07 (continuación) — valoresValidos
// ════════════════════════════════════════════════════════════════════════════════════

test("F-07: PLACA_DESCONOCIDA agrega 'valoresValidos.placas' derivado del catálogo real", async () => {
  const dirActivo = nuevoDir("wave0-valores-validos-placa")
  const idProyecto = nuevoIdProyecto()
  const catalogo = construirCatalogoMinimoReal()
  const r = parsearJson(await llamarProyectoFisico({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "placa-inventada" } }] }, dirActivo))
  assert.equal(r.ok, false)
  assert.ok(r.motivos.some((m) => m.codigo === "PLACA_DESCONOCIDA"))
  assert.ok(r.valoresValidos, `tiene que traer 'valoresValidos': ${JSON.stringify(r)}`)
  assert.deepEqual(r.valoresValidos.placas.slice().sort(), catalogo.placas.map((p) => p.id).sort())
})

test("F-07: TIPO_CATALOGO_DESCONOCIDO agrega 'valoresValidos.tipos' derivado del catálogo real", async () => {
  const dirActivo = nuevoDir("wave0-valores-validos-tipo")
  const idProyecto = nuevoIdProyecto()
  const catalogo = construirCatalogoMinimoReal()
  const r0 = parsearJson(await llamarProyectoFisico({ accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }] }, dirActivo))
  assert.equal(r0.ok, true)
  const r = parsearJson(await llamarProyectoFisico({ accion: "aplicar", idProyecto, baseRevision: r0.revisionActual, operaciones: [{ tipo: "AgregarComponente", payload: { tipo: "tipo-inventado" } }] }, dirActivo))
  assert.equal(r.ok, false)
  assert.ok(r.motivos.some((m) => m.codigo === "TIPO_CATALOGO_DESCONOCIDO"))
  assert.ok(r.valoresValidos, `tiene que traer 'valoresValidos': ${JSON.stringify(r)}`)
  assert.deepEqual(r.valoresValidos.tipos.slice().sort(), catalogo.componentes.map((c) => c.id).sort())
})

test("F-07: TERMINAL_NO_DECLARADO agrega 'valoresValidos.terminales' del TIPO real del componente (del Proyecto vigente)", async () => {
  const dirActivo = nuevoDir("wave0-valores-validos-terminal")
  const idProyecto = nuevoIdProyecto()
  const catalogo = construirCatalogoMinimoReal()

  const r0 = parsearJson(
    await llamarProyectoFisico(
      { accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }, { tipo: "AgregarComponente", payload: { tipo: "led" } }] },
      dirActivo,
    ),
  )
  assert.equal(r0.ok, true)
  const lectura = parsearJson(await llamarProyectoFisico({ accion: "leer", idProyecto }, dirActivo))
  const idLed = lectura.componentes.find((c) => c.tipo === "led").id

  const r = parsearJson(
    await llamarProyectoFisico({ accion: "aplicar", idProyecto, baseRevision: lectura.revision, operaciones: [{ tipo: "AsignarPin", payload: { componente: idLed, terminal: "terminal-inventado", pin: "GPIO4" } }] }, dirActivo),
  )
  assert.equal(r.ok, false)
  assert.ok(r.motivos.some((m) => m.codigo === "TERMINAL_NO_DECLARADO"))
  assert.ok(r.valoresValidos, `tiene que traer 'valoresValidos': ${JSON.stringify(r)}`)
  const terminalesLed = catalogo.obtenerComponente("led").terminales.map((t) => t.id)
  assert.deepEqual(r.valoresValidos.terminales.slice().sort(), terminalesLed.sort())
})

// ════════════════════════════════════════════════════════════════════════════════════
// 5. F-13 — 'nombre' y 'descripcionPines' por componente
// ════════════════════════════════════════════════════════════════════════════════════

test("F-13: 'leer' agrega 'nombre' (nombreVisible) y 'descripcionPines' por componente, derivados del IR y del catálogo", async () => {
  const dirActivo = nuevoDir("wave0-pines-descripcion")
  const idProyecto = nuevoIdProyecto()

  let r = parsearJson(
    await llamarProyectoFisico(
      { accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }, { tipo: "AgregarComponente", payload: { tipo: "led" } }] },
      dirActivo,
    ),
  )
  assert.equal(r.ok, true)

  let lectura = parsearJson(await llamarProyectoFisico({ accion: "leer", idProyecto }, dirActivo))
  const idLed = lectura.componentes.find((c) => c.tipo === "led").id
  let led = lectura.componentes.find((c) => c.id === idLed)
  assert.equal(led.nombre, "LED")
  assert.equal(led.descripcionPines, "anodo → sin asignar, catodo → GND (fijo)", `descripcionPines sin pin asignado: ${JSON.stringify(led)}`)

  r = parsearJson(await llamarProyectoFisico({ accion: "aplicar", idProyecto, baseRevision: r.revisionActual, operaciones: [{ tipo: "AsignarPin", payload: { componente: idLed, terminal: "anodo", pin: "GPIO4" } }] }, dirActivo))
  assert.equal(r.ok, true)

  lectura = parsearJson(await llamarProyectoFisico({ accion: "leer", idProyecto }, dirActivo))
  led = lectura.componentes.find((c) => c.id === idLed)
  assert.equal(led.descripcionPines, "anodo → GPIO4, catodo → GND (fijo)", `descripcionPines con pin asignado: ${JSON.stringify(led)}`)
})

// ════════════════════════════════════════════════════════════════════════════════════
// 6. F-05 + "varias pestañas"
// ════════════════════════════════════════════════════════════════════════════════════

test("F-05: vista-fisica.execute() sobre un proyecto VACÍO dice explícitamente que está vacío", async () => {
  const dirActivo = nuevoDir("wave0-vista-vacia")
  const idProyecto = nuevoIdProyecto()
  try {
    const respuesta = await vistaFisica.execute({ idProyecto }, { directory: dirActivo })
    assert.match(respuesta, /proyecto está VACÍO: todavía no tiene placa ni componentes/, `respuesta: ${respuesta}`)
  } finally {
    await cerrarVistaFisica(dirActivo, idProyecto)
  }
})

test("F-05: vista-fisica.execute() sobre un proyecto ARMADO resume placa/piezas/motivos bloqueantes", async () => {
  const dirActivo = nuevoDir("wave0-vista-armada")
  const idProyecto = nuevoIdProyecto()
  const r = parsearJson(
    await llamarProyectoFisico(
      { accion: "aplicar", idProyecto, baseRevision: 0, operaciones: [{ tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } }, { tipo: "AgregarComponente", payload: { tipo: "led" } }] },
      dirActivo,
    ),
  )
  assert.equal(r.ok, true)

  try {
    const respuesta = await vistaFisica.execute({ idProyecto }, { directory: dirActivo })
    assert.match(respuesta, /Muestra:/, `respuesta: ${respuesta}`)
    assert.match(respuesta, /ESP32 DevKit/, `tiene que nombrar la placa por su nombreVisible: ${respuesta}`)
    assert.match(respuesta, /LED/, `tiene que nombrar el componente: ${respuesta}`)
    assert.match(respuesta, /1 motivo bloqueante/, `el LED sin resistencia en serie es REQUISITO_INSATISFECHO (blocking): ${respuesta}`)
  } finally {
    await cerrarVistaFisica(dirActivo, idProyecto)
  }
})

test("resumenDelProyecto (función pura): vacío vs. armado, sin pasar por HTTP/navegador", async () => {
  const dirActivo = nuevoDir("wave0-resumen-puro")
  const idProyecto = nuevoIdProyecto()
  const dirDatos = directorioDeDatos(dirActivo)
  const catalogo = construirCatalogoMinimoReal()
  const servicio = obtenerServicioDeProyectoConVista({ directorio: dirDatos, idProyecto })
  try {
    assert.match(resumenDelProyecto(servicio.snapshot(), catalogo), /VACÍO/, "proyecto recién creado: vacío")

    let r = servicio.aplicar({ idOperacion: "w0-1", actor: "agente", baseRevision: 0, tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } })
    assert.equal(r.ok, true)
    r = servicio.aplicar({ idOperacion: "w0-2", actor: "agente", baseRevision: 1, tipo: "AgregarComponente", payload: { tipo: "led" } })
    assert.equal(r.ok, true)

    const resumenArmado = resumenDelProyecto(servicio.snapshot(), catalogo)
    assert.match(resumenArmado, /Muestra:/)
    assert.match(resumenArmado, /ESP32 DevKit/)
    assert.match(resumenArmado, /LED/)
    assert.match(resumenArmado, /1 motivo bloqueante/)
  } finally {
    servicio.cerrar()
  }
})

test("Pestañas: con el servidor de este (directorio, idProyecto) YA levantado en este proceso, una segunda llamada NO abre otra pestaña salvo reabrir:true", async () => {
  const dirActivo = nuevoDir("wave0-pestanas")
  const idProyecto = nuevoIdProyecto()
  try {
    const primera = await vistaFisica.execute({ idProyecto }, { directory: dirActivo })
    assert.doesNotMatch(primera, /ya estaba abierta/i, `la primera vez tiene que intentar abrir: ${primera}`)

    const segunda = await vistaFisica.execute({ idProyecto }, { directory: dirActivo })
    assert.match(segunda, /ya estaba abierta/i, `mismo (directorio, idProyecto) en el MISMO proceso: no tendría que abrir otra pestaña: ${segunda}`)

    const forzada = await vistaFisica.execute({ idProyecto, reabrir: true }, { directory: dirActivo })
    assert.doesNotMatch(forzada, /ya estaba abierta/i, `con reabrir:true tiene que forzar la apertura igual: ${forzada}`)
  } finally {
    await cerrarVistaFisica(dirActivo, idProyecto)
  }
})

test("debeAbrirNuevaPestana (función pura, F-05 continuación): nunca reabre salvo reabrir:true", () => {
  assert.equal(debeAbrirNuevaPestana(false, undefined), true, "primera vez (nunca estuvo abierto en este proceso): abre")
  assert.equal(debeAbrirNuevaPestana(true, undefined), false, "ya abierto en este proceso, sin reabrir: NO abre otra pestaña")
  assert.equal(debeAbrirNuevaPestana(true, false), false, "ya abierto, reabrir:false explícito: NO abre otra pestaña")
  assert.equal(debeAbrirNuevaPestana(true, true), true, "ya abierto, reabrir:true: SÍ fuerza la apertura")
})

// ════════════════════════════════════════════════════════════════════════════════════
// Estático — descripción de la tool actualizada (F-07)
// ════════════════════════════════════════════════════════════════════════════════════

test("F-07 (estático): la descripción de 'proyecto-fisico' le dice al agente que 'leer' trae el vocabulario válido", () => {
  const crudo = readFileSync(join(REPO, "opencode/tool/proyecto-fisico.ts"), "utf8")
  assert.match(crudo, /llamá `leer` primero: trae el vocabulario válido \(placas, componentes, terminales, ejemplos\)/)
})
