// Permisos del asistente sobre archivos, y el nombre de la sección del código.
//
// POR QUÉ EXISTE (2026-11-26, prueba 9 en la notebook real).
//   1. El docente pidió la guía del semáforo. El asistente cargó el skill `proyectos-inet`, el
//      skill lo mandó a leer `proyectos/01-semaforizacion.md`, y OpenCode se lo negó: el
//      `"*": "deny"` del agente pisaba el permiso que OpenCode agrega solo para la carpeta del
//      skill. Pasaba desde julio, en todas las versiones.
//   2. Al medir el arreglo apareció otro: en `edit` y `write`, el `"*": "ask"` estaba DESPUÉS de
//      los `deny` de `.html` y `.svg`, y en OpenCode gana la última regla que coincide. Escribir
//      un `.html` preguntaba, en vez de estar prohibido.
//   3. El asistente decía «sección Código» y la ventana, «Mirá el programa». El dueño eligió
//      «Mirá el código»: el nombre tiene que ser UNO.
//
// QUÉ MIDEN ESTAS PRUEBAS Y QUÉ NO. Leen el encabezado de `agent/tecnia-bot.md` y lo evalúan con
// la regla de OpenCode («gana la última que coincide», comodín `*`). NO ejecutan OpenCode: que
// OpenCode se comporte así se midió a mano en 1.18.18 (Linux) con el producto instalado y un
// modelo guionado, el 2026-11-26 — leer una ficha: sí; editarla o crear un archivo en skills: no;
// `auth.json`, `opencode.json`, el programa derivado y `tool/programa.ts`: no; escribir `.html` o
// `.svg`: no; escribir otra cosa en la carpeta de trabajo: pregunta. En Windows no se midió.
// Lo que estas pruebas cuidan es que nadie cambie el ORDEN o saque una barra sin que se note.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO } from "./phase2-helpers.mjs"

const AGENTE = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")

/** Las reglas de `permission:` EN ORDEN: [permiso, patrón, acción]. Un permiso sin sub-bloque es el patrón `*`. */
function reglasDe(fuente) {
  const cabecera = /^---\n([\s\S]*?)\n---\n/.exec(fuente)
  assert.ok(cabecera, "el agente no tiene encabezado")
  const lineas = cabecera[1].split("\n")
  const desde = lineas.indexOf("permission:")
  assert.ok(desde >= 0, "el encabezado no tiene permission:")
  const sinComillas = (t) => {
    const s = t.trim()
    // Entre comillas dobles YAML, `\\` es una barra.
    return s.startsWith('"') ? s.slice(1, -1).replaceAll("\\\\", "\\") : s
  }
  const reglas = []
  let bloque = null
  for (const linea of lineas.slice(desde + 1)) {
    if (/^\S/.test(linea)) break
    if (/^\s*(#.*)?$/.test(linea)) continue
    const m = /^( +)(".*?"|[^:#]+):\s*(.*)$/.exec(linea)
    assert.ok(m, `línea de permisos que no entiendo: ${linea}`)
    const [, sangria, clave, valor] = m
    if (sangria.length === 2) {
      if (valor === "") bloque = sinComillas(clave)
      else {
        bloque = null
        reglas.push([sinComillas(clave), "*", sinComillas(valor)])
      }
    } else {
      assert.ok(bloque, `regla anidada sin bloque: ${linea}`)
      reglas.push([bloque, sinComillas(clave), sinComillas(valor)])
    }
  }
  return reglas
}

const comodin = (patron) => new RegExp(`^${patron.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`, "s")
/** La regla de OpenCode: gana la ÚLTIMA que coincide en permiso y en patrón. */
function decide(reglas, permiso, objeto) {
  let accion
  for (const [p, patron, a] of reglas) if (comodin(p).test(permiso) && comodin(patron).test(objeto)) accion = a
  return accion
}

const REGLAS = reglasDe(AGENTE)
const LINUX = "/home/docente/.config/opencode"
const WINDOWS = "C:\\Users\\docente\\.config\\opencode"

test("el lector de permisos lee lo que hay: el deny general va primero y las tools propias quedan permitidas", () => {
  assert.deepEqual(REGLAS[0], ["*", "*", "deny"])
  assert.equal(decide(REGLAS, "programa", "*"), "allow")
  assert.equal(decide(REGLAS, "bash", "ls"), "deny")
  assert.equal(decide(REGLAS, "una-tool-que-no-existe", "*"), "deny")
  // Si el lector se comiera las barras de Windows, las pruebas de abajo no medirían nada.
  assert.ok(REGLAS.some(([p, patron]) => p === "external_directory" && patron === "*\\opencode\\skills\\*"), JSON.stringify(REGLAS.filter(([p]) => p === "external_directory")))
})

test("los archivos de los skills se pueden LEER desde afuera de la carpeta de trabajo, en Linux y en Windows", () => {
  for (const ruta of [`${LINUX}/skills/proyectos-inet/proyectos/01-semaforizacion.md`, `${LINUX}/skills/proyectos-inet/*`, `${WINDOWS}\\skills\\proyectos-inet\\proyectos\\01-semaforizacion.md`, `${WINDOWS}\\skills\\fichas\\*`]) {
    assert.equal(decide(REGLAS, "external_directory", ruta), "allow", ruta)
  }
})

test("lo demás de afuera sigue cerrado: la key, la configuración, las tools y el programa derivado", () => {
  for (const ruta of [
    "/home/docente/.local/share/opencode/auth.json",
    `${LINUX}/opencode.json`,
    `${LINUX}/tool/programa.ts`,
    `${LINUX}/agent/tecnia-bot.md`,
    "/home/docente/.cache/tecnia-bot-programas/x/activo/src/main.cpp",
    "/home/docente/Documentos/otra-cosa/*",
    "C:\\Users\\docente\\AppData\\Local\\TecniaBot-programas\\x\\activo\\src\\main.cpp",
    `${WINDOWS}\\opencode.json`,
    "C:\\Users\\docente\\.local\\share\\opencode\\auth.json",
  ]) {
    assert.equal(decide(REGLAS, "external_directory", ruta), "deny", ruta)
  }
})

test("los skills se leen pero NO se tocan: editar o escribir ahí está prohibido, no «preguntar»", () => {
  for (const permiso of ["edit", "write"]) {
    assert.equal(decide(REGLAS, permiso, `${LINUX}/skills/proyectos-inet/proyectos/01-semaforizacion.md`), "deny", permiso)
    assert.equal(decide(REGLAS, permiso, `${LINUX}/skills/proyectos-inet/intruso.md`), "deny", permiso)
    assert.equal(decide(REGLAS, permiso, `${WINDOWS}\\skills\\fichas\\intruso.md`), "deny", permiso)
  }
})

test("escribir .html o .svg está PROHIBIDO (el «ask» general no lo pisa) y el resto pregunta", () => {
  for (const permiso of ["edit", "write"]) {
    for (const archivo of ["pagina.html", "dibujo.svg", "sub/pagina.html", "/home/docente/trabajo/sub/dibujo.svg"]) assert.equal(decide(REGLAS, permiso, archivo), "deny", `${permiso} ${archivo}`)
    for (const archivo of ["src/main.cpp", "notas.md", "/home/docente/trabajo/platformio.ini"]) assert.equal(decide(REGLAS, permiso, archivo), "ask", `${permiso} ${archivo}`)
  }
})

// ── el nombre de la sección ──────────────────────────────────────────────────────────────────

test("la sección del código se llama igual en la ventana, en la tool, en las instrucciones y en el skill de páginas", () => {
  const pagina = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8")
  const titulo = /<h2\b[^>]*id="t-programa"[^>]*>([^<]+)<\/h2>/.exec(pagina)
  assert.ok(titulo, "la ventana no tiene el título del paso del programa")
  const nombre = titulo[1].trim()
  assert.ok(nombre.length > 3)
  const dondeSeNombra = {
    "tool/programa.ts": readFileSync(join(REPO, "opencode/tool/programa.ts"), "utf8"),
    "agent/tecnia-bot.md": AGENTE,
    "skills/paginas/SKILL.md": readFileSync(join(REPO, "opencode/skills/paginas/SKILL.md"), "utf8"),
  }
  for (const [archivo, texto] of Object.entries(dondeSeNombra)) {
    // Toda mención «sección «X»» que hable del código o del programa tiene que ser el título real.
    const menciones = [...texto.matchAll(/secci[oó]n\s+(?:\*\*)?«([^»]+)»/g)].map((m) => m[1]).filter((n) => /c[oó]digo|programa/i.test(n))
    assert.ok(menciones.length > 0, `${archivo}: no nombra la sección (¿cambió la forma de decirlo? entonces esta prueba no mira nada)`)
    for (const mencion of menciones) assert.equal(mencion, nombre, `${archivo} la llama «${mencion}» y la ventana «${nombre}»`)
  }
})

test("el nombre que la tool le manda decir al asistente es el título de la ventana", async () => {
  const pagina = readFileSync(join(REPO, "opencode/vista-fisica/web/index.html"), "utf8")
  const nombre = /<h2\b[^>]*id="t-programa"[^>]*>([^<]+)<\/h2>/.exec(pagina)[1].trim()
  const { DONDE_VERLO } = await import(join(REPO, "opencode/tool/programa.ts"))
  assert.equal(typeof DONDE_VERLO, "string")
  assert.ok(DONDE_VERLO.includes(`sección «${nombre}»`), DONDE_VERLO)
})
