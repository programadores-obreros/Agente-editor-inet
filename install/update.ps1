# Actualiza Tecnia Bot a la ULTIMA VERSION PUBLICADA (el release que GitHub
# marca como "Latest", tag vX.Y.Z) y reinstala la capa.
#   - Si es un clon de git (dev, o instalacion en Linux por `git clone`): SIN
#     tocar cambios locales, hace fetch y se para en el tag del ultimo release.
#   - Si es la instalacion por .exe (docente, no es git): BAJA el fuente de ese
#     release, VERIFICA que lo bajado sea esa version, y solo entonces reemplaza
#     la copia maestra. Asi el docente se actualiza sin re-descargar el .exe ni
#     tocar OpenCode/PlatformIO.
#
# Antes bajaba la rama `main` entera (codigo sin publicar) y en un clon hacia
# `reset --hard` + `clean`, que borraba trabajo sin commitear. Ninguna de las
# dos cosas vuelve: la regla es PUEDE FALLAR, PERO NO PUEDE ROMPER. Si algo
# sale mal antes de reemplazar, la copia instalada queda exactamente como estaba;
# si sale mal durante el reemplazo, se deshace y se comprueba (ver mas abajo).
#
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File install\update.ps1
#
# CODIGOS DE SALIDA. Es un contrato: lo lee opencode\tool\actualizar.ts.
#   0  quedo en el ultimo release y la capa se reinstalo
#   1  no se pudo actualizar; el mensaje dice si la copia instalada quedo como
#      estaba (lo mas comun) o si quedo a medias
#   3  quedo en el ultimo release, pero install.ps1 termino CON AVISOS (su codigo
#      3: no pudo dejar escrita parte de la configuracion). Es "actualizado, con
#      algo pendiente", no "no se pudo actualizar".
#
# COMO SE REEMPLAZA LA COPIA INSTALADA (el camino del .exe), y por que asi.
# Antes era un `Copy-Item <lo bajado>\* <la instalacion> -Recurse -Force`, que solo
# AGREGA y PISA: un archivo que el release nuevo elimino o renombro seguia en
# {app}\opencode, install.ps1 lo volvia a publicar y quedaba en el manifest para
# siempre (un tool viejo al lado del nuevo, por ejemplo). Y si se cortaba a mitad,
# quedaba una mezcla de dos versiones. Ahora:
#   1. lo bajado se copia a carpetas NUEVAS al lado de las instaladas
#      (opencode.nuevo-<id>, install.nuevo-<id>) y se cuenta que haya llegado todo.
#      Hasta aca no se toco nada.
#   2. cada carpeta instalada se RENOMBRA a <nombre>.viejo-<id> y la nueva toma su
#      lugar. Un rename dentro del mismo disco es instantaneo y entero: la carpeta
#      queda con lo del release y nada mas.
#   3. VERSION se escribe AL FINAL: es lo que la proxima corrida mira para decidir
#      "ya estas en la ultima". Si algo fallo antes, sigue diciendo la version
#      vieja y la proxima corrida reintenta.
#   4. si algo falla en 2 o 3, se DESHACE (las .viejo vuelven a su lugar) y se
#      COMPRUEBA que haya quedado como estaba antes de decirlo.
# Solo se reemplazan opencode\ e install\ (y VERSION), que es lo que el .exe
# instala. Ya no se vuelca el repo entero (docs, tests...) adentro de {app}.
#
# ESTE ARCHIVO VIVE EN install\ Y SE REEMPLAZA A SI MISMO. PowerShell lee y compila
# el script entero antes de ejecutar la primera linea (no lo va leyendo del disco
# como hace cmd con un .cmd), asi que renombrar su carpeta no lo afecta. Pero el
# diseno no depende de eso: la carpeta vieja -con este archivo adentro- no se
# borra hasta el ULTIMO paso, y todo lo que sigue usa rutas calculadas al arrancar.

$ErrorActionPreference = "Stop"
# La barra de progreso de Invoke-WebRequest y Expand-Archive: en PowerShell 5.1
# hace las descargas varias veces mas lentas, y cuando la salida esta redirigida
# (asi lo lanza /actualizar) puede terminar ensuciando lo que el bot le muestra al
# docente.
$ProgressPreference = 'SilentlyContinue'
$RepoDir = Split-Path -Parent $PSScriptRoot
$Repo = "programadores-obreros/Agente-editor-inet"
$ApiUltimoRelease = "https://api.github.com/repos/$Repo/releases/latest"
# La API de GitHub rechaza pedidos sin User-Agent (403).
$UserAgent = "tecnia-bot-update"

# GitHub exige TLS 1.2; PowerShell 5.1 no lo habilita por defecto.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# Ultimo release PUBLICADO (ni draft ni prerelease): el que GitHub marca como
# Latest. Es lo mismo que ve el docente en la pagina de releases, y lo que
# docs/rollback.md mueve cuando hay que volver atras.
function Resolver-UltimoTag {
    $r = Invoke-RestMethod -Uri $ApiUltimoRelease -UserAgent $UserAgent -Headers @{ "Accept" = "application/vnd.github+json" } -TimeoutSec 60
    $tag = ("" + $r.tag_name).Trim()
    if ($tag -notmatch '^v\d+\.\d+\.\d+$') { throw "GitHub devolvio un tag que no entiendo: '$tag'." }
    return $tag
}

# El VERSION que vino adentro del zip tiene que ser el del tag (v0.3.75 -> 0.3.75).
# Si no coincide, lo bajado no es lo que pedimos y NO se copia nada.
#
# El MOTIVO de una falla que detectamos nosotros se deja en $script:Motivo, con un
# texto NUESTRO, y recien despues se tira. El catch de abajo imprime ese texto, o
# -si la falla vino de otro lado- el TIPO de la excepcion. Nunca su mensaje: el
# mensaje de un error de red trae la URL y el proxy (que en una escuela se
# configura como http://usuario:clave@proxy:8080), y lo que este script imprime
# termina en el chat del bot. Es la misma regla de install\diagnostico.ps1.
$script:Motivo = ""
function Fallar($texto) {
    $script:Motivo = $texto
    throw $texto
}

function Verificar-Version {
    param([string]$Dir, [string]$Tag)
    $esperada = $Tag.TrimStart("v")
    $f = Join-Path $Dir "VERSION"
    if (-not (Test-Path $f)) { Fallar "lo descargado no trae archivo VERSION: no lo instalo" }
    $real = (Get-Content $f -Raw).Trim()
    if ($real -ne $esperada) { Fallar "lo descargado dice version $real y el release es ${esperada}: no lo instalo" }
}

function Contar-Archivos($dir) {
    return @(Get-ChildItem -LiteralPath $dir -Recurse -File -Force).Count
}

# ---- El lanzador (abrir-tecnia-bot.cmd) ---------------------------------------
#
# El .exe lo instala en la RAIZ de la carpeta del programa, pero en el repo (y en
# el zip del release) vive en installer\: el reemplazo de opencode\ e install\ no
# lo alcanza, y /actualizar nunca lo actualizaba. Se copia aparte.
#
# CON UN CUIDADO QUE NO ES OPCIONAL. A diferencia de PowerShell, cmd.exe NO lee un
# .cmd entero: lo va leyendo del disco, comando por comando, recordando en que
# byte iba. Y /actualizar se corre DESDE ADENTRO del bot, que casi siempre se
# abrio con ese lanzador: cmd.exe esta parado en el medio del archivo, esperando
# que OpenCode termine. Cambiarle el archivo en ese momento hace que, al cerrar el
# bot, cmd siga leyendo desde el mismo byte de un archivo distinto: ejecuta un
# pedazo cualquiera de un renglon cualquiera. Por eso, si hay un cmd.exe corriendo
# el lanzador (o si no se puede averiguar), NO se toca y se avisa.
$NombreLanzador = "abrir-tecnia-bot.cmd"
function Lanzador-EnUso {
    try {
        foreach ($proc in @(Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" -ErrorAction Stop)) {
            if ($proc.CommandLine -and ($proc.CommandLine -like ("*" + $NombreLanzador + "*"))) { return $true }
        }
        return $false
    } catch {
        # No se pudo preguntar: se asume que SI. Dejar el lanzador viejo es seguro;
        # cambiarlo mientras se usa, no.
        return $true
    }
}

# Devuelve "" (no habia nada que hacer), "actualizado", "en-uso" o "no-pude".
function Actualizar-Lanzador($nuevo, $instalado) {
    if (-not (Test-Path -LiteralPath $nuevo)) { return "" }
    # Sin lanzador en la raiz no es una instalacion hecha con el .exe: no se crea uno.
    if (-not (Test-Path -LiteralPath $instalado)) { return "" }
    if ((Get-FileHash -LiteralPath $nuevo).Hash -eq (Get-FileHash -LiteralPath $instalado).Hash) { return "" }
    if (Lanzador-EnUso) { return "en-uso" }
    $temporal = $instalado + ".nuevo-" + $PID
    try {
        Copy-Item -LiteralPath $nuevo -Destination $temporal -Force
        [System.IO.File]::Replace($temporal, $instalado, [NullString]::Value)
    } catch {
        try { if (Test-Path -LiteralPath $temporal) { Remove-Item -LiteralPath $temporal -Force -ErrorAction SilentlyContinue } } catch { }
        return "no-pude"
    }
    # Se RELEE: "actualizado" solo si lo que quedo es lo que traia el release.
    if ((Get-FileHash -LiteralPath $nuevo).Hash -eq (Get-FileHash -LiteralPath $instalado).Hash) { return "actualizado" }
    return "no-pude"
}

function Version-Instalada {
    $f = Join-Path $RepoDir "VERSION"
    if (Test-Path $f) { return (Get-Content $f -Raw).Trim() }
    return ""
}

# Se usan al final del script; quedan vacias si no se pasa por el camino del .exe.
$Carpetas = $null
$Sufijo = ""
$ResultadoLanzador = ""

Write-Host "==> Actualizando Tecnia Bot..."

try {
    $tag = Resolver-UltimoTag
} catch {
    Write-Host "  [ERROR] No pude consultar cual es el ultimo release en GitHub (sin internet?)."
    Write-Host "          No toque nada: seguis con la version que tenias."
    exit 1
}
Write-Host "  Ultimo release publicado: $tag"

if ((Test-Path (Join-Path $RepoDir ".git")) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  [git] Es un clon de git."
    # OJO: git manda mensajes puramente informativos por stderr -- con
    # $ErrorActionPreference = "Stop", PowerShell los toma como error fatal
    # aunque el comando haya andado bien. Bajamos la preferencia y miramos el
    # exit code a mano en cada paso.
    $ErrorActionPreference = "Continue"

    # Solo cambios en archivos TRACKEADOS bloquean: son los unicos que un
    # checkout podria pisar. Los archivos sueltos (untracked) git no los toca
    # nunca -- si uno chocara con el tag, checkout falla solo y no pisa nada.
    $sucio = git -C $RepoDir status --porcelain --untracked-files=no 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Host "  [ERROR] git status fallo: no toco nada."; exit 1 }
    if ($sucio) {
        Write-Host "  [ERROR] Hay cambios sin commitear en $RepoDir, no toco nada."
        Write-Host "          Commitealos o guardalos (git stash) y volve a correr /actualizar."
        exit 1
    }

    git -C $RepoDir fetch --tags --quiet origin 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "  [ERROR] git fetch fallo (sin internet?): no toco nada."; exit 1 }

    $head = git -C $RepoDir rev-parse HEAD 2>$null
    $delTag = git -C $RepoDir rev-parse "$tag^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $delTag) { Write-Host "  [ERROR] El tag $tag no esta en este clon: no toco nada."; exit 1 }

    if ($head -eq $delTag) {
        Write-Host "  [OK] Ya estas en la ultima ($tag)."
    } else {
        # Checkout del TAG (queda en "detached HEAD"): lo que corre es exactamente
        # lo publicado, igual que en la instalacion por .exe. Un dev vuelve a su
        # rama con `git checkout main`. El arbol esta limpio (recien lo
        # chequeamos), asi que checkout no pisa nada.
        git -C $RepoDir checkout --quiet --detach $tag 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Host "  [ERROR] No pude pararme en ${tag}: no toco nada."; exit 1 }
        Write-Host "  [OK] Parado en $tag."
    }
    $ErrorActionPreference = "Stop"
} else {
    $instalada = Version-Instalada
    if ($instalada -eq $tag.TrimStart("v")) {
        Write-Host "  [OK] Ya estas en la ultima ($tag). No descargo nada."
    } else {
        Write-Host "  [web] Bajando el fuente del release $tag desde GitHub..."
        $tmp = Join-Path $env:TEMP ("tecnia-update-" + [Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Force -Path $tmp | Out-Null
        # Lo que se reemplaza, y con que sufijo se nombran las carpetas de paso.
        $Carpetas = @("opencode", "install")
        $Sufijo = [Guid]::NewGuid().ToString("N")
        # $Tocado: $false mientras la copia instalada esta EXACTAMENTE como estaba.
        # Se prende justo antes del primer rename. Es lo que permite decir la verdad
        # si algo falla: "no toque nada" y "falle a mitad" no son el mismo mensaje.
        $Tocado = $false
        # Las carpetas cuyo original ya se corrio a .viejo (para poder deshacer).
        $Corridas = New-Object System.Collections.ArrayList
        $paso = "bajando el release"
        $fallo = $false
        try {
            $zip = Join-Path $tmp "src.zip"
            Invoke-WebRequest -Uri "https://github.com/$Repo/archive/refs/tags/$tag.zip" -OutFile $zip -UseBasicParsing -UserAgent $UserAgent -TimeoutSec 300
            $paso = "descomprimiendo lo descargado"
            Expand-Archive -Path $zip -DestinationPath $tmp -Force
            $extracted = Get-ChildItem $tmp -Directory | Select-Object -First 1
            if (-not $extracted) { Fallar "no pude extraer el fuente descargado" }
            $paso = "verificando lo descargado"
            Verificar-Version -Dir $extracted.FullName -Tag $tag
            foreach ($c in $Carpetas) {
                if (-not (Test-Path -LiteralPath (Join-Path $extracted.FullName $c) -PathType Container)) {
                    Fallar "lo descargado no trae la carpeta ${c}: no lo instalo"
                }
            }

            # 1. Recien ahora, con lo bajado verificado, se arma la copia nueva AL
            #    LADO de la instalada. Todavia no se toco nada.
            $paso = "preparando la copia nueva"
            foreach ($c in $Carpetas) {
                $origen = Join-Path $extracted.FullName $c
                $nueva = Join-Path $RepoDir ($c + ".nuevo-" + $Sufijo)
                New-Item -ItemType Directory -Force -Path $nueva | Out-Null
                Copy-Item (Join-Path $origen "*") (Join-Path $RepoDir ($c + ".nuevo-" + $Sufijo)) -Recurse -Force
                if ((Contar-Archivos $nueva) -ne (Contar-Archivos $origen)) {
                    Fallar "la copia nueva de $c quedo incompleta"
                }
            }
            $versionNueva = Join-Path $RepoDir ("VERSION.nuevo-" + $Sufijo)
            Copy-Item -LiteralPath (Join-Path $extracted.FullName "VERSION") -Destination $versionNueva -Force

            # 2. El reemplazo: rename de la instalada a .viejo, rename de la nueva a
            #    su lugar. De aca en mas, una falla ya no es "no toque nada".
            $paso = "reemplazando la copia instalada"
            $Tocado = $true
            foreach ($c in $Carpetas) {
                $actual = Join-Path $RepoDir $c
                $vieja = Join-Path $RepoDir ($c + ".viejo-" + $Sufijo)
                $nueva = Join-Path $RepoDir ($c + ".nuevo-" + $Sufijo)
                if (Test-Path -LiteralPath $actual) { [System.IO.Directory]::Move($actual, $vieja) }
                [void]$Corridas.Add($c)
                [System.IO.Directory]::Move($nueva, $actual)
            }

            # 3. VERSION, al final y de una sola vez.
            $paso = "escribiendo VERSION"
            $versionInstalada = Join-Path $RepoDir "VERSION"
            if (Test-Path -LiteralPath $versionInstalada) {
                [System.IO.File]::Replace($versionNueva, $versionInstalada, [NullString]::Value)
            } else {
                [System.IO.File]::Move($versionNueva, $versionInstalada)
            }
            if ((Version-Instalada) -ne $tag.TrimStart("v")) { Fallar "escribi VERSION y al releerlo no dice $tag" }
            Write-Host "  [OK] Fuente actualizado a $tag."

            # El lanzador va aparte y NO deshace lo anterior si falla: ver arriba.
            $paso = "actualizando el lanzador"
            $ResultadoLanzador = ""
            try {
                $ResultadoLanzador = Actualizar-Lanzador (Join-Path $extracted.FullName ("installer\" + $NombreLanzador)) (Join-Path $RepoDir $NombreLanzador)
            } catch {
                $ResultadoLanzador = "no-pude"
            }
            if ($ResultadoLanzador -eq "actualizado") { Write-Host "  [OK] Lanzador ($NombreLanzador) actualizado." }
        } catch {
            $fallo = $true
            # El motivo NUESTRO si lo hay; si no, el TIPO de la excepcion. Nunca su mensaje.
            $queFallo = $script:Motivo
            if (-not $queFallo) { $queFallo = "fallo " + $paso + " (" + $_.Exception.GetType().Name + ")" }
            Write-Host "  [ERROR] No pude actualizar: $queFallo."
            if (-not $Tocado) {
                Write-Host "          No llegue a tocar la copia instalada: quedo como estaba (version $instalada)."
            }
            if ($Tocado) {
                # DESHACER, en orden inverso: lo nuevo que ya se habia puesto vuelve a
                # su carpeta de paso, y la .viejo vuelve a su lugar.
                $alReves = @($Corridas)
                [array]::Reverse($alReves)
                foreach ($c in $alReves) {
                    $actual = Join-Path $RepoDir $c
                    $vieja = Join-Path $RepoDir ($c + ".viejo-" + $Sufijo)
                    $nueva = Join-Path $RepoDir ($c + ".nuevo-" + $Sufijo)
                    try {
                        if (Test-Path -LiteralPath $vieja) {
                            if (Test-Path -LiteralPath $actual) { [System.IO.Directory]::Move($actual, $nueva) }
                            [System.IO.Directory]::Move($vieja, $actual)
                        }
                    } catch { }
                }
                # Y SE COMPRUEBA antes de decirlo: no quedo ninguna .viejo, las
                # carpetas estan, y VERSION sigue diciendo la version de antes.
                $volvio = ((Version-Instalada) -eq $instalada)
                foreach ($c in $Carpetas) {
                    if (Test-Path -LiteralPath (Join-Path $RepoDir ($c + ".viejo-" + $Sufijo))) { $volvio = $false }
                    if (-not (Test-Path -LiteralPath (Join-Path $RepoDir $c) -PathType Container)) { $volvio = $false }
                }
                if ($volvio) {
                    Write-Host "          Fallo A MITAD del reemplazo. Lo deshice y lo comprobe: la copia instalada"
                    Write-Host "          volvio a quedar como estaba (version $instalada)."
                }
                if (-not $volvio) {
                    Write-Host "          Fallo A MITAD del reemplazo y NO pude dejarlo como estaba: la copia instalada"
                    Write-Host "          en $RepoDir puede haber quedado con partes de dos versiones."
                    Write-Host "          Cerra Tecnia Bot y volve a correr el instalador (Instalar-Tecnia-Bot.exe): la rehace entera."
                    Write-Host "          Las carpetas que terminan en .viejo-$Sufijo tienen la version anterior: no las borre."
                }
            }
        } finally {
            Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
            # Las carpetas de paso con lo NUEVO no sirven mas, haya salido bien o mal.
            # Las .viejo NO se tocan aca: si salio bien se borran al final del script, y
            # si salio mal pueden ser la unica copia buena.
            foreach ($c in $Carpetas) {
                Remove-Item -LiteralPath (Join-Path $RepoDir ($c + ".nuevo-" + $Sufijo)) -Recurse -Force -ErrorAction SilentlyContinue
            }
            Remove-Item -LiteralPath (Join-Path $RepoDir ("VERSION.nuevo-" + $Sufijo)) -Force -ErrorAction SilentlyContinue
        }
        if ($fallo) { exit 1 }
    }
}

# Reinstala la capa (copia archivos + mergea config, idempotente). Corre aunque
# ya estuvieras en la ultima: es lo que aplica una key pegada con /connect.
# TECNIA_DESDE_ACTUALIZAR: el instalador NO baja las herramientas de las placas
# (mas de 1 GB) cuando lo llama /actualizar, que suele correrse en clase y sin
# mostrar progreso: seria el mismo cuelgue que se quiere evitar. Solo avisa.
$env:TECNIA_DESDE_ACTUALIZAR = "1"
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoDir "install\install.ps1")
$CodigoInstall = $LASTEXITCODE

# LO ULTIMO QUE SE HACE CON EL DISCO: borrar las carpetas .viejo del reemplazo.
# Adentro de install.viejo-<id> esta ESTE archivo; por eso va al final (ver el
# encabezado). Si no se pueden borrar no es una falla de la actualizacion: se dice
# y quedan ahi, sin uso.
if ($Carpetas -and $Sufijo) {
    foreach ($c in $Carpetas) {
        $vieja = Join-Path $RepoDir ($c + ".viejo-" + $Sufijo)
        if (Test-Path -LiteralPath $vieja) {
            Remove-Item -LiteralPath $vieja -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path -LiteralPath $vieja) { Write-Host "  [i] No pude borrar la copia anterior ($vieja). No se usa: se puede borrar a mano." }
        }
    }
}

Write-Host ""
if (($CodigoInstall -ne 0) -and ($CodigoInstall -ne 3)) {
    Write-Host "==> El fuente de Tecnia Bot quedo en $tag, pero la reinstalacion de la capa FALLO (codigo $CodigoInstall)."
    Write-Host "    Cerra Tecnia Bot y corre 'Reparar Tecnia Bot' desde el menu inicio."
    exit $CodigoInstall
}
if ($CodigoInstall -eq 3) {
    Write-Host "==> Tecnia Bot quedo actualizado CON AVISOS: la configuracion no quedo completa (el detalle esta mas arriba)."
    Write-Host "    Reinicia OpenCode para cargar los cambios."
}
if ($CodigoInstall -eq 0) {
    Write-Host "==> Tecnia Bot actualizado. Reinicia OpenCode para cargar los cambios."
}
# El aviso del lanzador va AL FINAL: es lo ultimo que queda en pantalla, y lo que
# /actualizar le muestra al docente es la cola de esta salida.
if ($ResultadoLanzador -eq "en-uso") {
    Write-Host ""
    Write-Host "  [AVISO] Esta version trae un lanzador nuevo ($NombreLanzador) y NO lo reemplace: hay una ventana"
    Write-Host "          de Tecnia Bot abierta con el anterior, y cambiarlo mientras se usa puede romperla."
    Write-Host "          Todo lo demas quedo actualizado. Para tener tambien el lanzador nuevo: cerra Tecnia Bot"
    Write-Host "          y corre el instalador de esta version (Instalar-Tecnia-Bot.exe)."
}
if ($ResultadoLanzador -eq "no-pude") {
    Write-Host ""
    Write-Host "  [AVISO] Esta version trae un lanzador nuevo ($NombreLanzador) y no pude reemplazarlo: quedo el anterior."
    Write-Host "          Todo lo demas quedo actualizado. Para tenerlo: cerra Tecnia Bot y corre el instalador"
    Write-Host "          de esta version (Instalar-Tecnia-Bot.exe)."
}
if ($CodigoInstall -eq 3) { exit 3 }
exit 0
