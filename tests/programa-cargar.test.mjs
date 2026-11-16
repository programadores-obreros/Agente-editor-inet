// `programa` con `accion: "cargar"` (H1 del MVP de Programación por Intención): grabar en la
// placa el programa GENERADO del proyecto físico, por `carga/cargar-programa.ts`.
//
// CERO PROCESOS REALES. El lanzador (`run`) es un ESPÍA inyectado: contesta `pio device list`
// con las placas que pide cada test y, en la carga, anota argv, cwd, capacidad y lo que había
// en disco, y devuelve la salida que pide el test. `Bun.spawn` es una trampa que falla y se
// cuenta: si algo llegara a lanzar un proceso de verdad, el último test se pone rojo.
//
// Lo que se afirma es comportamiento, no forma: cuántas veces se lanzó, con qué argv y desde
// dónde, qué carteles se mostraron, si el candado quedó libre (se prueba reservándolo de
// nuevo), qué dice el resultado y qué NO dice.

import { test, before, after, afterEach } from "node:test"
import assert from "node:assert/strict"
import { existsSync, lstatSync as lstatReal, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import os from "node:os"
import { REPO, nuevoDir } from "./phase2-helpers.mjs"

// ── El entorno: todo a un temporal propio ──────────────────────────────────────────────
const OUT = mkdtempSync(join(os.tmpdir(), "tecniabot-programa-cargar-"))
const ENTORNO_ORIGINAL = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME, TECNIA_PIO_TIMEOUT_MS: process.env.TECNIA_PIO_TIMEOUT_MS }
process.env.XDG_CONFIG_HOME = join(OUT, "config") // candados de puerto y registro de la compu
process.env.XDG_CACHE_HOME = join(OUT, "cache") // carpetas privadas
delete process.env.TECNIA_PIO_TIMEOUT_MS
const CARGAS = join(OUT, "cache", "tecnia-bot", "cargas")

const spawnsReales = []
const BunOriginal = globalThis.Bun
globalThis.Bun = {
  which: () => null,
  spawn(cmd) {
    spawnsReales.push(cmd)
    throw new Error("PROHIBIDO: este test no lanza procesos reales")
  },
}

const { ejecutarPrograma, HERRAMIENTAS_DE_CARGA, carpetaDelPrograma } = await import(join(REPO, "opencode/tool/programa.ts"))
const programaTool = (await import(join(REPO, "opencode/tool/programa.ts"))).default
const proyectoFisico = (await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))).default
const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { directorioDeDatos } = await import(join(REPO, "opencode/vista-fisica/ubicacion-proyecto.ts"))
const { generarPrograma } = await import(join(REPO, "opencode/codegen/programa.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { REVISIONES_DEL_ANEXO } = await import(join(REPO, "opencode/conocimiento/admision.ts"))
const { PREGUNTA_CHECKLIST, MARCA_SIEMPRE_PREGUNTA } = await import(join(REPO, "opencode/tool/platformio.ts"))
const { reservarPuerto, liberarTodosLosPuertos } = await import(join(REPO, "opencode/carga/puertos.ts"))
const { esCapacidadDeCarga } = await import(join(REPO, "opencode/carga/proceso.ts"))
const { argvDeCargaCompilando, lanzarCarga } = await import(join(REPO, "opencode/carga/ejecutar.ts"))
const { TEXTO_CARGA_SIN_VERIFICAR } = await import(join(REPO, "opencode/carga/esptool.ts"))
const { banderaDeAprobacionAutomatica } = await import(join(REPO, "opencode/carga/cargar-programa.ts"))

const PROMPT = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
const LOG_ESP32 = readFileSync(join(REPO, "tests/fixtures/carga/esptool-carga-real-4-regiones.log"), "utf8")
const BYTES_FIRMWARE = 240816 // la región 0x10000 del log real

after(() => {
  liberarTodosLosPuertos()
  for (const [k, v] of Object.entries(ENTORNO_ORIGINAL)) if (v === undefined) delete process.env[k]
  else process.env[k] = v
  globalThis.Bun = BunOriginal
  rmSync(OUT, { recursive: true, force: true })
})
afterEach(() => {
  liberarTodosLosPuertos()
  // Un corte sin confirmar deja la carpeta privada a propósito (ciclo 1): cada test empieza sin ninguna.
  if (existsSync(CARGAS)) for (const c of readdirSync(CARGAS)) rmSync(join(CARGAS, c), { recursive: true, force: true })
})

// ── Placas ─────────────────────────────────────────────────────────────────────────────
const WIN = process.platform === "win32"
const PUERTO = WIN ? "COM5" : "/dev/ttyUSB0"
const OTRO_PUERTO = WIN ? "COM6" : "/dev/ttyUSB1"
const placa = (o = {}) => ({ port: o.port ?? PUERTO, hwid: `USB VID:PID=10C4:EA60 SER=${o.serie ?? "A1B2C3D4E5"} LOCATION=1-1`, description: "CP2102 USB to UART" })
const UNO = { port: PUERTO, hwid: "USB VID:PID=2341:0043 SER=85735313932351F0A1B2 LOCATION=1-2", description: "Arduino Uno" }

// ── El proyecto, por las tools reales ──────────────────────────────────────────────────
const PRESIONADO = { capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }
const reglaLed = { tipo: "SetComportamiento", payload: { comportamiento: { cuando: { sensor: "cmp-0", ...PRESIONADO }, entonces: { actuador: "cmp-1", accion: "encender" } } } }
const ops = (placaId, pines) => [
  { tipo: "SetPlaca", payload: { placa: placaId } },
  { tipo: "AgregarComponente", payload: { tipo: "pulsador" } },
  { tipo: "AgregarComponente", payload: { tipo: "led" } },
  { tipo: "AgregarComponente", payload: { tipo: "resistencia" } },
  { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: pines[0] } },
  { tipo: "AsignarPin", payload: { componente: "cmp-1", terminal: "anodo", pin: pines[1] } },
  { tipo: "Conectar", payload: { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } } },
  reglaLed,
]
const fisico = async (dir, args) => JSON.parse(await proyectoFisico.execute(args, { directory: dir }))
async function armar(placaId = "esp32-devkit-v1", pines = ["GPIO4", "GPIO18"], dir = nuevoDir("programa-cargar")) {
  const { revision } = await fisico(dir, { accion: "leer" })
  const r = await fisico(dir, { accion: "aplicar", baseRevision: revision, operaciones: ops(placaId, pines) })
  assert.equal(r.ok, true, JSON.stringify(r))
  return dir
}
const servicioDe = (dir) => obtenerServicioDeProyectoConVista({ directorio: directorioDeDatos(dir), idProyecto: "activo" })
const generadoDe = (dir, opciones) => generarPrograma(servicioDe(dir).snapshot().proyecto, K, opciones)

const REVISIONES_UNO = {
  placas: [...REVISIONES_DEL_ANEXO.placas, { placa: "arduino-uno", revisadoPor: "revisión humana de prueba (fixture de test)", evidencia: "test" }],
  componentes: [...REVISIONES_DEL_ANEXO.componentes, ...["led", "pulsador", "resistencia"].map((tipo) => ({ tipo, placa: "arduino-uno", revisadoPor: "revisión humana de prueba (fixture de test)", evidencia: "test" }))],
}
const depsReales = (generar = generarPrograma) => async () => ({ obtenerServicioDeProyectoConVista, conocimiento: K, generarPrograma: generar })
const depsUno = depsReales((p, k) => generarPrograma(p, k, { revisiones: REVISIONES_UNO }))

// ── Los dobles ─────────────────────────────────────────────────────────────────────────
function leerArbol(dir) {
  const salida = {}
  if (!existsSync(dir)) return salida
  const recorrer = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) recorrer(join(d, e.name))
      else salida[relative(dir, join(d, e.name)).split(sep).join("/")] = readFileSync(join(d, e.name), "utf8")
    }
  }
  recorrer(dir)
  return salida
}

/**
 * El lanzador espía. `placas` contesta la primera detección; `placasDespues`, la de la
 * revalidación. En la carga escribe un `firmware.bin` del tamaño pedido (lo que dejaría el
 * build) y devuelve `carga`.
 */
function lanzador({ placas = [placa()], placasDespues, carga = { code: 0, stdout: LOG_ESP32, stderr: "" }, bytesFirmware = BYTES_FIRMWARE, alLanzar } = {}) {
  const r = { listados: 0, lanzamientos: [] }
  r.run = async (cmd, cwd, signal, timeoutMs, capacidad) => {
    if (cmd[1] === "device") {
      r.listados++
      const lista = r.listados === 1 ? placas : (placasDespues ?? placas)
      return { code: 0, stdout: JSON.stringify(lista), stderr: "" }
    }
    r.lanzamientos.push({ cmd: [...cmd], cwd, timeoutMs, capacidad: esCapacidadDeCarga(capacidad), enDisco: leerArbol(cwd) })
    if (bytesFirmware) {
      const env = cmd[cmd.indexOf("-e") + 1]
      mkdirSync(join(cwd, ".pio", "build", env), { recursive: true })
      writeFileSync(join(cwd, ".pio", "build", env, "firmware.bin"), Buffer.alloc(bytesFirmware, 1))
    }
    if (alLanzar) await alLanzar({ cmd, cwd, signal })
    return typeof carga === "function" ? carga({ cwd }) : carga
  }
  return r
}

/** El cartel espía: "si" aprueba; cualquier otra cosa se tira como el rechazo de OpenCode. */
function cartel(respuesta = "si", alPreguntar) {
  const c = { pedidos: [] }
  c.ask = async (input) => {
    c.pedidos.push(structuredClone(input))
    if (alPreguntar) await alPreguntar(input)
    if (respuesta === "si") return
    throw respuesta
  }
  return c
}

const RECHAZO = { _tag: "PermissionRejectedError", message: "The user rejected permission to use this specific tool call." }
const CORRECCION = { _tag: "PermissionCorrectedError", feedback: "todavía no lo revisé" }
const DENEGADO = { _tag: "PermissionDeniedError", message: "The user has specified a rule which prevents you from using this specific tool call." }

/** La TUI como la abre el producto (H3: `procSelfCmdline` de la TUI, sin la bandera). El node de los tests no es OpenCode. */
const TUI_NORMAL = ["/opt/opencode/bin/opencode", "--agent", "tecnia-bot"]

/** Ciclo 4: la marca del lanzador, inyectada (este proceso de test "vino del lanzador"). */
const LANZADOR_OK = { marca: String(process.pid), pid: process.pid, ancestros: () => [] }

/** Un HOME limpio para el control de configuración (ciclo 3): el HOME real de quien corre los tests no entra. */
const HOME_LIMPIO = join(OUT, "home-limpio")
mkdirSync(HOME_LIMPIO, { recursive: true })

async function cargar(dir, { lanza = lanzador(), pregunta = cartel(), agente = "tecnia-bot", abort, sinAsk = false, deps = depsReales(), herramientas = {}, opciones = {} } = {}) {
  const ctx = { directory: dir, agent: agente, abort: abort ?? new AbortController().signal, ...(sinAsk ? {} : { ask: pregunta.ask }) }
  const configuracion = { cwd: () => dir, home: HOME_LIMPIO, entorno: {} }
  const texto = await ejecutarPrograma({ accion: "cargar" }, ctx, deps, { ...HERRAMIENTAS_DE_CARGA, run: lanza.run, lineaDeComando: () => ({ ok: true, argv: TUI_NORMAL }), configuracion, lanzador: LANZADOR_OK, ...herramientas }, opciones)
  return { r: JSON.parse(texto), texto, lanza, pregunta }
}

const carpetasPrivadas = () => (existsSync(CARGAS) ? readdirSync(CARGAS) : [])
function puertoLibre(puerto = PUERTO) {
  const r = reservarPuerto(puerto, "test")
  if (r.ok) r.liberar()
  return r.ok
}
function sinRutaPrivada(texto) {
  assert.ok(!texto.includes(CARGAS), "el resultado nombra la carpeta privada")
  assert.ok(!texto.includes(JSON.stringify(CARGAS).slice(1, -1)), "el resultado nombra la carpeta privada")
}

// ════════════════════════════════════════════════════════════════════════════════════════
// Aprobación → exactamente UN lanzamiento, con el argv exacto, desde la carpeta privada
// ════════════════════════════════════════════════════════════════════════════════════════

test("aprobado: UN lanzamiento, argv exacto, cwd = carpeta privada nueva con exactamente lo generado; éxito ESP32 verificado; la carpeta se borra", async () => {
  const dir = await armar()
  const esperado = generadoDe(dir)
  const { r, texto, lanza, pregunta } = await cargar(dir)
  assert.equal(pregunta.pedidos.length, 1)
  assert.equal(lanza.lanzamientos.length, 1, "exactamente un lanzamiento")
  const [l] = lanza.lanzamientos
  assert.ok(l.cwd.startsWith(CARGAS + sep), `cwd fuera de la carpeta de cargas: ${l.cwd}`)
  assert.match(l.cwd.slice(CARGAS.length + 1), /^carga-[^/\\]+$/)
  assert.deepEqual(l.cmd, ["pio", "run", "-d", l.cwd, "-e", "esp32-devkit-v1", "-t", "upload", "--upload-port", PUERTO])
  assert.ok(!l.cmd.includes("nobuild"), "el owner decidió compilar y grabar en un paso: sin nobuild")
  assert.equal(l.capacidad, true, "salió por lanzarCarga, con la capacidad")
  assert.deepEqual(l.enDisco, esperado.archivos, "en la carpeta privada está exactamente lo generado")
  assert.ok(!l.cwd.startsWith(dir), "la carpeta privada no está dentro del proyecto")
  assert.equal(existsSync(l.cwd), false, "la carpeta privada se borra al terminar")
  assert.deepEqual(carpetasPrivadas(), [])
  assert.equal(r.ok, true, texto)
  assert.equal(r.codigo, "CARGADO")
  assert.equal(r.etapa, "carga")
  assert.match(r.resultado, /^CARGADO — /)
  assert.equal(r.verificacion.regionesEscritas, 4)
  assert.equal(r.verificacion.regionesVerificadas, 4)
  sinRutaPrivada(texto)
  assert.equal(puertoLibre(), true, "tras el éxito el candado queda libre")
})

test("dos cargas seguidas del mismo proyecto → dos carteles, los dos con always: [] y patrones distintos", async () => {
  const dir = await armar()
  const pregunta = cartel()
  const a = await cargar(dir, { pregunta })
  const b = await cargar(dir, { pregunta })
  assert.equal(a.r.codigo, "CARGADO")
  assert.equal(b.r.codigo, "CARGADO")
  assert.equal(pregunta.pedidos.length, 2, "un cartel por carga")
  for (const p of pregunta.pedidos) assert.deepEqual(p.always, [])
  assert.notDeepEqual(pregunta.pedidos[0].patterns, pregunta.pedidos[1].patterns, "ningún Allow always guardado puede coincidir con la próxima")
  assert.equal(a.lanza.lanzamientos.length + b.lanza.lanzamientos.length, 2)
})

test("el cartel empieza con el prefijo de la regla del agente y nombra proyecto, placa y puerto", async () => {
  const dir = await armar()
  const { pregunta } = await cargar(dir)
  const regla = PROMPT.split("---")[1].match(/^\s*"(¿Revisaste el circuito\?)\*":\s*"ask"\s*$/m)
  assert.ok(regla, "no encontré la regla del cartel en el agente")
  const [p] = pregunta.pedidos
  assert.ok(p.permission.startsWith(regla[1]), p.permission)
  assert.ok(p.permission.startsWith(PREGUNTA_CHECKLIST))
  assert.match(p.permission, /proyecto activo/)
  assert.match(p.permission, /placa esp32-devkit-v1/)
  assert.ok(p.permission.includes(`puerto ${PUERTO}`), p.permission)
  assert.ok(p.permission.endsWith(MARCA_SIEMPRE_PREGUNTA), "la leyenda tiene que decir que se pregunta cada vez")
  assert.ok(!/[*?]/.test(p.permission.slice(PREGUNTA_CHECKLIST.length)), "sin comodines después del prefijo")
})

// ════════════════════════════════════════════════════════════════════════════════════════
// El cartel: sin ask, rechazo, cada error de permiso, excepción y cancelación
// ════════════════════════════════════════════════════════════════════════════════════════

test("sin ctx.ask → no se lanza nada, y el candado queda libre", async () => {
  const dir = await armar()
  const { r, lanza } = await cargar(dir, { sinAsk: true })
  assert.equal(r.ok, false)
  assert.equal(r.codigo, "CARTEL_NO_DISPONIBLE")
  assert.equal(lanza.lanzamientos.length, 0)
  assert.equal(puertoLibre(), true)
})

for (const [nombre, error, codigo] of [
  ["Reject", RECHAZO, "CARTEL_RECHAZADO"],
  ["Reject con comentario", CORRECCION, "CARTEL_RECHAZADO"],
  ["regla deny", DENEGADO, "CARTEL_RECHAZADO"],
  ["una excepción cualquiera", new Error("se rompió el bridge"), "CARTEL_FALLIDO"],
]) {
  test(`cartel con ${nombre} → no se lanza nada y el candado queda libre`, async () => {
    const dir = await armar()
    const { r, lanza, pregunta, texto } = await cargar(dir, { pregunta: cartel(error) })
    assert.equal(pregunta.pedidos.length, 1)
    assert.equal(r.ok, false)
    assert.equal(r.codigo, codigo, texto)
    assert.equal(lanza.lanzamientos.length, 0)
    assert.equal(lanza.listados, 1, "no se revalida ni se lanza después de un no")
    assert.doesNotMatch(r.resultado, /^CARGADO/)
    assert.equal(puertoLibre(), true)
  })
}

test("abort antes de responder → no se lanza; un «sí» que llega después tampoco lanza; el candado queda libre", async () => {
  const dir = await armar()
  const ctrl = new AbortController()
  let soltarSi
  const pregunta = { pedidos: [] }
  pregunta.ask = (input) => {
    pregunta.pedidos.push(input)
    queueMicrotask(() => ctrl.abort())
    return new Promise((resolve) => (soltarSi = resolve)) // OpenCode colgado
  }
  const lanza = lanzador()
  // Si la carga no corre el cartel en carrera contra el abort, se queda colgada para siempre
  // esperando a OpenCode: eso se afirma acá (con un tope), no se deja al timeout del runner.
  let tope
  const colgada = new Promise((resolve) => (tope = setTimeout(() => resolve("colgada"), 5000)))
  const corrida = await Promise.race([cargar(dir, { pregunta, lanza, abort: ctrl.signal }), colgada])
  clearTimeout(tope)
  assert.notEqual(corrida, "colgada", "después del abort la carga siguió esperando al cartel")
  const { r } = corrida
  assert.equal(r.codigo, "CANCELADO")
  assert.match(r.resultado, /no se lanzó nada/)
  soltarSi() // el "sí" tardío
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(lanza.lanzamientos.length, 0, "el sí tardío reactivó la carga")
  assert.equal(lanza.listados, 1)
  assert.equal(puertoLibre(), true)
})

// ════════════════════════════════════════════════════════════════════════════════════════
// Quién pide
// ════════════════════════════════════════════════════════════════════════════════════════

test("otro agente → no carga: ni detecta, ni pregunta, ni lanza", async () => {
  const dir = await armar()
  // (`undefined` acá activaría el valor por defecto del ayudante: `null` y "" son "sin agente")
  for (const agente of ["build", "", null]) {
    const { r, lanza, pregunta } = await cargar(dir, { agente })
    assert.equal(r.codigo, "AGENTE_NO_AUTORIZADO")
    assert.equal(lanza.listados + lanza.lanzamientos.length, 0)
    assert.equal(pregunta.pedidos.length, 0)
  }
})

test("bandera de aprobación automática en process.argv → no carga", async () => {
  const dir = await armar()
  for (const bandera of ["--yolo", "--auto", "--dangerously-skip-permissions", "--auto=true"]) {
    process.argv.push(bandera)
    try {
      const { r, lanza, pregunta } = await cargar(dir)
      assert.equal(r.codigo, "APROBACION_AUTOMATICA", bandera)
      assert.equal(lanza.listados + lanza.lanzamientos.length, 0)
      assert.equal(pregunta.pedidos.length, 0)
    } finally {
      process.argv.pop()
    }
  }
  assert.equal(banderaDeAprobacionAutomatica(["bun", "opencode", "--autor"]), null, "una bandera que sólo se parece no cuenta")
})

// ════════════════════════════════════════════════════════════════════════════════════════
// El proyecto: no abre, motivos bloqueantes, generador que rechaza, archivos viejos
// ════════════════════════════════════════════════════════════════════════════════════════

test("proyecto que no abre → no carga y no crea nada", async () => {
  const dir = await armar()
  const deps = async () => ({ obtenerServicioDeProyectoConVista: () => { throw new Error("candado tomado por otra ventana") }, conocimiento: K, generarPrograma })
  const { r, lanza } = await cargar(dir, { deps })
  assert.equal(r.codigo, "PROYECTO_BLOQUEADO")
  assert.equal(lanza.listados + lanza.lanzamientos.length, 0)
  assert.deepEqual(carpetasPrivadas(), [])
  assert.equal(existsSync(carpetaDelPrograma(dir, "activo")), false)
})

test("proyecto con motivos bloqueantes → no carga, ni siquiera se genera", async () => {
  const dir = await armar()
  const real = servicioDe(dir).snapshot()
  let generaciones = 0
  const deps = async () => ({
    obtenerServicioDeProyectoConVista: () => ({ snapshot: () => ({ ...real, validacion: { ...real.validacion, motivos: [{ codigo: "PIN_INVALIDO", severidad: "blocking" }] } }) }),
    conocimiento: K,
    generarPrograma: (...a) => (generaciones++, generarPrograma(...a)),
  })
  const { r, lanza } = await cargar(dir, { deps })
  assert.equal(r.codigo, "PROYECTO_CON_MOTIVOS_BLOQUEANTES")
  assert.equal(generaciones, 0)
  assert.equal(lanza.listados + lanza.lanzamientos.length, 0)
  assert.deepEqual(carpetasPrivadas(), [])
})

test("generador que rechaza → no carga, no crea nada y no toca la carpeta derivada", async () => {
  const dir = await armar()
  const derivada = carpetaDelPrograma(dir, "activo")
  mkdirSync(join(derivada, "src"), { recursive: true })
  writeFileSync(join(derivada, "src", "main.cpp"), "// de antes\n")
  const deps = depsReales(() => ({ ok: false, error: { codigo: "CODEGEN_PROYECTO_NO_LISTO", datos: {} } }))
  const { r, lanza } = await cargar(dir, { deps })
  assert.equal(r.ok, false)
  assert.equal(r.codigo, "CODEGEN_PROYECTO_NO_LISTO")
  assert.match(r.resultado, /^NO SE CARGÓ/)
  assert.equal(lanza.listados + lanza.lanzamientos.length, 0)
  assert.deepEqual(carpetasPrivadas(), [])
  assert.equal(readFileSync(join(derivada, "src", "main.cpp"), "utf8"), "// de antes\n", "cargar no vacía ni pisa la carpeta derivada")
})

test("un main.cpp o un firmware.bin preexistente en la carpeta del proyecto NUNCA se usa", async () => {
  const dir = await armar()
  const derivada = carpetaDelPrograma(dir, "activo")
  for (const base of [dir, derivada]) {
    mkdirSync(join(base, "src"), { recursive: true })
    writeFileSync(join(base, "src", "main.cpp"), "// MALICIOSO\nvoid setup(){} void loop(){}\n")
    writeFileSync(join(base, "platformio.ini"), "[env:esp32-devkit-v1]\nplatform = espressif32\nboard = esp32dev\nframework = arduino\n")
    mkdirSync(join(base, ".pio", "build", "esp32-devkit-v1"), { recursive: true })
    writeFileSync(join(base, ".pio", "build", "esp32-devkit-v1", "firmware.bin"), "VIEJO")
  }
  const { r, lanza } = await cargar(dir)
  assert.equal(r.codigo, "CARGADO")
  const [l] = lanza.lanzamientos
  assert.ok(l.cwd !== dir && l.cwd !== derivada && !l.cwd.startsWith(dir))
  assert.deepEqual(l.enDisco, generadoDe(dir).archivos, "lo que se compila y graba es lo generado ahora")
  assert.doesNotMatch(JSON.stringify(l.enDisco), /MALICIOSO|VIEJO/)
})

// ════════════════════════════════════════════════════════════════════════════════════════
// Pines
// ════════════════════════════════════════════════════════════════════════════════════════

test("un pin que deja la placa sin arrancar frena todo, sin cartel ni placa", async () => {
  const dir = await armar()
  const real = generadoDe(dir)
  const conFlash = { ...real, archivos: { ...real.archivos, "src/main.cpp": "#include <Arduino.h>\nvoid setup() { pinMode(6, OUTPUT); }\nvoid loop() { digitalWrite(6, HIGH); }\n" } }
  const { r, lanza, pregunta } = await cargar(dir, { deps: depsReales(() => conFlash) })
  assert.equal(r.codigo, "PIN_BLOQUEANTE")
  assert.match(r.resultado, /NO CARGUÉ NADA/)
  assert.equal(lanza.listados + lanza.lanzamientos.length, 0)
  assert.equal(pregunta.pedidos.length, 0)
  assert.deepEqual(carpetasPrivadas(), [], "la carpeta privada se borra también al frenar")
})

test("análisis null (no hay código que analizar) → no carga", async () => {
  const dir = await armar()
  const real = generadoDe(dir)
  const soloIni = { ...real, archivos: { "platformio.ini": real.archivos["platformio.ini"] } }
  const { r, lanza } = await cargar(dir, { deps: depsReales(() => soloIni) })
  assert.equal(r.codigo, "ANALISIS_NO_DISPONIBLE")
  assert.equal(lanza.listados + lanza.lanzamientos.length, 0)
})

test("análisis incompleto o de una placa sin herramienta conocida → no carga", async () => {
  const dir = await armar()
  const analizar = (cambio) => (cwd, env) => ({ ...HERRAMIENTAS_DE_CARGA.analizarProyecto(cwd, env), ...cambio })
  const a = await cargar(dir, { herramientas: { analizarProyecto: analizar({ incompleto: ["src/main.cpp"] }) } })
  assert.equal(a.r.codigo, "ANALISIS_INCOMPLETO")
  assert.equal(a.lanza.listados + a.lanza.lanzamientos.length, 0)
  const b = await cargar(dir, { herramientas: { analizarProyecto: analizar({ familia: null }) } })
  assert.equal(b.r.codigo, "PLACA_NO_SOPORTADA")
  assert.equal(b.lanza.listados + b.lanza.lanzamientos.length, 0)
})

// ════════════════════════════════════════════════════════════════════════════════════════
// Placa y candado
// ════════════════════════════════════════════════════════════════════════════════════════

for (const [nombre, placasDespues] of [
  ["desaparece", []],
  ["cambia por otra del mismo modelo (otra serie)", [placa({ serie: "Z9Y8X7W6V5" })]],
  ["aparece en otro puerto", [placa({ port: OTRO_PUERTO })]],
  ["aparece otra más", [placa(), placa({ port: OTRO_PUERTO, serie: "Z9Y8X7W6V5" })]],
]) {
  test(`placa que ${nombre} entre el cartel y el lanzamiento → no carga`, async () => {
    const dir = await armar()
    const { r, lanza, pregunta } = await cargar(dir, { lanza: lanzador({ placasDespues }) })
    assert.equal(pregunta.pedidos.length, 1)
    assert.equal(r.codigo, "IDENTIDAD_CAMBIO")
    assert.equal(lanza.listados, 2, "se volvió a detectar")
    assert.equal(lanza.lanzamientos.length, 0)
    assert.equal(puertoLibre(), true)
  })
}

test("sin placa, o con varias → no carga y no muestra el cartel", async () => {
  const dir = await armar()
  for (const [placas, codigo] of [[[], "SIN_PLACA"], [[placa(), placa({ port: OTRO_PUERTO, serie: "Z9Y8X7W6V5" })], "VARIAS_PLACAS"]]) {
    const { r, lanza, pregunta } = await cargar(dir, { lanza: lanzador({ placas }) })
    assert.equal(r.codigo, codigo)
    assert.equal(lanza.lanzamientos.length, 0)
    assert.equal(pregunta.pedidos.length, 0)
  }
})

for (const [nombre, alterar] of [
  ["main.cpp cambiado", (d) => writeFileSync(join(d, "src", "main.cpp"), readFileSync(join(d, "src", "main.cpp"), "utf8") + "\n// metido\n")],
  ["un archivo de más", (d) => writeFileSync(join(d, "src", "extra.cpp"), "void extra() {}\n")],
  ["platformio.ini borrado", (d) => rmSync(join(d, "platformio.ini"))],
]) {
  test(`archivo de la carpeta privada alterado entre generar y lanzar (${nombre}) → no carga`, async () => {
    const dir = await armar()
    const pregunta = cartel("si", () => {
      const [privada] = carpetasPrivadas()
      alterar(join(CARGAS, privada))
    })
    const { r, lanza } = await cargar(dir, { pregunta })
    assert.equal(r.codigo, "ARCHIVOS_CAMBIARON")
    assert.equal(lanza.lanzamientos.length, 0)
    assert.equal(puertoLibre(), true)
  })
}

test("puerto ocupado → no carga, no muestra el cartel, y el candado ajeno sigue tomado", async () => {
  const dir = await armar()
  const ajena = reservarPuerto(PUERTO, "otra ventana")
  assert.equal(ajena.ok, true)
  try {
    const { r, lanza, pregunta } = await cargar(dir)
    assert.equal(r.codigo, "PUERTO_OCUPADO")
    assert.equal(pregunta.pedidos.length, 0)
    assert.equal(lanza.lanzamientos.length, 0)
    assert.equal(puertoLibre(), false, "no se soltó un candado ajeno")
  } finally {
    ajena.liberar()
  }
})

test("el candado se libera tras un fallo de PlatformIO", async () => {
  const dir = await armar()
  const { r } = await cargar(dir, { lanza: lanzador({ carga: { code: 1, stdout: "", stderr: "src/main.cpp:3: error: expected ';' before '}'" } }) })
  assert.equal(r.codigo, "CARGA_FALLIDA")
  assert.equal(puertoLibre(), true)
})

// ════════════════════════════════════════════════════════════════════════════════════════
// La carpeta privada
// ════════════════════════════════════════════════════════════════════════════════════════

test("carpeta privada: un enlace simbólico preparado no la mete en el proyecto, y no se crea nada del otro lado", { skip: WIN ? "enlaces simbólicos en Windows: requieren privilegios" : false }, async () => {
  const dir = await armar()
  const cache = join(OUT, "cache-trampa")
  const trampa = join(dir, "trampa")
  mkdirSync(cache, { recursive: true })
  mkdirSync(trampa, { recursive: true })
  symlinkSync(trampa, join(cache, "tecnia-bot"))
  const { r, lanza } = await cargar(dir, { opciones: { entorno: { XDG_CACHE_HOME: cache } } })
  assert.equal(r.codigo, "CARPETA_PRIVADA_RECHAZADA")
  assert.equal(lanza.listados + lanza.lanzamientos.length, 0)
  assert.deepEqual(readdirSync(trampa), [], "se creó algo adentro del proyecto")
})

test("carpeta privada: con la caché adentro del proyecto, no se carga y no se crea nada ahí", async () => {
  const dir = await armar()
  const cache = join(dir, "cache")
  const { r, lanza } = await cargar(dir, { opciones: { entorno: { XDG_CACHE_HOME: cache } } })
  assert.equal(r.codigo, "CARPETA_PRIVADA_RECHAZADA")
  assert.equal(lanza.listados + lanza.lanzamientos.length, 0)
  assert.equal(existsSync(cache), false)
})

// ════════════════════════════════════════════════════════════════════════════════════════
// El veredicto: ESP32
// ════════════════════════════════════════════════════════════════════════════════════════

const sinUltimoHash = (() => {
  const i = LOG_ESP32.lastIndexOf("Hash of data verified.")
  return LOG_ESP32.slice(0, i) + LOG_ESP32.slice(i + "Hash of data verified.".length)
})()

for (const [nombre, carga, bytesFirmware] of [
  ["la salida real sin una verificación de hash", { code: 0, stdout: sinUltimoHash, stderr: "" }, BYTES_FIRMWARE],
  ["la salida real con «A fatal error occurred»", { code: 0, stdout: `${LOG_ESP32}\nA fatal error occurred: MD5 of file does not match data in flash!\n`, stderr: "" }, BYTES_FIRMWARE],
  ["rc 0 con la salida vacía", { code: 0, stdout: "", stderr: "" }, BYTES_FIRMWARE],
  ["la salida real pero con un firmware compilado de otro tamaño", { code: 0, stdout: LOG_ESP32, stderr: "" }, 1000],
]) {
  test(`ESP32: ${nombre} → NO es éxito`, async () => {
    const dir = await armar()
    const { r, texto } = await cargar(dir, { lanza: lanzador({ carga, bytesFirmware }) })
    assert.equal(r.ok, false, texto)
    assert.equal(r.codigo, "CARGA_SIN_VERIFICAR")
    assert.equal(r.resultado, TEXTO_CARGA_SIN_VERIFICAR)
    assert.doesNotMatch(r.resultado, /^CARGADO/)
    const banco = JSON.parse(readFileSync(join(dir, ".tecnia-vista-fisica", ".banco.json"), "utf8"))
    assert.equal(banco.ultimoIntento.codigo, "CARGA_SIN_VERIFICAR")
    assert.equal(banco.ultimaCarga, undefined, "lo no verificado no se anota como última carga")
  })
}

test("ESP32 con rc distinto de 0 después de escribir → fallo, y dice que pudo quedar a medio grabar", async () => {
  const dir = await armar()
  const { r } = await cargar(dir, { lanza: lanzador({ carga: { code: 1, stdout: "Writing at 0x00010000... (11 %)\nA serial exception error occurred: device disconnected\n", stderr: "" } }) })
  assert.equal(r.ok, false)
  assert.equal(r.codigo, "CARGA_FALLIDA")
  assert.match(r.resultado, /a medio grabar/)
})

// ════════════════════════════════════════════════════════════════════════════════════════
// El veredicto: UNO
// ════════════════════════════════════════════════════════════════════════════════════════

test("UNO: rc 0 → CARGA_SIN_VERIFICAR con el texto exacto, nunca «cargado»", async () => {
  const dir = await armar("arduino-uno", ["D2", "D7"])
  const salidaAvrdude = "avrdude: 924 bytes of flash written\navrdude: 924 bytes of flash verified\n========================= [SUCCESS] Took 3.10 seconds =========================\n"
  const { r, texto, lanza } = await cargar(dir, { deps: depsUno, lanza: lanzador({ placas: [UNO], carga: { code: 0, stdout: salidaAvrdude, stderr: "" }, bytesFirmware: 0 }) })
  assert.equal(lanza.lanzamientos.length, 1)
  assert.deepEqual(lanza.lanzamientos[0].cmd.slice(4), ["-e", "arduino-uno", "-t", "upload", "--upload-port", PUERTO])
  assert.equal(r.ok, false)
  assert.equal(r.codigo, "CARGA_SIN_VERIFICAR")
  assert.equal(r.resultado, "PlatformIO terminó correctamente, pero no pude verificar la escritura del firmware en la placa")
  assert.doesNotMatch(texto, /cargad[oa]/i)
})

// ════════════════════════════════════════════════════════════════════════════════════════
// Timeout y cancelación DURANTE la carga
// ════════════════════════════════════════════════════════════════════════════════════════

test("timeout durante la carga → mensaje propio, nunca éxito, sin la ruta privada; el puerto queda reservado", async () => {
  const dir = await armar()
  const lanza = lanzador({ carga: ({ cwd }) => ({ code: 124, stdout: "Writing at 0x00010000... (11 %)\n", stderr: `El comando no termino en 15 minutos y se corto: pio run -d ${cwd} -e esp32-devkit-v1` }) })
  const { r, texto } = await cargar(dir, { lanza })
  assert.equal(r.ok, false)
  assert.equal(r.codigo, "TIEMPO_AGOTADO")
  assert.match(r.resultado, /^NO SÉ SI SE CARGÓ/)
  assert.match(r.resultado, /a medio grabar/)
  sinRutaPrivada(texto)
  assert.equal(puertoLibre(), false, "con un corte durante la carga el puerto no se suelta: algo puede seguir grabando")
  // Ciclo 1 (H3): sin confirmar el corte, la carpeta privada NO se borra (algo puede seguir leyéndola).
  assert.equal(carpetasPrivadas().length, 1)
  assert.match(r.aviso, /No borré la carpeta temporal/)
  for (const c of carpetasPrivadas()) rmSync(join(CARGAS, c), { recursive: true, force: true })
})

test("cancelación durante la carga → mensaje propio, nunca éxito; el puerto queda reservado", async () => {
  const dir = await armar()
  const ctrl = new AbortController()
  const lanza = lanzador({ alLanzar: () => ctrl.abort(), carga: { code: 130, stdout: "Writing at 0x00001000... (100 %)\n", stderr: "Cancelado por el usuario." } })
  const { r } = await cargar(dir, { lanza, abort: ctrl.signal })
  assert.equal(r.ok, false)
  assert.equal(r.codigo, "CANCELADO_DURANTE_LA_CARGA")
  assert.match(r.resultado, /a medio grabar/)
  assert.doesNotMatch(r.resultado, /no se grabó nada|no se lanzó nada/)
  assert.equal(puertoLibre(), false)
})

// ── Ciclo 1 (Q-01): según `run()` confirme o no que el árbol de la carga terminó ──────────

for (const [codigo, corte] of [["CANCELADO_DURANTE_LA_CARGA", 130], ["TIEMPO_AGOTADO", 124]]) {
  test(`${codigo} con el árbol CONFIRMADO muerto → se suelta el candado y dice «a medio grabar», nunca «no se grabó nada»`, async () => {
    const dir = await armar()
    const { r } = await cargar(dir, { lanza: lanzador({ carga: { code: corte, stdout: "Writing at 0x00010000... (11 %)\n", stderr: "", procesosDeCargaTerminados: true } }) })
    assert.equal(r.ok, false)
    assert.equal(r.codigo, codigo)
    assert.match(r.resultado, /Confirmé que no quedó ningún proceso de la carga corriendo/)
    assert.match(r.resultado, /a medio grabar/)
    assert.doesNotMatch(r.resultado, /no se grabó nada|No desconectes/)
    assert.equal(r.procesosDeCargaTerminados, true)
    assert.equal(puertoLibre(), true, "confirmado el corte, el puerto tiene que quedar libre")
  })

  test(`${codigo} SIN poder confirmar → el candado queda retenido y el mensaje dice que puede seguir grabándose`, async () => {
    const dir = await armar()
    const { r } = await cargar(dir, { lanza: lanzador({ carga: { code: corte, stdout: "", stderr: "", procesosDeCargaTerminados: false } }) })
    assert.equal(r.codigo, codigo)
    assert.match(r.resultado, /No pude confirmar que la grabación se haya frenado: puede que siga grabándose/)
    assert.match(r.resultado, /No desconectes la placa todavía/)
    assert.doesNotMatch(r.resultado, /Confirmé|no se grabó nada/)
    assert.equal(r.procesosDeCargaTerminados, false)
    assert.equal(puertoLibre(), false, "sin confirmar, el puerto no se suelta")
    assert.equal(carpetasPrivadas().length, 1, "sin confirmar, la carpeta privada no se borra")
    for (const c of carpetasPrivadas()) rmSync(join(CARGAS, c), { recursive: true, force: true })
  })
}

// ── Ciclo 1 (H3-A y H3-B): la línea de comando REAL decide ───────────────────────────────
// Las líneas son las `procSelfCmdline` que registró el ensayo H3 en OpenCode 1.18.18 real
// (evidencia/H3/resultados/ab820a3/run/*/plugin-carga.jsonl), con el prompt acortado.

const OC = "<H3>/dist/opencode"
const PROMPT_H3 = 'Caso H3. PLAN:{"rondas":[[{"tool":"proyecto-fisico","args":{"accion":"leer"}}]]}'
const H3 = {
  "E3-tui-auto": [OC, "--agent", "tecnia-bot", "-m", "falso/modelo-falso", "--prompt", PROMPT_H3, "--auto"],
  "E3-tui-dsp": [OC, "--agent", "tecnia-bot", "-m", "falso/modelo-falso", "--prompt", PROMPT_H3, "--dangerously-skip-permissions"],
  "E3-tui-yolo": [OC, "--agent", "tecnia-bot", "-m", "falso/modelo-falso", "--prompt", PROMPT_H3, "--yolo"],
  "E3-tui-port-attach-auto": [OC, "--agent", "tecnia-bot", "-m", "falso/modelo-falso", "--prompt", 'Caso H3. PLAN:{"rondas":[]}', "--port", "39763"],
  "E1/E3-attach (serve)": [OC, "serve", "--port", "41083", "--hostname", "127.0.0.1", "--print-logs", "--log-level", "INFO"],
  "E3-run-auto": [OC, "run", "--agent", "tecnia-bot", "-m", "falso/modelo-falso", "--format", "json", "--print-logs", "--log-level", "INFO", "--auto", PROMPT_H3],
  "E3-run-sin-flags": [OC, "run", "--agent", "tecnia-bot", "-m", "falso/modelo-falso", "--format", "json", "--print-logs", "--log-level", "INFO", PROMPT_H3],
}

test("H3: las líneas de comando medidas — la TUI con bandera, serve, run y la TUI con --port NO cargan, con su código", async () => {
  const esperado = {
    "E3-tui-auto": "APROBACION_AUTOMATICA",
    "E3-tui-dsp": "APROBACION_AUTOMATICA",
    "E3-tui-yolo": "APROBACION_AUTOMATICA",
    "E3-tui-port-attach-auto": "SERVIDOR_EXPUESTO",
    "E1/E3-attach (serve)": "SERVIDOR_EXPUESTO", // ciclo 2: las opciones de servidor se buscan antes que el subcomando; `serve` solo da MODO_NO_PERMITIDO (test de abajo)
    "E3-run-auto": "APROBACION_AUTOMATICA",
    "E3-run-sin-flags": "MODO_NO_PERMITIDO",
  }
  const dir = await armar()
  for (const [caso, argv] of Object.entries(H3)) {
    const { r, lanza, pregunta } = await cargar(dir, { herramientas: { lineaDeComando: () => ({ ok: true, argv }) } })
    assert.equal(r.codigo, esperado[caso], caso)
    assert.match(r.resultado, /Tecnia Bot abierto normalmente/, caso)
    assert.equal(lanza.listados + lanza.lanzamientos.length + pregunta.pedidos.length, 0, caso)
  }
})

test("H3: la TUI sin bandera (como la abre el lanzador, o `opencode` a secas) sí carga", async () => {
  const dir = await armar()
  for (const argv of [[OC], [OC, "--agent", "tecnia-bot"], [OC, "--agent", "tecnia-bot", "-m", "falso/modelo-falso", "--prompt", PROMPT_H3], [OC, "-c", "--model=x/y", "--print-logs"]]) {
    const { r } = await cargar(dir, { herramientas: { lineaDeComando: () => ({ ok: true, argv }) } })
    assert.equal(r.codigo, "CARGADO", JSON.stringify(argv))
  }
})

test("H3: formas de las banderas — =valor, camelCase y después de un valor sí; --no-x no; un --prompt que contiene la palabra tampoco", async () => {
  const { porQueElLanzamientoNoPermiteCargar } = await import(join(REPO, "opencode/carga/cargar-programa.ts"))
  const cod = (...args) => porQueElLanzamientoNoPermiteCargar([OC, ...args])?.codigo ?? null
  assert.equal(cod("--auto=true"), "APROBACION_AUTOMATICA")
  assert.equal(cod("--dangerouslySkipPermissions"), "APROBACION_AUTOMATICA")
  assert.equal(cod("--yolo=1"), "APROBACION_AUTOMATICA")
  assert.equal(cod("--no-auto"), "OPCION_DESCONOCIDA", "--no-auto no es aprobación automática (y no es una opción de la TUI conocida)")
  assert.equal(cod("--prompt", "subilo en modo auto"), null)
  for (const red of ["--port", "--port=0", "--hostname", "--hostname=0.0.0.0", "--mdns", "--mdns-domain=x", "--mdnsDomain", "--cors"]) assert.equal(cod(red), "SERVIDOR_EXPUESTO", red)
  for (const sub of ["serve", "web", "acp", "attach", "run", "./otra-carpeta"]) assert.equal(cod(sub), "MODO_NO_PERMITIDO", sub)
  assert.equal(cod("--algo-nuevo"), "OPCION_DESCONOCIDA")
})

test("ciclo 2, B-1: una opción de servidor escondida como «valor» de otra NO pasa (las cinco líneas del QA)", async () => {
  const { porQueElLanzamientoNoPermiteCargar } = await import(join(REPO, "opencode/carga/cargar-programa.ts"))
  const cod = (...args) => porQueElLanzamientoNoPermiteCargar([OC, ...args])?.codigo ?? null
  // Lo que entiende yargs (QA, yargs-parser 21.1.1): un elemento con `-` no es valor, es otra opción.
  for (const linea of [["--prompt", "--port=4096"], ["-m", "--mdns"], ["--model", "--hostname=0.0.0.0"], ["-s", "--port=4096"], ["--log-level", "--cors=http://x"]]) {
    assert.equal(cod(...linea), "SERVIDOR_EXPUESTO", linea.join(" "))
  }
  // Cualquier capitalización, en cualquier lugar.
  for (const red of ["--PORT=1", "--Hostname", "--mdnsDomain=x", "--MDNS"]) assert.equal(cod("--agent", "tecnia-bot", red), "SERVIDOR_EXPUESTO", red)
  // (a) un elemento que empieza con `-` nunca se consume como valor: se rechaza.
  assert.equal(cod("--prompt", "--fork"), "MODO_NO_PERMITIDO")
  assert.equal(cod("-m", "-c"), "MODO_NO_PERMITIDO")
  assert.equal(cod("--agent"), "MODO_NO_PERMITIDO", "una opción con valor sin valor")
  // Lo normal sigue pasando.
  assert.equal(cod("--prompt", "subí el programa", "-m", "x/y", "--agent=tecnia-bot"), null)
  // Y de punta a punta: no carga.
  const dir = await armar()
  const { r, lanza } = await cargar(dir, { herramientas: { lineaDeComando: () => ({ ok: true, argv: [OC, "--prompt", "--port=4096"] }) } })
  assert.equal(r.codigo, "SERVIDOR_EXPUESTO")
  assert.equal(lanza.listados + lanza.lanzamientos.length, 0)
})

test("H3: si la línea de comando no se puede leer, o la plataforma no es Linux → no carga", async () => {
  const { leerLineaDeComandoReal } = await import(join(REPO, "opencode/carga/cargar-programa.ts"))
  const dir = await armar()
  for (const [lectura, codigo] of [
    [leerLineaDeComandoReal("linux", () => { throw Object.assign(new Error("x"), { code: "EACCES" }) }), "LINEA_DE_COMANDO_ILEGIBLE"],
    [leerLineaDeComandoReal("linux", () => Buffer.from("")), "LINEA_DE_COMANDO_ILEGIBLE"],
    [leerLineaDeComandoReal("win32"), "PLATAFORMA_NO_HABILITADA"],
    [leerLineaDeComandoReal("darwin"), "PLATAFORMA_NO_HABILITADA"],
  ]) {
    const { r, lanza } = await cargar(dir, { herramientas: { lineaDeComando: () => lectura } })
    assert.equal(r.codigo, codigo)
    assert.equal(lanza.listados + lanza.lanzamientos.length, 0)
  }
  // Y la lectura real separa por NUL.
  assert.deepEqual(leerLineaDeComandoReal("linux", () => Buffer.from(`${OC}\0--agent\0tecnia-bot\0--auto\0`)), { ok: true, argv: [OC, "--agent", "tecnia-bot", "--auto"] })
})

test("H3-B: una configuración local que nombra \"server\" → no carga", async () => {
  const dir = await armar()
  // Ciclo 3: un `opencode.json` en el PROYECTO ya rechaza antes (CONFIGURACION_DE_PROYECTO, con
  // sus propios tests); el chequeo de "server" sigue valiendo para la configuración GLOBAL del perfil.
  const global = join(process.env.XDG_CONFIG_HOME, "opencode")
  mkdirSync(global, { recursive: true })
  writeFileSync(join(global, "opencode.json"), JSON.stringify({ server: { port: 4096 } }))
  try {
    const { r, lanza } = await cargar(dir)
    assert.equal(r.codigo, "SERVIDOR_EXPUESTO")
    assert.equal(lanza.listados + lanza.lanzamientos.length, 0)
  } finally {
    rmSync(join(global, "opencode.json"))
  }
  process.env.OPENCODE_CONFIG_CONTENT = '{"server":{"hostname":"0.0.0.0"}}'
  try {
    assert.equal((await cargar(dir)).r.codigo, "SERVIDOR_EXPUESTO")
  } finally {
    delete process.env.OPENCODE_CONFIG_CONTENT
  }
})

// ── Ciclo 3: configuración de OpenCode que podría aprobar el cartel ───────────────────────
// Medido en OpenCode 1.18.18: un `<proyecto>/.opencode/opencode.json` con `permission: allow`
// aprobaba el cartel solo. Acá la sola presencia rechaza, antes de abrir nada.

const PERMITIR_CARTEL = { "*": "allow", "¿Revisaste el circuito?*": "allow" }
const nadaLanzado = (x) => {
  assert.equal(x.lanza.listados + x.lanza.lanzamientos.length, 0, "se detectó la placa o se lanzó algo")
  assert.equal(x.pregunta.pedidos.length, 0, "se mostró el cartel")
  assert.deepEqual(carpetasPrivadas(), [], "se creó una carpeta privada (se llegó a regenerar)")
  assert.equal(puertoLibre(), true, "el candado quedó tomado")
}
/** Una carpeta propia bajo OUT (no la base compartida de los otros tests). */
const carpeta = (...tramos) => {
  const d = join(OUT, "ciclo3", ...tramos)
  mkdirSync(d, { recursive: true })
  return d
}

test("ciclo 3: `.opencode/opencode.json` en el proyecto (el caso medido) → CONFIGURACION_DE_PROYECTO, sin cartel, sin placa, sin candado, sin lanzar", async () => {
  const dir = await armar()
  mkdirSync(join(dir, ".opencode"))
  writeFileSync(join(dir, ".opencode", "opencode.json"), JSON.stringify({ permission: PERMITIR_CARTEL, agent: { "tecnia-bot": { permission: PERMITIR_CARTEL } } }))
  const x = await cargar(dir)
  assert.equal(x.r.codigo, "CONFIGURACION_DE_PROYECTO")
  assert.ok(x.r.resultado.includes(join(dir, ".opencode")), x.r.resultado)
  assert.match(x.r.resultado, /quitarla|otra carpeta/)
  nadaLanzado(x)
})

for (const nombre of ["opencode.json", "opencode.jsonc"]) {
  test(`ciclo 3: \`${nombre}\` en la raíz del proyecto → rechazo (aunque esté vacío: no se interpreta)`, async () => {
    const dir = await armar()
    writeFileSync(join(dir, nombre), "")
    const x = await cargar(dir)
    assert.equal(x.r.codigo, "CONFIGURACION_DE_PROYECTO")
    assert.ok(x.r.resultado.includes(join(dir, nombre)))
    nadaLanzado(x)
  })
}

test("ciclo 3: `.opencode` en una carpeta de más arriba → rechazo (desde la carpeta de trabajo y desde process.cwd())", async () => {
  const arriba = carpeta("arriba")
  mkdirSync(join(arriba, ".opencode"), { recursive: true })
  const dir = await armar(undefined, undefined, carpeta("arriba", "medio", "proyecto"))
  const a = await cargar(dir)
  assert.equal(a.r.codigo, "CONFIGURACION_DE_PROYECTO")
  assert.ok(a.r.resultado.includes(join(arriba, ".opencode")))
  nadaLanzado(a)
  // Proyecto limpio, pero OpenCode corriendo (cwd) debajo de una carpeta con `.opencode`.
  const limpio = await armar()
  const b = await cargar(limpio, { herramientas: { configuracion: { cwd: () => carpeta("arriba", "otro"), home: HOME_LIMPIO, entorno: {} } } })
  assert.equal(b.r.codigo, "CONFIGURACION_DE_PROYECTO")
  nadaLanzado(b)
})

test("ciclo 3: `.opencode` como enlace simbólico (válido o roto) → rechazo", { skip: WIN ? "enlaces en Windows" : false }, async () => {
  for (const destino of [carpeta("destino-valido"), join(OUT, "ciclo3", "no-existe")]) {
    const dir = await armar()
    symlinkSync(destino, join(dir, ".opencode"))
    const x = await cargar(dir)
    assert.equal(x.r.codigo, "CONFIGURACION_DE_PROYECTO", destino)
    nadaLanzado(x)
  }
})

test("ciclo 3: carpeta de trabajo que es un enlace a una carpeta cuyo ancestro REAL tiene `.opencode` → rechazo", { skip: WIN ? "enlaces en Windows" : false }, async () => {
  const real = carpeta("real")
  mkdirSync(join(real, ".opencode"), { recursive: true })
  const destino = carpeta("real", "proyecto")
  const enlace = join(carpeta("enlaces"), "proyecto")
  symlinkSync(destino, enlace)
  const dir = await armar(undefined, undefined, enlace)
  const x = await cargar(dir)
  assert.equal(x.r.codigo, "CONFIGURACION_DE_PROYECTO")
  assert.ok(x.r.resultado.includes(join(real, ".opencode")), x.r.resultado)
  nadaLanzado(x)
})

for (const variable of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG_CONTENT", "OPENCODE_PERMISSION"]) {
  test(`ciclo 3: la variable ${variable} definida → rechazo; vacía no cuenta`, async () => {
    const dir = await armar()
    const x = await cargar(dir, { herramientas: { configuracion: { cwd: () => dir, home: HOME_LIMPIO, entorno: { [variable]: '{"permission":"allow"}' } } } })
    assert.equal(x.r.codigo, "CONFIGURACION_DE_PROYECTO")
    assert.ok(x.r.resultado.includes(variable))
    nadaLanzado(x)
    const vacia = await cargar(dir, { herramientas: { configuracion: { cwd: () => dir, home: HOME_LIMPIO, entorno: { [variable]: "  " } } } })
    assert.equal(vacia.r.codigo, "CARGADO")
  })
}

test("ciclo 3: `$HOME/.opencode` sólo con `bin/` (lo que deja el instalador de OpenCode) → se carga, con cartel", async () => {
  const home = carpeta("home-con-bin")
  mkdirSync(join(home, ".opencode", "bin"), { recursive: true })
  writeFileSync(join(home, ".opencode", "bin", "opencode"), "")
  const dir = await armar()
  const x = await cargar(dir, { herramientas: { configuracion: { cwd: () => dir, home, entorno: {} } } })
  assert.equal(x.r.codigo, "CARGADO")
  assert.equal(x.pregunta.pedidos.length, 1, "siempre con el cartel")
})

test("ciclo 3: `$HOME/.opencode` con TODO lo tolerado (bin, package.json, node_modules, lockfiles, .gitignore) → se carga, con cartel", async () => {
  const home = carpeta("home-tolerado")
  for (const d of ["bin", "node_modules"]) mkdirSync(join(home, ".opencode", d), { recursive: true })
  for (const f of ["package.json", "bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", ".gitignore"]) writeFileSync(join(home, ".opencode", f), "")
  const dir = await armar()
  const x = await cargar(dir, { herramientas: { configuracion: { cwd: () => dir, home, entorno: {} } } })
  assert.equal(x.r.codigo, "CARGADO")
  assert.equal(x.pregunta.pedidos.length, 1)
})

test("ciclo 3: `$HOME/.opencode/agent/tecnia-bot.md` (lo medido, sin opencode.json) → rechazo", async () => {
  const home = carpeta("home-agente")
  mkdirSync(join(home, ".opencode", "agent"), { recursive: true })
  writeFileSync(join(home, ".opencode", "agent", "tecnia-bot.md"), "---\npermission:\n  \"*\": allow\n---\n")
  const dir = await armar()
  const x = await cargar(dir, { herramientas: { configuracion: { cwd: () => dir, home, entorno: {} } } })
  assert.equal(x.r.codigo, "CONFIGURACION_DE_PROYECTO")
  nadaLanzado(x)
})

test("ciclo 3: `$HOME/.opencode/opencode.json` con el proyecto FUERA del HOME → rechazo (se revisa siempre); y también si sólo `$HOME` (no homedir) lo tiene", async () => {
  const home = carpeta("home-afuera")
  mkdirSync(join(home, ".opencode"), { recursive: true })
  writeFileSync(join(home, ".opencode", "opencode.json"), "{}")
  const dir = await armar() // en la base compartida de tests, que no está dentro de `home`
  assert.ok(!dir.startsWith(home))
  const x = await cargar(dir, { herramientas: { configuracion: { cwd: () => dir, home, entorno: {} } } })
  assert.equal(x.r.codigo, "CONFIGURACION_DE_PROYECTO")
  nadaLanzado(x)
  const y = await cargar(dir, { herramientas: { configuracion: { cwd: () => dir, home: [HOME_LIMPIO, home], entorno: {} } } })
  assert.equal(y.r.codigo, "CONFIGURACION_DE_PROYECTO", "con dos carpetas personales, se revisan las dos")
})

for (const cosa of ["opencode.json", "opencode.jsonc", "agent", "plugins", "tool", "AGENTS.md", "cualquier-cosa-desconocida", "skills"]) {
  test(`ciclo 3: \`$HOME/.opencode/${cosa}\` → rechazo`, async () => {
    const home = carpeta(`home-con-${cosa}`)
    mkdirSync(join(home, ".opencode", "bin"), { recursive: true })
    if (cosa.includes(".")) writeFileSync(join(home, ".opencode", cosa), "")
    else mkdirSync(join(home, ".opencode", cosa))
    const dir = await armar()
    const x = await cargar(dir, { herramientas: { configuracion: { cwd: () => dir, home, entorno: {} } } })
    assert.equal(x.r.codigo, "CONFIGURACION_DE_PROYECTO")
    assert.ok(x.r.resultado.includes(join(home, ".opencode", cosa)))
    nadaLanzado(x)
  })
}

test("ciclo 3: un nivel que no se puede revisar → rechazo", { skip: WIN || process.getuid?.() === 0 ? "permisos de Unix sin root" : false }, async () => {
  const { chmodSync } = await import("node:fs")
  const cerrada = carpeta("cerrada")
  mkdirSync(join(cerrada, "adentro"))
  chmodSync(cerrada, 0o600) // se puede listar, no atravesar: lstat de lo de adentro da EACCES
  try {
    const dir = await armar()
    const x = await cargar(dir, { herramientas: { configuracion: { cwd: () => join(cerrada, "adentro"), home: HOME_LIMPIO, entorno: {} } } })
    assert.equal(x.r.codigo, "CONFIGURACION_DE_PROYECTO")
    assert.match(x.r.resultado, /no pude revisar/)
    nadaLanzado(x)
  } finally {
    chmodSync(cerrada, 0o700)
  }
})

test("ciclo 3: carpeta limpia → el camino feliz sigue igual, con cartel", async () => {
  const dir = await armar(undefined, undefined, carpeta("limpia", "proyecto"))
  const x = await cargar(dir)
  assert.equal(x.r.codigo, "CARGADO")
  assert.equal(x.pregunta.pedidos.length, 1)
  assert.equal(x.lanza.lanzamientos.length, 1)
})

// ── Ciclo 4: el lanzador, la lista ampliada y dos tests huecos del ciclo 3 ─────────────────

test("ciclo 4: sin marca del lanzador (o una que no es un pid) → SIN_LANZADOR, sin detectar, sin lanzar, sin cartel, candado libre", async () => {
  const dir = await armar()
  for (const marca of [undefined, "", "abc", "0", "-1"]) {
    const x = await cargar(dir, { herramientas: { lanzador: { marca, pid: process.pid, ancestros: () => [] } } })
    assert.equal(x.r.codigo, "SIN_LANZADOR", String(marca))
    assert.match(x.r.resultado, /`tecnia-bot`/)
    nadaLanzado(x)
  }
})

test("ciclo 4: marca con un pid ajeno (ni éste ni un ancestro) → SIN_LANZADOR; si no se pueden leer los ancestros, también", async () => {
  const dir = await armar()
  const ajeno = await cargar(dir, { herramientas: { lanzador: { marca: "4242424", pid: 1000, ancestros: () => [999, 1] } } })
  assert.equal(ajeno.r.codigo, "SIN_LANZADOR")
  nadaLanzado(ajeno)
  const ilegible = await cargar(dir, { herramientas: { lanzador: { marca: "999", pid: 1000, ancestros: () => null } } })
  assert.equal(ilegible.r.codigo, "SIN_LANZADOR")
  nadaLanzado(ilegible)
})

test("ciclo 4: marca de un ANCESTRO + carpeta limpia → cartel y carga", async () => {
  const dir = await armar()
  const x = await cargar(dir, { herramientas: { lanzador: { marca: "999", pid: 1000, ancestros: () => [999, 1] } } })
  assert.equal(x.r.codigo, "CARGADO")
  assert.equal(x.pregunta.pedidos.length, 1)
})

test("ciclo 4: ancestrosPorProc lee la cadena real de /proc y falla cerrado si no puede", { skip: process.platform !== "linux" && "usa /proc" }, async () => {
  const { ancestrosPorProc } = await import(join(REPO, "opencode/carga/cargar-programa.ts"))
  const reales = ancestrosPorProc()
  assert.ok(Array.isArray(reales) && reales.includes(process.ppid), JSON.stringify(reales))
  assert.equal(ancestrosPorProc(process.pid, () => { throw new Error("EACCES") }), null)
})

for (const nombre of ["tui.json", "tui.jsonc"]) {
  test(`ciclo 4: \`${nombre}\` en el proyecto y en un ancestro → rechazo`, async () => {
    const dir = await armar()
    writeFileSync(join(dir, nombre), JSON.stringify({ plugin: ["./aprobar.ts"] }))
    const a = await cargar(dir)
    assert.equal(a.r.codigo, "CONFIGURACION_DE_PROYECTO")
    nadaLanzado(a)
    const arriba = carpeta(`arriba-${nombre}`)
    writeFileSync(join(arriba, nombre), "{}")
    const b = await cargar(await armar(undefined, undefined, carpeta(`arriba-${nombre}`, "proyecto")))
    assert.equal(b.r.codigo, "CONFIGURACION_DE_PROYECTO")
    assert.ok(b.r.resultado.includes(join(arriba, nombre)))
    nadaLanzado(b)
  })
}

for (const variable of ["OPENCODE_TUI_CONFIG", "OPENCODE_TEST_HOME", "OPENCODE_TEST_MANAGED_CONFIG_DIR"]) {
  test(`ciclo 4: la variable ${variable} → rechazo`, async () => {
    const dir = await armar()
    const x = await cargar(dir, { herramientas: { configuracion: { cwd: () => dir, home: HOME_LIMPIO, entorno: { [variable]: "/tmp/algo" } } } })
    assert.equal(x.r.codigo, "CONFIGURACION_DE_PROYECTO")
    assert.ok(x.r.resultado.includes(variable))
    nadaLanzado(x)
  })
}

// N2 (revisión del ciclo 3): el test "un nivel que no se puede revisar" usaba chmod 0o600 y
// cortaba en el `realpath` de la carpeta de partida: la rama del `lstat` del RECORRIDO nunca se
// ejercitaba (un nivel atravesable no da EACCES en `lstat`). Era hueco para esa rama. Acá se
// inyecta un `lstat` que falla con EIO en un nivel concreto, con el `realpath` funcionando.
test("ciclo 4 (N2): un `lstat` del recorrido que falla con algo que no es ENOENT → rechazo", async () => {
  const dir = await armar()
  const falla = (ruta) => {
    if (ruta === join(dir, "opencode.json")) throw Object.assign(new Error("EIO"), { code: "EIO" })
    return lstatReal(ruta)
  }
  const x = await cargar(dir, { herramientas: { configuracion: { cwd: () => dir, home: HOME_LIMPIO, entorno: {}, lstat: falla } } })
  assert.equal(x.r.codigo, "CONFIGURACION_DE_PROYECTO")
  assert.match(x.r.resultado, /no pude revisar la carpeta/)
  nadaLanzado(x)
})

// N3 (revisión del ciclo 3): todos los tests inyectaban `configuracion`, así que romper el valor
// por defecto (`h.configuracion ?? ENTORNO_DE_CONFIGURACION_REAL`) no ponía nada en rojo. Acá se
// llama SIN `configuracion` y con una variable rechazada en el entorno REAL del proceso.
test("ciclo 4 (N3): sin `configuracion` inyectada se usa el entorno REAL (y una variable real rechaza)", async () => {
  const dir = await armar()
  process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR = "/tmp/no-importa"
  try {
    const lanza = lanzador()
    const ctx = { directory: dir, agent: "tecnia-bot", abort: new AbortController().signal, ask: cartel().ask }
    const texto = await ejecutarPrograma({ accion: "cargar" }, ctx, depsReales(), { ...HERRAMIENTAS_DE_CARGA, run: lanza.run, lineaDeComando: () => ({ ok: true, argv: TUI_NORMAL }), lanzador: LANZADOR_OK })
    const r = JSON.parse(texto)
    assert.equal(r.codigo, "CONFIGURACION_DE_PROYECTO")
    assert.ok(r.resultado.includes("OPENCODE_TEST_MANAGED_CONFIG_DIR"))
    assert.equal(lanza.listados + lanza.lanzamientos.length, 0)
  } finally {
    delete process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR
  }
})

test("Q-04: si el proyecto cambia de revisión con el cartel abierto → PROYECTO_CAMBIO, no se lanza", async () => {
  const dir = await armar()
  const pregunta = cartel("si", async () => {
    const { revision } = await fisico(dir, { accion: "leer" })
    const r = await fisico(dir, { accion: "aplicar", baseRevision: revision, operaciones: [{ tipo: "AsignarPin", payload: { componente: "cmp-1", terminal: "anodo", pin: "GPIO19" } }] })
    assert.equal(r.ok, true, JSON.stringify(r))
  })
  const { r, lanza } = await cargar(dir, { pregunta })
  assert.equal(r.codigo, "PROYECTO_CAMBIO")
  assert.equal(lanza.lanzamientos.length, 0)
  assert.equal(puertoLibre(), true)
})

test("Q-05: un programa de ESP32 con un Arduino conectado (y al revés) → PLACA_NO_COINCIDE, sin cartel ni lanzamiento", async () => {
  const dir = await armar()
  const a = await cargar(dir, { lanza: lanzador({ placas: [UNO] }) })
  assert.equal(a.r.codigo, "PLACA_NO_COINCIDE")
  assert.equal(a.pregunta.pedidos.length, 0)
  assert.equal(a.lanza.lanzamientos.length, 0)
  const uno = await armar("arduino-uno", ["D2", "D7"])
  const espNativo = { port: PUERTO, hwid: "USB VID:PID=303A:1001 SER=F412FA000001 LOCATION=1-3", description: "USB JTAG/serial debug unit" }
  const b = await cargar(uno, { deps: depsUno, lanza: lanzador({ placas: [espNativo] }) })
  assert.equal(b.r.codigo, "PLACA_NO_COINCIDE")
  assert.equal(b.lanza.lanzamientos.length, 0)
  // Un chip USB-serie genérico no es certeza de nada: se deja seguir.
  const c = await cargar(uno, { deps: depsUno, lanza: lanzador({ placas: [placa()], carga: { code: 0, stdout: "", stderr: "" }, bytesFirmware: 0 }) })
  assert.equal(c.lanza.lanzamientos.length, 1)
})

test("Q-06: abort durante la revalidación (después del cartel) → no se lanza", async () => {
  const dir = await armar()
  const ctrl = new AbortController()
  const lanza = lanzador()
  const run = lanza.run
  lanza.run = async (cmd, ...resto) => {
    if (cmd[1] === "device" && lanza.listados === 1) ctrl.abort() // la segunda detección: el doble no mira la señal
    return run(cmd, ...resto)
  }
  const { r } = await cargar(dir, { lanza, abort: ctrl.signal })
  assert.equal(lanza.listados, 2)
  assert.equal(r.codigo, "CANCELADO")
  assert.equal(lanza.lanzamientos.length, 0)
  assert.equal(puertoLibre(), true)
})

// ════════════════════════════════════════════════════════════════════════════════════════
// Registro
// ════════════════════════════════════════════════════════════════════════════════════════

test("registro: el éxito queda anotado sin rutas ni series; si no se puede anotar, se dice y el éxito sigue siendo éxito", async () => {
  const dir = await armar()
  const ok = await cargar(dir)
  const banco = JSON.parse(readFileSync(join(dir, ".tecnia-vista-fisica", ".banco.json"), "utf8"))
  assert.equal(banco.ultimaCarga.origen, "programa")
  assert.equal(banco.ultimaCarga.revision, ok.r.revision)
  assert.equal(banco.ultimoIntento.codigo, "CARGADO")
  assert.doesNotMatch(JSON.stringify(banco), /A1B2C3D4E5|ttyUSB|COM5|cargas/)
  assert.deepEqual(ok.r.registro, { ok: true })

  rmSync(join(dir, ".tecnia-vista-fisica", ".banco.json"))
  mkdirSync(join(dir, ".tecnia-vista-fisica", ".banco.json")) // no se puede escribir encima de una carpeta
  const sinRegistro = await cargar(dir)
  assert.equal(sinRegistro.r.ok, true)
  assert.equal(sinRegistro.r.codigo, "CARGADO")
  assert.match(sinRegistro.r.resultado, /^CARGADO — .*no pude anotar esta carga/s)
  assert.equal(sinRegistro.r.registro.ok, false)
})

// ════════════════════════════════════════════════════════════════════════════════════════
// El argv y la tool
// ════════════════════════════════════════════════════════════════════════════════════════

test("argvDeCargaCompilando: el argv sin nobuild, con las validaciones del gate, y lanzarCarga lo admite", async () => {
  assert.deepEqual(argvDeCargaCompilando({ cwd: "/tmp/x", environment: "esp32-devkit-v1", puerto: "/dev/ttyUSB0" }), ["pio", "run", "-d", "/tmp/x", "-e", "esp32-devkit-v1", "-t", "upload", "--upload-port", "/dev/ttyUSB0"])
  for (const malo of [{ cwd: "rel", environment: "uno", puerto: "COM5" }, { cwd: "/p", environment: "-t uploadfs", puerto: "COM5" }, { cwd: "/p", environment: "uno", puerto: "192.168.0.10" }]) {
    assert.throws(() => argvDeCargaCompilando(malo), /RUTA_DE_CARGA_NO_AUTORIZADA/)
  }
  const vistos = []
  await lanzarCarga(async (cmd, cwd, s, t, cap) => (vistos.push(esCapacidadDeCarga(cap)), { code: 0, stdout: "", stderr: "" }), argvDeCargaCompilando({ cwd: "/p", environment: "uno", puerto: "COM5" }), "/p")
  assert.deepEqual(vistos, [true])
})

test("la tool anuncia la acción: enum y descripción", () => {
  assert.match(programaTool.description, /`cargar`/)
  assert.match(programaTool.description, /CARGA_SIN_VERIFICAR/)
  assert.deepEqual(Object.keys(programaTool.args).sort(), ["accion", "idProyecto"], "no se agregan argumentos: ni puerto, ni rutas, ni flags")
})

test("el agente sabe que el programa del proyecto físico se carga con `programa` y `cargar`", () => {
  const i = PROMPT.indexOf("## REGLA CRÍTICA — programa del proyecto físico")
  const regla = PROMPT.slice(i, PROMPT.indexOf("\n## ", i + 10))
  assert.match(regla, /`accion: "cargar"`/)
  assert.doesNotMatch(regla, /todavía no está disponible/)
})

test("ningún proceso real: Bun.spawn no se llamó nunca en este archivo", () => {
  assert.deepEqual(spawnsReales, [])
})
