// `install/update.{ps1,sh}` son lo que corre cuando un docente escribe /actualizar.
//
// POR QUÉ ESTE ARCHIVO. Los dos scripts decían en su comentario que bajaban "el
// último release" y bajaban `refs/heads/main`: la punta de la rama, código sin
// publicar, sin pasar por el smoke test del tag. Y en un clon de git hacían
// `git reset --hard` + `git clean -fd` antes del pull: un dev que corría
// /actualizar desde el bot perdía el trabajo sin commitear. Ningún test miraba
// ninguna de las dos cosas.
//
// La regla del instalador vale acá también: PUEDE FALLAR, PERO NO PUEDE ROMPER.
// Estos tests atan las tres promesas de /actualizar: (1) instala SOLO releases
// publicados, (2) verifica lo que bajó antes de reemplazar nada, (3) nunca
// destruye trabajo local.
//
// Corre con: node --test tests/*.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (r) => readFileSync(join(REPO, r), "utf8")
/** Sin comentarios: acá se explica el bug citándolo, y la cita no es código. */
const sinComentarios = (t) => t.replace(/^\s*#.*$/gm, "")

const SCRIPTS = {
  "install/update.ps1": sinComentarios(leer("install/update.ps1")),
  "install/update.sh": sinComentarios(leer("install/update.sh")),
}
// Los scripts arman la URL con la variable del repo ($Repo / $REPO); se acepta
// la forma interpolada, y aparte se verifica que la variable apunte al repo.
const API_LATEST = /https:\/\/api\.github\.com\/repos\/(\$Repo|\$\{?REPO\}?)\/releases\/latest/

test("no bajan la rama main: solo el último release publicado", () => {
  for (const [r, codigo] of Object.entries(SCRIPTS)) {
    assert.doesNotMatch(codigo, /refs\/heads\/main/,
      `${r} baja la punta de main, que es código sin publicar`)
    assert.match(codigo, API_LATEST,
      `${r} no consulta cuál es el último release (api.github.com/repos/<repo>/releases/latest)`)
    assert.match(codigo, /Repo\s*=\s*"programadores-obreros\/Agente-editor-inet"/i, `${r} no apunta al repo de Tecnia Bot`)
    assert.match(codigo, /tag_name/, `${r} no lee el tag_name de la respuesta de la API`)
    assert.match(codigo, /archive\/refs\/tags\//,
      `${r} no baja el archivo del TAG (archive/refs/tags/<tag>)`)
  }
})

test("le hablan a la API de GitHub con User-Agent (sin eso responde 403)", () => {
  assert.match(SCRIPTS["install/update.ps1"], /Invoke-RestMethod[^\n]*-UserAgent/,
    "update.ps1 llama a la API sin User-Agent")
  assert.match(SCRIPTS["install/update.sh"], /curl[^\n]*(-A|--user-agent)/,
    "update.sh llama a la API sin User-Agent")
  // Y TLS 1.2 explícito: PowerShell 5.1 no lo habilita solo.
  assert.match(SCRIPTS["install/update.ps1"], /SecurityProtocolType\]::Tls12/, "update.ps1 no fuerza TLS 1.2")
})

test("verifican el VERSION descargado contra el tag ANTES de copiar", () => {
  // La verificación existe (está definida), se USA (aparece una segunda vez, la
  // llamada), y la llamada viene antes de la copia sobre la instalación.
  const casos = [
    ["install/update.ps1", "Verificar-Version", /Copy-Item[^\n]*\$RepoDir/],
    ["install/update.sh", "verificar_version", /cp -rf[^\n]*\$REPO_DIR/],
  ]
  for (const [r, marca, copia] of casos) {
    const codigo = SCRIPTS[r]
    const definicion = codigo.indexOf(marca)
    const llamada = codigo.lastIndexOf(marca)
    const copiaIdx = codigo.search(copia)
    assert.ok(definicion >= 0, `${r} no tiene ${marca}`)
    assert.ok(llamada > definicion, `${r} define ${marca} pero nunca la llama`)
    assert.ok(copiaIdx > 0, `${r} ya no copia sobre la instalación (¿cambió la forma?)`)
    assert.ok(llamada < copiaIdx, `${r} copia sobre la instalación ANTES de verificar lo que bajó`)
    // Y la comparación es contra el tag sin la "v": v0.3.75 -> 0.3.75.
    assert.match(codigo, /TrimStart\("v"\)|\$\{2#v\}|#v\}/, `${r} no le saca la "v" al tag para comparar con VERSION`)
  }
})

test("nunca destruyen trabajo local en un clon de git", () => {
  for (const [r, codigo] of Object.entries(SCRIPTS)) {
    assert.doesNotMatch(codigo, /reset\s+--hard/, `${r} hace git reset --hard: borra trabajo sin commitear`)
    assert.doesNotMatch(codigo, /git[^\n]*\bclean\b/, `${r} hace git clean: borra archivos sin commitear`)
    // Lo que SÍ hace, para que arreglarlo no sea borrar el camino de git: mira si
    // hay cambios y, si los hay, se va sin tocar nada.
    assert.match(codigo, /status --porcelain/, `${r} no mira si hay cambios sin commitear antes de tocar el clon`)
    assert.match(codigo, /no toco nada/, `${r} no avisa que aborta sin tocar nada`)
    // Se para en el TAG del release (lo publicado), no en la punta de una rama.
    assert.match(codigo, /fetch --tags/, `${r} no trae los tags`)
    assert.match(codigo, /checkout[^\n]*\$tag/i, `${r} no se para en el tag del release`)
  }
})

test("si ya están en la última, lo dicen y no descargan nada (en los DOS caminos)", () => {
  // Una vez por camino: el clon de git (HEAD ya es el tag) y la copia instalada
  // (VERSION ya es la del tag). Con una sola bastaría para engañar al test.
  for (const [r, codigo] of Object.entries(SCRIPTS)) {
    const veces = (codigo.match(/Ya est[aá]s en la [uú]ltima/g) ?? []).length
    assert.ok(veces >= 2, `${r} reconoce que ya está en la última en ${veces} camino(s); tienen que ser 2 (git y web)`)
  }
})

test("update.ps1 lanza powershell con -NoProfile", () => {
  // Un perfil de PowerShell del usuario (o de la escuela) puede escribir en la
  // consola o fallar, y eso se mezcla con la salida que el bot le muestra al
  // docente. bootstrap.ps1 y el .iss ya lo hacen; acá faltaba.
  const lineas = SCRIPTS["install/update.ps1"].split("\n").filter((l) => /^\s*powershell\b/.test(l))
  assert.ok(lineas.length > 0, "update.ps1 ya no lanza install.ps1 con powershell (¿cambió la forma?)")
  for (const l of lineas) {
    assert.match(l, /-NoProfile/, `update.ps1 lanza powershell sin -NoProfile: ${l.trim()}`)
  }
})

test("la tool actualizar coincide con los scripts: mismo 'latest', -NoProfile, y lo dice", () => {
  const codigo = leer("opencode/tool/actualizar.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  // Misma fuente de "última versión" que los scripts. Si la tool leyera main/VERSION
  // diría "hay una nueva" y el script "ya estás en la última".
  assert.match(codigo, /releases\/latest/, "actualizar.ts no resuelve la última versión por releases/latest")
  assert.doesNotMatch(codigo, /raw\.githubusercontent\.com[^\n]*\/main\/VERSION/,
    "actualizar.ts lee el VERSION de main: código sin publicar, y se contradice con update.ps1")
  assert.match(codigo, /"powershell",\s*"-NoProfile"/, "actualizar.ts lanza update.ps1 sin -NoProfile")
  assert.match(codigo, /release PUBLICADO/, "la descripción de la tool no dice que instala releases publicados")
})

test("docs/rollback.md cuenta que /actualizar sigue a Latest", () => {
  // El paso 2 del rollback (sacar la versión rota de Latest) ahora también
  // protege a /actualizar. Si el doc no lo dice, quien hace el rollback no sabe
  // que ese paso alcanza para los que actualizan desde el bot.
  const doc = leer("docs/rollback.md")
  const i = doc.indexOf("/actualizar")
  assert.ok(i >= 0, "rollback.md no menciona /actualizar")
  assert.match(doc.slice(Math.max(0, i - 300), i + 300), /Latest/,
    "rollback.md menciona /actualizar pero no lo relaciona con el release marcado como Latest")
})
