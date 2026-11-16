// `opencode/carga/fuentes.ts`: ¿el analizador de pines miró TODO lo que PlatformIO va a
// compilar? (hallazgo SEC-02; código `ANALISIS_INCOMPLETO`, CONTRATOS-API §13).
//
// DOS PARTES:
//
// 1. EL HUECO, REPRODUCIDO SOBRE EL COMPORTAMIENTO DE HOY. Se arma un proyecto con un
//    `pinMode(6, OUTPUT)` (flash del ESP32) escondido donde PlatformIO lo compila y el
//    analizador no mira, y se le pregunta a `tool/platformio.ts` REAL. Esos tests afirman
//    lo que hoy pasa —no hay bloqueo, el análisis se dice completo— y están marcados
//    «HUECO VIGENTE». La primera versión de estos tests afirmaba lo que DEBERÍA pasar y
//    quedó roja contra el código de hoy: esa corrida está guardada en la evidencia de la
//    etapa (`evidencia/E2/sec02-rojo/`). Se dejan en verde, afirmando el hueco, porque las
//    tools todavía no llaman a `coberturaDeFuentes` (eso es la Etapa 4): cuando la llamen,
//    estos tests se tienen que poner ROJOS y reescribirse al revés. No son un adorno: son
//    el aviso de que el hueco sigue abierto en el producto.
//
// 2. LA FUNCIÓN QUE LO CIERRA. `coberturaDeFuentes` recibe la lista de archivos que el
//    analizador LEYÓ y la compara contra el disco. Para cada caso del hueco, con la lista
//    que el analizador de hoy leería, tiene que dar `ANALISIS_INCOMPLETO`.

import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const fuentes = await import(join(REPO, "opencode/carga/fuentes.ts"))

const RAIZ = mkdtempSync(join(tmpdir(), "tb-carga-fuentes-"))
after(() => rmSync(RAIZ, { recursive: true, force: true }))

const INI = "[env:esp32dev]\nplatform = espressif32@6.12.0\nboard = esp32dev\nframework = arduino\n"
const SANO = "#include <Arduino.h>\nvoid setup() { pinMode(4, OUTPUT); }\nvoid loop() {}\n"
const MALO = "#include <Arduino.h>\nvoid romper() { pinMode(6, OUTPUT); }\n"

let n = 0
function proyecto(archivos, ini = INI) {
  const d = join(RAIZ, `p${++n}`)
  mkdirSync(d)
  if (ini !== null) writeFileSync(join(d, "platformio.ini"), ini)
  for (const [rel, contenido] of Object.entries(archivos)) {
    mkdirSync(dirname(join(d, rel)), { recursive: true })
    writeFileSync(join(d, rel), contenido)
  }
  return d
}

const cobertura = (cwd, analizados, extra = {}) => fuentes.coberturaDeFuentes({ cwd, iniText: INI, analizados, ...extra })

function incompleto(r, patron) {
  assert.equal(r.ok, false, "tenía que dar ANALISIS_INCOMPLETO")
  assert.equal(r.codigo, "ANALISIS_INCOMPLETO")
  assert.ok(r.motivos.some((m) => patron.test(m)), `ningún motivo coincide con ${patron}: ${JSON.stringify(r.motivos)}`)
}

// ── 1. El hueco, sobre el comportamiento de hoy ──────────────────────────────────────────

let pio
before(async () => {
  // El mismo harness que `tests/pines-codigo.test.mjs`: `platformio.ts` real, con el
  // plugin reemplazado por un doble mínimo (acá no se ejecuta ninguna tool).
  const out = join(RAIZ, "harness")
  mkdirSync(out)
  writeFileSync(join(out, "mock-plugin.ts"), "const nodo = () => { const n = { optional() { return n }, describe() { return n } }; return n }\nexport const tool = (c) => c\ntool.schema = { string: nodo, number: nodo, boolean: nodo, enum: nodo }\n")
  const src = readFileSync(join(REPO, "opencode/tool/platformio.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
    .replaceAll('from "../carga/', `from "${pathToFileURL(join(REPO, "opencode/carga")).href}/`)
  writeFileSync(join(out, "platformio.ts"), src)
  pio = await import(join(out, "platformio.ts"))
})

test("control del instrumento: el analizador de hoy SÍ bloquea un GPIO6 que está en src/main.cpp", () => {
  const d = proyecto({ "src/main.cpp": SANO + MALO })
  const a = pio.analizarProyecto(d)
  assert.ok(a, "sin análisis: el control no mide nada")
  assert.match(String(pio.bloqueoAntesDeCargar(a)), /GPIO6|flash/i, "si esto falla, los tests del hueco de abajo no prueban nada")
})

// [rótulo, archivos, lo que el analizador de hoy leería]
const HUECOS = [
  ["H-a1: src/test/malo.cpp junto a un main sano", { "src/main.cpp": SANO, "src/test/malo.cpp": MALO }, ["src/main.cpp"]],
  ["src/docs/malo.cpp junto a un main sano", { "src/main.cpp": SANO, "src/docs/malo.cpp": MALO }, ["src/main.cpp"]],
  ["src/examples/malo.cpp junto a un main sano", { "src/main.cpp": SANO, "src/examples/malo.cpp": MALO }, ["src/main.cpp"]],
  ["src/malo.c++ junto a un main sano", { "src/main.cpp": SANO, "src/malo.c++": MALO }, ["src/main.cpp"]],
  ["carpeta oculta ANIDADA: src/a/.b/malo.cpp", { "src/main.cpp": SANO, "src/a/ok.cpp": "// nada\n", "src/a/.b/malo.cpp": MALO }, ["src/a/ok.cpp", "src/main.cpp"]],
  ["#include de un archivo con otra extensión: src/datos.inc", { "src/main.cpp": `${SANO}#include "datos.inc"\n`, "src/datos.inc": MALO }, ["src/main.cpp"]],
]

for (const [rotulo, archivos, leidos] of HUECOS) {
  test(`HUECO VIGENTE (SEC-02): ${rotulo} — hoy el analizador no lo ve: ni bloqueo ni análisis incompleto`, () => {
    const d = proyecto(archivos)
    const a = pio.analizarProyecto(d)
    assert.ok(a, "esperaba un análisis")
    // Cuando la Etapa 4 integre `coberturaDeFuentes`, estas dos aserciones se ponen rojas.
    assert.equal(pio.bloqueoAntesDeCargar(a), null, "el producto ya frena este caso: hay que reescribir este test al revés")
    assert.deepEqual(a.incompleto, [], "el producto ya marca incompleto este caso: hay que reescribir este test al revés")
  })

  test(`CIERRE (SEC-02): ${rotulo} — coberturaDeFuentes da ANALISIS_INCOMPLETO con lo que el analizador leyó`, () => {
    const d = proyecto(archivos)
    incompleto(cobertura(d, leidos), /malo|datos\.inc/)
  })
}

test("HUECO VIGENTE (SEC-02a): todo el código en src/docs o en un .c++ → hoy el análisis es null, y null hoy no frena nada", () => {
  for (const archivos of [{ "src/docs/main.cpp": SANO + MALO }, { "src/main.c++": SANO + MALO }]) {
    const d = proyecto(archivos)
    assert.equal(pio.analizarProyecto(d), null)
    assert.equal(pio.bloqueoAntesDeCargar(null), null, "el producto ya frena un análisis null: hay que reescribir este test al revés")
    incompleto(cobertura(d, null), /no hay análisis/)
    incompleto(cobertura(d, []), /se compila y el analizador no lo leyó/)
  }
})

// ── 2. La función ────────────────────────────────────────────────────────────────────────

test("un proyecto que el analizador leyó entero está cubierto, y se informa qué se compila", () => {
  const d = proyecto({ "src/main.cpp": `${SANO}#include "pines.h"\n#include <Servo.h>\n`, "src/motor.c": "// c\n", "src/sketch.ino": "// ino\n", "include/pines.h": "#define LED 4\n", "lib/Zumbador/Zumbador.cpp": '#include "Zumbador.h"\n', "lib/Zumbador/Zumbador.h": "// h\n", "lib/README": "texto", "README.md": "# hola" })
  const leidos = ["src/main.cpp", "src/motor.c", "src/sketch.ino", "include/pines.h", "lib/Zumbador/Zumbador.cpp", "lib/Zumbador/Zumbador.h"]
  assert.deepEqual(cobertura(d, leidos), { ok: true, compilables: ["lib/Zumbador/Zumbador.cpp", "src/main.cpp", "src/motor.c", "src/sketch.ino"] })
  // Con `\` de Windows y `./` adelante es la misma lista.
  assert.equal(cobertura(d, leidos.map((r) => `.\\${r.replace(/\//g, "\\")}`)).ok, true)
  // Un archivo que no se compila ni se incluye (README) no molesta.
})

test("sin análisis, o con un análisis que se declaró incompleto → ANALISIS_INCOMPLETO", () => {
  const d = proyecto({ "src/main.cpp": SANO })
  incompleto(cobertura(d, null), /no hay análisis/)
  incompleto(cobertura(d, ["src/main.cpp"], { incompleto: ["lib/Rota (link a una carpeta)"] }), /lib\/Rota/)
  assert.equal(cobertura(d, ["src/main.cpp"], { incompleto: [] }).ok, true)
})

test("cada extensión que PlatformIO compila y cada sketch tiene que estar entre los leídos (también en mayúsculas)", () => {
  for (const nombre of ["x.c", "x.cc", "x.cpp", "x.cxx", "x.c++", "x.ino", "x.pde", "X.CPP", "x.Cpp", "x.INO"]) {
    const d = proyecto({ "src/main.cpp": SANO, [`src/${nombre}`]: MALO })
    incompleto(cobertura(d, ["src/main.cpp"]), /se compila y el analizador no lo leyó/)
    assert.equal(cobertura(d, ["src/main.cpp", `src/${nombre}`]).ok, true, nombre)
  }
})

test("ensamblador: se compila y no se puede analizar → incompleto aunque esté 'leído'", () => {
  for (const nombre of ["x.S", "x.s", "x.sx", "x.spp", "x.SPP", "x.asm", "x.ASM"]) {
    const d = proyecto({ "src/main.cpp": SANO, [`src/${nombre}`]: "sbi 0x05, 5\n" })
    incompleto(cobertura(d, ["src/main.cpp", `src/${nombre}`]), /ensamblador/)
  }
})

test("no importa en qué carpeta esté ni cuán escondido: include/, lib/, carpetas con punto, .git", () => {
  for (const rel of ["include/malo.cpp", "lib/Propia/malo.cpp", "lib/Propia/examples/malo.cpp", "src/.oculto/malo.cpp", "src/a/b/c/d/malo.cpp", "src/.git/malo.cpp"]) {
    const d = proyecto({ "src/main.cpp": SANO, [rel]: MALO })
    incompleto(cobertura(d, ["src/main.cpp"]), /malo\.cpp se compila/)
  }
})

test("#include: lo que se incluye tiene que estar leído — con comillas, con <>, con ruta, partido con `\\`, con `%:`, detrás de un comentario", () => {
  const formas = [
    '#include "datos.inc"',
    "#include <datos.inc>",
    '#include "sub/datos.inc"',
    '#  include   "datos.inc"',
    '\t#include "datos.inc"',
    '#inc\\\nlude "datos.inc"',
    '%:include "datos.inc"',
    '/* */ #include "datos.inc"',
    '# /* a */ include "datos.inc"',
    '#include_next "datos.inc"',
    '#import "datos.inc"',
    'int x; /* fin */ #include "datos.inc"',
  ]
  for (const forma of formas) {
    const d = proyecto({ "src/main.cpp": `${SANO}${forma}\n`, "src/sub/datos.inc": MALO })
    incompleto(cobertura(d, ["src/main.cpp"]), /incluye .*datos\.inc/)
    assert.equal(cobertura(d, ["src/main.cpp", "src/sub/datos.inc"]).ok, true, `leído, tenía que pasar: ${forma}`)
  }
  // Un include de algo que NO está en el proyecto (del framework) no molesta.
  const d = proyecto({ "src/main.cpp": `${SANO}#include <Wire.h>\n#include "no_esta.h"\n` })
  assert.equal(cobertura(d, ["src/main.cpp"]).ok, true)
})

test("#include transitivo: el include está en una cabecera que sí se leyó", () => {
  const d = proyecto({ "src/main.cpp": `${SANO}#include "a.h"\n`, "include/a.h": '#include "b.txt"\n', "include/b.txt": MALO })
  incompleto(cobertura(d, ["src/main.cpp", "include/a.h"]), /include\/a\.h incluye b\.txt/)
})

test("#include armado con una macro → incompleto (no se sabe qué archivo es)", () => {
  for (const forma of ["#define X \"datos.inc\"\n#include X", "#include MI_CABECERA", "#include /* c */ \"datos.inc\""]) {
    const d = proyecto({ "src/main.cpp": `${SANO}${forma}\n` })
    incompleto(cobertura(d, ["src/main.cpp"]), /no nombra un archivo/)
  }
})

test("includesDe: qué archivos nombra un texto", () => {
  assert.deepEqual(fuentes.includesDe('#include <Arduino.h>\n#include "a/b.h" // nota\n  #  include "c.h"\nint include = 1;\n// #include "comentado.h"\n'), ["Arduino.h", "a/b.h", "c.h", "comentado.h"])
  assert.deepEqual(fuentes.includesDe("#include X\n"), [null])
  assert.deepEqual(fuentes.includesDe("int x = 1;\n#define includeme 2\n"), [])
})

test("enlaces simbólicos y raíces raras: no se siguen, se declara incompleto", () => {
  const afuera = proyecto({ "malo.cpp": MALO })
  const a = proyecto({ "src/main.cpp": SANO })
  symlinkSync(join(afuera, "malo.cpp"), join(a, "src", "enlace.cpp"))
  incompleto(cobertura(a, ["src/main.cpp"]), /enlace simbólico/)
  const b = proyecto({ "src/main.cpp": SANO })
  symlinkSync(afuera, join(b, "src", "vendor"))
  incompleto(cobertura(b, ["src/main.cpp"]), /enlace simbólico/)
  const c = proyecto({ "src/main.cpp": SANO })
  symlinkSync(afuera, join(c, "lib"))
  incompleto(cobertura(c, ["src/main.cpp"]), /lib\/ no es una carpeta común/)
  const d = proyecto({ "src/main.cpp": SANO, include: "soy un archivo" })
  incompleto(cobertura(d, ["src/main.cpp"]), /include\/ no es una carpeta común/)
})

test("más niveles de carpetas de los que se revisan → incompleto", () => {
  const d = proyecto({ "src/main.cpp": SANO })
  let ruta = join(d, "src")
  for (let i = 0; i < 20; i++) ruta = join(ruta, `n${i}`)
  mkdirSync(ruta, { recursive: true })
  incompleto(cobertura(d, ["src/main.cpp"]), /más niveles/)
})

test("un archivo compilable que no es texto plano (UTF-16) → incompleto: no se pueden ver sus #include", () => {
  const d = proyecto({ "src/main.cpp": SANO })
  writeFileSync(join(d, "src", "raro.cpp"), Buffer.from('\ufeff#include "datos.inc"\n', "utf16le"))
  incompleto(cobertura(d, ["src/main.cpp", "src/raro.cpp"]), /no es texto plano/)
})

test("la lista de leídos tiene que describir ESTE proyecto: un archivo 'leído' que no está → incompleto", () => {
  const d = proyecto({ "src/main.cpp": SANO })
  incompleto(cobertura(d, ["src/main.cpp", "src/fantasma.cpp"]), /fantasma\.cpp, que no está/)
})

test("un ini que mueve las fuentes, o que no se puede leer → incompleto", () => {
  const d = proyecto({ "src/main.cpp": SANO, "otro/malo.cpp": MALO })
  const con = (iniText) => fuentes.coberturaDeFuentes({ cwd: d, iniText, analizados: ["src/main.cpp"] })
  for (const [seccion, linea] of [["[platformio]", "src_dir = otro"], ["[platformio]", "lib_dir = otro"], ["[platformio]", "include_dir = otro"], ["[env:esp32dev]", "build_src_filter = +<*> +<../otro/>"], ["[env:esp32dev]", "src_filter = +<*>"], ["[env:esp32dev]", "lib_extra_dirs = otro"], ["[env]", "test_build_src = yes"]]) {
    incompleto(con(`${seccion}\n${linea}\n${seccion === "[env:esp32dev]" ? "" : INI}`), new RegExp(linea.split(" ")[0]))
  }
  incompleto(con("[common]\nx = 1\n"), /no se pudo leer con certeza/)
  incompleto(con("esto no es un ini"), /no se pudo leer con certeza/)
  assert.equal(con(INI).ok, true)
})

test("un proyecto sin src/, include/ ni lib/ con una lista vacía está 'cubierto' sólo si hubo análisis; con null, no", () => {
  const d = proyecto({})
  assert.deepEqual(cobertura(d, []), { ok: true, compilables: [] })
  assert.equal(cobertura(d, null).ok, false)
})
