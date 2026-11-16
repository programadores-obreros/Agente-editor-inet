// Ayudas compartidas por los tests que EJECUTAN los instaladores de Linux/macOS
// (install/*.sh) de verdad. No es un archivo de test: `node --test tests/*.test.mjs`
// no lo levanta porque no termina en `.test.mjs`.
//
// LAS TRES REGLAS QUE ESTAS AYUDAS SOSTIENEN:
//
//   1. Cada corrida tiene su HOME propio, hecho con mkdtemp. Nunca una ruta fija
//      compartida: dos archivos de test (o dos worktrees) corriendo a la vez no se
//      pisan.
//   2. El PATH se ARMA: una carpeta con enlaces a las herramientas que el test
//      decide que existan. Sacar `jq` o `curl` es no enlazarlos — la falla es real
//      (`command -v` da falso de verdad), no un `if` de prueba adentro del script.
//   3. Se corre el script del ÁRBOL DE TRABAJO, no el de `git archive HEAD`: así una
//      mutación sin commitear se ve. (tests/empaquetado-instalado.test.mjs prueba
//      otra cosa —lo que viaja empaquetado— y por eso sí usa HEAD.)

import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Ruta real de un comando en ESTA compu, o null. */
export function rutaDe(cmd) {
  try {
    const salida = execFileSync("/usr/bin/env", ["sh", "-c", `command -v ${cmd} 2>/dev/null`], { encoding: "utf8" })
    const ruta = salida.trim()
    return ruta.startsWith("/") ? ruta : null
  } catch {
    return null
  }
}

export const bash = rutaDe("bash")
export const puedeCorrer = process.platform !== "win32" && Boolean(bash)
export const esRoot = typeof process.getuid === "function" && process.getuid() === 0

// Lo que los cuatro scripts usan además de jq / python3 / curl / wget / git, que
// son justo las que cada test decide poner o sacar. Si a un script se le agrega
// una herramienta y no está acá, el test falla con «command not found» y `set -e`:
// es ruidoso a propósito.
const BASICAS = [
  "awk", "basename", "cat", "chmod", "cp", "df", "dirname", "find", "getent", "grep", "gzip", "head",
  "id", "ls", "mkdir", "mktemp", "mv", "rm", "rmdir", "sed", "sha256sum", "shasum", "sort", "stat",
  "tar", "tr", "uname",
]

/**
 * Una carpeta `bin` nueva con enlaces a las herramientas básicas más las de
 * `con`. `bash` va siempre: los scripts se llaman entre sí con `bash …`.
 */
export function armarBin(base, con = []) {
  const bin = join(base, "bin")
  mkdirSync(bin, { recursive: true })
  for (const h of ["bash", ...BASICAS, ...con]) {
    const real = rutaDe(h)
    if (real) symlinkSync(real, join(bin, h))
  }
  return bin
}

/** Un ejecutable de verdad adentro de `bin` (un guión de sh con el cuerpo dado). */
export function ponerEjecutable(bin, nombre, cuerpo) {
  const ruta = join(bin, nombre)
  writeFileSync(ruta, `#!/bin/sh\n${cuerpo}\n`)
  chmodSync(ruta, 0o755)
  return ruta
}

/** HOME + XDG nuevos bajo un mkdtemp propio. */
export function nuevoHome(prefijo = "tecnia-instalador-") {
  const base = mkdtempSync(join(tmpdir(), prefijo))
  const home = join(base, "home")
  mkdirSync(home, { recursive: true })
  const xdgConfig = join(home, ".config")
  const xdgData = join(home, ".local", "share")
  return {
    base,
    home,
    xdgConfig,
    xdgData,
    configDir: join(xdgConfig, "opencode"),
    dataDir: join(xdgData, "opencode"),
    authFile: join(xdgData, "opencode", "auth.json"),
  }
}

/**
 * Corre un script con bash real. El entorno es SÓLO el que se pasa (más HOME/XDG
 * del `h`): nada de la sesión de quien corre el test se cuela. El umask se fija
 * en 022 —el de fábrica de casi toda distro— para que los tests de permisos midan
 * lo que hace el script y no el umask de esta terminal.
 */
export function correr(script, h, { path, env = {}, args = [], input, timeout = 120_000, cwd, envoltorio = [] } = {}) {
  // `envoltorio`: un comando que va ADELANTE de bash (por ejemplo `unshare -r`, para
  // correr el script como root de verdad adentro de un espacio de usuarios).
  const cmd = [...envoltorio, bash, "-c", 'umask 022 && exec "$0" "$@"', bash, script, ...args]
  const run = spawnSync(cmd[0], cmd.slice(1), {
    cwd: cwd ?? h.base,
    env: { HOME: h.home, XDG_CONFIG_HOME: h.xdgConfig, XDG_DATA_HOME: h.xdgData, PATH: path, ...env },
    input: input ?? "",
    encoding: "utf8",
    timeout,
  })
  return { ...run, salida: `${run.stdout ?? ""}${run.stderr ?? ""}` }
}
