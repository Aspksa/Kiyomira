@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Kiyomira
cd /d "%~dp0"
if errorlevel 1 (
  echo ERROR: Cannot open project directory.
  pause
  exit /b 1
)

where node.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js 24 or newer is required.
  echo Install Node.js from https://nodejs.org/ and restart this window.
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  echo ERROR: Cannot determine Node.js version.
  pause
  exit /b 1
)
if %NODE_MAJOR% LSS 24 (
  echo ERROR: Node.js 24 or newer is required. Found major version %NODE_MAJOR%.
  pause
  exit /b 1
)

set "KIYOMIRA_INTERACTIVE=1"
echo Starting Kiyomira...
node --run start
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Kiyomira stopped with error code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%
