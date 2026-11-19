@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Kiyomira
pushd "%~dp0"
if errorlevel 1 goto folder_error
where node.exe >nul 2>nul
if errorlevel 1 goto node_missing
node "Kiyomira.cjs"
set "KIYOMIRA_EXIT=%ERRORLEVEL%"
popd
if not "%KIYOMIRA_EXIT%"=="0" goto failed
exit /b 0

:folder_error
echo ERROR: Cannot open project directory.
goto pause_error

:node_missing
echo ERROR: Node.js 24 or newer was not found in PATH.
echo Install Node.js from https://nodejs.org/
popd
goto pause_error

:failed
echo.
echo ERROR: Kiyomira exited with code %KIYOMIRA_EXIT%.
echo See the startup log in the project data directory.
goto pause_error

:pause_error
echo.
pause
exit /b 1
