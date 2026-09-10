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

# La version de PYTHON, por el MISMO motivo y con la misma mecanica.
#
# Doce lineas mas arriba esta el ensayo entero de por que `scoop install opencode`
# a secas estaba mal: cada PC de la escuela se llevaba la version que fuera la
# ultima ESE DIA, y dos maquinas instaladas con una semana de diferencia tenian dos
# OpenCode distintos. Al bloque de Python nunca se le aplico esa leccion: seguia
# haciendo `scoop install python` a secas, y Python es el PRIMER eslabon de la
# cadena que termina en PlatformIO (ver mas abajo). O sea que la pieza de la que
# depende compilar era justo la que no estaba fijada.
#
# POR QUE 3.14.7 Y NO OTRA: es la version que HOY (2026-09-08), en la maquina real
# de la escuela Juana Manso -la de la usuaria `Direccion310`-, instalo PlatformIO
# Core 6.2.0 y quedo verificada con `pio.exe --version`. No es una eleccion de
# catalogo: es la unica version con la que tenemos PRUEBA de que la cadena entera
# (Python -> get-platformio.py -> venv -> pip install platformio) funciona.
#
# DIFERENCIA A PROPOSITO CON OpenCode: si el archivo falta o esta roto, ACA NO SE
# CORTA. Sin OpenCode no hay producto y cortar es lo correcto; sin Python solo falta
# PlatformIO, y la regla de este repo -escrita en el mensaje de mas abajo y
# custodiada por tests/instalador.test.mjs- es que sin PlatformIO el bot igual sirve
# para explicar, dibujar circuitos y repartir fichas. Dejar sin Tecnia Bot a un aula
# por un archivo de version es peor que instalar Python sin fijar.
$ArchivoVersionPython = Join-Path $PSScriptRoot "PYTHON_VERSION"
$PythonVersion = ""
if (Test-Path $ArchivoVersionPython) {
    $PythonVersion = (Get-Content $ArchivoVersionPython -Raw).Trim()
}
if ($PythonVersion -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "  [!] No se pudo leer la version de Python a instalar ($ArchivoVersionPython)." -ForegroundColor Yellow
    Write-Host "      Se instala la ultima que ofrezca Scoop, sin fijar."
    $PythonVersion = ""
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
function Quitar-ShimRoto {
    # Un shim que existe pero no contesta `--version` esta roto (un exe ajeno copiado encima,
    # un enlace a una carpeta que ya no esta). Si se lo deja, `scoop reset` entra en
    # warn_on_overwrite (core.ps1) y con un shim ajeno arma la ruta "opencode.shim." con
    # un punto final, que Test-Path acepta y Remove-Item no: excepcion, shim sin rehacer.
    # Visto con el .exe real en la VM. Sin shim previo, esa funcion vuelve enseguida.
    $shimExe = Join-Path $env:USERPROFILE "scoop\shims\opencode.exe"
    if (-not (Test-Path $shimExe)) { return }
    $global:LASTEXITCODE = 1
    $r = ""
    try { $r = (& $shimExe --version 2>&1 | Out-String) } catch { $r = "" }
    if ($LASTEXITCODE -eq 0 -and $r -match '\d+\.\d+\.\d+') { return }
    # No se borra: se APARTA con otro nombre (regla: puede fallar, no puede romper). Scoop no
    # lo ve mas y crea el suyo limpio; el apartado queda para mirarlo si hace falta.
    Write-Host "  [i] El shim de OpenCode no contesta: lo aparto (opencode.exe.roto) para que Scoop lo rehaga limpio."
    Move-Item $shimExe ($shimExe + ".roto") -Force -ErrorAction SilentlyContinue
    $shimTxt = Join-Path $env:USERPROFILE "scoop\shims\opencode.shim"
    if (Test-Path $shimTxt) { Move-Item $shimTxt ($shimTxt + ".roto") -Force -ErrorAction SilentlyContinue }
}

function Reparar-Shim {
    Quitar-ShimRoto
    if (-not (Test-Path $BinOpenCode)) { return $false }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $global:LASTEXITCODE = 0
        $salida = scoop reset opencode *>&1 | Out-String
        foreach ($l in ($salida -split "`n")) { if ($l -match "ERROR|Exception|Terminaci") { Write-Host ("      " + $l.Trim()) } }
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
    # Si el comando `opencode` no esta en el PATH de ESTE proceso, NO es "no arranca":
    # lanzado desde el instalador (Inno), el proceso hereda un PATH sin scoop\shims y
    # Get-Command falla aunque todo este bien. Se salta el shim y se prueba el binario real.
    $hayShim = [bool](Get-Command opencode -ErrorAction SilentlyContinue)
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
            if (-not $hayShim) { break }
            $global:LASTEXITCODE = 0
            $script:SalidaOpenCode = (& opencode --version 2>&1 | Out-String)
            if ($LASTEXITCODE -eq 0 -and $script:SalidaOpenCode -match '\d+\.\d+\.\d+') { return $true }
            if ($intento -eq 1) { Start-Sleep -Seconds 3 }
        }
        # El shim de Scoop (20 KB) fallo dos veces. Antes de decir "OpenCode no arranca" se
        # pregunta al BINARIO REAL: en la VM y en una notebook, el shim tiro "Shim: Could not
        # determine if target is a GUI app" justo despues de que Scoop se actualizo a si
        # mismo, mientras opencode.exe andaba perfecto. Si el binario contesta, OpenCode
        # arranca; lo roto es el shim, y eso lo rehace `scoop reset` sin bajar nada.
        # Hasta tres intentos espaciados: recien instalado, el antivirus suele estar leyendo
        # el binario (180 MB) y el proceso no llega a arrancar (exit 1, sin salida). Se vio
        # en la VM con el .exe real: a mano, el mismo binario contestaba al instante.
        $global:LASTEXITCODE = 1
        $directo = ""
        foreach ($intentoBin in 1, 2, 3) {
            $global:LASTEXITCODE = 1
            try { $directo = (& $BinOpenCode --version 2>&1 | Out-String) } catch { $directo = "" }
            if ($LASTEXITCODE -eq 0 -and $directo -match '\d+\.\d+\.\d+') { break }
            Write-Host ("  [i] El binario de OpenCode no contesto (intento " + $intentoBin + ": exit=" + $LASTEXITCODE + "). Espero 5 s...")
            Start-Sleep -Seconds 5
        }
        if ($LASTEXITCODE -eq 0 -and $directo -match '\d+\.\d+\.\d+') { Write-Host "  [i] El binario de OpenCode arranca pero su shim de Scoop fallo. Rehago el shim (scoop reset)..."; Reparar-Shim | Out-Null; $script:SalidaOpenCode = $directo; return $true }
        # Queda escrito POR QUE se decidio que no arranca: sin esto, en una notebook real se
        # discutio media hora sobre un "no arranca" que nadie podia explicar.
        $bits = if ([Environment]::Is64BitProcess) { "64" } else { "32" }
        Write-Host ("  [i] Chequeo de OpenCode: shim en PATH=" + $hayShim + ", PowerShell de " + $bits + " bits, binario '" + $BinOpenCode + "' exit=" + $LASTEXITCODE + ", salida: " + (($directo -replace "\s+", " ").Trim()).Substring(0, [Math]::Min(120, (($directo -replace "\s+", " ").Trim()).Length)))
        $dirCurrent = Split-Path $BinOpenCode -Parent
        $infoCurrent = try { $it = Get-Item $dirCurrent -Force -ErrorAction Stop; "attr=" + $it.Attributes + " target=" + $it.Target } catch { "Get-Item fallo: " + $_.Exception.Message }
        $versiones = try { (Get-ChildItem (Split-Path $dirCurrent -Parent) -Name -ErrorAction Stop) -join "," } catch { "?" }
        Write-Host ("      entorno: cwd=" + (Get-Location).Path + " | TEMP=" + $env:TEMP + " | __COMPAT_LAYER=" + $env:__COMPAT_LAYER + " | stdin redirigido=" + [Console]::IsInputRedirected + " | stdout redirigido=" + [Console]::IsOutputRedirected + " | procesos opencode=" + @(Get-Process opencode -ErrorAction SilentlyContinue).Count)
        Write-Host ("      binario: File.Exists=" + [System.IO.File]::Exists($BinOpenCode) + " | Directory.Exists(current)=" + [System.IO.Directory]::Exists($dirCurrent) + " | current: " + $infoCurrent + " | versiones en apps\opencode: " + $versiones)
        $dirReal = try { (Get-Item $dirCurrent -Force).Target } catch { $dirCurrent }
        $archivos = try { (Get-ChildItem $dirReal -Force -ErrorAction Stop | ForEach-Object { $_.Name + "(" + $_.Length + ")" }) -join "," } catch { "Get-ChildItem fallo: " + $_.Exception.Message }
        $cmdDir = try { (& cmd /c "dir /b `"$dirReal`"" 2>&1 | Out-String) -replace "\s+", "," } catch { "?" }
        $ident = try { (& whoami /groups 2>&1 | Out-String) -split "`n" | Where-Object { $_ -match "Mandatory|Nivel" } | ForEach-Object { $_.Trim() -replace "\s+", " " } } catch { "?" }
        $padre = try { (Get-Process -Id (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId -ErrorAction Stop).Name } catch { "?" }
        Write-Host ("      carpeta real: " + $dirReal + " | archivos: " + $archivos + " | dir: " + $cmdDir)
        $etiqueta = ($ident | Where-Object { $_ -match "Mandatory Level|Nivel" } | Select-Object -First 1)
        if (-not $etiqueta) { $etiqueta = ($ident | Select-Object -First 1) }
        Write-Host ("      proceso: integridad=" + ([string]$etiqueta).Substring(0, [Math]::Min(60, ([string]$etiqueta).Length)) + " | padre=" + $padre + " | 64bitOS=" + [Environment]::Is64BitOperatingSystem + " | usuario=" + $env:USERNAME)
        $exeReal = Join-Path $dirReal "opencode.exe"
        $global:LASTEXITCODE = 1
        $vReal = try { (& $exeReal --version 2>&1 | Out-String).Trim() } catch { "excepcion: " + $_.Exception.Message }
        Write-Host ("      DISCRIMINA: File.Exists(real exe)=" + [System.IO.File]::Exists($exeReal) + " | File.Exists(current\manifest.json)=" + [System.IO.File]::Exists((Join-Path $dirCurrent "manifest.json")) + " | real exe --version exit=" + $LASTEXITCODE + " salida=" + ($vReal -replace "\s+", " ").Substring(0, [Math]::Min(60, ($vReal -replace "\s+", " ").Length)))
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
            # La fijada no esta en el disco. Instalarla con Scoop a version explicita la pone AL LADO
            # de la que hay y cambia el enlace 'current': no desinstala nada (verificado en
            # libexec/scoop-install.ps1: solo se salta si ESA version ya esta instalada).
            # Visto en una notebook real: tenia 1.18.19 -> 1.18.29 (auto-update) y nunca la
            # fijada; antes se dejaba como estaba y el pin no servia para nada.
            Write-Host "  [..] La $OpenCodeVersion no esta en el disco: la instalo al lado (no se borra la $instalada)..."
            $prev = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            $salidaInst = ""
            try {
                $salidaInst = scoop install opencode@$OpenCodeVersion *>&1 | Out-String
            } catch {
                $salidaInst = "ERROR " + $_.Exception.Message
            }
            $ErrorActionPreference = $prev
            Refresh-Path
            $quedo = Get-OpenCodeVersionInstalada
            if ($quedo -eq $OpenCodeVersion -and (Test-OpenCode)) {
                Write-Host "  [OK] OpenCode queda en la version $OpenCodeVersion y arranca."
            } else {
                Write-Host "  [X] No pude dejar la version ${OpenCodeVersion} andando: activa la $quedo."
                if ($salidaInst -match "still running") {
                    Write-Host "      Tecnia Bot (OpenCode) esta abierto. Cerralo y volve a correr 'Reparar Tecnia Bot'."
                } else {
                    foreach ($l in ($salidaInst -split "`n")) { if ($l -match "^\s*ERROR") { Write-Host ("      " + $l.Trim()) } }
                    Write-Host "      Volve a correr 'Reparar Tecnia Bot'; si sigue, en PowerShell: scoop install opencode@$OpenCodeVersion"
                }
            }
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
    $prevInst = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $salidaInstalar = ""
    try { $salidaInstalar = scoop install opencode@$OpenCodeVersion *>&1 | Out-String } catch { $salidaInstalar = "ERROR " + $_.Exception.Message }
    $ErrorActionPreference = $prevInst
    foreach ($l in ($salidaInstalar -split "`n")) { if ($l.Trim() -and $l -notmatch "^\s*(Downloading|Extracting|Checking hash|Loading|Linking|Creating shim)") { Write-Host ("      " + $l.Trim()) } }
    Refresh-Path
    # Notebook real (2026-09-06): la carpeta 1.18.18 estaba en el disco desde agosto pero
    # 'current' apuntaba a 1.18.29 (auto-update). Scoop contesto "already installed" y no
    # activo nada; el bootstrap reintentaba la MISMA instalacion. Lo que corresponde es
    # activarla: `scoop reset opencode@<ver>` mueve 'current' y rehace el shim, sin bajar nada.
    if (($salidaInstalar -match "already installed") -or ((Get-OpenCodeVersionInstalada) -ne $OpenCodeVersion -and (Test-Path (Join-Path $OpenCodeAppDir $OpenCodeVersion)))) {
        Write-Host "  [..] La $OpenCodeVersion ya esta en el disco: la activo (scoop reset)..."
        $ErrorActionPreference = "Continue"
        Quitar-ShimRoto
        $salidaResetInst = ""
        try { $salidaResetInst = scoop reset opencode@$OpenCodeVersion *>&1 | Out-String } catch { $salidaResetInst = "ERROR " + $_.Exception.Message + " | en: " + (($_.ScriptStackTrace -split "`n" | Select-Object -First 3) -join " <- ") }
        $ErrorActionPreference = $prevInst
        # Se muestra lo que dijo Scoop (sin el ruido de descarga): si el reset falla al rehacer
        # el shim, la causa tiene que quedar en el log, no tragada.
        foreach ($l in ($salidaResetInst -split "`n")) { if ($l -match "ERROR|Removing|Creating|Linking|Exception|Terminaci") { Write-Host ("      " + $l.Trim()) } }
        Refresh-Path
    }

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

# Fija Python en la version probada, igual que Fijar-OpenCode.
#
# `scoop hold` NO tira excepcion NI devuelve exit distinto de 0 cuando falla
# (verificado en libexec/scoop-hold.ps1: hace `error "..."; continue` y termina con
# `exit $exitcode` con la variable sin definir). La unica senal fiable es la linea
# que empieza con ERROR; el exit code se mira igual por si algun dia lo arreglan.
# Que el hold falle NO es motivo para cortar: la version ya quedo instalada.
function Fijar-Python {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $global:LASTEXITCODE = 0
        $salida = scoop hold python *>&1 | Out-String
        $errores = @($salida -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^ERROR' })
        if (($LASTEXITCODE -ne 0) -or ($errores.Count -gt 0)) {
            $motivo = if ($errores.Count) { $errores[0] } else { "scoop hold devolvio exit $LASTEXITCODE" }
            Write-Host "  [!] No se pudo fijar Python: $motivo" -ForegroundColor Yellow
            return $false
        }
        Write-Host "  [OK] Python fijado en la version $PythonVersion (scoop hold)."
        return $true
    } catch {
        Write-Host "  [!] No se pudo fijar Python: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    } finally { $ErrorActionPreference = $prev }
}

# Instala Python con Scoop, FIJADO en la version probada, y degrada con gracia.
#
# DEGRADAR CON GRACIA NO ES OPCIONAL, Y ESTE ES EL MOTIVO. Fijar una version que el
# bucket de Scoop no pueda resolver no rompe UNA instalacion: rompe TODAS a la vez,
# en toda la escuela, el mismo dia. Los buckets sacan versiones viejas del manifest
# cuando publican nuevas. Asi que si `scoop install python@<version>` falla, se cae
# a `scoop install python` a secas con un aviso claro en el log -y se pierde el pin,
# que es un problema mucho mas chico que un aula sin Tecnia Bot-.
#
# "already installed" NO es una falla: es lo que Scoop contesta cuando la version
# fijada ya esta en el disco, y es el caso normal al re-correr Reparar.
function Instalar-Python {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $quedoFijada = $false
    try {
        if ($PythonVersion) {
            Write-Host "  [..] Instalando Python $PythonVersion (la version con la que se probo PlatformIO)..."
            $global:LASTEXITCODE = 0
            try { $salida = scoop install python@$PythonVersion *>&1 | Out-String } catch { $salida = "ERROR " + $_.Exception.Message }
            foreach ($l in @($salida -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })) { Write-Host ("      " + $l) }
            $fallo = ($LASTEXITCODE -ne 0) -or ($salida -match '(?m)^\s*ERROR')
            if ($fallo -and ($salida -notmatch "already installed")) {
                Write-Host "  [!] No se pudo instalar Python $PythonVersion (puede no estar mas en el bucket)." -ForegroundColor Yellow
                Write-Host "      Sigo con la ultima que ofrezca Scoop, SIN fijar: quedarse sin Python"
                Write-Host "      -y por lo tanto sin PlatformIO- por una version es peor que no fijarla."
            } else {
                $quedoFijada = $true
            }
        }
        if ($quedoFijada) {
            [void](Fijar-Python)
        } else {
            $global:LASTEXITCODE = 0
            try { $salida = scoop install python *>&1 | Out-String } catch { $salida = "ERROR " + $_.Exception.Message }
            foreach ($l in @($salida -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })) { Write-Host ("      " + $l) }
        }
    } finally { $ErrorActionPreference = $prev }
}

# ULTIMO RECURSO cuando Buscar-Python no encontro NADA usable: rehacer lo que Scoop
# administra. `scoop reset python` rehace shims, el enlace 'current' y el PATH desde
# la version ya instalada, SIN descargar nada.
#
# EL DISPARADOR ES "NO HAY PYTHON", Y NO PUEDE SER OTRA COSA. Una version anterior de
# este bloque reseteaba cuando faltaba scoop\shims\python.exe teniendo la app, con la
# teoria de que Scoop habia abortado antes de crear el shim (el modo de falla que SI
# tiene OpenCode). Estaba mal, y lo corrigio una medicion en la VM Windows 10 sobre
# una instalacion sana:
#
#     scoop\shims\python.exe                -> False
#     scoop\shims\python3.exe               -> True
#     scoop\apps\python\current\python.exe  -> True
#
# El manifest main/bucket/python.json declara
# bin: [["python.exe","python3"], "Lib\idlelib\idle.bat", ...], y en Scoop
# ["archivo","nombre"] significa "shimea ESE archivo CON ESE nombre": el unico shim
# que sale de ahi se llama python3.exe. NUNCA existio un scoop\shims\python.exe, en
# ninguna maquina. O sea que aquella condicion era verdadera SIEMPRE y el reset
# corria en cada instalacion sin arreglar nada: un no-op ruidoso construido sobre un
# falso positivo. Ademas el manifest trae env_add_path: ["Scripts", "."], asi que la
# carpeta de la app entra al PATH y `python` pelado resuelve igual.
#
# Buscar-Python ya acertaba sin ayuda: su candidato numero 2 es
# scoop\apps\python\current\python.exe, que SI existe. El codigo estaba bien; lo que
# estaba mal era el diagnostico.
function Reparar-ScoopPython {
    if (-not (Get-Command scoop -ErrorAction SilentlyContinue)) { return }
    Write-Host "  [..] No aparece ningun Python usable: le pido a Scoop que rehaga lo suyo (scoop reset)..."
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $salidaReset = scoop reset python *>&1 | Out-String
        foreach ($l in @($salidaReset -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })) { Write-Host ("      " + $l) }
    } catch {
    } finally { $ErrorActionPreference = $prev }
}

# TRES LUGARES DONDE BUSCAR, no uno -- ahora le toca a PlatformIO.
#
# Es la MISMA leccion que el lanzador (installer\abrir-tecnia-bot.cmd) aprendio
# buscando OpenCode y que Buscar-Python, aca arriba, aprendio buscando Python. Es
# la TERCERA vez que muerde, y esta vez costo tres semanas de una docente.
#
# EL CASO REAL (escuela Juana Manso, 2026-09-08). La usuaria de Windows se llama
# `Direccion310` -- con `o` acentuada, que NO es ASCII. PlatformIO Core no soporta
# rutas con caracteres no-ASCII (sus toolchains de gcc se rompen), asi que en
# Windows RELOCALIZA su core_dir a la raiz del disco. Es comportamiento documentado
# de PlatformIO, no un bug de ellos. El instalador oficial dejo esto en pantalla:
#
#     Creating a virtual environment at C:\.platformio\penv
#     PlatformIO Core has been successfully installed into an isolated environment
#     The full path to platformio.exe is C:\.platformio\penv\Scripts\platformio.exe
#
# Nosotros mirabamos UNA sola ruta -- $env:USERPROFILE\.platformio -- asi que este
# bloque imprimia "[!] PlatformIO NO quedo instalado" en una maquina donde
# `pio.exe --version` contestaba "PlatformIO Core, version 6.2.0". Tres semanas
# diciendole a una docente que le faltaba algo que tenia.
#
# Por eso ahora es una LISTA ORDENADA de candidatos, no una ruta:
#   1. $env:PLATFORMIO_CORE_DIR, si el usuario la seteo (lo explicito gana)
#   2. $USERPROFILE\.platformio            (la instalacion normal)
#   3. la raiz del disco de $USERPROFILE   <- el caso de arriba
#   4. C:\.platformio fijo, por si el perfil vive en otro disco
#   5. el PATH (`pio` y `platformio`)
#
# ESTA LOGICA ESTA REPETIDA en diagnostico.ps1, install.ps1, bootstrap.sh,
# install.sh y opencode\tool\platformio.ts, A PROPOSITO. Ninguno de los .ps1 hace
# dot-sourcing de otro: cada script se copia y corre SOLO (el .exe de Inno lleva
# unos, el menu inicio lanza otros, /reparar lanza el bootstrap desde adentro del
# bot). Meter un modulo compartido es un cambio estructural que no corresponde a
# este arreglo. Lo que mantiene honestas a las seis copias es el test
# tests/platformio-pio.test.mjs, que le exige a cada archivo que contemple
# PLATFORMIO_CORE_DIR y la raiz del disco. Si agregas una septima copia, agregala
# tambien a ese test.
function Rutas-PioCore {
    $dirs = @()
    if ($env:PLATFORMIO_CORE_DIR) { $dirs += $env:PLATFORMIO_CORE_DIR }
    $dirs += (Join-Path $env:USERPROFILE ".platformio")
    # GetPathRoot("C:\Users\Direccion310") devuelve "C:\": la raiz del disco donde
    # vive el perfil, que es adonde PlatformIO se muda cuando el nombre no es ASCII.
    $raiz = [System.IO.Path]::GetPathRoot($env:USERPROFILE)
    if ($raiz) { $dirs += (Join-Path $raiz ".platformio") }
    $dirs += "C:\.platformio"
    return ($dirs | Select-Object -Unique)
}

# Devuelve la ruta del pio que ANDA, o $null.
#
# En cada carpeta se miran pio.exe Y platformio.exe: normalmente estan los dos,
# pero el mensaje final del instalador oficial nombra platformio.exe y no queremos
# depender de que exista justo el que elegimos nosotros.
#
# Y AL PRIMERO QUE EXISTA SE LE PREGUNTA --version, no se supone que anda por donde
# vive. Es la misma regla que Buscar-Python: cuesta un segundo, corre una sola vez,
# y atrapa un venv a medio armar (el caso "penv existe pero pypi.org estaba
# bloqueado" que diagnostico.ps1 documenta). El tool platformio.ts NO hace esto: esta
# en el camino caliente y le alcanza con que el archivo exista. La asimetria es
# deliberada.
#
# 2>&1 de un comando nativo con $ErrorActionPreference = "Stop" revienta en
# PowerShell 5.1 (la trampa que ya resolvio Buscar-Python): se baja a Continue solo
# para preguntar, y $LASTEXITCODE se resetea a mano antes de cada intento.
function Buscar-Pio {
    $candidatos = @()
    foreach ($dir in (Rutas-PioCore)) {
        foreach ($nombre in @("pio.exe", "platformio.exe")) {
            $candidatos += (Join-Path $dir "penv\Scripts\$nombre")
        }
    }
    # El PATH al final: PlatformIO casi nunca queda ahi, pero si alguien lo agrego
    # a mano (o install.ps1 ya corrio) es una respuesta valida.
    foreach ($c in (Get-Command -Name pio, platformio -All -CommandType Application -ErrorAction SilentlyContinue)) {
        if ($c.Source) { $candidatos += $c.Source }
    }
    foreach ($ruta in $candidatos) {
        if (-not $ruta) { continue }
        if (-not (Test-Path $ruta)) { continue }
        $prev = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $global:LASTEXITCODE = 0
            $v = (& $ruta --version 2>&1 | Out-String)
            if ($LASTEXITCODE -eq 0 -and $v -match "PlatformIO") { return $ruta }
        } catch { } finally { $ErrorActionPreference = $prev }
    }
    return $null
}

# --- 3. Python + PlatformIO -------------------------------------------------
$PioExe = Buscar-Pio
if ($PioExe) {
    Write-Host "  [OK] PlatformIO ya esta instalado ($PioExe)"
} else {
    Write-Host "  [..] Instalando PlatformIO Core (no necesita admin)..."
    # Python: NO usar 'Get-Command python' - Windows 10/11 trae un stub de la
    # Microsoft Store con ese nombre que NO es Python real y hace fallar la
    # instalacion. Instalamos con Scoop (idempotente) y lo llamamos por ruta.
    # Y FIJADO en $PythonVersion, no "la ultima de hoy": ver el comentario de
    # Instalar-Python y el de PYTHON_VERSION alla arriba.
    Instalar-Python
    Refresh-Path
    $PyExe = Buscar-Python
    # Sin Python usable, un ultimo intento: que Scoop rehaga shims y PATH. Se vuelve a
    # preguntar UNA vez; si sigue sin aparecer, el mensaje de abajo queda como esta.
    if (-not $PyExe) { Reparar-ScoopPython; Refresh-Path; $PyExe = Buscar-Python }
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
    # Se verifica el ejecutable en disco, no el PATH: PlatformIO se instala en su
    # venv privado y no agrega nada al PATH de esta consola. Se vuelve a BUSCAR (no
    # se reusa el $PioExe de arriba) porque recien ahora sabemos donde eligio
    # instalarse: si el nombre de usuario no es ASCII, se fue a la raiz del disco.
    $PioExe = Buscar-Pio
    if (-not $PioExe) {
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
        # Se dice la ruta REAL, no "~/.platformio": cuando PlatformIO se relocaliza a
        # la raiz del disco, decir la ruta de siempre manda al docente a mirar una
        # carpeta que no existe. Eso fue exactamente lo que paso durante tres semanas.
        Write-Host "  [OK] PlatformIO instalado en $PioExe (Tecnia Bot lo encuentra solo)."
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
