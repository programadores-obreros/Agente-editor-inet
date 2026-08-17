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
**En ESP32 hay DOS buses +, y cada módulo va en el suyo.** En UNO hay uno solo, el de 5 V.

| Desde | Hacia | Color |
|---|---|---|
| Placa · **5V** (UNO) / **VIN** (ESP32) | **Bus +5V** | rojo |
| Placa · **3V3** (sólo ESP32) | **Bus +3V3** | naranja |
| Placa · GND | Bus − protoboard | negro |
| **Módulo relé · VCC** | **Bus +5V** (siempre, las dos placas) | rojo |
| Módulo relé · GND | Bus − protoboard | negro |
| Módulo relé · IN | Placa · pin relé | azul |
| Lámpara de baja tensión (+) | Relé · COM | naranja |
| Relé · NO | Lámpara de baja tensión (−) | naranja |
| **Sensor PIR · VCC** | **Bus +5V** (siempre, las dos placas) | rojo |
| Sensor PIR · GND | Bus − protoboard | negro |
| Sensor PIR · OUT | Placa · pin PIR | amarillo |
| **Módulo LDR · VCC** | UNO: Bus +5V — **ESP32: Bus +3V3** | rojo / naranja |
| Módulo LDR · GND | Bus − protoboard | negro |
| Módulo LDR · salida (AO) | Placa · pin LDR | violeta |

> **POR QUÉ DOS BUSES, MÓDULO POR MÓDULO.** Un renglón que dice "Placa · alimentación → Bus +" no decide nada, y después los tres módulos cuelgan del mismo riel sin nombre. Acá los tres NO quieren lo mismo:
>
> - **Módulo relé → 5 V, obligatorio.** Su bobina es una SRD-05VDC-SL-C de 5 V nominal y la plaqueta necesita 5 V para el optoacoplador y el transistor de mando: **mínimo 4,5 V** (`electrica.ts` → `TecniaLab:Modulo_Rele_1CH`). Con 3,3 V no engancha, o engancha a veces — que es peor, porque parece que anda.
> - **Sensor PIR → 5 V, también obligatorio.** El HC-SR501 se alimenta de **4,5 a 20 V DC** (`electrica.ts` → `TecniaLab:HC-SR501`). A 3,3 V está por debajo de su mínimo: el fabricante no promete nada, y "nada" incluye que funcione a veces. **Y su salida OUT es segura para el ESP32 igual**: la misma tabla dice que «la salida OUT entrega 3,3 V por su propia electrónica», o sea que aunque lo alimentes con 5 V, al GPIO le llegan 3,3. El PIR es el caso raro y feliz: 5 V de un lado, 3,3 V del otro, sin adaptador.
> - **Módulo LDR → 3,3 V en ESP32.** La plaqueta acepta de 3,3 a 5 V (`electrica.ts` → `TecniaLab:Modulo_LDR_3P`), así que a 3,3 V trabaja perfecto. Pero **su salida analógica escala con el VCC**: alimentado con 5 V, cuando hay mucha luz manda cerca de 5 V al **GPIO 34**, que es de **solo entrada, sin protección**, y cuya referencia es el riel de 3,3 V de la placa. Un ADC quemado no se ve — la placa sigue andando y esa entrada queda leyendo basura para siempre. En el UNO no hay dilema: el A0 tolera 5 V y todo va al mismo riel.
>
> Los dos buses **no se unen nunca entre sí**. El **GND sí es uno solo y común**: es la referencia de todo, incluidas la señal del PIR y la lectura del LDR.
>
> **De dónde sale el bus de 5 V en ESP32**: del pin **VIN**, que en la DevKit v1 alimentada por USB trae los 5 V del cable. Con un relé (90 mA con la bobina activada) más el PIR (menos de 0,1 mA en reposo) alcanza sobrado, según los consumos de `electrica.ts`.

## Código clave
- Umbral de luz medido, no inventado: `const int UMBRAL_LUZ = 600;` (UNO) — sale de haber medido con `lectura-ldr.ino` en el lugar real, no es un número mágico.
- Lógica: `if (analogRead(PIN_LDR) < UMBRAL_LUZ) { digitalWrite(PIN_RELE, RELE_ENCENDIDO); }` — menos luz que el umbral = está oscureciendo = enciende.
- Reescalado de umbral por resolución de ADC: 600/1023 en UNO (10 bits) ≈ 2400/4095 en ESP32 (12 bits) — mismo fenómeno físico, distinta resolución. El valor definitivo sale siempre de medir con el sketch de lectura, no de copiar el número entre placas.
- Relé activo-alto por defecto, con constantes invertibles `RELE_ENCENDIDO`/`RELE_APAGADO` (muchos módulos escolares son activo-bajo).
- Archivos: `uno|esp32/nivel-inicial/luces-temporizadas.ino` (prueba del relé), `lectura-pir.ino` (calibración por consola), `luz-automatica-pir.ino` (lógica final); `nivel-avanzado/lectura-ldr.ino` (calibración), `luz-nocturna.ino` (lógica final).

## Gotchas del proyecto ⚠️
- **GPIO 34 en ESP32 es de solo entrada**, no tiene pull-up/pull-down internos **y no tiene protección**. El módulo LDR de 3 pines ya trae el divisor incorporado, así que la señal se conecta directo al GPIO — **pero sólo si el módulo está alimentado con 3,3 V**. Acá estaba el agujero: un divisor es un repartidor, no una fuente, así que **lo que entrega escala con lo que le des de VCC**. A 5 V de alimentación, con mucha luz, la salida se acerca a 5 V y eso entra crudo a un pin de 3,3. Por eso el VCC del módulo LDR va al **bus de 3,3 V** en ESP32 (la plaqueta acepta 3,3 a 5 V, así que no perdés nada). Si se usara un LDR suelto, el divisor externo (LDR + resistencia 10 kΩ) sería obligatorio, y alimentado también desde 3,3 V.
- GPIO 34 pertenece al ADC1, que sigue midiendo aunque el WiFi esté activo (a diferencia del ADC2).
- La guía original conecta el relé a 220V — en la reedición la práctica de aula usa una lámpara LED de baja tensión; la conexión a 220V real queda para el docente, nunca sobre la protoboard.
- **"El ESP32 trabaja a 3,3 V" no significa que todo se alimente con 3,3 V** — y confundir esas dos cosas es de donde salía el bus único de esta ficha. Son tres preguntas distintas: (1) **qué tensión pide cada módulo en su VCC** (relé y PIR: mínimo 4,5 V, van al bus de 5 V/VIN; LDR: 3,3 V en ESP32); (2) **qué tensión sale del GPIO** hacia el IN del relé (3,3 V — la mayoría de los módulos con optoacoplador dispara bien, pero hay que verificarlo con el módulo real); (3) **qué tensión entra a un GPIO** (nunca más de 3,3 V, y en el GPIO 34 no hay red que te salve). Lo que sí es absoluto: **nunca inyectar 5 V en un GPIO**.
- **EL RELECITO DE PLACA NO ES PARA CUALQUIER CARGA.** Si el docente hace la instalación real con una lámpara de 220 V, hay que mirar el **amperaje**, no sólo la tensión: el módulo relé típico de estas plaquetas es de 10 A, y ese número es su techo absoluto, no su régimen de trabajo. Para cargas grandes va un **contactor** o un relé del amperaje adecuado, **no el relecito de placa** (es la misma advertencia verificada que está en la skill `actuadores`, donde el ejemplo es un calefactor de 2000 W que tira ~9 A: en el límite de un relé de 10 A y peligroso a largo plazo). Una lámpara LED de baja tensión del aula no llega ni cerca; el problema aparece cuando alguien reemplaza la lámpara por algo más grande sin rehacer la cuenta. Y el lado de 220 V lo conecta **siempre un adulto**, fuera de la protoboard.
- El tiempo de cortesía del PIR (10 min en el original) puede sentirse eterno en clase — igual que en otros proyectos con esperas largas, conviene bajarlo temporalmente para la demo.

## Cómo ayudar al alumno
- Antes de programar el umbral del LDR: hacerlo correr primero `lectura-ldr.ino` y anotar valores reales de luz/oscuridad del aula — no copiar el 600 del ejemplo sin medir.
- Si el relé se activa al revés de lo esperado (prende con luz, apaga a oscuras): revisar si el módulo es activo-bajo y ajustar las constantes.
- Si en ESP32 el LDR siempre da el mismo valor: comprobar dos cosas, en este orden. Primero, **de dónde sale el VCC del módulo** — si está en el bus de 5 V, la salida satura el ADC (y de paso le está entregando 5 V a un pin de 3,3): pasarlo al bus de 3,3 V. Segundo, que esté en GPIO 34 (ADC1) y no en un pin sin ADC.
- Si el PIR nunca detecta o detecta cualquier cosa en ESP32: mirar su VCC. El HC-SR501 pide **mínimo 4,5 V** — si quedó en el bus de 3,3 V está por debajo de su especificación y su comportamiento no lo garantiza nadie. Va al bus de 5 V (VIN); su salida OUT ya entrega 3,3 V sola, así que no hace falta ningún adaptador.
- Si el alumno se impacienta con el tiempo de cortesía del PIR: sugerir bajarlo temporalmente para ver el ciclo completo rápido.
