@echo off
setlocal
cd /d "%~dp0"
if not exist "dist\papers.json" copy /y "dist\papers.example.json" "dist\papers.json" >nul
if not exist "PaperGraph.exe" (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
start "" "%~dp0PaperGraph.exe"
endlocal

