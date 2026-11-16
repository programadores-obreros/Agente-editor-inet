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
# antes de reemplazar, la copia instalada queda exactamente como estaba; si sale
# mal DURANTE el reemplazo, se vuelve atrás, y el mensaje dice cuál de las dos fue.
#
# CÓDIGOS DE SALIDA (los lee opencode/tool/actualizar.ts):
#   0  actualizado (o ya estaba en la última) y la capa reinstalada.
#   3  actualizado CON AVISOS: es el 3 de install.sh, pasado tal cual.
#   5  la copia quedó A MEDIAS y no se pudo volver atrás. No debería pasar; si
#      pasa, el mensaje dice dónde quedó lo anterior.
#   otro  no se actualizó, o el instalador de la capa falló. El motivo está arriba.
#
# DE DÓNDE SALE EL RELEASE: TECNIA_UPDATE_ESPEJO
#   Por defecto, de GitHub. En una escuela que lo tiene bloqueado (pasa: es el
#   mensaje de «no pude consultar GitHub» de /actualizar) se puede apuntar a un
#   ESPEJO con la misma forma, en un servidor de la escuela o en un pendrive:
#
#     TECNIA_UPDATE_ESPEJO=https://servidor.escuela/tecnia  bash install/update.sh
#     TECNIA_UPDATE_ESPEJO=file:///media/pendrive/tecnia    bash install/update.sh
#
#   El espejo tiene que servir dos cosas, con estos nombres exactos:
#     <espejo>/releases/latest                    un JSON con "tag_name": "vX.Y.Z"
#     <espejo>/archive/refs/tags/vX.Y.Z.tar.gz    el fuente de ese release, tal como
#                                                 lo baja GitHub (carpeta raíz
#                                                 Agente-editor-inet-X.Y.Z)
#   NO es un atajo: lo que viene del espejo pasa por las MISMAS verificaciones que
#   lo que viene de GitHub (forma del tag, VERSION del tar igual al tag, las
#   carpetas que tiene que traer). Sólo se aceptan https:// y file:/// —lo que se
#   baja se ejecuta, y por http plano cualquiera en la red lo puede cambiar—, y
#   cuando se usa se dice en la salida. file:/// necesita curl (wget no lo abre).
#   En un clon de git el espejo sólo dice CUÁL es el último tag: el código sale
#   de `origin`, como siempre. La tool /actualizar en modo «verificar» le sigue
#   preguntando a GitHub: el espejo es para correr este script a mano.
#
# TODO EL CUERPO VIVE EN FUNCIONES y la última línea es `main "$@"; exit $?`.
# bash lee el script de a pedazos MIENTRAS lo ejecuta: cuando este archivo se
# reemplazaba con `cp -rf` a mitad de la corrida, bash seguía leyendo el archivo
# NUEVO desde la posición del VIEJO y ejecutaba líneas cortadas por la mitad. Con
# todo adentro de funciones bash ya leyó el script entero antes de tocar nada, y
# el `exit` en la misma línea que `main` hace que no vuelva a leer.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="programadores-obreros/Agente-editor-inet"
# La API de GitHub rechaza pedidos sin User-Agent (403).
USER_AGENT="tecnia-bot-update"

# Las carpetas que son ENTERAS del release: se REEMPLAZAN, no se copian encima.
# opencode/ es lo que install.sh publica en la config de OpenCode y lista en el
# manifest; install/ son estos scripts. Un archivo que el release eliminó tiene
# que desaparecer de acá, o install.sh lo vuelve a instalar para siempre.
CARPETAS_DEL_RELEASE="opencode install"

# ---- python3 que ANDA, no python3 que EXISTE --------------------------------
# En una Mac sin las Command Line Tools, /usr/bin/python3 es un stub: existe,
# `command -v python3` da verdadero, y al ejecutarlo falla. Preguntar sólo si
# EXISTE mandaba a este script por el camino de python3 con un python3 que no
# corre. Así que se lo EJECUTA de verdad, una vez, y el resultado se guarda en
# PYTHON3_ANDA: main lo deja resuelto apenas arranca, antes de que alguien
# pregunte desde un $(...), que es otro proceso y no podría guardarlo.
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

# Decide de dónde sale el release y lo deja en API_ULTIMO_RELEASE / BASE_FUENTE.
# Devuelve 1 (sin haber bajado nada) si el espejo no es aceptable.
elegir_fuente() {
  local espejo="${TECNIA_UPDATE_ESPEJO:-}"
  if [ -z "$espejo" ]; then
    API_ULTIMO_RELEASE="https://api.github.com/repos/$REPO/releases/latest"
    BASE_FUENTE="https://github.com/$REPO"
    return 0
  fi
  case "$espejo" in
    https://?*|file:///?*) ;;
    *)
      echo "  [ERROR] TECNIA_UPDATE_ESPEJO tiene que empezar con https:// o con file:/// y dice otra cosa." >&2
      echo "          Lo que se baja de ahí se ejecuta en esta compu: por http plano cualquiera en la red lo puede cambiar." >&2
      echo "          No toqué nada." >&2
      return 1
      ;;
  esac
  espejo="${espejo%/}"
  API_ULTIMO_RELEASE="$espejo/releases/latest"
  BASE_FUENTE="$espejo"
  echo "  [i] TECNIA_UPDATE_ESPEJO está definida: el release NO sale de GitHub sino de $espejo"
}

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
  elif python3_anda; then
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
    echo "  [ERROR] El último release tiene un tag que no entiendo: '$tag'." >&2
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

# ---- Reemplazar la copia maestra SIN dejarla a medias ------------------------
#
# LO QUE ESTABA MAL. Era un `cp -rf "$extracted/." "$REPO_DIR/"`: copiar encima.
#   1. Nunca borra. Un archivo que el release eliminó (un comando renombrado, una
#      skill que se sacó) quedaba para siempre en opencode/, install.sh lo volvía a
#      publicar y lo anotaba en el manifest como si fuera de la versión nueva.
#   2. Si se cortaba a la mitad (disco lleno, un archivo sin permiso) quedaba una
#      mezcla de dos versiones, y el mensaje de arriba seguía diciendo «la copia
#      instalada quedó como estaba».
#   3. Pisaba install/update.sh mientras bash lo estaba leyendo.
#
# CÓMO ES AHORA, en cuatro pasos con un solo punto de no retorno:
#   1. Se copia TODO lo bajado a una carpeta al lado (.tecnia-update-nuevo), en el
#      mismo disco. Es el paso que más puede fallar y todavía no se tocó nada.
#   2. Cada carpeta del release se cambia con dos `mv` (renombrar es atómico): la
#      vieja a .tecnia-update-viejo, la nueva a su lugar. Lo eliminado desaparece.
#   3. El resto del proyecto (docs, README…) se copia encima: ahí puede haber
#      archivos del usuario y no se borra nada.
#   4. VERSION se mueve ÚLTIMO. Es lo que este script mira para saber si ya está
#      en la última: mientras no cambie, la próxima corrida reintenta.
# Si algo falla en 2, 3 o 4 se devuelven las carpetas viejas a su lugar.
#
# Deja en RESULTADO_REEMPLAZO qué pasó, para que el mensaje diga la verdad:
#   listo       todo reemplazado.
#   intacta     falló antes de tocar nada: la copia quedó como estaba.
#   deshecho    falló después, y se volvió atrás: lo que se instala quedó como estaba.
#   a-medias    falló y NO se pudo volver atrás.
STAGING_NUEVO=""
STAGING_VIEJO=""
RESULTADO_REEMPLAZO=""
RESTO_TOCADO=0

# Devuelve las carpetas viejas a su lugar. 0 SOLO si después de mover se volvió a
# mirar y cada una está donde tiene que estar.
deshacer_reemplazo() {
  local d mal=0
  for d in $CARPETAS_DEL_RELEASE; do
    if [ -e "$STAGING_VIEJO/$d" ]; then
      rm -rf "$REPO_DIR/$d" 2>/dev/null || true
      mv "$STAGING_VIEJO/$d" "$REPO_DIR/$d" 2>/dev/null || mal=1
    fi
    [ -d "$REPO_DIR/$d" ] || mal=1
  done
  if [ "$mal" = "0" ]; then rm -rf "$STAGING_NUEVO" "$STAGING_VIEJO" 2>/dev/null || true; fi
  return "$mal"
}

reemplazar_copia_maestra() {
  # $1 = carpeta con el fuente ya verificado
  local origen="$1" d entrada nombre
  STAGING_NUEVO="$REPO_DIR/.tecnia-update-nuevo"
  STAGING_VIEJO="$REPO_DIR/.tecnia-update-viejo"
  RESTO_TOCADO=0
  RESULTADO_REEMPLAZO="intacta"

  # Paso 1: todo al lado. Si no entra en el disco o no se puede escribir, se
  # entera acá, sin haber tocado un solo archivo de la copia instalada.
  for d in $CARPETAS_DEL_RELEASE; do
    if [ ! -d "$origen/$d" ]; then
      echo "  [ERROR] Lo descargado no trae la carpeta $d/: no es un release de Tecnia Bot." >&2
      return 1
    fi
  done
  rm -rf "$STAGING_NUEVO" "$STAGING_VIEJO" 2>/dev/null || true
  if ! mkdir "$STAGING_NUEVO" "$STAGING_VIEJO" 2>/dev/null; then
    echo "  [ERROR] No puedo escribir en $REPO_DIR (¿la carpeta es de otro usuario, o el disco está lleno?)." >&2
    rm -rf "$STAGING_NUEVO" "$STAGING_VIEJO" 2>/dev/null || true
    return 1
  fi
  if ! cp -R "$origen/." "$STAGING_NUEVO/" 2>/dev/null; then
    echo "  [ERROR] No pude copiar el release a $REPO_DIR (¿disco lleno?)." >&2
    rm -rf "$STAGING_NUEVO" "$STAGING_VIEJO" 2>/dev/null || true
    return 1
  fi
  # La versión de la que se parte queda anotada: si este script muere a mitad del
  # paso 2 (corte de luz), la próxima corrida la usa para saber si tiene que
  # devolver las carpetas viejas (ver recuperar_de_un_corte).
  if ! cp "$REPO_DIR/VERSION" "$STAGING_VIEJO/VERSION_ANTERIOR" 2>/dev/null; then
    : > "$STAGING_VIEJO/VERSION_ANTERIOR" 2>/dev/null || true
  fi

  # Paso 2: de acá en más, cualquier falla se deshace.
  RESULTADO_REEMPLAZO="deshecho"
  for d in $CARPETAS_DEL_RELEASE; do
    if [ -e "$REPO_DIR/$d" ] && ! mv "$REPO_DIR/$d" "$STAGING_VIEJO/$d" 2>/dev/null; then
      echo "  [ERROR] No pude apartar $REPO_DIR/$d para reemplazarla." >&2
      deshacer_reemplazo || RESULTADO_REEMPLAZO="a-medias"
      return 1
    fi
    if ! mv "$STAGING_NUEVO/$d" "$REPO_DIR/$d" 2>/dev/null; then
      echo "  [ERROR] No pude poner la carpeta $d/ nueva en su lugar." >&2
      deshacer_reemplazo || RESULTADO_REEMPLAZO="a-medias"
      return 1
    fi
  done

  # Paso 3: el resto, copiado encima. `.[!.]*` y `..?*` son los ocultos (el
  # release trae .gitignore y .github); si un patrón no encuentra nada queda el
  # texto del patrón, y el `-e` lo saltea.
  for entrada in "$STAGING_NUEVO"/* "$STAGING_NUEVO"/.[!.]* "$STAGING_NUEVO"/..?*; do
    [ -e "$entrada" ] || continue
    nombre="${entrada##*/}"
    if [ "$nombre" = "VERSION" ]; then continue; fi
    RESTO_TOCADO=1
    if ! cp -Rf "$entrada" "$REPO_DIR/" 2>/dev/null; then
      echo "  [ERROR] No pude copiar $nombre a $REPO_DIR." >&2
      deshacer_reemplazo || RESULTADO_REEMPLAZO="a-medias"
      return 1
    fi
  done

  # Paso 4: VERSION, último y con un rename.
  if ! mv -f "$STAGING_NUEVO/VERSION" "$REPO_DIR/VERSION" 2>/dev/null; then
    echo "  [ERROR] No pude actualizar $REPO_DIR/VERSION." >&2
    deshacer_reemplazo || RESULTADO_REEMPLAZO="a-medias"
    return 1
  fi
  RESULTADO_REEMPLAZO="listo"
  rm -rf "$STAGING_NUEVO" "$STAGING_VIEJO" 2>/dev/null || true
}

# Si una corrida anterior murió a mitad del reemplazo (corte de luz, alguien cerró
# la terminal) quedó .tecnia-update-viejo con las carpetas de antes. Se decide por
# VERSION, que es lo último que cambia: si sigue siendo la de antes, el reemplazo
# no llegó a terminar y se devuelven las carpetas viejas; si ya cambió, terminó y
# sólo sobraron restos. Sin esto, un corte dejaba opencode/ de una versión y
# VERSION de otra, y la corrida siguiente lo daba por bueno.
recuperar_de_un_corte() {
  local viejo="$REPO_DIR/.tecnia-update-viejo" nuevo="$REPO_DIR/.tecnia-update-nuevo" antes ahora
  if [ ! -d "$viejo" ]; then
    rm -rf "$nuevo" 2>/dev/null || true
    return 0
  fi
  antes="$(tr -d '[:space:]' < "$viejo/VERSION_ANTERIOR" 2>/dev/null || true)"
  ahora="$(tr -d '[:space:]' < "$REPO_DIR/VERSION" 2>/dev/null || true)"
  if [ -n "$antes" ] && [ "$antes" = "$ahora" ]; then
    STAGING_NUEVO="$nuevo"
    STAGING_VIEJO="$viejo"
    if deshacer_reemplazo; then
      echo "  [i] Una actualización anterior se cortó a la mitad: devolví opencode/ e install/ a la versión $ahora."
    else
      echo "  [ERROR] Una actualización anterior se cortó a la mitad y no pude devolver las carpetas a su lugar." >&2
      echo "          Lo anterior está en $viejo. Volvé a descargar el proyecto y corré bash install/bootstrap.sh." >&2
      return 1
    fi
  else
    rm -rf "$nuevo" "$viejo" 2>/dev/null || true
  fi
}

main() {
  # `tmp` es global a propósito: lo leen resolver_ultimo_tag y el trap, que corre
  # cuando main ya terminó.
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  python3_anda || true

  echo "==> Actualizando Tecnia Bot..."
  elegir_fuente || exit 1

  local tag del_tag instalada url extracted rc_instalador
  if ! tag="$(resolver_ultimo_tag)"; then
    echo "  [ERROR] No pude consultar cuál es el último release (¿sin internet?)." >&2
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
    recuperar_de_un_corte || exit 5
    instalada="$(tr -d '[:space:]' < "$REPO_DIR/VERSION" 2>/dev/null || true)"
    if [ "$instalada" = "${tag#v}" ]; then
      echo "  [OK] Ya estás en la última ($tag). No descargo nada."
    else
      echo "  [web] Bajando el fuente del release $tag..."
      url="$BASE_FUENTE/archive/refs/tags/$tag.tar.gz"
      if ! descargar "$url" "$tmp/src.tar.gz"; then
        echo "  [ERROR] La descarga falló. La copia instalada quedó como estaba (versión $instalada)." >&2
        exit 1
      fi
      if ! tar xzf "$tmp/src.tar.gz" -C "$tmp" 2>/dev/null; then
        echo "  [ERROR] Lo descargado no se puede descomprimir (¿descarga cortada?)." >&2
        echo "          La copia instalada quedó como estaba (versión $instalada)." >&2
        exit 1
      fi
      extracted="$(find "$tmp" -maxdepth 1 -type d -name 'Agente-editor-inet-*' | head -1)"
      if [ -z "$extracted" ]; then
        echo "  [ERROR] No pude extraer el fuente descargado." >&2
        echo "          La copia instalada quedó como estaba (versión $instalada)." >&2
        exit 1
      fi
      if ! verificar_version "$extracted" "$tag"; then
        echo "          La copia instalada quedó como estaba (versión $instalada)." >&2
        exit 1
      fi
      # Recién ahora, con lo bajado verificado, se reemplaza la copia maestra. Lo
      # que se dice después sale de RESULTADO_REEMPLAZO: «quedó como estaba» se
      # imprime sólo en el caso en que es cierto.
      if ! reemplazar_copia_maestra "$extracted"; then
        case "$RESULTADO_REEMPLAZO" in
          intacta)
            echo "          No llegué a tocar nada: la copia instalada quedó como estaba (versión $instalada)." >&2
            exit 1
            ;;
          deshecho)
            echo "          Volví atrás: opencode/ e install/ son otra vez los de la versión $instalada," >&2
            echo "          y VERSION no cambió, así que /actualizar lo va a reintentar." >&2
            if [ "$RESTO_TOCADO" = "1" ]; then
              echo "          En el resto de la carpeta ($REPO_DIR) pueden haber quedado archivos de $tag" >&2
              echo "          a medio copiar (documentación, README): no son parte de lo que se instala." >&2
            fi
            exit 1
            ;;
          *)
            echo "  [ERROR] La copia quedó A MEDIAS y no pude volver atrás." >&2
            echo "          Lo anterior está en $STAGING_VIEJO." >&2
            echo "          Volvé a descargar el proyecto y corré bash install/bootstrap.sh." >&2
            exit 5
            ;;
        esac
      fi
      echo "  [OK] Fuente actualizado a $tag."
    fi
  fi

  # Reinstala la capa (copia archivos + mergea config, idempotente). Corre aunque
  # ya estuvieras en la última: es lo que aplica una key pegada con /connect.
  # TECNIA_DESDE_ACTUALIZAR: el instalador NO baja las herramientas de las placas
  # (mas de 1 GB) cuando lo llama /actualizar, que suele correrse en clase y sin
  # mostrar progreso: seria el mismo cuelgue que se quiere evitar. Solo avisa.
  #
  # El código del instalador se MIRA: 3 es «instalado CON AVISOS» (ver el encabezado
  # de install.sh) — la capa se copió pero algo de la config de OpenCode no quedó
  # escrito. Antes `set -e` cortaba acá con cualquier código distinto de 0 y este
  # script nunca decía nada; ahora dice cuál de los tres casos fue, y sale con el
  # mismo código para que opencode/tool/actualizar.ts pueda contarlo bien.
  rc_instalador=0
  TECNIA_DESDE_ACTUALIZAR=1 bash "$REPO_DIR/install/install.sh" || rc_instalador=$?

  echo ""
  case "$rc_instalador" in
    0)
      echo "==> Tecnia Bot actualizado. Reiniciá OpenCode para cargar los cambios."
      ;;
    3)
      echo "==> Tecnia Bot actualizado CON AVISOS: los archivos nuevos se copiaron, pero el"
      echo "    instalador no pudo dejar escrito todo (lo que falta está en las líneas de arriba)."
      echo "    Reiniciá OpenCode igual para cargar lo que sí cambió."
      exit 3
      ;;
    *)
      echo "  [ERROR] El instalador de la capa falló (código $rc_instalador): Tecnia Bot NO quedó actualizado del todo." >&2
      echo "          Lo que haya dicho arriba es el motivo. Probá de nuevo con: bash $REPO_DIR/install/install.sh" >&2
      exit "$rc_instalador"
      ;;
  esac
}

main "$@"; exit $?
