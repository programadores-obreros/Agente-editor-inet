# Proyecto 02 — Sistema de tanques

🔗 **Verlo en vivo (animación + simulador interactivo):** https://tecnialab.net.ar/proyectos/02-sistema-tanques/
> El alumno arma un sistema de abastecimiento de agua a escala: controla el llenado de un tanque con sensor ultrasónico + electroválvula, y en niveles superiores agrega una bomba entre dos tanques y monitoreo IoT.

## De qué se trata
Se arma una maqueta de un sistema de tanques interconectados, como el suministro de agua de una casa o edificio. El nivel de agua se mide con sensores ultrasónicos (HC-SR04) que comandan una electroválvula y una bomba sumergible a través de relés. En el nivel avanzado se publica el estado por IoT.

## Los niveles
- **Inicial — Controlar el llenado de un tanque**: un HC-SR04 mide la distancia al agua; cuando el tanque llega a la altura de corte, un relé cierra la electroválvula de entrada. Introduce el circuito de potencia (12 V: fuente + relé + electroválvula) separado del circuito de control (5 V: sensor + señal del relé).
- **Intermedio — Un segundo tanque con bomba sumergible**: se agrega un segundo HC-SR04 (tanque elevado) y una bomba que transfiere agua del primer tanque al segundo, con su propio relé.
- **Avanzado — Monitorear los tanques con IoT**: código no bloqueante (`millis()`) y publicación por WiFi/MQTT a Adafruit IO, solo de los cambios (para no agotar el límite gratuito).

## Materiales
- Arduino UNO o ESP32 DevKit v1
- 2× sensor ultrasónico HC-SR04
- 2× módulo relé de 5 V (uno para electroválvula, uno para bomba)
- Electroválvula de baja tensión (12 V) — NUNCA la de 220V del original, por seguridad
- Bomba de agua sumergible de baja tensión (5 V o 12 V) — debe trabajar siempre sumergida
- Fuente de 12 V 1 A
- 2 recipientes con canilla de desagote (tanques), mangueras

## Pinout (exacto — de PINES_TANQUES)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| Electroválvula (relé) | pin 4 | GPIO 25 |
| Bomba (relé) | pin 5 | GPIO 26 |
| HC-SR04 cisterna · Trig | pin 8 | GPIO 5 |
| HC-SR04 cisterna · Echo | pin 9 | GPIO 18 |
| HC-SR04 tanque elevado · Trig | pin 10 | GPIO 19 |
| HC-SR04 tanque elevado · Echo | pin 11 | GPIO 21 |

## Cableado (de la tabla de conexionado)
**En este proyecto el bus + es UNO SOLO y es de 5 V** — no hay nada que vaya a 3,3 V. Ver la nota debajo de la tabla: no es un detalle, es lo que decide si los sensores miden o no.

| Desde | Hacia | Color |
|---|---|---|
| Placa · **5V** (UNO) / **VIN** (ESP32) | **Bus +5V** protoboard | 🔴 rojo |
| Placa · GND | Bus − protoboard | ⚫ negro |
| HC-SR04 · VCC | **Bus +5V** | 🔴 rojo |
| HC-SR04 · GND | Bus − | ⚫ negro |
| HC-SR04 · Trig | placa · pin Trig | 🟡 amarillo |
| HC-SR04 · Echo | placa · pin Echo | 🔵 azul (⚠️ ver gotcha ESP32) |
| Relé válvula/bomba · VCC | **Bus +5V** | 🔴 rojo |
| Relé válvula/bomba · GND | Bus − | ⚫ negro |
| Relé válvula/bomba · IN | placa · pin correspondiente | 🟢 verde |
| Fuente 12V (+) | Relé · COM | 🟠 naranja |
| Relé · NO | Electroválvula/Bomba · borne 1 | 🟠 naranja |
| Electroválvula/Bomba · borne 2 | Fuente 12V (−) | 🟠 naranja |

> **POR QUÉ EL BUS + ES DE 5 V Y NO "5V/3V3".** Antes esta ficha ponía "Placa · 5V/3V3 → Bus +" sin decidir cuál, y después colgaba TODO de ese riel sin nombre. No puede ser las dos cosas, y acá la respuesta es fácil porque los cuatro módulos piden lo mismo:
>
> - **HC-SR04 → mínimo 4,5 V** (`electrica.ts` → `TecniaLab:HC-SR04`, hoja ElecFreaks v1.0: tensión de trabajo 5 V).
> - **Módulo relé → mínimo 4,5 V** (`electrica.ts` → `TecniaLab:Modulo_Rele_1CH`: bobina SRD-05VDC-SL-C de 5 V nominal, más el optoacoplador y el transistor de mando).
>
> O sea: **acá no hay bus de 3,3 V, porque no hay ningún módulo que vaya ahí**. En ESP32 el bus + sale del pin **VIN**, que en la DevKit v1 alimentada por USB trae los 5 V del cable. El 3V3 de la placa **no alcanza para nada de este proyecto**: con 3,3 V el HC-SR04 devuelve distancias erráticas o cero, y el relé no conmuta o conmuta a veces — que es la peor de las fallas, porque parece que anda.
>
> Las cuentas cierran: dos relés activados (90 mA cada uno) más dos HC-SR04 (15 mA cada uno) son **210 mA**, por debajo de los 300 mA a los que el riel de 5 V del UNO empieza a avisar (`electrica.ts`). Para el VIN del ESP32 la tabla no declara presupuesto — si en algún armado se agregaran más relés, va fuente externa de 5 V con GND común.
>
> **Que el bus sea de 5 V no significa que le puedas meter 5 V a un GPIO**: el pin **Echo** del HC-SR04 devuelve 5 V y va con divisor antes del GPIO del ESP32 (ver el gotcha). Son dos cosas distintas: de cuánto se **alimenta** un módulo, y cuánto puede **entrar** a un pin.
>
> El circuito de potencia (12 V: fuente + relé + carga) va separado del circuito de control (5 V: sensor + señal del relé hacia la placa).

## Código clave
- Constante de **altura de corte**: en el original 40 cm (a medir en la maqueta real, no inventar el valor — depende de dónde está montado el sensor respecto al nivel máximo deseado).
- **Histéresis de 5 cm**: la válvula/bomba corta al llegar a la altura de corte, pero recién vuelve a activarse cuando el agua baja 5 cm más. Se agregó porque el ruido de medición del HC-SR04 (±1 cm típico) haría traquetear el relé sin parar justo en el borde si se conmutara en el valor exacto.
- Relé activo-alto (HIGH = válvula abierta) como en el original; si el módulo del alumno es activo-bajo, solo hay que invertir las constantes `RELE_ENCENDIDO`/`RELE_APAGADO`.
- Nivel avanzado: `millis()` en vez de `delay()`, y publicación IoT **solo cuando cambia** el estado de válvula/bomba, o cuando el nivel difiere 2 cm o más de lo último publicado (el original publicaba 4 feeds cada 3 s = ~80 pub/min, muy por encima del límite gratuito de 30/min de Adafruit IO).
- Archivos: `control-llenado.ino`, `dos-tanques.ino`, `dos-tanques-no-bloqueante.ino`, `tanques-iot.ino`.

## Gotchas del proyecto ⚠️
- **Menor distancia = tanque más lleno**: el sensor mira al agua desde arriba, así que la lógica es inversa a lo intuitivo (ojo, distinto del higrómetro del proyecto 03 que también es inverso pero por otra razón).
- **ESP32 + HC-SR04**: el pin Echo del HC-SR04 entrega 5 V, pero el GPIO del ESP32 solo tolera 3,3 V. Hace falta un divisor de tensión (dos resistencias) antes del GPIO de Echo — si no, se puede dañar la placa.
- **Seguridad agua + electricidad**: todas las conexiones eléctricas van fuera y POR ENCIMA del nivel del agua. El sensor no se debe mojar.
- **Electroválvula/bomba de baja tensión únicamente** (12 V o menos): la versión de 220 V del original queda excluida de la práctica en el aula por seguridad; solo el docente podría hacer esa instalación, supervisada y nunca sobre la protoboard.
- **La bomba nunca debe funcionar en seco**: la arruina. Siempre sumergida.
- **Inconsistencia del material original**: la ficha técnica de 2019 no incluía la electroválvula en los insumos, aunque el desarrollo la usa desde el paso 2 del nivel inicial — está corregido en esta reedición.
- **EL BUS + DE ESTE PROYECTO ES DE 5 V, NO "5V/3V3"**: los dos HC-SR04 y los dos módulos relé piden **mínimo 4,5 V** (`electrica.ts`). En ESP32 sale del pin **VIN**, nunca del 3V3. Acá no hay bus de 3,3 V porque no hay nada que vaya ahí.
- **Módulo relé con ESP32 — dos preguntas distintas**: (1) **el VCC va SIEMPRE a 5 V** (VIN), porque la bobina pide 4,5 V mínimo: eso no es opcional ni depende del módulo; (2) **el IN** es lo que hay que verificar — la mayoría de los módulos con optoacoplador dispara bien con los 3,3 V de un GPIO, pero algunos no. Si el relé no conmuta con el VCC bien puesto, el problema está en el IN.

## Cómo ayudar al alumno
- Si la válvula abre y cierra sin parar cerca del nivel de corte: revisar que la histéresis esté implementada (no comparar contra un único valor).
- Si el ESP32 se comporta raro o se resetea con el sensor conectado: sospechar del divisor de tensión faltante en Echo.
- Si el relé no conmuta: revisar polaridad activo-alto/activo-bajo del módulo específico.
- Si hay derrames: recordar la separación física entre la zona de electrónica y la zona de agua antes de energizar nada.
