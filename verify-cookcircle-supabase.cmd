@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\pg\package.json" (
  echo Preparing the read-only verifier...
  call npm install
  if errorlevel 1 (
    echo Could not install the PostgreSQL driver. Check that Node.js and internet access are available.
    pause
    exit /b 1
  )
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify-cookcircle-supabase.ps1"
set "VERIFY_EXIT=%ERRORLEVEL%"
echo.
if "%VERIFY_EXIT%"=="0" (
  echo Verification finished successfully. Read the table totals above.
) else (
  echo Verification did not finish. Read the message above.
)
echo.
pause
exit /b %VERIFY_EXIT%
