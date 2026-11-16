// Los avisos de «tu key no anda» no pueden mandar a pedirle ayuda al que no
// contesta.
//
// POR QUÉ ESTE ARCHIVO. `install/chequear-clave.ps1` (el aviso del lanzador) e
// `install/install.ps1` terminaban cada aviso de key muerta con «escribí /clave
// adentro del bot». Pero `/clave` lo ejecuta EL MISMO MODELO cuya key está muerta:
// con la cuota agotada o la key rechazada el bot no contesta, y `/clave` tampoco.
// Es el defecto que el propio chequear-clave.ps1 cuenta en su encabezado («le
// estábamos pidiendo AL MODELO que explique que el modelo está muerto»), repetido
// en la salida que ofrecía.
//
// La salida que NO depende del modelo es «Reparar Tecnia Bot», el acceso del menú
// inicio que corre el instalador: pide la key, la prueba y la guarda.
//
// Y un caso que se callaba: el agente en Gemini y NINGUNA key guardada. Es el
// único en que se sabe sin tocar la red que el primer mensaje va a fallar.
//
// UNA EXCEPCIÓN QUE ES A PROPÓSITO, para que nadie la "arregle": con el modelo
// retirado (404), «Reparar» NO sirve —reinstala la versión que ya está— y el aviso
// lo dice así. Lo que sirve ahí es traer una versión nueva sin pasar por el bot.
//
// LÍMITE HONESTO: guardas de FORMA sobre el código SIN comentarios, verificadas
// por mutación (anotadas arriba de cada test). Acá no hay PowerShell.
//
// Corre con: node --test tests/aviso-key-muerta.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const sinComentarios = (t) => t.replace(/^\s*#.*$/gm, "")
const CHEQUEO = sinComentarios(readFileSync(join(REPO, "install/chequear-clave.ps1"), "utf8"))
const INSTALL = sinComentarios(readFileSync(join(REPO, "install/install.ps1"), "utf8"))
const ISS = readFileSync(join(REPO, "installer/tecnia-bot.iss"), "utf8").replace(/^\s*;.*$/gm, "")

/** Un `if` de primer nivel de chequear-clave.ps1: hasta el `}` de columna 0. */
function bloqueChequeo(resultado) {
  const cabecera = `if ($resultado -eq "${resultado}") {`
  const i = CHEQUEO.indexOf(cabecera)
  assert.ok(i >= 0, `chequear-clave.ps1 no tiene el bloque: ${cabecera}`)
  const j = CHEQUEO.indexOf("\n}", i)
  assert.ok(j > i, `el bloque ${cabecera} no cierra`)
  return CHEQUEO.slice(i, j)
}

/** Un `if` de install.ps1 indentado a 4 espacios. */
function bloqueInstall(resultado) {
  const cabecera = `if ($resultadoKey -eq "${resultado}") {`
  const i = INSTALL.indexOf(cabecera)
  assert.ok(i >= 0, `install.ps1 no tiene el bloque: ${cabecera}`)
  const j = INSTALL.indexOf("\n    }", i)
  assert.ok(j > i, `el bloque ${cabecera} no cierra`)
  return INSTALL.slice(i, j)
}

/** Dice que /clave depende del modelo que no está contestando. */
const ADVIERTE = /lo atiende (el|ese) (mismo )?modelo|no va a contestar|no puede contestar/

test("«Reparar Tecnia Bot» existe: es un acceso del menú inicio que corre el instalador", () => {
  // Si el acceso cambiara de nombre, los avisos mandarían a un botón que no está.
  assert.match(ISS, /#define MyAppName "Tecnia Bot"/, "cambió el nombre de la app en el .iss")
  assert.match(ISS, /Name: "\{autoprograms\}\\Reparar \{#MyAppName\}"; Filename: "powershell\.exe"; \\\s*\n\s*Parameters: "[^\n]*bootstrap\.ps1/,
    "el .iss ya no tiene el acceso «Reparar Tecnia Bot» que corre bootstrap.ps1")
})

// Mutaciones que lo pusieron rojo: en el bloque "invalida" de chequear-clave.ps1,
// cambiar 'Reparar Tecnia Bot' por '/clave adentro del bot' → exit code 1; borrar
// del bloque "cuota" la línea «PERO a /clave lo atiende el mismo» → exit code 1.
test("con la key muerta, la salida es Reparar; y si se nombra /clave, se dice que depende del modelo", () => {
  const bloques = [
    ["chequear-clave.ps1 cuota", bloqueChequeo("cuota")],
    ["chequear-clave.ps1 invalida", bloqueChequeo("invalida")],
    ["chequear-clave.ps1 sinKey", bloqueChequeo("sinKey")],
    ["install.ps1 cuota", bloqueInstall("cuota")],
    ["install.ps1 invalida", bloqueInstall("invalida")],
  ]
  assert.equal(bloques.length, 5, "cambió la cantidad de avisos de key muerta")
  for (const [nombre, bloque] of bloques) {
    assert.ok(bloque.length > 100, `${nombre}: el bloque quedó vacío, el extractor no mira nada`)
    assert.match(bloque, /Reparar Tecnia Bot/, `${nombre}: no ofrece «Reparar Tecnia Bot», la única salida que no depende del modelo`)
    assert.match(bloque, /menu inicio/, `${nombre}: no dice dónde está «Reparar Tecnia Bot»`)
    // /clave se puede nombrar, pero nunca como si fuera a andar.
    if (/\/clave/.test(bloque)) {
      assert.match(bloque, ADVIERTE, `${nombre}: manda a /clave sin avisar que lo atiende el modelo que no contesta`)
      // Y Reparar va ANTES: es lo que se lee primero.
      assert.ok(bloque.indexOf("Reparar Tecnia Bot") < bloque.indexOf("/clave"), `${nombre}: ofrece /clave antes que Reparar`)
    }
    assert.doesNotMatch(bloque, /Escribi \/clave|escribi \/clave/, `${nombre}: volvió la instrucción «escribi /clave»`)
  }
})

// Mutación que lo puso rojo: en el bloque "modeloIdo" de chequear-clave.ps1,
// cambiar «'Reparar Tecnia Bot' NO alcanza» por «corre 'Reparar Tecnia Bot'» → exit code 1.
test("con el modelo retirado NO se promete que Reparar lo arregla, y se da una salida que no pasa por el bot", () => {
  for (const [nombre, bloque] of [["chequear-clave.ps1", bloqueChequeo("modeloIdo")], ["install.ps1", bloqueInstall("modeloIdo")]]) {
    assert.match(bloque, /'Reparar Tecnia Bot' NO alcanza/, `${nombre}: no aclara que Reparar no trae una versión nueva`)
    assert.match(bloque, /reinstala la version que ya/, `${nombre}: no dice por qué Reparar no alcanza`)
    assert.match(bloque, /\/actualizar[^\n]*PERO lo atiende ese mismo modelo/, `${nombre}: manda a /actualizar sin avisar que lo atiende el modelo retirado`)
    assert.match(bloque, /instalador nuevo/, `${nombre}: no ofrece bajar el instalador nuevo`)
    // El actualizador a mano se nombra con SU ruta real (al lado del script), no con una escrita a fuego.
    assert.match(bloque, /powershell -NoProfile -ExecutionPolicy Bypass -File `"\$Actualizador(Manual)?`"/, `${nombre}: no da el comando del actualizador`)
    assert.doesNotMatch(bloque, /AppData|LOCALAPPDATA|C:\\/, `${nombre}: la ruta del actualizador está escrita a fuego`)
    assert.doesNotMatch(bloque, /quiero seguir sin key/, `${nombre}: ofrece «seguir sin key» por /clave, que con el modelo retirado no contesta`)
  }
  assert.match(CHEQUEO, /\$Actualizador = Join-Path \$PSScriptRoot "update\.ps1"/, "chequear-clave.ps1 no deriva la ruta del actualizador de su propia carpeta")
  assert.match(INSTALL, /\$ActualizadorManual = Join-Path \$PSScriptRoot "update\.ps1"/, "install.ps1 no deriva la ruta del actualizador de su propia carpeta")
  // En el lanzador el comando se imprime sólo si el archivo está.
  assert.match(bloqueChequeo("modeloIdo"), /if \(Test-Path \$Actualizador\) \{[\s\S]*-File `"\$Actualizador`"/, "chequear-clave.ps1 nombra el actualizador sin mirar si está")
})

// Mutaciones que lo pusieron rojo: `if ($guardada.hay -ne "si") { $resultado = "sinKey" }`
// (avisa también cuando NO SE SABE) → exit code 1; que Read-JsonSinBom devuelva
// "no-existe" en el catch → exit code 1.
test("agente en Gemini y NINGUNA key: se avisa sin tocar la red; si no se sabe, no se dice nada", () => {
  // La decisión: sólo "no" (se miró y no hay) prende el aviso.
  assert.match(CHEQUEO, /if \(\$guardada\.hay -eq "no"\) \{\s*\n\s*\$resultado = "sinKey"\s*\n\s*\}/, "el aviso de «no hay key» no cuelga de haber mirado y no encontrar ninguna")
  assert.equal((CHEQUEO.match(/\$resultado = "sinKey"/g) ?? []).length, 1, "«sinKey» se asigna en más de un lugar")
  assert.match(CHEQUEO, /if \(\$guardada\.hay -eq "si"\) \{\s*\n\s*\$resultado = Probar-KeyGoogle \$guardada\.valor\s*\n\s*\}/, "la prueba contra Google ya no cuelga de que haya una key")
  // Y vive adentro de la guarda del modelo: en una máquina en Big Pickle no se mira nada.
  const iGuarda = CHEQUEO.indexOf("if ($modeloActual -eq $ModeloConKey) {")
  const iFin = CHEQUEO.indexOf("\n} catch {", iGuarda)
  const iSinKey = CHEQUEO.indexOf('$resultado = "sinKey"')
  assert.ok(iGuarda > 0 && iSinKey > iGuarda && iSinKey < iFin, "«sinKey» se decide fuera de la guarda del modelo: avisaría en máquinas que no usan Gemini")
  // Tres estados, y "no pude leer" NO es "no hay".
  const i = CHEQUEO.indexOf("function Get-KeyDeGoogle")
  const fn = CHEQUEO.slice(i, CHEQUEO.indexOf("\n}\n", i))
  assert.match(fn, /if \(\$leido\.estado -eq "ilegible"\) \{ return @\{ hay = "no-se"/, "un auth.json ilegible se cuenta como «no hay key»")
  assert.match(fn, /if \(\$env:GOOGLE_GENERATIVE_AI_API_KEY\) \{ return @\{ hay = "si"/, "la variable de entorno ya no cuenta como key")
  const j = CHEQUEO.indexOf("function Read-JsonSinBom")
  const lector = CHEQUEO.slice(j, CHEQUEO.indexOf("\n}\n", j))
  assert.match(lector, /\} catch \{\s*\n\s*return @\{ estado = "ilegible"/, "un JSON que no parsea ya no devuelve «ilegible»")
  // Lo que promete el aviso es lo que install.ps1 hace: sin key, Reparar deja Big Pickle.
  const aviso = bloqueChequeo("sinKey")
  assert.match(aviso, /NO hay\s*"\s*\n\s*Write-Host "\s*ninguna key de Google guardada|NO hay ninguna key/, "el aviso no dice que no hay ninguna key")
  assert.match(aviso, /Big Pickle/, "el aviso no dice que Reparar sin key deja el modelo gratuito")
  assert.match(INSTALL, /\} else \{\s*\n\s*\$ModeloElegido = \$ModeloSinKey/, "install.ps1 ya no deja Big Pickle cuando no hay key: el aviso promete algo que no pasa")
  assert.doesNotMatch(aviso, /Probar-KeyGoogle|Invoke-WebRequest/, "el aviso de «no hay key» toca la red")
})
