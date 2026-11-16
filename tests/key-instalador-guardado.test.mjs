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
