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

# --- 1. Scoop ---------------------------------------------------------------
Refresh-Path
if (Get-Command scoop -ErrorAction SilentlyContinue) {
    Write-Host "  [OK] Scoop ya esta instalado"
} else {
    Write-Host "  [..] Instalando Scoop (gestor sin admin)..."
    Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
    Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
    Refresh-Path
    Write-Host "  [OK] Scoop instalado."
}

# --- 2. OpenCode ------------------------------------------------------------
if (Get-Command opencode -ErrorAction SilentlyContinue) {
    Write-Host "  [OK] OpenCode ya esta instalado"
} else {
    Write-Host "  [..] Instalando OpenCode..."
    scoop install opencode
    Refresh-Path
    Write-Host "  [OK] OpenCode instalado."
}

# --- 3. Python + PlatformIO -------------------------------------------------
$PioExe = Join-Path $env:USERPROFILE ".platformio\penv\Scripts\pio.exe"
if ((Get-Command pio -ErrorAction SilentlyContinue) -or (Test-Path $PioExe)) {
    Write-Host "  [OK] PlatformIO ya esta instalado"
} else {
    Write-Host "  [..] Instalando PlatformIO Core (no necesita admin)..."
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        scoop install python
        Refresh-Path
    }
    $Tmp = Join-Path $env:TEMP "get-platformio.py"
    Invoke-RestMethod -Uri "https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py" -OutFile $Tmp
    python $Tmp
    Remove-Item $Tmp -ErrorAction SilentlyContinue
    Write-Host "  [OK] PlatformIO instalado en ~/.platformio (Tecnia Bot lo encuentra solo)."
}

# --- 4. Tecnia Bot (capa educativa) ------------------------------------------
Write-Host ""
Write-Host "  [..] Instalando la capa de Tecnia Bot..."
powershell -ExecutionPolicy Bypass -File (Join-Path $RepoDir "install\install.ps1")

Write-Host ""
Write-Host "  LISTO! Abri una terminal en cualquier carpeta, escribi 'opencode',"
Write-Host "  apreta Tab y elegi 'tecnia-bot'."
Write-Host ""
