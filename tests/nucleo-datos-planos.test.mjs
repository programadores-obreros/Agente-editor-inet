// Frontera de datos planos — Phase 1.1 (RX2), `opencode/nucleo/datos-planos.ts`.
//
// Tests de CONTRATO del módulo en sí (no de una frontera pública en particular —
// esas viven en `nucleo-ir-cargador.test.mjs`/`nucleo-motor.test.mjs`/
// `nucleo-operaciones.test.mjs`, junto a la puerta que protegen). Cada test acá
// expresa el contrato ("una propiedad accessor se rechaza SIN invocarla", "una
// clave Symbol se rechaza", ...) — nunca el detalle interno de implementación.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

const { materializarDatosPlanos, motivoEntradaNoPlano, LIMITE_PROFUNDIDAD } = await import(join(REPO, "opencode/nucleo/datos-planos.ts"))

function rechazo(valor) {
  const r = materializarDatosPlanos(valor, "raiz")
  assert.equal(r.ok, false, "se esperaba un rechazo")
  return r
}

function aceptado(valor) {
  const r = materializarDatosPlanos(valor, "raiz")
  assert.equal(r.ok, true, r.ok ? "" : `se esperaba aceptación: ${r.razon}`)
  return r.valor
}

// ─────────────────────────────── datos planos aceptados ──────────────────────────────

test("acepta strings, booleans, null y numbers (incluidos NaN/±Infinity) tal cual", () => {
  assert.equal(aceptado("hola"), "hola")
  assert.equal(aceptado(true), true)
  assert.equal(aceptado(false), false)
  assert.equal(aceptado(null), null)
  assert.equal(aceptado(0), 0)
  assert.equal(aceptado(-40), -40)
  assert.ok(Number.isNaN(aceptado(Number.NaN)), "NaN se copia tal cual — la finitud la deciden los validadores existentes")
  assert.equal(aceptado(Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY)
  assert.equal(aceptado(Number.NEGATIVE_INFINITY), Number.NEGATIVE_INFINITY)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (RX4, NOTE — cuarta revisión adversarial independiente, RX4_REPORT.md):
// `JSON.parse("-0")` produce `-0` en memoria (`Object.is` distingue el signo), pero
// `JSON.stringify(-0)` da el string `"0"` — en disco el signo SIEMPRE se pierde. Antes
// de este fix, `materializarDatosPlanos` preservaba `-0` tal cual en memoria (mismo
// criterio que NaN/±Infinity: "la finitud/representación la deciden los validadores
// existentes"), lo que dejaba una divergencia REAL memoria↔disco para un valor
// numérico — el gate de Phase 1.1 exige que no haya divergencia memoria/disco. A
// diferencia de NaN/±Infinity (que SÍ tienen decisiones de negocio reales atadas,
// `UMBRAL_NO_FINITO`), `-0` y `0` son el MISMO valor con `===`/`>=`/cualquier
// comparación aritmética — normalizar `-0` a `0` en la frontera de datos planos es
// una normalización de REPRESENTACIÓN (nunca de significado, brief: "nunca reparar en
// silencio" no aplica acá porque no hay dos significados distintos que confundir).
// ════════════════════════════════════════════════════════════════════════════════════

test("normaliza -0 a 0 en la materializacion — nunca una divergencia de representacion memoria/disco (hallazgo RX4, NOTE)", () => {
  assert.ok(Object.is(aceptado(-0), 0), "-0 se normaliza a 0 — JSON no puede persistir -0, y son el mismo valor con ===")
  assert.ok(!Object.is(aceptado(-0), -0), "control: ya NO queda -0 en memoria")
  // -0 anidado (valor de propiedad, elemento de array) tambien se normaliza — la
  // normalizacion corre en el mismo punto que procesa CUALQUIER number, sin importar
  // la posicion.
  const copia = aceptado({ a: -0, b: [-0, 1, -0] })
  assert.ok(Object.is(copia.a, 0))
  assert.ok(Object.is(copia.b[0], 0))
  assert.ok(Object.is(copia.b[2], 0))
})

test("acepta objetos planos anidados y arrays densos, produciendo una copia INDEPENDIENTE (nunca comparte referencia)", () => {
  const original = { a: 1, b: { c: [1, 2, { d: "x" }] }, e: null }
  const copia = aceptado(original)
  assert.deepEqual(copia, original)
  assert.notEqual(copia, original)
  assert.notEqual(copia.b, original.b)
  assert.notEqual(copia.b.c, original.b.c)
  assert.notEqual(copia.b.c[2], original.b.c[2])
  original.b.c[2].d = "mutado"
  assert.equal(copia.b.c[2].d, "x", "la copia nunca se ve afectada por una mutación posterior del original")
})

test("acepta Object.create(null) (prototipo null)", () => {
  const sinProto = Object.create(null)
  sinProto.x = 1
  const copia = aceptado(sinProto)
  assert.deepEqual(copia, { x: 1 })
})

test("undefined como valor de una propiedad de OBJETO se preserva (criterio documentado: JSON.stringify ya lo omite al persistir, comportamiento conocido)", () => {
  const copia = aceptado({ a: undefined, b: 1 })
  assert.equal(copia.b, 1)
  assert.ok("a" in copia, "la clave se preserva")
  assert.equal(copia.a, undefined)
})

test("undefined como valor RAIZ (el argumento mismo) se acepta — cada frontera publica decide que hacer con el", () => {
  assert.equal(aceptado(undefined), undefined)
})

// ─────────────────────────────────── rechazos: tipos ──────────────────────────────────

test("rechaza bigint", () => {
  rechazo(10n)
})

test("rechaza symbol como VALOR", () => {
  rechazo(Symbol("x"))
})

test("rechaza funciones", () => {
  rechazo(() => {})
})

test("rechaza undefined como ELEMENTO DE ARRAY (JSON.stringify lo convertiria en null silenciosamente — criterio documentado)", () => {
  const r = rechazo([1, undefined, 3])
  assert.match(r.razon, /undefined/)
})

test("rechaza instancias de Date", () => {
  rechazo(new Date())
})

test("rechaza instancias de Map", () => {
  rechazo(new Map([["a", 1]]))
})

test("rechaza instancias de clase (prototipo distinto de Object.prototype/null)", () => {
  class Foo {
    constructor() {
      this.x = 1
    }
  }
  rechazo(new Foo())
})

// ─────────────────────────────── rechazos: claves y accessors ────────────────────────

test("rechaza clave Symbol en un objeto", () => {
  const obj = { a: 1 }
  obj[Symbol("oculto")] = "dato"
  rechazo(obj)
})

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 1.1 (RX3, hallazgo externo RX3-01, CRÍTICO — revisión adversarial independiente
// #3, RX3_REPORT.md): la copia se construía con `copia[clave] = valor` sobre un objeto
// `{}` — que HEREDA el setter mágico `Object.prototype.__proto__`. Con `clave ===
// "__proto__"`, esa asignación no crea una propiedad propia: dispara el setter
// heredado y reemplaza el PROTOTIPO INTERNO de la copia — el propio postcondicional
// del módulo ("el resultado tiene Object.prototype") quedaba falso para su propia
// salida. Alcanzable con JSON PURO (`JSON.parse` produce una propiedad OWN literal
// "__proto__", nunca dispara el setter — el bucle de copiado sí).
//
// FIX DE RAÍZ (ver docs/programacion-intencion/DECISIONS.md, entrada RX3-01, y
// evidencia/RX3fix/causa.md para el análisis completo): el defecto real es el
// CONTENEDOR (`copia = {}`), no el nombre de la clave. La copia se construye SIEMPRE
// con `Object.defineProperty` (semántica `[[DefineOwnProperty]]`, inmune a CUALQUIER
// setter heredado) — NUNCA con asignación por corchetes. Con el contenedor seguro,
// NINGUNA clave (ni "__proto__", ni "constructor"/"prototype"/"toString"/
// "hasOwnProperty") tiene efecto especial: todas se preservan como datos propios
// normales, indistinguibles entre sí. Este módulo NO rechaza ninguna clave por
// nombre — el rechazo de forma (p.ej. `CLAVE_DESCONOCIDA` para una entidad de forma
// CERRADA) es responsabilidad de quien conoce el schema (`cargador.ts`), no de esta
// frontera genérica de "es un dato plano".
// ════════════════════════════════════════════════════════════════════════════════════

test("acepta clave '__proto__' en un objeto de nivel raiz como dato ORDINARIO — nunca cambia el prototipo (hallazgo externo RX3-01, fix de raiz)", () => {
  const jsonTexto = '{"a":1,"__proto__":{"pwned":true}}'
  const objetoAtacante = JSON.parse(jsonTexto)
  assert.ok(Object.prototype.hasOwnProperty.call(objetoAtacante, "__proto__"), "control: JSON.parse produce '__proto__' como OWN key, nunca cambia el prototipo real")
  const copia = aceptado(objetoAtacante)
  assert.equal(Object.getPrototypeOf(copia), Object.prototype, "el prototipo de la copia nunca cambia, sin importar el nombre de la clave")
  assert.ok(Object.prototype.hasOwnProperty.call(copia, "__proto__"), "'__proto__' sobrevive como propiedad PROPIA de la copia")
  assert.deepEqual(copia.__proto__, { pwned: true }, "el valor se preserva intacto — nunca se pierde en silencio")
  assert.equal(copia.a, 1)
})

test("acepta clave '__proto__' anidada en CUALQUIER nivel como dato ordinario, preservada en cada nivel (hallazgo externo RX3-01, fix de raiz)", () => {
  const jsonTexto = '{"a":{"b":{"c":1,"__proto__":{"pwned":true}}}}'
  const objetoAtacante = JSON.parse(jsonTexto)
  const copia = aceptado(objetoAtacante)
  assert.equal(Object.getPrototypeOf(copia.a.b), Object.prototype, "el prototipo del nivel anidado tampoco cambia")
  assert.ok(Object.prototype.hasOwnProperty.call(copia.a.b, "__proto__"))
  assert.deepEqual(copia.a.b.__proto__, { pwned: true })
  assert.equal(copia.a.b.c, 1)
})

test("invariante (hallazgo externo RX3-01): la salida de materializarDatosPlanos SIEMPRE tiene Object.prototype (objetos) o Array.prototype (arrays), y sus claves propias son EXACTAMENTE las de la entrada — incluida '__proto__'", () => {
  const entrada = JSON.parse('{"a":1,"__proto__":{"pwned":true},"constructor":{"prototype":{"x":1}},"toString":"dato","hasOwnProperty":"otro-dato","b":[1,2,{"c":3}]}')
  const copia = aceptado(entrada)
  assert.equal(Object.getPrototypeOf(copia), Object.prototype, "el prototipo de la copia nunca puede ser otra cosa")
  assert.deepEqual(Object.keys(copia).sort(), Object.keys(entrada).sort(), "ninguna clave se pierde ni se convierte en prototipo — incluida '__proto__'")
  assert.deepEqual(copia.__proto__, { pwned: true }, "'__proto__' es una propiedad propia normal, indistinguible de cualquier otra")
  assert.equal(copia.constructor.prototype.x, 1, "'constructor'/'prototype' NO son accessors — se preservan como datos normales, sin heredar comportamiento especial")
  assert.equal(copia.toString, "dato", "'toString' tambien se preserva como dato normal")
  assert.equal(copia.hasOwnProperty, "otro-dato", "'hasOwnProperty' tambien se preserva como dato normal")
  assert.equal(Object.getPrototypeOf(copia.b), Array.prototype)
})

test("round-trip formal a nivel de modulo: JSON.stringify(materializado) -> JSON.parse -> materializado de nuevo, produce EXACTAMENTE los mismos datos, incluida la clave '__proto__' (hallazgo externo RX3-01)", () => {
  const entrada = JSON.parse('{"__proto__":{"pwned":true},"constructor":"x","prototype":"y","normal":[1,{"__proto__":2}]}')
  const copia1 = aceptado(entrada)
  const textoDisco = JSON.stringify(copia1)
  const copia2 = aceptado(JSON.parse(textoDisco))
  assert.deepEqual(copia2, copia1, "materializar -> serializar -> re-parsear -> re-materializar es idempotente, incluida '__proto__'")
  assert.equal(Object.getPrototypeOf(copia2), Object.prototype)
  assert.equal(Object.getPrototypeOf(copia2.normal[1]), Object.prototype)
})

test("regresion (adaptado de phase1_auditoria_externa/evidencia/e1/exp_proto_pollution.mjs): '__proto__' en pines Y en propiedades (con 'constructor.prototype' anidado) se ACEPTA como dato ordinario, preservado exacto, nunca contamina Object.prototype global", () => {
  const raw = '{"pines":{"__proto__":{"polluted":true}},"propiedades":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}}}}'
  const copia = aceptado(JSON.parse(raw))
  assert.deepEqual(copia.pines.__proto__, { polluted: true }, "el dato se preserva, nunca desaparece en silencio")
  assert.deepEqual(copia.propiedades.__proto__, { polluted: true })
  assert.equal(copia.propiedades.constructor.prototype.polluted2, true)
  assert.equal(Object.getPrototypeOf(copia.pines), Object.prototype)
  assert.equal(Object.getPrototypeOf(copia.propiedades), Object.prototype)
  assert.equal(({}).polluted, undefined, "Object.prototype global NUNCA se contamina")
  assert.equal(({}).polluted2, undefined, "Object.prototype global NUNCA se contamina")
})

// RX2-04: una clave NO enumerable se rechaza fail-closed — nunca se ignora en
// silencio (antes de esta ronda, ni se copiaba ni se reportaba: quedaba invisible).
test("rechaza propiedad NO enumerable (hallazgo externo RX2-04)", () => {
  const obj = {}
  Object.defineProperty(obj, "oculta", { value: 1, enumerable: false })
  const r = rechazo(obj)
  assert.match(r.razon, /no enumerable/)
})

test("rechaza propiedad accessor (getter/setter) SIN invocarla — nunca se dispara el getter", () => {
  let invocado = false
  const obj = {}
  Object.defineProperty(obj, "x", {
    enumerable: true,
    get() {
      invocado = true
      return 1
    },
  })
  rechazo(obj)
  assert.equal(invocado, false, "el getter NUNCA debe invocarse — se rechaza por descriptor, sin leerlo")
})

test("rechaza un getter que sería válido en una 1a lectura y explota en una 2a (TOCTOU) — nunca se invoca ni una sola vez", () => {
  let lecturas = 0
  const obj = {}
  Object.defineProperty(obj, "x", {
    enumerable: true,
    get() {
      lecturas++
      if (lecturas === 1) return "valido"
      throw new Error("boom en la 2a lectura")
    },
  })
  rechazo(obj)
  assert.equal(lecturas, 0, "un accessor se rechaza por su descriptor — nunca se invoca, ni siquiera una vez")
})

// ─────────────────────────────── Proxies: get vs ownKeys/getOwnPropertyDescriptor ────

test("un Proxy cuyo UNICO trap es 'get' nunca dispara ese trap — se lee por descriptor, cae al comportamiento default del target", () => {
  let llamadasGet = 0
  const proxy = new Proxy(
    { color: "rojo" },
    {
      get(t, p) {
        llamadasGet++
        throw new Error("esto NUNCA deberia ejecutarse")
      },
    },
  )
  const copia = aceptado(proxy)
  assert.deepEqual(copia, { color: "rojo" })
  assert.equal(llamadasGet, 0, "el trap 'get' nunca se invoca")
})

test("un Proxy que lanza en 'ownKeys' se rechaza (trap que la materializacion SI invoca)", () => {
  const proxy = new Proxy(
    { a: 1 },
    {
      ownKeys() {
        throw new Error("ownKeys-boom")
      },
    },
  )
  rechazo(proxy)
})

test("un Proxy que lanza en 'getOwnPropertyDescriptor' se rechaza (trap que la materializacion SI invoca)", () => {
  const proxy = new Proxy(
    { a: 1 },
    {
      getOwnPropertyDescriptor() {
        throw new Error("getOwnPropertyDescriptor-boom")
      },
    },
  )
  rechazo(proxy)
})

test("un Proxy cuyo 'ownKeys' miente (agrega una clave inexistente) se rechaza por descriptor inconsistente, nunca crashea crudo", () => {
  const target = { a: 1 }
  const proxy = new Proxy(target, {
    ownKeys() {
      return ["a", "fantasma"]
    },
    getOwnPropertyDescriptor(t, p) {
      if (p === "fantasma") return undefined
      return Reflect.getOwnPropertyDescriptor(t, p)
    },
  })
  let r
  assert.doesNotThrow(() => {
    r = materializarDatosPlanos(proxy, "raiz")
  })
  assert.equal(r.ok, false)
})

// ────────────────────────────────────── arrays ────────────────────────────────────────

test("rechaza array con huecos", () => {
  const conHueco = [1, , 3]
  rechazo(conHueco)
})

test("rechaza array con propiedad extra fuera de indices/length", () => {
  const arr = [1, 2, 3]
  arr.extra = "sorpresa"
  rechazo(arr)
})

test("rechaza array con prototipo no estandar", () => {
  const arr = [1, 2, 3]
  Object.setPrototypeOf(arr, {})
  rechazo(arr)
})

test("acepta array vacio", () => {
  assert.deepEqual(aceptado([]), [])
})

// ────────────────────────────────────── ciclos ────────────────────────────────────────

test("rechaza un ciclo (el valor se referencia a si mismo)", () => {
  const obj = { a: 1 }
  obj.self = obj
  rechazo(obj)
})

test("rechaza un ciclo indirecto (a -> b -> a)", () => {
  const a = {}
  const b = { a }
  a.b = b
  rechazo(a)
})

test("NO rechaza dos referencias distintas al MISMO objeto compartido (no es un ciclo, sólo una referencia compartida — se duplica en la copia)", () => {
  const compartido = { x: 1 }
  const copia = aceptado({ uno: compartido, dos: compartido })
  assert.deepEqual(copia, { uno: { x: 1 }, dos: { x: 1 } })
})

// ──────────────────────────────────── límites ─────────────────────────────────────────

test("rechaza una entrada anidada mas alla del limite de profundidad, sin reventar la pila", () => {
  let profundo = { hoja: true }
  for (let i = 0; i < LIMITE_PROFUNDIDAD + 10; i++) profundo = { siguiente: profundo }
  let r
  assert.doesNotThrow(() => {
    r = materializarDatosPlanos(profundo, "raiz")
  }, "nunca debe reventar la pila, siempre un rechazo estructurado")
  assert.equal(r.ok, false)
})

test("acepta una entrada anidada bien DENTRO del limite de profundidad", () => {
  let profundo = { hoja: true }
  for (let i = 0; i < LIMITE_PROFUNDIDAD - 5; i++) profundo = { siguiente: profundo }
  const r = materializarDatosPlanos(profundo, "raiz")
  assert.equal(r.ok, true)
})

// ─────────────────────────────────── nunca lanza ──────────────────────────────────────

test("materializarDatosPlanos NUNCA lanza, ni siquiera ante una entrada adversarial que hace explotar cualquier trap", () => {
  const casos = [
    new Proxy({}, { ownKeys() { throw new Error("x") } }),
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("x") } }),
    (() => {
      const o = {}
      o.self = o
      return o
    })(),
    [1, , 3],
    10n,
    Symbol("x"),
    () => {},
  ]
  for (const caso of casos) {
    assert.doesNotThrow(() => materializarDatosPlanos(caso, "raiz"))
  }
})

// ─────────────────────────────── motivoEntradaNoPlano ─────────────────────────────────

test("motivoEntradaNoPlano envuelve el rechazo en un Motivo con el codigo unico ENTRADA_NO_ES_DATO_PLANO, la categoria la decide el llamador", () => {
  const r = materializarDatosPlanos(Symbol("x"), "operacion.payload")
  assert.equal(r.ok, false)
  const motivoOp = motivoEntradaNoPlano("operacion", r)
  assert.equal(motivoOp.codigo, "ENTRADA_NO_ES_DATO_PLANO")
  assert.equal(motivoOp.categoria, "operacion")
  assert.equal(motivoOp.clasificacion, "rechazo")
  assert.equal(motivoOp.datos.ruta, "operacion.payload")

  const motivoEstructural = motivoEntradaNoPlano("estructural", r)
  assert.equal(motivoEstructural.categoria, "estructural")
  assert.equal(motivoEstructural.codigo, motivoOp.codigo, "mismo codigo, distinta categoria segun quien lo emite (mismo criterio que CLAVE_DESCONOCIDA/AUTOCONEXION_INVALIDA)")
})
