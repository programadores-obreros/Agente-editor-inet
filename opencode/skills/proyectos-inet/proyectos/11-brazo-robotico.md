# Proyecto 11 — Brazo Robótico

🔗 **Verlo en vivo (animación + simulador interactivo):** https://tecnialab.net.ar/proyectos/11-brazo-robotico/
> El alumno arma un brazo de 6 grados de libertad: primero lo calibra, después lo maneja con potenciómetros como mando a distancia, y por último programa una secuencia automática de pick-and-place.

## De qué se trata
Un brazo robótico de 6 servomotores (6 grados de libertad: base, hombro, codo, muñeca, rotación y pinza) que simula operaciones de un proceso productivo. Se arma con el kit del brazo (UNO usa el IO Expansion Shield DFRobot que apila sobre la placa y agrupa señal+VCC+GND por servo; ESP32 no tiene shield compatible y cablea cada servo directo a los GPIO). El nivel inicial calibra los 6 servos; el intermedio los comanda con 6 potenciómetros como mando a distancia; el avanzado ejecuta una secuencia pick-and-place automática que traslada objetos de una cinta a otra.

## Los niveles
- **Inicial — Calibración**: los 6 servos se llevan a 90° (centro del recorrido 0°–180°). `loop()` vacío a propósito (posición estática). Concepto clave: por qué 90° es el punto de partida seguro (rango simétrico en ambos sentidos).
- **Intermedio — Mando por potenciómetros**: cada potenciómetro comanda un servo en tiempo real. Se lee el ADC y se convierte a ángulo con una regla de tres: `ángulo = lectura * 180 / ADC_MAX`. Concepto clave: la resolución del ADC cambia según la placa (10 bits UNO vs 12 bits ESP32) y hay que ajustar la conversión.
- **Avanzado — Secuencia pick-and-place**: una tabla de POSES (6 ángulos + tiempo de espera cada una) que avanza con una máquina de estados no bloqueante basada en `millis()`. La pose 0 es el HOME (una vez); las poses 1–9 son el ciclo productivo que se repite. Concepto clave: separar los "datos" del movimiento (la tabla) de la "lógica" que la recorre.

Este proyecto **no tiene nivel IoT** — los tres niveles son de control local.

## Materiales
- 6 servomotores estándar (de 3 cables: señal, VCC, GND)
- IO Expansion Shield DFRobot V7.1 (solo UNO — no compatible con ESP32)
- 6 potenciómetros (desde intermedio)
- Fuente de alimentación externa 5V/2A **obligatoria** (los 6 servos no se pueden alimentar por USB)
- Protoboard de 830 puntos, cables dupont macho-hembra
- Filamento PLA (piezas del brazo, si aplica)
- Arduino UNO R3 o Placa ESP32 DevKit v1

## Pinout (exacto — de PINES_BRAZO)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| Servo 1 (base) | 2 | GPIO 13 |
| Servo 2 | 3 | GPIO 14 |
| Servo 3 | 4 | GPIO 25 |
| Servo 4 | 5 | GPIO 26 |
| Servo 5 | 6 | GPIO 27 |
| Servo 6 (pinza) | 7 | GPIO 32 |
| Potenciómetro 1 → servo 1 | A0 | GPIO 36 (ADC1_CH0, solo entrada) |
| Potenciómetro 2 → servo 2 | A1 | GPIO 39 (ADC1_CH3, solo entrada) |
| Potenciómetro 3 → servo 3 | A2 | GPIO 34 (ADC1_CH6, solo entrada) |
| Potenciómetro 4 → servo 4 | A3 | GPIO 35 (ADC1_CH7, solo entrada) |
| Potenciómetro 5 → servo 5 | A4 | GPIO 33 (ADC1_CH5) |
| Potenciómetro 6 → servo 6 | A5 | GPIO 4 (ADC2_CH0) |

## Cableado (de la tabla de conexionado)
| Desde | Hacia | Color |
|---|---|---|
| Placa · alimentación | Bus + protoboard | rojo |
| Placa · GND | Bus − protoboard | negro |
| Fuente externa 5V/2A (+) | Bus + de servos (independiente) | rojo |
| Fuente externa 5V/2A (−) | Bus − protoboard | negro |
| Servo N · VCC | Bus + de servos (independiente) | rojo |
| Servo N · GND | Bus − protoboard | negro |
| Servo N · señal | Placa · pin servo N | azul |
| Potenciómetro N · extremo A | Bus + protoboard | rojo |
| Potenciómetro N · extremo B | Bus − protoboard | negro |
| Potenciómetro N · cursor | Placa · pin pot N | amarillo |

## Código clave
- Servo con guard de plataforma: `Servo.h` en UNO, `ESP32Servo.h` en ESP32 (la clásica `Servo.h` no compila en ESP32).
- Conversión ADC → ángulo: UNO `ADC_MAX = 1023` (10 bits), ESP32 `ADC_MAX = 4095` (12 bits, no hace falta `analogReadResolution`). Usar aritmética `long` para no desbordar `lectura * 180` antes de dividir.
- Estructura `Pose` del nivel avanzado: `struct Pose { int angulos[CANT_SERVOS]; unsigned long espera_ms; };` con un arreglo `const Pose SECUENCIA[] = {...}` — la pose 0 es HOME (todos a 90°, 2000ms), las siguientes son el ciclo pick-and-place.
- Archivos: `uno|esp32/nivel-inicial/brazo-calibracion.ino`, `nivel-intermedio/brazo-potenciometros.ino`, `nivel-avanzado/brazo-secuencia.ino`.

## Gotchas del proyecto ⚠️
- **FUENTE EXTERNA 5V/2A OBLIGATORIA**: seis servos consumen más corriente de la que da el puerto USB — alimentar por USB puede resetear la placa o dañar el regulador. La fuente va con GND común a la placa.
- **Mapa de GPIO en ESP32 sin colisiones (ajustado)**: solo hay 6 GPIO ADC1 utilizables (`32,33,34,35,36,39`) y el GPIO 32 ya lo usa el servo 6 — quedan 5 libres para potes. La sexta entrada usa **GPIO 4 (ADC2)**, que solo entra en conflicto si hay WiFi activo (este proyecto no tiene WiFi, así que funciona bien). No reemplazar ese GPIO 4 por otro sin revisar que no sea un strapping pin (0, 2, 12, 15 están descartados).
- Los potenciómetros en ESP32 se alimentan a **3.3V, no 5V** — con 5V se satura la lectura del ADC y se puede dañar el pin. La potencia de los servos sí sale de la fuente externa 5V.
- Precaución **mecánica**: el brazo tiene 6 grados de libertad y barre un área amplia; al arrancar los servos saltan a 90° de golpe. Despejar la zona antes de energizar, sobre todo en el nivel avanzado (movimiento autónomo continuo).
- ESP32 no tiene el IO Expansion Shield del kit — ahí se cablea directo a los GPIO (no intentar usar el shield en ESP32, es formato UNO).

## Cómo ayudar al alumno
- Si algún servo no responde o tiembla: primero descartar la fuente (¿está la externa conectada y con GND común?), no el código.
- Si en ESP32 un potenciómetro no lee bien o siempre da el mismo valor: revisar que no esté en un GPIO de solo-salida o en conflicto con un servo (ver mapa de arriba).
- Si el ángulo del servo se pasa de 180° o se queda corto en ESP32: sospechar que sigue dividiendo por 1023 en vez de 4095 (código copiado de UNO sin adaptar).
- Antes de correr el nivel avanzado: recordarle que despeje la zona — el brazo se mueve solo y de forma continua.
