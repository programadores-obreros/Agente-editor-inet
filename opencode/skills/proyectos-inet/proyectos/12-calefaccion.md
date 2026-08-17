# Proyecto 12 — Sistema de Calefacción Automático

🔗 **Verlo en vivo (animación + simulador interactivo):** https://tecnialab.net.ar/proyectos/12-calefaccion/
> El alumno automatiza un radiador eléctrico: primero por temporizador, después como termostato real con sensor de temperatura, y por último con monitoreo remoto IoT.

## De qué se trata
Un módulo relé conmuta un radiador eléctrico de 220V. El nivel inicial lo enciende y apaga por tiempos fijos (sin sensores). El intermedio suma un sensor DHT11 y un potenciómetro que fija la temperatura objetivo: el relé actúa como termostato real (enciende si hace frío) y un LCD muestra los valores. El avanzado es no bloqueante (`millis()`) y agrega IoT para monitorear temperatura y humedad a distancia. Es casi gemelo del proyecto 04 (Invernadero): mismo DHT11 + LCD, pero con relé en vez de LED y una carga de 220V.

## Los niveles
- **Inicial — Temporizador**: relé enciende el radiador 10 min ON / 15 min OFF con `delay()`, sin sensores.
- **Intermedio — Termostato con LCD**: DHT11 mide temperatura; el potenciómetro fija el objetivo (0–30°C); el relé enciende si `temperatura < objetivo`; el LCD muestra ambos valores.
- **Avanzado — No bloqueante + IoT**: misma lógica con `millis()` en vez de `delay()` (el relé se reemplaza por un LED para probar sin 220V); en ESP32 se agrega publicación MQTT de `temperatura` y `humedad` a Adafruit IO.

## Materiales
- Sensor DHT11 (humedad y temperatura)
- Módulo relé
- Potenciómetro de 10 kΩ (temperatura objetivo)
- Radiador eléctrico de 220V (para el aula: lámpara de baja tensión o el LED de prueba)
- **LED de prueba (5 mm) + resistencia de 220 Ω** para el nivel avanzado — la resistencia no es opcional: un LED no limita su propia corriente. En UNO el pin 13 ya trae el LED de la placa con su limitadora incorporada; el LED **externo** del ESP32 (GPIO 16) necesita la suya sí o sí (`electrica.ts` → `Device:LED` marca `exigeLimitadora: true`)
- Display LCD Keypad Shield (UNO) / Display LCD 1602 con módulo I2C (ESP32)
- Protoboard, cables dupont macho-hembra y macho-macho
- Arduino UNO R3 o Placa ESP32 DevKit v1
- (UNO) fuente de 9V 1A opcional

## Pinout (exacto — de PINES_CALEFACCION)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| Relé (radiador 220V) | 3 | GPIO 25 |
| DHT11 (dato) | 2 | GPIO 4 |
| Display LCD | 8, 9, 4, 5, 6, 7 (paralelo, LCD Keypad Shield) | SDA GPIO 21 / SCL GPIO 22 (I2C) |
| Potenciómetro (temp. objetivo) | A1 | GPIO 34 (ADC1, solo entrada) |
| LED de prueba (avanzado, reemplaza al relé) | 13 | GPIO 16 (externo) |

## Cableado (de la tabla de conexionado)
**En ESP32 hay DOS buses +, y cada módulo va en el suyo.** En UNO hay uno solo, el de 5 V.

| Desde | Hacia | Color |
|---|---|---|
| Placa · **5V** (UNO) / **VIN** (ESP32) | **Bus +5V** | rojo |
| Placa · **3V3** (sólo ESP32) | **Bus +3V3** | naranja |
| Placa · GND | Bus − protoboard | negro |
| **Sensor DHT11 · VCC** | UNO: Bus +5V — **ESP32: Bus +3V3** | rojo / naranja |
| Sensor DHT11 · GND | Bus − protoboard | negro |
| Sensor DHT11 · DATA | Placa · pin DHT | amarillo |
| **Módulo relé · VCC** | **Bus +5V** (siempre, las dos placas) | rojo |
| Módulo relé · GND | Bus − protoboard | negro |
| Módulo relé · IN | Placa · pin relé | azul |
| Enchufe 220V (docente) | Relé · COM | naranja |
| Relé · NO | Radiador | naranja |
| **Potenciómetro · extremo A** | UNO: Bus +5V — **ESP32: Bus +3V3** | rojo / naranja |
| Potenciómetro · extremo B | Bus − protoboard | negro |
| Potenciómetro · cursor | Placa · pin potenciómetro | violeta |
| **(ESP32) LCD 1602 I2C · VCC** | **Bus +5V** | rojo |
| (ESP32) LCD 1602 I2C · GND | Bus − protoboard | negro |
| (ESP32) LCD 1602 I2C · SDA | Placa · GPIO 21 | verde |
| (ESP32) LCD 1602 I2C · SCL | Placa · GPIO 22 | naranja |
| (UNO) LCD Keypad Shield | apilado sobre pines digitales (RS 8, E 9, D4-D7 4/5/6/7) | blanco |
| **LED de prueba (avanzado, ESP32) · ánodo** | **Resistencia 220 Ω → Placa · GPIO 16** | azul |
| **LED de prueba (avanzado, ESP32) · cátodo** | Bus − protoboard | negro |

> **POR QUÉ DOS BUSES Y NO UNO "de alimentación".** Un renglón que dice "Placa · alimentación → Bus +" no decide nada, y después los cuatro componentes cuelgan del mismo riel sin nombre. Acá quieren cosas incompatibles:
>
> - **Módulo relé → 5 V, obligatorio.** Bobina SRD-05VDC-SL-C de 5 V nominal, y la plaqueta necesita 5 V para el optoacoplador y el transistor de mando: **mínimo 4,5 V** (`electrica.ts` → `TecniaLab:Modulo_Rele_1CH`). A 3,3 V no engancha, o engancha a veces.
> - **LCD 1602 con mochila I²C → 5 V.** El HD44780 pide 5 V para el contraste del cristal: **mínimo 4,5 V** (`electrica.ts` → `TecniaLab:Modulo_LCD_I2C`). La mochila tolera menos, el display no: a 3,3 V queda en blanco con la luz prendida.
> - **DHT11 → 3,3 V en ESP32.** Se alimenta de **3 a 5,5 V** (`electrica.ts` → `TecniaLab:Modulo_DHT_3P`), así que a 3,3 V anda perfecto. Y va ahí porque su DATA es un solo hilo con **pull-up de 4,7 kΩ en la propia plaqueta**: alimentado a 5 V, ese pull-up levanta el GPIO 4 a 5 V.
> - **Potenciómetro → 3,3 V en ESP32.** Es un **divisor**: el cursor entrega, como máximo, la tensión que le pongas en el extremo A. Con 5 V, al girarlo a fondo le manda ~5 V al **GPIO 34**, que es de **solo entrada y sin protección**. Además la lectura satura mucho antes del tope y el termostato deja de poder fijar los 30 °C. Es exactamente lo que ya advierte el proyecto 11 con sus seis potenciómetros: *«los potenciómetros en ESP32 se alimentan a 3,3 V, no 5 V»*.
>
> Los dos buses **no se unen nunca entre sí**; el **GND es uno solo y común**. En UNO no hay dilema: un único riel de 5 V, y el A1 tolera 5 V sin problema.
>
> ⚠️ **Lo que queda pendiente y hay que mirar con el módulo en la mano (ESP32):** la mochila I²C alimentada a 5 V tiene **sus pull-ups de SDA/SCL contra 5 V**, así que el bus reposa en 5 V y eso toca los GPIO 21/22. `electrica.ts` declara que los pull-ups están en la mochila, pero **no declara su valor ni contra qué tensión quedan** en cada plaqueta concreta, así que esta ficha no puede afirmar que sea seguro. **Medí SDA y SCL con el téster** (en reposo, con el LCD alimentado y el ESP32 apagado): si marcan ~5 V, va un **conversor de nivel bidireccional I²C** entre la mochila y la placa, o una mochila con los pull-ups del lado de 3,3 V. Es el mismo pendiente del proyecto 04.

## Código clave
- Termostato: `objetivo = analogRead(PIN_POTENCIOMETRO) * TEMP_OBJETIVO_MAX_C / ADC_MAX` (regla de tres, pote en 0 → 0°C, al máximo → 30°C). Relé enciende si `temperatura < objetivo` — **atención**: la lógica correcta de calefacción es la inversa de la del invernadero (que ventila si hace calor).
- `ADC_MAX`: 1023 en UNO (10 bits), 4095 en ESP32 (12 bits).
- DHT11 con la librería "DHT sensor library" de Adafruit (+ "Adafruit Unified Sensor"): `DHT dht(PIN, DHT11)`, `dht.begin()` en `setup()`. Medición cada 2s como mínimo (`INTERVALO_MEDICION_MS = 2000`), y se descarta la lectura si `isnan()`.
- Relé activo-alto por defecto, con constantes invertibles: `RELE_ENCENDIDO` / `RELE_APAGADO` (por si el módulo real es activo-bajo).
- IoT (solo ESP32, `calefaccion-iot.ino`): feeds `temperatura` y `humedad`, publicados **solo cuando cambian** al menos 0.5°C o 1% respecto de lo último enviado (respeta el límite de 30 publicaciones/min de Adafruit IO).
- Archivos: `uno|esp32/nivel-inicial/calefaccion-temporizada.ino`, `nivel-intermedio/termostato-lcd.ino`, `nivel-avanzado/calefaccion-no-bloqueante.ino` y (solo ESP32) `calefaccion-iot.ino`.

## Gotchas del proyecto ⚠️
- **LCD por plataforma**: UNO usa un LCD Keypad Shield paralelo (`LiquidCrystal lcd(8,9,4,5,6,7)`, `lcd.begin(16,2)`); ESP32 usa un LCD 1602 con módulo I2C (`LiquidCrystal_I2C`, SDA 21/SCL 22, `lcd.init()` + `lcd.backlight()`). El shield del UNO NO se enchufa en un ESP32.
- Dirección I2C típica del LCD: **0x27** — si no muestra nada, probar **0x3F** o escanear el bus. Pero antes de eso, mirá de dónde sale el VCC del LCD: si está en el bus de 3,3 V, no hay dirección que lo salve.
- **Ninguna de las dos librerías de LCD "viene sola" en PlatformIO** (con el IDE de Arduino sí; con PlatformIO no): si el `platformio.ini` no las declara, la compilación corta con `fatal error: LiquidCrystal.h: No such file or directory`. Las líneas exactas, verificadas compilando en la skill `librerias`: `arduino-libraries/LiquidCrystal` (UNO, paralelo) y `marcoschwartz/LiquidCrystal_I2C` (ESP32, I²C). El DHT11 lleva dos: `adafruit/DHT sensor library` + `adafruit/Adafruit Unified Sensor`.
- El **relé y el cableado de 220V van siempre fuera de la protoboard**, tarea exclusiva del docente. En el aula se prueba con el **LED de prueba** (pin 13 UNO / GPIO 16 ESP32) para verificar la lógica sin riesgo.
- **EN ESP32 SON DOS BUSES +, NO UNO**: relé y LCD al de 5 V (VIN), DHT11 y potenciómetro al de 3,3 V. Un solo bus "de alimentación" no puede ser las dos cosas — a 3,3 V el relé no engancha y el LCD queda en blanco; a 5 V el potenciómetro le manda 5 V al GPIO 34 (solo entrada, sin protección) y el pull-up del DHT11 levanta el GPIO 4 a 5 V. Ojo, son **tres preguntas distintas** que se confunden todo el tiempo: qué tensión pide el **VCC** de cada módulo, qué tensión **sale** del GPIO hacia el IN del relé (3,3 V — la mayoría de los módulos con optoacoplador dispara bien, pero verificalo con el tuyo), y qué tensión puede **entrar** a un GPIO (nunca más de 3,3 V).
- **EL "MÓDULO RELÉ" A SECAS NO ALCANZA PARA UN RADIADOR DE 220 V: HAY QUE MIRAR EL AMPERAJE.** El relecito de estas plaquetas es de 10 A, y ese número es su **techo absoluto**, no su régimen de trabajo. Un calefactor de **2000 W a 220 V tira ~9 A**: en el límite de un relé de 10 A y peligroso a largo plazo — el contacto se pica, se calienta y termina soldado (que en un calefactor significa **que no apaga más**). Para cargas grandes va un **contactor** o un relé del amperaje adecuado, **no el relecito de placa**. Es la advertencia verificada de la skill `actuadores`, y acá aplica de lleno porque este proyecto conmuta justamente un radiador. Y el lado de 220 V lo conecta **siempre un adulto**, fuera de la protoboard.
- Bug corregido del original: la lógica de calefacción del nivel avanzado estaba copiada del invernadero (`temperatura > 22` para "ventilar") — para calefacción está invertida, se corrige a `temp < objetivo`.

## Cómo ayudar al alumno
- Si el LCD no muestra nada en ESP32: primero probar cambiando la dirección I2C a 0x3F antes de sospechar del cableado.
- Si el relé se activa al revés de lo esperado: revisar si el módulo es activo-bajo y ajustar `RELE_ENCENDIDO`/`RELE_APAGADO`.
- Si el termostato "calienta cuando hace calor": es el bug clásico de copiar la lógica del invernadero sin invertir la comparación — revisar el signo de la comparación con el objetivo.
- Si en ESP32 el termostato no llega nunca a fijar los 30 °C, o el valor del pote salta y satura: mirá de dónde salen los extremos del potenciómetro. Si el extremo A está en el bus de 5 V, le está entregando 5 V a un pin de 3,3 — la lectura satura y el GPIO 34 se va degradando. Va al bus de 3,3 V.
- Si el relé no conmuta en ESP32 con el VCC bien puesto en 5 V: ahí sí el problema está en el **IN** (señal de 3,3 V), no en la alimentación. Son dos cosas distintas y conviene descartarlas en ese orden.
- Recalcarle SIEMPRE que la conexión a 220V real es tarea del docente, nunca del alumno sobre la protoboard — y que para un radiador de verdad el relecito de placa **no alcanza**: va contactor o relé del amperaje adecuado.
