// Gate 1 (OD-01) — identidad de placa del núcleo de "Programación por Intención".
//
// POR QUÉ EXISTE. `circuito.ts` mezcla en un solo objeto `Placa` tres capas: hardware
// puro (pools de pines, constraints), render Wokwi (tag/escala/columna) y prosa de
// rechazo en español. El núcleo nuevo (`opencode/nucleo/placas.ts`) separa la capa 1
// (identidad física/eléctrica + referencia a la capa 2 como DATO) y deja la capa 3 fuera
// del contrato — ver `docs/programacion-intencion/BOARD-CONTRACT.md` y la entrada OD-01
// de `docs/programacion-intencion/DECISIONS.md`.
//
// Este archivo NO reemplaza `tests/circuito.test.mjs` ni lo toca: `circuito.ts` sigue
// intacto (prohibido tocarlo en Fase 1). Lo que sí hace es IMPORTARLO dinámicamente
// (mismo patrón que `tests/circuito.test.mjs`, mock de "@opencode-ai/plugin" incluido)
// para comparar, pin a pin, que el registro nuevo no contradice el comportamiento real
// ya validado — un test de caracterización/anti-drift, no una copia.
//
// Todos los tests corren serializados (`pnpm test` = `node --test tests/*.test.mjs`),
// como pide el CLAUDE.md del repo: no hay estado compartido entre archivos acá, pero
// se sigue la misma convención por las dudas.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

// El módulo real de Gate 1, TDD: en RED todavía no existe / no exporta esto.
const placas = await import(join(REPO, "opencode/nucleo/placas.ts"))
// Component System Foundation #1 (D-09): el elemento Wokwi de la placa salió del núcleo
// semántico (`Placa.backends.wokwi`) al anexo de representación, su único dueño.
const { ELEMENTO_WOKWI_POR_PLACA } = await import(join(REPO, "opencode/conocimiento/anexos/representacion.ts"))

const {
  REGISTRO_PLACAS,
  PLACAS_NO_SOPORTADAS,
  normalizarAlias,
  resolverAliasPlaca,
} = placas

// ─────────────────────────── caracterización: circuito.ts real ───────────────────────

const OUT = join(os.tmpdir(), "tecniabot-test-nucleo-placas")

let circuitoNs

before(async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/circuito.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "circuito.ts"), src)
  circuitoNs = await import(join(OUT, "circuito.ts"))
})

// ────────────────────────────────── helpers de test ───────────────────────────────────

const esp32 = () => REGISTRO_PLACAS["esp32-devkit-v1"]
const uno = () => REGISTRO_PLACAS["arduino-uno"]

function pinDe(placa, id) {
  return placa.pines.find((p) => p.id === id)
}

// ─────────────────────────────────── 1. board-id-estable ──────────────────────────────

test("board-id-estable: id semántico único y distinto de los ids de backend", () => {
  const e = esp32()
  const u = uno()
  assert.equal(e.id, "esp32-devkit-v1")
  assert.equal(u.id, "arduino-uno")
  assert.match(e.id, /^[a-z0-9-]+$/, "id debe ser kebab-case ASCII")
  assert.match(u.id, /^[a-z0-9-]+$/, "id debe ser kebab-case ASCII")
  assert.notEqual(e.id, e.backends.platformio.board, "id no puede ser el board de PlatformIO")
  assert.notEqual(e.id, ELEMENTO_WOKWI_POR_PLACA[e.id], "id no puede ser el elemento de Wokwi")
  assert.notEqual(u.id, u.backends.platformio.board, "id no puede ser el board de PlatformIO")
  assert.notEqual(u.id, ELEMENTO_WOKWI_POR_PLACA[u.id], "id no puede ser el elemento de Wokwi")
})

// ─────────────────────────────────── 2. alias-resuelve-a-id ───────────────────────────

test("alias-resuelve-a-id: variantes de mayúscula/espacio resuelven al id correcto", () => {
  for (const entrada of ["ESP32", "esp32 devkit", "DevKit", "esp-32"]) {
    const r = resolverAliasPlaca(entrada)
    assert.equal(r.ok, true, `"${entrada}" debería resolver`)
    assert.equal(r.id, "esp32-devkit-v1")
  }
  for (const entrada of ["uno", "Arduino UNO", " Arduino UNO ", "arduino"]) {
    const r = resolverAliasPlaca(entrada)
    assert.equal(r.ok, true, `"${entrada}" debería resolver`)
    assert.equal(r.id, "arduino-uno")
  }
})

// ───────────────────────────── 3/4. backend id no es semántico ────────────────────────

test("platformio-id-no-es-semantico: 'esp32dev' sin declarar como alias da PLACA_DESCONOCIDA", () => {
  assert.equal(esp32().backends.platformio.board, "esp32dev")
  assert.ok(
    !esp32().alias.some((a) => normalizarAlias(a) === normalizarAlias("esp32dev")),
    "esp32dev no debe estar declarado como alias en el registro por defecto",
  )
  const r = resolverAliasPlaca("esp32dev")
  assert.equal(r.ok, false)
  assert.equal(r.motivo.codigo, "PLACA_DESCONOCIDA")
})

test("wokwi-id-no-es-semantico: 'wokwi-esp32-devkit-v1' sin declarar como alias da PLACA_DESCONOCIDA", () => {
  assert.equal(ELEMENTO_WOKWI_POR_PLACA[esp32().id], "wokwi-esp32-devkit-v1")
  assert.ok(
    !esp32().alias.some((a) => normalizarAlias(a) === normalizarAlias("wokwi-esp32-devkit-v1")),
    "el elemento wokwi no debe estar declarado como alias en el registro por defecto",
  )
  const r = resolverAliasPlaca("wokwi-esp32-devkit-v1")
  assert.equal(r.ok, false)
  assert.equal(r.motivo.codigo, "PLACA_DESCONOCIDA")
})

// ───────────────────────── 5. alias-desconocido-da-motivo-estructurado ────────────────

test("alias-desconocido-da-motivo-estructurado: nunca undefined ni excepción cruda", () => {
  const r = resolverAliasPlaca("Placa Mágica 3000")
  assert.equal(r.ok, false)
  assert.equal(typeof r.motivo, "object")
  assert.equal(r.motivo.codigo, "PLACA_DESCONOCIDA")
  assert.equal(r.motivo.categoria, "operacion")
  assert.equal(r.motivo.clasificacion, "rechazo")
  assert.equal(r.motivo.datos.entrada, "Placa Mágica 3000")
})

// ───────────────────────────── 6. alias-ambiguo-lista-candidatos ──────────────────────

test("alias-ambiguo-lista-candidatos: matchea 2 ids, da candidatos completos sin elegir", () => {
  // Fixture sintético: ninguna placa real del set mínimo comparte alias hoy, así que se
  // arma un registro de prueba con dos placas que SÍ comparten un alias ambiguo.
  const registroFixture = {
    "placa-x": { ...esp32(), id: "placa-x", alias: ["clon-generico"] },
    "placa-y": { ...uno(), id: "placa-y", alias: ["clon-generico"] },
  }
  const r = resolverAliasPlaca("clon-generico", registroFixture)
  assert.equal(r.ok, false)
  assert.equal(r.motivo.codigo, "PLACA_ALIAS_AMBIGUA")
  assert.deepEqual([...r.motivo.datos.candidatos].sort(), ["placa-x", "placa-y"])
})

// ───────────────────────────── 7. sin-reinterpretacion-silenciosa ─────────────────────

test("sin-reinterpretacion-silenciosa: alias parecido pero no declarado da PLACA_DESCONOCIDA", () => {
  // "esp32devkit" (sin espacio) contiene como substring al alias declarado "devkit" y
  // se parece mucho a "esp32 devkit" — pero NO es, tras normalización, ninguno de los
  // aliases declarados. Un match laxo (`.includes()` en cualquier dirección) lo
  // resolvería igual; el match exacto post-normalización no.
  const r = resolverAliasPlaca("esp32devkit")
  assert.equal(r.ok, false, "un alias no declarado, por parecido que sea, no debe resolver")
  assert.equal(r.motivo.codigo, "PLACA_DESCONOCIDA")
})

// ───────────────────── 8. compatibilidad-con-placas-actuales (round-trip) ─────────────

test("compatibilidad-con-placas-actuales: mismos pools por banco que circuito.ts.PLACAS", () => {
  const { PLACAS, POOL_DIGITAL, GPIO_STRAPPING, GPIO_FLASH, GPIO_SOLO_ENTRADA, GPIO_UART_USB } = circuitoNs
  assert.ok(PLACAS, "circuito.ts debe exportar PLACAS")

  // ESP32: mismo pool digital (por número de GPIO) y mismo pool analógico.
  const poolDigitalNuevo = esp32()
    .pines.filter((p) => p.enPoolAutomatico.digital)
    .map((p) => p.numero)
    .sort((a, b) => a - b)
  assert.deepEqual(poolDigitalNuevo, [...POOL_DIGITAL].sort((a, b) => a - b))

  // Mismos flags de constraint, leídos directo de los Sets reales de circuito.ts.
  for (const n of GPIO_FLASH) {
    const pin = pinDe(esp32(), `GPIO${n}`)
    assert.ok(pin, `GPIO${n} (flash) debe existir en el registro nuevo`)
    assert.ok(pin.restricciones.includes("flashReservado"), `GPIO${n} debe estar marcado flashReservado`)
  }
  for (const n of GPIO_STRAPPING) {
    const pin = pinDe(esp32(), `GPIO${n}`)
    assert.ok(pin.restricciones.includes("strapping"), `GPIO${n} debe estar marcado strapping`)
  }
  for (const n of GPIO_SOLO_ENTRADA) {
    const pin = pinDe(esp32(), `GPIO${n}`)
    assert.ok(pin.restricciones.includes("soloEntrada"), `GPIO${n} debe estar marcado soloEntrada`)
    assert.equal(pin.capacidades.salidaDigital, false, `GPIO${n} no debe poder ser salida digital`)
  }
  for (const n of GPIO_UART_USB) {
    const pin = pinDe(esp32(), `GPIO${n}`)
    assert.ok(pin.restricciones.includes("uartUsb"), `GPIO${n} debe estar marcado uartUsb`)
  }

  // UNO: mismos pools (por banco D/A), tomados de PLACAS.uno para no copiar los
  // literales de circuito.ts una segunda vez.
  const unoReal = PLACAS.uno
  const poolDigitalUnoReal = unoReal.poolDigital.map((p) => p.n).sort((a, b) => a - b)
  const poolDigitalUnoNuevo = uno()
    .pines.filter((p) => p.banco === "D" && p.enPoolAutomatico.digital)
    .map((p) => p.numero)
    .sort((a, b) => a - b)
  assert.deepEqual(poolDigitalUnoNuevo, poolDigitalUnoReal)

  const poolAnalogicoUnoReal = unoReal.poolAnalogico.map((p) => p.n).sort((a, b) => a - b)
  const poolAnalogicoUnoNuevo = uno()
    .pines.filter((p) => p.banco === "A" && p.enPoolAutomatico.analogico)
    .map((p) => p.numero)
    .sort((a, b) => a - b)
  assert.deepEqual(poolAnalogicoUnoNuevo, poolAnalogicoUnoReal)

  assert.equal(esp32().adcMax, PLACAS.esp32.adcMax)
  assert.equal(uno().adcMax, PLACAS.uno.adcMax)
})

// ───────────────────────────── 9. gpio23-asignable-esp32 ──────────────────────────────

test("gpio23-asignable-esp32: GPIO23 existe, es salida digital, sin constraints", () => {
  const pin = pinDe(esp32(), "GPIO23")
  assert.ok(pin, "GPIO23 debe existir en el registro")
  assert.equal(pin.capacidades.salidaDigital, true)
  assert.deepEqual(pin.restricciones, [])
})

// ───────────────────────────── 10. pines-de-constraint-marcados ───────────────────────

test("pines-de-constraint-marcados: flash / solo-entrada / strapping / uart-usb", () => {
  for (const n of [6, 7, 8, 9, 10, 11]) {
    const pin = pinDe(esp32(), `GPIO${n}`)
    assert.ok(pin.restricciones.includes("flashReservado"), `GPIO${n} debe llevar flashReservado`)
  }
  for (const n of [34, 35, 36, 39]) {
    const pin = pinDe(esp32(), `GPIO${n}`)
    assert.ok(pin.restricciones.includes("soloEntrada"), `GPIO${n} debe llevar soloEntrada`)
    assert.equal(pin.capacidades.salidaDigital, false)
  }
  for (const n of [0, 2, 12, 15]) {
    const pin = pinDe(esp32(), `GPIO${n}`)
    assert.ok(pin.restricciones.includes("strapping"), `GPIO${n} debe llevar strapping`)
  }
  for (const n of [1, 3]) {
    const pin = pinDe(esp32(), `GPIO${n}`)
    assert.ok(pin.restricciones.includes("uartUsb"), `GPIO${n} debe llevar uartUsb`)
  }
})

// ───────────────────────── 11. adapter-pinouts-json-esp32-semaforo ────────────────────

test("adapter-pinouts-json-esp32-semaforo: GPIO16/17/18 existen y son asignables a mano", () => {
  const pinouts = JSON.parse(readFileSync(join(REPO, "opencode/tecniabot-web/pinouts.json"), "utf8"))
  const inicial = pinouts["01-semaforizacion"].esp32.inicial
  const pinesEsperados = inicial
    .filter((f) => f.tipo === "senal")
    .map((f) => f.pin) // "GPIO16", "GPIO17", "GPIO18"
  assert.deepEqual(pinesEsperados, ["GPIO16", "GPIO17", "GPIO18"])
  for (const id of pinesEsperados) {
    const pin = pinDe(esp32(), id)
    assert.ok(pin, `${id} debe existir en el registro (aunque no esté en el pool automático)`)
    assert.equal(pin.capacidades.salidaDigital, true, `${id} debe ser asignable a mano como salida digital`)
  }
})

// ───────────────────────────── 12. banco-d-a-no-colisiona-uno ─────────────────────────

test("banco-d-a-no-colisiona-uno: D4 y A4 son pines DISTINTOS", () => {
  const d4 = pinDe(uno(), "D4")
  const a4 = pinDe(uno(), "A4")
  assert.ok(d4 && a4, "D4 y A4 deben existir los dos")
  assert.notEqual(d4, a4)
  assert.equal(d4.banco, "D")
  assert.equal(a4.banco, "A")
  assert.equal(d4.numero, 4)
  assert.equal(a4.numero, 4)
})

// ───────────────────────── extra: placa conocida pero no soportada (§B pto.7) ─────────

test("placa-conocida-no-soportada: ESP8266 da PLACA_CONOCIDA_NO_SOPORTADA, no PLACA_DESCONOCIDA", () => {
  assert.ok(PLACAS_NO_SOPORTADAS.length > 0, "debe existir al menos una placa conocida-no-soportada")
  const r = resolverAliasPlaca("esp8266")
  assert.equal(r.ok, false)
  assert.equal(r.motivo.codigo, "PLACA_CONOCIDA_NO_SOPORTADA")
  assert.notEqual(r.motivo.codigo, "PLACA_DESCONOCIDA")
})
