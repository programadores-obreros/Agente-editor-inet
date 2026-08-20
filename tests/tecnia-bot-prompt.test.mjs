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

/**
 * El bloque de una regla: desde su texto hasta el próximo encabezado del MISMO
 * nivel o superior.
 *
 * REEMPLAZA A `slice(i, i + N)`, y no es cosmético. Una auditoría midió que una
 * de esas ventanas fijas tenía SESENTA Y CUATRO caracteres de holgura: agregar
 * una oración de documentación —que no cambia ninguna regla— la ponía en rojo.
 * Un test que se pone rojo sin que haya un defecto enseña a ignorar el rojo.
 *
 * Y corta por nivel, no por cualquier "#": las reglas tienen sub-encabezados
 * adentro, y cortar en el primero dejaba afuera la mitad de lo que se quería
 * medir.
 */
function bloqueDesde(texto, desde) {
  const i = texto.indexOf(desde)
  if (i < 0) return ""
  const inicioLinea = texto.lastIndexOf("\n", i) + 1
  const nivel = (texto.slice(inicioLinea, inicioLinea + 6).match(/^(#+)/) || ["", "##"])[1].length
  const re = new RegExp("\\n#{1," + nivel + "} ", "g")
  re.lastIndex = i + desde.length
  const m = re.exec(texto)
  return m ? texto.slice(i, m.index) : texto.slice(i)
}

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
  const bloque = bloqueDesde(prompt, "NUNCA PEGUES EL CÓDIGO POR DEFECTO")
  assert.ok(bloque, "no está la regla de no pegar el código")

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
  const bloque = bloqueDesde(prompt, "lo mismo con los circuitos")
  assert.ok(bloque, "no está la regla de los circuitos")

  assert.match(bloque, /ya no abre el navegador solo/i, "no dice que dejó de abrirse solo")
  assert.match(bloque, /abrir:\s*true/, "no dice cómo abrirlo cuando aceptan")
  assert.match(bloque, /ESP32/, "no advierte que los presets son de ESP32")
  assert.match(bloque, /UNO/, "no contempla al docente que tiene un Arduino UNO")
})

test("conversa antes de trabajar, y no encadena acciones", () => {
  // El hallazgo más importante que reportó el usuario, y está DEBAJO de los
  // otros tres: "no me gusta que se ponga a trabajar sin preguntar, se lanza
  // solo... como que no interactúa y trabaja".
  //
  // No era el código, ni la ventana que se abría, ni la placa asumida. Era el
  // carácter: un compañero que acompaña pregunta antes de ponerse a hacer; una
  // máquina ejecuta. El producto se propone ser lo primero.
  const i = prompt.indexOf("conversá antes de trabajar")
  assert.ok(i > 0, "no está la regla de conversar antes de trabajar")

  // Tiene que ser la PRIMERA regla crítica: es de carácter, no de detalle.
  const reglas = [...prompt.matchAll(/^## REGLA CRÍTICA — (.+)$/gm)].map((m) => m[1])
  assert.match(reglas[0], /convers/i, `la primera regla es "${reglas[0]}", no la de conversar`)

  const bloque = bloqueDesde(prompt, "conversá antes de trabajar")
  assert.match(bloque, /UNA cosa por turno|una cosa por turno/i, "no limita a una acción por turno")
  // El cierre de cada turno tiene su propia regla, más abajo y más fuerte.
  assert.match(prompt, /TODOS tus mensajes terminan con una pregunta o una acción/,
    "no pide terminar cada turno con una pregunta o una acción")

  // Y el contrapeso, sin el cual queda un bot que interroga y no ayuda.
  assert.match(bloque, /Cuándo NO preguntar/i, "no dice cuándo NO preguntar")
  assert.match(bloque, /no necesita|devolver la pregunta/i,
    "va a repreguntar lo que ya le pidieron")
  assert.match(bloque, /sorprender/i, "no da un criterio simple para decidir")
})

test("ejecutar la tool no contradice conversar primero", () => {
  // Las dos reglas podían leerse como opuestas: una dice "ejecutá, no describas"
  // y la otra "preguntá antes de hacer". Un modelo que ve una contradicción
  // resuelve inventando, y ahí se pierde la intención de las dos.
  const i = prompt.indexOf("EJECUTÁ la tool, nunca la describas")
  const bloque = prompt.slice(i, i + 600)
  assert.match(bloque, /NO contradice/i, "no aclara cómo conviven las dos reglas")
  assert.match(bloque, /decidido|acuerda/i, "no dice que se conversa para decidir y después se hace")
})

test("las reglas nuevas no se contradicen entre sí", () => {
  // Cuatro contradicciones GRAVES que encontró una auditoría del prompt, todas
  // introducidas en una sola noche al agregar tres reglas críticas apuradas.
  //
  // El riesgo no es teórico: un modelo que ve dos instrucciones opuestas resuelve
  // inventando, y ahí se pierden las dos intenciones. Y corre sobre un modelo
  // "lite", que es donde el seguimiento de instrucciones largas se degrada más.

  // 1 · "una cosa por turno" NO puede impedir compilar antes de mostrar código.
  const i1 = prompt.indexOf("UNA cosa por turno")
  const b1 = prompt.slice(i1, i1 + 700)
  assert.match(b1, /única excepción|UN solo paso/i,
    "«una cosa por turno» choca con «nunca des código sin compilar»: el bot va a entregar código sin compilar")
  assert.doesNotMatch(b1, /no escribas el código Y lo compiles/,
    "sigue prohibiendo justo el encadenamiento que otra regla exige")

  // 2 · Una respuesta ambigua no puede significar "cargá a la placa".
  const i2 = prompt.indexOf("pedido de cargar")
  const b2 = prompt.slice(Math.max(0, i2 - 400), i2 + 700)
  assert.match(b2, /NO adivines|ambigua/i,
    "«dale» o «sí» se interpretan como cargar, y es la única acción irreversible sobre hardware")

  // 3 · En una compu compartida, la placa NO se hereda.
  const i3 = prompt.indexOf("Modo `aula`")
  const b3 = prompt.slice(i3, i3 + 700)
  assert.match(b3, /placa NO se guarda|no guarda placa/i,
    "en modo aula se guarda la placa: el segundo docente hereda la del primero y recibe pines que no existen")

  // 4 · El freno anti-invención tiene que cubrir el hardware, no sólo el currículum.
  assert.match(prompt, /I²C|I2C/,
    "no hay regla anti-invención para datos de hardware (pines, direcciones, librerías)")
  const i4 = prompt.indexOf("vale para el hardware")
  assert.ok(i4 > 0, "falta el protocolo anti-invención de hardware")
  assert.match(prompt.slice(i4, i4 + 900), /no lo afirmes|verificar/i,
    "no le dice qué hacer cuando no tiene el dato")
})

test("todos los mensajes terminan con una pregunta o una acción", () => {
  // Pedido del usuario, repetido: "que siempre termine con una pregunta o una
  // acción, lo hago, lo subo, etc".
  //
  // Es lo que hace que esto sea una conversación y no un monólogo. Un mensaje que
  // termina y deja al docente sin saber qué sigue falló, aunque todo lo anterior
  // esté bien.
  const i = prompt.indexOf("TODOS tus mensajes terminan")
  assert.ok(i > 0, "no está la regla de cerrar con pregunta o acción")
  const bloque = bloqueDesde(prompt, "TODOS tus mensajes terminan")

  // Y el matiz que la hace útil: los cierres vacíos no cuentan.
  assert.match(bloque, /Alguna otra|cierres vacíos/i,
    "no distingue una propuesta concreta de un «¿alguna otra duda?»")
  assert.match(bloque, /Dos opciones/i,
    "no sugiere ofrecer dos caminos concretos en vez de una pregunta abierta")
})

test("/diagnostico no inventa cómo instalar PlatformIO", () => {
  // Pasó en la capacitación del 20/08: una máquina de decenas se quedó sin
  // PlatformIO, y el bot le dijo a la docente que instalara Visual Studio Code
  // y la extensión PlatformIO IDE. Cientos de megas de otro producto, para
  // seguir sin poder compilar.
  //
  // La causa no fue el modelo: el comando decía «explicá brevemente los pasos
  // para instalar en Windows» sin decir cuáles. Una instrucción que pide
  // improvisar recibe una improvisación, y la más difundida en internet es la
  // de VS Code.
  //
  // Acá hay una sola forma: volver a correr el instalador.
  const cmd = readFileSync(join(REPO, "opencode/command/diagnostico.md"), "utf8")

  assert.match(cmd, /Reparar Tecnia Bot/i,
    "no nombra el acceso directo exacto que tiene que buscar el docente")
  assert.match(cmd, /pypi\.org/i,
    "no contempla que la causa sea la red, que es lo más común en una escuela")

  // Y la prohibición explícita, sin la cual la instrucción positiva no alcanza:
  // el modelo puede dar la correcta Y ADEMÁS la de VS Code, «por las dudas».
  assert.match(cmd, /Nunca menciones VS Code|no inventes/i,
    "no le prohíbe explícitamente ofrecer otra forma de instalar")

  // Y el contrapeso: que no quede un bot que sólo enumera lo que falta.
  assert.match(cmd, /lo que SÍ puede hacer|sirve igual/i,
    "no le dice al docente qué puede hacer mientras tanto")
})

test("el tool platformio no manda a la documentación oficial", () => {
  // El tool es lo que el modelo lee. Si ahí adentro va el link a una página con
  // cinco métodos de instalación, el modelo elige uno — y el que elige es el que
  // no sirve acá.
  const tool = readFileSync(join(REPO, "opencode/tool/platformio.ts"), "utf8")
  const codigo = tool.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

  assert.doesNotMatch(codigo, /docs\.platformio\.org/,
    "el tool devuelve el link de la doc oficial: es una página con cinco métodos y el modelo va a elegir el de VS Code")
  assert.match(codigo, /Reparar Tecnia Bot/i,
    "el tool no nombra el acceso directo exacto: 'volvé a correr el instalador' mandó a una docente a buscar algo que no existía")
})
