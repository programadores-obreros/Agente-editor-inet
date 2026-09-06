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
param(
  # OPCIONAL: una carpeta compartida (p. ej. \\servidor\Compartido) donde dejar el
  # reporte si esta al alcance. Antes iba FIJA la IP de una escuela, primera en la
  # lista: en cualquier otra red, Test-Path contra una UNC inalcanzable se cuelga
  # decenas de segundos antes de imprimir una sola linea -- justo en el script que
  # se corre cuando algo ya no anda. Y el reporte trae datos de la maquina: a una
  # carpeta ajena va solo si alguien lo pide.
  #   powershell -ExecutionPolicy Bypass -File install\diagnostico.ps1 -Compartido \\servidor\Compartido
  [string]$Compartido = ""
)
$ErrorActionPreference = "Continue"
$U = $env:USERPROFILE

# Config de OpenCode: honra XDG_CONFIG_HOME, igual que install.ps1 y bootstrap.ps1.
# Si aca se mirara siempre %USERPROFILE%\.config, en una maquina con esa variable
# puesta el diagnostico diria "capa: FALTA" con la capa instalada, y el docente
# volveria a correr el instalador en loop.
$ocDir = "$U\.config\opencode"
if ($env:XDG_CONFIG_HOME) { $ocDir = "$env:XDG_CONFIG_HOME\opencode" }

# Donde dejar el reporte. El primero que exista gana: el Escritorio, donde el
# docente lo encuentra; si no (perfil movido a OneDrive, escritorio redirigido),
# al lado del programa; si no, TEMP. La carpeta compartida solo si se pidio.
$destinos = @(
  "$env:USERPROFILE\Desktop",
  "$env:LOCALAPPDATA\TecniaBot",
  "$env:TEMP"
)
if ($Compartido) { $destinos = @($Compartido) + $destinos }
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
# El shim de Scoop pesa unos 20 KB. Si pesa MEGAS es el programa entero copiado a
# mano ahi (lo hacia una version vieja del instalador): Scoop no lo administra, no
# lo actualiza ni lo borra al desinstalar, y sigue corriendo la version vieja.
Dato "shim de OpenCode" $(if (-not (Test-Path $shim)) { "FALTA" } elseif ((Get-Item $shim).Length -gt 1MB) { "binario copiado a mano (" + [math]::Round((Get-Item $shim).Length / 1MB, 1) + " MB), no administrado por Scoop" } else { "OK" })
Dato "PlatformIO" $(if (Test-Path "$U\.platformio\penv\Scripts\pio.exe") { "OK" } else { "FALTA" })
Dato "capa Tecnia Bot" $(if (Test-Path "$ocDir\agent\tecnia-bot.md") { "OK" } else { "FALTA" })

Titulo "OpenCode: la version que HAY vs la que se PROBO"
# El instalador fija la version de OpenCode (install\OPENCODE_VERSION, un solo
# archivo para Windows y Linux) y la deja fijada con `scoop hold`. Aca se mira si
# esta maquina cumple las dos cosas, porque "OpenCode anda pero el bot hace algo
# raro" casi siempre es una version que no es la probada.
#
# Lo que Scoop tiene ACTIVO se lee de scoop\apps\opencode\current\manifest.json.
# El hold se lee de current\install.json, clave "hold": true -- es lo que escribe
# `scoop hold` (libexec/scoop-hold.ps1). `scoop hold` sin argumentos NO lista
# nada, imprime el uso: no sirve para detectarlo.
$pinArchivo = Join-Path $PSScriptRoot "OPENCODE_VERSION"
$pin = if (Test-Path $pinArchivo) { (Get-Content $pinArchivo -Raw).Trim() } else { "" }
Dato "fijada (OPENCODE_VERSION)" $(if ($pin) { $pin } else { "NO ESTA el archivo install\OPENCODE_VERSION" })
$ocActual = "$U\scoop\apps\opencode\current"
$ocInstalada = ""
try { if (Test-Path "$ocActual\manifest.json") { $ocInstalada = ("" + (Get-Content "$ocActual\manifest.json" -Raw | ConvertFrom-Json).version).Trim() } } catch { }
Dato "instalada (Scoop)" $(if ($ocInstalada) { $ocInstalada } else { "no se pudo leer current\manifest.json" })
if ($pin -and $ocInstalada -and $pin -ne $ocInstalada) {
  Write-Host "     >> NO COINCIDEN: el bot se probo con la $pin. Reparar Tecnia Bot la activa si esta en el disco;" -ForegroundColor Yellow
  Write-Host "        si no, en PowerShell: scoop install opencode@$pin" -ForegroundColor Yellow
}
$ocHold = $false
try { if (Test-Path "$ocActual\install.json") { $ocHold = [bool]((Get-Content "$ocActual\install.json" -Raw | ConvertFrom-Json).hold) } } catch { }
Dato "scoop hold" $(if ($ocHold) { "OK (no se actualiza sola)" } elseif (Test-Path "$ocActual\install.json") { "NO: 'scoop update' la puede cambiar. Reparar Tecnia Bot lo pone." } else { "no se pudo leer current\install.json" })
$ocDirs = @(Get-ChildItem "$U\scoop\apps\opencode" -Directory -EA SilentlyContinue | Where-Object { $_.Name -ne "current" } | ForEach-Object { $_.Name })
Dato "versiones en disco" $(if ($ocDirs.Count) { $ocDirs -join ", " } else { "ninguna" })

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

Titulo "El modelo -- Gemini con key de Google, Big Pickle sin"
# La key de Google es OPCIONAL. Sin key, el instalador deja al agente en
# opencode/big-pickle (el modelo gratuito de OpenCode, sin cuenta); con key, en
# Gemini. Lo decide en cada corrida y lo escribe como override del agente en
# opencode.json ("agent" -> "tecnia-bot" -> "model"). Aca se informa que quedo
# escrito y si es coherente con la key que hay: son las dos cosas que explican un
# "configured model ... is not valid" o un "Invalid API key" con todo instalado.
#
# De auth.json se informa SOLO si hay una entrada "google" con key, nunca su valor.
$ocCfg = @("$ocDir\opencode.json", "$ocDir\opencode.jsonc") | Where-Object { Test-Path $_ } | Select-Object -First 1
$modelo = $null
$cfgParsea = $false
if ($ocCfg) {
  Dato "config de OpenCode" $ocCfg
  # Sin sacar comentarios: si es un .jsonc comentado no va a parsear y se informa
  # eso, que ya es un dato (el instalador si los tolera).
  try {
    $cfg = Get-Content $ocCfg -Raw -EA Stop | ConvertFrom-Json -EA Stop
    $cfgParsea = $true
    if ($cfg.agent -and $cfg.agent.'tecnia-bot' -and $cfg.agent.'tecnia-bot'.model) { $modelo = [string]$cfg.agent.'tecnia-bot'.model }
  } catch { }
  if (-not $cfgParsea) { Dato "modelo de tecnia-bot" "no se pudo leer la config (no parsea como JSON)" }
  elseif ($modelo) { Dato "modelo de tecnia-bot" $modelo }
  else { Dato "modelo de tecnia-bot" "sin override en la config: usa el del archivo del agente (Gemini)" }
} else {
  Dato "config de OpenCode" "NO ESTA (ni opencode.json ni opencode.jsonc)"
}
# La key compartida que traian las versiones hasta la 0.3.75 se roto: una
# instalacion vieja la tiene guardada y MUERTA. Se la reconoce por su SHA-256
# (el literal no esta en ningun lado); de la key nunca se imprime nada.
$HashKeyVieja = "121163b85b0396edcfcc4840981d823c4f1e9c23aadc72b39c9723fef70cf3b4"
function Test-KeyVieja($k) {
  if (-not $k) { return $false }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $h = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$k)) } finally { $sha.Dispose() }
  return ((($h | ForEach-Object { $_.ToString("x2") }) -join "") -eq $HashKeyVieja)
}
$hayKey = $false
$keyVieja = $false
if (Test-Path $auth) {
  try {
    $authObj = [Text.Encoding]::UTF8.GetString($b) | ConvertFrom-Json
    $hayKey = [bool](($authObj.PSObject.Properties.Name -contains "google") -and $authObj.google.key)
    if ($hayKey) { $keyVieja = Test-KeyVieja $authObj.google.key }
  } catch { }
}
if (Test-KeyVieja $envKey) { $keyVieja = $true }
Dato "key de Google guardada" $(if ($hayKey) { "si" } else { "no" })
if ($keyVieja) {
  Write-Host "     >> Es la key de respaldo vieja (auth.json o la variable), ya invalida: corre 'Reparar Tecnia Bot' (menu inicio) para quitarla" -ForegroundColor Red
}
if ($hayKey -and $modelo -eq "opencode/big-pickle") {
  Write-Host "     >> Hay key de Google pero el agente sigue en Big Pickle: corre 'Reparar Tecnia Bot' (menu inicio) y pasa a Gemini" -ForegroundColor Yellow
}
if (-not $hayKey -and ($modelo -like "google/*" -or ($cfgParsea -and -not $modelo))) {
  Write-Host "     >> El agente apunta a Gemini y NO hay key de Google: falla al primer mensaje. Corre 'Reparar Tecnia Bot' (menu inicio)" -ForegroundColor Red
}
Write-Host "     Para cambiar: pega una key de Google (en Reparar, o con /connect y despues Reparar) y usa Gemini;"
Write-Host "     sin key usa Big Pickle (gratis por tiempo limitado; OpenCode puede usar el chat para mejorar el modelo)."

Titulo "Politica de ejecucion -- una GPO de escuela bloquea todo sin avisar"
Get-ExecutionPolicy -List | ForEach-Object { Dato $_.Scope.ToString() $_.ExecutionPolicy }

Titulo "Espacio y red"
$d = Get-PSDrive C
Dato "libre en C:" ([math]::Round($d.Free / 1GB, 1).ToString() + " GB")
Dato "cache de Scoop" $(if (Test-Path "$U\scoop\cache") { (@(Get-ChildItem "$U\scoop\cache" -Filter "opencode*" -EA SilentlyContinue) | ForEach-Object { $_.Name + " (" + [math]::Round($_.Length/1MB,1) + " MB)" }) -join " | " } else { "no hay" })

Titulo "El log de OpenCode -- por que fallo un mensaje"
# ESTE BLOQUE FALTABA, y se noto cuando hizo falta.
#
# El bot contesto "Failed to send prompt -- Unexpected server error. Check server
# logs for details" y no habia forma de ver esos logs: el diagnostico juntaba el
# log del INSTALADOR y el del .exe de Inno, pero nunca el de OpenCode, que es el
# unico que sabe por que fallo un mensaje YA con todo instalado.
#
# Se probo cambiar la API key y dio lo mismo, o sea que no era la key. Sin este
# bloque, el paso siguiente era adivinar.
$oclog = "$U\.local\share\opencode\log\opencode.log"
if ($env:XDG_DATA_HOME) { $oclog = "$env:XDG_DATA_HOME\opencode\log\opencode.log" }
if (Test-Path $oclog) {
  $f = Get-Item $oclog
  Dato "archivo" $f.FullName
  Dato "tamano" ([math]::Round($f.Length / 1KB, 0).ToString() + " KB   ultimo: " + $f.LastWriteTime)
  Write-Host "     --- ultimos errores ---"
  # Solo ERROR y WARN: el log entero son cientos de miles de lineas de trafico
  # normal, y en un reporte que alguien manda por mail eso no lo lee nadie.
  $malas = Get-Content $oclog -EA SilentlyContinue |
    Where-Object { $_ -match "level=(ERROR|WARN)" } |
    Select-Object -Last 12
  if ($malas) {
    # Las lineas traen la sesion y el modelo, no credenciales. Aun asi se corta a
    # 300 caracteres: un stack largo tapa el resto del reporte.
    $malas | ForEach-Object {
      $l = $_.Trim()
      if ($l.Length -gt 300) { $l = $l.Substring(0, 300) + " ..." }
      Write-Host ("     " + $l)
    }
  } else {
    Write-Host "     (ningun ERROR ni WARN registrado)"
  }
} else {
  Dato "archivo" "no existe -- OpenCode todavia no escribio ningun log"
}

Titulo "El log del bootstrap -- ACA esta en que paso murio"
# instalacion.log es SIEMPRE la ultima corrida. Las anteriores quedan al lado como
# instalacion-<fecha>.log: el bootstrap las rota y guarda hasta 5. Antes cada
# "Reparar" pisaba el unico log, y se perdia justo la corrida que habia fallado.
$bl = "$env:LOCALAPPDATA\TecniaBot\instalacion.log"
$blViejos = @(Get-ChildItem "$env:LOCALAPPDATA\TecniaBot" -Filter "instalacion-*.log" -EA SilentlyContinue)
if (Test-Path $bl) {
  Dato "archivo" $bl
  Dato "corridas anteriores" $(if ($blViejos.Count) { "" + $blViejos.Count + " (instalacion-<fecha>.log, en la misma carpeta)" } else { "ninguna" })
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
