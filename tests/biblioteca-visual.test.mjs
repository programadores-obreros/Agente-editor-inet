// La biblioteca visual (wokwi-bundle.js + componentes-extra.js) es lo que hace
// que un circuito se VEA. Sin ella el HTML abre en blanco.
//
// Este archivo existe por un defecto que casi entra y no habria roto nada ese
// dia: se agrego `wokwi-bundle.js` al .gitignore para sacar de la raiz del repo
// la copia que deja el tool al probarlo. Pero un patron de gitignore SIN barra
// de adelante matchea a cualquier profundidad, y la biblioteca FUENTE vive en
// `opencode/tecniabot-web/`.
//
// Git no deja de seguir un archivo que ya sigue, asi que el dia del cambio todo
// andaba. El costo llegaba despues: al primero que la borre y la vuelva a
// agregar, o que la mueva de carpeta, no vuelve — y `git status` no dice nada
// porque hacer silencio es literalmente lo que se le pidio.
//
// Se descubre recien cuando sale un instalador sin biblioteca y veinte docentes
// abren un circuito en blanco.
//
// Corre con: node --test tests/*.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const BIBLIOTECA = [
  "opencode/tecniabot-web/wokwi-bundle.js",
  "opencode/tecniabot-web/componentes-extra.js",
]

/**
 * ¿Las REGLAS de ignore tapan esta ruta? Sale 1 cuando no.
 *
 * `--no-index` NO es opcional aca, y la primera version de este test no lo tenia:
 * pasaba en verde con el patron roto puesto.
 *
 * Sin la bandera, `git check-ignore` contesta "no ignorada" para cualquier
 * archivo que ya este versionado, sin llegar a mirar el patron — porque el
 * indice le gana al ignore, y eso es justamente lo que hace que el defecto no se
 * note el dia que entra. O sea que el test medía esa precedencia y no la regla:
 * habria empezado a fallar recien despues de que alguien desversione el archivo,
 * que es el momento exacto que venia a evitar.
 *
 * Con `--no-index` la pregunta es la correcta: si este archivo no estuviera ya
 * versionado, ¿se lo tragaria el ignore?
 */
function ignorada(ruta) {
  try {
    execFileSync("git", ["check-ignore", "--no-index", "-q", "--", ruta], {
      cwd: REPO,
      stdio: "ignore",
    })
    return true
  } catch {
    return false
  }
}

test("la biblioteca visual existe y esta versionada", () => {
  const seguidos = execFileSync("git", ["ls-files", "--", "opencode/tecniabot-web"], {
    cwd: REPO,
    encoding: "utf8",
  })

  for (const ruta of BIBLIOTECA) {
    assert.ok(existsSync(join(REPO, ruta)), `falta el archivo: ${ruta}`)
    assert.ok(seguidos.includes(ruta.split("/").pop()), `no esta versionado: ${ruta}`)
  }
})

test("ningun patron del .gitignore tapa la biblioteca visual", () => {
  for (const ruta of BIBLIOTECA) {
    assert.equal(
      ignorada(ruta),
      false,
      `El .gitignore esta ignorando ${ruta}.\n` +
        `Es la biblioteca que viaja en el instalador: si se pierde, los circuitos\n` +
        `abren en blanco. Si el patron es para sacar la copia que el tool deja en la\n` +
        `raiz al probar, anclalo con barra de adelante: /wokwi-bundle.js`,
    )
  }
})

test("la copia que el tool deja en la raiz al probar SI se ignora", () => {
  // El contrapeso: sin esto el test de arriba se cumple aflojando el ignore
  // hasta que no ignore nada, y volvemos a tener 432 KB de bundle en cada commit.
  for (const suelto of ["wokwi-bundle.js", "componentes-extra.js"]) {
    assert.ok(
      ignorada(suelto),
      `${suelto} en la raiz del repo no se esta ignorando.\n` +
        `El tool 'circuito' lo copia al lado del HTML que genera, y cuando uno prueba\n` +
        `el bot parado en el repo, esa copia es la raiz.`,
    )
  }
})
