// Las dos funciones puras de la tool `pagina`: validarPagina y renderizarPagina.
//
// POR QUÉ ESTE ARCHIVO. La tool recibe texto de un modelo y lo convierte en un HTML que
// un docente abre en su navegador. Dos cosas no pueden fallar en silencio:
//   - que un argumento mal armado termine en una página rota o a medias (por eso la
//     validación junta TODOS los errores y con uno solo no hay página);
//   - que un texto del modelo se convierta en marcado (por eso hay UNA función de
//     escapado y ningún texto llega a un atributo).
//
// QUÉ SE CARGA. La tool real, copiada a una carpeta temporal con el plugin simulado (igual
// que tests/imprimible.test.mjs) y con la hoja de estilos al lado, en la misma posición
// relativa que tiene instalada. El CSS que se usa es el del repo, no uno de prueba.
//
// CÓMO SE PRUEBA LA INYECCIÓN. Un mismo ataque va en CADA campo de texto, con una seña
// distinta por campo. Se exige que la seña aparezca escapada (el contenido llegó a la
// página) y que no aparezca cruda (no se convirtió en marcado). Pedir sólo «no aparece
// cruda» premiaría borrar el campo: es el error que tests/urls.test.mjs cuenta de sí mismo.
//
// MUTACIONES que ponen rojo este archivo (probadas una por una con el trabajo commiteado,
// restaurando sólo `opencode/tool/pagina.ts` después de cada una):
//   - sacar `esc()` de cualquiera de los lugares donde entra un texto     → «inyección» (y el del campo)
//   - que `esc` deje pasar la comilla simple o la doble                   → «esc escapa los cinco»
//   - cambiar cualquier tope de LIMITES (uno más o uno menos)             → «cada tope»
//   - cortar en el primer error                                           → «junta todos los errores»
//   - aceptar un campo que el tipo no usa                                 → «un campo que el tipo no usa»
//   - no comparar celdas contra columnas                                  → «cada regla»
//   - renombrar una clase en el renderizador (o en la hoja)               → «toda clase tb-»
//   - agregar un espacio al script sin recalcular el hash                 → «el hash de la política»
//   - sacar la navegación con una sola sección / ponerla siempre          → «la navegación»
//   - derivar el id de la sección del título                              → «los ids salen del número»
//   - sacar la etiqueta de texto de un aviso                              → «aviso»
//
// LÍMITE HONESTO: esto mira el HTML como texto. Que el navegador lo dibuje bien, que la
// política de seguridad frene de verdad un script inyectado y que el PDF salga en claro se
// midió a mano en Chromium sin ventana; no quedó un test que lo repita en la suite.
//
// Corre con: node --test tests/pagina-render.test.mjs

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-pagina-render-test")
const CSS = readFileSync(join(REPO, "opencode/tecniabot-web/diseno/sistema.css"), "utf8")
const FUENTE = readFileSync(join(REPO, "opencode/tool/pagina.ts"), "utf8")

let P

before(async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(join(OUT, "tool"), { recursive: true })
  cpSync(join(REPO, "opencode/tecniabot-web/diseno"), join(OUT, "tecniabot-web/diseno"), { recursive: true })
  writeFileSync(
    join(OUT, "tool/mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = FUENTE.replace('/// <reference path="../env.d.ts" />', "").replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  assert.notEqual(src, FUENTE, "no reemplacé el import del plugin: estaría cargando otra cosa")
  writeFileSync(join(OUT, "tool/pagina.ts"), src)
  P = await import(join(OUT, "tool/pagina.ts"))
})

// ── Ayudas ──

/** Un bloque válido de cada tipo. */
const UNO_DE_CADA = {
  seccion: { tipo: "seccion", titulo: "Materiales" },
  texto: { tipo: "texto", texto: "Primer párrafo.\n\nSegundo párrafo." },
  lista: { tipo: "lista", items: ["3 LEDs", "3 resistencias de 220 Ω"] },
  pasos: { tipo: "pasos", items: ["Conectá el USB.", "Cargá el programa."] },
  tabla: { tipo: "tabla", columnas: ["Pieza", "Pin"], filas: [["LED rojo", "GPIO18"], ["LED verde", "GPIO16"]] },
  codigo: { tipo: "codigo", texto: "void setup() {}" },
  aviso: { tipo: "aviso", texto: "El ESP32 trabaja a 3,3 V.", severidad: "aviso" },
  plegable: { tipo: "plegable", titulo: "Si no prende", texto: "Revisá el cable." },
}
const pagina = (bloques, extra = {}) => ({ titulo: "Guía de prueba", bloques, ...extra })

function valida(args) {
  const v = P.validarPagina(args)
  assert.equal(v.ok, true, `esperaba una página válida y dio: ${v.ok ? "" : v.errores.join(" | ")}`)
  return v
}
function errores(args) {
  const v = P.validarPagina(args)
  assert.equal(v.ok, false, "esperaba errores y la validación la dio por buena")
  return v.errores
}
const html = (args) => P.renderizarPagina(valida(args).pagina, CSS)
/** El cuerpo de la página, sin el CSS embebido (que tiene sus propias llaves y comillas). */
const cuerpo = (h) => h.slice(h.indexOf("<body"))
const repetir = (letra, n) => letra.repeat(n)

// ════════════════════════════════════════════════════════════════════════════════════
// Validación
// ════════════════════════════════════════════════════════════════════════════════════

test("un bloque válido de cada tipo pasa, solo y todos juntos", () => {
  assert.deepEqual(Object.keys(UNO_DE_CADA), [...P.TIPOS], "la tabla de ejemplos tiene que cubrir todos los tipos de la tool")
  for (const [tipo, bloque] of Object.entries(UNO_DE_CADA)) {
    const v = valida(pagina([bloque]))
    assert.equal(v.pagina.bloques.length, 1, tipo)
    assert.equal(v.pagina.bloques[0].tipo, tipo)
  }
  const todos = valida(pagina(Object.values(UNO_DE_CADA), { resumen: "De qué va.", placa: "ESP32 DevKit", tema: "oscuro", abrir: true }))
  assert.equal(todos.pagina.bloques.length, 8)
  assert.deepEqual([todos.pagina.resumen, todos.pagina.placa, todos.pagina.tema, todos.abrir], ["De qué va.", "ESP32 DevKit", "oscuro", true])
  assert.deepEqual([valida(pagina([UNO_DE_CADA.texto])).pagina.tema, valida(pagina([UNO_DE_CADA.texto])).abrir], ["claro", false], "por defecto: claro y sin abrir")
})

test("cada regla de validación da un error que nombra el lugar y cómo corregirlo", () => {
  const casos = [
    ["argumentos que no son un objeto", "hola", /tienen que ser un objeto/],
    ["sin título", { bloques: [UNO_DE_CADA.texto] }, /`titulo`: falta\. Pasá el título/],
    ["título que no es texto", pagina([UNO_DE_CADA.texto], { titulo: 42 }), /`titulo`: tiene que ser un texto/],
    ["tema desconocido", pagina([UNO_DE_CADA.texto], { tema: "azul" }), /`tema`: «azul» no existe\. Usá "claro" u "oscuro"/],
    ["abrir que no es booleano", pagina([UNO_DE_CADA.texto], { abrir: "true" }), /`abrir`: tiene que ser true o false/],
    ["sin bloques", { titulo: "Guía" }, /`bloques`: falta\. Pasá de 1 a 40/],
    ["bloques vacío", pagina([]), /`bloques`: falta/],
    ["bloques que no es lista", pagina("texto"), /`bloques`: falta/],
    ["un bloque que no es objeto", pagina(["hola"]), /`bloques\[0\]`: tiene que ser un objeto con `tipo`/],
    ["bloque sin tipo", pagina([{ texto: "hola" }]), /`bloques\[0\]`: falta `tipo`\. Usá uno de: seccion, texto/],
    ["tipo desconocido", pagina([UNO_DE_CADA.texto, { tipo: "parrafo", texto: "x" }]), /`bloques\[1\]`: el tipo «parrafo» no existe\. Usá uno de:/],
    ["campo que no existe", pagina([{ tipo: "texto", texto: "x", color: "rojo" }]), /`bloques\[0\]` \(texto\): `color` no es un campo de esta tool/],
    ["sección sin título", pagina([{ tipo: "seccion" }]), /`bloques\[0\]` \(seccion\): falta `titulo`/],
    ["texto sin texto", pagina([{ tipo: "texto" }]), /`bloques\[0\]` \(texto\): falta `texto`/],
    ["texto en blanco", pagina([{ tipo: "texto", texto: "   \n " }]), /`bloques\[0\]` \(texto\): falta `texto`/],
    ["lista sin items", pagina([{ tipo: "lista" }]), /`bloques\[0\]` \(lista\): falta `items`/],
    ["pasos sin items", pagina([{ tipo: "pasos", items: [] }]), /`bloques\[0\]` \(pasos\): falta `items`/],
    ["items que no es lista", pagina([{ tipo: "lista", items: "uno" }]), /`items` tiene que ser una lista de textos/],
    ["un item que no es texto", pagina([{ tipo: "lista", items: ["uno", 2] }]), /el elemento 2 de `items` tiene que ser un texto/],
    ["un item vacío", pagina([{ tipo: "lista", items: ["uno", "  "] }]), /el elemento 2 de `items` está vacío/],
    ["tabla sin columnas", pagina([{ tipo: "tabla", filas: [["a", "b"]] }]), /`bloques\[0\]` \(tabla\): falta `columnas`/],
    ["tabla sin filas", pagina([{ tipo: "tabla", columnas: ["a", "b"] }]), /`bloques\[0\]` \(tabla\): falta `filas`/],
    ["tabla de una columna", pagina([{ tipo: "tabla", columnas: ["a"], filas: [["x"]] }]), /hay 1 columnas y tienen que ser de 2 a 6\. Para una sola columna usá un bloque «lista»/],
    ["fila con celdas de más", pagina([UNO_DE_CADA.texto, UNO_DE_CADA.texto, UNO_DE_CADA.texto, { tipo: "tabla", columnas: ["a", "b"], filas: [["1", "2"], ["1", "2", "3"]] }]), /^`bloques\[3\]` \(tabla\): la fila 2 tiene 3 celdas y hay 2 columnas\. Pasá 2 celdas por fila\.$/],
    ["fila con celdas de menos", pagina([{ tipo: "tabla", columnas: ["a", "b"], filas: [["1"]] }]), /la fila 1 tiene 1 celda y hay 2 columnas\. Pasá 2 celdas por fila\./],
    ["fila que no es lista", pagina([{ tipo: "tabla", columnas: ["a", "b"], filas: ["1, 2"] }]), /la fila 1 tiene que ser una lista de textos/],
    ["celda que no es texto", pagina([{ tipo: "tabla", columnas: ["a", "b"], filas: [["1", 2]] }]), /el elemento 2 de la fila 1 tiene que ser un texto/],
    ["código sin texto", pagina([{ tipo: "codigo", titulo: "main.cpp" }]), /`bloques\[0\]` \(codigo\): falta `texto`/],
    ["aviso sin severidad", pagina([{ tipo: "aviso", texto: "ojo" }]), /`bloques\[0\]` \(aviso\): falta `severidad`\. Pasá `severidad`: "info", "ok", "aviso" o "error"/],
    ["aviso sin texto", pagina([{ tipo: "aviso", severidad: "info" }]), /`bloques\[0\]` \(aviso\): falta `texto`/],
    ["severidad desconocida", pagina([{ tipo: "aviso", texto: "ojo", severidad: "grave" }]), /la severidad «grave» no existe\. Usá "info", "ok", "aviso" o "error"/],
    ["plegable sin título", pagina([{ tipo: "plegable", texto: "x" }]), /`bloques\[0\]` \(plegable\): falta `titulo`/],
    ["plegable sin contenido", pagina([{ tipo: "plegable", titulo: "Más" }]), /`bloques\[0\]` \(plegable\): falta el contenido\. Pasá `texto`, `items`, o los dos/],
  ]
  for (const [nombre, args, esperado] of casos) {
    const lista = errores(args)
    assert.ok(lista.some((e) => esperado.test(e)), `${nombre}: ningún error coincide con ${esperado}. Dio: ${lista.join(" | ")}`)
  }
  // El plegable admite texto, items, o los dos.
  valida(pagina([{ tipo: "plegable", titulo: "Más", items: ["uno"] }]))
  valida(pagina([{ tipo: "plegable", titulo: "Más", texto: "x", items: ["uno"] }]))
  // Una celda vacía es legítima en una tabla; un renglón vacío en una lista no.
  valida(pagina([{ tipo: "tabla", columnas: ["a", "b"], filas: [["1", ""]] }]))
})

test("junta todos los errores en vez de cortar en el primero", () => {
  const lista = errores({
    titulo: "ab",
    tema: "azul",
    bloques: [{ tipo: "texto" }, { tipo: "parrafo" }, { tipo: "tabla", columnas: ["a", "b"], filas: [["1"], ["1", "2", "3"]] }, { tipo: "aviso", texto: "x", severidad: "grave", items: ["a"] }],
  })
  const tiene = (re) => lista.filter((e) => re.test(e)).length
  assert.equal(tiene(/^`titulo`: tiene 2 caracteres y el mínimo es 3/), 1)
  assert.equal(tiene(/^`tema`/), 1)
  assert.equal(tiene(/^`bloques\[0\]` \(texto\): falta `texto`/), 1)
  assert.equal(tiene(/^`bloques\[1\]`: el tipo «parrafo»/), 1)
  assert.equal(tiene(/^`bloques\[2\]` \(tabla\): la fila [12] /), 2, "las dos filas mal, cada una con su error")
  assert.equal(tiene(/^`bloques\[3\]` \(aviso\)/), 2, "la severidad y el campo de más, los dos")
  assert.equal(lista.length, 8, `esperaba exactamente 8 errores: ${lista.join(" | ")}`)
})

test("un campo que el tipo no usa es un error, no se ignora en silencio", () => {
  const SOBRA = {
    seccion: ["items", "columnas", "filas", "severidad"],
    texto: ["items", "columnas", "filas", "severidad"],
    lista: ["texto", "columnas", "filas", "severidad"],
    pasos: ["texto", "columnas", "filas", "severidad"],
    tabla: ["texto", "items", "severidad"],
    codigo: ["items", "columnas", "filas", "severidad"],
    aviso: ["items", "columnas", "filas"],
    plegable: ["columnas", "filas", "severidad"],
  }
  const VALOR = { titulo: "Un título", texto: "Un texto", items: ["uno"], columnas: ["a", "b"], filas: [["1", "2"]], severidad: "info" }
  let probados = 0
  for (const [tipo, campos] of Object.entries(SOBRA)) {
    for (const campo of campos) {
      const lista = errores(pagina([{ ...UNO_DE_CADA[tipo], [campo]: VALOR[campo] }]))
      assert.equal(lista.length, 1, `${tipo}+${campo}: ${lista.join(" | ")}`)
      assert.match(lista[0], new RegExp(`^\`bloques\\[0\\]\` \\(${tipo}\\): \`${campo}\` no se usa en un bloque «${tipo}» \\(usa: [a-z, ]+\\)\\. Sacalo`), `${tipo}+${campo}`)
      probados++
    }
  }
  assert.equal(probados, 29)
  // Lo que sí admite cada tipo, además de lo que exige.
  for (const tipo of ["texto", "lista", "pasos", "tabla", "codigo", "aviso"]) valida(pagina([{ ...UNO_DE_CADA[tipo], titulo: "Un subtítulo" }]))
  valida(pagina([{ tipo: "seccion", titulo: "Parte 1", texto: "Una bajada." }]))
})

test("un opcional vacío cuenta como que no vino (los modelos chicos rellenan con \"\" y [])", () => {
  const v = valida(pagina([{ tipo: "texto", texto: "Hola.", titulo: "", items: [], columnas: [], filas: [], severidad: "" }], { resumen: "  ", placa: "", tema: "" }))
  assert.deepEqual(v.pagina.bloques[0], { tipo: "texto", texto: "Hola." })
  assert.deepEqual([v.pagina.resumen, v.pagina.placa, v.pagina.tema], [undefined, undefined, "claro"])
})

test("cada tope: el valor justo pasa y uno más no", () => {
  const L = P.LIMITES
  assert.deepEqual(
    { ...L },
    { tituloMin: 3, tituloMax: 120, resumenMax: 600, placaMax: 60, bloquesMax: 40, seccionesMax: 8, tituloDeBloqueMax: 120, textoMax: 2000, codigoMax: 20000, itemsMax: 40, itemMax: 300, columnasMin: 2, columnasMax: 6, filasMax: 60, celdaMax: 200 },
    "los topes son los del encargo",
  )
  const t = UNO_DE_CADA.texto
  const columnas = (n) => Array.from({ length: n }, (_, i) => `c${i}`)
  const casos = [
    ["título mínimo", (n) => pagina([t], { titulo: repetir("a", n) }), 3, 2, /`titulo`: tiene 2 caracteres y el mínimo es 3/],
    ["título máximo", (n) => pagina([t], { titulo: repetir("a", n) }), 120, 121, /`titulo`: tiene 121 caracteres y el máximo es 120/],
    ["resumen", (n) => pagina([t], { resumen: repetir("a", n) }), 600, 601, /`resumen`: tiene 601 caracteres y el máximo es 600/],
    ["placa", (n) => pagina([t], { placa: repetir("a", n) }), 60, 61, /`placa`: tiene 61 caracteres y el máximo es 60/],
    ["bloques", (n) => pagina(Array.from({ length: n }, () => t)), 40, 41, /`bloques`: hay 41 y el máximo es 40/],
    ["secciones", (n) => pagina(Array.from({ length: n }, (_, i) => ({ tipo: "seccion", titulo: `Parte ${i}` }))), 8, 9, /`bloques`: hay 9 secciones y el máximo es 8/],
    ["título de bloque", (n) => pagina([{ tipo: "seccion", titulo: repetir("a", n) }]), 120, 121, /`titulo` tiene 121 caracteres y el máximo es 120/],
    ["texto", (n) => pagina([{ tipo: "texto", texto: repetir("a", n) }]), 2000, 2001, /`texto` tiene 2001 caracteres y el máximo es 2000/],
    ["texto de un aviso", (n) => pagina([{ tipo: "aviso", severidad: "info", texto: repetir("a", n) }]), 2000, 2001, /`texto` tiene 2001 caracteres y el máximo es 2000/],
    ["código", (n) => pagina([{ tipo: "codigo", texto: repetir("a", n) }]), 20000, 20001, /`texto` tiene 20001 caracteres y el máximo es 20000/],
    ["cantidad de items", (n) => pagina([{ tipo: "lista", items: Array.from({ length: n }, () => "x") }]), 40, 41, /`items` tiene 41 elementos y el máximo es 40/],
    ["largo de un item", (n) => pagina([{ tipo: "pasos", items: [repetir("a", n)] }]), 300, 301, /el elemento 1 de `items` tiene 301 caracteres y el máximo es 300/],
    ["columnas mínimas", (n) => pagina([{ tipo: "tabla", columnas: columnas(n), filas: [columnas(n)] }]), 2, 1, /hay 1 columnas y tienen que ser de 2 a 6/],
    ["columnas máximas", (n) => pagina([{ tipo: "tabla", columnas: columnas(n), filas: [columnas(n)] }]), 6, 7, /hay 7 columnas y tienen que ser de 2 a 6\. Partí la tabla/],
    ["filas", (n) => pagina([{ tipo: "tabla", columnas: ["a", "b"], filas: Array.from({ length: n }, () => ["1", "2"]) }]), 60, 61, /hay 61 filas y el máximo es 60/],
    ["celda", (n) => pagina([{ tipo: "tabla", columnas: ["a", "b"], filas: [["1", repetir("a", n)]] }]), 200, 201, /el elemento 2 de la fila 1 tiene 201 caracteres y el máximo es 200/],
  ]
  for (const [nombre, armar, justo, pasado, esperado] of casos) {
    valida(armar(justo))
    const lista = errores(armar(pasado))
    assert.ok(lista.some((e) => esperado.test(e)), `${nombre}: con ${pasado} esperaba ${esperado} y dio: ${lista.join(" | ")}`)
  }
})

// ════════════════════════════════════════════════════════════════════════════════════
// Render
// ════════════════════════════════════════════════════════════════════════════════════

test("la página es un documento autocontenido, en español y con su marca", () => {
  const h = html(pagina([UNO_DE_CADA.texto]))
  assert.ok(h.startsWith('<!doctype html>\n<html lang="es">\n'), "arranca con el doctype y el idioma")
  assert.ok(h.includes('<meta name="generator" content="tecnia-bot pagina">'), "lleva la marca de la tool")
  assert.equal(P.MARCA_GENERADOR, '<meta name="generator" content="tecnia-bot pagina">')
  assert.ok(h.includes(`<style>\n${CSS}\n</style>`), "el CSS de sistema.css va embebido entero")
  assert.match(h, /<style>@page \{ size: A4 portrait; margin: [\d.]+cm; \}<\/style>/, "el papel A4 vertical lo pone la página")
  assert.ok(h.includes("<title>Guía de prueba — Tecnia Bot</title>"))
  assert.ok(h.includes('<h1 class="tb-marca__titulo">Guía de prueba</h1>'))
  assert.ok(h.includes('<button type="button" class="tb-boton" id="boton-tema" aria-pressed="false">Modo oscuro</button>'))
  assert.ok(h.includes('<button type="button" class="tb-boton" id="boton-imprimir">Imprimir / PDF</button>'))
  // Nada que pida red ni cargue otro archivo.
  assert.doesNotMatch(h, /<link\b|<img\b|<iframe\b|<object\b|<embed\b|\bsrc\s*=|https?:\/\//i, "no referencia nada de afuera")
  assert.equal(P.renderizarPagina(valida(pagina([UNO_DE_CADA.texto])).pagina, CSS), h, "es pura: mismos datos, mismos bytes")
})

test("el tema oscuro se marca en la raíz, y el script recuerda la elección dentro de try/catch", () => {
  const oscuro = html(pagina([UNO_DE_CADA.texto], { tema: "oscuro" }))
  assert.ok(oscuro.includes('<html lang="es" data-theme="dark">'))
  assert.ok(oscuro.includes('aria-pressed="true">Modo claro</button>'))
  const s = P.SCRIPT_PAGINA
  assert.match(s, /try \{ guardado = window\.localStorage\.getItem\(CLAVE\) \} catch/, "leer la elección no puede romper la página")
  assert.match(s, /try \{ window\.localStorage\.setItem\(CLAVE, actual\) \} catch/, "guardarla tampoco")
  assert.match(s, /window\.print\(\)/)
  assert.match(s, /beforeprint[\s\S]*details:not\(\[open\]\)[\s\S]*setAttribute\("open", ""\)/, "despliega los plegables para imprimir")
  assert.match(s, /afterprint[\s\S]*removeAttribute\("open"\)/, "y los vuelve a plegar")
  assert.doesNotMatch(s, /<\/script/i)
})

test("el hash de la política de seguridad es el del script que la página emite", () => {
  const h = html(pagina(Object.values(UNO_DE_CADA)))
  const scripts = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  assert.equal(scripts.length, 1, "un solo script")
  assert.equal((h.match(/<script/g) ?? []).length, 1, "y ninguna otra etiqueta de script, con o sin atributos")
  const hash = createHash("sha256").update(scripts[0][1], "utf8").digest("base64")
  const politica = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(h)
  assert.ok(politica, "falta la política de seguridad")
  assert.equal(politica[1], `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'`)
  assert.ok(h.indexOf(politica[0]) < h.indexOf("<style>"), "la política va antes que cualquier contenido")
})

test("texto: párrafos separados por línea en blanco, con subtítulo opcional", () => {
  const h = cuerpo(html(pagina([{ tipo: "texto", titulo: "Antes de empezar", texto: "Uno.\nSigue en la misma.\n\n\nDos." }])))
  assert.ok(h.includes('<div class="tb-bloque"><h3 class="tb-subtitulo">Antes de empezar</h3>\n<p class="tb-texto">Uno.\nSigue en la misma.</p>\n<p class="tb-texto">Dos.</p></div>'), h)
})

test("lista y pasos: viñetas y lista ordenada numerada", () => {
  const h = cuerpo(html(pagina([UNO_DE_CADA.lista, { ...UNO_DE_CADA.pasos, titulo: "Para cargarlo" }])))
  assert.ok(h.includes('<div class="tb-bloque"><ul class="tb-lista"><li>3 LEDs</li><li>3 resistencias de 220 Ω</li></ul></div>'), h)
  assert.ok(h.includes('<div class="tb-bloque"><h3 class="tb-subtitulo">Para cargarlo</h3>\n<ol class="tb-lista tb-lista--numerada"><li>Conectá el USB.</li><li>Cargá el programa.</li></ol></div>'), h)
})

test("tabla: encabezados con scope, una fila por fila y título como caption", () => {
  const h = cuerpo(html(pagina([{ ...UNO_DE_CADA.tabla, titulo: "Conexiones" }])))
  assert.ok(
    h.includes('<div class="tb-tabla-marco"><table class="tb-tabla"><caption>Conexiones</caption><thead><tr><th scope="col">Pieza</th><th scope="col">Pin</th></tr></thead>\n<tbody><tr><td>LED rojo</td><td>GPIO18</td></tr>\n<tr><td>LED verde</td><td>GPIO16</td></tr></tbody></table></div>'),
    h,
  )
})

test("codigo: se conserva tal cual, escapado, con rótulo opcional", () => {
  const texto = '#include <Arduino.h>\nif (a < b && c > d) { Serial.println("hola"); }\n  // sangría'
  const h = cuerpo(html(pagina([{ tipo: "codigo", titulo: "src/main.cpp", texto }])))
  assert.ok(
    h.includes('<div class="tb-codigo"><div class="tb-codigo__rotulo">src/main.cpp</div><pre class="tb-codigo__texto"><code>#include &lt;Arduino.h&gt;\nif (a &lt; b &amp;&amp; c &gt; d) { Serial.println(&quot;hola&quot;); }\n  // sangría</code></pre></div>'),
    h,
  )
})

test("aviso: cada severidad lleva su clase Y su etiqueta de texto", () => {
  assert.deepEqual(Object.keys(P.ETIQUETAS), [...P.SEVERIDADES])
  const etiquetas = { info: "Dato", ok: "Bien", aviso: "Atención", error: "Hay que corregir" }
  for (const [severidad, etiqueta] of Object.entries(etiquetas)) {
    const h = cuerpo(html(pagina([{ tipo: "aviso", severidad, titulo: "Ojo", texto: "Mirá esto." }])))
    assert.ok(
      h.includes(`<div class="tb-aviso tb-aviso--${severidad}" role="note"><span class="tb-aviso__etiqueta">${etiqueta}</span><div class="tb-aviso__cuerpo"><p class="tb-aviso__titulo">Ojo</p><p class="tb-texto">Mirá esto.</p></div></div>`),
      `${severidad}: ${h}`,
    )
  }
})

test("plegable: details con su resumen, texto y lista", () => {
  const h = cuerpo(html(pagina([{ tipo: "plegable", titulo: "Si no prende", texto: "Revisá esto.", items: ["El cable", "El pin"] }])))
  assert.ok(h.includes('<details class="tb-plegable"><summary>Si no prende</summary><div class="tb-plegable__cuerpo"><p class="tb-texto">Revisá esto.</p><ul class="tb-lista"><li>El cable</li><li>El pin</li></ul></div></details>'), h)
  assert.doesNotMatch(h, /<details[^>]*\bopen\b/, "arranca plegado")
})

test("seccion: tarjeta numerada que se lleva los bloques siguientes; los ids salen del número", () => {
  const h = cuerpo(
    html(
      pagina([
        { tipo: "texto", texto: "Antes de la primera sección." },
        { tipo: "seccion", titulo: "Seccion-99 con título raro", texto: "La bajada." },
        { tipo: "texto", texto: "Adentro de la uno." },
        { tipo: "seccion", titulo: "La segunda" },
        { tipo: "lista", items: ["Adentro de la dos."] },
      ]),
    ),
  )
  const tarjetas = h.split("<section").slice(1)
  assert.equal(tarjetas.length, 3, "una tarjeta suelta para lo de antes, y una por sección")
  assert.ok(tarjetas[0].startsWith(' class="tb-tarjeta">') && tarjetas[0].includes("Antes de la primera sección."), "lo de antes de la primera sección va en una tarjeta sin número")
  assert.ok(
    tarjetas[1].startsWith(
      ' class="tb-tarjeta" id="seccion-1" aria-labelledby="t-seccion-1">\n<div class="tb-paso"><span class="tb-paso__numero" aria-hidden="true">1</span><div class="tb-paso__textos"><h2 class="tb-paso__titulo" id="t-seccion-1">Seccion-99 con título raro</h2><p class="tb-paso__bajada">La bajada.</p></div></div>',
    ),
    tarjetas[1],
  )
  assert.ok(tarjetas[1].includes("Adentro de la uno.") && !tarjetas[1].includes("Adentro de la dos."))
  assert.ok(tarjetas[2].startsWith(' class="tb-tarjeta" id="seccion-2" aria-labelledby="t-seccion-2">') && tarjetas[2].includes("Adentro de la dos."))
  const ids = [...h.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1])
  assert.deepEqual(ids, ["boton-tema", "boton-imprimir", "seccion-1", "t-seccion-1", "seccion-2", "t-seccion-2"], "ningún id sale de un texto")
})

test("la navegación aparece sólo con dos secciones o más, y enlaza por número", () => {
  const sinSecciones = cuerpo(html(pagina([UNO_DE_CADA.texto])))
  const conUna = cuerpo(html(pagina([UNO_DE_CADA.seccion, UNO_DE_CADA.texto])))
  assert.doesNotMatch(sinSecciones, /<nav/)
  assert.doesNotMatch(conUna, /<nav/, "con una sola sección no hay a dónde navegar")
  const conDos = cuerpo(html(pagina([UNO_DE_CADA.seccion, UNO_DE_CADA.texto, { tipo: "seccion", titulo: "El programa" }])))
  assert.ok(
    conDos.includes(
      '<nav class="tb-nav" aria-label="Secciones"><ol class="tb-nav__lista">\n<li><a class="tb-nav__enlace" href="#seccion-1"><span class="tb-nav__numero" aria-hidden="true">1</span>Materiales</a></li>\n<li><a class="tb-nav__enlace" href="#seccion-2"><span class="tb-nav__numero" aria-hidden="true">2</span>El programa</a></li>\n</ol></nav>',
    ),
    conDos,
  )
})

test("resumen y placa: la tarjeta de resumen y la etiqueta salen sólo si vinieron", () => {
  const sin = cuerpo(html(pagina([UNO_DE_CADA.texto])))
  assert.doesNotMatch(sin, /tb-resumen|tb-chip/)
  const con = cuerpo(html(pagina([UNO_DE_CADA.texto], { resumen: "De qué va.", placa: "ESP32 DevKit" })))
  assert.ok(con.includes('<section class="tb-tarjeta tb-resumen" aria-labelledby="t-resumen"><h2 class="tb-rotulo" id="t-resumen">En resumen</h2>\n<p class="tb-texto">De qué va.</p></section>'), con)
  assert.ok(con.includes('<span class="tb-chip">ESP32 DevKit</span>'))
  assert.deepEqual(P.contar(valida(pagina(Object.values(UNO_DE_CADA))).pagina), { secciones: 1, bloques: 7 })
})

// ── Seguridad ──

test("esc escapa los cinco caracteres", () => {
  assert.equal(P.esc(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;")
  assert.equal(P.esc("a & b &amp; c"), "a &amp; b &amp;amp; c", "el ampersand va primero y no se saltea")
})

/** El ataque, con una seña por campo para saber cuál se escapó y cuál no. */
// Entra en el tope más chico (120, el de un título): 70 caracteres fijos y dos veces la seña.
const ataque = (sena) => `${sena}<script>alert("${sena}")</script>"onerror='x'</style> javascript:x //e.invalid`
const escapado = (sena) => `${sena}&lt;script&gt;alert(&quot;${sena}&quot;)&lt;/script&gt;&quot;onerror=&#39;x&#39;&lt;/style&gt; javascript:x //e.invalid`

/** Una página con el ataque en TODOS los campos de texto que la tool recibe. */
function paginaAtacada() {
  const senas = []
  const a = (sena) => (senas.push(sena), ataque(sena))
  const args = {
    titulo: a("S-TITULO"),
    resumen: a("S-RESUMEN"),
    placa: "x",
    bloques: [
      { tipo: "texto", titulo: a("S-SUELTO-TITULO"), texto: a("S-SUELTO-TEXTO") },
      { tipo: "seccion", titulo: a("S-SECCION-TITULO"), texto: a("S-SECCION-TEXTO") },
      { tipo: "texto", titulo: a("S-TEXTO-TITULO"), texto: a("S-TEXTO-TEXTO") },
      { tipo: "lista", titulo: a("S-LISTA-TITULO"), items: [a("S-LISTA-ITEM")] },
      { tipo: "pasos", titulo: a("S-PASOS-TITULO"), items: [a("S-PASOS-ITEM")] },
      { tipo: "seccion", titulo: a("S-SECCION2-TITULO") },
      { tipo: "tabla", titulo: a("S-TABLA-TITULO"), columnas: [a("S-TABLA-COLUMNA"), "b"], filas: [[a("S-TABLA-CELDA"), "2"]] },
      { tipo: "codigo", titulo: a("S-CODIGO-TITULO"), texto: a("S-CODIGO-TEXTO") },
      { tipo: "aviso", severidad: "error", titulo: a("S-AVISO-TITULO"), texto: a("S-AVISO-TEXTO") },
      { tipo: "plegable", titulo: a("S-PLEGABLE-TITULO"), texto: a("S-PLEGABLE-TEXTO"), items: [a("S-PLEGABLE-ITEM")] },
    ],
  }
  return { args, senas }
}

test("inyección: el ataque en CADA campo de texto llega escapado y nunca crudo", () => {
  const { args, senas } = paginaAtacada()
  assert.equal(senas.length, 23, "los 23 lugares donde la tool recibe un texto (la placa va aparte)")
  // La placa tiene tope de 60: lleva un ataque más corto, con las mismas piezas.
  args.placa = `S-PLACA<b>"'&</style>`
  const h = P.renderizarPagina(valida(args).pagina, CSS)
  assert.ok(h.includes("S-PLACA&lt;b&gt;&quot;&#39;&amp;&lt;/style&gt;"), "la placa llega escapada")
  assert.ok(!h.includes("S-PLACA<"), "la placa no llega cruda")

  // Cuántas veces se muestra cada campo: el título va al <title> y al <h1>; el de una sección, a la navegación y a su tarjeta.
  const VECES = { "S-TITULO": 2, "S-SECCION-TITULO": 2, "S-SECCION2-TITULO": 2 }
  for (const sena of senas) {
    const veces = h.split(escapado(sena)).length - 1
    assert.equal(veces, VECES[sena] ?? 1, `${sena}: esperaba verlo escapado ${VECES[sena] ?? 1} vez/veces y está ${veces}`)
    assert.ok(!h.includes(`${sena}<`), `${sena} aparece seguido de una etiqueta sin escapar`)
    assert.ok(!h.includes(`alert("${sena}")`), `${sena}: quedó un script con comillas sin escapar`)
  }

  // Y mirando la página entera, sin importar de qué campo vino:
  assert.equal((h.match(/<script/gi) ?? []).length, 1, "el único script es el de la página")
  assert.equal((h.match(/<\/style>/gi) ?? []).length, 2, "los únicos cierres de estilo son los dos de la página")
  const c = cuerpo(h)
  assert.doesNotMatch(c, /<img\b/i, "no se emite ninguna imagen")
  assert.doesNotMatch(c, /<[^>]*\son[a-z]+\s*=/i, "ningún atributo de evento")
  assert.doesNotMatch(c, /<[^>]*\sstyle\s*=/i, "ningún estilo en línea")
  const enlaces = [...c.matchAll(/\bhref="([^"]*)"/g)].map((m) => m[1])
  assert.deepEqual(enlaces, ["#seccion-1", "#seccion-2"], "los únicos enlaces son los de la navegación; una dirección en el texto queda como texto")
})

test("sólo salen las etiquetas y los atributos de la lista; ningún texto del modelo llega a un atributo", () => {
  const { args } = paginaAtacada()
  const c = cuerpo(P.renderizarPagina(valida(args).pagina, CSS)).replace(/<script>[\s\S]*?<\/script>/, "")
  const ETIQUETAS = ["body", "header", "div", "svg", "rect", "path", "span", "h1", "h2", "h3", "button", "nav", "ol", "ul", "li", "a", "main", "section", "p", "table", "caption", "thead", "tbody", "tr", "th", "td", "pre", "code", "details", "summary", "footer", "html"]
  const ATRIBUTOS = ["class", "id", "href", "type", "scope", "role", "aria-hidden", "aria-label", "aria-labelledby", "aria-pressed", "viewBox", "fill", "stroke-width", "stroke-linecap", "stroke-linejoin", "x", "y", "width", "height", "rx", "d"]
  const abiertas = [...c.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*>/g)]
  assert.ok(abiertas.length > 60, `sólo leí ${abiertas.length} etiquetas: no estoy mirando la página`)
  assert.equal(abiertas.length, (c.match(/<[a-zA-Z]/g) ?? []).length, "hay una etiqueta que el lector no entiende (¿un atributo sin comillas?)")
  for (const [entera, nombre, atributos] of abiertas) {
    assert.ok(ETIQUETAS.includes(nombre), `etiqueta fuera de la lista: ${entera}`)
    for (const [, atributo, valor] of atributos.matchAll(/\s+([\w-]+)(?:="([^"]*)")?/g)) {
      assert.ok(ATRIBUTOS.includes(atributo), `atributo fuera de la lista: ${entera}`)
      assert.doesNotMatch(valor ?? "", /S-[A-Z0-9-]+|alert|javascript/, `un texto del modelo llegó a un atributo: ${entera}`)
    }
  }
})

// ── La hoja y el renderizador hablan de las mismas clases ──

test("toda clase tb- que emite el renderizador existe en sistema.css", () => {
  const sinComentarios = CSS.replace(/\/\*[\s\S]*?\*\//g, "")
  const enLaHoja = new Set([...sinComentarios.matchAll(/\.(tb-[a-z0-9_-]+)/g)].map((m) => m[1]))
  assert.ok(enLaHoja.size >= 40, "no estoy leyendo la hoja")

  // 1. Las que salen de verdad en una página con todos los tipos, las cuatro severidades y todos los opcionales.
  const { args } = paginaAtacada()
  args.bloques.push(...["info", "ok", "aviso"].map((severidad) => ({ tipo: "aviso", severidad, texto: "x" })))
  const c = cuerpo(P.renderizarPagina(valida(args).pagina, CSS))
  const emitidas = new Set([...c.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)))
  assert.ok(emitidas.size >= 30, `sólo vi ${emitidas.size} clases en la página`)
  assert.deepEqual([...emitidas].filter((clase) => !clase.startsWith("tb-")), [], "el renderizador sólo usa clases de la hoja compartida")
  assert.deepEqual([...emitidas].filter((clase) => !enLaHoja.has(clase)).sort(), [], "clases que la página usa y la hoja no define (quedan sin estilo)")

  // 2. Las que están escritas en el código de la tool, aunque esta página no las haya disparado.
  const codigo = FUENTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const escritas = new Set([...codigo.matchAll(/\btb-[a-z0-9]+(?:-[a-z0-9]+)*(?:__[a-z0-9-]+)?(?:--[a-z0-9]+)?/g)].map((m) => m[0]))
  escritas.delete("tb-aviso--") // el prefijo de `tb-aviso--${severidad}`
  for (const severidad of P.SEVERIDADES) escritas.add(`tb-aviso--${severidad}`)
  assert.deepEqual([...escritas].filter((clase) => !enLaHoja.has(clase)).sort(), [], "clases escritas en pagina.ts que la hoja no define")
  assert.deepEqual([...escritas].filter((clase) => !emitidas.has(clase)).sort(), [], "clases escritas en pagina.ts que la página de prueba no llegó a emitir: este test no las está mirando")
})
