// Q-01 del QA de H1: cortar una carga corta el ÁRBOL entero (pio → scons → esptool), y `run()`
// no vuelve hasta comprobarlo.
//
// ACÁ HAY PROCESOS REALES, Y SON INOCUOS. El "pio" es un script de Node que se instala en un
// `PLATFORMIO_CORE_DIR` temporal (así `pioBin()` lo encuentra como encontraría al de verdad):
// con `device list` contesta una placa inventada; con cualquier otra cosa lanza un hijo
// ("scons") que lanza un nieto ("esptool"). El nieto anota su pid y la hora, y al cabo de un
// rato escribe un archivo MARCADOR: si el marcador aparece, la "grabación" siguió después del
// corte. No hay `pio` real, ni puerto, ni placa.
//
// `Bun.spawn` se imita con `child_process` (no hay Bun en esta máquina), con la semántica de
// Bun que importa acá: si se le pasa `signal`, mata SÓLO al hijo directo. `run()` ya no se la
// pasa a una carga; justamente eso es lo que se prueba.
//
// POR QUÉ ASÍ Y NO CON ESPÍAS: lo que estaba roto es la relación entre procesos de verdad
// (reparentado, señales, zombis). Un espía no tiene nietos.
//
// LIMPIEZA: cada pid que anotan los procesos se mata con SIGKILL en `finally`/`after`, pase lo
// que pase, por pid (nunca por patrón).
//
// POR QUÉ ESTE ARCHIVO FALLABA A VECES (2026-11-22). En una corrida de la suite completa
// dieron rojo tres tests de acá, y en la siguiente ninguno. No era la CPU ni un plazo corto:
// con los ocho núcleos ocupados daba verde. Era el PRODUCTO. El barrido final del corte lee
// el `environ` de cada proceso del usuario, y uno que se está muriendo en ese instante —de la
// suite, que corre varios archivos a la vez, o de cualquier otro programa— da EACCES. Se lo
// contaba como «ilegible» y el corte quedaba sin confirmar, con el árbol de la carga muerto.
// Se reproduce a pedido con ocho `while :; do node -e 0; done` corriendo al lado.
//
// El arreglo está en `yaNoEjecuta` (opencode/carga/arbol.ts). Y los `assert` de
// `procesosDeCargaTerminados` ahora muestran `r.stderr`: antes decían «false !== true» y no
// había forma de saber por qué no se había confirmado. NO se subió ningún plazo ni se agregó
// ningún reintento: eso hubiera tapado el defecto.

import { test, after } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pathToFileURL } from "node:url"
import os from "node:os"
import { REPO, nuevoDir } from "./phase2-helpers.mjs"

const LINUX = process.platform === "linux"
const OUT = mkdtempSync(join(os.tmpdir(), "tecniabot-carga-arbol-"))
const ENTORNO_ORIGINAL = { PLATFORMIO_CORE_DIR: process.env.PLATFORMIO_CORE_DIR, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME, TECNIA_PIO_TIMEOUT_MS: process.env.TECNIA_PIO_TIMEOUT_MS }
process.env.PLATFORMIO_CORE_DIR = join(OUT, "core")
process.env.XDG_CONFIG_HOME = join(OUT, "config")
process.env.XDG_CACHE_HOME = join(OUT, "cache")
delete process.env.TECNIA_PIO_TIMEOUT_MS

// ── Bun.spawn sobre child_process ──────────────────────────────────────────────────────
const BunOriginal = globalThis.Bun
const lanzados = []
globalThis.Bun = {
  which: () => null,
  spawn(cmd, o) {
    lanzados.push({ cmd: [...cmd], conSenal: o.signal !== undefined })
    const cp = spawn(cmd[0], cmd.slice(1), { cwd: o.cwd, ...(o.env ? { env: o.env } : {}), stdio: ["ignore", "pipe", "pipe"], ...(o.signal ? { signal: o.signal, killSignal: "SIGTERM" } : {}) })
    cp.on("error", () => {})
    const exited = new Promise((listo) => cp.on("exit", (c, s) => listo(c ?? (s === "SIGKILL" ? 137 : 143))))
    return { pid: cp.pid, stdout: Readable.toWeb(cp.stdout), stderr: Readable.toWeb(cp.stderr), exited, kill: (s) => cp.kill(s) }
  },
}

// ── El "pio" de mentira ────────────────────────────────────────────────────────────────
const PIDS = join(OUT, "pids")
mkdirSync(PIDS, { recursive: true })
const PLACA = { port: "/dev/ttyUSB0", hwid: "USB VID:PID=10C4:EA60 SER=A1B2C3D4E5 LOCATION=1-1", description: "CP2102" }
const PIO_FALSO = `#!${process.execPath}
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const dir = ${JSON.stringify(PIDS)}
const args = process.argv.slice(2)
if (args[0] === "device") { process.stdout.write(${JSON.stringify(JSON.stringify([PLACA]))}); process.exit(0) }
fs.writeFileSync(dir + "/pio.pid", String(process.pid))
fs.writeFileSync(dir + "/marca-vista-por-pio", process.env.TECNIA_CARGA ?? "")
const modo = fs.readFileSync(dir + "/modo", "utf8")
const nieto = \`
  const fs = require("node:fs")
  const dir = \${JSON.stringify(dir)}
  if (\${JSON.stringify(modo)}.startsWith("ignora")) process.on("SIGTERM", () => {})
  const espera = Number(\${JSON.stringify(modo)}.split(":")[1])
  fs.writeFileSync(dir + "/esptool.pid", JSON.stringify({ pid: process.pid, desde: Date.now(), espera }))
  setTimeout(() => { fs.writeFileSync(dir + "/MARCADOR", "grabé después del corte"); process.exit(0) }, espera)\`
const hijo = \`
  const { spawn } = require("node:child_process")
  require("node:fs").writeFileSync(\${JSON.stringify(dir)} + "/scons.pid", String(process.pid))
  // Modo "trap" (ciclo 2, B-2): como scons, maneja SIGTERM y sigue; al recibirlo lanza un hijo.
  if (\${JSON.stringify(modo)}.startsWith("trap")) process.on("SIGTERM", () => {
    spawn(process.execPath, ["-e", 'require("node:fs").writeFileSync(' + JSON.stringify(\${JSON.stringify(dir)} + "/tardio.pid") + ', String(process.pid)); setInterval(() => {}, 1000)'], { stdio: "ignore" })
  })
  // Modo "huerfano" (ciclo 5, el caso MEDIDO E5-huerfano-fuera-cancelacion): el nieto queda
  // huérfano ANTES del corte (doble fork: un intermedio lo lanza separado y se va), con cwd "/" y
  // sin nombrar la carpeta privada. "huerfano-limpio": además arranca con el entorno VACÍO (sin la
  // marca): es el límite declarado, no se cubre.
  if (\${JSON.stringify(modo)}.startsWith("huerfano")) {
    const entorno = \${JSON.stringify(modo)}.startsWith("huerfano-limpio") ? "{}" : "process.env"
    const intermedio = "const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', " + JSON.stringify(\${JSON.stringify(nieto)}) + "], { cwd: '/', detached: true, stdio: 'ignore', env: " + entorno + " }).unref(); process.exit(0)"
    spawn(process.execPath, ["-e", intermedio], { stdio: "ignore" })
  } else spawn(process.execPath, ["-e", \${JSON.stringify(nieto)}], { stdio: "ignore" })
  setInterval(() => {}, 1000)\`
spawn(process.execPath, ["-e", hijo], { stdio: "ignore" })
process.stdout.write("esptool.py v4.9.0\\nWriting at 0x00010000... (1 %)\\n")
setInterval(() => {}, 1000)
`
const bin = join(OUT, "core", "penv", "bin")
mkdirSync(bin, { recursive: true })
writeFileSync(join(bin, "pio"), PIO_FALSO)
chmodSync(join(bin, "pio"), 0o755)

const proceso = await import(join(REPO, "opencode/carga/proceso.ts"))
const { argvDeCargaCompilando, lanzarCarga } = await import(join(REPO, "opencode/carga/ejecutar.ts"))
const { conMarcaEnProc, inicioDe, terminarArbol, yaNoEjecuta } = await import(join(REPO, "opencode/carga/arbol.ts"))
const { reservarPuerto, liberarTodosLosPuertos } = await import(join(REPO, "opencode/carga/puertos.ts"))
const { ejecutarPrograma, HERRAMIENTAS_DE_CARGA } = await import(join(REPO, "opencode/tool/programa.ts"))
const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
proceso.resetPioCache()

// ── Ayudantes ──────────────────────────────────────────────────────────────────────────
const todos = new Set()
function pidsAnotados() {
  const salida = {}
  for (const f of existsSync(PIDS) ? readdirSync(PIDS) : []) {
    if (!f.endsWith(".pid")) continue
    const t = readFileSync(join(PIDS, f), "utf8")
    salida[f.slice(0, -4)] = t.startsWith("{") ? JSON.parse(t) : { pid: Number(t) }
    todos.add(salida[f.slice(0, -4)].pid)
  }
  return salida
}
/** Vivo = está en /proc y no es zombi. */
function vivo(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    const estado = stat.slice(stat.lastIndexOf(")") + 2)[0]
    return estado !== "Z" && estado !== "X"
  } catch {
    return false
  }
}
/** Espera POR CONDICIÓN, con tope (nunca un sleep a ciegas). */
async function hasta(cond, topeMs) {
  const fin = Date.now() + topeMs
  while (Date.now() < fin) {
    if (cond()) return true
    await new Promise((listo) => setTimeout(listo, 20))
  }
  return cond()
}
function limpiar() {
  pidsAnotados()
  for (const pid of todos) if (vivo(pid)) try { process.kill(pid, "SIGKILL") } catch {}
}
function preparar(modo) {
  limpiar()
  rmSync(PIDS, { recursive: true, force: true })
  mkdirSync(PIDS, { recursive: true })
  writeFileSync(join(PIDS, "modo"), modo)
}
/** Corta en cuanto el nieto ("esptool") ya está corriendo: el centinela lo escribe él. */
async function cortarCuandoGrabe(ctrl) {
  const listo = await hasta(() => existsSync(join(PIDS, "esptool.pid")), 10_000)
  ctrl.abort()
  return listo
}

after(() => {
  limpiar()
  liberarTodosLosPuertos()
  for (const [k, v] of Object.entries(ENTORNO_ORIGINAL)) if (v === undefined) delete process.env[k]
  else process.env[k] = v
  globalThis.Bun = BunOriginal
  rmSync(OUT, { recursive: true, force: true })
})

/** Una carpeta con la forma de la privada (prefijo de mkdtemp): el barrido del corte la exige. */
const CARGA = mkdtempSync(join(OUT, "carga-"))
/** Una marca de carga con la forma de la de verdad (64 hex), fija para estos tests. */
const MARCA = "a".repeat(64)
const argv = (cwd) => argvDeCargaCompilando({ cwd, environment: "esp32-devkit-v1", puerto: "/dev/ttyUSB0" })

// ════════════════════════════════════════════════════════════════════════════════════════

test("cancelar una carga termina pio, scons y esptool; run() vuelve recién con todos muertos; el nieto no llega a grabar", { skip: !LINUX && "usa /proc" }, async () => {
  preparar("normal:1500")
  try {
    const ctrl = new AbortController()
    const corriendo = lanzarCarga(proceso.run, argv(CARGA), CARGA, ctrl.signal, 60_000, CARGA, MARCA)
    assert.equal(await cortarCuandoGrabe(ctrl), true, "fixture: el nieto no arrancó")
    const r = await corriendo
    const p = pidsAnotados()
    // Al volver run(), ninguno de los tres vive.
    assert.deepEqual(["pio", "scons", "esptool"].filter((n) => vivo(p[n].pid)), [], "run() volvió con procesos de la carga vivos")
    assert.equal(r.code, 130)
    assert.equal(r.procesosDeCargaTerminados, true, `el corte no se confirmó. Lo que dijo el producto: ${r.stderr}`)
    assert.equal(lanzados.at(-1).conSenal, false, "a una carga no se le pasa la señal a Bun.spawn (mataría sólo al hijo)")
    // Pasado el momento en que el nieto iba a grabar, el marcador no existe.
    const { desde, espera } = p.esptool
    await hasta(() => Date.now() > desde + espera + 1000, espera + 3000)
    assert.equal(existsSync(join(PIDS, "MARCADOR")), false, "el nieto siguió grabando después del corte")
  } finally {
    limpiar()
  }
})

test("un descendiente que ignora SIGTERM cae por SIGKILL, y se confirma", { skip: !LINUX && "usa /proc" }, async () => {
  preparar("ignora:4500") // más que el tope de SIGTERM: si no lo mata SIGKILL, graba
  try {
    const ctrl = new AbortController()
    const corriendo = lanzarCarga(proceso.run, argv(CARGA), CARGA, ctrl.signal, 60_000, CARGA, MARCA)
    assert.equal(await cortarCuandoGrabe(ctrl), true)
    const r = await corriendo
    const p = pidsAnotados()
    assert.equal(vivo(p.esptool.pid), false, "el que ignora SIGTERM sigue vivo")
    assert.equal(r.procesosDeCargaTerminados, true, `el corte no se confirmó. Lo que dijo el producto: ${r.stderr}`)
    const { desde, espera } = p.esptool
    await hasta(() => Date.now() > desde + espera + 1000, espera + 3000)
    assert.equal(existsSync(join(PIDS, "MARCADOR")), false)
  } finally {
    limpiar()
  }
})

test("timeout de una carga: mismo corte del árbol, código 124", { skip: !LINUX && "usa /proc" }, async () => {
  preparar("normal:3000")
  try {
    // El tope corre desde el lanzamiento; 1 s alcanza para que el nieto esté vivo (se afirma).
    const r = await lanzarCarga(proceso.run, argv(CARGA), CARGA, undefined, 1000, CARGA, MARCA)
    const p = pidsAnotados()
    assert.equal(r.code, 124)
    assert.ok(p.esptool, "fixture: el nieto no llegó a arrancar antes del timeout")
    assert.equal(vivo(p.esptool.pid), false)
    assert.equal(r.procesosDeCargaTerminados, true, `el corte no se confirmó. Lo que dijo el producto: ${r.stderr}`)
    await hasta(() => Date.now() > p.esptool.desde + p.esptool.espera + 1000, 5000)
    assert.equal(existsSync(join(PIDS, "MARCADOR")), false)
  } finally {
    limpiar()
  }
})

test("si no se puede mirar el sistema, no se confirma", async () => {
  const PRIV = "/tmp/x/carga-abc"
  const sis = { plataforma: "linux", foto: () => null, referencian: () => [], conMarca: () => ({ pids: [], ilegibles: 0 }), senal: () => {}, taskkill: () => false }
  assert.deepEqual((await terminarArbol(123456, PRIV, MARCA, sis)).confirmado, false)
  const quedaVivo = { plataforma: "linux", foto: () => [{ pid: 4242, ppid: 1, zombi: false }], referencian: () => [], conMarca: () => ({ pids: [], ilegibles: 0 }), senal: () => {}, taskkill: () => false }
  assert.equal((await terminarArbol(4242, PRIV, MARCA, quedaVivo, { kill: 50 })).confirmado, false, "si sigue vivo después de SIGKILL, no se confirma")
  const sinBarrido = { plataforma: "linux", foto: () => [], referencian: () => null, conMarca: () => ({ pids: [], ilegibles: 0 }), senal: () => {}, taskkill: () => false }
  assert.equal((await terminarArbol(4242, PRIV, MARCA, sinBarrido, { kill: 50 })).confirmado, false, "si no se puede barrer por la carpeta, no se confirma")
})

// ════════════════════════════════════════════════════════════════════════════════════════
// Ciclo 2 (B-2, B-3, N-5)
// ════════════════════════════════════════════════════════════════════════════════════════

test("B-2: un proceso del árbol con handler de SIGTERM que lanza un hijo NO llega a lanzarlo (nunca se reanuda el árbol)", { skip: !LINUX && "usa /proc" }, async () => {
  preparar("trap:3000")
  try {
    const ctrl = new AbortController()
    const corriendo = lanzarCarga(proceso.run, argv(CARGA), CARGA, ctrl.signal, 60_000, CARGA, MARCA)
    assert.equal(await cortarCuandoGrabe(ctrl), true)
    const r = await corriendo
    const fin = Date.now() + 1500 // margen para que un hijo tardío alcance a anotarse si existiera
    await hasta(() => existsSync(join(PIDS, "tardio.pid")) || Date.now() > fin, 3000)
    const p = pidsAnotados()
    assert.equal(p.tardio, undefined, `el handler de SIGTERM lanzó un hijo después del corte (pid ${p.tardio?.pid})`)
    assert.deepEqual(["pio", "scons", "esptool"].filter((n) => vivo(p[n].pid)), [])
    assert.equal(r.procesosDeCargaTerminados, true, `el corte no se confirmó. Lo que dijo el producto: ${r.stderr}`)
  } finally {
    limpiar()
  }
})

/** Un padre que deja un nieto vivo (con cwd en `cwd` y con `extra` en su línea de comando) y termina. */
async function raizMuertaConNieto({ cwd, extra = "" }) {
  const nieto = `require("node:fs").writeFileSync(${JSON.stringify(join(PIDS, "huerfano.pid"))}, String(process.pid)); /* ${extra} */ setInterval(() => {}, 1000)`
  const padre = spawn(process.execPath, ["-e", `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(nieto)}], { cwd: ${JSON.stringify(cwd)}, stdio: "ignore", detached: true }).unref()`], { stdio: "ignore" })
  const pidPadre = padre.pid
  const inicio = inicioDe(pidPadre) // como hace run() justo después de lanzar
  await new Promise((listo) => padre.on("exit", listo)) // el padre terminó y Node lo recogió
  assert.equal(await hasta(() => existsSync(join(PIDS, "huerfano.pid")), 5000), true, "fixture: el nieto no arrancó")
  const huerfano = Number(readFileSync(join(PIDS, "huerfano.pid"), "utf8"))
  todos.add(huerfano)
  return { pidPadre, huerfano, inicio }
}

test("B-3: raíz ya muerta con un nieto vivo con cwd en la carpeta privada → el barrido lo mata y recién ahí confirma", { skip: !LINUX && "usa /proc" }, async () => {
  preparar("normal:1500")
  try {
    const { pidPadre, huerfano, inicio } = await raizMuertaConNieto({ cwd: CARGA })
    assert.equal(vivo(huerfano), true)
    const fin = await terminarArbol(pidPadre, CARGA, MARCA, undefined, undefined, inicio)
    assert.equal(vivo(huerfano), false, "el nieto huérfano que usaba la carpeta sigue vivo")
    assert.equal(fin.confirmado, true, fin.detalle)
  } finally {
    limpiar()
  }
})

test("B-3: raíz ya muerta con un nieto que NOMBRA la carpeta privada en su línea de comando (cwd en otro lado) → también se lo mata", { skip: !LINUX && "usa /proc" }, async () => {
  preparar("normal:1500")
  try {
    const { pidPadre, huerfano, inicio } = await raizMuertaConNieto({ cwd: OUT, extra: `${CARGA}/.pio/build/esp32-devkit-v1/firmware.bin` })
    const fin = await terminarArbol(pidPadre, CARGA, MARCA, undefined, undefined, inicio)
    assert.equal(vivo(huerfano), false)
    assert.equal(fin.confirmado, true, fin.detalle)
  } finally {
    limpiar()
  }
})

test("B-3: raíz muerta y sin carpeta privada → no se confirma (y no se manda nada a ese pid)", async () => {
  const senales = []
  const sis = { plataforma: "linux", foto: () => [{ pid: 1, ppid: 0, zombi: false }], referencian: () => [], conMarca: () => ({ pids: [], ilegibles: 0 }), senal: (pid, s) => senales.push([pid, s]), taskkill: () => false }
  const fin = await terminarArbol(4242, undefined, MARCA, sis, { kill: 50 })
  assert.equal(fin.confirmado, false)
  assert.deepEqual(senales, [], "a un pid que no estaba vivo no se le manda ninguna señal")
  const zombi = { ...sis, foto: () => [{ pid: 4242, ppid: 1, zombi: true }] }
  await terminarArbol(4242, "/tmp/x/carga-abc", MARCA, zombi, { kill: 50 })
  assert.deepEqual(senales, [], "tampoco a un zombi")
})

test("N-5: si el árbol congelado sigue creciendo hasta el tope de vueltas → no se confirma", async () => {
  let siguiente = 5000
  const foto = [{ pid: 4242, ppid: 1, zombi: false }]
  const sis = {
    plataforma: "linux",
    foto: () => {
      foto.push({ pid: siguiente, ppid: siguiente === 5000 ? 4242 : siguiente - 1, zombi: false })
      siguiente++
      return foto.map((p) => ({ ...p }))
    },
    referencian: () => [],
    conMarca: () => ({ pids: [], ilegibles: 0 }),
    senal: (pid, s) => {
      if (s === "SIGKILL") for (const p of foto) if (p.pid === pid) p.zombi = true
    },
    taskkill: () => false,
  }
  const fin = await terminarArbol(4242, "/tmp/x/carga-abc", MARCA, sis, { kill: 50 })
  assert.equal(fin.confirmado, false, fin.detalle)
  assert.match(fin.detalle, /siguió cambiando/)
})

test("lo que no es carga sigue como siempre: la señal va a Bun.spawn y no hay campo de árbol", { skip: !LINUX && "usa /proc" }, async () => {
  preparar("normal:1500")
  const r = await proceso.run(["pio", "device", "list", "--json-output"], OUT, new AbortController().signal)
  assert.equal(r.code, 0)
  assert.equal(lanzados.at(-1).conSenal, true)
  assert.equal("procesosDeCargaTerminados" in r, false)
})

// ════════════════════════════════════════════════════════════════════════════════════════
// De punta a punta: `programa cargar` con el run real y el pio de mentira
// ════════════════════════════════════════════════════════════════════════════════════════

const PRESIONADO = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }
const OPS = [
  { tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } },
  { tipo: "AgregarComponente", payload: { tipo: "pulsador" } },
  { tipo: "AgregarComponente", payload: { tipo: "led" } },
  { tipo: "AgregarComponente", payload: { tipo: "resistencia" } },
  { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: "GPIO4" } },
  { tipo: "AsignarPin", payload: { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" } },
  { tipo: "Conectar", payload: { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } } },
  { tipo: "SetComportamiento", payload: { comportamiento: { cuando: { sensor: "cmp-0", ...PRESIONADO }, entonces: { actuador: "cmp-1", accion: "encender" } } } },
]

test("programa cargar cancelado durante la grabación: árbol terminado y confirmado, el candado se suelta y el mensaje dice «a medio grabar»", { skip: !LINUX && "usa /proc" }, async () => {
  preparar("normal:1500")
  try {
    const dir = nuevoDir("carga-arbol")
    const leer = JSON.parse(await proyectoFisico.execute({ accion: "leer" }, { directory: dir }))
    assert.equal(JSON.parse(await proyectoFisico.execute({ accion: "aplicar", baseRevision: leer.revision, operaciones: OPS }, { directory: dir })).ok, true)
    const ctrl = new AbortController()
    const ctx = { directory: dir, agent: "tecnia-bot", abort: ctrl.signal, ask: async () => {} }
    const corriendo = ejecutarPrograma({ accion: "cargar" }, ctx, undefined, { ...HERRAMIENTAS_DE_CARGA, lineaDeComando: () => ({ ok: true, argv: ["/opt/opencode/bin/opencode", "--agent", "tecnia-bot"] }), configuracion: { cwd: () => dir, home: join(OUT, "home-limpio"), entorno: {} }, lanzador: { marca: String(process.pid), pid: process.pid, ancestros: () => [] } })
    assert.equal(await cortarCuandoGrabe(ctrl), true)
    const r = JSON.parse(await corriendo)
    const p = pidsAnotados()
    assert.deepEqual(["pio", "scons", "esptool"].filter((n) => vivo(p[n].pid)), [])
    assert.equal(r.ok, false)
    assert.equal(r.codigo, "CANCELADO_DURANTE_LA_CARGA")
    assert.match(r.resultado, /comprobé que no quedó corriendo ningún proceso de ella/)
    assert.match(r.resultado, /a medio grabar/)
    assert.doesNotMatch(r.resultado, /no se grabó nada/)
    const reserva = reservarPuerto("/dev/ttyUSB0", "test")
    assert.equal(reserva.ok, true, "con el árbol confirmado muerto, el candado tiene que quedar libre")
    reserva.liberar()
    await hasta(() => Date.now() > p.esptool.desde + p.esptool.espera + 1000, 5000)
    assert.equal(existsSync(join(PIDS, "MARCADOR")), false)
  } finally {
    limpiar()
    liberarTodosLosPuertos()
  }
})

// ════════════════════════════════════════════════════════════════════════════════════════
// Ciclo 5: la marca de la carga (TECNIA_CARGA) — el huérfano que nadie veía
// ════════════════════════════════════════════════════════════════════════════════════════

/** Un proceso testigo lanzado por el test (no por la carga), con el entorno que se le pase. */
function testigo(env) {
  const p = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: OUT, stdio: "ignore", env })
  todos.add(p.pid)
  return p.pid
}

test("ciclo 5: el nieto huérfano ANTES del corte (doble fork, cwd /, sin nombrar la carpeta) con la marca → muere y se confirma", { skip: !LINUX && "usa /proc" }, async () => {
  preparar("huerfano:3000")
  try {
    const ctrl = new AbortController()
    const corriendo = lanzarCarga(proceso.run, argv(CARGA), CARGA, ctrl.signal, 60_000, CARGA, MARCA)
    assert.equal(await cortarCuandoGrabe(ctrl), true, "fixture: el nieto no arrancó")
    const r = await corriendo
    const p = pidsAnotados()
    const cwdDelNieto = (() => {
      try {
        return readlinkSync(`/proc/${p.esptool.pid}/cwd`)
      } catch {
        return null
      }
    })()
    assert.equal(vivo(p.esptool.pid), false, `el huérfano con la marca sigue vivo (cwd ${cwdDelNieto})`)
    assert.equal(r.procesosDeCargaTerminados, true, r.stderr)
    await hasta(() => Date.now() > p.esptool.desde + p.esptool.espera + 1000, 6000)
    assert.equal(existsSync(join(PIDS, "MARCADOR")), false, "el huérfano siguió grabando")
  } finally {
    limpiar()
  }
})

test("ciclo 5, LÍMITE DECLARADO: el mismo huérfano con el entorno LIMPIO (sin la marca) no se ve — queda vivo y el corte igual se confirma", { skip: !LINUX && "usa /proc" }, async () => {
  // Este test NO finge que se cubre: afirma lo que realmente pasa. Si un día se cierra (grupos
  // de procesos, cgroups), este test se pone rojo y hay que darlo vuelta.
  preparar("huerfano-limpio:30000")
  try {
    const ctrl = new AbortController()
    const corriendo = lanzarCarga(proceso.run, argv(CARGA), CARGA, ctrl.signal, 60_000, CARGA, MARCA)
    assert.equal(await cortarCuandoGrabe(ctrl), true)
    const r = await corriendo
    const p = pidsAnotados()
    assert.equal(vivo(p.esptool.pid), true, "el límite cambió: el huérfano sin marca ahora se mata")
    assert.equal(r.procesosDeCargaTerminados, true, "con el huérfano invisible, el corte se confirma igual: por eso el mensaje dice sólo lo comprobado")
  } finally {
    limpiar()
  }
})

test("ciclo 5: testigos ajenos (sin marca, con OTRA marca, con una marca parecida) siguen vivos tras el corte", { skip: !LINUX && "usa /proc" }, async () => {
  preparar("normal:1500")
  const sinMarca = testigo({ PATH: "/usr/bin:/bin" })
  const otra = testigo({ TECNIA_CARGA: "b".repeat(64) })
  const parecida = testigo({ TECNIA_CARGA: `${MARCA}x` })
  try {
    const ctrl = new AbortController()
    const corriendo = lanzarCarga(proceso.run, argv(CARGA), CARGA, ctrl.signal, 60_000, CARGA, MARCA)
    assert.equal(await cortarCuandoGrabe(ctrl), true)
    const r = await corriendo
    assert.equal(r.procesosDeCargaTerminados, true, `el corte no se confirmó. Lo que dijo el producto: ${r.stderr}`)
    for (const [nombre, pid] of [["sin marca", sinMarca], ["otra marca", otra], ["marca parecida", parecida]]) assert.equal(vivo(pid), true, `se mató un testigo ${nombre}`)
  } finally {
    limpiar()
  }
})

test("ciclo 5: la marca va SÓLO al entorno del hijo: pio la ve, este proceso no la tiene", { skip: !LINUX && "usa /proc" }, async () => {
  preparar("normal:1500")
  try {
    const ctrl = new AbortController()
    const corriendo = lanzarCarga(proceso.run, argv(CARGA), CARGA, ctrl.signal, 60_000, CARGA, MARCA)
    assert.equal(await cortarCuandoGrabe(ctrl), true)
    await corriendo
    assert.equal(readFileSync(join(PIDS, "marca-vista-por-pio"), "utf8"), MARCA)
    assert.equal(process.env.TECNIA_CARGA, undefined, "la marca se filtró al entorno de OpenCode")
    assert.doesNotMatch(readFileSync(`/proc/${process.pid}/environ`, "utf8"), /TECNIA_CARGA=/)
  } finally {
    limpiar()
  }
})

test("ciclo 5: el barrido por marca no se cuenta a sí mismo ni a sus ancestros aunque tengan la marca", { skip: !LINUX && "usa /proc" }, () => {
  // Un proceso con la marca en SU entorno busca esa marca: no puede encontrarse a sí mismo.
  const codigo = `import(${JSON.stringify(pathToFileURL(join(REPO, "opencode/carga/arbol.ts")).href)}).then((m) => { const r = m.sistemaReal().conMarca(${JSON.stringify(MARCA)}); process.stdout.write(JSON.stringify({ yo: process.pid, padre: process.ppid, r })) })`
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", codigo], { encoding: "utf8", env: { ...process.env, TECNIA_CARGA: MARCA } })
  const { yo, r: resultado } = JSON.parse(r.stdout)
  assert.ok(resultado, r.stderr)
  assert.equal(resultado.pids.includes(yo), false, "se encontró a sí mismo")
})

test("ciclo 5: un environ ilegible de un proceso propio → no se confirma; sin marca → no se confirma", async () => {
  const PRIV = "/tmp/x/carga-abc"
  const base = { plataforma: "linux", foto: () => [], referencian: () => [], senal: () => {}, taskkill: () => false }
  const ilegible = await terminarArbol(4242, PRIV, MARCA, { ...base, conMarca: () => ({ pids: [], ilegibles: 1 }) }, { kill: 50 })
  assert.equal(ilegible.confirmado, false)
  assert.match(ilegible.detalle, /no pude leer el entorno/)
  const noSePudoMirar = await terminarArbol(4242, PRIV, MARCA, { ...base, conMarca: () => null }, { kill: 50 })
  assert.equal(noSePudoMirar.confirmado, false)
  const sinMarca = await terminarArbol(4242, PRIV, undefined, { ...base, conMarca: () => ({ pids: [], ilegibles: 0 }) }, { kill: 50 })
  assert.equal(sinMarca.confirmado, false)
  assert.match(sinMarca.detalle, /no hay marca/)
  const limpio = await terminarArbol(4242, PRIV, MARCA, { ...base, conMarca: () => ({ pids: [], ilegibles: 0 }) }, { kill: 50 })
  assert.equal(limpio.confirmado, true, "control: con todo limpio se confirma")
  // Un marcado que no muere ni con SIGKILL (p. ej. en espera de E/S): sin este caso, sacar la
  // condición "quedan con la marca" no ponía nada en rojo (mutación G05 del ciclo 5).
  const senales = []
  const inmortal = await terminarArbol(4242, PRIV, MARCA, { ...base, senal: (pid, s) => senales.push([pid, s]), conMarca: () => ({ pids: [7777], ilegibles: 0 }) }, { kill: 50 })
  assert.equal(inmortal.confirmado, false)
  assert.match(inmortal.detalle, /con la marca/)
  assert.ok(senales.some(([pid, s]) => pid === 7777 && s === "SIGKILL"), "al marcado se le manda SIGKILL")
})


// ── UN PROCESO QUE SE ESTÁ MURIENDO NO ES UN PROCESO ILEGIBLE ──────────────────────────
//
// Lo de acá abajo es el caso que hacía fallar este archivo a veces (ver el encabezado). La
// carrera entre la foto de /proc y la lectura del `environ` no se puede provocar a pedido con
// procesos de verdad, así que /proc se inyecta: `conMarcaEnProc` acepta un lector.
//
// MUTACIONES que ponen rojo este bloque (exit code 1):
//   - sacar `&& !yaNoEjecuta(p.pid, lector.leer)` del catch de environ  → rojo «se está muriendo»
//   - en yaNoEjecuta, `return desaparecio(error)` → `return true`      → rojos los dos de «falla cerrado»
//   - en yaNoEjecuta, sacar el `if (estado === "Z" || estado === "X")`  → rojos la unidad y «se está muriendo»
//   - en yaNoEjecuta, leer el estado después del PRIMER «)»             → rojo la unidad
//   - `p.inicio >= desde` → `true` en puedeSerDeLaCarga                 → rojo «arrancó antes» (y casi todo el archivo)
//
// UNA MUTACIÓN QUE QUEDA VERDE, Y POR QUÉ NO ES UN HUECO: `startsWith("0 ")` → `startsWith("0")`.
// El primer campo de `statm` es un entero sin ceros a la izquierda, así que «empieza con 0»
// y «empieza con 0 y un espacio» dicen lo mismo sobre cualquier `statm` real. No hay entrada
// válida que las distinga.
//
// LÍMITE HONESTO: que un proceso con `statm` en «0 » no vuelve a ejecutar código es cómo
// funciona Linux (ya soltó su memoria adentro de `exit`); acá no se prueba el kernel, se
// prueba que el código lee eso y decide bien. Medido sólo en Linux 7.1.

const eacces = () => Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
const enoent = () => Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" })
const lineaStat = (pid, nombre, estado, inicio = 5000) => `${pid} (${nombre}) ${estado} 1 ${pid} ${pid} 0 -1 4194560 100 0 0 0 1 1 0 0 20 0 1 0 ${inicio} 1000000 200 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0`
const STATM_VIVO = "25000 1200 800 10 0 5000 0\n"
const STATM_SIN_MEMORIA = "0 0 0 0 0 0 0\n"

/** Un /proc de mentira. `archivos`: ruta → texto, o una función que arma el error a TIRAR. Lo que no figura, no existe. */
function lectorDe(foto, archivos) {
  return {
    foto: () => foto,
    uidDe: () => process.getuid(),
    leer: (ruta) => {
      const v = archivos[ruta]
      if (v === undefined) throw enoent()
      if (typeof v === "function") throw v()
      return v
    },
  }
}

test("yaNoEjecuta: zombi, sin memoria o desaparecido → sí; vivo o imposible de mirar → no (falla cerrado)", () => {
  const con = (archivos) => (ruta) => lectorDe([], archivos).leer(ruta)
  // A los dos zombis se les pone un `statm` CON memoria, que en un Linux de verdad no pasa
  // (un zombi ya la soltó): es para que este renglón mida la mirada al estado y no la de
  // `statm`. Sin eso el caso pasaba igual con la línea del estado borrada.
  assert.equal(yaNoEjecuta(7, con({ "/proc/7/stat": lineaStat(7, "node", "Z"), "/proc/7/statm": STATM_VIVO })), true, "un zombi no ejecuta nada")
  assert.equal(yaNoEjecuta(7, con({ "/proc/7/stat": lineaStat(7, "node", "X"), "/proc/7/statm": STATM_VIVO })), true, "un proceso muerto (X) no ejecuta nada")
  assert.equal(yaNoEjecuta(7, con({ "/proc/7/stat": lineaStat(7, "node", "R"), "/proc/7/statm": STATM_SIN_MEMORIA })), true, "en R pero sin memoria: está adentro de exit")
  assert.equal(yaNoEjecuta(7, con({})), true, "ya no está en /proc")
  assert.equal(yaNoEjecuta(7, con({ "/proc/7/stat": lineaStat(7, "node", "R") })), true, "desapareció entre stat y statm")
  // El nombre puede traer paréntesis y espacios: el estado se lee después del ÚLTIMO «)».
  assert.equal(yaNoEjecuta(7, con({ "/proc/7/stat": lineaStat(7, "a) Z (b", "S"), "/proc/7/statm": STATM_VIVO })), false, "leyó el estado adentro del nombre")
  // Falla cerrado.
  assert.equal(yaNoEjecuta(7, con({ "/proc/7/stat": lineaStat(7, "esptool", "S"), "/proc/7/statm": STATM_VIVO })), false, "un proceso vivo y con memoria SÍ puede estar ejecutando")
  assert.equal(yaNoEjecuta(7, con({ "/proc/7/stat": lineaStat(7, "esptool", "R"), "/proc/7/statm": "100 0 0 0 0 0 0\n" })), false, "«100 …» no es «0 …»: tiene memoria")
  assert.equal(yaNoEjecuta(7, con({ "/proc/7/stat": eacces })), false, "si no se puede mirar, no se afirma que ya no ejecuta")
  assert.equal(yaNoEjecuta(7, con({ "/proc/7/stat": lineaStat(7, "esptool", "S"), "/proc/7/statm": eacces })), false, "si no se puede leer statm, tampoco")
})

test("barrido por marca: un proceso propio que se está muriendo (environ con EACCES) NO deja el corte sin confirmar", () => {
  const DESDE = 4000
  const foto = [
    // Estaba vivo en la foto; cuando se le va a leer el entorno ya soltó la memoria.
    { pid: 901, ppid: 1, zombi: false, inicio: 5000 },
    // Estaba vivo en la foto; cuando se lo vuelve a mirar ya es zombi.
    { pid: 902, ppid: 1, zombi: false, inicio: 5000 },
    // Estaba vivo en la foto; desapareció del todo antes de la segunda mirada.
    { pid: 903, ppid: 1, zombi: false, inicio: 5000 },
  ]
  const r = conMarcaEnProc(MARCA, DESDE, lectorDe(foto, {
    "/proc/901/environ": eacces, "/proc/901/stat": lineaStat(901, "node", "R"), "/proc/901/statm": STATM_SIN_MEMORIA,
    "/proc/902/environ": eacces, "/proc/902/stat": lineaStat(902, "node", "Z"), "/proc/902/statm": STATM_VIVO,
    "/proc/903/environ": eacces,
  }))
  assert.deepEqual(r, { pids: [], ilegibles: 0 }, "contó como ilegible a un proceso que ya no puede estar ejecutando nada: una carga frenada quedaría como «puede que siga grabándose»")
})

test("barrido por marca, falla cerrado: un proceso propio VIVO con el entorno ilegible sí deja el corte sin confirmar", () => {
  const DESDE = 4000
  const foto = [{ pid: 911, ppid: 1, zombi: false, inicio: 5000 }]
  const vivo = conMarcaEnProc(MARCA, DESDE, lectorDe(foto, {
    "/proc/911/environ": eacces, "/proc/911/stat": lineaStat(911, "no-volcable", "S"), "/proc/911/statm": STATM_VIVO,
  }))
  assert.deepEqual(vivo, { pids: [], ilegibles: 1 }, "un proceso vivo que no deja leer su entorno puede ser de la carga: no se puede confirmar")
  const sinPoderMirar = conMarcaEnProc(MARCA, DESDE, lectorDe(foto, { "/proc/911/environ": eacces, "/proc/911/stat": eacces }))
  assert.deepEqual(sinPoderMirar, { pids: [], ilegibles: 1 }, "si tampoco se puede volver a mirar, se sigue contando")
})

test("barrido por marca: lo que arrancó antes que la carga no cuenta, y lo que tiene la marca se encuentra", () => {
  const DESDE = 4000
  const foto = [
    { pid: 921, ppid: 1, zombi: false, inicio: 100 }, // systemd --user y compañía: ilegibles desde siempre
    { pid: 922, ppid: 1, zombi: false, inicio: 5000 },
    { pid: 923, ppid: 1, zombi: false, inicio: 5000 },
  ]
  const r = conMarcaEnProc(MARCA, DESDE, lectorDe(foto, {
    "/proc/921/environ": eacces, "/proc/921/stat": lineaStat(921, "systemd", "S", 100), "/proc/921/statm": STATM_VIVO,
    "/proc/922/environ": `PATH=/usr/bin\0TECNIA_CARGA=${MARCA}\0HOME=/home/x\0`,
    "/proc/923/environ": `PATH=/usr/bin\0TECNIA_CARGA=${"b".repeat(64)}\0`,
  }))
  assert.deepEqual(r, { pids: [922], ilegibles: 0 })
})
