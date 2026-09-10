#!/usr/bin/env bash
# ============================================================================
# Tecnia Bot — instalador COMPLETO para Linux / macOS.
# Instala TODO lo necesario en un solo paso:
#   1. OpenCode (el editor de IA donde vive Tecnia Bot)
#   2. PlatformIO Core (para compilar y cargar a la placa) — sin permisos de admin
#   3. Tecnia Bot (la capa educativa)
#
# Uso (desde la carpeta del repo):
#   bash install/bootstrap.sh
# ============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Versión de OpenCode probada con esta versión de Tecnia Bot. La FIJAMOS a propósito,
# por dos motivos:
#   1. El instalador de OpenCode, si no le pasás versión, le pregunta la última a la
#      API de GitHub, que limita a 60 pedidos/hora POR IP. En una escuela con muchas
#      PC detrás de una sola IP, a partir del pedido 60 la instalación falla
#      ("Failed to fetch version information"). Fijándola, se saltea ese pedido.
#   2. La capa educativa depende de detalles que OpenCode cambia entre versiones
#      (default_agent, instructions, agent.<nombre>.model, tui.json, plugins). Todas
#      las máquinas tienen que tener LA MISMA, la que se probó.
#
# La versión vive en install/OPENCODE_VERSION, UN solo archivo que también lee el
# instalador de Windows. Acá estaba escrita a mano y era distinta (y más vieja) que
# la que se llevaba Windows: dos plataformas, dos OpenCode. Si el archivo falta o
# está vacío se corta con un mensaje claro: instalar "la que sea" es justo lo que
# esto evita.
ARCHIVO_VERSION="$(dirname "${BASH_SOURCE[0]}")/OPENCODE_VERSION"
OPENCODE_VERSION=""
if [ -f "$ARCHIVO_VERSION" ]; then
  OPENCODE_VERSION="$(tr -d '[:space:]' < "$ARCHIVO_VERSION")"
fi
if ! [[ "$OPENCODE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo ""
  echo "  [✗] No se pudo leer la versión de OpenCode a instalar." >&2
  echo "      Tiene que estar en: $ARCHIVO_VERSION" >&2
  if [ -n "$OPENCODE_VERSION" ]; then
    echo "      Dice '$OPENCODE_VERSION' y se esperaba algo como 1.18.18." >&2
  else
    echo "      El archivo falta o está vacío. Volvé a descargar el proyecto." >&2
  fi
  exit 1
fi

echo ""
echo "  🤖⚡  Tecnia Bot — instalación completa"
echo "  ─────────────────────────────────────"
echo ""

# --- 1. OpenCode ------------------------------------------------------------
if command -v opencode >/dev/null 2>&1; then
  INSTALADA="$(opencode --version 2>/dev/null || echo ok)"
  echo "  [✓] OpenCode ya está instalado ($INSTALADA)"
  # Se avisa, no se toca: este instalador no desinstala ni reemplaza nada que ande.
  if [ "$INSTALADA" != "ok" ] && [ "${INSTALADA#*$OPENCODE_VERSION}" = "$INSTALADA" ]; then
    echo "  [i] Esta versión de Tecnia Bot se probó con OpenCode $OPENCODE_VERSION. Se deja la que hay;"
    echo "      si algo no anda, reinstalá con: curl -fsSL https://opencode.ai/install | bash -s -- --version $OPENCODE_VERSION"
  fi
else
  echo "  [↓] Instalando OpenCode v$OPENCODE_VERSION..."
  curl -fsSL https://opencode.ai/install | bash -s -- --version "$OPENCODE_VERSION"
  # el instalador agrega OpenCode al PATH del shell, pero esta sesión todavía
  # no lo ve: lo agregamos a mano para poder seguir.
  export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"
  if command -v opencode >/dev/null 2>&1; then
    echo "  [✓] OpenCode instalado."
  else
    echo "  [!] OpenCode se instaló pero no quedó en el PATH de esta terminal."
    echo "      Cerrá y abrí la terminal, o agregá su carpeta al PATH, y volvé a correr esto."
  fi
fi

# --- 2. PlatformIO Core ------------------------------------------------------
# TRES LUGARES DONDE BUSCAR, no uno — la misma lección que el lanzador de Windows
# (installer/abrir-tecnia-bot.cmd) aprendió buscando OpenCode, y la tercera vez que
# muerde en este repo. Acá mordía por PLATFORMIO_CORE_DIR: si el usuario la tiene
# seteada (o su distro se la setea), PlatformIO instala en otro lado y este script
# decía "no está instalado" con PlatformIO instalado y andando.
#
# El caso que destapó todo fue en Windows — una usuaria llamada `Dirección310`, con
# `ó`, que no es ASCII: PlatformIO no soporta rutas con caracteres no-ASCII y en
# Windows RELOCALIZA su core_dir a la raíz del disco. Esa relocalización es SOLO de
# Windows, así que acá NO se inventa: en Linux/macOS los candidatos son la variable
# de entorno, ~/.platformio y el PATH, y nada más.
#
# En cada carpeta se miran `pio` Y `platformio`: normalmente están los dos, pero el
# instalador oficial nombra `platformio` en su mensaje final y no queremos depender
# de que exista justo el que elegimos nosotros.
#
# Esta lógica está repetida en install.sh, bootstrap.ps1, diagnostico.ps1,
# install.ps1 y opencode/tool/platformio.ts, A PROPÓSITO: ningún script hace
# dot-sourcing de otro, cada uno se copia y corre SOLO. Lo que mantiene honestas a
# las copias es tests/platformio-pio.test.mjs.
pio_core_dirs() {
  if [ -n "${PLATFORMIO_CORE_DIR:-}" ]; then printf '%s\n' "$PLATFORMIO_CORE_DIR"; fi
  printf '%s\n' "$HOME/.platformio"
}

# Devuelve la ruta del pio que ANDA, o nada (y código 1).
#
# Al candidato se le PREGUNTA --version, no se supone que anda por donde vive: eso
# atrapa un venv a medio armar (el paquete no bajó pero la carpeta quedó). Cuesta un
# segundo y corre una sola vez. El tool platformio.ts NO pregunta — está en el camino
# caliente y le alcanza con que el archivo exista —; la asimetría es deliberada.
buscar_pio() {
  local dir nombre ruta salida
  while IFS= read -r dir; do
    for nombre in pio platformio; do
      ruta="$dir/penv/bin/$nombre"
      [ -x "$ruta" ] || continue
      if salida="$("$ruta" --version 2>&1)" && printf '%s' "$salida" | grep -qi platformio; then
        printf '%s\n' "$ruta"
        return 0
      fi
    done
  done < <(pio_core_dirs)
  # El PATH al final: PlatformIO casi nunca queda ahí, pero si alguien lo agregó a
  # mano (o install.sh ya corrió) es una respuesta válida.
  for nombre in pio platformio; do
    command -v "$nombre" >/dev/null 2>&1 || continue
    if salida="$("$nombre" --version 2>&1)" && printf '%s' "$salida" | grep -qi platformio; then
      command -v "$nombre"
      return 0
    fi
  done
  return 1
}

PIO_BIN="$(buscar_pio || true)"
if [ -n "$PIO_BIN" ]; then
  echo "  [✓] PlatformIO ya está instalado ($PIO_BIN)"
else
  echo "  [↓] Instalando PlatformIO Core (no necesita admin)..."
  if ! command -v python3 >/dev/null 2>&1; then
    echo "  [✗] Falta Python 3. Instalalo desde el gestor de tu sistema y volvé a correr."
    echo "      Debian/Ubuntu: sudo apt install python3"
    echo "      Arch/Manjaro:  sudo pacman -S python"
    exit 1
  fi
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/get-platformio.py" \
    https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py
  python3 "$TMP/get-platformio.py"
  rm -rf "$TMP"
  # Se vuelve a BUSCAR: recién ahora sabemos dónde eligió instalarse, y se dice la
  # ruta REAL. Decir "~/.platformio" cuando quedó en otro lado manda a mirar una
  # carpeta que no existe — en Windows eso costó tres semanas de una docente.
  PIO_BIN="$(buscar_pio || true)"
  if [ -n "$PIO_BIN" ]; then
    echo "  [✓] PlatformIO instalado en $PIO_BIN (Tecnia Bot lo encuentra solo)."
  else
    # No se corta: sin PlatformIO el bot igual sirve para explicar, dibujar
    # circuitos y repartir fichas. Sólo no puede compilar ni cargar a la placa.
    echo "  [!] PlatformIO no quedó instalado. Tecnia Bot va a arrancar igual, pero"
    echo "      no va a poder compilar ni cargar a la placa hasta que esto se resuelva."
  fi
fi

# --- 3. Tecnia Bot (capa educativa) ------------------------------------------
echo ""
echo "  [↓] Instalando la capa de Tecnia Bot..."
bash "$REPO_DIR/install/install.sh"

echo ""
echo "  ✅ ¡Todo listo! Abrí una terminal en cualquier carpeta, escribí 'opencode',"
echo "     apretá Tab y elegí 'tecnia-bot'."
echo ""
echo "  🔑 La API key de Google es opcional. Sin key, Tecnia Bot usa Big Pickle, el modelo"
echo "     gratuito de OpenCode (gratis por tiempo limitado; OpenCode puede usar el chat"
echo "     para mejorar el modelo). Con key usa Gemini: sacala gratis (sin tarjeta) en"
echo "     https://aistudio.google.com/apikey y volvé a correr install/install.sh."
echo ""
