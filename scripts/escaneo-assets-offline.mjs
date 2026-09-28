#!/usr/bin/env node
// Escaneo offline — Phase 2, Slice 1 (writer W3, tarea 4). PHASE_2_SLICE_1_DESIGN.md
// §2.9: "Cero CDN y cero recursos remotos. Hay un test que escanea la página y los
// assets servidos." Mismo criterio léxico (regex sobre texto, no un parser real) que
// `scripts/guardia-composicion-raiz.mjs`/`guardia-servicio-con-vista.mjs` — barato,
// suficiente para una regresión, documentado como tal.
//
// Distingue, para cada URL remota (`http://`/`https://`/`//cdn...`) encontrada en un
// archivo, si aparece en un SINK que el navegador interpretaría como pedido de red
// ("carga real": `src=`, `href=`, `fetch(`, `import(`/`import ... from`, `<script
// src=`, `<link href=`, `.src =`) o si es INERTE (namespace XML, cita en un
// comentario/licencia, cualquier otro texto que ningún runtime va a pedir por red).
//
// Uso:
//   node scripts/escaneo-assets-offline.mjs <archivo...>   # imprime JSON por archivo

import { readFileSync } from "node:fs"

const PATRON_URL = /(https?:\/\/[^\s"'<>)]*|\/\/cdn[^\s"'<>)]*)/gi

const PATRONES_CARGA_REAL = [
  /\bsrc\s*=\s*["']?https?:/i,
  /\bhref\s*=\s*["']?https?:/i,
  /\bfetch\(\s*["'`]https?:/i,
  /\bimport\(\s*["'`]https?:/i,
  /\bimport\s[^;]*\bfrom\s*["'`]https?:/i,
  /<script[^>]*\ssrc\s*=\s*["']https?:/i,
  /<link[^>]*\shref\s*=\s*["']https?:/i,
  /\.src\s*=\s*["'`]https?:/i,
]

/**
 * Escanea UN archivo (ruta absoluta) y devuelve la lista de hallazgos: `{linea,
 * url, clasificacion: "carga-real"|"inerte", contexto}`. `clasificacion` se decide
 * por la LÍNEA completa donde aparece la URL (heurística, no un parser real de
 * HTML/JS — límite conocido, mismo criterio que el resto de los guardias léxicos de
 * este repo: barato y suficiente para una regresión, nunca una prueba exhaustiva).
 */
export function escanearArchivo(rutaAbsoluta) {
  const contenido = readFileSync(rutaAbsoluta, "utf8")
  const hallazgos = []
  contenido.split(/\r?\n/).forEach((linea, indice) => {
    const matches = linea.match(PATRON_URL)
    if (!matches) return
    const esCargaReal = PATRONES_CARGA_REAL.some((patron) => patron.test(linea))
    for (const url of matches) {
      hallazgos.push({ linea: indice + 1, url, clasificacion: esCargaReal ? "carga-real" : "inerte", contexto: linea.trim().slice(0, 160) })
    }
  })
  return hallazgos
}

const esPrincipal = process.argv[1] && process.argv[1].endsWith("escaneo-assets-offline.mjs")
if (esPrincipal) {
  const archivos = process.argv.slice(2)
  if (archivos.length === 0) {
    console.error("uso: node scripts/escaneo-assets-offline.mjs <archivo...>")
    process.exit(1)
  }
  const resultado = {}
  for (const archivo of archivos) resultado[archivo] = escanearArchivo(archivo)
  console.log(JSON.stringify(resultado, null, 2))
}
