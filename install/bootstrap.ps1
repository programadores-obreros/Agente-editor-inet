# ============================================================================
# Tecnia Bot - instalador COMPLETO para Windows (PowerShell).
# Instala TODO en un solo paso y SIN permisos de administrador (usa Scoop):
#   1. Scoop (gestor de paquetes en espacio de usuario)
#   2. OpenCode (el editor de IA donde vive Tecnia Bot)
#   3. Python + PlatformIO Core (para compilar y cargar a la placa)
#   4. Node.js LTS (para el skill de diagramas de arquitectura, archify)
#   5. Tecnia Bot (la capa educativa)
#
# Uso: clic derecho -> "Ejecutar con PowerShell", o desde una terminal:
#   powershell -ExecutionPolicy Bypass -File install\bootstrap.ps1
#
# CODIGOS DE SALIDA. Son un CONTRATO: los lee installer\tecnia-bot.iss para
# decidir que le dice al docente en la ultima pantalla (y con que codigo termina
# el .exe en modo silencioso), y el job windows de la CI. Salen del RESUMEN
# FINAL de este script, que se arma con lo que se COMPROBO -ejecutando cada
# binario y mirando el disco-, no con lo que se intento.
#
#   0 = TODO quedo y se comprobo: OpenCode arranca y es la version fijada,
#       PlatformIO contesta, Node contesta y alcanza, la capa esta publicada.
#   2 = INSTALADO PERO DEGRADADO: el bot abre (OpenCode arranca y la capa esta
#       publicada), pero falta algo de lo demas: PlatformIO (no compila ni
#       carga), Node (no anda el skill de diagramas), OpenCode quedo en una
#       version que no es la probada, o install.ps1 instalo la capa CON AVISOS
#       (su codigo 3: la capa se copio pero no pudo escribir la config o
#       guardar la key). Vive en $CodigoDegradado.
#   1 = FALLA: el bot NO se puede usar. OpenCode no arranca, la capa no quedo
#       publicada, no se pudo instalar Scoop, o falta install\OPENCODE_VERSION.
#       Es tambien lo que devuelve powershell.exe si el script no parsea o muere
#       con un error sin atajar, asi que "1" nunca significa "anduvo".
#
# Antes de este contrato el script salia con 0 y "LISTO!" aunque faltaran
# PlatformIO y Node: sus avisos quedaban cien lineas mas arriba, y quien miraba
# el final -una persona o el .exe- se llevaba un OK.
#
# Quien mas corre este script y que hace con el codigo (revisado al definirlo):
#   installer\abrir-tecnia-bot.cmd  no lo mira: vuelve a verificar por su cuenta.
#   opencode\tool\platformio.ts     solo distingue 127 (no pudo lanzar PowerShell)
#                                   y despues busca pio.exe en el disco.
# ============================================================================

# -SinPrompt: NO preguntar nada y NO tocar lo que ya este configurado.
#
# POR QUE EXISTE. El instalador ofrece cambiar la key de Google cuando ya hay una
# guardada, y espera 60 segundos por si el docente quiere pegar una nueva. Frente
# a una persona eso esta bien. Pero un despliegue silencioso (/VERYSILENT) no
# tiene a nadie tipeando, y ahi los 60 segundos son 60 segundos de nada: medido
# en la VM, una reinstalacion sobre una maquina ya configurada paso de instantanea
# a 63 segundos, y de eso 60 eran la espera. En una escuela con veinte maquinas
# son veinte minutos de reloj regalados.
#
# No alcanza con detectar "no hay consola": corriendo por /VERYSILENT SI hay una
# consola real (solo que vacia), asi que el sondeo de teclado no falla y espera
# hasta el final. Quien sabe que nadie va a contestar es el instalador, y por eso
# la sena baja desde el .iss: installer\tecnia-bot.iss agrega -SinPrompt cuando
# WizardSilent() es verdadero.
#
# Se traduce a TECNIA_SIN_PROMPT, que es la variable que install.ps1 ya sabia
# mirar, para no inventar un segundo mecanismo que diga lo mismo. Se define en
# ESTE proceso: install.ps1 corre como hijo y la hereda.
param([switch]$SinPrompt)

$ErrorActionPreference = "Stop"
if ($SinPrompt) { $env:TECNIA_SIN_PROMPT = "1" }
# "Instalado pero degradado": ver CODIGOS DE SALIDA en el encabezado. Tiene que
# coincidir con CodigoBootstrapDegradado en installer\tecnia-bot.iss; hay un test
# (tests/instalador-honesto.test.mjs) que compara los dos archivos.
$CodigoDegradado = 2
# Lo que devuelve install\install.ps1 cuando la capa quedo "instalada CON AVISOS".
# Contrato de ESE script (0 = instalado, 3 = instalado con avisos, 1 = se corto),
# acordado con quien lo mantiene; se usa mas abajo, donde se mira su codigo.
$CodigoCapaConAvisos = 3
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
$HayTranscript = $false
try { Start-Transcript -Path $LogInstalacion -Force | Out-Null; $HayTranscript = $true } catch { }

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
    # El [string] NO es adorno. Con el archivo VACIO, `Get-Content -Raw` devuelve
    # $null, y `$null.Trim()` no da "": tira "No se puede llamar a un metodo en una
    # expresion con valor NULL" y con ErrorActionPreference=Stop el script moria
    # ahi, con esa traza cruda, sin llegar al mensaje de abajo que dice justamente
    # "El archivo falta o esta vacio". Visto en la VM win10 el 2026-11-15 instalando
    # un .exe compilado con OPENCODE_VERSION vacio. Lo mismo vale para cada lectura
    # de un archivo de una linea en estos scripts (VERSION, PYTHON_VERSION,
    # NODE_VERSION): todas llevan el [string].
    $OpenCodeVersion = ([string](Get-Content $ArchivoVersionOpenCode -Raw)).Trim()
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
    $PythonVersion = ([string](Get-Content $ArchivoVersionPython -Raw)).Trim()
}
if ($PythonVersion -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "  [!] No se pudo leer la version de Python a instalar ($ArchivoVersionPython)." -ForegroundColor Yellow
    Write-Host "      Se instala la ultima que ofrezca Scoop, sin fijar."
    $PythonVersion = ""
}

# La version de NODE, con la misma mecanica que Python de aca arriba: archivo
# propio, mismo regex, mismo aviso amarillo si falta o esta roto -sin cortar-.
#
# POR QUE EL BUCKET "nodejs-lts" Y NO "nodejs". Node se instala para que corra el
# skill de diagramas de arquitectura (archify, en opencode\skills\archify), que se
# ejecuta con `node bin/archify.mjs`. El bucket main de Scoop trae dos paquetes:
# "nodejs" (la de punta, 26.8.1 al momento de escribir esto) y "nodejs-lts" (la
# LTS, 24.20.0) -numeros verificados el 2026-09-23 contra el bucket que ve la VM
# Windows de pruebas-. Se elige la LTS por el mismo criterio que ya rige a
# OpenCode y Python en este archivo: en un aula, que las veinte maquinas
# terminen con el MISMO binario vale mas que tener la version mas nueva del dia
# en que le toco instalarse a cada una. archify solo exige "node >= 18" en su
# doctor, asi que cualquiera de las dos alcanza para eso; la LTS gana por
# previsibilidad, no porque la de punta este rota.
#
# DIFERENCIA A PROPOSITO CON Python: aca la falla importa TODAVIA MENOS. Sin
# Python se pierde PlatformIO, que es la mitad de lo que hace este bot (compilar
# y cargar codigo). Sin Node se pierde UN skill de veinte (opencode\skills\
# tiene otros diecinueve que no lo necesitan): el resto de Tecnia Bot -explicar,
# armar circuitos, repartir fichas, y hasta compilar si Python quedo instalado-
# sigue andando igual. Por eso, mas abajo, Instalar-Node nunca hace `exit`: como mucho
# imprime un aviso y sigue.
$ArchivoVersionNode = Join-Path $PSScriptRoot "NODE_VERSION"
$NodeVersion = ""
if (Test-Path $ArchivoVersionNode) {
    $NodeVersion = ([string](Get-Content $ArchivoVersionNode -Raw)).Trim()
}
if ($NodeVersion -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "  [!] No se pudo leer la version de Node a instalar ($ArchivoVersionNode)." -ForegroundColor Yellow
    Write-Host "      Se instala la ultima LTS que ofrezca Scoop, sin fijar."
    $NodeVersion = ""
}

# El Node MINIMO que sirve, leido de quien lo exige y no escrito aca.
#
# Buscar-Node aceptaba cualquier cosa que contestara "v" y un digito: un Node 12
# que el docente tuviera de otro curso daba "[OK] Node ya esta instalado" y el
# skill de diagramas fallaba despues, adentro del bot, lejos de la causa. El
# numero lo fija archify en su package.json ("engines": { "node": ">=18" }, el
# mismo que chequea su doctor en bin\archify.mjs), y ese archivo viaja al lado
# de este script tanto en el repo como en el .exe (que copia opencode\ entero).
# Se lee de AHI: si archify sube su minimo, este instalador se entera solo.
#
# Si no se puede leer NO se inventa un numero: se avisa y se acepta cualquier
# Node que conteste, que es lo que se hacia antes.
$ArchivoMotorNode = Join-Path $RepoDir "opencode\skills\archify\package.json"
$NodeMinimo = 0
try {
    if (Test-Path $ArchivoMotorNode) {
        $motorNode = "" + (Get-Content $ArchivoMotorNode -Raw | ConvertFrom-Json).engines.node
        if ($motorNode -match '^\s*>=\s*(\d+)') { $NodeMinimo = [int]$Matches[1] }
    }
} catch { $NodeMinimo = 0 }
if ($NodeMinimo -le 0) {
    Write-Host "  [!] No se pudo leer que version de Node necesita el skill de diagramas ($ArchivoMotorNode)." -ForegroundColor Yellow
    Write-Host "      Se acepta cualquier Node que conteste, sin comprobar que alcance."
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
# Scoop registra lo que instalo en apps\opencode\current\: el manifiesto y el
# install (donde va el "hold"). Scoop 0.6.0 (2026-09-30) los RENOMBRO:
# manifest.json -> scoop-manifest.json e install.json -> scoop-install.json.
# Buscar solo el nombre viejo daba "OPENCODE NO ARRANCA" con un OpenCode que
# contestaba su version (CI Windows del 2026-10-14, issue #42; reproducido en la
# VM win10 con Scoop 0.6.0). Se busca el nuevo y, si no esta, el viejo: las
# instalaciones hechas con Scoop 0.5 siguen con los nombres de antes.
function Get-ArchivoScoop([string]$dirApp, [string]$nombre) {
    foreach ($n in @("scoop-$nombre.json", "$nombre.json")) {
        $p = Join-Path $dirApp $n
        if (Test-Path $p) { return $p }
    }
    return $null
}

# Si no hay manifiesto, para Scoop OpenCode no existe, corra lo que corra.
function Test-OpenCodeScoop {
    return [bool](Get-ArchivoScoop (Join-Path $OpenCodeAppDir "current") "manifest")
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
        Write-Host ("      DISCRIMINA: File.Exists(real exe)=" + [System.IO.File]::Exists($exeReal) + " | manifiesto Scoop en current=" + [bool](Get-ArchivoScoop $dirCurrent "manifest") + " | real exe --version exit=" + $LASTEXITCODE + " salida=" + ($vReal -replace "\s+", " ").Substring(0, [Math]::Min(60, ($vReal -replace "\s+", " ").Length)))
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
    # LA BAJADA DEL INSTALADOR DE SCOOP TIENE RED DE SEGURIDAD. Bajar relanza al
    # tercer intento y aca no habia nada que lo atajara: con ErrorActionPreference
    # en Stop, una escuela sin internet -o con get.scoop.sh filtrado- veia morir el
    # script con una excepcion cruda de Invoke-RestMethod, en ingles, sin una sola
    # linea que dijera que hacer. Sin Scoop no se puede seguir (OpenCode se instala
    # con el), asi que se corta igual; lo que cambia es que se corta DICIENDO por
    # que, y con el transcript cerrado.
    $scoopInstaller = $null
    $errorScoop = ""
    try { $scoopInstaller = Bajar -Url "https://get.scoop.sh" } catch { $errorScoop = $_.Exception.Message }
    if (-not $scoopInstaller) {
        Write-Host ""
        Write-Host "  [X] No pude bajar el instalador de Scoop, y sin Scoop no se puede seguir." -ForegroundColor Red
        Write-Host ""
        Write-Host "      O esta maquina no tiene internet en este momento, o la red de la"
        Write-Host "      escuela bloquea la direccion get.scoop.sh."
        if ($errorScoop) { Write-Host "      Esto contesto la descarga: $errorScoop" }
        Write-Host ""
        Write-Host "      Todavia no se instalo nada. Cuando haya conexion, volve a correr este"
        Write-Host "      instalador (o 'Reparar Tecnia Bot' en el menu inicio)."
        Write-Host ""
        try { Stop-Transcript | Out-Null } catch { }
        exit 1
    }
    # Y SU EJECUCION TAMBIEN, POR DOS MOTIVOS DISTINTOS.
    #
    # 1. Una excepcion del instalador de Scoop mataba este script igual que la
    #    descarga. Ahora se captura, se muestra, y decide la verificacion de abajo
    #    (si `scoop` quedo o no), que es la que mira el resultado.
    #
    # 2. El `foreach` de UNA vuelta no es un adorno. El instalador de Scoop, cuando
    #    no tiene ruta de archivo -y corrido como scriptblock no la tiene-, no sale
    #    con `exit`: sale con `break`. El `break` esta en su funcion Exit-Install,
    #    a la que llama Deny-Install, que es la que usa cada rechazo. Leido en
    #    github.com/ScoopInstaller/Install, install.ps1, rama master, lineas 91 a
    #    115 el dia que se escribio esto:
    #        if ((-not $env:CI) -and $IS_EXECUTED_FROM_IEX) { break } else { exit $ErrorCode }
    #    OJO con el "-not $env:CI": en un runner de CI esa variable esta puesta y
    #    el instalador de Scoop sale con `exit`, no con `break`. O sea que la CI
    #    NO ejercita el camino del `break`, que es el que ve una escuela; ese se
    #    prueba en la VM. Lo hace en cada rechazo: politica de
    #    ejecucion restrictiva, corriendo como admin sin -RunAsAdmin, o "Scoop is
    #    already installed" cuando la carpeta scoop existe pero el comando no esta.
    #    Y un `break` sin un bucle que lo contenga sube por la pila de llamadas y,
    #    si no encuentra ninguno, TERMINA EL SCRIPT EN SILENCIO (about_Break): este
    #    instalador se cortaba ahi, sin mensaje y sin llegar al "[X] Scoop NO quedo
    #    instalado" de abajo. Con el bucle, el `break` termina el bucle y nada mas.
    #    NO ESTA PROBADO en Windows: sale de leer las dos fuentes, no de verlo andar.
    $errorScoop = ""
    foreach ($unaVez in 1) {
        if ($esAdmin) {
            Write-Host "  [i] Ejecutando como administrador: instalando Scoop en modo admin."
            try { & ([scriptblock]::Create($scoopInstaller)) -RunAsAdmin } catch { $errorScoop = $_.Exception.Message }
        } else {
            try { & ([scriptblock]::Create($scoopInstaller)) } catch { $errorScoop = $_.Exception.Message }
        }
    }
    if ($errorScoop) { Write-Host "  [i] El instalador de Scoop termino con un error: $errorScoop" }
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

# La version que Scoop tiene ACTIVA, leida de su manifiesto (scoop-manifest.json
# desde Scoop 0.6.0, manifest.json antes). Es la que importa para hold/reset,
# mas alla de lo que conteste el binario.
function Get-OpenCodeVersionInstalada {
    $mf = Get-ArchivoScoop (Join-Path $OpenCodeAppDir "current") "manifest"
    try {
        if ($mf) { return ("" + (Get-Content $mf -Raw | ConvertFrom-Json).version).Trim() }
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
        # Se nombra la version que QUEDO ACTIVA, leida del manifiesto de Scoop, no
        # la que se queria: `scoop hold` fija lo que haya. Cuando el cambio a la
        # version probada no se pudo hacer, este mensaje decia "[OK] fijado en la
        # <probada>" con otra version activa.
        $activa = Get-OpenCodeVersionInstalada
        Write-Host "  [OK] OpenCode fijado en la version $activa (scoop hold)."
        if ($activa -ne $OpenCodeVersion) {
            Write-Host "  [!] Esa NO es la $OpenCodeVersion con la que se probo esta version de Tecnia Bot." -ForegroundColor Yellow
        }
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
            # Y RELEER NO ALCANZA: HAY QUE EJECUTARLO. Aca se decia "[OK] OpenCode
            # vuelve a la version X" con solo leer el manifiesto de Scoop, sin correr
            # el binario. El manifiesto dice que carpeta esta activa, no que el
            # programa arranque: una carpeta de la version fijada con el binario que
            # esa CPU no puede ejecutar (sin AVX2), o a medio escanear por el
            # antivirus, daba OK igual. Es la misma leccion de Test-OpenCode -"que el
            # archivo exista no es que el programa corra"- que esta rama no recibio.
            #
            # Si no arranca y el binario esta, se intenta el build 'baseline', igual
            # que la rama de instalacion de mas abajo. Y si sigue sin arrancar SE
            # MARCA la falla: sin eso el script seguia hasta "LISTO!" con exit 0.
            $arranca = [bool](Test-OpenCode)
            if (-not $arranca -and (Test-Path $BinOpenCode)) {
                Write-Host "  [i] El binario de OpenCode esta pero no arranca. Probando la version para procesadores sin AVX2..."
                $arranca = [bool](Install-OpenCodeBaseline)
                $quedo = Get-OpenCodeVersionInstalada
            }
            if (($quedo -eq $OpenCodeVersion) -and $arranca) {
                Write-Host "  [OK] OpenCode vuelve a la version $OpenCodeVersion y arranca."
            } elseif (-not $arranca) {
                $script:FalloOpenCode = $true
                Write-Host "  [X] OpenCode NO ARRANCA despues de activar la version ${OpenCodeVersion} (activa: $quedo)." -ForegroundColor Red
                Write-Host "      Sigo instalando el resto; el aviso completo va al final."
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
            # SI NO ARRANCA, NO ALCANZA CON DECIRLO. Esta rama imprimia "[X] No pude
            # dejar la version ... andando" y nada mas: no probaba el build 'baseline'
            # (CPU sin AVX2) como si hace la rama de instalacion de mas abajo, y no
            # marcaba la falla. Despues Fijar-OpenCode imprimia su [OK] y el script
            # cerraba con "LISTO!" y exit 0 sobre un OpenCode que no abre.
            #
            # Se distinguen los dos casos, que desde afuera se ven igual y no lo son:
            #   ARRANCA, pero en otra version -> el bot abre; es un aviso.
            #   NO ARRANCA                    -> es una falla, y se marca.
            $arranca = [bool](Test-OpenCode)
            if (-not $arranca -and (Test-Path $BinOpenCode)) {
                Write-Host "  [i] El binario de OpenCode esta pero no arranca. Probando la version para procesadores sin AVX2..."
                $arranca = [bool](Install-OpenCodeBaseline)
                $quedo = Get-OpenCodeVersionInstalada
            }
            if (($quedo -eq $OpenCodeVersion) -and $arranca) {
                Write-Host "  [OK] OpenCode queda en la version $OpenCodeVersion y arranca."
            } elseif (-not $arranca) {
                $script:FalloOpenCode = $true
                Write-Host "  [X] OpenCode NO ARRANCA despues de instalar la version ${OpenCodeVersion} (activa: $quedo)." -ForegroundColor Red
                Write-Host "      Sigo instalando el resto; el aviso completo va al final."
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
                # Esta era la UNICA llamada a Scoop del archivo sin bajar el
                # ErrorActionPreference ni capturar: con Stop, un error de Scoop aca
                # mataba el script ANTES de instalar la capa -justo lo que el
                # comentario de mas abajo ("NO SE CORTA ACA") dice que no puede pasar-.
                # Mismo patron que las otras dos: se captura todo, se muestra lo que
                # no es ruido de descarga, y decide la verificacion que sigue.
                $ErrorActionPreference = "Continue"
                $salidaReintento = ""
                try { $salidaReintento = scoop install opencode@$OpenCodeVersion *>&1 | Out-String } catch { $salidaReintento = "ERROR " + $_.Exception.Message }
                $ErrorActionPreference = $prevInst
                foreach ($l in ($salidaReintento -split "`n")) { if ($l.Trim() -and $l -notmatch "^\s*(Downloading|Extracting|Checking hash|Loading|Linking|Creating shim)") { Write-Host ("      " + $l.Trim()) } }
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

# --- Encontrar un Node DE VERDAD ---------------------------------------------
#
# Mismos dos lugares que Buscar-Python (shim de Scoop + carpeta "current"), mas
# el PATH. Node no tiene documentado el senuelo de la Microsoft Store que tiene
# Python -no hay evidencia de un "node.exe" falso en WindowsApps-, asi que este
# bloque no lo filtra: seria inventar un problema que no se vio. Lo que SI se
# repite es preguntarle --version a cada candidato en vez de suponer que sirve
# por donde vive, la misma regla que ya usan Buscar-Python y Buscar-Pio.
function Buscar-Node {
    $candidatos = @(
        (Join-Path $env:USERPROFILE "scoop\shims\node.exe"),
        (Join-Path $env:USERPROFILE "scoop\apps\nodejs-lts\current\node.exe")
    )
    foreach ($c in (Get-Command -Name node -All -CommandType Application -ErrorAction SilentlyContinue)) {
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
            # Que conteste no alcanza: tiene que ser un Node que a archify le SIRVA.
            # El mayor sale de lo que el binario dijo ("v24.20.0" -> 24) y el minimo
            # de $NodeMinimo, que se leyo del package.json de archify alla arriba.
            if ($LASTEXITCODE -eq 0 -and $v -match "^v(\d+)\.") {
                $mayorNode = [int]$Matches[1]
                if ($mayorNode -ge $NodeMinimo) { return $ruta }
                Write-Host ("  [i] " + $ruta + " es Node " + $v.Trim() + " y el skill de diagramas necesita la " + $NodeMinimo + " o mas nueva: no sirve.")
            }
        } catch { } finally { $ErrorActionPreference = $prev }
    }
    return $null
}

# Fija Node en la version probada, igual que Fijar-Python y Fijar-OpenCode.
#
# Mismo comentario que Fijar-Python, no se repite entero: `scoop hold` NO tira
# excepcion NI devuelve exit distinto de 0 cuando falla (libexec/scoop-hold.ps1
# hace `error "..."; continue` y sale con el exit code sin tocar). La unica
# senal fiable es una linea que empiece con ERROR. Que el hold falle no corta
# nada: la version ya quedo instalada.
function Fijar-Node {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $global:LASTEXITCODE = 0
        $salida = scoop hold nodejs-lts *>&1 | Out-String
        $errores = @($salida -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^ERROR' })
        if (($LASTEXITCODE -ne 0) -or ($errores.Count -gt 0)) {
            $motivo = if ($errores.Count) { $errores[0] } else { "scoop hold devolvio exit $LASTEXITCODE" }
            Write-Host "  [!] No se pudo fijar Node: $motivo" -ForegroundColor Yellow
            return $false
        }
        Write-Host "  [OK] Node fijado en la version $NodeVersion (scoop hold)."
        return $true
    } catch {
        Write-Host "  [!] No se pudo fijar Node: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    } finally { $ErrorActionPreference = $prev }
}

# Instala Node (LTS) con Scoop, FIJADO en la version probada, y degrada con
# gracia -igual que Instalar-Python, con la misma razon de fondo: fijar una
# version que el bucket ya no resuelve no rompe una sola maquina, rompe TODAS
# las de la escuela el mismo dia. Si `scoop install nodejs-lts@<version>` falla,
# se cae a `scoop install nodejs-lts` a secas (se pierde el pin, no el canal
# LTS) con un aviso claro en el log.
#
# Y SI NODE NO QUEDA, NO SE CORTA -esta es la parte que no tiene analogo en
# Instalar-Python-. Ni siquiera se reintenta con Reparar-ScoopPython: archify es
# un skill de veinte, no el primer eslabon de nada. El aviso de mas abajo, en la
# seccion 4, es lo unico que hace falta.
function Instalar-Node {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $quedoFijada = $false
    try {
        if ($NodeVersion) {
            Write-Host "  [..] Instalando Node $NodeVersion LTS (para el skill de diagramas de arquitectura)..."
            $global:LASTEXITCODE = 0
            try { $salida = scoop install nodejs-lts@$NodeVersion *>&1 | Out-String } catch { $salida = "ERROR " + $_.Exception.Message }
            foreach ($l in @($salida -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })) { Write-Host ("      " + $l) }
            $fallo = ($LASTEXITCODE -ne 0) -or ($salida -match '(?m)^\s*ERROR')
            if ($fallo -and ($salida -notmatch "already installed")) {
                Write-Host "  [!] No se pudo instalar Node $NodeVersion (puede no estar mas en el bucket)." -ForegroundColor Yellow
                Write-Host "      Sigo con la ultima LTS que ofrezca Scoop, SIN fijar."
            } else {
                $quedoFijada = $true
            }
        }
        if ($quedoFijada) {
            [void](Fijar-Node)
        } else {
            $global:LASTEXITCODE = 0
            try { $salida = scoop install nodejs-lts *>&1 | Out-String } catch { $salida = "ERROR " + $_.Exception.Message }
            foreach ($l in @($salida -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })) { Write-Host ("      " + $l) }
        }
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
        # LA DESCARGA DEL INSTALADOR DE PLATFORMIO TIENE RED DE SEGURIDAD.
        #
        # Estaba pelada: Bajar relanza al tercer intento y, con Stop, el script
        # moria aca con una excepcion cruda ANTES de instalar la capa. Es lo
        # contrario de la regla que este mismo archivo escribe veinte lineas mas
        # abajo -"Tecnia Bot va a arrancar igual"-: una red que filtra
        # raw.githubusercontent.com dejaba el aula sin PlatformIO Y sin bot.
        #
        # Ahora se avisa y se sigue. No se afirma nada desde aca: lo que decide si
        # PlatformIO quedo es el Buscar-Pio de abajo, que mira el disco.
        $errorBajadaPio = ""
        Remove-Item $Tmp -Force -ErrorAction SilentlyContinue
        try { Bajar -Url "https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py" -Destino $Tmp | Out-Null } catch { $errorBajadaPio = $_.Exception.Message }
        if ($errorBajadaPio -or -not (Test-Path $Tmp)) {
            Write-Host "  [!] No pude bajar el instalador de PlatformIO (de raw.githubusercontent.com)." -ForegroundColor Yellow
            Write-Host "      O no hay internet en este momento, o la red de la escuela bloquea esa direccion."
            if ($errorBajadaPio) { Write-Host "      Esto contesto la descarga: $errorBajadaPio" }
            Write-Host "      Sigo con el resto de la instalacion."
        } else {
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
        }
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

# --- 4. Node (para el skill de diagramas de arquitectura, archify) ----------
#
# Va DESPUES de Python/PlatformIO a proposito: de los tres pasos que instalan
# algo (OpenCode, Python, Node), este es el menos critico -ver el comentario
# junto a NODE_VERSION mas arriba-, asi que si algo mas temprano en el script
# se lleva puesto el tiempo del docente, que sea esto lo ultimo en intentarse
# antes de la capa educativa.
Write-Host ""
$NodeExe = Buscar-Node
if ($NodeExe) {
    Write-Host "  [OK] Node ya esta instalado ($NodeExe)"
} else {
    Instalar-Node
    Refresh-Path
    $NodeExe = Buscar-Node
}
if (-not $NodeExe) {
    Write-Host ""
    Write-Host "  [!] Node no quedo instalado." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "      Esto NO afecta a OpenCode, a PlatformIO ni a los demas skills:"
    Write-Host "      Tecnia Bot arranca igual y sirve para explicar, dibujar circuitos,"
    Write-Host "      compilar y repartir fichas. Lo unico que se pierde es UN skill de"
    Write-Host "      veinte: si le pedis al bot un diagrama de la arquitectura de un"
    Write-Host "      proyecto de codigo, va a avisar que le falta Node en vez de"
    Write-Host "      dibujarlo."
    Write-Host ""
    # ORDEN, Y NO ES PROLIJIDAD. Este aviso decia "adentro del bot, /diagnostico te
    # dice como esta" cuando install\diagnostico.ps1 NO chequeaba Node: cero
    # menciones, contra 69 de python y platformio. Mandar a la docente a correr algo
    # que no le va a contestar es PEOR que no decirle nada -- pierde el tiempo y queda
    # pensando que hizo algo mal.
    #
    # Se corrigio apuntando solo a "Reparar Tecnia Bot", y recien DESPUES de agregar
    # la seccion de Node a diagnostico.ps1 se volvio a mencionar /diagnostico aca.
    # Si alguna vez esa seccion se saca de diagnostico.ps1, esta linea vuelve atras
    # EN EL MISMO CAMBIO.
    #
    # Las dos salidas, en el orden en que sirven: primero saber que pasa, despues
    # intentar arreglarlo.
    Write-Host "      Para ver que pasa:   /diagnostico dentro del bot (tiene una seccion de Node)."
    Write-Host "      Para reintentar:     'Reparar Tecnia Bot' en el menu inicio."
    Write-Host ""
} else {
    Write-Host "  [OK] Node instalado en $NodeExe (para el skill de diagramas de arquitectura)."
}

# --- 5. Tecnia Bot (capa educativa) ------------------------------------------
Write-Host ""
Write-Host "  [..] Instalando la capa de Tecnia Bot..."
# powershell.exe POR RUTA, no por nombre. "powershell" a secas depende del PATH del
# docente, y ya paso que no estuviera (CHANGELOG 0.3.75: el reparar del tool no
# podia ni lanzarlo). $PSHOME es la carpeta del PowerShell que esta corriendo ESTE
# script, asi que existe siempre; si es pwsh 7 (que no trae powershell.exe ahi) se
# cae al nombre, como antes.
$PsExe = Join-Path $PSHOME "powershell.exe"
if (-not (Test-Path $PsExe)) { $PsExe = "powershell" }
# EL LOG SE PASA DE MANO ("transcript encadenado"), y no por un pipe.
#
# Start-Transcript no graba lo que un proceso hijo escribe directo a la consola: en
# una notebook real el log saltaba de "Instalando la capa" a "LISTO!" sin nada en
# el medio, y ahi adentro estan los timeouts del modelo y la descarga de las
# herramientas de las placas. El primer arreglo fue "| Out-Host", y tenia dos
# problemas: `pio pkg install` (que lanza install.ps1) veia un pipe en
# vez de una consola y escondia la barra de progreso -la docente veia todo quieto
# durante una descarga de mas de 1 GB-, y stderr y los errores terminantes de
# install.ps1 igual no quedaban en el log.
#
# Ahora: se cierra el transcript de aca, install.ps1 abre el SUYO sobre el mismo
# archivo (-Append, porque recibe la ruta en TECNIA_LOG_INSTALACION) y lo cierra al
# terminar, aunque se corte; despues se reabre aca, tambien con -Append. El hijo
# corre con la consola de verdad, sin pipe. Lo que pio escribe directo a la
# consola (la barra) sigue sin quedar en el log, igual que antes con cualquier
# programa: lo que queda son los [OK]/[AVISO] de install.ps1, con el codigo de pio.
#
# Si el transcript de aca no arranco, no se le pasa nada al hijo: sin la variable,
# install.ps1 no graba (que es tambien como lo corre update.ps1).
if ($HayTranscript) {
    $env:TECNIA_LOG_INSTALACION = $LogInstalacion
    try { Stop-Transcript | Out-Null } catch { }
}
& $PsExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoDir "install\install.ps1")
# Se guarda YA: es el codigo de install.ps1 y lo que sigue no lo tiene que pisar.
$CodigoInstall = $LASTEXITCODE
if ($HayTranscript) {
    Remove-Item Env:TECNIA_LOG_INSTALACION -ErrorAction SilentlyContinue
    try { Start-Transcript -Path $LogInstalacion -Append | Out-Null } catch { }
}

# SE VERIFICA QUE LA CAPA HAYA QUEDADO, y por dos vias.
#
# Antes esta linea corria y el script seguia derecho a imprimir "LISTO!". Si
# install.ps1 moria a mitad -- un archivo bloqueado por el antivirus alcanza --
# el docente veia el cartel verde y despues un OpenCode pelado, sin logo, sin
# agente y sin fichas. Sin ninguna pista de que faltaba algo.
#
# Faltaba tambien -NoProfile, que el .iss si usa: un perfil de PowerShell
# corporativo roto reventaba este paso y nadie se enteraba.
# NO SE CORTA ACA: se anota y se sigue hasta el resumen. Antes cada una de estas
# dos fallas hacia su propio `exit 1` y el docente se quedaba sin saber como
# habia quedado el resto (OpenCode, PlatformIO, Node), que ya estaba decidido
# cien lineas mas arriba.
#
# EL 3 DE install.ps1 NO ES UNA FALLA. Su contrato es 0 = instalado, 3 =
# instalado CON AVISOS (la capa SI se copio, pero no pudo escribir la config o
# guardar la key, y lo listo en pantalla), 1 = se corto. Aca cualquier codigo
# distinto de 0 se informaba como "La capa de Tecnia Bot no se instalo", que con
# el 3 es FALSO: la capa esta. Se trata aparte, y con la misma exigencia que el
# 0: la capa cuenta como instalada solo si ADEMAS el agente esta en el disco.
# Un 3 nunca termina en "LISTO!": degrada el resultado.
$CapaOk = $true
$CapaConAvisos = $false
$cfgDir = if ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "opencode" } else { Join-Path $env:USERPROFILE ".config\opencode" }
if ($CodigoInstall -ne 0) {
    if ($CodigoInstall -eq $CodigoCapaConAvisos) {
        $CapaConAvisos = $true
    } else {
        $CapaOk = $false
        Write-Host ""
        Write-Host "  [X] La capa de Tecnia Bot no se instalo (codigo $CodigoInstall)." -ForegroundColor Red
        Write-Host "      Suele ser un archivo bloqueado: cerra OpenCode y proba de nuevo."
        Write-Host ""
    }
}
if ($CapaOk -and -not (Test-Path (Join-Path $cfgDir "agent\tecnia-bot.md"))) {
    $CapaOk = $false
    Write-Host ""
    Write-Host "  [X] La capa educativa no quedo publicada." -ForegroundColor Red
    Write-Host "      El instalador dijo que termino, pero el agente no esta en:"
    Write-Host "      $cfgDir"
    Write-Host ""
}

# ---- RESUMEN FINAL: UNA LINEA POR COMPONENTE, CON LO QUE SE COMPROBO ----------
#
# POR QUE EXISTE. Hasta aca solo la falla de OpenCode se repetia al final. Las de
# PlatformIO y Node quedaban arriba, tapadas por la salida de install.ps1, y el
# cierre era "LISTO!" con exit 0. En una maquina sin PlatformIO -que para este
# bot es la mitad de lo que hace- lo ultimo que se leia era que estaba todo bien.
# Y como el .exe mira el codigo de salida, el instalador mostraba su pantalla de
# "quedo instalado" encima de eso.
#
# CADA LINEA SALE DE UNA COMPROBACION, no de un "se intento":
#   OpenCode   -> se EJECUTA de nuevo, aca, al final (Test-OpenCode), SIEMPRE.
#                 La primera version de este resumen se lo salteaba si la falla
#                 ya estaba marcada mas arriba, e imprimia "NO ARRANCA" sin
#                 ejecutar nada: una frase sobre el estado final que salia de
#                 una marca vieja y no de una comprobacion. Lo marco la revision.
#                 Cuesta unos veinte segundos cuando de verdad no arranca; es el
#                 precio de que la ultima linea que lee el docente sea cierta.
#                 La version sale del manifiesto de Scoop.
#   PlatformIO -> $PioExe, que solo tiene valor si Buscar-Pio lo ejecuto y
#                 contesto "PlatformIO".
#   Node       -> $NodeExe, que solo tiene valor si Buscar-Node lo ejecuto y la
#                 version alcanza.
#   Capa       -> el codigo de install.ps1 Y el agente en el disco, aca arriba.
$OpenCodeArranca = [bool](Test-OpenCode)
if ($script:FalloOpenCode -and $OpenCodeArranca) {
    Write-Host "  [i] Mas arriba OpenCode no arrancaba y ahora si: vale lo de ahora, que es lo que se acaba de comprobar."
}
$OpenCodeActiva = Get-OpenCodeVersionInstalada
$OpenCodeEsLaFijada = ($OpenCodeActiva -eq $OpenCodeVersion)

$Degradado = @()
Write-Host ""
Write-Host "  Como quedo (lo que se comprobo, no lo que se intento):"
Write-Host "  ------------------------------------------------------"
if (-not $OpenCodeArranca) {
    Write-Host "  [X]  OpenCode     NO ARRANCA." -ForegroundColor Red
} elseif (-not $OpenCodeEsLaFijada) {
    $Degradado += "OpenCode quedo en la version $OpenCodeActiva, no en la $OpenCodeVersion con la que se probo"
    Write-Host "  [!]  OpenCode     arranca, pero es la version $OpenCodeActiva y se probo con la $OpenCodeVersion." -ForegroundColor Yellow
} else {
    Write-Host "  [OK] OpenCode     arranca, version $OpenCodeActiva."
}
if ($PioExe) {
    Write-Host "  [OK] PlatformIO   contesta en $PioExe"
} else {
    $Degradado += "falta PlatformIO: el bot no puede compilar ni cargar codigo a la placa"
    Write-Host "  [!]  PlatformIO   NO esta: el bot no puede compilar ni cargar codigo a la placa." -ForegroundColor Yellow
}
if ($NodeExe) {
    Write-Host "  [OK] Node         contesta en $NodeExe"
} else {
    $Degradado += "falta Node: no anda el skill de diagramas de arquitectura"
    Write-Host "  [!]  Node         NO esta: no anda el skill de diagramas de arquitectura." -ForegroundColor Yellow
}
if ($CapaOk -and $CapaConAvisos) {
    $Degradado += "la capa se instalo CON AVISOS: no se pudo escribir parte de la configuracion o guardar la key (el detalle esta mas arriba)"
    Write-Host "  [!]  Tecnia Bot   la capa educativa esta publicada en $cfgDir, pero CON AVISOS:" -ForegroundColor Yellow
    Write-Host "                    el instalador de la capa los listo mas arriba."
} elseif ($CapaOk) {
    Write-Host "  [OK] Tecnia Bot   la capa educativa esta publicada en $cfgDir"
} else {
    Write-Host "  [X]  Tecnia Bot   la capa educativa NO quedo publicada." -ForegroundColor Red
}
Write-Host ""

# --- FALLA: el bot no se puede usar. Codigo 1. -------------------------------
if (-not $OpenCodeArranca) {
    # EL AVISO VA AL FINAL, DONDE SE LEE. Si OpenCode fallo, la capa igual se
    # instala -- y eso importa: el dia que OpenCode se arregle, el bot ya esta ahi.
    # Cortar antes dejaba la maquina con dos problemas en vez de uno. Que la capa
    # quedo se dice SOLO si se comprobo ($CapaOk).
    if ($CapaOk) {
        Write-Host "  La capa de Tecnia Bot quedo instalada, pero OPENCODE NO ARRANCA." -ForegroundColor Yellow
    } else {
        Write-Host "  OPENCODE NO ARRANCA, y la capa de Tecnia Bot tampoco quedo publicada." -ForegroundColor Yellow
    }
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
if (-not $CapaOk) {
    Write-Host "  OpenCode arranca, pero SIN la capa de Tecnia Bot: abre un editor pelado," -ForegroundColor Yellow
    Write-Host "  sin el agente, sin las fichas y sin las herramientas."
    Write-Host ""
    Write-Host "  Para reintentar:  menu inicio -> Reparar Tecnia Bot" -ForegroundColor Yellow
    Write-Host ""
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
}

# --- DEGRADADO: el bot abre, pero le falta algo. Codigo $CodigoDegradado. ----
if ($Degradado.Count -gt 0) {
    Write-Host "  Tecnia Bot quedo instalado y abre, PERO INCOMPLETO:" -ForegroundColor Yellow
    foreach ($d in $Degradado) { Write-Host ("    - " + $d) }
    Write-Host ""
    Write-Host "  Para completar lo que falta:  menu inicio -> Reparar Tecnia Bot" -ForegroundColor Yellow
    Write-Host "  Para ver por que no quedo:    menu inicio -> Diagnostico de Tecnia Bot" -ForegroundColor Yellow
    Write-Host ""
    try { Stop-Transcript | Out-Null } catch { }
    exit $CodigoDegradado
}

# --- TODO COMPROBADO. Codigo 0. ----------------------------------------------
Write-Host "  LISTO! Abri una terminal en cualquier carpeta, escribi 'opencode',"
Write-Host "  apreta Tab y elegi 'tecnia-bot'."
Write-Host ""
try { Stop-Transcript | Out-Null } catch { }
exit 0
