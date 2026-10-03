// Phase 3 — Vertical #2, T8 (contrato §11): Blockly 13.3.0 vendorizado, servido localmente, offline y
// SIN relajar la CSP. Los dos archivos son BYTE-IDÉNTICOS a los del tarball oficial verificado; el
// servidor los entrega desde su lista blanca explícita; cero cargas remotas; ningún generador ni
// serialización en el código propio.

import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { escanearArchivo } = await import(join(REPO, "scripts/escaneo-assets-offline.mjs"))

const dirVendor = join(REPO, "opencode/tecniabot-web")
const dirWeb = join(REPO, "opencode/vista-fisica/web")
// sha256 de los archivos del tarball `blockly-13.3.0.tgz` (sha512 qAHFGMGT…IRPEw==, verificado fuera del repo)
const SHA256 = {
  "blockly_compressed.js": "d3f46af56951a7aed27f09f872dca66ed70a932ca8be9aade3d9df06ceacd078",
  "blockly-es.js": "432e126da36a91203029c418a0d399c3dadbb9811730e22b9ee9930ce62c60a1",
}
const BYTES = { "blockly_compressed.js": 640346, "blockly-es.js": 56482 }
const CSP_ACTUAL = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'"
const sha = (buf) => createHash("sha256").update(buf).digest("hex")

test("T8 los archivos vendorizados existen, son byte-idénticos al tarball (sha256 + tamaño) y viven fuera de vista-fisica/web", () => {
  for (const [nombre, hash] of Object.entries(SHA256)) {
    const ruta = join(dirVendor, nombre)
    assert.ok(existsSync(ruta), `falta ${nombre}`)
    const buf = readFileSync(ruta)
    assert.equal(sha(buf), hash, nombre)
    assert.equal(buf.length, BYTES[nombre], nombre)
    assert.equal(existsSync(join(dirWeb, nombre)), false, "el vendor no vive en vista-fisica/web")
  }
})

test("T8 BLOCKLY-VERSION.md documenta versión, origen, hashes del tarball y de cada archivo, licencia y alcance", () => {
  const nota = readFileSync(join(dirVendor, "BLOCKLY-VERSION.md"), "utf8")
  assert.match(nota, /13\.3\.0/)
  assert.match(nota, /https:\/\/registry\.npmjs\.org\/blockly\/-\/blockly-13\.3\.0\.tgz/)
  assert.ok(nota.includes("qAHFGMGTSF67Lupr3pjZz9LQu4JCFdN76CMZxegBKiveZreK08yXhaCz0g9q9/xe5GEdoeFT3POAlQavPIRPEw=="))
  assert.ok(nota.includes("18947fe0f4992bbf1ee5051e2d18dabee7ee9581"))
  for (const [nombre, hash] of Object.entries(SHA256)) {
    assert.ok(nota.includes(hash), `hash de ${nombre}`)
    assert.ok(nota.includes(String(BYTES[nombre])), `tamaño de ${nombre}`)
  }
  assert.match(nota, /Apache-2\.0/)
  assert.match(nota, /no generators|sin generadores/i)
  assert.match(nota, /offline/i)
})

test("T8 LICENSE-blockly es la licencia Apache-2.0 del paquete", () => {
  const lic = readFileSync(join(dirVendor, "LICENSE-blockly"), "utf8")
  assert.match(lic, /Apache License/)
  assert.match(lic, /Version 2\.0, January 2004/)
})

test("T8 el servidor sirve /assets/blockly_compressed.js y /assets/blockly-es.js: 200, text/javascript, byte-idénticos, CSP SIN cambios", async () => {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("p3-vend"), idProyecto: nuevoIdProyecto("p3-vend") })
  const servidor = await iniciarServidor({ servicio })
  try {
    for (const nombre of Object.keys(SHA256)) {
      const r = await fetch(new URL(`/assets/${nombre}`, servidor.url))
      assert.equal(r.status, 200, nombre)
      assert.match(r.headers.get("content-type"), /^text\/javascript/)
      assert.equal(r.headers.get("content-security-policy"), CSP_ACTUAL)
      assert.equal(r.headers.get("x-content-type-options"), "nosniff")
      assert.equal(sha(Buffer.from(await r.arrayBuffer())), SHA256[nombre])
    }
    const idx = await fetch(new URL("/", servidor.url))
    assert.equal(idx.headers.get("content-security-policy"), CSP_ACTUAL)
    await idx.arrayBuffer()
    // sólo lo estrictamente necesario: sin medios vendorizados ni rutas de carpeta
    const m = await fetch(new URL("/assets/media/sprites.png", servidor.url))
    assert.equal(m.status, 404)
    await m.arrayBuffer()
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("T8 escáner offline: 0 cargas reales en los dos archivos vendorizados", () => {
  for (const nombre of Object.keys(SHA256)) {
    const reales = escanearArchivo(join(dirVendor, nombre)).filter((h) => h.clasificacion === "carga-real")
    assert.deepEqual(reales, [], nombre)
  }
})

test("T8 index.html carga Blockly núcleo y luego es.js, como <script> clásicos y externos, ANTES de app.js, sin inline ni remotos", () => {
  const html = readFileSync(join(dirWeb, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "")
  const srcs = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1])
  const rutas = srcs.map((a) => /src="([^"]+)"/.exec(a)?.[1])
  assert.ok(!rutas.includes(undefined), "ningún <script> inline")
  const iCore = rutas.indexOf("/assets/blockly_compressed.js")
  const iEs = rutas.indexOf("/assets/blockly-es.js")
  const iApp = rutas.indexOf("/assets/app.js")
  assert.ok(iCore >= 0 && iEs > iCore && iApp > iEs, `orden: ${rutas}`)
  assert.ok(!/type="module"/.test(srcs[iCore]) && !/type="module"/.test(srcs[iEs]), "clásicos (UMD)")
  assert.ok(!/https?:\/\//.test(rutas.join(" ")))
})

test("T8 código propio: sin generadores ni serialización, sin remotos, y el adaptador fija sounds:false y una media LOCAL", () => {
  for (const f of readdirSync(dirWeb).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(join(dirWeb, f), "utf8")
    assert.ok(!/serialization|Xml\.|workspaceToCode|javascriptGenerator|\bGenerator\b/.test(src), `${f}: generador/serialización`)
  }
  const adaptador = readFileSync(join(dirWeb, "adaptador-blockly.js"), "utf8")
  assert.match(adaptador, /sounds:\s*false/)
  assert.match(adaptador, /media\s*=\s*"\/assets\/blockly\/media\/"/)
  assert.ok(!/https?:\/\//.test(adaptador.replace(/\/\/.*$/gm, "")), "ninguna URL remota")
})

// ── T9d: el único medio que Blockly pide (sprites del menú desplegable), servido por entrada explícita ──
const SPRITES = { ruta: "blockly-media/sprites.svg", sha256: "862de0ee081fa9baf504e673736d7446439c15246452258cab964a82566ef40f", bytes: 1775 }

test("T9d sprites.svg vendorizado: byte-idéntico al del tarball (sha256 + tamaño), documentado en BLOCKLY-VERSION.md, escáner offline 0", () => {
  const buf = readFileSync(join(dirVendor, SPRITES.ruta))
  assert.equal(sha(buf), SPRITES.sha256)
  assert.equal(buf.length, SPRITES.bytes)
  const nota = readFileSync(join(dirVendor, "BLOCKLY-VERSION.md"), "utf8")
  assert.ok(nota.includes(SPRITES.sha256) && nota.includes(String(SPRITES.bytes)) && nota.includes("sprites.svg"))
  assert.deepEqual(escanearArchivo(join(dirVendor, SPRITES.ruta)).filter((h) => h.clasificacion === "carga-real"), [])
})

test("T9d el servidor sirve GET /assets/blockly/media/sprites.svg: 200, image/svg+xml, mismas cabeceras de seguridad, CSP sin cambios, byte-idéntico", async () => {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("p3-vend2"), idProyecto: nuevoIdProyecto("p3-vend2") })
  const servidor = await iniciarServidor({ servicio })
  try {
    const r = await fetch(new URL("/assets/blockly/media/sprites.svg", servidor.url))
    assert.equal(r.status, 200)
    assert.match(r.headers.get("content-type"), /^image\/svg\+xml/)
    assert.equal(r.headers.get("content-security-policy"), CSP_ACTUAL)
    assert.equal(r.headers.get("x-content-type-options"), "nosniff")
    assert.equal(sha(Buffer.from(await r.arrayBuffer())), SPRITES.sha256)
    // los .js siguen igual
    const js = await fetch(new URL("/assets/blockly_compressed.js", servidor.url))
    assert.match(js.headers.get("content-type"), /^text\/javascript/)
    await js.arrayBuffer()
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("T9d cualquier otro /assets/blockly/media/<x> es 404: sin servir carpetas ni unir rutas", async () => {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir("p3-vend3"), idProyecto: nuevoIdProyecto("p3-vend3") })
  const servidor = await iniciarServidor({ servicio })
  try {
    for (const ruta of ["/assets/blockly/media/", "/assets/blockly/media", "/assets/blockly/media/click.mp3", "/assets/blockly/media/dropdown-arrow.svg", "/assets/blockly/media/../sprites.svg", "/assets/blockly/media/%2e%2e/sprites.svg", "/assets/blockly-media/sprites.svg", "/assets/blockly/"]) {
      const r = await fetch(new URL(ruta, servidor.url))
      assert.equal(r.status, 404, ruta)
      await r.arrayBuffer()
    }
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
})

test("T9d la lista blanca sigue siendo explícita: cada nombre es una cadena literal, sin lectura de directorios", () => {
  const src = readFileSync(join(REPO, "opencode/servidor/servidor-proyecto.ts"), "utf8")
  const bloque = /function construirRutasDeAssets[\s\S]*?\n}\n/.exec(src)[0].replace(/\/\/.*$/gm, "")
  assert.match(bloque, /\["blockly\/media\/sprites\.svg"/)
  assert.ok(!/readdirSync|\.\.\.|glob/i.test(bloque))
})
