# Instalación en Windows

Esta es la plataforma principal de Profe Bot, porque es la que más se usa en las escuelas.

> ⚠️ **Nota para el equipo de desarrollo:** estos pasos están pensados pero todavía
> NO se probaron en una máquina Windows real. Validar en la prueba piloto.

## Paso 1 — Instalar OpenCode

Descargá OpenCode desde https://opencode.ai e instalalo siguiendo las instrucciones de Windows.

## Paso 2 — Instalar PlatformIO Core

PlatformIO es lo que compila y carga el código a la placa.

**Opción recomendada (PlatformIO Core, deja `pio` disponible):**

1. Instalá Python desde https://www.python.org/downloads/ (marcá "Add Python to PATH" durante la instalación)
2. Abrí PowerShell y ejecutá:
   ```powershell
   python -c "$(Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py | Select-Object -ExpandProperty Content)"
   ```
3. PlatformIO queda instalado en `%USERPROFILE%\.platformio\penv\Scripts\pio.exe`

> 💡 **Importante:** Profe Bot busca `pio` automáticamente en esa ruta, así que **no hace falta
> agregarlo al PATH**. Esto es clave porque PlatformIO casi nunca queda en el PATH solo.

## Paso 3 — Drivers USB (para que detecte la placa)

Muchas placas (sobre todo clones y módulos ESP32) usan chips USB que Windows no reconoce de fábrica:

- **Chip CH340:** driver en https://www.wch-ic.com/downloads/CH341SER_ZIP.html
- **Chip CP2102:** driver en https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers

Si conectás la placa y no aparece en el Administrador de dispositivos, instalá el driver que corresponda y reiniciá.

## Paso 4 — Instalar Profe Bot

```powershell
powershell -ExecutionPolicy Bypass -File install\install.ps1
```

## Paso 5 — Verificar

Abrí OpenCode, elegí el agente `profe-bot` (tecla Tab) y ejecutá `/diagnostico`. Te va a decir si todo está listo.
