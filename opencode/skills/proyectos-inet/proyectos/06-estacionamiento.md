# Proyecto 06 — Estacionamiento automatizado

🔗 **Verlo en vivo (animación + simulador interactivo):** https://tecnialab.net.ar/proyectos/06-estacionamiento/
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
- **Fuente externa de 5 V (2 A) para los servos — OBLIGATORIA en UNO y en ESP32**, con GND común a la placa (ver la nota del cableado)
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
| Display 7 seg · segmento **a** | pin 12 | GPIO 16 (rotulado **RX2** en la placa) |
| Display 7 seg · segmento **b** | pin 13 | GPIO 17 (rotulado **TX2** en la placa) |
| Display 7 seg · segmento **c** | pin 5 | GPIO 18 |
| Display 7 seg · segmento **d** | pin 6 | GPIO 19 |
| Display 7 seg · segmento **e** | pin 7 | GPIO 21 |
| Display 7 seg · segmento **f** | pin 11 | GPIO 22 |
| Display 7 seg · segmento **g** | pin 10 | GPIO 23 |
| LED verde (nivel inicial) | pin 9 | — |
| LED rojo (nivel inicial) | pin 13 | — |

> **Por qué el display va enumerado segmento por segmento y no como "GPIO 16..23".** Un rango con puntos suspensivos da OCHO números para SIETE segmentos, y encima mete uno que no existe: **el ESP32-WROOM-32 no tiene GPIO 20**. La tabla de pines de la placa (`PINES_ESP32_DEVKIT`) va del D19 al D21 sin escala intermedia — entre medio están el RX2 (GPIO 16) y el TX2 (GPIO 17), que son los que acá hacen de segmentos **a** y **b**. Si un alumno lee "16..23" y cuenta ocho, va a buscar un pin fantasma en el header y a cablear cualquier cosa. Los siete GPIO reales son **16, 17, 18, 19, 21, 22 y 23**, en ese orden para a–g.
>
> Los GPIO 16 y 17 en la serigrafía de casi todas las DevKit v1 aparecen como **RX2/TX2**: es el segundo puerto serie por hardware, que este proyecto no usa. Podés usarlos como salidas digitales comunes sin problema — pero buscá el rótulo RX2/TX2, no un "16"/"17" que la plaquita no imprime.

## Cableado (de la tabla de conexionado)
| Desde | Hacia | Color |
|---|---|---|
| **Fuente externa 5 V (+)** | **Bus + de servos** (independiente) | 🔴 rojo |
| **Fuente externa 5 V (−)** | Bus − protoboard | ⚫ negro |
| Placa · GND | Bus − protoboard | ⚫ negro |
| Servo entrada · VCC | **Bus + de servos** (NO al pin de la placa) | 🔴 rojo |
| Servo entrada · GND | Bus − protoboard | ⚫ negro |
| Servo entrada · señal | placa · pin correspondiente | 🔵 azul |
| Servo salida · VCC | **Bus + de servos** (NO al pin de la placa) | 🔴 rojo |
| Servo salida · GND | Bus − protoboard | ⚫ negro |
| Servo salida · señal | placa · pin correspondiente | 🟠 naranja |
| Pulsador entrada | placa · pin correspondiente | 🟡 amarillo |
| Pulsador salida | placa · pin correspondiente | 🟣 violeta |
| Display 7 seg · a–g (c/u con R 220 Ω) | placa · pines correspondientes | 🟢 verde |
| Display 7 seg · común | Bus − protoboard | ⚫ negro |

> **La fuente externa de 5 V para los servos NO es opcional, y no es sólo para el ESP32.** El módulo de servo de 3 pines de este kit se lleva **250 mA moviéndose y hasta 700 mA con el rotor trabado** (`electrica.ts` → `TecniaLab:Modulo_Servo_3P`, hoja del TowerPro SG90; el SG-5010 es más grande, así que no consume menos). El riel de 5 V del Arduino UNO alimentado por USB da **450 mA** en total (polyfuse de 500 mA menos lo que consume la propia placa) y ya avisa a los 300. Dos servos moviéndose a la vez son 500 mA: por arriba del tope, sin contar el display.
>
> Y no es un caso de falla raro: la misma tabla eléctrica lo dice con todas las letras — «un servo **de barrera** o de pinza llega al tope mecánico en operación NORMAL, no en una falla». Una barrera que baja y apoya QUEDA trabada contra el tope, tirando los 700 mA, cada vez que pasa un auto. Eso es el uso normal de este proyecto.
>
> **Los servos van a un bus + propio**, alimentado por una fuente de 5 V aparte (2 A alcanza para los dos), y ese bus **no se une nunca al bus + de la placa**. Lo único que se comparte es el **GND**: el negativo de la fuente va al mismo bus − que la placa. Sin GND común la señal de PWM no tiene referencia y el servo tiembla o no se mueve. Es el mismo esquema que ya usa el proyecto 11 (brazo robótico) con sus seis servos.
>
> Fijate que acá **la placa no alimenta ningún bus +**: los pulsadores usan `INPUT_PULLUP` (van del pin a masa, sin riel positivo) y el display es de cátodo común (el común va a masa y los segmentos los alimenta cada pin a través de su resistencia). Lo único que sale de la placa hacia la protoboard es el **GND**. Si en tu armado hay un cable del 5V de la placa al bus +, sobra — y si además ese cable alimenta los servos, es exactamente el error que esta ficha corrige.

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
- **FUENTE EXTERNA DE 5 V PARA LOS SERVOS, OBLIGATORIA EN LAS DOS PLACAS** (antes esta ficha decía "conviene", y sólo para ESP32: estaba mal). Los números: 250 mA por servo moviéndose y hasta 700 mA con el rotor trabado (`electrica.ts` → `TecniaLab:Modulo_Servo_3P`) contra los 450 mA que da el riel de 5 V del UNO por USB. Dos barreras moviéndose ya se pasan; una barrera apoyada contra su tope mecánico —que es lo que hace CADA VEZ que baja— se lleva sola más que todo el riel. El síntoma típico no es "no anda": es que la placa se resetea sola cuando baja la barrera, y el alumno busca el error en el código durante dos clases. La fuente va con **GND común** a la placa, y su bus + **separado** del bus + de la placa.
- **Ojo con el nombre del pin en el ESP32**: los segmentos **a** y **b** van a GPIO 16 y 17, que la serigrafía de la DevKit v1 imprime como **RX2** y **TX2**. Y **el GPIO 20 no existe** en el ESP32-WROOM-32 — si alguien te pasa "GPIO 16 a 23" como rango, ese rango tiene un pin inventado adentro.
- **Servo con ESP32**: requiere la librería `ESP32Servo` (no la `Servo.h` estándar de AVR).

## Cómo ayudar al alumno
- Si al cargar el código el Arduino UNO no programa o el Monitor Serie se comporta raro: sospechar que el servo quedó conectado a pin 0 o 1 — hay que moverlo a 4/8.
- Si la barrera no sube al presionar el pulsador aunque haya lugar: revisar el cableado del pulsador a GND (pull-up interno) y que el pin coincida con el código.
- Si el display de 7 segmentos muestra números incorrectos: revisar el mapeo segmento→pin contra la tabla de `escribir_numero()`, y que cada segmento tenga su resistencia de 220 Ω.
- Si la placa se reinicia sola justo cuando baja una barrera (o el Monitor Serie se corta): no busques el bug en el código — es la alimentación. El servo apoyado contra su tope se lleva más corriente que todo el riel de 5 V de la placa. Fuente externa con GND común, y el bus + de los servos separado.
- Si el display del ESP32 no enciende dos segmentos y el alumno dice que "el 20 no funciona": el GPIO 20 no existe en esta placa. Los segmentos a y b van a GPIO 16 y 17, rotulados RX2 y TX2 en la serigrafía.
- Si el contador de plazas queda negativo o supera la capacidad: revisar que las barreras solo se abran cuando corresponde (entrada con lugar disponible, salida siempre).
