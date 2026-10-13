// Modo Vivo V1 — el runtime en C++ (agente A): `codegen/runtime.ts` genera el firmware base de la
// ESP32 y este archivo prueba que lo generado cumple el contrato (PROTOCOLO-VIVO-V1.md) sin
// hardware, salvo la compilación real, que es opt-in.
//
// Qué protege:
// - determinismo y hashes fijados de `src/main.cpp` y `platformio.ini`;
// - las tablas de política del C++ (§5) son las de `nucleo/placas.ts`, leídas del C++ generado;
// - `CASOS_DORADOS` byte a byte: el NUCLEO PURO traducido a JS, sobre un runtime recién arrancado;
// - mismo primer error que `vivo/protocolo.ts` ante un corpus de líneas adversarias (diferencial);
// - la capa de TRANSPORTE traducida con un Arduino falso: corte de líneas, límite de 200 bytes,
//   `reinicio` antes de `hola`, mapeo de `esp_reset_reason`, LEDC (canales, 0/100 %, suelta);
// - guardias: sin `String`, `std::`, `new `, `malloc`, `lib_deps`; y la guardia se prueba a sí misma;
// - compilación real con PlatformIO (`TECNIA_CODEGEN_PIO=1`), con evidencia.
//
// El traductor de C++ → JS es el de `tests/codegen-s2b-dht11.test.mjs` extendido ACÁ (no allá):
// arreglos de `char`, literales de caracteres y de texto, prototipos, casts, división entera.
// Corre solo: `node --test tests/vivo-runtime-cpp.test.mjs`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const { generarRuntime, CAMPOS_POR_COMANDO, VERSION_RUNTIME, pinesProhibidosDe } = await import(join(REPO, "opencode/codegen/runtime.ts"))
const { REGISTRO_PLACAS } = await import(join(REPO, "opencode/nucleo/placas.ts"))
const P = await import(join(REPO, "opencode/vivo/protocolo.ts"))
const { crearRuntimeSimulado, CASOS_DORADOS, pinesProhibidos, RUNTIME_VERSION } = await import(join(REPO, "tests/vivo-simulador.mjs"))

const sha = (contenido) => createHash("sha256").update(contenido).digest("hex")
const esp32 = REGISTRO_PLACAS["esp32-devkit-v1"]
const generado = generarRuntime(esp32)
const MAIN = generado.archivos["src/main.cpp"]
const INI = generado.archivos["platformio.ini"]

const CABECERA_NUCLEO = "// CAPA 1: NUCLEO PURO"
const CABECERA_TRANSPORTE = "// CAPA 2: TRANSPORTE SERIE"
const seccionNucleo = (cpp) => cpp.slice(cpp.indexOf(CABECERA_NUCLEO), cpp.indexOf(CABECERA_TRANSPORTE))
const seccionTransporte = (cpp) => cpp.slice(cpp.indexOf(CABECERA_TRANSPORTE))

const MODO_SALIDA = P.MODOS_DE_PIN.indexOf("salida") + 1
const MODO_ENTRADA_PULL_UP = P.MODOS_DE_PIN.indexOf("entradaPullUp") + 1

// ════════════════════════════════════════════════════════════════════════════════════
// Traductor C++ → JS (subconjunto del runtime)
// ════════════════════════════════════════════════════════════════════════════════════

const ESCAPES = { "0": 0, n: 10, r: 13, t: 9, v: 11, f: 12, "\\": 92, "'": 39, '"': 34 }
const codigoDeLiteral = (c) => (c.startsWith("\\") ? ESCAPES[c[1]] : c.charCodeAt(0))
const cadena = (texto) => [...texto].map((c) => c.charCodeAt(0)).concat(0)
const textoDe = (arreglo, largo) => Buffer.from(arreglo.slice(0, largo)).toString("latin1")

/** Traduce el subconjunto de C++ del runtime a JS. Lo que no reconoce, lo deja: si no es JS válido, `new Function` lo dice. */
function traducir(cpp) {
  const parametros = (lista) => lista.split(",").map((p) => p.trim().replace(/\[\]$/, "").split(/\s+/).pop()).filter(Boolean).join(", ")
  return cpp
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith("//") && !linea.startsWith("#include"))
    .map((linea) => linea.replace(/\s*\/\/.*$/, ""))
    .filter((linea) => !/^static \w+ \w+\([^)]*\);$/.test(linea)) // prototipos de hw_*
    .join("\n")
    .replace(/'(\\.|[^'\\])'/g, (_, c) => String(codigoDeLiteral(c)))
    .replace(/^static const char (\w+)\[\] = ("[^"]*");/gm, "const $1 = cadena($2);")
    .replace(/^static const (?:uint8_t|uint16_t|uint32_t) (\w+)\[\] = \{([^}]*)\};/gm, "const $1 = [$2];")
    .replace(/^static const (?:uint8_t|uint16_t|uint32_t|char|bool|int) (\w+) =/gm, "const $1 =")
    .replace(/^static (?:char|uint8_t|uint16_t|uint32_t|bool) (\w+)\[([^\]]+)\];/gm, "let $1 = new Array($2).fill(0);")
    .replace(/^static (?:char|uint8_t|uint16_t|uint32_t|bool|int) (\w+) =/gm, "let $1 =")
    .replace(/^static (?:void|bool|uint8_t|uint16_t|uint32_t|int) (\w+)\(([^)]*)\) \{/gm, (_, nombre, lista) => `function ${nombre}(${parametros(lista)}) {`)
    .replace(/void (setup|loop)\(\)/g, "function $1()")
    .replace(/^(\s*)(?:char|uint8_t|uint16_t|uint32_t|int|bool) (\w+)\[(\w+)\];/gm, "$1let $2 = new Array($3).fill(0);")
    .replace(/^(\s*)(?:char|uint8_t|uint16_t|uint32_t|int|bool|esp_reset_reason_t) (\w+) =/gm, "$1let $2 =")
    .replace(/for \((?:int|uint8_t|uint16_t|uint32_t) /g, "for (let ")
    .replace(/\((?:char|uint8_t|uint16_t|uint32_t|int)\)/g, "")
    .replace(/^(\s*)(\w+) = (\w+) \/ (\d+);/gm, "$1$2 = Math.trunc($3 / $4);")
    .replace(/\(([^()]*)\) \/ (\d+)/g, "Math.trunc(($1) / $2)")
}

/**
 * El NUCLEO PURO solo, con un hardware falso tan determinista como el del simulador: una salida se
 * relee como lo que se escribió, una entrada con pull-up y nada afuera está en alto, lo demás en bajo.
 */
function ejecutarNucleo(cpp = MAIN, { reloj = () => 0, canalesPwm = Infinity } = {}) {
  const modos = new Map()
  const salidas = new Map()
  const entradas = new Map()
  const analogicos = new Map()
  const llamadas = []
  let pwmActivos = 0
  const hw = {
    hw_pinModo: (pin, modo) => {
      llamadas.push(["pinModo", pin, modo])
      modos.set(pin, modo)
      if (modo !== MODO_SALIDA) salidas.delete(pin)
    },
    hw_escribirDigital: (pin, nivel) => {
      llamadas.push(["escribirDigital", pin, nivel])
      salidas.set(pin, nivel)
    },
    hw_escribirPwm: (pin, porcentaje) => {
      llamadas.push(["escribirPwm", pin, porcentaje])
      if (porcentaje === 0 || porcentaje === 100) salidas.set(pin, porcentaje === 100 ? 1 : 0)
      else {
        if (pwmActivos >= canalesPwm) return false
        pwmActivos++
        salidas.set(pin, { pwm: porcentaje })
      }
      modos.set(pin, MODO_SALIDA)
      return true
    },
    hw_leerDigital: (pin) => {
      llamadas.push(["leerDigital", pin])
      const salida = salidas.get(pin)
      if (modos.get(pin) === MODO_SALIDA) return typeof salida === "number" ? salida : 0
      return entradas.get(pin) ?? (modos.get(pin) === MODO_ENTRADA_PULL_UP ? 1 : 0)
    },
    hw_leerAnalogico: (pin) => {
      llamadas.push(["leerAnalogico", pin])
      return analogicos.get(pin) ?? 0
    },
    hw_millis: () => reloj(),
  }
  const js = traducir(seccionNucleo(cpp))
  const nombres = Object.keys(hw)
  const nucleo = new Function("hw", "cadena", `const { ${nombres.join(", ")} } = hw;\n${js}\nreturn { nucleo_procesar, nucleo_responderReinicio, nucleo_responderHola, g_linea, g_salida, g_modo, LIMITE_LINEA_BYTES };`)(hw, cadena)
  const LIMITE = nucleo.LIMITE_LINEA_BYTES
  /** Lo que haría la capa 2: hasta LIMITE bytes al buffer; uno más es "descartada por larga" (largo = LIMITE + 1). */
  const procesar = (texto) => {
    const bytes = Buffer.from(texto.endsWith("\n") ? texto.slice(0, -1) : texto, "utf8")
    const largo = bytes.length > LIMITE ? LIMITE + 1 : bytes.length
    nucleo.g_linea.fill(0)
    for (let i = 0; i < Math.min(bytes.length, LIMITE); i++) nucleo.g_linea[i] = bytes[i]
    const largoSalida = nucleo.nucleo_procesar(largo)
    return largoSalida === 0 ? [] : [textoDe(nucleo.g_salida, largoSalida)]
  }
  const arrancar = (causa = P.CAUSAS_DE_REINICIO.indexOf("encendido")) => [textoDe(nucleo.g_salida, nucleo.nucleo_responderReinicio(causa)), textoDe(nucleo.g_salida, nucleo.nucleo_responderHola())]
  return { procesar, arrancar, llamadas, modos, salidas, fijarEntrada: (pin, nivel) => entradas.set(pin, nivel), fijarAnalogico: (pin, crudo) => analogicos.set(pin, crudo), g_modo: nucleo.g_modo }
}

const ESP_RST = { UNKNOWN: 0, POWERON: 1, EXT: 2, SW: 3, PANIC: 4, INT_WDT: 5, TASK_WDT: 6, WDT: 7, DEEPSLEEP: 8, BROWNOUT: 9, SDIO: 10 } // esp_system.h:42-52

/** El programa COMPLETO (las dos capas) sobre un Arduino falso que registra cada llamada y lo que sale por el serie. */
function ejecutarPrograma(cpp = MAIN, { causa = ESP_RST.POWERON, reloj = () => 0 } = {}) {
  const placa = { modos: new Map(), niveles: new Map(), canales: new Map(), lecturas: new Map(), analogicos: new Map(), llamadas: [] }
  const rx = []
  let tx = ""
  const salida = []
  const Serial = {
    begin: (baud) => placa.llamadas.push(["Serial.begin", baud]),
    available: () => rx.length,
    read: () => (rx.length ? rx.shift() : -1),
    print: (x) => {
      tx += typeof x === "number" ? String.fromCharCode(x) : textoDe(x, x.indexOf(0))
      let fin
      while ((fin = tx.indexOf("\n")) >= 0) {
        salida.push(tx.slice(0, fin))
        tx = tx.slice(fin + 1)
      }
    },
  }
  const hw = {
    HIGH: 1,
    LOW: 0,
    INPUT: 0x01, // esp32-hal-gpio.h:45
    OUTPUT: 0x03, // :48
    INPUT_PULLUP: 0x05, // :50
    ESP_RST_UNKNOWN: ESP_RST.UNKNOWN,
    ESP_RST_POWERON: ESP_RST.POWERON,
    ESP_RST_EXT: ESP_RST.EXT,
    ESP_RST_SW: ESP_RST.SW,
    ESP_RST_PANIC: ESP_RST.PANIC,
    ESP_RST_INT_WDT: ESP_RST.INT_WDT,
    ESP_RST_TASK_WDT: ESP_RST.TASK_WDT,
    ESP_RST_WDT: ESP_RST.WDT,
    ESP_RST_DEEPSLEEP: ESP_RST.DEEPSLEEP,
    ESP_RST_BROWNOUT: ESP_RST.BROWNOUT,
    ESP_RST_SDIO: ESP_RST.SDIO,
    Serial,
    esp_reset_reason: () => causa,
    millis: () => reloj(),
    pinMode: (pin, modo) => {
      placa.llamadas.push(["pinMode", pin, modo])
      placa.modos.set(pin, modo)
    },
    digitalWrite: (pin, nivel) => {
      placa.llamadas.push(["digitalWrite", pin, nivel])
      placa.niveles.set(pin, nivel)
    },
    digitalRead: (pin) => {
      placa.llamadas.push(["digitalRead", pin])
      if (placa.lecturas.has(pin)) return placa.lecturas.get(pin)
      if (placa.modos.get(pin) === 0x03) return placa.niveles.get(pin) ?? 0
      return placa.modos.get(pin) === 0x05 ? 1 : 0
    },
    analogRead: (pin) => {
      placa.llamadas.push(["analogRead", pin])
      return placa.analogicos.get(pin) ?? 0
    },
    ledcSetup: (canal, hz, bits) => {
      placa.llamadas.push(["ledcSetup", canal, hz, bits])
      return canal < 16 ? hz : 0 // esp32-hal-ledc.c:57-61: 0 si el canal no existe
    },
    ledcAttachPin: (pin, canal) => {
      placa.llamadas.push(["ledcAttachPin", pin, canal])
      placa.canales.set(pin, canal)
    },
    ledcWrite: (canal, duty) => placa.llamadas.push(["ledcWrite", canal, duty]),
    ledcDetachPin: (pin) => {
      placa.llamadas.push(["ledcDetachPin", pin])
      placa.canales.delete(pin)
    },
  }
  const js = traducir(cpp)
  const nombres = Object.keys(hw)
  const programa = new Function("hw", "cadena", `const { ${nombres.join(", ")} } = hw;\n${js}\nreturn { setup, loop };`)(hw, cadena)
  const enviar = (texto) => rx.push(...Buffer.from(texto, "utf8"))
  const leerSalida = () => salida.splice(0, salida.length)
  return { ...programa, placa, enviar, leerSalida, pendiente: () => tx }
}

// ════════════════════════════════════════════════════════════════════════════════════
// A — forma: determinismo, hashes, dos capas, guardias
// ════════════════════════════════════════════════════════════════════════════════════

test("A1 determinismo: misma placa → mismos bytes; hashes fijados; environment, runtime y protocolo del contrato", () => {
  const otra = generarRuntime(esp32)
  assert.deepEqual(otra, generado)
  assert.equal(generado.environment, "esp32-devkit-v1", "el env es el id de la placa, como generarPrograma (platformio-ini.ts)")
  assert.equal(generado.runtime, RUNTIME_VERSION)
  assert.equal(VERSION_RUNTIME, RUNTIME_VERSION, "el runtime y el simulador anuncian la misma versión")
  assert.equal(generado.protocolo, P.VERSION_PROTOCOLO)
  assert.deepEqual(Object.keys(generado.archivos), ["platformio.ini", "src/main.cpp"])
  assert.doesNotMatch(MAIN, /\d{4}-\d{2}-\d{2}T/, "sin marcas temporales")
  assert.match(INI, /^\[env:esp32-devkit-v1\]$/m)
  assert.match(INI, /^platform = espressif32@6\.12\.0$/m)
  assert.match(INI, /^board = esp32dev$/m)
  assert.match(INI, /^framework = arduino$/m)
  // Hashes fijados: cualquier cambio del generador los mueve a propósito (y el commit lo dice).
  assert.equal(sha(INI), "b4ea2df4fc2401ec488b0254ff714176119e561447817a99631de64da7321fde")
  assert.equal(sha(MAIN), "c7b8a9b625214f1eecd0c79e69149354c8bae0f40782b38ceeb30b04dbc2f160")
})

test("A2 dos capas con cabecera: el núcleo no toca Arduino; el C++ es ASCII; cada hecho de hardware cita su fuente", () => {
  assert.ok(MAIN.indexOf(CABECERA_NUCLEO) > 0 && MAIN.indexOf(CABECERA_TRANSPORTE) > MAIN.indexOf(CABECERA_NUCLEO))
  assert.match(MAIN, /^#include <Arduino\.h>$/m)
  const nucleo = seccionNucleo(MAIN)
  assert.doesNotMatch(nucleo, /\b(Serial|pinMode|digitalWrite|digitalRead|analogRead|ledc\w*|millis|micros|delay\w*|esp_\w+)\b/, "el núcleo no llama a Arduino ni a ESP-IDF")
  assert.doesNotMatch(nucleo, /\bsnprintf\b/, "los enteros se emiten dígito a dígito: sin stdio en el núcleo")
  const transporte = seccionTransporte(MAIN)
  for (const api of ["Serial.begin(VELOCIDAD_SERIE)", "pinMode(pin, INPUT_PULLUP)", "ledcSetup(canal, PWM_FRECUENCIA_HZ, PWM_BITS)", "ledcAttachPin(pin, canal)", "ledcWrite(canal,", "ledcDetachPin(pin)", "analogRead(pin)", "millis()", "esp_reset_reason()"]) {
    assert.ok(transporte.includes(api), `el transporte usa ${api}`)
  }
  for (const cita of ["esp32-hal-gpio.h:45", "esp32-hal-ledc.c:19-21", "esp32-hal-ledc.c:163-181", "esp32-hal-adc.c:29", "esp_system.h:42-52", "HardwareSerial.h:230", "esp32-hal-matrix.c:43-46"]) {
    assert.ok(transporte.includes(cita), `cita ${cita}`)
  }
  assert.match(MAIN, /PWM_FRECUENCIA_HZ = 5000;/)
  assert.match(MAIN, /PWM_BITS = 8;/)
  assert.match(MAIN, /VELOCIDAD_SERIE = 115200;/)
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(MAIN), "el C++ generado es ASCII")
})

const PROHIBIDOS_EN_CPP = [/\bString\b/, /std::/, /\bnew /, /\bmalloc\b/, /\bfree\(/, /\bdelay\s*\(/]
const violaciones = (cpp, ini) => [...PROHIBIDOS_EN_CPP.filter((re) => re.test(cpp)).map(String), ...(/lib_deps/.test(ini) ? ["lib_deps"] : [])]

test("A3 guardias: sin String, std::, new, malloc, free, delay ni lib_deps — y la guardia marca lo que tiene que marcar", () => {
  assert.deepEqual(violaciones(MAIN, INI), [])
  assert.deepEqual(violaciones(`${MAIN}\nString texto;\n`, INI), ["/\\bString\\b/"])
  assert.deepEqual(violaciones(`${MAIN}\nchar* p = new char[4];\n`, INI), ["/\\bnew /"])
  assert.deepEqual(violaciones(MAIN, `${INI}lib_deps = bblanchon/ArduinoJson\n`), ["lib_deps"])
})

test("A4 el traductor reconoce todo el C++ generado (ningún `static`, tipo ni cast queda sin traducir)", () => {
  const js = traducir(MAIN)
  assert.doesNotMatch(js, /\bstatic\b/)
  assert.doesNotMatch(js, /\b(uint8_t|uint16_t|uint32_t|char|bool|esp_reset_reason_t)\b/)
  assert.doesNotMatch(js, /'[^']*'/, "sin literales de caracteres")
  assert.doesNotMatch(js, /[^.\w]\d+\s*\/\s*\d+/, "sin divisiones de enteros sin truncar")
})

// ════════════════════════════════════════════════════════════════════════════════════
// B — política: las tablas del C++ son las de placas.ts
// ════════════════════════════════════════════════════════════════════════════════════

const tablaDelCpp = (nombre) => {
  const m = MAIN.match(new RegExp(`^static const uint8_t ${nombre}\\[\\] = \\{([^}]*)\\};`, "m"))
  return m ? m[1].split(",").map((x) => Number(x.trim())) : []
}
const numeros = (filtro) =>
  esp32.pines
    .filter(filtro)
    .map((p) => p.numero)
    .sort((a, b) => a - b)

test("B1 las tablas de política (§5) del C++ coinciden con nucleo/placas.ts, leídas del C++ generado", () => {
  assert.deepEqual(tablaDelCpp("PINES_EXISTENTES"), numeros(() => true))
  assert.deepEqual(tablaDelCpp("PINES_PROHIBIDOS"), [...pinesProhibidos(esp32)].sort((a, b) => a - b), "prohibidos = flash + UART0, el criterio del simulador")
  assert.deepEqual(tablaDelCpp("PINES_PROHIBIDOS"), [...pinesProhibidosDe(esp32)].sort((a, b) => a - b))
  assert.deepEqual(tablaDelCpp("PINES_SIN_SALIDA"), numeros((p) => !p.capacidades.salidaDigital))
  assert.deepEqual(tablaDelCpp("PINES_SIN_PWM"), numeros((p) => !p.capacidades.pwm))
  assert.deepEqual(tablaDelCpp("PINES_CON_ADC"), numeros((p) => p.capacidades.adc))
  assert.deepEqual(tablaDelCpp("PINES_SIN_ENTRADA"), numeros((p) => !p.capacidades.entradaDigital), "vacía en la ESP32: el predicado queda constante")
  assert.match(MAIN, /^static const uint8_t CANTIDAD_DE_PINES = (\d+);/m)
  assert.equal(Number(MAIN.match(/CANTIDAD_DE_PINES = (\d+);/)[1]), Math.max(...esp32.pines.map((p) => p.numero)) + 1)
  // Lo que el contrato dice con palabras, la tabla lo dice con números.
  assert.deepEqual(tablaDelCpp("PINES_PROHIBIDOS"), [1, 3, 6, 7, 8, 9, 10, 11])
  assert.deepEqual(tablaDelCpp("PINES_SIN_SALIDA"), [34, 35, 36, 39])
  assert.deepEqual(tablaDelCpp("PINES_CON_ADC"), [32, 33, 34, 35, 36, 39])
})

test("B2 CAMPOS_POR_COMANDO es la tabla del parser de referencia: cada campo falta en el mismo orden que en protocolo.ts", () => {
  const ejemplo = { pin: "23", modo: "salida", nivel: "alto", porcentaje: "50" }
  for (const comando of P.COMANDOS_V1) {
    const campos = CAMPOS_POR_COMANDO[comando]
    const completa = [comando, ...campos.map((c) => `${c}=${ejemplo[c]}`)].join(" ")
    assert.equal(P.parsearLineaDeComando(completa).ok, true, completa)
    for (let i = 0; i < campos.length; i++) {
      const sinUno = [comando, ...campos.filter((_, j) => j !== i).map((c) => `${c}=${ejemplo[c]}`)].join(" ")
      assert.deepEqual(P.parsearLineaDeComando(sinUno).error, { codigo: "CAMPO_FALTANTE", comando, campo: campos[i] }, sinUno)
    }
    const conExtra = `${completa} extra=1`
    assert.equal(P.parsearLineaDeComando(conExtra).error.codigo, "CAMPO_DESCONOCIDO")
  }
  assert.deepEqual(Object.keys(CAMPOS_POR_COMANDO).sort(), [...P.COMANDOS_V1])
})

test("B3 una placa que no cabe en V1 no genera un runtime 'más o menos': el UNO (bancos D y A) se rechaza", () => {
  assert.throws(() => generarRuntime(REGISTRO_PLACAS["arduino-uno"]), /bancos D, A/)
  assert.throws(() => generarRuntime({ ...esp32, backends: { platformio: { ...esp32.backends.platformio, framework: "espidf" } } }), /espidf/)
})

// ════════════════════════════════════════════════════════════════════════════════════
// C — el núcleo puro, traducido: CASOS_DORADOS y diferencial contra la referencia
// ════════════════════════════════════════════════════════════════════════════════════

test("C1 CASOS_DORADOS: el núcleo en C++ recién arrancado reproduce cada caso en orden, byte a byte", () => {
  const nucleo = ejecutarNucleo()
  const simulador = crearRuntimeSimulado()
  assert.deepEqual(nucleo.arrancar(), simulador.arrancar(), "reinicio (encendido) y después hola")
  assert.equal(CASOS_DORADOS.length, 26)
  for (const caso of CASOS_DORADOS) assert.deepEqual(nucleo.procesar(caso.entrada), caso.salida, JSON.stringify(caso.entrada))
})

/** Líneas adversarias: el núcleo tiene que dar el MISMO primer error que `protocolo.ts` (vía el simulador). */
const CORPUS = [
  "hola",
  "ping",
  "hola extra=1",
  "ping pin=1",
  " hola",
  "hola ",
  "hola  ",
  "hola\t",
  "\thola",
  "ho la",
  "hola\tping",
  "digital.escribir\tpin=23 nivel=alto",
  "digital.escribir pin=23 nivel=alto ",
  "digital.escribir pin=23  nivel=alto",
  "digital.escribir pin=23 nivel=alto\r",
  "digital.escribir pin=23 nivel=alto\r\r",
  "\r",
  "",
  "=",
  "a=1",
  "9hola",
  "hola.",
  "Hola pin=1",
  "digital.escribir pin= nivel=alto",
  "digital.escribir =23 nivel=alto",
  "digital.escribir pin==23 nivel=alto",
  "digital.escribir pin=23=1 nivel=alto",
  "digital.escribir pin=23 nivel",
  "digital.escribir Pin=23 nivel=alto",
  "digital.escribir pin=23 nivel=al to",
  "digital.escribir pin=23 nivel=alto!",
  "digital.escribir pin=23 nivel=ALTO",
  "digital.escribir pin=23 nivel=alto pin=22",
  "digital.escribir pin=23 pin=22 x=1 y",
  "digital.escribir pin=23 x y=1 pin=22",
  "digital.escribir pin=23 pin=22 nivel=alto extra=1",
  "digital.escribir extra=1 pin=23 nivel=alto",
  "digital.escribir nivel=alto",
  "digital.escribir",
  "digital.escribir extra=1",
  "digital.escribir nivel=alto extra=1 pin=23",
  "pin.modo pin=4 extra=1",
  "digital.escribir pin=23 nivel=x extra=1",
  "digital.escribir pin=x nivel=y",
  "digital.escribir pin=023 nivel=alto",
  "digital.escribir pin=0 nivel=alto",
  "digital.escribir pin=-1 nivel=alto",
  "digital.escribir pin=2.5 nivel=alto",
  "digital.escribir pin=4294967295 nivel=alto",
  "digital.escribir pin=99999999 nivel=alto",
  "servo.angulo pin=18 grados=90",
  "servo.angulo pin=x",
  "proyecto.cargar",
  "sensor.leer protocolo=bus-unico-dht11 pin=4",
  "suscribir",
  "pwm.escribir pin=18 porcentaje=0",
  "pwm.escribir pin=18 porcentaje=100",
  "pwm.escribir pin=18 porcentaje=100 modo=salida",
  "pwm.escribir pin=18 porcentaje=-1",
  "pwm.escribir pin=18 porcentaje=1000",
  "pwm.escribir pin=18 porcentaje=00",
  "pwm.escribir pin=34 porcentaje=50",
  "pwm.escribir pin=6 porcentaje=50",
  "pwm.escribir pin=40 porcentaje=50",
  "pwm.escribir pin=40 porcentaje=500",
  "pin.modo pin=34 modo=salida",
  "pin.modo pin=34 modo=entrada",
  "pin.modo pin=34 modo=entradaPullUp",
  "pin.modo pin=36 modo=salida",
  "pin.modo pin=39 modo=salida",
  "pin.modo pin=3 modo=entrada",
  "pin.modo pin=11 modo=entrada",
  "pin.modo pin=0 modo=salida",
  "pin.modo pin=2 modo=salida",
  "pin.modo pin=12 modo=salida",
  "pin.modo pin=15 modo=salida",
  "pin.modo pin=5 modo=salida",
  "pin.modo pin=37 modo=salida",
  "pin.modo pin=38 modo=entrada",
  "pin.modo pin=24 modo=entrada",
  "pin.modo pin=28 modo=entrada",
  "pin.modo pin=255 modo=entrada",
  "pin.modo pin=256 modo=entrada",
  "pin.modo pin=4 modo=Salida",
  "pin.modo modo=salida pin=4",
  "digital.leer pin=32",
  "digital.leer pin=33",
  "digital.leer pin=2",
  "digital.leer pin=2 extra=1",
  "analogico.leer pin=32",
  "analogico.leer pin=33",
  "analogico.leer pin=35",
  "analogico.leer pin=36",
  "analogico.leer pin=39",
  "analogico.leer pin=25",
  "analogico.leer pin=1",
  "analogico.leer pin=7",
  "analogico.leer pin=37",
  "analogico.leer",
  "analogico.leer pin=34 modo=entrada",
  // Secuencia con estado: lo que se escribió se relee; PWM 0/100 son niveles; pin.modo a entrada borra la salida.
  "digital.escribir pin=4 nivel=bajo",
  "digital.leer pin=4",
  "digital.escribir pin=4 nivel=alto",
  "digital.leer pin=4",
  "pwm.escribir pin=4 porcentaje=0",
  "digital.leer pin=4",
  "pwm.escribir pin=4 porcentaje=100",
  "digital.leer pin=4",
  "pwm.escribir pin=4 porcentaje=37",
  "digital.leer pin=4",
  "pin.modo pin=4 modo=entradaPullUp",
  "digital.leer pin=4",
  "pin.modo pin=4 modo=entrada",
  "digital.leer pin=4",
  "pin.modo pin=4 modo=salida",
  "digital.leer pin=4",
  "digital.leer pin=25",
  "digital.leer pin=26",
  // Nombres y valores largos: salen enteros en el error.
  `${"a".repeat(150)} pin=1`,
  `x ${"b".repeat(150)}=1`,
  `digital.escribir ${"c".repeat(100)}=1 pin=1 nivel=alto`,
  `digital.escribir pin=1 pin=2 ${"d".repeat(100)}=1`,
  // Borde del límite: 199 bytes + \n entra; 200 no; 199 + \r + \n entra; 200 + \r no.
  `ping ${"x".repeat(194)}`,
  `ping ${"x".repeat(195)}`,
  `ping ${"x".repeat(194)}\r`,
  `ping ${"x".repeat(195)}\r`,
  `${"p".repeat(199)}`,
  `${"p".repeat(200)}`,
  `${"p".repeat(300)}`,
  `hola ${"x".repeat(300)}`,
  "pin.modo pin=4 modo=salida",
  "ping",
]

test("C2 diferencial: ante cada línea del corpus, el núcleo en C++ da exactamente lo que da la referencia (mismo primer error, mismo estado)", () => {
  const nucleo = ejecutarNucleo()
  const simulador = crearRuntimeSimulado()
  nucleo.arrancar()
  simulador.arrancar()
  const codigos = new Set()
  for (const linea of CORPUS) {
    const esperado = simulador.procesar(linea)
    assert.deepEqual(nucleo.procesar(linea), esperado, JSON.stringify(linea))
    for (const s of esperado) {
      const r = P.parsearRespuesta(s)
      assert.ok(r.ok, s)
      if (r.valor.tipo === "error") codigos.add(r.valor.codigo)
    }
  }
  assert.deepEqual([...codigos].sort(), [...P.CODIGOS_DE_ERROR].sort(), "el corpus cubre los diez códigos del contrato")
  // La sección "con estado" del corpus cambió modos de verdad en el núcleo.
  assert.equal(nucleo.g_modo[4], MODO_SALIDA)
})

test("C3 el núcleo le pide al hardware exactamente lo que el contrato dice (§2): salida si hace falta, entrada por defecto, PWM 0/100 como niveles", () => {
  const nucleo = ejecutarNucleo()
  nucleo.procesar("digital.escribir pin=23 nivel=alto")
  assert.deepEqual(nucleo.llamadas, [["pinModo", 23, MODO_SALIDA], ["escribirDigital", 23, 1]])
  nucleo.llamadas.length = 0
  nucleo.procesar("digital.escribir pin=23 nivel=bajo")
  assert.deepEqual(nucleo.llamadas, [["escribirDigital", 23, 0]], "ya es salida: no se reconfigura")
  nucleo.llamadas.length = 0
  nucleo.procesar("digital.leer pin=4")
  nucleo.procesar("digital.leer pin=4")
  assert.deepEqual(nucleo.llamadas, [["pinModo", 4, MODO_SALIDA - 2], ["leerDigital", 4], ["leerDigital", 4]], "entrada por defecto, una sola vez")
  nucleo.llamadas.length = 0
  nucleo.procesar("pwm.escribir pin=18 porcentaje=50")
  assert.deepEqual(nucleo.llamadas, [["escribirPwm", 18, 50]], "el PWM configura el pin al engancharse: sin pinModo previo")
  nucleo.llamadas.length = 0
  nucleo.procesar("digital.escribir pin=6 nivel=alto")
  nucleo.procesar("digital.leer pin=40")
  nucleo.procesar("analogico.leer pin=4")
  nucleo.procesar("pin.modo pin=34 modo=salida")
  assert.deepEqual(nucleo.llamadas, [], "un comando rechazado por política no toca el hardware")
  nucleo.procesar("analogico.leer pin=34")
  assert.deepEqual(nucleo.llamadas, [["leerAnalogico", 34]], "analogico.leer no cambia el modo del pin")
  nucleo.fijarAnalogico(34, 4095)
  assert.deepEqual(nucleo.procesar("analogico.leer pin=34"), ['{"crudo":4095,"pin":34,"tipo":"lectura"}'])
  nucleo.fijarEntrada(32, 1)
  assert.deepEqual(nucleo.procesar("digital.leer pin=32"), ['{"nivel":"alto","pin":32,"tipo":"lectura"}'])
  // Sin canales de PWM libres: PIN_SIN_CAPACIDAD, nunca un `ok` falso.
  const sinCanales = ejecutarNucleo(MAIN, { canalesPwm: 1 })
  assert.deepEqual(sinCanales.procesar("pwm.escribir pin=18 porcentaje=50"), ['{"comando":"pwm.escribir","pin":18,"tipo":"ok"}'])
  assert.deepEqual(sinCanales.procesar("pwm.escribir pin=19 porcentaje=50"), ['{"codigo":"PIN_SIN_CAPACIDAD","comando":"pwm.escribir","pin":19,"tipo":"error"}'])
  assert.equal(sinCanales.g_modo[19], 0, "el pin rechazado queda sin configurar")
  const reloj = ejecutarNucleo(MAIN, { reloj: () => 4294967295 })
  assert.deepEqual(reloj.procesar("ping"), ['{"tipo":"pong","uptimeMs":4294967295}'], "uptime de 32 bits entero")
})

// ════════════════════════════════════════════════════════════════════════════════════
// D — la capa de transporte, traducida con un Arduino falso
// ════════════════════════════════════════════════════════════════════════════════════

test("D1 al arrancar: Serial.begin(115200), `reinicio` ANTES del `hola`, mismos bytes que el simulador, y cada causa de esp_reset_reason mapeada", () => {
  const prog = ejecutarPrograma()
  prog.setup()
  assert.deepEqual(prog.placa.llamadas[0], ["Serial.begin", 115200])
  assert.deepEqual(prog.leerSalida(), crearRuntimeSimulado({ causaDeReinicio: "encendido" }).arrancar())
  assert.equal(prog.pendiente(), "", "cada línea termina en \\n solo")
  const mapeo = [
    [ESP_RST.POWERON, "encendido"],
    [ESP_RST.SW, "software"],
    [ESP_RST.BROWNOUT, "brownout"],
    [ESP_RST.INT_WDT, "watchdog"],
    [ESP_RST.TASK_WDT, "watchdog"],
    [ESP_RST.WDT, "watchdog"],
    [ESP_RST.UNKNOWN, "otro"],
    [ESP_RST.EXT, "otro"],
    [ESP_RST.PANIC, "otro"],
    [ESP_RST.DEEPSLEEP, "otro"],
    [ESP_RST.SDIO, "otro"],
  ]
  assert.equal(mapeo.length, Object.keys(ESP_RST).length, "las once razones de esp_system.h:42-52")
  for (const [razon, causa] of mapeo) {
    const p = ejecutarPrograma(MAIN, { causa: razon })
    p.setup()
    assert.equal(p.leerSalida()[0], P.serializarRespuesta({ tipo: "reinicio", causa }), `razón ${razon}`)
  }
})

test("D2 corte de líneas por el serie: \\r\\n, bytes de a pedazos, líneas vacías, y el límite de 200 bytes con descarte hasta el \\n", () => {
  const prog = ejecutarPrograma(MAIN, { reloj: () => 1234 })
  prog.setup()
  prog.leerSalida()
  prog.enviar("ping\n")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), ['{"tipo":"pong","uptimeMs":1234}'])
  prog.enviar("pi")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [], "línea incompleta: espera")
  prog.enviar("ng\r\n\n\r\nhola\n")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), ['{"tipo":"pong","uptimeMs":1234}', P.serializarRespuesta({ tipo: "hola", runtime: RUNTIME_VERSION, protocolo: 1, placa: esp32.id, comandos: [...P.COMANDOS_V1], protocolos: [] })])
  // Borde exacto (contrato sec. 1: 200 bytes con el \n; la referencia descuenta un \r final antes de contar).
  // Un comando desconocido de 199 bytes distingue "entro" de "no entro": se devuelve entero en el error.
  const larga = P.serializarRespuesta({ tipo: "error", codigo: "LINEA_DEMASIADO_LARGA" })
  const desconocido = (n) => P.serializarRespuesta({ tipo: "error", codigo: "COMANDO_DESCONOCIDO", comando: "p".repeat(n) })
  prog.enviar(`${"p".repeat(199)}\n`)
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [desconocido(199)], "199 bytes + \\n = 200: entra")
  prog.enviar(`${"p".repeat(200)}\n`)
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [larga], "200 bytes + \\n = 201: no entra")
  prog.enviar(`${"p".repeat(199)}\r\n`)
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [desconocido(199)], "199 + \\r\\n: entra (el \\r no cuenta)")
  prog.enviar(`${"p".repeat(200)}\r\n`)
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [larga])
  // Una línea de 1000 bytes sin \n: un solo error, cuando llega el \n; lo que sigue se procesa normal.
  prog.enviar("x".repeat(1000))
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [], "sin \\n todavía no responde")
  prog.enviar("x".repeat(300))
  prog.loop()
  prog.enviar("\nping\n")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [larga, '{"tipo":"pong","uptimeMs":1234}'])
  assert.equal(prog.pendiente(), "")
})

test("D3 LEDC: un canal por pin a 5 kHz y 8 bits, duty redondeado, 0/100 % sueltan el PWM y escriben el nivel, 16 canales y después PIN_SIN_CAPACIDAD", () => {
  const prog = ejecutarPrograma()
  prog.setup()
  prog.leerSalida()
  const desde = () => {
    const n = prog.placa.llamadas.length
    return () => prog.placa.llamadas.slice(n)
  }
  let ll = desde()
  prog.enviar("pwm.escribir pin=18 porcentaje=50\n")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), ['{"comando":"pwm.escribir","pin":18,"tipo":"ok"}'])
  assert.deepEqual(ll(), [["ledcSetup", 0, 5000, 8], ["ledcAttachPin", 18, 0], ["ledcWrite", 0, 128]], "50 % de 255 = 127,5 → 128")
  ll = desde()
  prog.enviar("pwm.escribir pin=18 porcentaje=1\n")
  prog.loop()
  assert.deepEqual(ll(), [["ledcWrite", 0, 3]], "mismo canal; 1 % = 2,55 → 3")
  ll = desde()
  prog.enviar("pwm.escribir pin=18 porcentaje=100\n")
  prog.loop()
  assert.deepEqual(ll(), [["ledcDetachPin", 18], ["pinMode", 18, 0x03], ["pinMode", 18, 0x03], ["digitalWrite", 18, 1]], "100 %: suelta el canal, OUTPUT, HIGH")
  ll = desde()
  prog.enviar("pwm.escribir pin=18 porcentaje=0\n")
  prog.loop()
  assert.deepEqual(ll(), [["pinMode", 18, 0x03], ["digitalWrite", 18, 0]], "0 % sin canal enganchado: OUTPUT, LOW")
  ll = desde()
  prog.enviar("pwm.escribir pin=18 porcentaje=99\n")
  prog.loop()
  assert.deepEqual(ll(), [["ledcSetup", 0, 5000, 8], ["ledcAttachPin", 18, 0], ["ledcWrite", 0, 252]], "el canal 0 quedó libre y se reutiliza; 99 % = 252,45 → 252")
  ll = desde()
  prog.enviar("digital.escribir pin=18 nivel=bajo\n")
  prog.loop()
  assert.deepEqual(ll(), [["ledcDetachPin", 18], ["pinMode", 18, 0x03], ["digitalWrite", 18, 0]], "digital.escribir sobre un pin con PWM lo suelta (el núcleo no repite pinMode: ya era salida)")
  ll = desde()
  prog.enviar("pwm.escribir pin=18 porcentaje=10\npin.modo pin=18 modo=entradaPullUp\n")
  prog.loop()
  assert.deepEqual(ll(), [["ledcSetup", 0, 5000, 8], ["ledcAttachPin", 18, 0], ["ledcWrite", 0, 26], ["ledcDetachPin", 18], ["pinMode", 18, 0x03], ["pinMode", 18, 0x05]], "pin.modo sobre un pin con PWM lo suelta antes de configurarlo")
  prog.leerSalida()
  // 16 canales: los pines de salida de la placa son más que eso; el 17.º PWM simultáneo se rechaza.
  const salidas = esp32.pines.filter((p) => p.capacidades.pwm && !pinesProhibidos(esp32).includes(p.numero)).map((p) => p.numero)
  assert.ok(salidas.length > 16, `la placa tiene ${salidas.length} pines con PWM`)
  const otro = ejecutarPrograma()
  otro.setup()
  otro.leerSalida()
  for (const pin of salidas.slice(0, 16)) otro.enviar(`pwm.escribir pin=${pin} porcentaje=50\n`)
  otro.loop()
  assert.deepEqual(otro.leerSalida(), salidas.slice(0, 16).map((pin) => `{"comando":"pwm.escribir","pin":${pin},"tipo":"ok"}`))
  assert.deepEqual([...new Set(otro.placa.canales.values())].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i), "16 canales distintos")
  otro.enviar(`pwm.escribir pin=${salidas[16]} porcentaje=50\n`)
  otro.loop()
  assert.deepEqual(otro.leerSalida(), [`{"codigo":"PIN_SIN_CAPACIDAD","comando":"pwm.escribir","pin":${salidas[16]},"tipo":"error"}`])
  otro.enviar(`pwm.escribir pin=${salidas[0]} porcentaje=0\npwm.escribir pin=${salidas[16]} porcentaje=50\n`)
  otro.loop()
  assert.deepEqual(otro.leerSalida(), [`{"comando":"pwm.escribir","pin":${salidas[0]},"tipo":"ok"}`, `{"comando":"pwm.escribir","pin":${salidas[16]},"tipo":"ok"}`], "liberar un canal lo deja disponible")
})

test("D4 pines y lecturas por Arduino: INPUT por defecto en digital.leer, INPUT_PULLUP, OUTPUT + digitalWrite, analogRead 12 bits, uptime con millis", () => {
  let ahora = 0
  const prog = ejecutarPrograma(MAIN, { reloj: () => ahora })
  prog.setup()
  prog.leerSalida()
  const n = prog.placa.llamadas.length
  prog.placa.analogicos.set(34, 4095)
  prog.placa.lecturas.set(4, 0)
  ahora = 7_654_321
  prog.enviar(["digital.leer pin=4", "pin.modo pin=4 modo=entradaPullUp", "digital.leer pin=5", "digital.escribir pin=23 nivel=alto", "digital.leer pin=23", "analogico.leer pin=34", "ping", "pin.modo pin=19 modo=salida", "pin.modo pin=19 modo=entrada"].join("\n") + "\n")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [
    '{"nivel":"bajo","pin":4,"tipo":"lectura"}',
    '{"comando":"pin.modo","pin":4,"tipo":"ok"}',
    '{"nivel":"bajo","pin":5,"tipo":"lectura"}',
    '{"comando":"digital.escribir","pin":23,"tipo":"ok"}',
    '{"nivel":"alto","pin":23,"tipo":"lectura"}',
    '{"crudo":4095,"pin":34,"tipo":"lectura"}',
    '{"tipo":"pong","uptimeMs":7654321}',
    '{"comando":"pin.modo","pin":19,"tipo":"ok"}',
    '{"comando":"pin.modo","pin":19,"tipo":"ok"}',
  ])
  assert.deepEqual(prog.placa.llamadas.slice(n), [
    ["pinMode", 4, 0x01],
    ["digitalRead", 4],
    ["pinMode", 4, 0x05],
    ["pinMode", 5, 0x01],
    ["digitalRead", 5],
    ["pinMode", 23, 0x03],
    ["digitalWrite", 23, 1],
    ["digitalRead", 23],
    ["analogRead", 34],
    ["pinMode", 19, 0x03],
    ["pinMode", 19, 0x01],
  ])
})

// ════════════════════════════════════════════════════════════════════════════════════
// E — compilación real (opt-in), con evidencia
// ════════════════════════════════════════════════════════════════════════════════════

const ACTIVO = process.env.TECNIA_CODEGEN_PIO === "1"

test(
  "E1 compilación real: generarRuntime → platformio.ini + src/main.cpp → `pio run -e esp32-devkit-v1` → firmware (TECNIA_CODEGEN_PIO=1)",
  { skip: ACTIVO ? false : "opt-in: TECNIA_CODEGEN_PIO=1 (necesita PlatformIO y espressif32@6.12.0 instalados)", timeout: 15 * 60 * 1000 },
  async () => {
    const { pioCandidatos } = await import(join(REPO, "opencode/tool/platformio.ts"))
    const dir = mkdtempSync(join(tmpdir(), "tecnia-vivo-runtime-"))
    try {
      for (const [ruta, contenido] of Object.entries(generado.archivos)) {
        mkdirSync(join(dir, ruta, ".."), { recursive: true })
        writeFileSync(join(dir, ruta), contenido)
      }
      const pio = process.env.TECNIA_PIO_BIN ?? pioCandidatos().find((c) => existsSync(c)) ?? "pio"
      const argumentos = ["run", "-d", dir, "-e", generado.environment]
      const corrida = spawnSync(pio, argumentos, { encoding: "utf8", env: { ...process.env, PLATFORMIO_SETTING_ENABLE_TELEMETRY: "no" }, maxBuffer: 64 * 1024 * 1024 })
      const log = `${corrida.stdout ?? ""}${corrida.stderr ?? ""}`
      const build = join(dir, ".pio", "build", generado.environment)
      const firmware = join(build, "firmware.bin")
      const advertencias = log.split("\n").filter((l) => /warning:/.test(l))
      const evidencia = process.env.TECNIA_CODEGEN_EVIDENCIA ?? join(homedir(), "tecnia-bot-docs", "esp32-completo", "evidencia-v1", "runtime")
      mkdirSync(evidencia, { recursive: true })
      writeFileSync(join(evidencia, "platformio.ini"), INI)
      writeFileSync(join(evidencia, "main.cpp"), MAIN)
      writeFileSync(join(evidencia, "pio-run.log"), log)
      const resumen = {
        comando: [pio.replace(homedir(), "~"), ...argumentos.map((a) => (a === dir ? "<temporal>" : a))].join(" "),
        environment: generado.environment,
        runtime: generado.runtime,
        protocolo: generado.protocolo,
        exitCode: corrida.status,
        error: corrida.error ? String(corrida.error) : null,
        advertencias,
        sha256: {
          "platformio.ini": sha(INI),
          "src/main.cpp": sha(MAIN),
          "firmware.bin": existsSync(firmware) ? sha(readFileSync(firmware)) : null,
        },
        firmware: existsSync(firmware) ? { archivo: "firmware.bin", bytes: statSync(firmware).size } : null,
        elf: existsSync(join(build, "firmware.elf")) ? { bytes: statSync(join(build, "firmware.elf")).size, sha256: sha(readFileSync(join(build, "firmware.elf"))) } : null,
      }
      writeFileSync(join(evidencia, "resumen.json"), `${JSON.stringify(resumen, null, 2)}\n`)
      assert.equal(corrida.error, undefined, String(corrida.error))
      assert.equal(corrida.status, 0, log.slice(-4000))
      assert.ok(existsSync(firmware) && statSync(firmware).size > 0, "no se produjo firmware.bin")
      assert.deepEqual(advertencias, [], "el runtime compila sin advertencias")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
