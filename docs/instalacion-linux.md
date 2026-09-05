# Instalación en Linux

## ⭐ Forma fácil (recomendada)

### Paso 1 — Descargá el proyecto

```bash
git clone https://github.com/programadores-obreros/Agente-editor-inet.git
cd Agente-editor-inet
```

(Si no tenés `git`, descargá el ZIP desde la página del proyecto y descomprimilo.)

### Paso 2 — Corré el instalador todo-en-uno

```bash
bash install/bootstrap.sh
```

Este script instala **todo lo que falte**: OpenCode, PlatformIO y la capa de Tecnia Bot.
Detecta lo que ya tengas y no lo reinstala.

### Paso 3 — Permiso del puerto serial (para cargar a la placa)

Esto el instalador **no** lo hace por vos (necesita tu contraseña). En Linux hace falta permiso sobre el puerto USB, y **el grupo cambia según tu distribución**:

```bash
# Debian, Ubuntu, Mint, Raspberry Pi OS:
sudo usermod -a -G dialout $USER

# Arch, Manjaro, EndeavourOS:
sudo usermod -a -G uucp $USER
```

> ¿No sabés cuál usar? Corré `getent group dialout` y `getent group uucp`: usá el que exista en tu sistema. Si te da "el grupo no existe", es el otro.

**Cerrá sesión y volvé a entrar** para que tome efecto. Verificá con `groups` que aparezca el grupo.

> Los drivers USB (CH340, CP2102) ya vienen en el kernel de Linux — no hace falta instalarlos.

### Paso 4 — La API key de Google (opcional)

La API key es **opcional**. El instalador te la pide una vez y elige el modelo según lo que hagas:

- **Sin key** (Enter): Tecnia Bot usa **Big Pickle**, el modelo gratuito de OpenCode. No hace falta cuenta. Es gratis **por tiempo limitado**, y mientras dure esa etapa **OpenCode puede usar el chat para mejorar el modelo**: no pongas datos personales ni nombres de alumnos en la conversación.
- **Con key** (gratis, sin tarjeta): usa **Gemini**, con cuota propia y sin esa cláusula.

Para usar Gemini:

1. Entrá a [aistudio.google.com/apikey](https://aistudio.google.com/apikey) con una cuenta de Google y generá una key gratis (podés hacerlo antes, en otra pestaña, mientras corre el instalador).
2. Cuando el instalador te muestre *"API key de Google (OPCIONAL)..."*, pegala ahí directo.
3. Si no la tenés a mano en ese momento, apretá Enter: el bot queda en Big Pickle. Para pasar a Gemini después, conseguí la key y volvé a correr `bash install/install.sh` (te la pide), o pegala con `/connect` dentro de OpenCode y corré `/actualizar`.

Se guarda en tu compu y no se vuelve a pedir en las próximas actualizaciones. Más detalle: [docs/api-key-google.md](api-key-google.md).

> 📖 Guía completa (por qué hace falta, qué hacer si deja de andar, cómo reemplazarla): [docs/api-key-google.md](api-key-google.md).

### Paso 5 — Verificá

Abrí una terminal, escribí `opencode`, apretá **Tab**, elegí `tecnia-bot` y ejecutá `/diagnostico`.

---

## Instalación manual (avanzada, paso a paso)

Si preferís instalar cada cosa por separado (o el bootstrap falló), estos son los pasos que automatiza:

1. **OpenCode** — **la versión que dice `install/OPENCODE_VERSION`** (la única probada con esta versión de Tecnia Bot; es el mismo archivo que usa el instalador de Windows): `curl -fsSL https://opencode.ai/install | bash -s -- --version "$(cat install/OPENCODE_VERSION)"`.
2. **PlatformIO Core** (no necesita permisos de administrador):
   ```bash
   python3 -c "$(curl -fsSL https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py)"
   ```
   Queda en `~/.platformio/penv/bin/pio` — Tecnia Bot lo busca ahí solo, no hace falta tocar el PATH.
3. **La capa de Tecnia Bot** (solo copia los archivos):
   ```bash
   bash install/install.sh
   ```
4. El permiso del puerto serial (paso 3 de arriba).
