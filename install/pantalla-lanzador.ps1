# ============================================================================
# Tecnia Bot -- la pantalla que se ve mientras abre, y la fuente de la consola.
#
# Lo llama installer\abrir-tecnia-bot.cmd justo antes de abrir OpenCode. Hace dos
# cosas, y ninguna de las dos puede impedir que el bot abra:
#
#   1. MIDE la fuente de ESTA ventana y, solo si esa fuente no puede dibujar el
#      borde del cuadro de texto de OpenCode, la cambia a Consolas para esta
#      ventana. No toca el registro ni el acceso directo.
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
# marca de cada herramienta salen como "?". OpenCode dibuja ese borde con U+2503,
# una linea vertical gruesa.
#
# QUE FUENTE TIENE ESA VENTANA NO SE SABE: nadie la midio. Hubo dos hipotesis y
# este script no elige ninguna:
#
#   a) una fuente de mapa de bits ("Terminal"), que no tiene ese caracter;
#   b) Lucida Console, que es TrueType y tampoco lo tiene.
#
# Medido en la VM win10 el 2026-11-27, leyendo los archivos de fuente: Consolas
# trae U+2503 y Lucida Console y Courier New no. La primera version de este
# script cambiaba la fuente "solo si no es TrueType": con la hipotesis (b) no
# hubiera hecho nada, y la hipotesis (b) es la que mejor calza con las capturas.
#
# Por eso la pregunta que se hace ahora no es "de que tipo es la fuente" sino
# "esta fuente, PUEDE dibujar el borde?", y se le pregunta a Windows
# (GetGlyphIndices). Vale para las dos hipotesis y para las que no se nos
# ocurrieron. Lo medido queda en %TEMP%\tecnia-bot-consola.txt, antes y despues.
#
# LO QUE CONSOLAS NO ARREGLA (medido igual): no trae U+25A3, la marca que
# OpenCode pone al lado del nombre del agente, ni los caracteres braille. Esos
# van a seguir saliendo mal con cualquier fuente que venga con Windows 10.
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
# U+2503: el borde del cuadro de texto de OpenCode. Es el caracter que decide.
$Borde = [char]0x2503
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

  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
  [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFontW(int alto, int ancho, int esc, int ori, int peso, uint cursiva, uint subrayada,
    uint tachada, uint juego, uint precision, uint recorte, uint calidad, uint familia, string nombre);
  [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
  static extern int GetTextFaceW(IntPtr dc, int n, System.Text.StringBuilder nombre);
  [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
  static extern uint GetGlyphIndicesW(IntPtr dc, string texto, int n, ushort[] indices, uint marcas);

  // 1 = la fuente tiene el caracter; 0 = no lo tiene; -1 = no se pudo preguntar
  // (la fuente no esta instalada y Windows ofrecio otra, o fallo la llamada).
  public static int TieneGlifo(string fuente, char c) {
    IntPtr dc = CreateCompatibleDC(IntPtr.Zero);
    if (dc == IntPtr.Zero) return -1;
    // 1 = DEFAULT_CHARSET.
    IntPtr f = CreateFontW(16, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 0, 0, fuente);
    if (f == IntPtr.Zero) { DeleteDC(dc); return -1; }
    IntPtr anterior = SelectObject(dc, f);
    int r = -1;
    System.Text.StringBuilder real = new System.Text.StringBuilder(64);
    GetTextFaceW(dc, 64, real);
    if (String.Equals(real.ToString(), fuente, StringComparison.OrdinalIgnoreCase)) {
      ushort[] indices = new ushort[1];
      // 1 = GGI_MARK_NONEXISTING_GLYPHS: lo que falta vuelve como 0xFFFF.
      uint n = GetGlyphIndicesW(dc, c.ToString(), 1, indices, 1);
      if (n == 1) r = (indices[0] == 0xFFFF) ? 0 : 1;
    }
    SelectObject(dc, anterior);
    DeleteObject(f);
    DeleteDC(dc);
    return r;
  }
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

  # La pregunta que decide: esta fuente, puede dibujar el borde de OpenCode?
  # Una fuente de mapa de bits no puede, y no hace falta preguntarle.
  $esTrueType = (($antes.FontFamily -band $BitTrueType) -ne 0)
  $puede = 0
  if ($esTrueType) { $puede = [TecniaConsola]::TieneGlifo($antes.FaceName, $Borde) }
  Anotar ("borde-con-la-fuente-actual=" + $puede + " (1 si, 0 no, -1 no se pudo preguntar)")
  $consolas = [TecniaConsola]::TieneGlifo("Consolas", $Borde)
  Anotar ("borde-con-consolas=" + $consolas)

  if ($puede -ne 0) {
    # Lo dibuja, o no se pudo averiguar: ante la duda no se le cambia la fuente
    # a nadie. La que hay la eligio Windows o la eligio el docente.
    Anotar "accion: ninguna"
  } elseif ($consolas -ne 1) {
    # Cambiar a una fuente que tampoco lo dibuja no arregla nada.
    Anotar "accion: ninguna, Consolas no esta o tampoco trae el borde"
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
    if ($despues.FaceName -eq "Consolas") {
      Anotar "accion: cambiada a Consolas"
    } else {
      Anotar "accion: se pidio el cambio y la ventana no quedo en Consolas"
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
