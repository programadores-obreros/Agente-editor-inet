// Phase 3 — T6a: contrato del PROMPT del agente (HD-05, acotado) para el pedido de comportamiento
// de NIVEL. No prueba al LLM: prueba que el texto del prompt instruye lo que el contrato exige
// (contrato B7, último bullet) sin romper F-15 (código sólo ante un pedido EXPLÍCITO).

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const prompt = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")

function bloque() {
  const i = prompt.indexOf("Pedido de COMPORTAMIENTO sin pedido de código")
  assert.ok(i >= 0, "no encontré la sección de comportamiento")
  const j = prompt.indexOf("NUNCA PEGUES EL CÓDIGO POR DEFECTO")
  assert.ok(j > i)
  return prompt.slice(i, j)
}

test("T6a el bloque instruye leer -> SetComportamiento (forma del vocabulario) -> afirmar sólo tras APLICADO", () => {
  const b = bloque()
  const iLeer = b.indexOf("leer")
  const iSet = b.indexOf("SetComportamiento")
  const iAplicado = b.indexOf("APLICADO")
  assert.ok(iLeer >= 0 && iSet > iLeer && iAplicado > iSet, "el orden tiene que ser leer -> SetComportamiento -> APLICADO")
  assert.match(b, /vocabulario/)
  assert.match(b, /baseRevision/)
  assert.match(b, /UN (solo )?`?SetComportamiento`?|un único `?SetComportamiento`?/i)
})

test("T6a la regla se cuenta con el `texto` de leer, con el reposo apagado y aclarando que no es código en la placa", () => {
  const b = bloque()
  assert.match(b, /reglas\[i\]\.texto|`texto`/)
  assert.match(b, /apagad/i)
  assert.match(b, /reposo|soltás|solt[aá]s/i)
  assert.match(b, /no es (c[oó]digo|un programa)|no corre en la placa|no es lo que (está )?corr/i)
})

test("T6a quitar/deshacer: leer -> QuitarComportamiento con el id de la regla, afirmando tras APLICADO", () => {
  const b = bloque()
  assert.match(b, /QuitarComportamiento/)
  assert.match(b, /quit[aá]|deshac/i)
})

test("T6a redacción ambigua ('cuando aprieto'): UNA pregunta con la lectura de nivel, antes de crear nada", () => {
  const b = bloque()
  assert.match(b, /¿Querés que el LED esté prendido mientras mantenés apretado el pulsador\?/)
  assert.match(b, /antes de crear/i)
})

test("T6a evento/latch/toggle NO se convierte en regla de nivel: se explica que esta versión sólo arma reglas 'mientras'", () => {
  const b = bloque()
  assert.match(b, /quede prendido|una vez apretado|cada vez que aprieto/i)
  assert.match(b, /s[oó]lo (arma|construye|sabe armar).{0,60}mientras|solo (arma|construye).{0,60}mientras/i)
  assert.match(b, /no (lo )?convert[ií]s|NO (lo )?convert/i)
})

test("T6a F-15 sigue: código/PlatformIO/compilar sólo ante un pedido EXPLÍCITO; ninguna pregunta de cierre ofrece código", () => {
  const b = bloque()
  assert.match(b, /EXPL[ÍI]CITAMENTE|EXPL[ÍI]CITO/)
  for (const pregunta of b.match(/¿[^?]+\?/g) ?? []) assert.doesNotMatch(pregunta, /c[oó]digo|c\+\+|platformio/i, pregunta)
  assert.match(b, /no apl(ica|ique)/i)
})

test("T6a el texto para el alumno no filtra el literal técnico de la condición", () => {
  const b = bloque()
  assert.doesNotMatch(b, /estadoBooleano/)
  assert.doesNotMatch(b, />=/)
  assert.doesNotMatch(b, /TODAV[ÍI]A NO SE PUEDE CONSTRUIR/)
})
