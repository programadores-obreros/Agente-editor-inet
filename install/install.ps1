# Instalador de Profe Bot para Windows (PowerShell).
# Copia la capa educativa a la config global de OpenCode,
# para que Profe Bot este disponible en CUALQUIER carpeta donde abras opencode.
#
# Uso: clic derecho -> "Ejecutar con PowerShell", o desde una terminal:
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"

# Directorio de config global de OpenCode en Windows (respeta XDG si esta seteado)
if ($env:XDG_CONFIG_HOME) {
    $ConfigDir = Join-Path $env:XDG_CONFIG_HOME "opencode"
} else {
    $ConfigDir = Join-Path $env:USERPROFILE ".config\opencode"
}

# Carpeta de este repo (la raiz, un nivel arriba de install/)
$RepoDir = Split-Path -Parent $PSScriptRoot
$Src = Join-Path $RepoDir "opencode"

Write-Host "==> Instalando Profe Bot en: $ConfigDir"

foreach ($sub in @("agent", "tool", "skills", "command")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $ConfigDir $sub) | Out-Null
}

Copy-Item (Join-Path $Src "agent\profe-bot.md")       (Join-Path $ConfigDir "agent\") -Force
Copy-Item (Join-Path $Src "tool\platformio.ts")       (Join-Path $ConfigDir "tool\") -Force
Copy-Item (Join-Path $Src "skills\arduino")           (Join-Path $ConfigDir "skills\") -Recurse -Force
Copy-Item (Join-Path $Src "skills\esp32")             (Join-Path $ConfigDir "skills\") -Recurse -Force
Copy-Item (Join-Path $Src "skills\errores-comunes")   (Join-Path $ConfigDir "skills\") -Recurse -Force
Copy-Item (Join-Path $Src "command\diagnostico.md")   (Join-Path $ConfigDir "command\") -Force

Write-Host "==> Listo! Profe Bot instalado."
Write-Host ""
Write-Host "Verificando dependencias:"

# Chequear OpenCode
if (Get-Command opencode -ErrorAction SilentlyContinue) {
    Write-Host "  [OK] OpenCode instalado"
} else {
    Write-Host "  [FALTA] OpenCode no esta instalado. Instalalo desde https://opencode.ai"
}

# Chequear PlatformIO (en PATH o en la ruta de instalacion conocida)
$pioPath = Join-Path $env:USERPROFILE ".platformio\penv\Scripts\pio.exe"
if (Get-Command pio -ErrorAction SilentlyContinue) {
    Write-Host "  [OK] PlatformIO en PATH"
} elseif (Test-Path $pioPath) {
    Write-Host "  [OK] PlatformIO instalado (Profe Bot lo encuentra aunque no este en PATH)"
} else {
    Write-Host "  [FALTA] PlatformIO no esta instalado. Ver docs/instalacion-windows.md"
}

Write-Host ""
Write-Host "Para empezar: abri una terminal en cualquier carpeta, escribi 'opencode',"
Write-Host "apreta Tab y elegi 'profe-bot'."
