# Proyecto 14 — Sistema Acuapónico
> El alumno automatiza por tiempo un sistema acuapónico: un aireador oxigena la pecera, una bomba recircula agua a las plantas y un dosificador impreso en 3D alimenta a los peces.

## De qué se trata
Automatización (no biológica) de un sistema acuapónico que combina cría de peces con cultivo de plantas en agua, recirculando agua y nutrientes entre la pecera y la batea. Se controlan tres actuadores por tiempo, sin sensores, con un ciclo de 60 segundos: el **aireador** (relé) que oxigena la pecera, la **bomba** (relé) que sube agua a las plantas y —desde el nivel intermedio— un **dosificador de alimento** movido por un motor DC con reducción a través de un ULN2003. El nivel avanzado publica el estado de los tres actuadores por IoT.

## Los niveles
- **Inicial — Aireador y bomba por tiempo**: cada uno con su relé, encendidos y apagados con un cronómetro no bloqueante (`millis() - inicioCiclo`) dentro de un ciclo de 60s. Concepto clave: por qué `delay()` no sirve cuando dos cargas tienen ciclos distintos que corren en simultáneo.
- **Intermedio — Dosificador**: se suma el motor DC del dosificador (vía ULN2003), mismo cronómetro de 60s. Concepto clave: el ULN2003 como intermediario para controlar un motor que consume más corriente de la que da un pin.
- **Avanzado — IoT**: misma lógica no bloqueante con variables de estado por actuador; en ESP32 publica por MQTT a Adafruit IO los feeds `aireador`, `bomba` y `dosificador` (0/1) cada vez que cambian.

**Todos los niveles son no bloqueantes desde el nivel inicial** (a diferencia de otros proyectos de la colección donde `delay()` aparece recién en niveles iniciales).

## Materiales
- Módulo relé de 5V (×2: aireador y bomba)
- Aireador (oxigenador) para peceras
- Bomba de agua
- Motor DC con reducción + módulo motor ULN2003 (dosificador, desde intermedio)
- Fuente de baja tensión (12V) para aireador y bomba
- Rollo de filamento PLA (piezas del dosificador)
- Protoboard, cables dupont macho-hembra y macho-macho, cables eléctricos
- Arduino UNO R3 o Placa ESP32 DevKit v1

## Pinout (exacto — de PINES_ACUAPONICO)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| Relé del aireador | 2 | GPIO 25 |
| Relé de la bomba | 3 | GPIO 26 |
| Dosificador — IN1 del ULN2003 | 4 | GPIO 27 |

## Cableado (de la tabla de conexionado)
| Desde | Hacia | Color |
|---|---|---|
| Placa · alimentación | Bus + protoboard | rojo |
| Placa · GND | Bus − protoboard | negro |
| Relé aireador · VCC / GND | Bus + / Bus − protoboard | rojo / negro |
| Relé aireador · IN | Placa · pin aireador | azul |
| Fuente de carga (+) | Relé aireador · COM | naranja |
| Relé aireador · NO | Aireador | naranja |
| Relé bomba · VCC / GND | Bus + / Bus − protoboard | rojo / negro |
| Relé bomba · IN | Placa · pin bomba | verde |
| Fuente de carga (+) | Relé bomba · COM | naranja |
| Relé bomba · NO | Bomba sumergible | naranja |
| ULN2003 · IN1 | Placa · pin dosificador | amarillo |
| Fuente aparte del motor (+/−) | ULN2003 · alimentación de motor | naranja |
| ULN2003 · OUT1 | Motor DC del dosificador | naranja |

## Código clave
- Cronómetro no bloqueante: `unsigned long inicioCiclo = 0;` y en cada `loop()`, `unsigned long transcurrido = millis() - inicioCiclo;` — cada actuador decide su propio estado mirando ese cronómetro, sin `delay()`.
- Regímenes de ejemplo (ciclo de 60s): aireador ON mientras `transcurrido < 20000` (20s ON / 40s OFF); bomba ON mientras `transcurrido < 5000` (5s ON / 55s OFF); dosificador ON mientras `transcurrido < 1000` (1s ON / 59s OFF). Son valores de ejemplo — se ajustan probando en la maqueta (sobre todo la bomba, para que la batea no rebalse).
- ULN2003 como interruptor de motor unidireccional: pin del micro → IN1; OUT1 → un borne del motor; el otro borne → positivo de la fuente aparte; GND común. HIGH = motor gira (dosifica), LOW = se detiene.
- IoT (solo ESP32, `acuaponico-iot.ino`): feeds `aireador`, `bomba`, `dosificador` (0/1), publicados por cambio de estado (event-driven) — máximo ~6 publicaciones/min, muy por debajo del límite de Adafruit IO.
- Archivos: `uno|esp32/nivel-inicial/acuaponico-temporizado.ino`, `nivel-intermedio/acuaponico-dosificador.ino`, `nivel-avanzado/acuaponico-no-bloqueante.ino` y (solo ESP32) `acuaponico-iot.ino`.

## Gotchas del proyecto ⚠️
- **La bomba NO debe funcionar en seco**: si se enciende fuera del agua, se quema. Primero llenar la pecera, recién ahí probar.
- El aireador y la bomba de una pecera real suelen ser cargas de 220V — en el aula se usan cargas de **baja tensión**; el relé y el cableado de 220V van siempre **fuera de la protoboard**, tarea del docente.
- Todas las conexiones eléctricas van **fuera y por encima del nivel del agua** — nada que conduzca electricidad cerca de la pecera.
- En ESP32 el módulo relé se alimenta con 5V (VCC al 5V/VIN), pero la señal de control es de 3.3V — la mayoría de los módulos la reconocen sin problema; GND debe ser común.
- El motor del dosificador (vía ULN2003) toma corriente de una **fuente aparte**, no de la placa ni del regulador del relé.

## Cómo ayudar al alumno
- Si el ciclo de 60s "se corta" o un actuador queda pegado: revisar que esté usando `millis()` bien (comparación con `transcurrido`, no acumulando `delay()`).
- Antes de energizar la bomba: preguntar siempre "¿ya está la pecera llena de agua?" — es el error más común y el que más rápido rompe hardware.
- Si el dosificador no gira: primero comprobar que el ULN2003 tenga alimentación de la fuente aparte (no solo la señal del pin) y que las masas estén unidas.
- Si el alumno pregunta por qué acá no hay `delay()` desde el nivel inicial como en otros proyectos: explicarle que es porque dos cargas con ciclos distintos corriendo a la vez no pueden esperar una a la otra.
