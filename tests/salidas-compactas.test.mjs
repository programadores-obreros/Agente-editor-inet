// Las tools que el modelo llama seguido devuelven JSON SIN sangría.
//
// POR QUÉ EXISTE (2026-11-27, prueba 10b en la notebook real, medido en opencode.db). Armar una
// estación de cuatro reglas llevó 36 minutos y la charla llegó a 141 mil tokens: OpenCode tuvo
// que resumirla. De todo lo que devolvieron las tools, el 60 % fue `proyecto-fisico leer`: cinco
// llamadas de 36 mil caracteres. La mitad de cada una eran espacios de sangría (`null, 2`).
//
// QUÉ MIRA. Que la salida sea EXACTAMENTE la forma compacta de sí misma (así una sangría que
// vuelva se nota, sea de dos espacios, de uno o un tabulador), que `resultado` siga siendo la
// primera clave (es lo que el modelo lee primero) y que nada del contenido se haya perdido.
// No pone un tope de tamaño: el catálogo crece con razón; lo que no puede volver es el relleno.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { REPO, nuevoDir } from "./phase2-helpers.mjs"

const { default: proyectoFisico } = await import(join(REPO, "opencode/tool/proyecto-fisico.ts"))
const { default: programa } = await import(join(REPO, "opencode/tool/programa.ts"))

const compacta = (crudo) => JSON.stringify(JSON.parse(crudo))
const OPERACIONES = [
  { tipo: "SetPlaca", payload: { placa: "esp32-devkit-v1" } },
  { tipo: "AgregarComponente", payload: { tipo: "pulsador" } },
  { tipo: "AgregarComponente", payload: { tipo: "led" } },
  { tipo: "AgregarComponente", payload: { tipo: "resistencia" } },
  { tipo: "AsignarPin", payload: { componente: "cmp-0", terminal: "senal", pin: "GPIO4" } },
  { tipo: "AsignarPin", payload: { componente: "cmp-1", terminal: "anodo", pin: "GPIO18" } },
  { tipo: "Conectar", payload: { desde: { componente: "cmp-2", terminal: "a" }, hasta: { componente: "cmp-1", terminal: "anodo" } } },
  { tipo: "SetComportamiento", payload: { comportamiento: { cuando: { sensor: "cmp-0", capacidad: "estadoBooleano", comparador: ">=", umbral: { valor: 1, unidad: "ninguna", magnitud: "estadoBooleano" } }, entonces: { actuador: "cmp-1", accion: "encender" } } } },
]

test("proyecto-fisico leer: sale sin sangría, con `resultado` primero y con todo su contenido", async () => {
  const dir = nuevoDir("salidas-compactas")
  const vacio = await proyectoFisico.execute({ accion: "leer" }, { directory: dir })
  assert.equal(vacio, compacta(vacio), "volvió la sangría")
  const r = JSON.parse(vacio)
  assert.equal(Object.keys(r)[0], "resultado")
  // Lo que el asistente necesita para planificar sigue viniendo en la misma respuesta.
  for (const clave of ["vocabulario", "condicionesNumericas", "generabilidad"]) assert.ok(r[clave] && typeof r[clave] === "object", `falta ${clave}`)
  assert.ok(r.vocabulario.componentes.length > 3)
  assert.ok(r.generabilidad.componentes.length > 3)

  const aplicado = JSON.parse(await proyectoFisico.execute({ accion: "aplicar", baseRevision: r.revision, operaciones: OPERACIONES }, { directory: dir }))
  assert.equal(aplicado.ok, true, JSON.stringify(aplicado))
  const armado = await proyectoFisico.execute({ accion: "leer" }, { directory: dir })
  assert.equal(armado, compacta(armado), "volvió la sangría (proyecto armado)")
  assert.equal(JSON.parse(armado).reglas.length, 1)
})

test("proyecto-fisico: el rechazo por idProyecto inválido también sale compacto", async () => {
  const crudo = await proyectoFisico.execute({ accion: "leer", idProyecto: "../afuera" }, { directory: nuevoDir("salidas-compactas-id") })
  assert.equal(JSON.parse(crudo).ok, false)
  assert.equal(crudo, compacta(crudo))
})

test("programa: generar y el rechazo salen sin sangría, con `resultado` primero", async () => {
  const dir = nuevoDir("salidas-compactas-programa")
  const sinArmar = await programa.execute({ accion: "generar" }, { directory: dir })
  assert.equal(sinArmar, compacta(sinArmar))
  assert.equal(JSON.parse(sinArmar).ok, false)
  const { revision } = JSON.parse(await proyectoFisico.execute({ accion: "leer" }, { directory: dir }))
  assert.equal(JSON.parse(await proyectoFisico.execute({ accion: "aplicar", baseRevision: revision, operaciones: OPERACIONES }, { directory: dir })).ok, true)
  const generado = await programa.execute({ accion: "generar" }, { directory: dir })
  assert.equal(generado, compacta(generado))
  const g = JSON.parse(generado)
  assert.equal(g.ok, true, generado)
  assert.equal(Object.keys(g)[0], "resultado")
})
