// El prompt le enseña al bot CUÁNDO usar la tool `pagina` y cuándo no.
//
// POR QUÉ ESTE ARCHIVO. La tool `pagina` existía con su permiso en el frontmatter
// (`pagina: "allow"`) pero el prompt no tenía ninguna regla que dijera cuándo usarla.
// Un modelo con una tool y sin regla hace una de dos: no la usa nunca, o la usa para
// todo (la guía, el esquema del circuito, la hoja del proyecto, una duda de una línea).
// Lo que se prueba acá es que el TEXTO que lee el modelo trae esa regla, con sus
// fronteras, sus fuentes y sus modales, en el lugar donde se lee junto a la de
// circuitos. Que el modelo de verdad la siga NO se puede probar acá: eso es el guion
// de prueba manual con el bot real.
//
// Cada test busca DENTRO de la sección nueva (no en todo el prompt): varias de estas
// frases existen en otras reglas («UNA pregunta», `abrir: true`, «nunca escribís
// HTML»), y un test que busca en todo el prompt sigue verde aunque la sección nueva
// las pierda. Eso lo cazó la verificación por mutación de este mismo archivo.
//
// MUTACIONES probadas con el trabajo commiteado (ver el informe del commit): borrar de
// la sección cada frase que un test protege, mover la sección a otro lugar, sacar
// `pagina` de la lista de tools que se ejecutan en el turno, devolverle a `imprimible`
// «algo para repartir», y cambiar la descripción de `abrir` en la tool a «Por defecto
// true». Todas ponen rojo un test de acá.
//
// Corre con: node --test tests/paginas-prompt.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (rel) => readFileSync(join(REPO, rel), "utf8")
const prompt = leer("opencode/agent/tecnia-bot.md")
const toolSrc = leer("opencode/tool/pagina.ts")

const TITULO = "## REGLA CRÍTICA — páginas para leer, repartir o proyectar"

/** La sección de páginas, hasta el próximo título de nivel 2. */
function seccionPaginas() {
  const i = prompt.indexOf(TITULO)
  assert.ok(i >= 0, `no está la sección «${TITULO}» en el prompt`)
  const fin = prompt.indexOf("\n## ", i + TITULO.length)
  return prompt.slice(i, fin < 0 ? undefined : fin)
}
/** Los espacios y saltos de línea del markdown no cuentan para comparar frases. */
const plano = (s) => s.replace(/\s+/g, " ")

test("la sección existe y va DESPUÉS de circuitos visuales y ANTES de diseño curricular", () => {
  const iCircuitos = prompt.indexOf("## REGLA CRÍTICA — circuitos visuales")
  const iPaginas = prompt.indexOf(TITULO)
  const iCurricular = prompt.indexOf("## REGLA CRÍTICA — diseño curricular")
  assert.ok(iCircuitos >= 0 && iCurricular >= 0, "no encontré las secciones vecinas (¿se renombraron?)")
  assert.ok(iPaginas > iCircuitos, "la regla de páginas tiene que ir después de la de circuitos visuales")
  assert.ok(iPaginas < iCurricular, "la regla de páginas tiene que ir antes de la de diseño curricular")
  // Y es UNA sección: no quedó una copia vieja en otro lado.
  assert.equal(prompt.split(TITULO).length - 1, 1, "la sección aparece más de una vez")
})

test("dice cuándo SÍ: guía, apunte, explicación, resumen de la clase, consigna de TP, instructivo", () => {
  const s = plano(seccionPaginas())
  assert.match(s, /es la tool `pagina`/)
  for (const pedido of ["guía de clase", "apunte", "explicación para los alumnos", "resumen de la clase", "consigna de un trabajo práctico", "instructivo paso a paso"]) {
    assert.ok(s.includes(pedido), `la regla no nombra «${pedido}»`)
  }
  assert.match(s, /nunca escribís HTML/, "no dice que el bot no escribe el HTML")
  assert.match(s, /el diseño no lo elegís/, "no dice que el diseño no lo elige el bot")
})

test("nombra las fronteras: vista-fisica, circuito, ficha, imprimible y el chat", () => {
  const s = plano(seccionPaginas())
  assert.match(s, /`pagina` no dibuja y no es el proyecto/)
  assert.match(s, /\| ver o cambiar el proyecto del alumno \| `vista-fisica`/, "falta la frontera con vista-fisica")
  assert.match(s, /\| un esquema o una lámina del circuito \| `circuito` \|/, "falta la frontera con circuito")
  assert.match(s, /\| la hoja de un componente que ya tiene ficha \| `ficha` \|/, "falta la frontera con ficha")
  assert.match(s, /\| la hoja de un PROYECTO: materiales \+ conexiones \+ código \| `imprimible` \|/, "falta la frontera con imprimible")
  assert.match(s, /\| una duda [^|]*\| el chat; la página la ofrecés después \|/, "falta la frontera con el chat")
  assert.match(s, /Ante la duda entre chat y página: chat/, "falta el desempate a favor del chat")
})

test("dice de dónde salen pines y conexiones, y que sin fuente la página va sin conexiones", () => {
  const s = plano(seccionPaginas())
  assert.match(s, /NADA de la página sale de tu memoria/)
  assert.match(s, /de `proyecto-fisico leer` si es el proyecto del alumno/)
  assert.match(s, /de la tabla del `circuito` que generaste/)
  assert.match(s, /de la ficha de `proyectos-inet`/)
  assert.match(s, /la página va SIN conexiones y lo dice/)
})

test("el código del proyecto físico no va en la página: coherente con la sección «Código» de la ventana", () => {
  const s = plano(seccionPaginas())
  assert.match(s, /El código del proyecto físico NO va en la página/)
  assert.match(s, /sección «Código»/, "no manda a la ventana a ver el código")
  assert.match(s, /sólo si ya lo compilaste en esta charla/, "el código de ejemplo no queda atado a la regla de compilar antes de mostrar")
  // Y la regla del programa a la que remite sigue existiendo con ese nombre.
  assert.match(prompt, /## REGLA CRÍTICA — programa del proyecto físico/)
  assert.match(plano(prompt), /está completo en la ventana, en la sección «Código»/)
})

test("el contenido curricular sale sólo del skill diseno-curricular", () => {
  assert.match(plano(seccionPaginas()), /\*\*Contenido curricular\*\* \(materias, saberes, ejes\): sólo del skill `diseno-curricular`/)
})

test("activa el skill `paginas` antes de llamar a la tool", () => {
  assert.match(plano(seccionPaginas()), /Antes de llamarla, activá el skill `paginas`/)
})

test("respeta las reglas de conversación: una pregunta, contar las secciones, una cosa por turno", () => {
  const s = plano(seccionPaginas())
  assert.match(s, /Si falta el tema, el curso o la placa, hacé UNA pregunta/)
  assert.match(s, /contá en UNA línea qué secciones va a tener/)
  assert.match(s, /\*\*Una cosa por turno\*\*/)
})

test("no la abre sola: cuenta, ofrece abrirla y con el sí la llama con `abrir: true`", () => {
  const s = plano(seccionPaginas())
  assert.match(s, /No la abras sola/)
  assert.match(s, /Llamala sin `abrir`, contá qué quedó y ofrecé abrirla/)
  assert.match(s, /la volvés a llamar igual pero con `abrir: true`/)
})

test("afirma sólo lo que la tool devolvió: «armé» con la ruta, nunca «abierta»", () => {
  const s = plano(seccionPaginas())
  assert.match(s, /Decí «armé la página» SÓLO si la tool te devolvió la ruta/)
  assert.match(s, /Si rechazó algo, contá qué bloque y por qué, corregilo/)
  assert.match(s, /Nunca digas que la página está «abierta»/)
})

test("las líneas viejas del prompt ya no contradicen a `pagina`", () => {
  // La lista de tools que se ejecutan en el mismo turno la incluye.
  const lista = /Cuando corresponda usar una tool \(([^)]*)\)/.exec(prompt)
  assert.ok(lista, "no encontré la lista de tools que se ejecutan en el turno")
  assert.ok(lista[1].includes("`pagina`"), "la lista de tools que se ejecutan en el turno no nombra `pagina`")

  // `imprimible` queda angostado a la hoja del proyecto: sin «algo para repartir» suelto.
  const i = prompt.indexOf("usá el tool `imprimible`")
  assert.ok(i >= 0, "no encontré el párrafo de imprimible")
  const parrafo = prompt.slice(prompt.lastIndexOf("\n", i), prompt.indexOf("\n", i))
  assert.match(parrafo, /\*\*materiales \+ conexiones \+ código\*\*/, "imprimible no quedó acotado a la hoja del proyecto")
  assert.doesNotMatch(parrafo, /algo \*\*para repartir\*\*/, "imprimible sigue agarrando cualquier cosa «para repartir»")
  assert.match(parrafo, /es `pagina`/, "el párrafo de imprimible no deriva lo demás a pagina")

  // `circuito` «para imprimir» no se lleva lo que no es un circuito.
  const j = prompt.indexOf('"para mostrar o imprimir", usá el tool `circuito`')
  assert.ok(j >= 0, "no encontré el párrafo de circuito en «Uso de skills»")
  const parrafoCircuito = prompt.slice(j, prompt.indexOf("\n", j))
  assert.match(parrafoCircuito, /Si lo que quieren imprimir NO es un circuito[^\n]*es `pagina`/)

  // Reabrir un archivo ya generado incluye las páginas.
  const k = prompt.indexOf("## Reabrir un archivo ya generado")
  const reabrir = prompt.slice(k, prompt.indexOf("\n## ", k + 5))
  assert.match(reabrir, /`circuito`, `imprimible` o `pagina` YA generó/)
  assert.match(reabrir, /llamá `pagina` con el mismo contenido y `abrir: true`/)

  // Y «Uso de skills» nombra el skill para el pedido.
  const u = prompt.indexOf("## Uso de skills")
  const uso = prompt.slice(u, prompt.indexOf("\n## ", u + 5))
  assert.match(uso, /activá el skill `paginas` y usá el tool `pagina`/)
})

test("la tool no contradice al prompt sobre `abrir`: por defecto no abre, y su respuesta ofrece abrir", () => {
  // El prompt dice «no la abras sola; con el sí, `abrir: true`». Si la tool dijera que
  // abre por defecto, o su respuesta dijera «ya la abrí», el modelo tendría dos verdades.
  const describeAbrir = /abrir: tool\.schema\.boolean\(\)\.optional\(\)\.describe\("([^"]*)"\)/.exec(toolSrc)
  assert.ok(describeAbrir, "no encontré la descripción del argumento `abrir` en pagina.ts")
  assert.match(describeAbrir[1], /Por defecto false/, "la descripción de `abrir` ya no dice que por defecto es false")
  // La validación de verdad: sin `abrir`, no abre.
  assert.match(toolSrc, /let abrir = false\n/, "validarPagina ya no arranca con abrir = false")
  // La descripción general no promete abrir.
  const d0 = toolSrc.indexOf("description: `")
  const d1 = toolSrc.indexOf("`,\n  args:", d0)
  assert.ok(d0 >= 0 && d1 > d0, "no encontré la descripción de la tool")
  assert.doesNotMatch(toolSrc.slice(d0, d1),/\b(?:la abre|se abre|abre el navegador|abre en el navegador)\b/i, "la descripción promete abrir")
  // Y lo que contesta sin `abrir` es justo lo que el prompt pide: ofrecer.
  assert.match(toolSrc, /ofrecele abrirla \(llamá de nuevo con abrir: true\)/)
})
