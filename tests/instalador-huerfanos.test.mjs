// El instalador de Linux borraba archivos AL AZAR al reinstalar (encontrado el 2026-10-14 en una
// notebook Manjaro: faltaban `tool/programa.ts` y `skills/archify/LICENSE` aunque el manifest los
// listaba).
//
// Causa: la limpieza de huérfanos hacía `printf '%s\n' "$NUEVOS" | grep -qxF "$rel" || rm -f …`
// con `set -o pipefail`. `grep -q` termina en cuanto encuentra la línea; si `printf` todavía estaba
// escribiendo la lista (la escribe de a trozos), recibe SIGPIPE, el caño sale distinto de 0 por
// `pipefail`, y el `|| rm -f` borra un archivo que SÍ es de la instalación. Es una carrera: sólo
// pasa cuando ya hay un manifest (segunda instalación o actualización) y no siempre con el mismo
// archivo. La corrección: `grep … <<< "$texto"`, sin caño (here-string).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..")

const SCRIPTS = ["install.sh", "bootstrap.sh", "update.sh", "uninstall.sh"].map((s) => join(REPO, "install", s))

test("ningún script de Linux con pipefail mete un texto por caño a `grep -q` (SIGPIPE → falso negativo)", () => {
  for (const ruta of SCRIPTS) {
    const fuente = readFileSync(ruta, "utf8")
    if (!/set -[a-z]*o pipefail|set -o pipefail/.test(fuente)) continue
    const lineas = fuente.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => !l.trimStart().startsWith("#"))
    const malas = lineas.filter(([, l]) => /(printf|echo)\b[^|]*\|\s*grep\s+-[a-zA-Z]*q/.test(l))
    assert.deepEqual(malas.map(([n, l]) => `${ruta.split("/").at(-1)}:${n}: ${l.trim()}`), [], "usá `grep -q … <<< \"$texto\"`")
  }
})

test("la limpieza de huérfanos de install.sh no borra ningún archivo que sigue en la instalación (lista más grande que la real, 5 corridas)", () => {
  const fuente = readFileSync(join(REPO, "install", "install.sh"), "utf8")
  const bloque = fuente.match(/# Borrar huérfanos[\s\S]*?\nfi\n/)
  assert.ok(bloque, "no encontré el bloque de huérfanos en install.sh")
  const dir = mkdtempSync(join(os.tmpdir(), "tecnia-huerfanos-"))
  try {
    const config = join(dir, "config")
    // Lista más grande que la real (≈280) para que la escritura por caño, si volviera, se parta en trozos.
    const archivos = Array.from({ length: 400 }, (_, i) => `tool/archivo-${String(i).padStart(4, "0")}-con-un-nombre-largo.ts`)
    for (const f of archivos) {
      mkdirSync(join(config, "tool"), { recursive: true })
      writeFileSync(join(config, f), "")
    }
    writeFileSync(join(config, "tool", "huerfano.ts"), "")
    const manifest = join(config, "tecnia-bot.manifest")
    writeFileSync(manifest, ["# Tecnia Bot", "version=0.0.0", "repo_dir=/x", ...archivos, "tool/huerfano.ts"].join("\n") + "\n")
    const guion = `set -euo pipefail\nCONFIG_DIR="$1"\nMANIFEST="$CONFIG_DIR/tecnia-bot.manifest"\nNUEVOS="$(cat "$2")"\n${bloque[0]}`
    const lista = join(dir, "nuevos.txt")
    writeFileSync(lista, archivos.join("\n"))
    for (let corrida = 0; corrida < 5; corrida++) {
      execFileSync("bash", ["-c", guion, "bash", config, lista], { stdio: "pipe" })
      const faltan = archivos.filter((f) => !existsSync(join(config, f)))
      assert.deepEqual(faltan, [], `corrida ${corrida}: borró archivos que siguen en la instalación`)
    }
    assert.equal(existsSync(join(config, "tool", "huerfano.ts")), false, "el huérfano de verdad sí se borra")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
