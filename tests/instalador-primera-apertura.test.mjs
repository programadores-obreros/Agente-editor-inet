// La primera apertura de Tecnia Bot no puede depender de la red.
//
// MEDIDO en una VM Windows 11 con la 0.4.10 (auditoría del 2026-11-18/19): la primera vez
// que arranca, OpenCode instala `@opencode-ai/plugin` en la carpeta de configuración y NO
// dibuja la pantalla hasta que esa instalación termina o falla, porque Tecnia Bot trae un
// plugin de servidor (plugins/tecnia-idioma.ts) y OpenCode espera las dependencias antes de
// cargar plugins. La ventana queda en negro, con el título "Tecnia Bot" y sin un cartel:
//
//   con buena red ............ 16 a 28 s
//   red cortada .............. 71 s
//   reloj atrasado 3 años .... 72 s   (certificate is not yet valid)
//   red filtrada ............. 135 s
//
// y se repite en CADA apertura hasta que la instalación sale bien una vez. Probado en la
// misma VM: si antes se corre `opencode debug config` con red (55 s), la apertura sin red
// baja de 71 s a 1 s. Por eso el instalador deja las dependencias puestas.
//
// Estos tests leen el texto de bootstrap.ps1, como el resto de tests/instalador-*.
// No ejecutan PowerShell: lo que corre de verdad se valida en la VM y en el CI de Windows.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const crudo = readFileSync(join(raiz, "install", "bootstrap.ps1"), "utf8")
// Sin comentarios: un comentario que nombra el comando no lo ejecuta.
const ps1 = crudo
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n")
// Sin los Write-Host tampoco: un cartel que nombra el comando no lo ejecuta.
const comandos = ps1
  .split("\n")
  .filter((l) => !/Write-Host/.test(l))
  .join("\n")

/** El cuerpo de una función del .ps1 (sin comentarios), hasta su cierre en la columna 0. */
function cuerpo(nombre) {
  const ini = ps1.indexOf(`function ${nombre} {`)
  assert.ok(ini >= 0, `bootstrap.ps1 no define ${nombre}`)
  const fin = ps1.indexOf("\n}", ini)
  assert.ok(fin > ini, `no encuentro el cierre de ${nombre}`)
  return ps1.slice(ini, fin + 2)
}

test("el instalador dispara la instalación de dependencias con `opencode debug config`, sobre el binario real", () => {
  const f = cuerpo("Preparar-PrimeraApertura")
  assert.match(f, /-FilePath \$BinOpenCode/, "no ejecuta el binario de OpenCode por su ruta (el shim puede no estar en el PATH)")
  assert.match(f, /-ArgumentList\s+"debug",\s*"config"/, "no corre `debug config`, que es el comando que carga la instancia y termina sin abrir la pantalla")
})

test("la preparación tiene tope de tiempo y mata el proceso si se pasa", () => {
  // OpenCode no tiene timeout propio para esta instalación: con la red filtrada tardó 135 s
  // en rendirse. Un instalador que se queda colgado ahí es peor que el negro que arregla.
  const f = cuerpo("Preparar-PrimeraApertura")
  assert.match(f, /\.WaitForExit\(\$TopePrimeraAperturaMs\)/, "espera sin tope")
  assert.match(f, /\.Kill\(\)/, "si se pasa del tope no corta el proceso")
  const tope = /\$TopePrimeraAperturaMs\s*=\s*(\d+)/.exec(ps1)
  assert.ok(tope, "no define $TopePrimeraAperturaMs")
  assert.ok(Number(tope[1]) >= 150000, `tope de ${tope[1]} ms: con red filtrada OpenCode tardó 135 s; un tope menor corta una instalación que iba a terminar`)
  assert.ok(Number(tope[1]) <= 300000, `tope de ${tope[1]} ms: más de 5 minutos colgado no es un tope`)
})

test("corre DESPUÉS de instalar la capa: sin el plugin copiado OpenCode no espera la instalación", () => {
  // packages/opencode/src/plugin/index.ts (v1.18.18): `if (plugins.length) yield* config.waitForDependencies()`.
  // Antes de install.ps1 no hay plugins: `debug config` saldría antes de que termine de bajar.
  const capa = comandos.indexOf('install\\install.ps1")')
  const llamada = comandos.indexOf("= [bool](Preparar-PrimeraApertura)")
  assert.ok(capa > 0, "no encuentro la llamada a install.ps1")
  assert.ok(llamada > 0, "bootstrap.ps1 define Preparar-PrimeraApertura pero no la llama")
  assert.ok(llamada > capa, "la preparación corre ANTES de instalar la capa")
})

test("que quedó se lee del DISCO, con la misma condición que usa OpenCode para saltear", () => {
  // packages/core/src/npm.ts:139-190 (v1.18.18): saltea si existe node_modules y el
  // package-lock.json nombra el paquete. El exit code no sirve: OpenCode loguea el fallo
  // como aviso y `debug config` sale con 0 igual.
  const f = cuerpo("Test-DependenciasOpenCode")
  assert.match(f, /node_modules\\@opencode-ai\\plugin\\package\.json/, "no mira que el paquete esté en node_modules")
  assert.match(f, /package-lock\.json/, "no mira el package-lock.json")
  // ESTE TEST ERA HUECO EN SU PRIMERA VERSIÓN. Con los dos asserts de arriba alcanzaba con
  // que la función NOMBRARA las rutas: borrando el `if (-not (Test-Path $paquete))` seguía
  // verde, porque la ruta sigue escrita en el Join-Path. Lo marcó la mutación del 2026-11-19.
  // Lo que se protege es que la AUSENCIA de cada archivo dé falso.
  assert.match(f, /if \(-not \(Test-Path \$paquete\)\) \{ return \$false \}/, "si falta el paquete en node_modules no devuelve falso")
  assert.match(f, /if \(-not \(Test-Path \$lock\)\) \{ return \$false \}/, "si falta el package-lock.json no devuelve falso")
  assert.match(f, /Select-String[^\n]*"@opencode-ai\/plugin"/, "no busca el paquete dentro del lock")
  // PowerShell 5.1 no puede leer ese archivo con ConvertFrom-Json (tiene una clave vacía ""):
  // visto en la VM el 2026-11-19, "el valor del argumento name no es válido".
  assert.doesNotMatch(f, /package-lock[^\n]*ConvertFrom-Json/, "lee el lock con ConvertFrom-Json, que en PowerShell 5.1 revienta")
})

test("el resultado de la preparación NO sale del exit code de OpenCode", () => {
  const f = cuerpo("Preparar-PrimeraApertura")
  assert.doesNotMatch(f, /ExitCode/, "decide mirando el exit code: `debug config` sale con 0 aunque no haya instalado nada")
  assert.match(f, /return \(Test-DependenciasOpenCode \$cfgDir\)/, "no devuelve lo que dice el disco")
})

test("si ya están, no las vuelve a bajar", () => {
  // Reparar Tecnia Bot corre este mismo script: 55 s de más en cada reparación, y sin red
  // un [!] nuevo sobre una máquina que estaba bien.
  const f = cuerpo("Preparar-PrimeraApertura")
  const chequeo = f.indexOf("if (Test-DependenciasOpenCode $cfgDir) { return $true }")
  const arranque = f.indexOf("Start-Process")
  assert.ok(chequeo > 0, "no pregunta primero si ya están")
  assert.ok(arranque > chequeo, "lanza OpenCode antes de mirar si hacía falta")
})

test("si no quedaron, el resumen lo dice y la instalación NO termina en LISTO", () => {
  const i = ps1.indexOf("Como quedo (lo que se comprobo")
  const fin = ps1.indexOf("LISTO! Abri una terminal")
  assert.ok(i > 0 && fin > i, "no encuentro el resumen final")
  const resumen = ps1.slice(i, fin)
  assert.match(resumen, /if \(\$PrimeraAperturaLista\) \{\s*\n\s*Write-Host "  \[OK\] Arranque/, "el [OK] de arranque no depende de lo que se comprobó")
  assert.match(resumen, /\$Degradado \+= "la primera vez que abras Tecnia Bot va a necesitar internet/, "cuando no quedaron no degrada el resultado: cerraría en LISTO")
  // Y la variable sale de la función, no de una marca puesta a mano.
  assert.match(comandos, /^\s*\$PrimeraAperturaLista = \[bool\]\(Preparar-PrimeraApertura\)/m, "$PrimeraAperturaLista no sale de la comprobación")
})

test("no se intenta sin OpenCode o sin la capa: no hay nada que preparar y el aviso sería ruido", () => {
  assert.match(
    comandos,
    /if \(\$CapaOk -and \(Test-Path \$BinOpenCode\)\) \{\s*\n\s*\$PrimeraAperturaLista = \[bool\]\(Preparar-PrimeraApertura\)/,
    "la preparación no está condicionada a que haya capa y binario",
  )
})
