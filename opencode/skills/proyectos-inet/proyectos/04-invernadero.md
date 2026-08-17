# Proyecto 04 — Invernadero

🔗 **Verlo en vivo (animación + simulador interactivo):** https://tecnialab.net.ar/proyectos/04-invernadero/
> El alumno arma un invernadero que avisa cuándo ventilar según la temperatura, después agrega un display LCD con temperatura y humedad, y por último monitorea todo por IoT.

## De qué se trata
Se construye una maqueta de invernadero (estructura cubierta con material translúcido, con una abertura para ventilar) con un sensor DHT11 que mide temperatura y humedad. Cuando la temperatura supera un umbral, un LED avisa que hay que ventilar. Con display y luego con IoT, el sistema se vuelve cada vez más informativo.

## Los niveles
- **Inicial — Avisar cuándo ventilar por temperatura**: DHT11 + LED que parpadea al superar el umbral de temperatura (un LED titilando llama más la atención que uno fijo).
- **Intermedio — Ver temperatura y humedad en un display LCD**: se agrega un LCD 1602 (Keypad Shield paralelo en UNO / I2C en ESP32) que muestra temperatura y humedad en pantalla.
- **Avanzado — Monitorear el invernadero con IoT**: código no bloqueante (`millis()`); el LED de aviso pasa de parpadear a quedar fijo mientras dura la alerta; publicación por WiFi/MQTT.

## Materiales
- Arduino UNO o ESP32 DevKit v1
- Sensor DHT11
- LED de ventilación + resistencia 220 Ω
- LCD 1602: Keypad Shield paralelo (UNO) o LCD I2C (ESP32)
- Librería "DHT sensor library" de Adafruit (+ dependencia "Adafruit Unified Sensor")
- Librería LiquidCrystal (UNO) o LiquidCrystal_I2C (ESP32) — **ninguna de las dos "viene sola" en PlatformIO**: van declaradas en `lib_deps` (ver el gotcha de librerías)

## Pinout (exacto — de PINES_INVERNADERO)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| DHT11 · dato | pin 2 | GPIO 4 |
| LED de ventilación | pin 13 | GPIO 16 |
| LCD | paralelo: RS 8, E 9, D4-D7 4/5/6/7 (shield) | I2C: SDA GPIO21 / SCL GPIO22 |

## Cableado (de la tabla de conexionado)
**En ESP32 hay DOS buses +, y cada módulo va en el suyo.** En UNO hay uno solo, el de 5 V.

| Desde | Hacia | Color |
|---|---|---|
| Placa · **5V** (UNO) / **VIN** (ESP32) | **Bus +5V** | 🔴 rojo |
| Placa · **3V3** (sólo ESP32) | **Bus +3V3** | 🟠 naranja |
| Placa · GND | Bus − protoboard | ⚫ negro |
| **DHT11 · VCC** | UNO: Bus +5V — **ESP32: Bus +3V3** | 🔴 / 🟠 |
| DHT11 · GND | Bus − | ⚫ negro |
| DHT11 · DATA | placa · pin 2/GPIO4 | 🟡 amarillo |
| LED ventilación · ánodo | placa · pin 13/GPIO16 | 🔵 azul |
| LED ventilación · cátodo | Resistencia 220 Ω → Bus − | ⚫ negro |
| **LCD I2C (ESP32) · VCC** | **Bus +5V** | 🔴 rojo |
| LCD I2C (ESP32) · GND | Bus − | ⚫ negro |
| LCD I2C (ESP32) · SDA | GPIO21 | 🟢 verde |
| LCD I2C (ESP32) · SCL | GPIO22 | 🟠 naranja |
| LCD Keypad Shield (UNO) | apilado sobre pines digitales | ⚪ blanco |

> **POR QUÉ DOS BUSES Y NO UNO "de 5V/3V3".** Poner "5V/3V3" y no decidir es dejar el problema para el alumno, que después cuelga todo del mismo riel. Acá los dos módulos piden cosas distintas:
>
> - **LCD 1602 con mochila I²C → 5 V.** El HD44780 del display necesita 5 V para el contraste del cristal: **mínimo 4,5 V** (`electrica.ts` → `TecniaLab:Modulo_LCD_I2C`). La mochila PCF8574 tolera menos, **el display no** — a 3,3 V ves la retroiluminación encendida y la pantalla en blanco, y el alumno se pasa la clase escaneando direcciones I²C.
> - **DHT11 → 3,3 V en ESP32.** Se alimenta de **3 a 5,5 V** (`electrica.ts` → `TecniaLab:Modulo_DHT_3P`), así que a 3,3 V trabaja perfecto. Y conviene que esté ahí: su línea DATA es un solo hilo con **pull-up de 4,7 kΩ en la propia plaqueta**, o sea que la línea se va a la tensión de VCC. Con el DHT11 en el bus de 5 V, ese pull-up levanta el GPIO 4 a 5 V — 1,7 V por encima de lo que la placa admite. Con el módulo en 3,3 V el problema desaparece solo.
>
> Los dos buses **no se unen nunca entre sí**; el **GND es uno solo y común**. En UNO nada de esto aplica: hay un único riel de 5 V y todo va ahí.
>
> ⚠️ **Lo que queda pendiente y hay que mirar con el módulo en la mano (ESP32):** la mochila I²C alimentada a 5 V tiene **sus pull-ups de SDA/SCL contra 5 V**, así que el bus reposa en 5 V y eso toca los GPIO 21/22. `electrica.ts` declara que los pull-ups están en la mochila, pero **no declara su valor ni contra qué tensión quedan** en cada plaqueta concreta, así que esta ficha no puede afirmar que sea seguro. Lo honesto: **medí SDA y SCL con el téster** (en reposo, con el LCD alimentado y el ESP32 apagado). Si marcan ~5 V, poné un **conversor de nivel bidireccional I²C** entre la mochila y la placa, o usá una mochila con los pull-ups del lado de 3,3 V. No inventes una respuesta: medí.

## Código clave
- Umbral del original: por encima de **25 °C** hay que ventilar.
- LED **parpadea** en el nivel inicial (medio segundo encendido / medio apagado) — más llamativo que fijo. En el nivel avanzado pasa a **encendido fijo** mientras dure la alerta (apagado = todo en orden).
- Librería **"DHT sensor library" de Adafruit** (no la vieja "DHT.h" genérica, discontinuada), requiere `dht.begin()` en `setup()`.
- Frecuencia de lectura del DHT11: cada **2 segundos** (el sensor físicamente no admite más de 1 lectura/segundo, y la librería de Adafruit cachea 2 s — el original pedía 1 s, que era optimista).
- Pin 13 en UNO: coincide con el LED integrado de la placa, útil para probar sin LED externo.
- Archivos: `ventilacion-por-temperatura.ino`, `temp-humedad-lcd.ino`, `invernadero-no-bloqueante.ino`, `invernadero-iot.ino`.

## Gotchas del proyecto ⚠️
- **El LCD NO admite tildes ni Ñ**: es una limitación física del display de caracteres, no del código. Los textos que se muestran deben escribirse sin acentos.
- **DHT11 no da más de una lectura por segundo**: medir cada 2 s es el margen honesto; medir más rápido no sirve porque la librería cachea igual.
- **UNO usa LCD paralelo (shield apilado), ESP32 usa LCD I2C**: son librerías distintas (`LiquidCrystal` vs `LiquidCrystal_I2C`) y cableado distinto (6 pines vs 2 cables SDA/SCL). No mezclar el código de una plataforma con el hardware de la otra.
- **MITO: "`LiquidCrystal` ya viene con el IDE".** En el IDE de Arduino sí; **en PlatformIO NO**, y esta ficha lo decía mal. Si el `platformio.ini` no la declara, la compilación corta con `fatal error: LiquidCrystal.h: No such file or directory` — que no es un problema de la placa ni del cableado, es una librería que falta declarar. Está verificado compilando (`pio run`, UNO y ESP32) en la skill `librerias`, que lo lista explícitamente entre los mitos junto con `Stepper.h` y `Servo.h`. Las líneas exactas: `arduino-libraries/LiquidCrystal` para el LCD paralelo del UNO, `marcoschwartz/LiquidCrystal_I2C` para el LCD I²C del ESP32. Y el DHT11 lleva dos: `adafruit/DHT sensor library` + `adafruit/Adafruit Unified Sensor`.
- **EN ESP32 SON DOS BUSES +, NO UNO**: LCD I²C al de 5 V (VIN), DHT11 al de 3,3 V. Un solo bus "5V/3V3" no puede ser las dos cosas: a 3,3 V el LCD queda en blanco (el HD44780 pide 4,5 V mínimo para el contraste), y a 5 V el pull-up interno del DHT11 levanta el GPIO 4 a 5 V. En UNO no existe el dilema: es todo 5 V.
- **Pin 13 en UNO coincide con el LED integrado**: sirve para verificar el aviso sin tener el LED externo conectado todavía.

## Cómo ayudar al alumno
- Si el LCD muestra caracteres raros donde debería haber una tilde: recordar la limitación de tildes/Ñ del display, no es un bug de código.
- Si el DHT11 da lecturas erráticas o `nan`: revisar que no se esté leyendo más rápido que cada 2 segundos, y que el cableado de DATA esté firme (el DHT11 es sensible a cables flojos).
- Si el LED no avisa: comparar el umbral de 25 °C con la temperatura ambiente real del aula — puede que simplemente no se haya cruzado el umbral.
- Si el LCD I2C no muestra nada: antes de salir a escanear direcciones, **mirá de dónde sale su VCC**. Si está en el bus de 3,3 V, el display no tiene contraste y va a estar en blanco por más que la dirección sea correcta — pasalo al bus de 5 V (VIN). Recién después revisar la dirección (0x27 o 0x3F) y que SDA/SCL no estén invertidos.
- Si la compilación corta con `fatal error: LiquidCrystal.h: No such file or directory`: no es la placa ni el cable — falta declarar la librería en `lib_deps` del `platformio.ini`. Es el mito de que "viene con el IDE": con el IDE de Arduino sí, con PlatformIO no.
