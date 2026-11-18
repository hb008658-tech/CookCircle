@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\pg\package.json" (
  echo Preparing the migration tool...
  call npm install
  if errorlevel 1 (
    echo Could not install the PostgreSQL driver. Check that Node.js and internet access are available.
    pause
    exit /b 1
  )
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0migrate-cookcircle-to-supabase.ps1"
set "MIGRATION_EXIT=%ERRORLEVEL%"
echo.
if "%MIGRATION_EXIT%"=="0" (
  echo Migration process finished successfully. Read the completion message above.
) else (
  echo Migration did not complete. Read the message above before retrying.
)
echo.
pause
exit /b %MIGRATION_EXIT%
