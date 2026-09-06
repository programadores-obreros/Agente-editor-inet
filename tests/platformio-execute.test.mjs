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
import { join, dirname } from "node:path"
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

test("compile colgado: el mensaje dice que sigue descargando o se colgó y que reintente", async () => {
  process.env.TECNIA_PIO_TIMEOUT_MS = "50"
  escenario()
  const base = guion
  guion = (cmd) => (cmd.join(" ").endsWith(" run") ? COLGADO() : base(cmd))

  const r = await mod.default.execute({ action: "compile" }, ctx)
  assert.match(r, /sigue descargando herramientas o se colgó/)
  assert.match(r, /probá de nuevo, la segunda vez es rápido/)
  assert.doesNotMatch(r, /Error de compilacion/, "un timeout no es un error del código del alumno")
})

test("both: si la carga se cuelga, avisa del timeout de la carga (el compile ya fue)", async () => {
  process.env.TECNIA_PIO_TIMEOUT_MS = "50"
  escenario({ lista: [CH340] })
  const base = guion
  guion = (cmd) => (cmd.join(" ").includes("--target upload") ? COLGADO() : base(cmd))
  const r = await mod.default.execute({ action: "both" }, ctx)
  assert.match(r, /No termine de cargar el codigo/)
  assert.match(r, /se colgó; probá de nuevo/)
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
