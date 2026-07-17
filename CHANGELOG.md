# Changelog

Todas las versiones importantes de Tecnia Bot. Formato basado en [Keep a Changelog](https://keepachangelog.com/es/).

## [0.2.1] — 2026-07-17

Instalador `.exe` para Windows con identidad de marca, y correcciones al bootstrap encontradas **probando en una Windows 10 real**.

### Nuevo
- **Instalador `.exe` para Windows** (Siguiente-Siguiente-Finalizar): se descarga un archivo, doble clic, y listo — sin git, sin PowerShell, sin permisos de administrador. Crea accesos directos en el menú inicio y el escritorio. Pensado para docentes que no son desarrolladores.
- **Marca en el instalador**: ícono propio (robot), banner del asistente y textos de bienvenida, con el color institucional `#3498DB`.
- **CI que compila el `.exe`** en Windows (Inno Setup) y lo adjunta a cada release, con un smoke test que verifica la instalación.

### Arreglado
- **El bootstrap abortaba antes de instalar Scoop**: `Set-ExecutionPolicy` fallaba cuando el instalador lo lanzaba con `-ExecutionPolicy Bypass` (el ámbito de Proceso invalidaba el cambio). Ahora se tolera el override.
- **PlatformIO no se instalaba** por el *stub* de `python` de la Microsoft Store: ahora Python se instala con Scoop y se lo invoca por ruta, evitando el stub.

> Ambos bugs se detectaron validando el instalador end-to-end en una VM Windows 10 — el instalador ahora deja OpenCode + PlatformIO + la capa educativa funcionando de un solo doble clic.

## [0.2.0] — 2026-07-14

### Nuevo
- **Skill `proyectos-inet`**: el conocimiento completo de los 15 proyectos INET (pinouts exactos por plataforma, cableado, código clave y gotchas verificados), destilado del sitio de proyectos como fuente de verdad.

## [0.1.0] — 2026-07-08

Primera versión pública (MVP). Funciona de punta a punta en Linux.

### Nuevo
- **Agente educativo** `tecnia-bot`: habla en español, explica el porqué antes del código, comenta cada línea y traduce los errores de compilación.
- **Compilar y cargar a la placa** con PlatformIO desde el chat (Arduino UNO y ESP32), con detección automática del puerto.
- **Armador de circuitos visuales** (tool `circuito`): más de 30 componentes reales, cables de colores, animación e interacción, funciona sin internet. Incluye un **explicador interactivo de la protoboard**.
- **9 bases de conocimiento** (skills): arduino, esp32, sensores, actuadores, módulos avanzados, errores comunes, gotchas de hardware, diagramas de conexión y circuitos visuales.
- **Instalador de un comando** (`bootstrap`) para Linux y Windows: instala OpenCode + PlatformIO + Tecnia Bot. En Windows no necesita permisos de administrador (usa Scoop).
- **Ciclo de vida**: versión, manifest de archivos instalados, comando `/actualizar` dentro del agente, y desinstalador prolijo.
- Comando `/diagnostico` para verificar el entorno (ahora también muestra la versión).
- Smoke tests + CI (GitHub Actions).

[0.2.1]: https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.2.1
[0.2.0]: https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.2.0
[0.1.0]: https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.1.0
