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

import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-pines-codigo-test")
const HOME_FALSO = join(OUT, "home")
const HOME_ORIGINAL = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }

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

function escenario({ upload = { code: 0 }, compile = { code: 0 } } = {}) {
  guion = (cmd) => {
    const s = cmd.join(" ")
    if (s.includes("--version")) return { stdout: "PlatformIO Core, version 6.1.15\n" }
    if (s.includes("device list")) return { stdout: JSON.stringify([CH340]) }
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
  if (existsSync(OUT)) rmSync(OUT, { recursive: true })
  mkdirSync(HOME_FALSO, { recursive: true })
  process.env.HOME = HOME_FALSO
  process.env.USERPROFILE = HOME_FALSO
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/platformio.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "platformio.ts"), src)
  mod = await import(join(OUT, "platformio.ts"))
  ctx = { directory: OUT, abort: new AbortController().signal }
})

beforeEach(() => {
  spawns = []
  escenario()
})

after(() => {
  process.env.HOME = HOME_ORIGINAL.HOME
  process.env.USERPROFILE = HOME_ORIGINAL.USERPROFILE
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
const ejecutar = (args) => mod.default.execute(args, ctx)

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

test("ESP32: GPIO7 adentro de un #if baja a aviso", () => {
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
    "void setup(){ for (int p = 6; p < 12; p++) pinMode(p, OUTPUT); }",
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
  assert.deepEqual(mod.analizarPines(src, "esp32"), [])
  assert.deepEqual(mod.analizarPines(src, "uno"), [])
  assert.deepEqual(mod.huellaDelCodigo(src, "esp32dev").huella.entradas, [])
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
  assert.deepEqual(mod.huellaDelCodigo("const int RELE = 13;\nvoid setup(){ pinMode(RELE, OUTPUT); }", "uno").huella.entradas, ["pin:13:OUTPUT"])
  assert.deepEqual(mod.huellaDelCodigo("void setup(){ pinMode(13, INPUT); }", "uno").huella.entradas, ["pin:13:INPUT"])
  // Y en el UNO el 2 es un pin cualquiera.
  assert.deepEqual(mod.huellaDelCodigo("void setup(){ pinMode(2, OUTPUT); }", "uno").huella.entradas, ["pin:2:OUTPUT"])
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
  const dir = proyecto("esp32dev", "void setup(){ pinMode(LED_BUILTIN, OUTPUT); }\nvoid loop(){}")
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
  const codigoCl = freno.match(/checklist: "([0-9a-f]{6})"/)[1]
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

test("flash con GPIO7 dentro de #if: no bloquea (es aviso); con el checklist, carga y lo cuenta", async () => {
  const dir = proyecto("esp32dev", "#if 0\nvoid x(){ pinMode(7, OUTPUT); }\n#endif\nvoid setup(){}")
  const r1 = await ejecutar({ action: "flash", project_path: dir })
  assert.doesNotMatch(r1, /NO CARGUÉ NADA/, "adentro de un #if no es bloqueo")
  assert.match(r1, /FRENÉ LA CARGA/, "es un pin nuevo: pide el checklist como cualquier otro")
  const codigo = r1.match(/checklist: "([0-9a-f]{6})"/)[1]
  const r2 = await ejecutar({ action: "flash", project_path: dir, checklist: codigo })
  assert.match(r2, /Codigo cargado exitosamente/)
  assert.match(r2, /GPIO7 es de la memoria flash.*#if/, "el aviso le llega al docente después de cargar")
})

// ── flash/both: la compuerta del checklist ───────────────────────────────────

const CON_BUZZER = "const int BUZZER = 25;\nvoid setup(){ pinMode(BUZZER, OUTPUT); }\nvoid loop(){ tone(BUZZER, 440); }"

test("flash con hardware nuevo y sin checklist: frena antes de buscar la placa y da el código", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  const r = await ejecutar({ action: "flash", project_path: dir })
  assert.match(r, /FRENÉ LA CARGA/)
  assert.match(r, /GPIO25 como salida/)
  assert.match(r, /checklist-seguridad/)
  assert.match(r, /checklist: "[0-9a-f]{6}"/)
  assert.ok(!buscoPlaca(), "la compuerta va ANTES de detectPort")
  assert.ok(!cargo())
  assert.ok(!existsSync(join(dir, ".pio", "tecnia", "ultima-carga.json")), "sin carga no hay estado")
})

test("flash con un código de checklist equivocado: sigue frenado y lo dice", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  const r1 = await ejecutar({ action: "flash", project_path: dir })
  const bueno = r1.match(/checklist: "([0-9a-f]{6})"/)[1]
  const malo = bueno === "000000" ? "111111" : "000000"
  spawns = []
  const r2 = await ejecutar({ action: "flash", project_path: dir, checklist: malo })
  assert.match(r2, /FRENÉ LA CARGA/)
  assert.match(r2, /no corresponde a este circuito/)
  assert.ok(!cargo())
})

test("flash con el código correcto: carga y guarda la huella; la próxima carga igual no frena", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  const r1 = await ejecutar({ action: "flash", project_path: dir })
  const codigo = r1.match(/checklist: "([0-9a-f]{6})"/)[1]
  spawns = []
  const r2 = await ejecutar({ action: "flash", project_path: dir, checklist: codigo.toUpperCase() })
  assert.match(r2, /Codigo cargado exitosamente/)
  assert.ok(cargo())
  const estado = JSON.parse(readFileSync(join(dir, ".pio", "tecnia", "ultima-carga.json"), "utf8"))
  assert.deepEqual(estado.entradas, ["pin:25:OUTPUT"])
  assert.equal(estado.placa, "esp32dev")

  // Cambio de lógica: no frena.
  reescribir(dir, CON_BUZZER.replace("440", "880"))
  spawns = []
  assert.match(await ejecutar({ action: "flash", project_path: dir }), /Codigo cargado exitosamente/)

  // Agregar un PIR: frena, y sólo nombra lo nuevo.
  reescribir(dir, CON_BUZZER + "\nconst int PIR = 27;\nvoid x(){ pinMode(PIR, INPUT); }")
  spawns = []
  const r3 = await ejecutar({ action: "flash", project_path: dir })
  assert.match(r3, /FRENÉ LA CARGA/)
  assert.match(r3, /Lo nuevo: GPIO27 como entrada\./)
  assert.ok(!cargo())
})

test("una carga que FALLA no guarda la huella: la próxima vuelve a pedir el checklist", async () => {
  const dir = proyecto("esp32dev", CON_BUZZER)
  const codigo = (await ejecutar({ action: "flash", project_path: dir })).match(/checklist: "([0-9a-f]{6})"/)[1]
  escenario({ upload: { code: 1, stderr: "A fatal error occurred: Failed to connect to ESP32\n" } })
  const r = await ejecutar({ action: "flash", project_path: dir, checklist: codigo })
  assert.match(r, /Error al cargar/)
  assert.ok(!existsSync(join(dir, ".pio", "tecnia", "ultima-carga.json")), "guardó el estado de una carga que falló")
  escenario()
  spawns = []
  assert.match(await ejecutar({ action: "flash", project_path: dir }), /FRENÉ LA CARGA/)
})

test("both: la compuerta también, y con el código carga y guarda", async () => {
  const dir = proyecto("uno", "const int RELE = 7;\nvoid setup(){ pinMode(RELE, OUTPUT); }")
  const r1 = await ejecutar({ action: "both", project_path: dir })
  assert.match(r1, /La compilacion fue bien\. FRENÉ LA CARGA/)
  assert.match(r1, /D7 como salida/)
  assert.ok(!buscoPlaca())
  const codigo = r1.match(/checklist: "([0-9a-f]{6})"/)[1]
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
  const codigo = (await ejecutar({ action: "flash", project_path: dir })).match(/checklist: "([0-9a-f]{6})"/)[1]
  await ejecutar({ action: "flash", project_path: dir, checklist: codigo })
  writeFileSync(join(dir, "platformio.ini"), "[env:uno]\nplatform = x\nboard = uno\nframework = arduino\n")
  spawns = []
  const r = await ejecutar({ action: "flash", project_path: dir })
  assert.match(r, /FRENÉ LA CARGA/)
  // Y el código viejo no sirve para la placa nueva.
  spawns = []
  assert.match(await ejecutar({ action: "flash", project_path: dir, checklist: codigo }), /FRENÉ LA CARGA/)
})

test("el parámetro checklist es OPCIONAL y el enum de acciones no cambió", () => {
  const src = readFileSync(join(REPO, "opencode/tool/platformio.ts"), "utf8")
  assert.match(src, /checklist: tool\.schema\s*\.string\(\)\s*\.optional\(\)/)
  const m = src.match(/\.enum\(\[([^\]]+)\]\)/)
  assert.deepEqual(m[1].split(",").map((s) => s.trim().replace(/"/g, "")).sort(), ["both", "compile", "diagnostico", "flash", "monitor", "reparar"])
})

test("el prompt le explica al bot el freno del checklist con el parámetro real", () => {
  // Sin esto, el bot recibe "FRENÉ LA CARGA" sin saber que tiene un parámetro
  // para seguir, y el docente queda trabado sin poder cargar nunca.
  const prompt = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
  const linea = prompt.split("\n").find((l) => l.includes("frenan pidiendo el checklist"))
  assert.ok(linea, "el prompt no menciona que flash/both pueden frenar pidiendo el checklist")
  assert.match(linea, /`checklist`/, "no nombra el parámetro `checklist`")
  assert.match(linea, /Nunca lo pases sin haber hecho el checklist/)
})
