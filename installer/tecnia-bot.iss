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
; RedirectionGuard=no, a PROPÓSITO y con pruebas detrás. Inno Setup 6.7.0 (enero 2026)
; activa por defecto la mitigación RedirectionGuard de Windows: el instalador y TODOS
; sus procesos hijos (bootstrap.ps1, y el lanzador cuando se abre desde la última
; pantalla) dejan de poder atravesar junctions creados sin privilegios. Scoop enlaza
; cada app por el junction `apps\<app>\current`: bajo el instalador, opencode.exe
; "no existía", el shim decía "Could not determine if target is a GUI app", Scoop no
; podía rehacer shims ("Can't shim: File doesn't exist") y el bootstrap concluía
; "OpenCode no arranca en esta máquina". Reproducido en la VM: el mismo binario por su
; ruta real contestaba al instante. La mitigación protege contra escaladas de
; privilegios por redirección de rutas; este instalador nunca eleva (lowest) e
; instala en el perfil del usuario, así que no hay privilegio que escalar.
RedirectionGuard=no
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
; En modo silencioso se agrega -SinPrompt. El instalador ofrece cambiar la key de
; Google cuando ya hay una, y espera 60 s por si el docente pega una nueva: frente
; a una persona esta bien, pero en un despliegue desatendido no hay nadie que
; conteste y son 60 s de reloj por maquina. Medido en la VM: una reinstalacion
; sobre una maquina ya configurada paso de instantanea a 63 s. El porque completo
; esta en el encabezado de install\bootstrap.ps1.
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\install\bootstrap.ps1""{code:BanderaSilencio}"; \
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
;
; Este borrado se lleva puesto install\uninstall.ps1 -está adentro de {app}-,
; así que TIENE que pasar después de que [UninstallRun] ya lo corrió. Es el
; orden por defecto de Inno (las entradas de [UninstallRun] se ejecutan al
; entrar a usUninstall, antes de que se borren los archivos de esta sección y
; los de [Files]), y es el mismo orden que ya usaba la versión vieja de esta
; sección: si estuviera al revés, la sola línea `-Conservar` de más abajo ya
; hubiera estado fallando con "no se encontró uninstall.ps1" desde siempre.
Type: filesandordirs; Name: "{app}"

[UninstallRun]
; Dos entradas para la MISMA operación, no una condicional: Inno no permite
; variar los Flags (mostrar consola o no) en runtime dentro de una sola línea,
; así que se listan las dos ramas y cada una se prende con su Check. Nunca
; corren las dos: PurgarDatosPersonales (ver [Code]) ya quedó decidido antes de
; que Inno evalúe estos Check, porque se fija en CurUninstallStepChanged al
; ENTRAR a usUninstall -- el mismo paso en el que Inno procesa esta sección.
;
; RAMA CONSERVAR (default seguro, y la única que corría antes de este cambio):
; sigue oculta como siempre. No hay nada nuevo que confirmar acá.
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\install\uninstall.ps1"" -Conservar"; \
  Flags: runhidden; RunOnceId: "quitarcapa"; Check: not PurgarDatosPersonalesElegido
; RunOnceId DISTINTO al de la rama de arriba, a propósito: Inno ejecuta una
; sola entrada por RunOnceId, y con el mismo id la rama que borra podría no
; correr nunca aunque su Check diera verdadero. Serían dos ramas mutuamente
; excluyentes por Check, así que compartir id no aporta nada y sí arriesga
; dejar muerta en silencio justo la rama que borra datos de menores: un cartel
; que promete borrar y no borra es peor que no ofrecer la opción. No las
; unifiques bajo un mismo id.
;
; RAMA PURGAR: a propósito SIN runhidden. uninstall.ps1 relee cada borrado
; antes de afirmarlo (ver su encabezado) y si un archivo está tomado -por
; ejemplo OpenCode abierto- lo dice por consola y explica qué hacer. Ocultar
; esa consola justo en el único camino que borra datos de menores (Ley
; 25.326) volvería a la desinstalación tan muda como el bug que se está
; arreglando: el docente creería que se borró sin haberlo verificado.
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\install\uninstall.ps1"" -Borrar"; \
  StatusMsg: "Quitando el perfil, la memoria del aula y la key de Google..."; \
  RunOnceId: "quitarcapaborrar"; Check: PurgarDatosPersonalesElegido

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

function BanderaSilencio(Value: String): String;
begin
  { Quien sabe que no hay nadie mirando es el instalador, no el script.
    Corriendo por /VERYSILENT hay una consola REAL (vacía, pero real), así que
    bootstrap.ps1 no puede deducirlo: su sondeo de teclado no falla, espera los
    60 s completos y recién ahí sigue. Por eso la seña baja desde acá.
    Se antepone un espacio porque esto se concatena pegado al -File de arriba. }
  if WizardSilent() then
    Result := ' -SinPrompt'
  else
    Result := '';
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

{ ── Preguntar si se purgan los datos personales al desinstalar ────────────────

  Antes de este cambio, [UninstallRun] llamaba SIEMPRE a uninstall.ps1 con
  -Conservar: el desinstalador estándar de Windows (Panel de control > Agregar
  o quitar programas) nunca ofrecía la alternativa, y el perfil del aula, la
  memoria (datos de MENORES, Ley 25.326, ver opencode/tool/perfil.ts) y la key
  de Google quedaban siempre en la máquina. Una notebook que se reasigna o se
  dona por ese camino se iba con eso adentro. }
var
  PurgarDatosPersonales: Boolean;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  { usUninstall: se dispara al ENTRAR a ese paso, antes de que Inno procese
    las secciones [UninstallDelete] y [UninstallRun] -el porqué está anotado en la
    primera de las dos-.

    OJO, REGLA DEL ARCHIVO: ningún renglón de un .iss puede EMPEZAR con '#' ni con
    '[', NI SIQUIERA adentro de un comentario Pascal como éste. ISCC los lee como
    directiva de preprocesador o como encabezado de sección ANTES de mirar el
    Pascal, y aborta con "Unknown preprocessor directive" o "Invalid section tag".
    Las dos cosas pasaron acá y ninguna la vio el chequeo de sintaxis: sólo ISCC.
    Preguntar acá y no en InitializeUninstall es a propósito: InitializeUninstall
    corre ANTES del cartel de confirmación propio de Inno ("¿Seguro que querés
    quitar Tecnia Bot?"), y preguntar por datos personales antes de que el
    docente confirme siquiera que quiere desinstalar es un orden que no cierra. }
  if CurUninstallStep = usUninstall then
  begin
    if UninstallSilent() then
      { /SILENT o /VERYSILENT: nadie va a leer un cartel. Mismo default seguro
        que ya usa uninstall.ps1 cuando nadie contesta su propia pregunta: se
        conserva. Un despliegue desatendido (ej. limpiar veinte notebooks con un
        script) NO puede terminar borrando datos de menores porque nadie
        estaba mirando la pantalla. }
      PurgarDatosPersonales := False
    else
      { MB_DEFBUTTON2 deja "No" resaltado: quien aprieta Enter sin leer, o
        cierra el cartel con la X (que en Windows equivale a "No" cuando no hay
        botón Cancelar), se queda en el mismo default seguro que el modo
        silencioso. Se compara contra IDYES a propósito, no contra <> IDNO: así
        CUALQUIER respuesta que no sea un "Sí" explícito conserva los datos,
        sin tener que enumerar cada variante de "no elegí nada".
        Por qué el default es CONSERVAR y no BORRAR, con las dos lecturas de
        "seguro" en la cabeza: borrar es IRREVERSIBLE y con más facilidad se
        dispara sin querer (un clic de más en un desinstalador corrido en
        tanda), y conservar sigue siendo corregible después a mano o volviendo
        a correr el desinstalador y eligiendo borrar. Perder la memoria de un
        aula armada durante meses por default es un costo más alto y más
        silencioso que dejarla en una compu que igual ya no tiene más Tecnia
        Bot instalado. }
      PurgarDatosPersonales := (MsgBox(
        'Además de Tecnia Bot, esta compu tiene guardado el perfil y la memoria ' +
        'del aula (lo que el asistente aprendió de quien lo usó) y, si cargaste ' +
        'una, tu API key de Google.' + #13#10 + #13#10 +
        'Son datos PERSONALES -de menores, en el modo "grupo" (Ley 25.326)- y una ' +
        'credencial tuya. Si esta compu se va a donar, reasignar o resetear, ' +
        'conviene borrarlos.' + #13#10 + #13#10 +
        '¿Los querés borrar también, junto con el programa? Esto NO se puede deshacer.' + #13#10 +
        '(Si elegís "No", quedan en la compu; los podés borrar después a mano ' +
        'o volviendo a correr este desinstalador.)',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES);
  end;
end;

function PurgarDatosPersonalesElegido: Boolean;
begin
  { Función puente para el Check: de [UninstallRun] -- Check: necesita el
    NOMBRE de una función, no puede evaluar la variable directamente. }
  Result := PurgarDatosPersonales;
end;
