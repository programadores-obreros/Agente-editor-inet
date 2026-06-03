---
name: actuadores
description: Actuadores para Arduino y ESP32 - servo motor SG90, módulo relé 1 canal, bomba de agua, electroválvula (solenoide), motor DC + driver L298N (puente H), driver ULN2003, lámpara/foco 220V vía relé, radiador/calefactor 220V vía relé. Cómo conectarlos, código comentado en español, errores comunes y advertencias de voltaje (incluye seguridad 220V).
---

# Actuadores — componentes que MUEVEN o ACCIONAN

Los actuadores son los componentes que hacen que pase algo en el mundo físico: mover un brazo, hacer sonar una alarma, encender una luz de 220V, girar un motor.

Cada componente de esta biblioteca sigue la **misma estructura** para que sea fácil de seguir: voltaje, dificultad, librería, para qué sirve, conexiones (con colores de cable), diagrama, código comentado, errores comunes y cómo probarlo.

Cuando muestres conexiones, usá también el skill `diagramas-conexion` (dibujo ASCII + colores de cable).

---

## Servo motor SG90

> ⚡ **Voltaje:** 4.8V–6V (alimentar con 5V). En ESP32: alimentá el servo de 5V (pin VIN/5V), la señal de control de 3.3V funciona bien.
> 📊 **Dificultad:** Básico
> 📦 **Librería:** `Servo.h` (Arduino) / `ESP32Servo.h` (ESP32)

### ¿Para qué sirve?

Es un motorcito que se mueve a un ángulo exacto entre 0° y 180° y se queda ahí. Sirve para brazos robóticos, barreras, timones, señalización de semáforos — todo lo que necesite moverse a una posición controlada.

### Conexiones

El SG90 tiene 3 cables con colores fijos de fábrica:

| Cable del servo | Color de fábrica | Va conectado a (Arduino UNO) |
|-----------------|------------------|------------------------------|
| GND             | ⚫ Marrón        | GND                          |
| Alimentación    | 🔴 Rojo          | 5V                           |
| Señal           | 🟡 Naranja       | pin 9 (debe ser PWM, con ~)  |

> En **ESP32**: el cable marrón a GND, el rojo a **5V/VIN** (NO a 3.3V, el servo necesita 5V para tener fuerza), el naranja a cualquier GPIO (ej: GPIO18).

### Diagrama

```
   Arduino UNO              Servo SG90
  ┌───────────┐            ┌─────────┐
  │      5V   ├───🔴───────┤ Rojo    │
  │      GND  ├───⚫───────┤ Marrón  │
  │      pin9 ├───🟡───────┤ Naranja │  (señal PWM)
  └───────────┘            └─────────┘
```

### Código mínimo (Arduino UNO)

```cpp
#include <Servo.h>          // Librería para controlar servos

Servo miServo;              // Creamos un objeto servo

void setup() {
  miServo.attach(9);        // El servo está conectado al pin 9
}

void loop() {
  miServo.write(0);         // Movemos el servo a 0 grados
  delay(1000);              // Esperamos 1 segundo
  miServo.write(90);        // Lo movemos a 90 grados (centro)
  delay(1000);
  miServo.write(180);       // Lo movemos a 180 grados
  delay(1000);
}
```

### Código mínimo (ESP32)

Casi igual, pero con la librería del ESP32:

```cpp
#include <ESP32Servo.h>     // Librería de servos para ESP32 (instalar desde el gestor de librerías)

Servo miServo;

void setup() {
  miServo.attach(18);       // El servo está en GPIO18
}

void loop() {
  miServo.write(0);
  delay(1000);
  miServo.write(180);
  delay(1000);
}
```

En `platformio.ini`, agregá la librería:
```ini
lib_deps =
    madhephaestus/ESP32Servo   ; para ESP32
    ; arduino-libraries/Servo  ; para Arduino UNO
```

### Errores comunes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| El servo tiembla o no llega bien al ángulo | Lo alimentás del pin de datos o de 3.3V | Alimentá el rojo de 5V, no de 3.3V |
| Se reinicia el Arduino/ESP32 al mover el servo | El servo consume mucho y baja la tensión | Alimentá el servo de una fuente externa de 5V, GND común con la placa |
| No se mueve nada | El cable de señal no está en un pin que sirva | En Arduino UNO usá un pin PWM (con ~); en ESP32 cualquier GPIO |
| `'Servo' was not declared` | Falta la librería | Agregá `#include <Servo.h>` (o `ESP32Servo.h`) y la dependencia en platformio.ini |

### Cómo probar que funciona

Subí el código y mirá el servo: debería moverse entre las posiciones cada segundo. Si se mueve y se queda firme en cada ángulo, está perfecto. Si tiembla, es casi siempre tema de alimentación (pasá a 5V o fuente externa).

### Para la clase

El servo es ideal para el primer proyecto "que se mueve". Proyectos típicos: barrera de estacionamiento, brazo que saluda, indicador de un medidor. Como se mueve a ángulos exactos, sirve para enseñar el concepto de `map()` (convertir un valor de sensor en un ángulo).

---

## Módulo Relé (1 canal)

> ⚡ **Voltaje:** bobina 5V (VCC a 5V/VIN). El pin IN lo maneja un GPIO. En ESP32 el IN suele activarse con 3.3V, pero algunos módulos piden 5V (ahí va un transistor o un módulo pensado para 3.3V).
> 📊 **Dificultad:** Básico
> 📦 **Librería:** ninguna (se usa `digitalWrite`)

### ¿Para qué sirve?

Es un **interruptor que el micro controla con un pin**. El Arduino/ESP32 no puede prender directamente cargas de potencia (una bomba, una lámpara, un motor, 220V): no tiene fuerza y se quemaría. El relé es como un "ayudante con músculos": el micro le da una orden chiquita por el pin IN y el relé conmuta la carga grande.

### Conexiones

El relé tiene dos lados: el lado de **control** (mira al micro) y el lado de **potencia** (la bornera con tornillos donde va la carga).

| Pin del relé | Color de cable | Va conectado a (Arduino UNO) |
|--------------|----------------|------------------------------|
| VCC          | 🔴 Rojo        | 5V                           |
| GND          | ⚫ Negro        | GND                          |
| IN           | 🟡 Amarillo    | un GPIO (ej: pin 7)          |

Lado de **potencia** (bornera de tornillos, NO va al micro):

| Borne | Significado | Para qué |
|-------|-------------|----------|
| COM   | Común       | entrada de la carga |
| NO    | Normal Abierto | sin energía está abierto; el relé lo CIERRA al activarse |
| NC    | Normal Cerrado | sin energía está cerrado; el relé lo ABRE al activarse |

> En **ESP32**: VCC al pin **5V/VIN**, GND a GND, IN a cualquier GPIO (ej: GPIO23). Ojo: muchos módulos activan el IN con 3.3V sin problema, pero algunos necesitan 5V en el IN. Si tu relé "no engancha" desde el ESP32, usá un transistor para subir la señal o conseguí un módulo de 3.3V.

### Diagrama

```
   Arduino UNO              Módulo Relé              Carga
  ┌───────────┐            ┌─────────┐           (lámpara, bomba…)
  │      5V   ├───🔴───────┤ VCC     │           ┌──────────┐
  │      GND  ├───⚫───────┤ GND     │   COM ────┤          │
  │      pin7 ├───🟡───────┤ IN      │   NO  ────┤  carga   │
  └───────────┘            │  [bobina]           └──────────┘
                           └─────────┘
       lado control (micro)      lado potencia (carga)
```

### Código mínimo (Arduino UNO)

```cpp
const int PIN_RELE = 7;        // El IN del relé está en el pin 7

void setup() {
  pinMode(PIN_RELE, OUTPUT);   // El pin controla el relé como salida
  digitalWrite(PIN_RELE, LOW); // Arrancamos con el relé en reposo
}

void loop() {
  digitalWrite(PIN_RELE, HIGH); // Activamos el relé (¡ojo si es activo-bajo!)
  delay(2000);                  // Lo dejamos 2 segundos
  digitalWrite(PIN_RELE, LOW);  // Lo soltamos
  delay(2000);
}
```

> ⚠️ Muchos módulos son **ACTIVO-BAJO**: se activan con `digitalWrite(PIN_RELE, LOW)` y descansan con `HIGH`. Si tu relé hace lo contrario de lo que esperás, invertí los niveles.

### Errores comunes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| El relé hace clic al revés de lo que pido | El módulo es activo-bajo | Invertí: `LOW` para activar, `HIGH` para soltar |
| No hace clic nunca | Falta VCC/GND o el IN no llega bien (ESP32 con 3.3V) | Revisá VCC a 5V, GND común; en ESP32 usá transistor o módulo de 3.3V |
| ⚡ La placa se resetea o hay peligro al cablear 220V | Cableaste la red energizada | **NUNCA** cablees los 220V con el circuito enchufado |

> ⚡ **SEGURIDAD:** el lado de 220V lo conecta **SIEMPRE un adulto/profesor**, con todo desenergizado y los cables bien aislados. La red eléctrica mata. Esto no es negociable.

### Cómo probar que funciona

Cargá el código y escuchá: el relé debe hacer "clic… clic…" cada 2 segundos. Casi todos traen un LED que se prende cuando está activo. Para empezar, NO conectes nada en la bornera de potencia: probá solo que el relé conmute. Una vez que escuchás el clic rítmico, el control anda.

### Para la clase

El relé es el puente entre "el mundo de 5V del micro" y "el mundo de potencia". Enseña el concepto clave: el micro **decide**, otro componente **acciona**. Proyectos: encender una lámpara, una bomba de riego, un cartel. Es la base de la domótica del INET.

---

## Bomba de agua (mini sumergible / diafragma)

> ⚡ **Voltaje:** típico 3–6V (mini sumergible) o 12V (diafragma). Consume **mucha corriente**, NO va directo al micro.
> 📊 **Dificultad:** Intermedio
> 📦 **Librería:** ninguna (se controla el relé o el transistor que la enciende)

### ¿Para qué sirve?

Mueve agua: riego automático, llenado de tanques, sistemas acuapónicos, fuentes. **Acá hay una regla de oro**: la bomba NO se conecta directo al Arduino. Tira mucha corriente y, si la alimentás del pin de la placa, la tensión cae y el micro se reinicia (o se quema). Va siempre con **fuente externa**, conmutada por un **relé** o un **transistor/MOSFET**.

### Conexiones

El micro NO toca la bomba. El micro maneja el relé, y el relé deja pasar la corriente de la fuente externa hacia la bomba.

| Elemento | Va conectado a |
|----------|----------------|
| GPIO del micro | IN del relé (ver sección Módulo Relé) |
| Bomba (+) | NO/COM del relé, en serie con la fuente externa |
| Bomba (−) | GND de la fuente externa |
| Fuente externa | alimenta la bomba (NO el pin 5V del Arduino) |

> En **ESP32**: igual. El GPIO maneja el relé; la bomba siempre con fuente aparte. GND de la fuente y GND del ESP32 **en común** si usás transistor.

### Diagrama

```
   Micro            Relé              Fuente externa     Bomba
  ┌──────┐        ┌──────┐           (3-6V o 12V)      ┌──────┐
  │ GPIO ├──🟡────┤ IN   │   COM ────── (+) ───────────┤ +    │
  │ GND  ├──⚫────┤ GND  │   NO  ───────────────────────┤      │
  │ 5V   ├──🔴────┤ VCC  │           (−) ───────────────┤ −    │
  └──────┘        └──────┘                              └──────┘
                            (la bomba NUNCA del pin del micro)
```

### Código mínimo (Arduino UNO)

```cpp
const int PIN_BOMBA = 7;          // Pin que controla el relé de la bomba

void setup() {
  pinMode(PIN_BOMBA, OUTPUT);     // Salida hacia el relé
  digitalWrite(PIN_BOMBA, LOW);   // Bomba apagada al arrancar
}

void loop() {
  digitalWrite(PIN_BOMBA, HIGH);  // Encendemos la bomba (vía relé)
  delay(3000);                    // Bombeamos 3 segundos
  digitalWrite(PIN_BOMBA, LOW);   // Apagamos
  delay(5000);                    // Esperamos 5 segundos
}
```

> Si controlás la bomba con un transistor en vez de un relé, agregá un **diodo flyback** en paralelo a la bomba: al cortar, la bomba genera un pico de tensión que puede dañar el transistor.

### Errores comunes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| El Arduino/ESP32 se reinicia al prender la bomba | Alimentás la bomba del pin 5V de la placa | Usá una **fuente externa**, nunca el pin del micro |
| La bomba no levanta agua | Superaste la altura/caudal máximo | Respetá la altura y el caudal que indica la bomba |
| El transistor se calienta o se quema | Falta el diodo flyback | Poné un diodo en paralelo a la bomba (catodo al +) |

### Cómo probar que funciona

Sumergí la mini bomba en un vaso de agua (las sumergibles NO funcionan en seco, se queman) y cargá el código. Debería bombear 3 segundos y parar 5. Si no levanta agua pero hace ruido, fijate la altura: estas bombas chicas suben poco.

### Para la clase

Es el actuador estrella del proyecto de **riego automático**: un sensor de humedad de suelo decide, y la bomba riega. Enseña la cadena completa sensor → decisión → actuador de potencia, y el porqué de las fuentes externas.

---

## Electroválvula (solenoide para agua)

> ⚡ **Voltaje:** típico 12V DC. NO va directo al micro: se maneja por **relé + fuente de 12V**.
> 📊 **Dificultad:** Intermedio
> 📦 **Librería:** ninguna

### ¿Para qué sirve?

Es una **canilla eléctrica**: abre o corta el paso del agua con una orden del micro. Sirve para riego, llenado de tanques, lavado automático. Como tiene una bobina que consume bastante y funciona a 12V, NUNCA se conecta directo al Arduino: va por relé con su fuente.

### Conexiones

| Elemento | Va conectado a |
|----------|----------------|
| GPIO del micro | IN del relé |
| Electroválvula | salida del relé (COM/NO), en serie con la fuente de 12V |
| Fuente 12V | alimenta la válvula |

> En **ESP32**: igual que con Arduino. El micro solo toca el IN del relé; la válvula va por la fuente de 12V.
>
> 👉 Para **riego conviene una válvula Normal Cerrada (NC)**: si se corta la energía o falla el micro, NO pasa agua (no inundás nada). Una Normal Abierta dejaría pasar agua sin energía.

### Diagrama

```
   Micro            Relé              Fuente 12V       Electroválvula
  ┌──────┐        ┌──────┐                            ┌──────────┐
  │ GPIO ├──🟡────┤ IN   │   COM ──── (+12V) ──────────┤ +        │
  │ GND  ├──⚫────┤ GND  │   NO  ──────────────────────┤          │
  │ 5V   ├──🔴────┤ VCC  │           (GND) ────────────┤ −        │
  └──────┘        └──────┘                            └──────────┘
                                            (válvula NC = sin energía, cerrada)
```

### Código mínimo (Arduino UNO)

```cpp
const int PIN_VALVULA = 7;          // Pin que controla el relé de la válvula

void setup() {
  pinMode(PIN_VALVULA, OUTPUT);     // Salida hacia el relé
  digitalWrite(PIN_VALVULA, LOW);   // Válvula cerrada al arrancar
}

void loop() {
  digitalWrite(PIN_VALVULA, HIGH);  // Abrimos el paso de agua (vía relé)
  delay(4000);                      // Dejamos pasar agua 4 segundos
  digitalWrite(PIN_VALVULA, LOW);   // Cortamos el agua
  delay(6000);
}
```

> ⚠️ Poné un **diodo flyback** en paralelo a la bobina de la válvula: al cortar, la bobina genera un pico de tensión que puede dañar el relé o el transistor.

### Errores comunes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| La válvula no abre | Falta la fuente de 12V o está mal el relé | Verificá la fuente de 12V y el clic del relé |
| Picos raros, el relé se daña | Falta el diodo flyback | Diodo en paralelo a la bobina (catodo al +) |
| Pasa agua sin energía / no pasa con energía | Confundiste NA con NC | Para riego usá **Normal Cerrada (NC)**; revisá la polaridad si es DC |

### Cómo probar que funciona

Conectá la válvula a una manguera con un poco de presión (canilla o tanque elevado) y cargá el código. Tenés que escuchar el "tac" de la bobina y ver pasar el agua 4 segundos sí, 6 no. Sin presión de agua puede que no notes nada aunque la bobina abra.

### Para la clase

Complementa la bomba en proyectos de riego e invernadero: la bomba **empuja** agua, la válvula **deja pasar o corta**. Enseña que un actuador no solo "mueve", también "habilita o bloquea" un flujo, y el concepto de estado seguro ante fallas (fail-safe con NC).

---

## Motor DC + driver L298N (puente H)

> ⚡ **Voltaje:** motor 3–12V (según el motor). El L298N maneja la potencia; el micro solo da señales. NUNCA conectes el motor directo al micro.
> 📊 **Dificultad:** Intermedio
> 📦 **Librería:** ninguna (`digitalWrite` + `analogWrite`), o librerías de motor

### ¿Para qué sirve?

Un motor DC gira para un lado o para el otro y a distintas velocidades, pero tira mucha corriente: el micro no lo aguanta. El **L298N es un puente H**: un módulo que controla hasta **2 motores** decidiendo el **sentido de giro** (pines IN1/IN2) y la **velocidad** (pin ENA con PWM). Sirve para ruedas de robot, ventiladores, cintas transportadoras.

### Conexiones

Para UN motor (canal A del L298N):

| Pin del L298N | Color de cable | Va conectado a (Arduino UNO) |
|---------------|----------------|------------------------------|
| IN1           | 🟢 Verde       | un GPIO (ej: pin 8) — sentido |
| IN2           | 🔵 Azul        | un GPIO (ej: pin 9) — sentido |
| ENA           | 🟡 Amarillo    | un pin PWM (ej: pin 10, con ~) — velocidad |
| OUT1 / OUT2   | —              | los dos cables del motor |
| +12V (VS)     | 🔴 Rojo        | (+) de la fuente del motor |
| GND           | ⚫ Negro        | GND de la fuente **Y** GND del Arduino (común) |

> En **ESP32**: IN1/IN2 a dos GPIOs cualquiera, ENA a un GPIO con PWM (en ESP32 casi todos lo soportan vía `ledc`/`analogWrite`). **GND común** entre ESP32, L298N y fuente del motor, si no, no anda.

### Diagrama

```
   Arduino UNO          Driver L298N            Motor DC
  ┌───────────┐        ┌──────────┐
  │      pin8 ├──🟢────┤ IN1      │  OUT1 ──────┐  ┌──────┐
  │      pin9 ├──🔵────┤ IN2      │             ├──┤ MOTOR│
  │     pin10 ├──🟡────┤ ENA(PWM) │  OUT2 ──────┘  └──────┘
  │      GND  ├──⚫────┤ GND  ┌── +12V ◄── (+) fuente motor
  └───────────┘        └──────┴── GND  ◄── (−) fuente motor
        ▲ GND COMÚN entre micro, driver y fuente (si no, NO funciona)
```

### Código mínimo (Arduino UNO)

```cpp
const int IN1 = 8;             // Sentido de giro (parte 1)
const int IN2 = 9;             // Sentido de giro (parte 2)
const int ENA = 10;            // Velocidad (PWM, pin con ~)

void setup() {
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(ENA, OUTPUT);
}

void loop() {
  // Giramos para un lado, a media velocidad
  digitalWrite(IN1, HIGH);     // IN1 alto + IN2 bajo = un sentido
  digitalWrite(IN2, LOW);
  analogWrite(ENA, 150);       // Velocidad 0–255 (150 = ~60%)
  delay(2000);

  // Giramos al revés, a velocidad máxima
  digitalWrite(IN1, LOW);      // IN1 bajo + IN2 alto = sentido contrario
  digitalWrite(IN2, HIGH);
  analogWrite(ENA, 255);       // Velocidad máxima
  delay(2000);

  // Freno
  digitalWrite(IN1, LOW);      // Ambos bajos = motor detenido
  digitalWrite(IN2, LOW);
  delay(1000);
}
```

### Errores comunes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| El motor no gira aunque las señales están bien | Falta GND común entre micro, driver y fuente | Uní TODOS los GND (micro + L298N + fuente) |
| La placa se resetea al arrancar el motor | Alimentás el motor del pin 5V | Usá fuente externa para el motor, nunca el pin 5V |
| Gira pero no cambia de velocidad | ENA conectado a un pin sin PWM, o el jumper de ENA puesto | Usá un pin PWM (~) y sacá el jumper de ENA |
| Ruido eléctrico / cuelgues raros | El motor "ensucia" la alimentación | Soldá capacitores cerámicos en los bornes del motor |

### Cómo probar que funciona

Con la fuente del motor conectada y el GND común, cargá el código: el motor gira 2 segundos para un lado, 2 para el otro y frena 1 segundo. Si gira siempre igual aunque cambies IN1/IN2, revisá el cableado de OUT1/OUT2 y el GND común.

### Para la clase

Es el corazón del **robot con ruedas**. Enseña dos conceptos juntos: sentido de giro (lógica digital con IN1/IN2) y velocidad (PWM con ENA). El GND común es la lección de oro de electrónica: "si las masas no se tocan, nada funciona".

---

## Driver ULN2003

> ⚡ **Voltaje:** 5V. Array de transistores Darlington (7 canales) con diodos de protección internos.
> 📊 **Dificultad:** Intermedio
> 📦 **Librería:** ninguna (o la del componente que maneje, ej: `Stepper.h`)

### ¿Para qué sirve?

El micro da señales **débiles** (poca corriente). El ULN2003 las **amplifica**: tiene 7 canales (IN1–IN7) que repiten cada señal pero con fuerza para mover relés, solenoides o un **motor paso a paso 28BYJ-48**. Es como 7 mini-interruptores controlados por el micro, todos en un solo chip, y ya trae diodos de protección adentro.

### Conexiones

| Pin del ULN2003 | Color de cable | Va conectado a (Arduino UNO) |
|-----------------|----------------|------------------------------|
| IN1–IN7         | 🟢 Verde       | GPIOs del micro (uno por canal que uses) |
| OUT1–OUT7       | —              | la carga (bobina, motor paso a paso, relé) |
| COM             | 🔴 Rojo        | (+) de la fuente de la carga |
| GND             | ⚫ Negro        | GND común (micro + fuente) |

> En **ESP32**: IN1–IN7 a GPIOs cualquiera. El módulo típico del 28BYJ-48 ya viene con el ULN2003 integrado en una plaquita lista para usar.

### Diagrama

```
   Micro            ULN2003 (7 canales)        Carga
  ┌──────┐        ┌──────────────┐
  │ GPIO ├──🟢────┤ IN1     OUT1 ├──────────── bobina / motor paso
  │ GPIO ├──🟢────┤ IN2     OUT2 ├──────────── ...
  │ GPIO ├──🟢────┤ IN3     OUT3 ├──────────── ...
  │ GND  ├──⚫────┤ GND      COM ├──🔴── (+) fuente carga
  └──────┘        └──────────────┘
        (amplifica señales débiles del micro; trae diodos internos)
```

### Código mínimo (Arduino UNO)

```cpp
const int IN1 = 8;             // Canal 1 del ULN2003

void setup() {
  pinMode(IN1, OUTPUT);        // El micro controla el canal como salida
  digitalWrite(IN1, LOW);
}

void loop() {
  digitalWrite(IN1, HIGH);     // Activamos el canal 1 (enciende su carga)
  delay(1000);
  digitalWrite(IN1, LOW);      // Lo apagamos
  delay(1000);
}
```

> Para mover un **motor paso a paso 28BYJ-48** con el ULN2003 (que es su uso más común), mirá el skill `modulos-avanzados`, sección "28BYJ-48 + ULN2003".

### Errores comunes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| Confundís el ULN2003 con un puente H | Esperás que invierta el giro del motor | El ULN2003 es de **un solo sentido**; para invertir giro necesitás un **puente H (L298N)** |
| La carga no se activa | Falta COM a la fuente o GND común | Conectá COM al (+) de la fuente y unificá los GND |
| Una salida no responde | Estás usando un canal/pin distinto al que cableaste | Verificá que el INx coincida con el OUTx que conectaste |

### Cómo probar que funciona

Conectá una carga simple (un LED con su resistencia, o un mini relé) a OUT1 y cargá el código: la carga prende 1 segundo y apaga 1 segundo. Si anda con el LED, el canal amplifica bien.

### Para la clase

Enseña la diferencia clave entre **amplificar** (ULN2003: da más fuerza a la misma señal) e **invertir sentido** (L298N: puente H). Es la introducción perfecta antes del motor paso a paso, el actuador más preciso del kit.

---

## Lámpara / foco 220V (vía relé)

> ⚡⚡ **PELIGRO 220V.** Voltaje del lado de control 5V (relé); el lado de la lámpara es **red eléctrica de 220V**. La lámpara NUNCA toca el micro.
> 📊 **Dificultad:** Avanzado
> 📦 **Librería:** ninguna (`digitalWrite` sobre el relé)

### ¿Para qué sirve?

Encender y apagar una lámpara de red (220V) desde el micro: domótica, iluminación automática, el clásico **proyecto lumínico del INET**. El ESP32/Arduino **NO toca los 220V jamás**: el micro controla un relé, y el relé es el único que conmuta la red.

### Conexiones

Lado de **control** (mira al micro, 5V — seguro):

| Pin del relé | Color de cable | Va conectado a (Arduino UNO) |
|--------------|----------------|------------------------------|
| VCC          | 🔴 Rojo        | 5V                           |
| GND          | ⚫ Negro        | GND                          |
| IN           | 🟡 Amarillo    | un GPIO (ej: pin 7)          |

Lado de **potencia** (220V — zona peligrosa, la cablea un adulto):

| Borne del relé | Va conectado a |
|----------------|----------------|
| COM | uno de los cables de la red 220V |
| NO  | en serie con la lámpara (se cierra al activar el relé) |

> En **ESP32**: VCC a 5V/VIN, GND a GND, IN a un GPIO (ej: GPIO23). El lado de 220V es idéntico y **lo conecta siempre un adulto**.

### Diagrama

```
  ZONA SEGURA (5V)                          ZONA PELIGROSA (220V) ⚡⚡
 ┌──────────────────────┐        ┌───────────────────────────────────┐
 │  Micro      Relé      │        │   COM ───── 220V (fase) ───────┐   │
 │ ┌──────┐  ┌────────┐  │        │                                │   │
 │ │ 5V   ├🔴┤ VCC     │  │        │   NO  ──── 💡 LÁMPARA ──── 220V │   │
 │ │ GND  ├⚫┤ GND     │  │        │             (neutro) ──────────┘   │
 │ │ pin7 ├🟡┤ IN      │  │        └───────────────────────────────────┘
 │ └──────┘  └────────┘  │            ▲ esta parte la conecta SIEMPRE
 └──────────────────────┘              un ADULTO, todo desenergizado
        el micro NUNCA cruza esta línea ──────────────────────────────
```

### Código mínimo (Arduino UNO)

```cpp
const int PIN_LAMPARA = 7;        // El IN del relé que enciende la lámpara

void setup() {
  pinMode(PIN_LAMPARA, OUTPUT);   // Controla el relé como salida
  digitalWrite(PIN_LAMPARA, LOW); // Lámpara apagada al arrancar
}

void loop() {
  digitalWrite(PIN_LAMPARA, HIGH); // Encendemos la lámpara (vía relé)
  delay(3000);                     // 3 segundos prendida
  digitalWrite(PIN_LAMPARA, LOW);  // Apagamos
  delay(3000);                     // 3 segundos apagada
}
```

> ⚠️ Si tu relé es **activo-bajo**, invertí: `LOW` enciende, `HIGH` apaga.

### Errores comunes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| ⚡⚡ Riesgo de descarga al cablear | Manipulaste los 220V con el circuito enchufado | **JAMÁS** toques la red energizada; que lo haga un adulto, todo desenchufado |
| El relé hace clic pero la lámpara no prende | Cableaste mal COM/NO o el relé es activo-bajo | Revisá COM y NO; probá invertir el nivel del IN |
| La lámpara prende al revés de lo que pido | Relé activo-bajo | Invertí los niveles en el código |

> ⚡⚡ **SEGURIDAD (lo más importante de esta sección):** la parte de 220V la conecta **SIEMPRE un adulto/profesor**, con todo **desenergizado**, los cables **bien aislados** y dentro de una **caja**. El alumno programa y prueba el lado de 5V; el lado de la red NO se toca nunca con la placa ni con las manos.

### Cómo probar que funciona

Primero probá SOLO el control: sin nada en los 220V, escuchá el clic del relé cada 3 segundos. Recién cuando el control anda perfecto, **un adulto** cablea la lámpara desenergizada, cierra la caja, y ahí sí se enchufa para ver la lámpara prender y apagar.

### Para la clase

Es el salto a la **domótica real**: encender luces de verdad desde el micro. Enseña el respeto por la electricidad de red y la separación entre zona de control (segura) y zona de potencia (peligrosa). Proyecto lumínico clásico del INET.

---

## Radiador / Calefactor eléctrico (vía relé)

> ⚡⚡ **PELIGRO 220V** (igual que la lámpara) **y ALTA CORRIENTE.** Un relé chico (10A) NO alcanza para un calefactor de 2000W: hace falta un relé o **contactor del amperaje correcto**.
> 📊 **Dificultad:** Avanzado
> 📦 **Librería:** ninguna para el relé; un sensor de temperatura (DHT11/NTC) para el termostato

### ¿Para qué sirve?

Encender un radiador/calefactor de red según la temperatura: un **termostato automático**. El micro lee la temperatura (con un DHT11 o un NTC) y, si **baja del umbral** (hace frío), activa el relé que enciende el calefactor. Proyecto de **calefacción del INET**. Igual que la lámpara, el micro NUNCA toca los 220V.

### Conexiones

Lado de **control** (5V — seguro), idéntico al relé:

| Pin del relé | Color de cable | Va conectado a (Arduino UNO) |
|--------------|----------------|------------------------------|
| VCC          | 🔴 Rojo        | 5V                           |
| GND          | ⚫ Negro        | GND                          |
| IN           | 🟡 Amarillo    | un GPIO (ej: pin 7)          |

Lado de **potencia** (220V de ALTA CORRIENTE — adulto):

| Borne | Va conectado a |
|-------|----------------|
| COM | la red 220V (fase) |
| NO  | en serie con el calefactor |

> ⚠️ Un calefactor de 2000W a 220V tira ~9A: en el límite de un relé de 10A y peligroso a largo plazo. Para cargas grandes usá un **contactor** o un relé del amperaje adecuado, no el relecito de placa.
>
> En **ESP32**: control igual (IN a un GPIO). El sensor de temperatura y el lado de 220V se cablean igual.

### Diagrama

```
  ZONA SEGURA (5V)                          ZONA PELIGROSA (220V) ⚡⚡
 ┌───────────────────────┐       ┌────────────────────────────────────┐
 │ Sensor   Micro   Relé  │       │  COM ───── 220V (fase) ──────────┐  │
 │ (DHT11)┌──────┐┌──────┐│       │                                  │  │
 │   ╲    │ pin2 ││ VCC  ├🔴      │  NO ── 🔥 CALEFACTOR/RADIADOR ─220V │  │
 │    └───┤ pin7 ┼┤ IN   ││       │        (neutro) ─────────────────┘  │
 │        │ GND  ┼┤ GND  ││       └────────────────────────────────────┘
 │        └──────┘└──────┘│           ▲ relé/contactor del AMPERAJE OK
 └───────────────────────┘             y conectado SIEMPRE por un ADULTO
        el micro NUNCA cruza esta línea ───────────────────────────────
```

### Código mínimo (Arduino UNO)

```cpp
#include <DHT.h>                  // Librería del sensor de temperatura DHT11

#define PIN_DHT 2                 // El DHT11 está en el pin 2
#define TIPO_DHT DHT11
DHT dht(PIN_DHT, TIPO_DHT);

const int PIN_CALEFACTOR = 7;     // El IN del relé del calefactor
const float UMBRAL = 18.0;        // Umbral en °C: si baja de esto, calienta

void setup() {
  pinMode(PIN_CALEFACTOR, OUTPUT);
  digitalWrite(PIN_CALEFACTOR, LOW); // Calefactor apagado al arrancar
  dht.begin();                       // Iniciamos el sensor
}

void loop() {
  float temp = dht.readTemperature(); // Leemos la temperatura en °C

  if (temp < UMBRAL) {                // Si hace frío (baja del umbral)
    digitalWrite(PIN_CALEFACTOR, HIGH); // Encendemos el calefactor (vía relé)
  } else {                            // Si ya está templado
    digitalWrite(PIN_CALEFACTOR, LOW);  // Apagamos
  }

  delay(2000);                        // Medimos cada 2 segundos
}
```

> ⚠️ Si tu relé es **activo-bajo**, invertí los niveles. Para evitar que prenda/apague mil veces cerca del umbral, conviene una **histéresis** (encender por debajo de 18°C, apagar recién por encima de 20°C).

### Errores comunes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| ⚡⚡ El relé se quema o se recalienta | El relé es chico para la corriente del calefactor | Usá un **relé/contactor del amperaje correcto** (un 2000W tira ~9A) |
| ⚡⚡ Riesgo eléctrico al cablear | Manipulaste los 220V energizado | **JAMÁS**; que lo cablee un adulto con todo desenchufado |
| El calefactor prende y apaga sin parar | Estás justo en el umbral | Agregá histéresis (umbral de encendido y otro de apagado) |
| Lee `nan` la temperatura | El DHT11 no responde | Revisá el cableado del sensor y esperá 2 s entre lecturas |

> ⚡⚡ **SEGURIDAD:** mismo criterio que la lámpara, **agravado por la corriente**. La parte de 220V la conecta **SIEMPRE un adulto/profesor**, con todo desenergizado, dentro de caja y con un relé/contactor del amperaje adecuado. Un calefactor mal dimensionado puede recalentar cables y provocar un incendio.

### Cómo probar que funciona

Probá primero el lado de control sin los 220V: enfriá el sensor (acercale algo frío) y mirá que el relé haga clic cuando la temperatura baja del umbral; calentalo (con la mano) y que se suelte. Recién con el control validado, **un adulto** cablea el calefactor desenergizado.

### Para la clase

Es el termostato del proyecto de **calefacción del INET**: cierra el lazo sensor → decisión → actuador. Enseña control por umbral, histéresis y, sobre todo, dimensionar la potencia: no es lo mismo prender un LED que 2000W de red.

---

<!--
PLANTILLA para agregar nuevos actuadores (copiar y completar):

## Nombre del componente

> ⚡ Voltaje: ...
> 📊 Dificultad: Básico / Intermedio / Avanzado
> 📦 Librería: ...

### ¿Para qué sirve?
(1-2 líneas en español simple)

### Conexiones
(tabla con colores de cable 🔴 rojo=+, ⚫ negro=GND, 🟡🟢🔵 señal)

### Diagrama
(dibujo ASCII, ver skill diagramas-conexion)

### Código mínimo (Arduino UNO)
(comentado línea por línea en español)

### Código mínimo (ESP32)
(solo si hay diferencias)

### Errores comunes
(tabla síntoma / causa / solución — los 3-4 típicos del aula)

### Cómo probar que funciona
(cómo sabe el alumno que anduvo)

### Para la clase
(proyectos donde se usa, concepto que enseña)
-->
