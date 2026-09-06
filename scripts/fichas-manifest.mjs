#!/usr/bin/env node
// El manifiesto de las fichas que viajan en el instalador.
//
//   node scripts/fichas-manifest.mjs           escribe opencode/skills/fichas/MANIFEST.sha256
//   node scripts/fichas-manifest.mjs --check   comprueba que las hojas coincidan con él
//
// POR QUÉ EXISTE. Las 17 hojas de `opencode/skills/fichas/hojas/` son COPIAS. El
// original vive en el repo `fichas-tecnialab`, se genera desde un `ficha.json`, y
// se copia acá. Nada en este repo sabía QUÉ versión de cada hoja estaba copiada:
// `tests/ficha.test.mjs` mira que existan y que sean `.html`, no qué dicen.
//
// Pasó de verdad, y en las dos direcciones. La 09 se corrigió acá (el divisor del
// LDR estaba al revés) y la fuente siguió generando la versión vieja: la próxima
// regeneración la pisaba. Y del otro lado, 02, 04, 08 y 14 se corrigieron en la
// fuente y el instalador siguió llevando las viejas dos semanas. Ninguno de los
// dos desfasajes rompía nada — por eso hacía falta algo que los mirara.
//
// El manifiesto es un sha256 por hoja, en el formato de `sha256sum`, así que se
// puede verificar sin Node desde cualquier máquina:
//
//   cd opencode/skills/fichas && sha256sum -c MANIFEST.sha256
//
// Lo escribe `pnpm publicar` desde el repo de fichas, después de copiar. Lo
// verifican `tests/fichas-manifest.test.mjs` en cada corrida de tests, y
// `pnpm sincronia` desde el otro repo.
//
// VIVE AL LADO DEL SKILL.md, NO ADENTRO DE hojas/. Todo lo que hay en `hojas/` se
// trata como una hoja: el tool `ficha` lista esa carpeta, y los tests exigen que
// ahí haya una sola extensión. Un archivo que no es una ficha no va ahí.

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

/** La carpeta del skill: acá viven `SKILL.md`, `hojas/` y el manifiesto. */
export const FICHAS = join(REPO, "opencode", "skills", "fichas")
export const NOMBRE_MANIFIESTO = "MANIFEST.sha256"

const sha256 = (ruta) => createHash("sha256").update(readFileSync(ruta)).digest("hex")

/** `{ "hojas/09-ldr.html": "<sha256>" }` de lo que hay HOY en hojas/, en orden de nombre. */
export function calcular(base = FICHAS) {
  const hojas = readdirSync(join(base, "hojas"))
    .filter((a) => a.toLowerCase().endsWith(".html"))
    .sort()
  return Object.fromEntries(hojas.map((a) => [`hojas/${a}`, sha256(join(base, "hojas", a))]))
}

/** El texto del manifiesto: formato `sha256sum` — hash, dos espacios, ruta — una hoja por línea. */
export function serializar(entradas) {
  return Object.entries(entradas)
    .map(([ruta, hash]) => `${hash}  ${ruta}\n`)
    .join("")
}

/** Lo inverso. Corta si una línea no tiene la forma: un manifiesto a medias no se interpreta. */
export function parsear(texto) {
  const out = {}
  for (const [i, linea] of texto.split("\n").entries()) {
    if (!linea.trim()) continue
    const m = linea.match(/^([0-9a-f]{64})  (\S.*)$/)
    if (!m) {
      throw new Error(
        `línea ${i + 1} del manifiesto sin forma "<sha256>  <archivo>": ${JSON.stringify(linea)}`,
      )
    }
    out[m[2]] = m[1]
  }
  return out
}

/**
 * Compara lo listado contra lo que hay. Devuelve los problemas, uno por línea y
 * NOMBRANDO el archivo: una lista vacía significa que todo coincide.
 */
export function comparar(listado, real) {
  const problemas = []
  for (const [ruta, hash] of Object.entries(listado)) {
    if (!(ruta in real)) problemas.push(`${ruta}: está en el manifiesto y NO en la carpeta`)
    else if (real[ruta] !== hash) problemas.push(`${ruta}: el contenido no coincide con el manifiesto`)
  }
  for (const ruta of Object.keys(real)) {
    if (!(ruta in listado)) problemas.push(`${ruta}: está en la carpeta y NO en el manifiesto`)
  }
  return problemas
}

/** `--check`: lee el manifiesto de `base` y lo contrasta con sus hojas. */
export function verificar(base = FICHAS) {
  const ruta = join(base, NOMBRE_MANIFIESTO)
  if (!existsSync(ruta)) {
    return [`no existe ${NOMBRE_MANIFIESTO} en ${base}; generalo con: node scripts/fichas-manifest.mjs`]
  }
  return comparar(parsear(readFileSync(ruta, "utf8")), calcular(base))
}

/** Escribe el manifiesto de `base` y devuelve cuántas hojas firmó. */
export function escribir(base = FICHAS) {
  const entradas = calcular(base)
  writeFileSync(join(base, NOMBRE_MANIFIESTO), serializar(entradas))
  return Object.keys(entradas).length
}

// Sólo cuando se ejecuta como comando; al importarlo desde un test no hace nada.
const esPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (esPrincipal) {
  if (process.argv.includes("--check")) {
    const problemas = verificar()
    if (problemas.length) {
      console.error(
        `Las hojas del instalador NO coinciden con ${NOMBRE_MANIFIESTO}:\n` +
          problemas.map((p) => `  - ${p}`).join("\n") +
          `\n\nSi el cambio es intencional, regenerá el manifiesto desde el repo de fichas (pnpm publicar).`,
      )
      process.exit(1)
    }
    console.log(`${Object.keys(calcular()).length} hojas verificadas contra ${NOMBRE_MANIFIESTO}.`)
  } else {
    const n = escribir()
    console.log(`${NOMBRE_MANIFIESTO} escrito con ${n} hojas.`)
  }
}
