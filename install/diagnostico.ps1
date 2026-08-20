# ============================================================================
# Diagnostico de Tecnia Bot para Windows.
#
# PARA QUE ESTA ESTO. Cuando la instalacion falla en una maquina real, lo que
# llega es una captura de pantalla de la ventana negra. Con eso se puede
# adivinar, y adivinar sale caro: en una sesion de soporte se probaron cuatro
# hipotesis equivocadas antes de mirar los datos.
#
# Esto junta, de una sola pasada, todo lo que hace falta para saber que paso.
# Se puede correr aunque OpenCode no arranque -- que es justo cuando hace falta.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File install\diagnostico.ps1
# ============================================================================
# ----------------------------------------------------------------------------
# ESTE ARCHIVO ABSORBIO A reportar.ps1, QUE ERA CODIGO MUERTO.
#
# Habia dos scripts de soporte haciendo casi lo mismo, y uno solo tenia boton:
# el acceso directo del menu inicio apunta ACA. reportar.ps1 se copiaba a la
# maquina y no lo invocaba nadie -- para correrlo habia que abrir PowerShell y
# tipear la ruta, que es exactamente lo que un docente con un problema no hace.
#
# De reportar.ps1 se trajo lo que faltaba y valia:
#   - el bloque de credenciales (auth.json, el bug del BOM)
#   - la politica de ejecucion (una GPO de escuela bloquea todo y no avisa)
#   - dejar el reporte EN UN ARCHIVO, que era su mejor idea: pedir "corre esto y
#     mandame lo que salga" no alcanzo nunca. En el medio de una instalacion que
#     falla, copiar treinta lineas de una consola es una friccion que se paga en
#     que el dato no llega.
#
# Ahora sale por pantalla Y queda en un archivo. El docente lee, y manda uno solo.
# ----------------------------------------------------------------------------
$ErrorActionPreference = "Continue"
$U = $env:USERPROFILE

# Donde dejar el reporte. El primero que exista gana.
#
# La carpeta compartida va primera a proposito: si esta, el reporte se puede leer
# del otro lado sin pedirle nada a nadie. Si no esta -que es el caso de cualquier
# maquina fuera de la escuela- cae al Escritorio, donde el docente lo encuentra.
$destinos = @(
  "\\192.168.100.9\Compartido",
  "$env:USERPROFILE\Desktop",
  "$env:TEMP"
)
$dir = $destinos | Where-Object { Test-Path $_ } | Select-Object -First 1
$Reporte = Join-Path $dir ("tecniabot-diagnostico-" + $env:COMPUTERNAME + ".txt")

# Start-Transcript captura Write-Host desde PowerShell 5.0, asi que el archivo
# sale igual que la pantalla. Si falla -carpeta de solo lectura, disco lleno- se
# sigue igual: el diagnostico en pantalla es lo que no se puede perder.
$GuardaOK = $false
try { Start-Transcript -Path $Reporte -Force | Out-Null; $GuardaOK = $true } catch { }

function Titulo($t) { Write-Host ""; Write-Host "  == $t ==" -ForegroundColor Cyan }
function Dato($k, $v) { Write-Host ("     {0,-22} {1}" -f $k, $v) }

Write-Host ""
Write-Host "  DIAGNOSTICO DE TECNIA BOT" -ForegroundColor White
Write-Host "  -------------------------"
$ver = "?"
if (Test-Path "$env:LOCALAPPDATA\TecniaBot\VERSION") { $ver = (Get-Content "$env:LOCALAPPDATA\TecniaBot\VERSION" -Raw).Trim() }
Dato "Version instalada" $ver
Dato "Windows" ((Get-CimInstance Win32_OperatingSystem).Caption + " (" + [Environment]::OSVersion.Version + ")")
Dato "Usuario es admin" (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))

Titulo "Lo que tiene que estar"
Dato "Scoop" $(if (Get-Command scoop -EA SilentlyContinue) { "OK" } else { "FALTA" })
$shim = "$U\scoop\shims\opencode.exe"
Dato "shim de OpenCode" $(if (Test-Path $shim) { "OK" } else { "FALTA" })
Dato "PlatformIO" $(if (Test-Path "$U\.platformio\penv\Scripts\pio.exe") { "OK" } else { "FALTA" })
Dato "capa Tecnia Bot" $(if (Test-Path "$U\.config\opencode\agent\tecnia-bot.md") { "OK" } else { "FALTA" })

Titulo "OpenCode: existe es una cosa, CORRE es otra"
if (Get-Command opencode -EA SilentlyContinue) {
  $salida = & opencode --version 2>&1
  Dato "opencode --version" ("exit " + $LASTEXITCODE + "  ->  " + ($salida -join " "))
} else {
  Dato "opencode --version" "el comando no esta en el PATH"
}
$app = "$U\scoop\apps\opencode\current\opencode.exe"
if (Test-Path $app) {
  $f = Get-Item $app
  Dato "binario en disco" ([math]::Round($f.Length / 1MB, 1).ToString() + " MB")
  # Un binario de pocos KB es un binario mutilado: casi siempre antivirus.
  if ($f.Length -lt 10MB) { Write-Host "     >> El binario esta MUTILADO (deberia pesar decenas de MB)" -ForegroundColor Red }
} else {
  Dato "binario en disco" "NO ESTA"
}

Titulo "Que dice Scoop de si mismo"
$s = scoop list 2>&1 | Out-String
Dato "apps instaladas" (($s -split "`n" | Where-Object { $_ -match "opencode|python" } | ForEach-Object { $_.Trim() }) -join " | ")

Titulo "Antivirus: la causa mas comun de 'isn't installed correctly'"
# OpenCode es un binario sin firmar. Defender lo pone en cuarentena bastante
# seguido, y Scoop reporta "isn't installed correctly" sin decir por que.
try {
  $amenazas = Get-MpThreatDetection -EA Stop | Sort-Object InitialDetectionTime -Descending | Select-Object -First 5
  if ($amenazas) {
    foreach ($a in $amenazas) { Dato "deteccion" ($a.InitialDetectionTime.ToString("dd/MM HH:mm") + "  " + ($a.Resources -join ",")) }
  } else { Dato "detecciones" "ninguna" }
  $pref = Get-MpPreference -EA Stop
  Dato "exclusiones de ruta" $(if ($pref.ExclusionPath) { $pref.ExclusionPath -join " | " } else { "ninguna" })
} catch {
  Dato "Defender" "no se pudo consultar (puede haber otro antivirus)"
}

Titulo "PlatformIO: en cual de los cuatro pasos se corto"
# UNA SOLA MAQUINA DE VEINTE se quedo sin PlatformIO en la capacitacion del
# 20/08. Antes esto decia "FALTA" y se terminaba ahi, que no alcanza para nada:
# instalarlo es una CADENA y hay que saber que eslabon se rompio.
#
#   1. scoop install python          <- si falla, falla todo lo demas
#   2. bajar get-platformio.py       <- una red de escuela con proxy lo bloquea
#   3. correr ese script (arma un venv en ~/.platformio)
#   4. el script hace pip install platformio, contra pypi.org
#
# El paso 4 es el sospechoso numero uno en una escuela: pypi.org sale por
# HTTPS a un dominio que ningun filtro de contenido conoce, y cuando lo bloquea
# no dice "bloqueado", dice "timeout". Se distingue mirando si quedo la carpeta
# a medias: si hay `.platformio\penv` pero no hay `pio.exe`, el venv se armo y
# lo que fallo fue bajar el paquete. O sea, red, no permisos.
$P = "$U\.platformio"
Dato "1. python (scoop)" $(if (Test-Path "$U\scoop\shims\python.exe") { "OK" } elseif (Get-Command python -EA SilentlyContinue) { "OK (otro python)" } else { "FALTA <- se corto aca" })
Dato "2. carpeta .platformio" $(if (Test-Path $P) { "existe" } else { "NO existe" })
Dato "3. entorno (penv)" $(if (Test-Path "$P\penv") { "armado" } else { "NO se armo" })
Dato "4. pio.exe" $(if (Test-Path "$P\penv\Scripts\pio.exe") { "OK" } else { "FALTA" })
if ((Test-Path "$P\penv") -and -not (Test-Path "$P\penv\Scripts\pio.exe")) {
  Write-Host "     >> El entorno se armo pero el paquete no bajo: mira la RED, no los permisos" -ForegroundColor Yellow
}
# Que la maquina llegue a pypi.org. Es la pregunta que decide todo lo demas, y
# se contesta en dos segundos.
try {
  $r = Invoke-WebRequest -Uri "https://pypi.org/simple/platformio/" -UseBasicParsing -TimeoutSec 8 -Method Head
  Dato "llega a pypi.org" ("SI (HTTP " + $r.StatusCode + ")")
} catch {
  # El TIPO de excepcion, no el mensaje. Un error de red trae adentro la URL del
  # proxy, y en una escuela el proxy se configura como
  # http://usuario:clave@proxy:8080 -- o sea que el mensaje puede llevarse una
  # credencial de red en un archivo que despues se manda por WhatsApp.
  #
  # Este archivo lo agarro el propio test que prohibe Exception.Message. Estaba
  # puesto por auth.json y sirvio para otra cosa: es una regla que vale para TODO
  # lo que se imprima aca, no para un archivo en particular.
  $codigo = ""
  try { if ($_.Exception.Response) { $codigo = " (HTTP " + [int]$_.Exception.Response.StatusCode + ")" } } catch { }
  Dato "llega a pypi.org" ("NO - " + $_.Exception.GetType().Name + $codigo)
  Write-Host "     >> Sin pypi.org no hay PlatformIO. Es la red de la escuela, no la maquina." -ForegroundColor Red
}
$proxy = [Environment]::GetEnvironmentVariable("HTTPS_PROXY", "User")
if (-not $proxy) { $proxy = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -EA SilentlyContinue).ProxyServer }
# Se tapa el usuario:clave si el proxy lo trae embebido. Saber que HAY proxy y
# a que host apunta es lo que sirve para diagnosticar; la credencial no agrega
# nada y no puede viajar.
if ($proxy) { $proxy = [regex]::Replace($proxy, "//[^/@]+@", "//USUARIO:CLAVE@") }
Dato "proxy configurado" $(if ($proxy) { $proxy } else { "ninguno" })
# El log de PlatformIO, que dice la causa con todas las letras.
$plog = Get-ChildItem "$P" -Filter "*.log" -EA SilentlyContinue | Sort-Object LastWriteTime -Desc | Select-Object -First 1
if ($plog) {
  Dato "log de PlatformIO" $plog.FullName
  Get-Content $plog.FullName -EA SilentlyContinue | Select-Object -Last 8 | ForEach-Object { Write-Host ("     " + $_.Trim()) }
}

Titulo "Las credenciales -- el bug del BOM"
# ACA NO SE IMPRIME NADA DEL CONTENIDO DE auth.json. Nunca.
#
# Este reporte se manda por mail o por WhatsApp, y auth.json tiene la clave de la
# API adentro. Lo que se informa son hechos SOBRE el archivo -esta, tiene BOM,
# parsea- que es todo lo que hace falta para diagnosticar.
$auth = "$U\.local\share\opencode\auth.json"
Dato "auth.json" $(if (Test-Path $auth) { "OK" } else { "NO ESTA" })
if (Test-Path $auth) {
  $b = [System.IO.File]::ReadAllBytes($auth)
  $bom = ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
  Dato "fecha" (Get-Item $auth).LastWriteTime
  Dato "tiene BOM" $(if ($bom) { "SI" } else { "no" })
  if ($bom) { Write-Host "     >> El BOM deja la maquina muerta: OpenCode NO puede leer este archivo" -ForegroundColor Red }
  # Del error se informa el TIPO, no el mensaje: el mensaje de ConvertFrom-Json
  # suele citar el fragmento de JSON que no pudo leer, y ese fragmento sale del
  # archivo que tiene la clave. Justo en el caso de falla, que es el unico en el
  # que alguien manda esto.
  try { $null = [Text.Encoding]::UTF8.GetString($b) | ConvertFrom-Json; Dato "parsea" "si" }
  catch { Dato "parsea" ("NO (" + $_.Exception.GetType().Name + ")") }
}
$envKey = [Environment]::GetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", "User")
Dato "variable con la key" $(if ($envKey) { "puesta" } else { "NO esta" })

Titulo "Politica de ejecucion -- una GPO de escuela bloquea todo sin avisar"
Get-ExecutionPolicy -List | ForEach-Object { Dato $_.Scope.ToString() $_.ExecutionPolicy }

Titulo "Espacio y red"
$d = Get-PSDrive C
Dato "libre en C:" ([math]::Round($d.Free / 1GB, 1).ToString() + " GB")
Dato "cache de Scoop" $(if (Test-Path "$U\scoop\cache") { (@(Get-ChildItem "$U\scoop\cache" -Filter "opencode*" -EA SilentlyContinue) | ForEach-Object { $_.Name + " (" + [math]::Round($_.Length/1MB,1) + " MB)" }) -join " | " } else { "no hay" })

Titulo "El log del bootstrap -- ACA esta en que paso murio"
$bl = "$env:LOCALAPPDATA\TecniaBot\instalacion.log"
if (Test-Path $bl) {
  Dato "archivo" $bl
  Write-Host "     --- ultimas lineas ---"
  Get-Content $bl | Where-Object { $_ -match '\[OK\]|\[X\]|\[!\]|\[\.\.\]|ERROR|WARN|Exception' } |
    Select-Object -Last 14 | ForEach-Object { Write-Host ("     " + $_.Trim()) }
} else {
  Dato "archivo" "no existe -- el bootstrap no llego ni a arrancar"
}

Titulo "Ultimo log del instalador (Inno)"
$log = Get-ChildItem $env:TEMP -Filter "Setup Log*.txt" -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($log) {
  Dato "archivo" $log.FullName
  Get-Content $log.FullName | Select-String -Pattern "Process exit code|Exception|error" | Select-Object -Last 6 | ForEach-Object { Write-Host ("     " + $_.Line.Trim()) }
} else { Dato "archivo" "no se encontro" }

Write-Host ""
if ($GuardaOK) {
  try { Stop-Transcript | Out-Null } catch { }
  Write-Host "  Listo. El reporte quedo en:" -ForegroundColor Yellow
  Write-Host ("    " + $Reporte) -ForegroundColor White
  Write-Host "  Mandanos ESE archivo. No hace falta copiar nada de esta pantalla."
} else {
  Write-Host "  No se pudo guardar el reporte en un archivo." -ForegroundColor Yellow
  Write-Host "  Copia TODO esto y mandalo. Con esto alcanza para saber que paso."
}
Write-Host ""
