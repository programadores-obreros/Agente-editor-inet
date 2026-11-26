// Phase 3 — Vertical #2: toda dependencia que el navegador pide (cada `import "./x.js"` de web/*.js y
// cada <script src="/assets/..."> de index.html) tiene que estar en la lista blanca del servidor; si no,
// el navegador recibe un 404 y el ES module entero muere. Complementa a los tests de transporte.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"
import { recursosDe } from "./ventana-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { construirRutasDeAssets } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
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

// AGREGADO EL 2026-11-26. El encabezado de este archivo siempre dijo que cubría también «cada
// <script src="/assets/..."> de index.html», pero la única prueba que había miraba los `import`
// de los JS. Los `<script src>` los miraba a medias otra prueba (sólo que dieran 200) y un
// `<link href>` no lo miraba nadie, porque no había ninguno. Ahora la página carga una hoja de
// estilos: si la pide con un nombre que el servidor no sirve, o el servidor la manda con el tipo
// de contenido equivocado, el navegador la descarta y la página queda sin diseño.
test("cada <script src> y cada <link href> de index.html se sirve desde /assets/, con su tipo y el contenido del archivo", async () => {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("p3-assets-html"), idProyecto: nuevoIdProyecto("p3-assets-html") })
  const servidor = await iniciarServidor({ servicio })
  try {
    const { scripts, hojas } = recursosDe(readFileSync(join(web, "index.html"), "utf8"))
    assert.ok(scripts.length >= 5, `sólo encontré ${scripts.length} <script src>: no estoy leyendo la página`)
    const rutas = construirRutasDeAssets()
    for (const [recursos, tipo] of [[scripts, /^text\/javascript; charset=utf-8$/], [hojas, /^text\/css; charset=utf-8$/]]) {
      for (const direccion of recursos) {
        assert.ok(typeof direccion === "string" && direccion.startsWith("/assets/"), `${direccion}: la página pide algo que no es de /assets/`)
        const nombre = direccion.slice("/assets/".length)
        assert.ok(rutas.has(nombre), `${direccion} no está en la lista blanca: el navegador recibiría un 404`)
        const r = await pedir(servidor, direccion)
        assert.equal(r.estado, 200, direccion)
        assert.match(r.tipo, tipo, `${direccion}: con nosniff, el navegador descarta un recurso con el tipo de contenido equivocado`)
        assert.ok(r.cuerpo.equals(readFileSync(rutas.get(nombre))), `${direccion}: contenido distinto del archivo`)
      }
    }
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})
