---
name: proyectos-inet
description: Los 15 proyectos INET refactorizados (Arduino UNO / ESP32), con sus niveles, pinouts, cableado, código y gotchas. Para guiar a un docente o alumno que quiere hacer cualquiera de estos proyectos, sin depender de la web.
---

# Proyectos INET — los 15 proyectos de memoria

Esta skill le da a Tecnia Bot el conocimiento completo de los 15 proyectos de la colección **Saberes Digitales / INET-EDUCAR** refactorizada: qué se arma, cómo se cablea, qué código corre y en qué se equivocan los alumnos. La idea es simple: si un profe o un alumno dice "quiero hacer el de riego", el bot YA sabe el pinout exacto, el cableado, el código clave y los gotchas — no tiene que inventarlos ni ir a buscarlos a la web.

## Los 15 proyectos

| Nº | Nombre | Qué es | Plataformas |
|---|---|---|---|
| 01 | Semaforización | Semáforo de 2 vías (6 LED), sincronización e IoT | UNO / ESP32 |
| 02 | Sistema de tanques | Nivel de agua con 2 HC-SR04 + electroválvula + bomba (relés) | UNO / ESP32 |
| 03 | Riego automatizado | Riego por tiempo, luego por higrómetro de suelo, luego IoT | UNO / ESP32 |
| 04 | Invernadero | DHT11 + LED de ventilación + LCD + IoT | UNO / ESP32 |
| 05 | Estación meteorológica | DHT11 + sensor de lluvia + BMP180 + LCD + IoT (solo mide, no acciona) | UNO / ESP32 |
| 06 | Estacionamiento | Barreras con servos + pulsadores + display 7 segmentos + IoT | UNO / ESP32 |
| 07 | Robot móvil | KIT Robobloq Qoopers, sin circuito, programación por bloques | — (kit) |
| 08 | Dron de vuelo | KIT DJI Tello, sin circuito, app + programación por bloques | — (kit) |
| 09 | Cerradura | Servo + teclado matricial + buzzer + LED verde/rojo | UNO / ESP32 |
| 10 | Dron acuático | Vehículo acuático, propulsión y control remoto | UNO / ESP32 |
| 11 | Brazo robótico | 6 servos + 6 potenciómetros (control manual de cada articulación) | UNO / ESP32 |
| 12 | Calefacción | Relé + DHT11 + LCD + potenciómetro (termostato) | UNO / ESP32 |
| 13 | Pulverizador | Servo + PIR (detecta presencia y pulveriza) | UNO / ESP32 |
| 14 | Acuapónico | Aireador + bomba + dosificador (ciclo acuapónico automatizado) | UNO / ESP32 |
| 15 | Sistema lumínico | Relé + PIR + LDR + lámpara (luz automática por presencia y luminosidad) | UNO / ESP32 |

Las fichas detalladas de los 15 proyectos están en `proyectos/NN-nombre.md`. Cada ficha tiene: de qué se trata, los niveles (inicial/intermedio/avanzado), materiales, pinout exacto por plataforma, cableado, código clave y gotchas verificados.

## Cómo usar esta skill

Cuando un alumno o docente menciona cualquiera de estos 15 proyectos (por nombre, por número, o describiendo lo que quiere hacer — "quiero medir humedad de tierra y regar solo", "quiero un semáforo con dos calles"):

1. **Identificá el proyecto** de la tabla de arriba.
2. **Leé la ficha completa** `proyectos/NN-nombre.md` correspondiente (los 15 proyectos tienen su ficha en esa carpeta).
3. **Guiá con los datos EXACTOS de la ficha**: pinout de la plataforma que esté usando el alumno (UNO o ESP32 — son distintos), cableado, y sobre todo los gotchas — son errores reales, verificados en el código y los comentarios del firmware, no genéricos.
4. Si el alumno no aclaró la plataforma, PREGUNTÁ primero (UNO y ESP32 tienen pines distintos y a veces hasta arquitectura distinta — por ejemplo LCD paralelo vs I2C).

## Regla de oro

**Nunca inventes un pin ni un umbral.** Si la ficha del proyecto tiene el dato exacto (pinout de `PINES_*`, umbral de un sensor, ángulo de un servo), usalo tal cual — son datos verificados contra el código fuente real (`.ino`) del proyecto, no aproximaciones. Si un dato no está en la ficha, decilo con honestidad ("no tengo ese dato verificado, revisemos juntos") en vez de inventarlo: un pin mal dado puede romper una placa o quemar un componente.

Además:
- Siempre distinguí UNO de ESP32 antes de dar un pinout — nunca asumas la plataforma.
- Los gotchas de cada ficha no son advertencias genéricas: son comportamientos reales y verificados (ej. el higrómetro del proyecto 03 es INVERSO — mayor lectura = más seco). Repetilos siempre que el alumno toque ese componente.
- Los proyectos 07 y 08 son KITS cerrados (Robobloq Qoopers y DJI Tello): no tienen circuito, pinout ni firmware `.ino` — se programan por bloques sobre hardware propio del kit. No intentes darles un pinout GPIO, no existe.
- Cuando el proyecto tenga niveles (inicial/intermedio/avanzado), guiá al alumno por el nivel en el que está — no le des de una todo el proyecto avanzado si recién está en el inicial.
