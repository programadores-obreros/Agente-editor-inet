// El desinstalador NO puede afirmar un borrado que no comprobó.
//
// POR QUÉ ESTE ARCHIVO. La escena: una escuela reasigna la notebook. El
// desinstalador le pregunta a la docente «Es TU credencial, no del programa: si
// esta compu pasa a otra persona conviene quitarla. ¿Quitarla también?». Dice
// que sí. Lee **«Key de Google quitada»**. Y la máquina se entrega con su
// credencial de Google adentro.
//
// Eran dos defectos de la MISMA clase — afirmar sin releer:
//
//   1. `install/uninstall.sh`: `if jq 'del(.google)' ... ; then mv ...; else rm -f "$tmp"; fi`
//      El `else` descartaba el temporal en silencio, y el estado del `if`
//      terminaba siendo el del `rm -f` (0). La función devolvía 0, `set -e` no
//      cortaba, y el `echo` de éxito salía igual. Nadie releía `auth.json`.
//      La guarda correcta ya existía, escrita por la misma mano, a 70 líneas de
//      distancia, en el camino de ESCRITURA de `install.sh` (el "[AVISO] No pude
//      escribir $AUTH_FILE"). Faltaba justo en el BORRADO, que es el único de los
//      dos con consecuencia de privacidad.
//
//   2. `install/uninstall.ps1`: `Remove-Item $PerfilFile, $MemoriaFile -ErrorAction
//      SilentlyContinue` + "Perfil y memoria borrados." Con OpenCode abierto los
//      dos archivos están tomados (entran por `instructions` de opencode.json),
//      el borrado no pasa, el error se lo traga SilentlyContinue y el mensaje
//      sale igual. Son datos PERSONALES de MENORES: Ley 25.326, citada en
//      `opencode/tool/memoria.ts`.
//
// La regla que verifican estos tests: **después de borrar, RELEER; y decir sólo
// lo que se comprobó**. Los tests de FORMA están armados para morirse por
// MUTACIÓN (volver a poner el `echo` incondicional → rojo), y los funcionales
// corren `uninstall.sh` de verdad contra un HOME de mentira.
//
// Corre con: node --test tests/*.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync, symlinkSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (r) => readFileSync(join(REPO, r), "utf8")
// Los comentarios de este repo CITAN los bugs; una cita no es código.
const sinComentarios = (t) => t.replace(/^\s*#.*$/gm, "")

const SH = sinComentarios(leer("install/uninstall.sh"))
const PS = sinComentarios(leer("install/uninstall.ps1"))

/** Cuerpo de una función de bash: desde `nombre() {` hasta el `}` de columna 0. */
function cuerpoSh(nombre) {
  const i = SH.indexOf(`${nombre}() {`)
  assert.ok(i >= 0, `no encuentro la función ${nombre}() en install/uninstall.sh`)
  const j = SH.indexOf("\n}\n", i)
  assert.ok(j > i, `la función ${nombre}() no cierra`)
  return SH.slice(i, j)
}

/** Cuerpo de una función de PowerShell: desde `function Nombre` hasta el `}` de columna 0. */
function cuerpoPs(nombre) {
  const i = PS.indexOf(`function ${nombre}`)
  assert.ok(i >= 0, `no encuentro la función ${nombre} en install/uninstall.ps1`)
  const j = PS.indexOf("\n}\n", i)
  assert.ok(j > i, `la función ${nombre} no cierra`)
  return PS.slice(i, j)
}

// ── 1. El mensaje de éxito de la key NO se puede alcanzar sin relectura ───────
//
// Test por mutación: si alguien vuelve a poner
//     auth_quitar_google
//     echo "    Key de Google quitada..."
// (el `echo` incondicional del defecto original), acá se pone rojo por dos lados:
// no hay `if auth_quitar_google; then` antes del mensaje, y la función no relee.
test("uninstall.sh: 'Key de Google quitada' cuelga de una RELECTURA, no del borrado", () => {
  const fn = cuerpoSh("auth_quitar_google")
  assert.match(fn, /auth_estado_google/,
    "auth_quitar_google no vuelve a leer auth.json: devolvería éxito sin comprobar que la key ya no está")
  // La relectura es lo ÚLTIMO que hace: es lo que fija el estado de salida.
  const iRelectura = fn.lastIndexOf("auth_estado_google")
  const iUltimaEscritura = Math.max(fn.lastIndexOf("json.dump"), fn.lastIndexOf("mv -f"))
  assert.ok(iUltimaEscritura >= 0, "auth_quitar_google ya no escribe auth.json: cambió de forma, revisar este test")
  assert.ok(iRelectura > iUltimaEscritura, "la relectura pasa ANTES de escribir: no verifica nada")
  // Cada camino que no puede garantizar el borrado devuelve 1 (sin jq ni python3,
  // jq que no parsea, mv que no pudo).
  const fallas = fn.match(/return 1/g) ?? []
  assert.equal(fallas.length, 4,
    `auth_quitar_google tiene ${fallas.length} salidas de fracaso y tienen que ser 4 ` +
      "(python3 que falla, jq que no parsea, mv que no pudo, y ni jq ni python3)")

  // Una sola afirmación de éxito, y cuelga del `if` que verifica.
  const exito = [...SH.matchAll(/^[ \t]*echo "[^"]*Key de Google quitada[^"]*"/gm)]
  assert.equal(exito.length, 1, `esperaba UNA afirmación de "Key de Google quitada" y encontré ${exito.length}`)
  const iIf = SH.indexOf("if auth_quitar_google; then")
  assert.ok(iIf >= 0, "el mensaje de éxito ya no cuelga de `if auth_quitar_google; then`: se afirma sin verificar")
  assert.ok(iIf < exito[0].index, "el `if` que verifica quedó DESPUÉS del mensaje de éxito")
  assert.doesNotMatch(SH.slice(iIf, exito[0].index), /^\s*(fi|else)\b/m,
    "entre el `if` que verifica y el mensaje de éxito hay un fi/else: el mensaje quedó afuera de la verificación")

  // Y no hay ninguna otra llamada suelta que borre sin mirar el resultado
  // (la definición `auth_quitar_google() {` no cuenta: pide `;` o fin de línea).
  const llamadas = [...SH.matchAll(/^[ \t]*(?:if[ \t]+)?auth_quitar_google[ \t]*(?:;|$)/gm)]
  assert.equal(llamadas.length, 1,
    `auth_quitar_google se llama ${llamadas.length} veces; una sola, y con su resultado mirado`)
})

// ── 2. Existe la rama de fracaso, y dice DÓNDE quedó la credencial ────────────
test("uninstall.sh: si la key no se pudo quitar, lo dice y dice dónde quedó el archivo", () => {
  const iExito = SH.search(/echo "[^"]*Key de Google quitada/)
  const iConserva = SH.indexOf("La key de Google se conserva")
  assert.ok(iExito >= 0 && iConserva > iExito, "no encuentro el bloque de la key en uninstall.sh")
  const fracaso = SH.slice(iExito, iConserva)
  assert.match(fracaso, /^\s*else\b/m, "no hay rama de fracaso: el único camino imprime éxito")
  assert.match(fracaso, /SIGUE EN ESTA COMPUTADORA/,
    "el fracaso no le dice a la docente que la credencial sigue en la máquina")
  assert.match(fracaso, /\$AUTH_FILE/, "el fracaso no dice DÓNDE quedó la credencial")
  assert.match(fracaso, /a mano/, "el fracaso no le dice qué hacer (sacarla a mano)")
  assert.match(fracaso, /anotar_pendiente/, "el fracaso no queda anotado para el resumen final")

  // Y el caso "no pude ni LEER auth.json" tampoco se calla: es el mismo problema
  // con otra cara (la docente cree que el desinstalador miró, y adentro puede
  // estar la key).
  assert.match(SH, /ESTADO_KEY_GOOGLE" = "\?"/, "no hay rama para el auth.json ilegible: se lo saltea en silencio")
  const iAviso = SH.indexOf('ESTADO_KEY_GOOGLE" = "?"')
  const aviso = SH.slice(iAviso, iAviso + 900)
  assert.match(aviso, /\$AUTH_FILE/, "el aviso del auth.json ilegible no dice qué archivo mirar")
  assert.match(aviso, /NO SE/, "el aviso no aclara que NO se sabe si la key quedó adentro")
})

// ── 3. El BOM se maneja como ya lo maneja el resto del repo ───────────────────
//
// `install/uninstall.ps1:215` y `install/install.ps1` ya resolvían el BOM del
// lado Windows. Del lado bash, `json.load(open(path))` reventaba con
// "Unexpected UTF-8 BOM" y ese fracaso se confundía con "no hay key".
test("uninstall.sh lee auth.json con utf-8-sig: un BOM no se confunde con 'no hay key'", () => {
  assert.match(SH, /utf-8-sig/, "python abre auth.json sin utf-8-sig: con BOM revienta y se lo toma como 'sin key'")
  const usos = SH.match(/utf-8-sig/g) ?? []
  assert.equal(usos.length, 2, `utf-8-sig tiene que estar en los DOS python (leer y quitar); encontré ${usos.length}`)
  // El estado de la key es de TRES valores: si / no / ? (no se pudo leer).
  const fn = cuerpoSh("auth_estado_google")
  for (const estado of ['"si"', '"no"', "'?"]) {
    assert.ok(fn.includes(estado.replace("'", '')) || fn.includes(estado),
      `auth_estado_google no puede devolver ${estado}: sin el "?" volvemos a confundir "no pude leer" con "no hay key"`)
  }
})

// ── 4. uninstall.ps1: perfil y memoria (datos personales de MENORES) ──────────
//
// Mutación: volver a poner
//     Remove-Item $PerfilFile, $MemoriaFile -Force -ErrorAction SilentlyContinue
//     Write-Host "    Perfil y memoria borrados."
// deja el mensaje fuera del `if` que mira la relectura → rojo.
test("uninstall.ps1: 'Perfil y memoria borrados' cuelga de una RELECTURA con Test-Path", () => {
  const fn = cuerpoPs("Borrar-YVerificar")
  const iRemove = fn.indexOf("Remove-Item")
  const iTest = fn.indexOf("Test-Path", iRemove)
  assert.ok(iRemove >= 0, "Borrar-YVerificar no borra nada")
  assert.ok(iTest > iRemove, "Borrar-YVerificar no relee con Test-Path DESPUÉS de Remove-Item")

  const exito = [...PS.matchAll(/^[ \t]*Write-Host "[^"]*Perfil y memoria borrados[^"]*"/gm)]
  assert.equal(exito.length, 1, `esperaba UNA afirmación de "Perfil y memoria borrados" y encontré ${exito.length}`)
  const iGuarda = PS.indexOf("if ($Quedaron.Count -eq 0)")
  assert.ok(iGuarda >= 0, "el mensaje ya no cuelga de la cuenta de lo que quedó: se afirma sin verificar")
  assert.ok(iGuarda < exito[0].index, "la guarda quedó DESPUÉS del mensaje de éxito")
  assert.doesNotMatch(PS.slice(iGuarda, exito[0].index), /\}/,
    "entre la guarda y el mensaje se cierra un bloque: el mensaje quedó afuera de la verificación")

  // Y la rama de fracaso nombra los archivos y dice dónde están.
  const iFracaso = PS.indexOf("NO PUDE BORRAR estos datos personales")
  assert.ok(iFracaso > exito[0].index, "no hay rama de fracaso para el perfil y la memoria")
  const fracaso = PS.slice(iFracaso, iFracaso + 900)
  assert.match(fracaso, /foreach \(\$f in \$Quedaron\)/, "el fracaso no lista CUÁL de los dos archivos quedó")
  assert.match(fracaso, /a mano/, "el fracaso no le dice qué hacer")
  assert.match(fracaso, /Anotar-Pendiente/, "el fracaso no queda anotado para el resumen final")
})

test("uninstall.ps1: la key se relee después de escribir, y la variable de entorno también", () => {
  const exito = [...PS.matchAll(/^[ \t]*Write-Host "[^"]*Key de Google quitada[^"]*"/gm)]
  assert.equal(exito.length, 1, `esperaba UNA afirmación de "Key de Google quitada" y encontré ${exito.length}`)
  const iGuarda = PS.indexOf("if ($KeyQuedo.Count -eq 0)")
  assert.ok(iGuarda >= 0 && iGuarda < exito[0].index,
    "el mensaje de la key no cuelga de la cuenta de lo que quedó: se afirma sin verificar")
  // auth.json: se escribe y se vuelve a leer con la MISMA función que lo detectó.
  const iEscribe = PS.indexOf("WriteAllText($AuthFile")
  const iRelee = PS.indexOf("Get-EstadoKeyAuth $AuthFile", iEscribe)
  assert.ok(iEscribe >= 0 && iRelee > iEscribe, "no se relee auth.json después de escribirlo")
  // La variable de usuario: se borra y se vuelve a consultar.
  const iBorraEnv = PS.indexOf('SetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", $null')
  const iReleeEnv = PS.indexOf('GetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", "User")', iBorraEnv)
  assert.ok(iBorraEnv >= 0 && iReleeEnv > iBorraEnv,
    "se borra la variable GOOGLE_GENERATIVE_AI_API_KEY y no se vuelve a consultar")
})

// ── 5. La clase entera: NINGUNA afirmación de borrado sin relectura ───────────
//
// Es una CLASE de defecto, no dos instancias: arreglar una copia y no las otras
// es exactamente como este repo repite los problemas. Este test recolecta TODAS
// las afirmaciones de borrado de los dos desinstaladores y exige que cada una
// tenga una verificación cerca. Se afirma el CONTEO TOTAL a propósito: un test
// que recolecta por regex y no cuenta se pone verde revisando 6 de 9.
const VERIFICADORES =
  /Test-Path|borrar_verificando|Borrar-YVerificar|auth_estado_google|Get-EstadoKeyAuth|auth_quitar_google|\$PENDIENTES|\$Pendientes|\$Quedaron|\$KeyQuedo|\$NoBorrados/

function afirmacionesDeBorrado(codigo) {
  const afirma = /\b(borrad|quitad|eliminad)[oa]s?\b|\bdesinstalad[oa]s?\b/i
  // "No pude borrar", "[X] NO PUDE BORRAR", "Quedo sin borrar" no son afirmaciones:
  // son justamente lo contrario, y el infinitivo no matchea el patrón de arriba.
  return codigo
    .split("\n")
    .map((linea, i) => [i, linea])
    .filter(([, l]) => /^\s*(echo|Write-Host)\s/.test(l) && afirma.test(l))
}

test("ninguna afirmación de borrado de los uninstall.* llega sin una relectura antes", () => {
  const encontradas = []
  for (const [archivo, codigo] of [["install/uninstall.sh", SH], ["install/uninstall.ps1", PS]]) {
    const lineas = codigo.split("\n")
    for (const [i, linea] of afirmacionesDeBorrado(codigo)) {
      encontradas.push(`${archivo}:${i + 1} ${linea.trim().slice(0, 60)}`)
      const antes = lineas.slice(Math.max(0, i - 30), i).join("\n")
      assert.match(antes, VERIFICADORES,
        `${archivo}:${i + 1} afirma un borrado y en las 30 líneas de arriba no hay ninguna relectura: ${linea.trim()}`)
    }
  }
  // El conteo: perfil, key y "desinstalado" en cada uno de los dos scripts.
  assert.equal(encontradas.length, 6,
    `esperaba 6 afirmaciones de borrado (perfil, key y el "desinstalado" final, en los dos scripts) y encontré ` +
      `${encontradas.length}:\n${encontradas.join("\n")}`)
})

test("ningún -ErrorAction SilentlyContinue pegado a una afirmación de borrado", () => {
  const lineas = PS.split("\n")
  for (const [i, linea] of afirmacionesDeBorrado(PS)) {
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
      if (!/Remove-Item[^\n]*SilentlyContinue/.test(lineas[j])) continue
      const entre = lineas.slice(j + 1, i).join("\n")
      assert.match(entre, /Test-Path/,
        `install/uninstall.ps1:${i + 1} afirma un borrado justo después de un Remove-Item que se traga el error ` +
          `(línea ${j + 1}) sin releer con Test-Path: ${linea.trim()}`)
    }
  }
  // El mensaje final tampoco puede ser incondicional.
  assert.match(PS, /if \(\$Pendientes\.Count -eq 0\) \{\s*\n\s*Write-Host "==> Listo/,
    'el "==> Listo. Tecnia Bot desinstalado." de uninstall.ps1 no mira lo que quedó sin borrar')
  assert.match(SH, /if \[ -z "\$PENDIENTES" \]; then\s*\n\s*echo "==> Listo/,
    'el "==> Listo. Tecnia Bot desinstalado." de uninstall.sh no mira lo que quedó sin borrar')
})

// ── 6. Los funcionales: uninstall.sh de verdad, contra un HOME de mentira ─────
//
// Los de forma miran el código; estos corren el script. El primero es el
// escenario exacto que entrega una notebook con la credencial adentro.

const bash = rutaDe("bash")
const python3 = rutaDe("python3")
const jq = rutaDe("jq")
const puedeCorrer = process.platform !== "win32" && Boolean(bash)
const esRoot = typeof process.getuid === "function" && process.getuid() === 0

function rutaDe(cmd) {
  try {
    const salida = execFileSync("/usr/bin/env", ["sh", "-c", `command -v ${cmd} 2>/dev/null`], { encoding: "utf8" })
    return salida.trim() || null
  } catch {
    return null
  }
}

/**
 * Arma una "escuela": HOME con la capa instalada, un auth.json con la key del
 * docente, y un PATH que contiene SÓLO las herramientas que se le pasen. Sacar
 * python3 del PATH no es artificial: macOS no trae python3 de fábrica desde 12.3.
 */
function armarEscuela({ auth, bom = false, herramientas = [] }) {
  const base = mkdtempSync(join(tmpdir(), "tecnia-desinstalar-"))
  mkdirSync(join(base, "cfg", "opencode", "agent"), { recursive: true })
  mkdirSync(join(base, "data", "opencode"), { recursive: true })
  mkdirSync(join(base, "bin"))
  // rm/mv/mktemp/find son las que el script usa además de jq y python3.
  for (const h of ["rm", "mv", "mktemp", "find", ...herramientas]) {
    const real = rutaDe(h)
    if (real) symlinkSync(real, join(base, "bin", h))
  }
  writeFileSync(join(base, "cfg", "opencode", "tecnia-bot.manifest"), "version=0.3.78\nagent/tecnia-bot.md\n")
  writeFileSync(join(base, "cfg", "opencode", "agent", "tecnia-bot.md"), "capa educativa\n")
  writeFileSync(join(base, "data", "opencode", "auth.json"), (bom ? "﻿" : "") + auth)
  return base
}

function desinstalar(base) {
  try {
    return execFileSync(bash, [join(REPO, "install", "uninstall.sh"), "--borrar"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: join(base, "bin"),
        HOME: base,
        XDG_CONFIG_HOME: join(base, "cfg"),
        XDG_DATA_HOME: join(base, "data"),
      },
    })
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}\n[el script salió con código ${e.status}]`
  }
}

const authDe = (base) => readFileSync(join(base, "data", "opencode", "auth.json"), "utf8")

test(
  "FUNCIONAL: auth.json con BOM y sin python3 ni jq → la key SIGUE y el script LO DICE",
  { skip: !puedeCorrer },
  () => {
    // Éste es el escenario del defecto: la docente no puede quedarse con un
    // "Key de Google quitada" cuando la credencial sigue en la máquina.
    const base = armarEscuela({ auth: '{"google":{"type":"api","key":"AIzaSECRETO"}}', bom: true })
    try {
      const salida = desinstalar(base)
      assert.match(authDe(base), /AIzaSECRETO/, "sin jq ni python3 la key no se puede sacar; si desapareció, cambió algo grave")
      assert.doesNotMatch(salida, /Key de Google quitada/,
        `el script AFIRMA haber quitado la key y la key sigue en el archivo:\n${salida}`)
      assert.match(salida, /No pude leer/, `el script se calla sobre auth.json:\n${salida}`)
      assert.match(salida, new RegExp(join(base, "data", "opencode", "auth.json").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `el aviso no dice DÓNDE está el archivo con la credencial:\n${salida}`)
      assert.match(salida, /PARCIALMENTE/, `el resumen final dice que salió todo bien:\n${salida}`)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  },
)

test(
  "FUNCIONAL: auth.json con BOM y jq → lo que dice el script y lo que quedó en el archivo COINCIDEN",
  { skip: !puedeCorrer || !jq },
  () => {
    // jq >= 1.7 se traga el BOM y jq 1.6 no. La propiedad no depende de eso: lo
    // único inaceptable es que el mensaje y el archivo no coincidan.
    const base = armarEscuela({ auth: '{"google":{"type":"api","key":"AIzaSECRETO"}}', bom: true, herramientas: ["jq"] })
    try {
      const salida = desinstalar(base)
      const sigue = /AIzaSECRETO/.test(authDe(base))
      const afirma = /Key de Google quitada/.test(salida)
      assert.equal(afirma, !sigue, `el script dice "${afirma ? "quitada" : "no quitada"}" y la key ${sigue ? "SIGUE" : "no está"}:\n${salida}`)
      if (sigue) {
        assert.match(salida, /SIGUE EN ESTA COMPUTADORA|No pude leer/,
          `la key quedó y el script no avisa:\n${salida}`)
      }
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  },
)

test(
  "FUNCIONAL: con python3 la key se va de verdad, y las otras credenciales quedan",
  { skip: !puedeCorrer || !python3 },
  () => {
    // El contrapeso de los de arriba: si el camino feliz no funcionara, los tests
    // de fracaso pasarían por la razón equivocada.
    const base = armarEscuela({
      auth: '{"google":{"type":"api","key":"AIzaSECRETO"},"anthropic":{"type":"api","key":"OTRA"}}',
      bom: true,
      herramientas: ["python3"],
    })
    try {
      const salida = desinstalar(base)
      assert.match(salida, /Key de Google quitada/, `no quitó la key teniendo python3:\n${salida}`)
      assert.doesNotMatch(authDe(base), /AIzaSECRETO/, "dijo que la quitó y sigue ahí")
      assert.match(authDe(base), /OTRA/, "se llevó puesta otra credencial del docente")
      assert.doesNotMatch(authDe(base), /^﻿/, "reescribió auth.json CON BOM: OpenCode no lo puede leer")
      assert.match(salida, /==> Listo\. Tecnia Bot desinstalado\./, `no dio por cerrada una desinstalación limpia:\n${salida}`)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  },
)

test(
  "FUNCIONAL: auth.json de sólo lectura → dice que la credencial SIGUE y dónde está",
  { skip: !puedeCorrer || !python3 || esRoot },
  () => {
    const base = armarEscuela({ auth: '{"google":{"type":"api","key":"AIzaSECRETO"}}', herramientas: ["python3"] })
    const archivo = join(base, "data", "opencode", "auth.json")
    chmodSync(archivo, 0o444)
    try {
      const salida = desinstalar(base)
      assert.match(authDe(base), /AIzaSECRETO/, "el archivo era de sólo lectura y aun así se escribió: revisar el test")
      assert.doesNotMatch(salida, /Key de Google quitada/, `AFIRMA un borrado que no pasó:\n${salida}`)
      assert.match(salida, /SIGUE EN ESTA COMPUTADORA/, `no le avisa a la docente:\n${salida}`)
      assert.match(salida, new RegExp(archivo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `no dice DÓNDE quedó la credencial:\n${salida}`)
      assert.match(salida, /PARCIALMENTE/, `el resumen final dice que salió todo bien:\n${salida}`)
    } finally {
      chmodSync(archivo, 0o644)
      rmSync(base, { recursive: true, force: true })
    }
  },
)

test(
  "FUNCIONAL: un archivo de la capa que no se puede borrar no se da por borrado",
  { skip: !puedeCorrer || esRoot },
  () => {
    // Con OpenCode abierto en Windows los archivos quedan tomados; en Linux el
    // equivalente es una carpeta sin permiso de escritura. En los dos casos el
    // manifest tiene que sobrevivir: es la lista de lo que falta sacar.
    const base = armarEscuela({ auth: "{}" })
    const carpeta = join(base, "cfg", "opencode", "agent")
    chmodSync(carpeta, 0o555)
    try {
      const salida = desinstalar(base)
      assert.match(salida, /No pude borrar/, `se comió un archivo que no pudo borrar:\n${salida}`)
      assert.match(salida, /PARCIALMENTE/, `dijo "Listo" con la capa a medio sacar:\n${salida}`)
      assert.match(salida, /tecnia-bot\.md/, `no dice QUÉ archivo quedó:\n${salida}`)
      assert.ok(
        readFileSync(join(base, "cfg", "opencode", "tecnia-bot.manifest"), "utf8").includes("agent/tecnia-bot.md"),
        "borró el registro de la instalación con archivos sin sacar: la próxima corrida no va a saber qué falta",
      )
    } finally {
      chmodSync(carpeta, 0o755)
      rmSync(base, { recursive: true, force: true })
    }
  },
)
