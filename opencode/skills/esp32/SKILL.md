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
| Pines analogicos | A0-A5 (entrada) | GPIO32-GPIO39 — **ojo: 32 y 33 son entrada Y salida**; solo 34, 35, 36 y 39 son solo-entrada |
| Corriente por pin — lo que dice la hoja de datos | 40 mA maximo absoluto; 20 mA especificado para funcionar | la hoja **no publica un maximo por pin** (los 40 mA que se repiten por ahi son el valor TIPICO a maxima fuerza de salida) |
| Corriente por pin — lo que usamos en el aula | aviso a 10 mA, nunca pasar 20 mA | aviso a 12 mA, nunca pasar 20 mA |
| Memoria RAM | 2 KB | 520 KB |
| Precio aprox. | $5-8 USD | $4-6 USD |

### Por que la corriente por pin lleva DOS filas

Porque son dos criterios distintos, y ponerlos en la misma fila hace que un numero suene tranquilizador cuando no lo es. Comparar "40 mA del UNO" contra "12 mA del ESP32" es comparar un **maximo absoluto** contra un **umbral de aviso**: parece que el UNO aguanta tres veces mas, y no es asi.

- **UNO:** los 40 mA son el maximo absoluto de la hoja del ATmega328P (§29.1 «Absolute Maximum Ratings») — el valor a partir del cual el propio fabricante avisa que el chip se puede danar de forma permanente. Lo que la hoja especifica para *funcionar* son 20 mA (§29.2 «DC Characteristics»).
- **ESP32:** la hoja de Espressif (ESP32 Series v5.2) **no publica un maximo por pin**. Lo unico que declara como absoluto es el acumulado de TODOS los pines juntos: 1200 mA (Tabla 5-1, `Ioutput`). Los 40 mA famosos son el valor tipico a maxima fuerza de salida, no un techo.
- Los 10, 12 y 20 mA son **margen nuestro** para uso escolar, no numeros de ninguna hoja. Estan puestos a proposito por debajo de lo especificado.

**Y ahora lo importante, que es lo que hay que contarle al alumno:** pasarse de 20 mA no revienta el pin en el momento. El pin **sigue andando**, pero fuera de especificacion. Y la falla caracteristica de ahi no es un pin muerto —eso se veria enseguida y por lo menos se aprenderia algo— sino un pin **DEGRADADO**: anda cinco meses y despues empieza a fallar intermitente. Ese modo de falla no ensena nada, porque es **indistinguible de un contacto flojo en la protoboard**, que es la primera cosa que un alumno va a sospechar y la unica que no es. El limite bajo no protege el pin de hoy: evita regalarle a la clase que viene una placa que miente.

> **ADVERTENCIA IMPORTANTE — leer antes de conectar cualquier componente:**
> El ESP32 trabaja a **3.3V**. Conectarle componentes que usen 5V en sus pines de señal puede **dañarlo de forma permanente**. Esto incluye algunos sensores y modulos que funcionan a 5V.
> Siempre verificar el voltaje de operacion de cada componente antes de conectarlo.

---

## GPIO del ESP32

**Pines seguros para principiantes:** GPIO4, GPIO5, GPIO18, GPIO19, GPIO21, GPIO22, GPIO23, GPIO25, GPIO26, GPIO27.

**Ojo con lo que se saco de esta lista.** Antes figuraban aca **GPIO2, GPIO12 y GPIO15**, y no van: los tres son *strapping pins*. El ESP32 les mira el nivel en el instante exacto del encendido para decidir **como** arranca, asi que lo que tengas colgado ahi no es un componente mas — es un voto sobre la configuracion de la placa. (La lista de arriba ademas es corta a proposito: hay mas GPIO utilizables, pero para empezar conviene quedarse en los que no tienen letra chica.)

**El peor de los tres es GPIO12.** Es la patita MTDI, y si esta en HIGH cuando le das corriente le dice al chip que la memoria flash trabaja a 1,8 V. Con eso la placa **NO BOOTEA**: no hay mensaje de error, no hay LED, no hay nada en el monitor serial. Cualquier cosa que lo lleve a HIGH al momento de encender —un pull-up, un modulo que entrega nivel alto, un LED cableado hacia el positivo— alcanza para dejar la placa muda, y el alumno va a jurar que la quemo.

**Pines con restricciones (NO usar al inicio):**
| Pin | Problema |
|-----|---------|
| GPIO0 | Strapping pin. Si esta en LOW al encender, la placa arranca en modo de descarga en vez de correr tu programa. |
| GPIO2 | Strapping pin, pero **NO** hace falta que este en LOW para arrancar: para el arranque normal es indiferente. Solo importa **acompanando a GPIO0 en LOW**, que es la combinacion del modo de descarga. Tiene el LED integrado en muchas placas. |
| GPIO12 | ⚠️ El mas peligroso. En HIGH al encender configura la flash a 1,8 V y la placa no arranca, sin avisar. |
| GPIO15 | Strapping pin: en LOW silencia el log de arranque por el serial. No rompe nada, pero te deja sin el mensaje que te iba a explicar que pasa. |
| GPIO6 al GPIO11 | Conectados a la memoria flash interna. Usarlos puede causar reinicios. |
| GPIO34, 35, 36 y 39 | **Solo entrada**, sin pull-up/pull-down interno. Sirven para leer (pote, LDR), no para manejar nada. |

**El malentendido mas repetido de todos los tutoriales:** "GPIO32 a GPIO39 son solo entrada". **Es falso.** Solo-entrada son cuatro: **34, 35, 36 y 39**. **GPIO32 y GPIO33 son entrada Y salida completos**, con pull-up y pull-down internos — podes leer un pote con ellos y tambien manejar un LED. Los metieron a todos en la misma bolsa porque los seis comparten el ADC1, pero compartir el conversor analogico no los convierte en solo-entrada.

---

## Componentes basicos

### LED en ESP32

**Para que sirve?** Igual que en Arduino — pero **la resistencia NO es la misma**, y esto es lo que hace que un alumno arme todo bien, revise todo tres veces, y el LED no prenda.

**El calculo es una division y nada mas:**

```
R = (tension de la fuente − Vf del LED) / corriente que queres
```

`Vf` es la caida de tension del LED. **No es un dato del color: es un dato del CHIP.** En una bolsa de LED de 5 mm el rango va de **1,8 V** (rojo GaAsP) a **3,6 V** (azul o verde InGaN).

**⚠️ El color NO te dice la tension.** El caso que lo demuestra: "verde" abarca de **1,9 a 3,6 V**. Un verde de GaP cae 2,1 V y un verde de InGaN cae 3,2 V, y **se ven identicos dentro de la caja**. No hay forma de distinguirlos mirando, ni preguntandole al que los vendio.

**Por que en el UNO esto no se nota y en el ESP32 arruina la clase:**

| Fuente | Con 330 Ω y un LED de 1,8 V | Con 330 Ω y un verde InGaN de 3,2 V |
|---|---|---|
| 5 V (Arduino UNO) | 9,7 mA — prende bien | 5,5 mA — prende bien |
| 3,3 V (ESP32) | 4,5 mA — prende, medio flojo | **0,3 mA — NO PRENDE** |

Sobre 5 V los 330 Ω andan con cualquier LED del rango: sobra tension para todos. Sobre 3,3 V no queda margen — al LED de 3,2 V le sobran 0,1 V, y 0,1 V sobre 330 Ω son 0,3 mA. El LED esta sano, el codigo esta bien, el cable esta bien, y no prende. Por eso "poné 330 y listo" es un consejo de 5 V que alguien copio a un mundo de 3,3 V.

**Que hacer, en orden:**

1. **Medi el Vf con el tester** (modo diodo, punta roja al anodo, negra al catodo). Es literalmente el unico modo de saberlo, y son diez segundos. Todo lo que sigue depende de ese numero.
2. Si cae **menos de 2,5 V** (rojo, amarillo, verde de los viejos): en 3,3 V usa **220 Ω**. Con un LED de 2,1 V eso da 5,5 mA — brillo normal de aula.
3. Si cae **3 V o mas** (azul, blanco, verde InGaN): sobre 3,3 V **no hay con que hacerlo andar decente**, y no es un problema de elegir mejor la resistencia: no queda tension. Pasalo al UNO, o alimentalo desde VIN (5 V) manejandolo con un transistor — nunca colgado directo del GPIO.
4. **Nunca bajes de 100 Ω en 3,3 V.** Con el LED mas "facil" del rango (1,8 V), 100 Ω ya dan 15 mA, que es el umbral de aviso; el tope duro son 20 mA, tanto para el LED como para el pin.

**Para el alumno:** "El color del LED es como el color de una remera: no te dice cuanto pesa el que la usa. Antes de calcular la resistencia, medi el LED con el tester. Si no, estas adivinando — y en 3,3 voltios adivinar mal significa que no prende y vas a pensar que rompiste algo."

**Pines:**
| Pin del LED | Conexion |
|-------------|----------|
| Anodo (pata larga) | Resistencia calculada (ver arriba) → GPIO del ESP32 |
| Catodo (pata corta) | GND |

**Codigo minimo:**
```cpp
// GPIO4 — pin seguro para principiantes.
// (GPIO2 tiene el LED integrado y sirve para una prueba rapida, pero es strapping
//  pin: para un LED EXTERNO conviene usar otro y dejarlo tranquilo.)
const int PIN_LED = 4;

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
const int PIN_BOTON = 4;   // GPIO4 — pin seguro para principiantes
const int PIN_LED = 5;     // GPIO5 — otro de los pines seguros de la lista de arriba

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
