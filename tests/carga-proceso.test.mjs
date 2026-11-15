// `opencode/carga/proceso.ts`: el runner de procesos y la GUARDIA EN RUNTIME de la carga
// (Slice 2, gate único de carga — CONTRATOS-API §1 y §14, ADR-001 §9.8b).
//
// Qué se prueba, por COMPORTAMIENTO (se llama a `run()` de verdad, con un `Bun.spawn`
// falso que anota cada argv; nunca se lanza `pio`, nunca se toca un puerto):
//
//   1. Un argv de carga SIN la capacidad no llega nunca a `spawn`: `run()` tira
//      `RUTA_DE_CARGA_NO_AUTORIZADA`. Con la capacidad (la única forma de tenerla es
//      `carga/ejecutar.ts::lanzarCarga`) pasa.
//   2. Lo que NO es una carga sigue andando igual, incluso desde una carpeta que se
//      llame como una herramienta de carga.
//   3. `run()` conserva lo que el proceso alcanzó a escribir cuando se corta.
//   4. `traducirError` reconoce el puerto ocupado y la verificación fallida.
//   5. `tool/platformio.ts` re-exporta lo mudado con los mismos nombres.
//
// MUTACIONES que ponen esto rojo (verificadas a mano, ver el informe de la etapa):
// quitar el `throw` de la guardia en `run()`; comparar la capacidad con `!== undefined`
// en vez de con el Symbol; devolver `stdout: ""` en el corte; sacar `uploadfs` de la
// regla de targets.

import { test, before, beforeEach, after } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const TMP = mkdtempSync(join(os.tmpdir(), "tecniabot-carga-proceso-"))
const HOME_FALSO = join(TMP, "home")
const ENTORNO_ORIGINAL = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, PLATFORMIO_CORE_DIR: process.env.PLATFORMIO_CORE_DIR, TECNIA_PIO_TIMEOUT_MS: process.env.TECNIA_PIO_TIMEOUT_MS }

// ── Bun falso: anota cada spawn; `guion` decide qué contesta ────────────────────────
let spawns = []
let guion = () => ({})
globalThis.Bun = {
  which: () => null,
  spawn(cmd, opts) {
    const r = guion(cmd)
    if (r instanceof Error) throw r
    const proc = {
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      exited: r.exited ?? Promise.resolve(r.code ?? 0),
      matado: false,
      kill() {
        proc.matado = true
      },
    }
    spawns.push({ cmd: [...cmd], opts, proc })
    return proc
  },
}

const bytes = (texto) => new TextEncoder().encode(texto)
/** Un proceso que escribe `texto` y después se queda colgado para siempre. */
const escribeYSeCuelga = (salida, errores = "") => ({
  stdout: new ReadableStream({ start: (c) => salida && c.enqueue(bytes(salida)) }),
  stderr: new ReadableStream({ start: (c) => errores && c.enqueue(bytes(errores)) }),
  exited: new Promise(() => {}),
})
/** Un proceso que escribe en trozos y termina bien. */
const escribeYTermina = (trozos, code = 0) => ({
  stdout: new ReadableStream({
    start(c) {
      for (const t of trozos) c.enqueue(bytes(t))
      c.close()
    },
  }),
  stderr: new ReadableStream({ start: (c) => c.close() }),
  exited: Promise.resolve(code),
})

let proceso
let ejecutar

before(async () => {
  mkdirSync(HOME_FALSO, { recursive: true })
  process.env.HOME = HOME_FALSO
  process.env.USERPROFILE = HOME_FALSO
  process.env.XDG_CONFIG_HOME = join(HOME_FALSO, ".config")
  delete process.env.PLATFORMIO_CORE_DIR
  // ejecutar.ts PRIMERO: es quien reclama la capacidad al cargarse.
  ejecutar = await import(join(REPO, "opencode/carga/ejecutar.ts"))
  proceso = await import(join(REPO, "opencode/carga/proceso.ts"))
})

beforeEach(() => {
  spawns = []
  guion = () => ({})
  delete process.env.TECNIA_PIO_TIMEOUT_MS
  delete process.env.PLATFORMIO_CORE_DIR
  proceso.resetPioCache()
})

after(() => {
  for (const [k, v] of Object.entries(ENTORNO_ORIGINAL)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(TMP, { recursive: true, force: true })
})

/** `run()` tiene que tirar el código de la guardia y NO haber lanzado nada. */
async function rechazaSinLanzar(cmd, ...resto) {
  const antes = spawns.length
  await assert.rejects(
    () => proceso.run(cmd, TMP, ...resto),
    (error) => {
      assert.ok(error instanceof proceso.ErrorDeCarga, `tiró otra cosa: ${error}`)
      assert.equal(error.codigo, "RUTA_DE_CARGA_NO_AUTORIZADA")
      return true
    },
    `tenía que rechazar: ${JSON.stringify(cmd)}`,
  )
  assert.equal(spawns.length, antes, `lanzó un proceso con un argv de carga sin capacidad: ${JSON.stringify(cmd)}`)
}

// ═════════════════════════════════════════════════════════════════════════════════════
// 1. La guardia en runtime
// ═════════════════════════════════════════════════════════════════════════════════════

const ARGV_DE_CARGA = [
  ["el argv de 0.4.8 (--target upload --upload-port)", ["pio", "run", "--target", "upload", "--upload-port", "/dev/ttyUSB0"]],
  ["sólo --upload-port, sin target", ["pio", "run", "--upload-port", "/dev/ttyUSB0"]],
  ["--upload-port=valor pegado", ["pio", "run", "--upload-port=/dev/ttyUSB0"]],
  ["-t upload", ["pio", "run", "-t", "upload"]],
  ["--target=upload", ["pio", "run", "--target=upload"]],
  ["-t=upload", ["pio", "run", "-t=upload"]],
  ["-tupload pegado", ["pio", "run", "-tupload"]],
  ["uploadfs (sube el sistema de archivos)", ["pio", "run", "-t", "uploadfs"]],
  ["--target uploadfsota", ["pio", "run", "--target", "uploadfsota"]],
  ["--target=uploadeep", ["pio", "run", "--target=uploadeep"]],
  ["nobuild + upload", ["pio", "run", "-d", "/x", "-e", "uno", "-t", "nobuild", "-t", "upload", "--upload-port", "COM3"]],
  ["mayúsculas", ["pio", "run", "--TARGET", "UPLOAD"]],
  ["esptool directo", ["esptool.py", "--port", "/dev/ttyUSB0", "write_flash", "0x1000", "x.bin"]],
  ["esptool por ruta completa", ["/home/x/.platformio/packages/tool-esptoolpy/esptool.py", "write_flash"]],
  ["python -m esptool", ["python3", "-m", "esptool", "write_flash", "0x0", "x.bin"]],
  ["avrdude directo", ["avrdude", "-p", "atmega328p", "-U", "flash:w:x.hex:i"]],
  ["espota (carga por red)", ["python3", "/x/espota.py", "-i", "192.168.1.20", "-f", "x.bin"]],
  ["pio pkg exec con esptool", ["pio", "pkg", "exec", "-p", "tool-esptoolpy", "--", "esptool.py", "erase_flash"]],
  ["sh -c con esptool adentro", ["sh", "-c", "esptool.py write_flash 0x1000 /tmp/x.bin"]],
  ["pio test (sube firmware de prueba)", ["pio", "test", "-e", "uno"]],
  ["pio debug", ["pio", "debug"]],
  ["pio remote run", ["pio", "remote", "run", "-t", "upload"]],
  ["-d con nombre de herramienta, pero el ejecutable NO es pio", ["python3", "-d", "esptool.py"]],
]

for (const [nombre, cmd] of ARGV_DE_CARGA) {
  test(`guardia: un argv de carga sin capacidad no se lanza — ${nombre}`, async () => {
    assert.equal(proceso.argvEsDeCarga(cmd), true)
    await rechazaSinLanzar(cmd)
  })
}

test("guardia: un argv de carga ARMADO POR CONCATENACIÓN tampoco se lanza (se mira el argv, no cómo se escribió)", async () => {
  const mitad = "up"
  const puerto = ["--up", "load", "-port"].join("")
  const target = String.fromCharCode(45, 45, 116, 97, 114, 103, 101, 116) // "--target"
  await rechazaSinLanzar(["pio", "run", target, `${mitad}load`, puerto, "/dev/ttyUSB0"])
  await rechazaSinLanzar(["pio", "run", `${"-"}t`, `${mitad}${"loadfs"}`])
})

test("guardia: mira el argv YA RESUELTO — con `pio` cambiado por su ruta real sigue rechazando", async () => {
  const bin = join(HOME_FALSO, ".platformio", "penv", "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, "pio"), "")
  chmodSync(join(bin, "pio"), 0o755)
  try {
    assert.equal(proceso.pioBin(), join(bin, "pio"), "fixture: pio tiene que resolver a la ruta falsa")
    await rechazaSinLanzar(["pio", "run", "--target", "upload", "--upload-port", "/dev/ttyUSB0"])
    // Y una compilación con esa misma ruta resuelta sí sale, con la ruta real en el argv.
    const r = await proceso.run(["pio", "run"], TMP)
    assert.equal(r.code, 0)
    assert.deepEqual(spawns.at(-1).cmd, [join(bin, "pio"), "run"])
  } finally {
    rmSync(join(HOME_FALSO, ".platformio"), { recursive: true, force: true })
  }
})

test("guardia: una capacidad FALSA no sirve (ni un Symbol igualito, ni true, ni un string)", async () => {
  const cmd = ["pio", "run", "--target", "upload", "--upload-port", "/dev/ttyUSB0"]
  for (const falsa of [Symbol("tecnia-bot.capacidad-de-carga"), Symbol.for("tecnia-bot.capacidad-de-carga"), true, "capacidad", {}, 1]) {
    assert.equal(proceso.esCapacidadDeCarga(falsa), false)
    await rechazaSinLanzar(cmd, undefined, 1000, falsa)
  }
})

test("guardia: va antes que todo — ni una señal ya abortada convierte una carga sin capacidad en un resultado normal", async () => {
  const ctrl = new AbortController()
  ctrl.abort()
  await rechazaSinLanzar(["pio", "run", "--target", "upload", "--upload-port", "/dev/ttyUSB0"], ctrl.signal)
})

test("la capacidad se entrega UNA sola vez: ya la tiene ejecutar.ts, y a cualquier otro se le da null", () => {
  assert.equal(proceso.reclamarCapacidadDeCarga(), null)
  assert.equal(proceso.reclamarCapacidadDeCarga(), null)
  assert.equal(proceso.esCapacidadDeCarga(null), false)
  assert.equal(proceso.esCapacidadDeCarga(undefined), false)
})

test("CON la capacidad (por lanzarCarga) el argv de carga sí se lanza, tal cual", async () => {
  const argv = ejecutar.argvDeCargaHeredada({ puerto: "/dev/ttyUSB0", environment: "uno" })
  const r = await ejecutar.lanzarCarga(proceso.run, argv, TMP)
  assert.equal(r.code, 0)
  assert.equal(spawns.length, 1)
  assert.deepEqual(spawns[0].cmd, ["pio", "run", "--target", "upload", "--upload-port", "/dev/ttyUSB0", "-e", "uno"])
  assert.equal(spawns[0].opts.cwd, TMP)
})

test("si OTRO módulo reclama la capacidad antes que ejecutar.ts, ejecutar.ts no puede cargar: falla cerrado y sin lanzar nada", () => {
  // En un proceso aparte: en éste la capacidad ya se entregó.
  const guionHijo = `
    let lanzados = 0
    globalThis.Bun = { which: () => null, spawn() { lanzados++; return { stdout: "", stderr: "", exited: Promise.resolve(0), kill() {} } } }
    const proceso = await import(${JSON.stringify(pathToFileURL(join(REPO, "opencode/carga/proceso.ts")).href)})
    const robada = proceso.reclamarCapacidadDeCarga()
    const ejecutar = await import(${JSON.stringify(pathToFileURL(join(REPO, "opencode/carga/ejecutar.ts")).href)})
    let codigo = null
    try {
      await ejecutar.lanzarCarga(proceso.run, ejecutar.argvDeCargaHeredada({ puerto: "/dev/ttyUSB0" }), process.cwd())
    } catch (error) {
      codigo = error.codigo ?? String(error)
    }
    console.log(JSON.stringify({ robada: proceso.esCapacidadDeCarga(robada), codigo, lanzados }))
  `
  const hijo = spawnSync(process.execPath, ["--input-type=module", "-e", guionHijo], { cwd: TMP, encoding: "utf8", timeout: 60_000, env: { ...process.env, HOME: HOME_FALSO } })
  assert.equal(hijo.status, 0, `el hijo falló: ${hijo.stderr}`)
  const r = JSON.parse(hijo.stdout.trim().split("\n").pop())
  assert.equal(r.robada, true, "fixture: el hijo tiene que haber reclamado la capacidad primero")
  assert.equal(r.codigo, "RUTA_DE_CARGA_NO_AUTORIZADA")
  assert.equal(r.lanzados, 0)
})

// Un guard que nunca puede fallar da falsa tranquilidad: esta función se prueba primero
// contra un árbol con trampa y recién después contra el repo.
function quienesNombranElReclamo(raiz) {
  const hallados = []
  const recorrer = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue
      const ruta = join(dir, e.name)
      if (e.isDirectory()) recorrer(ruta)
      else if (/\.(ts|tsx|js|mjs)$/.test(e.name) && /\breclamarCapacidadDeCarga\b/.test(readFileSync(ruta, "utf8"))) hallados.push(relative(raiz, ruta).split(sep).join("/"))
    }
  }
  recorrer(raiz)
  return hallados.sort()
}

test("nadie más que ejecutar.ts pide la capacidad en opencode/ (y el buscador encuentra una trampa plantada)", () => {
  const trampa = join(TMP, "arbol-con-trampa")
  mkdirSync(join(trampa, "tool"), { recursive: true })
  mkdirSync(join(trampa, "carga"), { recursive: true })
  writeFileSync(join(trampa, "carga", "proceso.ts"), "export function reclamarCapacidadDeCarga() {}\n")
  writeFileSync(join(trampa, "tool", "atajo.ts"), 'import { reclamarCapacidadDeCarga } from "../carga/proceso.ts"\n')
  writeFileSync(join(trampa, "tool", "inocente.ts"), "export const x = 1\n")
  assert.deepEqual(quienesNombranElReclamo(trampa), ["carga/proceso.ts", "tool/atajo.ts"], "el buscador no ve la trampa: no sirve de guard")

  assert.deepEqual(quienesNombranElReclamo(join(REPO, "opencode")), ["carga/ejecutar.ts", "carga/proceso.ts"])
})

// ═════════════════════════════════════════════════════════════════════════════════════
// 2. Lo que NO es una carga sigue andando
// ═════════════════════════════════════════════════════════════════════════════════════

const NO_SON_CARGA = [
  ["compilar", ["pio", "run"]],
  ["compilar un environment", ["pio", "run", "-e", "esp32dev"]],
  ["compilar la carpeta derivada (programa)", ["pio", "run", "-d", "/home/profe/.tecnia-vista-fisica/programa/activo", "-e", "esp32-devkit-v1"]],
  ["compilar en una carpeta que se llama como una herramienta", ["pio", "run", "-d", "/home/profe/taller-esptool/avrdude-viejo", "-e", "uno"]],
  ["--project-dir con nombre de herramienta", ["pio", "run", "--project-dir", "/srv/espota/proyecto"]],
  ["sólo nobuild (no sube nada)", ["pio", "run", "-t", "nobuild"]],
  ["otro target", ["pio", "run", "-t", "clean"]],
  ["la versión", ["pio", "--version"]],
  ["listar puertos", ["pio", "device", "list", "--json-output"]],
  ["el monitor (usa --port, no --upload-port)", ["pio", "device", "monitor", "--port", "/dev/ttyUSB0", "--baud", "115200"]],
  ["un environment que se llama upload no es un target", ["pio", "run", "-e", "upload"]],
  ["powershell del diagnóstico", ["powershell", "-NoProfile", "-Command", "Get-CimInstance Win32_PnPEntity"]],
  ["el monitor de Windows", ["cmd", "/c", "start", "Monitor Serial - COM5", "cmd", "/k", "C:\\.platformio\\penv\\Scripts\\pio.exe", "device", "monitor", "--port", "COM5", "--baud", "9600"]],
  ["pio instalado bajo una carpeta con nombre de herramienta", ["/opt/esptool-lab/.platformio/penv/bin/pio", "run"]],
]

for (const [nombre, cmd] of NO_SON_CARGA) {
  test(`no es carga y se lanza sin capacidad — ${nombre}`, async () => {
    assert.equal(proceso.argvEsDeCarga(cmd), false)
    const r = await proceso.run(cmd, TMP)
    assert.equal(r.code, 0)
    assert.equal(spawns.length, 1)
    assert.deepEqual(spawns[0].cmd, cmd)
  })
}

test("la excepción de -d es sólo para la CARPETA: `pio run -d <carpeta> -t upload` sigue siendo una carga", async () => {
  await rechazaSinLanzar(["pio", "run", "-d", "/home/profe/taller-esptool", "-t", "upload"])
  await rechazaSinLanzar(["pio", "run", "-d", "/x", "--upload-port", "/dev/ttyUSB0"])
})

// ═════════════════════════════════════════════════════════════════════════════════════
// 3. run(): códigos y salida parcial
// ═════════════════════════════════════════════════════════════════════════════════════

test("run(): timeout (124) CONSERVA lo que el proceso alcanzó a escribir en stdout y stderr", async () => {
  guion = () => escribeYSeCuelga("Writing at 0x00010000... (44 %)\n", "aviso del proceso\n")
  const r = await proceso.run(["pio", "run"], TMP, undefined, 50)
  assert.equal(r.code, proceso.CODIGO_TIMEOUT)
  assert.equal(r.code, 124)
  assert.equal(r.stdout, "Writing at 0x00010000... (44 %)\n", "se perdió el stdout parcial")
  assert.match(r.stderr, /^aviso del proceso\n/, "se perdió el stderr parcial")
  assert.match(r.stderr, /no termino en/, "el aviso del corte tiene que seguir estando")
  assert.equal(spawns[0].proc.matado, true)
})

test("run(): cancelación (130) CONSERVA el stdout parcial", async () => {
  guion = () => escribeYSeCuelga("Writing at 0x0002edcc... (55 %)\n")
  const ctrl = new AbortController()
  const corriendo = proceso.run(["pio", "run"], TMP, ctrl.signal, 60_000)
  // Se cancela recién cuando el proceso ya fue lanzado: sin esperar un tiempo a ciegas.
  await new Promise((listo) => setImmediate(listo))
  assert.equal(spawns.length, 1, "fixture: el proceso tiene que estar lanzado antes de cancelar")
  await new Promise((listo) => setImmediate(listo))
  ctrl.abort()
  const r = await corriendo
  assert.equal(r.code, proceso.CODIGO_CANCELADO)
  assert.equal(r.code, 130)
  assert.match(r.stdout, /Writing at 0x0002edcc\.\.\. \(55 %\)/)
  assert.equal(r.stderr, "Cancelado por el usuario.", "sin stderr parcial, el mensaje es el de siempre")
})

test("run(): sin nada escrito, el corte devuelve exactamente lo de siempre (stdout vacío, mensaje fijo)", async () => {
  guion = () => escribeYSeCuelga("")
  const r = await proceso.run(["pio", "run"], TMP, undefined, 50)
  assert.equal(r.code, 124)
  assert.equal(r.stdout, "")
  assert.match(r.stderr, /^El comando no termino en .* y se corto: /)
})

test("run(): un proceso que termina devuelve la salida ENTERA, también si llegó en trozos y con un caracter partido", async () => {
  const eñe = bytes("ñ") // dos bytes: se parte entre dos trozos
  guion = () => ({
    stdout: new ReadableStream({
      start(c) {
        c.enqueue(bytes("Compilando ma"))
        c.enqueue(eñe.slice(0, 1))
        c.enqueue(eñe.slice(1))
        c.enqueue(bytes("ana\n[SUCCESS]\n"))
        c.close()
      },
    }),
    stderr: new ReadableStream({ start: (c) => (c.enqueue(bytes("warning: x\n")), c.close()) }),
    exited: Promise.resolve(0),
  })
  const r = await proceso.run(["pio", "run"], TMP)
  assert.deepEqual(r, { code: 0, stdout: "Compilando mañana\n[SUCCESS]\n", stderr: "warning: x\n" })
})

test("run(): los dobles que entregan strings en vez de streams siguen andando", async () => {
  guion = () => ({ code: 3, stdout: "salida", stderr: "error" })
  assert.deepEqual(await proceso.run(["pio", "run"], TMP), { code: 3, stdout: "salida", stderr: "error" })
})

test("run(): si no se puede lanzar el proceso devuelve 127 (CODIGO_NO_LANZADO)", async () => {
  guion = () => new Error("ENOENT")
  const r = await proceso.run(["pio", "--version"], TMP)
  assert.equal(proceso.CODIGO_NO_LANZADO, 127)
  assert.equal(r.code, 127)
  assert.match(r.stderr, /command not found/)
})

test("timeoutCarga(): el tope largo, y TECNIA_PIO_TIMEOUT_MS manda", () => {
  assert.equal(proceso.timeoutCarga(), 15 * 60_000)
  assert.equal(proceso.timeoutCarga(), proceso.timeoutLargoMs())
  process.env.TECNIA_PIO_TIMEOUT_MS = "1234"
  assert.equal(proceso.timeoutCarga(), 1234)
  process.env.TECNIA_PIO_TIMEOUT_MS = "abc"
  assert.equal(proceso.timeoutCarga(), 15 * 60_000)
})

// ═════════════════════════════════════════════════════════════════════════════════════
// 4. traducirError: los patrones nuevos (con los textos que imprimen las herramientas)
// ═════════════════════════════════════════════════════════════════════════════════════

const PUERTO_NO_SE_ABRE = [
  ["esptool: puerto ocupado o inexistente", "A fatal error occurred: Could not open /dev/ttyUSB0, the port is busy or doesn't exist.\n"],
  ["pyserial en Linux: Device or resource busy", "[Errno 16] could not open port /dev/ttyUSB0: [Errno 16] Device or resource busy: '/dev/ttyUSB0'\n"],
  ["pyserial en Windows: Access is denied", "could not open port 'COM5': PermissionError(13, 'Access is denied.', None, 5)\n"],
  ["avrdude: can't open device", 'avrdude: ser_open(): can\'t open device "/dev/ttyACM0": Device or resource busy\n'],
  ["avrdude en Windows", 'avrdude: ser_open(): can\'t open device "\\\\.\\COM5": Access is denied.\n'],
]
for (const [nombre, salida] of PUERTO_NO_SE_ABRE) {
  test(`traducirError: ${nombre} → el puerto no se pudo abrir`, () => {
    const t = proceso.traducirError(salida, "")
    assert.match(t, /No pude abrir el puerto de la placa/)
    assert.match(t, /monitor serial/)
    assert.equal(proceso.traducirError("", salida), t, "tiene que reconocerlo también si llegó por stdout")
  })
}

test("traducirError: verification error → la verificación falló, NO «revisá el cable» genérico", () => {
  const t = proceso.traducirError("avrdude: verification error, first mismatch at byte 0x0040\navrdude: verification error; content mismatch\n", "")
  assert.match(t, /VERIFICACION fallo/)
  assert.match(t, /No la des por cargada/)
})

test("traducirError: «Access is denied» y «resource busy» SUELTOS (un compilador, un rm) no se confunden con el puerto", () => {
  const compilador = "ld.exe: cannot open output file .pio\\build\\uno\\firmware.elf: Access is denied\ncollect2.exe: error: ld returned 1 exit status\n"
  assert.doesNotMatch(proceso.traducirError(compilador, ""), /No pude abrir el puerto/)
  const rm = "rm: cannot remove '.pio/build': Device or resource busy\n"
  assert.doesNotMatch(proceso.traducirError(rm, ""), /No pude abrir el puerto/)
})

test("traducirError: lo que ya se traducía sigue igual (avrdude sin sincronizar, permiso en Linux, ESP32 que no contesta)", () => {
  assert.match(proceso.traducirError("avrdude: stk500_getsync() attempt 1 of 10: not in sync: resp=0x00\n", ""), /Problema al subir el codigo al Arduino/)
  // El permiso de Linux viene envuelto en el mensaje de esptool: gana el consejo del grupo, que es el que arregla.
  const permiso = "A fatal error occurred: Could not open /dev/ttyUSB0, the port is busy or doesn't exist.\n([Errno 13] could not open port /dev/ttyUSB0: [Errno 13] Permission denied: '/dev/ttyUSB0')\n"
  assert.match(proceso.traducirError(permiso, ""), /Sin permiso para usar el puerto serial/)
  assert.match(proceso.traducirError("A fatal error occurred: Failed to connect to ESP32: No serial data received.\n", ""), /El ESP32 no respondio/)
})

// ═════════════════════════════════════════════════════════════════════════════════════
// 5. tool/platformio.ts re-exporta lo mudado con los mismos nombres
// ═════════════════════════════════════════════════════════════════════════════════════

test("tool/platformio.ts re-exporta de carga/ los MISMOS objetos, con los nombres de siempre", async () => {
  const tool = await import(join(REPO, "opencode/tool/platformio.ts"))
  const identidad = await import(join(REPO, "opencode/carga/identidad.ts"))
  for (const nombre of ["run", "timeoutLargoMs", "timeoutCompilarMs", "CODIGO_TIMEOUT", "CODIGO_CANCELADO", "CODIGO_NO_LANZADO", "traducirError", "recortarSalida", "pioBin", "pioDisponible", "pioCandidatos", "resetPioCache"]) {
    assert.notEqual(tool[nombre], undefined, `platformio.ts ya no exporta ${nombre}`)
    assert.equal(tool[nombre], proceso[nombre], `${nombre} de platformio.ts no es el de carga/proceso.ts`)
  }
  for (const nombre of ["identificar", "CHIPS_USB", "puertoValido"]) {
    assert.notEqual(tool[nombre], undefined, `platformio.ts ya no exporta ${nombre}`)
    assert.equal(tool[nombre], identidad[nombre], `${nombre} de platformio.ts no es el de carga/identidad.ts`)
  }
  // Lo que usa tool/programa.ts (su import de ./platformio.ts) tiene que existir.
  const importado = readFileSync(join(REPO, "opencode/tool/programa.ts"), "utf8").match(/import \{([^}]+)\} from "\.\/platformio\.ts"/)
  assert.ok(importado, "no encontré el import de ./platformio.ts en programa.ts")
  for (const nombre of importado[1].split(",").map((n) => n.trim()).filter(Boolean)) {
    assert.notEqual(tool[nombre], undefined, `programa.ts importa ${nombre} y platformio.ts no lo exporta`)
  }
})

test("carga/ no importa nunca una tool ni el plugin de OpenCode", () => {
  const dir = join(REPO, "opencode/carga")
  const archivos = readdirSync(dir).filter((f) => f.endsWith(".ts"))
  for (const modulo of ["proceso.ts", "identidad.ts", "ejecutar.ts"]) assert.ok(archivos.includes(modulo), `fixture: falta carga/${modulo}`)
  for (const f of archivos) {
    const codigo = readFileSync(join(dir, f), "utf8")
    for (const m of codigo.matchAll(/^\s*(?:import|export)\b[^\n]*?\bfrom\s+["']([^"']+)["']/gm)) {
      assert.ok(m[1].startsWith("node:") || m[1].startsWith("./"), `carga/${f} importa «${m[1]}»: sólo puede importar node: y módulos de carga/`)
    }
    assert.doesNotMatch(codigo, /\bimport\s*\(/, `carga/${f} usa un import dinámico`)
  }
})
