#!/usr/bin/env bash
# Actualiza Tecnia Bot: trae la última versión y reinstala la capa.
#   - Si es un clon de git (dev): git pull.
#   - Si no es git (instalación empaquetada): BAJA el fuente del último release
#     desde GitHub (rama main) y reemplaza la copia maestra. Sin re-descargar todo.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="programadores-obreros/Agente-editor-inet"

echo "==> Actualizando Tecnia Bot..."

if [ -d "$REPO_DIR/.git" ] && command -v git >/dev/null 2>&1; then
  echo "  [git] Bajando la última versión (git pull)..."
  # Estos archivos los mantiene el instalador -- nadie los debería tocar a
  # mano (mismo criterio que el manifest). Si igual quedaron modificados
  # localmente por lo que sea, "git pull" se rompe con un error crudo en
  # inglés que el docente no puede leer -- lo descartamos antes de bajar lo
  # nuevo, y nos aseguramos de seguir a `main` (por si alguien quedó en otra
  # rama de una instalación de desarrollo).
  git -C "$REPO_DIR" reset --hard HEAD >/dev/null 2>&1 || true
  git -C "$REPO_DIR" clean -fd -e "*.manifest" >/dev/null 2>&1 || true
  git -C "$REPO_DIR" checkout main >/dev/null 2>&1 || true
  git -C "$REPO_DIR" pull --ff-only
else
  echo "  [web] Bajando el fuente del último release desde GitHub..."
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  url="https://github.com/$REPO/archive/refs/heads/main.tar.gz"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$tmp/src.tar.gz"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp/src.tar.gz" "$url"
  else
    echo "  [ERROR] Necesito curl o wget para actualizar." >&2; exit 1
  fi
  tar xzf "$tmp/src.tar.gz" -C "$tmp"
  extracted="$(find "$tmp" -maxdepth 1 -type d -name 'Agente-editor-inet-*' | head -1)"
  [ -n "$extracted" ] || { echo "  [ERROR] No pude extraer el fuente descargado." >&2; exit 1; }
  # Reemplaza la copia maestra con el fuente nuevo.
  cp -rf "$extracted/." "$REPO_DIR/"
  echo "  [OK] Fuente actualizado."
fi

# Reinstala la capa (copia archivos + mergea config, idempotente).
bash "$REPO_DIR/install/install.sh"

echo ""
echo "==> Tecnia Bot actualizado. Reiniciá OpenCode para cargar los cambios."
