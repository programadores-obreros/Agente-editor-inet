// Tests del detector de "planificación en inglés" (opencode/plugins/idioma/detector.ts).
// Corre con: node --test tests/idioma-detector.test.mjs   (Node 24+, importa el .ts directo).
//
// POR QUÉ. Gemini Flash Lite, en charlas largas y después de un error de una
// herramienta, escribe su plan en inglés como texto visible ("Let's communicate
// this clearly and warmly, following our rules: ..."). El detector lo saca.
// Lo que NO puede pasar nunca es lo contrario: que borre español que era para
// el docente. Por eso la mitad de estos casos son español que tiene que volver
// IDÉNTICO, con términos técnicos, errores en inglés citados y código.
//
// Los casos están escritos a mano, imitando los patrones de la charla real
// (que NO se copia al repo: tiene datos de una persona). La evaluación contra
// ese corpus está en la evidencia del plan 0.4.8, fuera del repo.

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const { limpiar, analizar, MAX_TEXTO } = await import(join(REPO, "opencode/plugins/idioma/detector.ts"))

/** El texto tiene que volver idéntico, sin marcar cambio. */
function intacto(texto) {
  const r = limpiar(texto)
  assert.equal(r.cambio, false, `se marcó cambio en un texto que no había que tocar:\n${texto}\n---\nquitó: ${JSON.stringify(r.quitados)}`)
  assert.equal(r.texto, texto)
}

// ---------------------------------------------------------------------------
// Español: nunca se toca
// ---------------------------------------------------------------------------

test("español común: vuelve idéntico", () => {
  intacto("¡Listo! Ya armé el proyecto para tu ESP32 y compiló perfecto.\n\n**Todavía no está en la placa.**\n\n¿Lo cargo?")
  intacto("¡Hola! ¿Quién sos?")
  intacto("Dale.")
  intacto("Compilando el programa para el ESP32…")
})

test("términos técnicos en inglés dentro de español no lo vuelven inglés", () => {
  intacto(
    "El ESP32 arma un Access Point con un web server adentro. Conectá el celu a la red WiFi y entrá a la IP. " +
      "Si la carga falla con Error 2, fijate el upload_port en el platformio.ini y usá Serial.println para ver qué pasa.",
  )
  intacto("Conectá el LED al pin 13 con una resistencia de 220 Ω. El LED tiene polaridad: la pata larga es el ánodo.")
  intacto("Para usarlo:\n1. Buscá la red Wi-Fi con tu celu.\n2. Entrá a `http://192.168.4.1`.\n3. Tocá ON y OFF.")
})

test("un error en inglés citado en una respuesta en español se conserva", () => {
  intacto('Si en el monitor serie ves "Brownout detector was triggered", a la placa le falta corriente.')
  intacto("Si en el monitor serie ves `Brownout detector was triggered`, a la placa le falta corriente.")
  // Con dos puntos: lo que sigue es lo que la respuesta MUESTRA, aunque sea inglés.
  intacto(
    "La carga se cortó con este mensaje:\nA fatal error occurred: Failed to connect to ESP32: Wrong boot mode detected\n\n" +
      "Eso pasa cuando la placa no entra sola en modo de carga. ¿Probamos apretando BOOT?",
  )
})

test("inglés DESPUÉS de español en el mismo párrafo se conserva: es algo que la respuesta muestra", () => {
  // El plan del corpus real siempre va antes de la respuesta, nunca después.
  intacto("Te va a aparecer esto en el monitor\nthe port is busy or doesn't exist\n¿Lo ves igual?")
  intacto('En inglés se dice "breadboard", nosotros le decimos protoboard. The breadboard is the same thing.')
  intacto("Usá el pin `D4` (que es el GPIO 2). It's the same pin, solo cambia el nombre.")
})

test("los bloques de código y el código inline nunca se tocan", () => {
  intacto(
    "Acá tenés el código:\n\n```cpp\n// Let's make it blink: this is the main loop\nvoid loop() {\n  digitalWrite(2, HIGH); // turn the LED on\n}\n```\n\n¿Lo cargo?",
  )
  intacto("Usá `if (the_value > 0) { return the_result; }` para comparar.")
})

// ---------------------------------------------------------------------------
// Planificación en inglés: se saca
// ---------------------------------------------------------------------------

test("un plan entero en inglés queda vacío", () => {
  const r = limpiar('Now let\'s compile the project using `platformio` with `action: "compile"`.\nRemember the rule: compiling is quality control, we do it directly.')
  assert.equal(r.cambio, true)
  assert.equal(r.texto, "")
})

test("plan en inglés + respuesta en español en párrafos separados: queda la respuesta", () => {
  const r = limpiar(
    "The tool says the board is not connected to any port.\n\nLet's explain this clearly and kindly:\n- Ask them to check the cable.\n- End with a question.\n\n" +
      "Che, no veo ninguna placa conectada. ¿Probás desenchufar y volver a enchufar el cable?",
  )
  assert.equal(r.texto, "Che, no veo ninguna placa conectada. ¿Probás desenchufar y volver a enchufar el cable?")
})

test("plan pegado a la respuesta sin espacio ('response.Che'): se corta en el punto", () => {
  const r = limpiar("Let's check the rules and write out the response.Che, la placa no aparece en ningún puerto.\n\n¿La reconectás?")
  assert.equal(r.texto, "Che, la placa no aparece en ningún puerto.\n\n¿La reconectás?")
  const r2 = limpiar("Wait, let's tell them in one line what we're doing and flash it!¡Sí! Ahora la veo en el puerto.")
  assert.equal(r2.texto, "¡Sí! Ahora la veo en el puerto.")
})

test("un ítem de lista en inglés con la respuesta pegada al final", () => {
  const r = limpiar("Let's communicate this warmly:\n- It's still not showing up.\n- End with a question or concrete action.Todavía no veo la placa. ¿Probás otro puerto USB?")
  assert.equal(r.texto, "Todavía no veo la placa. ¿Probás otro puerto USB?")
})

test("las líneas neutras dentro del plan (salida de una tool copiada) se van con el plan", () => {
  const r = limpiar("Look at that! The port appeared!\n`COM9` — **placa**, chip CH340.\nSo the answer is yes, let's tell the user.\n\n¡Sí! Ahora la veo en `COM9`.")
  assert.equal(r.texto, "¡Sí! Ahora la veo en `COM9`.")
})

// ---------------------------------------------------------------------------
// Citas en español adentro del plan (el caso dudoso)
// ---------------------------------------------------------------------------

test("cita en español dentro del plan + respuesta final: se va la cita, no se duplica", () => {
  const r = limpiar(
    'Ah, the board is unplugged again. Let\'s let the user know kindly:\n"Che, parece que se desconectó la placa. Fijate el cable."\n\n' +
      "And let's end with a question or concrete action.Che, parece que se desconectó la placa.\n\n¿La reconectás y me avisás?",
  )
  assert.equal(r.texto, "Che, parece que se desconectó la placa.\n\n¿La reconectás y me avisás?")
})

test("borrador en español en líneas propias y NADA más en español: se rescata como respuesta", () => {
  const r = limpiar(
    "The diagnostic tool shows no board.\nSo right now we can't see it.\n\nLet's answer directly and in Spanish:\n**No, ahora no la veo.** Se desconectó del puerto.\n\nLet's ask a concrete question:\n¿La tenés enchufada?",
  )
  assert.equal(r.texto, "**No, ahora no la veo.** Se desconectó del puerto.\n\n¿La tenés enchufada?")
})

test("borrador entre comillas rescatado: se le sacan las comillas", () => {
  const r = limpiar('The board is gone. Let\'s tell the user:\n"Che, se desconectó la placa. ¿La reconectás?"')
  assert.equal(r.texto, "Che, se desconectó la placa. ¿La reconectás?")
})

test("la regla del prompt recitada en la misma línea NO se rescata", () => {
  // "Remember the rule: <regla en español>" es el modelo leyendo el prompt en voz alta.
  const r = limpiar("Now let's compile the project.\nRemember the rule: compilar es control de calidad nuestro, lo hacemos directamente.")
  assert.equal(r.texto, "")
  const r2 = limpiar('The upload was fine. Remember the rule: "decí en UNA línea qué vas a hacer y esperá."\nVoy a cargar el programa a la placa.')
  assert.equal(r2.texto, "Voy a cargar el programa a la placa.")
})

test("código dentro de un plan en inglés se conserva aunque el plan se vaya", () => {
  const r = limpiar("Let's write the code into the file:\n\n```cpp\nvoid setup() {}\n```\n\nNow let's compile it with the tool.")
  assert.equal(r.texto, "```cpp\nvoid setup() {}\n```")
})

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

test("texto vacío o en blanco: sin cambio", () => {
  for (const t of ["", "   ", "\n\n"]) {
    const r = limpiar(t)
    assert.equal(r.cambio, false)
    assert.equal(r.texto, t)
  }
})

test("analizar marca idioma y quitado por segmento", () => {
  const segs = analizar("Let's write out the response.Che, ya está.")
  assert.deepEqual(
    segs.map((s) => [s.texto, s.propio, s.quitado]),
    [
      ["Let's write out the response.", "en", true],
      ["Che, ya está.", "es", false],
    ],
  )
})

test("limpiar es idempotente: limpiar dos veces da lo mismo", () => {
  const sucio =
    "The compilation was successful!\nNow let's flash it to the board.\n\nAnd let's end with a question.¡Listo, compiló! ¿Lo cargo a la placa?"
  const una = limpiar(sucio).texto
  assert.equal(una, "¡Listo, compiló! ¿Lo cargo a la placa?")
  assert.equal(limpiar(una).cambio, false)
})

// ---------------------------------------------------------------------------
// Ronda de revisión (riesgo + confiabilidad): casos que antes se rompían
// ---------------------------------------------------------------------------

test("código: valla con sangría adentro de una lista no se pierde (ni lo que sigue)", () => {
  intacto(
    "1. Primero esto\n   1. Abrí el archivo y pegá esto\n\n      ```cpp\n      // Turn the LED on if it is dark and then wait\n      if (x) {}\n      ```\n2. Subilo.",
  )
})

test("código: valla adentro de una cita `>` no se pierde", () => {
  intacto("Mirá:\n\n> ```cpp\n> // Let's turn the LED on and wait for the user\n> digitalWrite(2, HIGH);\n> ```\n\n¿Lo ves?")
  const r = limpiar("Let's show the code to the user now.\n\n> ```cpp\n> // Let's turn the LED on and wait\n> digitalWrite(2, HIGH);\n> ```")
  assert.equal(r.texto, "> ```cpp\n> // Let's turn the LED on and wait\n> digitalWrite(2, HIGH);\n> ```")
})

test("código: bloque sangrado con 4 espacios se conserva aunque el plan se vaya", () => {
  const r = limpiar("Let's write this for the user:\n\n    // wait for the user and then turn the LED on\n    if (dark) { digitalWrite(2, HIGH); }\n\nListo.")
  assert.equal(r.texto, "    // wait for the user and then turn the LED on\n    if (dark) { digitalWrite(2, HIGH); }\n\nListo.")
})

test("código: red de seguridad, una línea que parece código nunca se borra", () => {
  const r = limpiar("Let's check the pin now.\nif the value is low then digitalWrite(2, HIGH);\n\nListo, ya está.")
  assert.equal(r.texto, "if the value is low then digitalWrite(2, HIGH);\n\nListo, ya está.")
})

test("tablas y citas `>` nunca se borran", () => {
  intacto("| Pin | What it does |\n|---|---|\n| GPIO 2 | It is the LED of the board |\n\nEsa es la tabla.")
  intacto("> The port is busy and it can't be opened, let's not touch it.\n\nEso es lo que dice el monitor.")
})

test("orden: después del primer español del texto no se borra nada (lo pidió o lo muestra)", () => {
  intacto("Te cuento qué pasó.\n\nA fatal error occurred: Could not open port COM3, the port is busy or doesn't exist.\n\nCerrá el monitor serie y probá de nuevo.")
  intacto("Acá tenés el texto para la clase de inglés técnico.\n\nThe Arduino Uno is a board that we can program. It has 14 digital pins and we use them to read sensors.")
  intacto("Traducido al inglés queda así:\n\nThe LED is on and the board is ready.\n\nThe sensor is connected to the pin 4 and it works.")
  intacto("Te salió este error:\n\nThe port is busy and it can't be opened.\n\n¿Probás con otro cable?")
  // Costo aceptado: un plan DESPUÉS de la respuesta se deja pasar.
  intacto("¡Listo! Ya compiló.\nNow I should ask if they want to upload it to the board.")
})

test("sin marca de plan no se borra nada: títulos, listas y errores sueltos en inglés", () => {
  intacto("What you will need:\n- 3 LEDs\n- 3 resistencias de 220 Ω\n- Un protoboard\n\nCon eso armamos el semáforo.")
  intacto("## Getting started with the ESP32\n\nPrimero conectá la placa por USB.")
  intacto("Serial.println imprime the value of the sensor")
  intacto("A fatal error occurred: Failed to connect to ESP32: No serial data received.")
})

test("un neutro español antes del inglés en la misma línea no se vuelve inglés", () => {
  intacto("Perfecto. The board is ready and it is connected. ¿Lo cargo?")
  intacto("Claro. In English it would be: the LED is on. ¿Algo más?")
})

test("umbral (mutante en>=1): una sola funcional inglesa no alcanza", () => {
  // "Upload the sketch." tiene una sola ("the"): queda neutro y no se borra.
  const r = limpiar("Upload the sketch.\n\nLet's write out the response.Che, ya está.")
  assert.equal(r.texto, "Upload the sketch.\n\nChe, ya está.")
})

test("umbral (mutante en>es): 3 inglesas contra 2 españolas sigue siendo español", () => {
  // Es el primer español del texto: de ahí en adelante no se toca nada.
  intacto("Con el sensor leés the value of the pin.\nLet's write out the response.Che, ya está.")
})

test("el código inline no cuenta (mutante sin protección del inline)", () => {
  intacto("Ejecutá `if the value is not ready then wait for the sensor` en el loop.")
})

test("CRLF: sin cambios vuelven los mismos bytes; con fuga se limpia igual", () => {
  intacto("¡Listo! Compiló bien.\r\n\r\n¿Lo cargo a la placa?\r\n")
  const r = limpiar("Now let's compile the project and then we will check it.\r\n\r\nChe, ya compiló. ¿Lo cargo?")
  assert.equal(r.texto, "Che, ya compiló. ¿Lo cargo?")
})

test("un identificador con _ no es una palabra: is_the_led_on no cuenta como inglés", () => {
  const [s] = analizar("is_the_led_on is_the_pin_ok")
  assert.equal(s.propio, "neutro")
})

test("rendimiento: arriba del tope vuelve sin tocar, y abajo del tope es rápido", () => {
  const enorme = Array.from({ length: 20_000 }, (_, i) => `Let's check line ${i}.`).join("\n")
  let t0 = performance.now()
  const r = limpiar(enorme)
  assert.equal(r.cambio, false)
  assert.equal(r.texto, enorme)
  assert.ok(performance.now() - t0 < 50, "arriba del tope tiene que volver al toque")
  // Casi en el tope y con la forma más cara: comillas que abren y nunca cierran.
  const casi = ("Let's check “this ".repeat(1200) + "Listo.").slice(0, MAX_TEXTO - 10)
  t0 = performance.now()
  limpiar(casi)
  assert.ok(performance.now() - t0 < 500, `tardó ${(performance.now() - t0).toFixed(0)} ms`)
})

test("código: una valla sangrada protege aunque adentro haya prosa en inglés (no sólo la red de seguridad)", () => {
  intacto("1. Paso uno\n\n      ```\n      Let's wait for the user here and then continue\n      ```\n2. Listo.")
})

test("un neutro antes del plan en la misma línea se queda; el plan se va", () => {
  // "OK." no tiene señal: no hereda el inglés que viene DESPUÉS en su línea.
  assert.equal(limpiar("OK. The board is ready and let's check it.\n\nListo, compiló.").texto, "OK.\n\nListo, compiló.")
})

test("un identificador con _ no cuenta como palabra: lo de afuera de la cita queda vacío", () => {
  const [s] = analizar('is_ok "Che, ya está listo."')
  assert.equal(s.soloCita, true)
  assert.equal(s.propio, "es")
})
