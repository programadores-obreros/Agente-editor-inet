// `proyecto-fisico leer` le dice al asistente a qué está CONECTADA cada pieza.
//
// POR QUÉ EXISTE (2026-11-27, prueba 11 en la notebook real). El asistente contestó «las cuatro
// resistencias están agregadas, todavía sin conectar» de un proyecto que las tenía conectadas,
// cada una al ánodo de su LED (así estaban dibujadas en la ventana). No inventó: `leer` le
// describía la resistencia como «a → puente (sin destino fijo), b → puente (sin destino fijo)»
// y las conexiones de la IR no viajaban en ningún campo. Con eso, cualquiera lee «suelta».
//
// QUÉ MIRAN. El proyecto se arma por la tool real y se compara el TEXTO ENTERO de la
// descripción: una prueba que sólo buscara la palabra «conectado» seguiría verde si nombrara
// la pieza equivocada o el terminal equivocado. La segunda prueba es el control: una resistencia
// agregada y sin conectar tiene que seguir diciéndose sin conectar (si no, el arreglo sería
// decir «conectado» siempre).

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, nuevoDir } from "./phase2-helpers.mjs"

const { default: proyectoFisico } = await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))
const { CONOCIMIENTO_ACTIVO: K } = await import(join(REPO, "opencode/conocimiento/conocimiento-activo.ts"))

const leer = async (dir) => JSON.parse(await proyectoFisico.execute({ accion: "leer" }, { directory: dir }))
async function aplicar(dir, operaciones) {
  const { revision } = await leer(dir)
  const r = JSON.parse(await proyectoFisico.execute({ accion: "aplicar", baseRevision: revision, operaciones }, { directory: dir }))
  assert.equal(r.ok, true, JSON.stringify(r))
}
const LED = K.nombre("componente", "led")
const RESISTENCIA = K.nombre("componente", "resistencia")
const BASE = [
  { tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } },
  { tipo: "AgregarComponente", payload: { tipo: "led" } },
  { tipo: "AgregarComponente", payload: { tipo: "led" } },
  { tipo: "AgregarComponente", payload: { tipo: "resistencia" } },
  { tipo: "AgregarComponente", payload: { tipo: "resistencia" } },
  { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "anodo", pin: "GPIO21" } },
  { tipo: "AsignarPin", payload: { componente: "cmp-1", terminal: "anodo", pin: "GPIO22" } },
]

test("leer: una resistencia conectada se describe conectada, con el terminal y la pieza del otro extremo", async () => {
  const dir = nuevoDir("leer-conexiones")
  // La segunda conexión va «al revés» (del LED a la resistencia), como la arma a veces el asistente.
  await aplicar(dir, [
    ...BASE,
    { tipo: "Conectar", payload: { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-0", terminal: "anodo" } } },
    { tipo: "Conectar", payload: { desde: { componente: "cmp-1", terminal: "anodo" }, hasta: { componente: "cmp-3", terminal: "a" } } },
  ])
  const porId = Object.fromEntries((await leer(dir)).componentes.map((c) => [c.id, c.descripcionPines]))
  assert.equal(typeof LED, "string")
  assert.equal(typeof RESISTENCIA, "string")
  assert.equal(porId["cmp-2"], `a → conectado a anodo de cmp-0 (${LED}), b → puente (sin destino fijo)`)
  assert.equal(porId["cmp-3"], `a → conectado a anodo de cmp-1 (${LED}), b → puente (sin destino fijo)`, "cada resistencia con SU led, no con el primero")
  assert.equal(porId["cmp-0"], `anodo → GPIO21, conectado a a de cmp-2 (${RESISTENCIA}), catodo → GND (fijo)`)
  assert.equal(porId["cmp-1"], `anodo → GPIO22, conectado a a de cmp-3 (${RESISTENCIA}), catodo → GND (fijo)`)
})

test("leer: lo que NO está conectado no se dice conectado (el control)", async () => {
  const dir = nuevoDir("leer-conexiones-sueltas")
  await aplicar(dir, BASE)
  const porId = Object.fromEntries((await leer(dir)).componentes.map((c) => [c.id, c.descripcionPines]))
  assert.equal(porId["cmp-2"], "a → puente (sin destino fijo), b → puente (sin destino fijo)")
  assert.equal(porId["cmp-0"], "anodo → GPIO21, catodo → GND (fijo)")
  // Y conectar UNA no contagia a la otra.
  await aplicar(dir, [{ tipo: "Conectar", payload: { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-0", terminal: "anodo" } } }])
  const despues = Object.fromEntries((await leer(dir)).componentes.map((c) => [c.id, c.descripcionPines]))
  assert.equal(despues["cmp-3"], "a → puente (sin destino fijo), b → puente (sin destino fijo)")
  assert.equal(despues["cmp-1"], "anodo → GPIO22, catodo → GND (fijo)")
  assert.match(despues["cmp-2"], /^a → conectado a anodo de cmp-0 /)
})

// ── agregadas por la revisión independiente del 2026-11-27 ──────────────────────────────────
// La revisión mutó tres ramas y las tres pruebas de arriba siguieron en verde: el terminal FIJO
// conectado (el cátodo del LED), dos cables al MISMO terminal, y el terminal de un documento
// histórico con un pin puesto a mano. Si alguna se rompe vuelve el incidente original: el
// asistente diciendo «sin conectar» de algo conectado.

test("leer: un terminal fijo conectado lo dice, y dos cables al mismo terminal se dicen los DOS", async () => {
  const dir = nuevoDir("leer-conexiones-fijo")
  await aplicar(dir, [
    ...BASE,
    { tipo: "Conectar", payload: { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-0", terminal: "anodo" } } },
    { tipo: "Conectar", payload: { desde: { componente: "cmp-3", terminal: "a" }, hasta: { componente: "cmp-0", terminal: "anodo" } } },
    { tipo: "Conectar", payload: { desde: { componente: "cmp-2", terminal: "b" }, hasta: { componente: "cmp-0", terminal: "catodo" } } },
  ])
  const porId = Object.fromEntries((await leer(dir)).componentes.map((c) => [c.id, c.descripcionPines]))
  assert.equal(porId["cmp-0"], `anodo → GPIO21, conectado a a de cmp-2 (${RESISTENCIA}) y a a de cmp-3 (${RESISTENCIA}), catodo → GND (fijo), conectado a b de cmp-2 (${RESISTENCIA})`)
  assert.equal(porId["cmp-2"], `a → conectado a anodo de cmp-0 (${LED}), b → conectado a catodo de cmp-0 (${LED})`)
})

test("descripción pura: un terminal no asignable con un pin histórico Y una conexión dice las dos cosas", async () => {
  const { descripcionPinesDeComponente } = await import(join(REPO, "opencode/conocimiento/vocabulario.ts"))
  const led = { id: "cmp-0", tipo: "led", pines: { anodo: "GPIO21" } }
  const historica = { id: "cmp-2", tipo: "resistencia", pines: { a: "GPIO18" } }
  const proyecto = { componentes: [led, historica], conexiones: [{ id: "conn-9", desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-0", terminal: "anodo" } }] }
  assert.equal(
    descripcionPinesDeComponente(historica, K.catalogo, proyecto),
    `a → GPIO18 (asignado directo — fuera del patrón esperado para este terminal), conectado a anodo de cmp-0 (${LED}), b → puente (sin destino fijo)`,
  )
  // Sin el proyecto (quien llame sin él) la descripción es la de antes: no inventa una conexión.
  assert.equal(descripcionPinesDeComponente(historica, K.catalogo), "a → GPIO18 (asignado directo — fuera del patrón esperado para este terminal), b → puente (sin destino fijo)")
})
