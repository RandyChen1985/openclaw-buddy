@echo off
setlocal enabledelayedexpansion

echo ==========================================
echo   OpenClaw Buddy - Windows Release Build
echo ==========================================

:: 1. Detect Version
if exist VERSION (
    set /p VERSION=<VERSION
) else (
    set VERSION=1.0.0
)
echo [1/5] Version: %VERSION%

:: 2. Cleanup and Sync
echo [2/5] Cleaning up internal assets...
if not exist "internal\api\dist" mkdir "internal\api\dist"
del /Q "internal\api\dist\*.*" 2>nul

:: 3. Build Frontend
echo [3/5] Building Frontend (React)...
cd web
if not exist "node_modules" (
    echo [3.1] node_modules not found, installing...
    call npm install --silent
)
call npm run build --silent
cd ..

echo [3.2] Syncing Frontend Build to Internal Assets...
xcopy /S /E /Y "web\dist\*" "internal\api\dist\" >nul
copy /Y "web\public\openclaw2.png" "internal\api\dist\" >nul

:: 4. Wails Build
echo [4/5] Starting Wails Build (this may take a few minutes)...
:: Note: We build with Wails CLI to handle metadata/icons
wails build -platform windows/amd64 -o openclaw-buddy.exe

if %ERRORLEVEL% NEQ 0 (
    echo [FAILED] Wails build encountered an error.
    exit /b 1
)

:: 5. Organize Release Folder
echo [5/5] Organizing Release Folder...
set PKG_NAME=openclaw-buddy-windows-v%VERSION%
set PKG_DIR=release\%PKG_NAME%

if exist "%PKG_DIR%" rd /S /Q "%PKG_DIR%"
mkdir "%PKG_DIR%"
mkdir "%PKG_DIR%\logs"
mkdir "%PKG_DIR%\data"
mkdir "%PKG_DIR%\backups"
mkdir "%PKG_DIR%\reports"
mkdir "%PKG_DIR%\pid"

:: Copy Binary
if exist "build\bin\openclaw-buddy.exe" (
    copy /Y "build\bin\openclaw-buddy.exe" "%PKG_DIR%\" >nul
) else (
    echo [FAILED] Binary not found in build\bin\
    exit /b 1
)

:: Copy Docs
copy /Y "README_windows.md" "%PKG_DIR%\README.md" >nul

:: Create env template
(
echo # 🦞 OpenClaw Buddy (Windows Production)
echo WEB_PORT=3000
echo WEB_ROOT="/"
echo BUDDY_TOKEN="sk-replace-me-on-first-run"
echo DB_FILE="./data/guardian.db"
echo OPENCLAW_CONFIG_DIR="~/.openclaw"
echo BACKUP_DIR="./backups"
echo LOG_FILE="./logs/guardian.log"
echo REPORT_DIR="./reports"
echo CHECK_INTERVAL_SECONDS=60
echo HEALTH_PORT=18789
echo MAX_RETRIES=3
echo SHOW_EXTERNAL_TOOLS=false
) > "%PKG_DIR%\env"

echo [5.1] Creating ZIP archive...
powershell -Command "Compress-Archive -Path '%PKG_DIR%' -DestinationPath 'release\%PKG_NAME%.zip' -Force"

echo ==========================================
echo [SUCCESS] Windows Release Complete!
echo Final Package: release\%PKG_NAME%.zip
echo ==========================================
pause
