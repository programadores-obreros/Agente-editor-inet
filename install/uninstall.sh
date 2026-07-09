#!/usr/bin/env bash
# Desinstala Tecnia Bot de forma prolija: borra SOLO los archivos que instaló
# (según el manifest), sin tocar la config personal del usuario ni OpenCode/PlatformIO.

set -euo pipefail

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
MANIFEST="$CONFIG_DIR/tecnia-bot.manifest"

if [ ! -f "$MANIFEST" ]; then
  echo "No encontré Tecnia Bot instalado (no hay manifest en $CONFIG_DIR)."
  exit 0
fi

echo "==> Desinstalando Tecnia Bot de: $CONFIG_DIR"

# Borra cada archivo listado en el manifest (líneas de datos, no las de config).
while IFS= read -r rel; do
  case "$rel" in ""|"#"*|version=*|repo_dir=*) continue ;; esac
  rm -f "$CONFIG_DIR/$rel"
done < "$MANIFEST"

rm -f "$MANIFEST"

# Borra los directorios que hayan quedado vacíos (tecniabot-web, skills/*, etc.).
find "$CONFIG_DIR/tecniabot-web" "$CONFIG_DIR/skills" -type d -empty -delete 2>/dev/null || true

echo "==> Listo. Tecnia Bot desinstalado."
echo "    (OpenCode y PlatformIO NO se tocaron: son independientes.)"
