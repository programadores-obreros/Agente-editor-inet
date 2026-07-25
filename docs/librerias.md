# Librerías y `lib_deps` 📚

Esta es la **referencia de librerías** del ecosistema Tecnia Bot: qué `lib_deps`
necesita cada componente en su `platformio.ini`, para Arduino UNO (AVR) y para ESP32.

> **Lo primero, y sin vueltas:** PlatformIO **NO trae estas librerías solas.** Si
> escribís `#include <Servo.h>` sin agregar la librería en `lib_deps`, la compilación
> corta con:
>
> ```
> src/main.cpp: fatal error: Servo.h: No such file or directory
> ```
>
> No es un bug ni un problema de tu placa: es que **falta declarar la librería**. Esta
> página te da la línea exacta para cada componente, así el `platformio.ini` queda bien
> a la primera y ningún docente choca con ese error.

Los nombres de paquete son los del **registro oficial** de PlatformIO
([registry.platformio.org](https://registry.platformio.org)). El formato es
`owner/Nombre` (por ejemplo `adafruit/Adafruit SSD1306`).

---

## Vienen incluidas (core / bundled) — NO llevan `lib_deps`

Estas ya vienen con el framework. Agregarlas a `lib_deps` no hace falta (y puede
hasta molestar). Salen directo con su `#include`:

| Header | Para qué | Arduino UNO (AVR) | ESP32 |
| --- | --- | :---: | :---: |
| `Wire.h` | Bus I2C | ✅ bundled | ✅ bundled |
| `SPI.h` | Bus SPI | ✅ bundled | ✅ bundled |
| `EEPROM.h` | Memoria EEPROM | ✅ bundled | ✅ bundled |
| `SoftwareSerial.h` | Serial por software | ✅ bundled | ❌ no existe en ESP32 |
| `WiFi.h` | WiFi | ❌ no aplica | ✅ bundled |

> **Ojo con un mito común:** `LiquidCrystal.h` (LCD paralelo HD44780) **NO viene
> bundled** en PlatformIO — ni en AVR ni en ESP32. Lo verificamos mirando las librerías
> que traen los frameworks instalados (`framework-arduino-avr` trae solo EEPROM, HID,
> SoftwareSerial, SPI y Wire). Si usás LCD paralelo, necesitás su `lib_deps` (ver abajo).
> Lo mismo pasa con `Stepper.h` y con `Servo.h`.

---

## Necesitan `lib_deps`

La columna **`lib_deps` (línea exacta)** es lo que va, tal cual, dentro de `lib_deps =`
en tu `platformio.ini`.

### Actuadores

| Componente | Header | `lib_deps` (línea exacta) | Placas | Nota |
| --- | --- | --- | --- | --- |
| Servo (SG90…) | `Servo.h` | `arduino-libraries/Servo` | **solo UNO / AVR** | En ESP32 se usa otra (ver fila siguiente) |
| Servo en ESP32 | `ESP32Servo.h` | `madhephaestus/ESP32Servo` | **solo ESP32** | Reemplaza a `Servo.h`; misma clase `Servo` |
| Motor paso a paso | `Stepper.h` | `arduino-libraries/Stepper` | UNO y ESP32 | **NO viene bundled** (contra lo que muchos creen) |
| Tira LED WS2812 | `Adafruit_NeoPixel.h` | `adafruit/Adafruit NeoPixel` | UNO y ESP32 | Tiras largas → fuente externa de 5V |

### Sensores

| Componente | Header | `lib_deps` (línea exacta) | Placas | Nota |
| --- | --- | --- | --- | --- |
| DHT11 / DHT22 | `DHT.h` | `adafruit/DHT sensor library` | UNO y ESP32 | Depende de `adafruit/Adafruit Unified Sensor` (agregalo también) |
| Presión BMP085 / BMP180 | `Adafruit_BMP085.h` | `adafruit/Adafruit BMP085 Library` | UNO y ESP32 | La misma lib sirve para el BMP180 |
| Acelerómetro + giroscopio | `Adafruit_MPU6050.h` | `adafruit/Adafruit MPU6050` | UNO y ESP32 | Arrastra `Adafruit Unified Sensor` + `Adafruit BusIO` |
| Base de sensores | `Adafruit_Sensor.h` | `adafruit/Adafruit Unified Sensor` | UNO y ESP32 | Dependencia común de las libs Adafruit |

### Displays y entrada

| Componente | Header | `lib_deps` (línea exacta) | Placas | Nota |
| --- | --- | --- | --- | --- |
| OLED SSD1306 | `Adafruit_SSD1306.h` + `Adafruit_GFX.h` | `adafruit/Adafruit SSD1306` | UNO y ESP32 | Arrastra `Adafruit GFX Library` + `Adafruit BusIO` |
| Primitivas gráficas | `Adafruit_GFX.h` | `adafruit/Adafruit GFX Library` | UNO y ESP32 | Base de los displays gráficos |
| Abstracción I2C/SPI | (interno) | `adafruit/Adafruit BusIO` | UNO y ESP32 | Dependencia de SSD1306 y MPU6050 |
| LCD paralelo 16x2 (HD44780) | `LiquidCrystal.h` | `arduino-libraries/LiquidCrystal` | UNO y ESP32 | **NO viene bundled** (para LCD por I2C se usa otra lib) |
| Teclado matricial 4x4 | `Keypad.h` | `chris--a/Keypad` | UNO y ESP32 | El owner es `chris--a` (con **doble guion**) |

> **Sobre las dependencias que "arrastran":** cuando una lib depende de otra (por
> ejemplo SSD1306 necesita GFX y BusIO), PlatformIO suele bajarlas solas. Aun así, la
> recomendación es **listarlas explícitas** en `lib_deps`: es más claro y evita sorpresas
> si una versión cambia sus dependencias.

---

## Cómo se ve un `platformio.ini` con varias librerías

`lib_deps` acepta **una librería por línea** (indentada). Ejemplo para un ESP32 que usa
servo, DHT22 y OLED:

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
lib_deps =
    madhephaestus/ESP32Servo         ; servo en ESP32
    adafruit/DHT sensor library      ; sensor DHT22
    adafruit/Adafruit Unified Sensor ; dependencia del DHT
    adafruit/Adafruit SSD1306        ; OLED (arrastra GFX + BusIO)
    adafruit/Adafruit GFX Library    ; primitivas graficas
```

El mismo proyecto para un **Arduino UNO** solo cambia la plataforma, la placa, los
baudios y la librería del servo (`arduino-libraries/Servo` en vez de `ESP32Servo`):

```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino
monitor_speed = 9600
lib_deps =
    arduino-libraries/Servo          ; servo en AVR
    adafruit/DHT sensor library
    adafruit/Adafruit Unified Sensor
    adafruit/Adafruit SSD1306
    adafruit/Adafruit GFX Library
```

> **Tip:** podés fijar una versión con `@`, por ejemplo
> `adafruit/DHT sensor library@^1.4.4`. Si no ponés versión, PlatformIO usa la última
> compatible.

---

## Proyecto de verificación

En [`ejemplos/_test-librerias/`](../ejemplos/_test-librerias) hay un proyecto interno
(con **dos** environments, `uno` y `esp32dev`) que incluye **todas** estas librerías y
compila con un `pio run`. Sirve para verificar que cada `lib_deps` resuelve — no es un
ejemplo para docentes.

---

📟 ¿Y cómo ves lo que manda la placa una vez cargado el sketch? Eso está en el doc
hermano: [**Monitor serial**](monitor-serial.md).
