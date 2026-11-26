// La ventana «vista física» carga la hoja de estilos compartida como ARCHIVO SERVIDO.
//
// POR QUÉ ESTE ARCHIVO (2026-11-26). Hasta acá la ventana traía todo su CSS en un `<style>`
// propio: una tercera paleta, distinta de la de las páginas que arma la tool `pagina`. El
// rediseño la pasa a `tecniabot-web/diseno/sistema.css`, la misma hoja. Tres cosas podían salir
// mal sin que nada avisara, y son las que se miden acá:
//   1. El servidor mandaba como JavaScript todo lo que no fuera `.svg`. Con `nosniff`, el
//      navegador descarta una hoja servida así: la página queda sin diseño y la consola es el
//      único lugar donde se entera alguien.
//   2. Alguien «resuelve» lo anterior copiando la hoja a `vista-fisica/web/`. Dos copias de la
//      hoja son dos diseños a la semana siguiente.
//   3. Para cargar la hoja se afloja la política de seguridad de la página.
//
// MUTACIONES que ponen rojo este archivo (probadas con el cambio ya commiteado):
//   - sacar la rama `.css` de `tipoDeContenidoDe`                         → «el servidor sirve la hoja…»
//   - sacar `sistema.css` de la lista blanca                              → «el servidor sirve la hoja…»
//   - apuntar la entrada a OTRO archivo con el mismo contenido            → «fuente única…»
//   - agregar `https://ejemplo.invalido` a `style-src` de la CSP          → «la política de seguridad no cambió»
//
// LÍMITE HONESTO: que el navegador APLIQUE la hoja (y que la CSP no la frene) no se prueba acá:
// se miró en Chromium real, con la consola en cero. Esto mide lo que el servidor manda.
//
// Corre con: node --test tests/ventana-hoja.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, realpathSync } from "node:fs"
import { join } from "node:path"
import { REPO, nuevoDir, nuevoIdProyecto } from "./phase2-helpers.mjs"
import { recursosDe, hojasNoPermitidas } from "./ventana-helpers.mjs"

const { obtenerServicioDeProyectoConVista } = await import(join(REPO, "opencode/servidor/servicio-con-vista.ts"))
const { iniciarServidor, construirRutasDeAssets, tipoDeContenidoDe } = await import(join(REPO, "opencode/servidor/servidor-proyecto.ts"))
const { rutaDelSistemaCss, leerSistemaCss } = await import(join(REPO, "opencode/tool/pagina.ts"))

const HOJA_DEL_REPO = join(REPO, "opencode/tecniabot-web/diseno/sistema.css")
// La política de la página, escrita entera a propósito: si alguien la cambia, que sea cambiando esto.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'"

async function conServidor(nombre, fn) {
  const servicio = obtenerServicioDeProyectoConVista({ directorio: nuevoDir(nombre), idProyecto: nuevoIdProyecto("hoja") })
  const servidor = await iniciarServidor({ servicio })
  try {
    return await fn(servidor)
  } finally {
    await servidor.cerrar()
    servicio.cerrar()
  }
}

test("el tipo de contenido sale de la extensión: una hoja es text/css, no JavaScript", () => {
  assert.equal(tipoDeContenidoDe("sistema.css"), "text/css; charset=utf-8")
  assert.equal(tipoDeContenidoDe("app.js"), "text/javascript; charset=utf-8")
  assert.equal(tipoDeContenidoDe("blockly/media/sprites.svg"), "image/svg+xml")
})

test("el servidor sirve la hoja en /assets/sistema.css: 200, text/css, nosniff y los bytes del archivo", async () => {
  await conServidor("hoja-servida", async (servidor) => {
    const r = await fetch(new URL("/assets/sistema.css", servidor.url))
    assert.equal(r.status, 200, "la hoja no está en la lista blanca del servidor")
    assert.equal(r.headers.get("content-type"), "text/css; charset=utf-8", "con nosniff, una hoja con otro tipo de contenido el navegador la descarta")
    assert.equal(r.headers.get("x-content-type-options"), "nosniff")
    const cuerpo = Buffer.from(await r.arrayBuffer())
    assert.ok(cuerpo.length > 5000, "la hoja servida está vacía o cortada")
    assert.ok(cuerpo.equals(readFileSync(HOJA_DEL_REPO)), "lo servido no es el archivo de la hoja")

    const cabeza = await fetch(new URL("/assets/sistema.css", servidor.url), { method: "HEAD" })
    assert.equal(cabeza.status, 200)
    assert.equal(cabeza.headers.get("content-type"), "text/css; charset=utf-8")
    assert.equal(Number(cabeza.headers.get("content-length")), cuerpo.length)
  })
})

test("fuente única: lo que sirve el servidor es, byte a byte, el archivo que embebe la tool pagina", async () => {
  // El MISMO archivo, no una copia igual: la ruta de la lista blanca y la de la tool son una sola.
  const rutaServida = construirRutasDeAssets().get("sistema.css")
  assert.ok(rutaServida, "la lista blanca no tiene la hoja")
  assert.equal(realpathSync(rutaServida), realpathSync(rutaDelSistemaCss()), "el servidor y la tool `pagina` leen hojas distintas: hay dos fuentes de diseño")
  assert.equal(realpathSync(rutaServida), realpathSync(HOJA_DEL_REPO))

  const embebida = leerSistemaCss()
  assert.equal(embebida.ok, true, "precondición: la tool encuentra su hoja")
  await conServidor("hoja-unica", async (servidor) => {
    const servida = Buffer.from(await (await fetch(new URL("/assets/sistema.css", servidor.url))).arrayBuffer())
    assert.ok(servida.equals(Buffer.from(embebida.css, "utf8")), "la ventana y las páginas de la tool no reciben la misma hoja")
  })
  // Y no hay una segunda hoja escondida al lado de la página.
  assert.deepEqual(readdirSync(join(REPO, "opencode/vista-fisica/web")).filter((f) => f.endsWith(".css")), [], "una hoja copiada a vista-fisica/web/ es una segunda fuente de diseño")
})

test("la política de seguridad no cambió para servir la hoja", async () => {
  await conServidor("hoja-csp", async (servidor) => {
    for (const ruta of ["/", "/assets/sistema.css", "/assets/app.js"]) {
      const r = await fetch(new URL(ruta, servidor.url))
      await r.arrayBuffer()
      assert.equal(r.headers.get("content-security-policy"), CSP, ruta)
    }
  })
})

test("el buscador de hojas no permitidas marca lo que tiene que marcar", () => {
  const lista = ["sistema.css", "app.js"]
  const pagina = (cabeza) => `<!doctype html><html><head>${cabeza}</head><body></body></html>`
  assert.deepEqual(hojasNoPermitidas(pagina('<link rel="stylesheet" href="/assets/sistema.css">'), lista), [], "la hoja compartida, de este servidor, es la única forma permitida")
  assert.deepEqual(recursosDe(pagina("<link href='/assets/sistema.css' rel='stylesheet'><script src=\"/assets/app.js\"></script>")), { scripts: ["/assets/app.js"], hojas: ["/assets/sistema.css"] })
  const malas = [
    ['<link rel="stylesheet" href="https://ejemplo.invalido/x.css">', /no es una hoja de este servidor/],
    ['<link rel="stylesheet" href="//cdn.ejemplo.invalido/x.css">', /no es una hoja de este servidor/],
    ['<link rel="stylesheet" href="estilos.css">', /no es una hoja de este servidor/],
    ['<link rel="stylesheet" href="/assets/otra.css">', /no está en la lista blanca/],
    ['<link rel="stylesheet" href="/assets/app.js">', /no es una hoja de estilos/],
    ['<link rel=stylesheet href=/assets/otra.css>', /no está en la lista blanca/],
    ['<link rel="stylesheet">', /sin href/],
    ['<style>@import "https://ejemplo.invalido/x.css";</style>', /@import/],
  ]
  for (const [cabeza, esperado] of malas) {
    const hallado = hojasNoPermitidas(pagina(cabeza), lista)
    assert.equal(hallado.length, 1, `tenía que marcar ${cabeza} y marcó ${JSON.stringify(hallado)}`)
    assert.match(hallado[0], esperado)
  }
  // Lo que no carga nada no se marca: un <link> comentado, un <link> que no es hoja, un @import en un comentario de CSS.
  assert.deepEqual(hojasNoPermitidas(pagina('<!-- <link rel="stylesheet" href="https://x.invalido/a.css"> --><link rel="icon" href="/favicon.ico"><style>/* @import "x" */ p { margin: 0; }</style>'), lista), [])
})

test("index.html sólo carga hojas de estilos de este servidor que están en la lista blanca", () => {
  const html = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8")
  assert.deepEqual(hojasNoPermitidas(html, [...construirRutasDeAssets().keys()]), [])
})
