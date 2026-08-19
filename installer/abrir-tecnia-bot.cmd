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
opencode --version >nul 2>nul
if not errorlevel 1 (
  del "%MARCA%" >nul 2>nul
  goto verificar
)

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
rem Techo de ~5 minutos, no de 20: si tarda mas que esto, algo pasa y
rem conviene que el docente lo sepa y no que mire puntitos.
if %ESPERA% LSS 100 goto esperando

echo.
echo.
echo   La instalacion esta tardando mas de lo normal (mas de 5 minutos).
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
where opencode >nul 2>nul
if errorlevel 1 goto sinopencode

opencode --version >nul 2>nul
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
opencode
rem Sin este pause, si OpenCode se cae la ventana desaparece y no queda rastro.
rem En un aula eso es imposible de diagnosticar.
if errorlevel 1 (
  echo.
  echo   Tecnia Bot se cerro con un error.
  echo   Abri "Diagnostico de Tecnia Bot" en el menu inicio y mandanos lo que diga.
  echo.
  pause
)
