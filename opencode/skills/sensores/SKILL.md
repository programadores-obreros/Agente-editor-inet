---
name: sensores
description: Sensores para Arduino y ESP32 - DHT11/DHT22 (temperatura y humedad), HC-SR04 (distancia), LDR (luz), PIR (movimiento), KY-038 (sonido). Cómo conectarlos, código comentado en español, errores comunes.
---

# Sensores — los que MIDEN el mundo real

Los sensores son los "sentidos" del Arduino: miden temperatura, distancia, luz, movimiento, sonido. Son el corazón de casi todo proyecto de escuela técnica.

Cada sensor sigue la misma estructura: voltaje, dificultad, librería, para qué sirve, conexiones (con colores de cable), código comentado y errores comunes. Para mostrar el cableado, combiná con el skill `circuitos-visuales` (tool `circuito`) y `diagramas-conexion`.

> **Regla de oro de voltaje (ESP32):** el ESP32 es 3.3V. Varios sensores se alimentan de 5V (VIN) pero su salida puede dar 5V → necesitás un divisor de tensión antes del GPIO, o lo dañás. Ver skill `gotchas-hardware`.

---

## DHT11 / DHT22 — Temperatura y humedad

> ⚡ **Voltaje:** 3.3V o 5V · 📊 **Dificultad:** Básico · 📦 **Librería:** `DHT sensor library` (Adafruit)

**¿Para qué sirve?** Mide temperatura ambiente y humedad. El DHT22 es más preciso y de mayor rango que el DHT11 (cuesta un poco más). Estación meteorológica, control de invernadero, alarma de temperatura.

| DHT11 | DHT22 |
|-------|-------|
| 0-50°C, ±2°C | -40 a 80°C, ±0.5°C |
| 20-90% humedad | 0-100% humedad |
| más barato | más preciso |

**Conexiones (módulo de 3 pines):**

| Pin del sensor | Cable | Va al ESP32 |
|----------------|-------|-------------|
| VCC (+) | 🔴 rojo | 3.3V |
| DATA / OUT | 🟡 amarillo | GPIO15 (con pull-up 10kΩ a VCC) |
| GND (−) | 🟤 marrón | GND |

**Código:**
```cpp
#include <DHT.h>            // Librería del sensor (instalar: "DHT sensor library")

#define PIN_DHT 15          // GPIO donde está el DATA
#define TIPO DHT22          // Cambiar a DHT11 si usás el DHT11

DHT dht(PIN_DHT, TIPO);     // Creamos el objeto sensor

void setup() {
  Serial.begin(115200);
  dht.begin();              // Iniciamos el sensor
}

void loop() {
  float temp = dht.readTemperature();   // Leemos temperatura en °C
  float hum  = dht.readHumidity();       // Leemos humedad en %

  // Verificamos que la lectura sea válida (a veces falla)
  if (isnan(temp) || isnan(hum)) {
    Serial.println("Error al leer el sensor!");
    return;
  }

  Serial.print("Temperatura: "); Serial.print(temp); Serial.print(" C  |  ");
  Serial.print("Humedad: "); Serial.print(hum); Serial.println(" %");
  delay(2000);              // El DHT necesita ~2 seg entre lecturas
}
```
`platformio.ini`: `lib_deps = adafruit/DHT sensor library`

**Errores comunes:** lecturas "nan" → falta el pull-up de 10kΩ entre DATA y VCC, o leíste muy rápido (esperá 2 seg). El DHT11 da temperatura sin decimales (es normal).

---

## HC-SR04 — Distancia (ultrasónico)

> ⚡ **Voltaje:** 5V · 📊 **Dificultad:** Básico · 📦 **Librería:** ninguna obligatoria

**¿Para qué sirve?** Mide distancia (2cm a 4m) rebotando ultrasonido, como un murciélago. Alarma de proximidad, robot que esquiva obstáculos, medidor de nivel de agua.

**Conexiones:**

| Pin | Cable | Va al ESP32 |
|-----|-------|-------------|
| VCC | 🔴 rojo | VIN (5V) |
| TRIG | 🟢 verde | GPIO5 |
| ECHO | 🔵 azul | GPIO18 **¡con divisor de tensión!** |
| GND | 🟤 marrón | GND |

> ⚠️ **ECHO entrega 5V** y el ESP32 aguanta 3.3V. Divisor: R1=1kΩ entre ECHO y el GPIO, R2=2kΩ entre el GPIO y GND. Sin esto, dañás el ESP32.

**Código:**
```cpp
const int TRIG = 5;
const int ECHO = 18;

void setup() {
  Serial.begin(115200);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
}

void loop() {
  // Mandamos un pulso de 10 microsegundos por TRIG
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);

  // Medimos cuánto tarda en volver el eco
  long duracion = pulseIn(ECHO, HIGH);
  // distancia = (tiempo * velocidad del sonido) / 2
  float distancia = duracion * 0.034 / 2;   // en cm

  Serial.print("Distancia: "); Serial.print(distancia); Serial.println(" cm");
  delay(200);
}
```

**Errores comunes:** siempre 0 o valores locos → revisá el divisor de tensión y que TRIG/ECHO no estén cruzados. No apuntes a superficies blandas (absorben el ultrasonido).

---

## LDR — Sensor de luz (fotorresistencia)

> ⚡ **Voltaje:** 3.3V · 📊 **Dificultad:** Básico · 📦 **Librería:** ninguna

**¿Para qué sirve?** Mide cuánta luz hay. Su resistencia baja con más luz. Luz automática (se prende de noche), seguidor solar, alarma de "se abrió la heladera".

**Conexiones (divisor con resistencia de 10kΩ):**

| Conexión | Va al ESP32 |
|----------|-------------|
| Una pata del LDR | 🔴 3.3V |
| Otra pata del LDR + resistencia 10kΩ | 🟣 GPIO34 (analógico) |
| Otro extremo de la resistencia 10kΩ | 🟤 GND |

**Código:**
```cpp
const int PIN_LDR = 34;     // GPIO analógico (solo-entrada, ideal)

void setup() {
  Serial.begin(115200);
}

void loop() {
  int luz = analogRead(PIN_LDR);   // 0 (oscuro) a 4095 (mucha luz) en ESP32
  Serial.print("Nivel de luz: "); Serial.println(luz);

  if (luz < 1000) {
    Serial.println("Esta oscuro!");   // acá podrías prender un LED
  }
  delay(300);
}
```

**Dato clave:** en ESP32 `analogRead()` da **0-4095**; en Arduino UNO da **0-1023**. El LDR necesita la resistencia de 10kΩ para formar el "divisor de tensión" — solo no funciona.

---

## PIR (HC-SR501) — Movimiento

> ⚡ **Voltaje:** 5V · 📊 **Dificultad:** Básico · 📦 **Librería:** ninguna

**¿Para qué sirve?** Detecta movimiento de personas/animales por el calor (infrarrojo). Alarma, luz que se prende al pasar, contador de personas.

**Conexiones:**

| Pin | Cable | Va al ESP32 |
|-----|-------|-------------|
| VCC | 🔴 rojo | VIN (5V) |
| OUT | 🟢 verde | GPIO13 |
| GND | 🟤 marrón | GND |

> ⚠️ Muchos módulos PIR dan **5V en OUT**. Verificá el tuyo: si da 5V, usá divisor de tensión antes del GPIO (igual que el HC-SR04).

**Código:**
```cpp
const int PIN_PIR = 13;
const int PIN_LED = 2;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  int hayMovimiento = digitalRead(PIN_PIR);   // HIGH = detectó movimiento
  if (hayMovimiento == HIGH) {
    Serial.println("Movimiento detectado!");
    digitalWrite(PIN_LED, HIGH);
  } else {
    digitalWrite(PIN_LED, LOW);
  }
  delay(100);
}
```

**Errores comunes:** dispara solo / no para → el PIR tarda **30-60 seg en calibrarse** al encender (dejalo quieto). Tiene dos perillas: una ajusta la sensibilidad, otra el tiempo que queda activo.

---

## KY-038 / KY-037 — Sonido

> ⚡ **Voltaje:** 3.3V-5V · 📊 **Dificultad:** Intermedio · 📦 **Librería:** ninguna

**¿Para qué sirve?** Detecta ruido/sonido. Aplauso que prende la luz, alarma de ruido. Tiene salida digital (D0: hay ruido o no) y analógica (A0: nivel).

**Conexiones (salida digital, la fácil):**

| Pin | Cable | Va al ESP32 |
|-----|-------|-------------|
| VCC | 🔴 rojo | 3.3V |
| GND | 🟤 marrón | GND |
| DO (digital) | 🟢 verde | GPIO4 |

**Código:**
```cpp
const int PIN_SONIDO = 4;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_SONIDO, INPUT);
}

void loop() {
  if (digitalRead(PIN_SONIDO) == HIGH) {
    Serial.println("Ruido detectado!");
  }
  delay(50);
}
```

**Tip:** el módulo tiene un potenciómetro azul para ajustar el umbral (qué tan fuerte tiene que ser el ruido). Giralo con un destornillador hasta que dispare bien.

---

## Resumen rápido (cuál pin usar)

| Sensor | Tipo de lectura | Pin sugerido ESP32 | Voltaje |
|--------|-----------------|--------------------|---------|
| DHT11/22 | digital especial | GPIO15 | 3.3V |
| HC-SR04 | digital (pulso) | TRIG 5, ECHO 18 + divisor | 5V |
| LDR | analógica | GPIO34 + resistencia 10kΩ | 3.3V |
| PIR | digital | GPIO13 | 5V |
| Sonido | digital | GPIO4 | 3.3V |

Recordá: pines analógicos del ESP32 = GPIO32-39 (los 34/35 son solo-entrada, ideales). `analogRead()` da 0-4095.
