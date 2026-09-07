# Educablocks: bloque → C++ generado → cómo lo escribimos en Tecnia Bot

Complemento del skill `educabot`. Las plantillas salen del generador de código abierto de Educabot (`educablocks-offline`, archivo `educablocks.js`); las etiquetas son las que el alumno ve en castellano en Educablocks/Robots. Donde dice "pin", el número es **el del puerto RJ12** donde está enchufado el módulo (salvo los puertos dobles 3 → 3+2 y 6 → 6+7).

Todo esto compila en PlatformIO con `board = uno` sin cambios, salvo lo marcado con ⚠ (librerías que no están en el registro).

## Categorías y bloques (como los ve el alumno)

| Categoría | Bloques |
|---|---|
| Control | setup/loop, si, si/sino, repetir, mientras, para, esperar (`delay`), `millis` |
| Lógica / Matemáticas / Texto / Variables / Funciones | comparaciones, aritmética, `map`, `random`, texto, variables globales/locales, funciones con y sin retorno |
| Entradas | Botón, Luz, Potenciómetro, Suelo, Sonido, Pir, Óptico, Ultrasonidos, DHT11, Temperatura, Humedad, Seguidor de líneas |
| Salidas | Led, Led RGB, Relé (invertido), Zumbador, Motor DC |
| Motores | Servo 180, Servo 360 |
| Pantallas | LCD (2x16) paralelo, LCD I2C, LCD: Imprimir, LCD borrar, retroiluminación, Matriz 8x8 y «caritas» |
| Comunicación | Serial (imprimir, leer, `parseInt`, `readString`), Bluetooth (definir, enviar, recibir), Escaner I2C, Arest, Panel BLE |
| Funciones pin | leer/escribir digital, leer/escribir analógico, LED integrado |

## Tabla de equivalencias

| Bloque (etiqueta) | Parámetros | C++ que genera Educablocks | En Tecnia Bot (`board = uno`) |
|---|---|---|---|
| **Led** — Encender/Apagar | Pin | setup: `pinMode(pin, OUTPUT);` · loop: `digitalWrite(pin, HIGH/LOW);` | Igual. Nombrá el pin: `const int PIN_LED = 5;` |
| **LED integrado** | estado | `pinMode(LED_BUILTIN, OUTPUT); digitalWrite(LED_BUILTIN, …);` | Igual. En el UNO `LED_BUILTIN` es el 13 (comparte el puerto 13) |
| **Botón** | Pin | setup: `pinMode(pin, …);` · `digitalRead(pin)` | Igual. Probá con `Serial.println(digitalRead(pin))` qué da en reposo antes de decidir si es HIGH o LOW al apretar |
| **Luz / Potenciómetro / Suelo / Sonido** | Pin (A0-A5) | `analogRead(An)` | Igual; 0-1023 |
| **Pir / Óptico** | Pin | `pinMode(pin, INPUT)` + `digitalRead(pin)` | Igual |
| **Ultrasonidos** | puerto 3 o 6 | define `u_tiempo()` (pulsos de 2 µs y 10 µs, `pulseIn(echo, HIGH)`) y `u_distancia()` (`/29/2`, 0 → 999); llama `u_distancia(3, 2)` o `u_distancia(6, 7)` | HC-SR04 de `sensores` con `TRIG=3, ECHO=2` o `TRIG=6, ECHO=7`. Sin divisor (5V) |
| **DHT11** + **Temperatura** / **Humedad** | Pin | ⚠ `#include <dht11.h>` · `dht11 DHT11;` · `#define DHT11PIN pin` · `DHT11.read(DHT11PIN);` · `DHT11.temperature` / `DHT11.humidity` | `#include <DHT.h>` · `DHT dht(pin, DHT11); dht.begin();` · `dht.readTemperature()` / `dht.readHumidity()` · `lib_deps = adafruit/DHT sensor library`, `adafruit/Adafruit Unified Sensor` (skill `librerias`) |
| **Seguidor de líneas** — Izquierda/Derecha | Pin izquierda, Pin derecha | setup: dos `pinMode(…, INPUT)` · `if (digitalRead(pin) …)` | Dos `digitalRead`; ver robots en `proyectos-inet` |
| **Relé (invertido)** — Encender/Apagar | Pin | `pinMode(pin, OUTPUT);` · `digitalWrite(pin, LOW/HIGH)` con las etiquetas cruzadas (activo-bajo) | `actuadores` › Relé; `LOW` activa |
| **Zumbador** — Tono DO…SI, Duración | Pin | `tone(pin, frecuencia, duracion);` | Igual (`tone()` es del core). Ficha 15 «El zumbador» en `fichas` |
| **Led RGB** — Color, Duración | Pin rojo/verde/azul | `void color(int R, int G, int B) { analogWrite(pinR, R); … }` · `color(255, 0, 0); delay(ms);` | `modulos-avanzados` › LED RGB (tres pines PWM: 3/5/6/9/10/11) |
| **Motor DC** — ON/OFF | puerto 3 o 6 (Positivo/Negativo) | `pinMode(3, OUTPUT); pinMode(2, OUTPUT);` · `digitalWrite(3, HIGH); digitalWrite(2, LOW);` | Puente H de dos entradas (`actuadores` › L298N); velocidad con `analogWrite` en el pin PWM (3 o 6) |
| **Servo 180** — Grados, Pausa | Pin | `#include <Servo.h>` · `Servo servos[13];` · `servos[pin].attach(pin);` · `servos[pin].write(grados); delay(ms);` | `Servo servo; servo.attach(pin); servo.write(grados);` · `lib_deps = arduino-libraries/Servo` |
| **Servo 360** — Horario/Antihorario/Detener | Pin | mismo arreglo `servos[]`; `write(0)` / `write(180)` / `write(90)` para girar o frenar (servo de rotación continua) | Igual; explicá que en un servo 360 `write` fija velocidad y sentido, no ángulo |
| **LCD I2C** — Dirección I2C | 0x27 / 0x3F | `#include <Wire.h>` · `#include <LiquidCrystal_I2C.h>` · `LiquidCrystal_I2C lcd(0x27, 16, 2);` · `lcd.init(); lcd.backlight();` | Igual; `lib_deps = marcoschwartz/LiquidCrystal_I2C`. Puerto IIC |
| **LCD (2x16)** paralelo — Pines del LCD | 6 pines | `#include <LiquidCrystal.h>` · `LiquidCrystal lcd(rs, en, d4, d5, d6, d7);` · `lcd.begin(16, 2);` | `lib_deps = arduino-libraries/LiquidCrystal`. Poco usual en Educabot (ocupa 6 puertos) |
| **LCD: Imprimir** (¿Fijar posición?) / **LCD borrar** / **retroiluminación** | Columna, Fila | `lcd.setCursor(col, fila); lcd.print(…);` · `lcd.clear();` · `lcd.setBacklight(…)` | Igual |
| **Matriz 8x8** — imprimir, «caritas» | — | ⚠ `#include "LedControlMS.h"` · `#define Matrices 1` · `matriz.shutdown(i,false); matriz.setIntensity(i,8); matriz.clearDisplay(i);` · `matriz.writeString(0, "…")` · `caritas(0/1/2)` dibuja feliz/sorprendido/enojado con `setRow` | Driver MAX7219 (DIN/CLK/CS). En PlatformIO usá `wayoda/LedControl` (`LedControl.h`, misma API `setRow`/`setIntensity`; `writeString` es propio de la versión de Educabot). **El puerto del módulo de matriz no está confirmado** |
| **Serial: imprimir / leer** | Tasa de baudios | `Serial.begin(9600);` · `Serial.print(…)` / `Serial.println(…)` / `Serial.read()` / `Serial.parseInt()` / `Serial.readString()` · `if (Serial.available() > 0) {` | Igual; monitor a 9600 (`comunicacion-serial`) |
| **Bluetooth** (definir) — RX, TX, Nombre, PIN, baudios | dos pines | `#include <SoftwareSerial.h>` · `SoftwareSerial blueToothSerial(RX, TX);` · setup: `pinMode(RX, INPUT); pinMode(TX, OUTPUT); blueToothSerial.begin(baudios);` | Igual en UNO (`SoftwareSerial.h` viene con el core AVR). Si el módulo va en **COM** (D0/D1) usá `Serial` directo y desenchufalo para cargar |
| **Bluetooth: Enviar / recibir / Puerto Serie Disponible** | — | `blueToothSerial.write(…)` · `blueToothSerial.read()` · `if (blueToothSerial.available() > 0) {` | Igual |
| **Escaner I2C** | — | `Wire.begin(); Serial.begin(9600);` y en loop recorre `address` 1..126 con `Wire.beginTransmission/endTransmission`, imprime «Dispositivo I2C encontrado en la direccion 0x..» | Igual; sirve para saber si el LCD es 0x27 o 0x3F |
| **Funciones pin** — leer/escribir digital y analógico | Pin, valor | `pinMode(pin, INPUT/OUTPUT);` · `digitalRead(pin)` / `digitalWrite(pin, v)` / `analogRead(pin)` / `analogWrite(pin, 0-255)` | Igual. `analogWrite` sólo en 3, 5, 6, 9, 10, 11 |
| **Arest** (ID, NOMBRE) | — | `#include <SPI.h>` · `#include <aREST.h>` · `#include <avr/wdt.h>` · `aREST rest = aREST();` · `Serial.begin(115200); rest.set_id(…)` · loop: `rest.handle(Serial); wdt_reset();` | Control por serie con la librería aREST (`marcoschwartz/aREST`). Ojo: este bloque pone el serial a **115200**, no 9600 |
| **Panel BLE / Sensores Genuino 101 / Eje sensores 101** | — | `CurieBLE.h`, `CurieIMU.h` | **No aplica a la Educablocks UNO**: son bloques para la Arduino/Genuino 101 (Intel Curie). Si aparecen, decilo |

## Cómo usar esta tabla en el aula

1. El alumno arma el programa en bloques y aprieta **«dos llaves» `{ }`** para ver el código.
2. Pegan ese código en Tecnia Bot. Buscá acá el bloque y explicá la línea correspondiente (qué hace `pinMode`, por qué `pulseIn`, qué es `servos[9]`).
3. Para compilarlo en PlatformIO: `platformio.ini` con `board = uno`, `monitor_speed = 9600` y las `lib_deps` de la columna derecha (skill `librerias`). Reemplazá `dht11.h` y `LedControlMS.h`, que no están en el registro.
4. El pin que aparece en el código **es el puerto RJ12** donde va enchufado el módulo; los pines 2 y 7 que aparecen "de la nada" son la segunda señal de los puertos 3 y 6.
