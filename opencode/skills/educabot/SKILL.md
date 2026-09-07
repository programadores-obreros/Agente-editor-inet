---
name: educabot
description: Kits Educabot (Argentina) - placa Educablocks UNO (Arduino UNO compatible con 20 puertos RJ12 tipo teléfono, colores por pin), bloques de Educablocks/Robots y qué C++ generan, Kit Inventor, Robot Zonda, Codit. Cómo la reconoce y la programa Tecnia Bot con PlatformIO como `uno`, mapa de puertos, módulos y equivalencias con los skills sensores/actuadores. Frases típicas - "placa Educabot", "Educablocks", "conectores de teléfono", "cable RJ12", "Kit Inventor", "Zonda".
---

# Educabot — la Educablocks UNO y los bloques de Educablocks/Robots

Muchas escuelas técnicas tienen kits de **Educabot** (empresa argentina de tecnología educativa). El corazón del kit es la **Educablocks UNO**: un Arduino UNO con los pines sacados a **conectores RJ12** (los de teléfono fijo), así los alumnos enchufan módulos con cable en vez de armar protoboard. Este skill le da a Tecnia Bot lo que hace falta para reconocerla, programarla en C++ con PlatformIO y traducir lo que el docente ya sabe hacer con bloques.

> **Regla de oro:** la Educablocks UNO **es un Arduino UNO** (ATmega328P, lógica de **5V**). Todo lo del skill `arduino` aplica tal cual. Lo que cambia es el conector: cada puerto RJ12 lleva **un pin del UNO** (o dos, en los puertos 3 y 6). Lo que este skill NO tiene —el orden de los 6 hilos del RJ12— **no está documentado públicamente**: si el docente lo necesita, decilo y mandalo a medir con tester, nunca lo inventes.

---

## Qué es y cómo reconocerla

Serigrafía: **«EDUCABOT · Educablocks UNO»**. Tiene el ATmega328P en formato DIP (el chip grande con zócalo), el conector ICSP de 6 pines, botón de reset, **USB-B** (cuadrado, como el de impresora) y **jack DC** para alimentación. Alrededor, **20 conectores RJ12** rotulados con el pin que llevan:

- **Azules:** digitales 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13. Los que tienen **mitad amarilla** son los PWM del UNO: 3, 5, 6, 9, 10, 11.
- **Rosas:** analógicos A0 a A5.
- **Verde «COM»:** serie por hardware (D0/D1, el mismo canal que el USB).
- **Violeta «IIC»:** I2C (A4 = SDA, A5 = SCL, como en cualquier UNO).
- La serigrafía también dice **«D3-S1»**, **«D6-S3»** y **«D10-SPI»**: marcas de los puertos "especiales" (ver los puertos dobles más abajo).

La tienda de Educabot describe la placa así (cita textual del vendedor): *«puerto USB, alimentación hasta 24V, 20 puertos RJ12, 8 analógicos, 10 digitales, 1 IIC, 1 comunicación, 4 PWM»*. En la unidad fotografiada se cuentan **6 analógicos y 6 PWM**; la cantidad exacta **depende de la revisión** de la placa, así que confiá en lo que está serigrafiado en la que tenés adelante.

Si el docente dice "la placa con conectores de teléfono", "la del kit de robótica del colegio", "la que se programa con bloques en la web de Educabot", "Kit Inventor" o "Zonda": es esta.

**Alimentación:** por USB, por el jack DC o con el **portapilas del kit**, que se enchufa al conector de alimentación al lado del USB y trae llave de encendido. Los módulos reciben **5V y GND por el mismo cable RJ12**.

---

## Cómo la programa Tecnia Bot

Para PlatformIO es un UNO común. Educabot compila con Arduino IDE 1.8.5 para `arduino:avr:uno`, carga con `avrdude -patmega328p -carduino -b115200` y abre el monitor a **9600 baudios** (está en el código abierto de su editor offline). El equivalente exacto:

```ini
[env:uno]
platform = atmelavr          ; AVR, igual que un Arduino UNO
board = uno                  ; la Educablocks UNO ES un UNO (ATmega328P)
framework = arduino
monitor_speed = 9600         ; la velocidad que usa la plataforma Educablocks
```

- El código va en `src/main.cpp` con `#include <Arduino.h>` arriba (no `.ino`), como en el skill `arduino`.
- **Driver:** el chip USB-serie de la placa **no está confirmado**. Si al enchufarla no aparece ningún puerto, aplicá el flujo del CH340 que Tecnia Bot ya tiene (`/diagnostico`, skill `gotchas-hardware`): en la Educablocks UNO se comporta igual que en un clon de UNO.
- **Monitor:** `platformio` con `action: "monitor"` a 9600. Si el docente trae código hecho en Educablocks, el `Serial.begin` ya viene a 9600.
- **Librerías:** las que generan los bloques (`Servo.h`, `LiquidCrystal_I2C.h`, `SoftwareSerial.h`) tienen su fila en el skill `librerias`. La excepción es el DHT11: Educablocks incluye **`dht11.h`**, una librería vieja que no está en el registro de PlatformIO; en Tecnia Bot compilá con la de la tabla de `librerias` (`adafruit/DHT sensor library`). La equivalencia está en la sección "De bloques a C++".

---

## Mapa de puertos (puerto RJ12 → pin del UNO)

| Puerto (rótulo) | Pin/es del UNO | Color | Para qué se usa |
|---|---|---|---|
| **2** | 2 | azul | digital (entrada/salida). Ojo: también es la **segunda señal del puerto 3** |
| **3** | **3 + 2** (señal 1 = 3, señal 2 = 2) | azul/amarillo | puerto **doble** («D3-S1»): ultrasonido (trigger 3, echo 2) o motor DC (3 y 2). PWM en 3 |
| **5** | 5 | azul/amarillo | digital con PWM (LED con brillo, buzzer, servo) |
| **6** | **6 + 7** (señal 1 = 6, señal 2 = 7) | azul/amarillo | puerto **doble** («D6-S3»): ultrasonido (trigger 6, echo 7) o motor DC (6 y 7). PWM en 6 |
| **7** | 7 | azul | digital. Ojo: también es la **segunda señal del puerto 6** |
| **8** | 8 | azul | digital |
| **9** | 9 | azul/amarillo | digital con PWM (servo) |
| **10** | 10 | azul/amarillo | digital con PWM. Serigrafía «D10-SPI»: el 10 es SS de la SPI del UNO |
| **11** | 11 | azul/amarillo | digital con PWM (también MOSI de SPI) |
| **12** | 12 | azul | digital (también MISO de SPI) |
| **13** | 13 | azul | digital (también SCK de SPI y el LED integrado `LED_BUILTIN`) |
| **A0 … A5** | A0 … A5 | rosa | analógico 0-1023 (potenciómetro, LDR, suelo, lluvia, sonido). También sirven como digital |
| **COM** | D0 (RX) + D1 (TX) | verde | serie por hardware: Bluetooth HC-05/06 o cualquier módulo serie. Es el mismo canal que el USB: **desenchufá el módulo para cargar** |
| **IIC** | A4 (SDA) + A5 (SCL) | violeta | I2C: LCD 16x2 con adaptador (0x27 o 0x3F) y otros módulos I2C |

**Los puertos dobles 3 y 6, explicados.** Un ultrasonido necesita dos señales (trigger y echo) y un motor DC con puente H necesita dos (dirección). Educabot resolvió eso llevando **dos pines a un mismo RJ12**: al puerto 3 van los pines 3 y 2; al puerto 6 van los 6 y 7. Por eso el bloque de ultrasonido de Educablocks te deja elegir "puerto 3" o "puerto 6" y genera `trigger=3, echo=2` o `trigger=6, echo=7`. Consecuencias prácticas:

- Si tenés un ultrasonido o un motor en el puerto 3, **el puerto 2 queda ocupado** aunque esté libre a la vista (y lo mismo 6 con 7).
- Si usás el pin 2 o el 7 para otra cosa por código, no enchufes nada en el puerto doble correspondiente.
- Otra revisión del generador usa "puerto 4 → trigger 4, echo 5"; en la placa fotografiada **no hay puerto 4**, así que si un docente ve ese bloque, es de otra placa o versión.
- Los rótulos «D3-S1» y «D6-S3» de la serigrafía son las marcas de esos puertos dobles (S1/S3 es la numeración interna de Educabot; no hay documento público que la explique).

---

## Catálogo de módulos Educablocks y su equivalente en Tecnia Bot

Los módulos son los mismos sensores y actuadores genéricos que ya cubren los skills `sensores`, `actuadores` y `modulos-avanzados`, montados en una plaqueta con RJ12. Salvo los dobles, **cada módulo usa UN pin de señal = el número del puerto**.

| Módulo (nombre en Educablocks) | Puerto | Pin/es que usa | Lectura/acción | Equivalente en Tecnia Bot |
|---|---|---|---|---|
| Led | cualquier digital | el del puerto | `digitalWrite` | `arduino` › LED (ya trae su resistencia) |
| Botón | digital | el del puerto | `digitalRead` | `arduino` › Botón |
| Luz (LDR) | analógico | A0-A5 | `analogRead` | `sensores` › LDR |
| Potenciómetro | analógico | A0-A5 | `analogRead` | `arduino` › Potenciómetro |
| Suelo (FC-28) / Lluvia | analógico | A0-A5 | `analogRead` | `sensores` › FC-28 / YL-83 |
| Sonido | analógico | A0-A5 | `analogRead` | `sensores` › KY-038 |
| Pir, Óptico, IR obstáculo, Tilt, Touch, Vibración, Hall | digital | el del puerto | `digitalRead` | `sensores` › PIR; los demás son digitales genéricos |
| Ultrasonidos (HC-SR04) | **3 o 6** | 3+2 / 6+7 | `pulseIn` | `sensores` › HC-SR04 (**sin divisor**: el UNO es 5V) |
| Motor DC (puente H del kit) | **3 o 6** | 3+2 / 6+7 | dos `digitalWrite` | `actuadores` › Motor DC + L298N |
| Seguidor de líneas | dos digitales | pin izquierda + pin derecha | dos `digitalRead` | `proyectos-inet` (robots) |
| Servo 180 / Servo 360 | digital (mejor PWM) | el del puerto | `Servo.h` | `actuadores` › Servo SG90 |
| Relé («Relé (invertido)») | digital | el del puerto | `digitalWrite` | `actuadores` › Relé. El bloque lo llama *invertido*: probá con `LOW` = activo |
| Zumbador (buzzer) | digital | el del puerto | `tone()` | `fichas` › 15 «El zumbador» (activo vs pasivo) |
| Led RGB | tres PWM | tres pines | `analogWrite` ×3 | `modulos-avanzados` › LED RGB |
| DHT11 | digital | el del puerto | `dht11.h` | `sensores` › DHT11/22 con `DHT.h` |
| LCD 16x2 I2C | **IIC** | A4/A5 | `LiquidCrystal_I2C` | `librerias` (fila LCD I2C) |
| Matriz 8x8 | ver nota | — | `LedControlMS.h` | `modulos-avanzados` (no hay ficha propia) |
| Bluetooth | **COM** o dos digitales | D0/D1 o RX/TX elegidos | `SoftwareSerial` | `comunicacion-serial` |

> **Nota matriz 8x8:** la plantilla de Educablocks incluye `LedControlMS.h` (driver MAX7219, tres señales DIN/CLK/CS). En qué puerto va el módulo de matriz de Educabot **no lo pude confirmar**; la serigrafía «D10-SPI» sugiere el puerto 10, pero es una inferencia, no un dato.

**Cuando el docente pregunta "cómo lo conecto":** la respuesta es esta tabla: *módulo X → puerto Y, con el cable RJ12 del kit*. No hay protoboard ni cables sueltos. Si quiere conectar un componente **que no es de Educabot** (un sensor pelado, un módulo de otro kit), pasá a los skills `sensores`/`actuadores` y al pinout del UNO; para llegar a los pines del UNO necesita los headers hembra de la placa o medir el RJ12 (ver Advertencias).

---

## De bloques a C++ (lo que Educablocks genera y cómo lo escribimos en Tecnia Bot)

Educablocks/Robots tiene un botón **«dos llaves» `{ }`** que muestra el código Arduino generado por los bloques. Lo que sigue son las plantillas reales del generador (código abierto de `educablocks-offline`), útiles para leer ese código con el docente. La tabla completa de bloques está en [`bloques-a-codigo.md`](bloques-a-codigo.md).

**1. Bloque «Led» — Pin 5, Estado: Encender**
```cpp
// Educablocks genera:
void setup() { pinMode(5, OUTPUT); }
void loop()  { digitalWrite(5, HIGH); }
```
En Tecnia Bot: lo mismo con nombre: `const int PIN_LED = 5;` (puerto **5**). Ver `arduino` › LED.

**2. Bloque «Potenciómetro» / «Luz» — Pin A0**
```cpp
int valor = analogRead(A0);   // 0-1023, igual que en cualquier UNO
```
Puerto **A0** (rosa). Mismo código que `arduino` › Potenciómetro y `sensores` › LDR.

**3. Bloque «Ultrasonidos» — puerto 3 (Trigger 3, Echo 2)**
```cpp
// Educablocks genera estas dos funciones y llama u_distancia(3, 2):
long u_tiempo(int trigger_pin, int echo_pin) {
  digitalWrite(trigger_pin, LOW);  delayMicroseconds(2);
  digitalWrite(trigger_pin, HIGH); delayMicroseconds(10);
  digitalWrite(trigger_pin, LOW);
  return pulseIn(echo_pin, HIGH);
}
long u_distancia(int trigger_pin, int echo_pin) {
  long d = u_tiempo(trigger_pin, echo_pin) / 29 / 2;   // microsegundos → cm
  if (d == 0) d = 999;                                  // sin eco = "muy lejos"
  return d;
}
```
En Tecnia Bot: el HC-SR04 de `sensores` con `TRIG = 3`, `ECHO = 2` (puerto **3**) o `TRIG = 6`, `ECHO = 7` (puerto **6**). **Sin divisor de tensión**: el divisor de la ficha es para ESP32; acá el echo entra a un pin de 5V.

**4. Bloque «DHT11» + «Temperatura» / «Humedad» — Pin 8**
```cpp
// Educablocks genera (librería dht11.h, no está en PlatformIO):
#include <dht11.h>
dht11 DHT11;
#define DHT11PIN 8
void loop() {
  DHT11.read(DHT11PIN);
  Serial.println(DHT11.temperature);   // entero, en °C
  Serial.println(DHT11.humidity);      // entero, en %
}
```
En Tecnia Bot, con la librería de la tabla de `librerias` (`lib_deps = adafruit/DHT sensor library`, `adafruit/Adafruit Unified Sensor`):
```cpp
#include <DHT.h>
#define PIN_DHT 8                       // el pin del puerto donde está el módulo
DHT dht(PIN_DHT, DHT11);
void setup() { Serial.begin(9600); dht.begin(); }
void loop() {
  float t = dht.readTemperature();      // DHT11.temperature  →  dht.readTemperature()
  float h = dht.readHumidity();         // DHT11.humidity     →  dht.readHumidity()
  if (isnan(t) || isnan(h)) { Serial.println("Error al leer"); }
  else { Serial.print(t); Serial.print(" C  "); Serial.print(h); Serial.println(" %"); }
  delay(2000);
}
```

**5. Bloque «Servo 180» — Pin 9, Grados 90**
```cpp
// Educablocks genera un arreglo de servos indexado por pin:
#include <Servo.h>
Servo servos[13];
void setup() { servos[9].attach(9); }
void loop()  { servos[9].write(90); delay(500); }
```
En Tecnia Bot: `Servo servo; servo.attach(9); servo.write(90);` con `lib_deps = arduino-libraries/Servo` (puerto **9**, o 3/5/6/10/11). Ver `actuadores` › Servo.

**6. Bloque «Motor DC» — puerto 3, ON (Positivo 3, Negativo 2)**
```cpp
void setup() { pinMode(3, OUTPUT); pinMode(2, OUTPUT); }
void loop()  { digitalWrite(3, HIGH); digitalWrite(2, LOW); }   // un sentido
// HIGH/LOW al revés = el otro sentido; LOW/LOW = frena
```
En Tecnia Bot: es un puente H de dos entradas (IN1/IN2) como en `actuadores` › L298N, pero el driver ya está en el módulo de Educabot y se alimenta por el RJ12. Con `analogWrite(3, velocidad)` en el pin PWM controlás la velocidad.

**7. Bloque «LCD I2C» — Dirección 0x27, «LCD: Imprimir»**
```cpp
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
void setup() { lcd.init(); lcd.backlight(); }
void loop()  { lcd.setCursor(0, 0); lcd.print("Hola"); }
```
En Tecnia Bot: idéntico, con `lib_deps = marcoschwartz/LiquidCrystal_I2C` (misma API `init()`/`backlight()`). Puerto **IIC**. Si no muestra nada, probá `0x3F`: el bloque «Escaner I2C» de Educablocks hace justamente eso (recorre direcciones con `Wire.beginTransmission`).

**8. Bloque «Relé (invertido)» — Pin 7**
```cpp
void setup() { pinMode(7, OUTPUT); }
void loop()  { digitalWrite(7, LOW); delay(1000); digitalWrite(7, HIGH); delay(1000); }
```
El bloque se llama *invertido* porque el módulo relé del kit es **activo-bajo**: `LOW` engancha, `HIGH` suelta (las etiquetas Encender/Apagar del bloque están cruzadas a propósito). En Tecnia Bot: `actuadores` › Relé, con la advertencia de activo-bajo que ya está ahí.

---

## La plataforma Educablocks / Robots — y cuándo conviene cada herramienta

- **Dónde:** https://robots.educabot.com (también https://labs.educabot.com). Es web; hubo un editor offline de código abierto (`educablocks-offline`, ya archivado).
- **Tres niveles:** *principiante* («bloques junior», con íconos), *intermedio* (bloques Blockly con parámetros) y *avanzado* (código Arduino editable).
- **Ver el código:** botón **«dos llaves» `{ }`**. Es la mejor puerta de entrada a C++: el alumno arma los bloques, mira el código y después lo pega en Tecnia Bot para entenderlo línea por línea.
- **Cargar a la placa:** la web necesita un **plugin local** (`install_v3.0.exe`, un derivado de arduino-create-agent). Cuando la placa está conectada y el plugin corre, la barra dice **«Preparado»**. En labs.educabot.com el botón **«VINCULAR»** abre el selector de puertos del navegador (Web Serial, solo Chrome/Edge).
- **Otras placas:** la plataforma también programa Arduino UNO, Mega 2560, Nano, Micro y Leonardo, micro:bit y el dron Tello EDU.
- **Kits:** **Kit Inventor** (placa + sensores y actuadores), **Robot Zonda** (chasis con motores, puente H, seguidores de línea, ultrasonido, Bluetooth, servo) y **Codit** (nivel inicial).

| Situación | Conviene |
|---|---|
| Primer contacto, primaria o 1° año, "que prenda un LED" | Educablocks nivel principiante/intermedio |
| El docente quiere que entiendan qué hay detrás del bloque | Bloques → botón `{ }` → pegar el código en Tecnia Bot y leerlo juntos |
| Proyecto con librerías, funciones propias, más de un sensor, depuración | Tecnia Bot + PlatformIO (`board = uno`) |
| No hay internet en el aula o el plugin no anda | Tecnia Bot: compila y carga offline |
| Un módulo del kit con bloque propio (ultrasonido, motor) | Cualquiera; la tabla de puertos de arriba vale para ambos |

**No hace falta elegir bando**: la placa es la misma y el código que sale de Educablocks compila en PlatformIO tal cual (salvo `dht11.h` y `LedControlMS.h`, que hay que reemplazar por las de `librerias`).

---

## Advertencias

1. **El pinout del RJ12 no está documentado.** No hay documento público que diga cuál de los 6 hilos es VCC, GND, señal 1 y señal 2. **Nunca lo adivines ni lo deduzcas del color del cable.** Si el docente quiere conectar un módulo que no es de Educabot o armar un cable RJ12 casero, tiene que **medir continuidad con el tester** entre cada contacto del RJ12 y los pines GND / 5V / digital del header de la placa, y anotarlo. Un módulo alimentado al revés se quema en el acto.
2. **Nunca dos fuentes.** Los módulos reciben 5V y GND por el cable RJ12. No les agregues una segunda alimentación (una pila, una fuente externa) mientras están enchufados a la placa.
3. **Lógica de 5V.** Es un UNO: sus salidas son de 5V y sus entradas toleran 5V. Todo lo que el skill `esp32` dice de 3.3V, divisores y strapping pins **no aplica**. A la inversa: un módulo de 3.3V puro (algunos sensores I2C) no va directo a esta placa.
4. **El tool `circuito` dibuja ESP32.** No tiene ninguna pieza ni preset de la Educablocks UNO ni de los módulos RJ12. Para "cómo conecto" en esta placa, respondé con la tabla de puertos; no llames al tool y no muestres un dibujo de ESP32 como si fuera esta placa.
5. **COM comparte el USB.** Si hay un módulo en el puerto COM (Bluetooth), desenchufalo para cargar el programa; si no, `avrdude` falla con `not in sync`.
6. **Los puertos dobles ocupan dos pines.** Ultrasonido o motor en el 3 → el 2 no se usa; en el 6 → el 7 no se usa.
7. **Cantidades por revisión.** La cantidad de puertos analógicos y PWM varía según la revisión (el vendedor dice 8 analógicos/4 PWM; la unidad fotografiada tiene 6/6). Leé la serigrafía.

---

## Regla de oro (ampliada)

- **No inventés el pinout del RJ12.** Si te lo preguntan, la respuesta es: *"no está publicado; se mide con tester así…"*.
- **Si un dato no está en este skill, decilo.** Chip USB-serie, orden de hilos, puerto de la matriz, revisión exacta: no están verificados. Es mejor "no lo tengo confirmado, fijate en la serigrafía / medilo" que un número inventado que quema un módulo.
- **Puerto = pin**, salvo 3 (3+2), 6 (6+7), COM (0+1) e IIC (A4+A5). Cualquier otra correspondencia que alguien te diga, verificala contra la serigrafía.
- **Es un UNO.** Cuando dudes, volvé al skill `arduino`.

---

## Fuentes

- Foto de la unidad del usuario (serigrafía, colores y rótulos de los 20 puertos) y página de la placa en la tienda oficial: https://www.tienda.educabot.com/placa-educablocks-uno-educabot-para-arduino (cita textual de la descripción del vendedor). Componentes: https://www.tienda.educabot.com/componentes-educablocks · Cable de 6 hilos: https://www.tienda.educabot.com/cable-conexion-simple-educabot-educablocks-arduino-30cm/p/MLA46716611
- Editor offline de código abierto de Educabot: https://github.com/educabot/educablocks-offline — `views/global/js/arduino/client.js` (Arduino IDE 1.8.5, `arduino:avr:uno`, `avrdude -patmega328p -carduino -b115200`, monitor 9600) y `educablocks.js` (generadores de bloques: pines de ultrasonido y motor por puerto, plantillas C++, etiquetas en castellano).
- Plataforma Educablocks/Robots: https://robots.educabot.com y https://labs.educabot.com.
- Centro de ayuda de Educabot (https://educabot.zendesk.com/hc/es-419): niveles para programar (articles/4404216667661), ejecutar código en la placa (articles/360052488432), ver el código de los bloques (articles/4404529213581), descargar el plugin `install_v3.0.exe` (articles/360052278572), vincular la placa en labs (articles/29428747739533), placas que soporta la plataforma (articles/4404216726669), usar la placa a pilas (articles/4403755560589).
- Skills de Tecnia Bot relacionados: `arduino`, `sensores`, `actuadores`, `modulos-avanzados`, `librerias`, `comunicacion-serial`, `gotchas-hardware`.
