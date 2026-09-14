# Volcado de `pinInfo` de las piezas Wokwi

Extraído del bundle real (`opencode/tecniabot-web/wokwi-bundle.js`) en Chrome,
instanciando cada elemento y leyendo `el.pinInfo`.

**`pinInfo` es un getter de INSTANCIA, no una propiedad estática**: hay que crear
el elemento y adjuntarlo al DOM para poder preguntarle.

Las coordenadas `x,y` están en **píxeles desde el borde del elemento, a escala 1.0**
(el UNO mide 274,3 × 205,6 px y su pin más lejano cae en 255,5 × 191,5). Verificado
visualmente: pintando un punto en cada coordenada, los 31 caen sobre los agujeros
de los headers.

`signals` es una **fuente independiente** para validar nuestro hardware: marca `pwm`,
`analog`, `SDA`/`SCL`, `TX`/`RX`, `SCK`/`MISO`/`MOSI`/`SS`.

## wokwi-arduino-uno — 274,3 × 205,6 px · 31 pines

Header de arriba (y = 9):

| nombre | x | signals |
|---|---|---|
| `A5.2` | 87 | analog/SCL |
| `A4.2` | 97 | analog/SDA |
| `AREF` | 106 | |
| `GND.1` | 115.5 | GND |
| `13` | 125 | SCK |
| `12` | 134.5 | MISO |
| `11` | 144 | MOSI/**pwm** |
| `10` | 153.5 | SS/**pwm** |
| `9` | 163 | **pwm** |
| `8` | 173 | |
| `7` | 189 | |
| `6` | 198.5 | **pwm** |
| `5` | 208 | **pwm** |
| `4` | 217.5 | |
| `3` | 227 | **pwm** |
| `2` | 236.5 | |
| `1` | 246 | TX |
| `0` | 255.5 | RX |

Header de abajo (y = 191.5):

| nombre | x | signals |
|---|---|---|
| `IOREF` | 131 | |
| `RESET` | 140.5 | |
| `3.3V` | 150 | VCC |
| `5V` | 160 | VCC |
| `GND.2` | 169.5 | GND |
| `GND.3` | 179 | GND |
| `VIN` | 188.5 | VCC |
| `A0` | 208 | analog |
| `A1` | 217.5 | analog |
| `A2` | 227 | analog |
| `A3` | 236.5 | analog |
| `A4` | 246 | analog/SDA |
| `A5` | 255.5 | analog/SCL |

**Los digitales se llaman con el número pelado** (`"2"`, `"13"`), NO `D2`.
**Hay TRES tierras** (`GND.1` arriba, `GND.2`/`GND.3` abajo) y ninguna se llama `GND`.
**`A4.2`/`A5.2` son los pines I²C repetidos** arriba de AREF que trae el UNO R3.

## wokwi-esp32-devkit-v1 — 106,6 × 208,3 px · 30 pines

Columna izquierda (x = 5) y derecha (x = 101.3). **Los GPIO se llaman `D<n>`**
(`D13`, `D27`, `D4`), NO `GPIO<n>`.

Izquierda: `VIN`@158.5 · `GND.2`@149 · `D13`@139.5 (MOSI/pwm) · `D12`@130.4 (MISO/pwm) ·
`D14`@120 (SCK/pwm) · `D27`@110.8 (pwm) · `D26`@101 (pwm) · `D25`@91.3 (pwm) ·
`D33`@81.7 (pwm) · `D32`@72.2 (pwm) · `D35`@62.9 · `D34`@53.1 · `VN`@44 · `VP`@34 · `EN`@24

Derecha: `3V3`@158.5 · `GND.1`@149 · `D15`@139.5 (SS/pwm) · `D2`@130.4 (pwm) · `D4`@120 …

## Componentes

| pieza | pines |
|---|---|
| `wokwi-led` | `A` `C` |
| `wokwi-servo` | `GND` `V+` `PWM` |
| `wokwi-hc-sr04` | `VCC`@71.3,94.5 `TRIG`@81.3 `ECHO`@91.3 `GND`@101.3 |
| `wokwi-pushbutton` | `1.l` `2.l` `1.r` `2.r` |
| `wokwi-buzzer` | `1`@27,84 `2`@37,84 |
| `wokwi-dht22` | `VCC`@15,114.9 `SDA`@24.5 `NC`@34.1 `GND`@43.8 |
| `wokwi-lcd1602` | `VSS` `VDD` `V0` `RS` `RW` `E` `D0`..`D7` `A` `K` (16, y=131) |
| `wokwi-analog-joystick` | `VCC`@33,115.8 `VERT`@42.6 `HORZ`@52.2 `SEL`@61.8 `GND`@71.4 |
| `wokwi-flame-sensor` | `VCC`@199,14.6 `GND`@199,24.3 `DOUT`@199,34 `AOUT`@199,43.7 |
| `wokwi-ir-receiver` | `GND`@21,87.8 `VCC`@30.6 `DAT`@40.2 |
| `wokwi-7segment` | `COM.1` `COM.2` `A`..`G` `DP` |

## Las que NO tienen `pinInfo` — son nuestras, hay que agregárselo

`pb-bmp180` · `pb-bomba` · `pb-calefactor` · `pb-driver` · `pb-higrometro` ·
`pb-lampara` · `pb-lluvia` · `pb-motor` · `pb-relay` · `pb-valvula`

Diez de diez. Son las de `componentes-extra.js`, dibujadas por nosotros porque
Wokwi no las trae — y son justo las de los proyectos INET.

## Cómo regenerar esto

Servir una página con `wokwi-bundle.js` + `componentes-extra.js`, crear cada tag,
adjuntarlo al DOM, esperar ~90 ms y leer `el.pinInfo`. **Ojo**: si el elemento se
pone con `display:block` dentro de un contenedor ancho, su `getBoundingClientRect()`
se estira y NO sirve para medir; las coordenadas de `pinInfo` no se ven afectadas.
