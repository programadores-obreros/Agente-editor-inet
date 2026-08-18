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

; ── Sólo 64 bits ─────────────────────────────────────────────────────────────
;
; OpenCode se distribuye únicamente como opencode-windows-x64.zip. Sin esta
; línea, en una notebook de 32 bits el instalador copiaba toda la capa, corría el
; bootstrap, y recién ahí fallaba Scoop con un error que no dice "tu Windows no
; sirve". Mejor decirlo en la primera pantalla y no hacer perder diez minutos.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; PowerShell 5.1 y las APIs que usa el bootstrap: Windows 10 para arriba.
MinVersion=10.0

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

[Code]
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
