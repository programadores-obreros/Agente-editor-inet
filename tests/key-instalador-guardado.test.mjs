// QUÉ SE HACE con la key que el docente pega en el instalador de Windows, y qué se
// DICE que se hizo. Complementa a `key-instalador.test.mjs`, que custodia la
// clasificación de la respuesta de Google; acá se custodia lo que viene después.
//
// POR QUÉ ESTE ARCHIVO. `install/install.ps1` guardaba TODO lo que no fuera un
// rechazo explícito de Google, incluido «no pude probarla». En una escuela con la
// red filtrada (que es donde se instala) eso daba este recorrido:
//
//   - la compu ya tiene una key que anda;
//   - la docente corre «Reparar», pega mal una key nueva (o pega otra cosa);
//   - Google no contesta → `sinProbar` → la key nueva PISA a la que andaba, sin copia;
//   - y más abajo se imprime «la key quedó donde estaba: no se tocó nada».
//
// Un OK falso arriba de una pérdida real. Ahora: si ya había una key y la nueva
// no se pudo probar, NO se reemplaza y se dice exactamente eso (es lo que hace
// `clave.ts`); si no había ninguna, se guarda sin probar (es lo que hace
// `install.sh`, y no hay nada que perder) y se dice que quedó guardada SIN probar.
//
// Además: `Leer-KeyConTimeout` le pegaba a la key el `KeyChar` de cualquier tecla
// —una flecha o un F5 aportan el carácter nulo—, y no había ningún chequeo de
// forma antes de gastar una prueba (y, sin red, de guardar lo que fuera).
//
// LÍMITE HONESTO: son guardas de FORMA sobre el código SIN comentarios; acá no hay
// PowerShell ni teclado. Verificadas por mutación — cada mutación está anotada
// arriba de su test. La conducta real se prueba en la VM (ver el informe).
//
// Corre con: node --test tests/key-instalador-guardado.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const sinComentarios = (t) => t.replace(/^\s*#.*$/gm, "")
const PS = sinComentarios(readFileSync(join(REPO, "install/install.ps1"), "utf8"))

/** La rama «pegó una key»: desde `} elseif ($keyFinal) {` hasta el `} else {` del silencio. */
function ramaPegoKey() {
  const desde = PS.indexOf("} elseif ($keyFinal) {")
  assert.ok(desde > 0, "install.ps1 ya no tiene la rama `elseif ($keyFinal)`")
  const hasta = PS.indexOf("\n} else {", desde)
  assert.ok(hasta > desde, "no encuentro el final de la rama «pegó una key»")
  return { desde, hasta, texto: PS.slice(desde, hasta) }
}

/** Un bloque `if (...) { ... }` indentado a `sangria` espacios, desde su cabecera hasta su cierre. */
function bloque(texto, cabecera, sangria) {
  const i = texto.indexOf(cabecera)
  assert.ok(i >= 0, `no encuentro el bloque: ${cabecera}`)
  const j = texto.indexOf("\n" + " ".repeat(sangria) + "}", i)
  assert.ok(j > i, `el bloque ${cabecera} no cierra a ${sangria} espacios`)
  return texto.slice(i, j)
}

// Mutación que lo puso rojo: `if (-not $rechazada) {` en vez de
// `if (-not $rechazada -and -not $sinProbarConOtraGuardada) {` → exit code 1.
// Y `$sinProbarConOtraGuardada = ($pruebaNueva.resultado -eq "sinProbar")` (sin
// mirar $tieneGoogle) → exit code 1.
test("con una key ya guardada, una key nueva que NO SE PUDO PROBAR no la reemplaza", () => {
  const { texto } = ramaPegoKey()
  assert.match(texto, /\$sinProbarConOtraGuardada = \(\$tieneGoogle -and \(\$pruebaNueva\.resultado -eq "sinProbar"\)\)/,
    "cambió la condición: tiene que ser «había una key» Y «la nueva no se pudo probar»")
  // TODAS las escrituras de la key viven adentro del bloque que mira las dos condiciones.
  const guardado = bloque(texto, "if (-not $rechazada -and -not $sinProbarConOtraGuardada) {", 8)
  const iGuardado = texto.indexOf(guardado)
  const escrituras = [...texto.matchAll(/Add-Member -NotePropertyName "google"|SetEnvironmentVariable\("GOOGLE_GENERATIVE_AI_API_KEY", \$keyFinal|\$tieneGoogle = \$true/g)]
  assert.ok(escrituras.length >= 3, `esperaba al menos tres escrituras (auth.json, variable, $tieneGoogle) y hay ${escrituras.length}`)
  for (const e of escrituras) {
    assert.ok(e.index > iGuardado && e.index < iGuardado + guardado.length,
      `se escribe la key fuera del bloque que exige «no rechazada y no sin-probar-con-otra-guardada»: ${e[0]}`)
  }
  // La condición se calcula con el $tieneGoogle de ANTES de guardar: si se
  // calculara después, valdría siempre verdadero para un `sinProbar`.
  assert.ok(texto.indexOf("$sinProbarConOtraGuardada = (") < texto.indexOf("$tieneGoogle = $true"),
    "la condición se calcula después de guardar")
  // Y se le DICE a la docente, sin afirmar nada de la key nueva.
  const aviso = bloque(texto, "if ($sinProbarConOtraGuardada) {", 8)
  assert.match(aviso, /NO pude probar contra Google la key que pegaste/, "no dice que no pudo probar la key nueva")
  assert.match(aviso, /NO se si anda/, "no aclara que no sabe si anda")
  assert.match(aviso, /NO la reemplace: quedo la que estaba, sin tocar/, "no dice que la key anterior quedó sin tocar")
  assert.doesNotMatch(aviso, /guardada en esta compu|respondio bien|\[OK\]/, "el aviso de «no la reemplacé» afirma un guardado o un OK")
  assert.doesNotMatch(aviso, /WriteAllText|SetEnvironmentVariable|Add-Member/, "el bloque que dice «no la reemplacé» escribe algo")
})

// Mutación que lo puso rojo: dejar el Write-Host de «no se toco nada» suelto,
// fuera de `if (-not $GuardadaSinProbar) { }` → exit code 1.
test("el cajón de «no pude probarla» dice lo que PASÓ con la key: «no se tocó nada» sólo si no se tocó", () => {
  const i = PS.indexOf('if ($resultadoKey -ne "anda" -and')
  assert.ok(i > 0, "no encuentro el cajón de «no pude probarla»")
  const cajon = PS.slice(i, PS.indexOf("\n    }", i))
  // Cada línea del cajón que afirma algo sobre la key cuelga de la bandera que
  // dice si en esta corrida se guardó una sin probar.
  const noSeToco = bloque(cajon, "if (-not $GuardadaSinProbar) {", 8)
  const seGuardo = bloque(cajon, "if ($GuardadaSinProbar) {", 8)
  assert.match(noSeToco, /no se toco nada/, "la frase «no se toco nada» ya no está en la rama donde es verdad")
  assert.match(seGuardo, /QUEDO GUARDADA igual, sin probar/, "cuando se guardó sin probar no lo dice")
  assert.equal((cajon.match(/no se toco nada/g) ?? []).length, 1, "«no se toco nada» aparece más de una vez en el cajón")
  const iFrase = cajon.indexOf("no se toco nada")
  const iRama = cajon.indexOf("if (-not $GuardadaSinProbar) {")
  assert.ok(iFrase > iRama, "«no se toco nada» se imprime ANTES de mirar si se guardó algo (es incondicional)")
  assert.ok(cajon.indexOf("\n        }", iRama) > iFrase, "«no se toco nada» quedó afuera de su rama")
  // La bandera se prende en UN solo lugar: adentro del guardado, y sólo con sinProbar.
  const prendidas = [...PS.matchAll(/\$GuardadaSinProbar = \$true/g)]
  assert.equal(prendidas.length, 1, `$GuardadaSinProbar se prende ${prendidas.length} veces; tiene que ser una`)
  const { desde, hasta } = ramaPegoKey()
  assert.ok(prendidas[0].index > desde && prendidas[0].index < hasta, "la bandera se prende fuera de la rama «pegó una key»")
  assert.match(PS, /if \(\$pruebaNueva\.resultado -eq "sinProbar"\) \{ \$GuardadaSinProbar = \$true \}/,
    "la bandera se prende sin mirar que el resultado haya sido sinProbar")
  assert.match(PS, /\$GuardadaSinProbar = \$false/, "la bandera no arranca en falso")
})

// Mutación que lo puso rojo: volver a `$key += $charInfo.KeyChar` a secas → exit code 1.
test("Leer-KeyConTimeout no le pega a la key caracteres de control (flechas, F1..F12, nulos)", () => {
  const i = PS.indexOf("function Leer-KeyConTimeout")
  const fn = PS.slice(i, PS.indexOf("\n}\n", i))
  const sumas = [...fn.matchAll(/^.*\$key \+= .*$/gm)].map((m) => m[0].trim())
  assert.deepEqual(sumas, ["if (-not [char]::IsControl($charInfo.KeyChar)) { $key += $charInfo.KeyChar }"],
    "la key se arma con algún KeyChar sin filtrar (o cambió la forma): " + sumas.join(" | "))
  // Y lo que llega por un pipe también se limpia antes del Trim.
  assert.match(fn, /\$limpia = \(\[regex\]::Replace\(\[string\]\$key, '\[\\x00-\\x1F\\x7F\]', ''\)\)\.Trim\(\)/,
    "lo leído no pasa por el filtro de caracteres de control antes de devolverse")
})

// Mutación que lo puso rojo: `if ($true) {` en vez de `if ($formaValida) {` → exit code 1.
test("lo que no tiene forma de key no se prueba ni se guarda", () => {
  const i = PS.indexOf("function Test-FormaDeKey")
  assert.ok(i > 0, "install.ps1 ya no tiene Test-FormaDeKey")
  const fn = PS.slice(i, PS.indexOf("\n}\n", i))
  // ASCII visible, sin espacios: lo que puede viajar en el header x-goog-api-key.
  assert.match(fn, /-cmatch '\^\[\\x21-\\x7E\]\+\$'/, "cambió el criterio de forma: es «sólo ASCII visible, sin espacios»")
  const { texto } = ramaPegoKey()
  assert.match(texto, /\$formaValida = Test-FormaDeKey \$keyFinal/, "la rama «pegó una key» no mira la forma")
  const conForma = bloque(texto, "if ($formaValida) {", 4)
  const iConForma = texto.indexOf(conForma)
  for (const [patron, que] of [
    [/Probar-KeyGoogle \$keyFinal/g, "la prueba contra Google"],
    [/Add-Member -NotePropertyName "google"/g, "la escritura de auth.json"],
    [/SetEnvironmentVariable\("GOOGLE_GENERATIVE_AI_API_KEY", \$keyFinal/g, "la escritura de la variable"],
  ]) {
    const usos = [...texto.matchAll(patron)]
    assert.ok(usos.length >= 1, `no encuentro ${que}`)
    for (const u of usos) {
      assert.ok(u.index > iConForma && u.index < iConForma + conForma.length, `${que} corre aunque lo pegado no tenga forma de key`)
    }
  }
  const sinForma = bloque(texto, "if (-not $formaValida) {", 4)
  assert.match(sinForma, /No la probe ni la guarde/, "cuando lo pegado no tiene forma de key no dice que no lo guardó")
  assert.doesNotMatch(sinForma, /WriteAllText|SetEnvironmentVariable|Add-Member|Probar-KeyGoogle/, "la rama «no tiene forma» prueba o escribe algo")
})

// ---------------------------------------------------------------------------
// GUARDAR la key como la guarda clave.ts: atómico, con relectura, y sin pisar un
// auth.json que no se pudo leer.
//
// `[OK] Key guardada en esta compu.` se imprimía sin volver a mirar el archivo, la
// escritura era un WriteAllText directo (si la notebook se apaga en el medio queda
// a medias y NINGUNA credencial funciona), y un auth.json que no parseaba se
// trataba como vacío: al guardar se escribía ese vacío más la key, y las
// credenciales de los otros servicios del docente desaparecían sin aviso.
// ---------------------------------------------------------------------------

/** Cuerpo de una función de primer nivel. */
function cuerpoFn(nombre) {
  const i = PS.indexOf(`function ${nombre}`)
  assert.ok(i >= 0, `install.ps1 no tiene la función ${nombre}`)
  const j = PS.indexOf("\n}\n", i)
  assert.ok(j > i, `la función ${nombre} no cierra`)
  return PS.slice(i, j)
}

// Mutaciones que lo pusieron rojo: sacar la condición y dejar
// `$guardadaVerificada = $true` suelto → exit code 1; mover el Write-Host del
// "[OK]" arriba de `if ($guardadaVerificada) {` → exit code 1.
test("«[OK] Key guardada» sale SÓLO si al releer auth.json la key que hay es la que se quiso guardar", () => {
  const { texto } = ramaPegoKey()
  const oks = [...PS.matchAll(/^.*\[OK\] Key guardada.*$/gm)]
  assert.equal(oks.length, 1, `esperaba UNA afirmación de «[OK] Key guardada» y hay ${oks.length}`)
  const verificado = bloque(texto, "if ($guardadaVerificada) {", 12)
  assert.match(verificado, /\[OK\] Key guardada/, "el «[OK] Key guardada» no cuelga de la relectura")
  // La bandera se prende en UN lugar, y ese lugar es la comparación de lo releído.
  const prendidas = [...texto.matchAll(/\$guardadaVerificada = \$true/g)]
  assert.equal(prendidas.length, 1, `$guardadaVerificada se prende ${prendidas.length} veces`)
  const relectura = bloque(texto, 'if (($releido.estado -eq "ok") -and ((Get-KeyDeAuth $releido.datos) -ceq $keyFinal)) {', 16)
  assert.match(relectura, /\$guardadaVerificada = \$true/, "la bandera no se prende adentro de la comparación de lo releído")
  // Orden: escribir → releer → comparar. Y arranca en falso.
  const iEscribe = texto.indexOf("Escribir-TextoAtomico $AuthFile ($candidato")
  const iRelee = texto.indexOf("$releido = Leer-AuthJson $AuthFile")
  assert.ok(iEscribe > 0 && iRelee > iEscribe, "auth.json no se relee DESPUÉS de escribirlo")
  assert.ok(texto.indexOf("$guardadaVerificada = $false") < iEscribe, "la bandera no arranca en falso antes de escribir")
  // Lo que depende de que la key haya quedado, cuelga de la misma bandera.
  for (const dep of ['SetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", $keyFinal', "$tieneGoogle = $true", "$pruebaKey = $pruebaNueva"]) {
    assert.ok(verificado.includes(dep), `«${dep}» corre aunque la key no haya quedado guardada`)
  }
  // Y la rama de fracaso lo dice sin vueltas.
  const fracaso = bloque(texto, "if (-not $guardadaVerificada) {", 12)
  assert.match(fracaso, /NO pude guardar la key/, "si no quedó guardada no lo dice")
  assert.match(fracaso, /no quedo/, "no aclara que NO quedó guardada")
  assert.doesNotMatch(fracaso, /\[OK\]/, "la rama de fracaso imprime un OK")
})

// Mutación que lo puso rojo: reemplazar la llamada del guardado por
// `[System.IO.File]::WriteAllText($AuthFile, ($candidato | ConvertTo-Json -Depth 10), ...)` → exit code 1.
test("la key se escribe de forma ATÓMICA: temporal en la misma carpeta y reemplazo", () => {
  const fn = cuerpoFn("Escribir-TextoAtomico")
  // El temporal se arma PEGADO a la ruta de destino: misma carpeta, mismo disco.
  assert.match(fn, /\$temporal = \$ruta \+ "\." \+ \$PID \+ "\.tmp"/, "el temporal no vive al lado del destino (un rename entre discos no es atómico)")
  assert.doesNotMatch(fn, /\$env:TEMP|GetTempPath|GetTempFileName/, "el temporal se fue a la carpeta TEMP: puede ser otro disco")
  assert.match(fn, /WriteAllText\(\$temporal, \$texto, \(New-Object System\.Text\.UTF8Encoding \$false\)\)/, "el temporal no se escribe en UTF-8 sin BOM")
  assert.match(fn, /\[System\.IO\.File\]::Replace\(\$temporal, \$ruta, \[NullString\]::Value\)/, "no reemplaza el destino con File.Replace")
  assert.match(fn, /\[System\.IO\.File\]::Move\(\$temporal, \$ruta\)/, "sin destino previo no mueve el temporal")
  assert.doesNotMatch(fn, /WriteAllText\(\$ruta/, "escribe directo sobre el destino")
  assert.match(fn, /catch \{[\s\S]*Remove-Item -LiteralPath \$temporal[\s\S]*throw/, "si falla, deja el temporal tirado o se traga el error")
  // Sobre auth.json queda UNA sola escritura directa: la cura del BOM, que es
  // anterior a todo esto y reescribe el mismo contenido. Las que cambian
  // credenciales (guardar la key, purgar la vieja) van por la atómica.
  const directas = [...PS.matchAll(/WriteAllText\(\$AuthFile/g)]
  assert.equal(directas.length, 1, `hay ${directas.length} escrituras directas sobre auth.json; tiene que quedar sólo la cura del BOM`)
  assert.ok(directas[0].index < PS.indexOf("function Leer-AuthJson"), "la escritura directa que queda no es la cura del BOM")
  const atomicas = [...PS.matchAll(/Escribir-TextoAtomico \$AuthFile /g)]
  assert.equal(atomicas.length, 2, `esperaba dos escrituras atómicas de auth.json (purga y guardado) y hay ${atomicas.length}`)
})

// Mutaciones que lo pusieron rojo: en Leer-AuthJson, que el catch de
// ConvertFrom-Json devuelva `estado = "no-existe"` → exit code 1; sacar el
// `if ($enDisco.estado -ne "ilegible") {` (dejar `if ($true) {`) → exit code 1.
test("un auth.json que NO SE PUDO LEER no se trata como vacío y no se pisa", () => {
  const fn = cuerpoFn("Leer-AuthJson")
  assert.match(fn, /try \{ \$texto = Leer-TextoUtf8 \$ruta \} catch \{ return @\{ estado = "ilegible"/, "un archivo que no se pudo abrir no devuelve «ilegible»")
  assert.match(fn, /try \{ \$objeto = \$texto \| ConvertFrom-Json \} catch \{ return @\{ estado = "ilegible"/, "un JSON roto no devuelve «ilegible»")
  assert.match(fn, /if \(-not \(\$objeto -is \[PSCustomObject\]\)\) \{ return @\{ estado = "ilegible"/, "un JSON que no es un objeto no devuelve «ilegible»")
  // Con ilegible: se avisa, no se pregunta la key, y no se escribe.
  assert.match(PS, /\$AuthIlegible = \(\$lecturaAuth\.estado -eq "ilegible"\)/, "ya no se calcula $AuthIlegible")
  assert.match(PS, /if \(\$AuthIlegible\) \{\s*\n\s*\$preguntar = \$false\s*\n\}/, "con auth.json ilegible igual se pregunta la key (que después no se puede guardar)")
  assert.match(PS, /if \(\$AuthIlegible\) \{[\s\S]{0,200}NO LO TOCO/, "con auth.json ilegible no avisa que no lo toca")
  // Y en el guardado, por si el archivo se rompió mientras se esperaba la respuesta:
  // la escritura vive adentro de la guarda que mira lo que hay AHORA en el disco.
  const { texto } = ramaPegoKey()
  const legible = bloque(texto, 'if ($enDisco.estado -ne "ilegible") {', 12)
  const iLegible = texto.indexOf(legible)
  for (const m of texto.matchAll(/Escribir-TextoAtomico \$AuthFile|Add-Member -NotePropertyName "google"/g)) {
    assert.ok(m.index > iLegible && m.index < iLegible + legible.length, `«${m[0]}» corre aunque auth.json esté ilegible: pisa las otras credenciales`)
  }
  // El objeto que se escribe sale de lo releído del disco, no de un vacío a ciegas.
  assert.match(legible, /\$candidato = \$enDisco\.datos/, "lo que se escribe no parte de lo que hay en el disco")
})
