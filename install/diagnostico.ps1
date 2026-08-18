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
$ErrorActionPreference = "Continue"
$U = $env:USERPROFILE

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

Titulo "Espacio y red"
$d = Get-PSDrive C
Dato "libre en C:" ([math]::Round($d.Free / 1GB, 1).ToString() + " GB")
Dato "cache de Scoop" $(if (Test-Path "$U\scoop\cache") { (@(Get-ChildItem "$U\scoop\cache" -Filter "opencode*" -EA SilentlyContinue) | ForEach-Object { $_.Name + " (" + [math]::Round($_.Length/1MB,1) + " MB)" }) -join " | " } else { "no hay" })

Titulo "Ultimo log del instalador"
$log = Get-ChildItem $env:TEMP -Filter "Setup Log*.txt" -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($log) {
  Dato "archivo" $log.FullName
  Get-Content $log.FullName | Select-String -Pattern "Process exit code|Exception|error" | Select-Object -Last 6 | ForEach-Object { Write-Host ("     " + $_.Line.Trim()) }
} else { Dato "archivo" "no se encontro" }

Write-Host ""
Write-Host "  Copia TODO esto y mandalo. Con esto alcanza para saber que paso." -ForegroundColor Yellow
Write-Host ""
