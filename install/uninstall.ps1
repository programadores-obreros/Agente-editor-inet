# Desinstala Tecnia Bot de forma prolija: borra SOLO los archivos que instalo
# (segun el manifest), sin tocar la config personal del usuario ni OpenCode/PlatformIO.
#
# Uso: powershell -ExecutionPolicy Bypass -File install\uninstall.ps1

$ErrorActionPreference = "Stop"

if ($env:XDG_CONFIG_HOME) {
    $ConfigDir = Join-Path $env:XDG_CONFIG_HOME "opencode"
} else {
    $ConfigDir = Join-Path $env:USERPROFILE ".config\opencode"
}
$Manifest = Join-Path $ConfigDir "tecnia-bot.manifest"

if (-not (Test-Path $Manifest)) {
    Write-Host "No encontre Tecnia Bot instalado (no hay manifest en $ConfigDir)."
    exit 0
}

Write-Host "==> Desinstalando Tecnia Bot de: $ConfigDir"

Get-Content $Manifest | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and -not $line.StartsWith("version=") -and -not $line.StartsWith("repo_dir=")) {
        Remove-Item (Join-Path $ConfigDir $line) -Force -ErrorAction SilentlyContinue
    }
}

Remove-Item $Manifest -Force -ErrorAction SilentlyContinue

# Borrar directorios que hayan quedado vacios.
foreach ($d in @("tecniabot-web", "skills")) {
    $path = Join-Path $ConfigDir $d
    if (Test-Path $path) {
        Get-ChildItem $path -Recurse -Directory | Where-Object { -not (Get-ChildItem $_.FullName -Recurse -File) } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Get-ChildItem $path -Recurse -File -ErrorAction SilentlyContinue)) {
            Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "==> Listo. Tecnia Bot desinstalado."
Write-Host "    (OpenCode y PlatformIO NO se tocaron: son independientes.)"
