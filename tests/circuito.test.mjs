// Smoke tests del armador de circuitos (opencode/tool/circuito.ts).
// Corre con: node --test tests/   (no necesita instalar dependencias).
//
// El tool importa "@opencode-ai/plugin" y usa el runtime Bun, que no existen
// fuera de OpenCode. Así que acá lo cargamos con: (a) un mock del plugin,
// (b) un shim mínimo de Bun, y (c) un XDG_CONFIG_HOME falso con un bundle stub
// para que encuentre la biblioteca de piezas. No renderiza: valida la GENERACIÓN.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, copyFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-test-work")
const OUTDIR = join(OUT, "out")
// Un segundo XDG con la biblioteca de Wokwi pero SIN componentes-extra.js: es la
// instalación de la docente que actualizó a medias, o la que nunca corrió el instalador.
const CFG_SIN_EXTRA = join(os.tmpdir(), "tecniabot-test-cfg-sin-extra")

// Los circuitos MONTADOS sobre protoboard no los arma el motor: son plantillas HTML
// pre-validadas que el instalador copia a tecniabot-web/. Clave del tool → archivo.
const PLANTILLAS = {
  "boton-led-protoboard": "plantilla-boton-led-protoboard.html",
  "semaforo-protoboard": "plantilla-semaforo-protoboard.html",
}

let mod // el tool cargado
// El MÓDULO entero, no sólo el `export default`. Hace falta para probar invariantes
// que no se pueden ejercer dibujando: `avisoDe` con `uno: null` (hoy no hay ningún
// componente escrito así) y los rótulos de `riel` de cada placa. Se leen del módulo
// REAL y no se copian acá, o el test se desincroniza del código y deja de ser red.
let ns

before(async () => {
  // (c) XDG falso con bundle stub para que bundlePath()/extraPath() resuelvan
  const web = join(os.tmpdir(), "tecniabot-test-cfg", "opencode", "tecniabot-web")
  mkdirSync(web, { recursive: true })
  writeFileSync(join(web, "wokwi-bundle.js"), "/*stub*/")
  writeFileSync(join(web, "componentes-extra.js"), "/*stub*/")
  // Las plantillas de protoboard NO son stubs: se copian las REALES del repo. La rama
  // que las sirve no arma nada, lee un archivo y lo entrega — si el asset fuera un
  // stub, el test no distinguiría "sirvió la plantilla" de "sirvió cualquier cosa".
  for (const p of Object.values(PLANTILLAS)) {
    copyFileSync(join(REPO, "opencode/tecniabot-web", p), join(web, p))
  }
  process.env.XDG_CONFIG_HOME = join(os.tmpdir(), "tecniabot-test-cfg")

  const webSinExtra = join(CFG_SIN_EXTRA, "opencode", "tecniabot-web")
  rmSync(webSinExtra, { recursive: true, force: true })
  mkdirSync(webSinExtra, { recursive: true })
  writeFileSync(join(webSinExtra, "wokwi-bundle.js"), "/*stub*/") // el bundle SÍ está: lo que falta es el otro

  // (b) shim de Bun (write/file) que usa el tool
  globalThis.Bun = {
    file: (p) => ({ __path: p }),
    write: async (d, x) => {
      if (x && x.__path) writeFileSync(d, readFileSync(x.__path))
      else writeFileSync(d, x)
    },
  }

  // (a) copia parcheada del tool que importa un mock local del plugin
  //
  // La carpeta de salida se BORRA antes de cada corrida, y no es cosmético: el tool
  // ya no pisa un archivo cuando el nombre vino explícito (lo versiona a "-2", ver
  // el test de más abajo), así que con los HTML de la corrida anterior ahí adentro
  // cada test estaría leyendo el archivo de ayer y pasando en verde por accidente.
  rmSync(OUTDIR, { recursive: true, force: true })
  mkdirSync(OUTDIR, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/circuito.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "circuito.ts"), src)
  ns = await import(join(OUT, "circuito.ts"))
  mod = ns.default
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

// Las piezas que el armador DIBUJA de verdad: cada <wokwi-*>/<pb-*> con id propio.
// (El ESP32 de la escena no lleva id, y el <script src="wokwi-bundle.js"> tampoco.)
function piezasDe(html) {
  return [...html.matchAll(/<((?:wokwi|pb)-[a-z0-9-]+) id="/g)].map((m) => m[1])
}

// La celda "Conexiones al ESP32" de la fila de un componente en la tabla resumen.
function filaTabla(html, etiqueta) {
  const m = html.match(new RegExp(`<tr><td>${etiqueta}</td><td>.*?</td><td>(.*?)</td></tr>`))
  return m ? m[1] : ""
}

// Un pin de la placa, tal como lo escribe la hoja: "GPIO33" en el ESP32, "D4" o
// "A4" en el Arduino UNO.
//
// EL BANCO VA INCLUIDO A PROPÓSITO, y es el cambio que hizo falta para que estos
// tests sirvan con dos placas. Antes el regex era /GPIO(\d+)/ y devolvía el NÚMERO
// pelado, que en el ESP32 alcanza (hay un solo banco: el 33 es el 33). En el UNO
// D4 y A4 son dos pines FÍSICAMENTE distintos que comparten el número: comparar
// por número no distingue un circuito bueno de uno roto, y un test que no
// distingue eso pasa en verde con el bug puesto.
const PIN = /\b(?:GPIO|D|A)\d+\b/g
const pinesEn = (texto) => texto.match(PIN) ?? []

// Todos los pines que la tabla dice que se usan (incluye las filas que reservan varios).
function gpiosDeLaTabla(html) {
  return [...html.matchAll(/<td>([^<]*)<\/td>/g)].flatMap((m) => pinesEn(m[1]))
}

test("el armador libre genera combinaciones con componentes nuevos", async () => {
  // OJO CON ESTE TEST: antes decía `assert.ok(/pb-|wokwi-/.test(html))` y pasaba en
  // VERDE aunque el circuito saliera completamente vacío — porque el HTML SIEMPRE
  // trae `<script src="wokwi-bundle.js">`, y ese "wokwi-" alcanzaba para el regex.
  // Un test que mira el texto de un tag en vez de las piezas dibujadas no cubre nada:
  // era el único test del armador libre, y no habría detectado el bug B1 (página sin
  // una sola pieza) ni una sola vez. Ahora se exigen las piezas, cuáles y en qué orden.
  const casos = {
    "higrometro, relay, bomba": ["pb-higrometro", "pb-relay", "pb-bomba"],
    "dht22, relay, calefactor": ["wokwi-dht22", "pb-relay", "pb-calefactor"],
    "ldr, pir, relay, lampara": ["wokwi-photoresistor-sensor", "wokwi-pir-motion-sensor", "pb-relay", "pb-lampara"],
  }
  for (const [c, esperadas] of Object.entries(casos)) {
    const { r, html } = await gen({ componentes: c }, "libre-" + c.replace(/[^a-z]+/gi, "-"))
    assert.ok(r.startsWith("Listo"), `no generó "${c}"`)
    assert.deepEqual(piezasDe(html), esperadas, `"${c}" no dibujó las piezas pedidas`)
  }
})

// Extrae los pines ASIGNADOS (los de la columna de conexiones, no el texto de avisos ni la tabla).
// Sigue mirando sólo el PRIMER pin de cada etiqueta, como siempre: las filas que
// reservan varios (7 segmentos, teclado) se cuentan con gpiosDeLaTabla.
function pinesAsignados(html) {
  return [...html.matchAll(/class="gpio">((?:GPIO|D|A)\d+)/g)].map((m) => m[1])
}

test("no se repiten GPIOs dinámicos dentro de un circuito", async () => {
  const { html } = await gen({ componentes: "led, led, servo, buzzer" }, "gpios")
  const dyn = pinesAsignados(html).filter((g) => g !== "GPIO21" && g !== "GPIO22") // 21/22 = I2C fijo compartido
  assert.equal(dyn.length, new Set(dyn).size, "hay GPIOs dinámicos duplicados: " + dyn.join(", "))
})

// Este test era DECORATIVO y miraba la carpeta equivocada: OUTDIR es
// .../tecniabot-test-work/out, así que un "../../escape" real cae en /tmp/escape.html,
// y el assert apuntaba a join(OUT, "..", "..") — un nivel de más, y a la raíz del FS.
// Se borró TODO el saneamiento de nombreSeguro y el test siguió pasando en verde.
// La protección funciona; lo que no existía era el test.
test("seguridad: nombre_archivo con ../ no escapa de la carpeta de trabajo", async () => {
  const afuera = join(OUTDIR, "..", "..", "escape.html") // donde caería el escape de verdad
  rmSync(afuera, { force: true })
  await mod.execute({ circuito: "led-esp32", nombre_archivo: "../../escape" }, { directory: OUTDIR })
  assert.ok(!existsSync(afuera), "PATH TRAVERSAL: escribió fuera de la carpeta de trabajo (" + afuera + ")")
  // Y el circuito TIENE que estar adentro: el saneamiento recorta el nombre, no cancela
  // el pedido. Si esto falla, el escape no ocurrió porque no se generó nada.
  assert.ok(existsSync(join(OUTDIR, "escape.html")), "no escapó, pero tampoco guardó el circuito adentro")
})

test("seguridad: un GPIO de flash (6-11) se reasigna y NO se usa como pin", async () => {
  const { html } = await gen({ componentes: "led:6" }, "flash")
  // "GPIO6" puede aparecer en el TEXTO del aviso; lo que no debe pasar es que quede ASIGNADO como pin.
  assert.ok(!pinesAsignados(html).includes("GPIO6"), "asignó GPIO6 (memoria flash): cuelga la placa")
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

// ESTOS DOS TESTS ESTABAN EN VERDE Y DIBUJABAN LA PLACA EQUIVOCADA.
//
// Pasaban `placa: "uno"` cuando el arg `placa` NO EXISTÍA: el objeto llegaba entero
// a execute (los tests llaman a execute directo, sin pasar por el schema), la clave
// de más se ignoraba en silencio, y el tool dibujaba un ESP32. Los dos assert eran
// sobre otra cosa —que el alias con tilde se resolviera— así que nunca se quejaron.
//
// Era el bug del producto fosilizado como test que pasa: el docente pedía "higrómetro
// en mi Arduino" y recibía un ESP32, y la suite decía que estaba todo bien. Ahora
// cada uno ASEVERA QUÉ PLACA SALIÓ DIBUJADA, que es lo único que hace la diferencia
// entre el circuito de la docente y el de otra persona.
test("los alias acentuados que ya andaban siguen andando, y salen en la placa que se pidió", async () => {
  // Éstos se resolvían por entrada explícita en ALIAS: no pueden romperse.
  // "lámpara" es de las que todavía no están portadas al UNO: el tool se tiene que
  // NEGAR con un motivo, no dibujar un ESP32 disfrazado.
  const lampara = await gen({ componentes: "lámpara", placa: "uno" }, "a-lamp-uno")
  assert.doesNotMatch(lampara.r, /No conozco/i, "rechazó lámpara como si no existiera el componente")
  assert.doesNotMatch(lampara.r, /^Listo/, "dibujó una lámpara en UNO sin tenerla portada")
  assert.match(lampara.r, /Arduino UNO/, "no dice de qué placa está hablando")
  assert.equal(lampara.html, "", "generó el HTML igual, con la placa que no era")

  // "higrómetro" SÍ está portado: tiene que salir, y salir en un UNO.
  const higro = await gen({ componentes: "higrómetro", placa: "uno" }, "a-higr-uno")
  assert.doesNotMatch(higro.r, /No conozco/i, "rechazó higrómetro")
  assert.ok(higro.r.startsWith("Listo"), "no armó el higrómetro en UNO: " + higro.r.slice(0, 120))
  assert.match(higro.html, /<wokwi-arduino-uno/, "pidieron un UNO y no hay ningún UNO en la hoja")
  assert.doesNotMatch(higro.html, /wokwi-esp32-devkit-v1/, "pidieron un UNO y dibujó un ESP32")

  // Y el mismo alias en ESP32 sigue andando: el arreglo no puede romper la placa vieja.
  const esp = await gen({ componentes: "lámpara, higrómetro", placa: "esp32" }, "a-alias-esp32")
  assert.ok(esp.r.startsWith("Listo"), "rompió los alias acentuados en ESP32: " + esp.r.slice(0, 120))
  assert.match(esp.html, /<wokwi-esp32-devkit-v1/, "el ESP32 dejó de dibujarse")
})

test("un componente que no existe se sigue rechazando, sin inventar", async () => {
  // Mismo verde falso que el de arriba: pasaba placa:"uno" y el assert miraba otra
  // cosa. Acá el pedido se rechaza por el COMPONENTE, y eso no depende de la placa —
  // pero que no dependa es justamente lo que hay que probar, en las dos.
  for (const placa of ["esp32", "uno"]) {
    const { r, html } = await gen({ componentes: "transistor", placa }, "no-existe-" + placa)
    assert.match(r, /No conozco/i, `aceptó un componente inexistente en ${placa}`)
    assert.equal(html, "", `dijo "no conozco" y generó la hoja igual en ${placa}`)
  }
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

// ── La resistencia del LED es de 220Ω, no 330Ω ──────────────────────────────
//
// El tool dibuja circuitos de ESP32 (3.3V) y las etiquetas decían «(con 330Ω)»,
// que es la regla de 5V del UNO. Los skills `esp32` y `diagramas-conexion` ya
// decían 220Ω para 3.3V: un LED azul/blanco (Vf ~3,2V) con 330Ω en 3.3V casi no
// prende. El alumno leía una cosa en el chat y otra en el dibujo.
test("los LEDs del ESP32 llevan 220Ω en el dibujo, nunca 330Ω", async () => {
  for (const c of ["led", "rgb-led", "7segmentos"]) {
    const { html } = await gen({ componentes: c, placa: "esp32" }, "ohm-" + c)
    assert.doesNotMatch(html, /330\s*Ω/, `"${c}" sigue con la resistencia de 5V (330Ω)`)
    assert.match(html, /220\s*Ω/, `"${c}" no dice cuál es la resistencia en serie`)
  }
  // Y la R en serie se dibuja inline en el cable (el parser de "(con XΩ)" la reconoce).
  const { html } = await gen({ circuito: "led-esp32" }, "ohm-inline")
  assert.match(html, /class="res"[^>]*>220Ω</, "la resistencia de 220Ω no quedó dibujada en serie")
})

// ════════════════════════════════════════════════════════════════════════════
// AUDITORÍA — un test por bug, y cada uno FALLA sin su arreglo.
// Todos van contra el COMPORTAMIENTO (lo que se genera), no contra el texto del
// archivo: un test que busca una línea de código pasa en verde con el bug puesto
// de nuevo dos líneas más abajo.
// ════════════════════════════════════════════════════════════════════════════

// ── B1 · sin componentes-extra.js el HTML salía VACÍO y el tool decía "Listo!" ──
//
// El guard de arranque miraba SOLO wokwi-bundle.js, pero el HTML siempre emite
// <script src="componentes-extra.js"> y ese archivo se copiaba nada más que si
// existía. Sin él, los <pb-*> son custom elements que nadie definió: el navegador
// los deja como spans de tamaño cero. Ni error, ni 404 visible.
// La docente abría la página del proyecto de riego, veía la tabla de conexiones y
// CERO piezas, después de que el bot le dijera "Listo! Generé el circuito". Y son
// justo los 10 componentes de los proyectos del INET.
test("B1: si falta componentes-extra.js no genera nada y lo dice en criollo", async () => {
  const previo = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = CFG_SIN_EXTRA
  try {
    const nombre = "b1-riego-sin-extra"
    const r = await mod.execute({ componentes: "higrometro, relay, bomba", nombre_archivo: nombre }, { directory: OUTDIR })
    assert.ok(!r.startsWith("Listo"), 'dijo "Listo!" con una página que sale sin una sola pieza')
    assert.match(r, /componentes-extra\.js/, "no dice qué archivo falta")
    assert.match(r, /instalador/i, "no dice cómo arreglarlo")
    assert.ok(!existsSync(join(OUTDIR, nombre + ".html")), "generó igual el HTML vacío")
  } finally {
    process.env.XDG_CONFIG_HOME = previo
  }
})

test("B1: los circuitos que NO usan piezas dibujadas se siguen generando sin ese archivo", async () => {
  // El guard tiene que ser del tamaño del problema: un led+servo no necesita pb-*.
  const previo = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = CFG_SIN_EXTRA
  try {
    const r = await mod.execute({ componentes: "led, servo", nombre_archivo: "b1-sin-pb" }, { directory: OUTDIR })
    assert.ok(r.startsWith("Listo"), "bloqueó un circuito que no necesita las piezas dibujadas: " + r.slice(0, 90))
  } finally {
    process.env.XDG_CONFIG_HOME = previo
  }
})

// ── B2 · el stepper se dibujaba colgado del GPIO, sin driver ────────────────
//
// Sus pines IN1-IN4 eran clase "digital": el asignador les daba 4 GPIO reales y el
// dibujo salía con cuatro cables del ESP32 DIRECTO a las bobinas. Mientras tanto su
// propia advertencia decía "se conecta por el driver ULN2003". El texto y el dibujo
// se contradecían — y el alumno cablea lo que VE. Las bobinas del 28BYJ-48 piden
// ~240 mA por fase y el GPIO entrega 12: se quema la placa, no el motor.
test("B2: el motor paso a paso va al driver, nunca a un GPIO", async () => {
  const { html } = await gen({ componentes: "stepper" }, "b2-stepper")
  const fila = filaTabla(html, "Motor paso a paso")
  assert.ok(fila.length > 0, "no encontré la fila del stepper en la tabla")
  assert.doesNotMatch(fila, /GPIO/, "el stepper sigue colgado de los GPIO: " + fila)
  assert.match(fila, /Driver ULN2003/, "no dice a dónde va el conector del motor")
  // y el driver (que es quien sí habla con el ESP32) tiene sus 4 señales
  assert.equal(pinesEn(filaTabla(html, "Driver ULN2003")).length, 4, "el driver perdió sus 4 entradas")
})

// ── B3 · cero validación de actuador de potencia ⇒ relé/driver ──────────────
//
// "higrometro, bomba" se generaba sin chistar, y el simulador mostraba al sensor
// encendiendo la bomba DIRECTO: justo el error que el prompt y todos los skills
// tratan de sacarle de la cabeza al alumno. Se elige INYECTAR el relé y avisarlo
// (y no cortar con un mensaje) porque la docente está en el medio de una clase:
// necesita el circuito de riego, no un cartel de error.
test("B3: un actuador de potencia sin relé ni driver no se dibuja: se le agrega el mando", async () => {
  const { r, html } = await gen({ componentes: "higrometro, bomba" }, "b3-riego")
  assert.ok(r.startsWith("Listo"), "no generó el riego: " + r.slice(0, 90))
  assert.ok(piezasDe(html).includes("pb-relay"), "el sensor enciende la bomba directo: falta el relé")
  assert.match(r, /agregué/i, "agregó el relé y no se lo dijo a la docente")
  assert.doesNotMatch(filaTabla(html, "Bomba de agua"), /GPIO/, "la bomba quedó cableada a un GPIO")
})

test("B3: si el pedido YA trae relé, no se le agrega otro", async () => {
  const { html } = await gen({ componentes: "higrometro, relay, bomba" }, "b3-riego-ok")
  assert.equal(piezasDe(html).filter((p) => p === "pb-relay").length, 1, "duplicó el relé")
})

test("B3: el motor DC pide driver, no relé", async () => {
  const { html } = await gen({ componentes: "motor" }, "b3-motor")
  assert.ok(piezasDe(html).includes("pb-driver"), "el motor DC salió sin driver")
})

// El guard era `if (tipos.some(t => t === "relay" || t === "driver")) return`: con
// CUALQUIER mando en la lista, la inyección se apagaba ENTERA. No preguntaba si ese
// relé gobernaba a alguien ni si era de la familia correcta.
//
// Lo que veía la docente: pedía calefacción + motor, la hoja salía sin driver, y la
// tabla del motor igual decía "Driver (L298N/ULN2003)". O sea: la mandaba a cablear
// contra un componente que NO estaba dibujado en la página. Y el `description` del
// tool le promete al modelo que "si te olvidás de incluirlo, el tool lo agrega solo".
test("B3: un relé ajeno no deja al motor sin su driver", async () => {
  const { r, html } = await gen({ componentes: "dht22, relay, calefactor, motor" }, "b3-rele-ajeno")
  assert.ok(piezasDe(html).includes("pb-driver"), "el relé del calefactor apagó la inyección del driver del motor")
  assert.match(filaTabla(html, "Motor DC"), /Driver/i, "la tabla del motor dejó de nombrar al driver")
  assert.match(r, /driver/i, "agregó el driver sin contarlo")
  assert.equal(piezasDe(html).filter((p) => p === "pb-relay").length, 1, "duplicó el relé que ya había pedido")
})

// El tope de 6 recortaba con `pedidos.slice(0, 6)` sobre la lista YA INYECTADA, y el
// mando entra JUSTO ANTES de la potencia: el que se caía por el borde era SIEMPRE el
// actuador. "higrometro, lluvia, bmp180, lcd, led, bomba" sugería "...led, relay":
// un riego SIN bomba, con un relé que no gobierna nada. Y el modelo copia esa lista
// tal cual, porque viene entre comillas y con formato de comando.
test("B3: la lista que sugiere al pasarse del tope no se come el actuador", async () => {
  const r = await mod.execute({ componentes: "higrometro, lluvia, bmp180, lcd, led, bomba" }, { directory: OUTDIR })
  const m = r.match(/por ejemplo: "([^"]+)"/)
  assert.ok(m, "no ofreció ninguna lista de ejemplo: " + r.slice(0, 120))
  const sugerida = m[1].split(",").map((s) => s.trim())
  assert.ok(sugerida.includes("bomba"), 'sugiere un riego SIN bomba: "' + m[1] + '"')
  assert.ok(sugerida.length <= 6, 'la lista que sugiere tampoco entra en el tope de 6: "' + m[1] + '"')
})

test("B3: lo que sugiere al pasarse del tope se puede armar de verdad", async () => {
  // El test de arriba mira la forma de la lista; éste la EJECUTA. Es el único que
  // detecta una sugerencia que vuelve a rebotar contra el mismo tope.
  const r = await mod.execute({ componentes: "higrometro, lluvia, bmp180, lcd, led, bomba" }, { directory: OUTDIR })
  const sugerida = r.match(/por ejemplo: "([^"]+)"/)?.[1]
  assert.ok(sugerida, "no ofreció ninguna lista de ejemplo")
  const r2 = await mod.execute({ componentes: sugerida, nombre_archivo: "b3-sugerencia" }, { directory: OUTDIR })
  assert.ok(r2.startsWith("Listo"), 'la lista que sugiere tampoco se puede armar: "' + sugerida + '" → ' + r2.slice(0, 120))
  const html = readFileSync(join(OUTDIR, "b3-sugerencia.html"), "utf8")
  assert.ok(piezasDe(html).includes("pb-bomba"), "armó la sugerencia, pero sin la bomba")
})

// ── B4 · un GPIO de solo-entrada aceptado como salida ───────────────────────
//
// La validación miraba flash, existencia, ocupado y strapping: nunca DIRECCIÓN.
// "led:34" pasaba y el LED no prendía nunca (GPIO34-39 no tienen driver de salida
// ni pull-up interno). El alumno revisa el cable, la resistencia y la soldadura
// antes de sospechar del pin — porque el diagrama se lo dio el bot.
test("B4: un GPIO solo-entrada (34/35/36/39) no se acepta para un LED", async () => {
  const { html } = await gen({ componentes: "led:34" }, "b4-led34")
  assert.ok(!pinesAsignados(html).includes("GPIO34"), "asignó GPIO34 a un LED: no prende nunca")
  assert.match(html, /SOLO ENTRADA/i, "lo reasignó en silencio, sin explicar por qué")
})

test("B4: GPIO1 y GPIO3 (puerto serie del USB) tampoco se reparten", async () => {
  for (const g of ["1", "3"]) {
    const { html } = await gen({ componentes: "led:" + g }, "b4-uart" + g)
    assert.ok(!pinesAsignados(html).includes("GPIO" + g), `asignó GPIO${g}: la placa deja de aceptar la carga del programa`)
    assert.match(html, /puerto serie del USB/i, `reasignó GPIO${g} sin avisar`)
  }
})

test("B4: los solo-entrada SIGUEN siendo válidos para un sensor analógico", async () => {
  // No es "prohibir 34-39": son los mejores pines para ADC. Lo que no se puede es
  // usarlos de SALIDA. Si el arreglo los bloquea para todo, rompe los sensores.
  //
  // Va con :35 A PROPÓSITO. Con :34 el contra-test era DECORATIVO: 34 es el PRIMER
  // elemento de POOL_ANALOGICO, así que "te respeté el pin que pediste" y "te lo
  // rechacé y el pool te devolvió el mismo número" se ven exactamente iguales. Se
  // podía mutar el fix entero y no fallaba ni un test.
  const { html } = await gen({ componentes: "potenciometro:35" }, "b4-pot35")
  assert.ok(pinesAsignados(html).includes("GPIO35"), "bloqueó GPIO35 para un analógico, que es su mejor uso")
  assert.doesNotMatch(html, /SOLO ENTRADA/i, "lo rechazó por solo-entrada y el pool le devolvió otro analógico")
})

// ── B6 · pines fantasma: 7segmentos y teclado se comían GPIOs sin imprimirlos ──
//
// Sus roles no tenían placeholder, así que no se sustituía nada — pero el pin se
// consumía del pool igual. "7segmentos, led, led" dejaba al display comiéndose el
// GPIO4 sin figurar en ningún lado, y el primer LED arrancaba en 5 sin explicación.
// La docente cuenta los pines del dibujo y le falta uno: el peor tipo de error,
// porque la hoja se ve perfecta.
test("B6: el display de 7 segmentos declara los 7 pines que se reserva", async () => {
  const { html } = await gen({ componentes: "7segmentos, led, led" }, "b6-7seg")
  const display = pinesEn(filaTabla(html, "Display 7 segmentos")).length
  assert.equal(display, 7, "el display usa 7 pines y la tabla no los muestra")
  const usados = gpiosDeLaTabla(html)
  assert.equal(usados.length, new Set(usados).size, "dos componentes quedaron en el mismo pin: " + usados.join(", "))
})

test("B6: el teclado 4x4 declara sus 8 pines (4 filas + 4 columnas)", async () => {
  const { html } = await gen({ componentes: "teclado" }, "b6-teclado")
  assert.equal(pinesEn(filaTabla(html, "Teclado matricial 4x4")).length, 8, "el teclado esconde sus pines")
})

test("B6: el display sigue SIN una resistencia dibujada por segmento", async () => {
  // Esto la auditoría lo marcó como correcto y no se toca: una sola R para 7
  // segmentos mentiría, y dibujar 7 no entra en la fila. Se nombra en el texto.
  const { html } = await gen({ componentes: "7segmentos" }, "b6-7seg-res")
  assert.doesNotMatch(html, /class="res"/, "empezó a dibujar la resistencia del display")
  assert.match(html, /220Ω/, "dejó de decir que cada segmento lleva su resistencia")
})

// ── B5 · pisaba archivos existentes sin avisar ──────────────────────────────
//
// Era `Bun.write(archivo, html)` a secas, y el nombre lo elige EL MODELO, no la
// persona. Dos pedidos parecidos en la misma clase y el trabajo de la docente
// desaparecía sin dejar rastro. Se versiona (no se corta): pierde cero y se le
// dice qué archivo quedó.
test("B5: no pisa un archivo existente cuando el nombre vino explícito", async () => {
  const nombre = "b5-cuaderno-de-maria"
  await gen({ circuito: "led-esp32" }, nombre)
  const original = readFileSync(join(OUTDIR, nombre + ".html"), "utf8")
  const { r } = await gen({ componentes: "servo, buzzer" }, nombre)
  assert.equal(readFileSync(join(OUTDIR, nombre + ".html"), "utf8"), original, "PISÓ el archivo que ya estaba")
  assert.ok(existsSync(join(OUTDIR, nombre + "-2.html")), "tampoco guardó el circuito nuevo")
  assert.match(r, new RegExp(nombre + "-2\\.html"), "no le dijo dónde quedó el nuevo")
})

test("B5: el nombre por defecto SIGUE siendo determinista y pisa", async () => {
  // Es a propósito: regenerar el mismo circuito tiene que reemplazar al anterior,
  // si no la carpeta se llena de copias idénticas. El arreglo no puede romper esto.
  await mod.execute({ circuito: "buzzer-esp32" }, { directory: OUTDIR })
  await mod.execute({ circuito: "buzzer-esp32" }, { directory: OUTDIR })
  assert.ok(existsSync(join(OUTDIR, "circuito-buzzer-esp32.html")), "cambió el nombre por defecto")
  assert.ok(!existsSync(join(OUTDIR, "circuito-buzzer-esp32-2.html")), "el default dejó de pisar y ahora versiona")
})

// El versionado cubría de -2 a -99 y DESPUÉS caía a `${base}-${Date.now()}`: el único
// camino de rutaDeSalida sin un existsSync. Dos llamadas en el mismo milisegundo
// devolvían el MISMO nombre, y la segunda pisaba a la primera con un aviso que juraba
// que no había tocado nada.
//
// Lo que veía la docente: el circuito del LED desaparecido, y el mensaje del bot
// diciéndole que estaba guardado. Es exactamente el bug que B5 dice haber matado,
// sobreviviendo en la rama que nadie probaba.
test("B5: con la carpeta saturada tampoco pisa, ni miente sobre dónde quedó", async () => {
  const nombre = "b5-carpeta-saturada"
  writeFileSync(join(OUTDIR, nombre + ".html"), "<!--ocupado-->")
  for (let n = 2; n < 100; n++) writeFileSync(join(OUTDIR, `${nombre}-${n}.html`), "<!--ocupado-->")

  const reloj = Date.now
  Date.now = () => 1700000000000 // los dos pedidos caen en el MISMO milisegundo
  let a, b
  try {
    a = await mod.execute({ circuito: "led-esp32", nombre_archivo: nombre }, { directory: OUTDIR })
    b = await mod.execute({ componentes: "servo, buzzer", nombre_archivo: nombre }, { directory: OUTDIR })
  } finally {
    Date.now = reloj
  }

  const rutaDe = (r) => r.match(new RegExp(nombre + "[\\w.-]*\\.html"))?.[0]
  const [fa, fb] = [rutaDe(a), rutaDe(b)]
  assert.ok(fa && fb, "alguno de los dos no dijo en qué archivo quedó")
  assert.notEqual(fa, fb, "los dos pedidos del mismo milisegundo se fueron al MISMO archivo: el segundo pisó al primero")
  assert.equal(readFileSync(join(OUTDIR, nombre + ".html"), "utf8"), "<!--ocupado-->", "pisó el archivo original")
  for (const f of [fa, fb]) {
    assert.ok(existsSync(join(OUTDIR, f)), `dijo que guardó en "${f}" y ese archivo no está`)
    assert.ok(readFileSync(join(OUTDIR, f), "utf8").includes("<body>"), `"${f}" no tiene el circuito adentro`)
  }
  assert.deepEqual(piezasDe(readFileSync(join(OUTDIR, fa), "utf8")), ["wokwi-led"], "el primero (el LED) se perdió")
  assert.deepEqual(piezasDe(readFileSync(join(OUTDIR, fb), "utf8")), ["wokwi-servo", "wokwi-buzzer"], "el segundo no llegó")
})

test("B5: si NO queda ni un nombre libre, corta y lo dice — no pisa", async () => {
  // El borde del borde. Es casi inalcanzable en una clase real, pero es justamente la
  // rama que nadie prueba, que es donde venía escondido el bug de arriba. Si algún día
  // este camino vuelve a "resolver" el problema pisando un archivo, esto se pone rojo.
  const nombre = "b5-sin-lugar"
  const SELLO = 1700000000001
  writeFileSync(join(OUTDIR, nombre + ".html"), "<!--ocupado-->")
  for (let n = 2; n < 100; n++) writeFileSync(join(OUTDIR, `${nombre}-${n}.html`), "<!--ocupado-->")
  writeFileSync(join(OUTDIR, `${nombre}-${SELLO}.html`), "<!--ocupado-->")
  for (let n = 1; n < 100; n++) writeFileSync(join(OUTDIR, `${nombre}-${SELLO}-${n}.html`), "<!--ocupado-->")

  const reloj = Date.now
  Date.now = () => SELLO
  let r
  try {
    r = await mod.execute({ circuito: "led-esp32", nombre_archivo: nombre }, { directory: OUTDIR })
  } finally {
    Date.now = reloj
  }

  assert.doesNotMatch(r, /^Listo/, "dijo que lo generó sin tener dónde guardarlo")
  assert.match(r, /No guardé nada/i, "no arranca diciendo qué pasó")
  assert.match(r, /carpeta|otro nombre/i, "no dice qué hacer al respecto")
  assert.equal(readFileSync(join(OUTDIR, nombre + ".html"), "utf8"), "<!--ocupado-->", "pisó el original igual")
  assert.equal(readFileSync(join(OUTDIR, `${nombre}-${SELLO}.html`), "utf8"), "<!--ocupado-->", "pisó el del sello")
})

// ── B7 · execute no tenía un solo try/catch ────────────────────────────────
//
// Con la carpeta de trabajo sin permiso (o en OneDrive sincronizando, que es lo
// común en las netbooks de la escuela) subía un ENOENT/EACCES crudo hasta el
// modelo, que improvisaba una explicación. Un stack trace no le sirve a nadie,
// menos a una docente.
test("B7: una carpeta donde no se puede escribir da un mensaje útil, no una excepción", async () => {
  const inexistente = join(OUT, "carpeta-que-no-existe", "ni-esta")
  let r
  await assert.doesNotReject(async () => {
    r = await mod.execute({ circuito: "led-esp32", nombre_archivo: "b7" }, { directory: inexistente })
  }, "la excepción cruda le llegó al modelo")
  // El detalle del sistema puede ir AL FINAL (el resto de los tools del repo lo
  // hace, y a soporte le sirve). Lo que no puede pasar es que sea la respuesta:
  // la docente tiene que leer primero qué pasó y qué hacer, en castellano.
  assert.match(r, /^No pude guardar el circuito/i, "arranca con otra cosa que no es la explicación")
  assert.match(r, /carpeta/i, "no dice qué hacer al respecto")
  assert.doesNotMatch(r, /\n\s+at .+\(/, "le mandó un stack trace al modelo")
  assert.ok(r.indexOf("ENOENT") > r.indexOf("Probá"), "el error crudo aparece antes de la explicación")
})

// ── B8 · "GPIOGPIO?" cuando se agota el pool ───────────────────────────────
//
// rellenarRol devolvía "GPIO?" y el rol ya traía el literal "GPIO" delante. Se leía
// como un error del programa, no como "acá falta un pin".
test("B8: al agotarse los pines dice GPIO?, no GPIOGPIO?", async () => {
  const { html } = await gen({ componentes: "teclado, 7segmentos, led, led, led" }, "b8-pool")
  assert.doesNotMatch(html, /GPIOGPIO/, "sigue imprimiendo GPIOGPIO?")
  assert.match(html, /GPIO\?/, "no marcó los pines que no pudo asignar")
})

// ── B9 · el semáforo salía rojo/verde/amarillo y los tres parpadeando juntos ──
//
// El ciclo de colores era rojo→verde→amarillo y cada LED traía su propio
// setInterval de 600 ms: los tres arrancaban en el mismo tick. El preset hermano
// `semaforo-protoboard` (plantilla a mano) sí hacía la secuencia bien, así que el
// mismo pedido daba dos cosas distintas según qué palabra usara el docente.
test("B9: el semáforo es rojo/amarillo/verde y hace la secuencia, no parpadeo", async () => {
  const { html } = await gen({ circuito: "semaforo" }, "b9-semaforo")
  const colores = [...html.matchAll(/<wokwi-led id="led\d" color="(\w+)"/g)].map((m) => m[1])
  assert.deepEqual(colores, ["red", "yellow", "green"], "el orden de los LEDs no es el de un semáforo")
  assert.doesNotMatch(html, /setInterval/, "los tres LEDs siguen parpadeando cada uno por su cuenta")
  assert.match(html, /setTimeout/, "no quedó ninguna secuencia por fases")
})

// ── B10 · el 4º LED de cualquier circuito salía AZUL con 220 Ω ──────────────
//
// skills/esp32/SKILL.md es taxativo: un LED que cae 3 V o más sobre 3,3 V "no hay
// con qué hacerlo andar decente, y no es un problema de elegir mejor la
// resistencia: no queda tensión". O sea que el dibujo pedía armar un circuito
// IMPOSIBLE — y el alumno lo iba a intentar igual, culpándose a sí mismo.
test("B10: ningún LED sale azul", async () => {
  const { html } = await gen({ componentes: "led, led, led, led" }, "b10-azul")
  assert.doesNotMatch(html, /color="blue"/, "el 4º LED sigue saliendo azul: a 3,3 V no prende")
})

// ── B11 · entradas raras que pasaban en silencio ───────────────────────────
//
// Pedir algo y recibir otra cosa sin enterarse es el peor default que puede tener
// una herramienta: el docente no sabe que tiene que revisar nada.
test("B11: avisa cuando el GPIO pedido no es un número", async () => {
  const { r } = await gen({ componentes: "led:abc" }, "b11-gpio")
  assert.match(r, /abc/, "cambió el pin pedido sin decir una palabra")
})

test("B11: avisa cuando el umbral no se puede aplicar", async () => {
  // El nombre del archivo NO puede contener "umbral": la respuesta incluye la ruta
  // del HTML, así que un nombre así hacía pasar este test con el bug puesto.
  const { r } = await gen({ componentes: "led", umbral: 20 }, "b11-valor-ignorado")
  assert.match(r, /umbral \(20\)/i, "ignoró el umbral en silencio: el docente cree que lo aplicó")
})

// B11 cubrió "el umbral no aplica EN NINGÚN LADO" y dejó afuera el caso de al lado:
// "aplica, pero no el que pediste". El umbral se acotaba al rango del sensor con un
// Math.max/Math.min mudo y la función devolvía usaUmbral:true igual, así que el aviso
// de arriba tampoco disparaba.
//
// Lo que veía la docente: pedía que el circuito prendiera a 200, la hoja salía
// diciendo "≥ 60 °C" y el chat no decía absolutamente nada. Es el caso que SE VE BIEN
// y miente — peor que el que se ve roto.
test("B11: avisa cuando el umbral pedido no entra en el rango del sensor", async () => {
  // Ojo con el nombre del archivo: la respuesta trae la ruta del HTML, así que no
  // puede contener ni "200" ni "60" o el assert pasa con el bug puesto.
  const { r, html } = await gen({ componentes: "dht22, led", umbral: 200 }, "b11-fuera-de-rango")
  assert.match(html, /≥ 60 °C/, "la hoja dejó de mostrar el umbral que realmente usa")
  assert.match(r, /200/, "recortó el umbral y no lo mencionó: el docente cree que aplicó el suyo")
  assert.match(r, /\b60\b/, "avisó del recorte pero no dice en cuánto quedó")
})

test("B11: un umbral que SÍ entra en el rango se aplica sin ruido", async () => {
  // El aviso tiene que salir sólo cuando hubo recorte. Si avisa siempre, la docente
  // aprende a ignorarlo y el aviso del caso de arriba deja de servir para nada.
  const { r, html } = await gen({ componentes: "dht22, led", umbral: 40 }, "b11-dentro-de-rango")
  assert.match(html, /≥ 40 °C/, "no aplicó el umbral que se pidió")
  assert.doesNotMatch(r, /recort/i, "avisó de un recorte que no hubo")
  assert.doesNotMatch(r, /quedó sin usar/i, "dijo que no lo usó, y lo usó")
})

test("B11: avisa cuando el nombre de archivo pedido no se pudo usar", async () => {
  const r = await mod.execute({ circuito: "led-esp32", nombre_archivo: "電路図" }, { directory: OUTDIR })
  assert.match(r, /電路図/, "cayó al nombre por defecto sin decirlo: la docente busca un archivo que no existe")
})

// ── B12 · el bundle viejo no se refrescaba nunca ───────────────────────────
//
// Se copiaba sólo `if (!existsSync(local))`. Cuando la docente actualizaba Tecnia
// Bot, en su carpeta seguía la biblioteca VIEJA para siempre: la pieza nueva salía
// como una caja vacía y el circuito parecía roto justo después de actualizar.
test("B12: una biblioteca vieja en la carpeta de trabajo se actualiza sola", async () => {
  const extraLocal = join(OUTDIR, "componentes-extra.js")
  const bundleLocal = join(OUTDIR, "wokwi-bundle.js")
  writeFileSync(extraLocal, "/* version vieja, de otro tamaño */")
  writeFileSync(bundleLocal, "/* version vieja, de otro tamaño */")
  await gen({ componentes: "relay" }, "b12-biblioteca")
  assert.equal(readFileSync(extraLocal, "utf8"), "/*stub*/", "quedó el componentes-extra.js viejo")
  assert.equal(readFileSync(bundleLocal, "utf8"), "/*stub*/", "quedó el wokwi-bundle.js viejo")
})

// ── B13 · el GPIO manual perdía contra el asignador según el orden ─────────
//
// "led, servo:4" le daba el GPIO4 al LED automático (primero del pool) y el servo
// recibía "ya ocupado, le asigné otro"; "servo:4, led" andaba perfecto. El mismo
// circuito daba dos dibujos distintos, y el aviso culpaba al usuario por un pin
// que nadie más había pedido. Es la misma siembra previa que ya se hacía con los
// pines fijos del I2C (el "FIX auditoría #7").
test("B13: un GPIO pedido a mano no se lo lleva el asignador automático", async () => {
  const { html } = await gen({ componentes: "led, servo:4" }, "b13-orden")
  assert.match(filaTabla(html, "Servo SG90"), /GPIO4\b/, "el LED automático le robó el GPIO4 al servo")
  assert.doesNotMatch(html, /No pude usar GPIO4/, "encima le echó la culpa al usuario")
})

test("B13: el mismo pedido da el mismo circuito, esté en el orden que esté", async () => {
  const a = await gen({ componentes: "led, servo:4" }, "b13-a")
  const b = await gen({ componentes: "servo:4, led" }, "b13-b")
  assert.equal(filaTabla(a.html, "Servo SG90"), filaTabla(b.html, "Servo SG90"), "el servo cambia de pin según el orden")
})

test("B13: si dos piden el mismo pin, el segundo sí recibe el aviso", async () => {
  const { html } = await gen({ componentes: "led:5, servo:5" }, "b13-choque")
  assert.match(html, /ya ocupado/i, "dos componentes se quedaron con el mismo pin sin avisar")
})

// ════════════════════════════════════════════════════════════════════════════
// G · LOS INVARIANTES QUE NADIE PROBABA
//
// La auditoría anterior declaró estas cuatro cosas BIEN HECHAS, y lo están. El
// problema es otro: se las mutó a mano —el tope a 600, la siembra borrada, el
// `Set usados` ignorado, el bloqueo de flash apagado— y la suite entera siguió en
// VERDE. Un invariante que aguanta pero que ningún test defiende no está protegido:
// está teniendo suerte. El día que alguien refactorice esto, nada le va a avisar.
//
// Cada test de acá abajo nombra la mutación que mata.
// ════════════════════════════════════════════════════════════════════════════

// ── G1 · el tope de 1 a 6 componentes, en la puerta de entrada ──────────────
//
// OJO con la diferencia, que es la razón de que este test falte: hay DOS topes.
// El de la SALIDA (`pedidos.length > 6`, después de inyectar el mando) sí estaba
// cubierto por los tests de B3. El de la ENTRADA (`pedidoCrudo.length`) no lo
// probaba nadie: se podía subir a 600 y la suite no se movía.
//
// Y no es cosmético. Con siete componentes el pool digital (13 pines) se empieza a
// agotar, y lo que sale es una hoja con filas que dicen "GPIO?" — un circuito que
// la docente no puede cablear, cuando el tope existía justamente para no llegar ahí.
//
// MUTACIÓN QUE MATA: `pedidoCrudo.length > 6` → `> 600`.
test("G1: siete componentes no se arman: el tope de entrada los frena", async () => {
  const nombre = "g1-siete"
  // Ninguno es de potencia a propósito: así el que corta es el tope de ENTRADA y no
  // el de salida (que dispara recién cuando se inyecta un relé o un driver).
  const r = await mod.execute(
    { componentes: "led, led, led, buzzer, servo, boton, ldr", nombre_archivo: nombre },
    { directory: OUTDIR },
  )
  assert.doesNotMatch(r, /^Listo/, "armó siete componentes: el tope de entrada dejó de existir")
  assert.match(r, /1 a 6/, "no dice cuál es el tope")
  assert.ok(!existsSync(join(OUTDIR, nombre + ".html")), "dijo que no, y generó el HTML igual")
})

// El otro borde del mismo tope: una lista que no tiene NINGÚN componente adentro.
// "componentes: ', ,'" es verdadera (pasa el `.trim()` de la puerta) pero se queda en
// cero pedidos. Sin el `< 1` el motor arma una hoja con el ESP32 solo y cero piezas:
// exactamente la página vacía anunciada como "Listo!" que B1 vino a matar.
//
// MUTACIÓN QUE MATA: `pedidoCrudo.length < 1 ||` borrado.
test("G1: una lista de componentes vacía no genera una hoja sin piezas", async () => {
  const nombre = "g1-vacia"
  const r = await mod.execute({ componentes: ", ,", nombre_archivo: nombre }, { directory: OUTDIR })
  assert.doesNotMatch(r, /^Listo/, "dijo Listo con un circuito de cero componentes")
  assert.ok(!existsSync(join(OUTDIR, nombre + ".html")), "generó una hoja vacía igual")
})

// ── G2 · la siembra de los GPIO fijos del I2C (el "fix #7") ─────────────────
//
// GPIO21 y GPIO22 no están en POOL_DIGITAL, así que el asignador automático nunca
// los reparte solo — y por eso el fix parecía no proteger nada y nadie lo probó.
// Pero el pedido MANUAL sí llega ahí: "lcd, led:21" pide el 21 explícitamente, y el
// único que lo frena es ese loop de siembra que marca los pines fijos como ocupados
// ANTES de repartir.
//
// Lo que veía la docente sin la siembra: el LED y el SDA del LCD en el mismo GPIO21.
// El dibujo sale prolijo, los dos cables llegan al mismo agujero, y en la placa real
// el LED le pisa el bus I2C al display: el LCD no muestra nada y el LED tampoco
// prende bien. Dos componentes rotos por un pin, sin una palabra.
//
// MUTACIÓN QUE MATA: borrar el loop "FIX auditoría #7" de asignarGpios.
test("G2: un GPIO fijo del I2C no se le puede dar a otro componente", async () => {
  const { r, html } = await gen({ componentes: "lcd, led:21" }, "g2-i2c")
  const led = filaTabla(html, "LED")
  assert.doesNotMatch(led, /GPIO21\b/, "le dio el GPIO21 del bus I2C al LED: le pisa el SDA al LCD")
  assert.match(filaTabla(html, "LCD I2C"), /GPIO21\b/, "el LCD perdió su SDA")
  // Y se lo dice en el CHAT, no sólo en la hoja. Ojo con el assert: la respuesta trae
  // la tabla de pines, y ahí el GPIO21 aparece igual (es el SDA del LCD, que está
  // bien). Por eso se busca el AVISO y no el número: son dos cosas distintas.
  assert.match(r, /No pude usar GPIO21/, "le cambió el pin que pidió y no se lo dijo en el chat")
})

test("G2: el GPIO22 (SCL) tampoco se reparte", async () => {
  const { html } = await gen({ componentes: "oled, buzzer:22" }, "g2-scl")
  assert.doesNotMatch(filaTabla(html, "Buzzer"), /GPIO22\b/, "le dio el SCL del OLED al buzzer")
})

// ── G3 · el `Set usados` compartido entre los DOS pools ─────────────────────
//
// Hay dos pools (digital y analógico) y un solo `Set usados`. El GPIO33 es el ÚNICO
// número que está en los dos: POOL_DIGITAL lo tiene anteúltimo y POOL_ANALOGICO lo
// tiene último. O sea que la colisión sólo existe cuando un circuito consume casi
// todo el pool digital Y casi todo el analógico. Cualquier caso más chico pasa en
// verde con el chequeo puesto o sacado.
//
// Por eso el test que decía cuidar esto ("led, led, servo, buzzer": 4 pines de 13)
// era decorativo: no llegaba ni cerca del 33. Este pedido sí llega:
//   teclado 8 dig → 4,5,18,19,23,25,26,27 | led 1 dig → 33
//   joystick ×2 → 34,35 + 13 | 36,39 + 14 | ldr → 32 | ntc → el único que queda: 33
//
// Lo que veía la docente: el LED y el termistor cableados al mismo GPIO33, con la
// hoja dándole dos filas distintas y el mismo número. Ese circuito no se puede armar.
//
// MUTACIÓN QUE MATA: en `sacar()`, `if (!usados.has(g)) return g` → `return g`.
test("G3: el GPIO33 (el único que está en los dos pools) no se entrega dos veces", async () => {
  const { html } = await gen({ componentes: "teclado, led, joystick, joystick, ldr, ntc" }, "g3-pool33")
  const usados = gpiosDeLaTabla(html).filter((g) => g !== "GPIO21" && g !== "GPIO22") // 21/22 = I2C compartido
  assert.ok(usados.includes("GPIO33"), "el caso dejó de llegar al GPIO33: este test ya no prueba nada, revisá los pools")
  assert.equal(usados.length, new Set(usados).size, "dos componentes en el mismo pin: " + usados.join(", "))
})

// ── G4 · el bloqueo de los GPIO 6-11 (memoria flash) ───────────────────────
//
// Éste es el más engañoso de los cuatro. Si se desactiva el `if (GPIO_FLASH...)`, el
// pin SIGUE sin asignarse — pero de rebote, porque 6-11 tampoco están en GPIO_VALIDOS
// y el chequeo de abajo lo agarra. El test viejo mira sólo que el pin no se asigne,
// así que no ve la diferencia.
//
// Y la diferencia importa dos veces. Primero: la docente lee "GPIO6 no existe en el
// ESP32", que es MENTIRA —existe, es una pata real del chip— y se queda pensando que
// el bot está desactualizado. Segundo: 6-11 son GPIO reales, así que el día que
// alguien los agregue a GPIO_VALIDOS (que es lo razonable de hacer si creés que el
// problema es que "no existen") la protección se cae entera y sin ruido: el circuito
// sale con el LED colgado del bus de la flash, y esa placa no vuelve a arrancar.
//
// Por eso este test no mira el pin: mira el MOTIVO.
//
// MUTACIÓN QUE MATA: `if (GPIO_FLASH.has(g))` desactivado (y también agregar 6-11 a
// GPIO_VALIDOS, que es la forma en que esto se va a romper de verdad).
test("G4: un GPIO de flash se rechaza POR SER DE FLASH, no por 'no existe'", async () => {
  for (const g of [6, 8, 11]) {
    const { r, html } = await gen({ componentes: "led:" + g }, "g4-flash" + g)
    assert.ok(!pinesAsignados(html).includes("GPIO" + g), `asignó GPIO${g}: cuelga la placa`)
    assert.match(html, new RegExp(`GPIO${g} está cableado a la memoria flash`),
      `dice que GPIO${g} "no existe" (es falso: es una pata real) en vez de decir que es la flash`)
    assert.doesNotMatch(r, new RegExp(`GPIO${g} no existe`), "le explicó el motivo equivocado a la docente")
  }
})

test("G4: los 6 pines de la flash están todos bloqueados, no sólo las puntas", async () => {
  for (let g = 6; g <= 11; g++) {
    const { html } = await gen({ componentes: "led:" + g }, "g4-todos" + g)
    assert.ok(!pinesAsignados(html).includes("GPIO" + g), `GPIO${g} quedó asignado`)
  }
})

// ── G5 · los circuitos MONTADOS sobre protoboard: cero tests ───────────────
//
// Esta rama no arma nada: lee una plantilla HTML pre-validada del disco y la entrega
// tal cual. Justamente por eso no tenía un solo test — "no hay lógica que probar".
// Pero lo que puede fallar acá es peor que un pin mal puesto: que el asset no esté
// (instalador viejo, archivo renombrado) y la docente reciba un "Listo!" con un
// archivo vacío, o con el circuito EQUIVOCADO adentro.
//
// Son los dos presets que el prompt manda usar cada vez que alguien dice la palabra
// "protoboard", o sea de los más pedidos de todo el tool.
test("G5: los circuitos sobre protoboard entregan SU plantilla, no otra cosa", async () => {
  for (const [clave, archivo] of Object.entries(PLANTILLAS)) {
    const { r, html } = await gen({ circuito: clave }, "g5-" + clave)
    assert.ok(r.startsWith("Listo"), `"${clave}" no generó: ${r.slice(0, 90)}`)
    const original = readFileSync(join(REPO, "opencode/tecniabot-web", archivo), "utf8")
    assert.equal(html, original, `"${clave}" no entregó su plantilla (¿se cruzaron los archivos?)`)
    // y la plantilla trae de verdad un circuito armado, no una página de cortesía
    assert.ok(piezasDe(html).length > 0, `"${clave}" salió sin una sola pieza dibujada`)
    assert.match(html, /wokwi-breadboard|protoboard/i, `"${clave}" no tiene la protoboard adentro`)
  }
})

test("G5: cada preset de protoboard dice en el chat QUÉ armó", async () => {
  // Los dos son "un circuito en protoboard": si el encabezado no los distingue, la
  // docente pidió el semáforo, recibió el del botón, y el chat le dice lo mismo.
  const a = await gen({ circuito: "boton-led-protoboard" }, "g5-txt-boton")
  const b = await gen({ circuito: "semaforo-protoboard" }, "g5-txt-semaforo")
  assert.match(a.r, /bot[óo]n/i, "no dice que armó el del botón")
  assert.match(b.r, /sem[áa]foro/i, "no dice que armó el semáforo")
  assert.notEqual(a.r.split("\n")[0], b.r.split("\n")[0], "los dos circuitos se anuncian igual")
})

test("G5: si falta la plantilla instalada, lo dice en criollo y NO genera nada", async () => {
  // El asset lo copia el instalador. Si quedó a medias (o alguien renombró el
  // archivo), la rama entera se queda sin nada que servir. Lo que no puede pasar es
  // un "Listo!" con una página vacía: es el bug B1 otra vez, en la otra rama.
  const previo = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = CFG_SIN_EXTRA // ese XDG tiene el bundle, pero ninguna plantilla
  try {
    const nombre = "g5-sin-plantilla"
    const r = await mod.execute({ circuito: "semaforo-protoboard", nombre_archivo: nombre }, { directory: OUTDIR })
    assert.doesNotMatch(r, /^Listo/, "dijo Listo sin tener la plantilla")
    assert.match(r, /plantilla/i, "no dice qué es lo que falta")
    assert.match(r, /instalador/i, "no dice cómo arreglarlo")
    assert.ok(!existsSync(join(OUTDIR, nombre + ".html")), "generó un archivo igual")
  } finally {
    process.env.XDG_CONFIG_HOME = previo
  }
})

// ════════════════════════════════════════════════════════════════════════════
// LOS DOS CANALES — la hoja y el chat
//
// El tool contesta por dos lugares a la vez: el HTML (la hoja que la docente
// imprime y tiene al lado cuando cablea) y el texto que le vuelve al modelo (el
// chat). No son el mismo público ni sirven para lo mismo, y la regla es una sola:
// todo lo que significa "no te di EXACTAMENTE lo que pediste" tiene que salir por
// los DOS. Un aviso que vive sólo en la hoja es un aviso que el modelo no puede
// contar, y la docente que no abre el archivo nunca se entera.
// ════════════════════════════════════════════════════════════════════════════

// ── A · los avisos de pines se quedaban en la hoja ─────────────────────────
//
// La ronda anterior creó el canal `notas` con un contrato escrito: "todo lo que el
// docente TIENE que saber porque no le dimos EXACTAMENTE lo que pidió; van al final
// de la respuesta, nunca en silencio". Y dejó afuera TODOS los avisos de
// asignarGpios, que siguieron yéndose por `advertencias` → el <div> de la hoja.
// Misma función, dos contratos.
//
// Lo que veía la docente: pedía "lcd, led:21", el chat contestaba "Listo! Generé el
// circuito visual y animado." y nada más. El LED no estaba en el 21 (correcto: ahí
// va el SDA del LCD) pero para enterarse tenía que abrir el archivo y encontrar la
// línea perdida entre las advertencias generales de cada componente.
test("A: un pin que no se pudo respetar se dice en el CHAT, no sólo en la hoja", async () => {
  const casos = [
    ["lcd, led:21", /GPIO21/, "el pin del bus I2C"],
    ["led:34", /SOLO ENTRADA/i, "un pin de solo-entrada"],
    ["led:6", /memoria flash/i, "un pin de la memoria flash"],
    ["led:1", /puerto serie/i, "el puerto serie del USB"],
    ["led:5, servo:5", /ya ocupado/i, "un pin que ya estaba pedido"],
    ["7segmentos:4", /no alcanza/i, "un componente que usa más de un pin"],
  ]
  for (const [componentes, esperado, que] of casos) {
    const { r } = await gen({ componentes }, "a-chat-" + componentes.replace(/[^a-z0-9]+/gi, "-"))
    assert.match(r, esperado, `le cambió ${que} y el chat no dijo una palabra: "${componentes}"`)
  }
})

test("A: el aviso de strapping NO va al chat: ese pin SÍ se dio y funciona", async () => {
  // El contrapeso del test de arriba, y no es un detalle. GPIO15 es strapping: se
  // respeta el pedido, el circuito anda, y la nota es una sugerencia ("si podés,
  // elegí otro") que pertenece a la hoja. Si el chat avisa de TODO, la docente
  // aprende a saltearse los ⚠️ y el aviso que sí importa deja de existir.
  const { r, html } = await gen({ componentes: "led:15" }, "a-pin-15") // OJO: el nombre del archivo va en la respuesta, así que NO puede contener "strapping"
  assert.ok(pinesAsignados(html).includes("GPIO15"), "no respetó el GPIO15, que es perfectamente usable")
  assert.match(html, /strapping/i, "la hoja dejó de mencionar que es un pin strapping")
  assert.doesNotMatch(r, /strapping/i, "llenó el chat con un aviso de algo que SÍ le dio")
})

test("A: un circuito sin sorpresas no arrastra ni un ⚠️", async () => {
  // La otra mitad de lo mismo: si el pedido se cumple tal cual, no hay nada que aclarar.
  const { r } = await gen({ componentes: "led:5, servo:18" }, "a-limpio")
  assert.doesNotMatch(r, /⚠️/, "inventó una aclaración en un circuito que salió exactamente como se pidió")
})

// El prompt del agente (opencode/agent/tecnia-bot.md) le ORDENA al modelo: "describí
// las conexiones leyendo la tabla que muestra el propio circuito — NO inventes pines".
// Y la respuesta del tool no traía ninguna tabla. Le pedíamos leer algo que nunca
// recibía: o se callaba, o inventaba. Y lo que el modelo escribe en el chat es lo que
// el pibe cablea, igual que el dibujo.
test("A: la respuesta le devuelve al modelo la tabla de pines que el prompt le manda leer", async () => {
  const { r, html } = await gen({ componentes: "led, servo, dht22" }, "a-tabla")
  for (const etiqueta of ["LED", "Servo SG90", "DHT22"]) {
    assert.ok(r.includes(etiqueta), `la tabla del chat no nombra a "${etiqueta}"`)
  }
  // y los pines del chat son EXACTAMENTE los del dibujo: si divergen, el modelo
  // describe un circuito y la hoja muestra otro, que es peor que no decir nada.
  const enElChat = pinesEn(r)
  const enLaHoja = pinesAsignados(html)
  assert.deepEqual(enElChat, enLaHoja, "los pines que el chat le dicta al modelo no son los del dibujo")
})

test("A: los presets también devuelven su tabla de pines", async () => {
  const { r, html } = await gen({ circuito: "alarma" }, "a-tabla-preset")
  assert.match(r, /Conexiones/i, "el preset no le devuelve ninguna tabla al modelo")
  assert.deepEqual(pinesEn(r), pinesAsignados(html), "la tabla del preset no coincide con su dibujo")
})

// ── B · pool agotado, y el tool decía "Listo!" ─────────────────────────────
//
// "teclado, led, joystick, joystick, ldr, ntc" son SEIS componentes: un pedido
// perfectamente legal, dentro del tope. Pero entre los dos joysticks, el LDR y el
// NTC se acaban las entradas analógicas, y el NTC sale con "GPIO?" en la hoja.
//
// Lo que veía la docente: «Listo! Generé el circuito visual y animado.» Sin un solo
// ⚠️. Después abría la hoja y ahí, en la fila del NTC, decía GPIO?. B8 se ocupó de
// que dijera "GPIO?" y no "GPIOGPIO?", que estuvo bien — pero un componente sin pin
// no es un problema tipográfico: es un circuito INCOMPLETO anunciado como terminado.
test("B: un componente sin pin no se anuncia como Listo", async () => {
  const { r } = await gen({ componentes: "teclado, led, joystick, joystick, ldr, ntc" }, "b-pool-agotado")
  assert.doesNotMatch(r, /^Listo/, 'dijo "Listo!" con un circuito al que le falta un pin')
  assert.match(r, /INCOMPLETO/, "no dice que el circuito quedó incompleto")
  assert.match(r, /NTC/i, "no dice CUÁL es el componente que quedó sin pin")
  assert.match(r, /⚠️/, "no arrastró ni un aviso")
  assert.match(r, /GPIO\?/, "no le explica qué va a ver en la hoja")
})

test("B: el aviso de pool agotado llega al chat, no sólo a la hoja", async () => {
  const { r, html } = await gen({ componentes: "teclado, 7segmentos, led, led, led" }, "b-pool-digital")
  assert.match(html, /No quedan GPIO digital libres/, "la hoja dejó de avisarlo")
  assert.match(r, /No quedan GPIO digital libres/, "el aviso se quedó en la hoja")
})

test("B: un circuito que SÍ entra sigue diciendo Listo", async () => {
  // El contra-test. Si el encabezado nuevo dispara de más, todos los circuitos buenos
  // pasan a anunciarse como rotos y la advertencia deja de significar nada.
  const { r } = await gen({ componentes: "teclado, led, joystick, ldr, ntc" }, "b-entra")
  assert.ok(r.startsWith("Listo"), "marcó como incompleto un circuito que tiene todos sus pines: " + r.slice(0, 120))
  assert.doesNotMatch(r, /GPIO\?/, "dice que hay un pin sin asignar y no lo hay")
})

// ── C · "riego.html" salía como "riego.html.html" ──────────────────────────
//
// El punto sobrevive al saneamiento (tiene que sobrevivir: es un carácter válido),
// el nombre quedaba IGUAL al pedido así que tampoco saltaba el aviso de B11, y
// después execute le pegaba ".html" de nuevo. Pedir el archivo con su extensión es
// lo más natural del mundo y el modelo lo hace todo el tiempo.
test("C: pedir el archivo con su extensión no lo deja como riego.html.html", async () => {
  const r = await mod.execute({ circuito: "led-esp32", nombre_archivo: "c-riego.html" }, { directory: OUTDIR })
  assert.ok(existsSync(join(OUTDIR, "c-riego.html")), "no guardó el archivo con el nombre que se pidió")
  assert.ok(!existsSync(join(OUTDIR, "c-riego.html.html")), "le pegó la extensión dos veces")
  assert.match(r, /c-riego\.html/, "no dice dónde quedó")
  assert.doesNotMatch(r, /c-riego\.html\.html/, "le dijo a la docente que buscara un .html.html")
})

test("C: y no inventa un aviso, porque el pedido SÍ se respetó", async () => {
  // "riego.html" y "riego" son el mismo pedido. Avisar acá sería ruido: la docente
  // pidió un archivo y recibió exactamente ese archivo.
  const r = await mod.execute({ circuito: "led-esp32", nombre_archivo: "c-sin-ruido.HTML" }, { directory: OUTDIR })
  assert.doesNotMatch(r, /No pude usar/, "avisó de un cambio de nombre que no hubo")
  assert.ok(existsSync(join(OUTDIR, "c-sin-ruido.html")), "no guardó con el nombre pedido")
})

test("C: el saneamiento de verdad sigue intacto", async () => {
  // El arreglo saca la extensión ANTES de limpiar. Lo que no puede es aflojar el
  // saneamiento: "..\\..\\x.html" tiene que seguir sin escapar de la carpeta.
  const afuera = join(OUTDIR, "..", "..", "c-escape.html")
  rmSync(afuera, { force: true })
  await mod.execute({ circuito: "led-esp32", nombre_archivo: "../../c-escape.html" }, { directory: OUTDIR })
  assert.ok(!existsSync(afuera), "PATH TRAVERSAL: el arreglo de la extensión abrió un agujero")
  assert.ok(existsSync(join(OUTDIR, "c-escape.html")), "no escapó, pero tampoco guardó adentro")
})

// ── D · dos avisos contradictorios en la misma respuesta ───────────────────
//
// El aviso del nombre lo armaba nombreSeguro, que corre ANTES de guardar. Pero el
// nombre final se decide DESPUÉS: si el archivo ya existía, rutaDeSalida lo versiona
// a "-2". Salían los dos juntos, peleándose:
//   ⚠️ No pude usar "電路図" … lo guardé como "circuito-led-esp32.html".
//   ⚠️ Ya había un "circuito-led-esp32.html" … este quedó como "…-2.html".
//
// Lo que veía la docente: la primera línea le nombra un archivo que existe, que se
// abre, y que NO es el suyo — es el de la clase anterior. Un aviso que afirma algo
// falso con total seguridad es peor que no avisar.
test("D: los dos avisos del nombre nunca se contradicen", async () => {
  const pedido = "電路図"
  await mod.execute({ circuito: "led-esp32", nombre_archivo: pedido }, { directory: OUTDIR })
  const r = await mod.execute({ circuito: "led-esp32", nombre_archivo: pedido }, { directory: OUTDIR })

  // el archivo que de verdad se escribió en esta segunda pasada
  const real = r.match(/(circuito-led-esp32[\w.-]*\.html)/)?.[1]
  assert.ok(real, "no dice en qué archivo quedó")
  assert.ok(existsSync(join(OUTDIR, real)), `dijo "${real}" y ese archivo no está`)

  // TODOS los nombres de archivo que la respuesta afirma tienen que ser ESE
  const afirmados = new Set(
    [...r.matchAll(/(?:lo guardé como|este quedó como) "([^"]+)"/g)].map((m) => m[1]),
  )
  assert.ok(afirmados.size > 0, "no quedó ningún aviso sobre el nombre")
  for (const n of afirmados) {
    assert.equal(n, real, `un aviso manda a abrir "${n}" y el circuito quedó en "${real}"`)
  }
  assert.match(r, new RegExp(pedido), "dejó de decir qué nombre no pudo usar")
})

// ── E · un solo relé para dos cargas de potencia ───────────────────────────
//
// "ldr, lampara, calefactor" inyectaba UN relé —el guard buscaba la PRIMERA carga y
// se daba por satisfecho— y el aviso nombraba nada más que la lámpara. Un módulo relé
// de un canal tiene UN contacto: no conmuta dos cargas independientes.
//
// Lo que veía la docente: un circuito que mandaba a colgar la lámpara Y el calefactor
// del mismo relé, sin decir que iban a prenderse y apagarse siempre juntos, y con un
// aviso que ni mencionaba al calefactor — así que no tenía de dónde sospechar.
test("E: dos cargas de potencia reciben un relé CADA UNA", async () => {
  const { r, html } = await gen({ componentes: "ldr, lampara, calefactor" }, "e-dos-cargas")
  assert.equal(piezasDe(html).filter((p) => p === "pb-relay").length, 2, "un solo relé para dos cargas independientes")
  // y el aviso nombra a LAS DOS: nombrar una sola es peor que no avisar, porque
  // deja a la otra sin explicación y con pinta de estar bien.
  assert.match(r, /l[áa]mpara/i, "el aviso no nombra la lámpara")
  assert.match(r, /calefactor/i, "el aviso no nombra el calefactor")
  // cada relé con su propio GPIO: si comparten pin, son un relé disfrazado de dos
  const señales = [...html.matchAll(/<tr><td>Módulo Relé<\/td>.*?<td>(.*?)<\/td><\/tr>/g)]
    .flatMap((m) => pinesEn(m[1]))
  assert.equal(señales.length, 2, "los dos relés no tienen dos señales en la tabla")
  assert.notEqual(señales[0], señales[1], "los dos relés cuelgan del mismo GPIO: se mueven juntos igual")
})

test("E: una sola carga sigue recibiendo un solo relé, con el aviso de siempre", async () => {
  // El contra-test: el caso normal (riego) no puede empezar a recibir relés de más.
  const { r, html } = await gen({ componentes: "higrometro, bomba" }, "e-una-carga")
  assert.equal(piezasDe(html).filter((p) => p === "pb-relay").length, 1, "le agregó relés de más al riego")
  assert.match(r, /agregu[ée]/i, "dejó de contar que agregó el relé")
})

test("E: el relé que trajo el usuario se respeta, pero se le avisa que va compartido", async () => {
  // Acá NO se inyecta nada, y es a propósito: el usuario puso un relé en la lista y
  // esa decisión es suya (puede tener un módulo de 2 o 4 canales, que es lo más común
  // de comprar). Lo que no se puede es callarse que ese único módulo tiene que
  // gobernar dos cargas: con uno de un canal, las dos se mueven juntas.
  const { r, html } = await gen({ componentes: "ldr, relay, lampara, calefactor" }, "e-rele-propio")
  assert.equal(piezasDe(html).filter((p) => p === "pb-relay").length, 1, "le agregó un relé que el usuario no pidió")
  assert.match(r, /juntas|juntos/i, "no avisa que las dos cargas se prenden y apagan juntas")
  assert.match(r, /canal/i, "no explica que el problema es la cantidad de canales")
})

test("E: el driver del motor no se contagia del arreglo del relé", async () => {
  // relay y driver son familias distintas: un relé ajeno nunca dejó al motor sin
  // driver (eso lo arregló B3) y el cambio de E no puede reabrirlo.
  const { html } = await gen({ componentes: "dht22, relay, calefactor, motor" }, "e-familias")
  assert.equal(piezasDe(html).filter((p) => p === "pb-relay").length, 1, "duplicó el relé del usuario")
  assert.equal(piezasDe(html).filter((p) => p === "pb-driver").length, 1, "el motor se quedó sin driver")
})

// ── F · dos dispositivos I2C con la misma dirección ────────────────────────
//
// "oled, oled" salía con los dos en SDA=GPIO21 / SCL=GPIO22 y sin una palabra. En la
// hoja se ve impecable —es literalmente cómo se cablea el I2C, todos en paralelo— y
// por eso es de los que más engañan: el bus está bien, lo que choca es que los dos
// módulos vienen de fábrica con la MISMA dirección (el SSD1306 en 0x3C).
//
// Lo que veía la docente: cableaba los dos displays exactamente como decía la hoja y
// andaba uno solo. Y como el dibujo está bien, buscaba el problema en la soldadura.
test("F: dos dispositivos I2C iguales avisan que comparten dirección", async () => {
  const { r, html } = await gen({ componentes: "oled, oled" }, "f-dos-oled")
  assert.match(html, /direcci[óo]n/i, "la hoja no dice nada del choque de direcciones")
  assert.match(r, /direcci[óo]n/i, "el chat no dice nada del choque de direcciones")
  assert.match(r, /TCA9548A|jumper|puente/i, "avisa del problema y no dice cómo resolverlo")
})

test("F: también avisa con dos LCD y con dos MPU6050", async () => {
  for (const [c, etiqueta] of [["lcd, lcd", "LCD"], ["mpu6050, mpu6050", "MPU6050"]]) {
    const { r } = await gen({ componentes: c }, "f-" + etiqueta)
    assert.match(r, /MISMA direcci[óo]n/i, `"${c}" no avisa del choque`)
  }
})

test("F: dos I2C DISTINTOS no disparan el aviso: conviven perfecto", async () => {
  // Ésta es la gracia del I2C y por eso el aviso tiene que ser fino: un OLED (0x3C) y
  // un LCD (0x27) van los dos al mismo bus y funcionan. Si acá avisa, el ⚠️ se vuelve
  // ruido de fondo y el caso de arriba deja de leerse.
  const { r } = await gen({ componentes: "oled, lcd" }, "f-distintos")
  assert.doesNotMatch(r, /MISMA direcci[óo]n/i, "avisó de un choque que no existe: OLED y LCD tienen direcciones distintas")
})

test("F: un solo dispositivo I2C nunca avisa nada", async () => {
  const { r } = await gen({ componentes: "oled, led" }, "f-uno-solo")
  assert.doesNotMatch(r, /direcci[óo]n de f[áa]brica/i, "avisó de un choque con un solo dispositivo I2C")
})

test("E: si el usuario trajo un relé POR CARGA, no se le avisa de nada", async () => {
  // El contrapeso del test de arriba, y es el que evita que el arreglo de E se
  // convierta en el problema que vino a resolver. "relay, lampara, relay, calefactor"
  // son DOS relés para DOS cargas: el circuito está impecable. Avisarle que se
  // comparten sería afirmarle algo FALSO — la misma categoría de error que esta
  // ronda vino a sacar, no a mudar de lugar.
  const { r, html } = await gen({ componentes: "relay, lampara, relay, calefactor" }, "e-uno-por-carga")
  assert.equal(piezasDe(html).filter((p) => p === "pb-relay").length, 2, "perdió uno de los relés que se pidieron")
  assert.doesNotMatch(r, /juntas|juntos/i, "le avisó de un relé compartido que no comparte nada")
  assert.doesNotMatch(r, /agregu[ée]/i, "agregó un mando que nadie pidió")
})

test("E: con varias cargas, lo que sugiere al pasarse del tope se arma de verdad", async () => {
  // Un relé por carga empuja los pedidos de varias cargas contra el tope de 6, que
  // antes no alcanzaban (se comían un relé solo). O sea: el camino de la sugerencia,
  // que B3 dejó cubierto para UNA carga, ahora se alcanza con VARIAS. La sugerencia
  // tiene que seguir siendo armable — una que vuelve a rebotar contra el mismo tope
  // manda a la docente a un loop, que es la peor forma de decir que no.
  const r = await mod.execute({ componentes: "ldr, lampara, calefactor, bomba" }, { directory: OUTDIR })
  assert.doesNotMatch(r, /^Listo/, "armó 3 cargas + sensor + 3 relés: se pasó del tope sin frenar")
  const sugerida = r.match(/por ejemplo: "([^"]+)"/)?.[1]
  assert.ok(sugerida, "no ofreció ninguna lista de ejemplo: " + r.slice(0, 140))
  const r2 = await mod.execute({ componentes: sugerida, nombre_archivo: "e-sugerencia" }, { directory: OUTDIR })
  assert.ok(r2.startsWith("Listo"), `la lista que sugiere tampoco se puede armar: "${sugerida}" → ${r2.slice(0, 140)}`)
  // y lo que sugiere tiene que traer un mando por cada carga que dejó adentro
  const html = readFileSync(join(OUTDIR, "e-sugerencia.html"), "utf8")
  const piezas = piezasDe(html)
  const cargas = piezas.filter((p) => ["pb-lampara", "pb-calefactor", "pb-bomba", "pb-valvula"].includes(p)).length
  assert.equal(piezas.filter((p) => p === "pb-relay").length, cargas, "sugirió un circuito con menos relés que cargas")
})

// ════════════════════════════════════════════════════════════════════════════
// ARDUINO UNO — la placa que de verdad hay arriba de la mesa
//
// Las escuelas técnicas argentinas usan Arduino UNO con Sensor Shield más que
// ESP32. Hasta esta tanda, la docente que pedía SU circuito recibía el de otra
// placa: pines GPIO que en la suya no existen, 3,3 V donde ella tiene 5 V, y un
// bus I2C en dos pines que su placa dedica a otra cosa. El dibujo salía impecable
// — por eso no había forma de darse cuenta.
//
// Cada test de acá abajo dice QUÉ VEÍA LA DOCENTE, igual que los de la auditoría.
// ════════════════════════════════════════════════════════════════════════════

const AVISO_HOJA = /<div class="aviso">([\s\S]*?)<\/div>/

// El catálogo de componentes se le pregunta AL TOOL, no se copia acá: el mensaje
// de "No conozco" ya lo enumera entero. Una lista a mano en este archivo
// envejecería sola y los invariantes de más abajo pasarían a verificar un catálogo
// que el tool ya no tiene.
async function tiposDelTool() {
  const { r } = await gen({ componentes: "esto-no-existe-ni-va-a-existir" }, "uno-catalogo")
  const m = r.match(/Tengo: ([^.]+)\./)
  assert.ok(m, "el tool dejó de enumerar su catálogo al rechazar un componente: " + r.slice(0, 120))
  return m[1].split(",").map((s) => s.trim()).filter(Boolean)
}

// ── el reparto: D4 y A4 son DOS pines, no uno ───────────────────────────────
//
// ÉSTE ES EL TEST DE LA REGRESIÓN QUE MOTIVÓ TODO EL PORT.
//
// El asignador llevaba los ocupados en un `Set<number>`, y en el ESP32 estaba
// bien: el GPIO33 aparece en el pool digital y en el analógico porque ES EL MISMO
// PIN, y el Set evitaba entregarlo dos veces (una auditoría generó 40.169
// circuitos y confirmó cero colisiones).
//
// En un UNO ese mismo Set es un bug: D4 y A4 son dos pines distintos, en dos
// filas distintas de la placa, que apenas comparten el número. Con pools
// numéricos, darle D4 a un LED tachaba también A4 — y el tool le decía a la
// docente "no quedan entradas analógicas" con A4 libre y a la vista. Peor: darle
// A5 a un sensor tachaba D5, que es PWM, que es donde va el servo.
//
// MUTACIÓN QUE MATA: en asignarGpios, `usados.add(clavePin(p))` → `usados.add(String(p.n))`.
test("UNO: asignar D4 no bloquea A4 — son dos pines distintos con el mismo número", async () => {
  // led, led → D2 y D4 · joystick ×2 → A0,A1 y A2,A3 (+ un digital cada uno) ·
  // ldr → la única analógica que queda antes del bus I2C: A4.
  const { html } = await gen({ componentes: "led, led, joystick, joystick, ldr", placa: "uno" }, "uno-d4-vs-a4")
  const usados = gpiosDeLaTabla(html)
  assert.ok(usados.includes("D4"), "el caso dejó de llegar a D4: este test ya no prueba nada, revisá el pool")
  assert.ok(
    usados.includes("A4"),
    "D4 le bloqueó A4 al sensor: son dos pines distintos. Pines repartidos: " + usados.join(", "),
  )
  assert.equal(usados.length, new Set(usados).size, "dos componentes en el mismo pin: " + usados.join(", "))
})

test("UNO: y tampoco al revés — A5 no le come el D5, que es PWM", async () => {
  // Lo que veía la docente con el Set numérico: pedía cinco sensores analógicos y
  // un servo, y el servo salía "sin pines PWM" cuando le quedaban cinco de los seis.
  const { html } = await gen({ componentes: "potenciometro, ntc, higrometro, lluvia, servo", placa: "uno" }, "uno-a5-vs-d5")
  const usados = gpiosDeLaTabla(html)
  assert.equal(usados.length, new Set(usados).size, "dos componentes en el mismo pin: " + usados.join(", "))
  const servo = filaTabla(html, "Servo SG90")
  assert.doesNotMatch(servo, /D\?/, "el servo se quedó sin pin PWM teniendo seis libres: " + servo)
})

// ── la placa que se dibuja es la que se pidió ───────────────────────────────
//
// Lo que veía la docente: pedía su circuito, recibía un ESP32 con pines GPIO, y el
// chat se lo anunciaba como "Listo!". No hay forma de que se dé cuenta: el dibujo
// está bien hecho, sólo que es de otra placa.
test("UNO: dibuja un Arduino UNO, cero ESP32, y ningún pin dice GPIO", async () => {
  const { r, html } = await gen({ componentes: "led, boton, buzzer, potenciometro", placa: "uno" }, "uno-es-uno")
  assert.ok(r.startsWith("Listo"), "no armó el circuito básico en UNO: " + r.slice(0, 140))
  assert.match(html, /<wokwi-arduino-uno/, "no dibujó la pieza del Arduino UNO")
  assert.doesNotMatch(html, /wokwi-esp32-devkit-v1/, "pidieron un UNO y la hoja trae un ESP32")
  const pines = [...pinesAsignados(html), ...gpiosDeLaTabla(html)]
  assert.ok(pines.length > 0, "no encontré ningún pin en la hoja: el test no está probando nada")
  assert.deepEqual(
    pines.filter((p) => p.startsWith("GPIO")),
    [],
    "quedaron pines con nombre de ESP32 en un circuito de UNO",
  )
  // y el chat le dicta al modelo los mismos pines que muestra la hoja
  assert.deepEqual(pinesEn(r), pinesAsignados(html), "los pines que el chat le dicta al modelo no son los del dibujo")
})

test("UNO: el default sigue siendo ESP32 — la segunda placa se pide, no se adivina", async () => {
  // El contrapeso, y es el contrato de no-regresión de toda la tanda: los tests que
  // ya existían no pasan `placa` y tienen que seguir recibiendo exactamente lo mismo.
  const { html } = await gen({ componentes: "led, servo" }, "uno-default")
  assert.match(html, /<wokwi-esp32-devkit-v1/, "sin pedir placa dejó de salir el ESP32")
  assert.doesNotMatch(html, /wokwi-arduino-uno/, "sin pedir placa salió un UNO")
})

test("una placa que no sé dibujar se rechaza sin decirle que su placa no existe", async () => {
  // La diferencia importa: el catálogo de placas que EXISTEN vive en el skill
  // `placas` (Educablocks, Bhoot, Mis Ladrillos…). Este tool sólo sabe qué puede
  // DIBUJAR, que es mucho menos. Contestarle "esa placa no existe" a la docente que
  // tiene una Educablocks en la mano es peor que no dibujarle nada.
  const { r, html } = await gen({ componentes: "led", placa: "nano" }, "placa-desconocida")
  assert.doesNotMatch(r, /^Listo/, "aceptó una placa que no sabe dibujar")
  assert.equal(html, "", "dijo que no y generó la hoja igual")
  assert.match(r, /esp32/i, "no dice cuáles sí puede dibujar")
  assert.match(r, /uno/i, "no dice cuáles sí puede dibujar")
  assert.match(r, /placas/, "no manda al skill donde está el catálogo de placas de verdad")
  assert.doesNotMatch(r, /no existe/i, "le dijo a la docente que su placa no existe")
})

// ── PWM: en el UNO son seis, y el servo los necesita ────────────────────────
//
// El skill `actuadores` es explícito (`:104`): «En Arduino UNO usá un pin PWM (con
// ~); en ESP32 cualquier GPIO». La serigrafía de la propia pieza de Wokwi dice
// «13 · 12 · ~11 · ~10 · ~9 · 8 | 7 · ~6 · ~5 · 4 · ~3 · 2 · TX→1 · RX←0».
//
// Lo que veía la docente sin esto: el servo cableado al D4, la librería Servo
// cargada, y el brazo quieto. Y el diagrama se lo había dado el bot.
const PWM_UNO = ["D3", "D5", "D6", "D9", "D10", "D11"]

test("UNO: el servo cae SIEMPRE en un pin PWM, esté donde esté en la lista", async () => {
  const casos = ["servo", "led, servo", "led, led, led, led, led, servo", "teclado, servo"]
  for (const c of casos) {
    const { html } = await gen({ componentes: c, placa: "uno" }, "uno-pwm-" + c.replace(/[^a-z]+/gi, "-"))
    const fila = filaTabla(html, "Servo SG90")
    const senal = pinesEn(fila).filter((p) => p.startsWith("D"))
    assert.equal(senal.length, 1, `el servo dejó de declarar su pin de señal en "${c}": ${fila}`)
    assert.ok(PWM_UNO.includes(senal[0]), `el servo quedó en ${senal[0]}, que no hace PWM ("${c}")`)
  }
})

test("UNO: un pin pedido a mano que no hace PWM se rechaza, y se dice cuáles sí", async () => {
  const { r, html } = await gen({ componentes: "servo:4", placa: "uno" }, "uno-servo-sin-pwm")
  const senal = pinesEn(filaTabla(html, "Servo SG90")).filter((p) => p.startsWith("D"))
  assert.ok(PWM_UNO.includes(senal[0]), "le dio al servo el D4, que no hace PWM")
  assert.match(r, /PWM/, "le cambió el pin que pidió y el chat no dijo una palabra")
  assert.match(html, /D3, D5, D6, D9, D10, D11/, "avisa del problema y no dice cuáles sirven")
})

test("UNO: quedarse sin PWM se avisa explícito, no se disfraza de digital", async () => {
  // Cinco servos + un RGB piden nueve pines PWM y el UNO tiene seis. Lo que NO
  // puede pasar es que los tres que faltan salgan en un digital cualquiera: ese
  // circuito se ve completo y no anda, que es el peor de los dos finales.
  const { r, html } = await gen({ componentes: "servo, servo, servo, servo, servo, rgb-led", placa: "uno" }, "uno-pwm-agotado")
  assert.doesNotMatch(r, /^Listo/, "anunció como terminado un circuito al que le faltan pines PWM")
  assert.match(r, /INCOMPLETO/, "no dice que el circuito quedó incompleto")
  assert.match(r, /pines PWM/i, "no dice que lo que se acabó fue el PWM")
  assert.match(html, /No quedan pines PWM libres/, "la hoja no lo avisa")
  // los seis PWM se usaron de verdad antes de darse por vencido
  const usados = gpiosDeLaTabla(html)
  for (const p of PWM_UNO) assert.ok(usados.includes(p), `se rindió sin usar ${p}, que hace PWM`)
  // y el chat le dice a la docente EXACTAMENTE el texto que va a encontrar en la hoja
  const marca = r.match(/esa fila dice "([^"]+)"/)?.[1]
  assert.ok(marca, "no le dice qué va a ver en la hoja")
  assert.ok(html.includes(marca), `el chat manda a buscar "${marca}" y la hoja no dice eso`)
})

test("UNO: un LED común NO se come un pin PWM habiendo digitales pelados", async () => {
  // El orden del pool no es cosmético: si el primer LED se lleva el D3, el servo
  // del mismo circuito se queda sin lugar con la mitad del PWM libre.
  const { html } = await gen({ componentes: "led, led, led", placa: "uno" }, "uno-led-no-pisa-pwm")
  for (const p of pinesEn(filaTabla(html, "LED"))) {
    assert.ok(!PWM_UNO.includes(p), `un LED se llevó ${p}, que es de los seis que hacen PWM`)
  }
})

// ── I2C en A4/A5: el bug MUDO que el símbolo SDA/SCL arregla ────────────────
//
// La siembra de pines ocupados leía el destino con un regex /GPIO(\d+)/. En el UNO
// el SDA se llama A4: ese regex no matchea, y los dos pines del bus quedaban SIN
// reservar. El asignador le daba A4 al primer sensor analógico y el LCD se quedaba
// sin bus.
//
// Lo que veía la docente: la hoja mandaba el SDA del display Y el sensor de
// humedad al mismo agujero. Cableaba lo que veía, y no andaba ninguno de los dos.
// Ni un ⚠️ en ningún lado: el dibujo está bien hecho.
//
// MUTACIÓN QUE MATA: borrar el loop de siembra I2C de asignarGpios.
test("UNO: el LCD sale en A4/A5, y esas dos quedan FUERA del pool analógico", async () => {
  const { html } = await gen({ componentes: "lcd, ntc, potenciometro, higrometro, lluvia", placa: "uno" }, "uno-i2c-reserva")
  const lcd = filaTabla(html, "LCD I2C")
  assert.match(lcd, /\bA4\b/, "el LCD perdió su SDA")
  assert.match(lcd, /\bA5\b/, "el LCD perdió su SCL")
  for (const et of ["Sensor de temperatura NTC", "Potenciómetro", "Higrómetro de suelo", "Sensor de lluvia"]) {
    const fila = filaTabla(html, et)
    assert.ok(fila.length > 0, `no encontré la fila de "${et}"`)
    assert.doesNotMatch(fila, /\bA4\b|\bA5\b/, `${et} quedó pinchado en el bus I2C del LCD: ${fila}`)
  }
  const usados = gpiosDeLaTabla(html)
  assert.equal(usados.length, new Set(usados).size, "dos componentes en el mismo pin: " + usados.join(", "))
})

test("UNO: sin ningún módulo I2C, A4 y A5 se reparten como cualquier analógica", async () => {
  // El contrapeso: reservarlas SIEMPRE sería regalarle dos entradas al aire. Sólo
  // se reservan cuando hay alguien colgado del bus.
  const { html } = await gen({ componentes: "joystick, joystick, ntc, potenciometro", placa: "uno" }, "uno-sin-i2c")
  const usados = gpiosDeLaTabla(html)
  assert.ok(usados.includes("A4"), "dejó A4 sin usar sin que haya ningún I2C que la necesite")
  assert.ok(usados.includes("A5"), "dejó A5 sin usar sin que haya ningún I2C que la necesite")
})

test("UNO: dos módulos I2C iguales siguen avisando del choque de direcciones", async () => {
  // El detector preguntaba `destino === "GPIO21"`: en el UNO no matcheaba nunca, o
  // sea que el aviso F —dos OLED con la misma dirección de fábrica— habría
  // desaparecido en silencio justo en la placa nueva.
  const { r, html } = await gen({ componentes: "oled, oled", placa: "uno" }, "uno-dos-oled")
  assert.match(r, /MISMA direcci[óo]n/i, "el chat no dice nada del choque de direcciones")
  assert.match(html, /SDA=A4, SCL=A5/, "nombra el bus con los pines de la otra placa")
  assert.doesNotMatch(html, /GPIO21|GPIO22/, "el aviso del UNO cita los pines I2C del ESP32")
})

// ── pines que existen, con su pero: D0/D1 y D13 ─────────────────────────────
//
// Decisión del producto: ENTRAN al pool (el UNO tiene 14 digitales y sacarle tres
// es sacarle el 20%), pero al final de la fila y con aviso — igual que hoy el GPIO2
// del ESP32. El aviso va a la HOJA y no al chat, a propósito: ese pin SÍ se dio y
// funciona. Si el chat avisa de todo, la docente aprende a saltearse los ⚠️.
test("UNO: D13 y D0/D1 se usan, pero la hoja cuenta con qué se van a encontrar", async () => {
  const { r, html } = await gen({ componentes: "led:13, led:0", placa: "uno" }, "uno-pines-con-pero")
  const usados = pinesAsignados(html)
  assert.ok(usados.includes("D13"), "no respetó el D13, que es perfectamente usable")
  assert.ok(usados.includes("D0"), "no respetó el D0, que es perfectamente usable")
  assert.match(html, /LED de la placa/i, "la hoja no avisa que D13 tiene el LED soldado en paralelo")
  assert.match(html, /puerto serie/i, "la hoja no avisa que D0 y D1 son el serie del USB")
  assert.doesNotMatch(r, /LED de la placa|puerto serie/i, "llenó el chat con avisos de pines que SÍ le dio")
})

test("UNO: los pines de riesgo van al FINAL del pool, no al principio", async () => {
  // Si D13/D0/D1 salieran primero, el circuito más simple del mundo arrancaría en
  // el pin que comparte el LED de placa. Entran, pero últimos.
  const { html } = await gen({ componentes: "led, led, led", placa: "uno" }, "uno-orden-pool")
  for (const p of pinesEn(filaTabla(html, "LED"))) {
    assert.ok(!["D13", "D0", "D1"].includes(p), `repartió ${p} habiendo digitales sin ningún pero libres`)
  }
})

test("UNO: un pin que no existe se rechaza nombrando el rango de verdad", async () => {
  // El UNO no tiene flash SPI en pines, ni strapping, ni solo-entrada: de las cinco
  // reglas del ESP32, la única que sobrevive es "ese pin no existe". Traducir las
  // otras cuatro habría sido inventarle defectos a una placa que no los tiene.
  const d14 = await gen({ componentes: "led:14", placa: "uno" }, "uno-d14")
  assert.ok(!pinesAsignados(d14.html).includes("D14"), "asignó un D14 que no existe")
  assert.match(d14.r, /D0 a D13/, "no dice cuál es el rango real de los digitales")
  const a9 = await gen({ componentes: "potenciometro:9", placa: "uno" }, "uno-a9")
  assert.ok(!pinesAsignados(a9.html).includes("A9"), "asignó una A9 que no existe")
  assert.match(a9.r, /A0 a A5/, "no dice cuál es el rango real de las analógicas")
})

// ── el invariante: si no sé dibujarlo en esa placa, NO lo dibujo ────────────
//
// Éste es el corazón de la tanda. Antes `advertencia` era UN texto y se imprimía
// siempre; con dos placas, el que le tocaba al docente del UNO iba a ser el del
// ESP32 —"usá GPIO34 o GPIO35 (solo-entrada)"— y suena exactamente igual de seguro
// que el correcto. El tool se niega y dice qué le falta. No hay fallback.
//
// MUTACIÓN QUE MATA: en `avisoDe`, devolver `{ texto: aviso.esp32 }` cuando falta
// la clave de la placa pedida.
test("UNO: todo componente que se DIBUJA tiene su propia advertencia; el resto se rechaza", async () => {
  const tipos = await tiposDelTool()
  assert.ok(tipos.length >= 30, "el catálogo que devuelve el tool se quedó corto: " + tipos.join(", "))
  const dibujados = []
  const rechazados = []
  for (const tipo of tipos) {
    const { r, html } = await gen({ componentes: tipo, placa: "uno" }, "uno-inv-" + tipo.replace(/[^a-z0-9]+/gi, "-"))
    if (/^Listo|INCOMPLETO/.test(r)) {
      dibujados.push(tipo)
      const hoja = html.match(AVISO_HOJA)?.[1] ?? ""
      assert.ok(hoja.length > 0, `"${tipo}" se dibujó en UNO sin una sola línea de advertencia`)
      assert.match(html, /<wokwi-arduino-uno/, `"${tipo}" se dibujó, pero con la placa equivocada`)
    } else {
      rechazados.push(tipo)
      // Negarse está bien; negarse sin decir qué falta, no. Y NUNCA puede haber hoja.
      assert.equal(html, "", `"${tipo}" se rechazó en el chat y generó la hoja igual`)
      assert.match(r, /Arduino UNO/, `"${tipo}" se rechazó sin decir de qué placa habla`)
      assert.match(r, /esp32/i, `"${tipo}" se rechazó sin ofrecerle a la docente dónde SÍ lo tiene`)
    }
  }
  // Las tres etapas de esta tanda: 14 (básicos) + 5 (PWM) + 4 (I2C) = 23.
  assert.equal(
    dibujados.length,
    23,
    `cambió la cantidad de componentes portados al UNO (${dibujados.length}). Si portaste otro, subí el número y agregale su advertencia; si se cayó alguno, esto es una regresión.\nDibuja: ${dibujados.join(", ")}\nRechaza: ${rechazados.join(", ")}`,
  )
})

// ── ninguna advertencia de UNO habla de la otra placa ───────────────────────
//
// Cinco de las advertencias de la etapa 1 eran FALSAS en un UNO, no imprecisas:
// el LED decía 220Ω "porque son los 3.3V del ESP32"; el botón, "nunca a 3.3V"; el
// potenciómetro mandaba a "GPIO34 o GPIO35 (solo-entrada)"; el LDR y el higrómetro
// decían que analogRead da 0-4095. Dibujar un UNO con esos textos no es arreglar el
// bug: es cambiarlo de lugar.
//
// Este barrido es la red que impide que vuelvan a entrar de a una.
//
// ── POR QUÉ "3,3 V" YA NO ESTÁ EN LA LISTA DE PROHIBIDAS ───────────────────
//
// Estaba, y era un BUG DEL TEST: prohibía la frase CORRECTA. El UNO TIENE riel
// de 3,3 V — skills/sensores/SKILL.md lo documenta en la columna "En Arduino
// UNO" de la tabla del BMP180 (VCC → 3.3V), y circuito.ts lo cita en el `riel`
// de la placa (`V3: "3.3V"`). El OLED, el MPU6050 y el BMP180 son módulos de
// 3,3 V y este tool los dibuja al riel de 3,3 V en las DOS placas: decirlo en
// la prosa es exactamente lo que hay que hacer.
//
// El costo de tenerlo prohibido no fue teórico. Las advertencias de UNO del
// OLED, el MPU6050 y el BMP180 terminaron escritas como "la alimentación es la
// que muestra la tabla de acá abajo" — un texto redactado para pasar ESTE test,
// no para el aula. Un test que bloquea la verdad es peor que un test decorativo.
//
// Lo que se prohíbe es la jerga que NO APLICA al UNO, que era el objetivo real:
// `divisor` y `VIN` (pines/técnicas del ESP32), `strapping` y `solo-entrada`
// (clases de pin que el UNO no tiene: skills/placas/SKILL.md, "Pines prohibidos:
// ninguno"), `4095` y `ADC2` (el ADC del UNO es de 0 a 1023), `ledc` (el
// periférico de PWM del ESP32) y `GPIO` (el UNO nombra D0-D13 y A0-A5).
//
// Si alguien quiere reponer "3,3 V" acá, que lea primero la columna del BMP180.
test("UNO: ninguna advertencia menciona divisor, VIN, strapping, GPIO ni 4095", async () => {
  const prohibido = /divisor|\bVIN\b|strapping|4095|GPIO|solo[- ]entrada|ADC2|\bledc\b/i
  const tipos = await tiposDelTool()
  const hallazgos = []
  for (const tipo of tipos) {
    const { r, html } = await gen({ componentes: tipo, placa: "uno" }, "uno-jerga-" + tipo.replace(/[^a-z0-9]+/gi, "-"))
    if (!/^Listo|INCOMPLETO/.test(r)) continue // no se dibuja en UNO: no tiene texto de UNO
    // Sólo la PROSA de la hoja. La tabla de conexiones queda afuera a propósito: ahí
    // "3.3V" puede ser el riel de verdad al que va el cable (el OLED, el MPU6050 y el
    // BMP180 son de 3,3 V en las dos placas, y eso el dibujo lo tiene que decir). Lo
    // que no puede pasar es que el TEXTO le explique al docente la placa que no tiene.
    const hoja = (html.match(AVISO_HOJA)?.[1] ?? "").replace(/<[^>]+>/g, " ")
    const m = hoja.match(prohibido)
    if (m) hallazgos.push(`${tipo} → "${m[0]}" en: ${hoja.slice(Math.max(0, m.index - 60), m.index + 90).trim()}`)
  }
  assert.deepEqual(hallazgos, [], "una advertencia de UNO sigue explicando el ESP32")
})

// ── y el POSITIVO: que cada advertencia DIGA algo ───────────────────────────
//
// SE ROMPÍA ASÍ, y lo encontró una prueba de mutación: se podían VACIAR las 23
// advertencias de UNO (`uno: null` en las 17 que son string literal) y la suite
// entera seguía en verde. Con vaciar sólo la del LED alcanzaba: la hoja salía con
// el cartel "💡 Atención:" y NADA atrás, y "sin la resistencia el LED se destruye
// en el primer encendido" desaparecía sin que se enterara nadie.
//
// El motivo es que toda la red de UNO defendía el NEGATIVO (que no entre jerga del
// ESP32) y el CONTEO (que sean 23), nunca el POSITIVO: que el texto exista y sirva.
// Un componente con la advertencia vacía pasaba las dos.
//
// Por qué el piso es 80 y no 10: la advertencia de UNO más corta que hay hoy mide
// 142 caracteres, así que 80 deja aire para una futura más breve y sigue estando
// LEJOS de lo que se pasa con relleno. Y el piso solo no alcanza —80 caracteres de
// lorem lo pasan—, por eso además se exige vocabulario de conexión: un aviso que no
// nombra ni un pin, ni un riel, ni una unidad, no le sirve a nadie con la placa
// en la mano.
const MIN_AVISO = 80
const VOCABULARIO_DE_CONEXION = /\b(D\d|A\d|GND|5\s*V|3[.,]3\s*V|PWM|I2C|SDA|SCL|Ω|pin|pines|analóg|digital|cable)/i

test("UNO: la advertencia de cada componente dibujado DICE algo, no está vacía", async () => {
  const tipos = await tiposDelTool()
  const flacos = []
  for (const tipo of tipos) {
    const { r, html } = await gen({ componentes: tipo, placa: "uno" }, "uno-contenido-" + tipo.replace(/[^a-z0-9]+/gi, "-"))
    if (!/^Listo|INCOMPLETO/.test(r)) continue // no se dibuja en UNO: no le toca advertencia
    const crudo = html.match(AVISO_HOJA)?.[1] ?? ""
    // Se saca el encabezado ("💡 Atención:") y las viñetas: lo que se mide es el
    // TEXTO, no la decoración que el tool pone igual aunque la lista esté vacía.
    const texto = crudo.replace(/<[^>]+>/g, " ").replace(/[💡✋•]/g, " ").replace(/Atención:|¡Probalo con el mouse!/g, " ").replace(/\s+/g, " ").trim()
    if (texto.length < MIN_AVISO) {
      flacos.push(`${tipo} → ${texto.length} caracteres: "${texto}"`)
      continue
    }
    if (!VOCABULARIO_DE_CONEXION.test(texto)) {
      flacos.push(`${tipo} → ${texto.length} caracteres pero no nombra ni un pin ni un riel: "${texto.slice(0, 120)}"`)
    }
  }
  assert.deepEqual(flacos, [], "un componente se dibuja en UNO con una advertencia vacía o de relleno")
})

// ── los módulos de 3,3 V DICEN a qué riel van ──────────────────────────────
//
// MUTACIÓN QUE MATA: volver la advertencia de UNO del OLED, el MPU6050 o el
// BMP180 a "La alimentación es la que muestra la tabla de acá abajo".
//
// SE ROMPÍA ASÍ, y es el caso más feo de toda la tanda: esos tres textos estaban
// redactados para ESQUIVAR el barrido de jerga, que hasta recién prohibía escribir
// "3,3 V" en cualquier prosa de UNO. O sea que un test bloqueaba la frase CORRECTA
// y el código se acomodó al test en vez de al aula: en vez de decir a qué riel va
// el cable rojo, mandaba a mirar una tabla.
//
// El dato existe y es del repo, no inventado: skills/sensores/SKILL.md tiene una
// columna "En Arduino UNO" en la tabla del BMP180 que dice VCC → 3.3V, igual que
// en el ESP32; y circuito.ts declara `V3` como "3,3 V DE VERDAD: el módulo lo pide
// sí o sí, esté en la placa que esté". Los tres van al riel `V3`, que en el UNO se
// rotula "3.3V". Decirlo es la obligación del tool; mandar a mirar la tabla, no.
test("UNO: los módulos de 3,3 V dicen a QUÉ riel va el cable rojo", async () => {
  // Son los tres que el tool cablea a `V3` (ver `pines[].destino` de cada uno).
  const DE_TRES_CON_TRES = ["oled", "mpu6050", "bmp180"]
  const flojos = []
  for (const tipo of DE_TRES_CON_TRES) {
    const { r, html } = await gen({ componentes: tipo, placa: "uno" }, "uno-riel-" + tipo)
    assert.match(r, /^Listo|INCOMPLETO/, `"${tipo}" dejó de dibujarse en UNO: ${r.slice(0, 160)}`)
    const texto = (html.match(AVISO_HOJA)?.[1] ?? "").replace(/<[^>]+>/g, " ")
    // Tiene que NOMBRAR la tensión de alimentación, no mandar a buscarla.
    if (!/3[.,]3\s*V/i.test(texto)) {
      flojos.push(`${tipo} → su advertencia de UNO no dice a qué tensión va la alimentación: "${texto.slice(0, 200)}"`)
      continue
    }
    // Y no puede hacerlo mandando a mirar otra cosa: ésa fue la redacción de evasión.
    if (/la tabla de acá abajo|como dice la tabla/i.test(texto)) {
      flojos.push(`${tipo} → vuelve a mandar a mirar la tabla en vez de decir la tensión: "${texto.slice(0, 200)}"`)
    }
  }
  assert.deepEqual(flojos, [], "un módulo de 3,3 V se dibuja en UNO sin decir a qué riel va el cable rojo")
})

// MUTACIÓN QUE MATA: en `bloqueDeAvisos`, sacar el guard y dejar
// `return cabecera + cuerpo`.
test("sin advertencias no sale el cartel '💡 Atención:' vacío", async () => {
  // Hoy es un estado INALCANZABLE dibujando (los 23 portados traen su advertencia),
  // y por eso se prueba por la FUNCIÓN y no por un circuito: es el camino al que
  // llega la hoja el día que a alguien se le vacía un aviso en un refactor — un
  // camino que esta misma tanda ya vio abrirse. Un cartel de atención sin nada
  // atrás se lee como un error del programa, y se lee justo en el papel que el
  // pibe tiene delante mientras cablea.
  const { bloqueDeAvisos } = ns
  assert.ok(typeof bloqueDeAvisos === "function", "`bloqueDeAvisos` dejó de exportarse y este invariante se quedó sin red")

  // 1. Lista vacía y NO interactivo: no sale absolutamente nada.
  assert.equal(bloqueDeAvisos([], false), "", "salió el encabezado de avisos sin un solo aviso atrás")

  // 2. Lista vacía pero interactivo: "✋ ¡Probalo con el mouse!" SÍ se queda. No
  //    encabeza avisos, es una invitación que se sostiene sola.
  const soloInteractivo = bloqueDeAvisos([], true)
  assert.match(soloInteractivo, /Probalo con el mouse/, "se perdió la invitación del circuito interactivo")
  assert.doesNotMatch(soloInteractivo, /Atención/, "el circuito interactivo salió con el encabezado de avisos")

  // 3. Con avisos, todo sigue igual que siempre.
  const conAvisos = bloqueDeAvisos(["el primero", "el segundo"], false)
  assert.match(conAvisos, /Atención/, "el cartel perdió su encabezado")
  assert.match(conAvisos, /• el primero/, "se perdió un aviso")
  assert.match(conAvisos, /• el segundo/, "se perdió un aviso")

  // 4. Y la hoja de verdad: cuando hay avisos el div está; cuando el bloque sale
  //    vacío, no queda ni el div colgado en el HTML.
  const { html } = await gen({ componentes: "led", placa: "uno" }, "uno-cartel-lleno")
  assert.match(html, /<div class="aviso">/, "el circuito normal perdió el cartel de avisos")
  assert.match(html, /Atención/, "el cartel salió sin su encabezado")
  assert.doesNotMatch(html, /<div class="aviso">\s*<\/div>/, "quedó un div de avisos vacío en la hoja")
})

// ── el fallback a ESP32, por la puerta de atrás ─────────────────────────────
//
// MUTACIÓN QUE MATA: en `avisoDe`, cambiar `porPlaca[placa] ?? null` por
// `porPlaca[placa] ?? porPlaca.esp32`.
//
// El guard de arriba (`!(placa in porPlaca)`) YA estaba probado: mutarlo pone
// rojos 4 tests. La otra mitad del return no la mataba ninguno, y no por descuido:
// hoy NO hay ningún componente escrito con `uno: null`, así que dibujando no se
// recorre ese camino. Pero `uno: null` es una forma que el propio docstring de
// `avisoDe` BENDICE ("la placa está soportada pero no hay nada que advertir"). El
// día que alguien la use, ese `??` imprime el texto del ESP32 en la hoja del UNO
// en silencio — el bug exacto que esta tanda vino a matar, a un carácter de
// distancia. No se puede ejercer por el render, así que se ejerce por la función.
test("`uno: null` NO cae al texto del ESP32: soportada sin aviso ≠ no soportada", () => {
  const { avisoDe } = ns
  assert.ok(typeof avisoDe === "function", "`avisoDe` dejó de exportarse y este invariante se quedó sin red")

  const TEXTO_ESP32 = "TEXTO-EXCLUSIVO-DEL-ESP32-QUE-NO-PUEDE-APARECER-EN-UN-UNO"

  // 1. La placa está soportada pero no hay nada que advertir: {texto: null}, NUNCA
  //    el texto de la otra placa.
  const soportadaSinAviso = avisoDe({ esp32: TEXTO_ESP32, uno: null }, "uno")
  assert.notEqual(soportadaSinAviso, null, "`uno: null` se leyó como 'no soporta UNO': son dos cosas distintas")
  assert.equal(soportadaSinAviso.texto, null, `\`uno: null\` cayó al texto del ESP32: "${soportadaSinAviso.texto}"`)

  // 2. La placa NO está en el objeto: se NIEGA (null), que es otra cosa.
  assert.equal(avisoDe({ esp32: TEXTO_ESP32 }, "uno"), null, "un componente sin clave `uno` dejó de rechazarse")

  // 3. La forma corta (string pelado) equivale a `{esp32: …}` y a ninguna otra placa.
  assert.equal(avisoDe(TEXTO_ESP32, "uno"), null, "la forma corta dejó de ser 'sólo ESP32'")

  // 4. Y lo que SÍ tiene que pasar, para que el test no pase por estar todo roto.
  assert.deepEqual(avisoDe({ esp32: TEXTO_ESP32 }, "esp32"), { texto: TEXTO_ESP32 })
  assert.deepEqual(avisoDe({ esp32: TEXTO_ESP32, uno: "TEXTO-UNO" }, "uno"), { texto: "TEXTO-UNO" })
})

// ── los rótulos de riel: lo que dice el cable en la tabla ───────────────────
//
// MUTACIÓN QUE MATA: en `PLACAS.uno.riel`, poner `V5: "VIN (5V)"`.
//
// Quedaba 523 en verde. El barrido de jerga de más arriba mira SÓLO la prosa y
// excluye a propósito la tabla de conexiones — que es justo donde aterriza `riel`.
//
// Y en un UNO "VIN" no es un sinónimo de 5V: es la entrada SIN REGULAR del jack
// (7-12 V). Un servo, un LCD o un NeoPixel colgados ahí con un adaptador de 9 V se
// queman, y alimentando por USB directamente no anda. El rótulo es lo que el pibe
// busca en la serigrafía de su placa: tiene que decir lo que está impreso.
test("los rótulos de riel de cada placa dicen lo que está serigrafiado en ESA placa", () => {
  const { PLACAS } = ns
  assert.ok(PLACAS, "`PLACAS` dejó de exportarse y este invariante se quedó sin red")

  const uno = PLACAS.uno.riel
  // En el UNO el riel de 5 V se llama "5V" y punto: es lo que dice la serigrafía.
  assert.equal(uno.V5, "5V", "el riel de 5V del UNO dejó de llamarse como está impreso en la placa")
  assert.equal(uno.V3, "3.3V", "el riel de 3,3 V del UNO dejó de llamarse como está impreso en la placa")
  assert.equal(uno.VLOGICA, "5V", "el UNO trabaja a 5V: su riel de lógica es el de 5V")
  // El I2C del UNO son A4/A5, no un GPIO.
  assert.equal(uno.SDA, "A4")
  assert.equal(uno.SCL, "A5")

  // La jerga del ESP32 NO puede aparecer en NINGÚN rótulo del UNO.
  const JERGA_AJENA = /VIN|GPIO/i
  for (const [nombre, rotulo] of Object.entries(uno)) {
    if (rotulo == null) continue
    assert.doesNotMatch(rotulo, JERGA_AJENA, `el riel ${nombre} del UNO se rotula "${rotulo}", que es de la otra placa`)
  }
  // Y el de 5 V en particular no puede rotularse con el de 3,3 V ni al revés.
  assert.doesNotMatch(uno.V5, /3[.,]3/, "el riel de 5V del UNO quedó rotulado como el de 3,3 V")
  assert.notEqual(uno.V5, uno.V3, "los dos rieles del UNO quedaron con el MISMO rótulo: un cable iría a cualquier lado")

  // La contracara en el ESP32: su lógica sigue siendo de 3,3 V, y ahí VIN sí es el
  // nombre correcto del riel de 5 V (es como se llama en esa placa).
  const esp32 = PLACAS.esp32.riel
  assert.match(esp32.VLOGICA, /3[.,]3\s*V/i, "la lógica del ESP32 dejó de ser de 3,3 V")
  assert.equal(esp32.V3, "3.3V")
  assert.match(esp32.V5, /VIN/, "el riel de 5V del ESP32 dejó de nombrar VIN, que es como se llama en esa placa")

  // Ningún rótulo puede quedar vacío: un cable que termina en "" se ve perfecto.
  for (const placa of Object.values(PLACAS)) {
    for (const [nombre, rotulo] of Object.entries(placa.riel)) {
      if (rotulo == null) continue // `null` es "esta placa NO tiene ese riel", y es legítimo
      assert.ok(rotulo.trim().length > 0, `el riel ${nombre} de ${placa.etiqueta} quedó con el rótulo vacío`)
    }
  }
})

// ── un tool no puede sugerir el pin que el otro nunca reparte ───────────────
//
// MUTACIÓN QUE MATA: en `imprimible.ts`, volver el ejemplo del `.describe()` de
// `conexiones` a "LED rojo (ánodo) → GPIO12 con 220Ω".
//
// SE ROMPÍA ASÍ: el ejemplo decía GPIO12. GPIO12 está en `GPIO_STRAPPING` y NO
// está en `POOL_DIGITAL`: el asignador de `circuito.ts` no lo reparte JAMÁS. O sea
// que un tool sugería en el prompt el pin que el otro tiene prohibido — y los
// `.describe()` no son documentación interna, viajan en el schema, o sea en el
// prompt, o sea el modelo los copia al papel que el pibe se lleva a la mesa.
//
// En ESAS MISMAS DOS LÍNEAS el 330→220 sí estaba protegido (test 9 de
// resistencia-led) y sacar el enum de placa también (test 10). Sólo el pin quedó
// al aire, y reponerlo dejaba los 523 en verde.
//
// Los Sets se LEEN de `circuito.ts`, no se copian acá: si mañana cambia el pool,
// este test cambia con él en vez de defender un mapa viejo.
test("ningún .describe() de un tool da como ejemplo un GPIO que el asignador no reparte", () => {
  const { POOL_DIGITAL, GPIO_STRAPPING, GPIO_FLASH, GPIO_SOLO_ENTRADA } = ns
  assert.ok(Array.isArray(POOL_DIGITAL) && POOL_DIGITAL.length, "`POOL_DIGITAL` dejó de exportarse: el test perdió su fuente")
  for (const [nombre, s] of [["GPIO_STRAPPING", GPIO_STRAPPING], ["GPIO_FLASH", GPIO_FLASH], ["GPIO_SOLO_ENTRADA", GPIO_SOLO_ENTRADA]]) {
    assert.ok(s instanceof Set && s.size, `\`${nombre}\` dejó de exportarse: el test perdió su fuente`)
  }
  const reparte = new Set(POOL_DIGITAL)

  // Por qué un pin del pool igual puede estar mal como EJEMPLO: GPIO2 y GPIO15
  // están en `POOL_DIGITAL` pero van ÚLTIMOS y a propósito ("al final, bajo
  // riesgo" dice el comentario del pool, porque son strapping). Un último recurso
  // no es un ejemplo: el ejemplo es lo que el modelo copia primero y siempre.
  const motivo = (g) => {
    if (GPIO_FLASH.has(g)) return `está cableado a la flash SPI del ESP32 (GPIO6 a GPIO11): usarlo cuelga la placa`
    if (GPIO_SOLO_ENTRADA.has(g)) return `es SOLO ENTRADA (34, 35, 36, 39): no puede encender nada`
    if (GPIO_STRAPPING.has(g)) return `es un pin "strapping" y el pool lo reparte último o no lo reparte`
    if (!reparte.has(g)) return `no está en POOL_DIGITAL: el asignador de circuito.ts no lo reparte nunca`
    return null
  }

  const TOOLS = join(REPO, "opencode/tool")
  const hallazgos = []
  for (const archivo of readdirSync(TOOLS).filter((n) => n.endsWith(".ts"))) {
    const crudo = readFileSync(join(TOOLS, archivo), "utf8")
    // Los comentarios quedan AFUERA: el de `imprimible.ts` explica justamente por
    // qué el ejemplo NO dice GPIO12, y nombrarlo para explicarlo tiene que seguir
    // siendo posible. Lo que viaja al prompt es el texto, no el comentario.
    const sinComentarios = crudo
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length))
    // Todo lo que viaja en el schema: los `.describe()` de cada arg y la
    // `description:` del tool. Las dos las lee el modelo igual.
    const textos = [
      ...sinComentarios.matchAll(/\.describe\(\s*(`|")([\s\S]*?)\1\s*\)/g),
      ...sinComentarios.matchAll(/description:\s*(`|")([\s\S]*?)\1\s*,/g),
    ]
    for (const m of textos) {
      for (const g of m[2].matchAll(/GPIO\s*(\d+)/gi)) {
        const por = motivo(+g[1])
        if (por) hallazgos.push(`opencode/tool/${archivo} → el ejemplo dice GPIO${g[1]}, que ${por}`)
      }
    }
  }
  assert.deepEqual(hallazgos, [], "un ejemplo de un .describe() es una ORDEN para el modelo, y va al papel del aula")

  // El test se prueba a sí mismo contra la línea REAL que motivó esto. Si alguien
  // ablanda el filtro de arriba, esto se pone rojo acá y no en producción.
  assert.ok(motivo(12), "el filtro tiene que rechazar GPIO12, que es la línea que estuvo de verdad en imprimible.ts")
  assert.equal(motivo(18), null, "el filtro rechaza GPIO18, que es el pin CORRECTO (el del LED rojo de 01-semaforizacion)")
})

// MUTACIÓN QUE MATA: volver `idPlaca` al ternario de antes
// (`typeof args.placa === "string" && args.placa.trim() ? … : "esp32"`).
test("la VERSIÓN del shield decide si el zócalo existe o no", async () => {
  // SE ROMPÍA ASÍ, y es un agujero que dejé yo: el zócalo de ultrasónico `URF01` es un
  // AGREGADO de la v5.0 — las fuentes lo listan entre lo que "la V5.0 suma sobre la
  // V4.0", junto con el I2C, el Bluetooth, el SD y la alimentación externa. Una v4 NO
  // lo trae.
  //
  // Y el docente real que disparó todo esto escribió, textual, "un shield sensor v4".
  // Mandarlo al URF01 es mandarlo a un conector que su placa no tiene: el mismo error
  // que este tool vino a matar, con otro disfraz.
  const v4 = await gen({ componentes: "ultrasonico, led", placa: "uno con sensor shield v4" }, "zoc-v4")
  assert.match(v4.r, /NO lo trae/i, "con una v4 tiene que decir que ESA versión no trae el zócalo")
  assert.match(v4.r, /v5\.0/, "y nombrar desde qué versión existe, para que el docente lo chequee")
  assert.match(v4.r, /cableado a mano/i, "y decirle qué hacer en su lugar")

  // Con la versión que SÍ lo trae, el aviso es el de siempre y sin peros.
  const v5 = await gen({ componentes: "ultrasonico, led", placa: "uno con sensor shield v5.0" }, "zoc-v5")
  assert.match(v5.r, /URF01/, "con una v5.0 el zócalo se ofrece")
  assert.doesNotMatch(v5.r, /NO lo trae/i, "y no se le advierte de una versión que no es la suya")

  // Sin versión NO se asume: se da el dato CON su versión al lado. El docente tiene el
  // número impreso en la placa; suponer por él es lo que hacía el tool con el ESP32.
  const sinVer = await gen({ componentes: "ultrasonico, led", placa: "uno con sensor shield" }, "zoc-sinver")
  assert.match(sinVer.r, /URF01/, "sin versión se sigue dando el dato, que es útil")
  assert.match(sinVer.r, /v5\.0/, "pero diciendo de qué versión es")
  assert.match(sinVer.r, /impreso en tu placa/i, "y mandándolo a mirar la suya")

  // Las formas en que un docente escribe una versión tienen que caer todas en la misma.
  for (const texto of ["sensor shield v4", "Sensor Shield V4.0", "sensor shield version 4"]) {
    const { r } = await gen({ componentes: "ultrasonico", placa: "uno con " + texto }, "zv-" + texto.replace(/\W+/g, ""))
    assert.match(r, /NO lo trae/i, `"${texto}" tiene que leerse como v4: es como lo escribe un docente`)
  }
})

test("un shield NO es una placa nueva: se resuelve a la de abajo y no rebota", async () => {
  // SE ROMPÍA ASÍ: `placa: "uno con sensor shield"` REBOTABA con el mensaje de placa
  // desconocida. Y el docente acababa de leer en el skill que el shield "no cambia ni
  // un número" — así que el rechazo no tenía ningún sentido para él.
  //
  // Funcionaba sólo si el modelo adivinaba traducir "sensor shield" → "uno". Adivinar
  // no es una garantía: el día que mande la placa tal cual la escribió el docente, el
  // rechazo llega al aula.
  for (const texto of [
    "uno con sensor shield",
    "Arduino UNO + Sensor Shield v5.0",
    "sensor shield",
    "shield",
    "uno con shield",
    "Arduino UNO con IO Expansion Shield DFRobot",
  ]) {
    const { r, html } = await gen({ componentes: "led, servo", placa: texto }, "sh-" + texto.replace(/\W+/g, ""))
    assert.ok(r.startsWith("Listo"), `"${texto}" tendría que generar, no rebotar. Dijo: ${r.slice(0, 110)}`)

    // Qué se dibuja depende de si TENEMOS la cara de ese shield. El Sensor Shield tiene
    // pieza propia (`pb-sensor-shield`) y se dibuja ÉL, que es lo que el docente tiene
    // delante. El DFRobot no la tiene, y ahí se dibuja el UNO pelado con el aviso — no
    // le prestamos la cara del v5.0 "porque son parecidos": eso es inventar hardware.
    // Sólo el Sensor Shield tiene cara dibujada. "shield" a secas es el GENÉRICO — no
    // sabemos cuál es, y darle la cara del v5.0 sería inventar. El DFRobot, igual.
    const conPieza = /sensor\s*shield/i.test(texto)
    if (conPieza) {
      assert.match(html, /<pb-sensor-shield/, `"${texto}" tiene que dibujar el shield, que es lo que el docente ve`)
    } else {
      assert.match(html, /<wokwi-arduino-uno/, `"${texto}": sin pieza propia se dibuja el UNO de abajo`)
    }
    // Lo que NO cambia nunca: los pines son los del UNO, porque el shield no cambia
    // ni un número. Si esto se rompe, el shield dejó de ser "la misma placa con ternas".
    assert.doesNotMatch(html, /<wokwi-esp32-devkit-v1/, `"${texto}" no puede dibujar un ESP32`)
    assert.match(r, /→ D\d+/, `"${texto}" tiene que repartir pines del UNO (D2, D3…), no de otra placa`)
    assert.doesNotMatch(r, /→ GPIO\d+/, `"${texto}" no puede repartir GPIOs: no es un ESP32`)
  }
})

test("la placa que el docente NOMBRA manda sobre el shield", async () => {
  // SE ROMPÍA ASÍ, y lo introduje yo al arreglar lo de arriba: la primera versión
  // resolvía CUALQUIER shield a `uno`, porque el Sensor Shield v5.0 es formato UNO.
  // Con eso, `placa: "ESP32 con sensor shield"` dibujaba un ARDUINO UNO, con pines
  // D2/D3 que en un ESP32 NO EXISTEN.
  //
  // Es el mismo bug que este tool vino a matar, dado vuelta: darle al docente una placa
  // que no es la suya. Se encontró PROBÁNDOLO, no leyéndolo — por eso queda este test.
  for (const texto of ["esp32 con shield", "ESP32 con sensor shield", "esp32 devkit + shield"]) {
    const { html } = await gen({ componentes: "led, servo", placa: texto }, "she-" + texto.replace(/\W+/g, ""))
    assert.match(html, /<wokwi-esp32-devkit-v1/, `"${texto}" nombra el ESP32: ése tiene que dibujar`)
    assert.doesNotMatch(html, /<wokwi-arduino-uno/, `"${texto}" NO puede dibujar un UNO: los pines D2/D3 no existen en un ESP32`)
  }
})

test("con shield se AVISA dónde se pincha de verdad, con un pin de la propia tabla", async () => {
  // SE ROMPÍA ASÍ: aunque el circuito salga bien, el dibujo muestra la placa PELADA y el
  // docente tiene el shield encima. Los pines son los mismos, pero el pibe no mete el
  // cable en el header: lo mete en la terna de tres colores. Un dibujo correcto y a la
  // vez inservible en la mesa de trabajo.
  const { r } = await gen({ componentes: "led, servo", placa: "uno con sensor shield" }, "sh-aviso")
  assert.match(r, /tres vías/i, "el aviso tiene que explicar el conector de tres vías del shield")
  assert.match(r, /\*\*S\*\*/, "y decir cuál de las tres lleva el número: la S de señal")

  // El ejemplo sale del pin REALMENTE repartido, no de `pool[0]`: si sale de la lista y
  // no de la tabla, el docente lee un número que en su hoja no aparece.
  const tabla = r.split("no inventes otros):**")[1] || ""
  const primero = tabla.match(/→ ((?:GPIO|[DA])\d+)/)
  assert.ok(primero, "la tabla de conexiones tiene que traer al menos un pin")
  assert.ok(
    r.includes(`la **S** de la terna ${primero[1]}`),
    `el ejemplo del aviso tiene que usar ${primero[1]}, que es el pin que salió en la tabla`,
  )

  // Y sin shield no se dice nada de ternas: un aviso que sale siempre no es un aviso.
  const limpio = await gen({ componentes: "led, servo", placa: "uno" }, "sh-limpio")
  assert.doesNotMatch(limpio.r, /tres vías/i, "sin shield no hay aviso de ternas")
})

test("si nombra un shield y NINGUNA placa, avisa que asumió el UNO", async () => {
  // SE ROMPÍA ASÍ: "sensor shield" a secas cae a UNO porque ese shield es formato UNO
  // ("no entra en un ESP32", skills/placas). Es la suposición correcta, pero suponer en
  // SILENCIO es lo que hacía el tool cuando dibujaba siempre un ESP32.
  const { r } = await gen({ componentes: "led" }, "sh-solo-1")
  assert.doesNotMatch(r, /asumí/i, "sin shield no hay nada que asumir")

  const asumido = await gen({ componentes: "led", placa: "sensor shield" }, "sh-solo-2")
  assert.match(asumido.r, /asumí el Arduino UNO/i, "tiene que decir que asumió la placa de abajo")
  assert.match(asumido.r, /decímelo/i, "y darle al docente la salida si su controlador es otro")

  const nombrada = await gen({ componentes: "led", placa: "uno con sensor shield" }, "sh-solo-3")
  assert.doesNotMatch(nombrada.r, /asumí/i, "si la nombró, no se asumió nada")
})

// ── el rechazo con shield tiene que ENSEÑAR, no sólo negarse ────────────────
//
// SE ROMPIÓ ASÍ, EN VIVO. Un docente con Arduino UNO + Sensor Shield pidió ultrasónico
// + LED + servo. El tool rebotó bien el HC-SR04 (todavía no está portado al UNO, y eso
// está bien). Pero el rechazo no decía nada más, y el modelo llenó el hueco en el chat:
//
//   "Para agregar el HC-SR04 en tu Sensor Shield: Trig → D4 (por ejemplo),
//    Echo → D5 (por ejemplo)."
//
// Tres cosas mal en dos renglones. (1) "Por ejemplo" es el modelo INVENTANDO pines, y
// lo que el modelo dice en el chat es lo que el pibe cablea, igual que el dibujo.
// (2) D5 es PWM: se come uno de los seis `~` del UNO para un Echo que no los necesita.
// (3) Con Sensor Shield eso NI SIQUIERA ES ASÍ: el shield tiene zócalo propio para el
// ultrasónico (`URF01`, cableado a A0/A1) donde el módulo entra derecho. Mandarlo a un
// par de pines digitales inventados le hace cablear a mano una placa que ya se lo
// resolvía.
//
// La lección no es "el modelo alucinó": es que un hueco en la respuesta del tool NO
// queda vacío. Si el tool se niega y se calla, lo completa el modelo.

/**
 * El dato del zócalo, LEÍDO DEL SKILL. No se copia acá ningún pin a mano.
 *
 * `skills/placas/SKILL.md`, entrada 02, sección "Los otros conectores", con la cita al
 * *Arduino Sensor Shield v5.0 Functional Diagram* del fabricante. El tool REFLEJA esto;
 * si el skill y el tool se separan, este helper es el que se pone rojo.
 */
function zocaloUltrasonicoDelSkill() {
  const skill = readFileSync(join(REPO, "opencode/skills/placas/SKILL.md"), "utf8")

  // Sin cita al fabricante, el dato vuelve a ser la memoria de alguien.
  assert.match(
    skill,
    /arduino_sensor_shield\.pdf/,
    "el skill placas perdió el enlace al diagrama del fabricante: entonces URF01→A0/A1 es una suposición",
  )

  // Sólo la entrada 02. El Bhoot (entrada 06) también dice "trig A0, echo A1" y es OTRA
  // placa: si el barrido lo agarrara, el test pasaría leyendo el dato equivocado.
  const entrada02 = skill.split(/^## /m).find((s) => /^02 ·/.test(s))
  assert.ok(entrada02, "la entrada 02 (UNO + Sensor Shield) desapareció del skill placas")

  const fila = entrada02
    .split("\n")
    .find((l) => l.trimStart().startsWith("|") && /ultras[oó]nico/i.test(l))
  assert.ok(fila, "la entrada 02 tiene que tener la fila del zócalo del ultrasónico en la tabla de conectores")

  // La fila trae dos cosas entre backticks: el rótulo del zócalo y la referencia para
  // encontrarlo en la placa. Las dos son dato del fabricante, y las dos las repite el
  // tool — así que las dos se leen de acá y ninguna se escribe a mano en este test.
  const marcas = [...fila.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  const zocalo = marcas.find((t) => /^[A-Z][A-Z0-9]+$/.test(t))
  assert.ok(zocalo, `no pude leer el nombre del zócalo de la fila del skill: ${fila}`)
  const referencia = marcas.find((t) => t !== zocalo)
  assert.ok(referencia, `la fila de ${zocalo} perdió la referencia de dónde está en la placa: ${fila}`)

  const pines = [...fila.matchAll(/\bA\d\b/g)].map((m) => m[0])
  assert.ok(pines.length >= 2, `la fila del zócalo ${zocalo} tiene que decir a qué pines va: ${fila}`)

  return { zocalo, pines, referencia }
}

test("con shield, el rechazo del ultrasónico manda al ZÓCALO y no deja el hueco", async () => {
  const { zocalo, pines, referencia } = zocaloUltrasonicoDelSkill()

  const { r, html } = await gen(
    { componentes: "ultrasonico, led", placa: "uno con sensor shield" },
    "zoc-rebote",
  )

  // Sigue rebotando: portar el HC-SR04 al UNO es otra etapa. Negarse está BIEN.
  assert.doesNotMatch(r, /^Listo/, "el HC-SR04 todavía no está portado al UNO: tiene que seguir rebotando")
  assert.equal(html, "", "se rechazó en el chat: no puede quedar una hoja generada igual")
  assert.match(r, /HC-SR04/, "el rechazo tiene que decir QUÉ componente es el que falta")

  // Y ahora además enseña. El nombre del zócalo sale del skill, no de este test.
  assert.ok(
    r.includes(zocalo),
    `el rechazo con shield tiene que nombrar el zócalo \`${zocalo}\` tal como lo escribe el skill. Dijo: ${r}`,
  )
  for (const pin of pines) {
    assert.ok(r.includes(pin), `el rechazo tiene que decir que ${zocalo} va a ${pin}. Dijo: ${r}`)
  }
  // Y dónde está en la placa. "URF01" a secas es un rótulo que el docente tiene que ir
  // a buscar con lupa; "pegado a ANALOG IN" es lo que le hace levantar la vista y verlo.
  assert.ok(
    r.includes(referencia),
    `el rechazo tiene que decir dónde está ${zocalo} ("${referencia}", según el skill). Dijo: ${r}`,
  )
})

test("el zócalo se nombra SÓLO para el componente que lo tiene", async () => {
  // SE PODÍA ROMPER ASÍ, y lo encontré probando la mutación: si `avisoDeZocalos` deja de
  // filtrar por tipo y pega la frase para cualquier componente rebotado, un docente que
  // pide un RELÉ con Sensor Shield se lleva "el relé va al zócalo URF01, a A0 y A1".
  // Es el bug original otra vez, y esta vez lo firma el tool en vez del modelo.
  //
  // El relé tampoco está portado al UNO, así que recorre exactamente el mismo camino:
  // es el vecino más cercano del ultrasónico y el que revienta si el filtro se afloja.
  const { zocalo } = zocaloUltrasonicoDelSkill()
  const { r } = await gen({ componentes: "relay, led", placa: "uno con sensor shield" }, "zoc-otro-comp")

  assert.doesNotMatch(r, /^Listo/, "el relé todavía no está portado al UNO: tiene que rebotar")
  assert.ok(!r.includes(zocalo), `el relé no entra en \`${zocalo}\`: ése es el zócalo del ultrasónico. Dijo: ${r}`)
  assert.doesNotMatch(r, /zócalo/i, "sin un zócalo que le corresponda, no hay nada que decir")
})

test("sin shield, el rechazo NO habla de un zócalo que el docente no tiene", async () => {
  // Un aviso que sale siempre no es un aviso. El docente con UNO pelado no tiene ningún
  // `URF01` donde meter el módulo: mandarlo a un conector que no existe en su placa lo
  // confunde MÁS que el rechazo pelado, y es el mismo pecado que este tool vino a matar
  // (texto de otra placa, dicho con la misma seguridad que el correcto).
  const { zocalo } = zocaloUltrasonicoDelSkill()
  const { r } = await gen({ componentes: "ultrasonico, led", placa: "uno" }, "zoc-sin-shield")

  assert.doesNotMatch(r, /^Listo/, "sin shield también rebota: es la misma placa de abajo")
  assert.ok(!r.includes(zocalo), `sin shield no puede aparecer \`${zocalo}\`. Dijo: ${r}`)
  assert.doesNotMatch(r, /zócalo/i, "sin shield no hay zócalo del que hablar")
})

test("shield sin zócalo documentado: se niega, y NO le inventa el URF01", async () => {
  // Del IO Expansion DFRobot V7.1 el skill dice que los pines son los mismos, y NADA de
  // un zócalo de ultrasónico. "Los shields son todos parecidos" es exactamente la forma
  // de razonar que produjo el "D4 por ejemplo": un dato de hardware deducido, que suena
  // igual de seguro que el confirmado. Si no está escrito, no se dice.
  const { zocalo } = zocaloUltrasonicoDelSkill()
  for (const texto of ["uno con IO Expansion Shield DFRobot", "uno con shield"]) {
    const { r } = await gen({ componentes: "ultrasonico", placa: texto }, "zoc-otro-" + texto.replace(/\W+/g, ""))
    assert.doesNotMatch(r, /^Listo/, `"${texto}" tiene que seguir rebotando el HC-SR04`)
    assert.ok(!r.includes(zocalo), `"${texto}" no tiene \`${zocalo}\` documentado: no se lo podemos prometer. Dijo: ${r}`)
  }
})

test("ESP32 + ultrasónico sigue dibujando igual: el rechazo no se derramó", async () => {
  // Contrato de no-regresión. Todo lo de arriba vive en el camino de `motivoNoDibujable`,
  // que en ESP32 devuelve `null` en la primera línea. Si algún día deja de devolverlo,
  // el preset más pedido de la escuela deja de salir y nadie se entera por los otros tests.
  const { zocalo } = zocaloUltrasonicoDelSkill()
  const { r, html } = await gen({ componentes: "ultrasonico, led", placa: "esp32" }, "zoc-esp32")

  assert.match(r, /^Listo/, `ESP32 + ultrasónico tiene que dibujar. Dijo: ${r.slice(0, 160)}`)
  assert.match(html, /<wokwi-hc-sr04/, "el HC-SR04 tiene que estar dibujado en la hoja")
  assert.match(html, /<wokwi-esp32-devkit-v1/, "y sobre el ESP32")
  assert.ok(!r.includes(zocalo), `en ESP32 no hay \`${zocalo}\`: ese shield es formato UNO`)
})

// MUTACIÓN QUE MATA: cambiar `pines: ["A0", "A1"]` por un par de pines digitales
// (`["D4", "D5"]`) en `ZOCALOS_SENSOR_SHIELD` — que es, literalmente, el bug que se vio
// en vivo escrito adentro del tool.
test("INVARIANTE: con shield, ningún texto del tool manda el ultrasónico a un pin digital", async () => {
  const { pines } = zocaloUltrasonicoDelSkill()
  const permitidos = new Set(pines) // A0 y A1, y NADA más

  // Todo pin que el docente podría llegar a cablear leyendo el mensaje: D0-D13, A0-A5,
  // GPIOxx. No se prohíbe la PROSA ("no busques un par de pines digitales sueltos" es
  // justo lo que hay que decir): se prohíbe que aparezca un NÚMERO de pin que no sea el
  // del zócalo. Un número es lo que el pibe mete en el agujero.
  const TOKEN_DE_PIN = /\bGPIO\s?\d{1,2}\b|\b[DA]\s?\d{1,2}\b/g

  const placas = [
    "uno con sensor shield",
    "Arduino UNO + Sensor Shield v5.0",
    "sensor shield",
    "UNO con Sensor Shield v4",
  ]
  const listas = ["ultrasonico", "ultrasonico, led", "led, ultrasonico, servo", "ultrasonico, buzzer"]

  const hallazgos = []
  let vistos = 0
  for (const placa of placas) {
    for (const componentes of listas) {
      const id = ("zoc-inv-" + placa + "-" + componentes).replace(/\W+/g, "-")
      const { r } = await gen({ componentes, placa }, id)
      assert.doesNotMatch(r, /^Listo/, `"${placa}" + "${componentes}" tendría que rebotar el HC-SR04`)
      for (const m of r.match(TOKEN_DE_PIN) ?? []) {
        if (permitidos.has(m.replace(/\s/g, ""))) vistos++
        else hallazgos.push(`${placa} / ${componentes} → "${m}" en: ${r}`)
      }
    }
  }
  // EL BARRIDO TIENE QUE ESTAR BARRIENDO ALGO. Un invariante escrito en negativo pasa
  // en verde con la entrada vacía: si el mensaje se quedara sin un solo token de pin
  // —o si `TOKEN_DE_PIN` dejara de casar— `hallazgos` sigue vacío y este test "pasa"
  // sin haber mirado nada. Ésa es justo la forma de test decorativo que estamos
  // sacando del repo esta semana.
  assert.ok(
    vistos >= placas.length * listas.length * permitidos.size,
    `el barrido no encontró los pines del zócalo en cada mensaje (vio ${vistos}): o el mensaje dejó de nombrarlos, o la regex dejó de casar y este test no está probando nada`,
  )
  assert.deepEqual(
    hallazgos,
    [],
    `un mensaje con shield nombra un pin que NO es el del zócalo (${[...permitidos].join("/")}). Eso es lo que el pibe cablea.`,
  )
})

test("el tool le dice al modelo que mande al zócalo en vez de improvisar pines", async () => {
  // El punto 2 del bug: el tool no puede dejar solo al modelo. El `description` y el
  // `.describe()` del arg `placa` son lo único que el modelo lee ANTES de contestar.
  //
  // El `.describe()` no se puede leer desde el módulo cargado (el mock del plugin
  // devuelve un Proxy encadenado, no el string), así que se lee del FUENTE. Feo, pero
  // es la única forma de que este contrato tenga red.
  const fuente = readFileSync(join(REPO, "opencode/tool/circuito.ts"), "utf8")
  const describePlaca = fuente.match(/\.describe\("Qué placa se dibuja:[\s\S]*?"\),/)?.[0]
  assert.ok(describePlaca, "cambió el `.describe()` del arg `placa`: este test se quedó sin nada que mirar")

  for (const [nombre, texto] of [["description", mod.description], [".describe() de placa", describePlaca]]) {
    assert.match(texto, /zócalo/i, `el ${nombre} no le nombra el zócalo al modelo`)
    assert.match(
      texto,
      /invent|improvis/i,
      `el ${nombre} tiene que decirle explícitamente que NO invente pines cuando el tool rebota`,
    )
  }
  assert.match(mod.description, /URF01/, "el description tiene que nombrar el zócalo concreto del Sensor Shield")
})

test("una `placa` que no es string se RECHAZA, no cae al ESP32 en silencio", async () => {
  // El comentario del código dice que `execute` valida "porque un modelo puede
  // mandar cualquier cosa igual" — y para los no-strings no lo hacía: un 123, un
  // {} o un ["uno"] caían al default y salía una hoja de ESP32 impecable. El modo
  // silencioso es el peor: el docente no tiene con qué darse cuenta.
  for (const basura of [123, {}, ["uno"], true]) {
    const { r, html } = await gen({ componentes: "led", placa: basura }, "placa-basura-" + JSON.stringify(basura).replace(/[^a-z0-9]+/gi, "-"))
    assert.doesNotMatch(r, /^Listo/, `placa=${JSON.stringify(basura)} dibujó igual en vez de rechazar`)
    assert.equal(html, "", `placa=${JSON.stringify(basura)} dijo que no y generó la hoja igual`)
    assert.match(r, /No sé DIBUJAR/, `placa=${JSON.stringify(basura)} no explicó por qué no dibuja: ${r.slice(0, 120)}`)
    assert.doesNotMatch(html, /wokwi-esp32/, `placa=${JSON.stringify(basura)} cayó al ESP32`)
  }

  // Y lo que NO cambia: no venir sigue siendo el default, y el string vacío también
  // (es "no me la dijeron", no "me la dijeron mal").
  for (const ausente of [undefined, null, "", "   "]) {
    const { r } = await gen({ componentes: "led", placa: ausente }, "placa-ausente-" + String(ausente).trim().length + String(ausente))
    assert.match(r, /^Listo/, `placa=${JSON.stringify(ausente)} dejó de caer al default de ESP32: ${r.slice(0, 120)}`)
  }
})

// MUTACIÓN QUE MATA: volver `avisar` a `avisos.push(texto); notas.push(texto)`.
test("el chat no repite el mismo ⚠️ que la hoja muestra una sola vez", async () => {
  // La hoja deduplica sola (`advertencias` es un Set); el chat no, porque `notas`
  // es un array. Con un componente que agota el MISMO pool dos veces, la respuesta
  // repetía la línea mientras la hoja la mostraba una vez. Dos canales que cuentan
  // lo mismo tienen que contarlo igual.
  // Los tres casos MEDIDOS contra el código de antes del fix: cada uno repetía.
  // El primero es el que encontró la auditoría; los otros dos agotan el otro pool
  // y la otra placa, para que el test no dependa de un solo camino.
  const CASOS = [
    { componentes: "joystick, joystick, joystick, lcd", placa: "uno" },
    { componentes: "teclado, teclado, led, led", placa: "uno" },
    { componentes: "joystick, joystick, joystick, joystick", placa: undefined },
  ]
  for (const [i, caso] of CASOS.entries()) {
    const { r } = await gen(caso, "dup-avisos-" + i)
    const lineas = r.split("\n").filter((l) => l.startsWith("⚠️")).map((l) => l.trim())
    assert.ok(lineas.length > 0, `"${caso.componentes}" tenía que generar al menos un ⚠️ en el chat: ` + r.slice(-300))
    assert.deepEqual(
      lineas,
      [...new Set(lineas)],
      `el chat repitió un ⚠️ idéntico en "${caso.componentes}":\n` + lineas.join("\n"),
    )
  }
})

test("los avisos de potencia nombran la placa con su artículo", async () => {
  // Se había perdido en el port: "El ESP32 manda la señal" quedó "ESP32 DevKit
  // manda la señal". Es la frase que la docente lee en voz alta en el aula.
  const { r } = await gen({ componentes: "higrometro, bomba" }, "articulo-placa")
  if (!/manda la señal/.test(r)) return // sin inyección de mando no hay frase que revisar
  assert.match(r, /El (ESP32 DevKit|Arduino UNO) manda la señal/, "la placa quedó sin artículo: " + r.match(/\S+ manda la señal/)?.[0])
})

test("UNO: la resistencia del LED es 220Ω y se dibuja en serie, igual que en ESP32", async () => {
  // Decisión del dueño del producto: 220Ω en las DOS placas (ficha 03-led: "En 5 V:
  // 220 ohm — es el valor de los kits"). El valor sale de la placa, no del texto del
  // rol, así que si mañana una placa pide otro, cambia en un solo lugar.
  for (const c of ["led", "rgb-led", "7segmentos"]) {
    const { html } = await gen({ componentes: c, placa: "uno" }, "uno-ohm-" + c)
    assert.match(html, /220\s*Ω/, `"${c}" no dice cuál es la resistencia en serie en UNO`)
  }
  const { html } = await gen({ componentes: "led", placa: "uno" }, "uno-ohm-serie")
  assert.match(html, /class="res"[^>]*>220Ω</, "la resistencia no quedó dibujada en serie sobre el cable")
})

// ── los presets son de ESP32, y pedirlos con otra placa se contradice ──────
test("un preset -esp32 con placa=uno se rechaza diciendo QUÉ pedir en su lugar", async () => {
  // No se renombran ni se traducen: "led-esp32" con placa="uno" no es un pedido
  // ambiguo que se pueda resolver eligiendo uno de los dos, es un pedido que se
  // contradice a sí mismo. Y la lista que ofrece tiene que poder ARMARSE: una
  // sugerencia que vuelve a rebotar es la peor forma de decir que no.
  const { r, html } = await gen({ circuito: "led-esp32", placa: "uno" }, "preset-uno")
  assert.doesNotMatch(r, /^Listo/, "armó un preset de ESP32 rotulado como UNO")
  assert.equal(html, "", "dijo que no y generó la hoja igual")
  const sugerida = r.match(/componentes="([^"]+)"/)?.[1]
  assert.ok(sugerida, "no ofrece ninguna lista para pedirlo en su placa: " + r.slice(0, 200))
  const r2 = await mod.execute(
    { componentes: sugerida, placa: "uno", nombre_archivo: "preset-uno-equivalente" },
    { directory: OUTDIR },
  )
  assert.ok(r2.startsWith("Listo"), `la lista que sugiere tampoco se arma: "${sugerida}" → ${r2.slice(0, 140)}`)
})

test("un preset cuyo equivalente NO se puede armar en UNO no manda a un callejón", async () => {
  // "estacion-meteo" es dht22 + lcd, y el DHT22 todavía no está portado. Ofrecerle
  // "dht22, lcd" sería mandarla a un pedido que va a rebotar por otro motivo.
  const { r } = await gen({ circuito: "estacion-meteo", placa: "uno" }, "preset-meteo-uno")
  assert.doesNotMatch(r, /^Listo/, "armó un preset de ESP32 rotulado como UNO")
  assert.doesNotMatch(r, /pedímelo con el armador libre/, "ofreció una lista que después va a rechazar")
  assert.match(r, /faltan portar|no lo puedo armar/i, "no explica por qué tampoco puede ofrecer el equivalente")
})

test("los presets siguen andando en ESP32, que es para lo que están", async () => {
  for (const p of ["led-esp32", "semaforo", "estacion-meteo"]) {
    const { r, html } = await gen({ circuito: p, placa: "esp32" }, "preset-esp32-" + p)
    assert.ok(r.startsWith("Listo"), `el preset "${p}" dejó de andar en ESP32: ${r.slice(0, 120)}`)
    assert.match(html, /<wokwi-esp32-devkit-v1/, `el preset "${p}" dejó de dibujar el ESP32`)
  }
})

test("el explicador de protoboard no depende de la placa: no dibuja ninguna", async () => {
  // No es un circuito con pines, es la placa de pruebas por dentro. Rechazarlo por
  // `placa` sería negarle a la docente del UNO una explicación que le sirve igual.
  for (const placa of ["esp32", "uno"]) {
    const { r, html } = await gen({ circuito: "protoboard", placa }, "proto-" + placa)
    assert.ok(r.startsWith("Listo"), `el explicador de protoboard se rompió con placa=${placa}: ${r.slice(0, 120)}`)
    assert.doesNotMatch(html, /<wokwi-arduino-uno|<wokwi-esp32-devkit-v1/, "el explicador empezó a dibujar una placa")
  }
})

// ── el mando de potencia habla de la placa que hay ─────────────────────────
test("UNO: el driver inyectado explica el peligro sin inventar la corriente del ESP32", async () => {
  // El "el GPIO entrega 12 mA" es un dato del ESP32. Traducirlo a otra placa
  // poniéndole otro número sería inventar: un dato preciso y falso es peor que uno
  // general y cierto, porque se copia al pizarrón.
  const { r, html } = await gen({ componentes: "motor", placa: "uno" }, "uno-motor-driver")
  assert.ok(piezasDe(html).includes("pb-driver"), "el motor DC salió sin driver en UNO")
  assert.match(r, /agregu[ée]/i, "agregó el driver sin contarlo")
  assert.match(r, /Arduino UNO/, "el aviso no nombra la placa del docente")
  assert.doesNotMatch(r, /ESP32/, "le explicó el peligro hablando de otra placa")
  assert.doesNotMatch(r, /12\s*mA/, "le inventó al UNO la corriente de pin del ESP32")
  // y en ESP32 la cifra REAL se conserva: el arreglo no puede borrar el dato bueno
  const esp = await gen({ componentes: "motor" }, "esp-motor-driver")
  assert.match(esp.r, /12\s*mA/, "se perdió el dato de los 12 mA del GPIO del ESP32")
})

// ── la columna de la placa: el defecto que NO se ve en el HTML ──────────────
//
// `transform:scale()` no cambia la caja de layout, y ahí estaba la trampa. El ESP32
// mide 106,6 px naturales y el `scale(1.25)` lo PINTA a 133, pero sigue reservando
// 106,6: por eso entraba con aire en la columna de 230 px del CSS. El UNO reserva
// 274,3 px de verdad (medido en Chrome sobre el bundle real).
//
// Lo que veía la docente si la columna se quedaba en 230: la placa montada 22 px
// ENCIMA de la columna de conexiones, pisándole los nombres de los pines. Y como
// `.hoja` tiene overflow:hidden, no se ve nada salirse — se ve un dibujo que parece
// válido con el texto tapado. El HTML es correcto, el archivo abre, el test de
// piezas pasa: no hay forma de cazarlo salvo mirando este número.
//
// MUTACIÓN QUE MATA: volver el grid-template-columns inline al literal "230px 1fr".
test("cada placa se dibuja con el ancho de columna que su pieza necesita", async () => {
  const anchoDe = (html) => +(html.match(/class="circuito-libre"[^>]*grid-template-columns:(\d+)px/)?.[1] ?? 0)

  const esp = await gen({ componentes: "led" }, "ancho-esp32")
  const uno = await gen({ componentes: "led", placa: "uno" }, "ancho-uno")
  assert.equal(anchoDe(esp.html), 230, "el ESP32 dejó de reservar su columna de 230px")
  assert.equal(anchoDe(uno.html), 290, "el UNO no reserva los 290px que necesita su pieza (274,3px + aire)")

  // Y la escala: el ESP32 se pinta a 1.25 desde siempre; el UNO ya entra a 1.0 y
  // achicarlo sería dejarle la serigrafía ilegible (3,0 px/mm contra 4,7 del ESP32).
  assert.match(esp.html, /<wokwi-esp32-devkit-v1 style="transform:scale\(1\.25\)/, "cambió la escala del ESP32")
  assert.match(uno.html, /<wokwi-arduino-uno style="transform:scale\(1\)/, "cambió la escala del UNO")
})

// ════════════════════════════════════════════════════════════════════════════
// EL MAPEO A LOS NOMBRES DE WOKWI
// ════════════════════════════════════════════════════════════════════════════
//
// Por qué existe todo este bloque: hoy los cables salen de una barra gris al
// costado de la placa. El dibujo NO le dice al pibe dónde pinchar. La pieza de
// Wokwi publica `el.pinInfo` con la coordenada de cada agujero del header, así
// que para anclar el cable al pin de verdad falta UNA cosa: el nombre con el que
// preguntarle. Y los nombres no coinciden con los nuestros (GPIO13 → `D13`,
// D2 → `"2"`, GND → no existe).
//
// Esta tanda no dibuja nada. Construye el mapeo. Y si el mapeo está mal, el
// cable va al pin equivocado — que es PEOR que la barra gris de hoy, porque se
// ve perfecto.
//
// ── DE DÓNDE SALEN ESTOS DATOS, Y CÓMO SE REGENERAN ─────────────────────────
//
// NO están copiados a mano. `pinesWokwi()` los vuelve a extraer del bundle REAL
// del repo (`opencode/tecniabot-web/wokwi-bundle.js`) en cada corrida, parseando
// el literal `pinInfo` que cada pieza lleva adentro.
//
// Y es a propósito que sea así. Un test que compara el mapeo contra una COPIA
// del mapeo no prueba nada: los dos lados se editan juntos y siempre coinciden.
// La fuente tiene que ser EXTERNA. Con esto, el día que alguien actualice el
// bundle y Wokwi haya renombrado un pin, se pone rojo acá — que es el único
// lugar barato donde enterarse.
//
// El volcado en prosa vive en `docs/wokwi-pinout-dump.md` (mismo dato, leído en
// Chrome instanciando cada elemento: `pinInfo` es un getter de INSTANCIA). Si
// alguna vez hay que regenerarlo a mano, está explicado al final de ese archivo.
//
// Las coordenadas SÓLO se usan acá, para verificar cuál masa es la más cercana.
// En `circuito.ts` no hay ni un x ni un y: el navegador se las pregunta a la
// pieza en vivo.

const BUNDLE = join(REPO, "opencode/tecniabot-web/wokwi-bundle.js")
const EXTRA = join(REPO, "opencode/tecniabot-web/componentes-extra.js")

// ── POR QUÉ EL EXTRACTOR TUVO QUE CAMBIAR ───────────────────────────────────
//
// La primera versión servía para las DOS PLACAS y para nada más. Medido: el UNO
// daba sus 31 pines, pero `wokwi-lcd1602` devolvía 4 (tiene 16), `wokwi-servo`
// rebotaba contra la guarda de `>= 25`, y `wokwi-7segment` y `wokwi-led` tiraban
// `t is not defined`. Con el mapeo de piezas encima, un extractor que sólo sabe
// de placas no alcanza: el 90% de los cables mal dibujados son de la otra punta.
//
// Las tres causas, y qué se hizo con cada una:
//
// 1. ANCLAJE. Antes: `src.lastIndexOf("pinInfo", iTag)`, o sea buscar hacia atrás
//    desde el tag y agarrar el `pinInfo` que aparezca — que puede ser el de OTRA
//    pieza. Ahora el bundle se lee por donde es uniforme: toda pieza se registra
//    como `IDENT=dec([d("tag")],IDENT)`. De ahí sale el nombre minificado de la
//    clase (el 2º argumento, que aguanta la cadena `y0=dt=W0([d("…")],y0)` del
//    pushbutton), se busca hacia atrás su `IDENT=class`, y la ventana entre las
//    dos ACOTA el `pinInfo` a esa clase. No hay forma de agarrar el de al lado.
//
// 2. EVALUACIÓN. Antes se sliceaba el literal `[...]` y se lo evaluaba suelto.
//    Eso rompe de dos maneras distintas, y las dos están en el bundle de hoy:
//    el LED arma sus coordenadas con variables locales (`let t=this.flip?15:25`)
//    → `t is not defined`; y el LCD tiene DOS listas (`return this.pins==="i2c"
//    ? [4 pines] : [16 pines]`) → el slice agarraba la PRIMERA, que es la que el
//    tool no usa. Ahora se corre el CUERPO entero del getter con un `this`.
//
// 3. HELPERS. Antes los seis (`x, z, u, C, v, b`) estaban escritos a mano acá.
//    Ahora se los busca POR SU CUERPO (`=>({type:"analog",channel:`) y se exige
//    que el bundle los defina UNA sola vez. El día que el minificador los
//    renombre, esto los sigue encontrando en vez de tirar `t is not defined`.
//
// LO QUE NO CAMBIÓ ES QUE FALLA CERRADO, que era lo bueno del diseño viejo. Ante
// la duda hay excepción con motivo, nunca una lista plausible: identificador
// libre que el bundle no define (o define dos veces) → excepción; campo que el
// constructor no dejó puesto → excepción (y NO `undefined`, que elegiría una
// rama del getter por un hueco); lista que no sale array → excepción.
//
// La guarda de `>= 25` se fue porque estaba calibrada para placas y rebotaba a
// los 34 componentes. La red que la reemplaza es más fuerte y está más abajo:
// VERDAD_NAVEGADOR fija los nombres EXACTOS de las 36 piezas. Con eso, un
// extractor vacío o con basura no pasa; con `>= 25` un UNO de 26 pines inventados
// pasaba.

function bloqueBalanceado(s, desde) {
  const abre = s[desde], cierra = abre === "{" ? "}" : "]"
  if (abre !== "{" && abre !== "[") return null
  let prof = 0, str = null
  for (let i = desde; i < s.length; i++) {
    const c = s[i]
    if (str) { if (c === "\\") i++; else if (c === str) str = null; continue }
    if (c === '"' || c === "'" || c === "`") { str = c; continue }
    if (c === abre) prof++
    else if (c === cierra && --prof === 0) return s.slice(desde, i + 1)
  }
  return null
}

// Corta una expresión-coma por las comas de NIVEL 0 (las que separan sentencias
// en un constructor minificado), sin romper strings ni paréntesis anidados.
function porComas(s) {
  const out = []
  let prof = 0, str = null, ini = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (str) { if (c === "\\") i++; else if (c === str) str = null; continue }
    if (c === '"' || c === "'" || c === "`") { str = c; continue }
    if ("([{".includes(c)) prof++
    else if (")]}".includes(c)) prof--
    else if (c === "," && prof === 0) { out.push(s.slice(ini, i)); ini = i + 1 }
  }
  out.push(s.slice(ini))
  return out.filter((x) => x.trim())
}

let _bundle = null
const bundleSrc = () => (_bundle ??= readFileSync(BUNDLE, "utf8"))

// Un nombre que el bundle tiene que definir EXACTAMENTE una vez. Cero o dos es
// excepción y no "elijo el primero": elegir el primero es justo la clase de
// suposición que después se dibuja prolija y apunta mal.
function nombreUnico(re, que) {
  const hits = new Set()
  let m
  while ((m = re.exec(bundleSrc()))) hits.add(m[1])
  assert.equal(hits.size, 1, `el bundle define ${hits.size} veces ${que} (${[...hits]}): el extractor no puede elegir`)
  return [...hits][0]
}

let _fabricas = null
function fabricasDeSenales() {
  if (_fabricas) return _fabricas
  const f = (re, fn) => [nombreUnico(re, re.source), fn]
  _fabricas = Object.fromEntries([
    f(/([A-Za-z_$][\w$]*)=[\w$(),= ]*=>\(\{type:"analog",channel:/g, (l) => ({ type: "analog", channel: l })),
    f(/([A-Za-z_$][\w$]*)=[\w$(),= ]*=>\(\{type:"i2c",signal:/g, (l, t = 0) => ({ type: "i2c", signal: l, bus: t })),
    f(/([A-Za-z_$][\w$]*)=[\w$(),= ]*=>\(\{type:"spi",signal:/g, (l, t = 0) => ({ type: "spi", signal: l, bus: t })),
    f(/([A-Za-z_$][\w$]*)=[\w$(),= ]*=>\(\{type:"usart",signal:/g, (l, t = 0) => ({ type: "usart", signal: l, bus: t })),
    f(/([A-Za-z_$][\w$]*)=[\w$(),= ]*=>\(\{type:"power",signal:"GND"\}\)/g, () => ({ type: "power", signal: "GND" })),
    f(/([A-Za-z_$][\w$]*)=[\w$(),= ]*=>\(\{type:"power",signal:"VCC",voltage:/g, (l) => ({ type: "power", signal: "VCC", voltage: l })),
  ])
  return _fabricas
}

// Una constante de módulo del bundle (`yt=23`, el NEMA del paso a paso). Misma
// regla: definición única o excepción.
function constanteDelBundle(nombre) {
  const re = new RegExp(`[^\\w$.]${nombre.replace(/\$/g, "\\$")}\\s*=\\s*(-?\\d+(?:\\.\\d+)?|"[^"]*"|'[^']*')\\s*[,;)]`, "g")
  const hits = new Set()
  let m
  while ((m = re.exec(bundleSrc()))) hits.add(m[1])
  assert.equal(hits.size, 1, `\`${nombre}\` queda libre en el cuerpo y el bundle lo define ${hits.size} veces: el extractor no lo adivina`)
  return JSON.parse([...hits][0].replace(/^'(.*)'$/, '"$1"'))
}

// Corre un pedazo de cuerpo del bundle. El `with` engancha SÓLO los helpers y las
// constantes del bundle; todo lo que sea un global de verdad (Math, Uint8Array)
// pasa de largo al global real, y lo que no es ninguna de las dos cosas explota.
function correCuerpo(body, self) {
  const h = fabricasDeSenales()
  const scope = new Proxy(h, {
    has: (t, k) => typeof k === "string" && (k in t || !(k in globalThis)),
    get: (t, k) => (typeof k !== "string" ? undefined : k in t ? t[k] : constanteDelBundle(k)),
  })
  return new Function("__s", `with(__s){ return (function(){ ${body} }); }`)(scope).call(self)
}

// El `this` con el que se corre el getter: los campos que pone el constructor y
// los getters hermanos que el cuerpo pueda leer (`this.pinPositions` del 7
// segmentos, `this.panelHeight` del LCD).
function esteDeLaClase(ventana, tag) {
  const campos = {}
  const rg = /(^|[};,)])get ([A-Za-z_$][\w$]*)\(\)\s*\{/g
  let m
  while ((m = rg.exec(ventana))) {
    const nom = m[2]
    if (nom === "styles") continue
    const b = bloqueBalanceado(ventana, ventana.indexOf("{", m.index + m[0].length - 1))
    if (!b) continue
    Object.defineProperty(campos, nom, { configurable: true, get: () => correCuerpo(b.slice(1, -1), self) })
  }
  // FALLA CERRADO: leer un campo que el constructor no dejó puesto NO devuelve
  // `undefined`, lanza. Si devolviera undefined, el LCD elegiría entre su lista
  // de 16 y la de 4 según un hueco, y saldría una lista perfectamente plausible.
  const self = new Proxy(campos, {
    has: (t, k) => k in t,
    set: (t, k, v) => ((t[k] = v), true),
    get(t, k) {
      if (typeof k === "symbol" || k in t) return t[k]
      throw new Error(`el pinInfo de ${tag} lee this.${k} y el constructor del bundle no lo dejó puesto: el extractor no lo adivina`)
    },
  })
  const ic = ventana.indexOf("constructor()")
  if (ic >= 0) {
    const b = bloqueBalanceado(ventana, ventana.indexOf("{", ic + 13))
    // SENTENCIA POR SENTENCIA, y no el constructor entero. Los constructores
    // minificados son una expresión-coma, y hay tres piezas donde UNA sentencia
    // irrelevante para los pines explota: `this.font=st` (LCD, `st` es una tabla
    // de otro chunk), `dt.pushbuttonCounter++` (botón) y un `new ImageData`
    // (OLED). Corriendo el bloque entero, esa sentencia se llevaba puestas TODAS
    // las de atrás — y en el LCD la de atrás era `this.pins="full"`, que es
    // justo el campo que elige entre 16 pines y 4. Lo que no se pudo correr queda
    // SIN PONER, y leerlo explota arriba.
    if (b) for (const s of porComas(b.slice(1, -1).replace(/super\([^)]*\)\s*,?/, ""))) {
      try { correCuerpo(s, self) } catch { /* sentencia ajena a los pines */ }
    }
  }
  return self
}

function pinesDelBundle(tag) {
  const src = bundleSrc()
  const reg = new RegExp(`[A-Za-z_$][\\w$]*\\(\\s*\\[\\s*[A-Za-z_$][\\w$]*\\("${tag}"\\)\\s*\\]\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\)`)
  const m = reg.exec(src)
  assert.ok(m, `la pieza ${tag} ya no se registra en el bundle`)
  const id = m[1]
  const decl = new RegExp(`[^\\w$]${id.replace(/\$/g, "\\$")}\\s*=\\s*class\\b`, "g")
  let d, ini = -1
  while ((d = decl.exec(src)) && d.index < m.index) ini = d.index
  assert.ok(ini >= 0, `no se encontró la clase \`${id}\` de ${tag} en el bundle`)
  return esteDeLaClase(src.slice(ini, m.index), tag).pinInfo
}

// Las piezas NUESTRAS no se parsean: se EJECUTA `componentes-extra.js` con un
// shim de dos líneas y se le pregunta a la clase, que es lo mismo que hace el
// navegador. Un parser sobre un archivo que podemos correr sería inventar riesgo.
let _extra = null
function piezasExtra() {
  if (_extra) return _extra
  const reg = new Map()
  new Function("HTMLElement", "customElements", readFileSync(EXTRA, "utf8"))(
    class {},
    { get: (n) => reg.get(n), define: (n, C) => reg.set(n, C) },
  )
  _extra = reg
  return _extra
}

/**
 * El `pinInfo` de CUALQUIERA de las 36 piezas que el tool dibuja, sin navegador.
 *
 * Devuelve `{ pines, motivo }`: `motivo` es el `sinPinesDibujados` que la pieza
 * declara cuando no tiene los conectores dibujados — o sea que "vacío" acá es un
 * estado DECLARADO por la pieza y no un extractor roto.
 */
function pinesDePieza(tag) {
  let pines, motivo = null
  if (tag.startsWith("pb-")) {
    const C = piezasExtra().get(tag)
    assert.ok(C, `la pieza ${tag} no se registra en componentes-extra.js`)
    pines = Object.create(C.prototype).pinInfo
    motivo = C.sinPinesDibujados ?? null
  } else {
    pines = pinesDelBundle(tag)
  }
  assert.ok(Array.isArray(pines), `el pinInfo de ${tag} no salió una lista`)
  for (const p of pines) {
    assert.equal(typeof p.name, "string", `un pin de ${tag} salió sin nombre`)
    assert.ok(p.name.length > 0, `un pin de ${tag} salió con el nombre vacío`)
    assert.ok(Number.isFinite(p.x), `el pin ${p.name} de ${tag} salió con x = ${p.x}`)
    assert.ok(Number.isFinite(p.y), `el pin ${p.name} de ${tag} salió con y = ${p.y}`)
  }
  return { pines, motivo }
}

const nombresDePieza = (tag) => pinesDePieza(tag).pines.map((p) => p.name)

const WOKWI = {
  esp32: () => pinesDePieza("wokwi-esp32-devkit-v1").pines,
  uno: () => pinesDePieza("wokwi-arduino-uno").pines,
}
const tieneSenal = (p, tipo, senal) =>
  (p.signals ?? []).some((s) => s.type === tipo && (senal === undefined || s.signal === senal))

// ── el extractor, antes que nada ────────────────────────────────────────────
//
// MUTACIÓN QUE MATA: en `pinesWokwi`, devolver `[]` en vez de `lista`.
//
// Sin este test esa mutación deja TODO el bloque en verde: los barridos de abajo
// recorren listas vacías y no fallan nunca. Es literalmente el bug de los siete
// tests que pasaban sin probar nada. Así que el parser se ancla a mano.
test("wokwi: el extractor lee el bundle de verdad, y no una lista vacía", () => {
  const uno = WOKWI.uno()
  const esp = WOKWI.esp32()
  assert.equal(uno.length, 31, "el UNO dejó de tener 31 pines: cambió el bundle, hay que revisar el mapeo entero")
  assert.equal(esp.length, 30, "el ESP32 dejó de tener 30 pines: cambió el bundle, hay que revisar el mapeo entero")

  // Anclas concretas: los tres casos donde el nombre NO es el nuestro.
  const porNombre = (l, n) => l.find((p) => p.name === n)
  assert.ok(porNombre(uno, "2"), "el UNO dejó de llamar `2` a su pin digital 2")
  assert.ok(!porNombre(uno, "D2"), "el UNO ahora TIENE un pin `D2`: el mapeo del número pelado quedó viejo")
  assert.ok(porNombre(esp, "D13"), "el ESP32 dejó de llamar `D13` al GPIO13")
  assert.ok(!porNombre(esp, "GPIO13"), "el ESP32 ahora TIENE un pin `GPIO13`: el mapeo quedó viejo")
  assert.ok(!porNombre(uno, "GND") && !porNombre(esp, "GND"), "apareció un pin llamado `GND`: revisar la elección de masa")
})

// ── todo pin que el tool reparte EXISTE en la pieza ─────────────────────────
//
// El barrido completo: los dos pools enteros, el PWM, el I2C y TODOS los pines
// que `motivoRechazo` deja pasar a mano ("led:5"). No 4 de 13: los 13.
//
// MUTACIÓN QUE MATA: en `PLACAS.uno.pinWokwi`, devolver `` `D${p.n}` `` en vez
// de `String(p.n)` — o sea, dejar la "D" puesta como en la etiqueta del docente.
// Los 14 digitales del UNO dejan de existir en la pieza de golpe.
// Otra: en `PLACAS.esp32.pinWokwi`, sacarle el `[16, "RX2"]` al mapa.
function pinesQueElToolReparte(placa) {
  const claves = new Map() // clave → {pin, origen}
  const meter = (pin, origen) => {
    const k = `${pin.banco}${pin.n}`
    if (!claves.has(k)) claves.set(k, { pin, origen })
  }
  for (const p of placa.poolDigital) meter(p, "poolDigital")
  for (const p of placa.poolAnalogico) meter(p, "poolAnalogico")
  for (const p of placa.poolPwm ?? []) meter(p, "poolPwm")
  meter(placa.i2c.sda, "i2c.sda")
  meter(placa.i2c.scl, "i2c.scl")
  // Los que el alumno puede forzar ("led:5"): todo lo que `motivoRechazo` NO
  // rechaza. El rango se pasa de largo a propósito, para incluir los que no
  // existen y confirmar que ésos SÍ se rechazan.
  //
  // El BANCO no se barre: lo elige `bancoDe`, que es el `pool[0].banco` de esa
  // clase. El número que escribe el usuario no dice el banco — en el UNO un "4"
  // digital es D4 y uno analógico es A4, que son dos pines distintos — así que
  // barrer los tres bancos inventaría pines que el tool no construye jamás (un
  // "A25" en el ESP32, cuyo `motivoRechazo` mira sólo el número y lo aceptaría).
  for (const clase of ["digital", "analogico"]) {
    const banco = (clase === "analogico" ? placa.poolAnalogico : placa.poolDigital)[0]?.banco ?? "GPIO"
    for (let n = -1; n <= 45; n++) {
      const pin = { banco, n }
      if (placa.motivoRechazo(pin, clase, "un componente") == null) meter(pin, `manual/${clase}`)
    }
  }
  return claves
}

test("wokwi: VP y VN salen del skill, no de la memoria de nadie", () => {
  // SE ROMPÍA ASÍ: el ESP32 reparte GPIO36 y GPIO39 y la pieza no los llama `D36`/`D39`
  // sino `VP` y `VN` — la serigrafía real. Mapearlos "por descarte" (son los dos que
  // sobran en el header) es lo más peligroso que se puede hacer acá: si quedan al revés,
  // el cable del sensor va al agujero de al lado y EL DIBUJO SE VE PERFECTO. Nadie lo
  // nota hasta que el pibe cablea y el sensor lee cualquier cosa.
  //
  // Y medido: con los otros tests puestos, invertir VP y VN dejaba la suite ENTERA en
  // verde. Existir en la pieza existen los dos; lo que faltaba era quién es quién.
  //
  // Por eso el dato NO vive en el tool: vive en `skills/esp32`, con la cita al ESP32
  // Series Datasheet (tabla Pin Definitions: SENSOR_VP = pin físico 5 = GPIO36;
  // SENSOR_VN = pin 8 = GPIO39). Este test ata el mapa del tool a lo que dice el skill,
  // así el tool REFLEJA la fuente en vez de ser la fuente.
  const skill = readFileSync(join(REPO, "opencode/skills/esp32/SKILL.md"), "utf8")

  // El skill tiene que seguir nombrando su fuente: sin cita, el dato es memoria de alguien.
  assert.match(skill, /documentation\.espressif\.com/,
    "el skill perdió el enlace al datasheet: entonces VP=GPIO36 vuelve a ser una suposición")

  // Y tiene que decir explícitamente quién es quién, en la misma línea.
  for (const [rotulo, gpio] of [["VP", 36], ["VN", 39]]) {
    const linea = skill.split("\n").find((l) => l.includes(`\`${rotulo}\``) && l.includes(`GPIO${gpio}`))
    assert.ok(linea, `el skill esp32 tiene que decir, en una línea, que ${rotulo} es GPIO${gpio}`)
    // Y NO puede decir lo contrario en esa misma línea: eso cazaría una inversión.
    const otro = rotulo === "VP" ? 39 : 36
    assert.ok(!linea.includes(`GPIO${otro}`),
      `la línea de ${rotulo} nombra también a GPIO${otro}: así no se puede saber cuál es cuál`)
  }

  // El tool refleja exactamente eso.
  const { PLACAS } = ns
  assert.equal(PLACAS.esp32.pinWokwi({ banco: "GPIO", n: 36 }), "VP",
    "GPIO36 es SENSOR_VP (pin físico 5 del datasheet), no VN")
  assert.equal(PLACAS.esp32.pinWokwi({ banco: "GPIO", n: 39 }), "VN",
    "GPIO39 es SENSOR_VN (pin físico 8 del datasheet), no VP")
})

test("wokwi: cada pin que el tool puede repartir existe en la pieza de esa placa", () => {
  const { PLACAS } = ns
  assert.ok(PLACAS, "`PLACAS` dejó de exportarse y este invariante se quedó sin red")

  // Los únicos huecos conocidos, escritos con nombre y apellido. Si aparece uno
  // nuevo, este test se pone rojo: un pin sin nombre es un HALLAZGO, no un caso
  // a resolver con una suposición.
  const HUECOS = {
    // GPIO36 y GPIO39 YA NO son huecos: la pieza los llama `VP` y `VN`, que es la
    // serigrafía real de la placa. No se dedujo de "son los dos que sobran en el
    // header" — así se manda un cable al agujero de al lado con el dibujo viéndose
    // perfecto. Confirmado contra el fabricante (ESP32 Series Datasheet, tabla Pin
    // Definitions: SENSOR_VP = pin físico 5 = GPIO36; SENSOR_VN = pin 8 = GPIO39) y
    // escrito con la cita en `skills/esp32`, que es donde vive un dato de hardware.
    //
    // GPIO0/37/38 SIGUEN siendo huecos, y por un motivo distinto: pasan por
    // `motivoRechazo` pero no salen a ningún pin del header de la DevKit v1. GPIO37 y
    // GPIO38 son SENSOR_CAPP/SENSOR_CAPN y el módulo WROOM no los expone; GPIO0 es
    // strapping y tampoco tiene agujero. Ésos no se pueden "mapear": no están.
    esp32: ["GPIO0", "GPIO37", "GPIO38"],
    uno: [],
  }

  for (const [id, placa] of Object.entries(PLACAS)) {
    const reales = new Set(WOKWI[id]().map((p) => p.name))
    const reparte = pinesQueElToolReparte(placa)
    assert.ok(reparte.size > 10, `el barrido de ${id} juntó sólo ${reparte.size} pines: no está barriendo nada`)

    const huerfanos = []
    for (const [clave, { pin, origen }] of reparte) {
      const nombre = placa.pinWokwi(pin)
      if (nombre == null) { huerfanos.push(clave); continue }
      assert.ok(
        reales.has(nombre),
        `${placa.etiqueta}: el tool reparte ${placa.etiquetaPin(pin)} (${origen}) y lo mapea al pin Wokwi "${nombre}", que NO EXISTE en ${placa.tag}. El cable iría a la nada.`,
      )
    }
    assert.deepEqual(
      huerfanos.sort(),
      [...HUECOS[id]].sort(),
      `${placa.etiqueta}: cambió la lista de pines que el tool reparte SIN nombre en Wokwi. Si apareció uno nuevo es un hallazgo, no un caso a tapar con una suposición; si desapareció uno, actualizá HUECOS y el comentario que lo explica.`,
    )
  }
})

// ── y al revés: el mapeo no INVENTA ningún nombre ───────────────────────────
//
// El test de arriba mira los pines que el tool reparte HOY. Éste mira el mapeo
// entero, incluso lo que hoy nadie pide, porque el pool se toca seguido.
//
// MUTACIÓN QUE MATA: en `ESP32_WOKWI_PIN`, agregar `[36, "D36"]` — que es
// justamente la suposición tentadora para tapar el hueco de POOL_ANALOGICO.
// Pasaría el test de arriba (ya no sería huérfano) y rompe acá.
test("wokwi: el mapeo nunca devuelve un nombre que la pieza no tenga", () => {
  const { PLACAS } = ns
  for (const [id, placa] of Object.entries(PLACAS)) {
    const reales = new Set(WOKWI[id]().map((p) => p.name))
    let mapeados = 0
    for (const banco of ["GPIO", "D", "A"]) {
      for (let n = -5; n <= 60; n++) {
        const nombre = placa.pinWokwi({ banco, n })
        if (nombre == null) continue
        mapeados++
        assert.ok(
          reales.has(nombre),
          `${placa.etiqueta}: pinWokwi({${banco},${n}}) inventó el nombre "${nombre}", que no existe en ${placa.tag}`,
        )
      }
    }
    assert.ok(mapeados >= 19, `${placa.etiqueta}: el barrido sólo mapeó ${mapeados} pines, no está barriendo`)
  }
})

// ── los rieles, y las masas ─────────────────────────────────────────────────
//
// La parte que más se puede equivocar en silencio. NINGUNA de las dos placas
// tiene un pin llamado `GND`: el UNO tiene tres y el ESP32 dos, en headers
// distintos. Elegir la equivocada dibuja un cable que cruza la placa entera.
//
// Y no se verifica contra una copia del criterio: se RECALCULA cuál es la masa
// más cercana usando las coordenadas que la propia pieza publica, y se exige que
// el tool haya elegido ésa. El criterio queda demostrado, no declarado.
//
// MUTACIÓN QUE MATA: en `PLACAS.uno.rielWokwi`, devolver `"GND.2"` en vez de
// `"GND.3"` para el banco analógico. Son las dos del mismo header, a 9,5 px una
// de la otra: a ojo, en el HTML, no se distingue.
// Otra: devolver siempre `"GND.1"` (ignorar el `ref`), que es el atajo obvio.
test("wokwi: cada riel cae en un pin real, y la masa es la MÁS CERCANA al pin de señal", () => {
  const { PLACAS } = ns
  const RIELES = ["V5", "V3", "VLOGICA", "GND", "SDA", "SCL"]

  for (const [id, placa] of Object.entries(PLACAS)) {
    const pines = WOKWI[id]()
    const reales = new Set(pines.map((p) => p.name))
    const masas = pines.filter((p) => tieneSenal(p, "power", "GND"))
    assert.ok(masas.length >= 2, `${placa.etiqueta}: se esperaban varias masas y salieron ${masas.length}`)

    // 1. Todo riel que la placa declara tener, cae en un pin que existe.
    for (const r of RIELES) {
      if (placa.riel[r] == null) continue // `null` = esta placa no tiene ese riel
      const nombre = placa.rielWokwi(r, null)
      assert.ok(nombre != null, `${placa.etiqueta}: el riel ${r} se rotula "${placa.riel[r]}" pero no tiene nombre Wokwi`)
      assert.ok(reales.has(nombre), `${placa.etiqueta}: el riel ${r} apunta a "${nombre}", que no existe en ${placa.tag}`)
    }

    // 2. El I2C sale de `i2c`, no de una segunda tabla escrita a mano.
    assert.equal(placa.rielWokwi("SDA", null), placa.pinWokwi(placa.i2c.sda), `${placa.etiqueta}: el riel SDA se despegó de placa.i2c.sda`)
    assert.equal(placa.rielWokwi("SCL", null), placa.pinWokwi(placa.i2c.scl), `${placa.etiqueta}: el riel SCL se despegó de placa.i2c.scl`)

    // 3. LA MASA. Para CADA pin que el tool reparte y que tiene nombre Wokwi, se
    //    calcula la masa más cercana con las coordenadas de la pieza y se exige
    //    que el tool haya elegido exactamente ésa.
    let verificados = 0
    const elegidas = new Set()
    for (const { pin } of pinesQueElToolReparte(placa).values()) {
      const nombre = placa.pinWokwi(pin)
      if (nombre == null) continue
      const senal = pines.find((p) => p.name === nombre)
      const dist = (m) => Math.hypot(m.x - senal.x, m.y - senal.y)
      const cerca = masas.reduce((a, b) => (dist(b) < dist(a) ? b : a))
      const elegida = placa.rielWokwi("GND", pin)
      assert.equal(
        elegida,
        cerca.name,
        `${placa.etiqueta}: para ${placa.etiquetaPin(pin)} (Wokwi "${nombre}") el tool manda la masa a ${elegida}, ` +
          `pero la más cercana es ${cerca.name} (${dist(cerca).toFixed(1)} px contra ${dist(masas.find((m) => m.name === elegida)).toFixed(1)} px). ` +
          `Ese cable cruza la placa.`,
      )
      elegidas.add(elegida)
      verificados++
    }
    assert.ok(verificados > 10, `${placa.etiqueta}: sólo se verificaron ${verificados} masas, el barrido no está barriendo`)
    // Si TODAS las señales cayeran en la misma masa, un `rielWokwi` que ignora el
    // `ref` y devuelve una constante pasaría el punto 3 sin hacer nada.
    assert.ok(elegidas.size >= 2, `${placa.etiqueta}: el tool usa una sola masa (${[...elegidas]}) para todos los pines: el \`ref\` no se está mirando`)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// EL REGALO: `signals` como TERCERA voz sobre nuestro hardware
// ════════════════════════════════════════════════════════════════════════════
//
// Esto ya no valida el mapeo: valida LOS DATOS DE HARDWARE del tool contra una
// fuente que no los copió de nosotros. Wokwi marca en cada pin si hace `pwm`, si
// es `analog`, si es `SDA`/`SCL`, si es `TX`/`RX`. Nosotros sacamos esos mismos
// datos de las skills y de la serigrafía del SVG. Son dos caminos distintos al
// mismo número: si no coinciden, uno de los dos está mal, y averiguar cuál vale
// más que el mapeo entero.
//
// MUTACIÓN QUE MATA: sacarle el 3 a `UNO_POOL_PWM` (o meterle el 4).
// Dejaba en verde a los tests que ya existían: el pool PWM del UNO estaba
// confirmado por el skill `placas` y por la serigrafía `~` del SVG, pero ningún
// test lo ataba contra `pinInfo`.
test("signals: el pool PWM del UNO es EXACTAMENTE el que Wokwi marca como pwm", () => {
  const { PLACAS } = ns
  const pines = WOKWI.uno()
  const deWokwi = pines.filter((p) => tieneSenal(p, "pwm")).map((p) => p.name).sort()
  assert.ok(deWokwi.length > 0, "Wokwi no marcó NINGÚN pin como pwm: el extractor de signals está roto")

  const delTool = PLACAS.uno.poolPwm.map((p) => PLACAS.uno.pinWokwi(p)).sort()
  assert.deepEqual(
    delTool,
    deWokwi,
    "el pool PWM del UNO dejó de coincidir con los pines que Wokwi marca `pwm`. Son dos fuentes independientes: si difieren, una está mal y hay que averiguar cuál ANTES de tocar nada.",
  )
})

// MUTACIÓN QUE MATA: sacarle el 5 a `UNO_POOL_ANALOGICO`.
test("signals: el pool analógico del UNO es el que Wokwi marca como analog", () => {
  const { PLACAS } = ns
  // El UNO R3 repite el bus I2C arriba de AREF (`A4.2`/`A5.2`), así que los
  // NOMBRES están duplicados. Lo que no se duplica es el CANAL del ADC, que es
  // lo que de verdad identifica la entrada.
  const canales = [...new Set(WOKWI.uno().flatMap((p) => (p.signals ?? []).filter((s) => s.type === "analog").map((s) => s.channel)))].sort()
  assert.ok(canales.length > 0, "Wokwi no marcó NINGÚN canal analógico: el extractor de signals está roto")
  const delTool = PLACAS.uno.poolAnalogico.map((p) => p.n).sort()
  assert.deepEqual(delTool, canales, "el pool analógico del UNO dejó de coincidir con los canales que Wokwi marca `analog`")
})

// MUTACIÓN QUE MATA: en `PLACAS.uno.i2c`, poner `{ sda: pinA(5), scl: pinA(4) }`
// (invertirlos). El circuito sale igual de prolijo y el LCD no arranca nunca.
test("signals: el I2C de cada placa cae donde Wokwi marca SDA y SCL", () => {
  const { PLACAS } = ns
  for (const [id, placa] of Object.entries(PLACAS)) {
    const pines = WOKWI[id]()
    const sda = placa.pinWokwi(placa.i2c.sda)
    const scl = placa.pinWokwi(placa.i2c.scl)
    const busca = (n) => pines.find((p) => p.name === n)
    assert.ok(busca(sda) && busca(scl), `${placa.etiqueta}: el I2C apunta a pines que no existen (${sda}/${scl})`)
    assert.ok(tieneSenal(busca(sda), "i2c", "SDA"), `${placa.etiqueta}: el tool usa ${placa.etiquetaPin(placa.i2c.sda)} como SDA, pero Wokwi NO lo marca SDA`)
    assert.ok(tieneSenal(busca(scl), "i2c", "SCL"), `${placa.etiqueta}: el tool usa ${placa.etiquetaPin(placa.i2c.scl)} como SCL, pero Wokwi NO lo marca SCL`)
    assert.notEqual(sda, scl, `${placa.etiqueta}: SDA y SCL cayeron en el MISMO pin`)
  }
})

// ── D0/D1 del UNO: la nota que ya tenían, atada a una tercera fuente ────────
//
// MUTACIÓN QUE MATA: en `PLACAS.uno.notaDePin`, cambiar el `p.n === 0 || p.n === 1`
// por `p.n === 0` — la nota del puerto serie desaparece para D1 y nadie se entera.
//
// El tool ya avisa que D0/D1 son el puerto serie del USB, y hasta cita la
// serigrafía ("RX←0", "TX→1"). Eso salió de las skills. `signals` lo dice por
// tercera vía, sin habernos copiado.
test("signals: D0 y D1 del UNO son los que Wokwi marca RX y TX, y llevan la nota", () => {
  const { PLACAS } = ns
  const uno = PLACAS.uno
  const pines = WOKWI.uno()
  const conUsart = (s) => pines.filter((p) => tieneSenal(p, "usart", s)).map((p) => p.name)
  assert.deepEqual(conUsart("RX"), ["0"], "Wokwi dejó de marcar el pin `0` del UNO como RX")
  assert.deepEqual(conUsart("TX"), ["1"], "Wokwi dejó de marcar el pin `1` del UNO como TX")

  // Los dos están en el pool (decisión del producto: entran, pero con un pero).
  for (const n of [0, 1]) {
    const pin = { banco: "D", n }
    assert.ok(uno.poolDigital.some((p) => p.banco === "D" && p.n === n), `D${n} salió del pool digital del UNO`)
    const nota = uno.notaDePin(pin)
    assert.ok(nota, `D${n} es el puerto serie del USB según Wokwi y el tool dejó de avisarlo`)
    assert.match(nota, /serie|USB/i, `la nota de D${n} dejó de nombrar el puerto serie`)
  }
  // Y el pin de al lado NO puede llevar esa nota: si la llevara, el assert de
  // arriba pasaría con un `notaDePin` que devuelve lo mismo para todo.
  assert.doesNotMatch(uno.notaDePin({ banco: "D", n: 2 }) ?? "", /serie|USB/i, "D2 lleva la nota del puerto serie, que no es suya")
})

// ── el ESP32: los solo-entrada, por tercera vía ─────────────────────────────
//
// MUTACIÓN QUE MATA: sacarle el 34 a `GPIO_SOLO_ENTRADA`.
//
// `GPIO_SOLO_ENTRADA` salió del datasheet vía skills/esp32. Wokwi no sabe nada
// de nuestras skills, y sin embargo marca `pwm` en TODOS los GPIO del DevKit
// MENOS en D34 y D35 — que son justo dos de los cuatro. Un pin sin driver de
// salida no puede hacer PWM: es el mismo hecho contado por otro.
test("signals: los GPIO que Wokwi NO marca pwm son los solo-entrada del tool", () => {
  const { PLACAS, GPIO_SOLO_ENTRADA } = ns
  assert.ok(GPIO_SOLO_ENTRADA?.size > 0, "`GPIO_SOLO_ENTRADA` dejó de exportarse")
  const esp = PLACAS.esp32

  // De los GPIO que la pieza SÍ nombra, ¿cuáles no hacen pwm?
  const sinPwm = WOKWI.esp32()
    .filter((p) => /^D\d+$/.test(p.name) && !tieneSenal(p, "pwm"))
    .map((p) => Number(p.name.slice(1)))
    .sort((a, b) => a - b)
  assert.ok(sinPwm.length > 0, "todos los D<n> del ESP32 hacen pwm: el extractor de signals está roto")

  for (const n of sinPwm) {
    assert.ok(
      GPIO_SOLO_ENTRADA.has(n),
      `Wokwi dice que GPIO${n} no hace PWM, pero el tool no lo tiene como solo-entrada: una de las dos fuentes está mal`,
    )
    // Y el tool lo rechaza de verdad para algo que tenga que encender.
    assert.ok(esp.motivoRechazo({ banco: "GPIO", n }, "digital", "un LED"), `el tool acepta GPIO${n} como salida y Wokwi dice que no puede`)
  }
  // El ESP32 no declara `poolPwm` justamente porque cualquier salida hace PWM.
  assert.equal(esp.poolPwm, undefined, "el ESP32 declaró un poolPwm: si de verdad hay pines sin PWM, este test tiene que decir cuáles")
  for (const p of esp.poolDigital) {
    assert.ok(!sinPwm.includes(p.n), `GPIO${p.n} está en el pool digital del ESP32 y Wokwi dice que no hace PWM`)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// LOS CABLES AL PIN: que el dibujo pueda saber a qué agujero va cada punta
// ════════════════════════════════════════════════════════════════════════════
//
// Hoy los cables salen de una barra gris al costado de la placa. Para anclarlos
// al pin de verdad, `armarCircuito` emite dos atributos por cable en el
// `<div class="pin">`:
//
//   data-placa="3"     ← placa.pinWokwi(pin) / placa.rielWokwi(riel, ref)
//   data-pieza="PWM"   ← pin.pinPieza, el mapeo del lado del componente
//
// Si uno de los dos no se puede resolver, ESE atributo no se emite y ese cable
// queda como hoy. El fallback es por cable, no por hoja.
//
// Y todo esto se prueba contra el `pinInfo` REAL de cada pieza, que es fuente
// EXTERNA. Comparar el mapeo contra una copia del mapeo no prueba nada: los dos
// lados se editan juntos y siempre coinciden.

// ── LA VERDAD DEL NAVEGADOR ────────────────────────────────────────────────
//
// Los nombres que las 36 piezas publican en `el.pinInfo` LEÍDOS EN CHROME, no
// sacados del extractor. Es la única fuente de acá que no pasa por el parser, y
// existe para una cosa: si el extractor se rompe o miente, esto lo delata.
//
// NO ES UNA COPIA DEL MAPEO, y la diferencia importa. El extractor parsea el
// bundle minificado; esta tabla se transcribió de instanciar cada pieza en un
// navegador de verdad. Son dos caminos independientes hasta el mismo dato: el
// día que Wokwi renombre un pin al actualizar el bundle, el extractor cambia y
// esta tabla no, y el test se pone rojo — que es el único lugar barato donde
// enterarse.
//
// CÓMO SE REGENERA (sin instalar nada, con el Chrome que ya está):
//
//   1. una página con <script src="wokwi-bundle.js"> y <script
//      src="componentes-extra.js">, que cree cada tag, lo cuelgue del DOM,
//      espere ~100 ms y escriba JSON.stringify(el.pinInfo) en un <pre>;
//   2. chromium --headless --disable-gpu --virtual-time-budget=8000 \
//        --dump-dom file://…/index.html
//   3. del DOM volcado se saca el JSON y de ahí los nombres.
//
// OJO: `pinInfo` es un getter de INSTANCIA. Leerlo de la clase da undefined.
// El volcado en prosa, con coordenadas y signals, vive en docs/wokwi-pinout-dump.md.
const VERDAD_NAVEGADOR = {
  "pb-bmp180": [],
  "pb-bomba": [],
  "pb-calefactor": [],
  "pb-driver": [],
  "pb-higrometro": [],
  "pb-lampara": [],
  "pb-lluvia": [],
  "pb-motor": ["+", "-"],
  "pb-relay": ["IN", "VCC", "GND"],
  "pb-sensor-shield": [
     "AREF.G", "AREF.V", "AREF", "GND.G", "GND.V", "GND", "13.G", "13.V", "13", "12.G", "12.V", "12", "11.G",
     "11.V", "11", "10.G", "10.V", "10", "9.G", "9.V", "9", "8.G", "8.V", "8", "7.G", "7.V", "7", "6.G",
     "6.V", "6", "5.G", "5.V", "5", "4.G", "4.V", "4", "3.G", "3.V", "3", "2.G", "2.V", "2", "1.G", "1.V",
     "1", "0.G", "0.V", "0", "A0.G", "A0.V", "A0", "A1.G", "A1.V", "A1", "A2.G", "A2.V", "A2", "A3.G",
     "A3.V", "A3", "A4.G", "A4.V", "A4", "A5.G", "A5.V", "A5", "URF01.VCC", "URF01.A0", "URF01.A1",
     "URF01.GND",
  ],
  "pb-valvula": [],
  "wokwi-7segment": ["COM.1", "COM.2", "A", "B", "C", "D", "E", "F", "G", "DP"],
  "wokwi-analog-joystick": ["VCC", "VERT", "HORZ", "SEL", "GND"],
  "wokwi-arduino-uno": [
     "A5.2", "A4.2", "AREF", "GND.1", "13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1",
     "0", "IOREF", "RESET", "3.3V", "5V", "GND.2", "GND.3", "VIN", "A0", "A1", "A2", "A3", "A4", "A5",
  ],
  "wokwi-buzzer": ["1", "2"],
  "wokwi-dht22": ["VCC", "SDA", "NC", "GND"],
  "wokwi-esp32-devkit-v1": [
     "VIN", "GND.2", "D13", "D12", "D14", "D27", "D26", "D25", "D33", "D32", "D35", "D34", "VN", "VP", "EN",
     "3V3", "GND.1", "D15", "D2", "D4", "RX2", "TX2", "D5", "D18", "D19", "D21", "RX0", "TX0", "D22", "D23",
  ],
  "wokwi-flame-sensor": ["VCC", "GND", "DOUT", "AOUT"],
  "wokwi-hc-sr04": ["VCC", "TRIG", "ECHO", "GND"],
  "wokwi-ir-receiver": ["GND", "VCC", "DAT"],
  "wokwi-lcd1602": [
     "VSS", "VDD", "V0", "RS", "RW", "E", "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "A", "K",
  ],
  "wokwi-led": ["A", "C"],
  "wokwi-membrane-keypad": ["R1", "R2", "R3", "R4", "C1", "C2", "C3", "C4"],
  "wokwi-mpu6050": ["INT", "AD0", "XCL", "XDA", "SDA", "SCL", "GND", "VCC"],
  "wokwi-neopixel": ["VDD", "DOUT", "VSS", "DIN"],
  "wokwi-ntc-temperature-sensor": ["GND", "VCC", "OUT"],
  "wokwi-photoresistor-sensor": ["VCC", "GND", "DO", "AO"],
  "wokwi-pir-motion-sensor": ["VCC", "OUT", "GND"],
  "wokwi-potentiometer": ["GND", "SIG", "VCC"],
  "wokwi-pushbutton": ["1.l", "2.l", "1.r", "2.r"],
  "wokwi-rgb-led": ["R", "COM", "G", "B"],
  "wokwi-servo": ["GND", "V+", "PWM"],
  "wokwi-small-sound-sensor": ["AOUT", "GND", "VCC", "DOUT"],
  "wokwi-ssd1306": ["DATA", "CLK", "DC", "RST", "CS", "3V3", "VIN", "GND"],
  "wokwi-stepper-motor": ["A-", "A+", "B+", "B-"],
  "wokwi-tilt-switch": ["GND", "VCC", "OUT"],
}

// El catálogo entero, tal como lo lee el tool. Se importa del módulo REAL y no se
// copia: una lista de componentes escrita acá se desactualiza el día que alguien
// agregue el 34º y este barrido dejaría de mirarlo sin decir nada.
const TIPOS = () => Object.keys(ns.COMPONENTES)
const TAGS_DEL_TOOL = () =>
  [...new Set([...Object.values(ns.COMPONENTES).map((c) => c.tag), ...Object.values(ns.PLACAS).map((p) => p.tag), "pb-sensor-shield"])].sort()

// ── 1. EL EXTRACTOR CONTRA LA VERDAD DEL NAVEGADOR ─────────────────────────
//
// MUTACIÓN QUE MATA: en `pinesDePieza`, devolver `[]` en vez de `pines`. O en
// `pinesDelBundle`, volver al `lastIndexOf("pinInfo", …)` de antes (el LCD pasa
// de 16 nombres a 4 y este test lo dice con nombre y apellido).
//
// Sin este test el barrido de más abajo recorre listas vacías y pasa en verde:
// es literalmente el bug de los siete tests que pasaban sin probar nada. Por eso
// el extractor se ancla a mano contra una fuente que NO es él.
test("wokwi: el extractor saca de las 36 piezas los mismos nombres que el navegador", () => {
  const tags = TAGS_DEL_TOOL()
  assert.deepEqual(
    tags,
    Object.keys(VERDAD_NAVEGADOR).sort(),
    "las piezas que el tool dibuja ya no son las que tiene medidas VERDAD_NAVEGADOR: hay que volver a volcarlas del navegador (ver la receta de arriba)",
  )
  for (const tag of tags) {
    assert.deepEqual(
      nombresDePieza(tag),
      VERDAD_NAVEGADOR[tag],
      `el extractor y el navegador NO dicen lo mismo de ${tag}. O cambió el bundle (y hay que revisar el mapeo de esa pieza entera) o se rompió el extractor.`,
    )
  }
  // Anclas concretas, por si alguien "arregla" el test de arriba copiándole la
  // salida al extractor: éstas son las cuatro piezas que el extractor VIEJO no
  // sabía leer, con el número que las delataba.
  assert.equal(nombresDePieza("wokwi-lcd1602").length, 16, "el LCD volvió a salir con la lista I2C de 4: el getter se está evaluando por la rama equivocada")
  assert.equal(nombresDePieza("wokwi-servo").length, 3, "el servo dejó de dar sus 3 pines")
  assert.deepEqual(nombresDePieza("wokwi-led"), ["A", "C"], "el LED volvió a romperse (antes: `t is not defined`)")
  assert.equal(nombresDePieza("wokwi-7segment").length, 10, "el 7 segmentos volvió a romperse (antes: `t is not defined`)")
})

// ── 2. CIERRE DE NOMBRES: lo que se emite EXISTE en la pieza ───────────────
//
// La red que atrapa el 90% de los cables mal dibujados. Se genera la hoja de
// VERDAD (no se mira el catálogo) para cada componente en cada placa, se leen los
// `data-placa` / `data-pieza` que salieron, y cada nombre tiene que estar en el
// `pinInfo` de la pieza que le corresponde — la placa para uno, el componente
// para el otro. Contra el extractor, que es fuente externa.
//
// MUTACIONES QUE MATAN:
//   · `PLACAS.uno.pinWokwi`: devolver `` `D${p.n}` `` en vez de `String(p.n)`.
//     Los 14 digitales del UNO dejan de existir en la pieza de golpe.
//   · el servo: cambiar `pinPieza: "PWM"` por `"SIG"` (SIG existe, pero en el
//     potenciómetro, no en el servo).
//   · `PLACAS.esp32.rielWokwi`: devolver "3.3V" en vez de "3V3" para V3.
//
// EL SHIELD VA PORQUE NO ES UNA PLACA NUEVA: `pb-sensor-shield` saca los mismos
// pines a ternas, así que `data-placa` tiene que seguir siendo un nombre del UNO.
// Si alguna vez se decide anclar al shield, este test es el que se pone rojo.
const PLACAS_BARRIDAS = [
  { arg: "esp32", tagPlaca: "wokwi-esp32-devkit-v1" },
  { arg: "uno", tagPlaca: "wokwi-arduino-uno" },
  { arg: "uno con sensor shield", tagPlaca: "wokwi-arduino-uno" },
]

// Las filas de la hoja: cada una es UN componente con su pieza y sus cables.
//
// La pieza se saca del HTML y no del catálogo a propósito. Además de ser más
// corto, así se verifica contra la pieza que SE DIBUJÓ: el tool inyecta
// componentes solo (pedir "stepper" agrega el driver ULN2003), y mirando nada
// más el tipo pedido esos cables inyectados no se controlarían nunca.
function filasDe(html) {
  return html
    .split('<div class="fila">')
    .slice(1)
    .map((chunk) => {
      const tags = [...chunk.matchAll(/<((?:wokwi|pb)-[a-z0-9-]+) id="/g)].map((m) => m[1])
      assert.equal(tags.length, 1, `una fila de la hoja dibuja ${tags.length} piezas (${tags}): el parser de este test quedó viejo`)
      return {
        tag: tags[0],
        cables: [...chunk.matchAll(/<div class="pin"[^>]*>/g)].map((m) => ({
          nom: chunk.slice(m.index).match(/<span class="nom">(.*?)<\/span>/)?.[1] ?? "?",
          placa: m[0].match(/data-placa="([^"]*)"/)?.[1]?.split(" ") ?? null,
          pieza: m[0].match(/data-pieza="([^"]*)"/)?.[1]?.split(" ") ?? null,
        })),
      }
    })
}

test("cables: todo data-placa/data-pieza emitido EXISTE en el pinInfo de su pieza", async () => {
  let mirados = 0, conPlaca = 0, conPieza = 0
  for (const { arg, tagPlaca } of PLACAS_BARRIDAS) {
    const dePlaca = new Set(nombresDePieza(tagPlaca))
    for (const tipo of TIPOS()) {
      const { r, html } = await gen({ componentes: tipo, placa: arg }, `cable-${arg.replace(/\W+/g, "")}-${tipo}`)
      // Un componente que esta placa no soporta se RECHAZA, y eso ya lo prueban
      // otros tests. Acá no hay hoja que mirar: se saltea y no se cuenta.
      if (!r.startsWith("Listo")) continue
      const filas = filasDe(html)
      assert.ok(filas.length >= 1, `${tipo} en ${arg}: la hoja salió sin ninguna fila de componente`)
      for (const fila of filas) {
        const dePieza = new Set(nombresDePieza(fila.tag))
        for (const c of fila.cables) {
          mirados++
          const donde = `${tipo} en ${arg}, ${fila.tag}/"${c.nom}"`
          if (c.placa) {
            conPlaca++
            for (const n of c.placa)
              assert.ok(dePlaca.has(n), `${donde}: data-placa dice "${n}" y ${tagPlaca} NO tiene ningún pin así. El cable se dibujaría igual de prolijo en el agujero equivocado.`)
          }
          if (c.pieza) {
            conPieza++
            for (const n of c.pieza)
              assert.ok(dePieza.has(n), `${donde}: data-pieza dice "${n}" y ${fila.tag} NO tiene ningún pin así.`)
          }
          // Dos listas de largo distinto aparearían el cable 2 con el agujero 3.
          if (c.placa && c.pieza)
            assert.equal(c.placa.length, c.pieza.length, `${donde}: ${c.placa.length} puntas de placa contra ${c.pieza.length} de pieza`)
        }
      }
    }
  }
  // Que el barrido haya barrido. Sin esto, un `continue` de más lo deja en verde
  // sin haber mirado un solo cable.
  assert.ok(mirados >= 150, `el barrido sólo miró ${mirados} cables: se está salteando casi todo`)
  assert.ok(conPlaca >= 100, `sólo ${conPlaca} cables trajeron data-placa: el atributo dejó de emitirse`)
  assert.ok(conPieza >= 100, `sólo ${conPieza} cables trajeron data-pieza: el atributo dejó de emitirse`)
})

// ── 3. COMPLETITUD DECLARADA ───────────────────────────────────────────────
//
// Un pin sin mapeo Y sin motivo no compila (`pinPieza` es obligatorio en el tipo,
// no opcional), así que esa mitad la ataja `tsc`. Lo que este test agrega es que
// el motivo sea VERDAD y no una excusa: si la pieza tiene un pin que se llama
// igual que la fila, no hay nada que declarar, hay que mapearlo.
//
// MUTACIONES QUE MATAN:
//   · cambiar el `pinPieza: "IN"` del relay por `{ sinAnclaje: "después lo veo" }`
//     — `pb-relay` SÍ tiene un pin `IN`.
//   · dejar un motivo vacío o de tres letras.
//
// EL NOMBRE SE COMPARA NORMALIZADO, y eso lo encontró una prueba de mutación, no
// el diseño. La primera versión comparaba el nombre tal cual, así que tapar el
// pin `IN` del relay con un `{ sinAnclaje }` SOBREVIVÍA: la fila se llama
// "IN (señal)" y el pin `IN`, y un `Set.has` literal no los junta. La mitad del
// catálogo lleva la aclaración entre paréntesis, o sea que la red no agarraba a
// la mitad del catálogo.
const normNombre = (s) =>
  s.normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\(.*?\)/g, "")
    .split("/")[0]
    .replace(/[^A-Z0-9+.-]/g, "")

test("cables: todo pin sin anclaje tiene un motivo escrito, y ninguno tapa un pin que sí existe", () => {
  let declarados = 0, anclados = 0
  for (const tipo of TIPOS()) {
    const def = ns.COMPONENTES[tipo]
    const dePieza = new Set(nombresDePieza(def.tag).map(normNombre))
    for (const pin of def.pines) {
      const anclas = ns.anclajesDe(pin)
      const motivo = ns.motivoSinAnclaje(pin)
      assert.ok(
        (anclas == null) !== (motivo == null),
        `${tipo}/"${pin.nombre}": pinPieza tiene que ser O los nombres de la pieza O un { sinAnclaje: "motivo" }, no las dos cosas ni ninguna`,
      )
      if (motivo != null) {
        declarados++
        assert.ok(motivo.length >= 30, `${tipo}/"${pin.nombre}": el motivo de sinAnclaje es "${motivo}". Tiene que explicar POR QUÉ no hay pin, que es lo que el próximo va a leer antes de inventar uno.`)
        assert.ok(
          !dePieza.has(normNombre(pin.nombre)),
          `${tipo}/"${pin.nombre}": está declarado sin anclaje, pero ${def.tag} TIENE un pin que se llama "${normNombre(pin.nombre)}". No hay nada que declarar: mapealo.`,
        )
      } else {
        anclados++
        const n = pin.cantidad ?? 1
        assert.equal(anclas.length, n, `${tipo}/"${pin.nombre}": la fila consume ${n} pines y declara ${anclas.length} anclajes. Una etiqueta que vale por siete pines necesita siete nombres.`)
        assert.equal(new Set(anclas).size, anclas.length, `${tipo}/"${pin.nombre}": repite un anclaje`)
      }
    }
  }
  assert.ok(declarados > 0 && anclados > 0, "el barrido no encontró ni anclajes ni declaraciones: está mirando un catálogo vacío")
})

// ── 4. LOS ÍNDICES DE LA FILA SON LOS MISMOS QUE LOS DEL RÓTULO ───────────
//
// `indicesDeFila` decide a qué pin de la placa se ancla cada cable; los `{0}` y
// `{0-6}` del `rol` deciden qué pin IMPRIME la hoja al lado. Son dos cuentas
// distintas sobre el mismo dato, y si se separan el cable va a un agujero y el
// rótulo de al lado dice otro — las dos cosas perfectamente escritas. Ése es el
// bug de `plantilla-semaforo-protoboard.html`, y acá se ataja antes de existir.
//
// MUTACIÓN QUE MATA: en `indicesDeFila`, no sumar `cantidad` (usar `k++`). El
// teclado pasa a anclar sus columnas a {4..7} según el rótulo y a {1..4} según
// el índice, y este test lo dice.
test("cables: los índices con que se ancla cada fila son los mismos que los del rótulo", () => {
  for (const tipo of TIPOS()) {
    const def = ns.COMPONENTES[tipo]
    const idx = ns.indicesDeFila(def.pines)
    def.pines.forEach((pin, i) => {
      if (pin.clase === "fijo") {
        assert.equal(idx[i], null, `${tipo}/"${pin.nombre}": es un pin fijo y no debería consumir pines de la placa`)
        return
      }
      const rango = pin.rol.match(/\{(\d+)-(\d+)\}/)
      const solo = pin.rol.match(/\{(\d+)\}/)
      const delRotulo = rango
        ? Array.from({ length: Number(rango[2]) - Number(rango[1]) + 1 }, (_, j) => Number(rango[1]) + j)
        : solo
          ? [Number(solo[1])]
          : null
      assert.ok(delRotulo, `${tipo}/"${pin.nombre}": es un pin de señal y su rol "${pin.rol}" no nombra ningún {n}`)
      assert.deepEqual(
        [...idx[i]],
        delRotulo,
        `${tipo}/"${pin.nombre}": el cable se ancla a los pines ${idx[i]} y el rótulo de al lado imprime los ${delRotulo}`,
      )
    })
  }
})

// ── 5. EL ANCLAJE NO PUEDE CONTRADECIR LOS `signals` DE LA PIEZA ──────────
//
// Los tests de arriba prueban que el nombre EXISTA. Éste prueba que sea el que
// va, en la única dimensión que una máquina puede juzgar: las piezas publican
// `signals` — su propia declaración de qué ES cada pin — y el catálogo publica a
// qué RIEL va cada fila. Son dos fuentes independientes sobre lo mismo.
//
// La regla es "no contradecir", no "confirmar", y la diferencia es a propósito:
// un montón de pines legítimos vienen con `signals: []` (el cátodo del LED, las
// patas del buzzer, el COM del RGB). Exigir confirmación ahí obligaría a
// declarar sin anclaje una docena de cables que están perfectos. Silencio no es
// contradicción.
//
// MUTACIONES QUE MATAN: cambiar el OLED para que "SDA" ancle a `CLK` y "SCL" a
// `DATA` (los dos nombres existen, así que el test 2 no los ve). O anclar la
// "Alimentación" del servo a `GND` en vez de `V+`.
const CONTRADICE = {
  GND: (s) => s.type === "power" && s.signal === "VCC",
  V5: (s) => s.type === "power" && s.signal === "GND",
  V3: (s) => s.type === "power" && s.signal === "GND",
  VLOGICA: (s) => s.type === "power" && s.signal === "GND",
  SDA: (s) => s.type === "i2c" && s.signal === "SCL",
  SCL: (s) => s.type === "i2c" && s.signal === "SDA",
}

test("cables: el pin de la pieza no contradice el riel al que va la fila", () => {
  let comparados = 0
  for (const tipo of TIPOS()) {
    const def = ns.COMPONENTES[tipo]
    const porNombre = new Map(pinesDePieza(def.tag).pines.map((p) => [p.name, p]))
    for (const pin of def.pines) {
      const anclas = ns.anclajesDe(pin)
      // Sólo las filas fijas dicen a qué riel van; las de señal van al pin que
      // les tocó, que no tiene un rol eléctrico fijo.
      if (!anclas || pin.clase !== "fijo" || typeof pin.destino !== "string") continue
      const rompe = CONTRADICE[pin.destino]
      if (!rompe) continue
      for (const n of anclas) {
        const p = porNombre.get(n)
        assert.ok(p, `${tipo}/"${pin.nombre}": ancla a "${n}" y ${def.tag} no lo tiene`)
        const senales = p.signals ?? []
        if (senales.length === 0) continue // la pieza no dice nada: no contradice
        comparados++
        const mala = senales.find(rompe)
        assert.ok(
          !mala,
          `${tipo}/"${pin.nombre}": la fila va al riel ${pin.destino} y el pin "${n}" de ${def.tag} se declara ${JSON.stringify(mala)}. Una de las dos fuentes está mal, y el cable se dibuja prolijo igual.`,
        )
      }
    }
  }
  assert.ok(comparados >= 15, `sólo se compararon ${comparados} pines con signals: el barrido se está salteando todo`)
})

// ── 6. EN UN MÓDULO I2C, EL ANCLAJE ES TODO O NADA ───────────────────────
//
// Éste es el que ataja el caso que más me costó, y vale la pena el párrafo.
//
// El LCD del catálogo es el módulo CON MOCHILA I2C: cuatro cables, VCC GND SDA
// SCL, que salen de UN header de cuatro pines pegado atrás. La pieza que se
// instancia es el display PARALELO, con sus 16 pines. Ahora bien: `VDD` y `VSS`
// SÍ existen en esa pieza, y son alimentación y masa de verdad. O sea que anclar
// "VCC"→`VDD` y "GND"→`VSS` pasa el test 2 (los nombres existen) y pasa el test
// 5 (los signals dicen power/VCC y power/GND, que es justo lo que la fila pide).
// Y sin embargo manda al pibe al pin 2 del header paralelo, que es el header que
// la mochila TAPA: los cuatro cables no van ahí.
//
// Lo que sí se puede afirmar sin adivinar: los cuatro cables de un módulo I2C
// salen del MISMO conector. Si dos se pueden nombrar en la pieza y dos no, no es
// que falten dos nombres — es que la pieza dibuja otro conector, y los dos que
// "cerraron" cerraron por casualidad de nombre. Todo o nada.
//
// MUTACIÓN QUE MATA: cambiar el `{ sinAnclaje }` del "VCC" del LCD por "VDD".
test("cables: en un componente I2C se anclan las cuatro puntas o ninguna", () => {
  let modulos = 0
  for (const tipo of TIPOS()) {
    const def = ns.COMPONENTES[tipo]
    const bus = def.pines.filter((p) => p.clase === "fijo" && (p.destino === "SDA" || p.destino === "SCL"))
    if (bus.length === 0) continue
    modulos++
    assert.equal(bus.length, 2, `${tipo}: un módulo I2C tiene UN SDA y UN SCL, y éste declara ${bus.length} filas de bus`)
    // Las cuatro puntas del conector: el bus más la alimentación y la masa.
    const conector = def.pines.filter(
      (p) => p.clase === "fijo" && typeof p.destino === "string" && ["SDA", "SCL", "GND", "V5", "V3", "VLOGICA"].includes(p.destino),
    )
    const anclados = conector.filter((p) => ns.anclajesDe(p) != null)
    assert.ok(
      anclados.length === 0 || anclados.length === conector.length,
      `${tipo}: de las ${conector.length} puntas del conector I2C hay ${anclados.length} ancladas (${anclados.map((p) => p.nombre).join(", ")}) y el resto declaradas sin anclaje. Los cuatro cables de un módulo I2C salen del MISMO header: si dos se pueden nombrar en ${def.tag} y dos no, los dos que cerraron cerraron por casualidad de nombre y apuntan a otro conector.`,
    )
  }
  assert.ok(modulos >= 3, `el barrido encontró ${modulos} componentes I2C: se está salteando el catálogo`)
})
