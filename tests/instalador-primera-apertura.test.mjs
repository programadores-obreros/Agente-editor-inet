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
  // El corte va DENTRO de la rama del tope, mata el ÁRBOL y espera a que muera. La primera
  // versión de este assert sólo pedía que ".Kill()" apareciera en algún lado de la función:
  // lo marcó la revisión independiente. Un Kill() a secas deja vivo a cualquier hijo de
  // OpenCode y no espera, así que los temporales quedaban tomados y no se borraban.
  const rama = /if \(-not \$proc\.WaitForExit\(\$TopePrimeraAperturaMs\)\) \{([\s\S]*?)\n        \}\n/.exec(f)
  assert.ok(rama, "no encuentro la rama del tope")
  assert.match(rama[1], /taskkill\.exe \/PID \$proc\.Id \/T \/F/, "al pasarse del tope no mata el árbol de procesos")
  assert.match(rama[1], /\$proc\.WaitForExit\(\d+\)/, "después de matar no espera a que el proceso muera")
  const lineasRama = rama[1].split("\n").filter((l) => !/Write-Host/.test(l)).join("\n")
  assert.ok(lineasRama.indexOf("taskkill.exe") < lineasRama.indexOf("WaitForExit("), "espera antes de matar")
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
  assert.match(f, /if \(-not \(Test-Path -LiteralPath \$paquete\)\) \{ return \$false \}/, "si falta el paquete en node_modules no devuelve falso")
  assert.match(f, /if \(-not \(Test-Path -LiteralPath \$lock\)\) \{ return \$false \}/, "si falta el package-lock.json no devuelve falso")
  // Con -Path un corchete en la ruta es un comodín: el archivo "no existe" y la instalación
  // queda incompleta para siempre con todo bien puesto.
  assert.doesNotMatch(f, /(Test-Path|Select-String) (?!-LiteralPath)/, "usa -Path: una ruta con corchetes da falso con los archivos presentes")
  assert.match(f, /Select-String -LiteralPath \$lock[^\n]*"@opencode-ai\/plugin"/, "no busca el paquete dentro del lock")
  // PowerShell 5.1 no puede leer ese archivo con ConvertFrom-Json (tiene una clave vacía ""):
  // visto en la VM el 2026-11-19, "el valor del argumento name no es válido".
  assert.doesNotMatch(f, /package-lock[^\n]*ConvertFrom-Json/, "lee el lock con ConvertFrom-Json, que en PowerShell 5.1 revienta")
})

test("el resultado de la preparación NO sale del exit code de OpenCode", () => {
  const f = cuerpo("Preparar-PrimeraApertura")
  assert.doesNotMatch(f, /ExitCode/, "decide mirando el exit code: `debug config` sale con 0 aunque no haya instalado nada")
  assert.match(f, /\$quedo = \[bool\]\(Test-DependenciasOpenCode \$cfgDir\)/, "no lee el disco después de correr OpenCode")
  assert.match(f, /\n    return \$quedo\n\}$/, "no devuelve lo que dice el disco")
  // Y $quedo no se pisa en ningún otro lado.
  assert.equal((f.match(/\$quedo\s*=/g) || []).length, 1, "$quedo se asigna más de una vez")
})

test("si ya están, igual se comprueba que OpenCode arranca, y el veredicto sale del disco DESPUÉS", () => {
  // HISTORIA. Este test pedía lo contrario: `if (Test-DependenciasOpenCode $cfgDir) { return $true }`
  // como primera línea, para no gastar tiempo en cada Reparar. Ese atajo era un OK falso:
  // con las dependencias puestas y la base de un OpenCode 2.x en la compu, el instalador
  // cerraba en "[OK] Arranque" sin haber ejecutado nada y la ventana quedaba en negro sin
  // fin. Lo marcó la revisión del 2026-11-21. Con las dependencias puestas `debug config`
  // no baja nada, así que no vuelve el costo que este test cuidaba.
  const f = cuerpo("Preparar-PrimeraApertura")
  assert.doesNotMatch(f, /\{ return \$true \}/, "vuelve con verdadero sin ejecutar OpenCode: no puede saber si arranca")
  const arranque = f.indexOf("Start-Process")
  const veredicto = f.indexOf("$quedo = [bool](Test-DependenciasOpenCode $cfgDir)")
  assert.ok(arranque > 0 && veredicto > arranque, "el veredicto no se toma mirando el disco después de ejecutar")
  assert.match(f, /return \$quedo\n\}$/, "no devuelve lo que vio en el disco")
  // Y no le dice "baja unos archivos; hasta 3 minutos" a quien ya los tiene.
  assert.match(f, /if \(\$yaEstaban\) \{\s*\n\s*Write-Host "  \[\.\.\] Comprobando que OpenCode arranca/, "anuncia una descarga aunque ya esté todo")
})

test("si no quedaron, el resumen lo dice y la instalación NO termina en LISTO", () => {
  const i = ps1.indexOf("Como quedo (lo que se comprobo")
  const fin = ps1.indexOf("LISTO! Abri una terminal")
  assert.ok(i > 0 && fin > i, "no encuentro el resumen final")
  const resumen = ps1.slice(i, fin)
  assert.match(resumen, /if \(\$PrimeraAperturaLista\) \{\s*\n\s*Write-Host "  \[OK\] Arranque/, "el [OK] de arranque no depende de lo que se comprobó")
  assert.match(resumen, /\$Degradado \+= "la primera vez que abras Tecnia Bot va a necesitar internet/, "cuando no quedaron no degrada el resultado: cerraría en LISTO")
  // El aviso de degradado vive DENTRO del bloque que sólo corre si se intentó, y ese
  // bloque depende de una marca que se pone al intentarlo. La primera versión no lo
  // protegía: borrando `$PrimeraAperturaIntentada = $true` el resumen se salteaba entero
  // y una instalación que no pudo bajar nada cerraba en LISTO. Lo marcó la revisión.
  const bloque = /if \(\$PrimeraAperturaIntentada\) \{\n([\s\S]*?)\n\}\n/.exec(resumen)
  assert.ok(bloque, "el resumen no tiene el bloque condicionado a que se haya intentado")
  assert.match(bloque[1], /\$Degradado \+= "la primera vez que abras/, "el degradado quedó fuera del bloque")
  assert.match(
    comandos,
    /\$PrimeraAperturaLista = \[bool\]\(Preparar-PrimeraApertura\)\s*\n\s*\$PrimeraAperturaIntentada = \$true/,
    "no marca que se intentó: el resumen se saltearía y cerraría en LISTO",
  )
  // Y la variable sale de la función, no de una marca puesta a mano.
  assert.match(comandos, /^\s*\$PrimeraAperturaLista = \[bool\]\(Preparar-PrimeraApertura\)/m, "$PrimeraAperturaLista no sale de la comprobación")
})

test("si no quedó, muestra lo que dijo OpenCode por su salida de errores y nunca la estándar", () => {
  // La salida estándar de `debug config` es la configuración entera. La de errores es lo
  // único que explica por qué no bajó (antivirus, disco, permisos), y sin eso el aviso
  // afirmaba una causa de red que nadie había medido.
  const f = cuerpo("Preparar-PrimeraApertura")
  assert.match(f, /Get-Content -LiteralPath \$errores -Tail \d+/, "no muestra la cola de la salida de errores")
  assert.doesNotMatch(f, /Get-Content[^\n]*\$salida/, "lee la salida estándar, que es la configuración entera")
  assert.match(f, /Remove-Item -LiteralPath \$t -Force/, "no borra los temporales")
  assert.match(f, /if \(\$salida -and \(Test-Path -LiteralPath \$salida\)\) \{\s*\n\s*Write-Host "  \[i\] No pude borrar un archivo temporal con la configuracion/, "si el temporal con la configuración no se pudo borrar, no lo dice")
})

test("no se intenta sin OpenCode o sin la capa: no hay nada que preparar y el aviso sería ruido", () => {
  assert.match(
    comandos,
    /elseif \(\$CapaOk -and \(Test-Path \$BinOpenCode\)\) \{\s*\n\s*\$PrimeraAperturaLista = \[bool\]\(Preparar-PrimeraApertura\)/,
    "la preparación no está condicionada a que haya capa y binario",
  )
})

// ── Lo que apareció al probar el caso "el docente ya tenía OpenCode 2.x por Scoop" ──────
//
// VM Windows 11, 2026-11-20, con el instalador de esta rama. Tres cosas, ninguna prevista:
//
//   1. Con el 2.3.2 activo, `debug config` vuelve enseguida, no instala nada y deja vivo
//      un `opencode serve --service`. El .exe termina, pero quien espere al árbol de
//      procesos queda colgado (la prueba estuvo 45 minutos así).
//   2. El cierre mandaba a "Reparar", que no cambia la versión: Scoop vuelve a contestar
//      "already installed". Lo que sí la cambia es `scoop uninstall opencode` (alcanza
//      solo, aun con hold) y volver a instalar, pero eso NO se le imprime al docente:
//      lo prohíbe un guard con historia (ver el test de la versión equivocada).
//   3. Después de eso el 1.18.18 encuentra la base que dejó el 2.x, dice "Database is not
//      empty and has no session table" y al abrir queda EN NEGRO SIN FIN. Con opencode.db
//      apartada abrió en 21 s.

test("con un OpenCode que no es el fijado NO se ejecuta la preparación", () => {
  // Va ANTES que la rama que prepara, y compara contra la versión fijada. Si se invierte
  // el orden o se borra la rama, vuelve el `serve --service` huérfano del punto 1.
  assert.match(
    comandos,
    /\$OpenCodeParaPreparar = Get-OpenCodeVersionInstalada\s*\nif \(\$CapaOk -and \(Test-Path \$BinOpenCode\) -and \(\$OpenCodeParaPreparar -ne \$OpenCodeVersion\)\) \{\s*\n\s*if \(\$OpenCodeParaPreparar\) \{\s*\n\s*\} else \{\s*\n\s*\}\s*\n\} elseif \(\$CapaOk -and \(Test-Path \$BinOpenCode\)\) \{\s*\n\s*\$PrimeraAperturaLista = \[bool\]\(Preparar-PrimeraApertura\)/,
    "la preparación corre aunque el OpenCode activo no sea el fijado",
  )
})

test("con la versión equivocada, el cierre avisa que Reparar no la cambia (y no manda a un bucle)", () => {
  // La primera versión de este cambio imprimía el remedio que funcionó en la VM
  // (`scoop uninstall opencode` + reinstalar). Lo frenó el guard de instalador.test.mjs
  // "tampoco se le SUGIERE al docente un comando destructivo", y tenía razón: sale de una
  // notebook que quedó sin OpenCode. Lo que queda es decir la verdad: Reparar no lo cambia.
  const m = /elseif \(-not \$OpenCodeEsLaFijada\) \{\n([\s\S]*?)\n\} else \{/.exec(ps1)
  assert.ok(m, "no encuentro la rama de la versión equivocada en el resumen")
  assert.match(m[1], /\$Degradado \+= "[^"]*Reparar NO lo cambia/, "no avisa que Reparar es un bucle para este caso")
})

test("la base de un OpenCode más nuevo se reconoce por lo que dijo OpenCode y no sale con el aviso de red", () => {
  const f = cuerpo("Preparar-PrimeraApertura")
  assert.match(f, /if \(\(\$dicho -join " "\) -match "Database is not empty"\) \{ \$script:BaseDeOtraVersion = \$true \}/, "no reconoce el mensaje de la base incompatible")
  // SE MIRA SIEMPRE, no sólo cuando faltan las dependencias: la primera versión lo buscaba
  // dentro de `if (-not $quedo)` y con las dependencias ya puestas nunca lo veía. Y se
  // buscan 40 líneas, no las 6 que se muestran: una traza después del mensaje lo tapaba.
  const antes = f.slice(0, f.indexOf('-match "Database is not empty"'))
  assert.doesNotMatch(antes, /if \(\(?-not \$quedo\)?/, "la base sólo se busca cuando faltan las dependencias")
  assert.match(f, /\$dicho = @\(Get-Content -LiteralPath \$errores -Tail (\d+)/, "no lee la salida de errores para buscar el mensaje")
  assert.ok(Number(/\$dicho = @\(Get-Content -LiteralPath \$errores -Tail (\d+)/.exec(f)[1]) >= 40, "busca el mensaje en muy pocas líneas")
  // Con la base de otra versión NO está lista aunque las dependencias estén.
  assert.match(comandos, /\$PrimeraAperturaIntentada = \$true\s*\n\s*if \(\$script:BaseDeOtraVersion\) \{ \$PrimeraAperturaLista = \$false \}/, "con la base incompatible y las dependencias puestas diría [OK] Arranque")
  // La marca arranca en falso ANTES de preparar: si no, una corrida vieja en la misma sesión la deja puesta.
  assert.match(comandos, /\$script:BaseDeOtraVersion = \$false[\s\S]*\$OpenCodeParaPreparar = Get-OpenCodeVersionInstalada/, "la marca no se limpia antes de preparar")
  const i = ps1.indexOf("Como quedo (lo que se comprobo")
  const resumen = ps1.slice(i, ps1.indexOf("LISTO! Abri una terminal"))
  const bloque = /if \(\$PrimeraAperturaIntentada\) \{\n([\s\S]*?)\n\}\n/.exec(resumen)
  // El orden importa: OK, después la base, y recién al final el aviso de red.
  const rama = /\} elseif \(\$script:BaseDeOtraVersion\) \{\n([\s\S]*?)\n    \} else \{/.exec(bloque[1])
  assert.ok(rama, "el resumen no tiene una rama propia para la base incompatible")
  // Se pide la frase entera "cambiale el nombre a opencode.db". La primera versión sólo
  // pedía que "opencode.db" apareciera después de la carpeta, y lo cumplía el ejemplo
  // ("opencode.db.viejo") aunque el aviso ya no dijera QUÉ archivo tocar: mutante vivo.
  assert.match(rama[1], /\$Degradado \+= "[^"]*EN NEGRO[^"]*\$DatosOpenCode[^"]*cambiale el nombre a opencode\.db /, "no dice qué archivo apartar ni dónde está")
  assert.doesNotMatch(rama[1], /necesitar internet/, "le echa la culpa a la red")
  assert.match(comandos, /\$DatosOpenCode = if \(\$env:XDG_DATA_HOME\) \{ Join-Path \$env:XDG_DATA_HOME "opencode" \} else \{ Join-Path \$env:USERPROFILE "\.local\\share\\opencode" \}/, "la carpeta de datos no sale de donde OpenCode la busca")
})

test("el cierre no manda a Reparar cuando Reparar no arregla lo que falta, ni dice que abre cuando no abre", () => {
  // Lo marcó la revisión: el aviso decía "Reparar NO lo cambia" y dos líneas más abajo el
  // cierre común decía "Para completar lo que falta: Reparar Tecnia Bot". Y con la base
  // incompatible el título era "quedo instalado y abre".
  const cierre = /if \(\$Degradado\.Count -gt 0\) \{\n([\s\S]*?)exit \$CodigoDegradado/.exec(ps1)
  assert.ok(cierre, "no encuentro el cierre de la instalación incompleta")
  assert.match(cierre[1], /if \(\$ReparaSirve\) \{\s*\n\s*Write-Host "  Para completar lo que falta:  menu inicio -> Reparar Tecnia Bot"/, "manda a Reparar sin mirar si sirve")
  assert.match(cierre[1], /if \(\$script:BaseDeOtraVersion\) \{\s*\n\s*Write-Host "  Tecnia Bot quedo instalado, PERO ASI NO ABRE:"/, "dice que abre cuando no va a abrir")
  // Los dos avisos que Reparar no arregla NO prenden la marca; los demás sí.
  const marcado = (ini) => new RegExp(`\\$Degradado \\+= "${ini}[^\\n]*\\n\\s*\\$ReparaSirve = \\$true`).test(ps1)
  for (const ini of ["falta PlatformIO", "falta Node", "la capa se instalo CON AVISOS", "la primera vez que abras"]) assert.ok(marcado(ini), `"${ini}" se arregla con Reparar y no lo dice`)
  for (const ini of ["OpenCode quedo en la version", "en esta compu hubo un OpenCode mas nuevo"]) assert.ok(!marcado(ini), `"${ini}" no se arregla con Reparar y manda igual`)
  assert.match(comandos, /^\$ReparaSirve = \$false$/m, "la marca no arranca apagada")
})

test("si no se intentó preparar y al final el OpenCode era el fijado, no cierra en LISTO", () => {
  // Caso angosto que marcó la revisión: la versión activa no se pudo leer al momento de
  // preparar (se saltea) y al llegar al resumen sí es la fijada. Sin esto: [OK] OpenCode,
  // ninguna línea de Arranque y LISTO, sin haber preparado ni comprobado nada.
  assert.match(
    ps1,
    /if \(\(-not \$PrimeraAperturaIntentada\) -and \$CapaOk -and \$OpenCodeArranca -and \$OpenCodeEsLaFijada\) \{\n\s*\$ReparaSirve = \$true\n\s*\$Degradado \+= "no se pudo preparar la primera apertura/,
    "saltear la preparación con el OpenCode correcto no degrada el resultado",
  )
})
