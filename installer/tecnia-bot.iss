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
;
; CÓDIGOS DE SALIDA DEL .exe (para quien lo despliega con /VERYSILENT):
;   0      todo quedó instalado y bootstrap.ps1 lo comprobó (o se pasó /skipdeps=1,
;          que saltea el bootstrap: ahí sólo se copiaron archivos).
;   1 a 8  los de Inno Setup ("Setup Exit Codes" en su ayuda): cancelado, error al
;          copiar, etc.
;   20     se copiaron los archivos pero bootstrap.ps1 FALLÓ o no se pudo lanzar:
;          Tecnia Bot no quedó usable.
;   21     quedó instalado pero DEGRADADO: el bot abre, falta PlatformIO, Node, o
;          la versión probada de OpenCode.
; 20 y 21 son propios (función GetCustomSetupExitCode, en la sección de código) y
; salen del código con que termina install\bootstrap.ps1, cuyo encabezado
; documenta el contrato 0 / 2 / 1.
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

[InstallDelete]
; Borra {app}\opencode ENTERO antes de recopiarlo desde la sección de archivos,
; en cada instalación (nueva o encima de una existente).
;
; POR QUÉ. {app}\opencode es sólo la copia MAESTRA del fuente, de la que
; install\install.ps1 publica la capa educativa a la config real de OpenCode
; (%USERPROFILE%\.config\opencode). Nunca es donde vive el trabajo del docente:
; el perfil, la memoria del aula y la key de Google quedan en esa OTRA carpeta,
; fuera de {app} por completo. Sin este borrado, instalar un .exe encima de otro
; sólo agrega y pisa: un archivo que la versión nueva eliminó o renombró queda
; en la copia maestra, install.ps1 lo vuelve a publicar, y el bot termina con
; piezas de dos versiones (OpenCode levanta cualquier .ts que encuentre bajo
; tool\). Con este borrado, cada instalación deja {app}\opencode como una foto
; exacta del .exe que se corrió.
;
; Este mecanismo se diseñó en la línea de desarrollo siguiente y se trae acá
; porque el defecto que cierra no depende de ella. install\update.ps1 hace lo
; mismo por su lado cuando la actualización llega por /actualizar.
;
; Límite conocido: sólo protege instalaciones hechas CON un .exe que ya trae
; esta línea. Volver a un .exe VIEJO corre las secciones de ESE .exe, que no la
; tiene: para bajar de versión, desinstalar primero (ver docs\rollback.md).
Type: filesandordirs; Name: "{app}\opencode"

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
; EL BOOTSTRAP YA NO SE LANZA DESDE ESTA SECCIÓN, y es a propósito.
;
; Acá había una entrada con `Flags: waituntilterminated` que corría bootstrap.ps1.
; Inno espera a que una entrada de esta sección termine, pero NO mira con qué
; código terminó: el bootstrap podía salir con 1 sin haber instalado nada y el
; asistente mostraba igual su pantalla de "quedó instalado". Con /VERYSILENT el
; .exe devolvía 0. En una notebook real pasó exactamente eso: el paso murió en
; 2,4 segundos, pantalla verde, y no había nada instalado.
;
; Ahora lo lanza CorrerElBootstrap (sección de código, desde CurStepChanged en
; ssPostInstall) con Exec, que sí devuelve el código de salida. Con ese código se
; arma la última pantalla y el código de salida del .exe. Lo que hacía la entrada
; vieja se conserva todo allá: consola visible, -SinPrompt en silencioso, el
; salteo con /skipdeps=1, la carpeta de trabajo, y el borrado de la marca
; ".instalando" después del bootstrap y pase lo que pase.
;
; NO VUELVAS A AGREGAR ACÁ UNA ENTRADA QUE CORRA bootstrap.ps1: correría dos veces.
;
; Al terminar (casillas marcadas en la última pantalla): abrir la web oficial de
; Tecnia Bot (primeros pasos) y abrir el bot.
; LA CASILLA DE LA WEB VIENE DESTILDADA. Visto en una maquina virtual con Windows 11
; recien instalado (2026-11-21): con las dos casillas tildadas, el navegador abre
; su pantalla de bienvenida a pantalla completa y TAPA la ventana de Tecnia Bot. El
; docente termina de instalar y ve el navegador, no el bot. El texto de la pantalla
; final sigue nombrando la web, asi que el que la quiere la tilda.
Filename: "{#MyAppURL}"; Description: "Visitar la web de Tecnia Bot (primeros pasos)"; \
  Flags: postinstall shellexec skipifsilent unchecked
; La casilla de abrir el bot se ofrece SÓLO si el bootstrap dejó un bot que abre
; (bien o degradado). Antes aparecía tildada siempre: con el bootstrap caído, la
; pantalla decía "NO quedó instalado" y debajo ofrecía abrirlo. Las entradas
; postinstall se evalúan después de ssPostInstall (lo verificó la revisión contra
; las fuentes de Inno), así que para entonces el resultado ya se conoce.
Filename: "{app}\abrir-tecnia-bot.cmd"; Description: "Abrir Tecnia Bot ahora"; \
  Check: OfrecerAbrirElBot; \
  Flags: postinstall skipifsilent nowait

[UninstallDelete]
; Inno borra sólo los archivos que él instaló. En la carpeta del programa quedaba
; lo que nació después: la marca .instalando y los instalacion*.log que escribe
; bootstrap.ps1. Un desinstalador que deja carpetas es el que hace dudar de si
; desinstaló.
;
; ESTA SECCIÓN ESTUVO VACÍA, sin querer. Un arreglo de la desinstalación (el que
; mudó la ejecución de uninstall.ps1 a la sección de código, ver más abajo) sacó
; de acá la entrada que barría la carpeta junto con la sección UninstallRun, y
; dejó el comentario cortado a mitad de una frase. Desde entonces la carpeta del
; programa quedaba en el disco después de desinstalar.
;
; SE BORRA POR LISTA, NO SE BARRE LA CARPETA ENTERA, y es a propósito.
;
; La entrada que había era `Type: filesandordirs` sobre la carpeta del programa
; completa, con el argumento "ahí no hay nada del docente". Ese argumento NO es
; cierto en todas las máquinas: hasta este cambio el lanzador no verificaba que
; hubiera podido entrar a Documentos, y si no podía, OpenCode arrancaba parado
; en la carpeta del programa y los proyectos del alumno quedaban AHÍ. El
; lanzador ya lo impide (aborta si no puede entrar a la carpeta de proyectos),
; pero eso protege de acá en adelante: lo que versiones anteriores hayan dejado
; ahí adentro sigue estando. Barrer la carpeta entera lo borraría sin avisar.
;
; Entonces se borra lo que se sabe que es nuestro, y la carpeta sólo si quedó
; vacía. Si queda algo que el instalador no puso, NO se toca, y el código avisa
; qué quedó y dónde (AvisarLoQueQuedo, en usPostUninstall), separando lo que es
; nuestro y no se pudo borrar de lo que el instalador nunca puso.
;
; install\ y opencode\ se borran enteras: son la copia maestra de los scripts y
; de la capa, nunca la carpeta de trabajo de nadie (mismo criterio que la sección
; InstallDelete, más arriba). uninstall.ps1 vive en install\, pero para cuando
; se procesa esta sección ya corrió: se ejecuta en usUninstall, que es anterior.
Type: files; Name: "{app}\.instalando"
Type: files; Name: "{app}\instalacion.log"
Type: files; Name: "{app}\instalacion-*.log"
Type: filesandordirs; Name: "{app}\install"
Type: filesandordirs; Name: "{app}\opencode"
Type: dirifempty; Name: "{app}"

; ── Por qué acá NO hay una sección UninstallRun ──────────────────────────────
;
; Esa sección quedó
; VACIA A PROPOSITO, y esto es el corazon del bug que se arreglo acá.
;
; Antes había dos entradas mutuamente excluyentes por `Check`, una con
; `-Conservar` y otra con `-Borrar`, y la de borrar NUNCA CORRIO. No fallaba:
; no existía. Verificado leyendo el `unins000.dat` de una instalación real en
; la VM: sólo estaba grabada la de `-Conservar`, con su `quitarcapa`. De la
; otra, ni rastro.
;
; POR QUE: Inno escribe las entradas de [UninstallRun] en el log de
; desinstalación DURANTE LA INSTALACION, y evalúa su `Check` AHI. En ese
; momento `PurgarDatosPersonales` vale False -es su default, y
; `CurUninstallStepChanged` ni siquiera corre durante el install-, así que
; `Check: not PurgarDatosPersonalesElegido` daba True y grababa la rama de
; conservar, mientras `Check: PurgarDatosPersonalesElegido` daba False y la de
; borrar no se grababa nunca. Al desinstalar, el comando de borrar no existía
; en ningún lado: de ahí que apretar "Si" no borrara nada y que no apareciera
; ninguna consola.
;
; El comentario que estaba acá afirmaba lo contrario ("ya quedó decidido antes
; de que Inno evalúe estos Check... el mismo paso en el que Inno procesa esta
; sección"). Era la creencia equivocada que originó el bug, escrita con
; confianza al lado del código que rompía.
;
; NO VUELVAS A PONER UNA DECISION DE TIEMPO DE DESINSTALACION ACA. Una
; decisión que se toma cuando el docente aprieta un botón no puede vivir en
; una sección que se resolvió meses antes, cuando instaló.
;
; La ejecución ahora vive en [Code], en CurUninstallStepChanged, que sí corre
; al desinstalar y sí ve la respuesta del cartel.

[Messages]
; Textos branded del asistente.
WelcomeLabel1=Bienvenido/a a Tecnia Bot
WelcomeLabel2=Tecnia Bot es el asistente que te acompaña para enseñar Arduino y ESP32 en la escuela técnica: explica el porqué, da código comentado y traduce los errores.%n%nEl asistente instala TODO lo necesario y no hace falta ser administrador. Tocá Siguiente para empezar.
; Los dos textos de la última pantalla son NEUTROS a propósito: acá decía
; "¡Tecnia Bot quedó instalado!" fijo, saliera como saliera el bootstrap. El texto
; que afirma algo se pone desde el código (CurPageChanged), según lo que
; bootstrap.ps1 comprobó. Si ese código no llegara a correr, queda esto, que no
; promete nada.
FinishedHeadingLabel=Terminó el asistente de Tecnia Bot
FinishedLabel=El asistente terminó de copiar los archivos de Tecnia Bot.

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
    Se antepone un espacio porque esto se concatena pegado al -File que arma
    CorrerElBootstrap, más abajo. El parámetro no se usa: quedó de cuando esto se
    llamaba desde una constante de la sección Run. }
  if WizardSilent() then
    Result := ' -SinPrompt'
  else
    Result := '';
end;

const
  { Contrato con install\bootstrap.ps1: ver CODIGOS DE SALIDA en su encabezado.
    Hay un test (tests/instalador-honesto.test.mjs) que compara los dos archivos:
    si allá cambia el número de "degradado", acá tiene que cambiar también. }
  CodigoBootstrapOk = 0;
  CodigoBootstrapDegradado = 2;

  { Códigos de salida PROPIOS del .exe. Inno usa del 0 al 8 y avisa que puede
    sumar más: por eso arrancan lejos. Documentados en el encabezado del archivo. }
  SalidaSetupFallo = 20;
  SalidaSetupDegradado = 21;

  { Cómo terminó el bootstrap. 0 es "todavía no se intentó" porque es el valor con
    que nace una variable global: si algo se saltea el paso, NO queda en "bien". }
  EstadoSinCorrer = 0;
  EstadoSalteado = 1;
  EstadoBien = 2;
  EstadoDegradado = 3;
  EstadoFallo = 4;
  EstadoNoLanzo = 5;

var
  MarcaInstalando: String;
  EstadoBootstrap: Integer;
  CodigoBootstrap: Integer;

{ El Check de la casilla "Abrir Tecnia Bot ahora" de la sección Run. Verdadero
  sólo si el bootstrap terminó y dejó un bot que abre. Salteado, caído, sin
  lanzar o sin correr: no se ofrece abrir algo que no se comprobó que abra. }
function OfrecerAbrirElBot: Boolean;
begin
  Result := (EstadoBootstrap = EstadoBien) or (EstadoBootstrap = EstadoDegradado);
end;

{ ── El bootstrap se lanza desde acá, y se LEE cómo terminó ────────────────────

  Antes era una entrada de la sección Run con "waituntilterminated", que espera
  pero no mira el código de salida (el porqué largo está en esa sección).

  Exec devuelve dos cosas distintas y se guardan las dos:
    - el Boolean: si Windows pudo LANZAR powershell.exe. Si da False, el entero
      trae el código de error de Windows, no un código del script.
    - el entero: con qué código terminó el script, si se lanzó.

  Se conserva lo que hacía la entrada vieja: consola visible (SW_SHOWNORMAL: tarda
  minutos y el docente tiene que ver que avanza), -SinPrompt en silencioso
  (BanderaSilencio), el salteo con /skipdeps=1 (CorrerBootstrap), y la carpeta de
  instalación como carpeta de trabajo. }
procedure CorrerElBootstrap;
var
  Parametros: String;
begin
  if not CorrerBootstrap then
  begin
    EstadoBootstrap := EstadoSalteado;
    Log('Tecnia Bot: bootstrap.ps1 NO se corre (/skipdeps=1).');
    Exit;
  end;

  WizardForm.StatusLabel.Caption :=
    'Instalando OpenCode, PlatformIO y Tecnia Bot (puede tardar varios minutos)...';
  WizardForm.FilenameLabel.Caption := '';

  Parametros := '-ExecutionPolicy Bypass -NoProfile -File "'
    + ExpandConstant('{app}\install\bootstrap.ps1') + '"' + BanderaSilencio('');

  if Exec('powershell.exe', Parametros, ExpandConstant('{app}'),
          SW_SHOWNORMAL, ewWaitUntilTerminated, CodigoBootstrap) then
  begin
    if CodigoBootstrap = CodigoBootstrapOk then
      EstadoBootstrap := EstadoBien
    else if CodigoBootstrap = CodigoBootstrapDegradado then
      EstadoBootstrap := EstadoDegradado
    else
      EstadoBootstrap := EstadoFallo;
  end
  else
    EstadoBootstrap := EstadoNoLanzo;

  Log(Format('Tecnia Bot: bootstrap.ps1 -> estado %d, codigo %d.', [EstadoBootstrap, CodigoBootstrap]));
end;

function RutaLogBootstrap: String;
begin
  Result := ExpandConstant('{app}\instalacion.log');
end;

{ Cartel para cuando el bootstrap falló, sólo si hay alguien mirando. La última
  pantalla también lo dice, pero ahí el texto tiene que ser corto (comparte lugar
  con las casillas) y es fácil apretar "Finalizar" sin leer.

  Nombra los accesos directos con el MISMO define que los crea en la sección Icons,
  para que no se pueda mandar al docente a buscar uno que no existe. Y el log se
  menciona sólo si está en el disco: si el bootstrap murió antes de abrirlo, no
  hay nada que ir a leer. }
procedure AvisarSiElBootstrapFallo;
var
  Texto: String;
begin
  if WizardSilent() then
    Exit;
  if (EstadoBootstrap <> EstadoFallo) and (EstadoBootstrap <> EstadoNoLanzo) then
    Exit;

  if EstadoBootstrap = EstadoNoLanzo then
    Texto := 'No pude iniciar PowerShell para instalar OpenCode, PlatformIO y la capa de '
      + 'Tecnia Bot (error ' + IntToStr(CodigoBootstrap) + ' de Windows: '
      + SysErrorMessage(CodigoBootstrap) + ').'
  else
    Texto := 'Se copiaron los archivos, pero la instalación de OpenCode y de la capa de '
      + 'Tecnia Bot NO terminó bien (código ' + IntToStr(CodigoBootstrap) + ').';

  Texto := Texto + #13#10 + #13#10
    + 'Tecnia Bot todavía NO está listo para usar.' + #13#10 + #13#10
    + 'No hace falta volver a bajar el instalador. En el menú inicio:' + #13#10
    + '  "Reparar {#MyAppName}"  vuelve a intentar lo que faltó.' + #13#10
    + '  "Diagnostico de {#MyAppName}"  dice qué anda y qué no.';

  if FileExists(RutaLogBootstrap) then
    Texto := Texto + #13#10 + #13#10 + 'El detalle de lo que pasó quedó escrito en:' + #13#10
      + '  ' + RutaLogBootstrap;

  MsgBox(Texto, mbError, MB_OK);
end;

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
    archivo, así que cubre toda la instalación. El borrado está más abajo, en este
    mismo procedimiento, después del bootstrap. }
  if CurStep = ssInstall then
  begin
    MarcaInstalando := ExpandConstant('{app}\.instalando');
    ForceDirectories(ExpandConstant('{app}'));
    SaveStringToFile(MarcaInstalando, '', False);
  end;

  { ── El bootstrap corre ACÁ, y la marca se borra pase lo que pase ───────────────

    ssPostInstall: los archivos ya están copiados, así que bootstrap.ps1 existe.

    La marca se borra en el "finally": salga el bootstrap con 0, con 1, no se
    haya podido lanzar, o tire una excepción el propio script de Inno. Antes la
    borraba una entrada de la sección Run puesta después de la del bootstrap; al
    mudar el bootstrap acá, el borrado se muda con él, para no depender del
    orden entre este evento y esa sección (que NO está comprobado: ver el
    mensaje del commit). DeinitializeSetup sigue de red por si se cancela antes. }
  if CurStep = ssPostInstall then
  begin
    try
      CorrerElBootstrap;
    finally
      if MarcaInstalando <> '' then
        DeleteFile(MarcaInstalando);
    end;
    AvisarSiElBootstrapFallo;
  end;
end;

{ ── La última pantalla dice lo que el bootstrap COMPROBÓ ──────────────────────

  El título fijo "¡Tecnia Bot quedó instalado!" se mostraba siempre. Ahora hay un
  texto por resultado, y el que afirma que quedó instalado aparece únicamente
  cuando bootstrap.ps1 salió con 0, que es su "todo comprobado".

  EL ALTO DE LAS ETIQUETAS SE REAJUSTA A MANO, Y SIN ESO EL TEXTO SALE CORTADO.
  Inno calcula el alto del título una sola vez, al construir el asistente, y el
  del texto junto con la posición de las casillas en ChangeFinishedLabel, que
  corre ANTES de este evento (Setup.WizardForm.pas de la 6.7.0, líneas 1081 a
  1084 y 1458 a 1467; lo señaló la revisión). Cambiar el Caption después no
  reajusta nada: un texto más largo que el original quedaba recortado y las
  casillas donde estaban. Lo que sigue repite, con los mismos pasos y en el mismo
  orden, lo que hace Inno: ajustar el título, colgar el texto debajo, ajustar el
  texto, y correr las casillas y los botones de reinicio por la diferencia.
  AdjustHeight, YesRadio, NoRadio y RunList están registrados para el script en
  Compiler.ScriptClasses.pas de esa misma versión. }
procedure CurPageChanged(CurPageID: Integer);
var
  Titulo: String;
  Texto: String;
  Y: Integer;
  Corrimiento: Integer;
begin
  if CurPageID <> wpFinished then
    Exit;

  if EstadoBootstrap = EstadoBien then
  begin
    Titulo := '¡Tecnia Bot quedó instalado!';
    Texto :=
      '¡Listo! Arrancá por la web de Tecnia Bot (tecnialab.net.ar/tecnia-bot) para ver '
      + 'los primeros pasos, y abrilo desde el menú inicio o el escritorio. Recordá '
      + 'instalar los drivers USB de tu placa si todavía no lo hiciste.';
  end
  else if EstadoBootstrap = EstadoDegradado then
  begin
    { Decía "la ventana negra lo detalló al final". Para cuando se lee esta
      pantalla esa ventana ya se cerró: se mandaba a mirar algo que no está. El
      detalle quedó en el log, y se lo nombra sólo si está en el disco. }
    Titulo := 'Tecnia Bot quedó instalado, pero incompleto';
    Texto :=
      'El bot abre, pero faltó algo (PlatformIO, Node, la versión probada de OpenCode, '
      + 'o parte de la configuración). Para completarlo, en el menú inicio abrí "Reparar {#MyAppName}".';
    if FileExists(RutaLogBootstrap) then
      Texto := Texto + ' Qué faltó quedó escrito en: ' + RutaLogBootstrap;
  end
  else if EstadoBootstrap = EstadoSalteado then
  begin
    Titulo := 'Se copiaron los archivos de Tecnia Bot';
    Texto :=
      'Se salteó la instalación de OpenCode, PlatformIO y la capa (/skipdeps=1). '
      + 'Para instalarlos, en el menú inicio abrí "Reparar {#MyAppName}".';
  end
  else
  begin
    { EstadoFallo, EstadoNoLanzo, y también EstadoSinCorrer: si por lo que sea el
      paso del bootstrap no llegó a correr, no se festeja nada. }
    Titulo := 'Tecnia Bot NO quedó instalado';
    Texto :=
      'Se copiaron los archivos, pero la instalación de OpenCode y de la capa no '
      + 'terminó bien. No hace falta volver a bajar el instalador: en el menú inicio '
      + 'abrí "Reparar {#MyAppName}". Si vuelve a fallar, "Diagnostico de {#MyAppName}" dice por qué.';
  end;

  { El salto de línea final lo agrega también Inno a sus dos textos: deja el
    renglón de aire entre el título, el texto y las casillas. }
  WizardForm.FinishedHeadingLabel.Caption := Titulo + #13#10;
  Corrimiento := WizardForm.FinishedHeadingLabel.AdjustHeight;
  WizardForm.FinishedLabel.Top :=
    WizardForm.FinishedHeadingLabel.Top + WizardForm.FinishedHeadingLabel.Height;

  WizardForm.FinishedLabel.Caption := Texto + #13#10;
  Corrimiento := WizardForm.FinishedLabel.AdjustHeight;

  { Todo lo que cuelga debajo del texto se corre por la diferencia entre dónde
    termina ahora y dónde estaba (YesRadio marca ese renglón, igual que en Inno). }
  Y := WizardForm.FinishedLabel.Top + WizardForm.FinishedLabel.Height;
  Corrimiento := Y - WizardForm.YesRadio.Top;
  WizardForm.RunList.Top := WizardForm.RunList.Top + Corrimiento;
  WizardForm.RunList.Height := WizardForm.RunList.Height - Corrimiento;
  WizardForm.YesRadio.Top := Y;
  WizardForm.NoRadio.Top := Y + ScaleY(22);
end;

{ ── El .exe sale con un código propio si el bootstrap no salió bien ────────────

  GetCustomSetupExitCode es el mecanismo documentado de Inno para esto ("Return a
  non-zero number to instruct Setup to return a custom exit code. This function is
  only called if Setup was successfully run to completion and the exit code would
  have been 0", ayuda de Inno Setup, "Pascal Scripting: Event Functions").

  Es lo que le faltaba a un despliegue con /VERYSILENT: sin pantalla que leer, el
  código de salida es lo ÚNICO que le llega a quien corre el instalador en veinte
  máquinas, y era 0 aunque el bootstrap no hubiera instalado nada. }
function GetCustomSetupExitCode: Integer;
begin
  Result := 0;
  if EstadoBootstrap = EstadoDegradado then
    Result := SalidaSetupDegradado
  else if (EstadoBootstrap = EstadoFallo) or (EstadoBootstrap = EstadoNoLanzo)
          or (EstadoBootstrap = EstadoSinCorrer) then
    Result := SalidaSetupFallo;
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
const
  { Contrato con install\uninstall.ps1, acordado con quien lo mantiene:
      0             todo lo que había que borrar se borró (y lo releyó).
      3             desinstalación PARCIAL: quedó algo sin borrar.
      cualquier otro distinto de 0: falló.
    Acá alcanza con distinguir el 3 para decirlo con las palabras justas; todo
    lo que no sea 0 se trata como "no puedo afirmar que se haya borrado". }
  CodigoUninstallParcial = 3;

var
  PurgarDatosPersonales: Boolean;

{ Las dos carpetas de OpenCode, resueltas con el MISMO criterio que
  install\uninstall.ps1 (XDG_CONFIG_HOME / XDG_DATA_HOME si están puestas, y si no
  las del perfil). Antes el cartel las nombraba relativas ("de estas dos carpetas
  de tu usuario"); con la ruta entera el docente no tiene que adivinar cuál es. }
function CarpetaConfigOpenCode: String;
begin
  if GetEnv('XDG_CONFIG_HOME') <> '' then
    Result := AddBackslash(GetEnv('XDG_CONFIG_HOME')) + 'opencode'
  else
    Result := AddBackslash(GetEnv('USERPROFILE')) + '.config\opencode';
end;

function CarpetaDatosOpenCode: String;
begin
  if GetEnv('XDG_DATA_HOME') <> '' then
    Result := AddBackslash(GetEnv('XDG_DATA_HOME')) + 'opencode'
  else
    Result := AddBackslash(GetEnv('USERPROFILE')) + '.local\share\opencode';
end;

{ Los archivos de datos personales que SIGUEN EN EL DISCO, uno por renglón.

  Es la comprobación propia del desinstalador, y no depende de lo que diga el
  script: se mira el mundo, no el reporte del mundo. Si el docente eligió borrar
  y uno de estos tres archivos todavía existe, no se borró, haya salido el script
  con el código que haya salido.

  La key de Google NO entra acá: auth.json sigue existiendo aunque se haya
  borrado bien (uninstall.ps1 saca sólo el bloque "google"), así que la
  existencia del archivo no dice nada. De eso sólo se sabe por el código. }
function DatosPersonalesQueSiguen: String;
var
  Carpeta: String;
begin
  Result := '';
  Carpeta := AddBackslash(CarpetaConfigOpenCode);
  if FileExists(Carpeta + 'tecnia-perfil.md') then
    Result := Result + '  ' + Carpeta + 'tecnia-perfil.md' + #13#10;
  if FileExists(Carpeta + 'tecnia-memoria.md') then
    Result := Result + '  ' + Carpeta + 'tecnia-memoria.md' + #13#10;
  if FileExists(Carpeta + 'tecnia-cargas.json') then
    Result := Result + '  ' + Carpeta + 'tecnia-cargas.json' + #13#10;
end;

{ El cartel de "la desinstalación no salió entera". Un solo lugar arma el texto
  para los cuatro casos, y cada frase sale de algo que se comprobó:
    - Lanzo = False       Windows no pudo iniciar PowerShell (Codigo es su error).
    - Codigo = parcial    el script dice que quedó algo.
    - Codigo otro <> 0    el script falló; no se sabe qué borró.
    - Codigo = 0 pero Siguen <> ''   el script dijo que sí y el disco dice que no. }
procedure AvisarDesinstalacionIncompleta(Lanzo: Boolean; Codigo: Integer; Siguen: String);
var
  Texto: String;
begin
  if not Lanzo then
    Texto := 'No pude iniciar el script que desinstala Tecnia Bot (error '
      + IntToStr(Codigo) + ' de Windows: ' + SysErrorMessage(Codigo) + ').'
  else if Codigo = CodigoUninstallParcial then
    Texto := 'La desinstalación quedó INCOMPLETA: hubo cosas que no se pudieron borrar.'
  else if Codigo <> 0 then
    Texto := 'El script que desinstala Tecnia Bot terminó con un error (código '
      + IntToStr(Codigo) + '). No puedo asegurar qué se borró y qué no.'
  else
    Texto := 'El script que desinstala Tecnia Bot dijo que terminó bien, pero en el '
      + 'disco siguen quedando datos personales.';

  if PurgarDatosPersonales then
  begin
    if Siguen <> '' then
      Texto := Texto + #13#10 + #13#10
        + 'Elegiste borrar los datos personales y ESTOS SIGUEN EN ESTA COMPUTADORA '
        + '(lo acabo de mirar en el disco):' + #13#10 + Siguen
    else if (not Lanzo) or (Codigo <> 0) then
      Texto := Texto + #13#10 + #13#10
        + 'Elegiste borrar los datos personales. El perfil, la memoria del aula y el '
        + 'registro de cargas ya no están en el disco.';
    if (not Lanzo) or (Codigo <> 0) then
      Texto := Texto + #13#10
        + 'La key de Google no la puedo comprobar desde acá. Si cargaste una, se '
        + 'guarda adentro de este archivo:' + #13#10
        + '  ' + AddBackslash(CarpetaDatosOpenCode) + 'auth.json';
  end;

  if (not Lanzo) or (Codigo <> 0) then
    Texto := Texto + #13#10 + #13#10
      + 'Lo que haya quedado de Tecnia Bot (agente, skills, herramientas) está en:' + #13#10
      + '  ' + CarpetaConfigOpenCode;

  Texto := Texto + #13#10 + #13#10
    + 'Suele pasar cuando Tecnia Bot (OpenCode) está abierto. Cerralo y borrá a mano '
    + 'lo que figura arriba. Si vas a entregar o reasignar la máquina, no la entregues '
    + 'sin revisarlo.';

  MsgBox(Texto, mbError, MB_OK);
end;

{ ── Lo que quedó en la carpeta del programa después de desinstalar ─────────────

  La sección UninstallDelete borra por lista y deja la carpeta si no quedó vacía
  (el porqué está allá). Esto mira qué quedó, DESPUÉS de desinstalar, y lo dice:
  una carpeta que sobrevive en silencio es justo lo que hace dudar de si se
  desinstaló.

  SE SEPARA LO PROPIO DE LO AJENO, porque son dos noticias distintas. La primera
  versión juntaba todo y decía "pueden ser proyectos guardados ahí por error":
  si lo que había quedado era NUESTRO -la carpeta opencode con un archivo
  tomado, un log abierto-, se le decía al docente que eran proyectos suyos algo
  que era un borrado que falló. Lo encontró la revisión.

  EsNuestro es EL lugar donde está la lista de lo que este instalador pone en la
  carpeta del programa. Tiene que coincidir con lo que declaran las secciones
  Files y UninstallDelete; hay un test (tests/instalador-honesto.test.mjs) que
  arma la lista desde esas dos secciones y falla si esta función diverge.
  Los unins* se saltean aparte: son el propio desinstalador, que Inno borra al
  final de todo, después de este paso. }
function EsNuestro(Nombre: String): Boolean;
var
  N: String;
begin
  N := Lowercase(Nombre);
  Result := (N = 'opencode') or (N = 'install') or (N = 'version')
    or (N = 'abrir-tecnia-bot.cmd') or (N = 'tecnia-bot.ico')
    or (N = '.instalando') or (N = 'instalacion.log')
    or ((Copy(N, 1, 12) = 'instalacion-') and (Copy(N, Length(N) - 3, 4) = '.log'));
end;

procedure AnotarEnLista(var Lista: String; var Cuantos: Integer; Nombre: String);
begin
  Cuantos := Cuantos + 1;
  if Cuantos <= 8 then
    Lista := Lista + '  ' + Nombre + #13#10
  else if Cuantos = 9 then
    Lista := Lista + '  ... y más' + #13#10;
end;

procedure MirarLoQueQuedo(var Propio: String; var Ajeno: String);
var
  Hallado: TFindRec;
  CuantosPropios: Integer;
  CuantosAjenos: Integer;
begin
  Propio := '';
  Ajeno := '';
  CuantosPropios := 0;
  CuantosAjenos := 0;
  if FindFirst(ExpandConstant('{app}\*'), Hallado) then
  begin
    try
      repeat
        if (Hallado.Name <> '.') and (Hallado.Name <> '..')
           and (CompareText(Copy(Hallado.Name, 1, 5), 'unins') <> 0) then
        begin
          if EsNuestro(Hallado.Name) then
            AnotarEnLista(Propio, CuantosPropios, Hallado.Name)
          else
            AnotarEnLista(Ajeno, CuantosAjenos, Hallado.Name);
        end;
      until not FindNext(Hallado);
    finally
      FindClose(Hallado);
    end;
  end;
end;

procedure AvisarLoQueQuedo;
var
  Propio: String;
  Ajeno: String;
  Texto: String;
begin
  MirarLoQueQuedo(Propio, Ajeno);
  if (Propio = '') and (Ajeno = '') then
    Exit;
  Log('Tecnia Bot: en la carpeta del programa quedo sin borrar, propio: ' + Propio + ' | ajeno: ' + Ajeno);
  if UninstallSilent() then
    Exit;

  Texto := 'Tecnia Bot se desinstaló, pero su carpeta no quedó vacía.';
  if Propio <> '' then
    Texto := Texto + #13#10 + #13#10
      + 'NO PUDE BORRAR estos archivos de Tecnia Bot:' + #13#10 + Propio
      + 'Suele pasar cuando algo los tiene abiertos (Tecnia Bot, el antivirus). '
      + 'Cerralo y borralos a mano.';
  if Ajeno <> '' then
    Texto := Texto + #13#10 + #13#10
      + 'Además hay cosas que el instalador NO había puesto, y por eso no las toqué:'
      + #13#10 + Ajeno
      + 'Pueden ser proyectos guardados ahí por error. Si te sirven, movelos a '
      + 'Documentos antes de borrar la carpeta.';
  Texto := Texto + #13#10 + #13#10 + 'Todo eso está en:' + #13#10
    + '  ' + ExpandConstant('{app}');

  MsgBox(Texto, mbInformation, MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Bandera: String;
  Ventana: Integer;
  Codigo: Integer;
  Lanzo: Boolean;
  Siguen: String;
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
        '(Si elegís "No", quedan en la compu, en las carpetas .config\opencode y ' +
        '.local\share\opencode de tu usuario. Este desinstalador se va junto con ' +
        'el programa: para borrarlos después hay que hacerlo a mano, o volver a ' +
        'instalar Tecnia Bot y desinstalarlo eligiendo "Sí".)',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES);

    { Y ACA se ejecuta, en el mismo paso, con la respuesta ya en la mano.
      No en [UninstallRun]: esa sección se resolvió al instalar (ver el
      comentario largo allá). usUninstall corre ANTES de que se borren los
      archivos, así que el uninstall.ps1 de la carpeta de instalación todavía
      existe. (En un comentario Pascal de llaves no se puede nombrar una
      constante entre llaves: el comentario cierra en el primer cierre de llave
      y ISCC tira "Syntax error". Tercer caso de la misma familia en este archivo.)

      La consola se MUESTRA sólo en la rama que borra: uninstall.ps1 relee cada
      borrado antes de afirmarlo, y si un archivo está tomado -OpenCode abierto,
      por ejemplo- lo dice y explica qué hacer. Ocultar eso justo en el único
      camino que borra datos de menores dejaría la desinstalación tan muda como
      el bug que se arregló. La rama que conserva no tiene nada que mostrar. }
    if PurgarDatosPersonales then
    begin
      Bandera := '-Borrar';
      Ventana := SW_SHOWNORMAL;
    end
    else
    begin
      Bandera := '-Conservar';
      Ventana := SW_HIDE;
    end;

    { EL CÓDIGO DE SALIDA SE LEE. Antes este Exec guardaba el código en "Codigo"
      y nadie lo miraba: sólo se avisaba si Exec devolvía False, o sea si Windows
      no había podido ni lanzar PowerShell. Si el script corría y NO podía borrar
      -OpenCode abierto, un archivo tomado-, salía con su código de error y acá
      no pasaba nada: el docente que eligió borrar se iba convencido de que los
      datos de sus alumnos ya no estaban.

      Y EL RESULTADO SE DICE CON UN CARTEL PROPIO, no con la consola. Con -Borrar
      la consola se muestra, pero se cierra sola cuando el script termina: el
      "[X] NO PUDE BORRAR" que imprime uninstall.ps1 dura lo que tarda en cerrarse
      la ventana. El cartel se queda hasta que alguien lo lee.

      Tres comprobaciones, de la más débil a la más fuerte:
        1. Lanzo:   si Windows pudo iniciar PowerShell.
        2. Codigo:  lo que el script dice de sí mismo (ver CodigoUninstallParcial).
        3. Siguen:  lo que hay en el disco, mirado desde acá después de que el
                    script terminó. Sólo cuando se eligió borrar: si se eligió
                    conservar, que los archivos estén es lo esperado. }
    Lanzo := Exec('powershell.exe',
                  '-ExecutionPolicy Bypass -NoProfile -File "'
                    + ExpandConstant('{app}\install\uninstall.ps1') + '" ' + Bandera,
                  ExpandConstant('{app}'), Ventana, ewWaitUntilTerminated, Codigo);

    Siguen := '';
    if PurgarDatosPersonales then
      Siguen := DatosPersonalesQueSiguen;

    { OJO con cómo se parte esta llamada: la lista de argumentos de Format va entre
      corchetes, y un renglón que EMPIEZA con corchete es para ISCC un encabezado
      de sección ("Invalid section tag"). Por eso se arma concatenando. }
    Log('Tecnia Bot: uninstall.ps1 ' + Bandera + ' -> codigo ' + IntToStr(Codigo)
        + ', datos personales que siguen en el disco: ' + Siguen);
    if not Lanzo then
      Log('Tecnia Bot: Windows no pudo lanzar PowerShell para uninstall.ps1.');

    { Si no hay nadie mirando no se puede avisar: al menos no se afirma nada. }
    if (not UninstallSilent()) and ((not Lanzo) or (Codigo <> 0) or (Siguen <> '')) then
      AvisarDesinstalacionIncompleta(Lanzo, Codigo, Siguen);
  end;

  { usPostUninstall: ya se procesaron los archivos instalados y la sección
    UninstallDelete. Recién ahora tiene sentido mirar qué quedó. }
  if CurUninstallStep = usPostUninstall then
    AvisarLoQueQuedo;
end;
