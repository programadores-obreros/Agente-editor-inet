---
name: modulos-avanzados
description: Módulos del kit que dan un salto de nivel - OLED, 7 segmentos, NeoPixel (LED inteligente), MPU6050 (acelerómetro), motor paso a paso, teclado matricial, joystick, LED RGB. Conexión I2C, código y proyectos.
---

# Módulos avanzados — el salto de nivel en el aula

Estos módulos llevan los proyectos a otro nivel: mostrar info en pantalla, controlar motores con precisión, detectar movimiento e inclinación, ingresar claves. Son los que aparecen en los proyectos de 2do y 3er año.

> **Concepto clave — I2C:** varios de estos (OLED, MPU6050) usan **I2C**, un "bus" donde muchos componentes comparten solo 2 cables (SDA y SCL). En el ESP32: **SDA=GPIO21, SCL=GPIO22**. Cada uno tiene una "dirección" (como un número de casa) para que el ESP32 sepa con quién habla. ¡Podés conectar varios módulos I2C a los mismos 2 pines!

---

## OLED SSD1306 — Pantalla gráfica

> ⚡ 3.3V · 📦 `Adafruit_SSD1306` + `Adafruit_GFX` · I2C dirección **0x3C**

**¿Para qué sirve?** Mostrar texto, números, dibujos, gráficos en una pantallita nítida (128x64 píxeles). Mucho mejor que el LCD para mostrar datos de sensores.

**Conexión:** VCC→3.3V, GND→GND, **SDA→GPIO21, SCL→GPIO22** (I2C).

```cpp
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 oled(128, 64, &Wire, -1);   // ancho, alto, bus I2C

void setup() {
  oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);    // dirección I2C 0x3C
  oled.clearDisplay();
  oled.setTextSize(2);
  oled.setTextColor(WHITE);
  oled.setCursor(0, 20);
  oled.println("Hola Profe!");
  oled.display();                            // ¡importante! sin esto no se ve nada
}

void loop() {}
```
**Error común:** no aparece nada → olvidaste `oled.display()`, o la dirección no es 0x3C (usá un scanner I2C para averiguarla).

---

## Display 7 segmentos — Números grandes

> ⚡ 3.3V · 📦 `SevSeg` · cada segmento con 330Ω

**¿Para qué sirve?** Mostrar UN dígito (0-9) bien grande y brillante. Contadores, relojes, marcadores. Tiene 7 segmentos (A-G) + el punto (DP).

**Conexión:** cada segmento (A a G) a un GPIO con su resistencia de 330Ω; el común a GND (cátodo común) o a VCC (ánodo común). Gasta muchos pines — por eso conviene la librería `SevSeg` o un decodificador.

**Concepto:** un número se "dibuja" encendiendo ciertos segmentos. El "2" prende A, B, G, E, D. El "1" solo B y C.

---

## NeoPixel (WS2812) — LED inteligente direccionable

> ⚡ 5V · 📦 `Adafruit_NeoPixel` · UN pin de datos

**¿Para qué sirve?** Es un LED RGB especial: con **un solo pin** controlás muchos en cadena, cada uno con su color y brillo. Tiras de luces, efectos, matrices. ¡Magia para los pibes!

**Conexión:** VCC→5V, GND→GND, DIN→un GPIO.

```cpp
#include <Adafruit_NeoPixel.h>

#define PIN 5
#define CANTIDAD 8                         // cuántos LEDs tenés en la tira

Adafruit_NeoPixel tira(CANTIDAD, PIN, NEO_GRB + NEO_KHZ800);

void setup() {
  tira.begin();
  tira.setBrightness(50);                  // ¡no al máximo! consumen mucha corriente
}

void loop() {
  for (int i = 0; i < CANTIDAD; i++) {
    tira.setPixelColor(i, tira.Color(255, 0, 150));  // R, G, B (0-255)
  }
  tira.show();                             // mostrar los cambios
  delay(500);
}
```
**Cuidado:** muchos NeoPixels consumen MUCHA corriente. Para tiras largas, fuente externa de 5V.

---

## MPU6050 — Acelerómetro + giroscopio

> ⚡ 3.3V · 📦 `Adafruit_MPU6050` + `Adafruit_Sensor` · I2C dirección **0x68**

**¿Para qué sirve?** Mide **aceleración** (en 3 ejes X/Y/Z) y **rotación/giro** (3 ejes). Detecta inclinación, sacudidas, caídas, orientación. Nivel digital, dron, control por gestos, contador de pasos.

**Conexión:** VCC→3.3V, GND→GND, **SDA→GPIO21, SCL→GPIO22** (I2C). AD0 suelto o a GND = dirección 0x68; a 3.3V = 0x69.

```cpp
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Wire.h>

Adafruit_MPU6050 mpu;

void setup() {
  Serial.begin(115200);
  mpu.begin();                             // inicia el sensor (dir 0x68)
}

void loop() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);             // lee aceleración, giro, temperatura

  Serial.print("Acel X: "); Serial.print(a.acceleration.x);
  Serial.print("  Y: "); Serial.print(a.acceleration.y);
  Serial.print("  Z: "); Serial.println(a.acceleration.z);
  delay(300);
}
```
**Dato:** cuando está quieto y plano, el eje Z marca ~9.8 (la gravedad). Si lo inclinás, la gravedad se reparte entre los ejes — así se calcula la inclinación.

---

## Motor paso a paso (28BYJ-48 + ULN2003)

> ⚡ 5V · 📦 `Stepper` o `AccelStepper` · driver ULN2003

**¿Para qué sirve?** Gira en **pasos exactos** (a diferencia del servo, da vueltas completas y controlás la posición con precisión). Persianas automáticas, impresoras, relojes, plataformas que giran.

**Conexión:** el motor va al driver ULN2003 (placa con 4 LEDs). El driver tiene 4 pines (IN1, IN2, IN3, IN4) que van a 4 GPIO. El motor se alimenta de 5V.

```cpp
#include <Stepper.h>

const int PASOS = 2048;                    // pasos por vuelta del 28BYJ-48
// orden de pines: IN1, IN3, IN2, IN4 (¡ojo, no es 1-2-3-4!)
Stepper motor(PASOS, 18, 5, 19, 23);

void setup() {
  motor.setSpeed(10);                      // velocidad en RPM
}

void loop() {
  motor.step(PASOS);                       // una vuelta completa
  delay(1000);
  motor.step(-PASOS);                      // vuelta al revés
  delay(1000);
}
```
**Gotcha clásico:** el orden de los pines en el código del 28BYJ-48 es **IN1, IN3, IN2, IN4** (cruzado), no 1-2-3-4. Si gira raro o vibra, es por eso.

---

## Teclado matricial 4x4

> ⚡ 3.3V · 📦 `Keypad`

**¿Para qué sirve?** Ingresar números, claves, comandos. 16 teclas (0-9, A-D, *, #). El truco genial: usa solo **8 pines** para 16 teclas, leyendo por filas y columnas (matriz).

**Conexión:** 4 pines de filas + 4 de columnas, a 8 GPIO.

```cpp
#include <Keypad.h>

const byte FILAS = 4, COLS = 4;
char teclas[FILAS][COLS] = {
  {'1','2','3','A'}, {'4','5','6','B'},
  {'7','8','9','C'}, {'*','0','#','D'}
};
byte pinFilas[FILAS] = {13, 12, 14, 27};
byte pinCols[COLS]   = {26, 25, 33, 32};

Keypad teclado = Keypad(makeKeymap(teclas), pinFilas, pinCols, FILAS, COLS);

void setup() { Serial.begin(115200); }

void loop() {
  char tecla = teclado.getKey();           // devuelve la tecla apretada (o nada)
  if (tecla) {
    Serial.print("Apretaste: "); Serial.println(tecla);
  }
}
```

---

## Joystick analógico

> ⚡ 3.3V · sin librería

**¿Para qué sirve?** Mover algo en 2 direcciones (X e Y) + un botón al apretar. Robots, juegos, control de cámara.

**Conexión:** VCC→3.3V, GND→GND, VRx→pin analógico, VRy→otro pin analógico, SW→un GPIO.

```cpp
const int X = 34, Y = 35, BOTON = 32;

void setup() {
  Serial.begin(115200);
  pinMode(BOTON, INPUT_PULLUP);
}

void loop() {
  int ejeX = analogRead(X);     // 0-4095 (centro ~2048)
  int ejeY = analogRead(Y);
  int apretado = !digitalRead(BOTON);  // INPUT_PULLUP: apretado = LOW

  Serial.print("X: "); Serial.print(ejeX);
  Serial.print("  Y: "); Serial.print(ejeY);
  Serial.print("  Boton: "); Serial.println(apretado);
  delay(100);
}
```
**Dato:** en reposo, los ejes leen ~2048 (la mitad de 4095). Al mover, van hacia 0 o 4095.

---

## LED RGB (cátodo común)

> ⚡ 3.3V · cada color con 330Ω

**¿Para qué sirve?** Un LED que hace CUALQUIER color mezclando rojo, verde y azul. Indicadores de estado, ambientación.

**Conexión:** 3 pines (R, G, B) cada uno a un GPIO con 330Ω; el común (la pata más larga) a GND.

```cpp
const int R = 4, G = 5, B = 18;

void setup() {
  pinMode(R, OUTPUT); pinMode(G, OUTPUT); pinMode(B, OUTPUT);
}

void loop() {
  // analogWrite (PWM) mezcla intensidades 0-255 → cualquier color
  analogWrite(R, 255); analogWrite(G, 0); analogWrite(B, 150);  // rosa
  delay(1000);
  analogWrite(R, 0); analogWrite(G, 255); analogWrite(B, 255);  // celeste
  delay(1000);
}
```

---

## Resumen de conexión rápida

| Módulo | Bus/tipo | Pines clave (ESP32) | Librería |
|--------|----------|---------------------|----------|
| OLED SSD1306 | I2C 0x3C | SDA 21, SCL 22 | Adafruit_SSD1306 |
| MPU6050 | I2C 0x68 | SDA 21, SCL 22 | Adafruit_MPU6050 |
| 7 segmentos | digital | 7 pines + común | SevSeg |
| NeoPixel | datos serie | 1 pin (5V) | Adafruit_NeoPixel |
| Motor paso a paso | digital | IN1-4 (vía ULN2003) | Stepper |
| Teclado 4x4 | matriz | 4 filas + 4 cols | Keypad |
| Joystick | analógico | VRx, VRy + SW | — |
| LED RGB | PWM | R, G, B + GND | — |
