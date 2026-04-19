@echo off
cd /d "%~dp0"
REM Use CMD from repo root. Git Bash ./build_windows.bat is not supported.
setlocal EnableDelayedExpansion

echo ==========================================
echo   OpenClaw Buddy - Windows Release Build
echo ==========================================

REM Step 1: read VERSION file
if exist VERSION (
    for /f "usebackq delims=" %%V in ("VERSION") do set "VERSION=%%V"
) else (
    set VERSION=1.0.0
)
REM Trim leading or trailing spaces in VERSION
for /f "tokens=* delims= " %%a in ("!VERSION!") do set "VERSION=%%a"
echo [1/5] Version: %VERSION%

REM Step 2: clean internal api dist and sync frontend
echo [2/5] Cleaning up internal assets...
if exist "internal\api\dist" rd /S /Q "internal\api\dist"
mkdir "internal\api\dist"

REM Step 3: npm build in web folder
echo [3/5] Building Frontend - React...
pushd web
if not exist "node_modules" (
    echo [3.1] node_modules not found, installing...
    call npm install
)
call npm run build
if errorlevel 1 (
    echo [FAILED] Frontend build failed.
    popd
    exit /b 1
)
popd

echo [3.2] Syncing Frontend Build to Internal Assets...
xcopy /S /E /I /Y "web\dist\*" "internal\api\dist\" >nul
if exist "web\public\openclaw2.png" (
    copy /Y "web\public\openclaw2.png" "internal\api\dist\" >nul
)

REM Step 4: Wails production and debug builds with skipbindings
echo [4/5] Building Wails Binaries - Production and Debug...
wails build -platform windows/amd64 -skipbindings -o openclaw-buddy.exe
if errorlevel 1 (
    echo [FAILED] Wails production build failed.
    exit /b 1
)
wails build -debug -platform windows/amd64 -skipbindings -o openclaw-buddy-debug.exe
if errorlevel 1 (
    echo [FAILED] Wails debug build failed.
    exit /b 1
)

REM Step 5: release folder and zip
echo [5/5] Organizing Release Folder...
set "PKG_NAME=openclaw-buddy-windows-v%VERSION%"
set "PKG_DIR=release\%PKG_NAME%"

if exist "release" rd /S /Q "release"
mkdir "%PKG_DIR%"

if exist "build\bin\openclaw-buddy.exe" (
    copy /Y "build\bin\openclaw-buddy.exe" "%PKG_DIR%\" >nul
) else (
    echo [FAILED] Binary not found: build\bin\openclaw-buddy.exe
    exit /b 1
)
if exist "build\bin\openclaw-buddy-debug.exe" (
    copy /Y "build\bin\openclaw-buddy-debug.exe" "%PKG_DIR%\" >nul
)

if exist "README_windows.md" (
    copy /Y "README_windows.md" "%PKG_DIR%\README.md" >nul
)

REM env file: same keys as build_windows.ps1, UTF-8 via PowerShell. No parens in echo block above.
set "ENVTMP=%TEMP%\openclaw-buddy-env.%RANDOM%.tmp"
(
echo # OpenClaw Buddy - Windows Production
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
) > "%ENVTMP%"
powershell -NoProfile -Command "Get-Content -LiteralPath '%ENVTMP%' | Set-Content -LiteralPath '%PKG_DIR%\env' -Encoding utf8"
if errorlevel 1 (
    echo [FAILED] Could not write UTF-8 env file.
    del "%ENVTMP%" >nul 2>&1
    exit /b 1
)
del "%ENVTMP%" >nul 2>&1

echo [5.1] Creating ZIP archive...
powershell -NoProfile -Command "Compress-Archive -Path '%PKG_DIR%\*' -DestinationPath 'release\%PKG_NAME%.zip' -Force"
if errorlevel 1 (
    echo [FAILED] ZIP step failed. Close any running openclaw-buddy.exe / openclaw-buddy-debug.exe and retry.
    exit /b 1
)

echo ==========================================
echo [SUCCESS] Windows Release Complete!
echo Final Package: release\%PKG_NAME%.zip
echo ==========================================
exit /b 0
