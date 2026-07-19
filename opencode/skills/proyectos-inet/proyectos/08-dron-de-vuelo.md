# Proyecto 08 — Dron de vuelo (KIT)

🔗 **Verlo en vivo (animación + simulador interactivo):** https://tecnialab.net.ar/proyectos/08-dron-de-vuelo/
> El alumno pilotea y programa por bloques un dron DJI Tello usando el celular/tablet como mando: vuelo manual, recorridos programados, medición de temperatura y condicionales de altura.

## De qué se trata
Es un **proyecto de kit/app**: no hay nada que cablear, soldar ni montar en una placa. El dron **DJI Tello** se controla íntegramente desde el celular o la tablet, conectándose a la red WiFi que el propio dron genera. Se usan dos apps: **Tello EDU** (programación por bloques) y **Tello** (vuelo manual con cámara). No hay Arduino UNO ni ESP32, ni código C++, ni tabla de pines.

## Los niveles
- **Inicial — Primeros vuelos: manual y por bloques**: instalar Tello EDU, conectar el dispositivo a la red del dron, volar manualmente con los joysticks en pantalla (despegar, recorrer, aterrizar en una zona marcada con cinta), y luego repetir ese recorrido por bloques (Take Off → movimientos → Land).
- **Intermedio — Repetir el recorrido y medir la temperatura**: usar el bloque **Repeat n times** para no copiar y pegar bloques, y crear variables (`Min`, `Max`) que se asignan con bloques `Set` a partir de `Min Temperature`/`Max Temperature` del sensor de a bordo del dron.
- **Avanzado — Condicionales de altura y registro en video**: usar una variable `Altura`, un operador de comparación y un bloque `If` para que el recorrido solo se ejecute si el dron supera los 800 cm de altura; grabar el vuelo con la app Tello en modo manual (despegar → grabar → recorrer → detener → aterrizar).

## Materiales
- KIT Dron de Vuelo DJI Tello (mini dron con cámara y sensores de a bordo: temperatura, altura)
- Celular o tablet con WiFi
- App **Tello EDU** (programación por bloques: categorías Motion, Control, Sensing, Variables, Operator)
- App **Tello** (vuelo manual con cámara)
- Cinta adhesiva de papel (para marcar la zona de aterrizaje)

## Cómo guiar (sin circuito ni pinout)
Este proyecto NO tiene pinout, cableado ni firmware `.ino` — es "de armado directo": no hay ensamble de piezas ni electrónica que montar, solo instalar las apps y volar. Si el alumno pregunta por el código, hay que orientarlo a los bloques de Tello EDU (Motion/Control/Sensing/Variables/Operator), no a Arduino IDE. Cuando no se dispone del dron físico, existe un simulador de trayectoria de vuelo en el navegador (escenarios "dron-recorrido" y "dron-condicional-altura") para practicar la lógica de la secuencia sin riesgo de choques.

## Gotchas del proyecto ⚠️
- **Dependencia de un producto comercial y apps propietarias**: Tello EDU y Tello podrían actualizarse o discontinuarse. Conviene verificar que ambas sigan disponibles en la tienda de apps ANTES de planificar la actividad.
- **La programación por bloques NO es mBlock3** (a diferencia del resto de la colección, que sí lo reemplazó por C++): es el editor propio de Tello EDU, y no tiene alternativa abierta equivalente.
- **No hay URL de descarga estable**: las apps se buscan por nombre ("Tello EDU" y "Tello") en App Store o Google Play.
- El dron genera su propia red WiFi — el celular/tablet se conecta a ESA red, no a la del aula/router.

## Cómo ayudar al alumno
- Si el dron no vincula con la app: revisar que el celular esté conectado a la red WiFi que genera el propio dron, no a otra red.
- Si el recorrido programado no se ejecuta como se espera: revisar el orden de los bloques (siempre debe empezar con Take Off y terminar con Land) y que las variables (Min/Max/Altura) estén bien asignadas antes de usarlas en el `If` o el `Repeat`.
- Si no hay dron físico disponible en el momento: usar el simulador de trayectoria del navegador para trabajar la lógica de bloques igual.
- Recordar que Tello EDU y Tello son dos apps DISTINTAS con usos distintos (bloques vs. vuelo manual con cámara) — confirmar cuál corresponde a cada actividad.
