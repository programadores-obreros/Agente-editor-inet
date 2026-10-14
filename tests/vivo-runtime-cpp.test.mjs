// Modo Vivo (protocolo v1, slices V1–V4) — el runtime en C++ (agente A): `codegen/runtime.ts` genera el
// firmware base de la ESP32 y este archivo prueba que lo generado cumple el contrato (PROTOCOLO-VIVO-V1.md,
// con las decisiones V4-x de §9) sin hardware, salvo la compilación real, que es opt-in.
//
// Historia (auditoría 2026-10-13, A2 A1 y A3 H4): el test C3 afirmaba "analogico.leer no cambia el modo del
// pin", que es lo contrario del hardware (el core deja el pin en ANALOG), y el Arduino falso dejaba que
// `digitalWrite` moviera un pin con el driver apagado: dos tests verdes sobre un OK falso. Ahora el Arduino
// falso reproduce el efecto colateral (`analogRead` → ANALOG; `digitalWrite`/`digitalRead` inertes salvo
// OUTPUT/INPUT; sin pull-up en los pines de sólo entrada) y D5 prueba que el falso ve el bug si vuelve.
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
// - V4 (sección F): con `wifi: { clave }` el runtime gana la CAPA 3 (red propia, DNS cautivo, HTTP) y
//   el `hola` anuncia la red; sin la opción, el hash de V1 no se mueve. El `hola` con wifi del núcleo
//   traducido es byte a byte el del simulador; con el Arduino falso: SSID desde la MAC o fijo, canal por defecto (V4-3),
//   302 para rutas y hosts ajenos, `POST /comando` = la misma línea que el serie, 400 sólo con cuerpo
//   vacío o largo, la página ASCII sin internet; `String` sólo en la capa 3.
//
// El traductor de C++ → JS es el de `tests/codegen-s2b-dht11.test.mjs` extendido ACÁ (no allá):
// arreglos de `char`, literales de caracteres y de texto, prototipos, casts, división entera; y para
// V4: comentarios `//` que respetan las comillas (la URL del portal lleva `//`), el literal PROGMEM de
// la página en varias líneas, objetos `IPAddress`/`DNSServer`/`WebServer` y locales `String`.
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
const { generarRuntime, VERSION_RUNTIME, pinesProhibidosDe, IP_PORTAL, BUILD_FLAGS_RUNTIME, CANAL_WIFI_MINIMO, CANAL_WIFI_MAXIMO } = await import(join(REPO, "opencode/codegen/runtime.ts"))
const { renderizarPlatformioIni } = await import(join(REPO, "opencode/codegen/platformio-ini.ts"))
const { identificador } = await import(join(REPO, "opencode/codegen/runtime-cpp.ts"))
const { RUTA_COMANDO, renderizarPaginaPortal } = await import(join(REPO, "opencode/vivo/pagina-portal.ts"))
const { REGISTRO_PLACAS } = await import(join(REPO, "opencode/nucleo/placas.ts"))
const P = await import(join(REPO, "opencode/vivo/protocolo.ts"))
const { crearRuntimeSimulado, CASOS_DORADOS, pinesProhibidos, RUNTIME_VERSION } = await import(join(REPO, "tests/vivo-simulador.mjs"))

const sha = (contenido) => createHash("sha256").update(contenido).digest("hex")
const esp32 = REGISTRO_PLACAS["esp32-devkit-v1"]
const generado = generarRuntime(esp32)
const MAIN = generado.archivos["src/main.cpp"]
const INI = generado.archivos["platformio.ini"]

// V4: la misma placa con red propia. El default es la red ABIERTA (`clave: ""`, decisión de Alejandro del
// 2026-10-13); la variante con clave usa la misma clave fija que `tests/vivo-protocolo.test.mjs`.
const CLAVE_WIFI = "48213907"
const IP_TEXTO = IP_PORTAL.join(".")
// Los pines de la página son una OPCION del generador (nunca literales en codegen/): acá sí van números.
// Página fija de prueba (para los hashes) y la página del E2E (sec. 8.3: GPIO2 y GPIO18, GPIO4, GPIO34).
const PAGINA_DE_PRUEBA = Object.freeze({ salidas: [18], salidasExtra: [], entradasDigitales: [4], entradasAnalogicas: [34] })
const PAGINA_E2E = Object.freeze({ salidas: [2, 18], salidasExtra: [], entradasDigitales: [4], entradasAnalogicas: [34] })
const generadoWifi = generarRuntime(esp32, { wifi: { clave: "" }, pagina: PAGINA_DE_PRUEBA })
const MAIN_WIFI = generadoWifi.archivos["src/main.cpp"]
const INI_WIFI = generadoWifi.archivos["platformio.ini"]
const MAIN_WIFI_CON_CLAVE = generarRuntime(esp32, { wifi: { clave: CLAVE_WIFI }, pagina: PAGINA_DE_PRUEBA }).archivos["src/main.cpp"]
// SSID fijado al generar (decisión de Alejandro, 2026-10-13): el E2E usa `MI_ESP` y red abierta.
const SSID_FIJO = "MI_ESP"
const generadoWifiSsidFijo = generarRuntime(esp32, { wifi: { clave: "", ssid: SSID_FIJO }, pagina: PAGINA_DE_PRUEBA })
const MAIN_WIFI_SSID_FIJO = generadoWifiSsidFijo.archivos["src/main.cpp"]

const CABECERA_NUCLEO = "// CAPA 1: NUCLEO PURO"
const CABECERA_TRANSPORTE = "// CAPA 2: TRANSPORTE SERIE"
const CABECERA_PORTAL = "// CAPA 3: TRANSPORTE WIFI"
const seccionNucleo = (cpp) => cpp.slice(cpp.indexOf(CABECERA_NUCLEO), cpp.indexOf(CABECERA_TRANSPORTE))
const finDelTransporte = (cpp) => (cpp.includes(CABECERA_PORTAL) ? cpp.indexOf(CABECERA_PORTAL) : cpp.length)
const seccionTransporte = (cpp) => cpp.slice(cpp.indexOf(CABECERA_TRANSPORTE), finDelTransporte(cpp))
const seccionPortal = (cpp) => cpp.slice(cpp.indexOf(CABECERA_PORTAL))
/** La página tal cual la sirve el runtime: el literal PROGMEM de la capa 3, desescapado. */
const paginaDe = (cpp) => {
  const m = seccionPortal(cpp).match(/^static const char PAGINA\[\] PROGMEM =\n((?:  "(?:[^"\\]|\\.)*"\n)*  "(?:[^"\\]|\\.)*");/m)
  if (!m) throw new Error("no hay literal PAGINA en la capa 3")
  return m[1]
    .split("\n")
    .map((linea) => JSON.parse(linea.trim()))
    .join("")
}

// Los modos del C++ valen su índice en MODOS_DE_PIN + 1 (0 = sin configurar): es la convención del C++, no del contrato.
const MODO_SALIDA = P.MODOS_DE_PIN.indexOf(P.MODO.salida) + 1
const MODO_ENTRADA = P.MODOS_DE_PIN.indexOf(P.MODO.entrada) + 1
const MODO_ENTRADA_PULL_UP = P.MODOS_DE_PIN.indexOf(P.MODO.entradaPullUp) + 1
// Lo que el core sabe de los pines (citas en el Arduino falso): modos y el efecto de analogRead.
const GPIO = { INPUT: 0x01, OUTPUT: 0x03, INPUT_PULLUP: 0x05, ANALOG: 0xc0 } // esp32-hal-gpio.h:45-55
/** driver/gpio.h:174: los de sólo entrada no tienen pull-up ni pull-down. Derivado de placas.ts, no escrito. */
const SIN_PULL_UP = new Set(esp32.pines.filter((p) => p.restricciones.includes("soloEntrada")).map((p) => p.numero))

// ════════════════════════════════════════════════════════════════════════════════════
// Traductor C++ → JS (subconjunto del runtime)
// ════════════════════════════════════════════════════════════════════════════════════

const ESCAPES = { "0": 0, n: 10, r: 13, t: 9, v: 11, f: 12, "\\": 92, "'": 39, '"': 34 }
const codigoDeLiteral = (c) => (c.startsWith("\\") ? ESCAPES[c[1]] : c.charCodeAt(0))
const cadena = (texto) => [...texto].map((c) => c.charCodeAt(0)).concat(0)
const textoDe = (arreglo, largo) => Buffer.from(arreglo.slice(0, largo)).toString("latin1")
/** Un texto de C++ visto desde el Arduino falso: un arreglo de códigos terminado en 0, o ya un string de JS. */
const texto = (x) => (typeof x === "string" ? x : textoDe(x, x.indexOf(0) < 0 ? x.length : x.indexOf(0)))

/**
 * Recorta un comentario `//` de fin de línea, pero no uno que esté adentro de comillas (la capa 3 tiene la
 * URL `http://192.168.4.1/`) ni de un literal de carácter (`'"'` desbalancearía las comillas dobles).
 */
const sinComentarioDeLinea = (linea) => linea.replace(/^((?:[^"'/]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)'|\/(?!\/))*?)\s*\/\/.*$/, "$1")
/** Un fuente TS sin comentarios (de línea y de bloque): para las guardias sobre el código del generador. */
const sinComentariosTs = (ts) => ts.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
/** El C++ sin comentarios: para las guardias que miden código y no citas. */
const sinComentarios = (cpp) =>
  cpp
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .map(sinComentarioDeLinea)
    .join("\n")

/** Traduce el subconjunto de C++ del runtime a JS. Lo que no reconoce, lo deja: si no es JS válido, `new Function` lo dice. */
function traducir(cpp) {
  const parametros = (lista) => lista.split(",").map((p) => p.trim().replace(/\[\]$/, "").split(/\s+/).pop()).filter(Boolean).join(", ")
  return cpp
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith("//") && !linea.startsWith("#include"))
    .map(sinComentarioDeLinea)
    .filter((linea) => !/^static (?!IPAddress|DNSServer|WebServer)\w+ \w+\([^)]*\);$/.test(linea)) // prototipos de hw_* y portal_* (no los objetos del core)
    .join("\n")
    // V4: la página, un literal PROGMEM de varias líneas adyacentes (los escapes de C son los de JS).
    .replace(/^static const char (\w+)\[\] PROGMEM =\n((?:  "(?:[^"\\]|\\.)*"\n)*  "(?:[^"\\]|\\.)*");/gm, (_, nombre, literales) => `const ${nombre} = cadena([${literales.split("\n").join(",")}].join(""));`)
    .replace(/'(\\.|[^'\\])'/g, (_, c) => String(codigoDeLiteral(c)))
    .replace(/^static const char (\w+)\[\] = ("[^"]*");/gm, "const $1 = cadena($2);")
    .replace(/^static const (?:uint8_t|uint16_t|uint32_t) (\w+)\[\] = \{([^}]*)\};/gm, "const $1 = [$2];")
    .replace(/^static const (?:uint8_t|uint16_t|uint32_t|char|bool|int) (\w+) =/gm, "const $1 =")
    // V4: objetos del core, construidos por el Arduino falso.
    .replace(/^static (?:const )?(IPAddress|DNSServer|WebServer) (\w+)(?:\(([^)]*)\))?;/gm, (_, clase, nombre, argumentos) => `const ${nombre} = ${clase}(${argumentos ?? ""});`)
    .replace(/^static (?:char|uint8_t|uint16_t|uint32_t|bool) (\w+)\[([^\]]+)\];/gm, "let $1 = new Array($2).fill(0);")
    .replace(/^static (?:char|uint8_t|uint16_t|uint32_t|bool|int) (\w+) =/gm, "let $1 =")
    .replace(/^static (?:void|bool|uint8_t|uint16_t|uint32_t|int) (\w+)\(([^)]*)\) \{/gm, (_, nombre, lista) => `function ${nombre}(${parametros(lista)}) {`)
    .replace(/void (setup|loop)\(\)/g, "function $1()")
    .replace(/^(\s*)(?:char|uint8_t|uint16_t|uint32_t|int|bool) (\w+)\[(\w+)\];/gm, "$1let $2 = new Array($3).fill(0);")
    .replace(/^(\s*)(?:char|uint8_t|uint16_t|uint32_t|int|bool|esp_reset_reason_t|String) (\w+) =/gm, "$1let $2 =")
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
  const nucleo = new Function(
    "hw",
    "cadena",
    `const { ${nombres.join(", ")} } = hw;\n${js}\nreturn { nucleo_procesar, nucleo_responderReinicio, nucleo_responderHola, g_linea, g_salida, g_modo, LIMITE_LINEA_BYTES, fijarSsid: typeof nucleo_fijarSsid === "function" ? nucleo_fijarSsid : undefined };`,
  )(hw, cadena)
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
  /** V4: lo que hace la capa 3 cuando el punto de acceso levantó: dejarle el SSID al núcleo. */
  const fijarSsid = (ssid) => {
    if (!nucleo.fijarSsid) throw new Error("este nucleo no tiene nucleo_fijarSsid (runtime sin wifi)")
    nucleo.fijarSsid(cadena(ssid))
  }
  return { procesar, arrancar, llamadas, modos, salidas, fijarEntrada: (pin, nivel) => entradas.set(pin, nivel), fijarAnalogico: (pin, crudo) => analogicos.set(pin, crudo), g_modo: nucleo.g_modo, fijarSsid, tieneFijarSsid: Boolean(nucleo.fijarSsid) }
}

const ESP_RST = { UNKNOWN: 0, POWERON: 1, EXT: 2, SW: 3, PANIC: 4, INT_WDT: 5, TASK_WDT: 6, WDT: 7, DEEPSLEEP: 8, BROWNOUT: 9, SDIO: 10 } // esp_system.h:42-52

// V4: lo que el Arduino falso sabe del core para la capa 3.
const WIFI_MODE = { NULL: 0, STA: 1, AP: 2, APSTA: 3 } // esp_wifi_types.h: wifi_mode_t
const HTTP = { GET: 1, POST: 3, HEAD: 2, PUT: 4 } // http_parser.h:96-99
const WIFI_POWER_11dBm = 44 // WiFiGeneric.h:120
const WIFI_SECOND_CHAN_NONE = 0 // esp_wifi_types.h:129
const CANAL_POR_DEFECTO = 1 // WiFiAP.h:40: channel = 1 si no se pasa
const MAC_DE_PRUEBA = [0x24, 0x0a, 0xc4, 0x12, 0x3f, 0x2a] // → ssid "tecnia-3f2a"
const SSID_DE_PRUEBA = "tecnia-3f2a"
const WIFI_DE_PRUEBA = { ssid: SSID_DE_PRUEBA, clave: "", ip: IP_TEXTO }

/** Un `String` del core visto desde el C++ traducido: `length()`, `charAt(i)` (código) y `equals(texto)`. */
const stringFalso = (s) => ({ length: () => s.length, charAt: (i) => s.charCodeAt(i), equals: (x) => s === texto(x), valor: s })

/**
 * El `WebServer` del core, falso: `on`/`onNotFound`/`begin`, y `handleClient` atiende UN pedido de la cola
 * (un cliente a la vez, como el real: WebServer.cpp:275-342). El cuerpo de un POST que no es formulario llega
 * entero como argumento "plain" (Parsing.cpp:199-221); con cuerpo vacío no hay "plain" (:206, :222-225).
 */
const crearServidorFalso = (puerto, llamadas) => {
  const rutas = []
  let noEncontrado = null
  let actual = null
  let respuesta = null
  const s = {
    puerto,
    iniciado: false,
    cola: [],
    respuestas: [],
    on: (uri, metodo, fn) => rutas.push({ uri: texto(uri), metodo, fn }),
    onNotFound: (fn) => {
      noEncontrado = fn
    },
    begin: () => {
      llamadas.push(["server.begin", puerto])
      s.iniciado = true
    },
    hostHeader: () => stringFalso(actual?.host ?? ""),
    arg: (nombre) => stringFalso(texto(nombre) === "plain" ? (actual?.plain ?? "") : ""),
    sendHeader: (nombre, valor, primero = false) => respuesta.encabezados.push([texto(nombre), texto(valor), primero]),
    send: (codigo, tipo, contenido) => {
      if (respuesta.codigo !== null) throw new Error("send dos veces en el mismo pedido")
      respuesta.codigo = codigo
      respuesta.tipo = texto(tipo)
      respuesta.cuerpo = texto(contenido)
    },
    send_P: (codigo, tipo, contenido) => s.send(codigo, tipo, contenido),
    handleClient: () => {
      if (!s.iniciado || s.cola.length === 0) return
      actual = s.cola.shift()
      respuesta = { codigo: null, tipo: null, cuerpo: null, encabezados: [], pedido: actual }
      const ruta = rutas.find((r) => r.uri === actual.ruta && r.metodo === actual.metodo)
      if (ruta) ruta.fn()
      else if (noEncontrado) noEncontrado()
      else respuesta.codigo = 404
      s.respuestas.push(respuesta)
      actual = null
    },
  }
  return s
}

/** El programa COMPLETO (las dos capas, o las tres) sobre un Arduino falso que registra cada llamada y lo que sale por el serie. */
function ejecutarPrograma(cpp = MAIN, { causa = ESP_RST.POWERON, reloj = () => 0, mac = MAC_DE_PRUEBA, apLevanta = true, configLevanta = true, heapLibre = 0, stackLibre = 0 } = {}) {
  // `niveles` es el registro de salida (lo que escribió digitalWrite); el pin sólo lo muestra con el driver de salida
  // habilitado (OUTPUT). `modos` es lo que el core configuró con pinMode, incluido ANALOG tras analogRead.
  const placa = { modos: new Map(), niveles: new Map(), canales: new Map(), lecturas: new Map(), analogicos: new Map(), llamadas: [], modoWifi: WIFI_MODE.NULL, persistente: true, potencia: null, canalWifi: CANAL_POR_DEFECTO, servidor: null, dns: null }
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
    INPUT: GPIO.INPUT, // esp32-hal-gpio.h:45
    OUTPUT: GPIO.OUTPUT, // :48
    INPUT_PULLUP: GPIO.INPUT_PULLUP, // :50
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
    // gpio_set_level (driver/gpio.h:130-140) escribe el registro de salida; el pad lo muestra sólo con el driver de
    // salida habilitado (modo con el bit OUTPUT, esp32-hal-gpio.c:109-128: ANALOG >= 0x20 deja GPIO_MODE_DISABLE).
    digitalWrite: (pin, nivel) => {
      placa.llamadas.push(["digitalWrite", pin, nivel])
      placa.niveles.set(pin, nivel)
    },
    // gpio_get_level (driver/gpio.h:143-154): "If the pad is not configured for input ... the returned value is always 0".
    // INPUT, OUTPUT (0x03 incluye INPUT) e INPUT_PULLUP leen; ANALOG (0xC0) y sin configurar no. Un pull-up pedido en un
    // pin que no lo tiene (driver/gpio.h:174) no sube nada: el pin flota y, determinista, se lee 0.
    digitalRead: (pin) => {
      placa.llamadas.push(["digitalRead", pin])
      const modo = placa.modos.get(pin) ?? 0
      if ((modo & GPIO.INPUT) === 0 || modo >= 0x20) return 0
      if (placa.lecturas.has(pin)) return placa.lecturas.get(pin)
      if (modo === GPIO.OUTPUT) return placa.niveles.get(pin) ?? 0
      return modo === GPIO.INPUT_PULLUP && !SIN_PULL_UP.has(pin) ? 1 : 0
    },
    // __analogReadRaw → __adcAttachPin → pinMode(pin, ANALOG) (esp32-hal-adc.c:161, :109, :136): el pin queda sin driver digital.
    analogRead: (pin) => {
      placa.llamadas.push(["analogRead", pin])
      placa.modos.set(pin, GPIO.ANALOG)
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
    // --- V4: WiFi, DNS y HTTP del core ---
    WIFI_AP: WIFI_MODE.AP, // WiFiType.h:34
    WIFI_POWER_11dBm,
    WIFI_SECOND_CHAN_NONE,
    NULL: null,
    ESP: { getFreeHeap: () => heapLibre }, // Esp.h:69
    uxTaskGetStackHighWaterMark: (tarea) => (tarea === null ? stackLibre : 0), // freertos/task.h:1778: NULL = la tarea que llama
    // esp_wifi.h:615: exige WiFi iniciado; se registra el canal pedido. (Sólo compilado con la opción `canal`.)
    esp_wifi_set_channel: (primario, segundo) => {
      placa.llamadas.push(["esp_wifi_set_channel", primario, segundo])
      if (placa.modoWifi === WIFI_MODE.NULL) return 0x3002 // ESP_ERR_WIFI_NOT_INIT
      placa.canalWifi = primario
      return 0
    },
    HTTP_GET: HTTP.GET,
    HTTP_POST: HTTP.POST,
    IPAddress: (a, b, c, d) => `${a}.${b}.${c}.${d}`,
    WiFi: {
      // WiFiGeneric.cpp:1229-1232: sólo guarda el flag; mode() lo usa al iniciar (:1256 → wifiLowLevelInit, :693-695).
      persistent: (valor) => {
        placa.llamadas.push(["WiFi.persistent", valor])
        placa.persistente = valor
      },
      mode: (modo) => {
        placa.llamadas.push(["WiFi.mode", modo])
        placa.modoWifi = modo
      },
      // WiFiGeneric.cpp:1406-1412: false (y un log_w) si ni AP ni STA arrancaron; el AP arranca en softAP (enableAP).
      setTxPower: (potencia) => {
        placa.llamadas.push(["WiFi.setTxPower", potencia])
        if (!placa.apIniciado) return false
        placa.potencia = potencia
        return true
      },
      // WiFiGeneric.cpp:1213-1221: el canal primario actual (esp_wifi_get_channel), 0 si no se inició.
      channel: () => (placa.apIniciado ? placa.canalWifi : 0),
      // WiFiAP.cpp:337-343: solo llena la MAC si el modo no es NULL.
      softAPmacAddress: (destino) => {
        placa.llamadas.push(["WiFi.softAPmacAddress"])
        if (placa.modoWifi !== WIFI_MODE.NULL) for (let i = 0; i < 6; i++) destino[i] = mac[i]
        return destino
      },
      // WiFiAP.cpp:136-175: SSID vacio o clave de 1..7 bytes → false. Clave NULL u omitida = red abierta (WiFiAP.h:40,
      // WiFiAP.cpp:107,115-119). Se registra el canal TAL CUAL se paso (undefined = no se paso: el por defecto, V4-3).
      softAP: (ssid, clave, canal) => {
        const claveTexto = clave === null || clave === undefined ? null : texto(clave)
        placa.llamadas.push(["WiFi.softAP", texto(ssid), claveTexto, canal])
        if (texto(ssid).length === 0 || (claveTexto !== null && claveTexto.length > 0 && claveTexto.length < 8)) return false
        placa.apIniciado = apLevanta
        return apLevanta
      },
      softAPConfig: (ip, puerta, mascara) => {
        placa.llamadas.push(["WiFi.softAPConfig", ip, puerta, mascara])
        return configLevanta
      },
    },
    DNSServer: () => {
      placa.dns = {
        start: (puerto, dominio, ip) => placa.llamadas.push(["dns.start", puerto, texto(dominio), ip]),
        processNextRequest: () => {},
      }
      return placa.dns
    },
    WebServer: (puerto) => {
      placa.servidor = crearServidorFalso(puerto, placa.llamadas)
      return placa.servidor
    },
  }
  const js = traducir(cpp)
  const nombres = Object.keys(hw)
  const programa = new Function("hw", "cadena", `const { ${nombres.join(", ")} } = hw;\n${js}\nreturn { setup, loop };`)(hw, cadena)
  const enviar = (texto) => rx.push(...Buffer.from(texto, "utf8"))
  const leerSalida = () => salida.splice(0, salida.length)
  /**
   * V4: un pedido HTTP al servidor falso, atendido en el próximo loop(). `cuerpo` sólo llega como "plain" si el
   * método lleva cuerpo, no está vacío y el Content-Type no es de formulario (Parsing.cpp:134-225).
   */
  const pedir = ({ metodo = "GET", ruta = "/", host = IP_TEXTO, cuerpo = "", formulario = false } = {}) => {
    if (!placa.servidor) throw new Error("este runtime no tiene WebServer (sin wifi)")
    const conCuerpo = ["POST", "PUT"].includes(metodo) && cuerpo.length > 0 && !formulario
    placa.servidor.cola.push({ metodo: HTTP[metodo], ruta, host, plain: conCuerpo ? cuerpo : "" })
    programa.loop()
    const r = placa.servidor.respuestas.shift()
    if (!r) throw new Error("el servidor no atendio el pedido")
    return r
  }
  return { ...programa, placa, enviar, leerSalida, pendiente: () => tx, pedir }
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
  // V4-7: el ini del RUNTIME lleva -DCORE_DEBUG_LEVEL=0 (esp32-hal-log.h:36-39: sin la macro, el core toma
  // CONFIG_ARDUHAL_LOG_DEFAULT_LEVEL = 1 y log_e imprime prosa por UART0). El ini de generarPrograma NO cambia:
  // renderizarPlatformioIni(placa) sin opciones (programa.ts:382) sigue con su hash de siempre.
  assert.deepEqual(BUILD_FLAGS_RUNTIME, ["-DCORE_DEBUG_LEVEL=0"])
  assert.match(INI, /^build_flags = -DCORE_DEBUG_LEVEL=0$/m)
  assert.equal(INI, `${renderizarPlatformioIni(esp32).contenido.trimEnd()}\nbuild_flags = -DCORE_DEBUG_LEVEL=0\n`, "el ini del runtime es el de generarPrograma mas una linea")
  assert.equal(sha(renderizarPlatformioIni(esp32).contenido), "b4ea2df4fc2401ec488b0254ff714176119e561447817a99631de64da7321fde", "el ini de generarPrograma, intacto")
  assert.doesNotMatch(INI, /-W/, "las -W de la compilacion de prueba (E1-E3) no van al ini de produccion")
  assert.match(readFileSync(join(REPO, "opencode/codegen/runtime.ts"), "utf8"), /esp32-hal-log\.h:36-3\d/, "V4-7 cita donde el core lee CORE_DEBUG_LEVEL")
  // Hashes fijados: cualquier cambio del generador los mueve a propósito (y el commit lo dice). El de V1 se movió
  // por V4-6 (modo del pin tras analogico.leer y tabla PINES_SIN_PULL_UP) y por los nombres de G-02: ya no es el
  // binario del E2E físico del 2026-10-13 (c7b8a9b6…); el próximo E2E lo vuelve a fijar.
  assert.equal(sha(INI), "214e1e08b9e73e97c21c3cb1f38490856bbb615c83aaff89728600ae0af86185")
  assert.equal(sha(MAIN), "47da489bd082f63376435db4c2fc98ef55723df968549fcee88dffee9155b240")
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
  for (const cita of ["esp32-hal-gpio.h:45", "esp32-hal-ledc.c:19-21", "esp32-hal-ledc.c:163-181", "esp32-hal-adc.c:29", "esp32-hal-adc.c:136", "esp_system.h:42-52", "HardwareSerial.h:230", "esp32-hal-matrix.c:43-46", "driver/gpio.h:174"]) {
    assert.ok(transporte.includes(cita), `cita ${cita}`)
  }
  assert.match(MAIN, /PWM_FRECUENCIA_HZ = 5000;/)
  assert.match(MAIN, /PWM_BITS = 8;/)
  assert.match(MAIN, /VELOCIDAD_SERIE = 115200;/)
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(MAIN), "el C++ generado es ASCII")
  // G-02: los números con nombre y su derivación; un solo centinela 255 en todo el programa.
  assert.match(MAIN, /^static const uint16_t ARMAZON_JSON_BYTES = 69;/m)
  assert.equal(Number(MAIN.match(/ARMAZON_JSON_BYTES = (\d+);/)[1]), P.serializarRespuesta(P.respuestaDeError({ codigo: "CAMPO_DESCONOCIDO", comando: "", campo: "" })).length)
  assert.equal(Number(MAIN.match(/HOLA_MAXIMO_BYTES = (\d+);/)[1]), holaV1.length, "sin wifi el hola más largo es el hola")
  assert.match(MAIN, /TAMANO_SALIDA = \(PEOR_ERROR_BYTES > HOLA_MAXIMO_BYTES \? PEOR_ERROR_BYTES : HOLA_MAXIMO_BYTES\) \+ 1;/)
  assert.match(MAIN, /ENTERO_MAXIMO_SIN_ULTIMO_DIGITO = 429496729;/)
  assert.match(MAIN, /ULTIMO_DIGITO_DEL_ENTERO_MAXIMO = 5;/)
  assert.match(MAIN, /DIGITOS_DEL_ENTERO_MAXIMO = 10;/)
  assert.equal((sinComentarios(MAIN).match(/\b429496729\b/g) ?? []).length, 1, "el 429496729 aparece una sola vez: en su definición con nombre")
  assert.doesNotMatch(sinComentarios(MAIN), /digitos\[10\]|\+ 128\b|largo > 10\b/, "ningún número mágico suelto")
  assert.equal((sinComentarios(MAIN).match(/= 255;/g) ?? []).length, 2, "255 aparece como SIN_INDICE y como PWM_DUTY_MAXIMO (2^8 - 1); SIN_CANAL es un alias")
  assert.match(MAIN, /^static const uint8_t SIN_CANAL = SIN_INDICE;/m)
  // L-02/L-03/K-02: el C++ cita "sec. N" y los ids V4-x; el TS cita "§N" y no dice "decisión por chat".
  for (const fuente of ["opencode/codegen/runtime.ts", "opencode/codegen/runtime-cpp.ts", "opencode/vivo/pagina-portal.ts"]) {
    const ts = readFileSync(join(REPO, fuente), "utf8")
    assert.match(ts.split("\n")[0], /^\/\/ Modo Vivo \(protocolo v1, slices V1–V4\)/, `${fuente}: cabecera`)
    const soloTs = ts.split("\n").filter((l) => !/l\.push\(|valor: \[/.test(l)).join("\n")
    assert.doesNotMatch(soloTs, /\bsec\. \d/, `${fuente}: "sec." sólo en las líneas C++`)
    assert.doesNotMatch(ts, /por chat|decisi[oó]n de Alejandro/, `${fuente}: se cita el id de §9, no el chat`)
  }
  assert.doesNotMatch(MAIN, /§/, "el C++ es ASCII: cita sec.")
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
  // V4-6: la tabla de los sin pull-up sale de las capacidades (driver/gpio.h:174: pull-up sólo con entrada Y salida),
  // no de números escritos; en la ESP32 coincide con la restricción soloEntrada del registro.
  assert.deepEqual(tablaDelCpp("PINES_SIN_PULL_UP"), numeros((p) => p.restricciones.includes("soloEntrada")))
  assert.deepEqual(tablaDelCpp("PINES_SIN_PULL_UP"), numeros((p) => !(p.capacidades.entradaDigital && p.capacidades.salidaDigital)))
  assert.deepEqual(tablaDelCpp("PINES_SIN_PULL_UP"), [34, 35, 36, 39])
  assert.doesNotMatch(sinComentariosTs(readFileSync(join(REPO, "opencode/codegen/runtime.ts"), "utf8")), /\b3[4569]\b/, "runtime.ts no escribe 34..39 (las citas en comentarios no cuentan)")
})

test("B2 K-01: el C++ emitido reclama los campos faltantes en el orden de protocolo.ts::CAMPOS_POR_COMANDO (la única tabla; runtime.ts ya no tiene copia)", () => {
  // La tabla que el C++ lleva compilada, leída del C++: `if (comando == COMANDO_X && posicion == i) return CAMPO_Y;`
  const delCpp = {}
  for (const [, comando, posicion, campo] of MAIN.matchAll(/^  if \(comando == COMANDO_(\w+) && posicion == (\d+)\) return CAMPO_(\w+);$/gm)) {
    ;(delCpp[comando] ??= [])[Number(posicion)] = campo
  }
  const esperada = Object.fromEntries(Object.entries(P.CAMPOS_POR_COMANDO).map(([c, campos]) => [identificador(c), campos.map(identificador)]).filter(([, campos]) => campos.length > 0))
  assert.deepEqual(delCpp, esperada, "misma tabla, mismo orden")
  const fuente = readFileSync(join(REPO, "opencode/codegen/runtime.ts"), "utf8")
  assert.doesNotMatch(fuente, /CAMPOS_POR_COMANDO\s*[:=]/, "sin copia de la tabla en runtime.ts")
  assert.match(fuente, /import \{[^}]*\bCAMPOS_POR_COMANDO\b[^}]*\} from "\.\.\/vivo\/protocolo\.ts"/, "se importa la de protocolo.ts")
  // Y la tabla importada es la que el parser de referencia aplica.
  const ejemplo = { pin: "23", modo: "salida", nivel: "alto", porcentaje: "50" }
  for (const comando of P.COMANDOS_V1) {
    const campos = P.CAMPOS_POR_COMANDO[comando]
    const completa = [comando, ...campos.map((c) => `${c}=${ejemplo[c]}`)].join(" ")
    assert.equal(P.parsearLineaDeComando(completa).ok, true, completa)
    for (let i = 0; i < campos.length; i++) {
      const sinUno = [comando, ...campos.filter((_, j) => j !== i).map((c) => `${c}=${ejemplo[c]}`)].join(" ")
      assert.deepEqual(P.parsearLineaDeComando(sinUno).error, { codigo: "CAMPO_FALTANTE", comando, campo: campos[i] }, sinUno)
    }
    const conExtra = `${completa} extra=1`
    assert.equal(P.parsearLineaDeComando(conExtra).error.codigo, "CAMPO_DESCONOCIDO")
  }
  assert.deepEqual(Object.keys(P.CAMPOS_POR_COMANDO).sort(), [...P.COMANDOS_V1])
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
  assert.equal(CASOS_DORADOS.length, 33, "26 de V1 + 7 de V4-6 (pull-up en sólo entrada; modo del pin tras analogico.leer)")
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
  // V4-6 (A2 A1): escribir → leer analógico → escribir → releer, en un pin que es salida y ADC a la vez (33); y
  // PWM → analógico → PWM → releer; y pull-up → analógico → leer digital en uno de sólo entrada.
  "digital.escribir pin=33 nivel=alto",
  "digital.leer pin=33",
  "analogico.leer pin=33",
  "digital.leer pin=33",
  "digital.escribir pin=33 nivel=alto",
  "digital.leer pin=33",
  "pwm.escribir pin=33 porcentaje=40",
  "analogico.leer pin=33",
  "digital.leer pin=33",
  "pwm.escribir pin=33 porcentaje=100",
  "digital.leer pin=33",
  "pin.modo pin=35 modo=entradaPullUp",
  "pin.modo pin=35 modo=entrada",
  "analogico.leer pin=35",
  "digital.leer pin=35",
  "pin.modo pin=36 modo=entradaPullUp",
  "pin.modo pin=39 modo=entradaPullUp",
  "pin.modo pin=32 modo=entradaPullUp",
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
  assert.equal(nucleo.g_modo[33], MODO_SALIDA, "el pwm 100 % lo dejó como salida")
  assert.equal(nucleo.g_modo[35], MODO_ENTRADA, "tras analogico.leer, el digital.leer lo volvió a configurar como entrada")
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
  nucleo.procesar("pin.modo pin=34 modo=entradaPullUp")
  assert.deepEqual(nucleo.llamadas, [], "un comando rechazado por política no toca el hardware (tampoco el pull-up en un pin sin pull-up, V4-6)")
  nucleo.procesar("analogico.leer pin=34")
  assert.deepEqual(nucleo.llamadas, [["leerAnalogico", 34]], "analogico.leer no pide pinModo: el core ya deja el pin en ANALOG")
  assert.equal(nucleo.g_modo[34], 0, "V4-6: tras analogico.leer el pin queda SIN configurar")
  nucleo.fijarAnalogico(34, 4095)
  assert.deepEqual(nucleo.procesar("analogico.leer pin=34"), ['{"crudo":4095,"pin":34,"tipo":"lectura"}'])
  nucleo.fijarEntrada(32, 1)
  assert.deepEqual(nucleo.procesar("digital.leer pin=32"), ['{"nivel":"alto","pin":32,"tipo":"lectura"}'])
  // V4-6: escribir → analógico → escribir: la segunda escritura vuelve a pedir pinModo(salida); antes no lo hacía.
  nucleo.llamadas.length = 0
  nucleo.procesar("digital.escribir pin=33 nivel=alto")
  nucleo.procesar("analogico.leer pin=33")
  nucleo.procesar("digital.escribir pin=33 nivel=alto")
  assert.deepEqual(nucleo.llamadas, [["pinModo", 33, MODO_SALIDA], ["escribirDigital", 33, 1], ["leerAnalogico", 33], ["pinModo", 33, MODO_SALIDA], ["escribirDigital", 33, 1]])
  nucleo.llamadas.length = 0
  nucleo.procesar("analogico.leer pin=33")
  nucleo.procesar("digital.leer pin=33")
  assert.deepEqual(nucleo.llamadas, [["leerAnalogico", 33], ["pinModo", 33, MODO_ENTRADA], ["leerDigital", 33]], "tras analógico, la lectura digital configura entrada")
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
  // V4-6: una lectura analógica sobre un pin con PWM suelta el canal (el pad queda en ANALOG, el driver apagado);
  // el PWM siguiente vuelve a enganchar. GPIO33 es salida y ADC a la vez.
  ll = desde()
  prog.enviar("pwm.escribir pin=33 porcentaje=10\nanalogico.leer pin=33\npwm.escribir pin=33 porcentaje=20\n")
  prog.loop()
  assert.deepEqual(ll(), [["ledcSetup", 0, 5000, 8], ["ledcAttachPin", 33, 0], ["ledcWrite", 0, 26], ["ledcDetachPin", 33], ["pinMode", 33, 0x03], ["analogRead", 33], ["ledcSetup", 0, 5000, 8], ["ledcAttachPin", 33, 0], ["ledcWrite", 0, 51]])
  assert.deepEqual(prog.leerSalida(), ['{"comando":"pwm.escribir","pin":33,"tipo":"ok"}', '{"crudo":0,"pin":33,"tipo":"lectura"}', '{"comando":"pwm.escribir","pin":33,"tipo":"ok"}'])
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

test("D5 V4-6 en el Arduino falso: tras analogRead el pin queda en ANALOG y digitalWrite no se ve; el runtime reconfigura y la escritura siguiente se ve; entradaPullUp en 34-39 se rechaza; y el falso VE el bug si vuelve", () => {
  const prog = ejecutarPrograma(MAIN)
  prog.setup()
  prog.leerSalida()
  prog.enviar(["digital.escribir pin=32 nivel=alto", "digital.leer pin=32", "analogico.leer pin=32", "digital.leer pin=32", "digital.escribir pin=32 nivel=alto", "digital.leer pin=32"].join("\n") + "\n")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [
    '{"comando":"digital.escribir","pin":32,"tipo":"ok"}',
    '{"nivel":"alto","pin":32,"tipo":"lectura"}',
    '{"crudo":0,"pin":32,"tipo":"lectura"}',
    '{"nivel":"bajo","pin":32,"tipo":"lectura"}',
    '{"comando":"digital.escribir","pin":32,"tipo":"ok"}',
    '{"nivel":"alto","pin":32,"tipo":"lectura"}',
  ])
  assert.equal(prog.placa.modos.get(32), GPIO.OUTPUT, "el pad terminó como salida de verdad")
  // Los mismos bytes que el simulador de referencia (los casos dorados de V4-6, sobre el programa entero).
  const simulador = crearRuntimeSimulado()
  simulador.arrancar()
  for (const caso of CASOS_DORADOS.slice(26)) {
    prog.enviar(`${caso.entrada}\n`)
    prog.loop()
    assert.deepEqual(prog.leerSalida(), simulador.procesar(caso.entrada), caso.entrada)
    assert.deepEqual(prog.leerSalida(), [], "nada de más")
  }
  // Pull-up en un pin de sólo entrada: PIN_SIN_CAPACIDAD y ningún pinMode (antes: ok con el pin flotando).
  const n = prog.placa.llamadas.length
  prog.enviar("pin.modo pin=36 modo=entradaPullUp\npin.modo pin=36 modo=entrada\ndigital.leer pin=36\n")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), ['{"codigo":"PIN_SIN_CAPACIDAD","comando":"pin.modo","pin":36,"tipo":"error"}', '{"comando":"pin.modo","pin":36,"tipo":"ok"}', '{"nivel":"bajo","pin":36,"tipo":"lectura"}'])
  assert.deepEqual(prog.placa.llamadas.slice(n), [["pinMode", 36, GPIO.INPUT], ["digitalRead", 36]])
  // El Arduino falso se prueba a sí mismo: con el bug de vuelta (el núcleo no olvida el modo tras analogico.leer) la
  // última lectura da "bajo" (el pad sigue en ANALOG, digitalWrite inerte); y un pull-up pedido en 34-39 lee 0.
  const conBug = MAIN.replace("  g_modo[pin] = MODO_SIN_CONFIGURAR;\n", "")
  assert.notEqual(conBug, MAIN, "el mutante existe")
  const mutante = ejecutarPrograma(conBug)
  mutante.setup()
  mutante.leerSalida()
  mutante.enviar("digital.escribir pin=32 nivel=alto\nanalogico.leer pin=32\ndigital.escribir pin=32 nivel=alto\ndigital.leer pin=32\n")
  mutante.loop()
  assert.equal(mutante.leerSalida().at(-1), '{"nivel":"bajo","pin":32,"tipo":"lectura"}', "con el bug, el ok es falso y el falso lo ve")
  assert.equal(mutante.placa.modos.get(32), GPIO.ANALOG)
  const sinPullUp = ejecutarPrograma(MAIN.replace("if (necesita == NECESITA_ENTRADA_CON_PULL_UP && (nucleo_pinSinEntrada(pin) || nucleo_pinSinPullUp(pin)))", "if (false)"))
  sinPullUp.setup()
  sinPullUp.leerSalida()
  sinPullUp.enviar("pin.modo pin=36 modo=entradaPullUp\ndigital.leer pin=36\npin.modo pin=4 modo=entradaPullUp\ndigital.leer pin=4\n")
  sinPullUp.loop()
  assert.deepEqual(sinPullUp.leerSalida(), ['{"comando":"pin.modo","pin":36,"tipo":"ok"}', '{"nivel":"bajo","pin":36,"tipo":"lectura"}', '{"comando":"pin.modo","pin":4,"tipo":"ok"}', '{"nivel":"alto","pin":4,"tipo":"lectura"}'], "sin la guardia: ok falso en 36 (flota, lee bajo); en 4 el pull-up sí sube")
})

// ════════════════════════════════════════════════════════════════════════════════════
// F — V4: red propia, DNS cautivo, HTTP y página
// ════════════════════════════════════════════════════════════════════════════════════

const holaV1 = CASOS_DORADOS[0].salida[0]
const holaConWifi = (wifi = WIFI_DE_PRUEBA) => P.serializarRespuesta({ tipo: "hola", runtime: RUNTIME_VERSION, protocolo: 1, placa: esp32.id, comandos: [...P.COMANDOS_V1], protocolos: [], wifi })

test("F1 forma: el runtime de sólo serie no cambia ni un byte; con wifi el hash está fijado, hay tres capas e includes del core; la clave es \"\" u 8 dígitos; canal y diagnóstico sólo con su opción", () => {
  assert.equal(sha(MAIN), "47da489bd082f63376435db4c2fc98ef55723df968549fcee88dffee9155b240", "el hash de V1 (sin wifi) no se mueve con la opción")
  assert.doesNotMatch(MAIN, /WiFi|WebServer|DNSServer|CAPA 3|String|wifi|ssid/i, "sin la opción no hay rastro de la red")
  assert.equal(INI_WIFI, INI, "el platformio.ini es el mismo: las librerías son del core, sin lib_deps")
  assert.deepEqual(generarRuntime(esp32, { wifi: { clave: "" }, pagina: PAGINA_DE_PRUEBA }), generadoWifi, "determinista")
  assert.throws(() => generarRuntime(esp32, { wifi: { clave: "" } }), /pagina .*obligatoria/, "con wifi, la página es obligatoria")
  assert.deepEqual(generarRuntime(esp32, { pagina: PAGINA_DE_PRUEBA }), generado, "sin wifi, la página no cambia nada: el runtime es el de V1")
  assert.ok(MAIN_WIFI.indexOf(CABECERA_NUCLEO) < MAIN_WIFI.indexOf(CABECERA_TRANSPORTE) && MAIN_WIFI.indexOf(CABECERA_TRANSPORTE) < MAIN_WIFI.indexOf(CABECERA_PORTAL), "capa 1 < capa 2 < capa 3")
  for (const inc of ["#include <Arduino.h>", "#include <WiFi.h>", "#include <DNSServer.h>", "#include <WebServer.h>"]) assert.ok(MAIN_WIFI.includes(inc), inc)
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(MAIN_WIFI), "ASCII")
  assert.doesNotMatch(MAIN_WIFI, /\d{4}-\d{2}-\d{2}T/, "sin marcas temporales")
  // Hashes fijados: red abierta (el default) y con clave. Cambiarlos es a propósito y el commit lo dice.
  assert.equal(sha(MAIN_WIFI), "62d0f177ff8ece8146ac9e3585c4d46229b38bce555e0c4ecf629fd7d9b1e279")
  assert.equal(sha(MAIN_WIFI_CON_CLAVE), "f2929a24d4b98f14eaf9ad49f4893bc55c2ca2939a0e30d509beee6071e820bf")
  assert.equal(sha(MAIN_WIFI_SSID_FIJO), "fade204de4bf210617dc565e356fbb2c229449e7d569bdbe774e587f55ac643b")
  assert.ok(MAIN_WIFI.includes('static const char TEXTO_WIFI_CLAVE[] = "";') && MAIN_WIFI.includes("WiFi.softAP(ssid))"), "abierta: clave vacía en el hola y softAP(ssid) solo (passphrase NULL por defecto, WiFiAP.h:40)")
  assert.ok(MAIN_WIFI_CON_CLAVE.includes(`static const char TEXTO_WIFI_CLAVE[] = "${CLAVE_WIFI}";`) && MAIN_WIFI_CON_CLAVE.includes("WiFi.softAP(ssid, TEXTO_WIFI_CLAVE))"), "con clave: la clave va al softAP, sin canal")
  // V4-3: nunca se pasa un canal a softAP ni se elige por MAC. G-04: en el C++ queda UNA línea con el id; la historia
  // del E2E (con canal 6/11 la red no se veía) vive en runtime-cpp.ts, no en cada main.cpp.
  for (const main of [MAIN_WIFI, MAIN_WIFI_CON_CLAVE, MAIN_WIFI_SSID_FIJO]) {
    const codigo = sinComentarios(main)
    assert.doesNotMatch(codigo, /WiFi\.softAP\([^)]*,[^)]*,/, "softAP con tres argumentos (canal explícito)")
    assert.doesNotMatch(codigo, /CANALES_WIFI|g_canalWifi|% 3|esp_wifi_set_channel|CANAL_WIFI/, "sin elección de canal, sin canal explícito")
    assert.equal((main.match(/Decision V4-3/g) ?? []).length, 1, "la decisión está anotada en el C++, en una sola línea")
    assert.doesNotMatch(main, /no se veia|6 u 11/, "la historia del E2E no va en el C++")
  }
  assert.match(readFileSync(join(REPO, "opencode/codegen/runtime-cpp.ts"), "utf8"), /Historia del E2E físico del 2026-10-13[\s\S]*canal explícito 6 u 11[\s\S]*WiFiAP\.cpp:152/, "la historia, con la cita de H7, está en el TS")
  // Opción `canal` (experimento de V4-3): esp_wifi_set_channel DESPUÉS de softAP, con su include; 1..13 y nada más.
  const conCanal = generarRuntime(esp32, { wifi: { clave: "", canal: 6 }, pagina: PAGINA_DE_PRUEBA }).archivos["src/main.cpp"]
  assert.ok(conCanal.includes("#include <esp_wifi.h>") && conCanal.includes("static const uint8_t CANAL_WIFI = 6;") && conCanal.includes("esp_wifi_set_channel(CANAL_WIFI, WIFI_SECOND_CHAN_NONE);"))
  assert.ok(conCanal.indexOf("WiFi.softAP(") < conCanal.indexOf("esp_wifi_set_channel(") && conCanal.includes("esp_wifi.h:615"), "después de softAP, con la cita")
  assert.doesNotMatch(sinComentarios(conCanal), /WiFi\.softAP\([^)]*,[^)]*,/, "el canal no va en softAP (H7: wifi_config_t sin memset)")
  assert.ok(!MAIN_WIFI.includes("<esp_wifi.h>"), "sin la opción, sin el include")
  assert.equal(CANAL_WIFI_MINIMO, 1)
  assert.equal(CANAL_WIFI_MAXIMO, 13)
  for (const canal of [0, 14, 1.5, "6", -1, null]) assert.throws(() => generarRuntime(esp32, { wifi: { clave: "", canal }, pagina: PAGINA_DE_PRUEBA }), /canal WiFi/, JSON.stringify(canal))
  for (const canal of [1, 6, 11, 13]) assert.doesNotThrow(() => generarRuntime(esp32, { wifi: { clave: "", canal }, pagina: PAGINA_DE_PRUEBA }))
  // Opción `diagnostico`: sin ella, ni la palabra; con ella, la función y su llamada en loop().
  assert.doesNotMatch(MAIN_WIFI, /diagnostic|heapLibre|stackLibre|getFreeHeap|uxTaskGetStackHighWaterMark/i, "sin la opción no se compila nada del diagnóstico")
  const conDiagnostico = generarRuntime(esp32, { wifi: { clave: "", diagnostico: true }, pagina: PAGINA_DE_PRUEBA }).archivos["src/main.cpp"]
  assert.ok(conDiagnostico.includes("static void portal_diagnosticar() {") && seccionTransporte(conDiagnostico).includes("  portal_diagnosticar();"))
  assert.throws(() => generarRuntime(esp32, { wifi: { clave: "", diagnostico: "si" }, pagina: PAGINA_DE_PRUEBA }), /true o false/)
  assert.deepEqual(generarRuntime(esp32, { wifi: { clave: "", diagnostico: false }, pagina: PAGINA_DE_PRUEBA }), generadoWifi, "false = ausente")
  for (const clave of ["1234567", "123456789", "abcdefgh", "4821390 ", " 48213907", "4821-907", 48213907, undefined, null]) {
    assert.throws(() => generarRuntime(esp32, { wifi: { clave }, pagina: PAGINA_DE_PRUEBA }), /8 digitos/, JSON.stringify(clave))
  }
  // La página se valida contra la política de la placa, lista por lista: existe, no prohibido, y la capacidad del rol.
  const con = (cambios) => ({ ...PAGINA_DE_PRUEBA, ...cambios })
  const paginasMalas = [
    [con({ salidas: [6] }), /prohibido/, "GPIO6 (flash) como salida"],
    [con({ entradasDigitales: [1] }), /prohibido/, "GPIO1 (UART0) como entrada"],
    [con({ salidasExtra: [35] }), /no puede ser salida/, "GPIO35 (sólo entrada) como salida"],
    [con({ salidasExtra: [34] }), /GPIO34 esta en dos listas/, "GPIO34 ya está como analógica: la forma gana antes que la política"],
    [con({ entradasAnalogicas: [2] }), /no puede ser entrada analogica/, "GPIO2 (sin ADC) como analógica"],
    [con({ salidas: [40] }), /no existe/, "GPIO40 no existe"],
    [con({ entradasDigitales: [4, 4] }), /repite/, "repetido en su rol"],
    [con({ salidas: [18], salidasExtra: [18] }), /dos listas a la vez \(salidas y salidasExtra\)/, "el mismo en las dos listas de salidas"],
    [con({ salidas: "18" }), /lista de numeros/, "no es una lista"],
    [con({ salidas: [2.5] }), /lista de numeros/, "no entero (forma: la página)"],
    [{ salidas: [18] }, /lista de numeros/, "faltan listas"],
    [null, /obligatoria/, "null"],
    [con({ salidasConAviso: [35] }), /salidasConAviso: GPIO35 no puede ser salida/, "V4-6c: los con aviso también son salidas"],
    [con({ salidasConAviso: [18] }), /GPIO18 esta en dos listas/, "un pin en dos roles"],
  ]
  for (const [pagina, forma, que] of paginasMalas) assert.throws(() => generarRuntime(esp32, { wifi: { clave: "" }, pagina }), forma, que)
  assert.doesNotThrow(() => generarRuntime(esp32, { wifi: { clave: "" }, pagina: { salidas: [], salidasExtra: [], entradasDigitales: [], entradasAnalogicas: [] } }), "listas vacías: válidas")
  assert.doesNotThrow(() => generarRuntime(esp32, { wifi: { clave: "" }, pagina: PAGINA_E2E }))
  assert.doesNotThrow(() => generarRuntime(esp32, { wifi: { clave: "" }, pagina: { ...PAGINA_E2E, salidasConAviso: [0, 12, 15] } }), "V4-6c: strapping con aviso")
  // C-02: la validación de clave/SSID/página vive UNA vez, en redDelRuntime; runtime-cpp.ts no la repite.
  const cppTs = sinComentariosTs(readFileSync(join(REPO, "opencode/codegen/runtime-cpp.ts"), "utf8"))
  assert.doesNotMatch(cppTs, /\[0-9\]\{8\}|esSsidValido/, "runtime-cpp.ts no vuelve a validar clave ni SSID")
  assert.equal((sinComentariosTs(readFileSync(join(REPO, "opencode/codegen/runtime.ts"), "utf8")).match(/obligatoria/g) ?? []).length, 1, "K-05: un solo chequeo de pagina")
  // SSID fijo: va tal cual a softAP y a nucleo_fijarSsid; la MAC no se lee (ya no arma el nombre ni elige canal).
  assert.ok(MAIN_WIFI_SSID_FIJO.includes(`static const char SSID_FIJO[] = "${SSID_FIJO}";`) && MAIN_WIFI_SSID_FIJO.includes("WiFi.softAP(SSID_FIJO))") && MAIN_WIFI_SSID_FIJO.includes("nucleo_fijarSsid(SSID_FIJO);"))
  assert.ok(!MAIN_WIFI_SSID_FIJO.includes("DIGITOS_HEX") && !MAIN_WIFI_SSID_FIJO.includes("PREFIJO_SSID") && !sinComentarios(MAIN_WIFI_SSID_FIJO).includes("softAPmacAddress("))
  assert.deepEqual(generarRuntime(esp32, { wifi: { clave: "", ssid: undefined }, pagina: PAGINA_DE_PRUEBA }), generadoWifi, "ssid ausente = el de la MAC")
  for (const ssid of ["", "x".repeat(P.LARGO_MAXIMO_SSID + 1), 'MI"ESP', "MI\\ESP", "MI\tESP", "MI\nESP", "ESPAÑA", 42, null]) {
    assert.throws(() => generarRuntime(esp32, { wifi: { clave: "", ssid }, pagina: PAGINA_DE_PRUEBA }), /SSID fijo/, JSON.stringify(ssid))
  }
  for (const ssid of ["x", "x".repeat(P.LARGO_MAXIMO_SSID), "Mi Red 3B", "Taller-TE_1.2", "~!#$%&()*+,-./:;<=>?@[]^_`{|}"]) assert.doesNotThrow(() => generarRuntime(esp32, { wifi: { clave: "", ssid }, pagina: PAGINA_DE_PRUEBA }), JSON.stringify(ssid))
  assert.equal(P.LARGO_MAXIMO_SSID, 32, "el largo máximo del SSID vive en el contrato (wifi_config_t.ap.ssid)")
  assert.match(MAIN_WIFI, new RegExp(`TAMANO_BUFFER_SSID = ${P.LARGO_MAXIMO_SSID + 1};`), "el buffer del C++ sale de la constante del contrato")
})

test("F2 el núcleo traducido: sin SSID fijado el hola es el de V1; con el SSID que arma la capa 3, el hola con wifi es byte a byte el del simulador; un SSID inválido no se anuncia", () => {
  const nucleo = ejecutarNucleo(MAIN_WIFI)
  assert.ok(nucleo.tieneFijarSsid)
  assert.equal(ejecutarNucleo(MAIN).tieneFijarSsid, false, "el núcleo de V1 no tiene nucleo_fijarSsid")
  assert.deepEqual(nucleo.procesar("hola"), [holaV1], "la red todavía no levantó: hola sin wifi (nunca un OK falso)")
  nucleo.fijarSsid(SSID_DE_PRUEBA)
  assert.deepEqual(nucleo.procesar("hola"), [holaConWifi()])
  assert.deepEqual(nucleo.procesar("hola"), crearRuntimeSimulado({ wifi: WIFI_DE_PRUEBA }).procesar("hola"), "el simulador con wifi dice lo mismo")
  assert.equal(P.parsearRespuesta(nucleo.procesar("hola")[0]).valor.wifi.clave, "", '"" = red abierta, y el objeto sigue cerrado {clave, ip, ssid}')
  const conClave = ejecutarNucleo(MAIN_WIFI_CON_CLAVE)
  conClave.fijarSsid(SSID_DE_PRUEBA)
  assert.deepEqual(conClave.procesar("hola"), [holaConWifi({ ...WIFI_DE_PRUEBA, clave: CLAVE_WIFI })], "con clave, el hola la anuncia (la misma línea exacta de vivo-protocolo.test.mjs)")
  // Los CASOS_DORADOS no cambian con wifi salvo el hola.
  for (const caso of CASOS_DORADOS) {
    const esperado = caso.salida.map((s) => (s === holaV1 ? holaConWifi() : s))
    assert.deepEqual(nucleo.procesar(caso.entrada), esperado, JSON.stringify(caso.entrada))
  }
  // SSID con comillas, barra invertida, control, no ASCII, o que no cabe: la red no se anuncia (mejor que un JSON roto).
  for (const malo of ['tecnia-"3f', "tecnia\\3f", "tecnia\t3f", "tecniañ3f", "x".repeat(P.LARGO_MAXIMO_SSID + 1), ""]) {
    nucleo.fijarSsid(malo)
    assert.deepEqual(nucleo.procesar("hola"), [holaV1], JSON.stringify(malo))
    assert.equal(P.esSsidValido(malo), false, "el contrato dice lo mismo")
  }
  for (const bueno of ["x".repeat(P.LARGO_MAXIMO_SSID), "Mi Red 3B", SSID_FIJO, "~!#$%&()*+,-./:;<=>?@[]^_`{|}"]) {
    assert.equal(P.esSsidValido(bueno), true)
    nucleo.fijarSsid(bueno)
    assert.deepEqual(nucleo.procesar("hola"), [holaConWifi({ ...WIFI_DE_PRUEBA, ssid: bueno })], JSON.stringify(bueno))
    assert.equal(P.parsearRespuesta(nucleo.procesar("hola")[0]).valor.wifi.ssid, bueno, "el host lo lee de vuelta")
  }
  // El hola más largo posible (SSID de 32 y clave de 8) entra en g_salida con margen: nucleo_emitirByte recorta en
  // TAMANO_SALIDA, así que un desborde es imposible, pero un hola recortado sería un JSON roto y tampoco se quiere.
  // G-02: TAMANO_SALIDA se deriva (el mayor entre el peor error y el hola mas largo, mas el 0 final); el hola mas
  // largo de verdad mide exactamente HOLA_MAXIMO_BYTES y entra entero.
  const constante = (cpp, nombre) => Number(cpp.match(new RegExp(`${nombre} = (\\d+);`))[1])
  const holaMaximoBytes = constante(MAIN_WIFI_CON_CLAVE, "HOLA_MAXIMO_BYTES")
  const tamanoSalida = Math.max(P.LIMITE_LINEA_BYTES + constante(MAIN_WIFI_CON_CLAVE, "ARMAZON_JSON_BYTES"), holaMaximoBytes) + 1
  const masLargo = ejecutarNucleo(MAIN_WIFI_CON_CLAVE)
  masLargo.fijarSsid("x".repeat(P.LARGO_MAXIMO_SSID))
  const lineaMasLarga = masLargo.procesar("hola")[0]
  assert.equal(lineaMasLarga, holaConWifi({ ssid: "x".repeat(P.LARGO_MAXIMO_SSID), clave: CLAVE_WIFI, ip: IP_TEXTO }))
  assert.equal(lineaMasLarga.length, holaMaximoBytes, "la derivación del C++ es exacta")
  assert.ok(lineaMasLarga.length + 1 <= tamanoSalida, `hola de ${lineaMasLarga.length} bytes contra TAMANO_SALIDA = ${tamanoSalida}`)
  assert.ok(holaMaximoBytes > constante(MAIN_WIFI, "HOLA_MAXIMO_BYTES") && constante(MAIN_WIFI, "HOLA_MAXIMO_BYTES") > constante(MAIN, "HOLA_MAXIMO_BYTES"), "con clave > abierta > sin wifi")
  // Y el peor error de verdad (CAMPO_DESCONOCIDO de un comando conocido de 4 bytes con un campo que llena la línea;
  // con un comando de 1 byte ganaría COMANDO_DESCONOCIDO, que es más corto) también entra entero.
  const campoMaximo = "c".repeat(P.LIMITE_LINEA_BYTES - "\n".length - "ping ".length - "=1".length)
  const peor = `ping ${campoMaximo}=1`
  assert.equal(Buffer.byteLength(peor) + 1, P.LIMITE_LINEA_BYTES)
  const [respuestaPeor] = masLargo.procesar(peor)
  assert.equal(respuestaPeor, P.serializarRespuesta({ tipo: "error", codigo: "CAMPO_DESCONOCIDO", comando: "ping", campo: campoMaximo }))
  assert.ok(respuestaPeor.length + 1 <= tamanoSalida)
})

test("F3 al arrancar con wifi: modo AP, SSID = tecnia- + 4 hex de la MAC del AP en minúscula, softAP SIN canal (V4-3) y softAPConfig, DNS cautivo, rutas, y el hola por serie anuncia la red", () => {
  const prog = ejecutarPrograma(MAIN_WIFI)
  prog.setup()
  const ll = prog.placa.llamadas
  const desde = ll.findIndex((x) => x[0] === "WiFi.persistent")
  assert.deepEqual(ll.slice(desde, desde + 7), [
    ["WiFi.persistent", false], // V4-4 / H7: antes de mode(): nada en la NVS
    ["WiFi.mode", WIFI_MODE.AP],
    ["WiFi.softAPmacAddress"],
    ["WiFi.softAP", SSID_DE_PRUEBA, null, undefined], // V4-3: sin canal
    ["WiFi.softAPConfig", IP_TEXTO, IP_TEXTO, "255.255.255.0"],
    ["WiFi.setTxPower", WIFI_POWER_11dBm], // V4-10: después de softAP (la API exige la red iniciada)
    ["dns.start", 53, "*", IP_TEXTO],
  ])
  assert.equal(prog.placa.persistente, false)
  assert.equal(prog.placa.potencia, WIFI_POWER_11dBm, "setTxPower devolvió true: el AP ya estaba iniciado")
  assert.ok(!ll.some((x) => x[0] === "esp_wifi_set_channel"), "sin la opción canal no se fija ninguno")
  assert.equal(prog.placa.canalWifi, CANAL_POR_DEFECTO)
  // Con la opción canal: esp_wifi_set_channel después de softAP (con WiFi iniciado: no da ESP_ERR_WIFI_NOT_INIT).
  const conCanal = ejecutarPrograma(generarRuntime(esp32, { wifi: { clave: "", canal: 11 }, pagina: PAGINA_DE_PRUEBA }).archivos["src/main.cpp"])
  conCanal.setup()
  const llc = conCanal.placa.llamadas
  assert.ok(llc.findIndex((x) => x[0] === "WiFi.softAP") < llc.findIndex((x) => x[0] === "esp_wifi_set_channel"), "después de softAP")
  assert.deepEqual(llc.find((x) => x[0] === "esp_wifi_set_channel"), ["esp_wifi_set_channel", 11, WIFI_SECOND_CHAN_NONE])
  assert.equal(conCanal.placa.canalWifi, 11)
  assert.equal(conCanal.leerSalida()[1], holaConWifi(), "el hola no cambia por el canal")
  assert.deepEqual(ll.at(-1), ["server.begin", 80])
  assert.ok(ll.findIndex((x) => x[0] === "Serial.begin") < desde, "el serie arranca antes que la red")
  assert.deepEqual(prog.leerSalida(), [P.serializarRespuesta({ tipo: "reinicio", causa: "encendido" }), holaConWifi()], "reinicio y después el hola con la red")
  // Con clave: softAP la recibe.
  const conClave = ejecutarPrograma(MAIN_WIFI_CON_CLAVE)
  conClave.setup()
  assert.deepEqual(conClave.placa.llamadas.find((x) => x[0] === "WiFi.softAP"), ["WiFi.softAP", SSID_DE_PRUEBA, CLAVE_WIFI, undefined], "con clave, sin canal")
  assert.equal(conClave.leerSalida()[1], holaConWifi({ ...WIFI_DE_PRUEBA, clave: CLAVE_WIFI }))
  // La MAC decide SOLO el SSID (4 últimos hex, minúscula, ceros incluidos); el canal nunca se pasa (V4-3), sea cual sea la MAC.
  const casos = [
    [[0, 0, 0, 0, 0x00, 0x0a], "tecnia-000a"],
    [[0xff, 0xff, 0xff, 0xff, 0xab, 0xcd], "tecnia-abcd"],
    [[1, 2, 3, 4, 0x3f, 0x2b], "tecnia-3f2b"],
    [[1, 2, 3, 4, 0x3f, 0x2c], "tecnia-3f2c"],
    [[1, 2, 3, 4, 0xf0, 0x00], "tecnia-f000"],
  ]
  for (const [mac, ssid] of casos) {
    const p = ejecutarPrograma(MAIN_WIFI, { mac })
    p.setup()
    assert.deepEqual(p.placa.llamadas.find((x) => x[0] === "WiFi.softAP"), ["WiFi.softAP", ssid, null, undefined], ssid)
    assert.equal(p.leerSalida()[1], holaConWifi({ ...WIFI_DE_PRUEBA, ssid }))
  }
  // SSID fijo: el nombre es el fijado, la MAC no se lee, el canal no se pasa, y el hola anuncia el nombre en uso.
  for (const mac of [MAC_DE_PRUEBA, [1, 2, 3, 4, 0x3f, 0x2b], [1, 2, 3, 4, 0x3f, 0x2c]]) {
    const p = ejecutarPrograma(MAIN_WIFI_SSID_FIJO, { mac })
    p.setup()
    assert.ok(!p.placa.llamadas.some((x) => x[0] === "WiFi.softAPmacAddress"), "con SSID fijo no se lee la MAC")
    assert.deepEqual(p.placa.llamadas.find((x) => x[0] === "WiFi.softAP"), ["WiFi.softAP", SSID_FIJO, null, undefined])
    assert.equal(p.leerSalida()[1], holaConWifi({ ...WIFI_DE_PRUEBA, ssid: SSID_FIJO }))
    assert.equal(p.pedir({ metodo: "POST", ruta: "/comando", cuerpo: "hola" }).cuerpo, holaConWifi({ ...WIFI_DE_PRUEBA, ssid: SSID_FIJO }), "y por HTTP también")
  }
  // Si el punto de acceso no levanta: hola SIN wifi, sin DNS ni servidor; el serie sigue.
  for (const falla of [{ apLevanta: false }, { configLevanta: false }]) {
    const p = ejecutarPrograma(MAIN_WIFI, falla)
    p.setup()
    assert.deepEqual(p.leerSalida()[1], holaV1, JSON.stringify(falla))
    assert.ok(!p.placa.llamadas.some((x) => x[0] === "dns.start" || x[0] === "server.begin"), "sin red no hay portal")
    p.enviar("ping\n")
    p.loop()
    assert.deepEqual(p.leerSalida(), ['{"tipo":"pong","uptimeMs":0}'])
  }
})

test("F4 HTTP: 302 al portal para rutas y hosts ajenos; GET / sirve la página; POST /comando devuelve la misma línea que el serie; 400 sólo con cuerpo vacío o largo", () => {
  const prog = ejecutarPrograma(MAIN_WIFI, { reloj: () => 1234 })
  prog.setup()
  prog.leerSalida()
  const UBICACION = ["Location", `http://${IP_TEXTO}/`, true]
  const SIN_CACHE = ["Cache-Control", "no-store", false] // V4-10 (H8)
  // Portal cautivo: los chequeos de conectividad de Android, iOS y Windows, cualquier dominio, y GET /comando.
  for (const pedido of [
    { ruta: "/generate_204", host: "connectivitycheck.gstatic.com" },
    { ruta: "/gen_204", host: "www.google.com" },
    { ruta: "/hotspot-detect.html", host: "captive.apple.com" },
    { ruta: "/connecttest.txt", host: "www.msftconnecttest.com" },
    { ruta: "/ncsi.txt", host: "www.msftncsi.com" },
    { ruta: "/", host: "detectportal.firefox.com" },
    { ruta: "/", host: "192.168.4.2" },
    { ruta: "/", host: "" },
    { ruta: "/comando", host: "otro.local", metodo: "POST", cuerpo: "ping" },
    { ruta: "/comando", metodo: "GET" },
    { ruta: "/cualquier/cosa" },
    { ruta: "/index.html" },
    { ruta: "/comando/", metodo: "POST", cuerpo: "ping" },
  ]) {
    const r = prog.pedir(pedido)
    assert.equal(r.codigo, 302, JSON.stringify(pedido))
    assert.deepEqual(r.encabezados, [UBICACION, SIN_CACHE], JSON.stringify(pedido))
    assert.equal(r.tipo, "text/plain")
  }
  // La página, con el Host nuestro (con o sin :80).
  for (const host of [IP_TEXTO, `${IP_TEXTO}:80`]) {
    const r = prog.pedir({ ruta: "/", host })
    assert.equal(r.codigo, 200)
    assert.equal(r.tipo, "text/html; charset=utf-8")
    assert.equal(r.cuerpo, paginaDe(MAIN_WIFI), "el cuerpo es exactamente el literal PAGINA")
    assert.deepEqual(r.encabezados, [SIN_CACHE], "sin Location; con Cache-Control: no-store (V4-10)")
  }
  // POST /comando: la misma línea que el serie, para las mismas entradas, sobre el MISMO núcleo (mismo estado).
  const porHttp = (cuerpo) => prog.pedir({ metodo: "POST", ruta: "/comando", cuerpo })
  const simulador = crearRuntimeSimulado({ wifi: WIFI_DE_PRUEBA, reloj: () => 1234 })
  simulador.arrancar()
  const lineas = [
    "hola",
    "ping",
    "digital.escribir pin=6 nivel=alto",
    "digital.escribir pin=1 nivel=alto",
    "pin.modo pin=34 modo=salida",
    "analogico.leer pin=4",
    "pin.modo pin=40 modo=entrada",
    "digital.escribir pin=18 nivel=alto",
    "pwm.escribir pin=2 porcentaje=50",
    "pin.modo pin=4 modo=entradaPullUp",
    "digital.leer pin=4",
    "analogico.leer pin=34",
    "ho la",
    "digital.escribir pin=18",
    "digital.escribir pin=18 nivel=alto extra=1",
    "digital.escribir pin=18 nivel=alto pin=2",
    "servo.angulo pin=18 grados=90",
    `ping ${"x".repeat(194)}`,
    `ping ${"x".repeat(195)}`,
    "p".repeat(199),
    "p".repeat(200),
  ]
  const codigos = new Set()
  for (const linea of lineas) {
    const esperado = simulador.procesar(linea)
    assert.equal(esperado.length, 1, linea)
    for (const variante of [linea, `${linea}\n`, `${linea}\r\n`, `${linea}\r`]) {
      const r = porHttp(variante)
      assert.equal(r.codigo, 200, JSON.stringify(variante))
      assert.equal(r.tipo, "application/json")
      assert.equal(r.cuerpo, esperado[0], JSON.stringify(variante))
      assert.deepEqual(r.encabezados, [])
    }
    const v = P.parsearRespuesta(esperado[0]).valor
    if (v.tipo === "error") codigos.add(v.codigo)
  }
  assert.ok(["PIN_PROHIBIDO", "PIN_SIN_CAPACIDAD", "PIN_INEXISTENTE", "LINEA_INVALIDA", "CAMPO_FALTANTE", "CAMPO_DESCONOCIDO", "CAMPO_DUPLICADO", "COMANDO_DESCONOCIDO", "LINEA_DEMASIADO_LARGA"].every((c) => codigos.has(c)), [...codigos].join())
  // El mismo núcleo: lo que se escribió por HTTP se relee por el serie, y al revés.
  porHttp("digital.escribir pin=23 nivel=alto")
  prog.enviar("digital.leer pin=23\n")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), ['{"nivel":"alto","pin":23,"tipo":"lectura"}'])
  prog.enviar("digital.escribir pin=23 nivel=bajo\n")
  prog.loop()
  prog.leerSalida()
  assert.equal(porHttp("digital.leer pin=23").cuerpo, '{"nivel":"bajo","pin":23,"tipo":"lectura"}')
  assert.deepEqual(prog.leerSalida(), [], "V4-2: lo hecho por HTTP no sale por el serie")
  // 400 SOLO con cuerpo vacío o de más de 200 bytes (201 sin \n; 200 + \n es una línea de 200 que el núcleo
  // rechaza como LINEA_DEMASIADO_LARGA con 200, igual que el serie). Un cuerpo de formulario no trae "plain".
  for (const cuerpo of ["", "\n", "\r\n", "\r", "p".repeat(201), `${"p".repeat(201)}\n`, "x".repeat(5000)]) {
    const r = porHttp(cuerpo)
    assert.equal(r.codigo, 400, JSON.stringify(cuerpo.slice(0, 20)))
    assert.equal(r.tipo, "text/plain")
    assert.match(r.cuerpo, /200 bytes/)
  }
  assert.equal(prog.pedir({ metodo: "POST", ruta: "/comando", cuerpo: "ping", formulario: true }).codigo, 400, "application/x-www-form-urlencoded: el core no deja 'plain'")
  assert.equal(porHttp(`${"p".repeat(200)}\n`).cuerpo, P.serializarRespuesta({ tipo: "error", codigo: "LINEA_DEMASIADO_LARGA" }))
  assert.equal(porHttp(`${"p".repeat(199)}\n`).cuerpo, P.serializarRespuesta({ tipo: "error", codigo: "COMANDO_DESCONOCIDO", comando: "p".repeat(199) }))
  assert.equal(prog.pendiente(), "", "nada a medio emitir por el serie")
  // Bug encontrado en la revisión tras el E2E: la capa 2 acumula la línea serie en g_linea, el mismo buffer que lee
  // el núcleo; un POST que llega con una línea serie a medio recibir la pisaba. Ahora se aparta y se devuelve.
  prog.enviar("digital.escribir pin=23 niv")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [], "línea serie incompleta: espera")
  assert.equal(porHttp("hola").cuerpo, holaConWifi(), "en el medio, un pedido HTTP con otra línea")
  assert.equal(porHttp("p".repeat(199)).codigo, 200, "y otro que ocupa casi todo el buffer")
  prog.enviar("el=alto\n")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), ['{"comando":"digital.escribir","pin":23,"tipo":"ok"}'], "la línea serie llegó entera")
  // También al revés de tamaños: una línea serie larga a medio recibir y un POST corto.
  prog.enviar(`ping ${"x".repeat(150)}`)
  prog.loop()
  assert.equal(porHttp("ping").cuerpo, '{"tipo":"pong","uptimeMs":1234}')
  prog.enviar("\n")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [P.serializarRespuesta({ tipo: "error", codigo: "LINEA_INVALIDA" })], "la línea serie completa (ping con basura) sigue siendo la que era")
})

test("F5 la página embebida es exactamente la de vivo/pagina-portal.ts para la página pedida: ASCII, sin internet, nombra /comando, sólo los pines que le dieron; la misma con o sin clave y con SSID fijo", () => {
  const pagina = paginaDe(MAIN_WIFI)
  // El literal lleva un '\n' por línea (la última también): lo que se sirve es la página más un salto final.
  assert.equal(pagina, `${renderizarPaginaPortal(PAGINA_DE_PRUEBA)}\n`, "el literal PAGINA del C++ es byte a byte lo que renderiza vivo/pagina-portal.ts")
  assert.ok(/^[\x0a\x20-\x7e]*$/.test(pagina), "ASCII")
  assert.ok(pagina.length > 3000 && pagina.length < 16000, `tamaño razonable para servir por el AP: ${pagina.length} bytes`)
  assert.doesNotMatch(pagina, /https?:\/\//, "sin http:// ni https://")
  assert.doesNotMatch(pagina, /'|\/\/|\\/, "sin comillas simples, // ni barras invertidas: el traductor del test la pasa intacta")
  assert.equal(paginaDe(MAIN_WIFI_CON_CLAVE), pagina, "la página no cambia con la clave")
  assert.equal(paginaDe(MAIN_WIFI_SSID_FIJO), pagina, "ni con el SSID fijo")
  for (const esperado of [`var RUTA = "${RUTA_COMANDO}";`, "var SALIDAS = [18];", "var OTRAS = [];", "var ENTRADAS_DIGITALES = [4];", "var ENTRADAS_ANALOGICAS = [34];", "modo=entradaPullUp", 'enviar("hola")']) {
    assert.ok(pagina.includes(esperado), `la página tiene ${JSON.stringify(esperado)}`)
  }
  assert.ok(!pagina.includes('id="mas"'), "sin salidasExtra no hay botón de más pines")
  // Con la página del E2E (GPIO2 y GPIO18 a la vista) cambia sólo la página, no el resto del runtime.
  const e2e = generarRuntime(esp32, { wifi: { clave: "" }, pagina: PAGINA_E2E }).archivos["src/main.cpp"]
  assert.equal(paginaDe(e2e), `${renderizarPaginaPortal(PAGINA_E2E)}\n`)
  assert.ok(paginaDe(e2e).includes("var SALIDAS = [2, 18];"))
  const sinPagina = (cpp) => cpp.replace(/^static const char PAGINA\[\] PROGMEM =\n(?:  ".*"\n)*  ".*";/m, "")
  assert.equal(sinPagina(e2e), sinPagina(MAIN_WIFI), "fuera del literal PAGINA, el C++ es idéntico")
})

const TEXTOS_CON_STRING_EN_CAPA_3 = 2 // `String host` (hostHeader) y `String cuerpo` (arg): lo que devuelve el WebServer

test("F6 guardias con wifi: capa 1 y capa 2 sin String; String sólo en la capa 3 y sólo donde el core lo devuelve; sin std::, new, malloc, free ni delay en ninguna; sin lib_deps; el traductor reconoce todo", () => {
  const sinString = PROHIBIDOS_EN_CPP.filter((re) => String(re) !== "/\\bString\\b/")
  const fallas = (cpp) => sinString.filter((re) => re.test(cpp)).map(String)
  // La página es JS (tiene `new Date()`, legítimo ahí): la guardia de C++ mide la capa 3 sin el literal PAGINA.
  const portalSinPagina = seccionPortal(MAIN_WIFI).replace(/^static const char PAGINA\[\] PROGMEM =\n(?:  ".*"\n)*  ".*";/m, "")
  assert.ok(portalSinPagina.length < seccionPortal(MAIN_WIFI).length - 3000 && !portalSinPagina.includes("<html"), "el literal PAGINA quedó afuera")
  assert.deepEqual(violaciones(seccionNucleo(MAIN_WIFI), INI_WIFI), [])
  assert.deepEqual(violaciones(seccionTransporte(MAIN_WIFI), INI_WIFI), [])
  assert.deepEqual(fallas(portalSinPagina), [])
  assert.deepEqual(fallas(`${portalSinPagina}\nchar* p = new char[4];\n`), ["/\\bnew /"], "la guardia de la capa 3 marca lo que tiene que marcar")
  assert.equal((seccionPortal(MAIN_WIFI).match(/^\s*String \w+ = server\.(hostHeader|arg)\(/gm) ?? []).length, TEXTOS_CON_STRING_EN_CAPA_3)
  assert.equal((traducir(seccionPortal(MAIN_WIFI)).match(/\bString\b/g) ?? []).length, 0, "ningún otro uso de String (los comentarios no cuentan)")
  const nucleoSinComentarios = seccionNucleo(MAIN_WIFI)
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .map(sinComentarioDeLinea)
    .join("\n")
  assert.doesNotMatch(nucleoSinComentarios, /\b(Serial|WiFi|server|dnsServer|pinMode|digitalWrite|digitalRead|analogRead|ledc\w*|millis|delay\w*|esp_\w+|String)\b/, "el núcleo sigue sin Arduino (las citas en comentarios no cuentan)")
  const js = traducir(MAIN_WIFI)
  assert.doesNotMatch(js, /\bstatic\b/)
  assert.doesNotMatch(js, /\b(uint8_t|uint16_t|uint32_t|char|bool|esp_reset_reason_t|IPAddress|DNSServer|WebServer)\s+\w+\s*[=;[]/, "ningún tipo quedó sin traducir")
  assert.doesNotMatch(js, /'[^']*'/, "sin literales de caracteres")
  assert.ok(js.includes(`const TEXTO_URL_PORTAL = cadena("http://${IP_TEXTO}/");`), "el // de la URL no se recortó como comentario")
  // Cada hecho de hardware de la capa 3 cita su fuente.
  const portal = seccionPortal(MAIN_WIFI)
  for (const cita of ["WiFiAP.cpp:136-175", "WiFiAP.cpp:337-343", "WiFiAP.cpp:199-210", "WiFiAP.h:40", "WiFiAP.cpp:107", "WiFiGeneric.h:176", "WiFiType.h:34", "esp_wifi.h:709", "DNSServer.cpp:116", "DNSServer.cpp:76", "WebServer.h:140", "WebServer.h:142", "WebServer.h:103", "WebServer.h:107", "WebServer.cpp:355-367", "WebServer.cpp:385-417", "WebServer.cpp:450-463", "WebServer.cpp:539-549", "WebServer.cpp:623-625", "WebServer.cpp:275-342", "WebServer.cpp:279-281", "Parsing.cpp:199-221", "Parsing.cpp:213-217", "Parsing.cpp:171-172", "WString.h:204", "WString.h:87", "WString.h:240", "pgmspace.h:32", "IPAddress.h:49", "esp_wifi_types.h:260", "CaptivePortal:15-17", "WiFiGeneric.cpp:1229-1232", "WiFiGeneric.cpp:763", "WiFiGeneric.cpp:693-695", "WiFiGeneric.cpp:1406-1412", "WiFiGeneric.h:186", "esp_wifi.h:935-952", "WiFiAP.h:40"]) {
    assert.ok(MAIN_WIFI.includes(cita), `cita ${cita}`)
  }
  for (const api of ["WiFi.mode(WIFI_AP)", "WiFi.softAPmacAddress(mac)", "WiFi.softAPConfig(IP_PORTAL, IP_PORTAL, MASCARA_PORTAL)", "dnsServer.start(PUERTO_DNS, TEXTO_DOMINIO_TODOS, IP_PORTAL)", "server.on(TEXTO_RUTA_PAGINA, HTTP_GET, portal_pagina)", "server.on(TEXTO_RUTA_COMANDO, HTTP_POST, portal_comando)", "server.onNotFound(portal_redirigir)", "server.begin()", "dnsServer.processNextRequest()", "server.handleClient()", "server.send_P(200, TEXTO_TIPO_HTML, PAGINA)", "server.send(200, TEXTO_TIPO_JSON, g_salida)", "server.send(302, TEXTO_TIPO_TEXTO_PLANO, TEXTO_REDIRIGIENDO)", "server.sendHeader(TEXTO_ENCABEZADO_LOCATION, TEXTO_URL_PORTAL, true)", "server.sendHeader(TEXTO_ENCABEZADO_CACHE, TEXTO_SIN_CACHE)", "nucleo_procesar((uint16_t)largo)", "nucleo_fijarSsid(ssid)", "WiFi.persistent(false)", "WiFi.setTxPower(WIFI_POWER_11dBm)"]) {
    assert.ok(portal.includes(api), `la capa 3 usa ${api}`)
  }
  assert.ok(seccionTransporte(MAIN_WIFI).includes("  portal_iniciar();") && seccionTransporte(MAIN_WIFI).includes("  portal_atender();"), "setup() y loop() llaman a la capa 3")
  assert.doesNotMatch(portal, /CANALES_WIFI/, "V4-3: sin tabla de canales")
  assert.match(portal, /static const uint16_t PUERTO_HTTP = 80;/)
  assert.match(portal, /static const uint16_t PUERTO_DNS = 53;/)
  assert.match(portal, /static const char TEXTO_TIPO_HTML\[\] = "text\/html; charset=utf-8";/)
  // Orden, en el código: persistent < mode < softAP < softAPConfig < setTxPower.
  const codigo = sinComentarios(portal)
  const orden = ["WiFi.persistent(false)", "WiFi.mode(WIFI_AP)", "WiFi.softAP(", "WiFi.softAPConfig(", "WiFi.setTxPower(WIFI_POWER_11dBm)"].map((api) => codigo.indexOf(api))
  assert.ok(orden.every((i) => i > 0) && orden.every((i, k) => k === 0 || i > orden[k - 1]), orden.join(","))
  assert.equal((codigo.match(/TEXTO_SIN_CACHE\)/g) ?? []).length, 2, "Cache-Control en la página y en el 302 (no en el JSON del comando, que el navegador no cachea en un POST)")
})

test("F7 diagnóstico (opción wifi.diagnostico): cada 10 s una línea JSON canónica con canal, heap y stack; nunca sin la opción; el host la ignora por tipo desconocido", () => {
  let ahora = 0
  const cpp = generarRuntime(esp32, { wifi: { clave: "", ssid: SSID_FIJO, canal: 6, diagnostico: true }, pagina: PAGINA_E2E }).archivos["src/main.cpp"]
  const prog = ejecutarPrograma(cpp, { reloj: () => ahora, heapLibre: 213456, stackLibre: 7000 })
  prog.setup()
  assert.equal(prog.leerSalida().length, 2, "reinicio y hola")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [], "en el arranque todavía no (millis 0 - 0 < 10000)")
  ahora = 9999
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [])
  ahora = 10000
  prog.loop()
  const linea = '{"canal":6,"heapLibre":213456,"stackLibre":7000,"tipo":"diagnostico"}'
  assert.deepEqual(prog.leerSalida(), [linea], "claves en orden alfabético, sin espacios")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [], "una sola vez por intervalo")
  ahora = 25000
  prog.enviar("ping\n")
  prog.loop()
  assert.deepEqual(prog.leerSalida(), ['{"tipo":"pong","uptimeMs":25000}', linea], "la respuesta al comando sale antes que el diagnóstico del mismo loop")
  assert.equal(prog.pendiente(), "")
  // Está fuera del contrato (§3): parsearRespuesta la rechaza; la sesión del host la ignora (lo implementa el integrador).
  assert.deepEqual(P.parsearRespuesta(linea), { ok: false, error: { codigo: "LINEA_INVALIDA" } })
  assert.ok(linea.startsWith("{"), "empieza con { : no es prosa (V4-7)")
  // Desborde de millis: aritmética sin signo en el C++; acá se prueba el salto grande hacia adelante.
  ahora = 4294967295
  prog.loop()
  assert.deepEqual(prog.leerSalida(), [linea])
  // Sin la opción: ni una línea de más, por más que pase el tiempo.
  let t = 0
  const sinOpcion = ejecutarPrograma(MAIN_WIFI_SSID_FIJO, { reloj: () => t })
  sinOpcion.setup()
  sinOpcion.leerSalida()
  for (t = 10000; t < 100000; t += 10000) sinOpcion.loop()
  assert.deepEqual(sinOpcion.leerSalida(), [])
  // Red caída: canal 0 (WiFi.channel() con la red sin iniciar) y sigue informando heap y stack.
  const caida = ejecutarPrograma(cpp, { reloj: () => 10000, apLevanta: false, heapLibre: 1, stackLibre: 2 })
  caida.setup()
  caida.leerSalida()
  caida.loop()
  assert.deepEqual(caida.leerSalida(), ['{"canal":0,"heapLibre":1,"stackLibre":2,"tipo":"diagnostico"}'])
})

// ════════════════════════════════════════════════════════════════════════════════════
// E — compilación real (opt-in), con evidencia
// ════════════════════════════════════════════════════════════════════════════════════

const ACTIVO = process.env.TECNIA_CODEGEN_PIO === "1"

/**
 * Sólo en la compilación de prueba (nunca en el ini de producción, A1 lo fija): `build_src_flags` aplica a `src/`
 * (el runtime) y no al core ni a sus librerías, así "0 advertencias" mide el C++ generado y no arduino-esp32.
 */
const FLAGS_DE_PRUEBA = "-Wall -Wextra -Wshadow"
const iniDePrueba = (ini) => `${ini.trimEnd()}\nbuild_src_flags = ${FLAGS_DE_PRUEBA}\n`

/**
 * Compila un runtime generado con PlatformIO y deja la evidencia (ini, cpp, log, resumen.json) en `carpeta`, dentro
 * de un directorio temporal por defecto (L3: un test no escribe fuera del repo sin que se lo pidan); con
 * `TECNIA_EVIDENCIA_DIR=<dir>` la deja en `<dir>/<carpeta>`.
 */
async function compilarConEvidencia(runtime, carpeta, extras = {}) {
  const { pioCandidatos } = await import(join(REPO, "opencode/tool/platformio.ts"))
  const ini = runtime.archivos["platformio.ini"]
  const main = runtime.archivos["src/main.cpp"]
  const dir = mkdtempSync(join(tmpdir(), "tecnia-vivo-runtime-"))
  try {
    for (const [ruta, contenido] of Object.entries(runtime.archivos)) {
      mkdirSync(join(dir, ruta, ".."), { recursive: true })
      writeFileSync(join(dir, ruta), ruta === "platformio.ini" ? iniDePrueba(contenido) : contenido)
    }
    const pio = process.env.TECNIA_PIO_BIN ?? pioCandidatos().find((c) => existsSync(c)) ?? "pio"
    const argumentos = ["run", "-d", dir, "-e", runtime.environment]
    const corrida = spawnSync(pio, argumentos, { encoding: "utf8", env: { ...process.env, PLATFORMIO_SETTING_ENABLE_TELEMETRY: "no" }, maxBuffer: 64 * 1024 * 1024 })
    const log = `${corrida.stdout ?? ""}${corrida.stderr ?? ""}`
    const build = join(dir, ".pio", "build", runtime.environment)
    const firmware = join(build, "firmware.bin")
    const advertencias = log.split("\n").filter((l) => /warning:/.test(l))
    const evidencia = join(process.env.TECNIA_EVIDENCIA_DIR ?? mkdtempSync(join(tmpdir(), "tecnia-vivo-evidencia-")), carpeta)
    mkdirSync(evidencia, { recursive: true })
    writeFileSync(join(evidencia, "platformio.ini"), ini)
    writeFileSync(join(evidencia, "platformio.prueba.ini"), iniDePrueba(ini))
    writeFileSync(join(evidencia, "main.cpp"), main)
    writeFileSync(join(evidencia, "pio-run.log"), log)
    for (const [nombre, contenido] of Object.entries(extras.archivos ?? {})) writeFileSync(join(evidencia, nombre), contenido)
    const resumen = {
      comando: [pio.replace(homedir(), "~"), ...argumentos.map((a) => (a === dir ? "<temporal>" : a))].join(" "),
      flagsDePrueba: `build_src_flags = ${FLAGS_DE_PRUEBA} (solo en platformio.prueba.ini; el platformio.ini es el de produccion)`,
      environment: runtime.environment,
      runtime: runtime.runtime,
      protocolo: runtime.protocolo,
      ...(extras.resumen ?? {}),
      exitCode: corrida.status,
      error: corrida.error ? String(corrida.error) : null,
      advertencias,
      sha256: {
        "platformio.ini": sha(ini),
        "src/main.cpp": sha(main),
        "firmware.bin": existsSync(firmware) ? sha(readFileSync(firmware)) : null,
      },
      firmware: existsSync(firmware) ? { archivo: "firmware.bin", bytes: statSync(firmware).size } : null,
      elf: existsSync(join(build, "firmware.elf")) ? { bytes: statSync(join(build, "firmware.elf")).size, sha256: sha(readFileSync(join(build, "firmware.elf"))) } : null,
    }
    writeFileSync(join(evidencia, "resumen.json"), `${JSON.stringify(resumen, null, 2)}\n`)
    assert.equal(corrida.error, undefined, String(corrida.error))
    assert.equal(corrida.status, 0, log.slice(-4000))
    assert.ok(existsSync(firmware) && statSync(firmware).size > 0, "no se produjo firmware.bin")
    assert.deepEqual(advertencias, [], `el runtime compila sin advertencias con ${FLAGS_DE_PRUEBA}`)
    console.log(`evidencia en ${evidencia}`)
    return resumen
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const OPT_IN = { skip: ACTIVO ? false : "opt-in: TECNIA_CODEGEN_PIO=1 (necesita PlatformIO y espressif32@6.12.0 instalados)", timeout: 15 * 60 * 1000 }

test("E1 compilación real: generarRuntime → platformio.ini + src/main.cpp → `pio run -e esp32-devkit-v1` → firmware, 0 advertencias con -Wall -Wextra -Wshadow (TECNIA_CODEGEN_PIO=1)", OPT_IN, async () => {
  await compilarConEvidencia(generado, "runtime")
})

test("E2 compilación real con wifi (V4, página del E2E): las tres capas con WiFi, DNSServer y WebServer del core, sin lib_deps → firmware; evidencia en runtime-v4/ (TECNIA_CODEGEN_PIO=1)", OPT_IN, async () => {
  const runtime = generarRuntime(esp32, { wifi: { clave: "" }, pagina: PAGINA_E2E })
  const pagina = paginaDe(runtime.archivos["src/main.cpp"])
  const resumen = await compilarConEvidencia(runtime, "runtime-v4", {
    archivos: { "pagina.html": pagina },
    resumen: { wifi: { clave: "", ssid: "tecnia- + 4 hex de la MAC del AP (en la placa)", ip: IP_TEXTO, canal: "por defecto de softAP (V4-3)", persistent: false, txPower: "WIFI_POWER_11dBm (V4-10)" }, pagina: { ...PAGINA_E2E, bytes: pagina.length, sha256: sha(pagina) } },
  })
  assert.ok(resumen.firmware.bytes > 285840, "con WiFi + HTTP el firmware es más grande que el de V1 (285840 bytes)")
})

/** Una compilación suelta, sin evidencia ni aserciones: para probar que la guardia de advertencias marca lo que tiene que marcar. */
async function compilarSuelto(archivos) {
  const { pioCandidatos } = await import(join(REPO, "opencode/tool/platformio.ts"))
  const dir = mkdtempSync(join(tmpdir(), "tecnia-vivo-mutante-"))
  try {
    for (const [ruta, contenido] of Object.entries(archivos)) {
      mkdirSync(join(dir, ruta, ".."), { recursive: true })
      writeFileSync(join(dir, ruta), contenido)
    }
    const pio = process.env.TECNIA_PIO_BIN ?? pioCandidatos().find((c) => existsSync(c)) ?? "pio"
    const corrida = spawnSync(pio, ["run", "-d", dir, "-e", generado.environment], { encoding: "utf8", env: { ...process.env, PLATFORMIO_SETTING_ENABLE_TELEMETRY: "no" }, maxBuffer: 64 * 1024 * 1024 })
    const log = `${corrida.stdout ?? ""}${corrida.stderr ?? ""}`
    return { status: corrida.status, advertencias: log.split("\n").filter((l) => /warning:/.test(l)) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("E4 la guardia de advertencias se prueba a sí misma: un main.cpp con una variable que hace sombra da un warning con las flags de prueba y ninguno sin ellas (TECNIA_CODEGEN_PIO=1)", OPT_IN, async () => {
  // Un global `largo` antes de `nucleo_procesar(uint16_t largo)`: -Wshadow lo marca; sin -Wshadow, nada.
  const conSombra = MAIN.replace("static uint16_t nucleo_procesar(uint16_t largo) {", "static uint16_t largo = 0;\nstatic uint16_t nucleo_procesar(uint16_t largo) {")
  assert.notEqual(conSombra, MAIN, "el mutante existe")
  const conFlags = await compilarSuelto({ "platformio.ini": iniDePrueba(INI), "src/main.cpp": conSombra })
  assert.equal(conFlags.status, 0, "sigue compilando (es un warning)")
  assert.ok(conFlags.advertencias.some((l) => /shadows/.test(l)), `la guardia marca la sombra: ${conFlags.advertencias.join(" | ")}`)
  const sinFlags = await compilarSuelto({ "platformio.ini": INI, "src/main.cpp": conSombra })
  assert.equal(sinFlags.status, 0)
  assert.deepEqual(sinFlags.advertencias, [], "sin las flags de prueba el mismo mutante no avisa: la guardia depende de ellas")
})

test("E3 compilación real con wifi, SSID fijo y la página del E2E (la variante que se flashea: MI_ESP, red abierta, GPIO2/18/4/34); evidencia en runtime-v4-ssid-fijo/ (TECNIA_CODEGEN_PIO=1)", OPT_IN, async () => {
  const runtime = generarRuntime(esp32, { wifi: { clave: "", ssid: SSID_FIJO }, pagina: PAGINA_E2E })
  const pagina = paginaDe(runtime.archivos["src/main.cpp"])
  await compilarConEvidencia(runtime, "runtime-v4-ssid-fijo", {
    archivos: { "pagina.html": pagina },
    resumen: { wifi: { clave: "", ssid: SSID_FIJO, ip: IP_TEXTO, canal: "por defecto de softAP (V4-3)", persistent: false, txPower: "WIFI_POWER_11dBm (V4-10)", cacheControl: "no-store (V4-10)" }, pagina: { ...PAGINA_E2E, bytes: pagina.length, sha256: sha(pagina) } },
  })
})
