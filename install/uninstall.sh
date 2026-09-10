#!/usr/bin/env bash
# Desinstala Tecnia Bot de forma prolija: borra SOLO los archivos que instaló
# (según el manifest), sin tocar la config personal del usuario ni OpenCode/PlatformIO.

#
# Los datos PERSONALES (perfil/memoria del aula, key de Google) se PREGUNTAN, con
# 20 s de espera y "No" por defecto. Para no preguntar:
#   --conservar   los deja (lo que pasa si nadie contesta)
#   --borrar      los quita sin preguntar
#
# LA REGLA DE ESTE SCRIPT: despues de borrar, RELEER. Y decir SOLO lo que se
# comprobo. Un borrado que falla en silencio seguido de un mensaje que dice
# "borrado" es PEOR que no borrar nada, porque le saca a la docente la
# posibilidad de arreglarlo a mano. El caso real: una escuela reasigna la
# notebook, el desinstalador pregunta si quitar la key de Google, la docente dice
# que si, lee "Key de Google quitada", y la maquina se entrega con su credencial
# adentro. Todo borrado de aca abajo pasa por una relectura antes de afirmarse.

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

# ---- Borrar y RELEER (la regla del encabezado, en dos funciones) -------------
#
# Lo que quedo sin borrar se junta en PENDIENTES y sale en el mensaje final, para
# que el ultimo "Listo. Tecnia Bot desinstalado." tampoco afirme de mas.
# Se usa una cadena y no un array a proposito: macOS trae bash 3.2, y ahi
# expandir un array VACIO con `set -u` puesto aborta el script.
PENDIENTES=""
anotar_pendiente() { PENDIENTES="${PENDIENTES}    - $1"$'\n'; }

# Borra y devuelve 0 SOLO si al releer el archivo ya no esta.
# `-e` y no `-f`: tambien ve un symlink roto o un directorio que quedo en el medio.
# El `|| true` es necesario con `set -e`: sin el, un `rm` que falla (carpeta de
# solo lectura) corta el desinstalador de una sin decir una palabra.
borrar_verificando() {
  rm -f "$1" 2>/dev/null || true
  [ ! -e "$1" ]
}

# Borra cada archivo listado en el manifest (líneas de datos, no las de config).
# Si alguno no se pudo borrar (lo tipico: OpenCode abierto tomando un archivo),
# se dice cual y se CONSERVA el manifest: es la lista de lo que falta sacar, y
# sin ella la proxima corrida cree que no hay nada instalado y no borra nada.
NO_BORRADOS=0
while IFS= read -r rel; do
  case "$rel" in ""|"#"*|version=*|repo_dir=*) continue ;; esac
  if ! borrar_verificando "$CONFIG_DIR/$rel"; then
    NO_BORRADOS=$((NO_BORRADOS + 1))
    echo "  [X] No pude borrar $CONFIG_DIR/$rel (lo relei y sigue ahi)."
  fi
done < "$MANIFEST"

if [ "$NO_BORRADOS" = "0" ]; then
  borrar_verificando "$MANIFEST" || anotar_pendiente "el registro de la instalacion: $MANIFEST"
else
  echo "      Casi siempre es que OpenCode esta abierto y los tiene tomados."
  echo "      Cerra OpenCode y volve a correr el desinstalador."
  echo "      Dejo el registro ($MANIFEST) para que el proximo intento sepa que falta."
  anotar_pendiente "$NO_BORRADOS archivo(s) de Tecnia Bot en $CONFIG_DIR"
fi

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
      borrar_verificando "$TUI_JSON" || anotar_pendiente "la config que quedo de Tecnia Bot: $TUI_JSON"
    else
      # `mv -f`: sin -f, mv PREGUNTA si el destino no tiene permiso de escritura, y
      # aca la entrada estandar es la terminal de la docente -> quedaria esperando
      # una respuesta a una pregunta que nadie ve.
      mv -f "$tmp" "$TUI_JSON" 2>/dev/null || anotar_pendiente "la config que quedo de Tecnia Bot: $TUI_JSON"
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
      borrar_verificando "$OPENCODE_JSON" || anotar_pendiente "la config que quedo de Tecnia Bot: $OPENCODE_JSON"
    else
      mv -f "$tmp" "$OPENCODE_JSON" 2>/dev/null || anotar_pendiente "la config que quedo de Tecnia Bot: $OPENCODE_JSON"
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
    # RELEER DESPUES DE BORRAR. El `rm -f` de antes, con `set -e`, tampoco mentia:
    # cortaba el script de una, sin decir nada, justo a mitad del desinstalador.
    # Ahora se borra, se relee, y se dice lo que paso. Son datos de MENORES
    # (Ley 25.326, ver opencode/tool/memoria.ts): la docente tiene que poder
    # saber si quedaron y donde para sacarlos a mano.
    QUEDARON=""
    for f in "$PERFIL_FILE" "$MEMORIA_FILE"; do
      [ -e "$f" ] || continue
      borrar_verificando "$f" || QUEDARON="${QUEDARON}$f"$'\n'
    done
    if [ -z "$QUEDARON" ]; then
      echo "    Perfil y memoria borrados (los relei y ya no estan)."
    else
      echo "    [X] NO PUDE BORRAR estos datos personales: SIGUEN EN ESTA COMPUTADORA."
      printf '%s' "$QUEDARON" | while IFS= read -r f; do [ -n "$f" ] && echo "        $f"; done
      echo "        Casi siempre es que OpenCode esta abierto y los tiene tomados"
      echo "        (los dos entran por \"instructions\" de opencode.json)."
      echo "        Cerra OpenCode y volve a correr el desinstalador, o borralos a mano."
      anotar_pendiente "datos personales del aula en $CONFIG_DIR (tecnia-perfil.md / tecnia-memoria.md)"
    fi
  else
    echo "    Se conservan en $CONFIG_DIR: tecnia-perfil.md y tecnia-memoria.md (borralos a mano si querés)."
  fi
fi

# Key de Google en auth.json (se quita SOLO la entrada "google", el resto queda).
#
# Estado de la key: imprime "si", "no" o "?".
#   si = se leyo el archivo y la key esta
#   no = se leyo el archivo y la key NO esta  <- lo UNICO que habilita decir "quitada"
#   ?  = no se pudo leer (no hay jq ni python3, el JSON no parsea, un BOM que
#        esta version de jq no traga)
# El "?" es el estado que faltaba. Antes "no pude leer" y "no hay key" eran lo
# mismo (las dos cosas devolvian 1), y sobre esa confusion se afirmaba un borrado
# que nunca habia pasado.
auth_estado_google() {
  [ -f "$AUTH_FILE" ] || { printf 'no\n'; return 0; }
  if command -v python3 >/dev/null 2>&1; then
    # utf-8-sig y no utf-8 pelado: si auth.json tiene BOM (lo escribio un editor
    # de Windows), json.load revienta con "Unexpected UTF-8 BOM". Es el mismo BOM
    # que install.ps1 y uninstall.ps1 ya manejan del lado Windows; aca faltaba.
    python3 - "$AUTH_FILE" 2>/dev/null <<'PYEOF' || printf '?\n'
import json, sys
try:
    with open(sys.argv[1], "r", encoding="utf-8-sig") as f:
        d = json.load(f)
except Exception:
    print("?"); raise SystemExit(0)
if not isinstance(d, dict):
    print("?"); raise SystemExit(0)
g = d.get("google")
print("si" if isinstance(g, dict) and g.get("key") else "no")
PYEOF
  elif command -v jq >/dev/null 2>&1; then
    local salida
    # Si jq no puede parsear (BOM en jq viejo, JSON roto), sale != 0 -> "?".
    if salida="$(jq -r 'if ((.google.key? // "") | tostring) == "" then "no" else "si" end' "$AUTH_FILE" 2>/dev/null)"; then
      case "$salida" in si|no) printf '%s\n' "$salida" ;; *) printf '?\n' ;; esac
    else
      printf '?\n'
    fi
  else
    printf '?\n'
  fi
}

# Quita la entrada "google" de auth.json. Devuelve 0 SOLO si despues de escribir
# se RELEYO el archivo y la key ya no esta; devuelve 1 en todo el resto de los
# casos (sin jq ni python3, BOM que jq no traga, JSON que no parsea, archivo de
# solo lectura, mv que no pudo).
#
# LO QUE FALTABA ACA: el `else` del jq descartaba el temporal en silencio, y el
# estado del `if` terminaba siendo el del `rm -f` (0). La funcion devolvia 0, el
# llamador imprimia "Key de Google quitada" y la key seguia adentro. La guarda
# correcta ya existia a 70 lineas de distancia, en el camino de ESCRITURA de
# install.sh (el "[AVISO] No pude escribir $AUTH_FILE"): faltaba justo en el
# BORRADO, que es el unico de los dos con consecuencia de privacidad.
auth_quitar_google() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$AUTH_FILE" 2>/dev/null <<'PYEOF' || return 1
import json, sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8-sig") as f:
    d = json.load(f)
d.pop("google", None)
# Se reescribe SIN BOM: es lo que OpenCode necesita para poder leerlo.
with open(path, "w", encoding="utf-8") as f:
    json.dump(d, f, indent=2)
PYEOF
  elif command -v jq >/dev/null 2>&1; then
    local tmp; tmp="$(mktemp)"
    if jq 'del(.google)' "$AUTH_FILE" > "$tmp" 2>/dev/null; then
      # `mv -f`: sin -f, mv PREGUNTA si el destino no tiene permiso de escritura,
      # y aca la entrada estandar es la terminal de la docente -> se colgaria
      # esperando una respuesta a una pregunta que nadie ve.
      mv -f "$tmp" "$AUTH_FILE" 2>/dev/null || { rm -f "$tmp"; return 1; }
    else
      rm -f "$tmp"; return 1
    fi
  else
    return 1
  fi
  # RELEER. Que el borrado no haya tirado error no alcanza: lo unico que habilita
  # el mensaje de exito es volver a abrir el archivo y ver que la key no esta.
  [ "$(auth_estado_google)" = "no" ]
}

ESTADO_KEY_GOOGLE="$(auth_estado_google)"
if [ "$ESTADO_KEY_GOOGLE" = "si" ]; then
  if decidir "==> Hay una API key de Google guardada en auth.json. Es TU credencial, no del programa: si esta compu pasa a otra persona conviene quitarla. ¿Quitarla también?"; then
    if auth_quitar_google; then
      echo "    Key de Google quitada: relei $AUTH_FILE y ya no esta (las otras credenciales se preservan)."
    else
      echo "    [X] NO PUDE QUITAR LA KEY: tu credencial de Google SIGUE EN ESTA COMPUTADORA."
      echo "        Esta en: $AUTH_FILE (adentro, el bloque \"google\")."
      echo "        Si esta compu pasa a otra persona, sacala a mano ANTES de entregarla:"
      echo "        abri ese archivo con un editor de texto y borra el bloque \"google\": { ... },"
      echo "        o borra el archivo entero si no usas otras credenciales de OpenCode."
      echo "        (Otra opcion: instalar python3 o jq y volver a correr este desinstalador.)"
      anotar_pendiente "tu API key de Google en $AUTH_FILE"
    fi
  else
    echo "    La key de Google se conserva: OpenCode la sigue usando si lo abrís sin Tecnia Bot."
  fi
elif [ "$ESTADO_KEY_GOOGLE" = "?" ] && [ -s "$AUTH_FILE" ]; then
  # Ni siquiera se pudo LEER el archivo, asi que no se toco. Callarse aca es el
  # mismo problema con otra cara: la docente entrega la notebook creyendo que el
  # desinstalador miro, y adentro puede estar la key.
  echo ""
  echo "  [AVISO] No pude leer $AUTH_FILE (JSON roto, BOM, o no hay python3 ni jq)."
  echo "          NO SE si adentro quedo tu API key de Google, y no lo toque."
  echo "          Si esta compu pasa a otra persona, abrilo con un editor de texto:"
  echo "          si hay un bloque \"google\": { ... }, sacalo a mano antes de entregarla."
  anotar_pendiente "no pude verificar si tu API key de Google sigue en $AUTH_FILE"
fi
# En Linux/macOS el instalador nunca escribió la variable de entorno; si está,
# la puso alguien a mano en su shell y solo se puede avisar.
if [ -n "${GOOGLE_GENERATIVE_AI_API_KEY:-}" ]; then
  echo "  [AVISO] La variable GOOGLE_GENERATIVE_AI_API_KEY está definida en tu shell (~/.bashrc, ~/.zshrc o ~/.profile):"
  echo "          sacala a mano si ya no la querés."
fi

# Borra los directorios que hayan quedado vacíos (tecniabot-web, skills, plugins, themes...).
find "$CONFIG_DIR/tecniabot-web" "$CONFIG_DIR/skills" "$CONFIG_DIR/plugins" "$CONFIG_DIR/themes" -type d -empty -delete 2>/dev/null || true

# El mensaje final tampoco afirma de mas: si algo quedo sin borrar, se dice que
# la desinstalacion fue PARCIAL y se lista que quedo y donde.
if [ -z "$PENDIENTES" ]; then
  echo "==> Listo. Tecnia Bot desinstalado."
else
  echo "==> Tecnia Bot se desinstalo PARCIALMENTE. Quedo sin borrar:"
  printf '%s' "$PENDIENTES"
  echo "    Cerra OpenCode y volve a correr el desinstalador, o sacalo a mano."
fi
echo "    (OpenCode y PlatformIO NO se tocaron: son independientes.)"
