# ============================================================================
# Compila el instalador .exe de Tecnia Bot EN ESTA Windows, de cero.
# Pensado para probar en una VM sin tener nada preinstalado.
#
# Uso (desde la raíz del repo ya clonado):
#   powershell -ExecutionPolicy Bypass -File installer\compilar-en-windows.ps1
#
# Qué hace:
#   1. Instala Inno Setup 6 (si falta) con winget.
#   2. Compila installer\tecnia-bot.iss.
#   3. Te deja el .exe en installer\dist\Instalar-Tecnia-Bot.exe
#
# (No hace falta esto para USAR Tecnia Bot: el .exe ya lo compila el CI y se
#  baja desde Releases. Este script es solo para compilar a mano en Windows.)
# ============================================================================
$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "  Compilar instalador de Tecnia Bot (Windows)"
Write-Host "  -------------------------------------------"
Write-Host ""

# --- 1. Inno Setup ----------------------------------------------------------
$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (Test-Path $iscc) {
    Write-Host "  [OK] Inno Setup ya esta instalado."
} else {
    Write-Host "  [..] Instalando Inno Setup 6 con winget..."
    winget install --id JRSoftware.InnoSetup --accept-source-agreements --accept-package-agreements -e
    if (-not (Test-Path $iscc)) {
        throw "No se encontro ISCC.exe tras instalar. Instala Inno Setup 6 a mano desde https://jrsoftware.org/isdl.php"
    }
    Write-Host "  [OK] Inno Setup instalado."
}

# --- 2. Version -------------------------------------------------------------
$VerFile = Join-Path $RepoDir "VERSION"
$Version = if (Test-Path $VerFile) { (Get-Content $VerFile -Raw).Trim() } else { "0.0.0" }

# --- 3. Compilar ------------------------------------------------------------
Write-Host "  [..] Compilando version $Version..."
& $iscc "/DMyAppVersion=$Version" (Join-Path $RepoDir "installer\tecnia-bot.iss")

$Exe = Join-Path $RepoDir "installer\dist\Instalar-Tecnia-Bot.exe"
Write-Host ""
if (Test-Path $Exe) {
    Write-Host "  LISTO! Instalador en: $Exe"
    Write-Host "  Doble clic para probarlo (Next-Next-Finish)."
} else {
    throw "La compilacion no genero el .exe. Revisa los mensajes de arriba."
}
Write-Host ""
