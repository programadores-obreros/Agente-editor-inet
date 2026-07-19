# Proyecto 15 — Sistema Lumínico

🔗 **Verlo en vivo (animación + simulador interactivo):** https://tecnialab.net.ar/proyectos/15-sistema-luminico/
> El alumno automatiza una lámpara domiciliaria: primero se enciende por sensor de movimiento, después también según el nivel de luz exterior.

## De qué se trata
Un sistema de iluminación domiciliario con encendido automático. El nivel inicial usa un sensor PIR: si detecta movimiento, un relé enciende la lámpara con un tiempo de cortesía antes de apagarla. El nivel avanzado suma un sensor LDR que mide la luz del ambiente: si está oscureciendo (lectura por debajo de un umbral), enciende la lámpara. Es el proyecto más simple de la colección (dificultad 1) y buena puerta de entrada para introducir relé + sensor.

## Los niveles
- **Inicial — Movimiento (PIR)**: relé según el sensor PIR, con un tiempo de cortesía de 10 minutos tras la última detección. Incluye además un sketch de prueba del relé y uno de lectura/calibración del PIR por consola serial. Concepto clave: cómo calibrar un sensor observando su salida cruda antes de programar la lógica final.
- **Avanzado — Luz ambiente (LDR)**: relé según un umbral de luz medido con el LDR (`analogRead < umbral` → enciende). Incluye un sketch de lectura del LDR para calibrar el umbral en el lugar real. Concepto clave: la resolución del ADC cambia el umbral necesario entre placas.

Este proyecto tiene **solo 2 niveles** (sin intermedio) y **no tiene IoT**.

## Materiales
- Módulo relé
- Sensor PIR
- Módulo sensor LDR (fotorresistencia), con divisor de tensión incorporado
- Lámpara LED de baja tensión (12V o menos) con su fuente, o un LED con resistencia (para el aula)
- Filamento PLA (si aplica maqueta)
- Protoboard, cables dupont macho-hembra y macho-macho
- Arduino UNO R3 o Placa ESP32 DevKit v1
- (para uso real, fuera del aula) lámparas de 220V con portalámparas, enchufe y cable — tarea exclusiva del docente

## Pinout (exacto — de PINES_LUMINICO)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| Módulo relé (IN) | 7 | GPIO 16 |
| Sensor PIR (datos) | 4 | GPIO 27 |
| Sensor LDR (salida analógica) | A0 | GPIO 34 |

## Cableado (de la tabla de conexionado)
| Desde | Hacia | Color |
|---|---|---|
| Placa · alimentación | Bus + protoboard | rojo |
| Placa · GND | Bus − protoboard | negro |
| Módulo relé · VCC / GND | Bus + / Bus − protoboard | rojo / negro |
| Módulo relé · IN | Placa · pin relé | azul |
| Lámpara de baja tensión (+) | Relé · COM | naranja |
| Relé · NO | Lámpara de baja tensión (−) | naranja |
| Sensor PIR · VCC / GND | Bus + / Bus − protoboard | rojo / negro |
| Sensor PIR · OUT | Placa · pin PIR | amarillo |
| Módulo LDR · VCC / GND | Bus + / Bus − protoboard | rojo / negro |
| Módulo LDR · salida | Placa · pin LDR | violeta |

## Código clave
- Umbral de luz medido, no inventado: `const int UMBRAL_LUZ = 600;` (UNO) — sale de haber medido con `lectura-ldr.ino` en el lugar real, no es un número mágico.
- Lógica: `if (analogRead(PIN_LDR) < UMBRAL_LUZ) { digitalWrite(PIN_RELE, RELE_ENCENDIDO); }` — menos luz que el umbral = está oscureciendo = enciende.
- Reescalado de umbral por resolución de ADC: 600/1023 en UNO (10 bits) ≈ 2400/4095 en ESP32 (12 bits) — mismo fenómeno físico, distinta resolución. El valor definitivo sale siempre de medir con el sketch de lectura, no de copiar el número entre placas.
- Relé activo-alto por defecto, con constantes invertibles `RELE_ENCENDIDO`/`RELE_APAGADO` (muchos módulos escolares son activo-bajo).
- Archivos: `uno|esp32/nivel-inicial/luces-temporizadas.ino` (prueba del relé), `lectura-pir.ino` (calibración por consola), `luz-automatica-pir.ino` (lógica final); `nivel-avanzado/lectura-ldr.ino` (calibración), `luz-nocturna.ino` (lógica final).

## Gotchas del proyecto ⚠️
- **GPIO 34 en ESP32 es de solo entrada** y no tiene pull-up/pull-down internos. El módulo LDR de 3 pines ya trae el divisor incorporado, así que se conecta directo; si se usara un LDR suelto, el divisor externo (LDR + resistencia 10kΩ) sería obligatorio.
- GPIO 34 pertenece al ADC1, que sigue midiendo aunque el WiFi esté activo (a diferencia del ADC2).
- La guía original conecta el relé a 220V — en la reedición la práctica de aula usa una lámpara LED de baja tensión; la conexión a 220V real queda para el docente, nunca sobre la protoboard.
- El ESP32 trabaja a 3.3V (UNO a 5V) — nunca inyectar 5V en un GPIO. El módulo relé debe aceptar señal de control de 3.3V.
- El tiempo de cortesía del PIR (10 min en el original) puede sentirse eterno en clase — igual que en otros proyectos con esperas largas, conviene bajarlo temporalmente para la demo.

## Cómo ayudar al alumno
- Antes de programar el umbral del LDR: hacerlo correr primero `lectura-ldr.ino` y anotar valores reales de luz/oscuridad del aula — no copiar el 600 del ejemplo sin medir.
- Si el relé se activa al revés de lo esperado (prende con luz, apaga a oscuras): revisar si el módulo es activo-bajo y ajustar las constantes.
- Si en ESP32 el LDR siempre da el mismo valor: comprobar que esté en GPIO 34 (ADC1) y no en un pin sin ADC.
- Si el alumno se impacienta con el tiempo de cortesía del PIR: sugerir bajarlo temporalmente para ver el ciclo completo rápido.
