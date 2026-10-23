// Tests de la caché LRU del plugin tecnia-idioma (opencode/plugins/idioma/cache.ts).
// Corre con: node --test tests/idioma-cache.test.mjs
//
// POR QUÉ. El transform limpia todo el historial en cada paso. Con la caché
// vaciándose entera al llenarse, después del tope cada paso volvía a calcular
// todo; y sin tope de caracteres, una charla con logs pegados la hacía crecer
// sin fin. Se va la entrada usada hace más tiempo, y nunca se pasa el peso.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const { crearCache } = await import(join(REPO, "opencode/plugins/idioma/cache.ts"))

test("se va la entrada usada hace más tiempo, no toda la caché", () => {
  const c = crearCache(3, 1000)
  c.set("a", 1, 1)
  c.set("b", 2, 1)
  c.set("c", 3, 1)
  assert.equal(c.get("a"), 1) // "a" pasa a ser la más reciente
  c.set("d", 4, 1) // se va "b", la más vieja
  assert.equal(c.get("b"), undefined)
  assert.equal(c.get("a"), 1)
  assert.equal(c.get("c"), 3)
  assert.equal(c.get("d"), 4)
  assert.equal(c.size, 3)
})

test("el tope de peso se respeta y una entrada más pesada que el tope no entra", () => {
  const c = crearCache(100, 10)
  c.set("a", 1, 4)
  c.set("b", 2, 4)
  c.set("c", 3, 4) // 12 > 10: se va "a"
  assert.equal(c.get("a"), undefined)
  assert.equal(c.peso, 8)
  c.set("gigante", 9, 50)
  assert.equal(c.get("gigante"), undefined)
  assert.ok(c.peso <= 10)
})

test("reescribir una clave no duplica su peso", () => {
  const c = crearCache(10, 100)
  c.set("a", 1, 30)
  c.set("a", 2, 30)
  assert.equal(c.peso, 30)
  assert.equal(c.get("a"), 2)
})
