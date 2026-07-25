# Changelog

Todas las versiones importantes de Tecnia Bot. Formato basado en [Keep a Changelog](https://keepachangelog.com/es/).

## [0.3.5] — 2026-07-25

`pio` en la terminal toma efecto al instante, sin reiniciar.

### Corregido
- **El PATH toma efecto sin reiniciar**: al agregar `pio` al PATH, el instalador ahora avisa a Windows (`WM_SETTINGCHANGE`), así `pio` funciona en terminales nuevas apenas termina la instalación — sin reiniciar ni cerrar sesión. (El bot nunca dependió del PATH: usa la ruta completa. Esto es solo para el uso manual de `pio` en la terminal.) En Linux/Mac ya tomaba efecto al abrir una terminal nueva.

## [0.3.4] — 2026-07-25

Monitor serial en una ventana + `pio` disponible en la terminal.

### Nuevo
- **Abrir el monitor serial desde el chat**: la acción `monitor` ahora ABRE una ventana de terminal aparte con `pio device monitor` ya corriendo (puerto y baudios detectados solos). El docente ve los datos de la placa y puede mandarle teclas (ej: comandar un servo con el teclado), sin escribir comandos ni saber qué es COM3. Parámetro `baud` opcional (default 9600). Windows nativo; Linux/Mac con fallback al comando listo para copiar.
- **`pio` en el PATH**: el instalador ahora agrega PlatformIO al PATH del usuario (sin admin, preservando el tipo de registro para no romper las variables `%VAR%` existentes), así `pio` funciona escrito pelado en cualquier terminal. Llega a todos en el próximo `/actualizar`.

### Corregido
- La descripción del tool le aclara al modelo que el monitor NO necesita un proyecto abierto, para que lo llame directo cuando se lo piden (antes daba vueltas pidiendo crear un proyecto).

## [0.3.3] — 2026-07-19

El splash ahora muestra la versión y da tips propios para docentes.

### Nuevo
- **Versión siempre visible** en el splash, bajo la marca (`un proyecto de Tecnia Lab · tecnialab.net.ar · v0.3.3`). Ayuda al docente y al soporte: la versión se ve de un vistazo, sin comandos.
- **Tips propios en español**: al iniciar, Tecnia Bot muestra un tip pensado para docentes que recién arrancan (cómo pedir un LED, armar un circuito, ver el protoboard, `/diagnostico`, `/actualizar`).

### Corregido
- **Se quita el tip confuso de OpenCode** (`Run /connect to add an AI provider...`). Aparecía SIEMPRE porque el modelo gratis de OpenCode Zen cuenta como "sin proveedor", y le pedía al docente conectar algo que Tecnia Bot ya trae listo. Ahora se desactiva y se reemplaza por los tips propios.

## [0.3.2] — 2026-07-19

Tecnia Bot ahora enlaza a la web en vivo de cada proyecto.

### Nuevo
- **Link a la web en vivo**: cuando el alumno o docente quiere **VER** un proyecto andando o armar el circuito, Tecnia Bot le pasa la URL pública del proyecto (`tecnialab.net.ar/proyectos/<slug>/`), donde está la **animación** y el **simulador interactivo** con los tres niveles. El bot sigue teniendo todo el conocimiento **offline** (pinouts, cableado, código, gotchas); el link es un extra para engancharse con el proyecto y verlo en vivo.

## [0.3.1] — 2026-07-18

`/actualizar` ahora trae versiones nuevas de verdad (sin re-descargar el `.exe`), y el splash avisa cuando hay una.

### Nuevo
- **Aviso al iniciar**: si hay una versión más nueva publicada, el splash lo muestra ("Hay una versión nueva (vX.Y.Z) — escribí /actualizar"). Es un chequeo suave: no bloquea el arranque y falla en silencio si no hay internet.

### Arreglado
- **`/actualizar` no traía nada en la instalación por `.exe`**: dependía de `git pull`, que en esa instalación no existe. Ahora **baja el fuente del último release desde GitHub** y reinstala la capa — sin re-descargar el `.exe` ni reinstalar OpenCode/PlatformIO. El chequeo de versión usa `raw.githubusercontent` (sin depender de que el docente tenga `git`).
- **El agente no podía usar el tool `actualizar`**: su lista de permisos negaba todo por defecto y no lo incluía, así que `/actualizar` "no encontraba" el tool. Agregado a los permisos.

## [0.3.0] — 2026-07-18

Identidad **Tecnia Bot** en el splash de OpenCode, y arranque directo en el agente.

### Nuevo
- **Marca en el splash de OpenCode**: al abrir, ya no aparece el logo genérico de OpenCode sino la identidad de Tecnia Bot — un robot y el wordmark **TECNIA BOT** en violeta, con la firma "un proyecto de Tecnia Lab · tecnialab.net.ar". Es un plugin de TUI liviano: no toca el binario de OpenCode ni su auto-actualización.
- **Tema violeta** de marca (`tecnia-violet`), aplicado a toda la interfaz.
- **Arranca en Tecnia Bot**: el asistente abre con el agente `tecnia-bot` ya seleccionado, sin tener que apretar Tab y elegirlo.

### Detalles
- El instalador publica el plugin y el tema y configura el agente por defecto **mergeando** con la config que ya tenga el docente (no pisa el proveedor/modelo conectado con `/connect`). Detecta `.json` o `.jsonc` y es idempotente: reinstalar o `/actualizar` no duplica nada.
- Validado de punta a punta en Windows 10 con OpenCode 1.18.3.

## [0.2.3] — 2026-07-18

Arreglo crítico: el instalador ahora funciona **aunque se ejecute como administrador**.

### Arreglado
- **Fallaba al ejecutar "como administrador"** (marcaba "error opencode" en rojo): Scoop se niega a correr como admin por defecto, así que OpenCode no llegaba a instalarse. Ahora el bootstrap **detecta la ejecución elevada** y le pasa `-RunAsAdmin` a Scoop (+ habilita instalar apps como admin), para que instale igual. Detectado por un docente en la primera prueba real. *(Igual, lo recomendado sigue siendo NO ejecutarlo como administrador — no hace falta.)*

## [0.2.2] — 2026-07-17

Presencia institucional **Tecnia Lab** en el instalador, con identidad visual violeta.

### Nuevo
- **Marca Tecnia Lab**: el banner del asistente lleva el logo oficial ("un proyecto de Tecnia Lab") y el isotipo aparece en las pantallas.
- **Tema violeta** (`#6d28d9`) que resalta el dorado de la marca (colores complementarios): banner, ícono del robot y **header de TODAS las páginas del asistente** (no solo Bienvenida/Final).
- **Firma institucional** al pie de cada pantalla: `Tecnia Lab • tecnialab.net.ar/tecnia-bot`.
- **Web oficial**: al terminar se ofrece **abrir [tecnialab.net.ar/tecnia-bot](https://tecnialab.net.ar/tecnia-bot/)** (primeros pasos). También figura como sitio del programa en "Agregar o quitar programas" y en el lanzador.

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

[0.3.2]: https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.3.2
[0.3.1]: https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.3.1
[0.3.0]: https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.3.0
[0.2.3]: https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.2.3
[0.2.2]: https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.2.2
[0.2.1]: https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.2.1
[0.2.0]: https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.2.0
[0.1.0]: https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.1.0
