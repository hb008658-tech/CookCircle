@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0copy-cookcircle-hosted-key.ps1"
set "COPY_EXIT=%ERRORLEVEL%"
echo.
if "%COPY_EXIT%"=="0" (
  echo The key was copied to Clipboard. Paste it into Render's COOKCIRCLE_DOCUMENT_KEY value field.
) else (
  echo The key could not be copied. Read the error above; do not send the key file or its contents.
)
echo.
pause
exit /b %COPY_EXIT%
