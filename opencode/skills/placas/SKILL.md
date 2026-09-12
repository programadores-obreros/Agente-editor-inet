---
name: placas
description: Catálogo de placas que Tecnia Bot sabe programar y de las que sabe que NO sabe. Arduino UNO (original, clon, con Sensor Shield v5.0 o IO Expansion DFRobot), ESP32 DevKit, ESP8266, Educabot Educablocks UNO, Educabot Bhoot (que el software llama "Buty"), Mis Ladrillos R10/R8+/R4. Para cada una - el `board =` de PlatformIO, la tensión, el chip USB, el mapa puerto → pin y las variantes. Incluye las placas RECONOCIDAS pero NO soportadas (Robustito, RobotGroup DuinoBot, Makeblock, Robobloq, Mis Ladrillos R2+/R9/R11) para poder nombrarlas y frenar en vez de inventarles pines. Frases típicas - "qué placa tengo", "con qué placa estás trabajando", "no sé qué placa es", "tengo el robot de la escuela", nombres de marca de cualquier kit.
---

# Catálogo de placas

Este skill contesta UNA pregunta: **¿qué placa tiene el docente adelante, y qué puedo afirmar sobre ella?**

Antes de dar un pin, una tensión, un `platformio.ini` o una línea de código, la placa tiene
que estar resuelta y encontrada acá. Si no está, **no se inventa**: se frena y se da todo
lo que no depende de la placa (que es mucho, ver más abajo).

## REGLA DE ORO

**Un pin, una tensión o un `board =` que no esté en este catálogo no existe.**

No importa cuán razonable suene. Un dato de hardware inventado no da error de
compilación: compila perfecto, el alumno cablea, y recién ahí se rompe algo. Es
exactamente el modo de falla que este catálogo existe para evitar.

Si el docente nombra una placa que no está acá, la respuesta honesta —y además la
mejor enseñanza— es decirlo:

> Esa placa no la tengo verificada. Te puedo explicar todo lo que no depende de ella
> —el sensor, el cableado, la lógica— pero los pines los tenés que sacar de la
> serigrafía de tu plaqueta o del manual del fabricante, y ahí no te puedo adivinar.

---

## Los tres estados

Cada entrada del catálogo tiene un **estado**, y el estado decide qué podés hacer:

| Estado | Qué significa | Qué podés hacer |
|---|---|---|
| ✅ **soportada** | tenemos `board =`, tensión y mapa de pines verificados | todo: `platformio.ini`, código, compilar, cargar |
| ⚠️ **parcial** | compila y carga, pero hay hardware que NO se alcanza desde PlatformIO | todo, **pero decís el límite ANTES**, no después |
| ⛔ **reconocida, no soportada** | sabemos que existe y cómo se llama, pero no tenemos los datos | solo lo conceptual. Nunca pines, tensión ni código |

---

## Qué SÍ y qué NO con una placa desconocida

Esta tabla es el corazón del skill. **Frenar no es cortar la conversación**: la mitad
izquierda vale igual en cualquier placa del mundo.

| SÍ das, siempre | NO das nunca, sin catálogo |
|---|---|
| La lógica: `if`, `while`, leer y decidir | **El número de pin** |
| Qué es el sensor y cómo funciona | **La tensión de trabajo** |
| El concepto de cableado: señal, VCC, GND | **El rango del ADC** (1023 vs 4095) |
| La idea de PWM, de I²C, de serie | **Cómo se hace PWM** (`analogWrite` vs `ledc`) |
| Los errores típicos de protoboard | **El `board =`** y el `platformio.ini` |
| El divisor de tensión, la resistencia del LED | **Las librerías** y el `lib_deps` |
| Qué le falta al docente y **dónde conseguirlo** | Un `main.cpp` que compile contra pines inventados |

Y cerrás siempre con el camino concreto: la serigrafía de la placa, el manual del
fabricante, o el tester.

---

## La regla del conector físico

**Puerto → pin se afirma. Contacto físico del conector va a tester. Siempre.**

Esto no es prudencia de más: es un patrón verificado en fabricantes de dos continentes.

- **Educabot** publica qué pin lleva cada puerto RJ12, pero **no** la posición de cada
  señal en los 6 contactos del conector.
- **Makeblock** publica el mapa de puertos en el código de su librería, pero **no** el
  pinout del RJ25 6P6C. Solo aparece en blogs.

Entonces: *"el puerto 3 del Bhoot es el D10"* → **se afirma, está en el catálogo**.
*"el contacto 2 del cable es VCC"* → **nunca**. Si el docente arma un cable o usa un
módulo que no es del kit, va a medir con tester.

---

## El menú: cómo preguntar la placa

Usá el tool `question` con la lista de este catálogo. Tres reglas:

1. **Ninguna opción viene preseleccionada.** El orden es conveniencia, no default.
   Poné primero lo más común en la zona (hoy: Bhoot y Arduino UNO). Un default sobre
   hardware es el mecanismo del falso positivo: acertás con el 95% y al 5% le quemás
   la placa sin que nadie se entere.
2. **No agregues "otra placa" ni "no está en la lista".** El tool `question` ya suma
   solo la opción de escribir una respuesta propia. Y esa respuesta escrita a mano es
   justo el caso donde hay que frenar.
3. **Si la entrada tiene variantes, repreguntá la variante** — pero recién después de
   saber el modelo, y solo en las que lo necesitan (están marcadas ⚠️ VARIANTES).

Antes de abrir el menú, **corré `platformio` con `action: "diagnostico"`**: el VID:PID
no decide la placa, pero la **acota**, y con eso el menú sale más corto y mejor.

### Tabla rápida: chip USB → qué acota

| VID | Chip | Qué te dice |
|---|---|---|
| `2341` / `2A03` | propio de Arduino | **es un Arduino oficial** — descarta ESP y clones |
| `303A` | USB nativo Espressif | **ESP32-S2 / S3 / C3** — descarta AVR |
| `10C4:EA60` | CP2102 | muy probable **ESP32 DevKit** |
| `1A86` | CH340 / CH341 | **no decide**: clon de Arduino, ESP32 o ESP8266 |
| `0403` | FTDI | Arduino Nano viejo, o placa con FTDI |

Y un razonamiento que sirve cuando el chip no alcanza: **si la placa tiene un módulo
Bluetooth soldado aparte, el micro principal no tiene radio** — nadie suelda un HM-10 al
lado de un ESP32, que ya trae BLE adentro. Eso apunta a la familia AVR.

Cuando la sepas, **guardala con el tool `perfil`**. Se pregunta UNA vez por computadora,
no una vez por sesión. La excepción es el modo `aula`, donde a propósito se pregunta cada
vez: esa compu la comparten chicos con placas distintas.

---

# ✅ Placas soportadas

## 01 · Arduino UNO (original o clon)

Para nosotros original y clon son **la misma placa**: mismo micro, mismos pines, mismo
código. Lo único que cambia es el driver.

| | |
|---|---|
| **Micro** | ATmega328P |
| **`board =`** | `uno` · platform `atmelavr` |
| **Tensión** | **5 V** |
| **ADC** | 0-1023 · A0 a A5 |
| **PWM** | 3, 5, 6, 9, 10, 11 (los marcados con `~`) |
| **LED de placa** | pin 13 |
| **USB** | original: VID `2341`/`2A03`, sin driver · clon: **CH340**, VID `1A86` |
| **Monitor** | 9600 |

```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino
monitor_speed = 9600
```

## 02 · Arduino UNO + Sensor Shield v5.0

**Los pines son exactamente los mismos que el UNO pelado.** El shield se monta encima y
solo saca cada pin a un conector de tres vías (señal · V · GND) — no cambia ni un número.
Mismo `platformio.ini` que la entrada 01.

Lo que sí cambia es la **alimentación**, y es el gotcha que importa:

> Seis servos moviéndose a la vez piden mucha más corriente de la que entrega el USB. Si
> el robot se reinicia al arrancar el movimiento, **no es el programa**: poné una fuente
> en la bornera y cambiá el jumper.

La ficha imprimible está en el skill `fichas` (`02 · Sensor Shield v5.0`), abrila con el
tool `ficha`.

**Variante:** el **IO Expansion Shield DFRobot V7.1** (el del kit del brazo robótico,
proyecto 11) funciona igual: apila sobre el UNO, agrupa señal+VCC+GND por servo, mismos
pines. **Es formato UNO: no entra en un ESP32.**

## 03 · ESP32 DevKit

| | |
|---|---|
| **`board =`** | `esp32dev` · platform `espressif32` |
| **Tensión** | **3,3 V** — un sensor de 5 V le puede dañar la entrada |
| **ADC** | 0-4095 · muchos pines, y **cuatro que solo pueden leer** |
| **PWM** | no existe `analogWrite` igual que en el UNO: usa `ledc` |
| **LED de placa** | GPIO 2 en la mayoría de las DevKit |
| **USB** | **CP2102** (VID `10C4:EA60`) o CH340 |
| **Monitor** | 115200 |

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
```

## 04 · ESP8266 (NodeMCU / Wemos D1 mini)

⚠️ **VARIANTES — hay que preguntar cuál es.** El `board =` cambia según el formato:

| Placa | `board =` |
|---|---|
| NodeMCU v2 / v3 (la placa larga con dos filas de pines) | `nodemcuv2` |
| Wemos / LOLIN D1 mini (la chiquita, cuadrada) | `d1_mini` |

Ambas con `platform = espressif8266`, `framework = arduino`, **3,3 V**, monitor 115200.

**Mapa de GPIO** (del generador oficial de Educabot, tabla `t.ESP8266`):

- **Digitales:** 0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16
- **PWM:** 0, 2, 4, 5, 12, 13, 14, 15
- **I²C:** SDA = **4**, SCL = **5**
- **Analógico:** **un solo pin, `A0`**

> **El gotcha grande del ESP8266:** tiene **UNA sola entrada analógica**. Si el proyecto
> necesita dos sensores analógicos, no entra — y conviene decirlo antes de que el docente
> compre los módulos, no después.

> **Y el otro:** la numeración `D1`, `D2`… serigrafiada en el NodeMCU **NO coincide** con
> el número de GPIO. `D1` es GPIO5, `D2` es GPIO4. En el código van los **GPIO**, no los
> rótulos. Es la causa número uno de "conecté bien y no anda".

## 05 · Educabot — Educablocks UNO

La placa de banco de Educabot: un Arduino UNO con **20 puertos RJ12**.

| | |
|---|---|
| **Micro** | ATmega328P en **DIP con zócalo** (el chip grande, se puede sacar) |
| **`board =`** | `uno` · platform `atmelavr` · **5 V** |
| **USB** | **USB-B cuadrado**, el de impresora |
| **Monitor** | 9600 |
| **Serigrafía** | «EDUCABOT · Educablocks UNO» |

Tiene **puertos especiales E3, E4 y E6** con tres señales + VIN, para ultrasonido y
motores. El mapa completo de puertos, los colores oficiales y los módulos están en el
skill `educabot` — **no los repitas acá, andá a buscarlos allá**.

> **Cómo distinguirla del Bhoot:** el chip está en **zócalo** (DIP), el USB es
> **cuadrado**, y tiene **20 puertos** rotulados con el número de pin. Si ves 6 puertos
> numerados 0-5, motores MI/MD y un módulo Bluetooth soldado, **es un Bhoot, no esta**.

## 06 · Educabot Bhoot v1.0 — el software la llama «Buty»

⚠️ **VARIANTES — hay tres, con pinouts distintos.**

**Ojo con el nombre, que nos costó encontrarla:** la serigrafía de la plaqueta dice
**«Bhoot v1.0»**, pero la plataforma de Educabot la llama **«Buty»**. Si el docente dice
cualquiera de las dos, es esta.

| | |
|---|---|
| **Micro** | **ATmega328P-AU**, encapsulado **TQFP-32** (soldado, 8 patas por lado) |
| **`board =`** | `uno` · platform `atmelavr` |
| **Tensión** | **5 V** |
| **USB** | **no es nativo** → hay conversor aparte → aplica el flujo del **CH340** |
| **Carga** | protocolo `arduino`, 115200 (lo que usa el propio Educabot) |
| **Monitor** | 9600 |
| **A bordo** | **LED en D13** · **zumbador en D12** · **HM-10 Bluetooth 4.0** (chip TI CC2541, habla por UART) |
| **Serigrafía** | «EDUCABOT · Bhoot v1.0 · educabot.org» |

```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino
monitor_speed = 9600
```

### Mapa puerto → pin (variante común)

| Puerto | Pin | Qué admite |
|---|---|---|
| **0** | **A0** | digital · analógico · servo |
| **1** | **A3** | digital · analógico · servo |
| **2** | **D3** | digital · **PWM** · servo |
| **3** | **D10** | digital · **PWM** · servo |
| **4** | **D11** | digital · **PWM** · servo |
| **5** | **A6** | **SOLO analógico** |
| **MD** | D4 + D5 | motor derecho |
| **MI** | D7 + D6 | motor izquierdo |
| **IIC** (los dos) | A4 = SDA · A5 = SCL | comparten el mismo bus |

**Ultrasónico:** puerto 0 → trig `A0`, echo `A1` · puerto 1 → trig `A3`, echo `A2`.
**Joystick** en el puerto 0 → `A0`, `A1`, `A7`.

### El LED de D13: el primer programa, sin cablear nada

**D13 y D12 no son puertos: son componentes soldados a la placa.** No aparecen en la
tabla de arriba porque no hay dónde enchufarles nada — ya están conectados.

Y eso los vuelve **el mejor punto de arranque que existe**, por la misma razón que la
ficha `01 · Arduino UNO` del skill `fichas` recomienda empezar por el LED «L»:

> Antes de cablear nada, hacé parpadear el LED que ya está en la placa. Si eso anda,
> **la computadora, el cable, el puerto y el programa están bien** — y cualquier problema
> que aparezca después es del circuito, no del entorno.

Con un docente que recién empieza, o cuando algo no anda y no se sabe por dónde atacar,
**este es el primer programa**: cero cables, cero módulos, cero dudas sobre el circuito.

```cpp
#include <Arduino.h>

const int LED_PLACA = 13;   // el LED que ya viene soldado en el Bhoot

void setup() {
  pinMode(LED_PLACA, OUTPUT);   // lo configuramos como salida
}

void loop() {
  digitalWrite(LED_PLACA, HIGH);  // lo prendemos
  delay(1000);                    // esperamos un segundo
  digitalWrite(LED_PLACA, LOW);   // lo apagamos
  delay(1000);                    // esperamos otro segundo
}
```

Si parpadea: el entorno entero está sano. Si no parpadea, el problema **no es el
circuito** —no hay circuito— así que es el cable, el puerto o el driver, y ahí va el
skill `gotchas-hardware`.

**Origen del dato:** el simulador oficial de Educabot, objeto `onBoardComponents` de la
placa `buty`: `{ buzzerPin: "12", ledPin: "13", ... }`. Es la única asignación de esos
pines en todo el bundle.

> **Por qué el puerto 5 es solo analógico, y por qué eso confirma todo lo demás:** `A6` y
> `A7` del ATmega328P **existen únicamente en el encapsulado TQFP** —el DIP con zócalo no
> los tiene— y son **ADC puros, sin entrada/salida digital**. Que el software de Educabot
> ponga el puerto 5 solo en la lista analógica confirma el encapsulado que se lee en el
> chip, y viceversa. Es un buen ejemplo para el aula de cómo se cruzan dos fuentes.

### Las otras dos variantes

| Variante | En qué cambia |
|---|---|
| **Bhoot LGO20** | el `A6` está en el **puerto 4**, no en el 5 |
| **Bhoot IACO** | tiene **cuatro motores**: MDInf `D4,D5` · MIInf `D7,D6` · MDSup `D2,D3` · **MISup `D10,D11`** |

> ⚠️ Fijate el IACO: usa **D10 y D11 para motores**, que en la variante común son los
> **puertos 3 y 4**. Mismo pin, función distinta. Si asumís la variante equivocada,
> mandás a conectar un sensor donde hay una salida de motor. **Preguntá la variante.**

## 07 · Mis Ladrillos — R10 (hardware v1.0)

⚠️ **VARIANTES — la v1.0 y la v1.1 tienen pinouts DISTINTOS con el mismo nombre.**
Es la placa más peligrosa del catálogo por eso. **Siempre preguntá la versión de hardware.**

| | |
|---|---|
| **Micro** | **ATmega32U4** (el manual lo llama «Atmega32U 1628E»; el IDE la detecta como *Arduino Genuino Micro*) |
| **`board =`** | `micro` · platform `atmelavr` |
| **Tensión** | **5 V** |
| **USB** | **nativo del 32U4** — mini-USB, **sin chip conversor**, no necesita driver CH340 |
| **A bordo** | zumbador **D10** · receptor infrarrojo **D5** |
| **LEDs** | verde TX `D30` · amarillo RX `D17` · rojo `D13` — **andan invertidos: `HIGH` apaga** |

Conector de **6 posiciones**: pin 2 = GND, pin 4 = VCC (+5 V), y los pines **1, 3, 5 y 6**
son señal.

| CON | pin 1 | pin 3 | pin 5 | pin 6 |
|---|---|---|---|---|
| 1 | D11 | D17 | D7 | — |
| 2 | D6 | D15 | D8 | — |
| 3 | D3 | D2 | D12 | D16 |
| 4 | D13 | D14 | D0 (RX) | D1 (TX) |
| 5 | D0 (RX) | D1 (TX) | — | A0 |
| 6 | A9 | A2 | A3 | A1 |
| 7 | D3 | D2 | — | D4 |
| 8 | D3 | D2 | — | A4 |

> ⚠️ **Dato en disputa, mandar a medir:** para el CON7 pin 3 el manual PDF dice `A2` y el
> código de la extensión dice `D2`. **Son dos fuentes oficiales del mismo fabricante que
> se contradicen.** No elijas una: decíselo al docente y que verifique con tester.

## 08 · Mis Ladrillos — R10 (hardware v1.1)

Mismo micro, misma tensión, mismo `board = micro`, mismo USB nativo. **Lo único que cambia
es el mapa de pines — y cambia en cinco de los ocho conectores.**

| CON | pin 1 | pin 3 | pin 5 | pin 6 |
|---|---|---|---|---|
| 1 | D11 | D17 | D7 | — |
| 2 | D6 | D15 | D8 | — |
| **3** | **D19 (A1)** | **D16** | D12 | — |
| 4 | D13 | D14 | D0 (RX) | D1 (TX) |
| **5** | D0 (RX) | **D2 (SDA)** | **D3 (SCL)** | **D18 (A0)** |
| **6** | **D9** | **D20 (A2)** | **D21 (A3)** | — |
| **7** | **D4** | **D22 (A4)** | — | — |
| **8** | **D1 (TX)** | **D2 (SDA)** | **D3 (SCL)** | — |

Zumbador **D10**, infrarrojo **D5**, igual que la v1.0. Los CON7 y CON8 están rotulados
**«DOBLE I2C»** en el PDF oficial de pinout.

> ⚠️ **Por qué esto importa tanto:** si el alumno usa el pinout de la v1.0 en una v1.1,
> puede terminar poniendo **una salida contra otra salida**. Eso es un cortocircuito entre
> dos pines del micro, y se quema el 32U4. **La versión no es un detalle: es la placa.**

## 09 · Mis Ladrillos — R8+

Mismo micro (ATmega32U4), misma tensión, mismo `board = micro`, mismo USB nativo. 8 conectores.

| CON | pin 1 | pin 3 | pin 5 | pin 6 |
|---|---|---|---|---|
| 1 | D11 | D12 | D0 | D1 |
| 2 | D6 | D8 | D3 | D2 |
| 3 | D13 | D4 | D0 | D1 |
| 4 | D7 | A3 | D3 | D2 |
| 5 | D9 | A0 | D0 | D1 |
| 6 | A5 | A2 | — | A1 |
| 7 | D3 | D2 | D0 | D1 |
| 8 | D15 | D14 | D16 | — |

Zumbador **D10**, infrarrojo **D5**.

> ⚠️ **Dato en disputa:** el diagrama del manual rotula el infrarrojo como `D13`, el
> cuerpo del mismo manual dice `D5`, y el código usa `D5`. Dos contra uno a favor de
> **D5**, pero si algo no anda, es el primer lugar donde mirar.

> **El pinout del R8+ NO está en el manual.** El manual dice «en el esquema anterior se
> ven las salidas PIN por cada conector» y el esquema solo tiene dibujitos de sensores.
> Esta tabla se extrajo del código de la extensión oficial.

## 10 · Mis Ladrillos — R4

Mismo micro, 5 V, `board = micro`, USB nativo. **Conectores RJ9 (4 posiciones) para los motores**, no RJ12.

| Función | Pin |
|---|---|
| Motores | **D2, D3** y **D11, D12** |
| LED frontal | **D6** |
| Zumbador | **D10** |
| Infrarrojo | **A5** |
| LED amarillo RX | D17 · **LED rojo** D13 · **LED verde TX** D30 |

> **Origen del dato:** este pinout sale del manual PDF oficial (`Manual_R4_Arduino.pdf`),
> no de una extensión que hayamos podido abrir. El manual imprime `A4` tanto para el
> pulsador táctil como para el LDR, lo cual **parece un error del propio manual**. Si el
> docente usa alguno de los dos, mandalo a verificar.

---

# ⚠️ Soportada parcialmente

## mBot2 / mBot Neo (placa CyberPi)

Compila y carga sin problema —es un **ESP32-WROVER-B**, `board = esp32dev`, 3,3 V, y el
propio Makeblock publica ese `platformio.ini`— **pero los motores no se alcanzan.**

El **mBot2 Shield tiene su propio microcontrolador**, un GD32F403. CyberPi le habla por
puerto serie con un protocolo que **no está documentado**. Desde PlatformIO podés manejar
la pantalla y los sensores del CyberPi; **las ruedas no.**

> **Decilo ANTES de escribir el código, no después.** Un alumno que carga un programa y ve
> que el robot no se mueve concluye que el bot no sirve — y en realidad el programa está bien.

---

# ⛔ Reconocidas, NO soportadas

Estas placas **existen y están en las escuelas**. Saber nombrarlas y decir con honestidad
que no tenemos sus datos es infinitamente mejor que improvisarles un `board = uno`.

Con todas: **aplicá la tabla de "qué SÍ y qué NO"** del principio. El docente se va
entendiendo su problema y sabiendo qué le falta, no con las manos vacías.

| Placa | Por qué no está | Qué decirle |
|---|---|---|
| **Robustito** | **No existe la información.** Kit sanjuanino (UNSJ / San Juan TEC), entregado por el Ministerio a 42 escuelas. Sin sitio, sin manual, sin repo, sin datasheet. El único revendedor no tiene stock hace años | Que el pinout está en la serigrafía de su plaqueta o se lo tiene que dar quien entregó el kit. **Y que no lo fuerce**: es un kit que ya no se consigue |
| **RobotGroup DuinoBot v2.4** | La más vendida y la peor documentada. Sin datos oficiales de micro, tensión ni pines | Que mire la serigrafía del chip grande y la del chip chico al lado del USB |
| **RobotGroup DuinoBot v1.2 / v2.3** | Sí hay datos (32U4 y ATmega1284P), pero necesitan un *variant* propio de Arduino que hay que copiar al proyecto. Queda para una etapa siguiente | Que la documentación sobrevive en GitHub, en el fork de la UNLP `Robots-Linti/Multiplo` |
| **Makeblock** (mBot / Ranger / Ultimate 2.0) | Bien documentadas, pero fuera del alcance de esta etapa | Que Makeblock publica su librería oficial y que se pueden programar con Arduino |
| **Robobloq** (Qoopers / Q-Scout) | Kits cerrados, sin pinout ni firmware propio publicado | Que se programan por bloques sobre hardware del kit |
| **Mis Ladrillos R2+ / R9 / R11** | **El fabricante no publica el micro.** Usan CH340 (o sea, no son 32U4), pero sin el número de parte no hay `board =` confiable | Que el resto de la línea Mis Ladrillos sí está, y que de estas tres falta el dato del micro |
| **Mis Ladrillos R8 (sin el +)** | Solo tenemos el pin 1 de cada conector; los pines 3, 5 y 6 no están en la extensión vieja | Que tenemos parte del mapa y el resto va a tester |
| **DJI Tello (proyecto 08)** | Kit cerrado, se programa por bloques. Ya documentado en `proyectos-inet` | — |

---

## Una advertencia para cuando agreguemos placas

El generador de Educabot trae el `compilerBoard` de **muchas** placas que no son de
Educabot: Makeblock, Robobloq, Mis Ladrillos, micro:bit. **Es tentador copiarlo, y en al
menos un caso está mal.**

Educabot lista el **mBot Ranger** y el **Ultimate 2.0** como `arduino:avr:uno`. La
documentación oficial de Makeblock —y su propio datasheet— dicen **ATmega2560** para las
dos. Alguno de los dos se equivoca, y todo indica que es Educabot.

**Regla:** el `compilerBoard` de Educabot vale para las placas **de Educabot**. Para
placas de terceros, siempre cruzarlo con el fabricante antes de meterlo acá.
