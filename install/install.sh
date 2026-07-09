#!/usr/bin/env bash
# Instalador de Tecnia Bot para Linux y macOS.
# Copia la capa educativa a la config global de OpenCode (~/.config/opencode),
# para que Tecnia Bot este disponible en CUALQUIER carpeta donde abras opencode.

set -euo pipefail

# Directorio de config global de OpenCode (respeta XDG)
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

# Carpeta de este repo (la raiz, un nivel arriba de install/)
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_DIR/opencode"

echo "==> Instalando Tecnia Bot en: $CONFIG_DIR"

mkdir -p "$CONFIG_DIR"/{agent,tool,skills,command}

# Copiamos todo el contenido de cada carpeta (asi los archivos nuevos
# se instalan solos, sin tener que actualizar este script cada vez).
cp -r "$SRC/agent/."   "$CONFIG_DIR/agent/"
cp -r "$SRC/tool/."    "$CONFIG_DIR/tool/"
cp -r "$SRC/skills/."  "$CONFIG_DIR/skills/"
cp -r "$SRC/command/." "$CONFIG_DIR/command/"

# Biblioteca visual (piezas Wokwi Elements, MIT) para circuitos en HTML
mkdir -p "$CONFIG_DIR/tecniabot-web"
cp -r "$SRC/tecniabot-web/." "$CONFIG_DIR/tecniabot-web/"

# ---- Manifest: versión + ubicación del repo + archivos instalados ----
# Habilita actualizar limpio (borra huérfanos) y desinstalar sin tocar lo del usuario.
MANIFEST="$CONFIG_DIR/tecnia-bot.manifest"
VERSION="$(cat "$REPO_DIR/VERSION" 2>/dev/null || echo "0.0.0")"
NUEVOS="$(cd "$SRC" && find agent tool skills command tecniabot-web -type f | LC_ALL=C sort)"

# Borrar huérfanos: lo que instalamos ANTES y ya no existe (ej: un agente renombrado).
if [ -f "$MANIFEST" ]; then
  while IFS= read -r rel; do
    case "$rel" in ""|"#"*|version=*|repo_dir=*) continue ;; esac
    printf '%s\n' "$NUEVOS" | grep -qxF "$rel" || rm -f "$CONFIG_DIR/$rel"
  done < "$MANIFEST"
fi

{
  echo "# Tecnia Bot — archivos instalados. NO editar a mano."
  echo "version=$VERSION"
  echo "repo_dir=$REPO_DIR"
  printf '%s\n' "$NUEVOS"
} > "$MANIFEST"

echo "==> Listo! Tecnia Bot v$VERSION instalado."
echo ""
echo "Verificando dependencias:"

# Chequear OpenCode
if command -v opencode >/dev/null 2>&1; then
  echo "  [OK] OpenCode: $(opencode --version 2>/dev/null || echo instalado)"
else
  echo "  [FALTA] OpenCode no esta instalado. Instalalo desde https://opencode.ai"
fi

# Chequear PlatformIO (en PATH o en la ruta de instalacion conocida)
if command -v pio >/dev/null 2>&1; then
  echo "  [OK] PlatformIO: $(pio --version 2>/dev/null)"
elif [ -x "$HOME/.platformio/penv/bin/pio" ]; then
  echo "  [OK] PlatformIO: $("$HOME/.platformio/penv/bin/pio" --version 2>/dev/null) (instalado, no en PATH; Tecnia Bot lo encuentra igual)"
else
  echo "  [FALTA] PlatformIO no esta instalado."
  echo "          Instalalo con: python3 <(curl -fsSL https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py)"
fi

echo ""
echo "Para empezar: abri una terminal en cualquier carpeta, escribi 'opencode',"
echo "apreta Tab y elegi 'tecnia-bot'."
