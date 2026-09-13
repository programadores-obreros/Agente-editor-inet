---
name: circuitos-visuales
description: Generar un circuito VISUAL profesional en HTML con piezas reales que el alumno abre en el navegador. Para cuando piden "circuito bonito", "esquema visual", "mostrame el circuito lindo", "ver/entender el protoboard" de Arduino/ESP32 con servo, LED, sensores, relé, bomba, etc.
---

# Circuitos visuales en HTML — usá el tool `circuito`

Para cualquier circuito visual, esquema, diagrama animado, "circuito bonito" o explicador de protoboard, **usá SIEMPRE el tool `circuito`**. Ese tool ya tiene todo resuelto (piezas reales, cables, animación, interacción) y genera el HTML solo.

> ⛔ **NUNCA dibujes vos un archivo `.svg` o `.html` a mano.** Está prohibido inventar coordenadas de pines o escribir el HTML con `edit`/`write`. El tool `circuito` es el ÚNICO método aprobado. Si dibujás a mano, sale mal y se desalinea.

## Cómo usarlo

Llamá al tool `circuito` con UNO de estos dos argumentos:

**a) `circuito` (un preset validado)** — cuando el pedido coincide con uno:
- Sueltos: `servo-esp32`, `led-esp32`, `ultrasonico-esp32`, `buzzer-esp32`, `dht22-esp32`, `pir-esp32`, `lcd-esp32`
- Interactivos (el alumno controla con el mouse): `potenciometro-esp32`, `boton-esp32`
- Proyectos: `estacion-meteo`, `alarma`, `semaforo`
- **`protoboard`** → explicador interactivo de la placa de pruebas (tocás un agujero y se iluminan los que están conectados). Usalo cuando pidan **ver/entender/cómo funciona el protoboard o breadboard**.

**b) `componentes` (armador libre)** — cuando es una combinación que no es preset. Lista separada por comas, de 1 a 6 componentes. Tipos: `led`, `rgb-led`, `servo`, `stepper`, `motor`, `driver`, `potenciometro`, `joystick`, `buzzer`, `ultrasonico`, `dht22`, `ntc`, `pir`, `ldr`, `llama`, `sonido`, `ir`, `tilt`, `lcd`, `oled`, `7segmentos`, `neopixel`, `mpu6050`, `teclado`, `boton`, `relay`, `bomba`, `valvula`, `higrometro`, `lluvia`, `bmp180`, `lampara`, `calefactor`. GPIO opcional con dos puntos: `led:4, servo:18`.

Ejemplos de proyectos del INET con el armador: riego → `"higrometro, relay, bomba"`; tanques → `"ultrasonico, relay, bomba"`; calefacción → `"dht22, relay, calefactor"`; lumínico → `"ldr, pir, relay, lampara"`.

## Un sensor + un actuador = SIMULADOR, no dibujo

Esto es lo mejor que tiene el tool y casi nadie lo usa a propósito: **cuando el armador libre recibe un sensor Y un actuador, el HTML que sale no es un esquema quieto — es un simulador**. Aparece un slider con la magnitud física de verdad (temperatura, distancia, humedad del suelo), el alumno lo mueve con el dedo, y cuando el valor cruza el umbral el sensor se ilumina y el actuador arranca. Sin placa, sin cables y sin esperar a que llegue el kit.

**Los 8 sensores que mueven el slider**, cada uno con su magnitud y su rango:

| Sensor | Qué simula el slider | Rango | Dispara (default) |
|---|---|---|---|
| `dht22` | 🌡️ Temperatura | 0 a 60 °C | ≥ 35 °C |
| `ntc` | 🌡️ Temperatura | 0 a 60 °C | ≥ 35 °C |
| `ultrasonico` | 📏 Distancia | 2 a 200 cm | **≤ 20 cm** |
| `pir` | 🚶 Movimiento | 0 a 1 | ≥ 1 |
| `llama` | 🔥 Fuego cerca | 0 a 100 % | ≥ 50 % |
| `sonido` | 🔊 Nivel de ruido | 0 a 100 % | ≥ 60 % |
| `higrometro` | 💧 Humedad del suelo | 0 a 100 % | **≤ 35 %** |
| `lluvia` | 🌧️ Lluvia | 0 a 100 % | ≥ 50 % |

**Los 9 actuadores que le responden**: `led`, `servo`, `buzzer`, `relay`, `bomba`, `valvula`, `lampara`, `calefactor`, `motor`. Los tres lógicos hacen lo suyo (el LED prende, el servo gira a 180°, el buzzer suena); los seis de potencia —relé, bomba, válvula, lámpara, calefactor y motor— se encienden con un resplandor naranja.

Cualquiera de esos 8 con cualquiera de esos 9 te da un simulador andando: **72 combinaciones**. No hace falta pedir nada especial — alcanza con que los dos estén en la lista de `componentes`.

### `umbral` — el punto de disparo

El arg `umbral` fija a partir de qué valor se activa el actuador. Si el docente dice *"quiero que el LED prenda a los 20 grados"*, pasale `umbral: 20` y el propio HTML lo aclara abajo del slider: *"el LED se activa con ≥ 20 °C"*. Sin `umbral` usa el default de la tabla de arriba.

**La DIRECCIÓN del umbral la da vuelta el tool solo — no la pelees.** Hay tres casos donde "dispararse" significa valor BAJO, y los detecta sin que le digas nada:

- `ultrasonico` → dispara cuando algo está **cerca** (≤ 20 cm), no lejos.
- `higrometro` → dispara cuando la tierra está **seca** (≤ 35 %), no mojada.
- si en el circuito hay un `calefactor` → dispara con **frío** (temperatura ≤ umbral), aunque el sensor sea un DHT22.

Por eso el riego (`"higrometro, relay, bomba"`) prende la bomba cuando **bajás** la humedad, y la calefacción (`"dht22, relay, calefactor"`) prende cuando **bajás** la temperatura. Es lo que pasa en la vida real, y el cartelito del HTML lo dice con el signo correcto (*"el Módulo Relé se activa con ≤ 35 %"*).

### Por qué esto importa más que el dibujo

Los proyectos del INET no enseñan "cómo se ve un relé". Enseñan una sola idea, la misma en todos: **sensor → decisión → actuador**. El skill `actuadores` lo dice del proyecto 12, la calefacción, que es el caso más limpio de todos:

> *"Es el termostato del proyecto de **calefacción del INET**: cierra el lazo sensor → decisión → actuador."*

Un dibujo estático muestra las piezas. El simulador muestra **el lazo**: el alumno baja la temperatura con el dedo y ve al relé cerrar. Ahí entiende qué es un umbral, y lo entiende antes de haber conectado un solo cable. Así que cuando el pedido tenga un sensor y un actuador, no lo pienses como "el esquema, pero con dos piezas": tenés la clase entera adentro de un archivo.

## Pines: cuando el proyecto ya trae su pinout

El tool reparte los GPIO solo, y reparte bien: evita los de flash (GPIO6 a 11) y deja los strapping para el final. Pero **su pool automático saltea GPIO16 y GPIO17** (son los de la PSRAM en las placas que la traen), y las fichas de `proyectos-inet` traen el pinout EXACTO de cada proyecto — el semáforo, por ejemplo, arranca justo en GPIO16 y GPIO17.

Si dejás que reparta solo, el circuito le va a mostrar al alumno pines distintos a los de su ficha de cátedra. Y como la regla del prompt dice que **el circuito es la fuente de verdad de los pines y el código lo sigue**, el alumno termina cableando contra el material del curso.

**La regla, entonces: si el circuito es de un proyecto del INET, pasale el pinout de la ficha con la sintaxis `componente:GPIO`.**

```
componentes: "led:16, led:17, led:18, led:19, led:21, led:22"   ← semaforización, pinout de la ficha
```

GPIO16 y GPIO17 **SÍ son válidos**: solo los saltea el reparto automático. Forzados a mano el tool los acepta sin chistar. Si le pasás uno que no existe o uno de flash, no te deja: avisa y te asigna uno seguro.

## `nombre_archivo` — ponele el nombre del proyecto

Sin este arg, el archivo sale bautizado con las piezas: `circuito-armado-higrometro-relay-valvula-led.html`. Un docente que arma media docena de proyectos termina con media docena de nombres que no distingue, todos en la misma carpeta, y en el medio de la clase no sabe cuál abrir.

**Convención: el nombre del PROYECTO, no el de las piezas** (sin extensión, el tool le pone el `.html`):

```
nombre_archivo: "riego-automatizado"
nombre_archivo: "sistema-de-tanques"
nombre_archivo: "calefaccion"
```

Si no es un proyecto del INET, poné lo que el docente vaya a buscar después: `"semaforo-2-calles"`, `"alarma-del-aula"`. Cuesta tres palabras y le ahorra abrir seis archivos para encontrar el suyo.

## Qué hace el tool por vos

- Elige los pines seguros del ESP32 (evita los de flash y avisa de los strapping).
- Dibuja las piezas reales conectadas con cables de colores, con tabla de conexiones y advertencias de voltaje/seguridad.
- Copia la biblioteca de piezas al lado del HTML (funciona sin internet).
- Devuelve la ruta `file://…` para que le digas al alumno: *"Abrí este archivo en tu navegador (doble clic)"*.

## Principios de diseño de esquemáticos

Cuando armes o expliques un circuito, respetá estas reglas para que quede claro y profesional:

- **Sin cruces**: preferí que los cables corran paralelos, sin cruzarse. Ordená los componentes según el orden de sus pines y hacé que el flujo vaya en una sola dirección (de la señal hacia el actuador). Un cable que cruza a otro confunde al que recién arranca.
- **Serie visible**: cuando una resistencia va EN SERIE (ej. GPIO → 220Ω → LED en ESP32), tiene que notarse que la corriente la ATRAVIESA. Idealmente dibujada inline (el cable entra a la resistencia y sale hacia el LED); como mínimo, decilo claro con la notación `→ 220Ω →`. Nunca la muestres "colgando" al costado como si no formara parte del camino.
- **Colores estándar**: cada señal siempre del mismo color a lo largo de todo el esquema. Alimentación en rojo, GND en negro. Así el ojo sigue una señal sin perderse.
- **Claridad para principiantes**: etiquetas claras en las DOS puntas de cada cable (de qué pin sale y a dónde llega). Nada de cables que se pierdan o queden sin destino visible.

El tool ya aplica estos principios: el **armador libre** usa un layout por filas (una fila por componente, cables CSS que crecen con flex) que es IMPOSIBLE de cruzar o desalinear; y las **2 plantillas de protoboard** (`boton-led-protoboard`, `semaforo-protoboard`) muestran las piezas reales pinchadas en la placa con jumpers de colores y halo blanco para que los cables se distingan aun cuando se cruzan. Por eso NO dibujes vos: dejá que el tool arme.

## Cuándo NO hace falta el HTML

Para una explicación rápida en el chat (sin abrir el navegador), alcanza con el skill `diagramas-conexion` (dibujo ASCII + tabla de colores). Reservá el tool `circuito` para el material visual de calidad o cuando pidan algo "para mostrar/ver".
