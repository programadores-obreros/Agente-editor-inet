// Gate 3 — catálogo mínimo + capacidades + cantidades de "Programación por Intención".
//
// Ver docs/programacion-intencion/COMPONENT-CATALOG.md para el contrato completo
// (contenido shippeado, tabla de clasificación de motivos RECHAZO/REPRESENTABLE).
//
// `sensor-temp-f` y `sensor-temp-corto` son fixtures SINTÉTICOS de este archivo, no
// forman parte del catálogo shippeado (`catalogo-datos.ts`) — existen sólo para
// demostrar la rama B (conversión de unidad) y la rama C (rango incompatible) de
// `reemplazarSensor` con datos que hoy no tiene ningún componente real (T_diseno_consolidado.md §4.3).

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { evaluarRequisito, asignarPin, propagarMagnitud, reemplazarSensor, construirCatalogo, canonicalizarCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { LED, DHT22, NTC, COMPONENTES_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { construirCatalogoMinimoReal, sha256Hex } = await import(join(REPO, "opencode/nucleo/adaptadores/hash-catalogo.node.ts"))
const { REGISTRO_PLACAS } = await import(join(REPO, "opencode/nucleo/placas.ts"))

// ─────────────────────────────────── fixtures de test (no-producto) ───────────────────

/** Sólo para ejercitar rama B (conversión explícita) — no existe en circuito.ts. */
const SENSOR_TEMP_F = {
  id: "sensor-temp-f-fixture",
  nombreVisible: "Sensor de prueba en Fahrenheit (no-producto)",
  clase: "sensor",
  terminales: [{ id: "senal", rol: "senal", electrica: "analogica", direccion: "entrada" }],
  capacidades: [{ id: "temperatura", magnitud: "temperatura", unidad: "fahrenheit" }],
  requisitos: [],
}

/** Sólo para ejercitar rama C (rango más angosto que el umbral existente). */
const SENSOR_TEMP_CORTO = {
  id: "sensor-temp-corto-fixture",
  nombreVisible: "Sensor de prueba de rango corto (no-producto)",
  clase: "sensor",
  terminales: [{ id: "senal", rol: "senal", electrica: "analogica", direccion: "entrada" }],
  capacidades: [
    { id: "temperatura", magnitud: "temperatura", unidad: "celsius", rango: { min: { valor: 0, unidad: "celsius", magnitud: "temperatura" }, max: { valor: 25, unidad: "celsius", magnitud: "temperatura" } } },
  ],
  requisitos: [],
}

const catalogoReal = construirCatalogoMinimoReal()

// ──────────────────────────────── 1. catalogo-carga-valida ────────────────────────────

test("catalogo-carga-valida", () => {
  assert.equal(catalogoReal.version, VERSION_CATALOGO_MINIMO)
  assert.ok(catalogoReal.obtenerComponente("led"))
  assert.ok(catalogoReal.obtenerComponente("dht22"))
  assert.ok(catalogoReal.obtenerComponente("ntc"))
  assert.equal(catalogoReal.obtenerComponente("no-existe"), undefined)
  assert.ok(catalogoReal.tienePlaca("esp32-devkit-v1"))
  assert.ok(catalogoReal.tienePlaca("arduino-uno"))
  assert.equal(catalogoReal.tienePlaca("placa-fantasma"), false)
  assert.ok(catalogoReal.pinesDePlaca("esp32-devkit-v1").length > 0)
  assert.match(catalogoReal.hash, /^[0-9a-f]{64}$/, "sha256 hex de 64 caracteres")
})

// ──────────────────────────── 2. hash-cambia-con-contenido ────────────────────────────

test("hash-cambia-con-contenido", () => {
  const datosA = { version: "1.0.0", componentes: [LED], placas: [], unidades: undefined }
  // Mismo contenido, claves en OTRO orden dentro del objeto — la canonicalización
  // (claves ordenadas) tiene que dar el MISMO hash. Si esto se rompe (mutación:
  // reordenar claves del JSON de entrada sin canonicalizar), el test detecta que el
  // hash cambió sin que el contenido haya cambiado de verdad.
  const datosAReordenado = { unidades: undefined, placas: [], componentes: [LED], version: "1.0.0" }
  assert.equal(canonicalizarCatalogo(datosA), canonicalizarCatalogo(datosAReordenado))
  const catA = construirCatalogo(datosA, sha256Hex)
  const catAReordenado = construirCatalogo(datosAReordenado, sha256Hex)
  assert.equal(catA.hash, catAReordenado.hash, "el orden de las claves de entrada no debe cambiar el hash")

  // Contenido REALMENTE distinto (un componente más) → hash distinto.
  const datosB = { version: "1.0.0", componentes: [LED, DHT22], placas: [], unidades: undefined }
  const catB = construirCatalogo(datosB, sha256Hex)
  assert.notEqual(catA.hash, catB.hash, "agregar un componente debe cambiar el hash")
})

// ────────────────────── 3/4. requisito de resistencia-serie ──────────────────────────

test("requisito-resistencia-serie-satisfecho", () => {
  const motivos = evaluarRequisito(LED, { anodo: ["resistencia"] })
  assert.deepEqual(motivos, [])
})

test("requisito-resistencia-serie-faltante", () => {
  const motivos = evaluarRequisito(LED, { anodo: ["dht22"] })
  assert.equal(motivos.length, 1)
  assert.equal(motivos[0].codigo, "REQUISITO_INSATISFECHO")
  assert.equal(motivos[0].clasificacion, "representable")
})

// ────────────────────────── 5. asignar-pin-capacidad-incompatible ─────────────────────

test("asignar-pin-capacidad-incompatible", () => {
  const terminalDigital = LED.terminales.find((t) => t.id === "anodo")
  const pinSoloEntrada = REGISTRO_PLACAS["esp32-devkit-v1"].pines.find((p) => p.id === "GPIO34")
  assert.ok(pinSoloEntrada, "fixture: GPIO34 debe existir (Gate 1)")
  const motivo = asignarPin(terminalDigital, pinSoloEntrada)
  assert.ok(motivo, "un terminal digital de salida sobre un pin solo-entrada debe ser incompatible")
  assert.equal(motivo.codigo, "CAPACIDAD_PIN_INCOMPATIBLE")

  const pinNormal = REGISTRO_PLACAS["esp32-devkit-v1"].pines.find((p) => p.id === "GPIO23")
  assert.equal(asignarPin(terminalDigital, pinNormal), null, "GPIO23 sí debe ser compatible")
})

// Hallazgo adversarial Gate 8 (Agente X, mutante M16): la rama `requierePwm` de
// `asignarPin` está implementada correctamente desde Gate 3 pero NINGÚN componente
// del catálogo mínimo shippeado la declara (`led`/`resistencia`/`pulsador`/`dht22`/
// `ntc` no tienen ningún terminal con `requierePwm:true`) y ningún test la
// ejercitaba — sobrevivió a la campaña de mutación de Agente X sin que las 143
// pruebas existentes lo notaran. Terminal + pin son un fixture de test (D2 del
// arduino-uno, que existe pero NO está en `UNO_POOL_PWM`, Gate 1).
test("asignar-pin-detecta-capacidad-pin-incompatible-por-requierePwm (hallazgo adversarial Gate 8, mutante M16)", () => {
  const terminalConPwm = { id: "t-pwm", rol: "senal", electrica: "digital", direccion: "salida", requierePwm: true }
  const pinSinPwm = REGISTRO_PLACAS["arduino-uno"].pines.find((p) => p.id === "D2")
  assert.ok(pinSinPwm && pinSinPwm.capacidades.pwm === false, "fixture: D2 del UNO no tiene PWM")
  const motivo = asignarPin(terminalConPwm, pinSinPwm)
  assert.ok(motivo, "un terminal que requiere PWM sobre un pin sin PWM debe ser incompatible")
  assert.equal(motivo.codigo, "CAPACIDAD_PIN_INCOMPATIBLE")

  const pinConPwm = REGISTRO_PLACAS["arduino-uno"].pines.find((p) => p.id === "D3")
  assert.ok(pinConPwm && pinConPwm.capacidades.pwm === true, "fixture: D3 del UNO SÍ tiene PWM")
  assert.equal(asignarPin(terminalConPwm, pinConPwm), null, "D3 sí debe ser compatible con un terminal que pide PWM")
})

// ───────────────────────────── 6. magnitud-dimension-incompatible ─────────────────────

test("magnitud-dimension-incompatible", () => {
  const r = propagarMagnitud({ valor: 10, unidad: "celsius", magnitud: "temperatura" }, "distancia", "cm", catalogoReal)
  assert.equal(r.ok, false)
  assert.equal(r.motivo.codigo, "MAGNITUD_INCOMPATIBLE")
})

// ───────────────────────── 7. magnitud-conversion-unidad-explicita ────────────────────

test("magnitud-conversion-unidad-explicita", () => {
  const r = propagarMagnitud({ valor: 98.6, unidad: "fahrenheit", magnitud: "temperatura" }, "temperatura", "celsius", catalogoReal)
  assert.equal(r.ok, true)
  assert.ok(Math.abs(r.valor.valor - 37) < 0.01, `98.6°F debería ser 37°C, dio ${r.valor.valor}`)
  assert.equal(r.motivo.codigo, "UNIDAD_CONVERTIDA")
  assert.equal(r.motivo.severidad, "info")
})

// ───────────────────────────── 8-11. reemplazarSensor, 4 ramas ────────────────────────

test("reemplazar-sensor-rama-a: misma unidad, dentro de rango, umbral preservado", () => {
  const comportamiento = { id: "beh-0", cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-1", accion: "encender" } }
  const r = reemplazarSensor(comportamiento, NTC, catalogoReal)
  assert.equal(r.motivo, null)
  assert.equal(r.comportamiento.cuando.umbral.valor, 30)
  assert.equal(r.comportamiento.cuando.umbral.unidad, "celsius")
})

test("reemplazar-sensor-rama-b: conversion explicita de unidad", () => {
  const comportamiento = { id: "beh-0", cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-1", accion: "encender" } }
  const r = reemplazarSensor(comportamiento, SENSOR_TEMP_F, catalogoReal)
  assert.ok(r.motivo, "debe informar la conversión")
  assert.equal(r.motivo.codigo, "UNIDAD_CONVERTIDA")
  assert.equal(r.comportamiento.cuando.umbral.unidad, "fahrenheit")
  assert.ok(Math.abs(r.comportamiento.cuando.umbral.valor - 86) < 0.01, `30°C debería ser 86°F, dio ${r.comportamiento.cuando.umbral.valor}`)
})

test("reemplazar-sensor-rama-c: rango incompatible, warning, umbral NO recortado", () => {
  const comportamiento = { id: "beh-0", cuando: { sensor: "cmp-0", capacidad: "temperatura", comparador: ">", umbral: { valor: 30, unidad: "celsius", magnitud: "temperatura" } }, entonces: { actuador: "cmp-1", accion: "encender" } }
  const r = reemplazarSensor(comportamiento, SENSOR_TEMP_CORTO, catalogoReal)
  assert.ok(r.motivo)
  assert.equal(r.motivo.codigo, "RANGO_INCOMPATIBLE_AL_REEMPLAZAR")
  assert.equal(r.motivo.severidad, "warning")
  assert.equal(r.comportamiento.cuando.umbral.valor, 30, "el umbral NO se recorta al máximo del rango nuevo (a diferencia de armarPuente:1903 en circuito.ts)")
})

test("reemplazar-sensor-rama-d: capacidad incompatible, blocking, nunca reinterpretado", () => {
  const comportamiento = { id: "beh-0", cuando: { sensor: "cmp-0", capacidad: "humedad", comparador: ">", umbral: { valor: 70, unidad: "porcentaje", magnitud: "humedad" } }, entonces: { actuador: "cmp-1", accion: "encender" } }
  const r = reemplazarSensor(comportamiento, NTC, catalogoReal)
  assert.ok(r.motivo)
  assert.equal(r.motivo.codigo, "CAPACIDAD_INCOMPATIBLE_AL_REEMPLAZAR")
  assert.equal(r.motivo.severidad, "blocking")
  assert.deepEqual(r.comportamiento, comportamiento, "el comportamiento no se borra ni se reinterpreta: queda igual, con el motivo blocking al lado")
})

// ──────────────── 12. agregar un componente sintético no toca ningún .ts del core ─────

test("catalogo-sin-cambio-de-core-al-agregar-componente", () => {
  // Componente 100% inventado para este test, nunca importado de catalogo-datos.ts —
  // demuestra que evaluarRequisito/asignarPin despachan por FORMA (tipo/rol/clase),
  // nunca por id de componente: si hiciera falta tocar catalogo.ts para soportarlo,
  // este test no podría pasar sin ese cambio.
  const zumbadorSintetico = {
    id: "zumbador-sintetico-fixture",
    nombreVisible: "Zumbador sintético (fixture de test)",
    clase: "actuador",
    terminales: [
      { id: "senal", rol: "senal", electrica: "digital", direccion: "salida" },
      { id: "gnd", rol: "tierra", electrica: "riel-fijo", destinoFijo: "GND" },
    ],
    capacidades: [],
    requisitos: [{ tipo: "resistencia-serie", enTerminal: "senal", spec: { tipoComponente: "resistencia" } }],
  }
  assert.equal(evaluarRequisito(zumbadorSintetico, { senal: ["resistencia"] }).length, 0)
  assert.equal(evaluarRequisito(zumbadorSintetico, { senal: [] }).length, 1)
  const pinCompatible = REGISTRO_PLACAS["esp32-devkit-v1"].pines.find((p) => p.id === "GPIO23")
  assert.equal(asignarPin(zumbadorSintetico.terminales[0], pinCompatible), null)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 — hallazgo externo E3-03 (MAJOR, evidencia/e3/scripts/e1_motor_flujo.mjs
// TEST 2): construirCatalogo() devolvía componentes/placas por REFERENCIA directa a
// `datos` (y sus objetos anidados: Terminal, Capacidad, Requisito, RegistroPin) — sin
// congelar ni clonar. Un llamador que retuviera la referencia (algo que nada impide:
// `catalogo-datos.ts` exporta constantes de módulo que muchos catálogos comparten)
// podía mutar un componente YA usado por un motor en ejecución y el catálogo (y
// cualquier motor que lo use) lo vería de inmediato en la próxima validación.
// ════════════════════════════════════════════════════════════════════════════════════

test("obtenerComponente() devuelve un objeto CONGELADO — mutarlo explota, nunca se propaga en silencio (hallazgo externo E3-03)", () => {
  const datos = {
    version: "1.0.0-e303a",
    componentes: [{ id: "led-e303a", nombreVisible: "LED", clase: "actuador", terminales: [{ id: "anodo", rol: "anodo", electrica: "digital", direccion: "salida" }], capacidades: [], requisitos: [] }],
    placas: [],
    unidades: undefined,
  }
  const catalogo = construirCatalogo(datos, sha256Hex)
  const ledDelCatalogo = catalogo.obtenerComponente("led-e303a")
  assert.ok(Object.isFrozen(ledDelCatalogo), "el componente devuelto por el catalogo debe estar CONGELADO")
  assert.ok(Object.isFrozen(ledDelCatalogo.terminales), "los arrays anidados (terminales) tambien deben estar congelados")
  assert.throws(() => {
    "use strict"
    ledDelCatalogo.terminales.push({ id: "catodo-fantasma", rol: "catodo", electrica: "digital", direccion: "entrada" })
  }, "mutar un componente del catalogo debe explotar en modo estricto, no fallar en silencio")
  assert.equal(catalogo.obtenerComponente("led-e303a").terminales.length, 1, "el catalogo NUNCA debe ver una mutacion intentada sobre el objeto que devolvio")
})

test("mutar el objeto ORIGINAL retenido DESPUES de construirCatalogo() no afecta al catalogo ya construido (hallazgo externo E3-03)", () => {
  const led = { id: "led-e303b", nombreVisible: "LED", clase: "actuador", terminales: [{ id: "anodo", rol: "anodo", electrica: "digital", direccion: "salida" }], capacidades: [], requisitos: [] }
  const datos = { version: "1.0.0-e303b", componentes: [led], placas: [], unidades: undefined }
  const catalogo = construirCatalogo(datos, sha256Hex)

  // Mutación EN VIVO del array/objeto original que el llamador retiene — mismo
  // escenario que evidencia/e3/scripts/e1_motor_flujo.mjs TEST 2.
  datos.componentes.push({ id: "servo-fantasma-e303", nombreVisible: "Servo Fantasma", clase: "actuador", terminales: [], capacidades: [], requisitos: [] })
  led.terminales.push({ id: "catodo-fantasma", rol: "catodo", electrica: "digital", direccion: "entrada" })

  assert.equal(catalogo.obtenerComponente("servo-fantasma-e303"), undefined, "un componente agregado DESPUES de construir no debe aparecer en el catalogo")
  assert.equal(catalogo.obtenerComponente("led-e303b").terminales.length, 1, "el catalogo debe seguir viendo la forma ORIGINAL del componente, aislada de la mutacion posterior")
  assert.equal(catalogo.componentes.length, 1, "catalogo.componentes tampoco debe ver el push posterior sobre el array original")
})

// ─────────────────────── 13. version-skew: mismo version, hash distinto ──────────────

test("version-skew-catalogo-cambiado-detectado", () => {
  const catV1 = construirCatalogo({ version: "1.0.0", componentes: [LED], placas: [], unidades: undefined }, sha256Hex)
  const catV2 = construirCatalogo({ version: "1.0.0", componentes: [LED, DHT22], placas: [], unidades: undefined }, sha256Hex)
  assert.equal(catV1.version, catV2.version, "el version string legible es IGUAL a propósito")
  assert.notEqual(catV1.hash, catV2.hash, "el hash de contenido SÍ detecta el cambio que el version string por sí solo no distingue")
})

// ─────────────────────────────── extra: contenido mínimo shippeado ────────────────────

test("contenido-minimo-shippeado: led/resistencia/pulsador/dht22/ntc", () => {
  const ids = COMPONENTES_CATALOGO_MINIMO.map((c) => c.id).sort()
  assert.deepEqual(ids, ["dht22", "led", "ntc", "pulsador", "resistencia"])
  assert.ok(CONVERSIONES_UNIDAD_MINIMAS.every((c) => c.magnitud === "temperatura"), "sólo °C↔°F por ahora (§4.3)")
  assert.ok(PLACAS_CATALOGO_MINIMO.some((p) => p.id === "esp32-devkit-v1"))
})
