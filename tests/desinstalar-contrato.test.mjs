// El desinstalador de Windows: el CÓDIGO DE SALIDA es un contrato, y la purga de
// datos personales no puede depender de que exista el manifest ni de que se pueda
// escribir un archivo de config.
//
// POR QUÉ ESTE ARCHIVO. `install/uninstall.ps1` tenía tres caminos por los que
// Windows terminaba informando una desinstalación correcta con datos de menores y
// la credencial del docente todavía en el disco:
//
//   1. Salía SIEMPRE por 0, también después de imprimir «se desinstaló
//      PARCIALMENTE». Quien lo lanza (el desinstalador de Inno, la CI) leía éxito.
//   2. Sin manifest hacía `exit 0` en la línea 37 y nunca llegaba a la sección de
//      perfil, memoria y key: `-Borrar` no borraba nada.
//   3. Corre con `$ErrorActionPreference = "Stop"`: una escritura que fallaba sobre
//      `tui.json` u `opencode.json` (sólo lectura, tomado por OpenCode) cortaba el
//      script ANTES de llegar a los datos personales.
//
// Y el cierre decía «(OpenCode y PlatformIO NO se tocaron: son independientes.)»,
// callando Scoop, Python, Node, la carpeta de proyectos y el historial de OpenCode.
//
// LÍMITE HONESTO: acá no hay PowerShell. Son guardas de FORMA sobre el código SIN
// comentarios (los comentarios de este repo citan los bugs, y una cita no es
// código), verificadas por mutación. La ejecución real va a la VM y al job
// `windows` de la CI. Las mutaciones que pusieron rojo cada test están anotadas
// arriba de cada uno: si alguien "simplifica" el test, que sepa qué deja de ver.
//
// Corre con: node --test tests/desinstalar-contrato.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const sinComentarios = (t) => t.replace(/^\s*#.*$/gm, "")
const PS = sinComentarios(readFileSync(join(REPO, "install/uninstall.ps1"), "utf8"))

/** Todas las sentencias `exit` del script, con su posición. */
const salidas = () => [...PS.matchAll(/\bexit\b[ \t]*(\S*)/g)].map((m) => ({ i: m.index, codigo: m[1] }))

// Mutación que lo puso rojo: volver a poner `exit 0` adentro del
// `if (-not $HayManifest) { ... }` de arriba → exit code 1 de este archivo.
test("no hay NINGUNA salida antes de la purga de datos personales (sin manifest también se purga)", () => {
  const iPerfil = PS.indexOf("Borrar-YVerificar $_")
  const iKey = PS.indexOf('Properties.Remove("google")')
  const iUltimoPendiente = PS.lastIndexOf("Anotar-Pendiente")
  assert.ok(iPerfil > 0 && iKey > iPerfil, "no encuentro la purga del perfil y de la key: cambió la forma, revisar este test")
  const todas = salidas()
  assert.equal(todas.length, 2, `esperaba DOS exit (el 3 de parcial y el 0 final) y hay ${todas.length}`)
  for (const s of todas) {
    assert.ok(
      s.i > iKey && s.i > iUltimoPendiente,
      `hay un exit ${s.codigo} antes de terminar la purga: por ese camino los datos personales quedan en el disco`,
    )
  }
  // Y la falta de manifest saltea SÓLO el borrado de la capa: la lectura del
  // manifest vive adentro de su guarda, y la guarda no envuelve nada más.
  const iGuarda = PS.indexOf("$NoBorrados = New-Object")
  assert.match(PS.slice(iGuarda, iGuarda + 120), /\nif \(\$HayManifest\) \{/, "el borrado de la capa ya no cuelga de `if ($HayManifest)`")
  const iLee = PS.indexOf("Get-Content $Manifest")
  assert.ok(iGuarda >= 0 && iLee > iGuarda, "el manifest se lee sin mirar antes si existe")
  assert.doesNotMatch(PS, /if \(-not \(Test-Path \$Manifest\)\) \{[^}]*exit/, "volvió el `exit` cuando falta el manifest")
})

// Mutación que lo puso rojo: `if ($Pendientes.Count -gt 0) { exit 0 }` → exit code 1.
test("el contrato de salida: 3 si quedó algo sin borrar, 0 sólo si no quedó nada", () => {
  assert.match(PS, /if \(\$Pendientes\.Count -gt 0\) \{ exit 3 \}\s*\nexit 0\s*$/,
    "uninstall.ps1 no termina con `if ($Pendientes.Count -gt 0) { exit 3 }` seguido de `exit 0`")
  // El 3 sale DESPUÉS del resumen que lista lo pendiente: un código sin explicación
  // en pantalla no le sirve al docente que lo corre a mano.
  assert.ok(PS.indexOf("exit 3") > PS.indexOf("se desinstalo PARCIALMENTE"), "el exit 3 sale antes de decir qué quedó")
  // Un opencode.json que no parsea deja nuestras claves adentro: eso es parcial.
  const iAviso = PS.indexOf("No pude parsear ${OpencodeJson}")
  assert.ok(iAviso > 0, "ya no avisa cuando opencode.json no parsea")
  assert.match(PS.slice(iAviso, iAviso + 600), /Anotar-Pendiente/,
    "un opencode.json que no parsea se informa pero no cuenta como pendiente: saldría por 0 con las claves adentro")
})

/** El `try { ... } catch { ... }` de primer nivel que contiene la posición `i`. */
function tryQueEnvuelve(i, que) {
  const iTry = PS.lastIndexOf("\ntry {", i)
  assert.ok(iTry >= 0, `${que} no está adentro de ningún try de primer nivel`)
  const iCatch = PS.indexOf("\n} catch {", iTry)
  assert.ok(iCatch > i, `${que}: el try que tiene arriba se cierra antes de llegar (quedó afuera)`)
  const iFin = PS.indexOf("\n}\n", iCatch + 1)
  assert.ok(iFin > iCatch, `${que}: el catch no cierra`)
  return PS.slice(iCatch, iFin)
}

// Mutación que lo puso rojo: sacar el `try {` de arriba de `$tui = Read-JsonObject`
// (y su catch) → exit code 1. Y vaciar el catch de opencode.json → exit code 1.
test("una escritura que falla sobre tui.json u opencode.json NO corta el script: se anota y la purga corre", () => {
  assert.match(PS, /\$ErrorActionPreference = "Stop"/, "cambió ErrorActionPreference: revisar si este test sigue haciendo falta")
  for (const [llamada, que] of [
    ["Save-OrRemove $TuiJson $tui", "la escritura de tui.json"],
    ["Save-OrRemove $OpencodeJson $oc", "la escritura de opencode.json"],
  ]) {
    const i = PS.indexOf(llamada)
    assert.ok(i > 0, `no encuentro ${que}`)
    const cuerpoCatch = tryQueEnvuelve(i, que)
    assert.match(cuerpoCatch, /Anotar-Pendiente/, `${que}: el catch se traga el error sin anotarlo como pendiente (saldría por 0)`)
    assert.match(cuerpoCatch, /GetType\(\)\.Name/, `${que}: el catch no dice qué tipo de error fue`)
    assert.doesNotMatch(cuerpoCatch, /Exception\.Message/, `${que}: imprime el mensaje de la excepción (trae rutas y contenido)`)
    // Y los dos try están ANTES de los datos personales: es el orden que hace que importe.
    assert.ok(i < PS.indexOf("Borrar-YVerificar $_"), `${que} quedó después de la purga`)
  }
})

// Mutación que lo puso rojo: sacar la línea de "apps\nodejs-lts" → exit code 1.
// Y volver a poner el Write-Host viejo → exit code 1.
test("el cierre nombra TODO lo que queda instalado, y sólo lo que encontró en el disco", () => {
  assert.doesNotMatch(PS, /OpenCode y PlatformIO NO se tocaron/,
    "volvió el cierre viejo, que nombra dos de las siete cosas que quedan")
  const iLista = PS.indexOf("$Quedan = New-Object")
  assert.ok(iLista > 0, "ya no arma la lista de lo que queda")
  const lista = PS.slice(iLista, PS.indexOf("exit 3"))
  // Cada cosa que instala bootstrap.ps1 (Scoop, OpenCode, Python, Node, PlatformIO),
  // la carpeta de proyectos que crea el lanzador y los datos de OpenCode.
  for (const [patron, que] of [
    [/Anotar-SiEsta \$Quedan \$ScoopDir /, "Scoop"],
    [/Anotar-SiEsta \$Quedan \(Join-Path \$ScoopDir "apps\\opencode"\)/, "OpenCode"],
    [/Anotar-SiEsta \$Quedan \(Join-Path \$ScoopDir "apps\\python"\)/, "Python"],
    [/Anotar-SiEsta \$Quedan \(Join-Path \$ScoopDir "apps\\nodejs-lts"\)/, "Node"],
    [/Anotar-SiEsta \$Quedan \$pd /, "PlatformIO"],
    [/Anotar-SiEsta \$Quedan \$pr /, "la carpeta de proyectos"],
    [/Anotar-SiEsta \$Quedan \$DataDir /, "el historial y los datos de OpenCode"],
  ]) {
    assert.match(lista, patron, `el cierre no busca ${que}: quedaría instalado sin que nadie lo diga`)
  }
  // No se afirma de memoria: lo único que agrega a la lista es la función que mira el disco.
  const fn = PS.slice(PS.indexOf("function Anotar-SiEsta"), iLista)
  assert.match(fn, /if \(Test-Path -LiteralPath \$ruta\) \{ \[void\]\$lista\.Add\(/, "Anotar-SiEsta agrega sin mirar si la ruta existe")
  assert.equal((lista.match(/\$Quedan\.Add\(/g) ?? []).length, 0, "algo se agrega a $Quedan sin pasar por Anotar-SiEsta (sin mirar el disco)")
  // Las rutas salen de donde las saca el resto del repo, no de un literal nuevo.
  assert.match(lista, /\$env:SCOOP/, "no honra SCOOP")
  assert.match(lista, /\$env:PLATFORMIO_CORE_DIR/, "no honra PLATFORMIO_CORE_DIR")
  assert.match(lista, /GetPathRoot\(\$env:USERPROFILE\)/, "no mira la raiz del disco, adonde PlatformIO se muda con un usuario no-ASCII")
  assert.match(lista, /GetFolderPath\("MyDocuments"\)/, "no le pregunta a Windows dónde está Documentos")
  // Y la lista es informativa: no puede cambiar el código de salida ni cortar el script.
  assert.match(lista, /\} catch \{ \}/, "armar la lista no está protegido: un error ahí cambiaría el código de salida")
})
