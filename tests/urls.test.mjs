// Las rutas que el bot le muestra al docente tienen que ser abribles.
//
// POR QUÉ ESTE ARCHIVO. En Windows la ruta no es una URL:
// C:\Users\Maria Jose\hoja.html interpolado en un file:// da barras invertidas,
// falta la tercera barra, y el espacio sin escapar. Pegado en el navegador no
// abre nada. Y aparece en el peor momento: es el texto de respaldo que se
// muestra JUSTO cuando el auto-open ya falló.
//
// ── POR QUÉ ESTE ARCHIVO SE REESCRIBIÓ ────────────────────────────────────
//
// La primera versión tenía DOS defectos, los dos encontrados por el QA:
//
// 1. Probaba una COPIA A MANO de comoUrl en un archivo aparte, no la función de
//    los tools. El QA destripó las tres copias de producción a la vez y los 82
//    tests pasaron igual.
//
// 2. Su única regla era "prohibido interpolar la ruta cruda". BORRAR la
//    interpolación satisface eso exactamente igual que arreglarla — y eso fue lo
//    que pasó: en circuito.ts la ruta desapareció de tres mensajes y el docente
//    quedó leyendo "pegá esto:" con nada abajo. El test premió la deleción.
//
// Ahora se importa la función de cada tool y se prueba lo que devuelve, y hay
// una regla que exige que el mensaje TENGA la ruta — no sólo que no la tenga mal.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const TOOLS = join(REPO, "opencode", "tool")
const OUT = join(os.tmpdir(), "tecniabot-urls-test")

/** Los tools que le muestran una ruta al docente cuando el auto-open falla. */
const CON_RUTA = ["ficha.ts", "imprimible.ts", "ayuda.ts", "circuito.ts"]

const cargados = {}

/** El código sin comentarios: acá se explica el bug citándolo, y eso no cuenta. */
function codigoDe(archivo) {
  return readFileSync(join(TOOLS, archivo), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

before(async () => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  for (const f of CON_RUTA) {
    const src = readFileSync(join(TOOLS, f), "utf8")
      .replace('/// <reference path="../env.d.ts" />', "")
      .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
    writeFileSync(join(OUT, f), src)
    cargados[f] = await import(join(OUT, f))
  }
})

test("los cuatro tools arman bien la URL de Windows", () => {
  // Se prueba la función DE CADA TOOL, no una copia. Están duplicadas a
  // propósito (los tools de OpenCode no se importan entre sí), así que cada
  // copia se puede romper sola y hay que mirarlas una por una.
  for (const f of CON_RUTA) {
    const { comoUrl } = cargados[f]
    assert.ok(comoUrl, `${f} no exporta comoUrl`)
    assert.equal(
      comoUrl("C:\\Users\\Maria Jose\\hoja.html"),
      "file:///C:/Users/Maria%20Jose/hoja.html",
      `${f}: la ruta de Windows queda mal`,
    )
    assert.equal(
      comoUrl("/home/x/hoja.html"),
      "file:///home/x/hoja.html",
      `${f}: la ruta POSIX queda mal`,
    )
  }
})

test("escapa el numeral, que corta la URL en el navegador", () => {
  for (const f of CON_RUTA) {
    assert.equal(cargados[f].comoUrl("/x/a#b.html"), "file:///x/a%23b.html", `${f}`)
  }
})

test("ningun tool interpola una ruta cruda en un file protocol", () => {
  const culpables = []
  const crudo = new RegExp("file://\\$\\{", "g")
  for (const f of readdirSync(TOOLS).filter((x) => x.endsWith(".ts"))) {
    const codigo = codigoDe(f)
    for (const m of codigo.matchAll(crudo)) {
      culpables.push(f + ": " + codigo.slice(m.index, m.index + 40))
    }
  }
  assert.deepEqual(culpables, [], "usá comoUrl(ruta):\n" + culpables.join("\n"))
})

test("y si un mensaje ofrece una ruta, la ruta TIENE que estar", () => {
  // La regla que faltaba, y sin la cual el test anterior premia borrar.
  //
  // Se mira DENTRO de cada template literal, no las líneas vecinas: en un
  // ternario la rama que sí funciona tiene interpolaciones y tapa a la rota.
  // El caso real que se escapó era un template entero, en una línea, sin nada
  // adentro: el docente leía "pegá esto:" y abajo no había nada.
  const ofrece = /peg[áa] esto|doble clic|est[áa] (ac[áa]|en)/i
  /*
   * El patrón salta los caracteres escapados. Sin eso, un template como
   * "está acá: \\`${ruta}\\`" se corta en el backtick escapado del medio y
   * el trozo de la izquierda parece un mensaje huérfano — seis falsos
   * positivos, todos en mensajes que SÍ muestran la ruta.
   */
  const templates = /`(?:\\.|[^`\\])*`/g
  const huerfanos = []
  for (const f of CON_RUTA) {
    for (const m of codigoDe(f).matchAll(templates)) {
      const template = m[0]
      if (!ofrece.test(template)) continue
      if (!template.includes("${")) {
        huerfanos.push(f + ": " + template.trim().slice(0, 70))
      }
    }
  }
  assert.deepEqual(
    huerfanos,
    [],
    "estos mensajes ofrecen una ruta y no la muestran:\n" + huerfanos.join("\n"),
  )
})
