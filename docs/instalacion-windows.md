# Instalación en Windows

Esta es la plataforma principal de Tecnia Bot, porque es la que más se usa en las escuelas.

> ⚠️ **Nota para el equipo de desarrollo:** el instalador está escrito pero todavía
> NO se probó en una máquina Windows real. Validar en la prueba piloto.

## 🟢 Súper fácil — instalador `.exe` (recomendado para docentes)

Es lo más parecido a instalar cualquier programa: descargás **un** archivo, doble
clic, y "Siguiente → Siguiente → Instalar". No hace falta git, ni PowerShell, ni
pegar comandos.

1. Entrá a [**Releases**](https://github.com/programadores-obreros/Agente-editor-inet/releases)
   y descargá **`Instalar-Tecnia-Bot.exe`** de la última versión.
2. Doble clic. Si Windows muestra un aviso azul (**SmartScreen**, porque el `.exe`
   no está firmado), tocá **"Más información" → "Ejecutar de todas formas"**.
3. Seguí el asistente. Instala todo solo (OpenCode + PlatformIO + Tecnia Bot) **sin
   pedir contraseña de administrador**. Tarda unos minutos y se ve una ventana negra
   con texto corriendo: es normal, está trabajando.
4. Al terminar, abrí **Tecnia Bot** desde el **menú inicio** (o el escritorio).
5. Faltan dos pasos que ningún instalador puede hacer solo: los **drivers USB** de
   la placa (**Paso 3** de más abajo) y conectar una **API key gratis de Google**
   para el modelo de lenguaje (**Paso 4** de más abajo). Ambos son pasos únicos.

> El `.exe` lo compila GitHub Actions en cada versión (no se sube a mano). Si no ves
> el archivo en Releases, corré el workflow **"Instalador Windows (.exe)"** desde la
> pestaña *Actions* del repo.

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

Instala **todo lo que falte** (OpenCode + PlatformIO + Tecnia Bot) usando **Scoop**, en el espacio
del usuario: **no hace falta permiso de administrador** — ideal para las PCs de la escuela.

### Paso 3 — Drivers USB (para que detecte la placa)

Esto el instalador **no** lo hace. Muchas placas (sobre todo clones y módulos ESP32) usan chips USB
que Windows no reconoce de fábrica:

- **Chip CH340:** driver en https://www.wch-ic.com/downloads/CH341SER_ZIP.html
- **Chip CP2102:** driver en https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers

Si conectás la placa y no aparece en el Administrador de dispositivos, instalá el driver que corresponda y reiniciá.

### Paso 4 — La API key gratis de Google

Tecnia Bot usa Google Gemini como modelo de lenguaje, que tiene una cuota gratis (sin tarjeta). **El instalador ya te la pide solo**, al final de la instalación:

1. Entrá a [aistudio.google.com/apikey](https://aistudio.google.com/apikey) con una cuenta de Google y generá una key gratis (podés hacerlo antes, en otra pestaña, mientras corre el instalador).
2. Cuando el instalador te muestre *"Tecnia Bot necesita una API key GRATIS de Google..."*, pegala ahí directo.
3. Si no la tenés a mano en ese momento, apretá Enter sin pegar nada — podés agregarla después escribiendo `/connect` dentro de OpenCode, buscando **Google** en la lista.

Es un paso único: se guarda en tu compu y no se vuelve a pedir en las próximas actualizaciones.

### Paso 5 — Verificá

Abrí una terminal, escribí `opencode`, apretá **Tab**, elegí `tecnia-bot` y ejecutá `/diagnostico`.

---

## Instalación manual (avanzada, paso a paso)

Si preferís hacerlo a mano (o el bootstrap falló), estos son los pasos que automatiza:

1. **OpenCode** — descargalo de https://opencode.ai, o con Scoop: `scoop install opencode`.
2. **PlatformIO Core** (no necesita administrador):
   1. Instalá Python desde https://www.python.org/downloads/ (marcá "Add Python to PATH"), o `scoop install python`.
   2. En PowerShell:
      ```powershell
      python -c "$(Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py | Select-Object -ExpandProperty Content)"
      ```
   3. Queda en `%USERPROFILE%\.platformio\penv\Scripts\pio.exe` — Tecnia Bot lo busca ahí solo, no hace falta tocar el PATH.
3. **La capa de Tecnia Bot** (solo copia los archivos):
   ```powershell
   powershell -ExecutionPolicy Bypass -File install\install.ps1
   ```
4. Los drivers USB (paso 3 de arriba).
