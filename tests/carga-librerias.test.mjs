// `opencode/carga/librerias.ts`: la auditoría de las librerías del proyecto (decisión ND-2).
//
// LO QUE SE FIJA:
//   - en `lib/*/`, todo manifiesto que ejecute o inyecte flags → `LIBRERIA_NO_ADMITIDA`;
//   - en `.pio/libdeps/<env>/*/`, lo mismo, salvo un `build.extraScript` que figure en la
//     lista de scripts admitidos por nombre + versión + sha256 — y esa lista NACE VACÍA;
//   - PRIMERA COMPILACIÓN: un `lib_deps` declarado y no bajado es un rechazo (fallo
//     cerrado), igual que una dependencia de una librería que no está bajada;
//   - los enlaces simbólicos no se siguen: se rechazan.
//
// Acá no se corre ninguna librería ni se lanza `pio`: son carpetas temporales con
// manifiestos escritos a mano, con la forma de los que deja PlatformIO (`.piopm` copiado
// de una instalación real de `madhephaestus/ESP32Servo`).

import { test, after } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const lib = await import(join(REPO, "opencode/carga/librerias.ts"))

const RAIZ = mkdtempSync(join(tmpdir(), "tb-carga-librerias-"))
after(() => rmSync(RAIZ, { recursive: true, force: true }))

let n = 0
/** Un proyecto con su ini. `libDeps`: lo que declara el environment `uno`. */
function proyecto(libDeps = []) {
  const d = join(RAIZ, `p${++n}`)
  mkdirSync(join(d, "src"), { recursive: true })
  const deps = libDeps.length > 0 ? `lib_deps =\n${libDeps.map((x) => `    ${x}`).join("\n")}\n` : ""
  writeFileSync(join(d, "platformio.ini"), `[env:uno]\nplatform = atmelavr@5.2.0\nboard = uno\nframework = arduino\n${deps}`)
  writeFileSync(join(d, "src", "main.cpp"), "void setup(){}\nvoid loop(){}\n")
  return d
}

/** Escribe archivos (ruta relativa → contenido; un objeto se guarda como JSON). */
function escribir(base, archivos) {
  for (const [rel, contenido] of Object.entries(archivos)) {
    mkdirSync(dirname(join(base, rel)), { recursive: true })
    writeFileSync(join(base, rel), typeof contenido === "string" ? contenido : JSON.stringify(contenido))
  }
}

/** Una librería bajada, con el `.piopm` que deja el gestor de paquetes. */
function bajada(d, carpeta, { dueno, nombre = carpeta, version = "1.0.0", archivos = {} } = {}) {
  const dir = join(d, ".pio", "libdeps", "uno", carpeta)
  escribir(dir, {
    ".piopm": { type: "library", name: nombre, version, spec: { owner: dueno, id: 1, name: nombre, requirements: null, uri: null } },
    "library.properties": `name=${nombre}\nversion=${version}\n`,
    "src/x.h": "// vacío\n",
    ...archivos,
  })
  return dir
}

function rechaza(d, motivo, libreria) {
  const r = lib.auditarLibrerias(d, "uno")
  assert.equal(r.ok, false, "tenía que rechazar")
  assert.equal(r.codigo, "LIBRERIA_NO_ADMITIDA")
  const hallado = r.rechazos.find((x) => x.motivo === motivo && (libreria === undefined || x.libreria === libreria))
  assert.ok(hallado, `esperaba ${motivo}${libreria ? ` en ${libreria}` : ""}: ${JSON.stringify(r.rechazos)}`)
  return r
}

const sha = (s) => createHash("sha256").update(s).digest("hex")

// ── La lista de scripts admitidos ────────────────────────────────────────────────────────

test("ND-2: la lista de scripts admitidos NACE VACÍA y está congelada", () => {
  assert.deepEqual([...lib.LIBRERIAS_CON_SCRIPT_ADMITIDAS], [], "si esto cambió, alguien habilitó un script: tiene que haber una decisión del owner con nombre, versión y hash")
  assert.ok(Object.isFrozen(lib.LIBRERIAS_CON_SCRIPT_ADMITIDAS))
})

// ── Proyectos sanos ──────────────────────────────────────────────────────────────────────

test("un proyecto sin lib/ ni lib_deps pasa; con una librería propia sin manifiesto raro, también", () => {
  assert.deepEqual(lib.auditarLibrerias(proyecto(), "uno"), { ok: true, librerias: [] })
  const d = proyecto()
  escribir(join(d, "lib"), { README: "carpeta de librerías", "Zumbador/Zumbador.h": "class Zumbador {};\n", "Zumbador/library.json": { name: "Zumbador", version: "0.1.0", build: { libArchive: false, srcFilter: "+<*>" } } })
  assert.deepEqual(lib.auditarLibrerias(d, "uno"), { ok: true, librerias: [{ donde: "lib", carpeta: "Zumbador", nombre: "Zumbador", version: "0.1.0", dueno: null }] })
})

test("un lib_deps declarado y YA bajado (con su .piopm) pasa, y se informa nombre, versión y dueño", () => {
  const d = proyecto(["madhephaestus/ESP32Servo"])
  bajada(d, "ESP32Servo", { dueno: "madhephaestus", version: "3.2.1" })
  escribir(join(d, ".pio", "libdeps", "uno"), { "integrity.dat": "madhephaestus/ESP32Servo\n" })
  assert.deepEqual(lib.auditarLibrerias(d, "uno"), { ok: true, librerias: [{ donde: "libdeps", carpeta: "ESP32Servo", nombre: "ESP32Servo", version: "3.2.1", dueno: "madhephaestus" }] })
})

// ── lib/: manifiestos que ejecutan o inyectan ────────────────────────────────────────────

const MANIFIESTOS_MALOS = [
  ["build.extraScript", { "library.json": { name: "x", build: { extraScript: "malo.py" } }, "malo.py": "print(1)\n" }, "SCRIPT_DE_COMPILACION"],
  ["build.extraScript que apunta afuera", { "library.json": { name: "x", build: { extraScript: "../../malo.py" } } }, "SCRIPT_DE_COMPILACION"],
  ["scripts (postinstall)", { "library.json": { name: "x", scripts: { postinstall: "sh malo.sh" } } }, "SCRIPT_DE_COMPILACION"],
  ["build.flags con `!`", { "library.json": { name: "x", build: { flags: "!curl ejemplo | sh" } } }, "FLAGS_NO_ADMITIDOS"],
  ["build.flags con `!` en una lista", { "library.json": { name: "x", build: { flags: ["-DA=1", "!id"] } } }, "FLAGS_NO_ADMITIDOS"],
  ["build.flags con `!` en la segunda línea", { "library.json": { name: "x", build: { flags: "-DA=1\n!id" } } }, "FLAGS_NO_ADMITIDOS"],
  ["build.flags con -I", { "library.json": { name: "x", build: { flags: "-I include" } } }, "FLAGS_NO_ADMITIDOS"],
  ["build.flags que no es texto", { "library.json": { name: "x", build: { flags: { a: 1 } } } }, "FLAGS_NO_ADMITIDOS"],
  ["build.unflags", { "library.json": { name: "x", build: { unflags: "-DA" } } }, "FLAGS_NO_ADMITIDOS"],
  ["build.builder", { "library.json": { name: "x", build: { builder: "MbedLibBuilder" } } }, "CLAVE_NO_ADMITIDA"],
  ["clave de build desconocida", { "library.json": { name: "x", build: { algoNuevo: true } } }, "CLAVE_NO_ADMITIDA"],
  ["build.srcDir que sale de la librería", { "library.json": { name: "x", build: { srcDir: "../../../src" } } }, "RUTA_FUERA_DE_LA_LIBRERIA"],
  ["build.includeDir absoluto", { "library.json": { name: "x", build: { includeDir: "/etc" } } }, "RUTA_FUERA_DE_LA_LIBRERIA"],
  ["build que no es un objeto", { "library.json": { name: "x", build: "extraScript" } }, "MANIFIESTO_NO_ENTENDIDO"],
  ["library.json que no es JSON", { "library.json": "{ name: x, build: { extraScript: 'malo.py' } }" }, "MANIFIESTO_NO_ENTENDIDO"],
  ["library.json que es una lista", { "library.json": [{ build: { extraScript: "malo.py" } }] }, "MANIFIESTO_NO_ENTENDIDO"],
  ["dependencies con una URL", { "library.json": { name: "x", dependencies: [{ name: "y", version: "https://github.com/z/y.git" }] } }, "DEPENDENCIA_SIN_DESCARGAR"],
  ["dependencies con forma rara", { "library.json": { name: "x", dependencies: "y" } }, "MANIFIESTO_NO_ENTENDIDO"],
  ["library.properties con ldflags", { "library.properties": "name=x\nldflags=!id\n" }, "FLAGS_NO_ADMITIDOS"],
  ["library.properties con precompiled", { "library.properties": "name=x\nprecompiled=true\n" }, "CLAVE_NO_ADMITIDA"],
  ["library.properties con precompiled=full", { "library.properties": "name=x\nPrecompiled = full\n" }, "CLAVE_NO_ADMITIDA"],
  ["module.json (mbed)", { "module.json": { name: "x", extraIncludes: ["../.."] } }, "CLAVE_NO_ADMITIDA"],
]

for (const [nombre, archivos, motivo] of MANIFIESTOS_MALOS) {
  test(`lib/ del proyecto: ${nombre} → LIBRERIA_NO_ADMITIDA (${motivo})`, () => {
    const d = proyecto()
    escribir(join(d, "lib", "Mala"), { "Mala.h": "// nada\n", ...archivos })
    rechaza(d, motivo, "Mala")
  })
  test(`.pio/libdeps bajada: ${nombre} → LIBRERIA_NO_ADMITIDA (${motivo})`, () => {
    const d = proyecto(["alguien/Mala"])
    bajada(d, "Mala", { dueno: "alguien", archivos })
    rechaza(d, motivo, "Mala")
  })
}

test("build.flags que SÍ entra en la gramática cerrada (`-D`) se admite; es la única forma", () => {
  const d = proyecto()
  escribir(join(d, "lib", "Buena"), { "library.json": { name: "Buena", build: { flags: ["-DBUENA_MODO=2", "-D BUENA_DEBUG"] } } })
  assert.equal(lib.auditarLibrerias(d, "uno").ok, true)
})

test("un manifiesto que no se puede leer (carpeta con ese nombre, UTF-8 inválido) es un rechazo, no un 'no hay manifiesto'", () => {
  const d = proyecto()
  mkdirSync(join(d, "lib", "Rara", "library.json"), { recursive: true })
  rechaza(d, "MANIFIESTO_NO_ENTENDIDO", "Rara")
  const e = proyecto()
  mkdirSync(join(e, "lib", "Rara"), { recursive: true })
  writeFileSync(join(e, "lib", "Rara", "library.properties"), Buffer.from([0x6e, 0x61, 0xff, 0xfe, 0x0a]))
  rechaza(e, "MANIFIESTO_NO_ENTENDIDO", "Rara")
})

// ── La lista de scripts admitidos: el mecanismo ──────────────────────────────────────────

test("extraScript de una librería BAJADA: sólo pasa con nombre + versión + sha256 exactos en la lista; en lib/ no pasa nunca", () => {
  const script = "Import('env')\n"
  const armar = () => {
    const d = proyecto(["alguien/ConScript"])
    bajada(d, "ConScript", { dueno: "alguien", version: "2.0.0", archivos: { "library.json": { name: "ConScript", version: "2.0.0", build: { extraScript: "tools/pre.py" } }, "tools/pre.py": script } })
    return d
  }
  const entrada = { nombre: "ConScript", version: "2.0.0", sha256: sha(script) }
  // Con la lista del producto (vacía): rechazo.
  rechaza(armar(), "SCRIPT_DE_COMPILACION", "ConScript")
  // Con la entrada exacta: pasa.
  assert.equal(lib.auditarLibreriasCon(armar(), "uno", [entrada]).ok, true)
  // Con cualquier diferencia: rechazo.
  for (const otra of [{ ...entrada, sha256: sha("otro script") }, { ...entrada, version: "2.0.1" }, { ...entrada, nombre: "Conscript" }, { ...entrada, nombre: "OtraLib" }]) {
    assert.equal(lib.auditarLibreriasCon(armar(), "uno", [otra]).ok, false, JSON.stringify(otra))
  }
  // La identidad sale de `.piopm`, no de lo que la librería dice de sí misma en su library.json.
  const disfrazada = proyecto(["alguien/Impostora"])
  bajada(disfrazada, "Impostora", { dueno: "alguien", version: "9.9.9", archivos: { "library.json": { name: "ConScript", version: "2.0.0", build: { extraScript: "tools/pre.py" } }, "tools/pre.py": script } })
  assert.equal(lib.auditarLibreriasCon(disfrazada, "uno", [entrada]).ok, false, "se hizo pasar por otra con su library.json")
  // El script tiene que estar ADENTRO de la librería: uno de afuera no pasa aunque su hash esté en la lista.
  const deAfuera = proyecto(["alguien/ConScript"])
  bajada(deAfuera, "ConScript", { dueno: "alguien", version: "2.0.0", archivos: { "library.json": { name: "ConScript", version: "2.0.0", build: { extraScript: "../pre.py" } } } })
  writeFileSync(join(deAfuera, ".pio", "libdeps", "uno", "pre.py"), script)
  assert.equal(lib.auditarLibreriasCon(deAfuera, "uno", [entrada]).ok, false, "admitió un script de fuera de la librería")
  // Sin `.piopm` no hay identidad: no pasa aunque el hash coincida.
  const sinPiopm = proyecto()
  escribir(join(sinPiopm, ".pio", "libdeps", "uno", "ConScript"), { "library.json": { name: "ConScript", version: "2.0.0", build: { extraScript: "tools/pre.py" } }, "tools/pre.py": script })
  assert.equal(lib.auditarLibreriasCon(sinPiopm, "uno", [entrada]).ok, false)
  // La misma librería en lib/ del proyecto: ND-2 dice rechazar siempre.
  const enLib = proyecto()
  escribir(join(enLib, "lib", "ConScript"), { ".piopm": { type: "library", name: "ConScript", version: "2.0.0", spec: { owner: "alguien", name: "ConScript" } }, "library.json": { name: "ConScript", version: "2.0.0", build: { extraScript: "tools/pre.py" } }, "tools/pre.py": script })
  assert.equal(lib.auditarLibreriasCon(enLib, "uno", [entrada]).ok, false, "la lista no vale para lib/")
})

// ── Primera compilación: lo declarado tiene que estar bajado ─────────────────────────────

test("PRIMERA COMPILACIÓN: lib_deps declarado y sin bajar → LIBRERIA_NO_ADMITIDA (pio run lo bajaría y lo ejecutaría en la misma corrida)", () => {
  const d = proyecto(["madhephaestus/ESP32Servo"])
  const r = rechaza(d, "LIB_DEPS_SIN_DESCARGAR", "madhephaestus/ESP32Servo")
  assert.equal(r.rechazos.length, 1)
  assert.equal(r.rechazos[0].donde, "proyecto")
  // Bajada para OTRO environment no cuenta.
  const e = proyecto(["madhephaestus/ESP32Servo"])
  escribir(join(e, ".pio", "libdeps", "esp32dev", "ESP32Servo"), { ".piopm": { type: "library", name: "ESP32Servo", version: "3.2.1", spec: { owner: "madhephaestus", name: "ESP32Servo" } } })
  rechaza(e, "LIB_DEPS_SIN_DESCARGAR")
})

test("PRIMERA COMPILACIÓN: una de dos sin bajar, otro dueño, o una carpeta con ese nombre pero sin .piopm → rechazo", () => {
  const d = proyecto(["madhephaestus/ESP32Servo", "adafruit/DHT sensor library"])
  bajada(d, "ESP32Servo", { dueno: "madhephaestus" })
  assert.deepEqual(rechaza(d, "LIB_DEPS_SIN_DESCARGAR").rechazos.map((x) => x.libreria), ["adafruit/DHT sensor library"])
  const otroDueno = proyecto(["madhephaestus/ESP32Servo"])
  bajada(otroDueno, "ESP32Servo", { dueno: "otra-persona" })
  rechaza(otroDueno, "LIB_DEPS_SIN_DESCARGAR")
  const sinPiopm = proyecto(["madhephaestus/ESP32Servo"])
  escribir(join(sinPiopm, ".pio", "libdeps", "uno", "ESP32Servo"), { "library.properties": "name=ESP32Servo\nversion=3.2.1\n" })
  rechaza(sinPiopm, "LIB_DEPS_SIN_DESCARGAR")
  // El nombre y el dueño no distinguen mayúsculas (el registro tampoco).
  const mayus = proyecto(["MadHephaestus/esp32servo"])
  bajada(mayus, "ESP32Servo", { dueno: "madhephaestus" })
  assert.equal(lib.auditarLibrerias(mayus, "uno").ok, true)
})

test("PRIMERA COMPILACIÓN: la versión bajada tiene que cumplir lo declarado; si no se puede comparar, rechazo", () => {
  const con = (declarada, version) => {
    const d = proyecto([declarada])
    bajada(d, "DHT sensor library", { dueno: "adafruit", version })
    return lib.auditarLibrerias(d, "uno")
  }
  assert.equal(con("adafruit/DHT sensor library@^1.4.4", "1.4.6").ok, true)
  assert.equal(con("adafruit/DHT sensor library@1.4.4", "1.4.4").ok, true)
  assert.equal(con("adafruit/DHT sensor library@~1.4.4", "1.4.9").ok, true)
  for (const [declarada, version] of [["adafruit/DHT sensor library@^1.4.4", "1.4.3"], ["adafruit/DHT sensor library@^1.4.4", "2.0.0"], ["adafruit/DHT sensor library@1.4.4", "1.4.5"], ["adafruit/DHT sensor library@~1.4.4", "1.5.0"], ["adafruit/DHT sensor library@^1.4.4", "1.4.6-beta"], ["adafruit/DHT sensor library@^1.4.4", "main"]]) {
    const r = con(declarada, version)
    assert.equal(r.ok, false, `${declarada} con ${version} bajada`)
    assert.ok(r.rechazos.some((x) => x.motivo === "VERSION_NO_VERIFICABLE"), JSON.stringify(r.rechazos))
  }
})

test("cumpleVersion: sólo dice true o false cuando lo sabe; lo demás es null", () => {
  const casos = [
    ["1.2.3", "*", true], ["1.2.3", "", true], ["1.2.3", "1.2.3", true], ["1.2.3", "=1.2.3", true], ["1.2.3", "1.2", false], ["1.2.0", "1.2", true],
    ["1.4.6", "^1.4.4", true], ["1.4.3", "^1.4.4", false], ["2.0.0", "^1.4.4", false], ["0.2.5", "^0.2.3", true], ["0.3.0", "^0.2.3", false], ["0.0.4", "^0.0.3", false], ["0.0.3", "^0.0.3", true],
    ["1.4.9", "~1.4.4", true], ["1.5.0", "~1.4.4", false], ["1.4.3", "~1.4.4", false],
    ["2.0.0", ">=1.4.4", true], ["1.4.4", ">=1.4.4", true], ["1.4.3", ">=1.4.4", false],
    ["1.2.3", ">=1.0, <2.0", null], ["1.2.3", "<2.0", null], ["1.2.3", "https://x/y.git", null], ["1.2.3", "1.x", null], ["1.2.3-beta", "^1.0.0", null], ["main", "*", true], ["main", "^1.0.0", null],
  ]
  for (const [instalada, requisito, esperado] of casos) assert.equal(lib.cumpleVersion(instalada, requisito), esperado, `${instalada} contra ${JSON.stringify(requisito)}`)
})

test("DEPENDENCIAS TRANSITIVAS: lo que una librería declara como dependencia también tiene que estar bajado y en una versión que cumpla", () => {
  // library.properties → depends
  const d = proyecto(["adafruit/DHT sensor library"])
  bajada(d, "DHT sensor library", { dueno: "adafruit", archivos: { "library.properties": "name=DHT sensor library\nversion=1.0.0\ndepends=Adafruit Unified Sensor\n" } })
  assert.deepEqual(rechaza(d, "DEPENDENCIA_SIN_DESCARGAR", "DHT sensor library").rechazos.length, 1)
  bajada(d, "Adafruit Unified Sensor", { dueno: "adafruit", version: "1.1.14" })
  assert.equal(lib.auditarLibrerias(d, "uno").ok, true)

  // library.json → dependencies, como lista y como objeto, con requisito
  for (const dependencies of [[{ owner: "adafruit", name: "Adafruit BusIO", version: "^1.14.0" }], { "adafruit/Adafruit BusIO": "^1.14.0" }]) {
    const p = proyecto(["adafruit/Adafruit SSD1306"])
    bajada(p, "Adafruit SSD1306", { dueno: "adafruit", archivos: { "library.json": { name: "Adafruit SSD1306", dependencies } } })
    rechaza(p, "DEPENDENCIA_SIN_DESCARGAR", "Adafruit SSD1306")
    bajada(p, "Adafruit BusIO", { dueno: "adafruit", version: "1.13.0" })
    rechaza(p, "VERSION_NO_VERIFICABLE", "Adafruit SSD1306")
    bajada(p, "Adafruit BusIO", { dueno: "adafruit", version: "1.16.1" })
    assert.equal(lib.auditarLibrerias(p, "uno").ok, true)
  }

  // Una librería de lib/ del proyecto que declara una dependencia sin bajar.
  const q = proyecto()
  escribir(join(q, "lib", "Propia"), { "library.json": { name: "Propia", dependencies: [{ name: "Servo" }] } })
  rechaza(q, "DEPENDENCIA_SIN_DESCARGAR", "Propia")
})

// ── Enlaces y cosas raras ────────────────────────────────────────────────────────────────

test("ENLACES: un enlace simbólico en lib/, adentro de una librería, en .pio, en libdeps o en libdeps/<env> se rechaza, no se sigue", () => {
  const afuera = join(RAIZ, `afuera-${++n}`)
  escribir(afuera, { "Inocente/Inocente.h": "// nada\n" })

  const a = proyecto()
  mkdirSync(join(a, "lib"))
  symlinkSync(join(afuera, "Inocente"), join(a, "lib", "Inocente"))
  rechaza(a, "ENLACE_SIMBOLICO", "Inocente")

  const b = proyecto()
  escribir(join(b, "lib", "Propia"), { "Propia.h": "// nada\n" })
  symlinkSync(afuera, join(b, "lib", "Propia", "vendor"))
  rechaza(b, "ENLACE_SIMBOLICO", "Propia")

  const c = proyecto()
  symlinkSync(afuera, join(c, "lib"))
  rechaza(c, "ENLACE_SIMBOLICO")

  const d = proyecto(["alguien/Inocente"])
  mkdirSync(join(d, ".pio", "libdeps"), { recursive: true })
  symlinkSync(afuera, join(d, ".pio", "libdeps", "uno"))
  rechaza(d, "ENLACE_SIMBOLICO")

  const e = proyecto()
  mkdirSync(join(e, ".pio"))
  symlinkSync(afuera, join(e, ".pio", "libdeps"))
  rechaza(e, "ENLACE_SIMBOLICO")

  const f = proyecto()
  symlinkSync(afuera, join(f, ".pio"))
  rechaza(f, "ENLACE_SIMBOLICO")

  // Un manifiesto que es un enlace (a un library.json inocente de afuera).
  const g = proyecto()
  escribir(join(g, "lib", "Propia"), { "Propia.h": "// nada\n" })
  escribir(afuera, { "library.json": { name: "Propia" } })
  symlinkSync(join(afuera, "library.json"), join(g, "lib", "Propia", "library.json"))
  rechaza(g, "ENLACE_SIMBOLICO", "Propia")
})

test("una librería con más niveles de carpetas de los que se revisan se rechaza (no se da por buena lo que no se miró)", () => {
  const d = proyecto()
  let ruta = join(d, "lib", "Honda")
  for (let i = 0; i < 20; i++) ruta = join(ruta, `n${i}`)
  mkdirSync(ruta, { recursive: true })
  rechaza(d, "DEMASIADO_GRANDE", "Honda")
})

// ── Precondiciones ───────────────────────────────────────────────────────────────────────

test("si el ini no pasa su propia auditoría, las librerías tampoco: no se le cree a un ini que no se pudo leer", () => {
  const d = proyecto()
  writeFileSync(join(d, "platformio.ini"), "[env:uno]\nboard = uno\nextra_scripts = x.py\n")
  rechaza(d, "INI_NO_ADMITIDO")
  const sinIni = join(RAIZ, `sin-ini-${++n}`)
  mkdirSync(sinIni)
  rechaza(sinIni, "INI_NO_ADMITIDO")
})

test("el environment tiene que existir en el ini y tener forma de nombre: no se audita 'el que venga'", () => {
  const d = proyecto()
  for (const env of ["esp32dev", "", "../uno", "uno/..", undefined, null, 7]) {
    const r = lib.auditarLibrerias(d, env)
    assert.equal(r.ok, false, String(env))
    assert.equal(r.rechazos[0].motivo, "ENVIRONMENT_INVALIDO", String(env))
  }
})

test("ND-2, verificado y no supuesto: el programa que genera el codegen no trae lib/ ni lib_deps, y pasa esta auditoría", async () => {
  const { renderizarPlatformioIni } = await import(join(REPO, "opencode/codegen/platformio-ini.ts"))
  const placas = await import(join(REPO, "opencode/nucleo/placas.ts"))
  const registro = Object.values(placas).find((v) => v && typeof v === "object" && !Array.isArray(v) && Object.values(v).some((p) => p?.backends?.platformio))
  for (const placa of Object.values(registro).filter((p) => p?.backends?.platformio)) {
    const { contenido, environment } = renderizarPlatformioIni(placa)
    assert.doesNotMatch(contenido, /lib_deps|lib_extra_dirs|extra_scripts|build_flags/)
    const d = join(RAIZ, `derivada-${++n}`)
    mkdirSync(join(d, "src"), { recursive: true })
    writeFileSync(join(d, "platformio.ini"), contenido)
    assert.deepEqual(lib.auditarLibrerias(d, environment), { ok: true, librerias: [] })
  }
})
