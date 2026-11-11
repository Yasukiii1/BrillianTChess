@echo off
title Chess Co-op server
cd /d "%~dp0"

rem ---- Pick the port here (any number from 1024 to 65535; 3000 is the default) ----
if "%PORT%"=="" set PORT=3000

rem Install packages the first time (or if node_modules was deleted)
if not exist node_modules (
  echo Installing packages, this only happens once...
  call npm install --omit=dev
)

echo.
echo   Chess Co-op is starting on http://localhost:%PORT%
echo   Friends on the same Wi-Fi can use http://YOUR-PC-IP:%PORT%
echo   Close this window to stop the server.
echo.

rem Open the browser a moment after the server starts
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"

node server\index.js
pause
