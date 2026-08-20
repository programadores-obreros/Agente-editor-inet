// Smoke tests del armador de circuitos (opencode/tool/circuito.ts).
// Corre con: node --test tests/   (no necesita instalar dependencias).
//
// El tool importa "@opencode-ai/plugin" y usa el runtime Bun, que no existen
// fuera de OpenCode. Así que acá lo cargamos con: (a) un mock del plugin,
// (b) un shim mínimo de Bun, y (c) un XDG_CONFIG_HOME falso con un bundle stub
// para que encuentre la biblioteca de piezas. No renderiza: valida la GENERACIÓN.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-test-work")
const OUTDIR = join(OUT, "out")

let mod // el tool cargado

before(async () => {
  // (c) XDG falso con bundle stub para que bundlePath()/extraPath() resuelvan
  const web = join(os.tmpdir(), "tecniabot-test-cfg", "opencode", "tecniabot-web")
  mkdirSync(web, { recursive: true })
  writeFileSync(join(web, "wokwi-bundle.js"), "/*stub*/")
  writeFileSync(join(web, "componentes-extra.js"), "/*stub*/")
  process.env.XDG_CONFIG_HOME = join(os.tmpdir(), "tecniabot-test-cfg")

  // (b) shim de Bun (write/file) que usa el tool
  globalThis.Bun = {
    file: (p) => ({ __path: p }),
    write: async (d, x) => {
      if (x && x.__path) writeFileSync(d, readFileSync(x.__path))
      else writeFileSync(d, x)
    },
  }

  // (a) copia parcheada del tool que importa un mock local del plugin
  mkdirSync(OUTDIR, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/circuito.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "circuito.ts"), src)
  mod = (await import(join(OUT, "circuito.ts"))).default
})

const PRESETS = [
  "servo-esp32", "led-esp32", "ultrasonico-esp32", "buzzer-esp32", "potenciometro-esp32",
  "dht22-esp32", "pir-esp32", "lcd-esp32", "boton-esp32", "estacion-meteo", "alarma", "semaforo", "protoboard",
]

async function gen(args, name) {
  const r = await mod.execute({ ...args, nombre_archivo: name }, { directory: OUTDIR })
  const file = join(OUTDIR, name + ".html")
  return { r, html: existsSync(file) ? readFileSync(file, "utf8") : "" }
}

test("todos los presets generan un HTML válido y no vacío", async () => {
  for (const p of PRESETS) {
    const { r, html } = await gen({ circuito: p }, "preset-" + p)
    assert.ok(r.startsWith("Listo"), `el preset "${p}" no generó: ${r.slice(0, 70)}`)
    assert.ok(html.includes("<body>") && html.length > 500, `el preset "${p}" dio un HTML vacío`)
  }
})

test("el JavaScript embebido (animación/interacción) es sintácticamente válido", async () => {
  for (const p of PRESETS) {
    const { html } = await gen({ circuito: p }, "js-" + p)
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    for (const s of scripts) {
      assert.doesNotThrow(() => new Function(s), `JS inválido en el preset "${p}"`)
    }
  }
})

test("el armador libre genera combinaciones con componentes nuevos", async () => {
  for (const c of ["higrometro, relay, bomba", "dht22, relay, calefactor", "ldr, pir, relay, lampara"]) {
    const { r, html } = await gen({ componentes: c }, "libre-" + c.replace(/[^a-z]+/gi, "-"))
    assert.ok(r.startsWith("Listo"), `no generó "${c}"`)
    assert.ok(/pb-|wokwi-/.test(html), `"${c}" no tiene piezas`)
  }
})

// Extrae los pines ASIGNADOS (los de la columna de conexiones, no el texto de avisos ni la tabla).
function pinesAsignados(html) {
  return [...html.matchAll(/class="gpio">GPIO(\d+)/g)].map((m) => m[1])
}

test("no se repiten GPIOs dinámicos dentro de un circuito", async () => {
  const { html } = await gen({ componentes: "led, led, servo, buzzer" }, "gpios")
  const dyn = pinesAsignados(html).filter((g) => g !== "21" && g !== "22") // 21/22 = I2C fijo compartido
  assert.equal(dyn.length, new Set(dyn).size, "hay GPIOs dinámicos duplicados: " + dyn.join(", "))
})

test("seguridad: nombre_archivo con ../ no escapa de la carpeta de trabajo", async () => {
  await gen({ circuito: "led-esp32" }, "../../escape")
  assert.ok(!existsSync(join(OUT, "..", "..", "escape.html")), "PATH TRAVERSAL: escribió fuera de la carpeta")
})

test("seguridad: un GPIO de flash (6-11) se reasigna y NO se usa como pin", async () => {
  const { html } = await gen({ componentes: "led:6" }, "flash")
  // "GPIO6" puede aparecer en el TEXTO del aviso; lo que no debe pasar es que quede ASIGNADO como pin.
  assert.ok(!pinesAsignados(html).includes("6"), "asignó GPIO6 (memoria flash): cuelga la placa")
})

// ── Tildes en el catálogo de componentes ───────────────────────────────────
//
// El prompt del agente enumera los componentes CON tilde —"botón",
// "potenciómetro", "ultrasónico"— y el ALIAS sólo tenía las formas sin tilde:
// `normalizarTipo` hacía nada más que toLowerCase. El modelo copiaba la lista
// del prompt y el tool contestaba "No conozco: botón".
//
// Lo delator: el ALIAS ya traía `lámpara`, `válvula` e `higrómetro` acentuados.
// Cubrir tildes era la intención desde el principio; el problema era que
// dependía de acordarse de cada variante a mano.
//
// Estos tests van contra el COMPORTAMIENTO del tool —se le pide un componente
// acentuado y se mira qué genera—, no contra el texto del archivo. Una versión
// anterior chequeaba `src.includes('"boton"')` y pasaba igual con la clave
// renombrada, porque "boton" también aparece como valor en ALIAS.

test("acepta un componente escrito con tilde, como lo escribe el prompt", async () => {
  const { r, html } = await gen({ componentes: "botón, led", placa: "esp32" }, "tilde-boton")
  assert.doesNotMatch(r, /No conozco/i, "rechazó 'botón' con tilde")
  assert.ok(html.length > 0, "no generó el archivo")
})

test("los tres que el prompt escribe con tilde funcionan", async () => {
  for (const nombre of ["botón", "potenciómetro", "ultrasónico"]) {
    const { r } = await gen({ componentes: nombre, placa: "esp32" }, "t-" + nombre.slice(0, 4))
    assert.doesNotMatch(r, /No conozco/i, "rechazó " + nombre)
  }
})

test("los alias acentuados que ya andaban siguen andando", async () => {
  // Éstos se resolvían por entrada explícita en ALIAS: no pueden romperse.
  for (const nombre of ["lámpara", "higrómetro"]) {
    const { r } = await gen({ componentes: nombre, placa: "uno" }, "a-" + nombre.slice(0, 4))
    assert.doesNotMatch(r, /No conozco/i, "rechazó " + nombre)
  }
})

test("un componente que no existe se sigue rechazando, sin inventar", async () => {
  const { r } = await gen({ componentes: "transistor", placa: "uno" }, "no-existe")
  assert.match(r, /No conozco/i, "aceptó un componente inexistente")
})

test("lo que el describe() promete es lo que el código hace", () => {
  // ESTE DEFECTO SE VIO EN USO: el bot abría una ventana del navegador en cada
  // pedido. «Cada vez que le pido algo me abre esto, toda una desprolijidad.»
  //
  // El código YA estaba arreglado —`const abrir = args.abrir === true`, o sea que
  // por defecto no abre nada— y el síntoma seguía. Porque el modelo no lee el
  // código: lee el `.describe()`, y ahí decía «Si es true (default)».
  //
  // Un `.describe()` no es documentación, es LA INTERFAZ. Es lo único que el
  // modelo ve del contrato. Cuando miente, arreglar el código no arregla nada:
  // queda una implementación correcta que nadie invoca como corresponde.
  //
  // Por eso se prueban CONTRA EL CÓDIGO y no contra un texto esperado: si mañana
  // alguien cambia el default a true, este test lo obliga a tocar las dos cosas.
  const fuente = readFileSync(join(REPO, "opencode/tool/circuito.ts"), "utf8")

  const linea = fuente.match(/const abrir = args\.abrir\s*(===|!==)\s*(true|false)/)
  assert.ok(linea, "no encontré cómo se resuelve `abrir`; si cambió, actualizá este test")

  // `args.abrir === true` significa: sin pasar nada, NO abre.
  const abrePorDefecto = !(linea[1] === "===" && linea[2] === "true")

  const descripcion = fuente.match(/abrir: tool\.schema[\s\S]{0,400}?\.describe\("([^"]+)"\)/)
  assert.ok(descripcion, "no encontré el .describe() del parámetro `abrir`")
  const texto = descripcion[1]

  if (abrePorDefecto) {
    assert.match(texto, /default:\s*true|true \(default\)/i,
      "el código abre por defecto y el describe() no lo dice")
  } else {
    assert.match(texto, /NO SE ABRE|default:\s*false/i,
      "El código NO abre por defecto, pero el describe() no lo dice.\n" +
      "El modelo sólo ve el describe(): si ahí dice otra cosa, va a llamar mal a la\n" +
      "tool y el arreglo del código no sirve de nada.")
    assert.doesNotMatch(texto, /true \(default\)/i,
      "el describe() sigue diciendo «true (default)» y el código dice lo contrario")
  }
})
