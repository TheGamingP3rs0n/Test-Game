@echo off
title Scam Call Center
cd /d "%~dp0"
echo.
echo   =============================================
echo     SCAM CALL CENTER - Kolkata Night Shift
echo   =============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed. The game needs it to run.
  echo   Opening the download page - install the LTS version, then run this file again.
  start "" "https://nodejs.org/en/download"
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\vite" (
  echo   First launch: installing game files. This takes a minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo   Starting the game. Your browser will open in a moment.
echo   Keep this window open while you play - close it to quit.
echo.
call npm run play
pause
