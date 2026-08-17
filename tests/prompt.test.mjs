// El prompt del agente no puede prometer cosas que el tool no tiene.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El prompt le decía al agente que llamara a
// `platformio` con las acciones `build` y `upload`. El schema del tool sólo
// acepta `compile`, `flash`, `both`, `monitor` y `diagnostico`. Si el modelo
// hacía caso al prompt, la llamada fallaba — y el defecto es invisible desde el
// código: los dos archivos están bien por separado, el problema es que no
// coinciden.
//
// Es la misma familia que el tool `ficha` sin permiso: todo parecía en orden.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const prompt = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
const toolSrc = readFileSync(join(REPO, "opencode/tool/platformio.ts"), "utf8")

/** Las acciones que el tool acepta de verdad, leídas de su schema. */
function accionesDelTool() {
  const m = toolSrc.match(/\.enum\(\[([^\]]+)\]\)/)
  assert.ok(m, "no encontré el enum de acciones en platformio.ts")
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))
}

test("el tool declara las acciones que esperamos", () => {
  const acciones = accionesDelTool()
  assert.deepEqual(acciones.sort(), ["both", "compile", "diagnostico", "flash", "monitor"])
})

test("el prompt no nombra acciones de platformio que no existen", () => {
  const acciones = accionesDelTool()
  // Sólo miramos el párrafo que enumera las acciones, para no confundir una
  // palabra suelta del texto pedagógico con un nombre de acción.
  const linea = prompt.split("\n").find((l) => l.includes("Las acciones son exactamente"))
  assert.ok(linea, "el prompt tiene que enumerar las acciones válidas")
  const citadas = [...linea.matchAll(/`([a-z]+)`/g)].map((m) => m[1])
  const inventadas = citadas.filter((c) => !acciones.includes(c) && c !== "platformio")
  assert.deepEqual(inventadas, [], `el prompt nombra acciones que no existen: ${inventadas.join(", ")}`)
  // Y que estén todas las que hay que usar.
  for (const necesaria of ["compile", "flash", "both"]) {
    assert.ok(citadas.includes(necesaria), `falta ${necesaria} en la lista del prompt`)
  }
})

test("el prompt obliga a compilar antes de mostrar el código", () => {
  assert.match(
    prompt,
    /el código se compila ANTES de mostrarlo/i,
    "se cayó la regla de compilar antes de entregar",
  )
  assert.match(prompt, /hasta dos veces/i, "falta el tope de reintentos")
})

test("el prompt NO encadena la carga a la compilación", () => {
  // Cargar es una acción física sobre hardware y la decide el docente.
  assert.match(prompt, /No encadenes el\s+`?flash`? al `?compile`?/i)
  assert.match(prompt, /No cargues/i)
})
