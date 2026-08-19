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
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $global:LASTEXITCODE = 0
        $script:SalidaOpenCode = (& opencode --version 2>&1 | Out-String)
        return ($LASTEXITCODE -eq 0)
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
    $appDir = Join-Path $env:USERPROFILE "scooppps\opencode"
    if (-not (Test-Path $appDir)) { return $false }
    $ver = (Get-ChildItem $appDir -Directory -EA SilentlyContinue |
            Where-Object { $_.Name -ne 'current' } |
            Sort-Object Name -Descending | Select-Object -First 1)
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
    # PRIMERO SE AVERIGUA POR QUE NO ANDA, Y RECIEN AHI SE DECIDE.
    #
    # La version anterior reinstalaba a ciegas, y eso NO CONVERGE cuando el
    # problema es la CPU: vuelve a bajar el mismo binario que esa maquina no puede
    # ejecutar, una y otra vez. Hay que distinguir dos casos que se ven igual desde
    # afuera pero no tienen nada que ver:
    #
    #   NO ESTA        -> falto instalarlo. Reinstalar sirve.
    #   ESTA Y REVIENTA -> el binario no corre en esta CPU. Reinstalar NO sirve.
    if (-not (Test-OpenCode)) {
        $exe = Join-Path $env:USERPROFILE "scoop\apps\opencode\current\opencode.exe"
        $esAvx = (Test-Path $exe) -and ($script:SalidaOpenCode -match 'no_avx2|Illegal instruction|instruccion ilegal')

        if ($esAvx) {
            Write-Host "  [i] El procesador de esta maquina no tiene AVX2."
            Write-Host "      OpenCode tiene una version para estos equipos. Bajandola..."
            if (Install-OpenCodeBaseline) {
                Write-Host "  [OK] Listo, con la version para procesadores sin AVX2."
            }
        } else {
            Write-Host "  [..] OpenCode quedo a medio instalar. Limpiando y reintentando..."
            try { scoop uninstall opencode } catch { }
            scoop install opencode
            Refresh-Path
            # Si despues de reinstalar sigue sin arrancar Y el binario esta, es la
            # CPU: no tiene sentido un tercer intento identico.
            if (-not (Test-OpenCode) -and (Test-Path $exe)) {
                Write-Host "  [i] El binario esta pero no arranca. Probando la version alternativa..."
                Install-OpenCodeBaseline | Out-Null
            }
        }
    }

    if (-not (Test-OpenCode)) {
        Write-Host ""
        Write-Host "  [X] OpenCode NO arranca en esta maquina." -ForegroundColor Red
        Write-Host ""
        # SE MUESTRA EL ERROR REAL, no una suposicion. La version anterior decia
        # "lo mas comun es que la descarga se corte" -- y cuando el hash da OK, la
        # descarga esta perfecta. Ese mensaje mandaba a culpar a la conexion
        # mientras el problema era el antivirus o el procesador.
        if ($script:SalidaOpenCode) {
            Write-Host "      Esto es lo que contesto OpenCode:" -ForegroundColor Yellow
            Write-Host ("      " + ($script:SalidaOpenCode -split "`n" | Select-Object -First 4 | ForEach-Object { $_.Trim() }) -join "`n      ")
            Write-Host ""
        }
        Write-Host "      Corre el 'Diagnostico de Tecnia Bot' del menu inicio: dice si"
        Write-Host "      fue el antivirus, el procesador, el disco o la red."
        Write-Host ""
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
    Bajar -Url "https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py" -Destino $Tmp | Out-Null
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
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoDir "install\install.ps1")

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
    exit 1
}
$cfgDir = if ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "opencode" } else { Join-Path $env:USERPROFILE ".config\opencode" }
if (-not (Test-Path (Join-Path $cfgDir "agent\tecnia-bot.md"))) {
    Write-Host ""
    Write-Host "  [X] La capa educativa no quedo publicada." -ForegroundColor Red
    Write-Host "      El instalador dijo que termino, pero el agente no esta en:"
    Write-Host "      $cfgDir"
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "  LISTO! Abri una terminal en cualquier carpeta, escribi 'opencode',"
Write-Host "  apreta Tab y elegi 'tecnia-bot'."
Write-Host ""
