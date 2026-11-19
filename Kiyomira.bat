@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Kiyomira
pushd "%~dp0"
if errorlevel 1 goto folder_error

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "Kiyomira.ps1"
set "KIYOMIRA_EXIT=%ERRORLEVEL%"
popd
if not "%KIYOMIRA_EXIT%"=="0" goto failed
exit /b 0

:folder_error
echo ERROR: Cannot open project directory.
goto pause_error

:failed
echo.
echo ERROR: Kiyomira exited with code %KIYOMIRA_EXIT%.
echo Check the startup log in the project data folder.
goto pause_error

:pause_error
echo.
pause
exit /b 1
