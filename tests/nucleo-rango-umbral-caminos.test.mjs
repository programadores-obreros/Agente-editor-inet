// Phase 1.2 — REA-02 (MAYOR, re-auditoría externa AUD-C-02,
// `PHASE_1_1_EXTERNAL_FINDINGS.md`): "umbral fuera del rango declarado del sensor"
// era un WARNING que sólo `reemplazarSensor` (`catalogo.ts`, rama C de §8.1 del
// brief) emitía, únicamente durante la operación `CambiarComponente` — el MISMO
// estado (mismo sensor, mismo umbral, mismo rango) llegado por cualquier otra puerta
// del núcleo (operación `SetComportamiento` directa, `proyectoInicial`, recarga
// desde disco vía el Almacén real) validaba SIN ningún aviso, hasta `listo:true`.
//
// Contrato (decisión del orquestador, con fuente — ver
// `odd/tasks/programacion-intencion-fase1-2.md` "Decisiones del orquestador", y
// `docs/programacion-intencion/DECISIONS.md`): Brief §8.1 rama C ("se conserva el
// umbral/intención y se advierte") + §12.1 (`warning` = "proyecto utilizable pero
// requiere atención"; sólo `blocking` impide `ready`) + Brief l.1856 ("no convertir
// todos los warnings en bloqueos"). El aviso es un WARNING DERIVADO DEL ESTADO, no
// del camino por el que ese estado se alcanzó — este archivo prueba exactamente eso:
// las 4 puertas que pueden producir el MISMO estado final tienen que dar el MISMO
// código de motivo de rango en `validarProyecto()`, con la MISMA severidad/
// clasificación, y la MISMA `derivarReadiness()`.
//
// Usa el Almacén REAL (fs real de node:fs) para el camino C (save→load) — mismo
// criterio que `nucleo-persistible-recargable.test.mjs` (Phase 1.2, T-A).

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { rmSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const DIR_BASE = join(os.tmpdir(), "tecniabot-test-nucleo-rango-umbral-caminos")

const { crearMotorDeProyecto } = await import(join(REPO, "opencode/nucleo/motor.ts"))
const { crearAlmacen } = await import(join(REPO, "opencode/nucleo/almacen.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const { validarProyecto, derivarReadiness } = await import(join(REPO, "opencode/nucleo/validar.ts"))
const { construirCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))

// Fixture SINTÉTICO de test (no-producto, mismo criterio que `sensor-temp-f`/
// `sensor-temp-corto` de `tests/nucleo-catalogo.test.mjs`): mismo TIPO de terminal
// que el DHT22 real (vcc riel-fijo/senal digital-entrada/gnd riel-fijo) para que
// `CambiarComponente` (camino D) preserve la asignación de pin sin fricción, pero con
// un rango deliberadamente AMPLIO para que un umbral de 200°C sea compatible ANTES
// del reemplazo — lo que permite terminar los 4 caminos en el MISMO estado final
// (sensor `dht22`, umbral 200°C) sin que ningún camino tenga que "empezar" ya roto.
const SENSOR_RANGO_AMPLIO_FIXTURE = {
  id: "sensor-rango-amplio-fixture",
  nombreVisible: "Sensor de prueba con rango amplio (no-producto)",
  clase: "sensor",
  terminales: [
    { id: "vcc", rol: "alimentacion", electrica: "riel-fijo", destinoFijo: "VLOGICA" },
    { id: "senal", rol: "senal", electrica: "digital", direccion: "entrada" },
    { id: "gnd", rol: "tierra", electrica: "riel-fijo", destinoFijo: "GND" },
  ],
  capacidades: [
    {
      id: "temperatura",
      magnitud: "temperatura",
      unidad: "celsius",
      rango: { min: { valor: -273, unidad: "celsius", magnitud: "temperatura" }, max: { valor: 1000, unidad: "celsius", magnitud: "temperatura" } },
    },
  ],
  requisitos: [],
  compatibilidades: { placas: ["esp32-devkit-v1", "arduino-uno"] },
}

const catalogo = construirCatalogo(
  { version: VERSION_CATALOGO_MINIMO, componentes: [...COMPONENTES_CATALOGO_MINIMO, SENSOR_RANGO_AMPLIO_FIXTURE], placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } },
  sha256Hex,
)

const PLACA = "esp32-devkit-v1"
const PIN_SENSOR = catalogo.pinesDePlaca(PLACA).find((p) => p.capacidades.entradaDigital).id
// MOD (db797c5): pin de salida digital distinto del del sensor, para el LED actuador.
const PIN_LED = "GPIO18"

before(() => {
  rmSync(DIR_BASE, { recursive: true, force: true })
  mkdirSync(DIR_BASE, { recursive: true })
})

let contadorOp = 0
function op(tipo, payload, baseRevision) {
  return { idOperacion: `op-${contadorOp++}`, actor: "agente", baseRevision, tipo, payload }
}

function nuevoDir(nombre) {
  const dir = join(DIR_BASE, nombre)
  mkdirSync(dir, { recursive: true })
  return dir
}

function crearMotorReal(dir, id) {
  const proyectoInicial = crearProyecto({ generadorId: () => id, ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  const almacen = crearAlmacen({ directorio: dir, catalogo })
  const motor = crearMotorDeProyecto({ proyectoInicial, catalogo, almacen })
  return { motor, almacen }
}

/** Sólo el/los motivo(s) de rango de `validarProyecto()` — nunca el motivo
 * TRANSITORIO/informativo de la operación `CambiarComponente`
 * (`RANGO_INCOMPATIBLE_AL_REEMPLAZAR`, emitido por `reemplazarSensor` en el eco de
 * ESA operación puntual, nunca persistido ni parte de la validación continua). */
function motivosDeRango(motivos) {
  return motivos.filter((m) => m.codigo === "UMBRAL_FUERA_DE_RANGO")
}

// ════════════════════════════════════════════════════════════════════════════════════
// Camino A — operación directa (SetComportamiento)
// ════════════════════════════════════════════════════════════════════════════════════

function construirCaminoA() {
  const dir = nuevoDir("camino-a-operacion-directa")
  const { motor } = crearMotorReal(dir, "camino-a")
  motor.aplicar(op("SetPlaca", { placa: PLACA }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "dht22" }, motor.getProyecto().revision))
  // MOD (excepción declarada a HD-P3D-6, db797c5): el actuador de la regla es un `led`
  // REAL (cmp-1) con su resistencia en serie (cmp-2) — antes era una `resistencia`
  // usada como actuador, que Phase 3 (ACTUADOR_INVALIDO) ya no acepta en silencio.
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "resistencia" }, motor.getProyecto().revision))
  motor.aplicar(op("Conectar", { desde: { componente: "cmp-1", terminal: "anodo" }, hasta: { componente: "cmp-2", terminal: "a" } }, motor.getProyecto().revision))
  motor.aplicar(op("AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: PIN_LED }, motor.getProyecto().revision))
  motor.aplicar(op("AsignarPin", { componente: "cmp-0", terminal: "senal", pin: PIN_SENSOR }, motor.getProyecto().revision))
  const r = motor.aplicar(
    op(
      "SetComportamiento",
      { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: { valor: 200, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-1", accion: "encender" } } },
      motor.getProyecto().revision,
    ),
  )
  assert.equal(r.ok, true, `SetComportamiento con umbral fuera de rango debe COMMITEAR (representable, nunca rechazo): ${JSON.stringify(r.motivos)}`)
  assert.equal(motor.getProyecto().comportamientos[0].cuando.umbral.valor, 200, "el umbral se preserva, nunca se clampa")
  return { dir, proyecto: motor.getProyecto() }
}

// ════════════════════════════════════════════════════════════════════════════════════
// Camino B — proyecto inicial (crearMotorDeProyecto({ proyectoInicial }))
// ════════════════════════════════════════════════════════════════════════════════════

function construirCaminoB(proyectoObjetivo) {
  const dir = nuevoDir("camino-b-proyecto-inicial")
  const almacen = crearAlmacen({ directorio: dir, catalogo })
  // MISMO objeto que ya produjo el Camino A (mismo sensor, mismo umbral, mismo
  // rango) — acá llega como `proyectoInicial` de un motor NUEVO, nunca vía
  // operación: exactamente la puerta que la re-auditoría marcó como "tampoco hay
  // aviso".
  const motor = crearMotorDeProyecto({ proyectoInicial: proyectoObjetivo, catalogo, almacen })
  return motor.getProyecto()
}

// ════════════════════════════════════════════════════════════════════════════════════
// Camino C — save → load con el Almacén REAL
// ════════════════════════════════════════════════════════════════════════════════════

function construirCaminoC(dirCaminoA, id) {
  // Reusa el directorio del Camino A: cada `motor.aplicar()` de la operación
  // COMMITEA (= guarda) vía el Almacén real inyectado — esto es, literalmente,
  // "guardar y volver a cargar" el MISMO documento que el Camino A ya persistió.
  const recargado = crearAlmacen({ directorio: dirCaminoA, catalogo }).cargar(id)
  assert.equal(recargado.ok, true, `debe recargar sin problema: ${JSON.stringify(recargado.ok ? [] : recargado.motivos)}`)
  return recargado.proyecto
}

// ════════════════════════════════════════════════════════════════════════════════════
// Camino D — reemplazo de sensor (CambiarComponente, rama C de §8.1)
// ════════════════════════════════════════════════════════════════════════════════════

function construirCaminoD() {
  const dir = nuevoDir("camino-d-reemplazo-sensor")
  const { motor } = crearMotorReal(dir, "camino-d")
  motor.aplicar(op("SetPlaca", { placa: PLACA }, motor.getProyecto().revision))
  // Arranca con el sensor de rango AMPLIO: 200°C es compatible acá — sin warning.
  motor.aplicar(op("AgregarComponente", { tipo: "sensor-rango-amplio-fixture" }, motor.getProyecto().revision))
  // MOD (excepción declarada a HD-P3D-6, db797c5): el actuador de la regla es un `led`
  // REAL (cmp-1) con su resistencia en serie (cmp-2) — antes era una `resistencia`
  // usada como actuador, que Phase 3 (ACTUADOR_INVALIDO) ya no acepta en silencio.
  motor.aplicar(op("AgregarComponente", { tipo: "led" }, motor.getProyecto().revision))
  motor.aplicar(op("AgregarComponente", { tipo: "resistencia" }, motor.getProyecto().revision))
  motor.aplicar(op("Conectar", { desde: { componente: "cmp-1", terminal: "anodo" }, hasta: { componente: "cmp-2", terminal: "a" } }, motor.getProyecto().revision))
  motor.aplicar(op("AsignarPin", { componente: "cmp-1", terminal: "anodo", pin: PIN_LED }, motor.getProyecto().revision))
  motor.aplicar(op("AsignarPin", { componente: "cmp-0", terminal: "senal", pin: PIN_SENSOR }, motor.getProyecto().revision))
  const rSet = motor.aplicar(
    op(
      "SetComportamiento",
      { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: { valor: 200, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-1", accion: "encender" } } },
      motor.getProyecto().revision,
    ),
  )
  assert.equal(rSet.ok, true)
  assert.equal(
    motivosDeRango(validarProyecto(motor.getProyecto(), catalogo)).length,
    0,
    "ANTES del reemplazo, con el sensor de rango amplio, 200°C está dentro de rango: sin warning",
  )

  // Reemplaza el sensor por el DHT22 REAL (rango [0,60]°C) — mismo terminal "senal",
  // misma forma eléctrica: el pin se preserva. El umbral de 200°C queda AHORA fuera
  // del rango declarado del sensor nuevo — rama C de §8.1.
  const rCambiar = motor.aplicar(op("CambiarComponente", { componente: "cmp-0", tipoNuevo: "dht22" }, motor.getProyecto().revision))
  assert.equal(rCambiar.ok, true, "CambiarComponente SIEMPRE commitea si tipoNuevo existe (rama C es representable, no rechazo)")
  assert.ok(
    rCambiar.motivos.some((m) => m.codigo === "RANGO_INCOMPATIBLE_AL_REEMPLAZAR"),
    `regresión: reemplazarSensor debe seguir emitiendo su motivo TRANSITORIO propio de la operación: ${JSON.stringify(rCambiar.motivos)}`,
  )
  assert.equal(motor.getProyecto().componentes[0].tipo, "dht22")
  assert.equal(motor.getProyecto().comportamientos[0].cuando.umbral.valor, 200, "el umbral NO se recorta al cambiar de sensor")
  return motor.getProyecto()
}

// ════════════════════════════════════════════════════════════════════════════════════
// Test de contrato — equivalencia por caminos
// ════════════════════════════════════════════════════════════════════════════════════

test("REA-02: los 4 caminos que producen el MISMO estado (mismo sensor dht22, mismo umbral 200C, mismo rango [0,60]C) dan la MISMA clasificacion de rango en validarProyecto y la MISMA readiness", () => {
  const { dir: dirA, proyecto: proyectoA } = construirCaminoA()
  const proyectoB = construirCaminoB(proyectoA)
  const proyectoC = construirCaminoC(dirA, proyectoA.id)
  const proyectoD = construirCaminoD()

  const caminos = {
    "A (operacion directa, SetComportamiento)": proyectoA,
    "B (proyecto inicial, crearMotorDeProyecto({proyectoInicial}))": proyectoB,
    "C (save -> load, Almacen real)": proyectoC,
    "D (reemplazo de sensor, CambiarComponente, rama C)": proyectoD,
  }

  for (const [nombre, proyecto] of Object.entries(caminos)) {
    assert.equal(proyecto.componentes[0].tipo, "dht22", `${nombre}: mismo sensor final`)
    assert.equal(proyecto.comportamientos[0].cuando.umbral.valor, 200, `${nombre}: mismo umbral final`)
  }

  const motivosPorCamino = {}
  const readinessPorCamino = {}
  for (const [nombre, proyecto] of Object.entries(caminos)) {
    const motivos = validarProyecto(proyecto, catalogo)
    motivosPorCamino[nombre] = motivosDeRango(motivos)
    readinessPorCamino[nombre] = derivarReadiness(proyecto, motivos)
  }

  // Resumen de los 4 caminos en UNA sola aserción: si algún camino (en particular B o
  // C, los que la re-auditoría marcó "el aviso desaparece") queda en 0, el mensaje de
  // fallo lo muestra ACÁ, para los 4 a la vez -- nunca se corta en el primero.
  const cantidadPorCamino = Object.fromEntries(Object.entries(motivosPorCamino).map(([nombre, motivos]) => [nombre, motivos.length]))
  const esperado = Object.fromEntries(Object.keys(caminos).map((nombre) => [nombre, 1]))
  assert.deepEqual(cantidadPorCamino, esperado, `los 4 caminos deben tener EXACTAMENTE 1 motivo de rango cada uno: ${JSON.stringify(cantidadPorCamino)}`)

  for (const [nombre, motivosRango] of Object.entries(motivosPorCamino)) {
    assert.equal(motivosRango.length, 1, `${nombre}: debe haber EXACTAMENTE un motivo de rango en validarProyecto: ${JSON.stringify(motivosRango)}`)
    const [motivo] = motivosRango
    assert.equal(motivo.codigo, "UMBRAL_FUERA_DE_RANGO", `${nombre}: mismo reason code de rango en los 4 caminos`)
    assert.equal(motivo.categoria, "tecnica", `${nombre}: misma categoria`)
    assert.equal(motivo.severidad, "warning", `${nombre}: WARNING, nunca blocking (Brief §12.1)`)
    assert.equal(motivo.clasificacion, "representable", `${nombre}: REPRESENTABLE, nunca rechazo`)
    assert.equal(motivo.entidad.tipo, "comportamiento")
  }

  const [primerNombre, primeraReadiness] = Object.entries(readinessPorCamino)[0]
  for (const [nombre, readiness] of Object.entries(readinessPorCamino)) {
    assert.deepEqual(readiness, primeraReadiness, `${nombre}: MISMA readiness que ${primerNombre} — ${JSON.stringify(readiness)} vs ${JSON.stringify(primeraReadiness)}`)
  }
  // El warning de rango NUNCA afecta readiness (Brief §12.1: sólo `blocking` impide
  // `ready`) — el estado sigue siendo `listo:true` en los 4 caminos: exactamente el
  // "OK falso" que la re-auditoría marcó (queda `listo:true`), pero ahora CON el
  // aviso visible al lado, nunca silencioso.
  assert.deepEqual(primeraReadiness, { incompleto: false, invalido: false, listo: true })
})
