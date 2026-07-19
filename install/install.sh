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

mkdir -p "$CONFIG_DIR"/{agent,tool,skills,command,plugins,themes}

# Copiamos todo el contenido de cada carpeta (asi los archivos nuevos
# se instalan solos, sin tener que actualizar este script cada vez).
cp -r "$SRC/agent/."   "$CONFIG_DIR/agent/"
cp -r "$SRC/tool/."    "$CONFIG_DIR/tool/"
cp -r "$SRC/skills/."  "$CONFIG_DIR/skills/"
cp -r "$SRC/command/." "$CONFIG_DIR/command/"

# Branding de Tecnia Bot: plugin de TUI (logo del splash) + theme violeta.
cp -r "$SRC/plugins/." "$CONFIG_DIR/plugins/"
cp -r "$SRC/themes/."  "$CONFIG_DIR/themes/"

# Biblioteca visual (piezas Wokwi Elements, MIT) para circuitos en HTML
mkdir -p "$CONFIG_DIR/tecniabot-web"
cp -r "$SRC/tecniabot-web/." "$CONFIG_DIR/tecniabot-web/"

# ---- Manifest: versión + ubicación del repo + archivos instalados ----
# Habilita actualizar limpio (borra huérfanos) y desinstalar sin tocar lo del usuario.
MANIFEST="$CONFIG_DIR/tecnia-bot.manifest"
VERSION="$(cat "$REPO_DIR/VERSION" 2>/dev/null || echo "0.0.0")"
NUEVOS="$(cd "$SRC" && find agent tool skills command tecniabot-web plugins themes -type f | LC_ALL=C sort)"

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

# ---- Config de OpenCode: theme violeta + plugin del logo + agente por defecto ----
# Mergeamos con la config que ya tenga el docente (ej: provider/model de /connect):
# NO la pisamos. El theme y el plugin de TUI van en tui (opencode migra y borra
# esas claves de opencode). El agente por defecto va en opencode.
#
# OpenCode acepta AMBAS extensiones para cada config: fileInDirectory prueba
# [dir/name.json, dir/name.jsonc] en ese orden. Detectamos cual existe y mergeamos
# en ESE (preferimos .json si estan los dos, igual que opencode). Si no existe
# ninguno, creamos .json.
TECNIA_PLUGIN="./plugins/tecnia-logo.tsx"
TECNIA_THEME="tecnia-violet"
TECNIA_AGENT="tecnia-bot"
TUI_SCHEMA="https://opencode.ai/tui.json"
OPENCODE_SCHEMA="https://opencode.ai/config.json"

# Resuelve el archivo de config a usar: .json si existe, si no .jsonc, si no .json.
resolve_config_file() {
  # $1 = ruta base sin extension (ej: "$CONFIG_DIR/opencode")
  if [ -f "$1.json" ]; then
    printf '%s' "$1.json"
  elif [ -f "$1.jsonc" ]; then
    printf '%s' "$1.jsonc"
  else
    printf '%s' "$1.json"
  fi
}

TUI_JSON="$(resolve_config_file "$CONFIG_DIR/tui")"
OPENCODE_JSON="$(resolve_config_file "$CONFIG_DIR/opencode")"

# Detectar una herramienta JSON disponible (portabilidad: la PC del docente
# puede no tener jq). Orden: jq -> python3 -> ninguna.
JSON_TOOL=""
if command -v jq >/dev/null 2>&1; then
  JSON_TOOL="jq"
elif command -v python3 >/dev/null 2>&1; then
  JSON_TOOL="python3"
fi

echo ""
echo "==> Configurando OpenCode (theme + logo + agente por defecto)..."

# Merge robusto en python: tolera .jsonc con comentarios (los saca respetando
# strings, para no romper URLs como el $schema) y re-serializa como JSON valido.
# Si un archivo existe pero NO se puede parsear, lo deja intacto y avisa (nunca
# pisa la config del usuario). Idempotente.
merge_via_python() {
  python3 - "$TUI_JSON" "$OPENCODE_JSON" "$TECNIA_THEME" "$TECNIA_PLUGIN" "$TECNIA_AGENT" "$TUI_SCHEMA" "$OPENCODE_SCHEMA" <<'PYEOF'
import json, sys

tui_path, oc_path, theme, plugin, agent, tui_schema, oc_schema = sys.argv[1:8]

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
    # Devuelve (dict, ok). ok=False => existe pero no se pudo parsear (NO pisar).
    try:
        with open(path, "r", encoding="utf-8") as f:
            txt = f.read()
    except FileNotFoundError:
        return {}, True
    txt = txt.strip()
    if not txt:
        return {}, True
    for candidate in (txt, strip_jsonc(txt)):
        try:
            data = json.loads(candidate)
        except ValueError:
            continue
        return (data if isinstance(data, dict) else {}), True
    return None, False

def dump(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

# tui: theme + plugin (idempotente, preserva el resto).
tui, ok = load(tui_path)
if ok:
    tui.setdefault("$schema", tui_schema)
    tui["theme"] = theme
    plugins = tui.get("plugin")
    if not isinstance(plugins, list):
        plugins = []
    if plugin not in plugins:
        plugins.append(plugin)
    tui["plugin"] = plugins
    dump(tui_path, tui)
else:
    sys.stderr.write("  [AVISO] No pude parsear %s: lo dejo intacto.\n" % tui_path)
    sys.stderr.write("          Agregale a mano \"theme\": \"%s\" y el plugin \"%s\".\n" % (theme, plugin))

# opencode: default_agent (preserva todas las demas claves).
oc, ok = load(oc_path)
if ok:
    oc.setdefault("$schema", oc_schema)
    oc["default_agent"] = agent
    dump(oc_path, oc)
else:
    sys.stderr.write("  [AVISO] No pude parsear %s: lo dejo intacto.\n" % oc_path)
    sys.stderr.write("          Agregale a mano \"default_agent\": \"%s\".\n" % agent)
PYEOF
}

# Merge con jq (solo JSON puro; jq NO soporta comentarios). Devuelve 0 si mergeo,
# 1 si fallo (ej: .jsonc con comentarios) para poder caer a python.
merge_tui_jq() {
  [ -s "$TUI_JSON" ] || printf '{}\n' > "$TUI_JSON"
  local tmp; tmp="$(mktemp)"
  if jq --arg theme "$TECNIA_THEME" --arg plugin "$TECNIA_PLUGIN" --arg schema "$TUI_SCHEMA" '
          .["$schema"] = (.["$schema"] // $schema)
        | .theme = $theme
        | .plugin = ((.plugin // []) | if any(. == $plugin) then . else . + [$plugin] end)
      ' "$TUI_JSON" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$TUI_JSON"; return 0
  fi
  rm -f "$tmp"; return 1
}

merge_opencode_jq() {
  [ -s "$OPENCODE_JSON" ] || printf '{}\n' > "$OPENCODE_JSON"
  local tmp; tmp="$(mktemp)"
  if jq --arg agent "$TECNIA_AGENT" --arg schema "$OPENCODE_SCHEMA" '
          .["$schema"] = (.["$schema"] // $schema)
        | .default_agent = $agent
      ' "$OPENCODE_JSON" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$OPENCODE_JSON"; return 0
  fi
  rm -f "$tmp"; return 1
}

if [ "$JSON_TOOL" = "jq" ]; then
  JQ_OK=1
  merge_tui_jq || JQ_OK=0
  merge_opencode_jq || JQ_OK=0
  if [ "$JQ_OK" = "1" ]; then
    echo "  [OK] $(basename "$TUI_JSON") y $(basename "$OPENCODE_JSON") actualizados (via jq)."
  elif command -v python3 >/dev/null 2>&1; then
    # jq no pudo (probablemente comentarios en un .jsonc); reintentar con python.
    merge_via_python
    echo "  [OK] Config actualizada (jq no pudo con comentarios; usé python3)."
  else
    echo "  [AVISO] jq no pudo parsear la config (¿.jsonc con comentarios?) y no hay python3."
    echo "          Revisá y agregá a mano lo que falte:"
    echo "            $(basename "$TUI_JSON"): \"theme\": \"$TECNIA_THEME\" + plugin \"$TECNIA_PLUGIN\""
    echo "            $(basename "$OPENCODE_JSON"): \"default_agent\": \"$TECNIA_AGENT\""
  fi
elif [ "$JSON_TOOL" = "python3" ]; then
  merge_via_python
  echo "  [OK] $(basename "$TUI_JSON") y $(basename "$OPENCODE_JSON") actualizados (via python3)."
else
  # Sin jq ni python3: si el archivo no existe lo creamos con nuestro default;
  # si existe NO lo tocamos (evitamos un merge fragil) y avisamos que agregue las
  # claves a mano.
  if [ ! -s "$TUI_JSON" ]; then
    cat > "$TUI_JSON" <<EOF
{
  "\$schema": "$TUI_SCHEMA",
  "theme": "$TECNIA_THEME",
  "plugin": ["$TECNIA_PLUGIN"]
}
EOF
    echo "  [OK] $(basename "$TUI_JSON") creado."
  else
    echo "  [AVISO] No hay jq ni python3 y $TUI_JSON ya existe: no lo toco."
    echo "          Agregale a mano estas claves (sin borrar lo tuyo):"
    echo "            \"theme\": \"$TECNIA_THEME\""
    echo "            \"plugin\": debe incluir \"$TECNIA_PLUGIN\""
  fi
  if [ ! -s "$OPENCODE_JSON" ]; then
    cat > "$OPENCODE_JSON" <<EOF
{
  "\$schema": "$OPENCODE_SCHEMA",
  "default_agent": "$TECNIA_AGENT"
}
EOF
    echo "  [OK] $(basename "$OPENCODE_JSON") creado."
  else
    echo "  [AVISO] No hay jq ni python3 y $OPENCODE_JSON ya existe: no lo toco."
    echo "          Agregale a mano: \"default_agent\": \"$TECNIA_AGENT\""
  fi
fi

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
