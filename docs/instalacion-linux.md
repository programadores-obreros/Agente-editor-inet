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

Esto el instalador **no** lo hace por vos (necesita tu contraseña). En Linux hace falta permiso sobre el puerto USB:

```bash
sudo usermod -a -G dialout $USER
```

**Cerrá sesión y volvé a entrar** para que tome efecto. Verificá con `groups` que aparezca `dialout`.

> Los drivers USB (CH340, CP2102) ya vienen en el kernel de Linux — no hace falta instalarlos.

### Paso 4 — Verificá

Abrí una terminal, escribí `opencode`, apretá **Tab**, elegí `tecnia-bot` y ejecutá `/diagnostico`.

---

## Instalación manual (avanzada, paso a paso)

Si preferís instalar cada cosa por separado (o el bootstrap falló), estos son los pasos que automatiza:

1. **OpenCode** — seguí https://opencode.ai para tu distribución (o `curl -fsSL https://opencode.ai/install | bash`).
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
