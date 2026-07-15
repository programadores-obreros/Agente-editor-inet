# Proyecto 01 — Semaforización
> El alumno arma y programa un semáforo de intersección (2 semáforos, 6 LED), y en el nivel avanzado lo conecta a un panel de monitoreo por IoT.

## De qué se trata
Hay que fabricar el semáforo de una calle transitada: decidir el orden de las luces, cuánto dura cada una y cómo es el cambio entre ellas. Primero se arma y programa un semáforo simple de 3 LED (rojo/amarillo/verde) montado en una maqueta impresa en 3D. Después se agrega un segundo semáforo para la calle transversal, sincronizado con el primero (8 estados, sin que ambas calles tengan verde nunca a la vez). Por último se manda el estado de los semáforos a una central de monitoreo por Internet (IoT).

## Los niveles
- **Inicial — Construir y programar un semáforo**: circuito de 1 LED en protoboard (polaridad, resistencia), primer sketch (`setup()`/`loop()`, `pinMode`, `digitalWrite`, `delay`), expansión a 3 LED con los tiempos reales de un semáforo, y armado de la maqueta 3D soldando los LED.
- **Intermedio — Dos semáforos sincronizados en una intersección**: se suman 3 LED más (6 en total) y se programa la secuencia de 8 "viñetas" (verde/amarillo/rojo/todo-rojo) para que las dos calles nunca tengan verde juntas.
- **Avanzado — Monitoreo remoto con IoT**: se reescribe el semáforo como máquina de estados no bloqueante con `millis()` (nada de `delay()`), y se publica el estado por WiFi/MQTT a un panel en Adafruit IO (solo variante ESP32; en UNO el nivel se sigue de forma conceptual).

## Materiales
- Arduino UNO R3 o ESP32 DevKit v1
- 2× LED rojo, 2× LED amarillo, 2× LED verde (5 mm)
- 10× resistencia de 220 Ω
- Protoboard, cables dupont macho-hembra y macho-macho
- Filamento PLA para la maqueta (impresión 3D) o corte láser MDF 3 mm (rediseño alternativo)
- (Nivel avanzado, ESP32) cuenta en Adafruit IO, librería "Adafruit MQTT Library"

## Pinout (exacto — de PINES)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| Semáforo 1 · verde | pin 11 | GPIO 16 |
| Semáforo 1 · amarillo | pin 12 | GPIO 17 |
| Semáforo 1 · rojo | pin 13 | GPIO 18 |
| Semáforo 2 · verde | pin 8 | GPIO 19 |
| Semáforo 2 · amarillo | pin 9 | GPIO 21 |
| Semáforo 2 · rojo | pin 10 | GPIO 22 |

## Cableado (de la tabla de conexionado)
| Desde | Hacia | Color |
|---|---|---|
| Arduino/ESP32 · GND | Bus − de la protoboard | ⚫ negro |
| Semáforo 1 · LED verde (ánodo) | placa · pin verde | 🟢 verde |
| Semáforo 1 · LED verde (cátodo) | Resistencia 220 Ω → Bus − | ⚫ negro |
| Semáforo 1 · LED amarillo (ánodo) | placa · pin amarillo | 🟡 amarillo |
| Semáforo 1 · LED amarillo (cátodo) | Resistencia 220 Ω → Bus − | ⚫ negro |
| Semáforo 1 · LED rojo (ánodo) | placa · pin rojo | 🔴 rojo |
| Semáforo 1 · LED rojo (cátodo) | Resistencia 220 Ω → Bus − | ⚫ negro |
| Semáforo 2 · LED verde/amarillo/rojo | ídem con sus pines | 🟢🟡🔴 |

> No hay bus + de alimentación: cada LED se alimenta directo desde el pin digital de la placa. Todas las resistencias van al mismo GND.

## Código clave
- **Nivel inicial**: estructura secuencial simple con `delay()`. Tiempos reales: verde 5 s, amarillo 1 s, rojo 5 s, rojo+amarillo 1 s ("preparate para avanzar").
- **Nivel intermedio**: secuencia de 8 "viñetas" (cuadro congelado con la luz de cada semáforo + demora), archivo `interseccion.ino`. Nunca hay verde en ambas calles a la vez; hay dos viñetas de "todo rojo" (1 s) para dar tiempo a despejar la bocacalle.
- **Nivel avanzado**: reemplaza TODO `delay()` por `millis()` (código no bloqueante) — es el concepto central de la guía. Luego una **máquina de estados** de 8 estados ("Poner en…" / "Esperando en…"). Finalmente `semaforo-iot.ino` (solo ESP32): WiFi.h + Adafruit MQTT Library, publica en los feeds `semaforo1`/`semaforo2` de Adafruit IO con la convención 1=verde, 2=amarillo, 3=rojo (rojo+amarillo también publica 3).
- Archivos: `parpadeo.ino`, `semaforo-simple.ino`, `interseccion.ino`, `parpadeo-sin-delay.ino`, `semaforo-no-bloqueante.ino`, `semaforo-iot.ino`.

## Gotchas del proyecto ⚠️
- **Nunca usar `delay()` junto con IoT**: si el código queda bloqueado en un `delay()`, la conexión MQTT se cae y se pierden publicaciones. Por eso el nivel avanzado migra TODO a `millis()` antes de tocar WiFi.
- **Límite de Adafruit IO**: 30 publicaciones por minuto en la cuenta gratuita. El ciclo de la intersección genera 8 publicaciones cada 16 s — está justo al límite. Si Adafruit avisa "throttled", hay que alargar las duraciones del semáforo.
- **ESP32 trabaja a 3,3 V**, nunca inyectar 5 V en un GPIO.
- **UNO no tiene WiFi**: el nivel avanzado IoT solo se practica con ESP32 (el módulo OBLOQ del original está discontinuado). Con UNO, el nivel se sigue de forma conceptual.
- **Convención de valores IoT simplificada**: 1=verde, 2=amarillo, 3=rojo (el original tenía un 4º valor para rojo+amarillo que el panel nunca mostraba; se simplificó a 3 porque la luz roja sigue encendida en esa fase).
- **Polaridad del LED**: pata larga = positivo (ánodo, va al pin), pata corta = negativo (cátodo, va a la resistencia → GND). Invertida no rompe el LED pero no enciende.
- Error de protoboard más común: conexiones que no comparten fila (quedan en columnas no unidas eléctricamente).

## Cómo ayudar al alumno
- Si el LED no enciende: revisar polaridad (pata larga al pin) y que la fila de la protoboard sea la correcta.
- Si el orden de las luces está mal: revisar qué pin quedó asignado a cada color en el código, no el cableado.
- Si en el nivel intermedio dos luces del mismo semáforo quedan prendidas juntas fuera de lo esperado: revisar el orden de las instrucciones dentro de esa "viñeta".
- Si en el nivel avanzado alguna luz queda "pegada": revisar que cada estado "Poner en…" cambie correctamente al estado de "Esperando en…" correspondiente, y que cada espera compare contra el tiempo correcto.
- Si el panel de Adafruit IO no recibe datos: revisar SSID/contraseña WiFi y las credenciales (usuario + key) de Adafruit IO. Si llegan datos pero los indicadores no cambian: revisar la condición (igual a 1/2/3) de cada bloque Indicator.
