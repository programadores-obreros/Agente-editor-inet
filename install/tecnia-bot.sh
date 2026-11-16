#!/usr/bin/env bash
# tecnia-bot-lanzador — abre Tecnia Bot (OpenCode) revisando ANTES la carpeta.
#
# Lo instala install/install.sh en ~/.local/bin/tecnia-bot. Se usa en vez de `opencode`.
#
# POR QUÉ EXISTE (ciclo 4 de H1, MEDIDO en OpenCode 1.18.18): una configuración de OpenCode en
# la carpeta del proyecto o más arriba (`.opencode/`, `tui.json` con un plugin, …) puede
# aprobar sola el cartel de la carga a la placa, y OpenCode la guarda en memoria al arrancar:
# revisar el disco recién cuando se pide la carga no alcanza. Este lanzador:
#   1. limpia el entorno: saca TODA variable OPENCODE_* salvo las de la lista de abajo, y fija
#      OPENCODE_DISABLE_PROJECT_CONFIG=1 (segunda capa: OpenCode no lee la config del proyecto);
#   2. revisa la carpeta con la MISMA revisión que la tool (carga/revisar-lanzamiento.ts);
#   3. si dio limpio, exporta TECNIA_LANZADOR=<su pid> y hace `exec` de opencode (el pid pasa a
#      ser el de OpenCode); si no, abre IGUAL pero sin la marca, y avisa que en esta carpeta la
#      carga a la placa queda deshabilitada. Todo lo demás del bot funciona.
# La marca NO es una barrera contra quien lanza procesos como el usuario (se puede escribir a
# mano); es la prueba de que esta apertura pasó por la revisión previa.
#
# Si no hay `node` (la revisión es TypeScript del producto y corre con Node), se abre sin marca.
set -u

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
REVISION="$CONFIG_DIR/carga/revisar-lanzamiento.ts"

# Las únicas OPENCODE_* que pasan. Cada una con su porqué:
#   OPENCODE_DISABLE_CLAUDE_CODE: sólo APAGA la lectura de ~/.claude; no agrega configuración.
# OPENCODE_DISABLE_PROJECT_CONFIG la fija este lanzador (abajo). Todo lo demás se saca.
for variable in $(compgen -e); do
  case "$variable" in
    OPENCODE_DISABLE_CLAUDE_CODE) ;;
    OPENCODE_*) unset "$variable" ;;
  esac
done
export OPENCODE_DISABLE_PROJECT_CONFIG=1
unset TECNIA_LANZADOR

motivo=""
if ! command -v node >/dev/null 2>&1; then
  motivo="no encontré Node para revisar la carpeta"
elif [ ! -f "$REVISION" ]; then
  motivo="no encontré la revisión de Tecnia Bot ($REVISION)"
else
  salida="$(NODE_NO_WARNINGS=1 node "$REVISION" 2>/dev/null)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    motivo="${salida:-la revisión de la carpeta no terminó bien}"
  fi
fi

if [ -z "$motivo" ]; then
  export TECNIA_LANZADOR="$$"
else
  echo "Tecnia Bot: en esta carpeta la carga a la placa queda DESHABILITADA ($motivo). El resto funciona; para cargar, quitá eso o abrí Tecnia Bot en otra carpeta." >&2
fi

exec opencode "$@"
