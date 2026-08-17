// Todo tool que exista tiene que estar permitido en el agente.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El agente arranca con `"*": "deny"` y una lista
// blanca. Si alguien agrega un tool a `opencode/tool/` y se olvida de sumarlo a
// esa lista, el tool queda DENEGADO — y el defecto es invisible: el archivo
// existe, la skill lo menciona, el modelo lo intenta, y no pasa nada.
//
// Pasó con `ficha` en la v0.3.42: el tool estaba escrito, testeado, empaquetado
// y publicado, y no podía ejecutarse. El modelo hacía lo único que tenía
// permitido —`read` sobre el PDF, `webfetch` sobre file://— y quedaba como si
// no supiera abrir un archivo.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Los tools que existen en el repo, por nombre de archivo sin extensión. */
function toolsQueExisten() {
  return readdirSync(join(REPO, "opencode", "tool"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.replace(/\.ts$/, ""))
    .sort()
}

/** Los nombres que el agente declara con "allow" en su bloque `permission`. */
function toolsPermitidos() {
  const md = readFileSync(join(REPO, "opencode", "agent", "tecnia-bot.md"), "utf8")
  const fm = md.split("---")[1] ?? ""
  return [...fm.matchAll(/^\s{2}([a-z][a-z0-9_-]*):\s*"allow"\s*$/gim)].map((m) => m[1])
}

test("el agente deniega todo por defecto", () => {
  // Si esto cambiara, el resto de este archivo dejaría de importar — y habría
  // que revisar la decisión, no borrar el test.
  const md = readFileSync(join(REPO, "opencode", "agent", "tecnia-bot.md"), "utf8")
  assert.match(md, /"\*":\s*"deny"/, 'el agente ya no arranca con "*": "deny"')
})

test("todos los tools del repo están permitidos en el agente", () => {
  const existen = toolsQueExisten()
  const permitidos = toolsPermitidos()
  const faltan = existen.filter((t) => !permitidos.includes(t))
  assert.deepEqual(
    faltan,
    [],
    `estos tools existen pero NO están permitidos en opencode/agent/tecnia-bot.md: ` +
      `${faltan.join(", ")}. Con '"*": "deny"' quedan inutilizables.`,
  )
})

test("no se permiten tools que no existen", () => {
  // Un permiso de más no rompe nada, pero es señal de que se borró un tool y
  // quedó el permiso colgado — o de un typo que deja el tool real denegado.
  const existen = toolsQueExisten()
  const nativos = [
    "read", "glob", "grep", "list", "question", "skill",
    "edit", "write", "bash", "webfetch", "websearch", "task", "todowrite", "patch",
  ]
  const sobran = toolsPermitidos().filter((p) => !existen.includes(p) && !nativos.includes(p))
  assert.deepEqual(sobran, [], `permisos para tools que no existen: ${sobran.join(", ")}`)
})
