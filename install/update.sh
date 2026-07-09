#!/usr/bin/env bash
# Actualiza Tecnia Bot: baja la última versión del repo y reinstala la capa
# (el instalador limpia los archivos huérfanos de la versión anterior).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Actualizando Tecnia Bot..."

if [ -d "$REPO_DIR/.git" ] && command -v git >/dev/null 2>&1; then
  echo "  [↓] Bajando la última versión desde GitHub..."
  git -C "$REPO_DIR" pull --ff-only
else
  echo "  [i] Esta copia no es un clon de git: uso los archivos que ya tenés."
  echo "      Para traer lo último, volvé a descargar el proyecto desde GitHub."
fi

bash "$REPO_DIR/install/install.sh"

echo ""
echo "==> Tecnia Bot actualizado. Reiniciá OpenCode para cargar los cambios."
