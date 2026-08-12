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

# ---- Perfil del usuario: se crea VACIO solo si NO existe (nunca se pisa) ----
# Es dato del usuario (nombre/rol/placa) y debe sobrevivir a los /actualizar, por
# eso NO se copia del repo: lo crea el instalador la primera vez. Su ruta absoluta
# se agrega a "instructions" de opencode (mas abajo) para cargarlo en cada sesion:
# asi el bot recuerda el nombre sin volver a preguntar.
$PerfilFile = Join-Path $ConfigDir "tecnia-perfil.md"
if (-not (Test-Path $PerfilFile)) {
    $perfilTemplate = @"
# Perfil del usuario de Tecnia Bot
<!-- Lo mantiene Tecnia Bot. No editar a mano salvo que quieras cambiar tus datos.
     Modo "aula" = compu compartida por muchos: el Nombre NO se guarda (privacidad de menores).
     Modo "grupo" = pocas personas conocidas: se guarda a cada una en "## Personas". -->

- Modo: (sin definir)
- Nombre: (sin definir)
- Rol: (sin definir)
- Género: (sin definir)
- Placa preferida: (sin definir)
"@
    [System.IO.File]::WriteAllText($PerfilFile, $perfilTemplate, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  [OK] Perfil de usuario creado (vacio) en $PerfilFile"
}

# ---- Memoria de progreso de ESTA compu: se crea VACIA solo si NO existe (nunca se pisa) ----
# Es el progreso pedagogico de la maquina/grupo (nivel, proyectos hechos) y debe
# sobrevivir a los /actualizar, por eso NO se copia del repo: lo crea el instalador la
# primera vez. Su ruta absoluta se agrega a "instructions" de opencode (mas abajo) para
# cargarla en cada sesion: asi el bot recuerda el progreso sin volver a preguntar.
$MemoriaFile = Join-Path $ConfigDir "tecnia-memoria.md"
if (-not (Test-Path $MemoriaFile)) {
    $memoriaTemplate = @"
# Memoria de ESTA compu (no de una persona)
<!-- Progreso pedagogico de esta maquina/grupo. Lo mantiene Tecnia Bot.
     NO guarda datos personales de ningun alumno (ni nombre ni nada que identifique
     a un menor): en las PCs de escuela una cuenta la comparten muchos chicos. -->

- Nivel: (sin definir)
- Proyectos hechos: (sin definir)
- Ultimo proyecto: (sin definir)
- En curso: (sin definir)
"@
    [System.IO.File]::WriteAllText($MemoriaFile, $memoriaTemplate, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  [OK] Memoria de progreso creada (vacia) en $MemoriaFile"
}

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

    # instructions: array de rutas que opencode carga en el contexto de cada sesion.
    # Agregamos el perfil si no esta (idempotente, sin duplicar), preservando el resto.
    $instrucciones = @()
    if (($oc.PSObject.Properties.Name -contains "instructions") -and $null -ne $oc.instructions) {
        $instrucciones = @($oc.instructions)
    }
    if ($instrucciones -notcontains $PerfilFile) {
        $instrucciones += $PerfilFile
    }
    if ($instrucciones -notcontains $MemoriaFile) {
        $instrucciones += $MemoriaFile
    }
    $oc | Add-Member -NotePropertyName "instructions" -NotePropertyValue $instrucciones -Force

    $ocText = $oc | ConvertTo-Json -Depth 20
    # PS 5.1 colapsa arrays de UN solo elemento a escalar; forzamos que "instructions" quede array.
    if ($instrucciones.Count -le 1) {
        $ocText = [regex]::Replace($ocText, '("instructions":\s*)("(?:[^"\\]|\\.)*")', '$1[$2]')
    }
    [System.IO.File]::WriteAllText($OpencodeJson, $ocText, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  [OK] $(Split-Path $OpencodeJson -Leaf) actualizado (agente por defecto + perfil + memoria)."
}

Write-Host "==> Listo! Tecnia Bot v$Version instalado."
Write-Host ""

# ---- API key de Gemini: se pide UNA sola vez, solo si no hay ninguna guardada ----
# Sin esto Tecnia Bot no puede hablar con el modelo. Se guarda directo en el archivo
# de credenciales de OpenCode -- NUNCA en este repo, NUNCA en git, nunca se comparte
# entre instalaciones (cada compu pone la suya). Idempotente: si ya hay una key de
# "google" guardada (de esta instalacion o de un /connect manual), no se pregunta de
# nuevo en cada /actualizar.
if ($env:XDG_DATA_HOME) {
    $DataDir = Join-Path $env:XDG_DATA_HOME "opencode"
} else {
    $DataDir = Join-Path $env:USERPROFILE ".local\share\opencode"
}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$AuthFile = Join-Path $DataDir "auth.json"

$authData = $null
if (Test-Path $AuthFile) {
    try { $authData = Get-Content $AuthFile -Raw | ConvertFrom-Json } catch { $authData = $null }
}
if (-not $authData) { $authData = [PSCustomObject]@{} }

$tieneGoogle = ($authData.PSObject.Properties.Name -contains "google") -and $authData.google.key
if (-not $tieneGoogle) {
    Write-Host "==> Tecnia Bot necesita una API key GRATIS de Google (sin tarjeta) para hablar con el modelo."
    Write-Host "    Sacala en: https://aistudio.google.com/apikey (1 minuto, con cualquier cuenta de Google)"
    Write-Host "    Se guarda en ESTA compu, nunca se comparte ni sube a ningun lado."
    # Timeout de 60s: si esto corre en modo silencioso/desatendido (deploy a varias
    # PCs) con una consola real pero nadie tipeando, una lectura bloqueante se
    # colgaria para siempre. Start-Job/Read-Host NO sirve (un job corre en un
    # proceso aislado sin consola real -> deadlock detectado por PowerShell). Un
    # Task sobre [Console]::ReadLine() tampoco -- falla si no hay consola real
    # adjunta. La tecnica correcta: sondear [Console]::KeyAvailable con un
    # cronometro. Si la entrada esta redirigida (pipe/automatizacion), KeyAvailable
    # tira excepcion -- en ese caso caemos a una lectura simple, que ahi SI es
    # segura (un pipe nunca se cuelga: devuelve al toque lo que tenga, o vacio).
    Write-Host "    Pegala aca (o Enter para hacerlo despues con /connect dentro de OpenCode) [60s]:"
    $key = ""
    $recibioAlgo = $false
    try {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        while ($sw.Elapsed.TotalSeconds -lt 60) {
            if ([Console]::KeyAvailable) {
                $charInfo = [Console]::ReadKey($true)
                if ($charInfo.Key -eq "Enter") { $recibioAlgo = $true; Write-Host ""; break }
                elseif ($charInfo.Key -eq "Backspace") {
                    if ($key.Length -gt 0) { $key = $key.Substring(0, $key.Length - 1) }
                } else {
                    $key += $charInfo.KeyChar
                }
            } else {
                Start-Sleep -Milliseconds 100
            }
        }
        if (-not $recibioAlgo) { Write-Host ""; Write-Host "  [i] Sin respuesta en 60s -- seguimos sin key por ahora." }
    } catch [System.InvalidOperationException] {
        # Consola redirigida (pipe/automatizacion): un pipe no se cuelga, leemos directo.
        $key = [Console]::In.ReadLine()
        if (-not $key) { $key = "" }
    }
    # OJO -- decision explicita, pedida y confirmada por el equipo: si nadie pega su
    # propia key, se usa una key de respaldo hardcodeada ahi mismo, para que la
    # instalacion quede usable sin fricción. Esta key queda publica en este repo
    # (es publico) y es MUY probable que Google la revoque via su escaneo automatico
    # de secretos -- ya se explico ese riesgo antes de escribir esto. Cada quien
    # puede seguir pegando la SUYA en el prompto de arriba para no depender de esta.
    $keyFinal = if ($key -and $key.Trim()) { $key.Trim() } else { "AQ.Ab8RN6JscK6NsgkvLXY0RfzoGCdIVVQYs7xUYNtxM377VgPZRA" }
    $authData | Add-Member -NotePropertyName "google" -NotePropertyValue @{ type = "api"; key = $keyFinal } -Force
    ($authData | ConvertTo-Json -Depth 10) | Set-Content -Path $AuthFile -Encoding UTF8
    [Environment]::SetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", $keyFinal, "User")
    if ($key -and $key.Trim()) {
        Write-Host "  [OK] Key guardada. Tecnia Bot ya puede usar Gemini."
    } else {
        Write-Host "  [OK] Usando key de respaldo (podes reemplazarla despues con /connect si conseguis la tuya propia)."
    }
    Write-Host ""
}

Write-Host "Verificando dependencias:"

# Chequear OpenCode
if (Get-Command opencode -ErrorAction SilentlyContinue) {
    Write-Host "  [OK] OpenCode instalado"
} else {
    Write-Host "  [FALTA] OpenCode no esta instalado. Instalalo desde https://opencode.ai"
}

# pio en el PATH del usuario (comodidad: que 'pio' funcione pelado en la terminal).
# PlatformIO deja pio en su venv privado (~/.platformio/penv/Scripts), fuera del PATH.
# Tecnia Bot lo encuentra por ruta completa igual; esto es para uso manual. Corre en
# cada install/actualizar (idempotente), asi le llega a todos. Cuidado: preservamos el
# tipo de registro (REG_EXPAND_SZ) y NO expandimos las %VAR% existentes, para no romper.
$PioScripts = Join-Path $env:USERPROFILE ".platformio\penv\Scripts"
if (Test-Path $PioScripts) {
    $agregado = $false
    $reg = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
    try {
        $tienePath = ($reg.GetValueNames() -contains "Path")
        $actual = if ($tienePath) { $reg.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { "" }
        $kind = if ($tienePath) { $reg.GetValueKind("Path") } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
        $partes = @($actual -split ';' | Where-Object { $_ -ne "" })
        if (-not ($partes | Where-Object { $_.TrimEnd('\') -ieq $PioScripts.TrimEnd('\') })) {
            $reg.SetValue("Path", (($partes + $PioScripts) -join ';'), $kind)
            $agregado = $true
        }
    } finally {
        $reg.Close()
    }
    if (-not ($env:PATH -split ';' | Where-Object { $_.TrimEnd('\') -ieq $PioScripts.TrimEnd('\') })) {
        $env:PATH = "$env:PATH;$PioScripts"
    }
    # Avisar a Windows del cambio (WM_SETTINGCHANGE) para que 'pio' funcione en
    # terminales NUEVAS SIN reiniciar. El explorador reelee el PATH del registro al
    # recibirlo. Best-effort: si falla, el PATH igual quedo y toma efecto al re-loguear.
    if ($agregado) {
        try {
            if (-not ("Win32.EnvRefresh" -as [type])) {
                Add-Type -Namespace Win32 -Name EnvRefresh -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true, CharSet=System.Runtime.InteropServices.CharSet.Auto)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);'
            }
            $res = [System.UIntPtr]::Zero
            [void][Win32.EnvRefresh]::SendMessageTimeout([System.IntPtr]0xffff, 0x1a, [System.UIntPtr]::Zero, "Environment", 2, 5000, [ref]$res)
        } catch {
            # best-effort: el cambio ya quedo en el registro
        }
    }
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
