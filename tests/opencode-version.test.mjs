// La versión de OpenCode se fija en UN archivo, y los dos bootstraps la leen de ahí.
//
// POR QUÉ EXISTE ESTE ARCHIVO. Una auditoría encontró que `bootstrap.ps1` hacía
// `scoop install opencode` a secas: cada PC de la escuela se llevaba la versión
// que fuera la última ESE DÍA. En la VM, con la 1.18.18 instalada y probada,
// Scoop ya ofrecía la 1.18.29 sin que nadie la hubiera visto andar. Mientras
// tanto `bootstrap.sh` fijaba a mano OTRA versión, más vieja. Dos plataformas,
// dos OpenCode, y una capa educativa que depende de detalles que OpenCode cambia
// entre versiones (default_agent, instructions, agent.<nombre>.model, tui.json,
// el cargador de plugins).
//
// La regla: LA FUENTE DE VERDAD ES `install/OPENCODE_VERSION`. Todo lo demás la
// lee; nadie la copia a mano. Y Scoop no puede pisarla: `scoop hold`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (...p) => readFileSync(join(REPO, ...p), "utf8")

/** Un .ps1 o .sh sin sus líneas de comentario: los comentarios NOMBRAN los
 *  comandos para explicar por qué están, y un test que los cuente pasa aunque el
 *  código diga otra cosa. */
const sinComentarios = (txt) => txt.replace(/^\s*#.*$/gm, "")

const pin = leer("install", "OPENCODE_VERSION")
const ps1 = sinComentarios(leer("install", "bootstrap.ps1"))
const sh = sinComentarios(leer("install", "bootstrap.sh"))
const iss = leer("installer", "tecnia-bot.iss").replace(/^\s*;.*$/gm, "")

test("install/OPENCODE_VERSION existe y es una versión semántica, con salto de línea final", () => {
  assert.match(pin, /^\d+\.\d+\.\d+\n$/, `el archivo dice ${JSON.stringify(pin)}`)
})

test("bootstrap.ps1 instala OpenCode FIJANDO la versión, nunca 'la última'", () => {
  // `scoop install opencode` seguido de fin de línea, espacio o comilla es la
  // forma sin versión. La buena termina en `@<algo>`.
  const sueltos = ps1
    .split("\n")
    .filter((l) => !/Write-Host/.test(l))
    .filter((l) => /scoop install opencode(?!@)\b/.test(l) && !/scoop install opencode@/.test(l))
  assert.deepEqual(
    sueltos.map((l) => l.trim()),
    [],
    "hay un `scoop install opencode` sin versión: esa PC se lleva la última que haya ese día",
  )
  const fijados = ps1.split("\n").filter((l) => !/Write-Host/.test(l) && /scoop install opencode@\$OpenCodeVersion/.test(l))
  assert.ok(fijados.length >= 1, "ningún `scoop install opencode@$OpenCodeVersion`: el bootstrap no instala la versión fijada")
})

test("bootstrap.ps1 lee la versión de install/OPENCODE_VERSION, relativo a sí mismo, y corta si falta", () => {
  assert.match(ps1, /Join-Path \$PSScriptRoot "OPENCODE_VERSION"/, "no lee install\\OPENCODE_VERSION al lado del script")
  // Que NO tenga la versión escrita a mano: la fuente de verdad es el archivo.
  assert.doesNotMatch(ps1, /\$OpenCodeVersion\s*=\s*"\d+\.\d+\.\d+"/, "la versión está hardcodeada en el .ps1")
  // Y que valide lo que leyó antes de mandárselo a Scoop.
  assert.match(ps1, /\$OpenCodeVersion -notmatch '\^\\d\+\\\.\\d\+\\\.\\d\+\$'/, "no valida la forma de la versión leída")
})

test("bootstrap.ps1 deja la versión fijada con `scoop hold opencode`", () => {
  const holds = ps1.split("\n").filter((l) => !/Write-Host/.test(l) && /scoop hold opencode/.test(l))
  assert.ok(holds.length >= 1, "sin `scoop hold opencode`, `scoop update *` cambia la versión (y pisa el binario sin AVX2)")
})

test("bootstrap.ps1 no cambia de versión desinstalando: como mucho `scoop reset` a una que ya está en disco", () => {
  // La regla de siempre: puede fallar, pero no puede romper. `scoop reset
  // app@ver` sólo mueve el junction 'current' y rehace los shims (libexec/
  // scoop-reset.ps1); si la versión no está, dice "isn't installed" y no toca nada.
  const comandos = ps1.split("\n").filter((l) => !/Write-Host/.test(l))
  assert.deepEqual(comandos.filter((l) => /scoop uninstall/.test(l)), [], "hay un scoop uninstall")
  const resets = comandos.filter((l) => /scoop reset opencode@\$OpenCodeVersion/.test(l))
  assert.ok(resets.length >= 1, "no hay `scoop reset opencode@$OpenCodeVersion` para activar la fijada cuando ya está en disco")
})

test("bootstrap.sh lee install/OPENCODE_VERSION y no tiene la versión escrita a mano", () => {
  assert.doesNotMatch(sh, /OPENCODE_VERSION="\d+\.\d+\.\d+"/, "bootstrap.sh tiene la versión hardcodeada")
  assert.match(sh, /OPENCODE_VERSION\b/, "bootstrap.sh no usa OPENCODE_VERSION")
  assert.match(sh, /\/OPENCODE_VERSION"/, "bootstrap.sh no lee el archivo install/OPENCODE_VERSION")
  assert.match(sh, /--version "\$OPENCODE_VERSION"/, "el instalador de OpenCode no recibe la versión fijada")
})

test("el .exe empaqueta install\\OPENCODE_VERSION (install\\* con subcarpetas)", () => {
  // O el archivo suelto, o toda la carpeta install\ recursiva: las dos formas lo
  // meten en el .exe. Lo que no puede pasar es que el bootstrap lo busque al lado
  // y no esté.
  const entero = /Source:\s*"\.\.\\install\\\*";[^\n]*DestDir:\s*"\{app\}\\install"/.test(iss)
  const suelto = /Source:\s*"\.\.\\install\\OPENCODE_VERSION"/.test(iss)
  assert.ok(entero || suelto, "el .iss no empaqueta install\\OPENCODE_VERSION: el bootstrap del .exe va a cortar por archivo faltante")
})

// ── Que CORRA no alcanza: tiene que ser el OpenCode que SCOOP ADMINISTRA ─────────
//
// En la VM, después de `scoop uninstall opencode`, el bootstrap dijo "[OK] ya
// esta instalado" y no instaló nada: en scoop\shims\opencode.exe había un binario
// ENTERO de 178 MB copiado por una versión vieja de Reparar-Shim. Scoop no lo
// administra; `Get-Command` lo encuentra; Test-OpenCode dice que sí. Un OpenCode
// fantasma que ninguna actualización va a tocar jamás.

/** El cuerpo de una función del .ps1 (sin comentarios), desde `function X {`
 *  hasta su cierre al mismo nivel. */
function cuerpo(nombre) {
  const ini = ps1.indexOf(`function ${nombre} {`)
  assert.ok(ini >= 0, `bootstrap.ps1 no define ${nombre}`)
  const fin = ps1.indexOf("\n}", ini)
  return ps1.slice(ini, fin + 2)
}

test("OpenCode cuenta como instalado sólo si Scoop lo registró (current\\manifest.json) Y arranca", () => {
  assert.match(cuerpo("Test-OpenCodeScoop"), /current\\manifest\.json/, "Test-OpenCodeScoop no mira current\\manifest.json")
  const instalado = cuerpo("Test-OpenCodeInstalado")
  assert.match(instalado, /Test-OpenCodeScoop/, "Test-OpenCodeInstalado no consulta a Scoop")
  assert.match(instalado, /\(Test-OpenCode\)/, "Test-OpenCodeInstalado no verifica que arranque")
  // Y es LO QUE DECIDE si se instala: la rama "ya esta instalado" cuelga de él.
  assert.match(
    ps1,
    /if \(Test-OpenCodeInstalado\) \{\s*\n\s*Write-Host "  \[OK\] OpenCode ya esta instalado"/,
    "la decisión de instalar no pasa por Test-OpenCodeInstalado: un exe suelto vuelve a dar [OK] sin instalar",
  )
  // Y no queda ningún `if (Test-OpenCode)` a secas decidiendo instalar o reinstalar.
  const decisionesSueltas = ps1.split("\n").filter((l) => /if \((-not )?\(?Test-OpenCode\)?\)\s*\{/.test(l) && !/-and/.test(l))
  assert.deepEqual(decisionesSueltas.map((l) => l.trim()), [], "hay decisiones que miran sólo si corre, no si Scoop lo tiene")
})

test("Fijar-OpenCode no dice [OK] si `scoop hold` imprimió ERROR o devolvió exit distinto de 0", () => {
  // `scoop hold` termina con exit 0 aunque falle (libexec/scoop-hold.ps1: `error
  // ...; continue` y `exit $exitcode` con la variable sin definir), y `error` es
  // un Write-Host "ERROR ...". En la VM: "ERROR 'opencode' is not installed" y
  // abajo nuestro "[OK] fijado".
  const f = cuerpo("Fijar-OpenCode")
  const ok = f.indexOf("[OK] OpenCode fijado")
  assert.ok(ok > 0, "Fijar-OpenCode no confirma con [OK]")
  const antes = f.slice(0, ok)
  assert.match(antes, /LASTEXITCODE -ne 0/, "no mira el exit code de scoop hold antes del [OK]")
  assert.match(antes, /'\^ERROR'/, "no busca una línea que empiece con ERROR antes del [OK]")
  assert.match(antes, /\[X\] No se pudo fijar la version/, "cuando falla no lo dice con [X]")
})

test("Reparar-Shim rehace el lanzador con `scoop reset opencode`, no copiando 178 MB", () => {
  // libexec/scoop-reset.ps1: rehace shims, 'current' y PATH desde la versión
  // instalada, sin descargar. La copia del binario entero queda sólo como último
  // recurso y avisando.
  //
  // Se cuentan COMANDOS, no los Write-Host que le cuentan al docente qué pasó:
  // el mensaje "'scoop reset opencode' no pudo rehacer el lanzador" nombra el
  // comando y no lo ejecuta. La primera versión de este test se comía eso y pasó
  // en verde con el reset mutado.
  const lineas = cuerpo("Reparar-Shim").split("\n")
  const esComando = (l) => !/Write-Host/.test(l)
  const reset = lineas.findIndex((l) => esComando(l) && /scoop reset opencode\b/.test(l))
  assert.ok(reset >= 0, "Reparar-Shim no ejecuta scoop reset opencode")
  const copia = lineas.findIndex((l) => esComando(l) && /Copy-Item \$BinOpenCode/.test(l))
  assert.ok(copia < 0 || copia > reset, "la copia del binario va ANTES que el reset: sigue creando el fantasma")
  if (copia >= 0) {
    assert.match(lineas.slice(copia).join("\n"), /FUERA de Scoop/, "copia el binario entero sin avisar que queda fuera de Scoop")
  }
})
