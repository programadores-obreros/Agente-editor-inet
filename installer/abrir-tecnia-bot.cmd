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
if not errorlevel 1 if exist "%USERPROFILE%\.config\opencode\agent\tecnia-bot.md" goto verificar

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
rem Se prueba en orden: el PATH, el shim, y el binario directo. Con que ande uno,
rem el docente entra.
set "OC="
where opencode >nul 2>nul
if not errorlevel 1 set "OC=opencode"
if not defined OC if exist "%USERPROFILE%\scoop\shims\opencode.exe" set "OC=%USERPROFILE%\scoop\shims\opencode.exe"
if not defined OC if exist "%USERPROFILE%\scoop\apps\opencode\current\opencode.exe" set "OC=%USERPROFILE%\scoop\apps\opencode\current\opencode.exe"
if not defined OC goto reparar

"%OC%" --version >nul 2>nul
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
if not exist "%USERPROFILE%\.config\opencode\agent\tecnia-bot.md" goto reparar
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
if not exist "%USERPROFILE%\.config\opencode\agent\tecnia-bot.md" (
  echo.
  echo   Tecnia Bot v%VER% -- OpenCode anda, pero falta la capa educativa.
  echo.
  echo   Volve a correr el instalador: la copia de archivos quedo a medias.
  echo.
  pause
  exit /b 1
)
goto listo2

:sinopencode
echo.
echo   Tecnia Bot v%VER% -- no se encontro OpenCode.
echo.
echo   Si el instalador esta corriendo ahora mismo, esperalo: no lo corras dos veces.
echo   Si ya termino, volve a correrlo, o mira docs\instalacion-windows.md
echo.
pause
exit /b 1

:listo2

rem Carpeta de trabajo del docente para sus proyectos (se crea la primera vez).
set "PROY=%USERPROFILE%\Documents\Tecnia Bot"
if not exist "%PROY%" mkdir "%PROY%"
cd /d "%PROY%"

cls
echo.
echo    ___         [o_o]   TECNIA BOT v%VER%  -  un proyecto de Tecnia Lab
echo   ^| ^|_^|        /^|_^|\   Arduino y ESP32 para escuelas tecnicas
echo.
echo   Primeros pasos y ayuda:  https://tecnialab.net.ar/tecnia-bot/
echo.
echo   Abriendo... (cuando cargue, elegi el agente 'tecnia-bot' con Tab si no aparece solo)
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
