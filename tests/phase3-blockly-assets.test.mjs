// Phase 3 — Vertical #2: toda dependencia que el navegador pide (cada `import "./x.js"` de web/*.js y
// cada <script src="/assets/..."> de index.html) tiene que estar en la lista blanca del servidor; si no,
// el navegador recibe un 404 y el ES module entero muere. Complementa a los tests de transporte.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const web = join(REPO, "opencode/vista-fisica/web")

async function pedir(servidor, ruta) {
  const r = await fetch(new URL(ruta, servidor.url))
  return { estado: r.status, tipo: r.headers.get("content-type"), cuerpo: Buffer.from(await r.arrayBuffer()) }
}

test("cada import relativo de web/*.js se sirve desde /assets/ con el mismo contenido y JS", async () => {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("p3-assets"), idProyecto: nuevoIdProyecto("p3-assets") })
  const servidor = await iniciarServidor({ servicio })
  try {
    const importados = new Set()
    for (const f of readdirSync(web).filter((x) => x.endsWith(".js"))) {
      for (const m of readFileSync(join(web, f), "utf8").matchAll(/from\s+"\.\/([\w.-]+\.js)"/g)) importados.add(m[1])
    }
    assert.ok(importados.size >= 4)
    for (const nombre of importados) {
      const r = await pedir(servidor, `/assets/${nombre}`)
      assert.equal(r.estado, 200, `/assets/${nombre} no está en la lista blanca`)
      assert.match(r.tipo, /^text\/javascript/)
      assert.ok(r.cuerpo.equals(readFileSync(join(web, nombre))), `${nombre}: contenido distinto`)
    }
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})
