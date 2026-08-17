# Proyecto 09 — Cerradura Automatizada

🔗 **Verlo en vivo (animación + simulador interactivo):** https://tecnialab.net.ar/proyectos/09-cerradura/
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
- **Buzzer PASIVO (piezoeléctrico)** — pasivo, no activo: ver el gotcha del buzzer, es la diferencia entre un pin sano y un pin arruinado
- Resistencias de 220 Ω (para los LED)
- **1 resistencia de 330 Ω** (limitadora en serie con el buzzer; si no tenés, dos de 220 Ω en serie)
- **Fuente externa de 5 V (1 A o más) para el servo — OBLIGATORIA en UNO y en ESP32**, con GND común a la placa
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
| Buzzer **pasivo** (con R 330 Ω en serie) | 12 | GPIO 14 |
| Teclado 4x4 — filas | 9, 8, 7, 6 | GPIO 16, 17, 18, 19 |
| Teclado 4x4 — columnas | 5, 4, 3, 2 | GPIO 21, 22, 23, 27 |
| Pulsador ABRIR (solo inicial) | 2 | GPIO 32 |
| Pulsador CERRAR (solo inicial) | 3 | GPIO 33 |

## Cableado (de la tabla de conexionado)
| Desde | Hacia | Color |
|---|---|---|
| **Fuente externa 5 V (+)** | **Bus + del servo** (independiente) | rojo |
| **Fuente externa 5 V (−)** | Bus − protoboard | negro |
| Placa · GND | Bus − protoboard | negro |
| **Servo · VCC** | **Bus + del servo (NO al pin de la placa)** | rojo |
| Servo · GND | Bus − protoboard | negro |
| Servo · señal | Placa · pin servo | azul |
| LED verde · ánodo (+) | Placa · pin LED verde | verde |
| LED verde · cátodo (−) → R 220Ω | Bus − protoboard | negro |
| LED rojo · ánodo (+) | Placa · pin LED rojo | rojo |
| LED rojo · cátodo (−) → R 220Ω | Bus − protoboard | negro |
| Teclado 4x4 · filas | Placa · pines de filas | amarillo |
| Teclado 4x4 · columnas | Placa · pines de columnas | amarillo |
| Placa · pin buzzer | **Resistencia 330 Ω · pata 1** | violeta |
| **Resistencia 330 Ω · pata 2** | **Buzzer PASIVO · (+)** | violeta |
| Buzzer · (−) | Bus − protoboard | negro |

> **El buzzer va con limitadora y va PASIVO. Las dos cosas, y por motivos distintos.**
>
> **Pasivo, porque es lo único que `tone()` puede manejar.** Un buzzer *activo* trae su propio oscilador adentro: con HIGH suena a su única frecuencia y con LOW se calla — no tiene forma de hacer el pitido agudo de 1000 Hz ni el grave de 400 Hz que este proyecto usa para distinguir clave correcta de incorrecta. El *pasivo* es un piezoeléctrico sin oscilador: la frecuencia se la pone el pin, y por eso `tone()` funciona. Esto ya lo dice el apartado de ayuda de más abajo; lo que faltaba era decirlo donde se compra el componente.
>
> **Y pasivo, además, porque el activo se lleva puesto el pin.** Un buzzer activo de 5 V consume **25–30 mA**; el máximo especificado de un pin es **20 mA**. El pasivo piezoeléctrico consume **menos de 1 mA**. La tabla eléctrica del proyecto (`electrica.ts` → `SIN_DATOS_A_PROPOSITO['Device:Buzzer']`) deja este dato explícitamente EN BLANCO **y nombra a esta cerradura** como el caso: «en 09-cerradura cuelga directo de un pin sin limitadora. Es la diferencia entre un pin sano y un pin degradado, y nadie declaró cuál es». Esta ficha lo declara: **PASIVO**.
>
> **Un buzzer activo de 5 V no va NUNCA directo al pin**, ni en UNO ni en ESP32. Si sólo conseguís uno activo, no lo enchufes al pin: va con transistor (el pin maneja la base, el buzzer cuelga del riel) — y de paso perdés los dos tonos, así que el proyecto queda a medias.
>
> **Y la placa acá no alimenta ningún bus +.** El servo cuelga de su fuente externa; los LED los alimenta cada pin a través de su resistencia; el teclado y los pulsadores usan `INPUT_PULLUP` (van del pin a masa). Lo único que sale de la placa hacia la protoboard es el **GND**, que sí es común a todo — la fuente del servo incluida. Si en tu armado hay un cable del 5V de la placa al bus + y de ahí al VCC del servo, ése es justamente el error que esta ficha corrige.
>
> **De dónde sale el 330 Ω.** La limitadora está para que ni siquiera una equivocación pase del límite del pin: en el peor caso de tensión de riel (5,25 V) por 330 Ω circulan **15,9 mA**, dentro de los 20 mA que `electrica.ts` marca como error. Con los 220 Ω del kit darían 24 mA, apenas por encima — por eso 330, o dos de 220 en serie. **Ojo con la procedencia**: ese valor NO sale de ninguna hoja de datos de buzzer; sale de la aritmética contra el límite de pin que `electrica.ts` sí declara. Con un piezo pasivo real (menos de 1 mA) la resistencia casi no se nota en el volumen: no estás sacrificando sonido, estás poniendo un techo.

## Código clave
- Clave fija de 4 dígitos: `char clave[4] = {'1','5','9','D'}`, comparada dígito a dígito con lo tecleado (`claveCorrecta()`).
- Ángulos unificados en los tres niveles: `ANGULO_ABIERTA = 90`, `ANGULO_CERRADA = 0`. El sistema **arranca CERRADO** (LED rojo) — estado seguro por defecto.
- Buzzer con `tone(pin, frecuencia[, duración])`: `FREQ_OK = 1000` Hz (un pitido, clave correcta) vs `FREQ_ERROR = 400` Hz (doble pitido, clave incorrecta). En el nivel avanzado los pitidos se programan con `millis()` en vez de `delay()`.
- Librería del servo con guard de plataforma: `Servo.h` en UNO, `ESP32Servo.h` en ESP32.
- IoT (solo ESP32, `cerradura-iot.ino`): feed `cerradura` (1 abierta / 0 cerrada), publicación **event-driven** (solo cuando cambia el estado, no en cada loop) vía Adafruit MQTT Library.
- Archivos: `uno|esp32/nivel-inicial/cerradura-pulsador.ino`, `nivel-intermedio/cerradura-teclado.ino`, `nivel-avanzado/cerradura-no-bloqueante.ino` y (solo ESP32) `cerradura-iot.ino`.

## Gotchas del proyecto ⚠️
- El pin 0 del UNO es el RX del puerto serie: por eso NUNCA se usa el servo ahí (el original lo hacía y rompía la programación por USB). Acá el servo va siempre al pin 10 / GPIO 13.
- **EL SERVO VA A FUENTE EXTERNA DE 5 V, NO AL PIN DE LA PLACA — en UNO también.** Antes esta ficha decía "se alimenta a 5 V desde el pin 5V/VIN": el 5 V estaba bien, el *de dónde* estaba mal. Los números: el módulo de servo de 3 pines de este kit pide un mínimo de **4,8 V** y consume **250 mA moviéndose, hasta 700 mA con el rotor trabado** (`electrica.ts` → `TecniaLab:Modulo_Servo_3P`, hoja del TowerPro SG90; el SG5010 es más grande, así que no consume menos). El riel de 5 V del UNO por USB da **450 mA** en total y ya avisa a los 300. Y una **cerradura llega al tope en uso normal**: el pasador termina su recorrido y el servo se queda haciendo fuerza contra el fin de carrera — la propia tabla eléctrica dice que ese máximo de bloqueo «es el de un servo de barrera o de pinza que llega al tope mecánico en operación NORMAL, no en una falla». Con la traba, esto es exactamente ese caso. Fuente de 5 V aparte, **bus + propio para el servo**, y **GND común** con la placa (sin GND común el PWM no tiene referencia y el servo tiembla). Nunca al 3V3, obvio: no llega ni a la tensión mínima.
- **El buzzer es PASIVO y va con resistencia de 330 Ω en serie** (ver la nota completa bajo la tabla de cableado). Un buzzer activo de 5 V se lleva 25–30 mA de un pin cuyo máximo son 20, y encima no puede hacer los dos tonos que este proyecto necesita.
- El teclado usa 8 pines (4 filas + 4 columnas) para leer 16 teclas — no confundir con pines analógicos.
- El **IoT es irrealizable en Arduino UNO**: el módulo OBLOQ original usaba `SoftwareSerial(0,1)` (pines de programación) y la alternativa `(8,9)` choca con las filas del teclado. Por eso en UNO el nivel avanzado IoT es solo conceptual; la práctica real de IoT se hace en ESP32 con WiFi nativo + Adafruit MQTT Library.
- Pulsadores del nivel inicial usan `INPUT_PULLUP` (presionado = LOW): no hace falta resistencia externa, pero hay que programar la lógica invertida.

## Cómo ayudar al alumno
- Si el servo no se mueve, tiembla, o **se resetea la placa justo cuando traba la cerradura**: no es el código, es la alimentación. Preguntá dos cosas en este orden: ¿el VCC del servo sale de la **fuente externa** (no del pin de la placa)? ¿está el **GND de esa fuente unido** al GND de la placa? Con el servo colgado del pin de 5 V, el reset al llegar al tope es el síntoma clásico.
- Si el buzzer suena siempre igual aunque el código use dos frecuencias: es un buzzer **activo**, no pasivo. No se arregla por software — hay que cambiar el componente (y mientras tanto, sacalo del pin: se lleva 25–30 mA de un pin de 20).
- Si el teclado no responde o detecta teclas fantasma: revisar que filas y columnas no estén cruzadas o compartiendo pines con el servo/buzzer.
- Si el buzzer no distingue tonos: verificar que se use `tone()` y no `digitalWrite()` — un buzzer pasivo no suena con HIGH/LOW fijo.
- Si el alumno pregunta por qué no hay IoT "de verdad" en UNO: explicar el conflicto de pines con el teclado y el módulo discontinuado — es un caso real de cómo el hardware obsoleto obliga a migrar de plataforma.
