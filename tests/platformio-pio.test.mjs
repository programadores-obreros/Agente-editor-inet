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
const HOME_ORIGINAL = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }

// `Bun.which` no existe bajo Node: se simula un PATH sin pio, que es el caso real
// (PlatformIO nunca queda en el PATH después de instalarse).
globalThis.Bun = { which: () => null }

let mod

before(async () => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true })
  mkdirSync(HOME_FALSO, { recursive: true })
  process.env.HOME = HOME_FALSO
  process.env.USERPROFILE = HOME_FALSO
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
