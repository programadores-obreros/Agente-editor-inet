// La tool `pagina` de punta a punta: escribe, relee, no pisa lo ajeno y no afirma de más.
//
// POR QUÉ ESTE ARCHIVO. `tests/pagina-render.test.mjs` prueba las dos funciones puras.
// Acá se prueba lo que toca el mundo, que es donde una tool puede decir «listo» sin
// haberlo comprobado:
//   - un error de validación NO escribe nada (se mira la carpeta, no la respuesta);
//   - un archivo que no hizo esta tool NO se pisa (se relee su contenido);
//   - el éxito se informa recién después de RELEER el archivo del disco;
//   - sin la hoja de estilos no se escribe una página sin diseño;
//   - del navegador sólo se sabe que se le pidió, o que el pedido falló.
//
// QUÉ SE CARGA. La tool real, copiada a una carpeta temporal con el plugin simulado, en
// `<tmp>/tool/pagina.ts`, con la hoja en `<tmp>/tecniabot-web/diseno/sistema.css`: la
// misma posición relativa que en el repo y en una instalación. Así se prueba de verdad
// que la tool encuentra la hoja a partir de su propia ubicación.
// `Bun.write` y `Bun.spawn` son de mentira: el primero escribe con fs (o MIENTE, cuando
// el test lo pide), el segundo anota el pedido y no abre nada.
//
// MUTACIONES que ponen rojo este archivo (probadas una por una con el trabajo commiteado,
// restaurando sólo `opencode/tool/pagina.ts` después de cada una):
//   - escribir antes de validar, o escribir igual con errores     → «un error de validación no escribe nada»
//   - saltear la relectura (o comparar con `!==` al revés)        → «relee lo escrito»
//   - sacar el chequeo de la marca generator (pisar siempre)      → «no pisa un archivo ajeno»
//   - tratar un archivo propio como ajeno (numerar siempre)       → «reemplaza su propia página»
//   - responder «abierta» / «la abrí»                            → «nunca dice abierta»
//   - devolver «pedida» cuando el lanzador termina con error      → «el pedido al navegador»
//   - pedir el navegador con abrir en false                       → «con abrir en false no llama al navegador»
//   - seguir sin la hoja (CSS vacío)                              → «sin la hoja de estilos»
//   - leer la hoja al importar el módulo en vez de al ejecutar    → «importar la tool no lee la hoja»
//   - sacar el tope de 60 del nombre, o dejar pasar acentos       → «el nombre del archivo»
//   - sacar la ruta de la respuesta, o darla cruda tras file://    → «arma la página»
//   - volver a copiar `e.message` en la respuesta de una escritura fallida,
//     o mandar todos los códigos a la frase genérica                → «si la escritura falla, explica en llano»
//
// LÍMITE HONESTO: nada de esto corre adentro de OpenCode ni con un modelo. El esquema de
// argumentos se mira con el zod real (último test), pero cómo le llega a un modelo Gemini
// una lista de objetos, y si la llena bien, no se puede probar acá. Tampoco se abre un
// navegador: eso se hizo a mano, con Chromium sin ventana.
//
// Corre con: node --test tests/pagina.test.mjs

import { test, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-pagina-test")
const HOJA = join(OUT, "tecniabot-web/diseno/sistema.css")
const HOJA_DEL_REPO = join(REPO, "opencode/tecniabot-web/diseno/sistema.css")
// La carpeta de trabajo lleva un espacio y un numeral A PROPÓSITO. Con una carpeta sin
// caracteres raros, la ruta cruda pegada detrás de `file://` es idéntica a la URL bien
// armada, y el test no distinguía una de otra: la mutación «ruta cruda en vez de URL»
// quedaba verde. Era un test hueco; así se llama la carpeta de un docente de verdad
// («Maria Jose», «3ro B #2»).
const DIR = join(OUT, "carpeta de trabajo #1")

let P
let tool
/** Qué hace el `Bun.write` de mentira en este test. */
let escribir
/** Qué devuelve el `Bun.spawn` de mentira, y qué le pidieron. */
let lanzar
let pedidos

globalThis.Bun = {
  write: async (ruta, contenido) => escribir(ruta, contenido),
  spawn: (cmd) => (pedidos.push(cmd), lanzar(cmd)),
}

before(async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(join(OUT, "tool"), { recursive: true })
  writeFileSync(
    join(OUT, "tool/mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const fuente = readFileSync(join(REPO, "opencode/tool/pagina.ts"), "utf8")
  const src = fuente.replace('/// <reference path="../env.d.ts" />', "").replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  assert.notEqual(src, fuente, "no reemplacé el import del plugin")
  writeFileSync(join(OUT, "tool/pagina.ts"), src)
  P = await import(join(OUT, "tool/pagina.ts"))
  tool = P.default
})

beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })
  rmSync(join(OUT, "tecniabot-web"), { recursive: true, force: true })
  cpSync(join(REPO, "opencode/tecniabot-web/diseno"), join(OUT, "tecniabot-web/diseno"), { recursive: true })
  escribir = (ruta, contenido) => writeFileSync(ruta, contenido)
  lanzar = () => ({ exited: Promise.resolve(0), unref() {} })
  pedidos = []
})

const ARGS = {
  titulo: "Guía del semáforo",
  bloques: [
    { tipo: "seccion", titulo: "Materiales" },
    { tipo: "lista", items: ["3 LEDs", "3 resistencias de 220 Ω"] },
    { tipo: "seccion", titulo: "El programa" },
    { tipo: "codigo", texto: "void setup() {}" },
  ],
}
const ejecutar = (args) => tool.execute(args, { directory: DIR })
const enLaCarpeta = () => readdirSync(DIR).sort()
/**
 * Lo que la tool no puede decir del navegador. Los bordes de palabra van con \p{L} y no
 * con \b: en JavaScript, sin la bandera `u`, la «í» no cuenta como letra y `abrí\b` no
 * coincide nunca. La primera versión de este detector tenía ese defecto y dejaba pasar
 * «Te la abrí»; lo cazó la prueba del propio detector, más abajo.
 */
const AFIRMA_ABIERTA = /(?<!\p{L})(?:abiert[ao]s?|(?:la|se) abrí|(?:la|se) abrió)(?!\p{L})/iu

test("encuentra la hoja de estilos a partir de su propia ubicación", () => {
  assert.equal(P.rutaDelSistemaCss(), HOJA, "tool/ y tecniabot-web/ son hermanas, en el repo y en una instalación")
  const leida = P.leerSistemaCss()
  assert.equal(leida.ok, true)
  assert.equal(leida.css, readFileSync(HOJA_DEL_REPO, "utf8"), "lo que lee es la hoja del repo, entera")
})

test("arma la página, la guarda en la carpeta de trabajo y devuelve la ruta como URL", async () => {
  const r = await ejecutar(ARGS)
  assert.deepEqual(enLaCarpeta(), ["pagina-guia-del-semaforo.html"])
  const archivo = join(DIR, "pagina-guia-del-semaforo.html")
  const enDisco = readFileSync(archivo, "utf8")
  assert.equal(enDisco, P.renderizarPagina(P.validarPagina(ARGS).pagina, readFileSync(HOJA_DEL_REPO, "utf8")), "en el disco está exactamente la página, con la hoja del repo")
  assert.ok(enDisco.includes("<li>3 LEDs</li>") && enDisco.includes("void setup() {}"))
  assert.ok(r.includes(`\`${P.comoUrl(archivo)}\``), `la respuesta trae la ruta como URL: ${r}`)
  assert.match(P.comoUrl(archivo), /^file:\/\/\/.*carpeta%20de%20trabajo%20%231\/pagina-guia-del-semaforo\.html$/, "con el espacio y el numeral escapados")
  assert.ok(!r.includes(`file://${archivo}`), "la ruta cruda detrás de file:// no abre nada en el navegador")
  assert.match(r, /2 secciones, 2 bloques de contenido/, "cuenta lo que armó")
  assert.match(r, /la volví a leer del disco/)
  const uno = await ejecutar({ titulo: "Una sola cosa", bloques: [{ tipo: "seccion", titulo: "A" }, { tipo: "texto", texto: "x" }] })
  assert.match(uno, /1 sección, 1 bloque de contenido/, "y lo dice en singular cuando toca")
})

test("un error de validación no escribe nada y lista todo lo que hay que corregir", async () => {
  const r = await ejecutar({ titulo: "Guía rota", bloques: [{ tipo: "texto" }, { tipo: "tabla", columnas: ["a", "b"], filas: [["1", "2", "3"]] }] })
  assert.deepEqual(enLaCarpeta(), [], "con un error no queda ningún archivo")
  assert.match(r, /^No armé la página y no escribí ningún archivo: hay 2 cosas para corregir/)
  assert.match(r, /- `bloques\[0\]` \(texto\): falta `texto`/)
  assert.match(r, /- `bloques\[1\]` \(tabla\): la fila 1 tiene 3 celdas y hay 2 columnas\. Pasá 2 celdas por fila\./)
  assert.doesNotMatch(r, /file:\/\//, "no ofrece una ruta que no existe")
  assert.deepEqual(pedidos, [], "y no le pide nada al navegador")
  // Aunque se pida abrir: tampoco.
  await ejecutar({ titulo: "Guía rota", abrir: true, bloques: [{ tipo: "parrafo" }] })
  assert.deepEqual([enLaCarpeta(), pedidos], [[], []])
})

test("relee lo escrito: si el disco no tiene la página entera, no informa éxito", async () => {
  // La escritura «anda» (no tira) y deja el archivo cortado: disco lleno, antivirus, carpeta sincronizada.
  escribir = (ruta, contenido) => writeFileSync(ruta, contenido.slice(0, 500))
  const cortado = await ejecutar({ ...ARGS, abrir: true })
  assert.match(cortado, /^No pude confirmar que la página quedó bien guardada/)
  assert.doesNotMatch(cortado, /Armé la página|file:\/\//, "no la da por hecha ni la ofrece")
  assert.deepEqual(pedidos, [], "y no manda al navegador una página rota")

  // La escritura «anda» y no deja nada.
  rmSync(DIR, { recursive: true })
  mkdirSync(DIR)
  escribir = () => {}
  assert.match(await ejecutar(ARGS), /^No pude confirmar que la página quedó bien guardada/)

  // La escritura tira. Antes este test EXIGÍA que la respuesta trajera el texto crudo de
  // la excepción («EACCES: sin permiso»): fijaba la fuga en vez de prevenirla. Ahora mira
  // lo contrario, en el test de abajo.
  escribir = () => {
    throw Object.assign(new Error("EACCES: sin permiso"), { code: "EACCES" })
  }
  const sinPermiso = await ejecutar(ARGS)
  assert.match(sinPermiso, /^No pude guardar la página en `[^`]*pagina-guia-del-semaforo\.html`\./)
  assert.doesNotMatch(sinPermiso, /Armé la página/)
})

test("si la escritura falla, explica en llano qué pasó y qué hacer, sin copiar la excepción del sistema", async () => {
  // Todo lo que devuelve la tool lo lee el modelo. El mensaje crudo del sistema viene en
  // inglés y con jerga («EACCES: permission denied, open '…'»): el modelo lo repite o lo
  // traduce inventando. Cada caso tira una excepción con un texto SECRETO que no puede
  // aparecer en la respuesta, y con su código, que es lo único que se usa.
  const SECRETO = "permission denied, open '/etc/zzz-secreto'"
  const casos = [
    ["EACCES", /falta permiso[\s\S]*permiso de escritura a esa carpeta, o trabajar en otra/],
    ["EPERM", /falta permiso/],
    ["EROFS", /falta permiso/],
    ["ENOSPC", /El disco está lleno[\s\S]*liberar espacio/],
    ["EISDIR", /hay una carpeta con el mismo nombre[\s\S]*otro título/],
    [undefined, /no dijo por qué[\s\S]*Probá una vez más/],
  ]
  for (const [code, esperado] of casos) {
    escribir = () => {
      throw Object.assign(new Error(`${code ?? "EIO"}: ${SECRETO}`), code ? { code } : {})
    }
    const r = await ejecutar(ARGS)
    assert.match(r, /^No pude guardar la página en `/, `${code}: ${r}`)
    assert.match(r, esperado, `${code}: no explica qué pasó y qué hacer: ${r}`)
    assert.ok(!r.includes(SECRETO), `${code}: la respuesta copia el texto de la excepción: ${r}`)
    assert.ok(!/\bE[A-Z]{3,}\b/.test(r), `${code}: la respuesta trae un código de error crudo: ${r}`)
    assert.doesNotMatch(r, /Armé la página|file:\/\//, `${code}: no la da por hecha ni ofrece una ruta para abrir`)
  }
  // Un valor tirado que no es un Error tampoco rompe la respuesta.
  escribir = () => {
    throw "texto suelto"
  }
  assert.match(await ejecutar(ARGS), /no dijo por qué/)
  assert.deepEqual(pedidos, [], "con la escritura fallida no se le pide nada al navegador")
})

test("no pisa un archivo ajeno: guarda con otro nombre y avisa", async () => {
  const ajeno = join(DIR, "pagina-guia-del-semaforo.html")
  writeFileSync(ajeno, "<html><body>El trabajo práctico de Juana</body></html>")
  const r = await ejecutar(ARGS)
  assert.equal(readFileSync(ajeno, "utf8"), "<html><body>El trabajo práctico de Juana</body></html>", "el archivo ajeno queda intacto")
  assert.deepEqual(enLaCarpeta(), ["pagina-guia-del-semaforo-2.html", "pagina-guia-del-semaforo.html"])
  assert.ok(readFileSync(join(DIR, "pagina-guia-del-semaforo-2.html"), "utf8").includes(P.MARCA_GENERADOR))
  assert.ok(r.includes(P.comoUrl(join(DIR, "pagina-guia-del-semaforo-2.html"))), "la ruta que devuelve es la del archivo nuevo")
  assert.match(r, /Ya había un archivo `[^`]*pagina-guia-del-semaforo\.html` que no hice yo: no lo toqué/)

  // Si el -2 también es ajeno, sigue con el -3. Una carpeta con ese nombre tampoco se toca.
  writeFileSync(join(DIR, "pagina-guia-del-semaforo-2.html"), "otra cosa")
  mkdirSync(join(DIR, "pagina-guia-del-semaforo-3.html"))
  const r2 = await ejecutar(ARGS)
  assert.equal(readFileSync(join(DIR, "pagina-guia-del-semaforo-2.html"), "utf8"), "otra cosa")
  assert.ok(r2.includes(P.comoUrl(join(DIR, "pagina-guia-del-semaforo-4.html"))), r2)
})

test("reemplaza su propia página del mismo título, sin numerar ni avisar", async () => {
  await ejecutar(ARGS)
  const r = await ejecutar({ ...ARGS, bloques: [{ tipo: "texto", texto: "Versión corregida." }] })
  assert.deepEqual(enLaCarpeta(), ["pagina-guia-del-semaforo.html"], "la misma página, corregida: un solo archivo")
  assert.ok(readFileSync(join(DIR, "pagina-guia-del-semaforo.html"), "utf8").includes("Versión corregida."))
  assert.doesNotMatch(r, /que no hice yo/)
  assert.deepEqual(P.elegirDestino(DIR, "pagina-nueva"), { archivo: join(DIR, "pagina-nueva.html"), esquivo: null })
})

test("sin la hoja de estilos no escribe una página sin diseño", async () => {
  const casos = [
    ["no está", () => rmSync(HOJA), /^No armé la página: no encontré la hoja de estilos de Tecnia Bot/],
    ["está vacía", () => writeFileSync(HOJA, ""), /^No armé la página: está vacía o dañada la hoja de estilos de Tecnia Bot/],
    ["está cortada", () => writeFileSync(HOJA, ":root { --marca: #6d28d9; }"), /está vacía o dañada/],
    ["cerraría el <style>", () => writeFileSync(HOJA, readFileSync(HOJA_DEL_REPO, "utf8") + "\n</style><script>x</script>"), /está vacía o dañada/],
  ]
  for (const [nombre, romper, esperado] of casos) {
    cpSync(HOJA_DEL_REPO, HOJA)
    romper()
    const r = await ejecutar({ ...ARGS, abrir: true })
    assert.match(r, esperado, nombre)
    assert.ok(r.includes("tecniabot-web") && r.includes("sistema.css"), `${nombre}: nombra la pieza que falta`)
    assert.match(r, /reinstale Tecnia Bot con el instalador/, `${nombre}: dice cómo se arregla`)
    assert.match(r, /No escribí ningún archivo/)
    assert.deepEqual([enLaCarpeta(), pedidos], [[], []], `${nombre}: ni archivo ni navegador`)
  }
})

test("importar la tool no lee la hoja: sin ella el módulo carga igual y el error sale al ejecutar", async () => {
  // POR QUÉ. El registro de OpenCode importa todas las tools en un loop sin catch: si
  // ésta leyera la hoja al importarse y la hoja faltara, no fallaría «pagina», se caerían
  // TODAS las tools. Mismo criterio que el guard D13 de tests/arquitectura-conocimiento.
  // MUTACIÓN que lo pone rojo: `const CSS = readFileSync(rutaDelSistemaCss(), "utf8")` suelto
  // en el módulo.
  const casos = [
    ["ausente", () => rmSync(join(OUT, "tecniabot-web"), { recursive: true, force: true }), /no encontré la hoja de estilos/],
    ["ilegible (hay una carpeta en su lugar)", () => (rmSync(HOJA), mkdirSync(HOJA)), /no encontré la hoja de estilos/],
  ]
  for (const [nombre, romper, esperado] of casos) {
    cpSync(join(REPO, "opencode/tecniabot-web/diseno"), join(OUT, "tecniabot-web/diseno"), { recursive: true, force: true })
    romper()
    // Una copia nueva del módulo por caso: un `import()` repetido de la misma ruta devuelve
    // el módulo ya cargado y no probaría nada.
    const copia = join(OUT, "tool", `pagina-sin-hoja-${casos.findIndex((c) => c[0] === nombre)}.ts`)
    cpSync(join(OUT, "tool/pagina.ts"), copia)
    let fresca
    await assert.doesNotReject(async () => (fresca = await import(copia)), `${nombre}: importar la tool tiró`)
    assert.equal(fresca.rutaDelSistemaCss(), HOJA)
    const r = await fresca.default.execute(ARGS, { directory: DIR })
    assert.match(r, esperado, nombre)
    assert.deepEqual(enLaCarpeta(), [], `${nombre}: no escribe nada`)
  }
})

test("con abrir en false no llama al navegador y dice que se puede ofrecer", async () => {
  for (const args of [ARGS, { ...ARGS, abrir: false }]) {
    const r = await ejecutar(args)
    assert.deepEqual(pedidos, [], "no lanza nada")
    assert.match(r, /No le pedí al navegador que la abra: pasale esa ruta al docente, u ofrecele abrirla \(llamá de nuevo con abrir: true\)/)
    assert.doesNotMatch(r, AFIRMA_ABIERTA)
  }
})

test("con abrir en true pide el archivo al navegador y cuenta lo que sabe: pedida o falló", async () => {
  const archivo = join(DIR, "pagina-guia-del-semaforo.html")
  const r = await ejecutar({ ...ARGS, abrir: true })
  assert.equal(pedidos.length, 1)
  assert.equal(pedidos[0].at(-1), archivo, "le pasa el archivo que acaba de comprobar")
  assert.match(r, /Le pedí al navegador que la abra; no puedo comprobar que la ventana haya aparecido/)
  assert.ok(r.includes(P.comoUrl(archivo)), "la ruta va igual")

  lanzar = () => ({ exited: Promise.resolve(3), unref() {} })
  const fallo = await ejecutar({ ...ARGS, abrir: true })
  assert.match(fallo, /Le pedí al navegador que la abra y el pedido falló/)
  assert.ok(fallo.includes(P.comoUrl(archivo)), "si el pedido falla, la ruta es lo único que le queda al docente")

  lanzar = () => {
    throw new Error("xdg-open: no existe")
  }
  assert.match(await ejecutar({ ...ARGS, abrir: true }), /el pedido falló/)
})

test("nunca dice «abierta»: ni cuando pide, ni cuando falla, ni cuando no pide", async () => {
  for (const frase of ["Página abierta en el navegador", "Te la abrí", "ya está abierta", "quedó abierto", "Se abrió en el navegador"]) {
    assert.match(frase, AFIRMA_ABIERTA, `el detector tiene que marcar «${frase}»`)
  }
  assert.doesNotMatch("Le pedí al navegador que la abra; no puedo comprobar que la ventana haya aparecido", AFIRMA_ABIERTA)

  const respuestas = [await ejecutar(ARGS), await ejecutar({ ...ARGS, abrir: true })]
  lanzar = () => ({ exited: Promise.resolve(1), unref() {} })
  respuestas.push(await ejecutar({ ...ARGS, abrir: true }))
  lanzar = () => ({ exited: new Promise(() => {}), unref() {} })
  respuestas.push(await P.pedirAlNavegador("/x/pagina.html", lanzar, 5).then((como) => `resultado: ${como}`))
  lanzar = () => ({ exited: Promise.resolve(0), unref() {} })
  writeFileSync(join(DIR, "pagina-guia-del-semaforo.html"), "ajeno")
  respuestas.push(await ejecutar({ ...ARGS, abrir: true }))
  respuestas.push(await ejecutar({ titulo: "x", bloques: [] }))
  assert.equal(respuestas.length, 6)
  for (const r of respuestas) assert.doesNotMatch(r, AFIRMA_ABIERTA, r)
  assert.doesNotMatch(tool.description, AFIRMA_ABIERTA)
})

test("el pedido al navegador: pedida si el lanzador sigue o termina bien, fallo si termina mal o no arranca", async () => {
  const con = (proceso) => P.pedirAlNavegador("/x/pagina.html", () => proceso, 20)
  assert.equal(await con({ exited: Promise.resolve(0) }), "pedida")
  assert.equal(await con({ exited: new Promise(() => {}) }), "pedida", "si sigue vivo pasado el tiempo, es lo más que se puede saber")
  assert.equal(await con({ exited: Promise.resolve(4) }), "fallo", "xdg-open sin navegador por defecto termina con error")
  assert.equal(await con({ exited: Promise.reject(new Error("se cayó")) }), "fallo")
  assert.equal(
    await P.pedirAlNavegador("/x/pagina.html", () => {
      throw new Error("no existe el lanzador")
    }),
    "fallo",
  )
  const vistos = []
  await P.pedirAlNavegador("/x/mi pagina.html", (cmd) => (vistos.push(cmd), { exited: Promise.resolve(0) }), 20)
  assert.equal(vistos[0].at(-1), "/x/mi pagina.html", "el archivo va como un argumento entero, sin shell de por medio")
})

test("el nombre del archivo: pagina-<slug>, sólo [a-z0-9-], sin acentos y con el slug en 60 como mucho", () => {
  assert.equal(P.nombreSeguro("Guía: Semáforo — ESP32 (2.º año)"), "pagina-guia-semaforo-esp32-2-ano")
  assert.equal(P.nombreSeguro("ÑANDÚ & Cía. ¿Qué?"), "pagina-nandu-cia-que")
  assert.equal(P.nombreSeguro("../../etc/passwd"), "pagina-etc-passwd", "no hay forma de salir de la carpeta")
  assert.equal(P.nombreSeguro("¿¿¿???"), "pagina-sin-titulo")
  const largo = P.nombreSeguro("a".repeat(59) + " bcdefgh " + "c".repeat(60))
  assert.equal(largo, "pagina-" + "a".repeat(59), "corta en 60 y no deja un guion colgando")
  assert.equal(P.nombreSeguro("b".repeat(120)), "pagina-" + "b".repeat(60))
  for (const titulo of ["Guía: Semáforo", "x".repeat(120), "a/b\\c:d*e?f\"g<h>i|j", "名前 テスト abc"]) {
    assert.match(P.nombreSeguro(titulo), /^pagina-[a-z0-9]+(?:-[a-z0-9]+)*$/, titulo)
    assert.ok(P.nombreSeguro(titulo).length <= "pagina-".length + 60, titulo)
  }
})

test("comoUrl arma una URL que el navegador puede abrir, también en Windows", () => {
  assert.equal(P.comoUrl("C:\\Users\\Maria Jose\\pagina-guia.html"), "file:///C:/Users/Maria%20Jose/pagina-guia.html")
  assert.equal(P.comoUrl("/home/x/a#b.html"), "file:///home/x/a%23b.html")
})

test("la descripción dice para qué NO es, y su ejemplo es válido de verdad", async () => {
  const d = tool.description
  assert.match(d, /NO dibuja circuitos \(eso es `circuito`\)/)
  assert.match(d, /NO muestra el proyecto del alumno \(eso es `vista-fisica`\)/)
  assert.match(d, /Pines y conexiones nunca se inventan/)
  assert.match(d, /nunca escribas HTML/)
  assert.ok(d.length < 900, `la descripción tiene ${d.length} caracteres: es para un modelo chico`)
  const ejemplo = /Ejemplo mínimo: (\{.*\})$/.exec(d)
  assert.ok(ejemplo, "la descripción termina con un ejemplo")
  const args = JSON.parse(ejemplo[1])
  assert.equal(P.validarPagina(args).ok, true, "el ejemplo que el modelo va a copiar tiene que pasar la validación")
  const r = await ejecutar(args)
  assert.match(r, /^Armé la página \*\*Cómo cuidar la placa\*\* \(0 secciones, 1 bloque de contenido\)/)
})

test("el esquema real es plano y acepta el ejemplo y una página con todos los tipos", async () => {
  // Acá sí se carga la tool del repo con el plugin de verdad: el esquema lo arma zod, y el
  // plugin simulado de arriba no arma nada.
  const real = (await import(join(REPO, "opencode/tool/pagina.ts"))).default
  const { tool: plugin } = await import("@opencode-ai/plugin")
  const esquema = plugin.schema.object(real.args)
  const json = JSON.stringify(plugin.schema.toJSONSchema(esquema))
  assert.doesNotMatch(json, /"(?:anyOf|oneOf|allOf|\$ref|not)"/, "sin uniones ni referencias: un modelo chico tiene que poder llenarlo")
  assert.deepEqual(Object.keys(real.args), ["titulo", "resumen", "placa", "tema", "abrir", "bloques"])
  assert.deepEqual(esquema.shape.bloques.element.shape.tipo.options, [...P.TIPOS])
  assert.deepEqual(Object.keys(esquema.shape.bloques.element.shape), ["tipo", "titulo", "texto", "items", "columnas", "filas", "severidad"])
  assert.deepEqual(plugin.schema.toJSONSchema(esquema).required, ["titulo", "bloques"], "sólo el título y los bloques son obligatorios")

  const ejemplo = JSON.parse(/Ejemplo mínimo: (\{.*\})$/.exec(real.description)[1])
  assert.equal(esquema.safeParse(ejemplo).success, true)
  const completa = {
    titulo: "Guía",
    resumen: "r",
    placa: "ESP32 DevKit",
    tema: "oscuro",
    abrir: true,
    bloques: [
      { tipo: "seccion", titulo: "A" },
      { tipo: "texto", texto: "x" },
      { tipo: "lista", items: ["a"] },
      { tipo: "pasos", items: ["a"] },
      { tipo: "tabla", columnas: ["a", "b"], filas: [["1", "2"]] },
      { tipo: "codigo", texto: "x" },
      { tipo: "aviso", texto: "x", severidad: "error" },
      { tipo: "plegable", titulo: "t", texto: "x" },
    ],
  }
  const pasada = esquema.safeParse(completa)
  assert.equal(pasada.success, true)
  assert.equal(P.validarPagina(pasada.data).ok, true, "lo que deja pasar el esquema con todos los tipos, lo acepta la validación")
  // Los topes NO están en el esquema a propósito: los pone validarPagina, que contesta en
  // español y todos juntos. Si alguien los suma a zod, el modelo recibe un error de zod, en
  // inglés y de a uno, y este test lo avisa.
  assert.equal(esquema.safeParse({ titulo: "x".repeat(500), bloques: [] }).success, true, "el esquema no corta por largo: eso lo explica validarPagina")
  for (const descrito of [esquema.shape.titulo, esquema.shape.bloques, esquema.shape.bloques.element.shape.tipo, esquema.shape.bloques.element.shape.filas]) {
    assert.ok((descrito.description ?? "").length > 20, "cada argumento lleva su descripción")
  }
})
