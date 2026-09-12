---
name: educabot
description: Kits Educabot (Argentina). OJO - Educabot tiene MÁS DE UNA placa y NO son iguales: la Educablocks UNO (placa de banco, 20 puertos RJ12, ATmega328P en zócalo DIP, USB-B cuadrado) y el Bhoot - que el software de Educabot llama "Buty" - (placa de robot, 6 puertos + 2 IIC, motores MI/MD, zumbador y Bluetooth HM-10 a bordo, ATmega328P TQFP soldado). Antes de dar un dato hay que saber CUÁL de las dos es. Este skill tiene - cómo distinguirlas, el mapa de puertos de la Educablocks UNO con sus puertos especiales E3/E4/E6 y los colores oficiales, los bloques de Educablocks/Robots y qué C++ generan, Kit Inventor, Robot Zonda, Codit, los proyectos del Libro de actividades. El mapa de puertos del Bhoot y el `board =` de las dos están en el skill `placas`. Frases típicas - "placa Educabot", "Educablocks", "Bhoot", "Buty", "conectores de teléfono", "cable RJ12", "Kit Inventor", "Zonda".
---

# Educabot — las placas y los bloques de Educablocks/Robots

Muchas escuelas técnicas tienen kits de **Educabot** (empresa argentina de tecnología educativa). Los alumnos enchufan módulos con cable **RJ12** (los de teléfono fijo) en vez de armar protoboard, y programan con bloques en la plataforma de Educabot. Este skill le da a Tecnia Bot lo que hace falta para reconocer sus placas, programarlas en C++ con PlatformIO y traducir lo que el docente ya sabe hacer con bloques.

## ⚠️ PRIMERO: «placa Educabot» NO alcanza. ¿CUÁL de las dos?

**Educabot tiene más de una placa, y son distintas.** Decir «tengo la placa de Educabot» no
identifica nada. Antes de dar un puerto, un pin o un módulo, resolvé cuál es — y si el docente
no sabe, **pedile que mire la plaqueta**, que se distinguen de un vistazo:

| | **Educablocks UNO** | **Bhoot v1.0** (el software la llama **«Buty»**) |
|---|---|---|
| Qué es | placa de **banco** | placa de **robot** |
| Serigrafía | «EDUCABOT · Educablocks UNO» | «EDUCABOT · **Bhoot v1.0**» |
| Puertos RJ12 | **20**, rotulados con el pin (2-13, A0-A5, COM, IIC) | **6** numerados **0 a 5** + **2 IIC** |
| Motores | por los puertos especiales E3/E4/E6 | conectores **MI** y **MD** dedicados |
| El chip | ATmega328P **DIP, en zócalo** (se puede sacar) | ATmega328P **TQFP, soldado** |
| USB | **USB-B cuadrado**, el de impresora | conector chico |
| A bordo | nada | **zumbador** + **Bluetooth HM-10** soldados |

**Si ves motores MI/MD y un módulo Bluetooth soldado: es un Bhoot, y NADA de lo que sigue en
este skill sobre puertos le aplica.** No tiene E3, ni E4, ni E6, ni 20 conectores.

> **El mapa puerto → pin del Bhoot está en el skill `placas`**, junto con sus tres variantes
> (común, LGO20, IACO — que tienen pinouts distintos). Este skill cubre la **Educablocks UNO**.
> Las dos compilan igual, con `board = uno`.

Todo lo demás de este skill —los bloques y qué C++ generan, el Kit Inventor, el Zonda, el Codit,
los proyectos del Libro de actividades— **aplica a las dos**: lo que cambia es dónde enchufás.

---

> **Regla de oro:** la Educablocks UNO **es un Arduino UNO** (ATmega328P, lógica de **5V**). Todo lo del skill `arduino` aplica tal cual. Lo que cambia es el conector: cada puerto RJ12 lleva **un pin del UNO** más 5V y GND, salvo los puertos **especiales E3, E4 y E6**, que llevan **tres pines** (dos señales + un PWM) y VIN. Qué señales lleva cada conector está publicado en el *Libro de actividades* de Educabot (diagrama de la p. 29, copiado en `docs/educabot/`). Lo que **no está publicado** es la posición física de cada señal en los 6 contactos del RJ12: si el docente arma un cable o conecta algo que no es del kit, mandalo a medir con tester, nunca lo inventes.

---

## La Educablocks UNO — qué es y cómo reconocerla

*(Si tenés un Bhoot, esta sección no es tuya: volvé a la tabla de arriba.)*

Serigrafía: **«EDUCABOT · Educablocks UNO»**. Tiene el ATmega328P en formato DIP (el chip grande con zócalo), el conector ICSP de 6 pines, botón de reset, **USB-B** (cuadrado, como el de impresora) y **jack DC** para alimentación. Alrededor, **20 conectores RJ12** rotulados con el pin que llevan:

- **Celestes/azules:** digitales 2 a 13 (en la unidad fotografiada no está el 4; en la revisión del libro sí). Los que tienen **mitad amarilla** son los PWM del UNO: 3, 5, 6, 9, 10, 11.
- **Rojos (o mitad roja):** los puertos **especiales E3, E4 y E6**, con tres señales para ultrasonido y motores (ver más abajo).
- **Rosas:** analógicos A0 a A5.
- **Verde «COM»:** serie por hardware (D0/D1, el mismo canal que el USB).
- **Violeta «IIC»:** I2C (A4 = SDA, A5 = SCL, como en cualquier UNO).
- La serigrafía también dice **«D3-S1»**, **«D6-S3»** y **«D10-SPI»**: marcas de los puertos especiales.

**Código de colores oficial** (Libro de actividades, p. 30) — también está en la etiqueta de cada módulo, y la regla del libro es *«conectá el módulo en un puerto del mismo color»*: **rosa** analógico (potenciómetro, luz, suelo, sonido) · **celeste** digital (pulsador, táctil, obstáculos, LED, zumbador) · **azul** digital con protocolo propio (DHT11, control IR, DS18B20 sumergible) · **verde** COM (Bluetooth) · **violeta** IIC (LCD y matriz) · **amarillo** PWM (LED con brillo, motores) · **rojo** especial (motores, ultrasonido).

La tienda de Educabot describe la placa así (cita textual del vendedor): *«puerto USB, alimentación hasta 24V, 20 puertos RJ12, 8 analógicos, 10 digitales, 1 IIC, 1 comunicación, 4 PWM»*. En la unidad fotografiada se cuentan **6 analógicos y 6 PWM**; la cantidad exacta **depende de la revisión** de la placa, así que confiá en lo que está serigrafiado en la que tenés adelante.

Si el docente dice "la placa con conectores de teléfono", "la del kit de robótica del colegio", "la que se programa con bloques en la web de Educabot", "Kit Inventor" o "Zonda": **es una placa de Educabot, pero eso NO dice cuál**. Cualquiera de esas frases le queda igual de bien al Bhoot. Volvé a la tabla del principio y resolvé cuál es antes de dar un puerto.

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
| **2** | 2 | celeste | digital (entrada/salida). Ojo: también es la **segunda señal del puerto E3** |
| **3** (E3) | **3 + 2**, más **11** (PWM) y VIN | rojo/amarillo | puerto **especial** («D3-S1»): ultrasonido (trigger 3, echo 2) o motor DC (3 y 2; velocidad por el 11). Señales del conector según el libro: D11~, D2, D3~, VIN, 5V, GND |
| **4** (E4) | **4 + 5**, más **9** (PWM) y VIN | rojo | puerto **especial**, sólo en algunas revisiones: ultrasonido (trigger 4, echo 5) o motor DC (4 y 5; velocidad por el 9). Señales: D9~, D5, D4, VIN, 5V, GND |
| **5** | 5 | celeste/amarillo | digital con PWM (LED con brillo, buzzer, servo). Ojo: también es la **segunda señal del E4** |
| **6** (E6) | **6 + 7**, más **10** (PWM) y VIN | rojo/amarillo | puerto **especial** («D6-S3»): ultrasonido (trigger 6, echo 7) o motor DC (6 y 7; velocidad por el 10). Señales: D10~, D7, D6, VIN, 5V, GND |
| **7** | 7 | celeste | digital. Ojo: también es la **segunda señal del puerto E6** |
| **8** | 8 | celeste | digital |
| **9** | 9 | celeste/amarillo | digital con PWM (servo). Ojo: es el **PWM del E4** |
| **10** | 10 | celeste/amarillo | digital con PWM. Serigrafía «D10-SPI»: el 10 es SS de la SPI del UNO. Ojo: es el **PWM del E6** |
| **11** | 11 | celeste/amarillo | digital con PWM (también MOSI de SPI). Ojo: es el **PWM del E3** |
| **12** | 12 | celeste | digital (también MISO de SPI) |
| **13** | 13 | celeste | digital (también SCK de SPI y el LED integrado `LED_BUILTIN`) |
| **A0 … A5** | A0 … A5 | rosa | analógico 0-1023 (potenciómetro, LDR, suelo, lluvia, sonido). También sirven como digital |
| **COM** | D0 (RX) + D1 (TX) | verde | serie por hardware: Bluetooth HC-05/06 o cualquier módulo serie. Es el mismo canal que el USB: **desenchufá el módulo para cargar** |
| **IIC** | A4 (SDA) + A5 (SCL) | violeta | I2C: LCD 16x2 con adaptador (0x27 o 0x3F), **matriz LED del kit** y otros módulos I2C |

Los puertos simples llevan **señal + 5V + GND** (tres hilos). COM lleva RX, TX, 5V, GND; IIC lleva SCL, SDA, 5V, GND. Todo esto sale del diagrama de la p. 29 del *Libro de actividades* (copia en `docs/educabot/educablocks-uno-conectores.png`).

**Los puertos especiales E3, E4 y E6, explicados.** Un ultrasonido necesita dos señales (trigger y echo) y un motor DC con puente H necesita dos de dirección y, si querés velocidad, una tercera PWM. Educabot resolvió eso llevando **tres pines y VIN a un mismo RJ12** (el libro, p. 29: *«puertos especiales que permiten conectar hasta 3 pines digitales, de los cuales uno puede ser PWM… poseen una salida VIN»*): al E3 van los pines 3 y 2 más el 11; al E4 los 4 y 5 más el 9; al E6 los 6 y 7 más el 10. Por eso el bloque de ultrasonido de Educablocks te deja elegir el puerto y genera `trigger=3, echo=2` o `trigger=6, echo=7` (o `trigger=4, echo=5` en la revisión con E4). Consecuencias prácticas:

- Si tenés un ultrasonido o un motor en el E3, **el puerto 2 queda ocupado** aunque esté libre a la vista (y lo mismo E4 con 5, E6 con 7). El libro lo dice textual: *«no conectemos nada a los puertos que están en uso cuando usamos los pines especiales»*.
- Si el motor va **con velocidad** (puente H con los dos jumpers puestos, tres señales), además queda ocupado el pin PWM del especial: **11** para E3, **9** para E4, **10** para E6.
- Si usás por código el pin 2, 5 o 7 (o el 11, 9, 10 con velocidad) para otra cosa, no enchufes nada en el especial correspondiente.
- **La revisión importa.** La placa del libro (2018) tiene los doce digitales del 2 al 13, con E3, E4 y E6 en rojo. La unidad fotografiada por el usuario no tiene el puerto 4. Leé la serigrafía de la que tenés adelante.
- Los rótulos «D3-S1» y «D6-S3» de la serigrafía son las marcas de esos puertos especiales (S1/S3 es la numeración interna de Educabot; no hay documento público que la explique).

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
| Pir, Óptico, IR obstáculo, Tilt, Touch (táctil), Vibración, Hall (magnético) | digital (celeste) | el del puerto | `digitalRead` | `sensores` › PIR; los demás son digitales genéricos. El libro usa: obstáculos en 2, 4 o 5; óptico, táctil y magnético en 2 |
| Ultrasonidos (HC-SR04) | **E3, E4 o E6** (rojo) | 3+2 / 4+5 / 6+7 | `pulseIn` | `sensores` › HC-SR04 (**sin divisor**: el UNO es 5V) |
| Motor DC (puente H del kit, hasta 4 motores: 2 MI + 2 MD) | **E3, E4 o E6** (rojo) | 3+2 / 4+5 / 6+7, más 11 / 9 / 10 si va con velocidad | dos `digitalWrite` (+ `analogWrite` en el PWM) | `actuadores` › Motor DC + L298N. El libro: MI en E3, MD en E4 |
| Temperatura LM335 (analógico) | analógico | A0-A5 | `analogRead` | Sin ficha propia en Tecnia Bot. Es un diodo Zener térmico: 10 mV por kelvin, así que °C = (tensión / 0,01) − 273 |
| Temperatura sumergible DS18B20 | digital (azul) | el del puerto | 1-Wire | Sin ficha propia. `lib_deps = paulstoffregen/OneWire`, `milesburton/DallasTemperature` (registro de PlatformIO) |
| Control IR (receptor + control remoto) | digital (azul) | el del puerto | `IRremote` | Sin ficha propia. `lib_deps = z3t0/IRremote`; el bloque «IR» de Educablocks imprime el código de cada botón por serie |
| Seguidor de líneas | dos digitales | pin izquierda + pin derecha | dos `digitalRead` | `proyectos-inet` (robots) |
| Servo 180 / Servo 360 | cualquier digital (el libro usa el 2 y el 8) | el del puerto | `Servo.h` | `actuadores` › Servo SG90 |
| Relé («Relé (invertido)») | digital | el del puerto | `digitalWrite` | `actuadores` › Relé. El bloque lo llama *invertido*: probá con `LOW` = activo |
| Zumbador (buzzer) | digital | el del puerto | `tone()` | `fichas` › 15 «El zumbador» (activo vs pasivo) |
| Led RGB | tres PWM | tres pines | `analogWrite` ×3 | `modulos-avanzados` › LED RGB |
| DHT11 | digital | el del puerto | `dht11.h` | `sensores` › DHT11/22 con `DHT.h` |
| LCD 16x2 I2C | **IIC** | A4/A5 | `LiquidCrystal_I2C` | `librerias` (fila LCD I2C) |
| Matriz LED 8x8 | **IIC** (violeta) | A4/A5 | ver nota | `modulos-avanzados` (no hay ficha propia) |
| Matriz RGB, Gesto, Makey Makey | — | — | — | Vienen en el inventario del kit (p. 28 del libro) pero el libro no trae actividad ni puerto: no inventes cómo van |
| Bluetooth | **COM** (verde) | D0/D1 | `Serial` (o `SoftwareSerial` en dos digitales) | `comunicacion-serial`. **Conectalo después de cargar** (ver Advertencias) |

> **Nota matriz 8x8:** el *Libro de actividades* (p. 42) la conecta al puerto **IIC**, igual que el LCD, y la programa con el bloque «Matriz LED». La plantilla del editor offline viejo, en cambio, incluye `LedControlMS.h` (MAX7219, tres señales DIN/CLK/CS): hubo **dos módulos de matriz distintos**. Mirá el módulo: si tiene un chip MAX7219 y cuatro hilos de datos, es el viejo; si va al IIC, es el del libro (I2C). No mezcles las librerías.

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
En Tecnia Bot: es un puente H de dos entradas (IN1/IN2) como en `actuadores` › L298N, pero el driver ya está en el módulo de Educabot y se alimenta por el VIN del RJ12. **La velocidad no va por el pin 3**: el puente H del kit se controla *«de forma digital (2 señales) o con PWM (3 señales); para PWM hay que colocar ambos jumpers»* (libro, p. 72), y la tercera señal es el pin PWM del puerto especial: `analogWrite(11, velocidad)` en el E3, `analogWrite(9, …)` en el E4, `analogWrite(10, …)` en el E6.

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

## Proyectos del *Libro de actividades* (con sus puertos)

Educabot publica un libro de actividades para primaria (4.º a 6.º grado, Diseño Curricular de la Provincia de Buenos Aires) con 17 proyectos por etapas (contextualizar → investigar → conectar → programar → desafíos → evaluar). Sirven tal cual como **escenas de ejemplo** para una escuela técnica que arranca, y como respuesta cuando un docente pregunta "qué puedo hacer con el kit". Puertos exactos del libro:

| Proyecto (grado) | Módulos → puertos | Idea |
|---|---|---|
| ¡Yo no quiero humedad en mi pieza! (4.º) | DHT11 → 2, LCD → IIC | mostrar humedad y temperatura |
| Don Quijote y los molinos (4.º) | ultrasonido → E3, motor DC → E4, matriz → IIC | al acercarse alguien, cambia la cara y gira el molino |
| Semáforos… ¿para todos? (4.º) | LEDs → 4, 5, 6; zumbador → 7 | semáforo con sonido |
| ¡Basta de calor! (4.º) | motor DC → E3, pulsador → 5 | ventilador a botón |
| ¿Quién es más alto? (4.º) | ultrasonido → E4, LCD → IIC | medidor de altura |
| Estación meteorológica (5.º) | LCD → IIC, LED → 3, DHT11 → 5 | alarma de temperatura |
| Medir para conocer (5.º) | obstáculos → 4, zumbador → 5 | contador con aviso |
| Contaminación sonora (5.º) | sonido → A0, LED → 2 | semáforo de ruido |
| Comunicación de los seres vivos (5.º) | luz → A0, LED → 3 | luz que responde a la oscuridad |
| Mejor convivencia escolar (5.º) | táctil y pulsador → 4, 5; LEDs → 2, 3 | votación con dos botones |
| ¡Todos a la fábrica! (6.º) | motores DC → E3, servo → 8, obstáculos → 5 | cinta transportadora |
| Ágilmente (6.º) | matriz → IIC, pulsador → 2 | juego de reacción |
| Estacionamiento inteligente (6.º) | obstáculos → 5, LEDs → 2, 3 | libre/ocupado |
| Instrucciones - Recorrido (6.º) | 4 motores DC → E3 + E4 (driver) | robot que sigue una secuencia |
| La importancia del agua (6.º) | suelo → A0, zumbador → 3 | alarma de riego |

Las actividades sueltas del capítulo «Kit electrónico» (pp. 32-73) usan casi siempre el **puerto 2** para digitales y **A0** para analógicos, ultrasonido en **E3**, motores MI en E3 y MD en E4, LCD y matriz en **IIC**, Bluetooth en **COM**.

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

1. **El orden físico de los contactos del RJ12 no está publicado.** El libro dice QUÉ señales lleva cada conector (señal, 5V, GND; y en los especiales PWM, señal 2, señal 1, VIN, 5V, GND), pero ningún documento público dice en cuál de los 6 contactos va cada una. **Nunca lo adivines ni lo deduzcas del color del cable ni del orden del dibujo.** Si el docente quiere conectar un módulo que no es de Educabot o armar un cable RJ12 casero, tiene que **medir continuidad con el tester** entre cada contacto del RJ12 y los pines GND / 5V / digital del header de la placa, y anotarlo. Un módulo alimentado al revés se quema en el acto.
2. **Nunca dos fuentes.** Los módulos reciben 5V y GND por el cable RJ12. No les agregues una segunda alimentación (una pila, una fuente externa) mientras están enchufados a la placa.
3. **Lógica de 5V.** Es un UNO: sus salidas son de 5V y sus entradas toleran 5V. Todo lo que el skill `esp32` dice de 3.3V, divisores y strapping pins **no aplica**. A la inversa: un módulo de 3.3V puro (algunos sensores I2C) no va directo a esta placa.
4. **El tool `circuito` dibuja ESP32.** No tiene ninguna pieza ni preset de la Educablocks UNO ni de los módulos RJ12. Para "cómo conecto" en esta placa, respondé con la tabla de puertos; no llames al tool y no muestres un dibujo de ESP32 como si fuera esta placa.
5. **COM comparte el USB.** Si hay un módulo en el puerto COM (Bluetooth), desenchufalo para cargar el programa; si no, `avrdude` falla con `not in sync`. El libro (p. 68) lo dice en mayúsculas: *«conectarlo después de haber cargado nuestro programa y nunca tenerlo conectado cuando estemos cargando código»*.
6. **Los puertos especiales ocupan dos o tres pines.** Ultrasonido o motor en el E3 → el 2 no se usa (y el 11 si hay velocidad); en el E4 → el 5 (y el 9); en el E6 → el 7 (y el 10).
7. **Cantidades por revisión.** La cantidad de puertos analógicos y PWM varía según la revisión (el vendedor dice 8 analógicos/4 PWM; la unidad fotografiada tiene 6/6). Leé la serigrafía.

---

## Regla de oro (ampliada)

- **No inventés el orden de los contactos del RJ12.** Si te lo preguntan, la respuesta es: *"qué señales lleva está en el libro; en qué contacto va cada una no está publicado; se mide con tester así…"*.
- **Si un dato no está en este skill, decilo.** Chip USB-serie, orden de contactos, revisión exacta, puerto de la matriz RGB / gesto / Makey Makey: no están verificados. Es mejor "no lo tengo confirmado, fijate en la serigrafía / medilo" que un número inventado que quema un módulo.
- **Puerto = pin**, salvo los especiales E3 (3+2+11), E4 (4+5+9), E6 (6+7+10), COM (0+1) e IIC (A4+A5). Cualquier otra correspondencia que alguien te diga, verificala contra la serigrafía.
- **Es un UNO.** Cuando dudes, volvé al skill `arduino`.

---

## Fuentes

- **Libro de actividades Educabot** (Educabot, 180 páginas; copia en `docs/educabot/libro-de-actividades-educabot.pdf`, uso autorizado por el fabricante: `docs/permisos/educabot.md`). Placa y diagrama de conectores p. 29; código de colores p. 30; señales analógicas/digitales p. 31; una actividad «¡A CONECTAR!» por módulo pp. 32-73 (puente H p. 72, Bluetooth p. 68); inventario del kit p. 28; kit mecánico p. 77; 17 proyectos por grado pp. 86-179.
- Foto de la unidad del usuario (serigrafía, colores y rótulos de los 20 puertos) y página de la placa en la tienda oficial: https://www.tienda.educabot.com/placa-educablocks-uno-educabot-para-arduino (cita textual de la descripción del vendedor). Componentes: https://www.tienda.educabot.com/componentes-educablocks · Cable de 6 hilos: https://www.tienda.educabot.com/cable-conexion-simple-educabot-educablocks-arduino-30cm/p/MLA46716611
- Editor offline de código abierto de Educabot: https://github.com/educabot/educablocks-offline — `views/global/js/arduino/client.js` (Arduino IDE 1.8.5, `arduino:avr:uno`, `avrdude -patmega328p -carduino -b115200`, monitor 9600) y `educablocks.js` (generadores de bloques: pines de ultrasonido y motor por puerto, plantillas C++, etiquetas en castellano).
- Plataforma Educablocks/Robots: https://robots.educabot.com y https://labs.educabot.com.
- Centro de ayuda de Educabot (https://educabot.zendesk.com/hc/es-419): niveles para programar (articles/4404216667661), ejecutar código en la placa (articles/360052488432), ver el código de los bloques (articles/4404529213581), descargar el plugin `install_v3.0.exe` (articles/360052278572), vincular la placa en labs (articles/29428747739533), placas que soporta la plataforma (articles/4404216726669), usar la placa a pilas (articles/4403755560589).
- Skills de Tecnia Bot relacionados: `arduino`, `sensores`, `actuadores`, `modulos-avanzados`, `librerias`, `comunicacion-serial`, `gotchas-hardware`.
