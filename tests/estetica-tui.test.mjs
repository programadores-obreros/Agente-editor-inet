// ============================================================================
// La estética del TUI: lo que se dibuja tiene que EXISTIR en la consola del aula.
//
// De dónde sale este archivo. En una notebook real con Windows 10 el logo del
// splash salía hecho de signos de pregunta: el robot estaba dibujado con
// box-drawing de trazo grueso (┏ ━ ┓ ┃ ┗ ┛ ┻ ╻) y la viñeta del tip era ●. La
// captura mostraba un patrón exacto: se veía bien todo lo que está en las tablas
// OEM de Windows (CP437 y CP850: █ y · salían perfectos) y salía «?» todo lo
// que no. El comentario del plugin decía que esos caracteres "están en Consolas";
// nadie lo había mirado en una consola de verdad.
//
// Qué custodia:
//   1. que el plugin del logo, fuera de los comentarios, sólo use caracteres que
//      están en CP437 Y en CP850 (la consola argentina usa CP850);
//   2. que los mapas de píxeles del robot y de las letras estén bien formados
//      (si una fila queda más corta, el dibujo se corre y nadie se entera);
//   3. que el tema no referencie un color que no existe.
//
// El guardián se prueba a sí mismo (test 2): un chequeo que no puede fallar da
// falsa tranquilidad. Verificado además por mutación: devolviendo la viñeta ● al
// plugin, el test 1 se pone rojo.
//
// Lo que este archivo NO prueba: cómo se ve. Eso se miró corriendo OpenCode
// 1.18.18 con el plugin puesto, en Linux. En Windows no se probó.
// ============================================================================
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const plugin = readFileSync(join(raiz, "opencode", "plugins", "tecnia-logo.tsx"), "utf8")
const tema = JSON.parse(readFileSync(join(raiz, "opencode", "themes", "tecnia-violet.json"), "utf8"))

// Caracteres no ASCII que están en CP437 Y en CP850 y que tiene sentido usar acá.
// La lista se calculó codificando cada uno en las dos tablas (Python,
// `ch.encode("cp437")` y `ch.encode("cp850")`); Node no trae esas tablas, por eso
// va escrita. Ojo con ▌ ▐: están en CP437 pero NO en CP850, por eso no figuran.
const SEGUROS = new Set([
  ..."áéíóúñÑüÜ¿¡",
  ..."·«»",
  ..."█▀▄░▒▓■",
  ..."─│┌┐└┘├┤┬┴┼",
  ..."═║╔╗╚╝╠╣╦╩╬",
])

// Saca los comentarios, que es donde se cuenta la historia con los caracteres
// viejos. Los `//` de una URL (https://...) no son comentario: el que abre un
// comentario no viene después de «:».
function sinComentarios(codigo) {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function caracteresQueNoSalen(codigo) {
  const malos = new Set()
  for (const ch of sinComentarios(codigo)) {
    if (ch.codePointAt(0) > 0x7e && !SEGUROS.has(ch)) malos.add(ch)
  }
  return [...malos]
}

function describir(lista) {
  return lista.map((c) => `${c} (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")})`).join(", ")
}

test("1. el plugin del logo sólo dibuja con caracteres que están en CP437 y CP850", () => {
  const malos = caracteresQueNoSalen(plugin)
  assert.deepEqual(malos, [], `en la consola de Windows estos salen como «?»: ${describir(malos)}`)
})

test("2. el guardián marca lo que tiene que marcar (y no lo que está en un comentario)", () => {
  // Los ocho del robot viejo y la viñeta vieja: todos tienen que saltar.
  for (const ch of "┏━┓┃┗┛┻╻●") {
    assert.deepEqual(caracteresQueNoSalen(`const x = "${ch}"`), [ch], `no marca ${describir([ch])}`)
  }
  // ▌ está en CP437 pero no en CP850: también salta.
  assert.deepEqual(caracteresQueNoSalen('const x = "▌"'), ["▌"])
  // En un comentario no molesta: ahí se cuenta la historia.
  assert.deepEqual(caracteresQueNoSalen("// antes era ┏━┓ y ●\nconst x = 1 /* ┃ */"), [])
  // Una URL no es un comentario: lo que viene después tiene que seguir mirándose.
  assert.deepEqual(caracteresQueNoSalen('const u = "https://x.ar"; const y = "●"'), ["●"])
  // Y los seguros pasan.
  assert.deepEqual(caracteresQueNoSalen('const x = "█▀▄■ · escribí ¿cómo?"'), [])
})

// Lee del fuente un arreglo de strings: `const NOMBRE = [ "..", ".." ]`.
function arreglo(nombre) {
  const m = plugin.match(new RegExp(`const ${nombre} = \\[([\\s\\S]*?)\\n\\]`))
  assert.ok(m, `no encuentro el arreglo ${nombre} en el plugin`)
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1])
}

test("3. el robot es un mapa de píxeles bien formado", () => {
  const robot = arreglo("ROBOT_PX")
  assert.ok(robot.length >= 8, "el robot quedó sin filas")
  // Dos filas de píxeles hacen un renglón: con una cantidad impar, la última
  // fila se dibuja sola y el robot queda cortado por la mitad.
  assert.equal(robot.length % 2, 0, "el robot tiene una cantidad impar de filas de píxeles")
  const anchos = new Set(robot.map((f) => f.length))
  assert.equal(anchos.size, 1, `las filas del robot no miden lo mismo: ${[...anchos].join(", ")}`)
  for (const fila of robot) assert.match(fila, /^[.VHEMG]+$/, `tinta desconocida en «${fila}»`)
  // Las cinco partes del ícono están: baldosa, cabeza, ojos, boca y antena.
  for (const tinta of "VHEMG") assert.ok(robot.some((f) => f.includes(tinta)), `al robot le falta la tinta ${tinta}`)
  // El degradé de la baldosa tiene un color por fila: si se cuenta a mano y el
  // robot cambia de alto, las filas de más quedan sin color y nadie avisa.
  assert.match(plugin, /const FILAS_ROBOT = ROBOT_PX\.length\b/, "las filas del degradé no salen del alto del robot")
  // Simétrico: el del ícono lo es, y un píxel corrido se nota enseguida.
  for (const fila of robot) assert.equal(fila, [...fila].reverse().join(""), `fila no simétrica: «${fila}»`)
})

test("4. están todas las letras de TECNIA BOT, de 6 píxeles de alto y sin filas cortas", () => {
  const bloque = plugin.match(/const LETRAS: Record<string, string\[\]> = \{([\s\S]*?)\n\}/)
  assert.ok(bloque, "no encuentro LETRAS en el plugin")
  const letras = {}
  for (const m of bloque[1].matchAll(/^\s*([A-Z]): \[(.*)\],?$/gm)) {
    letras[m[1]] = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1])
  }
  for (const letra of new Set("TECNIABOT")) {
    const forma = letras[letra]
    assert.ok(forma, `falta la letra ${letra}`)
    assert.equal(forma.length, 6, `la letra ${letra} no tiene 6 filas`)
    assert.equal(new Set(forma.map((f) => f.length)).size, 1, `la letra ${letra} tiene filas de distinto ancho`)
    for (const fila of forma) assert.match(fila, /^[.#]+$/, `la letra ${letra} tiene algo que no es píxel: «${fila}»`)
  }
})

// Toda referencia del tema es un hex o el nombre de un color definido. OpenCode
// no avisa: un nombre mal escrito deja ese color en el de fábrica y listo.
function referenciasRotas(t) {
  const rotas = []
  for (const [clave, par] of Object.entries(t.theme)) {
    for (const modo of ["dark", "light"]) {
      const v = par[modo]
      if (typeof v !== "string") rotas.push(`${clave}.${modo}: falta`)
      else if (!/^#[0-9a-f]{6}$/i.test(v) && !(v in t.defs)) rotas.push(`${clave}.${modo}: ${v}`)
    }
  }
  return rotas
}

test("5. el tema no referencia colores que no existen, en oscuro ni en claro", () => {
  assert.deepEqual(referenciasRotas(tema), [])
  for (const [nombre, hex] of Object.entries(tema.defs)) {
    assert.match(hex, /^#[0-9a-f]{6}$/i, `el color ${nombre} no es un hex: ${hex}`)
  }
  // El guardián se prueba a sí mismo.
  const roto = { defs: { a: "#000000" }, theme: { x: { dark: "a", light: "noExiste" }, y: { dark: "#12345" } } }
  assert.deepEqual(referenciasRotas(roto), ["x.light: noExiste", "y.dark: #12345", "y.light: falta"])
})

test("6. el rojo queda para los errores: una variable de código no se pinta como error", () => {
  // Antes syntaxVariable usaba el mismo rojo que `error`: en un sketch de Arduino
  // cada nombre de variable parecía un aviso de que algo estaba mal.
  assert.notEqual(tema.theme.syntaxVariable.dark, tema.theme.error.dark)
  assert.notEqual(tema.theme.syntaxVariable.light, tema.theme.error.light)
})

test("7. los ejemplos del cuadro de texto están en castellano y el aviso de la key sigue completo", () => {
  const ejemplos = arreglo("EJEMPLOS")
  assert.ok(ejemplos.length >= 3, "quedaron menos de tres ejemplos")
  for (const e of ejemplos) {
    assert.doesNotMatch(e, /\b(fix|tests?|codebase|tech stack)\b/i, `ejemplo en inglés: «${e}»`)
  }
  // El rediseño no toca lo que el aviso dice: este producto lo usan menores.
  assert.match(plugin, /por tiempo\s+limitado/, "el aviso ya no dice que Big Pickle es por tiempo limitado")
  assert.match(plugin, /puede usarse para mejorar el modelo/, "el aviso ya no dice que el chat puede usarse")
  assert.match(plugin, /aistudio\.google\.com\/apikey/, "el aviso ya no dice dónde sacar la key")
})
