# Monitor serial 📟

El **monitor serial** es la ventana por donde tu computadora y la placa (Arduino UNO / ESP32) se hablan por el cable USB. Sirve para dos cosas:

- **Ver** lo que la placa manda: lecturas de sensores, mensajes, valores de debug.
- **Mandarle** teclas a la placa: por ejemplo, mover un servo apretando teclas.

Tecnia Bot te lo abre en una **ventana aparte**, con el puerto y los baudios ya resueltos. No necesitás saber en qué puerto está la placa (COM3, COM7, `/dev/ttyUSB0`...), ni escribir comandos: **el bot hace el trabajo sucio.**

> No hace falta tener un proyecto abierto ni código cargado para abrir el monitor. Solo la placa conectada por USB.

---

## Cómo abrirlo

En el chat de Tecnia Bot, escribí:

```
abrí el monitor serial
```

(o *"quiero ver el monitor serial"*, *"mostrame los datos de la placa"*).

El bot **detecta el puerto solo**, abre una ventana nueva y ahí corre el monitor. Vas a ver algo así en el título de la ventana:

```
Monitor Serial - COM3
```

y adentro, la placa conectada:

```
--- Terminal on COM3 | 9600 8-N-1
--- Quit: Ctrl+C
```

Para **cerrar** el monitor, apretá **Ctrl+C** dentro de esa ventana.

---

## Comandar la placa con el teclado

El ejemplo clásico: mover un **servo** con las teclas. Para que funcione hacen falta **dos cosas trabajando juntas**:

1. Un **sketch** en la placa que **lea** el serial y mueva el servo según la tecla.
2. El **monitor serial** abierto, para **mandar** las teclas.

### El sketch (Arduino UNO)

> 💡 Hay un ejemplo **listo para compilar** en [`ejemplos/servo-teclado-uno/`](../ejemplos/servo-teclado-uno) (UNO) y [`ejemplos/servo-teclado-esp32/`](../ejemplos/servo-teclado-esp32) (ESP32).

Pedile al bot *"armame un sketch para mover un servo con el teclado"*, o usá este:

```cpp
#include <Servo.h>

Servo servo;
int angulo = 90;  // posicion inicial (centro)

void setup() {
  Serial.begin(9600);   // IMPORTANTE: debe coincidir con los baudios del monitor
  servo.attach(9);      // el servo va al pin 9
  servo.write(angulo);
  Serial.println("Listo. Apreta 'a' (izquierda) o 'd' (derecha).");
}

void loop() {
  if (Serial.available() > 0) {     // llego una tecla?
    char tecla = Serial.read();
    if (tecla == 'a' && angulo > 0)   angulo -= 10;   // izquierda
    if (tecla == 'd' && angulo < 180) angulo += 10;   // derecha
    servo.write(angulo);
    Serial.print("Angulo: ");
    Serial.println(angulo);
  }
}
```

> **En ESP32** la librería es `ESP32Servo` (en vez de `Servo.h`). Pedile al bot *"pasalo a ESP32"* y te lo adapta.

### El flujo completo

1. Pedile al bot que **cargue** el sketch a la placa (*"cargá este código"*).
2. Escribí *"abrí el monitor serial"*.
3. En la ventana que se abre, apretá **`a`** o **`d`** → el servo se mueve, y vas viendo el ángulo.

---

## Los baudios (importante)

Los **baudios** son la velocidad de la conversación. El sketch los fija con `Serial.begin(9600)`, y el monitor tiene que usar **el mismo número**. Tecnia Bot usa **9600 por defecto**; si tu sketch usa otro (muchos ESP32 usan `115200`), pedíselo:

```
abrí el monitor serial a 115200 baudios
```

Si los baudios no coinciden, vas a ver **caracteres raros** en vez de texto legible. Es el síntoma clásico: revisá que el `Serial.begin(...)` y el monitor usen el mismo valor.

---

## `pio` en la terminal (para usuarios avanzados)

El instalador deja **`pio` disponible en el PATH**, así que si sos usuario avanzado podés abrir una terminal (cmd/PowerShell en Windows, tu terminal en Linux/Mac) y correr comandos de PlatformIO a mano:

```bash
pio device list          # ver placas conectadas
pio device monitor       # abrir el monitor a mano
```

> Un docente **no necesita** esto — el bot le abre el monitor y hace todo. Es una comodidad para quien quiera usar la línea de comandos directamente. En Windows, si recién instalaste, abrí una terminal **nueva** para que tome el PATH.

---

## Si algo no anda

| Síntoma | Qué pasa | Solución |
| --- | --- | --- |
| "No encontré ninguna placa" | La placa no está conectada o no se detecta | Conectá el Arduino/ESP32 por USB y reintentá. En Windows puede faltar el driver USB (ver [instalación Windows](instalacion-windows.md)) |
| La ventana abre pero no muestra datos | El sketch no manda nada, o la placa está sin código | Cargá un sketch que use `Serial.println(...)` |
| Se ven **caracteres raros** | Los baudios no coinciden | Igualá el `Serial.begin(...)` del sketch con los baudios del monitor |
| El monitor "no abre" | El puerto está ocupado por otro programa (ej: el Serial Monitor del Arduino IDE) | Cerrá el otro programa; solo uno puede usar el puerto a la vez |

---

## Cómo funciona por dentro

*(para quien quiera contribuir — esto es open source)*

La acción vive en `opencode/tool/platformio.ts` (acción `monitor`). En vez de correr el monitor *dentro* del chat (lo colgaría, porque es un proceso infinito), **lanza una ventana de terminal aparte**:

- **Windows**: `cmd /c start "<titulo>" cmd /k <pio> device monitor --port <COM> --baud <baud>` — `start` abre la ventana y vuelve al instante.
- **macOS**: `osascript` le pide a Terminal.app que corra el comando.
- **Linux**: prueba `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xterm`.
- **Fallback**: si no puede abrir una ventana, devuelve el comando exacto listo para copiar y pegar.

La ruta de `pio` se resuelve con `pioBin()` (ruta completa, sin depender del PATH) y el puerto con `detectPort()`. Así funciona aunque `pio` no esté en el PATH del sistema.
