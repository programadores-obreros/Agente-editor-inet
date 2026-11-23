// Smoke tests del tool `imprimible` (opencode/tool/imprimible.ts).
// Corre con: node --test tests/*.test.mjs   (Node puro, sin instalar nada).
// Mockeamos el plugin, Bun.write (escribe con fs) y Bun.spawn (no abre nada).

import { test, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(os.tmpdir(), "tecniabot-imprimible-test")

let mod

globalThis.Bun = {
  write: async (ruta, contenido) => writeFileSync(ruta, contenido),
  spawn: () => ({ unref() {} }),
}

before(async () => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "mock-plugin.ts"),
    "const chain=new Proxy(function(){return chain},{get:()=>chain,apply:()=>chain});export const tool=(c)=>c;tool.schema=chain;",
  )
  const src = readFileSync(join(REPO, "opencode/tool/imprimible.ts"), "utf8")
    .replace('/// <reference path="../env.d.ts" />', "")
    .replace('import { tool } from "@opencode-ai/plugin"', 'import { tool } from "./mock-plugin.ts"')
  writeFileSync(join(OUT, "imprimible.ts"), src)
  mod = (await import(join(OUT, "imprimible.ts"))).default
})

test("genera la hoja con materiales, conexiones y código", async () => {
  const r = await mod.execute(
    {
      titulo: "Semáforo — ESP32",
      placa: "ESP32",
      materiales: ["3x LED", "3x resistencia 330Ω"],
      conexiones: ["LED rojo → GPIO12", "Cátodos → GND"],
      codigo: "void setup() {}",
      notas: "El ESP32 va a 3.3V.",
    },
    { directory: OUT },
  )
  assert.match(r, /Ctrl \+ P|Ctrl\+P/i, "avisa cómo imprimir/guardar PDF")

  const html = readFileSync(join(OUT, "hoja-semaforo-esp32.html"), "utf8")
  assert.match(html, /Semáforo — ESP32/, "el título está")
  assert.match(html, /<li>3x LED<\/li>/, "los materiales van como lista")
  assert.match(html, /<td>LED rojo<\/td><td>GPIO12<\/td>/, "las conexiones van a tabla (partidas por la flecha)")
  assert.match(html, /void setup\(\)/, "el código está")
  assert.match(html, /El ESP32 va a 3\.3V/, "las notas de seguridad están")
  assert.match(html, /@media print/, "tiene CSS de impresión")
})

test("escapa el HTML del código (no rompe ni inyecta)", async () => {
  await mod.execute(
    {
      titulo: "Test escape",
      materiales: ["1x placa"],
      conexiones: ["A → B"],
      codigo: 'if (a < b && c > d) { Serial.println("<hola>"); }',
    },
    { directory: OUT },
  )
  const html = readFileSync(join(OUT, "hoja-test-escape.html"), "utf8")
  assert.match(html, /a &lt; b &amp;&amp; c &gt; d/, "los < > & del código quedan escapados")
  assert.doesNotMatch(html, /<hola>/, "no debe aparecer el tag crudo del string del código")
})

// ── LA HOJA QUE VA A LA MESA NO PUEDE PERDER EL PIN ────────────────────────────
//
// EL DEFECTO (auditoría de código del 2026-11-22, CIR-01 y PRM-04, reproducido por
// dos equipos de QA). Cada conexión se partía con
// `c.split(/\s*(?:→|->|:)\s*/, 2)`. En JavaScript el límite de `split` NO junta el
// resto en el último pedazo: lo TIRA. Así que toda conexión con más de un
// separador perdía la cola, y el tool contestaba «Listo» igual:
//
//   «LED: Ánodo (+) → GPIO4 (con 220Ω), Cátodo (−) → GND»  →  «LED | Ánodo (+)»
//   «GPIO18 → 220Ω → LED rojo (ánodo)»                     →  «GPIO18 | 220Ω»
//   «Relé IN → GPIO26 (activo en LOW: ojo)»                →  «… | GPIO26 (activo en LOW»
//
// La primera es el formato que devuelve el propio tool `circuito`: la hoja salía
// sin ningún número de pin. Y como «:» separaba al mismo nivel que la flecha, una
// aclaración con dos puntos alcanzaba para cortar la frase.
//
// POR QUÉ LOS DOS TESTS DE ARRIBA NO LO VEÍAN: usan conexiones de UNA sola flecha
// y sin dos puntos («LED rojo → GPIO12», «A → B»). Es el único formato que el
// split viejo partía bien.
//
// MUTACIONES que ponen rojo este bloque (exit code 1):
//   - volver a `c.split(/\s*(?:→|->|:)\s*/, 2)`            → rojos los tres primeros
//   - en partirConexion, cortar la derecha en la segunda flecha → rojos los tres primeros
//   - contar como rótulo un «:» que está entre paréntesis, o uno sin espacio detrás
//     cuando hay flecha, o buscarlo después de la flecha      → rojo «cómo se parte»
//   - aceptar una celda vacía                                → rojo «cómo se parte»
//   - sacar la ruta de la respuesta cuando el navegador «abrió» → rojo el último
//
// LÍMITE HONESTO: las líneas «tal cual las devuelve circuito» están copiadas de una
// corrida real del tool sobre este mismo commit (`componentes: "led:4, dht22,
// servo"`, en ESP32), no se generan acá. Si `circuito` cambia su formato, este test
// no se entera.

const filasDe = (html) => [...html.matchAll(/<tr><td(?: colspan="2")?>([\s\S]*?)<\/td>(?:<td>([\s\S]*?)<\/td>)?<\/tr>/g)]
  .map((m) => [m[1], m[2]].filter((x) => x != null))
const sinEscape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
/** Lo que tiene que sobrevivir: todo lo que no es flecha, dos puntos ni espacio. */
const sustancia = (s) => s.replace(/→|->|:|\s+/g, "")

async function hojaCon(titulo, conexiones) {
  const r = await mod.execute({ titulo, materiales: ["1x placa"], conexiones, codigo: "void setup() {}" }, { directory: OUT })
  return { r, filas: filasDe(readFileSync(join(OUT, `hoja-${titulo}.html`), "utf8")).map((f) => f.map(sinEscape)) }
}

test("las conexiones tal cual las devuelve circuito llegan a la hoja con sus pines", async () => {
  const deCircuito = [
    "LED: Ánodo (+) → GPIO4 (con 220Ω), Cátodo (−) → GND",
    "DHT22: VCC → 3.3V, DATA → GPIO5, GND → GND",
    "Servo SG90: Alimentación → VIN (5V), Señal (PWM) → GPIO18, Tierra → GND",
  ]
  const { filas } = await hojaCon("pines-de-circuito", deCircuito)
  assert.equal(filas.length, 3)
  const texto = filas.map((f) => f.join(" | "))
  for (const pin of ["GPIO4", "GPIO5", "GPIO18", "VIN (5V)", "3.3V", "220Ω"]) {
    assert.ok(texto.some((t) => t.includes(pin)), `la hoja perdió «${pin}»:\n${texto.join("\n")}`)
  }
  // El nombre del componente queda en la primera columna, y TODAS sus patas en la segunda.
  assert.deepEqual(filas[0], ["LED", "Ánodo (+) → GPIO4 (con 220Ω), Cátodo (−) → GND"])
})

test("ninguna conexión pierde texto, tenga los separadores que tenga", async () => {
  const casos = [
    "LED rojo (ánodo) → GPIO18 con 220Ω",
    "GPIO18 → 220Ω → LED rojo (ánodo)",
    "Relé IN -> GPIO5: activo en bajo",
    "Relé IN → GPIO26 (activo en LOW: ojo)",
    "DHT11 (DATA: pata del medio) → GPIO4",
    "LED rojo → GPIO18 (resistencia: 220Ω)",
    "LCD SDA → GPIO21 → (bus I2C compartido)",
    "Hora 12:30 → nada",
    "A:B:C",
    "Buzzer: GPIO25",
    "todo junto y sin separador",
    "LED: Ánodo (+) → GPIO4 (con 220Ω), Cátodo (−) → GND",
  ]
  const { filas } = await hojaCon("nada-se-pierde", casos)
  assert.equal(filas.length, casos.length)
  casos.forEach((caso, i) => {
    assert.equal(sustancia(filas[i].join("")), sustancia(caso), `la fila perdió texto de «${caso}»: quedó ${JSON.stringify(filas[i])}`)
  })
})

test("cómo se parte cada conexión: la flecha manda, y los dos puntos sólo rotulan", async () => {
  const esperado = [
    // Una flecha: lo de siempre.
    ["LED rojo → GPIO12", ["LED rojo", "GPIO12"]],
    // Varias flechas: se parte en la PRIMERA y el resto del recorrido queda entero.
    ["GPIO18 → 220Ω → LED rojo (ánodo)", ["GPIO18", "220Ω → LED rojo (ánodo)"]],
    // Dos puntos DESPUÉS de la flecha: es una aclaración, va con el destino.
    ["Relé IN -> GPIO5: activo en bajo", ["Relé IN", "GPIO5: activo en bajo"]],
    // Dos puntos ENTRE PARÉNTESIS: no rotulan nada.
    ["DHT11 (DATA: pata del medio) → GPIO4", ["DHT11 (DATA: pata del medio)", "GPIO4"]],
    // Dos puntos pegados (una hora, una relación): tampoco.
    ["Hora 12:30 → nada", ["Hora 12:30", "nada"]],
    // «Componente: patas…» antes de la primera flecha: el formato de `circuito`.
    ["DHT22: DATA → GPIO16", ["DHT22", "DATA → GPIO16"]],
    // Sin flecha, los dos puntos son el único separador que hay.
    ["Buzzer: GPIO25", ["Buzzer", "GPIO25"]],
    ["A:B:C", ["A", "B:C"]],
    // Sin nada que partir, la fila entera.
    ["todo junto", ["todo junto"]],
    // Un separador sin nada de un lado no arma una celda vacía.
    ["→ GPIO4", ["→ GPIO4"]],
    ["GPIO4 →", ["GPIO4 →"]],
  ]
  const { filas } = await hojaCon("como-se-parte", esperado.map(([c]) => c))
  assert.deepEqual(filas, esperado.map(([, f]) => f))
})

test("la respuesta deja SIEMPRE la ruta de la hoja, también cuando el navegador «abrió»", async () => {
  // `Bun.spawn` no tirar excepción no prueba que se haya abierto una ventana:
  // start, open y xdg-open no fallan aunque no abran nada (lo documenta ficha.ts).
  // El prompt le pide al modelo que, para reabrir una hoja, dé «la ruta exacta, la
  // que te devolvió el tool»: sin la ruta en la respuesta no tiene qué dar.
  const { r } = await hojaCon("deja-la-ruta", ["A → B"])
  const url = "file://" + join(OUT, "hoja-deja-la-ruta.html")
  assert.ok(r.includes(url), `la respuesta no trae la ruta de la hoja (${url}):\n${r}`)
  assert.doesNotMatch(r, /Te la abrí en el navegador\.\*\* Para/, "afirma que la abrió sin dejar dónde buscarla si no apareció")
})
