// El borrado de huérfanos de `install/install.ps1` no puede borrar un archivo que
// acaba de copiar.
//
// POR QUÉ ESTE ARCHIVO. Al reinstalar, install.ps1 borra lo que el manifest viejo
// lista y la versión nueva ya no trae. Lo decidía con un `HashSet[string]`
// sensible a mayúsculas. NTFS no lo es: si entre dos versiones un archivo cambia
// SÓLO de mayúsculas (`tool\Foo.ts` → `tool\foo.ts`), el nombre viejo «no está»
// en lo nuevo, se lo toma por huérfano, y `Remove-Item` borra el archivo recién
// copiado — porque para Windows los dos nombres son el mismo archivo.
//
// LÍMITE HONESTO: guarda de FORMA sobre el código SIN comentarios, verificada por
// mutación. Acá no hay NTFS; el experimento real está en el informe de la tarea.
//
// Corre con: node --test tests/instalador-huerfanos.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const PS = readFileSync(join(REPO, "install/install.ps1"), "utf8").replace(/^\s*#.*$/gm, "")

// Mutación que lo puso rojo: volver a
// `[System.Collections.Generic.HashSet[string]]::new([string[]]$Nuevos)` → exit code 1.
test("el conjunto de archivos nuevos compara sin distinguir mayúsculas, como NTFS", () => {
  const armados = [...PS.matchAll(/\$NuevosSet = ([^\n]*)/g)].map((m) => m[1])
  assert.deepEqual(armados, ["[System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)"],
    "el conjunto de archivos nuevos no se arma con OrdinalIgnoreCase: un renombre sólo de mayúsculas borra el archivo recién copiado")
  // Y se llena con TODO lo nuevo antes de usarse para decidir qué borrar.
  const iLlena = PS.indexOf("foreach ($nuevo in @($Nuevos)) { [void]$NuevosSet.Add([string]$nuevo) }")
  const iUsa = PS.indexOf("if (-not $NuevosSet.Contains($line)) {")
  assert.ok(iLlena > 0, "el conjunto ya no se llena con la lista de archivos nuevos")
  assert.ok(iUsa > iLlena, "se decide qué borrar antes de llenar el conjunto: borraría TODO lo instalado")
  // El borrado sigue colgando de esa pregunta.
  assert.match(PS.slice(iUsa, iUsa + 200), /Remove-Item \(Join-Path \$ConfigDir \$line\)/, "el borrado de huérfanos ya no cuelga de la pregunta al conjunto")
})
