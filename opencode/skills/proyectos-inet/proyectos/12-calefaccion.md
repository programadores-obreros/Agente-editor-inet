# Proyecto 12 — Sistema de Calefacción Automático
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
| Desde | Hacia | Color |
|---|---|---|
| Placa · alimentación | Bus + protoboard | rojo |
| Placa · GND | Bus − protoboard | negro |
| Sensor DHT11 · VCC | Bus + protoboard | rojo |
| Sensor DHT11 · GND | Bus − protoboard | negro |
| Sensor DHT11 · DATA | Placa · pin DHT | amarillo |
| Módulo relé · VCC | Bus + protoboard | rojo |
| Módulo relé · GND | Bus − protoboard | negro |
| Módulo relé · IN | Placa · pin relé | azul |
| Enchufe 220V (docente) | Relé · COM | naranja |
| Relé · NO | Radiador | naranja |
| Potenciómetro · extremo A | Bus + protoboard | rojo |
| Potenciómetro · extremo B | Bus − protoboard | negro |
| Potenciómetro · cursor | Placa · pin potenciómetro | violeta |
| (ESP32) LCD 1602 I2C · VCC/GND | Bus + / Bus − protoboard | rojo / negro |
| (ESP32) LCD 1602 I2C · SDA | Placa · GPIO 21 | verde |
| (ESP32) LCD 1602 I2C · SCL | Placa · GPIO 22 | naranja |
| (UNO) LCD Keypad Shield | apilado sobre pines digitales (RS 8, E 9, D4-D7 4/5/6/7) | blanco |

## Código clave
- Termostato: `objetivo = analogRead(PIN_POTENCIOMETRO) * TEMP_OBJETIVO_MAX_C / ADC_MAX` (regla de tres, pote en 0 → 0°C, al máximo → 30°C). Relé enciende si `temperatura < objetivo` — **atención**: la lógica correcta de calefacción es la inversa de la del invernadero (que ventila si hace calor).
- `ADC_MAX`: 1023 en UNO (10 bits), 4095 en ESP32 (12 bits).
- DHT11 con la librería "DHT sensor library" de Adafruit (+ "Adafruit Unified Sensor"): `DHT dht(PIN, DHT11)`, `dht.begin()` en `setup()`. Medición cada 2s como mínimo (`INTERVALO_MEDICION_MS = 2000`), y se descarta la lectura si `isnan()`.
- Relé activo-alto por defecto, con constantes invertibles: `RELE_ENCENDIDO` / `RELE_APAGADO` (por si el módulo real es activo-bajo).
- IoT (solo ESP32, `calefaccion-iot.ino`): feeds `temperatura` y `humedad`, publicados **solo cuando cambian** al menos 0.5°C o 1% respecto de lo último enviado (respeta el límite de 30 publicaciones/min de Adafruit IO).
- Archivos: `uno|esp32/nivel-inicial/calefaccion-temporizada.ino`, `nivel-intermedio/termostato-lcd.ino`, `nivel-avanzado/calefaccion-no-bloqueante.ino` y (solo ESP32) `calefaccion-iot.ino`.

## Gotchas del proyecto ⚠️
- **LCD por plataforma**: UNO usa un LCD Keypad Shield paralelo (`LiquidCrystal lcd(8,9,4,5,6,7)`, `lcd.begin(16,2)`); ESP32 usa un LCD 1602 con módulo I2C (`LiquidCrystal_I2C`, SDA 21/SCL 22, `lcd.init()` + `lcd.backlight()`). El shield del UNO NO se enchufa en un ESP32.
- Dirección I2C típica del LCD: **0x27** — si no muestra nada, probar **0x3F** o escanear el bus.
- El **relé y el cableado de 220V van siempre fuera de la protoboard**, tarea exclusiva del docente. En el aula se prueba con el **LED de prueba** (pin 13 UNO / GPIO 16 ESP32) para verificar la lógica sin riesgo.
- El potenciómetro y el DHT11 en ESP32 trabajan a 3.3V — el relé debe aceptar señal de control de 3.3V (o usar optoacoplador).
- Bug corregido del original: la lógica de calefacción del nivel avanzado estaba copiada del invernadero (`temperatura > 22` para "ventilar") — para calefacción está invertida, se corrige a `temp < objetivo`.

## Cómo ayudar al alumno
- Si el LCD no muestra nada en ESP32: primero probar cambiando la dirección I2C a 0x3F antes de sospechar del cableado.
- Si el relé se activa al revés de lo esperado: revisar si el módulo es activo-bajo y ajustar `RELE_ENCENDIDO`/`RELE_APAGADO`.
- Si el termostato "calienta cuando hace calor": es el bug clásico de copiar la lógica del invernadero sin invertir la comparación — revisar el signo de la comparación con el objetivo.
- Recalcarle SIEMPRE que la conexión a 220V real es tarea del docente, nunca del alumno sobre la protoboard.
