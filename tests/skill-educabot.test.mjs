// Skill `educabot`: la Educablocks UNO (Arduino UNO con puertos RJ12) y los
// bloques de Educablocks/Robots.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El skill traduce una placa que el docente ya
// tiene en el aula a lo que Tecnia Bot sabe hacer (PlatformIO como `uno`).
// Si alguien lo edita y (a) el modelo chico deja de elegirlo, (b) los puertos
// dobles cambian de pines, (c) el platformio.ini deja de ser un UNO a 9600,
// (d) desaparece la advertencia de que el orden de los contactos del RJ12 no
// está publicado, (e) se pierde la equivalencia dht11.h → librerias, o (f) se
// pierden los datos del Libro de actividades oficial (tercer pin PWM de los
// puertos especiales, matriz en IIC), el docente recibe un consejo que quema un
// módulo o no compila. Acá se fija cada uno.
//
// Corre con: node --test tests/   (sin dependencias).

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
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

/** La fila de la tabla de puertos cuyo primer campo es `puerto` (con o sin negrita, con o sin "(E3)"). */
function filaDelPuerto(puerto) {
  const re = new RegExp(`^\\|\\s*\\*{0,2}${puerto}\\*{0,2}\\s*(?:\\(E\\d\\))?\\s*\\|([^|]*)\\|`, "m")
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

test("(d) dice que el orden de los contactos del RJ12 no está publicado y manda a medir con tester", () => {
  assert.match(skill, /contactos del RJ12[^\n]*no (está )?publicad|RJ12[^\n]*no (está )?(documentad|publicad)/i,
    "el skill tiene que decir que el orden de los contactos del RJ12 no está publicado")
  assert.match(skill, /tester/i, "tiene que mandar a medir con tester, no a adivinar")
  assert.match(skill, /(nunca|no) (lo )?(adivin|invent)/i, "tiene que prohibir adivinar/inventar el pinout")
})

test("(e) nombra dht11.h (lo que genera Educablocks) y el skill librerias (con qué compila Tecnia Bot)", () => {
  assert.match(skill, /dht11\.h/, "no menciona la librería dht11.h que genera Educablocks")
  assert.ok(skill.includes("`librerias`"), "no remite al skill `librerias`")
  assert.match(skill, /adafruit\/DHT sensor library/, "no da la lib_deps con la que compila Tecnia Bot")
  assert.match(bloques, /dht11\.h/, "bloques-a-codigo.md perdió la equivalencia del DHT11")
})

test("(f) los datos del Libro de actividades: tercer pin PWM y VIN en E3/E4/E6, velocidad por 11/9/10, matriz en IIC, Bluetooth después de cargar", () => {
  // Puertos especiales: dos señales + un PWM propio. Si alguien vuelve a "3+2"
  // a secas, el docente pierde el pin 11 sin saberlo cuando el motor lleva velocidad.
  assert.match(filaDelPuerto(3), /\b11\b/, "el E3 tiene que llevar también el pin 11 (PWM del especial)")
  const p4 = filaDelPuerto(4)
  assert.match(p4, /\b4\b/); assert.match(p4, /\b5\b/); assert.match(p4, /\b9\b/, "el E4 lleva 4, 5 y 9")
  assert.match(filaDelPuerto(6), /\b10\b/, "el E6 tiene que llevar también el pin 10 (PWM del especial)")
  assert.match(skill, /VIN/, "los especiales llevan VIN para el driver de motores")

  // La velocidad del motor NO va por el pin de dirección. La versión anterior del
  // skill decía analogWrite(3, velocidad) y el libro (p. 72) lo desmiente.
  assert.doesNotMatch(skill, /analogWrite\(\s*3\s*,/, "la velocidad del motor no va por analogWrite(3, …)")
  assert.doesNotMatch(bloques, /analogWrite[^|\n]*\(3 o 6\)/, "bloques-a-codigo.md volvió a decir que la velocidad va por 3 o 6")
  assert.match(skill, /analogWrite\(\s*11\s*,/, "tiene que decir analogWrite(11, …) para el E3")
  assert.match(skill, /jumper/i, "tiene que nombrar los jumpers del puente H (2 señales vs 3)")

  // Matriz: el libro la conecta al IIC. Tiene que estar en la fila del catálogo.
  const filaMatriz = skill.match(/^\|\s*Matriz LED 8x8[^\n]*$/m)
  assert.ok(filaMatriz, "el catálogo perdió la fila de la matriz 8x8")
  assert.match(filaMatriz[0], /IIC/, "la matriz del libro va al puerto IIC")

  // Bluetooth: cargar primero, conectar después (libro, p. 68).
  assert.match(skill, /después de (haber )?carga/i, "falta la instrucción de conectar el Bluetooth después de cargar")

  // La fuente y el permiso quedan referenciados y existen en el repo.
  assert.match(skill, /Libro de actividades/, "no cita el Libro de actividades")
  assert.ok(skill.includes("docs/permisos/educabot.md"), "no remite al registro del permiso del fabricante")
  assert.ok(existsSync(join(REPO, "docs/permisos/educabot.md")), "falta docs/permisos/educabot.md")
  assert.ok(existsSync(join(REPO, "docs/educabot/educablocks-uno-conectores.png")), "falta el diagrama de conectores en docs/educabot/")
})

test("(g) la dirección del LCD: 0x27 sin avisar, y el «hasta hoy» queda escrito", () => {
  // Salió de probar el bot con un display en el puerto IIC del Bhoot. Avisaba SIEMPRE
  // que "si no muestra nada es que usa la 0x3F". El dato era correcto y el aviso
  // sobraba: en los kits de Educabot vistos hasta hoy la mochila fue siempre 0x27.
  // Un aviso sobre algo que no pasa nunca entrena al docente a ignorar los avisos.
  //
  // Pero "siempre" acá es una costumbre OBSERVADA, no una garantía: el propio bloque
  // «LCD I2C» de Educablocks ofrece 0x27/0x3F como parámetro elegible. Por eso el
  // skill tiene que decir "hasta hoy" y no "es": si mañana entra un lote con 0x3F,
  // el que lo lea tiene que saber qué evidencia había, no adivinar quién lo escribió.
  assert.match(skill, /hasta hoy/i, "el skill afirma la dirección como un hecho: falta el «hasta hoy» y su evidencia")
  assert.match(skill, /sin preguntar y sin avisar/i, "no dice que con el kit se pone 0x27 y se sigue, sin aviso preventivo")

  // El discriminador tiene que ser MIRAR el chip, no probar direcciones a ciegas.
  assert.match(skill, /PCF8574A/, "no dice cómo distinguir las dos mochilas mirando el chip")
  assert.match(skill, /una sola letra/i, "no explica que la diferencia visible es la A final")

  // Y la trampa: el síntoma «luz sí, letras no» también lo da un LCD a 3,3 V. Acá no
  // aplica porque el RJ12 garantiza los 5 V — pero eso tiene que estar dicho, para que
  // nadie copie la frase a un montaje con cables sueltos.
  assert.match(skill, /el síntoma es el mismo|síntoma deja de ser ambiguo/i,
    "no avisa que el mismo síntoma lo da la alimentación a 3,3 V en montajes con cables sueltos")
})

test("el archivo largo bloque→código existe y el SKILL.md lo referencia", () => {
  assert.ok(skill.includes("bloques-a-codigo.md"), "SKILL.md no referencia bloques-a-codigo.md")
  assert.ok(bloques.length > 2000, "bloques-a-codigo.md está vacío o casi")
})
