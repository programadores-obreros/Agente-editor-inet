// Los JSON de OpenCode se leen COMO SE ESCRIBEN: en UTF-8.
//
// POR QUÉ ESTE ARCHIVO. El caso real del repo es la usuaria `Dirección310` (la
// misma que mudó a PlatformIO a la raíz del disco). `install/install.ps1` escribe
// sus JSON en UTF-8 sin BOM y mete rutas absolutas del perfil en `instructions`
// de opencode.json. Pero los LEÍA con `Get-Content $path -Raw`, sin `-Encoding`, y
// Windows PowerShell 5.1 lee un archivo sin BOM con la codepage ANSI de la
// máquina: la «ó» (dos bytes en UTF-8) volvía como «Ã³».
//
// En la segunda corrida (Reparar, /actualizar) la ruta leída ya no era igual a
// `$PerfilFile`, `-notcontains` daba verdadero, se agregaba la ruta OTRA VEZ y la
// rota se reescribía doblemente codificada. Cada corrida sumaba dos rutas a
// archivos que no existen. `uninstall.ps1` tenía el espejo: `-ieq $PerfilFile` no
// coincidía y las rutas no se sacaban nunca. Con un usuario ASCII no pasa nada, y
// por eso la VM no lo mostró.
//
// LÍMITE HONESTO: acá no hay PowerShell y la CI de Linux no puede crear un
// usuario con tilde. Son guardas de FORMA sobre el código SIN comentarios,
// verificadas por mutación (cada una anotada arriba de su test). El experimento
// real es el de la VM con un perfil no-ASCII, y está en el informe de la tarea.
//
// Corre con: node --test tests/json-utf8-windows.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const sinComentarios = (t) => t.replace(/^\s*#.*$/gm, "")
const codigoDe = (f) => sinComentarios(readFileSync(join(REPO, "install", f), "utf8"))

const INSTALL = codigoDe("install.ps1")
const UNINSTALL = codigoDe("uninstall.ps1")

/** Cuerpo de una función de PowerShell de primer nivel: hasta el `}` de columna 0. */
function cuerpo(codigo, nombre, archivo) {
  const i = codigo.indexOf(`function ${nombre}`)
  assert.ok(i >= 0, `${archivo} no tiene la función ${nombre}`)
  const j = codigo.indexOf("\n}\n", i)
  assert.ok(j > i, `${archivo}: la función ${nombre} no cierra`)
  return codigo.slice(i, j)
}

// Mutación que lo puso rojo: en Read-JsonObject de install.ps1, volver a
// `$raw = Get-Content $path -Raw -ErrorAction SilentlyContinue` → exit code 1.
test("install.ps1 y uninstall.ps1 no leen NINGÚN json con Get-Content (codepage ANSI en PowerShell 5.1)", () => {
  // Se recolectan TODOS los Get-Content y se afirma sobre el total: lo único que
  // puede leerse así es lo que NO es un JSON de OpenCode (el VERSION, que es ASCII,
  // y el manifest, que este script escribe CON BOM y por eso se lee bien).
  const permitidos = { "install.ps1": ["$VerFile", "$Manifest"], "uninstall.ps1": ["$Manifest"] }
  for (const [archivo, codigo] of [["install.ps1", INSTALL], ["uninstall.ps1", UNINSTALL]]) {
    const usos = [...codigo.matchAll(/Get-Content\s+(\S+)/g)].map((m) => m[1])
    assert.deepEqual(usos.slice().sort(), permitidos[archivo].slice().sort(),
      `${archivo}: cambió qué se lee con Get-Content. Un JSON leído así vuelve roto con un usuario con tilde: ${usos.join(", ")}`)
    assert.doesNotMatch(codigo, /Get-Content[^\n]*ConvertFrom-Json/, `${archivo} parsea JSON salido de Get-Content`)
    // La función que lee, lee en UTF-8 explícito.
    assert.match(cuerpo(codigo, "Leer-TextoUtf8", archivo),
      /\[System\.IO\.File\]::ReadAllText\(\$ruta, \(New-Object System\.Text\.UTF8Encoding \$false\)\)/,
      `${archivo}: Leer-TextoUtf8 no lee con UTF8Encoding explícito`)
    // Y las lecturas de JSON pasan por ella.
    for (const fn of ["Read-JsonObject"]) {
      assert.match(cuerpo(codigo, fn, archivo), /\$raw = Leer-TextoUtf8 \$path/, `${archivo}: ${fn} no lee con Leer-TextoUtf8`)
    }
  }
  assert.match(cuerpo(INSTALL, "Test-HasContent", "install.ps1"), /\$raw = Leer-TextoUtf8 \$path/, "Test-HasContent no lee con Leer-TextoUtf8")
  assert.match(cuerpo(UNINSTALL, "Get-EstadoKeyAuth", "uninstall.ps1"), /\$raw = Leer-TextoUtf8 \$path/, "Get-EstadoKeyAuth no lee en UTF-8")
})

// Mutación que lo puso rojo: en Test-HasContent, `catch { return $false }` → exit code 1.
test("un JSON que existe y NO SE PUDO LEER no pasa por vacío (no se reescribe desde cero)", () => {
  // Antes el error de lectura se tragaba (-ErrorAction SilentlyContinue), $raw
  // quedaba vacío, y el archivo se trataba como ausente: se lo reescribía con sólo
  // lo nuestro, pisando la config del docente sin haberla visto.
  assert.match(cuerpo(INSTALL, "Test-HasContent", "install.ps1"),
    /try \{ \$raw = Leer-TextoUtf8 \$path \} catch \{ return \$true \}/,
    "install.ps1: un archivo de config ilegible vuelve a contar como vacío")
  assert.match(UNINSTALL, /try \{ \$ocTieneTexto = \(\(Leer-TextoUtf8 \$OpencodeJson\) -match '\\S'\) \} catch \{ \$ocTieneTexto = \$true \}/,
    "uninstall.ps1: un opencode.json ilegible vuelve a contar como vacío")
})

// Mutaciones que lo pusieron rojo: sacar `-and -not (Test-Path -LiteralPath $entrada)`
// de la condición de install.ps1 → exit code 1; cambiar `-ccontains` por
// `-match` → exit code 1.
test("la cura de las rutas mal codificadas saca SÓLO la basura propia, nunca una entrada del docente", () => {
  // La cura es la parte peligrosa: borra entradas de la config del usuario. Sólo
  // puede salir lo que cumple LAS DOS cosas: es exactamente una forma rota de
  // NUESTRA ruta, y no existe un archivo con ese nombre.
  for (const [archivo, codigo, variable] of [["install.ps1", INSTALL, "$entrada"], ["uninstall.ps1", UNINSTALL, "$_"]]) {
    const fn = cuerpo(codigo, "Get-VariantesMalLeidas", archivo)
    assert.match(fn, /\$ansi = \[System\.Text\.Encoding\]::Default/, `${archivo}: las variantes no se calculan con la codepage de la máquina`)
    assert.match(fn, /\$ansi\.GetString\(\$utf8\.GetBytes\(\$actual\)\)/, `${archivo}: no reproduce "escribir en UTF-8, leer como ANSI"`)
    assert.match(fn, /if \(\$siguiente -ceq \$actual\) \{ break \}/, `${archivo}: con una ruta ASCII tiene que no devolver nada`)
    // Las variantes salen SÓLO de nuestras dos rutas.
    assert.match(codigo, /\$rotas = @\(Get-VariantesMalLeidas \$PerfilFile\) \+ @\(Get-VariantesMalLeidas \$MemoriaFile\)/,
      `${archivo}: la lista de rutas rotas no sale de las dos rutas propias`)
    const llamadas = [...codigo.matchAll(/Get-VariantesMalLeidas \$(\w+)/g)].map((m) => m[1])
    assert.deepEqual(llamadas, ["PerfilFile", "MemoriaFile"], `${archivo}: se calculan variantes de algo que no es nuestro: ${llamadas.join(", ")}`)
    // Y la condición que saca: igualdad exacta + el archivo no existe.
    const v = variable.replace("$", "\\$")
    assert.match(codigo, new RegExp(`\\(\\$rotas -ccontains ${v}\\) -and -not \\(Test-Path -LiteralPath ${v}\\)`),
      `${archivo}: la cura saca entradas sin exigir igualdad exacta Y que el archivo no exista`)
  }
  // En install.ps1 sólo se reemplaza la lista si de verdad se sacó algo, y se dice.
  assert.match(INSTALL, /if \(\$sacadas -gt 0\) \{\s*\n\s*\$instrucciones = \$sanas\s*\n\s*Write-Host/, "install.ps1 cura en silencio, o reemplaza la lista sin haber sacado nada")
})
