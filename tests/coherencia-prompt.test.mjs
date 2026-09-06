// El prompt, los tools y los docs tienen que decir LO MISMO.
//
// POR QUÉ EXISTE ESTE ARCHIVO. Una auditoría encontró que cada pieza estaba
// bien por separado y mal en conjunto: el prompt decía que las acciones de
// `platformio` eran cinco y «no existe ninguna otra» (eran seis: faltaba
// `reparar`); llamaba al parámetro `accion` cuando el schema dice `action`;
// no nombraba cuatro skills que sí existen en `opencode/skills/`; la ayuda y el
// micro-sitio listaban tres comandos de cuatro; y el README contaba 14 skills
// de 16. Ninguna de esas cosas la detecta un test de un archivo solo.
//
// Acá se lee cada fuente de verdad (el enum del tool, las carpetas de skills,
// los archivos de comandos) y se exige que los textos que la describen
// coincidan. Si alguien agrega un skill o un comando y se olvida de un lugar,
// esto se pone rojo y le dice cuál.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (rel) => readFileSync(join(REPO, rel), "utf8")

const prompt = leer("opencode/agent/tecnia-bot.md")
const platformioSrc = leer("opencode/tool/platformio.ts")

/** Las acciones reales de `platformio`, leídas del enum del schema. */
function accionesDelTool() {
  const m = platformioSrc.match(/action:\s*tool\.schema\s*\.enum\(\[([^\]]+)\]\)/)
  assert.ok(m, "no encontré el enum de `action` en platformio.ts")
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))
}

/** Los skills instalados: cada carpeta de opencode/skills con un SKILL.md. */
function skillsReales() {
  const dir = join(REPO, "opencode/skills")
  return readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory() && existsSync(join(dir, d, "SKILL.md")))
}

/** Los comandos instalados: cada opencode/command/*.md → "/nombre". */
function comandosReales() {
  return readdirSync(join(REPO, "opencode/command"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => "/" + f.replace(/\.md$/, ""))
}

test("(a) cada llamada a platformio del prompt usa `action:` y una acción del enum", () => {
  const acciones = accionesDelTool()

  // `action` es el parámetro de platformio y de ningún otro tool (memoria y perfil
  // usan `accion`, con valores guardar/leer). Así que TODO `action: "x"` del
  // prompt es una llamada a platformio, esté o no en la misma línea que la palabra.
  const llamadas = [...prompt.matchAll(/`action:\s*"([^"]+)"`/g)].map((m) => m[1])
  assert.ok(llamadas.length >= 3, `esperaba varias llamadas de ejemplo a platformio, encontré ${llamadas.length}`)
  for (const valor of llamadas) {
    assert.ok(acciones.includes(valor), `"${valor}" no es una acción de platformio (${acciones.join(", ")})`)
  }
  // Las tres que el prompt necesita ejemplificar: diagnóstico para adivinar la
  // placa, monitor para el serial, reparar para instalar lo que falta.
  for (const necesaria of ["diagnostico", "monitor", "reparar"]) {
    assert.ok(llamadas.includes(necesaria), `el prompt no tiene ningún ejemplo \`action: "${necesaria}"\``)
  }

  // Y ninguna variante `accion: "…"` con un valor del enum de platformio: es el
  // defecto original (el schema no tiene ese parámetro, la llamada falla).
  for (const a of acciones) {
    assert.doesNotMatch(prompt, new RegExp(`accion:\\s*"${a}"`),
      `el prompt escribe \`accion: "${a}"\`: platformio no tiene ese parámetro, la llamada falla`)
  }
})

test("(b) el prompt no dice «no existe ninguna otra» acción", () => {
  // Esa frase, con la lista incompleta, hacía que el modelo se negara a usar
  // `reparar`: la única acción que instala lo que falta.
  assert.doesNotMatch(prompt, /no existe ninguna otra/i)

  // Y la línea que enumera las acciones las tiene TODAS.
  const linea = prompt.split("\n").find((l) => l.includes("Las acciones son exactamente"))
  assert.ok(linea, "el prompt tiene que enumerar las acciones válidas")
  for (const a of accionesDelTool()) {
    assert.ok(linea.includes("`" + a + "`"), `la lista de acciones del prompt no tiene \`${a}\``)
  }
})

test("(c) cada skill de opencode/skills/ está nombrado en el prompt", () => {
  const skills = skillsReales()
  assert.ok(skills.length >= 16, `esperaba al menos 16 skills, hay ${skills.length}`)
  const faltan = skills.filter((s) => !prompt.includes("`" + s + "`"))
  assert.deepEqual(faltan, [], `skills instalados que el prompt nunca nombra (el modelo no sabe cuándo cargarlos): ${faltan.join(", ")}`)
})

test("(d) cada comando de opencode/command/ está en la ayuda y en el micro-sitio", () => {
  const comandos = comandosReales()
  assert.ok(comandos.includes("/reparar"), "falta el comando /reparar")

  const ayuda = leer("opencode/tool/ayuda.ts")
  const sitio = leer("opencode/tecniabot-web/sitio/index.html")
  for (const c of comandos) {
    assert.ok(ayuda.includes(c), `ayuda.ts no lista ${c}`)
    assert.ok(sitio.includes("<code>" + c + "</code>"), `el micro-sitio (sitio/index.html) no lista ${c}`)
  }
})

test("(e) el README cuenta los skills y los comandos que hay de verdad", () => {
  const readme = leer("README.md")
  const nSkills = skillsReales().length
  const nComandos = comandosReales().length

  assert.match(readme, new RegExp(`\\*\\*${nSkills} bases de conocimiento\\*\\*`),
    `el README no dice "${nSkills} bases de conocimiento" (hay ${nSkills} skills)`)
  assert.match(readme, new RegExp(`\\*\\*Los ${nSkills} skills:\\*\\*`),
    `el README no dice "Los ${nSkills} skills:"`)
  assert.match(readme, new RegExp(`\\*\\*${nComandos} comandos\\*\\*`),
    `el README no dice "${nComandos} comandos" (hay ${nComandos})`)

  // La lista de skills del README, además de contar bien, tiene que NOMBRAR a cada uno.
  const linea = readme.split("\n").find((l) => l.startsWith("**Los ")) || ""
  const faltan = skillsReales().filter((s) => !linea.includes("`" + s + "`"))
  assert.deepEqual(faltan, [], `skills que faltan en la lista del README: ${faltan.join(", ")}`)

  // Y cada comando aparece en el README.
  for (const c of comandosReales()) assert.ok(readme.includes("`" + c + "`"), `el README no menciona ${c}`)
})

test("la placa en modo aula: prompt, tool y respuesta dicen lo mismo (NO se guarda)", () => {
  // El prompt decía «la placa NO se guarda en modo aula»; la descripción del tool
  // decía «Rol y placa si» y el código la guardaba. Tres versiones de una regla.
  const perfil = leer("opencode/tool/perfil.ts")
  const codigo = perfil.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  assert.doesNotMatch(codigo, /Rol y placa si/i, "la descripción del tool sigue diciendo que en aula guarda la placa")
  assert.doesNotMatch(codigo, /guardo el modo, el rol y la placa/i, "la respuesta del tool sigue diciendo que guardó la placa")
  assert.match(prompt, /placa NO se guarda en modo `aula`/, "el prompt perdió la regla de la placa en aula")
})

test("«falta PlatformIO» tiene UNA sola instrucción: reparar desde el bot, menú inicio como plan B", () => {
  // Había tres: el tool y el prompt decían «hacelo vos, no lo mandes al menú
  // inicio»; pioNoEncontrado() y /diagnostico decían «Menú inicio → Reparar».
  const codigo = platformioSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const i = codigo.indexOf("function pioNoEncontrado")
  const bloque = codigo.slice(i, codigo.indexOf("export default tool", i))
  assert.match(bloque, /action: \\"reparar\\"/, "pioNoEncontrado() no le dice al modelo que repare con action: \"reparar\"")
  assert.match(bloque, /Plan B[\s\S]*Reparar Tecnia Bot/i, "el menú inicio tiene que quedar como plan B, no como primera opción")

  const diag = leer("opencode/command/diagnostico.md")
  assert.match(diag, /action:\s*"reparar"/, "/diagnostico no manda a reparar desde el bot")
  assert.match(diag, /Plan B[\s\S]*Reparar Tecnia Bot/i, "/diagnostico no deja el menú inicio como plan B")

  // En Linux/Mac, el comando concreto: nunca «el instalador oficial de tu sistema».
  assert.doesNotMatch(codigo, /instalador oficial de tu sistema/i, "reparar en Linux/Mac sigue siendo vago")
  assert.match(codigo, /bash install\/bootstrap\.sh/, "reparar en Linux/Mac no da el comando exacto")
})

test("«no encuentro el instalador» dice lo mismo en platformio.ts y en /actualizar", () => {
  const actualizar = leer("opencode/command/actualizar.md")
  const URL = "https://github.com/programadores-obreros/Agente-editor-inet/releases/latest"
  assert.ok(platformioSrc.includes(URL), "platformio.ts no manda a la última release publicada")
  assert.ok(actualizar.includes(URL), "/actualizar no manda a la última release publicada")
  assert.doesNotMatch(actualizar, /vuelva a descargar el proyecto desde GitHub/, "/actualizar conserva el mensaje viejo")
  assert.doesNotMatch(platformioSrc, /tecnialab\.net\.ar\/tecnia-bot\/ y corrilo/, "platformio.ts conserva el mensaje viejo")
})
