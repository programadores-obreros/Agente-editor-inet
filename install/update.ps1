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
    # Estos archivos los mantiene el instalador -- nadie los deberia tocar a
    # mano (mismo criterio que el manifest). Si igual quedaron modificados
    # localmente por lo que sea (antivirus, un update anterior interrumpido a
    # mitad de camino), "git pull" se rompe con un error crudo en ingles que
    # el docente no puede leer -- lo descartamos ANTES de bajar lo nuevo.
    # Aseguramos ademas que siga a `main` (por si alguien quedo en otra rama,
    # ej. de una instalacion de desarrollo): sin esto, un pull limpio en la
    # rama equivocada no trae nada nuevo y el docente ve "ya estabas al dia"
    # sin serlo.
    #
    # OJO: git manda mensajes puramente informativos (ej: "Already on 'main'")
    # por stderr -- con $ErrorActionPreference = "Stop" (seteado arriba),
    # PowerShell los toma como error fatal aunque el comando haya andado bien.
    # Bajamos la preferencia SOLO para estos pasos de limpieza best-effort; el
    # pull real, mas abajo, vuelve a "Stop" y si falla, tiene que fallar fuerte.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    git -C $RepoDir reset --hard HEAD 2>&1 | Out-Null
    git -C $RepoDir clean -fd -e "*.manifest" 2>&1 | Out-Null
    git -C $RepoDir checkout main 2>&1 | Out-Null
    $ErrorActionPreference = $prevEAP
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
