# Instalación en Linux

## Antes de empezar: qué tiene que haber en tu compu

El instalador no pide contraseña ni instala programas del sistema. Estas cosas
tienen que estar **antes**; si falta alguna, no se rompe nada: el instalador
sigue con lo que puede y al final te dice qué quedó sin instalar y por qué.

| Qué | Para qué | Si falta |
|---|---|---|
| **`curl`** | Bajar OpenCode (su instalador lo usa por dentro; `wget` no lo reemplaza) | **OpenCode no se instala**, y sin OpenCode no hay dónde abrir Tecnia Bot. El instalador lo dice y sigue con el resto |
| **`python3`** | Instalar PlatformIO, que compila y carga el programa a la placa | **PlatformIO no se instala.** Tecnia Bot igual explica, dibuja circuitos y reparte fichas; no compila ni carga |
| **`git`** | Descargar el proyecto (paso 1) | Bajá el ZIP desde la página del proyecto |
| **Unos 3 GB libres** | Las herramientas de ESP32 y Arduino UNO (más de 1 GB de descarga) | El instalador avisa y **no** las baja: quedan para la primera compilación, que con mala red se corta |

Para instalar lo que falte:

```bash
# Debian, Ubuntu, Mint, Raspberry Pi OS:
sudo apt install curl python3 git

# Arch, Manjaro, EndeavourOS:
sudo pacman -S curl python git
```

Si no hay `python3` y tampoco `jq`, pasa una cosa más: el instalador no puede
*modificar* una configuración de OpenCode que ya exista (si no existe, la crea)
ni guardar la API key. Lo avisa al final con **"instalado CON AVISOS"**.

## ⭐ Forma fácil (recomendada)

### Paso 1 — Descargá el proyecto

```bash
git clone https://github.com/programadores-obreros/Agente-editor-inet.git
cd Agente-editor-inet
```

(Si no tenés `git`, descargá el ZIP desde la página del proyecto y descomprimilo.)

> **¿Qué versión es esta?** `git clone` trae la rama `main`: lo último del
> desarrollo. Suele coincidir con el último release publicado, pero entre un
> release y el siguiente puede traer cambios que todavía no se publicaron. Si
> querés quedar exactamente en lo publicado, mirá
> [Actualizar](#actualizar) más abajo.

### Paso 2 — Corré el instalador todo-en-uno

```bash
bash install/bootstrap.sh
```

**Sin `sudo`.** Si lo corrés con `sudo` (o `doas`, o `pkexec`) el instalador se
niega y no toca nada: Tecnia Bot se instala en tu carpeta personal, y como
administrador quedaría instalado para otro usuario o dejaría archivos que
después no podés actualizar ni borrar. Te lo dice así:

```
[✗] No corras este instalador con sudo ni como administrador.
    ...
    Volvé a correrlo igual que antes pero SIN sudo.
    No instalé ni toqué nada.
```

El script instala **todo lo que falte**: OpenCode, PlatformIO, la capa de Tecnia
Bot y las herramientas de ESP32 y Arduino UNO. Detecta lo que ya tengas y no lo
reinstala. Esa última descarga pasa de 1 GB: puede tardar varios minutos.

#### Cómo termina, y qué hacer en cada caso

El instalador cierra diciendo lo que **comprobó**, no lo que intentó.

**Si todo quedó bien:**

```
✅ ¡Todo listo! Abrí una terminal en la carpeta del proyecto, escribí 'tecnia-bot', ...
```

Sale únicamente si comprobó las tres cosas: que OpenCode contesta, que
PlatformIO contesta y que Tecnia Bot quedó en disco. (Ese cartel todavía dice
"apretá Tab y elegí 'tecnia-bot'": no hace falta, ver el Paso 5.)

**Si faltó algo**, el final se ve parecido a esto:

```
⚠️  La instalación NO quedó completa. Esto es lo que comprobé:

   [✓] OpenCode: contesta (...).
   [✗] PlatformIO: NO quedó instalado — falta Python 3, que es con lo que se instala.
       Tecnia Bot igual explica, dibuja circuitos y reparte fichas; no compila ni carga a la placa.
   [✓] Tecnia Bot: la capa quedó instalada en /home/vos/.config/opencode.

   Arreglá lo marcado y volvé a correr: bash install/bootstrap.sh
   (lo que ya quedó bien no se vuelve a instalar).
```

Hay una línea por cada cosa, con el motivo al lado. Lo que hay que hacer es lo
que dice: arreglar lo marcado con `[✗]` y volver a correr el mismo comando.

| Si la línea marcada es… | Quiere decir | Qué hacer |
|---|---|---|
| **OpenCode** | No hay dónde abrir Tecnia Bot | El motivo está al lado. Los dos que contempla el instalador son que falte `curl` o que no haya podido bajarlo (sin internet, o la red lo bloquea) |
| **PlatformIO** | El bot abre, pero no compila ni carga | El motivo está al lado. Lo más directo de arreglar es que falte `python3`: instalalo y volvé a correr |
| **Tecnia Bot: la capa NO quedó instalada** | Es el caso grave: no hay Tecnia Bot | Mirá el error que salió más arriba y volvé a correr |
| **Tecnia Bot: … terminó CON AVISOS** | Los archivos se copiaron, pero no se pudo escribir parte de la configuración o guardar la key | Más arriba, donde dice "instalado CON AVISOS", está la lista de lo que falta |

Si desplegás en varias máquinas con un script, cada caso tiene su código de
salida: ver [códigos de salida del instalador](codigos-de-salida-instalador.md).

### Paso 3 — Permiso del puerto serial (para cargar a la placa)

En Linux el puerto de la placa pertenece a un grupo, y quien no está en ese
grupo no puede cargar: PlatformIO falla con *"Permission denied"* después de
compilar todo. El grupo cambia según la distribución (`dialout` en Debian y
Ubuntu, `uucp` en Arch y Manjaro).

**El instalador lo mira por vos y te dice el comando exacto para tu compu.** No
lo corre: hace falta tu contraseña, y el instalador no usa `sudo`. Buscá, cerca
del final de lo que imprimió, la línea que empieza con `Puerto serie`:

| Si dice… | Quiere decir | Qué hacer |
|---|---|---|
| `[OK] Puerto serie: tu usuario puede leer y escribir /dev/ttyUSB0` | Había una placa conectada y el permiso está | Nada |
| `[OK] Puerto serie: tu usuario (…) esta en el grupo dialout` | El permiso está | Nada |
| `[FALTA] Puerto serie: tu usuario (…) NO esta en el grupo dialout` | Falta el permiso. Abajo viene el comando | Copiá el comando que te muestra (algo como `sudo usermod -a -G dialout tu_usuario`), corrélo, y después **cerrá la sesión y volvé a entrar** |
| `[AVISO] … ya figura en el grupo …, pero esta sesion todavia no lo tomo` | Ya corriste el comando, pero no saliste de la sesión | Cerrá la sesión y volvé a entrar (o reiniciá) |
| `[AVISO] Puerto serie: no pude comprobar el permiso` | No había placa conectada y tu sistema no tiene ni `dialout` ni `uucp` | Conectá la placa y volvé a correr `bash install/install.sh` |

El chequeo es más preciso **con la placa enchufada** mientras corre el
instalador: ahí mira el puerto de verdad en vez de fijarse qué grupo existe.

Para verificar a mano, después de volver a entrar: `groups` tiene que mostrar el
grupo.

> Los drivers USB (CH340, CP2102) ya vienen en el kernel de Linux — no hace falta instalarlos.

#### Si tu placa no aparece

Si el bot dice que no ve ninguna placa, hacé esta prueba antes de tocar nada.
Con la placa **desenchufada**:

```bash
ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
```

Enchufala, esperá cinco segundos y corré lo mismo de nuevo. Tiene que aparecer
un nombre que antes no estaba (`/dev/ttyUSB0` o `/dev/ttyACM0`).

- **Aparece:** la compu la ve. Lo que falta es el permiso (arriba).
- **No aparece:** probá otro cable USB — hay cables que sólo cargan y no pasan
  datos. Si con otro cable tampoco, mirá qué dijo el sistema al enchufarla:

  ```bash
  sudo dmesg | tail -20
  ```

  Esas líneas cuentan qué pasó con el USB. Si ves que el puerto aparece y
  enseguida se desconecta, o que se nombra otro programa tomando el dispositivo,
  es que algo de tu sistema se lo está quedando. **No lo vamos a adivinar desde
  acá**: no tenemos medido qué programas hacen eso en cada distribución. Copiá
  esas veinte líneas y mandánoslas en un
  [issue](https://github.com/programadores-obreros/Agente-editor-inet/issues).

### Paso 4 — La API key de Google (opcional)

La API key es **opcional**: el instalador termina igual sin ella y elige el
modelo según lo que hagas.

- **Sin key** (Enter): Tecnia Bot queda configurado con **Big Pickle**, el modelo gratuito de OpenCode. No hace falta cuenta. Es gratis **por tiempo limitado**, y mientras dure esa etapa **OpenCode puede usar el chat para mejorar el modelo**: no pongas datos personales ni nombres de alumnos en la conversación.
- **Con key** (gratis, sin tarjeta): usa **Gemini**, con cuota propia y sin esa cláusula.

> ⚠️ **Lo que recomendamos es la key.** El 25 de septiembre de 2026 registramos
> que Big Pickle, sin cuenta, había dejado de contestar (está en
> [decisiones, D-06](decisiones.md)), y no volvimos a comprobarlo. Si instalaste
> sin key y al primer mensaje ves un error, no rompiste nada: sacá la key y
> volvé a correr `bash install/install.sh`.

Para usar Gemini:

1. Entrá a [aistudio.google.com/apikey](https://aistudio.google.com/apikey) con una cuenta de Google y generá una key gratis (podés hacerlo antes, en otra pestaña, mientras corre el instalador).
2. Cuando el instalador te muestre *"API key de Google (OPCIONAL)..."*, pegala ahí y apretá Enter. Tenés **60 segundos**; si no contestás, sigue sin key.
3. El instalador **la prueba contra Google** antes de guardarla. Si Google la rechaza, no la guarda y te lo dice (casi siempre es que se cortó al copiarla). Si no pudo llegar a Google —sin internet, o el filtro de la escuela— la guarda igual y te avisa que no sabe si anda.

**El instalador te la pregunta cada vez que lo corrés a mano**, no una sola vez:

- Si **no** hay key guardada, te la pide.
- Si **ya hay** una, te ofrece cambiarla: *"Enter para dejarla como esta, o pega una nueva para reemplazarla"*. Con Enter, o si pasan los 60 segundos, **queda la que estaba**. Nunca se borra una key porque nadie contestó.

Esto es así a propósito: es la forma de cambiar una key que se quedó sin cuota.
Cuando lo que corre es `/actualizar` desde adentro del bot, no hay nadie a quien
preguntarle y se deja la key que estaba.

Dos cosas más que conviene saber:

- **Al pegarla, la key se ve en la terminal.** Si vas a mandarle a alguien una
  captura o el texto de la instalación, borrá ese renglón antes.
- Con el bot andando, `/clave` también la prueba y la cambia, sin mostrarla.

> 📖 Guía completa (por qué hace falta, qué hacer si deja de andar, cómo reemplazarla): [docs/api-key-google.md](api-key-google.md).

### Paso 5 — Verificá

Abrí una terminal, escribí `opencode` y ejecutá `/diagnostico`.

Tiene que arrancar directamente en Tecnia Bot, con su logo violeta: el
instalador lo deja como agente por defecto. Si abre en otro agente, apretá
**Tab** hasta `tecnia-bot` — y volvé a mirar el final de la instalación, porque
eso pasa cuando terminó "CON AVISOS" sin poder escribir la configuración.

---

## Actualizar

Adentro del bot, `/actualizar`. Desde una terminal, lo mismo es
`bash install/update.sh`.

Lleva tu instalación al **último release publicado** (el que GitHub marca como
"Latest"), nunca a `main` ni a una versión de prueba. Qué hace depende de cómo
descargaste el proyecto:

- **Si lo clonaste con `git`:** se para en el tag de ese release. Si habías
  clonado `main` y `main` estaba más adelante, **esto te lleva a lo publicado**.
  Si modificaste archivos del proyecto y no los guardaste en git, no toca nada y
  te lo dice.
- **Si bajaste el ZIP:** descarga el fuente de ese release, verifica que sea esa
  versión, y recién entonces **reemplaza** las carpetas `opencode/` e `install/`
  enteras. No copia encima: un archivo que la versión nueva eliminó desaparece
  también de tu compu. Si algo falla antes de reemplazar, tu copia queda como
  estaba; si falla durante, vuelve atrás y te dice cuál de las dos fue.

Después reinstala la capa. Lo que `/actualizar` **no** hace: no actualiza
OpenCode ni PlatformIO, y no baja las herramientas de ESP32 y UNO (pesan más de
1 GB y suele correrse en clase). Si faltan, avisa; para bajarlas, corré
`bash install/install.sh` con buena red.

Al terminar dice una de tres cosas:

- `Tecnia Bot actualizado. Reiniciá OpenCode para cargar los cambios.`
- `Tecnia Bot actualizado CON AVISOS`: los archivos nuevos están, pero no se
  pudo escribir parte de la configuración. El detalle está más arriba.
- Un `[ERROR]` que explica qué pasó y si tu copia quedó como estaba.

### En una red que bloquea GitHub (espejo)

`/actualizar` y `bash install/update.sh` bajan el último release de GitHub. Si la red de la escuela lo bloquea, `update.sh` puede tomarlo de un **espejo** —un servidor de la escuela o un pendrive— con la variable `TECNIA_UPDATE_ESPEJO`:

```bash
TECNIA_UPDATE_ESPEJO=file:///media/pendrive/tecnia bash install/update.sh
```

El espejo tiene que tener dos cosas, con estos nombres:

- `releases/latest`: un JSON con `"tag_name": "vX.Y.Z"`.
- `archive/refs/tags/vX.Y.Z.tar.gz`: el fuente de ese release, tal como se baja de GitHub (*Source code (tar.gz)*).

Sólo acepta `https://` y `file:///`, lo dice en la salida cuando lo usa, y lo bajado pasa por las mismas verificaciones que si viniera de GitHub. `file:///` necesita `curl`. El espejo es para correr `update.sh` a mano: el encabezado de `install/update.sh` aclara que `/actualizar`, cuando sólo consulta si hay versión nueva, le sigue preguntando a GitHub.

---

## Desinstalar

```bash
bash install/uninstall.sh
```

Borra sólo los archivos que Tecnia Bot instaló y saca lo suyo de la
configuración de OpenCode, sin tocar el resto. Después de borrar **relee**, y
dice únicamente lo que comprobó: si algo no se pudo borrar (lo típico: OpenCode
abierto), termina con *"se desinstaló PARCIALMENTE"* y la lista de lo que quedó.

Los datos personales los **pregunta**, con 20 segundos de espera y "No" por
defecto. Son dos preguntas: una por el perfil, la memoria del aula y el registro
de cargas, y otra por la API key de Google. Si la compu se va a donar o
reasignar, contestá que sí a las dos. Para no preguntar: `--borrar` los quita,
`--conservar` los deja.

**Lo que no saca**, y hay que sacar a mano si querés la compu limpia:

- OpenCode y PlatformIO (son programas aparte).
- La carpeta `~/.platformio`, con las herramientas de las placas (más de 1 GB).
- Una línea que el instalador agregó a tu `~/.bashrc` (o `~/.zshrc`, o
  `~/.profile`) para que `pio` funcione en la terminal. Está marcada con el
  comentario `# Tecnia Bot: PlatformIO en el PATH`.

---

## Instalación manual (avanzada, paso a paso)

Si preferís instalar cada cosa por separado (o el bootstrap falló), estos son los pasos que automatiza:

1. **OpenCode** — **la versión que dice `install/OPENCODE_VERSION`** (la única probada con esta versión de Tecnia Bot; es el mismo archivo que usa el instalador de Windows): `curl -fsSL https://opencode.ai/install | bash -s -- --version "$(cat install/OPENCODE_VERSION)"`.
2. **PlatformIO Core** (no necesita permisos de administrador):
   ```bash
   python3 -c "$(curl -fsSL https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py)"
   ```
   Queda en `~/.platformio/penv/bin/pio` — o donde apunte `PLATFORMIO_CORE_DIR`, si la tenés seteada. Tecnia Bot busca en los dos lados solo, no hace falta tocar el PATH.
3. **La capa de Tecnia Bot** (copia los archivos, escribe la configuración y, si encuentra PlatformIO, baja las herramientas de las placas):
   ```bash
   bash install/install.sh
   ```
4. El permiso del puerto serial (paso 3 de arriba).
