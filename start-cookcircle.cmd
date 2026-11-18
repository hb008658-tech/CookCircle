@echo off
setlocal
title CookCircle server
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-cookcircle.ps1"
if errorlevel 1 (
  echo.
  echo CookCircle did not start. Read the error above, then press any key to close.
  pause >nul
)
