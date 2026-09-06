# ============================================================================
# Tecnia Bot - instalador COMPLETO para Windows (PowerShell).
# Instala TODO en un solo paso y SIN permisos de administrador (usa Scoop):
#   1. Scoop (gestor de paquetes en espacio de usuario)
#   2. OpenCode (el editor de IA donde vive Tecnia Bot)
#   3. Python + PlatformIO Core (para compilar y cargar a la placa)
#   4. Tecnia Bot (la capa educativa)
#
# Uso: clic derecho -> "Ejecutar con PowerShell", o desde una terminal:
#   powershell -ExecutionPolicy Bypass -File install\bootstrap.ps1
# ============================================================================
$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $PSScriptRoot

# ---- TODO LO QUE PASA ACA QUEDA ESCRITO -------------------------------------
#
# ESTO TENDRIA QUE HABER EXISTIDO DESDE EL PRIMER DIA, y no tenerlo costo una
# jornada entera de deducir desde afuera.
#
# Inno lanza este script en su propia consola y la CIERRA al terminar. Si algo
# falla, el mensaje --que existe, y es bueno-- aparece 200 ms y desaparece. Lo
# unico que queda es un numero en el log de Inno: "Process exit code: 1". Con eso
# hubo que adivinar en que paso murio, en dos maquinas distintas, con dos tiempos
# distintos: una en 2,4 segundos y otra en 41.
#
# Con el transcript, la proxima vez no se adivina: se lee.
#
# Va al lado del programa, no a %TEMP%, para que el diagnostico lo encuentre solo
# y el docente lo pueda mandar sin buscarlo.
#
# Y NO SE PISA. Cada "Reparar Tecnia Bot" volvia a escribir el mismo archivo con
# -Force y se llevaba la corrida anterior: justo la que fallo, la unica que hacia
# falta leer. Ahora la anterior se renombra con su fecha antes de empezar y se
# guardan las ultimas 5. instalacion.log sigue siendo siempre la corrida mas
# reciente, asi diagnostico.ps1 la encuentra igual que antes.
$LogInstalacion = Join-Path $RepoDir "instalacion.log"
try {
    if (Test-Path $LogInstalacion) {
        $marca = (Get-Item $LogInstalacion).LastWriteTime.ToString("yyyyMMdd-HHmmss")
        Move-Item $LogInstalacion (Join-Path $RepoDir ("instalacion-" + $marca + ".log")) -Force
    }
    Get-ChildItem $RepoDir -Filter "instalacion-*.log" | Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 5 | Remove-Item -Force -ErrorAction SilentlyContinue
} catch { }
try { Start-Transcript -Path $LogInstalacion -Force | Out-Null } catch { }

# ---- LA VERSION DE OPENCODE ESTA FIJADA, Y EN UN SOLO LUGAR -------------------
#
# Hasta aca este script hacia `scoop install opencode` a secas: cada PC de la
# escuela se llevaba la version que fuera la ultima ESE DIA. Mientras tanto,
# bootstrap.sh (Linux/mac) fijaba una version, distinta y vieja. Dos maquinas
# instaladas con una semana de diferencia tenian dos OpenCode distintos, y la
# capa educativa depende de detalles que OpenCode cambia entre versiones
# (default_agent, instructions, agent.<nombre>.model, tui.json, el cargador de
# plugins). Un "anda en mi maquina" que no se podia reproducir en la otra.
#
# La version vive en install\OPENCODE_VERSION -- un archivo, no una variable en
# dos scripts -- para que Windows y Linux instalen LO MISMO y para que cambiarla
# sea un commit que se ve. Se lee relativo a este script porque el .exe copia
# install\ entero al lado; si falta, se corta con un mensaje claro: instalar
# "la que sea" es exactamente el problema que esto vino a resolver.
$ArchivoVersionOpenCode = Join-Path $PSScriptRoot "OPENCODE_VERSION"
$OpenCodeVersion = ""
if (Test-Path $ArchivoVersionOpenCode) {
    $OpenCodeVersion = (Get-Content $ArchivoVersionOpenCode -Raw).Trim()
}
if ($OpenCodeVersion -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host ""
    Write-Host "  [X] No se pudo leer la version de OpenCode a instalar." -ForegroundColor Red
    Write-Host "      Tiene que estar en: $ArchivoVersionOpenCode"
    if ($OpenCodeVersion) { Write-Host "      Dice '$OpenCodeVersion' y se esperaba algo como 1.18.18." }
    else { Write-Host "      El archivo falta o esta vacio. Volve a descargar el instalador." }
    Write-Host ""
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
}

# TLS 1.2 explicito. Medido en un Windows 10 22H2 con .NET 4.8: el default es
# SystemDefault y negocia 1.2 solo, asi que NO es el problema habitual que
# cuentan por ahi. Pero SystemDefault obedece a la configuracion del equipo, y en
# una PC de escuela administrada eso lo toca otro. Una linea que no cuesta nada.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

# Baja algo reintentando. La primera version bajaba de una sola pasada, y este
# instalador esta pensado para escuelas con internet flojo: una descarga cortada
# no puede ser el final del camino, tiene que ser un reintento.
#
# Tres intentos con pausas crecientes (2 s, 4 s). Con techo, porque colgarse
# reintentando en la maquina de alguien es tan malo como fallar.
function Bajar {
    param([string]$Url, [string]$Destino)
    for ($i = 1; $i -le 3; $i++) {
        try {
            if ($Destino) { Invoke-RestMethod -Uri $Url -OutFile $Destino -TimeoutSec 120 }
            else { return Invoke-RestMethod -Uri $Url -TimeoutSec 120 }
            return $true
        } catch {
            if ($i -eq 3) { throw }
            Write-Host ("  [i] La descarga fallo (intento $i de 3). Reintento en " + (2 * $i) + " s...")
            Start-Sleep -Seconds (2 * $i)
        }
    }
}

Write-Host ""
Write-Host "  Tecnia Bot - instalacion completa (sin admin)"
Write-Host "  --------------------------------------------"
Write-Host ""

# Asegura que los 'shims' de Scoop esten en el PATH de ESTA sesion
$ScoopShims = Join-Path $env:USERPROFILE "scoop\shims"
function Refresh-Path {
    if (Test-Path $ScoopShims) { $env:PATH = "$ScoopShims;$env:PATH" }
}

# Pregunta si OpenCode CORRE, no si el archivo existe. No es lo mismo, y la
# diferencia la pagaba el docente: un shim que apunta a una carpeta vacia existe
# igual, y el instalador decia [OK] sobre eso. El problema aparecia recien al
# abrir el bot, lejos de la causa y sin ninguna pista.
#
# Antes se miraba 'scoop\shims\opencode.cmd'. Ese archivo NO EXISTE NUNCA: Scoop
# crea 'opencode.exe' y 'opencode.shim'. Era una verificacion que siempre daba
# falso y no verificaba nada.
#
# 'opencode --version' tarda menos de un segundo y devuelve exit 0. Es barato y
# es la unica prueba que vale: el programa arranco.
# Donde vive el binario de verdad, mas alla del shim.
$OpenCodeAppDir = Join-Path $env:USERPROFILE "scoop\apps\opencode"
$BinOpenCode = Join-Path $OpenCodeAppDir "current\opencode.exe"
$ShimOpenCode = Join-Path $env:USERPROFILE "scoop\shims\opencode.exe"

# Que OpenCode CORRA no alcanza: tiene que ser el que SCOOP ADMINISTRA.
#
# Se vio en la VM: despues de `scoop uninstall opencode`, este instalador decia
# "[OK] OpenCode ya esta instalado" y no instalaba nada. En scoop\shims\opencode.exe
# habia un binario ENTERO de 178 MB que dejo la version anterior de Reparar-Shim
# (copiaba el programa completo como si fuera el lanzador). Scoop no sabe de ese
# archivo: uninstall no lo borra, `Get-Command opencode` lo encuentra, y cuando
# Scoop actualice o resetee, ese "shim" seguira ejecutando la version vieja para
# siempre. Un OpenCode fantasma, fuera de todo control de version.
#
# Scoop registra lo que instalo en apps\opencode\current\manifest.json: si eso no
# esta, para Scoop OpenCode no existe, corra lo que corra.
function Test-OpenCodeScoop {
    return (Test-Path (Join-Path $OpenCodeAppDir "current\manifest.json"))
}

# Repara el shim cuando el programa ESTA pero le falta su lanzador de 20 KB.
#
# Scoop instala en dos tiempos: extrae el programa y arma el enlace 'current', y
# DESPUES crea el shim. Si aborta en el medio -- pasa, y esta documentado -- queda
# todo menos esa pieza chiquita. El comando `opencode` no existe, pero el programa
# esta entero, a 180 MB, mirando.
#
# Antes se reinstalaba de cero por eso: 57 MB de descarga para recuperar 20 KB que
# se pueden escribir en el momento. En un aula con la red saturada, esa diferencia
# es la clase entera.
#
# COMO SE REPARA: con `scoop reset opencode`, que es la herramienta de Scoop para
# exactamente esto (libexec/scoop-reset.ps1: rehace shims, 'current' y PATH desde
# la version instalada, sin bajar nada). La version anterior copiaba el programa
# entero (178 MB) como lanzador, y eso creaba el fantasma que se describe arriba.
# Se conserva esa copia SOLO como ultimo recurso, avisando que queda fuera de Scoop.
function Reparar-Shim {
    if (-not (Test-Path $BinOpenCode)) { return $false }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $global:LASTEXITCODE = 0
        $salida = scoop reset opencode *>&1 | Out-String
        Refresh-Path
        if (($LASTEXITCODE -eq 0) -and ($salida -notmatch '(?m)^\s*ERROR') -and (Test-Path $ShimOpenCode)) {
            return $true
        }
        Write-Host "  [i] 'scoop reset opencode' no pudo rehacer el lanzador."
    } catch {
        Write-Host "  [i] 'scoop reset opencode' fallo: $($_.Exception.Message)"
    } finally {
        $ErrorActionPreference = $prev
    }
    try {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ShimOpenCode) | Out-Null
        Copy-Item $BinOpenCode $ShimOpenCode -Force
        Refresh-Path
        Write-Host "  [!] Se copio el programa entero como lanzador. Ese archivo queda FUERA de Scoop:" -ForegroundColor Yellow
        Write-Host "      no se actualiza con el, y hay que borrarlo a mano si se reinstala OpenCode." -ForegroundColor Yellow
        return $true
    } catch { return $false }
}

function Test-OpenCode {
    if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) { return $false }
    # DOS TRAMPAS DE POWERSHELL, y las dos daban FALSO NEGATIVO sobre una
    # instalacion sana -- que despues esta rutina "reparaba" desinstalandola.
    #
    # 1. Con ErrorActionPreference = Stop, cualquier linea que OpenCode escriba a
    #    stderr se convierte en error terminante, AUNQUE el exit code sea 0. Un
    #    aviso de version nueva alcanza para que el catch diga "no anda".
    # 2. Si el comando no llega a ejecutarse, $LASTEXITCODE conserva el valor del
    #    comando ANTERIOR, y puede dar 0 sin que nada haya corrido.
    #
    # El costo del falso negativo no es cosmetico: dispara uninstall + install
    # sobre algo que funcionaba, y si la red esta mal en ese momento, lo rompe. Es
    # literalmente el mecanismo de "andaba y ahora no".
    # SE INTENTA DOS VECES, CON UNA ESPERA EN EL MEDIO.
    #
    # Esto salio del log de una maquina real (capacitacion del 20/08). El chequeo
    # dijo "OpenCode no arranca" y contesto esto:
    #
    #     opencode.exe : Shim: Could not determine if target is a GUI app.
    #
    # Ese mensaje lo escribe el shim de Scoop cuando no puede leer el encabezado
    # del ejecutable al que apunta. Y el binario de OpenCode pesa casi 200 MB y
    # acaba de aterrizar en el disco: el antivirus lo esta escaneando y lo tiene
    # tomado. Unos segundos despues se lee perfecto.
    #
    # La prueba de que era un FALSO NEGATIVO: en esa misma maquina el bot abrio y
    # funciono. Declaramos muerto algo que andaba, y por eso el instalador se puso
    # a reinstalar OpenCode al pedo y le mostro una pantalla de error a la docente.
    #
    # Y esto es, muy probablemente, el misterio que arrastrabamos: un bootstrap que
    # moria a los 2,4 segundos y andaba perfecto corrido a mano dos minutos
    # despues. Lo unico que cambiaba entre las dos corridas era el tiempo.
    #
    # Reintentar sale una espera de tres segundos EN EL PEOR CASO. No reintentar
    # salia una reinstalacion entera y un susto.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        foreach ($intento in 1, 2) {
            $global:LASTEXITCODE = 0
            $script:SalidaOpenCode = (& opencode --version 2>&1 | Out-String)
            if ($LASTEXITCODE -eq 0) { return $true }
            if ($intento -eq 1) { Start-Sleep -Seconds 3 }
        }
        return $false
    } catch {
        $script:SalidaOpenCode = $_.Exception.Message
        return $false
    } finally {
        $ErrorActionPreference = $prev
    }
}

# Baja el build 'baseline' de OpenCode: el que anda en CPU sin AVX2.
#
# POR QUE HACE FALTA. OpenCode publica DOS binarios para Windows y el manifest de
# Scoop apunta duro al normal. En una notebook vieja el binario instala perfecto y
# al ejecutarse revienta con "Illegal instruction ... no_avx2".
#
# Y ahi la reparacion automatica entraba en un bucle DETERMINISTA: detecta que no
# corre, desinstala, vuelve a instalar EL MISMO binario que esa CPU no puede
# ejecutar, y otra vez. Para siempre. No es azar: es el mismo resultado cada vez.
#
# Se pisa solo el .exe dentro del directorio de la app: el junction 'current' y el
# shim de Scoop siguen apuntando al mismo lugar, asi que no hace falta admin ni
# tocar nada de Scoop.
function Install-OpenCodeBaseline {
    $appDir = Join-Path $env:USERPROFILE "scoop\apps\opencode"
    if (-not (Test-Path $appDir)) { return $false }
    # Primero la carpeta de la version FIJADA, que es la que Scoop acaba de
    # instalar y a la que apunta 'current'. Recien si no esta (una instalacion
    # vieja, anterior al pin) se toma la mas alta que haya.
    $ver = Get-Item (Join-Path $appDir $OpenCodeVersion) -EA SilentlyContinue
    if (-not $ver) {
        $ver = (Get-ChildItem $appDir -Directory -EA SilentlyContinue |
                Where-Object { $_.Name -ne 'current' } |
                Sort-Object Name -Descending | Select-Object -First 1)
    }
    if (-not $ver) { return $false }
    $url = "https://github.com/anomalyco/opencode/releases/download/v$($ver.Name)/opencode-windows-x64-baseline.zip"
    $zip = Join-Path $env:TEMP "opencode-baseline.zip"
    try {
        Write-Host "  [..] Bajando la version para procesadores sin AVX2..."
        Bajar -Url $url -Destino $zip | Out-Null
        Expand-Archive -Path $zip -DestinationPath $ver.FullName -Force
        Remove-Item $zip -Force -EA SilentlyContinue
        Refresh-Path
        return (Test-OpenCode)
    } catch {
        return $false
    }
}

# Scoop RECHAZA correr como administrador por defecto, y esto tiene que estar
# puesto SIEMPRE, no solo cuando Scoop se instala por primera vez.
#
# ESTA ERA LA CAUSA DEL ERROR QUE SE REPETIA. Estaba adentro del bloque "Scoop no
# esta instalado", y la secuencia real es esta:
#
#   1. Primera corrida normal: instala Scoop, y algo falla despues.
#   2. El docente hace lo natural: boton derecho, "Ejecutar como administrador".
#   3. Ahora Scoop YA existe, asi que ese bloque no corre y la variable no se pone.
#   4. `scoop install opencode` elevado sin la variable: Scoop lo RECHAZA.
#   5. La auto-reparacion hace uninstall + install: rechazados igual, por lo mismo.
#      Y el uninstall si funciono, asi que ahora OpenCode tampoco esta.
#   6. Repite. Cada intento se ve identico e igual de inexplicable.
#
# No era azar: era un bucle determinista, y cada intento "como administrador" lo
# empeoraba.
$env:SCOOP_ALLOW_ADMIN_INSTALL = 'true'

# --- 1. Scoop ---------------------------------------------------------------
Refresh-Path
if (Get-Command scoop -ErrorAction SilentlyContinue) {
    Write-Host "  [OK] Scoop ya esta instalado"
} else {
    Write-Host "  [..] Instalando Scoop (gestor sin admin)..."
    # Habilita scripts para el usuario. Si ya hay una politica mas permisiva en
    # el ambito de Proceso (el instalador lanza con -ExecutionPolicy Bypass), este
    # cmdlet AVISA del override y, con ErrorActionPreference=Stop, abortaria todo.
    # Lo toleramos: en ese caso los scripts ya pueden correr igual.
    try {
        Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force -ErrorAction Stop
    } catch {
        Write-Host "  [i] La politica de ejecucion ya es permisiva; continuo."
    }
    # Scoop RECHAZA correr como administrador por defecto. Si el instalador se
    # ejecuto elevado (comun por la costumbre de "Ejecutar como administrador", o
    # en PCs de escuela), sin esto falla y OpenCode no instala. Detectamos admin y
    # le pasamos -RunAsAdmin + habilitamos instalar apps como admin.
    $esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $scoopInstaller = Bajar -Url "https://get.scoop.sh"
    if ($esAdmin) {
        Write-Host "  [i] Ejecutando como administrador: instalando Scoop en modo admin."
        & ([scriptblock]::Create($scoopInstaller)) -RunAsAdmin
    } else {
        & ([scriptblock]::Create($scoopInstaller))
    }
    Refresh-Path
    # Si Scoop no quedo, NADA de lo que sigue puede funcionar: OpenCode se
    # instala con el. Cortar aca ahorra tres errores en cascada que no dicen
    # cual fue el primero.
    if (-not (Get-Command scoop -ErrorAction SilentlyContinue)) {
        Write-Host ""
        Write-Host "  [X] Scoop NO quedo instalado, y sin el no se puede seguir." -ForegroundColor Red
        Write-Host ""
        Write-Host "      Suele ser la politica de ejecucion de PowerShell. Proba:"
        Write-Host "        Set-ExecutionPolicy -Scope CurrentUser RemoteSigned" -ForegroundColor Yellow
        Write-Host "      y volve a correr este instalador."
        Write-Host ""
        try { Stop-Transcript | Out-Null } catch { }
    exit 1
    }
    Write-Host "  [OK] Scoop instalado."
}

# --- 2. OpenCode ------------------------------------------------------------
#
# SE VERIFICA QUE HAYA QUEDADO INSTALADO, y no alcanza con que el comando no
# tire excepcion. Scoop puede terminar con "ERROR 'opencode' isn't installed
# correctly" y devolver el prompt igual: antes se imprimia "[OK] OpenCode
# instalado" sobre ese error, el instalador seguia hasta el final diciendo que
# todo habia salido bien, y el docente descubria el problema recien al abrir el
# acceso directo, que le decia "No se encontro OpenCode" sin ninguna pista.
#
# Un instalador que dice OK sin haber mirado es peor que uno que falla: manda a
# buscar el problema al lugar equivocado.
#
# LA VERSION SE INSTALA FIJA Y SE DEJA FIJA. Dos comandos de Scoop, verificados
# en su codigo (github.com/ScoopInstaller/Scoop, libexec/scoop-install.ps1,
# scoop-hold.ps1, scoop-update.ps1 y lib/manifest.ps1):
#
#   scoop install opencode@1.18.18
#     No busca en el historial git del bucket: toma el manifest actual y le
#     REGENERA la url y el hash para esa version con su bloque 'autoupdate'
#     (generate_user_manifest). Avisa "Given version (x) does not match
#     manifest (y)" y "Attempting to generate manifest": es normal, no es error.
#     El manifest generado queda en scoop\workspace\opencode.json y el
#     install.json de la app apunta a ese archivo ('url') en vez de al bucket:
#     por eso `scoop info opencode` muestra esa ruta como Source. Necesita red,
#     como cualquier instalacion.
#
#   scoop hold opencode
#     Escribe "hold": true en scoop\apps\opencode\current\install.json.
#     `scoop update *` la saltea con "'opencode' is held to version ...", asi que
#     el binario que se probo es el que se queda. El AVX2 'baseline' que se copia
#     encima tambien: un update lo pisaria por el binario que esa CPU no corre.
#
# Si ya hay OTRA version instalada NO se desinstala nada (la regla de siempre:
# puede fallar, pero no puede romper). Si la fijada ya esta en el disco, se
# activa con `scoop reset opencode@<ver>` -- documentado para eso: mueve
# 'current' y rehace los shims, no baja ni borra nada. Si no esta, se avisa y se
# deja como esta; el hold se pone igual, para que al menos deje de moverse.

# Instalado DE VERDAD = Scoop lo registro Y el programa arranca. Las dos cosas.
function Test-OpenCodeInstalado {
    return ((Test-OpenCodeScoop) -and (Test-OpenCode))
}

# La version que Scoop tiene ACTIVA, leida de su manifest.json. Es la que
# importa para hold/reset, mas alla de lo que conteste el binario.
function Get-OpenCodeVersionInstalada {
    $mf = Join-Path $OpenCodeAppDir "current\manifest.json"
    try {
        if (Test-Path $mf) { return ("" + (Get-Content $mf -Raw | ConvertFrom-Json).version).Trim() }
    } catch { }
    if ($script:SalidaOpenCode -match '(\d+\.\d+\.\d+)') { return $Matches[1] }
    return ""
}

# `scoop hold` NO tira excepcion y NO devuelve exit distinto de 0 cuando falla:
# verificado en libexec/scoop-hold.ps1, que si la app no esta hace
# `error "'$app' is not installed."; continue` y termina con `exit $exitcode`
# con esa variable sin definir (o sea, 0). Y `error` es un Write-Host "ERROR ..."
# (lib/core.ps1), ni siquiera stderr. En la VM se vio la consecuencia: "ERROR
# 'opencode' is not installed" seguido de nuestro "[OK] fijado". La unica senal
# fiable es la linea que empieza con ERROR; el exit code se mira igual, por si
# algun dia lo arreglan.
function Fijar-OpenCode {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $global:LASTEXITCODE = 0
        $salidaHold = scoop hold opencode *>&1 | Out-String
        $lineas = @($salidaHold -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        $errores = @($lineas | Where-Object { $_ -match '^ERROR' })
        if (($LASTEXITCODE -ne 0) -or ($errores.Count -gt 0)) {
            $motivo = if ($errores.Count) { $errores[0] } else { "scoop hold devolvio exit $LASTEXITCODE" }
            Write-Host "  [X] No se pudo fijar la version: $motivo" -ForegroundColor Red
            return $false
        }
        foreach ($l in $lineas) { Write-Host ("      " + $l) }
        Write-Host "  [OK] OpenCode fijado en la version $OpenCodeVersion (scoop hold)."
        return $true
    } catch {
        Write-Host "  [X] No se pudo fijar la version: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    } finally {
        $ErrorActionPreference = $prev
    }
}

if (Test-OpenCodeInstalado) {
    Write-Host "  [OK] OpenCode ya esta instalado"
    $instalada = Get-OpenCodeVersionInstalada
    if ($instalada -and $instalada -ne $OpenCodeVersion) {
        Write-Host "  [i] Esta la version $instalada y esta version de Tecnia Bot se probo con la $OpenCodeVersion."
        if (Test-Path (Join-Path $OpenCodeAppDir $OpenCodeVersion)) {
            Write-Host "  [..] La $OpenCodeVersion ya esta en el disco: la vuelvo a activar (scoop reset)..."
            $prev = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            $salidaReset = ""
            try {
                $salidaReset = scoop reset opencode@$OpenCodeVersion *>&1 | Out-String
            } catch {
                $salidaReset = "ERROR " + $_.Exception.Message
            }
            $ErrorActionPreference = $prev
            Refresh-Path
            # Scoop escribe sus errores con Write-Host (stream de informacion): 2>&1 NO los
            # captura en PowerShell 5.1, por eso se usa *>&1 (todos los streams).
            # scoop reset imprime "ERROR ..." y sale con 0 si no pudo (por ejemplo, con OpenCode
            # abierto: "instances of opencode are still running"). Antes se decia [OK] igual.
            # Lo unico que vale es releer que version quedo activa.
            $quedo = Get-OpenCodeVersionInstalada
            if ($quedo -eq $OpenCodeVersion) {
                Write-Host "  [OK] OpenCode vuelve a la version $OpenCodeVersion."
            } else {
                Write-Host "  [X] No pude volver a la version ${OpenCodeVersion}: sigue activa la $quedo."
                if ($salidaReset -match "still running") {
                    Write-Host "      Tecnia Bot (OpenCode) esta abierto. Cerralo y volve a correr 'Reparar Tecnia Bot'."
                } else {
                    foreach ($l in ($salidaReset -split "`n")) { if ($l -match "^\s*ERROR") { Write-Host ("      " + $l.Trim()) } }
                    Write-Host "      Volve a correr 'Reparar Tecnia Bot'; si sigue, en PowerShell: scoop reset opencode@$OpenCodeVersion"
                }
            }
        } else {
            Write-Host "      Se deja como esta: este instalador no desinstala nada."
            Write-Host "      Si el bot no anda bien, en PowerShell: scoop install opencode@$OpenCodeVersion"
        }
    }
    Fijar-OpenCode | Out-Null
} else {
    # Corre pero Scoop no lo tiene: es el exe suelto de arriba. NO se borra antes
    # de instalar (puede fallar, no puede romper): Scoop pisa el shim al instalar.
    if (-not (Test-OpenCodeScoop) -and (Test-OpenCode)) {
        Write-Host "  [i] Hay un opencode.exe suelto que Scoop no administra; instalo la version fijada con Scoop."
    }
    Write-Host "  [..] Instalando OpenCode $OpenCodeVersion..."
    scoop install opencode@$OpenCodeVersion
    Refresh-Path

    # UN intento de reparacion, automatico, sin preguntarle nada al docente.
    #
    # Scoop se auto-cura, pero solo en un caso: cuando reconoce una "previous
    # failed installation". Una descarga cortada o un hash que no da NO los
    # purga, y ahi OpenCode queda instalado a medias: el comando esta, no
    # arranca. Ese es el estado que dejaba al docente copiando y pegando dos
    # lineas de PowerShell para poder seguir.
    #
    # Se repara solo porque el instalador tiene la informacion y el docente no.
    # Y reparar algo que YA esta roto no destruye nada: si llegamos aca, es
    # porque OpenCode no corre.
    # PRIMERO SE AVERIGUA POR QUE NO ANDA, Y RECIEN AHI SE DECIDE.
    #
    # La version anterior reinstalaba a ciegas, y eso NO CONVERGE cuando el
    # problema es la CPU: vuelve a bajar el mismo binario que esa maquina no puede
    # ejecutar, una y otra vez. Hay que distinguir dos casos que se ven igual desde
    # afuera pero no tienen nada que ver:
    #
    #   NO ESTA        -> falto instalarlo. Reinstalar sirve.
    #   ESTA Y REVIENTA -> el binario no corre en esta CPU. Reinstalar NO sirve.
    if (-not (Test-OpenCodeInstalado)) {
        $exe = Join-Path $env:USERPROFILE "scoop\apps\opencode\current\opencode.exe"
        $esAvx = (Test-Path $exe) -and ($script:SalidaOpenCode -match 'no_avx2|Illegal instruction|instruccion ilegal')

        if ($esAvx) {
            Write-Host "  [i] El procesador de esta maquina no tiene AVX2."
            Write-Host "      OpenCode tiene una version para estos equipos. Bajandola..."
            if (Install-OpenCodeBaseline) {
                Write-Host "  [OK] Listo, con la version para procesadores sin AVX2."
            }
        } else {
            # NO SE DESINSTALA NADA. NUNCA.
            #
            # Aca habia un `scoop uninstall opencode` antes de reinstalar, y era la
            # unica operacion de todo el instalador capaz de dejar la maquina PEOR
            # de como estaba. Si Test-OpenCode da un falso negativo -- y ya se
            # documentaron dos formas de que pase -- desinstala un OpenCode sano; y
            # si la reinstalacion despues falla por red, el docente se queda sin
            # nada. Paso: una notebook que andaba quedo sin OpenCode despues de
            # correr el instalador.
            #
            # Y era ADEMAS innecesario: `scoop install` ya purga solo las
            # instalaciones fallidas. Medido, con su salida textual:
            #
            #   WARN  Purging previous failed installation of opencode.
            #   'opencode' was uninstalled.
            #   Installing 'opencode' (1.18.18) [64bit] from 'main' bucket
            #   'opencode' (1.18.18) was installed successfully!
            #
            # O sea: Scoop hace exactamente lo mismo, pero SOLO cuando de verdad
            # hace falta. Nosotros lo haciamos siempre, a ciegas.
            #
            # REGLA: el instalador puede fallar, pero no puede romper.
            # PRIMERO LO BARATO: si el programa esta y solo falta el shim, se
            # escribe y listo. Recien si eso no alcanza se vuelve a la red.
            if (Test-Path $BinOpenCode) {
                Write-Host "  [..] El programa esta pero falta su lanzador. Reparandolo..."
                if (Reparar-Shim) { Write-Host "  [OK] Reparado sin volver a descargar nada." }
            }
            if (-not (Test-OpenCodeInstalado)) {
                Write-Host "  [..] OpenCode no arranca. Reintentando la instalacion..."
                scoop install opencode@$OpenCodeVersion
            }
            Refresh-Path
            # Si despues de reinstalar sigue sin arrancar Y el binario esta, es la
            # CPU: no tiene sentido un tercer intento identico.
            if (-not (Test-OpenCode) -and (Test-Path $exe)) {
                Write-Host "  [i] El binario esta pero no arranca. Probando la version alternativa..."
                Install-OpenCodeBaseline | Out-Null
            }
        }
    }

    if (-not (Test-OpenCodeInstalado)) {
        # Scoop no lo registro y el exe suelto sigue ahi: lo mas probable es que
        # Scoop no haya podido pisar ese archivo (OpenCode abierto, o el antivirus
        # escaneando 178 MB). Se dice con todas las letras: es lo que hay que hacer.
        if (-not (Test-OpenCodeScoop) -and (Test-Path $ShimOpenCode) -and ((Get-Item $ShimOpenCode).Length -gt 1MB)) {
            Write-Host ""
            Write-Host "  [X] Scoop no pudo instalar OpenCode: hay un opencode.exe suelto en" -ForegroundColor Red
            Write-Host "      $ShimOpenCode" -ForegroundColor Red
            Write-Host "      y probablemente esta bloqueado (abierto, o tomado por el antivirus)."
            Write-Host "      Cerra OpenCode, espera un minuto y volve a correr el instalador."
        }
        # NO SE CORTA ACA, Y ESTA DECISION SE TOMO ROMPIENDO UNA QUE FUNCIONABA.
        #
        # Hasta la v0.3.19 este script no tenia un solo `exit`: si OpenCode
        # fallaba, seguia igual y llegaba a instalar la capa educativa. Se agrego
        # el corte con un argumento razonable -- "un instalador que dice OK sin
        # verificar es peor que uno que falla" -- y estaba bien para AVISAR. Pero
        # se aplico mal: se convirtio "avisar" en "abandonar".
        #
        # Y la capa NO DEPENDE de OpenCode para instalarse: es copia de archivos,
        # sin red, sin Scoop, sin nada que pueda fallar. Cortar antes la tiraba por
        # la borda y dejaba la maquina con DOS problemas en vez de uno.
        #
        # Se vio en una notebook real: opencode extraido pero sin shim, y ademas
        # sin agente, sin skills y sin fichas. Con la v0.3.19 esa misma maquina
        # habria quedado con la capa puesta, esperando que se arregle OpenCode.
        #
        # Ahora se anota y se sigue. El aviso va al final, junto con el resto.
        $script:FalloOpenCode = $true
        Write-Host ""
        Write-Host "  [!] OpenCode no arranca en esta maquina." -ForegroundColor Yellow
        if ($script:SalidaOpenCode) {
            Write-Host "      Esto contesto:" -ForegroundColor Yellow
            Write-Host ("      " + (($script:SalidaOpenCode -split "`n" | Select-Object -First 3 | ForEach-Object { $_.Trim() }) -join "`n      "))
        }
        Write-Host "      Sigo instalando el resto: la capa educativa no depende de el."
        Write-Host ""
    } else {
        Write-Host "  [OK] OpenCode instalado."
        Fijar-OpenCode | Out-Null
    }
}

# --- Encontrar un Python DE VERDAD ------------------------------------------
#
# EL SENUELO DE LA MICROSOFT STORE. Windows 10 y 11 dejan un `python.exe` falso
# en %LOCALAPPDATA%\Microsoft\WindowsApps que no es Python: es un acceso directo
# que abre la tienda. Y esa carpeta suele ir ANTES que los shims de Scoop en el
# PATH del usuario, asi que `python` a secas se lo lleva puesto.
#
# ASI FALLO EN UNA MAQUINA REAL (capacitacion del 20/08, equipo de Direccion).
# El codigo hacia:
#
#     $PyExe = "...\scoop\shims\python.exe"
#     if (-not (Test-Path $PyExe)) { $PyExe = "python" }   # <- el fallback
#
# El shim de Scoop no estaba -aunque `scoop install python` dijera "already
# installed (3.14.7)"-, cayo al fallback, y el log quedo con esto:
#
#     no se encontro Python; ejecutar sin argumentos para instalar desde el
#     Microsoft Store o deshabilitar este acceso directo desde Configuracion >
#     Aplicaciones > Alias de ejecucion de aplicaciones.
#
# Ese mensaje no lo escribe Python. Lo escribe el senuelo. El fallback a `python`
# no era una red de seguridad: GARANTIZABA el modo de falla.
#
# Ahora se prueban varios lugares, se descarta WindowsApps de entrada, y a cada
# candidato SE LE PREGUNTA si es Python en vez de suponerlo por donde vive. Es la
# misma leccion que el lanzador ya aprendio buscando OpenCode en tres lados; este
# bloque nunca la recibio.
function Buscar-Python {
    $candidatos = @(
        (Join-Path $env:USERPROFILE "scoop\shims\python.exe"),
        (Join-Path $env:USERPROFILE "scoop\apps\python\current\python.exe")
    )
    foreach ($c in (Get-Command -Name python, python3 -All -CommandType Application -ErrorAction SilentlyContinue)) {
        if ($c.Source) { $candidatos += $c.Source }
    }
    foreach ($ruta in $candidatos) {
        if (-not $ruta) { continue }
        if ($ruta -like "*\WindowsApps\*") { continue }
        if (-not (Test-Path $ruta)) { continue }
        $prev = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $global:LASTEXITCODE = 0
            $v = (& $ruta --version 2>&1 | Out-String)
            if ($LASTEXITCODE -eq 0 -and $v -match "Python\s+3") { return $ruta }
        } catch { } finally { $ErrorActionPreference = $prev }
    }
    return $null
}

# --- 3. Python + PlatformIO -------------------------------------------------
$PioExe = Join-Path $env:USERPROFILE ".platformio\penv\Scripts\pio.exe"
if ((Get-Command pio -ErrorAction SilentlyContinue) -or (Test-Path $PioExe)) {
    Write-Host "  [OK] PlatformIO ya esta instalado"
} else {
    Write-Host "  [..] Instalando PlatformIO Core (no necesita admin)..."
    # Python: NO usar 'Get-Command python' - Windows 10/11 trae un stub de la
    # Microsoft Store con ese nombre que NO es Python real y hace fallar la
    # instalacion. Instalamos con Scoop (idempotente) y lo llamamos por ruta.
    scoop install python
    Refresh-Path
    $PyExe = Buscar-Python
    if (-not $PyExe) {
        Write-Host ""
        Write-Host "  [!] No hay un Python usable en esta maquina." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "      Si Windows te ofrece instalar Python desde la Microsoft Store, es"
        Write-Host "      un senuelo: hay un python.exe falso en WindowsApps que solo abre"
        Write-Host "      la tienda. Se apaga en Configuracion > Aplicaciones > Alias de"
        Write-Host "      ejecucion de aplicaciones, destildando python.exe y python3.exe."
        Write-Host ""
        Write-Host "      Despues volve a correr este instalador."
        Write-Host ""
    } else {
        Write-Host "      Python: $PyExe"
        $Tmp = Join-Path $env:TEMP "get-platformio.py"
        Bajar -Url "https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py" -Destino $Tmp | Out-Null
        # get-platformio.py (pioinstaller) arma el venv y, ANTES de instalar
        # PlatformIO, intenta actualizar pip adentro del venv (penv.update_pip).
        # En Windows eso falla a veces con "[WinError 1921]", y el propio
        # instalador de PlatformIO lo TRAGA a proposito: update_pip captura la
        # excepcion, la manda a log.debug, devuelve False y sigue; PlatformIO se
        # instala igual. Pero pip ya escribio su ERROR en rojo en la consola, y el
        # docente ve un error gordo seguido de "Listo".
        #
        # No hay opcion para saltear ese paso: el CLI de pioinstaller acepta
        # --verbose, --dev, --ignore-python, --pypi-index-url y
        # --no-shutdown-piohome, nada sobre pip (verificado decodificando el
        # script embebido). Asi que se filtra ACA: esas lineas no se muestran y al
        # final va UN aviso calmo. Lo que decide si PlatformIO quedo es pio.exe en
        # el disco, que se mira mas abajo, no lo que pip haya dicho.
        #
        # 2>&1 de un comando nativo con $ErrorActionPreference = "Stop" revienta
        # en PowerShell 5.1 (misma trampa que en Buscar-Python): se baja a
        # Continue solo para este paso.
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $avisoPip = $false
        try {
            & $PyExe $Tmp 2>&1 | ForEach-Object {
                $linea = "$_"
                if ($linea -match "WinError 1921|Could not install packages due to an OSError|pip install --upgrade pip|A new release of pip") {
                    $avisoPip = $true
                } else {
                    Write-Host $linea
                }
            }
        } finally { $ErrorActionPreference = $prevEAP }
        if ($avisoPip) { Write-Host "  [i] Aviso de pip (no pudo actualizarse a si mismo): no afecta a PlatformIO." }
        Remove-Item $Tmp -ErrorAction SilentlyContinue
    }
    # Se verifica el ejecutable en disco, no el PATH: PlatformIO se instala en
    # ~/.platformio y no agrega nada al PATH de esta consola.
    if (-not (Test-Path $PioExe)) {
        Write-Host ""
        Write-Host "  [!] PlatformIO NO quedo instalado." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "      Tecnia Bot va a arrancar igual y sirve para explicar, dibujar"
        Write-Host "      circuitos y repartir fichas - pero NO va a poder compilar ni"
        Write-Host "      cargar codigo a la placa hasta que esto se resuelva."
        Write-Host ""
        Write-Host "      Adentro del bot, /diagnostico te dice como esta."
        Write-Host ""
    } else {
        Write-Host "  [OK] PlatformIO instalado en ~/.platformio (Tecnia Bot lo encuentra solo)."
    }
}

# --- 4. Tecnia Bot (capa educativa) ------------------------------------------
Write-Host ""
Write-Host "  [..] Instalando la capa de Tecnia Bot..."
# powershell.exe POR RUTA, no por nombre. "powershell" a secas depende del PATH del
# docente, y ya paso que no estuviera (CHANGELOG 0.3.75: el reparar del tool no
# podia ni lanzarlo). $PSHOME es la carpeta del PowerShell que esta corriendo ESTE
# script, asi que existe siempre; si es pwsh 7 (que no trae powershell.exe ahi) se
# cae al nombre, como antes.
$PsExe = Join-Path $PSHOME "powershell.exe"
if (-not (Test-Path $PsExe)) { $PsExe = "powershell" }
& $PsExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoDir "install\install.ps1")

# SE VERIFICA QUE LA CAPA HAYA QUEDADO, y por dos vias.
#
# Antes esta linea corria y el script seguia derecho a imprimir "LISTO!". Si
# install.ps1 moria a mitad -- un archivo bloqueado por el antivirus alcanza --
# el docente veia el cartel verde y despues un OpenCode pelado, sin logo, sin
# agente y sin fichas. Sin ninguna pista de que faltaba algo.
#
# Faltaba tambien -NoProfile, que el .iss si usa: un perfil de PowerShell
# corporativo roto reventaba este paso y nadie se enteraba.
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  [X] La capa de Tecnia Bot no se instalo (codigo $LASTEXITCODE)." -ForegroundColor Red
    Write-Host "      Suele ser un archivo bloqueado: cerra OpenCode y proba de nuevo."
    Write-Host ""
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
}
$cfgDir = if ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "opencode" } else { Join-Path $env:USERPROFILE ".config\opencode" }
if (-not (Test-Path (Join-Path $cfgDir "agent\tecnia-bot.md"))) {
    Write-Host ""
    Write-Host "  [X] La capa educativa no quedo publicada." -ForegroundColor Red
    Write-Host "      El instalador dijo que termino, pero el agente no esta en:"
    Write-Host "      $cfgDir"
    Write-Host ""
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
}

Write-Host ""
# EL AVISO VA AL FINAL, DONDE SE LEE. Si OpenCode fallo, la capa igual quedo
# instalada -- y eso importa: el dia que OpenCode se arregle, el bot ya esta ahi.
# Cortar antes dejaba la maquina con dos problemas en vez de uno.
if ($script:FalloOpenCode) {
    Write-Host "  La capa de Tecnia Bot quedo instalada, pero OPENCODE NO ARRANCA." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Sin OpenCode el bot no se puede abrir todavia. Para saber por que:"
    Write-Host "    menu inicio -> Diagnostico de Tecnia Bot" -ForegroundColor Yellow
    Write-Host ""
    # NO SE LE SUGIERE `scoop uninstall`, y es la misma regla que rige el codigo.
    #
    # Se saco del script porque era lo unico capaz de dejar la maquina PEOR de
    # como estaba... y quedo impreso en pantalla, en amarillo, como consejo. Un
    # docente que lo copia con la red del aula saturada se queda sin OpenCode: el
    # uninstall siempre funciona, la descarga de 57 MB no.
    #
    # Peor: se mostraba tambien cuando la causa es una CPU sin AVX2, donde
    # reinstalar no converge NUNCA -- es un bucle determinista.
    #
    # El diagnostico si distingue antivirus de procesador viejo. Eso es lo que
    # sirve, y es lo unico que se ofrece.
    Write-Host "  El diagnostico te dice cual de las causas es:"
    Write-Host "    menu inicio -> Diagnostico de Tecnia Bot" -ForegroundColor Yellow
    Write-Host ""
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
}
Write-Host "  LISTO! Abri una terminal en cualquier carpeta, escribi 'opencode',"
Write-Host "  apreta Tab y elegi 'tecnia-bot'."
Write-Host ""
try { Stop-Transcript | Out-Null } catch { }
