# Desinstala Tecnia Bot de forma prolija: borra SOLO los archivos que instalo
# (segun el manifest), sin tocar la config personal del usuario ni OpenCode/PlatformIO.
#
# Uso: powershell -ExecutionPolicy Bypass -File install\uninstall.ps1
#
# Los datos PERSONALES (perfil/memoria del aula, key de Google) se PREGUNTAN, con
# 20 s de espera y "No" por defecto. Para no preguntar:
#   -Conservar   los deja (lo que pasa si nadie contesta)
#   -Borrar      los quita sin preguntar
#
# LA REGLA DE ESTE SCRIPT: despues de borrar, RELEER. Y decir SOLO lo que se
# comprobo. Un borrado que falla en silencio seguido de un mensaje que dice
# "borrado" es PEOR que no borrar nada, porque le saca a la docente la
# posibilidad de arreglarlo a mano. Aca el silencio venia de
# `-ErrorAction SilentlyContinue`: si OpenCode esta abierto tiene tomados el
# perfil y la memoria (los dos entran por "instructions" de opencode.json), el
# Remove-Item no hace nada, no tira error, y el mensaje salia igual. Son datos
# PERSONALES de MENORES (Ley 25.326, ver opencode/tool/memoria.ts) y una
# credencial del docente. Todo borrado de aca abajo se relee antes de afirmarse.

param(
    [switch]$Conservar,
    [switch]$Borrar
)

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

# ---- Borrar y RELEER (la regla del encabezado, en dos funciones) -------------
#
# Lo que quedo sin borrar se junta en $Pendientes y sale en el mensaje final,
# para que el ultimo "Listo. Tecnia Bot desinstalado." tampoco afirme de mas.
$Pendientes = New-Object System.Collections.ArrayList
function Anotar-Pendiente($texto) { [void]$Pendientes.Add($texto) }

# Borra y devuelve $true SOLO si al releer con Test-Path el archivo ya no esta.
# El -ErrorAction SilentlyContinue se queda (no queremos que un archivo tomado
# corte el desinstalador a la mitad), pero ahora quien decide es la relectura.
function Borrar-YVerificar($path) {
    if (-not (Test-Path $path)) { return $true }
    Remove-Item $path -Force -ErrorAction SilentlyContinue
    return (-not (Test-Path $path))
}

# Si alguno no se pudo borrar (lo tipico: OpenCode abierto tomando un archivo),
# se dice cual y se CONSERVA el manifest: es la lista de lo que falta sacar, y
# sin ella la proxima corrida cree que no hay nada instalado y no borra nada.
$NoBorrados = New-Object System.Collections.ArrayList
Get-Content $Manifest | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and -not $line.StartsWith("version=") -and -not $line.StartsWith("repo_dir=")) {
        $archivo = Join-Path $ConfigDir $line
        if (-not (Borrar-YVerificar $archivo)) { [void]$NoBorrados.Add($archivo) }
    }
}

if ($NoBorrados.Count -eq 0) {
    if (-not (Borrar-YVerificar $Manifest)) { Anotar-Pendiente "el registro de la instalacion: $Manifest" }
} else {
    Write-Host "  [X] No pude borrar $($NoBorrados.Count) archivo(s) de Tecnia Bot (los relei y siguen ahi):"
    foreach ($f in $NoBorrados) { Write-Host "      $f" }
    Write-Host "      Casi siempre es que OpenCode esta abierto y los tiene tomados."
    Write-Host "      Cerra OpenCode y volve a correr el desinstalador."
    Write-Host "      Dejo el registro ($Manifest) para que el proximo intento sepa que falta."
    Anotar-Pendiente "$($NoBorrados.Count) archivo(s) de Tecnia Bot en $ConfigDir"
}

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
        if (-not (Borrar-YVerificar $path)) { Anotar-Pendiente "la config que quedo de Tecnia Bot: $path" }
        return
    }
    $json = $obj | ConvertTo-Json -Depth 20
    # PS 5.1 colapsa arrays de UN solo elemento a escalar; si al docente le queda un
    # solo plugin propio (o una sola instruccion), lo forzamos a que siga siendo array.
    $json = [regex]::Replace($json, '("plugin":\s*)("(?:[^"\\]|\\.)*")', '$1[$2]')
    $json = [regex]::Replace($json, '("instructions":\s*)("(?:[^"\\]|\\.)*")', '$1[$2]')
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
# Lo que install.ps1 escribe ahi, y SOLO eso:
#   default_agent      si es "tecnia-bot"
#   agent.tecnia-bot   el override del modelo ("agent" queda si tiene otros agentes)
#   instructions[]     las dos rutas absolutas a tecnia-perfil.md y tecnia-memoria.md
# Antes se sacaba solo default_agent: quedaban dos rutas a archivos que ya no
# existian (OpenCode avisa en cada arranque) y un override de modelo huerfano.
# Todo lo demas del docente (otros agentes, provider, mcp...) se preserva. Si el
# archivo no parsea, no se toca y se dice que sacar a mano: romper la config de
# OpenCode al desinstalar es peor que dejar tres claves de mas.
$PerfilFile  = Join-Path $ConfigDir "tecnia-perfil.md"
$MemoriaFile = Join-Path $ConfigDir "tecnia-memoria.md"
$ocTieneTexto = $false
if ($OpencodeJson) { $ocTieneTexto = ((Get-Content $OpencodeJson -Raw -ErrorAction SilentlyContinue) -match '\S') }
$oc = Read-JsonObject $OpencodeJson
if ($ocTieneTexto -and -not $oc) {
    Write-Host "  [AVISO] No pude parsear ${OpencodeJson}: lo dejo intacto."
    Write-Host "          Saca a mano `"default_agent`", `"agent`" -> `"$TecniaAgent`" y las dos rutas de"
    Write-Host "          `"instructions`" que terminan en tecnia-perfil.md y tecnia-memoria.md."
} elseif ($oc) {
    if (($oc.PSObject.Properties.Name -contains "default_agent") -and $oc.default_agent -eq $TecniaAgent) {
        $oc.PSObject.Properties.Remove("default_agent")
    }
    if (($oc.PSObject.Properties.Name -contains "agent") -and ($oc.agent -is [PSCustomObject])) {
        if ($oc.agent.PSObject.Properties.Name -contains $TecniaAgent) {
            $oc.agent.PSObject.Properties.Remove($TecniaAgent)
        }
        if (@($oc.agent.PSObject.Properties).Count -eq 0) { $oc.PSObject.Properties.Remove("agent") }
    }
    if (($oc.PSObject.Properties.Name -contains "instructions") -and $null -ne $oc.instructions) {
        $resto = @($oc.instructions | Where-Object { -not (($_ -ieq $PerfilFile) -or ($_ -ieq $MemoriaFile)) })
        if ($resto.Count -eq 0) { $oc.PSObject.Properties.Remove("instructions") }
        else { $oc | Add-Member -NotePropertyName "instructions" -NotePropertyValue $resto -Force }
    }
    Save-OrRemove $OpencodeJson $oc
}

# ---- Datos PERSONALES: se preguntan, no se borran solos ----------------------
#
# Tres cosas que el instalador creo y son del docente, no del programa:
#   - tecnia-perfil.md y tecnia-memoria.md: lo que el bot aprendio de ese aula
#   - la key de Google, en auth.json y en la variable GOOGLE_GENERATIVE_AI_API_KEY
# Borrarlas sin preguntar es perder trabajo ajeno; dejarlas sin avisar es dejar
# una credencial en una maquina que quizas pasa a otra escuela. Se pregunta con
# 20 s de espera y "No" por defecto: desde Inno esto corre oculto (runhidden) y
# ahi nadie contesta, asi que se conserva todo y se dice donde quedo.
function Preguntar-SiNo($texto, $segundos) {
    Write-Host ""
    Write-Host $texto
    Write-Host ("    [s/N] (si no respondes en " + $segundos + " s, se conserva) ") -NoNewline
    $fin = (Get-Date).AddSeconds($segundos)
    try {
        while ((Get-Date) -lt $fin) {
            if ($Host.UI.RawUI.KeyAvailable) {
                $k = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
                Write-Host $k.Character
                return ([string]$k.Character -match '^[sSyY]$')
            }
            Start-Sleep -Milliseconds 200
        }
    } catch { }   # sin consola interactiva (ISE, entrada redirigida): No
    Write-Host ""
    return $false
}

if ((Test-Path $PerfilFile) -or (Test-Path $MemoriaFile)) {
    $quitar = [bool]$Borrar
    if (-not $Borrar -and -not $Conservar) {
        $quitar = Preguntar-SiNo "==> El perfil y la memoria del aula (tecnia-perfil.md, tecnia-memoria.md) son datos PERSONALES: lo que el bot aprendio de quien usa esta compu. Borrarlos tambien?" 20
    }
    if ($quitar) {
        # RELEER DESPUES DE BORRAR: ver el encabezado. Con OpenCode abierto estos
        # dos archivos estan tomados, Remove-Item no borra nada, el error se lo
        # traga SilentlyContinue, y antes se imprimia "borrados" igual.
        $Quedaron = @(@($PerfilFile, $MemoriaFile) | Where-Object { -not (Borrar-YVerificar $_) })
        if ($Quedaron.Count -eq 0) {
            Write-Host "    Perfil y memoria borrados (los relei y ya no estan)."
        } else {
            Write-Host "    [X] NO PUDE BORRAR estos datos personales: SIGUEN EN ESTA COMPUTADORA."
            foreach ($f in $Quedaron) { Write-Host "        $f" }
            Write-Host "        Casi siempre es que OpenCode esta abierto y los tiene tomados"
            Write-Host "        (los dos entran por `"instructions`" de opencode.json)."
            Write-Host "        Cerra OpenCode y volve a correr el desinstalador, o borralos a mano."
            Anotar-Pendiente "datos personales del aula en ${ConfigDir}: tecnia-perfil.md / tecnia-memoria.md"
        }
    } else {
        Write-Host "    Se conservan en ${ConfigDir}: tecnia-perfil.md y tecnia-memoria.md (borralos a mano si queres)."
    }
}

if ($env:XDG_DATA_HOME) { $DataDir = Join-Path $env:XDG_DATA_HOME "opencode" }
else { $DataDir = Join-Path $env:USERPROFILE ".local\share\opencode" }
$AuthFile = Join-Path $DataDir "auth.json"

# Estado de la key en auth.json: "si", "no" o "?".
#   si = se leyo el archivo y la key esta
#   no = se leyo el archivo y la key NO esta  <- lo UNICO que habilita decir "quitada"
#   ?  = no se pudo leer (archivo tomado, permisos, JSON roto)
# El "?" es el estado que faltaba: "no pude leer" y "no hay key" eran lo mismo,
# y un auth.json que no parsea puede tener la credencial adentro. Esta misma
# funcion se usa para DETECTAR antes y para VERIFICAR despues de escribir.
# Get-Content -Raw saca el BOM al leer; despues se reescribe SIN BOM
# (WriteAllText), que es lo que OpenCode necesita para poder leerlo.
function Get-EstadoKeyAuth($path) {
    if (-not (Test-Path $path)) { return "no" }
    try { $raw = Get-Content $path -Raw -ErrorAction Stop } catch { return "?" }
    if (-not $raw -or -not $raw.Trim()) { return "no" }
    try { $d = $raw | ConvertFrom-Json -ErrorAction Stop } catch { return "?" }
    if (-not $d) { return "?" }
    if (($d.PSObject.Properties.Name -contains "google") -and $d.google.key) { return "si" }
    return "no"
}

$hayKeyEnv = [bool][Environment]::GetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", "User")
$estadoAuth = Get-EstadoKeyAuth $AuthFile
$hayKeyAuth = ($estadoAuth -eq "si")
$authData = $null
if ($hayKeyAuth) {
    try { $authData = Get-Content $AuthFile -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { $authData = $null }
}
if ($hayKeyAuth -or $hayKeyEnv) {
    $quitar = [bool]$Borrar
    if (-not $Borrar -and -not $Conservar) {
        $quitar = Preguntar-SiNo "==> Hay una API key de Google guardada (auth.json y/o la variable GOOGLE_GENERATIVE_AI_API_KEY). Es TU credencial, no del programa: si esta compu pasa a otra persona conviene quitarla. Quitarla tambien?" 20
    }
    if ($quitar) {
        # Se escribe, se RELEE, y recien despues se dice. Lo que quedo se lista con
        # nombre y lugar: la docente que va a entregar la notebook necesita saber
        # exactamente que sacar a mano.
        $KeyQuedo = New-Object System.Collections.ArrayList
        if ($hayKeyAuth -and $authData) {
            try {
                $authData.PSObject.Properties.Remove("google")
                [System.IO.File]::WriteAllText($AuthFile, ($authData | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
            } catch { }
            if ((Get-EstadoKeyAuth $AuthFile) -ne "no") {
                [void]$KeyQuedo.Add("tu API key de Google, adentro del bloque `"google`" de $AuthFile")
            }
        } elseif ($hayKeyAuth) {
            [void]$KeyQuedo.Add("tu API key de Google, adentro del bloque `"google`" de $AuthFile")
        }
        if ($hayKeyEnv) {
            try { [Environment]::SetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", $null, "User") } catch { }
            if ([Environment]::GetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", "User")) {
                [void]$KeyQuedo.Add("la variable de usuario GOOGLE_GENERATIVE_AI_API_KEY (Panel de control > Sistema > Variables de entorno)")
            }
        }
        if ($KeyQuedo.Count -eq 0) {
            Write-Host "    Key de Google quitada: la relei y ya no esta (las otras credenciales de auth.json se preservan)."
        } else {
            Write-Host "    [X] NO PUDE QUITAR LA KEY: tu credencial de Google SIGUE EN ESTA COMPUTADORA."
            foreach ($p in $KeyQuedo) { Write-Host "        $p"; Anotar-Pendiente $p }
            Write-Host "        Si esta compu pasa a otra persona, sacala a mano ANTES de entregarla."
            Write-Host "        auth.json se abre con el Bloc de notas: borra el bloque `"google`": { ... }."
        }
    } else {
        Write-Host "    La key de Google se conserva: OpenCode la sigue usando si lo abris sin Tecnia Bot."
    }
}
if ($estadoAuth -eq "?") {
    # Ni siquiera se pudo LEER el archivo, asi que no se toco. Callarse aca es el
    # mismo problema con otra cara: la docente entrega la notebook creyendo que el
    # desinstalador miro, y adentro puede estar la key.
    Write-Host ""
    Write-Host "  [AVISO] No pude leer ${AuthFile} (JSON roto, permisos, o archivo tomado)."
    Write-Host "          NO SE si adentro quedo tu API key de Google, y no lo toque."
    Write-Host "          Si esta compu pasa a otra persona, abrilo con el Bloc de notas:"
    Write-Host "          si hay un bloque `"google`": { ... }, sacalo a mano antes de entregarla."
    Anotar-Pendiente "no pude verificar si tu API key de Google sigue en $AuthFile"
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

# El mensaje final tampoco afirma de mas: si algo quedo sin borrar, se dice que
# la desinstalacion fue PARCIAL y se lista que quedo y donde.
if ($Pendientes.Count -eq 0) {
    Write-Host "==> Listo. Tecnia Bot desinstalado."
} else {
    Write-Host "==> Tecnia Bot se desinstalo PARCIALMENTE. Quedo sin borrar:"
    foreach ($p in $Pendientes) { Write-Host "    - $p" }
    Write-Host "    Cerra OpenCode y volve a correr el desinstalador, o sacalo a mano."
}
Write-Host "    (OpenCode y PlatformIO NO se tocaron: son independientes.)"
