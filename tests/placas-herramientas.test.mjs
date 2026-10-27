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
