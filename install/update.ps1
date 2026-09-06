# Actualiza Tecnia Bot a la ULTIMA VERSION PUBLICADA (el release que GitHub
# marca como "Latest", tag vX.Y.Z) y reinstala la capa.
#   - Si es un clon de git (dev, o instalacion en Linux por `git clone`): SIN
#     tocar cambios locales, hace fetch y se para en el tag del ultimo release.
#   - Si es la instalacion por .exe (docente, no es git): BAJA el fuente de ese
#     release, VERIFICA que lo bajado sea esa version, y solo entonces reemplaza
#     la copia maestra. Asi el docente se actualiza sin re-descargar el .exe ni
#     tocar OpenCode/PlatformIO.
#
# Antes bajaba la rama `main` entera (codigo sin publicar) y en un clon hacia
# `reset --hard` + `clean`, que borraba trabajo sin commitear. Ninguna de las
# dos cosas vuelve: la regla es PUEDE FALLAR, PERO NO PUEDE ROMPER. Si algo
# sale mal antes de copiar, la copia instalada queda exactamente como estaba.
#
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File install\update.ps1

$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $PSScriptRoot
$Repo = "programadores-obreros/Agente-editor-inet"
$ApiUltimoRelease = "https://api.github.com/repos/$Repo/releases/latest"
# La API de GitHub rechaza pedidos sin User-Agent (403).
$UserAgent = "tecnia-bot-update"

# GitHub exige TLS 1.2; PowerShell 5.1 no lo habilita por defecto.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# Ultimo release PUBLICADO (ni draft ni prerelease): el que GitHub marca como
# Latest. Es lo mismo que ve el docente en la pagina de releases, y lo que
# docs/rollback.md mueve cuando hay que volver atras.
function Resolver-UltimoTag {
    $r = Invoke-RestMethod -Uri $ApiUltimoRelease -UserAgent $UserAgent -Headers @{ "Accept" = "application/vnd.github+json" } -TimeoutSec 60
    $tag = ("" + $r.tag_name).Trim()
    if ($tag -notmatch '^v\d+\.\d+\.\d+$') { throw "GitHub devolvio un tag que no entiendo: '$tag'." }
    return $tag
}

# El VERSION que vino adentro del zip tiene que ser el del tag (v0.3.75 -> 0.3.75).
# Si no coincide, lo bajado no es lo que pedimos y NO se copia nada.
function Verificar-Version {
    param([string]$Dir, [string]$Tag)
    $esperada = $Tag.TrimStart("v")
    $f = Join-Path $Dir "VERSION"
    if (-not (Test-Path $f)) { throw "Lo descargado no trae archivo VERSION: no lo instalo." }
    $real = (Get-Content $f -Raw).Trim()
    if ($real -ne $esperada) { throw "Lo descargado dice version $real y el release es ${esperada}: no lo instalo." }
}

function Version-Instalada {
    $f = Join-Path $RepoDir "VERSION"
    if (Test-Path $f) { return (Get-Content $f -Raw).Trim() }
    return ""
}

Write-Host "==> Actualizando Tecnia Bot..."

try {
    $tag = Resolver-UltimoTag
} catch {
    Write-Host "  [ERROR] No pude consultar cual es el ultimo release en GitHub (sin internet?)."
    Write-Host "          No toque nada: seguis con la version que tenias."
    exit 1
}
Write-Host "  Ultimo release publicado: $tag"

if ((Test-Path (Join-Path $RepoDir ".git")) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  [git] Es un clon de git."
    # OJO: git manda mensajes puramente informativos por stderr -- con
    # $ErrorActionPreference = "Stop", PowerShell los toma como error fatal
    # aunque el comando haya andado bien. Bajamos la preferencia y miramos el
    # exit code a mano en cada paso.
    $ErrorActionPreference = "Continue"

    # Solo cambios en archivos TRACKEADOS bloquean: son los unicos que un
    # checkout podria pisar. Los archivos sueltos (untracked) git no los toca
    # nunca -- si uno chocara con el tag, checkout falla solo y no pisa nada.
    $sucio = git -C $RepoDir status --porcelain --untracked-files=no 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Host "  [ERROR] git status fallo: no toco nada."; exit 1 }
    if ($sucio) {
        Write-Host "  [ERROR] Hay cambios sin commitear en $RepoDir, no toco nada."
        Write-Host "          Commitealos o guardalos (git stash) y volve a correr /actualizar."
        exit 1
    }

    git -C $RepoDir fetch --tags --quiet origin 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "  [ERROR] git fetch fallo (sin internet?): no toco nada."; exit 1 }

    $head = git -C $RepoDir rev-parse HEAD 2>$null
    $delTag = git -C $RepoDir rev-parse "$tag^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $delTag) { Write-Host "  [ERROR] El tag $tag no esta en este clon: no toco nada."; exit 1 }

    if ($head -eq $delTag) {
        Write-Host "  [OK] Ya estas en la ultima ($tag)."
    } else {
        # Checkout del TAG (queda en "detached HEAD"): lo que corre es exactamente
        # lo publicado, igual que en la instalacion por .exe. Un dev vuelve a su
        # rama con `git checkout main`. El arbol esta limpio (recien lo
        # chequeamos), asi que checkout no pisa nada.
        git -C $RepoDir checkout --quiet --detach $tag 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Host "  [ERROR] No pude pararme en ${tag}: no toco nada."; exit 1 }
        Write-Host "  [OK] Parado en $tag."
    }
    $ErrorActionPreference = "Stop"
} else {
    $instalada = Version-Instalada
    if ($instalada -eq $tag.TrimStart("v")) {
        Write-Host "  [OK] Ya estas en la ultima ($tag). No descargo nada."
    } else {
        Write-Host "  [web] Bajando el fuente del release $tag desde GitHub..."
        $tmp = Join-Path $env:TEMP ("tecnia-update-" + [Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Force -Path $tmp | Out-Null
        $fallo = $false
        try {
            $zip = Join-Path $tmp "src.zip"
            Invoke-WebRequest -Uri "https://github.com/$Repo/archive/refs/tags/$tag.zip" -OutFile $zip -UseBasicParsing -UserAgent $UserAgent -TimeoutSec 300
            Expand-Archive -Path $zip -DestinationPath $tmp -Force
            $extracted = Get-ChildItem $tmp -Directory | Select-Object -First 1
            if (-not $extracted) { throw "No pude extraer el fuente descargado." }
            Verificar-Version -Dir $extracted.FullName -Tag $tag
            # Recien ahora, con lo bajado verificado, se reemplaza la copia
            # maestra (opencode/, install/, VERSION...).
            Copy-Item (Join-Path $extracted.FullName "*") $RepoDir -Recurse -Force
            Write-Host "  [OK] Fuente actualizado a $tag."
        } catch {
            $fallo = $true
            Write-Host "  [ERROR] No pude actualizar: $($_.Exception.Message)"
            Write-Host "          La copia instalada quedo como estaba (version $instalada)."
        } finally {
            Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
        }
        if ($fallo) { exit 1 }
    }
}

# Reinstala la capa (copia archivos + mergea config, idempotente). Corre aunque
# ya estuvieras en la ultima: es lo que aplica una key pegada con /connect.
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoDir "install\install.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "==> Tecnia Bot actualizado. Reinicia OpenCode para cargar los cambios."
