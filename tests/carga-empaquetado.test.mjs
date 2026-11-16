// `opencode/carga/` tiene que LLEGAR a la máquina del docente (Slice 2, gate único de
// carga — A7-PLAN-PRUEBAS §4, último párrafo).
//
// POR QUÉ ESTE ARCHIVO. `tool/platformio.ts` importa `../carga/...` de forma ESTÁTICA.
// Si el instalador no copia esa carpeta, la tool no importa — y el registry de OpenCode
// aborta el loop entero en el primer `import()` que falla: no queda NINGUNA tool. Los
// instaladores copian carpeta por carpeta, con listas escritas a mano en cuatro scripts:
// una carpeta nueva que no se suma a las cuatro es exactamente ese accidente.
//
// DOS CAPAS:
//   - estática: las cuatro listas y el `tsconfig` nombran `carga`;
//   - dinámica: se instala DE VERDAD con `install.sh` desde el árbol de trabajo (no
//     desde HEAD: así una lista rota se ve antes de commitear) a un HOME temporal, y se
//     importa cada tool INSTALADA en un proceso aparte. Y para que este chequeo no sea
//     un adorno, después se saca `carga/` de la instalación y se comprueba que el mismo
//     chequeo se pone rojo.
//
// `tests/empaquetado-instalado.test.mjs` sigue siendo el gate completo (desde `git
// archive HEAD`, con ciclo de vida, candado y desinstalación); éste es el de la carpeta
// nueva. Sólo Linux/macOS: `install.ps1` no se puede correr acá (ver su cobertura real
// en la matriz Windows de `.github/workflows/ci.yml`) y queda SIN VERIFICAR.
//
// MUTACIONES que ponen esto rojo (verificadas a mano, ver el informe de la etapa): sacar
// `carga` del `mkdir`, del `cp` o del `find` de install.sh; sacarla de install.ps1.

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"

const TESTS_DIR = dirname(fileURLToPath(import.meta.url))
const REPO = join(TESTS_DIR, "..")
const HIJO = join(TESTS_DIR, "empaquetado-instalado-hijo.mjs")
const leer = (...p) => readFileSync(join(REPO, ...p), "utf8")

const MODULOS = ["arbol.ts", "artefacto.ts", "candado.ts", "cargar-programa.ts", "ejecutar.ts", "esptool.ts", "fuentes.ts", "identidad.ts", "ini.ts", "librerias.ts", "proceso.ts", "puertos.ts", "registro.ts"]

test("los cuatro instaladores llevan carga/ en sus listas de carpetas", () => {
  const installSh = leer("install", "install.sh")
  assert.match(installSh, /mkdir -p "\$CONFIG_DIR"\/\{[^}]*\bcarga\b[^}]*\}/, "install.sh no crea la carpeta carga/")
  assert.match(installSh, /^cp -r "\$SRC\/carga\/\." "\$CONFIG_DIR\/carga\/"$/m, "install.sh no copia carga/")
  assert.match(installSh, /find agent tool [^|\n]*\bcarga\b[^|\n]* -type f/, "install.sh no lista carga/ en el manifest (no se borrarían sus huérfanos ni se desinstalaría)")

  const installPs1 = leer("install", "install.ps1")
  const listas = installPs1.match(/foreach \(\$sub in @\(([^)]*)\)\)/g) ?? []
  assert.equal(listas.length, 2, "install.ps1: esperaba la lista de carpetas y la del manifest")
  for (const lista of listas) assert.match(lista, /"carga"/, `install.ps1: una lista de carpetas no lleva carga: ${lista}`)
  assert.match(installPs1, /^Copy-Item \(Join-Path \$Src "carga\\\*"\) \(Join-Path \$ConfigDir "carga\\"\) -Recurse -Force$/m, "install.ps1 no copia carga\\")

  assert.match(leer("install", "uninstall.ps1"), /foreach \(\$d in @\([^)]*"carga"[^)]*\)\)/, "uninstall.ps1 no limpia carga/")
  assert.match(leer("install", "uninstall.sh"), /"\$CONFIG_DIR\/carga"[^\n]* -type d -empty -delete/, "uninstall.sh no limpia carga/")
  assert.doesNotMatch(installPs1 + leer("install", "uninstall.ps1"), /[^\x00-\x7F]/, "los .ps1 siguen siendo ASCII (Windows PowerShell 5.1)")
})

test("tsconfig.json incluye opencode/carga (si no, `pnpm typecheck` no mira el gate)", () => {
  const { include } = JSON.parse(leer("tsconfig.json"))
  assert.ok(include.includes("opencode/carga/**/*.ts"), `include: ${JSON.stringify(include)}`)
})

test("carga/ sólo tiene código (.ts): nada de docs, tests ni evidencia viaja a la instalación", () => {
  const todos = readdirSync(join(REPO, "opencode", "carga"), { withFileTypes: true })
  assert.deepEqual(todos.filter((e) => !e.isFile() || !e.name.endsWith(".ts")).map((e) => e.name), [], "hay algo en carga/ que no es un .ts")
  for (const modulo of MODULOS) assert.ok(todos.some((e) => e.name === modulo), `falta opencode/carga/${modulo}`)
})

function importarToolsInstaladas(configDir, cwd) {
  const run = spawnSync(process.execPath, [HIJO, "importar-tools", configDir], { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 120_000 })
  assert.equal(run.status, 0, `el hijo de import falló: ${run.stderr}`)
  return JSON.parse(run.stdout.trim())
}

if (process.platform === "win32") {
  test("instalación real desde el árbol de trabajo: carga/ queda instalada", { skip: "install.sh es Bash; install.ps1 corre en la matriz Windows de .github/workflows/ci.yml" }, () => {})
} else {
  test("instalación real desde el árbol de trabajo: carga/ queda instalada y TODAS las tools instaladas importan; sin carga/, no", () => {
    const raiz = mkdtempSync(join(tmpdir(), "tb-carga-empaquetado-"))
    try {
      // Fuente = el árbol de trabajo tal como está (lo commiteado, lo modificado y lo nuevo
      // sin ignorar), bajo una ruta con espacio y Unicode, FUERA del repo.
      const fuenteDir = join(raiz, "tb inst ñandú", "repo")
      const listado = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "opencode", "install", "VERSION"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      assert.equal(listado.status, 0, `git ls-files falló: ${listado.stderr}`)
      const archivos = listado.stdout.split("\0").filter((f) => f && existsSync(join(REPO, f)))
      assert.ok(archivos.length > 100, `fixture: esperaba el árbol del producto, hay ${archivos.length} archivos`)
      for (const f of archivos) {
        mkdirSync(dirname(join(fuenteDir, f)), { recursive: true })
        cpSync(join(REPO, f), join(fuenteDir, f))
      }

      const home = join(raiz, "home")
      mkdirSync(home, { recursive: true })
      const otroCwd = join(raiz, "otro cwd")
      mkdirSync(otroCwd, { recursive: true })
      const xdgConfig = join(home, ".config")
      const instalar = spawnSync("bash", [join(fuenteDir, "install", "install.sh")], {
        cwd: fuenteDir,
        env: { HOME: home, XDG_CONFIG_HOME: xdgConfig, XDG_DATA_HOME: join(home, ".local", "share"), PATH: "/usr/bin:/bin", TECNIA_SIN_PROMPT: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        timeout: 120_000,
      })
      assert.equal(instalar.status, 0, `install.sh terminó con rc=${instalar.status}:\n${instalar.stdout}\n${instalar.stderr}`)
      const configDir = join(xdgConfig, "opencode")

      // Presencia, como carpeta HERMANA de tool/ (adentro de tool/ el registry la levantaría como tools).
      for (const modulo of MODULOS) assert.ok(existsSync(join(configDir, "carga", modulo)), `falta carga/${modulo} instalado`)
      assert.ok(!existsSync(join(configDir, "tool", "carga")), "carga/ terminó DENTRO de tool/")
      assert.deepEqual(readdirSync(join(configDir, "carga")).filter((f) => !f.endsWith(".ts")), [], "se instaló algo en carga/ que no es código")
      const manifest = readFileSync(join(configDir, "tecnia-bot.manifest"), "utf8").split("\n")
      for (const modulo of MODULOS) assert.ok(manifest.includes(`carga/${modulo}`), `el manifest no lista carga/${modulo}: no se desinstalaría`)

      // @opencode-ai/plugin lo instala OpenCode en cada config dir al arrancar; acá se simula
      // con un symlink (mismo criterio que tests/empaquetado-instalado.test.mjs).
      mkdirSync(join(configDir, "node_modules", "@opencode-ai"), { recursive: true })
      symlinkSync(join(REPO, "node_modules", "@opencode-ai", "plugin"), join(configDir, "node_modules", "@opencode-ai", "plugin"), "dir")
      // La fuente deja de estar: lo instalado tiene que andar solo.
      rmSync(fuenteDir, { recursive: true, force: true })

      const nombresTool = readdirSync(join(configDir, "tool")).filter((f) => /\.(ts|js)$/.test(f))
      const conCarga = importarToolsInstaladas(configDir, otroCwd)
      assert.deepEqual(conCarga.fallos, [], `hay tools instaladas que no importan: ${JSON.stringify(conCarga.fallos)}`)
      assert.deepEqual(conCarga.ok.sort(), nombresTool.sort())
      assert.ok(conCarga.ok.includes("platformio.ts") && conCarga.ok.includes("programa.ts"))

      // EL GUARD SE PRUEBA A SÍ MISMO: sin carga/ en la instalación, ESTE MISMO chequeo
      // tiene que marcar a platformio.ts (y a programa.ts, que lo importa). Si acá diera
      // verde, el chequeo de arriba no estaría mirando nada.
      renameSync(join(configDir, "carga"), join(raiz, "carga-fuera"))
      const sinCarga = importarToolsInstaladas(configDir, otroCwd)
      const rotas = sinCarga.fallos.map((f) => f.archivo).sort()
      assert.ok(rotas.includes("platformio.ts"), `sin carga/, platformio.ts tenía que dejar de importar. Fallos: ${JSON.stringify(sinCarga.fallos)}`)
      assert.ok(rotas.includes("programa.ts"), `sin carga/, programa.ts tenía que dejar de importar. Fallos: ${JSON.stringify(sinCarga.fallos)}`)
      assert.match(sinCarga.fallos.find((f) => f.archivo === "platformio.ts").mensaje, /carga/, "el error no nombra la carpeta que falta")
      renameSync(join(raiz, "carga-fuera"), join(configDir, "carga"))
    } finally {
      rmSync(raiz, { recursive: true, force: true })
    }
  })
}
