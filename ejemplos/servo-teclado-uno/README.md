# Mover un servo con el teclado (Arduino UNO) 🎛️

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

## Cableado del servo

El servo SG90 tiene tres cables:

| Color del cable | Va a...            |
| --------------- | ------------------ |
| 🟠 Naranja      | Pin 9 (senal)      |
| 🔴 Rojo         | 5V                 |
| 🟤 Marron       | GND                |

> El SG90 es chiquito y anda directo con los 5V del UNO. Si usas un servo mas grande,
> alimentalo con una fuente aparte para no exigir la placa.

## Como cargarlo

1. Abri esta carpeta (`ejemplos/servo-teclado-uno`) con PlatformIO.
2. Conecta el Arduino UNO por USB.
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

¿Tenes un ESP32 en vez de un UNO? Mira el ejemplo hermano en
[`ejemplos/servo-teclado-esp32`](../servo-teclado-esp32).
