---
name: circuitos-visuales
description: Generar un circuito VISUAL profesional en HTML con piezas reales que el alumno abre en el navegador. Para cuando piden "circuito bonito", "esquema visual", "mostrame el circuito lindo", "ver/entender el protoboard" de Arduino/ESP32 con servo, LED, sensores, relé, bomba, etc.
---

# Circuitos visuales en HTML — usá el tool `circuito`

Para cualquier circuito visual, esquema, diagrama animado, "circuito bonito" o explicador de protoboard, **usá SIEMPRE el tool `circuito`**. Ese tool ya tiene todo resuelto (piezas reales, cables, animación, interacción) y genera el HTML solo.

> ⛔ **NUNCA dibujes vos un archivo `.svg` o `.html` a mano.** Está prohibido inventar coordenadas de pines o escribir el HTML con `edit`/`write`. El tool `circuito` es el ÚNICO método aprobado. Si dibujás a mano, sale mal y se desalinea.

## Cómo usarlo

Llamá al tool `circuito` con UNO de estos dos argumentos:

**a) `circuito` (un preset validado)** — cuando el pedido coincide con uno:
- Sueltos: `servo-esp32`, `led-esp32`, `ultrasonico-esp32`, `buzzer-esp32`, `dht22-esp32`, `pir-esp32`, `lcd-esp32`
- Interactivos (el alumno controla con el mouse): `potenciometro-esp32`, `boton-esp32`
- Proyectos: `estacion-meteo`, `alarma`, `semaforo`
- **`protoboard`** → explicador interactivo de la placa de pruebas (tocás un agujero y se iluminan los que están conectados). Usalo cuando pidan **ver/entender/cómo funciona el protoboard o breadboard**.

**b) `componentes` (armador libre)** — cuando es una combinación que no es preset. Lista separada por comas, de 1 a 6 componentes. Tipos: `led`, `rgb-led`, `servo`, `stepper`, `motor`, `driver`, `potenciometro`, `joystick`, `buzzer`, `ultrasonico`, `dht22`, `ntc`, `pir`, `ldr`, `llama`, `sonido`, `ir`, `tilt`, `lcd`, `oled`, `7segmentos`, `neopixel`, `mpu6050`, `teclado`, `boton`, `relay`, `bomba`, `valvula`, `higrometro`, `lluvia`, `bmp180`, `lampara`, `calefactor`. GPIO opcional con dos puntos: `led:4, servo:18`.

Ejemplos de proyectos del INET con el armador: riego → `"higrometro, relay, bomba"`; tanques → `"ultrasonico, relay, bomba"`; calefacción → `"dht22, relay, calefactor"`; lumínico → `"ldr, pir, relay, lampara"`.

## Qué hace el tool por vos

- Elige los pines seguros del ESP32 (evita los de flash y avisa de los strapping).
- Dibuja las piezas reales conectadas con cables de colores, con tabla de conexiones y advertencias de voltaje/seguridad.
- Copia la biblioteca de piezas al lado del HTML (funciona sin internet).
- Devuelve la ruta `file://…` para que le digas al alumno: *"Abrí este archivo en tu navegador (doble clic)"*.

## Principios de diseño de esquemáticos

Cuando armes o expliques un circuito, respetá estas reglas para que quede claro y profesional:

- **Sin cruces**: preferí que los cables corran paralelos, sin cruzarse. Ordená los componentes según el orden de sus pines y hacé que el flujo vaya en una sola dirección (de la señal hacia el actuador). Un cable que cruza a otro confunde al que recién arranca.
- **Serie visible**: cuando una resistencia va EN SERIE (ej. GPIO → 330Ω → LED), tiene que notarse que la corriente la ATRAVIESA. Idealmente dibujada inline (el cable entra a la resistencia y sale hacia el LED); como mínimo, decilo claro con la notación `→ 330Ω →`. Nunca la muestres "colgando" al costado como si no formara parte del camino.
- **Colores estándar**: cada señal siempre del mismo color a lo largo de todo el esquema. Alimentación en rojo, GND en negro. Así el ojo sigue una señal sin perderse.
- **Claridad para principiantes**: etiquetas claras en las DOS puntas de cada cable (de qué pin sale y a dónde llega). Nada de cables que se pierdan o queden sin destino visible.

El tool ya aplica estos principios: el **armador libre** usa un layout por filas (una fila por componente, cables CSS que crecen con flex) que es IMPOSIBLE de cruzar o desalinear; y las **2 plantillas de protoboard** (`boton-led-protoboard`, `semaforo-protoboard`) muestran las piezas reales pinchadas en la placa con jumpers de colores y halo blanco para que los cables se distingan aun cuando se cruzan. Por eso NO dibujes vos: dejá que el tool arme.

## Cuándo NO hace falta el HTML

Para una explicación rápida en el chat (sin abrir el navegador), alcanza con el skill `diagramas-conexion` (dibujo ASCII + tabla de colores). Reservá el tool `circuito` para el material visual de calidad o cuando pidan algo "para mostrar/ver".
