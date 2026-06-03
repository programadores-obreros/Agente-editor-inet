---
name: sensores
description: Sensores para Arduino y ESP32 - DHT11/DHT22 (temperatura y humedad), HC-SR04 (distancia), LDR (luz), PIR (movimiento), KY-038 (sonido), FC-28 (humedad de suelo / higrómetro), YL-83/FC-37 (lluvia), BMP180 (presión atmosférica / barómetro). Cómo conectarlos, código comentado en español, errores comunes.
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

## FC-28 — Humedad de suelo (higrómetro)

> ⚡ **Voltaje:** 3.3V o 5V · 📊 **Dificultad:** Básico · 📦 **Librería:** ninguna (`analogRead`)

**¿Para qué sirve?** Mide cuánta humedad tiene la tierra. Riego automático, invernadero, "avisame cuando la planta tenga sed". Tiene dos salidas: **AO** (analógica: el nivel de humedad, de seco a mojado) y **DO** (digital: seco/húmedo, según un potenciómetro de umbral que ajustás con un destornillador).

> 💡 La AO te da el valor exacto (ideal para escuela técnica, porque podés graficar y entender). La DO es solo "sí/no" pasó el umbral.

**Conexiones:**

| Pin | Cable | Va al ESP32 |
|-----|-------|-------------|
| VCC | 🔴 rojo | 3.3V (o 5V) |
| GND | 🟤 marrón | GND |
| AO (analógica) | 🟣 morado | GPIO34 (analógico, solo-entrada) |
| DO (digital, opcional) | 🟢 verde | cualquier GPIO digital |

```
   TIERRA
  ┌───────┐
  │ ║   ║ │   ← las dos patas metálicas (sonda) van en la tierra
  └─┼───┼─┘
    │   │
  ┌─┴───┴─┐
  │ módulo│  AO ──→ GPIO34 (analógico)
  │ compa-│  DO ──→ GPIO digital (opcional)
  │ rador │  VCC ─→ 3.3V/5V
  └───────┘  GND ─→ GND
```

**Código (Arduino UNO):**
```cpp
const int PIN_SUELO = A0;     // AO al pin analógico A0 (en ESP32: GPIO34/35)

void setup() {
  Serial.begin(9600);
}

void loop() {
  int humedad = analogRead(PIN_SUELO);   // 0-1023 en UNO (0-4095 en ESP32)
  // OJO: en muchos módulos, MENOS valor = MAS humedad (depende del modelo)
  Serial.print("Humedad de suelo: "); Serial.println(humedad);

  if (humedad > 700) {                    // umbral que vos calibrás (ver abajo)
    Serial.println("La tierra esta SECA -> regar");
  } else {
    Serial.println("La tierra esta HUMEDA");
  }
  delay(1000);
}
```
> **Nota ESP32:** usá un pin analógico real como **GPIO34 o GPIO35** (son solo-entrada, ideales) y `analogRead()` da **0-4095** en vez de 0-1023. Cambiá el umbral en proporción.

**Errores comunes:** ⚠️ **MUY IMPORTANTE** — el FC-28 resistivo (el de las dos patas metálicas) se **CORROE rápido** si queda siempre energizado: la corriente sobre el metal en tierra húmeda lo oxida en pocas semanas. Dos soluciones: (1) alimentalo desde un **GPIO** y prendelo SOLO el instante que medís (`digitalWrite(VCC, HIGH)` → medís → `digitalWrite(VCC, LOW)`), o (2) usá el modelo **CAPACITIVO** (no tiene metal expuesto, no se corroe — es la mejor opción). Además hay que **calibrarlo**: medí el valor con la sonda en seco (al aire) y con la sonda en un vaso de agua; esos son tus dos extremos, y ajustás el umbral en el medio.

---

## YL-83 / FC-37 — Sensor de lluvia

> ⚡ **Voltaje:** 3.3V o 5V · 📊 **Dificultad:** Básico · 📦 **Librería:** ninguna (`analogRead` / `digitalRead`)

**¿Para qué sirve?** Detecta gotas de agua. Estación meteorológica, cerrar ventanas/toldos solos cuando empieza a llover, avisar para descolgar la ropa. Tiene **dos partes**: la **placa colectora** (la plaquita con las pistas donde caen las gotas) y el **módulo comparador** (la electrónica). Salida **AO** (analógica: cuánta agua hay sobre la placa) y **DO** (digital: llueve / no llueve, con umbral ajustable por potenciómetro).

**Conexiones:**

| Pin | Cable | Va al ESP32 |
|-----|-------|-------------|
| VCC | 🔴 rojo | 3.3V (o 5V) |
| GND | 🟤 marrón | GND |
| AO (analógica) | 🟣 morado | GPIO35 (analógico) |
| DO (digital, opcional) | 🟢 verde | cualquier GPIO digital |

```
  💧 💧 💧
  ┌─────────┐
  │ ▓▓▓▓▓▓▓ │   ← placa colectora (afuera, donde cae la lluvia)
  └────┬────┘
       │ (2 cables)
  ┌────┴────┐
  │ módulo  │  AO ──→ GPIO35 (analógico)
  │ compa-  │  DO ──→ GPIO digital (opcional)
  │ rador   │  VCC ─→ 3.3V/5V
  └─────────┘  GND ─→ GND
```

**Código (Arduino UNO):**
```cpp
const int PIN_LLUVIA = A0;    // AO al pin analógico (en ESP32: GPIO35)

void setup() {
  Serial.begin(9600);
}

void loop() {
  int lluvia = analogRead(PIN_LLUVIA);   // 0-1023 en UNO (0-4095 en ESP32)
  // En general: MENOS valor = MAS agua sobre la placa (mojado)
  Serial.print("Nivel de lluvia: "); Serial.println(lluvia);

  if (lluvia < 400) {                     // umbral que vos ajustás
    Serial.println("Esta LLOVIENDO!");    // acá cerrarías la ventana
  } else {
    Serial.println("Seco");
  }
  delay(1000);
}
```
> **Nota ESP32:** mandá la AO a un pin analógico como **GPIO35 o GPIO34** y recordá que `analogRead()` da **0-4095**. Si solo querés "llueve / no llueve", usá la DO con `digitalRead()` en cualquier GPIO.

**Errores comunes:** la **placa colectora se oxida con el tiempo** (es normal, las pistas de cobre se gastan: es una pieza de repaso, se reemplaza). No la dejes mojada permanentemente. Mantené la **placa separada del módulo electrónico**: la placa va afuera expuesta a la lluvia, y el módulo comparador protegido (en una cajita), unidos por los dos cables.

---

## BMP180 — Presión atmosférica (barómetro) + temperatura

> ⚡ **Voltaje:** 3.3V (los módulos GY traen regulador y toleran 5V en VCC, pero el chip es de 3.3V) · 📊 **Dificultad:** Intermedio · 📦 **Librería:** `Adafruit BMP085 Library` (sirve para el BMP180)

**¿Para qué sirve?** Mide **presión atmosférica** y temperatura por bus **I2C**. Estación meteorológica, **predicción del tiempo** (si la presión baja, suele venir mal tiempo) y como **ALTÍMETRO** (la presión baja a medida que subís en altura, así que se calcula la altitud).

**Conexiones (bus I2C, dirección 0x77):**

| Pin | Cable | Va al ESP32 | En Arduino UNO |
|-----|-------|-------------|----------------|
| VCC | 🔴 rojo | 3.3V | 3.3V |
| GND | 🟤 marrón | GND | GND |
| SDA | 🟢 verde | GPIO21 | A4 |
| SCL | 🔵 azul | GPIO22 | A5 |

```
  ┌──────────┐
  │  BMP180  │  VCC ─→ 3.3V
  │  (I2C)   │  GND ─→ GND
  │  0x77    │  SDA ─→ A4 (UNO) / GPIO21 (ESP32)
  │          │  SCL ─→ A5 (UNO) / GPIO22 (ESP32)
  └──────────┘
```

**Código (Arduino UNO):**
```cpp
#include <Wire.h>             // Bus I2C (viene con el IDE)
#include <Adafruit_BMP085.h> // Librería: "Adafruit BMP085 Library" (sirve para BMP180)

Adafruit_BMP085 bmp;          // Creamos el objeto sensor

void setup() {
  Serial.begin(9600);
  if (!bmp.begin()) {         // Inicia el I2C y verifica que responda
    Serial.println("No encuentro el BMP180! Revisa SDA/SCL");
    while (1) {}              // se queda acá si no lo encuentra
  }
}

void loop() {
  Serial.print("Temperatura: "); Serial.print(bmp.readTemperature()); Serial.println(" C");
  Serial.print("Presion: ");     Serial.print(bmp.readPressure());    Serial.println(" Pa");
  // Altitud estimada respecto al nivel del mar (presion estandar)
  Serial.print("Altitud aprox: "); Serial.print(bmp.readAltitude()); Serial.println(" m");
  delay(2000);
}
```
`platformio.ini`: `lib_deps = adafruit/Adafruit BMP085 Library`

> **Nota ESP32:** SDA → **GPIO21** y SCL → **GPIO22** (los pines I2C por defecto). Alimentá VCC desde **3.3V**: aunque el módulo con regulador acepta 5V en VCC, el bus I2C del ESP32 es de **3.3V** y no le mandes 5V a SDA/SCL.

**Errores comunes:** ⚠️ **no lo confundas con el BMP280 ni el BME280** — son chips parecidos pero tienen **otra dirección I2C y otra librería** (la `Adafruit_BMP085` NO sirve para ellos). Si el bus no responde (`begin()` da error), poné **resistencias pull-up** (4.7kΩ-10kΩ) de SDA y SCL hacia VCC. Y recordá: el chip es de 3.3V; el regulador del módulo tolera 5V en VCC, pero el bus I2C del ESP32 sigue siendo de 3.3V.

---

## Resumen rápido (cuál pin usar)

| Sensor | Tipo de lectura | Pin sugerido ESP32 | Voltaje |
|--------|-----------------|--------------------|---------|
| DHT11/22 | digital especial | GPIO15 | 3.3V |
| HC-SR04 | digital (pulso) | TRIG 5, ECHO 18 + divisor | 5V |
| LDR | analógica | GPIO34 + resistencia 10kΩ | 3.3V |
| PIR | digital | GPIO13 | 5V |
| Sonido | digital | GPIO4 | 3.3V |
| FC-28 (humedad suelo) | analógica (AO) | GPIO34 | 3.3V/5V |
| YL-83/FC-37 (lluvia) | analógica (AO) | GPIO35 | 3.3V/5V |
| BMP180 (presión) | I2C (0x77) | SDA 21, SCL 22 | 3.3V |

Recordá: pines analógicos del ESP32 = GPIO32-39 (los 34/35 son solo-entrada, ideales). `analogRead()` da 0-4095.
