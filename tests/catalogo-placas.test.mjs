// El catálogo de placas y la regla de frenado.
//
// POR QUÉ EXISTE ESTE ARCHIVO. El bot conocía DOS placas —UNO y ESP32— y el
// parque real de una escuela técnica tiene diez. Frente a una que no conocía no
// frenaba: elegía un `board =` parecido, escribía el código, y compilaba. Y ahí
// está el veneno, porque `pio run` valida el código, NO el hardware: compila
// perfecto, el alumno cablea contra pines inventados, y nadie se entera hasta
// que hay humo.
//
// Peor todavía: el skill `educabot` se activaba con la palabra "Educabot" y
// afirmaba Educablocks UNO —ATmega328P en zócalo, USB-B, 20 puertos RJ12,
// puertos especiales E3/E4/E6— para CUALQUIER placa de la marca. Un docente con
// un Bhoot (6 puertos, motores MI/MD, chip soldado) recibía datos falsos que
// además compilaban.
//
// Los datos del catálogo costaron caro: se sacaron del generador de código
// oficial de Educabot, de las extensiones .mext de Mis Ladrillos (que son ZIPs)
// y de leer la serigrafía de una placa física. Este archivo existe para que
// nadie los "corrija" de memoria.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (rel) => readFileSync(join(REPO, rel), "utf8")

const catalogo = leer("opencode/skills/placas/SKILL.md")
const prompt = leer("opencode/agent/tecnia-bot.md")
const educabot = leer("opencode/skills/educabot/SKILL.md")
const perfilSrc = leer("opencode/tool/perfil.ts")

// ───────────────────────── el catálogo ─────────────────────────

test("el catálogo tiene los tres estados, y el del medio existe", () => {
  // "soportada" y "no soportada" no alcanzan. El mBot2/CyberPi compila y carga
  // perfecto, pero los motores cuelgan de OTRO microcontrolador (un GD32F403)
  // con un protocolo que nadie publicó. Sin el estado del medio, el alumno carga
  // el programa, el robot no se mueve, y concluye que el bot no sirve — cuando en
  // realidad el programa está bien.
  assert.match(catalogo, /soportada/i, "falta el estado soportada")
  assert.match(catalogo, /parcial/i, "falta el estado parcial")
  assert.match(catalogo, /reconocida, no soportada/i, "falta el estado reconocida-no-soportada")
})

test("cada `board =` del catálogo es uno que PlatformIO conoce de verdad", () => {
  // Un `board =` inventado no da un error claro: da uno de compilación que parece
  // del código, y el docente corrige líneas que están bien.
  const VALIDOS = new Set(["uno", "esp32dev", "nodemcuv2", "d1_mini", "micro", "leonardo", "megaatmega2560", "ATmega1284P"])
  const usados = [...catalogo.matchAll(/`board =`\*{0,2}\s*\|\s*`([^`]+)`/g)].map((m) => m[1].trim())
  assert.ok(usados.length >= 5, `esperaba varios board= en el catálogo, encontré ${usados.length}`)
  const raros = usados.filter((b) => !VALIDOS.has(b))
  assert.deepEqual(raros, [], `board= que no están en la lista conocida de PlatformIO: ${raros.join(", ")}`)
})

test("el mapa del Bhoot es el del generador oficial de Educabot", () => {
  // Salió de robots.educabot.com, tabla `t.BHOOT`. Si alguien "arregla" un pin de
  // memoria, esto se pone rojo. El puerto 5 es el caso delicado: es A6, y A6 del
  // ATmega328P SOLO existe en el encapsulado TQFP y SOLO lee (no hace I/O digital).
  const seccion = catalogo.slice(catalogo.indexOf("Mapa puerto → pin (variante común)"))
  for (const [puerto, pin] of [["0", "A0"], ["1", "A3"], ["2", "D3"], ["3", "D10"], ["4", "D11"], ["5", "A6"]])
    assert.match(seccion, new RegExp(`\\*\\*${puerto}\\*\\*\\s*\\|\\s*\\*\\*${pin}\\*\\*`), `puerto ${puerto} del Bhoot debería ser ${pin}`)

  assert.match(seccion, /SOLO analógico/i, "el puerto 5 del Bhoot no puede figurar como digital: A6 es ADC puro")
  assert.match(seccion, /MD.*D4 \+ D5/, "motor derecho del Bhoot: D4 + D5")
  assert.match(seccion, /MI.*D7 \+ D6/, "motor izquierdo del Bhoot: D7 + D6")
})

test("el Bhoot documenta el LED y el zumbador que trae soldados", () => {
  // D13 y D12 no son puertos: son componentes de la placa. Importan porque el LED
  // integrado es el mejor primer programa que existe — cero cables, y si parpadea
  // quedan descartados de una la compu, el cable, el puerto y el driver. Es el
  // mismo criterio que la ficha "01 · Arduino UNO" ya aplica al LED «L» del UNO.
  const i = catalogo.indexOf("Educabot Bhoot v1.0")
  const bhoot = catalogo.slice(i, catalogo.indexOf("## 07", i))
  assert.match(bhoot, /LED en D13/, "falta el LED integrado del Bhoot (D13)")
  assert.match(bhoot, /zumbador en D12/, "falta el zumbador integrado del Bhoot (D12)")
  assert.match(bhoot, /sin cablear nada|cero cables/i, "no explica por qué el LED integrado es el mejor punto de arranque")

  // Y no pueden colarse en la tabla de puertos: ahí no hay dónde enchufar nada.
  const mapa = bhoot.slice(bhoot.indexOf("Mapa puerto → pin"), bhoot.indexOf("### El LED de D13"))
  assert.doesNotMatch(mapa, /\|\s*\*\*13\*\*\s*\|/, "D13 se coló como puerto: es un LED soldado, no un conector")
})

test("el Bhoot figura con sus dos nombres: el de la plaqueta y el del software", () => {
  // La serigrafía dice "Bhoot v1.0" y la plataforma de Educabot la llama "Buty".
  // Buscar sólo uno de los dos es por qué tardamos en encontrar su documentación.
  assert.match(catalogo, /Bhoot/, "el catálogo no nombra el Bhoot")
  assert.match(catalogo, /Buty/, "el catálogo no nombra el alias «Buty», que es como la llama su propio software")
})

test("las dos versiones del R10 siguen teniendo pinouts DISTINTOS", () => {
  // Mismo nombre de placa, mismo micro, pinout distinto en cinco de ocho
  // conectores. Es tentador "unificarlas" para simplificar el catálogo: no se
  // puede. Usar el pinout de la v1.0 en una v1.1 puede poner una salida contra
  // otra salida, y eso quema el 32U4.
  const i10 = catalogo.indexOf("R10 (hardware v1.0)")
  const i11 = catalogo.indexOf("R10 (hardware v1.1)")
  assert.ok(i10 > 0 && i11 > i10, "faltan las dos versiones del R10, o están en orden raro")

  const v10 = catalogo.slice(i10, i11)
  const v11 = catalogo.slice(i11, catalogo.indexOf("## 09", i11))
  const filaCon3 = (txt) => (txt.split("\n").find((l) => /^\|\s*\*{0,2}3\*{0,2}\s*\|/.test(l)) || "")
  assert.notEqual(filaCon3(v10), "", "no encontré el CON3 de la v1.0")
  assert.notEqual(filaCon3(v10), filaCon3(v11), "el CON3 quedó igual en las dos versiones: alguien las unificó")
})

test("el catálogo nombra las placas que NO soporta, para poder frenar con nombre", () => {
  // No poder programarlas es una cosa; no saber que existen es otra. Un bot que
  // no reconoce "Robustito" improvisa; uno que lo reconoce frena y explica.
  for (const placa of ["Robustito", "DuinoBot", "Makeblock", "Robobloq"])
    assert.match(catalogo, new RegExp(placa), `el catálogo no nombra ${placa} ni para decir que no la soporta`)
})

test("el catálogo NUNCA afirma el orden de los contactos de un conector", () => {
  // Patrón verificado en fabricantes de dos continentes: el mapa puerto → pin se
  // publica; la posición física de cada señal en el RJ12/RJ25 no la publica nadie.
  // Eso va a tester, siempre.
  assert.match(catalogo, /tester/i, "el catálogo no manda a medir con tester en ningún lado")
  assert.match(catalogo, /no la publica ningún fabricante|no.*publica.*RJ25|posición de cada\s*\n?\s*señal/i,
    "falta la regla de que el orden de contactos del conector no es dato, es tester")
})

// ───────────────────────── la regla del prompt ─────────────────────────

test("el prompt manda a frenar, y dice exactamente qué NO se hace", () => {
  const i = prompt.indexOf("Si la placa NO está en el catálogo")
  assert.ok(i > 0, "no está la regla de frenado en el prompt")
  const regla = prompt.slice(i, i + 1600)
  assert.match(regla, /platformio\.ini/, "no prohíbe escribir el platformio.ini")
  assert.match(regla, /main\.cpp/, "no prohíbe escribir el main.cpp")
  assert.match(regla, /pin/i, "no prohíbe decir un número de pin")
})

test("frenar NO es cortar: el prompt dice qué SÍ sigue dando", () => {
  // Si la regla sólo prohíbe, el bot contesta "no puedo" y el docente se va con
  // las manos vacías. El sensor, la lógica y el concepto de cableado valen igual
  // en cualquier placa del mundo.
  const i = prompt.indexOf("Si la placa NO está en el catálogo")
  const regla = prompt.slice(i, i + 2200)
  assert.match(regla, /Lo que SÍ hacés/, "la regla prohíbe pero no dice qué sigue ofreciendo")
  assert.match(regla, /lógica/i, "no ofrece la lógica del programa")
  assert.match(regla, /serigrafía|manual del fabricante|tester/i, "no le dice al docente dónde conseguir el dato que falta")
})

test("el prompt manda a abrir el menú con `question`, no a preguntar a mano", () => {
  const i = prompt.indexOf("QUÉ PLACA es")
  const regla = prompt.slice(i, i + 3000)
  assert.match(regla, /`question`/, "no dice que el menú se arma con el tool question")
  assert.match(regla, /variante/i, "no contempla repreguntar la variante")
  assert.doesNotMatch(regla, /un Arduino UNO o un ESP32\?/,
    "quedó la pregunta vieja de dos opciones hardcodeadas: el parque es más grande")
})

// ───────────────────────── coherencia entre piezas ─────────────────────────

test("el skill educabot NO afirma una sola placa", () => {
  // El bug que originó todo esto. El `description:` engancha con "placa Educabot"
  // y antes afirmaba Educablocks UNO para cualquiera de la marca.
  const desc = (educabot.match(/^description:.*$/m) || [""])[0]
  assert.match(desc, /Bhoot/, "el description del skill educabot no menciona el Bhoot: se va a activar y afirmar la placa equivocada")
  assert.match(educabot, /MÁS DE UNA placa/i, "el skill no desambigua entre sus placas")
  assert.match(educabot, /`placas`/, "el skill educabot no apunta al catálogo")
})

test("perfil.ts no vuelve a tener una lista de placas propia", () => {
  // Era `enum(["UNO", "ESP32", "no sé"])`: una SEGUNDA fuente de verdad que se
  // desincronizó con el catálogo apenas éste creció. La lista vive en el skill
  // `placas` y en ningún otro lado.
  // Se miran los comentarios aparte: el propio archivo EXPLICA el enum viejo para
  // dejar asentado por qué se fue, y esa prosa no puede hacer caer el test.
  const codigo = perfilSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  assert.doesNotMatch(codigo, /enum\(\[\s*"UNO"/, "volvió el enum de placas en perfil.ts: el catálogo es la única lista")
  assert.match(perfilSrc, /placas/, "perfil.ts no apunta al catálogo para el valor de placa")
})
