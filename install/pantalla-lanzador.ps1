# ============================================================================
# Tecnia Bot -- la pantalla que se ve mientras abre, y la fuente de la consola.
#
# Lo llama installer\abrir-tecnia-bot.cmd justo antes de abrir OpenCode. Hace dos
# cosas, y ninguna de las dos puede impedir que el bot abra:
#
#   1. MIDE la fuente de ESTA ventana y, solo si es de mapa de bits, la cambia a
#      Consolas para esta ventana. No toca el registro ni el acceso directo.
#   2. Dibuja el cartel de bienvenida, con tildes y con el robot.
#
# POR QUE EXISTE (hallazgos W33 y W34 de la prueba en la notebook, 2026-11-26).
#
# W34: el cartel se dibujaba con `echo` desde el .cmd. El dibujo ASCII salia
# desarmado y el texto iba sin tildes ("tecnicas", "elegi"), porque un .cmd con
# tildes depende de la tabla de caracteres con que cmd.exe lo lea. Desde aca las
# tildes se arman con su numero ([char]0xE9) y se escriben por la API Unicode de
# la consola: no dependen de ninguna tabla.
#
# W33: en esa notebook el borde del cuadro de texto de OpenCode, el spinner y la
# marca de cada herramienta salen como "?". Se ve bien todo lo que esta en la
# tabla OEM de Windows y sale "?" todo lo que no, y el texto mide 10x18 pixeles
# por celda, que es un tamanio de la fuente de mapa de bits "Terminal". De ahi la
# hipotesis: esa ventana usa una fuente de mapa de bits.
#
# LA HIPOTESIS NO ESTA CONFIRMADA, Y HAY UN DATO EN CONTRA: en el registro de esa
# notebook (HKCU\Console) la fuente por defecto es la TrueType. Lo que nadie
# midio es la fuente EFECTIVA de la ventana del lanzador, que puede venir del
# acceso directo. Por eso este script no supone: mide, y deja escrito lo que
# midio en %TEMP%\tecnia-bot-consola.txt (antes y despues). Si la fuente ya era
# TrueType no cambia nada, y ese archivo dice cual era: es el dato que falta.
#
# Este archivo va SOLO EN ASCII, como los demas .ps1 del repo: Windows PowerShell
# 5.1 lee un .ps1 sin BOM en la tabla ANSI de la maquina, y una tilde escrita aca
# saldria rota. Lo custodia tests/pantalla-lanzador.test.mjs.
#
# Sale con 0 si dibujo el cartel y con 1 si no pudo: con 1, el .cmd dibuja el
# suyo, mas pobre. Nunca sale con otro codigo.
# ============================================================================
param([string]$Version = "?")

$ErrorActionPreference = "Stop"

# TMPF_TRUETYPE: el bit que distingue una fuente TrueType de una de mapa de bits
# en el campo FontFamily de CONSOLE_FONT_INFOEX (wingdi.h).
$BitTrueType = 4
# FF_MODERN (0x30) + TMPF_TRUETYPE (0x04) + TMPF_VECTOR (0x02).
$FamiliaConsolas = 54
$Registro = Join-Path $env:TEMP "tecnia-bot-consola.txt"
$Renglones = New-Object System.Collections.Generic.List[string]

function Anotar([string]$texto) { $Renglones.Add($texto) }

function Describir($f) {
  $tipo = "mapa de bits"
  if (($f.FontFamily -band $BitTrueType) -ne 0) { $tipo = "TrueType" }
  return ("fuente=" + $f.FaceName + " tipo=" + $tipo + " celda=" + $f.X + "x" + $f.Y + " familia=" + $f.FontFamily + " peso=" + $f.FontWeight)
}

# -- 1. La fuente ------------------------------------------------------------
#
# Todo va en un try: si la escuela bloquea Add-Type (modo de lenguaje
# restringido), si el antivirus frena al compilador, o si la salida no es una
# consola, se anota por que y se sigue. Un aviso, no un portero.
try {
  Anotar ("version=" + $Version + " windows=" + [Environment]::OSVersion.Version)
  Anotar ("codepage-salida=" + [Console]::OutputEncoding.CodePage)

  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class TecniaConsola {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Fuente {
    public uint cbSize;
    public uint nFont;
    public short X;
    public short Y;
    public int FontFamily;
    public int FontWeight;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
    public string FaceName;
  }
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool GetCurrentConsoleFontEx(IntPtr h, bool maxima, ref Fuente f);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool SetCurrentConsoleFontEx(IntPtr h, bool maxima, ref Fuente f);
}
"@

  # -11 = STD_OUTPUT_HANDLE.
  $salida = [TecniaConsola]::GetStdHandle(-11)

  $antes = New-Object TecniaConsola+Fuente
  $antes.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($antes)
  if (-not [TecniaConsola]::GetCurrentConsoleFontEx($salida, $false, [ref]$antes)) {
    throw ("no pude leer la fuente (error " + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error() + ")")
  }
  Anotar ("antes: " + (Describir $antes))

  if (($antes.FontFamily -band $BitTrueType) -ne 0) {
    # Ya es TrueType: la eligio Windows o la eligio el docente. No se toca.
    Anotar "accion: ninguna, la fuente ya era TrueType"
  } else {
    $nueva = New-Object TecniaConsola+Fuente
    $nueva.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($nueva)
    $nueva.nFont = 0
    $nueva.X = 0
    # Se respeta el alto que tenia, con un piso de 16 para que no quede diminuta.
    $nueva.Y = [Math]::Max([int]$antes.Y, 16)
    $nueva.FontFamily = $FamiliaConsolas
    $nueva.FontWeight = 400
    $nueva.FaceName = "Consolas"
    if (-not [TecniaConsola]::SetCurrentConsoleFontEx($salida, $false, [ref]$nueva)) {
      throw ("no pude cambiar la fuente (error " + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error() + ")")
    }
    # Que la llamada devuelva "ok" no alcanza: se vuelve a leer la ventana.
    $despues = New-Object TecniaConsola+Fuente
    $despues.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($despues)
    [void][TecniaConsola]::GetCurrentConsoleFontEx($salida, $false, [ref]$despues)
    Anotar ("despues: " + (Describir $despues))
    if (($despues.FontFamily -band $BitTrueType) -ne 0) {
      Anotar "accion: cambiada a TrueType"
    } else {
      Anotar "accion: se pidio el cambio y la ventana sigue en mapa de bits"
    }
  }
} catch {
  Anotar ("fuente sin tocar: " + $_.Exception.Message)
}

try {
  [System.IO.File]::WriteAllLines($Registro, $Renglones, (New-Object System.Text.UTF8Encoding $false))
} catch {
  # Sin registro: no es motivo para no abrir.
}

# -- 2. El cartel ------------------------------------------------------------
#
# Solo caracteres que estan en las tablas OEM de Windows (CP437 y CP850): si la
# fuente quedo en mapa de bits, igual salen. Los tres bloques son los mismos del
# splash del bot.
try {
  $lleno = [string][char]0x2588
  $arriba = [string][char]0x2580
  $abajo = [string][char]0x2584
  $e = [string][char]0xE9

  $antena = "      " + $abajo
  $cabeza1 = "   " + ($abajo * 3) + $lleno + ($abajo * 3)
  $cabeza2 = "   " + $lleno + " " + $arriba + " " + $arriba + " " + $lleno
  $cabeza3 = "   " + ($arriba * 7)

  Write-Host ""
  Write-Host $antena -ForegroundColor Yellow
  Write-Host $cabeza1 -ForegroundColor Magenta -NoNewline
  Write-Host "    TECNIA BOT" -ForegroundColor White -NoNewline
  Write-Host ("  v" + $Version) -ForegroundColor DarkGray
  Write-Host $cabeza2 -ForegroundColor Magenta -NoNewline
  Write-Host ("    Arduino y ESP32 para la escuela t" + $e + "cnica") -ForegroundColor Gray
  Write-Host $cabeza3 -ForegroundColor Magenta -NoNewline
  Write-Host "    un proyecto de Tecnia Lab" -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "   Primeros pasos y ayuda:  " -ForegroundColor Gray -NoNewline
  Write-Host "https://tecnialab.net.ar/tecnia-bot/" -ForegroundColor White
  Write-Host ""
  exit 0
} catch {
  exit 1
}
