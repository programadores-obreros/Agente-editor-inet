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
