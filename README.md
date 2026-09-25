<div align="center">

# Tecnia Bot 🤖⚡

**Asistente educativo de IA para enseñar Arduino y ESP32 en escuelas técnicas argentinas (programa INET).**

Habla en español, explica el *porqué* antes del código, comenta cada línea y traduce los errores técnicos a un lenguaje que se entiende. Pensado para **docentes y estudiantes con poca o nula experiencia** — se instala de un doble clic; los circuitos, fichas y hojas que genera funcionan sin internet (el chat sí necesita conexión) (con un único paso extra la primera vez: conectar una API key gratis de Google, ver [Instalación](#-instalación)).

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
- 📄 **Trae 17 fichas A4 de Tecnia Lab** — una hoja por componente o concepto (LED, servo, relé, LDR, ultrasónico, PIR, DHT11, téster…). Pedísela y **te la abre en el navegador**, lista para repartir.
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
| **Big Pickle** (gratis, sin cuenta) | El modelo de lenguaje por defecto cuando no hay API key (`opencode/big-pickle`), servido por [OpenCode Zen](https://opencode.ai/zen). Gratis **por tiempo limitado**; mientras dure esa etapa, OpenCode puede usar las conversaciones para mejorar el modelo — ver [Instalación](#-instalación). |
| **Google Gemini 3.5 Flash-Lite** (gratis) | El modelo del agente cuando hay una API key de Google (`google/gemini-3.5-flash-lite`), vía la free tier de [Google AI Studio](https://aistudio.google.com/apikey). Se fija la versión explícita (no un alias `-latest`): un alias cambia solo, sin quedar registrado en ningún commit (ver CHANGELOG 0.3.63). El modelo **no** vive en el frontmatter del agente sino en `opencode.json` → `agent.tecnia-bot.model`, que escribe el instalador: OpenCode mezcla los agentes `.md` **encima** del JSON, así que un `model:` en el `.md` pisaría la elección. Detalle en [docs/api-key-google.md](docs/api-key-google.md). |
| **[Bun](https://bun.sh)** | Runtime de OpenCode: las herramientas del agente corren sobre Bun. |
| **TypeScript** | Las 9 herramientas del agente (`platformio`, `circuito`, `imprimible`, `ficha`, `ayuda`, `actualizar`, `perfil`, `memoria`, `clave`). |
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

> 🔑 **La API key es opcional.** El instalador te la pide una vez y decide el modelo según lo que hagas:
>
> - **Sin API key** (Enter): Tecnia Bot usa **Big Pickle** (`opencode/big-pickle`), el modelo gratuito de OpenCode. No hace falta cuenta ni login. Es gratis **por tiempo limitado**, y ⚠️ mientras dure esa etapa **OpenCode puede usar lo que se escribe en el chat para mejorar el modelo**: no pongas datos personales ni nombres de alumnos en la conversación.
> - **Con API key de Google** (gratis, sin tarjeta, sacala en [aistudio.google.com/apikey](https://aistudio.google.com/apikey)): usa **Gemini 3.5 Flash-Lite**, con cuota propia y sin esa cláusula. Pegala cuando el instalador te la pida; se guarda en tu compu para siempre.
>
> Podés cambiar después: conseguí la key y corré **"Reparar Tecnia Bot"** (menú inicio en Windows) o `bash install/install.sh`; o pegala con `/connect` dentro de OpenCode y corré `/actualizar`. El instalador vuelve a elegir el modelo en cada corrida.

> 📖 Guías paso a paso (drivers USB + permisos del puerto serial + conectar la API key): [Windows](docs/instalacion-windows.md) · [Linux](docs/instalacion-linux.md) · [Chromebook (en prueba)](docs/instalacion-chromebook.md) · [todo sobre la API key de Google — cómo conseguirla y qué hacer si deja de andar](docs/api-key-google.md)

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
- *"dame algo para repartir del LDR"* — te abre la ficha A4 en el navegador, lista para imprimir.
- `/ayuda` — resumen de uso + manual/onboarding en el navegador.
- `/diagnostico` — verifica tu entorno (OpenCode, PlatformIO, la placa).
- `/actualizar` — trae el último release publicado desde GitHub (verifica lo que bajó antes de instalarlo).
- `/clave` — ve, **prueba contra Google** y cambia la API key de esta computadora (o te deja seguir sin key, con Big Pickle). Nunca muestra la key.

---

## 🧩 ¿Cómo funciona?

Tecnia Bot es una **capa educativa** que se instala **encima de [OpenCode](https://opencode.ai)** — no lo reemplaza ni lo modifica. Agrega:

- **1 agente** (`tecnia-bot`) — el prompt pedagógico, en español.
- **9 herramientas** — `platformio` (compilar/cargar), `circuito` (visuales), `imprimible` (hojas de aula), `ficha` (abre las fichas A4 de Tecnia Lab), `ayuda` (manual), `actualizar` (auto-update de la capa), `perfil` (modo aula/grupo/personal + género), `memoria` (progreso de la compu) y `clave` (ver, probar contra Google y cambiar la API key de esta compu).
- **20 bases de conocimiento** (skills) — ver abajo.
- **5 comandos** — `/diagnostico`, `/reparar`, `/actualizar`, `/clave`, `/ayuda`.
- **Identidad de marca** — un plugin liviano que pone el logo de Tecnia Bot en el splash + un tema violeta.

### Los 15 proyectos INET

El skill `proyectos-inet` tiene los **15 proyectos refactorizados** (Saberes Digitales / INET-EDUCAR): cada uno con sus niveles, pinout exacto UNO/ESP32, cableado, código clave y *gotchas* verificados. Así el bot guía cualquiera de los 15 sin depender de internet.

**Los 20 skills:** `placas` · `arduino` · `esp32` · `educabot` · `sensores` · `actuadores` · `modulos-avanzados` · `errores-comunes` · `errores-del-bot` · `gotchas-hardware` · `checklist-seguridad` · `diagramas-conexion` · `circuitos-visuales` · `comunicacion-serial` · `librerias` · `fichas` · `diseno-curricular` · `proyectos-inet` · `proyecto-guiado` · `archify`

---

## 📁 Estructura del repo

```
├── opencode/               # La capa educativa (esto es lo que se instala)
│   ├── agent/              # El agente: tecnia-bot.md
│   ├── tool/               # 9 herramientas .ts (platformio, circuito, imprimible, ficha, ayuda, actualizar, perfil, memoria, clave)
│   ├── skills/             # 20 bases de conocimiento
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

Los tests corren con **Node puro** (sin instalar dependencias) y también en cada push vía GitHub Actions.

**Los cuatro chequeos, y los cuatro tienen que dar verde antes de un commit:**

```bash
pnpm test              # la suite (o: node --test tests/*.test.mjs)
pnpm typecheck         # tsc --noEmit sobre los tools y los plugins
pnpm fichas:check      # las 17 hojas A4 contra MANIFEST.sha256
pnpm seguridad:check   # que ningún proyecto con partes móviles, calor o red
                       # eléctrica se quede sin su bloque de seguridad
```

`seguridad:check` es un guardián, no un linter de estilo: si agregás un proyecto a
`opencode/skills/proyectos-inet/proyectos/` que mencione un servo, un motor, calor o
220 V, **falla el PR** hasta que tenga su bloque `> ⚠️ **SEGURIDAD:**` — o una exención
explícita con su motivo, si el riesgo no es real. Corre también en el CI, junto con la
validación del frontmatter de las skills y la compilación del instalador con ISCC.

> ⚠️ **Los tests NO se pueden correr en paralelo entre sí**: usan rutas temporales con
> nombre fijo y dos corridas simultáneas se pisan, dando rojos falsos. Si delegás trabajo
> a varios agentes a la vez, que editen en paralelo pero que la suite la corra uno solo.

> ⚖️ **El gestor de paquetes del proyecto es `pnpm`.** `npm`, `npx` y `yarn` no
> se usan en ningún repo de Tecnia Lab. Para correr un binario suelto:
> `pnpm dlx <paquete>`, nunca `npx`.

Para agregar un componente al armador de circuitos o un skill nuevo: `opencode/tool/circuito.ts` (registro `COMPONENTES`) y `opencode/skills/`.

¿Vas a publicar una versión? El procedimiento completo, de punta a punta, está en
[`docs/publicar-release.md`](docs/publicar-release.md).

**Antes de "arreglar" algo que parezca raro, mirá [`docs/decisiones.md`](docs/decisiones.md).** Ahí están las decisiones que se tomaron a propósito, con su costo medido y su criterio de revisión —por ejemplo, por qué el instalador pesa 7,4 MB y no 2,6—. Si algo está así porque se decidió, conviene saberlo antes de cambiarlo.

---

## 📌 Estado

🚀 **v0.4.2 — el chequeo de seguridad ahora mira al pibe, no sólo a la placa.** Hasta acá el repaso de *antes de dar corriente* cuidaba el hardware —los 3,3 V del ESP32, la polaridad, los cortos— y **no decía una palabra de los 220 V**. Ahora, **si hay un enchufe en la historia el chequeo se activa**, y lo primero que pregunta no es por la placa: desenchufado, lado de red cableado por un adulto, sin cobre a la vista, y el relé con amperaje suficiente. Esas cuatro **bloquean**. Además **los quince proyectos avisan del riesgo físico**, no sólo del eléctrico: las hélices del dron, la barrera contra su tope, las paletas a 1500 rpm, el gatillo del pulverizador, y el radiador que **quema al tacto** aunque los 220 V estén bien resueltos. **El desinstalador ya ofrece borrar los datos personales** —perfil, memoria y key— para la notebook que se dona o se reasigna (Ley 25.326); antes los conservaba siempre, sin preguntar. Y se cerró una contradicción que confundía: **`analogWrite` en ESP32 sí existe**; la documentación decía que no porque ninguna versión de plataforma estaba fija. Ahora están **fijadas exactas**, así que dos alumnos con el mismo código obtienen **el mismo binario**, instalen el día que instalen. Del resto, todo lo de la 0.4.1: **dibuja tu Sensor Shield** con sus ternas —y te avisa que de las tres filas la de abajo (`S`) es la señal, porque la sigla "SVG" engaña—, el **ultrasónico con shield va al zócalo `URF01`**, y arma el esquema en **Arduino UNO** con su riel de 5 V y sus 220 Ω. Sabe qué placas puede programar y **frena con las que no**: diez soportadas —Arduino UNO (con Sensor Shield o IO Expansion), ESP32, ESP8266, **Educablocks UNO**, **Educabot Bhoot** y **Mis Ladrillos**— más ocho que reconoce y nombra sin improvisarles un `board =`. Pregunta la placa con un menú, y antes lo acorta mirando qué hay enchufado. Encuentra PlatformIO aunque no esté donde siempre y fija la versión de Python. Conoce los kits de **Educabot** con los datos del libro oficial. Funciona de punta a punta en **Windows y Linux**, validado end-to-end en Windows 10 real. Hay una [guía para Chromebook](docs/instalacion-chromebook.md) — nadie la probó todavía, contanos en el [issue #16](https://github.com/programadores-obreros/Agente-editor-inet/issues/16). Sin API key arranca con Big Pickle, el modelo gratuito de OpenCode. Compila y carga a hardware, **dibuja y simula circuitos** (el sensor mueve un slider y el actuador responde al umbral), guía proyectos con memoria, arma hojas para imprimir, trae las 17 fichas A4 de Tecnia Lab y un onboarding offline (`/ayuda`). Con instalador `.exe` de un doble clic, auto-actualización, smoke tests y CI en verde.

**Pendiente:**
- Firmar el `.exe` — hoy sin firma, Windows muestra el aviso de SmartScreen (se saltea con *"Ejecutar de todas formas"*) y, en Windows 11 con **Control Inteligente de Aplicaciones** activado, directamente **bloquea la instalación sin opción de saltear** (confirmado con un caso real del equipo). Aplicación gratuita enviada a [SignPath Foundation](https://signpath.org/) el 2026-08-12, en revisión (proceso estándar: 2-4 semanas). Ver issue [#4](https://github.com/programadores-obreros/Agente-editor-inet/issues/4).
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
