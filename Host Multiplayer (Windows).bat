@echo off
title Scam Call Center - Host
cd /d "%~dp0"
echo.
echo   Hosting a LAN co-op game. Teammates on the same Wi-Fi can join.
echo.
where node >nul 2>nul || (echo Node.js is required. Opening download page... & start "" "https://nodejs.org/en/download" & pause & exit /b 1)
if not exist "node_modules\vite" ( echo Installing game files... & call npm install --no-audit --no-fund )
call npm run host
pause
