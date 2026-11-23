// La relectura después de guardar la key: que sirva para algo, o que no esté.
//
// POR QUÉ EXISTE ESTE ARCHIVO. `clave.ts` escribe la key en auth.json y el modelo en
// opencode.json, y después de cada escritura RELEE el archivo: si no dice lo que se quiso
// guardar, contesta que no quedó en vez de «Listo». Es la regla del repo («un OK falso es
// peor que un error»), y CLAUDE.md la cita como ejemplo.
//
// La auditoría de código del 2026-11-22 (TST-04) encontró que NINGÚN test ejecutaba esa
// rama: anulando la relectura, la suite seguía en verde. Podía ser una guarda que nunca
// falla (el propio repo sacó una igual en sesion-local.ts por eso), o una que sí sirve y
// nadie cuida. El owner decidió el 2026-11-23: probarla con una falla simulada, y si
// resulta que no puede fallar nunca, sacarla.
//
// QUÉ SE ENCONTRÓ: PUEDE FALLAR, y la relectura la ataja. La escritura es atómica
// (temporal + rename), así que el propio proceso no puede dejar el archivo a medias; pero
// entre el rename y la relectura OTRO programa puede cambiar el archivo. El comentario del
// código nombra el caso real: un antivirus que revierte el archivo. Acá se simula eso.
//
// CÓMO SE SIMULA. No se toca el producto. El test carga una copia de clave.ts con el
// `node:fs` cambiado por un módulo propio que hace todo igual, salvo que justo después de
// cada `renameSync` llama a un gancho. El gancho hace de «otro programa»: revierte el
// archivo, lo deja ilegible, o lo borra.
//
// QUÉ NO PRUEBA: un antivirus real, ni Windows. Prueba que SI el archivo no quedó como se
// pidió, el tool no dice que quedó.
//
// MUTACIONES que ponen rojo este archivo (ver el commit):
//   - sacar la comparación `quedo !== esperado` de escribirClaveEnAuth     → rojos «revierte» y «quitar»
//   - sacar el chequeo de `relectura.estado` de escribirClaveEnAuth        → rojos «ilegible» y «lo borra»
//   - sacar la relectura de escribirModelo                                 → rojo «el modelo»
//   - tratar «no-verifico» como éxito en aplicar()                         → rojos todos
//
// Corre con: node --test tests/clave-relectura.test.mjs

import { test, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = mkdtempSync(join(os.tmpdir(), "tecniabot-clave-relectura-"))
const KEY = "CLAVE-DE-PRUEBA-TECNIA-NO-REAL-987654321"
const KEY_VIEJA = "CLAVE-DE-PRUEBA-TECNIA-ANTERIOR-555"

let mod
let dataDir
let cfgDir
const authPath = () => join(dataDir, "opencode", "auth.json")
const configPath = () => join(cfgDir, "opencode", "opencode.json")
const authJson = () => JSON.parse(readFileSync(authPath(), "utf8"))

/** Lo que «otro programa» le hace a un archivo justo después de que el tool lo escribió. */
let otroPrograma = null

before(async () => {
  writeFileSync(join(OUT, "mock-plugin.ts"), "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;")
  // El mismo node:fs, con un gancho después de cada rename.
  writeFileSync(
    join(OUT, "fs-con-otro-programa.mjs"),
    `import * as real from "node:fs"
export const { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } = real
export function renameSync(desde, hasta) {
  real.renameSync(desde, hasta)
  globalThis.__tecniaDespuesDeRenombrar?.(hasta)
}
`,
  )
  const fuente = readFileSync(join(REPO, "opencode/tool/clave.ts"), "utf8")
  const IMPORT_FS = 'import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"'
  assert.equal(fuente.split(IMPORT_FS).length, 2, "clave.ts cambió su import de node:fs: este test ya no está inyectando nada, y pasaría en verde sin medir")
  writeFileSync(
    join(OUT, "clave.ts"),
    fuente
      .replace('/// <reference path="../env.d.ts" />', "")
      .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
      .replace(IMPORT_FS, IMPORT_FS.replace('"node:fs"', '"./fs-con-otro-programa.mjs"')),
  )
  mod = (await import(join(OUT, "clave.ts"))).default
})

beforeEach(() => {
  const base = mkdtempSync(join(OUT, "caso-"))
  dataDir = join(base, "data")
  cfgDir = join(base, "cfg")
  mkdirSync(join(dataDir, "opencode"), { recursive: true })
  mkdirSync(join(cfgDir, "opencode"), { recursive: true })
  process.env.XDG_DATA_HOME = dataDir
  process.env.XDG_CONFIG_HOME = cfgDir
  process.env.TECNIA_CLAVE_TIMEOUT_MS = "500"
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
  globalThis.Bun = { spawn: () => ({ exited: Promise.resolve(0), stdout: new Response("").body, stderr: new Response("").body }) }
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [] }) }) // Google dice que la key anda
  writeFileSync(configPath(), JSON.stringify({ $schema: "https://opencode.ai/config.json", default_agent: "tecnia-bot" }, null, 2))
  otroPrograma = null
  globalThis.__tecniaDespuesDeRenombrar = (ruta) => otroPrograma?.(ruta)
})

const guardar = () => mod.execute({ accion: "guardar", clave: KEY }, {})
const quitar = () => mod.execute({ accion: "quitar" }, {})
const DICE_QUE_GUARDO = /la guardé en esta compu|Listo: probé tu key/
const modeloEnConfig = () => JSON.parse(readFileSync(configPath(), "utf8")).agent?.["tecnia-bot"]?.model

test("control: sin ningún otro programa en el medio, guarda y lo dice (el gancho no rompe nada)", async () => {
  let renombres = 0
  otroPrograma = () => renombres++
  const r = await guardar()
  assert.match(r, DICE_QUE_GUARDO, r)
  assert.equal(authJson().google.key, KEY)
  assert.equal(modeloEnConfig(), "google/gemini-3.5-flash-lite")
  // Si este número es 0, el gancho no está enganchado y los demás tests no miden nada.
  assert.equal(renombres, 2, "esperaba dos escrituras atómicas: auth.json y opencode.json")
})

test("un antivirus revierte auth.json a la key vieja: NO dice que guardó, y no cambia el modelo", async () => {
  writeFileSync(authPath(), JSON.stringify({ google: { type: "api", key: KEY_VIEJA }, otro: { type: "api", key: "x" } }, null, 2))
  const original = readFileSync(authPath(), "utf8")
  otroPrograma = (ruta) => ruta === authPath() && writeFileSync(ruta, original)
  const r = await guardar()
  assert.doesNotMatch(r, DICE_QUE_GUARDO, `dijo que guardó y en el archivo está la key vieja:\n${r}`)
  assert.match(r, /No pude guardar la key/, r)
  assert.match(r, /no quedó/, r)
  assert.equal(authJson().google.key, KEY_VIEJA, "el test no armó bien el caso")
  // Sin key nueva guardada, el agente no puede quedar apuntando al modelo que la necesita.
  assert.equal(modeloEnConfig(), undefined, "cambió el modelo del agente aunque la key no quedó guardada")
  assert.ok(!r.includes(KEY) && !r.includes(KEY_VIEJA), "la respuesta muestra una key")
})

test("el archivo queda ilegible después de escribirlo: NO dice que guardó", async () => {
  otroPrograma = (ruta) => ruta === authPath() && writeFileSync(ruta, '{ "google": { "type": "api", "key": "CORT')
  const r = await guardar()
  assert.doesNotMatch(r, DICE_QUE_GUARDO, r)
  assert.match(r, /No pude guardar la key/, r)
})

test("otro programa borra auth.json después de escribirlo: NO dice que guardó", async () => {
  otroPrograma = (ruta) => ruta === authPath() && rmSync(ruta)
  const r = await guardar()
  assert.equal(existsSync(authPath()), false, "el test no armó bien el caso")
  assert.doesNotMatch(r, DICE_QUE_GUARDO, r)
  assert.match(r, /No pude guardar la key/, r)
})

test("quitar: si la key reaparece después de sacarla, NO dice que la sacó", async () => {
  writeFileSync(authPath(), JSON.stringify({ google: { type: "api", key: KEY_VIEJA } }, null, 2))
  const original = readFileSync(authPath(), "utf8")
  otroPrograma = (ruta) => ruta === authPath() && writeFileSync(ruta, original)
  const r = await quitar()
  assert.doesNotMatch(r, /Listo: saqué la key/, `dijo que la sacó y sigue en el archivo:\n${r}`)
  assert.match(r, /No pude quitar la key/, r)
  assert.equal(authJson().google.key, KEY_VIEJA)
})

test("el modelo: si opencode.json se revierte, la key queda guardada pero NO dice que el agente cambió de modelo", async () => {
  const original = readFileSync(configPath(), "utf8")
  otroPrograma = (ruta) => ruta === configPath() && writeFileSync(ruta, original)
  const r = await guardar()
  assert.equal(authJson().google.key, KEY, "la key sí quedó: lo que falló fue el modelo")
  assert.match(r, /el modelo del agente NO cambió/, r)
  assert.doesNotMatch(r, /El agente quedó en/, `afirma un modelo que no está escrito:\n${r}`)
  assert.equal(modeloEnConfig(), undefined)
})
