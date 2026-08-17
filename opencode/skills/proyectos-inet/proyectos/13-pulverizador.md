# Proyecto 13 — Pulverizador Automatizado

🔗 **Verlo en vivo (animación + simulador interactivo):** https://tecnialab.net.ar/proyectos/13-pulverizador/
> El alumno arma un pulverizador de agua que primero riega por tiempo y después reacciona a un sensor de movimiento, pensado para mantener húmedas las góndolas de frutas y verduras.

## De qué se trata
Un servomotor acciona el gatillo de un pulverizador de agua (botella con gatillo estándar). El nivel inicial lo hace disparar a intervalos fijos (temporizador). El nivel avanzado suma un sensor PIR: cuando detecta movimiento (un cliente retirando productos), espera un tiempo prudencial para no mojar a la persona y después hace 3 pulverizaciones seguidas. Las piezas del mecanismo sobre el gatillo se imprimen en 3D.

## Los niveles
- **Inicial — Temporizado**: el servo repite un ciclo fijo — 90° (dispara/pulveriza) → 1s → 0° (reposo) → 5s. Sin sensores, con `delay()`. Concepto clave: control de servo con dos posiciones y temporización simple.
- **Avanzado — Sensor PIR**: al detectar movimiento, espera `TIEMPO_ESPERA_MS` (60s en el original, para que la persona se aleje) y después hace 3 ciclos de pulverización cortos. Concepto clave: secuenciar una espera + una ráfaga de acciones a partir de un evento de sensor.

Este proyecto tiene **solo 2 niveles** (sin intermedio) y **no tiene IoT**.

## Materiales
- Gatillo pulverizador estándar (con su botella)
- Servomotor SG5010 (estándar, 0°–180°)
- Sensor PIR (piroeléctrico), desde el nivel avanzado
- Filamento PLA (piezas del mecanismo sobre el gatillo)
- Protoboard, cables dupont macho-hembra y macho-macho
- Arduino UNO R3 o Placa ESP32 DevKit v1
- **Fuente externa de 5 V (1 A o más) para el servo — OBLIGATORIA en UNO y en ESP32**, con GND común a la placa (antes esta lista la pedía sólo para ESP32: estaba mal, ver la nota del cableado)
- (UNO) fuente de 9V 1A opcional

## Pinout (exacto — de PINES_PULVERIZADOR)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| Servo (señal, gatillo) | 3 | GPIO 13 |
| Sensor PIR (datos) | 4 | GPIO 27 |

## Cableado (de la tabla de conexionado)
| Desde | Hacia | Color |
|---|---|---|
| **Fuente externa 5 V (+)** | **Bus + del servo** (independiente) | rojo |
| **Fuente externa 5 V (−)** | Bus − protoboard | negro |
| Placa · **5V** (UNO) / **VIN** (ESP32) | **Bus +5V** protoboard | rojo |
| Placa · GND | Bus − protoboard | negro |
| **Servo del gatillo · VCC** | **Bus + del servo (NO al pin de la placa)** | rojo |
| Servo del gatillo · GND | Bus − protoboard | negro |
| Servo del gatillo · señal | Placa · pin servo | azul |
| **Sensor PIR · VCC** | **Bus +5V** (siempre, las dos placas) | rojo |
| Sensor PIR · GND | Bus − protoboard | negro |
| Sensor PIR · OUT | Placa · pin PIR | amarillo |

> **LA FUENTE EXTERNA PARA EL SERVO NO ES SÓLO PARA EL ESP32 — en UNO también.** Antes esta ficha ponía "(UNO) Placa · 5V" en el mismo renglón que la fuente externa del ESP32, como si en UNO se pudiera colgar del pin. Los números dicen que no: el módulo de servo de 3 pines de este kit pide **mínimo 4,8 V** y consume **250 mA moviéndose, hasta 700 mA con el rotor trabado** (`electrica.ts` → `TecniaLab:Modulo_Servo_3P`, hoja del TowerPro SG90; el SG5010 es más grande, así que no consume menos). El riel de 5 V del UNO por USB da **450 mA** y ya avisa a los 300: los 250 mA de puro movimiento se comen todo el margen.
>
> Y este mecanismo es de los que **llegan al tope**: el gatillo del pulverizador tiene resorte, así que el servo empuja contra él durante todo el recorrido y **se queda haciendo fuerza contra el fin de carrera el segundo entero que dura el disparo**. Eso es corriente de bloqueo —700 mA— muy por encima de lo que da el riel. El síntoma no es "no anda": es que la placa se resetea sola justo cuando dispara, y el alumno busca el error en el código.
>
> **El servo va a un bus + propio**, alimentado por la fuente de 5 V aparte, **sin unirse nunca al bus + de la placa**. Lo único compartido es el **GND**: el negativo de la fuente al mismo bus − que la placa, o el PWM no tiene referencia y el servo tiembla. Es el mismo esquema del proyecto 11 (brazo robótico).
>
> **El PIR, en cambio, sí va al riel de la placa** — consume menos de 0,1 mA en reposo. Pero va al de **5 V** (VIN en ESP32), nunca al 3V3: el HC-SR501 se alimenta de **4,5 a 20 V DC** (`electrica.ts` → `TecniaLab:HC-SR501`), y a 3,3 V está por debajo de su mínimo. Su salida OUT es segura igual para el ESP32: la misma tabla dice que «entrega 3,3 V por su propia electrónica».

## Código clave
- Servo con guard de plataforma: `#if defined(ESP32) #include <ESP32Servo.h> #else #include <Servo.h> #endif` — la macro `ESP32` la define el core automáticamente, no hay que definirla a mano.
- Nivel inicial: ciclo bloqueante simple con `delay()` (90° → 1s → 0° → 5s).
- Nivel avanzado: al detectar `digitalRead(PIR) == HIGH`, espera `TIEMPO_ESPERA_MS` (60s original) y luego ejecuta `CICLOS_POR_DETECCION = 3` disparos cortos (1s cada uno, 1s entre ellos). Sigue siendo bloqueante con `delay()`, fiel a la estructura del original.
- Nota para el aula: `TIEMPO_ESPERA_MS` puede bajarse temporalmente (p. ej. a 5000 = 5s) para ver el ciclo completo rápido en clase, y restaurarse a 60000 para el uso real.
- Archivos: `uno|esp32/nivel-inicial/pulverizador-temporizado.ino`, `nivel-avanzado/pulverizador-pir.ino`.

## Gotchas del proyecto ⚠️
- **EL SERVO VA A FUENTE EXTERNA DE 5 V EN LAS DOS PLACAS, no sólo en ESP32.** Antes esta ficha lo pedía sólo para el ESP32 y en UNO lo colgaba del pin de 5 V: 250 mA moviéndose y hasta 700 mA con el rotor trabado (`electrica.ts` → `TecniaLab:Modulo_Servo_3P`) contra los 450 mA que da el riel del UNO por USB. Y el gatillo tiene resorte: el servo termina apoyado contra el tope, haciendo fuerza, todo el segundo que dura el disparo — o sea que el caso de bloqueo es el uso NORMAL de este proyecto, no una falla. Fuente aparte, **bus + propio para el servo** (sin unirlo al de la placa) y **GND común**.
- **El PIR va al bus de 5 V, no al de 3,3 V**: el HC-SR501 se alimenta de 4,5 a 20 V DC (`electrica.ts`). Por debajo de 4,5 V el fabricante no promete nada — y "nada" incluye que funcione a veces, que es la falla que más tiempo hace perder. Su salida OUT entrega 3,3 V por su propia electrónica, así que el GPIO del ESP32 está a salvo igual.
- La `Servo.h` clásica del UNO **no compila en ESP32** — hay que usar `ESP32Servo.h` (misma API `attach()`/`write()` mapeada sobre LEDC).
- Es un proyecto de baja tensión: no hay 220V. El único cuidado real es el **agua**: sale a baja presión pero no debe tocar la placa, el servo, el sensor ni las conexiones — ubicar el circuito lejos del chorro.
- El `TIEMPO_ESPERA_MS` de 60s es realista pero incómodo para probar en clase — bajarlo temporalmente facilita la demo, pero hay que restaurarlo después (explicar por qué existe: darle tiempo a la persona a alejarse antes de rociar).

## Cómo ayudar al alumno
- Si el servo no dispara al detectar movimiento: primero verificar con un sketch simple que el PIR realmente cambia a HIGH (los PIR necesitan unos segundos de calibración al energizarse).
- Si el servo "tiembla", no llega a 90°, o **la placa se resetea justo cuando dispara**: es la alimentación, no el código. Dos preguntas en este orden: ¿el VCC del servo sale de la **fuente externa** (no del pin de la placa)? ¿está el **GND de esa fuente unido** al de la placa? Un servo mal alimentado da movimientos erráticos y arrastra a toda la placa con él.
- Si en clase el ciclo de espera de 60s se hace eterno: sugerir bajar `TIEMPO_ESPERA_MS` temporalmente para la demo.
- Recordar que el agua es el único riesgo real acá — mojar la placa arruina la placa, no hay drama de 220V que explicar.
