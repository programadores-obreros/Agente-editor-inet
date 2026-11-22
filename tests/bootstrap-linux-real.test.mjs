// `install/bootstrap.sh` EJECUTADO DE VERDAD: que una dependencia rota no deje a
// la docente sin Tecnia Bot, y que el «¡Todo listo!» sólo salga si es cierto.
//
// LOS DOS DEFECTOS.
//
// 1. UNA DEPENDENCIA QUE FALLA CORTABA TODO. bootstrap.sh corre con
//    `set -euo pipefail` y tenía tres comandos pelados: `curl … | bash` para
//    OpenCode, `curl -o get-platformio.py` y `python3 get-platformio.py`. Cualquiera
//    que fallara cortaba el script ANTES de `bash install/install.sh`. Sin red, o
//    sin curl, la docente se quedaba sin la capa — contra el propio comentario del
//    script («No se corta: sin PlatformIO el bot igual sirve»). Y el `rm -rf` del
//    temporal quedaba sin correr.
//
// 2. EL CIERRE ERA INCONDICIONAL: «✅ ¡Todo listo!» salía igual con OpenCode sin
//    instalar, sin PlatformIO o con la capa a medias, y el código era 0.
//
// AHORA cada paso va bajo `if`, lo que quedó de cada componente se COMPRUEBA
// (`opencode --version` contesta, un pio contesta `--version`, el agente está en
// disco en la carpeta de config real y install.sh terminó en 0), la capa se
// instala siempre, y el cierre dice lo comprobado: 0 sólo si están las tres cosas,
// 3 si falta una dependencia o hubo avisos, 2 si no quedó la capa.
//
// LAS FALLAS SON REALES, ninguna es un modo de prueba del script:
//   - sin curl ni wget: el PATH es una carpeta armada que no los tiene;
//   - curl que no puede bajar: el curl de verdad contra un proxy que rechaza la
//     conexión (127.0.0.1:9) — no sale un paquete de esta compu;
//   - python3 que existe y falla; un opencode que existe y no contesta --version;
//   - una carpeta de config donde no se puede escribir; un opencode.json roto.
// Los «ya instalados» son ejecutables que contestan --version, puestos donde el
// script los busca (el PATH para opencode, PLATFORMIO_CORE_DIR/penv/bin para pio).
//
// VERIFICADO POR MUTACIÓN (cada una pone rojo este archivo, exit code 1):
//   - sacar el `if !` de la descarga de OpenCode (el comando pelado de antes)
//     → rojo «curl no puede bajar nada» (corta antes de la capa)
//   - la condición del cierre → `if true; then` (el «Todo listo» incondicional)
//     → rojos los siete casos que no están completos
//   - `version_de_opencode` que sólo mira si el comando existe
//     → rojo «un opencode que no contesta --version»
//   - después de correr install.sh, forzar `CAPA="ok"`
//     → rojos «la capa no se pudo instalar» y «la capa quedó CON AVISOS»
//   - borrar `trap limpiar_temporal EXIT`
//     → rojos todos (cada caso mira que no quede nada en TMPDIR)
//
// SIN PROBAR: las dos instalaciones que SÍ salen a Internet (bajar y correr el
// instalador de OpenCode, bajar y correr get-platformio.py) no se ejecutan acá.
// La rama «código 0 de install.sh pero el agente no está en disco» tampoco: no
// encontré una condición real que la produzca. Nada de esto corrió en macOS.
//
// Corre con: node --test tests/bootstrap-linux-real.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { REPO, armarBin, correr, esRoot, nuevoHome, ponerEjecutable, puedeCorrer, rutaDe } from "./ayuda-instalador-sh.mjs"

const BOOTSTRAP = join(REPO, "install", "bootstrap.sh")
const VERSION_OPENCODE = readFileSync(join(REPO, "install", "OPENCODE_VERSION"), "utf8").trim()
const curl = rutaDe("curl")
const python3 = rutaDe("python3")
const jq = rutaDe("jq")
const PROXY_QUE_RECHAZA = { https_proxy: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9" }

/** Un `opencode` en el PATH que contesta --version con la versión fijada. */
function ponerOpenCode(bin) {
  ponerEjecutable(bin, "opencode", `echo "${VERSION_OPENCODE}"`)
}

/**
 * Un PlatformIO «ya instalado»: un pio que contesta --version en
 * PLATFORMIO_CORE_DIR/penv/bin, y las cuatro carpetas de herramientas de las
 * placas ya en disco (así install.sh no intenta bajar 1 GB). Devuelve el env.
 */
function ponerPlatformio(h) {
  const core = join(h.base, "platformio-core")
  mkdirSync(join(core, "penv", "bin"), { recursive: true })
  ponerEjecutable(join(core, "penv", "bin"), "pio", 'echo "PlatformIO Core, version 6.1.18"')
  for (const p of ["toolchain-xtensa-esp32", "framework-arduinoespressif32", "toolchain-atmelavr", "framework-arduino-avr"]) {
    mkdirSync(join(core, "packages", p), { recursive: true })
  }
  return { PLATFORMIO_CORE_DIR: core }
}

/** Corre bootstrap.sh con un TMPDIR propio, para poder mirar que no deje nada. */
function bootstrap(h, { path, env = {} }) {
  const tmp = join(h.base, "tmp")
  mkdirSync(tmp, { recursive: true })
  const r = correr(BOOTSTRAP, h, { path, env: { TECNIA_SIN_PROMPT: "1", TMPDIR: tmp, ...env } })
  return { ...r, sobras: readdirSync(tmp) }
}

const capaEnDisco = (h) => existsSync(join(h.configDir, "agent", "tecnia-bot.md"))

/** El cierre de una instalación incompleta: sin «Todo listo», con resumen AL FINAL. */
function verificarCierreIncompleto(r, etiqueta) {
  assert.doesNotMatch(r.stdout, /Todo listo/, `${etiqueta}: dice «¡Todo listo!» y no es cierto:\n${r.stdout}`)
  const i = r.stdout.lastIndexOf("La instalación NO quedó completa")
  assert.ok(i >= 0, `${etiqueta}: no hay resumen de lo que faltó:\n${r.stdout}`)
  // Después del resumen no hay ninguna otra etapa: es lo último que se lee.
  assert.ok(i > r.stdout.lastIndexOf("Instalando la capa de Tecnia Bot"), `${etiqueta}: el resumen no está al final`)
  assert.deepEqual(r.sobras, [], `${etiqueta}: dejó archivos temporales tirados: ${r.sobras.join(", ")}`)
  return r.stdout.slice(i)
}

test("bootstrap.sh sin curl ni wget: instala la capa IGUAL, dice qué faltó y sale con 3", { skip: !puedeCorrer || !python3 || !jq }, () => {
  const h = nuevoHome()
  try {
    const r = bootstrap(h, { path: armarBin(h.base, ["jq", "python3"]) })
    assert.ok(capaEnDisco(h), `sin curl la docente se quedó sin Tecnia Bot (rc=${r.status}):\n${r.salida}`)
    assert.equal(r.status, 3, `esperaba 3 (capa instalada, faltan dependencias) y salió ${r.status}:\n${r.salida}`)
    const resumen = verificarCierreIncompleto(r, "sin curl ni wget")
    assert.match(resumen, /\[✗\] OpenCode: NO quedó instalado — no hay curl/, resumen)
    assert.match(resumen, /\[✗\] PlatformIO: NO quedó instalado — no hay curl ni wget/, resumen)
    assert.ok(resumen.includes(`[✓] Tecnia Bot: la capa quedó instalada en ${h.configDir}`), resumen)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("bootstrap.sh con curl que no puede bajar nada: no corta, instala la capa, y sale con 3", { skip: !puedeCorrer || !curl || !python3 || !jq }, () => {
  const h = nuevoHome()
  try {
    // El curl de verdad, contra un proxy que rechaza la conexión: es «sin Internet»
    // sin depender de que esta compu esté desconectada.
    const r = bootstrap(h, { path: armarBin(h.base, ["jq", "python3", "curl"]), env: PROXY_QUE_RECHAZA })
    assert.ok(capaEnDisco(h), `una descarga que falla dejó a la docente sin Tecnia Bot (rc=${r.status}):\n${r.salida}`)
    assert.equal(r.status, 3, `esperaba 3 y salió ${r.status}:\n${r.salida}`)
    const resumen = verificarCierreIncompleto(r, "curl sin red")
    assert.match(resumen, /\[✗\] OpenCode: NO quedó instalado — no pude bajar su instalador/, resumen)
    assert.match(resumen, /\[✗\] PlatformIO: NO quedó instalado — no pude bajar su instalador/, resumen)
    assert.match(resumen, /\[✓\] Tecnia Bot: la capa quedó instalada/, resumen)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("bootstrap.sh con un python3 que existe y falla: lo dice con su nombre, no corta, instala la capa", { skip: !puedeCorrer || !jq }, () => {
  const h = nuevoHome()
  try {
    const bin = armarBin(h.base, ["jq"])
    ponerEjecutable(bin, "python3", "exit 1")
    ponerOpenCode(bin)
    const r = bootstrap(h, { path: bin })
    assert.ok(capaEnDisco(h), `un python3 roto dejó a la docente sin Tecnia Bot (rc=${r.status}):\n${r.salida}`)
    assert.equal(r.status, 3, r.salida)
    const resumen = verificarCierreIncompleto(r, "python3 roto")
    assert.match(resumen, /\[✓\] OpenCode: contesta/, resumen)
    assert.match(resumen, /\[✗\] PlatformIO: NO quedó instalado — el python3 que hay \([^)]*python3\) no anda/, resumen)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("bootstrap.sh con un opencode que existe y NO contesta --version: no lo da por instalado", { skip: !puedeCorrer || !jq }, () => {
  const h = nuevoHome()
  try {
    const bin = armarBin(h.base, ["jq", "python3"])
    ponerEjecutable(bin, "opencode", 'echo "opencode: binario roto" >&2\nexit 1')
    const r = bootstrap(h, { path: bin, env: ponerPlatformio(h) })
    assert.equal(r.status, 3, r.salida)
    assert.doesNotMatch(r.stdout, /OpenCode ya está instalado/, `dio por bueno un opencode que no contesta:\n${r.stdout}`)
    const resumen = verificarCierreIncompleto(r, "opencode roto")
    assert.match(resumen, /\[✗\] OpenCode: NO quedó instalado/, resumen)
    assert.match(resumen, /\[✓\] PlatformIO: contesta/, resumen)
    assert.ok(capaEnDisco(h), "no instaló la capa")
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("bootstrap.sh cuando la capa no se puede instalar: sale con 2 y dice que NO quedó", { skip: !puedeCorrer || !jq || esRoot }, () => {
  const h = nuevoHome()
  try {
    const bin = armarBin(h.base, ["jq", "python3"])
    ponerOpenCode(bin)
    // La carpeta de config es un ARCHIVO: install.sh no puede crear nada adentro.
    mkdirSync(h.home, { recursive: true })
    writeFileSync(h.xdgConfig, "esto no es una carpeta\n")
    const r = bootstrap(h, { path: bin, env: ponerPlatformio(h) })
    assert.equal(r.status, 2, `esperaba 2 (la capa NO quedó) y salió ${r.status}:\n${r.salida}`)
    const resumen = verificarCierreIncompleto(r, "capa sin instalar")
    assert.match(resumen, /\[✗\] Tecnia Bot: la capa NO quedó instalada/, resumen)
    assert.match(resumen, /Busqué el agente en .*tecnia-bot\.md y no está/, resumen)
    // Las dependencias sí estaban: el resumen no las arrastra.
    assert.match(resumen, /\[✓\] OpenCode: contesta/, resumen)
    assert.match(resumen, /\[✓\] PlatformIO: contesta/, resumen)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("bootstrap.sh cuando la capa quedó CON AVISOS (opencode.json roto): sale con 3 y no dice «Todo listo»", { skip: !puedeCorrer || !jq }, () => {
  const h = nuevoHome()
  try {
    const bin = armarBin(h.base, ["jq", "python3"])
    ponerOpenCode(bin)
    mkdirSync(h.configDir, { recursive: true })
    writeFileSync(join(h.configDir, "opencode.json"), "{ roto\n")
    const r = bootstrap(h, { path: bin, env: ponerPlatformio(h) })
    assert.equal(r.status, 3, r.salida)
    const resumen = verificarCierreIncompleto(r, "capa con avisos")
    assert.match(resumen, /\[!\] Tecnia Bot: la capa quedó en .* CON AVISOS/, resumen)
    assert.match(r.stdout, /instalado CON AVISOS\. Falta:/, "la lista de install.sh a la que el resumen manda no está en la salida")
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("bootstrap.sh con OpenCode, PlatformIO y la capa comprobados: «¡Todo listo!» y código 0", { skip: !puedeCorrer || !jq }, () => {
  // El contrapeso: si este caso no diera 0, los de arriba pasarían por la razón equivocada.
  const h = nuevoHome()
  try {
    const bin = armarBin(h.base, ["jq", "python3"])
    ponerOpenCode(bin)
    const r = bootstrap(h, { path: bin, env: ponerPlatformio(h) })
    assert.equal(r.status, 0, `con todo en su lugar salió ${r.status}:\n${r.salida}`)
    assert.match(r.stdout, /✅ ¡Todo listo!/, r.stdout)
    assert.doesNotMatch(r.stdout, /NO quedó completa/, r.stdout)
    assert.ok(capaEnDisco(h), "dijo «Todo listo» y la capa no está")
    assert.deepEqual(r.sobras, [], `dejó archivos temporales tirados: ${r.sobras.join(", ")}`)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("bootstrap.sh con sólo wget: PlatformIO se intenta, OpenCode dice que le hace falta curl", { skip: !puedeCorrer || !rutaDe("wget") || !python3 || !jq }, () => {
  const h = nuevoHome()
  try {
    // wget de verdad contra el mismo proxy que rechaza: la descarga falla sin salir.
    const r = bootstrap(h, { path: armarBin(h.base, ["jq", "python3", "wget"]), env: PROXY_QUE_RECHAZA })
    assert.equal(r.status, 3, r.salida)
    const resumen = verificarCierreIncompleto(r, "sólo wget")
    assert.match(resumen, /\[✗\] OpenCode: NO quedó instalado — no hay curl/, resumen)
    // Con wget el instalador de PlatformIO SÍ se intentó bajar (y falló por la red),
    // que no es lo mismo que «no hay con qué bajarlo».
    assert.match(resumen, /\[✗\] PlatformIO: NO quedó instalado — no pude bajar su instalador/, resumen)
    assert.ok(capaEnDisco(h), "no instaló la capa")
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

// ── LAS HERRAMIENTAS DE LAS PLACAS: «¡Todo listo!» SIN CON QUÉ COMPILAR ────────
//
// EL DEFECTO (auditoría integral del 2026-11-21). install.sh baja las
// herramientas de ESP32 y Arduino UNO (más de 1 GB) y, si no puede, «avisa y
// sigue»: está bien que no corte, pero el aviso quedaba arriba y nadie lo volvía
// a mirar. bootstrap.sh sólo preguntaba si un pio contesta --version, así que
// cerraba con «✅ ¡Todo listo!» y código 0 sin las herramientas. La docente se
// enteraba en clase, en la primera compilación: una descarga de más de 1 GB con
// la red del aula, que se corta a los 3 minutos.
//
// AHORA el cierre MIRA EL DISCO después de instalar la capa: las cuatro carpetas
// en <core>/packages. No le cree a install.sh ni al código de `pio pkg install`.
//
// Los pio de acá son ejecutables de verdad puestos donde el script los busca;
// contestan --version y hacen con `pkg install` lo que cada caso necesita. La
// falla es real para el script: no hay un modo de prueba adentro de bootstrap.sh.
//
// VERIFICADO POR MUTACIÓN (cada una pone rojo este archivo, exit code 1):
//   - sacar `&& [ -z "$PLACAS_FALTA" ]` de la condición del cierre
//     → rojos los tres casos de «faltan»
//   - después del bucle que mira el disco, forzar `PLACAS_FALTA=""`
//     → rojos los tres casos de «faltan»
//   - mirar sólo la primera carpeta (`break` al final del cuerpo del bucle)
//     → rojos «no se pueden bajar» (no nombra las cuatro) y «bajó la mitad»
//   - decidir por el código de pio en vez de por el disco no se puede escribir
//     como mutación de una línea; lo cubre «pio dice que anduvo y no dejó nada».
//
// SIN PROBAR: una descarga real de `pio pkg install` (eso lo corre la CI, en el
// job del instalador de Linux), ni una carpeta de herramienta que exista pero
// haya quedado a medio descomprimir: se mira que la carpeta esté, igual que hace
// install.sh para decidir si baja.

const PAQUETES_DE_PLACAS = ["toolchain-xtensa-esp32", "framework-arduinoespressif32", "toolchain-atmelavr", "framework-arduino-avr"]

/**
 * Un PlatformIO que contesta --version pero SIN las herramientas de las placas.
 * `alInstalar` es lo que hace su `pkg install` (un guión de sh).
 */
function ponerPlatformioSinPlacas(h, alInstalar) {
  const core = join(h.base, "platformio-core")
  mkdirSync(join(core, "penv", "bin"), { recursive: true })
  ponerEjecutable(join(core, "penv", "bin"), "pio", [
    'case "$1" in',
    '  --version) echo "PlatformIO Core, version 6.1.18" ;;',
    `  pkg) ${alInstalar} ;;`,
    "  *) exit 64 ;;",
    "esac",
  ].join("\n"))
  return { core, env: { PLATFORMIO_CORE_DIR: core } }
}

function bootstrapConPio(h, alInstalar) {
  const bin = armarBin(h.base, ["jq", "python3"])
  ponerOpenCode(bin)
  const { core, env } = ponerPlatformioSinPlacas(h, alInstalar)
  return { core, r: bootstrap(h, { path: bin, env }) }
}

test("bootstrap.sh cuando las herramientas de las placas no se pueden bajar: sale con 3 y no dice «Todo listo»", { skip: !puedeCorrer || !jq }, () => {
  const h = nuevoHome()
  try {
    const { core, r } = bootstrapConPio(h, 'echo "Error: no pude conectar" >&2; exit 1')
    assert.equal(r.status, 3, `sin las herramientas de las placas esperaba 3 y salió ${r.status}:\n${r.salida}`)
    const resumen = verificarCierreIncompleto(r, "placas sin bajar")
    assert.match(resumen, /\[✓\] PlatformIO: contesta/, resumen)
    assert.match(resumen, /\[✗\] Placas: FALTAN las herramientas/, resumen)
    for (const p of PAQUETES_DE_PLACAS) assert.ok(resumen.includes(p), `el resumen no nombra ${p}:\n${resumen}`)
    assert.ok(resumen.includes(core), `el resumen no dice en qué carpeta las buscó:\n${resumen}`)
    assert.ok(capaEnDisco(h), "no instaló la capa")
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("bootstrap.sh cuando pio dice que anduvo y no dejó nada en disco: le cree al disco, no al código", { skip: !puedeCorrer || !jq }, () => {
  const h = nuevoHome()
  try {
    const { r } = bootstrapConPio(h, "exit 0")
    assert.equal(r.status, 3, `pio salió con 0 sin dejar las herramientas y el instalador le creyó (rc=${r.status}):\n${r.salida}`)
    assert.match(verificarCierreIncompleto(r, "pio miente"), /\[✗\] Placas: FALTAN las herramientas/)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("bootstrap.sh cuando bajó la mitad de las herramientas: nombra sólo las que faltan", { skip: !puedeCorrer || !jq }, () => {
  const h = nuevoHome()
  try {
    // Quedan las de ESP32 y faltan las de Arduino UNO.
    const { r } = bootstrapConPio(h, 'mkdir -p "$PLATFORMIO_CORE_DIR/packages/toolchain-xtensa-esp32" "$PLATFORMIO_CORE_DIR/packages/framework-arduinoespressif32"; exit 1')
    assert.equal(r.status, 3, `con la mitad de las herramientas esperaba 3 y salió ${r.status}:\n${r.salida}`)
    const resumen = verificarCierreIncompleto(r, "placas a medias")
    const renglon = resumen.split("\n").find((l) => l.includes("Placas: FALTAN")) ?? ""
    assert.ok(renglon.includes("toolchain-atmelavr") && renglon.includes("framework-arduino-avr"), `no nombra las que faltan:\n${resumen}`)
    assert.ok(!renglon.includes("toolchain-xtensa-esp32") && !renglon.includes("framework-arduinoespressif32"), `nombra como faltantes las que sí están:\n${resumen}`)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("bootstrap.sh cuando las herramientas se bajan en esta misma corrida: «¡Todo listo!» y código 0", { skip: !puedeCorrer || !jq }, () => {
  // El contrapeso: el disco se mira DESPUÉS de instalar la capa. Si se mirara antes,
  // una instalación limpia que bajó todo bien terminaría en «incompleta».
  const h = nuevoHome()
  try {
    const bajar = PAQUETES_DE_PLACAS.map((p) => `"$PLATFORMIO_CORE_DIR/packages/${p}"`).join(" ")
    const { r } = bootstrapConPio(h, `mkdir -p ${bajar}`)
    assert.equal(r.status, 0, `bajó las herramientas y salió ${r.status}:\n${r.salida}`)
    assert.match(r.stdout, /✅ ¡Todo listo!/, r.stdout)
    assert.doesNotMatch(r.stdout, /NO quedó completa/, r.stdout)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("bootstrap.sh sin PlatformIO: de las placas no dice nada que no haya mirado", { skip: !puedeCorrer || !python3 || !jq }, () => {
  // Sin pio no se pudo ni intentar bajarlas: el renglón de PlatformIO ya dice que
  // no compila, y uno de «Placas» sería un segundo aviso por la misma causa.
  const h = nuevoHome()
  try {
    const r = bootstrap(h, { path: armarBin(h.base, ["jq", "python3"]) })
    const resumen = verificarCierreIncompleto(r, "sin PlatformIO")
    assert.match(resumen, /\[✗\] PlatformIO: NO quedó instalado/, resumen)
    assert.doesNotMatch(resumen, /Placas:/, resumen)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})
