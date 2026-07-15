# Proyecto 04 — Invernadero
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
- Librería LiquidCrystal (ya viene con el IDE, para UNO) o LiquidCrystal_I2C (para ESP32)

## Pinout (exacto — de PINES_INVERNADERO)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| DHT11 · dato | pin 2 | GPIO 4 |
| LED de ventilación | pin 13 | GPIO 16 |
| LCD | paralelo: RS 8, E 9, D4-D7 4/5/6/7 (shield) | I2C: SDA GPIO21 / SCL GPIO22 |

## Cableado (de la tabla de conexionado)
| Desde | Hacia | Color |
|---|---|---|
| Placa · 5V/3V3 | Bus + protoboard | 🔴 rojo |
| Placa · GND | Bus − protoboard | ⚫ negro |
| DHT11 · VCC/GND | Bus + / Bus − | 🔴⚫ |
| DHT11 · DATA | placa · pin 2/GPIO4 | 🟡 amarillo |
| LED ventilación · ánodo | placa · pin 13/GPIO16 | 🔵 azul |
| LED ventilación · cátodo | Resistencia 220 Ω → Bus − | ⚫ negro |
| LCD I2C (ESP32) · SDA | GPIO21 | 🟢 verde |
| LCD I2C (ESP32) · SCL | GPIO22 | 🟠 naranja |
| LCD Keypad Shield (UNO) | apilado sobre pines digitales | ⚪ blanco |

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
- **Pin 13 en UNO coincide con el LED integrado**: sirve para verificar el aviso sin tener el LED externo conectado todavía.

## Cómo ayudar al alumno
- Si el LCD muestra caracteres raros donde debería haber una tilde: recordar la limitación de tildes/Ñ del display, no es un bug de código.
- Si el DHT11 da lecturas erráticas o `nan`: revisar que no se esté leyendo más rápido que cada 2 segundos, y que el cableado de DATA esté firme (el DHT11 es sensible a cables flojos).
- Si el LED no avisa: comparar el umbral de 25 °C con la temperatura ambiente real del aula — puede que simplemente no se haya cruzado el umbral.
- Si el LCD I2C no muestra nada: revisar la dirección I2C del módulo (suele ser 0x27 o 0x3F) y que SDA/SCL no estén invertidos.
