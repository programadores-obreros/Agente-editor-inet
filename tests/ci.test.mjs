// La CI tiene que EJECUTAR el instalador de Windows, no solo mirarlo.
//
// El 2026-09-05 el PowerShell 5.1 real de una VM encontró dos errores de parseo
// ("$var: texto") que los 243 tests de Node no podían ver: ci.yml corría sólo
// `node --test` en Linux, y build-installer.yml instalaba el .exe con /skipdeps=1
// y miraba que existieran dos archivos. Nunca se parseaba un .ps1 con PowerShell,
// nunca corría bootstrap.ps1, nunca se compilaba un sketch. Y `pnpm typecheck`
// llevaba 88 errores sin que nadie lo corriera.
//
// Este test no puede correr GitHub Actions. Verifica que los workflows PIDAN lo que
// hace falta, para que nadie lo saque sin querer en una limpieza. Lee el YAML como
// texto (sin dependencias, igual que el resto de la suite).
//
// ── ESTE ARCHIVO ERA HUECO DE TRES MANERAS, Y QUEDA ESCRITO CUÁLES ────────────
//
// Todo lo que hacía era `assert.match(textoDelJob, /algo/)`: que el texto del paso
// ESTUVIERA en el archivo. Que el paso CORRIERA no lo miraba nadie. Medido por
// mutación el 2026-11-15 (exit code de `node --test tests/ci.test.mjs`, sin pipe;
// cada mutación aplicada con un script que hace assert de que el texto existe y
// comprobada con `git diff --stat`). Las once daban exit code 0:
//
//   ci.yml
//     - `if: false` en el paso que corre bootstrap.ps1
//     - `if: ${{ false }}` en «Verificar lo que dejo el bootstrap»
//     - `continue-on-error: true` en «Correr smoke tests»
//     - `if: false` en el JOB windows entero
//     - la línea que corre bootstrap.ps1, comentada con `#`
//     - un `exit 0` como primera línea del paso que compila el sketch
//   build-installer.yml
//     - `if: false` en el smoke test del .exe
//     - `continue-on-error: true` en el parseo de la copia instalada
//     - la comparación tag↔VERSION con `if ($false) {`
//     - el paso de esa comparación con `if: false`
//     - esa comparación sin su `exit 1` (avisa y publica igual)
//
// Por qué: (1) un paso deshabilitado conserva su texto, y el texto era lo único
// que se miraba; (2) las expresiones se corrían sobre el YAML crudo, así que una
// línea comentada seguía «estando»; (3) de la comparación tag↔VERSION no había ni
// un assert.
//
// Ahora el YAML se parte en jobs y pasos (a mano: el repo no tiene parser de YAML
// en node_modules, y agregar una dependencia para esto no se justifica), y sobre
// eso hay:
//   - un CENSO de pasos por job, con nombre y orden: sacar, renombrar o agregar un
//     paso obliga a tocar este archivo;
//   - una lista cerrada de los `if:` permitidos, paso por paso. Cualquier otro
//     `if:` —en un paso o en un job— es rojo. No hay ningún `continue-on-error`;
//   - los asserts de siempre, pero sobre el job SIN líneas de comentario;
//   - ningún script de paso puede tener un `exit 0` suelto en su nivel base;
//   - la comparación tag↔VERSION, entera.
// El partidor de pasos es un guard y se prueba a sí mismo con un YAML de juguete
// (primer test). Después del cambio, las once mutaciones dan exit code 1.
//
// LÍMITE HONESTO: esto mira que el workflow PIDA lo que hace falta y que no esté
// apagado. No ejecuta nada. Que un paso de verdad falle cuando el producto está
// roto sólo se ve corriendo el workflow en GitHub.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (...p) => readFileSync(join(REPO, ...p), "utf8")
const ci = leer(".github", "workflows", "ci.yml")
const build = leer(".github", "workflows", "build-installer.yml")
const installPs1 = leer("install", "install.ps1")

/** Sin las líneas de comentario (YAML y scripts de paso usan `#` los dos). */
const sinComentarios = (texto) => texto.replace(/^[ \t]*#.*$/gm, "")

// Bloque de un job, CRUDO: desde "  <nombre>:" (2 espacios) hasta la siguiente clave
// con la misma sangría, o el final del archivo. Se busca sólo debajo de `jobs:`.
function jobCrudo(yaml, nombre) {
  const iJobs = yaml.search(/^jobs:[ \t]*$/m)
  assert.ok(iJobs >= 0, "el workflow no tiene la clave `jobs:`")
  const m = yaml.slice(iJobs).match(new RegExp(`^  ${nombre}:[ \\t]*\\n([\\s\\S]*?)(?=^  [A-Za-z0-9_-]+:[ \\t]*\\n|(?![\\s\\S]))`, "m"))
  assert.ok(m, `el workflow no tiene el job "${nombre}"`)
  return m[1]
}

/**
 * El job SIN comentarios: es sobre lo que se corren los `assert.match`.
 *
 * Antes se corrían sobre el texto crudo, y una línea comentada con `#` seguía
 * cumpliendo la expresión: se podía apagar el bootstrap comentándolo y el test
 * decía que la CI lo corría.
 */
function job(yaml, nombre) {
  return sinComentarios(jobCrudo(yaml, nombre))
}

/** Los nombres de los jobs de un workflow, en orden. */
function nombresDeJobs(yaml) {
  const iJobs = yaml.search(/^jobs:[ \t]*$/m)
  assert.ok(iJobs >= 0, "el workflow no tiene la clave `jobs:`")
  return [...yaml.slice(iJobs).matchAll(/^  ([A-Za-z0-9_-]+):[ \t]*$/gm)].map((m) => m[1])
}

/**
 * Parte un job en su cabecera y sus pasos.
 *
 * Un paso empieza en un renglón `      - ` (seis espacios y guion: la sangría de
 * los dos workflows). Sus claves propias viven en ese renglón o a ocho espacios;
 * lo que hay adentro de un `run: |` está a diez o más, así que un `if (` de
 * PowerShell no se confunde con la clave `if:` del paso.
 */
function partirJob(yaml, nombre) {
  const texto = sinComentarios(jobCrudo(yaml, nombre))
  const trozos = texto.split(/^(?=      - )/m)
  const cabecera = trozos.shift()
  const clave = (trozo, k) => {
    const m = trozo.match(new RegExp(`^(?:      - |        )${k}:[ \\t]*(.*?)[ \\t]*$`, "m"))
    return m ? m[1].replace(/^(["'])(.*)\1$/, "$2") : undefined
  }
  const pasos = trozos.map((trozo) => ({
    nombre: clave(trozo, "name") ?? (clave(trozo, "uses") ? `uses: ${clave(trozo, "uses")}` : "(sin nombre)"),
    si: clave(trozo, "if"),
    continuaConError: clave(trozo, "continue-on-error"),
    shell: clave(trozo, "shell"),
    // El script: los renglones a diez espacios o más (lo de adentro de `run: |`).
    script: trozo.split("\n").filter((l) => /^ {10}/.test(l)).join("\n"),
    texto: trozo,
  }))
  const claveJob = (k) => cabecera.match(new RegExp(`^    ${k}:[ \\t]*(.*?)[ \\t]*$`, "m"))?.[1]
  return { cabecera, pasos, si: claveJob("if"), continuaConError: claveJob("continue-on-error") }
}

/**
 * Todo lo que APAGA o ABLANDA un job: un `if:` que no esté en la lista de
 * permitidos, cualquier `continue-on-error`, o un `exit 0` suelto en el nivel
 * base de un script. `permitidos` es { "nombre del paso": "condición exacta" }.
 */
function apagados(yaml, nombre, permitidos = {}) {
  const j = partirJob(yaml, nombre)
  const problemas = []
  if (j.si !== undefined) problemas.push(`el job ${nombre} tiene \`if: ${j.si}\``)
  if (j.continuaConError !== undefined) problemas.push(`el job ${nombre} tiene \`continue-on-error: ${j.continuaConError}\``)
  for (const paso of j.pasos) {
    if (paso.si !== undefined && permitidos[paso.nombre] !== paso.si) {
      problemas.push(`«${paso.nombre}» tiene \`if: ${paso.si}\`` + (permitidos[paso.nombre] ? ` (el permitido es \`${permitidos[paso.nombre]}\`)` : ""))
    }
    if (paso.continuaConError !== undefined) problemas.push(`«${paso.nombre}» tiene \`continue-on-error: ${paso.continuaConError}\``)
    if (/^ {10}exit 0[ \t]*$/m.test(paso.script)) problemas.push(`«${paso.nombre}» tiene un \`exit 0\` suelto: lo que sigue no corre`)
    if (/\bif\s*\(\s*\$(?:false|true)\s*\)|\bif\s+(?:true|false)\s*;/.test(paso.script)) problemas.push(`«${paso.nombre}» tiene una condición fija (\`if ($false)\` o parecida)`)
  }
  // Y un `if:` permitido que ya no está en ningún paso es una lista desactualizada.
  for (const n of Object.keys(permitidos)) {
    if (!j.pasos.some((p) => p.nombre === n)) problemas.push(`la lista de \`if:\` permitidos nombra «${n}», que ya no es un paso de ${nombre}`)
  }
  return problemas
}

const nombresDePasos = (yaml, nombre) => partirJob(yaml, nombre).pasos.map((p) => p.nombre)

/** Un paso por su nombre exacto, o el test explota. */
function paso(yaml, nombreJob, nombrePaso) {
  const p = partirJob(yaml, nombreJob).pasos.filter((x) => x.nombre === nombrePaso)
  assert.equal(p.length, 1, `esperaba UN paso «${nombrePaso}» en el job ${nombreJob} y hay ${p.length}`)
  return p[0]
}

test("el partidor de pasos ve lo que tiene que ver (el guard se prueba a sí mismo)", () => {
  const juguete = [
    "name: juguete",
    "jobs:",
    "  uno:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - name: Sano",
    "        run: |",
    "          if ($x) { exit 1 }",
    "          echo hola",
    "      - name: Apagado",
    "        if: false",
    "        run: echo nunca",
    "      # - name: Comentado",
    "      #   run: echo tampoco",
    "      - name: Blando",
    "        continue-on-error: true",
    "        run: |",
    "          exit 0",
    "          echo nunca",
    "      - name: Condicion fija",
    "        if: \"always()\"",
    "        run: |",
    "          if ($false) {",
    "            exit 1",
    "          }",
    "  dos:",
    "    if: github.event_name == 'never'",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Unico",
    "        run: echo dos",
    "",
  ].join("\n")
  assert.deepEqual(nombresDeJobs(juguete), ["uno", "dos"])
  assert.deepEqual(nombresDePasos(juguete, "uno"), ["uses: actions/checkout@v4", "Sano", "Apagado", "Blando", "Condicion fija"],
    "el partidor no separa bien los pasos (o cuenta el paso comentado)")
  assert.deepEqual(nombresDePasos(juguete, "dos"), ["Unico"], "un job se llevó los pasos del siguiente")
  assert.deepEqual(apagados(juguete, "uno", { "Condicion fija": "always()" }), [
    "«Apagado» tiene `if: false`",
    "«Blando» tiene `continue-on-error: true`",
    "«Blando» tiene un `exit 0` suelto: lo que sigue no corre",
    "«Condicion fija» tiene una condición fija (`if ($false)` o parecida)",
  ])
  // Sin la lista de permitidos, el `if: always()` también se marca.
  assert.ok(apagados(juguete, "uno").includes("«Condicion fija» tiene `if: always()`"), "un `if:` que no está permitido pasa de largo")
  assert.deepEqual(apagados(juguete, "dos"), ["el job dos tiene `if: github.event_name == 'never'`"], "un `if:` en el job entero pasa de largo")
  assert.deepEqual(apagados(juguete, "dos", { "No existe": "x" }).slice(1), ["la lista de `if:` permitidos nombra «No existe», que ya no es un paso de dos"])
  // Y el `if (` de un script no se toma por la clave `if:` del paso.
  assert.equal(paso(juguete, "uno", "Sano").si, undefined)
})

// ── Censo: qué jobs y qué pasos hay, y cuáles pueden llevar `if:` ─────────────
//
// Si agregás, sacás o renombrás un paso, este censo se pone rojo A PROPÓSITO: es el
// momento de decidir si ese paso es de los que no pueden faltar.

const CENSO = {
  ci: {
    yaml: () => ci,
    jobs: {
      test: {
        pasos: [
          "uses: actions/checkout@v4",
          "uses: pnpm/action-setup@v4",
          "uses: actions/setup-node@v4",
          "Instalar dependencias de desarrollo (typescript, tipos de Bun y del plugin)",
          "Typecheck (tsc --noEmit)",
          "Correr smoke tests",
        ],
        ifPermitidos: {},
      },
      windows: {
        pasos: [
          "uses: actions/checkout@v4",
          "Parsear cada .ps1 con el parser de Windows PowerShell 5.1",
          "PSScriptAnalyzer (solo Severity Error)",
          "Compilar el instalador con ISCC (solo construye, no publica)",
          "Cache de descargas de PlatformIO",
          "bootstrap.ps1 de punta a punta (Scoop + OpenCode + PlatformIO + capa)",
          "Verificar lo que dejo el bootstrap",
          "Compilar ejemplos/_test-librerias para Arduino UNO",
          "Compilar tambien para ESP32 (solo a pedido, Run workflow -> esp32)",
          "install.ps1 dos veces con la config en una carpeta con tilde no duplica instructions",
          "uninstall.ps1 borra los datos personales cuando se pide, aun sin manifest, y los conserva cuando no",
          "uninstall.ps1 -Conservar deja opencode.json sin rastro de tecnia-bot",
          "Guardar instalacion.log (transcript del bootstrap)",
        ],
        ifPermitidos: {
          // A pedido: baja ~300 MB. No es un paso crítico.
          "Compilar tambien para ESP32 (solo a pedido, Run workflow -> esp32)": "inputs.esp32",
          // Al revés: corre SIEMPRE, también si algo falló antes.
          "Guardar instalacion.log (transcript del bootstrap)": "always()",
        },
      },
      // Los dos jobs que ejecutan los .sh contra Internet de verdad. Hasta el
      // 2026-11-15 bootstrap.sh no corría en ningún test ni CI, y macOS no tenía ni
      // una ejecución. Ninguno de sus pasos puede llevar `if:`: si el de macOS se
      // pone rojo, eso es información, no ruido que apagar.
      "linux-real": {
        pasos: [
          "uses: actions/checkout@v4",
          "bootstrap.sh de punta a punta (OpenCode + PlatformIO + capa)",
          "Verificar en el disco lo que dejo bootstrap.sh",
          "bootstrap.sh sin curl ni wget instala la capa igual y sale con 3",
          "uninstall.sh --conservar saca la capa",
        ],
        ifPermitidos: {},
      },
      macos: {
        pasos: [
          "uses: actions/checkout@v4",
          "Que maquina es (lo que despues hay que citar como evidencia)",
          "install.sh con el bash 3.2 del sistema (solo la capa)",
          "bootstrap.sh de punta a punta en macOS (OpenCode + PlatformIO + capa)",
          "uninstall.sh --conservar saca la capa en macOS",
        ],
        ifPermitidos: {},
      },
      skills: {
        pasos: [
          "uses: actions/checkout@v4",
          "uses: actions/setup-python@v5",
          "Instalar PyYAML",
          "Validar frontmatter de opencode/skills/*/SKILL.md",
          "Chequear bloque de seguridad en proyectos-inet",
        ],
        ifPermitidos: {},
      },
    },
  },
  "build-installer": {
    yaml: () => build,
    jobs: {
      build: {
        pasos: [
          "Checkout",
          "Leer versión de VERSION",
          "El tag tiene que coincidir con VERSION",
          "Instalar Inno Setup",
          "Compilar el instalador",
          "Smoke test (instalación silenciosa, sin dependencias)",
          "La copia instalada parsea en PowerShell 5.1 y trae OPENCODE_VERSION + manifiesto",
          "Instalacion real del .exe (con dependencias) y verificacion en disco",
          "Desinstalar con unins000.exe y verificar en disco",
          "Calcular SHA256",
          "Subir el .exe como artefacto",
          "Extraer las notas de esta version del CHANGELOG",
          "Adjuntar al release (solo en tags)",
        ],
        ifPermitidos: {
          // Los tres que sólo tienen sentido cuando hay un tag.
          "El tag tiene que coincidir con VERSION": "startsWith(github.ref, 'refs/tags/')",
          "Extraer las notas de esta version del CHANGELOG": "startsWith(github.ref, 'refs/tags/')",
          "Adjuntar al release (solo en tags)": "startsWith(github.ref, 'refs/tags/')",
        },
      },
    },
  },
}

for (const [archivo, { yaml, jobs }] of Object.entries(CENSO)) {
  test(`${archivo}.yml: están todos los jobs y todos los pasos, con su nombre y en su orden`, () => {
    assert.deepEqual(nombresDeJobs(yaml()), Object.keys(jobs), `cambió la lista de jobs de ${archivo}.yml`)
    for (const [nombre, { pasos }] of Object.entries(jobs)) {
      assert.deepEqual(nombresDePasos(yaml(), nombre), pasos,
        `cambiaron los pasos del job ${nombre} de ${archivo}.yml. Si fue a propósito, actualizá el censo de tests/ci.test.mjs`)
    }
  })

  test(`${archivo}.yml: ningún paso ni job está apagado (\`if:\` fuera de la lista, continue-on-error, exit 0 suelto)`, () => {
    for (const [nombre, { ifPermitidos }] of Object.entries(jobs)) {
      assert.deepEqual(apagados(yaml(), nombre, ifPermitidos), [], `hay algo apagado o ablandado en el job ${nombre} de ${archivo}.yml`)
    }
    // Y por las dudas, en cualquier lugar del archivo: ni un continue-on-error.
    assert.doesNotMatch(sinComentarios(yaml()), /continue-on-error\s*:/, `${archivo}.yml tiene un continue-on-error`)
  })
}

test("build-installer.yml: la comparación tag↔VERSION está entera y corta la publicación", () => {
  // Lo que compara sale de donde tiene que salir...
  const leer = paso(build, "build", "Leer versión de VERSION")
  assert.match(leer.texto, /^        id: ver[ \t]*$/m, "el paso que lee VERSION ya no tiene `id: ver`: la comparación leería una salida vacía")
  assert.match(leer.script, /\$v = \(Get-Content VERSION -Raw\)\.Trim\(\)/, "la versión ya no sale del archivo VERSION")
  assert.match(leer.script, /"version=\$v" >> \$env:GITHUB_OUTPUT/, "la versión leída no se publica como salida del paso")
  const cmp = paso(build, "build", "El tag tiene que coincidir con VERSION")
  assert.match(cmp.script, /\$tag = "\$\{\{ github\.ref_name \}\}" -replace '\^v', ''/, "el tag ya no sale de github.ref_name sin la «v»")
  assert.match(cmp.script, /\$ver = "\$\{\{ steps\.ver\.outputs\.version \}\}"/, "la versión ya no sale del paso `ver`")
  // ...la condición es la comparación, y adentro CORTA.
  assert.match(cmp.script, /if \(\$tag -ne \$ver\) \{\s*\n\s*Write-Error [^\n]*\n\s*exit 1\s*\n\s*\}/,
    "la comparación tag↔VERSION ya no es `if ($tag -ne $ver) { Write-Error …; exit 1 }`: sale un .exe con una versión y un release con otra")
  assert.equal((cmp.script.match(/\bif\s*\(/g) ?? []).length, 1, "el paso de la comparación tiene más de una condición: alguna puede estar pisando a la otra")
  // Y va ANTES de compilar y de publicar.
  const orden = nombresDePasos(build, "build")
  assert.ok(orden.indexOf("El tag tiene que coincidir con VERSION") < orden.indexOf("Compilar el instalador"), "la comparación corre después de compilar")
  assert.ok(orden.indexOf("El tag tiene que coincidir con VERSION") < orden.indexOf("Adjuntar al release (solo en tags)"), "la comparación corre después de publicar")
})

test("ci.yml conserva el job de Linux y ahora corre el typecheck antes de los tests", () => {
  const linux = job(ci, "test")
  assert.match(linux, /runs-on: ubuntu-latest/, "el job de Linux tiene que seguir en ubuntu-latest")
  assert.match(linux, /pnpm install --frozen-lockfile/, "sin instalar deps no hay tipos de Bun ni del plugin")
  assert.match(linux, /pnpm typecheck/, "la CI no corre `pnpm typecheck`: estuvo roto con 88 errores sin que nadie lo viera")
  assert.match(linux, /pnpm test|node --test tests\/\*\.test\.mjs/, "la CI dejó de correr los smoke tests")
  // Sobre el job sin comentarios (antes miraba el archivo crudo, comentarios incluidos)
  // y con los dos índices comprobados: un -1 hacía verdadera la comparación.
  const iTypecheck = linux.indexOf("run: pnpm typecheck")
  const iTests = linux.indexOf("run: pnpm test")
  assert.ok(iTypecheck >= 0 && iTests >= 0, "no encuentro los pasos `run: pnpm typecheck` y `run: pnpm test`")
  assert.ok(iTypecheck < iTests, "el typecheck va antes que los tests: es más barato y corta antes")
})

test("ci.yml tiene un job en windows-latest que usa Windows PowerShell 5.1, no pwsh", () => {
  const win = job(ci, "windows")
  assert.match(win, /runs-on: windows-latest/, "el job de Windows tiene que correr en windows-latest")
  assert.match(win, /shell: powershell\s*$/m, "shell: powershell es Windows PowerShell 5.1, el de las PCs de la escuela")
  assert.doesNotMatch(win, /shell: pwsh/, "pwsh (7.x) es más permisivo y no reproduce lo que ve un docente")
  assert.match(win, /timeout-minutes: \d+/, "sin timeout un bootstrap colgado gasta 6 horas de runner")
})

test("el job de Windows parsea install/*.ps1 con el parser de PowerShell 5.1 y corta si hay errores", () => {
  const win = job(ci, "windows")
  assert.match(win, /PSVersionTable\.PSVersion\.Major -ne 5/, "tiene que comprobar que de verdad corrió en 5.1")
  assert.match(win, /\[System\.Management\.Automation\.Language\.Parser\]::ParseFile\(/, "no usa el parser real de PowerShell")
  assert.match(win, /Get-ChildItem install\\\*\.ps1/, "no recorre install\\*.ps1")
  assert.match(win, /StartLineNumber/, "tiene que imprimir la línea del error, no sólo que falló")
})

test("el job de Windows corre bootstrap.ps1 de verdad, con powershell.exe 5.1 y sin esperar el prompt", () => {
  const win = job(ci, "windows")
  assert.match(win, /-NoProfile -ExecutionPolicy Bypass -File install\\bootstrap\.ps1/, "no corre install\\bootstrap.ps1 como lo corre el .exe")
  assert.match(win, /TECNIA_SIN_PROMPT: "1"/, "sin TECNIA_SIN_PROMPT install.ps1 espera 60 s la key de Google")
  assert.match(win, /System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/, "powershell.exe por ruta: el 5.1, no lo que haya en el PATH")
})

test("el job de Windows verifica la versión de OpenCode, el hold, el modelo y pio.exe", () => {
  const win = job(ci, "windows")
  assert.match(win, /Get-Content install\\OPENCODE_VERSION/, "la versión esperada se lee de install\\OPENCODE_VERSION, la única fuente")
  assert.match(win, /opencode\.exe[\s\S]*--version/, "tiene que correr opencode --version y compararlo")
  assert.match(win, /install\.json[\s\S]*\.hold -ne \$true/, "tiene que comprobar \"hold\": true en install.json de Scoop")
  assert.match(win, /default_agent -ne "tecnia-bot"/, "tiene que comprobar default_agent")
  assert.match(win, /"opencode\/big-pickle"/, "sin key, el modelo tiene que quedar en opencode/big-pickle")
  assert.match(win, /\.platformio\\penv\\Scripts\\pio\.exe/, "tiene que verificar el pio.exe que instala el bootstrap")
  // El log de la instalación tiene que traer la mitad que escribe install.ps1, y con su texto real.
  assert.match(win, /instalacion\.log[\s\S]{0,300}-SimpleMatch "==> Instalando Tecnia Bot en:"/, "no verifica que instalacion.log tenga la salida de install.ps1")
  assert.match(installPs1, /Write-Host "==> Instalando Tecnia Bot en: \$ConfigDir"/, "install.ps1 cambió el texto que busca la CI en instalacion.log")
})

test("el job de Windows compila ejemplos/_test-librerias (env uno) con el pio del bootstrap", () => {
  const win = job(ci, "windows")
  assert.match(win, /run -d ejemplos\\_test-librerias -e uno/, "no compila el proyecto de verificación para UNO")
  assert.match(win, /actions\/cache@v4[\s\S]*~\/\.platformio\/\.cache/, "sin cache de descargas cada corrida baja el toolchain entero")
  assert.match(win, /hashFiles\('ejemplos\/_test-librerias\/platformio\.ini'\)/, "la cache se invalida con platformio.ini")
})

test("el job de Windows desinstala con -Conservar y verifica que opencode.json quede sin tecnia-bot", () => {
  const win = job(ci, "windows")
  const i = win.indexOf("uninstall.ps1 -Conservar")
  assert.ok(i > 0, "no corre install\\uninstall.ps1 -Conservar")
  assert.match(win.slice(i), /agent\.tecnia-bot sigue|Properties\.Name -contains "tecnia-bot"/, "después de desinstalar no comprueba que agent.tecnia-bot se haya ido")
})

test("install.ps1 honra TECNIA_SIN_PROMPT (no pregunta la key) y sigue preguntando sin ella", () => {
  assert.match(installPs1, /\$env:TECNIA_SIN_PROMPT/, "install.ps1 no mira TECNIA_SIN_PROMPT: la CI esperaría 60 s por corrida")
  assert.match(installPs1, /\[Console\]::KeyAvailable/, "el prompt con timeout tiene que seguir existiendo para el docente")
  // Sólo ASCII, como todo .ps1 (lo cuida scripts-windows.test.mjs); acá, que el
  // mensaje del atajo no diga que hay key cuando no la hay.
  assert.match(installPs1, /TECNIA_SIN_PROMPT[\s\S]{0,400}sin key/, "el atajo tiene que dejar claro que se sigue SIN key")
})

test("build-installer.yml parsea la copia INSTALADA y comprueba OPENCODE_VERSION y el manifiesto de fichas", () => {
  const codigo = sinComentarios(build)
  const instala = codigo.indexOf("/skipdeps=1")
  assert.ok(instala > 0, "build-installer.yml ya no hace la instalación silenciosa")
  const despues = codigo.slice(instala)
  assert.match(despues, /\[System\.Management\.Automation\.Language\.Parser\]::ParseFile\(/, "no parsea los .ps1 que quedaron instalados")
  assert.match(despues, /install\\OPENCODE_VERSION/, "no comprueba que install\\OPENCODE_VERSION viaje en el .exe: sin él bootstrap.ps1 se corta")
  assert.match(despues, /opencode\\skills\\fichas\\MANIFEST\.sha256/, "no comprueba que el manifiesto de las fichas viaje en el .exe")
  assert.match(despues, /shell: powershell\s*$/m, "el parseo de la copia instalada tiene que ser con Windows PowerShell 5.1")
})
