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

# El id que entiende la API de Google es la parte de la DERECHA: el "google/" de
# adelante es el proveedor, y eso es sintaxis de OpenCode, no de Google. Se DERIVA
# de MODELO_CON_KEY a proposito -- si manana cambia el modelo, la prueba de la key
# apunta sola al nuevo y no queda un id viejo escondido en una URL. Es la misma
# derivacion que $ModeloApi en install.ps1 y MODELO_API en opencode/tool/clave.ts.
MODELO_API="${MODELO_CON_KEY##*/}"

# Cuanto se espera a Google antes de darse por vencido probando la key. En una
# escuela con la red filtrada el pedido no falla: se queda colgado. Quince segundos
# alcanzan para cualquier red que ande, y son quince segundos UNA vez por corrida.
TIMEOUT_PRUEBA_KEY=15
URL_PRUEBA_KEY="https://generativelanguage.googleapis.com/v1beta/models/${MODELO_API}:generateContent"
CUERPO_PRUEBA_KEY='{"contents":[{"parts":[{"text":"ping"}]}],"generationConfig":{"maxOutputTokens":1}}'

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

# ---- Probar la key CONTRA GOOGLE ---------------------------------------------
#
# EL SEGUNDO DEFECTO DEL 8 DE SEPTIEMBRE DE 2026. Con una key falsa el instalador
# imprimia "==> Modelo configurado: google/gemini-3.5-flash-lite (Gemini, con tu
# key de Google)". La key NUNCA se validaba: una credencial muerta, vencida o con
# la cuota agotada producia exactamente el mismo mensaje que una que anda. El
# docente leia que quedo todo configurado y se enteraba de que no al primer
# mensaje, con un error en ingles que no explica nada. Es el mismo defecto que el
# resto del repo persigue con nombre propio: afirmar sobre algo que no se miro
# (opencode/command/reparar.md: "Nunca digas que algo quedo instalado si el tool
# no lo dijo"). Esta contado entero en docs/key-de-google.md.
#
# CINCO RESULTADOS, y ninguno se puede confundir con otro. Son LOS MISMOS de
# probarClave() en opencode/tool/clave.ts y de Probar-KeyGoogle en install.ps1,
# con los mismos criterios y en el mismo orden -- si clasificaran distinto, el
# instalador y el bot le contarian a la misma docente dos historias diferentes de
# la misma key:
#
#   anda      -> Google contesto OK.
#   cuota     -> HTTP 429 / RESOURCE_EXHAUSTED. ES EL CASO DE LA ESCUELA: la key
#                es real y de la docente, lo que se acabo es el cupo gratis.
#   invalida  -> HTTP 400/403, INVALID_ARGUMENT / PERMISSION_DENIED /
#                UNAUTHENTICATED, o reason API_KEY_INVALID. La key no sirve.
#   modeloIdo -> HTTP 404 / NOT_FOUND. La key puede estar perfecta: el que no esta
#                es el MODELO. TIENE RAMA PROPIA porque el cajon de "no pude
#                probarla" le echa la culpa a la red, y aca la red anda perfecto:
#                mandaria al docente a pelearse con el proxy de la escuela por un
#                problema que esta del otro lado y que ninguna key arregla.
#   sinProbar -> cualquier otro HTTP (un 500/503 es de Google, no de la key) o una
#                excepcion de red. NUNCA se cuenta como "anda".
#
# Se devuelve una sola linea "resultado|detalle". Del cuerpo de la respuesta se
# miran SOLO error.status y los reason de error.details, que son tokens de una
# lista cerrada; el cuerpo entero no se imprime nunca, y de una excepcion no se
# imprime NADA salvo su tipo (el mensaje se lleva puesta la URL, o el proxy con su
# usuario:clave adentro). La key no se imprime jamas, ni un pedazo, ni su largo.
clasificar_respuesta_google() {
  # $1 = codigo HTTP, $2 = cuerpo de la respuesta.
  local codigo="${1:-0}" cuerpo="${2:-}"
  case "$codigo" in ''|*[!0-9]*) codigo=0 ;; esac
  if [ "$codigo" -ge 200 ] && [ "$codigo" -lt 300 ]; then printf 'anda|\n'; return 0; fi
  if [ "$codigo" = "429" ] || printf '%s' "$cuerpo" | grep -q '"RESOURCE_EXHAUSTED"'; then
    printf 'cuota|\n'; return 0
  fi
  if [ "$codigo" = "400" ] || [ "$codigo" = "403" ] \
    || printf '%s' "$cuerpo" | grep -qE '"(INVALID_ARGUMENT|PERMISSION_DENIED|UNAUTHENTICATED)"' \
    || printf '%s' "$cuerpo" | grep -q '"API_KEY_INVALID"'; then
    printf 'invalida|\n'; return 0
  fi
  # El modelo, no la key. Va ANTES del cajon de sinProbar a proposito.
  if [ "$codigo" = "404" ] || printf '%s' "$cuerpo" | grep -q '"NOT_FOUND"'; then
    printf 'modeloIdo|\n'; return 0
  fi
  printf 'sinProbar|Google contesto HTTP %s\n' "$codigo"
}

probar_key_google() {
  # $1 = la key. Imprime "resultado|detalle". Nunca falla: si no hay con que
  # probar, lo dice y sigue -- que una red caida (o una compu pelada) no deje sin
  # Tecnia Bot a un aula. No se inventan dependencias nuevas: python3 y curl son
  # los que este script ya da por posibles, y si no hay ninguno se avisa.
  if [ -z "${1:-}" ]; then printf 'sinProbar|no hay key que probar\n'; return 0; fi

  # LA KEY VA EN EL HEADER x-goog-api-key, NO EN EL QUERY STRING. Google acepta
  # las dos formas; con la del query string la key termina adentro de la URL, y la
  # URL termina adentro del texto de cualquier excepcion de red. Este repo ya tuvo
  # esa fuga con el proxy de la escuela. El header la deja afuera de todo lo que se
  # pueda imprimir por accidente.
  #
  # Y con python3 la key viaja por el ENTORNO del proceso hijo, no por la linea de
  # comandos: /proc/<pid>/cmdline lo lee cualquier proceso del mismo usuario y un
  # `ps` de otra terminal mostraria la key entera. Es la misma razon por la que
  # clave.ts se la pasa a PowerShell por el entorno.
  if command -v python3 >/dev/null 2>&1; then
    TECNIA_KEY_A_PROBAR="$1" python3 - "$URL_PRUEBA_KEY" "$TIMEOUT_PRUEBA_KEY" <<'PYEOF' 2>/dev/null || printf 'sinProbar|no pude correr la prueba (python3)\n'
import json, os, sys, urllib.request, urllib.error

url = sys.argv[1]
try:
    espera = float(sys.argv[2])
except Exception:
    espera = 15.0
key = os.environ.get("TECNIA_KEY_A_PROBAR", "")

def clasificar(codigo, cuerpo):
    status = ""
    razones = []
    try:
        d = json.loads(cuerpo)
        err = d.get("error") or {}
        s = err.get("status")
        if isinstance(s, str):
            status = s
        for det in (err.get("details") or []):
            if isinstance(det, dict) and isinstance(det.get("reason"), str):
                razones.append(det["reason"])
    except Exception:
        pass
    if codigo == 429 or status == "RESOURCE_EXHAUSTED":
        return "cuota|"
    if codigo in (400, 403) or status in ("INVALID_ARGUMENT", "PERMISSION_DENIED", "UNAUTHENTICATED") or "API_KEY_INVALID" in razones:
        return "invalida|"
    if codigo == 404 or status == "NOT_FOUND":
        return "modeloIdo|"
    return "sinProbar|Google contesto HTTP %d" % codigo

# El pedido mas chico que sirve de prueba: una palabra y un token de respuesta.
cuerpo = json.dumps({"contents": [{"parts": [{"text": "ping"}]}], "generationConfig": {"maxOutputTokens": 1}}).encode("utf-8")
req = urllib.request.Request(url, data=cuerpo, method="POST")
req.add_header("Content-Type", "application/json")
req.add_header("x-goog-api-key", key)
req.add_header("User-Agent", "tecnia-bot-instalador")
try:
    r = urllib.request.urlopen(req, timeout=espera)
    try:
        codigo = r.getcode()
    finally:
        r.close()
    print("anda|" if 200 <= codigo < 300 else clasificar(codigo, ""))
except urllib.error.HTTPError as e:
    try:
        texto = e.read().decode("utf-8", "replace")
    except Exception:
        texto = ""
    print(clasificar(e.code, texto))
except Exception as e:
    print("sinProbar|no hubo respuesta (%s)" % type(e).__name__)
PYEOF
    return 0
  fi

  if command -v curl >/dev/null 2>&1; then
    local cfg cuerpoResp codigo
    cfg="$(mktemp)" || { printf 'sinProbar|no pude crear un archivo temporal\n'; return 0; }
    cuerpoResp="$(mktemp)" || { rm -f "$cfg"; printf 'sinProbar|no pude crear un archivo temporal\n'; return 0; }
    # La key va en un archivo de configuracion de curl (-K), NO en la linea de
    # comandos, por lo mismo que arriba. mktemp lo crea con permisos 600 y se borra
    # apenas curl termina. Una key de Google es [A-Za-z0-9_-], asi que no hay nada
    # que escapar adentro de las comillas del archivo de config.
    printf 'header = "x-goog-api-key: %s"\n' "$1" > "$cfg"
    codigo="$(curl -s -o "$cuerpoResp" -w '%{http_code}' -X POST \
      --max-time "$TIMEOUT_PRUEBA_KEY" \
      -H 'Content-Type: application/json' \
      -A 'tecnia-bot-instalador' \
      -K "$cfg" \
      --data-binary "$CUERPO_PRUEBA_KEY" \
      "$URL_PRUEBA_KEY" 2>/dev/null)" || codigo=""
    rm -f "$cfg"
    if [ -z "$codigo" ] || [ "$codigo" = "000" ]; then
      rm -f "$cuerpoResp"
      printf 'sinProbar|no hubo respuesta (curl)\n'
      return 0
    fi
    clasificar_respuesta_google "$codigo" "$(cat "$cuerpoResp" 2>/dev/null || true)"
    rm -f "$cuerpoResp"
    return 0
  fi

  printf 'sinProbar|no hay python3 ni curl en esta compu para probarla\n'
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

# ---------------------------------------------------------------------------
# LA PREGUNTA POR LA KEY: TRES CAMINOS, Y EL DEFAULT SIEMPRE ES CONSERVAR
# ---------------------------------------------------------------------------
#
# Hasta la v0.3.78 habia DOS caminos: "no hay key -> preguntar" y "hay key -> no
# hacer nada". El segundo era una trampa sin salida.
#
# EL CASO REAL (escuela Juana Manso, 8 de septiembre de 2026). Varias docentes con
# la cuota de Google agotada corrieron "Reparar Tecnia Bot" para poder pegar una
# key nueva, y el instalador NUNCA se las pidio: la pregunta vivia adentro de la
# rama "no hay key", o sea que en una compu que ya tiene key no se ejecuta, y no
# importa cuantas veces se corra Reparar. Probaron con keys de otras cuentas y
# vieron el mismo error de siempre: las keys nuevas nunca entraron. Reproducido en
# la VM de Windows 10 con install.ps1, que tiene el mismo bloque: con key guardada
# no pregunta y auth.json ni se toca (misma fecha de modificacion antes y
# despues). Esta contado entero en docs/key-de-google.md.
#
# La idempotencia se puso por una buena razon -- no molestar al docente en cada
# actualizacion con algo que ya contesto -- pero se convirtio en una trampa justo
# para el caso en que HAY que rotar la key. Ahora hay un tercer camino: "hay key ->
# ofrecer cambiarla, con Enter para dejarla". Y una regla que no se negocia:
#
#   ENTER, TIMEOUT O CONSOLA SIN NADIE = SE DEJA LA QUE ESTA.
#
# Nunca se borra ni se pisa una key que funciona porque nadie contesto. Este script
# corre con la salida pipeada desde /actualizar (Bun.spawn(..., { stdout: "pipe",
# stderr: "pipe" }) en actualizar.ts): por esa via NO HAY NADIE que pueda tipear
# --`read` contra /dev/null vuelve vacio al toque-- y el silencio tiene que
# significar "dejala como esta", no "borrala". Para el docente que esta adentro del
# bot esta el comando /clave, que es el unico que puede conversar.
GEMINI_KEY=""
PRUEBA_KEY=""
if [ -n "${TECNIA_SIN_PROMPT:-}" ]; then
  # TECNIA_SIN_PROMPT: la CI (y cualquier despliegue desatendido) la define para
  # que este script no pregunte NADA. Sin key guardada se sigue sin key; con una
  # key guardada se deja la que esta. Saltear la pregunta NUNCA borra nada.
  echo ""
  if [ "$TIENE_GOOGLE" = "1" ]; then
    echo "  [i] TECNIA_SIN_PROMPT esta definida: no se pregunta nada y se deja la key de Google que ya estaba."
  else
    echo "  [i] TECNIA_SIN_PROMPT esta definida: no se pregunta la key de Google, se sigue sin key."
  fi
elif [ "$TIENE_GOOGLE" = "1" ]; then
  # EL CAMINO NUEVO. El texto nombra la cuota por PROYECTO porque es lo que mas
  # confunde y lo que hizo perder una tarde entera en la escuela: crear una key
  # nueva en el MISMO proyecto de Google no da cuota nueva.
  echo ""
  echo "==> Ya hay una key de Google guardada en esta compu."
  echo "    Si se te agoto la cuota, esta es la ocasion de cambiarla. OJO: la cuota gratuita de"
  echo "    Google es por PROYECTO, no por key -- una key nueva del MISMO proyecto da el mismo"
  echo "    error. Sacate una de otro proyecto (o de otra cuenta): https://aistudio.google.com/apikey"
  # Timeout de 60s: si esto corre sin terminal (pipe, deploy desatendido), read
  # se colgaria para siempre esperando una entrada que nunca llega. Y si vuelve
  # vacio -- Enter, timeout o /dev/null -- no se toca NADA.
  read -r -t 60 -p "    Enter para dejarla como esta, o pega una nueva para reemplazarla [60s]: " GEMINI_KEY || true
else
  echo ""
  echo "==> API key de Google (OPCIONAL). Con una key gratis (sin tarjeta) Tecnia Bot usa Gemini."
  echo "    Sacala en: https://aistudio.google.com/apikey (1 minuto, con cualquier cuenta de Google)"
  echo "    Se guarda en ESTA compu, nunca se comparte ni sube a ningun lado."
  # Timeout de 60s: si esto corre sin terminal (pipe, deploy desatendido), read
  # se colgaria para siempre esperando una entrada que nunca llega.
  read -r -t 60 -p "    Pegala aca, o Enter para seguir sin key: Tecnia Bot va a usar el modelo gratuito Big Pickle de OpenCode [60s]: " GEMINI_KEY || true
fi
# Una key no tiene espacios: se saca cualquier blanco que haya entrado al pegar.
GEMINI_KEY="$(printf '%s' "${GEMINI_KEY:-}" | tr -d ' \t\r\n')"

if es_key_vieja "$GEMINI_KEY"; then
  # La pego de algun apunte viejo: es la key compartida rotada. No se guarda.
  echo "  [X] Esa es la key de respaldo compartida de versiones anteriores: ya no es valida y no se guarda."
  echo "      Consegui la tuya en https://aistudio.google.com/apikey"
  if [ "$TIENE_GOOGLE" = "1" ]; then
    echo "      Se deja la key que ya estaba guardada: no se piso nada."
  else
    echo "      (seguimos sin key por ahora)."
  fi
elif [ -n "$GEMINI_KEY" ]; then
  # PROBAR ANTES DE GUARDAR, y guardar igual salvo un caso.
  #
  # Lo UNICO que impide guardar es que Google la RECHACE explicitamente (400/403 /
  # API_KEY_INVALID): eso casi siempre es una key cortada al copiar -- son
  # larguisimas -- y pisar con eso la key que ya estaba seria cambiarle un problema
  # por otro peor.
  #
  # Todo lo demas SE GUARDA y se informa. "No pude probarla" NO es motivo para
  # rechazar nada: si la red de la escuela no llega a Google, no sabemos NADA de la
  # key, y una instalacion no puede quedarse a medias porque el proxy filtra. Y una
  # cuota agotada es una key REAL del docente: guardarla no lo deja peor que antes,
  # y el mensaje del final le dice exactamente que hacer.
  #
  # (Aca esta la unica diferencia deliberada con probarClave() de clave.ts: alla la
  # prueba ademas DECIDE si guardar, porque alla hay una conversacion donde ofrecer
  # Big Pickle y volver a pedir la key. Aca, muchas veces, no hay nadie. La
  # CLASIFICACION es identica; lo que cambia es que se hace con ella.)
  echo "  [i] Probando la key contra Google (hasta ${TIMEOUT_PRUEBA_KEY}s)..."
  PRUEBA_NUEVA="$(probar_key_google "$GEMINI_KEY" | head -n 1 || true)"
  if [ "${PRUEBA_NUEVA%%|*}" = "invalida" ]; then
    echo "  [X] Probe esa key contra Google y la RECHAZO: no es una key valida, asi que no la guarde."
    echo "      Fijate de copiarla entera (son largas y a veces se corta al copiar), o saca una nueva"
    echo "      en https://aistudio.google.com/apikey y volve a correr este instalador."
    if [ "$TIENE_GOOGLE" = "1" ]; then
      echo "      Quedo la key que ya estaba guardada: no se piso nada."
    fi
  else
    # La key nueva ya quedo probada: no se la vuelve a probar mas abajo. Una
    # llamada por corrida y no dos -- cada prueba consume una del cupo gratis.
    PRUEBA_KEY="$PRUEBA_NUEVA"
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
  fi
else
  # Enter, timeout, consola sin nadie, o TECNIA_SIN_PROMPT. NO SE TOCA NADA: ni
  # auth.json ni ninguna otra cosa. Si habia una key sigue estando; si no habia, no
  # hay. Este es el default seguro, y es el que mas importa: un bug aca le borra la
  # key a una escuela entera sin que nadie haya pedido nada.
  if [ "$TIENE_GOOGLE" = "1" ]; then
    echo "  [i] Se deja la key de Google que ya estaba guardada."
  else
    echo "  [i] Seguimos sin key de Google."
  fi
fi

# ---- Probar la key que QUEDO, sea la nueva o la de siempre -------------------
#
# Este es el punto 3 del analisis de docs/key-de-google.md: validar antes de
# afirmar que quedo configurada. Se prueba la key EFECTIVA, no la que se tipeo: si
# el docente apreto Enter, la efectiva es la que ya estaba -- y es exactamente la
# que se quedo sin cuota el 8 de septiembre. Sin esto, el instalador seguiria
# terminando con un "quedo todo bien" sobre una credencial muerta.
#
# Si no se puede probar, la instalacion SIGUE igual y se avisa: que una red caida
# no deje sin Tecnia Bot a un aula.
if [ "$TIENE_GOOGLE" = "1" ] && [ -z "$PRUEBA_KEY" ]; then
  echo "  [i] Probando la key guardada contra Google (hasta ${TIMEOUT_PRUEBA_KEY}s)..."
  PRUEBA_KEY="$(probar_key_google "$GOOGLE_KEY_ACTUAL" | head -n 1 || true)"
fi
RESULTADO_KEY="${PRUEBA_KEY%%|*}"
DETALLE_KEY="${PRUEBA_KEY#*|}"

# Modelo del agente segun la decision de arriba. Se imprime SIEMPRE (tambien cuando
# la key ya estaba guardada), para que quede claro con que modelo quedo esta compu y
# como cambiarlo despues.
if [ "$TIENE_GOOGLE" = "1" ]; then
  MODELO_ELEGIDO="$MODELO_CON_KEY"
  # Antes aca decia, siempre y sin haber mirado nada, "(Gemini, con tu key de
  # Google)". Ahora se dice lo que Google contesto, y NADA MAS que eso: la unica
  # rama que afirma que anda es la que recibio un OK. "No pude probarla" no es
  # "anda" -- un OK falso es peor que un error, porque manda a buscar el problema al
  # lugar equivocado y el docente se va tranquilo con todo roto. El `*)` del final
  # se come cualquier resultado inesperado, asi que nunca se afirma de mas.
  echo "==> Modelo configurado: $MODELO_ELEGIDO"
  case "$RESULTADO_KEY" in
    anda)
      echo "    Probe tu key contra Google y respondio bien: Gemini quedo andando."
      ;;
    cuota)
      echo "    OJO: probe tu key y Google dice que la CUOTA GRATUITA de ese proyecto esta agotada."
      echo "    No rompiste nada y la key sigue siendo tuya, pero hasta que se renueve (se renueva sola)"
      echo "    Tecnia Bot va a fallar al primer mensaje. Lo que mas confunde: la cuota gratuita de Google"
      echo "    es por PROYECTO, no por key -- una key nueva del MISMO proyecto da el mismo error."
      echo "    Saca una de OTRO proyecto (o de otra cuenta) en https://aistudio.google.com/apikey"
      echo "    y pegala con /clave adentro de Tecnia Bot, o volve a correr este instalador."
      echo "    Si necesitas seguir trabajando ya mismo, /clave tambien te pasa al modelo gratuito Big Pickle."
      ;;
    invalida)
      echo "    OJO: probe la key guardada y Google la RECHAZO: no sirve."
      echo "    Escribi /clave adentro de Tecnia Bot para pegar una nueva, o saca una en"
      echo "    https://aistudio.google.com/apikey y volve a correr este instalador."
      ;;
    modeloIdo)
      echo "    OJO: la key esta bien -- el que no esta es el MODELO. Google dice que $MODELO_API ya no"
      echo "    esta disponible; pasa cuando retiran o renombran un modelo."
      echo "    NO es tu computadora, NO es tu key y NO es la red: no hay key nueva que lo arregle."
      echo "    Hace falta una version de Tecnia Bot que apunte a un modelo vigente: escribi /actualizar."
      ;;
    *)
      echo "    NO pude probar la key contra Google ($DETALLE_KEY), asi que NO se si anda."
      echo "    Suele ser la red: sin internet, o el filtro de la escuela bloqueando a Google."
      echo "    La instalacion siguio igual y la key quedo donde estaba: no se toco nada."
      echo "    Si al primer mensaje ves un error, escribi /clave adentro de Tecnia Bot para probarla de nuevo."
      ;;
  esac
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
    # autoupdate=false: OpenCode se auto-actualiza ante cualquier patch nueva y eso pisa
    # la version fijada en install/OPENCODE_VERSION (en Scoop hasta saltea el hold).
    oc["autoupdate"] = False
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
        | .autoupdate = false
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

# TRES LUGARES DONDE BUSCAR, no uno -- la misma leccion que el lanzador de Windows
# (installer/abrir-tecnia-bot.cmd) aprendio buscando OpenCode, y la tercera vez que
# muerde en este repo. Aca mordia por PLATFORMIO_CORE_DIR: si el usuario la tiene
# seteada, PlatformIO instala en otro lado y este script decia "[FALTA] PlatformIO
# no esta instalado" con PlatformIO instalado y andando.
#
# El caso que destapo todo fue en Windows -- una usuaria llamada `Direccion310`, con
# `o` acentuada, que no es ASCII: PlatformIO no soporta rutas con caracteres
# no-ASCII y en Windows RELOCALIZA su core_dir a la raiz del disco. Esa
# relocalizacion es SOLO de Windows, asi que aca NO se inventa: en Linux/macOS los
# candidatos son la variable de entorno, ~/.platformio y el PATH, y nada mas.
#
# En cada carpeta se miran `pio` Y `platformio`: normalmente estan los dos, pero el
# instalador oficial nombra `platformio` en su mensaje final y no queremos depender
# de que exista justo el que elegimos nosotros.
#
# Esta logica esta repetida en bootstrap.sh, bootstrap.ps1, diagnostico.ps1,
# install.ps1 y opencode/tool/platformio.ts, A PROPOSITO: ningun script hace
# dot-sourcing de otro, cada uno se copia y corre SOLO. Lo que mantiene honestas a
# las copias es tests/platformio-pio.test.mjs.
pio_core_dirs() {
  if [ -n "${PLATFORMIO_CORE_DIR:-}" ]; then printf '%s\n' "$PLATFORMIO_CORE_DIR"; fi
  printf '%s\n' "$HOME/.platformio"
}

# La carpeta penv/bin que hay que agregar al PATH, o nada. Aca NO se pregunta
# --version: es una comodidad del PATH, no un chequeo de que ande.
buscar_pio_dir() {
  local dir nombre
  while IFS= read -r dir; do
    for nombre in pio platformio; do
      if [ -x "$dir/penv/bin/$nombre" ]; then
        printf '%s\n' "$dir/penv/bin"
        return 0
      fi
    done
  done < <(pio_core_dirs)
  return 1
}

# El pio que ADEMAS contesta --version, o nada. Al candidato se le PREGUNTA, no se
# supone que anda por donde vive: eso atrapa un venv a medio armar. Cuesta un
# segundo y corre una sola vez. El tool platformio.ts NO pregunta -- esta en el
# camino caliente y le alcanza con que el archivo exista --; es deliberado.
buscar_pio() {
  local dir nombre ruta salida
  while IFS= read -r dir; do
    for nombre in pio platformio; do
      ruta="$dir/penv/bin/$nombre"
      [ -x "$ruta" ] || continue
      if salida="$("$ruta" --version 2>&1)" && printf '%s' "$salida" | grep -qi platformio; then
        printf '%s\n' "$ruta"
        return 0
      fi
    done
  done < <(pio_core_dirs)
  for nombre in pio platformio; do
    command -v "$nombre" >/dev/null 2>&1 || continue
    if salida="$("$nombre" --version 2>&1)" && printf '%s' "$salida" | grep -qi platformio; then
      command -v "$nombre"
      return 0
    fi
  done
  return 1
}

# pio en el PATH (comodidad: que 'pio' funcione pelado en la terminal).
# PlatformIO deja pio en su venv privado (penv/bin), fuera del PATH.
# Tecnia Bot lo encuentra por ruta completa igual; esto es para uso manual. Corre en
# cada install/actualizar (idempotente, marcado con un comentario), asi le llega a todos.
PIO_DIR="$(buscar_pio_dir || true)"
if [ -n "$PIO_DIR" ]; then
  case "${SHELL:-}" in
    *zsh)  RC="$HOME/.zshrc" ;;
    *bash) RC="$HOME/.bashrc" ;;
    *)     RC="$HOME/.profile" ;;
  esac
  MARCA="# Tecnia Bot: PlatformIO en el PATH"
  # En el rc se escribe $HOME literal cuando la carpeta cuelga del home: asi la
  # linea sigue sirviendo si el perfil se mueve. Si PlatformIO quedo en otro lado
  # (PLATFORMIO_CORE_DIR), va la ruta absoluta, que es la unica cierta. Antes iba
  # SIEMPRE la del home, asi que en ese caso el rc apuntaba a una carpeta vacia.
  PIO_DIR_RC="${PIO_DIR/#$HOME/\$HOME}"
  if ! { [ -f "$RC" ] && grep -qF "$MARCA" "$RC" 2>/dev/null; }; then
    {
      echo ""
      echo "$MARCA"
      echo "export PATH=\"$PIO_DIR_RC:\$PATH\""
    } >> "$RC"
  fi
  case ":$PATH:" in
    *":$PIO_DIR:"*) ;;
    *) export PATH="$PIO_DIR:$PATH" ;;
  esac
fi

# Chequear PlatformIO (en cualquiera de las rutas conocidas o en el PATH).
# Se dice la ruta real: "instalado" a secas manda a mirar la carpeta de siempre,
# que puede no ser donde quedo.
PIO_BIN="$(buscar_pio || true)"
if [ -n "$PIO_BIN" ]; then
  echo "  [OK] PlatformIO: $("$PIO_BIN" --version 2>/dev/null) ($PIO_BIN)"
else
  echo "  [FALTA] PlatformIO no esta instalado."
  echo "          Instalalo con: python3 <(curl -fsSL https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py)"
fi

echo ""
echo "Para empezar: abri una terminal en cualquier carpeta, escribi 'opencode',"
echo "apreta Tab y elegi 'tecnia-bot'."
