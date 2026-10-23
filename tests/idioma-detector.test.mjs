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
const { limpiar, analizar, MAX_TEXTO, desenvolver, pideIngles, pideEspanol } = await import(join(REPO, "opencode/plugins/idioma/detector.ts"))

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

// ---------------------------------------------------------------------------
// Ronda 3: lo que dejó pasar la 0.4.8 en la VM y lo que encontró la re-revisión
// ---------------------------------------------------------------------------

// Un mensaje del docente inventado (el real no se copia al repo).
const DOCENTE = "che, ¿el ESP32 se banca PWM para bajarle el brillo al LED?"

test("rescate: la respuesta en español presentada por una entrada del plan se conserva aunque quede otro español", () => {
  assert.equal(
    limpiar("Let's answer directly and in Spanish:\n**No, ahora mismo no la veo.** Windows no detecta ninguna placa conectada.\n\n¿Querés que te diga cómo revisar el cable?").texto,
    "**No, ahora mismo no la veo.** Windows no detecta ninguna placa conectada.\n\n¿Querés que te diga cómo revisar el cable?",
  )
  assert.equal(
    limpiar("Let's get started:\n1. Conectá el LED al pin 13.\n2. Subí el código.\n\n¿Te ayudo con algo más?").texto,
    "1. Conectá el LED al pin 13.\n2. Subí el código.\n\n¿Te ayudo con algo más?",
  )
  assert.equal(
    limpiar("Here's what we'll need:\n- 3 LEDs\n- 3 resistencias de 220 Ω\n- Un protoboard\n\nCon eso armamos el semáforo.").texto,
    "- 3 LEDs\n- 3 resistencias de 220 Ω\n- Un protoboard\n\nCon eso armamos el semáforo.",
  )
  assert.equal(
    limpiar("Now let's see the wiring:\n\nEl LED va al pin 13 y la resistencia a GND.\n\n¿Lo armaste?").texto,
    "El LED va al pin 13 y la resistencia a GND.\n\n¿Lo armaste?",
  )
})

test("rescate: si el borrador repite la respuesta que queda, NO se rescata (no se duplica)", () => {
  assert.equal(
    limpiar('Let\'s tell the user:\n"Che, la placa se desconectó del puerto."\n\nAnd let\'s end with a question.Che, la placa se desconectó del puerto. ¿La reconectás?').texto,
    "Che, la placa se desconectó del puerto. ¿La reconectás?",
  )
})

test("andamio del plan: se van las etiquetas en inglés y quedan los borradores en español", () => {
  assert.equal(
    limpiar(
      "Response structure:\n1. Enthusiastic confirmation: ¡Obvio que sí! El ESP32 tiene PWM en casi todos sus pines.\n2. Explain how it works: Se usa con `ledcAttach` y `ledcWrite`.\n3. Closing question: ¿Querés que armemos un ejemplo?",
    ).texto,
    "¡Obvio que sí! El ESP32 tiene PWM en casi todos sus pines.\nSe usa con `ledcAttach` y `ledcWrite`.\n¿Querés que armemos un ejemplo?",
  )
  // Con una respuesta final que repite los borradores, queda sólo la respuesta.
  assert.equal(
    limpiar(
      "Response structure:\n1. Enthusiastic confirmation: ¡Obvio que sí! El ESP32 tiene PWM.\n2. Closing question: ¿Querés un ejemplo?\n\n¡Obvio que sí! El ESP32 tiene PWM en casi todos sus pines. ¿Querés un ejemplo?",
    ).texto,
    "¡Obvio que sí! El ESP32 tiene PWM en casi todos sus pines. ¿Querés un ejemplo?",
  )
})

test("una lista en español con etiquetas en español no es un andamio", () => {
  intacto("Para armarlo:\n1. Materiales: un LED y una resistencia.\n2. Conexión: el LED va al pin 13.")
})

test("eco del mensaje del docente entre comillas: no es el ancla del español, y la respuesta en inglés se va", () => {
  const RESPUESTA =
    "Yes! The ESP32 supports PWM (Pulse Width Modulation) on any output GPIO using `ledcAttach` and `ledcWrite`, and you can set the frequency and the resolution of each channel as you need."
  const texto = `"${DOCENTE}"\n\n${RESPUESTA}`
  assert.equal(limpiar(texto, { ultimoUsuario: DOCENTE }).texto, "")
  // Sin saber el mensaje del docente no hay eco, y sin eco un párrafo en
  // inglés sin marca no se toca (ronda 4: puede ser una hoja de datos).
  intacto(texto)
  // Eco + respuesta en español: el eco se borra SÓLO junto con inglés; acá queda.
  intacto(`"${DOCENTE}"\n\n¡Sí! El ESP32 tiene PWM en casi todos sus pines.`)
  assert.equal(limpiar(`"${DOCENTE}"\n\n¡Sí! El ESP32 tiene PWM en casi todos sus pines.`, { ultimoUsuario: DOCENTE }).cambio, false)
})

test("una respuesta ENTERA en inglés sin marca se va SÓLO detrás del eco del docente", () => {
  const RESP = "Yes! The ESP32 supports PWM on any output pin. You can use it to dim the LED and it works with all the boards that we have in the lab."
  intacto(RESP)
  assert.equal(limpiar(`"${DOCENTE}"\n\n${RESP}`, { ultimoUsuario: DOCENTE }).texto, "")
  // Salvo lo que es un error o lo presenta una entrada que no es inglesa.
  intacto("ESP32-S3 DevKitC-1:\nThe board is not responding and the port will not open.\n\nProbá otro cable.")
  intacto("A fatal error occurred: Failed to connect to ESP32: No serial data received.")
  intacto("Serial.println imprime the value of the sensor")
})

test("si el docente pidió inglés o una traducción, ese turno no se toca", () => {
  const pedido = { ultimoUsuario: "armame una consigna en inglés para los chicos" }
  const textos = [
    "Let's build a traffic light! You will need three LEDs and three resistors. First, connect the red LED to pin 13.",
    "Worksheet: Let's learn about sensors!\n\n1. What is a sensor?\n2. How does the DHT11 work?",
    "Dear supplier,\n\nWe need 20 Arduino boards for the school. Could you send us a quote?\n\nThank you.",
  ]
  for (const t of textos) assert.equal(limpiar(t, pedido).cambio, false, t)
  assert.equal(limpiar(textos[0], { ultimoUsuario: "traducime esto" }).cambio, false)
  assert.equal(limpiar(textos[0], { ultimoUsuario: "¿Cómo se dice semáforo en english?" }).cambio, false)
  // Sin el pedido, el primero sí es una fuga.
  assert.equal(limpiar(textos[0]).texto, "")
})

test("una línea de error no se borra nunca, aunque diga 'the user'", () => {
  intacto("Error: the user does not have permission to open /dev/ttyUSB0 and the upload failed.\n\nAgregá tu usuario al grupo dialout.")
})

test("interjección sola: se va; en español o con más texto, se queda", () => {
  for (const t of ["Aha!", "Okay.", "Hmm...", "Got it."]) assert.equal(limpiar(t).texto, "", t)
  // Ronda 4: "Sure!", "Perfect!", "Great!" pueden ser lo que el docente pidió.
  for (const t of ["Sure!", "Perfect!", "Great!", "Perfect!\n\nYa está."]) intacto(t)
  intacto("Ok.")
  intacto("¡Perfecto!")
  intacto("Genial.")
})

test("no son marcas: 'Wait 2 seconds', un título con Let's, 'the soldering tool'", () => {
  intacto("Wait 2 seconds and then the LED will turn on.\n\nEso es lo que dice el manual: esperá 2 segundos.")
  intacto("## Let's build a traffic light\n\nVamos a armar un semáforo con tres LEDs.")
  intacto("The soldering tool is hot, so be careful with it.\n\nEso le decís a los chicos antes de soldar.")
})

test("marcas nuevas: I am going to, I must, my plan, the teacher, thinking about", () => {
  for (const [t, queda] of [
    ["I am going to compile the project first and then upload it to the board.\n\nVoy a compilar el proyecto.", "Voy a compilar el proyecto."],
    ["The teacher wants to upload the code to the board. I must check the port first.\n\nReviso el puerto.", "Reviso el puerto."],
    ["My plan is to compile it and then flash it to the board.\n\nLo compilo y lo cargo.", "Lo compilo y lo cargo."],
    ["Thinking about this: the board is not detected, so the cable might be the problem.\n\nPuede ser el cable.", "Puede ser el cable."],
    ["Let's check la placa first.\n\nReviso la placa.", "Reviso la placa."],
  ])
    assert.equal(limpiar(t).texto, queda, t)
})

test("la red de código no deja colgando pedazos de una fuga", () => {
  assert.equal(
    limpiar('The tool returned action: "compile" and status = ok. Let\'s tell the user it compiled.\n\n¡Listo! Compiló sin errores.').texto,
    "¡Listo! Compiló sin errores.",
  )
  assert.equal(
    limpiar('The tool reported: {"ok": false, "error": "port busy"}. Let\'s communicate this clearly and warmly.\n\nChe, el puerto está ocupado. ¿Cerraste el Arduino IDE?').texto,
    "Che, el puerto está ocupado. ¿Cerraste el Arduino IDE?",
  )
  assert.equal(limpiar("Let's check whether ok = true before we answer the user.\n\n¡Listo! Ya compiló.").texto, "¡Listo! Ya compiló.")
  assert.equal(limpiar("The upload failed; let's tell the user to close the IDE.\n\nCerrá el Arduino IDE y probá de nuevo.").texto, "Cerrá el Arduino IDE y probá de nuevo.")
  // Una línea con código de verdad y sin marca de plan no se toca.
  assert.equal(
    limpiar("Let's show the fix to the user.\nThe loop calls digitalWrite(2, HIGH);\n\nListo.").texto,
    "The loop calls digitalWrite(2, HIGH);\n\nListo.",
  )
})

test("mutantes que sobrevivían: IP con puntos, entrada sin marca después de un plan, continuación de lista", () => {
  // "192.168.4.1." no corta oración: la línea es una sola y tiene español.
  intacto("Let's go to 192.168.4.1. Ahora entrá desde el celu.")
  // "Here's what you will need:" no tiene marca: la lista que presenta se queda.
  assert.equal(
    limpiar("Let's tell the user the materials.\n\nHere's what you will need:\n- 3 LEDs\n- 3 resistencias de 220 Ω\n\nCon eso armamos el semáforo.").texto,
    "- 3 LEDs\n- 3 resistencias de 220 Ω\n\nCon eso armamos el semáforo.",
  )
  // Sangrado después de un ítem de lista = continuación, no código: el plan se va.
  assert.equal(limpiar("1. Paso uno\n\n    Let's wait for the user here.\n2. Listo.").texto, "1. Paso uno\n\n2. Listo.")
})

test("respuesta entera en inglés: un error largo o un texto presentado con dos puntos no cuentan", () => {
  intacto("Failed to connect to ESP32 because the chip is not in download mode and the port is busy, so it could not open it at all.")
  intacto("ESP32-S3 DevKitC-1:\nThe board is not responding and the port will not open, so it is not possible to upload the code to it.\n\nProbá otro cable.")
})

test("red de código: con marca de plan no protege, y en la misma línea que un plan se va la línea entera", () => {
  assert.equal(limpiar("Let's call digitalWrite(2, HIGH); for the user.\n\nListo.").texto, "Listo.")
  assert.equal(limpiar("Let's tell the user. The loop calls digitalWrite(2, HIGH);\n\nListo.").texto, "Listo.")
})

// ---------------------------------------------------------------------------
// Ronda 4: umbrales y reglas angostadas (cada test mata un mutante)
// ---------------------------------------------------------------------------

const eco = (resp) => `"${DOCENTE}"\n\n${resp}`
const conDocente = { ultimoUsuario: DOCENTE }

test("4b: hacen falta 8 funcionales inglesas (8 se va, 7 se queda)", () => {
  // the, has, and, it, is, all, of, the = 8
  assert.equal(limpiar(eco("Yes, the ESP32 has PWM and it is on all pins of the board."), conDocente).texto, "")
  // the, has, and, it, is, all, of = 7 ("a" no cuenta)
  assert.equal(limpiar(eco("Yes, the ESP32 has PWM and it is on all pins of a board."), conDocente).cambio, false)
})

test("4b: más del TRIPLE de funcionales inglesas que españolas (9 contra 4 se queda)", () => {
  assert.equal(limpiar(eco("Yes, the ESP32 has PWM and it is on all the pins of the board, que es la del kit."), conDocente).cambio, false)
})

test("rescate: una oración del borrador repite la respuesta si comparte el 70 % de sus bigramas", () => {
  // Bloque de dos líneas: la segunda es nueva, así que el bloque entero no repite.
  const nueva = "\nDespués medí la tensión con el tester en los bornes del regulador."
  // Primera línea: 4 de 5 bigramas (0,8) en la respuesta: repite, no vuelve.
  assert.equal(
    limpiar("Let's tell the user:\nPrimero revisá bien cada conexión suelta." + nueva + "\n\nAhora revisá bien cada conexión suelta.").texto,
    "Después medí la tensión con el tester en los bornes del regulador.\n\nAhora revisá bien cada conexión suelta.",
  )
  // 3 de 5 (0,6): no repite, vuelve.
  assert.equal(
    limpiar("Let's tell the user:\nPrimero revisá bien cada conexión floja." + nueva + "\n\nAhora revisá bien cada conexión suelta.").texto,
    "Primero revisá bien cada conexión floja." + nueva + "\n\nAhora revisá bien cada conexión suelta.",
  )
  // Una oración con UN solo bigrama no alcanza para decir que repite.
  assert.equal(
    limpiar("Let's tell the user:\nYa conexiones revisadas." + nueva + "\n\nQuedaron las conexiones revisadas por vos.").texto,
    "Ya conexiones revisadas." + nueva + "\n\nQuedaron las conexiones revisadas por vos.",
  )
})

test("rescate: si la mitad de las palabras del borrador ya está en la respuesta, no vuelve (misma respuesta dicha de otra forma)", () => {
  assert.equal(
    limpiar(
      "The diagnostic tool shows the board on COM9.\nLet's answer clearly:\n**Sí, ahora la veo en COM9.**\nEstá conectada con el chip CH340.\n\n¡Sí! Ahí apareció en el puerto `COM9` con el chip CH340. ¿La cargo?",
    ).texto,
    "¡Sí! Ahí apareció en el puerto `COM9` con el chip CH340. ¿La cargo?",
  )
  assert.equal(
    limpiar(
      "Let's draft the answer:\nPrimero conectá el sensor al GPIO 4 y después cargá el ejemplo.\nSi no anda, revisá la resistencia de 10k.\n\nPrimero conectá el sensor al GPIO 4 y cargá el ejemplo. Si no anda, revisá la resistencia de 10k.",
    ).texto,
    "Primero conectá el sensor al GPIO 4 y cargá el ejemplo. Si no anda, revisá la resistencia de 10k.",
  )
})

test("rescate: placa, cable, Arduino, sensor no cuentan para decir que repite", () => {
  // Sin los sustantivos del dominio, el borrador sólo tiene "revisá": no repite nada.
  assert.equal(
    limpiar("Let's tell the user:\nRevisá el cable, la placa Arduino y el sensor ESP32.\n\nMirá el cable, la placa Arduino y el sensor ESP32 del kit.").texto,
    "Revisá el cable, la placa Arduino y el sensor ESP32.\n\nMirá el cable, la placa Arduino y el sensor ESP32 del kit.",
  )
})

test("rescate: no vuelve lo que tiene más inglés que español, ni la salida de una tool, ni neutros sueltos", () => {
  assert.equal(limpiar("Let's tell the user:\n\nChe, the board is ready.\n\nListo.").texto, "Listo.")
  assert.equal(
    limpiar('The tool reported:\n"Hay una placa enchufada pero no la puedo usar."\n\nLet\'s tell the user.Che, la placa tiene un problema.').texto,
    "Che, la placa tiene un problema.",
  )
  assert.equal(limpiar("Let's check the env block:\nWorking directory: `C:\\x`.\n\nListo.").texto, "Listo.")
})

test("eco: hace falta el 80 % del mensaje del docente; una cita más corta no es eco", () => {
  // "el ESP32 se banca PWM para bajarle" es ~60 % del mensaje: no es eco, y sin eco no hay 4b.
  intacto(`"el ESP32 se banca PWM para bajarle"\n\nYes, the ESP32 has PWM and it is on all pins of the board.`)
  assert.equal(
    limpiar(`"el ESP32 se banca PWM para bajarle"\n\nYes, the ESP32 has PWM and it is on all pins of the board.`, conDocente).cambio,
    false,
  )
})

test("eco: el mensaje del docente envuelto en un recordatorio se desenvuelve", () => {
  const envuelto = `<system-reminder>\nThe user sent the following message:\n${DOCENTE}\n\nPlease address this message and continue with your tasks.\n</system-reminder>`
  assert.equal(desenvolver(envuelto), DOCENTE)
  assert.equal(limpiar(eco("Yes, the ESP32 has PWM and it is on all pins of the board."), { ultimoUsuario: envuelto }).texto, "")
  assert.equal(desenvolver("sin envoltorio"), "sin envoltorio")
})

test("líneas Warning: y Fatal: tampoco se borran nunca", () => {
  intacto("Warning: let's not upload while the user has the monitor open.\n\nCerrá el monitor.")
  intacto("Fatal: the user has no permission, let's tell them.\n\nPedí permiso al administrador.")
})

test("una etiqueta en español no se vuelve andamio aunque el texto tenga una marca", () => {
  assert.equal(limpiar("Let's go.\n\n1. Materiales: un LED.\n\nListo.").texto, "1. Materiales: un LED.\n\nListo.")
})

test("red de código: flechas de cableado, comandos pio y llamadas al final de la línea", () => {
  assert.equal(limpiar("Let's wire it now.\nVCC → 5V and GND → GND.\n\nListo.").texto, "VCC → 5V and GND → GND.\n\nListo.")
  assert.equal(limpiar("Let's run it now.\npio run -t upload and then monitor.\n\nListo.").texto, "pio run -t upload and then monitor.\n\nListo.")
  assert.equal(limpiar("Let's call it now.\nthen call setup()\n\nListo.").texto, "then call setup()\n\nListo.")
})

test("un JSON {…} sin cortar no se mutila aunque adentro tenga inglés", () => {
  assert.equal(
    limpiar('{"msg": "the board is ready and it is fine"}\n\nLet\'s tell the user.\n\nListo.').texto,
    '{"msg": "the board is ready and it is fine"}\n\nListo.',
  )
})

test("pedido de inglés: afirmativo; 'no en inglés', 'traductor' o 'Inglese' no cuentan", () => {
  for (const sí of ["escribime en inglés un texto corto", "pasalo a inglish", "en ingles porfa", "in English please", "traducime esto"]) assert.equal(pideIngles(sí), true, sí)
  for (const no of ["en español, si? no en inglés", "uso el traductor de google", "soy la profe Inglese", "no me traduzcas los errores", "la clase de inglés es mañana"]) assert.equal(pideIngles(no), false, no)
  assert.equal(pideEspanol("ahora en español, por favor"), true)
  assert.equal(pideEspanol("no en español"), false)
})

test("relleno 'Let's see:' con español en su línea: no cede la voz aunque otra línea tenga plan", () => {
  assert.equal(
    limpiar("Let's tell the user about it.\nLet's see: `pio run` compila. Probalo.").texto,
    "Let's see: `pio run` compila. Probalo.",
  )
})

test("4b con eco: un error/log o un párrafo presentado con dos puntos no se borran", () => {
  intacto(eco("Failed to connect to ESP32 because the chip is not in download mode and the port is busy, so it could not open it at all."))
  assert.equal(
    limpiar(eco("Failed to connect to ESP32 because the chip is not in download mode and the port is busy, so it could not open it at all."), conDocente).cambio,
    false,
  )
  assert.equal(
    limpiar(eco("ESP32 DevKit:\nThe board is not responding and the port will not open, so it is not possible to upload the code to it."), conDocente).cambio,
    false,
  )
})

test("si después de sacar el plan sólo queda una cita entera, también se va", () => {
  assert.equal(limpiar('Let\'s check the tool output first.\n\n"No encuentro ninguna placa conectada."').texto, "")
})

test("el código inline no cuenta aunque adentro diga let's o the user", () => {
  intacto("Ejecutá `let's check the user and the tool output then` en el loop.")
})

// ---------------------------------------------------------------------------
// Ronda 5
// ---------------------------------------------------------------------------

test("lo que presenta 'Tone:' o 'Key points:' no se rescata, ni sobran sus restos", () => {
  assert.equal(limpiar("Let's check the rules:\n- Tone: Rioplatense, con vos.\n- End with a question.\n\nChe, ya compiló. ¿La cargo?").texto, "Che, ya compiló. ¿La cargo?")
  assert.equal(limpiar("Let's check the rules:\n- Tone: cálido y con voseo.\n\nChe, ya compiló.").texto, "Che, ya compiló.")
})

test("misma línea: 'Let me explain: <respuesta en español>' no queda vacío", () => {
  for (const [t, queda] of [
    ["Let me explain: el PWM prende y apaga el pin muy rápido, y el promedio es el brillo.", "el PWM prende y apaga el pin muy rápido, y el promedio es el brillo."],
    ["Let me explain: el PWM prende y apaga el pin muy rápido. ¿Querés un ejemplo?", "el PWM prende y apaga el pin muy rápido. ¿Querés un ejemplo?"],
    ["Let me check: tu placa está en COM5 y responde bien.", "tu placa está en COM5 y responde bien."],
    ["Let's tell the user: ¡Compiló sin errores!", "¡Compiló sin errores!"],
  ])
    assert.equal(limpiar(t).texto, queda, t)
  // El prompt recitado no vuelve nunca, aunque no quede nada.
  assert.equal(limpiar("Now let's compile the project.\nRemember the rule: compilar es control de calidad nuestro.").texto, "")
})

test("restos cosméticos: 'Thinking:' y una interjección pegada al plan se van", () => {
  assert.equal(limpiar("Thinking:\n\nChe, el puerto está ocupado: cerrá el monitor serie y probá de nuevo.").texto, "Che, el puerto está ocupado: cerrá el monitor serie y probá de nuevo.")
  assert.equal(limpiar("Great! I will now upload the program to the board and then we will check it.\n\nListo.").texto, "Listo.")
})

test("eco corto ('dale', 'si'): no es eco, y un párrafo en inglés sin marca no se vacía", () => {
  const RESP = "The board is ready and it is connected to the port, so we can upload the code now if you want it."
  for (const u of ["dale", "si"]) assert.equal(limpiar(`"${u}"\n\n${RESP}`, { ultimoUsuario: u }).cambio, false, u)
})

test("4b mira sólo los párrafos ANTES del primer español: lo que sigue a 'Acá va el cartel…' se queda", () => {
  const u = "armame el cartel para la puerta del laboratorio"
  intacto(`"${u}"\n\nAcá va el cartel, como lo usan en la escuela bilingüe.\n\nPlease do not touch the boards on the table. If you need help, ask the teacher and wait for your turn, because the lab is shared with the other classes.`)
  assert.equal(
    limpiar(`"${u}"\n\nAcá va el cartel, como lo usan en la escuela bilingüe.\n\nPlease do not touch the boards on the table. If you need help, ask the teacher and wait for your turn, because the lab is shared with the other classes.`, { ultimoUsuario: u }).cambio,
    false,
  )
})

test("4b no se aplica si el docente escribió en inglés o la respuesta repite lo que pidió", () => {
  const corregir = "corregime: The sensor is connected to the pin 4 and it is working fine"
  const eco1 = '"The sensor is connected to the pin 4 and it is working fine"'
  assert.equal(
    limpiar(`${eco1}\n\nThe sentence is correct, but it is better if you say "connected to pin 4" without "the", because it is a specific pin.`, { ultimoUsuario: corregir }).cambio,
    false,
  )
  // Letra inventada (no se copian canciones reales a los tests).
  const letra = "pasame la letra de jumping robot para el buzzer"
  assert.equal(
    limpiar(`"${letra}"\n\nJumping robot, jumping robot, blink your lights and turn your wheels. Jumping robot, dance with me in the lab, and all the kids will sing with you.`, { ultimoUsuario: letra }).cambio,
    false,
  )
})

test("rescate: un borrador corto incluido tal cual en la respuesta no se duplica", () => {
  assert.equal(limpiar("Let's tell the user:\n¿Lo cargo a la placa?\n\nYa compiló. ¿Lo cargo a la placa?").texto, "Ya compiló. ¿Lo cargo a la placa?")
})

test("misma línea: un borrador con una sola funcional española no se rescata", () => {
  assert.equal(
    limpiar("Response structure:\n1. Greeting: Hola profe.\n2. Explain: El PWM prende y apaga el pin.").texto,
    "El PWM prende y apaga el pin.",
  )
})

test("rescate: el chequeo por párrafo necesita 3+ palabras; con menos, la respuesta corta vuelve", () => {
  assert.equal(
    limpiar("Let's answer directly and in Spanish:\n**No, no la veo.** Windows no detecta la placa.\n\nProbá con otro cable USB; si Windows no la detecta, puede ser el driver de la placa.").texto,
    "**No, no la veo.** Windows no detecta la placa.\n\nProbá con otro cable USB; si Windows no la detecta, puede ser el driver de la placa.",
  )
})

// ---------------------------------------------------------------------------
// Ronda 6
// ---------------------------------------------------------------------------

test("4b: 'repite lo que pidió' exige 2+ palabras SEGUIDAS no castellanas ni del taller", () => {
  const casos = [
    ["el esp32 tiene bluetooth y wifi?", "Yes! The ESP32 has both WiFi and Bluetooth built in, so you can use them in your projects and it is very easy to start with the examples."],
    ["como conecto el sensor de temperatura al arduino", "To connect the temperature sensor to the Arduino, you need to wire the data pin to a digital pin and add a pull-up resistor, and then you can read it with the library."],
    ["como uso el monitor serial", "You can open the serial monitor from the tools menu, and then you have to set the baud rate to the same value that is in your code."],
    ["el servo no se mueve, que hago", "If the servo is not moving, check that it has its own power supply and that the signal wire is on a PWM pin of the board."],
  ]
  for (const [u, resp] of casos) assert.equal(limpiar(`"${u}"\n\n${resp}`, { ultimoUsuario: u }).texto, "", u)
  // Igual que antes: la letra pedida (inventada) con "jumping robot" seguido, se queda.
  const letra = "pasame la letra de jumping robot para el buzzer"
  assert.equal(limpiar(`"${letra}"\n\nJumping robot, jumping robot, blink your lights and turn your wheels. Jumping robot, dance with me in the lab, and all the kids will sing with you.`, { ultimoUsuario: letra }).cambio, false)
  // Mismas palabras, pero no seguidas en el pedido: no cuenta.
  const suelto = "pasame la letra de la canción del robot que hace jumping"
  assert.equal(limpiar(`"${suelto}"\n\nJumping robot, jumping robot, blink your lights and turn your wheels. Jumping robot, dance with me in the lab, and all the kids will sing with you.`, { ultimoUsuario: suelto }).texto, "")
})

test("4b: 'qué significa X' o 'qué es X' es una pregunta en español: la respuesta en inglés se va", () => {
  const resp = "A feedback loop is when the output of a system is fed back as an input, so the system can correct itself and keep the value where you want it."
  for (const u of ["qué significa feedback loop", "que significa feedback loop?", "qué es un feedback loop"]) assert.equal(limpiar(`"${u}"\n\n${resp}`, { ultimoUsuario: u }).texto, "", u)
})

test("pedido de inglés: una QUEJA que menciona 'en inglés' no es pedido; el verbo de pedido sí", () => {
  for (const queja of [
    "me estás contestando en inglés, hablame en español",
    "¿por qué me respondés en inglés? en español por favor",
    "me escribiste en inglés otra vez, en español porfa",
    "eso que pusiste en inglés pasalo a español",
    "está todo en inglés, ponelo en castellano",
    "che, apareció un texto en inglés arriba. respondeme en español",
  ])
    assert.equal(pideIngles(queja), false, queja)
  for (const pedido of [
    "pasame la consigna en inglés y abajo explicámela en español",
    "traducí la consigna al inglés; lo demás dejalo en castellano",
    "pasala al inglés, pero hablame en español",
    "respondeme en inglés",
    "decime 'got it' en inglés",
    "en ingles porfa",
  ])
    assert.equal(pideIngles(pedido), true, pedido)
})

test("pedido de inglés: casos finos", () => {
  // Una queja sola, sin pedir español, tampoco es pedido.
  assert.equal(pideIngles("me estás contestando en inglés"), false)
  // "en inglés" sin verbo de pedido y con español: ante la duda gana el español.
  assert.equal(pideIngles("la consigna en inglés y la explicación en español"), false)
  // "traducí" solo (con tilde al final) es pedido.
  assert.equal(pideIngles("traducí esto"), true)
})

test("4b: dos palabras del taller seguidas ('serial monitor') no cuentan como repetir el pedido", () => {
  const u = "como abro el serial monitor"
  assert.equal(
    limpiar(`"${u}"\n\nYou can open the serial monitor from the tools menu, and then you have to set the baud rate to the same value that is in your code.`, { ultimoUsuario: u }).texto,
    "",
  )
})
