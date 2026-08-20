// Smoke tests del tool `ficha` (opencode/tool/ficha.ts).
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).
//
// Se prueba `buscarFicha`, que es la parte que puede equivocarse: resolver lo
// que dijo el docente ("el LDR", "09", "potenciómetro") al archivo correcto.
// Abrir la hoja no se prueba acá — es una llamada al sistema operativo, y la
// misma que ya usan `imprimible` y `ayuda`.
//
// Mismo truco que memoria.test.mjs: se reescribe el import del plugin a un mock,
// así el módulo se puede importar sin instalar dependencias.

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-ficha-test")

let buscarFicha

/**
 * Las hojas que instala la capa, LEÍDAS DE LA CARPETA REAL.
 *
 * ANTES ERA UNA LISTA ESCRITA A MANO, y no probaba nada. Cuando las fichas
 * pasaron de PDF a HTML —el instalador ahora lleva las animadas— el tool cambió,
 * la carpeta cambió, y esta lista siguió diciendo `.pdf`. Los 106 tests pasaron
 * igual, en verde, describiendo un producto que ya no existía.
 *
 * Peor: se comprobó por mutación. Con el tool devuelto a `.pdf` —o sea, incapaz
 * de encontrar una sola hoja de las que realmente se instalan— los tests seguían
 * pasando. Una lista de fixtures que no se contrasta con la realidad es una
 * segunda fuente de verdad, y las segundas fuentes se desincronizan.
 *
 * Leyendo la carpeta, el test no puede mentir sobre qué hay ahí.
 */
const HOJAS_DIR = join(REPO, "opencode", "skills", "fichas", "hojas")
const HOJAS = readdirSync(HOJAS_DIR).sort()

/**
 * El archivo real de una ficha, sea cual sea su extensión.
 *
 * Las expectativas no pueden escribir ".pdf" ni ".html": lo que se prueba acá es
 * que `buscarFicha` resuelva «el LDR» a la hoja del LDR, y eso no cambia porque
 * cambie el formato. Atar cada assert a una extensión convierte un cambio de
 * empaquetado en 12 tests rojos que no señalan ningún error real.
 */
const hoja = (base) => {
  const f = HOJAS.find((h) => h.startsWith(base + "."))
  if (!f) throw new Error(`No existe ninguna hoja "${base}" en ${HOJAS_DIR}`)
  return f
}

before(async () => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/ficha.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "ficha.ts"), src)
  buscarFicha = (await import(join(OUT, "ficha.ts"))).buscarFicha
})

test("encuentra por número con cero adelante", () => {
  assert.equal(buscarFicha("09", HOJAS), hoja("09-ldr"))
})

test("encuentra por número sin cero adelante", () => {
  // El docente dice "la 9", no "la 09".
  assert.equal(buscarFicha("9", HOJAS), hoja("09-ldr"))
})

test("encuentra por nombre del componente", () => {
  assert.equal(buscarFicha("ldr", HOJAS), hoja("09-ldr"))
  assert.equal(buscarFicha("servo", HOJAS), hoja("04-servo"))
  assert.equal(buscarFicha("zumbador", HOJAS), hoja("15-zumbador"))
})

test("aguanta las tildes, que el docente sí escribe", () => {
  assert.equal(buscarFicha("potenciómetro", HOJAS), hoja("10-potenciometro"))
  assert.equal(buscarFicha("ultrasónico", HOJAS), hoja("11-ultrasonico"))
})

test("no le importan las mayúsculas ni los espacios de más", () => {
  assert.equal(buscarFicha("  LDR  ", HOJAS), hoja("09-ldr"))
  assert.equal(buscarFicha("PIR", HOJAS), hoja("12-pir"))
})

test("acepta el nombre del archivo entero", () => {
  assert.equal(buscarFicha("09-ldr.pdf", HOJAS), hoja("09-ldr"))
  assert.equal(buscarFicha("09-ldr", HOJAS), hoja("09-ldr"))
})

test("con varios candidatos gana el más corto", () => {
  // "corriente" está en dos. Que devuelva UNA es mejor que devolver nada:
  // el agente ve cuál abrió y puede corregir. Alterna es la más corta.
  assert.equal(buscarFicha("corriente", HOJAS), hoja("06-corriente-alterna"))
  // Y con el nombre completo no hay ambigüedad.
  assert.equal(buscarFicha("corriente-continua", HOJAS), hoja("05-corriente-continua"))
})

test("devuelve null si no existe, en vez de inventar una", () => {
  assert.equal(buscarFicha("transistor", HOJAS), null)
  assert.equal(buscarFicha("99", HOJAS), null)
  assert.equal(buscarFicha("", HOJAS), null)
})

test("encuentra la del ESP32, que no tiene número", () => {
  assert.equal(buscarFicha("esp32", HOJAS), hoja("borrador-esp32-devkit"))
})

test("la descripción del tool le prohíbe pegar la ruta", async () => {
  // El defecto que originó este tool: el agente pegaba la ruta del PDF y le
  // pedía al docente que navegara hasta .config\opencode\skills\fichas\hojas\.
  // Si esta instrucción se cae de la descripción, el defecto vuelve.
  const mod = (await import(join(OUT, "ficha.ts"))).default
  assert.match(mod.description, /no le pegues la ruta/i)
  assert.match(mod.description, /ABRE/)
})

test("la descripción también prohíbe LEER el pdf", async () => {
  // Visto en uso real: sin el tool instalado, el modelo agarró `read` sobre el
  // PDF y tardó 36 segundos para no obtener nada. Con el tool disponible podría
  // volver a elegirlo si nadie se lo prohíbe.
  const mod = (await import(join(OUT, "ficha.ts"))).default
  assert.match(mod.description, /NO leas el PDF/i)
})

test("la ruta se convierte a file:// con las barras dadas vuelta", async () => {
  // En Windows `C:\Users\x\f.pdf` tiene que viajar como `file:///C:/Users/x/f.pdf`
  // o el navegador no la abre.
  const { comoUrl } = await import(join(OUT, "ficha.ts"))
  assert.equal(comoUrl("C:\\Users\\x\\09-ldr.pdf"), "file:///C:/Users/x/09-ldr.pdf")
  assert.equal(comoUrl("/home/x/09-ldr.pdf"), "file:///home/x/09-ldr.pdf")
})

test("el atajo de imprimir cambia según el sistema", async () => {
  // En Mac es Cmd+P. Decirle "Ctrl+P" a alguien en una Mac es decirle mal, y
  // quien recién empieza no lo traduce solo.
  const src = readFileSync(join(REPO, "opencode/tool/ficha.ts"), "utf8")
  assert.match(src, /darwin.*Cmd \+ P/s, "el tool tiene que decir Cmd+P en macOS")
  assert.doesNotMatch(
    src,
    /apretá \*\*Ctrl \+ P\*\*/,
    "el mensaje al docente no puede tener el atajo escrito a mano",
  )
})

test("no promete que la ventana se abrió: deja la ruta por las dudas", async () => {
  // `start` no falla aunque no abra nada (programa asociado desinstalado, por
  // ejemplo). Prometer "te la abrí" y que no pase nada deja al docente mirando
  // una pantalla vacía mientras el bot le asegura que está todo bien.
  const src = readFileSync(join(REPO, "opencode/tool/ficha.ts"), "utf8")
  assert.match(src, /Si no se te abrió ninguna ventana/i)
})

test("el tool busca la MISMA extensión que la capa instala", () => {
  // El test que faltaba, y que hizo falta descubrir por mutación.
  //
  // El tool filtra la carpeta por extensión. Si esa extensión no es la de los
  // archivos que se instalan, no encuentra NINGUNA hoja: el docente pide la del
  // LDR y el bot le contesta que no hay fichas. Nada tira error, nada se rompe
  // en los tests, y el producto queda mudo.
  //
  // Pasó de verdad al cambiar de PDF a HTML.
  const codigo = readFileSync(join(REPO, "opencode", "tool", "ficha.ts"), "utf8")
  const filtro = codigo.match(/endsWith\("(\.\w+)"\)/)
  assert.ok(filtro, "el tool ya no filtra por extensión; revisá este test")

  const instaladas = [...new Set(HOJAS.map((h) => h.slice(h.lastIndexOf("."))))]
  assert.deepEqual(
    instaladas,
    [filtro[1]],
    `el tool busca "${filtro[1]}" y la capa instala ${instaladas.join(", ")}`,
  )
})

test("encuentra las fichas de nombre compuesto dichas COMO SE HABLAN", () => {
  // El defecto: los archivos se llaman `06-corriente-alterna.html`, pero el
  // docente dice "corriente alterna" y el agente le pasa eso tal cual. La
  // comparación era "corriente alterna" contra "corriente-alterna", y no daba.
  //
  // La ficha existía, estaba instalada, y el bot decía que no la encontraba.
  //
  // No era un caso de borde: se llevaba puestas SEIS de las diecisiete. Todas
  // las de nombre de más de una palabra, que son justo las de los temas que un
  // docente nombra hablando y no por número.
  const conEspacios = [
    ["corriente alterna", "06"],
    ["corriente continua", "05"],
    ["entradas y salidas", "07"],
    ["arduino uno", "01"],
    ["sensor shield", "02"],
    ["tecnia bot", "16"],
  ]

  for (const [dicho, numero] of conEspacios) {
    const hallado = buscarFicha(dicho, HOJAS)
    assert.ok(hallado, `«${dicho}» no encontró ninguna ficha`)
    assert.ok(
      hallado.startsWith(numero + "-"),
      `«${dicho}» resolvió a ${hallado}, y la ficha es la ${numero}`,
    )
  }
})

test("separadores intercambiables: espacio, guion y guion bajo dan lo mismo", () => {
  // El arreglo de arriba se puede escribir de forma estrecha —contemplando sólo
  // el espacio— y volver a fallar con la primera variante que aparezca. El
  // agente reformula lo que dijo el docente, y no siempre igual.
  for (const forma of [
    "corriente alterna",
    "corriente-alterna",
    "corriente_alterna",
    "Corriente Alterna",
    "  corriente   alterna  ",
    "corriente alterna.html",
  ]) {
    assert.equal(
      buscarFicha(forma, HOJAS),
      buscarFicha("06", HOJAS),
      `«${forma}» no resolvió a la misma ficha que el número`,
    )
  }
})

test("y no se aflojó tanto que cualquier cosa encuentre algo", () => {
  // El contrapeso. Tratar todos los separadores como uno solo hace el matcheo
  // más permisivo, y de ahí a que "el sensor de humo" devuelva una ficha
  // cualquiera hay un paso. Una respuesta equivocada con seguridad es peor que
  // "no la tengo": el docente la imprime y la reparte.
  for (const inventado of ["sensor de humo", "acelerometro", "pantalla oled", "---", "   "]) {
    assert.equal(
      buscarFicha(inventado, HOJAS),
      null,
      `«${inventado}» devolvió una ficha, y esa ficha no existe`,
    )
  }
})

test("el SKILL.md describe el formato que realmente se instala", () => {
  // Cuando las fichas pasaron de PDF a HTML —el instalador ahora lleva las
  // animadas— el tool cambió y las hojas cambiaron. El SKILL.md no.
  //
  // Quedó diciéndole al modelo «son PDF de una hoja A4» y «no leas el PDF, es un
  // binario». El modelo actúa sobre eso: es su única descripción del terreno. Y
  // nada se pone rojo, porque un texto desactualizado no rompe ningún proceso.
  //
  // Se contrasta contra la CARPETA, no contra un formato escrito acá: el día que
  // el formato vuelva a cambiar, este test lo obliga a acompañarlo.
  const skill = readFileSync(join(REPO, "opencode/skills/fichas/SKILL.md"), "utf8")

  const extensiones = new Set(
    HOJAS.filter((h) => h.includes(".")).map((h) => h.slice(h.lastIndexOf(".") + 1).toLowerCase()),
  )
  assert.equal(extensiones.size, 1, `las hojas tienen extensiones mezcladas: ${[...extensiones]}`)
  const formato = [...extensiones][0]

  // Sin los bloques de código ni las rutas: ahí los nombres de archivo son
  // legítimos y no son afirmaciones sobre el formato.
  const prosa = skill
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/\|[^\n]*\|/g, "")

  // La afirmación positiva: la prosa nombra el formato real.
  assert.match(prosa.toLowerCase(), new RegExp(formato), `el SKILL.md nunca dice que son ${formato}`)

  // Y la negativa, que es la que se pudre sola: no describe el formato viejo
  // como si fuera el actual. «lo que un PDF no podía hacer» es historia y pasa.
  const afirmaciones = [
    /son (?:archivos )?PDF/i,
    /No leas el PDF/i,
    /lector de PDF/i,
    /Abrir un PDF/i,
  ]
  for (const mala of afirmaciones) {
    assert.doesNotMatch(prosa, mala,
      `El SKILL.md todavía habla de las fichas como PDF, y son ${formato}.\n` +
      `El modelo no mira la carpeta: actúa sobre lo que dice este texto.`)
  }
})
