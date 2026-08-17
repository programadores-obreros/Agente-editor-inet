# Proyecto 03 — Riego automatizado

🔗 **Verlo en vivo (animación + simulador interactivo):** https://tecnialab.net.ar/proyectos/03-riego-automatizado/
> El alumno arma un sistema que abre y cierra una electroválvula para regar plantas: primero por tiempo, después según la humedad real del suelo, y por último con monitoreo IoT.

## De qué se trata
Se instala un sistema de riego con electroválvula y mangueras (no hace falta huerta: sirve para macetas o canteros). El paso del agua se regula abriendo/cerrando la electroválvula con un relé comandado por la placa. En el nivel avanzado se monitorea de forma remota la humedad del suelo y el estado de la válvula por IoT.

## Los niveles
- **Inicial — Regar por intervalos de tiempo**: la electroválvula abre y cierra durante intervalos definidos con `delay()`. Introduce el circuito de potencia (separado del de control) y las pautas de seguridad agua+electricidad.
- **Intermedio — Regar según la humedad del suelo**: se conecta un higrómetro FC-28 a la entrada analógica (A0 en UNO / GPIO34 en ESP32); el sistema riega solo cuando la tierra está seca de verdad, con dos umbrales (histéresis natural). Se usa el Monitor Serie a 115200 baudios para calibrar.
- **Avanzado — Monitorear el riego con IoT**: código no bloqueante con `millis()`, publicación por WiFi/MQTT a Adafruit IO solo cuando cambian los valores.

## Materiales
- Arduino UNO o ESP32 DevKit v1
- Higrómetro de suelo FC-28
- Módulo relé de 5 V
- Electroválvula de baja tensión (12 V) — NUNCA la de 220V (tipo lavarropas) del original, por seguridad
- Mangueras (entrada desde canilla, salida a las plantas)
- **LED de práctica (5 mm) + su resistencia de 220 Ω** — la resistencia NO es opcional: ver el gotcha del LED más abajo
- Resistencias de 220 Ω (al menos 1; conviene tener repuesto)
- Nota: la ficha original incluye un módulo RTC (reloj) en insumos, pero el código NUNCA lo usa — el riego temporizado se hace con `delay()`/`millis()`, no con hora real. Se documenta pero no hace falta comprarlo.

## Pinout (exacto — de PINES_RIEGO)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| Higrómetro FC-28 · señal (AO) | A0 | GPIO 34 |
| Relé de la electroválvula · IN | pin 2 | GPIO 16 |

> ESP32: GPIO 34 es del ADC1 — pin de solo entrada, sigue midiendo aunque el WiFi esté encendido (el ADC2 no puede leerse con WiFi activo).

## Cableado (de la tabla de conexionado)
**En ESP32 hay DOS buses +, y no es un detalle de prolijidad: cada módulo va en el suyo.** En UNO hay uno solo, el de 5 V.

| Desde | Hacia | Color |
|---|---|---|
| Placa · **5V** (UNO) / **VIN** (ESP32) | **Bus +5V** | 🔴 rojo |
| Placa · **3V3** (sólo ESP32) | **Bus +3V3** | 🟠 naranja |
| Placa · GND | Bus − protoboard | ⚫ negro |
| Higrómetro FC-28 · VCC | UNO: Bus +5V — **ESP32: Bus +3V3** | 🔴 / 🟠 |
| Higrómetro FC-28 · GND | Bus − | ⚫ negro |
| Higrómetro FC-28 · AO | placa · A0/GPIO34 | 🟡 amarillo |
| Módulo relé · VCC | **Bus +5V (siempre, las dos placas)** | 🔴 rojo |
| Módulo relé · GND | Bus − | ⚫ negro |
| Módulo relé · IN | placa · pin 2/GPIO16 | 🔵 azul |
| Relé · COM | **Bus +5V** | 🔴 rojo |
| Relé · NO | **Resistencia 220 Ω · pata 1** | 🔴 rojo |
| **Resistencia 220 Ω · pata 2** | LED de práctica · ánodo (+) | 🔴 rojo |
| **LED de práctica · cátodo (−)** | **Bus − protoboard** | ⚫ negro |

> **POR QUÉ DOS BUSES Y NO UNO "de 5V/3V3".** Decir "5V/3V3" y no decidir cuál es el error más caro de una ficha, porque después TODO cuelga de ese riel sin nombre y los dos módulos quieren cosas opuestas:
>
> - **El módulo relé no arranca con 3,3 V.** Su bobina es una SRD-05VDC-SL-C de 5 V nominal y la plaqueta necesita 5 V para el optoacoplador y el transistor de mando: mínimo **4,5 V** (`electrica.ts` → `TecniaLab:Modulo_Rele_1CH`). Con 3,3 V el relé no conmuta, o —peor— conmuta a veces, que es la falla que hace perder tres clases.
> - **El FC-28 a 5 V le manda 5 V al GPIO 34.** Su salida AO es analógica y **escala con el VCC**: si lo alimentás con 5 V, en tierra seca te entrega cerca de 5 V. El GPIO 34 del ESP32 es de **solo entrada y sin protección**, y su referencia es el riel de 3,3 V de la placa. Un pin de ADC quemado no se ve: la placa sigue andando y esa entrada queda leyendo basura para siempre.
>
> Por eso: **VCC del relé al bus de 5 V, VCC del FC-28 al bus de 3,3 V**, y los dos buses NUNCA unidos entre sí. El GND sí es uno solo y común — es la referencia de todo, incluida la señal AO.
>
> **De dónde sale el bus de 5 V en ESP32**: del pin **VIN**, que en la DevKit v1 alimentada por USB trae los 5 V del cable. Con un solo relé (90 mA con la bobina activada, según `electrica.ts`) alcanza sobrado; si en algún armado hubiera más de un relé, va fuente externa de 5 V con GND común, como el proyecto 11 hace con los servos.

## Código clave
- **CONVENCIÓN INVERSA DEL HIGRÓMETRO** (la más importante de todo el proyecto): en estos módulos resistivos, MAYOR lectura = tierra MÁS SECA (más resistencia, menos agua conduciendo). "Seco" es el umbral ALTO, "húmedo" el umbral BAJO.
- Umbrales del original (escala UNO 0–1023): `UMBRAL_SECO = 750` (por encima → regar), `UMBRAL_HUMEDO = 380` (por debajo → cortar). En la franja intermedia (380–750) NINGUNO de los dos ifs se cumple: la válvula conserva su estado anterior — es la **histéresis natural** del sistema, ya venía en el original y evita el traqueteo del relé. Estos valores NO son mágicos: hay que calibrarlos midiendo la tierra real con el Monitor Serie.
- Relé activo-alto (HIGH = válvula abierta), igual criterio que en el proyecto 02; si el módulo del alumno es activo-bajo, invertir solo las constantes.
- Lectura única por vuelta: el código moderno lee `analogRead(A0)` UNA sola vez a una variable y esa misma lectura se imprime y se compara (el original de mBlock3 llamaba a `analogRead` tres veces, lo que podía dar tres valores distintos entre sí).
- Archivos: `riego-temporizado.ino`, `riego-por-humedad.ino`, `riego-no-bloqueante.ino`, `riego-iot.ino`.

## Gotchas del proyecto ⚠️
- **Higrómetro INVERSO**: mayor lectura = más seco. Es el gotcha #1 de este proyecto — si el alumno programa "si es mayor a X, está húmedo" el riego queda al revés.
- **No inventar los umbrales**: 750/380 son del original y de SU tierra. Hay que recalibrar con el Monitor Serie observando valores reales del suelo del alumno.
- **EN ESP32 SON DOS BUSES +, NO UNO**: relé al de 5 V (VIN), higrómetro al de 3,3 V. Un solo bus "5V/3V3" no puede ser las dos cosas: a 3,3 V el relé no engancha, y a 5 V el FC-28 le manda 5 V al GPIO 34, que es solo-entrada y sin protección. En UNO no existe el dilema: es todo 5 V.
- **Seguridad agua + electricidad**: conexiones eléctricas siempre fuera y por encima del agua.
- **Electroválvula de baja tensión únicamente** en el aula (12 V); la de 220 V del original queda para el docente con instalación supervisada, nunca en la protoboard.
- **Publicación IoT por cambios, no por tiempo fijo**: el original publicaba cada 1 segundo, lo que puede superar el límite gratuito de Adafruit IO (30/min). La reedición publica solo cuando cambia el estado de la válvula o difiere la humedad de lo último publicado.
- **Módulo RTC en la ficha de insumos pero sin uso en el código**: es fidelidad al material original, no hace falta para que el proyecto funcione.
- **EL LED DE PRÁCTICA VA CON RESISTENCIA DE 220 Ω, SIEMPRE, Y CON EL CÁTODO A MASA.** Antes esta ficha mandaba el riel al ánodo por el contacto del relé y ahí terminaba la historia: sin resistencia y sin decir a dónde iba el cátodo. Eso es un LED **directo sobre 5 V**, y se destruye en el primer clic del relé — el LED no limita su propia corriente, la limita la resistencia que le pongas o nada. Con 220 Ω sobre 5 V y una caída típica de 2,1 V circulan unos 13 mA, dentro de los 15 mA de margen escolar y bien por debajo de los 20 mA que aguanta el LED (`electrica.ts` → `Device:LED`). El circuito completo es: **Bus +5V → COM → NO → R 220 Ω → ánodo → LED → cátodo → Bus −**. Si falta cualquiera de esos dos tramos —la resistencia o el retorno del cátodo a masa— no hay circuito o hay LED quemado, no hay término medio.
- **Módulo relé con ESP32 — dos preguntas distintas que se confunden todo el tiempo**: (1) **el VCC del módulo va SIEMPRE a 5 V** (VIN en ESP32), porque la bobina pide un mínimo de 4,5 V — eso no es opcional ni depende del módulo; (2) **el IN** es lo que hay que verificar: la mayoría de los módulos con optoacoplador dispara bien con los 3,3 V que entrega un GPIO del ESP32, pero algunos no. Si el relé no conmuta con VCC de 5 V bien puesto, el problema está en el IN, no en la alimentación.

## Cómo ayudar al alumno
- Si el sistema riega cuando la tierra ya está húmeda (o al revés): repasar la convención inversa del higrómetro con el alumno ANTES de tocar el código — es el error conceptual más común.
- Si el relé traquetea cerca de un umbral: verificar que estén los DOS umbrales (histéresis), no uno solo.
- Para calibrar: abrir el Monitor Serie a 115200 baudios, meter el higrómetro en tierra seca y húmeda, anotar los valores reales y ajustar `UMBRAL_SECO`/`UMBRAL_HUMEDO` a esos números.
- Si no riega nunca o riega todo el tiempo: revisar que el pin de la placa coincida con el del código, y la polaridad activo-alto/bajo del relé.
- Si en ESP32 la lectura del higrómetro está clavada en el máximo (4095) pase lo que pase: mirar de dónde sale el VCC del FC-28. Si está en el bus de 5 V, le está entregando ~5 V a un pin que admite 3,3 — la lectura satura y el pin se va degradando. Pasarlo al bus de 3,3 V.
- Si el LED de práctica se prende una vez y no vuelve a prender: fijate si tiene su resistencia de 220 Ω en serie. Sin ella se quemó en el primer clic del relé, y no se recupera.
