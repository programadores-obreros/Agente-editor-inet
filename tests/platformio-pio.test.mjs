// El binario de PlatformIO se tiene que volver a buscar después de instalarlo.
//
// POR QUÉ EXISTE ESTE ARCHIVO. `pioBin()` cacheaba la ruta resuelta, y cuando
// PlatformIO NO estaba instalado cacheaba también el fallback "pio". El flujo
// real de `reparar` era: `execute()` corre `pio --version` (cache = "pio"),
// el bootstrap instala PlatformIO en ~/.platformio/penv, y al final se
// preguntaba `existsSync(pioBin())` → `existsSync("pio")`, un archivo relativo
// al cwd que no existe. Resultado: "La reparacion corrio pero PlatformIO sigue
// sin instalarse" con PlatformIO ya instalado, y `compile` fallando hasta
// reiniciar OpenCode. El docente quedaba en un loop de /reparar.
//
// Se prueba el comportamiento, no el texto: se apunta HOME a un directorio
// temporal, se importa el módulo UNA sola vez, y se crea/borra el binario
// entre aserciones. Si alguien vuelve a cachear el fallback, el segundo test
// falla.

import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, chmodSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-platformio-pio-test")
const HOME_FALSO = join(OUT, "home")
const PIO_FALSO =
  process.platform === "win32"
    ? join(HOME_FALSO, ".platformio", "penv", "Scripts", "pio.exe")
    : join(HOME_FALSO, ".platformio", "penv", "bin", "pio")

// homedir() lee $HOME en Linux/Mac y $USERPROFILE en Windows.
// PLATFORMIO_CORE_DIR entra acá porque desde la 0.3.78 es el PRIMER candidato: si
// la máquina que corre los tests la tiene puesta, los tests de abajo dejarían de
// probar lo que creen que prueban.
const HOME_ORIGINAL = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  PLATFORMIO_CORE_DIR: process.env.PLATFORMIO_CORE_DIR,
}

// `Bun.which` no existe bajo Node: se simula un PATH sin pio, que es el caso real
// (PlatformIO nunca queda en el PATH después de instalarse).
globalThis.Bun = { which: () => null }

let mod

before(async () => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true })
  mkdirSync(HOME_FALSO, { recursive: true })
  process.env.HOME = HOME_FALSO
  process.env.USERPROFILE = HOME_FALSO
  delete process.env.PLATFORMIO_CORE_DIR
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/platformio.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "platformio.ts"), src)
  mod = await import(join(OUT, "platformio.ts"))
})

after(() => {
  process.env.HOME = HOME_ORIGINAL.HOME
  process.env.USERPROFILE = HOME_ORIGINAL.USERPROFILE
  if (HOME_ORIGINAL.PLATFORMIO_CORE_DIR === undefined) delete process.env.PLATFORMIO_CORE_DIR
  else process.env.PLATFORMIO_CORE_DIR = HOME_ORIGINAL.PLATFORMIO_CORE_DIR
})

function instalarPioFalso() {
  mkdirSync(dirname(PIO_FALSO), { recursive: true })
  writeFileSync(PIO_FALSO, "#!/bin/sh\necho PlatformIO Core, version 6.0.0\n")
  chmodSync(PIO_FALSO, 0o755)
}

test("sin PlatformIO instalado: no está disponible y pioBin() cae al PATH", () => {
  assert.equal(existsSync(PIO_FALSO), false, "el HOME falso tiene que arrancar vacío")
  assert.equal(mod.pioDisponible(), false)
  assert.equal(mod.pioBin(), "pio")
})

test("instalar PlatformIO DESPUÉS del primer chequeo se detecta sin reiniciar el módulo", () => {
  // Este es el flujo de `reparar`: primero se preguntó y no estaba (test anterior,
  // mismo módulo cargado), después el bootstrap lo instala.
  instalarPioFalso()
  assert.equal(mod.pioDisponible(), true, "reparar acaba de instalarlo y el tool sigue diciendo que falta")
  assert.equal(mod.pioBin(), PIO_FALSO, "compile seguiría llamando a 'pio' a secas, que no está en el PATH")
})

test("si desaparece, vuelve a no estar disponible tras resetPioCache()", () => {
  rmSync(PIO_FALSO)
  mod.resetPioCache()
  assert.equal(mod.pioDisponible(), false)
  assert.equal(mod.pioBin(), "pio")
})

test("el tool sigue exportando la tool por defecto", () => {
  assert.equal(typeof mod.default, "object")
  assert.equal(typeof mod.default.execute, "function")
})

// ── `reparar` tiene que poder correr justo cuando PlatformIO falta ─────────
//
// Reproducido en la VM Windows 10 con .platformio movida: /reparar devolvía el
// texto de pioNoEncontrado() ("Menu inicio -> 'Reparar Tecnia Bot'") y no
// instalaba nada. El pre-chequeo `pio --version` de execute() corría también
// para `reparar`, y la rama de reparación era inalcanzable en el único caso para
// el que existe. Bajo Node no hay Bun.spawn, así que run() devuelve 127: es
// exactamente el "pio no encontrado" del aula.

/** Frase estable del mensaje de pioNoEncontrado(): la única salida que ofrece. */
const FRASE_NO_ENCONTRADO = /Menu inicio -> 'Reparar Tecnia Bot'/

const ctx = { directory: OUT, abort: new AbortController().signal }

test("reparar sin PlatformIO NO contesta 'anda al menu inicio': llega a su propia rama", async () => {
  assert.equal(existsSync(PIO_FALSO), false, "este test necesita que pio falte")
  const r = await mod.default.execute({ action: "reparar" }, ctx)
  assert.doesNotMatch(r, FRASE_NO_ENCONTRADO, "reparar quedó bloqueado por el pre-chequeo de pio")
  // En Linux/Mac la rama contesta que la reparación automática es sólo Windows.
  assert.match(r, /reparacion automatica es solo para Windows/i)
})

test("reparar en Windows (simulado) sin PlatformIO llega al chequeo del bootstrap.ps1", async () => {
  const original = Object.getOwnPropertyDescriptor(process, "platform")
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })
  try {
    const r = await mod.default.execute({ action: "reparar" }, ctx)
    assert.doesNotMatch(r, FRASE_NO_ENCONTRADO, "reparar quedó bloqueado por el pre-chequeo de pio")
    // Sin LOCALAPPDATA/TecniaBot en esta máquina, lo que sigue es "no encuentro el instalador".
    assert.match(r, /No encuentro el instalador/)
    assert.match(r, /bootstrap\.ps1/)
  } finally {
    Object.defineProperty(process, "platform", original)
  }
})

test("compile sin PlatformIO sí contesta 'anda al menu inicio' (el pre-chequeo sigue vivo para el resto)", async () => {
  const r = await mod.default.execute({ action: "compile" }, ctx)
  assert.match(r, FRASE_NO_ENCONTRADO)
})

// ── los baudios del monitor salen del platformio.ini ────────────────────────
//
// La descripción del tool prometía «puerto y baudios automáticos» y el código
// hacía `args.baud ?? 9600`. El ini que el propio prompt genera para ESP32 trae
// `monitor_speed = 115200`: el monitor abría a 9600 y se veía basura, con el dato
// correcto escrito dos líneas más arriba. Se prueba la función pura sobre el
// texto del ini, con DOS environments distintos, que es el caso real del aula
// (un ini con `uno` y `esp32dev` para la misma carpeta).

const INI_DOS_ENVS = `
[platformio]
default_envs = uno

[env:uno]
platform = atmelavr
board = uno
monitor_speed = 9600   ; el UNO de siempre

[env:esp32dev]
platform = espressif32
board = esp32dev
monitor_speed = 115200
`

test("leerMonitorSpeed: toma el monitor_speed del environment pedido", () => {
  assert.equal(mod.leerMonitorSpeed(INI_DOS_ENVS, "esp32dev"), 115200)
  assert.equal(mod.leerMonitorSpeed(INI_DOS_ENVS, "uno"), 9600)
})

test("leerMonitorSpeed: sin environment, el primero que lo declare", () => {
  assert.equal(mod.leerMonitorSpeed(INI_DOS_ENVS), 9600)
  // Y un environment que no existe no inventa: cae al primero.
  assert.equal(mod.leerMonitorSpeed(INI_DOS_ENVS, "no-existe"), 9600)
})

test("leerMonitorSpeed: la sección común [env] vale para todos", () => {
  const ini = "[env]\nmonitor_speed = 74880\n\n[env:esp32dev]\nboard = esp32dev\n"
  assert.equal(mod.leerMonitorSpeed(ini, "esp32dev"), 74880)
})

test("leerMonitorSpeed: sin monitor_speed devuelve null (y el tool cae a 9600)", () => {
  assert.equal(mod.leerMonitorSpeed("[env:uno]\nboard = uno\n"), null)
  assert.equal(mod.leerMonitorSpeed(""), null)
  // Una línea comentada no cuenta.
  assert.equal(mod.leerMonitorSpeed("[env:uno]\n; monitor_speed = 115200\n"), null)
})

// Y el cableado completo, no sólo la función pura: `monitor` sin `baud` tiene que
// abrir a los baudios del ini de la carpeta del proyecto. Se simula que PlatformIO
// responde (Bun.spawn falso, sólo dentro de este test) y se pasa el puerto para
// no depender de una placa enchufada. Sin emulador de terminal, el tool devuelve
// las instrucciones manuales, que llevan el mismo `--baud`.
test("monitor sin baud usa el monitor_speed del platformio.ini del proyecto", async () => {
  const proyecto = join(OUT, "proyecto-ini")
  mkdirSync(proyecto, { recursive: true })
  writeFileSync(join(proyecto, "platformio.ini"), INI_DOS_ENVS)

  const spawnOriginal = globalThis.Bun.spawn
  globalThis.Bun.spawn = () => ({
    stdout: "PlatformIO Core, version 6.0.0\n",
    stderr: "",
    exited: Promise.resolve(0),
    unref() {},
  })
  try {
    const ctxProyecto = { directory: proyecto, abort: new AbortController().signal }
    const r = await mod.default.execute({ action: "monitor", port: "/dev/ttyFALSO", environment: "esp32dev" }, ctxProyecto)
    assert.match(r, /115200 baudios/, "no tomó el monitor_speed del env esp32dev")
    assert.match(r, /monitor_speed de tu platformio\.ini/, "no le dice de dónde salieron los baudios")

    // Con `baud` explícito, gana el pedido del usuario.
    const r2 = await mod.default.execute({ action: "monitor", port: "/dev/ttyFALSO", baud: 74880 }, ctxProyecto)
    assert.match(r2, /74880 baudios/)

    // Sin ini a la vista, 9600 y lo dice.
    const sinIni = join(OUT, "sin-ini")
    mkdirSync(sinIni, { recursive: true })
    const r3 = await mod.default.execute({ action: "monitor", port: "/dev/ttyFALSO" }, { ...ctxProyecto, directory: sinIni })
    assert.match(r3, /9600 baudios \(el valor por defecto/, "sin ini tiene que caer a 9600 y avisarlo")
  } finally {
    if (spawnOriginal) globalThis.Bun.spawn = spawnOriginal
    else delete globalThis.Bun.spawn
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// PlatformIO NO VIVE SIEMPRE EN ~/.platformio: TRES LUGARES DONDE BUSCAR
// ═══════════════════════════════════════════════════════════════════════════
//
// EL CASO REAL (escuela Juana Manso, 2026-09-08). La usuaria de Windows se llama
// `Dirección310` — con `ó`, que NO es ASCII. PlatformIO Core no soporta rutas con
// caracteres no-ASCII (sus toolchains de gcc se rompen), así que en Windows
// RELOCALIZA su core_dir a la raíz del disco. El instalador oficial dejó esto en
// pantalla, en esa máquina:
//
//     Creating a virtual environment at C:\.platformio\penv
//     The full path to platformio.exe is C:\.platformio\penv\Scripts\platformio.exe
//
// Tecnia Bot buscaba UNA sola ruta hardcodeada (`$HOME/.platformio/...`) en SEIS
// lugares distintos, y en ninguno miraba `PLATFORMIO_CORE_DIR`. Durante TRES
// SEMANAS le dijimos a una docente «PlatformIO NO quedó instalado» mientras lo
// tenía instalado y andando: `pio.exe --version` contestaba «PlatformIO Core,
// version 6.2.0».
//
// Es la TERCERA vez que este defecto muerde, y ya tenía nombre en este repo: la
// lección «TRES LUGARES DONDE BUSCAR, no uno» del lanzador
// (installer/abrir-tecnia-bot.cmd). Se aplicó a OpenCode y nunca a PlatformIO.
//
// La lógica está REPETIDA en los seis archivos a propósito: ninguno hace
// dot-sourcing de otro, cada uno se copia y corre SOLO (el .exe lleva unos, el
// menú inicio lanza otros, /reparar lanza el bootstrap desde adentro del bot).
// LO QUE MANTIENE HONESTAS A LAS SEIS COPIAS ES ESTE ARCHIVO. Si aparece una
// séptima, va acá.

/** Un .ps1/.sh sin sus líneas de comentario: los comentarios NOMBRAN las rutas
 *  para explicar el bug, y un test que las cuente pasa aunque el código mienta.
 *  Ya mordió tres veces en este repo. */
const sinComentarios = (txt) => txt.replace(/^\s*#.*$/gm, "")
/** Lo mismo para TypeScript: `//`, y las líneas de un bloque `/** ... *​/`. */
const sinComentariosTs = (txt) => txt.replace(/^\s*(\/\/|\/\*|\*).*$/gm, "")
const leerRepo = (...p) => readFileSync(join(REPO, ...p), "utf8")

/** Los SEIS lugares que buscaban PlatformIO, y para qué sirve cada uno. */
const LOS_SEIS = [
  ["install/bootstrap.ps1", "es EL chequeo que decide imprimir «PlatformIO NO quedo instalado»"],
  ["install/diagnostico.ps1", "es el reporte que el docente manda cuando algo no anda"],
  ["install/install.ps1", "pone pio en el PATH y verifica que esté"],
  ["install/bootstrap.sh", "el mismo chequeo, en Linux/macOS"],
  ["install/install.sh", "la misma puesta en el PATH, en Linux/macOS"],
  ["opencode/tool/platformio.ts", "es el que compila y carga de verdad"],
]

for (const [archivo, para] of LOS_SEIS) {
  test(`${archivo} respeta PLATFORMIO_CORE_DIR`, () => {
    // SIN COMENTARIOS, y esta es la cuarta vez que la trampa muerde en este repo:
    // los comentarios de estos archivos NOMBRAN la variable para contar el bug, así
    // que un test sobre el archivo entero encuentra la EXPLICACIÓN y pasa aunque el
    // código haya vuelto a la ruta fija. Verificado por mutación: borrando la línea
    // que la lee, este test se pone rojo.
    const codigo = archivo.endsWith(".ts") ? sinComentariosTs(leerRepo(archivo)) : sinComentarios(leerRepo(archivo))
    assert.match(
      codigo,
      /PLATFORMIO_CORE_DIR/,
      `${archivo} busca PlatformIO en una ruta fija y nunca mira PLATFORMIO_CORE_DIR, ` +
        `que es la variable con la que el propio PlatformIO dice dónde vive (${para}).`,
    )
  })
}

// Los cuatro archivos que corren en Windows tienen que contemplar la raíz del
// disco. Este es el test que atrapa el bug real de `Dirección310`.
for (const archivo of ["install/bootstrap.ps1", "install/diagnostico.ps1", "install/install.ps1"]) {
  test(`${archivo} contempla la relocalización a la raíz del disco`, () => {
    const codigo = sinComentarios(leerRepo(archivo))
    assert.match(
      codigo,
      /GetPathRoot/,
      `${archivo} no calcula la raíz del disco de $USERPROFILE: con una usuaria como ` +
        `Dirección310, PlatformIO se instala en C:\\.platformio y este script no lo ve`,
    )
    assert.match(
      codigo,
      /C:\\\.platformio/,
      `${archivo} no tiene el fallback fijo C:\\.platformio (por si el perfil vive en otro disco)`,
    )
  })
}

test("opencode/tool/platformio.ts contempla la relocalización a la raíz del disco", () => {
  const codigo = sinComentariosTs(leerRepo("opencode/tool/platformio.ts"))
  assert.match(codigo, /win32\.parse\(/, "el tool no calcula la raíz del disco del home en Windows")
  assert.match(codigo, /C:\\\\\.platformio/, "el tool no tiene el fallback fijo C:\\.platformio")
})

// ── El caso concreto, por mutación: `Dirección310` ──────────────────────────
//
// No alcanza con que la palabra aparezca en el archivo: se le pide a la función
// pura la lista que devolvería EN ESA MÁQUINA. Corre desde Linux porque
// pioCandidatos() toma home/plataforma/entorno por parámetro y usa `path.win32`.

const HOME_DIRECCION = "C:\\Users\\Dirección310"
const PIO_EN_LA_RAIZ = "C:\\.platformio\\penv\\Scripts\\pio.exe"
const PIO_EN_EL_HOME = "C:\\Users\\Dirección310\\.platformio\\penv\\Scripts\\pio.exe"

test("Windows con usuaria `Dirección310`: C:\\.platformio está en la lista, DESPUÉS del home", () => {
  const c = mod.pioCandidatos(HOME_DIRECCION, "win32", {})
  assert.ok(
    c.includes(PIO_EN_EL_HOME),
    "se perdió la instalación normal (~/.platformio), que es la de casi todas las máquinas",
  )
  assert.ok(
    c.includes(PIO_EN_LA_RAIZ),
    `${PIO_EN_LA_RAIZ} no está entre los candidatos: ES la ruta donde el instalador ` +
      `oficial dejó PlatformIO en la máquina de la escuela.\nLa lista fue:\n${c.join("\n")}`,
  )
  assert.ok(
    c.indexOf(PIO_EN_EL_HOME) < c.indexOf(PIO_EN_LA_RAIZ),
    "la raíz del disco se prueba ANTES que el home: en una máquina sana eso elige la instalación equivocada",
  )
  // Y el otro nombre: el instalador oficial anuncia platformio.exe, no pio.exe.
  assert.ok(
    c.includes("C:\\.platformio\\penv\\Scripts\\platformio.exe"),
    "sólo se mira pio.exe; el mensaje final del instalador oficial nombra platformio.exe",
  )
})

test("PLATFORMIO_CORE_DIR gana y va PRIMERO", () => {
  const c = mod.pioCandidatos(HOME_DIRECCION, "win32", { PLATFORMIO_CORE_DIR: "D:\\pio-de-la-escuela" })
  assert.equal(
    c[0],
    "D:\\pio-de-la-escuela\\penv\\Scripts\\pio.exe",
    `lo que el usuario declaró explícitamente tiene que ganarle a cualquier adivinanza.\nLa lista fue:\n${c.join("\n")}`,
  )
  // Y no se pierde nada: los otros siguen abajo, por si la variable apunta a una
  // carpeta que ya no existe.
  assert.ok(c.includes(PIO_EN_EL_HOME) && c.includes(PIO_EN_LA_RAIZ), "setear la variable no puede borrar el resto de la lista")
})

test("Unix NO inventa la raíz del disco: sólo la variable, el home y el PATH", () => {
  const c = mod.pioCandidatos("/home/docente", "linux", {})
  assert.deepEqual(c, ["/home/docente/.platformio/penv/bin/pio", "/home/docente/.platformio/penv/bin/platformio"])
  const conVariable = mod.pioCandidatos("/home/docente", "linux", { PLATFORMIO_CORE_DIR: "/opt/pio" })
  assert.equal(conVariable[0], "/opt/pio/penv/bin/pio")
})

for (const archivo of ["install/bootstrap.sh", "install/install.sh"]) {
  test(`${archivo} no inventa /.platformio en la raíz (eso es SOLO de Windows)`, () => {
    // La relocalización a la raíz del disco existe porque gcc se rompe con rutas
    // no-ASCII en Windows. En Linux/macOS PlatformIO no mueve nada, y buscar en
    // /.platformio sería copiar un remedio sin la enfermedad.
    const codigo = sinComentarios(leerRepo(archivo))
    const malas = codigo
      .split("\n")
      .filter((l) => /(^|[\s"'=(:])\/\.platformio/.test(l))
      .map((l) => l.trim())
    assert.deepEqual(malas, [], `${archivo} busca /.platformio en la raíz del sistema, que en Unix no existe`)
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// EL PRIMER ESLABÓN: LA VERSIÓN DE PYTHON, FIJADA
// ═══════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ESTÁ ACÁ Y NO EN opencode-version.test.mjs. Python no es una dependencia
// suelta: es el paso 1 de la cadena que termina en PlatformIO (python →
// get-platformio.py → venv → pip install platformio), la que diagnostico.ps1
// documenta como «en cuál de los cuatro pasos se cortó». Fijar Python es parte de
// que PlatformIO quede reproducible, así que se prueba junto a PlatformIO.
//
// El ensayo de por qué instalar «la última de hoy» está mal ya estaba escrito en
// bootstrap.ps1 —para OpenCode— y se resolvió con install/OPENCODE_VERSION +
// `scoop hold`. Al bloque de Python nunca se le aplicó: seguía haciendo
// `scoop install python` a secas.

const PIN_PYTHON = leerRepo("install", "PYTHON_VERSION")
const BOOTSTRAP_PS1 = sinComentarios(leerRepo("install", "bootstrap.ps1"))

test("install/PYTHON_VERSION existe y es una versión semántica, con salto de línea final", () => {
  assert.match(PIN_PYTHON, /^\d+\.\d+\.\d+\n$/, `el archivo dice ${JSON.stringify(PIN_PYTHON)}`)
})

test("bootstrap.ps1 lee la versión de install/PYTHON_VERSION, relativo a sí mismo", () => {
  assert.match(BOOTSTRAP_PS1, /Join-Path \$PSScriptRoot "PYTHON_VERSION"/, "no lee install\\PYTHON_VERSION al lado del script")
  assert.doesNotMatch(BOOTSTRAP_PS1, /\$PythonVersion\s*=\s*"\d+\.\d+\.\d+"/, "la versión está hardcodeada en el .ps1")
  assert.doesNotMatch(
    BOOTSTRAP_PS1,
    new RegExp(PIN_PYTHON.trim().replace(/\./g, "\\.")),
    `la versión ${PIN_PYTHON.trim()} aparece escrita a mano en bootstrap.ps1: la fuente es install/PYTHON_VERSION`,
  )
  assert.match(BOOTSTRAP_PS1, /\$PythonVersion -notmatch '\^\\d\+\\\.\\d\+\\\.\\d\+\$'/, "no valida la forma de la versión leída")
})

test("bootstrap.ps1 instala Python FIJANDO la versión, nunca 'la última'", () => {
  assert.match(
    BOOTSTRAP_PS1,
    /scoop install python@\$PythonVersion/,
    "no hay `scoop install python@$PythonVersion`: cada PC se lleva la que sea la última ESE DÍA",
  )
  // La ÚNICA forma sin versión permitida es la caída con gracia (test de abajo), y
  // tiene que venir DESPUÉS de la fijada. Si alguien vuelve a poner el comando
  // pelado como camino principal, acá se pone rojo.
  const sueltos = [...BOOTSTRAP_PS1.matchAll(/scoop install python(?!@)/g)]
  assert.equal(
    sueltos.length,
    1,
    `hay ${sueltos.length} \`scoop install python\` sin versión; sólo puede haber uno, el de la caída con gracia`,
  )
  assert.ok(
    sueltos[0].index > BOOTSTRAP_PS1.indexOf("scoop install python@"),
    "el `scoop install python` sin versión está ANTES del fijado: entonces es el camino principal, no la caída",
  )
})

test("bootstrap.ps1 deja Python fijado con `scoop hold python`", () => {
  const holds = BOOTSTRAP_PS1.split("\n").filter((l) => !/Write-Host/.test(l) && /scoop hold python/.test(l))
  assert.ok(holds.length >= 1, "sin `scoop hold python`, `scoop update *` cambia la versión y se pierde el pin")
})

test("si la versión fijada de Python no se puede instalar, se degrada con gracia en vez de abortar", () => {
  // Fijar una versión que el bucket no resuelva no rompe UNA instalación: rompe
  // TODAS a la vez, en toda la escuela, el mismo día. La caída tiene que existir.
  const fn = BOOTSTRAP_PS1.slice(BOOTSTRAP_PS1.indexOf("function Instalar-Python"))
  const cuerpo = fn.slice(0, fn.indexOf("\n}\n") + 2)
  assert.ok(cuerpo.length > 0, "no existe la función Instalar-Python")
  assert.match(cuerpo, /scoop install python(?!@)/, "no hay caída a `scoop install python` sin fijar si la fijada falla")
  assert.doesNotMatch(cuerpo, /exit 1/, "quedarse sin aula por una versión que no está en el bucket es peor que no fijarla")
  assert.match(cuerpo, /already installed/, "trata el 'already installed' de Scoop como una falla, y es el caso normal al re-correr Reparar")
  assert.match(cuerpo, /\[!\]/, "se cae a la versión sin fijar sin dejar ni un aviso en el log")
})

// ── `scoop\shims\python.exe` NO EXISTE. NUNCA EXISTIÓ. ─────────────────────
//
// Hubo una versión de bootstrap.ps1 que corría `scoop reset python` cuando faltaba
// `scoop\shims\python.exe` teniendo la app, con la teoría de que Scoop había
// abortado antes de crear el shim (el modo de falla que SÍ tiene OpenCode). Era un
// falso positivo, y lo corrigió una medición en la VM Windows 10 sobre una
// instalación SANA:
//
//     scoop\shims\python.exe                -> False
//     scoop\shims\python3.exe               -> True
//     scoop\apps\python\current\python.exe  -> True
//
// El manifest `main/bucket/python.json` declara
// `bin: [["python.exe","python3"], "Lib\idlelib\idle.bat", ...]`, y en Scoop
// `["archivo","nombre"]` significa «shimeá ESE archivo CON ESE nombre»: el único
// shim que sale de ahí se llama `python3.exe`. Así que aquella condición era
// verdadera SIEMPRE: el reset corría en cada instalación sin arreglar nada.
//
// Estos dos tests existen para que esa condición no vuelva.

/** El cuerpo de una función de PowerShell, contando llaves desde su apertura. */
function cuerpoFuncion(txt, nombre) {
  const i = txt.indexOf(`function ${nombre}`)
  if (i < 0) return ""
  let nivel = 0
  for (let j = txt.indexOf("{", i); j < txt.length; j++) {
    if (txt[j] === "{") nivel++
    else if (txt[j] === "}" && --nivel === 0) return txt.slice(i, j + 1)
  }
  return txt.slice(i)
}

test("bootstrap.ps1 NO dispara `scoop reset python` por la ausencia de shims\\python.exe", () => {
  // OJO CON LA DIFERENCIA, que es toda la lección de este bug: `Buscar-Python`
  // SIGUE listando `scoop\shims\python.exe` entre sus candidatos, y está bien. Un
  // candidato que no existe simplemente no matchea y se pasa al siguiente — el
  // costo es un Test-Path. Lo que NO se puede hacer es usar su ausencia como
  // SEÑAL de que algo está roto, porque esa ausencia es el estado normal de todas
  // las máquinas y convierte el arreglo en un no-op que corre siempre.
  const reset = cuerpoFuncion(BOOTSTRAP_PS1, "Reparar-ScoopPython")
  assert.ok(reset.length > 0, "no existe la función Reparar-ScoopPython")
  assert.doesNotMatch(
    reset,
    /shims\\python/,
    "el último recurso volvió a mirar scoop\\shims\\python.exe: el manifest de Scoop shimea " +
      "python.exe CON EL NOMBRE python3, así que ese archivo no existe en ninguna máquina",
  )
  // Y no puede haber `scoop reset python` en ningún otro lado: ahí es donde vivía
  // el bloque con el disparador falso. Si alguien lo devuelve, esto se pone rojo.
  const resets = [...BOOTSTRAP_PS1.matchAll(/scoop reset python/g)]
  assert.equal(resets.length, 1, `hay ${resets.length} \`scoop reset python\`; sólo puede haber uno, el de Reparar-ScoopPython`)
  assert.ok(
    resets[0].index > BOOTSTRAP_PS1.indexOf("function Reparar-ScoopPython") &&
      resets[0].index < BOOTSTRAP_PS1.indexOf("function Reparar-ScoopPython") + reset.length,
    "hay un `scoop reset python` fuera de Reparar-ScoopPython: volvió el disparador que corría en cada instalación",
  )
  assert.doesNotMatch(
    cuerpoFuncion(BOOTSTRAP_PS1, "Instalar-Python"),
    /scoop reset/,
    "Instalar-Python volvió a resetear por su cuenta, sin saber si falta Python de verdad",
  )
})

test("el `scoop reset python` se dispara sólo si Buscar-Python no encontró nada", () => {
  // Ese es el único síntoma real de que algo está mal. Después del reset se vuelve
  // a preguntar UNA vez; si sigue sin aparecer, gana el mensaje que ya existía.
  const fn = BOOTSTRAP_PS1.slice(BOOTSTRAP_PS1.indexOf("function Reparar-ScoopPython"))
  const cuerpo = fn.slice(0, fn.indexOf("\n}\n") + 2)
  assert.ok(cuerpo.length > 0, "no existe la función Reparar-ScoopPython")
  assert.match(cuerpo, /scoop reset python/, "el último recurso no rehace lo que Scoop administra")
  assert.match(
    BOOTSTRAP_PS1,
    /if \(-not \$PyExe\) \{ Reparar-ScoopPython;[^\n]*\$PyExe = Buscar-Python \}/,
    "el reset no está guardado por «Buscar-Python no encontró nada», o no vuelve a preguntar después",
  )
  // Y el mensaje final sigue siendo el último recurso, no el reset.
  assert.match(BOOTSTRAP_PS1, /No hay un Python usable en esta maquina/, "se perdió el mensaje que explica el señuelo de la Store")
})

test("diagnostico.ps1 detecta el Python de Scoop por python3.exe o por la app, no por un shim inexistente", () => {
  // SE RESUELVEN LAS RUTAS QUE MIRA EL RENGLÓN, no los nombres de las variables ni
  // las etiquetas que imprime. Una primera versión de este test comparaba contra el
  // texto «OK (shims\python3.exe)» que se muestra en pantalla: cambiando la RUTA y
  // dejando la etiqueta, el test seguía verde con el bug adentro. Lo cazó una
  // mutación. Es la misma técnica que usa scripts-soporte.test.mjs con
  // Start-Transcript: se captura el nombre de la variable y se va a buscar qué le
  // asignaron.
  const codigo = sinComentarios(DIAGNOSTICO)
  const lineas = codigo.split("\n")
  const linea = lineas.find((l) => /Dato "1\. python \(scoop\)"/.test(l))
  assert.ok(linea, "se perdió el renglón «1. python (scoop)» de la cadena de PlatformIO")

  // Todo lo que el renglón somete a Test-Path: rutas literales y variables.
  const rutas = []
  for (const m of linea.matchAll(/Test-Path\s+("(?:[^"\\]|\\.)*"|\$(\w+))/g)) {
    if (!m[2]) { rutas.push(m[1]); continue }
    const asignacion = lineas.find((l) => new RegExp(`^\\s*\\$${m[2]}\\s*=`).test(l))
    assert.ok(asignacion, `el renglón usa $${m[2]} y no encontré dónde se le asigna la ruta`)
    rutas.push(asignacion)
  }
  const miradas = rutas.join(" | ")
  assert.ok(rutas.length >= 2, `el renglón sólo mira ${rutas.length} ruta(s): ${miradas}`)

  assert.doesNotMatch(
    miradas,
    /shims\\python\.exe/,
    `sigue mirando scoop\\shims\\python.exe, que da False en TODAS las máquinas porque el manifest ` +
      `de Scoop shimea python.exe CON EL NOMBRE python3: el diagnóstico viene informando ` +
      `«OK (otro python)» sobre instalaciones de Scoop sanas.\nMira: ${miradas}`,
  )
  assert.match(miradas, /shims\\python3\.exe/, `no mira scoop\\shims\\python3.exe, que es el shim que SÍ existe.\nMira: ${miradas}`)
  assert.match(
    miradas,
    /apps\\python\\current\\python\.exe/,
    `no mira scoop\\apps\\python\\current\\python.exe, el binario real de la app.\nMira: ${miradas}`,
  )
})

test("el TODO de WindowsApps queda anotado: se dejó fuera de alcance, no se olvidó", () => {
  // El `elseif (Get-Command python ...)` de ese mismo renglón NO descarta el señuelo
  // de %LOCALAPPDATA%\Microsoft\WindowsApps, que no es Python real. Quedó fuera de
  // alcance a propósito en la 0.3.78. Un límite sin anotar se convierte en un
  // olvido, así que el comentario tiene que estar y este test lo custodia.
  const i = DIAGNOSTICO.indexOf('Dato "1. python (scoop)"')
  const antes = DIAGNOSTICO.slice(Math.max(0, i - 2000), i)
  assert.match(antes, /TODO/, "se fue el TODO que deja anotado que falta descartar WindowsApps")
  assert.match(antes, /WindowsApps/, "el TODO no dice qué falta")
})

test("el .exe empaqueta install\\PYTHON_VERSION", () => {
  const iss = leerRepo("installer", "tecnia-bot.iss").replace(/^\s*;.*$/gm, "")
  const entero = /Source:\s*"\.\.\\install\\\*";[^\n]*DestDir:\s*"\{app\}\\install"/.test(iss)
  const suelto = /Source:\s*"\.\.\\install\\PYTHON_VERSION"/.test(iss)
  assert.ok(entero || suelto, "el .iss no empaqueta install\\PYTHON_VERSION: el bootstrap del .exe no la va a encontrar")
})

// ═══════════════════════════════════════════════════════════════════════════
// EL FILTRO DEL LOG QUE SE COMIÓ LA CAUSA
// ═══════════════════════════════════════════════════════════════════════════
//
// diagnostico.ps1 filtraba instalacion.log por `[OK]|[X]|[!]|[..]|ERROR|WARN|
// Exception`. La salida cruda de get-platformio.py no matchea NINGUNO de esos
// patrones, así que del reporte de la escuela llegó esto ENTERO:
//
//     [..] Instalando PlatformIO Core (no necesita admin)...
//     WARN  'python' (3.14.7) is already installed.
//     [!] PlatformIO NO quedo instalado.
//
// La causa estaba en el medio y nadie la imprimió, en el archivo cuyo encabezado
// promete «todo lo que hace falta para saber qué pasó».

const DIAGNOSTICO = leerRepo("install", "diagnostico.ps1")
/** El bloque nuevo: desde el marcador de falla hasta el título siguiente. */
const BLOQUE_CRUDO = DIAGNOSTICO.slice(
  DIAGNOSTICO.indexOf("$marcaFalla"),
  DIAGNOSTICO.indexOf('Titulo "Ultimo log del instalador'),
)

test("diagnostico.ps1 imprime la salida CRUDA del instalador de PlatformIO cuando falló", () => {
  assert.ok(BLOQUE_CRUDO.length > 0, "no existe el bloque crudo: el filtro se sigue comiendo la causa")
  assert.match(BLOQUE_CRUDO, /sin filtrar/i, "el bloque no se anuncia como salida sin filtrar")
  assert.match(BLOQUE_CRUDO, /Instalando PlatformIO Core/, "no arranca desde donde empezó la instalación de PlatformIO")
})

test("el bloque crudo SÓLO aparece si el log dice que PlatformIO falló", () => {
  // Cuando anduvo bien no hay nada que investigar, y un reporte largo no se lee.
  assert.match(BLOQUE_CRUDO, /PlatformIO NO quedo instalado/, "el marcador de falla no es el que dispara el bloque")
  const iGuarda = BLOQUE_CRUDO.indexOf("if ($fin -ge 0)")
  const iTitulo = BLOQUE_CRUDO.indexOf("sin filtrar")
  assert.ok(iGuarda > 0 && iGuarda < iTitulo, "el bloque se imprime fuera del `if ($fin -ge 0)`: ensucia todo reporte sano")
})

test("el bloque crudo tiene tope de líneas y DICE cuántas omitió", () => {
  // Cortar en silencio es la misma falla que filtrar: el que lee no sabe que le
  // falta algo.
  assert.match(BLOQUE_CRUDO, /-gt 40/, "no hay tope de líneas: un traceback largo tapa el resto del reporte")
  assert.match(BLOQUE_CRUDO, /se omitieron/i, "corta líneas en silencio")
})

test("el bloque crudo tapa las credenciales ANTES de imprimirlas", () => {
  // Este reporte se manda por WhatsApp. Si la escuela usa un índice de paquetes
  // interno, pip escribe la URL entera, y esas URLs se configuran como
  // https://usuario:clave@host/simple. Mismo criterio que el proxy de más arriba:
  // el host sirve para diagnosticar, la credencial no agrega nada.
  const iForeach = BLOQUE_CRUDO.indexOf("foreach ($linea in $crudo)")
  assert.ok(iForeach > 0, "no encontré el bucle que imprime las líneas crudas")
  const cuerpo = BLOQUE_CRUDO.slice(iForeach)
  const tapa = cuerpo.indexOf("[regex]::Replace")
  const imprime = cuerpo.indexOf("Write-Host")
  assert.ok(tapa > 0, "las líneas crudas se imprimen sin tapar el usuario:clave que pueda traer una URL de índice")
  assert.ok(tapa < imprime, "se tapa la credencial DESPUÉS de imprimirla, que es igual a no taparla")
  assert.match(cuerpo, /USUARIO:CLAVE/, "no usa el mismo reemplazo que el bloque del proxy")
})

test("el bloque crudo trunca las líneas largas como el log de OpenCode", () => {
  assert.match(BLOQUE_CRUDO, /-gt 300/, "no trunca las líneas largas: un stack tapa el resto del reporte")
})
