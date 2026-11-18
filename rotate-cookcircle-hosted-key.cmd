@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0rotate-cookcircle-hosted-key.ps1"
set "ROTATE_EXIT=%ERRORLEVEL%"
echo.
if not "%ROTATE_EXIT%"=="0" echo Rotation did not finish. Keep the current Render key and do not deploy publicly.
echo.
pause
exit /b %ROTATE_EXIT%
