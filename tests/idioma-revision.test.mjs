// Casos de la revisión adversaria final (ronda 4) del filtro de inglés.
// Corre con: node --test tests/idioma-revision.test.mjs
//
// POR QUÉ. La ronda 3 agregó reglas para frenar dos fugas de la VM (el eco del
// mensaje del docente + respuesta entera en inglés, y el andamio "Response
// structure:"), y la revisión mostró que esas reglas, anchas, borraban cosas
// legítimas: una hoja de datos citada, la salida del monitor serie, un mail
// pedido, listas "1. Setup:", "Plan: primero compilamos…". Acá están TODOS
// esos casos "se queda" (escritos por el revisor, sin datos de nadie), más los
// "se va" que tienen que seguir frenándose. Cada uno es
// [qué es, texto, último mensaje del docente].

import { test } from "node:test"
import assert from "node:assert/strict"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const { limpiar } = await import(join(REPO, "opencode/plugins/idioma/detector.ts"))

const SE_QUEDAN = [
  ["cita docente + respuesta es", "Vos me dijiste: \"el LED no prende\". Tenés razón, el pin estaba mal.", "el LED no prende"],
  ["cita docente sola en linea + es", "\"el LED no prende y ya probé todo\"\n\nTenés razón, revisemos el pin.", "el LED no prende y ya probé todo"],
  ["cita docente al inicio, luego respuesta es", "\"¿Por qué no compila?\" Buena pregunta: falta un punto y coma.", "¿Por qué no compila?"],
  ["cita docente inglés literal", "\"what does pull-up mean\"\n\nPull-up significa que el pin queda en alto por defecto.", "what does pull-up mean"],
  ["eco con > quote", "> el LED no prende\n\nTenés razón, revisemos.", "el LED no prende"],
  ["eco en inglés de docente que escribió en inglés, respuesta neutra", "\"blink led pin 13\"\n\n```cpp\ndigitalWrite(13, HIGH);\n```", "blink led pin 13"],
  ["eco solo cita, respuesta neutra lista", "\"pasame los pines del DHT11\"\n\n- VCC: 5V\n- DATA: D2\n- GND: GND", "pasame los pines del DHT11"],
  ["eco cita + respuesta con código", "\"cómo prendo el LED\"\n\n```cpp\ndigitalWrite(13, HIGH);\n```\n\nAsí.", "cómo prendo el LED"],
  ["datasheet excerpt al inicio", "The DHT11 is a basic, ultra low-cost digital temperature and humidity sensor. It uses a capacitive humidity sensor and a thermistor to measure the surrounding air, and spits out a digital signal on the data pin.\n\nEso dice la hoja de datos: es un sensor barato y lento.", "qué dice la hoja de datos del DHT11"],
  ["README snippet", "This library allows an Arduino board to control the servo motors. It is the one that is included with the IDE and you can use it for up to 12 motors on most boards.\n\nEsa es la descripción de la librería Servo.", "qué hace la librería Servo"],
  ["serial monitor output", "Connecting to WiFi... the connection is ok and the IP is 192.168.4.1. Sensor value is 512 and it is in the range.\n\nEso es lo que imprime el monitor serie: anda bien.", "qué sale en el monitor serie"],
  ["compiler warning sin Error:", "src/main.cpp:12:5: warning: unused variable 'x' [-Wunused-variable]\nIn function 'void loop()': the value of the variable is not used and it is set but never read.\n\nEs sólo un aviso, no un error.", "qué significa este aviso"],
  ["warning sin prefijo, prosa", "Sketch uses 924 bytes (2%) of program storage space. Maximum is 32256 bytes. Global variables use 9 bytes (0%) of dynamic memory, leaving 2039 bytes for local variables. Low memory available, stability problems may occur.\n\nCompiló bien, ocupa poco.", "compilá"],
  ["avrdude stk500", "avrdude: stk500_recv(): programmer is not responding and the board is not in sync with it, so it will try again after the reset.\n\nEso pasa cuando el puerto está mal.", "no sube"],
  ["URL paragraph", "See https://docs.arduino.cc/learn/ for the docs and https://www.arduino.cc/reference/en/ for the reference. You can also check the forum at https://forum.arduino.cc if you have any questions about it.\n\nAhí tenés los enlaces oficiales.", "pasame la documentación"],
  ["email sin pedido inglés", "Dear supplier,\n\nWe would like to order 20 boards for the school. Could you send us a quote with the shipping cost?\n\nThank you.", "escribile un mail al proveedor de AliExpress pidiendo 20 placas"],
  ["consigna para chicos en ingles sin palabra ingles", "Today we are going to build a traffic light with the Arduino. First, you have to connect the red LED to pin 13, and then the green one to pin 11.\n\n¿Querés que agregue preguntas?", "armame la consigna para 4to B (es una escuela bilingüe)"],
  ["English pedido con 'inglish' typo", "Today we are going to build a traffic light with the Arduino. First, you have to connect the red LED to pin 13, and then the green one to pin 11.", "pasalo a inglish"],
  ["pedido 'en ingles' sin tilde", "Today we are going to build a traffic light with the Arduino. First, you have to connect the red LED to pin 13 and then the green one.", "en ingles porfa"],
  ["serial output con code fence no", "Mirá:\nThe temperature is 26 and the humidity is 40, it is ok and it is in the range of the sensor.\n\nAnda.", "qué sale"],
  ["1. Setup:", "Te explico el código:\n\n1. Setup:\nConfigurás el pin 13 como salida.\n2. Loop:\nPrendés y apagás el LED.\n3. Debounce:\nEsperás 50 ms antes de leer.", "explicame"],
  ["1. Setup: sin intro", "1. Setup:\nConfigurás el pin 13 como salida.\n2. Loop:\nPrendés y apagás el LED.", "explicame"],
  ["1. Testing:", "1. Testing:\nProbá el LED con el ejemplo Blink.\n2. Wiring:\nConectá el ánodo al pin 13.", "cómo pruebo"],
  ["1. Testing: misma linea", "1. Testing: probá el LED con el ejemplo Blink.\n2. Wiring: conectá el ánodo al pin 13.", "cómo pruebo"],
  ["- Debouncing:", "- Debouncing:\nEsperás 50 ms.\n- Polling:\nLeés el pin en cada vuelta.", "x"],
  ["1. Setup: inglés corto", "1. Setup: the pins.\n2. Loop: the logic.\n\nAsí se arma un sketch.", "x"],
  ["**Setup**:", "**Setup**:\nConfigurás el pin.\n**Loop**:\nPrendés el LED.", "x"],
  ["1. Final answer label in Spanish list", "Pasos:\n1. Response time:\nEl sensor tarda 2 segundos.\n2. Structure:\nTiene tres patas.", "x"],
  ["Plan: español", "Plan: primero compilamos y después cargamos.\n\n¿Te parece?", "x"],
  ["Tone: neutro? -> structure", "Structure:\n- setup()\n- loop()\n\nEsas son las dos funciones.", "x"],
  ["Ok.", "Ok.", "x"],
  ["Listo", "Listo", "x"],
  ["Dale!", "Dale!", "x"],
  ["Got it pedido ingles", "Got it!", "decime 'got it' en inglés"],
  ["Perfect con es despues", "Perfect!\n\nYa está.", "x"],
  ["Wiring sin es: pines", "1. Wiring:\nVCC → 5V, DATA → D2, GND → GND\n\nListo, así se conecta.", "cómo lo conecto"],
  ["Connection: pines lista", "Connection:\n- VCC: 5V\n- DATA: D2\n\nAsí lo conectás.", "x"],
  ["Wiring: tabla md", "Wiring:\n\n| Pin | Placa |\n|---|---|\n| VCC | 5V |\n\nAsí va.", "x"],
  ["1. Wiring: code", "1. Wiring:\n   pinMode(13, OUTPUT)\n2. Testing:\n   digitalWrite(13, HIGH)\n\nCon eso alcanza.", "x"],
  ["Steps: lista neutra", "Steps:\n1. pio run\n2. pio run -t upload\n3. pio device monitor\n\nCorré esos tres comandos.", "x"],
  ["Draft: es (pedido borrador)", "Draft:\nEstimadas familias, el viernes hacemos la feria de ciencias.\n\n¿Querés que lo cambie?", "armame un borrador de nota para las familias"],
  ["Answer: es", "Answer:\nEl LED va al pin 13.\n\nRespuesta corta: pin 13.", "x"],
  ["code net: python", "The script will read the value:\n\nvalue = sensor.read()\nprint(value)\n\nEso es MicroPython.", "x"],
  ["mixed line", "Let's see: `pio run` compila. Probalo.", "x"],
  ["seguimiento de traducción", "Today we are going to build a traffic light with the Arduino. First, you have to connect the red LED to pin 13, and then you connect the green one to pin 11. After that, upload the code.\n\nAgregué la oración del final.", "agregale una oración más sobre cargar el código"],
  ["seguimiento: 'hacelo más corto'", "Today we are going to build a traffic light. First, you have to connect the red LED to pin 13 and then the green one to pin 11.", "hacelo más corto"],
  ["seguimiento sin nota es", "Today we are going to build a traffic light with the Arduino. First, you have to connect the red LED to pin 13, and then you connect the green one to pin 11. After that, upload the code.", "ahora la parte 2"],
  ["datasheet con intro es", "Según la hoja de datos:\n\nThe DHT11 is a basic, ultra low-cost digital temperature and humidity sensor. It uses a capacitive humidity sensor and a thermistor to measure the air.\n\nO sea, es barato.", "x"],
  ["datasheet en > ", "> The DHT11 is a basic, ultra low-cost digital temperature and humidity sensor. It uses a capacitive humidity sensor and a thermistor to measure the air.\n\nO sea, es barato.", "x"],
  ["texto tras tool: salida serie", "Connecting to WiFi... the connection is ok and it is up. The IP is 192.168.4.1 and the server is running on port 80, so it is ready.\n\nYa se conectó.", "x"],
  ["pista con docente que escribe en inglés", "The sensor is not working because the data pin is not connected to the board. You have to connect it to D2 and then it will work.", "My sensor doesn't work, why?"],
  ["4b con es en el párrafo", "The DHT11 is a sensor that is very cheap and it is in the kit, pero ojo que es lento y no es muy preciso.\n\nUsalo igual.", "x"],
  ["4b lyrics/canción pedida", "Twinkle, twinkle, little star, how I wonder what you are. Up above the world so high, like a diamond in the sky.\n\nEsa es la letra para el buzzer.", "pasame la letra de twinkle twinkle para la melodía del buzzer"],
]

const SE_VAN = [
  ["eco + respuesta inglés (leak)", "\"no me anda el sensor\"\n\nThe sensor is not responding. Let's check the wiring.\n\nRevisá los cables del sensor.", "no me anda el sensor"],
  ["Okay.", "Okay.", "x"],
  ["docente se queja 'no en inglés'", "The tool reported an error. Let's tell the user the port is busy.\n\nEl puerto está ocupado.", "en español por favor, no en inglés"],
  ["docente 'no me traduzcas'", "Let's tell the user it compiled.\n\n¡Compiló!", "no me traduzcas los errores, explicámelos"],
  ["docente 'Ingles' apellido", "Let's tell the user it compiled.\n\n¡Compiló!", "soy la profe Inglese, compilá"],
  ["docente 'traductor'", "Let's tell the user it compiled.\n\n¡Compiló!", "uso el traductor de google para los datasheets, compilá"],
]

for (const [que, texto, docente] of SE_QUEDAN) {
  test(`se queda: ${que}`, () => {
    const r = limpiar(texto, docente === undefined ? {} : { ultimoUsuario: docente })
    assert.equal(r.cambio, false, `quitó: ${JSON.stringify(r.quitados)}`)
    assert.equal(r.texto, texto)
  })
}

for (const [que, texto, docente] of SE_VAN) {
  test(`se va el inglés: ${que}`, () => {
    const r = limpiar(texto, docente === undefined ? {} : { ultimoUsuario: docente })
    assert.equal(r.cambio, true)
    assert.doesNotMatch(r.texto, /\b(?:let's|the user|the tool)\b/i)
  })
}
