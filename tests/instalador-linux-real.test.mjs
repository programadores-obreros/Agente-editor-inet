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
// ── 1.3 · UN OK FALSO CON LA CONFIG ROTA ─────────────────────────────────────
//
// Con un opencode.json que no parsea, install.sh avisaba por stderr «lo dejo
// intacto», devolvía 0, e imprimía `[OK] tui.json y opencode.json actualizados` y
// `==> Listo! Tecnia Bot instalado.`. El agente por defecto y el modelo NO habían
// quedado escritos y la última palabra era un OK. Desde /actualizar era peor: la
// tool muestra sólo la cola de la salida y el aviso quedaba arriba.
//
// Ahora: sin `[OK]`, cierre «instalado CON AVISOS» con la lista de lo que falta
// en las ÚLTIMAS líneas, y código de salida 3 (documentado en el encabezado de
// install.sh; lo leen update.sh y opencode/tool/actualizar.ts).
//
// Las fallas son reales: un JSON roto escrito en disco y un archivo sin permiso
// de escritura. MUTACIONES que ponen rojo este archivo (exit code 1):
//   - borrar el `exit 3` del final de install.sh               → rojos los tres casos
//   - `merge_opencode_jq || OC_SIN_TOCAR=1` → `|| true`         → rojo el caso jq
//   - borrar el `sin_tocar += 20` de la rama «no pude parsear»  → rojo el caso python3
//   - `if not dump(oc_path, oc):` → `if False:` (no mira si escribió) → rojo el de sólo lectura
//
// Corre con: node --test tests/instalador-linux-real.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, armarBin, correr, esRoot, nuevoHome, puedeCorrer, rutaDe } from "./ayuda-instalador-sh.mjs"

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
      // El contrapeso de los tests de «CON AVISOS» de abajo: sano, cierra limpio.
      assert.match(r.salida, /==> Listo! Tecnia Bot v[0-9.]+ instalado\./, r.salida)
      assert.doesNotMatch(r.salida, /CON AVISOS/, `una instalación sana dice que tiene avisos:\n${r.salida}`)
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

// ── 1.3 · config que no se puede leer o escribir: nada de OK falso ───────────

const CODIGO_CON_AVISOS = 3

/** Lo que tiene que pasar SIEMPRE que opencode.json quedó sin tocar. */
function verificarCierreConAvisos(r, h, etiqueta) {
  const ruta = join(h.configDir, "opencode.json")
  assert.equal(r.status, CODIGO_CON_AVISOS, `${etiqueta}: esperaba el código ${CODIGO_CON_AVISOS} (instalado CON AVISOS) y salió ${r.status}:\n${r.salida}`)
  assert.doesNotMatch(r.stdout, /\[OK\][^\n]*(actualizad|Config)/, `${etiqueta}: imprime un [OK] de la config sin haberla escrito:\n${r.stdout}`)
  assert.doesNotMatch(r.stdout, /==> Listo!/, `${etiqueta}: cierra con «Listo!» sin haber escrito la config:\n${r.stdout}`)
  // El resumen está en STDOUT (stderr se puede perder por el camino) y es lo ÚLTIMO.
  const iResumen = r.stdout.lastIndexOf("instalado CON AVISOS. Falta:")
  assert.ok(iResumen >= 0, `${etiqueta}: el cierre no dice «instalado CON AVISOS» con lo que falta:\n${r.stdout}`)
  assert.ok(iResumen > r.stdout.lastIndexOf("Para empezar"), `${etiqueta}: el resumen de avisos no es lo último que se lee`)
  const cola = r.stdout.slice(iResumen)
  assert.ok(cola.includes(ruta), `${etiqueta}: el resumen no nombra el archivo que quedó sin tocar (${ruta}):\n${cola}`)
  // /actualizar muestra los últimos 2000 caracteres de stdout y update.sh agrega
  // unas líneas después de éstas: con 1200 el resumen entra entero y sobra.
  assert.ok(cola.length < 1200, `${etiqueta}: el resumen mide ${cola.length} caracteres; actualizar.ts muestra 2000 y update.sh agrega su cierre`)
  // Y los archivos de la capa SÍ se copiaron: «instalado» no es mentira.
  assert.ok(existsSync(join(h.configDir, "agent", "tecnia-bot.md")), `${etiqueta}: dice instalado y la capa no está`)
}

for (const [camino, herramienta, real] of [["jq", "jq", jq], ["python3", "python3", python3]]) {
  test(`install.sh (camino ${camino}) con opencode.json roto: no lo pisa, no dice OK, y sale con 3`, { skip: !puedeCorrer || !real }, () => {
    const h = nuevoHome()
    try {
      const path = armarBin(h.base, [herramienta])
      mkdirSync(h.configDir, { recursive: true })
      const roto = '{ "model": "anthropic/claude", esto no es JSON\n'
      writeFileSync(join(h.configDir, "opencode.json"), roto)
      const r = correr(INSTALL, h, { path, env: { TECNIA_SIN_PROMPT: "1" } })
      assert.equal(readFileSync(join(h.configDir, "opencode.json"), "utf8"), roto, "pisó un opencode.json que no pudo leer")
      verificarCierreConAvisos(r, h, camino)
      // tui.json no tenía nada malo: ése sí se escribió, y no figura como pendiente.
      assert.equal(leerJson(join(h.configDir, "tui.json")).theme, THEME, "por culpa de opencode.json dejó sin escribir tui.json")
      assert.ok(!r.stdout.slice(r.stdout.lastIndexOf("instalado CON AVISOS. Falta:")).includes(join(h.configDir, "tui.json")),
        "anota como pendiente un tui.json que sí escribió")
    } finally {
      rmSync(h.base, { recursive: true, force: true })
    }
  })
}

test("install.sh (camino python3) con opencode.json de sólo lectura: sin traza de Python, sin OK, y sale con 3", { skip: !puedeCorrer || !python3 || esRoot }, () => {
  const h = nuevoHome()
  const ruta = join(h.configDir, "opencode.json")
  try {
    const path = armarBin(h.base, ["python3"])
    mkdirSync(h.configDir, { recursive: true })
    const original = '{"model":"anthropic/claude"}\n'
    writeFileSync(ruta, original)
    chmodSync(ruta, 0o444)
    const r = correr(INSTALL, h, { path, env: { TECNIA_SIN_PROMPT: "1" } })
    assert.equal(readFileSync(ruta, "utf8"), original, "el archivo era de sólo lectura y cambió: revisar el test")
    assert.doesNotMatch(r.salida, /Traceback/, `le tira una traza de Python al docente:\n${r.salida}`)
    verificarCierreConAvisos(r, h, "sólo lectura")
  } finally {
    try { chmodSync(ruta, 0o644) } catch { /* no llegó a crearse */ }
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("el código de «instalado CON AVISOS» es el mismo en install.sh, update.sh y actualizar.ts", () => {
  // Este número es un contrato entre tres archivos. Los funcionales de arriba miden
  // que install.sh sale con él; acá se ata a los dos que lo leen.
  const sinComentarios = (x) => x.replace(/^\s*#.*$/gm, "")
  assert.match(sinComentarios(fuente), new RegExp(`\\n  exit ${CODIGO_CON_AVISOS}\\nfi\\n`), "install.sh ya no sale con ese código")
  assert.match(fuente, new RegExp(`^#   ${CODIGO_CON_AVISOS}  instalado CON AVISOS`, "m"), "el encabezado de install.sh no documenta el código")
  const update = sinComentarios(readFileSync(join(REPO, "install", "update.sh"), "utf8"))
  assert.match(update, new RegExp(`\\n  ${CODIGO_CON_AVISOS}\\)[\\s\\S]*?CON AVISOS[\\s\\S]*?exit ${CODIGO_CON_AVISOS}\\n`), "update.sh no pasa el código tal cual")
  const tool = readFileSync(join(REPO, "opencode", "tool", "actualizar.ts"), "utf8")
  assert.match(tool, new RegExp(`const CODIGO_CON_AVISOS = ${CODIGO_CON_AVISOS}\\b`), "actualizar.ts espera otro código")
})
