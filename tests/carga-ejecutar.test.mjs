// `opencode/carga/ejecutar.ts`: el único lugar que arma y lanza un argv de carga
// (Slice 2, gate único de carga — CONTRATOS-API §9, ADR-001 §9.4 y §9.8).
//
// `run` es SIEMPRE un doble que anota con qué lo llamaron: acá no se lanza ningún
// proceso. Lo que se fija:
//   - el argv del gate lleva siempre `-e`, `nobuild` y `--upload-port`, y no acepta
//     valores que no sean lo que dicen ser (una IP como puerto, una opción como env);
//   - el argv heredado es, byte a byte, el de 0.4.8 (la transición no cambia `flash`);
//   - `lanzarCarga` sólo lanza cargas: la capacidad no sirve para correr otra cosa.
//
// MUTACIONES que ponen esto rojo (verificadas a mano, ver el informe de la etapa):
// sacar `-e` o `nobuild` del argv; aceptar cualquier target en `lanzarCarga`; no
// pasarle la capacidad a `run`.

import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const TIMEOUT_ORIGINAL = process.env.TECNIA_PIO_TIMEOUT_MS

let ejecutar
let proceso

before(async () => {
  delete process.env.TECNIA_PIO_TIMEOUT_MS
  ejecutar = await import(join(REPO, "opencode/carga/ejecutar.ts"))
  proceso = await import(join(REPO, "opencode/carga/proceso.ts"))
})

after(() => {
  if (TIMEOUT_ORIGINAL === undefined) delete process.env.TECNIA_PIO_TIMEOUT_MS
  else process.env.TECNIA_PIO_TIMEOUT_MS = TIMEOUT_ORIGINAL
})

/** Un `run` falso con la misma firma que el real: anota y contesta lo que se le diga. */
function runDoble(respuesta = { code: 0, stdout: "", stderr: "" }) {
  const llamadas = []
  const run = async (cmd, cwd, signal, timeoutMs, capacidad) => {
    llamadas.push({ cmd, cwd, signal, timeoutMs, capacidad })
    return respuesta
  }
  return { run, llamadas }
}

async function rechazaSinLlamarARun(argv) {
  const { run, llamadas } = runDoble()
  await assert.rejects(
    () => ejecutar.lanzarCarga(run, argv, "/proyecto"),
    (error) => {
      assert.ok(error instanceof proceso.ErrorDeCarga, `tiró otra cosa: ${error}`)
      assert.equal(error.codigo, "RUTA_DE_CARGA_NO_AUTORIZADA")
      return true
    },
    `tenía que rechazar: ${JSON.stringify(argv)}`,
  )
  assert.equal(llamadas.length, 0, `llamó a run con un argv no admitido: ${JSON.stringify(argv)}`)
}

// ── argvDeCarga ──────────────────────────────────────────────────────────────────────

test("argvDeCarga: el argv exacto del gate — carpeta, environment, nobuild, upload y puerto", () => {
  assert.deepEqual(ejecutar.argvDeCarga({ cwd: "/home/profe/proyecto", environment: "esp32-devkit-v1", puerto: "/dev/ttyACM0" }), [
    "pio", "run", "-d", "/home/profe/proyecto", "-e", "esp32-devkit-v1", "-t", "nobuild", "-t", "upload", "--upload-port", "/dev/ttyACM0",
  ])
  assert.deepEqual(ejecutar.argvDeCarga({ cwd: "/p", environment: "uno", puerto: "COM5" }).slice(-2), ["--upload-port", "COM5"])
})

test("argvDeCarga: el argv que arma ES un argv de carga para la guardia de run()", () => {
  assert.equal(proceso.argvEsDeCarga(ejecutar.argvDeCarga({ cwd: "/p", environment: "uno", puerto: "COM5" })), true)
})

const VALORES_QUE_NO_SON = [
  ["una IP como puerto (PlatformIO cargaría por red)", { cwd: "/p", environment: "uno", puerto: "192.168.1.20" }],
  ["un hostname como puerto", { cwd: "/p", environment: "uno", puerto: "esp32.local" }],
  ["un puerto vacío", { cwd: "/p", environment: "uno", puerto: "" }],
  ["un puerto que es una opción", { cwd: "/p", environment: "uno", puerto: "--target=uploadfs" }],
  ["un puerto con inyección", { cwd: "/p", environment: "uno", puerto: "/dev/ttyUSB0; rm -rf /" }],
  ["sin environment", { cwd: "/p", environment: "", puerto: "COM5" }],
  ["environment undefined", { cwd: "/p", puerto: "COM5" }],
  ["un environment que es una opción", { cwd: "/p", environment: "--target=uploadfs", puerto: "COM5" }],
  ["un environment con espacio", { cwd: "/p", environment: "uno -t uploadfs", puerto: "COM5" }],
  ["una carpeta relativa", { cwd: "proyecto", environment: "uno", puerto: "COM5" }],
  ["una carpeta que es una opción", { cwd: "--project-conf=/tmp/otro.ini", environment: "uno", puerto: "COM5" }],
  ["sin carpeta", { environment: "uno", puerto: "COM5" }],
]
for (const [nombre, o] of VALORES_QUE_NO_SON) {
  test(`argvDeCarga: no arma argv con ${nombre}`, () => {
    assert.throws(
      () => ejecutar.argvDeCarga(o),
      (error) => error instanceof proceso.ErrorDeCarga && error.codigo === "RUTA_DE_CARGA_NO_AUTORIZADA",
    )
  })
}

// ── argvDeCargaHeredada (transición) ─────────────────────────────────────────────────

test("argvDeCargaHeredada: es el argv de 0.4.8, igual elemento por elemento", () => {
  assert.deepEqual(ejecutar.argvDeCargaHeredada({ puerto: "/dev/ttyUSB0" }), ["pio", "run", "--target", "upload", "--upload-port", "/dev/ttyUSB0"])
  assert.deepEqual(ejecutar.argvDeCargaHeredada({ puerto: "COM3", environment: "uno" }), ["pio", "run", "--target", "upload", "--upload-port", "COM3", "-e", "uno"])
  // Sin environment (undefined o vacío) no va `-e`: lo mismo que hacía `envFlag`.
  assert.deepEqual(ejecutar.argvDeCargaHeredada({ puerto: "COM3", environment: "" }), ["pio", "run", "--target", "upload", "--upload-port", "COM3"])
  assert.deepEqual(ejecutar.argvDeCargaHeredada({ puerto: "COM3", environment: undefined }), ["pio", "run", "--target", "upload", "--upload-port", "COM3"])
})

// ── lanzarCarga ──────────────────────────────────────────────────────────────────────

test("lanzarCarga: le pasa a run el argv, el cwd, la señal y LA CAPACIDAD", async () => {
  const esperado = { code: 0, stdout: "[SUCCESS]", stderr: "" }
  const { run, llamadas } = runDoble(esperado)
  const signal = new AbortController().signal
  const argv = ejecutar.argvDeCarga({ cwd: "/proyecto", environment: "uno", puerto: "COM5" })
  const r = await ejecutar.lanzarCarga(run, argv, "/proyecto", signal)
  assert.equal(r, esperado, "devuelve lo que devolvió run, sin tocar")
  assert.equal(llamadas.length, 1)
  assert.deepEqual(llamadas[0].cmd, argv)
  assert.equal(llamadas[0].cwd, "/proyecto")
  assert.equal(llamadas[0].signal, signal)
  assert.equal(proceso.esCapacidadDeCarga(llamadas[0].capacidad), true, "run no recibió la capacidad: la guardia real lo rechazaría")
})

test("lanzarCarga: sin timeout usa timeoutCarga(); con timeout, ése", async () => {
  const { run, llamadas } = runDoble()
  const argv = ejecutar.argvDeCargaHeredada({ puerto: "COM5" })
  await ejecutar.lanzarCarga(run, argv, "/p")
  assert.equal(llamadas[0].timeoutMs, proceso.timeoutCarga())
  await ejecutar.lanzarCarga(run, argv, "/p", undefined, 180_000)
  assert.equal(llamadas[1].timeoutMs, 180_000)
})

test("lanzarCarga: un código de salida malo NO es una excepción — vuelve tal cual (lo interpreta quien llama)", async () => {
  const { run } = runDoble({ code: 1, stdout: "", stderr: "A fatal error occurred: Failed to connect to ESP32" })
  const r = await ejecutar.lanzarCarga(run, ejecutar.argvDeCargaHeredada({ puerto: "COM5" }), "/p")
  assert.equal(r.code, 1)
})

const NO_SON_CARGAS_ADMITIDAS = [
  ["una compilación", ["pio", "run"]],
  ["una compilación con environment", ["pio", "run", "-e", "uno"]],
  ["uploadfs (sube el sistema de archivos, no el programa)", ["pio", "run", "-t", "uploadfs", "--upload-port", "COM5"]],
  ["upload más otro target", ["pio", "run", "-t", "upload", "-t", "erase", "--upload-port", "COM5"]],
  ["sin --upload-port (PlatformIO elegiría el puerto solo)", ["pio", "run", "-t", "upload"]],
  ["dos puertos", ["pio", "run", "-t", "upload", "--upload-port", "COM5", "--upload-port", "COM6"]],
  ["dos upload", ["pio", "run", "-t", "upload", "--target", "upload", "--upload-port", "COM5"]],
  ["una opción que no es de carga", ["pio", "run", "-t", "upload", "--upload-port", "COM5", "--project-conf", "/tmp/otro.ini"]],
  ["un valor suelto", ["pio", "run", "-t", "upload", "--upload-port", "COM5", "extra"]],
  ["--upload-port sin valor", ["pio", "run", "-t", "upload", "--upload-port"]],
  ["otro subcomando de pio", ["pio", "device", "list", "--json-output"]],
  ["esptool directo", ["esptool.py", "--port", "COM5", "write_flash", "0x1000", "x.bin"]],
  ["un shell", ["sh", "-c", "pio run -t upload --upload-port COM5"]],
  ["la ruta de pio en vez de `pio` (lo resuelve run, no quien llama)", ["/usr/bin/pio", "run", "-t", "upload", "--upload-port", "COM5"]],
  ["un argv vacío", []],
]
for (const [nombre, argv] of NO_SON_CARGAS_ADMITIDAS) {
  test(`lanzarCarga: la capacidad no sirve para lanzar ${nombre}`, async () => {
    await rechazaSinLlamarARun(argv)
  })
}
