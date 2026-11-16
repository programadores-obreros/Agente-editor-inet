# ============================================================================
# Compila el instalador .exe de Tecnia Bot EN ESTA Windows, de cero.
# Pensado para probar en una VM sin tener nada preinstalado.
#
# Uso (desde la raiz del repo ya clonado):
#   powershell -ExecutionPolicy Bypass -File installer\compilar-en-windows.ps1
#
# Que hace:
#   1. Instala Inno Setup 6 (si falta) con winget.
#   2. Compila installer\tecnia-bot.iss.
#   3. Te deja el .exe en installer\dist\Instalar-Tecnia-Bot.exe
#
# (No hace falta esto para USAR Tecnia Bot: el .exe ya lo compila el CI y se
#  baja desde Releases. Este script es solo para compilar a mano en Windows.)
# ============================================================================
$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "  Compilar instalador de Tecnia Bot (Windows)"
Write-Host "  -------------------------------------------"
Write-Host ""

# --- 1. Inno Setup ----------------------------------------------------------
$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (Test-Path $iscc) {
    Write-Host "  [OK] Inno Setup ya esta instalado."
} else {
    Write-Host "  [..] Instalando Inno Setup 6 con winget..."
    winget install --id JRSoftware.InnoSetup --accept-source-agreements --accept-package-agreements -e
    if (-not (Test-Path $iscc)) {
        throw "No se encontro ISCC.exe tras instalar. Instala Inno Setup 6 a mano desde https://jrsoftware.org/isdl.php"
    }
    Write-Host "  [OK] Inno Setup instalado."
}

# --- 2. Version -------------------------------------------------------------
#
# SIN VERSION NO SE COMPILA. Aca habia un "0.0.0" de relleno para cuando faltaba
# el archivo: salia un .exe rotulado 0.0.0 que no es ninguna version de Tecnia
# Bot. Es el mismo error que el .iss ya se niega a cometer (no tiene valor por
# defecto, y su encabezado cuenta por que: un instalador que miente su version es
# una tarde perdida diagnosticando). Mejor cortar y decir que falta.
$VerFile = Join-Path $RepoDir "VERSION"
if (-not (Test-Path $VerFile)) {
    throw "Falta el archivo VERSION ($VerFile). Sin el no se sabe que version se esta compilando: corre esto desde un clon completo del repo."
}
$Version = ("" + (Get-Content $VerFile -Raw)).Trim()
if (-not $Version) {
    throw "El archivo VERSION ($VerFile) esta vacio. Sin version no se compila."
}

# --- 3. Compilar ------------------------------------------------------------
#
# EL .exe VIEJO SE BORRA ANTES, Y SE MIRA EL CODIGO DE ISCC. Antes se corria
# ISCC sin leer $LASTEXITCODE y se decia "LISTO!" con solo encontrar el .exe en
# dist\. Si la compilacion fallaba, el archivo que estaba ahi era el de la
# corrida ANTERIOR: se festejaba un instalador viejo y se lo probaba creyendo
# que tenia el cambio. Es la precondicion que mas veces falto en este repo
# ("verificar QUE build se esta probando").
#
# Con el viejo borrado, que el .exe exista despues significa que lo escribio
# ESTA compilacion. Las dos comprobaciones van juntas: el codigo de salida dice
# si ISCC termino bien, y el archivo dice que de verdad dejo algo.
$Exe = Join-Path $RepoDir "installer\dist\Instalar-Tecnia-Bot.exe"
if (Test-Path $Exe) {
    Remove-Item $Exe -Force -ErrorAction SilentlyContinue
    if (Test-Path $Exe) {
        throw "No pude borrar el instalador anterior ($Exe). Cerra lo que lo tenga abierto y volve a correr esto."
    }
}

Write-Host "  [..] Compilando version $Version..."
& $iscc "/DMyAppVersion=$Version" (Join-Path $RepoDir "installer\tecnia-bot.iss")
# Se guarda YA: es el codigo de ISCC y lo que sigue no lo tiene que pisar.
$CodigoIscc = $LASTEXITCODE
if ($CodigoIscc -ne 0) {
    throw "ISCC no pudo compilar el instalador (codigo $CodigoIscc). Revisa los mensajes de arriba: no quedo ningun .exe."
}

Write-Host ""
if (Test-Path $Exe) {
    Write-Host "  LISTO! Instalador en: $Exe"
    Write-Host "  Doble clic para probarlo (Next-Next-Finish)."
} else {
    throw "ISCC termino con codigo 0 pero no esta el .exe ($Exe). Revisa los mensajes de arriba."
}
Write-Host ""
