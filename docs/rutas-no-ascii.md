# Nombres de usuario con tilde (y por qué los proyectos se quedan donde están)

En una escuela argentina, la usuaria de Windows se llama `Dirección`. O
`Administración`, o `Preceptoría`, o cualquier apellido con tilde o con ñ. Eso
mete un carácter no-ASCII en el medio de `C:\Users\...`, y PlatformIO tiene una
limitación conocida con eso.

Este documento separa **lo que sí rompe** de **lo que se creía que rompía y se
midió que no**.

## Lo que sí rompe: dónde se instala PlatformIO

PlatformIO Core no soporta rutas con caracteres no-ASCII, así que **su instalador
relocaliza el entorno a la raíz del disco**: instala en `C:\.platformio` en vez de
`C:\Users\Dirección310\.platformio`.

Comprobado el 9 de septiembre de 2026 en la VM de Windows 10, con un usuario de
Windows realmente acentuado y con `C:\.platformio` inexistente al empezar:

```
Installer version: 1.2.2
Creating a virtual environment at C:\.platformio\penv
PlatformIO Core has been successfully installed into an isolated environment `C:\.platformio\penv`!
```

Eso es comportamiento de PlatformIO, no un bug de ellos: sus toolchains de gcc se
rompen con rutas no-ASCII, y mudarse es la forma de evitarlo.

**Nuestro bug era buscarlo en un solo lugar.** Está arreglado: se busca en
`PLATFORMIO_CORE_DIR`, el home, la raíz del disco del perfil, `C:\.platformio` y
el PATH, en ese orden, en los seis lugares del repo que lo necesitan. Lo custodia
`tests/platformio-pio.test.mjs`, que los exige a todos y falla nombrando cuál se
olvidó.

## Lo que NO rompe: dónde viven los proyectos del docente

Durante la investigación quedó abierta una hipótesis razonable: si PlatformIO no
tolera rutas no-ASCII, tal vez tampoco pueda **compilar un proyecto** que vive
bajo un home acentuado. De ser cierto, Tecnia Bot tendría que crear los proyectos
en una ruta ASCII (`C:\tecnia`) en vez de `%USERPROFILE%\Documents\Tecnia Bot`.

**Se midió. La respuesta es no: compila igual.**

Mismo `pio`, mismo `PLATFORMIO_CORE_DIR`, mismo sketch. Lo único que cambia entre
los dos casos es la ruta del proyecto:

| Placa | Ruta del proyecto | Resultado |
|---|---|---|
| Arduino UNO (AVR) | `C:\tecnia-control` | compila (2 s) |
| Arduino UNO (AVR) | `C:\Users\Dirección310\Documents\proyecto` | **compila** (2 s) |
| ESP32 (xtensa) | `C:\tecnia-control32` | compila (11 s) |
| ESP32 (xtensa) | `C:\Users\Dirección310\Documents\proyecto32` | **compila** (7 s) |

Se probaron las dos placas a propósito: usan toolchains distintos (`avr-gcc` y
`xtensa-esp32`), y que una anduviera no decía nada de la otra.

**Conclusión: los proyectos se quedan donde están.** No hay que tocar
`installer/abrir-tecnia-bot.cmd`, ni inventar una ruta especial para las máquinas
con nombre acentuado. Un cambio de ese tamaño, hecho sobre una hipótesis, habría
movido la carpeta de trabajo de todos los docentes para resolver un problema que
no existe.

### El control importa tanto como la prueba

El primer intento de esta medición dio **FALLA en los dos casos**, y por un rato
pareció confirmar la hipótesis. No la confirmaba: el sketch de prueba era un
`.cpp` sin `#include <Arduino.h>`, y PlatformIO —a diferencia de un `.ino`— no lo
agrega solo. Fallaba por una razón que no tenía nada que ver con la ruta.

Lo atrapó la regla de tener un control: **si el caso ASCII también falla, la
medición no responde nada.** Sin ese control, el resultado se habría leído como
"las rutas con tilde rompen el compilado" y habríamos escrito código para
arreglar un problema inventado.

## Lo que sigue sin medir

- **Cargar a la placa** (`pio run -t upload`) desde una ruta acentuada. No se
  probó: la VM no tiene una placa conectada. El upload usa otras herramientas
  (`avrdude`, `esptool`) que reciben rutas por línea de comandos.
- **Rutas con espacios Y tilde a la vez** (`C:\Users\María José\...`). El caso de
  la escuela no tenía espacios.
- Rutas de red o perfiles redirigidos por GPO, que además cambian la letra de
  unidad.
