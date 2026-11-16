#!/usr/bin/env bash
# ============================================================================
# Tecnia Bot — instalador COMPLETO para Linux / macOS.
# Instala TODO lo necesario en un solo paso:
#   1. OpenCode (el editor de IA donde vive Tecnia Bot)
#   2. PlatformIO Core (para compilar y cargar a la placa) — sin permisos de admin
#   3. Tecnia Bot (la capa educativa)
#
# Uso (desde la carpeta del repo):
#   bash install/bootstrap.sh
#
# UNA DEPENDENCIA QUE FALLA NO IMPIDE INSTALAR LA CAPA. Si OpenCode o PlatformIO
# no se pueden instalar (sin curl, sin red, python3 roto), se anota, se sigue, y
# Tecnia Bot se instala igual. El cierre dice lo que se COMPROBÓ de cada cosa.
#
# CÓDIGOS DE SALIDA:
#   0  todo comprobado: `opencode --version` contesta, un pio contesta --version,
#      y la capa quedó en disco con install.sh terminando en 0.
#   1  no se pudo ni empezar (falta install/OPENCODE_VERSION).
#   2  la capa de Tecnia Bot NO quedó instalada (install.sh falló o el agente no
#      está en disco). Es el caso grave: no hay Tecnia Bot.
#   3  la capa quedó instalada, pero falta OpenCode o PlatformIO, o install.sh
#      terminó CON AVISOS (su código 3). El resumen del final dice cuál.
#   4  se negó a correr: lo lanzaron con sudo o como root prestado. No tocó nada.
# ============================================================================
set -euo pipefail

# ---- No con sudo: el instalador es del USUARIO -------------------------------
# `sudo bash install/bootstrap.sh` (lo que sale por reflejo) instala para root: o
# todo termina en /root y el usuario abre opencode y no encuentra nada, o —si sudo
# conserva HOME— quedan archivos de root en la carpeta del usuario, que después no
# puede actualizar ni desinstalar. Nada de lo que hace este script necesita root.
#
# El caso legítimo es una sesión que ES root de verdad (un contenedor de CI, una
# imagen mínima sin otra cuenta): ahí no hay un usuario al que pisarle nada, y se
# instala para root avisándolo. Los dos casos se distinguen MIRANDO, no con una
# variable de escape: si alguien se elevó desde otra cuenta (sudo, doas y pkexec
# dejan su marca) o si la carpeta personal no es de root, se corta sin tocar nada.
# Lo que NO se detecta: un `su` a secas, que no deja marca y cambia HOME a /root.
#
# Repetida en bootstrap.sh e install.sh a propósito (cada uno corre solo); las
# mantiene iguales tests/instalador-root.test.mjs.
cortar_si_es_root_prestado() {
  [ "$(id -u)" = "0" ] || return 0
  local desde=""
  if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER:-}" != "root" ]; then
    desde="sudo, desde la cuenta $SUDO_USER"
  elif [ -n "${DOAS_USER:-}" ] && [ "${DOAS_USER:-}" != "root" ]; then
    desde="doas, desde la cuenta $DOAS_USER"
  elif [ -n "${PKEXEC_UID:-}" ] && [ "${PKEXEC_UID:-}" != "0" ]; then
    desde="pkexec"
  elif [ -d "${HOME:-}" ] && [ ! -O "${HOME:-}" ]; then
    desde="root, pero con una carpeta personal que no es de root ($HOME)"
  fi
  if [ -z "$desde" ]; then
    echo "  [i] Esta sesión es root: Tecnia Bot se instala para root, en ${HOME:-/root}."
    return 0
  fi
  echo "" >&2
  echo "  [✗] No corras este instalador con sudo ni como administrador." >&2
  echo "      Lo lanzaste con $desde." >&2
  echo "      Tecnia Bot se instala en la carpeta personal de quien lo usa y no necesita" >&2
  echo "      permisos de administrador. Como root quedaría instalado para root, o dejaría" >&2
  echo "      archivos de root en tu carpeta, que después no podés actualizar ni borrar." >&2
  echo "      Volvé a correrlo igual que antes pero SIN sudo." >&2
  echo "      No instalé ni toqué nada." >&2
  exit 4
}
cortar_si_es_root_prestado

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---- python3 que ANDA, no python3 que EXISTE --------------------------------
# En una Mac sin las Command Line Tools, /usr/bin/python3 es un stub: existe,
# `command -v python3` da verdadero, y al ejecutarlo falla. Preguntar sólo si
# EXISTE mandaba a este script por el camino de python3 con un python3 que no
# corre. Así que se lo EJECUTA de verdad, una vez, y el resultado se guarda en
# PYTHON3_ANDA: la llamada de más abajo deja la respuesta lista antes de que
# alguien pregunte desde un $(...), que es otro proceso y no podría guardarla.
#
# Esta función está repetida en bootstrap.sh, install.sh, update.sh y
# uninstall.sh A PROPÓSITO: ningún script hace dot-sourcing de otro, cada uno se
# copia y corre SOLO. Las mantiene iguales tests/python3-que-anda.test.mjs.
PYTHON3_ANDA=""
python3_anda() {
  if [ -z "$PYTHON3_ANDA" ]; then
    if command -v python3 >/dev/null 2>&1 && python3 -c 'import json' >/dev/null 2>&1; then
      PYTHON3_ANDA="si"
    else
      PYTHON3_ANDA="no"
    fi
  fi
  [ "$PYTHON3_ANDA" = "si" ]
}
python3_anda || true

# Versión de OpenCode probada con esta versión de Tecnia Bot. La FIJAMOS a propósito,
# por dos motivos:
#   1. El instalador de OpenCode, si no le pasás versión, le pregunta la última a la
#      API de GitHub, que limita a 60 pedidos/hora POR IP. En una escuela con muchas
#      PC detrás de una sola IP, a partir del pedido 60 la instalación falla
#      ("Failed to fetch version information"). Fijándola, se saltea ese pedido.
#   2. La capa educativa depende de detalles que OpenCode cambia entre versiones
#      (default_agent, instructions, agent.<nombre>.model, tui.json, plugins). Todas
#      las máquinas tienen que tener LA MISMA, la que se probó.
#
# La versión vive en install/OPENCODE_VERSION, UN solo archivo que también lee el
# instalador de Windows. Acá estaba escrita a mano y era distinta (y más vieja) que
# la que se llevaba Windows: dos plataformas, dos OpenCode. Si el archivo falta o
# está vacío se corta con un mensaje claro: instalar "la que sea" es justo lo que
# esto evita.
ARCHIVO_VERSION="$(dirname "${BASH_SOURCE[0]}")/OPENCODE_VERSION"
OPENCODE_VERSION=""
if [ -f "$ARCHIVO_VERSION" ]; then
  OPENCODE_VERSION="$(tr -d '[:space:]' < "$ARCHIVO_VERSION")"
fi
if ! [[ "$OPENCODE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo ""
  echo "  [✗] No se pudo leer la versión de OpenCode a instalar." >&2
  echo "      Tiene que estar en: $ARCHIVO_VERSION" >&2
  if [ -n "$OPENCODE_VERSION" ]; then
    echo "      Dice '$OPENCODE_VERSION' y se esperaba algo como 1.18.18." >&2
  else
    echo "      El archivo falta o está vacío. Volvé a descargar el proyecto." >&2
  fi
  exit 1
fi

# ---- Lo que hace falta para bajar cosas, mirado UNA vez y temprano ------------
# curl es el que usa este script y el que usa por dentro el instalador de OpenCode
# (https://opencode.ai/install llama a curl para bajar el binario): sin curl,
# OpenCode no se puede instalar desde acá y wget no lo reemplaza. Para PlatformIO
# sí alcanza con wget: lo único que se baja es get-platformio.py, y el resto lo
# hace python3.
DESCARGADOR=""
if command -v curl >/dev/null 2>&1; then
  DESCARGADOR="curl"
elif command -v wget >/dev/null 2>&1; then
  DESCARGADOR="wget"
fi

# descargar_a URL DESTINO, con el que haya. Devuelve distinto de 0 si no bajó.
descargar_a() {
  case "$DESCARGADOR" in
    curl) curl -fsSL -o "$2" "$1" ;;
    wget) wget -q -O "$2" "$1" ;;
    *) return 1 ;;
  esac
}

# Un solo temporal para todo, y se borra SIEMPRE: también si el script corta a
# mitad de camino. Antes el `rm -rf` iba después de python3, así que un python3
# que fallaba dejaba la carpeta tirada en /tmp.
TMP_BOOT=""
limpiar_temporal() {
  if [ -n "$TMP_BOOT" ]; then rm -rf "$TMP_BOOT"; fi
}
trap limpiar_temporal EXIT
# Si mktemp falla no hay dónde bajar nada: las dos instalaciones de abajo lo ven
# (TMP_BOOT vacío) y lo dicen, sin cortar.
TMP_BOOT="$(mktemp -d 2>/dev/null || true)"

# OpenCode que CONTESTA. Imprime lo que dice `opencode --version` (la primera
# línea), o nada y código 1. Antes alcanzaba con que el comando existiera: un
# binario roto o a medio bajar contaba como «ya está instalado».
version_de_opencode() {
  local v salto
  salto=$'\n'
  command -v opencode >/dev/null 2>&1 || return 1
  v="$(opencode --version 2>/dev/null)" || return 1
  v="${v%%"$salto"*}"
  [ -n "$v" ] || return 1
  printf '%s\n' "$v"
}

# Qué quedó de cada cosa. El cierre se arma SOLO con estas variables, y cada una
# se llena después de MIRAR (ejecutar el binario, o buscar el archivo en disco).
# *_FALTA vacío = comprobado que anda; con texto = el motivo, tal como se lee.
OPENCODE_DICE=""
OPENCODE_FALTA=""
PIO_FALTA=""

echo ""
echo "  🤖⚡  Tecnia Bot — instalación completa"
echo "  ─────────────────────────────────────"
echo ""

# --- 1. OpenCode ------------------------------------------------------------
if OPENCODE_DICE="$(version_de_opencode)"; then
  echo "  [✓] OpenCode ya está instalado ($OPENCODE_DICE)"
  # Se avisa, no se toca: este instalador no desinstala ni reemplaza nada que ande.
  if [ "${OPENCODE_DICE#*$OPENCODE_VERSION}" = "$OPENCODE_DICE" ]; then
    echo "  [i] Esta versión de Tecnia Bot se probó con OpenCode $OPENCODE_VERSION. Se deja la que hay;"
    echo "      si algo no anda, reinstalá con: curl -fsSL https://opencode.ai/install | bash -s -- --version $OPENCODE_VERSION"
  fi
else
  if command -v opencode >/dev/null 2>&1; then
    echo "  [!] Hay un opencode en esta compu ($(command -v opencode)) pero no contesta --version: lo reinstalo."
  fi
  if [ "$DESCARGADOR" != "curl" ]; then
    OPENCODE_FALTA="no hay curl en esta compu, y el instalador de OpenCode lo necesita"
    echo "  [✗] No puedo instalar OpenCode: falta curl (su instalador lo usa por dentro; wget no alcanza)."
    echo "      Debian/Ubuntu: sudo apt install curl      Arch/Manjaro: sudo pacman -S curl"
  elif [ -z "$TMP_BOOT" ]; then
    OPENCODE_FALTA="no pude crear una carpeta temporal para bajar su instalador"
    echo "  [✗] No puedo instalar OpenCode: no pude crear una carpeta temporal."
  else
    echo "  [↓] Instalando OpenCode v$OPENCODE_VERSION..."
    # Primero se BAJA entero y recién después se corre. Con `curl | bash` una
    # descarga cortada a la mitad le daba a bash medio script, y encima —sin `if`—
    # `set -e` cortaba este instalador antes de llegar a Tecnia Bot.
    if ! descargar_a "https://opencode.ai/install" "$TMP_BOOT/instalar-opencode.sh"; then
      OPENCODE_FALTA="no pude bajar su instalador de https://opencode.ai/install (¿sin internet, o la red lo bloquea?)"
      echo "  [✗] No pude bajar el instalador de OpenCode."
    elif ! bash "$TMP_BOOT/instalar-opencode.sh" --version "$OPENCODE_VERSION"; then
      OPENCODE_FALTA="su instalador falló (lo que dijo está más arriba)"
      echo "  [✗] El instalador de OpenCode falló."
    fi
    # el instalador agrega OpenCode al PATH del shell, pero esta sesión todavía
    # no lo ve: lo agregamos a mano para poder seguir.
    export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"
    # Se le PREGUNTA, haya dicho lo que haya dicho el instalador.
    if OPENCODE_DICE="$(version_de_opencode)"; then
      OPENCODE_FALTA=""
      echo "  [✓] OpenCode instalado ($OPENCODE_DICE)."
    elif [ -z "$OPENCODE_FALTA" ]; then
      OPENCODE_FALTA="su instalador terminó sin error pero \`opencode --version\` no contesta en esta terminal"
      echo "  [!] OpenCode se instaló pero no quedó en el PATH de esta terminal."
      echo "      Cerrá y abrí la terminal, o agregá su carpeta al PATH, y volvé a correr esto."
    fi
  fi
fi

# --- 2. PlatformIO Core ------------------------------------------------------
# TRES LUGARES DONDE BUSCAR, no uno — la misma lección que el lanzador de Windows
# (installer/abrir-tecnia-bot.cmd) aprendió buscando OpenCode, y la tercera vez que
# muerde en este repo. Acá mordía por PLATFORMIO_CORE_DIR: si el usuario la tiene
# seteada (o su distro se la setea), PlatformIO instala en otro lado y este script
# decía "no está instalado" con PlatformIO instalado y andando.
#
# El caso que destapó todo fue en Windows — una usuaria llamada `Dirección310`, con
# `ó`, que no es ASCII: PlatformIO no soporta rutas con caracteres no-ASCII y en
# Windows RELOCALIZA su core_dir a la raíz del disco. Esa relocalización es SOLO de
# Windows, así que acá NO se inventa: en Linux/macOS los candidatos son la variable
# de entorno, ~/.platformio y el PATH, y nada más.
#
# En cada carpeta se miran `pio` Y `platformio`: normalmente están los dos, pero el
# instalador oficial nombra `platformio` en su mensaje final y no queremos depender
# de que exista justo el que elegimos nosotros.
#
# Esta lógica está repetida en install.sh, bootstrap.ps1, diagnostico.ps1,
# install.ps1 y opencode/tool/platformio.ts, A PROPÓSITO: ningún script hace
# dot-sourcing de otro, cada uno se copia y corre SOLO. Lo que mantiene honestas a
# las copias es tests/platformio-pio.test.mjs.
pio_core_dirs() {
  if [ -n "${PLATFORMIO_CORE_DIR:-}" ]; then printf '%s\n' "$PLATFORMIO_CORE_DIR"; fi
  printf '%s\n' "$HOME/.platformio"
}

# Devuelve la ruta del pio que ANDA, o nada (y código 1).
#
# Al candidato se le PREGUNTA --version, no se supone que anda por donde vive: eso
# atrapa un venv a medio armar (el paquete no bajó pero la carpeta quedó). Cuesta un
# segundo y corre una sola vez. El tool platformio.ts NO pregunta — está en el camino
# caliente y le alcanza con que el archivo exista —; la asimetría es deliberada.
buscar_pio() {
  local dir nombre ruta salida
  while IFS= read -r dir; do
    for nombre in pio platformio; do
      ruta="$dir/penv/bin/$nombre"
      [ -x "$ruta" ] || continue
      if salida="$("$ruta" --version 2>&1)" && grep -qi platformio <<< "$salida"; then
        printf '%s\n' "$ruta"
        return 0
      fi
    done
  done < <(pio_core_dirs)
  # El PATH al final: PlatformIO casi nunca queda ahí, pero si alguien lo agregó a
  # mano (o install.sh ya corrió) es una respuesta válida.
  for nombre in pio platformio; do
    command -v "$nombre" >/dev/null 2>&1 || continue
    if salida="$("$nombre" --version 2>&1)" && grep -qi platformio <<< "$salida"; then
      command -v "$nombre"
      return 0
    fi
  done
  return 1
}

PIO_BIN="$(buscar_pio || true)"
if [ -n "$PIO_BIN" ]; then
  echo "  [✓] PlatformIO ya está instalado ($PIO_BIN)"
else
  echo "  [↓] Instalando PlatformIO Core (no necesita admin)..."
  # No se corta en NINGUNA de estas ramas: sin PlatformIO el bot igual sirve para
  # explicar, dibujar circuitos y repartir fichas. Sólo no puede compilar ni
  # cargar a la placa. Antes el comentario decía eso y el código hacía `exit 1`.
  if ! python3_anda; then
    if command -v python3 >/dev/null 2>&1; then
      PIO_FALTA="el python3 que hay ($(command -v python3)) no anda: lo ejecuté y falló"
      echo "  [✗] Hay un python3 en esta compu ($(command -v python3)) pero no anda: lo ejecuté y falló."
    else
      PIO_FALTA="falta Python 3, que es con lo que se instala"
      echo "  [✗] Falta Python 3: sin él no puedo instalar PlatformIO."
    fi
    if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ]; then
      echo "      macOS: xcode-select --install   (instala las Command Line Tools, que traen python3)"
    else
      echo "      Debian/Ubuntu: sudo apt install python3"
      echo "      Arch/Manjaro:  sudo pacman -S python"
    fi
  elif [ -z "$DESCARGADOR" ]; then
    PIO_FALTA="no hay curl ni wget para bajar su instalador"
    echo "  [✗] No puedo instalar PlatformIO: no hay curl ni wget en esta compu."
    echo "      Debian/Ubuntu: sudo apt install curl      Arch/Manjaro: sudo pacman -S curl"
  elif [ -z "$TMP_BOOT" ]; then
    PIO_FALTA="no pude crear una carpeta temporal para bajar su instalador"
    echo "  [✗] No puedo instalar PlatformIO: no pude crear una carpeta temporal."
  else
    if ! descargar_a "https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py" "$TMP_BOOT/get-platformio.py"; then
      PIO_FALTA="no pude bajar su instalador (¿sin internet, o la red bloquea GitHub?)"
      echo "  [✗] No pude bajar el instalador de PlatformIO."
    elif ! python3 "$TMP_BOOT/get-platformio.py"; then
      PIO_FALTA="su instalador falló (lo que dijo está más arriba)"
      echo "  [✗] El instalador de PlatformIO falló."
    fi
    # Se vuelve a BUSCAR: recién ahora sabemos dónde eligió instalarse, y se dice la
    # ruta REAL. Decir "~/.platformio" cuando quedó en otro lado manda a mirar una
    # carpeta que no existe — en Windows eso costó tres semanas de una docente.
    PIO_BIN="$(buscar_pio || true)"
    if [ -n "$PIO_BIN" ]; then
      PIO_FALTA=""
      echo "  [✓] PlatformIO instalado en $PIO_BIN (Tecnia Bot lo encuentra solo)."
    elif [ -z "$PIO_FALTA" ]; then
      PIO_FALTA="su instalador terminó sin error pero ningún pio contesta --version"
    fi
  fi
  if [ -n "$PIO_FALTA" ]; then
    echo "  [!] PlatformIO no quedó instalado. Tecnia Bot va a arrancar igual, pero"
    echo "      no va a poder compilar ni cargar a la placa hasta que esto se resuelva."
  fi
fi

# --- 3. Tecnia Bot (capa educativa) ------------------------------------------
# Corre SIEMPRE, haya pasado lo que haya pasado arriba. Su código se mira (3 es
# «instalado CON AVISOS», ver el encabezado de install.sh) y además se busca el
# agente en disco, en la carpeta de config REAL (la misma cuenta que hace
# install.sh, respetando XDG_CONFIG_HOME): un código 0 sin el archivo no alcanza.
echo ""
echo "  [↓] Instalando la capa de Tecnia Bot..."
RC_CAPA=0
bash "$REPO_DIR/install/install.sh" || RC_CAPA=$?
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
AGENTE_EN_DISCO="$CONFIG_DIR/agent/tecnia-bot.md"
CAPA="fallo"
if [ -s "$AGENTE_EN_DISCO" ]; then
  case "$RC_CAPA" in
    0) CAPA="ok" ;;
    3) CAPA="avisos" ;;
  esac
fi

# --- El cierre: lo que se comprobó, y NADA más -------------------------------
# Acá había un «✅ ¡Todo listo!» sin ninguna condición: salía igual con OpenCode
# sin instalar, sin PlatformIO o con la capa a medias. Ahora sale sólo si las
# tres cosas se comprobaron. Si falta algo, el resumen va AL FINAL —es lo que
# queda a la vista en la terminal— y el script sale distinto de 0.
echo ""
if [ -z "$OPENCODE_FALTA" ] && [ -z "$PIO_FALTA" ] && [ "$CAPA" = "ok" ]; then
  echo "  ✅ ¡Todo listo! Abrí una terminal en cualquier carpeta, escribí 'opencode',"
  echo "     apretá Tab y elegí 'tecnia-bot'."
  echo ""
  echo "  🔑 La API key de Google es opcional. Sin key, Tecnia Bot usa Big Pickle, el modelo"
  echo "     gratuito de OpenCode (gratis por tiempo limitado; OpenCode puede usar el chat"
  echo "     para mejorar el modelo). Con key usa Gemini: sacala gratis (sin tarjeta) en"
  echo "     https://aistudio.google.com/apikey y volvé a correr install/install.sh."
  echo ""
  exit 0
fi

echo "  ⚠️  La instalación NO quedó completa. Esto es lo que comprobé:"
echo ""
if [ -z "$OPENCODE_FALTA" ]; then
  echo "     [✓] OpenCode: contesta ($OPENCODE_DICE)."
else
  echo "     [✗] OpenCode: NO quedó instalado — $OPENCODE_FALTA."
  echo "         Sin OpenCode no hay dónde abrir Tecnia Bot."
fi
if [ -z "$PIO_FALTA" ]; then
  echo "     [✓] PlatformIO: contesta ($PIO_BIN)."
else
  echo "     [✗] PlatformIO: NO quedó instalado — $PIO_FALTA."
  echo "         Tecnia Bot igual explica, dibuja circuitos y reparte fichas; no compila ni carga a la placa."
fi
case "$CAPA" in
  ok)
    echo "     [✓] Tecnia Bot: la capa quedó instalada en $CONFIG_DIR."
    ;;
  avisos)
    echo "     [!] Tecnia Bot: la capa quedó en $CONFIG_DIR, pero su instalador terminó CON AVISOS."
    echo "         La lista de lo que falta está más arriba, donde dice «instalado CON AVISOS»."
    ;;
  *)
    echo "     [✗] Tecnia Bot: la capa NO quedó instalada (su instalador salió con código $RC_CAPA)."
    if [ ! -s "$AGENTE_EN_DISCO" ]; then
      echo "         Busqué el agente en $AGENTE_EN_DISCO y no está."
    fi
    ;;
esac
echo ""
echo "     Arreglá lo marcado y volvé a correr: bash install/bootstrap.sh"
echo "     (lo que ya quedó bien no se vuelve a instalar)."
echo ""
if [ "$CAPA" = "fallo" ]; then exit 2; fi
exit 3
