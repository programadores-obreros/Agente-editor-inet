# Changelog

Todas las versiones importantes de Tecnia Bot. Formato basado en [Keep a Changelog](https://keepachangelog.com/es/).

## [Unreleased]

## [0.3.76] — 2026-09-06

La API key de Google pasa a ser opcional: sin key, el agente usa Big Pickle, el modelo gratuito de OpenCode. Y se va la key embebida en el instalador.

### Cambiado
- **La CI ejecuta el instalador de Windows de verdad.** Job `windows` en `windows-latest` con PowerShell 5.1 (el de las escuelas, no `pwsh`): parsea todos los `.ps1` con el parser real y falla con archivo y línea; PSScriptAnalyzer en severidad Error; corre `bootstrap.ps1` de punta a punta sin atender (`TECNIA_SIN_PROMPT=1`, un reintento del paso entero porque el bootstrap es idempotente); verifica que OpenCode quede en la versión de `install/OPENCODE_VERSION` con `hold`, que `opencode.json` tenga el agente y `opencode/big-pickle`, y que `pio.exe` responda; compila `ejemplos/_test-librerias` para `uno` (ESP32 a pedido por `workflow_dispatch`, tarda 5 min y baja 300 MB); desinstala con `-Conservar` y comprueba que no quede rastro; sube `instalacion.log` siempre. Antes la CI corría sólo en Linux y ningún `.ps1` se ejecutaba: esta semana el PowerShell real cazó dos errores de sintaxis que 243 tests no vieron. `build-installer.yml` además parsea la copia instalada por el `.exe` y verifica `OPENCODE_VERSION` y `MANIFEST.sha256`.
- **`pnpm typecheck` pasa: 88 errores → 0**, y la CI de Linux lo corre. `@opencode-ai/plugin` fijado a la misma versión que `OPENCODE_VERSION` y `@types/bun` en vez del shim a mano de `env.d.ts`; `noUncheckedIndexedAccess` intacto (los `possibly undefined` se resolvieron con guards, no con `!`). `pnpm-workspace.yaml` deja explícito que `msgpackr-extract` no se compila.
- **`TECNIA_SIN_PROMPT`**: instalaciones desatendidas (CI, despliegue a varias PCs) no preguntan la key de Google y siguen con Big Pickle.
- **La versión de OpenCode queda FIJADA, en un solo archivo, para Windows y Linux**: `install/OPENCODE_VERSION` (hoy `1.18.18`, la validada en la VM con Big Pickle y el override del agente). Antes `bootstrap.ps1` hacía `scoop install opencode` a secas y cada PC se llevaba la última versión de ese día (en la VM ya ofrecía la 1.18.29, sin probar), mientras `bootstrap.sh` fijaba a mano una versión distinta y vieja (1.17.15); la capa depende de detalles que OpenCode cambia entre versiones (`default_agent`, `instructions`, `agent.<nombre>.model`, `tui.json`, plugins). Ahora los dos bootstraps leen el archivo (relativo a su propia carpeta, así viaja dentro del `.exe`) y cortan con mensaje claro si falta. En Windows se instala `scoop install opencode@<versión>` — Scoop regenera el manifest para esa versión con el bloque `autoupdate` (avisa "Attempting to generate manifest", es normal) — y enseguida `scoop hold opencode`, que escribe `"hold": true` en `current\install.json` y hace que `scoop update *` la saltee: así tampoco se pisa el binario `baseline` que se copia en CPUs sin AVX2. Si ya hay otra versión instalada **no se desinstala nada**: si la fijada está en el disco se activa con `scoop reset opencode@<versión>` (sólo mueve `current` y rehace shims); si no, se avisa y se deja. `diagnostico.ps1` muestra fijada vs instalada, si el hold está puesto y qué versiones hay en disco. Tests nuevos en `tests/opencode-version.test.mjs`, verificados por mutación. `update.ps1`/`update.sh`/`/actualizar` no tocan OpenCode (sólo bajan el fuente y reinstalan la capa), así que respetan el pin sin cambios.
- **El bootstrap sólo da por instalado a OpenCode si Scoop lo tiene registrado** (`Test-OpenCodeScoop`: existe `scoop\apps\opencode\current\manifest.json`) **y además arranca**. En la VM, tras `scoop uninstall opencode`, el instalador decía "[OK] OpenCode ya esta instalado" y no instalaba nada: en `scoop\shims\opencode.exe` quedaba un binario entero de 178 MB que Scoop no administra, `Get-Command` lo encontraba y `Test-OpenCode` decía que sí. Ahora ese caso avisa "Hay un opencode.exe suelto que Scoop no administra" e instala la versión fijada (Scoop sobreescribe el shim; no se borra nada antes). Si Scoop no logra registrarla y el exe suelto sigue ahí, el aviso final dice que probablemente está bloqueado y qué hacer.
- **`scoop hold` fallaba y el instalador decía [OK]**: verificado en `libexec/scoop-hold.ps1`, si la app no está imprime `ERROR 'x' is not installed` con `Write-Host` y termina con exit 0 (`exit $exitcode` con la variable sin definir). `Fijar-OpenCode` ahora detecta una línea que empieza con `ERROR` o `$LASTEXITCODE` distinto de 0, imprime "[X] No se pudo fijar la version: ..." y nunca el [OK] en ese caso.
- **`Reparar-Shim` ya no copia el programa entero (178 MB) como lanzador**: usa `scoop reset opencode`, que rehace shims, `current` y PATH desde la versión instalada sin descargar nada (`libexec/scoop-reset.ps1`). Esa copia era el origen del binario fantasma de arriba. Queda sólo como último recurso si el reset falla, con un aviso de que ese archivo queda fuera de Scoop. `diagnostico.ps1` marca el shim como "binario copiado a mano, no administrado por Scoop" si pesa más de 1 MB.
- **Se eliminó la key de Google embebida en `install.ps1`/`install.sh`** (la que usaba el instalador desde la v0.3.36 cuando nadie pegaba la suya) y **se rotó**: ya no sirve y no queda ninguna key en el repo. Un test nuevo (`tests/modelo.test.mjs`) lo verifica buscando literales con forma de key y las palabras con que se la nombraba. También se corrige `docs/api-key-google.md`, que decía que la key "nunca vive en este repositorio" cuando sí vivía.
- **Sin API key, Tecnia Bot usa `opencode/big-pickle`** (Big Pickle, el modelo gratuito de OpenCode Zen: sin cuenta ni login). Con key de Google guardada en `auth.json`, sigue usando `google/gemini-3.5-flash-lite`. El instalador escribe la elección como override por agente en `opencode.json` (`agent` → `tecnia-bot` → `model`), sin tocar el resto de la config del docente, y la **re-evalúa en cada corrida** (instalar, "Reparar Tecnia Bot", `/actualizar`): quien agrega una key después con `/connect` pasa a Gemini en la próxima corrida. Si `opencode.json` no se puede parsear, se deja intacto y se imprime cómo agregar el override a mano.
- **El modelo sale del frontmatter del agente**: `opencode/agent/tecnia-bot.md` ya no declara `model`. Se descubrió en la VM que, con el override escrito en `opencode.json`, el agente seguía en Gemini: OpenCode hace `mergeDeep(config.agent, agentes .md)` (`config.ts`), o sea que los `.md` se mezclan *encima* del JSON y el `model:` del frontmatter siempre ganaba. Ahora la única fuente del modelo es `opencode.json` → `agent.tecnia-bot.model`, escrita por el instalador. El test que exigía un modelo fijado (no `-latest`) en el frontmatter pasa a exigir que el frontmatter **no** tenga `model`; otro verifica que `install.ps1` e `install.sh` usen los mismos ids y que ningún `.md` de `opencode/agent/` declare modelo.
- **El prompt de la key dice que es opcional** ("Enter para seguir sin key: Tecnia Bot va a usar el modelo gratuito Big Pickle de OpenCode"), y al final el instalador imprime **exactamente qué modelo quedó configurado** y cómo cambiarlo. Sin key ya no se toca `auth.json` ni la variable de entorno `GOOGLE_GENERATIVE_AI_API_KEY`. Se dice sin vueltas lo que OpenCode documenta de Big Pickle: es gratis **por tiempo limitado** y, mientras lo sea, **las conversaciones pueden usarse para mejorar el modelo** — este producto lo usan menores, y se avisa en el instalador, el README y la guía de la key.
- **Las instalaciones existentes se limpian solas**: una máquina instalada con la v0.3.75 o anterior tiene la key compartida rotada en `auth.json` y, en Windows, en la variable de usuario `GOOGLE_GENERATIVE_AI_API_KEY` — una credencial muerta que el instalador daba por buena porque sólo miraba "hay key de google". Ahora la reconoce por su **SHA-256** (en el repo queda el hash, nunca el literal), la quita de los dos lugares preservando otras credenciales, avisa ("Se quitó la key de respaldo compartida que traían las versiones anteriores (ya no es válida)") y recién después decide el modelo. Si alguien la pega en el prompt desde un apunte viejo, se rechaza por el mismo motivo.
- **`diagnostico.ps1`** informa el modelo configurado para `tecnia-bot` (leído de `opencode.json`/`.jsonc`), si hay key de Google en `auth.json` (sólo si hay, nunca el valor), si esa key es la compartida vieja (por hash) y avisa si las cosas no cierran (key sin Gemini, o Gemini sin key).
- **README**: la fila de Tecnologías documentaba `google/gemini-flash-lite-latest`, un alias abandonado en la 0.3.63; ahora dice el id real (`google/gemini-3.5-flash-lite`) y suma Big Pickle.

### Arreglado
- **`Test-OpenCode` ya no depende de que `opencode` esté en el PATH del proceso.** Lanzado desde el instalador, el proceso hereda un PATH sin `scoop\shims` y `Get-Command opencode` fallaba: el bootstrap iba por la rama de instalar aunque todo estuviera bien. Ahora, sin shim en el PATH, prueba directamente el binario real. La salida de `scoop reset` se muestra filtrada en el log en vez de tragarse: en una corrida bajo Inno el reset falló al rehacer el shim con un error de `Remove-Item` que no se pudo reproducir a mano; con este cambio, si vuelve a pasar, la causa queda escrita.
- **"OpenCode no arranca" cuando el que falla es el shim de Scoop.** Reproducido en la VM y en una notebook: el lanzador de 20 KB de Scoop tiró `Shim: Could not determine if target is a GUI app` justo después de que Scoop se actualizó a sí mismo, mientras `opencode.exe` andaba perfecto; el bootstrap concluía que OpenCode no arrancaba y el lanzador mostraba el cartel rojo. Ahora, si el shim falla dos veces, `Test-OpenCode` le pregunta al binario real (`scoop\apps\opencode\current\opencode.exe`); si contesta, OpenCode arranca, lo roto es el shim y se rehace con `scoop reset`. El lanzador usa el binario real primero, el shim después y el PATH al final.
- **Al instalar la versión fijada, si Scoop dice "already installed" se la activa.** En la notebook la carpeta 1.18.18 existía desde agosto pero `current` apuntaba a 1.18.29; Scoop avisaba que ya estaba instalada y el bootstrap reintentaba la misma instalación. Ahora la activa con `scoop reset opencode@<versión>`.
- **El pin de OpenCode se aplica aunque la versión fijada nunca haya estado en esa máquina.** Una notebook real venía de 1.18.19 → 1.18.29 (auto-update) y el bootstrap decía "se deja como está": el pin no servía para nada. Verificado en el código de Scoop: `scoop install opencode@<versión>` con otra versión instalada la pone AL LADO y cambia `current`, no borra nada. Ahora la instala, relee la versión y comprueba que arranque; si OpenCode está abierto lo dice y pide cerrarlo y volver a Reparar.
- **El lanzador reintenta una vez antes de decir "OpenCode no arranca".** En la misma notebook dijo que no arrancaba y OpenCode abrió un segundo después. Igual que el bootstrap: 3 segundos de espera y segundo intento.
- **El bootstrap deja de creerle a Scoop en silencio.** Scoop escribe sus errores con `Write-Host` (stream de información) y `2>&1` no los captura en PowerShell 5.1: `scoop hold` y `scoop reset` fallaban ("is not installed", "instances of opencode are still running") y el instalador decía [OK]. Ahora captura todos los streams (`*>&1`), relee la versión activa después del reset y, si no cambió, lo dice con la causa ("Tecnia Bot está abierto: cerralo y volvé a correr Reparar"). Tests que exigen `*>&1` en las tres invocaciones y la relectura tras el reset.
- **El pin de OpenCode se saltaba solo: OpenCode se auto-actualiza.** Una hora después de fijar 1.18.18 con `scoop hold`, la VM corría 1.18.29. OpenCode, ante cualquier versión *patch* nueva, se actualiza sin preguntar (`cli/upgrade.ts`), y en Scoop lo hace con `scoop install opencode@<nueva>`: una instalación explícita que **no respeta el hold** (el hold sólo frena `scoop update`) y que además reescribe `install.json` sin la marca. Ahora `install.ps1` e `install.sh` escriben `"autoupdate": false` en `opencode.json`: la versión la decide `install/OPENCODE_VERSION`, y las actualizaciones llegan por Reparar o `/actualizar`, probadas. Test que exige la clave en los dos instaladores.
- **`compile`/`flash`/`both` ya no pueden colgarse para siempre.** `run()` no tenía timeout: la primera compilación baja el toolchain sin mostrar progreso y parecía un cuelgue. Ahora 15 minutos para compilar/cargar y el bootstrap de `reparar` (override `TECNIA_PIO_TIMEOUT_MS`), 60 s para `pio --version` y `device list`; al vencer, el mensaje dice "sigue descargando herramientas o se colgó; probá de nuevo, la segunda vez es rápido". Cancelar desde OpenCode sigue cortando.
- **El error de compilación llega recortado alrededor del primero real** (±15 líneas del primer `error:` más las últimas 10, con conteo de omitidas) en vez de las 3000 líneas de warnings que consumían el contexto del modelo. La traducción de errores se hace sobre el texto completo, antes de recortar.
- **Windows:** `Get-CimInstance` en vez de `Get-WmiObject` (no existe en PowerShell 7) y salida en UTF-8 (los nombres de dispositivo con tildes llegaban rotos).
- **Tests de comportamiento de `execute()` para las seis acciones** (`tests/platformio-execute.test.mjs`, 20): compilación sana y rota, pio ausente, `flash` sin placa y con CH340 detectado, `both` que frena si la compilación falla y busca la placa después de compilar, timeout y cancelación, diagnóstico sin PowerShell fuera de Windows. La tool más crítica no tenía ninguno. 243 → 263 tests.
- **`/actualizar` no se cuelga ni revienta.** El tool leía la salida del proceso DESPUÉS de esperar que terminara (si llenaba el buffer, deadlock), lanzaba PowerShell fuera de un try/catch y consultaba GitHub sin timeout: en una escuela que bloquea GitHub, `/diagnostico` quedaba colgado detrás de ese fetch. Ahora lee stdout/stderr antes de esperar, tiene timeout de 8 s con aviso de red bloqueada, y si PowerShell no arranca lo dice sin excepción. Tests de comportamiento (fetch que nunca responde, spawn que falla, pipe que sólo termina si se lee).
- **`diagnostico.ps1` ya no busca una carpeta de red de una escuela.** Escribía primero en `\\192.168.100.9\Compartido` (la IP de UNA escuela, con datos de la máquina adentro): en cualquier otra red, `Test-Path` a un UNC inexistente puede tardar decenas de segundos. Ahora escribe en el Escritorio (o `%LOCALAPPDATA%\TecniaBot`, o TEMP); una carpeta compartida sólo con `-Compartido <ruta>`.
- **Desinstalar limpia lo que dejaba y pregunta antes de borrar datos personales.** Saca de `opencode.json` las dos rutas absolutas de `instructions` (perfil/memoria) y el bloque `agent.tecnia-bot`; `default_agent` sólo si es el nuestro; si el JSON no parsea, avisa y no lo toca. Pregunta (20 s, No por defecto; `-Conservar`/`-Borrar` para automatizar) antes de borrar la key de Google y los archivos de perfil/memoria. La desinstalación silenciosa de Inno pasa `-Conservar`. `uninstall.sh` espejo.
- **Bootstrap:** conserva los últimos 5 `instalacion-<fecha>.log` en vez de pisar el único log en cada Reparar (se perdía la falla original); silencia en una línea el `WinError 1921` con que pip falla al auto-actualizarse al final de la instalación de PlatformIO (`get-platformio.py` no tiene opción para saltearlo; no afecta a PlatformIO, pero decía "Listo" y abajo un error de Python); lanza `install.ps1` por `$PSHOME\powershell.exe`, no por nombre.
- **Lanzador y diagnóstico honran `XDG_CONFIG_HOME`** como ya hacían `install.ps1` y `bootstrap.ps1`: con la variable seteada, el lanzador creía que faltaba la capa y entraba en un bucle de "volvé a correr el instalador".
- **`docs/rollback.md`:** punto seguro unificado en v0.3.69 (decía v0.3.69 y v0.3.62 en el mismo documento). Test nuevo `tests/robustez.test.mjs` (12 invariantes), cada uno verificado por mutación.
- **El prompt, las tools y los docs dicen lo mismo.** El prompt afirmaba que las acciones de `platformio` eran "exactamente" cinco y "no existe ninguna otra", y sesenta líneas más abajo mandaba usar `reparar` con un parámetro `accion` que el tool no tiene (es `action`): ahora lista las seis acciones, usa `action:` en todos los ejemplos y la description del tool incluye `reparar`. El prompt nombra los 16 skills (faltaban `librerias`, `comunicacion-serial`, `fichas` y `circuitos-visuales`) y las tools `ficha` y `ayuda`; `/ayuda` y el micro-sitio listan `/reparar`. Una sola instrucción para "falta PlatformIO": primero el bot corre `reparar`, plan B el menú inicio; en Linux/Mac el comando exacto (`bash install/bootstrap.sh`) en vez de "instalá con el instalador oficial". Un solo mensaje canónico para reinstalar desde cero.
- **Modo aula: la placa NO se persiste.** `perfil` la guardaba (y su propia description lo decía) mientras el prompt aseguraba lo contrario; en una compu compartida, la placa del alumno anterior confundía al siguiente. Ahora en aula se ignora y se pide en cada sesión; tests de comportamiento.
- **El monitor serial toma `monitor_speed` del `platformio.ini`** del proyecto (env pedido, `[env]`, primer env) y sólo cae a 9600 si no hay ini. La description prometía "baudios automáticos" con 9600 fijo, y el ESP32 va a 115200: basura en pantalla garantizada.
- **Tool `circuito`: LEDs del ESP32 con 220Ω**, no 330Ω (3.3V; coherente con las skills). También en las dos plantillas de protoboard.
- **README y micro-sitio honestos**: 16 skills y 4 comandos (decían 14 y 3), "offline" reformulado (los materiales generados funcionan sin internet; el chat necesita conexión), instalador de 7,4 MB (decía 2,5). Test nuevo `tests/coherencia-prompt.test.mjs`: cada ejemplo de `platformio` del prompt usa `action:` con un valor del enum real, cada skill está nombrada, cada comando está en `/ayuda` y en el sitio, y los conteos del README son los reales.
- **Skills: errores técnicos que rompían en el aula, verificados contra Espressif/Worldsemi/HC-SR501.** Teclado 4x4 sin GPIO12 (strapping MTDI: con pull-up la placa no arranca); DHT unificado en GPIO4 en tabla, código y resumen (el código leía GPIO15 y el docente cableaba GPIO4: lectura `nan`); resistencia de LED coherente en `diagramas-conexion`, `gotchas-hardware` y `modulos-avanzados` (220Ω en 3.3V, 330Ω en 5V, medir Vf: tres skills decían "330Ω siempre" y `esp32` demostraba que a 3.3V no prende); PIR HC-SR501 con OUT de 3.3V directo al GPIO (tres lugares decían 5V con divisor); GPIO2 sólo importa junto con GPIO0 en LOW; watchdog sólo en ESP32 (el AVR no lo trae activo); ADC2 inutilizable con WiFi en la tabla de `esp32`; NeoPixel con nota de nivel 0,7·VDD; `modulos-avanzados` aclara que sus pines son ESP32 y da los equivalentes UNO.
- **Tool `circuito`:** el pull-up del DHT depende del módulo (3 pines ya lo trae; sensor pelado de 4 patas, 10kΩ) y el preset `lcd-esp32` avisa el problema de 5V en SDA/SCL (GPIO21/22 no toleran 5V: alimentar a 3.3V o conversor bidireccional).
- **`librerias`:** filas nuevas `deanisme/SevSeg` y `waspinator/AccelStepper`, que `modulos-avanzados` usaba sin declararlas (compilación cortada sin salida); ids confirmados en el registro oficial de PlatformIO y compilados en la VM.
- **Prompt:** en el chat va tabla de colores + ASCII; Mermaid sólo si se escribe un `.md` (la terminal no lo renderiza; el prompt pedía Mermaid SIEMPRE y contradecía a `diagramas-conexion`).
- **Test nuevo `tests/skills-coherencia.test.mjs`:** ningún snippet ESP32 usa GPIO12/15 como pin de trabajo; el DHT usa un único GPIO; todo `#include` de las skills tiene fila en `librerias`; la advertencia del PIR no dice 5V.
- **Fichas:** las 17 hojas del instalador vuelven a coincidir con su fuente (02, 04, 08 y 14 con dibujos propios en vez de fotos de catálogo; la 09 con el divisor del LDR como lo enseña el skill `sensores`, fix portado a `fichas-tecnialab/src/dibujos/ldr.mjs`) y ahora viajan firmadas: `opencode/skills/fichas/MANIFEST.sha256` se verifica en cada corrida de tests y con `pnpm fichas:check`; `pnpm publicar` en el repo de fichas copia, regenera el índice y firma. Antes cinco de diecisiete diferían en los dos sentidos y ningún test lo veía. El SKILL.md ya no marca hojas con foto de terceros: no queda ninguna.
- **`/actualizar` instala solo el último release publicado.** `update.ps1`/`update.sh` resuelven el tag con la API de GitHub (`releases/latest`, con User-Agent y TLS 1.2) y bajan `archive/refs/tags/<tag>`; antes bajaban la punta de `main` (código sin publicar) aunque el comentario decía "último release". Verifican que el `VERSION` descargado coincida con el tag ANTES de reemplazar la copia instalada; si algo falla, la copia queda intacta. Si ya estás en la última no descargan nada. En un clon de git nunca más `git reset --hard` ni `git clean`: si hay cambios sin commitear abortan sin tocar nada, y si está limpio se paran en el tag. `actualizar.ts` también consulta `releases/latest` (antes leía `main/VERSION` y se contradecía con el script).
- **Test nuevo para una trampa de PowerShell que la CI de Linux no ve**: `"$variable: texto"` se lee como prefijo de ámbito y el archivo no parsea. El PowerShell 5.1 real de la VM lo cazó dos veces en `update.ps1`; `tests/ps1-variables.test.mjs` lo prohíbe en todos los `.ps1` (la forma segura es `${variable}:`).
- **`/reparar` decía "PlatformIO sigue sin instalarse" después de instalarlo bien, y `compile` seguía fallando hasta reiniciar OpenCode**: `pioBin()` cacheaba la ruta del binario y, cuando PlatformIO no estaba, cacheaba también el fallback `"pio"`. Como `execute()` corre `pio --version` ANTES de reparar, el cache quedaba en `"pio"`, y al final se comprobaba `existsSync("pio")` — un archivo relativo al cwd, no el PATH — que daba falso aunque `~/.platformio/penv` ya tuviera el binario. El docente quedaba en un loop de /reparar. Ahora sólo se cachea una ruta real, y antes/después de reparar se vuelve a resolver sin cache (`pioDisponible()`). Test nuevo `tests/platformio-pio.test.mjs`: instala un `pio` falso en un HOME temporal después del primer chequeo, sin reiniciar el módulo, y exige que se detecte; falla con el código viejo.
- **`reparar` no podía correr cuando faltaba PlatformIO**, que es el único caso para el que existe. `execute()` hacía un pre-chequeo `pio --version` para toda acción salvo `diagnostico` y, si fallaba, devolvía el texto de `pioNoEncontrado()` ("Menú inicio → Reparar Tecnia Bot") — también para `reparar`, así que la rama de reparación era inalcanzable. Reproducido en la VM Windows 10 con `.platformio` movida: `/reparar` contestaba "andá al menú inicio" y no instalaba nada. Ahora el pre-chequeo también excluye `reparar`. Tests en `tests/platformio-pio.test.mjs`: `execute({action:"reparar"})` sin pio no devuelve ese texto y llega a su rama (Linux: "solo para Windows"; win32 simulado: "No encuentro el instalador"), mientras `compile` sin pio sigue avisando.
- **La ficha del LDR se contradecía con el skill y con el preset de `circuito`**: la hoja `09-ldr` dibujaba la resistencia de 10k arriba y el LDR abajo (1023 a oscuras, 0 al sol), mientras `skills/sensores`, el preset `ldr` de `circuito` y el proyecto 15 usan el LDR arriba (0 a oscuras, 4095 con luz). Un docente imprimía la ficha, le preguntaba al bot y recibía la lectura invertida. Se dio vuelta la ficha (dibujo, tensiones del punto medio y lecturas), sin tocar ninguna condición de código: gana el cableado del skill, que además es el intuitivo ("más luz, número más grande").
- **La protoboard ya no se explica por "filas" ni "columnas"**: el skill de Arduino decía que lo que se une es la FILA y el material de cátedra que es la COLUMNA, cada uno presentando al otro como "el error típico". Depende de cómo se apoye la placa. Ahora `skills/arduino`, la leyenda y el aviso de `circuito` y el proyecto 01 describen la protoboard por marcas fijas (el grupo de cinco, el canal central, los buses), y el texto vale mire como mire el alumno.

## [0.3.75] — 2026-08-23

`/reparar` podía avisar que PlatformIO quedó instalado sin haber corrido la reparación.

### Arreglado
- **`reparar` de la tool `platformio` daba un OK falso**: contestaba "Listo: PlatformIO quedó instalado" con sólo comprobar que estuviera presente AL FINAL — si el bootstrap ni siquiera llegaba a arrancar (PowerShell fuera del PATH, una política que lo bloquea, el antivirus) y PlatformIO ya estaba de una instalación anterior, el tool informaba un éxito por una reparación que nunca corrió. Ahora mira si PlatformIO está antes y después, distingue "lo instalé" de "ya estaba", y si el proceso ni pudo lanzarse (código 127) lo dice sin afirmar nada sobre la instalación — con "Reparar Tecnia Bot" del menú inicio como salida si esto falla. Salió de mirar los tiempos de una corrida real: 8,1 s en total, cuando instalar PlatformIO de cero tarda mucho más. Tests: 151 → 152.

## [0.3.74] — 2026-08-23

Nuevo comando `/reparar` + el bot deja de inflar "estás al día" a "todo al día".

### Nuevo
- **Comando `/reparar`**: corre el instalador completo (Scoop, OpenCode, Python, PlatformIO, capa educativa) revisando y completando lo que falte, sin tocar lo que ya está. Antes, pedirle en lenguaje natural "reparar tecnia bot" caía en la tool `actualizar`, que sólo mira la versión — un comando explícito saca la ambigüedad de que el modelo tenga que interpretar bien la intención.

### Arreglado
- **El bot decía "con PlatformIO y todo al día" sin haberlo mirado**: un docente pidió reparar, el modelo llamó a `actualizar` (que sólo devuelve la versión) y estiró la respuesta a "todo al día" — PlatformIO no estaba, se instaló recién en el mensaje siguiente. El alcance real ahora viaja en la respuesta de la propia tool y no sólo en el prompt (que se puede editar, resumir o quedar atrás): las cuatro respuestas de `actualizar` aclaran que sólo miran la versión. Tests: 148 → 151.

## [0.3.73] — 2026-08-23

Al diagnóstico le faltaba el único log que explica por qué falla un mensaje ya con todo instalado.

### Arreglado
- **`/diagnostico` no incluía el log de OpenCode**: juntaba el del bootstrap y el del instalador de Inno, que sólo cuentan cómo fue la instalación — ninguno sabe nada de lo que pasa después, con todo funcionando, que es cuando apareció "Failed to send prompt — Unexpected server error. Check server logs for details" sin forma de verlos. Ahora también junta las líneas ERROR y WARN (las últimas doce) del log de OpenCode; volcarlo entero sería tan inútil como no mandarlo. De paso se tapa cualquier credencial de proxy (`usuario:clave@proxy`) antes de imprimir el diagnóstico — no es la key de la API, pero es una credencial igual, en un archivo que circula por WhatsApp.

## [0.3.72] — 2026-08-20

El bot instala PlatformIO solo, en vez de mandar a buscar un acceso directo.

### Nuevo
- **`platformio` con acción `reparar`**: el docente dice "instalá platformio" o "hacelo" y el bot corre el bootstrap él mismo, en vez de derivarlo al menú inicio a correr un script a mano — el prompt se lo prohibía explícitamente hasta esta versión ("no instalás PlatformIO automáticamente"). Avisa antes que son unos 60 MB y varios minutos. De paso, el error trae escritas las dos causas habituales (el señuelo de Python de la Microsoft Store y el bloqueo de pypi.org) para que el modelo las reconozca en la conversación, en vez de tener que pedir el `instalacion.log` por foto de pantalla una tercera vez. Tests: 146 → 147.

## [0.3.71] — 2026-08-20

El bot mandaba a un acceso directo de reparación que no existía.

### Arreglado
- **"Volvé a correr el instalador desde el menú inicio" era un consejo imposible de seguir**: la v0.3.70 mejoró el mensaje, pero de los tres accesos directos instalados (abrir, diagnosticar, desinstalar) ninguno reinstala — una docente fue a buscarlo y no estaba. Ahora existe **Menú inicio → "Reparar Tecnia Bot"**, que corre el mismo bootstrap que ya usaba el lanzador para autocompletarse, y el tool nombra el acceso TAL CUAL, no "el instalador". Se sumó un test que contrasta cada acceso directo que el bot menciona contra los `[Icons]` reales del instalador — escribiéndolo apareció un segundo bug: el helper que limpiaba el `.iss` para comparar se comía `{autoprograms}`, la constante que identifica justo un acceso directo, así que el test encontraba cero accesos siempre, dijera lo que dijera el archivo. Se actualizó también `docs/rollback.md`: el punto seguro de vuelta atrás pasa de la v0.3.62 a la v0.3.69. Tests: 144 → 146.

## [0.3.70] — 2026-08-20

Python apuntaba al señuelo de la Microsoft Store, y un OpenCode sano se declaraba muerto.

### Arreglado
- **El instalador caía en el "Python" falso de la Microsoft Store**: Windows deja un `python.exe` en `WindowsApps` que sólo abre la tienda, y esa carpeta suele ir antes que los shims de Scoop en el PATH. El instalador probaba el shim de Scoop y, si no estaba, caía a `python` a secas — que resolvía directo al señuelo, justamente cuando no había otro Python en el PATH. Ahora `Buscar-Python` prueba varios lugares, descarta `WindowsApps` de entrada y le pregunta a cada candidato si es Python en vez de suponerlo por dónde vive.
- **`Test-OpenCode` declaraba muerto un OpenCode que andaba**: el shim de Scoop escribe "Could not determine if target is a GUI app" cuando el antivirus tiene tomado un binario recién bajado (casi 200 MB) — un falso negativo que disparaba una reinstalación innecesaria sobre algo que la misma docente usó ese mismo día. Ahora reintenta una vez, tres segundos después. Es, muy probablemente, el mismo misterio que explicaba bootstraps que morían a los 2,4 segundos y andaban perfecto corridos a mano dos minutos más tarde.
- **El diagnóstico mandaba a instalar Visual Studio Code**: `/diagnostico` le pidió al modelo "explicá brevemente los pasos" sin decir cuáles, y la documentación oficial de PlatformIO ofrece cinco métodos — el modelo eligió el más difundido en internet, que no es el que usa Tecnia Bot (PlatformIO Core). Ahora el tool y el comando nombran la única reparación que corresponde, con la prohibición explícita de nombrar VS Code. También el diagnóstico reporta ahora en qué eslabón se cortó la instalación de PlatformIO (Python, script, entorno, `pip install`) en vez de un genérico "FALTA". Todo salió del `instalacion.log` de una sola máquina de una capacitación real (Escuela Juana Manso, 20/08); decenas de máquinas instalaron sin problema. Tests: 141 → 144.

## [0.3.69] — 2026-08-20

Un `.describe()` que mentía dejaba seis fichas invisibles, y un script de soporte que nadie podía correr.

### Arreglado
- **El navegador se seguía abriendo solo, aunque el código ya estaba arreglado**: el reporte "cada vez que le pido algo me abre esto" seguía apareciendo cuando `circuito.ts` ya defaulteaba a no abrir — porque el modelo no lee el código, lee el `.describe()` del tool, y ahí seguía diciendo "si es true (default)". Un `.describe()` que miente es peor que no tenerlo: la implementación queda bien y nadie la invoca como corresponde.
- **Seis de las diecisiete fichas eran inencontrables**: `normalizar()` no trataba el espacio como separador, así que "corriente alterna" no matcheaba contra el archivo `06-corriente-alterna.html`. Se llevaba puestas todas las fichas de nombre compuesto (las dos de corriente, entradas y salidas, arduino uno, sensor shield, tecnia bot) — el bot contestaba que no existían, sin tirar error.
- **`reportar.ps1` no tenía acceso directo**: ciento once líneas instaladas y muertas, porque para correrlo había que abrir PowerShell a mano — justo lo que alguien con un problema no hace. Se absorbió en `diagnostico.ps1`, que sí tiene botón, junto con el bloque de credenciales y el chequeo de política de ejecución (una GPO de escuela puede bloquear todo sin avisar). De paso, ese bloque dejó de imprimir `$_.Exception.Message`: con el JSON roto ese mensaje suele citar el fragmento que no pudo leer, y ese fragmento sale de `auth.json` — con la clave adentro, justo en el único caso en que alguien manda el reporte.
- **Seis tests eran de cartón**: entre otros, `Test-OpenCode` exigía la palabra `LASTEXITCODE` en el código sin exigir que el resultado saliera de ahí, y `scoop install` tenía techo de fallos permitidos pero no piso — cero instalaciones exitosas pasaba en verde, literalmente el estado de la v0.3.48. Todos verificados por mutación.

### Nuevo
- **`docs/rollback.md`**: guía de cómo volver atrás una versión, escrita antes de necesitarla.

## [0.3.68] — 2026-08-20

El lanzador podía disparar un segundo bootstrap en paralelo con el de Inno.

### Arreglado
- **Regresión que sólo aparecía con muchas máquinas a la vez**: si la marca de instalación en curso seguía puesta a los 5 minutos, el lanzador se rendía, veía que faltaba sólo la capa educativa y llamaba a `:reparar` — que lanzaba un SEGUNDO `bootstrap.ps1` en paralelo con el que Inno todavía tenía corriendo. Es el mismo bug de instalaciones simultáneas que el `SetupMutex` de la v0.3.53 arregla, pero el mutex sólo bloquea un segundo `Setup.exe`, no un bootstrap lanzado desde el `.cmd` — y con 20 máquinas de un aula bajando OpenCode, Python y PlatformIO por el mismo enlace, pasar los 5 minutos es el caso normal, no el raro. Tres arreglos: `:reparar` ahora mira la marca antes de tocar nada, el techo de espera sube de 5 a 20 minutos, y la heurística de "marca huérfana" exige también que la capa educativa esté instalada (antes daba positivo en medio de una instalación normal y la borraba). Además, el `scoop uninstall opencode` que se había sacado del código en la v0.3.58 por ser la única operación capaz de dejar la máquina peor había quedado impreso en pantalla como consejo — se reemplazó por una derivación al diagnóstico. Tests: 123.

## [0.3.67] — 2026-08-20

Cuatro contradicciones graves entre las reglas de prompt agregadas la noche anterior.

### Arreglado
- **Las tres reglas críticas de la v0.3.66 se peleaban con reglas que ya existían**, y un modelo "lite" resuelve instrucciones contradictorias inventando. Cuatro casos: "una cosa por turno" prohibía compilar en el mismo paso que escribir el código, justo el procedimiento que otra regla vuelve obligatorio — ahora crear el proyecto, escribir y compilar cuentan como un solo paso, y lo que no se encadena es lo de después (mostrar, abrir, cargar). Ofrecer "¿te lo muestro? ¿lo cargo?" en un mismo mensaje, con una respuesta ambigua resolviendo siempre hacia cargar a la placa — ahora una respuesta ambigua sobre dos ofertas se aclara con una pregunta corta. El modo `aula` (pensado para máquinas compartidas) guardaba la placa en el perfil, así que un docente con un UNO heredaba la configuración ESP32 del que usó la máquina antes — ahora en `aula` la placa se pregunta una vez por sesión y no se persiste. Y había doce líneas de protocolo anti-invención para el diseño curricular y ninguna para hardware, donde un pin inventado manda a cablear mal sin que ningún error de compilación lo avise — ahora pines, direcciones I2C, librerías y tensiones que no estén en un skill o circuito propio no se afirman. Tests: 121.

## [0.3.66] — 2026-08-20

El bot avisa antes de trabajar — no es un detalle, es el carácter del producto.

### Nuevo
- **Regla crítica nueva, la primera de todas**: el hallazgo más importante que reportó el usuario probando el bot no era el código que pegaba de más, ni la ventana que se abría sola, ni la placa que asumía — era que "se lanza solo a trabajar, no interactúa". Ahora, antes de producir cualquier resultado (código, circuito, proyecto, carga a la placa), el bot dice en una línea qué va a hacer y espera; una cosa por turno; y cierra con la pelota del lado del docente. Con el contrapeso necesario para que no se vuelva un bot que interroga de más: si ya le pidieron algo concreto, lo hace sin pedir permiso de nuevo.

## [0.3.65] — 2026-08-20

El circuito se abría solo en cada pedido, y los presets asumían ESP32 sin avisar.

### Arreglado
- **El navegador se abría en cada pedido de circuito**: el parámetro `abrir` tenía default `true`, así que cada consulta interrumpía al docente con una ventana nueva. Ahora genera, cuenta en una línea qué armó y OFRECE abrirlo — la misma regla que ya rige para el código.
- **Los nueve presets de componentes eran todos de ESP32**: ni uno de Arduino UNO. Un docente con UNO recibía pines GPIO que no existen en su placa y 3,3 V donde la suya tiene 5, sin ninguna advertencia — el mismo tipo de error que la auditoría de la v0.3.45 había encontrado en las fichas. Por ahora se hace honesto: el tool avisa que el esquema es para ESP32 y el prompt obliga a decirlo antes de mostrar nada. Dibujar presets de Arduino queda como trabajo aparte.

## [0.3.64] — 2026-08-19

El bot ofrece el código en vez de pegarlo siempre, y pregunta siempre si lo carga.

### Cambiado
- **Ya no muestra automáticamente cuarenta líneas de C++**: pedido explícito de un docente probando el bot con un alumno en mente — "eso confunde, que lo haga y ofrezca mostrarlo, y que siempre pregunte si lo sube". Ahora, al compilar, cuenta en dos o tres líneas en criollo qué hace el programa y ofrece en un solo mensaje mostrarlo y cargarlo. Sigue pegando el código sin preguntar en cuatro casos donde el código ES la respuesta: cuando lo piden, cuando la pregunta era sobre el código, en ejemplos de tres o cuatro líneas, y cuando no compila. La pregunta de si carga a la placa se simplificó a "siempre, apenas el código está listo" (antes sólo en pedidos que sólo tenían sentido andando) — lo que sigue prohibido es cargar sin preguntar, porque es una acción física sobre hardware que puede quemarla si el circuito está mal armado.

## [0.3.63] — 2026-08-19

El alias del modelo apuntaba a una versión que las cuentas nuevas de Google ya no pueden usar.

### Arreglado
- **`google/gemini-flash-lite-latest` resolvía a la 2.5**, que Google dejó de dar a cuentas nuevas ("no longer available to new users"). Andaba perfecto en máquinas con una key vieja y fallaba en todas las keys nuevas — apareció la noche antes de una capacitación, cuando un docente sacó una key recién creada, y no había forma de haberlo visto probando: la máquina de prueba tenía key vieja. Se fija la versión explícita `gemini-3.5-flash-lite`, verificado contra la API directamente y contra el catálogo de modelos de OpenCode. Regla nueva, ahora un test: el modelo se fija, no se usa un alias — un alias es una dependencia que cambia sola, sin quedar registrada en ningún commit.

## [0.3.62] — 2026-08-19

El bot decía "listo" después de compilar, y el docente lo entendía como "ya está en la placa".

### Arreglado
- **Reporte real: "le dije que encienda un LED, dice que lo hace, y nada"**. No había ningún mock — el bot compilaba tal cual el prompt se lo pedía, y no cargaba a la placa (decisión correcta, que se mantiene: cargar es una acción física, y si el circuito está mal armado puede quemar el hardware). El problema era la comunicación: cerraba con "listo" a secas, el docente lo leía como "ya anda", miraba el LED apagado y concluía que el bot no servía. Ahora tiene prohibido cerrar sin las dos partes: que compiló bien Y que todavía no está en la placa, ofreciendo cargarlo. Y si piden algo que sólo tiene sentido andando ("que el LED parpadee"), pregunta antes de compilar si lo carga.

## [0.3.61] — 2026-08-19

El bootstrap deja su propio log de instalación.

### Nuevo
- **`{app}\instalacion.log`**: Inno cierra la consola del bootstrap al terminar, así que si algo fallaba el único rastro era un número de salida en el log de Inno — hubo que adivinar en qué paso murió el instalador en dos máquinas con tiempos de falla muy distintos (2,4 s contra 41 s), probando y descartando cuatro de cinco hipótesis sin poder confirmar la del antivirus. Ahora un transcript completo queda grabado y el diagnóstico lo muestra primero: la próxima vez no hace falta adivinar, se lee.

## [0.3.60] — 2026-08-19

El lanzador completa la instalación solo, si quedó a medias.

### Nuevo
- **Autocompletado en el lanzador**: en una notebook real el instalador terminó, mostró su pantalla verde de éxito, y no había instalado nada — el paso automático murió en 2,4 segundos, y el mismo script corrido a mano dos minutos después instaló todo perfecto en dos minutos (hipótesis más probable, sin confirmar: el antivirus escaneando el archivo recién escrito). Ahora, si al abrir el acceso directo falta OpenCode o la capa educativa, el lanzador corre el bootstrap él mismo, una sola vez y no en bucle, avisando en castellano que la instalación se está completando. Verificado en la VM con el caso peor (sin bootstrap, sin OpenCode, sin capa): 13 segundos y quedó todo instalado sin que el docente tipeara nada. Tests: 113.

## [0.3.59] — 2026-08-19

El instalador buscaba OpenCode sólo por el shim, y con el binario ya instalado igual decía que faltaba.

### Arreglado
- **Scoop instala en dos tiempos** (extrae el programa y arma el enlace `current`, y recién después crea el shim de 20 KB) y, si aborta en el medio, puede quedar todo menos esa pieza chiquita. Tanto el lanzador como el bootstrap buscaban únicamente el shim, así que un docente con los 180 MB del programa ya en el disco veía "No se encontró OpenCode". Ahora el lanzador prueba tres lugares (PATH, shim, binario directo) y el bootstrap, si sólo falta el shim, lo escribe en vez de reinstalar de cero — evita bajar 57 MB para recuperar 20 KB, una diferencia que en un aula con la red saturada es la clase entera. Verificado reproduciendo el estado exacto: shim reparado en 4,2 segundos sin bajar nada.

## [0.3.58] — 2026-08-19

La reparación automática podía desinstalar un OpenCode que andaba bien.

### Arreglado
- **Una notebook que funcionaba quedó sin OpenCode después de correr el instalador**: la reparación automática de la v0.3.50 hacía `scoop uninstall` antes de reinstalar, y era la única operación de todo el instalador capaz de dejar la máquina peor de como estaba — con un falso negativo de `Test-OpenCode` (ya documentadas dos formas de que pase) desinstalaba algo sano, y si la reinstalación fallaba por red, el docente se quedaba sin nada. Además era innecesario: `scoop install` ya purga solo las instalaciones fallidas, sólo cuando hace falta. Regla nueva, ahora escrita como test: el instalador puede fallar, pero no puede romper — ningún `scoop uninstall`, ningún `Remove-Item` sobre Scoop.

## [0.3.57] — 2026-08-19

Una regresión propia hacía abortar la instalación completa si sólo fallaba OpenCode.

### Arreglado
- **Encontrado por una pregunta del usuario**: "¿qué diferencia hay con la v0.3.19, que esa se instalaba sin problemas?". Tenía razón: la v0.3.19 nunca cortaba si OpenCode fallaba, y seguía instalando la capa educativa (copia pura de archivos, sin red, que no falla nunca). Los cuatro cortes agregados después con la idea de "un instalador que dice OK sin verificar es peor que uno que falla" convirtieron avisar en abandonar, y el corte de OpenCode quedó antes que la capa — el resultado real en una notebook fue una máquina sin agente, sin skills y sin fichas: dos problemas en vez de uno. Ahora el fallo de OpenCode se anota y se sigue instalando la capa; el aviso va al final, donde se lee. El test que debía cuidar esto estaba al revés (exigía que el instalador cortara) y se dio vuelta. De paso apareció un `\a` mal escapado que convertía una ruta en un carácter de campana invisible — no se ve en ningún editor, el script parsea, y falla en silencio. Se agregó un guard que prohíbe caracteres de control en `.ps1`/`.cmd`. Tests: 111.

## [0.3.56] — 2026-08-19

Un `auth.json` con BOM dejaba máquinas muertas para siempre, sin que ninguna reinstalación lo notara.

### Arreglado
- **El bug detrás de "andaba y ahora no"**: versiones anteriores a la v0.3.55 escribían las credenciales con `Set-Content -Encoding UTF8`, que en PowerShell 5.1 mete BOM. PowerShell lee ese archivo con `Get-Content -Raw` y le saca el BOM solo, así que al instalador el archivo le parecía perfecto; OpenCode lo lee con `JSON.parse`, que rechaza el BOM y se traga el error sin avisar nada — el bot abría con logo y agente y fallaba recién al primer mensaje. Arreglar sólo la escritura (v0.3.55) no alcanzaba: las máquinas ya infectadas seguían infectadas, porque el instalador concluía "ya está configurado" y no tocaba nada — reinstalar no servía, actualizar tampoco. Ahora se miran los bytes del archivo antes de decidir, que es lo único que ve OpenCode: si aparece la firma del BOM, se reescribe conservando la key del docente. Encontrado instalando de cero en una VM y notando que `auth.json` tenía fecha de una semana antes que el resto de los archivos: la instalación nueva lo había respetado, cortésmente, por séptima vez. Tests: 110.

## [0.3.55] — 2026-08-19

Cinco bloqueos silenciosos del instalador, encontrados por auditoría antes de una capacitación.

### Arreglado
- **Cinco causas de instalaciones fallidas en una notebook real**, con el paquete completo y verificado byte a byte (132 archivos) contra la metadata del `.exe`: la variable `SCOOP_ALLOW_ADMIN_INSTALL` sólo se seteaba si Scoop no estaba instalado, así que un reintento "como administrador" (lo natural después de un primer fallo) entraba en un bucle determinista que cada vez dejaba la máquina peor. Las credenciales se escribían con BOM y `JSON.parse` las rechazaba en silencio. `Test-OpenCode` daba falso negativo con cualquier aviso por stderr aunque el exit code fuera 0, disparando reinstalaciones sobre instalaciones sanas. En CPUs sin AVX2, el binario normal de OpenCode revienta con "Illegal instruction" y la reparación reinstalaba el mismo binario para siempre — ahora se distingue "no está" de "está y revienta" y se baja al build baseline. Y el lanzador usaba `where`, que sólo mira si el archivo existe: con el binario mutilado por el antivirus la ventana se cerraba sola sin decir nada, el mismo síntoma que se había reportado desde el aula. Tests: 109.

## [0.3.54] — 2026-08-19

Cinco de las diecisiete fichas ahora son HTML animado, y pesan menos.

### Nuevo
- **Fichas animadas**: la alterna, las señales, el LDR, el PIR y el relé pasan de PDF a HTML — hay conceptos de esa colección que sólo se entienden viéndolos moverse. De paso el payload de fichas baja de 5,6 a 4,5 MB comprimido (1,22 MB contra 1,75 del PDF, en esas cinco). Los PDF siguen en el repo para imprimir desde archivo.

### Arreglado
- **El fixture de test de fichas usaba una lista escrita a mano con extensión `.pdf`**: al pasar cinco fichas a HTML, la carpeta cambió pero la lista siguió mintiendo, y los 106 tests pasaban en verde describiendo un producto que ya no existía. Ahora lee la carpeta real. También faltaba un test que atara el tool al filtro real por extensión — con el filtro roto, el docente pedía la ficha del LDR y el bot contestaba que no había ninguna, sin tirar error. Tests: 107.

## [0.3.53] — 2026-08-18

Dos instalaciones a la vez se pisaban entre sí y rompían OpenCode para todos los intentos siguientes.

### Arreglado
- **Medido, no supuesto**: arrancar dos instaladores con dos segundos de diferencia dejaba dos `bootstrap.ps1` corriendo `scoop install opencode` en paralelo sobre los mismos archivos — de ahí salía el "ERROR 'opencode' isn't installed correctly" que después aparecía en TODOS los intentos siguientes, incluso en instalaciones limpias. Y era fácil de provocar: el lanzador, si se abría durante la instalación, invitaba a "volver a correr el instalador" — hacerle caso lo rompía. Ahora un `SetupMutex` bloquea la segunda instancia; verificado repitiendo el mismo ataque, de 2 bootstraps simultáneos a 1. Además, de una auditoría del instalador: se restringe a `x64compatible` (OpenCode no distribuye binario de 32 bits, y sin esto el error aparecía recién después de copiar toda la capa), se declara `MinVersion=10.0`, el desinstalador ahora borra la carpeta completa en vez de dejar restos, las descargas reintentan (3 intentos, con pausas de 2 y 4 s), se fuerza TLS 1.2 explícito, y se publica `SHA256SUMS.txt` con cada release — el `.exe` no está firmado, así que hoy es la única forma de comprobar que nadie lo tocó en el camino.

## [0.3.52] — 2026-08-18

La marca de "instalación en curso" se creaba demasiado tarde para proteger una actualización.

### Arreglado
- **El arreglo de la v0.3.51 no se protegía a sí mismo en su propia instalación**: la marca `.instalando` se creaba en `[Run]`, que cubre una instalación limpia pero no una actualización — que es el caso más común. En una máquina que ya tenía Tecnia Bot, el acceso directo anterior está vivo desde el segundo cero, y al instalar la v0.3.51 (la que traía el arreglo) el lanzador todavía en disco era el de la v0.3.50, que no sabía nada de marcas. Ahora la marca se crea en el instalador mismo, en `CurStepChanged(ssInstall)`: se dispara al apretar "Instalar" y antes de copiar un solo archivo.
- **Versionado invisible fuera de "Agregar o quitar programas"**: pedido del usuario, con razón — hubo que identificar la versión de un docente contando bytes del archivo contra el asset del release. Ahora el `.exe` declara `VersionInfoVersion`, `ProductName` y `Description`, y el lanzador muestra la versión en todas sus pantallas, incluida la de error. Tests: 106.

## [0.3.51] — 2026-08-18

El acceso directo se podía abrir antes de que la instalación terminara.

### Arreglado
- **Medido en una VM: el acceso directo queda clickeable a los 0,9 segundos**, cuando la instalación recién va a empezar a bajar los 57,7 MB de OpenCode — y en una notebook de escuela esa ventana son minutos, no segundos. Abrirlo mostraba "No se encontró OpenCode. Volvé a correr el instalador de Tecnia Bot" MIENTRAS el instalador seguía corriendo, empujando a arrancar una segunda instalación encima de la primera — le pasó a una persona real, que pensó que el problema era su máquina. Ahora el instalador deja una marca mientras trabaja y el lanzador espera a que desaparezca antes de abrir el bot, con techo de 20 minutos. De paso, el guard de caracteres no-ASCII se extendió a `.cmd`/`.bat` (mismo problema de codepage OEM que en los `.ps1`), y encontró dos archivos más con tildes, incluido `installer/compilar-en-windows.ps1`. Tests: 103.

## [0.3.50] — 2026-08-17

El instalador repara solo un OpenCode a medio instalar, en vez de mandarle comandos al docente.

### Nuevo
- **Reparación automática**: OpenCode puede quedar a medias por una descarga cortada, un hash que no da o un antivirus que pone el `.exe` en cuarentena — nada raro con internet flojo en una escuela. Antes el instalador cortaba y mostraba dos líneas de PowerShell para copiar y pegar; le pasó a una persona real, en una notebook real, que estuvo un rato largo creyendo que el problema era su máquina. Ahora intenta reparar una vez (no en loop) y vuelve a verificar, sin preguntarle nada al docente porque el instalador también corre en modo silencioso, donde un prompt cuelga para siempre. El cambio de fondo: se dejó de preguntar "¿existe el archivo?" y se pasó a "¿corre el programa?" (`opencode --version`) — un shim que apunta a una carpeta vacía existe igual, y el instalador decía OK sobre eso.

## [0.3.49] — 2026-08-17

El instalador de la v0.3.48 no parseaba en Windows y no instalaba nada.

### Arreglado
- **Regresión introducida por la v0.3.48**: los mensajes nuevos de verificación de errores trajeron tildes y una raya larga, y el `.ps1` sin BOM lo lee Windows PowerShell 5.1 como cp1252 — cada carácter multibyte de UTF-8 desalineaba el parser, y el script directamente no compilaba ("Falta la cadena en el terminador"). El instalador se veía normal, decía que había terminado, y no instalaba absolutamente nada: ni Scoop, ni OpenCode, ni PlatformIO, ni la capa educativa. Se sacó todo el no-ASCII de `bootstrap.ps1` e `install.ps1`, verificado con el tokenizador real de PowerShell (`PSParser::Tokenize`). Se agregó `tests/scripts-ps1.test.mjs`, que no existía: se probaba TypeScript, prompts y skills, pero el instalador —lo primero que toca un docente— no tenía una sola línea de verificación.

## [0.3.48] — 2026-08-17

El instalador decía "[OK] instalado" sin haber verificado nada.

### Arreglado
- **Encontrado instalando en una notebook Windows 10 real**: Scoop terminó con "ERROR 'opencode' isn't installed correctly" y el bootstrap igual imprimió "[OK] OpenCode instalado" arriba de ese error, siguió instalando PlatformIO y la capa educativa, y avisó que todo había terminado — el docente se enteró recién al abrir el acceso directo, sin ninguna pista de qué había pasado ni dónde mirar. Los tres pasos (Scoop, el instalador de OpenCode, PlatformIO) compartían el mismo defecto: ninguno miraba `$LASTEXITCODE` ni comprobaba que el binario existiera. Ahora Scoop corta si no quedó instalado (sin él, todo lo que sigue produce errores en cascada que no dicen cuál fue el primero), OpenCode corta con los dos comandos exactos para limpiar y reintentar, y PlatformIO avisa pero no corta — sin él el bot igual explica, dibuja circuitos y reparte fichas, sólo no compila. Tests: 94.

## [0.3.47] — 2026-08-17

Las 17 fichas pesan 2,2 MB menos, sin sacar ni cambiar nada.

### Cambiado
- **Se evaluó pasar los PDF a HTML para bajar peso, y medido resultó peor**: PDF 7,8 MB contra HTML 9,3 MB (el HTML lleva fuentes y fotos embebidas). El problema real no era el formato: el 92% del peso eran las imágenes, a 1900 px cuando el retrato se imprime en 93 mm — 1100 px a 300 dpi alcanza de sobra. Recomprimidas a lo necesario, las hojas bajan de 7,8 a 5,6 MB, verificado mirando el papel: el mismo detalle ampliado al 300% del tamaño impreso, antes y después, y los rótulos de la placa se leen igual. Las 17 siguen entrando en una hoja con los mismos márgenes al milímetro.

## [0.3.46] — 2026-08-17

El bot compilaba sin haber armado el proyecto de PlatformIO.

### Arreglado
- **Regresión abierta por la v0.3.44**: al agregar "compilá siempre antes de mostrar", el bot pasó a chocar en cada pedido de código en una carpeta nueva con `NotPlatformIOProjectError: Not a PlatformIO project` — sin traducir, en inglés crudo. PlatformIO no compila un archivo suelto: necesita `platformio.ini` con la placa y el código en `src/main.cpp`, y el prompt no lo mencionaba ni una vez pese a que los skills de Arduino y ESP32 ya tenían las plantillas. Ahora el prompt arma los dos archivos antes de compilar, y para escribir el `board` correcto mira primero el perfil del docente y, si no está, pregunta una vez y lo guarda — elegir mal el board no da un error claro, da uno de compilación que parece del código. Tests: 89.

## [0.3.45] — 2026-08-17

Una auditoría completa encontró datos eléctricos que podían quemar hardware.

### Arreglado
- **Datos que podían quemar hardware, todos corregidos**: el LCD I2C decía "SDA/SCL tolerante" a 5V en ESP32, y no lo son; "corriente máxima por pin: 40 mA" comparaba el máximo absoluto del UNO contra el umbral de aviso del ESP32; "GPIO32-39 solo entrada" era falso para el 32 y el 33; GPIO2, 12 y 15 figuraban como seguros para principiantes siendo strapping pins (GPIO12 en HIGH al arrancar impide el booteo); un display de siete segmentos estaba cableado en "GPIO 16..23" (ocho números para siete segmentos, y uno que no existe en la placa); y siete fichas dejaban el bus de alimentación sin decidir entre 5V y 3V3, con un LED sin resistencia y un buzzer directo al pin.
- **Cuatro callejones sin salida**: presets de protoboard que existían pero estaban apagados por una frase del prompt; el catálogo rechazaba componentes con tilde que el propio prompt enumera acentuados; faltaba la librería de MQTT que necesitan 13 de los 15 proyectos; y nadie reconocía el "Brownout detector was triggered" que aparece al conectar un servo.
- **El QA adversarial encontró una regresión propia**, más tres tests que pasaban con y sin el arreglo por hacer asserts sobre el texto fuente en vez de sobre el comportamiento — corregidos y verificados por mutación. Tests: 87 (34 al empezar el día).

## [0.3.44] — 2026-08-17

Detección real de placa conectada, y el código se compila siempre antes de mostrarlo.

### Arreglado
- **El diagnóstico dice qué hay conectado, no cuántos puertos ve**: antes contaba un COM1 de máquina virtual como "dispositivo conectado". `detectPort` ya no elige un puerto que no es placa, y si hay una placa enchufada sin driver, lo dice y da el link (CH340). El código ahora se compila SIEMPRE antes de mostrarlo; cargarlo a la placa lo sigue decidiendo el docente. De paso, `Cmd+P` en Mac, y el mensaje de la ficha ya no promete que la ventana se abrió cuando no se abrió. Tests: 73 (34 al empezar el día).

## [0.3.43] — 2026-08-17

El tool `ficha` estaba denegado por el agente, y por eso no andaba.

### Arreglado
- **El peor tipo de defecto: todo parecía bien**. El agente arranca con `"*": "deny"` y una lista blanca de tools permitidos, y `ficha` nunca entró en esa lista — el tool que se escribió, testeó, empaquetó y publicó en la v0.3.41 directamente no podía ejecutarse. Explica exactamente lo que se había visto probando: el modelo agarrando `read` sobre el PDF y después `webfetch` con `file://` no estaba improvisando, eran los dos únicos tools que sí tenía permitidos para eso. El archivo existía, los tests pasaban, el skill lo mencionaba, el `.exe` lo llevaba adentro — faltaba una sola línea de permiso, y nada la señalaba. Se agregó `tests/permisos.test.mjs`, que compara los `.ts` de tools reales contra los "allow" del frontmatter del agente y falla si falta alguno, o si sobra uno de un tool borrado. Verificado por mutación: sacar el permiso de `ficha` da fail 1, con el nombre en el mensaje. Tests: 54.

## [0.3.42] — 2026-08-17

El bot intentaba leer el PDF de la ficha en vez de abrirlo, y ahora abre siempre en el navegador.

### Arreglado
- **El modelo leía el PDF directamente**: sin el tool instalado, probó `read` sobre `09-ldr.pdf` (36 segundos parseando binario sin obtener nada) y después `webfetch` con `file://`, que también falló. La descripción del tool y el skill ahora lo prohíben explícitamente — decir qué hacer no alcanza si no se dice también qué no.
- **Las fichas ahora abren en el navegador, no en el lector de PDF asociado**: para que sea la misma experiencia que ya usa `imprimible`, y porque un navegador siempre está instalado, mientras que un lector de PDF dedicado puede no estarlo en una PC de escuela. Prueba primero con `file://` (fuerza el navegador) y si falla cae a la ruta pelada; en Windows la ruta se convierte (`C:\x\f.pdf` → `file:///C:/x/f.pdf`). Tests: 51, con dos nuevos: la conversión de ruta y un guard contra que la prohibición de leer el PDF se caiga de la descripción.

## [0.3.41] — 2026-08-17

El ejemplo del tool de fichas se sumó a donde el docente lo puede descubrir.

### Cambiado
- **Una capacidad que nadie sabe que existe no existe**: sin subir VERSION, el tool nuevo de la v0.3.40 no le llegaba a nadie — `/actualizar` compara contra el VERSION de main, así que el bot habría contestado "ya estás al día" y el docente se quedaba con el comportamiento viejo. Se agrega el ejemplo a la lista "Probá:" del README y al resumen que muestra `/ayuda` dentro del bot.

## [0.3.40] — 2026-08-17

Las 17 fichas de Tecnia Lab entran al instalador.

### Nuevo
- **Primer release con las 17 hojas A4 dentro del `.exe`**: el docente instala y ya tiene el material para imprimir, sin descargar nada aparte.

### Arreglado
- **El `.exe` se rotulaba con el tag y no con VERSION**: un tag desalineado producía un instalador que dice una versión y un release que dice otra, y como no rompe nada, nadie lo nota hasta que alguien reporta un bug de una versión que no existe. `tests/version.test.mjs` cuida los archivos del repo, pero el tag sólo se puede mirar en el workflow, cuando existe — ahora `build-installer.yml` compara `github.ref_name` contra VERSION y falla antes de compilar. Tests: 39.

## [0.3.39] — 2026-08-13

Nuevo skill: Diseño Curricular oficial de San Juan, como única fuente de verdad.

### Nuevo
- **Skill `diseno-curricular`**: contenido real del [Diseño Curricular Jurisdiccional oficial de San Juan](https://educacion.sanjuan.edu.ar/mesj/LinkClick.aspx?fileticket=pYa3KUrdkgo%3d&tabid=662&mid=1688) (Primer Ciclo de Educación Secundaria, Modalidad Técnico Profesional) — información pública del Ministerio de Educación. Extraído leyendo el PDF oficial completo (241 páginas), no resumido de memoria: `marco-general.md` (fundamentación, perfil del egresado, estructura curricular, carga horaria) + 45 fichas de espacios curriculares/talleres, organizadas por campo de formación (Formación General, Científico Tecnológica, Técnica Específica Industrial y Agrotécnica). Cada archivo cita la fuente oficial y define explícitamente qué es un "DC" — nada implícito. Donde el documento no aclaraba algo (ej. reparto de horas entre talleres del mismo año), se dejó anotado como nota de fidelidad en vez de inventarlo.
- **Regla crítica nueva en el agente**: el diseño curricular de una provincia cargada es su ÚNICA fuente de verdad — nunca completa con conocimiento general ni busca en internet. Diseñada para crecer: agregar otra provincia es sumar una carpeta nueva, sin tocar código.

## [0.3.38] — 2026-08-13

Arreglado: `/actualizar` podía quedarse trabado si algún archivo instalado tenía cambios locales.

### Arreglado
- **`/actualizar` (instalación por `git clone`) podía fallar sin avisar bien**: si algún archivo instalado (ej. `install/install.ps1`) tenía modificaciones locales por lo que sea, `git pull --ff-only` se rompía con un error crudo en inglés que la tool no traducía — el usuario veía respuestas confusas o "ya estabas al día" incorrecto. `install/update.ps1` e `install/update.sh` ahora descartan cualquier cambio local en los archivos instalados (`git reset --hard` + `git clean`) y se aseguran de seguir la rama `main` antes de tirar del pull — así nunca se rompe por esto. No afecta a instalaciones por `.exe` (esas no usan git, siempre sobreescriben directo).
- **Gotcha de PowerShell nuevo, mismo patrón que ya vimos con `Read-Host`/`Task.Wait`**: los mensajes puramente informativos de `git` (ej. `"Already on 'main'"`) van por stderr, y con `$ErrorActionPreference = "Stop"` (seteado en el script), PowerShell los toma como error fatal aunque el comando haya andado bien. Se baja la preferencia a `"Continue"` solo para los pasos de limpieza best-effort; el `pull` real sigue fallando fuerte si algo anda mal de verdad.

## [0.3.37] — 2026-08-12

Nueva página de la API key en el micro-sitio + aviso en el splash si falta o es la de respaldo.

### Nuevo
- **Página `api-key.html` en el micro-sitio de `/ayuda`**: guía completa de la API key de Google — por qué hace falta, cómo conseguirla (con botón directo a `aistudio.google.com/apikey`), cómo ponerla, y un acordeón de troubleshooting (Invalid API key, el instalador no la pidió, 429 Too Many Requests). Linkeada desde el menú de Inicio y Proyectos.
- **Aviso inteligente en el splash de OpenCode**: el plugin `tecnia-logo.tsx` ahora detecta el estado real de la key guardada (ninguna / la de respaldo compartida de la v0.3.36 / una propia) leyendo `auth.json` directamente. Si falta o es la compartida, el tip de abajo del splash **siempre** muestra la URL directa y el aviso (con la etiqueta "Importante" en vez de "Tip") — no hace falta que el usuario sepa buscarlo, se lo dice el bot apenas abre. Con key propia ya puesta, no molesta: vuelve al tip aleatorio de siempre. Probado en real (los 3 estados) contra el opencode local: ningún crash en ninguno.

## [0.3.36] — 2026-08-12

Key de respaldo hardcodeada en el instalador — decisión explícita del equipo, con el riesgo documentado.

### Cambiado
- **Si nadie pega su propia API key durante la instalación, ahora se usa una key de respaldo hardcodeada** en `install.ps1`/`install.sh`, para que la instalación quede usable sin fricción para el equipo. Esto fue pedido explícitamente después de que se explicara el riesgo (esta key queda pública en el repo, Google escanea repos públicos y puede revocarla — visto en la sesión de investigación de la v0.3.33). Cada persona sigue pudiendo pegar la suya propia en el mismo prompt para no depender de la de respaldo. No reemplaza la recomendación de que cada instalación real (fuera del equipo de prueba) use su propia key.

## [0.3.35] — 2026-08-12

El instalador ahora pide la API key de Google directo, sin pasar por `/connect`.

### Nuevo
- **El instalador (`install.ps1`/`install.sh`) pregunta por la API key de Google al final de la instalación**, en vez de dejarlo como un paso manual con `/connect` dentro de OpenCode. Motivo: repartir una única key propia entre varias personas/escuelas comparte cuota y arriesga que Google la revoque si termina en un repo público — con esto, cada instalación pone la suya, en 30 segundos, sin tocar el repo para nada. Detalles:
  - **Idempotente**: si ya hay una key de `google` guardada (de esta instalación o de un `/connect` manual previo), no se vuelve a preguntar en cada `/actualizar`.
  - **Opcional**: si no la tenés a mano, Enter y seguís — se puede agregar después con `/connect`.
  - **Con timeout de 60s**, pensado para que un deploy desatendido a varias PCs (con la consola visible pero nadie tipeando) no se quede colgado para siempre esperando una tecla.
  - La key se guarda **solo en el archivo local de credenciales de OpenCode** — nunca en este repo, nunca en git.

## [0.3.34] — 2026-08-12

Ajustes de prompt: reforzar "ejecutá la tool, no la describas" y prohibir `webfetch` con archivos locales.

### Cambiado
- **Refuerzo de "EJECUTÁ la tool, nunca la describas"** en `tecnia-bot.md`: en sesiones largas el agente a veces terminaba **narrándole** al usuario cómo usaría una tool ("podés usar el tool platformio con la acción...") en vez de **llamarla**, sobre todo con `platformio` — la única mención de esa tool en todo el prompt no tenía contraejemplo ni refuerzo, y quedaba en el medio del archivo (zona de menor adherencia por "lost in the middle"). Se agregó una **regla crítica nueva al principio** del prompt (efecto primacía) que prohíbe explícitamente narrar en vez de ejecutar, con ejemplos concretos de qué NO decir; se reforzaron puntualmente `platformio`, `memoria` y `perfil` en el lugar exacto donde el modelo decide; y se reescribió la sección `## Limitaciones` (el cierre del archivo, efecto recencia) en modo imperativo — antes usaba voz descriptiva ("usás el tool circuito", "guardás el perfil con..."), que sin querer modelaba el mismo estilo de la falla.

### Arreglado
- **`webfetch` con rutas `file://` locales** (issue [#2](https://github.com/programadores-obreros/Agente-editor-inet/issues/2)): el agente a veces intentaba reabrir un `.html`/`.pdf` ya generado (circuito, imprimible) llamando a `webfetch` con la ruta local del archivo, que solo acepta `http(s)://` y fallaba. Se agregó una instrucción explícita: para reabrir un archivo ya generado, decile al usuario la **ruta exacta** y pedile que haga **doble clic** para abrirlo con el navegador del sistema — `webfetch` con rutas locales/`file://` queda **explícitamente prohibido**.

## [0.3.33] — 2026-08-11

El modelo por defecto ahora es Google Gemini Flash-Lite, no DeepSeek vía OpenCode Zen.

### Cambiado
- **Modelo por defecto del agente**: `opencode/deepseek-v4-flash-free` (OpenCode Zen) → `google/gemini-flash-lite-latest` (Google AI Studio). DeepSeek Free tenía una cuota gratis anónima **no documentada** que fallaba de forma intermitente ("Cannot connect to API" y, agotada la cuota, "Invalid API key") — inaceptable para un producto que corre sin supervisión en aulas. Gemini tiene límites de free tier **públicamente documentados** (15 req/min, 1500 req/día), sin tarjeta. Se usa el alias `gemini-flash-lite-latest` (no `gemini-2.5-flash-lite`, que Google ya discontinuó para keys nuevas: *"is no longer available to new users"*) para no repetir el mismo problema con la próxima versión. Esto suma **un paso único post-instalación**: conseguir una API key gratis en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) y conectarla con `/connect` dentro de OpenCode (se guarda para siempre).

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
