// El diagnóstico no puede decir «OK» de lo que no miró, ni llevarse datos que la
// docente no sabe que está mandando.
//
// POR QUÉ ESTE ARCHIVO. `install/diagnostico.ps1` es lo que se corre cuando algo ya
// falló, y lo que sale se manda por WhatsApp. Tenía seis defectos de la misma
// familia —afirmar de más, o mostrar de más—:
//
//   a. «capa Tecnia Bot: OK» mirando UN archivo (`agent\tecnia-bot.md`) de varios
//      cientos: una instalación cortada a mitad daba OK;
//   b. la ruta de `auth.json` fija a `%USERPROFILE%\.local\share`, ignorando
//      `XDG_DATA_HOME`, que el resto del repo sí honra;
//   c. el tapado de credenciales de proxy (`//[^/@]+@`) escrito dos veces, sin
//      aplicarse a las colas de log de PlatformIO, del bootstrap, de Inno ni de
//      OpenCode, y exigiendo `//`: `usuario:clave@proxy:8080` pasaba entero;
//   d. las últimas cinco detecciones de Defender, las que fueran, con la ruta
//      completa de archivos personales;
//   e. el reporte lleva usuario, nombre de máquina y rutas, y no lo decía;
//   f. «sin override en la config: usa el del archivo del agente (Gemini)» — falso:
//      el frontmatter del agente no declara `model` — y una alarma que trataba
//      «sin modelo» como Gemini.
//
// LÍMITE HONESTO: acá no hay PowerShell. Casi todo son guardas de FORMA sobre el
// código SIN comentarios, verificadas por mutación (anotadas arriba de cada test).
// La excepción es el tapado de credenciales: sus dos expresiones regulares se
// EXTRAEN del .ps1 y se ejecutan acá. Es una prueba real de las expresiones (las
// construcciones que usan valen igual en .NET y en JavaScript), no de PowerShell.
//
// Corre con: node --test tests/diagnostico-honesto.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const sinComentarios = (t) => t.replace(/^\s*#.*$/gm, "")
const PS = sinComentarios(readFileSync(join(REPO, "install/diagnostico.ps1"), "utf8"))

function cuerpoFn(nombre) {
  const i = PS.indexOf(`function ${nombre}`)
  assert.ok(i >= 0, `diagnostico.ps1 no tiene la función ${nombre}`)
  return PS.slice(i, PS.indexOf("\n}\n", i))
}

// Mutaciones que lo pusieron rojo: volver a
// `Dato "capa Tecnia Bot" $(if (Test-Path "$ocDir\agent\tecnia-bot.md") { "OK" } else { "FALTA" })`
// → exit code 1; en la rama «está el agente pero falta el registro», poner
// `$capaEstado = "OK"` → exit code 1.
test("(a) la capa se valida contra el manifest: «N de M archivos; faltan: ...», y se compara la versión", () => {
  assert.match(PS, /\$capaManifest = Join-Path \$ocDir "tecnia-bot\.manifest"/, "ya no lee el registro de la instalación")
  assert.match(PS, /Dato "capa Tecnia Bot" \$capaEstado/, "el renglón de la capa ya no sale del estado calculado")
  // TODAS las asignaciones del estado, y UNA sola dice OK: la que contó que no falta nada.
  const estados = [...PS.matchAll(/\$capaEstado = ([^\n]*)/g)].map((m) => m[1])
  const oks = estados.filter((e) => /"OK/.test(e))
  assert.equal(oks.length, 1, `la capa se da por OK en ${oks.length} lugares; tiene que ser uno solo`)
  assert.match(PS, /\} elseif \(\$capaFaltan\.Count -eq 0\) \{\s*\n\s*\$capaEstado = "OK - " \+ \$capaEstan \+ " de " \+ \$capaArchivos\.Count \+ " archivos"/,
    "el OK de la capa no cuelga de haber contado que no falta ningún archivo")
  // Lo que falta se mira en el DISCO, archivo por archivo del registro.
  assert.match(PS, /\$capaFaltan = @\(\$capaArchivos \| Where-Object \{ -not \(Test-Path -LiteralPath \(Join-Path \$ocDir \$_\)\) \}\)/,
    "los archivos que faltan no salen de mirar el disco contra el registro")
  assert.match(PS, /"INCOMPLETA - " \+ \$capaEstan \+ " de " \+ \$capaArchivos\.Count \+ " archivos; faltan: " \+ \$capaMuestra/, "no dice cuántos hay ni cuáles faltan")
  assert.match(PS, /if \(\$capaResto -gt 0\) \{ \$capaEstado = \$capaEstado \+ " \(y " \+ \$capaResto \+ " mas\)" \}/, "corta la lista de faltantes en silencio")
  // Sin registro: el agente solo NO alcanza para decir OK.
  assert.match(PS, /\} elseif \(Test-Path "\$ocDir\\agent\\tecnia-bot\.md"\) \{\s*\n\s*\$capaEstado = "INCOMPLETA/, "con el agente y sin registro vuelve a decir que la capa está")
  // Las líneas que no son archivos no se cuentan como archivos.
  assert.match(PS, /if \(\$r\.StartsWith\("version="\)\) \{ \$capaVersion = \$r\.Substring\(8\)\.Trim\(\); continue \}/, "la versión del registro no se lee (o se cuenta como archivo)")
  assert.match(PS, /\$r\.StartsWith\("#"\) -or \$r\.StartsWith\("repo_dir="\)\) \{ continue \}/, "el comentario o repo_dir= se cuentan como archivos de la capa")
  // Y la versión de la capa se compara con el VERSION de la copia del programa.
  assert.match(PS, /\$capaVersionArchivo = Join-Path \(Split-Path -Parent \$PSScriptRoot\) "VERSION"/, "el VERSION del programa no se busca al lado de este script")
  assert.match(PS, /if \(\$capaVersion -and \$capaVersionPrograma -and \(\$capaVersion -ne \$capaVersionPrograma\)\) \{\s*\n\s*Write-Host "[^"\n]*NO COINCIDEN/, "no avisa cuando la capa publicada y la copia del programa son de versiones distintas")
})

// Mutación que lo puso rojo: `$auth = "$U\.local\share\opencode\auth.json"` → exit code 1.
test("(b) auth.json y el log de OpenCode se buscan donde OpenCode los pone: XDG_DATA_HOME", () => {
  assert.match(PS, /\$dataDir = "\$U\\\.local\\share\\opencode"\s*\nif \(\$env:XDG_DATA_HOME\) \{ \$dataDir = "\$env:XDG_DATA_HOME\\opencode" \}/, "$dataDir no honra XDG_DATA_HOME")
  assert.match(PS, /\$auth = "\$dataDir\\auth\.json"/, "auth.json no se busca en $dataDir")
  assert.match(PS, /\$oclog = "\$dataDir\\log\\opencode\.log"/, "el log de OpenCode no se busca en $dataDir")
  // Una sola copia de la ruta por defecto en todo el archivo: la de $dataDir.
  const fijas = PS.match(/\.local\\share\\opencode/g) ?? []
  assert.equal(fijas.length, 1, `hay ${fijas.length} rutas a .local\\share\\opencode escritas a fuego; tiene que quedar sólo la de $dataDir`)
  assert.ok(PS.indexOf("$dataDir =") < PS.indexOf("$auth ="), "$dataDir se usa antes de definirse")
})

/** Las dos expresiones de Tapar-Credenciales, sacadas del .ps1 y armadas como RegExp. */
function reglasDeTapado() {
  const fn = cuerpoFn("Tapar-Credenciales")
  const reglas = [...fn.matchAll(/\$t = \[regex\]::Replace\(\$t, '((?:[^']|'')*)', '((?:[^']|'')*)'\)/g)]
    .map((m) => [new RegExp(m[1].replaceAll("''", "'"), "g"), m[2].replaceAll("''", "'")])
  assert.equal(reglas.length, 2, `Tapar-Credenciales tiene ${reglas.length} reglas; se esperaban 2 (con esquema y sin esquema)`)
  return reglas
}
const tapar = (texto) => reglasDeTapado().reduce((t, [re, por]) => t.replace(re, por), texto)

// Mutaciones que lo pusieron rojo: borrar la segunda regla (la de «sin esquema») →
// exit code 1; volver la primera a `//[^/\s@]+@` (cortar en el primer @) → exit code 1.
test("(c) el tapado de credenciales cubre con esquema, SIN esquema, y claves con arroba", () => {
  for (const [entrada, esperado] of [
    // El caso de siempre: la URL del proxy de la escuela.
    ["http://docente:Secreta123@proxy.escuela:8080", "http://USUARIO:CLAVE@proxy.escuela:8080"],
    // SIN ESQUEMA, que es como lo acepta el cuadro de Windows. Antes pasaba entero.
    ["docente:Secreta123@proxy.escuela:8080", "USUARIO:CLAVE@proxy.escuela:8080"],
    // El formato por protocolo del registro de Windows (ProxyServer).
    ["http=docente:Secreta123@proxy:80;https=otro:Clave2@proxy:443", "http=USUARIO:CLAVE@proxy:80;https=USUARIO:CLAVE@proxy:443"],
    // Lo que escribe pip con un índice interno.
    ["Looking in indexes: https://alumno:abc@pypi.interno/simple", "Looking in indexes: https://USUARIO:CLAVE@pypi.interno/simple"],
    // Una clave con arroba adentro: no puede quedar la mitad a la vista.
    ["http://docente:Cl@ve@proxy:8080", "http://USUARIO:CLAVE@proxy:8080"],
    ["error de red: admin:Cl@ve@10.0.0.1 no responde", "error de red: USUARIO:CLAVE@10.0.0.1 no responde"],
  ]) {
    const salida = tapar(entrada)
    assert.equal(salida, esperado, `no tapa bien: ${entrada}`)
    assert.doesNotMatch(salida, /Secreta123|Clave2|abc@|Cl@ve|ve@/, `quedó parte de la credencial a la vista: ${salida}`)
  }
  // Y lo que NO es una credencial queda como estaba: un reporte ilegible no sirve.
  for (const intacto of [
    "INFO  2026-10-14T12:30:45 service=llm level=ERROR msg=timeout",
    "C:\\Users\\ana\\scoop\\apps\\opencode\\current\\opencode.exe",
    "https://pypi.org/simple/platformio/",
    "Process exit code: 1",
    "proxy.escuela:8080",
  ]) {
    assert.equal(tapar(intacto), intacto, `tapa algo que no es una credencial: ${intacto}`)
  }
})

// Mutación que lo puso rojo: en el volcado del log de Inno, volver a
// `ForEach-Object { Write-Host ("     " + $_.Line.Trim()) }` → exit code 1.
test("(c) TODA línea de log que se vuelca pasa por la única función que tapa", () => {
  const fn = cuerpoFn("Linea-DeLog")
  assert.match(fn, /\$l = \(Tapar-Credenciales \$texto\)\.Trim\(\)/, "Linea-DeLog no tapa antes de imprimir")
  assert.ok(fn.indexOf("Tapar-Credenciales") < fn.indexOf("Write-Host"), "Linea-DeLog imprime antes de tapar")
  // Los cinco volcados: log de PlatformIO, errores de OpenCode, resumen del
  // bootstrap, bloque crudo del bootstrap, log de Inno. Se cuentan.
  const usos = [...PS.matchAll(/Linea-DeLog \$(_\.Line|_|linea)\b/g)].map((m) => m[1])
  assert.deepEqual(usos.slice().sort(), ["_", "_", "_", "_.Line", "linea"].sort(), `cambió qué logs pasan por Linea-DeLog: ${usos.join(", ")}`)
  // Y ninguno imprime por su cuenta: fuera de Linea-DeLog no hay Write-Host de una
  // línea leída de un archivo.
  const resto = PS.replace(fn, "")
  assert.doesNotMatch(resto, /Write-Host \("     " \+ \$(_|l|t|linea)\b/, "hay un volcado de log que imprime sin pasar por Linea-DeLog")
  assert.doesNotMatch(resto, /ForEach-Object \{ Write-Host[^\n]*\$_/, "hay un ForEach-Object que imprime líneas crudas")
  // El tapado vive en UN solo lugar.
  assert.equal((PS.match(/USUARIO:CLAVE/g) ?? []).length, 2, "el reemplazo USUARIO:CLAVE está escrito fuera de Tapar-Credenciales")
  assert.ok(!resto.replace(cuerpoFn("Tapar-Credenciales"), "").includes("USUARIO:CLAVE"), "hay un tapado suelto, fuera de la función")
})

// Mutación que lo puso rojo: sacar el `| Where-Object { ... -match $filtroNuestro }`
// de `$amenazas` → exit code 1; imprimir `$a.Resources` en vez de `$recursos` → exit code 1.
test("(d) de Defender se listan sólo las detecciones que nombran a Tecnia Bot o sus programas", () => {
  assert.match(PS, /\$filtroNuestro = "opencode\|scoop\|platformio\|TecniaBot\|tecnia-bot"/, "cambió el filtro de lo que es nuestro")
  assert.match(PS, /\$amenazas = @\(\$todasAmenazas \| Where-Object \{ \("" \+ \(\$_\.Resources -join ","\)\) -match \$filtroNuestro \} \| Select-Object -First 5\)/,
    "las detecciones que se listan no pasan por el filtro")
  // Lo que se imprime de cada detección también está filtrado: una detección
  // puede traer varios archivos, y sólo salen los nuestros.
  assert.match(PS, /\$recursos = @\(\$a\.Resources \| Where-Object \{ \("" \+ \$_\) -match \$filtroNuestro \}\)/, "los recursos de una detección no se filtran")
  const impresas = [...PS.matchAll(/^.*Dato "deteccion".*$/gm)].map((m) => m[0])
  assert.equal(impresas.length, 1, "hay más de un lugar que imprime una detección")
  assert.match(impresas[0], /\(\$recursos -join ","\)/, "se imprime la lista de recursos sin filtrar")
  assert.doesNotMatch(impresas[0], /\$a\.Resources/, "se imprimen todos los recursos de la detección")
  // De las demás se dice cuántas son, y nada más.
  assert.match(PS, /if \(\$otrasAmenazas -gt 0\) \{ Dato "otras detecciones" \("" \+ \$otrasAmenazas \+/, "las detecciones que no se listan no se cuentan")
  // Las exclusiones de ruta, con el mismo criterio.
  assert.match(PS, /\$exclusionesNuestras = @\(\$exclusiones \| Where-Object \{ \("" \+ \$_\) -match \$filtroNuestro \}\)/, "las exclusiones de ruta se vuelcan sin filtrar")
  assert.doesNotMatch(PS, /\$pref\.ExclusionPath -join/, "se vuelcan todas las exclusiones de ruta")
})

// Mutación que lo puso rojo: borrar la llamada a Aviso-DatosDelReporte de arriba
// (la que sigue al título) → exit code 1.
test("(e) el reporte dice qué datos lleva, al principio y al final", () => {
  const fn = cuerpoFn("Aviso-DatosDelReporte")
  assert.match(fn, /nombre de usuario de Windows/, "el aviso no nombra el usuario")
  assert.match(fn, /nombre de esta compu/, "el aviso no nombra la máquina")
  assert.match(fn, /rutas/, "el aviso no nombra las rutas")
  assert.match(fn, /NO lleva tu API key/, "el aviso no aclara que la key no viaja")
  const llamadas = [...PS.matchAll(/^\s*Aviso-DatosDelReporte\s*$/gm)].map((m) => m.index)
  assert.equal(llamadas.length, 3, `Aviso-DatosDelReporte se llama ${llamadas.length} veces; se esperaban 3 (al principio, y al final en las dos ramas)`)
  // La primera, ANTES de imprimir el primer dato (y adentro del transcript).
  const iPrimerDato = PS.indexOf('Dato "Version instalada"')
  assert.ok(llamadas[0] < iPrimerDato && llamadas[0] > PS.indexOf("Start-Transcript"), "el aviso del principio no va antes del primer dato del reporte")
  // Las otras dos, al final: una por rama de «se pudo guardar / no se pudo».
  const iFinal = PS.indexOf("if ($GuardaOK) {")
  assert.ok(llamadas[1] > iFinal && llamadas[2] > iFinal, "falta el aviso del final")
  assert.ok(llamadas[1] < PS.indexOf("} else {", iFinal) && llamadas[2] > PS.indexOf("} else {", iFinal), "el aviso del final no está en las dos ramas")
})

// Mutaciones que lo pusieron rojo: volver la alarma a
// `($modelo -like "google/*" -or ($cfgParsea -and -not $modelo))` → exit code 1;
// volver el texto a «usa el del archivo del agente (Gemini)» → exit code 1.
test("(f) «sin modelo» no es Gemini: ni el texto lo dice ni la alarma lo supone", () => {
  // La premisa, verificada contra el archivo real: el agente NO declara modelo.
  const agente = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
  const frontmatter = agente.slice(0, agente.indexOf("\n---", 4))
  assert.doesNotMatch(frontmatter, /^model\s*:/m, "el agente ahora declara `model`: revisar el texto del diagnóstico, que dice que no")
  assert.doesNotMatch(PS, /usa el del archivo del agente|\(Gemini\)/, "volvió el mensaje falso: el archivo del agente no declara ningún modelo")
  assert.match(PS, /Dato "modelo de tecnia-bot" "SIN MODELO escrito en la config: usa el modelo por defecto de OpenCode/, "no dice qué pasa cuando no hay modelo escrito")
  // La alarma de «Gemini sin key» mira SÓLO un modelo de Google, y cuenta la key de los dos lugares.
  const alarma = PS.match(/^if \(([^\n]*)\) \{\s*\n\s*Write-Host "[^"\n]*El agente apunta a Gemini y NO hay key de Google/m)
  assert.ok(alarma, "no encuentro la alarma de «Gemini sin key»")
  assert.equal(alarma[1], '-not $hayKey -and -not $envKey -and ($modelo -like "google/*")', "cambió la condición de la alarma de «Gemini sin key»")
  assert.doesNotMatch(alarma[1], /cfgParsea|-not \$modelo/, "la alarma vuelve a tratar «sin modelo» como Gemini")
  // «Sin modelo» tiene su propio aviso, que no afirma ninguna falla que no se miró.
  assert.match(PS, /if \(\$cfgParsea -and -not \$modelo\) \{\s*\n\s*Write-Host "[^"\n]*La config no dice que modelo usa tecnia-bot/, "«sin modelo» ya no tiene su aviso propio")
})
