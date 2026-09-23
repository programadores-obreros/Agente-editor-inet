#!/usr/bin/env node
// Extrae de CHANGELOG.md la sección de UNA versión, para usarla como cuerpo
// del release de GitHub.
//
//   node scripts/notas-release.mjs                        stdout: la sección de VERSION
//   node scripts/notas-release.mjs --version 0.4.2         stdout: la sección de esa versión
//   node scripts/notas-release.mjs --salida notas.md       la escribe en notas.md en vez de stdout
//
// POR QUÉ EXISTE. Los releases de GitHub de este repo salen sin cuerpo: el paso
// `softprops/action-gh-release@v2` de build-installer.yml no le pasa `body` ni
// `body_path`. Y no es sólo estético — `tecnialab-web` (el sitio público) lee
// esas notas de la API de GitHub para mostrarlas en la página de versiones, así
// que el docente viene leyendo notas vacías en TODOS los releases, mientras el
// CHANGELOG —que está bien escrito— nunca sale de este repo.
//
// El CHANGELOG sigue Keep a Changelog: un `## [Unreleased]` arriba de todo y
// después una sección por versión, `## [X.Y.Z] — YYYY-MM-DD`. Este script no le
// pone fecha ni em-dash: corta el encabezado por el `[...]` y listo, así que le
// da lo mismo cómo esté escrito el resto de la línea.
//
// Si la versión pedida no tiene sección, corta con exit 1 y dice cuáles SÍ
// encontró. Un release sin notas en silencio es exactamente el bug que estamos
// arreglando — que este script haga lo mismo en el paso que lo reemplaza no
// sería un arreglo, sería mudar el bug de lugar.

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

export const RUTA_CHANGELOG = join(REPO, "CHANGELOG.md")
export const RUTA_VERSION = join(REPO, "VERSION")

/** La versión de este checkout: el contenido de VERSION, sin el salto de línea. */
export function leerVersionPorDefecto(rutaVersion = RUTA_VERSION) {
  return readFileSync(rutaVersion, "utf8").trim()
}

// Un encabezado de sección es `## [algo]`, con lo que sea después (fecha,
// em-dash, nada). El grupo capturado es la ETIQUETA entre corchetes — para
// "0.4.1" eso es "0.4.1", para "Unreleased" es "Unreleased" — y es contra eso
// que se compara la versión pedida, letra por letra, sin tocar regex.
const ENCABEZADO_SECCION = /^## \[([^\]]+)\][^\n]*$/gm

/** Las etiquetas de sección del CHANGELOG, en el orden en que aparecen. */
export function etiquetas(changelog) {
  return [...changelog.matchAll(ENCABEZADO_SECCION)].map((m) => m[1])
}

/**
 * El cuerpo de la sección de `version`, SIN su encabezado (el título del
 * release ya lo pone GitHub) y cortado antes del `## [` siguiente. Tira si esa
 * versión no tiene sección — un release vacío en silencio no es una opción.
 */
export function extraer(changelog, version) {
  const encabezados = [...changelog.matchAll(ENCABEZADO_SECCION)]
  const i = encabezados.findIndex((m) => m[1] === version)
  if (i === -1) {
    const encontradas = encabezados.map((m) => m[1]).filter((v) => v !== "Unreleased")
    throw new Error(
      `no encontré "## [${version}]" en CHANGELOG.md. Versiones con sección: ${
        encontradas.length ? encontradas.join(", ") : "(ninguna)"
      }.`,
    )
  }
  const inicio = encabezados[i].index + encabezados[i][0].length
  const fin = i + 1 < encabezados.length ? encabezados[i + 1].index : changelog.length
  return changelog.slice(inicio, fin).trim()
}

function parsearArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--version") args.version = argv[++i]
    else if (argv[i] === "--salida") args.salida = argv[++i]
  }
  return args
}

// Sólo cuando se ejecuta como comando; al importarlo desde un test no hace nada.
const esPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (esPrincipal) {
  const { version: versionPedida, salida } = parsearArgs(process.argv.slice(2))
  const version = versionPedida ?? leerVersionPorDefecto()
  const changelog = readFileSync(RUTA_CHANGELOG, "utf8")

  let cuerpo
  try {
    cuerpo = extraer(changelog, version)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }

  if (salida) {
    writeFileSync(salida, `${cuerpo}\n`)
    console.log(`notas de ${version} escritas en ${salida}`)
  } else {
    console.log(cuerpo)
  }
}
