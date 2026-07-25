# Mover un servo con el teclado (ESP32-DevKitC) 🎛️

Este ejemplo es tu primer paso en **comunicacion serial**: tu computadora le manda
teclas a la placa por el cable USB, y la placa mueve un **servo SG90** segun lo que
aprietes. Apretas `a` y gira a la izquierda, apretas `d` y gira a la derecha. Simple
y divertido.

## Que hace

- Arranca con el servo en el centro (90 grados).
- Escucha el monitor serial. Cada vez que llega una tecla:
  - `a` → resta 10 grados (izquierda), sin bajar de 0.
  - `d` → suma 10 grados (derecha), sin pasar de 180.
- Te muestra el angulo actual en el monitor.

## Diferencias con el ejemplo del UNO

- La libreria Servo del ESP32 **no viene incluida**: el `platformio.ini` la agrega con
  `lib_deps = madhephaestus/ESP32Servo`.
- El monitor serial va a **115200 baudios** (el UNO usa 9600).
- El servo va en **GPIO13** (en el UNO iba en el pin 9).

## Cableado del servo

El servo SG90 tiene tres cables:

| Color del cable | Va a...              |
| --------------- | -------------------- |
| 🟠 Naranja      | GPIO13 (senal)       |
| 🔴 Rojo         | 5V (pin VIN / 5V)    |
| 🟤 Marron       | GND                  |

> El SG90 anda con los 5V de la placa. Si usas un servo mas grande, alimentalo con una
> fuente aparte y uni las masas (GND) para no exigir el ESP32.

## Como cargarlo

1. Abri esta carpeta (`ejemplos/servo-teclado-esp32`) con PlatformIO.
2. Conecta el ESP32 por USB.
3. Carga el codigo (boton **Upload** / `pio run -t upload`).

## Como probarlo

1. Con la placa conectada, pedile a Tecnia Bot: **"abri el monitor serial"**.
2. Se abre una ventana aparte. Vas a ver: `Listo. Apreta 'a' (izquierda) o 'd' (derecha).`
3. Apreta `a` y `d` y mira como se mueve el servo. El angulo aparece en pantalla.

Todo lo del monitor serial (que es, como abrirlo, como mandar teclas) esta explicado
en la guia [docs/monitor-serial.md](../../docs/monitor-serial.md).

## Para saber mas

Este ejemplo forma parte del tema **comunicacion serial** (ver el skill
`comunicacion-serial`): la base de casi todo lo interactivo que vas a hacer con la placa.

¿Tenes un Arduino UNO en vez de un ESP32? Mira el ejemplo hermano en
[`ejemplos/servo-teclado-uno`](../servo-teclado-uno).
