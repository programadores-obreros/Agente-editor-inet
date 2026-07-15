# Proyecto 06 — Estacionamiento automatizado
> El alumno arma un estacionamiento de 8 plazas: barreras con servomotores que cuentan autos, después un display de 7 segmentos con la cantidad exacta de lugares libres, y por último monitoreo IoT.

## De qué se trata
Un estacionamiento necesita saber en todo momento cuántos lugares le quedan. Se arma la maqueta con dos servomotores (barreras de entrada y salida), dos pulsadores (detectan ingreso/egreso) y dos LED (verde = hay lugar, rojo = completo). Después los LED se reemplazan por un display de 7 segmentos que muestra el número exacto, y por último se monitorea todo por IoT.

## Los niveles
- **Inicial — Barreras automáticas y conteo de plazas**: al presionar el pulsador de entrada (si hay lugar), el servo sube a 90° la barrera, espera y baja a 0°, y se descuenta un lugar; el pulsador de salida hace lo inverso.
- **Intermedio — Mostrar las plazas libres en un display de 7 segmentos**: reemplaza los 2 LED por un display de 7 segmentos (cada segmento a-g con su propia salida digital + resistencia 220 Ω), con una función `escribir_numero()` apoyada en una tabla de segmentos.
- **Avanzado — Monitorear el estacionamiento con IoT**: código no bloqueante con `millis()` (necesario para atender internet y barreras a la vez), feeds `estacionamiento1`/`estacionamiento2` en Adafruit IO con la cantidad de plazas ocupadas.

## Materiales
- Arduino UNO o ESP32 DevKit v1
- 2× servomotor SG-5010 (barrera entrada / salida)
- 2× pulsador (entrada / salida) — conectados con pull-up interno (`INPUT_PULLUP`), directo entre pin y GND
- LED verde + LED rojo (nivel inicial) → reemplazados por display de 7 segmentos (nivel intermedio)
- 10× resistencia 220 Ω
- Capacidad de la maqueta: **8 plazas** (constante `CAPACIDAD = 8`)

## Pinout (exacto — de PINES_ESTACIONAMIENTO)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| Servo barrera entrada | pin 4 | GPIO 25 |
| Servo barrera salida | pin 8 | GPIO 26 |
| Pulsador entrada | pin 2 | GPIO 32 |
| Pulsador salida | pin 3 | GPIO 33 |
| Display 7 seg (a-g) | pines 12,13,5,6,7,11,10 | GPIO 16..23 |
| LED verde (nivel inicial) | pin 9 | — |
| LED rojo (nivel inicial) | pin 13 | — |

## Cableado (de la tabla de conexionado)
| Desde | Hacia | Color |
|---|---|---|
| Fuente/placa · alimentación | Bus + protoboard | 🔴 rojo |
| Placa · GND | Bus − protoboard | ⚫ negro |
| Servo entrada · señal | placa · pin correspondiente | 🔵 azul |
| Servo salida · señal | placa · pin correspondiente | 🟠 naranja |
| Pulsador entrada | placa · pin correspondiente | 🟡 amarillo |
| Pulsador salida | placa · pin correspondiente | 🟣 violeta |
| Display 7 seg · a–g (c/u con R 220 Ω) | placa · pines correspondientes | 🟢 verde |
| Display 7 seg · común | Bus − protoboard | ⚫ negro |

> En ESP32 los servos se alimentan desde una fuente externa de 5 V (no desde la placa), compartiendo GND.

## Código clave
- **Capacidad**: `const int CAPACIDAD = 8`.
- **Ángulos de la barrera**: 0° = barrera baja, 90° = barrera levantada.
- El pulsador de entrada solo abre la barrera **SI quedan lugares disponibles**.
- Nivel intermedio: `escribir_numero()` enciende/apaga los 7 segmentos según una tabla que mapea cada dígito (0-9) a qué segmentos deben estar encendidos.
- Nivel avanzado: feeds `estacionamiento1` (y `estacionamiento2`) publican la cantidad de plazas OCUPADAS (no libres).
- Archivos: `barrera-pulsadores.ino`, `contador-display.ino`, `estacionamiento-no-bloqueante.ino`, `estacionamiento-iot.ino`.
- El nivel inicial sí usa `delay()` (fiel a la progresión pedagógica del original); recién en el avanzado se migra a `millis()`.

## Gotchas del proyecto ⚠️
- **BUG CRÍTICO del material original, ya corregido**: el esquema de 2019 conectaba los servos a los pines **0 y 1** del Arduino UNO — que son RX/TX, la comunicación serie por USB. Usarlos para servos rompe la carga de sketches y el Monitor Serie, y genera movimientos erráticos mientras la placa se comunica. En esta reedición los servos van a los pines **4 y 8** (libres). Si un alumno reproduce el esquema original tal cual, se va a encontrar con este bug.
- **Pulsadores con pull-up interno**, no con resistencia externa de 10 kΩ pull-down como en el original: se usa `INPUT_PULLUP` directo entre pin y GND. Las resistencias de 10 kΩ de la lista de insumos son opcionales/legado.
- **Error de copy-paste en el material original**: el nivel avanzado arrastraba texto y nombres de feeds de un proyecto de semáforo ("informar cada vez que cambie el estado del semáforo"). Está corregido: acá los feeds se llaman `estacionamiento1`/`estacionamiento2`.
- **Los servos consumen bastante corriente**: conviene alimentarlos con una fuente aparte, no solo desde el USB de la placa (más crítico aún en ESP32, donde se recomienda fuente externa de 5 V).
- **Servo con ESP32**: requiere la librería `ESP32Servo` (no la `Servo.h` estándar de AVR).

## Cómo ayudar al alumno
- Si al cargar el código el Arduino UNO no programa o el Monitor Serie se comporta raro: sospechar que el servo quedó conectado a pin 0 o 1 — hay que moverlo a 4/8.
- Si la barrera no sube al presionar el pulsador aunque haya lugar: revisar el cableado del pulsador a GND (pull-up interno) y que el pin coincida con el código.
- Si el display de 7 segmentos muestra números incorrectos: revisar el mapeo segmento→pin contra la tabla de `escribir_numero()`, y que cada segmento tenga su resistencia de 220 Ω.
- Si el contador de plazas queda negativo o supera la capacidad: revisar que las barreras solo se abran cuando corresponde (entrada con lugar disponible, salida siempre).
