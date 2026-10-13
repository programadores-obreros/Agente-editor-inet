// CK-PLACA-01 — la ESP32 DevKit V1 completa en Component Knowledge, con fuente y revisión
// humana (tecnia-bot-docs/esp32-completo/CK-PLACA-01-DESIGN.md, decisiones H-A1..H-A6 del
// 2026-10-12). Cada test fija un HECHO con su fuente; ninguno re-declara tablas de pines: lee
// del registro y compara contra listas chicas que son la cita, no una copia del dato.
//
// Fuentes (hasheadas en tecnia-bot-docs/esp32-completo/evidencia/fuentes/SHA256SUMS.txt y en
// component-knowledge-ck-cg1-dht22/evidencia/): ESP32 Series Datasheet v5.3 (Tabla 2-1 Pin
// Overview, Tabla 3-1 strapping, Tabla 5-3 DC), ESP-IDF adc (v4.4 y actual), arduino-esp32
// variants/doitESP32devkitV1/pins_arduino.h, Zephyr board doc de la DOIT ESP32 DevKit V1.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { REGISTRO_PLACAS } = await import(join(REPO, "opencode/nucleo/placas.ts"))
const { evaluarRestriccionesPin, proyeccionSemanticaCatalogo } = await import(join(REPO, "opencode/nucleo/catalogo.ts"))
const { CATALOGO_ACTIVO } = await import(join(REPO, "opencode/nucleo/catalogo-activo.ts"))
const { COMPONENTES_CATALOGO_MINIMO, PLACAS_CATALOGO_MINIMO, CONVERSIONES_UNIDAD_MINIMAS, VERSION_CATALOGO_MINIMO } = await import(join(REPO, "opencode/nucleo/catalogo-datos.ts"))
const { CONOCIMIENTO_ACTIVO } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { admitirPlaca, esRevisorHumano } = await import(join(REPO, "opencode/conocimiento/admision.ts"))
const { REVISIONES_DE_PLACA } = await import(join(REPO, "opencode/conocimiento/anexos/revision-electrica.ts"))
const { CATALOGO_FIJADO } = await import(join(REPO, "tests/fixtures/catalogo-fijado.mjs"))

const esp32 = REGISTRO_PLACAS["esp32-devkit-v1"]
const uno = REGISTRO_PLACAS["arduino-uno"]
const pin = (placa, id) => placa.pines.find((p) => p.id === id)
const numeros = (placa, pred) =>
  placa.pines
    .filter(pred)
    .map((p) => p.numero)
    .sort((a, b) => a - b)

/** Un terminal digital de salida cualquiera (un ánodo de LED): las restricciones de clase no miran el terminal. */
const TERMINAL_SALIDA = { id: "anodo", rol: "anodo", electrica: "digital", direccion: "salida", asignable: true }

// ───────────────────────────── P1: strapping (Tabla 3-1) ─────────────────────────────

test("P1: los cinco strapping del datasheet (Tabla 3-1): GPIO0, GPIO2, GPIO5, MTDI=12, MTDO=15", () => {
  assert.deepEqual(numeros(esp32, (p) => p.restricciones.includes("strapping")), [0, 2, 5, 12, 15])
})

test("P1: GPIO5 da PIN_STRAPPING con severidad info (la política de GPIO0/2/15); GPIO12 sigue warning", () => {
  const motivosDe = (id) => evaluarRestriccionesPin(TERMINAL_SALIDA, pin(esp32, id))
  for (const id of ["GPIO0", "GPIO2", "GPIO5", "GPIO15"]) {
    const m = motivosDe(id)
    assert.equal(m.length, 1, id)
    assert.equal(m[0].codigo, "PIN_STRAPPING")
    assert.equal(m[0].severidad, "info")
    assert.equal(m[0].clasificacion, "representable")
  }
  assert.equal(motivosDe("GPIO12").find((m) => m.codigo === "PIN_STRAPPING").severidad, "warning")
  assert.ok(!pin(esp32, "GPIO5").restricciones.includes("strappingVddSdio"), "sólo MTDI elige VDD_SDIO")
})

test("P1: GPIO5 sigue en el pool automático digital, como GPIO2 (D3, H-2b=A): no se degrada en silencio", () => {
  assert.equal(pin(esp32, "GPIO5").enPoolAutomatico.digital, true)
  assert.equal(pin(esp32, "GPIO2").enPoolAutomatico.digital, true)
})

// ───────────────────────────── P2/P3: bancos ADC (Tabla 2-1) ─────────────────────────

test("P2: adcBanco de los canales que la placa expone coincide con la Tabla 2-1 (ADC1 y ADC2)", () => {
  assert.deepEqual(numeros(esp32, (p) => p.adcBanco === "ADC1"), [32, 33, 34, 35, 36, 39])
  assert.deepEqual(numeros(esp32, (p) => p.adcBanco === "ADC2"), [0, 2, 4, 12, 13, 14, 15, 25, 26, 27])
  // Sin canal ADC (Tabla 2-1): UART0, flash, GPIO5, RX2/TX2, VSPI y I2C.
  assert.deepEqual(numeros(esp32, (p) => p.adcBanco === undefined), [1, 3, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 21, 22, 23])
  for (const n of [37, 38]) assert.equal(pin(esp32, `GPIO${n}`), undefined, "el WROOM-32 no los expone")
})

test("P3 (H-A2): capacidades.adc es exactamente ADC1 — ADC2 lo usa el WiFi y no se ofrece", () => {
  assert.deepEqual(numeros(esp32, (p) => p.capacidades.adc), [32, 33, 34, 35, 36, 39])
  for (const p of esp32.pines) if (p.adcBanco === "ADC2") assert.equal(p.capacidades.adc, false, p.id)
})

// ───────────────────────────── P4: DAC y touch (Tabla 2-1, pins_arduino.h) ───────────

test("P4 (H-A3): DAC_1/DAC_2 en GPIO25/26; TOUCH0..TOUCH9 en 4, 0, 2, 15, 13, 12, 14, 27, 33, 32", () => {
  assert.deepEqual(numeros(esp32, (p) => p.capacidades.dac), [25, 26])
  assert.deepEqual(numeros(esp32, (p) => p.capacidades.touch), [0, 2, 4, 12, 13, 14, 15, 27, 32, 33])
  for (const p of uno.pines) {
    assert.equal(p.capacidades.dac, false, p.id)
    assert.equal(p.capacidades.touch, false, p.id)
    assert.equal(p.adcBanco, undefined, p.id)
  }
})

// ───────────────────────────── P5: datos de placa ─────────────────────────────────────

test("P5 (H-A4): el LED de placa está en GPIO2 (pin existente, azul) y prende en alto (verificado en la placa el 2026-10-13)", () => {
  assert.deepEqual(esp32.ledDePlaca, { pin: "GPIO2", color: "azul", activoEn: "alto" })
  assert.ok(pin(esp32, esp32.ledDePlaca.pin), "referencia un RegistroPin.id real")
  assert.equal(uno.ledDePlaca, undefined, "el UNO no se revisó en este slice")
})

test("P5 (H-A5, H-A6): tolerancia5V false en la ESP32 (VIH máx VDD+0,3 V) y true en el UNO; schemaVersion 1.1.0", () => {
  assert.equal(esp32.tolerancia5V, false)
  assert.equal(uno.tolerancia5V, true)
  assert.equal(esp32.schemaVersion, "1.1.0")
  assert.equal(uno.schemaVersion, "1.1.0")
})

test("P5: lo que entra y lo que no entra al hash semántico (regla de catalogo.ts)", () => {
  const datos = { version: VERSION_CATALOGO_MINIMO, componentes: COMPONENTES_CATALOGO_MINIMO, placas: PLACAS_CATALOGO_MINIMO, unidades: { conversiones: CONVERSIONES_UNIDAD_MINIMAS } }
  const placa = proyeccionSemanticaCatalogo(datos).placas.find((p) => p.id === "esp32-devkit-v1")
  assert.equal(placa.tolerancia5V, false, "tolerancia5V entra")
  assert.equal(placa.ledDePlaca, undefined, "ledDePlaca no entra")
  assert.ok(placa.pines.every((p) => p.adcBanco === undefined), "adcBanco no entra")
  assert.equal(placa.pines.find((p) => p.id === "GPIO25").capacidades.dac, true, "dac entra (dentro de capacidades)")
  assert.ok(placa.pines.find((p) => p.id === "GPIO5").restricciones.includes("strapping"), "strapping de GPIO5 entra")
  // La identidad fijada subió a 2.5.0 con este slice (test D de arquitectura-conocimiento).
  assert.equal(CATALOGO_FIJADO.version, "2.5.0")
  assert.equal(CATALOGO_FIJADO.anterior.version, "2.4.0")
  assert.equal(CATALOGO_ACTIVO.hash, CATALOGO_FIJADO.hash)
})

// ───────────────────────────── P6: revisión humana y admisión ─────────────────────────

test("P6: hay revisión eléctrica humana de la placa para CK-PLACA-01 y la ESP32 sigue oficialmente soportada", () => {
  const revision = REVISIONES_DE_PLACA.find((r) => r.placa === "esp32-devkit-v1" && /CK-PLACA-01/.test(r.revisadoPor))
  assert.ok(revision, "entrada de revisión de CK-PLACA-01")
  assert.ok(esRevisorHumano(revision.revisadoPor))
  assert.match(revision.evidencia, /Tabla 3-1/)
  assert.match(revision.evidencia, /LED[^.]*verificad/i)
  const informe = admitirPlaca(CONOCIMIENTO_ACTIVO, "esp32-devkit-v1")
  assert.equal(informe.officiallySupported, true, JSON.stringify(informe.problemas))
})

// ───────────────────────────── Guardias ───────────────────────────────────────────────

test("guardia: el codegen no lee los campos nuevos (este slice no cambia ningún programa generado)", () => {
  const dir = join(REPO, "opencode/codegen")
  for (const archivo of readdirSync(dir).filter((a) => a.endsWith(".ts"))) {
    const fuente = readFileSync(join(dir, archivo), "utf8")
    assert.doesNotMatch(fuente, /adcBanco|ledDePlaca|tolerancia5V|capacidades\.(dac|touch)/, archivo)
  }
})

test("guardia: la deuda ESP-STRAP-05 queda citada como cerrada en placas.ts, con la Tabla 3-1 y CK-PLACA-01", () => {
  const fuente = readFileSync(join(REPO, "opencode/nucleo/placas.ts"), "utf8")
  assert.match(fuente, /ESP-STRAP-05[^\n]*CERRADA en CK-PLACA-01/)
  assert.match(fuente, /Tabla 3-1/)
  assert.match(fuente, /ESP_ERR_TIMEOUT/)
  assert.match(fuente, /LED_BUILTIN = 2/)
})
