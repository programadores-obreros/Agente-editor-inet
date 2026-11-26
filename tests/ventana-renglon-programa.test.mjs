// El renglón del programa en «Cómo está»: dice si hay programa SOLO cuando lo sabe.
//
// POR QUÉ ESTE ARCHIVO (2026-11-26). Probando en la notebook real con una Arduino UNO, el
// encabezado y la tarjeta «Cómo está» decían «El proyecto está completo» y el paso 3 decía que
// todavía no había programa. El docente lo leyó como una falla. «Completo» es cierto para el
// montaje y las reglas, pero se lee como «listo». El estado del proyecto queda igual; la tarjeta
// suma un renglón aparte sobre el PROGRAMA, con tres estados: hay programa para esta revisión /
// todavía no hay / no se sabe (y en ese caso no afirma nada).
//
// QUÉ SE MIDE.
//   1. Las dos frases vienen del servidor (`vista.resumen.programa`, del anexo de pedagogía), con
//      proyectos armados con operaciones REALES del motor.
//   2. `claveDelPrograma` y `renglonDelPrograma` (puras, `web/vista-codigo.js`): los tres estados.
//   3. El panel de código real, con un `fetch` que se contesta a mano: el renglón vuelve a «no se
//      sabe» apenas cambia la revisión, y una respuesta vieja que llega tarde no lo cambia.
//   4. El pintor y la página: el «todavía no» es un enlace a la sección del programa, que existe.
//   5. Ningún archivo del navegador escribe esas frases.
//
// MUTACIONES que ponen rojo este archivo (probadas con el cambio ya commiteado):
//   - `claveDelPrograma` sin mirar el status (un 500 con ok:false → «no hay»)   → «claveDelPrograma: …falla…»
//   - el panel avisa `generado` también cuando el pedido falló                   → «panel: un pedido que falla…»
//   - `sinCodigo` sin avisar (no vuelve a «no se sabe» al cambiar la revisión)   → «panel: al cambiar la revisión…»
//   - `renglonDelPrograma` sin comparar la revisión                              → «renglonDelPrograma: lo sabido de OTRA revisión…»
//   - `renglonDelPrograma` con la frase escrita en el navegador                  → «renglonDelPrograma: los tres estados…» y «ningún archivo…»
//   - el resumen del servidor sin `programa`                                     → «el servidor manda las dos frases…»
//   - el pintor sin el enlace en «todavía no»                                    → «el pintor…»
//
// Corre con: node --test tests/ventana-renglon-programa.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const { proyectarVista } = await import(join(REPO, "opencode/vista-fisica/snapshot-a-vista.ts"))
const { CONOCIMIENTO_ACTIVO } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))
const { ejecutarOperacion } = await import(join(REPO, "opencode/nucleo/operaciones.ts"))
const { crearProyecto } = await import(join(REPO, "opencode/nucleo/cargador.ts"))
const web = await import(join(REPO, "opencode/vista-fisica/web/vista-codigo.js"))
const { pintarRenglonDelPrograma, ANCLA_DEL_PROGRAMA } = await import(join(REPO, "opencode/vista-fisica/web/pintar.js"))

const catalogo = CONOCIMIENTO_ACTIVO.catalogo
// Escritas a mano (no importadas): si alguien cambia el anexo, este test lo tiene que ver.
const GENERADO = "El programa de esta revisión está generado."
const SIN_PROGRAMA = "Todavía no hay programa para este proyecto: mirá el paso 3, «Mirá el código»."

let n = 0
function proyecto(pasos) {
  let p = crearProyecto({ generadorId: () => "renglon", ahora: () => "2026-01-01T00:00:00.000Z", catalogoVersion: catalogo.version, catalogoHash: catalogo.hash })
  for (const [tipo, payload] of pasos) {
    const r = ejecutarOperacion(p, { idOperacion: `renglon-${n++}`, actor: "agente", baseRevision: p.revision, tipo, payload }, catalogo)
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r.motivos)}`)
    p = r.proyecto
  }
  return p
}

// ═══ 1. el servidor ══════════════════════════════════════════════════════════════════════════

test("el servidor manda las dos frases del renglón en vista.resumen.programa, con ESP32, con UNO y sin placa", () => {
  for (const pasos of [[["SetPlaca", { placa: "esp32-devkit-v1" }]], [["SetPlaca", { placa: "arduino-uno" }]], [["AgregarComponente", { tipo: "led" }]]]) {
    const vista = proyectarVista(proyecto(pasos), catalogo)
    assert.deepEqual(vista.resumen.programa, { generado: GENERADO, sinPrograma: SIN_PROGRAMA })
    // Viaja por JSON tal cual (es lo que recibe la página).
    assert.deepEqual(JSON.parse(JSON.stringify(vista.resumen)).programa, { generado: GENERADO, sinPrograma: SIN_PROGRAMA })
  }
  // El estado del proyecto no cambió: sigue hablando del montaje y las reglas.
  const vista = proyectarVista(proyecto([["SetPlaca", { placa: "arduino-uno" }]]), catalogo)
  assert.ok(["listo", "incompleto", "invalido"].includes(vista.resumen.estado.clave))
})

// ═══ 2. lógica pura ═════════════════════════════════════════════════════════════════════════

const PROG = (revision) => ({ revision, programa: { ok: true, archivo: "src/main.cpp", codigo: "void setup() {}\n", lineas: 1 } })
const NO_HAY = (revision) => ({ revision, programa: { ok: false, porQue: "Todavía no se sabe programar esto." } })

test("claveDelPrograma: programa de ESA revisión → generado; un «no hay» firme (200) → sinPrograma", () => {
  assert.equal(web.claveDelPrograma({ estado: 200, cuerpo: PROG(7), revision: 7 }), web.PROGRAMA_GENERADO)
  assert.equal(web.claveDelPrograma({ estado: 200, cuerpo: NO_HAY(7), revision: 7 }), web.PROGRAMA_NO_HAY)
})

test("claveDelPrograma: falla, 404, otra revisión o respuesta rara → desconocido (nunca afirma)", () => {
  // Una falla de Tecnia Bot (500) trae ok:false, pero NO dice que el proyecto no tenga programa.
  assert.equal(web.claveDelPrograma({ estado: 500, cuerpo: NO_HAY(7), revision: 7 }), web.PROGRAMA_DESCONOCIDO)
  assert.equal(web.claveDelPrograma({ estado: 404, cuerpo: null, revision: 7 }), web.PROGRAMA_DESCONOCIDO)
  assert.equal(web.claveDelPrograma({ estado: 200, cuerpo: PROG(6), revision: 7 }), web.PROGRAMA_DESCONOCIDO)
  assert.equal(web.claveDelPrograma({ estado: 200, cuerpo: NO_HAY(8), revision: 7 }), web.PROGRAMA_DESCONOCIDO)
  assert.equal(web.claveDelPrograma({ estado: 200, cuerpo: { revision: 7, programa: { ok: true, codigo: 42 } }, revision: 7 }), web.PROGRAMA_DESCONOCIDO)
  assert.equal(web.claveDelPrograma({ estado: 200, cuerpo: { revision: 7 }, revision: 7 }), web.PROGRAMA_DESCONOCIDO)
})

// Textos de prueba que NO son los del anexo: si el navegador escribiera su propia frase, se nota.
const TEXTOS = { generado: "frase-generado-del-servidor", sinPrograma: "frase-sin-programa-del-servidor" }

test("renglonDelPrograma: los tres estados, con el texto que mandó el servidor", () => {
  const r = (clave) => web.renglonDelPrograma({ textos: TEXTOS, estadoPrograma: { clave, revision: 7 }, revision: 7, conectado: true })
  assert.deepEqual(r(web.PROGRAMA_GENERADO), { texto: TEXTOS.generado, llevaAlPrograma: false })
  assert.deepEqual(r(web.PROGRAMA_NO_HAY), { texto: TEXTOS.sinPrograma, llevaAlPrograma: true })
  assert.equal(r(web.PROGRAMA_DESCONOCIDO), null)
})

test("renglonDelPrograma: lo sabido de OTRA revisión, sin conexión o sin textos del servidor → no dice nada", () => {
  assert.equal(web.renglonDelPrograma({ textos: TEXTOS, estadoPrograma: { clave: web.PROGRAMA_GENERADO, revision: 7 }, revision: 8, conectado: true }), null)
  assert.equal(web.renglonDelPrograma({ textos: TEXTOS, estadoPrograma: { clave: web.PROGRAMA_NO_HAY, revision: 7 }, revision: 8, conectado: true }), null)
  assert.equal(web.renglonDelPrograma({ textos: TEXTOS, estadoPrograma: { clave: web.PROGRAMA_GENERADO, revision: 7 }, revision: 7, conectado: false }), null)
  assert.equal(web.renglonDelPrograma({ textos: null, estadoPrograma: { clave: web.PROGRAMA_GENERADO, revision: 7 }, revision: 7, conectado: true }), null)
  assert.equal(web.renglonDelPrograma({ textos: TEXTOS, estadoPrograma: null, revision: 7, conectado: true }), null)
})

// ═══ 3. el panel real, con un fetch a mano ═══════════════════════════════════════════════════

function montar() {
  const pedidos = []
  const fetch = (ruta) => new Promise((resolver, rechazar) => pedidos.push({ ruta, resolver, rechazar }))
  const contestar = (i, cuerpo, status = 200) => pedidos[i].resolver({ status, json: async () => cuerpo })
  const avisos = []
  const panel = web.crearPanelCodigo({ fetch, elementoCodigo: { textContent: "", hidden: true }, elementoAviso: { textContent: "" }, alCambiarElPrograma: (e) => avisos.push(e) })
  /** Lo que diría el renglón con la revisión que muestra la cabecera. */
  const renglon = (revision) => web.renglonDelPrograma({ textos: TEXTOS, estadoPrograma: panel.estadoDelPrograma(), revision, conectado: true })
  return { panel, pedidos, contestar, avisos, renglon }
}

test("panel: mientras se pide no se sabe; con el programa, generado; con un «no hay» firme, sinPrograma", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 })
  assert.equal(m.renglon(7), null, "actualizando: no se afirma nada")
  m.contestar(0, PROG(7))
  await a
  assert.deepEqual(m.panel.estadoDelPrograma(), { clave: web.PROGRAMA_GENERADO, revision: 7 })
  assert.equal(m.renglon(7)?.texto, TEXTOS.generado)
  assert.deepEqual(m.avisos.at(-1), { clave: web.PROGRAMA_GENERADO, revision: 7 }, "el panel avisa el cambio")

  const b = m.panel.actualizar({ revision: 8 })
  m.contestar(1, NO_HAY(8))
  await b
  assert.equal(m.renglon(8)?.texto, TEXTOS.sinPrograma)
  assert.equal(m.renglon(8)?.llevaAlPrograma, true)
})

test("panel: un pedido que falla (red o 500) deja el renglón en «no se sabe», aunque antes hubiera programa", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 })
  m.contestar(0, PROG(7))
  await a
  const b = m.panel.actualizar({ revision: 8 })
  m.pedidos[1].rechazar(new Error("red caída"))
  await b
  assert.equal(m.panel.estadoDelPrograma().clave, web.PROGRAMA_DESCONOCIDO)
  assert.equal(m.renglon(8), null)
  // Reintento (la falla se reintenta en el próximo repintado) que vuelve con un 500.
  const c = m.panel.actualizar({ revision: 8 })
  m.contestar(2, NO_HAY(8), 500)
  await c
  assert.equal(m.panel.estadoDelPrograma().clave, web.PROGRAMA_DESCONOCIDO, "un 500 no es «no hay programa»")
  assert.equal(m.renglon(8), null)
})

test("panel: al cambiar la revisión, el renglón vuelve a «no se sabe» ANTES de que llegue el programa nuevo", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 })
  m.contestar(0, PROG(7))
  await a
  void m.panel.actualizar({ revision: 8 })
  assert.deepEqual(m.panel.estadoDelPrograma(), { clave: web.PROGRAMA_DESCONOCIDO, revision: 8 })
  assert.deepEqual(m.avisos.at(-1), { clave: web.PROGRAMA_DESCONOCIDO, revision: 8 }, "el panel avisa al toque, sin esperar la respuesta")
  assert.equal(m.renglon(8), null, "con la revisión 8 en la cabecera no se puede decir que hay programa (era el de la 7)")
})

test("panel: una respuesta vieja que llega tarde no cambia el renglón", async () => {
  const m = montar()
  const a = m.panel.actualizar({ revision: 7 })
  const b = m.panel.actualizar({ revision: 8 })
  const avisosAntes = m.avisos.length
  m.contestar(0, PROG(7))
  await a
  assert.deepEqual(m.panel.estadoDelPrograma(), { clave: web.PROGRAMA_DESCONOCIDO, revision: 8 })
  assert.equal(m.avisos.length, avisosAntes, "la respuesta del pedido viejo no avisa nada")
  assert.equal(m.renglon(8), null)
  m.contestar(1, PROG(8))
  await b
  assert.equal(m.renglon(8)?.texto, TEXTOS.generado)
})

test("panel: si el aviso al renglón tira, el panel sigue pintando el programa", async () => {
  const codigo = { textContent: "", hidden: true }
  const pedidos = []
  const panel = web.crearPanelCodigo({ fetch: () => new Promise((r) => pedidos.push(r)), elementoCodigo: codigo, elementoAviso: { textContent: "" }, alCambiarElPrograma: () => { throw new Error("renglón roto") } })
  const a = panel.actualizar({ revision: 3 })
  pedidos[0]({ status: 200, json: async () => PROG(3) })
  await a
  assert.equal(codigo.hidden, false)
  assert.equal(panel.estadoDelPrograma().clave, web.PROGRAMA_GENERADO)
})

// ═══ 4. el pintor y la página ════════════════════════════════════════════════════════════════

function elementoFalso() {
  return {
    atributos: { hidden: "" },
    hijos: [],
    textContent: "",
    setAttribute(k, v) { this.atributos[k] = String(v) },
    removeAttribute(k) { delete this.atributos[k] },
    replaceChildren() { this.hijos = []; this.textContent = "" },
    appendChild(h) { this.hijos.push(h); return h },
  }
}
const documentoFalso = { createElement: (tag) => ({ ...elementoFalso(), tagName: tag, atributos: {} }) }

test("el pintor: «no se sabe» queda vacío y oculto; «generado» es texto; «todavía no» es un enlace al paso 3", () => {
  const el = elementoFalso()
  pintarRenglonDelPrograma(documentoFalso, el, { texto: "generado-x", llevaAlPrograma: false })
  assert.equal(el.textContent, "generado-x")
  assert.equal("hidden" in el.atributos, false)
  assert.equal(el.hijos.length, 0)

  pintarRenglonDelPrograma(documentoFalso, el, { texto: "no-hay-x", llevaAlPrograma: true })
  assert.equal(el.hijos.length, 1)
  assert.equal(el.hijos[0].tagName, "a")
  assert.equal(el.hijos[0].atributos.href, `#${ANCLA_DEL_PROGRAMA}`)
  assert.equal(el.hijos[0].textContent, "no-hay-x")

  pintarRenglonDelPrograma(documentoFalso, el, null)
  assert.equal(el.hijos.length, 0)
  assert.equal(el.textContent, "")
  assert.equal("hidden" in el.atributos, true, "sin saber, el renglón no ocupa lugar ni dice nada")
})

test("index.html: el renglón existe dentro de «Cómo está», oculto de entrada, y el enlace lleva a la sección del programa", () => {
  const html = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8")
  const tarjeta = /<section[^>]*aria-labelledby="t-como-esta"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? ""
  assert.match(tarjeta, /<p id="resumen-programa" hidden><\/p>/)
  assert.match(html, new RegExp(`<section[^>]*id="${ANCLA_DEL_PROGRAMA}"[^>]*>[\\s\\S]*?id="vista-codigo"`), "el ancla es la sección que contiene el código")
})

test("app.js: el renglón se repinta en cada repintado y cada vez que el panel cambia lo que sabe", () => {
  const app = readFileSync(join(REPO, "opencode/vista-fisica/web/app.js"), "utf8")
  assert.match(app, /alCambiarElPrograma: \(\) => repintarRenglonDelPrograma\(\)/)
  assert.match(app, /panelCodigo, conectado: estadoConexion === "conectado" \}\)\n  repintarRenglonDelPrograma\(\)\n/)
  assert.match(app, /textos: ultimoSnapshot\?\.vista\?\.resumen\?\.programa/)
  assert.match(app, /getElementById\("resumen-programa"\)/)
})

// ═══ 5. el navegador no redacta ═════════════════════════════════════════════════════════════

test("ningún archivo del navegador escribe las frases del renglón: vienen de vista.resumen", () => {
  for (const archivo of ["vista-codigo.js", "pintar.js", "app.js", "plan-de-pintado.js", "index.html"]) {
    const fuente = readFileSync(join(REPO, "opencode/vista-fisica/web", archivo), "utf8")
    for (const pedazo of ["está generado", "Todavía no hay programa", "mirá el paso 3"]) {
      assert.equal(fuente.includes(pedazo), false, `${archivo} escribe «${pedazo}»`)
    }
  }
})

// ═══ 6. el nombre del paso 3 es uno solo ═════════════════════════════════════════════════════
//
// 2026-11-26: el paso 3 pasó de «Mirá el programa» a «Mirá el código» (decisión del dueño: el bot
// dice que el programa «se ve en la sección Código» y la ventana no tenía ninguna con esa palabra).
// El nombre vive en tres lugares —la navegación, el título de la sección y el renglón que manda
// al paso 3— y esta prueba es la que no los deja separarse.
//
// MUTACIONES: cambiar sólo el enlace de la navegación, sólo el <h2>, o sólo el texto del anexo → rojo.
test("el paso 3 se llama igual en la navegación, en el título de su sección y en el renglón que lleva ahí", () => {
  const html = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "")
  const limpio = (t) => t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  const enlace = new RegExp(`<a\\b[^>]*href="#${ANCLA_DEL_PROGRAMA}"[^>]*>([\\s\\S]*?)</a>`).exec(/<nav\b[^>]*data-pasos[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "")
  assert.ok(enlace, "la navegación no tiene el enlace al paso 3")
  const enNavegacion = limpio(enlace[1]).replace(/^3 /, "")
  const seccion = new RegExp(`<section\\b[^>]*id="${ANCLA_DEL_PROGRAMA}"[^>]*>([\\s\\S]*?)</section>`).exec(html)
  const enTitulo = limpio(/<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(seccion?.[1] ?? "")?.[1] ?? "")
  assert.equal(enNavegacion, "Mirá el código")
  assert.equal(enTitulo, enNavegacion, "la navegación y el título de la sección dicen cosas distintas")
  const vista = proyectarVista(proyecto([["SetPlaca", { placa: "arduino-uno" }]]), catalogo)
  assert.ok(vista.resumen.programa.sinPrograma.includes(`«${enNavegacion}»`), `el renglón manda al paso 3 con otro nombre: ${vista.resumen.programa.sinPrograma}`)
})
