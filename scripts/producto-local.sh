#!/usr/bin/env bash
# Perfil de PRODUCTO aislado para probar Tecnia Bot en la compu de desarrollo.
#
# Para qué: que el bot que ve el alumno no herede el contexto de desarrollo de esta
# máquina (reglas de ~/.claude, skills globales, Engram, Gentle AI, Graphify). En un
# aula eso no pasa porque la compu está limpia; acá sí, si no se aísla.
#
# Cómo aísla (verificado con OpenCode 1.18.31, G-03 del Engineering Baseline):
#   - XDG_CONFIG_HOME propio: OpenCode lee SU config de ahí, no de ~/.config/opencode.
#   - XDG_DATA_HOME propio: credenciales (auth.json) y sesiones aparte.
#   - OPENCODE_DISABLE_CLAUDE_CODE=1: no carga ~/.claude/CLAUDE.md ni ~/.claude/skills.
# OPENCODE_CONFIG_DIR NO sirve de frontera: OpenCode lo SUMA a la config global en vez
# de reemplazarla. Por eso se desactiva acá.
#
# Uso:
#   scripts/producto-local.sh instalar        # copia la capa del repo al perfil (install/install.sh)
#   scripts/producto-local.sh abrir [args]    # corre opencode con el perfil (sin args: el TUI)
#
# El perfil vive en ~/tecnia-local (o en $TECNIA_PERFIL_LOCAL). Es sólo para desarrollo:
# este script no viaja en el instalador.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PERFIL="${TECNIA_PERFIL_LOCAL:-$HOME/tecnia-local}"

export XDG_CONFIG_HOME="$PERFIL/config"
export XDG_DATA_HOME="$PERFIL/data"
export OPENCODE_DISABLE_CLAUDE_CODE=1
unset OPENCODE_CONFIG_DIR

case "${1:-}" in
  instalar)
    shift
    mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME"
    exec bash "$REPO_DIR/install/install.sh" "$@"
    ;;
  abrir)
    shift
    exec opencode "$@"
    ;;
  *)
    echo "Uso: $0 instalar | abrir [argumentos de opencode]" >&2
    exit 2
    ;;
esac
