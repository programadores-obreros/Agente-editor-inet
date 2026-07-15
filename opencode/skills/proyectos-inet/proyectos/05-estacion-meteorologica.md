# Proyecto 05 — Estación meteorológica
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
| Desde | Hacia | Color |
|---|---|---|
| Placa · 5V/3V3 | Bus + protoboard | 🔴 rojo |
| Placa · GND | Bus − protoboard | ⚫ negro |
| DHT11 · DATA | placa · pin 2/GPIO4 | 🟡 amarillo |
| Sensor de lluvia · DO | placa · pin 3/GPIO14 | 🟣 violeta |
| BMP180 · SDA | placa · A4/GPIO21 | 🟢 verde |
| BMP180 · SCL | placa · A5/GPIO22 | 🟠 naranja |
| LCD I2C (ESP32) · SDA/SCL | mismo bus que BMP180 | 🟢🟠 |
| LCD Keypad Shield (UNO) | apilado sobre pines digitales | ⚪ blanco |

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
- **En ESP32, LCD y BMP180 comparten el mismo bus I2C** (SDA GPIO21/SCL GPIO22): cada dispositivo tiene su propia dirección I2C, no hay conflicto, pero hay que cablear ambos al mismo par de pines.
- **DHT11 no admite más de 1 lectura/segundo**: medir cada 2 s es el margen honesto.
- **Publicación por cambios, no por tiempo fijo**: evita superar el límite gratuito de Adafruit IO (30 pub/min).
- **LCD sin tildes ni Ñ** (limitación física del display, igual que en otros proyectos con LCD).

## Cómo ayudar al alumno
- Si el sensor de lluvia siempre marca "SI" o siempre "NO": recalibrar el potenciómetro del módulo (umbral de sensibilidad).
- Si el LCD del ESP32 no muestra nada junto con el BMP180: revisar que ambos estén en el mismo bus I2C (GPIO21/22) y no en pines separados.
- Si el DHT11 da lecturas erráticas: revisar el intervalo de lectura (mínimo 2 s) y el cableado de DATA.
- Si el LCD Keypad Shield no encaja en la placa: es un error de plataforma — ese shield es solo para Arduino UNO, no para ESP32.
