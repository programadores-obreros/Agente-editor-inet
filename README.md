# Profe Bot 🤖⚡

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

Profe Bot es una **capa educativa** que se instala encima de [OpenCode](https://opencode.ai). No reemplaza nada: agrega un agente (`profe-bot`), una herramienta de compilación (`platformio`), tres bases de conocimiento (Arduino, ESP32, errores comunes) y un comando de diagnóstico.

Se copia a la config global de OpenCode (`~/.config/opencode/`), así que queda disponible en **cualquier carpeta** donde abras OpenCode.

---

## Instalación

### Requisitos previos
1. **OpenCode** — https://opencode.ai
2. **PlatformIO Core** — para compilar y cargar código a la placa (ver `docs/`)

### Instalar Profe Bot

**Linux / macOS:**
```bash
./install/install.sh
```

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File install\install.ps1
```

El instalador copia los archivos y te avisa si falta OpenCode o PlatformIO.

---

## Usar Profe Bot

1. Abrí una terminal en cualquier carpeta
2. Escribí `opencode`
3. Apretá **`Tab`** y elegí **`profe-bot`**
4. Escribí "hola" y dejate guiar

Probá: *"¿cómo prendo un LED con Arduino?"* o *`/diagnostico`* para verificar tu entorno.

---

## Estructura del repo

```
profe-bot/
├── opencode/          # La capa educativa (esto se instala)
│   ├── agent/         # El agente Profe Bot
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

Por definir.
