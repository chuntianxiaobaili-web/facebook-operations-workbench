@echo off
setlocal
cd /d "%~dp0"
set "FB_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "FB_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%FB_NODE%" -e "const [m,n]=process.versions.node.split('.').map(Number);process.exit(m>22||m===22&&n>=13?0:1)" >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13 or newer from https://nodejs.org then open this file again.
  pause
  exit /b 1
)
if /i "%~1"=="demo" (
  "%FB_NODE%" demo.mjs
) else (
  "%FB_NODE%" run.mjs --open
)
if errorlevel 1 pause

