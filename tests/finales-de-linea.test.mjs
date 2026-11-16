// Finales de línea de lo que viaja adentro del instalador.
//
// POR QUÉ EXISTE. Hasta la 0.4.8 no había `.gitattributes`: lo que entraba al .exe
// dependía del `core.autocrlf` de la máquina que compilaba. Medido el 2026-11-15 en
// la VM win10: el .exe publicado v0.4.8 (runner de GitHub) traía
// `abrir-tecnia-bot.cmd` con CR=309 LF=309, y el mismo archivo instalado en la VM
// (compilado desde la carpeta compartida de Linux) tenía CR=0. Cada validación en
// la VM se había hecho sobre un archivo distinto al que recibían los docentes.
//
// Qué se mide acá, y con qué instrumento:
//   - el atributo que git le aplica a cada archivo (`git check-attr`), que es lo
//     que decide los bytes en CUALQUIER checkout y en `git archive`;
//   - los bytes reales del archivo en este árbol de trabajo.
// No se mira el texto de `.gitattributes`: una regla puede estar escrita y quedar
// pisada por otra más abajo (pasó al escribir este archivo: quedó un
// `*.ps1 text eol=crlf` duplicado debajo del `eol=lf` y ganaba el último).
//
// MUTACIONES que lo ponen rojo (verificadas el 2026-11-15):
//   - borrar la línea `*.cmd text eol=crlf` de `.gitattributes`  → rojo el atributo;
//   - agregar al final `*.ps1 text eol=crlf`                      → rojo el atributo;
//   - convertir `installer/abrir-tecnia-bot.cmd` a LF en el disco → rojo los bytes.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")

function listados(patron) {
  return execFileSync("git", ["ls-files", "--", ...patron], { cwd: RAIZ, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
}

function atributoEol(archivo) {
  // Salida de git: "<archivo>: eol: <valor>"
  const salida = execFileSync("git", ["check-attr", "eol", "--", archivo], { cwd: RAIZ, encoding: "utf8" }).trim()
  return salida.slice(salida.lastIndexOf(": ") + 2)
}

function contar(archivo) {
  const b = readFileSync(join(RAIZ, archivo))
  let cr = 0
  let lf = 0
  for (const x of b) {
    if (x === 13) cr++
    else if (x === 10) lf++
  }
  return { cr, lf }
}

const CMD = listados(["*.cmd", "*.bat"])
const PS1 = listados(["*.ps1"])
const SH = listados(["*.sh"])

test("el guard encuentra los archivos que dice cuidar (si la lista queda vacía, no cuida nada)", () => {
  assert.ok(CMD.includes("installer/abrir-tecnia-bot.cmd"), `no encontré el lanzador entre: ${CMD.join(", ")}`)
  assert.ok(PS1.includes("install/bootstrap.ps1"), "no encontré bootstrap.ps1")
  assert.ok(SH.includes("install/bootstrap.sh"), "no encontré bootstrap.sh")
})

test("los .cmd salen en CRLF en cualquier checkout: cmd.exe pierde etiquetas con LF", () => {
  for (const f of CMD) assert.equal(atributoEol(f), "crlf", `${f} no tiene eol=crlf: sus bytes dependen de quién compile`)
})

test("los .ps1 y los .sh salen en LF en cualquier checkout", () => {
  for (const f of [...PS1, ...SH]) assert.equal(atributoEol(f), "lf", `${f} no tiene eol=lf`)
})

test("el lanzador que hay en este árbol ES CRLF: cada salto de línea lleva su CR", () => {
  for (const f of CMD) {
    const { cr, lf } = contar(f)
    assert.ok(lf > 0, `${f} no tiene saltos de línea`)
    assert.equal(cr, lf, `${f}: CR=${cr} LF=${lf}; se va a compilar un lanzador distinto al que se publica`)
  }
})

test("los .ps1 y los .sh que hay en este árbol NO llevan CR", () => {
  for (const f of [...PS1, ...SH]) assert.equal(contar(f).cr, 0, `${f} tiene CR`)
})

test("las fichas, que se verifican por hash, quedan en LF", () => {
  const fichas = listados(["opencode/skills/fichas/hojas/*.html"])
  assert.ok(fichas.length > 0, "no encontré ninguna ficha")
  for (const f of fichas) {
    assert.equal(atributoEol(f), "lf", `${f} no tiene eol=lf: en Windows su hash no coincidiría con MANIFEST.sha256`)
    assert.equal(contar(f).cr, 0, `${f} tiene CR`)
  }
})
