# ============================================================================
# Junta TODO lo que hace falta para saber por que Tecnia Bot no anda en esta
# maquina, y lo deja en la carpeta compartida para que se pueda leer del otro
# lado. Sin copiar, sin pegar, sin capturas de pantalla.
#
#   irm https://raw.githubusercontent.com/programadores-obreros/Agente-editor-inet/main/install/reportar.ps1 | iex
#
# POR QUE EXISTE. Se arreglaron seis versiones seguidas sin haber visto NUNCA el
# error de la maquina que falla: cada arreglo salio de reproducir en una VM o de
# leer el codigo. Eso es adivinar con buena punteria, y no alcanza.
#
# Pedir "corre esto y mandame lo que salga" tampoco alcanzo: en el medio de una
# instalacion que falla, copiar treinta lineas de una consola es una friccion que
# se paga en que el dato no llega. Este script la saca del medio.
# ============================================================================
$ErrorActionPreference = "Continue"

$destinos = @(
  "\\192.168.100.9\Compartido",
  "$env:USERPROFILE\Desktop",
  "$env:TEMP"
)
$dir = $destinos | Where-Object { Test-Path $_ } | Select-Object -First 1
$out = Join-Path $dir ("tecniabot-reporte-" + $env:COMPUTERNAME + ".txt")

Start-Transcript -Path $out -Force | Out-Null

Write-Output "===================== REPORTE DE TECNIA BOT ====================="
Write-Output ("fecha      : " + (Get-Date))
Write-Output ("maquina    : " + $env:COMPUTERNAME + "   usuario: " + $env:USERNAME)
Write-Output ("es admin   : " + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
Write-Output ("Windows    : " + (Get-CimInstance Win32_OperatingSystem).Caption + " " + [Environment]::OSVersion.Version)
Write-Output ("CPU        : " + (Get-CimInstance Win32_Processor).Name)
Write-Output ("disco libre: " + [math]::Round((Get-PSDrive C).Free / 1GB, 1) + " GB")

Write-Output ""
Write-Output "--- QUE VERSION HAY INSTALADA ---"
$v = "$env:LOCALAPPDATA\TecniaBot\VERSION"
Write-Output ("version    : " + $(if (Test-Path $v) { (Get-Content $v -Raw).Trim() } else { "no esta instalado" }))

Write-Output ""
Write-Output "--- LAS CUATRO PIEZAS ---"
Write-Output ("Scoop      : " + [bool](Get-Command scoop -EA SilentlyContinue))
Write-Output ("OpenCode   : " + (Test-Path "$env:USERPROFILE\scoop\shims\opencode.exe"))
Write-Output ("PlatformIO : " + (Test-Path "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe"))
Write-Output ("capa/agente: " + (Test-Path "$env:USERPROFILE\.config\opencode\agent\tecnia-bot.md"))
Write-Output ("skills     : " + @(Get-ChildItem "$env:USERPROFILE\.config\opencode\skills" -Directory -EA SilentlyContinue).Count)
Write-Output ("fichas     : " + @(Get-ChildItem "$env:USERPROFILE\.config\opencode\skills\fichas\hojas" -EA SilentlyContinue).Count)

Write-Output ""
Write-Output "--- OPENCODE: EXISTE ES UNA COSA, CORRE ES OTRA ---"
$app = "$env:USERPROFILE\scoop\apps\opencode"
Write-Output ("app dir      : " + (Test-Path $app))
Write-Output ("junction     : " + (Test-Path "$app\current"))
if (Test-Path $app) {
  Get-ChildItem $app -Directory -EA SilentlyContinue | ForEach-Object {
    Write-Output ("  version " + $_.Name + " -> manifest.json: " + (Test-Path "$($_.FullName)\manifest.json") +
                  "   opencode.exe: " + (Test-Path "$($_.FullName)\opencode.exe"))
  }
}
$exe = "$app\current\opencode.exe"
if (Test-Path $exe) { Write-Output ("binario      : " + [math]::Round((Get-Item $exe).Length / 1MB, 1) + " MB") }
Write-Output "salida de 'opencode --version':"
& opencode --version 2>&1 | ForEach-Object { Write-Output ("   " + $_) }
Write-Output ("exit code    : " + $LASTEXITCODE)

Write-Output ""
Write-Output "--- LAS CREDENCIALES (el bug del BOM) ---"
$auth = "$env:USERPROFILE\.local\share\opencode\auth.json"
Write-Output ("auth.json    : " + (Test-Path $auth))
if (Test-Path $auth) {
  $b = [System.IO.File]::ReadAllBytes($auth)
  $bom = ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
  Write-Output ("fecha        : " + (Get-Item $auth).LastWriteTime)
  Write-Output ("tiene BOM    : " + $(if ($bom) { "SI  <-- OpenCode NO lo puede leer" } else { "no" }))
  try { $null = [Text.Encoding]::UTF8.GetString($b) | ConvertFrom-Json; Write-Output "parsea       : si" }
  catch { Write-Output ("parsea       : NO -> " + $_.Exception.Message) }
}
$envKey = [Environment]::GetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", "User")
Write-Output ("variable key : " + $(if ($envKey) { "puesta" } else { "NO esta" }))

Write-Output ""
Write-Output "--- ANTIVIRUS ---"
try {
  Get-MpThreatDetection -EA Stop | Sort-Object InitialDetectionTime -Desc | Select-Object -First 6 |
    ForEach-Object { Write-Output ("  " + $_.InitialDetectionTime + "  " + ($_.Resources -join ",")) }
  $pref = Get-MpPreference -EA Stop
  Write-Output ("exclusiones  : " + $(if ($pref.ExclusionPath) { $pref.ExclusionPath -join " | " } else { "ninguna" }))
} catch { Write-Output "  no se pudo consultar Defender (puede haber otro antivirus)" }

Write-Output ""
Write-Output "--- POLITICA DE EJECUCION (una GPO de escuela bloquea todo) ---"
Get-ExecutionPolicy -List | ForEach-Object { Write-Output ("  " + $_.Scope.ToString().PadRight(16) + $_.ExecutionPolicy) }

Write-Output ""
Write-Output "--- ULTIMO LOG DEL INSTALADOR ---"
$log = Get-ChildItem $env:TEMP -Filter "Setup Log*.txt" -EA SilentlyContinue | Sort-Object LastWriteTime -Desc | Select-Object -First 1
if ($log) {
  Write-Output ("archivo: " + $log.Name + "   " + $log.LastWriteTime)
  Get-Content $log.FullName | Select-String -Pattern "Process exit code|Exception|error|bootstrap" |
    Select-Object -Last 12 | ForEach-Object { Write-Output ("  " + $_.Line.Trim()) }
} else { Write-Output "  no hay log de instalacion" }

Write-Output ""
Write-Output "===================== FIN ====================="
Stop-Transcript | Out-Null

Write-Host ""
Write-Host "  Reporte guardado en:" -ForegroundColor Green
Write-Host "  $out" -ForegroundColor Yellow
Write-Host ""
