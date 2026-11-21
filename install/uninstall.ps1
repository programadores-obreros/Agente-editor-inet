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
#
# CODIGOS DE SALIDA. Es un contrato: lo leen el desinstalador de Windows
# (installer\tecnia-bot.iss, que lanza esto con -Conservar o -Borrar) y la CI.
#   0     se saco todo lo que habia que sacar, y se comprobo releyendo
#   3     desinstalacion PARCIAL: algo quedo sin borrar (se lista al final)
#   otro  el script se corto antes de terminar: no se sabe que quedo
# Antes salia SIEMPRE por 0, tambien despues de imprimir "se desinstalo
# PARCIALMENTE": quien lo lanzaba leia un exito y Windows informaba una
# desinstalacion correcta con datos personales todavia en el disco.

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

# SIN MANIFEST NO SE SALE: se saltea SOLO el borrado de los archivos del programa.
#
# Antes aca habia un `exit 0`. El manifest es la lista de los archivos de la capa,
# nada mas: el perfil, la memoria del aula y la key de Google NO estan en esa lista
# y viven aunque el manifest falte (una desinstalacion anterior que lo borro, una
# instalacion a medias). Con ese `exit 0`, `-Borrar` en una compu sin manifest no
# borraba nada, salia por 0, y Windows informaba una desinstalacion correcta con
# los datos de los chicos y la credencial del docente todavia adentro.
$HayManifest = Test-Path $Manifest
if ($HayManifest) {
    Write-Host "==> Desinstalando Tecnia Bot de: $ConfigDir"
}
if (-not $HayManifest) {
    Write-Host "==> No encontre el registro de la instalacion (no hay manifest en $ConfigDir)."
    Write-Host "    Sin esa lista no se que archivos del programa hay, asi que no borro ninguno."
    Write-Host "    Sigo igual con la config de OpenCode y con los datos personales."
}

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
if ($HayManifest) {
    # Si el manifest esta pero no se puede LEER (tomado, sin permiso), no se corta:
    # se anota y se sigue con los datos personales, que son lo que no puede quedar.
    $LineasManifest = $null
    try { $LineasManifest = @(Get-Content $Manifest -ErrorAction Stop) } catch { $LineasManifest = $null }
    if ($null -eq $LineasManifest) {
        Write-Host "  [X] No pude leer el registro de la instalacion ($Manifest): no borre los archivos del programa."
        Anotar-Pendiente "los archivos de Tecnia Bot en $ConfigDir (no pude leer el registro $Manifest)"
    }
    if ($null -ne $LineasManifest) {
        foreach ($renglon in $LineasManifest) {
            $line = ([string]$renglon).Trim()
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
    }
}
if (-not $HayManifest) {
    # Sin la lista no se puede borrar la capa, pero SI se puede mirar si esta: el
    # agente es el archivo que el lanzador y el bootstrap usan para decidir "la capa
    # esta instalada". Si esta, la desinstalacion no fue completa y se dice.
    $AgenteSuelto = Join-Path $ConfigDir "agent\tecnia-bot.md"
    if (Test-Path $AgenteSuelto) {
        Write-Host "  [X] La capa de Tecnia Bot sigue en $ConfigDir (encontre $AgenteSuelto) y no tengo la lista para sacarla."
        Write-Host "      Corre 'Reparar Tecnia Bot' (vuelve a escribir el registro) y despues desinstala de nuevo."
        Anotar-Pendiente "la capa de Tecnia Bot en $ConfigDir (falta el registro para saber que archivos sacar)"
    }
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

# Los JSON de OpenCode se leen como UTF-8, que es como install.ps1 los escribe.
# `Get-Content -Raw` sin -Encoding, en Windows PowerShell 5.1, lee un archivo sin
# BOM con la codepage ANSI: con un usuario con tilde (`Direccion310`), las rutas de
# "instructions" volvian con letras raras, `-ieq $PerfilFile` no coincidia, las dos
# rutas NO se sacaban, y el archivo se reescribia con todo lo que tuviera tilde
# roto. ReadAllText con codificacion explicita tambien saca el BOM si lo hay.
# TIRA si no puede leer: quien llama decide que significa.
function Leer-TextoUtf8($ruta) {
    return [System.IO.File]::ReadAllText($ruta, (New-Object System.Text.UTF8Encoding $false))
}

# Las formas en que ese mismo bug dejo escrita una ruta en instalaciones viejas: la
# ruta pasada N veces por "escribir en UTF-8 y leer como ANSI". MISMA funcion que
# en install.ps1 (ningun .ps1 hace dot-sourcing de otro). Una ruta ASCII no tiene.
function Get-VariantesMalLeidas($ruta) {
    $variantes = @()
    $ansi = [System.Text.Encoding]::Default
    $utf8 = New-Object System.Text.UTF8Encoding $false
    $actual = [string]$ruta
    for ($vuelta = 0; $vuelta -lt 8; $vuelta++) {
        $siguiente = $ansi.GetString($utf8.GetBytes($actual))
        if ($siguiente -ceq $actual) { break }
        $variantes += $siguiente
        $actual = $siguiente
    }
    return $variantes
}

function Read-JsonObject($path) {
    if (-not $path -or -not (Test-Path $path)) { return $null }
    $raw = $null
    try { $raw = Leer-TextoUtf8 $path } catch { return $null }
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

# UNA ESCRITURA QUE FALLA ACA NO PUEDE CORTAR EL SCRIPT.
#
# Este archivo corre con $ErrorActionPreference = "Stop". Si tui.json u
# opencode.json estan en solo lectura, o tomados por OpenCode abierto, WriteAllText
# tira una excepcion y -sin el try de abajo- el script moria ACA: antes de llegar
# al perfil, a la memoria y a la key. Justo el camino `-Borrar` dejaba los datos
# personales en el disco por un archivo de config que no se pudo tocar. Ahora se
# anota como pendiente (sale en el resumen y en el codigo 3) y la purga corre igual.
# Del error se informa el TIPO, nunca el mensaje: el mensaje cita rutas y contenido.

# --- tui.json ---
try {
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
} catch {
    Write-Host "  [X] No pude sacar el theme y el logo de Tecnia Bot de ${TuiJson} ($($_.Exception.GetType().Name)): quedo como estaba."
    Write-Host "      Casi siempre es que esta en solo lectura o que OpenCode esta abierto."
    Anotar-Pendiente "el theme y el plugin del logo de Tecnia Bot en $TuiJson"
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
# Sesion de la cuenta de Tecnia Lab del docente (la escribe opencode\plataforma\sesion-local.ts).
$SesionFile  = Join-Path $ConfigDir "tecnia-sesion.json"
# El registro de cargas del tool platformio (0.4.8): por placa, que proyecto se
# cargo ultimo. Son hashes con una sal propia de la compu, pero salen de rutas
# que pueden tener el nombre de una persona: va con el perfil y la memoria.
$CargasFile  = Join-Path $ConfigDir "tecnia-cargas.json"
try {
    # Si el archivo existe y no se pudo LEER, cuenta como "tiene texto": cae en el
    # aviso de abajo (no se toca y queda pendiente) en vez de pasar por vacio.
    $ocTieneTexto = $false
    if ($OpencodeJson) {
        try { $ocTieneTexto = ((Leer-TextoUtf8 $OpencodeJson) -match '\S') } catch { $ocTieneTexto = $true }
    }
    $oc = Read-JsonObject $OpencodeJson
    if ($ocTieneTexto -and -not $oc) {
        Write-Host "  [AVISO] No pude parsear ${OpencodeJson} (o no lo pude leer): lo dejo intacto."
        Write-Host "          Saca a mano `"default_agent`", `"agent`" -> `"$TecniaAgent`" y las dos rutas de"
        Write-Host "          `"instructions`" que terminan en tecnia-perfil.md y tecnia-memoria.md."
        Anotar-Pendiente "las claves de Tecnia Bot en $OpencodeJson (no parsea: hay que sacarlas a mano)"
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
            # Ademas de las dos rutas, se van sus copias mal codificadas (ver
            # Get-VariantesMalLeidas), y SOLO si no existe un archivo con ese nombre.
            $rotas = @(Get-VariantesMalLeidas $PerfilFile) + @(Get-VariantesMalLeidas $MemoriaFile)
            $resto = @($oc.instructions | Where-Object {
                -not (($_ -ieq $PerfilFile) -or ($_ -ieq $MemoriaFile) -or (($_ -is [string]) -and ($rotas -ccontains $_) -and -not (Test-Path -LiteralPath $_)))
            })
            if ($resto.Count -eq 0) { $oc.PSObject.Properties.Remove("instructions") }
            else { $oc | Add-Member -NotePropertyName "instructions" -NotePropertyValue $resto -Force }
        }
        Save-OrRemove $OpencodeJson $oc
    }
} catch {
    Write-Host "  [X] No pude sacar lo de Tecnia Bot de ${OpencodeJson} ($($_.Exception.GetType().Name)): quedo como estaba."
    Write-Host "      Casi siempre es que esta en solo lectura o que OpenCode esta abierto."
    Write-Host "      Quedan ahi `"default_agent`", `"agent`" -> `"$TecniaAgent`" y las rutas de `"instructions`"."
    Anotar-Pendiente "el agente por defecto, el modelo y las rutas de instructions de Tecnia Bot en $OpencodeJson"
}

# ---- Datos PERSONALES: se preguntan, no se borran solos ----------------------
#
# Tres cosas que el instalador creo y son del docente, no del programa:
#   - tecnia-perfil.md y tecnia-memoria.md: lo que el bot aprendio de ese aula
#   - tecnia-cargas.json: el registro de que proyecto se cargo en cada placa
#   - la key de Google, en auth.json y en la variable GOOGLE_GENERATIVE_AI_API_KEY
# Borrarlas sin preguntar es perder trabajo ajeno; dejarlas sin avisar es dejar
# una credencial en una maquina que quizas pasa a otra escuela. Se pregunta con
# 20 s de espera y "No" por defecto. La pregunta la ve SOLO quien corre este script
# a mano y sin banderas. El desinstalador de Windows ya no llega aca preguntando:
# hace SU pregunta en un cartel (CurUninstallStepChanged en
# installer\tecnia-bot.iss) y lanza esto con -Conservar (ventana oculta) o con
# -Borrar (ventana a la vista, para que se lea que se pudo borrar y que no).
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

if ((Test-Path $PerfilFile) -or (Test-Path $MemoriaFile) -or (Test-Path $CargasFile)) {
    $quitar = [bool]$Borrar
    if (-not $Borrar -and -not $Conservar) {
        $quitar = Preguntar-SiNo "==> El perfil, la memoria del aula y el registro de cargas (tecnia-perfil.md, tecnia-memoria.md, tecnia-cargas.json) son datos PERSONALES: lo que el bot aprendio de quien usa esta compu. Borrarlos tambien?" 20
    }
    if ($quitar) {
        # RELEER DESPUES DE BORRAR: ver el encabezado. Con OpenCode abierto estos
        # dos archivos estan tomados, Remove-Item no borra nada, el error se lo
        # traga SilentlyContinue, y antes se imprimia "borrados" igual.
        $Quedaron = @(@($PerfilFile, $MemoriaFile, $CargasFile) | Where-Object { -not (Borrar-YVerificar $_) })
        if ($Quedaron.Count -eq 0) {
            Write-Host "    Perfil, memoria y registro de cargas borrados (los relei y ya no estan)."
        } else {
            Write-Host "    [X] NO PUDE BORRAR estos datos personales: SIGUEN EN ESTA COMPUTADORA."
            foreach ($f in $Quedaron) { Write-Host "        $f" }
            Write-Host "        Casi siempre es que OpenCode esta abierto y los tiene tomados"
            Write-Host "        (los dos entran por `"instructions`" de opencode.json)."
            Write-Host "        Cerra OpenCode y volve a correr el desinstalador, o borralos a mano."
            Anotar-Pendiente "datos personales del aula en ${ConfigDir}: tecnia-perfil.md / tecnia-memoria.md / tecnia-cargas.json"
        }
    } else {
        Write-Host "    Se conservan en ${ConfigDir}: tecnia-perfil.md, tecnia-memoria.md y tecnia-cargas.json (borralos a mano si queres)."
    }
}

# ---- Sesion de Tecnia Lab (tecnia-sesion.json) --------------------------------
# El token del vinculo con la cuenta del docente, mas su nombre y su email. Es una
# credencial, igual que la key de Google, y va con la misma regla: se borra, se
# RELEE, y se dice lo que paso. Borrarla de aca NO la cierra en la plataforma
# (este script no habla con la red), y eso tambien se dice.
if (Test-Path $SesionFile) {
    $quitarSesion = [bool]$Borrar
    if (-not $Borrar -and -not $Conservar) {
        $quitarSesion = Preguntar-SiNo "==> Hay una sesion de Tecnia Lab guardada en esta compu (tecnia-sesion.json). Es TU credencial, no del programa: si esta compu pasa a otra persona conviene quitarla. Quitarla tambien?" 20
    }
    if ($quitarSesion) {
        $SesionQuedo = -not (Borrar-YVerificar $SesionFile)
        if (-not $SesionQuedo) {
            Write-Host "    Sesion de Tecnia Lab borrada de esta compu (la relei y ya no esta)."
            Write-Host "    OJO: en la plataforma sigue abierta. Para cerrarla del todo, entra a tu"
            Write-Host "    perfil en la plataforma Tecnia Lab, seccion Tecnia Bot, y cerra el acceso de esta compu."
        } else {
            Write-Host "    [X] NO PUDE BORRAR la sesion de Tecnia Lab: SIGUE EN ESTA COMPUTADORA."
            Write-Host "        $SesionFile"
            Write-Host "        Cerra OpenCode y volve a correr el desinstalador, o borrala a mano."
            Write-Host "        Mientras tanto podes cortarle el acceso desde tu perfil en la plataforma Tecnia Lab."
            Anotar-Pendiente "sesion de Tecnia Lab en $SesionFile"
        }
    } else {
        Write-Host "    Se conserva la sesion de Tecnia Lab en $SesionFile (borrala a mano si queres)."
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
# Leer-TextoUtf8 saca el BOM al leer; despues se reescribe SIN BOM
# (WriteAllText), que es lo que OpenCode necesita para poder leerlo.
function Get-EstadoKeyAuth($path) {
    if (-not (Test-Path $path)) { return "no" }
    try { $raw = Leer-TextoUtf8 $path } catch { return "?" }
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
    try { $authData = (Leer-TextoUtf8 $AuthFile) | ConvertFrom-Json -ErrorAction Stop } catch { $authData = $null }
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

# Borrar directorios que hayan quedado vacios (mismo criterio que install.ps1
# para las tres carpetas de Phase 2 que sumo D12: nucleo, servidor, vista-fisica).
# Es prolijidad, no parte del contrato: si falla no cambia nada de lo que se
# informa, y no puede cortar el script antes del resumen y del codigo de salida.
try {
    foreach ($d in @("tecniabot-web", "skills", "plugins", "themes", "nucleo", "servidor", "vista-fisica", "plataforma", "conocimiento", "codegen")) {
        $path = Join-Path $ConfigDir $d
        if (Test-Path $path) {
            Get-ChildItem $path -Recurse -Directory | Where-Object { -not (Get-ChildItem $_.FullName -Recurse -File) } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
            if (-not (Get-ChildItem $path -Recurse -File -ErrorAction SilentlyContinue)) {
                Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
} catch { }

# El mensaje final tampoco afirma de mas: si algo quedo sin borrar, se dice que
# la desinstalacion fue PARCIAL y se lista que quedo y donde.
if ($Pendientes.Count -eq 0) {
    Write-Host "==> Listo. Tecnia Bot desinstalado."
} else {
    Write-Host "==> Tecnia Bot se desinstalo PARCIALMENTE. Quedo sin borrar:"
    foreach ($p in $Pendientes) { Write-Host "    - $p" }
    Write-Host "    Cerra OpenCode y volve a correr el desinstalador, o sacalo a mano."
}

# ---- LO QUE ESTE DESINSTALADOR NO SACA, DICHO ENTERO -------------------------
#
# Antes el cierre decia "(OpenCode y PlatformIO NO se tocaron: son
# independientes.)" y nada mas. El instalador (install\bootstrap.ps1) pone en la
# compu Scoop, OpenCode, Python, Node y PlatformIO; el lanzador crea la carpeta de
# proyectos en Documentos; y OpenCode guarda su historial aparte. Nombrar dos de
# siete es dejar a la docente creyendo que la compu quedo limpia para entregarla.
#
# Y NO SE AFIRMA DE MEMORIA: cada cosa se busca en el disco y se nombra solo si
# esta, con su ruta. Las rutas salen de donde las saca el resto del repo
# (SCOOP / USERPROFILE\scoop, PLATFORMIO_CORE_DIR y la raiz del disco del perfil,
# XDG_DATA_HOME, la carpeta de Documentos que usa el lanzador).
# Es informativo: si algo de esto falla, no cambia el codigo de salida.
function Anotar-SiEsta($lista, $ruta, $texto) {
    if (-not $ruta) { return }
    if (Test-Path -LiteralPath $ruta) { [void]$lista.Add($texto + ": " + $ruta) }
}
$Quedan = New-Object System.Collections.ArrayList
try {
    $ScoopDir = $env:SCOOP
    if (-not $ScoopDir) { $ScoopDir = Join-Path $env:USERPROFILE "scoop" }
    Anotar-SiEsta $Quedan $ScoopDir "Scoop (el instalador de programas que uso Tecnia Bot)"
    Anotar-SiEsta $Quedan (Join-Path $ScoopDir "apps\opencode") "OpenCode"
    Anotar-SiEsta $Quedan (Join-Path $ScoopDir "apps\python") "Python"
    Anotar-SiEsta $Quedan (Join-Path $ScoopDir "apps\nodejs-lts") "Node"

    $PioDirs = @()
    if ($env:PLATFORMIO_CORE_DIR) { $PioDirs += $env:PLATFORMIO_CORE_DIR }
    $PioDirs += (Join-Path $env:USERPROFILE ".platformio")
    $RaizPerfil = [System.IO.Path]::GetPathRoot($env:USERPROFILE)
    if ($RaizPerfil) { $PioDirs += (Join-Path $RaizPerfil ".platformio") }
    foreach ($pd in @($PioDirs | Select-Object -Unique)) {
        Anotar-SiEsta $Quedan $pd "PlatformIO y las herramientas de las placas (mas de 1 GB)"
    }

    $ProyDirs = @((Join-Path $env:USERPROFILE "Documents\Tecnia Bot"))
    $Documentos = [Environment]::GetFolderPath("MyDocuments")
    if ($Documentos) { $ProyDirs += (Join-Path $Documentos "Tecnia Bot") }
    foreach ($pr in @($ProyDirs | Select-Object -Unique)) {
        Anotar-SiEsta $Quedan $pr "Tus proyectos (son tuyos: aca no se tocan nunca)"
    }

    Anotar-SiEsta $Quedan $DataDir "Lo que OpenCode guarda por su cuenta (historial de las charlas, logs y sus credenciales)"

    $CopiaPrograma = Split-Path -Parent $PSScriptRoot
    Anotar-SiEsta $Quedan $CopiaPrograma "La carpeta del programa (si desinstalas desde Windows, la saca Windows al terminar)"
} catch { }

Write-Host ""
if ($Quedan.Count -gt 0) {
    Write-Host "    Esto NO lo saca este desinstalador. Lo busque en el disco y SIGUE en esta compu:"
    foreach ($q in $Quedan) { Write-Host "    - $q" }
    Write-Host "    Son programas y carpetas aparte de Tecnia Bot. Si esta compu pasa a otra persona y"
    Write-Host "    no los usas para otra cosa, hay que sacarlos a mano: aca no se tocan."
}
if ($Quedan.Count -eq 0) {
    Write-Host "    No encontre en esta compu Scoop, OpenCode, Python, Node, PlatformIO ni la carpeta de proyectos."
}

# El codigo de salida es el contrato del encabezado: 3 si quedo algo sin borrar.
if ($Pendientes.Count -gt 0) { exit 3 }
exit 0
