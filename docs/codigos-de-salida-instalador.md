# Códigos de salida del instalador

Para quien instala Tecnia Bot en muchas máquinas con un script y no tiene una
pantalla que leer: el código de salida es lo único que le llega.

Cada tabla sale del **encabezado del propio archivo**, que es donde vive el
contrato. Si este documento y un encabezado dicen cosas distintas, vale el
encabezado — y avisanos, porque este documento quedó viejo.

**La regla general:** `0` quiere decir "lo comprobé y quedó bien". Nunca quiere
decir "lo intenté".

## Windows

### `Instalar-Tecnia-Bot.exe`

Fuente: encabezado de `installer/tecnia-bot.iss`.

| Código | Qué pasó | Qué hacer |
|---|---|---|
| `0` | Todo quedó instalado y `bootstrap.ps1` lo comprobó | Nada |
| `1` a `8` | Códigos propios de Inno Setup (cancelado, error al copiar archivos, etc.): ver "Setup Exit Codes" en la ayuda de Inno Setup | Mirar el log de Inno |
| `20` | Se copiaron los archivos, pero `bootstrap.ps1` falló o no se pudo lanzar: **Tecnia Bot no quedó usable** | "Reparar Tecnia Bot"; si repite, "Diagnostico de Tecnia Bot" |
| `21` | Quedó instalado pero **incompleto**: el bot abre, y falta PlatformIO, Node, la versión probada de OpenCode, o parte de la configuración | "Reparar Tecnia Bot" |

Tres cosas a tener en cuenta en un despliegue:

- El instalador **nunca** pregunta la API key ni espera a nadie, con ventana o con
  **`/VERYSILENT`** (le pasa siempre `-SinPrompt` a `bootstrap.ps1`; hasta el
  2026-11-26 sólo en silencioso). Si ya había una key guardada, la deja y la prueba;
  si no, queda el modelo gratuito y la key se pone después con `/clave` o con
  "Reparar Tecnia Bot", que sí pregunta.
- Con **`/skipdeps=1`** se saltea `bootstrap.ps1`: sólo se copian archivos y el
  código es `0`. Ese `0` **no** dice que Tecnia Bot ande: es un modo de prueba.
- El `20` y el `21` salen del código con que terminó `bootstrap.ps1` (tabla
  siguiente): `1` → `20`, `2` → `21`.

Dónde mirar después: `%LOCALAPPDATA%\TecniaBot\instalacion.log` (lo que hizo
`bootstrap.ps1`, de la última corrida) y `%TEMP%\Setup Log*.txt` (el log de Inno).

**El desinstalador de Windows (`unins000.exe`) no tiene un código propio.** Corre
`uninstall.ps1` y, si quedó algo sin borrar, lo dice en un cartel; en silencioso
no hay cartel y el `.iss` no define ningún código de salida para ese caso. Si
necesitás saber si quedó algo, corré `install\uninstall.ps1` vos y mirá su
código (más abajo). En silencioso, además, **nunca borra los datos personales**.

### `install\bootstrap.ps1` (lo mismo que corre "Reparar Tecnia Bot")

Fuente: encabezado de `install/bootstrap.ps1`.

| Código | Qué pasó |
|---|---|
| `0` | Todo quedó y se comprobó: OpenCode arranca y es la versión fijada, PlatformIO contesta, Node contesta y alcanza, la capa de Tecnia Bot está publicada |
| `2` | **Instalado pero incompleto**: el bot abre, pero falta PlatformIO (no compila ni carga), o Node (no anda el skill de diagramas), u OpenCode quedó en una versión que no es la probada, o `install.ps1` terminó con avisos |
| `1` | **Falla**: el bot no se puede usar. OpenCode no arranca, la capa no quedó publicada, no se pudo instalar Scoop, o falta `install\OPENCODE_VERSION`. También es lo que devuelve PowerShell si el script muere por un error sin atajar |

Para que no pregunte nada: `-SinPrompt`.

### `install\install.ps1` (sólo la capa de Tecnia Bot)

Fuente: encabezado de `install/install.ps1`.

| Código | Qué pasó |
|---|---|
| `0` | La capa quedó instalada y la configuración de OpenCode quedó escrita |
| `3` | **Instalado con avisos**: los archivos se copiaron, pero algo de la configuración no se pudo dejar bien (`tui.json` u `opencode.json` ilegibles, que se dejan intactos; el archivo de credenciales ilegible; una key que no se pudo guardar). El cierre lista qué falta |
| `1` | La instalación se cortó por un error. La capa puede haber quedado a medias |

No cubre las dependencias: que falte OpenCode o PlatformIO no cambia este
código. Eso lo mira `bootstrap.ps1`.

Para que no pregunte nada: la variable de entorno `TECNIA_SIN_PROMPT`.

### `install\update.ps1` (lo que corre `/actualizar`)

Fuente: encabezado de `install/update.ps1`.

| Código | Qué pasó |
|---|---|
| `0` | Quedó en el último release publicado y la capa se reinstaló |
| `3` | Quedó en el último release, pero `install.ps1` terminó con avisos. Es "actualizado, con algo pendiente", no "no se pudo actualizar" |
| `1` | No se pudo actualizar. El mensaje dice si la copia instalada quedó como estaba (lo más común) o si quedó a medias |

Un detalle que el encabezado no nombra y el código sí hace: si el fuente se
actualizó pero `install.ps1` falló con otro código, `update.ps1` sale con **ese
mismo código**. En la práctica es `1`, pero conviene tratar todo lo que no sea
`0` ni `3` como "no quedó actualizado".

### `install\uninstall.ps1`

Fuente: encabezado de `install/uninstall.ps1`.

| Código | Qué pasó |
|---|---|
| `0` | Se sacó todo lo que había que sacar, y se comprobó releyendo |
| `3` | Desinstalación **parcial**: algo quedó sin borrar. Se lista al final |
| otro | El script se cortó antes de terminar: no se sabe qué quedó |

Los datos personales (perfil, memoria del aula, registro de cargas y la key de
Google) se preguntan. Para no preguntar: `-Conservar` los deja, `-Borrar` los
quita.

## Linux y macOS

> macOS no se probó en una Mac real: ver [instalación en macOS](instalacion-macos.md).

### `install/bootstrap.sh`

Fuente: encabezado de `install/bootstrap.sh`.

| Código | Qué pasó |
|---|---|
| `0` | Todo comprobado: `opencode --version` contesta, un `pio` contesta, y la capa quedó en disco |
| `1` | No pudo ni empezar: falta `install/OPENCODE_VERSION` |
| `2` | **La capa de Tecnia Bot no quedó instalada.** Es el caso grave: no hay Tecnia Bot |
| `3` | La capa quedó instalada, pero falta OpenCode o PlatformIO, o `install.sh` terminó con avisos. El resumen del final dice cuál |
| `4` | Se negó a correr: lo lanzaron con `sudo` (o `doas`, o `pkexec`). No tocó nada |

### `install/install.sh` (sólo la capa de Tecnia Bot)

Fuente: encabezado de `install/install.sh`.

| Código | Qué pasó |
|---|---|
| `0` | Instalado |
| `1` | Error: el script se cortó a la mitad. Lo que haya dicho arriba es el motivo |
| `3` | **Instalado con avisos**: los archivos se copiaron, pero algo de lo que había que dejar escrito no quedó (lo típico: `opencode.json` o `tui.json` que no se pueden leer o escribir). El detalle sale en las últimas líneas |
| `4` | Se negó a correr: lo lanzaron con `sudo` o como root prestado. No tocó nada |

Para que no pregunte nada: la variable de entorno `TECNIA_SIN_PROMPT`.

### `install/update.sh` (lo que corre `/actualizar`)

Fuente: encabezado de `install/update.sh`.

| Código | Qué pasó |
|---|---|
| `0` | Actualizado (o ya estaba en la última) y la capa reinstalada |
| `3` | Actualizado con avisos: es el `3` de `install.sh`, pasado tal cual |
| `5` | La copia quedó a medias y no se pudo volver atrás. No debería pasar; si pasa, el mensaje dice dónde quedó lo anterior |
| otro | No se actualizó, o el instalador de la capa falló. El motivo está más arriba en la salida |

### `install/uninstall.sh`

**Este script no declara códigos de salida en su encabezado.** Lo que sigue sale
de leer el código, no de un contrato:

| Código | Qué pasó |
|---|---|
| `0` | Terminó. **Ojo: también sale con `0` cuando la desinstalación fue parcial** y lo dijo en pantalla ("se desinstaló PARCIALMENTE"). Y con `0` si no encontró nada instalado |
| `2` | Le pasaron una opción que no conoce |

O sea: en Linux el código de salida **no alcanza** para saber si quedó algo sin
borrar; hay que leer la salida. Es distinto de `uninstall.ps1`, que sí sale con
`3`. Para no preguntar por los datos personales: `--conservar` o `--borrar`.
