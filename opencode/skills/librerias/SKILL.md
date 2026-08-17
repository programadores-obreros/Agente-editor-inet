---
name: librerias
description: Qué librería (lib_deps) necesita cada componente en PlatformIO, para Arduino UNO (AVR) y ESP32. PlatformIO NO incluye la mayoría de las librerías solas — si el sketch usa Servo, DHT, LCD, OLED, teclado matricial, motor paso a paso, NeoPixel, MPU6050, BMP085, etc., hay que declararla en lib_deps del platformio.ini o la compilacion corta con "fatal error: X.h: No such file or directory". Da la linea EXACTA de lib_deps por componente, y aclara que SI viene incluido (Wire, SPI, EEPROM, y WiFi en ESP32). Tambien explica como PlatformIO resuelve las librerias (busca LOCAL primero -cache global ~/.platformio-, y si falta la baja del registro OFICIAL registry.platformio.org, quedando cacheada para andar offline) y que hay que usar siempre nombres del registro oficial, nunca URLs random. Usar SIEMPRE que se genera o corrige un platformio.ini, o cuando preguntan como/de donde se bajan las librerias.
---

# Librerías y lib_deps en PlatformIO

**Regla de oro:** PlatformIO **no trae la mayoria de las librerias solas**. Si un sketch hace `#include <Servo.h>` y el `platformio.ini` no la declara en `lib_deps`, la compilacion corta con:

```
src/main.cpp: fatal error: Servo.h: No such file or directory
```

No es un bug ni un problema de la placa: **falta declarar la libreria**. Cuando generes o corrijas un `platformio.ini`, agregá el `lib_deps` que corresponda segun esta tabla.

> Verificado compilando (`pio run`, UNO y ESP32): todos los nombres de paquete de abajo resuelven e instalan bien.

---

## Vienen INCLUIDAS (NO llevan lib_deps)

Salen directo con su `#include`, sin agregar nada:

| Header | UNO (AVR) | ESP32 |
| --- | :---: | :---: |
| `Wire.h` (I2C) | ✅ | ✅ |
| `SPI.h` | ✅ | ✅ |
| `EEPROM.h` | ✅ | ✅ |
| `SoftwareSerial.h` | ✅ | ❌ (no existe en ESP32) |
| `WiFi.h` | ❌ (no aplica) | ✅ |

**Mitos a evitar:** `LiquidCrystal.h`, `Stepper.h` y `Servo.h` **NO vienen incluidas** (aunque muchos lo creen). Necesitan lib_deps.

---

## NECESITAN lib_deps (la linea va tal cual dentro de `lib_deps =`)

| Componente | Header | lib_deps | Placas |
| --- | --- | --- | --- |
| Servo (SG90) | `Servo.h` | `arduino-libraries/Servo` | **solo UNO/AVR** |
| Servo en ESP32 | `ESP32Servo.h` | `madhephaestus/ESP32Servo` | **solo ESP32** |
| Motor paso a paso | `Stepper.h` | `arduino-libraries/Stepper` | UNO y ESP32 |
| Tira LED WS2812 | `Adafruit_NeoPixel.h` | `adafruit/Adafruit NeoPixel` | UNO y ESP32 |
| DHT11 / DHT22 | `DHT.h` | `adafruit/DHT sensor library` + `adafruit/Adafruit Unified Sensor` | UNO y ESP32 |
| Presion BMP085/BMP180 | `Adafruit_BMP085.h` | `adafruit/Adafruit BMP085 Library` | UNO y ESP32 |
| Acelerometro/giroscopio | `Adafruit_MPU6050.h` | `adafruit/Adafruit MPU6050` (arrastra Unified Sensor + BusIO) | UNO y ESP32 |
| Base de sensores | `Adafruit_Sensor.h` | `adafruit/Adafruit Unified Sensor` | UNO y ESP32 |
| OLED SSD1306 | `Adafruit_SSD1306.h` + `Adafruit_GFX.h` | `adafruit/Adafruit SSD1306` (arrastra GFX + BusIO) | UNO y ESP32 |
| Primitivas graficas | `Adafruit_GFX.h` | `adafruit/Adafruit GFX Library` | UNO y ESP32 |
| LCD paralelo 16x2 (HD44780) | `LiquidCrystal.h` | `arduino-libraries/LiquidCrystal` | UNO y ESP32 |
| LCD 16x2 por modulo I2C | `LiquidCrystal_I2C.h` | `marcoschwartz/LiquidCrystal_I2C` | UNO y ESP32 (comun en ESP32, ahorra pines; dir 0x27 o 0x3F) |
| Teclado matricial 4x4 | `Keypad.h` | `chris--a/Keypad` (owner con **doble guion**) | UNO y ESP32 |
| IoT — Adafruit IO por MQTT ⚠ | `Adafruit_MQTT.h` + `Adafruit_MQTT_Client.h` | `adafruit/Adafruit MQTT Library` | **solo ESP32** (el UNO no tiene WiFi) |

> ⚠ **La fila de MQTT es la única que NO está verificada compilando**, a
> diferencia del resto de esta tabla. Está puesta igual porque **trece de los
> quince proyectos** tienen nivel IoT y ninguno decía qué librería hace falta.
>
> Sin esta línea el camino era: el alumno compila → `fatal error:
> Adafruit_MQTT.h: No such file or directory` → el bot lo manda a esta tabla →
> acá no hay nada. Un callejón sin salida, con el agravante de que esta misma
> skill le dice al bot que NO mande a bajar librerías a mano.
>
> Si al compilarla el nombre del paquete resulta ser otro, **corregí la fila y
> sacale el ⚠** — pero no la borres, porque el agujero vuelve.

> Cuando una lib depende de otra (ej: SSD1306 necesita GFX y BusIO), PlatformIO suele bajarlas sola, pero conviene **listarlas explicitas** en lib_deps por claridad.

---

## Cómo se escribe en el platformio.ini

Una libreria por linea, indentada. Ejemplo ESP32 con servo + DHT22 + OLED:

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
lib_deps =
    madhephaestus/ESP32Servo
    adafruit/DHT sensor library
    adafruit/Adafruit Unified Sensor
    adafruit/Adafruit SSD1306
    adafruit/Adafruit GFX Library
```

Para UNO: cambiar `platform = atmelavr`, `board = uno`, `monitor_speed = 9600`, y usar `arduino-libraries/Servo` en vez de `ESP32Servo`.

Se puede fijar version con `@`, ej: `adafruit/DHT sensor library@^1.4.4`.

---

## Cómo se resuelven las librerías (local primero, después el registro oficial)

Cuando se compila (`pio run`), PlatformIO busca cada libreria de `lib_deps` en este orden:

1. **Local primero**: la carpeta `lib/` del proyecto, lo ya instalado en `.pio/libdeps/`, y la **cache global** (`~/.platformio/`).
2. **Si no esta local → la baja del registro OFICIAL** de PlatformIO (registry.platformio.org). No de sitios random.
3. Una vez bajada, queda **cacheada** en `~/.platformio/` → los proximos proyectos la usan **sin volver a descargar** (anda **offline** despues de la primera vez).

**Reglas para el bot (importantes):**

- Usar SIEMPRE nombres del **registro oficial** (`owner/nombre`, ej: `adafruit/DHT sensor library`). NUNCA URLs sueltas, ZIPs de foros, ni pegar el codigo de una libreria a mano.
- **No hace falta instalar librerias aparte**: alcanza con declararlas en `lib_deps`; PlatformIO las busca local y, si faltan, las baja solo del registro oficial.
- Si el docente esta **sin internet** y la libreria todavia no esta cacheada, avisarle que la **primera vez** necesita conexion para bajarla; despues ya queda local y anda offline.
- Cuando ayudes con un error tipo "X.h: No such file", primero revisá que este el `lib_deps` correcto (esta tabla), no mandes a bajar nada a mano.

---

La referencia completa para humanos esta en `docs/librerias.md`. Para el cableado de cada componente ver los skills `sensores`, `actuadores`, `modulos-avanzados`; para el monitor serial, `comunicacion-serial`.
