---
description: Verificar que el entorno de desarrollo (PlatformIO, dispositivos seriales, sistema operativo) esté listo para usar
---

Primero, leé el archivo `~/.config/opencode/tecnia-bot.manifest` (con la herramienta de lectura) y buscá la línea `version=` para saber qué versión de Tecnia Bot está instalada. Mostrala al principio del reporte (ej: "Tecnia Bot v0.1.0"). Si el archivo no existe, decí que no pudiste determinar la versión.

Después, usa el tool `platformio` con `action: "diagnostico"` para verificar el estado del entorno de desarrollo.

Presentale el resultado al usuario de forma clara en español. El reporte tiene cuatro secciones:
1. Estado de PlatformIO (si esta instalado y que version)
2. Sistema operativo detectado
3. Dispositivos conectados por USB
4. Estado general con los proximos pasos si algo falta

Si PlatformIO no esta instalado, da el link de instalacion y explica brevemente los pasos para instalar en Windows (que es la plataforma principal).

Si no hay dispositivos conectados, sugeri conectar el Arduino o ESP32 por cable USB y volver a ejecutar `/diagnostico`.

Si todo esta en orden, felicita al usuario y confirmale que puede empezar a programar.
