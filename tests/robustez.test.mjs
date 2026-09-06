// Robustez de los scripts de instalación y soporte: lo que se rompe en una
// escuela real y no en la máquina de quien lo escribió.
//
// Cada test acá nació de un hallazgo concreto de auditoría, y cada uno se probó
// por mutación (romper → rojo → restaurar) antes de darlo por bueno. Son tests
// de FORMA sobre scripts que no se pueden ejecutar en la CI de Linux (PowerShell,
// cmd.exe): miran el código sin comentarios, porque los comentarios de este repo
// citan los bugs y una cita no es código.
//
// Corre con: node --test tests/*.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (r) => readFileSync(join(REPO, r), "utf8")
const sinComentariosPs = (t) => t.replace(/^\s*#.*$/gm, "")
const sinComentariosCmd = (t) => t.replace(/^\s*rem\b.*$/gim, "")
const sinComentariosTs = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")

// ── B. El diagnóstico no busca una carpeta de UNA escuela ─────────────────────
//
// `diagnostico.ps1` escribía el reporte PRIMERO en `\\192.168.100.9\Compartido`:
// la IP de una escuela, fija. En cualquier otra red `Test-Path` contra una UNC
// inalcanzable se cuelga decenas de segundos antes de imprimir una línea — en el
// script que se corre justo cuando algo ya no anda. Y el reporte lleva datos de
// la máquina: a una carpeta ajena va sólo si alguien lo pide.
test("ningún script de install/ tiene una IP de red local escrita a fuego", () => {
  for (const f of readdirSync(join(REPO, "install"))) {
    const codigo = sinComentariosPs(leer(`install/${f}`))
    assert.doesNotMatch(codigo, /\\\\192\.168\.|\\\\10\.\d+\.|\\\\172\.(1[6-9]|2\d|3[01])\./,
      `install/${f} apunta a una carpeta de red con IP fija: en otra escuela se cuelga y filtra el reporte`)
  }
})

test("el diagnóstico escribe en el Escritorio; la carpeta compartida es opt-in por parámetro", () => {
  const codigo = sinComentariosPs(leer("install/diagnostico.ps1"))
  assert.match(codigo, /param\s*\([\s\S]*?\$Compartido[\s\S]*?\)/, "no hay parámetro -Compartido para pedir una carpeta compartida")
  assert.match(codigo, /Desktop/, "el reporte no va al Escritorio, donde el docente lo encuentra")
  // El destino compartido entra a la lista SOLO si se pasó: no está en el literal.
  const lista = codigo.match(/\$destinos\s*=\s*@\(([\s\S]*?)\)/)
  assert.ok(lista, "no encuentro la lista de destinos del reporte")
  assert.doesNotMatch(lista[1], /\\\\/, "hay una ruta UNC dentro de la lista fija de destinos")
  assert.match(codigo, /if\s*\(\$Compartido\)/, "el parámetro -Compartido no se usa para nada")
})

// ── E. XDG_CONFIG_HOME se honra en TODOS lados, o el lanzador manda a reinstalar en loop ──
//
// `install.ps1` y `bootstrap.ps1` instalan la capa en `$XDG_CONFIG_HOME\opencode`
// si la variable está puesta. El lanzador y el diagnóstico buscaban siempre en
// `%USERPROFILE%\.config\opencode`: con la variable puesta, la capa se instalaba
// en un lado y se buscaba en otro → "falta la capa, volvé a correr el
// instalador", para siempre, con todo instalado.
test("el lanzador .cmd busca la capa donde install.ps1 la deja (XDG_CONFIG_HOME)", () => {
  const codigo = sinComentariosCmd(leer("installer/abrir-tecnia-bot.cmd"))
  assert.match(codigo, /if defined XDG_CONFIG_HOME/i, "el .cmd no mira XDG_CONFIG_HOME")
  assert.doesNotMatch(codigo, /%USERPROFILE%\\\.config\\opencode\\agent/i,
    "todavía hay una ruta a la capa escrita a fuego en %USERPROFILE%: no respeta XDG_CONFIG_HOME")
  // Y la variable que sí respeta XDG es la que se usa para buscar el agente.
  const usos = codigo.match(/agent\\tecnia-bot\.md/g) ?? []
  assert.ok(usos.length >= 2, "el .cmd tiene que verificar la capa en más de un punto (espera, reparación, completo)")
  for (const m of codigo.matchAll(/"([^"]*agent\\tecnia-bot\.md)"/g)) {
    assert.match(m[1], /^%OCCFG%\\/, `la ruta a la capa no sale de la variable que honra XDG: ${m[1]}`)
  }
})

test("el diagnóstico busca la capa donde install.ps1 la deja (XDG_CONFIG_HOME)", () => {
  const codigo = sinComentariosPs(leer("install/diagnostico.ps1"))
  assert.match(codigo, /XDG_CONFIG_HOME/, "diagnostico.ps1 no mira XDG_CONFIG_HOME")
  assert.doesNotMatch(codigo, /\$U\\\.config\\opencode\\agent|USERPROFILE\\\.config\\opencode\\agent/,
    "la capa se busca en %USERPROFILE%\\.config a fuego: con XDG puesto dice FALTA con la capa instalada")
  // La variable que honra XDG tiene que definirse ANTES de usarse para la capa.
  const define = codigo.search(/\$ocDir\s*=/)
  const usa = codigo.search(/\$ocDir\\agent\\tecnia-bot\.md/)
  assert.ok(define >= 0 && usa >= 0 && define < usa, "$ocDir se usa para la capa antes de definirse")
})

// ── F. El log de instalación no se pisa, y powershell se llama por ruta ────────
//
// `Start-Transcript -Force` sobre el mismo `instalacion.log` en cada "Reparar":
// la corrida que falló —la que hacía falta leer— se perdía en el intento de
// arreglarla. Y `powershell` a secas depende del PATH del docente, que ya faltó
// una vez (CHANGELOG 0.3.75).
test("el bootstrap conserva los logs de instalación anteriores (rota y guarda 5)", () => {
  const codigo = sinComentariosPs(leer("install/bootstrap.ps1"))
  const guarda = /Start-Transcript[^\n]*-Append/.test(codigo) || /instalacion-[^\n]*(yyyyMMdd|HHmmss|Get-Date)/.test(codigo) || /LastWriteTime\.ToString\(/.test(codigo)
  assert.ok(guarda, "Start-Transcript pisa instalacion.log en cada corrida: se pierde la que falló")
  assert.match(codigo, /Select-Object\s+-Skip\s+5\b[^\n]*Remove-Item/, "no acota los logs viejos a 5: la carpeta crece para siempre")
  // Y el que lee el diagnóstico sigue siendo la corrida más reciente, con su nombre de siempre.
  assert.match(codigo, /Start-Transcript\s+-Path\s+\$LogInstalacion/, "el transcript ya no va a $LogInstalacion")
  assert.match(codigo, /\$LogInstalacion\s*=\s*Join-Path\s+\$RepoDir\s+"instalacion\.log"/, "instalacion.log dejó de ser el log actual: diagnostico.ps1 no lo va a encontrar")
})

test("el bootstrap lanza install.ps1 con el powershell.exe de $PSHOME, no por nombre", () => {
  const codigo = sinComentariosPs(leer("install/bootstrap.ps1"))
  assert.match(codigo, /Join-Path\s+\$PSHOME\s+"powershell\.exe"/, "no resuelve powershell.exe desde $PSHOME")
  const lanza = codigo.split("\n").filter((l) => /install\\install\.ps1/.test(l) && /-File/.test(l))
  assert.ok(lanza.length >= 1, "no encuentro la línea que lanza install.ps1")
  for (const l of lanza) {
    assert.doesNotMatch(l, /^\s*powershell\s/, `install.ps1 se lanza con "powershell" a secas, que depende del PATH: ${l.trim()}`)
    assert.match(l, /-NoProfile/, `se lanza sin -NoProfile: ${l.trim()}`)
  }
})

// ── C. El aviso de pip no asusta ───────────────────────────────────────────────
//
// `get-platformio.py` intenta actualizar pip dentro del venv y en Windows falla
// a veces con `WinError 1921`. El instalador de PlatformIO lo traga (update_pip
// captura la excepción y sigue), pero pip ya imprimió su ERROR en rojo, y el
// docente ve un error gordo seguido de "Listo". pioinstaller no tiene opción para
// saltear ese paso (verificado en su CLI), así que se filtra en el bootstrap.
test("el bootstrap filtra el error de pip al instalar PlatformIO y lo reduce a un aviso", () => {
  const codigo = sinComentariosPs(leer("install/bootstrap.ps1"))
  assert.match(codigo, /WinError 1921/, "no reconoce el error de pip que asusta (WinError 1921)")
  assert.match(codigo, /Aviso de pip[^\n]*no afecta a PlatformIO/i, "no explica que el aviso de pip no afecta a PlatformIO")
  // Sin esto, `2>&1` de un nativo con ErrorActionPreference=Stop revienta en PS 5.1.
  const i = codigo.indexOf("WinError 1921")
  const bloque = codigo.slice(Math.max(0, i - 800), i)
  assert.match(bloque, /\$ErrorActionPreference\s*=\s*"Continue"/, "captura 2>&1 con ErrorActionPreference=Stop: en PS 5.1 eso corta el instalador")
})

// ── D. Desinstalar limpia lo que instaló, y PREGUNTA antes de tocar datos personales ──
//
// `install.ps1` escribe en opencode.json tres cosas: default_agent, el override
// agent.tecnia-bot y dos rutas absolutas en instructions. El desinstalador sacaba
// una. Y la key de Google, el perfil y la memoria son del docente, no del
// programa: ni se borran solos ni se dejan sin avisar.
test("uninstall.ps1 saca de opencode.json TODO lo que install.ps1 puso, y nada más", () => {
  const codigo = sinComentariosPs(leer("install/uninstall.ps1"))
  assert.match(codigo, /"instructions"/, "no toca instructions: quedan dos rutas a archivos que ya no existen")
  assert.match(codigo, /tecnia-perfil\.md/, "no conoce la ruta del perfil que tiene que sacar de instructions")
  assert.match(codigo, /tecnia-memoria\.md/, "no conoce la ruta de la memoria que tiene que sacar de instructions")
  assert.match(codigo, /\$oc\.agent\.PSObject\.Properties\.Remove\(\$TecniaAgent\)/, "no saca el override agent.tecnia-bot")
  assert.match(codigo, /default_agent[^\n]*-eq\s+\$TecniaAgent/, "saca default_agent sin mirar si es el nuestro")
  // Si no parsea, avisa y NO escribe.
  assert.match(codigo, /No pude parsear/, "si opencode.json no parsea tiene que decirlo, no pisarlo")
})

test("uninstall.ps1 pregunta (20 s, No por defecto) antes de borrar la key y el perfil", () => {
  const codigo = sinComentariosPs(leer("install/uninstall.ps1"))
  assert.match(codigo, /function Preguntar-SiNo/, "no hay pregunta: borra o deja datos personales sin consultar")
  assert.match(codigo, /KeyAvailable|ReadKey|Read-Host/, "la pregunta no lee el teclado")
  // TODAS las preguntas esperan 20 s: la del perfil y la de la key.
  const esperas = [...codigo.matchAll(/Preguntar-SiNo\s+"[^"]*"\s+(\d+)\b/g)].map((m) => Number(m[1]))
  assert.ok(esperas.length >= 2, `tiene que preguntar por el perfil Y por la key (encontré ${esperas.length} preguntas)`)
  assert.deepEqual(esperas, esperas.map(() => 20), `alguna pregunta no espera 20 s: ${esperas.join(", ")}`)
  // Default No: si nadie contesta, la función devuelve $false.
  const fn = codigo.slice(codigo.indexOf("function Preguntar-SiNo"))
  assert.match(fn.slice(0, fn.indexOf("\n}\n") + 3), /return \$false\s*\n\}/, "si nadie contesta no devuelve No")
  // La key y el perfil se borran DESPUÉS de preguntar, no antes.
  const pregunta = codigo.indexOf("function Preguntar-SiNo")
  for (const [patron, que] of [
    [/SetEnvironmentVariable\("GOOGLE_GENERATIVE_AI_API_KEY",\s*\$null/, "la variable con la key"],
    [/Properties\.Remove\("google"\)/, "la key de auth.json"],
    [/Remove-Item \$PerfilFile/, "el perfil y la memoria"],
  ]) {
    const i = codigo.search(patron)
    assert.ok(i > pregunta, `borra ${que} sin haber preguntado antes`)
  }
  assert.match(codigo, /PERSONALES/, "no le explica al docente que son datos personales")
})

test("uninstall.sh hace lo mismo que uninstall.ps1 (instructions, agent, pregunta con timeout)", () => {
  const codigo = leer("install/uninstall.sh").replace(/^\s*#.*$/gm, "")
  assert.match(codigo, /instructions/, "no saca las rutas de instructions")
  assert.match(codigo, /del\(\.\[\$agent\]\)/, "la versión jq no saca agent.tecnia-bot")
  assert.match(codigo, /agentes\.pop\(agent/, "la versión python no saca agent.tecnia-bot")
  assert.match(codigo, /read -r -t 20/, "la pregunta no tiene timeout de 20 s")
  assert.match(codigo, /\[ -t 0 \]/, "sin terminal `read` tiene que saltearse, no colgarse ni fallar con set -e")
  assert.match(codigo, /PERSONALES/, "no le explica al docente que son datos personales")
})

// ── A. La tool actualizar no se cuelga ─────────────────────────────────────────
//
// Los tests de comportamiento están en actualizar.test.mjs. Acá, la forma que
// evita el deadlock: la salida se lee ANTES de esperar `exited`.
test("actualizar.ts lee stdout/stderr antes de esperar exited, y el fetch tiene timeout", () => {
  const codigo = sinComentariosTs(leer("opencode/tool/actualizar.ts"))
  const lee = codigo.search(/Promise\.all\(\[\s*new Response\(proc\.stdout\)/)
  const espera = codigo.search(/await proc\.exited/)
  assert.ok(lee >= 0, "no lee stdout y stderr en paralelo con Promise.all")
  assert.ok(espera >= 0 && lee < espera, "espera `exited` antes de leer la salida: con el pipe lleno se traba")
  assert.match(codigo, /AbortSignal\.timeout\(/, "el fetch a GitHub no tiene timeout: en una escuela que filtra GitHub se cuelga")
  assert.match(codigo, /"powershell",\s*"-NoProfile",\s*"-ExecutionPolicy",\s*"Bypass"/, "lanza update.ps1 sin -NoProfile -ExecutionPolicy Bypass")
})

// ── G. rollback.md dice UNA versión segura, la misma en todos lados ───────────
//
// Decía v0.3.69 en la tabla y v0.3.62 dos párrafos más abajo, con la URL y los
// comandos apuntando a la vieja. Quien hace un rollback a las apuradas copia el
// comando: tiene que ser el correcto.
test("docs/rollback.md: el punto seguro, la URL y el comando gh apuntan a la misma versión", () => {
  const doc = leer("docs/rollback.md")
  const tabla = doc.match(/Punto seguro[^\n]*\*\*(v\d+\.\d+\.\d+)\*\*/)
  assert.ok(tabla, "la tabla no marca un punto seguro en negrita")
  const seguro = tabla[1]
  const url = doc.match(/releases\/tag\/(v\d+\.\d+\.\d+)/)
  assert.ok(url, "no hay URL al release al que volver")
  assert.equal(url[1], seguro, "la URL del release no es la del punto seguro")
  const latest = doc.match(/gh release edit (v\d+\.\d+\.\d+) --latest\b/)
  assert.ok(latest, "no hay comando para volver a marcar Latest")
  assert.equal(latest[1], seguro, "el comando que marca Latest no apunta al punto seguro")
  assert.match(doc, new RegExp(`punto seguro es la \\*\\*${seguro.replace(/\./g, "\\.")}\\*\\*`),
    "el párrafo del punto seguro nombra otra versión que la tabla")
})
