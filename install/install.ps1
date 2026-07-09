# Instalador de Tecnia Bot para Windows (PowerShell).
# Copia la capa educativa a la config global de OpenCode,
# para que Tecnia Bot este disponible en CUALQUIER carpeta donde abras opencode.
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

Write-Host "==> Instalando Tecnia Bot en: $ConfigDir"

foreach ($sub in @("agent", "tool", "skills", "command")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $ConfigDir $sub) | Out-Null
}

# Copiamos todo el contenido de cada carpeta (asi los archivos nuevos
# se instalan solos, sin actualizar este script cada vez).
Copy-Item (Join-Path $Src "agent\*")   (Join-Path $ConfigDir "agent\")   -Recurse -Force
Copy-Item (Join-Path $Src "tool\*")    (Join-Path $ConfigDir "tool\")    -Recurse -Force
Copy-Item (Join-Path $Src "skills\*")  (Join-Path $ConfigDir "skills\")  -Recurse -Force
Copy-Item (Join-Path $Src "command\*") (Join-Path $ConfigDir "command\") -Recurse -Force

# Biblioteca visual (piezas Wokwi + componentes dibujados) para los circuitos en HTML.
# SIN esto, la herramienta de circuitos no puede dibujar nada.
$WebDir = Join-Path $ConfigDir "tecniabot-web"
New-Item -ItemType Directory -Force -Path $WebDir | Out-Null
Copy-Item (Join-Path $Src "tecniabot-web\*") $WebDir -Recurse -Force

# ---- Manifest: version + ubicacion del repo + archivos instalados ----
# Habilita actualizar limpio (borra huerfanos) y desinstalar sin tocar lo del usuario.
$Manifest = Join-Path $ConfigDir "tecnia-bot.manifest"
$VerFile = Join-Path $RepoDir "VERSION"
$Version = if (Test-Path $VerFile) { (Get-Content $VerFile -Raw).Trim() } else { "0.0.0" }

# Lista de archivos instalados, rutas relativas a $ConfigDir con "/" (para que
# coincidan con las que escribe el instalador de Linux).
$Nuevos = foreach ($sub in @("agent", "tool", "skills", "command", "tecniabot-web")) {
    Get-ChildItem -Path (Join-Path $Src $sub) -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($Src.Length + 1) -replace '\\', '/'
        $rel
    }
}
$Nuevos = $Nuevos | Sort-Object

# Borrar huerfanos: lo que instalamos ANTES y ya no existe (ej: un agente renombrado).
if (Test-Path $Manifest) {
    $NuevosSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$Nuevos)
    Get-Content $Manifest | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and -not $line.StartsWith("version=") -and -not $line.StartsWith("repo_dir=")) {
            if (-not $NuevosSet.Contains($line)) {
                Remove-Item (Join-Path $ConfigDir $line) -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

$manifestLines = @("# Tecnia Bot - archivos instalados. NO editar a mano.", "version=$Version", "repo_dir=$RepoDir") + $Nuevos
Set-Content -Path $Manifest -Value $manifestLines -Encoding UTF8

Write-Host "==> Listo! Tecnia Bot v$Version instalado."
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
    Write-Host "  [OK] PlatformIO instalado (Tecnia Bot lo encuentra aunque no este en PATH)"
} else {
    Write-Host "  [FALTA] PlatformIO no esta instalado. Ver docs/instalacion-windows.md"
}

Write-Host ""
Write-Host "Para empezar: abri una terminal en cualquier carpeta, escribi 'opencode',"
Write-Host "apreta Tab y elegi 'tecnia-bot'."
