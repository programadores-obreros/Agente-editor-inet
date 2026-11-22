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
//
// ESTE ARCHIVO TUVO GUARDAS HUECAS, Y QUEDA ESCRITO CUÁLES. Una revisión de QA
// razonó seis mutaciones del producto que lo dejaban en verde. Se ejecutaron una
// por una contra las guardas de ese momento (código de salida de
// `node --test tests/instalador-honesto.test.mjs`, medido sin pipe):
//
//   I.1  [UninstallDelete]: agregar `Type: filesandordirs; Name: "{app}\*"`
//        → exit 1, pero de rebote (lo cazaba el guard cruzado de EsNuestro, no
//          el filtro del barrido, que sólo rechazaba `{app}` exacto).
//   I.2  lanzador: quitar el `$vivo=$true; ` del `if(...TryOpenExisting...)`
//        → exit 0. HUECA.
//   I.3  bootstrap: `$Degradado = @()` antes de `if ($Degradado.Count -gt 0) {`
//        → exit 0. HUECA.
//   I.4  .iss: `Result := 0;` como última sentencia de GetCustomSetupExitCode
//        → exit 0. HUECA.
//   I.5  bootstrap: `catch { throw }` en los catch de 2.2a, 2.2b (los dos) y 2.2c
//        → exit 0 las cuatro. HUECAS.
//   I.6  .iss: un renglón que sea sólo `[Run]` dentro de un comentario Pascal
//        → exit 1, pero porque el archivo reventaba al cargar, no por una guarda.
//
// Por qué eran huecas, que es lo que hay que recordar: todas miraban que la línea
// buena ESTUVIERA, y ninguna que no hubiera OTRA línea que la deshiciera después
// (una reasignación, un `Result := 0` al final, un `throw` adentro del catch).
// Las guardas nuevas están al final del archivo, una por mutación, y después de
// agregarlas las seis dan exit 1 por la guarda que las nombra.

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
  // Desde la 0.4.10 OpenCode se instala desde el manifest propio ($ManifiestoOpenCode) y no
  // con `opencode@<ver>` (el bucket de Scoop dejó de poder bajar la 1.x: ver
  // tests/opencode-manifest.test.mjs). Se buscan las DOS formas: si alguien vuelve a meter
  // una instalación por el bucket, también tiene que cumplir esto —y además la corta el
  // otro test—.
  const idx = lineas.map((l, i) => [l, i]).filter(([l]) => /scoop install (opencode|\$ManifiestoOpenCode)/.test(l) && !/Write-Host/.test(l))
  assert.ok(idx.length >= 2, `sólo encontré ${idx.length} instalación(es) de OpenCode`)
  for (const [l, i] of idx) {
    assert.match(l, /=\s*scoop install \$ManifiestoOpenCode \*>&1 \| Out-String/, `instala sin capturar todos los streams: ${l.trim()}`)
    // En las 6 líneas de código anteriores se baja a Continue (mismo patrón en las tres ramas).
    const antes = lineas.slice(Math.max(0, i - 6), i).join("\n")
    assert.match(antes, /\$ErrorActionPreference\s*=\s*"Continue"/, `se llama a Scoop con ErrorActionPreference en Stop: ${l.trim()}`)
    // Y la excepción se ataja: en la misma línea, o en el `catch` que le sigue.
    const alrededor = lineas.slice(Math.max(0, i - 1), i + 3).join("\n")
    assert.match(alrededor, /try\s*\{[\s\S]*scoop install \$ManifiestoOpenCode[\s\S]*\}\s*catch\s*\{/, `una excepción de Scoop corta el script: ${l.trim()}`)
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
// Hasta la 0.4.10 esta rama decía "la instalo al lado". Desde la 0.4.11 baja la fijada, saca la que
// había y recién ahí instala (ver Quitar-OpenCodeAjeno en bootstrap.ps1); lo que este test cuida no cambió.
const iAlLado = bootstrap.indexOf("la bajo antes de tocar nada")
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

test("2.2b · OpenCode se EJECUTA al final SIEMPRE: «NO ARRANCA» sale de esa comprobación, no de una marca vieja", () => {
  // ESTE TEST CUSTODIABA EL DEFECTO. Exigía `if (-not $script:FalloOpenCode) { ...
  // Test-OpenCode }`: si la falla ya estaba marcada, el resumen imprimía "NO
  // ARRANCA" sin ejecutar nada. Lo señaló la revisión de QA: la frase sobre el
  // estado FINAL tiene que salir de la comprobación final.
  const asignaciones = final.split("\n").filter((l) => /\$OpenCodeArranca\s*=/.test(l)).map((l) => l.trim())
  assert.deepEqual(asignaciones, ["$OpenCodeArranca = [bool](Test-OpenCode)"], "$OpenCodeArranca no sale (sólo) de ejecutar OpenCode")
  // Sin condición: la línea está en el nivel superior del script, no adentro de un if.
  assert.match(final, /^\$OpenCodeArranca = \[bool\]\(Test-OpenCode\)$/m, "la comprobación final de OpenCode quedó condicionada")
  // Y la marca vieja no decide ni el resumen ni el código de salida.
  const desde = final.indexOf("$OpenCodeArranca = [bool](Test-OpenCode)")
  const usos = final.slice(desde).split("\n").filter((l) => /FalloOpenCode/.test(l)).map((l) => l.trim())
  assert.deepEqual(usos, ["if ($script:FalloOpenCode -and $OpenCodeArranca) {"], "la marca de más arriba vuelve a decidir algo del resumen final")
})

test("2.2b · la capa que no quedó ya no corta antes del resumen, pero sigue siendo falla", () => {
  const antesDelResumen = final.slice(0, final.indexOf("$OpenCodeArranca = [bool](Test-OpenCode)"))
  assert.doesNotMatch(antesDelResumen, /\bexit\b/, "se corta antes del resumen: el docente no ve cómo quedó el resto")
  assert.match(antesDelResumen, /if \(\$CodigoInstall -ne 0\) \{\s*\n\s*if \(\$CodigoInstall -eq \$CodigoCapaConAvisos\) \{\s*\n\s*\$CapaConAvisos = \$true\s*\n\s*\} else \{\s*\n\s*\$CapaOk = \$false/,
    "un código de install.ps1 que no es 0 ni «con avisos» no marca la capa como caída")
  assert.match(antesDelResumen, /\nif \(\$CapaOk -and -not \(Test-Path \(Join-Path \$cfgDir "agent\\tecnia-bot\.md"\)\)\) \{\s*\n\s*\$CapaOk = \$false/, "no se mira en el disco que el agente haya quedado")
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

// ── 2.1 · El .exe no se enteraba de cómo había terminado el bootstrap ──────────
//
// El bootstrap se lanzaba desde [Run] con `Flags: waituntilterminated`: Inno
// espera, pero no mira el código de salida. La última pantalla decía "¡Tecnia Bot
// quedó instalado!" fija, y con /VERYSILENT el .exe devolvía 0 aunque no se
// hubiera instalado nada. Ahora lo lanza [Code] con Exec y el resultado decide la
// última pantalla y el código de salida del .exe.

const issCrudo = leer("installer", "tecnia-bot.iss")

/**
 * [Code] sin comentarios Pascal, PERO CON las cadenas intactas.
 *
 * El `replace(/\{[^}]*\}/g, "")` que usan los otros tests se lleva puestas las
 * constantes de Inno que viven adentro de una cadena (`'{app}\install\...'`) y el
 * `{#MyAppName}` del preprocesador. Para lo que se mide acá hace falta
 * distinguir: una llave adentro de comillas simples es texto, afuera abre un
 * comentario. Se recorre carácter por carácter.
 */
function pascalSinComentarios(texto) {
  let out = ""
  for (let i = 0; i < texto.length; ) {
    const c = texto[i]
    if (c === "'") {
      let j = i + 1
      for (;;) {
        j = texto.indexOf("'", j)
        assert.ok(j > 0, "cadena Pascal sin cerrar")
        if (texto[j + 1] === "'") { j += 2; continue }
        break
      }
      out += texto.slice(i, j + 1)
      i = j + 1
    } else if (c === "{") {
      const j = texto.indexOf("}", i)
      assert.ok(j > 0, "comentario Pascal sin cerrar")
      i = j + 1
    } else {
      out += c
      i++
    }
  }
  return out
}

/** Una sección del .iss (de `[Nombre]` a la próxima), sin sus líneas `;`. */
function seccionIss(nombre) {
  const m = issCrudo.match(new RegExp(`^\\[${nombre}\\]\\s*$`, "m"))
  assert.ok(m, `el .iss no tiene sección [${nombre}]`)
  const resto = issCrudo.slice(m.index + m[0].length)
  const fin = resto.search(/^\[[A-Za-z]+\]\s*$/m)
  return (fin === -1 ? resto : resto.slice(0, fin)).replace(/^\s*;.*$/gm, "")
}

// Adentro de un try: si el .iss está roto de una forma que impide recortar [Code]
// (un renglón `[Run]` metido en un comentario Pascal, la mutación I.6), este
// archivo reventaba AL CARGAR y no corría ningún test: salía rojo sin que ninguna
// guarda dijera por qué. Ahora carga igual, y la guarda I.6 nombra el problema.
let pascal = ""
let errorAlLeerCode = null
try {
  pascal = pascalSinComentarios(seccionIss("Code"))
} catch (e) {
  errorAlLeerCode = e
}

test("la sección [Code] del .iss se puede recortar y leer", () => {
  assert.equal(errorAlLeerCode, null, `no pude leer [Code]: ${errorAlLeerCode?.message}. Mirá la guarda I.6: suele ser un renglón que empieza con «[» adentro del código.`)
  assert.ok(pascal.length > 2000, "[Code] quedó casi vacío: el extractor no está mirando el código")
})

/**
 * El cuerpo de un procedure/function de Pascal: hasta su `end;` en la columna 0.
 *
 * La primera versión cortaba en el próximo `procedure|function|var|const` a
 * principio de línea, y devolvía UNA línea: las rutinas con variables locales
 * tienen su propio `var` en la columna 0, pegado a la firma. Los cuatro tests que
 * la usaban se pusieron rojos midiendo una firma suelta.
 */
function rutina(nombre) {
  const m = pascal.match(new RegExp(`^(?:procedure|function) ${nombre}\\b`, "m"))
  assert.ok(m, `no está ${nombre} en [Code]`)
  const resto = pascal.slice(m.index)
  const fin = resto.search(/^end;[ \t]*$/m)
  assert.ok(fin > 0, `${nombre} no cierra con un end; en la columna 0`)
  return resto.slice(0, fin + 4)
}

const constantePascal = (nombre) => {
  const m = pascal.match(new RegExp(`^\\s*${nombre}\\s*=\\s*(\\d+);`, "m"))
  assert.ok(m, `no está la constante ${nombre} en [Code]`)
  return Number(m[1])
}

test("2.1 · [Run] ya no lanza el bootstrap ni toca la marca: lo hace [Code], una sola vez", () => {
  const run = seccionIss("Run")
  assert.doesNotMatch(run, /bootstrap\.ps1/, "[Run] volvió a lanzar el bootstrap: no se puede leer su código de salida, y correría dos veces")
  assert.doesNotMatch(run, /\.instalando/, "[Run] volvió a tocar la marca: su borrado vive en [Code], después del bootstrap")
  // Se cuenta la RUTA del script (lo que se ejecuta), no su nombre: los Log() lo nombran.
  assert.equal((pascal.match(/\\install\\bootstrap\.ps1'/g) ?? []).length, 1, "el bootstrap tiene que lanzarse desde un solo lugar de [Code]")
  // Y se llama desde ssPostInstall (los archivos ya están copiados).
  const hook = rutina("CurStepChanged")
  assert.match(hook.slice(hook.indexOf("CurStep = ssPostInstall")), /CorrerElBootstrap;/, "CurStepChanged no corre el bootstrap en ssPostInstall")
  assert.equal((pascal.match(/\bCorrerElBootstrap;/g) ?? []).length, 2, "CorrerElBootstrap tiene que aparecer dos veces: su definición y UNA llamada")
})

test("2.1 · el bootstrap se lanza con Exec y conserva lo que hacía la entrada de [Run]", () => {
  const fn = rutina("CorrerElBootstrap")
  // Consola visible, espera a que termine, carpeta de trabajo {app}, y el código en CodigoBootstrap.
  assert.match(fn, /Exec\('powershell\.exe', Parametros, ExpandConstant\('\{app\}'\),\s*SW_SHOWNORMAL, ewWaitUntilTerminated, CodigoBootstrap\)/,
    "el Exec del bootstrap no es visible, no espera, no usa {app} como carpeta o no guarda el código")
  assert.match(fn, /Parametros := '-ExecutionPolicy Bypass -NoProfile -File "'\s*\+ ExpandConstant\('\{app\}\\install\\bootstrap\.ps1'\) \+ '"' \+ BanderaSilencio\(''\);/,
    "los parámetros del bootstrap cambiaron (política, perfil, ruta o la bandera de silencio)")
  // /skipdeps=1 lo saltea ANTES de lanzar nada, y no cuenta como "bien".
  const iSalteo = fn.indexOf("if not CorrerBootstrap then")
  assert.ok(iSalteo > 0 && iSalteo < fn.indexOf("Exec("), "/skipdeps=1 ya no saltea el bootstrap antes de lanzarlo")
  assert.match(fn.slice(iSalteo, fn.indexOf("Exec(")), /EstadoBootstrap := EstadoSalteado;[\s\S]*?Exit;/, "el salteo no queda anotado como salteado")
})

test("2.1 · «bien» sólo sale del código 0 del bootstrap; todo lo demás es degradado, falla o no-lanzó", () => {
  const fn = rutina("CorrerElBootstrap")
  assert.match(fn, /if CodigoBootstrap = CodigoBootstrapOk then\s+EstadoBootstrap := EstadoBien\s+else if CodigoBootstrap = CodigoBootstrapDegradado then\s+EstadoBootstrap := EstadoDegradado\s+else\s+EstadoBootstrap := EstadoFallo;/,
    "el código del bootstrap no se traduce a bien / degradado / falla")
  assert.match(fn, /end\s+else\s+EstadoBootstrap := EstadoNoLanzo;/, "si Exec no pudo lanzar PowerShell no queda anotado")
  // En TODO [Code], «bien» se asigna una sola vez: no hay otro camino al festejo.
  assert.equal((pascal.match(/EstadoBootstrap := EstadoBien\b/g) ?? []).length, 1, "EstadoBien se asigna en más de un lugar")
  // "Sin correr" es el valor con que nace la variable global, y no es ninguno de los buenos.
  assert.equal(constantePascal("EstadoSinCorrer"), 0, "EstadoSinCorrer tiene que ser 0: es el valor inicial de una variable global")
  const estados = ["EstadoSinCorrer", "EstadoSalteado", "EstadoBien", "EstadoDegradado", "EstadoFallo", "EstadoNoLanzo"].map(constantePascal)
  assert.equal(new Set(estados).size, estados.length, "hay dos estados con el mismo número")
})

test("2.1 · el .iss y bootstrap.ps1 hablan el mismo contrato de códigos (guard cruzado)", () => {
  const degradadoPs = Number(bootstrap.match(/^\$CodigoDegradado\s*=\s*(\d+)\s*$/m)?.[1])
  assert.equal(constantePascal("CodigoBootstrapDegradado"), degradadoPs,
    "el .iss y bootstrap.ps1 no coinciden en el código de «degradado»: el instalador leería una degradación como falla, o al revés")
  assert.equal(constantePascal("CodigoBootstrapOk"), 0, "el .iss espera un OK distinto de 0")
  assert.match(bootstrap, /exit 0\s*$/, "bootstrap.ps1 ya no termina su camino feliz en `exit 0`")
})

test("2.1 · «quedó instalado» se afirma únicamente cuando el bootstrap salió bien", () => {
  // Los dos textos de [Messages] son neutros: el que afirma lo pone el código.
  const mensajes = seccionIss("Messages")
  const fijo = mensajes.match(/^FinishedHeadingLabel=(.*)$/m)?.[1] ?? ""
  assert.doesNotMatch(fijo, /instalado/i, `el título fijo de la última pantalla afirma algo sin comprobarlo: «${fijo}»`)
  assert.doesNotMatch(mensajes.match(/^FinishedLabel=(.*)$/m)?.[1] ?? "", /listo|quedó instalado/i, "el texto fijo de la última pantalla festeja sin comprobar")

  const fn = rutina("CurPageChanged")
  assert.match(fn, /if CurPageID <> wpFinished then\s+Exit;/, "CurPageChanged no se limita a la última pantalla")
  // El festejo aparece UNA vez en todo [Code], y adentro de la rama EstadoBien.
  assert.equal((pascal.match(/¡Tecnia Bot quedó instalado!/g) ?? []).length, 1, "el festejo aparece en más de un lugar")
  assert.match(fn, /if EstadoBootstrap = EstadoBien then\s+begin\s+Titulo := '¡Tecnia Bot quedó instalado!';/,
    "el festejo no está condicionado a que el bootstrap haya salido bien")
  // Y la rama por defecto (falla, no lanzó, sin correr) dice que NO quedó.
  const ultima = fn.slice(fn.lastIndexOf("else\n  begin"))
  assert.match(ultima, /Titulo := 'Tecnia Bot NO quedó instalado';/, "la rama por defecto no dice que la instalación falló")
  // El título y el texto se asignan a las etiquetas en UN solo lugar, desde esas variables.
  assert.equal((fn.match(/FinishedHeadingLabel\.Caption :=/g) ?? []).length, 1, "el título de la última pantalla se asigna por más de un camino")
  assert.match(fn, /WizardForm\.FinishedHeadingLabel\.Caption := Titulo \+ #13#10;/, "el título que se muestra no es el que eligió la rama")
  assert.match(fn, /WizardForm\.FinishedLabel\.Caption := Texto \+ #13#10;/, "el texto que se muestra no es el que eligió la rama")
  assert.match(ultima, /Reparar \{#MyAppName\}/, "la falla no manda a Reparar")
})

test("2.1 · en falla hay un cartel (si hay alguien mirando) que manda a Reparar y al log", () => {
  const fn = rutina("AvisarSiElBootstrapFallo")
  assert.match(fn, /if WizardSilent\(\) then\s+Exit;/, "en modo silencioso no puede aparecer un cartel: nadie lo cierra")
  assert.match(fn, /if \(EstadoBootstrap <> EstadoFallo\) and \(EstadoBootstrap <> EstadoNoLanzo\) then\s+Exit;/, "el cartel no se limita a la falla")
  assert.match(fn, /"Reparar \{#MyAppName\}"/, "el cartel no nombra Reparar")
  // El log se nombra sólo si está en el disco.
  assert.match(fn, /if FileExists\(RutaLogBootstrap\) then\s+Texto := Texto \+/, "el cartel manda a leer instalacion.log sin mirar si existe")
  assert.match(rutina("RutaLogBootstrap"), /ExpandConstant\('\{app\}\\instalacion\.log'\)/, "la ruta del log no es la de bootstrap.ps1")
  assert.match(bootstrap, /\$LogInstalacion\s*=\s*Join-Path\s+\$RepoDir\s+"instalacion\.log"/, "bootstrap.ps1 cambió dónde deja su log")
  assert.match(fn, /MsgBox\(Texto, mbError, MB_OK\);/, "no muestra el cartel")
  // Se llama después del bootstrap.
  const hook = rutina("CurStepChanged")
  assert.ok(hook.indexOf("AvisarSiElBootstrapFallo;") > hook.indexOf("CorrerElBootstrap;"), "el cartel se evalúa antes de correr el bootstrap")
})

test("2.1 · todo acceso directo que el .iss le nombra al docente existe en [Icons]", () => {
  const atajos = [...seccionIss("Icons").matchAll(/Name:\s*"\{autoprograms\}\\([^"]+)"/g)].map((m) => m[1])
  assert.ok(atajos.length >= 3, `sólo encontré ${atajos.length} accesos directos`)
  const mencionados = [...pascal.matchAll(/"((?:Reparar|Diagnostico|Diagnóstico|Desinstalar) \{#MyAppName\})"/g)].map((m) => m[1])
  assert.ok(mencionados.length >= 2, "esperaba que [Code] nombrara al menos Reparar y Diagnostico")
  for (const m of mencionados) {
    assert.ok(atajos.includes(m), `[Code] manda al docente a «${m}» y ese acceso directo no existe. Hay: ${atajos.join(", ")}`)
  }
})

test("2.1 · el .exe sale con un código propio cuando el bootstrap no salió bien", () => {
  const fn = rutina("GetCustomSetupExitCode")
  assert.match(fn, /^function GetCustomSetupExitCode: Integer;/, "la firma no es la que documenta Inno Setup")
  assert.match(fn, /if EstadoBootstrap = EstadoDegradado then\s+Result := SalidaSetupDegradado/, "un bootstrap degradado no cambia el código de salida del .exe")
  assert.match(fn, /else if \(EstadoBootstrap = EstadoFallo\) or \(EstadoBootstrap = EstadoNoLanzo\)\s+or \(EstadoBootstrap = EstadoSinCorrer\) then\s+Result := SalidaSetupFallo;/,
    "un bootstrap caído (o que no llegó a correr) no cambia el código de salida del .exe")
  const fallo = constantePascal("SalidaSetupFallo")
  const degradado = constantePascal("SalidaSetupDegradado")
  assert.ok(fallo > 8 && degradado > 8, "los códigos propios pisan los de Inno Setup (0 a 8)")
  assert.notEqual(fallo, degradado, "falla y degradado salen con el mismo código")
  // El encabezado del .iss (comentarios `;`, documentación) dice los mismos números.
  const encabezado = issCrudo.slice(0, issCrudo.indexOf("#ifndef"))
  assert.match(encabezado, new RegExp(`^;\\s+${fallo}\\s+se copiaron los archivos pero bootstrap\\.ps1 FALLÓ`, "m"), `el encabezado no documenta el ${fallo}`)
  assert.match(encabezado, new RegExp(`^;\\s+${degradado}\\s+quedó instalado pero DEGRADADO`, "m"), `el encabezado no documenta el ${degradado}`)
})

// ── 2.4 · La desinstalación guardaba un código que nadie leía ─────────────────
//
// `CurUninstallStepChanged` corría `uninstall.ps1` con Exec, guardaba el código de
// salida en `Codigo` y NUNCA lo miraba: sólo avisaba si Exec devolvía False. Si el
// script corría y no podía borrar (OpenCode abierto), el docente que eligió borrar
// los datos de sus alumnos se iba convencido de que ya no estaban. Contrato con
// uninstall.ps1: 0 = todo borrado · 3 = parcial · otro = falla.

test("2.4 · el código de uninstall.ps1 se lee, y cualquier cosa distinta de 0 avisa", () => {
  const fn = rutina("CurUninstallStepChanged")
  // El resultado de Exec y el código se guardan los dos.
  assert.match(fn, /Lanzo := Exec\('powershell\.exe',[\s\S]*?\\install\\uninstall\.ps1'\) \+ '" ' \+ Bandera,[\s\S]*?ewWaitUntilTerminated, Codigo\);/,
    "el Exec de uninstall.ps1 no guarda si se lanzó y con qué código terminó")
  assert.match(fn, /if \(not UninstallSilent\(\)\) and \(\(not Lanzo\) or \(Codigo <> 0\) or \(Siguen <> ''\)\) then\s+AvisarDesinstalacionIncompleta\(Lanzo, Codigo, Siguen\);/,
    "un código distinto de 0 de uninstall.ps1 no produce ningún aviso")
  // La comprobación en el disco se hace DESPUÉS del script, y sólo si se eligió borrar.
  const iExec = fn.indexOf("Lanzo := Exec(")
  const iSiguen = fn.indexOf("Siguen := DatosPersonalesQueSiguen;")
  assert.ok(iSiguen > iExec, "el disco se mira antes de correr el script: no mide lo que el script dejó")
  assert.match(fn.slice(iExec, iSiguen), /Siguen := '';\s+if PurgarDatosPersonales then\s+$/, "el disco se mira aunque se haya elegido conservar: ahí que los archivos estén es lo esperado")
  // La consola de -Borrar se sigue mostrando (uninstall.ps1 explica ahí), pero el resultado no depende de ella.
  assert.match(fn, /Bandera := '-Borrar';\s+Ventana := SW_SHOWNORMAL;/, "la rama que borra dejó de mostrar la consola")
})

test("2.4 · el cartel distingue parcial de falla, y lo que afirma sale del disco", () => {
  assert.equal(constantePascal("CodigoUninstallParcial"), 3, "el código de «desinstalación parcial» acordado con uninstall.ps1 es 3")
  const fn = rutina("AvisarDesinstalacionIncompleta")
  assert.match(fn, /else if Codigo = CodigoUninstallParcial then\s+Texto := 'La desinstalación quedó INCOMPLETA/, "el 3 no se dice como «incompleta»")
  assert.match(fn, /else if Codigo <> 0 then\s+Texto := 'El script que desinstala Tecnia Bot terminó con un error/, "los demás códigos no se dicen como error")
  // «Siguen en esta computadora» sólo con la lista que salió de FileExists.
  assert.match(fn, /if Siguen <> '' then\s+Texto := Texto \+ #13#10 \+ #13#10\s+\+ 'Elegiste borrar los datos personales y ESTOS SIGUEN EN ESTA COMPUTADORA/,
    "se afirma que los datos siguen sin haber mirado el disco")
  assert.match(fn, /MsgBox\(Texto, mbError, MB_OK\);/, "no muestra el cartel")
  // Dónde: la carpeta real, que honra XDG igual que uninstall.ps1.
  assert.match(fn, /CarpetaConfigOpenCode/, "el cartel no dice dónde quedó")
  assert.match(rutina("CarpetaConfigOpenCode"), /if GetEnv\('XDG_CONFIG_HOME'\) <> '' then\s+Result := AddBackslash\(GetEnv\('XDG_CONFIG_HOME'\)\) \+ 'opencode'/,
    "la carpeta de config no honra XDG_CONFIG_HOME: con la variable puesta manda a mirar otra carpeta")
})

test("2.4 · los datos personales que el .iss busca en el disco son los que uninstall.ps1 borra (guard cruzado)", () => {
  const fn = rutina("DatosPersonalesQueSiguen")
  const buscados = [...fn.matchAll(/if FileExists\(Carpeta \+ '([^']+)'\) then/g)].map((m) => m[1])
  assert.ok(buscados.length >= 3, `el .iss sólo busca ${buscados.length} archivo(s) de datos personales`)
  const uninstall = sinComentariosPs(leer("install", "uninstall.ps1"))
  for (const nombre of buscados) {
    assert.ok(uninstall.includes(`Join-Path $ConfigDir "${nombre}"`),
      `el .iss busca «${nombre}» y uninstall.ps1 no lo arma con Join-Path $ConfigDir: los dos archivos dejaron de hablar de lo mismo`)
  }
  // Y al revés: todo `tecnia-*.md|json` personal que uninstall.ps1 borra, el .iss lo busca.
  const personales = [...uninstall.matchAll(/^\$(?:Perfil|Memoria|Cargas)File\s*=\s*Join-Path \$ConfigDir "([^"]+)"/gm)].map((m) => m[1])
  assert.ok(personales.length >= 3, "no encontré en uninstall.ps1 los tres archivos de datos personales")
  for (const nombre of personales) assert.ok(buscados.includes(nombre), `uninstall.ps1 borra «${nombre}» y el .iss no comprueba que se haya ido`)
})

// ── Los tres caracteres que ISCC lee como estructura (.claude/rules/installer-iss.md) ──
//
// Costaron tres compilaciones fallidas, y escribiendo el arreglo 2.4 casi cuesta la
// cuarta: un `Format(..., [args])` partido en dos renglones dejó uno que empezaba
// con corchete. Lo cazó un chequeo a mano; esto lo deja escrito. NO reemplaza a
// ISCC (el job windows de la CI compila el .iss de verdad): sólo evita llegar ahí
// con un error que se podía ver antes.
test("ningún renglón del .iss empieza con «#» o «[» fuera de lugar, ni hay llaves adentro de un comentario Pascal", () => {
  const lineas = issCrudo.split("\n")
  const malas = []
  lineas.forEach((l, i) => {
    const t = l.trimStart()
    if (t.startsWith("#") && !/^#(ifndef|ifdef|endif|define|error|include|if|else)\b/.test(t)) malas.push(`${i + 1}: empieza con # → ${t.slice(0, 50)}`)
    if (t.startsWith("[") && !/^\[[A-Za-z]+\]\s*$/.test(l)) malas.push(`${i + 1}: empieza con [ → ${t.slice(0, 50)}`)
  })
  assert.deepEqual(malas, [], "ISCC lee estos renglones como directiva o como sección, estén o no comentados")

  // Comentarios Pascal de [Code]: recorriendo como el compilador (cadenas aparte).
  const code = issCrudo.slice(issCrudo.search(/^\[Code\]\s*$/m))
  const anidadas = []
  for (let i = 0; i < code.length; ) {
    if (code[i] === "'") {
      let j = i + 1
      for (;;) { j = code.indexOf("'", j); if (code[j + 1] === "'") { j += 2; continue } break }
      i = j + 1
    } else if (code[i] === "{") {
      const j = code.indexOf("}", i)
      const cuerpo = code.slice(i + 1, j)
      if (cuerpo.includes("{")) anidadas.push(cuerpo.slice(cuerpo.indexOf("{"), cuerpo.indexOf("{") + 40).replace(/\s+/g, " "))
      i = j + 1
    } else if (code[i] === "}") {
      anidadas.push("cierre de llave suelto cerca de: " + code.slice(Math.max(0, i - 40), i).replace(/\s+/g, " "))
      i++
    } else i++
  }
  assert.deepEqual(anidadas, [], "un comentario { } cierra en la PRIMERA llave de cierre: nombrar una constante entre llaves ahí adentro rompe la compilación")
})

// ── 2.4b · El lanzador no puede abrir el bot parado en la carpeta del programa ──
//
// La carpeta de proyectos se armaba con `%USERPROFILE%\Documents\Tecnia Bot` a
// fuego, y ni el `mkdir` ni el `cd /d` se verificaban. Si fallaban, OpenCode
// arrancaba en la carpeta del programa (la carpeta de trabajo del acceso directo)
// y los proyectos del alumno quedaban ahí, donde el desinstalador pasa.

/** El `.cmd` sin sus líneas `rem`. */
const lanzador = leer("installer", "abrir-tecnia-bot.cmd").replace(/^\s*rem\b.*$/gim, "")
const lineasLanzador = lanzador.split("\n").map((l) => l.trim()).filter((l) => l !== "")

test("2.4b · la carpeta de proyectos sale de la carpeta Documentos real, con el perfil de respaldo", () => {
  assert.match(lanzador, /for \/f "usebackq delims=" %%D in \(`powershell -NoProfile [^`]*\[Environment\]::GetFolderPath\('MyDocuments'\)[^`]*`\) do set "DOCS=%%D"/,
    "el lanzador no le pregunta a Windows dónde está Documentos (OneDrive y las redirecciones quedan afuera)")
  // Lo que conteste PowerShell se comprueba en el disco antes de usarlo, y si no sirve se vuelve al perfil.
  const i = lineasLanzador.findIndex((l) => l.startsWith("for /f") && l.includes("MyDocuments"))
  assert.deepEqual(lineasLanzador.slice(i + 1, i + 4), [
    'if defined DOCS if not exist "%DOCS%\\" set "DOCS="',
    'if not defined DOCS set "DOCS=%USERPROFILE%\\Documents"',
    'set "PROY=%DOCS%\\Tecnia Bot"',
  ], "cambió cómo se valida la respuesta de PowerShell o el respaldo al perfil")
  // PROY sólo puede valer dos cosas: la de Documentos que informó Windows, o la del perfil.
  assert.deepEqual(lineasLanzador.filter((l) => /set "PROY=/.test(l)).map((l) => l.replace(/^.*set "PROY=/, 'set "PROY=')),
    ['set "PROY=%DOCS%\\Tecnia Bot"', 'set "PROY=%PROYPERFIL%"', 'set "PROY=%PROYPERFIL%"'], "PROY se arma por algún otro lado")
  assert.ok(lineasLanzador.includes('set "PROYPERFIL=%USERPROFILE%\\Documents\\Tecnia Bot"'), "la carpeta de respaldo ya no es la del perfil")
})

test("2.4b · Documentos en una ruta de red (UNC) no aborta: cmd no puede pararse ahí, se usa la del perfil", () => {
  // REGRESIÓN que encontró la revisión: con redirección de carpetas de dominio,
  // GetFolderPath devuelve \\servidor\share\..., mkdir anda y `cd /d` falla SIEMPRE.
  // La primera versión abortaba en cada apertura donde antes el bot abría.
  const i = lineasLanzador.indexOf('set "PROYPERFIL=%USERPROFILE%\\Documents\\Tecnia Bot"')
  assert.equal(lineasLanzador[i + 1], 'if "%PROY:~0,2%"=="\\\\" set "PROY=%PROYPERFIL%"', "una ruta UNC no se cambia por la del perfil ANTES de intentar el cd")
  assert.ok(i + 1 < lineasLanzador.indexOf('cd /d "%PROY%" 2>nul && set "ENPROY=1"'), "la ruta UNC se detecta después del primer cd")
})

test("2.4b · si no se puede ENTRAR a la carpeta de proyectos se reintenta con la del perfil, y si tampoco, se aborta", () => {
  // Las líneas del tramo, EXACTAS y en orden: cualquier cosa que se cuele acá
  // cambia quién llega a abrir el bot.
  const desde = lineasLanzador.indexOf('set "ENPROY="')
  const iListo2 = lineasLanzador.indexOf(":listo2")
  assert.ok(desde > 0 && iListo2 > desde, "no está el tramo que entra a la carpeta de proyectos antes de :listo2")
  assert.deepEqual(lineasLanzador.slice(desde, iListo2 + 1), [
    'set "ENPROY="',
    'cd /d "%PROY%" 2>nul && set "ENPROY=1"',
    "if defined ENPROY goto enproyectos",
    'if /i "%PROY%"=="%PROYPERFIL%" goto sinproyectos',
    'set "PROY=%PROYPERFIL%"',
    'if not exist "%PROY%\\" mkdir "%PROY%" 2>nul',
    'cd /d "%PROY%" 2>nul || goto sinproyectos',
    ":enproyectos",
    'if /i "%CD%\\"=="%~dp0" goto sinproyectos',
    ":listo2",
  ], "cambió el tramo que entra a la carpeta de proyectos: un cd fallido puede dejar pasar")
  // ENPROY sólo se prende atado al éxito del cd, y a :enproyectos sólo se salta con ENPROY.
  assert.equal(lineasLanzador.filter((l) => /ENPROY=1/.test(l)).length, 1, "ENPROY se prende por otro lado")
  assert.deepEqual(lineasLanzador.filter((l) => /goto enproyectos/i.test(l)), ["if defined ENPROY goto enproyectos"], "se salta a :enproyectos sin haber entrado")
  // No hay atajo a :listo2, y OpenCode se abre en UN solo lugar, después.
  assert.deepEqual(lineasLanzador.filter((l) => /goto listo2\b/i.test(l)), [], "hay un `goto listo2` que se saltea la verificación de la carpeta de proyectos")
  assert.equal(lineasLanzador.filter((l) => l === '"%OC%"').length, 1, "OpenCode se abre desde más de un lugar")
  assert.ok(lineasLanzador.indexOf('"%OC%"') > iListo2, "OpenCode se abre antes de resolver la carpeta de proyectos")
})

test("2.4b · el aborto dice qué carpeta es, pausa y termina sin abrir nada", () => {
  const desde = lineasLanzador.indexOf(":sinproyectos")
  const hasta = lineasLanzador.indexOf(":proyectos")
  assert.ok(desde > 0 && hasta > desde, "no están las etiquetas :sinproyectos y :proyectos en ese orden")
  const bloque = lineasLanzador.slice(desde, hasta)
  assert.ok(bloque.some((l) => /^echo\s+"%PROY%"$/.test(l)), "el aviso no muestra cuál es la carpeta")
  assert.ok(bloque.some((l) => /^echo\s+Tecnia Bot v%VER% -- /.test(l)), "el aviso no lleva la versión, como las demás pantallas de error")
  assert.deepEqual(bloque.slice(-2), ["pause", "exit /b 1"], "el aborto no termina en `pause` + `exit /b 1`: o se cierra sin que se lea, o sigue de largo")
  assert.ok(!bloque.includes('"%OC%"'), "el bloque de aborto abre OpenCode")
})

// ── 2.4b · [UninstallDelete] había quedado sin una sola entrada ────────────────
//
// El commit que mudó la ejecución de uninstall.ps1 a [Code] sacó la entrada de
// esta sección junto con [UninstallRun], y dejó sólo comentarios (uno cortado a
// mitad de frase). La carpeta del programa quedaba en el disco, con los
// instalacion*.log y la marca .instalando.

test("2.4b · [UninstallDelete] tiene entradas REALES, no sólo comentarios", () => {
  const entradas = seccionIss("UninstallDelete").split("\n").map((l) => l.trim()).filter((l) => l !== "")
  assert.ok(entradas.length >= 1, "[UninstallDelete] no tiene ninguna entrada: sólo comentarios")
  for (const l of entradas) assert.match(l, /^Type: (files|filesandordirs|dirifempty); Name: "\{app\}[^"]*"$/, `entrada con forma inesperada: ${l}`)
  // Lo que nace DESPUÉS de instalar y por eso Inno no borra solo: la marca y los logs del bootstrap.
  assert.ok(entradas.includes('Type: files; Name: "{app}\\.instalando"'), "no se borra la marca .instalando")
  assert.ok(entradas.includes('Type: files; Name: "{app}\\instalacion.log"'), "no se borra instalacion.log")
  assert.ok(entradas.includes('Type: files; Name: "{app}\\instalacion-*.log"'), "no se borran los logs rotados")
  // Esos nombres son los que bootstrap.ps1 escribe de verdad (guard cruzado).
  assert.match(bootstrap, /Join-Path \$RepoDir "instalacion\.log"/, "bootstrap.ps1 cambió el nombre de su log")
  assert.match(bootstrap, /Join-Path \$RepoDir \("instalacion-" \+ \$marca \+ "\.log"\)/, "bootstrap.ps1 cambió el nombre de sus logs rotados")
  // La carpeta se va sólo si quedó vacía, y esa entrada es la última.
  assert.equal(entradas[entradas.length - 1], 'Type: dirifempty; Name: "{app}"', "la carpeta del programa no se quita al final (si quedó vacía)")
})

test("2.4b · la carpeta del programa NO se barre entera: lo que el instalador no puso no se borra, se avisa", () => {
  // DECISIÓN, y por qué este test la custodia. La entrada original era
  // `Type: filesandordirs; Name: "{app}"`. Con el lanzador viejo, un `cd` fallido
  // dejaba proyectos de alumnos adentro de {app}; el lanzador nuevo lo impide de
  // acá en adelante, pero no devuelve lo que ya haya quedado ahí. Si se decide
  // volver al barrido total, hay que cambiar este test A PROPÓSITO.
  const entradas = seccionIss("UninstallDelete").split("\n").map((l) => l.trim()).filter((l) => l !== "")
  assert.deepEqual(entradas.filter((l) => /^Type: filesandordirs; Name: "\{app\}"$/.test(l)), [],
    "[UninstallDelete] barre {app} entera: se lleva lo que un alumno haya guardado ahí")
  // Y lo que quede se informa, mirando el disco después de desinstalar.
  const hook = rutina("CurUninstallStepChanged")
  assert.match(hook, /if CurUninstallStep = usPostUninstall then\s+AvisarLoQueQuedo;/, "después de desinstalar no se mira qué quedó en la carpeta")
  const aviso = rutina("AvisarLoQueQuedo")
  assert.match(aviso, /MirarLoQueQuedo\(Propio, Ajeno\);\s+if \(Propio = ''\) and \(Ajeno = ''\) then\s+Exit;/, "avisa aunque no haya quedado nada")
  assert.match(aviso, /if UninstallSilent\(\) then\s+Exit;/, "en modo silencioso no puede aparecer un cartel")
  const busca = rutina("MirarLoQueQuedo")
  assert.match(busca, /FindFirst\(ExpandConstant\('\{app\}\\\*'\), Hallado\)/, "no recorre la carpeta del programa")
  assert.match(busca, /FindClose\(Hallado\);/, "no cierra la búsqueda")
})

// ── Revisión de QA · el cartel llamaba "proyectos" a un borrado nuestro que falló ──
//
// `LoAjenoQueQuedo` sólo salteaba `unins*`. Si [UninstallDelete] no podía borrar
// algo PROPIO (opencode\ con un archivo tomado, un log abierto), el cartel decía
// "pueden ser proyectos guardados ahí por error". Ahora se separa.

test("lo que quedó se separa en propio («no pude borrar») y ajeno («no lo puse»), y cada frase va con su lista", () => {
  const busca = rutina("MirarLoQueQuedo")
  assert.match(busca, /if EsNuestro\(Hallado\.Name\) then\s+AnotarEnLista\(Propio, CuantosPropios, Hallado\.Name\)\s+else\s+AnotarEnLista\(Ajeno, CuantosAjenos, Hallado\.Name\);/,
    "lo que quedó no se reparte entre propio y ajeno")
  const aviso = rutina("AvisarLoQueQuedo")
  assert.match(aviso, /if Propio <> '' then\s+Texto := Texto \+ #13#10 \+ #13#10\s+\+ 'NO PUDE BORRAR estos archivos de Tecnia Bot:' \+ #13#10 \+ Propio/, "lo propio que no se borró no se dice como «no pude borrar»")
  // «Proyectos» sólo se dice de lo ajeno: la frase vive adentro de la rama de Ajeno.
  const iAjeno = aviso.indexOf("if Ajeno <> '' then")
  const iProyectos = aviso.indexOf("Pueden ser proyectos")
  assert.ok(iAjeno > 0 && iProyectos > iAjeno, "«pueden ser proyectos» no depende de que haya algo ajeno")
  assert.equal((aviso.match(/proyectos/g) ?? []).length, 1, "«proyectos» se dice en más de un lugar del cartel")
  assert.ok(aviso.indexOf("if Propio <> '' then") < iAjeno, "cambió el orden: primero lo que no se pudo borrar")
  assert.doesNotMatch(aviso.slice(aviso.indexOf("if Propio <> '' then"), iAjeno), /proyectos/, "la rama de lo propio habla de proyectos")
})

test("la lista de «lo nuestro» del .iss coincide con lo que declaran [Files] y [UninstallDelete] (guard cruzado)", () => {
  // Lo que el instalador pone en la raíz de {app}, armado DESDE las secciones:
  //   [Files]            DestDir "{app}\X..." → X ; DestDir "{app}" → el nombre del Source
  //   [UninstallDelete]  Name "{app}\X"       → X (los que tienen comodín, aparte)
  const esperados = new Set()
  const comodines = []
  for (const m of seccionIss("Files").matchAll(/^Source:\s*"([^"]+)";\s*DestDir:\s*"\{app\}(?:\\([^"\\]+))?[^"]*"/gm)) {
    esperados.add((m[2] ?? m[1].split("\\").pop()).toLowerCase())
  }
  for (const m of seccionIss("UninstallDelete").matchAll(/^Type:\s*\w+;\s*Name:\s*"\{app\}\\([^"\\]+)"/gm)) {
    if (m[1].includes("*")) comodines.push(m[1].toLowerCase())
    else esperados.add(m[1].toLowerCase())
  }
  assert.ok(esperados.size >= 6, `sólo pude armar ${esperados.size} nombres desde las secciones: el extractor no está mirando bien`)
  assert.ok(esperados.has("opencode") && esperados.has("version") && esperados.has(".instalando"), "el extractor perdió nombres que seguro están")

  const fn = rutina("EsNuestro")
  const enCodigo = new Set([...fn.matchAll(/\(N = '([^']+)'\)/g)].map((m) => m[1]))
  assert.deepEqual([...enCodigo].sort(), [...esperados].sort(),
    "EsNuestro y las secciones [Files]/[UninstallDelete] no nombran lo mismo: o se llama «ajeno» a algo nuestro, o «nuestro» a algo del alumno")
  // Los comodines: cada `prefijo*sufijo` tiene su par Copy(...) = 'prefijo' / 'sufijo'.
  assert.ok(comodines.length >= 1, "esperaba al menos una entrada con comodín (los logs rotados)")
  for (const c of comodines) {
    const [pre, suf] = c.split("*")
    assert.ok(fn.includes(`(Copy(N, 1, ${pre.length}) = '${pre}') and (Copy(N, Length(N) - ${suf.length - 1}, ${suf.length}) = '${suf}')`),
      `EsNuestro no reconoce «${c}» como propio`)
  }
  assert.equal((fn.match(/Copy\(N, 1,/g) ?? []).length, comodines.length, "EsNuestro reconoce un patrón que las secciones no declaran")
  // Y compara en minúsculas (Windows no distingue): la lista de arriba está toda en minúsculas.
  assert.match(fn, /N := Lowercase\(Nombre\);/, "EsNuestro compara sin pasar a minúsculas")
})

// ── 2.13 · Una marca .instalando huérfana colgaba el lanzador para siempre ─────
//
// Si el Setup muere durante el bootstrap, la marca queda puesta y nadie la saca.
// Cada doble clic eran ~20 minutos de espera y después "La instalación sigue en
// curso, esperala" — para siempre. El lanzador ahora pregunta si el instalador
// VIVE (por su mutex, el de `SetupMutex` del .iss) y, si comprobó que no, manda a
// "Reparar Tecnia Bot" sin esperar.

test("2.13 · el lanzador pregunta por el mutex que el instalador crea de verdad (guard cruzado con el .iss)", () => {
  const declarados = (issCrudo.match(/^SetupMutex=(.+)$/m)?.[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean)
  assert.ok(declarados.length >= 1, "el .iss ya no declara SetupMutex: el lanzador no tiene cómo saber si el instalador vive")
  const linea = lineasLanzador.find((l) => l.startsWith("powershell") && l.includes("TryOpenExisting"))
  assert.ok(linea, "el lanzador no consulta ningún mutex")
  const consultados = [...linea.match(/foreach\(\$n in ([^)]*)\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  assert.deepEqual([...consultados].sort(), [...declarados].sort(),
    "los mutex que mira el lanzador no son los que crea el instalador: diría «no vive» con el instalador corriendo, o al revés")
})

test("2.13 · «el instalador no vive» sólo sale de una comprobación positiva; todo lo demás espera", () => {
  const i = lineasLanzador.indexOf(":mirarsetup")
  assert.ok(i > 0, "no está la rutina :mirarsetup")
  const rutinaCmd = lineasLanzador.slice(i, i + 5)
  // Arranca en «no sé», y sólo la salida 7 EXACTA lo cambia.
  assert.equal(rutinaCmd[1], 'set "SETUPVIVO=nose"', "la rutina no arranca suponiendo que no sabe")
  assert.match(rutinaCmd[2], /^powershell -NoProfile .*>nul 2>nul$/, "la consulta no es la segunda línea de la rutina, o ensucia la pantalla")
  assert.equal(rutinaCmd[3], 'if errorlevel 7 if not errorlevel 8 set "SETUPVIVO=no"', "«no vive» no está atado a la salida 7 exacta: un 9009 (PowerShell ausente) contaría como «no vive»")
  assert.equal(rutinaCmd[4], "goto :eof", "la rutina no vuelve a quien la llamó")
  // Adentro de PowerShell: cualquier excepción cuenta como «vive», y el 7 sólo sale si no se abrió ninguno.
  assert.match(rutinaCmd[2], /catch \{ \$vivo=\$true \}/, "un error al consultar el mutex se toma como «no vive»: es el lado peligroso")
  assert.match(rutinaCmd[2], /if\(\$vivo\)\{ exit 0 \} else \{ exit 7 \}/, "la salida 7 no depende de lo que se encontró")
  assert.equal((lanzador.match(/SETUPVIVO=no"/g) ?? []).length, 1, "SETUPVIVO se pone en «no» por otro lado")
})

test("2.13 · con la marca puesta y el instalador muerto, el lanzador no espera 20 minutos: manda a Reparar", () => {
  // Antes de empezar a esperar: después del atajo "OpenCode anda y la capa está".
  const iAtajo = lineasLanzador.indexOf('if not errorlevel 1 if exist "%OCCFG%\\agent\\tecnia-bot.md" goto verificar')
  assert.ok(iAtajo > 0, "cambió el atajo de la marca huérfana con la instalación completa")
  assert.deepEqual(lineasLanzador.slice(iAtajo + 1, iAtajo + 3), ["call :mirarsetup", 'if "%SETUPVIVO%"=="no" goto marcahuerfana'],
    "con la marca puesta no se pregunta si el instalador vive antes de ponerse a esperar")
  // Y otra vez al agotar el techo: el instalador pudo morir durante la espera.
  const iTecho = lineasLanzador.findIndex((l) => /^if %ESPERA% LSS \d+ goto esperando$/.test(l))
  const trasTecho = lineasLanzador.slice(iTecho + 1, iTecho + 5)
  assert.ok(trasTecho.includes("call :mirarsetup") && trasTecho.includes('if "%SETUPVIVO%"=="no" goto marcahuerfana'),
    "al agotar la espera no se vuelve a mirar si el instalador sigue vivo")
})

test("2.13 · la salida de la marca huérfana nombra Reparar, no repara sola y no toca la marca", () => {
  const desde = lineasLanzador.indexOf(":marcahuerfana")
  const hasta = lineasLanzador.indexOf(":mirarsetup")
  assert.ok(desde > 0 && hasta > desde, "no están :marcahuerfana y :mirarsetup en ese orden")
  const bloque = lineasLanzador.slice(desde, hasta)
  assert.ok(bloque.some((l) => l.includes('"Reparar Tecnia Bot"')), "no nombra «Reparar Tecnia Bot», que es la salida")
  assert.deepEqual(bloque.slice(-2), ["pause", "exit /b 1"], "no termina en `pause` + `exit /b 1`")
  // No lanza el bootstrap (el del Setup muerto puede seguir vivo) ni borra la marca.
  assert.ok(!bloque.some((l) => /bootstrap\.ps1|goto reparar/i.test(l)), "repara sola: puede pisar un bootstrap que sigue corriendo")
  assert.ok(!bloque.some((l) => /\bdel\b|\berase\b/i.test(l)), "borra la marca: la saca justo cuando el bootstrap puede seguir vivo")
  // Y el cartel viejo de "sigue en curso" también nombra la salida.
  const rep = lanzador.slice(lanzador.indexOf(":reparar"))
  const enCurso = rep.slice(rep.indexOf('if exist "%MARCA%" ('), rep.indexOf("exit /b 0"))
  assert.match(enCurso, /"Reparar Tecnia Bot"/, "el cartel «la instalación sigue en curso» no dice cómo salir si el instalador ya no está")
})

// ── Revisión de QA · la última pantalla recortaba el texto nuevo ──────────────
//
// Inno ajusta el alto del título en el constructor y el del texto (más la posición
// de las casillas) en ChangeFinishedLabel, ANTES de CurPageChanged. Cambiar el
// Caption después no reajusta nada: el texto de falla, más largo que el original,
// salía recortado. Se repite a mano la secuencia de Inno.
test("la última pantalla reajusta el alto de las dos etiquetas y corre las casillas, en el orden de Inno", () => {
  const fn = rutina("CurPageChanged")
  const pasos = [
    "WizardForm.FinishedHeadingLabel.Caption := Titulo + #13#10;",
    "Corrimiento := WizardForm.FinishedHeadingLabel.AdjustHeight;",
    "WizardForm.FinishedHeadingLabel.Top + WizardForm.FinishedHeadingLabel.Height;",
    "WizardForm.FinishedLabel.Caption := Texto + #13#10;",
    "Corrimiento := WizardForm.FinishedLabel.AdjustHeight;",
    "Y := WizardForm.FinishedLabel.Top + WizardForm.FinishedLabel.Height;",
    "Corrimiento := Y - WizardForm.YesRadio.Top;",
    "WizardForm.RunList.Top := WizardForm.RunList.Top + Corrimiento;",
    "WizardForm.RunList.Height := WizardForm.RunList.Height - Corrimiento;",
    "WizardForm.YesRadio.Top := Y;",
    "WizardForm.NoRadio.Top := Y + ScaleY(22);",
  ]
  let pos = -1
  for (const p of pasos) {
    const i = fn.indexOf(p, pos + 1)
    assert.ok(i > pos, `falta el paso, o está fuera de orden: ${p}`)
    pos = i
  }
  // El ajuste va DESPUÉS de elegir el texto: ajustar antes mide el texto viejo.
  assert.ok(fn.indexOf("Titulo := 'Tecnia Bot NO quedó instalado';") < fn.indexOf(pasos[0]), "se reajusta antes de elegir el texto")
})

test("el texto de «degradado» manda al log (si está en el disco), no a una ventana que ya se cerró", () => {
  const fn = rutina("CurPageChanged")
  const rama = fn.slice(fn.indexOf("else if EstadoBootstrap = EstadoDegradado then"), fn.indexOf("else if EstadoBootstrap = EstadoSalteado then"))
  assert.doesNotMatch(rama, /ventana negra/i, "manda a mirar la consola del bootstrap, que para entonces ya se cerró")
  assert.match(rama, /if FileExists\(RutaLogBootstrap\) then\s+Texto := Texto \+ '[^']*' \+ RutaLogBootstrap;/, "no nombra instalacion.log, o lo nombra sin mirar que exista")
})

// ── Revisión de QA · "Abrir Tecnia Bot ahora" aparecía tildada con el bootstrap caído ──
test("la casilla «Abrir Tecnia Bot ahora» sólo se ofrece si el bootstrap dejó un bot que abre", () => {
  // La entrada entera (puede venir partida con `\` al final del renglón).
  const run = seccionIss("Run").replace(/\\\n\s*/g, "")
  const abrir = run.split("\n").filter((l) => /abrir-tecnia-bot\.cmd/.test(l))
  assert.equal(abrir.length, 1, "esperaba una sola entrada de [Run] que abra el bot")
  assert.match(abrir[0], /;\s*Check:\s*OfrecerAbrirElBot\s*;/, "la casilla de abrir el bot se ofrece sin mirar cómo terminó el bootstrap")
  assert.match(abrir[0], /Flags:[^;]*\bpostinstall\b/, "la entrada dejó de ser una casilla de la última pantalla")
  const fn = rutina("OfrecerAbrirElBot")
  assert.match(fn, /^function OfrecerAbrirElBot: Boolean;\s+begin\s+Result := \(EstadoBootstrap = EstadoBien\) or \(EstadoBootstrap = EstadoDegradado\);\s+end;$/,
    "la casilla se ofrece en algún estado que no es «bien» ni «degradado»")
})

// ── Prueba del asistente en la VM (2026-11-21) · el navegador tapaba al bot ──
test("la casilla «Visitar la web» viene destildada, y la de abrir el bot sigue tildada", () => {
  // En un Windows 11 recién instalado, con las dos casillas tildadas el navegador abre su
  // pantalla de bienvenida a pantalla completa y tapa la ventana de Tecnia Bot: el docente
  // termina de instalar y no ve el bot. `unchecked` sólo cambia el estado inicial de la
  // casilla; sigue estando en la pantalla para el que la quiera.
  const run = seccionIss("Run").replace(/\\\n\s*/g, "")
  const web = run.split("\n").filter((l) => /^Filename: "\{#MyAppURL\}"/.test(l))
  assert.equal(web.length, 1, "esperaba una sola entrada de [Run] que abra la web")
  assert.match(web[0], /Flags:[^;]*\bpostinstall\b/, "la web dejó de ser una casilla de la última pantalla")
  assert.match(web[0], /Flags:[^;]*\bunchecked\b/, "la casilla de la web vuelve a venir tildada: el navegador tapa al bot")
  // Y el arreglo no se pasa de largo: abrir el bot es lo que el docente vino a hacer.
  const abrir = run.split("\n").filter((l) => /abrir-tecnia-bot\.cmd/.test(l))
  assert.doesNotMatch(abrir[0], /\bunchecked\b/, "la casilla de abrir el bot quedó destildada")
})

// ── Contrato de install.ps1 · 3 = "instalado CON AVISOS" no es una falla ───────
//
// install.ps1 sale con 0 = instalado, 3 = instalado con avisos (la capa SÍ se
// copió; no pudo escribir la config o guardar la key), 1 = se cortó. El bootstrap
// trataba cualquier código distinto de 0 como "La capa de Tecnia Bot no se
// instalo", que con el 3 es falso. (En esta rama install.ps1 todavía no devuelve
// 3: la guarda es contra el contrato; la integración la hace el coordinador.)
test("el 3 de install.ps1 cuenta como capa instalada CON AVISOS: degrada, no falla y no festeja", () => {
  assert.equal(Number(bootstrap.match(/^\$CodigoCapaConAvisos\s*=\s*(\d+)\s*$/m)?.[1]), 3, "el código «con avisos» de install.ps1 es 3")
  const antes = final.slice(0, final.indexOf("$OpenCodeArranca = [bool](Test-OpenCode)"))
  // Con avisos NO se imprime «no se instalo» ni se baja $CapaOk...
  const rama = bloqueDesde(antes, "if ($CodigoInstall -eq $CodigoCapaConAvisos) {")
  assert.match(rama, /^if \(\$CodigoInstall -eq \$CodigoCapaConAvisos\) \{\s*\n\s*\$CapaConAvisos = \$true\s*\n\s*\}$/, "la rama «con avisos» hace algo más que anotarlo")
  // ...pero el agente en el disco se exige igual: la comprobación NO está en un elseif del código.
  assert.match(antes, /\n\}\s*\nif \(\$CapaOk -and -not \(Test-Path/, "con el 3 no se comprueba en el disco que el agente esté")
  // $CapaConAvisos sólo se prende en esa rama.
  assert.equal((bootstrap.match(/\$CapaConAvisos = \$true/g) ?? []).length, 1, "$CapaConAvisos se prende por otro lado")
  // En el resumen: degrada (o sea, sale con 2 y sin LISTO!) y remite a lo impreso arriba.
  assert.match(final, /if \(\$CapaOk -and \$CapaConAvisos\) \{\s*\n\s*\$Degradado \+= "la capa se instalo CON AVISOS/, "la capa con avisos no degrada el resultado: terminaría en LISTO! con exit 0")
  const linea = bloqueDesde(final, "if ($CapaOk -and $CapaConAvisos) {")
  assert.match(linea, /CON AVISOS/, "el resumen no dice que la capa quedó con avisos")
  assert.match(linea, /mas arriba/, "el resumen no remite a los avisos que install.ps1 imprimió")
  assert.doesNotMatch(linea, /\[OK\]/, "la capa con avisos se muestra como [OK]")
  // El [OK] de la capa queda sólo para el caso sin avisos.
  assert.match(final, /\} elseif \(\$CapaOk\) \{\s*\n\s*Write-Host "  \[OK\] Tecnia Bot/, "el [OK] de la capa no excluye el caso con avisos")
})


// ── Las pantallas de error del lanzador nombran una salida que EXISTE ──────────
//
// `:completo` decía "Volve a correr el instalador" y `:sinopencode` "volve a
// correrlo, o mira docs\instalacion-windows.md". El instalador hay que volver a
// bajarlo del sitio (nadie lo guarda) y ese .md no viaja en el .exe: dos consejos
// que el docente no puede seguir. El acceso "Reparar Tecnia Bot" existe para eso.
test("las pantallas «falta la capa» y «no se encontró OpenCode» mandan a Reparar, no a reinstalar ni a un doc que no está", () => {
  const completo = lanzador.slice(lanzador.indexOf(":completo"), lanzador.indexOf(":sinopencode"))
  const sinOpenCode = lanzador.slice(lanzador.indexOf(":sinopencode"), lanzador.indexOf(":marcahuerfana"))
  for (const [nombre, bloque] of [[":completo", completo], [":sinopencode", sinOpenCode]]) {
    assert.ok(bloque.length > 50, `no pude recortar ${nombre}`)
    assert.match(bloque, /"Reparar Tecnia Bot"/, `${nombre} no nombra «Reparar Tecnia Bot»`)
    assert.doesNotMatch(bloque, /volve a correr|docs\\/i, `${nombre} sigue mandando a reinstalar o a un documento que no se instala`)
  }
  // Dentro del bloque ( ) de :completo no puede haber paréntesis en un echo: cierran el bloque.
  const adentro = completo.slice(completo.indexOf("("), completo.lastIndexOf(")"))
  assert.deepEqual(adentro.split("\n").slice(1).filter((l) => /^\s*echo\b.*[()]/.test(l)), [], "un echo con paréntesis adentro de un bloque ( ) lo cierra antes de tiempo")
  // Y la de OpenCode sigue avisando que quizá el instalador está corriendo ahora.
  assert.match(sinOpenCode, /esperalo/i, ":sinopencode dejó de avisar que el instalador puede estar corriendo")
})

// ══════════════════════════════════════════════════════════════════════════════
// GUARDAS ENDURECIDAS TRAS LA REVISIÓN DE QA
// ══════════════════════════════════════════════════════════════════════════════
//
// La revisión razonó seis mutaciones del PRODUCTO que dejaban este archivo en
// verde. Se ejecutaron todas (el detalle, con sus códigos de salida, está en el
// encabezado). Cuatro quedaban verdes de verdad. Cada test de acá abajo nombra la
// mutación que lo originó.

test("I.1 · [UninstallDelete] no puede llevarse la carpeta del programa por la vía de un comodín", () => {
  // MUTACIÓN: agregar `Type: filesandordirs; Name: "{app}\*"`. El filtro original
  // sólo rechazaba `Name: "{app}"` EXACTO: `{app}\*` borra lo mismo y pasaba.
  // (Ejecutada: ya salía roja, pero de rebote, por el guard cruzado de EsNuestro.
  // Acá queda cazada por lo que es.)
  const entradas = [...seccionIss("UninstallDelete").matchAll(/^Type:\s*(\w+);\s*Name:\s*"([^"]*)"\s*$/gm)].map((m) => ({ tipo: m[1], nombre: m[2] }))
  assert.ok(entradas.length >= 4, "no pude leer las entradas de [UninstallDelete]")
  // Las carpetas que [Files] crea debajo de {app}: lo único que se puede borrar entero.
  const carpetasPropias = new Set([...seccionIss("Files").matchAll(/DestDir:\s*"\{app\}\\([^"\\]+)"/g)].map((m) => m[1]))
  for (const { tipo, nombre } of entradas) {
    assert.ok(nombre === "{app}" || nombre.startsWith("{app}\\"), `entrada fuera de la carpeta del programa: ${nombre}`)
    const resto = nombre.slice("{app}".length).replace(/^\\/, "")
    assert.doesNotMatch(resto, /\?/, `comodín «?» en [UninstallDelete]: ${nombre}`)
    if (tipo === "dirifempty") {
      assert.equal(nombre, "{app}", `dirifempty sobre algo que no es la carpeta del programa: ${nombre}`)
    } else if (tipo === "filesandordirs") {
      // Borrado recursivo: sólo una carpeta que [Files] creó, por su nombre, sin comodines.
      assert.ok(carpetasPropias.has(resto), `borrado recursivo de «${nombre}», que no es una carpeta que [Files] haya creado: se puede llevar trabajo del alumno`)
    } else if (tipo === "files") {
      assert.ok(resto.length > 0 && !resto.includes("\\"), `entrada de archivos con forma inesperada: ${nombre}`)
      // Un comodín sólo después de un prefijo propio y largo: `*`, `*.log` o `i*` barren de más.
      if (resto.includes("*")) {
        assert.match(resto, /^[a-z]{8,}-\*\.[a-z]+$/, `comodín demasiado amplio en [UninstallDelete]: ${nombre}`)
      }
    } else {
      assert.fail(`tipo de entrada no contemplado en [UninstallDelete]: ${tipo}`)
    }
  }
})

test("I.2 · la consulta del mutex es EXACTAMENTE la que distingue «vive» de «no vive»", () => {
  // MUTACIÓN: quitar el `$vivo=$true; ` de adentro del `if(...TryOpenExisting...)`.
  // Con el instalador corriendo la consulta salía con 7 = «no vive», y el lanzador
  // mandaba a Reparar encima de una instalación viva. Quedaba VERDE: la guarda
  // miraba el `catch` y el `exit`, no la rama que importa. Ahora se compara la
  // línea entera, armada con los nombres de mutex que declara el .iss.
  const declarados = (issCrudo.match(/^SetupMutex=(.+)$/m)?.[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean)
  const nombres = declarados.map((n) => `'${n}'`).join(",")
  const esperada =
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$vivo=$false; foreach($n in ' + nombres +
    "){ try { $m=$null; if([System.Threading.Mutex]::TryOpenExisting($n,[ref]$m)){ $vivo=$true; $m.Close() } } catch { $vivo=$true } }; " +
    'if($vivo){ exit 0 } else { exit 7 }" >nul 2>nul'
  const linea = lineasLanzador.find((l) => l.startsWith("powershell") && l.includes("TryOpenExisting"))
  assert.equal(linea, esperada, "cambió la consulta del mutex: revisá a mano las tres ramas (se abrió → vive; excepción → vive; ninguna → 7)")
})

test("I.3 · la lista de degradaciones se inicializa UNA vez, antes de llenarla, y nada la vacía", () => {
  // MUTACIÓN: insertar `$Degradado = @()` justo antes de `if ($Degradado.Count -gt 0) {`.
  // Sin PlatformIO el script terminaba en "LISTO!" con exit 0. Quedaba VERDE: las
  // guardas miraban que cada falta se anotara y que el `if` saliera con 2, pero no
  // que la lista llegara intacta de un punto al otro.
  const inicios = [...final.matchAll(/^\s*\$Degradado\s*=(?!=)[^\n]*$/gm)].map((m) => m[0].trim())
  assert.deepEqual(inicios, ["$Degradado = @()"], "$Degradado se (re)asigna en más de un lugar: una degradación ya anotada se pierde")
  assert.ok(final.indexOf("$Degradado = @()") < final.indexOf("$Degradado +="), "$Degradado se inicializa después de empezar a llenarla")
  const usos = final.split("\n").filter((l) => /\$Degradado\b/.test(l) && !/^\s*\$Degradado \+= "/.test(l)).map((l) => l.trim())
  assert.deepEqual(usos, ["$Degradado = @()", "if ($Degradado.Count -gt 0) {", 'foreach ($d in $Degradado) { Write-Host ("    - " + $d) }'],
    "$Degradado se usa de alguna forma que no es llenarla, contarla y mostrarla")
  // Lo mismo para las otras tres variables que deciden el código de salida.
  for (const [v, veces] of [["CapaOk", 3], ["CapaConAvisos", 2], ["OpenCodeArranca", 1], ["OpenCodeEsLaFijada", 1]]) {
    const n = final.split("\n").filter((l) => new RegExp(`^\\s*\\$${v}\\s*=(?!=)`).test(l)).length
    assert.equal(n, veces, `$${v} se asigna ${n} veces en el tramo final y se esperaban ${veces}: una asignación de más puede tapar una falla`)
  }
})

test("I.4 · GetCustomSetupExitCode no pisa su resultado: el 0 es sólo el valor inicial", () => {
  // MUTACIÓN: agregar `Result := 0;` como última sentencia. El .exe volvía a
  // devolver 0 siempre. Quedaba VERDE: la guarda miraba que las ramas asignaran
  // 20 y 21, no que nadie las pisara después.
  const fn = rutina("GetCustomSetupExitCode")
  // `(\w+)` y no `([^;]+);`: en Pascal la sentencia anterior a un `else` no lleva punto y coma.
  const asignaciones = [...fn.matchAll(/Result := (\w+)/g)].map((m) => m[1])
  assert.deepEqual(asignaciones, ["0", "SalidaSetupDegradado", "SalidaSetupFallo"], "GetCustomSetupExitCode asigna Result en un orden o una cantidad que no es la esperada")
  assert.match(fn, /begin\s+Result := 0;\s+if EstadoBootstrap = EstadoDegradado then/, "el 0 no es la PRIMERA sentencia: puede estar pisando una rama")
  assert.match(fn, /Result := SalidaSetupFallo;\s+end;$/, "después de la última rama hay algo más")
  // Mismo cuidado en la otra función que devuelve un veredicto.
  assert.equal((rutina("OfrecerAbrirElBot").match(/Result :=/g) ?? []).length, 1, "OfrecerAbrirElBot asigna Result más de una vez")
})

test("I.5 · los `catch` que atajan las tres llamadas CAPTURAN el error: ninguno lo relanza", () => {
  // MUTACIÓN: cambiar el cuerpo de cualquiera de esos `catch` por `catch { throw }`.
  // Vuelve EXACTAMENTE el defecto original (una excepción cruda que mata el script
  // antes de la capa) con el try/catch a la vista. Quedaban VERDES las cuatro: las
  // guardas pedían `try { ... } catch {` y no miraban qué había adentro.
  const esperadas = [
    [/Bajar\s[^\n]*get-platformio\.py/, /\} catch \{ \$errorBajadaPio = \$_\.Exception\.Message \}\s*$/],
    [/Bajar\s[^\n]*get\.scoop\.sh/, /\} catch \{ \$errorScoop = \$_\.Exception\.Message \}\s*$/],
    [/\[scriptblock\]::Create\(\$scoopInstaller\)/, /\} catch \{ \$errorScoop = \$_\.Exception\.Message \}\s*$/],
    [/\$salidaReintento = scoop install \$ManifiestoOpenCode/, /\} catch \{ \$salidaReintento = "ERROR " \+ \$_\.Exception\.Message \}\s*$/],
  ]
  for (const [cual, cuerpo] of esperadas) {
    const lineas = comandos.filter((l) => cual.test(l))
    assert.ok(lineas.length >= 1, `no encuentro la llamada ${cual}`)
    for (const l of lineas) assert.match(l, cuerpo, `el catch no guarda el error (¿lo relanza?): ${l.trim()}`)
  }
  // Y en general: en todo el bootstrap, el único `throw` es el de la función Bajar
  // (que relanza al tercer intento, y por eso sus llamadas van atajadas).
  const throws = bootstrap.split("\n").filter((l) => /\bthrow\b/.test(l)).map((l) => l.trim())
  assert.deepEqual(throws, ["if ($i -eq 3) { throw }"], "apareció un `throw` nuevo en el bootstrap: con ErrorActionPreference en Stop corta antes de instalar la capa")
  // Toda llamada a Bajar está atajada en su misma línea, o adentro de una función que ataja.
  const llamadas = comandos.filter((l) => /(^|[\s={(])Bajar -Url/.test(l)).map((l) => l.trim())
  assert.ok(llamadas.length >= 3, "no encuentro las llamadas a Bajar")
  const baseline = funcionPs(bootstrap, "Install-OpenCodeBaseline")
  for (const l of llamadas) {
    const atajadaEnLinea = /^try \{.*\} catch \{ \$\w+ = /.test(l)
    const enBaseline = baseline.includes(l) && /try \{[\s\S]*Bajar -Url[\s\S]*\} catch \{\s*return \$false\s*\}/.test(baseline)
    assert.ok(atajadaEnLinea || enBaseline, `llamada a Bajar sin red de seguridad: ${l}`)
  }
})

test("I.6 · los encabezados de sección del .iss son exactamente los esperados, una vez cada uno y ninguno dentro del código", () => {
  // MUTACIÓN: un renglón que sea sólo `[Run]` adentro de un comentario Pascal. La
  // guarda de los tres caracteres aceptaba cualquier renglón con forma `[Palabra]`,
  // y ése tiene exactamente esa forma: ISCC lo lee como el comienzo de una sección
  // y lo que sigue del código deja de ser código. (Ejecutada: salía roja, pero
  // porque este archivo reventaba al cargar, no porque alguna guarda lo nombrara.)
  const encabezados = issCrudo.split("\n").map((l, i) => [l, i + 1]).filter(([l]) => /^\s*\[/.test(l)).map(([l, n]) => `${n}: ${l.trim()}`)
  const soloNombres = encabezados.map((e) => e.replace(/^\d+: /, ""))
  assert.deepEqual(soloNombres,
    ["[Setup]", "[Languages]", "[Tasks]", "[InstallDelete]", "[Files]", "[Icons]", "[Run]", "[UninstallDelete]", "[Messages]", "[Code]"],
    "los renglones que empiezan con «[» no son las diez secciones, una vez cada una y en orden:\n" + encabezados.join("\n"))
  // [Code] es la última: nada con forma de sección puede aparecer después.
  const iCode = issCrudo.search(/^\[Code\]\s*$/m)
  assert.doesNotMatch(issCrudo.slice(iCode + 6), /^\s*\[/m, "hay un renglón que empieza con «[» adentro de [Code]")
})

// ── Fase 3 · lo que decide SI el bootstrap corre y CON QUÉ CÓDIGO corta ────────
//
// DOS HUECOS QUE QUEDABAN, medidos por mutación contra este archivo y contra
// instalador.test.mjs, opencode-version.test.mjs, robustez.test.mjs,
// scripts-soporte.test.mjs y ci.test.mjs (exit code de cada `node --test`, sin
// pipe; cada mutación aplicada con un script que hace assert de que el texto
// existe, y comprobada con `git diff --stat`):
//
//   F3.a  .iss: el cuerpo de CorrerBootstrap cambiado por `Result := False;`
//         → exit 0 en los seis archivos. HUECA.
//         Con eso el .exe NO corre nunca el bootstrap, anota "salteado" y sale con
//         0: un instalador que no instala nada y no avisa (el estado de la v0.3.48).
//         Por qué era hueca: las guardas de 2.1 miraban que CorrerElBootstrap
//         PREGUNTARA (`if not CorrerBootstrap then`), y ninguna qué CONTESTABA la
//         función a la que le preguntaba.
//   F3.b  bootstrap: sacar el `exit 1` del corte por install\OPENCODE_VERSION
//         inválida → exit 0 en los seis. HUECA. (El script seguía de largo e
//         instalaba «la versión que sea», que es lo que ese corte vino a impedir.)
//   F3.c  bootstrap: ese mismo `exit 1` cambiado por `exit 0` → exit 0 en los
//         seis. HUECA. (El .exe leía "todo comprobado" de un script que no hizo nada.)
//         Por qué eran huecas las dos: tests/opencode-version.test.mjs comprueba
//         que la versión se LEA y se valide, no que el script CORTE cuando no vale.
//
// Los demás cortes YA estaban custodiados, y no se duplican (misma medición):
//   - `exit 1` de «no pude bajar Scoop» → 0: rojo por «2.2b · bajar el instalador
//     de Scoop está atajado…» de este archivo.
//   - `exit 1` de «Scoop NO quedó instalado» → 0: rojo por «Scoop también se
//     verifica, y corta si falta» de instalador.test.mjs.
//   - los tres `exit` del resumen final (falla de OpenCode, falla de la capa,
//     degradado) → 0: rojo por las guardas «2.2b · «LISTO!» sólo se alcanza…» y
//     «2.2b · la capa que no quedó…» de este archivo.
//
// Lo que se agrega igual es un CENSO de todos los `exit` del bootstrap: las
// guardas de arriba miran cada corte por separado, y un `exit 0` NUEVO, metido en
// cualquier otro lado, no lo veía ninguna. Después de agregar esto, F3.a, F3.b y
// F3.c dan exit 1 en este archivo.

test("F3.a · CorrerBootstrap contesta según /skipdeps, y es lo único que puede saltear el bootstrap", () => {
  const fn = rutina("CorrerBootstrap")
  // UNA asignación, y es la comparación con el parámetro: ni un False fijo, ni un
  // True fijo, ni una segunda asignación que pise a la primera.
  const asignaciones = [...fn.matchAll(/Result := ([^;]+);/g)].map((m) => m[1].trim())
  assert.deepEqual(asignaciones, ["ExpandConstant('{param:skipdeps|0}') <> '1'"],
    "CorrerBootstrap ya no contesta «corré, salvo que te pasen /skipdeps=1»: con un False fijo el .exe no instala nada y sale con 0")
  assert.doesNotMatch(fn, /\bExit\b/, "CorrerBootstrap sale antes de asignar su resultado: devuelve False (el valor inicial)")
  // Y el salteo se anota en UN solo lugar: el que cuelga de esa pregunta.
  assert.equal((pascal.match(/EstadoBootstrap := EstadoSalteado\b/g) ?? []).length, 1, "«salteado» se asigna en más de un lugar")
  const lanzar = rutina("CorrerElBootstrap")
  assert.match(lanzar, /begin\s+if not CorrerBootstrap then\s+begin\s+EstadoBootstrap := EstadoSalteado;/,
    "el salteo ya no cuelga de CorrerBootstrap, o no es lo primero que se decide")
  assert.equal((lanzar.match(/\bExit;/g) ?? []).length, 1, "CorrerElBootstrap tiene más de una salida temprana antes de lanzar PowerShell")
})

/** Cada sentencia `exit` del bootstrap, en orden (sin los Write-Host, que las nombran). */
const salidasBootstrap = comandos
  .flatMap((l) => [...l.matchAll(/(?:^|[;{(])\s*exit\b[ \t]*([^\s;})]*)/g)].map((m) => `exit ${m[1]}`.trim()))

test("F3.b · sin una install\\OPENCODE_VERSION válida el bootstrap CORTA con 1, antes de instalar nada", () => {
  const corte = bloqueDesde(bootstrap, "if ($OpenCodeVersion -notmatch '^\\d+\\.\\d+\\.\\d+$') {")
  assert.match(corte, /No se pudo leer la version de OpenCode a instalar/, "el corte no dice qué pasó")
  assert.match(corte, /Stop-Transcript[^\n]*\n\s*exit 1\s*\n\}$/,
    "con la versión inválida el script no termina en `exit 1`: sigue de largo, o le contesta «todo bien» al .exe")
  // Y está antes de la primera cosa que instala algo.
  const iCorte = bootstrap.indexOf(corte)
  const iPrimeraInstalacion = bootstrap.search(/get\.scoop\.sh|scoop install/)
  assert.ok(iPrimeraInstalacion > 0, "no encuentro dónde empieza a instalar el bootstrap")
  assert.ok(iCorte >= 0 && iCorte < iPrimeraInstalacion, "el corte por versión inválida quedó después de empezar a instalar")
})

test("F3.c · censo de salidas del bootstrap: seis cortes con 1, el degradado, y UN solo 0 al final", () => {
  assert.deepEqual(
    salidasBootstrap,
    ["exit 1", "exit 1", "exit 1", "exit 1", "exit 1", "exit 1", "exit $CodigoDegradado", "exit 0"],
    "cambió alguna salida del bootstrap. El orden es: versión de OpenCode inválida, el manifest de OpenCode " +
      "falta o es de otra versión (0.4.10), no se pudo bajar Scoop, " +
      "Scoop no quedó, OpenCode no arranca, la capa no quedó, degradado, y el único `exit 0` (todo comprobado). " +
      "Si agregaste un corte a propósito, sumalo acá y al encabezado de bootstrap.ps1",
  )
  // El único 0 es la ÚLTIMA sentencia del script: nada corre después del veredicto.
  assert.match(bootstrap, /\n\s*exit 0\s*$/, "el `exit 0` no es lo último del script")
})

// ── Prueba con el asistente (2026-11-21) · letras rojas en una instalación que sale bien ──
test("ningún chequeo previsto del bootstrap puede imprimir un error rojo de PowerShell", () => {
  // `try { Get-Item X } catch { ... }` NO atrapa un error no terminante: con
  // ErrorActionPreference en Continue (como está en los bloques de diagnóstico), PowerShell
  // imprime el error en rojo y sigue. En una instalación nueva pasaba siempre, porque el
  // diagnóstico mira la carpeta de OpenCode antes de que exista. La instalación terminaba
  // bien y el docente veía seis renglones rojos. Regla: todo `try { ... } catch` de UNA línea
  // que lea el disco o los procesos lleva -ErrorAction Stop (o SilentlyContinue).
  const sinComentarios = bootstrap.split("\n").filter((l) => !/^\s*#/.test(l))
  const flojos = sinComentarios.filter(
    (l) =>
      /try \{[^}]*\b(Get-Item|Get-ChildItem|Get-Content|Get-ItemProperty|Resolve-Path|Get-Process|Get-Command)\b[^}]*\} catch/.test(l) &&
      !/-ErrorAction (Stop|SilentlyContinue)/.test(l),
  )
  assert.deepEqual(flojos.map((l) => l.trim().slice(0, 90)), [], "hay un try/catch de una línea que puede imprimir un error rojo")
  // Y el que se vio en pantalla, con nombre y apellido.
  assert.match(bootstrap, /\$dirReal = try \{ \(Get-Item \$dirCurrent -Force -ErrorAction Stop\)\.Target \} catch \{ \$dirCurrent \}/, "volvió el Get-Item sin -ErrorAction Stop del diagnóstico de OpenCode")
})
