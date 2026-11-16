// El lanzador `tecnia-bot` (install/tecnia-bot.sh, H1 ciclo 4): revisa la carpeta ANTES de
// abrir OpenCode, limpia el entorno, y sólo si todo dio limpio exporta la marca
// TECNIA_LANZADOR=<pid> y hace `exec` de opencode.
//
// NUNCA se ejecuta el OpenCode real: en el PATH va un `opencode` falso (un `sh`) que vuelca su
// entorno y su pid a un archivo y termina. La revisión es la de verdad
// (`opencode/carga/revisar-lanzamiento.ts`, copiada a un XDG_CONFIG_HOME temporal como la deja
// el instalador) y corre con el `node` de este proceso. HOME también es temporal.

import { test, after } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const LANZADOR = join(REPO, "install", "tecnia-bot.sh")
const BASH = existsSync("/bin/bash") ? "/bin/bash" : "/usr/bin/bash"
const LINUX = process.platform === "linux"

const T = mkdtempSync(join(os.tmpdir(), "tecniabot-lanzador-"))
after(() => rmSync(T, { recursive: true, force: true }))

const HOME = join(T, "home")
const XDG = join(T, "config")
const BIN = join(T, "bin")
mkdirSync(HOME, { recursive: true })
mkdirSync(join(XDG, "opencode"), { recursive: true })
cpSync(join(REPO, "opencode", "carga"), join(XDG, "opencode", "carga"), { recursive: true })
mkdirSync(BIN, { recursive: true })
writeFileSync(join(BIN, "opencode"), '#!/bin/sh\n/usr/bin/env > "$SALIDA_ENV"\necho "PID_OPENCODE=$$" >> "$SALIDA_ENV"\necho "ARGS=$*" >> "$SALIDA_ENV"\nexit 0\n')
chmodSync(join(BIN, "opencode"), 0o755)
const PATH_CON_NODE = `${BIN}:${dirname(process.execPath)}`

let n = 0
function lanzar({ cwd, home = HOME, xdg = XDG, path = PATH_CON_NODE, extra = {}, args = [] }) {
  const salida = join(T, `entorno-${++n}.txt`)
  const r = spawnSync(BASH, [LANZADOR, ...args], { cwd, encoding: "utf8", env: { HOME: home, XDG_CONFIG_HOME: xdg, PATH: path, SALIDA_ENV: salida, ...extra } })
  assert.equal(existsSync(salida), true, `el opencode falso no corrió: ${r.stderr}`)
  const entorno = Object.fromEntries(
    readFileSync(salida, "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  )
  return { entorno, stderr: r.stderr, status: r.status }
}
const carpetaLimpia = (nombre) => {
  const d = join(T, nombre)
  mkdirSync(d, { recursive: true })
  return d
}

test("lanzador, carpeta limpia → marca = pid de OpenCode (exec), entorno limpio, OPENCODE_DISABLE_PROJECT_CONFIG=1, argumentos intactos", { skip: !LINUX && "Linux" }, () => {
  const { entorno, stderr } = lanzar({
    cwd: carpetaLimpia("limpia"),
    args: ["--agent", "tecnia-bot"],
    extra: { OPENCODE_CONFIG_CONTENT: '{"permission":"allow"}', OPENCODE_TEST_MANAGED_CONFIG_DIR: "/x", OPENCODE_CUALQUIERA: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", TECNIA_LANZADOR: "1" },
  })
  assert.equal(entorno.TECNIA_LANZADOR, entorno.PID_OPENCODE, "la marca tiene que ser el pid del proceso OpenCode")
  assert.match(entorno.TECNIA_LANZADOR, /^\d+$/)
  assert.notEqual(entorno.TECNIA_LANZADOR, "1", "no hereda una marca de afuera")
  assert.equal(entorno.OPENCODE_DISABLE_PROJECT_CONFIG, "1")
  assert.equal(entorno.OPENCODE_DISABLE_CLAUDE_CODE, "1", "la única OPENCODE_* que pasa")
  for (const v of ["OPENCODE_CONFIG_CONTENT", "OPENCODE_TEST_MANAGED_CONFIG_DIR", "OPENCODE_CUALQUIERA"]) assert.equal(entorno[v], undefined, v)
  assert.deepEqual(Object.keys(entorno).filter((k) => k.startsWith("OPENCODE_")).sort(), ["OPENCODE_DISABLE_CLAUDE_CODE", "OPENCODE_DISABLE_PROJECT_CONFIG"])
  assert.equal(entorno.ARGS, "--agent tecnia-bot")
  assert.doesNotMatch(stderr, /DESHABILITADA/)
})

for (const [caso, preparar] of [
  ["`.opencode` en la carpeta", (d) => mkdirSync(join(d, ".opencode"))],
  ["`tui.json` en la carpeta", (d) => writeFileSync(join(d, "tui.json"), "{}")],
  ["`opencode.json` en un ancestro", (d) => writeFileSync(join(dirname(d), "opencode.json"), "{}")],
]) {
  test(`lanzador, ${caso} → abre SIN marca (aunque venga una de afuera) y avisa`, { skip: !LINUX && "Linux" }, () => {
    const d = carpetaLimpia(`sucia-${n}/proyecto`)
    preparar(d)
    const { entorno, stderr } = lanzar({ cwd: d, extra: { TECNIA_LANZADOR: "12345" } })
    assert.equal(entorno.TECNIA_LANZADOR, undefined)
    assert.match(stderr, /carga a la placa queda DESHABILITADA/)
    assert.equal(entorno.OPENCODE_DISABLE_PROJECT_CONFIG, "1", "la segunda capa va igual")
  })
}

test("lanzador, `$HOME/.opencode` con algo fuera de la lista blanca → sin marca; sólo con `bin` → con marca", { skip: !LINUX && "Linux" }, () => {
  const sucio = join(T, "home-sucio")
  mkdirSync(join(sucio, ".opencode", "agent"), { recursive: true })
  assert.equal(lanzar({ cwd: carpetaLimpia("p1"), home: sucio }).entorno.TECNIA_LANZADOR, undefined)
  const limpio = join(T, "home-bin")
  mkdirSync(join(limpio, ".opencode", "bin"), { recursive: true })
  assert.match(lanzar({ cwd: carpetaLimpia("p2"), home: limpio }).entorno.TECNIA_LANZADOR ?? "", /^\d+$/)
})

test("lanzador sin Node, o sin la revisión instalada → abre SIN marca (falla cerrado) y dice por qué", { skip: !LINUX && "Linux" }, () => {
  const sinNode = lanzar({ cwd: carpetaLimpia("p3"), path: BIN })
  assert.equal(sinNode.entorno.TECNIA_LANZADOR, undefined)
  assert.match(sinNode.stderr, /no encontré Node/)
  const xdgVacio = join(T, "config-vacio")
  mkdirSync(xdgVacio)
  const sinRevision = lanzar({ cwd: carpetaLimpia("p4"), xdg: xdgVacio })
  assert.equal(sinRevision.entorno.TECNIA_LANZADOR, undefined)
  assert.match(sinRevision.stderr, /no encontré la revisión/)
})

test("instalador y desinstalador conocen al lanzador (y la marca del desinstalador es la línea del lanzador)", () => {
  const install = readFileSync(join(REPO, "install", "install.sh"), "utf8")
  assert.match(install, /cp "\$REPO_DIR\/install\/tecnia-bot\.sh" "\$HOME\/\.local\/bin\/tecnia-bot"/)
  const segundaLinea = readFileSync(LANZADOR, "utf8").split("\n")[1]
  const uninstall = readFileSync(join(REPO, "install", "uninstall.sh"), "utf8")
  assert.ok(uninstall.includes(`= "${segundaLinea}" ]`), "el desinstalador no reconoce al lanzador por su segunda línea")
})
