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

**Si PlatformIO no está instalado, PASÁ EL TEXTO DEL TOOL Y NO INVENTES OTRA
forma de instalarlo.** Esta línea antes decía «explicá brevemente los pasos para
instalar en Windows», sin decir cuáles. Eso no es una instrucción: es una
invitación a improvisar.

Y se improvisó. En una capacitación, de decenas de máquinas una se quedó sin
PlatformIO. La docente corrió `/diagnostico` y el bot le contestó que instalara
**Visual Studio Code** y la extensión PlatformIO IDE. Cientos de megas de otro
producto, para seguir sin poder compilar.

No fue una alucinación: la documentación oficial ofrece cinco métodos y el más
difundido en internet es el de VS Code. Se le pidió que eligiera, y eligió.

Acá hay **una sola** forma, y ya está instalada en la máquina:

1. **Volver a correr el instalador de Tecnia Bot** (menú inicio). Instala
   PlatformIO Core solo, sin preguntar nada.
2. Si después de eso sigue faltando, **es la red, no la máquina**: menú inicio →
   «Diagnostico de Tecnia Bot», que deja un `.txt` diciendo si esa máquina llega
   a `pypi.org`. En una escuela con filtro de contenido, ese dominio es de los
   primeros que se bloquean, y no avisa que bloqueó: da timeout.

Nunca menciones VS Code, `pip install`, Homebrew, ni la documentación de
platformio.org. Ninguna de esas arregla Tecnia Bot.

**Y decile lo que SÍ puede hacer mientras tanto**, que es casi todo: explicar,
dibujar circuitos y repartir fichas. Sin PlatformIO lo único que se pierde es
compilar y cargar a la placa. Un docente al que sólo le decís lo que le falta
cree que no tiene nada.

**Sobre los puertos: leé lo que dice el tool, no cuentes líneas.** El reporte distingue una PLACA de un puerto serie que trae la propia máquina —un COM1 de una máquina virtual, por ejemplo, que no sirve para nada—. Si el tool dice que no hay placas, no digas que hay dispositivos conectados sólo porque aparece un puerto en la lista.

**Si hay una placa enchufada pero sin driver**, el tool lo detecta y da el link. Es el caso más común del primer día con un clon barato: el chip CH340 no trae driver en Windows, así que no aparece ningún puerto COM y parece que la placa no estuviera. Pasale el link tal cual y explicale los cuatro pasos: bajarlo, instalarlo, desenchufar la placa, volver a enchufarla.

Si no hay ninguna placa ni ningún dispositivo con problema, sugerí conectar el Arduino o el ESP32 por cable USB y volver a ejecutar `/diagnostico`. Y acordate de un clásico que arruina tardes enteras: hay cables USB que sólo llevan corriente y no datos — con ésos la placa se enciende, parece que anda, y nunca aparece.

Si todo esta en orden, felicita al usuario y confirmale que puede empezar a programar.
