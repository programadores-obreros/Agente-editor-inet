# El aviso de la key de Google, ANTES de que arranque el bot.
#
# POR QUE EXISTE ESTE ARCHIVO. Se probo con Tecnia Bot corriendo de verdad en la
# VM de Windows 10: key invalida, agente en google/gemini-3.5-flash-lite, la
# docente escribe un mensaje normal. Lo unico que ve es esto:
#
#     > tecnia-bot - gemini-3.5-flash-lite
#     Error: API key not valid. Please pass a valid API key.
#
# Exit code 1. Ni la skill "errores-del-bot", ni el disparador del prompt del
# agente, ni una palabra del bot. Y NO es un bug: el error ocurre en la llamada
# al proveedor, ANTES de que el modelo genere nada. Le estabamos pidiendo AL
# MODELO que explique que el modelo esta muerto. Es imposible por construccion.
#
# Por eso el aviso vive del lado de afuera, en el lanzador
# (installer\abrir-tecnia-bot.cmd), que corre SIEMPRE, con modelo o sin modelo.
# Y la logica vive aca porque un .cmd no puede hacer HTTPS de forma decente.
#
# TRES REGLAS QUE NO SE NEGOCIAN EN ESTE ARCHIVO:
#
# 1. ESTO ES UN AVISO, NO UN PORTERO. El lanzador ignora todo lo que salga de
#    aca salvo el codigo 9 (que solo le pide unos segundos de lectura). Si este
#    script no esta, no parsea, lo bloquea la politica de la escuela o revienta a
#    mitad, el bot abre igual. Por eso TODO cuelga de un try/catch que cae a "no
#    decir nada": una docente en el aula tiene que poder abrir Tecnia Bot aunque
#    este chequeo este roto.
#
# 2. LA KEY NO SE IMPRIME NUNCA. Ni entera, ni un pedazo, ni su longitud. Es la
#    misma regla de install\diagnostico.ps1 ("ACA NO SE IMPRIME NADA DEL
#    CONTENIDO DE auth.json. Nunca.") y de opencode\tool\clave.ts. Y viaja en el
#    header x-goog-api-key, NUNCA en el query string: la URL termina adentro del
#    texto de cualquier excepcion de red, y este repo ya tuvo esa fuga con el
#    proxy de la escuela.
#
# 3. "NO PUDE PROBARLA" NO ES UN AVISO. Sin red, con timeout o con el filtro de
#    contenido de la escuela cortando, no sabemos si la key sirve: no se imprime
#    NADA. Un aviso que no dice nada, en CADA arranque de una maquina sin
#    internet, es peor que callarse. Del otro lado, "no pude probarla" tampoco es
#    "anda": aca no se afirma nunca que la key este bien, simplemente no se
#    molesta a nadie.
#
# COSTO. En una maquina sin key de Google (agente en Big Pickle) este script sale
# por donde entro sin tocar la red: cero costo. Donde SI hay key, se paga UN
# pedido a Google acotado a 6 segundos, en CADA arranque, con alguien esperando
# frente a la pantalla. Por eso el timeout es corto y duro, y no los 15 segundos
# que se puede dar el instalador (que corre una vez).
#
# Salidas:
#   0  no hay nada que decir (no aplica / la key anda / no se pudo probar)
#   9  se imprimio un aviso; el lanzador da unos segundos para leerlo
#
# HAY UN CUARTO AVISO, QUE NO TOCA LA RED: el agente en Gemini y NINGUNA key
# guardada. Es el unico caso en que se sabe, sin preguntarle nada a Google, que el
# primer mensaje va a fallar. Antes se callaba ("el diagnostico de esa maquina es
# /clave"), y /clave es justo lo que ahi no puede andar: lo atiende ese modelo.
#
# Y LA SALIDA QUE SE OFRECE ES "Reparar Tecnia Bot", NO /clave. Los avisos mandaban
# a escribir /clave adentro del bot, pero a /clave lo ejecuta el MISMO modelo cuya
# key esta muerta: era mandar a la docente a pedirle ayuda al que no contesta, que
# es exactamente el defecto que este archivo vino a sacar del medio. "Reparar
# Tecnia Bot" es un acceso del menu inicio (installer\tecnia-bot.iss) que corre el
# instalador: pide la key, la prueba y la guarda, sin modelo de por medio.
#
# La clasificacion de los cinco resultados esta REPETIDA a proposito, igual que
# en install\install.ps1, install\install.sh y opencode\tool\clave.ts: ninguno de
# los cuatro hace dot-sourcing de otro, cada uno se copia y corre solo (el .exe
# lleva unos, el menu inicio lanza otros, el lanzador lanza este). Lo que
# mantiene honestas a las copias es tests\key-instalador.test.mjs. Si aparece una
# quinta, va ahi.

$ErrorActionPreference = "Stop"

# El modelo con key, IGUAL que $ModeloConKey en install\install.ps1,
# MODELO_CON_KEY en install\install.sh y MODELO_CON_KEY en opencode\tool\clave.ts.
# Si aca dijera otra cosa, este chequeo se saltearia (o correria de mas) en la
# mitad de las maquinas. Hay un test que exige que los cuatro coincidan.
$ModeloConKey = "google/gemini-3.5-flash-lite"

# El id que entiende la API de Google es la parte de la DERECHA: el "google/" de
# adelante es el proveedor, y es sintaxis de OpenCode, no de Google. Se DERIVA a
# proposito: el dia que cambie el modelo, la prueba apunta sola al nuevo y no
# queda un id viejo escondido en una URL diciendo "actualiza Tecnia Bot" con
# Tecnia Bot al dia.
$ModeloApi = ($ModeloConKey -split "/")[-1]

# El agente cuyo modelo se mira. Mismo id que $TecniaAgent en install.ps1.
$AgenteTecnia = "tecnia-bot"

# SEIS SEGUNDOS, y no los 15 del instalador. Esto se paga en cada arranque de
# cada maquina con key, con un docente mirando una pantalla en blanco. En una red
# filtrada el pedido no falla: se queda colgado, y ahi el timeout es lo unico que
# devuelve la maquina.
$TimeoutChequeoKey = 6

# ---- Donde vive la config y donde viven las credenciales ---------------------
#
# MISMO criterio que install.ps1, bootstrap.ps1, diagnostico.ps1, el lanzador y
# clave.ts. Si aca se mirara siempre %USERPROFILE%, en una maquina con XDG puesto
# leeriamos un archivo que OpenCode no usa: veriamos "Big Pickle" (y no
# avisariamos nunca) o una key que no es la que corre.
function Get-DirConfigOpencode {
    if ($env:XDG_CONFIG_HOME) { return (Join-Path $env:XDG_CONFIG_HOME "opencode") }
    return (Join-Path $env:USERPROFILE ".config\opencode")
}

function Get-DirDatosOpencode {
    if ($env:XDG_DATA_HOME) { return (Join-Path $env:XDG_DATA_HOME "opencode") }
    return (Join-Path $env:USERPROFILE ".local\share\opencode")
}

# OpenCode acepta las DOS extensiones y prueba [opencode.json, opencode.jsonc]:
# se prefiere .json si estan las dos, igual que el, que el instalador y que
# clave.ts. Mirar la que no es deja el chequeo leyendo un archivo muerto.
function Get-RutaConfigOpencode($cfgDir) {
    $json = Join-Path $cfgDir "opencode.json"
    if (Test-Path $json) { return $json }
    $jsonc = Join-Path $cfgDir "opencode.jsonc"
    if (Test-Path $jsonc) { return $jsonc }
    return $json
}

# ---- Leer un JSON SACANDOLE EL BOM -------------------------------------------
#
# EL BOM ES EL BUG QUE DEJABA MAQUINAS MUERTAS PARA SIEMPRE, y esta contado
# entero en install\install.ps1 y en opencode\tool\clave.ts. El resumen: las
# instalaciones anteriores a la 0.3.55 escribian auth.json con
# `Set-Content -Encoding UTF8`, que en PowerShell 5.1 mete BOM, y ahi se abre una
# asimetria letal -- PowerShell (Get-Content -Raw) lo saca solo y ve una key
# perfecta; OpenCode (JSON.parse) NO lo saca y rechaza el archivo entero.
#
# Aca se leen los BYTES por el mismo motivo: es la unica forma de ver lo que ve
# OpenCode. Pero, a diferencia del instalador, este script NO CURA NADA: corre
# medio segundo antes de que el bot abra y no es momento de reescribirle
# credenciales a nadie. Si el archivo no se puede leer, no se dice nada -- que es
# exactamente lo que corresponde: no sabemos.
#
# Devuelve @{ estado; datos }. Los TRES estados son los de leerJson() en clave.ts:
#   no-existe  el archivo no esta, o esta vacio
#   ilegible   esta y no se pudo leer o no parsea  <- NO es lo mismo que "no hay"
#   ok         se leyo; `datos` es el objeto
# La diferencia entre los dos primeros es la que habilita el aviso de "no hay
# ninguna key": con un auth.json que no se pudo leer NO SABEMOS si hay key, y de lo
# que no se sabe aca no se dice nada.
function Read-JsonSinBom($ruta) {
    if (-not (Test-Path $ruta)) { return @{ estado = "no-existe"; datos = $null } }
    try {
        $bytes = [System.IO.File]::ReadAllBytes($ruta)
        if ($bytes.Length -eq 0) { return @{ estado = "no-existe"; datos = $null } }
        $desde = 0
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $desde = 3 }
        $texto = [System.Text.Encoding]::UTF8.GetString($bytes, $desde, $bytes.Length - $desde)
        if (-not $texto.Trim()) { return @{ estado = "no-existe"; datos = $null } }
        $objeto = $texto | ConvertFrom-Json
        if ($null -eq $objeto) { return @{ estado = "ilegible"; datos = $null } }
        return @{ estado = "ok"; datos = $objeto }
    } catch {
        # Un .jsonc con comentarios cae aca, y esta bien: no los sacamos nosotros.
        return @{ estado = "ilegible"; datos = $null }
    }
}

# El modelo que HOY tiene escrito el agente, o "" si no hay. Es la unica fuente
# del modelo: el frontmatter de opencode\agent\tecnia-bot.md no lo declara a
# proposito (OpenCode mezcla los .md ENCIMA de opencode.json y pisaria el
# override).
function Get-ModeloDelAgente($cfgDir) {
    $oc = (Read-JsonSinBom (Get-RutaConfigOpencode $cfgDir)).datos
    if ($null -eq $oc) { return "" }
    try {
        if ($oc.agent -and $oc.agent.$AgenteTecnia -and $oc.agent.$AgenteTecnia.model) {
            return [string]$oc.agent.$AgenteTecnia.model
        }
    } catch { }
    return ""
}

# La key de Google que va a usar OpenCode, o "" si no hay. NUNCA se imprime.
#
# La variable de entorno va PRIMERO porque LE GANA a auth.json (es lo que
# documenta clave.ts, y el instalador escribe las dos justamente para que no se
# separen). Probar auth.json cuando la que manda es la variable seria clasificar
# una key que no corre.
#
# Devuelve @{ hay; valor }, con `hay` en tres estados:
#   si     hay una key (en la variable o en auth.json); `valor` la trae
#   no     se miraron los dos lugares y NO hay ninguna
#   no-se  auth.json esta pero no se pudo leer: puede haber una adentro
function Get-KeyDeGoogle($datosDir) {
    if ($env:GOOGLE_GENERATIVE_AI_API_KEY) { return @{ hay = "si"; valor = [string]$env:GOOGLE_GENERATIVE_AI_API_KEY } }
    $leido = Read-JsonSinBom (Join-Path $datosDir "auth.json")
    if ($leido.estado -eq "ilegible") { return @{ hay = "no-se"; valor = "" } }
    if ($leido.estado -eq "no-existe") { return @{ hay = "no"; valor = "" } }
    try {
        if ($leido.datos.google -and $leido.datos.google.key) { return @{ hay = "si"; valor = [string]$leido.datos.google.key } }
    } catch {
        return @{ hay = "no-se"; valor = "" }
    }
    return @{ hay = "no"; valor = "" }
}

# ---- Probar la key CONTRA GOOGLE ---------------------------------------------
#
# CINCO RESULTADOS, y ninguno se puede confundir con otro. Son LOS MISMOS de
# Probar-KeyGoogle en install\install.ps1, de probar_key_google en
# install\install.sh y de probarClave() en opencode\tool\clave.ts, con los mismos
# criterios y en el mismo orden -- si clasificaran distinto, el lanzador, el
# instalador y el bot le contarian a la misma docente tres historias diferentes
# de la misma key:
#
#   anda      -> Google contesto OK. No se dice NADA: el bot abre y anda.
#   cuota     -> HTTP 429 / RESOURCE_EXHAUSTED. ES EL CASO DE LA ESCUELA: la key
#                es real y de la docente, lo que se acabo es el cupo gratis.
#   invalida  -> HTTP 400/403, INVALID_ARGUMENT / PERMISSION_DENIED /
#                UNAUTHENTICATED, o reason API_KEY_INVALID. La key no sirve.
#   modeloIdo -> HTTP 404 / NOT_FOUND. La key puede estar perfecta: el que no
#                esta es el MODELO. TIENE RAMA PROPIA porque el cajon de "no pude
#                probarla" le echa la culpa a la red, y aca la red anda perfecto:
#                mandaria a la docente a pelearse con el proxy de la escuela por
#                un problema que esta del otro lado y que ninguna key arregla.
#   sinProbar -> cualquier otro HTTP (un 500/503 es de Google, no de la key) o
#                una excepcion de red. NUNCA se cuenta como "anda", y aca ademas
#                NO IMPRIME NADA (regla 3 del encabezado).
#
# Del cuerpo de la respuesta se sacan SOLO dos cosas: error.status y los reason
# de error.details, que son tokens de una lista cerrada. El cuerpo entero no se
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
    if ($codigo -eq 429 -or $status -eq "RESOURCE_EXHAUSTED") { return "cuota" }
    if ($codigo -eq 400 -or $codigo -eq 403 -or $status -eq "INVALID_ARGUMENT" -or $status -eq "PERMISSION_DENIED" -or $status -eq "UNAUTHENTICATED" -or ($razones -contains "API_KEY_INVALID")) {
        return "invalida"
    }
    # El modelo, no la key. Va ANTES del cajon de sinProbar a proposito.
    if ($codigo -eq 404 -or $status -eq "NOT_FOUND") { return "modeloIdo" }
    return "sinProbar"
}

function Probar-KeyGoogle($clave) {
    if (-not $clave) { return "sinProbar" }
    $url = "https://generativelanguage.googleapis.com/v1beta/models/" + $ModeloApi + ":generateContent"
    # El pedido mas chico que sirve de prueba: una palabra y un token de
    # respuesta. No es gratis (consume una llamada del cupo), pero preguntarle a
    # Google es la unica forma de saber, y no preguntar es justamente el defecto
    # que estamos arreglando.
    $cuerpoPedido = '{"contents":[{"parts":[{"text":"ping"}]}],"generationConfig":{"maxOutputTokens":1}}'
    try {
        # Windows 10 sin actualizar negocia TLS 1.0 por defecto y Google lo
        # rechaza hace anios: sin esto el pedido muere con una excepcion de
        # "conexion cerrada" que parece falta de red y no lo es. Best-effort.
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        } catch { }
        $resp = Invoke-WebRequest -Uri $url -Method Post -UseBasicParsing -TimeoutSec $TimeoutChequeoKey `
            -ContentType "application/json" `
            -UserAgent "tecnia-bot-lanzador" `
            -Headers @{ "x-goog-api-key" = [string]$clave } `
            -Body $cuerpoPedido
        $codigo = [int]$resp.StatusCode
        if ($codigo -ge 200 -and $codigo -lt 300) { return "anda" }
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
        # Timeout, DNS que no resuelve, el filtro de contenido de la escuela que
        # corta. No se informa NI el tipo de la excepcion: aca no se imprime nada.
        if ($codigo -eq 0) { return "sinProbar" }
        return (Clasificar-RespuestaGoogle $codigo $textoRespuesta)
    }
}

# ---------------------------------------------------------------------------
# LA DECISION. No imprime nada: solo deja un resultado.
# ---------------------------------------------------------------------------
#
# Todo adentro de un try/catch que cae a "" (no decir nada). Es la regla 1: un
# chequeo roto no puede dejar a una docente sin poder abrir el bot, y tampoco
# puede vomitarle una pared roja de PowerShell arriba del logo.
$resultado = ""
try {
    $modeloActual = Get-ModeloDelAgente (Get-DirConfigOpencode)
    # ATAJO PARA LA MAQUINA SIN KEY. Si el agente no esta en Gemini -- Big
    # Pickle, o cualquier otra cosa que haya elegido el docente -- no hay key que
    # probar y no hay nada que avisar: se sale sin tocar la red. Es la mayoria de
    # las maquinas de escuela, y no van a pagar ni un milisegundo por esto.
    if ($modeloActual -eq $ModeloConKey) {
        $guardada = Get-KeyDeGoogle (Get-DirDatosOpencode)
        if ($guardada.hay -eq "si") {
            $resultado = Probar-KeyGoogle $guardada.valor
        }
        # El agente en Gemini y NINGUNA key, ni en la variable ni en auth.json: se
        # sabe sin tocar la red que el primer mensaje va a fallar, y se avisa.
        # Con "no-se" (auth.json ilegible) no se dice nada: no sabemos.
        if ($guardada.hay -eq "no") {
            $resultado = "sinKey"
        }
    }
} catch {
    $resultado = ""
}

# ---------------------------------------------------------------------------
# LOS AVISOS PARA LA DOCENTE
# ---------------------------------------------------------------------------
#
# La explicacion de cada caso es la MISMA que dan install\install.ps1 y
# opencode\tool\clave.ts. No hay una tercera verdad: si el lanzador explicara la
# cuota distinto del instalador y del bot, la docente probaria dos veces lo
# mismo. Sobre todo lo que mas confunde y lo que hizo perder una tarde entera en
# la escuela: LA CUOTA GRATUITA DE GOOGLE ES POR PROYECTO, NO POR KEY.
#
# LO QUE CAMBIA ES ADONDE SE MANDA. Antes cada aviso terminaba en "escribi /clave
# adentro del bot". Pero estos avisos salen justamente cuando el modelo NO va a
# contestar, y a /clave lo atiende ese modelo. Ahora la salida es "Reparar Tecnia
# Bot" (menu inicio), que no depende de ningun modelo; /clave se nombra, y se dice
# cuando sirve y cuando no.
#
# "anda" y "sinProbar" no tienen bloque: no se imprime nada. Que no aparezca uno.
$aviso = $false

if ($resultado -eq "cuota") {
    $aviso = $true
    Write-Host ""
    Write-Host "   OJO: la CUOTA GRATUITA de Google de este proyecto esta agotada."
    Write-Host ""
    Write-Host "   No rompiste nada: tu key sigue siendo tuya y Tecnia Bot esta entero. Google"
    Write-Host "   regala una cantidad de mensajes por dia y esa cantidad se termino. El bot abre"
    Write-Host "   igual, pero va a fallar al primer mensaje hasta que se renueve."
    Write-Host ""
    Write-Host "   Lo que podes hacer ahora, sin depender del bot:"
    Write-Host "     1. Esperar: el limite gratuito se renueva solo, manana volves a tener cupo."
    Write-Host "     2. Poner una key de OTRO PROYECTO de Google: cerra esta ventana y abri"
    Write-Host "        'Reparar Tecnia Bot' desde el menu inicio, que te la pide y la prueba."
    Write-Host "        Ojo, que es lo que mas confunde: la cuota gratuita es por PROYECTO, no por key."
    Write-Host "        Una key nueva del MISMO proyecto comparte el limite y da exactamente el mismo"
    Write-Host "        error. Sacate una de otro proyecto (o de otra cuenta) en"
    Write-Host "        https://aistudio.google.com/apikey"
    Write-Host ""
    Write-Host "   /clave, adentro del bot, tambien cambia la key y te deja seguir sin key con"
    Write-Host "   Big Pickle, el modelo gratuito de OpenCode. PERO lo atiende el mismo modelo que"
    Write-Host "   se quedo sin cuota: mientras el bot no conteste, /clave tampoco."
    Write-Host "   Por eso la salida segura es 'Reparar Tecnia Bot'."
    Write-Host ""
}

if ($resultado -eq "invalida") {
    $aviso = $true
    Write-Host ""
    Write-Host "   OJO: probe la key guardada y Google la RECHAZO: no sirve."
    Write-Host ""
    Write-Host "   El bot abre igual, pero va a fallar al primer mensaje. Puede estar borrada,"
    Write-Host "   vencida o mal copiada (son largas y a veces se cortan al copiar)."
    Write-Host ""
    Write-Host "   Para cambiarla: cerra esta ventana y abri 'Reparar Tecnia Bot' desde el menu inicio."
    Write-Host "   Te pide la key nueva y la prueba contra Google antes de guardarla."
    Write-Host "   Sacala en https://aistudio.google.com/apikey (es gratis, con cualquier cuenta"
    Write-Host "   de Google y sin tarjeta)"
    Write-Host ""
    Write-Host "   /clave, adentro del bot, hace lo mismo. PERO lo atiende el modelo que usa esta"
    Write-Host "   misma key: mientras la key no sirva, /clave no va a contestar."
    Write-Host ""
}

if ($resultado -eq "modeloIdo") {
    $aviso = $true
    # El actualizador que esta al lado de este archivo: se nombra SOLO si esta.
    $Actualizador = Join-Path $PSScriptRoot "update.ps1"
    Write-Host ""
    Write-Host "   OJO: la key esta bien -- el que no esta es el MODELO."
    Write-Host ""
    Write-Host "   Google dice que $ModeloApi ya no esta disponible. Pasa cuando retiran o"
    Write-Host "   renombran un modelo."
    Write-Host ""
    Write-Host "   NO es tu computadora, NO es tu key y NO es la red: no hay key nueva que lo"
    Write-Host "   arregle. Hace falta una version de Tecnia Bot que apunte a un modelo vigente."
    Write-Host ""
    Write-Host "   /actualizar adentro del bot es lo que la trae, PERO lo atiende ese mismo modelo:"
    Write-Host "   si el bot no contesta, /actualizar tampoco. Y 'Reparar Tecnia Bot' NO alcanza:"
    Write-Host "   reinstala la version que ya tenes. Lo que sirve sin depender del bot:"
    Write-Host "     - bajar el instalador nuevo de la pagina de Tecnia Bot (la direccion esta"
    Write-Host "       mas arriba en esta ventana) y correrlo encima, o"
    if (Test-Path $Actualizador) {
        Write-Host "     - correr el actualizador a mano: tecla Windows + R, y pega esto:"
        Write-Host "         powershell -NoProfile -ExecutionPolicy Bypass -File `"$Actualizador`""
    }
    Write-Host "   Si despues de actualizar sigue igual, avisale al referente tecnico que hay que"
    Write-Host "   reportarlo."
    Write-Host ""
}

if ($resultado -eq "sinKey") {
    $aviso = $true
    Write-Host ""
    Write-Host "   OJO: Tecnia Bot esta configurado para usar Gemini y en esta compu NO hay"
    Write-Host "   ninguna key de Google guardada."
    Write-Host ""
    Write-Host "   El bot abre igual, pero va a fallar al primer mensaje: Gemini no anda sin key."
    Write-Host ""
    Write-Host "   Cerra esta ventana y abri 'Reparar Tecnia Bot' desde el menu inicio. Si pegas"
    Write-Host "   una key, la prueba y la guarda; si apretas Enter sin pegar nada, deja a Tecnia"
    Write-Host "   Bot en Big Pickle, el modelo gratuito de OpenCode, que no necesita key."
    Write-Host ""
    Write-Host "   /clave adentro del bot no sirve para esto: sin key, el bot no puede contestar."
    Write-Host ""
}

if ($aviso) { exit 9 }
exit 0
