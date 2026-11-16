// `install/install.sh` EJECUTADO DE VERDAD, mirando lo que dejó en el disco.
//
// POR QUÉ ESTE ARCHIVO. `tests/modelo.test.mjs` y `tests/opencode-version.test.mjs`
// miran con regex que el script «escriba» default_agent, el modelo, small_model y
// autoupdate. Eso prueba que el TEXTO está, no que la config quede escrita: se
// podía romper el filtro de jq entero dejando una línea que matchea y seguían en
// verde. Y `tests/empaquetado-instalado.test.mjs` corre el instalador pero nunca
// abre opencode.json. Nadie miraba el archivo.
//
// Acá se corre el script del árbol de trabajo en un HOME propio (mkdtemp) y se
// LEE lo que escribió, una vez por cada camino: con jq y sin python3, y con
// python3 y sin jq. «Sin» es de verdad: el PATH es una carpeta armada que no
// tiene la herramienta (ver tests/ayuda-instalador-sh.mjs).
//
// VERIFICADO POR MUTACIÓN (cada una pone rojo este archivo, exit code 1):
//   - borrar `| .autoupdate = false` del filtro de jq            → rojo el caso jq
//   - borrar `oc["small_model"] = modelo` del python embebido    → rojo el caso python3
//   - cambiar `.instructions = ((.instructions // []) | if any(. == $memoria)`
//     por `$perfil` (la memoria no entra a instructions)         → rojo el caso jq
//
// Corre con: node --test tests/instalador-linux-real.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, armarBin, correr, nuevoHome, puedeCorrer, rutaDe } from "./ayuda-instalador-sh.mjs"

const INSTALL = join(REPO, "install", "install.sh")
const fuente = readFileSync(INSTALL, "utf8")
const leerJson = (ruta) => JSON.parse(readFileSync(ruta, "utf8"))

// Los valores esperados salen del script, no se copian acá: si mañana cambia el
// modelo, este test sigue midiendo que lo ESCRITO es lo que el script eligió.
const deScript = (nombre) => {
  const m = fuente.match(new RegExp(`^${nombre}="?([^"\\n]+)"?$`, "m"))
  assert.ok(m, `install.sh ya no define ${nombre}`)
  return m[1]
}
const MODELO_SIN_KEY = deScript("MODELO_SIN_KEY")
const AGENTE = deScript("TECNIA_AGENT")
const THEME = deScript("TECNIA_THEME")
const PLUGIN = deScript("TECNIA_PLUGIN")
const TIMEOUT_MS = Number(deScript("TIMEOUT_MODELO_MS"))

const jq = rutaDe("jq")
const python3 = rutaDe("python3")

// ── 1.4 · el CONTENIDO de la config, por los dos caminos ─────────────────────

/** Lo que tiene que quedar en disco después de instalar, sea cual sea el camino. */
function verificarConfig(h, etiqueta) {
  const oc = leerJson(join(h.configDir, "opencode.json"))
  const tui = leerJson(join(h.configDir, "tui.json"))
  const perfil = join(h.configDir, "tecnia-perfil.md")
  const memoria = join(h.configDir, "tecnia-memoria.md")

  assert.equal(oc.default_agent, AGENTE, `${etiqueta}: default_agent`)
  assert.equal(oc.agent?.[AGENTE]?.model, MODELO_SIN_KEY, `${etiqueta}: el modelo del agente (sin key va Big Pickle)`)
  assert.equal(oc.small_model, MODELO_SIN_KEY, `${etiqueta}: small_model tiene que ser el mismo modelo`)
  assert.strictEqual(oc.autoupdate, false, `${etiqueta}: autoupdate tiene que quedar en false (si no, el pin de OpenCode no sirve)`)
  assert.ok(Array.isArray(oc.instructions), `${etiqueta}: instructions no es una lista`)
  assert.ok(oc.instructions.includes(perfil), `${etiqueta}: instructions no trae la ruta del perfil (${perfil})`)
  assert.ok(oc.instructions.includes(memoria), `${etiqueta}: instructions no trae la ruta de la memoria (${memoria})`)
  const proveedor = MODELO_SIN_KEY.split("/")[0]
  assert.equal(oc.provider?.[proveedor]?.options?.headerTimeout, TIMEOUT_MS, `${etiqueta}: headerTimeout del proveedor`)
  assert.equal(oc.provider?.[proveedor]?.options?.chunkTimeout, TIMEOUT_MS, `${etiqueta}: chunkTimeout del proveedor`)

  assert.equal(tui.theme, THEME, `${etiqueta}: theme`)
  assert.ok(Array.isArray(tui.plugin) && tui.plugin.includes(PLUGIN), `${etiqueta}: el plugin del logo no quedó en tui.json`)
  return { oc, tui, perfil, memoria }
}

for (const [camino, herramienta, real] of [["jq", "jq", jq], ["python3", "python3", python3]]) {
  test(`install.sh (camino ${camino}) escribe default_agent, modelo, small_model, autoupdate e instructions`, { skip: !puedeCorrer || !real }, () => {
    const h = nuevoHome()
    try {
      const path = armarBin(h.base, [herramienta])
      const r = correr(INSTALL, h, { path, env: { TECNIA_SIN_PROMPT: "1" } })
      assert.equal(r.status, 0, `install.sh salió con ${r.status}:\n${r.salida}`)
      // Que el camino medido sea el que dice el título: si el PATH armado dejara
      // colarse la otra herramienta, este test mediría dos veces lo mismo.
      assert.match(r.salida, new RegExp(`actualizados \\(via ${camino}\\)`), `no fue por el camino ${camino}:\n${r.salida}`)
      verificarConfig(h, camino)
    } finally {
      rmSync(h.base, { recursive: true, force: true })
    }
  })

  test(`install.sh (camino ${camino}) mergea sin pisar lo del docente, y correrlo dos veces no duplica nada`, { skip: !puedeCorrer || !real }, () => {
    const h = nuevoHome()
    try {
      const path = armarBin(h.base, [herramienta])
      mkdirSync(h.configDir, { recursive: true })
      writeFileSync(join(h.configDir, "opencode.json"), JSON.stringify({
        default_agent: "build",
        autoupdate: true,
        instructions: ["/apuntes/del-docente.md"],
        agent: { otro: { model: "x/y" } },
        provider: { anthropic: { options: { baseURL: "https://ejemplo.invalid" } } },
      }))
      writeFileSync(join(h.configDir, "tui.json"), JSON.stringify({ plugin: ["./otro.tsx"], keybinds: { leader: "ctrl+x" } }))

      for (const vuelta of [1, 2]) {
        const r = correr(INSTALL, h, { path, env: { TECNIA_SIN_PROMPT: "1" } })
        assert.equal(r.status, 0, `vuelta ${vuelta}: install.sh salió con ${r.status}:\n${r.salida}`)
      }
      const { oc, tui, perfil, memoria } = verificarConfig(h, camino)
      // Lo del docente sigue.
      assert.ok(oc.instructions.includes("/apuntes/del-docente.md"), "se llevó puesta una instrucción del docente")
      assert.equal(oc.agent.otro.model, "x/y", "se llevó puesto otro agente del docente")
      assert.equal(oc.provider.anthropic.options.baseURL, "https://ejemplo.invalid", "se llevó puesto otro proveedor del docente")
      assert.ok(tui.plugin.includes("./otro.tsx"), "se llevó puesto otro plugin del docente")
      assert.equal(tui.keybinds.leader, "ctrl+x", "se llevó puesta una tecla del docente")
      // Y la segunda vuelta no duplicó.
      assert.equal(oc.instructions.filter((x) => x === perfil).length, 1, "el perfil quedó dos veces en instructions")
      assert.equal(oc.instructions.filter((x) => x === memoria).length, 1, "la memoria quedó dos veces en instructions")
      assert.equal(tui.plugin.filter((x) => x === PLUGIN).length, 1, "el plugin del logo quedó dos veces")
    } finally {
      rmSync(h.base, { recursive: true, force: true })
    }
  })
}
