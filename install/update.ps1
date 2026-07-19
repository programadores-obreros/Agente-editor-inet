# Actualiza Tecnia Bot: trae la ultima version y reinstala la capa.
#   - Si es un clon de git (dev): git pull.
#   - Si es la instalacion por .exe (docente, no es git): BAJA el fuente del
#     ultimo release desde GitHub (rama main) y reemplaza la copia maestra. Asi
#     el docente se actualiza sin re-descargar el .exe ni tocar OpenCode/PlatformIO.
#
# Uso: powershell -ExecutionPolicy Bypass -File install\update.ps1

$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $PSScriptRoot
$Repo = "programadores-obreros/Agente-editor-inet"

Write-Host "==> Actualizando Tecnia Bot..."

if ((Test-Path (Join-Path $RepoDir ".git")) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  [git] Bajando la ultima version (git pull)..."
    git -C $RepoDir pull --ff-only
} else {
    Write-Host "  [web] Bajando el fuente del ultimo release desde GitHub..."
    # GitHub exige TLS 1.2; PowerShell 5.1 no lo habilita por defecto.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $tmp = Join-Path $env:TEMP ("tecnia-update-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
        $zip = Join-Path $tmp "src.zip"
        Invoke-WebRequest -Uri "https://github.com/$Repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        $extracted = Get-ChildItem $tmp -Directory | Select-Object -First 1
        if (-not $extracted) { throw "No pude extraer el fuente descargado." }
        # Reemplaza la copia maestra con el fuente nuevo (opencode/, install/, VERSION...).
        Copy-Item (Join-Path $extracted.FullName "*") $RepoDir -Recurse -Force
        Write-Host "  [OK] Fuente actualizado."
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Reinstala la capa (copia archivos + mergea config, idempotente).
powershell -ExecutionPolicy Bypass -File (Join-Path $RepoDir "install\install.ps1")

Write-Host ""
Write-Host "==> Tecnia Bot actualizado. Reinicia OpenCode para cargar los cambios."
