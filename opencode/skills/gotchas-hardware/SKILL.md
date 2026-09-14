---
name: gotchas-hardware
description: Problemas reales de Arduino/ESP32 que NO están en los libros - por qué el servo no gira, el pote lee 0, el ESP32 da 0-4095 y el UNO 0-1023, la alimentación, los strapping pins del ESP32, y los pines D0/D1 (serie del USB) y D13 (LED «L» + SCK) del UNO. La sabiduría que un buen profe tiene por experiencia.
---

# Gotchas de hardware — lo que se aprende sufriendo, no leyendo

Este skill tiene los problemas REALES que aparecen en el aula y que ningún tutorial cuenta. Cuando un alumno dice "no me funciona y no entiendo por qué", la respuesta casi siempre está acá. Explicá con paciencia: el alumno no se equivocó, es que estas cosas no son obvias.

## 🔧 El servo no se mueve / tiembla / se mueve raro

**Síntoma:** subís el código, el servo no gira o vibra sin llegar a la posición.

**Causas reales (en orden de frecuencia):**
1. **Alimentación insuficiente** — es el #1. El servo SG90 necesita **5V** y consume bastante corriente (hasta 500mA al moverse). Si lo alimentás del pin de 3.3V del ESP32, no tiene fuerza y tiembla. **Solución:** cable rojo a **VIN (5V)**, nunca a 3.3V. Si igual tiembla, usá una fuente externa de 5V (y conectá los GND).
2. **El ESP32 se reinicia al mover el servo** — el pico de corriente del servo baja la tensión y resetea la placa. Misma solución: fuente externa.
3. **Pin de señal equivocado** — la señal (naranja) va a un GPIO. En el código: `servo.attach(GPIO)` y `servo.write(angulo)` con ángulo 0-180.

**Para el alumno:** "El servo es como un motorcito con fuerza. Si le das poca comida (3.3V) se marea y tiembla. Dale los 5V que pide y va a andar firme."

## 🎛️ El potenciómetro siempre lee 0 (o no cambia)

**Síntoma:** `analogRead()` siempre devuelve 0 o un valor que no cambia al girar.

**Causas reales:**
1. **El cursor no está en un pin analógico válido** — en el ESP32, el pin del medio del pote (cursor) tiene que ir a una entrada analógica: **GPIO34, GPIO35, GPIO32, GPIO33** (los 34/35 son ideales, solo-entrada).
2. **Pin solo-entrada usado como salida** — GPIO34-39 son SOLO entrada. Perfectos para el pote, pero no sirven para LEDs ni servos.
3. **Los extremos del pote mal conectados** — un extremo a 3.3V, el otro a GND, el del medio (cursor) al pin analógico.

**Dato clave que confunde a todos:** en el **ESP32**, `analogRead()` devuelve **0 a 4095** (resolución de 12 bits). En el **Arduino UNO** es **0 a 1023** (10 bits). Si copiás código de UNO a ESP32, el `map()` te queda mal. 

**Para el alumno:** "El pote es una perilla que el Arduino lee como un número. En el UNO va de 0 a 1023, en el ESP32 de 0 a 4095. ¡Ojo con eso cuando copies código de un lado al otro!"

## ⚡ Voltaje: 3.3V vs 5V (el que quema placas)

El **ESP32 trabaja a 3.3V**. El **Arduino UNO a 5V**. Mezclarlos mal quema componentes.

| Componente | Alimentación | Cuidado |
|------------|--------------|---------|
| Servo SG90 | 5V (VIN) | sin 5V no tiene fuerza |
| Sensor PIR HC-SR501 | 5V (VIN) | OUT es de 3.3V (trae regulador a bordo) → directo al GPIO, sin divisor. Sólo módulos mini sin regulador pueden dar 5V: medí antes |
| HC-SR04 | 5V (VIN) | ⚠️ el pin ECHO da 5V → divisor de tensión **sólo en ESP32**. En el **UNO no hace falta**: la placa es de 5V y el pin tolera esos 5V, el echo entra directo |
| DHT22 | 3.3V | anda directo |
| LED | — | siempre con resistencia: **220Ω**, tanto en los 5V del UNO como en los 3.3V del ESP32. Es el valor que viene en los kits. En 3.3V medí igual el Vf: un azul/blanco/verde InGaN (~3,2V) no prende con ninguna resistencia, no le queda tensión |

**El divisor de tensión (para bajar 5V a 3.3V):** dos resistencias — R1=1kΩ entre la señal de 5V y el GPIO, R2=2kΩ entre el GPIO y GND. Así el GPIO recibe ~3.3V seguros.

**Para el alumno:** "El ESP32 es más delicado que el Arduino UNO: aguanta 3.3V en sus patas. Si le metés 5V directo de un sensor, lo podés quemar. Por eso a veces necesitás un 'divisor' que baja el voltaje."

## 🚫 Los strapping pins (los que rompen el arranque)

Algunos GPIO del ESP32 tienen una función especial al encender. Si tenés algo conectado ahí al momento de programar o bootear, falla:

- **GPIO0** — si está en LOW al encender, entra en modo programación. No lo uses para nada conectado.
- **GPIO2** — strapping pin, pero **NO** hace falta que esté en LOW para arrancar: para el arranque normal es indiferente. Sólo importa **acompañando a GPIO0 en LOW**, que es la combinación del modo de descarga. Tiene el LED integrado en muchas placas.
- **GPIO12** — ⚠️ peligroso: define el voltaje de la flash. Un LED encendido ahí puede impedir el arranque.
- **GPIO15** — silencia el log de arranque si está en LOW.
- **GPIO6 a GPIO11** — conectados a la memoria flash interna. NUNCA usarlos.

**Pines seguros para empezar:** GPIO4, 5, 18, 19, 21, 22, 23, 25, 26, 27.

**Para el alumno:** "Algunos pines del ESP32 están 'ocupados' cuando la placa arranca. Si conectás algo ahí, la placa no prende bien. Empezá usando GPIO4, 5, 18, 19 que son tranquilos."

## 🟦 Los pines del Arduino UNO: los tres con letra chica (y por qué los demás no tienen)

**Arrancá por lo que NO pasa, porque es la mitad del alivio:** en el UNO **no hay strapping pins, no hay pines de solo-entrada y no hay pines de flash**. Nada de lo que dice la sección de arriba aplica acá. Los 14 digitales (D0-D13) y los 6 analógicos (A0-A5) son todos de propósito general, entran y salen, y ninguno impide que la placa arranque. Es un ATmega328P a 5V con la flash adentro del chip (ver skill `placas`), y el mismo razonamiento ya está escrito para la Educablocks UNO en el skill `educabot` ("todo lo que el skill `esp32` dice de 3.3V, divisores y strapping pins **no aplica**").

Dicho eso, **tres de esos pines vienen con algo pegado de fábrica**. No están prohibidos — se usan últimos, y avisando:

| Pin | Qué tiene atado | Qué pasa si lo usás igual |
|---|---|---|
| **D0 (RX)** y **D1 (TX)** | el **puerto serie por hardware**, que es el **mismo canal del USB** | rompe la carga de sketches y el Monitor Serie, y lo que conectes ahí se mueve solo cada vez que la placa habla por USB |
| **D13** | el **LED «L»** soldado a la placa, y además **SCK del bus SPI** | lo que conectes comparte el pin con ese LED: prenden y apagan juntos. Y si el proyecto usa SPI, D13 ya está tomado |

**D0 y D1 — por qué es el peor lugar para enchufar algo.** No es teoría: está documentado en este repo como **"BUG CRÍTICO del material original"**. El esquema de 2019 del proyecto de estacionamiento ponía los **servos en los pines 0 y 1**, y eso *"rompe la carga de sketches y el Monitor Serie, y genera movimientos erráticos mientras la placa se comunica"* (`proyectos-inet/proyectos/06-estacionamiento.md`, Gotchas). En la reedición los servos se mudaron a **4 y 8**. El mismo bug está anotado en la cerradura: *"El pin 0 del UNO es el RX del puerto serie: por eso NUNCA se usa el servo ahí"* (`09-cerradura.md`). Y en la Educablocks el puerto **COM** es justamente D0+D1, con la regla de la casa: **desenchufá el módulo para cargar** (`educabot/SKILL.md`), o `avrdude` falla con `not in sync`.

> **Síntoma de diagnóstico (memorizalo).** Si el UNO **no programa** o el **Monitor Serie se comporta raro**, sospechá que hay algo colgado del pin 0 o del 1 antes de mirar el código. Es la primera pregunta, no la última (`06-estacionamiento.md`, "Cómo ayudar al alumno").

**D13 — no es peligroso, es compartido.** La ficha de la placa lo dice así: el **LED «L»** está *"en D13, ya viene cableado: sirve para probar sin armar nada"* (ficha `01-arduino-uno.html`), y el skill `placas` lo lista como **LED de placa: pin 13**. Consecuencia práctica: el LED de la placa se enciende con lo que vos escribas en D13, así que un LED externo ahí va a parecer que anda aunque esté mal cableado — el que estás viendo prender puede ser el de la placa. Ese LED de placa **ya trae su resistencia limitadora incorporada** — no le agregues una: *"En UNO el pin 13 ya trae el LED de la placa con su limitadora incorporada; el LED **externo** necesita la suya sí o sí"* (`12-calefaccion.md`, Materiales). Y **D13 es también SCK de SPI** (`educabot/SKILL.md`): si el proyecto lleva una tarjeta SD, un RFID o cualquier módulo SPI, el pin ya tiene dueño.

**Para el alumno:** "En el UNO todos los pines sirven, pero tres ya tienen un inquilino. El 0 y el 1 son el cable por donde la placa habla con la computadora: si les colgás un servo, la placa deja de poder recibir el programa. Y el 13 tiene un LED soldado adentro de la placa — lo que conectes ahí va a prender ese LED también. Dejalos para el final, cuando ya no te queden otros."

## 💡 El LED no prende

1. **Polaridad** — la pata larga (ánodo, +) va al pin con resistencia; la corta (cátodo, −) a GND. Al revés no prende.
2. **Falta la resistencia, o es la equivocada** — siempre una en serie, y el valor de la casa es **220Ω**: en 5V (UNO) y en 3.3V (ESP32). Sin ella el LED se quema (o quema el pin). En 5V con un LED de 2V, 220Ω dan 13,6 mA — bien por debajo de los 20 mA que aguanta el pin — y **es el valor que viene en la caja del kit**: mandarlo a comprar 330Ω es mandarlo a comprar lo que ya tiene.
   **Y ojo con los 3,3V, que es otra historia:** un LED azul, blanco o verde InGaN (Vf ~3,2V) alimentado desde 3,3V **no prende**, y no se arregla eligiendo mejor la resistencia — con 220Ω recibe 0,45 mA y con 330Ω, 0,3 mA. No queda tensión. El LED no está roto: le falta fuente. Medí el Vf con el téster (ver skill `esp32`), y en 3,3V **nunca bajes de 100Ω**.
3. **`pinMode` olvidado** — en `setup()`: `pinMode(pin, OUTPUT)`.

## 🔌 Errores de conexión USB / no detecta la placa

- **Windows no detecta el ESP32** — falta el driver del chip USB. Fijate si es **CH340** o **CP2102** y bajá el driver correspondiente.
- **Linux: "Permission denied" en /dev/ttyUSB0** — tu usuario no está en el grupo del puerto. En **Arch/Manjaro** es `uucp`, en **Debian/Ubuntu** es `dialout`. Agregate con `sudo usermod -a -G GRUPO $USER` y cerrá sesión.
- **El cable USB es solo de carga** — algunos cables no transmiten datos. Probá otro.

## Cómo usar este conocimiento

Cuando el alumno reporte un problema, NO le tires toda la lista. Preguntá qué le pasa, identificá el síntoma, y dale LA causa más probable con su solución, en lenguaje simple. Si no funciona, vas a la siguiente. Paciencia: estas cosas frustran, y tu trabajo es que el alumno no se rinda.
