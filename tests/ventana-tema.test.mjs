// El tema claro / oscuro de la ventana «vista física».
//
// POR QUÉ ESTE ARCHIVO (2026-11-26). El prototipo ponía el tema desde `app.js`, que es un módulo
// y corre DESPUÉS del primer pintado: quien había elegido oscuro veía la página en claro un
// instante en cada carga. Además arrancaba siempre en claro si no había nada guardado, sin mirar
// la preferencia del sistema. Ahora hay dos piezas —un script clásico en el <head> y el módulo del
// botón— y el riesgo nuevo es que digan cosas distintas. Eso es lo que más se cuida acá: el script
// clásico se EJECUTA, en todas las combinaciones, y se compara con la función pura.
//
// MUTACIONES que ponen rojo este archivo (probadas con el cambio ya commiteado):
//   - `temaInicial` ignora lo guardado                                   → «el tema inicial…»
//   - `temaInicial` acepta cualquier valor guardado                      → «el tema inicial…»
//   - `tema-inicial.js` deja de mirar el sistema                         → «el script clásico decide igual…»
//   - `tema-inicial.js` con otra clave de almacenamiento                 → «el script clásico decide igual…» y «usan la misma clave»
//   - `tema-inicial.js` sin el `try` de localStorage                     → «el script clásico decide igual…»
//   - cargar `tema-inicial.js` como módulo, o después de app.js          → «la página lo carga como script clásico…»
//   - el botón no guarda la preferencia                                  → «el botón cambia el tema…»
//   - el botón deja `data-theme="light"` en vez de sacar el atributo     → «el botón cambia el tema…»
//   - `aria-pressed` al revés                                            → «el botón cambia el tema…»
//
// LÍMITE HONESTO: que NO haya destello en claro al cargar no se puede medir acá. Se miró en
// Chromium (el atributo ya está puesto cuando corre el primer script de la página). Y la
// preferencia no se recuerda entre sesiones de Tecnia Bot (otro puerto, otro origen): es un
// límite conocido, documentado en `tema.js`, que este test deja escrito y no «arregla».
//
// Corre con: node --test tests/ventana-tema.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import vm from "node:vm"
import { REPO } from "./phase2-helpers.mjs"
import { recursosDe } from "./ventana-helpers.mjs"

const WEB = join(REPO, "opencode/vista-fisica/web")
const { temaInicial, temaSiguiente, conectarTema, CLAVE_DE_TEMA } = await import(join(WEB, "tema.js"))
const CLASICO = readFileSync(join(WEB, "tema-inicial.js"), "utf8")
const HTML = readFileSync(join(WEB, "index.html"), "utf8")

test("el tema inicial es el guardado si es válido; si no, el del sistema", () => {
  assert.equal(temaInicial({ guardado: "dark", sistemaOscuro: false }), "dark")
  assert.equal(temaInicial({ guardado: "light", sistemaOscuro: true }), "light", "lo que eligió la persona le gana al sistema")
  assert.equal(temaInicial({ guardado: null, sistemaOscuro: true }), "dark")
  assert.equal(temaInicial({ guardado: null, sistemaOscuro: false }), "light")
  for (const basura of [undefined, "", "oscuro", "DARK", "true", "null"]) {
    assert.equal(temaInicial({ guardado: basura, sistemaOscuro: false }), "light", `guardado=${JSON.stringify(basura)}`)
    assert.equal(temaInicial({ guardado: basura, sistemaOscuro: true }), "dark", `guardado=${JSON.stringify(basura)}`)
  }
})

test("el tema siguiente alterna entre los dos", () => {
  assert.equal(temaSiguiente("light"), "dark")
  assert.equal(temaSiguiente("dark"), "light")
  assert.equal(temaSiguiente(temaSiguiente("dark")), "dark")
})

/** Ejecuta `tema-inicial.js` como lo haría el navegador y devuelve el tema que dejó puesto. */
function correrClasico({ guardado, sistemaOscuro, almacenamiento = "anda", conMatchMedia = true }) {
  const atributos = {}
  const leidas = []
  const contexto = {
    document: { documentElement: { setAttribute: (k, v) => (atributos[k] = String(v)), removeAttribute: (k) => delete atributos[k] } },
    localStorage: {
      getItem(clave) {
        if (almacenamiento === "tira") throw new Error("SecurityError: acceso denegado")
        leidas.push(clave)
        return guardado ?? null
      },
    },
  }
  if (conMatchMedia) contexto.matchMedia = (consulta) => ({ matches: consulta === "(prefers-color-scheme: dark)" && sistemaOscuro })
  vm.runInContext(CLASICO, vm.createContext(contexto), { filename: "tema-inicial.js" })
  return { tema: atributos["data-theme"] === "dark" ? "dark" : "light", atributos, leidas }
}

test("el script clásico decide igual que temaInicial, en todas las combinaciones", () => {
  for (const guardado of [null, "dark", "light", "", "oscuro", "DARK"]) {
    for (const sistemaOscuro of [true, false]) {
      const r = correrClasico({ guardado, sistemaOscuro })
      assert.equal(r.tema, temaInicial({ guardado, sistemaOscuro }), `guardado=${JSON.stringify(guardado)} sistemaOscuro=${sistemaOscuro}`)
      assert.deepEqual(r.leidas, [CLAVE_DE_TEMA], "lee la preferencia con la clave del módulo")
      // Claro es SIN atributo (así lo espera la hoja): nunca `data-theme="light"`.
      assert.deepEqual(r.atributos, r.tema === "dark" ? { "data-theme": "dark" } : {})
    }
  }
})

test("el script clásico no rompe la carga si no hay almacenamiento o no hay matchMedia", () => {
  for (const sistemaOscuro of [true, false]) {
    assert.equal(correrClasico({ guardado: "dark", sistemaOscuro, almacenamiento: "tira" }).tema, temaInicial({ guardado: null, sistemaOscuro }), "sin almacenamiento manda el sistema")
  }
  assert.equal(correrClasico({ guardado: null, sistemaOscuro: true, conMatchMedia: false }).tema, "light")
  assert.equal(correrClasico({ guardado: "dark", sistemaOscuro: false, conMatchMedia: false }).tema, "dark")
})

test("usan la misma clave, y el script clásico es un script clásico de verdad", () => {
  assert.equal(CLAVE_DE_TEMA, "tecnia-tema")
  assert.ok(CLASICO.includes(`localStorage.getItem("${CLAVE_DE_TEMA}")`), "tema-inicial.js lee otra clave que la que guarda el botón")
  const codigo = CLASICO.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
  assert.doesNotMatch(codigo, /^\s*(?:import|export)\b/m, "con import/export deja de ser un script clásico y el navegador no lo corre como tal")
  assert.ok(Buffer.byteLength(CLASICO) < 2500, "es un script que frena el primer pintado: tiene que ser chico")
})

test("la página lo carga como script clásico de este servidor, en el <head> y antes que app.js; ninguno en línea", () => {
  const sinComentarios = HTML.replace(/<!--[\s\S]*?-->/g, "")
  const cabeza = sinComentarios.slice(0, sinComentarios.indexOf("</head>"))
  const etiqueta = /<script\b[^>]*src="\/assets\/tema-inicial\.js"[^>]*>/.exec(cabeza)
  assert.ok(etiqueta, "tema-inicial.js tiene que cargarse en el <head>: en el <body> ya se pintó algo en claro")
  assert.doesNotMatch(etiqueta[0], /\b(?:type="module"|defer|async)\b/, "diferido o asíncrono corre después del primer pintado: vuelve el destello")
  const { scripts } = recursosDe(HTML)
  assert.ok(scripts.indexOf("/assets/tema-inicial.js") < scripts.indexOf("/assets/app.js"))
  assert.equal([...sinComentarios.matchAll(/<script\b([^>]*)>/g)].filter((m) => !/\bsrc=/.test(m[1])).length, 0, "ningún <script> en línea: la política de seguridad lo frena")
  assert.doesNotMatch(sinComentarios, /\son[a-z]+="/, "ni manejadores en línea (onclick=…)")
})

// ── El botón, con un documento falso ──

function paginaFalsa({ guardado = null, sistemaOscuro = false, almacenamiento = "anda", temaPuesto = null } = {}) {
  const atributosRaiz = temaPuesto ? { "data-theme": temaPuesto } : {}
  const guardadas = []
  const elemento = (atributos) => ({
    atributos,
    textContent: "Modo oscuro",
    manejadores: [],
    getAttribute(k) {
      return this.atributos[k] ?? null
    },
    setAttribute(k, v) {
      this.atributos[k] = String(v)
    },
    removeAttribute(k) {
      delete this.atributos[k]
    },
    addEventListener(tipo, fn) {
      if (tipo === "click") this.manejadores.push(fn)
    },
    click() {
      for (const fn of this.manejadores) fn()
    },
  })
  const raiz = elemento(atributosRaiz)
  const boton = elemento({ "aria-pressed": "false", "data-texto-oscuro": "Modo oscuro", "data-texto-claro": "Modo claro" })
  let valor = guardado
  const ventana = {
    matchMedia: () => ({ matches: sistemaOscuro }),
    localStorage: {
      getItem: () => {
        if (almacenamiento === "tira") throw new Error("SecurityError")
        return valor
      },
      setItem: (clave, v) => {
        if (almacenamiento === "tira") throw new Error("QuotaExceededError")
        guardadas.push([clave, v])
        valor = v
      },
    },
  }
  return { doc: { documentElement: raiz, getElementById: (id) => (id === "boton-tema" ? boton : null) }, ventana, raiz, boton, guardadas }
}

test("el botón cambia el tema, dice a cuál lleva, lo anuncia con aria-pressed y guarda la preferencia", () => {
  const p = paginaFalsa()
  conectarTema(p.doc, p.ventana)
  assert.deepEqual([p.raiz.atributos["data-theme"] ?? null, p.boton.textContent, p.boton.atributos["aria-pressed"]], [null, "Modo oscuro", "false"])

  p.boton.click()
  assert.deepEqual([p.raiz.atributos["data-theme"], p.boton.textContent, p.boton.atributos["aria-pressed"]], ["dark", "Modo claro", "true"])
  assert.deepEqual(p.guardadas, [[CLAVE_DE_TEMA, "dark"]])

  p.boton.click()
  assert.ok(!("data-theme" in p.raiz.atributos), "el claro es SIN atributo: `data-theme=\"light\"` la hoja no lo conoce")
  assert.deepEqual([p.boton.textContent, p.boton.atributos["aria-pressed"]], ["Modo oscuro", "false"])
  assert.deepEqual(p.guardadas.at(-1), [CLAVE_DE_TEMA, "light"])
})

test("al conectar, el botón queda de acuerdo con el tema inicial (guardado o del sistema)", () => {
  const oscuroGuardado = paginaFalsa({ guardado: "dark", temaPuesto: "dark" })
  conectarTema(oscuroGuardado.doc, oscuroGuardado.ventana)
  assert.deepEqual([oscuroGuardado.raiz.atributos["data-theme"], oscuroGuardado.boton.textContent, oscuroGuardado.boton.atributos["aria-pressed"]], ["dark", "Modo claro", "true"])

  // Aunque `tema-inicial.js` no hubiera corrido (el atributo no está), el módulo lo aplica igual.
  const sistema = paginaFalsa({ sistemaOscuro: true })
  conectarTema(sistema.doc, sistema.ventana)
  assert.equal(sistema.raiz.atributos["data-theme"], "dark")
  assert.deepEqual(sistema.guardadas, [], "seguir al sistema no es una elección: no se guarda nada hasta que se toca el botón")

  const claroElegido = paginaFalsa({ guardado: "light", sistemaOscuro: true })
  conectarTema(claroElegido.doc, claroElegido.ventana)
  assert.ok(!("data-theme" in claroElegido.raiz.atributos))
})

test("sin almacenamiento (modo privado), el botón funciona igual; sólo no se recuerda", () => {
  const p = paginaFalsa({ almacenamiento: "tira" })
  assert.doesNotThrow(() => conectarTema(p.doc, p.ventana))
  assert.doesNotThrow(() => p.boton.click())
  assert.equal(p.raiz.atributos["data-theme"], "dark")
  assert.equal(p.boton.textContent, "Modo claro")
})

test("los dos textos del botón están en la página, no en el módulo", () => {
  const boton = /<button\b[^>]*id="boton-tema"[^>]*>([^<]*)<\/button>/.exec(HTML)
  assert.ok(boton, "la página no tiene el botón de tema")
  assert.match(boton[0], /data-texto-oscuro="Modo oscuro"/)
  assert.match(boton[0], /data-texto-claro="Modo claro"/)
  assert.equal(boton[1], "Modo oscuro", "la página arranca en claro hasta que el script diga otra cosa: el botón ofrece el oscuro")
  assert.doesNotMatch(readFileSync(join(WEB, "tema.js"), "utf8").replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, ""), /Modo (?:claro|oscuro)/)
})
