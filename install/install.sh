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

# ---- Perfil del usuario: se crea VACIO solo si NO existe (nunca se pisa) ----
# Es dato del usuario (nombre/rol/placa) y debe sobrevivir a los /actualizar, por
# eso NO se copia del repo: lo crea el instalador la primera vez. Su ruta absoluta
# se agrega a "instructions" de opencode (mas abajo) para que se cargue en el
# contexto de CADA sesion: asi el bot recuerda el nombre sin volver a preguntar.
PERFIL_FILE="$CONFIG_DIR/tecnia-perfil.md"
if [ ! -f "$PERFIL_FILE" ]; then
  cat > "$PERFIL_FILE" <<'EOF'
# Perfil del usuario de Tecnia Bot
<!-- Lo mantiene Tecnia Bot. No editar a mano salvo que quieras cambiar tus datos.
     Modo "aula" = compu compartida por muchos: el Nombre NO se guarda (privacidad de menores).
     Modo "grupo" = pocas personas conocidas: se guarda a cada una en "## Personas". -->

- Modo: (sin definir)
- Nombre: (sin definir)
- Rol: (sin definir)
- Género: (sin definir)
- Placa preferida: (sin definir)
EOF
  echo "  [OK] Perfil de usuario creado (vacío) en $PERFIL_FILE"
fi

# ---- Memoria de progreso de ESTA compu: se crea VACIA solo si NO existe (nunca se pisa) ----
# Es el progreso pedagogico de la maquina/grupo (nivel, proyectos hechos) y debe
# sobrevivir a los /actualizar, por eso NO se copia del repo: lo crea el instalador la
# primera vez. Su ruta absoluta se agrega a "instructions" de opencode (mas abajo) para
# cargarla en cada sesion: asi el bot recuerda el progreso sin volver a preguntar.
MEMORIA_FILE="$CONFIG_DIR/tecnia-memoria.md"
if [ ! -f "$MEMORIA_FILE" ]; then
  cat > "$MEMORIA_FILE" <<'EOF'
# Memoria de ESTA compu (no de una persona)
<!-- Progreso pedagogico de esta maquina/grupo. Lo mantiene Tecnia Bot.
     NO guarda datos personales de ningun alumno (ni nombre ni nada que identifique
     a un menor): en las PCs de escuela una cuenta la comparten muchos chicos. -->

- Nivel: (sin definir)
- Proyectos hechos: (sin definir)
- Ultimo proyecto: (sin definir)
- En curso: (sin definir)
EOF
  echo "  [OK] Memoria de progreso creada (vacía) en $MEMORIA_FILE"
fi

# ---- API key de Google (OPCIONAL): decide que modelo usa el agente ----
# Con una key de Google (gratis, sin tarjeta) Tecnia Bot usa Gemini. Sin key, usa
# Big Pickle, el modelo gratuito de OpenCode (provider "opencode": sin cuenta ni
# login, OpenCode lo sirve con apiKey "public"). La eleccion se escribe mas abajo
# como override del agente en opencode.json ("agent" -> "tecnia-bot" -> "model")
# y se RE-EVALUA en cada corrida (instalar, update, /actualizar): si el docente
# agrega una key despues con /connect, la corrida siguiente lo pasa a Gemini.
#
# Hasta la v0.3.75 aca habia una key de Google fija, embebida en el script, que se
# usaba cuando nadie pegaba la suya. Se elimino y se roto: no queda ninguna key en
# este repo. La key que pegue el docente se guarda SOLO en el archivo de
# credenciales de OpenCode de esta compu -- nunca en el repo, nunca en git. Es
# idempotente: si ya hay una key de "google" guardada (de esta instalacion o de un
# /connect manual), no se pregunta de nuevo.
MODELO_CON_KEY="google/gemini-3.5-flash-lite"
MODELO_SIN_KEY="opencode/big-pickle"

# ---- La key compartida de versiones anteriores se reconoce por su SHA-256 ----
# Las instalaciones hechas con la v0.3.75 o anteriores tienen esa key en auth.json.
# Como se roto, quedo una credencial MUERTA que hace fallar el primer mensaje, y el
# instalador -- que solo miraba "hay key de google" -- la daba por buena. Se la
# reconoce por el hash (el literal no vuelve a este repo) y se la quita antes de
# decidir el modelo; si el docente la pega en el prompt, se rechaza por el mismo motivo.
HASH_KEY_VIEJA="121163b85b0396edcfcc4840981d823c4f1e9c23aadc72b39c9723fef70cf3b4"
sha256_de() {
  # $1 = texto exacto (sin newline). sha256sum en Linux, shasum en macOS, openssl de ultimo.
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    printf '%s' "$1" | openssl dgst -sha256 | awk '{print $NF}'
  fi
}
es_key_vieja() {
  [ -n "${1:-}" ] && [ "$(sha256_de "$1")" = "$HASH_KEY_VIEJA" ]
}

DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"
mkdir -p "$DATA_DIR"
AUTH_FILE="$DATA_DIR/auth.json"

# Lee la key de "google" guardada (o nada). Con python3 o jq, el que haya: sin
# ninguno de los dos no se puede leer el JSON y se asume que no hay.
auth_leer_key_google() {
  [ -f "$AUTH_FILE" ] || return 0
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$AUTH_FILE" <<'PYEOF' 2>/dev/null || true
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    k = d.get("google", {}).get("key", "")
    print(k if isinstance(k, str) else "")
except Exception:
    print("")
PYEOF
  elif command -v jq >/dev/null 2>&1; then
    jq -r '.google.key // ""' "$AUTH_FILE" 2>/dev/null || true
  fi
}

# Quita la entrada "google" de auth.json preservando los otros providers.
auth_quitar_google() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$AUTH_FILE" <<'PYEOF'
import json, sys
path = sys.argv[1]
try:
    d = json.load(open(path))
except Exception:
    d = {}
d.pop("google", None)
json.dump(d, open(path, "w"), indent=2)
PYEOF
  elif command -v jq >/dev/null 2>&1; then
    local tmp; tmp="$(mktemp)"
    if jq 'del(.google)' "$AUTH_FILE" > "$tmp" 2>/dev/null; then mv "$tmp" "$AUTH_FILE"; else rm -f "$tmp"; fi
  fi
}

GOOGLE_KEY_ACTUAL="$(auth_leer_key_google)"
if es_key_vieja "$GOOGLE_KEY_ACTUAL"; then
  auth_quitar_google
  GOOGLE_KEY_ACTUAL=""
  echo "  [i] Se quitó la key de respaldo compartida que traían las versiones anteriores (ya no es válida)."
fi
# En Linux/macOS el instalador nunca escribio la variable de entorno; si alguien la
# puso a mano con la key vieja, solo se puede avisar (vive en su .bashrc/.zshrc).
if es_key_vieja "${GOOGLE_GENERATIVE_AI_API_KEY:-}"; then
  echo "  [AVISO] La variable GOOGLE_GENERATIVE_AI_API_KEY tiene la key de respaldo vieja (ya inválida):"
  echo "          sacala de tu ~/.bashrc, ~/.zshrc o ~/.profile."
fi
TIENE_GOOGLE=0
[ -n "$GOOGLE_KEY_ACTUAL" ] && TIENE_GOOGLE=1

if [ "$TIENE_GOOGLE" != "1" ]; then
  echo ""
  echo "==> API key de Google (OPCIONAL). Con una key gratis (sin tarjeta) Tecnia Bot usa Gemini."
  echo "    Sacala en: https://aistudio.google.com/apikey (1 minuto, con cualquier cuenta de Google)"
  echo "    Se guarda en ESTA compu, nunca se comparte ni sube a ningun lado."
  # Timeout de 60s: si esto corre sin terminal (pipe, deploy desatendido), read
  # se colgaria para siempre esperando una entrada que nunca llega.
  GEMINI_KEY=""
  read -r -t 60 -p "    Pegala aca, o Enter para seguir sin key: Tecnia Bot va a usar el modelo gratuito Big Pickle de OpenCode [60s]: " GEMINI_KEY || true
  # Una key no tiene espacios: se saca cualquier blanco que haya entrado al pegar.
  GEMINI_KEY="$(printf '%s' "${GEMINI_KEY:-}" | tr -d ' \t\r\n')"
  if es_key_vieja "$GEMINI_KEY"; then
    # La pego de algun apunte viejo: es la key compartida rotada. No se guarda.
    echo "  [X] Esa es la key de respaldo compartida de versiones anteriores: ya no es válida y no se guarda."
    echo "      Conseguí la tuya en https://aistudio.google.com/apikey (seguimos sin key por ahora)."
  elif [ -n "$GEMINI_KEY" ]; then
    if command -v python3 >/dev/null 2>&1; then
      python3 - "$AUTH_FILE" "$GEMINI_KEY" <<'PYEOF'
import json, sys
path, key = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(path))
except Exception:
    d = {}
d["google"] = {"type": "api", "key": key}
json.dump(d, open(path, "w"), indent=2)
PYEOF
      TIENE_GOOGLE=1
      echo "  [OK] Key guardada en esta compu."
    elif command -v jq >/dev/null 2>&1; then
      [ -s "$AUTH_FILE" ] || printf '{}\n' > "$AUTH_FILE"
      tmp_auth="$(mktemp)"
      if jq --arg k "$GEMINI_KEY" '.google = {type: "api", key: $k}' "$AUTH_FILE" > "$tmp_auth" 2>/dev/null; then
        mv "$tmp_auth" "$AUTH_FILE"
        TIENE_GOOGLE=1
        echo "  [OK] Key guardada en esta compu."
      else
        rm -f "$tmp_auth"
        echo "  [AVISO] No pude escribir $AUTH_FILE (no parsea como JSON). Agregala a mano:"
        echo "          {\"google\": {\"type\": \"api\", \"key\": \"TU_KEY\"}} y volve a correr este instalador."
      fi
    else
      echo "  [AVISO] No hay python3 ni jq para guardar la key automaticamente."
      echo "          Agregala a mano en $AUTH_FILE: {\"google\": {\"type\": \"api\", \"key\": \"TU_KEY\"}}"
      echo "          y volve a correr este instalador para que el agente pase a Gemini."
    fi
  else
    # Sin key NO se toca auth.json: no hay nada que guardar.
    echo "  [i] Seguimos sin key de Google."
  fi
fi

# Modelo del agente segun la decision de arriba. Se imprime SIEMPRE (tambien cuando
# la key ya estaba guardada), para que quede claro con que modelo quedo esta compu y
# como cambiarlo despues.
if [ "$TIENE_GOOGLE" = "1" ]; then
  MODELO_ELEGIDO="$MODELO_CON_KEY"
  echo "==> Modelo configurado: $MODELO_ELEGIDO (Gemini, con tu key de Google)."
else
  MODELO_ELEGIDO="$MODELO_SIN_KEY"
  echo "==> Modelo configurado: $MODELO_ELEGIDO (Big Pickle, el modelo gratuito de OpenCode)."
  echo "    Es gratis por tiempo limitado y no pide cuenta. OJO: mientras dure la etapa gratuita,"
  echo "    OpenCode puede usar lo que se escribe en el chat para mejorar el modelo."
  echo "    No pongas datos personales (ni nombres de alumnos) en la conversacion."
  echo "    Para pasar a Gemini: consegui una key en https://aistudio.google.com/apikey y volve a"
  echo "    correr install/install.sh (te la va a pedir), o pegala con /connect dentro de OpenCode"
  echo "    y despues corre /actualizar para aplicar el cambio."
fi
echo ""

# ---- Config de OpenCode: theme violeta + plugin del logo + agente por defecto + modelo ----
# Mergeamos con la config que ya tenga el docente (ej: provider/model de /connect):
# NO la pisamos. El theme y el plugin de TUI van en tui (opencode migra y borra
# esas claves de opencode). El agente por defecto y el modelo del agente
# ("agent" -> "tecnia-bot" -> "model", elegido arriba segun haya key) van en opencode.
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
echo "==> Configurando OpenCode (theme + logo + agente por defecto + modelo)..."

# Merge robusto en python: tolera .jsonc con comentarios (los saca respetando
# strings, para no romper URLs como el $schema) y re-serializa como JSON valido.
# Si un archivo existe pero NO se puede parsear, lo deja intacto y avisa (nunca
# pisa la config del usuario). Idempotente.
merge_via_python() {
  python3 - "$TUI_JSON" "$OPENCODE_JSON" "$TECNIA_THEME" "$TECNIA_PLUGIN" "$TECNIA_AGENT" "$TUI_SCHEMA" "$OPENCODE_SCHEMA" "$PERFIL_FILE" "$MEMORIA_FILE" "$MODELO_ELEGIDO" <<'PYEOF'
import json, sys

tui_path, oc_path, theme, plugin, agent, tui_schema, oc_schema, perfil_path, memoria_path, modelo = sys.argv[1:11]

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

# opencode: default_agent + modelo del agente + instructions (perfil). Preserva las
# demas claves. El modelo va POR AGENTE ("agent" -> tecnia-bot -> "model") y ESTA ES
# SU UNICA FUENTE: NO va en el frontmatter de opencode/agent/tecnia-bot.md porque el
# .md gana sobre opencode.json (OpenCode hace mergeDeep(config.agent, agentes .md) en
# config.ts), o sea que un "model:" ahi pisaria esto y Big Pickle nunca correria. Lo
# escribe el instalador; otros agentes u opciones se preservan.
oc, ok = load(oc_path)
if ok:
    oc.setdefault("$schema", oc_schema)
    oc["default_agent"] = agent
    agentes = oc.get("agent")
    if not isinstance(agentes, dict):
        agentes = {}
    agente_tecnia = agentes.get(agent)
    if not isinstance(agente_tecnia, dict):
        agente_tecnia = {}
    agente_tecnia["model"] = modelo
    agentes[agent] = agente_tecnia
    oc["agent"] = agentes
    instrucciones = oc.get("instructions")
    if not isinstance(instrucciones, list):
        instrucciones = []
    if perfil_path not in instrucciones:
        instrucciones.append(perfil_path)
    if memoria_path not in instrucciones:
        instrucciones.append(memoria_path)
    oc["instructions"] = instrucciones
    dump(oc_path, oc)
else:
    sys.stderr.write("  [AVISO] No pude parsear %s: lo dejo intacto.\n" % oc_path)
    sys.stderr.write("          Agregale a mano \"default_agent\": \"%s\" y el modelo del agente:\n" % agent)
    sys.stderr.write("          \"agent\": { \"%s\": { \"model\": \"%s\" } }\n" % (agent, modelo))
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
  if jq --arg agent "$TECNIA_AGENT" --arg schema "$OPENCODE_SCHEMA" --arg perfil "$PERFIL_FILE" --arg memoria "$MEMORIA_FILE" --arg modelo "$MODELO_ELEGIDO" '
          .["$schema"] = (.["$schema"] // $schema)
        | .default_agent = $agent
        | .agent = ((.agent // {}) | .[$agent] = ((.[$agent] // {}) | .model = $modelo))
        | .instructions = ((.instructions // []) | if any(. == $perfil) then . else . + [$perfil] end)
        | .instructions = ((.instructions // []) | if any(. == $memoria) then . else . + [$memoria] end)
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
    echo "            $(basename "$OPENCODE_JSON"): \"agent\": { \"$TECNIA_AGENT\": { \"model\": \"$MODELO_ELEGIDO\" } }"
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
  "default_agent": "$TECNIA_AGENT",
  "agent": { "$TECNIA_AGENT": { "model": "$MODELO_ELEGIDO" } },
  "instructions": ["$PERFIL_FILE", "$MEMORIA_FILE"]
}
EOF
    echo "  [OK] $(basename "$OPENCODE_JSON") creado."
  else
    echo "  [AVISO] No hay jq ni python3 y $OPENCODE_JSON ya existe: no lo toco."
    echo "          Agregale a mano: \"default_agent\": \"$TECNIA_AGENT\","
    echo "          el modelo: \"agent\": { \"$TECNIA_AGENT\": { \"model\": \"$MODELO_ELEGIDO\" } }"
    echo "          y en \"instructions\" (array) las rutas: \"$PERFIL_FILE\" y \"$MEMORIA_FILE\""
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

# pio en el PATH (comodidad: que 'pio' funcione pelado en la terminal).
# PlatformIO deja pio en su venv privado (~/.platformio/penv/bin), fuera del PATH.
# Tecnia Bot lo encuentra por ruta completa igual; esto es para uso manual. Corre en
# cada install/actualizar (idempotente, marcado con un comentario), asi le llega a todos.
PIO_DIR="$HOME/.platformio/penv/bin"
if [ -d "$PIO_DIR" ]; then
  case "${SHELL:-}" in
    *zsh)  RC="$HOME/.zshrc" ;;
    *bash) RC="$HOME/.bashrc" ;;
    *)     RC="$HOME/.profile" ;;
  esac
  MARCA="# Tecnia Bot: PlatformIO en el PATH"
  if ! { [ -f "$RC" ] && grep -qF "$MARCA" "$RC" 2>/dev/null; }; then
    {
      echo ""
      echo "$MARCA"
      echo 'export PATH="$HOME/.platformio/penv/bin:$PATH"'
    } >> "$RC"
  fi
  case ":$PATH:" in
    *":$PIO_DIR:"*) ;;
    *) export PATH="$PIO_DIR:$PATH" ;;
  esac
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
