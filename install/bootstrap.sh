#!/usr/bin/env bash
# ============================================================================
# Profe Bot — instalador COMPLETO para Linux / macOS.
# Instala TODO lo necesario en un solo paso:
#   1. OpenCode (el editor de IA donde vive Profe Bot)
#   2. PlatformIO Core (para compilar y cargar a la placa) — sin permisos de admin
#   3. Profe Bot (la capa educativa)
#
# Uso (desde la carpeta del repo):
#   bash install/bootstrap.sh
# ============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo ""
echo "  🤖⚡  Profe Bot — instalación completa"
echo "  ─────────────────────────────────────"
echo ""

# --- 1. OpenCode ------------------------------------------------------------
if command -v opencode >/dev/null 2>&1; then
  echo "  [✓] OpenCode ya está instalado ($(opencode --version 2>/dev/null || echo ok))"
else
  echo "  [↓] Instalando OpenCode..."
  curl -fsSL https://opencode.ai/install | bash
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
PIO_BIN="$HOME/.platformio/penv/bin/pio"
if command -v pio >/dev/null 2>&1 || [ -x "$PIO_BIN" ]; then
  echo "  [✓] PlatformIO ya está instalado"
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
  echo "  [✓] PlatformIO instalado en ~/.platformio (Profe Bot lo encuentra solo)."
fi

# --- 3. Profe Bot (capa educativa) ------------------------------------------
echo ""
echo "  [↓] Instalando la capa de Profe Bot..."
bash "$REPO_DIR/install/install.sh"

echo ""
echo "  ✅ ¡Todo listo! Abrí una terminal en cualquier carpeta, escribí 'opencode',"
echo "     apretá Tab y elegí 'profe-bot'."
echo ""
