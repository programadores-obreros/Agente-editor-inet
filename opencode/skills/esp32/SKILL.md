---
name: esp32
description: Programación ESP32 con GPIO, diferencias con Arduino UNO, WiFi básico y advertencias de voltaje 3.3V
---

# ESP32 — Guia para principiantes

Este skill cubre programacion del ESP32 desde cero, en español. Presupone que ya conoces lo basico de Arduino.

## Diferencias clave vs Arduino UNO

| Caracteristica | Arduino UNO | ESP32 |
|----------------|-------------|-------|
| Voltaje de trabajo | **5V** | **3.3V** |
| CPU | 16 MHz, 1 nucleo | 240 MHz, 2 nucleos |
| WiFi / Bluetooth | No | Si (integrado) |
| Pines analogicos | A0-A5 (entrada) | GPIO32-GPIO39 (solo entrada) |
| Corriente maxima por pin | 40 mA | 12 mA |
| Memoria RAM | 2 KB | 520 KB |
| Precio aprox. | $5-8 USD | $4-6 USD |

> **ADVERTENCIA IMPORTANTE — leer antes de conectar cualquier componente:**
> El ESP32 trabaja a **3.3V**. Conectarle componentes que usen 5V en sus pines de señal puede **dañarlo de forma permanente**. Esto incluye algunos sensores y modulos que funcionan a 5V.
> Siempre verificar el voltaje de operacion de cada componente antes de conectarlo.

---

## GPIO del ESP32

**Pines seguros para principiantes:** GPIO2, GPIO4, GPIO5, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO21, GPIO22, GPIO23, GPIO25, GPIO26, GPIO27.

**Pines con restricciones (NO usar al inicio):**
| Pin | Problema |
|-----|---------|
| GPIO0 | Controla el modo de boot. Si esta en LOW al encender, entra en modo de programacion. |
| GPIO2 | Debe estar en LOW al arrancar. Tiene LED integrado en muchas placas. |
| GPIO6 al GPIO11 | Conectados a la memoria flash interna. Usarlos puede causar reinicios. |
| GPIO34-GPIO39 | Solo entrada, sin pull-up/pull-down interno. |

---

## Componentes basicos

### LED en ESP32

**Para que sirve?** Igual que en Arduino, pero con resistencia de 330 ohm porque el voltaje es 3.3V (no 5V).

**Pines:**
| Pin del LED | Conexion |
|-------------|----------|
| Anodo (pata larga) | Resistencia 330 ohm → GPIO del ESP32 |
| Catodo (pata corta) | GND |

**Codigo minimo:**
```cpp
const int PIN_LED = 2;  // GPIO2 tiene LED integrado en muchas placas ESP32

void setup() {
  pinMode(PIN_LED, OUTPUT);  // Configuramos el pin como salida
}

void loop() {
  digitalWrite(PIN_LED, HIGH);  // Encendemos el LED
  delay(1000);                   // Esperamos 1 segundo
  digitalWrite(PIN_LED, LOW);   // Apagamos el LED
  delay(1000);
}
```

---

### Boton en ESP32

**Pines:**
| Pin del boton | Conexion |
|---------------|----------|
| Un lado | GPIO del ESP32 |
| El otro lado | GND |

**Codigo minimo:**
```cpp
const int PIN_BOTON = 4;  // GPIO4 — pin seguro para principiantes
const int PIN_LED = 2;

void setup() {
  pinMode(PIN_BOTON, INPUT_PULLUP);  // Resistencia pull-up interna: sin boton = HIGH, con boton = LOW
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  if (digitalRead(PIN_BOTON) == LOW) {  // Boton presionado
    digitalWrite(PIN_LED, HIGH);
  } else {
    digitalWrite(PIN_LED, LOW);
  }
}
```

---

### Monitor serial en ESP32

**Diferencia con Arduino UNO:** el ESP32 usa **115200 baudios** por defecto (no 9600).

```cpp
void setup() {
  Serial.begin(115200);  // Velocidad estandar del ESP32
  Serial.println("ESP32 listo!");
}

void loop() {
  Serial.println("Ejecutando...");
  delay(1000);
}
```

En el monitor serial, asegurate de seleccionar **115200 baudios**.

---

## WiFi basico

El ESP32 tiene WiFi integrado. Con la libreria `WiFi.h` (incluida en el framework Arduino para ESP32) podes conectarte a una red.

```cpp
#include <WiFi.h>  // Libreria WiFi del ESP32 — ya viene incluida, no necesitas instalarla

// Credenciales de la red WiFi
// IMPORTANTE: nunca subas este archivo a GitHub ni lo compartas — tiene tu contrasena
const char* SSID = "NombreDeTuRed";
const char* PASSWORD = "TuContrasena";

void setup() {
  Serial.begin(115200);

  WiFi.begin(SSID, PASSWORD);  // Iniciamos la conexion WiFi
  Serial.print("Conectando");

  // Esperamos hasta conectar (puede tardar unos segundos)
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");  // Imprimimos puntos mientras espera
  }

  // Cuando llega aqui, ya esta conectado
  Serial.println("\nConectado!");
  Serial.print("Direccion IP: ");
  Serial.println(WiFi.localIP());  // Mostramos la IP que le asigno el router
}

void loop() {
  // Tu codigo aqui — ya tenes WiFi disponible
}
```

> **Sobre las credenciales WiFi:** nunca las subas a un repositorio de GitHub u otro sistema de control de versiones. Si usas PlatformIO, podes guardarlas en un archivo separado que agregues al `.gitignore`.

---

## Estructura PlatformIO para ESP32

**platformio.ini** minimo para ESP32:
```ini
[env:esp32dev]
platform = espressif32       ; plataforma para chips ESP32 de Espressif
board = esp32dev             ; placa ESP32 generica (la mas comun)
framework = arduino          ; framework Arduino (setup/loop, igual que UNO)
monitor_speed = 115200       ; velocidad del monitor serial (diferente al UNO)
```

Para cargar el codigo al ESP32 con PlatformIO: a veces hay que apretar el boton **BOOT** de la placa mientras empieza la carga y soltarlo cuando aparece "Connecting..." en la consola.
