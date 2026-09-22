#!/usr/bin/env node
// El guard de seguridad física de los proyectos de `proyectos-inet`.
//
//   node scripts/seguridad-proyectos.mjs
//
// POR QUÉ EXISTE. Una auditoría encontró 15 proyectos con partes móviles, calor
// o red eléctrica SIN ninguna advertencia de seguridad física. Se arreglaron a
// mano, uno por uno. Arreglarlos no evita que vuelva a pasar: el proyecto 16 que
// alguien escriba mañana con un servo puede volver a salir sin el bloque, y nada
// lo iba a notar hasta que un docente se lastimara la mano en el aula.
//
// Este script es la diferencia entre "lo arreglamos" y "no puede volver a pasar".
// Corre en CI (job `skills`, ver .github/workflows/ci.yml) sobre cada
// `opencode/skills/proyectos-inet/proyectos/*.md`: si menciona alguna de las tres
// familias de riesgo físico y no trae ni el bloque canónico de seguridad ni una
// exención explícita y justificada, el PR corta. Nombra el archivo y la familia
// que lo marcó — un guard que no dice CUÁL no ahorra tiempo, lo gasta.

import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Donde viven los proyectos de la skill `proyectos-inet`. */
export const PROYECTOS = join(REPO, "opencode", "skills", "proyectos-inet", "proyectos")

/** Minúsculas y sin tildes: así "eléctrica"/"electrica" y "térmico"/"TÉRMICO" son la misma palabra. */
export function normalizar(texto) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
}

// Las tres familias del contrato. Las palabras ya van normalizadas (sin tildes):
// `normalizar()` se aplica también al texto del proyecto antes de buscarlas, así
// que "hélices", "Motores" o "quemó" matchean igual que sus formas base — son
// prefijos de sus propias formas plurales/conjugadas, no hace falta una lista
// aparte para cada una.
export const FAMILIAS = {
  "partes móviles": [
    "servo",
    "motor",
    "helice",
    "paleta",
    "rueda",
    "oruga",
    "barrera",
    "gatillo",
    "cremallera",
    "ventilador",
    "bomba",
    "dosificador",
    "engranaje",
    "cinta transportadora",
  ],
  calor: ["calefactor", "radiador", "resistencia calefactora", "quema", "termico", "caliente"],
  "red eléctrica": ["red electrica"],
}

// 220V / 220 V no es una palabra, es un patrón numérico — por eso no vive en
// FAMILIAS junto a las demás. `\b` a los dos lados para no confundirlo con, por
// ejemplo, "resistencia de 220 Ω" (la unidad no es una V) ni con "2200V".
const PATRON_220V = /\b220\s?v\b/i

/**
 * Qué familias de riesgo menciona este proyecto, cada una con la primera palabra
 * que la disparó (para nombrarla en el mensaje de error). Vacío = no riesgoso.
 */
export function detectarRiesgos(contenido) {
  const normalizado = normalizar(contenido)
  const riesgos = []
  for (const [familia, palabras] of Object.entries(FAMILIAS)) {
    const palabra = palabras.find((p) => normalizado.includes(p))
    if (palabra) riesgos.push({ familia, palabra })
  }
  if (!riesgos.some((r) => r.familia === "red eléctrica") && PATRON_220V.test(contenido)) {
    riesgos.push({ familia: "red eléctrica", palabra: "220V" })
  }
  return riesgos
}

// El bloque canónico: una línea que arranca con "> ⚠️ **SEGURIDAD:**". `\s*` en
// vez de un espacio fijo tolera variaciones de espaciado sin dejar de exigir la
// forma — no cualquier mención de la palabra "seguridad" cuenta.
const PATRON_BLOQUE = /^>\s*⚠️\s*\*\*SEGURIDAD:\*\*/m

/** ¿Tiene el bloque canónico de seguridad? */
export function tieneBloqueCanonico(contenido) {
  return PATRON_BLOQUE.test(contenido)
}

// La exención: un comentario HTML `<!-- sin-riesgo-fisico: <motivo> -->`. El
// grupo captura todo lo que hay entre el ":" y el cierre del comentario.
const PATRON_EXENCION = /<!--\s*sin-riesgo-fisico:([\s\S]*?)-->/

/**
 * ¿Tiene una exención con motivo? `<!-- sin-riesgo-fisico: -->` (sin texto) NO
 * cuenta: una exención sin razón es un silenciador, no una justificación, y eso
 * es justo lo que el contrato prohíbe.
 */
export function exencionJustificada(contenido) {
  const motivo = contenido.match(PATRON_EXENCION)
  return Boolean(motivo && motivo[1].trim().length > 0)
}

/** El texto exacto del `::error` que entiende GitHub Actions. */
export function errorGithub(rutaRelativa, motivo) {
  return `::error file=${rutaRelativa}::${motivo}`
}

/**
 * Recorre los `.md` de `base` y devuelve el veredicto: cuáles son riesgosos,
 * cuáles de esos están cubiertos (bloque o exención) y cuáles fallan — con el
 * archivo, la ruta y el motivo de cada falla, nunca solo un conteo.
 */
export function verificar(base = PROYECTOS) {
  const archivos = readdirSync(base)
    .filter((a) => a.toLowerCase().endsWith(".md"))
    .sort()
  const riesgosos = []
  const cubiertos = []
  const fallas = []
  for (const archivo of archivos) {
    const ruta = join(base, archivo)
    const contenido = readFileSync(ruta, "utf8")
    const riesgos = detectarRiesgos(contenido)
    if (riesgos.length === 0) continue
    riesgosos.push(archivo)
    if (tieneBloqueCanonico(contenido) || exencionJustificada(contenido)) {
      cubiertos.push(archivo)
      continue
    }
    const familias = riesgos.map((r) => `${r.familia} (por "${r.palabra}")`).join(", ")
    fallas.push({
      archivo,
      ruta,
      motivo: `proyecto riesgoso [${familias}] sin bloque de seguridad ni exención justificada (sin-riesgo-fisico)`,
    })
  }
  return { riesgosos, cubiertos, fallas }
}

// Sólo cuando se ejecuta como comando; al importarlo desde un test no hace nada.
const esPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (esPrincipal) {
  const { riesgosos, cubiertos, fallas } = verificar()
  const enGithubActions = Boolean(process.env.GITHUB_ACTIONS)

  console.log(`${riesgosos.length} proyecto(s) riesgoso(s) de ${readdirSync(PROYECTOS).filter((a) => a.endsWith(".md")).length} totales:`)
  for (const archivo of riesgosos) {
    console.log(`  - ${archivo}: ${cubiertos.includes(archivo) ? "cubierto" : "SIN CUBRIR"}`)
  }

  if (fallas.length) {
    console.error(`\n${fallas.length} proyecto(s) sin cobertura de seguridad:`)
    for (const falla of fallas) {
      const rutaRelativa = relative(REPO, falla.ruta)
      console.error(enGithubActions ? errorGithub(rutaRelativa, falla.motivo) : `  - ${rutaRelativa}: ${falla.motivo}`)
    }
    console.error(
      `\nAgregá el bloque "> ⚠️ **SEGURIDAD:** ..." si el riesgo es real, o ` +
        `"<!-- sin-riesgo-fisico: <motivo> -->" si no lo es.`,
    )
    process.exit(1)
  }

  console.log(`\nOK: ${cubiertos.length} proyecto(s) riesgoso(s), todos cubiertos.`)
}
