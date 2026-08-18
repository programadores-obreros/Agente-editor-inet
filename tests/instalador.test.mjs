// El instalador no puede decir "instalado" sin haber mirado.
//
// POR QUÉ ESTE ARCHIVO. En una notebook real, scoop terminó con
// "ERROR 'opencode' isn't installed correctly" y el bootstrap imprimió
// "[OK] OpenCode instalado" igual, siguió hasta el final y anunció que la
// instalación estaba completa. El docente lo descubrió recién al abrir el
// acceso directo, que le dijo "No se encontró OpenCode" sin ninguna pista de
// qué había pasado ni dónde mirar.
//
// Un instalador que dice OK sin verificar es peor que uno que falla: manda a
// buscar el problema al lugar equivocado.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const ps1 = readFileSync(join(REPO, "install/bootstrap.ps1"), "utf8")

/** El bloque de texto que sigue a una instalación, hasta el "[OK]" que la cierra. */
function bloqueTrasInstalar(comando) {
  const i = ps1.indexOf(comando)
  assert.ok(i > 0, `no encontré "${comando}" en bootstrap.ps1`)
  const resto = ps1.slice(i)
  const fin = resto.indexOf("[OK]")
  assert.ok(fin > 0, `no encontré el "[OK]" que sigue a "${comando}"`)
  return resto.slice(0, fin)
}

test("después de instalar OpenCode se verifica que quedó", () => {
  const bloque = bloqueTrasInstalar("scoop install opencode")
  assert.match(
    bloque,
    /Get-Command opencode|Test-Path \$shim/,
    "se imprime [OK] sin comprobar que opencode exista",
  )
})

test("si OpenCode no quedó, el instalador CORTA en vez de seguir", () => {
  // Seguir es lo que hacía antes, y por eso el error aparecía tres pasos
  // después, en el acceso directo, sin relación visible con la causa.
  const i = ps1.indexOf("OpenCode NO quedo instalado")
  assert.ok(i > 0, "no hay mensaje de fallo para OpenCode")
  assert.match(ps1.slice(i, i + 900), /exit 1/, "avisa pero sigue igual")
})

test("el mensaje de fallo dice QUÉ hacer, no sólo que falló", () => {
  const i = ps1.indexOf("OpenCode NO quedo instalado")
  const mensaje = ps1.slice(i, i + 900)
  assert.match(mensaje, /scoop uninstall opencode/, "falta el comando para limpiar")
  assert.match(mensaje, /scoop install opencode/, "falta el comando para reintentar")
})

test("Scoop también se verifica, y corta si falta", () => {
  // Sin scoop no se puede instalar nada de lo que sigue: cortar ahí ahorra
  // tres errores en cascada que no dicen cuál fue el primero.
  const i = ps1.indexOf("Scoop NO quedo instalado")
  assert.ok(i > 0, "no se verifica que Scoop haya quedado")
  assert.match(ps1.slice(i, i + 600), /exit 1/)
})

test("PlatformIO avisa si falta, pero NO corta", () => {
  // Es distinto a los otros dos: sin PlatformIO el bot igual sirve para
  // explicar, dibujar circuitos y repartir fichas. Sólo no puede compilar.
  const i = ps1.indexOf("PlatformIO NO quedo instalado")
  assert.ok(i > 0, "no se verifica que PlatformIO haya quedado")
  const mensaje = ps1.slice(i, i + 700)
  assert.doesNotMatch(mensaje, /exit 1/, "no debería cortar por PlatformIO")
  assert.match(mensaje, /diagnostico/i, "tiene que decir cómo revisarlo después")
})
