#!/usr/bin/env bash
# Desinstala Tecnia Bot de forma prolija: borra SOLO los archivos que instaló
# (según el manifest), sin tocar la config personal del usuario ni OpenCode/PlatformIO.

#
# Los datos PERSONALES (perfil/memoria del aula, key de Google) se PREGUNTAN, con
# 20 s de espera y "No" por defecto. Para no preguntar:
#   --conservar   los deja (lo que pasa si nadie contesta)
#   --borrar      los quita sin preguntar

set -euo pipefail

MODO_DATOS="preguntar"
for arg in "$@"; do
  case "$arg" in
    --conservar) MODO_DATOS="conservar" ;;
    --borrar) MODO_DATOS="borrar" ;;
    *) echo "Opción desconocida: $arg (uso: uninstall.sh [--conservar|--borrar])"; exit 2 ;;
  esac
done

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
MANIFEST="$CONFIG_DIR/tecnia-bot.manifest"
PERFIL_FILE="$CONFIG_DIR/tecnia-perfil.md"
MEMORIA_FILE="$CONFIG_DIR/tecnia-memoria.md"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"
AUTH_FILE="$DATA_DIR/auth.json"

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

# ---- Sacar NUESTRAS claves de la config de OpenCode (sin tocar el resto) ----
# tui (json/jsonc): quitar el plugin del logo y el theme si es el nuestro.
# opencode (json/jsonc): quitar default_agent si es tecnia-bot, el override
#   agent.tecnia-bot (el modelo) y las dos rutas de instructions al perfil y la
#   memoria. Antes quedaban: OpenCode avisaba en cada arranque por dos archivos
#   que ya no existían.
# Preservamos provider/model y cualquier otra cosa del docente.
#
# OpenCode acepta .json o .jsonc para cada config; operamos sobre el que EXISTA
# (preferimos .json si estan los dos). Si no hay ninguno, no hay nada que limpiar.
TECNIA_PLUGIN="./plugins/tecnia-logo.tsx"
TECNIA_THEME="tecnia-violet"
TECNIA_AGENT="tecnia-bot"

# Resuelve el archivo de config existente (.json preferido, si no .jsonc, si no vacio).
resolve_existing_config() {
  if [ -f "$1.json" ]; then
    printf '%s' "$1.json"
  elif [ -f "$1.jsonc" ]; then
    printf '%s' "$1.jsonc"
  else
    printf '%s' ""
  fi
}

TUI_JSON="$(resolve_existing_config "$CONFIG_DIR/tui")"
OPENCODE_JSON="$(resolve_existing_config "$CONFIG_DIR/opencode")"

JSON_TOOL=""
if command -v jq >/dev/null 2>&1; then
  JSON_TOOL="jq"
elif command -v python3 >/dev/null 2>&1; then
  JSON_TOOL="python3"
fi

# Unmerge en python: tolera .jsonc con comentarios (los saca respetando strings).
# Si solo queda "$schema" (el archivo era nuestro), borra el archivo entero.
unmerge_via_python() {
  python3 - "$TUI_JSON" "$OPENCODE_JSON" "$TECNIA_THEME" "$TECNIA_PLUGIN" "$TECNIA_AGENT" "$PERFIL_FILE" "$MEMORIA_FILE" <<'PYEOF'
import json, os, sys

tui_path, oc_path, theme, plugin, agent, perfil, memoria = sys.argv[1:8]

def strip_jsonc(text):
    out = []
    i, n = 0, len(text)
    in_str = esc = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            out.append(c); i += 1; continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            i += 2
            while i < n and text[i] not in "\r\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(c); i += 1
    return "".join(out)

def load(path):
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            txt = f.read()
    except FileNotFoundError:
        return None
    txt = txt.strip()
    if not txt:
        return None
    for candidate in (txt, strip_jsonc(txt)):
        try:
            data = json.loads(candidate)
        except ValueError:
            continue
        return data if isinstance(data, dict) else None
    return None

def finish(path, data):
    # Si solo queda "$schema" (el archivo era nuestro), lo borramos entero.
    if [k for k in data.keys() if k != "$schema"]:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
    elif os.path.exists(path):
        os.remove(path)

tui = load(tui_path)
if tui is not None:
    if isinstance(tui.get("plugin"), list):
        tui["plugin"] = [p for p in tui["plugin"] if p != plugin]
        if not tui["plugin"]:
            del tui["plugin"]
    if tui.get("theme") == theme:
        del tui["theme"]
    finish(tui_path, tui)

oc = load(oc_path)
if oc is not None:
    if oc.get("default_agent") == agent:
        del oc["default_agent"]
    agentes = oc.get("agent")
    if isinstance(agentes, dict):
        agentes.pop(agent, None)
        if not agentes:
            del oc["agent"]
    instrucciones = oc.get("instructions")
    if isinstance(instrucciones, list):
        instrucciones = [p for p in instrucciones if p not in (perfil, memoria)]
        if instrucciones:
            oc["instructions"] = instrucciones
        else:
            del oc["instructions"]
    finish(oc_path, oc)
PYEOF
}

# jq (solo JSON puro). Devuelve 1 si no pudo parsear (para caer a python).
unmerge_tui_jq() {
  [ -n "$TUI_JSON" ] && [ -s "$TUI_JSON" ] || return 0
  local tmp; tmp="$(mktemp)"
  if jq --arg plugin "$TECNIA_PLUGIN" --arg theme "$TECNIA_THEME" '
          (if has("plugin") then .plugin |= map(select(. != $plugin)) else . end)
        | (if (has("plugin") and (.plugin | length) == 0) then del(.plugin) else . end)
        | (if (.theme == $theme) then del(.theme) else . end)
      ' "$TUI_JSON" > "$tmp" 2>/dev/null; then
    if [ "$(jq '(keys - ["$schema"]) | length' "$tmp" 2>/dev/null)" = "0" ]; then
      rm -f "$TUI_JSON"
    else
      mv "$tmp" "$TUI_JSON"
    fi
    rm -f "$tmp"; return 0
  fi
  rm -f "$tmp"; return 1
}

unmerge_opencode_jq() {
  [ -n "$OPENCODE_JSON" ] && [ -s "$OPENCODE_JSON" ] || return 0
  local tmp; tmp="$(mktemp)"
  if jq --arg agent "$TECNIA_AGENT" --arg perfil "$PERFIL_FILE" --arg memoria "$MEMORIA_FILE" '
          (if (.default_agent == $agent) then del(.default_agent) else . end)
        | (if (.agent | type) == "object" then (.agent |= del(.[$agent])) else . end)
        | (if ((.agent | type) == "object" and (.agent | length) == 0) then del(.agent) else . end)
        | (if (.instructions | type) == "array" then (.instructions |= map(select(. != $perfil and . != $memoria))) else . end)
        | (if ((.instructions | type) == "array" and (.instructions | length) == 0) then del(.instructions) else . end)
      ' "$OPENCODE_JSON" > "$tmp" 2>/dev/null; then
    if [ "$(jq '(keys - ["$schema"]) | length' "$tmp" 2>/dev/null)" = "0" ]; then
      rm -f "$OPENCODE_JSON"
    else
      mv "$tmp" "$OPENCODE_JSON"
    fi
    rm -f "$tmp"; return 0
  fi
  rm -f "$tmp"; return 1
}

if [ "$JSON_TOOL" = "jq" ]; then
  JQ_OK=1
  unmerge_tui_jq || JQ_OK=0
  unmerge_opencode_jq || JQ_OK=0
  if [ "$JQ_OK" != "1" ] && command -v python3 >/dev/null 2>&1; then
    # jq no pudo (probablemente comentarios en un .jsonc); reintentar con python.
    unmerge_via_python
  elif [ "$JQ_OK" != "1" ]; then
    echo "  [AVISO] jq no pudo parsear la config (¿.jsonc con comentarios?) y no hay python3."
    echo "          Sacá a mano el theme/plugin/default_agent de Tecnia Bot si querés limpiarlos."
  fi
elif [ "$JSON_TOOL" = "python3" ]; then
  unmerge_via_python
else
  echo "  [AVISO] No hay jq ni python3: no toco la config de OpenCode."
  echo "          Sacá a mano \"theme\": \"$TECNIA_THEME\", el plugin \"$TECNIA_PLUGIN\","
  echo "          \"default_agent\": \"$TECNIA_AGENT\", \"agent\" -> \"$TECNIA_AGENT\" y las dos"
  echo "          rutas de \"instructions\" (tecnia-perfil.md, tecnia-memoria.md) si querés limpiarlos."
fi

# ---- Datos PERSONALES: se preguntan, no se borran solos ----------------------
#
# El perfil y la memoria del aula son lo que el bot aprendió de quien usa esta
# compu; la key de Google es una credencial del docente. Ni se borran solos ni
# se dejan sin avisar. 20 s de espera y "No" por defecto: sin terminal (pipe,
# desinstalación desatendida) `read` no espera y se conserva todo.
preguntar_si_no() {
  echo ""
  echo "$1"
  printf '    [s/N] (si no respondés en 20 s, se conserva) '
  local r=""
  if [ -t 0 ]; then read -r -t 20 r || true; fi
  echo ""
  case "$r" in s|S|y|Y) return 0 ;; *) return 1 ;; esac
}
decidir() {  # 0 = quitar, 1 = conservar
  case "$MODO_DATOS" in
    borrar) return 0 ;;
    conservar) return 1 ;;
    *) preguntar_si_no "$1" ;;
  esac
}

if [ -f "$PERFIL_FILE" ] || [ -f "$MEMORIA_FILE" ]; then
  if decidir "==> El perfil y la memoria del aula (tecnia-perfil.md, tecnia-memoria.md) son datos PERSONALES: lo que el bot aprendió de quien usa esta compu. ¿Borrarlos también?"; then
    rm -f "$PERFIL_FILE" "$MEMORIA_FILE"
    echo "    Perfil y memoria borrados."
  else
    echo "    Se conservan en $CONFIG_DIR: tecnia-perfil.md y tecnia-memoria.md (borralos a mano si querés)."
  fi
fi

# Key de Google en auth.json (se quita SOLO la entrada "google", el resto queda).
auth_tiene_google() {
  [ -f "$AUTH_FILE" ] || return 1
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$AUTH_FILE" <<'PYEOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    sys.exit(0 if isinstance(d, dict) and d.get("google", {}).get("key") else 1)
except Exception:
    sys.exit(1)
PYEOF
  elif command -v jq >/dev/null 2>&1; then
    [ "$(jq -r '.google.key // ""' "$AUTH_FILE" 2>/dev/null)" != "" ]
  else
    return 1
  fi
}
auth_quitar_google() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$AUTH_FILE" <<'PYEOF'
import json, sys
path = sys.argv[1]
d = json.load(open(path))
d.pop("google", None)
with open(path, "w", encoding="utf-8") as f:
    json.dump(d, f, indent=2)
PYEOF
  elif command -v jq >/dev/null 2>&1; then
    local tmp; tmp="$(mktemp)"
    if jq 'del(.google)' "$AUTH_FILE" > "$tmp" 2>/dev/null; then mv "$tmp" "$AUTH_FILE"; else rm -f "$tmp"; fi
  fi
}

if auth_tiene_google; then
  if decidir "==> Hay una API key de Google guardada en auth.json. Es TU credencial, no del programa: si esta compu pasa a otra persona conviene quitarla. ¿Quitarla también?"; then
    auth_quitar_google
    echo "    Key de Google quitada (las otras credenciales de auth.json se preservan)."
  else
    echo "    La key de Google se conserva: OpenCode la sigue usando si lo abrís sin Tecnia Bot."
  fi
fi
# En Linux/macOS el instalador nunca escribió la variable de entorno; si está,
# la puso alguien a mano en su shell y solo se puede avisar.
if [ -n "${GOOGLE_GENERATIVE_AI_API_KEY:-}" ]; then
  echo "  [AVISO] La variable GOOGLE_GENERATIVE_AI_API_KEY está definida en tu shell (~/.bashrc, ~/.zshrc o ~/.profile):"
  echo "          sacala a mano si ya no la querés."
fi

# Borra los directorios que hayan quedado vacíos (tecniabot-web, skills, plugins, themes...).
find "$CONFIG_DIR/tecniabot-web" "$CONFIG_DIR/skills" "$CONFIG_DIR/plugins" "$CONFIG_DIR/themes" -type d -empty -delete 2>/dev/null || true

echo "==> Listo. Tecnia Bot desinstalado."
echo "    (OpenCode y PlatformIO NO se tocaron: son independientes.)"
