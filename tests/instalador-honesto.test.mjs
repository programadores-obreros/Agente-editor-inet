// El instalador de Windows no puede decir "listo" sin haber mirado — segunda tanda.
//
// POR QUÉ ESTE ARCHIVO. Una auditoría del instalador encontró una familia entera
// de OK falsos que `tests/instalador.test.mjs` no cubría: el `.exe` no leía el
// código de salida del bootstrap, el bootstrap cerraba con "LISTO!" aunque
// faltaran PlatformIO o Node, el compilador del `.exe` festejaba un `.exe` viejo,
// y el desinstalador guardaba un código que nadie leía.
//
// LO QUE ESTOS TESTS SON Y LO QUE NO SON. Acá no hay PowerShell de Windows ni
// ISCC: nada de `install/*.ps1`, `installer/*.iss` ni `installer/*.cmd` se puede
// EJECUTAR desde Linux. Lo máximo posible son guardas ESTRUCTURALES sobre el
// código, y por eso todas miran el archivo SIN COMENTARIOS: los comentarios de
// estos archivos citan los comandos para explicar los bugs, y una guarda que
// matchea la cita aprueba un producto roto (ya mordió cuatro veces en el repo,
// ver `instalador.test.mjs`). Cada guarda de acá se verificó por mutación:
// rompiendo la línea que dice proteger, este archivo sale con código distinto de 0.
//
// La ejecución real es del job `windows` de la CI y de la VM win10 con el `.exe`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (...p) => readFileSync(join(REPO, ...p), "utf8")

/** Un `.ps1` sin sus líneas de comentario. */
const sinComentariosPs = (txt) => txt.replace(/^\s*#.*$/gm, "")

const bootstrap = sinComentariosPs(leer("install", "bootstrap.ps1"))

/** El cuerpo de una función de PowerShell, contando llaves (mismo criterio que
 *  `funcion()` en instalador.test.mjs: una ventana de N caracteres mide lo que le
 *  toca, no lo que se quiere). */
function funcionPs(codigo, nombre) {
  const i = codigo.indexOf(`function ${nombre} {`)
  assert.ok(i >= 0, `no está la función ${nombre}`)
  let nivel = 0
  for (let j = codigo.indexOf("{", i); j < codigo.length; j++) {
    if (codigo[j] === "{") nivel++
    else if (codigo[j] === "}" && --nivel === 0) return codigo.slice(i, j + 1)
  }
  assert.fail(`la función ${nombre} no cierra llave`)
}

// ── 2.12 · Node: que conteste no alcanza, tiene que servirle a archify ─────────
//
// `Buscar-Node` aceptaba cualquier salida que empezara con "v" y un dígito. Un
// Node 12 instalado de antes daba "[OK] Node ya esta instalado" y el skill de
// diagramas fallaba después, adentro del bot. El mínimo lo fija archify en su
// package.json, y el bootstrap lo lee de AHÍ: no hay un 18 escrito en el .ps1.

test("Buscar-Node compara la versión mayor contra el mínimo, no acepta cualquier «v»", () => {
  const fn = funcionPs(bootstrap, "Buscar-Node")
  // Todo `return $ruta` tiene que estar condicionado por la comparación con el
  // mínimo en su misma línea: un `return $ruta` suelto es el defecto original.
  const retornos = fn.split("\n").filter((l) => /return\s+\$ruta/.test(l))
  assert.ok(retornos.length >= 1, "Buscar-Node no devuelve nunca una ruta")
  for (const l of retornos) {
    assert.match(l, /-ge\s+\$NodeMinimo/, `devuelve un Node sin comprobar que alcance: ${l.trim()}`)
  }
  assert.match(fn, /\[int\]\$Matches\[1\]/, "no saca la versión mayor de lo que contestó el binario")
})

test("el mínimo de Node sale del package.json de archify, no de un número a fuego", () => {
  // La fuente existe y dice lo que el bootstrap espera leer.
  const pkg = JSON.parse(leer("opencode", "skills", "archify", "package.json"))
  assert.match(String(pkg.engines?.node), /^>=\d+$/, "archify ya no declara engines.node como «>=N»: el bootstrap no lo va a poder leer")

  assert.match(bootstrap, /\$ArchivoMotorNode\s*=\s*Join-Path\s+\$RepoDir\s+"opencode\\skills\\archify\\package\.json"/,
    "el bootstrap no apunta al package.json de archify")
  assert.match(bootstrap, /Get-Content\s+\$ArchivoMotorNode[^\n]*ConvertFrom-Json\)\.engines\.node/,
    "el bootstrap no lee engines.node")
  // Ninguna asignación de $NodeMinimo con un número distinto de 0 (0 = "no lo pude leer").
  const fijas = bootstrap.split("\n").filter((l) => /\$NodeMinimo\s*=\s*[1-9]/.test(l))
  assert.deepEqual(fijas.map((l) => l.trim()), [], "el mínimo de Node está escrito a mano en el bootstrap")
})

// ── 2.11 · compilar-en-windows.ps1 festejaba un .exe que podía ser viejo ───────
//
// Corría ISCC sin mirar `$LASTEXITCODE` y decía "LISTO!" con sólo encontrar el
// `.exe` en dist\ — que podía ser el de la compilación anterior. Y si faltaba
// VERSION compilaba un "0.0.0" de relleno.

const compilar = sinComentariosPs(leer("installer", "compilar-en-windows.ps1"))

test("compilar-en-windows.ps1 borra el .exe anterior ANTES de correr ISCC", () => {
  const borra = compilar.search(/Remove-Item\s+\$Exe\b/)
  const corre = compilar.search(/&\s+\$iscc\b/)
  assert.ok(borra >= 0, "no borra el instalador anterior: un .exe viejo pasa por recién compilado")
  assert.ok(corre >= 0, "no encuentro la línea que corre ISCC")
  assert.ok(borra < corre, "borra el .exe DESPUÉS de compilar: destruye el que acaba de salir")
  // Y `$Exe` es de verdad el archivo de salida del .iss, no otra ruta.
  const iss = leer("installer", "tecnia-bot.iss")
  const base = iss.match(/^OutputBaseFilename=(\S+)\s*$/m)?.[1]
  const dir = iss.match(/^OutputDir=(\S+)\s*$/m)?.[1]
  assert.ok(base && dir, "no pude leer OutputDir/OutputBaseFilename del .iss")
  assert.ok(compilar.includes(`$Exe = Join-Path $RepoDir "installer\\${dir}\\${base}.exe"`),
    `$Exe no apunta a installer\\${dir}\\${base}.exe, que es lo que produce el .iss`)
})

test("compilar-en-windows.ps1 corta si ISCC devuelve un código distinto de 0", () => {
  const lineas = compilar.split("\n")
  const i = lineas.findIndex((l) => /&\s+\$iscc\b/.test(l))
  assert.ok(i >= 0, "no encuentro la línea que corre ISCC")
  // La línea SIGUIENTE (no "alguna después"): cualquier comando en el medio pisa $LASTEXITCODE.
  const siguiente = lineas.slice(i + 1).find((l) => l.trim() !== "")
  assert.match(siguiente, /^\s*\$CodigoIscc\s*=\s*\$LASTEXITCODE\s*$/, "el código de ISCC no se guarda en la línea siguiente a correrlo")
  const resto = lineas.slice(i + 1).join("\n")
  const corte = resto.match(/if\s*\(\s*\$CodigoIscc\s+-ne\s+0\s*\)\s*\{\s*\n?\s*throw\b/)
  assert.ok(corte, "se guarda el código de ISCC pero no se corta con él")
  assert.ok(resto.indexOf(corte[0]) < resto.indexOf("LISTO!"), "dice LISTO! antes de mirar el código de ISCC")
})

test("compilar-en-windows.ps1 no inventa una versión cuando falta VERSION", () => {
  assert.doesNotMatch(compilar, /["']0\.0\.0["']/, "volvió la versión de relleno 0.0.0")
  assert.match(compilar, /if\s*\(\s*-not\s*\(Test-Path\s+\$VerFile\)\s*\)\s*\{\s*\n?\s*throw\b/, "si falta VERSION no corta")
  assert.match(compilar, /if\s*\(\s*-not\s+\$Version\s*\)\s*\{\s*\n?\s*throw\b/, "si VERSION está vacío no corta")
})

// ── 2.2 · Tres llamadas sin red de seguridad mataban el bootstrap ──────────────
//
// `$ErrorActionPreference = "Stop"` es global y la función `Bajar` relanza al
// tercer intento. Tres llamadas no tenían nada que las atajara, y cualquiera de
// ellas cortaba el script con una excepción cruda ANTES de instalar la capa —
// contra la regla que el propio archivo escribe ("sin PlatformIO el bot igual
// sirve", "NO SE CORTA ACA").

/** El bloque `{ ... }` que abre en la primera llave a partir de `marcador`. */
function bloqueDesde(codigo, marcador) {
  const i = codigo.indexOf(marcador)
  assert.ok(i >= 0, `no encontré «${marcador}»`)
  let nivel = 0
  for (let j = codigo.indexOf("{", i); j < codigo.length; j++) {
    if (codigo[j] === "{") nivel++
    else if (codigo[j] === "}" && --nivel === 0) return codigo.slice(i, j + 1)
  }
  assert.fail(`el bloque de «${marcador}» no cierra`)
}

/** Las líneas de CÓDIGO (no las que le imprimen algo al docente). */
const comandos = bootstrap.split("\n").filter((l) => !/Write-Host/.test(l))

test("2.2a · la descarga de get-platformio.py está atajada y no corta antes de la capa", () => {
  const bajadas = comandos.filter((l) => /Bajar\s[^\n]*get-platformio\.py/.test(l))
  assert.equal(bajadas.length, 1, "esperaba exactamente una descarga de get-platformio.py")
  assert.match(bajadas[0], /^\s*try\s*\{\s*Bajar\s[^\n]*\}\s*catch\s*\{/, `la descarga no está dentro de un try/catch: ${bajadas[0].trim()}`)
  // Entre la descarga y la instalación de la capa no puede haber un `exit`.
  const desde = bootstrap.indexOf("get-platformio.py")
  const hasta = bootstrap.indexOf("install\\install.ps1", desde)
  assert.ok(desde > 0 && hasta > desde, "no encontré la descarga y la capa en orden")
  assert.doesNotMatch(bootstrap.slice(desde, hasta), /\bexit\b/, "se corta entre la descarga de PlatformIO y la capa")
  // Y el instalador de PlatformIO sólo se corre si la descarga dejó el archivo.
  const corre = bootstrap.indexOf("& $PyExe $Tmp")
  const guarda = bootstrap.lastIndexOf("if ($errorBajadaPio -or -not (Test-Path $Tmp)) {", corre)
  assert.ok(corre > 0 && guarda > 0, "se corre get-platformio.py sin comprobar que se haya bajado")
  const rama = bloqueDesde(bootstrap, "if ($errorBajadaPio -or -not (Test-Path $Tmp)) {")
  assert.doesNotMatch(rama, /& \$PyExe/, "se corre get-platformio.py en la rama donde la descarga falló")
})

test("2.2b · bajar el instalador de Scoop está atajado, y si falla corta con un mensaje propio", () => {
  const bajadas = comandos.filter((l) => /Bajar\s[^\n]*get\.scoop\.sh/.test(l))
  assert.equal(bajadas.length, 1, "esperaba exactamente una descarga de get.scoop.sh")
  assert.match(bajadas[0], /^\s*try\s*\{\s*\$scoopInstaller\s*=\s*Bajar\s[^\n]*\}\s*catch\s*\{/, `la descarga no está dentro de un try/catch: ${bajadas[0].trim()}`)
  const corte = bloqueDesde(bootstrap, "if (-not $scoopInstaller) {")
  assert.match(corte, /exit 1/, "sin el instalador de Scoop no se puede seguir: tiene que cortar")
  assert.match(corte, /Stop-Transcript/, "corta sin cerrar instalacion.log")
  const enPantalla = [...corte.matchAll(/Write-Host\s+"([^"]*)"/g)].map((m) => m[1]).join(" ").replace(/\s+/g, " ")
  assert.match(enPantalla, /no tiene internet/i, "el mensaje no nombra la falta de internet")
  assert.match(enPantalla, /red de la escuela bloquea/i, "el mensaje no nombra el filtro de la escuela")
  // El corte está ANTES de intentar ejecutar lo que no se bajó.
  assert.ok(bootstrap.indexOf("if (-not $scoopInstaller) {") < bootstrap.indexOf("[scriptblock]::Create($scoopInstaller)"),
    "se intenta ejecutar el instalador de Scoop antes de comprobar que se bajó")
})

test("2.2b · el instalador de Scoop se ejecuta atajado y dentro de un bucle que contiene su `break`", () => {
  const ejecuciones = comandos.filter((l) => l.includes("[scriptblock]::Create($scoopInstaller)"))
  assert.ok(ejecuciones.length >= 1, "no encuentro dónde se ejecuta el instalador de Scoop")
  for (const l of ejecuciones) {
    assert.match(l, /^\s*try\s*\{\s*&\s*\(\[scriptblock\]::Create\(\$scoopInstaller\)\)[^\n]*\}\s*catch\s*\{/, `se ejecuta sin try/catch: ${l.trim()}`)
  }
  // Todas adentro del bucle de una vuelta (el instalador de Scoop sale con `break`).
  const bucle = bloqueDesde(bootstrap, "foreach ($unaVez in 1) {")
  const adentro = bucle.split("\n").filter((l) => l.includes("[scriptblock]::Create($scoopInstaller)")).length
  assert.equal(adentro, ejecuciones.length, "hay una ejecución del instalador de Scoop fuera del bucle que contiene su `break`")
})

test("2.2c · TODA instalación de OpenCode con Scoop captura la salida y baja el ErrorActionPreference", () => {
  const lineas = bootstrap.split("\n")
  const idx = lineas.map((l, i) => [l, i]).filter(([l]) => /scoop install opencode/.test(l) && !/Write-Host/.test(l))
  assert.ok(idx.length >= 2, `sólo encontré ${idx.length} instalación(es) de OpenCode`)
  for (const [l, i] of idx) {
    assert.match(l, /=\s*scoop install opencode@\$OpenCodeVersion \*>&1 \| Out-String/, `instala sin capturar todos los streams: ${l.trim()}`)
    // En las 6 líneas de código anteriores se baja a Continue (mismo patrón en las tres ramas).
    const antes = lineas.slice(Math.max(0, i - 6), i).join("\n")
    assert.match(antes, /\$ErrorActionPreference\s*=\s*"Continue"/, `se llama a Scoop con ErrorActionPreference en Stop: ${l.trim()}`)
    // Y la excepción se ataja: en la misma línea, o en el `catch` que le sigue.
    const alrededor = lineas.slice(Math.max(0, i - 1), i + 3).join("\n")
    assert.match(alrededor, /try\s*\{[\s\S]*scoop install opencode[\s\S]*\}\s*catch\s*\{/, `una excepción de Scoop corta el script: ${l.trim()}`)
  }
})

// ── 2.3 · "OpenCode ya instalado, en otra versión": dos ramas que decían OK sin ejecutar ──
//
// Cuando hay un OpenCode que anda pero no es el de `install/OPENCODE_VERSION`, el
// bootstrap cambia a la fijada por dos caminos: `scoop reset` si la carpeta ya
// está en el disco, `scoop install` "al lado" si no. Los dos tenían un OK falso:
//
//   reset   → "[OK] OpenCode vuelve a la version X" releyendo el manifiesto de
//             Scoop, sin ejecutar el binario.
//   al lado → si no arrancaba imprimía "[X] No pude dejar la version..." y nada
//             más: ni probaba el build baseline (CPU sin AVX2), ni marcaba la
//             falla. El script seguía hasta "LISTO!" con exit 0.

const iReset = bootstrap.indexOf("la vuelvo a activar (scoop reset)")
const iAlLado = bootstrap.indexOf("la instalo al lado")
// El cierre de la rama "ya instalado": el primer Fijar-OpenCode que sigue.
const iFinRamas = bootstrap.indexOf("Fijar-OpenCode | Out-Null", iAlLado)

for (const [nombre, desde, hasta] of [
  ["scoop reset (la fijada ya está en disco)", iReset, iAlLado],
  ["scoop install al lado (la fijada no está en disco)", iAlLado, iFinRamas],
]) {
  test(`2.3 · rama ${nombre}: el OK exige ejecutar OpenCode, prueba el baseline y marca la falla`, () => {
    assert.ok(desde > 0 && hasta > desde, "no pude recortar la rama: cambiaron sus mensajes")
    const rama = bootstrap.slice(desde, hasta)
    assert.match(rama, /\$arranca = \[bool\]\(Test-OpenCode\)/, "no ejecuta OpenCode después de cambiar de versión")
    // El baseline se intenta sólo si no arranca Y el binario está, y su resultado decide.
    assert.match(rama, /if \(-not \$arranca -and \(Test-Path \$BinOpenCode\)\) \{[^}]*\$arranca = \[bool\]\(Install-OpenCodeBaseline\)/,
      "no intenta el build baseline (CPU sin AVX2) cuando el binario está y no arranca")
    // Hay UN solo [OK] en la rama, y está condicionado por versión Y ejecución.
    const oks = rama.split("\n").filter((l) => /Write-Host\s+"\s*\[OK\]/.test(l))
    assert.equal(oks.length, 1, `esperaba un solo [OK] en la rama y hay ${oks.length}`)
    assert.match(rama, /if \(\(\$quedo -eq \$OpenCodeVersion\) -and \$arranca\) \{\s*\n\s*Write-Host\s+"\s*\[OK\]/,
      "el [OK] no depende de que OpenCode haya arrancado")
    // Y si no arranca, queda marcado para el resumen final y el código de salida.
    assert.match(rama, /\} elseif \(-not \$arranca\) \{\s*\n\s*\$script:FalloOpenCode = \$true/,
      "si OpenCode no arranca no se marca la falla: el script termina en LISTO! con exit 0")
  })
}

test("2.3 · la falla de OpenCode, una vez marcada, no se desmarca", () => {
  // Salió de una mutación que la guarda de arriba no veía: marcar la falla y, en la
  // línea siguiente, volver a ponerla en $false. El resumen final decide con esa
  // variable; nada en el script tiene motivo para bajarla.
  assert.doesNotMatch(bootstrap, /\$script:FalloOpenCode\s*=\s*\$false/, "algo desmarca la falla de OpenCode")
  assert.ok((bootstrap.match(/\$script:FalloOpenCode\s*=\s*\$true/g) ?? []).length >= 3,
    "la falla de OpenCode se marca en menos de tres ramas (instalación, reset, instalar al lado)")
})

test("2.3 · Fijar-OpenCode nombra la versión que quedó activa, no la que se quería", () => {
  const fn = funcionPs(bootstrap, "Fijar-OpenCode")
  const ok = fn.split("\n").filter((l) => /\[OK\] OpenCode fijado/.test(l))
  assert.equal(ok.length, 1, "no encuentro el [OK] de Fijar-OpenCode")
  assert.doesNotMatch(ok[0], /\$OpenCodeVersion/, "el [OK] nombra la versión deseada: miente cuando el cambio de versión no se pudo hacer")
  assert.match(fn, /\$activa = Get-OpenCodeVersionInstalada\s*\n\s*Write-Host "  \[OK\] OpenCode fijado en la version \$activa/, "la versión del [OK] no sale del manifiesto de Scoop")
})

// ── 2.2b · El final dice cómo quedó CADA componente, y sale con un código propio ──
//
// Sólo la falla de OpenCode se repetía al final. Las de PlatformIO y Node quedaban
// cien líneas más arriba y el cierre era "LISTO!" con exit 0. El contrato nuevo:
//   0 = todo comprobado · 2 = instalado pero degradado · 1 = falla.

const bootstrapCrudo = leer("install", "bootstrap.ps1")
/** Lo que corre DESPUÉS de lanzar install.ps1: la verificación de la capa y el resumen. */
const final = bootstrap.slice(bootstrap.indexOf("install\\install.ps1"))

test("2.2b · el código de «degradado» existe, es propio, y el encabezado lo documenta con el mismo número", () => {
  const defs = [...bootstrap.matchAll(/^\$CodigoDegradado\s*=\s*(\d+)\s*$/gm)].map((m) => Number(m[1]))
  assert.equal(defs.length, 1, "$CodigoDegradado tiene que definirse una sola vez")
  const n = defs[0]
  assert.ok(n !== 0 && n !== 1, `degradado no puede ser ${n}: 0 es OK y 1 es falla (y lo que devuelve PowerShell si el script muere)`)
  // El encabezado (comentarios: acá sí se mira el archivo crudo, es documentación) dice lo mismo.
  const encabezado = bootstrapCrudo.slice(0, bootstrapCrudo.indexOf("param("))
  assert.match(encabezado, /CODIGOS DE SALIDA/, "el encabezado no documenta los códigos de salida")
  assert.match(encabezado, new RegExp(`^#\\s+${n} = INSTALADO PERO DEGRADADO`, "m"), `el encabezado no documenta el ${n} como «degradado»`)
  assert.match(encabezado, /^#\s+0 = TODO quedo/m, "el encabezado no documenta el 0")
  assert.match(encabezado, /^#\s+1 = FALLA/m, "el encabezado no documenta el 1")
})

test("2.2b · cada componente que falta entra al resumen: PlatformIO, Node y la versión de OpenCode", () => {
  assert.match(final, /if \(\$PioExe\) \{[^}]*\} else \{\s*\n\s*\$Degradado \+= "falta PlatformIO/, "que falte PlatformIO no degrada el resultado")
  assert.match(final, /if \(\$NodeExe\) \{[^}]*\} else \{\s*\n\s*\$Degradado \+= "falta Node/, "que falte Node no degrada el resultado")
  assert.match(final, /\} elseif \(-not \$OpenCodeEsLaFijada\) \{\s*\n\s*\$Degradado \+= "OpenCode quedo en la version/, "una versión de OpenCode distinta de la fijada no degrada el resultado")
  assert.match(final, /\$OpenCodeEsLaFijada = \(\$OpenCodeActiva -eq \$OpenCodeVersion\)/, "la versión no se compara contra la fijada")
  assert.match(final, /\$OpenCodeActiva = Get-OpenCodeVersionInstalada/, "la versión activa no sale del manifiesto de Scoop")
  // $PioExe y $NodeExe sólo se asignan desde las funciones que EJECUTAN el binario.
  for (const [v, fn] of [["PioExe", "Buscar-Pio"], ["NodeExe", "Buscar-Node"]]) {
    const asignaciones = bootstrap.split("\n").filter((l) => new RegExp(`^\\s*\\$${v}\\s*=`).test(l))
    assert.ok(asignaciones.length >= 1, `no encuentro dónde se asigna $${v}`)
    for (const l of asignaciones) assert.match(l, new RegExp(`\\$${v}\\s*=\\s*${fn}\\s*$`), `$${v} se asigna sin verificar: ${l.trim()}`)
  }
})

test("2.2b · OpenCode se EJECUTA al final, salvo que ya esté marcado como caído", () => {
  assert.match(final, /\$OpenCodeArranca = \$false\s*\n\s*if \(-not \$script:FalloOpenCode\) \{ \$OpenCodeArranca = \[bool\]\(Test-OpenCode\) \}/,
    "el resumen afirma que OpenCode arranca sin ejecutarlo")
  // Ninguna otra asignación puede ponerlo en verdadero.
  const otras = final.split("\n").filter((l) => /\$OpenCodeArranca\s*=/.test(l) && !/\$OpenCodeArranca = \$false\s*$/.test(l) && !/Test-OpenCode/.test(l))
  assert.deepEqual(otras.map((l) => l.trim()), [], "$OpenCodeArranca se asigna por otro lado")
})

test("2.2b · la capa que no quedó ya no corta antes del resumen, pero sigue siendo falla", () => {
  const antesDelResumen = final.slice(0, final.indexOf("$OpenCodeArranca = $false"))
  assert.doesNotMatch(antesDelResumen, /\bexit\b/, "se corta antes del resumen: el docente no ve cómo quedó el resto")
  assert.match(antesDelResumen, /if \(\$CodigoInstall -ne 0\) \{\s*\n\s*\$CapaOk = \$false/, "un código distinto de 0 de install.ps1 no marca la capa como caída")
  assert.match(antesDelResumen, /\} elseif \(-not \(Test-Path \(Join-Path \$cfgDir "agent\\tecnia-bot\.md"\)\)\) \{\s*\n\s*\$CapaOk = \$false/, "no se mira en el disco que el agente haya quedado")
  // Sólo se pone en verdadero UNA vez, antes de las dos comprobaciones.
  assert.equal((final.match(/\$CapaOk = \$true/g) ?? []).length, 1, "$CapaOk se pone en verdadero en más de un lugar")
  assert.ok(final.indexOf("$CapaOk = $true") < final.indexOf("if ($CodigoInstall -ne 0)"), "$CapaOk se pone en verdadero después de comprobar")
  assert.match(bloqueDesde(final, "\nif (-not $CapaOk) {"), /exit 1/, "sin la capa el bot no es Tecnia Bot: tiene que salir con 1")
})

test("2.2b · «LISTO!» sólo se alcanza si no hubo falla NI degradación, y cada salida lleva su código", () => {
  // lastIndexOf: la MISMA condición abre antes la línea del resumen ("[X] OpenCode NO
  // ARRANCA"); la que corta es la segunda. Con indexOf este test medía la del resumen.
  const iFalla = final.lastIndexOf("\nif (-not $OpenCodeArranca) {")
  const iCapa = final.indexOf("\nif (-not $CapaOk) {")
  const iDegradado = final.indexOf("\nif ($Degradado.Count -gt 0) {")
  const iListo = final.indexOf("LISTO!")
  assert.ok(iFalla > 0 && iCapa > iFalla && iDegradado > iCapa && iListo > iDegradado,
    "el orden tiene que ser: falla de OpenCode, falla de la capa, degradado, y recién ahí LISTO!")
  assert.equal((bootstrap.match(/LISTO!/g) ?? []).length, 1, "hay más de un LISTO! en el bootstrap")

  const falla = bloqueDesde(final.slice(iFalla), "\nif (-not $OpenCodeArranca) {")
  assert.match(falla, /Stop-Transcript[^\n]*\n\s*exit 1\s*\n\}$/, "la falla de OpenCode no termina en `exit 1`")
  const degradado = bloqueDesde(final, "\nif ($Degradado.Count -gt 0) {")
  assert.match(degradado, /Stop-Transcript[^\n]*\n\s*exit \$CodigoDegradado\s*\n\}$/, "el caso degradado no termina en `exit $CodigoDegradado`")
  assert.match(degradado, /foreach \(\$d in \$Degradado\)/, "no se le dice al docente QUÉ falta")
  assert.match(degradado, /Reparar Tecnia Bot/, "no dice cómo completar lo que falta")
  // Y el camino feliz sale con 0 explícito, después de LISTO!.
  assert.match(final.slice(iListo), /Stop-Transcript[^\n]*\n\s*exit 0\s*$/, "el camino feliz no termina en `exit 0`")
  // «la capa quedó instalada» sólo se afirma si se comprobó.
  assert.match(falla, /if \(\$CapaOk\) \{\s*\n\s*Write-Host "  La capa de Tecnia Bot quedo instalada/, "se afirma que la capa quedó sin haberlo comprobado")
})

test("2.2b · los que corren el bootstrap no dependen de que salga con 0", () => {
  // El lanzador lo corre para reparar y vuelve a verificar por su cuenta: las
  // líneas siguientes no pueden ser un `if errorlevel`.
  const lanzador = leer("installer", "abrir-tecnia-bot.cmd").replace(/^\s*rem\b.*$/gim, "").split("\n")
  const i = lanzador.findIndex((l) => /bootstrap\.ps1/.test(l))
  assert.ok(i >= 0, "el lanzador ya no corre el bootstrap")
  const siguientes = lanzador.slice(i + 1).filter((l) => l.trim() !== "").slice(0, 4).join("\n")
  assert.doesNotMatch(siguientes, /errorlevel/i, "el lanzador pasó a decidir por el código del bootstrap: revisá el contrato (0/2/1)")
  assert.match(siguientes, /goto verificar/, "después de reparar, el lanzador ya no vuelve a verificar por su cuenta")
})
