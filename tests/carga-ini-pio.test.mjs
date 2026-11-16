// PRUEBA POSITIVA REAL de los flags de compilación admitidos (decisión del owner sobre R-04).
//
// Sólo corre con `TECNIA_CARGA_PIO=1` (necesita PlatformIO y `atmelavr@5.2.0` YA instalados:
// si falta la plataforma, el test falla sin bajar nada).
//
// QUÉ MIDE. Que cada forma que `carga/ini.ts::leerFlags` ADMITE llega al compilador como
// UNA definición de macro, con el nombre y el valor que se escribieron, y como nada más:
//   1. el propio programa lo comprueba al compilar (`#if`, `static_assert`, y el TEXTO del
//      valor comparado carácter por carácter): si una macro no vale lo esperado, no compila;
//   2. en la línea de comando real del compilador (`pio run -v`) cada macro aparece como
//      `-DNOMBRE` o `-DNOMBRE=valor`, y no hay ninguna otra palabra que la nombre;
//   3. `build_src_flags` vale sólo para `src/`: una librería de `lib/` no ve esa macro.
// Y un CONTROL DEL INSTRUMENTO: el mismo programa esperando OTRO valor NO compila. Sin eso,
// "compiló" no probaría nada.
//
// QUÉ NO MIDE, A PROPÓSITO. Ninguna forma RECHAZADA se le pasa al toolchain real: por
// decisión del owner esas variantes quedan documentadas como UNKNOWN. Antes de lanzar
// `pio`, este test exige que la auditoría admita el ini que va a compilar.
//
// LÍMITES: una placa (UNO), un compilador (avr-gcc de la plataforma fijada), Linux. No es
// una prueba para ESP32 ni para Windows.

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const ACTIVO = process.env.TECNIA_CARGA_PIO === "1"
const PLAZO_MS = 8 * 60 * 1000

const INI = [
  "[env:uno]",
  "platform = atmelavr@5.2.0",
  "board = uno",
  "framework = arduino",
  "build_flags =",
  "    -DLED_PRUEBA=4",
  "    -D BOTON_PRUEBA=15",
  "    -DMASCARA_PRUEBA=0x1F -DMODO_PRUEBA=RAPIDO",
  "    -DSIN_VALOR_PRUEBA",
  "build_src_flags = -DSOLO_SRC_PRUEBA=7",
  "",
].join("\n")

const ESPERADAS = [
  { nombre: "LED_PRUEBA", valor: "4" },
  { nombre: "BOTON_PRUEBA", valor: "15" },
  { nombre: "MASCARA_PRUEBA", valor: "0x1F" },
  { nombre: "MODO_PRUEBA", valor: "RAPIDO" },
  { nombre: "SIN_VALOR_PRUEBA", valor: null },
  { nombre: "SOLO_SRC_PRUEBA", valor: "7" },
]

/** El programa que se comprueba a sí mismo. `led` es el valor que ESPERA para LED_PRUEBA. */
const mainCpp = (led) => `#include <Arduino.h>
#include "Otra.h"
#define TEXTO2(x) #x
#define TEXTO(x) TEXTO2(x)
constexpr bool igual(const char *a, const char *b) { return *a == *b && (*a == 0 || igual(a + 1, b + 1)); }

// El TEXTO de cada valor, tal como llegó (antes de definir RAPIDO: si no, se expandiría).
static_assert(igual(TEXTO(LED_PRUEBA), "${led}"), "TECNIA_PRUEBA: LED_PRUEBA no llego como ${led}");
static_assert(igual(TEXTO(BOTON_PRUEBA), "15"), "TECNIA_PRUEBA: BOTON_PRUEBA no llego como 15");
static_assert(igual(TEXTO(MASCARA_PRUEBA), "0x1F"), "TECNIA_PRUEBA: MASCARA_PRUEBA no llego como 0x1F");
static_assert(igual(TEXTO(MODO_PRUEBA), "RAPIDO"), "TECNIA_PRUEBA: MODO_PRUEBA no llego como RAPIDO");
static_assert(igual(TEXTO(SIN_VALOR_PRUEBA), "1"), "TECNIA_PRUEBA: SIN_VALOR_PRUEBA no vale 1");
static_assert(igual(TEXTO(SOLO_SRC_PRUEBA), "7"), "TECNIA_PRUEBA: SOLO_SRC_PRUEBA no llego como 7");

// Y su VALOR.
#define RAPIDO 123
static_assert(LED_PRUEBA == ${led} && BOTON_PRUEBA == 15 && MASCARA_PRUEBA == 31 && MODO_PRUEBA == 123 && SIN_VALOR_PRUEBA == 1 && SOLO_SRC_PRUEBA == 7, "TECNIA_PRUEBA: algun valor no es el esperado");

void setup() { pinMode(LED_PRUEBA, OUTPUT); otra(); }
void loop() {}
`

const OTRA_H = "void otra();\n"
const OTRA_CPP = `#include "Otra.h"
// build_flags llega también a las librerías; build_src_flags, no.
#if LED_PRUEBA != 4
#error "TECNIA_PRUEBA: la libreria no ve LED_PRUEBA=4"
#endif
#ifdef SOLO_SRC_PRUEBA
#error "TECNIA_PRUEBA: build_src_flags llego a una libreria de lib/"
#endif
void otra() {}
`

function armar(dir, led) {
  mkdirSync(join(dir, "src"), { recursive: true })
  mkdirSync(join(dir, "lib", "Otra"), { recursive: true })
  writeFileSync(join(dir, "platformio.ini"), INI)
  writeFileSync(join(dir, "src", "main.cpp"), mainCpp(led))
  writeFileSync(join(dir, "lib", "Otra", "Otra.h"), OTRA_H)
  writeFileSync(join(dir, "lib", "Otra", "Otra.cpp"), OTRA_CPP)
}

/** `pio run -v`, con plazo propio: si no termina, se mata y el test falla por aserción, no cuelga. */
function compilar(dir) {
  return new Promise((resolve) => {
    // Sin ninguna variable PLATFORMIO_* heredada que cambie la configuración (R-01).
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PLATFORMIO_") || k === "PLATFORMIO_CORE_DIR"))
    env.PLATFORMIO_SETTING_ENABLE_TELEMETRY = "no"
    const hijo = spawn("pio", ["run", "-v", "-d", dir, "-e", "uno"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] })
    let salida = ""
    let vencido = false
    hijo.stdout.on("data", (d) => (salida += d))
    hijo.stderr.on("data", (d) => (salida += d))
    const plazo = setTimeout(() => {
      vencido = true
      hijo.kill("SIGKILL")
    }, PLAZO_MS)
    hijo.on("error", (error) => {
      clearTimeout(plazo)
      resolve({ code: 127, salida: `${salida}\n${error.message}`, vencido })
    })
    hijo.on("close", (code) => {
      clearTimeout(plazo)
      resolve({ code: code ?? 1, salida, vencido })
    })
  })
}

test(
  "PRUEBA POSITIVA REAL: los flags admitidos llegan al compilador como una macro cada uno, con su valor exacto, y como nada más",
  { skip: ACTIVO ? false : "opt-in: TECNIA_CARGA_PIO=1 (necesita PlatformIO y atmelavr@5.2.0 instalados)", timeout: 2 * PLAZO_MS + 60_000 },
  async () => {
    const ini = await import(join(REPO, "opencode/carga/ini.ts"))

    // PRECONDICIÓN 1: lo que se va a compilar es SÓLO lo que la auditoría admite.
    const auditado = ini.auditarTextoIni(INI, "compilacion")
    assert.equal(auditado.ok, true, `este test sólo compila flags admitidos: ${JSON.stringify(auditado.rechazos)}`)
    assert.deepEqual(auditado.macros.uno, ESPERADAS)

    // PRECONDICIÓN 2: la plataforma ya está instalada (si no, `pio run` bajaría cosas).
    const core = process.env.PLATFORMIO_CORE_DIR || join(homedir(), ".platformio")
    const manifiesto = join(core, "platforms", "atmelavr", "platform.json")
    assert.ok(existsSync(manifiesto), `no está instalada la plataforma atmelavr en ${core}: este test no baja nada`)
    assert.equal(JSON.parse(readFileSync(manifiesto, "utf8")).version, "5.2.0", "la plataforma instalada no es la fijada")

    const raiz = mkdtempSync(join(tmpdir(), "tb-carga-ini-pio-"))
    try {
      // 1. Compila, y el programa comprueba sus propias macros.
      const bien = join(raiz, "bien")
      armar(bien, 4)
      assert.equal(ini.auditarIni(bien, "compilacion").ok, true)
      const r = await compilar(bien)
      const evidencia = process.env.TECNIA_CARGA_EVIDENCIA
      if (evidencia) {
        mkdirSync(evidencia, { recursive: true })
        writeFileSync(join(evidencia, "pio-run-bien.log"), r.salida)
        writeFileSync(join(evidencia, "pio-run-bien.rc"), `rc=${r.code}\nvencido=${r.vencido}\n`)
        cpSync(join(bien, "platformio.ini"), join(evidencia, "platformio.ini"))
        cpSync(join(bien, "src", "main.cpp"), join(evidencia, "main.cpp"))
      }
      assert.equal(r.vencido, false, "pio run no terminó en el plazo")
      assert.equal(r.code, 0, `no compiló:\n${r.salida.slice(-3000)}`)
      assert.ok(existsSync(join(bien, ".pio", "build", "uno", "firmware.hex")), "rc 0 pero no hay firmware.hex")

      // 2. La línea de comando real del compilador.
      const palabras = (linea) => linea.split(/\s+/).filter((p) => p.includes("PRUEBA"))
      const lineaDe = (archivo) => r.salida.split("\n").find((l) => /avr-g\+\+/.test(l) && l.includes(archivo) && l.includes(" -c "))
      const deMain = lineaDe(join("src", "main.cpp"))
      assert.ok(deMain, "no encontré el comando que compila src/main.cpp en la salida de `pio run -v`")
      assert.deepEqual(palabras(deMain).sort(), ["-DBOTON_PRUEBA=15", "-DLED_PRUEBA=4", "-DMASCARA_PRUEBA=0x1F", "-DMODO_PRUEBA=RAPIDO", "-DSIN_VALOR_PRUEBA", "-DSOLO_SRC_PRUEBA=7"])
      const deLib = lineaDe("Otra.cpp")
      assert.ok(deLib, "no encontré el comando que compila la librería")
      assert.deepEqual(palabras(deLib).sort(), ["-DBOTON_PRUEBA=15", "-DLED_PRUEBA=4", "-DMASCARA_PRUEBA=0x1F", "-DMODO_PRUEBA=RAPIDO", "-DSIN_VALOR_PRUEBA"], "build_src_flags no tiene que llegar a lib/")

      // 3. CONTROL DEL INSTRUMENTO: esperando otro valor, NO compila, y falla por NUESTRA comprobación.
      const mal = join(raiz, "mal")
      armar(mal, 5)
      const c = await compilar(mal)
      if (evidencia) {
        writeFileSync(join(evidencia, "pio-run-control.log"), c.salida)
        writeFileSync(join(evidencia, "pio-run-control.rc"), `rc=${c.code}\nvencido=${c.vencido}\n`)
      }
      assert.equal(c.vencido, false)
      assert.notEqual(c.code, 0, "el control compiló: la comprobación del programa no comprueba nada")
      assert.match(c.salida, /TECNIA_PRUEBA: LED_PRUEBA no llego como 5/, "el control falló por otra cosa")
    } finally {
      rmSync(raiz, { recursive: true, force: true })
    }
  },
)
