# Tecnia Bot 🤖⚡

Asistente educativo de IA para enseñar **Arduino y ESP32** en escuelas técnicas argentinas (programa INET).

Pensado para **docentes y estudiantes con poca o nula experiencia** en programación embebida. Habla en español, explica el porqué antes del código, comenta cada línea y traduce los errores técnicos a un lenguaje que se entiende.

---

## ¿Qué hace?

- 🗣️ **Habla en español simple** — nada de jerga innecesaria, nunca asume que ya sabés
- 🧑‍🏫 **Se adapta a vos** — pregunta si sos docente o alumno y ajusta cómo te explica
- 💡 **Explica el porqué** antes de tirar código, y el código viene comentado línea por línea
- 🔌 **Compila y carga a la placa** con PlatformIO, desde el mismo chat
- 🧰 **Dibuja circuitos visuales** (piezas reales, interactivos, funcionan sin internet) y un explicador de la protoboard
- 🇦🇷 **Traduce los errores** de compilación del inglés a español, con la solución paso a paso

---

## ¿Cómo funciona?

Tecnia Bot es una **capa educativa** que se instala encima de [OpenCode](https://opencode.ai). No reemplaza nada: agrega un agente (`tecnia-bot`), dos herramientas (compilar/cargar con `platformio` y armar `circuito`s visuales), nueve bases de conocimiento y un comando de diagnóstico.

Se copia a la config global de OpenCode (`~/.config/opencode/`), así que queda disponible en **cualquier carpeta** donde abras OpenCode.

---

## Instalación

### Paso 1 — Descargá el proyecto

Si tenés **git**:
```bash
git clone https://github.com/programadores-obreros/Agente-editor-inet.git
cd Agente-editor-inet
```

Si no tenés git: entrá a [la página del proyecto](https://github.com/programadores-obreros/Agente-editor-inet), tocá el botón verde **`Code` → `Download ZIP`**, descomprimí, y abrí una terminal dentro de esa carpeta.

### Paso 2 — Instalá

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

> 📖 Guías detalladas paso a paso (incluye drivers USB y permisos del puerto serial):
> [Windows](docs/instalacion-windows.md) · [Linux](docs/instalacion-linux.md)

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

Probá:
- *"¿cómo prendo un LED con Arduino?"* — te explica el concepto y te da el código comentado
- *"armame el circuito de riego con higrómetro, relé y bomba"* — te dibuja un circuito visual interactivo
- *"mostrame cómo funciona el protoboard"* — te abre el explicador interactivo de la placa
- *`/diagnostico`* — verifica que tu entorno esté listo (OpenCode, PlatformIO, la placa)

---

## Estructura del repo

```
Agente-editor-inet/
├── opencode/               # La capa educativa (esto es lo que se instala)
│   ├── agent/              # El agente: tecnia-bot.md
│   ├── tool/               # Herramientas: platformio.ts (compilar/cargar) y circuito.ts (circuitos visuales)
│   ├── skills/             # 9 bases de conocimiento (ver abajo)
│   ├── command/            # Comando /diagnostico
│   ├── tecniabot-web/      # Biblioteca visual: piezas Wokwi + componentes propios (para los circuitos)
│   └── env.d.ts            # Tipos de ambiente (runtime Bun de OpenCode)
├── install/                # Instaladores: bootstrap.{sh,ps1} (todo-en-uno) e install.{sh,ps1} (solo la capa)
├── tests/                  # Smoke tests (corren con Node puro, sin instalar nada)
├── docs/                   # Guías de instalación + capturas del producto
├── ejemplos/               # Sketches de ejemplo (blink-uno, blink-esp32)
├── tecnia-bot.md           # Brief pedagógico (la visión del proyecto)
├── brief-web.md            # Brief para maquetar la web oficial
├── package.json            # Versión, scripts de test/typecheck
└── .github/workflows/      # CI: corre los tests en cada push
```

**Los 9 skills** (bases de conocimiento del agente): `arduino`, `esp32`, `sensores`, `actuadores`,
`modulos-avanzados`, `errores-comunes`, `gotchas-hardware`, `diagramas-conexion`, `circuitos-visuales`.

---

## Estado

🚧 **MVP (v0.1.0).** Funciona de punta a punta en **Linux** (compila y carga a hardware real, arma circuitos visuales, instalador de un comando). Con smoke tests y CI.

**Pendiente:**
- Probar el instalador en una PC **Windows** real (escrito, no verificado aún)
- Versionado + comando de actualización + desinstalador
- Prueba en aula real

## Desarrollo

Los tests corren con **Node puro** (no hace falta instalar dependencias):

```bash
npm test          # o: node --test tests/*.test.mjs
```

Se ejecutan también en cada push vía GitHub Actions. Para agregar un componente al armador
o un skill nuevo, ver `opencode/tool/circuito.ts` (registro `COMPONENTES`) y `opencode/skills/`.

## Licencia

Tecnia Bot usa **licencia doble**, según el tipo de archivo:

- **Código** (`opencode/tool/*.ts`, `install/*.sh`, `install/*.ps1`) → **GPLv3** (ver [`LICENSE`](LICENSE))
- **Contenido educativo** (skills, agente, comandos y docs en `.md`) → **CC BY-SA 4.0** (ver [`LICENSE-CONTENT`](LICENSE-CONTENT))

Ambas son licencias *copyleft*: si modificás y redistribuís Tecnia Bot, tenés que compartir tus cambios bajo la misma licencia. La idea es que las mejoras vuelvan a la comunidad educativa.

> Tecnia Bot se instala **junto a** OpenCode (que es MIT), no lo incluye ni lo modifica. Por eso las licencias no se pisan. GPLv3 es compatible con MIT, así que a futuro se puede integrar código de OpenCode si hace falta.

**Piezas de terceros:** la biblioteca visual incluye [Wokwi Elements](https://github.com/wokwi/wokwi-elements) (licencia MIT), redistribuida en `opencode/tecniabot-web/` con su licencia original (`LICENSE-wokwi-elements`).
