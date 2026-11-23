// `/actualizar` en Windows: cómo se REEMPLAZA la copia instalada, y qué se dice
// cuando falla. Complementa a `update-scripts.test.mjs` (qué se baja y de dónde).
//
// POR QUÉ ESTE ARCHIVO. `install/update.ps1` reemplazaba la copia maestra con
//
//     Copy-Item (Join-Path $extracted.FullName "*") $RepoDir -Recurse -Force
//
// que sólo AGREGA y PISA. Cinco defectos colgaban de esa línea y de su `catch`:
//
//   a. lo que el release eliminó o renombró quedaba en `{app}\opencode`,
//      `install.ps1` lo volvía a publicar y seguía en el manifest para siempre;
//      y un corte a mitad dejaba dos versiones mezcladas;
//   b. el `catch` decía «la copia instalada quedó como estaba» aunque la copia ya
//      hubiera empezado;
//   c. el lanzador (`abrir-tecnia-bot.cmd`) vive en `installer\` en el zip y en la
//      raíz en la instalación: nunca se actualizaba;
//   d. la barra de progreso de PowerShell 5.1 enlentece la descarga y ensucia la
//      salida que el bot muestra;
//   e. el `catch` imprimía `$_.Exception.Message`, que llega al chat: un error de
//      red trae la URL y el proxy con su usuario:clave.
//
// SOBRE EL LANZADOR, PARA QUE NADIE LO "SIMPLIFIQUE": `cmd.exe` no lee un `.cmd`
// entero, lo va leyendo del disco por posición. `/actualizar` corre desde adentro
// del bot, que casi siempre se abrió con ese lanzador: reemplazarlo en ese momento
// hace que, al cerrar el bot, cmd siga leyendo desde el mismo byte de OTRO archivo.
// Por eso hay una guarda (`Lanzador-EnUso`) y por eso falla cerrada.
//
// LÍMITE HONESTO: guardas de FORMA sobre el código SIN comentarios, verificadas
// por mutación (anotadas arriba de cada test). Acá no hay PowerShell ni NTFS: que
// el rename de una carpeta sea entero, y que un cmd.exe en uso se detecte, se
// prueba en la VM (ver el informe de la tarea).
//
// Corre con: node --test tests/update-reemplazo.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const sinComentarios = (t) => t.replace(/^\s*#.*$/gm, "")
const PS = sinComentarios(readFileSync(join(REPO, "install/update.ps1"), "utf8"))

const pos = (texto, que) => {
  const i = PS.indexOf(texto)
  assert.ok(i >= 0, `update.ps1 ya no tiene ${que ?? texto}: cambió la forma, revisar este test`)
  return i
}
function cuerpoFn(nombre) {
  const i = pos(`function ${nombre}`)
  return PS.slice(i, PS.indexOf("\n}\n", i))
}

// Mutación que lo puso rojo: volver a
// `Copy-Item (Join-Path $extracted.FullName "*") $RepoDir -Recurse -Force` → exit code 1.
test("la copia instalada se REEMPLAZA (staging + rename), no se le copia encima", () => {
  // Ninguna copia recursiva cae directo sobre la instalación ni sobre una de sus
  // carpetas vivas: todas van a una carpeta de paso `.nuevo-<id>`.
  const copias = [...PS.matchAll(/^.*Copy-Item[^\n]*-Recurse.*$/gm)].map((m) => m[0].trim())
  assert.equal(copias.length, 1, `esperaba UNA copia recursiva (la del staging) y hay ${copias.length}`)
  assert.match(copias[0], /\(Join-Path \$RepoDir \(\$c \+ "\.nuevo-" \+ \$Sufijo\)\) -Recurse -Force$/, `la copia recursiva no va a la carpeta de paso: ${copias[0]}`)
  assert.doesNotMatch(PS, /Copy-Item[^\n]*"\*"\) \$RepoDir\b/, "volvió la copia del zip entero encima de la instalación")
  // Sólo lo que el .exe instala, no el repo entero.
  assert.match(PS, /\$Carpetas = @\("opencode", "install"\)/, "cambió la lista de carpetas que se reemplazan")
  // El reemplazo: la instalada se corre a .viejo y la nueva toma su lugar, en ese orden.
  const iCorre = pos("[System.IO.Directory]::Move($actual, $vieja)")
  const iPone = pos("[System.IO.Directory]::Move($nueva, $actual)")
  assert.ok(iCorre < iPone, "la carpeta nueva se pone antes de correr la vieja")
  // Y antes de reemplazar se comprobó que la copia nueva llegó entera.
  const iCuenta = pos("if ((Contar-Archivos $nueva) -ne (Contar-Archivos $origen)) {")
  assert.ok(iCuenta < iCorre, "se reemplaza sin comprobar que la copia nueva esté completa")
  // Las carpetas de paso viven en el MISMO disco que la instalación (un rename
  // entre discos no es un rename): cuelgan de $RepoDir, no de TEMP.
  assert.doesNotMatch(PS, /Join-Path \$(tmp|env:TEMP) \(\$c \+/, "las carpetas de paso se arman en TEMP")
  // VERSION es lo ÚLTIMO: es lo que la próxima corrida mira para decidir «ya estás en la última».
  // (La primera versión de esta guarda buscaba UNA línea exacta y una mutación
  // se le escapó: una segunda escritura de VERSION, con otra forma, puesta antes
  // del reemplazo, la dejaba verde. Ahora se recolectan TODAS las que mueven el
  // VERSION nuevo a su lugar y se afirma sobre cada una y sobre el total.)
  const escriturasVersion = [...PS.matchAll(/\[System\.IO\.File\]::(Replace|Move)\(\$versionNueva\b/g)]
  assert.equal(escriturasVersion.length, 2, `esperaba dos escrituras de VERSION (Replace si ya existe, Move si no) y hay ${escriturasVersion.length}`)
  for (const e of escriturasVersion) {
    assert.ok(e.index > iPone, "VERSION se escribe antes de terminar el reemplazo: un corte deja «ya estás en la última» con el fuente viejo")
  }
  // Y todo esto pasa después de verificar lo bajado.
  assert.ok(PS.lastIndexOf("Verificar-Version -Dir") < pos("$Tocado = $true"), "se reemplaza antes de verificar lo descargado")
})

// Mutaciones que lo pusieron rojo: sacar el `if (-not $Tocado) { }` y dejar el
// mensaje suelto → exit code 1; mover `$Tocado = $true` debajo del foreach de los
// rename → exit code 1; `$volvio = $true` a secas → exit code 1.
test("si falla, el mensaje distingue «no toqué nada» de «fallé a mitad», y lo segundo se comprueba", () => {
  // La bandera se prende ANTES del primer rename, y después de todas las copias.
  const iTocado = pos("$Tocado = $true")
  assert.ok(iTocado < pos("[System.IO.Directory]::Move($actual, $vieja)"), "$Tocado se prende después de empezar a renombrar")
  assert.ok(iTocado > pos("Copy-Item (Join-Path $origen"), "$Tocado se prende antes de terminar de preparar la copia nueva")
  assert.equal((PS.match(/\$Tocado = \$true/g) ?? []).length, 1, "$Tocado se prende en más de un lugar")
  assert.ok(pos("$Tocado = $false") < iTocado, "$Tocado no arranca en falso")
  // «quedó como estaba» sólo se dice (1) sin haber tocado nada, o (2) después de
  // deshacer Y comprobar.
  const afirmaciones = [...PS.matchAll(/^.*(quedo como estaba|quedar como estaba).*$/gm)]
  assert.equal(afirmaciones.length, 2, `esperaba dos afirmaciones de «quedó como estaba» en update.ps1 y hay ${afirmaciones.length}`)
  const iCatch = pos("$fallo = $true")
  const cat = PS.slice(iCatch, PS.indexOf("} finally {", iCatch))
  assert.match(cat, /if \(-not \$Tocado\) \{\s*\n\s*Write-Host "[^"\n]*No llegue a tocar la copia instalada: quedo como estaba[^"\n]*"\s*\n\s*\}/,
    "«no toqué nada» no cuelga de que de verdad no se haya tocado")
  assert.match(cat, /if \(\$volvio\) \{\s*\n\s*Write-Host "[^"\n]*Fallo A MITAD del reemplazo\. Lo deshice y lo comprobe[^"\n]*"\s*\n\s*Write-Host "[^"\n]*quedar como estaba/,
    "«lo deshice» no cuelga de la comprobación")
  // La comprobación mira el disco: VERSION, que no quede ninguna .viejo, que las carpetas estén.
  assert.match(cat, /\$volvio = \(\(Version-Instalada\) -eq \$instalada\)/, "$volvio no arranca de releer VERSION")
  assert.equal((cat.match(/\$volvio = \$false/g) ?? []).length, 2, "la comprobación ya no mira las .viejo y las carpetas")
  assert.doesNotMatch(cat, /\$volvio = \$true/, "$volvio se da por bueno sin mirar")
  // Y si no se pudo deshacer, se dice, y NO se borran las .viejo (pueden ser la única copia buena).
  assert.match(cat, /if \(-not \$volvio\) \{[\s\S]*NO pude dejarlo como estaba[\s\S]*no las borre/, "si no se pudo deshacer no lo dice, o no avisa que conserva las .viejo")
  const fin = PS.slice(PS.indexOf("} finally {", iCatch), pos("if ($fallo) { exit 1 }"))
  assert.doesNotMatch(fin, /viejo/, "el finally borra las .viejo: si el reemplazo falló, eran la copia buena")
})

// Mutación que lo puso rojo: borrar `if (Lanzador-EnUso) { return "en-uso" }` → exit code 1.
// Y en Lanzador-EnUso, `catch { return $false }` → exit code 1.
test("el lanzador se actualiza aparte, y NUNCA mientras un cmd.exe lo está usando", () => {
  const fn = cuerpoFn("Actualizar-Lanzador")
  const iGuarda = fn.indexOf('if (Lanzador-EnUso) { return "en-uso" }')
  assert.ok(iGuarda > 0, "Actualizar-Lanzador ya no mira si el lanzador está en uso")
  for (const escritura of ["Copy-Item", "::Replace("]) {
    assert.ok(fn.indexOf(escritura) > iGuarda, `Actualizar-Lanzador escribe (${escritura}) antes de mirar si el lanzador está en uso`)
  }
  // No crea un lanzador donde no había (una copia que no vino del .exe).
  assert.match(fn, /if \(-not \(Test-Path -LiteralPath \$instalado\)\) \{ return "" \}/, "crea un lanzador en una instalación que no lo tenía")
  // Y relee: «actualizado» sólo si lo que quedó es lo que traía el release.
  assert.match(fn, /\(Get-FileHash -LiteralPath \$nuevo\)\.Hash -eq \(Get-FileHash -LiteralPath \$instalado\)\.Hash\) \{ return "actualizado" \}/, "dice «actualizado» sin releer el archivo")
  // La guarda falla CERRADA: si no se pudo preguntar, se asume que está en uso.
  const guarda = cuerpoFn("Lanzador-EnUso")
  assert.match(guarda, /Get-CimInstance Win32_Process -Filter "Name = 'cmd\.exe'" -ErrorAction Stop/, "ya no pregunta por los cmd.exe")
  assert.match(guarda, /\} catch \{\s*\n\s*return \$true\s*\n\s*\}/, "si no se puede averiguar si el lanzador está en uso, se asume que NO (falla abierta)")
  // Se toma del lugar donde vive en el release y se lleva a la raíz, después de verificar.
  assert.match(PS, /Actualizar-Lanzador \(Join-Path \$extracted\.FullName \("installer\\" \+ \$NombreLanzador\)\) \(Join-Path \$RepoDir \$NombreLanzador\)/,
    "el lanzador no se toma de installer\\ del release para llevarlo a la raíz")
  assert.ok(PS.lastIndexOf("Actualizar-Lanzador (") > PS.lastIndexOf("Verificar-Version -Dir"), "el lanzador se copia antes de verificar lo descargado")
  // Y que NO se haya actualizado no se calla: tiene su aviso al final.
  for (const estado of ["en-uso", "no-pude"]) {
    assert.match(PS, new RegExp(`if \\(\\$ResultadoLanzador -eq "${estado}"\\) \\{[\\s\\S]{0,200}\\[AVISO\\]`), `el resultado «${estado}» del lanzador no se le dice al docente`)
  }
})

// Mutaciones que lo pusieron rojo: borrar `$ProgressPreference = 'SilentlyContinue'`
// → exit code 1; poner `$($_.Exception.Message)` en el Write-Host del catch → exit code 1.
test("la descarga no dibuja la barra de progreso, y de una excepción se informa el TIPO, nunca el mensaje", () => {
  const iPref = pos("$ProgressPreference = 'SilentlyContinue'")
  for (const m of PS.matchAll(/Invoke-(RestMethod|WebRequest)|Expand-Archive/g)) {
    assert.ok(m.index > iPref, `${m[0]} corre antes de apagar la barra de progreso`)
  }
  assert.doesNotMatch(PS, /Exception\.Message|\$_\.Message|\$Error\[0\]/, "update.ps1 imprime (o arma) el mensaje de una excepción: llega al chat con la URL y el proxy")
  assert.match(PS, /\$queFallo = "fallo " \+ \$paso \+ " \(" \+ \$_\.Exception\.GetType\(\)\.Name \+ "\)"/, "el catch ya no informa el paso y el tipo de la excepción")
  // Los motivos propios pasan por Fallar, que los deja en $script:Motivo.
  assert.match(cuerpoFn("Fallar"), /\$script:Motivo = \$texto\s*\n\s*throw/, "Fallar no deja el motivo antes de tirar")
  assert.doesNotMatch(PS.replace(cuerpoFn("Fallar"), "").replace(cuerpoFn("Resolver-UltimoTag"), ""), /\bthrow\b/, "hay un throw que no pasa por Fallar: su texto no llegaría al docente")
})

// Mutaciones que lo pusieron rojo: `if ($CodigoInstall -eq 3) { exit 0 }` → exit code 1;
// mover el borrado de las .viejo arriba de la línea que lanza install.ps1 → exit code 1.
test("el código 3 de install.ps1 se propaga como «actualizado con avisos», y las .viejo se borran al final", () => {
  const iLanza = PS.search(/^powershell -NoProfile[^\n]*install\\install\.ps1/m)
  assert.ok(iLanza > 0, "update.ps1 ya no lanza install.ps1")
  assert.match(PS.slice(iLanza), /^[^\n]*\n\$CodigoInstall = \$LASTEXITCODE/, "el código de install.ps1 no se guarda en la línea siguiente")
  assert.match(PS, /if \(\$CodigoInstall -eq 3\) \{ exit 3 \}\s*\nexit 0\s*$/, "update.ps1 no termina con el 3 de «con avisos» seguido del 0")
  assert.match(PS, /if \(\(\$CodigoInstall -ne 0\) -and \(\$CodigoInstall -ne 3\)\) \{[\s\S]{0,400}exit \$CodigoInstall/, "una falla de install.ps1 ya no corta con su código")
  assert.match(PS, /if \(\$CodigoInstall -eq 3\) \{\s*\n\s*Write-Host "[^"\n]*actualizado CON AVISOS/, "con el 3 no dice «actualizado CON AVISOS»")
  assert.match(PS, /if \(\$CodigoInstall -eq 0\) \{\s*\n\s*Write-Host "==> Tecnia Bot actualizado\./, "«Tecnia Bot actualizado.» no cuelga de que install.ps1 haya salido por 0")
  // Las .viejo (con este mismo script adentro) se borran DESPUÉS de todo lo demás.
  const iBorra = pos("Remove-Item -LiteralPath $vieja -Recurse -Force")
  assert.ok(iBorra > iLanza, "las carpetas .viejo se borran antes de reinstalar la capa")
  assert.equal((PS.match(/Remove-Item -LiteralPath \$vieja/g) ?? []).length, 1, "las .viejo se borran en más de un lugar")
})
