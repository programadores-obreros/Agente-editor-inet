# Instalación en macOS — sin probar en una Mac real

> ⚠️ **Nadie instaló Tecnia Bot en una Mac todavía — ni nosotros.** No hay una
> prueba hecha a mano, ni una corrida automática, ni una bitácora que respalde
> esta guía. Los scripts de instalación (`install/*.sh`) son los mismos de Linux
> y están escritos teniendo en cuenta a macOS, pero **"está escrito para andar"
> no es "anda"**. Si lo probás, sos la primera persona: abajo dice cómo avisarnos.

Si necesitás algo que ande seguro para la clase de mañana, usá
[Windows](instalacion-windows.md) o [Linux](instalacion-linux.md), que sí están
probados.

---

## Qué hace falta antes

### 1. La Terminal

Todo se hace desde la aplicación **Terminal** (está en Aplicaciones → Utilidades,
o buscala con Spotlight). No hay instalador de doble clic para Mac.

### 2. Las Command Line Tools de Apple

En la Terminal:

```bash
xcode-select --install
```

Se abre una ventana de Apple que las descarga. **Hace falta por esto:** en una Mac
que no las tiene, el comando `python3` *existe* pero no anda — es un archivo de
relleno que al ejecutarlo falla. Y sin un `python3` que ande no se puede instalar
PlatformIO, que es lo que compila y carga el programa a la placa.

El instalador no se deja engañar por ese archivo de relleno: no pregunta si
`python3` existe, lo **ejecuta** para ver si anda. Si no anda, te lo dice con
este mismo comando y sigue con el resto:

```
[✗] Hay un python3 en esta compu (/usr/bin/python3) pero no anda: lo ejecuté y falló.
    macOS: xcode-select --install   (instala las Command Line Tools, que traen python3)
```

### 3. `curl`

El instalador baja OpenCode y PlatformIO con `curl`. Si no lo encuentra, lo dice
y sigue con lo que pueda. (No comprobamos en una Mac si viene instalado.)

---

## Cómo instalar

Son los mismos pasos que en Linux:

```bash
git clone https://github.com/programadores-obreros/Agente-editor-inet.git
cd Agente-editor-inet
bash install/bootstrap.sh
```

**Sin `sudo`.** El instalador se niega a correr con `sudo` y no toca nada: Tecnia
Bot se instala en tu carpeta personal y no necesita permisos de administrador.

Si no tenés `git`, bajá el ZIP desde
[la página del proyecto](https://github.com/programadores-obreros/Agente-editor-inet)
(`Code` → `Download ZIP`), descomprimilo, y corré el último comando adentro de esa
carpeta.

### Qué vas a ver al final

El instalador cierra diciendo qué **comprobó**, no qué intentó:

- **`✅ ¡Todo listo!`** — comprobó que OpenCode contesta, que PlatformIO contesta y
  que Tecnia Bot quedó en disco.
- **`⚠️ La instalación NO quedó completa. Esto es lo que comprobé:`** — y abajo,
  una línea por cada cosa (OpenCode, PlatformIO, Tecnia Bot) con `[✓]` o `[✗]` y
  el motivo. Arreglá lo marcado y volvé a correr `bash install/bootstrap.sh`: lo
  que ya quedó bien no se vuelve a instalar.

La API key de Google te la pregunta igual que en Linux: está explicada en el
[paso 4 de la guía de Linux](instalacion-linux.md#paso-4--la-api-key-de-google-opcional).

Después, para abrirlo: en la Terminal, `opencode`.

---

## Qué NO está probado

Todo lo de esta lista está pensado en el código, y nada se vio funcionar en una Mac:

| Qué | Qué sabemos |
|---|---|
| **Que el instalador termine bien** | No se corrió nunca en macOS |
| **OpenCode** | Lo instala el instalador oficial de OpenCode (`opencode.ai/install`), que no es nuestro. No comprobamos qué hace en una Mac |
| **PlatformIO** | Lo instala el instalador oficial de PlatformIO, con `python3`. Tampoco lo comprobamos |
| **Compilar y cargar a la placa** | Sin probar. No sabemos si tu placa necesita un driver USB en macOS: no lo afirmamos ni lo descartamos |
| **El permiso del puerto serie** | En Linux el instalador lo revisa y avisa. En macOS **no lo revisa**: el script da por sentado que ahí no hace falta, y eso tampoco se comprobó |
| **El monitor serial en una ventana** | El código le pide a Terminal.app que lo abra (ver [monitor serial](monitor-serial.md)). Sin probar |
| **`/actualizar` y desinstalar** | Usan los mismos scripts que Linux (`install/update.sh`, `install/uninstall.sh`). Sin probar en macOS |

---

## Si falla, avisanos

Funcione o no, **el resultado sirve**: es la diferencia entre "debería andar" y
"anda". Abrí un issue en
[la página del proyecto](https://github.com/programadores-obreros/Agente-editor-inet/issues)
y pegá:

- **Todo** lo que salió en la Terminal al correr `bash install/bootstrap.sh`, de
  arriba a abajo. El resumen del final es lo más importante.
- La salida de estos dos comandos, que dicen qué Mac y qué macOS tenés:

  ```bash
  sw_vers
  uname -m
  ```

- Hasta dónde llegaste: si instaló, si abrió, si compiló, si cargó a la placa.

**Antes de pegar, sacá tu API key del texto.** Si la pegaste cuando el instalador
te la pidió, quedó escrita en la Terminal, en el renglón de la pregunta. Borrá ese
renglón antes de mandarnos nada.
