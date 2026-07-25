---
name: comunicacion-serial
description: Comunicación serial entre la computadora y la placa (Arduino UNO / ESP32) por el cable USB. Cómo VER los datos que manda la placa (monitor serial) y cómo MANDARLE datos o teclas para comandarla (ejemplo clásico - mover un servo con el teclado). Cubre Serial.begin / Serial.print / Serial.read, los baudios, cómo abrir el monitor serial con Tecnia Bot, el sketch de un servo controlado por teclado, y los errores comunes (baudios que no coinciden = caracteres raros, puerto ocupado, no llega nada).
---

# Comunicación serial — la placa y la compu se hablan

La **comunicación serial** es el ida y vuelta entre la computadora y la placa (Arduino UNO / ESP32) por el cable USB. Es una de las cosas más útiles y que más se usan, porque te deja **ver qué está haciendo la placa** y **mandarle órdenes**.

Tiene **dos direcciones**, y es importante no confundirlas:

1. **Placa → compu (LEER):** la placa manda datos y vos los ves. Ejemplo: la lectura de un sensor, un mensaje de "estoy funcionando", un valor de debug.
2. **Compu → placa (MANDAR):** vos le mandás datos a la placa y ella reacciona. Ejemplo: apretás una tecla y un servo se mueve.

Cuando muestres el cableado de un componente, usá también el skill `actuadores` o `sensores`, y `diagramas-conexion` para el dibujo.

---

## Las tres funciones que hay que conocer

Todo pasa por el objeto `Serial` en el código. Con tres funciones alcanza para casi todo:

> 📦 **Librería:** ninguna extra — `Serial` viene incluido en Arduino/ESP32.

### 1. `Serial.begin(baudios)` — abrir la conversación

Va en el `setup()`. Prende la comunicación y fija la **velocidad** (los baudios).

```cpp
void setup() {
  Serial.begin(9600);   // abre el serial a 9600 baudios
}
```

### 2. `Serial.print(...)` y `Serial.println(...)` — MANDAR a la compu

Envían texto o valores a la computadora (los ves en el monitor). `println` agrega un salto de línea al final; `print` no.

```cpp
int lectura = analogRead(A0);
Serial.print("Sensor: ");     // sin salto de linea
Serial.println(lectura);      // con salto de linea -> queda "Sensor: 512"
```

### 3. `Serial.available()` y `Serial.read()` — RECIBIR de la compu

`Serial.available()` te dice **cuántos caracteres llegaron** (0 si no llegó nada). `Serial.read()` **lee uno**. Se usan juntos en el `loop()`:

```cpp
void loop() {
  if (Serial.available() > 0) {   // ¿llegó algo?
    char c = Serial.read();       // leelo
    // ... reaccioná según 'c'
  }
}
```

---

## Los baudios (el error #1 de los principiantes)

Los **baudios** son la velocidad de la conversación (bits por segundo). La regla de oro:

> **El `Serial.begin(...)` del sketch y el monitor tienen que usar EL MISMO número de baudios.**

- **9600** es lo más común (y lo que usa Tecnia Bot por defecto).
- Muchos proyectos con **ESP32** usan **115200**.

**Si no coinciden**, vas a ver **caracteres raros / símbolos** en vez de texto legible (por ejemplo `⸮⸮r@⸮`). Ese es EL síntoma clásico: si aparecen caracteres basura, casi siempre es que los baudios no coinciden.

---

## Ver los datos: el monitor serial

Tecnia Bot abre el **monitor serial** en una ventana aparte. El usuario solo tiene que pedirlo:

> *"abrí el monitor serial"* → el bot detecta el puerto y abre la ventana.
> *"abrí el monitor serial a 115200 baudios"* → si el sketch usa otra velocidad.

No hace falta un proyecto abierto ni código cargado para abrirlo — solo la placa conectada por USB. Para cerrarlo, se aprieta **Ctrl+C** en esa ventana.

La guía completa para el humano está en `docs/monitor-serial.md`.

---

## Ejemplo A — leer un sensor (placa → compu)

El caso más simple: la placa manda una lectura cada segundo.

```cpp
void setup() {
  Serial.begin(9600);
}

void loop() {
  int valor = analogRead(A0);   // lee un potenciometro/sensor en A0
  Serial.print("Valor: ");
  Serial.println(valor);
  delay(1000);                  // una lectura por segundo
}
```

Cargás esto, abrís el monitor, y ves los números cambiar al mover el sensor.

---

## Ejemplo B — comandar un servo con el teclado (compu → placa)

El clásico. Para que funcione hacen falta **DOS cosas juntas**: el **sketch** que lee el serial y mueve el servo, y el **monitor** abierto para mandar las teclas.

> ⚡ **Servo SG90:** alimentar con 5V. 📊 **Dificultad:** Básico. 📦 **Librería:** `Servo.h` (UNO) / `ESP32Servo.h` (ESP32). Ver el skill `actuadores` para el cableado.

```cpp
#include <Servo.h>

Servo servo;
int angulo = 90;  // posicion inicial (centro)

void setup() {
  Serial.begin(9600);   // debe coincidir con los baudios del monitor
  servo.attach(9);      // el servo va al pin 9
  servo.write(angulo);
  Serial.println("Listo. Apreta 'a' (izquierda) o 'd' (derecha).");
}

void loop() {
  if (Serial.available() > 0) {     // ¿llego una tecla?
    char tecla = Serial.read();
    if (tecla == 'a' && angulo > 0)   angulo -= 10;   // izquierda
    if (tecla == 'd' && angulo < 180) angulo += 10;   // derecha
    servo.write(angulo);
    Serial.print("Angulo: ");
    Serial.println(angulo);
  }
}
```

**Flujo para el usuario:** cargar el sketch → *"abrí el monitor serial"* → apretar `a` / `d` en la ventana → el servo se mueve y se ve el ángulo.

> En **ESP32**: cambiar `Servo.h` por `ESP32Servo.h` y `servo.attach(9)` por un pin válido del ESP32 (ej: `servo.attach(13)`). El resto es igual.

---

## Errores comunes

| Síntoma | Causa | Solución |
| --- | --- | --- |
| Caracteres raros / símbolos en vez de texto | Los baudios del sketch y del monitor no coinciden | Igualar `Serial.begin(X)` con los baudios del monitor |
| El monitor abre pero no llega nada | El sketch no tiene ningún `Serial.print/println`, o no se cargó | Cargar un sketch que mande algo por serial |
| "El puerto está ocupado / access denied" | Otro programa ya tiene el puerto abierto (ej: el Serial Monitor del Arduino IDE, u otra ventana del monitor) | Cerrar el otro programa: solo uno puede usar el puerto a la vez |
| Las teclas no mueven nada | El sketch no lee el serial (falta el `Serial.available()/read()` en el `loop()`), o el servo está mal cableado | Revisar que el `loop()` lea el serial y ver el skill `actuadores` |
| No se puede cargar mientras el monitor está abierto | El monitor tiene el puerto tomado | Cerrar el monitor (Ctrl+C) antes de cargar, y reabrirlo después |

---

## Gotchas

- **Cargar y monitorear usan el mismo puerto.** No se puede cargar código con el monitor abierto. Secuencia correcta: cerrar monitor → cargar → abrir monitor.
- **`Serial.read()` devuelve un `char`.** Si el usuario manda `5` desde el teclado, llega el **carácter** `'5'` (código ASCII 53), no el número 5. Para convertir un carácter numérico a número: `int n = tecla - '0';`.
- **El monitor lo abre Tecnia Bot**, no hace falta que el docente sepa el puerto (COM3, /dev/ttyUSB0). El bot lo detecta solo.
