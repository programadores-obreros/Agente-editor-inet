# Instalación en Windows

Esta es la plataforma principal de Tecnia Bot, porque es la que más se usa en las escuelas.

> ✅ **Probado en el aula.** El 20 de agosto de 2026 se instaló en decenas de
> máquinas en una capacitación docente. Entró en todas; en una sola quedó afuera
> PlatformIO, y por eso existe `/reparar`.
>
> La nota anterior decía que el instalador «todavía NO se probó en una máquina
> Windows real». Quedó ahí seis meses después de dejar de ser cierta — que es
> justo lo que le pasa a las advertencias: envejecen sin que nadie las mire.

> ⚠️ **Lo que esta guía cuenta de la última pantalla, de "Reparar" y del
> desinstalador es posterior a la 0.4.8 y todavía no pasó por un aula.** Si tu
> `.exe` es de la 0.4.8 o anterior, la última pantalla dice siempre "¡Tecnia Bot
> quedó instalado!", haya salido como haya salido: en ese caso, para saber cómo
> quedó, abrí **"Diagnostico de Tecnia Bot"** desde el menú inicio.

## Requisitos

- **Windows 10 versión 1809 (octubre de 2018) o más nueva, o Windows 11, de
  64 bits.** Para saber cuál tenés: tecla Windows + R, escribí `winver` y Enter;
  o Configuración > Sistema > Acerca de.
- Windows 7, 8, 8.1 y un Windows 10 sin actualizar **no sirven**: OpenCode, el
  programa sobre el que funciona Tecnia Bot, no arranca ahí. No es algo que un
  instalador pueda arreglar.

**Mirá la versión ANTES de instalar**, y es importante por esto: hoy el
instalador frena a Windows 7, 8 y 8.1 (con el cartel *"Este programa requiere
Windows versión 10.0 o posterior"*), pero **a un Windows 10 anterior a la 1809 lo
deja instalar sin quejarse** — y después Tecnia Bot no abre. Si `winver` dice
"Versión 1803" o menos, actualizá Windows primero.

En cualquier caso, correr el `.exe` en una máquina que no sirve no rompe nada.

<!-- Cuando se implemente D-05, el instalador va a detectar la compilación y
     explicar qué Windows encontró y qué opciones hay. Recién entonces cambiar
     este párrafo. Antes de eso, prometerlo acá sería mentirle a la docente. -->

> Para escuelas con máquinas de Windows 7 —qué se evaluó y qué alternativas
> hay— está la decisión [D-05 en `docs/decisiones.md`](decisiones.md#d-05--windows-7-no-se-soporta-y-el-instalador-lo-dice-con-nombre-y-apellido).

## 🟢 Súper fácil — instalador `.exe` (recomendado para docentes)

Es lo más parecido a instalar cualquier programa: descargás **un** archivo, doble
clic, y "Siguiente → Siguiente → Instalar". No hace falta git, ni PowerShell, ni
pegar comandos.

1. Entrá a [**Releases**](https://github.com/programadores-obreros/Agente-editor-inet/releases)
   y descargá **`Instalar-Tecnia-Bot.exe`** de la última versión.
2. Doble clic. Si Windows muestra un aviso azul (**SmartScreen**, porque el `.exe`
   no está firmado), tocá **"Más información" → "Ejecutar de todas formas"**.
3. Seguí el asistente. Instala todo solo **sin pedir contraseña de
   administrador** (qué instala exactamente está [más abajo](#qué-instala-de-verdad)).
   Tarda varios minutos y se ve una ventana negra con texto corriendo: es normal,
   está trabajando. **En esa ventana negra te pregunta por la API key de Google**:
   si no la tenés, apretá Enter (**Paso 4**).
4. **Leé la última pantalla.** Ya no dice siempre lo mismo: dice cómo quedó.
   Las tres posibles están en la sección que sigue.
5. Abrí **Tecnia Bot** desde el **menú inicio** (o el escritorio).
6. Falta un paso que ningún instalador puede hacer solo: los **drivers USB** de
   la placa (**Paso 3** de más abajo).

> El `.exe` lo compila GitHub Actions en cada versión (no se sube a mano). Si no ves
> el archivo en Releases, corré el workflow **"Instalador Windows (.exe)"** desde la
> pestaña *Actions* del repo.

### La última pantalla: tres finales posibles

El instalador mira cómo terminó la instalación de verdad y la última pantalla
lo dice. El título es lo que hay que leer:

| Título de la última pantalla | Qué pasó | Qué hacer |
|---|---|---|
| **¡Tecnia Bot quedó instalado!** | Se comprobó todo: OpenCode arranca, PlatformIO y Node contestan, y la capa de Tecnia Bot está en su lugar | Nada. Abrilo |
| **Tecnia Bot quedó instalado, pero incompleto** | El bot abre, pero faltó algo: PlatformIO (no va a compilar ni cargar a la placa), Node (no anda el skill de diagramas), la versión probada de OpenCode, o parte de la configuración | Menú inicio → **"Reparar Tecnia Bot"**. La pantalla te dice dónde quedó escrito qué faltó |
| **Tecnia Bot NO quedó instalado** | Se copiaron los archivos, pero OpenCode o la capa no quedaron. Antes de esta pantalla aparece además un cartel de error que lo explica | Menú inicio → **"Reparar Tecnia Bot"**. **No hace falta volver a bajar el instalador.** Si vuelve a fallar, **"Diagnostico de Tecnia Bot"** dice por qué |

Si la instalación no quedó bien, la casilla *"Abrir Tecnia Bot ahora"* no
aparece: no se ofrece abrir algo que no se comprobó que abra.

### "Reparar Tecnia Bot": la salida para casi todo

En el menú inicio quedan **cuatro** accesos:

| Acceso | Para qué |
|---|---|
| **Tecnia Bot** | Abrir el bot |
| **Reparar Tecnia Bot** | Volver a correr la instalación: completa lo que falte y no toca lo que ya está |
| **Diagnostico de Tecnia Bot** | Ver qué anda y qué no, aunque el bot no abra. Deja un archivo en el Escritorio para mandarnos |
| **Desinstalar Tecnia Bot** | Sacarlo (ver [Desinstalar](#desinstalar)) |

**Ante casi cualquier problema, lo primero es "Reparar Tecnia Bot".** Sirve cuando:

- la última pantalla dijo "incompleto" o "NO quedó instalado";
- se cortó la luz o se cerró la ventana a mitad de la instalación;
- al abrir Tecnia Bot aparece un aviso de que falta OpenCode, la capa o PlatformIO;
- al abrir Tecnia Bot aparece un aviso de que **la key de Google no sirve o se
  quedó sin cuota**: Reparar te pide la key nueva y la prueba antes de guardarla;
- querés poner o cambiar la key.

Se puede correr las veces que haga falta. La ventana de Reparar **no se cierra
sola**: queda abierta con el resultado a la vista, y termina con un resumen así:

```
Como quedo (lo que se comprobo, no lo que se intento):
------------------------------------------------------
[OK] OpenCode     arranca, version 1.18.18.
[!]  PlatformIO   NO esta: el bot no puede compilar ni cargar codigo a la placa.
[OK] Node         contesta en ...
[OK] Tecnia Bot   la capa educativa esta publicada en ...
```

Para lo único que Reparar **no** alcanza es para pasar a una versión más nueva
de Tecnia Bot: reinstala la que ya tenés. Para eso está `/actualizar`, o bajar
el `.exe` nuevo y correrlo encima.

### Qué instala de verdad

Todo va a carpetas de tu usuario; nada pide administrador.

| Qué | Para qué | Dónde queda |
|---|---|---|
| **Scoop** | Es el instalador de programas con el que se instala lo demás | `%USERPROFILE%\scoop` |
| **OpenCode** | El programa donde funciona Tecnia Bot. Se instala una versión fija, la que se probó | adentro de Scoop |
| **Python** | Hace falta para PlatformIO. También versión fija | adentro de Scoop |
| **PlatformIO Core** | Compila y carga el programa a la placa | `%USERPROFILE%\.platformio` (o `C:\.platformio` si tu usuario tiene tilde o ñ) |
| **Node.js LTS** | Lo usa un solo skill, el de diagramas de arquitectura. Si ya tenés un Node más viejo que el que ese skill necesita, se instala otro | adentro de Scoop |
| **Las herramientas de ESP32 y Arduino UNO** | Para que la primera compilación no baje nada en clase. **Pesan más de 1 GB**; si hay menos de 3 GB libres, el instalador avisa y no las baja | adentro de la carpeta de PlatformIO |
| **Tecnia Bot** | El agente, las fichas, las herramientas | `%USERPROFILE%\.config\opencode`, y una copia maestra en `%LOCALAPPDATA%\TecniaBot` |

Tus proyectos se guardan aparte, en la carpeta **`Tecnia Bot` de tus
Documentos** (la de verdad: si Windows la tiene en OneDrive, ahí; si la escuela
la tiene en una carpeta de red, se usa la `Documents` de tu usuario). Si Tecnia Bot
no puede entrar a esa carpeta, no abre y te lo dice: es para que tus proyectos
no terminen adentro de la carpeta del programa.

Si falla una descarga —la red de la escuela bloquea una dirección, por ejemplo—
la instalación no se cae entera: sigue con lo demás y lo anota en el resumen.
La excepción es Scoop: sin Scoop no se puede seguir, y lo dice.

### Dónde quedó escrito lo que pasó

La ventana negra de la instalación se cierra sola, así que todo lo que mostró
queda guardado en un archivo:

```
%LOCALAPPDATA%\TecniaBot\instalacion.log
```

Para abrirlo: tecla Windows + R, pegá esa línea y Enter. `instalacion.log` es
siempre **la última corrida** (instalación o Reparar). Las anteriores quedan al
lado con la fecha en el nombre (`instalacion-20261115-103000.log`) y se guardan
las últimas cinco.

Si nos pedís ayuda, lo mejor es **"Diagnostico de Tecnia Bot"**: deja en el
Escritorio un archivo `tecniabot-diagnostico-<nombre de la compu>.txt` y te dice
dónde quedó. Antes de mandarlo leé el aviso que muestra: el archivo lleva tu
nombre de usuario de Windows, el nombre de la compu y rutas de carpetas. **No
lleva tu API key.**

> Para quien instala en muchas máquinas con `/VERYSILENT`: el `.exe` sale con
> `0` (bien), `21` (instalado pero incompleto) o `20` (no quedó usable). La tabla
> completa está en [códigos de salida del instalador](codigos-de-salida-instalador.md).

---

## ⭐ Forma con scripts (si preferís, o si el `.exe` falla)

### Paso 1 — Descargá el proyecto

Con **git**:
```powershell
git clone https://github.com/programadores-obreros/Agente-editor-inet.git
cd Agente-editor-inet
```

Sin git: entrá a [la página del proyecto](https://github.com/programadores-obreros/Agente-editor-inet),
tocá **`Code` → `Download ZIP`**, descomprimí, y abrí PowerShell dentro de esa carpeta.

### Paso 2 — Corré el instalador todo-en-uno

```powershell
powershell -ExecutionPolicy Bypass -File install\bootstrap.ps1
```

Instala **todo lo que falte** (Scoop, OpenCode, Python, PlatformIO, Node.js y Tecnia Bot: la misma
lista de [más arriba](#qué-instala-de-verdad)), en el espacio del usuario: **no hace falta permiso de
administrador** — ideal para las PCs de la escuela. Es exactamente lo que corre el `.exe` por dentro,
y termina con el mismo resumen componente por componente.

### Paso 3 — Drivers USB (para que detecte la placa)

Esto el instalador **no** lo hace. Muchas placas (sobre todo clones y módulos ESP32) usan chips USB
que Windows no reconoce de fábrica:

- **Chip CH340:** driver en https://www.wch-ic.com/downloads/CH341SER_ZIP.html
- **Chip CP2102:** driver en https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers

Si conectás la placa y no aparece en el Administrador de dispositivos, instalá el driver que corresponda y reiniciá.

### Paso 4 — La API key de Google (opcional)

La API key es **opcional**: el instalador termina igual sin ella y elige el modelo según lo que hagas.

- **Sin key** (Enter): Tecnia Bot usa **Big Pickle**, el modelo gratuito de OpenCode. No hace falta cuenta. Es gratis **por tiempo limitado**, y mientras dure esa etapa **OpenCode puede usar el chat para mejorar el modelo**: no pongas datos personales ni nombres de alumnos en la conversación.
- **Con key** (gratis, sin tarjeta): usa **Gemini**, con cuota propia y sin esa cláusula.

> ⚠️ **Lo que recomendamos es la key.** El 25 de septiembre de 2026 registramos
> que Big Pickle, sin cuenta, había dejado de contestar (está en
> [decisiones, D-06](decisiones.md)), y no volvimos a comprobarlo. Si instalaste
> sin key y al primer mensaje ves un error, no rompiste nada: sacá la key y
> corré **"Reparar Tecnia Bot"**.

Para usar Gemini:

1. Entrá a [aistudio.google.com/apikey](https://aistudio.google.com/apikey) con una cuenta de Google y generá una key gratis (podés hacerlo antes, en otra pestaña, mientras corre el instalador).
2. Cuando la ventana negra del instalador te muestre *"API key de Google (OPCIONAL)..."*, pegala y apretá Enter. **Mientras la pegás no se ve nada en pantalla**: es normal, apretá Enter igual. Tenés **60 segundos**; si no contestás, sigue sin key.
3. Si no la tenés a mano en ese momento, apretá Enter: el bot queda en Big Pickle. Para pasar a Gemini después, conseguí la key y corré **Menú inicio → "Reparar Tecnia Bot"**.

**Cuándo te la pide.** Cada vez que corre el instalador con alguien delante: al
instalar con el `.exe` y cada vez que abrís "Reparar Tecnia Bot". No es una sola vez:

- Si **no** hay key guardada, te la pide.
- Si **ya hay** una, te ofrece cambiarla: *"Enter para dejarla como esta, o pega una nueva para reemplazarla"*. Con Enter, o si pasan los 60 segundos, **queda la que estaba**.

No te la pide cuando corre `/actualizar` desde adentro del bot, ni en una
instalación silenciosa (`/VERYSILENT`): ahí no hay nadie a quien preguntarle y
se deja lo que estaba.

**Qué hace con la que pegás.** La prueba contra Google **antes** de guardarla:

| Qué pasó al probarla | Qué hace |
|---|---|
| Google contestó bien | La guarda y Tecnia Bot queda en Gemini |
| Google la rechazó, o lo que pegaste no tiene forma de key | **No la guarda.** Si había una, queda la que estaba |
| Google dice que se acabó la cuota gratis | La guarda (es una key real) y te explica qué hacer |
| No pudo llegar a Google (sin internet, filtro de la escuela) **y ya había una key** | **No reemplaza** la que estaba: no cambia una key que alguna vez anduvo por una que no pudo probar |
| No pudo llegar a Google **y no había ninguna** | La guarda sin probar, y te lo dice así |

Con el bot andando, `/clave` también la prueba y la cambia. Pero si la key está
muerta el bot no contesta, y `/clave` tampoco: por eso los avisos mandan a Reparar.

> 📖 Guía completa (por qué hace falta, qué hacer si deja de andar, cómo reemplazarla): [docs/api-key-google.md](api-key-google.md).

### Paso 5 — Verificá

Abrí **Tecnia Bot** desde el menú inicio y ejecutá `/diagnostico`.

Tiene que arrancar directamente en Tecnia Bot, con su logo violeta: el instalador
lo deja como agente por defecto. Si abre en otro agente, apretá **Tab** hasta
`tecnia-bot` y corré "Reparar Tecnia Bot": eso pasa cuando el instalador no pudo
escribir la configuración, y lo avisa con *"instalado CON AVISOS"*.

---

## Actualizar

Adentro del bot, `/actualizar`. Trae el **último release publicado** (el que
GitHub marca como "Latest"), verifica que lo que bajó sea esa versión, y recién
entonces **reemplaza** la copia del programa. No copia encima: un archivo que la
versión nueva eliminó desaparece también de tu compu. Si algo falla antes de
reemplazar, queda todo como estaba; si falla durante, lo deshace y te lo dice.

Lo que `/actualizar` **no** hace:

- No actualiza OpenCode, Python, PlatformIO ni Node.
- No baja las herramientas de ESP32 y UNO (más de 1 GB): si faltan, avisa.
  Para bajarlas, "Reparar Tecnia Bot" con buena red.
- No reemplaza el lanzador (el archivo que abre el acceso directo) mientras haya
  una ventana de Tecnia Bot abierta con él. Te avisa; para tener el nuevo, cerrá
  Tecnia Bot y corré el `.exe` de esa versión.

Si al terminar dice **"actualizado CON AVISOS"**, los archivos nuevos están pero
no se pudo escribir parte de la configuración: corré "Reparar Tecnia Bot".

---

## Desinstalar

Menú inicio → **"Desinstalar Tecnia Bot"** (o Configuración → Aplicaciones).
No pide administrador. **Cerrá Tecnia Bot antes**: con el bot abierto hay
archivos que no se pueden borrar.

### Qué te pregunta

Dos carteles. El primero es el de siempre: si estás seguro de quitar Tecnia Bot.
El segundo es propio:

> *Además de Tecnia Bot, esta compu tiene guardado el perfil y la memoria del
> aula (…) y, si cargaste una, tu API key de Google. (…) ¿Los querés borrar
> también, junto con el programa? Esto NO se puede deshacer.*

El botón resaltado es **"No"**.

| Si contestás… | Qué pasa |
|---|---|
| **No** | Se va el programa y **quedan** el perfil, la memoria del aula, el registro de cargas y la key. Es lo que conviene si vas a reinstalar |
| **Sí** | Se borran también. Aparece una ventana negra que lo va contando. **Es lo que hay que elegir si la compu se dona, se reasigna o se resetea** |

El desinstalador no confía en que el borrado anduvo: después de borrar **vuelve
a mirar el disco**. Si algo quedó —casi siempre porque Tecnia Bot estaba
abierto— aparece un cartel de error que dice **qué archivos siguen en la compu
y dónde**. Si vas a entregar la máquina, no la entregues sin revisar ese cartel.

En una desinstalación silenciosa (`/VERYSILENT`) no hay carteles y los datos
personales **se conservan siempre**.

### Qué borra

- La capa de Tecnia Bot (agente, skills, herramientas, fichas) de la carpeta de
  configuración de OpenCode, y lo que Tecnia Bot había escrito en esa
  configuración (tema, logo, agente por defecto).
- Los accesos directos.
- La carpeta del programa (`%LOCALAPPDATA%\TecniaBot`), con sus registros de
  instalación. Se borra **por lista**, no se barre entera: si adentro hay algo
  que el instalador no puso —un proyecto guardado ahí por error con una versión
  vieja—, **no se toca** y un cartel te avisa qué quedó y dónde, para que lo
  muevas a Documentos.
- Si contestaste "Sí": el perfil, la memoria del aula, el registro de cargas y
  la key de Google.

### Qué queda instalado

**Desinstalar Tecnia Bot no deja la compu como estaba antes.** Esto sigue en el
disco, a propósito, porque son programas aparte o cosas tuyas:

| Qué queda | Dónde |
|---|---|
| **Scoop**, y adentro **OpenCode**, **Python** y **Node** | `%USERPROFILE%\scoop` |
| **PlatformIO** y las herramientas de las placas (más de 1 GB) | `%USERPROFILE%\.platformio` o `C:\.platformio` |
| **Tus proyectos** | La carpeta `Tecnia Bot` de tus Documentos. No se toca nunca |
| **Lo que OpenCode guarda por su cuenta**: el historial de las charlas, sus registros y sus credenciales | `%USERPROFILE%\.local\share\opencode` |

El script que desinstala busca cada una de estas cosas en el disco y lista las
que encuentra — pero lo hace en la ventana negra, que sólo se ve si contestaste
"Sí" y que se cierra sola. **Por eso la lista está acá.**

**Cómo sacarlo**, si la compu pasa a otra persona y no usás esos programas para
otra cosa:

1. Tus proyectos: copialos a otro lado si los querés, y borrá la carpeta.
2. El historial de OpenCode: borrá la carpeta `%USERPROFILE%\.local\share\opencode`.
   Ahí adentro están las conversaciones.
3. PlatformIO: borrá la carpeta `.platformio`.
4. Scoop con OpenCode, Python y Node: borrá la carpeta `%USERPROFILE%\scoop`.

Este repo **no trae** un script que haga esos cuatro pasos, y no los probamos de
punta a punta: son carpetas del usuario y se borran como cualquier carpeta, pero
no comprobamos qué más deja Scoop (por ejemplo, entradas en el PATH del usuario).

---

## Instalación manual (avanzada, paso a paso)

Si preferís hacerlo a mano (o el bootstrap falló), estos son los pasos que automatiza:

1. **OpenCode** — con Scoop, **la versión que dice `install\OPENCODE_VERSION`** (la única probada con esta versión de Tecnia Bot), y fijala para que `scoop update` no la cambie:
   ```powershell
   scoop install opencode@1.18.18   # reemplazá por lo que diga install\OPENCODE_VERSION
   scoop hold opencode
   ```
   Scoop avisa "Given version ... does not match manifest" y "Attempting to generate manifest": es normal, no es un error. El bootstrap hace exactamente esto.
2. **PlatformIO Core** (no necesita administrador):
   1. Instalá Python desde https://www.python.org/downloads/ (marcá "Add Python to PATH"), o `scoop install python`.
   2. En PowerShell:
      ```powershell
      python -c "$(Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py | Select-Object -ExpandProperty Content)"
      ```
   3. Normalmente queda en `%USERPROFILE%\.platformio\penv\Scripts\pio.exe`. **Si tu usuario de Windows tiene tildes o eñes** (`Dirección310`, `Muñoz`), PlatformIO no soporta rutas con caracteres no-ASCII y se instala solo en la **raíz del disco**: `C:\.platformio\penv\Scripts\pio.exe`. Fijate cuál de las dos te dice el instalador al terminar. Tecnia Bot busca en las dos (y en `PLATFORMIO_CORE_DIR` si la tenés seteada), así que no hace falta tocar el PATH.
3. **La capa de Tecnia Bot** (solo copia los archivos):
   ```powershell
   powershell -ExecutionPolicy Bypass -File install\install.ps1
   ```
4. Los drivers USB (paso 3 de arriba).
