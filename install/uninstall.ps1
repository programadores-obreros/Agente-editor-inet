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

# ---- Sacar NUESTRAS claves de la config de OpenCode (sin tocar el resto) ----
# tui (json/jsonc): quitar el plugin del logo y el theme si es el nuestro.
# opencode (json/jsonc): quitar default_agent si es tecnia-bot.
# Preservamos provider/model y cualquier otra cosa del docente.
#
# OpenCode acepta .json o .jsonc; operamos sobre el que EXISTA (preferimos .json).
$TecniaPlugin = "./plugins/tecnia-logo.tsx"
$TecniaTheme  = "tecnia-violet"
$TecniaAgent  = "tecnia-bot"

# Resuelve el archivo existente (.json preferido, si no .jsonc, si no $null).
function Resolve-ExistingConfig($base) {
    if (Test-Path "$base.json") { return "$base.json" }
    elseif (Test-Path "$base.jsonc") { return "$base.jsonc" }
    else { return $null }
}
$TuiJson      = Resolve-ExistingConfig (Join-Path $ConfigDir "tui")
$OpencodeJson = Resolve-ExistingConfig (Join-Path $ConfigDir "opencode")

# Saca comentarios // y /* */ respetando strings (para no romper URLs con "//").
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

function Read-JsonObject($path) {
    if (-not $path -or -not (Test-Path $path)) { return $null }
    $raw = Get-Content $path -Raw -ErrorAction SilentlyContinue
    if (-not $raw -or -not $raw.Trim()) { return $null }
    try { return ($raw | ConvertFrom-Json) } catch { }
    try { return ((Remove-JsonComments $raw) | ConvertFrom-Json) } catch { return $null }
}

# Escribe el objeto, o borra el archivo si solo queda "$schema" (era nuestro).
function Save-OrRemove($path, $obj) {
    $keys = @($obj.PSObject.Properties.Name | Where-Object { $_ -ne '$schema' })
    if ($keys.Count -eq 0) {
        Remove-Item $path -Force -ErrorAction SilentlyContinue
        return
    }
    $json = $obj | ConvertTo-Json -Depth 20
    # PS 5.1 colapsa arrays de UN solo elemento a escalar; si al docente le queda un
    # solo plugin propio, lo forzamos a que siga siendo array.
    $json = [regex]::Replace($json, '("plugin":\s*)("(?:[^"\\]|\\.)*")', '$1[$2]')
    [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding $false))
}

# --- tui.json ---
$tui = Read-JsonObject $TuiJson
if ($tui) {
    if (($tui.PSObject.Properties.Name -contains "plugin") -and $null -ne $tui.plugin) {
        $plugins = @($tui.plugin | Where-Object { $_ -ne $TecniaPlugin })
        if ($plugins.Count -eq 0) {
            $tui.PSObject.Properties.Remove("plugin")
        } else {
            $tui | Add-Member -NotePropertyName "plugin" -NotePropertyValue $plugins -Force
        }
    }
    if (($tui.PSObject.Properties.Name -contains "theme") -and $tui.theme -eq $TecniaTheme) {
        $tui.PSObject.Properties.Remove("theme")
    }
    Save-OrRemove $TuiJson $tui
}

# --- opencode.json ---
$oc = Read-JsonObject $OpencodeJson
if ($oc) {
    if (($oc.PSObject.Properties.Name -contains "default_agent") -and $oc.default_agent -eq $TecniaAgent) {
        $oc.PSObject.Properties.Remove("default_agent")
    }
    Save-OrRemove $OpencodeJson $oc
}

# Borrar directorios que hayan quedado vacios.
foreach ($d in @("tecniabot-web", "skills", "plugins", "themes")) {
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
