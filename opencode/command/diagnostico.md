---
description: Verificar que el entorno de desarrollo (PlatformIO, dispositivos seriales, sistema operativo) esté listo para usar
---

Primero, usá el tool `actualizar` con `verificar: true`. Eso te dice qué versión de Tecnia Bot tiene el usuario y si hay una más nueva disponible. Mostralo al principio del reporte (ej: "Tecnia Bot v0.1.0 — estás al día", o avisá si hay una versión nueva y que puede escribir `/actualizar`).

Después, usa el tool `platformio` con `action: "diagnostico"` para verificar el estado del entorno de desarrollo.

Presentale el resultado al usuario de forma clara en español. El reporte tiene cuatro secciones:
1. Estado de PlatformIO (si esta instalado y que version)
2. Sistema operativo detectado
3. Dispositivos conectados por USB
4. Estado general con los proximos pasos si algo falta

Si PlatformIO no esta instalado, da el link de instalacion y explica brevemente los pasos para instalar en Windows (que es la plataforma principal).

**Sobre los puertos: leé lo que dice el tool, no cuentes líneas.** El reporte distingue una PLACA de un puerto serie que trae la propia máquina —un COM1 de una máquina virtual, por ejemplo, que no sirve para nada—. Si el tool dice que no hay placas, no digas que hay dispositivos conectados sólo porque aparece un puerto en la lista.

**Si hay una placa enchufada pero sin driver**, el tool lo detecta y da el link. Es el caso más común del primer día con un clon barato: el chip CH340 no trae driver en Windows, así que no aparece ningún puerto COM y parece que la placa no estuviera. Pasale el link tal cual y explicale los cuatro pasos: bajarlo, instalarlo, desenchufar la placa, volver a enchufarla.

Si no hay ninguna placa ni ningún dispositivo con problema, sugerí conectar el Arduino o el ESP32 por cable USB y volver a ejecutar `/diagnostico`. Y acordate de un clásico que arruina tardes enteras: hay cables USB que sólo llevan corriente y no datos — con ésos la placa se enciende, parece que anda, y nunca aparece.

Si todo esta en orden, felicita al usuario y confirmale que puede empezar a programar.
