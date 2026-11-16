// `install/update.sh` EJECUTADO DE VERDAD, de punta a punta, contra un release
// servido desde el disco.
//
// POR QUÉ ESTE ARCHIVO. tests/update-scripts.test.mjs mira el TEXTO de update.sh
// con regex (que el `cp -rf` esté después de `verificar_version`, que la URL sea
// la de releases/latest). Nadie corría el script: el camino sin git —el de la
// instalación empaquetada— no tenía una sola ejecución en la suite. Ahí había
// tres defectos:
//
//   1. COPIAR ENCIMA NO BORRA. `cp -rf "$extracted/." "$REPO_DIR/"` dejaba para
//      siempre en opencode/ lo que el release había eliminado; install.sh lo volvía
//      a publicar y lo anotaba en el manifest como parte de la versión nueva.
//   2. A MEDIAS, Y DICIENDO QUE NO. Si la copia se cortaba quedaba una mezcla de
//      dos versiones bajo el mensaje «la copia instalada quedó como estaba».
//   3. EL SCRIPT SE PISABA A SÍ MISMO mientras bash lo leía.
//
// CÓMO SE INYECTA EL RELEASE SIN UN MODO DE PRUEBA. update.sh acepta
// TECNIA_UPDATE_ESPEJO (documentada en su encabezado): un espejo de GitHub con la
// misma forma, para escuelas que lo tienen bloqueado. Acá el espejo es una
// carpeta (`file:///…`) y lo baja el curl de verdad. No saltea nada: el tag se
// resuelve, el tar se baja, se descomprime y se verifica igual que desde GitHub.
// Y eso también se prueba (el caso del VERSION que no coincide).
//
// VERIFICADO POR MUTACIÓN (cada una pone rojo este archivo, exit code 1):
//   - `reemplazar_copia_maestra "$extracted"` → el `cp -rf "$extracted/." "$REPO_DIR/"`
//     de antes                              → rojo «lo eliminado desaparece»
//   - esa misma, MÁS la última línea `main "$@"; exit $?` → `main "$@"`
//                                           → rojo, y distinto del anterior: update.sh
//                                             termina de instalar, vuelve de main, y bash
//                                             sigue leyendo el update.sh NUEVO desde la mitad
//                                             (medido: sale con código 2, un error de sintaxis
//                                             por arrancar a mitad de una línea). Con sólo la
//                                             primera mutación el script sale con 0: ésa es la
//                                             diferencia que hace el `main … ; exit`.
//   - `verificar_version` que devuelve 0 siempre → rojo «VERSION que no coincide»
//   - los `deshacer_reemplazo ||` del paso 3 → `true ||`  → rojo «falla a mitad del reemplazo»
//   - `recuperar_de_un_corte || exit 5` → `true`          → rojo «una corrida que se cortó»
//   - el `case` que valida el espejo, sacado → rojo «un espejo por http plano»
//   - en leer_tag_name, `elif python3_anda` → `elif command -v python3 >/dev/null 2>&1`
//                                           → rojo «python3 roto y sin jq» (y el guard de
//                                             tests/python3-que-anda.test.mjs)
//   - el `exit 3` de «actualizado CON AVISOS», sacado     → rojo «CON AVISOS»
//
// LO QUE EL `main "$@"; exit $?` PROTEGE HOY. Desde que install/ se cambia con un
// rename, bash sigue leyendo el archivo VIEJO (su inodo no se toca) y el script ya
// no se pisa aunque no tuviera `main`. El envoltorio es la segunda barrera: la
// segunda mutación de la lista lo muestra mordiendo, pero sólo junto con la
// primera. Sacando SÓLO el envoltorio este archivo sigue verde, y está dicho acá
// para que nadie crea que hay más red de la que hay. La forma la cuida el último
// test (que es un chequeo de texto, no una ejecución).
//
// SIN PROBAR: el camino de un clon de git (necesita un `origin` con tags; no se
// tocó su lógica). Un espejo https:// real. wget como descargador (no abre
// file:///). Disco lleno de verdad. La rama «a-medias» (no pude volver atrás).
// macOS / bash 3.2 / cp y tar de BSD.
//
// Corre con: node --test tests/update-linux-real.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { REPO, armarBin, correr, esRoot, nuevoHome, ponerEjecutable, puedeCorrer, rutaDe } from "./ayuda-instalador-sh.mjs"

const curl = rutaDe("curl")
const tar = rutaDe("tar")
const jq = rutaDe("jq")
const python3 = rutaDe("python3")
const saltear = !puedeCorrer || !curl || !tar ? "hace falta bash, curl y tar" : false

const VIEJA = "0.0.1"
const NUEVA = "9.9.9"
const BORRADO_UPSTREAM = join("opencode", "command", "borrado-en-el-release.md")
const NUEVO_UPSTREAM = join("opencode", "command", "nuevo-en-el-release.md")

/** Huella de un árbol: ruta relativa + modo + sha del contenido de cada archivo. */
function huella(dir) {
  const filas = []
  const andar = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const ruta = join(d, e.name)
      if (e.isDirectory()) { filas.push(`${relative(dir, ruta)}/`); andar(ruta) }
      else if (e.isFile()) filas.push(`${relative(dir, ruta)} ${(statSync(ruta).mode & 0o777).toString(8)} ${createHash("sha256").update(readFileSync(ruta)).digest("hex")}`)
    }
  }
  andar(dir)
  return filas.join("\n")
}

/** Copia del árbol de trabajo las tres cosas que hacen a una instalación empaquetada. */
function copiarFuente(destino, version) {
  mkdirSync(destino, { recursive: true })
  cpSync(join(REPO, "opencode"), join(destino, "opencode"), { recursive: true })
  cpSync(join(REPO, "install"), join(destino, "install"), { recursive: true })
  writeFileSync(join(destino, "VERSION"), `${version}\n`)
}

/**
 * La escena: una instalación empaquetada (sin .git) en la versión vieja, ya
 * instalada en el HOME, y un espejo en disco con un release más nuevo.
 *   - la instalada tiene un archivo que el release ya no trae (BORRADO_UPSTREAM),
 *     un archivo propio del usuario, y docs/ viejos;
 *   - el release trae un archivo nuevo, docs/ nuevos, y —a propósito— un
 *     install/update.sh que no es este: si bash llegara a leerlo a mitad de la
 *     corrida, imprime PISADO y sale con 97.
 */
function armarEscena(h, { path, versionDelTar = NUEVA, tagDelEspejo = `v${NUEVA}`, instalarAntes = true } = {}) {
  const repo = join(h.base, "Tecnia Bot instalado")
  copiarFuente(repo, VIEJA)
  writeFileSync(join(repo, BORRADO_UPSTREAM), "---\ndescription: comando que el release nuevo eliminó\n---\n")
  writeFileSync(join(repo, "mis-apuntes.txt"), "esto es del docente\n")
  mkdirSync(join(repo, "docs"))
  writeFileSync(join(repo, "docs", "viejo.md"), "doc de la versión vieja\n")

  const espejo = join(h.base, "espejo")
  const armado = join(h.base, "armado")
  const raiz = join(armado, `Agente-editor-inet-${versionDelTar}`)
  copiarFuente(raiz, versionDelTar)
  writeFileSync(join(raiz, NUEVO_UPSTREAM), "---\ndescription: comando que llega con el release\n---\n")
  mkdirSync(join(raiz, "docs"))
  writeFileSync(join(raiz, "docs", "nuevo.md"), "doc de la versión nueva\n")
  writeFileSync(join(raiz, ".gitignore"), "node_modules\n")
  writeFileSync(join(raiz, "install", "update.sh"), "#!/usr/bin/env bash\n" + "echo PISADO bash siguio leyendo el update.sh NUEVO a mitad de la corrida; exit 97\n".repeat(3000))
  mkdirSync(join(espejo, "releases"), { recursive: true })
  mkdirSync(join(espejo, "archive", "refs", "tags"), { recursive: true })
  writeFileSync(join(espejo, "releases", "latest"), JSON.stringify({ tag_name: tagDelEspejo, name: "release de prueba" }, null, 2) + "\n")
  const t = spawnSync(tar, ["czf", join(espejo, "archive", "refs", "tags", `${tagDelEspejo}.tar.gz`), "-C", armado, `Agente-editor-inet-${versionDelTar}`], { encoding: "utf8" })
  assert.equal(t.status, 0, `no pude armar el tar del release: ${t.stderr}`)

  if (instalarAntes) {
    const r = correr(join(repo, "install", "install.sh"), h, { path, env: { TECNIA_SIN_PROMPT: "1" } })
    assert.equal(r.status, 0, `la instalación previa falló:\n${r.salida}`)
    assert.ok(existsSync(join(h.configDir, "command", "borrado-en-el-release.md")), "la escena está mal armada: el archivo viejo no llegó a instalarse")
  }
  return { repo, espejo, env: { TECNIA_UPDATE_ESPEJO: `file://${espejo}` } }
}

const actualizar = (h, escena, path, env = {}) =>
  correr(join(escena.repo, "install", "update.sh"), h, { path, env: { ...escena.env, ...env }, cwd: escena.repo })
const manifest = (h) => readFileSync(join(h.configDir, "tecnia-bot.manifest"), "utf8")
const version = (repo) => readFileSync(join(repo, "VERSION"), "utf8").trim()
const sinRestos = (repo) => readdirSync(repo).filter((n) => n.startsWith(".tecnia-update"))

test("update.sh sin git: lo que el release eliminó DESAPARECE del proyecto, de la instalación y del manifest", { skip: saltear || !jq }, () => {
  const h = nuevoHome("tecnia-update-")
  try {
    const path = armarBin(h.base, ["curl", "jq", "python3"])
    const escena = armarEscena(h, { path })
    const r = actualizar(h, escena, path)
    assert.doesNotMatch(r.salida, /PISADO/, `bash ejecutó el update.sh nuevo a mitad de la corrida:\n${r.salida}`)
    // Si bash cae en la mitad de una línea del archivo nuevo no llega a imprimir
    // PISADO: sale con «command not found». Por eso el código se mira también.
    assert.equal(r.status, 0, `update.sh salió con ${r.status} (¿siguió leyendo el archivo nuevo?):\n${r.salida}`)
    assert.match(r.stdout, new RegExp(`Fuente actualizado a v${NUEVA.replace(/\./g, "\\.")}`), r.stdout)
    assert.match(r.stdout, /TECNIA_UPDATE_ESPEJO está definida: el release NO sale de GitHub/, "usa un espejo y no lo dice")

    // El proyecto.
    assert.equal(version(escena.repo), NUEVA)
    assert.equal(existsSync(join(escena.repo, BORRADO_UPSTREAM)), false, "lo que el release eliminó sigue en opencode/: se va a reinstalar para siempre")
    assert.ok(existsSync(join(escena.repo, NUEVO_UPSTREAM)), "lo nuevo del release no llegó")
    assert.match(readFileSync(join(escena.repo, "install", "update.sh"), "utf8"), /PISADO/, "install/ no se reemplazó por la del release")
    assert.equal(readFileSync(join(escena.repo, "mis-apuntes.txt"), "utf8"), "esto es del docente\n", "se llevó puesto un archivo del docente")
    assert.ok(existsSync(join(escena.repo, "docs", "nuevo.md")), "el resto del release (docs) no se copió")
    assert.ok(existsSync(join(escena.repo, ".gitignore")), "los archivos ocultos del release no se copiaron")
    assert.deepEqual(sinRestos(escena.repo), [], "dejó carpetas de trabajo tiradas en el proyecto")

    // La instalación: install.sh corrió sobre lo nuevo.
    assert.equal(existsSync(join(h.configDir, "command", "borrado-en-el-release.md")), false, "el comando eliminado sigue instalado en la config de OpenCode")
    assert.ok(existsSync(join(h.configDir, "command", "nuevo-en-el-release.md")), "el comando nuevo no se instaló")
    assert.match(manifest(h), new RegExp(`^version=${NUEVA.replace(/\./g, "\\.")}$`, "m"), "el manifest no quedó en la versión nueva")
    assert.doesNotMatch(manifest(h), /borrado-en-el-release/, "el manifest sigue listando un archivo que el release eliminó")
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("update.sh con un VERSION que no coincide con el tag: no instala y la copia queda byte a byte igual", { skip: saltear || !jq }, () => {
  const h = nuevoHome("tecnia-update-")
  try {
    const path = armarBin(h.base, ["curl", "jq", "python3"])
    // El espejo dice v9.9.9 y el tar trae 9.9.8: lo bajado no es lo pedido.
    const escena = armarEscena(h, { path, versionDelTar: "9.9.8" })
    const antes = huella(escena.repo)
    const manifestAntes = manifest(h)
    const r = actualizar(h, escena, path)
    assert.notEqual(r.status, 0, `instaló algo que no era el release pedido:\n${r.salida}`)
    assert.match(r.salida, /dice versión 9\.9\.8 y el release es 9\.9\.9/, r.salida)
    assert.match(r.salida, /La copia instalada quedó como estaba/, r.salida)
    assert.equal(huella(escena.repo), antes, "dijo «quedó como estaba» y el proyecto cambió")
    assert.equal(manifest(h), manifestAntes, "reinstaló la capa después de rechazar el release")
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("update.sh cuando no puede escribir en el proyecto: no toca nada y lo dice", { skip: saltear || !jq || esRoot }, () => {
  const h = nuevoHome("tecnia-update-")
  let repo
  try {
    const path = armarBin(h.base, ["curl", "jq", "python3"])
    const escena = armarEscena(h, { path })
    repo = escena.repo
    const antes = huella(repo)
    chmodSync(repo, 0o555)
    const r = actualizar(h, escena, path)
    chmodSync(repo, 0o755)
    assert.notEqual(r.status, 0, r.salida)
    assert.match(r.salida, /No llegué a tocar nada: la copia instalada quedó como estaba/, r.salida)
    assert.equal(huella(repo), antes, "dijo «quedó como estaba» y el proyecto cambió")
    assert.match(manifest(h), new RegExp(`^version=${VIEJA.replace(/\./g, "\\.")}$`, "m"), "reinstaló la capa sin haber actualizado")
  } finally {
    if (repo) try { chmodSync(repo, 0o755) } catch { /* ya está */ }
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("update.sh con una falla a mitad del reemplazo: VUELVE ATRÁS opencode/ e install/, y no dice «quedó como estaba»", { skip: saltear || !jq || esRoot }, () => {
  const h = nuevoHome("tecnia-update-")
  let docs
  try {
    const path = armarBin(h.base, ["curl", "jq", "python3"])
    const escena = armarEscena(h, { path })
    docs = join(escena.repo, "docs")
    const opencodeAntes = huella(join(escena.repo, "opencode"))
    const installAntes = huella(join(escena.repo, "install"))
    // docs/ sin permiso de escritura: el release trae docs/nuevo.md y no lo puede
    // copiar. A esa altura opencode/ e install/ YA se cambiaron por los nuevos.
    chmodSync(docs, 0o555)
    const r = actualizar(h, escena, path)
    chmodSync(docs, 0o755)
    assert.notEqual(r.status, 0, `dio por buena una actualización que no pudo terminar:\n${r.salida}`)
    assert.equal(version(escena.repo), VIEJA, "VERSION cambió con la actualización sin terminar")
    assert.equal(huella(join(escena.repo, "opencode")), opencodeAntes, "opencode/ no volvió a ser el de antes: la copia quedó a medias")
    assert.equal(huella(join(escena.repo, "install")), installAntes, "install/ no volvió a ser el de antes")
    assert.deepEqual(sinRestos(escena.repo), [], "dejó carpetas de trabajo tiradas en el proyecto")
    assert.match(r.salida, /Volví atrás: opencode\/ e install\/ son otra vez los de la versión 0\.0\.1/, r.salida)
    // A esta altura SÍ se tocaron cosas (y se deshicieron): decir que no se tocó nada sería mentir.
    assert.doesNotMatch(r.salida, /No llegué a tocar nada|quedó como estaba/, `afirma que no tocó nada después de haber reemplazado y deshecho:\n${r.salida}`)
    assert.match(manifest(h), new RegExp(`^version=${VIEJA.replace(/\./g, "\\.")}$`, "m"), "reinstaló la capa sin haber actualizado")
    assert.ok(existsSync(join(h.configDir, "command", "borrado-en-el-release.md")), "desinstaló archivos de una versión que sigue siendo la instalada")
  } finally {
    if (docs) try { chmodSync(docs, 0o755) } catch { /* ya está */ }
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("update.sh después de una corrida que se cortó a mitad del reemplazo: devuelve las carpetas viejas antes de seguir", { skip: saltear || !jq }, () => {
  const h = nuevoHome("tecnia-update-")
  try {
    const path = armarBin(h.base, ["curl", "jq", "python3"])
    // El espejo publica la MISMA versión que hay instalada: la corrida no baja nada.
    const escena = armarEscena(h, { path, versionDelTar: VIEJA, tagDelEspejo: `v${VIEJA}` })
    const opencodeAntes = huella(join(escena.repo, "opencode"))
    // Lo que deja en el disco un update.sh al que le cortaron la luz entre los dos
    // `mv` de opencode/: la carpeta vieja apartada, una nueva a medio poner, y
    // VERSION todavía en la de antes.
    const viejo = join(escena.repo, ".tecnia-update-viejo")
    mkdirSync(viejo)
    writeFileSync(join(viejo, "VERSION_ANTERIOR"), `${VIEJA}\n`)
    cpSync(join(escena.repo, "opencode"), join(viejo, "opencode"), { recursive: true })
    rmSync(join(escena.repo, "opencode"), { recursive: true })
    mkdirSync(join(escena.repo, "opencode", "agent"), { recursive: true })
    writeFileSync(join(escena.repo, "opencode", "agent", "tecnia-bot.md"), "media carpeta de otra versión\n")
    mkdirSync(join(escena.repo, ".tecnia-update-nuevo"))

    const r = actualizar(h, escena, path)
    assert.equal(r.status, 0, `update.sh salió con ${r.status}:\n${r.salida}`)
    assert.match(r.stdout, /Una actualización anterior se cortó a la mitad: devolví opencode\/ e install\/ a la versión 0\.0\.1/, r.stdout)
    assert.equal(huella(join(escena.repo, "opencode")), opencodeAntes, "opencode/ no volvió a ser el de la versión instalada")
    assert.deepEqual(sinRestos(escena.repo), [], "dejó los restos de la corrida cortada")
    assert.doesNotMatch(readFileSync(join(h.configDir, "agent", "tecnia-bot.md"), "utf8"), /media carpeta/, "instaló la carpeta a medias")
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("update.sh con un espejo por http plano: se niega antes de bajar nada", { skip: saltear }, () => {
  const h = nuevoHome("tecnia-update-")
  try {
    const path = armarBin(h.base, ["curl", "jq", "python3"])
    const escena = armarEscena(h, { path, instalarAntes: false })
    const antes = huella(escena.repo)
    // 127.0.0.1:9 no escucha: si la validación no cortara, curl fallaría solo, sin
    // salir de esta compu, y el mensaje sería otro.
    const r = actualizar(h, escena, path, { TECNIA_UPDATE_ESPEJO: "http://127.0.0.1:9/tecnia" })
    assert.notEqual(r.status, 0, r.salida)
    assert.match(r.salida, /TECNIA_UPDATE_ESPEJO tiene que empezar con https:\/\/ o con file:\/\/\//, r.salida)
    assert.doesNotMatch(r.salida, /No pude consultar/, `intentó bajar del espejo inseguro:\n${r.salida}`)
    assert.equal(huella(escena.repo), antes)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("update.sh con python3 roto y sin jq: lee el tag igual (por sed), actualiza, y sale con 3 porque la config no se pudo mergear", { skip: saltear }, () => {
  const h = nuevoHome("tecnia-update-")
  try {
    const path = armarBin(h.base, ["curl"])
    ponerEjecutable(path, "python3", "exit 1")
    const escena = armarEscena(h, { path })
    const r = actualizar(h, escena, path)
    assert.equal(version(escena.repo), NUEVA, `con un python3 que no anda no pudo ni leer el tag:\n${r.salida}`)
    assert.equal(existsSync(join(escena.repo, BORRADO_UPSTREAM)), false)
    // Sin jq ni python3, install.sh no puede mergear un opencode.json que ya existe:
    // es «instalado CON AVISOS», y update.sh lo tiene que pasar tal cual.
    assert.equal(r.status, 3, `esperaba 3 (actualizado CON AVISOS) y salió ${r.status}:\n${r.salida}`)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("update.sh cuando install.sh termina CON AVISOS: sale con 3 y la lista de lo que falta queda en la cola que muestra /actualizar", { skip: saltear || !jq }, () => {
  const h = nuevoHome("tecnia-update-")
  try {
    const path = armarBin(h.base, ["curl", "jq", "python3"])
    const escena = armarEscena(h, { path })
    writeFileSync(join(h.configDir, "opencode.json"), "{ roto\n")
    const r = actualizar(h, escena, path)
    assert.equal(r.status, 3, `esperaba 3 y salió ${r.status}:\n${r.salida}`)
    assert.equal(version(escena.repo), NUEVA, "los archivos nuevos no se copiaron")
    assert.doesNotMatch(r.stdout, /==> Tecnia Bot actualizado\. Reiniciá/, `cierra como una actualización limpia:\n${r.stdout}`)
    assert.match(r.stdout.trimEnd().split("\n").slice(-3).join("\n"), /actualizado CON AVISOS/, "«CON AVISOS» no es lo último que se lee")
    // opencode/tool/actualizar.ts le muestra al docente los últimos 2000 caracteres
    // de stdout cuando el código es 3: la lista de install.sh tiene que entrar.
    const tool = readFileSync(join(REPO, "opencode", "tool", "actualizar.ts"), "utf8")
    const cuanto = Number(tool.match(/out\.slice\(-(\d+)\)[^\n]*err\.slice/)?.[1])
    assert.ok(cuanto > 0, "actualizar.ts ya no muestra la cola de stdout con el código 3")
    const cola = r.stdout.slice(-cuanto)
    assert.match(cola, /instalado CON AVISOS\. Falta:/, `la lista de lo que falta quedó fuera de la cola de ${cuanto} caracteres`)
    assert.ok(cola.includes(join(h.configDir, "opencode.json")), "la cola no nombra el archivo que quedó sin escribir")
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("update.sh: todo el cuerpo vive en funciones y la última línea es `main \"$@\"; exit $?` (chequeo de FORMA)", () => {
  // No es una red por ejecución (ver el encabezado): cuida que nadie vuelva a
  // dejar código suelto después de las funciones, que es lo que bash seguiría
  // leyendo del disco a mitad de la corrida.
  const lineas = readFileSync(join(REPO, "install", "update.sh"), "utf8").trimEnd().split("\n")
  assert.equal(lineas.at(-1), 'main "$@"; exit $?', "la última línea de update.sh no es la llamada a main con su exit")
  const iMain = lineas.indexOf("main() {")
  const finMain = lineas.indexOf("}", iMain)
  assert.ok(iMain > 0 && finMain > iMain, "update.sh no tiene main()")
  const sueltas = lineas.slice(finMain + 1, -1).filter((l) => l.trim() && !l.trim().startsWith("#"))
  assert.deepEqual(sueltas, [], "hay código suelto entre el final de main() y su llamada")
})
