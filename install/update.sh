#!/usr/bin/env bash
# Actualiza Tecnia Bot a la ÚLTIMA VERSIÓN PUBLICADA (el release que GitHub
# marca como "Latest", tag vX.Y.Z) y reinstala la capa.
#   - Si es un clon de git (dev, o la instalación en Linux por `git clone`): SIN
#     tocar cambios locales, hace fetch y se para en el tag del último release.
#   - Si no es git (instalación empaquetada): BAJA el fuente de ese release,
#     VERIFICA que lo bajado sea esa versión, y solo entonces reemplaza la copia
#     maestra.
#
# Antes bajaba la rama `main` entera (código sin publicar) y en un clon hacía
# `reset --hard` + `clean`, que borraba trabajo sin commitear. Ninguna de las dos
# cosas vuelve: la regla es PUEDE FALLAR, PERO NO PUEDE ROMPER. Si algo sale mal
# antes de copiar, la copia instalada queda exactamente como estaba.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="programadores-obreros/Agente-editor-inet"
API_ULTIMO_RELEASE="https://api.github.com/repos/$REPO/releases/latest"
# La API de GitHub rechaza pedidos sin User-Agent (403).
USER_AGENT="tecnia-bot-update"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# descargar URL DESTINO: con curl o wget, el que haya.
descargar() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -A "$USER_AGENT" -H "Accept: application/vnd.github+json" "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --user-agent="$USER_AGENT" --header="Accept: application/vnd.github+json" -O "$2" "$1"
  else
    echo "  [ERROR] Necesito curl o wget para actualizar." >&2
    return 1
  fi
}

# Lee tag_name del JSON de la API. Mismo orden que install.sh: jq -> python3 ->
# y si no hay ninguno, sed (la API devuelve una clave por línea).
leer_tag_name() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.tag_name // ""' "$1"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("tag_name",""))' "$1"
  else
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1
  fi
}

# Último release PUBLICADO (ni draft ni prerelease): el que GitHub marca como
# Latest. Es lo mismo que ve el docente en la página de releases, y lo que
# docs/rollback.md mueve cuando hay que volver atrás.
resolver_ultimo_tag() {
  local json="$tmp/release.json" tag
  descargar "$API_ULTIMO_RELEASE" "$json" || return 1
  tag="$(leer_tag_name "$json" | tr -d '[:space:]')"
  if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "  [ERROR] GitHub devolvió un tag que no entiendo: '$tag'." >&2
    return 1
  fi
  echo "$tag"
}

# El VERSION que vino adentro del tar tiene que ser el del tag (v0.3.75 -> 0.3.75).
# Si no coincide, lo bajado no es lo que pedimos y NO se copia nada.
verificar_version() {
  local dir="$1" esperada="${2#v}" real
  if [ ! -f "$dir/VERSION" ]; then
    echo "  [ERROR] Lo descargado no trae archivo VERSION: no lo instalo." >&2
    return 1
  fi
  real="$(tr -d '[:space:]' < "$dir/VERSION")"
  if [ "$real" != "$esperada" ]; then
    echo "  [ERROR] Lo descargado dice versión $real y el release es $esperada: no lo instalo." >&2
    return 1
  fi
}

echo "==> Actualizando Tecnia Bot..."

if ! tag="$(resolver_ultimo_tag)"; then
  echo "  [ERROR] No pude consultar cuál es el último release en GitHub (¿sin internet?)." >&2
  echo "          No toqué nada: seguís con la versión que tenías." >&2
  exit 1
fi
echo "  Último release publicado: $tag"

if [ -d "$REPO_DIR/.git" ] && command -v git >/dev/null 2>&1; then
  echo "  [git] Es un clon de git."
  # Solo cambios en archivos TRACKEADOS bloquean: son los únicos que un checkout
  # podría pisar. Los archivos sueltos (untracked) git no los toca nunca -- si
  # uno chocara con el tag, checkout falla solo y no pisa nada.
  if [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]; then
    echo "  [ERROR] Hay cambios sin commitear en $REPO_DIR, no toco nada." >&2
    echo "          Commitealos o guardalos (git stash) y volvé a correr /actualizar." >&2
    exit 1
  fi
  if ! git -C "$REPO_DIR" fetch --tags --quiet origin; then
    echo "  [ERROR] git fetch falló (¿sin internet?): no toco nada." >&2
    exit 1
  fi
  if ! del_tag="$(git -C "$REPO_DIR" rev-parse "$tag^{commit}" 2>/dev/null)"; then
    echo "  [ERROR] El tag $tag no está en este clon: no toco nada." >&2
    exit 1
  fi
  if [ "$(git -C "$REPO_DIR" rev-parse HEAD)" = "$del_tag" ]; then
    echo "  [OK] Ya estás en la última ($tag)."
  else
    # Checkout del TAG (queda en "detached HEAD"): lo que corre es exactamente lo
    # publicado, igual que en la instalación empaquetada. Un dev vuelve a su rama
    # con `git checkout main`. El árbol está limpio (recién lo chequeamos), así
    # que checkout no pisa nada.
    if ! git -C "$REPO_DIR" checkout --quiet --detach "$tag"; then
      echo "  [ERROR] No pude pararme en $tag: no toco nada." >&2
      exit 1
    fi
    echo "  [OK] Parado en $tag."
  fi
else
  instalada="$(tr -d '[:space:]' < "$REPO_DIR/VERSION" 2>/dev/null || true)"
  if [ "$instalada" = "${tag#v}" ]; then
    echo "  [OK] Ya estás en la última ($tag). No descargo nada."
  else
    echo "  [web] Bajando el fuente del release $tag desde GitHub..."
    url="https://github.com/$REPO/archive/refs/tags/$tag.tar.gz"
    if ! descargar "$url" "$tmp/src.tar.gz"; then
      echo "  [ERROR] La descarga falló. La copia instalada quedó como estaba (versión $instalada)." >&2
      exit 1
    fi
    tar xzf "$tmp/src.tar.gz" -C "$tmp"
    extracted="$(find "$tmp" -maxdepth 1 -type d -name 'Agente-editor-inet-*' | head -1)"
    [ -n "$extracted" ] || { echo "  [ERROR] No pude extraer el fuente descargado." >&2; exit 1; }
    if ! verificar_version "$extracted" "$tag"; then
      echo "          La copia instalada quedó como estaba (versión $instalada)." >&2
      exit 1
    fi
    # Recién ahora, con lo bajado verificado, se reemplaza la copia maestra.
    cp -rf "$extracted/." "$REPO_DIR/"
    echo "  [OK] Fuente actualizado a $tag."
  fi
fi

# Reinstala la capa (copia archivos + mergea config, idempotente). Corre aunque
# ya estuvieras en la última: es lo que aplica una key pegada con /connect.
bash "$REPO_DIR/install/install.sh"

echo ""
echo "==> Tecnia Bot actualizado. Reiniciá OpenCode para cargar los cambios."
