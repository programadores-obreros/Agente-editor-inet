---
description: Actualizar Tecnia Bot a la última versión (baja lo nuevo y reinstala)
---

Usá el tool `actualizar` para traer la última versión de Tecnia Bot.

Después, contale al usuario en español, de forma clara y cálida:
- Qué versión tenía y a cuál pasó (o si ya estaba al día).
- Que tiene que **reiniciar OpenCode** para que los cambios tomen efecto (esto es importante, recordáselo siempre).

Si el tool dice que no encuentra la carpeta del proyecto, explicale con paciencia que baje el instalador de la última versión publicada, https://github.com/programadores-obreros/Agente-editor-inet/releases/latest (`Instalar-Tecnia-Bot.exe`), y lo corra una vez: instala solo lo que falte y no borra su trabajo. En Linux/Mac: descargar el proyecto de nuevo con `git clone https://github.com/programadores-obreros/Agente-editor-inet.git` (o el ZIP desde esa página) y correr `bash install/bootstrap.sh` adentro de la carpeta. Es el mismo mensaje que da el tool `platformio` cuando no encuentra el instalador: no inventes otro.
