# _test-librerias (proyecto interno de verificacion) 🧪

> ⚠️ **Esto NO es un ejemplo didactico.** Es una herramienta interna del repo.
> El guion bajo (`_`) en el nombre de la carpeta lo marca como tal.

## Para que sirve

PlatformIO **no incluye solo** la mayoria de las librerias (si falta el `lib_deps`,
tiras un `#include <Servo.h>` y te salta `Servo.h: No such file`). Este proyecto
junta en un solo lugar **todos** los `lib_deps` que usa el ecosistema Tecnia Bot y
un `src/main.cpp` que hace `#include` de cada header y crea cada objeto una vez.

Asi, con un solo `pio run`, el coordinador verifica que **todos los paquetes
resuelven y compilan** — en Arduino UNO (AVR) y en ESP32.

## Como verificar

```bash
cd ejemplos/_test-librerias
pio run                 # compila los DOS environments (uno + esp32dev)
pio run -e uno          # solo Arduino UNO (AVR)
pio run -e esp32dev     # solo ESP32
```

Si termina en `SUCCESS` para ambos environments, todos los `lib_deps` estan bien.

## Que NO es

- No corre en hardware: el codigo es **compile-only** (los pines son arbitrarios).
- No es un ejemplo para docentes: para eso mira las otras carpetas de `ejemplos/`.
- No enseña a usar cada componente: para eso esta la referencia humana en
  [`docs/librerias.md`](../../docs/librerias.md).

## Que verifica exactamente

Los headers y `lib_deps` estan documentados en `platformio.ini` y `src/main.cpp`.
La tabla completa (componente → header → `lib_deps` → placas → nota) vive en
[`docs/librerias.md`](../../docs/librerias.md).
