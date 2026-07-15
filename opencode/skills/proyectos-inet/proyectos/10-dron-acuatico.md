# Proyecto 10 — Dron Acuático
> El alumno construye e imprime en 3D un dron que navega sobre el agua: primero sigue una ruta programada, después esquiva obstáculos con ultrasónicos.

## De qué se trata
Un dron que se desplaza por la **superficie** del agua (no sumergido) movido por dos motores DC con paletas, comandados por un módulo ULN2003 (que solo puede prenderlos o apagarlos — dirección "tanque": frenar un motor para girar hacia ese lado). El nivel inicial ejecuta una vez un recorrido de barrido en "S" programado de antemano; el nivel avanzado suma tres sensores ultrasónicos (frente, izquierda, derecha) para detectar boyas y esquivarlas. El casco y las piezas se imprimen en 3D.

## Los niveles
- **Inicial — Recorrido programado**: trayectoria de barrido fija (boustrofedón, 14 pasos) que se ejecuta una sola vez en `setup()` con `delay()` y después el dron queda detenido. Concepto clave: control diferencial de dos motores unidireccionales.
- **Avanzado — Esquiva de obstáculos**: mide continuamente 3 ultrasónicos; si detecta una boya a menos de 40 cm, gira hacia el lado con más espacio libre usando una máquina de estados no bloqueante (`millis()`, sin `delay()`). Concepto clave: interpretar la lectura 0 del HC-SR04 como "fuera de rango", no como obstáculo pegado.

Este proyecto tiene **solo 2 niveles** (sin intermedio) y **no tiene variante IoT**.

## Materiales
- Módulo motor ULN2003 (driver unidireccional)
- 2 motores DC 5V (1500 rpm), uno por lado
- 3 sensores ultrasónicos HC-SR04 (desde el nivel avanzado)
- Portapilas 6×AA (alimenta motores, independiente de la placa)
- Filamento PLA (casco, soportes, rotores de paletas)
- Protoboard, cables dupont macho-hembra y macho-macho (20 c/u)
- Arduino UNO R3 o Placa ESP32 DevKit v1
- (ESP32) 6 resistencias para divisores de tensión del Echo (p. ej. 1kΩ y 2kΩ, 2 por sensor)

## Pinout (exacto — de PINES_DRON)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| Motor izquierdo (IN ULN2003) | 5 | GPIO 26 |
| Motor derecho (IN ULN2003) | 6 | GPIO 27 |
| Ultrasónico frente TRIG / ECHO | 2 / 3 | GPIO 5 / GPIO 18 |
| Ultrasónico izquierdo TRIG / ECHO | 8 / 9 | GPIO 19 / GPIO 21 |
| Ultrasónico derecho TRIG / ECHO | 10 / 11 | GPIO 22 / GPIO 23 |

## Cableado (de la tabla de conexionado)
| Desde | Hacia | Color |
|---|---|---|
| Placa · alimentación | Bus + protoboard | rojo |
| Placa · GND | Bus − protoboard | negro |
| Portapilas 6×AA (+) | ULN2003 · alimentación de motores | violeta |
| Portapilas 6×AA (−) | Bus − protoboard | violeta |
| ULN2003 · IN1 | Placa · pin motor izquierdo | verde |
| ULN2003 · OUT1 | Motor DC izquierdo | verde |
| ULN2003 · IN2 | Placa · pin motor derecho | naranja |
| ULN2003 · OUT2 | Motor DC derecho | naranja |
| Ultrasónico (c/u) · VCC | Bus + protoboard | rojo |
| Ultrasónico (c/u) · GND | Bus − protoboard | negro |
| Ultrasónico (c/u) · Trig | Placa · pin Trig correspondiente | amarillo |
| Ultrasónico (c/u) · Echo | Placa · pin Echo correspondiente | azul |

## Código clave
- Dirección diferencial: avanzar = ambos motores andando; girar a la derecha = motor derecho frenado; girar a la izquierda = motor izquierdo frenado; no hay marcha atrás (el ULN2003 no invierte giro).
- Constantes: `TIEMPO_AVANCE_MS = 3000` (tramo recto entre giros, nivel inicial), `TIEMPO_GIRO_MS = 700` (duración de frenado ≈ 90°), `UMBRAL_OBSTACULO_CM = 40`, `INTERVALO_MEDICION_MS = 100`, `MICROSEGUNDOS_POR_CM = 58`, `TIMEOUT_ECO_US = 30000`.
- Máquina de estados del nivel avanzado: `enum Estado { AVANZANDO, GIRANDO }`, con `finGiro` y `ultimaMedicion` controlados por `millis()` — el dron nunca queda "ciego" mientras gira.
- Cada sensor lee **su propio par** Trig/Echo (bug del original corregido: los tres leían siempre el sensor 1).
- Lectura 0 del HC-SR04 = fuera de rango (no hay eco), se descarta como obstáculo; solo cuenta `0 < distancia < 40cm`.
- Archivos: `uno|esp32/nivel-inicial/dron-recorrido.ino`, `nivel-avanzado/dron-esquiva.ino`.

## Gotchas del proyecto ⚠️
- **Divisor de tensión obligatorio en cada ECHO en ESP32**: el HC-SR04 alimentado a 5V devuelve el eco a 5V, y el ESP32 trabaja a 3.3V — sin divisor (ECHO —1kΩ— GPIO —2kΩ— GND) se daña el GPIO. TRIG no necesita divisor (los 3.3V del GPIO alcanzan para dispararlo). Alternativa: usar HC-SR04P (alimentable a 3.3V, sin divisores).
- Alimentar el ULN2003 y los motores desde las 6 pilas AA, **nunca desde el pin 3V3** de la placa — y unir las masas (GND del ESP32 con GND de las pilas).
- Bug corregido del original: el sensor 2 estaba mapeado a pines 6/7, pero el pin 6 ya era de un motor — acá se usa 8/9 sin conflicto.
- Electrónica, placa y portapilas van **por encima de la línea de flotación**, protegidos de salpicaduras; los sensores no deben mojarse (no es sumergible).

## Cómo ayudar al alumno
- Si el dron gira siempre para el mismo lado o no gira: revisar que cada ultrasónico esté leyendo su propio par de pines (no el mismo por copiar mal el cableado o el código).
- Si en ESP32 el dron se comporta errático o se resetea: sospechar que falta el divisor de tensión en algún ECHO.
- Si "esquiva" objetos que no existen: puede estar interpretando mal una lectura de 0 (fuera de rango) como obstáculo cercano — revisar la condición `> 0 && < 40`.
- Recordarle que este dron NO tiene marcha atrás por diseño (ULN2003 unidireccional) — es una limitación real de hardware, no un bug a "arreglar" en el código.
