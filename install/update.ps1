# Actualiza Tecnia Bot: baja la ultima version del repo y reinstala la capa
# (el instalador limpia los archivos huerfanos de la version anterior).
#
# Uso: powershell -ExecutionPolicy Bypass -File install\update.ps1

$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $PSScriptRoot

Write-Host "==> Actualizando Tecnia Bot..."

if ((Test-Path (Join-Path $RepoDir ".git")) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  [..] Bajando la ultima version desde GitHub..."
    git -C $RepoDir pull --ff-only
} else {
    Write-Host "  [i] Esta copia no es un clon de git: uso los archivos que ya tenes."
    Write-Host "      Para traer lo ultimo, volve a descargar el proyecto desde GitHub."
}

powershell -ExecutionPolicy Bypass -File (Join-Path $RepoDir "install\install.ps1")

Write-Host ""
Write-Host "==> Tecnia Bot actualizado. Reinicia OpenCode para cargar los cambios."
