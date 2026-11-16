// La TRANSICIÓN de la etapa 1 del gate de carga (Slice 2): la única ruta de carga del
// producto sigue siendo `tool/platformio.ts::cargar()`, y tiene que pasar por
// `carga/ejecutar.ts::lanzarCarga` — el único que le puede dar a `run()` la capacidad
// que la guardia en runtime exige.
//
// POR QUÉ UN ARCHIVO APARTE. Si alguien "simplifica" `cargar()` y vuelve a llamar a
// `run()` directo, la guardia lo frena: `flash` y `both` dejan de cargar. Los tests que
// ya había (`platformio-execute`, `pines-codigo`) se ponen rojos ahí, pero por la
// EXCEPCIÓN que tira `run()`, no por una aserción: lo mostró la mutación (42 rojos y
// ninguna aserción). Acá la propiedad se afirma: `flash` y `both` CARGAN, con un solo
// spawn de carga, y `execute()` no tira.
//
// Mismo truco que `platformio-execute.test.mjs`: se copia `platformio.ts` a un temporal,
// se le cambia el plugin por un doble y `../carga/` por el módulo real del repo; `Bun`
// es falso. Nunca se lanza `pio` ni se toca un puerto.

import { test, before, beforeEach, after } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = mkdtempSync(join(os.tmpdir(), "tecniabot-carga-transicion-"))
const HOME_FALSO = join(OUT, "home")
const ENTORNO_ORIGINAL = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, TECNIA_PIO_TIMEOUT_MS: process.env.TECNIA_PIO_TIMEOUT_MS }

let spawns = []
globalThis.Bun = {
  which: () => null,
  spawn(cmd) {
    spawns.push([...cmd])
    const s = cmd.join(" ")
    const stdout = s.includes("--version") ? "PlatformIO Core, version 6.1.19\n" : s.includes("device list") ? JSON.stringify([{ port: "/dev/ttyUSB0", hwid: "USB VID:PID=1A86:7523 LOCATION=1-1", description: "USB2.0-Serial" }]) : "[SUCCESS] Took 2.10 seconds\n"
    return { stdout, stderr: "", exited: Promise.resolve(0), kill() {}, unref() {} }
  },
}

let tool
let ctx

before(async () => {
  mkdirSync(HOME_FALSO, { recursive: true })
  process.env.HOME = HOME_FALSO
  process.env.USERPROFILE = HOME_FALSO
  process.env.XDG_CONFIG_HOME = join(HOME_FALSO, ".config") // el registro de cargas, al temporal
  delete process.env.TECNIA_PIO_TIMEOUT_MS
  writeFileSync(join(OUT, "mock-plugin.ts"), "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;")
  const src = readFileSync(join(REPO, "opencode/tool/platformio.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
    .replaceAll('from "../carga/', `from "${pathToFileURL(join(REPO, "opencode/carga")).href}/`)
  writeFileSync(join(OUT, "platformio.ts"), src)
  tool = (await import(join(OUT, "platformio.ts"))).default
  ctx = { directory: OUT, abort: new AbortController().signal, agent: "tecnia-bot" }
})

beforeEach(() => {
  spawns = []
})

after(() => {
  for (const [k, v] of Object.entries(ENTORNO_ORIGINAL)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(OUT, { recursive: true, force: true })
})

/** Corre la tool y devuelve el texto, o el error si TIRÓ (que es lo que no puede pasar). */
async function ejecutar(args) {
  try {
    return { texto: await tool.execute(args, ctx), error: null }
  } catch (error) {
    return { texto: null, error }
  }
}
const cargas = () => spawns.filter((cmd) => cmd.includes("--upload-port"))

for (const [accion, exito] of [
  ["flash", /Codigo cargado exitosamente en \/dev\/ttyUSB0/],
  ["both", /Compilacion y carga exitosa en \/dev\/ttyUSB0/],
]) {
  test(`${accion}: la carga del producto pasa la guardia en runtime — carga de verdad, con UN spawn y el argv de siempre`, async () => {
    const r = await ejecutar({ action: accion })
    assert.equal(r.error, null, `${accion} tiró en vez de cargar: ${r.error} — ¿cargar() dejó de pasar por lanzarCarga?`)
    assert.match(r.texto, exito)
    assert.equal(cargas().length, 1, `tenía que haber exactamente un spawn de carga: ${JSON.stringify(spawns)}`)
    assert.deepEqual(cargas()[0], ["pio", "run", "--target", "upload", "--upload-port", "/dev/ttyUSB0"])
  })

  test(`${accion} con puerto y environment explícitos: mismo argv de 0.4.8, con -e al final`, async () => {
    const r = await ejecutar({ action: accion, port: "/dev/ttyACM3", environment: "uno" })
    assert.equal(r.error, null, `${accion} tiró en vez de cargar: ${r.error}`)
    assert.match(r.texto, /\/dev\/ttyACM3/)
    assert.deepEqual(cargas(), [["pio", "run", "--target", "upload", "--upload-port", "/dev/ttyACM3", "-e", "uno"]])
  })
}

test("compile no lanza ninguna carga", async () => {
  const r = await ejecutar({ action: "compile" })
  assert.equal(r.error, null)
  assert.equal(cargas().length, 0)
  assert.ok(spawns.some((cmd) => cmd.join(" ") === "pio run"), `no compiló: ${JSON.stringify(spawns)}`)
})
