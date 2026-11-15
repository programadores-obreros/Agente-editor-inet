// `opencode/carga/puertos.ts`: el candado de puerto EN DISCO, entre procesos
// (Slice 2, gate único de carga — CONTRATOS-API §3, ADR-001 §10.4, decisión D4;
// pruebas N-34, N-35, N-53 y N-54 de la matriz de riesgos, a nivel del módulo).
//
// Nunca se toca un puerto serie: `reservarPuerto` sólo escribe un archivo. Y nunca se
// escribe en la config real: `XDG_CONFIG_HOME` se fija a un temporal ANTES de importar
// el módulo, y el primer test comprueba que la ruta del candado cae ahí adentro.
//
// La regla que se fija acá: ante la duda, el puerto está OCUPADO. Un candado ilegible,
// un fallo de disco, un puerto con forma rara: todo `PUERTO_OCUPADO`, nada se pisa.
//
// Los tests de dos procesos usan hijos reales de node (`carga-puertos-hijo.mjs`) con
// centinelas por stdin/stdout: no hay ninguna espera a ciegas.
//
// MUTACIONES que ponen esto rojo (verificadas a mano, ver el informe de la etapa):
// devolver `ok` sin tomar el candado; tratar un candado ilegible como libre; liberar
// sin comparar el contenido; dejar que un fallo de E/S siga de largo.

import { test, before, beforeEach, after } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const TESTS_DIR = dirname(fileURLToPath(import.meta.url))
const REPO = join(TESTS_DIR, "..")
const HIJO = join(TESTS_DIR, "carga-puertos-hijo.mjs")
const TMP = mkdtempSync(join(os.tmpdir(), "tecniabot-carga-puertos-"))
const XDG = join(TMP, "config")
const CARPETA = join(XDG, "opencode", "tecnia-candados")
const XDG_ORIGINAL = process.env.XDG_CONFIG_HOME

// ANTES de importar nada de carga/: ningún test puede escribir en ~/.config.
process.env.XDG_CONFIG_HOME = XDG

let puertos
let n = 0
/** Un puerto distinto por test (con forma válida): los tests no se pisan entre sí. */
const nuevoPuerto = () => `/dev/ttyPRUEBA${n++}`

before(async () => {
  puertos = await import(join(REPO, "opencode/carga/puertos.ts"))
})

beforeEach(() => {
  process.env.XDG_CONFIG_HOME = XDG
  puertos.liberarTodosLosPuertos()
})

after(() => {
  puertos.liberarTodosLosPuertos()
  if (XDG_ORIGINAL === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = XDG_ORIGINAL
  rmSync(TMP, { recursive: true, force: true })
})

function pidMuerto() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["-e", "process.exit(0)"])
    proc.on("exit", () => resolve(proc.pid))
    proc.on("error", reject)
  })
}

function ocupado(r) {
  assert.equal(r.ok, false, "reservó un puerto que no podía reservar")
  assert.equal(r.codigo, "PUERTO_OCUPADO")
  assert.equal(typeof r.detalle, "string")
  assert.ok(r.detalle.length > 0)
  assert.equal("liberar" in r, false)
}

/** Planta a mano el candado de `puerto`, como si lo hubiera dejado otro proceso. */
function plantar(puerto, contenido) {
  const ruta = puertos.rutaCandado(puerto)
  mkdirSync(dirname(ruta), { recursive: true })
  writeFileSync(ruta, typeof contenido === "string" ? contenido : JSON.stringify(contenido))
  return ruta
}

// ═════════════════════════════════════════════════════════════════════════════════════
// Dónde va el candado
// ═════════════════════════════════════════════════════════════════════════════════════

test("rutaCandado: XDG_CONFIG_HOME/opencode/tecnia-candados/<puerto saneado>.lock — y nunca fuera del temporal del test", () => {
  assert.equal(puertos.rutaCandado("/dev/ttyACM0"), join(CARPETA, "dev-ttyACM0.lock"))
  assert.equal(puertos.rutaCandado("/dev/cu.usbserial-14140"), join(CARPETA, "dev-cu.usbserial-14140.lock"))
  assert.equal(puertos.rutaCandado("COM5"), join(CARPETA, "COM5.lock"))
  assert.equal(puertos.rutaCandado("com5"), join(CARPETA, "COM5.lock"), "en Windows com5 y COM5 son el mismo puerto: un solo candado")
  assert.ok(puertos.rutaCandado(nuevoPuerto()).startsWith(TMP), "el candado caería fuera del temporal del test")
})

test("rutaCandado: sin XDG_CONFIG_HOME cae en ~/.config/opencode/tecnia-candados (al lado de tecnia-cargas.json)", () => {
  const homeOriginal = process.env.HOME
  delete process.env.XDG_CONFIG_HOME
  process.env.HOME = join(TMP, "casa")
  try {
    assert.equal(puertos.rutaCandado("/dev/ttyUSB0"), join(TMP, "casa", ".config", "opencode", "tecnia-candados", "dev-ttyUSB0.lock"))
  } finally {
    process.env.HOME = homeOriginal
    process.env.XDG_CONFIG_HOME = XDG
  }
})

test("rutaCandado: un «puerto» inventado no puede sacar el archivo de la carpeta de candados", () => {
  for (const malo of ["../../../etc/cron.d/x", "/dev/../../tmp/x", "..", "C:\\Windows\\System32\\x", "/dev/tty USB0", "a/b/c", "", "/"]) {
    const ruta = puertos.rutaCandado(malo)
    assert.equal(dirname(ruta), CARPETA, `${JSON.stringify(malo)} → ${ruta}`)
    assert.match(ruta, /\.lock$/)
  }
})

// ═════════════════════════════════════════════════════════════════════════════════════
// Reservar y liberar
// ═════════════════════════════════════════════════════════════════════════════════════

test("puerto libre: se reserva, el candado queda en disco con {pid, hostname, creado} y nada más", () => {
  const puerto = nuevoPuerto()
  const r = puertos.reservarPuerto(puerto, "platformio-flash")
  assert.equal(r.ok, true)
  assert.equal(typeof r.liberar, "function")
  const enDisco = JSON.parse(readFileSync(puertos.rutaCandado(puerto), "utf8"))
  assert.deepEqual(Object.keys(enDisco).sort(), ["creado", "hostname", "pid"], "el candado no puede llevar la etiqueta del dueño, rutas ni la serie de la placa")
  assert.equal(enDisco.pid, process.pid)
  assert.deepEqual(puertos.duenoDelPuerto(puerto), { pid: process.pid, hostname: hostname(), creado: enDisco.creado })
  r.liberar()
  assert.equal(existsSync(puertos.rutaCandado(puerto)), false)
  assert.equal(puertos.duenoDelPuerto(puerto), null)
})

test("dos reservas del MISMO puerto: la segunda es PUERTO_OCUPADO y no toca el candado de la primera", () => {
  const puerto = nuevoPuerto()
  const primera = puertos.reservarPuerto(puerto, "carga-A")
  assert.equal(primera.ok, true)
  const antes = readFileSync(puertos.rutaCandado(puerto), "utf8")

  const segunda = puertos.reservarPuerto(puerto, "carga-B")
  ocupado(segunda)
  assert.match(segunda.detalle, /carga-A/, "tiene que decir quién lo tiene")
  assert.equal(readFileSync(puertos.rutaCandado(puerto), "utf8"), antes)

  // Mientras la primera no libere, sigue ocupado todas las veces.
  ocupado(puertos.reservarPuerto(puerto, "carga-C"))
  primera.liberar()
  const tercera = puertos.reservarPuerto(puerto, "carga-D")
  assert.equal(tercera.ok, true, "después de liberar, el puerto tiene que poder reservarse de nuevo")
  tercera.liberar()
})

test("COM5 y com5 son el mismo puerto: no se pueden reservar los dos", () => {
  const a = puertos.reservarPuerto("COM5", "A")
  assert.equal(a.ok, true)
  ocupado(puertos.reservarPuerto("com5", "B"))
  a.liberar()
})

test("puertos distintos no se molestan", () => {
  const a = puertos.reservarPuerto(nuevoPuerto(), "A")
  const b = puertos.reservarPuerto(nuevoPuerto(), "B")
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  a.liberar()
  b.liberar()
})

test("candado de OTRO proceso que está vivo: PUERTO_OCUPADO con su pid, y el archivo queda intacto", () => {
  const puerto = nuevoPuerto()
  // El pid del proceso padre (el corredor de tests): vivo, y no es este proceso.
  const ajeno = { pid: process.ppid, hostname: hostname(), creado: "2026-01-01T00:00:00.000Z" }
  const ruta = plantar(puerto, ajeno)
  const r = puertos.reservarPuerto(puerto, "yo")
  ocupado(r)
  assert.match(r.detalle, new RegExp(`pid ${process.ppid}\\b`))
  assert.deepEqual(JSON.parse(readFileSync(ruta, "utf8")), ajeno)
  assert.deepEqual(puertos.duenoDelPuerto(puerto), ajeno)
})

test("N-53: candado de un dueño MUERTO — se recupera, queda propio y se libera limpio", async () => {
  const puerto = nuevoPuerto()
  const ruta = plantar(puerto, { pid: await pidMuerto(), hostname: hostname(), creado: new Date(0).toISOString() })
  const r = puertos.reservarPuerto(puerto, "yo")
  assert.equal(r.ok, true, `no recuperó el candado de un proceso muerto: ${r.detalle}`)
  assert.equal(puertos.duenoDelPuerto(puerto).pid, process.pid)
  assert.deepEqual(readdirSync(dirname(ruta)).filter((f) => f.includes(".recuperando") || f.endsWith(".tmp")), [], "quedó el reclamo o un temporal")
  r.liberar()
  assert.equal(existsSync(ruta), false)
})

for (const [descripcion, contenido] of [
  ["archivo vacío", ""],
  ["JSON cortado", '{"pid":12'],
  ["JSON sin los campos del dueño", '{"otra":"cosa"}'],
  ["no es JSON", "ocupado"],
  ["pid que no es un número", { pid: "doce", hostname: "x", creado: "y" }],
  ["pid cero", { pid: 0, hostname: "x", creado: "y" }],
  ["pid negativo", { pid: -1, hostname: "x", creado: "y" }],
  ["hostname que no es texto", { pid: 4242, hostname: 7, creado: "y" }],
  ["sin fecha", { pid: 4242, hostname: "x" }],
]) {
  test(`N-54: candado ilegible (${descripcion}) → PUERTO_OCUPADO, y el archivo queda byte a byte igual`, () => {
    const puerto = nuevoPuerto()
    const ruta = plantar(puerto, contenido)
    const antes = readFileSync(ruta, "utf8")
    const r = puertos.reservarPuerto(puerto, "yo")
    ocupado(r)
    assert.equal(readFileSync(ruta, "utf8"), antes, "pisó un candado que no podía leer")
    assert.deepEqual(readdirSync(dirname(ruta)).filter((f) => f.includes(".recuperando") || f.endsWith(".tmp")), [], "intentó recuperarlo")
    assert.equal(puertos.duenoDelPuerto(puerto), null, "un candado ilegible no tiene dueño que informar")
    // Y sigue ocupado: no hay una segunda vez que lo deje pasar.
    ocupado(puertos.reservarPuerto(puerto, "yo-de-nuevo"))
  })
}

test("liberar() sólo libera lo PROPIO: si el candado ya es de otro, no lo borra", () => {
  const puerto = nuevoPuerto()
  const r = puertos.reservarPuerto(puerto, "yo")
  assert.equal(r.ok, true)
  const ruta = puertos.rutaCandado(puerto)
  // Otro proceso se quedó con el candado (por ejemplo, lo recuperó creyéndome muerto).
  const deOtro = JSON.stringify({ pid: process.ppid, hostname: hostname(), creado: "2031-05-05T05:05:05.000Z" })
  writeFileSync(ruta, deOtro)
  r.liberar()
  assert.equal(readFileSync(ruta, "utf8"), deOtro, "liberar() borró el candado de otro dueño")
})

test("liberar() se puede llamar muchas veces, y una reserva vieja no libera la reserva nueva del mismo puerto", () => {
  const puerto = nuevoPuerto()
  const vieja = puertos.reservarPuerto(puerto, "vieja")
  vieja.liberar()
  vieja.liberar()
  const nueva = puertos.reservarPuerto(puerto, "nueva")
  assert.equal(nueva.ok, true)
  vieja.liberar() // tardía: el candado ahora es de `nueva`
  assert.equal(existsSync(puertos.rutaCandado(puerto)), true, "una liberación tardía borró el candado de otra reserva")
  ocupado(puertos.reservarPuerto(puerto, "tercera"))
  nueva.liberar()
  assert.equal(existsSync(puertos.rutaCandado(puerto)), false)
})

test("liberarTodosLosPuertos: libera los de este proceso y no toca los de otros; después, sus liberar() no hacen nada", () => {
  const mio1 = nuevoPuerto()
  const mio2 = nuevoPuerto()
  const ajeno = nuevoPuerto()
  const r1 = puertos.reservarPuerto(mio1, "A")
  const r2 = puertos.reservarPuerto(mio2, "B")
  const contenidoAjeno = { pid: process.ppid, hostname: hostname(), creado: "2026-01-01T00:00:00.000Z" }
  const rutaAjena = plantar(ajeno, contenidoAjeno)

  puertos.liberarTodosLosPuertos()
  assert.equal(existsSync(puertos.rutaCandado(mio1)), false)
  assert.equal(existsSync(puertos.rutaCandado(mio2)), false)
  assert.deepEqual(JSON.parse(readFileSync(rutaAjena, "utf8")), contenidoAjeno)

  // Se vuelve a reservar: los liberar() de las reservas ya liberadas no pueden tocarlo.
  const otraVez = puertos.reservarPuerto(mio1, "C")
  assert.equal(otraVez.ok, true)
  r1.liberar()
  r2.liberar()
  assert.equal(existsSync(puertos.rutaCandado(mio1)), true)
  otraVez.liberar()
})

// ═════════════════════════════════════════════════════════════════════════════════════
// Fallar cerrado
// ═════════════════════════════════════════════════════════════════════════════════════

test("fallo de E/S (la carpeta de candados no se puede crear) → PUERTO_OCUPADO, sin tirar y sin escribir nada", () => {
  // XDG_CONFIG_HOME apunta ADENTRO de un archivo común: mkdir falla con ENOTDIR.
  const archivo = join(TMP, "soy-un-archivo")
  writeFileSync(archivo, "x")
  process.env.XDG_CONFIG_HOME = join(archivo, "config")
  try {
    const r = puertos.reservarPuerto(nuevoPuerto(), "yo")
    ocupado(r)
    assert.match(r.detalle, /ENOTDIR|EEXIST/)
    assert.equal(readFileSync(archivo, "utf8"), "x")
  } finally {
    process.env.XDG_CONFIG_HOME = XDG
  }
})

test("fallo de E/S (el lugar del candado es una carpeta) → PUERTO_OCUPADO, y la carpeta queda", () => {
  const puerto = nuevoPuerto()
  const ruta = puertos.rutaCandado(puerto)
  mkdirSync(ruta, { recursive: true })
  ocupado(puertos.reservarPuerto(puerto, "yo"))
  assert.equal(existsSync(ruta), true)
  rmSync(ruta, { recursive: true })
})

test("algo que no tiene forma de puerto serie no se reserva: PUERTO_OCUPADO y ningún archivo", () => {
  const antes = existsSync(CARPETA) ? readdirSync(CARPETA).sort() : []
  for (const malo of ["192.168.1.20", "esp32.local", "", "../../x", "/dev/ttyUSB0; id", undefined, null, 5]) {
    ocupado(puertos.reservarPuerto(malo, "yo"))
  }
  assert.deepEqual(existsSync(CARPETA) ? readdirSync(CARPETA).sort() : [], antes)
})

// ═════════════════════════════════════════════════════════════════════════════════════
// Dos PROCESOS de verdad
// ═════════════════════════════════════════════════════════════════════════════════════

/** Lanza un hijo y lo lleva hasta "LISTO" (módulo ya importado). `resultado` resuelve con su línea JSON. */
function lanzarHijo(puerto, etiqueta) {
  return new Promise((resolveListo, reject) => {
    const proc = spawn(process.execPath, [HIJO, puerto, etiqueta], { env: { ...process.env, REPO_OBJ: REPO, XDG_CONFIG_HOME: XDG }, stdio: ["pipe", "pipe", "inherit"] })
    let buffer = ""
    let lineas = 0
    let resolverResultado
    const resultado = new Promise((r) => (resolverResultado = r))
    const cerrado = new Promise((r) => proc.on("close", (codigo, senal) => r({ codigo, senal })))
    proc.stdout.on("data", (d) => {
      buffer += d.toString()
      let i
      while ((i = buffer.indexOf("\n")) !== -1) {
        const linea = buffer.slice(0, i).trim()
        buffer = buffer.slice(i + 1)
        if (!linea) continue
        lineas += 1
        if (lineas === 1) {
          if (linea !== "LISTO") reject(new Error(`el hijo ${etiqueta} no dijo LISTO: ${linea}`))
          else resolveListo({ proc, resultado, cerrado })
        } else if (lineas === 2) resolverResultado(JSON.parse(linea))
      }
    })
    proc.on("error", reject)
    proc.on("close", (codigo) => {
      if (lineas === 0) reject(new Error(`el hijo ${etiqueta} terminó (código ${codigo}) antes de decir LISTO`))
    })
  })
}
const ordenar = (hijo, orden) => hijo.proc.stdin.write(`${orden}\n`)

test("N-35: dos PROCESOS compiten por el mismo puerto — gana exactamente uno, el otro recibe PUERTO_OCUPADO con el pid del dueño", async () => {
  const puerto = nuevoPuerto()
  // Los dos importan el módulo ANTES de anunciar LISTO: la carrera empieza recién con la orden.
  const [a, b] = await Promise.all([lanzarHijo(puerto, "A"), lanzarHijo(puerto, "B")])
  ordenar(a, "RESERVAR")
  ordenar(b, "RESERVAR")
  const [ra, rb] = await Promise.all([a.resultado, b.resultado])

  const ganadores = [ra, rb].filter((r) => r.ok)
  const perdedores = [ra, rb].filter((r) => !r.ok)
  assert.equal(ganadores.length, 1, `tenía que ganar exactamente uno: ${JSON.stringify([ra, rb])}`)
  assert.equal(perdedores.length, 1)
  assert.equal(perdedores[0].codigo, "PUERTO_OCUPADO")
  assert.match(perdedores[0].detalle, new RegExp(`pid ${ganadores[0].pid}\\b`), "el que pierde tiene que nombrar al dueño real")
  assert.equal(puertos.duenoDelPuerto(puerto).pid, ganadores[0].pid, "el candado en disco es el del ganador")

  // Este proceso (un tercero) tampoco puede, mientras el ganador siga vivo y dueño.
  ocupado(puertos.reservarPuerto(puerto, "tercero"))

  const ganador = ra.ok ? a : b
  const perdedor = ra.ok ? b : a
  ordenar(ganador, "LIBERAR")
  assert.deepEqual(await ganador.cerrado, { codigo: 0, senal: null })
  assert.deepEqual(await perdedor.cerrado, { codigo: 0, senal: null })

  // Liberado por su dueño: ya no hay candado y cualquiera puede reservar.
  assert.equal(existsSync(puertos.rutaCandado(puerto)), false)
  const despues = puertos.reservarPuerto(puerto, "despues")
  assert.equal(despues.ok, true)
  despues.liberar()
})

test("N-53 con un proceso real: el dueño se cae sin liberar (SIGKILL), el candado queda, y la próxima reserva lo recupera", async () => {
  const puerto = nuevoPuerto()
  const hijo = await lanzarHijo(puerto, "se-va-a-caer")
  ordenar(hijo, "RESERVAR")
  const r = await hijo.resultado
  assert.equal(r.ok, true)
  // Con el dueño vivo, ocupado.
  ocupado(puertos.reservarPuerto(puerto, "yo"))

  ordenar(hijo, "MORIR")
  const fin = await hijo.cerrado
  assert.equal(fin.senal, "SIGKILL", `fixture: el hijo tenía que morir por SIGKILL, terminó con ${JSON.stringify(fin)}`)
  assert.equal(puertos.duenoDelPuerto(puerto)?.pid, r.pid, "fixture: el candado del proceso caído tiene que seguir en disco")

  const recuperada = puertos.reservarPuerto(puerto, "yo")
  assert.equal(recuperada.ok, true, `no recuperó el candado de un proceso caído: ${recuperada.detalle}`)
  assert.equal(puertos.duenoDelPuerto(puerto).pid, process.pid)
  recuperada.liberar()
})

test("al salir el proceso con normalidad, sus candados se liberan solos (process.on exit)", async () => {
  const puerto = nuevoPuerto()
  // Un hijo que reserva y termina SIN llamar a liberar(): sale por process.exit(0).
  const guion = `
    const { reservarPuerto } = await import(${JSON.stringify(join(REPO, "opencode/carga/puertos.ts"))})
    const r = reservarPuerto(${JSON.stringify(puerto)}, "olvidadizo")
    console.log(JSON.stringify({ ok: r.ok }))
    process.exit(0)
  `
  const salida = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["--input-type=module", "-e", guion], { env: { ...process.env, XDG_CONFIG_HOME: XDG }, stdio: ["ignore", "pipe", "inherit"] })
    let texto = ""
    proc.stdout.on("data", (d) => (texto += d))
    proc.on("close", (codigo) => (codigo === 0 ? resolve(texto) : reject(new Error(`el hijo terminó con ${codigo}: ${texto}`))))
    proc.on("error", reject)
  })
  assert.deepEqual(JSON.parse(salida.trim()), { ok: true })
  assert.equal(existsSync(puertos.rutaCandado(puerto)), false, "el proceso salió y dejó el candado tomado")
})
