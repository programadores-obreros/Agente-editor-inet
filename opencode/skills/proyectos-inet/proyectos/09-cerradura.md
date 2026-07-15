# Proyecto 09 — Cerradura Automatizada
> El alumno arma una cerradura domiciliaria sin llave: un servo la traba/destraba, un teclado matricial valida una clave y avisa por buzzer.

## De qué se trata
Una cerradura de puerta que no necesita llave. Primero se abre y cierra con dos pulsadores y avisa su estado con dos LED (verde = abierta, rojo = cerrada). Después se reemplazan los pulsadores por un teclado matricial 4x4: el usuario ingresa una clave de 4 dígitos y un buzzer confirma si es correcta (pitido agudo) o incorrecta (doble pitido grave). Por último se monitorea el estado de la cerradura a distancia por IoT. El mecanismo (piñón y cremallera) se imprime en 3D.

## Los niveles
- **Inicial — Pulsadores**: servo + 2 LED movidos por 2 pulsadores (abrir/cerrar). Concepto clave: `INPUT_PULLUP` para no necesitar resistencias externas en los pulsadores, y control básico de un servo con ángulos fijos.
- **Intermedio — Teclado y clave**: teclado matricial 4x4 (librería Keypad) que arma un buffer de 4 dígitos y lo compara con la clave `1 5 9 D`. Si coincide, la cerradura conmuta (abre/cierra) y suena un pitido de OK; si no, doble pitido de error. Concepto clave: `tone()` para generar frecuencias distintas según el resultado.
- **Avanzado — No bloqueante + IoT**: misma lógica pero sin `delay()` (máquina de estados con `millis()` para los pitidos del buzzer), y en ESP32 se agrega WiFi + MQTT para publicar el estado (`cerradura`: 1 abierta / 0 cerrada) a Adafruit IO cada vez que cambia.

## Materiales
- Servomotor SG5010 (mecanismo de traba)
- 2 pulsadores (solo nivel inicial)
- Teclado matricial 4x4 de membrana (desde intermedio)
- LED verde (abierta) y LED rojo (cerrada), 5 mm difusos
- Buzzer/zumbador
- Resistencias de 220 Ω (para los LED)
- Protoboard, cables dupont macho-hembra (20)
- Filamento PLA (piezas del mecanismo: piñón, cremallera, soportes)
- Arduino UNO R3 o Placa ESP32 DevKit v1
- (UNO) fuente de 9V 1A opcional para alimentar sin PC

## Pinout (exacto — de PINES_CERRADURA)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| Servomotor | 10 | GPIO 13 |
| LED verde (abierta) | 11 | GPIO 25 |
| LED rojo (cerrada) | 13 | GPIO 26 |
| Buzzer | 12 | GPIO 14 |
| Teclado 4x4 — filas | 9, 8, 7, 6 | GPIO 16, 17, 18, 19 |
| Teclado 4x4 — columnas | 5, 4, 3, 2 | GPIO 21, 22, 23, 27 |
| Pulsador ABRIR (solo inicial) | 2 | GPIO 32 |
| Pulsador CERRAR (solo inicial) | 3 | GPIO 33 |

## Cableado (de la tabla de conexionado)
| Desde | Hacia | Color |
|---|---|---|
| Placa · 5V (VIN en ESP32) | Bus + protoboard | rojo |
| Placa · GND | Bus − protoboard | negro |
| Servo · VCC | Bus + protoboard | rojo |
| Servo · GND | Bus − protoboard | negro |
| Servo · señal | Placa · pin servo | azul |
| LED verde · ánodo (+) | Placa · pin LED verde | verde |
| LED verde · cátodo (−) → R 220Ω | Bus − protoboard | negro |
| LED rojo · ánodo (+) | Placa · pin LED rojo | rojo |
| LED rojo · cátodo (−) → R 220Ω | Bus − protoboard | negro |
| Teclado 4x4 · filas | Placa · pines de filas | amarillo |
| Teclado 4x4 · columnas | Placa · pines de columnas | amarillo |
| Buzzer · (+) | Placa · pin buzzer | violeta |
| Buzzer · (−) | Bus − protoboard | negro |

## Código clave
- Clave fija de 4 dígitos: `char clave[4] = {'1','5','9','D'}`, comparada dígito a dígito con lo tecleado (`claveCorrecta()`).
- Ángulos unificados en los tres niveles: `ANGULO_ABIERTA = 90`, `ANGULO_CERRADA = 0`. El sistema **arranca CERRADO** (LED rojo) — estado seguro por defecto.
- Buzzer con `tone(pin, frecuencia[, duración])`: `FREQ_OK = 1000` Hz (un pitido, clave correcta) vs `FREQ_ERROR = 400` Hz (doble pitido, clave incorrecta). En el nivel avanzado los pitidos se programan con `millis()` en vez de `delay()`.
- Librería del servo con guard de plataforma: `Servo.h` en UNO, `ESP32Servo.h` en ESP32.
- IoT (solo ESP32, `cerradura-iot.ino`): feed `cerradura` (1 abierta / 0 cerrada), publicación **event-driven** (solo cuando cambia el estado, no en cada loop) vía Adafruit MQTT Library.
- Archivos: `uno|esp32/nivel-inicial/cerradura-pulsador.ino`, `nivel-intermedio/cerradura-teclado.ino`, `nivel-avanzado/cerradura-no-bloqueante.ino` y (solo ESP32) `cerradura-iot.ino`.

## Gotchas del proyecto ⚠️
- El pin 0 del UNO es el RX del puerto serie: por eso NUNCA se usa el servo ahí (el original lo hacía y rompía la programación por USB). Acá el servo va siempre al pin 10 / GPIO 13.
- El servo **siempre se alimenta a 5V** (en ESP32, desde el pin 5V/VIN, NUNCA desde 3V3) con GND común a la placa — el 3V3 no da la corriente que necesita.
- El teclado usa 8 pines (4 filas + 4 columnas) para leer 16 teclas — no confundir con pines analógicos.
- El **IoT es irrealizable en Arduino UNO**: el módulo OBLOQ original usaba `SoftwareSerial(0,1)` (pines de programación) y la alternativa `(8,9)` choca con las filas del teclado. Por eso en UNO el nivel avanzado IoT es solo conceptual; la práctica real de IoT se hace en ESP32 con WiFi nativo + Adafruit MQTT Library.
- Pulsadores del nivel inicial usan `INPUT_PULLUP` (presionado = LOW): no hace falta resistencia externa, pero hay que programar la lógica invertida.

## Cómo ayudar al alumno
- Si el servo no se mueve o se resetea la placa: sospechar de alimentación insuficiente (¿está tomando 5V real, con GND compartido?).
- Si el teclado no responde o detecta teclas fantasma: revisar que filas y columnas no estén cruzadas o compartiendo pines con el servo/buzzer.
- Si el buzzer no distingue tonos: verificar que se use `tone()` y no `digitalWrite()` — un buzzer pasivo no suena con HIGH/LOW fijo.
- Si el alumno pregunta por qué no hay IoT "de verdad" en UNO: explicar el conflicto de pines con el teclado y el módulo discontinuado — es un caso real de cómo el hardware obsoleto obliga a migrar de plataforma.
