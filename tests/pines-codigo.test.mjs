// Los pines del código y el checklist obligatorio, en opencode/tool/platformio.ts (0.4.8).
//
// POR QUÉ EXISTE ESTE ARCHIVO. El tool `circuito` rechaza GPIO6 a GPIO11 cuando
// DIBUJA, pero el código que el bot escribe y carga no pasaba por ningún filtro:
// un `pinMode(7, OUTPUT)` compilaba, se cargaba y la placa no arrancaba más. Y
// el prompt pide el checklist de seguridad antes de cargar, pero en las pruebas
// el bot a veces cargaba sin hacerlo. Ahora lo mira el tool, sin depender de que
// el modelo se acuerde.
//
// LO QUE MÁS CUIDA ESTE ARCHIVO SON LOS FALSOS POSITIVOS. Un aviso falso enseña a
// ignorar los avisos, y un freno falso frena la clase. Por eso hay tests de lo que
// NO tiene que marcar: variables que cambian en tiempo de ejecución, pines dentro
// de comentarios y de textos, LED_BUILTIN, y analogRead(0) en un UNO (es A0).
//
// Los tests de execute() usan el mismo Bun falso que platformio-execute.test.mjs:
// sin placa, sin PlatformIO, sin red. Las fixtures son código escrito a mano.
//
// Mutaciones verificadas a mano al escribirlo (cada una pone rojo al menos un test):
// el rango 6–11, el umbral de 34–39, la comparación del código del checklist, y
// la escritura del estado sólo después de una carga con código 0.
//
// HISTORIA DE LOS HUECOS (ronda de revisión de la 0.4.8). La primera versión de
// este archivo pasaba en verde con 26 mutantes vivos de 64: no probaba los escapes
// de los textos, las prioridades entre #define y const, ni el orden de los
// avisos; y una mutación del limpiador colgó la suite entera, porque nada medía
// que terminara. Además las fixtures usaban LED_BUILTIN en ESP32, donde el core
// fijado NO lo define: probaban un supuesto falso. Los tests de abajo cubren eso.

import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync, symlinkSync, chmodSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
// Carpeta propia por corrida (no una ruta fija): dos corridas no se pisan.
const OUT = mkdtempSync(join(os.tmpdir(), "tecniabot-pines-"))
const HOME_FALSO = join(OUT, "home")
const HOME_ORIGINAL = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }

// ── Bun falso (el mismo patrón que platformio-execute.test.mjs) ────────────────

let spawns = []
let guion = () => ({})

globalThis.Bun = {
  which: () => null,
  spawn(cmd) {
    spawns.push(cmd.join(" "))
    const r = guion(cmd)
    return {
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      exited: Promise.resolve(r.code ?? 0),
      unref() {},
      kill() {},
    }
  },
}

const CH340 = { port: "/dev/ttyUSB0", hwid: "USB VID:PID=1A86:7523 LOCATION=1-1", description: "USB2.0-Serial" }

// Placas CON número de serie (CP2102): con ésas se puede saber si es la misma placa.
const CP2102_A = { port: "/dev/ttyUSB0", hwid: "USB VID:PID=10C4:EA60 SER=0001 LOCATION=1-1", description: "CP2102" }
const CP2102_B = { port: "/dev/ttyUSB1", hwid: "USB VID:PID=10C4:EA60 SER=0002 LOCATION=1-2", description: "CP2102" }

function escenario({ upload = { code: 0 }, compile = { code: 0 }, placas = [CH340] } = {}) {
  guion = (cmd) => {
    const s = cmd.join(" ")
    if (s.includes("--version")) return { stdout: "PlatformIO Core, version 6.1.15\n" }
    if (s.includes("device list")) return { stdout: JSON.stringify(placas) }
    if (s.includes("--target upload")) return upload
    if (s.includes(" run")) return compile
    return {}
  }
}

const cargo = () => spawns.some((s) => s.includes("--target upload"))
const buscoPlaca = () => spawns.some((s) => s.includes("device list"))

let mod
let ctx

before(async () => {
  mkdirSync(HOME_FALSO, { recursive: true })
  process.env.HOME = HOME_FALSO
  process.env.USERPROFILE = HOME_FALSO
  process.env.XDG_CONFIG_HOME = join(HOME_FALSO, ".config")
  // Un schema que ANOTA lo que se le pide (tipo, opcional, valores del enum), para
  // probar los args del tool por lo que son y no por cómo están escritos.
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    [
      "const nodo = (tipo, extra = {}) => { const n = { tipo, ...extra, opcional: false, optional() { n.opcional = true; return n }, describe(d) { n.descripcion = d; return n } }; return n }",
      "export const tool = (c) => c",
      "tool.schema = { string: () => nodo('string'), number: () => nodo('number'), boolean: () => nodo('boolean'), enum: (v) => nodo('enum', { valores: v }) }",
    ].join("\n"),
  )
  const src = readFileSync(join(REPO, "opencode/tool/platformio.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "platformio.ts"), src)
  mod = await import(join(OUT, "platformio.ts"))
  ctx = { directory: OUT, abort: new AbortController().signal }
})

beforeEach(() => {
  pedidos = []
  respuestaAsk = null
  errorAsk = null
  spawns = []
  escenario()
})

after(() => {
  for (const [k, v] of Object.entries(HOME_ORIGINAL)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(OUT, { recursive: true, force: true })
})

let nProyecto = 0
/** Un proyecto nuevo, en su propia carpeta, con su ini y su main.cpp. */
function proyecto(board, codigo) {
  const dir = join(OUT, `proy-${++nProyecto}`)
  mkdirSync(join(dir, "src"), { recursive: true })
  writeFileSync(join(dir, "platformio.ini"), `[env:${board}]\nplatform = x\nboard = ${board}\nframework = arduino\n`)
  writeFileSync(join(dir, "src", "main.cpp"), codigo)
  return dir
}
const reescribir = (dir, codigo) => writeFileSync(join(dir, "src", "main.cpp"), codigo)
/*
 * EL CARTEL (ctx.ask), SIMULADO. Desde la cuarta ronda el freno del checklist es
 * el cartel de permiso de OpenCode, que contesta la persona. Los tests de antes
 * pasaban `checklist: "<codigo>"` para decir "el docente ya revisó": el harness
 * conserva esa forma de escribirlos. Si la llamada trae `checklist`, el cartel se
 * contesta "Allow once"; si no, "Reject". `respuestaAsk` y `errorAsk` pisan eso
 * en los tests del cartel. Cada pedido queda anotado en `pedidos`.
 */
let pedidos = []
let respuestaAsk = null
let errorAsk = null
function rechazoDeOpenCode(feedback) {
  // La forma del error de OpenCode: un TaggedError con `_tag` y su mensaje (ver
  // comoRechazo en platformio.ts). Sin la clase: un plugin no la puede importar.
  const e = new Error(feedback ? `The user rejected permission to use this specific tool call with the following feedback: ${feedback}` : "The user rejected permission to use this specific tool call.")
  e._tag = feedback ? "PermissionCorrectedError" : "PermissionRejectedError"
  if (feedback) e.feedback = feedback
  return e
}
const ctxDe = (args) => ({
  ...ctx,
  ask: async (req) => {
    pedidos.push(req)
    if (errorAsk) throw errorAsk
    const r = respuestaAsk ?? (args.checklist ? "allow" : "reject")
    if (r === "reject") throw rechazoDeOpenCode()
  },
})
const ejecutar = (args) => mod.default.execute(args, ctxDe(args))
const FRENO = /No cargué: elegiste Reject/

const niveles = (hs) => hs.map((h) => h.nivel)
const textos = (hs) => hs.map((h) => h.texto).join("\n")

// ── Los conjuntos de pines son los mismos que en circuito.ts ─────────────────

/** Los números de `const NOMBRE = new Set([...])` o `= [...]` en el fuente. */
function conjunto(src, nombre) {
  const m = src.match(new RegExp(`const ${nombre} = (?:new Set\\()?\\[([^\\]]*)\\]`))
  assert.ok(m, `no encontré ${nombre}`)
  return m[1].split(",").map((x) => Number(x.trim())).sort((a, b) => a - b)
}

test("los conjuntos de pines de platformio.ts son copia exacta de los de circuito.ts", () => {
  // Las tools no se importan entre sí: se copian. Si alguien corrige uno en
  // circuito.ts (por ejemplo, agrega un pin de arranque), éste se queda viejo
  // en silencio. Este test es lo que lo hace ruidoso.
  const circ = readFileSync(join(REPO, "opencode/tool/circuito.ts"), "utf8")
  const pio = readFileSync(join(REPO, "opencode/tool/platformio.ts"), "utf8")
  for (const [a, b] of [
    ["GPIO_FLASH", "PINES_FLASH"],
    ["GPIO_STRAPPING", "PINES_STRAPPING"],
    ["GPIO_SOLO_ENTRADA", "PINES_SOLO_ENTRADA"],
    ["GPIO_UART_USB", "PINES_UART_USB"],
    ["UNO_POOL_PWM", "UNO_PWM"],
  ]) {
    const deCircuito = conjunto(circ, a)
    assert.ok(deCircuito.length > 0, `${a} vacío: el extractor no leyó nada`)
    assert.deepEqual(conjunto(pio, b), deCircuito, `${b} de platformio.ts ya no es igual a ${a} de circuito.ts`)
  }
})

test("el extractor de conjuntos marca una diferencia (el guard se prueba a sí mismo)", () => {
  const falso = "const PINES_FLASH = new Set([6, 7, 8, 9, 10])"
  assert.notDeepEqual(conjunto(falso, "PINES_FLASH"), [6, 7, 8, 9, 10, 11])
})

// ── Limpieza ────────────────────────────────────────────────────────────────

test("limpiarCodigo(): saca comentarios y textos y conserva las líneas", () => {
  const src = 'int a = 1; // pinMode(7, OUTPUT)\n/* pinMode(8,\n OUTPUT) */\nSerial.println("pinMode(9, OUTPUT)");\nchar c = \'7\';\n'
  const l = mod.limpiarCodigo(src)
  assert.equal(l.split("\n").length, src.split("\n").length, "cambió la cantidad de líneas")
  assert.doesNotMatch(l, /pinMode/)
  assert.doesNotMatch(l, /'7'/)
  assert.match(l, /int a = 1;/)
  // Sin `textos`, el #include "DHT.h" sobrevive (la huella lo necesita).
  assert.match(mod.limpiarCodigo('#include "DHT.h" // x', false), /"DHT\.h"/)
})

// ── ESP32: las reglas ────────────────────────────────────────────────────────

test("ESP32: GPIO6 a GPIO11 es bloqueo; GPIO5 y GPIO12 no lo son", () => {
  for (const p of [6, 7, 8, 9, 10, 11]) {
    const hs = mod.analizarPines(`void setup(){ pinMode(${p}, OUTPUT); }`, "esp32")
    assert.deepEqual(niveles(hs), ["bloqueo"], `GPIO${p}: ${textos(hs)}`)
    assert.match(textos(hs), new RegExp(`GPIO${p}\\b.*flash`))
  }
  for (const p of [5, 13]) {
    const hs = mod.analizarPines(`void setup(){ pinMode(${p}, OUTPUT); }`, "esp32")
    assert.ok(!niveles(hs).includes("bloqueo"), `GPIO${p} no es de la flash: ${textos(hs)}`)
  }
})

test("ESP32: GPIO7 adentro de un #if de condición desconocida baja a aviso", () => {
  const src = "#ifdef PRUEBA\nvoid setup(){ pinMode(7, OUTPUT); }\n#endif\nvoid loop(){}\n"
  const hs = mod.analizarPines(src, "esp32")
  assert.deepEqual(niveles(hs), ["aviso"])
  assert.match(textos(hs), /#if/)
})

test("ESP32: 34 a 39 como salida o con pull-up es aviso, NO bloqueo; como entrada, nada", () => {
  for (const p of [34, 35, 36, 39]) {
    const salida = mod.analizarPines(`void setup(){ pinMode(${p}, OUTPUT); }`, "esp32")
    assert.deepEqual(niveles(salida), ["aviso"], `GPIO${p} como salida: ${textos(salida)}`)
    assert.match(textos(salida), /SOLO ENTRADA/)
    const pullup = mod.analizarPines(`void setup(){ pinMode(${p}, INPUT_PULLUP); }`, "esp32")
    assert.deepEqual(niveles(pullup), ["aviso"], `GPIO${p} con pull-up: ${textos(pullup)}`)
    assert.match(textos(pullup), /10 kΩ/)
    assert.deepEqual(mod.analizarPines(`void setup(){ pinMode(${p}, INPUT); }`, "esp32"), [])
    assert.deepEqual(mod.analizarPines(`void loop(){ int v = analogRead(${p}); }`, "esp32"), [])
  }
  // El borde: 33 sí tiene salida.
  assert.deepEqual(mod.analizarPines("void setup(){ pinMode(33, OUTPUT); }", "esp32"), [])
})

test("ESP32: 37 y 38 no salen en el DevKit", () => {
  const hs = mod.analizarPines("void setup(){ pinMode(37, INPUT); }", "esp32")
  assert.match(textos(hs), /GPIO37 no sale/)
})

test("ESP32: analogRead en ADC2 avisa SOLO si hay WiFi", () => {
  const sinWifi = "void loop(){ int v = analogRead(25); }"
  assert.deepEqual(mod.analizarPines(sinWifi, "esp32"), [])
  const conWifi = "#include <WiFi.h>\nvoid setup(){ WiFi.begin(\"red\", \"clave\"); }\nvoid loop(){ int v = analogRead(25); }"
  const hs = mod.analizarPines(conWifi, "esp32")
  assert.match(textos(hs), /GPIO25 es del ADC2/)
  // ADC1 con WiFi: nada.
  assert.deepEqual(mod.analizarPines(conWifi.replace("analogRead(25)", "analogRead(32)"), "esp32"), [])
})

test("ESP32: arranque — 12 y 0 piden cuidado; 15 y 2 como entrada, nota; 2 como salida, nada", () => {
  assert.match(textos(mod.analizarPines("void setup(){ pinMode(12, OUTPUT); }", "esp32")), /Cuidado con GPIO12/)
  assert.match(textos(mod.analizarPines("void setup(){ pinMode(0, INPUT); }", "esp32")), /Cuidado con GPIO0/)
  assert.deepEqual(niveles(mod.analizarPines("void setup(){ pinMode(15, INPUT_PULLUP); }", "esp32")), ["nota"])
  assert.deepEqual(niveles(mod.analizarPines("void setup(){ pinMode(2, INPUT); }", "esp32")), ["nota"])
  assert.deepEqual(mod.analizarPines("void setup(){ pinMode(2, OUTPUT); }", "esp32"), [])
})

test("ESP32: 1 y 3 son el USB", () => {
  assert.match(textos(mod.analizarPines("void setup(){ pinMode(1, OUTPUT); }", "esp32")), /GPIO1 es TX/)
})

// ── UNO/Nano ─────────────────────────────────────────────────────────────────

test("UNO: D0/D1 con Serial avisa; sin Serial no; analogRead(0) es A0 y no avisa", () => {
  const conSerial = "void setup(){ Serial.begin(9600); pinMode(1, OUTPUT); }"
  assert.match(textos(mod.analizarPines(conSerial, "uno")), /D1 es TX del USB/)
  assert.deepEqual(mod.analizarPines("void setup(){ pinMode(1, OUTPUT); }", "uno"), [])
  assert.deepEqual(mod.analizarPines("void setup(){ Serial.begin(9600); } void loop(){ int v = analogRead(0); }", "uno"), [])
})

test("UNO: analogWrite fuera de 3/5/6/9/10/11 avisa; adentro no", () => {
  for (const p of [3, 5, 6, 9, 10, 11]) {
    assert.deepEqual(mod.analizarPines(`void loop(){ analogWrite(${p}, 100); }`, "uno"), [], `D${p} hace PWM`)
  }
  for (const p of [2, 4, 7, 8, 12]) {
    assert.match(textos(mod.analizarPines(`void loop(){ analogWrite(${p}, 100); }`, "uno")), new RegExp(`D${p} no hace PWM`))
  }
  // Las reglas del UNO no tocan al ESP32 (ahí cualquier salida hace PWM).
  assert.deepEqual(mod.analizarPines("void loop(){ analogWrite(4, 100); }", "esp32"), [])
})

test("UNO con Servo: analogWrite en D9 o D10 avisa (INFERIDO: Timer1)", () => {
  const src = "#include <Servo.h>\nServo s;\nvoid setup(){ s.attach(3); }\nvoid loop(){ analogWrite(9, 10); }"
  assert.match(textos(mod.analizarPines(src, "uno")), /D9 pierde el PWM/)
})

test("placa fuera del catálogo: no se opina", () => {
  assert.deepEqual(mod.analizarPines("void setup(){ pinMode(7, OUTPUT); }", null), [])
  assert.equal(mod.familiaDePlaca("esp32-c3-devkitm-1"), null)
})

// ── Resolución y falsos positivos ────────────────────────────────────────────

test("resuelve #define, const, variables que no cambian y arreglos", () => {
  const casos = [
    "#define PIN_MOTOR 7\nvoid setup(){ pinMode(PIN_MOTOR, OUTPUT); }",
    "const int pinMotor = 7;\nvoid setup(){ pinMode(pinMotor, OUTPUT); }",
    "int pinMotor = 7;\nvoid setup(){ pinMode(pinMotor, OUTPUT); }",
    "#define BASE 7\nconst uint8_t pinMotor = BASE;\nvoid setup(){ pinMode((pinMotor), OUTPUT); }",
    "const int pines[] = {4, 7};\nvoid setup(){ for (int i = 0; i < 2; i++) pinMode(pines[i], OUTPUT); }",
    "const int pines[3] = {4, 5, 7};\nvoid setup(){ pinMode(pines[2], OUTPUT); }",
  ]
  for (const src of casos) {
    assert.deepEqual(niveles(mod.analizarPines(src, "esp32")), ["bloqueo"], `no resolvió:\n${src}`)
  }
  // Índice fijo a un elemento sano: nada.
  assert.deepEqual(mod.analizarPines("const int pines[] = {4, 7};\nvoid setup(){ pinMode(pines[0], OUTPUT); }", "esp32"), [])
})

test("FALSO POSITIVO: una variable que cambia en tiempo de ejecución no se resuelve ni avisa", () => {
  const casos = [
    "int pin = 7;\nvoid setup(){ pin = 4; pinMode(pin, OUTPUT); }",
    "int pin = 7;\nvoid loop(){ pin++; digitalWrite(pin, HIGH); }",
    "int pines[] = {4, 7};\nvoid setup(){ pines[1] = 5; pinMode(pines[1], OUTPUT); }",
    "int pin = 7;\nvoid prender(int pin){ digitalWrite(pin, HIGH); }",
    "void setup(){ for (int p = 6; p < n; p++) pinMode(p, OUTPUT); }",
  ]
  for (const src of casos) {
    assert.deepEqual(mod.analizarPines(src, "esp32"), [], `avisó de algo que no sabe:\n${src}`)
  }
})

test("FALSO POSITIVO: pines en comentarios y en textos no cuentan", () => {
  const src = [
    "// pinMode(7, OUTPUT);  <- así NO",
    "/* digitalWrite(8, HIGH); */",
    'const char* ayuda = "pinMode(9, OUTPUT)";',
    "void setup(){ Serial.println(\"conectá el LED al GPIO7\"); pinMode(4, OUTPUT); }",
  ].join("\n")
  assert.deepEqual(mod.analizarPines(src, "esp32"), [])
})

test("FALSO POSITIVO: LED_BUILTIN no avisa y no entra en la huella", () => {
  const src = "void setup(){ pinMode(LED_BUILTIN, OUTPUT); }\nvoid loop(){ digitalWrite(LED_BUILTIN, HIGH); }"
  assert.deepEqual(mod.analizarPines(src, "uno"), [])
  assert.deepEqual(mod.huellaDelCodigo(src, "uno").huella.entradas, [])
  // En ESP32 el core NO define LED_BUILTIN: el código tiene que definirlo, y el GPIO2 con ese nombre es el LED.
  const esp = "#define LED_BUILTIN 2\n" + src
  assert.deepEqual(mod.analizarPines(esp, "esp32"), [])
  assert.deepEqual(mod.huellaDelCodigo(esp, "esp32dev").huella.entradas, [])
  // Un fade del LED de la placa del UNO (analogWrite, no OUTPUT) tampoco: es el LED_BUILTIN del core.
  assert.deepEqual(mod.huellaDelCodigo("void loop(){ analogWrite(LED_BUILTIN, 128); }", "uno").huella.entradas, [])
  // Un #define que apunta a LED_BUILTIN es lo mismo.
  assert.deepEqual(mod.huellaDelCodigo("#define LED LED_BUILTIN\nvoid setup(){ pinMode(LED, OUTPUT); }", "uno").huella.entradas, [])
})

test("FALSO POSITIVO: los blinks del repo, con el pin del LED escrito a mano, no piden checklist", () => {
  // ejemplos/blink-uno usa `pinMode(13, OUTPUT)` y ejemplos/blink-esp32 `PIN_LED = 2`, sin
  // LED_BUILTIN. Pedir el checklist para el primer blink es el freno innecesario
  // que enseña a saltearlo.
  for (const [dir, board] of [["blink-uno", "uno"], ["blink-esp32", "esp32dev"]]) {
    const src = readFileSync(join(REPO, "ejemplos", dir, "src", "main.cpp"), "utf8")
    assert.deepEqual(mod.huellaDelCodigo(src, board).huella.entradas, [], `${dir} pide checklist`)
    assert.deepEqual(mod.analizarPines(src, mod.familiaDePlaca(board)), [], `${dir} tiene avisos`)
  }
  // Pero un relé en ese pin sí cuenta, y el pin del LED como ENTRADA también.
  assert.deepEqual(mod.huellaDelCodigo("const int RELE = 13;\nvoid setup(){ pinMode(RELE, OUTPUT); }", "uno").huella.entradas, ["pin:13:OUTPUT:rele"])
  assert.deepEqual(mod.huellaDelCodigo("void setup(){ pinMode(13, INPUT); }", "uno").huella.entradas, ["pin:13:INPUT"])
  // Y en el UNO el 2 es un pin cualquiera.
  assert.deepEqual(mod.huellaDelCodigo("void setup(){ pinMode(2, OUTPUT); }", "uno").huella.entradas, ["pin:2:OUTPUT"])
})

test("UNO: analogRead(0) y analogRead(A0) son el mismo pin para la huella", () => {
  // Si no, pasar de `analogRead(0)` a `analogRead(A0)` —el mismo cable— pediría el
  // checklist de nuevo. (La regla de D0/D1 ya excluye las lecturas analógicas, por
  // eso este mapeo no se ve en los avisos: se ve acá.)
  const con0 = mod.huellaDelCodigo("void loop(){ int v = analogRead(0); }", "uno").huella
  const conA0 = mod.huellaDelCodigo("void loop(){ int v = analogRead(A0); }", "uno").huella
  assert.deepEqual(con0.entradas, ["pin:14:ANALOG"])
  assert.deepEqual(con0, conA0)
  assert.equal(mod.describirEntrada(con0.entradas[0], "uno"), "A0 como entrada analógica")
})

test("ESP32: LED_BUILTIN es lo que define el código; sin definir, no es ningún pin", () => {
  // El core fijado no lo define en esp32dev (variants/esp32/pins_arduino.h). La
  // primera versión lo daba por 2: un supuesto falso, probado con fixtures falsas.
  assert.deepEqual(niveles(mod.analizarPines("#define LED_BUILTIN 7\nvoid setup(){ pinMode(LED_BUILTIN, OUTPUT); }", "esp32")), ["bloqueo"])
  assert.deepEqual(niveles(mod.analizarPines("#define LED_BUILTIN 2\nvoid setup(){ pinMode(LED_BUILTIN, INPUT); }", "esp32")), ["nota"])
  assert.deepEqual(mod.analizarPines("void setup(){ pinMode(LED_BUILTIN, INPUT); }", "esp32"), [])
  assert.deepEqual(mod.usosDePines("void setup(){ pinMode(LED_BUILTIN, OUTPUT); }", "esp32")[0].pines, [])
  // En UNO sigue siendo el 13 del core.
  assert.deepEqual(mod.usosDePines("void setup(){ pinMode(LED_BUILTIN, OUTPUT); }", "uno")[0].pines, [13])
})

test("Ticker.attach no es un servo: sin Servo.h, .attach no cuenta", () => {
  const src = "#include <Ticker.h>\nTicker t;\nvoid setup(){ t.attach(36, cb); }"
  assert.deepEqual(mod.analizarPines(src, "esp32"), [])
})

// ── Huella ───────────────────────────────────────────────────────────────────

test("huella: placa, pin:modo y librerías de hardware; sin WiFi ni lógica", () => {
  const src = [
    "#include <WiFi.h>",
    "#include <DHT.h>",
    "#define DHTPIN 4",
    "DHT dht(DHTPIN, DHT22);",
    "const int LED_ROJO = 18;",
    "void setup(){ pinMode(LED_ROJO, OUTPUT); WiFi.begin(\"a\", \"b\"); dht.begin(); }",
    "void loop(){ digitalWrite(LED_ROJO, HIGH); float t = dht.readTemperature(); if (t > 30) delay(10); }",
  ].join("\n")
  const { huella, rasgos } = mod.huellaDelCodigo(src, "esp32dev")
  assert.equal(huella.placa, "esp32dev")
  // El digitalWrite sobre un pin con pinMode no agrega otra entrada: manda el pinMode.
  assert.deepEqual(huella.entradas, ["lib:DHT", "pin:18:OUTPUT", "pin:4:DHT"])
  assert.deepEqual(rasgos, { wifi: true, dht: true, servo: false, rele: false })
})

test("huella: cambiar sólo la lógica no cambia la huella ni el código", () => {
  const a = "const int BOTON = 4;\nvoid setup(){ pinMode(BOTON, INPUT_PULLUP); }\nvoid loop(){ if (digitalRead(BOTON) == LOW) delay(100); }"
  const b = "const int BOTON = 4;\nvoid setup(){ pinMode(BOTON, INPUT_PULLUP); }\nvoid loop(){ if (digitalRead(BOTON) == LOW) delay(500); }"
  const ha = mod.huellaDelCodigo(a, "esp32dev").huella
  const hb = mod.huellaDelCodigo(b, "esp32dev").huella
  assert.deepEqual(ha, hb)
  assert.equal(mod.codigoChecklist(ha), mod.codigoChecklist(hb))
  assert.match(mod.codigoChecklist(ha), /^[0-9a-f]{6}$/)
})

test("huella: un relé se reconoce por el nombre del pin (INFERIDO) y pide actuadores + checklist", () => {
  const { rasgos } = mod.huellaDelCodigo("const int PIN_RELE = 26;\nvoid setup(){ pinMode(PIN_RELE, OUTPUT); }", "esp32dev")
  assert.equal(rasgos.rele, true)
  assert.deepEqual(mod.skillsParaRasgos(rasgos), ["actuadores", "checklist-seguridad"])
})

test("los skills que recuerda existen de verdad en opencode/skills", () => {
  const todos = mod.skillsParaRasgos({ wifi: true, dht: true, servo: true, rele: true })
  assert.deepEqual(todos.sort(), ["actuadores", "checklist-seguridad", "esp32", "librerias", "sensores"])
  for (const s of todos) assert.ok(existsSync(join(REPO, "opencode/skills", s, "SKILL.md")), `no existe el skill ${s}`)
})

test("altasNuevas(): sacar no pide nada; agregar o cambiar de modo sí; otra placa, todo es nuevo", () => {
  const previa = { placa: "esp32dev", entradas: ["lib:DHT", "pin:4:DHT"] }
  assert.deepEqual(mod.altasNuevas({ placa: "esp32dev", entradas: ["pin:4:DHT"] }, previa), [])
  assert.deepEqual(mod.altasNuevas({ placa: "esp32dev", entradas: ["lib:DHT", "pin:4:DHT", "pin:5:OUTPUT"] }, previa), ["pin:5:OUTPUT"])
  assert.deepEqual(mod.altasNuevas({ placa: "esp32dev", entradas: ["pin:4:OUTPUT"] }, previa), ["pin:4:OUTPUT"])
  assert.deepEqual(mod.altasNuevas({ placa: "uno", entradas: ["pin:4:DHT"] }, previa), ["pin:4:DHT"])
  assert.deepEqual(mod.altasNuevas({ placa: "esp32dev", entradas: ["pin:4:DHT"] }, null), ["pin:4:DHT"])
})

// ── compile ─────────────────────────────────────────────────────────────────

const NUNCA_PINES_OK = /pines?\s+(OK|bien|correctos)/i

test("compile con GPIO7: compila, NO dice 'listo para cargar' a secas y nombra el pin", async () => {
  const dir = proyecto("esp32dev", "void setup(){ pinMode(7, OUTPUT); }\nvoid loop(){ digitalWrite(7, HIGH); }")
  const r = await ejecutar({ action: "compile", project_path: dir })
  assert.match(r, /Compilacion exitosa/)
  assert.doesNotMatch(r, /listo para cargar/, "con un bloqueo no puede decir que está listo para cargar")
  assert.match(r, /GPIO7.*flash/)
  assert.doesNotMatch(r, NUNCA_PINES_OK)
  assert.ok(!cargo(), "compile nunca carga")
})

test("compile sin hallazgos: el mensaje de siempre, sin 'pines OK'", async () => {
  const dir = proyecto("esp32dev", "#define LED_BUILTIN 2\nvoid setup(){ pinMode(LED_BUILTIN, OUTPUT); }\nvoid loop(){}")
  const r = await ejecutar({ action: "compile", project_path: dir })
  assert.equal(r, "Compilacion exitosa. El codigo esta listo para cargar al dispositivo.")
})

test("compile con aviso (34 como salida): avisa pero no frena", async () => {
  const dir = proyecto("esp32dev", "void setup(){ pinMode(34, OUTPUT); }")
  const r = await ejecutar({ action: "compile", project_path: dir })
  assert.match(r, /listo para cargar/)
  assert.match(r, /GPIO34 es SOLO ENTRADA/)
  assert.doesNotMatch(r, NUNCA_PINES_OK)
})

test("compile: recuerda skills sólo cuando la huella cambió", async () => {
  const codigo = "#include <DHT.h>\nDHT dht(4, DHT22);\nvoid setup(){ dht.begin(); }"
  const dir = proyecto("esp32dev", codigo)
  const r1 = await ejecutar({ action: "compile", project_path: dir })
  assert.match(r1, /Recordatorio:.*`sensores`.*`librerias`/)
  assert.equal(r1.split("\n").filter((l) => l.startsWith("Recordatorio")).length, 1, "es UNA línea")

  // Se carga (con el checklist) y la huella queda guardada: compilar lo mismo ya no recuerda.
  const freno = await ejecutar({ action: "flash", project_path: dir })
  const codigoCl = codigoDe(freno)
  await ejecutar({ action: "flash", project_path: dir, checklist: codigoCl })
  const r2 = await ejecutar({ action: "compile", project_path: dir })
  assert.doesNotMatch(r2, /Recordatorio/)
})

test("compile que falla: no se toca el mensaje de error", async () => {
  escenario({ compile: { code: 1, stderr: "src/main.cpp:1:1: error: expected ';' before 'x'\n" } })
  const dir = proyecto("esp32dev", "void setup(){ pinMode(7, OUTPUT); }")
  const r = await ejecutar({ action: "compile", project_path: dir })
  assert.match(r, /Hubo un error al compilar/)
})

// ── flash/both: bloqueo 6–11 ─────────────────────────────────────────────────

test("flash con GPIO7: frena ANTES de buscar la placa, aun con un checklist", async () => {
  const dir = proyecto("esp32dev", "void setup(){ pinMode(7, OUTPUT); }")
  const r = await ejecutar({ action: "flash", project_path: dir, checklist: "abcdef" })
  assert.match(r, /NO CARGUÉ NADA/)
  assert.match(r, /GPIO7/)
  assert.ok(!buscoPlaca(), "buscó la placa con un pin que la deja sin arrancar")
  assert.ok(!cargo())
})

test("both con GPIO7: compila, y no busca la placa ni carga", async () => {
  const dir = proyecto("esp32dev", "void setup(){ pinMode(7, OUTPUT); }")
  const r = await ejecutar({ action: "both", project_path: dir })
  assert.match(r, /La compilacion fue bien\. NO CARGUÉ NADA/)
  assert.ok(!buscoPlaca())
  assert.ok(!cargo())
})

test("flash con GPIO7 dentro de un #ifdef desconocido: no bloquea (es aviso); con el checklist, carga y lo cuenta", async () => {
  const dir = proyecto("esp32dev", "#ifdef DEBUG\nvoid x(){ pinMode(7, OUTPUT); }\n#endif\nvoid setup(){}")
  const r1 = await ejecutar({ action: "flash", project_path: dir })
  assert.doesNotMatch(r1, /NO CARGUÉ NADA/, "adentro de un #if no es bloqueo")
  assert.match(r1, FRENO, "es un pin nuevo: pide el checklist como cualquier otro")
  const codigo = codigoDe(r1)
  const r2 = await ejecutar({ action: "flash", project_path: dir, checklist: codigo })
  assert.match(r2, /Codigo cargado exitosamente/)
  assert.match(r2, /GPIO7 es de la memoria flash.*#if/, "el aviso le llega al docente después de cargar")
})

// ── flash/both: la compuerta del checklist ───────────────────────────────────

const CON_BUZZER = "const int BUZZER = 25;\nvoid setup(){ pinMode(BUZZER, OUTPUT); }\nvoid loop(){ tone(BUZZER, 440); }"

test("flash con hardware nuevo: el cartel aparece ANTES de buscar la placa, y con Reject no carga", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  const r = await ejecutar({ action: "flash", project_path: dir })
  assert.match(r, FRENO)
  assert.match(r, /GPIO25 como salida/)
  assert.match(r, /checklist-seguridad/)
  assert.equal(pedidos.length, 1)
  assert.equal(pedidos[0].permission, `${mod.PREGUNTA_CHECKLIST} Cambió: salida en GPIO25`)
  assert.ok(!buscoPlaca(), "la compuerta va ANTES de detectPort")
  assert.ok(!cargo())
  assert.ok(!existsSync(join(dir, ".pio", "tecnia", "ultima-carga.json")), "sin carga no hay estado")
})

test("'Allow always' vale solo para ese cambio: patterns y always llevan el código de la huella", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  await ejecutar({ action: "flash", project_path: dir })
  const codigo = mod.codigoChecklist(mod.analizarProyecto(dir).huella)
  assert.deepEqual(pedidos[0].patterns, [`cambio ${codigo}`])
  assert.deepEqual(pedidos[0].always, [`cambio ${codigo}`])
  assert.deepEqual(pedidos[0].metadata.cambios, ["salida en GPIO25"])
  // Otro circuito, otro código: lo aprobado "siempre" para uno no vale para el otro.
  reescribir(dir, CON_BUZZER + "\nconst int PIR = 27;\nvoid x(){ pinMode(PIR, INPUT); }")
  await ejecutar({ action: "flash", project_path: dir })
  assert.notDeepEqual(pedidos[1].patterns, pedidos[0].patterns)
})

test("flash con el código correcto: carga y guarda la huella; la próxima carga igual no frena", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  const r1 = await ejecutar({ action: "flash", project_path: dir })
  const codigo = codigoDe(r1)
  spawns = []
  const r2 = await ejecutar({ action: "flash", project_path: dir, checklist: codigo.toUpperCase() })
  assert.match(r2, /Codigo cargado exitosamente/)
  assert.ok(cargo())
  const estado = JSON.parse(readFileSync(join(dir, ".pio", "tecnia", "ultima-carga.json"), "utf8"))
  assert.deepEqual(estado, { version: 3, ...mod.hashearHuella({ placa: "esp32dev", entradas: ["pin:25:OUTPUT"] }), placaFisica: estado.placaFisica, marcaSal: estado.marcaSal })

  // Cambio de lógica: no frena.
  reescribir(dir, CON_BUZZER.replace("440", "880"))
  spawns = []
  assert.match(await ejecutar({ action: "flash", project_path: dir }), /Codigo cargado exitosamente/)

  // Agregar un PIR: frena, y sólo nombra lo nuevo.
  reescribir(dir, CON_BUZZER + "\nconst int PIR = 27;\nvoid x(){ pinMode(PIR, INPUT); }")
  spawns = []
  const r3 = await ejecutar({ action: "flash", project_path: dir })
  assert.match(r3, FRENO)
  assert.match(r3, /Lo nuevo: GPIO27 como entrada\./)
  assert.ok(!cargo())
})

test("una carga que FALLA no guarda la huella: la próxima vuelve a pedir el checklist", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  const codigo = codigoDe(await ejecutar({ action: "flash", project_path: dir }))
  escenario({ upload: { code: 1, stderr: "A fatal error occurred: Failed to connect to ESP32\n" } })
  const r = await ejecutar({ action: "flash", project_path: dir, checklist: codigo })
  assert.match(r, /Error al cargar/)
  assert.ok(!existsSync(join(dir, ".pio", "tecnia", "ultima-carga.json")), "guardó el estado de una carga que falló")
  escenario()
  spawns = []
  assert.match(await ejecutar({ action: "flash", project_path: dir }), FRENO)
})

test("both: la compuerta también, y con el código carga y guarda", async () => {
  const dir = proyecto("uno", "const int RELE = 7;\nvoid setup(){ pinMode(RELE, OUTPUT); }")
  const r1 = await ejecutar({ action: "both", project_path: dir })
  assert.match(r1, /La compilacion fue bien\. No cargué: elegiste Reject/)
  assert.match(r1, /D7 como salida/)
  assert.ok(!buscoPlaca())
  const codigo = codigoDe(r1)
  spawns = []
  const r2 = await ejecutar({ action: "both", project_path: dir, checklist: codigo })
  assert.match(r2, /Compilacion y carga exitosa/)
  assert.ok(existsSync(join(dir, ".pio", "tecnia", "ultima-carga.json")))
})

test("blink con LED_BUILTIN: no hay nada que chequear, carga directo", async () => {
  const dir = proyecto("uno", "void setup(){ pinMode(LED_BUILTIN, OUTPUT); }\nvoid loop(){ digitalWrite(LED_BUILTIN, HIGH); }")
  const r = await ejecutar({ action: "flash", project_path: dir })
  assert.match(r, /Codigo cargado exitosamente/)
})

test("cambiar de placa con el mismo circuito pide el checklist de nuevo", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  const codigo = codigoDe(await ejecutar({ action: "flash", project_path: dir }))
  await ejecutar({ action: "flash", project_path: dir, checklist: codigo })
  writeFileSync(join(dir, "platformio.ini"), "[env:uno]\nplatform = x\nboard = uno\nframework = arduino\n")
  spawns = []
  const r = await ejecutar({ action: "flash", project_path: dir })
  assert.match(r, FRENO)
  // Y lo aprobado para la placa vieja no vale para la nueva: otro código en patterns.
  assert.notDeepEqual(pedidos[pedidos.length - 1].patterns, pedidos[0].patterns)
})

test("el parámetro checklist ya no existe (lo reemplazó el cartel) y el enum de acciones no cambió", () => {
  // Leído del schema que arma el tool (con el mock que anota), no del texto del fuente.
  const { args } = mod.default
  assert.equal(args.checklist, undefined, "el código de 6 caracteres lo pasaba el bot: el cartel lo contesta la persona")
  assert.doesNotMatch(mod.default.description, /parametro 'checklist'/)
  assert.match(mod.default.description, /cartel de OpenCode/)
  assert.equal(args.action.tipo, "enum")
  assert.deepEqual([...args.action.valores].sort(), ["both", "compile", "diagnostico", "flash", "monitor", "reparar"])
})

test("el prompt le explica al bot el cartel: avisar antes, qué botón es cuál, no revisar él, no reintentar", () => {
  // Sin esto, al docente le aparece un cartel en inglés de sorpresa, o el bot
  // dice que "ya revisó" un circuito que no puede ver.
  const prompt = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
  const linea = prompt.split("\n").find((l) => l.includes("muestran un cartel de OpenCode"))
  assert.ok(linea, "el prompt no menciona el cartel del checklist")
  assert.match(linea, /ANTES de llamar a cargar/)
  assert.match(linea, /\*\*Allow once\*\* si ya revisó el circuito, \*\*Reject\*\* si todavía no/)
  assert.match(linea, /Nunca digas que lo revisaste vos/)
  assert.match(linea, /no vuelvas a intentar la carga hasta que el docente te lo pida/)
  assert.doesNotMatch(prompt, /`checklist` que te dio el tool/, "quedó el parámetro viejo en el prompt")
})

// ═══════════════════════════════════════════════════════════════════════════
// Ronda de revisión: lo que encontraron las revisiones de riesgo y confiabilidad
// ═══════════════════════════════════════════════════════════════════════════

/** Un proyecto con los archivos que se le pidan (rutas relativas) y el ini tal cual. */
function proyectoCon(archivos, ini = "[env:esp32dev]\nplatform = x\nboard = esp32dev\nframework = arduino\n") {
  const dir = join(OUT, `proy-${++nProyecto}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "platformio.ini"), ini)
  for (const [ruta, texto] of Object.entries(archivos)) {
    mkdirSync(join(dir, ruta, ".."), { recursive: true })
    writeFileSync(join(dir, ruta), texto)
  }
  return dir
}
// "Hubo cartel y se contestó Reject": la próxima llamada con `checklist` lo contesta "Allow once".
const codigoDe = (r) => (FRENO.test(r) ? "si" : undefined)
const estadoDe = (dir) => join(dir, ".pio", "tecnia", "ultima-carga.json")

// ── 1. Falla cerrado ────────────────────────────────────────────────────────

test("FALLA CERRADO: un link roto en src/ no apaga el checklist; pide el código fijo y no guarda estado", async () => {
  // Antes, cualquier error de lectura devolvía null y apagaba A LA VEZ el bloqueo
  // de la flash y el checklist: el analizador fallaba abierto.
  const dir = proyectoCon({ "src/main.cpp": "void setup(){ pinMode(4, OUTPUT); }" })
  symlinkSync(join(dir, "no-existe.h"), join(dir, "src", "roto.h"))
  const r1 = await ejecutar({ action: "flash", project_path: dir })
  assert.match(r1, FRENO)
  assert.match(r1, /No pude leer todo el código del proyecto \(src[\\/]roto\.h\)/)
  assert.equal(pedidos[0].permission, `${mod.PREGUNTA_CHECKLIST} No pude leer todo el código`)
  assert.deepEqual(pedidos[0].patterns, [`análisis incompleto ${mod.codigoChecklist(mod.huellaIncompleta(dir, ["src/roto.h"]))}`], "el código sale del proyecto y de lo que no se pudo leer")
  assert.deepEqual(pedidos[0].always, [], "con el análisis incompleto, 'Allow always' no se puede guardar: se pregunta en cada carga")
  assert.ok(!buscoPlaca() && !cargo())

  spawns = []
  const r2 = await ejecutar({ action: "flash", project_path: dir, checklist: codigoDe(r1) })
  assert.match(r2, /Codigo cargado exitosamente/)
  assert.ok(!existsSync(estadoDe(dir)), "con el análisis incompleto no se guarda la huella")
  spawns = []
  assert.match(await ejecutar({ action: "flash", project_path: dir }), FRENO, "el checklist va en cada carga mientras no se pueda leer")

  // compile lo dice, sin frenar.
  const rc = await ejecutar({ action: "compile", project_path: dir })
  assert.match(rc, /listo para cargar/)
  assert.match(rc, /No pude leer todo el código/)
})

test("FALLA CERRADO: el bloqueo de la flash sigue valiendo con lo que sí se pudo leer", async () => {
  const dir = proyectoCon({ "src/main.cpp": "void setup(){ pinMode(7, OUTPUT); }" })
  symlinkSync(join(dir, "no-existe.h"), join(dir, "src", "roto.h"))
  assert.match(await ejecutar({ action: "flash", project_path: dir }), /NO CARGUÉ NADA/)
})

test("FALLA CERRADO: un platformio.ini ilegible o un src_dir que no es carpeta dejan el análisis incompleto", () => {
  const conIniCarpeta = join(OUT, `proy-${++nProyecto}`)
  mkdirSync(join(conIniCarpeta, "platformio.ini"), { recursive: true })
  mkdirSync(join(conIniCarpeta, "src"))
  assert.deepEqual(mod.analizarProyecto(conIniCarpeta).incompleto, ["platformio.ini"])

  const srcArchivo = proyectoCon({ "codigo": "no soy una carpeta" }, "[platformio]\nsrc_dir = codigo\n[env:esp32dev]\nboard = esp32dev\n")
  assert.deepEqual(mod.analizarProyecto(srcArchivo).incompleto, ["codigo"])
  // Sin ini, o sin ninguna carpeta de código, no hay nada que analizar todavía.
  assert.equal(mod.analizarProyecto(proyectoCon({}, "[env:esp32dev]\nboard = esp32dev\n")), null)
})

// ── 2. Compilación condicional ───────────────────────────────────────────────

const PORTABLE = "#if defined(ESP32)\n#define LED 2\n#define BOTON 4\n#else\n#define LED 7\n#define BOTON 8\n#endif\nvoid setup(){ pinMode(LED, OUTPUT); pinMode(BOTON, INPUT_PULLUP); }"

test("#if defined(ESP32): en esp32dev se usa SOLO la rama de ESP32, y en UNO solo la otra", () => {
  assert.deepEqual(mod.analizarPines(PORTABLE, "esp32"), [], "tomó el LED 7 de la rama de AVR")
  assert.deepEqual(mod.huellaDelCodigo(PORTABLE, "esp32dev").huella.entradas, ["pin:4:INPUT_PULLUP"])
  assert.doesNotMatch(textos(mod.analizarPines(PORTABLE, "uno")), /GPIO/)
  assert.deepEqual(mod.huellaDelCodigo(PORTABLE, "uno").huella.entradas, ["pin:7:OUTPUT", "pin:8:INPUT_PULLUP"])
})

test("#if defined(ESP32) alrededor de pinMode(7) en esp32dev: se compila, así que BLOQUEA", () => {
  assert.deepEqual(niveles(mod.analizarPines("#if defined(ESP32)\nvoid setup(){ pinMode(7, OUTPUT); }\n#endif", "esp32")), ["bloqueo"])
  assert.deepEqual(niveles(mod.analizarPines("#ifdef ARDUINO_ARCH_ESP32\nvoid setup(){ pinMode(7, OUTPUT); }\n#endif", "esp32")), ["bloqueo"])
  // Y la rama de AVR en un ESP32 no se compila: ni avisos.
  assert.deepEqual(mod.analizarPines("#ifdef __AVR__\nvoid setup(){ pinMode(7, OUTPUT); }\n#endif", "esp32"), [])
  assert.deepEqual(mod.analizarPines("#ifndef ESP32\nvoid setup(){ pinMode(7, OUTPUT); }\n#endif", "esp32"), [])
})

test("#elif y #else se evalúan para la placa", () => {
  const src = "#if defined(__AVR__)\nvoid a(){ pinMode(7, OUTPUT); }\n#elif defined(ESP32)\nvoid b(){ pinMode(8, OUTPUT); }\n#else\nvoid c(){ pinMode(9, OUTPUT); }\n#endif"
  assert.match(textos(mod.analizarPines(src, "esp32")), /^GPIO8 está cableado/)
  assert.equal(mod.analizarPines(src, "esp32").length, 1)
  assert.deepEqual(mod.huellaDelCodigo(src, "uno").huella.entradas, ["pin:7:OUTPUT"])
  assert.deepEqual(mod.huellaDelCodigo("#if defined(ARDUINO_AVR_NANO)\nvoid a(){ pinMode(5, OUTPUT); }\n#endif", "uno").huella.entradas, [])
  assert.deepEqual(mod.huellaDelCodigo("#if defined(ARDUINO_AVR_NANO)\nvoid a(){ pinMode(5, OUTPUT); }\n#endif", "nanoatmega328").huella.entradas, ["pin:5:OUTPUT"])
})

test("un header con include guard y pinMode(7) BLOQUEA: el guard no es una condición", () => {
  const src = "#ifndef PINES_H\n#define PINES_H\ninline void iniciar(){ pinMode(7, OUTPUT); }\n#endif\n"
  assert.deepEqual(niveles(mod.analizarPines(src, "esp32")), ["bloqueo"])
})

test("un #ifdef DEBUG vacío ANTES no contagia: pinMode(7) después de su #endif bloquea", () => {
  assert.deepEqual(niveles(mod.analizarPines("#ifdef DEBUG\n#endif\nvoid setup(){ pinMode(7, OUTPUT); }", "esp32")), ["bloqueo"])
})

test("#ifdef anidados: pinMode(7) entre el #endif de adentro y el de afuera sigue siendo aviso", () => {
  const src = "#ifdef A\n#ifdef B\n#endif\nvoid setup(){ pinMode(7, OUTPUT); }\n#endif\n"
  assert.deepEqual(niveles(mod.analizarPines(src, "esp32")), ["aviso"])
})

test("un nombre definido distinto en ramas desconocidas queda sin resolver, y la huella guarda los dos valores", () => {
  const src = "#ifdef DEBUG\n#define MOTOR 7\n#else\n#define MOTOR 4\n#endif\nvoid setup(){ pinMode(MOTOR, OUTPUT); }"
  assert.deepEqual(mod.analizarPines(src, "esp32"), [])
  assert.deepEqual(mod.huellaDelCodigo(src, "esp32dev").huella.entradas, ["pin:MOTOR{MOTOR=7|4}:OUTPUT"])
})

test("#elif después de una rama ya tomada no se compila, y #undef saca el nombre", () => {
  const src = "#if defined(ESP32)\nvoid a(){}\n#elif defined(ARDUINO_ARCH_ESP32)\nvoid b(){ pinMode(7, OUTPUT); }\n#endif"
  assert.deepEqual(mod.analizarPines(src, "esp32"), [])
  // Si la primera rama es desconocida, la del #elif puede compilarse: aviso, no silencio.
  assert.deepEqual(niveles(mod.analizarPines(src.replace("defined(ESP32)", "defined(DEBUG)"), "esp32")), ["aviso"])
  assert.deepEqual(mod.analizarPines("#define LED 7\n#undef LED\nvoid setup(){ pinMode(LED, OUTPUT); }", "esp32"), [])
})

test("preprocesador: #define en varias líneas, #ifdef de un nombre del propio código, y el mismo nombre distinto en dos archivos", () => {
  assert.deepEqual(niveles(mod.analizarPines("#define MOTOR \\\n  7\nvoid setup(){ pinMode(MOTOR, OUTPUT); }", "esp32")), ["bloqueo"])
  assert.deepEqual(niveles(mod.analizarPines("#define USAR_MOTOR\n#ifdef USAR_MOTOR\nvoid setup(){ pinMode(7, OUTPUT); }\n#endif", "esp32")), ["bloqueo"], "USAR_MOTOR está definido en el código: la rama se compila")
  const dos = proyectoCon({ "src/a.cpp": "#define LED 4\nvoid a(){ pinMode(LED, OUTPUT); }", "src/b.cpp": "#define LED 7\nvoid b(){ pinMode(LED, OUTPUT); }" })
  assert.deepEqual(mod.analizarProyecto(dos).hallazgos, [], "dos archivos con LED distinto: no se sabe cuál, no se inventa")
})

test("pines en hexa, y el arreglo entero que se le pasa a un Keypad", () => {
  assert.deepEqual(niveles(mod.analizarPines("void setup(){ pinMode(0x07, OUTPUT); }", "esp32")), ["bloqueo"])
  const teclado = "#include <Keypad.h>\nbyte filas[4] = {7, 4, 5, 18};\nbyte columnas[4] = {19, 21, 22, 23};\nKeypad k = Keypad(makeKeymap(teclas), filas, columnas, 4, 4);"
  assert.deepEqual(niveles(mod.analizarPines(teclado, "esp32")), ["bloqueo"])
})

test("Serial1 sin pines en UNO no es la regla del ESP32", () => {
  assert.deepEqual(mod.analizarPines("void setup(){ Serial1.begin(9600); }", "uno"), [])
})

test("evaluarCondicion(): tres valores, y lo que no entiende es null", () => {
  const c = mod.macrosDePlaca("esp32dev")
  assert.equal(mod.evaluarCondicion("defined(ESP32) && !defined(__AVR__)", c), true)
  assert.equal(mod.evaluarCondicion("defined ESP32 || defined(DEBUG)", c), true)
  assert.equal(mod.evaluarCondicion("defined(DEBUG) && defined(__AVR__)", c), false)
  assert.equal(mod.evaluarCondicion("defined(DEBUG)", c), null)
  assert.equal(mod.evaluarCondicion("OTRA_VERSION >= 2", c), null)
  assert.equal(mod.evaluarCondicion("0", c), false)
  assert.equal(mod.evaluarCondicion("(1)", c), true)
})

// ── 3. Más fuentes ──────────────────────────────────────────────────────────

test("un header en include/ con #define MOTOR 7 bloquea; 7→4→25 después de cargar pide el checklist de nuevo", async () => {
  const main = '#include "config.h"\nvoid setup(){ pinMode(MOTOR, OUTPUT); }'
  const dir = proyectoCon({ "include/config.h": "#pragma once\n#define MOTOR 7\n", "src/main.cpp": main })
  assert.match(await ejecutar({ action: "flash", project_path: dir }), /NO CARGUÉ NADA[\s\S]*GPIO7/)

  writeFileSync(join(dir, "include", "config.h"), "#pragma once\n#define MOTOR 4\n")
  const r1 = await ejecutar({ action: "flash", project_path: dir })
  assert.match(r1, /Lo nuevo: GPIO4 como salida/)
  assert.match(await ejecutar({ action: "flash", project_path: dir, checklist: codigoDe(r1) }), /Codigo cargado exitosamente/)

  writeFileSync(join(dir, "include", "config.h"), "#pragma once\n#define MOTOR 25\n")
  spawns = []
  const r2 = await ejecutar({ action: "flash", project_path: dir })
  assert.match(r2, /No cargué: elegiste Reject[\s\S]*Lo nuevo: GPIO25 como salida/)
  assert.ok(!cargo())
})

test("un pin sin resolver entra a la huella con lo que tiene escrito (si no cambia en tiempo de ejecución): cambiar su valor cambia el código", () => {
  const con = (v) => mod.huellaDelCodigo(`#ifdef DEBUG\n#define MOTOR 7\n#else\n#define MOTOR ${v}\n#endif\nvoid setup(){ pinMode(MOTOR, OUTPUT); }`, "esp32dev").huella
  assert.notEqual(mod.codigoChecklist(con(4)), mod.codigoChecklist(con(25)))
  assert.deepEqual(con(4).entradas, ["pin:MOTOR{MOTOR=7|4}:OUTPUT"])
  // Una variable reasignada entra con su valor inicial: si el pin inicial cambia, cambió el circuito.
  assert.deepEqual(mod.huellaDelCodigo("int pin = 4;\nvoid setup(){ pin = millis() > 10 ? pin : 5; pinMode(pin, OUTPUT); }", "esp32dev").huella.entradas, ["pin:pin{pin=4}:OUTPUT"])
})

test("lib/ se lee (sin los ejemplos de la librería), y src_dir / include_dir se respetan", () => {
  const conLib = proyectoCon({
    "src/main.cpp": '#include "motor.h"\nvoid setup(){ arrancar(); }',
    "lib/Motor/src/motor.h": "inline void arrancar(){ pinMode(7, OUTPUT); }",
    "lib/Motor/examples/demo/demo.ino": "void setup(){ pinMode(8, OUTPUT); }",
  })
  const a = mod.analizarProyecto(conLib)
  assert.deepEqual(niveles(a.hallazgos), ["bloqueo"])
  assert.match(textos(a.hallazgos), /GPIO7/)
  assert.doesNotMatch(textos(a.hallazgos), /GPIO8/, "leyó los ejemplos de la librería")

  const movido = proyectoCon(
    { "codigo/principal.cpp": "void setup(){ pinMode(MOTOR, OUTPUT); }", "cabeceras/pines.h": "#define MOTOR 9\n", "src/viejo.cpp": "void x(){ pinMode(10, OUTPUT); }" },
    "[platformio]\nsrc_dir = codigo\ninclude_dir = ${PROJECT_DIR}/cabeceras\n[env:esp32dev]\nboard = esp32dev\n",
  )
  const b = mod.analizarProyecto(movido)
  assert.match(textos(b.hallazgos), /GPIO9/)
  assert.doesNotMatch(textos(b.hallazgos), /GPIO10/, "leyó src/ aunque el ini dice otra carpeta")
})

test("una carpeta que es un link no se sigue: puede salir del proyecto", () => {
  const afuera = join(OUT, `afuera-${++nProyecto}`)
  mkdirSync(afuera)
  writeFileSync(join(afuera, "ajeno.cpp"), "void x(){ pinMode(7, OUTPUT); }")
  const dir = proyectoCon({ "src/main.cpp": "void setup(){}" })
  symlinkSync(afuera, join(dir, "src", "externo"))
  assert.deepEqual(mod.analizarProyecto(dir).hallazgos, [])
})

test("cada archivo se limpia por su lado: un /* sin cerrar en un .h no tapa el main.cpp", () => {
  const dir = proyectoCon({ "src/licencia.h": "/* licencia sin cerrar\n", "src/main.cpp": "void setup(){ pinMode(7, OUTPUT); }" })
  assert.deepEqual(niveles(mod.analizarProyecto(dir).hallazgos), ["bloqueo"])
  const dir2 = proyectoCon({ "src/a.h": "#ifndef A\n#define A\n", "src/main.cpp": "void setup(){ pinMode(7, OUTPUT); }" })
  assert.deepEqual(niveles(mod.analizarProyecto(dir2).hallazgos), ["bloqueo"], "un #if sin cerrar en otro archivo bajó el bloqueo")
})

test("varios archivos, subcarpetas y .ino: todo se lee", () => {
  const dir = proyectoCon({ "src/pines.h": "#define MOTOR 7\n", "src/sub/motor.cpp": "void m(){ pinMode(MOTOR, OUTPUT); }", "src/sketch.ino": "void setup(){ pinMode(8, OUTPUT); }" })
  const t = textos(mod.analizarProyecto(dir).hallazgos)
  assert.match(t, /GPIO7/)
  assert.match(t, /GPIO8/)
})

// ── 4. Métodos de otros objetos ──────────────────────────────────────────────

test("mcp.pinMode(7) y exp->digitalWrite(8) son pines de un expansor, no GPIO7/8", () => {
  assert.deepEqual(mod.analizarPines("#include <Adafruit_MCP23X17.h>\nAdafruit_MCP23X17 mcp;\nvoid setup(){ mcp.pinMode(7, OUTPUT); exp->digitalWrite(8, HIGH); }", "esp32"), [])
})

// ── 5. Falsos negativos de la flash ──────────────────────────────────────────

test("constructores de librerías con un pin de la flash bloquean", () => {
  const casos = [
    "#include <LiquidCrystal.h>\nLiquidCrystal lcd(12, 11, 5, 4, 3, 2);",
    "#include <Stepper.h>\nStepper motor(2048, 8, 10, 9, 11);",
    "#include <Adafruit_NeoPixel.h>\nAdafruit_NeoPixel tira(16, 7, NEO_GRB + NEO_KHZ800);",
    "#include <Adafruit_NeoPixel.h>\nAdafruit_NeoPixel tira = Adafruit_NeoPixel(16, 7, NEO_GRB);",
    "#include <DHT.h>\nDHT dht(7, DHT22);",
    "#include <OneWire.h>\nOneWire bus(7);",
    "#include <Servo.h>\nServo garra;\nvoid setup(){ garra.attach(7); }",
    "#include <FastLED.h>\nCRGB leds[8];\nvoid setup(){ FastLED.addLeds<WS2812, 7, GRB>(leds, 8); }",
    "#include <NewPing.h>\nNewPing sonar(7, 4, 200);",
  ]
  for (const src of casos) assert.ok(niveles(mod.analizarPines(src, "esp32")).includes("bloqueo"), `no bloqueó:\n${src}`)
  // El primer argumento del Stepper son los pasos, no un pin.
  assert.doesNotMatch(textos(mod.analizarPines("#include <Stepper.h>\nStepper motor(9, 4, 5, 18, 19);", "esp32")), /GPIO9/)
})

test("Serial1.begin sin pines en ESP32 bloquea (RX1/TX1 de fábrica son 9 y 10); con pines, se miran esos", () => {
  const sinPines = mod.analizarPines("void setup(){ Serial1.begin(9600); }", "esp32")
  assert.deepEqual(niveles(sinPines), ["bloqueo"])
  assert.match(textos(sinPines), /Serial1\.begin sin pines \(o con RX y TX en -1\) usa GPIO9 y GPIO10/)
  assert.deepEqual(mod.analizarPines("void setup(){ Serial1.begin(9600, SERIAL_8N1, 16, 17); }", "esp32"), [])
  assert.deepEqual(niveles(mod.analizarPines("void setup(){ Serial1.begin(9600, SERIAL_8N1, 7, 17); }", "esp32")), ["bloqueo"])
  assert.deepEqual(mod.analizarPines("void setup(){ Serial2.begin(9600); }", "esp32"), [], "Serial2 de fábrica usa 16/17")
  assert.equal(niveles(mod.analizarPines("#ifdef DEBUG\nvoid setup(){ Serial1.begin(9600); }\n#endif", "esp32"))[0], "aviso")
})

test("const int a = 4, b = 7; resuelve los dos", () => {
  assert.deepEqual(niveles(mod.analizarPines("const int a = 4, b = 7;\nvoid setup(){ pinMode(b, OUTPUT); }", "esp32")), ["bloqueo"])
  assert.deepEqual(mod.analizarPines("const int a = 4, b = 7;\nvoid setup(){ pinMode(a, OUTPUT); }", "esp32"), [])
  assert.deepEqual(niveles(mod.analizarPines("int x = digitalRead(4), MOTOR = 7;\nvoid setup(){ pinMode(MOTOR, OUTPUT); }", "esp32")), ["bloqueo"])
})

test("un parámetro que se llama como una global la tapa SOLO adentro de su función", () => {
  const src = "const int ledPin = 7;\nvoid parpadear(int ledPin){ digitalWrite(ledPin, HIGH); }\nvoid setup(){ pinMode(ledPin, OUTPUT); parpadear(ledPin); }"
  assert.deepEqual(niveles(mod.analizarPines(src, "esp32")), ["bloqueo"], "afuera de la función la global vale 7")
  // Y adentro no se inventa nada: el pin real está en la llamada.
  assert.deepEqual(mod.huellaDelCodigo(src.replace("= 7", "= 4"), "esp32dev").huella.entradas, ["pin:4:OUTPUT"])
})

test("GPIO_NUM_7, ledcAttachPin(7) y tone(7) cuentan aunque no haya pinMode", () => {
  for (const src of ["void setup(){ pinMode(GPIO_NUM_7, OUTPUT); }", "void setup(){ ledcAttachPin(7, 0); }", "void setup(){ ledcAttach(7, 5000, 8); }", "void loop(){ tone(7, 440); }"]) {
    assert.deepEqual(niveles(mod.analizarPines(src, "esp32")), ["bloqueo"], src)
  }
  assert.deepEqual(mod.huellaDelCodigo("void setup(){ ledcAttachPin(25, 0); }", "esp32dev").huella.entradas, ["pin:25:PWM"])
  assert.deepEqual(mod.huellaDelCodigo("void loop(){ tone(25, 440); }", "esp32dev").huella.entradas, ["pin:25:OUTPUT"])
})

// ── 6. Qué placa ────────────────────────────────────────────────────────────

test("placasElegidas(): default_envs, [env] común pisado por el env, varios envs, y el environment pedido", () => {
  const varios = "[platformio]\ndefault_envs = esp\n[env]\nboard = uno\n[env:esp]\nboard = esp32dev\n[env:clase]\n[env:nano]\nboard = nanoatmega328\n"
  assert.deepEqual(mod.placasElegidas(varios), ["esp32dev"], "default_envs manda")
  assert.deepEqual(mod.placasElegidas(varios, "clase"), ["uno"], "un env sin board toma el de [env]")
  assert.deepEqual(mod.placasElegidas(varios, "nano"), ["nanoatmega328"])
  assert.deepEqual(mod.placasElegidas(varios.replace("default_envs = esp\n", "")), ["esp32dev", "uno", "nanoatmega328"], "sin elegir, son todos")
  assert.deepEqual(mod.placasElegidas("[platformio]\ndefault_envs =\n    b\n[env:a]\nboard = uno\n[env:b]\nboard = esp32dev\n"), ["esp32dev"], "default_envs en varias líneas")
})

test("sin env elegido y con varias placas, se analiza cada una y se juntan los avisos", async () => {
  const ini = "[env:uno]\nboard = uno\n[env:esp32dev]\nboard = esp32dev\n"
  const dir = proyectoCon({ "src/main.cpp": "void setup(){ pinMode(7, OUTPUT); }" }, ini)
  const a = mod.analizarProyecto(dir)
  assert.deepEqual(niveles(a.hallazgos), ["bloqueo"], "el bloqueo de la placa ESP32 se perdió")
  assert.equal(a.huella.placa, "esp32dev+uno")
  // Pidiendo el env del UNO, no hay bloqueo de ESP32.
  assert.deepEqual(mod.analizarProyecto(dir, "uno").hallazgos, [])
  // Y con default_envs apuntando al ESP32 aunque el primer env sea el UNO, bloquea.
  const dir2 = proyectoCon({ "src/main.cpp": "void setup(){ pinMode(7, OUTPUT); }" }, "[platformio]\ndefault_envs = esp32dev\n\n" + ini)
  assert.match(await ejecutar({ action: "flash", project_path: dir2 }), /NO CARGUÉ NADA/)
})

// ── 8. LED de la placa y relés ───────────────────────────────────────────────

test("el pin 13 con otro nombre (LAMPARA) SÍ pide checklist; con un nombre de LED o un número, no", () => {
  assert.deepEqual(mod.huellaDelCodigo("const int LAMPARA = 13;\nvoid setup(){ pinMode(LAMPARA, OUTPUT); }", "uno").huella.entradas, ["pin:13:OUTPUT"])
  assert.deepEqual(mod.huellaDelCodigo("const int ledVerde = 13;\nvoid setup(){ pinMode(ledVerde, OUTPUT); }", "uno").huella.entradas, [])
  assert.deepEqual(mod.huellaDelCodigo("void setup(){ pinMode(13, OUTPUT); }", "uno").huella.entradas, [])
  // Un relé con "led" en el nombre (el LED indicador del módulo) sigue siendo un relé.
  assert.deepEqual(mod.huellaDelCodigo("const int LED_RELE = 13;\nvoid setup(){ pinMode(LED_RELE, OUTPUT); }", "uno").huella.entradas, ["pin:13:OUTPUT:rele"])
  assert.deepEqual(mod.huellaDelCodigo("const int LED_ROJO = 18;\nvoid setup(){ pinMode(LED_ROJO, OUTPUT); }", "esp32dev").huella.entradas, ["pin:18:OUTPUT"], "un LED externo en otro pin sí cuenta")
})

test("relé por palabras: pinRele, RELAY_1 y #define RELE sí; RELEASE e irrelevante no", () => {
  const rele = (src) => mod.huellaDelCodigo(src, "esp32dev").rasgos.rele
  assert.equal(rele("const int pinRele = 26;\nvoid setup(){ pinMode(pinRele, OUTPUT); }"), true)
  assert.equal(rele("const int RELAY_1 = 26;\nvoid setup(){ pinMode(RELAY_1, OUTPUT); }"), true)
  assert.equal(rele("#define RELE 4\nvoid setup(){}"), true)
  assert.equal(rele("const int RELEASE_MS = 26;\nvoid setup(){ pinMode(RELEASE_MS, OUTPUT); }"), false)
  assert.equal(rele("const int irrelevante = 26;\nvoid setup(){ pinMode(irrelevante, OUTPUT); }"), false)
  assert.equal(rele("// #define RELE 4\nvoid setup(){}"), false, "un relé comentado no es un relé")
  assert.deepEqual(mod.skillsParaRasgos(mod.huellaDelCodigo("#define RELE 4\nvoid setup(){ pinMode(RELE, OUTPUT); }", "esp32dev").rasgos), ["actuadores", "checklist-seguridad"])
})

// ── 9. Por placa, no solo por proyecto ───────────────────────────────────────

test("cargar el mismo proyecto en OTRA placa (otro número de serie) pide el checklist; el estado guarda solo hashes", async () => {
  escenario({ placas: [CP2102_A] })
  const dir = proyecto("esp32dev", CON_BUZZER)
  const r1 = await ejecutar({ action: "flash", project_path: dir })
  await ejecutar({ action: "flash", project_path: dir, checklist: codigoDe(r1) })
  const crudo = readFileSync(estadoDe(dir), "utf8")
  const estado = JSON.parse(crudo)
  assert.deepEqual(Object.keys(estado).sort(), ["entradas", "marcaSal", "placa", "placaFisica", "version"])
  for (const prohibido of [dir, "ttyUSB0", "10C4", "0001", "esp32dev", "pin:"]) assert.ok(!crudo.includes(prohibido), `el estado guarda "${prohibido}" en claro`)

  escenario({ placas: [CP2102_B] })
  spawns = []
  const r2 = await ejecutar({ action: "flash", project_path: dir })
  assert.match(r2, /No cargué: elegiste Reject[\s\S]*OTRA placa/)
  assert.ok(!cargo())
  // I5: lo aprobado "siempre" para el circuito no vale para esta placa: otro código.
  const deCircuito = pedidos.find((p) => p.patterns[0].startsWith("cambio "))
  const dePlaca = pedidos[pedidos.length - 1]
  assert.match(dePlaca.permission, /^¿Revisaste el circuito\? Otra placa u otro proyecto en esta placa$/)
  assert.match(dePlaca.patterns[0], /^placa [0-9a-f]{6}$/)
  assert.notEqual(dePlaca.patterns[0], deCircuito.patterns[0])
  assert.match(await ejecutar({ action: "flash", project_path: dir, checklist: "si" }), /Codigo cargado exitosamente en \/dev\/ttyUSB1/)
})

test("cambiar el cable de zócalo USB NO pide el checklist: la identidad no sale del puerto ni de LOCATION", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  await ejecutar({ action: "flash", project_path: dir, checklist: codigoDe(await ejecutar({ action: "flash", project_path: dir })) })
  escenario({ placas: [{ ...CH340, port: "/dev/ttyUSB3", hwid: "USB VID:PID=1A86:7523 LOCATION=1-4" }] })
  spawns = []
  assert.match(await ejecutar({ action: "flash", project_path: dir }), /Codigo cargado exitosamente en \/dev\/ttyUSB3/)
  // Con número de serie, tampoco.
  escenario({ placas: [CP2102_A] })
  await ejecutar({ action: "flash", project_path: dir, checklist: codigoDe(await ejecutar({ action: "flash", project_path: dir })) })
  escenario({ placas: [{ ...CP2102_A, port: "/dev/ttyUSB5", hwid: "USB VID:PID=10C4:EA60 SER=0001 LOCATION=3-1" }] })
  assert.match(await ejecutar({ action: "flash", project_path: dir }), /Codigo cargado exitosamente en \/dev\/ttyUSB5/)
})

test("identidadDePlaca(): VID:PID y SER, en los dos formatos; el serie que inventa Windows (con &) no cuenta", () => {
  assert.deepEqual(mod.identidadDePlaca("USB VID:PID=10C4:EA60 SER=0001 LOCATION=1-1"), { modelo: "10C4:EA60", serie: "0001" })
  assert.deepEqual(mod.identidadDePlaca("USB VID:PID=1A86:7523 LOCATION=1-1"), { modelo: "1A86:7523", serie: null })
  assert.deepEqual(mod.identidadDePlaca("USB\\VID_2341&PID_0043\\85735313233351D0E1F1"), { modelo: "2341:0043", serie: "85735313233351D0E1F1" })
  assert.deepEqual(mod.identidadDePlaca("USB\\VID_1A86&PID_7523\\5&1D2A3B4C&0&2"), { modelo: "1A86:7523", serie: null })
  assert.equal(mod.identidadDePlaca("ACPI\\PNP0501\\1"), null)
  assert.equal(mod.identidadDePlaca(undefined), null)
})

test("both también frena si el proyecto va a otra placa", async () => {
  escenario({ placas: [CP2102_A] })
  const dir = proyecto("esp32dev", CON_BUZZER)
  await ejecutar({ action: "both", project_path: dir, checklist: codigoDe(await ejecutar({ action: "both", project_path: dir })) })
  escenario({ placas: [CP2102_B] })
  spawns = []
  const r = await ejecutar({ action: "both", project_path: dir })
  assert.match(r, /La compilacion fue bien\. No cargué: elegiste Reject[\s\S]*OTRA placa/)
  assert.ok(!cargo())
})

test("si en esa placa (con número de serie) lo último que se cargó fue OTRO proyecto, pide el checklist (después de buscar la placa)", async () => {
  escenario({ placas: [CP2102_A] })
  const a = proyecto("esp32dev", CON_BUZZER)
  const b = proyecto("esp32dev", "const int MOTOR = 26;\nvoid setup(){ pinMode(MOTOR, OUTPUT); }")
  await ejecutar({ action: "flash", project_path: a, checklist: codigoDe(await ejecutar({ action: "flash", project_path: a })) })
  await ejecutar({ action: "flash", project_path: b, checklist: codigoDe(await ejecutar({ action: "flash", project_path: b })) })
  spawns = []
  const r = await ejecutar({ action: "flash", project_path: a })
  assert.match(r, /OTRO proyecto/)
  assert.ok(buscoPlaca(), "este freno necesita el puerto: va después de buscar la placa")
  assert.ok(!cargo())
  // El registro de la compu guarda hashes: ni la ruta ni el hwid quedan legibles.
  const global = readFileSync(join(process.env.XDG_CONFIG_HOME, "opencode", "tecnia-cargas.json"), "utf8")
  assert.ok(!global.includes(a) && !global.includes("10C4") && !global.includes("0001"), global)
  assert.match(JSON.parse(global).sal, /^[0-9a-f]{32}$/, "la sal es aleatoria y vive en el mismo archivo")
})

test("sin número de serie, 'otro proyecto en una placa de este modelo' es un AVISO, no un freno", async () => {
  const a = proyecto("esp32dev", CON_BUZZER)
  const b = proyecto("esp32dev", "const int MOTOR = 26;\nvoid setup(){ pinMode(MOTOR, OUTPUT); }")
  await ejecutar({ action: "flash", project_path: a, checklist: codigoDe(await ejecutar({ action: "flash", project_path: a })) })
  await ejecutar({ action: "flash", project_path: b, checklist: codigoDe(await ejecutar({ action: "flash", project_path: b })) })
  spawns = []
  const r = await ejecutar({ action: "flash", project_path: a })
  assert.match(r, /Codigo cargado exitosamente/)
  assert.match(r, /Ojo: en una placa de este modelo lo último que se cargó fue OTRO proyecto/)
  assert.ok(cargo())
})

test("both: estado SOLO tras una carga con código 0, y los avisos llegan después de cargar", async () => {
  const dir = proyecto("esp32dev", "const int SALIDA = 34;\nvoid setup(){ pinMode(SALIDA, OUTPUT); }")
  const codigo = codigoDe(await ejecutar({ action: "both", project_path: dir }))
  escenario({ upload: { code: 1, stderr: "A fatal error occurred: Failed to connect to ESP32\n" } })
  assert.match(await ejecutar({ action: "both", project_path: dir, checklist: codigo }), /error al cargar/)
  assert.ok(!existsSync(estadoDe(dir)), "both guardó el estado de una carga que falló")
  escenario()
  const r = await ejecutar({ action: "both", project_path: dir, checklist: codigo })
  assert.match(r, /Compilacion y carga exitosa/)
  assert.match(r, /Contale al docente estos pines:[\s\S]*GPIO34 es SOLO ENTRADA/)
  assert.ok(existsSync(estadoDe(dir)))
})

test("el código del checklist se acepta con espacios alrededor", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  const codigo = codigoDe(await ejecutar({ action: "flash", project_path: dir }))
  assert.match(await ejecutar({ action: "flash", project_path: dir, checklist: `  ${codigo} ` }), /Codigo cargado exitosamente/)
})

// ── 10. Lo que confundía al analizador ───────────────────────────────────────

test("textos crudos R\"(...)\", separadores 1'000, \"/*.txt\" y \"http://\" no rompen la limpieza", () => {
  const html = 'const char pagina[] PROGMEM = R"rawliteral(\n<p>pinMode(7, OUTPUT) it\'s "x"</p>\n)rawliteral";\nvoid setup(){ pinMode(4, OUTPUT); }'
  assert.deepEqual(mod.analizarPines(html, "esp32"), [], "leyó un pinMode adentro del HTML")
  assert.deepEqual(niveles(mod.analizarPines(html.replace("pinMode(4", "pinMode(7"), "esp32")), ["bloqueo"], "el texto crudo se comió el código de después")
  assert.deepEqual(niveles(mod.analizarPines("void setup(){ long x = 1'000; pinMode(7, OUTPUT); }", "esp32")), ["bloqueo"], "el separador abrió un carácter y se comió la línea")
  // Y al revés: `case'a'` es un carácter, aunque la palabra de antes termine en una letra hexadecimal.
  assert.deepEqual(niveles(mod.analizarPines("void loop(){ switch (c) { case'a': pinMode(7, OUTPUT); } }", "esp32")), ["bloqueo"])
  assert.deepEqual(mod.huellaDelCodigo('const char* g = "/*.txt";\n#include <Servo.h>\nServo s;\nvoid setup(){ s.attach(4); }', "esp32dev").huella.entradas, ["lib:Servo", "pin:4:SERVO"])
  assert.deepEqual(niveles(mod.analizarPines('const char* u = "http://x";\n#include <Servo.h>\nServo s;\nvoid setup(){ s.attach(34); }', "esp32")), ["aviso"])
  assert.match(mod.limpiarCodigo('char* u = "http://x"; int a;', false), /int a;/)
})

test("Serial.begin y WiFi adentro de un texto no disparan avisos", () => {
  assert.deepEqual(mod.analizarPines('const char* s = "Serial.begin(9600)";\nvoid setup(){ pinMode(1, OUTPUT); }', "uno"), [])
  assert.deepEqual(mod.analizarPines('const char* s = "WiFi.begin";\nvoid loop(){ analogRead(25); }', "esp32"), [])
})

test("Ticker.attach(7) no es un servo (no hay `Servo` declarado)", () => {
  assert.deepEqual(mod.analizarPines("#include <Ticker.h>\n#include <Servo.h>\nTicker t;\nServo s;\nvoid setup(){ t.attach(7, cb); s.attach(4); }", "esp32"), [])
})

// ── 11. Placas fuera del catálogo ───────────────────────────────────────────

test("placa fuera del catálogo: no pide checklist por el LED (por nombre), sí por otro hardware", () => {
  const blink = readFileSync(join(REPO, "ejemplos", "blink-esp32", "src", "main.cpp"), "utf8")
  assert.deepEqual(mod.huellaDelCodigo(blink, "esp32-c3-devkitm-1").huella.entradas, [])
  assert.deepEqual(mod.huellaDelCodigo("void setup(){ pinMode(LED_BUILTIN, OUTPUT); }", "esp32-c3-devkitm-1").huella.entradas, [])
  assert.deepEqual(mod.huellaDelCodigo("const int MOTOR = 5;\nvoid setup(){ pinMode(MOTOR, OUTPUT); }", "esp32-c3-devkitm-1").huella.entradas, ["pin:5:OUTPUT"])
  assert.deepEqual(mod.analizarPines("void setup(){ pinMode(7, OUTPUT); }", null), [])
})

// ── 12. Los mutantes que sobrevivieron ───────────────────────────────────────

test("textos: las comillas escapadas no cierran el texto, y un texto sin cerrar termina en la línea", () => {
  assert.deepEqual(mod.analizarPines('const char* s = "a\\"pinMode(7, OUTPUT)\\"";\nvoid setup(){}', "esp32"), [])
  assert.deepEqual(niveles(mod.analizarPines('const char* s = "sin cerrar\nvoid setup(){ pinMode(7, OUTPUT); }', "esp32")), ["bloqueo"])
})

test("resolución: #define gana, += reasigna, == no, y una variable declarada dos veces no se resuelve", () => {
  assert.deepEqual(niveles(mod.analizarPines("#define MOTOR 7\nconst int MOTOR = 4;\nvoid setup(){ pinMode(MOTOR, OUTPUT); }", "esp32")), ["bloqueo"])
  assert.deepEqual(mod.analizarPines("int pin = 7;\nvoid setup(){ pin += 1; pinMode(pin, OUTPUT); }", "esp32"), [])
  assert.deepEqual(niveles(mod.analizarPines("int pin = 7;\nvoid setup(){ if (pin == 4) {} pinMode(pin, OUTPUT); }", "esp32")), ["bloqueo"])
  assert.deepEqual(mod.analizarPines("int pin = 7;\nvoid setup(){ int pin = 4; pinMode(pin, OUTPUT); }", "esp32"), [])
  assert.deepEqual(mod.analizarPines("int pin = 7;\nint* p = &pin;\nvoid setup(){ *p = 4; pinMode(pin, OUTPUT); }", "esp32"), [], "escrita por puntero")
})

test("compile: el recordatorio sale con un cambio de placa, y no sale sin hardware", async () => {
  const dir = proyecto("esp32dev", "#include <DHT.h>\nDHT dht(4, DHT22);\nvoid setup(){ dht.begin(); }")
  await ejecutar({ action: "flash", project_path: dir, checklist: codigoDe(await ejecutar({ action: "flash", project_path: dir })) })
  assert.doesNotMatch(await ejecutar({ action: "compile", project_path: dir }), /Recordatorio/)
  writeFileSync(join(dir, "platformio.ini"), "[env:uno]\nboard = uno\n")
  assert.match(await ejecutar({ action: "compile", project_path: dir }), /Recordatorio/, "otra placa con las mismas entradas es un cambio")
  // WiFi solo, sin pines ni carga previa: no hay circuito que cambió.
  const wifi = proyecto("esp32dev", '#include <WiFi.h>\nvoid setup(){ WiFi.begin("a", "b"); }')
  assert.doesNotMatch(await ejecutar({ action: "compile", project_path: wifi }), /Recordatorio/)
})

test("huella: el pinMode manda sobre digitalWrite/digitalRead del mismo pin", () => {
  assert.deepEqual(mod.huellaDelCodigo("void setup(){ pinMode(4, INPUT); }\nvoid loop(){ digitalWrite(4, HIGH); }", "esp32dev").huella.entradas, ["pin:4:INPUT"])
  assert.deepEqual(mod.huellaDelCodigo("void loop(){ digitalWrite(4, HIGH); digitalRead(4); }", "esp32dev").huella.entradas, ["pin:4:INPUT", "pin:4:OUTPUT"])
})

test("un #include comentado no cuenta como librería", () => {
  assert.deepEqual(mod.huellaDelCodigo("// #include <DHT.h>\n/* #include <Servo.h> */\nvoid setup(){}", "esp32dev").huella.entradas, [])
})

test("GPIO3 es RX y GPIO1 es TX", () => {
  assert.match(textos(mod.analizarPines("void setup(){ pinMode(3, INPUT); }", "esp32")), /GPIO3 es RX/)
})

test("los hallazgos salen ordenados (bloqueo, aviso, nota) y sin repetirse", () => {
  const src = "void setup(){ pinMode(2, INPUT); pinMode(34, OUTPUT); pinMode(7, OUTPUT); digitalWrite(7, HIGH); }"
  assert.deepEqual(niveles(mod.analizarPines(src, "esp32")), ["bloqueo", "aviso", "nota"])
})

test("GPIO_NUM_7 resuelve, y analogRead(A0) con WiFi es GPIO36 (ADC1) pero A14 es GPIO13 (ADC2)", () => {
  assert.deepEqual(mod.usosDePines("void setup(){ pinMode(GPIO_NUM_7, OUTPUT); }", "esp32")[0].pines, [7])
  assert.deepEqual(mod.analizarPines("#include <WiFi.h>\nvoid loop(){ analogRead(A0); }", "esp32"), [])
  assert.match(textos(mod.analizarPines("#include <WiFi.h>\nvoid loop(){ analogRead(A14); }", "esp32")), /GPIO13 es del ADC2/)
})

test("macros: el cuerpo de un #define sin parámetros es un uso; el de uno con parámetros no", () => {
  assert.deepEqual(niveles(mod.analizarPines("#define INIT pinMode(7, OUTPUT)\nvoid setup(){ INIT; }", "esp32")), ["bloqueo"])
  assert.deepEqual(niveles(mod.analizarPines("#define INIT() \\\n  pinMode(7, OUTPUT)\nvoid setup(){ INIT(); }", "esp32")), ["bloqueo"])
  assert.deepEqual(mod.analizarPines("int p = 7;\n#define SALIDA(p) pinMode(p, OUTPUT)\nvoid setup(){ SALIDA(4); }", "esp32"), [])
})

test("con fin de línea de Windows (CRLF) los #define se resuelven igual", () => {
  const src = "#define MOTOR 7\r\n#ifdef DEBUG\r\n#endif\r\nvoid setup(){ pinMode(MOTOR, OUTPUT); }\r\n"
  assert.deepEqual(niveles(mod.analizarPines(src, "esp32")), ["bloqueo"])
})

test("limpiarCodigo() termina siempre: con entradas rotas no se cuelga (en un proceso aparte, con tope de tiempo)", () => {
  // Una mutación del limpiador colgó la suite entera: un bucle infinito no lo
  // corta un timeout de node:test, porque el código es sincrónico. Por eso se
  // corre en un proceso hijo que se mata a los 15 segundos.
  const script = join(OUT, "limpieza-colgada.mjs")
  writeFileSync(
    script,
    [
      "globalThis.Bun = { which: () => null, spawn() {} }",
      `const m = await import(${JSON.stringify(join(OUT, "platformio.ts"))})`,
      `const rotas = ['"sin cerrar', "'", 'R"(sin cerrar', 'R"', 'R"x', "/* sin cerrar", "//", "\\\\", '"\\\\', "1'", "'1", 'u8R"(', "#if\\n#elif\\n#else\\n#endif\\n#endif", "#define X \\\\"]`,
      "for (const r of rotas) { m.limpiarCodigo(r); m.limpiarCodigo(r, false); m.analizarPines(r, 'esp32') }",
      "console.log('termino')",
    ].join("\n"),
  )
  const r = spawnSync(process.execPath, [script], { timeout: 15_000, encoding: "utf8" })
  assert.equal(r.signal, null, "lo tuve que matar: se colgó")
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /termino/)
})

// ═══════════════════════════════════════════════════════════════════════════
// Segunda ronda de revisión (adversarial): casos de rev-p2
// ═══════════════════════════════════════════════════════════════════════════

// ── B1. Un relé donde antes había un LED ─────────────────────────────────────

test("B1: un LED en el 26 cargado, y después RELE_BOMBA en el 26: FRENA (antes se cargaba sin checklist)", async () => {
  const dir = proyecto("esp32dev", "const int LED = 26;\nvoid setup(){ pinMode(LED, OUTPUT); }\nvoid loop(){ digitalWrite(LED, HIGH); }")
  await ejecutar({ action: "flash", project_path: dir, checklist: codigoDe(await ejecutar({ action: "flash", project_path: dir })) })
  reescribir(dir, "// ahora maneja la bomba con un relé\nconst int RELE_BOMBA = 26;\nvoid setup(){ pinMode(RELE_BOMBA, OUTPUT); }\nvoid loop(){ digitalWrite(RELE_BOMBA, HIGH); }")
  spawns = []
  const r = await ejecutar({ action: "both", project_path: dir })
  assert.match(r, /No cargué: elegiste Reject[\s\S]*Lo nuevo: GPIO26 como salida \(un relé\)/)
  assert.ok(!cargo())
})

// ── B2. Ediciones que no tocan el circuito ───────────────────────────────────

test("B2: agregar otro for (int i = 0…) en otra función no cambia la huella ni el código", () => {
  const base = "const int N = 4;\nvoid setup(){ for (int i = 2; i < 2 + N; i++) pinMode(i, OUTPUT); }\nvoid loop(){ for (int i = 2; i < 2 + N; i++) digitalWrite(i, HIGH); }"
  const mas = base + "\nvoid parpadeo(){ for (int i = 0; i < 3; i++) { Serial.println(i); } }\nvoid otra(){ for (int i = 0; i < 10; i++) { Serial.println(i); } }"
  const a = mod.huellaDelCodigo(base, "uno").huella
  assert.deepEqual(a.entradas, ["pin:2:OUTPUT", "pin:3:OUTPUT", "pin:4:OUTPUT", "pin:5:OUTPUT"], "el for con límites conocidos recorre pines concretos")
  assert.equal(mod.codigoChecklist(mod.huellaDelCodigo(mas, "uno").huella), mod.codigoChecklist(a))
  // Un for cuyos límites no se saben entra con su valor inicial (lo que se sabe).
  const raro = mod.huellaDelCodigo("void setup(){ for (int i = 2; i < cuantos(); i++) pinMode(i, OUTPUT); }", "uno").huella
  assert.deepEqual(raro.entradas, ["pin:i{i=2}:OUTPUT"])
  // Una variable que cambia sola: cambiar un delay no cambia nada.
  const rt = "int ledActual = 4;\nvoid setup(){ pinMode(4, OUTPUT); pinMode(5, OUTPUT); }\nvoid loop(){ digitalWrite(ledActual, HIGH); delay(500); ledActual = (ledActual == 4) ? 5 : 4; }"
  assert.deepEqual(mod.altasNuevas(mod.huellaDelCodigo(rt.replace("500", "250"), "esp32dev").huella, mod.huellaDelCodigo(rt, "esp32dev").huella), [])
})

test("B2: el for con límites conocidos resuelve sus pines (y bloquea si son de la flash)", () => {
  assert.deepEqual(niveles(mod.analizarPines("void setup(){ for (int p = 6; p < 12; p++) pinMode(p, OUTPUT); }", "esp32")).filter((n) => n === "bloqueo").length, 6)
  assert.deepEqual(mod.huellaDelCodigo("void setup(){ for (int pin = 2; pin <= 4; pin++) pinMode(pin, OUTPUT); }", "uno").huella.entradas, ["pin:2:OUTPUT", "pin:3:OUTPUT", "pin:4:OUTPUT"])
})

// ── I2. Falsos bloqueos sin salida ───────────────────────────────────────────

test("I2: un parámetro con valor por defecto y un miembro de clase no se resuelven con el default", () => {
  const usuario = "void prender(int pin = 7);\nclass Luz { public: Luz(int p): pin(p) {} void on(){ digitalWrite(pin, HIGH); } int pin; };\nLuz luz(25);\nvoid setup(){ pinMode(25, OUTPUT); }\nvoid loop(){ luz.on(); }\nvoid prender(int pin){ digitalWrite(pin, HIGH); }"
  assert.deepEqual(mod.analizarPines(usuario, "esp32"), [])
  const dir = proyectoCon({
    "src/main.cpp": "#include <Zumbador.h>\nZumbador z(25);\nvoid setup(){ z.begin(); }\nvoid loop(){}",
    "lib/Zumbador/src/Zumbador.h": "#pragma once\nclass Zumbador {\npublic:\n  Zumbador(uint8_t pin = 8);\n  void begin();\nprivate:\n  uint8_t pin;\n};\n",
    "lib/Zumbador/src/Zumbador.cpp": '#include "Zumbador.h"\nZumbador::Zumbador(uint8_t p) : pin(p) {}\nvoid Zumbador::begin(){ pinMode(pin, OUTPUT); }\n',
  })
  const a = mod.analizarProyecto(dir)
  assert.deepEqual(a.hallazgos, [], "el default 8 de la librería bloqueaba la carga sin salida")
  // La librería es PROPIA: el pin del objeto se resuelve por el constructor, `Zumbador z(25)`.
  assert.deepEqual(a.huella.entradas, ["pin:25:OUTPUT"])
})

test("I2: #ifndef con valor por defecto no es un include guard; build_flags -D manda", () => {
  assert.deepEqual(niveles(mod.analizarPines("#ifndef LED_PIN\n#define LED_PIN 8\n#endif\nvoid setup(){ pinMode(LED_PIN, OUTPUT); }", "esp32")), ["bloqueo"], "sin flags, el default vale")
  const dir = proyectoCon(
    { "src/main.cpp": "#include <Tira.h>\nvoid setup(){ tiraBegin(); }", "lib/Tira/src/Tira.h": "#pragma once\n#ifndef TIRA_PIN\n#define TIRA_PIN 6\n#endif\ninline void tiraBegin(){ pinMode(TIRA_PIN, OUTPUT); }" },
    "[env:esp32dev]\nboard = esp32dev\nbuild_flags = -DTIRA_PIN=4 -D OTRA\n",
  )
  const a = mod.analizarProyecto(dir)
  assert.deepEqual(a.hallazgos, [], "build_flags -DTIRA_PIN=4 no se leyó: bloqueó por el default 6")
  assert.deepEqual(a.huella.entradas, ["pin:4:OUTPUT"])
  assert.deepEqual([...mod.entornosElegidos("[env]\nbuild_flags = -DA=1\n[env:x]\nboard = uno\nbuild_flags = ${env.build_flags} -DB=\"2\"\n")[0].flags], [["A", "1"], ["B", "2"]])
})

test("I2: Serial1 con 3 argumentos o con setPins no bloquea; un -1 explícito sí", () => {
  assert.deepEqual(mod.analizarPines("void setup(){ Serial1.begin(9600, SERIAL_8N1, 16); }", "esp32"), [])
  assert.deepEqual(mod.analizarPines("void setup(){ Serial1.setPins(16, 17); Serial1.begin(9600); }", "esp32"), [])
  // I-1: los pines de fábrica se usan SOLO si RX y TX son negativos; un -1 solo deja ese pin sin conectar.
  assert.deepEqual(mod.analizarPines("void setup(){ Serial1.begin(9600, SERIAL_8N1, -1, 17); }", "esp32"), [])
  assert.deepEqual(mod.analizarPines("void setup(){ Serial1.begin(9600, SERIAL_8N1, 16, -1); }", "esp32"), [])
  const ambos = mod.analizarPines("void setup(){ Serial1.begin(9600, SERIAL_8N1, -1, -1); }", "esp32")
  assert.deepEqual(niveles(ambos), ["bloqueo"])
  assert.match(textos(ambos), /RX y TX en -1/)
  assert.deepEqual(niveles(mod.analizarPines("void setup(){ Serial1.begin(9600, SERIAL_8N1, -1); }", "esp32")), ["bloqueo"])
  // I-2: setPins vale solo ANTES del begin y en la misma función.
  assert.deepEqual(niveles(mod.analizarPines("void setup(){ Serial1.begin(9600); Serial1.setPins(16, 17); }", "esp32")), ["bloqueo"])
  assert.deepEqual(niveles(mod.analizarPines("void setup(){ Serial1.begin(9600); }\nvoid nunca(){ Serial1.setPins(16, 17); }", "esp32")), ["bloqueo"])
  assert.deepEqual(niveles(mod.analizarPines("void setup(){ Serial1.setPins(7, 17); }", "esp32")), ["bloqueo"], "los pines de setPins se miran")
})

// ── I3. Fallas abiertas ──────────────────────────────────────────────────────

test("I3: los literales que se le pasan a una función propia o a una macro con parámetros cuentan", () => {
  const helper = "void configurarSalida(int pin){ pinMode(pin, OUTPUT); digitalWrite(pin, LOW); }\nvoid setup(){ configurarSalida(26); configurarSalida(7); }"
  assert.deepEqual(niveles(mod.analizarPines(helper, "esp32")), ["bloqueo"])
  assert.deepEqual(mod.huellaDelCodigo(helper, "esp32dev").huella.entradas, ["pin:26:OUTPUT", "pin:7:OUTPUT"])
  const macro = "#define SALIDA(p) pinMode(p, OUTPUT)\nvoid setup(){ SALIDA(26); SALIDA(8); }"
  assert.deepEqual(niveles(mod.analizarPines(macro, "esp32")), ["bloqueo"])
  assert.deepEqual(mod.huellaDelCodigo(macro, "esp32dev").huella.entradas, ["pin:26:OUTPUT", "pin:8:OUTPUT"])
  // Un nivel más: la función que llama a la función.
  const doble = "void salida(int p){ pinMode(p, OUTPUT); }\nvoid motor(int m){ salida(m); }\nvoid setup(){ motor(9); }"
  assert.deepEqual(niveles(mod.analizarPines(doble, "esp32")), ["bloqueo"])
})

test("I3: una carpeta-link en lib/ y lo que pasa la profundidad máxima dejan el análisis incompleto", () => {
  const afuera = join(OUT, `compartida-${++nProyecto}`)
  mkdirSync(join(afuera, "Mio"), { recursive: true })
  writeFileSync(join(afuera, "Mio", "Mio.h"), "inline void mioBegin(){ pinMode(8, OUTPUT); }")
  const dir = proyectoCon({ "src/main.cpp": "#include <Mio.h>\nvoid setup(){ mioBegin(); }" })
  mkdirSync(join(dir, "lib"))
  symlinkSync(join(afuera, "Mio"), join(dir, "lib", "Mio"))
  assert.deepEqual(mod.analizarProyecto(dir).incompleto, ["lib/Mio (link a una carpeta)"])
  const hondo = proyectoCon({ "src/main.cpp": "void setup(){}", "lib/A/src/b/c/d/e/f/g/h/i/x.cpp": "void g(){ pinMode(4, OUTPUT); }" })
  assert.match(mod.analizarProyecto(hondo).incompleto.join(), /demasiado profundo/)
})

test("I3: extensiones .cc, .cxx, .hh y archivos UTF-16 se leen", () => {
  for (const ext of ["cc", "cxx", "hh", "hxx", "pde"]) {
    const dir = proyectoCon({ [`src/main.${ext}`]: "void setup(){ pinMode(7, OUTPUT); }" })
    assert.deepEqual(niveles(mod.analizarProyecto(dir)?.hallazgos ?? []), ["bloqueo"], `.${ext} no se leyó`)
  }
  const u16 = proyectoCon({})
  mkdirSync(join(u16, "src"))
  writeFileSync(join(u16, "src", "main.cpp"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("void setup(){ pinMode(7, OUTPUT); }\n", "utf16le")]))
  assert.deepEqual(niveles(mod.analizarProyecto(u16).hallazgos), ["bloqueo"])
})

// ── I4. Macros de placa ──────────────────────────────────────────────────────

test("I4: el blink multiplaca cae en la rama de su placa y no pide checklist en ESP32", () => {
  const multi = "#if defined(ESP8266)\n#define LED_PIN D4\n#elif defined(ESP32)\n#define LED_PIN 2\n#else\n#define LED_PIN 13\n#endif\nvoid setup(){ pinMode(LED_PIN, OUTPUT); }\nvoid loop(){ digitalWrite(LED_PIN, HIGH); }"
  assert.deepEqual(mod.huellaDelCodigo(multi, "esp32dev").huella.entradas, [])
  assert.deepEqual(mod.huellaDelCodigo(multi, "uno").huella.entradas, [])
  const c = mod.macrosDePlaca("esp32dev")
  assert.equal(mod.evaluarCondicion("defined(ARDUINO) && ARDUINO >= 100", c), true)
  assert.equal(mod.evaluarCondicion("defined(ARDUINO_ARCH_RP2040) || defined(ARDUINO_ARCH_SAMD) || defined(ESP8266)", c), false)
  assert.equal(mod.evaluarCondicion("defined(__AVR_ATtiny85__) && (F_CPU == 16000000)", c), false)
  assert.equal(mod.evaluarCondicion("CONFIG_IDF_TARGET_ESP32", c), true)
  assert.equal(mod.evaluarCondicion("defined(ESP32) || defined(ARDUINO_ARCH_ESP32)", mod.macrosDePlaca("uno")), false)
  assert.equal(mod.evaluarCondicion("defined(__AVR_ATmega328P__) && F_CPU == 16000000", mod.macrosDePlaca("uno")), true)
  assert.equal(mod.evaluarCondicion("defined(__AVR_ATmega2560__)", mod.macrosDePlaca("uno")), false)
  assert.equal(mod.evaluarCondicion("defined(ARDUINO)", mod.macrosDePlaca("esp32-c3-devkitm-1")), true)
  assert.equal(mod.evaluarCondicion("defined(ESP32)", mod.macrosDePlaca("esp32-c3-devkitm-1")), null)
})

// ── Menores ──────────────────────────────────────────────────────────────────

test("build_src_filter: lo excluido con -<…> no se analiza", () => {
  const dir = proyectoCon(
    { "src/main.cpp": "void setup(){ pinMode(4, OUTPUT); }", "src/viejo/main_uno.cpp": "void setup(){ pinMode(7, OUTPUT); }" },
    "[env:esp32dev]\nboard = esp32dev\nbuild_src_filter = +<*> -<viejo/>\n",
  )
  assert.deepEqual(mod.analizarProyecto(dir).hallazgos, [])
  assert.equal(mod.entraPorFiltro("viejo/a.cpp", "+<*> -<viejo/> +<viejo/a.cpp>"), true, "el último que coincide manda")
  assert.equal(mod.entraPorFiltro("x/y.cpp", "-<**/*.cpp>"), false)
})

test("lo interno de una librería (parámetros, miembros) no va a 'Lo nuevo'; un literal de la flash en lib/ sí bloquea", async () => {
  const npH = "#ifndef NP_H\n#define NP_H\nclass Adafruit_NeoPixel { public: Adafruit_NeoPixel(uint16_t n, int16_t pin = 6, int t = 0); void begin(void); void setPin(int16_t p); protected: int16_t pin; };\n#endif\n"
  const npCpp = '#include "Adafruit_NeoPixel.h"\nvoid Adafruit_NeoPixel::begin(void){ if (pin >= 0) { pinMode(pin, OUTPUT); digitalWrite(pin, LOW); } }\nvoid Adafruit_NeoPixel::setPin(int16_t p){ pinMode(pin, INPUT); pin = p; pinMode(p, OUTPUT); }\n'
  const dir = proyectoCon({
    "src/main.cpp": "#include <Adafruit_NeoPixel.h>\n#define PIN 15\nAdafruit_NeoPixel pixels(16, PIN, 0);\nvoid setup(){ pixels.begin(); }",
    "lib/Adafruit_NeoPixel/Adafruit_NeoPixel.h": npH,
    "lib/Adafruit_NeoPixel/Adafruit_NeoPixel.cpp": npCpp,
  })
  const a = mod.analizarProyecto(dir)
  assert.deepEqual(a.hallazgos, [])
  assert.deepEqual(a.huella.entradas, ["lib:NeoPixel", "pin:15:NEOPIXEL"])
  const r = await ejecutar({ action: "flash", project_path: dir })
  assert.match(r, /Lo nuevo: librería NeoPixel, GPIO15 con LEDs NeoPixel\./)
  const conLiteral = proyectoCon({ "src/main.cpp": "void setup(){}", "lib/Mala/mala.cpp": "void m(){ pinMode(9, OUTPUT); }" })
  assert.deepEqual(niveles(mod.analizarProyecto(conLiteral).hallazgos), ["bloqueo"])
})

test("el código del análisis incompleto depende del proyecto y de lo que no se pudo leer", () => {
  const a = mod.codigoChecklist(mod.huellaIncompleta("/tmp/proyecto-a", ["src/x.h"]))
  assert.notEqual(a, mod.codigoChecklist(mod.huellaIncompleta("/tmp/proyecto-b", ["src/x.h"])))
  assert.notEqual(a, mod.codigoChecklist(mod.huellaIncompleta("/tmp/proyecto-a", ["src/y.h"])))
})

test("si no se puede anotar la carga, se avisa", { skip: process.getuid?.() === 0 ? "como root el chmod no impide escribir" : false }, async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  const codigo = codigoDe(await ejecutar({ action: "flash", project_path: dir }))
  mkdirSync(join(dir, ".pio"))
  chmodSync(join(dir, ".pio"), 0o500)
  try {
    const r = await ejecutar({ action: "flash", project_path: dir, checklist: codigo })
    assert.match(r, /Codigo cargado exitosamente/)
    assert.match(r, /no pude anotar esta carga/)
  } finally {
    chmodSync(join(dir, ".pio"), 0o700)
  }
})

test("la ruta del proyecto se normaliza antes del hash (Windows: minúsculas y letra de unidad)", () => {
  assert.equal(mod.rutaNormalizada("C:\\Users\\Ana\\Proyecto"), mod.rutaNormalizada("c:/users/ana/proyecto"))
  assert.equal(mod.rutaNormalizada("C:\\Users\\Ana\\Proyecto"), "c:/users/ana/proyecto")
})

// ── I7 y robustez ────────────────────────────────────────────────────────────

test("I7: una librería de 2 MB en lib/ se analiza rápido (objetivo: menos de 500 ms)", () => {
  let lib = ""
  for (let k = 0; k < 1000; k++) lib += `static void f${k}(u8g2_t *u8g2){ uint8_t v${k} = u8g2->x; uint16_t w${k} = v${k} + 1; u8g2->y = w${k}; }\n`
  const fila = 'const uint8_t u8g2_font_x[] U8G2_FONT_SECTION("u8g2_font_x") = "' + "\\x00abcdefgh".repeat(10) + '";\n'
  lib += fila.repeat(Math.ceil((2000 * 1024) / fila.length))
  const dir = proyectoCon({ "src/main.cpp": "#include <U8g2lib.h>\nvoid setup(){ pinMode(4, OUTPUT); }", "lib/U8g2/src/U8g2lib.h": "#pragma once\nclass U8G2 {};\n", "lib/U8g2/src/clib/u8g2_x.c": lib })
  const t0 = performance.now()
  const a = mod.analizarProyecto(dir)
  const ms = performance.now() - t0
  assert.deepEqual(a.huella.entradas, ["lib:OLED", "pin:4:OUTPUT"])
  // El tope del test es más holgado que el objetivo para no fallar en una máquina lenta;
  // antes de este cambio el mismo caso tardaba 3,6 s.
  assert.ok(ms < 1500, `tardó ${ms.toFixed(0)} ms`)
})

test("entradas patológicas (separadores, pinMode sin cerrar, #if anidado) terminan rápido y sin romper", () => {
  const script = join(OUT, "patologicas.mjs")
  writeFileSync(
    script,
    [
      "globalThis.Bun = { which: () => null, spawn() {} }",
      `const m = await import(${JSON.stringify(join(OUT, "platformio.ts"))})`,
      "m.limpiarCodigo('x = 0x' + \"1'\".repeat(30000) + '1;')",
      "m.analizarPines('void f(){' + 'pinMode(('.repeat(20000), 'esp32')",
      "const r = m.analizarPines('#if ' + '('.repeat(3000) + '1' + ')'.repeat(3000) + '\\npinMode(7,OUTPUT);\\n#endif', 'esp32')",
      "console.log('termino', r.length)",
    ].join("\n"),
  )
  const r = spawnSync(process.execPath, [script], { timeout: 5_000, encoding: "utf8" })
  assert.equal(r.signal, null, "tardó más de 5 s (antes eran 25 s entre las dos primeras; hoy, menos de medio segundo)")
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /termino 1/, "el #if anidado no tiene que desbordar la pila")
})

// ── Mutantes vivos de la tercera pasada ──────────────────────────────────────

test("una constante en un header de lib/ sin pinMode propio se sigue leyendo", () => {
  const dir = proyectoCon({ "src/main.cpp": '#include <Config.h>\nvoid setup(){ pinMode(MOTOR, OUTPUT); }', "lib/HX711/HX711.h": "#pragma once\n", "lib/HX711/Config.h": "#pragma once\nconst int MOTOR = 7;\n" })
  assert.deepEqual(niveles(mod.analizarProyecto(dir).hallazgos), ["bloqueo"])
})

test("la misma definición repetida en dos archivos no se duplica en la huella", () => {
  const dir = proyectoCon({ "src/a.cpp": "static const int LED = 7;\nvoid a(){ pinMode(LED, OUTPUT); }", "src/b.cpp": "static const int LED = 7;\nvoid b(){ pinMode(LED, OUTPUT); }" })
  assert.deepEqual(mod.analizarProyecto(dir).huella.entradas, ["pin:LED{LED=7}:OUTPUT"])
})

test("un miembro con el mismo nombre (s.pin = 4) no reasigna la global", () => {
  assert.deepEqual(niveles(mod.analizarPines("int pin = 7;\nstruct S { int pin; } s;\nvoid setup(){ s.pin = 4; pinMode(pin, OUTPUT); }", "esp32")), ["bloqueo"])
})

test("evaluarCondicion: verdadero && falso es falso", () => {
  assert.equal(mod.evaluarCondicion("defined(ESP32) && defined(__AVR__)", mod.macrosDePlaca("esp32dev")), false)
  assert.equal(mod.evaluarCondicion("defined(ARDUINO_ARCH_RP2040)", mod.macrosDePlaca("esp32dev")), false, "las arquitecturas de otros son falsas por prefijo")
  assert.equal(mod.evaluarCondicion("defined(ARDUINO_ARCH_STM32)", mod.macrosDePlaca("uno")), false)
})

test("la sal del registro de cargas es aleatoria por compu, y un estado de otra versión no cuenta", async () => {
  const antes = process.env.XDG_CONFIG_HOME
  try {
    process.env.XDG_CONFIG_HOME = join(OUT, `sin-config-${++nProyecto}`)
    const a = mod.leerCargasGlobal().sal
    process.env.XDG_CONFIG_HOME = join(OUT, `sin-config-${++nProyecto}`)
    assert.notEqual(mod.leerCargasGlobal().sal, a)
  } finally {
    process.env.XDG_CONFIG_HOME = antes
  }
  // Un ultima-carga.json viejo (en claro, sin "version": 2) se ignora: frena igual.
  const dir = proyecto("esp32dev", CON_BUZZER)
  mkdirSync(join(dir, ".pio", "tecnia"), { recursive: true })
  writeFileSync(estadoDe(dir), JSON.stringify({ placa: "esp32dev", entradas: ["pin:25:OUTPUT"], ...mod.hashearHuella({ placa: "esp32dev", entradas: ["pin:25:OUTPUT"] }) }))
  assert.equal(mod.leerUltimaCarga(dir), null)
  assert.match(await ejecutar({ action: "flash", project_path: dir }), FRENO)
})

// ═══════════════════════════════════════════════════════════════════════════
// Tercera ronda (rev-p2b): FALLAR CERRADO. Lo que no se resuelve entra a la
// huella con lo que se sabe de su valor; nunca se descarta.
// ═══════════════════════════════════════════════════════════════════════════

const GLOBAL_CARGAS = () => join(process.env.XDG_CONFIG_HOME, "opencode", "tecnia-cargas.json")

test("B-1: sin tecnia-cargas.json, UN checklist con código estable y después cargas normales (antes: bucle)", async () => {
  for (const placa of [CH340, CP2102_A]) {
    escenario({ placas: [placa] })
    const dir = proyecto("esp32dev", CON_BUZZER)
    await ejecutar({ action: "flash", project_path: dir, checklist: codigoDe(await ejecutar({ action: "flash", project_path: dir })) })
    rmSync(GLOBAL_CARGAS(), { force: true })
    const r1 = await ejecutar({ action: "flash", project_path: dir })
    assert.match(r1, /No puedo saber si es la misma placa/)
    assert.ok(existsSync(GLOBAL_CARGAS()), "la sal nueva se guarda en el acto")
    // El código es estable: pedirlo dos veces da el mismo.
    assert.equal(codigoDe(await ejecutar({ action: "flash", project_path: dir })), codigoDe(r1))
    spawns = []
    assert.match(await ejecutar({ action: "flash", project_path: dir, checklist: codigoDe(r1) }), /Codigo cargado exitosamente/)
    spawns = []
    assert.match(await ejecutar({ action: "flash", project_path: dir }), /Codigo cargado exitosamente/, "después de una carga con el código, todo queda anotado")
    assert.ok(cargo())
  }
  escenario()
})

test("B-1: un tecnia-cargas.json roto, y un proyecto que viene con su .pio de otra compu, piden el checklist UNA vez", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  await ejecutar({ action: "flash", project_path: dir, checklist: codigoDe(await ejecutar({ action: "flash", project_path: dir })) })
  writeFileSync(GLOBAL_CARGAS(), "{roto")
  const r1 = await ejecutar({ action: "flash", project_path: dir })
  assert.match(r1, /No puedo saber/)
  await ejecutar({ action: "flash", project_path: dir, checklist: codigoDe(r1) })
  assert.match(await ejecutar({ action: "flash", project_path: dir }), /Codigo cargado exitosamente/)
  // Otra compu: otro registro (otra sal), el mismo .pio del proyecto.
  const antes = process.env.XDG_CONFIG_HOME
  try {
    process.env.XDG_CONFIG_HOME = join(OUT, `otra-compu-${++nProyecto}`)
    const r2 = await ejecutar({ action: "flash", project_path: dir })
    assert.match(r2, /No puedo saber[\s\S]*viene de otra compu/)
    await ejecutar({ action: "flash", project_path: dir, checklist: codigoDe(r2) })
    assert.match(await ejecutar({ action: "flash", project_path: dir }), /Codigo cargado exitosamente/)
  } finally {
    process.env.XDG_CONFIG_HOME = antes
  }
})

test("B-2: una librería PROPIA en lib/ (Zumbador): z(25) pide checklist y z(7) bloquea", () => {
  const h = "#pragma once\n#include <Arduino.h>\nclass Zumbador {\npublic:\n  Zumbador(uint8_t pin);\n  void begin();\nprivate:\n  uint8_t _pin;\n};\n"
  const c = '#include "Zumbador.h"\nZumbador::Zumbador(uint8_t p) : _pin(p) {}\nvoid Zumbador::begin(){ pinMode(_pin, OUTPUT); }\nvoid Zumbador::beep(unsigned int f){ tone(_pin, f, 100); }\n'
  const base = mod.analizarProyecto(proyectoCon({ "src/main.cpp": "const int LED = 26;\nvoid setup(){ pinMode(LED, OUTPUT); }" })).huella
  for (const [pin, nivel] of [[25, []], [7, ["bloqueo"]]]) {
    const a = mod.analizarProyecto(proyectoCon({
      "src/main.cpp": `#include <Zumbador.h>\nconst int LED = 26;\nZumbador z(${pin});\nvoid setup(){ pinMode(LED, OUTPUT); z.begin(); }`,
      "lib/Zumbador/src/Zumbador.h": h,
      "lib/Zumbador/src/Zumbador.cpp": c,
    }))
    assert.deepEqual(niveles(a.hallazgos), nivel)
    assert.deepEqual(mod.altasNuevas(a.huella, base), [`pin:${pin}:OUTPUT`], "el zumbador no pidió el checklist")
  }
  // Sin objetos que digan el pin, el miembro entra con su nombre: no se descarta.
  const sinObjeto = mod.analizarProyecto(proyectoCon({ "src/main.cpp": "void setup(){}", "lib/Zumbador/src/Zumbador.h": h, "lib/Zumbador/src/Zumbador.cpp": c }))
  assert.ok(sinObjeto.huella.entradas.includes("pin:_pin:OUTPUT"), sinObjeto.huella.entradas.join())
})

test("B-2: una librería de terceros CONOCIDA en lib/ sigue sin meter sus internos en la huella", () => {
  const dir = proyectoCon({
    "src/main.cpp": "#include <OneWire.h>\nOneWire bus(4);\nvoid setup(){}",
    "lib/OneWire/OneWire.h": "#pragma once\nclass OneWire { public: OneWire(uint8_t pin); private: uint8_t _pin; };\n",
    "lib/OneWire/OneWire.cpp": '#include "OneWire.h"\nvoid OneWire::reset(){ pinMode(_pin, OUTPUT); }\n',
  })
  assert.deepEqual(mod.analizarProyecto(dir).huella.entradas, ["lib:OneWire", "pin:4:ONEWIRE"])
})

test("B-3: una variable reasignada entra con su valor inicial; cambiarlo pide el checklist", () => {
  const H = (s) => mod.huellaDelCodigo(s, "esp32dev").huella
  const par = (a, b) => mod.altasNuevas(H(b), H(a))
  assert.deepEqual(par("int luz = 2;\nvoid setup(){ for (int i = 0; i < 3; i++) { pinMode(luz, OUTPUT); luz++; } }", "int luz = 25;\nvoid setup(){ for (int i = 0; i < 3; i++) { pinMode(luz, OUTPUT); luz++; } }"), ["pin:luz{luz=25}:OUTPUT"])
  assert.deepEqual(par("int led = 26;\nvoid loop(){ digitalWrite(led, HIGH); led = (led == 26) ? 27 : 26; }", "int led = 4;\nvoid loop(){ digitalWrite(led, HIGH); led = (led == 4) ? 5 : 4; }"), ["pin:led{led=4}:OUTPUT"])
  assert.deepEqual(par("int pinRele = 26;\nvoid setup(){ pinMode(pinRele, OUTPUT); if (millis() > 9) pinRele = 27; }", "int pinRele = 7;\nvoid setup(){ pinMode(pinRele, OUTPUT); if (millis() > 9) pinRele = 27; }"), ["pin:pinRele{pinRele=7}:OUTPUT:rele"])
})

test("B-3: los for con p--, p += 2 y >= se resuelven si los límites son literales", () => {
  assert.deepEqual(niveles(mod.analizarPines("void setup(){ for (int p = 9; p >= 5; p--) pinMode(p, OUTPUT); }", "esp32")), ["bloqueo", "bloqueo", "bloqueo", "bloqueo"])
  assert.deepEqual(mod.huellaDelCodigo("void setup(){ for (int p = 2; p <= 8; p += 2) pinMode(p, OUTPUT); }", "uno").huella.entradas, ["pin:2:OUTPUT", "pin:4:OUTPUT", "pin:6:OUTPUT", "pin:8:OUTPUT"])
  assert.deepEqual(mod.huellaDelCodigo("void setup(){ for (int p = 20; p > 18; p = p - 1) pinMode(p, INPUT); }", "esp32dev").huella.entradas, ["pin:19:INPUT", "pin:20:INPUT"])
  assert.deepEqual(mod.huellaDelCodigo("void setup(){ for (int p = 2; p < N; p--) pinMode(p, OUTPUT); }", "uno").huella.entradas, ["pin:p{p=2}:OUTPUT"], "con un límite que no se sabe, entra el valor inicial")
})

test("B-4: la poda de lib/ no deja paréntesis abiertos que se coman las constantes de otro archivo", () => {
  const gfx = "#pragma once\nclass Pantalla {\n public:\n  void getTextBounds(const char *string, int16_t x, int16_t y, int16_t *x1,\n                     int16_t *y1, uint16_t *w, uint16_t *h);\n  void print(const char *s);\n};\n"
  // La poda es solo para librerías de terceros conocidas: la cabecera de la pantalla va en una (OLED).
  const dir = proyectoCon({ "src/main.cpp": "#include <Pines.h>\nvoid setup(){ pinMode(PIN_RELE, OUTPUT); }", "lib/Adafruit_SSD1306/Adafruit_SSD1306.h": gfx, "lib/Adafruit_SSD1306/Pines.h": "#pragma once\nconst int PIN_RELE = 7;\n" })
  assert.deepEqual(niveles(mod.analizarProyecto(dir).hallazgos), ["bloqueo"])
  // Y una constante de varias líneas queda entera.
  const multi = proyectoCon({ "src/main.cpp": "#include <Pines.h>\nvoid setup(){ for (int i = 0; i < 2; i++) pinMode(LEDS[i], OUTPUT); }", "lib/Keypad/Keypad.h": "#pragma once\n", "lib/Keypad/Pines.h": "#pragma once\nconst int LEDS[] = {\n  4,\n  8\n};\n" })
  assert.deepEqual(niveles(mod.analizarProyecto(multi).hallazgos), ["bloqueo"])
})

test("I-3: un include guard con valor (#define HW_H 1) que encierra todo el archivo sigue siendo un guard", () => {
  const hdr = "#ifndef HW_H\n#define HW_H 1\n#include <Arduino.h>\ninline void prepararRele(){ pinMode(7, OUTPUT); }\n#endif\n"
  assert.deepEqual(niveles(mod.analizarPines(hdr, "esp32")), ["bloqueo"])
  // Si no encierra todo el archivo, es un valor por defecto y no un guard.
  assert.deepEqual(niveles(mod.analizarPines("#ifndef MODO\n#define MODO 1\n#endif\n#ifdef MODO\nvoid f(){}\n#endif\n#ifndef X\n#define X 1\nvoid g(){ pinMode(7, OUTPUT); }\n#endif\nvoid h(){}", "esp32")), ["aviso"])
})

test("I-4: ESP_ARDUINO_VERSION_MAJOR es 2 en el core fijado: #if >= 3 elige la rama vieja", () => {
  const src = "void setup(){\n#if ESP_ARDUINO_VERSION_MAJOR >= 3\n  ledcAttach(7, 5000, 8);\n#else\n  ledcAttachPin(26, 0);\n#endif\n}"
  assert.deepEqual(mod.huellaDelCodigo(src, "esp32dev").huella.entradas, ["pin:26:PWM"])
  assert.deepEqual(mod.analizarPines(src, "esp32"), [])
  assert.equal(mod.evaluarCondicion("ESP_ARDUINO_VERSION_MAJOR == 2 && ESP_ARDUINO_VERSION_PATCH == 17", mod.macrosDePlaca("esp32dev")), true)
  assert.equal(mod.evaluarCondicion("defined(ESP_ARDUINO_VERSION_MAJOR)", mod.macrosDePlaca("uno")), false)
})

test("I-5: pasarse del tope de plantillas deja el análisis incompleto; un método o una función sin llamadas entra con su nombre", () => {
  const cadena = Array.from({ length: 250 }, (_, i) => `void f${i}(int p){ ${i === 0 ? "pinMode(p, OUTPUT);" : `f${i - 1}(p);`} }`).join("\n") + "\nvoid setup(){ f249(11); }"
  assert.match(mod.analizarProyecto(proyectoCon({ "src/main.cpp": cadena })).incompleto.join(), /demasiadas funciones/)
  assert.deepEqual(mod.huellaDelCodigo("class Rele { public: void begin(int p){ pinMode(p, OUTPUT); } };\nRele r;\nvoid setup(){ r.begin(7); }", "esp32dev").huella.entradas, ["pin:p:OUTPUT"])
  // Un valor por defecto omitido en la llamada vale: prender() es prender(7).
  assert.deepEqual(niveles(mod.analizarPines("void prender(int pin = 7){ pinMode(pin, OUTPUT); }\nvoid setup(){ prender(); }", "esp32")), ["bloqueo"])
  // Una llamada después de un #define en la línea de arriba sigue siendo una llamada.
  assert.deepEqual(niveles(mod.analizarPines("void salida(int p){ pinMode(p, OUTPUT); }\nvoid setup(){\n#define NIVEL ACTIVO\n  salida(7);\n}", "esp32")), ["bloqueo"])
})

test("build_src_filter por environment: cada env analiza sus archivos", () => {
  const dir = proyectoCon(
    { "src/esp/main.cpp": "void setup(){ pinMode(7, OUTPUT); }", "src/uno/main.cpp": "void setup(){ pinMode(8, OUTPUT); }" },
    "[env:esp32dev]\nboard = esp32dev\nbuild_src_filter = +<*> -<uno/>\n[env:uno]\nboard = uno\nbuild_src_filter = +<*> -<esp/>\n",
  )
  const a = mod.analizarProyecto(dir)
  assert.deepEqual(niveles(a.hallazgos), ["bloqueo"])
  assert.match(textos(a.hallazgos), /GPIO7/)
  assert.doesNotMatch(textos(a.hallazgos), /GPIO8/, "el archivo del UNO se analizó como ESP32")
})

test("muchas funciones con parámetros y muchos usos: el costo no es usos × ámbitos", () => {
  let s = Array.from({ length: 8000 }, (_, i) => `int g${i}(int x${i}, int y${i}){ return x${i}+y${i}; }`).join("\n")
  s += "\nconst int LED = 26;\nvoid setup(){\n" + "  digitalWrite(LED, HIGH);\n".repeat(12000) + "}"
  const t0 = performance.now()
  mod.analizarPines(s, "esp32")
  const ms = performance.now() - t0
  assert.ok(ms < 1000, `tardó ${ms.toFixed(0)} ms (antes eran 1,5 s; hoy unos 150)`)
})

// ── Mutantes vivos de la pasada de la tercera ronda ──────────────────────────

test("clase propia: objeto sin argumentos usa el default del prototipo; sin default, el miembro entra con su nombre", () => {
  const cpp = '#include "Zumbador.h"\nZumbador::Zumbador(uint8_t p) : _pin(p) {}\nvoid Zumbador::begin(){ pinMode(_pin, OUTPUT); }\n'
  const conDefault = proyectoCon({ "src/main.cpp": "#include <Zumbador.h>\nZumbador z;\nvoid setup(){ z.begin(); }", "lib/Zumbador/Zumbador.h": "#pragma once\nclass Zumbador { public: Zumbador(uint8_t pin = 8); void begin(); private: uint8_t _pin; };\n", "lib/Zumbador/Zumbador.cpp": cpp })
  assert.deepEqual(niveles(mod.analizarProyecto(conDefault).hallazgos), ["bloqueo"], "Zumbador z; con pin = 8 por defecto")
  const sinDefault = proyectoCon({ "src/main.cpp": "#include <Zumbador.h>\nZumbador z;\nvoid setup(){ z.begin(); }", "lib/Zumbador/Zumbador.h": "#pragma once\nclass Zumbador { public: Zumbador(uint8_t pin); void begin(); private: uint8_t _pin; };\n", "lib/Zumbador/Zumbador.cpp": cpp })
  assert.ok(mod.analizarProyecto(sinDefault).huella.entradas.includes("pin:_pin:OUTPUT"))
})

test("for: el límite de >= entra, y un recorrido de más de 40 valores no se resuelve", () => {
  assert.ok(mod.huellaDelCodigo("void setup(){ for (int p = 9; p >= 5; p--) pinMode(p, OUTPUT); }", "esp32dev").huella.entradas.includes("pin:5:OUTPUT"))
  assert.deepEqual(mod.huellaDelCodigo("void setup(){ for (int p = 0; p < 50; p++) pinMode(p, INPUT); }", "esp32dev").huella.entradas, ["pin:p{p=0}:INPUT"])
})

test("include guard: con build_flags que lo definen no es guard; si el #ifndef cierra antes del final, tampoco", () => {
  const dir = proyectoCon({ "src/main.cpp": '#include "pin.h"\nvoid setup(){ pinMode(LED, OUTPUT); }', "include/pin.h": "#ifndef LED\n#define LED 7\n#endif\n" }, "[env:esp32dev]\nboard = esp32dev\nbuild_flags = -DLED=4\n")
  assert.deepEqual(mod.analizarProyecto(dir).huella.entradas, ["pin:4:OUTPUT"])
  assert.deepEqual(niveles(mod.analizarPines("#ifndef X\n#define X 1\nvoid g(){ pinMode(7, OUTPUT); }\n#endif\n#ifdef DEBUG\nvoid h(){}\n#endif", "esp32")), ["aviso"])
})

test("build_src_filter por environment: se ve en la huella de cada placa", () => {
  const dir = proyectoCon(
    { "src/esp/main.cpp": "void setup(){ pinMode(7, OUTPUT); }", "src/uno/main.cpp": "void setup(){ pinMode(8, OUTPUT); }" },
    "[env:esp32dev]\nboard = esp32dev\nbuild_src_filter = +<*> -<uno/>\n[env:uno]\nboard = uno\nbuild_src_filter = +<*> -<esp/>\n",
  )
  assert.deepEqual(mod.analizarProyecto(dir).huella.entradas, ["pin:7:OUTPUT", "pin:8:OUTPUT"])
})

test("un parámetro arreglo tapa al arreglo global con el mismo nombre", () => {
  assert.deepEqual(mod.analizarPines("const int L[] = {7};\nvoid f(int L[]){ pinMode(L[0], OUTPUT); }\nvoid setup(){}", "esp32"), [])
})

test("una carpeta de lib/ desconocida de más de 512 KB se poda y deja el análisis incompleto (no cuelga el tool)", () => {
  let grande = ""
  for (let k = 0; k < 6000; k++) grande += `static int f${k}(int a){ int v${k} = a; v${k} += 1; return v${k}; }\n`
  grande += "x".repeat(0) + "const int MOTOR = 7;\n" + "// relleno\n".repeat(40000)
  const dir = proyectoCon({ "src/main.cpp": "#include <Core.h>\nvoid setup(){ pinMode(MOTOR, OUTPUT); }", "lib/core/Core.h": grande })
  const t0 = performance.now()
  const a = mod.analizarProyecto(dir)
  assert.ok(performance.now() - t0 < 2000)
  assert.deepEqual(a.incompleto, ["lib/core (demasiado grande para analizarla entera)"])
  assert.deepEqual(niveles(a.hallazgos), ["bloqueo"], "las constantes de la carpeta podada se siguen leyendo")
})

test("una clase cuyo header no se lee se reconoce por su constructor Clase::Clase", () => {
  const dir = proyectoCon({
    "src/main.cpp": "#include <Zumbador.h>\nZumbador z(7);\nvoid setup(){ z.begin(); }",
    "src/zumbador.cpp": "Zumbador::Zumbador(uint8_t p) : _pin(p) {}\nvoid Zumbador::begin(){ pinMode(_pin, OUTPUT); }\n",
  })
  assert.deepEqual(niveles(mod.analizarProyecto(dir).hallazgos), ["bloqueo"])
})

// ═══════════════════════════════════════════════════════════════════════════
// Cuarta ronda: el cartel de permiso de OpenCode (ctx.ask) en lugar del código
// ═══════════════════════════════════════════════════════════════════════════

test("cartel: sin altas no se llama a ctx.ask", async () => {
  const dir = proyecto("uno", "void setup(){ pinMode(LED_BUILTIN, OUTPUT); }")
  assert.match(await ejecutar({ action: "flash", project_path: dir }), /Codigo cargado exitosamente/)
  assert.equal(pedidos.length, 0)
})

test("cartel: con altas se llama con el prefijo, el resumen en español, patterns, always y metadata", async () => {
  respuestaAsk = "allow"
  const dir = proyecto("esp32dev", "#include <DHT.h>\nDHT dht(4, DHT22);\nconst int RELE = 26;\nvoid setup(){ pinMode(RELE, OUTPUT); dht.begin(); }")
  assert.match(await ejecutar({ action: "flash", project_path: dir }), /Codigo cargado exitosamente/)
  assert.equal(pedidos.length, 1)
  const p = pedidos[0]
  assert.ok(p.permission.startsWith(mod.PREGUNTA_CHECKLIST))
  assert.equal(p.permission, "¿Revisaste el circuito? Cambió: librería DHT, relé en GPIO26, sensor DHT en GPIO4")
  const codigo = mod.codigoChecklist(mod.analizarProyecto(dir).huella)
  assert.deepEqual(p.patterns, [`cambio ${codigo}`])
  assert.deepEqual(p.always, [`cambio ${codigo}`])
  assert.deepEqual(p.metadata.cambios, ["librería DHT", "relé en GPIO26", "sensor DHT en GPIO4"])
})

test("cartel: la pregunta tiene un tope de largo y dice cuántos cambios más hay", () => {
  const muchos = Array.from({ length: 20 }, (_, i) => `void s${i}(){ pinMode(${i + 12 < 34 ? i + 12 : 4}, OUTPUT); }`).join("\n")
  const a = mod.analizarProyecto(proyectoCon({ "src/main.cpp": muchos }))
  const p = mod.pedidoPorCircuito(a, null)
  assert.ok(p.permission.length <= 160, p.permission)
  assert.match(p.permission, /… y \d+ más$/)
})

test("cartel: Allow carga y graba; Reject no carga, no graba y lo dice en español", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  respuestaAsk = "reject"
  const no = await ejecutar({ action: "flash", project_path: dir })
  assert.match(no, /^No cargué: elegiste Reject \(todavía no revisaste el circuito\)/)
  assert.match(no, /NO vuelvas a intentar la carga por tu cuenta/)
  assert.match(no, /Nunca digas que lo revisaste vos/)
  assert.ok(!cargo() && !buscoPlaca())
  assert.ok(!existsSync(estadoDe(dir)))
  respuestaAsk = "allow"
  assert.match(await ejecutar({ action: "flash", project_path: dir }), /Codigo cargado exitosamente/)
  assert.ok(existsSync(estadoDe(dir)))
})

test("cartel: el rechazo se reconoce por el tag, por el nombre envuelto, por el mensaje y por la causa; con lo que escribió el docente", () => {
  assert.deepEqual(mod.comoRechazo(rechazoDeOpenCode()), { tipo: "rechazo" })
  assert.deepEqual(mod.comoRechazo(rechazoDeOpenCode("falta la resistencia")), { tipo: "rechazo", feedback: "falta la resistencia" })
  assert.deepEqual(mod.comoRechazo({ name: "(FiberFailure) PermissionRejectedError", message: "x" }), { tipo: "rechazo" })
  assert.deepEqual(mod.comoRechazo(new Error("envoltorio", { cause: rechazoDeOpenCode() })), { tipo: "rechazo" })
  assert.deepEqual(mod.comoRechazo({ _tag: "PermissionDeniedError", message: "The user has specified a rule which prevents you from using this specific tool call." }), { tipo: "denegado" })
  assert.equal(mod.comoRechazo(new Error("ECONNRESET")), null)
  assert.equal(mod.comoRechazo("texto"), null)
})

test("cartel: el docente escribió algo al rechazar: se lo devuelve al bot", async () => {
  errorAsk = rechazoDeOpenCode("todavía no puse el GND")
  const r = await ejecutar({ action: "flash", project_path: proyecto("esp32dev", CON_BUZZER) })
  assert.match(r, /El docente escribió: «todavía no puse el GND»/)
  assert.ok(!cargo())
})

test("cartel: un error que no es un rechazo se propaga (no se disfraza de 'no quiso')", async () => {
  errorAsk = new Error("se cayó el servidor")
  await assert.rejects(ejecutar({ action: "flash", project_path: proyecto("esp32dev", CON_BUZZER) }), /se cayó el servidor/)
  assert.ok(!cargo())
})

test("cartel: una regla deny no carga y explica qué falta", async () => {
  errorAsk = { _tag: "PermissionDeniedError", message: "The user has specified a rule which prevents you from using this specific tool call." }
  const r = await ejecutar({ action: "flash", project_path: proyecto("esp32dev", CON_BUZZER) })
  assert.match(r, /^No cargué: la configuración de permisos no deja mostrar el cartel/)
  assert.ok(!cargo())
})

test("cartel: sin ctx.ask (OpenCode viejo, o los tests de antes) falla CERRADO: no carga", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  const r = await mod.default.execute({ action: "flash", project_path: dir }, ctx)
  assert.match(r, /^No cargué: esta versión de OpenCode no puede mostrar el cartel/)
  assert.ok(!cargo() && !existsSync(estadoDe(dir)))
  // Sin altas, no hace falta el cartel: carga igual.
  const blink = proyecto("uno", "void setup(){ pinMode(LED_BUILTIN, OUTPUT); }")
  assert.match(await mod.default.execute({ action: "flash", project_path: blink }, ctx), /Codigo cargado exitosamente/)
})

test("cartel: el freno de placa pregunta con su texto; si ya se preguntó por el circuito en esta carga, no pregunta dos veces", async () => {
  escenario({ placas: [CP2102_A] })
  respuestaAsk = "allow"
  const dir = proyecto("esp32dev", CON_BUZZER)
  await ejecutar({ action: "flash", project_path: dir })
  assert.equal(pedidos.length, 1, "la primera carga pregunta por el circuito y no otra vez por la placa")
  escenario({ placas: [CP2102_B] })
  pedidos = []
  assert.match(await ejecutar({ action: "flash", project_path: dir }), /Codigo cargado exitosamente/)
  assert.equal(pedidos.length, 1)
  assert.equal(pedidos[0].permission, "¿Revisaste el circuito? Otra placa u otro proyecto en esta placa")
  assert.ok(buscoPlaca(), "el de placa va después de buscar la placa")
})

test("cartel: GPIO6 a GPIO11 bloquea SIN preguntar: el cartel no lo levanta", async () => {
  respuestaAsk = "allow"
  const r = await ejecutar({ action: "both", project_path: proyecto("esp32dev", "void setup(){ pinMode(7, OUTPUT); }") })
  assert.match(r, /NO CARGUÉ NADA/)
  assert.equal(pedidos.length, 0)
  assert.ok(!cargo())
})

test("cartel: con el análisis incompleto pregunta en CADA carga, aunque se haya permitido", async () => {
  respuestaAsk = "allow"
  const dir = proyectoCon({ "src/main.cpp": "void setup(){ pinMode(4, OUTPUT); }" })
  symlinkSync(join(dir, "no-existe.h"), join(dir, "src", "roto.h"))
  await ejecutar({ action: "flash", project_path: dir })
  await ejecutar({ action: "flash", project_path: dir })
  assert.equal(pedidos.length, 2)
  assert.deepEqual(pedidos[1].always, [])
})

test("compile con altas le dice al bot que avise del cartel y de los botones en inglés", async () => {
  const r = await ejecutar({ action: "compile", project_path: proyecto("esp32dev", CON_BUZZER) })
  assert.match(r, /Antes de cargar: contale al docente en español qué cambió \(salida en GPIO25\)/)
  assert.match(r, /Allow once si ya revisó el circuito, Reject si todavía no/)
  assert.match(r, /Nunca digas que lo revisaste vos/)
  // Sin altas, el mensaje de siempre.
  assert.equal(await ejecutar({ action: "compile", project_path: proyecto("uno", "void setup(){ pinMode(LED_BUILTIN, OUTPUT); }") }), "Compilacion exitosa. El codigo esta listo para cargar al dispositivo.")
})

test("el agente tiene la regla del cartel DESPUÉS de '*': deny, con el mismo prefijo que el tool", () => {
  const prompt = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
  const front = prompt.split("---")[1]
  const lineas = front.split("\n")
  const iDeny = lineas.findIndex((l) => /^\s{2}"\*":\s*"deny"/.test(l))
  const iRegla = lineas.findIndex((l) => l.trim() === `"${mod.PREGUNTA_CHECKLIST}*": "ask"`)
  assert.ok(iDeny >= 0, "no encontré el \"*\": \"deny\" del agente")
  assert.ok(iRegla > iDeny, "la regla del cartel tiene que ir DESPUÉS de \"*\": \"deny\": gana la última que coincide")
  // Que ninguna otra regla de nivel superior quede después y la pise.
  assert.ok(lineas.slice(iRegla + 1).every((l) => !/^\s{2}"?[^\s#]/.test(l)), "hay reglas después de la del cartel")
})

test("la leyenda de tecnia-logo.tsx usa el mismo prefijo que el tool y explica los tres botones", () => {
  const tsx = readFileSync(join(REPO, "opencode/plugins/tecnia-logo.tsx"), "utf8")
  assert.equal(tsx.match(/const PREGUNTA_CHECKLIST = "([^"]+)"/)?.[1], mod.PREGUNTA_CHECKLIST)
  assert.match(tsx, /Checklist: Allow once = Sí, lo revisé, cargá · Reject = Todavía no, no cargues · Allow always = no volver a preguntar por este cambio/)
  assert.match(tsx, /app_bottom\(\)/)
  assert.match(tsx, /\.startsWith\(PREGUNTA_CHECKLIST\)/)
})

test("cartel: si en la misma carga cambian el circuito Y la placa, se pregunta UNA vez (por el circuito)", async () => {
  escenario({ placas: [CP2102_A] })
  respuestaAsk = "allow"
  const dir = proyecto("esp32dev", CON_BUZZER)
  await ejecutar({ action: "flash", project_path: dir })
  reescribir(dir, CON_BUZZER + "\nconst int PIR = 27;\nvoid x(){ pinMode(PIR, INPUT); }")
  escenario({ placas: [CP2102_B] })
  pedidos = []
  assert.match(await ejecutar({ action: "flash", project_path: dir }), /Codigo cargado exitosamente/)
  assert.equal(pedidos.length, 1, "el checklist recién hecho para este circuito ya cubre la placa nueva")
  assert.match(pedidos[0].permission, /Cambió: entrada en GPIO27/)
})

test("compile con un bloqueo no habla del cartel", async () => {
  const r = await ejecutar({ action: "compile", project_path: proyecto("esp32dev", "void setup(){ pinMode(7, OUTPUT); pinMode(25, OUTPUT); }") })
  assert.doesNotMatch(r, /Allow once/)
})
