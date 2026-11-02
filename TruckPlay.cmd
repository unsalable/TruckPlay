@echo off
rem Starts the TruckPlay host (normally the game plugin starts it on its own).
rem   TruckPlay.cmd          offscreen, for the game
rem   TruckPlay.cmd window   a desktop window to try TruckPlay without the game (demo drive)
setlocal
set "ROOT=%~dp0"
set "ELECTRON=%ROOT%host\node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" (
  echo Electron bulunamadi. Once kurulum: powershell -ExecutionPolicy Bypass -File "%ROOT%scripts\kur.ps1"
  exit /b 1
)
if /i "%~1"=="window" (
  start "" "%ELECTRON%" "%ROOT%host" --window --demo
) else (
  start "" "%ELECTRON%" "%ROOT%host"
)
