// Las herramientas de las placas se bajan al INSTALAR, no en clase.
//
// 2026-10-14, taller con 30+ docentes: la primera compilación de ESP32 baja más de
// 1 GB (compilador + framework) sin progreso visible. Con la red del aula no
// terminaba en 15 minutos, el bot reintentaba y la docente esperaba otros 15.
// Los instaladores ahora las bajan con `pio pkg install` sobre un proyecto con las
// versiones fijadas; /actualizar sólo avisa (se corre en clase y no muestra nada).
// Verificado a mano: install.ps1 en la VM win10 (83 s) e install.sh en Linux (64 s).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (p) => readFileSync(join(REPO, p), "utf-8")
const ps1 = leer("install/install.ps1")
const sh = leer("install/install.sh")

test("los dos instaladores bajan las herramientas con las versiones FIJADAS de las placas", () => {
  for (const [nombre, codigo] of [["install.ps1", ps1], ["install.sh", sh]]) {
    assert.match(codigo, /platform = espressif32@6\.12\.0/, `${nombre}: ESP32 sin versión fija`)
    assert.match(codigo, /platform = atmelavr@5\.2\.0/, `${nombre}: UNO sin versión fija`)
    assert.match(codigo, /pkg install -d/, `${nombre}: no usa pio pkg install sobre el proyecto`)
  }
  assert.match(ps1, /Preparar-Placas \$pioPath/, "install.ps1 define la función pero no la llama")
  assert.match(sh, /preparar_placas "\$PIO_BIN"/, "install.sh define la función pero no la llama")
})

test("desde /actualizar no se baja nada: sólo se avisa", () => {
  assert.match(leer("install/update.ps1"), /\$env:TECNIA_DESDE_ACTUALIZAR = "1"\s*\n\s*powershell[^\n]*install\.ps1/)
  assert.match(leer("install/update.sh"), /TECNIA_DESDE_ACTUALIZAR=1 bash "\$REPO_DIR\/install\/install\.sh"/)
  assert.match(ps1, /if \(\$env:TECNIA_DESDE_ACTUALIZAR -eq "1"\) \{[\s\S]{0,400}?return/)
  assert.match(sh, /if \[ "\$\{TECNIA_DESDE_ACTUALIZAR:-\}" = "1" \]; then[\s\S]{0,300}?return 0/)
})

test("con poco espacio no se baja, y una falla no corta la instalación", () => {
  assert.match(ps1, /\$libreGB -lt 3/)
  assert.match(sh, /-lt 3145728/)
  // Ninguna rama de la descarga hace exit: avisan y siguen.
  const fnPs1 = ps1.slice(ps1.indexOf("function Preparar-Placas"), ps1.indexOf("# Chequear PlatformIO"))
  const fnSh = sh.slice(sh.indexOf("preparar_placas() {"), sh.indexOf('PIO_BIN="$(buscar_pio'))
  assert.doesNotMatch(fnPs1, /\bexit\b/)
  assert.doesNotMatch(fnSh, /\bexit\b/)
})

test("el prompt y las skills escriben platformio.ini con las MISMAS versiones que se bajan", () => {
  // Hasta la 0.4.5 el prompt decía `platform = espressif32` a secas: PlatformIO
  // podía pedir otra versión que la que el instalador dejó bajada.
  for (const p of ["opencode/agent/tecnia-bot.md", "opencode/skills/placas/SKILL.md", "opencode/skills/errores-comunes/SKILL.md", "opencode/skills/librerias/SKILL.md"]) {
    assert.doesNotMatch(leer(p), /^platform = (espressif32|atmelavr)\s*$/m, `${p} tiene una plataforma sin versión`)
  }
  assert.match(leer("opencode/agent/tecnia-bot.md"), /se corta por tiempo[\s\S]{0,40}NO reintentes/)
})

// ── EL CIERRE DEL INSTALADOR COMPLETO MIRA SI LAS HERRAMIENTAS QUEDARON ────────
//
// El defecto (auditoría integral del 2026-11-21): install.ps1 / install.sh bajan
// las herramientas y, si no pueden, avisan y siguen. bootstrap.ps1 / bootstrap.sh
// sólo preguntaban si pio contesta, así que cerraban en «LISTO!» / «¡Todo listo!»
// con código 0 sin las herramientas. Ahora el cierre busca las carpetas en disco.
//
// El comportamiento de bootstrap.sh se prueba EJECUTÁNDOLO, en
// tests/bootstrap-linux-real.test.mjs. Lo de acá abajo es lo que ese archivo no
// puede ver: que las copias no se separen, y la forma de bootstrap.ps1, que en
// Linux no se puede correr.
//
// LÍMITE HONESTO de las guardas de bootstrap.ps1: son de FORMA, sobre el texto sin
// comentarios. No hay PowerShell acá. Que el .ps1 parsea en Windows PowerShell 5.1
// y que una instalación limpia termina en 0 lo prueba el job de Windows de la CI.
//
// MUTACIONES que ponen rojo este archivo (exit code 1):
//   - sacar un paquete de la lista de bootstrap.ps1 o del `for` de bootstrap.sh
//     → rojo «la misma lista en los cuatro»
//   - en Core-PlatformIO de bootstrap.ps1, sacar `-PathType Container`
//     → rojo «Core-PlatformIO es la misma»
//   - en bootstrap.ps1, cambiar `$Degradado += "faltan las herramientas…` por un
//     Write-Host → rojo «bootstrap.ps1 degrada»
//   - mover el bloque de Placas arriba de la llamada a install.ps1
//     → rojo «bootstrap.ps1 degrada» (mira el disco antes de bajar)
//   - `-not (Test-Path …)` → `$false` → rojo «bootstrap.ps1 degrada»

const sinComentarios = (codigo) => codigo.replace(/^\s*#.*$/gm, "")
const bootPs1 = sinComentarios(leer("install/bootstrap.ps1"))
const bootSh = sinComentarios(leer("install/bootstrap.sh"))
const PAQUETES = ["toolchain-xtensa-esp32", "framework-arduinoespressif32", "toolchain-atmelavr", "framework-arduino-avr"]

test("la lista de herramientas de las placas es la misma en los cuatro instaladores", () => {
  const dePs1 = (codigo, nombre) => {
    const m = [...codigo.matchAll(/^\$PaquetesPlacas = @\(([^)\n]*)\)$/gm)]
    assert.equal(m.length, 1, `${nombre}: esperaba una sola definición de $PaquetesPlacas y hay ${m.length}`)
    return [...m[0][1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
  }
  const deSh = (codigo, nombre) => {
    const m = [...codigo.matchAll(/^\s*for p in ([a-z0-9\- ]+); do\n\s*\[ -d "\$[A-Za-z_]+\/packages\/\$p" \]/gm)]
    assert.equal(m.length, 1, `${nombre}: esperaba un solo \`for p in …\` que mire <core>/packages y hay ${m.length}`)
    return m[0][1].trim().split(/\s+/)
  }
  assert.deepEqual(dePs1(sinComentarios(ps1), "install.ps1"), PAQUETES, "install.ps1 baja otra lista")
  assert.deepEqual(dePs1(bootPs1, "bootstrap.ps1"), PAQUETES, "bootstrap.ps1 comprueba otra lista que la que install.ps1 baja")
  assert.deepEqual(deSh(sinComentarios(sh), "install.sh"), PAQUETES, "install.sh baja otra lista")
  assert.deepEqual(deSh(bootSh, "bootstrap.sh"), PAQUETES, "bootstrap.sh comprueba otra lista que la que install.sh baja")
})

test("Core-PlatformIO es la misma, letra por letra, en install.ps1 y bootstrap.ps1", () => {
  // Si difieren, el cierre busca las herramientas en una carpeta y la descarga las
  // deja en otra: «faltan» para siempre, y Reparar no lo arregla.
  const cuerpo = (codigo, nombre) => {
    const m = [...codigo.matchAll(/^function Core-PlatformIO \{\n([\s\S]*?)\n\}$/gm)]
    assert.equal(m.length, 1, `${nombre}: esperaba una sola función Core-PlatformIO y hay ${m.length}`)
    return m[0][1]
  }
  const deInstall = cuerpo(sinComentarios(ps1), "install.ps1")
  assert.match(deInstall, /-PathType Container/, "Core-PlatformIO ya no exige que <raiz>\\.platformio sea una carpeta")
  assert.equal(cuerpo(bootPs1, "bootstrap.ps1"), deInstall, "Core-PlatformIO de bootstrap.ps1 no es igual a la de install.ps1")
})

test("bootstrap.ps1 degrada el resultado si faltan las herramientas, mirando el disco después de instalar la capa", () => {
  const iCapa = bootPs1.search(/^\s*&[^\n]*install\.ps1/m)
  const iPlacas = bootPs1.indexOf("$FaltanPlacas = @(")
  const iCorte = bootPs1.indexOf("\nif ($Degradado.Count -gt 0) {")
  assert.ok(iCapa > 0, "no encontré dónde bootstrap.ps1 lanza install.ps1: el script cambió de forma")
  assert.ok(iPlacas > iCapa, "bootstrap.ps1 mira las herramientas ANTES de que install.ps1 las baje: una instalación limpia terminaría incompleta")
  assert.ok(iCorte > iPlacas, "bootstrap.ps1 mira las herramientas después de decidir si quedó degradado")
  const bloque = bootPs1.slice(iPlacas, iCorte)
  // El disco, con la misma carpeta y la misma lista que la descarga.
  assert.ok(bloque.startsWith('$FaltanPlacas = @($PaquetesPlacas | Where-Object { -not (Test-Path -LiteralPath (Join-Path $CorePlacas "packages\\$_") -PathType Container) })'),
    "bootstrap.ps1 ya no busca cada herramienta en <core>\\packages")
  assert.match(bootPs1.slice(iCapa, iPlacas), /\n\s*\$CorePlacas = Core-PlatformIO\n\s*$/, "la carpeta donde se buscan no sale de Core-PlatformIO")
  // Si faltan: degrada (sale con 2 y sin LISTO!) y Reparar sirve.
  assert.match(bloque, /if \(\$FaltanPlacas\.Count -eq 0\) \{\n[^\n]*\[OK\] Placas[^\n]*\n\s*\} else \{\n\s*\$Degradado \+= "faltan las herramientas de las placas[^\n]*\n\s*\$ReparaSirve = \$true\n/,
    "que falten las herramientas de las placas no degrada el resultado: terminaría en LISTO! con exit 0")
  // Y sólo si hay PlatformIO.
  assert.match(bootPs1.slice(iCapa, iPlacas), /\nif \(\$PioExe\) \{\n\s*\$CorePlacas = Core-PlatformIO\n\s*$/, "se miran las herramientas aunque no haya PlatformIO")
})
