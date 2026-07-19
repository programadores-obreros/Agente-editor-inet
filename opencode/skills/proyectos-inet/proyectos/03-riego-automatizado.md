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
- Nota: la ficha original incluye un módulo RTC (reloj) en insumos, pero el código NUNCA lo usa — el riego temporizado se hace con `delay()`/`millis()`, no con hora real. Se documenta pero no hace falta comprarlo.

## Pinout (exacto — de PINES_RIEGO)
| Componente / señal | Arduino UNO | ESP32 |
|---|---|---|
| Higrómetro FC-28 · señal (AO) | A0 | GPIO 34 |
| Relé de la electroválvula · IN | pin 2 | GPIO 16 |

> ESP32: GPIO 34 es del ADC1 — pin de solo entrada, sigue midiendo aunque el WiFi esté encendido (el ADC2 no puede leerse con WiFi activo).

## Cableado (de la tabla de conexionado)
| Desde | Hacia | Color |
|---|---|---|
| Placa · 5V/3V3 | Bus + protoboard | 🔴 rojo |
| Placa · GND | Bus − protoboard | ⚫ negro |
| Higrómetro FC-28 · VCC | Bus + | 🔴 rojo |
| Higrómetro FC-28 · GND | Bus − | ⚫ negro |
| Higrómetro FC-28 · AO | placa · A0/GPIO34 | 🟡 amarillo |
| Módulo relé · VCC/GND | Bus + / Bus − | 🔴⚫ |
| Módulo relé · IN | placa · pin 2/GPIO16 | 🔵 azul |
| Relé · COM | Bus + protoboard | 🔴 rojo |
| Relé · NO | LED de práctica · ánodo | 🔴 rojo |

## Código clave
- **CONVENCIÓN INVERSA DEL HIGRÓMETRO** (la más importante de todo el proyecto): en estos módulos resistivos, MAYOR lectura = tierra MÁS SECA (más resistencia, menos agua conduciendo). "Seco" es el umbral ALTO, "húmedo" el umbral BAJO.
- Umbrales del original (escala UNO 0–1023): `UMBRAL_SECO = 750` (por encima → regar), `UMBRAL_HUMEDO = 380` (por debajo → cortar). En la franja intermedia (380–750) NINGUNO de los dos ifs se cumple: la válvula conserva su estado anterior — es la **histéresis natural** del sistema, ya venía en el original y evita el traqueteo del relé. Estos valores NO son mágicos: hay que calibrarlos midiendo la tierra real con el Monitor Serie.
- Relé activo-alto (HIGH = válvula abierta), igual criterio que en el proyecto 02; si el módulo del alumno es activo-bajo, invertir solo las constantes.
- Lectura única por vuelta: el código moderno lee `analogRead(A0)` UNA sola vez a una variable y esa misma lectura se imprime y se compara (el original de mBlock3 llamaba a `analogRead` tres veces, lo que podía dar tres valores distintos entre sí).
- Archivos: `riego-temporizado.ino`, `riego-por-humedad.ino`, `riego-no-bloqueante.ino`, `riego-iot.ino`.

## Gotchas del proyecto ⚠️
- **Higrómetro INVERSO**: mayor lectura = más seco. Es el gotcha #1 de este proyecto — si el alumno programa "si es mayor a X, está húmedo" el riego queda al revés.
- **No inventar los umbrales**: 750/380 son del original y de SU tierra. Hay que recalibrar con el Monitor Serie observando valores reales del suelo del alumno.
- **Seguridad agua + electricidad**: conexiones eléctricas siempre fuera y por encima del agua.
- **Electroválvula de baja tensión únicamente** en el aula (12 V); la de 220 V del original queda para el docente con instalación supervisada, nunca en la protoboard.
- **Publicación IoT por cambios, no por tiempo fijo**: el original publicaba cada 1 segundo, lo que puede superar el límite gratuito de Adafruit IO (30/min). La reedición publica solo cuando cambia el estado de la válvula o difiere la humedad de lo último publicado.
- **Módulo RTC en la ficha de insumos pero sin uso en el código**: es fidelidad al material original, no hace falta para que el proyecto funcione.
- **Módulo relé con ESP32**: verificar que dispare con 3,3 V (optoacoplador) o alimentarlo con 5 V desde VIN.

## Cómo ayudar al alumno
- Si el sistema riega cuando la tierra ya está húmeda (o al revés): repasar la convención inversa del higrómetro con el alumno ANTES de tocar el código — es el error conceptual más común.
- Si el relé traquetea cerca de un umbral: verificar que estén los DOS umbrales (histéresis), no uno solo.
- Para calibrar: abrir el Monitor Serie a 115200 baudios, meter el higrómetro en tierra seca y húmeda, anotar los valores reales y ajustar `UMBRAL_SECO`/`UMBRAL_HUMEDO` a esos números.
- Si no riega nunca o riega todo el tiempo: revisar que el pin de la placa coincida con el del código, y la polaridad activo-alto/bajo del relé.
