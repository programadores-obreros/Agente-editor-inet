// `sudo bash install/bootstrap.sh` no puede instalar nada.
//
// POR QUÉ ESTE ARCHIVO. bootstrap.sh e install.sh corrían igual como root. Con
// sudo eso instala para root: o la capa termina en /root y el usuario abre
// opencode y no hay nada, o —si sudo conserva HOME— quedan archivos de root en su
// carpeta personal y después no puede actualizar ni desinstalar. Ningún test lo
// miraba.
//
// EL CASO LEGÍTIMO Y CÓMO SE RESOLVIÓ. Una sesión que ES root de verdad (un
// contenedor de CI, una imagen mínima) no tiene a quién pisarle nada: ahí se
// instala, avisándolo. No hay variable de escape: se mira si alguien se elevó
// desde otra cuenta (SUDO_USER / DOAS_USER / PKEXEC_UID) o si el HOME no es de
// root. Cualquiera de las dos cosas corta con código 4 y sin tocar el disco.
//
// CÓMO SE PRUEBA SIN SER ROOT. Con `unshare -r`: un espacio de usuarios donde el
// proceso es uid 0 DE VERDAD para el kernel (`id -u` contesta 0 sin que nadie le
// mienta) y los archivos propios figuran como de root. No se reemplaza `id` por
// un guión: eso probaría el guión. Donde el sistema no deja crear espacios de
// usuarios sin privilegio (algunas imágenes de CI), los funcionales SE SALTEAN y
// lo dicen: en ese entorno el guard queda sin red.
//
// VERIFICADO POR MUTACIÓN (cada una pone rojo este archivo, exit code 1):
//   - en install.sh, borrar la llamada `cortar_si_es_root_prestado`  → rojos los
//     tres de install.sh que esperan el corte o el aviso
//   - en bootstrap.sh, lo mismo                                     → rojo el de bootstrap.sh
//   - en install.sh, sacar la rama `[ ! -O "${HOME:-}" ]`            → rojo el del HOME ajeno
//
// SIN PROBAR: sudo, doas y pkexec reales (se prueba la marca que dejan en el
// entorno, no el programa). Un `su` a secas no deja marca y NO se detecta.
//
// Corre con: node --test tests/instalador-root.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { REPO, armarBin, correr, nuevoHome, puedeCorrer, rutaDe } from "./ayuda-instalador-sh.mjs"

const INSTALL = join(REPO, "install", "install.sh")
const BOOTSTRAP = join(REPO, "install", "bootstrap.sh")
const sinComentarios = (t) => t.replace(/^\s*#.*$/gm, "")

function cuerpo(archivo) {
  const codigo = sinComentarios(readFileSync(archivo, "utf8"))
  const i = codigo.indexOf("cortar_si_es_root_prestado() {")
  assert.ok(i >= 0, `${archivo} no define cortar_si_es_root_prestado()`)
  const j = codigo.indexOf("\n}\n", i)
  // Tiene que estar la LLAMADA además de la definición, y antes de crear nada.
  const resto = codigo.slice(j + 3)
  const llamada = resto.search(/^cortar_si_es_root_prestado$/m)
  assert.ok(llamada >= 0, `${archivo} define el guard de root y no lo llama`)
  assert.doesNotMatch(resto.slice(0, llamada), /\b(mkdir|cp|curl|mktemp)\b/, `${archivo} hace algo en el disco ANTES de mirar si es root`)
  return codigo.slice(i, j + 3)
}

test("bootstrap.sh e install.sh traen el MISMO guard de root, y lo llaman antes de tocar nada", () => {
  assert.equal(cuerpo(BOOTSTRAP), cuerpo(INSTALL), "el guard de root de bootstrap.sh y el de install.sh no son iguales")
})

// ── Funcionales, como root de verdad adentro de un espacio de usuarios ───────

const unshare = rutaDe("unshare")
const puedeSerRoot = (() => {
  if (!puedeCorrer || !unshare) return false
  const r = spawnSync(unshare, ["-r", "id", "-u"], { encoding: "utf8" })
  return r.status === 0 && r.stdout.trim() === "0"
})()
const saltear = puedeSerRoot ? false : "este sistema no deja crear un espacio de usuarios sin privilegio (`unshare -r`): el guard de root queda SIN probar acá"
const comoRoot = unshare ? [unshare, "-r"] : []

test("FUNCIONAL install.sh con la marca de sudo: corta con código 4 y no crea nada", { skip: saltear }, () => {
  const h = nuevoHome()
  try {
    const path = armarBin(h.base, ["jq"])
    const r = correr(INSTALL, h, { path, envoltorio: comoRoot, env: { TECNIA_SIN_PROMPT: "1", SUDO_USER: "docente" } })
    assert.equal(r.status, 4, `esperaba el corte con código 4 y salió ${r.status}:\n${r.salida}`)
    assert.match(r.salida, /SIN sudo/, r.salida)
    assert.match(r.salida, /docente/, `no dice desde qué cuenta lo lanzaron:\n${r.salida}`)
    assert.equal(existsSync(h.configDir), false, "dijo que no tocó nada y creó la carpeta de config")
    assert.equal(existsSync(h.dataDir), false, "dijo que no tocó nada y creó la carpeta de datos")
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("FUNCIONAL install.sh como root con un HOME que no es de root: corta con código 4", { skip: saltear }, () => {
  const h = nuevoHome()
  try {
    const path = armarBin(h.base, ["jq"])
    // "/" es del root REAL de la máquina: adentro del espacio de usuarios no es del
    // proceso. Es el caso de un sudo que conserva HOME sin dejar SUDO_USER. La
    // config sigue apuntando al temporal (XDG_*), así que si el guard no cortara
    // el instalador escribiría ahí y este test lo vería.
    const r = correr(INSTALL, h, { path, envoltorio: comoRoot, env: { TECNIA_SIN_PROMPT: "1", HOME: "/" } })
    assert.equal(r.status, 4, `esperaba el corte con código 4 y salió ${r.status}:\n${r.salida}`)
    assert.match(r.salida, /carpeta personal que no es de root/, r.salida)
    assert.equal(existsSync(h.configDir), false, "dijo que no tocó nada y creó la carpeta de config")
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("FUNCIONAL install.sh en una sesión que ES root (contenedor de CI): instala y lo avisa", { skip: saltear }, () => {
  const h = nuevoHome()
  try {
    const path = armarBin(h.base, ["jq"])
    const r = correr(INSTALL, h, { path, envoltorio: comoRoot, env: { TECNIA_SIN_PROMPT: "1" } })
    assert.equal(r.status, 0, `una sesión root legítima no pudo instalar (rc=${r.status}):\n${r.salida}`)
    assert.match(r.salida, /Esta sesión es root: Tecnia Bot se instala para root/, `instaló como root sin avisarlo:\n${r.salida}`)
    assert.ok(existsSync(join(h.configDir, "agent", "tecnia-bot.md")), "no instaló la capa")
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("FUNCIONAL bootstrap.sh con la marca de sudo: corta con código 4 antes de instalar nada", { skip: saltear }, () => {
  const h = nuevoHome()
  try {
    // Sin curl ni wget: si el guard no cortara, igual no sale a la red.
    const path = armarBin(h.base, ["jq"])
    const r = correr(BOOTSTRAP, h, { path, envoltorio: comoRoot, env: { TECNIA_SIN_PROMPT: "1", SUDO_USER: "docente" } })
    assert.equal(r.status, 4, `esperaba el corte con código 4 y salió ${r.status}:\n${r.salida}`)
    assert.match(r.salida, /SIN sudo/, r.salida)
    assert.doesNotMatch(r.salida, /Instalando/, `empezó a instalar antes de cortar:\n${r.salida}`)
    assert.equal(existsSync(h.configDir), false, "dijo que no tocó nada y creó la carpeta de config")
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})

test("FUNCIONAL install.sh sin ser root: el guard no molesta ni menciona a root", { skip: !puedeCorrer || (typeof process.getuid === "function" && process.getuid() === 0) }, () => {
  const h = nuevoHome()
  try {
    const path = armarBin(h.base, ["jq"])
    // Con la marca de sudo en el entorno pero SIN ser root: no es el caso que se corta.
    const r = correr(INSTALL, h, { path, env: { TECNIA_SIN_PROMPT: "1", SUDO_USER: "docente" } })
    assert.equal(r.status, 0, r.salida)
    assert.doesNotMatch(r.salida, /root/, `habla de root sin serlo:\n${r.salida}`)
  } finally {
    rmSync(h.base, { recursive: true, force: true })
  }
})
