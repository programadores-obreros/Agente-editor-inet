# Tecnia Bot 🤖⚡

Asistente educativo de IA para enseñar **Arduino y ESP32** en escuelas técnicas argentinas (programa INET).

Pensado para **docentes y estudiantes con poca o nula experiencia** en programación embebida. Habla en español, explica el porqué antes del código, comenta cada línea y traduce los errores técnicos a un lenguaje que se entiende.

---

## ¿Qué hace?

- 🗣️ **Habla en español simple** — nada de jerga innecesaria, nunca asume que ya sabés
- 🧑‍🏫 **Se adapta a vos** — pregunta si sos docente o alumno y ajusta cómo te explica
- 💡 **Explica el porqué** antes de tirar código, y el código viene comentado línea por línea
- 🔌 **Compila y carga a la placa** con PlatformIO, desde el mismo chat
- 🇦🇷 **Traduce los errores** de compilación del inglés a español, con la solución paso a paso

---

## ¿Cómo funciona?

Tecnia Bot es una **capa educativa** que se instala encima de [OpenCode](https://opencode.ai). No reemplaza nada: agrega un agente (`tecnia-bot`), una herramienta de compilación (`platformio`), tres bases de conocimiento (Arduino, ESP32, errores comunes) y un comando de diagnóstico.

Se copia a la config global de OpenCode (`~/.config/opencode/`), así que queda disponible en **cualquier carpeta** donde abras OpenCode.

---

## Instalación

### ⭐ Instalación fácil (recomendada)

Un solo comando instala **todo**: OpenCode + PlatformIO + Tecnia Bot. No necesitás instalar nada antes, y en Windows **no hace falta permiso de administrador** (ideal para las PCs de la escuela).

**Linux / macOS:**
```bash
bash install/bootstrap.sh
```

**Windows** (clic derecho → "Ejecutar con PowerShell", o en una terminal):
```powershell
powershell -ExecutionPolicy Bypass -File install\bootstrap.ps1
```

El bootstrap detecta lo que ya tengas instalado y solo instala lo que falte.

### 🔧 Instalación manual (avanzada)

Si ya tenés **OpenCode** (https://opencode.ai) y **PlatformIO Core** instalados, podés copiar solo la capa de Tecnia Bot:

```bash
bash install/install.sh         # Linux / macOS
```
```powershell
powershell -ExecutionPolicy Bypass -File install\install.ps1   # Windows
```

---

## Usar Tecnia Bot

1. Abrí una terminal en cualquier carpeta
2. Escribí `opencode`
3. Apretá **`Tab`** y elegí **`tecnia-bot`**
4. Escribí "hola" y dejate guiar

Probá: *"¿cómo prendo un LED con Arduino?"* o *`/diagnostico`* para verificar tu entorno.

---

## Estructura del repo

```
tecnia-bot/
├── opencode/          # La capa educativa (esto se instala)
│   ├── agent/         # El agente Tecnia Bot
│   ├── tool/          # Herramienta de compilación PlatformIO
│   ├── skills/        # Bases de conocimiento: arduino, esp32, errores-comunes
│   └── command/       # Comando /diagnostico
├── ejemplos/          # Sketches de ejemplo (blink-uno)
├── docs/              # Guías de instalación (Windows / Linux)
└── install/           # Instaladores (install.sh / install.ps1)
```

---

## Estado

🚧 **MVP — Fase 1.** Validado en Linux. Pendiente: prueba en aula real y empaquetado para Windows.

## Licencia

Tecnia Bot usa **licencia doble**, según el tipo de archivo:

- **Código** (`opencode/tool/*.ts`, `install/*.sh`, `install/*.ps1`) → **GPLv3** (ver [`LICENSE`](LICENSE))
- **Contenido educativo** (skills, agente, comandos y docs en `.md`) → **CC BY-SA 4.0** (ver [`LICENSE-CONTENT`](LICENSE-CONTENT))

Ambas son licencias *copyleft*: si modificás y redistribuís Tecnia Bot, tenés que compartir tus cambios bajo la misma licencia. La idea es que las mejoras vuelvan a la comunidad educativa.

> Tecnia Bot se instala **junto a** OpenCode (que es MIT), no lo incluye ni lo modifica. Por eso las licencias no se pisan. GPLv3 es compatible con MIT, así que a futuro se puede integrar código de OpenCode si hace falta.
