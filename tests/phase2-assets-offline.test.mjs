// Phase 2, Slice 1 — offline por diseño (writer W3, tarea 4).
// PHASE_2_SLICE_1_DESIGN.md §2.9: "Cero CDN y cero recursos remotos." Escanea la
// página + los tres JS que este slice escribió (`scripts/escaneo-assets-offline.mjs`,
// heurística léxica: distingue URL en un SINK de carga real — `src=`/`href=`/
// `fetch(`/`import(`/`<script src>`/`<link href>` — de una URL INERTE que ningún
// runtime pediría por red).
//
// Los DOS bundles de terceros (`wokwi-bundle.js`/`componentes-extra.js`,
// `opencode/tecniabot-web/`, el mismo bundle que ya usa `circuito.ts`) se reportan
// como EVIDENCIA (briefing tarea 4: "reportalo con evidencia sin modificarlo") — el
// test SÍ falla si aparece alguna URL de CARGA REAL ahí (eso rompería offline de
// verdad), pero no falla por namespaces XML (`xmlns="http://www.w3.org/2000/svg"`) ni
// citas de licencia/datasheet dentro de un comentario, que son inertes.

import { test } from "node:test"
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir } from "./phase2-helpers.mjs"
import { escanearArchivo } from "../scripts/escaneo-assets-offline.mjs"

const ARCHIVOS_PROPIOS_DEL_SLICE = ["opencode/vista-fisica/web/index.html", "opencode/vista-fisica/web/app.js", "opencode/vista-fisica/web/pintar.js", "opencode/vista-fisica/web/plan-de-pintado.js"]

test("index.html/app.js/pintar.js/plan-de-pintado.js no referencian NINGUNA URL remota (ni inerte ni de carga) — son enteramente nuestros, cero excusa para tener una", () => {
  for (const relativo of ARCHIVOS_PROPIOS_DEL_SLICE) {
    const hallazgos = escanearArchivo(join(REPO, relativo))
    assert.deepEqual(hallazgos, [], `${relativo} referencia URL remota: ${JSON.stringify(hallazgos)}`)
  }
})

test("wokwi-bundle.js: ninguna URL clasifica como CARGA REAL — evidencia: 72 URLs inertes (namespaces xmlns de SVG), 0 en src=/href=/fetch/import/<script src>/<link href>", () => {
  const hallazgos = escanearArchivo(join(REPO, "opencode/tecniabot-web/wokwi-bundle.js"))
  const cargaReal = hallazgos.filter((h) => h.clasificacion === "carga-real")
  assert.deepEqual(cargaReal, [], `wokwi-bundle.js tiene URL(es) de carga real: ${JSON.stringify(cargaReal, null, 2)}`)
  assert.ok(hallazgos.length > 0, "evidencia esperada: el bundle SI tiene namespaces xmlns (si esto da 0, el bundle cambio y hay que re-verificar a mano)")
  assert.ok(
    hallazgos.every((h) => h.clasificacion === "inerte"),
    "todo hallazgo en wokwi-bundle.js tiene que ser inerte",
  )
})

test("componentes-extra.js: ninguna URL clasifica como CARGA REAL — evidencia: namespaces xmlns + una cita de datasheet en comentario, ambos inertes", () => {
  const hallazgos = escanearArchivo(join(REPO, "opencode/tecniabot-web/componentes-extra.js"))
  const cargaReal = hallazgos.filter((h) => h.clasificacion === "carga-real")
  assert.deepEqual(cargaReal, [], `componentes-extra.js tiene URL(es) de carga real: ${JSON.stringify(cargaReal, null, 2)}`)
  assert.ok(
    hallazgos.every((h) => h.clasificacion === "inerte"),
    "todo hallazgo en componentes-extra.js tiene que ser inerte",
  )
})

test("el clasificador SI distingue carga real de inerte — fixtures descartables en un directorio temporal, nunca en el repo", () => {
  const dir = nuevoDir("escaneo-offline-fixtures")

  const rutaInerte = join(dir, "solo-inerte.js")
  writeFileSync(rutaInerte, '// ver https://ejemplo.invalido/licencia\nconst xmlns = "http://www.w3.org/2000/svg"\n')
  const hallazgosInerte = escanearArchivo(rutaInerte)
  assert.equal(hallazgosInerte.length, 2)
  assert.ok(hallazgosInerte.every((h) => h.clasificacion === "inerte"))

  const rutaCargaSrc = join(dir, "carga-src.html")
  writeFileSync(rutaCargaSrc, '<script src="https://ejemplo.invalido/cdn/lib.js"></script>\n')
  const hallazgosSrc = escanearArchivo(rutaCargaSrc)
  assert.equal(hallazgosSrc.length, 1)
  assert.equal(hallazgosSrc[0].clasificacion, "carga-real")

  const rutaCargaFetch = join(dir, "carga-fetch.js")
  writeFileSync(rutaCargaFetch, 'fetch("https://ejemplo.invalido/api")\n')
  const hallazgosFetch = escanearArchivo(rutaCargaFetch)
  assert.equal(hallazgosFetch.length, 1)
  assert.equal(hallazgosFetch[0].clasificacion, "carga-real")

  const rutaCargaImport = join(dir, "carga-import.js")
  writeFileSync(rutaCargaImport, 'import { algo } from "https://ejemplo.invalido/modulo.js"\n')
  const hallazgosImport = escanearArchivo(rutaCargaImport)
  assert.equal(hallazgosImport.length, 1)
  assert.equal(hallazgosImport[0].clasificacion, "carga-real")

  const rutaSinNada = join(dir, "sin-nada.js")
  writeFileSync(rutaSinNada, "export const x = 1\n")
  assert.deepEqual(escanearArchivo(rutaSinNada), [])
})
