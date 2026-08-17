# Proyecto 05 — Estación meteorológica

🔗 **Verlo en vivo (animación + simulador interactivo):** https://tecnialab.net.ar/proyectos/05-estacion-meteorologica/
> El alumno arma una estación que solo mide y muestra el clima (temperatura, humedad, lluvia y presión) en un display, y en el nivel avanzado la monitorea por IoT.

## De qué se trata
A diferencia de otros proyectos (riego, invernadero), esta estación **no acciona nada**: solo mide y muestra. Con DHT11 (temperatura + humedad) y un sensor de lluvia se arma el nivel inicial; se suma el BMP180 (presión atmosférica) en el intermedio; y se publica todo por IoT en el avanzado. Es una buena oportunidad para comparar tres formas distintas de "hablar" con la placa: un sensor digital de un cable (DHT11), uno digital de umbral (lluvia) y uno por bus I2C (BMP180).

## Los niveles
- **Inicial — Medir temperatura, humedad y lluvia en un display LCD**: DHT11 + sensor de lluvia (salida digital, no analógica), mostrados en el LCD (línea 1: temp/humedad, línea 2: "Lluvia: SI/NO").
- **Intermedio — Agregar la presión atmosférica con un sensor BMP180**: se suma el BMP180 por I2C, que en el ESP32 comparte bus con el LCD (cada uno con su dirección).
- **Avanzado — Monitorear la estación con IoT**: código no bloqueante con `millis()`, publicación por WiFi/MQTT solo cuando cambian los valores de forma apreciable.

## Materiales
- Arduino UNO o ESP32 DevKit v1
- Sensor DHT11
- Sensor de lluvia (módulo colector + comparador, tipo YL-83) — se usa su salida DIGITAL (DO), no la analógica (AO)
- Sensor de presión BMP180 (librería "Adafruit BMP085 Library", compatible)
- LCD Keypad Shield (UNO, paralelo) o LCD 1602 + módulo I2C (ESP32)

## Pinout (exacto — de PINES_ESTACION)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| DHT11 · dato | pin 2 | GPIO 4 |
| Sensor de lluvia · DO | pin 3 | GPIO 14 |
| LCD | paralelo (shield): RS 8, E 9, D4-D7 4/5/6/7 | I2C: SDA GPIO21 / SCL GPIO22 |
| BMP180 (I2C) | A4 (SDA) / A5 (SCL) | GPIO21 (SDA) / GPIO22 (SCL) — comparte bus con el LCD |

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
| **Sensor de lluvia · VCC** | UNO: Bus +5V — **ESP32: Bus +3V3** | 🔴 / 🟠 |
| Sensor de lluvia · GND | Bus − | ⚫ negro |
| Sensor de lluvia · DO | placa · pin 3/GPIO14 | 🟣 violeta |
| **BMP180 · VCC** | UNO: Bus +5V — **ESP32: Bus +3V3** | 🔴 / 🟠 |
| BMP180 · GND | Bus − | ⚫ negro |
| BMP180 · SDA | placa · A4/GPIO21 | 🟢 verde |
| BMP180 · SCL | placa · A5/GPIO22 | 🟠 naranja |
| **LCD I2C (ESP32) · VCC** | **Bus +5V** | 🔴 rojo |
| LCD I2C (ESP32) · GND | Bus − | ⚫ negro |
| LCD I2C (ESP32) · SDA/SCL | mismo bus que BMP180 | 🟢🟠 |
| LCD Keypad Shield (UNO) | apilado sobre pines digitales | ⚪ blanco |

> **POR QUÉ DOS BUSES Y NO UNO "de 5V/3V3".** Un riel sin decidir es un riel del que cuelga todo, y acá los cuatro módulos no piden lo mismo:
>
> - **LCD 1602 con mochila I²C → 5 V.** El HD44780 necesita 5 V para el contraste del cristal: **mínimo 4,5 V** (`electrica.ts` → `TecniaLab:Modulo_LCD_I2C`). La mochila PCF8574 tolera menos, el display no.
> - **DHT11 → 3,3 V en ESP32.** Se alimenta de **3 a 5,5 V** (`electrica.ts` → `TecniaLab:Modulo_DHT_3P`). Su DATA tiene **pull-up de 4,7 kΩ en la propia plaqueta**, así que la línea reposa en la tensión de VCC: a 5 V eso levanta el GPIO 4 a 5 V.
> - **Sensor de lluvia y BMP180 → 3,3 V en ESP32.** Los dos trabajan de **3,3 a 5 V** (`electrica.ts` → `TecniaLab:Modulo_Sensor_5P`, que cubre exactamente estas dos plaquetas). Y su salida —el DO del comparador LM393 del sensor de lluvia— **es de la tensión con la que lo alimentes**: a 5 V, cuando llueve, le mete 5 V al GPIO 14. En UNO el pin tolera 5 V; en ESP32, no.
>
> Los dos buses **no se unen nunca entre sí**; el **GND es uno solo y común**. En UNO no hay dilema: todo al mismo riel de 5 V.
>
> ⚠️ **EL PENDIENTE MÁS SERIO DE ESTA FICHA, y hay que resolverlo con los módulos en la mano (ESP32):** el LCD va a 5 V y el BMP180 a 3,3 V, **pero comparten el bus I²C**. Los pull-ups de SDA/SCL están **dentro de la mochila del LCD** (`electrica.ts` → `TecniaLab:Modulo_LCD_I2C`), así que alimentada a 5 V el bus entero reposa en 5 V — y de ese bus cuelgan los GPIO 21/22 **y el BMP180**. `electrica.ts` declara que los pull-ups existen y dónde están, pero **no declara su valor ni contra qué tensión quedan** en cada plaqueta concreta: esta ficha no puede afirmar que sea seguro. Lo honesto es **medir**: con el LCD alimentado y el ESP32 desconectado, medí SDA y SCL con el téster. Si marcan ~5 V, va un **conversor de nivel bidireccional I²C** entre la mochila y el resto del bus (el lado de 3,3 V queda con el ESP32 y el BMP180), o una mochila con los pull-ups del lado de 3,3 V. **No lo resuelvas a ojo**: acá hay dos componentes en riesgo, no uno.

## Código clave
- Sensor de lluvia: se usa la salida **DIGITAL (DO)**, no la analógica (AO) — el umbral de mojado/seco se calibra con el potenciómetro del propio módulo.
- DHT11: librería "DHT sensor library" de Adafruit + "Adafruit Unified Sensor", `dht.begin()` en `setup()`, lectura cada 2 s (no admite más de 1/s).
- BMP180: librería "Adafruit BMP085 Library" (BMP085 y BMP180 son compatibles); presión en **hectopascales (hPa)**.
- Nivel avanzado: publica solo cambios apreciables — temperatura ≥0,5 °C, humedad ≥1%, presión ≥1 hPa respecto de lo último publicado — y descarta lecturas fallidas del DHT11. Suma el feed "lluvia" (0/1) a los feeds "temperatura", "humedad" y "presion".
- Archivos: `estacion-basica.ino`, `estacion-con-presion.ino`, `estacion-no-bloqueante.ino`, `estacion-iot.ino`.

## Gotchas del proyecto ⚠️
- **DHT11 es digital de un pin, NO analógico**: no va a A0, va a un pin digital cualquiera.
- **Sensor de lluvia: usar DO (digital), no AO**: la reedición usa exclusivamente la salida digital.
- **LCD Keypad Shield es formato Arduino UNO**: NO se enchufa físicamente en un ESP32. El ESP32 usa un LCD 1602 con módulo I2C (2 cables en vez de 6 pines).
- **En ESP32, LCD y BMP180 comparten el mismo bus I2C** (SDA GPIO21/SCL GPIO22): cada dispositivo tiene su propia dirección I2C, no hay conflicto de direcciones, pero hay que cablear ambos al mismo par de pines. **Ojo con las tensiones**: el LCD va alimentado a 5 V (lo pide el HD44780) y el BMP180 a 3,3 V, y los pull-ups del bus están dentro de la mochila del LCD — ver la advertencia completa bajo la tabla de cableado, es el pendiente más serio de este proyecto.
- **EN ESP32 SON DOS BUSES +, NO UNO**: LCD al de 5 V (VIN); DHT11, sensor de lluvia y BMP180 al de 3,3 V. Un solo bus "5V/3V3" no puede ser las dos cosas — a 3,3 V el LCD queda en blanco, y a 5 V el DO del sensor de lluvia le manda 5 V al GPIO 14 y el pull-up del DHT11 levanta el GPIO 4 a 5 V. En UNO no existe el dilema: todo va al mismo riel de 5 V.
- **DHT11 no admite más de 1 lectura/segundo**: medir cada 2 s es el margen honesto.
- **Publicación por cambios, no por tiempo fijo**: evita superar el límite gratuito de Adafruit IO (30 pub/min).
- **LCD sin tildes ni Ñ** (limitación física del display, igual que en otros proyectos con LCD).

## Cómo ayudar al alumno
- Si el sensor de lluvia siempre marca "SI" o siempre "NO": recalibrar el potenciómetro del módulo (umbral de sensibilidad).
- Si el LCD del ESP32 no muestra nada junto con el BMP180: revisar dos cosas. Primero, **de dónde sale el VCC del LCD** — si está en el bus de 3,3 V no tiene contraste y va a estar en blanco por más que la dirección sea correcta. Segundo, que ambos estén en el mismo bus I2C (GPIO21/22) y no en pines separados.
- Si el sensor de lluvia en ESP32 marca "SI" siempre, o el GPIO 14 quedó raro después de una clase: mirá de dónde sale su VCC. Si está en el bus de 5 V, su DO le está entregando 5 V a un pin de 3,3. Va al bus de 3,3 V.
- Si el DHT11 da lecturas erráticas: revisar el intervalo de lectura (mínimo 2 s) y el cableado de DATA.
- Si el LCD Keypad Shield no encaja en la placa: es un error de plataforma — ese shield es solo para Arduino UNO, no para ESP32.
