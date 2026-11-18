@echo off
setlocal
title CookCircle delivery setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-cookcircle-delivery.ps1"
if errorlevel 1 (
  echo.
  echo CookCircle delivery setup did not finish. Read the error above, then press any key to close.
  pause >nul
)