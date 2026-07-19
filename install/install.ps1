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

foreach ($sub in @("agent", "tool", "skills", "command", "plugins", "themes")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $ConfigDir $sub) | Out-Null
}

# Copiamos todo el contenido de cada carpeta (asi los archivos nuevos
# se instalan solos, sin actualizar este script cada vez).
Copy-Item (Join-Path $Src "agent\*")   (Join-Path $ConfigDir "agent\")   -Recurse -Force
Copy-Item (Join-Path $Src "tool\*")    (Join-Path $ConfigDir "tool\")    -Recurse -Force
Copy-Item (Join-Path $Src "skills\*")  (Join-Path $ConfigDir "skills\")  -Recurse -Force
Copy-Item (Join-Path $Src "command\*") (Join-Path $ConfigDir "command\") -Recurse -Force

# Branding de Tecnia Bot: plugin de TUI (logo del splash) + theme violeta.
Copy-Item (Join-Path $Src "plugins\*") (Join-Path $ConfigDir "plugins\") -Recurse -Force
Copy-Item (Join-Path $Src "themes\*")  (Join-Path $ConfigDir "themes\")  -Recurse -Force

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
$Nuevos = foreach ($sub in @("agent", "tool", "skills", "command", "tecniabot-web", "plugins", "themes")) {
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

# ---- Config de OpenCode: theme violeta + plugin del logo + agente por defecto ----
# Mergeamos con la config que ya tenga el docente (ej: provider/model de /connect):
# NO la pisamos. Usamos ConvertFrom-Json / ConvertTo-Json nativos (sin dependencias).
# El theme y el plugin de TUI van en tui.json (opencode migra y borra esas claves de
# opencode.json). El agente por defecto va en opencode.json.
Write-Host ""
Write-Host "==> Configurando OpenCode (theme + logo + agente por defecto)..."

# OpenCode acepta AMBAS extensiones para cada config: prueba [name.json, name.jsonc].
# Detectamos cual existe y mergeamos en ESE (preferimos .json si estan los dos, igual
# que opencode). Si no existe ninguno, creamos .json.
$TecniaPlugin  = "./plugins/tecnia-logo.tsx"
$TecniaTheme   = "tecnia-violet"
$TecniaAgent   = "tecnia-bot"
$TuiSchema     = "https://opencode.ai/tui.json"
$OpencodeSchema = "https://opencode.ai/config.json"

# Resuelve el archivo de config: .json si existe, si no .jsonc, si no .json (a crear).
function Resolve-ConfigFile($base) {
    if (Test-Path "$base.json") { return "$base.json" }
    elseif (Test-Path "$base.jsonc") { return "$base.jsonc" }
    else { return "$base.json" }
}
$TuiJson      = Resolve-ConfigFile (Join-Path $ConfigDir "tui")
$OpencodeJson = Resolve-ConfigFile (Join-Path $ConfigDir "opencode")

# Saca comentarios // y /* */ de un .jsonc RESPETANDO strings (para no romper URLs
# como el $schema, que contienen "//"). PowerShell 5.1 no parsea JSONC de fabrica.
function Remove-JsonComments($text) {
    $sb = New-Object System.Text.StringBuilder
    $i = 0; $n = $text.Length
    $inStr = $false; $esc = $false
    while ($i -lt $n) {
        $c = $text[$i]
        if ($inStr) {
            [void]$sb.Append($c)
            if ($esc) { $esc = $false }
            elseif ($c -eq '\') { $esc = $true }
            elseif ($c -eq '"') { $inStr = $false }
            $i++; continue
        }
        if ($c -eq '"') { $inStr = $true; [void]$sb.Append($c); $i++; continue }
        if ($c -eq '/' -and ($i + 1) -lt $n -and $text[$i + 1] -eq '/') {
            $i += 2
            while ($i -lt $n -and $text[$i] -ne "`n" -and $text[$i] -ne "`r") { $i++ }
            continue
        }
        if ($c -eq '/' -and ($i + 1) -lt $n -and $text[$i + 1] -eq '*') {
            $i += 2
            while (($i + 1) -lt $n -and -not ($text[$i] -eq '*' -and $text[$i + 1] -eq '/')) { $i++ }
            $i += 2; continue
        }
        [void]$sb.Append($c); $i++
    }
    return $sb.ToString()
}

# Lee un JSON/JSONC existente como PSCustomObject. Devuelve $null si no se pudo.
function Read-JsonObject($path) {
    if (-not (Test-Path $path)) { return $null }
    $raw = Get-Content $path -Raw -ErrorAction SilentlyContinue
    if (-not $raw -or -not $raw.Trim()) { return $null }
    try { return ($raw | ConvertFrom-Json) } catch { }
    try { return ((Remove-JsonComments $raw) | ConvertFrom-Json) } catch { return $null }
}

# True si el archivo existe y tiene contenido (para distinguir "vacio/ausente" de
# "existe pero no se pudo parsear" y NO pisar la config del usuario en ese caso).
function Test-HasContent($path) {
    if (-not (Test-Path $path)) { return $false }
    $raw = Get-Content $path -Raw -ErrorAction SilentlyContinue
    return [bool]($raw -and $raw.Trim())
}

# --- tui (json/jsonc): theme + plugin (idempotente, preserva el resto) ---
$tuiHasContent = Test-HasContent $TuiJson
$tui = Read-JsonObject $TuiJson
if ($tuiHasContent -and $null -eq $tui) {
    Write-Host "  [AVISO] No pude parsear ${TuiJson}: lo dejo intacto."
    Write-Host "          Agregale a mano `"theme`": `"$TecniaTheme`" y el plugin `"$TecniaPlugin`"."
} else {
    if (-not $tui) { $tui = [PSCustomObject]@{} }
    if (-not ($tui.PSObject.Properties.Name -contains '$schema')) {
        $tui | Add-Member -NotePropertyName '$schema' -NotePropertyValue $TuiSchema -Force
    }
    $tui | Add-Member -NotePropertyName "theme" -NotePropertyValue $TecniaTheme -Force

    $plugins = @()
    if (($tui.PSObject.Properties.Name -contains "plugin") -and $null -ne $tui.plugin) {
        $plugins = @($tui.plugin)
    }
    if ($plugins -notcontains $TecniaPlugin) {
        $plugins += $TecniaPlugin
    }
    $tui | Add-Member -NotePropertyName "plugin" -NotePropertyValue $plugins -Force

    $tuiText = $tui | ConvertTo-Json -Depth 20
    # PS 5.1 colapsa arrays de UN solo elemento a escalar; forzamos que "plugin" quede array.
    if ($plugins.Count -le 1) {
        $tuiText = [regex]::Replace($tuiText, '("plugin":\s*)("(?:[^"\\]|\\.)*")', '$1[$2]')
    }
    # Escribe en UTF-8 SIN BOM (JSON.parse de Node/Bun rompe si hay BOM).
    [System.IO.File]::WriteAllText($TuiJson, $tuiText, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  [OK] $(Split-Path $TuiJson -Leaf) actualizado (theme + logo)."
}

# --- opencode (json/jsonc): default_agent (preserva todas las demas claves) ---
$ocHasContent = Test-HasContent $OpencodeJson
$oc = Read-JsonObject $OpencodeJson
if ($ocHasContent -and $null -eq $oc) {
    Write-Host "  [AVISO] No pude parsear ${OpencodeJson}: lo dejo intacto."
    Write-Host "          Agregale a mano `"default_agent`": `"$TecniaAgent`"."
} else {
    if (-not $oc) { $oc = [PSCustomObject]@{} }
    if (-not ($oc.PSObject.Properties.Name -contains '$schema')) {
        $oc | Add-Member -NotePropertyName '$schema' -NotePropertyValue $OpencodeSchema -Force
    }
    $oc | Add-Member -NotePropertyName "default_agent" -NotePropertyValue $TecniaAgent -Force
    $ocText = $oc | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($OpencodeJson, $ocText, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  [OK] $(Split-Path $OpencodeJson -Leaf) actualizado (agente por defecto)."
}

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
