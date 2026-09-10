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
- Genero: (sin definir)
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

# ---- API key de Google (OPCIONAL): decide que modelo usa el agente ----
# Con una key de Google (gratis, sin tarjeta) Tecnia Bot usa Gemini. Sin key, usa
# Big Pickle, el modelo gratuito de OpenCode (provider "opencode": sin cuenta ni
# login, OpenCode lo sirve con apiKey "public"). La eleccion se escribe mas abajo
# como override del agente en opencode.json ("agent" -> "tecnia-bot" -> "model")
# y se RE-EVALUA en cada corrida (instalar, Reparar, /actualizar): si el docente
# agrega una key despues con /connect, la corrida siguiente lo pasa a Gemini.
#
# Hasta la v0.3.75 aca habia una key de Google fija, embebida en el script, que se
# usaba cuando nadie pegaba la suya. Se elimino y se roto: no queda ninguna key en
# este repo. La key que pegue el docente se guarda SOLO en el archivo de
# credenciales de OpenCode de esta compu -- nunca en el repo, nunca en git. Es
# idempotente: si ya hay una key de "google" guardada (de esta instalacion o de un
# /connect manual), no se pregunta de nuevo.
$ModeloConKey = "google/gemini-3.5-flash-lite"
$ModeloSinKey = "opencode/big-pickle"

# El id que entiende la API de Google es la parte de la DERECHA: el "google/" de
# adelante es el proveedor, y eso es sintaxis de OpenCode, no de Google. Se DERIVA
# de $ModeloConKey a proposito -- si manana cambia el modelo, la prueba de la key
# apunta sola al nuevo y no queda un id viejo escondido en una URL. Es la misma
# derivacion que MODELO_API en opencode\tool\clave.ts.
$ModeloApi = ($ModeloConKey -split "/")[-1]

# Cuanto se espera a Google antes de darse por vencido probando la key. En una
# escuela con la red filtrada el pedido no falla: se queda colgado. Quince segundos
# alcanzan para cualquier red que ande, y son quince segundos UNA vez por corrida.
$TimeoutPruebaKey = 15

# ---- La key compartida de versiones anteriores se reconoce por su SHA-256 ----
# Las instalaciones hechas con la v0.3.75 o anteriores tienen esa key en auth.json Y
# en la variable de usuario GOOGLE_GENERATIVE_AI_API_KEY. Como se roto, quedo una
# credencial MUERTA que hace fallar el primer mensaje, y el instalador -- que solo
# miraba "hay key de google" -- la daba por buena. Se la reconoce por el hash (el
# literal no vuelve a este repo) y se la quita de los dos lugares antes de decidir
# el modelo; si el docente la pega en el prompt, se rechaza por el mismo motivo.
$HashKeyVieja = "121163b85b0396edcfcc4840981d823c4f1e9c23aadc72b39c9723fef70cf3b4"
function Get-Sha256Hex($texto) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes([string]$texto)) } finally { $sha.Dispose() }
    return (($hash | ForEach-Object { $_.ToString("x2") }) -join "")
}
function Test-KeyVieja($k) {
    if (-not $k) { return $false }
    return ((Get-Sha256Hex ([string]$k)) -eq $HashKeyVieja)
}

# ---- Leer una key del teclado, con timeout -----------------------------------
#
# Esta mecanica ya estaba resuelta y esta puesta en una funcion para que la usen
# LOS DOS prompts (el de "no hay key" y el nuevo de "hay key, la cambias?"), sin
# copiarla. Lo que hace y por que, que costo encontrarlo:
#
# Timeout de 60 s: si esto corre en modo silencioso/desatendido (deploy a varias
# PCs) con una consola real pero nadie tipeando, una lectura bloqueante se
# colgaria para siempre. Start-Job/Read-Host NO sirve (un job corre en un proceso
# aislado sin consola real -> deadlock detectado por PowerShell). Un Task sobre
# [Console]::ReadLine() tampoco -- falla si no hay consola real adjunta. La
# tecnica correcta: sondear [Console]::KeyAvailable con un cronometro. Si la
# entrada esta redirigida (pipe/automatizacion), KeyAvailable tira excepcion -- en
# ese caso caemos a una lectura simple, que ahi SI es segura (un pipe nunca se
# cuelga: devuelve al toque lo que tenga, o vacio).
#
# Devuelve @{ key = "<lo tipeado, sin blancos>"; respondio = $true/$false }.
# `respondio` es $false SOLO cuando se cumplieron los segundos sin que nadie
# apretara Enter: quien decide que significa ese silencio es el que llama, y en
# este script significa SIEMPRE "no toques nada".
function Leer-KeyConTimeout($segundos) {
    $key = ""
    $recibioAlgo = $false
    try {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        while ($sw.Elapsed.TotalSeconds -lt $segundos) {
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
    } catch [System.InvalidOperationException] {
        # Consola redirigida (pipe/automatizacion): un pipe no se cuelga, leemos directo.
        $key = [Console]::In.ReadLine()
        if (-not $key) { $key = "" }
        $recibioAlgo = $true
    }
    $limpia = ""
    if ($key) { $limpia = ([string]$key).Trim() }
    return @{ key = $limpia; respondio = [bool]$recibioAlgo }
}

# ---- Probar la key CONTRA GOOGLE ---------------------------------------------
#
# EL SEGUNDO DEFECTO DEL 8 DE SEPTIEMBRE. Con la key literal "AIzaSyFALSA000..."
# este script imprimia "==> Modelo configurado: google/gemini-3.5-flash-lite
# (Gemini, con tu key de Google)". La key NUNCA se validaba: una credencial
# muerta, vencida o con la cuota agotada producia exactamente el mismo mensaje
# que una que anda. La docente leia que quedo todo configurado y se enteraba de
# que no al primer mensaje, con un error en ingles que no explica nada.
#
# Es el mismo defecto que el resto del repo persigue con nombre propio: afirmar
# sobre algo que no se miro (opencode\command\reparar.md: "Nunca digas que algo
# quedo instalado si el tool no lo dijo").
#
# CINCO RESULTADOS, y ninguno se puede confundir con otro. Son LOS MISMOS de
# probarClave() en opencode\tool\clave.ts, con los mismos criterios y en el mismo
# orden -- si los dos clasificaran distinto, el instalador y el bot le contarian
# a la misma docente dos historias diferentes de la misma key:
#
#   anda      -> Google contesto OK.
#   cuota     -> HTTP 429 / RESOURCE_EXHAUSTED. ES EL CASO DE LA ESCUELA: la key
#                es real y de la docente, lo que se acabo es el cupo gratis.
#   invalida  -> HTTP 400/403, INVALID_ARGUMENT / PERMISSION_DENIED /
#                UNAUTHENTICATED, o reason API_KEY_INVALID. La key no sirve.
#   modeloIdo -> HTTP 404 / NOT_FOUND. La key puede estar perfecta: el que no esta
#                es el MODELO. TIENE RAMA PROPIA porque el cajon de "no pude
#                probarla" le echa la culpa a la red, y aca la red anda perfecto:
#                mandaria a la docente a pelearse con el proxy de la escuela por
#                un problema que esta del otro lado y que ninguna key arregla.
#   sinProbar -> cualquier otro HTTP (un 500/503 es de Google, no de la key) o una
#                excepcion de red. NUNCA se cuenta como "anda".
#
# LA KEY VA EN EL HEADER x-goog-api-key, NO EN EL QUERY STRING. Google acepta las
# dos formas; con la del query string la key termina adentro de la URL, y la URL
# termina adentro del texto de cualquier excepcion de red. Este repo ya tuvo esa
# fuga con el proxy de la escuela (por eso el [regex]::Replace de
# diagnostico.ps1). El header la deja afuera de todo lo que se pueda imprimir por
# accidente, que es mas barato que acordarse de tapar la fuga en cada mensaje.
#
# Del cuerpo de la respuesta se sacan SOLO dos cosas: error.status y los reason de
# error.details, que son tokens de una lista cerrada. El cuerpo entero no se
# imprime nunca, y del texto de una excepcion no se imprime NADA salvo su tipo.
function Clasificar-RespuestaGoogle($codigo, $cuerpo) {
    $status = ""
    $razones = @()
    if ($cuerpo) {
        try {
            $json = $cuerpo | ConvertFrom-Json
            if ($json.error) {
                if ($json.error.status) { $status = [string]$json.error.status }
                if ($json.error.details) {
                    foreach ($d in @($json.error.details)) {
                        if ($d.reason) { $razones += [string]$d.reason }
                    }
                }
            }
        } catch {
            # Un cuerpo que no es JSON (la pagina del proxy de la escuela, por
            # ejemplo) no aporta nada: el codigo HTTP alcanza para clasificar.
        }
    }
    if ($codigo -eq 429 -or $status -eq "RESOURCE_EXHAUSTED") { return @{ resultado = "cuota"; detalle = "" } }
    if ($codigo -eq 400 -or $codigo -eq 403 -or $status -eq "INVALID_ARGUMENT" -or $status -eq "PERMISSION_DENIED" -or $status -eq "UNAUTHENTICATED" -or ($razones -contains "API_KEY_INVALID")) {
        return @{ resultado = "invalida"; detalle = "" }
    }
    # El modelo, no la key. Va ANTES del cajon de sinProbar a proposito.
    if ($codigo -eq 404 -or $status -eq "NOT_FOUND") { return @{ resultado = "modeloIdo"; detalle = "" } }
    return @{ resultado = "sinProbar"; detalle = "Google contesto HTTP $codigo" }
}

function Probar-KeyGoogle($clave) {
    if (-not $clave) { return @{ resultado = "sinProbar"; detalle = "no hay key que probar" } }
    $url = "https://generativelanguage.googleapis.com/v1beta/models/" + $ModeloApi + ":generateContent"
    # El pedido mas chico que sirve de prueba: una palabra y un token de respuesta.
    # No es gratis (consume una llamada del cupo), pero preguntarle a Google es la
    # unica forma de saber, y no preguntar es justamente el defecto que arreglamos.
    $cuerpoPedido = '{"contents":[{"parts":[{"text":"ping"}]}],"generationConfig":{"maxOutputTokens":1}}'
    # Se guarda y se restaura, como hace Buscar-Pio mas abajo: aca queremos que
    # Invoke-WebRequest TIRE la excepcion para poder leerle el codigo HTTP a la
    # respuesta, y que un error no se lleve puesto el instalador entero.
    # (No se toca $LASTEXITCODE: aca no se invoca ningun comando nativo.)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Stop"
    try {
        # Windows 10 sin actualizar negocia TLS 1.0 por defecto y Google lo rechaza
        # hace anios: sin esto el pedido muere con una excepcion de "conexion
        # cerrada" que parece falta de red y no lo es. Best-effort.
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        } catch { }
        try {
            $resp = Invoke-WebRequest -Uri $url -Method Post -UseBasicParsing -TimeoutSec $TimeoutPruebaKey `
                -ContentType "application/json" `
                -UserAgent "tecnia-bot-instalador" `
                -Headers @{ "x-goog-api-key" = [string]$clave } `
                -Body $cuerpoPedido
            $codigo = [int]$resp.StatusCode
            if ($codigo -ge 200 -and $codigo -lt 300) { return @{ resultado = "anda"; detalle = "" } }
            return (Clasificar-RespuestaGoogle $codigo "")
        } catch {
            # Un HTTP de error llega como excepcion con la respuesta adentro; una
            # caida de red llega sin respuesta. Los dos casos son distintos y no se
            # pueden mezclar: uno dice algo de la key, el otro no dice nada.
            $ex = $_.Exception
            $codigo = 0
            $textoRespuesta = ""
            $r = $null
            try { $r = $ex.Response } catch { $r = $null }
            if ($r) {
                try { $codigo = [int]$r.StatusCode } catch { $codigo = 0 }
                try {
                    $lector = New-Object System.IO.StreamReader($r.GetResponseStream())
                    try { $textoRespuesta = $lector.ReadToEnd() } finally { $lector.Dispose() }
                } catch {
                    $textoRespuesta = ""
                }
            }
            if ($codigo -eq 0) {
                # Timeout, DNS que no resuelve, el filtro de contenido de la escuela
                # que corta. Se informa el TIPO de excepcion, NUNCA su mensaje: el
                # mensaje se lleva puesta la URL, o el proxy con su usuario:clave.
                $tipo = $ex.GetType().Name
                try { if ($ex.Status) { $tipo = "$tipo/$($ex.Status)" } } catch { }
                return @{ resultado = "sinProbar"; detalle = "no hubo respuesta ($tipo)" }
            }
            return (Clasificar-RespuestaGoogle $codigo $textoRespuesta)
        }
    } finally {
        $ErrorActionPreference = $prev
    }
}

if ($env:XDG_DATA_HOME) {
    $DataDir = Join-Path $env:XDG_DATA_HOME "opencode"
} else {
    $DataDir = Join-Path $env:USERPROFILE ".local\share\opencode"
}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$AuthFile = Join-Path $DataDir "auth.json"

# ---- Curar un auth.json con BOM ---------------------------------------------
#
# ESTO NO ES PARANOIA: es el bucle que dejaba maquinas muertas para siempre.
#
# Las instalaciones anteriores a la v0.3.55 escribian este archivo con
# `Set-Content -Encoding UTF8`, que en PowerShell 5.1 mete BOM. Y el BOM crea una
# asimetria letal entre quien escribe y quien lee:
#
#   PowerShell (Get-Content -Raw)  ->  SACA el BOM solo. El archivo le parece
#                                      perfecto y ve una key valida.
#   OpenCode   (JSON.parse)        ->  NO lo saca. Rechaza el archivo entero y se
#                                      traga el error sin avisar.
#
# Entonces el instalador leia, veia una key sana, concluia "ya esta configurado" y
# NO TOCABA NADA. Reinstalar no servia. Actualizar no servia. La maquina quedaba
# con el bot abriendo perfecto y fallando al primer mensaje, y ninguna cantidad de
# reinstalaciones podia arreglarlo, porque cada una confirmaba que estaba bien.
#
# Se detecto instalando de cero en una VM: el auth.json tenia fecha de una semana
# antes que el resto de los archivos. La instalacion nueva lo habia respetado.
#
# Por eso se miran los BYTES y no el texto: es la unica forma de ver lo que ve
# OpenCode. Y si aparece el BOM, se reescribe conservando el contenido -- la key
# del docente no se pierde.
if (Test-Path $AuthFile) {
    $bytes = [System.IO.File]::ReadAllBytes($AuthFile)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        Write-Host "  [i] El archivo de credenciales tenia BOM y OpenCode no podia leerlo. Corrigiendo..."
        $texto = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
        [System.IO.File]::WriteAllText($AuthFile, $texto, (New-Object System.Text.UTF8Encoding $false))
    }
}

$authData = $null
if (Test-Path $AuthFile) {
    try { $authData = Get-Content $AuthFile -Raw | ConvertFrom-Json } catch { $authData = $null }
}
if (-not $authData) { $authData = [PSCustomObject]@{} }

$tieneGoogle = [bool](($authData.PSObject.Properties.Name -contains "google") -and $authData.google.key)

# Purga de la key compartida vieja (ver arriba): auth.json y variable de usuario.
$purgada = $false
if ($tieneGoogle -and (Test-KeyVieja $authData.google.key)) {
    $authData.PSObject.Properties.Remove("google")
    # Se reescribe SIN BOM y preservando los otros providers que tenga el archivo.
    [System.IO.File]::WriteAllText($AuthFile, ($authData | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
    $tieneGoogle = $false
    $purgada = $true
}
$envKeyActual = [Environment]::GetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", "User")
if (Test-KeyVieja $envKeyActual) {
    [Environment]::SetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", $null, "User")
    $purgada = $true
}
if ($purgada) {
    Write-Host "  [i] Se quito la key de respaldo compartida que traian las versiones anteriores (ya no es valida)."
}

# ---------------------------------------------------------------------------
# LA PREGUNTA POR LA KEY: TRES CAMINOS, Y EL DEFAULT SIEMPRE ES CONSERVAR
# ---------------------------------------------------------------------------
#
# Hasta la v0.3.78 habia DOS caminos: "no hay key -> preguntar" y "hay key -> no
# hacer nada". El segundo era una trampa sin salida.
#
# EL CASO REAL (escuela Juana Manso, 8 de septiembre de 2026). Varias docentes con
# la cuota de Google agotada corrieron "Reparar Tecnia Bot" para poder pegar una
# key nueva, y el instalador NUNCA se las pidio: la pregunta vivia adentro de
# `elseif (-not $tieneGoogle)`, o sea que en una compu que ya tiene key la rama que
# pregunta no se ejecuta, y no importa cuantas veces se corra Reparar. Probaron con
# keys de otras cuentas y vieron el mismo error de siempre: las keys nuevas nunca
# entraron. Reproducido en la VM de Windows 10: con key guardada no pregunta y
# auth.json ni se toca (misma fecha de modificacion antes y despues). Ese detalle
# es el que permite diagnosticarlo a distancia. Esta contado entero en
# docs\key-de-google.md.
#
# La idempotencia se puso por una buena razon -- no molestar al docente en cada
# actualizacion con algo que ya contesto -- pero se convirtio en una trampa justo
# para el caso en que HAY que rotar la key. Ahora hay un tercer camino: "hay key ->
# ofrecer cambiarla, con Enter para dejarla". Y una regla que no se negocia:
#
#   ENTER, TIMEOUT O CONSOLA SIN NADIE = SE DEJA LA QUE ESTA.
#
# Nunca se borra ni se pisa una key que funciona porque nadie contesto. Este script
# corre con la salida pipeada desde /actualizar y /reparar (Bun.spawn(..., {
# stdout: "pipe", stderr: "pipe" }) en actualizar.ts y platformio.ts): por esa via
# NO HAY NADIE que pueda tipear, y el silencio tiene que significar "dejala como
# esta", no "borrala". Para la docente que esta adentro del bot esta el comando
# /clave, que es el unico que puede conversar.
$keyFinal = ""
$pruebaKey = $null
$preguntar = $true

if ($env:TECNIA_SIN_PROMPT) {
    # TECNIA_SIN_PROMPT: la CI (y cualquier despliegue desatendido) la define para
    # que este script no pregunte NADA. Sin key guardada se sigue sin key; con una
    # key guardada se deja la que esta. Sin la variable, el sondeo de teclado espera
    # 60 s en una consola sin nadie. La pregunta sigue existiendo para el docente:
    # solo se saltea cuando la variable esta definida, y saltearla NUNCA borra nada.
    $preguntar = $false
    Write-Host ""
    if ($tieneGoogle) {
        Write-Host "  [i] TECNIA_SIN_PROMPT esta definida: no se pregunta nada y se deja la key de Google que ya estaba."
    }
    if (-not $tieneGoogle) {
        Write-Host "  [i] TECNIA_SIN_PROMPT esta definida: no se pregunta la key de Google, se sigue sin key."
    }
}

if ($preguntar) {
    Write-Host ""
    if ($tieneGoogle) {
        # EL CAMINO NUEVO. El texto nombra la cuota por PROYECTO porque es lo que
        # mas confunde y lo que hizo perder una tarde entera en la escuela: crear
        # una key nueva en el MISMO proyecto de Google no da cuota nueva.
        Write-Host "==> Ya hay una key de Google guardada en esta compu."
        Write-Host "    Si se te agoto la cuota, esta es la ocasion de cambiarla. OJO: la cuota gratuita de"
        Write-Host "    Google es por PROYECTO, no por key -- una key nueva del MISMO proyecto da el mismo"
        Write-Host "    error. Sacate una de otro proyecto (o de otra cuenta): https://aistudio.google.com/apikey"
        Write-Host "    Enter para dejarla como esta, o pega una nueva para reemplazarla [60s]:"
    }
    if (-not $tieneGoogle) {
        Write-Host "==> API key de Google (OPCIONAL). Con una key gratis (sin tarjeta) Tecnia Bot usa Gemini."
        Write-Host "    Sacala en: https://aistudio.google.com/apikey (1 minuto, con cualquier cuenta de Google)"
        Write-Host "    Se guarda en ESTA compu, nunca se comparte ni sube a ningun lado."
        Write-Host "    Pegala aca, o Enter para seguir sin key: Tecnia Bot va a usar el modelo gratuito Big Pickle de OpenCode [60s]:"
    }
    $lectura = Leer-KeyConTimeout 60
    $keyFinal = [string]$lectura.key
    if (-not $lectura.respondio -and -not $keyFinal) {
        Write-Host ""
        if ($tieneGoogle) {
            Write-Host "  [i] Sin respuesta en 60s -- se deja la key que ya estaba guardada (no se toco nada)."
        }
        if (-not $tieneGoogle) {
            Write-Host "  [i] Sin respuesta en 60s -- seguimos sin key."
        }
    }
}

# ---- Que se hace con lo que se leyo (o con lo que no se leyo) ----------------
if ($keyFinal -and (Test-KeyVieja $keyFinal)) {
    # La pego de algun apunte viejo: es la key compartida rotada. No se guarda.
    Write-Host "  [X] Esa es la key de respaldo compartida de versiones anteriores: ya no es valida y no se guarda."
    Write-Host "      Consegui la tuya en https://aistudio.google.com/apikey"
    if ($tieneGoogle) {
        Write-Host "      Se deja la key que ya estaba guardada: no se piso nada."
    }
    if (-not $tieneGoogle) {
        Write-Host "      (seguimos sin key por ahora)."
    }
} elseif ($keyFinal) {
    # PROBAR ANTES DE GUARDAR, y guardar igual salvo un caso.
    #
    # Lo UNICO que impide guardar es que Google la RECHACE explicitamente (400/403
    # / API_KEY_INVALID): eso casi siempre es una key cortada al copiar -- son
    # larguisimas -- y pisar con eso la key que ya estaba seria cambiarle un
    # problema por otro peor.
    #
    # Todo lo demas SE GUARDA y se informa. "No pude probarla" NO es motivo para
    # rechazar nada: si la red de la escuela no llega a Google, no sabemos NADA de
    # la key, y una instalacion no puede quedarse a medias porque el proxy filtra.
    # Y una cuota agotada es una key REAL de la docente: guardarla no la deja peor
    # que antes, y el mensaje de abajo le dice exactamente que hacer.
    #
    # (Aca esta la unica diferencia deliberada con probarClave() de clave.ts: alla
    # la prueba ademas DECIDE si guardar, porque alla hay una conversacion donde
    # ofrecer Big Pickle y volver a pedir la key. Aca, muchas veces, no hay nadie.
    # La CLASIFICACION es identica; lo que cambia es que con ella se hace.)
    Write-Host "  [i] Probando la key contra Google (hasta $TimeoutPruebaKey s)..."
    $pruebaNueva = Probar-KeyGoogle $keyFinal
    $rechazada = ($pruebaNueva.resultado -eq "invalida")
    if ($rechazada) {
        Write-Host "  [X] Probe esa key contra Google y la RECHAZO: no es una key valida, asi que no la guarde."
        Write-Host "      Fijate de copiarla entera (son largas y a veces se corta al copiar), o saca una nueva"
        Write-Host "      en https://aistudio.google.com/apikey y volve a correr 'Reparar Tecnia Bot'."
        if ($tieneGoogle) {
            Write-Host "      Quedo la key que ya estaba guardada: no se piso nada."
        }
    }
    if (-not $rechazada) {
        $authData | Add-Member -NotePropertyName "google" -NotePropertyValue @{ type = "api"; key = $keyFinal } -Force
        # SIN BOM, y esto es un bloqueante que estuvo silencioso.
        #
        # `Set-Content -Encoding UTF8` en PowerShell 5.1 -- el que trae Windows 10 --
        # escribe UTF-8 CON BOM. OpenCode lee este archivo con JSON.parse, que revienta
        # con BOM, y se traga el error: se queda sin credencial y NO AVISA NADA.
        #
        # El docente ve la instalacion perfecta, el bot abre con su logo y su agente, y
        # al primer mensaje: error de proveedor. Cero pistas.
        #
        # Este archivo era el unico que quedaba mal: las otras cuatro escrituras de
        # este script ya usan WriteAllText por exactamente esta razon, y lo dicen en
        # sus comentarios. Se sabia, y justo el de las credenciales quedo afuera.
        [System.IO.File]::WriteAllText($AuthFile, ($authData | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
        [Environment]::SetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", $keyFinal, "User")
        $tieneGoogle = $true
        # La key nueva ya quedo probada: no se la vuelve a probar mas abajo. Una
        # llamada por corrida y no dos -- cada prueba consume una del cupo gratis.
        $pruebaKey = $pruebaNueva
        Write-Host "  [OK] Key guardada en esta compu."
    }
} else {
    # Enter, timeout, consola sin nadie, o TECNIA_SIN_PROMPT. NO SE TOCA NADA: ni
    # auth.json ni la variable de entorno. Si habia una key sigue estando; si no
    # habia, no hay. Este es el default seguro, y es el que mas importa: un bug aca
    # le borra la key a una escuela entera sin que nadie haya pedido nada.
    if ($tieneGoogle) {
        Write-Host "  [i] Se deja la key de Google que ya estaba guardada."
    }
    if (-not $tieneGoogle) {
        Write-Host "  [i] Seguimos sin key de Google."
    }
}

# ---- Probar la key que QUEDO, sea la nueva o la de siempre -------------------
#
# Este es el punto 3 del analisis de docs\key-de-google.md: validar antes de
# afirmar que quedo configurada. Se prueba la key EFECTIVA, no la que se tipeo:
# si el docente apreto Enter, la efectiva es la que ya estaba -- y es exactamente
# la que se quedo sin cuota el 8 de septiembre. Sin esto, Reparar seguiria
# terminando con un "quedo todo bien" sobre una credencial muerta.
$keyEfectiva = ""
if ($tieneGoogle) { $keyEfectiva = [string]$authData.google.key }
if ($tieneGoogle -and $null -eq $pruebaKey) {
    Write-Host "  [i] Probando la key guardada contra Google (hasta $TimeoutPruebaKey s)..."
    $pruebaKey = Probar-KeyGoogle $keyEfectiva
}

# Modelo del agente segun la decision de arriba. Se imprime SIEMPRE (tambien cuando
# la key ya estaba guardada), para que quede claro con que modelo quedo esta compu y
# como cambiarlo despues.
if ($tieneGoogle) {
    $ModeloElegido = $ModeloConKey
    # Antes aca decia, siempre y sin haber mirado nada, "(Gemini, con tu key de
    # Google)". Ahora se dice lo que Google contesto, y NADA MAS que eso: la unica
    # rama que afirma que anda es la que recibio un OK. "No pude probarla" no es
    # "anda" -- un OK falso es peor que un error, porque manda a buscar el problema
    # al lugar equivocado y el docente se va tranquilo con todo roto.
    Write-Host "==> Modelo configurado: $ModeloElegido"
    $resultadoKey = ""
    $detalleKey = ""
    if ($pruebaKey) {
        $resultadoKey = [string]$pruebaKey.resultado
        $detalleKey = [string]$pruebaKey.detalle
    }
    if ($resultadoKey -eq "anda") {
        Write-Host "    Probe tu key contra Google y respondio bien: Gemini quedo andando."
    }
    if ($resultadoKey -eq "cuota") {
        Write-Host "    OJO: probe tu key y Google dice que la CUOTA GRATUITA de ese proyecto esta agotada."
        Write-Host "    No rompiste nada y la key sigue siendo tuya, pero hasta que se renueve (se renueva sola)"
        Write-Host "    Tecnia Bot va a fallar al primer mensaje. Lo que mas confunde: la cuota gratuita de Google"
        Write-Host "    es por PROYECTO, no por key -- una key nueva del MISMO proyecto da el mismo error."
        Write-Host "    Saca una de OTRO proyecto (o de otra cuenta) en https://aistudio.google.com/apikey"
        Write-Host "    y pegala con /clave adentro de Tecnia Bot, o volve a correr 'Reparar Tecnia Bot'."
        Write-Host "    Si necesitas seguir trabajando ya mismo, /clave tambien te pasa al modelo gratuito Big Pickle."
    }
    if ($resultadoKey -eq "invalida") {
        Write-Host "    OJO: probe la key guardada y Google la RECHAZO: no sirve."
        Write-Host "    Escribi /clave adentro de Tecnia Bot para pegar una nueva, o saca una en"
        Write-Host "    https://aistudio.google.com/apikey y volve a correr 'Reparar Tecnia Bot'."
    }
    if ($resultadoKey -eq "modeloIdo") {
        Write-Host "    OJO: la key esta bien -- el que no esta es el MODELO. Google dice que $ModeloApi ya no"
        Write-Host "    esta disponible; pasa cuando retiran o renombran un modelo."
        Write-Host "    NO es tu computadora, NO es tu key y NO es la red: no hay key nueva que lo arregle."
        Write-Host "    Hace falta una version de Tecnia Bot que apunte a un modelo vigente: escribi /actualizar."
    }
    if ($resultadoKey -ne "anda" -and $resultadoKey -ne "cuota" -and $resultadoKey -ne "invalida" -and $resultadoKey -ne "modeloIdo") {
        Write-Host "    NO pude probar la key contra Google ($detalleKey), asi que NO se si anda."
        Write-Host "    Suele ser la red: sin internet, o el filtro de la escuela bloqueando a Google."
        Write-Host "    La instalacion siguio igual y la key quedo donde estaba: no se toco nada."
        Write-Host "    Si al primer mensaje ves un error, escribi /clave adentro de Tecnia Bot para probarla de nuevo."
    }
} else {
    $ModeloElegido = $ModeloSinKey
    Write-Host "==> Modelo configurado: $ModeloElegido (Big Pickle, el modelo gratuito de OpenCode)."
    Write-Host "    Es gratis por tiempo limitado y no pide cuenta. OJO: mientras dure la etapa gratuita,"
    Write-Host "    OpenCode puede usar lo que se escribe en el chat para mejorar el modelo."
    Write-Host "    No pongas datos personales (ni nombres de alumnos) en la conversacion."
    Write-Host "    Para pasar a Gemini: consegui una key en https://aistudio.google.com/apikey y corre"
    Write-Host "    'Reparar Tecnia Bot' desde el menu inicio (te la va a pedir), o pegala con /connect"
    Write-Host "    dentro de OpenCode y despues corre /actualizar (o Reparar) para aplicar el cambio."
}
Write-Host ""

# ---- Config de OpenCode: theme violeta + plugin del logo + agente por defecto + modelo ----
# Mergeamos con la config que ya tenga el docente (ej: provider/model de /connect):
# NO la pisamos. Usamos ConvertFrom-Json / ConvertTo-Json nativos (sin dependencias).
# El theme y el plugin de TUI van en tui.json (opencode migra y borra esas claves de
# opencode.json). El agente por defecto y el modelo del agente van en opencode.json.
Write-Host ""
Write-Host "==> Configurando OpenCode (theme + logo + agente por defecto + modelo)..."

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

# --- opencode (json/jsonc): default_agent + modelo del agente (preserva las demas claves) ---
$ocHasContent = Test-HasContent $OpencodeJson
$oc = Read-JsonObject $OpencodeJson
if ($ocHasContent -and $null -eq $oc) {
    Write-Host "  [AVISO] No pude parsear ${OpencodeJson}: lo dejo intacto."
    Write-Host "          Agregale a mano `"default_agent`": `"$TecniaAgent`", `"autoupdate`": false y el modelo del agente:"
    Write-Host "          `"agent`": { `"$TecniaAgent`": { `"model`": `"$ModeloElegido`" } }"
} else {
    if (-not $oc) { $oc = [PSCustomObject]@{} }
    if (-not ($oc.PSObject.Properties.Name -contains '$schema')) {
        $oc | Add-Member -NotePropertyName '$schema' -NotePropertyValue $OpencodeSchema -Force
    }
    $oc | Add-Member -NotePropertyName "default_agent" -NotePropertyValue $TecniaAgent -Force
    # autoupdate = false: OpenCode se actualiza SOLO ante cualquier version "patch" nueva
    # (cli/upgrade.ts) y para Scoop lo hace con `scoop install opencode@<nueva>`, que es
    # una instalacion explicita y NO respeta `scoop hold` (el hold solo frena `scoop update`).
    # Visto en la VM: una hora despues de fijar 1.18.18 corria 1.18.29 y el install.json
    # habia perdido el hold. La version la decide install/OPENCODE_VERSION, no OpenCode.
    $oc | Add-Member -NotePropertyName "autoupdate" -NotePropertyValue $false -Force

    # agent.tecnia-bot.model: el modelo elegido arriba (Gemini con key, Big Pickle sin).
    # ESTA ES LA UNICA FUENTE DEL MODELO. El modelo NO va en el frontmatter de
    # opencode/agent/tecnia-bot.md porque el .md gana sobre opencode.json: OpenCode
    # hace mergeDeep(config.agent, agentes .md) (config.ts), o sea que un "model:" en
    # el frontmatter pisaria esto y Big Pickle nunca correria. Lo escribe el
    # instalador; las demas claves que el docente tenga en "agent" (otros agentes,
    # u otras opciones de tecnia-bot) se preservan.
    $agentes = $null
    if (($oc.PSObject.Properties.Name -contains "agent") -and ($oc.agent -is [PSCustomObject])) {
        $agentes = $oc.agent
    }
    if ($null -eq $agentes) { $agentes = [PSCustomObject]@{} }
    $agenteTecnia = $null
    if (($agentes.PSObject.Properties.Name -contains $TecniaAgent) -and ($agentes.$TecniaAgent -is [PSCustomObject])) {
        $agenteTecnia = $agentes.$TecniaAgent
    }
    if ($null -eq $agenteTecnia) { $agenteTecnia = [PSCustomObject]@{} }
    $agenteTecnia | Add-Member -NotePropertyName "model" -NotePropertyValue $ModeloElegido -Force
    $agentes | Add-Member -NotePropertyName $TecniaAgent -NotePropertyValue $agenteTecnia -Force
    $oc | Add-Member -NotePropertyName "agent" -NotePropertyValue $agentes -Force

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
    Write-Host "  [OK] $(Split-Path $OpencodeJson -Leaf) actualizado (agente por defecto + modelo $ModeloElegido + perfil + memoria)."
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

# ----------------------------------------------------------------------------
# DONDE VIVE PlatformIO: TRES LUGARES DONDE BUSCAR, no uno.
#
# Es la MISMA leccion que el lanzador (installer\abrir-tecnia-bot.cmd) aprendio
# buscando OpenCode, y la tercera vez que muerde en este repo.
#
# EL CASO REAL (escuela Juana Manso, 2026-09-08). La usuaria de Windows se llama
# `Direccion310` -- con `o` acentuada, que NO es ASCII. PlatformIO Core no soporta
# rutas con caracteres no-ASCII (sus toolchains de gcc se rompen), asi que en
# Windows RELOCALIZA su core_dir a la raiz del disco: C:\.platformio en vez de
# C:\Users\Direccion310\.platformio. Aca eso tenia DOS consecuencias: no se
# agregaba nada al PATH (asi que `pio` pelado en la terminal no andaba) y el
# chequeo final decia "[FALTA] PlatformIO no esta instalado" con PlatformIO
# instalado y contestando.
#
# Orden de busqueda:
#   1. $env:PLATFORMIO_CORE_DIR, si el usuario la seteo (lo explicito gana)
#   2. $USERPROFILE\.platformio            (la instalacion normal)
#   3. la raiz del disco de $USERPROFILE   <- el caso de arriba
#   4. C:\.platformio fijo, por si el perfil vive en otro disco
#   5. el PATH (`pio` y `platformio`)
#
# ESTA LOGICA ESTA REPETIDA en bootstrap.ps1, diagnostico.ps1, bootstrap.sh,
# install.sh y opencode\tool\platformio.ts, A PROPOSITO: ninguno de los .ps1 hace
# dot-sourcing de otro, cada uno se copia y corre SOLO. Lo que mantiene honestas a
# las copias es tests/platformio-pio.test.mjs.
function Rutas-PioCore {
    $dirs = @()
    if ($env:PLATFORMIO_CORE_DIR) { $dirs += $env:PLATFORMIO_CORE_DIR }
    $dirs += (Join-Path $env:USERPROFILE ".platformio")
    # GetPathRoot("C:\Users\Direccion310") devuelve "C:\": la raiz del disco donde
    # vive el perfil, que es adonde PlatformIO se muda cuando el nombre no es ASCII.
    $raiz = [System.IO.Path]::GetPathRoot($env:USERPROFILE)
    if ($raiz) { $dirs += (Join-Path $raiz ".platformio") }
    $dirs += "C:\.platformio"
    return ($dirs | Select-Object -Unique)
}

# La carpeta penv\Scripts que hay que agregar al PATH, o $null si no hay ninguna.
# Se miran pio.exe Y platformio.exe: normalmente estan los dos, pero el instalador
# oficial nombra platformio.exe en su mensaje final y no queremos depender de que
# exista justo el que elegimos nosotros.
function Buscar-PioScripts {
    foreach ($dir in (Rutas-PioCore)) {
        $scripts = Join-Path $dir "penv\Scripts"
        foreach ($nombre in @("pio.exe", "platformio.exe")) {
            if (Test-Path (Join-Path $scripts $nombre)) { return $scripts }
        }
    }
    return $null
}

# El pio que ADEMAS contesta --version. Misma regla que Buscar-Python en
# bootstrap.ps1: a un candidato se le pregunta, no se supone por donde vive. Cuesta
# un segundo, corre una sola vez, y atrapa un venv a medio armar. (El tool
# platformio.ts NO pregunta: esta en el camino caliente y le alcanza con que el
# archivo exista. La asimetria es deliberada.)
#
# 2>&1 de un comando nativo con $ErrorActionPreference = "Stop" revienta en
# PowerShell 5.1: se baja a Continue solo para preguntar.
function Buscar-Pio {
    $candidatos = @()
    foreach ($dir in (Rutas-PioCore)) {
        foreach ($nombre in @("pio.exe", "platformio.exe")) {
            $candidatos += (Join-Path $dir "penv\Scripts\$nombre")
        }
    }
    foreach ($c in (Get-Command -Name pio, platformio -All -CommandType Application -ErrorAction SilentlyContinue)) {
        if ($c.Source) { $candidatos += $c.Source }
    }
    foreach ($ruta in $candidatos) {
        if (-not $ruta) { continue }
        if (-not (Test-Path $ruta)) { continue }
        $prev = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $global:LASTEXITCODE = 0
            $v = (& $ruta --version 2>&1 | Out-String)
            if ($LASTEXITCODE -eq 0 -and $v -match "PlatformIO") { return $ruta }
        } catch { } finally { $ErrorActionPreference = $prev }
    }
    return $null
}

# pio en el PATH del usuario (comodidad: que 'pio' funcione pelado en la terminal).
# PlatformIO deja pio en su venv privado (penv\Scripts), fuera del PATH.
# Tecnia Bot lo encuentra por ruta completa igual; esto es para uso manual. Corre en
# cada install/actualizar (idempotente), asi le llega a todos. Cuidado: preservamos el
# tipo de registro (REG_EXPAND_SZ) y NO expandimos las %VAR% existentes, para no romper.
$PioScripts = Buscar-PioScripts
if ($PioScripts) {
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

# Chequear PlatformIO (en cualquiera de las rutas conocidas o en el PATH).
# Se dice la ruta real: si PlatformIO se relocalizo a la raiz del disco, decir solo
# "instalado" manda a mirar una carpeta que no existe.
$pioPath = Buscar-Pio
if ($pioPath) {
    Write-Host "  [OK] PlatformIO instalado en $pioPath (Tecnia Bot lo encuentra aunque no este en PATH)"
} else {
    Write-Host "  [FALTA] PlatformIO no esta instalado. Ver docs/instalacion-windows.md"
}

Write-Host ""
Write-Host "Para empezar: abri una terminal en cualquier carpeta, escribi 'opencode',"
Write-Host "apreta Tab y elegi 'tecnia-bot'."
