<div align="center">

# Tecnia Bot 🤖⚡

**Asistente educativo de IA para enseñar Arduino y ESP32 en escuelas técnicas argentinas (programa INET).**

Habla en español, explica el *porqué* antes del código, comenta cada línea y traduce los errores técnicos a un lenguaje que se entiende. Pensado para **docentes y estudiantes con poca o nula experiencia** — offline y de un doble clic (con un único paso extra la primera vez: conectar una API key gratis de Google, ver [Instalación](#-instalación)).

[![Versión](https://img.shields.io/github/v/release/programadores-obreros/Agente-editor-inet?label=versi%C3%B3n&color=6d28d9)](https://github.com/programadores-obreros/Agente-editor-inet/releases/latest)
[![CI](https://github.com/programadores-obreros/Agente-editor-inet/actions/workflows/ci.yml/badge.svg)](https://github.com/programadores-obreros/Agente-editor-inet/actions/workflows/ci.yml)
[![Instalador .exe](https://github.com/programadores-obreros/Agente-editor-inet/actions/workflows/build-installer.yml/badge.svg)](https://github.com/programadores-obreros/Agente-editor-inet/actions/workflows/build-installer.yml)
![Plataformas](https://img.shields.io/badge/plataformas-Windows%20%C2%B7%20Linux%20%C2%B7%20macOS-0b7285)
[![Licencia](https://img.shields.io/badge/licencia-GPLv3%20%2B%20CC%20BY--SA%204.0-blue)](#-licencia)

</div>

---

## ✨ ¿Qué hace?

- 🗣️ **Habla en español simple** — nada de jerga innecesaria, nunca asume que ya sabés.
- 🧑‍🏫 **Se adapta a vos** — pregunta si sos docente o alumno, y **te habla en tu género** (varón, mujer o no binario) con la concordancia correcta.
- 🎯 **Te guía un proyecto paso a paso** — materiales → concepto → cableado → código → seguridad → probar, un paso a la vez, y **recuerda en qué paso quedaste** para retomar la próxima sesión.
- 🔌 **Compila y carga a la placa** con PlatformIO, desde el mismo chat.
- 🧰 **Dibuja circuitos visuales** con piezas reales (interactivos, funcionan sin internet) y un explicador de la protoboard.
- 🖨️ **Arma hojas para el aula** — materiales + conexiones + código comentado, listas para imprimir (Ctrl+P → PDF).
- ⚡ **Chequeo de seguridad antes de prender** — repasa lo crítico (los 3.3 V del ESP32, polaridad, cortos) para no quemar la placa.
- 📟 **Abre el monitor serial en una ventana** — ver los datos de la placa y mandarle teclas, sin escribir comandos. [Guía](docs/monitor-serial.md)
- 🇦🇷 **Traduce los errores** de compilación del inglés al español, con la solución paso a paso.
- ❓ **Manual de ayuda** — `/ayuda` abre un micro-sitio de onboarding (offline) con ejemplos y el catálogo de los 15 proyectos.

### 🔒 Privacidad de menores (Ley 25.326)

En las PCs de escuela una cuenta la comparten muchos chicos. Por eso Tecnia Bot distingue **tres modos**:

| Modo | Quién usa la compu | ¿Guarda el nombre? |
|------|--------------------|--------------------|
| **personal** | una sola persona | sí |
| **grupo** | pocas personas conocidas que rotan | sí, a cada una |
| **aula** | muchos alumnos anónimos | **no** — ni nombre ni género |

El **progreso** (nivel, proyectos hechos) se guarda como *"lo hecho en esta compu"*, no ligado a un alumno identificado.

---

## 🛠️ Tecnologías

Tecnia Bot se apoya en herramientas abiertas y estándar. Nada es a medida cuando ya existe algo bueno.

| Tecnología | Para qué |
|------------|----------|
| **[OpenCode](https://opencode.ai)** | La plataforma de agente sobre la que se monta la capa educativa (MIT). |
| **Google Gemini 2.5 Flash-Lite** (gratis) | El modelo de lenguaje del agente (`google/gemini-2.5-flash-lite`), vía la free tier de [Google AI Studio](https://aistudio.google.com/apikey). |
| **[Bun](https://bun.sh)** | Runtime de OpenCode: las herramientas del agente corren sobre Bun. |
| **TypeScript** | Las 7 herramientas del agente (`platformio`, `circuito`, `imprimible`, `ayuda`, `actualizar`, `perfil`, `memoria`). |
| **[PlatformIO](https://platformio.org)** | Compila y carga el firmware a la placa real. |
| **Arduino UNO / ESP32** | El hardware objetivo del programa INET. |
| **[Wokwi Elements](https://github.com/wokwi/wokwi-elements)** (MIT) | Las piezas realistas de los circuitos visuales. |
| **HTML · CSS · JS puro** | El micro-sitio de ayuda y los circuitos — **offline, sin framework ni CDN** (funciona con `file://`). |
| **[Inno Setup](https://jrsoftware.org/isinfo.php)** | El instalador `.exe` de Windows (un doble clic, sin admin). |
| **[Scoop](https://scoop.sh)** | Gestor de paquetes que usa el bootstrap en Windows para instalar todo sin permisos de administrador. |
| **Node.js** (`node --test`) | Los smoke tests corren con Node puro, sin dependencias. |
| **GitHub Actions** | CI (tests en cada push) + build del `.exe` en cada tag. |

---

## 🚀 Instalación

> 🪟 **¿Usás Windows y no sos desarrollador?** Descargá **[`Instalar-Tecnia-Bot.exe`](https://github.com/programadores-obreros/Agente-editor-inet/releases/latest)** de la última versión → doble clic → Siguiente → Siguiente → Finalizar. Instala TODO solo (OpenCode + PlatformIO + Tecnia Bot), **sin permisos de administrador**. Guía con capturas: [instalación en Windows](docs/instalacion-windows.md).

### ⭐ Instalación fácil (recomendada)

Un solo comando instala **todo**: OpenCode + PlatformIO + Tecnia Bot. El bootstrap detecta lo que ya tengas y solo instala lo que falte.

```bash
# Linux / macOS
bash install/bootstrap.sh
```
```powershell
# Windows (clic derecho → "Ejecutar con PowerShell", o en una terminal)
powershell -ExecutionPolicy Bypass -File install\bootstrap.ps1
```

> 🔑 **Paso único post-instalación:** Tecnia Bot necesita una API key gratis de Google (sin tarjeta) para su modelo de lenguaje. Sacala en [aistudio.google.com/apikey](https://aistudio.google.com/apikey), abrí OpenCode, escribí `/connect`, elegí Google/Gemini y pegala ahí — se guarda para siempre, no hace falta repetirlo.

> 📖 Guías paso a paso (drivers USB + permisos del puerto serial + conectar la API key): [Windows](docs/instalacion-windows.md) · [Linux](docs/instalacion-linux.md)

### 🔧 Instalación manual (avanzada)

Si ya tenés **OpenCode** y **PlatformIO Core**, copiá solo la capa de Tecnia Bot:

```bash
bash install/install.sh                                        # Linux / macOS
powershell -ExecutionPolicy Bypass -File install\install.ps1   # Windows
```

La capa se copia a la config global de OpenCode (`~/.config/opencode/`), así que queda disponible en **cualquier carpeta** donde abras OpenCode.

---

## 💻 Usar Tecnia Bot

1. Abrí una terminal en cualquier carpeta.
2. Escribí `opencode`.
3. **Ya arranca en Tecnia Bot** (no hace falta apretar Tab) — vas a ver su logo violeta.
4. Escribí `hola` y dejate guiar.

Probá:

- *"¿cómo prendo un LED con Arduino?"* — te explica el concepto y te da el código comentado.
- *"quiero armar el semáforo paso a paso"* — te guía el proyecto completo y recuerda dónde quedaste.
- *"armame el circuito de riego con higrómetro, relé y bomba"* — te dibuja un circuito visual interactivo.
- *"abrí el monitor serial"* — ventana para ver los datos de la placa y comandarla con el teclado.
- `/ayuda` — resumen de uso + manual/onboarding en el navegador.
- `/diagnostico` — verifica tu entorno (OpenCode, PlatformIO, la placa).
- `/actualizar` — trae la última versión desde GitHub.

---

## 🧩 ¿Cómo funciona?

Tecnia Bot es una **capa educativa** que se instala **encima de [OpenCode](https://opencode.ai)** — no lo reemplaza ni lo modifica. Agrega:

- **1 agente** (`tecnia-bot`) — el prompt pedagógico, en español.
- **7 herramientas** — `platformio` (compilar/cargar), `circuito` (visuales), `imprimible` (hojas de aula), `ayuda` (manual), `actualizar` (auto-update de la capa), `perfil` (modo aula/grupo/personal + género) y `memoria` (progreso de la compu).
- **14 bases de conocimiento** (skills) — ver abajo.
- **3 comandos** — `/diagnostico`, `/actualizar`, `/ayuda`.
- **Identidad de marca** — un plugin liviano que pone el logo de Tecnia Bot en el splash + un tema violeta.

### Los 15 proyectos INET

El skill `proyectos-inet` tiene los **15 proyectos refactorizados** (Saberes Digitales / INET-EDUCAR): cada uno con sus niveles, pinout exacto UNO/ESP32, cableado, código clave y *gotchas* verificados. Así el bot guía cualquiera de los 15 sin depender de internet.

**Los 14 skills:** `arduino` · `esp32` · `sensores` · `actuadores` · `modulos-avanzados` · `errores-comunes` · `gotchas-hardware` · `checklist-seguridad` · `diagramas-conexion` · `circuitos-visuales` · `comunicacion-serial` · `librerias` · `proyectos-inet` · `proyecto-guiado`

---

## 📁 Estructura del repo

```
├── opencode/               # La capa educativa (esto es lo que se instala)
│   ├── agent/              # El agente: tecnia-bot.md
│   ├── tool/               # 7 herramientas .ts (platformio, circuito, imprimible, ayuda, actualizar, perfil, memoria)
│   ├── skills/             # 14 bases de conocimiento
│   ├── command/            # Comandos: /diagnostico, /actualizar, /ayuda
│   ├── plugins/            # tecnia-logo.tsx: marca en el splash + aviso de versión nueva
│   ├── themes/             # tecnia-violet.json: tema violeta de marca
│   └── tecniabot-web/      # Biblioteca visual (piezas Wokwi), pinouts.json y el micro-sitio de /ayuda (sitio/)
├── install/                # bootstrap.{sh,ps1} (todo-en-uno) e install.{sh,ps1} (solo la capa)
├── installer/              # tecnia-bot.iss (Inno Setup) + branding del .exe
├── tests/                  # Smoke tests (Node puro, sin dependencias)
├── docs/                   # Guías de instalación + capturas
├── ejemplos/               # Sketches de ejemplo (blink, servo-teclado — UNO y ESP32)
└── .github/workflows/      # CI (tests) + build del .exe
```

---

## 🧪 Desarrollo

Los tests corren con **Node puro** (sin instalar dependencias) y también en cada push vía GitHub Actions:

```bash
npm test        # o: node --test tests/*.test.mjs
```

Para agregar un componente al armador de circuitos o un skill nuevo: `opencode/tool/circuito.ts` (registro `COMPONENTES`) y `opencode/skills/`.

---

## 📌 Estado

🚀 **v0.3.32.** Funciona de punta a punta en **Windows y Linux**, validado end-to-end en Windows 10 real. Compila y carga a hardware, dibuja circuitos, guía proyectos paso a paso con memoria, arma hojas para imprimir, y trae un onboarding offline (`/ayuda`). Con instalador `.exe` de un doble clic, auto-actualización, smoke tests y CI en verde.

**Pendiente:**
- Firmar el `.exe` (hoy sin firma → Windows muestra un aviso de SmartScreen que se saltea con *"Ejecutar de todas formas"*).
- Prueba en aula real.

---

## 📄 Licencia

Tecnia Bot usa **licencia doble**, según el tipo de archivo:

- **Código** (`opencode/tool/*.ts`, `install/*.{sh,ps1}`) → **GPLv3** ([`LICENSE`](LICENSE)).
- **Contenido educativo** (skills, agente, comandos, docs `.md`) → **CC BY-SA 4.0** ([`LICENSE-CONTENT`](LICENSE-CONTENT)).

Ambas son *copyleft*: si modificás y redistribuís, compartí tus cambios bajo la misma licencia — para que las mejoras vuelvan a la comunidad educativa.

> Tecnia Bot se instala **junto a** OpenCode (MIT), no lo incluye ni lo modifica; por eso las licencias no se pisan.

**Terceros:** la biblioteca visual incluye [Wokwi Elements](https://github.com/wokwi/wokwi-elements) (MIT), redistribuida en `opencode/tecniabot-web/` con su licencia original (`LICENSE-wokwi-elements`).

---

<div align="center">

**[Tecnia Lab](https://tecnialab.net.ar/tecnia-bot)** · Material educativo para escuelas técnicas argentinas · Programa INET

</div>
