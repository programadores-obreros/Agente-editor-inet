; ============================================================================
; Tecnia Bot — instalador .exe para Windows (Inno Setup 6).
;
; Se COMPILA en Windows con Inno Setup (o solo, vía GitHub Actions:
; .github/workflows/build-installer.yml). Produce: installer\dist\Instalar-Tecnia-Bot.exe
;
; La versión se pasa por línea de comando y, si no, cae al valor por defecto:
;   ISCC /DMyAppVersion=0.2.0 tecnia-bot.iss
;
; Qué hace el .exe, en orden, SIN pedir permisos de administrador:
;   1. Copia la capa educativa (agentes + skills + herramientas + web) a la carpeta del programa.
;   2. Corre bootstrap.ps1: instala Scoop + OpenCode + PlatformIO y publica la capa en la config de OpenCode.
;   3. Crea accesos directos (menú inicio + escritorio) que abren el bot con un doble clic.
; ============================================================================

#ifndef MyAppVersion
  #define MyAppVersion "0.2.0"
#endif
#define MyAppName "Tecnia Bot"
#define MyAppPublisher "Programadores Obreros"
#define MyAppURL "https://github.com/programadores-obreros/Agente-editor-inet"

[Setup]
; GUID propio de este producto (no reutilizar el de otro programa).
AppId={{7F3A9C22-5B4E-4D1A-9E62-1C8B7A0F5D34}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
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

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos directos:"

[Files]
; La capa educativa (agentes, skills, herramientas, web): el corazón del bot.
Source: "..\opencode\*"; DestDir: "{app}\opencode"; Flags: recursesubdirs createallsubdirs ignoreversion
; Los scripts que instalan las dependencias y publican la capa.
Source: "..\install\*"; DestDir: "{app}\install"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "..\VERSION"; DestDir: "{app}"; Flags: ignoreversion
Source: "abrir-tecnia-bot.cmd"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\abrir-tecnia-bot.cmd"; WorkingDir: "{app}"; Comment: "Abrir Tecnia Bot"
Name: "{autoprograms}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\abrir-tecnia-bot.cmd"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; Instala OpenCode + PlatformIO + la capa (sin admin, vía Scoop). Se muestra la
; consola a propósito: tarda varios minutos y así el docente ve que avanza.
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\install\bootstrap.ps1"""; \
  WorkingDir: "{app}"; \
  StatusMsg: "Instalando OpenCode, PlatformIO y Tecnia Bot (puede tardar varios minutos)..."; \
  Flags: waituntilterminated
; Ofrece abrir el bot al terminar (casilla marcada en la última pantalla).
Filename: "{app}\abrir-tecnia-bot.cmd"; Description: "Abrir Tecnia Bot ahora"; \
  Flags: postinstall skipifsilent nowait

[UninstallRun]
; Quita solo la capa de la config de OpenCode (no toca OpenCode ni los proyectos del docente).
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\install\uninstall.ps1"""; \
  Flags: runhidden; RunOnceId: "quitarcapa"
