@echo off
rem ============================================================================
rem Lanzador de Tecnia Bot. Es lo que abre el acceso directo del menu inicio /
rem escritorio que crea el instalador .exe. Abre una terminal ya lista con
rem OpenCode corriendo, para que el docente no tenga que tipear nada.
rem ============================================================================
title Tecnia Bot
chcp 65001 >nul

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

echo.
echo   Tecnia Bot se esta instalando en este momento.
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
where opencode >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No se encontro OpenCode.
  echo   Volve a correr el instalador de Tecnia Bot, o mira docs\instalacion-windows.md
  echo.
  pause
  exit /b 1
)

rem Carpeta de trabajo del docente para sus proyectos (se crea la primera vez).
set "PROY=%USERPROFILE%\Documents\Tecnia Bot"
if not exist "%PROY%" mkdir "%PROY%"
cd /d "%PROY%"

cls
echo.
echo    ___         [o_o]   TECNIA BOT  -  un proyecto de Tecnia Lab
echo   ^| ^|_^|        /^|_^|\   Arduino y ESP32 para escuelas tecnicas
echo.
echo   Primeros pasos y ayuda:  https://tecnialab.net.ar/tecnia-bot/
echo.
echo   Abriendo... (cuando cargue, elegi el agente 'tecnia-bot' con Tab si no aparece solo)
echo.
opencode
