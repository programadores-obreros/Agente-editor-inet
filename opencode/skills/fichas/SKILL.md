---
name: fichas
description: Las fichas didácticas A4 de Tecnia Lab, listas para imprimir y repartir en el aula. Una hoja por componente o concepto — LED, servo, relé, zumbador, LDR, potenciómetro, ultrasónico, PIR, DHT11, Arduino UNO, ESP32, corriente continua y alterna, entradas y salidas. Usala cuando alguien pida material para el aula, algo para repartir, una hoja de un componente, o cuando termines de explicar un componente y convenga dejarle algo impreso.
---

# Fichas de Tecnia Lab — hojas listas para el aula

**Ya están hechas.** No hay que generarlas: son páginas HTML de una hoja A4, en
`hojas/`, listas para abrir e imprimir. Cada una es un componente o un concepto,
con foto o dibujo, sus partes, qué números importan y un tip con el error típico.

Algunas tienen el dibujo **animado** —el relé que cierra, el PIR que detecta, la
onda que avanza—, y eso es justamente lo que un PDF no podía hacer. Al imprimir
se congelan solas en su primer cuadro, así que la hoja de papel sale igual.

## Cuándo ofrecerlas

**Después de explicar, no en vez de explicar.** El conocimiento de los componentes
ya está en los skills `sensores`, `actuadores`, `arduino` y `esp32`: usá esos para
contestar. La ficha es lo que el docente **se lleva impreso**.

Ofrecela cuando:

- pidan material para el aula, para repartir, o algo para imprimir
- terminen de armar un circuito con un componente que tiene ficha
- pregunten por un componente de la lista y la respuesta se haga larga
- un docente esté preparando una clase

**Ofrecé UNA, la que corresponde.** Tirar la lista entera no ayuda a nadie.

## Cómo se entrega: con el tool `ficha`

**Usá el tool `ficha` y pasale el número o el nombre.** Se la abre en el
navegador, lista para Ctrl+P.

El nombre podés decirlo como se habla: «corriente alterna» con espacios funciona
igual que `corriente-alterna`.

### Tres cosas que NO hay que hacer

**1. No leas la ficha.** Ni con `read`, ni con `bash`, ni con nada. Son
doscientos y pico de kilobytes de HTML con el SVG del dibujo adentro: te llena el
contexto de coordenadas y no hace falta —el índice de esta hoja ya te dice qué
trae cada ficha—. El tool `ficha` la **abre**, que es otra cosa.

**2. No le pegues la ruta para que la busque a mano.** Nadie navega hasta
`.config\opencode\skills\fichas\hojas\`, y el docente que abandona ahí se queda
sin la ficha. Si el tool falla, él mismo muestra la ruta como último recurso — no
es tu trabajo adelantarla.

**3. No digas que no podés abrir archivos locales**, porque sí podés: para eso
está el tool `ficha`.

### Abrirla o preguntar antes

| Situación | Qué hacer |
|---|---|
| Te la pidieron («dame algo del LDR», «una hoja del relé») | **abrila**, ya te la pidieron |
| La ofrecés vos, sin que la pidan | **preguntá primero**: «¿te la abro?» |
| Dijeron que sí a tu ofrecimiento | abrila |

Abrir una ficha no rompe nada y no manda nada a ningún lado: es un archivo
local, sin internet de por medio. Lo que molesta es abrir algo que nadie pidió.

## Las hojas que hay

| Nº | Ficha | Familia | Qué resuelve | Archivo |
|---|---|---|---|---|
| 01 | Arduino UNO R3 | placas | La placa con la que se aprende. Se programa con un cable USB, sigue funcionando cuando la desenchufás de la computadora, y aguanta los errores de quien recién empieza. | `hojas/01-arduino-uno.html` |
| 02 | Sensor Shield v5.0 | accesorios | Se monta encima del controlador y convierte cada pin en un conector de tres vías. Un cable por sensor — y los módulos ya tienen su lugar. | `hojas/02-sensor-shield.html` |
| 03 | LED | actuadores | El actuador más simple, y el que enseña las dos cosas que después se usan siempre: que la corriente tiene un sentido, y que hay que limitarla. | `hojas/03-led.html` |
| 04 | Servo | actuadores | Se le pide un ángulo y va. No hace falta contar vueltas ni saber dónde estaba: el servo se ocupa de llegar y de quedarse ahí. | `hojas/04-servo.html` |
| 05 | Corriente continua | fundamentos | La que va siempre para el mismo lado. Es con la que trabaja todo lo que armamos: el controlador, los sensores y los actuadores funcionan con continua. | `hojas/05-corriente-continua.html` |
| 06 | Corriente alterna | fundamentos | La que cambia de sentido cien veces por segundo. Es la que llega por el enchufe, y la única del curso que no se toca: se controla desde afuera. | `hojas/06-corriente-alterna.html` |
| 07 | Entradas y salidas | fundamentos | Veinte de los treinta y dos pines del Arduino no son de entrada ni de salida hasta que el código lo decide. Lo que sí cambia de verdad es CÓMO se lee o se escribe en cada uno. | `hojas/07-entradas-y-salidas.html` |
| 08 | El téster | herramientas | La herramienta que convierte «no sé qué pasa» en un número. Cuatro fichas de esta serie terminan diciendo «medilo con el téster»: acá está cómo. | `hojas/08-tester.html` |
| 09 | El LDR | sensores | Una resistencia que baja cuando le da la luz. Es el sensor más barato del cajón, y el que enseña de una la regla que vale para todos los demás. | `hojas/09-ldr.html` |
| 10 | El potenciómetro | sensores | El divisor de la ficha anterior, pero con perilla. Es la entrada analógica más clara que hay: la posición de la mano se convierte en un número, sin librería. | `hojas/10-potenciometro.html` |
| 11 | El ultrasónico | sensores | El primero que no devuelve un número: devuelve un tiempo. Manda un pulso de sonido, cuenta cuánto tarda el eco en volver, y la distancia sale de una cuenta. | `hojas/11-ultrasonico.html` |
| 12 | El PIR | sensores | No detecta gente: detecta que algo caliente se movió. Alguien quieto desaparece, y eso no es una falla del sensor — es exactamente cómo funciona. | `hojas/12-pir.html` |
| 13 | El DHT11 | sensores | El primero que necesita librería, y por una razón concreta: por un solo cable pasa una conversación de cuarenta bits. Y devuelve dos medidas, no una. | `hojas/13-dht11.html` |
| 14 | El relé | actuadores | Un interruptor mecánico que se maneja con un pin. Es el único de la colección que puede manejar 220 volt, y por eso el único que se enseña con un adulto al lado. | `hojas/14-rele.html` |
| 15 | El zumbador | actuadores | Una palabra que nombra dos componentes distintos. Uno suena con darle tensión; el otro necesita que vos le pongas la frecuencia. Y no consumen ni parecido. | `hojas/15-zumbador.html` |
| 16 | Tecnia Bot | herramientas | Un asistente de electrónica que habla en español, explica el porqué antes del código y no se cansa de que le pregunten. Gratis, abierto, y corre en la máquina del aula. | `hojas/16-tecnia-bot.html` |
| — | ESP32 DevKit v1 | placas | La placa que se conecta a internet. Trae WiFi y Bluetooth adentro y corre mucho más rápido que un UNO — pero trabaja en 3,3 V, y eso cambia todo lo que se le enchufa. | `hojas/borrador-esp32-devkit.html` |

## El tip de cada una

Sirve para saber cuál ofrecer: si lo que están por hacer es justo el error del
tip, esa es la ficha.

- **01 · Arduino UNO R3** — Antes de cablear nada, hacé parpadear el LED «L» que ya está en la placa. Si eso anda, la computadora, el cable, el puerto y el programa están bien — y cualquier problema que aparezca después es del circuito, no del entorno. Cinco minutos que ahorran una clase entera.
- **02 · Sensor Shield v5.0** — Seis servos moviéndose a la vez piden mucha más corriente de la que entrega el USB. Si el robot se reinicia al arrancar el movimiento, no es el programa: poné una fuente en la bornera y cambiá el jumper. Es el paso que separa encender un LED de mover algo de verdad.
- **03 · LED** — El color NO dice la tensión. Un verde puede caer 2,1 V o 3,2 V según de qué esté hecho el chip, y los dos se ven idénticos en la caja. Sobre 3,3 V eso es la diferencia entre encender y no encender. Medí uno con el téster antes de calcular: hasta entonces, el ancho del rango es el dato.
- **04 · Servo** — El consumo de bloqueo NO es una falla. Un servo trabado se lleva 700 mA, y una barrera o una pinza llegan al tope mecánico en uso normal: ahí se quedan forzando. Si el proyecto tiene servos que apoyan contra algo, calculá la fuente con el número de bloqueo, no con el de movimiento libre.
- **05 · Corriente continua** — En continua la polaridad no es un detalle: un LED al revés no enciende y no pasa nada, pero un módulo al revés se quema en un segundo y sin aviso. Antes de dar tensión revisá que el positivo y la masa estén donde van. Esa revisión de diez segundos salva más placas que ninguna otra cosa.
- **06 · Corriente alterna** — La alterna del enchufe mata, y no hace falta tocar los dos cables: alcanza con uno y estar en contacto con el piso. En el curso se controla SIEMPRE con un relé, que es una barrera física entre los 5 V del controlador y los 220 de la red. Y lo de 220 lo conecta un adulto, desenchufado.
- **07 · Entradas y salidas** — En el UNO, `analogWrite` NO saca una tensión intermedia: saca la misma onda cuadrada de siempre, quedándose más tiempo arriba. Un LED lo ve como brillo porque el ojo promedia, pero el téster marca cualquier cosa. Para tensión de verdad hace falta filtrarla o una placa con conversor.
- **08 · El téster** — El error que quema el téster: dejar la punta roja en la boca de amperios y medir tensión. Esa boca por dentro es casi un cable, así que apoyarla en una fuente es un cortocircuito. Se va el fusible y a veces algo más. Después de medir corriente, la punta vuelve a su lugar.
- **09 · El LDR** — Un LDR no se lee solo. El pin mide tensión, no ohm: sin la resistencia de abajo el pin queda al aire y el número salta sin sentido. Y si la lectura se queda siempre pegada a un extremo, casi nunca es el LDR: es que la resistencia fija no acompaña la luz que hay en el aula.
- **10 · El potenciómetro** — Consume del riel todo el tiempo, aunque nadie lo toque: la corriente entra por un extremo y sale por el otro. Uno de 10 k se lleva medio miliampere con 5 V; uno de 1 k se lleva cinco, diez veces más. Con uno solo no se nota. Con seis en un brazo robótico, sí.
- **11 · El ultrasónico** — No ve: escucha un rebote. Una superficie blanda —una campera, una cortina— se traga el sonido, y una en ángulo lo manda para otro lado. En los dos casos el sensor no avisa que falló: devuelve un número enorme, o cero. Antes de culpar al código, probalo contra una pared lisa.
- **12 · El PIR** — Se llama sensor de movimiento y no ve movimiento: ve que un lado recibió más calor que el otro. Alguien sentado y quieto deja de existir, aunque esté a un metro. No es una falla ni se arregla con el pote: es cómo funciona. Si hace falta presencia y no paso, el PIR no sirve.
- **13 · El DHT11** — Es lento y hay que respetarlo: pide como mucho una lectura por segundo. Si el loop lo consulta sin freno, la librería devuelve la vieja o nan, y parece que el sensor está roto. No está roto: está ocupado. Un millis entre lecturas resuelve casi todos los problemas del DHT.
- **14 · El relé** — Los 75 mA de la bobina no salen de un pin: un pin da 20 sin forzarlo. Por eso la plaqueta trae transistor y optoacoplador, y por eso VCC va al riel. Y lo otro: del lado de carga puede haber 220 volt, lo único de esta colección capaz de matar. Con la red, adulto presente y todo en caja.
- **15 · El zumbador** — El plano dice «Buzzer» y eso no alcanza. Un activo de 5 V puede llevarse 25 a 30 mA de un pin que da 20; un pasivo, menos de 1. Colgado directo, uno anda años y el otro degrada el pin de a poco, sin que se note. Hay que saber cuál es antes de conectarlo, y el rótulo casi nunca lo dice.
- **16 · Tecnia Bot** — Se equivoca, y a los alumnos hay que enseñarles a desconfiar: un circuito que armó la IA se verifica antes de conectar nada, igual que uno que armó un compañero. Y ojo con «offline»: los circuitos y el manual andan sin conexión, pero para conversar sale a la API de Google.
- **— · ESP32 DevKit v1** — Cuando la carga del programa se queda esperando y no arranca, mantené apretado el botón BOOT mientras empieza a subir, y soltalo cuando veas que avanza. Es el problema más común de esta placa y no tiene nada que ver con el código: la mitad de los «no me anda el ESP32» son esto.

## Cómo se encadenan

Las fichas se leen juntas. Si ofreciste una y hay otra que la continúa, decilo:

- **07 → 09** — la 07 explica qué es un pin analógico; la 09 lo usa por primera vez
- **09 → 10** — la 09 obliga a armar el divisor; la 10 lo trae armado y con perilla
- **03 → 08** — la 03 manda a medir el Vf real; la 08 explica cómo
- **05 → 08** — la 05 es lo primero que se aprende a medir con el téster
- **11 → 12** — las dos rompen el molde: una devuelve tiempo, la otra HIGH o LOW
- **14 → 15** — las dos van al mismo error: sacar de un pin más de lo que da

## Las familias

- **accesorios**
- **actuadores**
- **fundamentos**
- **herramientas**
- **placas**
- **sensores**

## Tres hojas con foto de terceros

Están acá y se reparten como todas. Pero **su foto no es propia**:

| Nº | Ficha | De dónde salió la imagen |
|---|---|---|
| 02 | Sensor Shield v5.0 | foto de catálogo comercial del Sensor Shield |
| 04 | Servo | foto de catálogo comercial del servo |
| 08 | El téster | fotos de catálogo comercial de los tésteres |

**Qué cambia en la práctica:** imprimirlas y repartirlas en el aula está bien.
Subirlas al sitio de la escuela, a un repositorio público o a redes sociales, no
—esa foto no es de Tecnia Lab—.

Si alguien pregunta si puede publicarlas, decile esto. Para las otras catorce no
hay ninguna restricción: son dibujo propio o capturas del propio producto.

---

*Generado desde los `ficha.json` del repo `fichas-tecnialab` con
`src/skill-tecnia-bot.mjs`. No editar a mano: se regenera y se pierde el cambio.*
