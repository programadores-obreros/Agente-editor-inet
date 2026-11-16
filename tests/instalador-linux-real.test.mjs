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
// ── 1.5 y 1.6 · LA KEY: permisos, línea de comandos, y un auth.json roto ──────
//
// Tres defectos del guardado de la key, los tres en el camino de python3:
//   - auth.json, tecnia-perfil.md y tecnia-memoria.md nacían 0644 (umask 022).
//   - la key viajaba por argv: `python3 - "$AUTH_FILE" "$GEMINI_KEY"` y
//     `jq --arg k "$GEMINI_KEY"`. Un `ps` de otra terminal la mostraba entera.
//   - con un auth.json que no parsea, python3 hacía `except: d = {}` y lo pisaba:
//     se perdían las otras credenciales. jq se negaba; python3 no.
//
// Acá se PEGA una key por la entrada estándar (lo que hace la docente) y se mira
// el disco. La prueba contra Google no sale a Internet: con python3 el entorno
// trae un proxy que rechaza la conexión (127.0.0.1:9) y sin python3 el PATH no
// tiene curl. En los dos casos el instalador contesta «no pude probarla» y
// guarda, que es lo que hace en una escuela con la red filtrada.
//
// CÓMO SE MIRA EL ARGV sin simular nada: `python3` y `jq` del PATH armado son un
// envoltorio que anota sus argumentos en un archivo y después hace `exec` del
// binario de verdad. El trabajo lo hace el python3/jq real.
//
// MUTACIONES que ponen rojo este archivo (exit code 1):
//   - `( umask 077; cat > "$PERFIL_FILE" )` → sin el umask      → rojos los dos de permisos
//   - `os.open(..., 0o600)` → `0o644`                            → rojo el de python3
//   - agregar `"$GEMINI_KEY"` a los argumentos de `python3 -`    → rojo el de python3
//   - en el `jq -n` que crea auth.json, `key: env.TECNIA_KEY_A_GUARDAR` →
//     `--arg k "$GEMINI_KEY"` + `key: $k`                         → rojo el de jq
//   - en el python de guardar_key_google, `except ValueError: sys.exit(5)` →
//     `d = {}` (el defecto original)                             → rojo el de auth.json roto (python3)
//   - en la rama jq, `if [ -s "$AUTH_FILE" ]; then` → `if false; then` (escribe
//     de cero sin leer)                                          → rojo el de auth.json roto (jq)
//
// SIN PROBAR: el modo con que nacen los archivos en macOS (APFS) y con ACLs.
//
// ── 1.10 · EL PERMISO DEL PUERTO SERIE ───────────────────────────────────────
//
// En Linux, quien no está en el grupo dueño de /dev/ttyUSB0 no puede cargar a la
// placa, y el grupo cambia con la distro (dialout / uucp). install.sh no decía
// nada: la docente se enteraba en clase con un «Permission denied». Ahora lo mira
// al final y, si falta, imprime el comando con el grupo y el usuario de esa compu.
//
// CÓMO SE PRUEBA SIN INVENTAR NADA. No hay forma honesta de «simular» un grupo, así
// que se usan tres condiciones REALES del kernel:
//   - la sesión tal cual: el test calcula por su lado (getent, id) qué rama
//     corresponde y exige esa;
//   - `unshare -U --map-user=<yo>`: el mismo usuario en un espacio de usuarios donde
//     los grupos suplementarios no existen — es «estoy en la base pero la sesión no
//     lo tomó», lo que pasa después del usermod y antes de volver a entrar;
//   - `unshare -U --map-user=nobody`: un usuario que de verdad no está en el grupo.
// Donde `unshare` no lo permite, esos dos casos SE SALTEAN y lo dicen.
//
// MUTACIONES que ponen rojo este archivo (exit code 1):
//   - borrar la llamada `aviso_puerto_serie`                       → rojos los tres
//   - `esta_en_la_lista "$(id -Gn 2>/dev/null || true)" "$grupo"` → `true`
//                                                                  → rojos los dos de unshare
//   - `esta_en_la_lista "$(id -Gn "$usuario" ...)" "$grupo"` → `false`
//                                                                  → rojo «la sesión no lo tomó»
//   - `for g in dialout uucp` → `for g in tty`                     → rojos los tres
//
// SIN PROBAR: la rama de una placa CONECTADA (leer/escribir el dispositivo y tomar
// su grupo dueño con `stat -c %G`): en la compu donde se escribió esto no había
// ninguna. Tampoco la rama gpasswd/addgroup (acá hay usermod).
//
// Corre con: node --test tests/instalador-linux-real.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO, armarBin, correr, esRoot, nuevoHome, ponerEjecutable, puedeCorrer, rutaDe } from "./ayuda-instalador-sh.mjs"

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
  assert.match(update, new RegExp(`\\n\\s+${CODIGO_CON_AVISOS}\\)[\\s\\S]*?CON AVISOS[\\s\\S]*?exit ${CODIGO_CON_AVISOS}\\n`), "update.sh no pasa el código tal cual")
  const tool = readFileSync(join(REPO, "opencode", "tool", "actualizar.ts"), "utf8")
  assert.match(tool, new RegExp(`const CODIGO_CON_AVISOS = ${CODIGO_CON_AVISOS}\\b`), "actualizar.ts espera otro código")
})

// ── 1.5 y 1.6 · la key que pega la docente ───────────────────────────────────

// Armada por concatenación a propósito: tests/modelo.test.mjs barre el repo buscando
// literales con forma de key de Google, y éste tiene la forma (es lo que se pega).
const KEY_PEGADA = "AIza" + "SyTEST-no-es-una-key-de-verdad_0123456789"
// Un proxy que rechaza la conexión al toque: la prueba de la key termina en
// «no pude probarla» sin que salga un solo paquete de esta compu.
const SIN_RED = { https_proxy: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9" }
const modoDe = (ruta) => statSync(ruta).mode & 0o777

/**
 * PATH armado donde `herramienta` es un envoltorio que anota sus argumentos y
 * después corre el binario real. Devuelve también el archivo del registro.
 */
function binQueAnotaArgv(h, herramienta) {
  const bin = armarBin(h.base)
  const registro = join(h.base, `argv-${herramienta}.log`)
  ponerEjecutable(bin, herramienta, `printf '%s\\n' "$*" >> '${registro}'\nexec '${rutaDe(herramienta)}' "$@"`)
  return { bin, registro }
}

for (const [camino, herramienta, real] of [["python3", "python3", python3], ["jq", "jq", jq]]) {
  test(`pegar una key (camino ${camino}): queda guardada, 0600, y NO pasó por la línea de comandos`, { skip: !puedeCorrer || !real }, () => {
    const h = nuevoHome()
    try {
      const { bin, registro } = binQueAnotaArgv(h, herramienta)
      const r = correr(INSTALL, h, { path: bin, env: SIN_RED, input: `${KEY_PEGADA}\n` })
      assert.equal(r.status, 0, `install.sh salió con ${r.status}:\n${r.salida}`)
      assert.match(r.salida, /\[OK\] Key guardada/, r.salida)
      assert.doesNotMatch(r.salida, new RegExp(KEY_PEGADA), "el instalador IMPRIMIÓ la key")

      const auth = leerJson(h.authFile)
      assert.deepEqual(auth.google, { type: "api", key: KEY_PEGADA }, "la key guardada no es la que se pegó")

      // Permisos: lo que el instalador CREA con datos personales o credenciales.
      assert.equal(modoDe(h.authFile).toString(8), "600", "auth.json (la credencial) no nació 0600")
      assert.equal(modoDe(join(h.configDir, "tecnia-perfil.md")).toString(8), "600", "tecnia-perfil.md no nació 0600")
      assert.equal(modoDe(join(h.configDir, "tecnia-memoria.md")).toString(8), "600", "tecnia-memoria.md no nació 0600")

      // La línea de comandos. Primero que el envoltorio haya corrido de verdad: un
      // registro vacío haría pasar el assert de abajo sin haber mirado nada.
      const argv = readFileSync(registro, "utf8")
      assert.ok(argv.split("\n").filter(Boolean).length >= 2, `el envoltorio de ${herramienta} casi no corrió: el test no está midiendo nada\n${argv}`)
      assert.ok(argv.includes(h.authFile), `ninguna llamada a ${herramienta} tocó auth.json: el guardado fue por otro lado`)
      assert.ok(!argv.includes(KEY_PEGADA), `la key viajó por la línea de comandos de ${herramienta} (la ve cualquiera con \`ps\`)`)
    } finally {
      rmSync(h.base, { recursive: true, force: true })
    }
  })

  test(`pegar una key (camino ${camino}) con otras credenciales guardadas: se agregan, no se pisan`, { skip: !puedeCorrer || !real }, () => {
    const h = nuevoHome()
    try {
      const { bin } = binQueAnotaArgv(h, herramienta)
      mkdirSync(h.dataDir, { recursive: true })
      writeFileSync(h.authFile, JSON.stringify({ anthropic: { type: "api", key: "OTRA-CREDENCIAL" } }))
      const r = correr(INSTALL, h, { path: bin, env: SIN_RED, input: `${KEY_PEGADA}\n` })
      assert.equal(r.status, 0, r.salida)
      const auth = leerJson(h.authFile)
      assert.equal(auth.google.key, KEY_PEGADA)
      assert.equal(auth.anthropic.key, "OTRA-CREDENCIAL", "se llevó puesta otra credencial del docente")
      assert.equal(modoDe(h.authFile) & 0o077 & ~0o044, 0, "dejó auth.json escribible por otros")
    } finally {
      rmSync(h.base, { recursive: true, force: true })
    }
  })

  test(`pegar una key (camino ${camino}) con auth.json ROTO: el archivo queda byte a byte igual y sale con 3`, { skip: !puedeCorrer || !real }, () => {
    const h = nuevoHome()
    try {
      const { bin } = binQueAnotaArgv(h, herramienta)
      mkdirSync(h.dataDir, { recursive: true })
      // Una coma de más: lo que deja un editor de texto a mitad de un arreglo.
      const roto = Buffer.from('{\n  "anthropic": { "type": "api", "key": "OTRA-CREDENCIAL" },\n}\n')
      writeFileSync(h.authFile, roto)
      const r = correr(INSTALL, h, { path: bin, env: SIN_RED, input: `${KEY_PEGADA}\n` })
      assert.ok(readFileSync(h.authFile).equals(roto), `pisó un auth.json que no pudo leer; quedó:\n${readFileSync(h.authFile, "utf8")}`)
      assert.doesNotMatch(r.salida, /\[OK\] Key guardada/, `dice que guardó la key:\n${r.salida}`)
      assert.match(r.salida, /NO guarde la key/, r.salida)
      assert.equal(r.status, CODIGO_CON_AVISOS, `esperaba el código ${CODIGO_CON_AVISOS} y salió ${r.status}:\n${r.salida}`)
      const cola = r.stdout.slice(r.stdout.lastIndexOf("instalado CON AVISOS. Falta:"))
      assert.ok(cola.includes(h.authFile), `el resumen final no dice que la key no se guardó ni dónde:\n${cola}`)
      // Sin key guardada el agente NO puede quedar apuntando a Gemini.
      assert.equal(leerJson(join(h.configDir, "opencode.json")).agent[AGENTE].model, MODELO_SIN_KEY, "dejó el agente en Gemini sin haber guardado la key")
    } finally {
      rmSync(h.base, { recursive: true, force: true })
    }
  })
}

// ── 1.10 · el permiso del puerto serie ───────────────────────────────────────

const esLinux = process.platform === "linux"
const linea = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" })
  return r.status === 0 ? r.stdout.trim() : null
}
// El oráculo: lo mismo que mira el script, calculado por otro camino.
const placasConectadas = esLinux ? readdirSync("/dev").filter((n) => /^tty(USB|ACM)\d+$/.test(n)) : []
const grupoSerie = ["dialout", "uucp"].find((g) => linea("getent", ["group", g]) !== null) ?? null
const usuarioReal = linea("id", ["-un"])
const gruposDeLaSesion = (linea("id", ["-Gn"]) ?? "").split(/\s+/)
const gruposEnLaBase = usuarioReal ? (linea("id", ["-Gn", usuarioReal]) ?? "").split(/\s+/) : []
const sinOraculo = !puedeCorrer || !esLinux || esRoot
  ? "sólo aplica a Linux y sin ser root"
  : placasConectadas.length > 0
    ? `hay una placa conectada (${placasConectadas.join(", ")}): el script toma el grupo del dispositivo y este test sólo sabe calcular el caso sin placa`
    : !grupoSerie ? "este sistema no tiene ni dialout ni uucp" : false

/** `unshare -U` mapeando el usuario a `quien` (un nombre de cuenta), o null si este sistema no deja. */
function espacioDeUsuarios(quien) {
  const unshare = rutaDe("unshare")
  const uid = linea("id", ["-u", quien])
  const gid = linea("id", ["-g", quien])
  if (!unshare || uid === null || gid === null) return null
  const envoltorio = [unshare, "-U", `--map-user=${uid}`, `--map-group=${gid}`]
  return linea(envoltorio[0], [...envoltorio.slice(1), "id", "-un"]) === quien ? envoltorio : null
}

function instalarYLeerPuerto(envoltorio = []) {
  const h = nuevoHome()
  try {
    const r = correr(INSTALL, h, { path: armarBin(h.base, ["jq"]), env: { TECNIA_SIN_PROMPT: "1" }, envoltorio })
    assert.equal(r.status, 0, `install.sh salió con ${r.status}:\n${r.salida}`)
    const i = r.stdout.indexOf("Puerto serie:")
    assert.ok(i >= 0, `install.sh no dice nada del permiso del puerto serie:\n${r.stdout}`)
    assert.ok(i > r.stdout.indexOf("Verificando dependencias"), "el aviso del puerto no está al final, con las dependencias")
    return r.stdout.slice(r.stdout.lastIndexOf("\n", i) + 1, r.stdout.indexOf("Para empezar", i))
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
}
const comandoPara = (usuario) => new RegExp(`^ +sudo (usermod -a -G ${grupoSerie} ${usuario}|gpasswd -a ${usuario} ${grupoSerie}|addgroup ${usuario} ${grupoSerie})$`, "m")

test("puerto serie: en esta sesión, install.sh dice lo mismo que getent e id", { skip: sinOraculo }, () => {
  const bloque = instalarYLeerPuerto()
  assert.ok(bloque.includes(grupoSerie), `no nombra el grupo de esta compu (${grupoSerie}):\n${bloque}`)
  if (gruposDeLaSesion.includes(grupoSerie)) {
    assert.match(bloque, new RegExp(`\\[OK\\] Puerto serie: tu usuario \\(${usuarioReal}\\) esta en el grupo ${grupoSerie}`), bloque)
    assert.doesNotMatch(bloque, /sudo/, `pide un comando de administrador que no hace falta:\n${bloque}`)
  } else if (gruposEnLaBase.includes(grupoSerie)) {
    assert.match(bloque, /esta sesion todavia no lo tomo/, bloque)
  } else {
    assert.match(bloque, /\[FALTA\] Puerto serie/, bloque)
    assert.match(bloque, comandoPara(usuarioReal), `no da el comando exacto para esta compu:\n${bloque}`)
  }
})

const comoYo = sinOraculo || !usuarioReal ? null : espacioDeUsuarios(usuarioReal)
test("puerto serie: en el grupo pero la sesión no lo tomó → manda a cerrar sesión, no a correr usermod de nuevo",
  { skip: sinOraculo || (!comoYo && "este sistema no permite `unshare -U --map-user`") || (!gruposEnLaBase.includes(grupoSerie) && `el usuario de este sistema no está en ${grupoSerie}: no hay cómo armar el caso`) }, () => {
    const bloque = instalarYLeerPuerto(comoYo)
    assert.match(bloque, new RegExp(`\\[AVISO\\] Puerto serie: tu usuario \\(${usuarioReal}\\) ya figura en el grupo ${grupoSerie}, pero esta sesion todavia no lo tomo`), bloque)
    assert.match(bloque, /Cerra la sesion y volve a entrar/, bloque)
    assert.doesNotMatch(bloque, /sudo/, `le pide repetir un comando que ya corrió:\n${bloque}`)
  })

const comoNobody = sinOraculo ? null : espacioDeUsuarios("nobody")
test("puerto serie: un usuario que NO está en el grupo → [FALTA] y el comando exacto, con su grupo y su nombre",
  { skip: sinOraculo || (!comoNobody && "este sistema no permite `unshare -U --map-user`, o no tiene la cuenta nobody") }, () => {
    assert.ok(!(linea("id", ["-Gn", "nobody"]) ?? "").split(/\s+/).includes(grupoSerie), `en este sistema nobody está en ${grupoSerie}: el caso no sirve`)
    const bloque = instalarYLeerPuerto(comoNobody)
    assert.match(bloque, new RegExp(`\\[FALTA\\] Puerto serie: tu usuario \\(nobody\\) NO esta en el grupo ${grupoSerie}`), bloque)
    assert.match(bloque, comandoPara("nobody"), `no da el comando exacto:\n${bloque}`)
    assert.match(bloque, /cerra la sesion y volve a entrar/i, bloque)
    // Sin sudo de verdad: el instalador lo MUESTRA, no lo corre.
    assert.doesNotMatch(bloque, /\[OK\]/, bloque)
  })
