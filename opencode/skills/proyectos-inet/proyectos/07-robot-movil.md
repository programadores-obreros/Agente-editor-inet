# Proyecto 07 — Robot móvil (KIT)
> El alumno arma y programa por bloques un robot móvil con el kit Robobloq Qoopers: recorrido pautado, mensaje en display, y esquivar obstáculos.

## De qué se trata
Es un **proyecto de kit cerrado**: no se arma ningún circuito en protoboard, no hay Arduino UNO ni ESP32 para elegir, no hay tabla de pines ni firmware `.ino`. Todo se resuelve con el kit **Robobloq Qoopers** (controladora propia + motores + ruedas/orugas + sensor ultrasónico + display LED + LED RGB + zumbador, todos incluidos) y el software **Robobloq**, que programa por bloques. Los periféricos se conectan a **puertos numerados del kit** (no a GPIO): por ejemplo, el display al puerto 7 y el sensor ultrasónico al puerto 6.

## Los niveles
- **Inicial — Armar el robot y programar un recorrido**: ensamblar el robot según el manual del kit, conectarlo por USB, instalar drivers, y programar por bloques un recorrido (avanzar, girar, frenar con tiempos) dentro de un bloque "Por siempre". Se suman los LED RGB como señalización.
- **Intermedio — Llevar y mostrar un mensaje con el display**: el display LED (puerto 7) muestra un mensaje solo cuando se presiona el botón integrado de la placa, y esa lógica se encadena al recorrido del nivel inicial (el mensaje se habilita recién al llegar a destino).
- **Avanzado — Esquivar obstáculos con el sensor ultrasónico**: se reconfigura el robot con el segundo modelo del kit; avanza a velocidad moderada (50) mientras el sensor (puerto 6) mide más de 40 cm libres, frena al detectar un obstáculo más cerca, y gira al azar (izquierda o derecha) usando el bloque de número aleatorio antes de seguir.

## Materiales
- Kit Robobloq Qoopers completo (controladora, motores, ruedas, orugas, sensor ultrasónico, display LED, LED RGB, zumbador, piezas de metal, cable USB)
- 6× pilas recargables AA (para que el robot se desplace sin depender del cable USB)
- Software Robobloq instalado en la computadora (descarga desde robobloq.com/support/download)

## Cómo guiar (sin circuito ni pinout)
Este proyecto NO tiene pinout ni cableado que dar: los periféricos van a puertos numerados propios del kit (display → puerto 7, sensor ultrasónico → puerto 6), no a pines GPIO. La programación es 100% por bloques en el software Robobloq (categorías de movimiento, sensores, control), no en C++/Arduino IDE. Si el alumno pregunta por el código o los pines, hay que orientarlo al manual de ensamble y a los bloques del software, no a un `.ino`.

## Gotchas del proyecto ⚠️
- **Cada vez que se sube un programa nuevo a la placa se borra el firmware de fábrica** que trae las funciones de Bluetooth. Para volver a controlar el robot desde la app (con Bluetooth) hay que restaurar ese firmware original desde el software Robobloq en la computadora.
- Es un proyecto de **mecánica + programación por bloques**, no de electrónica: no hay protoboard, resistencias ni polaridad que revisar.
- El software Robobloq es el original de 2019 (no se migró a C++ como el resto de la colección), porque sigue vigente y mantenido por el fabricante.

## Cómo ayudar al alumno
- Si el robot no se mueve o se mueve mal: revisar primero el ensamble mecánico (piezas del kit bien encastradas, ruedas/orugas correctamente montadas) antes de sospechar del código.
- Si el robot perdió el control por Bluetooth después de programarlo: recordar que hay que restaurar el firmware de fábrica desde Robobloq.
- Si el sensor ultrasónico no detecta bien: confirmar que esté en el puerto 6 y que el segundo modelo del kit (nivel avanzado) esté correctamente reconfigurado según el manual.
- Si el mensaje del display no aparece: revisar la lógica del botón encadenada al recorrido — el mensaje se habilita recién cuando el robot "llega" al destino programado.
