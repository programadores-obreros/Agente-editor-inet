@echo off
rem ============================================================================
rem Lanzador de Tecnia Bot. Es lo que abre el acceso directo del menu inicio /
rem escritorio que crea el instalador .exe. Abre una terminal ya lista con
rem OpenCode corriendo, para que el docente no tenga que tipear nada.
rem ============================================================================
title Tecnia Bot
chcp 65001 >nul

rem La version se muestra en TODAS las pantallas de este lanzador, incluida la de
rem error. En una sesion de soporte real hubo que averiguar que version tenia un
rem docente contando los bytes del .exe contra el asset del release. Con esto,
rem cualquier captura de pantalla que mande ya lo dice.
set "VER=?"
if exist "%~dp0VERSION" set /p VER=<"%~dp0VERSION"

rem OpenCode se instala con Scoop, en el espacio del usuario: sus 'shims' quiza
rem no esten en el PATH de una consola nueva. Los agregamos por las dudas.
if exist "%USERPROFILE%\scoop\shims" set "PATH=%USERPROFILE%\scoop\shims;%PATH%"

rem La config de OpenCode honra XDG_CONFIG_HOME, igual que install.ps1 y
rem bootstrap.ps1. Si aca se mirara siempre %USERPROFILE%\.config, en una maquina
rem con esa variable puesta la capa se instalaria en un lado y se buscaria en
rem otro: "falta la capa, volve a correr el instalador", en loop, con todo bien.
set "OCCFG=%USERPROFILE%\.config\opencode"
if defined XDG_CONFIG_HOME set "OCCFG=%XDG_CONFIG_HOME%\opencode"

rem -- Si la instalacion todavia esta corriendo, se espera ---------------------
rem
rem El acceso directo se crea en [Icons], que en Inno corre ANTES que [Run].
rem Medido: queda clickeable a los 0,9 segundos, cuando la instalacion recien va
rem a empezar a bajar los 57 MB de OpenCode. En una notebook de escuela eso son
rem varios minutos, y el docente que ve aparecer el icono lo abre. Es lo natural.
rem
rem Antes, en ese momento, esto le decia "No se encontro OpenCode, volve a correr
rem el instalador" MIENTRAS el instalador estaba corriendo. El consejo era peor
rem que el error: lo empujaba a arrancar una segunda instalacion sobre la
rem primera. Le paso a una persona real y penso que era su maquina.
rem
rem Ahora espera, y abre solo cuando termina. No se chequea 'where opencode'
rem para salir antes: OpenCode se instala en el paso 2 de 4, y arrancar ahi da un
rem OpenCode pelado, sin Tecnia Bot. Eso tambien ya paso.
set "MARCA=%~dp0.instalando"
if not exist "%MARCA%" goto verificar

rem MARCA HUERFANA: si OpenCode YA anda, no hay nada que esperar.
rem
rem La marca la borra el instalador al terminar, pero si el Setup muere sin
rem deinicializar -- el antivirus lo mata, se corta la luz, el docente hace
rem Ctrl+Alt+Supr -- queda puesta para siempre. Y a partir de ahi cada doble clic
rem eran VEINTE MINUTOS de puntitos antes de intentar nada. En un aula, la clase
rem entera.
rem
rem Si opencode responde, la instalacion evidentemente termino: se sigue de largo.
rem OJO: se exige TAMBIEN la capa educativa, no solo que opencode ande.
rem
rem OpenCode se instala en el paso 2 de 4. Mirar solo si arranca daba positivo en
rem mitad de una instalacion normal, borraba la marca --que es el estado
rem compartido que le avisa a los demas-- y se metia a reparar encima. Es lo mismo
rem que este archivo advierte doce lineas mas arriba y hacia igual.
rem
rem La capa es lo ULTIMO que se instala: si esta, la instalacion termino de verdad.
opencode --version >nul 2>nul
if not errorlevel 1 if exist "%OCCFG%\agent\tecnia-bot.md" goto verificar

rem MARCA HUERFANA, SEGUNDA PARTE: la instalacion NO quedo completa y la marca
rem sigue puesta. Hay dos mundos posibles y desde afuera se ven iguales:
rem
rem   el instalador esta corriendo  -- hay que esperar, como siempre
rem   el instalador murio           -- no hay nada que esperar, y nadie va a
rem                                    venir a sacar la marca
rem
rem En el segundo caso cada doble clic eran veinte minutos de puntitos y despues
rem "La instalacion sigue en curso, esperala", para siempre. La unica salida era
rem adivinar que habia que borrar un archivo oculto a mano.
rem
rem Se distinguen preguntando si el instalador VIVE (ver la rutina mirarsetup,
rem mas abajo, y por que no se mira la antiguedad de la marca). Solo se sale de
rem la espera si se COMPROBO que no vive; si no se pudo saber, se espera igual.
call :mirarsetup
if "%SETUPVIVO%"=="no" goto marcahuerfana

echo.
echo   Tecnia Bot v%VER% se esta instalando en este momento.
echo   Baja unos 60 MB, asi que puede tardar varios minutos.
echo.
echo   No cierres esta ventana: el bot se abre solo cuando termine.
echo.
set ESPERA=0

:esperando
rem ping en vez de timeout: 'timeout' falla si la consola no es interactiva.
ping -n 4 127.0.0.1 >nul
<nul set /p "=."
set /a ESPERA+=1
if not exist "%MARCA%" goto listo
rem Techo de ~20 minutos. Estaba en 5, y era poco: con 20 maquinas de un aula
rem bajando 57 MB de OpenCode mas Python mas PlatformIO por el mismo enlace, cinco
rem minutos no alcanzan ni cerca. Rendirse antes de tiempo era lo que mandaba al
rem lanzador a "reparar" una instalacion que estaba andando perfecto.
if %ESPERA% LSS 400 goto esperando

rem Se agoto el techo. El instalador pudo haber muerto MIENTRAS se esperaba: se
rem vuelve a mirar antes de seguir.
echo.
call :mirarsetup
if "%SETUPVIVO%"=="no" goto marcahuerfana

echo.
echo.
echo   La instalacion esta tardando mas de lo normal (mas de 20 minutos).
echo   Fijate si quedo alguna ventana de PowerShell abierta esperando algo.
echo.
goto verificar

:listo
echo.
echo.
echo   Listo, termino de instalarse. Abriendo...
echo.

:verificar
rem -- Se verifica que OpenCode CORRA, no que exista --------------------------
rem
rem El bootstrap aprendio esta leccion y la aplica bien; el lanzador se habia
rem quedado con `where`, que solo mira si el archivo esta. Si el antivirus dejo el
rem binario mutilado -- el caso que documenta diagnostico.ps1 -- `where` pasa, el
rem lanzador cree que todo bien, y OpenCode revienta al final del script: la
rem ventana se cierra sola y el docente no ve NADA.
rem
rem Es exactamente el sintoma que se reporto desde el aula.
rem -- TRES LUGARES DONDE BUSCAR, no uno --------------------------------------
rem
rem Esto salio de una notebook real donde el binario ESTABA y el bot no abria.
rem Scoop deja dos cosas distintas:
rem
rem   scoop\apps\opencode\current\opencode.exe   el programa de verdad, ~180 MB
rem   scoop\shims\opencode.exe                    un lanzador de 20 KB
rem
rem Y hay un caso -- documentado en Scoop -- donde la instalacion extrae el
rem programa, arma el enlace 'current', y ABORTA justo antes de crear el shim.
rem Queda todo menos esa pieza de 20 KB.
rem
rem El lanzador buscaba SOLO por el shim. Le estabamos pidiendo la llave a alguien
rem que tenia la puerta abierta al lado.
rem
rem Se prueba en orden: el binario directo, el shim, y el PATH. Con que ande uno,
rem el docente entra.
set "OC="
where opencode >nul 2>nul
rem El binario real PRIMERO: el shim de Scoop (20 KB) a veces falla con "Shim: Could not
rem determine if target is a GUI app" (visto en la VM y en una notebook) mientras
rem opencode.exe anda perfecto. current\ es el enlace que Scoop mantiene: siempre vigente.
if exist "%USERPROFILE%\scoop\apps\opencode\current\opencode.exe" set "OC=%USERPROFILE%\scoop\apps\opencode\current\opencode.exe"
if not defined OC if exist "%USERPROFILE%\scoop\shims\opencode.exe" set "OC=%USERPROFILE%\scoop\shims\opencode.exe"
if not defined OC if not errorlevel 1 set "OC=opencode"
if not defined OC goto reparar

"%OC%" --version >nul 2>nul
if errorlevel 1 (
  rem Un solo intento daba falsos negativos: en una notebook real dijo "NO ARRANCA" y
  rem OpenCode abrio un segundo despues (Scoop terminando de enlazar, antivirus leyendo
  rem el binario). Se espera 3 s y se prueba otra vez, como hace el bootstrap.
  ping -n 4 127.0.0.1 >nul
  "%OC%" --version >nul 2>nul
)
if errorlevel 1 (
  echo.
  echo   Tecnia Bot v%VER% -- OpenCode esta instalado pero NO ARRANCA.
  echo.
  echo   Las dos causas habituales son el antivirus y un procesador viejo.
  echo   Abri "Diagnostico de Tecnia Bot" en el menu inicio: te dice cual es.
  echo.
  pause
  exit /b 1
)

rem -- Si falta la capa, tambien se repara -----------------------------------
if not exist "%OCCFG%\agent\tecnia-bot.md" goto reparar
goto completo

:reparar
rem -- COMPLETAR LA INSTALACION, SIN QUE EL DOCENTE TIPEE NADA ----------------
rem
rem POR QUE EXISTE ESTO. En una notebook real el instalador termino, mostro su
rem pantalla verde, y no habia instalado nada: el paso automatico murio en 2,4
rem segundos. El MISMO script, corrido a mano dos minutos despues, instalo todo
rem perfecto en dos minutos.
rem
rem O sea que el script esta bien y lo que falla es el contexto en que Inno lo
rem lanza -- probablemente el antivirus escaneando el archivo recien escrito. No
rem se pudo confirmar, y para el aula da igual: el remedio es el mismo.
rem
rem Entonces el lanzador lo hace solo. Una vez. Si despues de eso sigue faltando
rem algo, ahi si avisa y para -- reintentar en bucle en la maquina de alguien es
rem peor que fallar.
rem LO PRIMERO: si TODAVIA hay una instalacion corriendo, no se toca nada.
rem
rem Sin esto, el techo de la espera desembocaba aca y lanzaba un SEGUNDO
rem bootstrap EN PARALELO con el que corre Inno: dos `scoop install opencode`
rem sobre los mismos archivos y dos `install.ps1` copiando sobre la misma config.
rem Es el mismo bug de las instalaciones simultaneas que el SetupMutex arregla --
rem pero el mutex solo bloquea un segundo Setup.exe, no un bootstrap lanzado
rem desde aca.
rem
rem Y con 20 maquinas compartiendo la red del aula, pasar los 5 minutos no es un
rem caso raro: es el caso normal.
if exist "%MARCA%" (
  echo.
  echo   La instalacion sigue en curso en esta maquina.
  echo.
  echo   Esperala a que termine y volve a abrir Tecnia Bot. No la corras dos
  echo   veces: se pisan entre si y rompen la instalacion.
  echo.
  echo   Si el instalador ya no esta abierto y este cartel sigue apareciendo,
  echo   abri "Reparar Tecnia Bot" en el menu inicio.
  echo.
  pause
  exit /b 0
)
if defined YAREPARE goto sinopencode
set "YAREPARE=1"
cls
echo.
echo   Tecnia Bot no quedo instalado del todo.
echo.
echo   Lo completo ahora. Tarda un par de minutos y no hay que hacer nada.
echo   No cierres esta ventana.
echo.
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0install\bootstrap.ps1"
echo.
echo   Listo, verificando...
echo.
goto verificar

:completo
rem -- Y que la capa educativa este publicada --------------------------------
rem
rem OpenCode puede arrancar perfecto y no tener nada de Tecnia Bot: pasa cuando
rem install.ps1 muere a mitad de copiar. El docente ve un editor pelado, sin logo
rem ni agente, y no tiene forma de saber que le falta algo.
if not exist "%OCCFG%\agent\tecnia-bot.md" (
  echo.
  echo   Tecnia Bot v%VER% -- OpenCode anda, pero falta la capa educativa.
  echo.
  echo   La copia de archivos quedo a medias. Abri "Reparar Tecnia Bot" en el
  echo   menu inicio: la completa sin volver a bajar el instalador.
  echo.
  pause
  exit /b 1
)
goto proyectos

:sinopencode
echo.
echo   Tecnia Bot v%VER% -- no se encontro OpenCode.
echo.
echo   Si el instalador esta corriendo ahora mismo, esperalo: no lo corras dos veces.
echo   Si ya termino, abri "Reparar Tecnia Bot" en el menu inicio: instala lo
echo   que falta sin volver a bajar el instalador.
echo.
pause
exit /b 1

:marcahuerfana
rem -- LA INSTALACION ANTERIOR SE CORTO ---------------------------------------
rem
rem Aca se llega con dos cosas COMPROBADAS: la marca de instalacion en curso esta
rem puesta, y el instalador que la puso ya no esta corriendo.
rem
rem NO SE REPARA SOLO, y es a proposito. Que el instalador haya muerto no dice
rem nada de su hijo: la ventana de PowerShell del bootstrap puede seguir viva e
rem instalando, y lanzar aca otro bootstrap serian dos instalaciones pisandose.
rem Es el mismo choque que este archivo ya evita mas arriba. Eso lo puede mirar
rem una persona -hay o no hay una ventana negra abierta- y este script no.
rem
rem TAMPOCO SE BORRA LA MARCA: la sacaria justo en el caso en que el bootstrap
rem sigue corriendo. Cuando Reparar termina bien, el chequeo del principio de
rem este archivo ya la ignora (OpenCode anda y la capa esta), asi que no estorba.
echo.
echo   Tecnia Bot v%VER% -- la instalacion anterior no termino.
echo.
echo   El instalador ya no esta corriendo y la instalacion quedo a medias: se
echo   corto la luz, se cerro la ventana, o lo freno el antivirus.
echo.
echo   Si quedo abierta una ventana negra de PowerShell instalando, esperala.
echo   Si no hay ninguna, abri "Reparar Tecnia Bot" en el menu inicio: completa
echo   lo que falto sin volver a bajar el instalador.
echo.
pause
exit /b 1

:mirarsetup
rem -- VIVE EL INSTALADOR? Deja la respuesta en SETUPVIVO -----------------------
rem
rem   no    se COMPROBO que no hay ningun instalador de Tecnia Bot corriendo
rem   nose  cualquier otra cosa: hay uno, o no se pudo averiguar
rem
rem COMO SE SABE: el instalador crea un mutex de Windows con nombre propio
rem mientras corre -la directiva SetupMutex de installer\tecnia-bot.iss- y Windows
rem lo destruye solo cuando el proceso termina, muera como muera. Si el mutex no
rem existe, no hay instalador. Un .cmd no puede preguntar por un mutex, asi que se
rem le pide a PowerShell en una linea. Los dos nombres son los del .iss; hay un
rem test que compara los dos archivos.
rem
rem POR QUE NO LA ANTIGUEDAD DE LA MARCA, que era la otra opcion. En cmd puro lo
rem unico que mira la edad de un archivo es forfiles, y cuenta en DIAS enteros:
rem una marca huerfana seguiria colgando al docente hasta el dia siguiente, y una
rem instalacion que cruza la medianoche se daria por muerta estando viva. Y la
rem edad no mide lo que importa: con veinte maquinas bajando por el mismo enlace
rem una instalacion sana puede tardar mas que cualquier umbral razonable.
rem
rem POR QUE NO BUSCAR EL PROCESO POR NOMBRE con tasklist: el instalador se puede
rem llamar de cualquier forma -el navegador lo renombra si se baja dos veces- y
rem el que corre de verdad es una copia temporal con otra extension.
rem
rem EL SENTIDO DE LA FALLA ESTA ELEGIDO. Solo la salida 7 EXACTA significa "no
rem vive". Si PowerShell no arranca, esta bloqueado, o el chequeo revienta, queda
rem "nose" y el lanzador espera como hacia antes: equivocarse para ese lado cuesta
rem tiempo; equivocarse para el otro podria mandar a reparar encima de una
rem instalacion viva. Por eso dentro del chequeo cualquier error cuenta como
rem "vive", y de este lado se comparan las dos puntas: un "if errorlevel 7" solo
rem significa 7 o MAS, y se comeria el 9009 de un PowerShell que no existe.
set "SETUPVIVO=nose"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$vivo=$false; foreach($n in 'TecniaBotSetup','Global\TecniaBotSetup'){ try { $m=$null; if([System.Threading.Mutex]::TryOpenExisting($n,[ref]$m)){ $vivo=$true; $m.Close() } } catch { $vivo=$true } }; if($vivo){ exit 0 } else { exit 7 }" >nul 2>nul
if errorlevel 7 if not errorlevel 8 set "SETUPVIVO=no"
goto :eof

:sinproyectos
rem -- SIN CARPETA DE PROYECTOS NO SE ABRE EL BOT ------------------------------
rem
rem Aca se llega cuando no se pudo ENTRAR a la carpeta de proyectos. Antes eso no
rem se miraba: ni el mkdir ni el cd se verificaban, y si fallaban el lanzador
rem seguia de largo. OpenCode arrancaba en la carpeta donde esta parado este
rem archivo -la del programa, porque el acceso directo la pone como carpeta de
rem trabajo- y todo lo que el alumno armaba quedaba guardado ahi adentro, mezclado
rem con el programa, en una carpeta que el desinstalador se lleva.
rem
rem No es un caso de laboratorio: el "Acceso controlado a carpetas" de Windows
rem Defender bloquea que un programa que no conoce escriba en Documentos, y en
rem una PC administrada puede estar prendido sin que el docente lo sepa.
rem
rem Se frena y se dice. Perder el trabajo de un alumno es peor que no abrir.
echo.
echo   Tecnia Bot v%VER% -- no pude entrar a la carpeta de proyectos:
echo.
echo     "%PROY%"
echo.
echo   No abro el bot: los proyectos quedarian guardados adentro de la carpeta
echo   del programa, que se borra al desinstalar.
echo.
echo   Fijate que esa carpeta exista y que se pueda escribir en ella. Si Windows
echo   avisa que bloqueo un cambio en Documentos, es la proteccion de carpetas:
echo   hay que permitirlo desde Seguridad de Windows.
echo.
pause
exit /b 1

:proyectos
rem -- LA CARPETA DE PROYECTOS: la de Documentos DE VERDAD, y verificada --------
rem
rem Estaba escrita a fuego: la carpeta Documents adentro del perfil. Esa NO es
rem siempre la carpeta Documentos: con OneDrive haciendo copia de seguridad de las
rem carpetas, o con Documentos redirigida por la escuela a otro disco, la de
rem verdad esta en otro lado y la del perfil puede no existir. El lanzador creaba
rem una carpeta "Documents" suelta y guardaba ahi: el docente abria Documentos y
rem sus proyectos no estaban.
rem
rem A Windows se le pregunta con la API que usan los programas
rem (Environment.GetFolderPath), que ya resuelve OneDrive y las redirecciones. Un
rem .cmd no puede llamarla, asi que se le pide a PowerShell en una linea.
rem
rem CUANTO CUESTA, razonado y NO medido (aca no hay un Windows donde medirlo):
rem es un arranque de powershell.exe con -NoProfile y sin cargar ningun modulo.
rem Este lanzador YA arranca PowerShell una vez por apertura, mas abajo, para
rem chequear la key: esto suma un segundo arranque de lo mismo. En una maquina
rem comun es menos de un segundo; en una netbook con disco mecanico y antivirus
rem pueden ser dos o tres. Hay que medirlo en la VM y en una notebook real antes
rem de darlo por bueno.
rem
rem SI ALGO DE ESTO FALLA SE VUELVE A LO DE ANTES, no se frena: que PowerShell no
rem arranque, que este bloqueado, o que conteste una ruta que no existe en el
rem disco (puede pasar con un nombre de usuario con acentos y la consola en otra
rem codificacion) deja DOCS vacio y se usa la carpeta del perfil, como siempre.
set "DOCS="
for /f "usebackq delims=" %%D in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::GetFolderPath('MyDocuments')" 2^>nul`) do set "DOCS=%%D"
if defined DOCS if not exist "%DOCS%\" set "DOCS="
if not defined DOCS set "DOCS=%USERPROFILE%\Documents"

set "PROY=%DOCS%\Tecnia Bot"
set "PROYPERFIL=%USERPROFILE%\Documents\Tecnia Bot"

rem SI DOCUMENTOS ESTA EN LA RED, NO SE USA: se va derecho a la del perfil.
rem
rem Con la redireccion de carpetas clasica de un dominio escolar, Documentos es
rem una ruta de red de las que empiezan con dos barras invertidas. Windows la
rem informa bien y hasta se puede crear la carpeta ahi, pero cmd NO puede pararse
rem en una ruta asi: el cd falla SIEMPRE, no a veces. La primera version de este
rem bloque abortaba en ese caso, o sea en cada apertura, en una maquina donde
rem antes el bot abria. Era una regresion, y la encontro la revision.
rem
rem Se mira como empieza la ruta, sin intentar nada, y se usa la del perfil, que
rem es exactamente lo que se hacia antes de preguntarle a Windows.
if "%PROY:~0,2%"=="\\" set "PROY=%PROYPERFIL%"
if not exist "%PROY%\" mkdir "%PROY%" 2>nul

rem Lo que decide es si se pudo ENTRAR, no si el mkdir dijo que anduvo.
rem
rem Se usa el operador de dos barras verticales y no un "if errorlevel 1" en la
rem linea siguiente: las dos barras miran si ESTE comando fallo. El "if
rem errorlevel" puede estar leyendo el codigo de un comando anterior, porque cd
rem no lo pone en 0 cuando le va bien. (No se escriben los simbolos en este
rem comentario a proposito: mejor no averiguar que hace cmd con ellos en un rem.)
rem ENPROY se prende SOLO si el cd anduvo, y es lo unico que deja pasar. No
rem alcanza con mirar despues que no quedamos en la carpeta del programa: si este
rem archivo se lanzo parado en otro lado, un cd fallido nos deja en ese otro lado.
set "ENPROY="
cd /d "%PROY%" 2>nul && set "ENPROY=1"
if defined ENPROY goto enproyectos

rem No se pudo entrar a la carpeta de Documentos que informo Windows. Antes de
rem rendirse se prueba la del perfil, que es la que se usaba siempre: puede que
rem la redirigida este caida o protegida y la local no. Si ya era esa, no hay
rem segundo intento que hacer.
if /i "%PROY%"=="%PROYPERFIL%" goto sinproyectos
set "PROY=%PROYPERFIL%"
if not exist "%PROY%\" mkdir "%PROY%" 2>nul
cd /d "%PROY%" 2>nul || goto sinproyectos

:enproyectos

rem Y la comprobacion que importa de verdad, mirando donde quedamos parados: NO
rem puede ser la carpeta del programa. La carpeta de este archivo termina en
rem barra y la carpeta actual no, por eso a la actual se le agrega una.
if /i "%CD%\"=="%~dp0" goto sinproyectos

:listo2

cls

rem -- EL CARTEL Y LA FUENTE DE LA CONSOLA -------------------------------------
rem
rem El cartel se dibujaba aca, con `echo`. En una notebook real salio desarmado
rem (un dibujo ASCII que no cerraba) y sin tildes: "escuelas tecnicas". Un .cmd
rem no puede llevar tildes sin depender de la tabla de caracteres con que cmd lo
rem lea, y este archivo va solo en ASCII a proposito.
rem
rem Ahora lo dibuja install\pantalla-lanzador.ps1, que escribe por la API Unicode
rem de la consola. Ese mismo script mira la fuente de esta ventana y, solo si es
rem de mapa de bits, la pasa a Consolas: con mapa de bits, el borde del cuadro de
rem texto de OpenCode y el spinner salen como signos de pregunta.
rem
rem ESTO TAMBIEN ES UN AVISO Y NO UN PORTERO. Si PowerShell no arranca, si la
rem escuela lo bloquea o si el archivo no esta, se dibuja el cartel de abajo, mas
rem pobre, y el bot abre igual. En este tramo no hay ni un `exit /b` ni un `goto`.
rem
rem El script sale con 0 SOLO si dibujo el cartel. `set` deja ERRORLEVEL en 0, y
rem por eso la segunda linea vuelve a preguntar si el archivo existe: sin esa
rem pregunta, un .ps1 que no esta se leeria como "ya lo dibuje".
set "PANTALLA=%~dp0install\pantalla-lanzador.ps1"
set "CARTEL=no"
if exist "%PANTALLA%" powershell -ExecutionPolicy Bypass -NoProfile -File "%PANTALLA%" "%VER%"
if not errorlevel 1 if exist "%PANTALLA%" set "CARTEL=si"

rem El cartel de reserva. Sin parentesis, sin barras verticales y sin signos que
rem cmd lea como otra cosa: va adentro de un bloque.
if "%CARTEL%"=="no" (
  echo.
  echo    [o_o]   TECNIA BOT v%VER%
  echo            Arduino y ESP32 para la escuela tecnica
  echo            un proyecto de Tecnia Lab
  echo.
  echo   Primeros pasos y ayuda:  https://tecnialab.net.ar/tecnia-bot/
  echo.
)

rem -- EL AVISO DE LA KEY VIVE ACA, Y NO ADENTRO DEL BOT ----------------------
rem
rem Se probo con Tecnia Bot corriendo de verdad en la VM: key invalida, agente en
rem google/gemini-3.5-flash-lite, la docente escribe un mensaje normal. Lo unico
rem que ve es esto:
rem
rem     Error: API key not valid. Please pass a valid API key.
rem
rem Exit code 1. Ni la skill "errores-del-bot", ni el disparador del prompt del
rem agente, ni una palabra del bot. Y NO es un bug que se pueda arreglar ahi: el
rem error ocurre en la llamada al proveedor, ANTES de que el modelo genere nada.
rem Le estabamos pidiendo AL MODELO que explique que el modelo esta muerto.
rem EL BOT NO PUEDE EXPLICAR QUE EL BOT NO ARRANCA: es imposible por
rem construccion, no por descuido. Por eso el aviso vive del lado de afuera, en
rem el lanzador, que corre SIEMPRE, con modelo o sin modelo.
rem
rem La logica esta en install\chequear-clave.ps1 porque un .cmd no puede hacer
rem HTTPS de forma decente. Ese script tambien es el que decide callarse: en una
rem maquina sin key (agente en Big Pickle) sale sin tocar la red, y cuando no
rem pudo probar la key -- sin internet, timeout, el filtro de la escuela -- no
rem imprime nada, porque no sabemos si la key sirve y molestar en CADA arranque
rem con un aviso que no dice nada es peor que callarse.
rem
rem ESTO ES UN AVISO, NO UN PORTERO. Pase lo que pase con el chequeo -- que
rem PowerShell no arranque, que la politica de la escuela lo bloquee, que el
rem archivo no este, que devuelva cualquier cosa -- se sigue de largo y el bot
rem abre. Por eso en este tramo NO hay ni un `exit /b` ni un `goto`: una docente
rem en el aula tiene que poder abrir Tecnia Bot aunque este chequeo este roto.
rem Hay un test que lo custodia por mutacion.
rem
rem `set` deja ERRORLEVEL en 0: si el .ps1 no esta, el `if errorlevel` de abajo
rem lee ese 0 y no arrastra el codigo de salida de cualquier comando anterior.
set "CHEQUEO=%~dp0install\chequear-clave.ps1"
if exist "%CHEQUEO%" powershell -ExecutionPolicy Bypass -NoProfile -File "%CHEQUEO%"

rem Salida 9 EXACTA = el chequeo imprimio un aviso, y hay que darle tiempo de
rem leerlo antes de que la pantalla completa del bot se lo coma. Un `if errorlevel
rem 9` solo significa "9 o mas" y se comeria el 9009 de "powershell no existe"
rem con la pantalla vacia: de ahi las dos comparaciones. `pause` no cuelga si la
rem consola no es interactiva (lee EOF y sigue), a diferencia de `timeout`.
if errorlevel 9 if not errorlevel 10 (
  echo   Apreta una tecla para abrir Tecnia Bot igual.
  pause >nul
  echo.
)

rem -- LA REVISION PREVIA A LA CARGA A LA PLACA ---------------------------------
rem
rem Es el equivalente en Windows de install\tecnia-bot.sh. Cargar a la placa el
rem programa generado desde un proyecto fisico exige saber que Tecnia Bot se abrio
rem pasando por esta revision; sin eso el bot arma, dibuja y compila, pero no
rem carga. Hasta el 2026-11-23 esto existia solo en Linux: en la primera prueba en
rem una notebook Windows real el camino nuevo llego hasta compilar y no pudo
rem llegar a la placa.
rem
rem Por que antes de abrir y no cuando se pide la carga: una configuracion de
rem OpenCode en la carpeta del proyecto o mas arriba puede aprobar sola el cartel
rem de la carga, y OpenCode la guarda en memoria al arrancar. Revisar el disco
rem recien cuando se pide la carga no alcanza (medido en OpenCode 1.18.18).
rem
rem Los tres pasos, en el mismo orden que el lanzador de Linux:
rem   1. limpiar el entorno: se saca TODA variable OPENCODE_* salvo
rem      OPENCODE_DISABLE_CLAUDE_CODE (que solo apaga una lectura), y se fija
rem      OPENCODE_DISABLE_PROJECT_CONFIG=1;
rem   2. revisar la carpeta con la MISMA revision que usa la tool
rem      (carga\revisar-lanzamiento.ts, que corre con Node);
rem   3. solo si dio limpio, dejar la marca TECNIA_LANZADOR. Si no, se abre IGUAL
rem      pero sin la marca: el bot funciona entero salvo la carga a la placa, y
rem      cuando se la pidan va a decir por que.
rem
rem La marca se BORRA antes de empezar: si este archivo se corre desde una consola
rem que ya la tenia puesta (de otra apertura, o escrita a mano), no vale.
rem
rem La tool no confia solo en la marca: comprueba ademas que un proceso de mas
rem arriba sea cmd corriendo este mismo archivo instalado (procesos-windows.ts).
rem
rem ESTO TAMPOCO ES UN PORTERO: pase lo que pase aca -- que no haya Node, que
rem falte el archivo de la revision, que la carpeta tenga algo raro -- Tecnia Bot
rem abre. Por eso en este tramo no hay ni un exit ni un salto. Lo unico que cambia
rem es si queda o no la marca.
rem
rem El "for" lee la salida de "set OPENCODE_" y usa solo el NOMBRE de cada
rem variable (lo que esta antes del primer signo igual): el valor no se interpreta.
rem
rem NODE SE BUSCA POR SU RUTA, NO POR SU NOMBRE. Escribir "node" a secas hace que
rem cmd lo busque PRIMERO en la carpeta actual, que aca es la de los proyectos de
rem los alumnos: un node.exe o un node.bat dejado ahi contestaria "todo limpio"
rem sin revisar nada, y un .bat encima se llevaria el control y Tecnia Bot no
rem abriria. Se usa el que instala Tecnia Bot con Scoop; si no esta, el primer
rem node.exe del PATH (la forma con el signo de pesos y PATH busca solo en el
rem PATH, no en la carpeta actual, y solo ese nombre exacto). Ademas, en la
rem ventana que espero a que termine la instalacion el PATH todavia es el viejo y
rem "node" no se encontraria aunque este recien instalado.
rem
rem SI NO SE PUDO REVISAR, SE DICE POR QUE. TECNIA_SIN_MARCA le cuenta a la tool
rem el motivo, para que cuando pidan la carga no conteste "abrilo desde el
rem acceso directo" a alguien que lo abrio desde el acceso directo. Es solo un
rem texto para el mensaje: no habilita nada.
set "TECNIA_LANZADOR="
set "TECNIA_SIN_MARCA="
for /f "tokens=1 delims==" %%V in ('set OPENCODE_ 2^>nul') do if /i not "%%V"=="OPENCODE_DISABLE_CLAUDE_CODE" set "%%V="
set "OPENCODE_DISABLE_PROJECT_CONFIG=1"
set "REVISION=%OCCFG%\carga\revisar-lanzamiento.ts"
set "NODO="
if exist "%USERPROFILE%\scoop\apps\nodejs-lts\current\node.exe" set "NODO=%USERPROFILE%\scoop\apps\nodejs-lts\current\node.exe"
if not defined NODO for %%I in (node.exe) do set "NODO=%%~$PATH:I"
set "REVISADO="
set "NODE_NO_WARNINGS=1"
if defined NODO if exist "%REVISION%" "%NODO%" "%REVISION%" >nul 2>nul && set "REVISADO=1"
set "NODE_NO_WARNINGS="
if defined REVISADO set "TECNIA_LANZADOR=lanzador-cmd"
if not defined REVISADO set "TECNIA_SIN_MARCA=carpeta"
if not exist "%REVISION%" set "TECNIA_SIN_MARCA=sin-revision"
if not defined NODO set "TECNIA_SIN_MARCA=sin-node"
if "%TECNIA_SIN_MARCA%"=="carpeta" echo   Aviso: en esta carpeta la carga a la placa queda deshabilitada. El resto funciona.
if "%TECNIA_SIN_MARCA%"=="sin-revision" echo   Aviso: falta un archivo de Tecnia Bot y la carga a la placa queda deshabilitada. Abri "Reparar Tecnia Bot" en el menu inicio.
if "%TECNIA_SIN_MARCA%"=="sin-node" echo   Aviso: no se encontro Node y la carga a la placa queda deshabilitada. Abri "Reparar Tecnia Bot" en el menu inicio.

echo   Abriendo... Si al cargar no aparece el agente 'tecnia-bot', cambialo con Tab.
echo.
"%OC%"
rem Sin este pause, si OpenCode se cae la ventana desaparece y no queda rastro.
rem En un aula eso es imposible de diagnosticar.
if errorlevel 1 (
  echo.
  echo   Tecnia Bot se cerro con un error.
  echo   Abri "Diagnostico de Tecnia Bot" en el menu inicio y mandanos lo que diga.
  echo.
  pause
)
