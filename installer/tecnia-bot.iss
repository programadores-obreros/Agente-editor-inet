; ============================================================================
; Tecnia Bot — instalador .exe para Windows (Inno Setup 6).
;
; Se COMPILA en Windows con Inno Setup (o solo, vía GitHub Actions:
; .github/workflows/build-installer.yml). Produce: installer\dist\Instalar-Tecnia-Bot.exe
;
; La versión SE PASA POR LÍNEA DE COMANDO, y sale del archivo VERSION del repo:
;   ISCC /DMyAppVersion=0.3.39 tecnia-bot.iss
;
; NO HAY VALOR POR DEFECTO, y es a propósito. Antes había uno y quedó SIETE
; versiones atrás: un .exe compilado a mano salía rotulado 0.3.32 siendo 0.3.39.
; Un instalador que miente su versión es una tarde perdida diagnosticando.
; Mejor que no compile y diga qué falta.
;
; Qué hace el .exe, en orden, SIN pedir permisos de administrador:
;   1. Copia la capa educativa (agentes + skills + herramientas + web) a la carpeta del programa.
;   2. Corre bootstrap.ps1: instala Scoop + OpenCode + PlatformIO y publica la capa en la config de OpenCode.
;   3. Crea accesos directos (menú inicio + escritorio) que abren el bot con un doble clic.
; ============================================================================

#ifndef MyAppVersion
  #error Falta la version. Pasala desde el archivo VERSION del repo, por ejemplo: ISCC /DMyAppVersion=0.3.39 installer\tecnia-bot.iss
#endif
#define MyAppName "Tecnia Bot"
#define MyAppPublisher "Tecnia Lab"
#define MyAppURL "https://tecnialab.net.ar/tecnia-bot/"

[Setup]
; GUID propio de este producto (no reutilizar el de otro programa).
AppId={{7F3A9C22-5B4E-4D1A-9E62-1C8B7A0F5D34}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
; AppVersion sólo se ve en "Agregar o quitar programas". Estas otras son las que
; ponen la versión en las PROPIEDADES DEL ARCHIVO, que es donde la busca alguien
; que tiene el .exe en Descargas y no sabe cuál bajó.
;
; Faltaban, y se pagó: en una sesión de soporte real hubo que identificar la
; versión que tenía un docente CONTANDO LOS BYTES del archivo contra el asset del
; release. Andaba, pero es una vergüenza como método.
VersionInfoVersion={#MyAppVersion}
VersionInfoProductVersion={#MyAppVersion}
VersionInfoProductName={#MyAppName}
VersionInfoDescription={#MyAppName} {#MyAppVersion} - instalador
VersionInfoCompany={#MyAppPublisher}
VersionInfoCopyright=Tecnia Lab - GPLv3
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
; ── Una sola instalación a la vez ────────────────────────────────────────────
;
; MEDIDO, no supuesto: sin esto se pueden arrancar dos instaladores con dos
; segundos de diferencia y quedan DOS bootstrap.ps1 corriendo en paralelo, los
; dos ejecutando `scoop install opencode` sobre los mismos archivos y los dos
; escribiendo la misma config. De ahí sale el "ERROR 'opencode' isn't installed
; correctly" que después aparece en TODOS los intentos siguientes.
;
; Y era fácil de provocar: el lanzador viejo, si lo abrías durante la
; instalación, te decía "volvé a correr el instalador". Le hacías caso y lo
; rompías. El instalador tiene que IMPEDIRLO, no pedir por favor.
SetupMutex=TecniaBotSetup,Global\TecniaBotSetup

; ── Qué Windows sirve, y que lo diga el instalador ───────────────────────────
;
; Tecnia Bot corre sobre OpenCode, y OpenCode es un ejecutable compilado con Bun.
; Bun exige Windows 10 versión 1809 (compilación 17763) o más nuevo, de 64 bits.
; No es una elección nuestra: en Windows 7, en Windows 8 o en un Windows 10 sin
; actualizar el binario directamente NO ARRANCA, y ningún instalador lo arregla.
; El porqué completo y las alternativas están en docs\decisiones.md, D-05.
;
; Antes esto era MinVersion=10.0 + ArchitecturesAllowed=x64compatible. Cortaban
; bien, pero con el cartel genérico de Inno Setup: no dice qué Windows tiene la
; máquina, ni por qué no sirve, ni qué hacer. En una escuela eso es una llamada
; de soporte. Ahora la verificación vive en [Code] (InitializeSetup): nombra el
; Windows detectado, explica el motivo y ofrece abrir la web con las opciones.
;
; MinVersion queda en el mínimo que admite Inno Setup 6.3+ (Windows 7 SP1) para
; que el .exe ARRANQUE en esas máquinas y pueda dar su propio mensaje. Más viejo
; que eso (Vista, Windows 7 sin SP1) cae en el cartel de Inno, que se traduce
; abajo en [Messages] con el mismo requisito.
MinVersion=6.1sp1
; 64 bits: OpenCode se distribuye únicamente como opencode-windows-x64.zip. La
; arquitectura también la verifica [Code] (IsX64Compatible), por el mismo motivo
; de arriba; esta línea sólo decide el modo de instalación en las máquinas que
; sí pasan. Sin ella, en una notebook de 32 bits el instalador copiaba toda la
; capa, corría el bootstrap, y recién ahí fallaba Scoop con un error que no dice
; "tu Windows no sirve".
ArchitecturesInstallIn64BitMode=x64compatible

; Sin admin: se instala en el espacio del usuario (ideal para PCs de escuela).
PrivilegesRequired=lowest
DefaultDirName={localappdata}\TecniaBot
DisableProgramGroupPage=yes
DisableDirPage=yes
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\abrir-tecnia-bot.cmd
OutputDir=dist
OutputBaseFilename=Instalar-Tecnia-Bot
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; SIEMPRE deja log en %TEMP%\Setup Log*.txt, sin tener que pasar /LOG.
;
; Cuando una instalacion falla en una maquina real, lo que llega es una captura
; de la ventana negra. El log dice el exit code de cada paso y en cual murio --
; que es el dato que en esta sesion hubo que ir a buscar a mano, dos veces.
SetupLogging=yes
; --- Marca Tecnia Bot ---
SetupIconFile=branding\tecnia-bot.ico
WizardImageFile=branding\wizard-grande.bmp
WizardSmallImageFile=branding\wizard-chico.bmp

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos directos:"

[Files]
; La capa educativa (agentes, skills, herramientas, web): el corazón del bot.
;
; ACÁ ADENTRO VIAJAN LAS 17 FICHAS A4 (opencode\skills\fichas\hojas\), y son la
; razón de que el .exe haya pasado de 2,63 MB a 7,44 en la v0.3.40. Es una
; decisión tomada a propósito, con su costo medido y su criterio de revisión
; escrito: ver docs\decisiones.md, D-01. Si hay que sacarlas, el procedimiento
; también está ahí — no hay que pensarlo de nuevo.
Source: "..\opencode\*"; DestDir: "{app}\opencode"; Flags: recursesubdirs createallsubdirs ignoreversion
; Los scripts que instalan las dependencias y publican la capa.
Source: "..\install\*"; DestDir: "{app}\install"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "..\VERSION"; DestDir: "{app}"; Flags: ignoreversion
Source: "abrir-tecnia-bot.cmd"; DestDir: "{app}"; Flags: ignoreversion
; El ícono se instala para que los accesos directos lo usen en runtime.
Source: "branding\tecnia-bot.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\abrir-tecnia-bot.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\tecnia-bot.ico"; Comment: "Abrir Tecnia Bot"
; Un diagnostico que se puede correr aunque OpenCode no arranque -- que es justo
; cuando hace falta. Junta version, dependencias, antivirus, disco y log en una
; sola pantalla, para no diagnosticar a partir de una foto de la consola.
Name: "{autoprograms}\Diagnostico de {#MyAppName}"; Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -NoExit -File ""{app}\install\diagnostico.ps1"""; \
  WorkingDir: "{app}"; IconFilename: "{app}\tecnia-bot.ico"; Comment: "Ver que anda y que no"
; REPARAR: vuelve a correr el bootstrap, que instala lo que falte y no toca lo
; que ya esta.
;
; ESTE ACCESO DIRECTO FALTABA, y se noto de la peor manera. En una maquina de la
; capacitacion del 20/08 falto PlatformIO, y el bot le dijo a la docente "volve a
; correr el instalador de Tecnia Bot desde el menu inicio". Fue a buscarlo y no
; existia: los unicos accesos eran abrir, diagnosticar y desinstalar.
;
; O sea que le dimos una instruccion imposible. La unica salida real era volver a
; bajar el .exe del sitio, que nadie adivina.
;
; El bootstrap ya sabia repararse -es lo que corre el lanzador cuando detecta que
; falta algo-, pero no habia forma de pedirselo a proposito. Ahora la hay, y la
; reparacion es un clic para cualquier docente.
;
; -NoExit a proposito: si algo falla, la ventana queda con el motivo a la vista.
Name: "{autoprograms}\Reparar {#MyAppName}"; Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -NoExit -File ""{app}\install\bootstrap.ps1"""; \
  WorkingDir: "{app}"; IconFilename: "{app}\tecnia-bot.ico"; Comment: "Instalar lo que haya quedado faltando"
Name: "{autoprograms}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\abrir-tecnia-bot.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\tecnia-bot.ico"; Tasks: desktopicon

[Run]
; Instala OpenCode + PlatformIO + la capa (sin admin, vía Scoop). Se muestra la
; consola a propósito: tarda varios minutos y así el docente ve que avanza.
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\install\bootstrap.ps1"""; \
  WorkingDir: "{app}"; \
  StatusMsg: "Instalando OpenCode, PlatformIO y Tecnia Bot (puede tardar varios minutos)..."; \
  Check: CorrerBootstrap; \
  Flags: waituntilterminated
; Se saca la marca de "instalación en curso" pase lo que pase con el paso de
; arriba. Se pone en [Code], al empezar (ssInstall); el porqué está allá abajo.
Filename: "cmd.exe"; Parameters: "/c del /q ""{app}\.instalando"""; \
  Flags: runhidden waituntilterminated
; Al terminar (casillas marcadas en la última pantalla): abrir la web oficial de
; Tecnia Bot (primeros pasos) y abrir el bot.
Filename: "{#MyAppURL}"; Description: "Visitar la web de Tecnia Bot (primeros pasos)"; \
  Flags: postinstall shellexec skipifsilent
Filename: "{app}\abrir-tecnia-bot.cmd"; Description: "Abrir Tecnia Bot ahora"; \
  Flags: postinstall skipifsilent nowait

[UninstallDelete]
; Inno borra sólo los archivos que él instaló. La carpeta quedaba con lo que
; nació después: la marca .instalando, el VERSION, restos del bootstrap. Un
; desinstalador que deja carpetas es el que hace dudar de si desinstaló.
;
; Es seguro barrer {app} entero: es %LOCALAPPDATA%\TecniaBot y ahí no hay nada
; del docente. Sus proyectos viven en Documentos\Tecnia Bot, que no se toca.
Type: filesandordirs; Name: "{app}"

[UninstallRun]
; Quita solo la capa de la config de OpenCode (no toca OpenCode ni los proyectos del docente).
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\install\uninstall.ps1"""; \
  Flags: runhidden; RunOnceId: "quitarcapa"

[Messages]
; Textos branded del asistente.
WelcomeLabel1=Bienvenido/a a Tecnia Bot
WelcomeLabel2=Tecnia Bot es el asistente que te acompaña para enseñar Arduino y ESP32 en la escuela técnica: explica el porqué, da código comentado y traduce los errores.%n%nEl asistente instala TODO lo necesario y no hace falta ser administrador. Tocá Siguiente para empezar.
FinishedHeadingLabel=¡Tecnia Bot quedó instalado!
FinishedLabel=¡Listo! Arrancá por la web de Tecnia Bot (tecnialab.net.ar/tecnia-bot) para ver los primeros pasos, y abrilo desde el menú inicio o el escritorio. Recordá instalar los drivers USB de tu placa si todavía no lo hiciste.
; Red de seguridad para lo que queda por debajo de MinVersion (Vista, Windows 7
; sin SP1): ahí [Code] no llega a correr y habla Inno. Que diga lo mismo que
; nosotros, y no "no es compatible con la versión de Windows".
WindowsVersionNotSupported=Tecnia Bot necesita Windows 10 (versión 1809 o más nueva) o Windows 11, de 64 bits.%n%nEste Windows es más viejo y no puede correr OpenCode, el programa sobre el que funciona Tecnia Bot. Ninguna instalación lo cambia.%n%nOpciones y más información: tecnialab.net.ar/tecnia-bot

[Code]
const
  { Windows 10 versión 1809 (octubre de 2018): el mínimo que exige Bun, el
    runtime con el que se compila OpenCode. Por debajo, el binario no arranca. }
  BuildMinimoWindows10 = 17763;

function NombreDelWindows: String;
var
  V: TWindowsVersion;
begin
  GetWindowsVersionEx(V);
  { Windows 11 se reporta como 10.0 con compilación 22000 o más: no hay otra
    forma de distinguirlo. }
  if V.Major >= 10 then
  begin
    if V.Build >= 22000 then
      Result := 'Windows 11'
    else
      Result := 'Windows 10';
  end
  else if (V.Major = 6) and (V.Minor = 3) then
    Result := 'Windows 8.1'
  else if (V.Major = 6) and (V.Minor = 2) then
    Result := 'Windows 8'
  else if (V.Major = 6) and (V.Minor = 1) then
    Result := 'Windows 7'
  else
    Result := 'Windows ' + IntToStr(V.Major) + '.' + IntToStr(V.Minor);
  Result := Result + ' (compilación ' + IntToStr(V.Build) + ')';
end;

{ Devuelve vacío si este Windows sirve. Si no, el motivo, escrito para la
  docente que tiene el cartel adelante: qué tiene, qué hace falta y por qué. }
function MotivoSistemaNoSoportado: String;
var
  V: TWindowsVersion;
  Requisito: String;
begin
  Result := '';
  GetWindowsVersionEx(V);
  Requisito := 'Tecnia Bot necesita Windows 10 (versión 1809, de octubre de 2018, o más nueva) o Windows 11, de 64 bits.';
  if not IsX64Compatible then
    Result := 'Esta computadora tiene un Windows de 32 bits: ' + NombreDelWindows + '.'
      + #13#10#13#10 + Requisito + #13#10#13#10
      + 'OpenCode, el programa sobre el que funciona Tecnia Bot, se distribuye sólo para 64 bits.'
  else if V.Major < 10 then
    Result := 'Esta computadora tiene ' + NombreDelWindows + '.'
      + #13#10#13#10 + Requisito + #13#10#13#10
      + 'No es un capricho del instalador: OpenCode, el programa sobre el que funciona Tecnia Bot, '
      + 'no puede arrancar en este Windows, y ninguna instalación lo cambia.'
  else if (V.Major = 10) and (V.Build < BuildMinimoWindows10) then
    Result := 'Esta computadora tiene ' + NombreDelWindows
      + ', sin las actualizaciones de Windows 10 posteriores a octubre de 2018.'
      + #13#10#13#10 + Requisito + #13#10#13#10
      + 'Actualizá Windows desde Configuración > Actualización y seguridad, y volvé a correr este instalador.';
end;

function InitializeSetup: Boolean;
var
  Motivo: String;
  ErrorCode: Integer;
begin
  Motivo := MotivoSistemaNoSoportado;
  Result := Motivo = '';
  if Result then
    Exit;
  { Al log de Setup siempre, también en silencioso: es lo que llega a soporte. }
  Log('Sistema no soportado. ' + Motivo);
  if WizardSilent then
    Exit;
  if MsgBox(Motivo + #13#10#13#10 + '¿Querés abrir la web de Tecnia Bot para ver qué opciones hay?',
            mbCriticalError, MB_YESNO) = IDYES then
    ShellExec('open', '{#MyAppURL}', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
end;

procedure InitializeWizard;
begin
  { Presencia de marca en TODAS las paginas (no solo Bienvenida/Final): el header
    de las paginas internas va en azul Tecnia Lab con texto blanco. }
  WizardForm.MainPanel.ParentBackground := False;
  WizardForm.MainPanel.Color := $D9286D;  { #6D28D9 (violeta) en formato BGR de Windows }
  WizardForm.PageNameLabel.Font.Color := clWhite;
  WizardForm.PageDescriptionLabel.Font.Color := clWhite;
  { Firma institucional abajo a la izquierda, presente en todas las pantallas. }
  with TLabel.Create(WizardForm) do
  begin
    Parent := WizardForm;
    Caption := 'Tecnia Lab   •   tecnialab.net.ar/tecnia-bot';
    Font.Color := clGray;
    Left := ScaleX(18);
    Top := WizardForm.CancelButton.Top + ScaleY(8);
    Anchors := [akLeft, akBottom];
  end;
end;

function CorrerBootstrap: Boolean;
begin
  { En CI se pasa /skipdeps=1 para probar el instalador sin las dependencias pesadas
    (Scoop/OpenCode/PlatformIO). En una instalación normal, siempre corre. }
  Result := ExpandConstant('{param:skipdeps|0}') <> '1';
end;

var
  MarcaInstalando: String;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  { ── La marca de "instalación en curso" se pone ACÁ, y es a propósito ──────────

    Primero se creaba en [Run], y no alcanzaba: en una máquina que YA tenía Tecnia
    Bot, el acceso directo de la instalación anterior está vivo desde el segundo
    cero. Medido en una VM: el .cmd nuevo recién aparece a los 0,81 s y la marca a
    los 0,94 s. En la VM es un segundo; en una notebook con antivirus escaneando
    los 5,6 MB de archivos chicos son decenas de segundos.

    En esa ventana el docente abría el acceso directo VIEJO, que no sabía nada de
    marcas, y leía "No se encontró OpenCode, volvé a correr el instalador" —
    mientras el instalador estaba corriendo. Pasó de verdad, dos veces.

    ssInstall se dispara apenas se aprieta "Instalar" y ANTES de copiar un solo
    archivo, así que cubre toda la instalación. El borrado sigue en [Run], después
    del bootstrap. }
  if CurStep = ssInstall then
  begin
    MarcaInstalando := ExpandConstant('{app}\.instalando');
    ForceDirectories(ExpandConstant('{app}'));
    SaveStringToFile(MarcaInstalando, '', False);
  end;
end;

procedure DeinitializeSetup();
begin
  { Red de seguridad para el caso en que se cancela a mitad: sin esto la marca
    queda puesta y el lanzador espera de gusto hasta agotar su techo. }
  if MarcaInstalando <> '' then
    DeleteFile(MarcaInstalando);
end;
