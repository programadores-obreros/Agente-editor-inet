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
function Test-OpenCode {
    if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) { return $false }
    try {
        $null = & opencode --version 2>&1
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

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
    $env:SCOOP_ALLOW_ADMIN_INSTALL = 'true'
    $esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $scoopInstaller = Invoke-RestMethod -Uri https://get.scoop.sh
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
if (Test-OpenCode) {
    Write-Host "  [OK] OpenCode ya esta instalado"
} else {
    Write-Host "  [..] Instalando OpenCode..."
    scoop install opencode
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
    if (-not (Test-OpenCode)) {
        Write-Host "  [..] OpenCode quedo a medio instalar. Limpiando y reintentando..."
        try { scoop uninstall opencode } catch { }
        scoop install opencode
        Refresh-Path
    }

    if (-not (Test-OpenCode)) {
        Write-Host ""
        Write-Host "  [X] OpenCode NO quedo instalado." -ForegroundColor Red
        Write-Host ""
        Write-Host "      Se intento instalar dos veces, la segunda limpiando antes, y"
        Write-Host "      las dos fallaron. Lo mas comun es que la descarga se corte."
        Write-Host ""
        Write-Host "      Proba de nuevo con mejor conexion. Si vuelve a fallar, copia"
        Write-Host "      lo que dice scoop mas arriba y pedi ayuda con eso:"
        Write-Host "      https://github.com/programadores-obreros/Agente-editor-inet/issues"
        Write-Host ""
        exit 1
    }
    Write-Host "  [OK] OpenCode instalado."
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
    $PyExe = Join-Path $env:USERPROFILE "scoop\shims\python.exe"
    if (-not (Test-Path $PyExe)) { $PyExe = "python" }
    $Tmp = Join-Path $env:TEMP "get-platformio.py"
    Invoke-RestMethod -Uri "https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py" -OutFile $Tmp
    & $PyExe $Tmp
    Remove-Item $Tmp -ErrorAction SilentlyContinue
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
powershell -ExecutionPolicy Bypass -File (Join-Path $RepoDir "install\install.ps1")

Write-Host ""
Write-Host "  LISTO! Abri una terminal en cualquier carpeta, escribi 'opencode',"
Write-Host "  apreta Tab y elegi 'tecnia-bot'."
Write-Host ""
