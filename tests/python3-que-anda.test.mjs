// Un `python3` que EXISTE no es un `python3` que ANDA.
//
// POR QUÉ ESTE ARCHIVO. En una Mac sin las Command Line Tools, /usr/bin/python3 es
// un stub: `command -v python3` da verdadero y al ejecutarlo falla. Los cuatro
// scripts de Linux/macOS preguntaban sólo si existía (doce veces entre los cuatro) y
// se iban por el camino de python3 con un python3 que no corre. Lo que pasaba,
// medido en Linux con un python3 que sale con error puesto primero en el PATH:
//
//   - install.sh leía auth.json con ese python3, la lectura fallaba, el `|| true` se
//     la comía y el instalador concluía «no hay key»: una docente con su key
//     guardada quedaba en Big Pickle sin que nadie le dijera nada.
//   - sin jq, install.sh elegía JSON_TOOL=python3, el merge reventaba y `set -e`
//     cortaba el instalador a la mitad, sin un mensaje.
//   - uninstall.sh --borrar no podía leer auth.json y la key quedaba en la compu.
//
// Ahora hay UNA función, `python3_anda`, que lo ejecuta (`python3 -c 'import json'`)
// una vez y guarda la respuesta. Está repetida en los cuatro scripts a propósito
// (ninguno hace dot-sourcing de otro); el primer test las mantiene iguales.
//
// LOS FUNCIONALES corren los scripts de verdad con un ejecutable `python3` que
// existe y sale con error: no es un `if` de prueba, es la condición de la Mac.
//
// VERIFICADO POR MUTACIÓN (cada una pone rojo este archivo, exit code 1):
//   - en install.sh, `python3_anda` sin ejecutar nada (`command -v python3` a
//     secas)                         → rojos los dos funcionales de install.sh
//   - lo mismo en uninstall.sh        → rojo el funcional de uninstall.sh
//   - en uninstall.sh, cambiar un `if python3_anda; then` por
//     `if command -v python3 >/dev/null 2>&1; then`  → rojo el guard de forma
//
// SIN PROBAR: nada de esto corrió en una Mac real. El stub de macOS puede además
// abrir un cartel al ejecutarse; eso no se pudo mirar desde Linux.
//
// Corre con: node --test tests/python3-que-anda.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, armarBin, correr, nuevoHome, ponerEjecutable, puedeCorrer, rutaDe } from "./ayuda-instalador-sh.mjs"

const SCRIPTS = ["bootstrap.sh", "install.sh", "update.sh", "uninstall.sh"]
const leer = (s) => readFileSync(join(REPO, "install", s), "utf8")
// Los comentarios CITAN el defecto (`command -v python3`): una cita no es código.
const sinComentarios = (t) => t.replace(/^\s*#.*$/gm, "")

function cuerpo(codigo, nombre) {
  const i = codigo.indexOf(`${nombre}() {`)
  if (i < 0) return null
  const j = codigo.indexOf("\n}\n", i)
  return j > i ? codigo.slice(i, j + 3) : null
}

/**
 * Las líneas que DECIDEN por la existencia de python3 sin pasar por la función.
 * Se permiten dos lugares: adentro de `python3_anda` (ahí es la primera mitad de la
 * pregunta) y donde ya se sabe que NO anda y sólo se elige el texto del aviso
 * («hay uno pero no anda» contra «falta»).
 */
export function decisionesPorExistencia(codigo) {
  const fn = cuerpo(codigo, "python3_anda") ?? ""
  const lineas = codigo.replace(fn, "").split("\n")
  const malas = []
  lineas.forEach((l, i) => {
    if (!/command -v python3/.test(l)) return
    if (!/\b(if|elif|while)\b|&&|\|\|/.test(l)) return // `$(command -v python3)` para mostrar la ruta no decide nada
    if (/PYTHON3_ANDA/.test(l)) return
    let j = i - 1
    while (j >= 0 && !lineas[j].trim()) j--
    if (j >= 0 && /!\s*python3_anda/.test(lineas[j])) return
    malas.push(l.trim())
  })
  return malas
}

test("los cuatro scripts traen la MISMA python3_anda, y la función ejecuta python3 de verdad", () => {
  const cuerpos = SCRIPTS.map((s) => [s, cuerpo(sinComentarios(leer(s)), "python3_anda")])
  for (const [s, c] of cuerpos) assert.ok(c, `install/${s} no define python3_anda()`)
  for (const [s, c] of cuerpos) assert.equal(c, cuerpos[0][1], `python3_anda de install/${s} no es igual a la de install/${cuerpos[0][0]}`)
  assert.match(cuerpos[0][1], /python3 -c /, "python3_anda no EJECUTA python3: sólo mira si existe, que es el defecto")
})

test("ningún script decide por `command -v python3` fuera de python3_anda", () => {
  for (const s of SCRIPTS) {
    assert.deepEqual(decisionesPorExistencia(sinComentarios(leer(s))), [], `install/${s} pregunta si python3 EXISTE en vez de si ANDA`)
  }
})

test("el guard de arriba marca lo que tiene que marcar (se prueba a sí mismo)", () => {
  const fn = 'python3_anda() {\n  if command -v python3 >/dev/null 2>&1 && python3 -c x; then :; fi\n}\n'
  assert.deepEqual(decisionesPorExistencia(fn), [], "la función misma no es una infracción")
  assert.deepEqual(decisionesPorExistencia(`${fn}if command -v python3 >/dev/null 2>&1; then\n  python3 - x\nfi\n`),
    ["if command -v python3 >/dev/null 2>&1; then"])
  assert.deepEqual(decisionesPorExistencia(`${fn}  elif command -v python3 >/dev/null 2>&1; then\n`),
    ["elif command -v python3 >/dev/null 2>&1; then"])
  assert.deepEqual(decisionesPorExistencia(`${fn}[ "$JQ_OK" != "1" ] && command -v python3 >/dev/null 2>&1\n`).length, 1)
  // Lo permitido: elegir el texto del aviso cuando ya se sabe que no anda.
  assert.deepEqual(decisionesPorExistencia(`${fn}if ! python3_anda; then\n  if command -v python3 >/dev/null 2>&1; then echo roto; fi\nfi\n`), [])
  assert.deepEqual(decisionesPorExistencia(`${fn}echo "ruta: $(command -v python3)"\n`), [])
})

// ── Funcionales ───────────────────────────────────────────────────────────────

const jq = rutaDe("jq")
const fuenteInstall = leer("install.sh")
const MODELO_CON_KEY = fuenteInstall.match(/^MODELO_CON_KEY="([^"]+)"/m)?.[1]
const MODELO_SIN_KEY = fuenteInstall.match(/^MODELO_SIN_KEY="([^"]+)"/m)?.[1]

/** PATH armado con un `python3` que existe, es ejecutable, y sale con error. */
function binConPythonRoto(h, con = []) {
  const bin = armarBin(h.base, con)
  ponerEjecutable(bin, "python3", 'echo "python3: no anda (como el stub de macOS sin Command Line Tools)" >&2\nexit 1')
  return bin
}

test("FUNCIONAL install.sh: python3 roto + jq → lee la key guardada por jq (antes concluía «no hay key»)", { skip: !puedeCorrer || !jq }, () => {
  assert.ok(MODELO_CON_KEY && MODELO_SIN_KEY, "install.sh ya no define los modelos")
  const h = nuevoHome()
  try {
    // Sin curl en el PATH: la prueba de la key contra Google no tiene con qué salir
    // a la red y contesta «no pude probarla». El test no toca Internet.
    const path = binConPythonRoto(h, ["jq"])
    mkdirSync(h.dataDir, { recursive: true })
    writeFileSync(h.authFile, JSON.stringify({ google: { type: "api", key: "AIzaNoEsUnaKeyDeVerdad-0123456789" }, otro: { type: "api", key: "X" } }))
    const r = correr(join(REPO, "install", "install.sh"), h, { path, env: { TECNIA_SIN_PROMPT: "1" } })
    assert.equal(r.status, 0, `install.sh abortó con un python3 que no anda (rc=${r.status}):\n${r.salida}`)
    const oc = JSON.parse(readFileSync(join(h.configDir, "opencode.json"), "utf8"))
    assert.equal(oc.agent["tecnia-bot"].model, MODELO_CON_KEY,
      `había una key de Google guardada y el instalador eligió ${oc.agent["tecnia-bot"].model}: no la leyó`)
    assert.match(r.salida, /via jq/, `no cayó al camino jq:\n${r.salida}`)
    assert.match(r.salida, /python3[^\n]*pero no anda/, `no avisa que el python3 que hay no anda:\n${r.salida}`)
    assert.match(readFileSync(h.authFile, "utf8"), /AIzaNoEsUnaKeyDeVerdad/, "tocó auth.json")
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("FUNCIONAL install.sh: python3 roto y sin jq → no aborta, crea la config por el camino sin herramientas", { skip: !puedeCorrer }, () => {
  const h = nuevoHome()
  try {
    const path = binConPythonRoto(h)
    const r = correr(join(REPO, "install", "install.sh"), h, { path, env: { TECNIA_SIN_PROMPT: "1" } })
    assert.equal(r.status, 0, `install.sh abortó (rc=${r.status}):\n${r.salida}`)
    assert.doesNotMatch(r.salida, /via python3/, `dice que usó un python3 que no anda:\n${r.salida}`)
    const oc = JSON.parse(readFileSync(join(h.configDir, "opencode.json"), "utf8"))
    assert.equal(oc.default_agent, "tecnia-bot")
    assert.equal(oc.agent["tecnia-bot"].model, MODELO_SIN_KEY)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("FUNCIONAL uninstall.sh --borrar: python3 roto + jq → la key se quita por jq (antes quedaba en la compu)", { skip: !puedeCorrer || !jq }, () => {
  const h = nuevoHome()
  try {
    const path = binConPythonRoto(h, ["jq"])
    mkdirSync(join(h.configDir, "agent"), { recursive: true })
    mkdirSync(h.dataDir, { recursive: true })
    writeFileSync(join(h.configDir, "tecnia-bot.manifest"), "version=0.0.0\nagent/tecnia-bot.md\n")
    writeFileSync(join(h.configDir, "agent", "tecnia-bot.md"), "capa\n")
    writeFileSync(h.authFile, JSON.stringify({ google: { type: "api", key: "AIzaSECRETO" }, otro: { type: "api", key: "OTRA" } }))
    const r = correr(join(REPO, "install", "uninstall.sh"), h, { path, args: ["--borrar"] })
    assert.equal(r.status, 0, `uninstall.sh abortó (rc=${r.status}):\n${r.salida}`)
    const auth = readFileSync(h.authFile, "utf8")
    assert.doesNotMatch(auth, /AIzaSECRETO/, `la key de Google sigue en auth.json:\n${r.salida}`)
    assert.match(auth, /OTRA/, "se llevó puesta otra credencial")
    assert.match(r.salida, /Key de Google quitada/, r.salida)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})
