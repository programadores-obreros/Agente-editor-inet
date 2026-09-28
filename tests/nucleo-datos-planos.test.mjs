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

test("acepta strings, booleans, null y numbers (incluidos NaN/±Infinity/-0) tal cual", () => {
  assert.equal(aceptado("hola"), "hola")
  assert.equal(aceptado(true), true)
  assert.equal(aceptado(false), false)
  assert.equal(aceptado(null), null)
  assert.equal(aceptado(0), 0)
  assert.equal(aceptado(-40), -40)
  assert.ok(Number.isNaN(aceptado(Number.NaN)), "NaN se copia tal cual — la finitud la deciden los validadores existentes")
  assert.equal(aceptado(Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY)
  assert.equal(aceptado(Number.NEGATIVE_INFINITY), Number.NEGATIVE_INFINITY)
  assert.ok(Object.is(aceptado(-0), -0), "-0 se copia tal cual, distinguible de +0")
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
