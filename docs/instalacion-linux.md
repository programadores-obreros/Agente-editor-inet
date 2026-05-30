# Instalación en Linux

## Paso 1 — Instalar OpenCode

Seguí las instrucciones de https://opencode.ai para tu distribución.

## Paso 2 — Instalar PlatformIO Core

```bash
python3 -c "$(curl -fsSL https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py)"
```

PlatformIO queda instalado en `~/.platformio/penv/bin/pio`.

> 💡 Profe Bot busca `pio` automáticamente en esa ruta — no hace falta agregarlo al PATH.

## Paso 3 — Permisos del puerto serial

En Linux, para cargar código a la placa necesitás permiso sobre el puerto USB:

```bash
sudo usermod -a -G dialout $USER
```

**Cerrá sesión y volvé a entrar** para que el cambio tome efecto. Verificá con `groups` que aparezca `dialout`.

Los drivers USB (CH340, CP2102) ya vienen en el kernel de Linux, así que no hace falta instalarlos.

## Paso 4 — Instalar Profe Bot

```bash
./install/install.sh
```

## Paso 5 — Verificar

Abrí OpenCode, elegí el agente `profe-bot` (tecla Tab) y ejecutá `/diagnostico`.
