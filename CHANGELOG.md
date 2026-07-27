# Changelog

Todas las versiones importantes de Tecnia Bot. Formato basado en [Keep a Changelog](https://keepachangelog.com/es/).

## [0.3.32] — 2026-07-27

Micro-sitio nivel pro: íconos SVG, acordeón y accesibilidad.

### Mejorado
- **Rediseño UX/UI del micro-sitio de `/ayuda`** siguiendo el patrón "FAQ/Documentation" (con el skill ui-ux-pro-max): los ejemplos usan **íconos SVG** en vez de emoji (consistentes, nítidos, temáticos), "Si algo falla" pasó a ser un **acordeón** (progressive disclosure), y se sumó **accesibilidad**: focus visible para teclado, los ejemplos se copian con Enter/Espacio, `aria-expanded`/`role`/`aria-controls`, cursor-pointer y transiciones. Se **mantuvo la marca violeta y las fonts del sistema** — no se adoptó el dark-slate ni las Google Fonts que sugería el skill, porque romperían la marca y el offline (las fonts van por CDN).

## [0.3.31] — 2026-07-27

El link al sitio oficial abre en otra pestaña.

### Arreglado
- En el micro-sitio de `/ayuda`, el link **"Sitio ↗"** (y los del sitio oficial) ahora abren en una **pestaña nueva** en vez de reemplazar el manual — así no perdés dónde estabas. Los links internos (Inicio, Proyectos) siguen navegando en la misma ventana.

## [0.3.30] — 2026-07-27

Más vida en el micro-sitio: ojos que te siguen, glow y partículas.

### Mejorado
- **Más animación en el sitio de `/ayuda`**: el **robot te sigue con la mirada** (los ojos siguen el mouse), las **tarjetas tienen un glow que persigue el cursor**, y hay **partículas flotando** en el hero. Todo con **CSS/JS puro** (sin frameworks ni build step), offline, y respetando "reducir movimiento". Sin cambiar de stack — un solo bundle.

## [0.3.29] — 2026-07-27

El `/ayuda` ahora abre un micro-sitio: Inicio + catálogo de los 15 proyectos.

### Nuevo
- **Micro-sitio de onboarding** (reemplaza el manual de un solo archivo): `/ayuda` abre un **sitio multi-página** — **Inicio** (con el terminal animado y los ejemplos para copiar) + **Catálogo navegable de los 15 proyectos INET** (con badges UNO/ESP32/KIT) + navegación entre páginas y barra superior. Todo **offline y SIN servidor**: usa paths **relativos**, así funciona abriendo el `file://` directo (no depende de internet ni de un proceso corriendo). Se bundlea con la capa en `tecniabot-web/sitio/`. Probado: el mismo sitio con paths absolutos se rompe en `file://`, con relativos anda — por eso van relativos.

## [0.3.28] — 2026-07-27

Las animaciones del manual se ven aunque tengas "reducir movimiento".

### Arreglado
- **El manual se veía estático** si tu Windows o navegador tenía activado "reducir movimiento" (una opción de accesibilidad): yo apagaba TODA la animación por respetar esa preferencia. Ahora el **tipeo del terminal, el robot flotando y el cursor parpadeando siguen andando siempre** (son movimientos suaves, no invasivos); solo se suaviza la animación de entrada. Por eso no veías nada moverse.

## [0.3.27] — 2026-07-27

El manual ahora tiene una consola que teclea sola.

### Mejorado
- **Terminal animado en el manual de `/ayuda`**: arriba de todo, una consola estilo Tecnia Bot que **teclea sola** los ejemplos de prompts, uno por uno y en loop (con el cursor parpadeando) — para que el docente vea al toque cómo hablarle. On-brand: Tecnia Bot vive en la terminal. Respeta `prefers-reduced-motion`. Sigue siendo offline, un solo archivo.

## [0.3.26] — 2026-07-26

El manual de `/ayuda` ahora tiene logo, animaciones y ejemplos para copiar.

### Mejorado
- **Manual de ayuda mucho más rico**: el `/ayuda` ahora abre un manual con el **logo animado de Tecnia Bot**, marca institucional (Tecnia Lab · Programa INET), **tarjetas de ejemplo que copiás con un click** (para pegar el prompt en el chat), animaciones de entrada en cascada, y diseño pulido en **light y dark**. Sigue siendo **un solo archivo offline** (sin internet, sin Astro, sin subir nada) — funciona en cualquier PC de escuela. La animación de entrada es robusta: si el JS no corre, el contenido igual se ve.

## [0.3.25] — 2026-07-26

Manual de ayuda: `/ayuda` para arrancar sin saber nada.

### Nuevo
- **Comando `/ayuda` + manual (nuevo tool `ayuda`)**: `/ayuda` muestra un **resumen rápido** de cómo usar Tecnia Bot (con ejemplos de prompts que podés copiar) y **abre un manual completo en el navegador** — offline, self-contained, con diseño de marca (light + dark). Pensado para el docente que abre Tecnia Bot y no sabe por dónde empezar: qué le puede pedir, los comandos, y qué hacer si algo falla. El video queda para más adelante; por ahora, link al sitio oficial para quien tiene internet.

## [0.3.24] — 2026-07-26

Piloto de convergencia de pinouts: una sola fuente de verdad (semáforo).

### Nuevo / Arreglado
- **Fuente canónica de pinouts** (`opencode/tecniabot-web/pinouts.json`): arranca el trabajo de "una sola fuente de verdad" para los pines de cada proyecto, derivada del firmware `.ino` real. Piloto con el semáforo (ESP32 16/17/18, UNO 11/12/13).
- **Semáforo convergido**: la protoboard del semáforo ahora usa los pines de la verdad (**GPIO16/17/18**, = el `.ino` y el skill), no los 19/5/4 que tenía y que no coincidían con el código generado. Se re-etiquetó el diagrama (mismo dibujo lindo, pines correctos).
- **Test de convergencia** (`tests/pinouts.test.mjs`): valida que la plantilla del circuito y el skill coincidan con `pinouts.json`. **Si alguien vuelve a divergir, el CI falla** — el drift se caza solo. Al replicar a los 15 proyectos se agregan casos.

## [0.3.23] — 2026-07-26

Bug de aula: el código y el circuito ahora usan los MISMOS pines.

### Arreglado
- **Los pines del código ahora coinciden con el circuito**: en el flujo guiado, el bot mostraba el circuito visual con unos pines (ej: GPIO19/5/4) pero el código con otros (ej: GPIO13/12/14) → el alumno cableaba una cosa y el código apuntaba a otra, y **no prendía**. La regla ahora es explícita en el agente y en el skill `proyecto-guiado`: **el circuito es la fuente de verdad de los pines y el código los sigue exactamente, nunca inventa.** Encontrado validando el proyecto guiado en vivo en la VM.

## [0.3.22] — 2026-07-26

Hojas para el aula: materiales + conexiones + código, listas para imprimir.

### Nuevo
- **Hoja para imprimir (nuevo tool `imprimible`)**: pedile *"los materiales del semáforo para imprimir"* o *"una hoja para el aula"* y el bot arma una hoja limpia con **materiales + tabla de conexiones + código comentado** (y notas de seguridad), la abre en el navegador, y con **Ctrl+P** la guardás como PDF o la imprimís para repartir. Offline y sin instalar nada: **el navegador hace el PDF** (no traemos Typst ni Docker, así el `.exe` sigue siendo de un doble clic). Con smoke tests, incluido el **escape de HTML** del código (no rompe ni inyecta).

## [0.3.21] — 2026-07-26

Proyecto guiado paso a paso, que se retoma donde lo dejaste.

### Nuevo
- **Proyecto guiado (nuevo skill `proyecto-guiado`)**: cuando querés ARMAR un proyecto INET (no solo preguntar algo), el bot te lleva **paso a paso** — materiales → concepto → cableado (con el circuito visual) → código comentado → chequeo de seguridad → probar — **un paso a la vez**, sin abrumar. Y **recuerda en qué paso quedaste**: la memoria suma un campo "En curso", así la próxima sesión el bot ofrece retomar EXACTO donde dejaste ("quedamos armando el semáforo, en el paso de cablear, ¿seguimos?"). Al terminar, pasa a "proyectos hechos" y limpia el "en curso". Integra en un solo flujo la memoria, los 15 proyectos INET, el circuito visual y el checklist de seguridad. Con smoke tests del "en curso" (guardar avance y limpiarlo al terminar).

## [0.3.20] — 2026-07-26

Chequeo de seguridad antes de prender: que no se queme ninguna placa.

### Nuevo
- **Checklist de seguridad (nuevo skill `checklist-seguridad`)**: antes de dar corriente o cargar código, el bot te hace un chequeo **corto y a medida** de tu circuito — los **3.3V del ESP32** (el error que más quema placas), la polaridad del LED, la resistencia en serie, el GND común, cables pelados, señales de 5V entrando a un GPIO, los strapping pins. Es **preventivo** (la otra cara del skill `gotchas-hardware`, que es para cuando algo ya falló). Se activa cuando estás por prender, cargar código, o preguntás "¿puedo conectarlo?".

## [0.3.19] — 2026-07-26

El bot también pregunta el género en los perfiles que ya existían.

### Arreglado
- Si tu perfil se había creado antes de la función de género (v0.3.18), el bot ahora te **pregunta una vez** cómo preferís que te hable, **sin volver a preguntar el nombre**. Antes, como el nombre ya estaba guardado, nunca llegaba a preguntar el género. Aplica a los modos `personal` y `grupo`.

## [0.3.18] — 2026-07-26

Modo grupo (varias personas que rotan) + el bot te habla en tu género.

### Nuevo
- **Modo grupo (tercer modo)**: para una compu que usan **pocas personas conocidas** que rotan (una familia, un docente + ayudantes). Al arrancar, el bot pregunta *"¿quién sos?"* y **recuerda a cada persona** (nombre, rol, género, placa) en su propio renglón. Distinto del `aula` (muchos anónimos, no guarda nombres) y del `personal` (una sola). Cuando se elige, el bot **aclara que este modo guarda nombres**, para usarlo solo con grupos chicos y conocidos (privacidad).
- **Género y concordancia**: el bot pregunta cómo preferís que te hable (**varón, mujer o no binario**) y usa la **concordancia correcta** en español ("¡Bienvenida! ¿Estás lista?" / "¡Bienvenido! ¿Estás listo?" / "¡Bienvenide! ¿Estás liste?"). **No inventa el dato**: si no lo decís, usa masculino por defecto en el lenguaje, pero nunca guarda un género que no dijiste. En modo `aula` el género tampoco se persiste. Con smoke tests para los tres modos y la privacidad.

## [0.3.17] — 2026-07-26

La pregunta aula/personal también aparece en las instalaciones viejas.

### Arreglado
- El bot ahora pregunta **aula o personal** también cuando el perfil de una instalación previa **no tiene** todavía el campo `Modo` (antes solo lo hacía si el campo existía y decía "(sin definir)"). Así la migración de privacidad del nombre funciona en los installs anteriores a v0.3.16, no solo en los nuevos.

## [0.3.16] — 2026-07-26

En la compu del aula, el bot ya no guarda el nombre de los chicos.

### Nuevo / Cambiado
- **Modo aula / personal (privacidad del nombre)**: en el primer arranque, el bot pregunta si la computadora es **del aula (compartida)** o **personal**. En modo **aula** el nombre es efímero — se usa con calidez en la charla pero **NUNCA se guarda a disco** (Ley 25.326: no persistimos datos personales de menores en la cuenta compartida de la escuela); el rol y la placa, que no identifican a nadie, sí se conservan. En modo **personal** funciona como antes (recuerda el nombre, no vuelve a preguntar). Si una compu pasa a ser del aula, un nombre viejo que hubiera quedado guardado **se borra**. Migración automática: los installs existentes preguntan el modo una vez en el próximo arranque. Con **4 smoke tests** nuevos (incluidos los de privacidad).

## [0.3.15] — 2026-07-26

El bot recuerda por dónde va cada compu — sin guardar datos personales de ningún alumno.

### Nuevo
- **Memoria de progreso (de la compu/grupo, NO de una persona)**: nueva tool `memoria` que recuerda entre sesiones el **nivel**, los **proyectos hechos** (lista con tope de 8, sin duplicados) y el **último proyecto** de ESA computadora. Pensada para las PCs de escuela donde muchos alumnos comparten una cuenta: **NO guarda nombres ni nada que identifique a un menor** (Ley 25.326) — solo el avance pedagógico de la máquina. El bot la usa para retomar ("la última vez en esta compu quedó el semáforo, ¿seguimos?") y para adaptar el nivel. Todo el juicio (dedup, tope, orden) vive en **TypeScript**; el modelo solo pasa el nombre del proyecto al terminar (un único trigger de guardado). Archivo `~/.config/opencode/tecnia-memoria.md`, creado por el instalador y **sobrevive a los `/actualizar`** (nunca se pisa). Separado del perfil a propósito: lo personal y lo pedagógico no se mezclan. Con **6 smoke tests** nuevos (incluido uno que verifica que la memoria NO guarda datos personales).

## [0.3.14] — 2026-07-26

La resistencia en serie ahora se DIBUJA en el cable (no solo texto).

### Nuevo
- **Resistencia en serie dibujada** en el armador libre: cuando un pin va con su resistencia (`(con 330Ω)`), ahora se dibuja un **cuerpo de resistencia en el medio del cable** — el cable de color entra y sale de ella, así se **ve** que va en serie (antes era solo texto "(con 330Ω)" en la etiqueta, que un principiante no interpretaba). Sin bandas de colores a propósito: dibujar bandas incorrectas mentiría (un docente podría leerlas). Aplica al LED y al LED RGB (3 resistencias, una por canal). El display de 7 segmentos NO la dibuja (una sola R para 7 pines mentiría); mantiene el texto explicativo.

### Arreglado
- **CI en verde de nuevo** (venía rojo desde v0.3.8, 7 releases): `tests/actualizar.test.mjs` había quedado viejo — mockeaba las tags de git, pero el tool `actualizar` se refactorizó para leer la última versión con `fetch()` al archivo `VERSION`. El test ahora mockea `fetch` y la versión instalada del manifest, preservando la intención (comparación numérica de versiones) y sumando el caso "sin internet". Suite: 10/10.

## [0.3.13] — 2026-07-26

El bot abre los circuitos en el navegador, solo.

### Nuevo
- **Auto-open de circuitos**: cuando el bot genera un diagrama, ahora lo **ABRE en el navegador por defecto automáticamente** (Windows/Mac/Linux) — el docente no tiene que buscar el archivo ni hacer doble clic. Best-effort: si no puede, deja la ruta `file://` como fallback. Parámetro `abrir` opcional (default true).

## [0.3.12] — 2026-07-25

Diagramas de circuito con identidad de marca + cables más claros.

### Nuevo
- **Design system violeta** en TODOS los circuitos (armador libre + las 2 protoboards realistas): barra de marca, badge, caja "¿Cómo funciona?", header de tabla y tipografía, consistentes. Los colores de cable se mantienen estándar (rojo/verde/GND negro = corrección técnica).
- **Halo en los cables** de las protoboards realistas: donde se cruzan, cada cable "corta" al de abajo (técnica de mapa de subte) → se distinguen siempre, ningún cable se pierde. Clave para principiantes.

### Nuevo (skill)
- **Principios de diseño de esquemáticos** en el skill `circuitos-visuales`: sin cruces, resistencia en serie visible, colores estándar, claridad para principiantes.

## [0.3.11] — 2026-07-25

Tecnia Bot se acuerda de vos entre sesiones.

### Nuevo
- **Perfil persistente**: el bot pregunta tu nombre y rol (docente/alumno) UNA vez, los guarda, y en las próximas sesiones te **saluda por tu nombre** — sin volver a preguntar en cada arranque. Nueva tool `perfil` (`leer`/`guardar`); el perfil se carga en cada sesión vía `instructions` del `opencode.json`. El archivo (`~/.config/opencode/tecnia-perfil.md`) lo crea el instalador vacío y **sobrevive a los `/actualizar`** (nunca se pisa). El bot adapta el andamiaje según el rol y la placa preferida.

## [0.3.10] — 2026-07-25

El bot entiende y explica cómo se resuelven las librerías.

### Nuevo
- El skill `librerias` (y `docs/librerias.md`) ahora explica que PlatformIO busca las librerías **local primero** (caché `~/.platformio/`) y, si faltan, las baja del **registro oficial** (registry.platformio.org) — quedando cacheadas para andar offline tras la primera descarga. Regla para el bot: usar SIEMPRE nombres del registro oficial (`owner/nombre`), nunca URLs random ni pegar código de librerías a mano, y saber explicárselo al docente.

## [0.3.9] — 2026-07-25

Auditoría de librerías de los 15 proyectos: suma el LCD por I2C.

### Nuevo
- **`LiquidCrystal_I2C`** (`marcoschwartz/LiquidCrystal_I2C`) agregada a la referencia (`docs/librerias.md` + skill `librerias` + proyecto de test): 2 proyectos (invernadero y calefacción) usan el LCD por **I2C** en ESP32 — es otra librería, distinta del LCD paralelo. **Verificada compilando** en UNO y ESP32.

### Auditado
- Revisado el código de los **15 proyectos INET**: el resto de las librerías ya estaba cubierto. El RTC (proyecto 03) se lista en insumos pero el código no lo usa (`millis()`); el ultrasónico HC-SR04 se lee con `pulseIn` (core, sin librería). **Cobertura completa.**

## [0.3.8] — 2026-07-25

Referencia de librerías: qué `lib_deps` necesita cada componente.

### Nuevo
- **Doc `docs/librerias.md` + skill `librerias`** (12° skill): la línea exacta de `lib_deps` para cada componente (servo, DHT, OLED SSD1306, teclado matricial, motor paso a paso, NeoPixel, MPU6050, LCD, BMP085…), **verificada compilando** en UNO y ESP32. Así el bot genera `platformio.ini` correctos y nadie choca con *"fatal error: X.h: No such file"*. Incluye el proyecto de verificación `ejemplos/_test-librerias/` y desmiente el mito de que `LiquidCrystal`/`Stepper` vienen incluidas (NO vienen). Los únicos bundled en ambas placas: `Wire`, `SPI`, `EEPROM` (y `WiFi` solo en ESP32).

## [0.3.7] — 2026-07-25

Ejemplo listo para usar: mover un servo con el teclado.

### Nuevo
- **Ejemplos `servo-teclado-uno` y `servo-teclado-esp32`**: proyectos PlatformIO completos, **compilados y verificados** (UNO: RAM 14% / Flash 10%; ESP32: imagen creada OK), que mueven un servo con las teclas `a`/`d` desde el monitor serial. Es el caso práctico de comunicación serial de punta a punta — con README, cableado del servo y link a la [guía](docs/monitor-serial.md).

## [0.3.6] — 2026-07-25

Tecnia Bot ahora sabe de comunicación serial.

### Nuevo
- **Skill `comunicacion-serial`**: base de conocimiento para que el bot guíe sobre comunicación serial — leer datos de la placa, mandarle teclas, los baudios, el sketch de un servo controlado por teclado, y los errores comunes (caracteres raros = baudios que no coinciden, puerto ocupado). Así el bot enseña esto aunque no tenga internet. Ya son **11 skills**.

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
