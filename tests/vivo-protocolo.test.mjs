// Modo Vivo V1 — el contrato del protocolo (tecnia-bot-docs/esp32-completo/PROTOCOLO-VIVO-V1.md)
// y el runtime simulado de referencia. Lo que se fija acá lo tienen que cumplir, sin cambiarlo,
// el runtime en C++ (agente A) y la sesión viva (agente B).

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const P = await import(join(REPO, "opencode/vivo/protocolo.ts"))
const { crearRuntimeSimulado, CASOS_DORADOS, pinesProhibidos, RUNTIME_VERSION } = await import(join(REPO, "tests/vivo-simulador.mjs"))
const { REGISTRO_PLACAS } = await import(join(REPO, "opencode/nucleo/placas.ts"))

const esp32 = REGISTRO_PLACAS["esp32-devkit-v1"]

// ───────────────────────────── formato plano (host → runtime) ─────────────────────────

test("serializar y parsear son inversas exactas para cada comando de V1", () => {
  const comandos = [
    { comando: "hola" },
    { comando: "ping" },
    { comando: "pin.modo", pin: 23, modo: "salida" },
    { comando: "pin.modo", pin: 4, modo: "entradaPullUp" },
    { comando: "digital.escribir", pin: 23, nivel: "alto" },
    { comando: "pwm.escribir", pin: 18, porcentaje: 0 },
    { comando: "pwm.escribir", pin: 18, porcentaje: 100 },
    { comando: "digital.leer", pin: 4 },
    { comando: "analogico.leer", pin: 34 },
  ]
  for (const c of comandos) {
    const linea = P.serializarComando(c)
    assert.ok(!linea.includes("\n") && Buffer.byteLength(linea) + 1 <= P.LIMITE_LINEA_BYTES, linea)
    const vuelta = P.parsearLineaDeComando(linea)
    assert.ok(vuelta.ok, linea)
    assert.deepEqual(vuelta.valor, c)
  }
})

test("la gramática rechaza en el orden del contrato: largo, forma, comando, duplicado/desconocido, faltante, valor", () => {
  const codigo = (linea) => {
    const r = P.parsearLineaDeComando(linea)
    return r.ok ? "OK" : r.error.codigo
  }
  assert.equal(codigo(`ping ${"x".repeat(200)}`), "LINEA_DEMASIADO_LARGA")
  assert.equal(codigo(" ping"), "LINEA_INVALIDA")
  assert.equal(codigo("ping "), "LINEA_INVALIDA")
  assert.equal(codigo("PING"), "LINEA_INVALIDA")
  assert.equal(codigo("digital.escribir pin=23 nivel=\"alto\""), "LINEA_INVALIDA")
  assert.equal(codigo("digital.escribir =23"), "LINEA_INVALIDA")
  assert.equal(codigo("servo.angulo pin=18 grados=90"), "COMANDO_DESCONOCIDO")
  assert.equal(codigo("nada"), "COMANDO_DESCONOCIDO")
  assert.equal(codigo("digital.escribir pin=23 pin=22 nivel=alto"), "CAMPO_DUPLICADO")
  assert.equal(codigo("digital.escribir pin=23 nivel=alto extra=1"), "CAMPO_DESCONOCIDO")
  assert.equal(codigo("digital.escribir pin=23"), "CAMPO_FALTANTE")
  assert.equal(codigo("hola pin=1"), "CAMPO_DESCONOCIDO")
  assert.equal(codigo("pwm.escribir pin=18 porcentaje=101"), "VALOR_INVALIDO")
  assert.equal(codigo("pwm.escribir pin=18 porcentaje=-1"), "VALOR_INVALIDO", "el guion es un carácter de valor (ids como bus-unico-dht11), pero no un entero")
  assert.equal(codigo("pwm.escribir pin=18 porcentaje=007"), "VALOR_INVALIDO", "sin ceros a la izquierda")
  assert.equal(codigo("digital.escribir pin=23 nivel=on"), "VALOR_INVALIDO")
  assert.equal(codigo("digital.leer pin=23\r"), "OK", "tolera CRLF")
})

test("el parser no valida el pin contra la placa: eso es política del runtime, después del parseo", () => {
  const r = P.parsearLineaDeComando("digital.escribir pin=6 nivel=alto")
  assert.ok(r.ok)
  assert.equal(r.valor.pin, 6)
})

// ───────────────────────────── JSON canónico (runtime → host) ─────────────────────────

test("serializarRespuesta: claves ordenadas, sin espacios, sólo enteros y ASCII; parsearRespuesta la lee de vuelta", () => {
  const respuestas = [
    { tipo: "hola", runtime: RUNTIME_VERSION, protocolo: 1, placa: "esp32-devkit-v1", comandos: [...P.COMANDOS_V1], protocolos: [] },
    { tipo: "pong", uptimeMs: 1234 },
    { tipo: "ok", comando: "digital.escribir", pin: 23 },
    { tipo: "lectura", pin: 4, nivel: "alto" },
    { tipo: "lectura", pin: 34, crudo: 2048 },
    { tipo: "error", codigo: "PIN_PROHIBIDO", comando: "digital.escribir", pin: 6 },
    { tipo: "error", codigo: "LINEA_INVALIDA" },
    { tipo: "reinicio", causa: "brownout" },
  ]
  for (const r of respuestas) {
    const linea = P.serializarRespuesta(r)
    assert.ok(!/\s/.test(linea), linea)
    assert.deepEqual(Object.keys(JSON.parse(linea)), Object.keys(JSON.parse(linea)).sort(), linea)
    const vuelta = P.parsearRespuesta(linea)
    assert.ok(vuelta.ok, linea)
    assert.deepEqual(vuelta.valor, r)
  }
  assert.throws(() => P.serializarRespuesta({ tipo: "pong", uptimeMs: 1.5 }), /enteros/)
  assert.throws(() => P.serializarRespuesta({ tipo: "reinicio", causa: "señal" }), /ASCII/)
})

test("parsearRespuesta es estricto: claves extra, tipos equivocados, códigos inventados o JSON roto son LINEA_INVALIDA", () => {
  const invalidas = [
    "no json",
    "[]",
    '{"tipo":"pong"}',
    '{"tipo":"pong","uptimeMs":"1"}',
    '{"tipo":"pong","uptimeMs":1,"extra":true}',
    '{"tipo":"ok","comando":"x"}',
    '{"nivel":"encendido","pin":4,"tipo":"lectura"}',
    '{"crudo":-1,"pin":34,"tipo":"lectura"}',
    '{"codigo":"LO_QUE_SEA","tipo":"error"}',
    '{"causa":"rayo","tipo":"reinicio"}',
    '{"tipo":"sorpresa"}',
  ]
  for (const linea of invalidas) {
    const r = P.parsearRespuesta(linea)
    assert.ok(!r.ok, linea)
    assert.equal(r.error.codigo, "LINEA_INVALIDA", linea)
  }
})

// ───────────────────────────── simulador de referencia ────────────────────────────────

test("CASOS_DORADOS: el simulador recién arrancado reproduce cada caso en orden, byte a byte", () => {
  const runtime = crearRuntimeSimulado()
  assert.deepEqual(runtime.arrancar(), ['{"causa":"encendido","tipo":"reinicio"}', CASOS_DORADOS[0].salida[0]])
  for (const caso of CASOS_DORADOS) assert.deepEqual(runtime.procesar(caso.entrada), caso.salida, caso.entrada)
})

test("política del simulador: deriva de placas.ts (prohibidos = flash + UART0; ADC = capacidades.adc; salida = salidaDigital)", () => {
  assert.deepEqual(pinesProhibidos(esp32), [1, 3, 6, 7, 8, 9, 10, 11])
  const runtime = crearRuntimeSimulado()
  const codigo = (linea) => JSON.parse(runtime.procesar(linea)[0]).codigo
  for (const n of [1, 3, 6, 7, 8, 9, 10, 11]) assert.equal(codigo(`pin.modo pin=${n} modo=entrada`), "PIN_PROHIBIDO", `GPIO${n}`)
  for (const n of [34, 35, 36, 39]) {
    assert.equal(codigo(`pin.modo pin=${n} modo=salida`), "PIN_SIN_CAPACIDAD", `GPIO${n}`)
    assert.equal(codigo(`pwm.escribir pin=${n} porcentaje=10`), "PIN_SIN_CAPACIDAD", `GPIO${n}`)
    assert.equal(JSON.parse(runtime.procesar(`analogico.leer pin=${n}`)[0]).tipo, "lectura", `GPIO${n} sí lee analógico`)
  }
  for (const n of [0, 2, 4, 12, 13, 14, 15, 25, 26, 27]) assert.equal(codigo(`analogico.leer pin=${n}`), "PIN_SIN_CAPACIDAD", `GPIO${n} es ADC2: no se ofrece`)
  for (const n of [0, 2, 5, 12, 15]) assert.equal(JSON.parse(runtime.procesar(`digital.escribir pin=${n} nivel=bajo`)[0]).tipo, "ok", `strapping GPIO${n}: el runtime no lo rechaza`)
})

test("estado del simulador: entradas fijadas, pull-up por defecto en alto, salida se relee, PWM 0/100 son niveles", () => {
  const runtime = crearRuntimeSimulado({ reloj: () => 42 })
  assert.deepEqual(runtime.procesar("ping"), ['{"tipo":"pong","uptimeMs":42}'])
  runtime.procesar("pin.modo pin=4 modo=entrada")
  assert.equal(JSON.parse(runtime.procesar("digital.leer pin=4")[0]).nivel, "bajo")
  runtime.fijarEntrada(4, "alto")
  assert.equal(JSON.parse(runtime.procesar("digital.leer pin=4")[0]).nivel, "alto")
  runtime.procesar("pin.modo pin=16 modo=entradaPullUp")
  assert.equal(JSON.parse(runtime.procesar("digital.leer pin=16")[0]).nivel, "alto")
  runtime.procesar("pwm.escribir pin=18 porcentaje=0")
  assert.equal(runtime.salidaDe(18), "bajo")
  runtime.procesar("pwm.escribir pin=18 porcentaje=100")
  assert.equal(runtime.salidaDe(18), "alto")
  runtime.procesar("pwm.escribir pin=18 porcentaje=33")
  assert.deepEqual(runtime.salidaDe(18), { pwm: 33 })
  runtime.fijarAnalogico(34, 4095)
  assert.equal(JSON.parse(runtime.procesar("analogico.leer pin=34")[0]).crudo, 4095)
  assert.equal(runtime.modoDe(22), undefined)
  runtime.procesar("digital.leer pin=22")
  assert.equal(runtime.modoDe(22), "entrada", "leer un pin sin configurar lo deja como entrada")
})

test("hola del simulador: anuncia exactamente COMANDOS_V1 (ordenados) y ningún protocolo de sensor en V1", () => {
  const hola = P.parsearRespuesta(crearRuntimeSimulado().procesar("hola")[0])
  assert.ok(hola.ok)
  assert.deepEqual(hola.valor.comandos, [...P.COMANDOS_V1])
  assert.deepEqual([...P.COMANDOS_V1], [...P.COMANDOS_V1].sort())
  assert.deepEqual(hola.valor.protocolos, [])
  assert.equal(hola.valor.protocolo, P.VERSION_PROTOCOLO)
  for (const reservado of P.COMANDOS_RESERVADOS) assert.ok(!P.COMANDOS_V1.includes(reservado), reservado)
})

test("guardia: protocolo.ts es puro (sin node:, sin fetch, sin reloj, sin estado de módulo mutable)", async () => {
  const { readFileSync } = await import("node:fs")
  const fuente = readFileSync(join(REPO, "opencode/vivo/protocolo.ts"), "utf8")
  assert.doesNotMatch(fuente, /from\s+["']node:|require\(|Bun\.|fetch\(|Date\.now|setTimeout|process\./)
  assert.doesNotMatch(fuente, /^let |^var /m)
})

// ───────────────────────────── V4: la red propia en el hola ───────────────────────────

test("V4: hola con `wifi` {clave, ip, ssid} se serializa canónico (objeto anidado con claves ordenadas) y se lee de vuelta; sin wifi sigue igual", () => {
  const wifi = { ssid: "tecnia-3f2a", clave: "48213907", ip: "192.168.4.1" }
  const hola = { tipo: "hola", runtime: RUNTIME_VERSION, protocolo: 1, placa: "esp32-devkit-v1", comandos: [...P.COMANDOS_V1], protocolos: [], wifi }
  const linea = P.serializarRespuesta(hola)
  assert.equal(linea, '{"comandos":["analogico.leer","digital.escribir","digital.leer","hola","pin.modo","ping","pwm.escribir"],"placa":"esp32-devkit-v1","protocolo":1,"protocolos":[],"runtime":"0.1.0","tipo":"hola","wifi":{"clave":"48213907","ip":"192.168.4.1","ssid":"tecnia-3f2a"}}')
  const vuelta = P.parsearRespuesta(linea)
  assert.ok(vuelta.ok)
  assert.deepEqual(vuelta.valor, hola)
  const sinWifi = crearRuntimeSimulado().procesar("hola")[0]
  assert.equal(sinWifi, CASOS_DORADOS[0].salida[0], "el runtime de sólo serie no cambia su hola")
  const conWifi = crearRuntimeSimulado({ wifi }).procesar("hola")[0]
  assert.equal(conWifi, linea)
})

test("V4: un `wifi` con otra forma invalida la línea entera (claves de más o de menos, tipos, lista)", () => {
  const base = '"comandos":[],"placa":"esp32-devkit-v1","protocolo":1,"protocolos":[],"runtime":"0.1.0","tipo":"hola"'
  for (const wifi of ['{"ssid":"x"}', '{"clave":"1","ip":"2","ssid":"3","canal":6}', '{"clave":1,"ip":"2","ssid":"3"}', "[]", "null", '"tecnia"']) {
    const r = P.parsearRespuesta(`{${base},"wifi":${wifi}}`)
    assert.ok(!r.ok, wifi)
    assert.equal(r.error.codigo, "LINEA_INVALIDA", wifi)
  }
})
