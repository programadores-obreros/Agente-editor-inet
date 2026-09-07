// Skill `educabot`: la Educablocks UNO (Arduino UNO con puertos RJ12) y los
// bloques de Educablocks/Robots.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El skill traduce una placa que el docente ya
// tiene en el aula a lo que Tecnia Bot sabe hacer (PlatformIO como `uno`).
// Si alguien lo edita y (a) el modelo chico deja de elegirlo, (b) los puertos
// dobles cambian de pines, (c) el platformio.ini deja de ser un UNO a 9600,
// (d) desaparece la advertencia de que el pinout del RJ12 no está publicado
// o (e) se pierde la equivalencia dht11.h → librerias, el docente recibe un
// consejo que quema un módulo o no compila. Acá se fija cada uno.
//
// Corre con: node --test tests/   (sin dependencias).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const skill = readFileSync(join(REPO, "opencode/skills/educabot/SKILL.md"), "utf8")
const bloques = readFileSync(join(REPO, "opencode/skills/educabot/bloques-a-codigo.md"), "utf8")

/** Frontmatter YAML del skill: `name:` y `description:` como texto plano. */
function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(m, "el skill no arranca con un bloque --- frontmatter ---")
  const campos = {}
  for (const linea of m[1].split("\n")) {
    const kv = linea.match(/^(\w+):\s*(.*)$/)
    if (kv) campos[kv[1]] = kv[2]
  }
  return campos
}

/** La fila de la tabla de puertos cuyo primer campo es `puerto` (con o sin negrita). */
function filaDelPuerto(puerto) {
  const re = new RegExp(`^\\|\\s*\\*{0,2}${puerto}\\*{0,2}\\s*\\|([^|]*)\\|`, "m")
  const m = skill.match(re)
  assert.ok(m, `la tabla de puertos no tiene la fila del puerto ${puerto}`)
  // Se descarta lo que va entre paréntesis ("señal 1 = 3, señal 2 = 2"): ahí el
  // "2" de "señal 2" es un ordinal, no un pin.
  return m[1].replace(/\([^)]*\)/g, "")
}

test("(a) frontmatter válido: name educabot y description que nombra Educablocks y RJ12", () => {
  const fm = frontmatter(skill)
  assert.equal(fm.name, "educabot")
  assert.ok(fm.description && fm.description.length > 40, "la description tiene que ser una frase, no un rótulo")
  assert.match(fm.description, /Educablocks/, "la description no dice Educablocks (el modelo chico no va a elegir el skill)")
  assert.match(fm.description, /RJ12/, "la description no dice RJ12")
})

test("(b) los puertos dobles: 3 → pines 3 y 2, 6 → pines 6 y 7; y nunca habla de GPIO (es un UNO)", () => {
  const p3 = filaDelPuerto(3)
  assert.match(p3, /\b3\b/, "el puerto 3 tiene que llevar el pin 3")
  assert.match(p3, /\b2\b/, "el puerto 3 tiene que llevar también el pin 2 (segunda señal)")
  assert.doesNotMatch(p3, /\b7\b/, "el puerto 3 no lleva el pin 7")

  const p6 = filaDelPuerto(6)
  assert.match(p6, /\b6\b/, "el puerto 6 tiene que llevar el pin 6")
  assert.match(p6, /\b7\b/, "el puerto 6 tiene que llevar también el pin 7 (segunda señal)")
  assert.doesNotMatch(p6, /\b2\b/, "el puerto 6 no lleva el pin 2")

  // Y la prosa que lo explica dice lo mismo que la tabla.
  assert.match(skill, /trigger\s*=?\s*3,?\s*echo\s*=?\s*2/i, "falta la explicación trigger 3 / echo 2")
  assert.match(skill, /trigger\s*=?\s*6,?\s*echo\s*=?\s*7/i, "falta la explicación trigger 6 / echo 7")

  // Un UNO no tiene GPIO: si aparece la palabra, alguien copió pinout de ESP32.
  assert.doesNotMatch(skill, /GPIO/, "el skill dice GPIO: la Educablocks UNO es un UNO, los pines son 2..13 y A0..A5")
  assert.doesNotMatch(bloques, /GPIO/, "bloques-a-codigo.md dice GPIO: es un UNO")
})

test("(c) el platformio.ini es un UNO con monitor a 9600", () => {
  const ini = skill.match(/```ini\s*\n([\s\S]*?)```/)
  assert.ok(ini, "el skill no tiene un bloque ```ini")
  assert.match(ini[1], /^\s*board\s*=\s*uno\b/m, "el platformio.ini no dice board = uno")
  assert.match(ini[1], /^\s*monitor_speed\s*=\s*9600\b/m, "el platformio.ini no dice monitor_speed = 9600 (la velocidad de Educablocks)")
  assert.match(ini[1], /^\s*platform\s*=\s*atmelavr\b/m, "el platformio.ini no dice platform = atmelavr")
  assert.doesNotMatch(ini[1], /esp32/i, "el platformio.ini del skill no puede ser de ESP32")
})

test("(d) dice que el pinout del RJ12 no está documentado y manda a medir con tester", () => {
  assert.match(skill, /RJ12[^\n]*(no está documentado|no publicado)|(no está documentado|no publicado)[^\n]*RJ12/i,
    "el skill tiene que decir que el pinout del RJ12 no está documentado / no publicado")
  assert.match(skill, /tester/i, "tiene que mandar a medir con tester, no a adivinar")
  assert.match(skill, /(nunca|no) (lo )?(adivin|invent)/i, "tiene que prohibir adivinar/inventar el pinout")
})

test("(e) nombra dht11.h (lo que genera Educablocks) y el skill librerias (con qué compila Tecnia Bot)", () => {
  assert.match(skill, /dht11\.h/, "no menciona la librería dht11.h que genera Educablocks")
  assert.ok(skill.includes("`librerias`"), "no remite al skill `librerias`")
  assert.match(skill, /adafruit\/DHT sensor library/, "no da la lib_deps con la que compila Tecnia Bot")
  assert.match(bloques, /dht11\.h/, "bloques-a-codigo.md perdió la equivalencia del DHT11")
})

test("el archivo largo bloque→código existe y el SKILL.md lo referencia", () => {
  assert.ok(skill.includes("bloques-a-codigo.md"), "SKILL.md no referencia bloques-a-codigo.md")
  assert.ok(bloques.length > 2000, "bloques-a-codigo.md está vacío o casi")
})
