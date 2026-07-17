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

echo.
echo   Abriendo Tecnia Bot... (cuando cargue, elegi el agente 'tecnia-bot' con Tab si no aparece solo)
echo.
opencode
