---
name: gotchas-hardware
description: Problemas reales de Arduino/ESP32 que NO están en los libros - por qué el servo no gira, el pote lee 0, el ESP32 da 0-4095, la alimentación, los strapping pins. La sabiduría que un buen profe tiene por experiencia.
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
| Sensor PIR | 5V (VIN) | ⚠️ su salida puede dar 5V → divisor antes del GPIO |
| HC-SR04 | 5V (VIN) | ⚠️ el pin ECHO da 5V → SÍ o SÍ divisor de tensión |
| DHT22 | 3.3V | anda directo |
| LED | — | siempre con resistencia 330Ω |

**El divisor de tensión (para bajar 5V a 3.3V):** dos resistencias — R1=1kΩ entre la señal de 5V y el GPIO, R2=2kΩ entre el GPIO y GND. Así el GPIO recibe ~3.3V seguros.

**Para el alumno:** "El ESP32 es más delicado que el Arduino UNO: aguanta 3.3V en sus patas. Si le metés 5V directo de un sensor, lo podés quemar. Por eso a veces necesitás un 'divisor' que baja el voltaje."

## 🚫 Los strapping pins (los que rompen el arranque)

Algunos GPIO del ESP32 tienen una función especial al encender. Si tenés algo conectado ahí al momento de programar o bootear, falla:

- **GPIO0** — si está en LOW al encender, entra en modo programación. No lo uses para nada conectado.
- **GPIO2** — tiene el LED interno; debe estar libre/LOW al bootear.
- **GPIO12** — ⚠️ peligroso: define el voltaje de la flash. Un LED encendido ahí puede impedir el arranque.
- **GPIO15** — silencia el log de arranque si está en LOW.
- **GPIO6 a GPIO11** — conectados a la memoria flash interna. NUNCA usarlos.

**Pines seguros para empezar:** GPIO4, 5, 18, 19, 21, 22, 23, 25, 26, 27.

**Para el alumno:** "Algunos pines del ESP32 están 'ocupados' cuando la placa arranca. Si conectás algo ahí, la placa no prende bien. Empezá usando GPIO4, 5, 18, 19 que son tranquilos."

## 💡 El LED no prende

1. **Polaridad** — la pata larga (ánodo, +) va al pin con resistencia; la corta (cátodo, −) a GND. Al revés no prende.
2. **Falta la resistencia** — siempre 330Ω en serie, o el LED se quema (o quema el pin).
3. **`pinMode` olvidado** — en `setup()`: `pinMode(pin, OUTPUT)`.

## 🔌 Errores de conexión USB / no detecta la placa

- **Windows no detecta el ESP32** — falta el driver del chip USB. Fijate si es **CH340** o **CP2102** y bajá el driver correspondiente.
- **Linux: "Permission denied" en /dev/ttyUSB0** — tu usuario no está en el grupo del puerto. En **Arch/Manjaro** es `uucp`, en **Debian/Ubuntu** es `dialout`. Agregate con `sudo usermod -a -G GRUPO $USER` y cerrá sesión.
- **El cable USB es solo de carga** — algunos cables no transmiten datos. Probá otro.

## Cómo usar este conocimiento

Cuando el alumno reporte un problema, NO le tires toda la lista. Preguntá qué le pasa, identificá el síntoma, y dale LA causa más probable con su solución, en lenguaje simple. Si no funciona, vas a la siguiente. Paciencia: estas cosas frustran, y tu trabajo es que el alumno no se rinda.
