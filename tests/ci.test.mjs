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

// Bloque de un job: desde "  <nombre>:" (2 espacios) hasta la siguiente clave con la
// misma sangría, o el final del archivo.
function job(yaml, nombre) {
  const m = yaml.match(new RegExp(`^  ${nombre}:\\n([\\s\\S]*?)(?=^  [a-z_-]+:\\n|(?![\\s\\S]))`, "m"))
  assert.ok(m, `ci.yml no tiene el job "${nombre}"`)
  return m[1]
}

test("ci.yml conserva el job de Linux y ahora corre el typecheck antes de los tests", () => {
  const linux = job(ci, "test")
  assert.match(linux, /runs-on: ubuntu-latest/, "el job de Linux tiene que seguir en ubuntu-latest")
  assert.match(linux, /pnpm install --frozen-lockfile/, "sin instalar deps no hay tipos de Bun ni del plugin")
  assert.match(linux, /pnpm typecheck/, "la CI no corre `pnpm typecheck`: estuvo roto con 88 errores sin que nadie lo viera")
  assert.match(linux, /pnpm test|node --test tests\/\*\.test\.mjs/, "la CI dejó de correr los smoke tests")
  assert.ok(ci.indexOf("pnpm typecheck") < ci.indexOf("pnpm test"), "el typecheck va antes que los tests: es más barato y corta antes")
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
  const instala = build.indexOf("/skipdeps=1")
  assert.ok(instala > 0, "build-installer.yml ya no hace la instalación silenciosa")
  const despues = build.slice(instala)
  assert.match(despues, /\[System\.Management\.Automation\.Language\.Parser\]::ParseFile\(/, "no parsea los .ps1 que quedaron instalados")
  assert.match(despues, /install\\OPENCODE_VERSION/, "no comprueba que install\\OPENCODE_VERSION viaje en el .exe: sin él bootstrap.ps1 se corta")
  assert.match(despues, /opencode\\skills\\fichas\\MANIFEST\.sha256/, "no comprueba que el manifiesto de las fichas viaje en el .exe")
  assert.match(despues, /shell: powershell\s*$/m, "el parseo de la copia instalada tiene que ser con Windows PowerShell 5.1")
})
