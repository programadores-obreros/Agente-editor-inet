// El tool `circuito` no dibuja: SIMULA. Y nadie lo sabía.
//
// POR QUÉ EXISTE ESTE ARCHIVO. Una auditoría encontró que el tool `circuito`,
// cuando el pedido combina un sensor con un actuador, no genera un esquema
// quieto: inyecta un slider de la magnitud física real (temperatura, distancia,
// humedad del suelo) y hace que el actuador se dispare al cruzar el umbral. Son
// 8 sensores por 9 actuadores: 72 simuladores funcionando.
//
// Estaban funcionando por accidente. Ni el prompt del agente ni el skill
// `circuitos-visuales` nombraban el slider, el umbral ni la palabra simulador
// (`rg -i 'umbral|slider|simulador'` sobre los dos archivos daba CERO), así que
// el modelo nunca los pedía a propósito. La capacidad estaba construida y
// apagada, que es la peor forma de no tenerla: se paga el código y no se cobra
// la clase.
//
// Lo mismo con dos args que no se mencionaban en ningún lado: `umbral` (el punto
// de disparo) y `nombre_archivo`. Y con la sintaxis `componente:GPIO`, que
// estaba en el skill pero NO en el prompt — y sin ella el circuito de un
// proyecto del INET sale con pines que contradicen la ficha de cátedra, porque
// el reparto automático saltea GPIO16 y GPIO17.
//
// Este archivo es la guarda de que nada de eso se vuelva a borrar en una
// "limpieza" del prompt o del skill.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const leer = (rel) => readFileSync(join(REPO, rel), "utf8")

const skill = leer("opencode/skills/circuitos-visuales/SKILL.md")
const prompt = leer("opencode/agent/tecnia-bot.md")
const toolSrc = leer("opencode/tool/circuito.ts")

// Las dos listas, leídas del CÓDIGO — no de una copia a mano. Si mañana alguien
// agrega un sensor a SENSOR_SIM o un actuador a ESACTU y no lo documenta, el
// skill queda mintiendo por omisión y estos tests se ponen rojos.
const SENSORES = ["dht22", "ntc", "ultrasonico", "pir", "llama", "sonido", "higrometro", "lluvia"]
const ACTUADORES = ["led", "servo", "buzzer", "relay", "bomba", "valvula", "lampara", "calefactor", "motor"]

// ───────────────────────── el código, primero ─────────────────────────

test("las listas de este archivo son las del tool, no una copia envejecida", () => {
  // Sin esta guarda, los tests de abajo verificarían el skill contra una lista
  // inventada acá: pasarían en verde mientras el skill documenta un catálogo que
  // el tool ya no tiene.
  const sim = toolSrc.match(/const SENSOR_SIM[^=]*=\s*\{([\s\S]*?)\n\}/)
  assert.ok(sim, "no encontré SENSOR_SIM en circuito.ts: ¿lo renombraron?")
  const enCodigo = [...sim[1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])
  assert.deepEqual(enCodigo, SENSORES, "SENSOR_SIM cambió: actualizá la tabla del skill circuitos-visuales")

  const act = toolSrc.match(/const ESACTU[\s\S]{0,200}?\[([^\]]+)\]\.includes\(t\)/)
  assert.ok(act, "no encontré ESACTU en circuito.ts: ¿lo renombraron?")
  const actEnCodigo = act[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
  assert.deepEqual(actEnCodigo, ACTUADORES, "ESACTU cambió: actualizá la lista del skill circuitos-visuales")
})

// ───────────────────── el skill cuenta el simulador ─────────────────────

test("el skill dice que sensor + actuador sale INTERACTIVO, con el slider", () => {
  // Lo que se perdía sin esto: el modelo trataba al tool como "el que dibuja
  // lindo". Pedía un esquema de riego, recibía un simulador de riego, y se lo
  // presentaba al docente como un dibujo — nadie tocaba el slider porque nadie
  // avisaba que existía. La clase entera quedaba adentro del archivo, apagada.
  assert.match(skill, /simulador/i, "el skill no nombra el simulador")
  assert.match(skill, /slider/i, "el skill no nombra el slider: el alumno no sabe que hay algo para mover")
  assert.match(skill, /interactivo/i, "el skill no dice que el circuito sale interactivo")
})

test("el skill lista los 8 sensores que mueven el slider", () => {
  // Lo que se perdía sin esto: el modelo elegía sensores "por temática" sin saber
  // cuáles disparan el simulador. Pedían alarma de fuego y armaba `ldr, relay,
  // lampara` (dibujo quieto) pudiendo armar `llama, relay, lampara` (simulador).
  // La lista tiene que estar escrita para que sea una decisión, no una lotería.
  for (const s of SENSORES) {
    assert.match(skill, new RegExp(`\`${s}\``), `el skill no nombra el sensor ${s} como simulable`)
  }
})

test("el skill lista los 9 actuadores que responden al umbral", () => {
  // Lo que se perdía sin esto: la mitad de los actuadores son de potencia (bomba,
  // válvula, lámpara, calefactor, motor) y también se iluminan al dispararse. Sin
  // la lista, el modelo asumía que solo el LED "hace algo" y evitaba justo los
  // actuadores de los proyectos del INET, que son todos de potencia.
  for (const a of ACTUADORES) {
    assert.match(skill, new RegExp(`\`${a}\``), `el skill no nombra el actuador ${a}`)
  }
})

test("el skill avisa que la dirección del umbral se invierte sola", () => {
  // Lo que se perdía sin esto: el modelo "corregía" al tool. Veía que el riego
  // disparaba con humedad BAJA, lo tomaba por un bug, y le pasaba un umbral al
  // revés para compensar — rompiendo justo el comportamiento correcto. El tool
  // invierte a propósito para ultrasónico (cerca), higrómetro (seco) y cualquier
  // circuito con calefactor (frío). Está escrito para que no lo peleen.
  assert.match(toolSrc, /disparaBajo\s*=\s*tSens === "ultrasonico" \|\| tSens === "higrometro" \|\| hayCalefactor/,
    "cambió la regla de inversión en el tool: actualizá el skill")
  for (const caso of ["ultrasonico", "higrometro", "calefactor"]) {
    assert.match(skill, new RegExp(`\`${caso}\`[\\s\\S]{0,220}≤`),
      `el skill no explica que ${caso} dispara con valor BAJO (≤)`)
  }
})

test("el skill explica POR QUÉ el lazo importa, citando el proyecto 12", () => {
  // Lo que se perdía sin esto: el simulador queda como un chiche. El porqué es
  // pedagógico y está escrito en el skill `actuadores`: los proyectos del INET no
  // enseñan cómo se ve un relé, enseñan sensor → decisión → actuador. Sin esa
  // frase el modelo no tiene con qué decidir entre un dibujo y un simulador.
  const actuadores = leer("opencode/skills/actuadores/SKILL.md")
  assert.match(actuadores, /cierra el lazo sensor → decisión → actuador/,
    "cambió la frase del lazo en el skill actuadores: actualizá la cita de circuitos-visuales")
  assert.match(skill, /sensor → decisión → actuador/,
    "el skill no explica el lazo de control: el simulador queda como adorno")
  assert.match(skill, /calefacción del INET/,
    "el skill no cita la fuente (proyecto 12, calefacción) de donde sale el lazo")
})

// ───────────────────────── `umbral`, en los dos ─────────────────────────

test("el skill explica `umbral` con el ejemplo del docente", () => {
  // Lo que se perdía sin esto: el docente pedía «que el LED prenda a 20 grados» y
  // el bot devolvía el default de 35 sin decir nada. El pedido concreto —el único
  // que el docente formula en voz alta— se caía silenciosamente.
  assert.match(skill, /`umbral`/, "el skill no nombra el arg umbral")
  assert.match(skill, /umbral:\s*20/, "el skill no muestra un ejemplo concreto de umbral")
})

test("el prompt también explica `umbral` — ahí es donde se decide", () => {
  // Lo que se perdía sin esto: el skill se lee cuando ya se decidió usar el tool.
  // El umbral hay que pasarlo EN la llamada, así que si el prompt no lo nombra, el
  // modelo llama al tool antes de enterarse de que el arg existe.
  assert.match(prompt, /`umbral`/, "el prompt no nombra el arg umbral")
  assert.match(toolSrc, /umbral:\s*tool\.schema/, "el tool ya no tiene el arg umbral: el prompt quedó mintiendo")
})

test("el prompt avisa, en la regla de circuitos, que sensor + actuador sale interactivo", () => {
  // Lo que se perdía sin esto: la regla de circuitos del prompt es la que decide
  // preset vs armador libre. Si ahí no dice que sensor + actuador sale interactivo,
  // el modelo nunca lo busca a propósito, por más que el skill lo explique lindo.
  const i = prompt.indexOf("REGLA CRÍTICA — circuitos visuales")
  assert.ok(i >= 0, "no encontré la regla de circuitos visuales en el prompt")
  const regla = prompt.slice(i, i + 5000)
  assert.match(regla, /INTERACTIVO|interactivo/, "la regla no dice que el circuito puede salir interactivo")
  assert.match(regla, /slider/i, "la regla no nombra el slider")
})

// ──────────────────── `componente:GPIO` y el pinout del INET ────────────────────

test("el prompt trae la sintaxis `componente:GPIO`, no solo el skill", () => {
  // Lo que se perdía sin esto: la sintaxis vivía únicamente en el skill, y el
  // prompt listaba los 33 componentes sin decir que se les puede fijar el pin. El
  // modelo armaba todo con el reparto automático porque no sabía que había otra
  // opción — nunca es una decisión, es desconocimiento.
  assert.match(prompt, /`?componente:GPIO`?|`led:16, led:17, led:18`/,
    "el prompt no menciona la sintaxis componente:GPIO")
  assert.match(prompt, /led:1[67]/, "el prompt no muestra un ejemplo concreto de pin forzado")
})

test("el prompt manda usar el pinout de la ficha en proyectos del INET", () => {
  // Lo que se perdía sin esto —y es el más caro de los cuatro—: el pool automático
  // del tool saltea GPIO16 y GPIO17 (PSRAM), pero la ficha de semaforización pide
  // exactamente GPIO16 y GPIO17. Resultado: el circuito generado contradice el
  // material de cátedra. Y como el propio prompt ordena que "el circuito es la
  // fuente de verdad de los pines", el alumno le hace caso al circuito y cablea
  // distinto a su ficha. Dos fuentes de verdad peleándose, ganando la equivocada.
  assert.match(toolSrc, /const POOL_DIGITAL = \[[^\]]*\]/, "no encontré POOL_DIGITAL")
  const pool = toolSrc.match(/const POOL_DIGITAL = \[([^\]]*)\]/)[1].split(",").map((n) => +n.trim())
  assert.ok(!pool.includes(16) && !pool.includes(17),
    "el pool ya reparte GPIO16/17: la regla del pinout INET perdió sentido, revisala")

  const validos = toolSrc.match(/const GPIO_VALIDOS = new Set\(\[([^\]]*)\]\)/)[1].split(",").map((n) => +n.trim())
  assert.ok(validos.includes(16) && validos.includes(17),
    "GPIO16/17 dejaron de ser válidos: la regla del prompt manda pines que el tool rechaza")

  const ficha = leer("opencode/skills/proyectos-inet/proyectos/01-semaforizacion.md")
  assert.match(ficha, /GPIO 16/, "la ficha de semaforización ya no pide GPIO16: revisá el ejemplo del prompt")

  assert.match(prompt, /GPIO16 y GPIO17|GPIO16\/17/, "el prompt no explica la excepción de GPIO16/17")
  assert.match(prompt, /proyectos-inet/, "el prompt no manda mirar la ficha del proyecto para el pinout")
  assert.match(skill, /GPIO16/, "el skill no documenta la excepción de GPIO16/17")
})

// ───────────────────────── `nombre_archivo` ─────────────────────────

test("`nombre_archivo` está documentado, con la convención del nombre del proyecto", () => {
  // Lo que se perdía sin esto: el arg existía y no lo nombraba nadie, así que TODO
  // salía como `circuito-armado-higrometro-relay-valvula-led.html`. Un docente que
  // arma varios proyectos junta una carpeta de nombres indistinguibles y, en el
  // medio de la clase, abre tres archivos hasta dar con el suyo.
  assert.match(toolSrc, /nombre_archivo:\s*tool\.schema/, "el tool ya no tiene el arg nombre_archivo")
  assert.match(skill, /`nombre_archivo`/, "el skill no nombra el arg nombre_archivo")
  assert.match(prompt, /`nombre_archivo`/, "el prompt no nombra el arg nombre_archivo")
  assert.match(skill, /nombre_archivo:\s*"riego-automatizado"/,
    "el skill no da la convención con un ejemplo: el nombre del proyecto, no el de las piezas")
})
