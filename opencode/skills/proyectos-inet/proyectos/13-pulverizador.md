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
- (ESP32) fuente externa de 5V para el servo (GND común con la placa)
- (UNO) fuente de 9V 1A opcional

## Pinout (exacto — de PINES_PULVERIZADOR)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| Servo (señal, gatillo) | 3 | GPIO 13 |
| Sensor PIR (datos) | 4 | GPIO 27 |

## Cableado (de la tabla de conexionado)
| Desde | Hacia | Color |
|---|---|---|
| (UNO) Placa · 5V / (ESP32) Fuente externa 5V | Bus + protoboard | rojo |
| Placa · GND | Bus − protoboard | negro |
| Servo del gatillo · VCC | Bus + protoboard | rojo |
| Servo del gatillo · GND | Bus − protoboard | negro |
| Servo del gatillo · señal | Placa · pin servo | azul |
| Sensor PIR · VCC | Bus + protoboard | rojo |
| Sensor PIR · GND | Bus − protoboard | negro |
| Sensor PIR · OUT | Placa · pin PIR | amarillo |

## Código clave
- Servo con guard de plataforma: `#if defined(ESP32) #include <ESP32Servo.h> #else #include <Servo.h> #endif` — la macro `ESP32` la define el core automáticamente, no hay que definirla a mano.
- Nivel inicial: ciclo bloqueante simple con `delay()` (90° → 1s → 0° → 5s).
- Nivel avanzado: al detectar `digitalRead(PIR) == HIGH`, espera `TIEMPO_ESPERA_MS` (60s original) y luego ejecuta `CICLOS_POR_DETECCION = 3` disparos cortos (1s cada uno, 1s entre ellos). Sigue siendo bloqueante con `delay()`, fiel a la estructura del original.
- Nota para el aula: `TIEMPO_ESPERA_MS` puede bajarse temporalmente (p. ej. a 5000 = 5s) para ver el ciclo completo rápido en clase, y restaurarse a 60000 para el uso real.
- Archivos: `uno|esp32/nivel-inicial/pulverizador-temporizado.ino`, `nivel-avanzado/pulverizador-pir.ino`.

## Gotchas del proyecto ⚠️
- En ESP32 el servo se alimenta desde una **fuente externa de 5V** (no desde el pin 3V3), con GND compartido con la placa.
- La `Servo.h` clásica del UNO **no compila en ESP32** — hay que usar `ESP32Servo.h` (misma API `attach()`/`write()` mapeada sobre LEDC).
- Es un proyecto de baja tensión: no hay 220V. El único cuidado real es el **agua**: sale a baja presión pero no debe tocar la placa, el servo, el sensor ni las conexiones — ubicar el circuito lejos del chorro.
- El `TIEMPO_ESPERA_MS` de 60s es realista pero incómodo para probar en clase — bajarlo temporalmente facilita la demo, pero hay que restaurarlo después (explicar por qué existe: darle tiempo a la persona a alejarse antes de rociar).

## Cómo ayudar al alumno
- Si el servo no dispara al detectar movimiento: primero verificar con un sketch simple que el PIR realmente cambia a HIGH (los PIR necesitan unos segundos de calibración al energizarse).
- Si el servo "tiembla" o no llega a 90°: revisar la alimentación — un servo mal alimentado da movimientos erráticos, no es un problema de código.
- Si en clase el ciclo de espera de 60s se hace eterno: sugerir bajar `TIEMPO_ESPERA_MS` temporalmente para la demo.
- Recordar que el agua es el único riesgo real acá — mojar la placa arruina la placa, no hay drama de 220V que explicar.
