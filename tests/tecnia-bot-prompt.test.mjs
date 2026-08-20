// Smoke tests del prompt del agente (opencode/agent/tecnia-bot.md).
// Verifica, por substrings, que las reglas críticas de "ejecutá la tool, no la
// describas" y de "no usar webfetch con rutas locales" estén presentes en el
// archivo. No ejecuta el LLM: es un test de contenido del prompt.
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

let prompt

before(() => {
  prompt = readFileSync(join(REPO, "opencode/agent/tecnia-bot.md"), "utf8")
})

test("tecnia-bot.md: tiene la regla crítica de ejecutar, no describir, la tool", () => {
  assert.match(prompt, /REGLA CRÍTICA — EJECUTÁ la tool, nunca la describas/, "título de la regla")
  assert.match(prompt, /NUNCA le expliques al usuario cómo la usarías vos/, "prohibición explícita de narrar")
})

test("tecnia-bot.md: platformio, memoria y perfil quedan reforzados con EJECUTÁ", () => {
  assert.match(prompt, /EJECUTÁ vos el tool `platformio`/, "refuerzo en platformio")
  assert.match(prompt, /Guardalo VOS ejecutando la tool en ese mismo momento/, "refuerzo en memoria")
  assert.match(
    prompt,
    /significa que EJECUTÁS la tool en ese instante/,
    "refuerzo en perfil",
  )
})

test("tecnia-bot.md: Limitaciones quedó en modo imperativo, no descriptivo", () => {
  assert.match(prompt, /esto no es para recitarle al usuario/i, "nota interna anti-narración")
  assert.doesNotMatch(prompt, /Guardás el perfil con el tool `perfil`/, "ya no usa la voz descriptiva vieja")
})

test("tecnia-bot.md: prohíbe explícitamente webfetch con rutas locales/file://", () => {
  assert.match(
    prompt,
    /JAMÁS uses el tool `webfetch` con una ruta local o `file:\/\/`/,
    "prohibición explícita de webfetch local",
  )
  assert.match(prompt, /ruta exacta/, "indica dar la ruta exacta al usuario")
  assert.match(prompt, /doble clic/, "indica pedir doble clic para abrir el archivo")
})

test("la placa se resuelve ANTES de responder de hardware", () => {
  // Lo pidió el usuario probando el bot: "quiero que piense, siempre, qué placa
  // tiene, o que pregunte".
  //
  // La regla existía pero estaba enterrada en la sección de PlatformIO y sólo
  // aplicaba a compilar. Y la placa cambia MUCHO más que eso: 5 V contra 3,3, el
  // LED en el pin 13 contra GPIO 2, el ADC de 1023 contra 4095. Un código que
  // prende un LED en el 13 no hace nada visible en un ESP32.
  //
  // Peor: un divisor colgado de 5 V leído por un ESP32 le mete 5 V a una entrada
  // de 3,3. Asumir la placa no es impreciso, es peligroso.
  const i = prompt.indexOf("QUÉ PLACA es")
  assert.ok(i > 0, "no está la regla de resolver la placa")

  // Tiene que estar ARRIBA, entre las reglas críticas — no enterrada.
  const inicio = prompt.indexOf("## Inicio de sesión")
  assert.ok(i < inicio, "la regla quedó después del inicio de sesión: nadie la va a aplicar")

  const regla = prompt.slice(i, i + 2600)
  assert.match(regla, /perfil/, "no dice que primero mire el perfil")
  assert.match(regla, /diagnostico/i, "no ofrece detectar lo que hay conectado")
  assert.match(regla, /pregunt/i, "no dice que pregunte cuando no sabe")
  assert.match(regla, /3,3|3\.3/, "no explica por qué importa (la tensión)")

  // Y el equilibrio: preguntar cuando cambia la respuesta, no por reflejo.
  assert.match(regla, /no depend|reflejo/i, "va a preguntar la placa para todo, y molesta")
})

test("después de compilar, dice que TODAVÍA NO está en la placa", () => {
  // El usuario probando el bot: "le dije que haga un código que encienda un LED,
  // dice que lo hace, y nada. ¿Tiene algún mockup?".
  //
  // No había mock: el bot hacía exactamente lo que el prompt le pide — compilar
  // y NO cargar, porque cargar es una acción física que decide el docente. Esa
  // decisión está bien y se mantiene.
  //
  // El problema era cómo lo comunicaba. "Listo" se lee como "está en la placa".
  // El docente mira el LED, no pasa nada, y concluye que el bot no sirve.
  const i = prompt.indexOf("Cargarlo a la placa es OTRA cosa")
  assert.ok(i > 0, "no está la regla de no cargar por su cuenta")
  const bloque = prompt.slice(i, i + 2200)

  assert.match(bloque, /Todavía no está en la placa|todavia no esta en la placa/i,
    "no obliga a aclarar que el código no está cargado")

  // La regla se simplificó, y quedó MÁS fuerte: antes preguntaba sólo cuando el
  // pedido tenía sentido nada más andando («hacé que el LED parpadee»); ahora
  // pregunta SIEMPRE, apenas el código está listo. El docente no tiene por qué
  // saber que compilar y cargar son dos cosas distintas.
  assert.match(bloque, /PREGUNTÁ SIEMPRE|pregunt[áa] siempre/i,
    "no pregunta siempre si lo carga")
  assert.match(bloque, /No esperes a que\s*\n?\s*te lo pidan|no esperes/i,
    "espera a que se lo pidan, y el docente no sabe que tiene que pedirlo")

  // Y el límite: preguntar sí, cargar por su cuenta no.
  assert.match(bloque, /sin preguntar/i, "no prohíbe cargar sin preguntar")
})

test("el modelo está FIJADO, no es un alias 'latest'", () => {
  // La noche antes de una capacitación, un docente sacó una key nueva y el bot
  // le contestó:
  //
  //   This model models/gemini-2.5-flash-lite is no longer available to NEW
  //   USERS. Please update your code to use models/gemini-3.5-flash-lite
  //
  // El agente pedía `gemini-flash-lite-latest`, un alias — y ese alias resolvía a
  // la 2.5, que las cuentas nuevas ya no pueden usar. O sea: andaba en las
  // máquinas viejas y fallaba en TODAS las nuevas. El peor tipo de bug para el
  // día de una capacitación: invisible para el que probó, fatal para los 20 que
  // llegan.
  //
  // Un alias es una dependencia que cambia sola, sin avisar y sin quedar
  // registrada en ningún commit. Fijar la versión hace que el día que haya que
  // cambiarla sea una decisión, no una sorpresa.
  const m = prompt.match(/^model:\s*(\S+)/m)
  assert.ok(m, "el agente no declara modelo")
  assert.doesNotMatch(m[1], /latest$/,
    `el modelo es un alias ("${m[1]}"): puede cambiar solo y romper las cuentas nuevas`)
  assert.match(m[1], /^google\/gemini-[\d.]+-/, `modelo inesperado: ${m[1]}`)
})

test("no pega el código: lo ofrece, junto con cargarlo", () => {
  // Pedido del usuario probando el bot con un alumno en la cabeza: "no quiero
  // que siempre muestre el código, eso confunde. Que lo haga y ofrezca
  // mostrarlo. Y que siempre pregunte si lo sube. Nos ahorramos un prompt."
  //
  // Una pared de cuarenta líneas de C++ no enseña: abruma. El docente estaba
  // pensando en el circuito y de golpe tiene una pantalla de texto que no pidió.
  const i = prompt.indexOf("NO PEGUES EL CÓDIGO")
  assert.ok(i > 0, "no está la regla de no pegar el código")
  const bloque = prompt.slice(i, i + 1800)

  // Las DOS preguntas, y en UN solo mensaje: cada ida y vuelta de más es tiempo
  // de clase que se va.
  assert.match(bloque, /¿Te lo muestro\?\s*¿Lo cargo\?/,
    "las dos preguntas tienen que ir juntas, en el mismo mensaje")
  assert.match(bloque, /UN solo mensaje|mismo mensaje/i, "no dice que van juntas")

  // Y las excepciones, para que no quede mudo cuando el código ES la respuesta.
  assert.match(bloque, /mostrame el c[oó]digo|te lo pidieron/i,
    "no contempla que se lo pidan explícitamente")
  assert.match(bloque, /pinMode|for/,
    "no contempla que la pregunta sea SOBRE el código")
  assert.match(bloque, /No compila/i,
    "si no compila tiene que mostrarlo entero, con el error")
})

test("el circuito no se abre solo, y avisa si la placa no es ESP32", () => {
  // Reporte del usuario: "cada vez que le pido algo me abre esto, toda una
  // desprolijidad. O que no lo abra, o que me pregunte en base al equipo que voy
  // a trabajar, arduino, esp".
  //
  // Dos problemas, y el segundo era más grave que el reportado: el tool abría el
  // navegador en CADA pedido, y además TODOS sus presets son de ESP32. Un docente
  // con Arduino UNO recibía un diagrama con pines GPIO que en su placa no
  // existen, sin ninguna advertencia.
  const i = prompt.indexOf("lo mismo con los circuitos")
  assert.ok(i > 0, "no está la regla de los circuitos")
  const bloque = prompt.slice(i, i + 1400)

  assert.match(bloque, /ya no abre el navegador solo/i, "no dice que dejó de abrirse solo")
  assert.match(bloque, /abrir:\s*true/, "no dice cómo abrirlo cuando aceptan")
  assert.match(bloque, /ESP32/, "no advierte que los presets son de ESP32")
  assert.match(bloque, /UNO/, "no contempla al docente que tiene un Arduino UNO")
})
